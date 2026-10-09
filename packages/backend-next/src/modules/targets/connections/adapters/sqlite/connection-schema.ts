import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

/** Connections and their relations; Proxy/Tag tables belong to their sibling features. */
export async function initializeConnectionsSchema(db: SqliteRuntime): Promise<void> {
	await db.exec(`
    CREATE TABLE IF NOT EXISTS connections(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('SSH','RDP','VNC')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
      username TEXT NOT NULL,
      route TEXT NOT NULL CHECK(route IN ('direct','proxy','jump')),
      proxy_id INTEGER REFERENCES proxies(id) ON DELETE RESTRICT,
      notes TEXT,
      rdp_remote_app TEXT,
      rdp_remote_app_directory TEXT,
      rdp_remote_app_arguments TEXT,
      version INTEGER NOT NULL CHECK(version>=1),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK ((route='proxy' AND proxy_id IS NOT NULL) OR (route!='proxy' AND proxy_id IS NULL)),
      CHECK (route!='jump' OR type='SSH')
    );
    CREATE INDEX IF NOT EXISTS idx_connections_proxy ON connections(proxy_id);
    CREATE TABLE IF NOT EXISTS connection_tags(
      connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(connection_id,tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_connection_tags_tag ON connection_tags(tag_id);
    CREATE TABLE IF NOT EXISTS connection_jumps(
      connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK(position>=0),
      jump_connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
      PRIMARY KEY(connection_id,position),
      UNIQUE(connection_id,jump_connection_id),
      CHECK(connection_id!=jump_connection_id)
    );
    CREATE INDEX IF NOT EXISTS idx_connection_jumps_target ON connection_jumps(jump_connection_id);
  `);
}
