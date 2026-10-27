import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { PluginModel } from '../../../packages/backend/dist/modules/agent/plugins/model/plugin-model.js';
import { PluginRuntimeService } from '../../../packages/backend/dist/modules/agent/plugins/service/plugin-runtime-service.js';
import { SqlitePluginStorage } from '../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-sql.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { ModuleRuntimeFailure } from '../../../packages/backend/dist/platform/isolation/module-runtime.js';
import { processIdentity } from '../../../packages/backend/dist/platform/isolation/adapters/module-recovery.js';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';

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

await test('The original runtime lifecycle admits 32 waiting tasks and close waits for their actual reads', async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	t.after(() => release());
	const f = await openPlugins(t);
	let owner;
	const reconcile = PluginRuntimeService.prototype.reconcile;
	t.mock.method(PluginRuntimeService.prototype, 'reconcile', function (...args) {
		owner = this;
		return reconcile.apply(this, args);
	});
	const plugin = await f.install('lifecycle-budget', { backend: 'export function health() { return true; }' });
	await plugin.enabled(false);
	assert.ok(owner);
	const targets = PluginModel.prototype.runtimeTargets;
	let entered = 0;
	t.mock.method(PluginModel.prototype, 'runtimeTargets', async function () {
		const result = await targets.call(this);
		assert.deepEqual(result, []);
		entered += 1;
		await gate;
		return result;
	});
	const tasks = Array.from({ length: 32 }, () => owner.reconcile(1, plugin.appId));
	await until(
		() => entered,
		(count) => count === 32,
		'all original lifecycle reads completed before waiting',
	);
	await assert.rejects(owner.reconcile(1, plugin.appId), { code: 'provider_unavailable' });
	assert.equal(entered, 32);
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

await test('Runtime history rotates confirmed closed records and continues constructing instances', async (t) => {
	const f = await openPlugins(t);
	const plugin = await f.install('history-budget', { backend: 'export function health() { return true; }' });
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
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_plugin_runtime_history').get().n, 128);
	expectStatus(await enable(f, plugin), 200);
	assert.notEqual(current().instance_id, final.instance_id);
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_plugin_runtime_history').get().n, 128);
	assert.equal(
		expectStatus(await f.api('GET', base + plugin.appId + '/runtime/' + final.instance_id), 200).instanceId,
		final.instance_id,
	);
	await plugin.enabled(false);
	assert.deepEqual(await fs.readdir(f.database + '.modules'), []);
});

await test('Actual runtime directory removal refusal and lost storage acknowledgement preserve both causes', async (t) => {
	const f = await openPlugins(t);
	const plugin = await f.install('mixed-cleanup', { backend: 'export function health() { return true; }' });
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

await test('An actual backend SDK data write with lost acknowledgement remains one durable effect and fences its owner', async (t) => {
	const f = await openPlugins(t);
	const operationId = randomUUID();
	const plugin = await f.install('host-write-unknown', {
		enabled: false,
		backend: `export async function activate({request}) {
 const reply = await request({method:'storage.put',params:{key:'effect',expectedVersion:0,operationId:'${operationId}',valueJson:'"committed-once"'}});
 if (!reply.ok) throw new Error('write acknowledgement unavailable');
}
export function health() { return true; }`,
	});
	const db = database(t, f);
	const mutate = SqlitePluginStorage.prototype.runtimeMutateData;
	const lost = new SqliteFailure('commit_unknown');
	let dispatched = 0;
	t.mock.method(SqlitePluginStorage.prototype, 'runtimeMutateData', async function (...args) {
		const result = await mutate.apply(this, args);
		dispatched += 1;
		throw lost;
	});
	assert.deepEqual(expectStatus(await enable(f, plugin), 503), { code: 'operation_unknown' });
	assert.equal(dispatched, 1);

	const stored = () =>
		db
			.prepare('SELECT value_json,version FROM agent_plugin_data WHERE app_id=? AND key=?')
			.get(plugin.appId, 'effect');

	assert.deepEqual({ ...stored() }, { value_json: '"committed-once"', version: 1 });
	const observation = db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId);
	assert.equal(observation.state, 'unknown');
	assert.deepEqual(expectStatus(await enable(f, plugin), 503), { code: 'operation_unknown' });
	assert.equal(dispatched, 1, 'fenced owner does not repeat its activate or data mutation');
	t.mock.restoreAll();
	await f.restart((close) => assert.rejects(close, (error) => causes(error).includes(lost)));
	assert.deepEqual({ ...stored() }, { value_json: '"committed-once"', version: 1 });
	assert.deepEqual(
		db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId),
		observation,
	);
	assert.deepEqual(await fs.readdir(f.database + '.modules'), []);
});
