import type { AgentApprovalMode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { StoredPolicyOverrides } from '../../governance/storage/governance-storage.js';
import type { StoredExecutionSettings } from '../../execution/storage/execution-storage.js';
import type { StoredAppAuthority } from '../../scope/storage/scope-storage.js';
import type {
	AgentRunStatus,
	AgentRunEventType,
	AgentCreateRunOutcome,
	AgentCancelRunOutcome,
} from '@nexus-terminal/shared/agent/runs/values';
import type {
	StoredModelReference,
	StoredProviderModel,
	ProviderStoredRow,
} from '../../providers/storage/provider-storage.js';
import type { AgentProviderProtocol } from '@nexus-terminal/shared/agent/providers/values';

/** Storage projection; RunModel converts persisted capability text to an application value. */
export interface StoredFrozenInput {
	providerId: string;
	providerVersion: number;
	credentialRevision: number;
	modelId: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	capabilities: StoredProviderModel;
	executionPolicy: 'governed';
}

/** Storage contracts: no HTTP DTO or SQLite row escapes. */
export interface StoredRun {
	approvalMode: AgentApprovalMode;
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	status: AgentRunStatus;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface CreateRunStorageCommand {
	approvalMode: AgentApprovalMode;
	origin: { runId: string; expectedVersion: number } | null;
	model: StoredModelReference;
	connectionIds: number[];
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	inputText: string;
	operationKey: string;
	requestHash: string;
}

export interface CancelRunStorageCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
	requestHash: string;
}

export type StoredCreateResult =
	| { status: AgentCreateRunOutcome; run: StoredRun }
	| { status: 'replayed'; originalStatus: AgentCreateRunOutcome; run: StoredRun }
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' | 'provider_unavailable' };

export type StoredCancelResult =
	| { status: AgentCancelRunOutcome; run: StoredRun }
	| { status: 'replayed'; originalStatus: AgentCancelRunOutcome; run: StoredRun }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' | 'active_run_conflict' };

export interface StoredRunEvent {
	runId: string;
	sequence: number;
	type: AgentRunEventType;
	runVersion: number;
	createdAt: number;
}

export interface RunEventPageRecord {
	items: StoredRunEvent[];
	nextCursor: number;
}

export type StoredCancelRunDecision = 'cancel' | 'already_cancelled' | 'version_conflict' | 'active_run_conflict';

export interface StoredRunFailure {
	code: AgentRunFailureCode;
	toolName: string;
}

export interface RunStorage {
	failure(userId: number, appId: string, runId: string): Promise<StoredRunFailure | null>;
	ownExecution(work: () => Promise<void>): Promise<void>;
	list(
		userId: number,
		appId: string,
		threadId: string,
		after: number,
		limit: number,
	): Promise<{ items: StoredRun[]; nextCursor: number } | null>;
	frozen(userId: number, appId: string, runId: string): Promise<StoredFrozenInput | null>;
	create(
		command: CreateRunStorageCommand,
		mayCreate: (active: StoredRun | null) => boolean,
		resolve: (provider: ProviderStoredRow, reference: StoredModelReference) => StoredFrozenInput | null,
		authorizeApp: (current: StoredAppAuthority) => void,
		authorizeOrigin: (current: StoredRun | null) => void,
		freezeExecution: (
			current: StoredExecutionSettings | null,
			activeRuns: number,
			overrides: StoredPolicyOverrides,
		) => StoredExecutionSettings,
	): Promise<StoredCreateResult>;
	cancel(
		command: CancelRunStorageCommand,
		decide: (run: StoredRun) => StoredCancelRunDecision,
	): Promise<StoredCancelResult>;
	get(userId: number, appId: string, runId: string): Promise<StoredRun | null>;
	listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<RunEventPageRecord | null>;
}
