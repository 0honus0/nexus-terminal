import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { PluginInstanceService } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-instance-service.js';
import { PluginRuntimeService } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-runtime-service.js';
import { SqlitePluginInstanceStorage } from '../../../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-instance-sql.js';
import { SqlitePluginStorage } from '../../../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-sql.js';
import { SqliteFailure } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { ModuleRuntimeFailure } from '../../../../../packages/backend/dist/platform/isolation/module-runtime.js';
import { processIdentity } from '../../../../../packages/backend/dist/platform/isolation/adapters/module-recovery.js';
import { openPlugins, stopPackageSource } from '../support/plugin-management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';

const base = '/api/v1/agent/plugins/installations/';

function causes(error) {
	const found = new Set();
	const pending = [error];
	for (const value of pending) {
		if (found.has(value)) {
			continue;
		}
		found.add(value);
		if (value instanceof AggregateError) {
			pending.push(...value.errors);
		}
		if (value instanceof Error && value.cause) {
			pending.push(value.cause);
		}
	}
	return [...found];
}

function database(t, f, writable = false) {
	const db = new DatabaseSync(f.database, { readOnly: !writable });
	t.after(() => db.close());
	return db;
}

async function enable(f, plugin) {
	const app = expectStatus(await f.api('GET', plugin.appPath), 200);
	return f.api('PATCH', plugin.appPath, { expectedVersion: app.version, enabled: true });
}

await test('The original runtime lifecycle admits concurrent waiting tasks beyond the former 32 cap and close waits for their actual reads', async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	t.after(() => release());
	const f = await openPlugins((close) => t.after(close));
	let owner;
	const reconcile = PluginRuntimeService.prototype.reconcile;
	t.mock.method(PluginRuntimeService.prototype, 'reconcile', function (...args) {
		owner = this;
		return reconcile.apply(this, args);
	});
	const plugin = await f.install('lifecycle-budget', {});
	await stopPackageSource(f);
	await plugin.enabled(false);
	assert.ok(owner);
	const list = PluginInstanceService.prototype.list;
	let entered = 0;
	t.mock.method(PluginInstanceService.prototype, 'list', async function (...args) {
		const result = await list.apply(this, args);
		if (args[1] === plugin.appId) {
			entered += 1;
			await gate;
		}
		return result;
	});
	const tasks = Array.from({ length: 32 }, () => owner.reconcile(1, plugin.appId));
	await until(
		() => entered,
		(count) => count === 32,
		'all original lifecycle reads completed before waiting',
	);
	tasks.push(owner.reconcile(1, plugin.appId));
	await until(
		() => entered,
		(count) => count === 33,
		'the next task is admitted without a private cap',
	);
	assert.equal(entered, 33);
	owner.quiesce();
	let finished = false;
	const closing = owner.close();
	assert.strictEqual(owner.close(), closing);
	void closing.then(() => {
		finished = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(finished, false);
	release();
	await Promise.all(tasks);
	await closing;
	assert.equal(finished, true);
	assert.deepEqual(await fs.readdir(f.database + '.modules'), []);
});

await test('Runtime history preserves confirmed closed records beyond the former retention cap and continues constructing instances', async (t) => {
	const f = await openPlugins((close) => t.after(close));
	const plugin = await f.install('history-budget', {});
	await stopPackageSource(f);
	await plugin.enabled(false);
	const db = database(t, f, true);

	const current = () => db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId);

	const previous = current();
	assert.equal(previous.state, 'closed');
	const insert = db.prepare(
		'INSERT INTO agent_plugin_runtime_history(user_id,app_id,instance_id,revision,state,updated_at,unknown_at,acknowledged_at) VALUES(?,?,?,?,?,?,?,?)',
	);
	// Seed validated closed observations, not 4095 actual process executions.
	await until(
		() => {
			try {
				db.exec('BEGIN IMMEDIATE');
				return true;
			} catch (error) {
				if (error.errcode === 5) {
					return false;
				}
				throw error;
			}
		},
		Boolean,
		'fixture seed waits for the actual application writer to release its transaction',
	);
	try {
		for (let index = 0; index < 4095; index += 1) {
			insert.run(
				previous.user_id,
				previous.app_id,
				randomUUID(),
				previous.revision,
				'closed',
				previous.updated_at,
				null,
				null,
			);
		}
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
	expectStatus(await enable(f, plugin), 200);
	assert.notEqual(current().instance_id, previous.instance_id);
	await plugin.enabled(false);
	const final = current();
	assert.equal(
		db.prepare('SELECT COUNT(*) AS n FROM agent_plugin_runtime_history WHERE app_id=?').get(plugin.appId).n,
		4096,
	);
	expectStatus(await enable(f, plugin), 200);
	assert.notEqual(current().instance_id, final.instance_id);
	assert.equal(
		db.prepare('SELECT COUNT(*) AS n FROM agent_plugin_runtime_history WHERE app_id=?').get(plugin.appId).n,
		4097,
	);
	assert.equal(
		expectStatus(await f.api('GET', base + plugin.appId + '/runtime/' + final.instance_id), 200).instanceId,
		final.instance_id,
	);
	await plugin.enabled(false);
	assert.deepEqual(await fs.readdir(f.database + '.modules'), []);
});

await test('Actual runtime directory removal refusal and lost storage acknowledgement preserve both causes', async (t) => {
	const f = await openPlugins((close) => t.after(close));
	const plugin = await f.install('mixed-cleanup', {});
	await stopPackageSource(f);
	const db = database(t, f);
	const root = f.database + '.modules';
	const names = await fs.readdir(root);
	assert.equal(names.length, 1);
	const directory = join(root, names[0]);
	const identity = JSON.parse(await fs.readFile(join(directory, '.nexus-process.json'), 'utf8')).child;
	const remove = fs.rm;
	let removal;
	t.mock.method(fs, 'rm', async (path, options) => {
		if (path === directory) {
			try {
				// Real nonempty-directory refusal; do not substitute a successful deletion.
				return await remove(path, { force: true, recursive: false });
			} catch (error) {
				removal = error;
				throw error;
			}
		}
		return remove(path, options);
	});
	syncBuiltinESMExports();
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	const settle = SqlitePluginStorage.prototype.settleRuntime;
	const lost = new SqliteFailure('commit_unknown');
	let settlements = 0;
	t.mock.method(SqlitePluginStorage.prototype, 'settleRuntime', async function (lease, state) {
		const result = await settle.call(this, lease, state);
		if (lease.appId === plugin.appId && state === 'unknown') {
			settlements += 1;
			throw lost;
		}
		return result;
	});
	const app = expectStatus(await f.api('GET', plugin.appPath), 200);
	assert.deepEqual(
		expectStatus(await f.api('PATCH', plugin.appPath, { expectedVersion: app.version, enabled: false }), 503),
		{ code: 'operation_unknown' },
	);
	assert.equal(removal.code, 'ERR_FS_EISDIR');
	assert.equal(settlements, 1);
	assert.equal(await processIdentity(identity.pid), null, 'actual process exit does not prove directory cleanup');
	assert.ok((await fs.stat(directory)).isDirectory());
	const observation = db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId);
	assert.equal(observation.state, 'unknown');
	t.mock.restoreAll();
	syncBuiltinESMExports();
	// Fixture-owned cleanup after independently proving the original child exited.
	await remove(directory, { recursive: true, force: true });
	await f.restart((close) =>
		assert.rejects(close, (error) => {
			const found = causes(error);
			assert.ok(found.includes(removal));
			assert.ok(found.includes(lost));
			assert.ok(found.some((value) => value instanceof ModuleRuntimeFailure && value.kind === 'cleanup_failed'));
			return true;
		}),
	);
	assert.deepEqual(
		db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId),
		observation,
	);
	assert.deepEqual(await fs.readdir(root), []);
});

