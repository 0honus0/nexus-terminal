import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initializeSchema } from '../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';

async function fixture(t) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-schema-migration-'));
	const path = join(directory, 'state.db');
	let db = SqliteRuntime.open(path);
	t.after(async () => {
		try {
			await db.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	return {
		get db() {
			return db;
		},

		async restart() {
			await db.close();
			db = SqliteRuntime.open(path);
		},
	};
}

function baseline(apply) {
	return {
		version: 1,
		signature: 'schema-rebuild-fixture-v1',

		async apply(tx) {
			apply();
			await tx.exec(`CREATE TABLE parents(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
			 CREATE TABLE children(id INTEGER PRIMARY KEY,parent_id INTEGER NOT NULL REFERENCES parents(id),value TEXT NOT NULL);
			 INSERT INTO parents VALUES(1,'retained parent');
			 INSERT INTO children VALUES(1,1,'retained child');`);
		},
	};
}

await test('Schema migrations preserve referenced data through a deferred table rebuild and skip committed versions after restart', async (t) => {
	const f = await fixture(t);
	let baselineCalls = 0;
	let rebuildCalls = 0;
	const migrations = [
		baseline(() => baselineCalls++),
		{
			version: 2,
			signature: 'schema-rebuild-fixture-v2',

			async apply(tx) {
				rebuildCalls++;
				assert.equal((await tx.one('PRAGMA foreign_keys')).foreign_keys, 1);
				await tx.exec(`PRAGMA defer_foreign_keys=ON;
				 CREATE TABLE parents_rebuilt(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
				 INSERT INTO parents_rebuilt SELECT * FROM parents;
				 DROP TABLE parents;
				 ALTER TABLE parents_rebuilt RENAME TO parents;`);
				assert.equal((await tx.one('PRAGMA defer_foreign_keys')).defer_foreign_keys, 1);
				assert.deepEqual(await tx.all('PRAGMA foreign_key_check'), []);
			},
		},
	];
	await initializeSchema(f.db, migrations.slice(0, 1));
	await initializeSchema(f.db, migrations);
	assert.equal((await f.db.one('SELECT value FROM parents WHERE id=1')).value, 'retained parent');
	assert.equal((await f.db.one('SELECT value FROM children WHERE id=1')).value, 'retained child');
	assert.equal((await f.db.one('PRAGMA foreign_keys')).foreign_keys, 1);
	assert.equal((await f.db.one('PRAGMA defer_foreign_keys')).defer_foreign_keys, 0);
	assert.deepEqual(await f.db.all('PRAGMA foreign_key_check'), []);
	await f.restart();
	await initializeSchema(f.db, migrations);
	assert.equal(baselineCalls, 1);
	assert.equal(rebuildCalls, 1);
	assert.deepEqual(
		(await f.db.all('SELECT version,signature FROM schema_version ORDER BY version')).map(
			({ version, signature }) => ({
				version,
				signature,
			}),
		),
		migrations.map(({ version, signature }) => ({ version, signature })),
	);
	await assert.rejects(
		f.db.transaction((tx) => tx.run("INSERT INTO children VALUES(2,999,'forbidden orphan')")),
		(error) => error instanceof SqliteFailure && error.kind === 'constraint',
	);
	assert.equal((await f.db.one('PRAGMA foreign_keys')).foreign_keys, 1);
	assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM children')).count, 1);
	await f.db.transaction((tx) => tx.run("INSERT INTO children VALUES(2,1,'valid ordinary transaction')"));
	assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM children')).count, 2);
});

await test('Schema migration rejects a real deferred foreign key violation before recording its version and rolls back all changes', async (t) => {
	const f = await fixture(t);
	let failedCalls = 0;
	const migrations = [
		baseline(() => {}),
		{
			version: 2,
			signature: 'schema-invalid-foreign-key-fixture-v2',

			async apply(tx) {
				failedCalls++;
				await tx.exec(`PRAGMA defer_foreign_keys=ON;
				 CREATE TABLE rollback_evidence(value TEXT NOT NULL);
				 INSERT INTO rollback_evidence VALUES('must roll back');
				 INSERT INTO children VALUES(2,999,'must roll back');`);
			},
		},
	];
	await initializeSchema(f.db, migrations.slice(0, 1));
	for (let attempt = 0; attempt < 2; attempt++) {
		await assert.rejects(initializeSchema(f.db, migrations), {
			message: 'Schema migration violates foreign key constraints',
		});
		assert.equal(await f.db.one("SELECT name FROM sqlite_master WHERE name='rollback_evidence'"), null);
		assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM children')).count, 1);
		assert.equal((await f.db.one('SELECT MAX(version) AS version FROM schema_version')).version, 1);
		assert.equal((await f.db.one('PRAGMA foreign_keys')).foreign_keys, 1);
		assert.equal((await f.db.one('PRAGMA defer_foreign_keys')).defer_foreign_keys, 0);
		assert.deepEqual(await f.db.all('PRAGMA foreign_key_check'), []);
		await f.restart();
	}
	assert.equal(failedCalls, 2, 'only the uncommitted migration is attempted again');
});
