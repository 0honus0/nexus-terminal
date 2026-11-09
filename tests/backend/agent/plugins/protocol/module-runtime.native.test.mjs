import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeModuleRuntime } from '../../../../../packages/backend/dist/platform/isolation/adapters/node-module-runtime.js';
import {
	ModuleRuntimeFailure,
	ModuleInvocationFailure,
} from '../../../../../packages/backend/dist/platform/isolation/module-runtime.js';
import { processIdentity } from '../../../../../packages/backend/dist/platform/isolation/adapters/module-recovery.js';
import { NativePluginBackendRuntime } from '../../../../../packages/backend/dist/modules/agent/plugins/adapters/runtime/plugin-backend-runtime.js';
import { PluginCallableRefusal } from '../../../../../packages/backend/dist/modules/agent/plugins/storage/plugin-runtime.js';
import { AgentFailure, ToolCleanupFailure } from '../../../../../packages/backend/dist/modules/agent/agent-failure.js';
import { PluginRuntimeService } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-runtime-service.js';
import { until } from '../../../../support/protocols/openssh-fixture.mjs';

function deferred() {
	let resolve, reject;
	const promise = new Promise((accept, refuse) => {
		resolve = accept;
		reject = refuse;
	});
	return { promise, resolve, reject };
}

function contains(error, target) {
	return (
		error === target ||
		(error instanceof Error &&
			(contains(error.cause, target) ||
				(error instanceof AggregateError && error.errors.some((value) => contains(value, target)))))
	);
}

async function fixture(t) {
	const directory = await mkdtemp(
		join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-b10-module-host-'),
	);
	const runtime = new NodeModuleRuntime(directory);
	const opened = new Set();
	const gates = [];
	t.after(async () => {
		for (const gate of gates) gate.resolve(null);
		const results = await Promise.allSettled([...opened].map((instance) => instance.close()));
		const errors = results.filter((value) => value.status === 'rejected').map((value) => value.reason);
		try {
			if (!process.env.NEXUS_AGENT_ACCEPTANCE_ROOT) await rm(directory, { recursive: true, force: true });
		} catch (error) {
			errors.push(error);
		}
		if (errors.length) throw new AggregateError(errors, 'Module fixture cleanup failed');
	});
	await runtime.recover();
	return {
		directory,

		gate() {
			const gate = deferred();
			gates.push(gate);
			return gate;
		},

		async open(source, host, native = false) {
			const bytes = Buffer.from(source);
			const sdk = native
				? await readFile(
						new URL('../../../../../packages/backend/dist-plugin-sdk/backend-v4.mjs', import.meta.url),
					)
				: null;
			const input = {
				files: [{ path: 'main.mjs', bytes, sha256: createHash('sha256').update(bytes).digest('hex') }],
				entry: 'main.mjs',
				contextJson: '{}',
				host,
			};
			const instance = native
				? await new NativePluginBackendRuntime(runtime).open({
						appId: randomUUID(),
						instanceId: randomUUID(),
						generation: randomUUID(),
						configurationRevision: 0,
						definitionId: 'test.source-ipc',
						version: '1.0.0',
						packageHash: 'c'.repeat(64),
						publisherKeyId: 'ed25519:' + 'd'.repeat(64),
						entry: input.entry,
						files: [
							...input.files,
							{ path: 'sdk.mjs', bytes: sdk, sha256: createHash('sha256').update(sdk).digest('hex') },
						],
					})
				: await runtime.open(input);
			opened.add(instance);
			return instance;
		},

		async close(instance, validate) {
			if (validate) await assert.rejects(instance.close(), validate);
			else await instance.close();
			opened.delete(instance);
		},
	};
}

function callsSource(count, waitOnQuiesce = false) {
	return `let pending;
export function activate({request}) {
 pending = Promise.allSettled(Array.from({length:${count}}, (_, id) => request({id})));
}
export function health() { return true; }
export async function quiesce() { ${waitOnQuiesce ? 'await pending;' : ''} }
export function dispose() {}
`;
}

const nativeDefinition = {
	kind: 'service',
	key: 'test.source-ipc.execute',
	contract: 'test.source-ipc',
	apiVersion: 1,
	summary: 'Exercise actual invocation-local source ownership',
	instructions: '',
	inputSchemaJson: '{"type":"object"}',
	resultSchemaJson: '{"type":"object"}',
	capabilities: [],
	tags: [],
	execution: 'managed',
};

function nativeSource(body) {
	return `import { definePlugin, PluginCapabilityFailure } from './sdk.mjs';
 let lateRefused = false;
 export default definePlugin((plugin) => plugin.register(${JSON.stringify(nativeDefinition)}, async (input, context) => { ${body} }));`;
}

function nativeInput(name) {
	return {
		key: nativeDefinition.key,
		argumentsJson: JSON.stringify({ name }),
		scope: { kind: 'run', runId: randomUUID(), operationId: null, deadlineUnixMs: Date.now() + 60000 },
	};
}

function capabilityReply(value) {
	return { ok: true, valueJson: JSON.stringify(value) };
}

