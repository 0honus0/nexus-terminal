import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-service.js';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { until } from '../remote/openssh-fixture.mjs';

function gate() {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

/** Isolate scheduling from tool I/O; use the real catalog classifications and scheduler. */
class ScheduledTools extends ToolService {
	constructor(work) {
		super(
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			{
				async frozen() {
					return { limits: { maxToolExecutions: 2 } };
				},
			},
			null,
			null,
			null,
			null,
			null,
		);
		this.work = work;
	}

	execute(scope, proposal, signal) {
		return this.work(scope, proposal, signal);
	}
}

const scope = { userId: 1, appId: 'fixture', runId: 'fixture', modelStepIndex: 1 };

const proposal = (index, toolName = 'file_read') => ({ toolName, providerCallId: String(index), argumentsJson: '{}' });

await test(
	'Agent parallel reads overlap within the frozen budget, exclusive calls fence both sides, and results keep model order',
	{ timeout: 10000 },
	async () => {
		const started = [];
		const gates = Array.from({ length: 5 }, gate);
		const scheduler = new ScheduledTools(async (_scope, call) => {
			const index = Number(call.providerCallId);
			started.push(index);
			await gates[index].promise;
			return 'result-' + index;
		});
		const failures = [];
		const pending = scheduler.executeBatch(
			scope,
			[proposal(0), proposal(1), proposal(2), proposal(3, 'collaboration_fact_write'), proposal(4)],
			new AbortController().signal,
			(error) => failures.push(error),
		);
		// Attach before assertions so a failed assertion never leaves an unobserved task.
		const settled = pending.then(
			(value) => ({ value }),
			(error) => ({ error }),
		);
		try {
			await until(
				() => started.slice(),
				(items) => items.length === 2,
				'Two reads overlap',
			);
			assert.deepEqual(started, [0, 1]);
			gates[1].release();
			await until(
				() => started.slice(),
				(items) => items.length === 3,
				'Budget slot reused',
			);
			assert.deepEqual(started, [0, 1, 2]);
			gates[2].release();
			assert.equal(started.includes(3), false);
			gates[0].release();
			await until(
				() => started.slice(),
				(items) => items.length === 4,
				'Exclusive barrier entered',
			);
			assert.equal(started.includes(4), false);
			gates[3].release();
			await until(
				() => started.slice(),
				(items) => items.length === 5,
				'Read after exclusive completion',
			);
			gates[4].release();
			assert.deepEqual(
				await pending,
				Array.from({ length: 5 }, (_, index) => ({
					providerCallId: String(index),
					content: 'result-' + index,
				})),
			);
			assert.deepEqual(failures, []);
		} finally {
			for (const item of gates) item.release();
			await settled;
		}
	},
);

for (const cancel of [false, true]) {
	await test(
		cancel
			? 'Agent cancellation stops queued reads and waits for started calls'
			: 'Agent first failure stops queued reads, drains siblings and preserves the named failure',
		{ timeout: 10000 },
		async () => {
			const first = gate();
			const draining = gate();
			const controller = new AbortController();
			const started = [];
			const aborted = [];
			const failures = [];
			let finished = false;
			const scheduler = new ScheduledTools(async (_scope, call, signal) => {
				const index = Number(call.providerCallId);
				started.push(index);
				if (index === 0 && !cancel) {
					await first.promise;
					throw new AgentFailure('forbidden');
				}
				await new Promise((resolve) => {
					if (signal.aborted) resolve();
					else signal.addEventListener('abort', resolve, { once: true });
				});
				aborted.push(index);
				await draining.promise;
				throw new AgentFailure('provider_unavailable');
			});
			const pending = scheduler.executeBatch(
				scope,
				[proposal(0), proposal(1), proposal(2)],
				controller.signal,
				(error, name) => failures.push({ error, name }),
			);
			const settled = pending.then(
				(value) => {
					finished = true;
					return { value };
				},
				(error) => {
					finished = true;
					return { error };
				},
			);
			try {
				await until(
					() => started.length,
					(count) => count === 2,
					'Started read pair',
				);
				if (cancel) controller.abort();
				else first.release();
				await until(
					() => aborted.length,
					(count) => count === (cancel ? 2 : 1),
					'Active siblings receive cancellation',
				);
				assert.equal(finished, false, 'Caller must remain owned until real work drains');
				assert.deepEqual(started, [0, 1]);
				draining.release();
				await assert.rejects(
					pending,
					(error) =>
						error instanceof AgentFailure && error.code === (cancel ? 'provider_unavailable' : 'forbidden'),
				);
				assert.equal(failures.length, 2, 'Never report a queued cancellation as an independent failure');
				assert.deepEqual(started, [0, 1]);
			} finally {
				controller.abort();
				first.release();
				draining.release();
				await settled;
			}
		},
	);
}
