import type {
  CreateStoredSshKeyRecord,
  SshKeyRepository,
  StoredSshKeyRecord,
  UpdateStoredSshKeyRecord,
} from '../../../modules/ssh-keys/ssh-key.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
interface Row {
  id: number;
  name: string;
  encrypted_private_key: string;
  encrypted_passphrase: string | null;
  created_at: number;
  updated_at: number;
}
const map = (r: Row): StoredSshKeyRecord => ({
  id: r.id,
  name: r.name,
  encryptedPrivateKey: r.encrypted_private_key,
  encryptedPassphrase: r.encrypted_passphrase,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
export class SqliteSshKeyRepository implements SshKeyRepository {
  constructor(private readonly database: RelationalDatabase) {}
  async create(data: CreateStoredSshKeyRecord) {
    const r = await this.database.execute(
      "INSERT INTO ssh_keys (name,encrypted_private_key,encrypted_passphrase,created_at,updated_at) VALUES (?,?,?,strftime('%s','now'),strftime('%s','now'))",
      [data.name, data.encryptedPrivateKey, data.encryptedPassphrase],
    );
    if (!r.lastInsertId) throw new Error('SSH key insert did not return an id.');
    return r.lastInsertId;
  }
  async get(id: number) {
    const r = await this.database.queryOne<Row>('SELECT * FROM ssh_keys WHERE id=?', [id]);
    return r ? map(r) : null;
  }
  async list() {
    return (await this.database.queryAll<Row>('SELECT * FROM ssh_keys ORDER BY name ASC')).map(map);
  }
  async update(id: number, data: UpdateStoredSshKeyRecord) {
    const cols: Record<keyof UpdateStoredSshKeyRecord, string> = {
      name: 'name',
      encryptedPrivateKey: 'encrypted_private_key',
      encryptedPassphrase: 'encrypted_passphrase',
    };
    const e = Object.entries(data).filter(([, v]) => v !== undefined) as Array<
      [keyof UpdateStoredSshKeyRecord, unknown]
    >;
    if (!e.length) return true;
    return (
      (
        await this.database.execute(
          `UPDATE ssh_keys SET ${e.map(([k]) => `${cols[k]}=?`).join(',')},updated_at=strftime('%s','now') WHERE id=?`,
          [...e.map(([, v]) => v ?? null), id],
        )
      ).changes > 0
    );
  }
  async delete(id: number) {
    return (await this.database.execute('DELETE FROM ssh_keys WHERE id=?', [id])).changes > 0;
  }
}
