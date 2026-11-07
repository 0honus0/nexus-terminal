import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { operationStorageFixture } from '../../support/operation-storage-fixture.mjs';
import { initializeRunTools } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-schema.js';
import { generalizeToolChildren } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-children-migration.js';
import { readToolChild } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-parent-sql.js';

await test('Tool children: historical SQLite migration retains ACP links and strict package identity', async (t) => {
	const db = new DatabaseSync(':memory:');
	t.after(() => db.close());
	// Only unrelated parent tables are reduced; the tool tables and relation migration are production DDL.
	db.exec(`PRAGMA foreign_keys=ON;
	 CREATE TABLE agent_apps(id TEXT,user_id INTEGER,PRIMARY KEY(id,user_id));
	 CREATE TABLE agent_runs(id TEXT,user_id INTEGER,app_id TEXT,PRIMARY KEY(id,user_id,app_id));
	 CREATE TABLE agent_run_model_steps(run_id TEXT,step_index INTEGER,PRIMARY KEY(run_id,step_index));
	 CREATE TABLE agent_tool_jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL);`);
	const tx = {
		exec: async (sql) => {
			db.exec(sql);
		},

		one: async (sql, parameters = []) => db.prepare(sql).get(...parameters) ?? null,
	};
	await initializeRunTools(tx);
	const appId = randomUUID(),
		runId = randomUUID();
	db.prepare('INSERT INTO agent_apps VALUES(?,1)').run(appId);
	db.prepare('INSERT INTO agent_runs VALUES(?,1,?)').run(runId, appId);
	db.prepare('INSERT INTO agent_run_model_steps VALUES(?,1)').run(runId);

	function tool(state) {
		const id = randomUUID();
		db.prepare(
			`INSERT INTO agent_run_tools(
		 id,user_id,app_id,run_id,model_step_index,provider_call_id,tool_name,tool_version,capability,
		 risk,mutation,summary,arguments_json,operation_hash,operation_revision,revision,state,result_text,created_at,updated_at)
		 VALUES(?,1,?,?,1,?,'fixture_status','1','machine.inspect','read',0,'fixture','{}',?,1,1,?,?,1,1)`,
		).run(id, appId, runId, id, 'a'.repeat(64), state, state === 'completed' ? '{}' : null);
		return id;
	}

	const parent = tool('dispatched');
	const permission = tool('cancelled');
	db.prepare('INSERT INTO agent_acp_permissions VALUES(?,?,?,?)').run(
		permission,
		parent,
		'a'.repeat(64),
		'old-permission',
	);
	await generalizeToolChildren(tx);
	assert.deepEqual(
		{ ...db.prepare('SELECT kind,tool_id,parent_id,request_key FROM agent_tool_children').get() },
		{ kind: 'acp_permission', tool_id: permission, parent_id: parent, request_key: 'old-permission' },
	);
	const historical = db.prepare('SELECT * FROM agent_tool_children').get();
	assert.equal(readToolChild(historical).kind, 'acp_permission');
	assert.equal(readToolChild(historical).plugin, null);
	const nested = tool('completed');
	db.prepare(
		`INSERT INTO agent_tool_children(tool_id,parent_id,parent_hash,request_key,kind,package_id,installation_revision,instance_id,instance_revision)
	 VALUES(?,?,?,'plugin-call','plugin_tool','test.package',1,?,1)`,
	).run(nested, parent, 'a'.repeat(64), randomUUID());
	const grandchild = tool('inspected');
	db.prepare(
		`INSERT INTO agent_tool_children(tool_id,parent_id,parent_hash,request_key,kind,package_id,installation_revision,instance_id,instance_revision)
	 VALUES(?,?,?,'nested-plugin-call','plugin_tool','test.package',1,?,1)`,
	).run(grandchild, nested, 'a'.repeat(64), randomUUID());
	const relation = db.prepare('SELECT * FROM agent_tool_children WHERE tool_id=?').get(nested);
	assert.equal(readToolChild(relation).plugin.packageId, 'test.package');
	for (const change of [
		{ tool_id: parent },
		{ parent_hash: 'broken' },
		{ request_key: '' },
		{ installation_revision: 0 },
		{ instance_id: 'broken' },
		{ package_id: 'foreign' },
	])
		assert.throws(() => readToolChild({ ...relation, ...change }));
	assert.throws(
		() =>
			db
				.prepare(
					`INSERT INTO agent_tool_children(tool_id,parent_id,parent_hash,request_key,kind)
	 VALUES(?,?,?,'missing-binding','plugin_tool')`,
				)
				.run(tool('inspected'), parent, 'a'.repeat(64)),
		/CHECK constraint failed/,
	);
});

await test('Tool children: current SQLite completion joins each level and propagates unknown descendants', async (t) => {
	for (const state of ['accepted', 'dispatched', 'unknown', 'completed', 'failed', 'cancelled'])
		await t.test(state, async (st) => {
			const f = await operationStorageFixture(st);
			const parent = await f.insert({ state: 'dispatched' });
			const nested = await f.insert({ state: 'dispatched', parentId: parent.id });
			const child = await f.insert({ state, parentId: nested.id });
			const first = await f.model.finish(parent, { state: 'completed', resultJson: '{}' });
			assert.equal(
				first.status,
				'children_pending',
				'A dispatched intermediate child cannot hide its descendants',
			);
			const joined = await f.model.finish(nested, { state: 'completed', resultJson: '{}' });
			if (state === 'accepted' || state === 'dispatched') {
				assert.equal(joined.status, 'children_pending');
				assert.equal((await f.model.get(f.scope, nested.callerId, nested.operationKey)).state, 'dispatched');
				assert.equal((await f.model.finish(child, { state: 'cancelled' })).status, 'ok');
				assert.equal((await f.model.finish(nested, { state: 'cancelled' })).status, 'ok');
			} else {
				assert.equal(joined.status, 'ok');
				assert.equal(joined.operation.state, state === 'unknown' ? 'unknown' : 'completed');
			}
			const ended = await f.model.finish(parent, { state: 'completed', resultJson: '{}' });
			assert.equal(ended.status, 'ok');
			assert.equal(ended.operation.state, state === 'unknown' ? 'unknown' : 'completed');
			assert.equal(ended.operation.resultJson, state === 'unknown' ? null : '{}');
			assert.equal(
				(await f.model.finish(parent, { state: 'completed', resultJson: '{"late":true}' })).status,
				'version_conflict',
				'A late handler cannot overwrite settled evidence',
			);
		});
});

await test('Tool children: unknown effects remain unknown under failed or cancelled parent settlement', async (t) => {
	for (const terminal of [{ state: 'failed', failureCode: 'forbidden' }, { state: 'cancelled' }])
		await t.test(terminal.state, async (st) => {
			const f = await operationStorageFixture(st);
			const parent = await f.insert({ state: 'dispatched' });
			await f.insert({ state: 'unknown', parentId: parent.id });
			const settled = await f.model.finish(parent, terminal);
			assert.equal(settled.status, 'ok');
			assert.equal(settled.operation.state, 'unknown');
			assert.equal(settled.operation.failureCode, null);
			assert.equal(settled.operation.resultJson, null);
		});
});
