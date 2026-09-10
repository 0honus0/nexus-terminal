import type { AgentSettingsDocument } from '../agent-defaults';

export type { AgentSettingsDocument } from '../agent-defaults';

export interface AgentSettingsRecord {
  userId: number;
  settings: AgentSettingsDocument;
  revision: number;
  updatedAt: number;
}

export interface AgentSettingsRepositoryPort {
  get(userId: number): Promise<AgentSettingsRecord | null>;
  insertDefault(record: AgentSettingsRecord): Promise<boolean>;
  compareAndSet(
    userId: number,
    expectedRevision: number,
    settings: AgentSettingsDocument,
    updatedAt: number,
  ): Promise<AgentSettingsRecord>;
}
