import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../packages/backend/dist/bootstrap/schema.js';
import { SqlitePluginStorage } from '../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-sql.js';
import { registerAgentSnapshot } from '../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-registration.js';

await test('Plugin package migration: shared global version becomes user-owned stages and legacy data stays manageable', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-plugin-migration-'));
	const db = SqliteRuntime.open(join(directory, 'migration.db'));
	t.after(async () => {
		try {
			await db.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await initializeSchema(
		db,
		applicationMigrations.filter((migration) => migration.version <= 11),
	);
	const packageId = 'test.shared-legacy';
	const packageHash = 'a'.repeat(64),
		publisherKeyId = 'ed25519:' + 'b'.repeat(64);
	const manifest = JSON.stringify({
		schemaVersion: 1,
		id: packageId,
		version: '1.0.0',
		displayName: 'Legacy package',
		sdkVersion: '1',
		capabilities: [],
		intents: [],
		frontendEntry: null,
		backendEntry: null,
	});
	await db.run('INSERT INTO agent_app_definitions VALUES(?,?,?,?)', [
		packageId,
		'1.0.0',
		'Legacy package',
		packageHash,
	]);
	const owners = [1, 2].map((userId) => ({
		userId,
		appId: randomUUID(),
		stageId: randomUUID(),
		operationId: randomUUID(),
	}));
	for (const { userId, appId, stageId, operationId } of owners) {
		await db.run('INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(?,?,?,1,1)', [
			userId,
			'migration-user-' + userId,
			'unused',
		]);
		await db.run(
			'INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,1,1)',
			[appId, userId, 'Legacy App', packageId, '1.0.0'],
		);
		await db.run("INSERT INTO agent_plugin_stages VALUES(?,?,?,1024,'verified',1,?,?,1,1)", [
			stageId,
			userId,
			packageHash,
			publisherKeyId,
			manifest,
		]);
		await db.run("INSERT INTO agent_plugin_installations VALUES(?,?,?,?,?,?,'installed',1,1,1)", [
			userId,
			appId,
			packageId,
			'1.0.0',
			packageHash,
			publisherKeyId,
		]);
		await db.run("INSERT INTO agent_plugin_data VALUES(?,?,'kept',1,?,1)", [
			userId,
			appId,
			JSON.stringify({ userId }),
		]);
		await db.run("INSERT INTO agent_plugin_data_operations VALUES(?,?,?,?, 'kept',1,?,1,0)", [
			userId,
			appId,
			operationId,
			'c'.repeat(64),
			JSON.stringify({ userId }),
		]);
	}
	await db.run('INSERT INTO agent_plugin_versions VALUES(?,?,?,?,?,?)', [
		packageId,
		'1.0.0',
		packageHash,
		publisherKeyId,
		owners[0].stageId,
		manifest,
	]);
	await initializeSchema(
		db,
		applicationMigrations.filter((migration) => migration.version <= 12),
	);
	const scoped = await db.all('SELECT user_id,stage_id FROM agent_plugin_versions ORDER BY user_id');
	assert.deepEqual(
		scoped.map(({ user_id, stage_id }) => ({ user_id, stage_id })),
		owners.map(({ userId, stageId }) => ({ user_id: userId, stage_id: stageId })),
		'each user keeps their own verified stage rather than borrowing another tenant source',
	);
	await initializeSchema(db, applicationMigrations);
	assert.deepEqual(
		(await db.all('SELECT enabled FROM agent_apps ORDER BY user_id')).map((row) => row.enabled),
		[0, 0],
	);
	assert.deepEqual(
		(await db.all('SELECT status FROM agent_plugin_packages ORDER BY user_id')).map((row) => row.status),
		['incompatible', 'incompatible'],
	);
	assert.deepEqual(
		(await db.all('SELECT status FROM agent_plugin_installations ORDER BY user_id')).map((row) => row.status),
		['removed', 'removed'],
	);
	const legacy = await db.all(
		'SELECT user_id,stage_id,manifest_json,size_bytes FROM agent_plugin_legacy_versions ORDER BY user_id',
	);
	assert.deepEqual(
		legacy.map(({ user_id, stage_id, manifest_json, size_bytes }) => ({
			user_id,
			stage_id,
			manifest_json,
			size_bytes,
		})),
		owners.map(({ userId, stageId }) => ({
			user_id: userId,
			stage_id: stageId,
			manifest_json: manifest,
			size_bytes: 1024,
		})),
		'the original signed declaration and source size remain available as historical evidence',
	);
	assert.deepEqual(
		(await db.all('SELECT value_json FROM agent_plugin_data ORDER BY user_id')).map((row) =>
			JSON.parse(row.value_json),
		),
		[{ userId: 1 }, { userId: 2 }],
	);
	assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
	const storage = new SqlitePluginStorage(db);
	storage.installTransactionIdentityReader(async (_tx, digest) => (digest === 'first-session' ? 1 : 2));
	const cleared = [];
	storage.installConfigurationLifecycle({
		clear: async (_tx, userId, appId) => {
			cleared.push({ userId, appId });
		},

		retainedApps: async () => [],
	});

	const admit = (userId, current, referenced, closed) => {
		assert.equal(userId, 1);
		assert.equal(current.package.packageId, packageId);
		assert.equal(referenced, false);
		assert.equal(closed, true);
	};

	await storage.removePackage(1, 'first-session', packageId, 1, false, 2, admit);
	assert.deepEqual(await storage.packageRetainedData(1), [packageId]);
	assert.equal((await db.one('SELECT value_json FROM agent_plugin_data WHERE user_id=1')).value_json, '{"userId":1}');
	await storage.removePackage(1, 'first-session', packageId, 2, true, 3, admit);
	assert.deepEqual(await storage.packageRetainedData(1), []);
	assert.equal((await db.one('SELECT value_json FROM agent_plugin_data WHERE user_id=1')).value_json, null);
	const retired = await db.one('SELECT value_json,retired FROM agent_plugin_data_operations WHERE user_id=1');
	assert.equal(retired.value_json, null);
	assert.equal(retired.retired, 1);
	assert.equal(
		(await db.one('SELECT value_json FROM agent_plugin_data WHERE user_id=2')).value_json,
		'{"userId":2}',
		'clearing one owner never clears the other user',
	);
	assert.deepEqual(cleared, [{ userId: 1, appId: owners[0].appId }]);
	const registration = registerAgentSnapshot(null, () => {});
	const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_plugin_%'");
	for (const { name } of tables) {
		const declared = registration.tables.find((table) => table.name === name);
		assert.ok(declared, 'snapshot registration covers migrated table ' + name);
		const columns = (await db.all('PRAGMA table_info(' + name + ')')).map((row) => row.name).sort();
		assert.deepEqual(
			[...declared.columns].sort(),
			columns,
			'snapshot registration preserves every column of ' + name,
		);
	}
	const dataTable = registration.tables.find((table) => table.name === 'agent_plugin_data');
	const original = await db.one('SELECT * FROM agent_plugin_data WHERE user_id=2');
	assert.deepEqual(
		Object.entries(registration.restore(dataTable, registration.transfer(dataTable, original))),
		Object.entries(original),
	);
});
