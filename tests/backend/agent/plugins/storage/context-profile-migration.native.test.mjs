import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applicationMigrations } from '../../../../../packages/backend/dist/bootstrap/schema.js';
import { initializeSchema } from '../../../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { defaultExecutionSettings } from '../../../../../packages/backend/dist/modules/agent/execution/service/execution-service.js';
import { executionDocument } from '../../../../../packages/backend/dist/modules/agent/execution/adapters/sqlite/execution-row.js';
import { executionSettings } from '../../../../../packages/backend/dist/modules/agent/execution/adapters/sqlite/execution-sql.js';
import { frozenExecution } from '../../../../../packages/backend/dist/modules/agent/execution/adapters/sqlite/execution-budget-sql.js';
import { readOverrides } from '../../../../../packages/backend/dist/modules/agent/governance/adapters/sqlite/governance-row.js';
import { validateAgentSnapshotDocuments } from '../../../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-documents.js';
import { readAgentExecutionPolicyReplaceRequest } from '../../../../../packages/shared/dist/agent/governance/http-codec.js';
import { InvalidAgentPayload } from '../../../../../packages/shared/dist/agent/http-codec.js';

await test('Context preference migrations preserve original facts through v60, then archive removal deletes the obsolete App history', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-context-profile-'));
	const path = join(directory, 'state.db');
	let db = SqliteRuntime.open(path);
	t.after(async () => {
		try {
			await db.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	const previous = applicationMigrations.filter((migration) => migration.version <= 31);
	await initializeSchema(db, previous);
	const priorMarkers = await db.all('SELECT * FROM schema_version ORDER BY version');
	const appId = randomUUID(),
		threadId = randomUUID(),
		runId = randomUUID(),
		providerId = randomUUID();
	const settings = defaultExecutionSettings();
	settings.version = 7;
	settings.enabled = true;
	settings.updatedAt = 1234;
	const legacy = structuredClone(settings);
	legacy.contextProfile = 'extended';
	legacy.contextCompactionMode = 'conservative';
	const overrides = { maxModelRequests: 7 };
	const legacyOverrides = structuredClone(overrides);
	legacyOverrides.contextProfile = 'normal';
	legacyOverrides.contextCompactionMode = 'aggressive';
	await db.run(
		"INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(1,'migration','unused',1,1)",
	);
	await db.run("INSERT INTO agent_app_definitions VALUES('fixture.policy','1.0.0','Policy',?)", ['a'.repeat(64)]);
	await db.run(
		"INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,created_at,updated_at) VALUES(?,1,'Policy','fixture.policy','1.0.0',1,1,1)",
		[appId],
	);
	await db.run(
		"INSERT INTO agent_threads(id,user_id,app_id,title,created_at,updated_at) VALUES(?,1,?,'History',1,1)",
		[threadId, appId],
	);
	await db.run(
		"INSERT INTO agent_runs(id,user_id,app_id,thread_id,thread_sequence,run_kind,approval_mode,status,version,input_text,deadline_at,selected_connections_json,created_at,updated_at) VALUES(?,1,?,?,1,'root','ask','completed',3,'original prompt',9999,'[]',1,2)",
		[runId, appId, threadId],
	);
	await db.run(
		"INSERT INTO agent_providers(id,user_id,display_name,base_url,protocol,models_json,credential_revision,enabled,version,created_at,updated_at) VALUES(?,1,'Provider','https://provider.invalid','responses','[]',2,1,4,1,1)",
		[providerId],
	);
	const capabilities = '{ "supportsTools": true, "contextWindow": 32768 }';
	const appExecution = '{ "kind": "retired" }';
	await db.run(
		"INSERT INTO agent_run_frozen_inputs(run_id,provider_id,provider_version,credential_revision,model_id,base_url,protocol,capabilities_json,execution_policy,app_execution_json) VALUES(?,?,4,2,'original-model','https://provider.invalid','responses',?,'governed',?)",
		[runId, providerId, capabilities, appExecution],
	);
	const requestHash = 'b'.repeat(64),
		creationHash = 'c'.repeat(64),
		context = '{ "messages": [], "systemPrompt": "original context" }';
	const contentHash = createHash('sha256').update(context).digest('hex');
	await db.run(
		"INSERT INTO agent_run_model_steps(run_id,step_index,state,revision,expected_run_version,request_hash,creation_hash,finish_reason,created_at,updated_at) VALUES(?,1,'completed',2,1,?,?,'stop',1,2)",
		[runId, requestHash, creationHash],
	);
	await db.run('INSERT INTO agent_model_contexts VALUES(?,1,?,?)', [runId, context, contentHash]);
	await db.run('INSERT INTO agent_execution_settings VALUES(1,7,?)', [JSON.stringify(legacy)]);
	await db.run('INSERT INTO agent_run_execution_settings VALUES(?,?)', [runId, JSON.stringify(legacy)]);
	await db.run('INSERT INTO agent_governance_policies VALUES(1,?,9,5,?)', [appId, JSON.stringify(legacyOverrides)]);
	assert.throws(() => executionDocument(JSON.stringify(legacy)));
	assert.throws(() => readOverrides(JSON.stringify(legacyOverrides)));
	const immutableTables = ['agent_runs', 'agent_run_frozen_inputs', 'agent_run_model_steps', 'agent_model_contexts'];
	const originals = new Map();
	for (const table of immutableTables) originals.set(table, await db.all('SELECT * FROM ' + table));

	await initializeSchema(
		db,
		applicationMigrations.filter((migration) => migration.version <= 60),
	);
	assert.deepEqual(await executionSettings(db, 1), settings);
	assert.deepEqual(await frozenExecution(db, runId), settings);
	const policy = await db.one('SELECT * FROM agent_governance_policies WHERE user_id=1 AND app_id=?', [appId]);
	assert.deepEqual(readOverrides(policy.execution_overrides_json), overrides);
	assert.equal(policy.policy_revision, 9);
	assert.equal(policy.execution_version, 5);
	assert.deepEqual((await db.all('SELECT * FROM schema_version ORDER BY version')).slice(0, 31), priorMarkers);
	for (const table of immutableTables)
		assert.deepEqual(await db.all('SELECT * FROM ' + table), originals.get(table), table);
	validateAgentSnapshotDocuments(
		new Map([
			['agent_execution_settings', await db.all('SELECT * FROM agent_execution_settings')],
			['agent_run_execution_settings', await db.all('SELECT * FROM agent_run_execution_settings')],
		]),
	);
	const migrated = new Map();
	for (const table of [
		'agent_execution_settings',
		'agent_run_execution_settings',
		'agent_governance_policies',
		'schema_version',
	])
		migrated.set(table, await db.all('SELECT * FROM ' + table));
	await db.close();
	db = SqliteRuntime.open(path);
	await initializeSchema(
		db,
		applicationMigrations.filter((migration) => migration.version <= 60),
	);
	for (const [table, rows] of migrated)
		assert.deepEqual(await db.all('SELECT * FROM ' + table), rows, table + ' is unchanged after restart');
	for (const table of immutableTables)
		assert.deepEqual(await db.all('SELECT * FROM ' + table), originals.get(table), table);
	const provider = await db.one('SELECT * FROM agent_providers WHERE id=?', [providerId]);
	await initializeSchema(db, applicationMigrations);
	assert.deepEqual(await executionSettings(db, 1), settings);
	assert.deepEqual(await db.one('SELECT * FROM agent_providers WHERE id=?', [providerId]), provider);
	assert.equal(await db.one('SELECT * FROM agent_runs WHERE id=?', [runId]), null);
	assert.equal(await db.one('SELECT * FROM agent_apps WHERE id=?', [appId]), null);
	assert.equal(await db.one("SELECT * FROM agent_app_definitions WHERE id='fixture.policy'"), null);
	for (const table of immutableTables.slice(1)) {
		assert.equal(await db.one('SELECT name FROM sqlite_master WHERE name=?', [table]), null);
	}
	assert.deepEqual((await db.all('SELECT * FROM schema_version ORDER BY version')).slice(0, 31), priorMarkers);
	const currentMarkers = await db.all('SELECT * FROM schema_version ORDER BY version');
	await db.close();
	db = SqliteRuntime.open(path);
	await initializeSchema(db, applicationMigrations);
	assert.deepEqual(await db.all('SELECT * FROM schema_version ORDER BY version'), currentMarkers);
	assert.deepEqual(await executionSettings(db, 1), settings);
	assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
});

await test('Current Host policy rejects retired profiles and App-specific compaction settings', () => {
	for (const overrides of [{ contextProfile: 'normal' }, { contextCompactionMode: 'balanced' }]) {
		assert.throws(
			() => readAgentExecutionPolicyReplaceRequest({ expectedVersion: 0, overrides }),
			InvalidAgentPayload,
		);
	}
	assert.deepEqual(
		readAgentExecutionPolicyReplaceRequest({ expectedVersion: 0, overrides: { maxModelRequests: 800 } }),
		{ expectedVersion: 0, overrides: { maxModelRequests: 800 } },
	);
});
