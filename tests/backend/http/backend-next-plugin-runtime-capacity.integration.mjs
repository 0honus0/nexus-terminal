import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';
import { processIdentity } from '../../../packages/backend/dist/platform/isolation/adapters/module-recovery.js';

const base = '/api/v1/agent/plugins/installations/';
const idle = 'export function health() { return true; }';

// A signed module holds its actual activate call through the installed SDK, not a substituted owner.
const gated = `export async function activate({request}) {
 const previous = await request({method:'storage.get',params:{key:'entered'}});
 if (!previous.ok) throw new Error('activation read failed');
 const entered = await request({method:'storage.put',params:{key:'entered',expectedVersion:previous.result.value?.version ?? 0,operationId:crypto.randomUUID(),valueJson:JSON.stringify(JSON.parse(previous.result.value?.valueJson ?? '0')+1)}});
 if (!entered.ok) throw new Error('activation write failed');
 while (true) {
  const release = await request({method:'storage.get',params:{key:'release'}});
  if (!release.ok) throw new Error('activation release read failed');
  if (release.result.value?.valueJson === 'true') break;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
}
export function health() { return true; }
`;

function observe(t, promise) {
	const result = Promise.allSettled([promise]);
	t.after(async () => {
		const [value] = await result;
		if (value.status === 'rejected') throw value.reason;
	});
	return promise;
}

function database(t, f) {
	const db = new DatabaseSync(f.database, { readOnly: true });
	t.after(() => db.close());
	return db;
}

async function identities(f) {
	const root = f.database + '.modules';
	return Promise.all(
		(await readdir(root)).map(async (name) => {
			const journal = JSON.parse(await readFile(join(root, name, '.nexus-process.json'), 'utf8'));
			assert.equal(journal.parent.pid, process.pid);
			assert.deepEqual(await processIdentity(journal.child.pid), journal.child);
			const args = (await readFile('/proc/' + journal.child.pid + '/cmdline', 'utf8')).split('\0');
			assert.ok(args.includes(join(root, name, '.nexus-runtime.mjs')));
			return journal.child;
		}),
	);
}

async function enable(f, plugin) {
	const app = expectStatus(await f.api('GET', plugin.appPath), 200);
	return f.api('PATCH', plugin.appPath, { expectedVersion: app.version, enabled: true });
}

await test('B10 actual 32-runtime capacity and concurrent final-slot admission', { timeout: 60000 }, async (t) => {
	const f = await openPlugins(t);
	const db = database(t, f);
	const plugins = [];

	const active = () =>
		db.prepare("SELECT COUNT(*) AS n FROM agent_plugin_runtime_instances WHERE state='active'").get().n;

	await t.test('31 independently installed signed modules own 31 real active children', async () => {
		for (let i = 0; i < 33; i++) {
			plugins.push(await f.install('capacity-' + i, { backend: idle, enabled: i < 31 }));
		}
		assert.equal(active(), 31);
		const children = await identities(f);
		assert.equal(children.length, 31);
		assert.equal(new Set(children.map((child) => child.pid)).size, 31);
	});
	let winner;
	let rejected;
	await t.test('two concurrent enable requests compete for one remaining slot without exceeding 32', async () => {
		const candidates = plugins.slice(31);
		const responses = await Promise.all(candidates.map((plugin) => enable(f, plugin)));
		assert.deepEqual(responses.map((r) => r.status).sort(), [200, 503]);
		const refused = responses.findIndex((r) => r.status === 503);
		assert.equal(expectStatus(responses[refused], 503).code, 'operation_unknown');
		winner = candidates[1 - refused];
		rejected = candidates[refused];
		assert.equal(active(), 32);
		assert.equal((await identities(f)).length, 32);
		assert.equal(
			db.prepare('SELECT COUNT(*) AS n FROM agent_plugin_runtime_instances WHERE app_id=?').get(rejected.appId).n,
			0,
		);
		assert.equal(expectStatus(await f.api('GET', rejected.appPath), 200).enabled, true);
	});
	await t.test('another full-capacity attempt creates neither a child nor a persistent opening record', async () => {
		assert.equal(expectStatus(await enable(f, rejected), 503).code, 'operation_unknown');
		assert.equal(active(), 32);
		assert.equal((await identities(f)).length, 32);
	});
	await t.test('closing one original instance returns exactly one slot to an explicit new request', async () => {
		const original = expectStatus(await f.api('GET', base + winner.appId + '/runtime'), 200);
		const before = await identities(f);
		await winner.enabled(false);
		assert.equal(active(), 31);
		assert.equal(expectStatus(await f.api('GET', base + winner.appId + '/runtime'), 200).state, 'closed');
		expectStatus(await enable(f, rejected), 200);
		assert.equal(active(), 32);
		const after = await identities(f);
		assert.equal(after.length, 32);
		assert.equal(
			before.filter((child) => !after.some((value) => value.pid === child.pid && value.started === child.started))
				.length,
			1,
		);
		assert.notEqual(
			expectStatus(await f.api('GET', base + rejected.appId + '/runtime'), 200).instanceId,
			original.instanceId,
		);
	});
	await t.test('publisher revocation drains all 32 original children and durable instances', async () => {
		const children = await identities(f);
		expectStatus(
			await f.api('DELETE', '/api/v1/agent/plugins/publishers/' + f.publisher.keyId, {
				expectedVersion: f.publisher.version,
			}),
			200,
		);
		assert.equal(active(), 0);
		assert.equal(
			db.prepare("SELECT COUNT(*) AS n FROM agent_plugin_runtime_instances WHERE state!='closed'").get().n,
			0,
		);
		assert.deepEqual(await readdir(f.database + '.modules'), []);
		for (const child of children) assert.equal(await processIdentity(child.pid), null);
	});
});

