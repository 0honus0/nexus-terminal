import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applicationMigrations } from '../../../packages/backend/dist/bootstrap/schema.js';
import { initializeSchema } from '../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';

await test('Browser configuration migration transfers only unconfigured official instances and survives restart', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-browser-migration-'));
	const path = join(directory, 'state.db');
	let db = SqliteRuntime.open(path);
	t.after(async () => {
		await db.close();
		await rm(directory, { recursive: true, force: true });
	});
	await initializeSchema(
		db,
		applicationMigrations.filter((migration) => migration.version <= 63),
	);
	const markers = await db.all('SELECT * FROM schema_version ORDER BY version');
	const official = 'ed25519:617ec64b03cd6ed1a1ddf373e3a47f38666cdcd27753d674e136a4d0a359a1a0';
	const targets = [
		{
			id: 'review',
			endpoints: [{ url: 'wss://browser.example/cdp', priority: 800, allowPlaintext: false, verifyTls: true }],
			allowedUrlPatterns: ['https://example.test/*'],
		},
	];
	const instances = [];
	for (const userId of [1, 2, 3, 4]) {
		await db.run('INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(?,?,?,1,1)', [
			userId,
			'user-' + userId,
			'opaque-hash',
		]);
		if (userId !== 3) {
			await db.run('INSERT INTO agent_browser_configuration VALUES(?,7,?)', [userId, JSON.stringify(targets)]);
		}
		if (userId === 4) continue; // Former global settings without an installed instance are removed.
		const appId = randomUUID();
		const definition = 'fixture.app-' + userId;
		await db.run("INSERT INTO agent_app_definitions VALUES(?,'1.0.0','Fixture',?)", [definition, 'a'.repeat(64)]);
		await db.run(
			"INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,created_at,updated_at) VALUES(?,?,'Fixture',?,'1.0.0',1,1,1)",
			[appId, userId, definition],
		);
		const stageId = randomUUID();
		const publisher = userId === 2 ? 'ed25519:' + 'b'.repeat(64) : official;
		await db.run("INSERT INTO agent_plugin_stages VALUES(?,?,?,1024,'installed',1,?,'{}',1,1)", [
			stageId,
			userId,
			'a'.repeat(64),
			publisher,
		]);
		await db.run("INSERT INTO agent_plugin_versions VALUES(?,'nexus.tools.browser','2.0.0',?,?,?,'{}')", [
			userId,
			'a'.repeat(64),
			publisher,
			stageId,
		]);
		await db.run(
			"INSERT INTO agent_plugin_packages VALUES(?,'nexus.tools.browser','2.0.0',?,?,'installed',1,1,1)",
			[userId, 'a'.repeat(64), userId === 2 ? 'ed25519:' + 'b'.repeat(64) : official],
		);
		for (const revision of userId === 1 ? [0, 5] : [0]) {
			const id = randomUUID();
			await db.run(
				"INSERT INTO agent_plugin_instances VALUES(?,?,?,'nexus.tools.browser','Browser',1,1,1,?,?,'{}',1,1)",
				[id, userId, appId, revision, revision === 0 ? 0 : 2],
			);
			instances.push({ id, userId, revision });
		}
	}
	await initializeSchema(db, applicationMigrations);
	for (const item of instances) {
		const migrated = item.userId === 1 && item.revision === 0;
		const row = await db.one('SELECT * FROM agent_plugin_instances WHERE id=?', [item.id]);
		assert.equal(row.configuration_revision, migrated ? 1 : item.revision);
		assert.equal(row.schema_revision, migrated ? 1 : item.revision === 0 ? 0 : 2);
		assert.deepEqual(JSON.parse(row.configuration_json), migrated ? { targets } : {});
		assert.equal(row.revision, 1, 'Configuration migration does not impersonate a logical instance edit');
	}
	assert.equal(await db.one("SELECT name FROM sqlite_schema WHERE name='agent_browser_configuration'"), null);
	const committed = await db.all('SELECT * FROM schema_version ORDER BY version');
	assert.deepEqual(committed.slice(0, 63), markers);
	assert.equal(
		committed.find((entry) => entry.version === 64).signature,
		'agent-browser-plugin-configuration-20261108',
	);
	assert.equal(committed.at(-1).version, 65);
	assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
	assert.equal((await db.one('PRAGMA integrity_check')).integrity_check, 'ok');
	const before = await db.all('SELECT * FROM agent_plugin_instances ORDER BY id');
	await db.close();
	db = SqliteRuntime.open(path);
	await initializeSchema(db, applicationMigrations);
	assert.deepEqual(await db.all('SELECT * FROM agent_plugin_instances ORDER BY id'), before);
	assert.deepEqual(await db.all('SELECT * FROM schema_version ORDER BY version'), committed);
});
