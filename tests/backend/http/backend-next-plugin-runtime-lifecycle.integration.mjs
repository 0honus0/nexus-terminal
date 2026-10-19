import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';
import { ModuleRuntimeFailure } from '../../../packages/backend/dist/platform/isolation/module-runtime.js';

const base = '/api/v1/agent/plugins/installations/';
const backend = `let sdk;
export async function activate(value) {
 sdk = value;
 const previous = await sdk.request({ method: 'storage.get', params: { key: 'activations' } });
 if (!previous.ok) throw new Error('activation read failed');
 const saved = await sdk.request({ method: 'storage.put', params: {
  key: 'activations', expectedVersion: previous.result.value?.version ?? 0,
  operationId: crypto.randomUUID(), valueJson: JSON.stringify((JSON.parse(previous.result.value?.valueJson ?? '0')) + 1)
 } });
 if (!saved.ok) throw new Error('activation write failed');
}
export function health() { return true; }
export async function quiesce() {
 try {
  await sdk.request({ method: 'storage.put', params: { key: 'late', expectedVersion: 0, operationId: crypto.randomUUID(), valueJson: 'true' } });
 } catch { return; }
 throw new Error('late request was accepted after quiesce');
}
export function dispose() {}
`;

async function childIdentity(f) {
	const root = f.database + '.modules';
	const names = await readdir(root);
	assert.equal(names.length, 1);
	const journal = JSON.parse(await readFile(join(root, names[0], '.nexus-process.json'), 'utf8'));
	assert.equal(journal.parent.pid, process.pid);
	const args = (await readFile('/proc/' + journal.child.pid + '/cmdline', 'utf8')).split('\0');
	assert.ok(args.includes(join(root, names[0], '.nexus-runtime.mjs')));
	return journal.child;
}

async function assertExited(identity) {
	try {
		const stat = await readFile('/proc/' + identity.pid + '/stat', 'utf8');
		assert.notEqual(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], identity.started);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}

function api(f, plugin) {
	const path = base + plugin.appId;
	return {
		runtime: async () => expectStatus(await f.api('GET', path + '/runtime'), 200),

		data: async (key) => expectStatus(await f.api('GET', path + '/data/' + key), 200).value,

		ack: (input) => f.api('POST', path + '/runtime/acknowledge', input),

		path,
	};
}

await test(
	'B10 real runtime quiesce fences SDK writes and failed health releases original child',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const plugin = await f.install('lifecycle', { backend });
		const owner = api(f, plugin);
		let previous;
		let child;
		await t.test('active child has durable activation and acknowledgement is forbidden while bound', async () => {
			previous = await owner.runtime();
			child = await childIdentity(f);
			assert.equal(previous.state, 'active');
			assert.equal((await owner.data('activations')).valueJson, '1');
			expectStatus(
				await owner.ack({
					expectedRevision: plugin.installation.revision,
					instanceRevision: previous.revision,
					instanceId: previous.instanceId,
					confirmed: true,
				}),
				409,
			);
		});
		await t.test('disable rejects SDK call inside real quiesce and waits original process exit', async () => {
			await plugin.enabled(false);
			assert.equal((await owner.runtime()).state, 'closed');
			await assertExited(child);
			assert.deepEqual(await readdir(f.database + '.modules'), []);
		});
		await t.test('reenable creates new owner without late write and preserves original history', async () => {
			await plugin.enabled(true);
			assert.notEqual((await owner.runtime()).instanceId, previous.instanceId);
			assert.equal((await owner.data('activations')).valueJson, '2');
			assert.equal(await owner.data('late'), null);
			assert.equal(
				expectStatus(await f.api('GET', owner.path + '/runtime/' + previous.instanceId), 200).state,
				'closed',
			);
			await plugin.enabled(false);
		});
		await t.test('real health rejection closes constructor and leaves no materialized process', async () => {
			const unhealthy = await f.install('unhealthy', {
				backend: 'export function health() { return false; }',
				enabled: false,
			});
			const app = expectStatus(await f.api('GET', unhealthy.appPath), 200);
			assert.equal(
				expectStatus(
					await f.api('PATCH', unhealthy.appPath, { expectedVersion: app.version, enabled: true }),
					503,
				).code,
				'operation_unknown',
			);
			assert.equal((await api(f, unhealthy).runtime()).state, 'closed');
			assert.deepEqual(await readdir(f.database + '.modules'), []);
			await unhealthy.enabled(false);
		});
		await t.test('unhealthy plugin does not prevent another actual runtime from starting and closing', async () => {
			await plugin.enabled(true);
			assert.equal((await owner.data('activations')).valueJson, '3');
			await plugin.enabled(false);
			assert.equal(await owner.runtime().then((value) => value.state), 'closed');
		});
	},
);