await test('B10 exact ordinary control rejection differs from an unconfirmed invocation timeout', async (t) => {
	const f = await fixture(t);
	const instance = await f.open(
		`export async function agent(input) {
 if (input.wait) await new Promise(() => {});
 throw new Error('actual source rejection');
}
export function health() { return true; }`,
		async () => null,
	);
	await instance.activate();
	await assert.rejects(instance.invoke('{}', new AbortController().signal, 15000), (error) => {
		assert.ok(error instanceof ModuleInvocationFailure);
		assert.equal(error.kind, 'execution_unknown', 'a source rejection does not classify its effects');
		assert.ok(Number.isSafeInteger(error.controlId) && error.controlId > 0);
		return true;
	});
	assert.equal(await instance.health(), true, 'one acknowledged source rejection does not retire other controls');

	const unconfirmed = (error) => {
		assert.ok(error instanceof ModuleRuntimeFailure);
		assert.equal(error instanceof ModuleInvocationFailure, false);
		assert.equal(error.kind, 'execution_unknown');
		return true;
	};

	await assert.rejects(instance.invoke('{"wait":true}', new AbortController().signal, 250), unconfirmed);
	await assert.rejects(instance.exited, unconfirmed);
	await f.close(instance, unconfirmed);
});

await test(
	'Native concurrent callables retain independent invocation-local Host callbacks',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const release = f.gate();
		const entered = f.gate();
		const callsA = [],
			callsB = [];
		const instance = await f.open(
			nativeSource(`
  const result = await context.request(input.name === 'alpha' ? 'registry.discover' : 'registry.describe', { name: input.name }, (value) => value);
  return { result, aborted: context.signal.aborted };`),
			async () => assert.fail('Callable requests must never enter the global Host'),
			true,
		);
		await instance.activate();
		const alpha = instance.invokeCallable(
			nativeInput('alpha'),
			new AbortController().signal,
			15000,
			async (value) => {
				callsA.push(value.method);
				assert.equal(JSON.parse(value.inputJson).name, 'alpha');
				entered.resolve();
				await release.promise;
				return capabilityReply('alpha source');
			},
		);
		const observedA = Promise.allSettled([alpha]);
		await entered.promise;
		const beta = await instance.invokeCallable(
			nativeInput('beta'),
			new AbortController().signal,
			15000,
			async (value) => {
				callsB.push(value.method);
				assert.equal(JSON.parse(value.inputJson).name, 'beta');
				return capabilityReply('beta source');
			},
		);
		assert.deepEqual(JSON.parse(beta), { result: 'beta source', aborted: false });
		assert.deepEqual(callsA, ['registry.discover']);
		assert.deepEqual(callsB, ['registry.describe']);
		release.resolve();
		const [outcomeA] = await observedA;
		assert.equal(outcomeA.status, 'fulfilled');
		assert.deepEqual(JSON.parse(outcomeA.value), { result: 'alpha source', aborted: false });
		await f.close(instance);
	},
);

await test(
	'Native cancelled callable cannot lend a late Host request to the concurrent control',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const releaseA = f.gate(),
			releaseB = f.gate(),
			enteredA = f.gate(),
			enteredB = f.gate();
		const callsA = [],
			callsB = [];
		const instance = await f.open(
			nativeSource(`
  if (input.name === 'probe') return { lateRefused };
  if (input.name === 'alpha') {
   void context.request('registry.discover', {}, (value) => value).then(() => context.request('registry.describe', {}, (value) => value)).catch(() => { lateRefused = true; });
   await new Promise((resolve) => context.signal.aborted ? resolve() : context.signal.addEventListener('abort', resolve, { once: true }));
   throw new PluginCapabilityFailure('invalid_input');
  }
  const result = await context.request('registry.describe', {}, (value) => value);
  return { result, aborted: context.signal.aborted };`),
			async () => assert.fail('Expired work must not enter a global Host callback'),
			true,
		);
		await instance.activate();
		const stopA = new AbortController();
		const alpha = instance.invokeCallable(nativeInput('alpha'), stopA.signal, 15000, async (value) => {
			callsA.push(value.method);
			enteredA.resolve();
			await releaseA.promise;
			return capabilityReply('original A');
		});
		const observedA = Promise.allSettled([alpha]);
		await enteredA.promise;
		const beta = instance.invokeCallable(
			nativeInput('beta'),
			new AbortController().signal,
			15000,
			async (value) => {
				callsB.push(value.method);
				enteredB.resolve();
				await releaseB.promise;
				return capabilityReply('original B');
			},
		);
		const observedB = Promise.allSettled([beta]);
		await enteredB.promise;
		stopA.abort();
		let settledA = false;
		void observedA.then(() => {
			settledA = true;
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settledA, false, 'Cancellation must still join the original accepted Host task');
		releaseA.resolve();
		const [outcomeA] = await observedA;
		assert.equal(outcomeA.status, 'rejected');
		assert.ok(outcomeA.reason instanceof PluginCallableRefusal);
		assert.equal(outcomeA.reason.code, 'invalid_input');
		await until(
			async () =>
				JSON.parse(
					await instance.invokeCallable(nativeInput('probe'), new AbortController().signal, 15000, async () =>
						assert.fail('Probe has no Host work'),
					),
				).lateRefused,
			(value) => value,
			'Late request was refused under the original cancelled control',
		);
		assert.deepEqual(callsA, ['registry.discover']);
		assert.deepEqual(callsB, ['registry.describe']);
		releaseB.resolve();
		const [outcomeB] = await observedB;
		assert.equal(outcomeB.status, 'fulfilled');
		assert.deepEqual(JSON.parse(outcomeB.value), { result: 'original B', aborted: false });
		await f.close(instance);
	},
);

