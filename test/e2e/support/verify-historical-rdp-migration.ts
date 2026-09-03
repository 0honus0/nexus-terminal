import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../../../packages/backend/src/infrastructure/database/sqlite-migrations';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { SqliteConnectionRepository } from '../../../packages/backend/src/infrastructure/database/repositories/sqlite-connection.repository';

const main = async (): Promise<void> => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-migration-e2e-'));
  const dbPath = path.join(dir, 'nexus-terminal.db');
  let db: DatabaseSync | null = new DatabaseSync(dbPath);

  try {
    db.exec(`
            CREATE TABLE connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                type TEXT NOT NULL DEFAULT 'SSH',
                host TEXT NOT NULL,
                port INTEGER NULL,
                username TEXT NULL,
                auth_method TEXT NULL,
                encrypted_password TEXT NULL,
                encrypted_private_key TEXT NULL,
                encrypted_passphrase TEXT NULL,
                proxy_id INTEGER NULL,
                proxy_type TEXT NULL,
                ssh_key_id INTEGER NULL,
                notes TEXT NULL,
                jump_chain TEXT NULL,
                force_keyboard_interactive INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                last_connected_at INTEGER NULL
            );

            CREATE TABLE connection_tags (
                connection_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL
            );

            CREATE TABLE migrations (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            INSERT INTO migrations (id, name) VALUES
                (11, 'Add force_keyboard_interactive column to connections table'),
                (18, 'Fix Telnet CHECK constraint and add missing FK indexes');

            INSERT INTO connections (name, type, host, port, username, auth_method, notes, jump_chain)
            VALUES ('Historical RDP', 'RDP', '192.0.2.88', 3389, 'legacy-user', 'password', 'legacy row', NULL);
        `);

    await runMigrations(db!);

    const columns = db!.prepare('PRAGMA table_info(connections)').all() as Array<{ name: string }>;
    assert(columns.some((column) => column.name === 'rdp_options'));

    const historicalMigration = db!.prepare('SELECT name FROM migrations WHERE id = 11').get() as { name: string };
    assert.equal(historicalMigration.name, 'Add force_keyboard_interactive column to connections table');

    const rdpMigration = db!.prepare('SELECT id, name FROM migrations WHERE id = 19').get() as {
      id: number;
      name: string;
    };
    assert.equal(rdpMigration.id, 19);
    assert.equal(rdpMigration.name, 'Add RDP options column to connections table');

    await runMigrations(db!);
    const migrationCount = db!.prepare('SELECT COUNT(*) AS count FROM migrations WHERE id = 19').get() as {
      count: number;
    };
    assert.equal(migrationCount.count, 1);

    // Re-open the upgraded database through the current production database/repository path.
    // This guards the historical failure where migrations reported "latest" but the
    // connection list still failed because rdp_options was absent.
    db!.close();
    db = null;
    const database = new DatabaseAdapter({ dataDirectory: dir });
    await database.initialize();
    try {
      const repository = new SqliteConnectionRepository(database);
      const connections = await repository.list();
      assert.equal(connections.length, 1);
      assert.equal(connections[0]?.name, 'Historical RDP');
      assert.equal(connections[0]?.rdpOptions, null);
    } finally {
      await database.close();
    }

    console.log('historical RDP migration upgrade and connection list query passed');
  } finally {
    if (db) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
