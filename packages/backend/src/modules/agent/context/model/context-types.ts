import type { AgentRunStatus, AgentRunStepState } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentToolState } from '@nexus-terminal/shared/agent/tools/values';
import type { RunModelMessage, RunToolProposal, RunReasoningState } from '../../runs/model/run-types.js';

/** A causal group becomes visible only after every proposal has one settled result. */
export interface ContextExchange {
	content: string;
	proposals: RunToolProposal[];
	reasoning: RunReasoningState[];
	results: { providerCallId: string; content: string }[];
}

export interface ContextLimits {
	contextWindow?: number;
	reservedOutputTokens: number;
}

export interface ContextSource {
	runId: string;
	version: number;
	sequence: number;
	status: AgentRunStatus;
}

export interface ContextSnapshot {
	messages: RunModelMessage[];
	sources: ContextSource[];
}

export interface ContextHistoryCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	includeThread: boolean;
}

export interface ContextHistoryFacts {
	sources: number;
	runs: number;
	steps: number;
	tools: number;
	bytes: number;
}

export interface ContextHistoryTurn {
	source: ContextSource;
	input: string;
	steps: {
		index: number;
		state: AgentRunStepState;
		text: string;
		proposals: RunToolProposal[];
		results: { providerCallId: string; state: AgentToolState; content: string | null }[];
	}[];
}

export interface ResultReadInput {
	toolCallId: string;
	sha256: string;
	offset: number;
	maxBytes: number;
}

export interface ResultPage {
	toolCallId: string;
	sha256: string;
	originalBytes: number;
	offset: number;
	nextOffset: number | null;
	text: string;
}

export interface ResultReadOutcome {
	page: ResultPage;
	targets: { id: number; version: number }[];
}

export interface ContextHistoryBundle {
	sources: ContextSource[];
	turns: ContextHistoryTurn[];
	summary: { content: string; coveredRuns: number } | null;
}

export interface ThreadEntryCursor {
	runSequence: number;
	stepIndex: number;
	eventSequence: number;
	textOffset: number;
}

export interface ThreadEntries {
	appId: string;
	threadId: string;
	items: { runId: string; role: 'user' | 'assistant'; position: ThreadEntryCursor; text: string }[];
	nextCursor: ThreadEntryCursor;
}

export interface ContextUsageAnchor {
	messages: RunModelMessage[];
	definitions: string;
	tokens: number;
}

export interface CompactionCommand {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	stepIndex: number;
	expectedRunVersion: number;
	creationHash: string;
	requestHash: string;
	now: number;
	snapshot: ContextSnapshot;
	cut: number;
	estimatedTokens: number;
}

export interface CompactionResult {
	id: string;
	summary: string;
	source: RunModelMessage[];
	cut: number;
}
