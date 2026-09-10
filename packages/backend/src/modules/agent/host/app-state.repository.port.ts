import type { Scope } from '../agent.types';
import type { AppRecord, AppStatePatch } from './app.types';

export interface AppStateRepositoryPort {
  get(scope: Scope): Promise<AppRecord | null>;
  list(userId: number): Promise<AppRecord[]>;
  insertDefault(record: AppRecord): Promise<boolean>;
  compareAndSet(scope: Scope, expectedVersion: number, patch: AppStatePatch): Promise<AppRecord>;
}
