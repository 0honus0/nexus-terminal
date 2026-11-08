import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applicationMigrations } from '../../../../../packages/backend/dist/bootstrap/schema.js';
import { initializeSchema } from '../../../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { defaultExecutionSettings } from '../../../../../packages/backend/dist/modules/agent/execution/service/execution-service.js';
import { readAgentExecutionSettingsView } from '../../../../../packages/shared/dist/agent/execution/http-codec.js';

const official = 'ed25519:617ec64b03cd6ed1a1ddf373e3a47f38666cdcd27753d674e136a4d0a359a1a0';

async function seed(db) {
	await initializeSchema(
		db,
		applicationMigrations.filter((migration) => migration.version <= 64),
	);
	const instances = [];
	for (const userId of [1, 2, 3]) {
		await db.run('INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(?,?,?,1,1)', [
			userId,
			'user-' + userId,
			'unused',
		]);
		const settings = defaultExecutionSettings();
		settings.version = 1;
		settings.limits.maxRecallItems = 70;
		settings.limits.maxRecallBytes = 250000;
		settings.hardLimits.maxRecallItems = 100;
		settings.hardLimits.maxRecallBytes = 900000;
		if (userId !== 3)
			await db.run('INSERT INTO agent_execution_settings VALUES(?,1,?)', [userId, JSON.stringify(settings)]);
		await db.run('INSERT INTO agent_hard_limit_confirmations VALUES(?,?,1,?,10000,NULL)', [
			randomUUID(),
			userId,
			JSON.stringify(settings.hardLimits),
		]);
		const stageId = randomUUID();
		const publisher = userId === 2 ? 'ed25519:' + 'b'.repeat(64) : official;
		await db.run("INSERT INTO agent_plugin_stages VALUES(?,?,?,1024,'installed',1,?,'{}',1,1)", [
			stageId,
			userId,
			'a'.repeat(64),
			publisher,
		]);
		await db.run("INSERT INTO agent_plugin_versions VALUES(?,'nexus.tools.agent','2.0.0',?,?,?,'{}')", [
			userId,
			'a'.repeat(64),
			publisher,
			stageId,
		]);
		await db.run("INSERT INTO agent_plugin_packages VALUES(?,'nexus.tools.agent','2.0.0',?,?,'installed',1,1,1)", [
			userId,
			'a'.repeat(64),
			publisher,
		]);
		for (const override of [false, true]) {
			const appId = randomUUID();
			const definition = 'fixture.app-' + userId + '-' + override;
			await db.run("INSERT INTO agent_app_definitions VALUES(?,'1.0.0','Fixture',?)", [
				definition,
				'a'.repeat(64),
			]);
			await db.run(
				"INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,created_at,updated_at) VALUES(?,?,'Fixture',?,'1.0.0',1,1,1)",
				[appId, userId, definition],
			);
			await db.run('INSERT INTO agent_governance_policies VALUES(?,?,0,0,?)', [
				userId,
				appId,
				JSON.stringify(override ? { maxRecallItems: 30, maxRecallBytes: 500000, maxModelRequests: 9 } : {}),
			]);
			const threadId = randomUUID(),
				runId = randomUUID();
			await db.run(
				"INSERT INTO agent_threads(id,user_id,app_id,title,version,created_at,updated_at) VALUES(?,?,?,'Fixture',1,1,1)",
				[threadId, userId, appId],
			);
			await db.run(
				"INSERT INTO agent_runs(id,user_id,app_id,thread_id,thread_sequence,run_kind,status,version,input_text,selected_connections_json,created_at,updated_at,deadline_at,approval_mode) VALUES(?,?,?,?,1,'root','completed',1,'input','[]',1,1,10000,'ask')",
				[runId, userId, appId, threadId],
			);
			await db.run('INSERT INTO agent_run_execution_settings VALUES(?,?)', [runId, JSON.stringify(settings)]);
			for (const revision of [0, 4]) {
				const id = randomUUID();
				const document = revision === 0 ? '{}' : '{"maxRecallItems":99,"maxRecallBytes":777777}';
				await db.run(
					"INSERT INTO agent_plugin_instances VALUES(?,?,?,'nexus.tools.agent','Memory',1,1,7,?,?,?,1,1)",
					[id, userId, appId, revision, revision === 0 ? 0 : 1, document],
				);
				instances.push({ id, userId, override, revision, document });
			}
		}
	}
	return instances;
}