await test(
	'B10 real isolated module keeps independent host failures after their tasks settle',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gates = [f.gate(), f.gate()];
		const errors = [new Error('first host fixture failure'), new Error('second host fixture failure')];
		let calls = 0,
			settled = 0;
		const instance = await f.open(callsSource(2), ({ id }) => {
			calls++;
			return gates[id].promise.finally(() => settled++);
		});
		await instance.activate();
		await until(
			() => calls,
			(value) => value === 2,
			'both real child host callbacks started',
		);
		gates[0].reject(errors[0]);
		await assert.rejects(
			instance.exited,
			(error) => error instanceof ModuleRuntimeFailure && error.kind === 'execution_unknown',
		);
		gates[1].reject(errors[1]);
		await until(
			() => settled,
			(value) => value === 2,
			'both original host callbacks settled',
		);
		await f.close(
			instance,
			(error) =>
				error instanceof ModuleRuntimeFailure &&
				error.kind === 'execution_unknown' &&
				errors.every((cause) => contains(error, cause)),
		);
		assert.deepEqual(await readdir(f.directory), []);
	},
);

await test('B10 real worker admits 48 host calls and continues after replies settle', { timeout: 60000 }, async (t) => {
	const f = await fixture(t);
	const gates = Array.from({ length: 48 }, () => f.gate());
	const seen = [];
	let after = 0;
	const instance = await f.open(
		`let healthy = false;
export function activate({request}) {
 const tasks = Array.from({length:48}, (_, id) => request({id}));
 Promise.all(tasks).then(async (values) => {
  const reply = await request({id:'after'});
  healthy = values.every((value,id) => value.id === id) && reply.ok;
 }).catch(() => {});
}
export function health() { return healthy; }
export function dispose() {}
`,
		async ({ id }) => {
			seen.push(id);
			if (id === 'after') {
				after++;
				return { ok: true };
			}
			assert.ok(Number.isSafeInteger(id) && id >= 0 && id < 48, 'every call keeps its original identity');
			return gates[id].promise;
		},
	);
	await instance.activate();
	await until(
		() => seen.length,
		(value) => value === 48,
		'all 48 actual host callbacks started',
	);
	assert.deepEqual(
		seen,
		Array.from({ length: 48 }, (_, id) => id),
	);
	assert.equal(await instance.health(), false);
	for (let id = 0; id < 48; id++) gates[id].resolve({ id });
	await until(
		() => instance.health(),
		(value) => value,
		'all actual replies correlated and a new host call succeeds',
	);
	assert.equal(after, 1);
	assert.equal(seen.length, 49);
	await f.close(instance);
	assert.deepEqual(await readdir(f.directory), []);
});

await test(
	'B10 real runtime control keeps 16 waiting calls and recovers after completion',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gate = f.gate();
		let started = false;
		const instance = await f.open(
			`let waiting;
export function activate({request}) { waiting = request({id:1}); }
export async function health() { await waiting; return true; }
export function dispose() {}
`,
			() => {
				started = true;
				return gate.promise;
			},
		);
		await instance.activate();
		await until(
			() => started,
			(value) => value,
			'actual host callback started',
		);
		const results = Promise.allSettled(Array.from({ length: 16 }, () => instance.health()));
		gate.resolve(null);
		assert.deepEqual(
			await results,
			Array.from({ length: 16 }, () => ({ status: 'fulfilled', value: true })),
		);
		assert.equal(await instance.health(), true);
		await f.close(instance);
	},
);

await test(
	'B10 real quiesce blocks new SDK dispatch while waiting original host completion',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gate = f.gate();
		let calls = 0;
		const instance = await f.open(
			`let sdk, waiting;
export function activate(value) { sdk=value; waiting=sdk.request({id:1}); }
export function health() { return true; }
export async function quiesce() {
 let refused=false;
 try { await sdk.request({id:'late'}); } catch { refused=true; }
 if (!refused) throw new Error('quiesce dispatched a new request');
 await waiting;
}
export function dispose() {}
`,
			() => {
				calls++;
				return gate.promise;
			},
		);
		await instance.activate();
		await until(
			() => calls,
			(value) => value === 1,
			'original actual host callback started',
		);
		let settled = false;
		const result = instance.quiesce(Date.now() + 10000).then(() => {
			settled = true;
		});
		const observed = Promise.allSettled([result]);
		await assert.rejects(
			instance.health(),
			(error) => error instanceof ModuleRuntimeFailure && error.kind === 'unavailable',
		);
		assert.equal(settled, false);
		gate.resolve(null);
		assert.deepEqual(await observed, [{ status: 'fulfilled', value: undefined }]);
		assert.equal(calls, 1);
		await f.close(instance);
	},
);

