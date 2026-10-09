import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

export async function initializeTagsSchema(db: SqliteRuntime): Promise<void> {
	await db.exec(`
    CREATE TABLE IF NOT EXISTS tags(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