await test(
	'B10 killed runtime retains unknown until restart and explicit original-instance acknowledgement',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const plugin = await f.install('killed-runtime', { backend });
		const owner = api(f, plugin);
		const original = await owner.runtime();
		const identity = await childIdentity(f);
		let unknown;
		const acknowledgement = {
			expectedRevision: plugin.installation.revision,
			instanceRevision: original.revision,
			instanceId: original.instanceId,
			confirmed: true,
		};
		await t.test('SIGKILL affects independently verified original child and settles durable unknown', async () => {
			const stat = await readFile('/proc/' + identity.pid + '/stat', 'utf8');
			assert.equal(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], identity.started);
			process.kill(identity.pid, 'SIGKILL');
			unknown = await until(owner.runtime, (value) => value.state === 'unknown', 'original runtime unknown');
			assert.equal(unknown.instanceId, original.instanceId);
			assert.notEqual(unknown.unknownAt, null);
			assert.equal(unknown.acknowledgedAt, null);
			await assertExited(identity);
			assert.deepEqual(await readdir(f.database + '.modules'), []);
		});
		await t.test('same-process acknowledgement cannot bypass retained failed owner', async () => {
			expectStatus(await owner.ack(acknowledgement), 409);
		});
		await t.test(
			'shutdown reports original failure; new bootstrap preserves unknown without autoactivation',
			async () => {
				await f.restart((close) =>
					assert.rejects(close, (error) => {
						assert.ok(error instanceof AggregateError);
						const causes = [error];
						for (const cause of causes) {
							if (cause instanceof AggregateError) causes.push(...cause.errors);
							if (cause instanceof Error && cause.cause) causes.push(cause.cause);
						}
						assert.ok(
							causes.some(
								(cause) => cause instanceof ModuleRuntimeFailure && cause.kind === 'execution_unknown',
							),
						);
						return true;
					}),
				);
				assert.deepEqual(await owner.runtime(), unknown);
				assert.deepEqual(await readdir(f.database + '.modules'), []);
				assert.equal((await owner.data('activations')).valueJson, '1');
			},
		);
		await t.test('wrong instance, revision or confirmation cannot clear unknown', async () => {
			for (const change of [
				{ instanceId: randomUUID() },
				{ instanceRevision: original.revision + 1 },
				{ expectedRevision: plugin.installation.revision + 1 },
			]) {
				expectStatus(await owner.ack({ ...acknowledgement, ...change }), 409);
			}
			expectStatus(await owner.ack({ ...acknowledgement, confirmed: false }), 400);
			assert.deepEqual(await owner.runtime(), unknown);
		});
		await t.test(
			'explicit original-instance acknowledgement is idempotent and does not start execution',
			async () => {
				const acknowledged = expectStatus(await owner.ack(acknowledgement), 200);
				assert.equal(acknowledged.state, 'closed');
				assert.equal(acknowledged.unknownAt, unknown.unknownAt);
				assert.notEqual(acknowledged.acknowledgedAt, null);
				assert.deepEqual(expectStatus(await owner.ack(acknowledgement), 200), acknowledged);
				assert.deepEqual(await readdir(f.database + '.modules'), []);
			},
		);
		await t.test(
			'explicit disable and reenable obtains new instance; old acknowledgement cannot affect it',
			async () => {
				await plugin.enabled(false);
				await plugin.enabled(true);
				const live = await owner.runtime();
				assert.equal(live.state, 'active');
				assert.notEqual(live.instanceId, original.instanceId);
				assert.equal((await owner.data('activations')).valueJson, '2');
				expectStatus(await owner.ack(acknowledgement), 409);
				assert.equal(
					expectStatus(await f.api('GET', owner.path + '/runtime/' + original.instanceId), 200).state,
					'closed',
				);
				await plugin.enabled(false);
			},
		);
	},
);
