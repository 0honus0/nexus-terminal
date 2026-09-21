import type {
  OpenAiCompatibleProtocol,
  PersistedProviderModelConfig,
  PersistedProviderView,
  ProviderModelCapabilityObservation,
  ProviderModelConfig,
  ProviderView,
} from './model.types';

export interface ProviderCreateRecord {
  id: string;
  userId: number;
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  protocol: OpenAiCompatibleProtocol;
  models: PersistedProviderModelConfig[];
  enabled: boolean;
  credential?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderUpdateRecord {
  displayName: string;
  baseUrl: string;
  protocol: OpenAiCompatibleProtocol;
  models: PersistedProviderModelConfig[];
  enabled: boolean;
  credential?: string;
  clearCredential: boolean;
  resetLiveCapabilities: boolean;
  updatedAt: number;
}

export interface ProviderRepositoryPort {
  get(userId: number, providerId: string): Promise<PersistedProviderView | null>;
  list(userId: number): Promise<PersistedProviderView[]>;
  create(record: ProviderCreateRecord): Promise<PersistedProviderView>;
  update(
    userId: number,
    providerId: string,
    expectedVersion: number,
    record: ProviderUpdateRecord,
  ): Promise<PersistedProviderView>;
  replaceLiveCapabilities(
    userId: number,
    providerId: string,
    observations: ProviderModelCapabilityObservation[],
  ): Promise<void>;
  remove(userId: number, providerId: string, expectedVersion: number, deletedAt: number): Promise<void>;
}

export interface ProviderRuntimeConfigPort {
  get(userId: number, providerId: string): Promise<ProviderView>;
}

export type { ProviderModelConfig, ProviderView } from './model.types';
