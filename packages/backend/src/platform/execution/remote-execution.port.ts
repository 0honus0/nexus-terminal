import type { ResolvedSshConnection, SshConnectOptions } from '../connection/ssh-connection';
import type { RemoteFileSystem, RemoteFileSystemRole } from '../filesystem/remote-filesystem';

export interface CommandRequest {
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface CommandResult {
  exitCode: number;
  signal?: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export class CommandExecutionError extends Error {
  constructor(
    message: string,
    public readonly result?: CommandResult,
  ) {
    super(message);
    this.name = 'CommandExecutionError';
  }
}

export interface CommandSessionRequest {
  command: string;
  pty?: boolean | { term?: string; columns?: number; rows?: number };
  maxOutputBytes?: number;
}

export type CommandSessionStatus = 'running' | 'completed' | 'failed' | 'terminated';

export interface CommandSessionSnapshot {
  id: string;
  command: string;
  status: CommandSessionStatus;
  startedAt: number;
  exitCode?: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}

export interface RemoteCommandSession {
  readonly id: string;
  readonly command: string;
  readonly isRunning: boolean;
  snapshot(): CommandSessionSnapshot;
  write(data: string | Uint8Array): boolean;
  signal(signal: string): void;
  onStdout(listener: (data: Uint8Array) => void): () => void;
  onStderr(listener: (data: Uint8Array) => void): () => void;
  onClose(listener: (event: { exitCode: number | null; signal?: string | null }) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  terminate(options?: { signal?: string; graceMs?: number; forceMs?: number }): Promise<void>;
}

export interface ShellRequest {
  term?: string;
  columns?: number;
  rows?: number;
}

export interface RemoteShellSession {
  readonly isOpen: boolean;
  write(data: string | Uint8Array): boolean;
  resize(columns: number, rows: number): void;
  pause(): void;
  resume(): void;
  onDrain(listener: () => void): () => void;
  onData(listener: (data: Uint8Array) => void): () => void;
  onStderr(listener: (data: Uint8Array) => void): () => void;
  onClose(listener: () => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  close(): void;
}

/**
 * Technology-neutral live machine transport. ssh2 is one Infrastructure implementation.
 * The transport owns all channels created from the underlying connection.
 */
export interface RemoteExecutionTransport {
  readonly connectionId: number;
  readonly isOpen: boolean;
  execute(request: CommandRequest): Promise<CommandResult>;
  startCommand(request: CommandSessionRequest): Promise<RemoteCommandSession>;
  openShell(request?: ShellRequest): Promise<RemoteShellSession>;
  fileSystem(role: RemoteFileSystemRole): Promise<RemoteFileSystem>;
  onClose(listener: () => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
}

export interface RemoteExecutionTransportFactory {
  connect(connection: ResolvedSshConnection, options?: SshConnectOptions): Promise<RemoteExecutionTransport>;
}
