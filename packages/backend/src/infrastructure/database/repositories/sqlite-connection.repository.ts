import type {
  ConnectionRepository,
  CreateStoredConnection,
  StoredConnectionRecord,
  UpdateStoredConnection,
} from '../../../modules/connections/connection.repository.port';
import type {
  Connection,
  ConnectionAuthMethod,
  ConnectionRoute,
  ConnectionType,
  RdpConnectionOptions,
} from '../../../modules/connections/connection.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface ConnectionRow {
  id: number;
  name: string | null;
  type: ConnectionType;
  host: string;
  port: number;
  username: string;
  auth_method: ConnectionAuthMethod;
  encrypted_password: string | null;
  encrypted_private_key: string | null;
  encrypted_passphrase: string | null;
  ssh_key_id: number | null;
  proxy_id: number | null;
  proxy_type: ConnectionRoute;
  notes: string | null;
  jump_chain: string | null;
  rdp_options: string | null;
  created_at: number;
  updated_at: number;
  last_connected_at: number | null;
}

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapStored = (row: ConnectionRow): StoredConnectionRecord => ({
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
  sshKeyId: row.ssh_key_id,
  proxyId: row.proxy_id,
  route: row.proxy_type ?? null,
  notes: row.notes,
  jumpChain: parseJson<number[] | null>(row.jump_chain, null),
  rdpOptions: parseJson<RdpConnectionOptions | null>(row.rdp_options, null),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastConnectedAt: row.last_connected_at,
});

const mapPublic = (stored: StoredConnectionRecord, tagIds: number[]): Connection => {
  const { encryptedPassword: _password, encryptedPrivateKey: _key, encryptedPassphrase: _passphrase, ...safe } = stored;
  return { ...safe, tagIds };
};

export class SqliteConnectionRepository implements ConnectionRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async list(): Promise<Connection[]> {
    const rows = await this.database.queryAll<ConnectionRow>(
      'SELECT * FROM connections ORDER BY name COLLATE NOCASE ASC, id ASC',
    );
    if (!rows.length) return [];
    const tags = await this.database.queryAll<{ connection_id: number; tag_id: number }>(
      'SELECT connection_id, tag_id FROM connection_tags ORDER BY tag_id ASC',
    );
    const byConnection = new Map<number, number[]>();
    for (const tag of tags) {
      const list = byConnection.get(tag.connection_id) ?? [];
      list.push(tag.tag_id);
      byConnection.set(tag.connection_id, list);
    }
    return rows.map((row) => mapPublic(mapStored(row), byConnection.get(row.id) ?? []));
  }

  async get(id: number): Promise<Connection | null> {
    const stored = await this.getStored(id);
    if (!stored) return null;
    return mapPublic(stored, await this.getTagIds(id));
  }

  async getStored(id: number): Promise<StoredConnectionRecord | null> {
    const row = await this.database.queryOne<ConnectionRow>('SELECT * FROM connections WHERE id = ?', [id]);
    return row ? mapStored(row) : null;
  }

  async findByName(name: string): Promise<Connection | null> {
    const row = await this.database.queryOne<ConnectionRow>('SELECT * FROM connections WHERE name = ? LIMIT 1', [name]);
    if (!row) return null;
    return mapPublic(mapStored(row), await this.getTagIds(row.id));
  }

  async create(data: CreateStoredConnection, tagIds: readonly number[]): Promise<number> {
    return this.database.transaction(async (database) => {
      const result = await database.execute(
        `INSERT INTO connections (
          name,type,host,port,username,auth_method,encrypted_password,encrypted_private_key,encrypted_passphrase,
          ssh_key_id,proxy_id,proxy_type,notes,jump_chain,rdp_options,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          data.sshKeyId,
          data.proxyId,
          data.route,
          data.notes,
          serialize(data.jumpChain),
          serialize(data.rdpOptions),
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000),
        ],
      );
      if (!result.lastInsertId) throw new Error('Connection insert did not return an id.');
      await replaceTags(database, result.lastInsertId, tagIds);
      return result.lastInsertId;
    });
  }

  async update(id: number, data: UpdateStoredConnection, tagIds?: readonly number[]): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const columns: Record<keyof UpdateStoredConnection, string> = {
        name: 'name',
        type: 'type',
        host: 'host',
        port: 'port',
        username: 'username',
        authMethod: 'auth_method',
        encryptedPassword: 'encrypted_password',
        encryptedPrivateKey: 'encrypted_private_key',
        encryptedPassphrase: 'encrypted_passphrase',
        sshKeyId: 'ssh_key_id',
        proxyId: 'proxy_id',
        route: 'proxy_type',
        notes: 'notes',
        jumpChain: 'jump_chain',
        rdpOptions: 'rdp_options',
      };
      const entries = Object.entries(data).filter(([, value]) => value !== undefined) as Array<
        [keyof UpdateStoredConnection, unknown]
      >;
      let changed = false;
      if (entries.length) {
        const values = entries.map(([key, value]) =>
          key === 'jumpChain' || key === 'rdpOptions' ? serialize(value) : (value ?? null),
        );
        const result = await database.execute(
          `UPDATE connections SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          [...values, Math.floor(Date.now() / 1000), id],
        );
        changed ||= result.changes > 0;
      } else {
        changed = Boolean(await database.queryOne<{ id: number }>('SELECT id FROM connections WHERE id = ?', [id]));
      }
      if (!changed) return false;
      if (tagIds !== undefined) await replaceTags(database, id, tagIds);
      return true;
    });
  }

  async delete(id: number) {
    return (await this.database.execute('DELETE FROM connections WHERE id = ?', [id])).changes > 0;
  }

  async setTags(id: number, tagIds: readonly number[]): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const exists = await database.queryOne<{ id: number }>('SELECT id FROM connections WHERE id = ?', [id]);
      if (!exists) return false;
      await replaceTags(database, id, tagIds);
      return true;
    });
  }

  async addTagToMany(connectionIds: readonly number[], tagId: number): Promise<void> {
    await this.database.transaction(async (database) => {
      for (const id of connectionIds)
        await database.execute('INSERT OR IGNORE INTO connection_tags (connection_id, tag_id) VALUES (?, ?)', [
          id,
          tagId,
        ]);
    });
  }

  async updateLastConnected(id: number, timestamp: number) {
    return (
      (
        await this.database.execute('UPDATE connections SET last_connected_at = ?, updated_at = ? WHERE id = ?', [
          timestamp,
          timestamp,
          id,
        ])
      ).changes > 0
    );
  }

  private async getTagIds(id: number): Promise<number[]> {
    return (
      await this.database.queryAll<{ tag_id: number }>(
        'SELECT tag_id FROM connection_tags WHERE connection_id = ? ORDER BY tag_id ASC',
        [id],
      )
    ).map((row) => row.tag_id);
  }
}

const serialize = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);
const replaceTags = async (
  database: RelationalDatabase,
  connectionId: number,
  tagIds: readonly number[],
): Promise<void> => {
  await database.execute('DELETE FROM connection_tags WHERE connection_id = ?', [connectionId]);
  for (const tagId of [...new Set(tagIds)])
    await database.execute('INSERT INTO connection_tags (connection_id, tag_id) VALUES (?, ?)', [connectionId, tagId]);
};
