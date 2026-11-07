import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';
import { ModuleRuntimeFailure } from '../../../packages/backend/dist/platform/isolation/module-runtime.js';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { PluginRuntimeService } from '../../../packages/backend/dist/modules/agent/plugins/service/plugin-runtime-service.js';
import { pinnedExecutionFixture } from '../../support/pinned-plugin-package.mjs';

const base = '/api/v1/agent/plugins/installations/';
const executionFixture = await pinnedExecutionFixture();
const contributions = {
	app: { execution: { kind: 'self', protocol: 1 }, toolNames: ['lifecycle_probe'], dependencies: [] },
	tools: [
		{
			name: 'lifecycle_probe',
			description: 'Record the first invocation of this isolated runtime instance.',
			inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
			executionProfile: 'general',
			hostOperations: [],
			childAccess: 'root-only',
			discovery: { mode: 'initial', loader: false, keywords: [] },
		},
	],
	ui: true,
	skills: [],
};
const backend = `import policy from './nexus-policy.mjs';
let sdk;
let recorded = false;
export default {
 ...policy,
 async activate(value) {
 await policy.activate(value);
 sdk = value;
 },
 async agent() {
 if (recorded) return { text: 'runtime-ready' };
 const previous = await sdk.request({ method: 'storage.get', params: { key: 'activations' } });
 if (!previous.ok) throw new Error('activation read failed');
 const saved = await sdk.request({ method: 'storage.put', params: {
  key: 'activations', expectedVersion: previous.result.value?.version ?? 0,
  operationId: crypto.randomUUID(), valueJson: JSON.stringify((JSON.parse(previous.result.value?.valueJson ?? '0')) + 1)
 } });
 if (!saved.ok) throw new Error('activation write failed');
 recorded = true;
 return { text: 'runtime-ready' };
 },
 async quiesce() {
 policy.quiesce();
 try {
  await sdk.request({ method: 'storage.put', params: { key: 'late', expectedVersion: 0, operationId: crypto.randomUUID(), valueJson: 'true' } });
 } catch { return; }
 throw new Error('late request was accepted after quiesce');
 }
};
`;

function runtimeOptions(module = backend) {
	return { ...executionFixture, contributions, capabilities: ['plugin.invoke'], backend: module };
}

async function openRuntimeLifecycle(t) {
	let runtime;
	const reconcile = PluginRuntimeService.prototype.reconcile;
	t.mock.method(PluginRuntimeService.prototype, 'reconcile', function (...args) {
		runtime = this;
		return reconcile.apply(this, args);
	});
	const fixture = await openPlugins(t);
	return {
		...fixture,

		async invoke(plugin) {
			assert.ok(runtime, 'Observe the actual runtime owner without replacing its implementation');
			const binding = expectStatus(
				await fixture.api('GET', '/api/v1/agent/plugins/apps/bindings'),
				200,
			).bindings.find((item) => item.appId === plugin.appId);
			assert.ok(binding);
			const result = await runtime.invokeAgent(
				1,
				plugin.appId,
				binding.executionRevision,
				{
					kind: 'tool',
					runId: randomUUID(),
					stepIndex: 1,
					operationId: randomUUID(),
					name: 'lifecycle_probe',
					argumentsJson: '{}',
				},
				new AbortController().signal,
				15000,
				plugin.installation.definitionId,
				{
					profile: 'general',
					hostOperations: [],
					target: null,

					invokeOperation: async () => assert.fail('Lifecycle probe must not invoke a domain operation'),
				},
			);
			assert.equal(result, 'runtime-ready');
		},
	};
}

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
		const f = await openRuntimeLifecycle(t);
		const plugin = await f.install('lifecycle', runtimeOptions());
		await f.invoke(plugin);
		const owner = api(f, plugin);
		let previous;
		let child;
		await t.test(
			'active child records its first invocation and acknowledgement is forbidden while bound',
			async () => {
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
			},
		);
		await t.test('disable rejects SDK call inside real quiesce and waits original process exit', async () => {
			await plugin.enabled(false);
			assert.equal((await owner.runtime()).state, 'closed');
			await assertExited(child);
			assert.deepEqual(await readdir(f.database + '.modules'), []);
		});
		await t.test('reenable creates new owner without late write and preserves original history', async () => {
			await plugin.enabled(true);
			await f.invoke(plugin);
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
				...runtimeOptions(`import policy from './nexus-policy.mjs';
export default { ...policy, health() { return false; } };`),
				enabled: false,
			});
			const app = expectStatus(await f.api('GET', unhealthy.appPath), 200);
			expectStatus(await f.api('PATCH', unhealthy.appPath, { expectedVersion: app.version, enabled: true }), 200);
			await assert.rejects(
				f.invoke(unhealthy),
				(error) => error instanceof AgentFailure && error.code === 'provider_unavailable',
			);
			assert.equal((await api(f, unhealthy).runtime()).state, 'closed');
			assert.deepEqual(await readdir(f.database + '.modules'), []);
			await unhealthy.enabled(false);
		});
		await t.test('unhealthy plugin does not prevent another actual runtime from starting and closing', async () => {
			await plugin.enabled(true);
			await f.invoke(plugin);
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
		const f = await openRuntimeLifecycle(t);
		const plugin = await f.install('killed-runtime', runtimeOptions());
		await f.invoke(plugin);
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
			assert.equal(
				expectStatus(await owner.ack({ ...acknowledgement, instanceId: randomUUID() }), 404).code,
				'not_found',
			);
			for (const change of [
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
				await f.invoke(plugin);
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
