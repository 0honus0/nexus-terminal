import type { CreatePasskeyRecord, PasskeyRepository } from '../../../modules/passkey/passkey.repository.port';
import type { PasskeyCredential, PasskeyTransport } from '../../../modules/passkey/passkey.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface Row {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  name: string | null;
  backed_up: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}
const parseTransports = (value: string | null): PasskeyTransport[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is PasskeyTransport => typeof v === 'string') : [];
  } catch {
    return [];
  }
};
const map = (row: Row): PasskeyCredential => ({
  id: row.id,
  userId: row.user_id,
  credentialId: row.credential_id,
  publicKeyBase64: row.public_key,
  counter: row.counter,
  transports: parseTransports(row.transports),
  name: row.name,
  backedUp: Boolean(row.backed_up),
  lastUsedAt: row.last_used_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
export class SqlitePasskeyRepository implements PasskeyRepository {
  constructor(private readonly database: RelationalDatabase) {}
  async create(data: CreatePasskeyRecord) {
    const r = await this.database.execute(
      "INSERT INTO passkeys (user_id,credential_id,public_key,counter,transports,name,backed_up,created_at,updated_at) VALUES (?,?,?,?,?,?,?,strftime('%s','now'),strftime('%s','now'))",
      [
        data.userId,
        data.credentialId,
        data.publicKeyBase64,
        data.counter,
        JSON.stringify(data.transports),
        data.name ?? null,
        data.backedUp ? 1 : 0,
      ],
    );
    if (!r.lastInsertId) throw new Error('Passkey insert did not return an id.');
    const created = await this.database.queryOne<Row>('SELECT * FROM passkeys WHERE id=?', [r.lastInsertId]);
    if (!created) throw new Error('Created passkey could not be reloaded.');
    return map(created);
  }
  async getByCredentialId(id: string) {
    const r = await this.database.queryOne<Row>('SELECT * FROM passkeys WHERE credential_id=?', [id]);
    return r ? map(r) : null;
  }
  async listByUser(userId: number) {
    return (
      await this.database.queryAll<Row>('SELECT * FROM passkeys WHERE user_id=? ORDER BY created_at DESC', [userId])
    ).map(map);
  }
  async updateCounter(id: string, counter: number) {
    return (
      (
        await this.database.execute(
          "UPDATE passkeys SET counter=?,updated_at=strftime('%s','now') WHERE credential_id=?",
          [counter, id],
        )
      ).changes > 0
    );
  }
  async touch(id: string) {
    return (
      (
        await this.database.execute(
          "UPDATE passkeys SET last_used_at=strftime('%s','now'),updated_at=strftime('%s','now') WHERE credential_id=?",
          [id],
        )
      ).changes > 0
    );
  }
  async delete(id: string) {
    return (await this.database.execute('DELETE FROM passkeys WHERE credential_id=?', [id])).changes > 0;
  }
  async updateName(id: string, name: string) {
    return (
      (
        await this.database.execute(
          "UPDATE passkeys SET name=?,updated_at=strftime('%s','now') WHERE credential_id=?",
          [name, id],
        )
      ).changes > 0
    );
  }
  async getFirst() {
    const r = await this.database.queryOne<Row>('SELECT * FROM passkeys ORDER BY id ASC LIMIT 1');
    return r ? map(r) : null;
  }
}