await test(
	'B10 child exit does not release an in-flight host effect or deliver its late result to a replacement',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gate = f.gate();
		let calls = 0,
			effects = 0,
			replacements = 0;
		const instance = await f.open(callsSource(1), async () => {
			calls++;
			await gate.promise;
			effects++;
			return { completed: true };
		});
		await instance.activate();
		await until(
			() => calls,
			(value) => value === 1,
			'original host effect dispatched',
		);
		const close = instance.close();
		const result = Promise.allSettled([close]);
		assert.equal(instance.close(), close);
		let completed = false;
		void close.then(
			() => {
				completed = true;
			},
			() => {
				completed = true;
			},
		);
		await instance.exited;
		assert.equal(completed, false);
		assert.equal(
			(await readdir(f.directory)).length,
			1,
			'original materialization remains until host task settles',
		);
		const replacement = await f.open('export function health() { return true; }', async () => {
			replacements++;
			return null;
		});
		await replacement.activate();
		assert.equal(await replacement.health(), true);
		gate.resolve(null);
		const [outcome] = await result;
		assert.equal(outcome.status, 'rejected');
		await f.close(instance, (error) => {
			assert.equal(error, outcome.reason);
			assert.ok(error instanceof ModuleRuntimeFailure && error.kind === 'execution_unknown');
			assert.ok(error.cause instanceof AggregateError);
			assert.equal(error.cause.errors.length, 1, 'one write failure is not counted again by its host task');
			return true;
		});
		assert.equal(effects, 1);
		assert.equal(calls, 1);
		assert.equal(replacements, 0);
		assert.equal(await replacement.health(), true);
		await f.close(replacement);
		assert.deepEqual(await readdir(f.directory), []);
	},
);

await test(
	'B10 close waits all original callbacks and retains two independent late failures',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gates = [f.gate(), f.gate()];
		const errors = [new Error('late host one'), new Error('late host two')];
		let calls = 0;
		const instance = await f.open(callsSource(2), ({ id }) => {
			calls++;
			return gates[id].promise;
		});
		await instance.activate();
		await until(
			() => calls,
			(value) => value === 2,
			'both original callbacks entered before close',
		);
		const close = instance.close();
		const observed = Promise.allSettled([close]);
		await instance.exited;
		for (let id = 0; id < 2; id++) gates[id].reject(errors[id]);
		const [outcome] = await observed;
		assert.equal(outcome.status, 'rejected');
		await f.close(instance, (error) => error === outcome.reason && errors.every((cause) => contains(error, cause)));
		assert.deepEqual(await readdir(f.directory), []);
	},
);

await test(
	'B10 SIGKILL preserves original host ownership and replacement process remains independent',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gate = f.gate();
		const late = new Error('original host rejection after actual child death');
		let started = false;
		const instance = await f.open(callsSource(1), () => {
			started = true;
			return gate.promise;
		});
		await instance.activate();
		await until(
			() => started,
			(value) => value,
			'actual host callback before SIGKILL',
		);
		const [root] = await readdir(f.directory);
		const journal = JSON.parse(await readFile(join(f.directory, root, '.nexus-process.json'), 'utf8'));
		assert.equal(journal.parent.pid, process.pid);
		const args = (await readFile('/proc/' + journal.child.pid + '/cmdline', 'utf8')).split('\0');
		assert.ok(args.includes(join(f.directory, root, '.nexus-runtime.mjs')));
		const processStat = await open('/proc/' + journal.child.pid + '/stat', 'r');
		t.after(() => processStat.close());
		process.kill(journal.child.pid, 'SIGKILL');
		await assert.rejects(
			instance.exited,
			(error) =>
				error instanceof ModuleRuntimeFailure &&
				!(error instanceof ModuleInvocationFailure) &&
				error.kind === 'execution_unknown',
		);
		await assert.rejects(processStat.readFile(), { code: 'ESRCH' });
		assert.equal(await processIdentity(journal.child.pid), null);
		const close = instance.close();
		const observed = Promise.allSettled([close]);
		const replacement = await f.open('export function health() { return true; }', async () => null);
		await replacement.activate();
		gate.reject(late);
		const [outcome] = await observed;
		assert.equal(outcome.status, 'rejected');
		await f.close(instance, (error) => error === outcome.reason && contains(error, late));
		assert.equal(await replacement.health(), true);
		await f.close(replacement);
		assert.deepEqual(await readdir(f.directory), []);
	},
);

