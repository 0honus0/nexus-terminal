import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { RunFailure, RunUnstartedFailure } from './run-types.js';

export interface RunExecutionState {
	id: string;
	status: AgentRunStatus;
	version: number;
}

/** The lifecycle owner cannot read model configuration, prompts or complete application objects. */
export interface RunExecutionJournal {
	getExecutionState(userId: number, appId: string, runId: string): Promise<RunExecutionState | null>;
	rememberFailure(userId: number, appId: string, runId: string, failure: RunFailure): void;
	ownExecutionTask(work: () => Promise<void>): Promise<void>;
}

export interface RunExecutionSettlement {
	failUnstarted(command: RunUnstartedFailure): Promise<boolean>;
}
