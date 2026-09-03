import type { ResolvedSshConnection, SshConnectOptions } from '../connection/ssh-connection';
import { ExecutionSession, type ExecutionSessionIdentity, type ExecutionSessionOwnerType } from './execution-session';
import type { RemoteExecutionTransportFactory } from './remote-execution.port';

export interface CreateExecutionSessionRequest {
  id: string;
  ownerType: ExecutionSessionOwnerType;
  ownerId?: string;
  connection: ResolvedSshConnection;
  connect?: SshConnectOptions;
}

export class ExecutionSessionManager {
  private readonly sessions = new Map<string, ExecutionSession>();

  constructor(private readonly transportFactory: RemoteExecutionTransportFactory) {}

  async create(request: CreateExecutionSessionRequest): Promise<ExecutionSession> {
    if (this.sessions.has(request.id)) throw new Error(`Execution session ${request.id} already exists.`);
    const transport = await this.transportFactory.connect(request.connection, request.connect);
    const identity: ExecutionSessionIdentity = {
      id: request.id,
      connectionId: request.connection.connectionId,
      ownerType: request.ownerType,
      ownerId: request.ownerId,
    };
    const session = new ExecutionSession(identity, transport);
    this.sessions.set(request.id, session);
    return session;
  }

  get(id: string): ExecutionSession | undefined {
    return this.sessions.get(id);
  }

  snapshot(): readonly ExecutionSessionIdentity[] {
    return [...this.sessions.values()].map((session) => session.identity);
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    await session.close();
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(async (session) => {
      try {
        await session.close();
      } catch {
        // One failed transport cleanup must not block the remaining sessions.
      }
    }));
  }
}