await test(
	'B10 original failure plus bounded late host diagnostics survive 32 independent callback failures',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gates = Array.from({ length: 32 }, () => f.gate());
		const errors = gates.map((_, id) => new Error('bounded host failure ' + id));
		let calls = 0,
			settled = 0;
		const instance = await f.open(callsSource(32), ({ id }) => {
			calls++;
			return gates[id].promise.finally(() => settled++);
		});
		await instance.activate();
		await until(
			() => calls,
			(value) => value === 32,
			'all 32 host callbacks are in flight',
		);
		gates[0].reject(errors[0]);
		await assert.rejects(
			instance.exited,
			(error) => error instanceof ModuleRuntimeFailure && error.kind === 'execution_unknown',
		);
		for (let id = 1; id < 32; id++) gates[id].reject(errors[id]);
		await until(
			() => settled,
			(value) => value === 32,
			'all original callback rejections settle',
		);
		await f.close(instance, (error) => {
			assert.ok(error instanceof ModuleRuntimeFailure && error.kind === 'execution_unknown');
			assert.ok(error.cause instanceof AggregateError);
			assert.equal(error.cause.errors.length, 18, 'original plus 16 samples and overflow evidence');
			assert.ok(contains(error, errors[0]));
			for (const cause of errors.slice(-16)) assert.ok(contains(error, cause));
			assert.equal(contains(error, errors[1]), false);
			return true;
		});
		assert.deepEqual(await readdir(f.directory), []);
	},
);

for (const kind of ['unavailable', 'protocol_invalid']) {
	await test(
		`B10 host ${kind} rejection remains execution unknown after actual dispatch`,
		{ timeout: 60000 },
		async (t) => {
			const f = await fixture(t);
			const original = new ModuleRuntimeFailure(kind);
			let calls = 0;
			const instance = await f.open(callsSource(1), () => {
				calls++;
				throw original;
			});
			const activation = Promise.allSettled([instance.activate()]);
			await assert.rejects(
				instance.exited,
				(error) =>
					error instanceof ModuleRuntimeFailure &&
					error.kind === 'execution_unknown' &&
					contains(error, original),
			);
			await activation;
			assert.equal(calls, 1);
			await f.close(
				instance,
				(error) =>
					error instanceof ModuleRuntimeFailure &&
					error.kind === 'execution_unknown' &&
					contains(error, original),
			);
			assert.deepEqual(await readdir(f.directory), []);
		},
	);
}

await test(
	'Source IPC refuses a saved phase A capability during phase B without global Host dispatch',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		let globalCalls = 0;
		const instance = await f.open(
			`let previous;
export function execution(input, source) {
 if (input.phase === 'A') { previous = source; return 'saved'; }
 return previous.read({old:true}).then(() => 'escaped', async () => source.stage({current:true}));
}`,
			async () => {
				globalCalls++;
				return 'global';
			},
		);
		await instance.activate();
		let oldReads = 0;
		assert.equal(
			await instance.invoke('{"phase":"A"}', new AbortController().signal, 15000, {
				exportName: 'execution',
				methods: ['read', 'stage'],

				read: async () => {
					oldReads++;
					return 'old';
				},
			}),
			'saved',
		);
		const current = [];
		assert.equal(
			await instance.invoke('{"phase":"B"}', new AbortController().signal, 15000, {
				exportName: 'execution',
				methods: ['read', 'stage'],

				read: async (value) => {
					current.push(value);
					return 'current';
				},
			}),
			'current',
		);
		assert.equal(oldReads, 0);
		assert.deepEqual(current, [{ method: 'stage', input: { current: true } }]);
		assert.equal(globalCalls, 0);
		await f.close(instance);
	},
);

await test(
	'Public activation request cannot select a pending source control identity',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gate = f.gate();
		const arm = f.gate();
		const lifecycle = f.gate();
		const scopes = [];
		let reads = 0;
		const instance = await f.open(
			`let sdk;
export function activate(value) {
 sdk=value;
 void sdk.request({arm:true}).then(() => sdk.request({forged:true}, 2)).catch(() => {});
}
export async function execution(input, source) { return source.read({own:true}); }
`,
			async (value, scope) => {
				if (value.arm) return arm.promise;
				assert.deepEqual(value, { forged: true });
				scopes.push(scope);
				lifecycle.resolve();
				return 'lifecycle';
			},
		);
		await instance.activate();
		const result = instance.invoke('{}', new AbortController().signal, 15000, {
			exportName: 'execution',
			methods: ['read'],

			read: async (value) => {
				reads++;
				assert.deepEqual(value, { method: 'read', input: { own: true } });
				await gate.promise;
				return 'source';
			},
		});
		const observed = Promise.allSettled([result]);
		await until(
			() => reads,
			(value) => value === 1,
			'actual phase source callback entered',
		);
		arm.resolve(null);
		await lifecycle.promise;
		assert.deepEqual(scopes, [{ kind: 'lifecycle' }]);
		gate.resolve();
		assert.deepEqual(await observed, [{ status: 'fulfilled', value: 'source' }]);
		assert.equal(reads, 1);
		await f.close(instance);
	},
);

