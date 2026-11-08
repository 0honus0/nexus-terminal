import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../../../packages/backend/dist/bootstrap/schema.js';
import {
	mutatePluginData,
	readPluginData,
} from '../../../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-data-sql.js';
import {
	readPluginDataSnapshot,
	migratePluginData,
} from '../../../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-migration-sql.js';
import { PluginStorageRefusal } from '../../../../../packages/backend/dist/modules/agent/plugins/storage/plugin-storage.js';
import { decidePluginData } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-rules.js';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

await test('Plugin KV and migration: large namespaces preserve CAS, tombstones, atomicity and receipts', async (t) => {
	const db = SqliteRuntime.openMemory();
	t.after(() => db.close());
	await initializeSchema(db, applicationMigrations);
	const appId = randomUUID(),
		packageId = 'fixture.capacity',
		userId = 1;
	await db.run(
		"INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(1,'capacity','unused',1,1)",
	);
	await db.run("INSERT INTO agent_app_definitions VALUES(?,'4.0.0','Capacity',?)", [packageId, hash(packageId)]);
	await db.run(
		"INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,created_at,updated_at) VALUES(?,1,'Capacity',?,'4.0.0',1,1)",
		[appId, packageId],
	);
	await db.run("INSERT INTO agent_plugin_installations VALUES(1,?,?,'4.0.0',?,?,'installed',1,1,1)", [
		appId,
		packageId,
		hash(packageId),
		'ed25519:' + hash('publisher'),
	]);
	await db.run('INSERT INTO agent_plugin_app_bindings VALUES(1,?,1,1)', [appId]);
	const large = JSON.stringify('x'.repeat(256 * 1024));

	async function write(tx, key, valueJson, expectedVersion = 0) {
		const input = {
			key,
			valueJson,
			expectedVersion,
			operationId: randomUUID(),
			contentHash: hash([key, valueJson, expectedVersion]),
			now: 2,
		};
		return mutatePluginData(tx, userId, appId, input, (current) => decidePluginData(input, current));
	}

	await db.transaction(async (tx) => {
		for (let index = 0; index < 1140; index++) await write(tx, 'key' + index, index < 40 ? large : '{}');
		await write(tx, 'deleted', '{}');
		await write(tx, 'deleted', null, 1);
	});
	const total = await db.one(
		'SELECT COUNT(*) AS keys,SUM(length(CAST(value_json AS BLOB))) AS bytes FROM agent_plugin_data',
	);
	assert.ok(total.keys > 1024);
	assert.ok(total.bytes > 8 * 1024 * 1024);
	await db.transaction((tx) => write(tx, 'after-quota', '{"valid":true}'));
	await assert.rejects(
		db.transaction((tx) => write(tx, 'key0', '"stale"')),
		(error) => error.code === 'version_conflict',
	);
	const snapshot = await db.transaction((tx) => readPluginDataSnapshot(tx, userId, appId));
	assert.equal(snapshot.length, 1141);
	const items = snapshot.map((item) => ({
		packageId: item.packageId,
		key: item.key,
		expectedVersion: item.version,
		valueJson: item.valueJson,
	}));
	items.push({ packageId, key: 'deleted', expectedVersion: 2, valueJson: '{"restored":true}' });

	const migration = (changes = {}, body = items) => {
		const input = { operationId: randomUUID(), expectedRevision: 1, items: body, now: 3, ...changes };
		return { ...input, requestHash: hash(input) };
	};

	const apply = (input) => db.transaction((tx) => migratePluginData(tx, userId, appId, input));

	const conflict = (error) => error instanceof PluginStorageRefusal && error.code === 'version_conflict';

	const facts = async () => ({
		data: await db.all('SELECT * FROM agent_plugin_data ORDER BY key'),
		bindings: await db.all('SELECT * FROM agent_plugin_app_bindings'),
		receipts: await db.all('SELECT * FROM agent_plugin_data_operations ORDER BY operation_id'),
		migrations: await db.all('SELECT * FROM agent_plugin_data_migrations'),
	});

	const before = await facts();
	await assert.rejects(apply(migration({}, items.slice(1))), conflict);
	await assert.rejects(apply(migration({}, [...items, items[0]])), conflict);
	await assert.rejects(
		apply(
			migration(
				{},
				items.map((item, index) => (index === 0 ? { ...item, expectedVersion: 0 } : item)),
			),
		),
		conflict,
	);
	const changed = items.map((item, index) => (index === 0 ? { ...item, valueJson: '{"changed":true}' } : item));
	// The revision check occurs after writes. A stale revision must roll back writes,
	// retired receipts, namespace metadata and the migration receipt together.
	await assert.rejects(apply(migration({ expectedRevision: 2 }, changed)), conflict);
	assert.deepEqual(await facts(), before);
	const accepted = migration({}, changed);
	const result = await apply(accepted);
	assert.equal(result.revision, 2);
	assert.equal(result.changedKeys, 2);
	assert.deepEqual(await apply(accepted), result);
	assert.equal((await db.transaction((tx) => readPluginData(tx, userId, appId, 'deleted'))).version, 3);
	assert.equal(
		(await db.transaction((tx) => readPluginData(tx, userId, appId, changed[0].key))).valueJson,
		'{"changed":true}',
	);
	const version = await db.one('SELECT execution_revision,ui_revision FROM agent_plugin_app_bindings');
	assert.deepEqual({ ...version }, { execution_revision: 2, ui_revision: 2 });
	await assert.rejects(apply({ ...accepted, requestHash: hash('different') }), conflict);
	assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
});

