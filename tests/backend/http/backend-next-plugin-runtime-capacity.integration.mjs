import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';
import { processIdentity } from '../../../packages/backend/dist/platform/isolation/adapters/module-recovery.js';

const base = '/api/v1/agent/plugins/installations/';
// Gate only the signed fixture's SDK4 setup with a real process signal. No Host authority
// is borrowed during activation and no production admission rule is substituted.
const gated = `import { definePlugin } from './sdk.mjs';
export default definePlugin(async (plugin) => {
 plugin.register({ kind:'app', key:plugin.identity.package.packageId+'.run',
 contract:plugin.identity.package.packageId, apiVersion:1, summary:'Gated SDK4 App',
 instructions:'Complete the submitted task.', inputSchemaJson:'{"type":"object"}',
 resultSchemaJson:'{"type":"object"}', capabilities:[], tags:[], execution:'managed' },
 async () => ({kind:'complete',outputs:[]}));
 await new Promise(resolve => process.once('SIGUSR2',resolve));
});`;

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

async function disableSource(f) {
	const path = '/api/v1/agent/apps/' + f.source.id;
	const app = expectStatus(await f.api('GET', path), 200);
	expectStatus(await f.api('PATCH', path, { expectedVersion: app.version, enabled: false }), 200);
}

await test(
	'SDK4 runtime capacity follows real resources beyond the former 32-instance ceiling',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const db = database(t, f);
		const plugins = [];

		const active = () =>
			db.prepare("SELECT COUNT(*) AS n FROM agent_plugin_runtime_instances WHERE state='active'").get().n;

		await t.test('31 independent signed SDK4 modules own distinct real active children', async () => {
			for (let i = 0; i < 34; i++) {
				plugins.push(await f.install('capacity-' + i, { frontend: false, enabled: false }));
			}
			await disableSource(f);
			for (const plugin of plugins.slice(0, 31)) expectStatus(await enable(f, plugin), 200);
			assert.equal(active(), 31);
			const children = await identities(f);
			assert.equal(children.length, 31);
			assert.equal(new Set(children.map((child) => child.pid)).size, 31);
		});
		await t.test('three concurrent enables all succeed beyond 32 without a private slot ceiling', async () => {
			for (const response of await Promise.all(plugins.slice(31).map((plugin) => enable(f, plugin))))
				expectStatus(response, 200);
			assert.equal(active(), 34);
			assert.equal((await identities(f)).length, 34);
		});
		await t.test('reenabling an active App shares its original runtime', async () => {
			const before = await identities(f);
			for (const response of await Promise.all([enable(f, plugins[33]), enable(f, plugins[32])]))
				expectStatus(response, 200);
			assert.equal(active(), 34);
			assert.deepEqual(await identities(f), before);
		});
		await t.test('explicit close drains the original process and reopening owns a new incarnation', async () => {
			const plugin = plugins[33];
			const original = expectStatus(await f.api('GET', base + plugin.appId + '/runtime'), 200);
			const before = await identities(f);
			await plugin.enabled(false);
			assert.equal(active(), 33);
			assert.equal(expectStatus(await f.api('GET', base + plugin.appId + '/runtime'), 200).state, 'closed');
			const remaining = await identities(f);
			const removed = before.filter(
				(child) => !remaining.some((value) => value.pid === child.pid && value.started === child.started),
			);
			assert.equal(removed.length, 1);
			assert.equal(await processIdentity(removed[0].pid), null);
			expectStatus(await enable(f, plugin), 200);
			assert.equal(active(), 34);
			assert.equal((await identities(f)).length, 34);
			assert.notEqual(
				expectStatus(await f.api('GET', base + plugin.appId + '/runtime'), 200).instanceId,
				original.instanceId,
			);
		});
		await t.test(
			'publisher revocation drains all children, durable instances and materialized directories',
			async () => {
				const children = await identities(f);
				expectStatus(
					await f.api('DELETE', '/api/v1/agent/plugins/publishers/' + f.publisher.keyId, {
						expectedVersion: f.publisher.version,
					}),
					200,
				);
				assert.equal(active(), 0);
				assert.equal(
					db.prepare("SELECT COUNT(*) AS n FROM agent_plugin_runtime_instances WHERE state!='closed'").get()
						.n,
					0,
				);
				assert.deepEqual(await readdir(f.database + '.modules'), []);
				for (const child of children) assert.equal(await processIdentity(child.pid), null);
			},
		);
	},
);

await test(
	'SDK4 concurrent constructions exceed two and same-instance waiters share their actual setup',
	{ timeout: 60000 },
	async (t) => {
		let f;
		t.after(async () => {
			if (f) await release();
		});
		f = await openPlugins(t);
		const db = database(t, f);
		const plugins = [];

		const current = (plugin) =>
			db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId);

		const setupReady = async (child) => {
			try {
				const status = await readFile('/proc/' + child.pid + '/status', 'utf8');
				const caught = /^SigCgt:\s+([0-9a-f]+)$/mu.exec(status);
				return caught !== null && (BigInt('0x' + caught[1]) & (1n << 11n)) !== 0n;
			} catch (error) {
				if (error.code === 'ENOENT') return false;
				throw error;
			}
		};

		const release = async () => {
			for (const child of await identities(f)) if (await setupReady(child)) process.kill(child.pid, 'SIGUSR2');
		};

		const sdk = await readFile(
			new URL('../../../packages/backend/dist-plugin-sdk/backend-v4.mjs', import.meta.url),
		);
		for (let i = 0; i < 3; i++)
			plugins.push(
				await f.install('construction-' + i, {
					frontend: false,
					backend: gated,
					backendAssets: { 'sdk.mjs': sdk },
					enabled: false,
				}),
			);
		await disableSource(f);
		const starts = plugins.map((plugin) => observe(t, enable(f, plugin)));
		await until(
			async () => {
				try {
					const children = await identities(f);
					return children.length === 3 && (await Promise.all(children.map(setupReady))).every(Boolean);
				} catch (error) {
					if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
					throw error;
				}
			},
			Boolean,
			'three actual SDK4 setups entered concurrently',
		);
		const before = await identities(f);
		for (const plugin of plugins) assert.equal(current(plugin).state, 'opening');
		const original = current(plugins[0]).instance_id;
		const duplicate = observe(t, enable(f, plugins[0]));
		assert.equal(current(plugins[0]).state, 'opening');
		assert.equal(current(plugins[0]).instance_id, original);
		assert.deepEqual(await identities(f), before);
		await release();
		for (const response of await Promise.all([...starts, duplicate])) expectStatus(response, 200);
		for (const plugin of plugins) assert.equal(current(plugin).state, 'active');
		assert.equal(current(plugins[0]).instance_id, original);
		assert.deepEqual(await identities(f), before);
		for (const plugin of plugins) await plugin.enabled(false);
		for (const plugin of plugins) assert.equal(current(plugin).state, 'closed');
		assert.deepEqual(await readdir(f.database + '.modules'), []);
		for (const child of before) assert.equal(await processIdentity(child.pid), null);
	},
);