await test('B10 actual two-construction capacity and shared same-App activation', { timeout: 60000 }, async (t) => {
	let f;
	let db;
	const plugins = [];
	// Register before application cleanup: an unsuccessful assertion must still release real activate waits.
	t.after(async () => {
		if (!db) return;
		const results = await Promise.allSettled(
			plugins.filter((plugin) => current(plugin)?.state === 'opening').map(release),
		);
		const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
		if (failures.length) throw new AggregateError(failures, 'Construction fixture release failed');
	});
	f = await openPlugins(t);
	db = database(t, f);

	const stored = (plugin, key) =>
		db.prepare('SELECT value_json FROM agent_plugin_data WHERE app_id=? AND key=?').get(plugin.appId, key)
			?.value_json;

	const current = (plugin) =>
		db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId);

	for (let i = 0; i < 3; i++) plugins.push(await f.install('construction-' + i, { backend: gated, enabled: false }));

	async function release(plugin) {
		const previous = expectStatus(await f.api('GET', base + plugin.appId + '/data/release'), 200).value;
		expectStatus(
			await f.api('PUT', base + plugin.appId + '/data/release', {
				expectedRevision: plugin.installation.revision,
				expectedVersion: previous?.version ?? 0,
				operationId: randomUUID(),
				valueJson: 'true',
			}),
			200,
		);
	}

	let first;
	let second;
	let duplicate;
	let original;
	await t.test('two actual activates remain opening while their HTTP responses wait', async () => {
		first = observe(t, enable(f, plugins[0]));
		second = observe(t, enable(f, plugins[1]));
		await until(
			() => plugins.slice(0, 2).every((plugin) => stored(plugin, 'entered') === '1'),
			Boolean,
			'two real child activates entered',
		);
		assert.equal(current(plugins[0]).state, 'opening');
		assert.equal(current(plugins[1]).state, 'opening');
		original = current(plugins[0]).instance_id;
		assert.equal((await identities(f)).length, 2);
	});
	await t.test('same-App waiter shares its original opening and third distinct construction is refused', async () => {
		duplicate = observe(t, enable(f, plugins[0]));
		assert.equal(expectStatus(await enable(f, plugins[2]), 503).code, 'operation_unknown');
		assert.equal(current(plugins[2]), undefined);
		assert.equal(current(plugins[0]).instance_id, original);
		assert.equal(stored(plugins[0], 'entered'), '1');
		assert.equal((await identities(f)).length, 2);
	});
	await t.test('original completion settles both same-App waiters and admits an explicit third request', async () => {
		await release(plugins[0]);
		expectStatus(await first, 200);
		expectStatus(await duplicate, 200);
		assert.equal(current(plugins[0]).state, 'active');
		assert.equal(current(plugins[0]).instance_id, original);
		assert.equal(stored(plugins[0], 'entered'), '1');
		const third = observe(t, enable(f, plugins[2]));
		await until(
			() => stored(plugins[2], 'entered'),
			(value) => value === '1',
			'third real activation admitted after first completion',
		);
		await release(plugins[1]);
		await release(plugins[2]);
		expectStatus(await second, 200);
		expectStatus(await third, 200);
		for (const plugin of plugins) assert.equal(current(plugin).state, 'active');
	});
	await t.test(
		'all original constructors close their actual children and return materialized directories',
		async () => {
			const children = await identities(f);
			assert.equal(children.length, 3);
			for (const plugin of plugins) await plugin.enabled(false);
			for (const plugin of plugins) assert.equal(current(plugin).state, 'closed');
			assert.deepEqual(await readdir(f.database + '.modules'), []);
			for (const child of children) assert.equal(await processIdentity(child.pid), null);
		},
	);
});
