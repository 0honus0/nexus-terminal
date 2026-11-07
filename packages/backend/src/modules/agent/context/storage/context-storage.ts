import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
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
	systemPrompt: string;
	messages: StoredContextMessage[];
	sources: StoredContextSource[];
}

/** Transient source-bound projection evidence; never part of persisted context JSON. */
export interface StoredContextCheckpointProjection {
	checkpointId: string;
	sourceHash: string;
	sourceMessages: number;
	rawSummary: string;
	renderedSummary: string;
}

export interface ContextStorage {
	readPreviousEntries(
		userId: number,
		appId: string,
		threadId: string,
		before: StoredThreadEntryCursor | null,
		limit: number,
	): Promise<StoredThreadEntryHistory | null>;
	readEntries(
		userId: number,
		appId: string,
		threadId: string,
		after: StoredThreadEntryCursor,
		limit: number,
	): Promise<StoredThreadEntries | null>;
}

export interface StoredThreadEntryCursor {
	runSequence: number;
	messageOrdinal: number;
	chunkIndex: number;
	textOffset: number;
}

export interface StoredThreadEntries {
	appId: string;
	threadId: string;
	items: {
		runId: string;
		operationSequence: number;
		role: 'user' | 'assistant';
		position: StoredThreadEntryCursor;
		text: string;
	}[];
	nextCursor: StoredThreadEntryCursor;
}

export interface StoredThreadEntryHistory {
	body: StoredThreadEntries;
	startCursor: StoredThreadEntryCursor;
	hasEarlier: boolean;
}
