import type {
  CreateStoredProxyRecord,
  ProxyRepository,
  StoredProxyRecord,
  UpdateStoredProxyRecord,
} from '../../../modules/proxies/proxy.repository.port';
import type { ProxyType } from '../../../modules/proxies/proxy.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface ProxyRow {
  id: number;
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string | null;
  auth_method: StoredProxyRecord['authMethod'];
  encrypted_password: string | null;
  encrypted_private_key: string | null;
  encrypted_passphrase: string | null;
  created_at: number;
  updated_at: number;
}

const mapRow = (row: ProxyRow): StoredProxyRecord => ({
  id: row.id,
  name: row.name,
  type: row.type,
  host: row.host,
  port: row.port,
  username: row.username,
  authMethod: row.auth_method,
  encryptedPassword: row.encrypted_password,
  encryptedPrivateKey: row.encrypted_private_key,
  encryptedPassphrase: row.encrypted_passphrase,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class SqliteProxyRepository implements ProxyRepository {
  constructor(private readonly database: RelationalDatabase) {}
  async list() {
    return (await this.database.queryAll<ProxyRow>('SELECT * FROM proxies ORDER BY name ASC')).map(mapRow);
  }
  async get(id: number) {
    const row = await this.database.queryOne<ProxyRow>('SELECT * FROM proxies WHERE id = ?', [id]);
    return row ? mapRow(row) : null;
  }
  findDuplicate(name: string, type: ProxyType, host: string, port: number) {
    return this.database.queryOne<{ id: number }>(
      'SELECT id FROM proxies WHERE name = ? AND type = ? AND host = ? AND port = ?',
      [name, type, host, port],
    );
  }
  async create(data: CreateStoredProxyRecord) {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.database.execute(
      'INSERT INTO proxies (name,type,host,port,username,auth_method,encrypted_password,encrypted_private_key,encrypted_passphrase,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [
        data.name,
        data.type,
        data.host,
        data.port,
        data.username,
        data.authMethod,
        data.encryptedPassword,
        data.encryptedPrivateKey,
        data.encryptedPassphrase,
        now,
        now,
      ],
    );
    if (!result.lastInsertId) throw new Error('Proxy insert did not return an id.');
    return result.lastInsertId;
  }
  async update(id: number, data: UpdateStoredProxyRecord) {
    const columns: Record<keyof UpdateStoredProxyRecord, string> = {
      name: 'name',
      type: 'type',
      host: 'host',
      port: 'port',
      username: 'username',
      authMethod: 'auth_method',
      encryptedPassword: 'encrypted_password',
      encryptedPrivateKey: 'encrypted_private_key',
      encryptedPassphrase: 'encrypted_passphrase',
    };
    const entries = Object.entries(data).filter(([, value]) => value !== undefined) as Array<
      [keyof UpdateStoredProxyRecord, unknown]
    >;
    if (!entries.length) return true;
    const now = Math.floor(Date.now() / 1000);
    return (
      (
        await this.database.execute(
          `UPDATE proxies SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          [...entries.map(([, value]) => value ?? null), now, id],
        )
      ).changes > 0
    );
  }
  async delete(id: number) {
    return (await this.database.execute('DELETE FROM proxies WHERE id = ?', [id])).changes > 0;
  }
}
