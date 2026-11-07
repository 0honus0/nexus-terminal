import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentOperationKind, AgentOperationState } from '@nexus-terminal/shared/agent/operations/values';
import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import type { ExecutionSettings, ExecutionUsage } from '../../execution/model/execution-types.js';

export type OperationBudgetAdmission = (
	settings: ExecutionSettings,
	usage: ExecutionUsage,
	kind: AgentOperationKind,
	reservedTokens: number | null,
) => void;

export interface OperationScope {
	userId: number;
	appId: string;
	runId: string;
	executionGeneration: string;
}

export interface OperationReceipt {
	id: string;
	sequence: number;
	scope: OperationScope;
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

export interface OperationEvidence {
	capabilities: AgentCapability[];
	operation: OperationReceipt;
	authority: OperationDispatchAuthority | null;
}

export interface OperationIntent {
	scope: OperationScope;
	parentId: string | null;
	callerId: string;
	operationKey: string;
	requestHash: string;
}

export interface OperationPreparation {
	record: boolean;
	kind: AgentOperationKind;
	label: string;
	bindingJson: string;
	argumentsJson: string;
}

/** Trusted snapshots are compared again in the transaction that records dispatch. */
export interface OperationDispatchAuthority {
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

export type OperationAdmission =
	| { status: 'accepted' | 'replayed'; operation: OperationReceipt }
	| { status: 'ephemeral' }
	| { status: 'scope_closed' }
	| { status: 'idempotency_conflict' };

export type OperationMutation =
	| { status: 'ok'; operation: OperationReceipt }
	| { status: 'not_found' | 'version_conflict' | 'scope_closed' | 'children_pending' };

export type OperationTerminal =
	| { state: 'completed'; resultJson: string }
	| { state: 'failed'; failureCode: AgentOperationErrorCode }
	| { state: 'cancelled' | 'unknown' };

export interface PreparedOperation extends OperationPreparation {
	/** Set by the trusted effect owner, never by a plugin registration. */
	mayHaveExternalEffect: boolean;
	validate(): Promise<void>;
	authorize(operation: OperationReceipt | null): Promise<OperationDispatchAuthority>;
	execute(operation: OperationReceipt | null, signal: AbortSignal): Promise<string>;
}

export interface OperationExecution {
	intent: OperationIntent;
	/** Called only for a genuinely new admission, after receipt lookup. */
	prepare(): PreparedOperation | Promise<PreparedOperation>;
	signal: AbortSignal;
}

export type OperationExecutionResult =
	{ kind: 'receipt'; receipt: OperationReceipt } | { kind: 'ephemeral'; resultJson: string };
