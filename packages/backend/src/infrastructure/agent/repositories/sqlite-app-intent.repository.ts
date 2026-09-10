import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../modules/agent/agent.types';
import type {
  AppIntentReceipt,
  AppIntentReceiptCreate,
  AppIntentRepositoryPort,
} from '../../../modules/agent/host/app-intent.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface ReceiptRow {
  id: string;
  user_id: number;
  sender_app_id: string;
  receiver_app_id: string;
  intent_id: string;
  schema_version: number;
  input_json: string;
  artifact_ids_json: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

const mapReceipt = (row: ReceiptRow): AppIntentReceipt => ({
  id: row.id,
  userId: row.user_id,
  senderAppId: row.sender_app_id,
  receiverAppId: row.receiver_app_id,
  intentId: row.intent_id,
  schemaVersion: row.schema_version,
  input: JSON.parse(row.input_json) as JsonValue,
  artifactIds: JSON.parse(row.artifact_ids_json) as string[],
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
});

const RECEIPT_COLUMNS =
  'id,user_id,sender_app_id,receiver_app_id,intent_id,schema_version,input_json,artifact_ids_json,created_at,expires_at,revoked_at';

export class SqliteAppIntentRepository implements AppIntentRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async createConfirmed(receipt: AppIntentReceiptCreate): Promise<AppIntentReceipt> {
    await this.db.transaction(async (tx) => {
      for (const artifactId of receipt.artifactIds) {
        const artifact = await tx.queryOne<{ user_id: number; app_id: string; status: string }>(
          'SELECT user_id,app_id,status FROM ai_artifacts WHERE id=?',
          [artifactId],
        );
        if (
          !artifact ||
          artifact.user_id !== receipt.userId ||
          artifact.app_id !== receipt.senderAppId ||
          artifact.status !== 'ready'
        ) {
          throw new Error('APP_INTENT_ARTIFACT_NOT_AUTHORIZED');
        }
      }

      await tx.execute(
        `INSERT INTO agent_app_intent_receipts(
           id,user_id,sender_app_id,receiver_app_id,intent_id,schema_version,input_json,artifact_ids_json,
           created_at,expires_at,revoked_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`,
        [
          receipt.id,
          receipt.userId,
          receipt.senderAppId,
          receipt.receiverAppId,
          receipt.intentId,
          receipt.schemaVersion,
          JSON.stringify(receipt.input),
          JSON.stringify(receipt.artifactIds),
          receipt.createdAt,
          receipt.expiresAt,
        ],
      );

      for (const artifactId of receipt.artifactIds) {
        await tx.execute(
          `INSERT INTO agent_app_intent_artifact_grants(
             id,receipt_id,artifact_id,receiver_user_id,receiver_app_id,created_at,expires_at,revoked_at
           ) VALUES(?,?,?,?,?,?,?,NULL)`,
          [
            randomUUID(),
            receipt.id,
            artifactId,
            receipt.userId,
            receipt.receiverAppId,
            receipt.createdAt,
            receipt.expiresAt,
          ],
        );
      }
    });
    return receipt;
  }

  async get(userId: number, receiptId: string): Promise<AppIntentReceipt | null> {
    const row = await this.db.queryOne<ReceiptRow>(
      `SELECT ${RECEIPT_COLUMNS} FROM agent_app_intent_receipts WHERE id=? AND user_id=?`,
      [receiptId, userId],
    );
    return row ? mapReceipt(row) : null;
  }

  async listReceived(userId: number, receiverAppId: string, now: number, limit: number): Promise<AppIntentReceipt[]> {
    const rows = await this.db.queryAll<ReceiptRow>(
      `SELECT ${RECEIPT_COLUMNS}
       FROM agent_app_intent_receipts
       WHERE user_id=? AND receiver_app_id=? AND revoked_at IS NULL AND expires_at>?
       ORDER BY created_at DESC,id DESC LIMIT ?`,
      [userId, receiverAppId, now, limit],
    );
    return rows.map(mapReceipt);
  }

  async revoke(userId: number, receiptId: string, appId: string, revokedAt: number): Promise<boolean> {
    let changed = false;
    await this.db.transaction(async (tx) => {
      const result = await tx.execute(
        `UPDATE agent_app_intent_receipts SET revoked_at=?
         WHERE id=? AND user_id=? AND revoked_at IS NULL AND (sender_app_id=? OR receiver_app_id=?)`,
        [revokedAt, receiptId, userId, appId, appId],
      );
      if (result.changes !== 1) return;
      await tx.execute(
        'UPDATE agent_app_intent_artifact_grants SET revoked_at=? WHERE receipt_id=? AND revoked_at IS NULL',
        [revokedAt, receiptId],
      );
      changed = true;
    });
    return changed;
  }

  async purgeExpired(now: number, limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('APP_INTENT_INVALID');
    const result = await this.db.execute(
      `DELETE FROM agent_app_intent_receipts
       WHERE id IN (
         SELECT id FROM agent_app_intent_receipts
         WHERE expires_at<=? OR (revoked_at IS NOT NULL AND revoked_at<=?)
         ORDER BY expires_at,id LIMIT ?
       )`,
      [now, now - 24 * 60 * 60, limit],
    );
    return result.changes;
  }

  async hasActiveArtifactGrant(
    userId: number,
    receiverAppId: string,
    artifactId: string,
    now: number,
  ): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM agent_app_intent_artifact_grants
       WHERE artifact_id=? AND receiver_user_id=? AND receiver_app_id=?
         AND revoked_at IS NULL AND expires_at>?
       LIMIT 1`,
      [artifactId, userId, receiverAppId, now],
    );
    return Boolean(row);
  }
}
