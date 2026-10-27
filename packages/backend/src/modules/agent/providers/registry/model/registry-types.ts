import type { AgentRegistryErrorCode } from '@nexus-terminal/shared/agent/providers/values';
import type { AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';

/** Application registry facts; HTTP wire projections are owned by the interface. */
export interface RegistryDefaults {
	contextWindow?: number;
	maxOutputTokens?: number;
	supportsTools?: boolean;
	supportsImageInput?: boolean;
	supportsImageGeneration?: boolean;
	supportsFileInput?: boolean;
	supportsPromptCacheKey?: boolean;
	reasoningEfforts?: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory?: boolean;
}

export interface RegistryMatch {
	canonicalId: string;
	defaults: RegistryDefaults;
	reasoningEffort?: AgentReasoningEffort;
}

export interface RegistryStatus {
	sourceUrl: string;
	activeSource: 'remote' | 'unavailable';
	entryCount: number;
	generatedAt: number | null;
	sourceRevision: string | null;
	lastAttemptAt: number | null;
	lastSuccessAt: number | null;
	lastErrorCode: AgentRegistryErrorCode | null;
}

export interface RegistryResolution {
	modelId: string;
	defaults: RegistryDefaults | null;
}

export interface CapabilityRegistrySnapshot {
	schemaVersion: 2;
	source: 'models.dev';
	sourceRevision: string | null;
	generatedAt: number;
	entries: Record<string, RegistryDefaults>;
}

export interface CapabilityRegistryState {
	snapshot: CapabilityRegistrySnapshot | null;
	lastAttemptAt: number | null;
	lastSuccessAt: number | null;
	lastErrorCode: AgentRegistryErrorCode | null;
}

export interface CapabilityRegistryRead extends CapabilityRegistryState {
	snapshotInvalid: boolean;
}

export interface RegistryCatalogEntry {
	providerId: string;
	modelId: string;
	capabilities: RegistryDefaults;
}

export type RegistryFetchResult =
	{ status: 'updated'; items: RegistryCatalogEntry[]; sourceRevision: string | null } | { status: 'not-modified' };

export class RegistryRefreshFailure extends Error {
	constructor(
		readonly errorCode: AgentRegistryErrorCode,
		options?: ErrorOptions,
	) {
		super('Registry refresh failed', options);
		this.name = 'RegistryRefreshFailure';
	}
}
