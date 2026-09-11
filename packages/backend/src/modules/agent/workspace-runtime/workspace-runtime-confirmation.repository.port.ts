import type { JsonValue } from '../agent.types';

export type WorkspaceRuntimeConfirmationKind = 'setup' | 'packUninstall' | 'runtimeCleanup' | 'settingsReset';

export interface WorkspaceRuntimeConfirmationRecord {
  id: string;
  userId: number;
  kind: WorkspaceRuntimeConfirmationKind;
  expectedSettingsRevision: number;
  catalogRevision: string;
  payload: JsonValue;
  snapshot: JsonValue;
  createdAt: number;
  expiresAt: number;
}

export interface WorkspaceRuntimeConfirmationRepositoryPort {
  save(record: WorkspaceRuntimeConfirmationRecord): Promise<void>;
  get(userId: number, confirmationId: string): Promise<WorkspaceRuntimeConfirmationRecord | null>;
  delete(userId: number, confirmationId: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}
