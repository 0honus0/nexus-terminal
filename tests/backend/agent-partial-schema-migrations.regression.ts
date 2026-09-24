import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { definedMigrations } from '../../packages/backend/src/infrastructure/database/sqlite-migrations';

const migration = (id: number) => {
  const value = definedMigrations.find((candidate) => candidate.id === id);
  assert(value, `migration #${id} must exist`);
  assert(value.apply, `migration #${id} must provide partial-schema apply recovery`);
  assert(value.verify, `migration #${id} must provide a postcondition verifier`);
  return value;
};

const columnNames = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);

const indexNames = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((row) => row.name);

const exercise23 = async (tableSql: string): Promise<void> => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(tableSql);
    const target = migration(23);
    assert.equal(await target.check?.(db), true);
    await target.apply!(db);
    assert.equal(await target.verify!(db), true);
    assert.equal(await target.check?.(db), false);

    const columns = columnNames(db, 'agent_tool_calls');
    assert(columns.includes('source_model_step_id'));
    assert(columns.includes('batch_index'));
    assert(columns.includes('batch_size'));
    assert(indexNames(db, 'agent_tool_calls').includes('agent_tool_call_batch_lineage'));
  } finally {
    db.close();
  }
};

const exercise34 = async (tableSql: string): Promise<void> => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(tableSql);
    const target = migration(34);
    assert.equal(await target.check?.(db), true);
    await target.apply!(db);
    assert.equal(await target.verify!(db), true);
    assert.equal(await target.check?.(db), false);

    const columns = columnNames(db, 'agent_approvals');
    assert(columns.includes('kind'));
    assert(columns.includes('inspection_json'));
  } finally {
    db.close();
  }
};

const main = async (): Promise<void> => {
  await exercise23(`
    CREATE TABLE agent_tool_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_runtime_id TEXT NOT NULL,
      source_model_step_id TEXT
    );
  `);
  await exercise23(`
    CREATE TABLE agent_tool_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_runtime_id TEXT NOT NULL,
      batch_index INTEGER NOT NULL DEFAULT 0 CHECK(batch_index >= 0)
    );
  `);

  await exercise34(`
    CREATE TABLE agent_approvals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'tool' CHECK(kind IN ('tool','acp_permission'))
    );
  `);
  await exercise34(`
    CREATE TABLE agent_approvals (
      id TEXT PRIMARY KEY,
      inspection_json TEXT CHECK(inspection_json IS NULL OR json_valid(inspection_json))
    );
  `);

  const source = fs.readFileSync(
    new URL('../../packages/backend/src/infrastructure/database/sqlite-migrations.ts', import.meta.url),
    'utf8',
  );
  const execution = source.indexOf('if (migration.apply) {');
  const verification = source.indexOf('if (migration.verify && !(await migration.verify(db)))');
  const record = source.indexOf('insertMigration.run(migration.id, migration.name);');
  assert(execution >= 0 && verification > execution && record > verification);
  assert(
    source.includes('throw new Error(`MIGRATION_POSTCONDITION_FAILED:${migration.id}`)'),
    'a failed postcondition must abort before recording the migration id',
  );

  process.stdout.write('agent partial-schema migration recovery regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