await test(
	'Native fire-and-forget capability keeps its callable pending through actual source settlement',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const release = f.gate(),
			entered = f.gate();
		const late = new Error('Original capability failed after the handler returned');
		let calls = 0;
		const instance = await f.open(
			nativeSource(`
  if (input.name === 'A') void context.request('registry.discover', {}, (value) => value).catch(() => {});
  return { acknowledged: input.name };`),
			async () => assert.fail('Capability must never enter global Host'),
			true,
		);
		await instance.activate();
		let settled = false;
		const pending = instance.invokeCallable(nativeInput('A'), new AbortController().signal, 15000, async () => {
			calls++;
			entered.resolve();
			await release.promise;
			throw late;
		});
		const observed = Promise.allSettled([pending]);
		void observed.then(() => {
			settled = true;
		});
		await entered.promise;
		assert.equal(await instance.health(), true);
		assert.equal(settled, false);
		assert.equal(calls, 1);
		release.resolve();
		const [outcome] = await observed;
		assert.equal(outcome.status, 'rejected');
		assert.ok(contains(outcome.reason, late));
		assert.deepEqual(
			JSON.parse(
				await instance.invokeCallable(nativeInput('B'), new AbortController().signal, 15000, async () =>
					assert.fail('B has no source requests'),
				),
			),
			{ acknowledged: 'B' },
		);
		assert.equal(calls, 1);
		await f.close(instance);
	},
);

await test(
	'Native cancellation and two capability failures preserve every original cause',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gates = [f.gate(), f.gate()];
		const errors = [new Error('Capability failure one'), new Error('Capability failure two')];
		let reads = 0;
		const instance = await f.open(
			nativeSource(`
  const work = Promise.allSettled([0, 1].map((cursor) => context.request('registry.discover', { cursor }, (value) => value)));
  await new Promise((resolve) => context.signal.addEventListener('abort', resolve, { once: true }));
  await work;
  throw new Error('Original callable cancellation');`),
			async () => assert.fail('Capability failures must never enter global Host'),
			true,
		);
		await instance.activate();
		const stop = new AbortController();
		const outcome = Promise.allSettled([
			instance.invokeCallable(nativeInput('cancelled'), stop.signal, 15000, async (value) => {
				reads++;
				return gates[JSON.parse(value.inputJson).cursor].promise;
			}),
		]);
		await until(
			() => reads,
			(value) => value === 2,
			'Both actual capability requests were accepted',
		);
		stop.abort();
		for (let index = 0; index < errors.length; index++) gates[index].reject(errors[index]);
		const [result] = await outcome;
		assert.equal(result.status, 'rejected');
		assert.ok(result.reason instanceof ModuleRuntimeFailure);
		assert.ok(result.reason.cause instanceof AggregateError);
		for (const error of errors) assert.ok(contains(result.reason, error));
		assert.ok(
			result.reason.cause.errors.some(
				(error) => error instanceof ModuleRuntimeFailure && error.kind === 'protocol_invalid',
			),
			'Retain callable failure alongside both capability failures',
		);
		await f.close(instance);
	},
);

for (const invocation of [
	{ method: 'registry.discover', inputJson: '{}', controlId: 2 },
	{ method: 'registry.describe', inputJson: {} },
]) {
	await test(
		'Native malformed capability cannot be caught into a successful callable: ' + invocation.method,
		{ timeout: 60000 },
		async (t) => {
			const f = await fixture(t);
			let sourceCalls = 0;
			const instance = await f.open(
				`export function activate() { return [${JSON.stringify(nativeDefinition)}]; }
export async function dispatch(input, source) {
 try { await source.call(${JSON.stringify(invocation)}); } catch {}
 try { await source.call({method:'registry.discover',inputJson:'{}'}); } catch {}
 return { resultJson: '{}' };
}
export function health() { return true; }`,
				async () => assert.fail('Malformed capability cannot borrow global Host'),
				true,
			);
			await instance.activate();
			await assert.rejects(
				instance.invokeCallable(nativeInput('invalid'), new AbortController().signal, 15000, async () => {
					sourceCalls++;
					assert.fail('Malformed request must be rejected before its capability owner');
				}),
				(error) => error instanceof ModuleRuntimeFailure && error.kind === 'protocol_invalid',
			);
			assert.equal(sourceCalls, 0);
			assert.equal(await instance.health(), true, 'Finite refusal preserves the original IPC frame and process');
			await f.close(instance);
		},
	);
}

