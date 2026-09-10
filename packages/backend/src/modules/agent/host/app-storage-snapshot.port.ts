import type { JsonValue, Scope } from '../agent.types';

export interface AppStorageSnapshotEntry {
  key: string;
  value: JsonValue;
  bytes: number;
  version: number;
  updatedAt: number;
}

export interface AppStorageSnapshot {
  entries: AppStorageSnapshotEntry[];
  totalBytes: number;
}

export interface AppStorageSnapshotPort {
  capture(scope: Scope): Promise<AppStorageSnapshot>;
  restore(scope: Scope, snapshot: AppStorageSnapshot): Promise<void>;
  clear(scope: Scope): Promise<void>;
}
