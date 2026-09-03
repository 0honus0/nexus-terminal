import type { ResolvedSshConnection, SshConnectOptions } from '../connection/ssh-connection';

export interface CommandRequest {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RemoteExecutionTransport {
  readonly connectionId: number;
  execute(request: CommandRequest): Promise<CommandResult>;
  close(): Promise<void>;
}

export interface RemoteExecutionTransportFactory {
  connect(connection: ResolvedSshConnection, options?: SshConnectOptions): Promise<RemoteExecutionTransport>;
}
