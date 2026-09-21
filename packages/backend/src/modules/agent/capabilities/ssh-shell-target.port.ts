import type { ToolContext } from './tool.types';

export interface SshShellExecutionResult {
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface SshShellTargetPort {
  execute(
    context: ToolContext,
    connectionId: number,
    command: string,
    timeoutSeconds: number,
    expectedConfigurationHash: string,
  ): Promise<SshShellExecutionResult>;
}
