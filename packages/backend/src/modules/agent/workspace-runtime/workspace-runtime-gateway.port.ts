export interface WorkspaceExecutionGrant {
  workspaceId: string;
  generation: number;
}

export interface WorkspaceJobCall {
  operationHash: string;
  argv: string[];
  cwd: string;
  maxBytes: number;
  timeoutMs: number;
}

export interface WorkspaceJobView {
  jobId: string;
  workspaceId: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  result: {
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
    timedOut: boolean;
  } | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface WorkspaceRuntimeGatewayPort {
  invoke(grant: WorkspaceExecutionGrant, call: WorkspaceJobCall, signal: AbortSignal): Promise<WorkspaceJobView>;
  queryJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView>;
}
