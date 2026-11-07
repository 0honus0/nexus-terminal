import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { NativePluginBackendRuntime } from '../../../packages/backend/dist/modules/agent/plugins/adapters/runtime/plugin-backend-runtime.js';
import { NodeModuleRuntime } from '../../../packages/backend/dist/platform/isolation/adapters/node-module-runtime.js';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';

const definition = {
	kind: 'service',
	key: 'isolated.runtime-security.probe',
	contract: 'isolated.runtime-security',
	apiVersion: 1,
	summary: 'Exercise isolated SDK authority',
	instructions: '',
	inputSchemaJson: '{"type":"object"}',
	resultSchemaJson: '{"type":"object"}',
	capabilities: [],
	tags: [],
	execution: 'managed',
};

function deferred() {
	let resolve;
	const promise = new Promise((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function file(path, bytes) {
	return { path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function command(value, runId = randomUUID()) {
	return {
		key: definition.key,
		argumentsJson: JSON.stringify(value),
		scope: { kind: 'run', runId, operationId: null, deadlineUnixMs: Date.now() + 60000 },
	};
}

function source(body) {
	return `import { definePlugin } from './sdk.mjs';
let release, stale;
export default definePlugin((plugin) => plugin.register(${JSON.stringify(definition)}, async (input, context) => { ${body} }));`;
}

async function isolated(t, backend) {
	const directory = await mkdtemp(
		join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-runtime-security-'),
	);
	const runtime = new NativePluginBackendRuntime(new NodeModuleRuntime(directory));
	await runtime.recover();
	const sdk = await readFile(new URL('../../../packages/backend/dist-plugin-sdk/backend-v4.mjs', import.meta.url));
	const identity = {
		appId: randomUUID(),
		instanceId: randomUUID(),
		generation: randomUUID(),
		definitionId: 'isolated.runtime-security',
		version: '1.0.0',
		packageHash: 'c'.repeat(64),
		publisherKeyId: 'ed25519:' + 'd'.repeat(64),
		configurationRevision: 0,
	};
	const instance = await runtime.open({
		...identity,
		entry: 'main.mjs',
		files: [file('main.mjs', Buffer.from(backend)), file('sdk.mjs', sdk)],
	});
	t.after(async () => {
		await instance.close();
		if (!process.env.NEXUS_AGENT_ACCEPTANCE_ROOT) await rm(directory, { recursive: true, force: true });
	});
	await instance.activate();
	return {
		instance,
		identity,

		invoke: async (input, bridge = async () => assert.fail('Unexpected capability dispatch')) =>
			JSON.parse(await instance.invokeCallable(command(input), new AbortController().signal, 15000, bridge)),
	};
}

await test(
	'Real Node module IPC denies net, fetch, filesystem writes and child processes',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(
			join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-module-security-'),
		);
		const root = join(directory, 'modules');
		const written = join(directory, 'forbidden-write');
		const spawned = join(directory, 'forbidden-child');
		let requests = 0;
		let connections = 0;
		const server = createServer((_request, response) => {
			requests++;
			response.end('unexpected network access');
		});
		server.on('connection', () => connections++);
		let instance;
		t.after(async () => {
			const results = await Promise.allSettled([
				Promise.resolve().then(() => instance?.close()),
				new Promise((resolve, reject) => {
					server.closeAllConnections();
					server.close((error) => (error ? reject(error) : resolve()));
				}),
			]);
			const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
			try {
				if (!process.env.NEXUS_AGENT_ACCEPTANCE_ROOT) await rm(directory, { recursive: true, force: true });
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) throw new AggregateError(failures, 'Security fixture cleanup failed');
		});
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const port = server.address().port;
		const source = `import { definePlugin } from './sdk.mjs';
import { connect } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
async function probe(work) {
 try { await work(); return []; } catch (error) {
  const codes = [];
  for (let current = error; current; current = current.cause) codes.push(current.code ?? null);
  return codes;
 }
}
export default definePlugin((plugin) => plugin.register(${JSON.stringify(definition)}, async () => {
 const net = await probe(() => new Promise((resolve, reject) => {
  const socket = connect({host:'127.0.0.1',port:${port}});
  socket.once('error', reject);
  socket.once('connect', () => { socket.destroy(); resolve(); });
 }));
 const networkFetch = await probe(() => fetch('http://127.0.0.1:${port}/').then((response) => response.text()));
 const filesystem = await probe(() => writeFile(${JSON.stringify(written)}, 'forbidden'));
 const child = await probe(() => new Promise((resolve, reject) => {
  const processChild = spawn(process.execPath, ['-e', ${JSON.stringify('require("node:fs").writeFileSync(' + JSON.stringify(spawned) + ',"forbidden")')}], {stdio:'ignore'});
  processChild.once('error', reject);
  processChild.once('exit', resolve);
 }));
 return {net,networkFetch,filesystem,child};
}));`;
		const bytes = Buffer.from(source);
		const runtime = new NativePluginBackendRuntime(new NodeModuleRuntime(root));
		await runtime.recover();
		instance = await runtime.open({
			appId: randomUUID(),
			definitionId: 'isolated.runtime-security',
			version: '1.0.0',
			packageHash: 'c'.repeat(64),
			publisherKeyId: 'ed25519:' + 'd'.repeat(64),
			instanceId: randomUUID(),
			generation: randomUUID(),
			configurationRevision: 0,
			entry: 'main.mjs',
			files: [
				file('main.mjs', bytes),
				file(
					'sdk.mjs',
					await readFile(
						new URL('../../../packages/backend/dist-plugin-sdk/backend-v4.mjs', import.meta.url),
					),
				),
			],
		});
		await instance.activate();
		assert.equal(await instance.health(), true);
		const [materialized] = await readdir(root);
		const journal = JSON.parse(await readFile(join(root, materialized, '.nexus-process.json'), 'utf8'));
		assert.equal(journal.parent.pid, process.pid);
		assert.notEqual(journal.child.pid, process.pid, 'probe runs in the actual isolated child');
		const result = JSON.parse(
			await instance.invokeCallable(command({}), new AbortController().signal, 15000, async () =>
				assert.fail('Node probes must not use Host RPC'),
			),
		);
		assert.deepEqual(Object.keys(result), ['net', 'networkFetch', 'filesystem', 'child']);
		for (const [name, codes] of Object.entries(result))
			assert.ok(codes.includes('ERR_ACCESS_DENIED'), name + ' must fail at the Node permission boundary');
		assert.equal(requests, 0);
		assert.equal(connections, 0);
		for (const path of [written, spawned]) await assert.rejects(readFile(path), { code: 'ENOENT' });
		await instance.close();
		instance = undefined;
		assert.deepEqual(await readdir(root), []);
	},
);

await test('Real activation SDK cannot write storage or create an intent', { timeout: 60000 }, async (t) => {
	const probes = [
		{
			method: 'storage.write',
			inputJson: JSON.stringify({
				namespace: 'isolated.runtime-security',
				key: 'activation',
				expectedRevision: 0,
				operationKey: 'activation',
				documentJson: 'true',
			}),
		},
		{
			method: 'intents.create',
			inputJson: JSON.stringify({ receiverAppId: randomUUID(), intentId: 'inspect', inputJson: '{}' }),
		},
	];
	const f = await isolated(
		t,
		`let replies;
export async function activate({request}) {
 replies = await Promise.all(${JSON.stringify(probes)}.map((probe) => request(probe)));
 return [${JSON.stringify(definition)}];
}
export function health() { return true; }
export function dispatch() { return { resultJson: JSON.stringify({replies}) }; }`,
	);
	assert.deepEqual(
		(await f.invoke({})).replies,
		probes.map(() => ({ ok: false, code: 'forbidden' })),
	);
});

await test(
	'Pure callable cannot hide Host, storage or intent writes behind a successful computed result',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const id = 'isolated.runtime-security';
		const pure = { ...definition, execution: 'pure' };
		const app = { ...definition, kind: 'app', key: id + '.run' };
		const backend = `import { definePlugin } from './sdk.mjs';
export default definePlugin((plugin) => {
 plugin.register(${JSON.stringify(pure)}, async (input, context) => {
  const replies = [];
  for (const probe of input.probes) {
   try { await context.request(probe.method, probe.input, (value) => value); replies.push({allowed:true}); }
   catch (error) { replies.push({code:error.code}); }
  }
  return {replies};
 });
 plugin.register(${JSON.stringify(app)}, async (input, context) => {
  const page = await context.directory.discover({kind:'service',contract:${JSON.stringify(id)},apiVersion:1,cursor:null});
  const binding = await context.directory.bind(page.entries[0].id);
  const result = await context.directory.invoke({operationKey:'probe',bindingId:binding.id,argumentsJson:JSON.stringify(input)});
  if (result.kind !== 'completed') throw new Error('Pure probe did not complete');
  await context.run.append({key:'answer',index:0,text:result.resultJson});
  return {kind:'complete',outputs:[]};
 });
});`;
		const plugin = await f.install('pure-security', {
			definitionId: id,
			frontend: false,
			backend,
			backendAssets: {
				'sdk.mjs': await readFile(
					new URL('../../../packages/backend/dist-plugin-sdk/backend-v4.mjs', import.meta.url),
				),
			},
			capabilities: ['plugin.invoke', 'file.read', 'file.write', 'shell.execute', 'app.intents.exchange'],
			contributions: {
				app: { entry: app.key, uiContract: null, uiApiVersion: null },
				tools: false,
				services: true,
				ui: null,
				settings: null,
				skills: [],
			},
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
		const probes = [
			{
				method: 'host.perform',
				input: {
					operationKey: 'read',
					request: { operation: 'remote.listPage', connectionId: 11, path: '/', after: '' },
				},
			},
			{
				method: 'host.perform',
				input: {
					operationKey: 'execute',
					request: {
						operation: 'shell.execute',
						connectionId: 11,
						commands: ['printf forbidden'],
						onError: 'stop',
						cwd: null,
						mode: 'foreground',
						yieldSeconds: null,
					},
				},
			},
			...['true', null].map((documentJson, index) => ({
				method: 'storage.write',
				input: {
					namespace: id,
					key: 'readonly',
					expectedRevision: index,
					operationKey: 'write-' + index,
					documentJson,
				},
			})),
			{ method: 'intents.create', input: { receiverAppId: plugin.appId, intentId: 'inspect', inputJson: '{}' } },
			{ method: 'intents.revoke', input: { receiptId: randomUUID() } },
		];
		const thread = expectStatus(
			await f.api('POST', plugin.appPath + '/threads', { title: 'Pure invocation authority' }),
			201,
		);
		const { run } = expectStatus(
			await f.api(
				'POST',
				plugin.appPath + '/threads/' + thread.id + '/runs',
				{
					prompt: 'Reject hidden effects',
					approvalMode: 'ask',
					connectionIds: [],
					inputJson: JSON.stringify({ probes }),
				},
				{ 'Idempotency-Key': randomUUID() },
			),
			201,
		);
		const final = await until(
			async () => expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200),
			(value) => ['completed', 'failed', 'cancelled'].includes(value.status),
			'Pure probe settles',
		);
		assert.equal(final.status, 'completed', JSON.stringify(final));
		const db = new DatabaseSync(f.database, { readOnly: true });
		try {
			const chunks = db
				.prepare(
					'SELECT c.text FROM agent_app_messages m JOIN agent_app_message_chunks c ON c.message_id=m.id WHERE m.run_id=? ORDER BY m.ordinal,c.chunk_index',
				)
				.all(run.id);
			const replies = JSON.parse(chunks.map((chunk) => chunk.text).join('')).replies;
			assert.equal(replies.length, probes.length);
			assert.deepEqual(
				replies.slice(0, 4),
				Array.from({ length: 4 }, () => ({ code: 'forbidden' })),
			);
			for (const reply of replies.slice(4)) assert.ok(['forbidden', 'invalid_input'].includes(reply.code));
			for (const table of [
				'agent_plugin_private_data',
				'agent_plugin_configuration_mutations',
				'agent_plugin_intents',
			]) {
				assert.equal(
					db
						.prepare(
							'SELECT COUNT(*) AS n FROM ' +
								table +
								' WHERE ' +
								(table === 'agent_plugin_intents' ? 'sender_app_id' : 'app_id') +
								'=?',
						)
						.get(plugin.appId).n,
					0,
					table,
				);
			}
			assert.equal(
				db.prepare('SELECT COUNT(*) AS n FROM agent_operations WHERE run_id=?').get(run.id).n,
				0,
				'Pure computation does not manufacture an effect receipt',
			);
		} finally {
			db.close();
		}
	},
);

await test(
	'Concurrent real invocations preserve each target, scope and runtime identity',
	{ timeout: 60000 },
	async (t) => {
		const entered = deferred(),
			release = deferred();
		t.after(() => release.resolve());
		const f = await isolated(
			t,
			source(`
 const result=await context.request('registry.describe',{target:input.target,path:input.path},(value)=>value);
 return {result,instanceId:context.identity.instanceId,runId:context.scope.runId};`),
		);
		const seen = [];

		const consume = (target, wait) => async (request) => {
			const params = JSON.parse(request.inputJson);
			assert.equal(request.method, 'registry.describe');
			assert.equal(params.target, target);
			seen.push(params);
			if (wait) {
				entered.resolve();
				await release.promise;
			}
			return { ok: true, valueJson: JSON.stringify({ target, path: params.path }) };
		};

		const first = f.invoke({ target: 11, path: '/first' }, consume(11, true));
		const observed = Promise.allSettled([first]);
		await Promise.race([entered.promise, first.then(() => assert.fail('First source must be pending'))]);
		const second = await f.invoke({ target: 22, path: '/second' }, consume(22, false));
		release.resolve();
		const [outcome] = await observed;
		assert.equal(outcome.status, 'fulfilled');
		const replies = [outcome.value, second];
		assert.deepEqual(
			replies.map((item) => item.result),
			[
				{ target: 11, path: '/first' },
				{ target: 22, path: '/second' },
			],
		);
		assert.deepEqual(seen, [
			{ target: 11, path: '/first' },
			{ target: 22, path: '/second' },
		]);
		assert.ok(replies.every((item) => item.instanceId === f.identity.instanceId));
		assert.notEqual(replies[0].runId, replies[1].runId);
	},
);

for (const kind of ['promise', 'timer']) {
	await test(
		'Expired ' + kind + ' SDK callback cannot borrow the next invocation target',
		{ timeout: 60000 },
		async (t) => {
			const f = await isolated(
				t,
				source(`
   if(input.prepare){
    const gate=new Promise((resolve)=>{release=resolve;});
    const invoke=async()=>{try{await context.request('registry.describe',{target:11,path:'/stale'},(value)=>value);return {escaped:true};}catch{return {refused:true};}};
    ${kind === 'promise' ? 'stale=gate.then(invoke);' : 'let entered; const started=new Promise((resolve)=>{entered=resolve;}); stale=new Promise((resolve,reject)=>{setTimeout(async()=>{entered();try{await gate;resolve(await invoke());}catch(error){reject(error);}},0);}); await started;'}
    return {prepared:true};
   }
   const current=context.request('registry.describe',{target:22,path:'/current'},(value)=>value);
   release();
   return {current:await current,stale:await stale};`),
			);
			assert.deepEqual(await f.invoke({ prepare: true }), { prepared: true });
			const seen = [];
			const reply = await f.invoke({}, async (request) => {
				seen.push(JSON.parse(request.inputJson));
				return { ok: true, valueJson: '{"name":"current"}' };
			});
			assert.deepEqual(reply.stale, { refused: true });
			assert.deepEqual(reply.current, { name: 'current' });
			assert.deepEqual(seen, [{ target: 22, path: '/current' }]);
		},
	);
}
