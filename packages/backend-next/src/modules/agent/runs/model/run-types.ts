import type { AgentRunStepFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type {
	AgentRunStatus,
	AgentRunStepState,
	AgentRunStepEventType,
	AgentRunEventType,
	AgentCreateRunOutcome,
	AgentCancelRunOutcome,
} from '@nexus-terminal/shared/agent/runs/values';
import type { ModelReference, FrozenModelInput } from '../../providers/model/provider-types.js';

/** Application command; SQLite's write record is constructed only in this Model. */
export interface CreateRootRunCommand {
	model: ModelReference;
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
	model: ModelReference;
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
	stepIndex: number;
	state: AgentRunStepState;
	revision: number;
	/** Run version recorded on this step; usable for CAS only while the step remains active. */
	runVersion: number;
	textBytes: number;
	finishReason?: 'stop';
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
	now: number;
}

export interface RunStepMutation extends RunStepCommand {
	expectedRevision: number;
}

export type RunStepFinish =
	{ state: 'completed' } | { state: 'failed'; failureCode: AgentRunStepFailureCode } | { state: 'unknown' };

export interface RunStepEvent {
	stepIndex: number;
	sequence: number;
	kind: AgentRunStepEventType;
	textDelta?: string;
	inputTokens?: number;
	outputTokens?: number;
	createdAt: number;
}

export interface RunStepEventPage {
	items: RunStepEvent[];
	nextCursor: number;
}

export interface RunExecutionCommand {
	userId: number;
	appId: string;
	runId: string;
	providerId: string;
	version: number;
	prompt: string;
	requestHash: string;
}

/** An internal Run-owned application projection; it does not grant execution policy. */
export type RunModelDelta =
	| { kind: 'text'; content: string }
	| { kind: 'usage'; inputTokens: number; outputTokens: number }
	| { kind: 'finished'; finishReason: 'stop' };