await test(
	'Source IPC retains pending calls past 30 seconds and admits additional calls',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gates = Array.from({ length: 33 }, () => f.gate());
		let reads = 0;
		const admitted = f.gate();
		const instance = await f.open(
			`import { mock } from 'node:test';
export async function execution(input, source) {
 mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
 const tasks = Array.from({length:32}, (_,id) => source.read({id}));
 await source.read({advance:true});
 mock.timers.tick(31000);
 tasks.push(source.read({id:32}));
 const values = await Promise.all(tasks);
 return {values};
}`,
			async () => assert.fail('source must not enter global Host'),
		);
		await instance.activate();
		t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
		const result = instance.invoke('{}', new AbortController().signal, 45000, {
			exportName: 'execution',
			methods: ['read'],

			read: ({ input }) => {
				if (input.advance) {
					assert.equal(reads, 32, 'All original IPC requests precede the clock barrier');
					t.mock.timers.tick(32000);
					return null;
				}
				assert.ok(Number.isSafeInteger(input.id), 'source identity stays intact');
				reads++;
				if (reads === 33) admitted.resolve();
				return gates[input.id].promise;
			},
		});
		const observed = Promise.allSettled([result]);
		// Cross the former timeout in both owning processes while real IPC calls remain pending.
		await admitted.promise;
		assert.equal(reads, 33);
		for (let i = 0; i < 33; i++) gates[i].resolve(i);
		assert.deepEqual(await observed, [
			{ status: 'fulfilled', value: { values: Array.from({ length: 33 }, (_, i) => i) } },
		]);
		await f.close(instance);
	},
);

await test('Source control preserves a deadline beyond the Node timer maximum', { timeout: 60000 }, async (t) => {
	const f = await fixture(t);
	const instance = await f.open(
		`export async function execution(input, source) {
 // Real timer turn is required here to expose native overflow/clamping of the invocation deadline.
 await new Promise((resolve) => setTimeout(resolve, 25));
 return source.read({deadline:'original'});
}`,
		async () => assert.fail('unexpected global Host'),
	);
	await instance.activate();
	assert.equal(
		await instance.invoke('{}', new AbortController().signal, 2_147_483_648, {
			exportName: 'execution',
			methods: ['read'],

			read: async () => 'completed',
		}),
		'completed',
	);
	await f.close(instance);
});

for (const ordinaryHostPending of [false, true]) {
	await test(
		`Source bad frame ${ordinaryHostPending ? 'retains ordinary Host uncertainty' : 'can close only after actual process and files drain'}`,
		{ timeout: 60000 },
		async (t) => {
			const f = await fixture(t);
			const gate = f.gate();
			let calls = 0;
			const instance = await f.open(
				`export function activate({request}) {
 ${ordinaryHostPending ? 'void request({effect:true}).catch(() => {});' : ''}
}
export async function execution() {
 process.stdout.write('not-json\\n');
 await new Promise(() => {});
}`,
				async () => {
					calls++;
					return gate.promise;
				},
			);
			await instance.activate();
			if (ordinaryHostPending)
				await until(
					() => calls,
					(value) => value === 1,
					'original ordinary Host callback dispatched',
				);
			await assert.rejects(
				instance.invoke('{}', new AbortController().signal, 15000, {
					exportName: 'execution',
					methods: ['read'],

					read: async () => assert.fail('unexpected source read'),
				}),
				(error) =>
					error instanceof ModuleRuntimeFailure &&
					error.kind === (ordinaryHostPending ? 'protocol_invalid' : 'source_failed'),
			);
			await assert.rejects(
				instance.exited,
				(error) =>
					error instanceof ModuleRuntimeFailure &&
					error.kind === (ordinaryHostPending ? 'protocol_invalid' : 'source_failed'),
			);
			const close = instance.close();
			const outcome = Promise.allSettled([close]);
			let settled = false;
			void close.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			if (ordinaryHostPending) {
				assert.equal(settled, false);
				assert.equal(
					(await readdir(f.directory)).length,
					1,
					'ordinary Host task still owns the materialization',
				);
				gate.resolve(null);
				const [result] = await outcome;
				assert.equal(result.status, 'rejected');
				await f.close(
					instance,
					(error) =>
						error === result.reason &&
						error instanceof ModuleRuntimeFailure &&
						error.kind === 'execution_unknown',
				);
			} else {
				assert.deepEqual(await outcome, [{ status: 'fulfilled', value: undefined }]);
				await f.close(instance);
			}
			assert.equal(calls, ordinaryHostPending ? 1 : 0);
			assert.deepEqual(await readdir(f.directory), []);
		},
	);
}

await test(
	'Bound owner publishes close before synchronous abort reentry and drains the real child once',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const instance = await f.open('export function health() { return true; }', async () =>
			assert.fail('unexpected Host'),
		);
		await instance.activate();
		let quiesces = 0,
			closes = 0,
			settlements = 0;
		const gate = f.gate();
		const service = new PluginRuntimeService(
			{
				settleRuntime: async () => {
					settlements++;
				},
			},
			{ subscribe: () => () => {} },
		);
		// Isolate the bound-owner close algorithm. Process exit and materialization cleanup
		// still run through the real NodeModuleRuntime; no installation/open RPC is claimed.
		const owner = {
			appId: randomUUID(),
			instanceId: randomUUID(),
			runtimeKey: 'fixture',
			closePromise: null,
			closing: false,
			stop: new AbortController(),
			opening: null,
			observation: null,
			pending: new Set([gate.promise]),
			failures: [],
			instance: {
				quiesce: (deadline) => {
					quiesces++;
					return instance.quiesce(deadline);
				},

				close: () => {
					closes++;
					return instance.close();
				},
			},
		};
		let reentered;
		owner.stop.signal.addEventListener(
			'abort',
			() => {
				reentered = service.closeBoundOwner(owner);
			},
			{ once: true },
		);
		const close = service.closeBoundOwner(owner);
		assert.equal(reentered, close);
		assert.equal(service.closeBoundOwner(owner), close);
		let settled = false;
		void close.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		await instance.exited;
		assert.equal(settled, false, 'real child exit cannot release the original pending owner task');
		gate.resolve();
		await close;
		assert.equal(quiesces, 1);
		assert.equal(closes, 1);
		assert.equal(settlements, 1);
		assert.deepEqual(await readdir(f.directory), []);
		await f.close(instance);
	},
);

