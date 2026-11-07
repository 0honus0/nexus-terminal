import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAgentExecution, discoverTools } from './agent-execution-fixture.mjs';
import { openSshd, until } from '../remote/openssh-fixture.mjs';
import { PluginRuntimeService } from '../../../packages/backend/dist/modules/agent/plugins/service/plugin-runtime-service.js';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { OperationEffectFailure } from '../../../packages/backend/dist/modules/agent/operations/model/operation-failure.js';

function gate() {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

/** Only delivery is gated. The signed App, Registry, Operations, SSH reads/writes and approvals are real. */
async function openScheduler(t, label, interrupt = false) {
	const directory = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'sdk4-scheduling-'));
	const sshd = await openSshd(directory);
	let f;
	try {
		f = await openAgentExecution(directory, sshd);
	} catch (error) {
		await sshd.close();
		throw error;
	}
	const paths = Array.from({ length: 5 }, (_, index) => join(directory, 'sample-' + index + '.txt'));
	for (const [index, path] of paths.entries()) if (index !== 3) await writeFile(path, 'read-' + index);
	const gates = paths.map(gate);
	const started = [];
	const original = PluginRuntimeService.prototype.invokeCallable;
	PluginRuntimeService.prototype.invokeCallable = async function (resolved, scope, signal, bridge) {
		const args = JSON.parse(resolved.argumentsJson);
		const index = paths.indexOf(args.paths?.[0] ?? args.items?.[0]?.path);
		if (index < 0) return original.call(this, resolved, scope, signal, bridge);
		started.push(index);
		const result = await original.call(this, resolved, scope, signal, bridge);
		await gates[index].promise;
		if (signal.aborted) throw new AgentFailure('forbidden');
		if (interrupt && index === 0) throw new OperationEffectFailure('operation_unknown', 'unknown', 'closed');
		return result;
	};
	t.after(async () => {
		PluginRuntimeService.prototype.invokeCallable = original;
		for (const item of gates) item.release();
		const results = await Promise.allSettled([f.close(), sshd.close()]);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) throw new AggregateError(failures, 'Scheduler fixture cleanup failed');
	});

	const read = (index) => ({ name: 'file_read', input: { connectionId: f.connectionId, paths: [paths[index]] } });

	const write = {
		name: 'file_write',
		input: {
			connectionId: f.connectionId,
			items: [{ path: paths[3], content: 'approved write', expectedSha256: 'absent' }],
		},
	};
	return { f, paths, gates, started, read, write, label };
}

await test(
	'App parallel reads overlap, effects fence both sides, and model results retain proposal order',
	{ timeout: 60000 },
	async (t) => {
		const { f, paths, gates, started, read, write } = await openScheduler(t, 'ordered');
		const run = await f.start(
			'Parallel reads and exclusive effect',
			discoverTools('file_write', (results) => {
				if (!results.length) return { calls: [read(0), read(1), read(2), write, read(4)] };
				assert.equal(results.length, 5);
				for (const index of [0, 1, 2, 4])
					assert.match(JSON.stringify(results[index]), new RegExp('read-' + index));
				assert.equal(results[3].items[0].status, 'completed');
				return { text: 'Ordered results consumed' };
			}),
		);
		await until(
			() => started.length,
			(count) => count === 3,
			'All independent reads overlap',
		);
		assert.deepEqual([...started].sort(), [0, 1, 2]);
		gates[2].release();
		gates[1].release();
		assert.equal(started.includes(3), false);
		gates[0].release();
		const approval = await f.approval(run, 'file_write');
		assert.deepEqual(started.slice(3), [3]);
		await assert.rejects(readFile(paths[3]), { code: 'ENOENT' });
		await f.approve(approval);
		await until(
			() =>
				readFile(paths[3], 'utf8').catch((error) => {
					if (error.code === 'ENOENT') return null;
					throw error;
				}),
			(value) => value === 'approved write',
			'Actual approved write',
		);
		assert.equal(started.includes(4), false, 'The read after the effect cannot pass its delivery fence');
		gates[3].release();
		await until(
			() => started.length,
			(count) => count === 5,
			'Read after the exclusive effect',
		);
		gates[4].release();
		await f.wait(run, 'completed');
		assert.equal(f.operations(run).filter((row) => row.label === 'remote.write').length, 1);
		assert.equal(f.calls.length, 3);
	},
);

for (const cancel of [true, false]) {
	await test(
		cancel
			? 'App cancellation drains started reads and never dispatches a queued effect'
			: 'An interrupted parallel invocation drains its sibling and prevents the next effect',
		{ timeout: 60000 },
		async (t) => {
			const { f, paths, gates, started, read, write } = await openScheduler(
				t,
				cancel ? 'cancel' : 'interrupt',
				!cancel,
			);
			const run = await f.start(
				cancel ? 'Cancel overlapping reads' : 'Interrupt parallel result',
				discoverTools('file_write', (results) => {
					assert.equal(results.length, 0, 'No later model request may follow the interrupted batch');
					return { calls: [read(0), read(1), write] };
				}),
			);
			await until(
				() => started.length,
				(count) => count === 2,
				'Started read pair',
			);
			if (cancel) await f.cancel(run);
			gates[0].release();
			assert.equal(started.includes(3), false);
			gates[1].release();
			await f.wait(run, cancel ? 'cancelled' : 'unknown');
			await until(
				() =>
					f
						.operations(run)
						.filter((row) => row.kind === 'tool' && row.label.endsWith('.file_read'))
						.map((row) => row.state),
				(states) =>
					states.length === 2 &&
					states.every((state) => ['completed', 'cancelled', 'unknown'].includes(state)),
				'Every accepted read settles',
			);
			assert.deepEqual([...started].sort(), [0, 1]);
			assert.ok(!f.operations(run).some((row) => row.label === 'remote.write'));
			await assert.rejects(readFile(paths[3]), { code: 'ENOENT' });
			assert.equal(f.calls.length, 2);
		},
	);
}
