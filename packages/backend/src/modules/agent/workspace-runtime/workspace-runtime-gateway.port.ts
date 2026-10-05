import type { WorkspaceJobView, WorkspaceActiveJobsView } from '@nexus-terminal/protocol/runner';
export interface WorkspaceExecutionGrant {
  workspaceId: string;
  generation: number;
}

export interface WorkspaceJobCall {
  maxConcurrentJobs: number;
  executionId: string;
  argv: string[];
  cwd: string;
  maxBytes: number;
  timeoutMs: number;
}

export interface WorkspaceRuntimeGatewayPort {
  listActiveJobs(grant: WorkspaceExecutionGrant, signal: AbortSignal): Promise<WorkspaceActiveJobsView>;
  startJob(grant: WorkspaceExecutionGrant, call: WorkspaceJobCall, signal: AbortSignal): Promise<WorkspaceJobView>;
  invoke(grant: WorkspaceExecutionGrant, call: WorkspaceJobCall, signal: AbortSignal): Promise<WorkspaceJobView>;
  queryJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView>;
  waitJob(jobId: string, timeoutMs: number, signal?: AbortSignal): Promise<WorkspaceJobView>;
  cancelJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView>;
}
