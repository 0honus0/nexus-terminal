import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';

await test('SQLite transaction failure rolls back writes and the next queued transaction still works', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-rollback-'));
	const db = SqliteRuntime.open(join(directory, 'state.db'));
	try {
		await db.exec('CREATE TABLE regression(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
		const original = new Error('fixture business refusal');
		await assert.rejects(
			db.transaction(async (tx) => {
				await tx.run('INSERT INTO regression VALUES(1,?)', ['rolled back']);
				throw original;
			}),
			(error) => error === original,
		);
		assert.deepEqual(await db.all('SELECT * FROM regression'), []);
		await db.transaction((tx) => tx.run('INSERT INTO regression VALUES(1,?)', ['committed']));
		assert.equal((await db.one('SELECT value FROM regression')).value, 'committed');
	} finally {
		await db.close();
		await rm(directory, { recursive: true, force: true });
	}
});

for (const phase of ['rollback', 'commit']) {
	await test(`SQLite ${phase} confirmation failure quarantines the original runtime without retry`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-quarantine-'));
		const path = join(directory, 'state.db');
		const db = SqliteRuntime.open(path);
		let reopened;
		let failure;
		try {
			await db.exec('CREATE TABLE regression(id INTEGER PRIMARY KEY)');
			const original = new Error('fixture callback failure');
			let executions = 0;
			await assert.rejects(
				db.transaction(async (tx) => {
					executions += 1;
					await tx.run('INSERT INTO regression VALUES(1)');
					// Remove the underlying transaction to inject an actual confirmation
					// failure in the driver, without replacing the runtime or worker.
					await tx.exec('ROLLBACK');
					if (phase === 'rollback') {
						throw original;
					}
				}),
				(error) => {
					failure = error;
					return (
						error instanceof SqliteFailure &&
						error.kind === (phase === 'rollback' ? 'rollback_failed' : 'commit_unknown')
					);
				},
			);
			assert.equal(executions, 1);
			if (phase === 'rollback') {
				assert.ok(failure.cause instanceof AggregateError);
				assert.ok(failure.cause.errors.includes(original));
			}
			await assert.rejects(db.all('SELECT * FROM regression'), (error) => error === failure);
			await assert.rejects(db.close(), (error) => error === failure);
			reopened = SqliteRuntime.open(path);
			assert.deepEqual(await reopened.all('SELECT * FROM regression'), []);
		} finally {
			await reopened?.close();
			if (failure) {
				await assert.rejects(db.close(), (error) => error === failure);
			} else {
				await db.close();
			}
			await rm(directory, { recursive: true, force: true });
		}
	});
}