await test(
	'B10 the same secondary technical failure propagated by two tasks is recorded once',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gates = [f.gate(), f.gate(), f.gate()];
		const first = new Error('first independent host failure');
		const secondary = new ModuleRuntimeFailure('execution_unknown', {
			cause: new Error('shared later technical failure'),
		});
		let calls = 0,
			settled = 0;
		const instance = await f.open(callsSource(3), ({ id }) => {
			calls++;
			return gates[id].promise.finally(() => settled++);
		});
		await instance.activate();
		await until(
			() => calls,
			(value) => value === 3,
			'three original callbacks entered',
		);
		gates[0].reject(first);
		await assert.rejects(instance.exited, (error) => contains(error, first));
		gates[1].reject(secondary);
		gates[2].reject(secondary);
		await until(
			() => settled,
			(value) => value === 3,
			'both propagations of the same secondary failure settle',
		);
		await f.close(instance, (error) => {
			assert.ok(error.cause instanceof AggregateError);
			assert.equal(error.cause.errors.length, 2);
			assert.ok(contains(error, first));
			assert.equal(error.cause.errors.filter((value) => value === secondary).length, 1);
			return true;
		});
	},
);

for (const failedCleanup of [false, true]) {
	await test(
		'Start during configuration replacement ' +
			(failedCleanup
				? 'preserves unknown cleanup without opening a replacement'
				: 'awaits retirement and starts the current instance'),
		async (t) => {
			const entered = Promise.withResolvers();
			const release = Promise.withResolvers();
			const closingEntered = Promise.withResolvers();
			const closeRelease = Promise.withResolvers();
			const appId = randomUUID();
			const logical = { id: appId, packageId: 'test.replacement', enabled: true };
			const service = new PluginRuntimeService(
				{},
				{
					subscribe: () => () => {},

					list: async () => [logical],
				},
			);
			let openings = 0;
			const cleanupFailure = new ToolCleanupFailure({
				cause: new Error('Controlled original construction cleanup failure'),
			});
			t.mock.method(service, 'closeBoundOwner', async () => {
				closingEntered.resolve();
				await closeRelease.promise;
				if (failedCleanup) throw cleanupFailure;
			});
			t.mock.method(service, 'startInstance', async (_user, _app, signal, binding) => {
				openings++;
				if (openings > 1) return;
				binding.owner = { instanceId: randomUUID() };
				entered.resolve();
				await release.promise;
				assert.equal(signal.aborted, true);
				throw new AgentFailure('provider_unavailable');
			});
			const signal = new AbortController().signal;
			const original = Promise.allSettled([service.start(1, appId, signal, logical.packageId, appId)]);
			await entered.promise;
			const shutdown = Promise.allSettled([service.stopInstance(1, appId, appId)]);
			const replacement = service.start(1, appId, signal, logical.packageId, appId);
			const result = Promise.allSettled([replacement]);
			let settled = false;
			void result.then(() => (settled = true));
			await Promise.resolve();
			assert.equal(settled, false, 'a replacement cannot bypass original pending cleanup');
			assert.equal(openings, 1);
			release.resolve();
			assert.equal((await original)[0].status, 'rejected');
			await closingEntered.promise;
			const late = Promise.allSettled([service.start(1, appId, signal, logical.packageId, appId)]);
			await Promise.resolve();
			assert.equal(openings, 1, 'settled construction retains its pending retirement owner');
			closeRelease.resolve();
			if (failedCleanup) {
				assert.equal((await shutdown)[0].status, 'rejected');
				const [outcome] = await result;
				assert.equal(outcome.status, 'rejected');
				assert.equal(outcome.reason.code, 'operation_unknown');
				assert.equal(openings, 1);
				assert.equal((await late)[0].reason.code, 'operation_unknown');
				await assert.rejects(service.start(1, appId, signal, logical.packageId, appId), {
					code: 'operation_unknown',
				});
				assert.equal(openings, 1, 'unknown retirement cannot be bypassed by a later start');
			} else {
				assert.equal((await shutdown)[0].status, 'fulfilled');
				assert.equal((await result)[0].status, 'fulfilled');
				assert.equal((await late)[0].status, 'fulfilled');
				assert.equal(openings, 2);
			}
		},
	);
}
