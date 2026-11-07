import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentOperationKind, AgentOperationState } from '@nexus-terminal/shared/agent/operations/values';
import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import type { StoredExecutionSettings, StoredExecutionUsage } from '../../execution/storage/execution-storage.js';

export interface StoredOperationScope {
	userId: number;
	appId: string;
	runId: string;
	executionGeneration: string;
}

export interface StoredOperation {
	id: string;
	sequence: number;
	scope: StoredOperationScope;
	parentId: string | null;
	callerId: string;
	operationKey: string;
	requestHash: string;
	kind: AgentOperationKind;
	label: string;
	bindingJson: string;
	argumentsJson: string;
	state: AgentOperationState;
	revision: number;
	resultJson: string | null;
	failureCode: AgentOperationErrorCode | null;
	createdAt: number;
	updatedAt: number;
}

export interface StoredOperationIntent {
	id: string;
	scope: StoredOperationScope;
	parentId: string | null;
	callerId: string;
	operationKey: string;
	requestHash: string;
	now: number;
}

export interface StoredOperationPreparation {
	record: boolean;
	kind: AgentOperationKind;
	label: string;
	bindingJson: string;
	argumentsJson: string;
}

export interface StoredOperationDispatchAuthority {
	policyRevision: number;
	policyExecutionVersion: number;
	denylistRevision: number;
	settingsVersion: number;
	instance: {
		id: string;
		packageId: string;
		generation: string;
		configurationRevision: number;
		packageRevision: number;
	};
	ancestors: {
		id: string;
		packageId: string;
		generation: string;
		configurationRevision: number;
		packageRevision: number;
	}[];
	provider: { id: string; version: number; credentialRevision: number } | null;
	target: { id: number; version: number } | null;
	modelReservation: { tokens: number } | null;
	approval: { id: string; version: number } | null;
}

export type StoredOperationAdmission =
	| { status: 'accepted' | 'replayed'; operation: StoredOperation }
	| { status: 'ephemeral' }
	| { status: 'scope_closed' }
	| { status: 'idempotency_conflict' };

export type StoredOperationMutation =
	| { status: 'ok'; operation: StoredOperation }
	| { status: 'not_found' | 'version_conflict' | 'scope_closed' | 'children_pending' };

export type StoredOperationTerminal =
	| { state: 'completed'; resultJson: string }
	| { state: 'failed'; failureCode: AgentOperationErrorCode }
	| { state: 'cancelled' | 'unknown' };

export interface OperationStorage {
	open(scope: StoredOperationScope, expectedRunVersion: number, creationHash: string, now: number): Promise<boolean>;
	closeAdmission(scope: StoredOperationScope, now: number): Promise<boolean>;
	closed(scope: StoredOperationScope, now: number): Promise<boolean>;
	admit(intent: StoredOperationIntent, prepare: () => StoredOperationPreparation): Promise<StoredOperationAdmission>;
	get(scope: StoredOperationScope, callerId: string, operationKey: string): Promise<StoredOperation | null>;
	verifyEffect(
		scope: StoredOperationScope,
		id: string,
		requestHash: string,
		label: string,
		allowCompleted: boolean,
	): Promise<boolean>;
	evidence(
		scope: StoredOperationScope,
		id: string,
	): Promise<
		{
			operation: StoredOperation;
			authority: StoredOperationDispatchAuthority | null;
			capabilities: AgentCapability[];
		}[]
	>;
	confirmArtifacts(
		scope: StoredOperationScope,
		id: string,
		requestHash: string,
		artifactIds: readonly string[],
	): Promise<void>;
	dispatch(
		scope: StoredOperationScope,
		id: string,
		revision: number,
		authority: StoredOperationDispatchAuthority,
		now: number,
		admitBudget: (
			settings: StoredExecutionSettings,
			usage: StoredExecutionUsage,
			kind: AgentOperationKind,
			reservedTokens: number | null,
		) => void,
	): Promise<StoredOperationMutation>;
	finish(
		scope: StoredOperationScope,
		id: string,
		revision: number,
		terminal: StoredOperationTerminal,
		now: number,
	): Promise<StoredOperationMutation>;
	interrupt(now: number): Promise<void>;
}
