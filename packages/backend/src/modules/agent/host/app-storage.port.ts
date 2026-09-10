import type { JsonValue, Scope } from '../agent.types';

export interface AppStorageRecord {
  key: string;
  value: JsonValue;
  bytes: number;
  version: number;
  updatedAt: number;
}

export interface AppStoragePort {
  get(scope: Scope, key: string): Promise<AppStorageRecord | null>;
  put(scope: Scope, key: string, value: JsonValue, expectedVersion: number | null): Promise<AppStorageRecord>;
  delete(scope: Scope, key: string, expectedVersion: number): Promise<boolean>;
}

export type { JsonValue, Scope } from '../agent.types';
