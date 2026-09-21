import type { ModelCapabilityRegistrySnapshot } from './model-capability-registry-source';

export interface ModelCapabilityRegistryPersistedState {
  schemaVersion: 1;
  autoUpdate: boolean;
  snapshot: ModelCapabilityRegistrySnapshot | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastErrorCode: string | null;
}

export interface ModelCapabilityRegistryStorePort {
  load(): Promise<ModelCapabilityRegistryPersistedState | null>;
  save(state: ModelCapabilityRegistryPersistedState): Promise<void>;
}

export type ModelCapabilityRegistryFetchResult =
  | { state: 'not-modified'; sourceRevision: string | null }
  | { state: 'updated'; snapshot: ModelCapabilityRegistrySnapshot };

export interface ModelCapabilityRegistrySourcePort {
  fetch(sourceRevision: string | null): Promise<ModelCapabilityRegistryFetchResult>;
}
