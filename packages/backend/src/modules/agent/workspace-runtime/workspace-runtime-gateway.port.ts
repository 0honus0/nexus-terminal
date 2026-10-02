import type { WorkspaceJobView } from '@nexus-terminal/protocol/runner';
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

export interface WorkspaceRuntimeGatewayPort {
  startJob(grant: WorkspaceExecutionGrant, call: WorkspaceJobCall, signal: AbortSignal): Promise<WorkspaceJobView>;
  invoke(grant: WorkspaceExecutionGrant, call: WorkspaceJobCall, signal: AbortSignal): Promise<WorkspaceJobView>;
  queryJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView>;
  waitJob(jobId: string, timeoutMs: number, signal?: AbortSignal): Promise<WorkspaceJobView>;
  cancelJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView>;
}
