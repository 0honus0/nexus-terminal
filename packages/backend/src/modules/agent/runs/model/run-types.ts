import type { AgentApprovalMode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunStepFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type {
	AgentRunStatus,
	AgentRunStepState,
	AgentRunEventType,
	AgentCreateRunOutcome,
	AgentCancelRunOutcome,
} from '@nexus-terminal/shared/agent/runs/values';
import type { ModelReference, FrozenModelInput } from '../../providers/model/provider-types.js';

export interface RunToolProposal {
	providerCallId: string;
	toolName: string;
	argumentsJson: string;
}

export interface RunReasoningState {
	id: string;
	encryptedContent: string;
	summary: string[];
}

export type RunModelMessage =
	| { role: 'user'; content: string }
	| { role: 'assistant'; content: string; proposals: RunToolProposal[]; reasoning: RunReasoningState[] }
	| { role: 'tool'; providerCallId: string; content: string };

/** Application command; SQLite's write record is constructed only in this Model. */
export interface CreateRootRunCommand {
	approvalMode: AgentApprovalMode;
	origin: { runId: string; expectedVersion: number } | null;
	model: ModelReference;
	connectionIds: number[];
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
	requestHash: string;
}

export interface CancelRootRunCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
	requestHash: string;
}

export interface RunFailure {
	code: AgentRunFailureCode;
	toolName: string | null;
}

export interface AgentRun {
	approvalMode: AgentApprovalMode;
	failure: RunFailure | null;
	id: string;
	appId: string;
	threadId: string;
	status: AgentRunStatus;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentRunEvent {
	runId: string;
	sequence: number;
	type: AgentRunEventType;
	runVersion: number;
	createdAt: number;
}

export type CreateRunResult =
	| { status: AgentCreateRunOutcome; run: AgentRun }
	| { status: 'replayed'; originalStatus: AgentCreateRunOutcome; run: AgentRun }
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' | 'provider_unavailable' };

export type CancelRunResult =
	| { status: AgentCancelRunOutcome; run: AgentRun }
	| { status: 'replayed'; originalStatus: AgentCancelRunOutcome; run: AgentRun }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' | 'active_run_conflict' };

export interface RunEventPage {
	items: AgentRunEvent[];
	nextCursor: number;
}

export interface CreateRunRequest {
	approvalMode: AgentApprovalMode;
	model: ModelReference;
	connectionIds: number[];
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
}

export interface CancelRunRequest {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
}

export interface RootRunState {
	status: AgentRunStatus;
	version: number;
}

export type CancelRootRunDecision = 'cancel' | 'already_cancelled' | 'version_conflict' | 'active_run_conflict';

export type RunFrozenInput = FrozenModelInput;

/** Run-owned internal model-step application contracts; not persisted rows or Shared wire. */
export interface RunModelStep {
	runId: string;
	requestHash: string;
	stepIndex: number;
	state: AgentRunStepState;
	revision: number;
	/** Run version recorded on this step; usable for CAS only while the step remains active. */
	runVersion: number;
	textBytes: number;
	finishReason?: import('@nexus-terminal/shared/agent/runs/values').AgentRunStepFinishReason;
	proposals: RunToolProposal[];
	inputTokens?: number;
	outputTokens?: number;
	failureCode?: AgentRunStepFailureCode;
	createdAt: number;
	updatedAt: number;
}

export type RunModelStepResult =
	| { status: 'ok'; step: RunModelStep }
	| { status: 'not_found' | 'version_conflict' | 'policy_blocked' | 'step_conflict' | 'stale' };

export interface RunStepCommand {
	userId: number;
	appId: string;
	runId: string;
	stepIndex: number;
	expectedRunVersion: number;
	requestHash: string;
	creationHash: string;
	now: number;
}

export interface RunStepMutation extends RunStepCommand {
	expectedRevision: number;
}

export type RunStepFinish =
	| { state: 'completed'; finishReason: 'stop'; outputText: string }
	| { state: 'completed'; finishReason: 'tool_calls'; proposals: RunToolProposal[] }
	| { state: 'failed'; failureCode: AgentRunStepFailureCode }
	| { state: 'unknown' };

export interface RunExecutionCommand {
	deadlineAt: number;
	userId: number;
	appId: string;
	runId: string;
	providerId: string;
	version: number;
	prompt: string;
	requestHash: string;
}

export interface RunUnstartedFailure {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	creationHash: string;
	now: number;
}

/** An internal Run-owned application projection; it does not grant execution policy. */
export type RunModelDelta =
	| { kind: 'text'; content: string }
	| { kind: 'usage'; inputTokens: number; outputTokens: number }
	| { kind: 'finished'; finishReason: 'stop' }
	| { kind: 'finished'; finishReason: 'tool_calls'; proposals: RunToolProposal[]; reasoning: RunReasoningState[] };

export interface RunAppAuthority {
	enabled: boolean;
	declared: boolean;
}

export interface RunRevocationRequest {
	userId: number | null;
	appId: string | null;
	uncertain: boolean;
}

export type RevokeRuns = (request: RunRevocationRequest) => Promise<void>;

export interface RunPage {
	items: AgentRun[];
	nextCursor: number;
}

export interface RunUsage {
	runId: string;
	runVersion: number;
	inputTokens: number | null;
	outputTokens: number | null;
	reportedModelRequests: number;
	modelRequests: number;
	toolExecutions: number;
}
