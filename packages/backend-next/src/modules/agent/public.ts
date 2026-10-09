/** Deliberately limited Agent state API. Execution/Provider/tools are not exposed. */
export interface AgentAppView {
	id: string;
	name: string;
	createdAt: number;
}

export interface AgentThreadView {
	id: string;
	appId: string;
	title: string;
	createdAt: number;
}

export interface AgentRunView {
	id: string;
	appId: string;
	threadId: string;
	status: 'pending' | 'cancelled';
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentRunEventView {
	runId: string;
	sequence: number;
	type: 'run.created' | 'run.cancelled';
	runVersion: number;
	createdAt: number;
}

export interface AgentEventPageView {
	items: AgentRunEventView[];
	nextCursor: number;
}

export type AgentCreateRunResult =
	| { status: 'created'; run: AgentRunView }
	| { status: 'replayed'; originalStatus: 'created'; run: AgentRunView }
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' };

export type AgentCancelRunResult =
	| { status: 'cancelled' | 'already_cancelled'; run: AgentRunView }
	| { status: 'replayed'; originalStatus: 'cancelled' | 'already_cancelled'; run: AgentRunView }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' };

export interface AgentStateApi {
	createApp(userId: number, name: string): Promise<AgentAppView>;
	createThread(userId: number, appId: string, title: string): Promise<AgentThreadView | null>;
	createRun(input: {
		userId: number;
		appId: string;
		threadId: string;
		prompt: string;
		operationKey: string;
	}): Promise<AgentCreateRunResult>;
	cancelRun(input: {
		userId: number;
		appId: string;
		runId: string;
		expectedVersion: number;
		operationKey: string;
	}): Promise<AgentCancelRunResult>;
	getRun(userId: number, appId: string, runId: string): Promise<AgentRunView | null>;
	listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<AgentEventPageView | null>;
}
