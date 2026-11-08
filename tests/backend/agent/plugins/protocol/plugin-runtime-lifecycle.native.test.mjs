import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openPlugins, stopPackageSource } from '../support/plugin-management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { ModuleRuntimeFailure } from '../../../../../packages/backend/dist/platform/isolation/module-runtime.js';

const base = '/api/v1/agent/plugins/installations/';
const backend = `import {definePlugin} from './sdk.mjs';
let recorded = false, activeContext;
export default definePlugin(plugin => {
 const namespace = plugin.identity.package.packageId;
 plugin.register({kind:'app',key:namespace+'.run',contract:namespace,apiVersion:1,
 summary:'Lifecycle probe',instructions:'',inputSchemaJson:'{"type":"object"}',resultSchemaJson:'{"type":"object"}',
 capabilities:[],tags:[],execution:'managed'}, async (_,context) => {
  activeContext = context;
  if (!recorded) {
   const previous = await context.storage.read(namespace,'activations');
   const saved = await context.storage.write({namespace,key:'activations',expectedRevision:previous?.revision ?? 0,
    operationKey:crypto.randomUUID(),documentJson:JSON.stringify(JSON.parse(previous?.documentJson ?? '0')+1)});
   if(saved.kind !== 'completed') throw new Error('activation write failed');
   recorded = true;
  }
  return {kind:'complete',outputs:[]};
 });
 plugin.onDispose(async () => {
  if (!activeContext) return;
  try {
   await activeContext.storage.write({namespace,key:'late',expectedRevision:0,operationKey:crypto.randomUUID(),documentJson:'true'});
  } catch { return; }
  throw new Error('late request was accepted after disposal');
 });
});`;

function runtimeOptions() {
	return { capabilities: ['plugin.invoke'], backend };
}

async function openRuntimeLifecycle(t) {
	const fixture = await openPlugins((close) => t.after(close));
	const settings = expectStatus(await fixture.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
	expectStatus(
		await fixture.api('PUT', '/api/v1/agent/execution-settings', {
			expectedVersion: settings.version,
			enabled: true,
			limits: settings.limits,
		}),
		200,
	);
	const db = new DatabaseSync(fixture.database, { readOnly: true });
	t.after(() => db.close());
	return {
		...fixture,

		data(plugin, key) {
			const row = db
				.prepare('SELECT document_json FROM agent_plugin_private_data WHERE app_id=? AND key=?')
				.get(plugin.appId, key);
			return row ? row.document_json : null;
		},

		async invoke(plugin) {
			await plugin.grants(['plugin.invoke']);
			const thread = expectStatus(
				await fixture.api('POST', plugin.appPath + '/threads', { title: 'Lifecycle probe' }),
				201,
			);
			const { run } = expectStatus(
				await fixture.api(
					'POST',
					plugin.appPath + '/threads/' + thread.id + '/runs',
					{
						prompt: 'Probe',
						approvalMode: 'ask',
						connectionIds: [],
						inputJson: '{}',
					},
					{ 'Idempotency-Key': randomUUID() },
				),
				201,
			);
			const final = await until(
				async () => expectStatus(await fixture.api('GET', plugin.appPath + '/runs/' + run.id), 200),
				(value) => !['pending', 'running'].includes(value.status),
				'SDK4 lifecycle Run settles',
			);
			assert.equal(final.status, 'completed', JSON.stringify(final));
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

		data: async (key) => {
			const valueJson = f.data(plugin, key);
			return valueJson === null ? null : { valueJson };
		},

		ack: (input) => f.api('POST', path + '/runtime/acknowledge', input),

		path,
	};
}

await test(
	'SDK4 disposal fences retained call-context writes and releases the original child',
	{ timeout: 60000 },
	async (t) => {
		const f = await openRuntimeLifecycle(t);
		const plugin = await f.install('lifecycle', runtimeOptions());
		await stopPackageSource(f);
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
		await t.test('disable rejects SDK call inside real disposal and waits original process exit', async () => {
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
		await t.test(
			'a disposed SDK4 context does not prevent another incarnation from starting and closing',
			async () => {
				await plugin.enabled(true);
				await f.invoke(plugin);
				assert.equal((await owner.data('activations')).valueJson, '3');
				await plugin.enabled(false);
				assert.equal(await owner.runtime().then((value) => value.state), 'closed');
			},
		);
	},
);

await test(
	'B10 killed runtime retains unknown until restart and explicit original-instance acknowledgement',
	{ timeout: 60000 },
	async (t) => {
		const f = await openRuntimeLifecycle(t);
		const plugin = await f.install('killed-runtime', runtimeOptions());
		await stopPackageSource(f);
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
