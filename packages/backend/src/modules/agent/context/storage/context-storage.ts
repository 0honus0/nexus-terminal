import type { AgentRunStatus, AgentRunStepState } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentToolState } from '@nexus-terminal/shared/agent/tools/values';
import type { StoredStepProposal } from '../../runs/storage/run-proposal-types.js';

export type StoredContextMessage =
	| { role: 'user'; content: string }
	| {
			role: 'assistant';
			content: string;
			proposals: StoredStepProposal[];
			reasoning: { id: string; encryptedContent: string; summary: string[] }[];
	  }
	| { role: 'tool'; providerCallId: string; content: string };

export interface StoredContextSource {
	runId: string;
	version: number;
	sequence: number;
	status: AgentRunStatus;
}

export interface StoredContextSnapshot {
	messages: StoredContextMessage[];
	sources: StoredContextSource[];
}

export interface StoredContextHistoryCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	includeThread: boolean;
}

export interface StoredContextHistoryFacts {
	sources: number;
	runs: number;
	steps: number;
	tools: number;
	bytes: number;
}

export interface StoredContextHistoryTurn {
	source: StoredContextSource;
	input: string;
	steps: {
		index: number;
		state: AgentRunStepState;
		text: string;
		proposals: StoredStepProposal[];
		results: { providerCallId: string; state: AgentToolState; content: string | null }[];
	}[];
}

export interface ContextStorage {
	readEntries(
		userId: number,
		appId: string,
		threadId: string,
		after: StoredThreadEntryCursor,
		limit: number,
	): Promise<StoredThreadEntries | null>;
	readHistory(
		command: StoredContextHistoryCommand,
		admit: (facts: StoredContextHistoryFacts) => void,
	): Promise<StoredContextHistoryBundle | null>;
}

export interface StoredThreadEntryCursor {
	runSequence: number;
	stepIndex: number;
	eventSequence: number;
	textOffset: number;
}

export interface StoredThreadEntries {
	appId: string;
	threadId: string;
	items: { runId: string; role: 'user' | 'assistant'; position: StoredThreadEntryCursor; text: string }[];
	nextCursor: StoredThreadEntryCursor;
}

/** Same-transaction completed tool facts for application projection verification. */
export interface StoredContextToolResult {
	id: string;
	providerCallId: string;
	content: string;
}

export interface StoredContextHistoryBundle {
	sources: StoredContextSource[];
	turns: StoredContextHistoryTurn[];
	summary: { content: string; coveredRuns: number } | null;
}
