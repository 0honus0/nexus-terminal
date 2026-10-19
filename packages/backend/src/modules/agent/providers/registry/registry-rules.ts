import type {
	CapabilityRegistrySnapshot,
	CapabilityRegistryRead,
	CapabilityRegistryState,
	RegistryCatalogEntry,
	RegistryDefaults,
} from './model/registry-types.js';
import { RegistryRefreshFailure } from './model/registry-types.js';

export function buildRegistrySnapshot(
	items: RegistryCatalogEntry[],
	revision: string | null,
	now: number,
): CapabilityRegistrySnapshot {
	const entries: Record<string, RegistryDefaults> = Object.create(null);
	const aliases = new Map<string, RegistryDefaults | null>();
	for (const item of items) {
		const value: RegistryDefaults = {
			contextWindow: item.capabilities.contextWindow,
			maxOutputTokens: item.capabilities.maxOutputTokens,
			...(item.capabilities.supportsTools === undefined
				? {}
				: { supportsTools: item.capabilities.supportsTools }),
			...(item.capabilities.supportsImageInput === undefined
				? {}
				: { supportsImageInput: item.capabilities.supportsImageInput }),
			...(item.capabilities.supportsFileInput === undefined
				? {}
				: { supportsFileInput: item.capabilities.supportsFileInput }),
			...(item.capabilities.reasoningEfforts === undefined
				? {}
				: { reasoningEfforts: [...item.capabilities.reasoningEfforts] }),
		};
		entries[item.providerId + '/' + item.modelId] = value;
		const normalized = item.modelId.toLowerCase();
		if (!aliases.has(normalized)) {
			aliases.set(normalized, value);
		} else if (JSON.stringify(aliases.get(normalized)) !== JSON.stringify(value)) {
			aliases.set(normalized, null);
		}
	}
	for (const [key, value] of aliases) {
		if (value && !Object.hasOwn(entries, key)) {
			entries[key] = value;
		}
	}
	if (Object.keys(entries).length > 5000) {
		throw new RegistryRefreshFailure('MODEL_REGISTRY_RESPONSE_INVALID');
	}
	return { schemaVersion: 1, source: 'models.dev', sourceRevision: revision, generatedAt: now, entries };
}

export function recoverRegistryState(state: CapabilityRegistryRead): CapabilityRegistryState {
	return {
		snapshot: state.snapshot,
		lastAttemptAt: state.lastAttemptAt,
		lastSuccessAt: state.snapshotInvalid ? null : state.lastSuccessAt,
		lastErrorCode: state.snapshotInvalid ? 'MODEL_REGISTRY_CACHE_INVALID' : state.lastErrorCode,
	};
}

export function resolveRegistryDefaults(state: CapabilityRegistryState, modelId: string): RegistryDefaults | null {
	const key = modelId.toLowerCase();
	const entry = state.snapshot?.entries[modelId] ?? state.snapshot?.entries[key];
	if (!entry) {
		return null;
	}
	return {
		contextWindow: entry.contextWindow,
		maxOutputTokens: entry.maxOutputTokens,
		...(entry.supportsTools === undefined ? {} : { supportsTools: entry.supportsTools }),
		...(entry.supportsImageInput === undefined ? {} : { supportsImageInput: entry.supportsImageInput }),
		...(entry.supportsFileInput === undefined ? {} : { supportsFileInput: entry.supportsFileInput }),
		...(entry.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...entry.reasoningEfforts] }),
	};
}
