import type { ProviderModelConfig, ProviderView } from './model.types';

export interface ProviderCreateRecord {
  id: string;
  userId: number;
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  models: ProviderModelConfig[];
  privateHostExceptions: string[];
  enabled: boolean;
  credential?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderUpdateRecord {
  displayName: string;
  baseUrl: string;
  models: ProviderModelConfig[];
  privateHostExceptions: string[];
  enabled: boolean;
  credential?: string;
  clearCredential: boolean;
  updatedAt: number;
}

export interface ProviderRepositoryPort {
  get(userId: number, providerId: string): Promise<ProviderView | null>;
  list(userId: number): Promise<ProviderView[]>;
  create(record: ProviderCreateRecord): Promise<ProviderView>;
  update(
    userId: number,
    providerId: string,
    expectedVersion: number,
    record: ProviderUpdateRecord,
  ): Promise<ProviderView>;
  remove(userId: number, providerId: string, expectedVersion: number, deletedAt: number): Promise<void>;
}

export type { ProviderModelConfig, ProviderView } from './model.types';
