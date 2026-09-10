import type { JsonValue } from '../agent.types';

export type EnvironmentConfirmationKind = 'setup' | 'packUninstall' | 'runtimeCleanup' | 'settingsReset';

export interface EnvironmentConfirmationRecord {
  id: string;
  userId: number;
  kind: EnvironmentConfirmationKind;
  expectedSettingsRevision: number;
  catalogRevision: string;
  payload: JsonValue;
  snapshot: JsonValue;
  createdAt: number;
  expiresAt: number;
}

export interface EnvironmentConfirmationRepositoryPort {
  save(record: EnvironmentConfirmationRecord): Promise<void>;
  get(userId: number, confirmationId: string): Promise<EnvironmentConfirmationRecord | null>;
  delete(userId: number, confirmationId: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}