test('Recall migration preserves effective App policy only in unconfigured official instances and is restart safe', async (t) => {
	assert.deepEqual(
		applicationMigrations.map((migration) => migration.version),
		Array.from({ length: applicationMigrations.length }, (_, index) => index + 1),
		'bootstrap migration order must match the persistent sequence used by backup signatures',
	);
	const directory = await mkdtemp(join(tmpdir(), 'nexus-recall-migration-'));
	const path = join(directory, 'state.db');
	let db = SqliteRuntime.open(path);
	t.after(async () => {
		await db.close();
		await rm(directory, { recursive: true, force: true });
	});
	const instances = await seed(db);
	const markers = await db.all('SELECT * FROM schema_version ORDER BY version');
	await initializeSchema(db, applicationMigrations);
	for (const item of instances) {
		const migrated = item.userId !== 2 && item.revision === 0;
		const row = await db.one('SELECT * FROM agent_plugin_instances WHERE id=?', [item.id]);
		assert.equal(row.configuration_revision, migrated ? 1 : item.revision);
		assert.equal(row.schema_revision, migrated || item.revision ? 1 : 0);
		assert.equal(row.revision, 7);
		assert.deepEqual(
			JSON.parse(row.configuration_json),
			migrated
				? {
						maxRecallItems: item.userId === 3 ? 5 : item.override ? 30 : 70,
						maxRecallBytes: item.userId === 3 ? 8192 : 250000,
					}
				: JSON.parse(item.document),
		);
	}
	for (const table of ['agent_execution_settings', 'agent_run_execution_settings']) {
		for (const row of await db.all('SELECT settings_json FROM ' + table)) {
			const settings = JSON.parse(row.settings_json);
			assert.equal(settings.limits.maxRecallItems, undefined);
			assert.equal(settings.hardLimits.maxRecallBytes, undefined);
			assert.equal(readAgentExecutionSettingsView(settings).limits.maxModelRequests, 80);
		}
	}
	for (const row of await db.all('SELECT execution_overrides_json FROM agent_governance_policies')) {
		const value = JSON.parse(row.execution_overrides_json);
		assert.deepEqual(Object.keys(value), value.maxModelRequests ? ['maxModelRequests'] : []);
	}
	for (const row of await db.all('SELECT proposed_json FROM agent_hard_limit_confirmations')) {
		assert.equal(JSON.parse(row.proposed_json).maxRecallItems, undefined);
		assert.equal(JSON.parse(row.proposed_json).maxModelRequests, 400);
	}
	const committed = await db.all('SELECT * FROM schema_version ORDER BY version');
	assert.deepEqual(committed.slice(0, 64), markers);
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

test('Recall migration rolls back configuration and markers when legacy cleanup fails', async (t) => {
	const db = SqliteRuntime.openMemory();
	t.after(() => db.close());
	await seed(db);
	const before = await db.all('SELECT * FROM agent_plugin_instances ORDER BY id');
	await db.exec(
		"CREATE TRIGGER reject_recall_cleanup BEFORE UPDATE ON agent_execution_settings BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END;",
	);
	await assert.rejects(initializeSchema(db, applicationMigrations));
	assert.deepEqual(await db.all('SELECT * FROM agent_plugin_instances ORDER BY id'), before);
	assert.equal((await db.one('SELECT max(version) AS version FROM schema_version')).version, 64);
	await db.exec('DROP TRIGGER reject_recall_cleanup');
	await initializeSchema(db, applicationMigrations);
	assert.equal((await db.one('SELECT max(version) AS version FROM schema_version')).version, 65);
});
