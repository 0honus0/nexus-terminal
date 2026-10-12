import type { ModelCatalogPort, CatalogModelCapabilities } from '../../../../../platform/ai/catalog-port.js';
import { RegistryRefreshFailure } from './registry-types.js';
import { CatalogFailure } from '../../../../../platform/ai/catalog-port.js';
import { MODELS_DEV_CATALOG_URL } from '../../../../../platform/ai/catalog-port.js';
import type { CapabilityRegistryStorage } from '../storage/registry-storage.js';
import { fromStoredSnapshot, toStoredSnapshot } from './registry-projection.js';
import type {
	CapabilityRegistryState,
	RegistryDefaults,
	RegistryStatus,
	RegistryFetchResult,
	CapabilityRegistryRead,
} from './registry-types.js';

function fromCatalog(value: CatalogModelCapabilities): RegistryDefaults {
	return {
		contextWindow: value.contextWindow,
		maxOutputTokens: value.maxOutputTokens,
		...(value.supportsTools === undefined ? {} : { supportsTools: value.supportsTools }),
		...(value.supportsImageInput === undefined ? {} : { supportsImageInput: value.supportsImageInput }),
		...(value.supportsFileInput === undefined ? {} : { supportsFileInput: value.supportsFileInput }),
		...(value.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...value.reasoningEfforts] }),
	};
}

export class CapabilityRegistryModel {
	constructor(
		private readonly storage: CapabilityRegistryStorage,
		private readonly catalog: ModelCatalogPort,
	) {}

	async load(): Promise<CapabilityRegistryRead> {
		const row = await this.storage.load();
		return {
			snapshot: row.snapshot === null ? null : fromStoredSnapshot(row.snapshot),
			lastAttemptAt: row.lastAttemptAt,
			lastSuccessAt: row.lastSuccessAt,
			lastErrorCode: row.lastErrorCode,
			snapshotInvalid: row.snapshotInvalid,
		};
	}

	async save(state: CapabilityRegistryState): Promise<void> {
		await this.storage.save({
			snapshot: state.snapshot === null ? null : toStoredSnapshot(state.snapshot),
			lastAttemptAt: state.lastAttemptAt,
			lastSuccessAt: state.lastSuccessAt,
			lastErrorCode: state.lastErrorCode,
		});
	}

	async fetch(revision: string | null, signal: AbortSignal): Promise<RegistryFetchResult> {
		try {
			const result = await this.catalog.fetch(revision, signal);
			return result.status === 'not-modified'
				? { status: 'not-modified' }
				: {
						status: 'updated',
						sourceRevision: result.sourceRevision,
						items: result.entries.map((entry) => ({
							providerId: entry.providerId,
							modelId: entry.modelId,
							capabilities: fromCatalog(entry.capabilities),
						})),
					};
		} catch (error) {
			if (error instanceof CatalogFailure) {
				const codes = {
					http: 'MODEL_REGISTRY_HTTP',
					network: 'MODEL_REGISTRY_NETWORK',
					response_invalid: 'MODEL_REGISTRY_RESPONSE_INVALID',
					too_large: 'MODEL_REGISTRY_TOO_LARGE',
					cleanup_failed: 'MODEL_REGISTRY_CLEANUP_FAILED',
				} as const;
				throw new RegistryRefreshFailure(codes[error.kind], { cause: error });
			}
			throw error;
		}
	}

	status(state: CapabilityRegistryState): RegistryStatus {
		return {
			sourceUrl: MODELS_DEV_CATALOG_URL,
			activeSource: state.snapshot ? 'remote' : 'unavailable',
			entryCount: state.snapshot ? Object.keys(state.snapshot.entries).length : 0,
			generatedAt: state.snapshot?.generatedAt ?? null,
			sourceRevision: state.snapshot?.sourceRevision ?? null,
			lastAttemptAt: state.lastAttemptAt,
			lastSuccessAt: state.lastSuccessAt,
			lastErrorCode: state.lastErrorCode,
		};
	}
}
