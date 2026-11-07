import type { AgentThread } from '../../scope/model/scope-types.js';
import type { ThreadEntryCursor, ThreadEntries } from '../../context/model/context-types.js';
import type { AgentRun, RunUsage, RunEventPage } from './run-types.js';
import type { OperationApprovalPage } from '../../governance/model/operation-approval-types.js';
import type { Participant } from './run-collaboration-types.js';

export interface RunStreamCursor {
	threadId: string;
	entries: ThreadEntryCursor;
	events: number;
	approvals: string | null;
}

export interface RunStreamState {
	thread: AgentThread;
	run: AgentRun;
	usage: RunUsage;
	events: RunEventPage;
	approvals: OperationApprovalPage;
	children: Participant[];
	resources: import('./run-resource-types.js').RunResourceSnapshot[];
}

export interface RunStreamPage {
	body: ThreadEntries;
	state: RunStreamState | null;
	more: boolean;
}

export type RunChangeKind = 'text' | 'state';

export interface RunChangeScope {
	userId: number;
	appId: string;
	/** Omitted only for application-wide invalidation or an outcome with no confirmed Run identity. */
	runId?: string;
	threadId?: string;
}
