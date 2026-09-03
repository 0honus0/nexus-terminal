import type { RemoteExecutionTransport } from './remote-execution.port';

export type ExecutionSessionOwnerType = 'workspace' | 'agent' | 'system';

export interface ExecutionSessionIdentity {
  id: string;
  connectionId: number;
  ownerType: ExecutionSessionOwnerType;
  ownerId?: string;
}

export class ExecutionSession {
  private closed = false;

  constructor(
    public readonly identity: ExecutionSessionIdentity,
    public readonly transport: RemoteExecutionTransport,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.close();
  }
}
