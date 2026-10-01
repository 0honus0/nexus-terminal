import type { ToolContext } from './tool.types';

export interface SshJobView {
  jobId: string;
  sessionId: string;
  connectionId: number;
  configurationHash: string;
  status: 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  result: {
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
    timedOut: boolean;
  };
  createdAt: number;
  completedAt: number | null;
}

export interface AgentSshSessionView {
  sessionId: string;
  connectionId: number;
  status: 'ready' | 'disconnected';
  activeOperations: number;
  createdAt: number;
  lastUsedAt: number;
  idleTimeoutSeconds: number;
}

export interface AgentSshSessionPort {
  open(
    context: ToolContext,
    connectionId: number,
    configurationHash: string,
    idleTimeoutSeconds: number,
  ): Promise<AgentSshSessionView>;
  list(context: ToolContext, connectionId: number, sessionId?: string): Promise<AgentSshSessionView[]>;
  close(context: ToolContext, connectionId: number, sessionId: string, force: boolean): Promise<void>;
  startJob(
    context: ToolContext,
    connectionId: number,
    configurationHash: string,
    sessionId: string,
    command: string,
    timeoutSeconds: number,
    operationHash: string,
  ): Promise<SshJobView>;
  job(
    context: ToolContext,
    connectionId: number,
    jobId: string,
    action: 'status' | 'wait' | 'cancel',
    waitSeconds?: number,
  ): Promise<SshJobView>;
}
