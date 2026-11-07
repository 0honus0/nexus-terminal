import type { AgentRun, RunExecutionCommand } from './run-types.js';

export interface ResumeRunRequest {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
	inputJson: string;
}

export type ResumeRunResult =
	| { status: 'resumed'; run: AgentRun }
	| { status: 'replayed'; originalStatus: 'resumed'; run: AgentRun }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' | 'active_run_conflict' };

export type AdmittedRunResume =
	| { status: 'resumed'; run: AgentRun; command: RunExecutionCommand; parentId: string | null }
	| Exclude<ResumeRunResult, { status: 'resumed' }>;

export interface RunSuspension {
	runId: string;
	runVersion: number;
	checkpointVersion: number;
	inputRequest: { id: string; sha256: string; sizeBytes: number; mediaType: string };
	suspendedAt: number;
}
