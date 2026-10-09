import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

/** Current fresh-install Proxy schema (v1); password ciphertext stays separate. */
export async function initializeProxiesSchema(db: SqlExecutor): Promise<void> {
	await db.exec(`
    CREATE TABLE proxies(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('HTTP','SOCKS5')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
      username TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(name,type,host,port)
    );
    CREATE TABLE proxy_credentials(
      proxy_id INTEGER PRIMARY KEY REFERENCES proxies(id) ON DELETE CASCADE,
      encrypted_password TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
