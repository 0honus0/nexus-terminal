import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applicationMigrations } from '../../../packages/backend/dist/bootstrap/schema.js';
import { initializeSchema } from '../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { registerAgentSnapshot } from '../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-registration.js';
import { readToolOperation } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-row.js';
import { SqlitePluginStorage } from '../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-sql.js';

await test('All tools snapshots: production migrations from 25 through current survive reopening and register every actual Agent table column', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-all-tools-snapshot-'));
	const path = join(directory, 'audit.db');
	let db = SqliteRuntime.open(path);
	t.after(async () => {
		try {
			await db.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await initializeSchema(
		db,
		applicationMigrations.filter((migration) => migration.version <= 25),
	);
	const packageId = 'test.retained-migration';
	const publisher = 'ed25519:' + 'd'.repeat(64);
	const hash = 'a'.repeat(64);
	const currentStage = randomUUID();
	const candidateStage = randomUUID();

	const historicalManifest = (version) =>
		JSON.stringify({
			schemaVersion: 2,
			id: packageId,
			version,
			displayName: 'Retained migration',
			compatibility: { host: { minVersion: '1.0.0', maxVersion: '1.99.99' }, backendSdk: 2, frontendSdk: null },
			capabilities: ['file.read'],
			intents: [],
			frontendEntry: null,
			backendEntry: 'backend/index.mjs',
			contributions: {
				app: null,
				ui: false,
				skills: [],
				tools: [
					{
						name: 'file_read',
						description: 'Historical read',
						inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
						capability: 'file.read',
						risk: 'read',
						mutation: false,
						scheduling: 'parallel',
						discovery: 'initial',
						executionProfile: 'remote-files-read',
					},
				],
			},
		});

	await db.run(
		"INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(1,'snapshot-audit','unused',1,1)",
	);
	for (const [id, version, status] of [
		[currentStage, '1.0.0', 'installed'],
		[candidateStage, '2.0.0', 'verified'],
	]) {
		await db.run('INSERT INTO agent_plugin_stages VALUES(?,1,?,1024,?,1,?,?,1,1)', [
			id,
			hash,
			status,
			publisher,
			historicalManifest(version),
		]);
	}
	await db.run('INSERT INTO agent_plugin_versions VALUES(1,?,?,?,?,?,?)', [
		packageId,
		'1.0.0',
		hash,
		publisher,
		currentStage,
		historicalManifest('1.0.0'),
	]);
	await db.run("INSERT INTO agent_plugin_packages VALUES(1,?,'1.0.0',?,?,'draining',3,1,1)", [
		packageId,
		hash,
		publisher,
	]);
	await db.run('INSERT INTO agent_plugin_package_updates VALUES(1,?,?,1,1,1)', [packageId, candidateStage]);
	const before = await db.all('SELECT * FROM schema_version ORDER BY version');
	await initializeSchema(db, applicationMigrations);
	const quarantineTables = [
		'agent_plugin_packages',
		'agent_plugin_package_updates',
		'agent_plugin_versions',
		'agent_plugin_legacy_versions',
		'agent_plugin_stages',
	];
	const quarantined = await Promise.all(
		quarantineTables.map((name) => db.all('SELECT * FROM ' + name + ' ORDER BY 1,2')),
	);
	assert.equal(quarantined[0][0].status, 'incompatible');
	assert.equal(quarantined[0][0].revision, 4);
	assert.equal(quarantined[1][0].data_migrated, 1);
	assert.equal(quarantined[1][0].stage_id, candidateStage);
	const applied = await db.all('SELECT * FROM schema_version ORDER BY version');
	assert.deepEqual(
		applied.slice(0, 25),
		before,
		'existing migration signatures and commit timestamps remain immutable',
	);
	assert.deepEqual(
		applied.slice(25).map(({ version, signature }) => ({ version, signature })),
		applicationMigrations
			.filter((migration) => migration.version > 25)
			.map(({ version, signature }) => ({ version, signature })),
	);
	await db.close();
	db = SqliteRuntime.open(path);
	await initializeSchema(db, applicationMigrations);
	assert.deepEqual(
		await db.all('SELECT * FROM schema_version ORDER BY version'),
		applied,
		'reopening does not rerun numbered transformations',
	);
	assert.deepEqual(
		await Promise.all(quarantineTables.map((name) => db.all('SELECT * FROM ' + name + ' ORDER BY 1,2'))),
		quarantined,
		'reopening retains the migrated-data fence and immutable historical proof exactly',
	);
	const plugins = new SqlitePluginStorage(db);
	assert.deepEqual(await plugins.recovery(), [], 'startup stage recovery cannot reactivate retired candidates');
	for (const stage of await plugins.stages(1)) {
		assert.equal(stage.status, 'failed');
		assert.equal(stage.manifest, null);
		assert.equal(stage.publisherKeyId, null);
	}
	const registration = registerAgentSnapshot(null, () => {});
	const tables = await db.all(
		"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_%' ORDER BY name",
	);
	assert.deepEqual(
		[...registration.tables.map((table) => table.name), ...registration.excludedTables].sort(),
		tables.map((table) => table.name),
		'every installed Agent table has one snapshot owner or an explicit technical-cache exclusion',
	);
	assert.deepEqual(registration.excludedTables, ['agent_model_capability_registry']);
	for (const table of registration.tables) {
		const { name } = table;
		assert.deepEqual(
			[...table.columns].sort(),
			(await db.all('PRAGMA table_info(' + name + ')')).map((column) => column.name).sort(),
			'snapshot columns exactly cover production ' + name,
		);
	}
	assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
	assert.equal((await db.one('PRAGMA integrity_check')).integrity_check, 'ok');
});

await test('All tools snapshots: actual transfer and restore preserve exact identity, extra authority and confirmed output references', () => {
	const registration = registerAgentSnapshot(null, () => {});
	const table = registration.tables.find((table) => table.name === 'agent_run_tools');
	const artifactId = randomUUID();
	const row = {
		id: randomUUID(),
		user_id: 1,
		app_id: randomUUID(),
		run_id: randomUUID(),
		model_step_index: 1,
		provider_call_id: 'retained-output',
		tool_name: 'remote.deliver',
		tool_version: '1',
		identity_json: JSON.stringify({ kind: 'host', operation: 'remote.deliver' }),
		capability: 'file.read',
		required_capabilities_json: '["artifacts.write"]',
		target_id: 1,
		target_version: 2,
		risk: 'mutate',
		mutation: 1,
		summary: 'Retained confirmed delivery',
		arguments_json: '{}',
		operation_hash: 'a'.repeat(64),
		operation_revision: 1,
		revision: 2,
		state: 'completed',
		result_text: '{"confirmed":true}',
		output_artifact_ids_json: JSON.stringify([artifactId]),
		created_at: 1,
		updated_at: 2,
	};
	const operation = readToolOperation(row);
	const restored = registration.restore(table, registration.transfer(table, row));
	assert.deepEqual(restored, row);
	assert.deepEqual(readToolOperation(restored), operation);
	assert.deepEqual(operation.requiredCapabilities, ['artifacts.write']);
	assert.deepEqual(operation.outputArtifactIds, [artifactId]);
	assert.deepEqual(operation.identity, { kind: 'host', operation: 'remote.deliver' });
});
