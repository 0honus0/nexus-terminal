import type { JsonValue } from '../agent.types';

export interface AppIntentReceipt {
  id: string;
  userId: number;
  senderAppId: string;
  receiverAppId: string;
  intentId: string;
  schemaVersion: number;
  input: JsonValue;
  artifactIds: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface AppIntentReceiptCreate extends AppIntentReceipt {
  revokedAt: null;
}

export interface AppIntentRepositoryPort {
  createConfirmed(receipt: AppIntentReceiptCreate): Promise<AppIntentReceipt>;
  get(userId: number, receiptId: string): Promise<AppIntentReceipt | null>;
  listReceived(userId: number, receiverAppId: string, now: number, limit: number): Promise<AppIntentReceipt[]>;
  revoke(userId: number, receiptId: string, appId: string, revokedAt: number): Promise<boolean>;
  purgeExpired(now: number, limit: number): Promise<number>;
  hasActiveArtifactGrant(userId: number, receiverAppId: string, artifactId: string, now: number): Promise<boolean>;
}
