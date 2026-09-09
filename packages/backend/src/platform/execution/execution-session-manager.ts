import { randomUUID } from 'node:crypto';
import type { ResolvedSshConnection, SshConnectOptions } from '../connection/ssh-connection';
import { ExecutionSession, type ExecutionSessionIdentity, type ExecutionSessionOwnerType } from './execution-session';
import type { RemoteExecutionTransport, RemoteExecutionTransportFactory } from './remote-execution.port';

export interface ConnectExecutionSessionRequest {
  id?: string;
  ownerType: ExecutionSessionOwnerType;
  ownerId?: string;
  connection: ResolvedSshConnection;
  connect?: SshConnectOptions;
}

export interface AttachExecutionSessionRequest {
  id?: string;
  connectionId: number;
  ownerType: ExecutionSessionOwnerType;
  ownerId?: string;
  transport: RemoteExecutionTransport;
}

export class ExecutionSessionManager {
  private readonly sessions = new Map<string, ExecutionSession>();

  constructor(private readonly transportFactory: RemoteExecutionTransportFactory) {}

  async connect(request: ConnectExecutionSessionRequest): Promise<ExecutionSession> {
    const id = request.id ?? randomUUID();
    this.assertAvailable(id);
    const transport = await this.transportFactory.connect(request.connection, request.connect);
    try {
      return this.attach({
        id,
        connectionId: request.connection.connectionId,
        ownerType: request.ownerType,
        ownerId: request.ownerId,
        transport,
      });
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  attach(request: AttachExecutionSessionRequest): ExecutionSession {
    const id = request.id ?? randomUUID();
    this.assertAvailable(id);
    if (!request.transport.isOpen) throw new Error('Cannot attach a closed execution transport.');
    const identity: ExecutionSessionIdentity = {
      id,
      connectionId: request.connectionId,
      ownerType: request.ownerType,
      ownerId: request.ownerId,
    };
    const session = new ExecutionSession(identity, request.transport);
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): ExecutionSession | undefined {
    return this.sessions.get(id);
  }

  require(id: string): ExecutionSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Execution session ${id} was not found.`);
    return session;
  }

  detach(id: string): RemoteExecutionTransport {
    const session = this.require(id);
    const transport = session.detachTransport();
    this.sessions.delete(id);
    return transport;
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    await session.close();
  }

  async closeByOwner(ownerType: ExecutionSessionOwnerType, ownerId?: string): Promise<void> {
    const matching = [...this.sessions.entries()].filter(
      ([, session]) => session.ownerType === ownerType && (ownerId === undefined || session.ownerId === ownerId),
    );
    for (const [id] of matching) this.sessions.delete(id);
    await Promise.all(matching.map(([, session]) => session.close().catch(() => undefined)));
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
  }

  snapshot(): readonly (ExecutionSessionIdentity & { status: string })[] {
    return [...this.sessions.values()].map((session) => ({
      ...session.identity,
      status: session.status,
    }));
  }

  private assertAvailable(id: string): void {
    if (this.sessions.has(id)) throw new Error(`Execution session ${id} already exists.`);
  }
}
