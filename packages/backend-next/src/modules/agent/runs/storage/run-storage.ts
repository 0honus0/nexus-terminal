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
	executionPolicy: 'awaiting_b6_b7';
}

/** Storage contracts: no HTTP DTO or SQLite row escapes. */
export interface StoredRun {
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
	model: StoredModelReference;
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	inputText: string;
	operationKey: string;
	requestHash: string;
	createdAt: number;
}

export interface CancelRunStorageCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
	requestHash: string;
	now: number;
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

export interface RunStorage {
	frozen(userId: number, appId: string, runId: string): Promise<StoredFrozenInput | null>;
	create(
		command: CreateRunStorageCommand,
		mayCreate: (active: StoredRun | null) => boolean,
		resolve: (provider: ProviderStoredRow, reference: StoredModelReference) => StoredFrozenInput | null,
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
