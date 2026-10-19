import type { AgentProviderProtocol, AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
import type { SqlExecutor } from '../../../../platform/storage/sqlite/sql-types.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';

export interface StoredProviderModel {
	id: string;
	protocol?: AgentProviderProtocol;
	contextWindow: number;
	maxOutputTokens: number;
	supportsTools: boolean;
	supportsImageInput?: boolean;
	supportsFileInput?: boolean;
	supportsPromptCacheKey?: boolean;
	reasoningEfforts?: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory?: boolean;
}

export interface StoredProviderObservation {
	modelId: string;
	source: string;
	sourceVersion: string;
	updatedAt: number;
	capabilities: Partial<Omit<StoredProviderModel, 'id' | 'protocol'>>;
}

export interface StoredModelReference {
	providerId: string;
	modelId: string;
	configurationVersion: number;
}

export interface ProviderStoredRow {
	id: string;
	userId: number;
	displayName: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: StoredProviderModel[];
	observations: StoredProviderObservation[];
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface ProviderWrite {
	id: string;
	userId: number;
	displayName: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: StoredProviderModel[];
	enabled: boolean;
	protectedCredential?: string;
	clearCredential?: boolean;
	now: number;
}

export type ProviderWriteResult =
	{ status: 'ok'; provider: ProviderStoredRow } | { status: 'not_found' | 'version_conflict' };

export interface StoredProviderUsage {
	runStatuses: AgentRunStatus[];
}

export interface ProviderStorage {
	/** A completed discovery may write only when both revisions still match the original request. */
	recordObservations(
		userId: number,
		id: string,
		version: number,
		credentialRevision: number,
		observations: StoredProviderObservation[],
	): Promise<boolean>;
	list(userId: number): Promise<ProviderStoredRow[]>;
	get(userId: number, id: string): Promise<ProviderStoredRow | null>;
	create(value: ProviderWrite): Promise<ProviderStoredRow>;
	/** Decisions execute synchronously against current facts inside the write transaction. */
	update(
		value: ProviderWrite,
		expectedVersion: number,
		resetObservations: (current: ProviderStoredRow) => boolean,
	): Promise<ProviderWriteResult>;
	remove(
		userId: number,
		id: string,
		expectedVersion: number,
		now: number,
		mayDelete: (usage: StoredProviderUsage) => boolean,
	): Promise<ProviderDeleteResult>;
	credential(userId: number, id: string, providerVersion: number, credentialRevision: number): Promise<string | null>;
	/** Reads the provider using the Run creation transaction. */
	snapshot(tx: SqlExecutor, userId: number, id: string): Promise<ProviderStoredRow | null>;
}

export type ProviderDeleteResult = { status: 'ok' } | { status: 'not_found' | 'version_conflict' | 'provider_in_use' };
