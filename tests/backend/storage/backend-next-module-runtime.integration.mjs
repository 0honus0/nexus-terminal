import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeModuleRuntime } from '../../../packages/backend/dist/platform/isolation/adapters/node-module-runtime.js';
import { ModuleRuntimeFailure } from '../../../packages/backend/dist/platform/isolation/module-runtime.js';
import { processIdentity } from '../../../packages/backend/dist/platform/isolation/adapters/module-recovery.js';
import { until } from '../remote/openssh-fixture.mjs';

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
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-module-host-'));
	const runtime = new NodeModuleRuntime(directory);
	const opened = new Set();
	const gates = [];
	t.after(async () => {
		for (const gate of gates) gate.resolve(null);
		const results = await Promise.allSettled([...opened].map((instance) => instance.close()));
		const errors = results.filter((value) => value.status === 'rejected').map((value) => value.reason);
		try {
			await rm(directory, { recursive: true, force: true });
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

		async open(source, host) {
			const bytes = Buffer.from(source);
			const instance = await runtime.open({
				files: [{ path: 'main.mjs', bytes, sha256: createHash('sha256').update(bytes).digest('hex') }],
				entry: 'main.mjs',
				contextJson: '{}',
				host,
			});
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

await test(
	'B10 real worker admits 32 host calls, refuses 33rd locally and reuses released slots',
	{ timeout: 60000 },
	async (t) => {
		const f = await fixture(t);
		const gates = Array.from({ length: 32 }, () => f.gate());
		const seen = [];
		let after = 0;
		const instance = await f.open(
			`let healthy = false;
export function activate({request}) {
 const tasks = Array.from({length:32}, (_, id) => request({id}));
 const overflow = request({id:'overflow'}).then(() => false, () => true);
 Promise.all([Promise.all(tasks),overflow]).then(async ([values, refused]) => {
  const reply = await request({id:'after'});
  healthy = refused && values.every((value,id) => value.id === id) && reply.ok;
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
				assert.ok(Number.isSafeInteger(id) && id >= 0 && id < 32, 'overflow must not dispatch a host callback');
				return gates[id].promise;
			},
		);
		await instance.activate();
		await until(
			() => seen.length,
			(value) => value === 32,
			'all 32 actual host callbacks started',
		);
		assert.deepEqual(
			seen,
			Array.from({ length: 32 }, (_, id) => id),
		);
		assert.equal(await instance.health(), false);
		for (let id = 0; id < 32; id++) gates[id].resolve({ id });
		await until(
			() => instance.health(),
			(value) => value,
			'all actual replies correlated and a new host call succeeds',
		);
		assert.equal(after, 1);
		assert.equal(seen.length, 33);
		await f.close(instance);
		assert.deepEqual(await readdir(f.directory), []);
	},
);

await test(
	'B10 real runtime control capacity retains eight waiting calls and recovers after completion',
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
		const results = Promise.allSettled(Array.from({ length: 8 }, () => instance.health()));
		await assert.rejects(
			instance.health(),
			(error) => error instanceof ModuleRuntimeFailure && error.kind === 'unavailable',
		);
		gate.resolve(null);
		assert.deepEqual(
			await results,
			Array.from({ length: 8 }, () => ({ status: 'fulfilled', value: true })),
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
			(error) => error instanceof ModuleRuntimeFailure && error.kind === 'execution_unknown',
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
