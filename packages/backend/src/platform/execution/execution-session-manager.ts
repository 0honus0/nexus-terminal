import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/logging/logger';
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
    logger.debug(
      { executionSessionId: id, connectionId: request.connection.connectionId, ownerType: request.ownerType },
      'Execution session connect dispatch',
    );
    let transport: RemoteExecutionTransport;
    try {
      transport = await this.transportFactory.connect(request.connection, request.connect);
    } catch (error) {
      logger.warn(
        {
          err: error,
          executionSessionId: id,
          connectionId: request.connection.connectionId,
          ownerType: request.ownerType,
        },
        'Execution transport connect failed',
      );
      throw error;
    }
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
    try {
      await session.close();
    } catch (error) {
      logger.warn(
        { err: error, executionSessionId: id, connectionId: session.connectionId, ownerType: session.ownerType },
        'Execution session close failed',
      );
      throw error;
    }
  }

  async closeByOwner(ownerType: ExecutionSessionOwnerType, ownerId?: string): Promise<void> {
    const matching = [...this.sessions.entries()].filter(
      ([, session]) => session.ownerType === ownerType && (ownerId === undefined || session.ownerId === ownerId),
    );
    for (const [id] of matching) this.sessions.delete(id);
    if (matching.length)
      logger.debug({ ownerType, ownerId, sessionCount: matching.length }, 'Execution sessions closing by owner');
    await Promise.all(
      matching.map(([id, session]) =>
        session
          .close()
          .catch((error) =>
            logger.warn({ err: error, executionSessionId: id, ownerType }, 'Execution session close failed'),
          ),
      ),
    );
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(
      sessions.map((session) =>
        session
          .close()
          .catch((error) =>
            logger.warn({ err: error, executionSessionId: session.id }, 'Execution session close failed'),
          ),
      ),
    );
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
