import type { Scope } from '../agent.types';

export interface EnvironmentExecutionGrant extends Scope {
  environmentId: string;
  groupId: string;
  runId: string;
  agentRuntimeId: string;
  generation: number;
}

export interface EnvironmentJobCall {
  operationHash: string;
  argv: string[];
  cwd: string;
  maxBytes: number;
  timeoutMs: number;
}

export interface EnvironmentJobView {
  jobId: string;
  environmentId: string;
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

export interface EnvironmentGatewayPort {
  invoke(grant: EnvironmentExecutionGrant, call: EnvironmentJobCall, signal: AbortSignal): Promise<EnvironmentJobView>;
  queryJob(jobId: string, signal?: AbortSignal): Promise<EnvironmentJobView>;
}
