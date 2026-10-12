import type { AgentRunStepState, AgentRunStepEventType } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunStepFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { StoredFrozenInput } from './run-storage.js';
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
	textBytes: number;
	finishReason?: 'stop';
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
	now: number;
}

export interface StepVersionedScope extends StepScope {
	expectedRevision: number;
}

export type StepWriteResult =
	| { status: 'ok'; step: StoredRunStep }
	| { status: 'not_found' | 'version_conflict' | 'policy_blocked' | 'step_conflict' | 'stale' };

export type StepFinish =
	{ state: 'completed' } | { state: 'failed'; failureCode: AgentRunStepFailureCode } | { state: 'unknown' };

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

export interface StoredRunStepEventPage {
	items: StoredRunStepEvent[];
	nextCursor: number;
}

export interface RunStepStorage {
	/** Runs under the same transaction as Run + frozen snapshot authority checks. */
	reserve(command: StepScope, authorize: RunStepPolicyCheck): Promise<StepWriteResult>;
	/** Commit intent BEFORE network dispatch; recheck frozen policy in this transaction.
	 * An unknown commit is never safe to retry. */
	dispatch(command: StepVersionedScope, authorize: RunStepPolicyCheck): Promise<StepWriteResult>;
	appendText(command: StepVersionedScope, text: string): Promise<StepWriteResult>;
	recordUsage(command: StepVersionedScope, inputTokens: number, outputTokens: number): Promise<StepWriteResult>;
	finish(command: StepVersionedScope, result: StepFinish): Promise<StepWriteResult>;
	get(userId: number, appId: string, runId: string, stepIndex: number): Promise<StoredRunStep | null>;
	listEvents(
		userId: number,
		appId: string,
		runId: string,
		stepIndex: number,
		after: number,
		limit: number,
	): Promise<StoredRunStepEventPage | null>;
	/** Startup reconciliation: reserved was not dispatched, dispatched is unknown. */
	reconcileUnsettled(now: number): Promise<number>;
}