await test('An actual SDK4 Run data write with lost acknowledgement remains one durable effect and fences its owner', async (t) => {
	const f = await openPlugins((close) => t.after(close));
	const operationId = randomUUID();
	const packageId = 'isolated.b10-host-write-unknown';
	const plugin = await f.install('host-write-unknown', {
		backend: `import { definePlugin } from './sdk.mjs';
  export default definePlugin((plugin) => plugin.register({kind:'app',key:'${packageId}.run',contract:'${packageId}',apiVersion:1,
   summary:'Durable storage acknowledgement probe',instructions:'',inputSchemaJson:'{"type":"object"}',resultSchemaJson:'{"type":"object"}',capabilities:[],tags:[],execution:'managed'},
   async (_, context) => {
    await context.storage.write({namespace:'${packageId}',key:'effect',expectedRevision:0,operationKey:'${operationId}',documentJson:'"committed-once"'});
    return {kind:'complete',outputs:[]};
   }));`,
	});
	await plugin.grants(['plugin.invoke']);
	const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
	expectStatus(
		await f.api('PUT', '/api/v1/agent/execution-settings', {
			expectedVersion: settings.version,
			enabled: true,
			limits: settings.limits,
		}),
		200,
	);
	const db = database(t, f);
	const mutate = SqlitePluginInstanceStorage.prototype.dataWrite;
	const lost = new SqliteFailure('commit_unknown');
	let dispatched = 0;
	t.mock.method(SqlitePluginInstanceStorage.prototype, 'dataWrite', async function (...args) {
		const result = await mutate.apply(this, args);
		dispatched += 1;
		throw lost;
	});
	const thread = expectStatus(
		await f.api('POST', plugin.appPath + '/threads', { title: 'Unknown data effect' }),
		201,
	);
	const path = plugin.appPath + '/threads/' + thread.id + '/runs';
	const input = { prompt: 'Commit once', approvalMode: 'ask', connectionIds: [], inputJson: '{}' };
	const headers = { 'Idempotency-Key': randomUUID() };
	const { run } = expectStatus(await f.api('POST', path, input, headers), 201);
	await until(
		async () => expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200),
		(value) => value.status === 'unknown',
		'unknown storage commit fences its original Run',
	);
	assert.equal(dispatched, 1);

	const stored = () =>
		db
			.prepare('SELECT document_json,revision FROM agent_plugin_private_data WHERE app_id=? AND key=?')
			.get(plugin.appId, 'effect');

	assert.deepEqual({ ...stored() }, { document_json: '"committed-once"', revision: 1 });
	const replay = expectStatus(await f.api('POST', path, input, headers), 200);
	assert.equal(replay.run.id, run.id);
	assert.equal(dispatched, 1, 'replaying the create intent cannot repeat the original private-data effect');
	t.mock.restoreAll();
	await f.restart((close) => assert.rejects(close, (error) => causes(error).includes(lost)));
	assert.deepEqual({ ...stored() }, { document_json: '"committed-once"', revision: 1 });
	assert.equal(expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200).status, 'unknown');
});
