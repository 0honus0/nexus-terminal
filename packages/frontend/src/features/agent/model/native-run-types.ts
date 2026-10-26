import type { AgentApprovalMode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentProviderProtocol, AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
import type {
	AgentRunStatus,
	AgentRunEventType,
	AgentRunStepState,
	AgentRunStepFinishReason,
	AgentRunStepFailureCode,
} from '@nexus-terminal/shared/agent/runs/values';
import type {
	AgentApprovalStatus,
	AgentApprovalKind,
	AgentApprovalRisk,
	AgentApprovalDecision,
	AgentCapability,
} from '@nexus-terminal/shared/agent/governance/values';
import type { AgentChildProfile } from '@nexus-terminal/shared/agent/collaboration/values';
import type { AgentToolState } from '@nexus-terminal/shared/agent/tools/values';
import type { NativeThreadScope } from './native-thread-types';

export interface NativeModel {
	providerId: string;
	providerName: string;
	configurationVersion: number;
	modelId: string;
	protocol: AgentProviderProtocol;
	reasoningEfforts: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory: boolean;
}

export interface NativeRunFailure {
	code: AgentRunFailureCode;
	toolName: string | null;
}

export interface NativeRun {
	approvalMode: AgentApprovalMode;
	failure: NativeRunFailure | null;
	id: string;
	appId: string;
	threadId: string;
	status: AgentRunStatus;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface NativeEntryCursor {
	runSequence: number;
	stepIndex: number;
	eventSequence: number;
	textOffset: number;
}

export interface NativeEntry {
	runId: string;
	role: 'user' | 'assistant';
	position: NativeEntryCursor;
	text: string;
}

/** Display message anchored to its first fragment; transport progress stays in the separate entry cursor. */
export interface NativeConversationEntry {
	runId: string;
	role: 'user' | 'assistant';
	position: NativeEntryCursor;
	text: string;
}

export interface NativeEvent {
	runId: string;
	sequence: number;
	type: AgentRunEventType;
	runVersion: number;
	createdAt: number;
}

export interface NativeApproval {
	id: string;
	appId: string;
	runId: string;
	toolCallId: string;
	operationHash: string;
	kind: AgentApprovalKind;
	status: AgentApprovalStatus;
	policyRevision: number;
	inputRevision: number;
	version: number;
	requestedAt: number;
	expiresAt: number;
	decidedAt: number | null;
	decidedByUserId: number | null;
	consumedAt: number | null;
	inspection: {
		toolName: string;
		toolVersion: string;
		risk: AgentApprovalRisk;
		mutation: boolean;
		targetConnectionId: number | null;
		summary: string;
	};
}

export interface NativeChild {
	id: string;
	parentId: string;
	status: AgentRunStatus;
	version: number;
	profile: AgentChildProfile;
	deadlineAt: number;
}

export interface NativeMessage {
	sequence: number;
	senderId: string;
	bodyBytes: number;
	expiresAt: number;
}

export interface NativeRunInput {
	approvalMode: AgentApprovalMode;
	reasoningEffort?: AgentReasoningEffort;
	prompt: string;
	connectionIds: number[];
	model: NativeModel;
}

export type NativeRunAction =
	| { kind: 'create'; threadId: string; input: NativeRunInput }
	| { kind: 'append'; run: NativeRun; input: NativeRunInput }
	| { kind: 'cancel'; run: NativeRun }
	| { kind: 'cancelChild'; run: NativeRun; child: NativeChild }
	| { kind: 'approve'; approval: NativeApproval; decision: AgentApprovalDecision; feedback: string };

/** Local submission display only; never a server entry or transport cursor. */
export interface NativeSubmittedMessage {
	operationId: string;
	threadId: string;
	runId: string | null;
	text: string;
}

export interface NativeRunIntent {
	scope: NativeThreadScope;
	operationId: string;
	action: NativeRunAction;
}

export type NativeRunConfirmation = { kind: 'run'; run: NativeRun } | { kind: 'approval'; approval: NativeApproval };

export interface NativeStep {
	runId: string;
	stepIndex: number;
	state: AgentRunStepState;
	revision: number;
	runVersion: number;
	textBytes: number;
	finishReason?: AgentRunStepFinishReason;
	inputTokens?: number;
	outputTokens?: number;
	failureCode?: AgentRunStepFailureCode;
	createdAt: number;
	updatedAt: number;
}

export type NativeStepEvent =
	| { runId: string; stepIndex: number; sequence: number; kind: 'text.delta'; textBytes: number; createdAt: number }
	| {
			runId: string;
			stepIndex: number;
			sequence: number;
			kind: 'usage';
			inputTokens: number;
			outputTokens: number;
			createdAt: number;
	  }
	| {
			runId: string;
			stepIndex: number;
			sequence: number;
			kind: 'step.completed' | 'step.failed' | 'step.unknown';
			createdAt: number;
	  };

export interface NativeTool {
	id: string;
	appId: string;
	runId: string;
	modelStepIndex: number;
	toolName: string;
	toolVersion: string;
	capability: AgentCapability;
	targetId: number | null;
	targetVersion: number | null;
	risk: AgentApprovalRisk;
	mutation: boolean;
	summary: string;
	operationHash: string;
	operationRevision: number;
	revision: number;
	state: AgentToolState;
	createdAt: number;
	updatedAt: number;
}

export interface NativeToolEvent {
	toolCallId: string;
	runId: string;
	revision: number;
	operationRevision: number;
	state: AgentToolState;
	operationHash: string;
	createdAt: number;
}

export interface NativePage<T, Cursor> {
	items: T[];
	nextCursor: Cursor;
}

export interface NativeRunSubscription {
	close(): void;
	resume(): void;
}

export interface NativeRunUsage {
	runId: string;
	runVersion: number;
	inputTokens: number | null;
	outputTokens: number | null;
	reportedModelRequests: number;
	modelRequests: number;
	toolExecutions: number;
}

export interface NativeRunStreamCursor {
	threadId: string;
	entries: NativeEntryCursor;
	events: number;
	runVersion: number;
}

export interface NativeRunUpdate {
	body: NativePage<NativeEntry, NativeEntryCursor>;
	state: {
		thread: import('./native-thread-types').NativeThread;
		run: NativeRun;
		usage: NativeRunUsage;
		events: NativePage<NativeEvent, number>;
		approvals: NativeApproval[];
		children: NativeChild[];
	} | null;
	more: boolean;
}
