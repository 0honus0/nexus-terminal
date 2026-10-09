/** Application command; SQLite's write record is constructed only in this Model. */
export interface CreateRootRunCommand {
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
	requestHash: string;
	createdAt: number;
}

export interface CancelRootRunCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
	requestHash: string;
	requestedAt: number;
}

export interface AgentRun {
	id: string;
	appId: string;
	threadId: string;
	status: 'pending' | 'cancelled';
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentRunEvent {
	runId: string;
	sequence: number;
	type: 'run.created' | 'run.cancelled';
	runVersion: number;
	createdAt: number;
}

export type CreateRunResult =
	| { status: 'created'; run: AgentRun }
	| { status: 'replayed'; originalStatus: 'created'; run: AgentRun }
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' };

export type CancelRunResult =
	| { status: 'cancelled' | 'already_cancelled'; run: AgentRun }
	| { status: 'replayed'; originalStatus: 'cancelled' | 'already_cancelled'; run: AgentRun }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' };

export interface RunEventPage {
	items: AgentRunEvent[];
	nextCursor: number;
}
