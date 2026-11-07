import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqlitePluginStorage } from '../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-sql.js';

await test('Plugin version visibility: independent contributions and exact shared App references are user scoped and unique', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-plugin-version-visibility-'));
	const db = SqliteRuntime.open(join(directory, 'state.db'));
	t.after(async () => {
		try {
			await db.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	// This owner reads only these immutable/package/reference columns; rows are selected and decoded by production versions(), never substituted.
	await db.exec(`CREATE TABLE agent_plugin_versions(user_id INTEGER,definition_id TEXT,version TEXT,manifest_json TEXT,package_hash TEXT,publisher_key_id TEXT);
	 CREATE TABLE agent_plugin_packages(user_id INTEGER,package_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT,status TEXT);
	 CREATE TABLE agent_plugin_app_packages(user_id INTEGER,app_id TEXT,package_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT,kind TEXT);`);
	const remote = JSON.parse(
		await readFile(
			new URL('../../e2e/fixtures/agent/plugin-source/nexus.tools.remote/manifest.json', import.meta.url),
			'utf8',
		),
	);
	const ui = JSON.parse(
		await readFile(
			new URL('../../e2e/fixtures/agent/plugin-source/nexus.ui.chat/manifest.json', import.meta.url),
			'utf8',
		),
	);
	const hash = 'a'.repeat(64),
		otherHash = 'b'.repeat(64);
	const publisher = 'ed25519:' + 'c'.repeat(64),
		otherPublisher = 'ed25519:' + 'd'.repeat(64);

	const version = async (userId, manifest, packageHash = hash, publisherKeyId = publisher) => {
		await db.run('INSERT INTO agent_plugin_versions VALUES(?,?,?,?,?,?)', [
			userId,
			manifest.id,
			manifest.version,
			JSON.stringify(manifest),
			packageHash,
			publisherKeyId,
		]);
	};

	const installed = async (
		userId,
		manifest,
		status = 'installed',
		packageHash = hash,
		publisherKeyId = publisher,
	) => {
		await db.run('INSERT INTO agent_plugin_packages VALUES(?,?,?,?,?,?)', [
			userId,
			manifest.id,
			manifest.version,
			packageHash,
			publisherKeyId,
			status,
		]);
	};

	const referenced = async (userId, manifest, packageHash = hash, publisherKeyId = publisher) => {
		await db.run('INSERT INTO agent_plugin_app_packages VALUES(?,?,?,?,?,?,?)', [
			userId,
			randomUUID(),
			manifest.id,
			manifest.version,
			packageHash,
			publisherKeyId,
			manifest.contributions.ui ? 'ui' : 'tool',
		]);
	};

	await version(1, remote);
	await installed(1, remote);
	const uiCurrent = { ...ui, version: '2.0.1' };
	await version(1, uiCurrent);
	await installed(1, uiCurrent, 'draining');
	await version(1, ui);
	await referenced(1, ui);
	await referenced(1, ui);
	const removed = { ...ui, id: 'test.removed-ui', version: '1.0.0' };
	await version(1, removed);
	await installed(1, removed, 'removed');
	const unreferenced = { ...ui, version: '1.9.0' };
	await version(1, unreferenced);
	await referenced(2, unreferenced); // Another user's reference cannot expose this user's unreferenced historical version.
	const wrongHash = { ...ui, id: 'test.wrong-hash' };
	await version(1, wrongHash);
	await installed(1, wrongHash, 'installed', otherHash);
	await referenced(1, wrongHash, otherHash);
	const wrongPublisher = { ...ui, id: 'test.wrong-publisher' };
	await version(1, wrongPublisher);
	await installed(1, wrongPublisher, 'installed', hash, otherPublisher);
	await referenced(1, wrongPublisher, hash, otherPublisher);
	const foreign = { ...remote, id: 'test.foreign-tool' };
	await version(2, foreign);
	await installed(2, foreign);
	const legacy = { schemaVersion: 1, id: 'test.legacy-ui', version: '1.0.0' };
	await version(1, legacy);
	await installed(1, legacy);
	const storage = new SqlitePluginStorage(db);
	const visible = await storage.versions(1);
	assert.deepEqual(
		visible.map(({ manifest }) => manifest.id + '@' + manifest.version).sort(),
		[
			remote.id + '@' + remote.version,
			ui.id + '@' + ui.version,
			uiCurrent.id + '@' + uiCurrent.version,
			removed.id + '@' + removed.version,
		].sort(),
	);
	assert.equal(
		visible.filter(({ manifest }) => manifest.id === ui.id && manifest.version === ui.version).length,
		1,
		'two real App references never duplicate one immutable UI version',
	);
	assert.ok(
		visible.some(({ manifest }) => manifest.contributions.app === null && manifest.contributions.tools === true),
		'standalone tools are visible without an App-owned installation row',
	);
	assert.ok(
		visible.some(({ manifest }) => manifest.contributions.app === null && manifest.contributions.ui),
		'standalone UI is visible without an App-owned installation row',
	);
	for (const item of visible) {
		assert.equal(item.packageHash, hash);
		assert.equal(item.publisherKeyId, publisher);
	}
	assert.deepEqual(
		(await storage.versions(2)).map(({ manifest }) => manifest.id),
		[foreign.id],
	);
	assert.deepEqual(await storage.versions(3), []);
});
