import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

export async function initializeProxiesSchema(db: SqliteRuntime): Promise<void> {
	await db.exec(`
    CREATE TABLE IF NOT EXISTS proxies(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('HTTP','SOCKS5')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
      username TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(name,type,host,port)
    );
  `);
}