await test('Memory candidates: complete published catalog, long rankings and normal writes beyond 10000 notes', async (t) => {
	const { SqliteMemoryStorage } =
		await import('../../../../../packages/backend/dist/modules/agent/memory/adapters/sqlite/memory-sql.js');
	const { MemoryModel } =
		await import('../../../../../packages/backend/dist/modules/agent/memory/model/memory-model.js');
	const { MemoryService } =
		await import('../../../../../packages/backend/dist/modules/agent/memory/service/memory-service.js');
	const db = SqliteRuntime.openMemory();
	t.after(() => db.close());
	await initializeSchema(db, applicationMigrations);
	const appId = randomUUID(),
		packageId = 'fixture.memory',
		token = 'owned-session';
	await db.run(
		"INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(1,'memory-capacity','unused',1,1)",
	);
	await db.run("INSERT INTO agent_app_definitions VALUES(?,'4.0.0','Memory',?)", [packageId, hash(packageId)]);
	await db.run(
		"INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,created_at,updated_at) VALUES(?,1,'Memory',?,'4.0.0',1,1,1)",
		[appId, packageId],
	);
	let earliest;
	await db.transaction(async (tx) => {
		for (let index = 0; index < 10001; index++) {
			const id = randomUUID();
			earliest ??= id;
			await tx.run(
				"INSERT INTO agent_memories VALUES(?,1,?,'published note',1,'published',NULL,NULL,'publish',?,1,1,?)",
				[id, appId, index + 1, index + 1],
			);
		}
	});
	const storage = new SqliteMemoryStorage(db);
	storage.installTransactionIdentityReader(async (_tx, digest) => (digest === hash(token) ? 1 : null));
	const service = new MemoryService(new MemoryModel(storage, { digest: hash }), { async publish() {} });
	const actor = { kind: 'session', userId: 1, appId, token };
	const proposed = await service.propose(actor, {
		content: 'normal write after 10000 notes '.repeat(3000),
		confidence: 1,
		expiresAt: null,
		sourceRunId: null,
	});
	assert.equal(proposed.status, 'candidate');
	assert.ok(Buffer.byteLength(proposed.content) > 16384);
	const { readAgentMemoryResponse } = await import('../../../../../packages/shared/dist/agent/memory/http-codec.js');
	const stored = await service.get(actor, proposed.id);
	const { userId: _userId, ...view } = stored;
	assert.equal(readAgentMemoryResponse({ memory: view }).memory.content, proposed.content);
	let offset = 0,
		snapshot,
		pages = 0;
	const candidates = [];
	do {
		const page = await service.candidates(actor, { offset, limit: 1 });
		snapshot ??= page.candidatesSha256;
		assert.equal(page.candidatesSha256, snapshot);
		candidates.push(...page.items);
		pages++;
		offset = page.nextOffset;
	} while (offset !== null);
	assert.ok(pages > 1);
	assert.equal(candidates.length, 10001);
	assert.equal(
		candidates.at(-1).id,
		earliest,
		'older published notes beyond the previous 64-record window remain searchable',
	);
	const selected = await service.select(actor, {
		limit: 1,
		candidatesSha256: snapshot,
		items: [{ id: earliest, version: 1, score: 80 }],
	});
	assert.equal(selected.length, 1);
	assert.equal(selected[0].id, earliest);
	assert.equal(selected[0].score, 80);
	const page = await service.candidates(actor, { offset: 0, limit: 100 });
	assert.equal(page.maxItems, 100);
	const references = candidates.slice(0, 100).map((item) => ({ id: item.id, version: item.version, score: 1 }));
	const complete = await service.select(actor, {
		limit: 100,
		candidatesSha256: page.candidatesSha256,
		items: references,
	});
	assert.equal(complete.length, 100, 'Host imposes no second recall policy over plugin settings');
	assert.ok(Buffer.byteLength(JSON.stringify(complete)) > 8192);
	const oversized = candidates.map((item) => ({ id: item.id, version: item.version, score: 1 }));
	await assert.rejects(
		service.select(actor, { limit: oversized.length, candidatesSha256: page.candidatesSha256, items: oversized }),
		(error) => error.code === 'limit_exceeded',
	);

	await assert.rejects(
		service.candidates({ ...actor, token: 'wrong' }, { offset: 0, limit: 1 }),
		(error) => error.code === 'unauthenticated',
	);
});
