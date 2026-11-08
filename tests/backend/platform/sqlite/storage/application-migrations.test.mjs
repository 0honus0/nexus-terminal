import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../../../packages/backend/dist/bootstrap/schema.js';
import { createApp } from '../../../../../packages/backend/dist/bootstrap/create-app.js';

test('Production migration chain is contiguous, restartable, atomic on failure and rejects unsigned prototype schemas', async (t) => {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const root = await mkdtemp(join(artifactRoot, 'nexus-owner-'));
	const key = randomBytes(32);
	const databases = [];
	const apps = [];

	function ownDatabase(path) {
		const db = SqliteRuntime.open(path);
		databases.push(db);
		return db;
	}

	t.onTestFinished(async () => {
		const outcomes = await Promise.allSettled(
			[...apps, ...databases].map((resource) => Promise.resolve().then(() => resource.close())),
		);
		const failures = outcomes.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) throw new AggregateError(failures, 'Migration fixture did not drain');
	});
	const migrationVersions = applicationMigrations.map((migration) => migration.version);
	assert.deepEqual(
		migrationVersions,
		Array.from({ length: applicationMigrations.at(-1).version }, (_, index) => index + 1),
		'The complete production migration chain must start at one without gaps or duplicates',
	);
	let db = ownDatabase(join(root, 'current.db'));
	await initializeSchema(db, applicationMigrations);
	await initializeSchema(db, applicationMigrations);
	assert.deepEqual(
		(await db.all('SELECT version FROM schema_version ORDER BY version')).map((row) => row.version),
		migrationVersions,
	);
	await db.close();
	// A failing synthetic v2 must roll back while preserving the initial v1.
	const failPath = join(root, 'failure.db');
	db = ownDatabase(failPath);
	await assert.rejects(
		() =>
			initializeSchema(db, [
				applicationMigrations[0],
				{
					version: 2,
					signature: 'test-only-failing-migration',

					async apply(tx) {
						await tx.exec('CREATE TABLE temporary_failure(id INTEGER PRIMARY KEY)');
						throw new Error('migration interrupted');
					},
				},
			]),
		/migration interrupted/,
	);
	assert.deepEqual(
		(await db.all('SELECT version FROM schema_version ORDER BY version')).map((r) => r.version),
		[1],
	);
	assert.equal(await db.one("SELECT name FROM sqlite_master WHERE name='temporary_failure'"), null);
	await db.close();
	const recovered = await createApp(failPath, { encryptionKey: key });
	apps.push(recovered);
	await recovered.close();
	db = ownDatabase(failPath);
	assert.deepEqual(
		(await db.all('SELECT version FROM schema_version ORDER BY version')).map((r) => r.version),
		migrationVersions,
	);
	await db.close();
	// Reject the first batch's incompatible pre-release v1 instead of silently
	// treating its missing credential tables as the new v1 layout.
	const prototypePath = join(root, 'prototype-v1.db');
	db = ownDatabase(prototypePath);
	await db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)');
	await db.run('INSERT INTO schema_version(version,applied_at) VALUES(1,?)', [Date.now()]);
	await db.close();
	await assert.rejects(
		() => createApp(prototypePath, { encryptionKey: key }),
		/Incompatible pre-release database schema/,
	);
});
