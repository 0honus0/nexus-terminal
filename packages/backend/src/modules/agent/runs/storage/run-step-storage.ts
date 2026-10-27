import type { StoredExecutionSettings, StoredExecutionUsage } from '../../execution/storage/execution-storage.js';
import type { AgentRunStepState, AgentRunStepEventType } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunStepFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { StoredFrozenInput } from './run-storage.js';
import type { StoredContextSnapshot, StoredContextToolResult } from '../../context/storage/context-storage.js';
import type { StoredStepProposal } from './run-proposal-types.js';
import type { ProviderStoredRow } from '../../providers/storage/provider-storage.js';

/** Pure authorization decision over current Provider and immutable Run snapshot in one transaction. */
export type RunStepPolicyCheck = (frozen: StoredFrozenInput, currentProvider: ProviderStoredRow | null) => boolean;

/** Durable model request journal owned by the existing Run aggregate. Not a second Run registry. */
export type StoredStepState = AgentRunStepState;

export interface StoredRunStep {
	runId: string;
	stepIndex: number;
	state: StoredStepState;
	revision: number;
	expectedRunVersion: number;
	requestHash: string;
	creationHash: string;
	textBytes: number;
	finishReason?: import('@nexus-terminal/shared/agent/runs/values').AgentRunStepFinishReason;
	proposals: StoredStepProposal[];
	inputTokens?: number;
	outputTokens?: number;
	failureCode?: AgentRunStepFailureCode;
	createdAt: number;
	updatedAt: number;
}

export interface StepScope {
	userId: number;
	appId: string;
	runId: string;
	stepIndex: number;
	expectedRunVersion: number;
	requestHash: string;
	creationHash: string;
	now: number;
}

export interface StepVersionedScope extends StepScope {
	expectedRevision: number;
}

export interface StepReservationScope extends StepScope {
	context: StoredContextSnapshot;
	estimatedTokens: number;
}

export interface UnstartedRunFailure {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	creationHash: string;
	now: number;
}

export type StepWriteResult =
	| { status: 'ok'; step: StoredRunStep }
	| { status: 'not_found' | 'version_conflict' | 'policy_blocked' | 'step_conflict' | 'stale' };

export type StepFinish =
	| { state: 'completed'; finishReason: 'stop'; outputText: string }
	| { state: 'completed'; finishReason: 'tool_calls'; proposals: StoredStepProposal[] }
	| { state: 'failed'; failureCode: AgentRunStepFailureCode }
	| { state: 'unknown' };

export interface StoredRunStepEvent {
	runId: string;
	stepIndex: number;
	sequence: number;
	kind: AgentRunStepEventType;
	textDelta?: string;
	inputTokens?: number;
	outputTokens?: number;
	createdAt: number;
}

export interface RunStepStorage {
	usage(userId: number, appId: string, runId: string): Promise<StoredRunUsage | null>;
	/** Denial cleanup cannot settle an attempt that already has any model step. */
	failUnstarted(command: UnstartedRunFailure): Promise<boolean>;
	endRoot(
		command: StepVersionedScope,
		decide: (hasUnconfirmedEffects: boolean) => 'failed' | 'unknown',
	): Promise<StepWriteResult>;
	/** Runs under the same transaction as Run + frozen snapshot authority checks. */
	reserve(
		command: StepReservationScope,
		authorize: RunStepPolicyCheck,
		verifyResults: (results: StoredContextToolResult[], previewBytes: number) => boolean,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StepWriteResult>;
	/** Commit intent BEFORE network dispatch; recheck frozen policy in this transaction.
	 * An unknown commit is never safe to retry. */
	dispatch(
		command: StepVersionedScope,
		authorize: RunStepPolicyCheck,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StepWriteResult>;
	releaseCapacity(command: StepVersionedScope): Promise<StepWriteResult>;
	appendText(command: StepVersionedScope, text: string): Promise<StepWriteResult>;
	recordUsage(command: StepVersionedScope, inputTokens: number, outputTokens: number): Promise<StepWriteResult>;
	finish(
		command: StepVersionedScope,
		result: StepFinish,
		maySettle: (hasUnsettledTools: boolean, hasUnsettledChildren: boolean) => boolean,
	): Promise<StepWriteResult>;
	get(userId: number, appId: string, runId: string, stepIndex: number): Promise<StoredRunStep | null>;
	/** Startup reconciliation: reserved was not dispatched, dispatched is unknown. */
	reconcileUnsettled(now: number): Promise<number>;
}

export interface StoredRunUsage {
	runId: string;
	runVersion: number;
	inputTokens: number | null;
	outputTokens: number | null;
	reportedModelRequests: number;
	modelRequests: number;
	toolExecutions: number;
}
