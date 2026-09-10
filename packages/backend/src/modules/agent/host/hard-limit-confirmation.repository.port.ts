import type { AgentSettingsDocument } from '../agent-defaults';

export interface HardLimitConfirmationRecord {
  id: string;
  userId: number;
  expectedRevision: number;
  proposed: AgentSettingsDocument['hardLimits'];
  createdAt: number;
  expiresAt: number;
}

export interface HardLimitConfirmationRepositoryPort {
  save(record: HardLimitConfirmationRecord): Promise<void>;
  get(userId: number, confirmationId: string): Promise<HardLimitConfirmationRecord | null>;
  delete(userId: number, confirmationId: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}
