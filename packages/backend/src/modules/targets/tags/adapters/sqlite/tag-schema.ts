import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Current fresh-install Tag schema (v1). */
export async function initializeTagsSchema(db: SqlExecutor): Promise<void> {
	await db.exec(`
    CREATE TABLE tags(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
