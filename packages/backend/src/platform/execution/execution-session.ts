import type { RemoteFileSystem, RemoteFileSystemRole } from '../filesystem/remote-filesystem';
import type {
  CommandRequest,
  CommandResult,
  CommandSessionRequest,
  RemoteCommandSession,
  RemoteExecutionTransport,
  RemoteShellSession,
  ShellRequest,
} from './remote-execution.port';

export type ExecutionSessionOwnerType = 'workspace' | 'agent' | 'system';
export type ExecutionSessionStatus = 'ready' | 'detached' | 'closed';

export interface ExecutionSessionIdentity {
  id: string;
  connectionId: number;
  ownerType: ExecutionSessionOwnerType;
  ownerId?: string;
}

export class ExecutionSession {
  private statusValue: ExecutionSessionStatus = 'ready';
  private transportValue?: RemoteExecutionTransport;

  constructor(
    public readonly identity: ExecutionSessionIdentity,
    transport: RemoteExecutionTransport,
  ) {
    this.transportValue = transport;
  }

  get id(): string {
    return this.identity.id;
  }

  get connectionId(): number {
    return this.identity.connectionId;
  }

  get ownerType(): ExecutionSessionOwnerType {
    return this.identity.ownerType;
  }

  get ownerId(): string | undefined {
    return this.identity.ownerId;
  }

  get status(): ExecutionSessionStatus {
    return this.statusValue;
  }

  get isReady(): boolean {
    return this.statusValue === 'ready' && Boolean(this.transportValue?.isOpen);
  }

  execute(request: CommandRequest): Promise<CommandResult> {
    return this.transport().execute(request);
  }

  startCommand(request: CommandSessionRequest): Promise<RemoteCommandSession> {
    return this.transport().startCommand(request);
  }

  openShell(request?: ShellRequest): Promise<RemoteShellSession> {
    return this.transport().openShell(request);
  }

  fileSystem(role: RemoteFileSystemRole): Promise<RemoteFileSystem> {
    return this.transport().fileSystem(role);
  }

  onTransportClose(listener: () => void): () => void {
    return this.transport().onClose(listener);
  }

  onTransportError(listener: (error: Error) => void): () => void {
    return this.transport().onError(listener);
  }

  detachTransport(): RemoteExecutionTransport {
    const transport = this.transport();
    this.transportValue = undefined;
    this.statusValue = 'detached';
    return transport;
  }

  async close(): Promise<void> {
    if (this.statusValue === 'closed') return;
    const transport = this.transportValue;
    this.transportValue = undefined;
    this.statusValue = 'closed';
    await transport?.close();
  }

  private transport(): RemoteExecutionTransport {
    if (!this.transportValue || this.statusValue !== 'ready') {
      throw new Error(`Execution session ${this.id} is not attached.`);
    }
    return this.transportValue;
  }
}
