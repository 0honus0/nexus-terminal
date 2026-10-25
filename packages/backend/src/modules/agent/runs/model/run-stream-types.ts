import type { ThreadEntryCursor, ThreadEntries } from '../../context/model/context-types.js';
import type { AgentRun, RunUsage, RunEventPage } from './run-types.js';
import type { Approval } from '../../governance/model/governance-types.js';
import type { Participant } from './run-collaboration-types.js';

export interface RunStreamCursor {
	threadId: string;
	entries: ThreadEntryCursor;
	events: number;
}

export interface RunStreamState {
	run: AgentRun;
	usage: RunUsage;
	events: RunEventPage;
	approvals: Approval[];
	children: Participant[];
}

export interface RunStreamPage {
	body: ThreadEntries;
	state: RunStreamState | null;
	more: boolean;
}

export type RunChangeKind = 'text' | 'state';
