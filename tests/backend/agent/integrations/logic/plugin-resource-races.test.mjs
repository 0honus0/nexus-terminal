import assert from 'node:assert/strict';
import { test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DefaultToolResources } from '../../../../../packages/backend/src/modules/agent/tools/service/default-tool-resources.ts';
import { PluginService } from '../../../../../packages/backend/src/modules/agent/plugins/service/plugin-service.ts';
import {
	AgentFailure,
	ToolCleanupFailure,
	ToolExecutionUnknown,
} from '../../../../../packages/backend/src/modules/agent/agent-failure.ts';

function gate() {
	return Promise.withResolvers();
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const actor = { userId: 1, appId: randomUUID(), runId: randomUUID(), token: 'controlled-token' };

const refused = (code) => (error) => error instanceof AgentFailure && error.code === code;

test('Integration races: synchronous protocol failure still drains Jobs, Browser and SSH before settlement', async () => {
	const job = gate();
	const browser = gate();
	const model = gate();
	const failures = [
		new Error('protocol sync'),
		new AgentFailure('storage_unavailable'),
		new ToolCleanupFailure(),
		new Error('SSH drain'),
	];
	const calls = [];
	const resources = new DefaultToolResources(
		{
			async drainRun(runId) {
				assert.equal(runId, actor.runId);
				calls.push('ssh');
				await model.promise;
				throw failures[3];
			},

			settleDrain(scope, unknown) {
				assert.equal(scope, actor);
				assert.equal(unknown, true);
				calls.push('settled');
			},
		},
		{
			async drain(scope) {
				assert.equal(scope, actor);
				calls.push('job');
				await job.promise;
				throw failures[1];
			},
		},
		{
			drainRun(scope) {
				assert.equal(scope, actor);
				calls.push('protocol');
				throw failures[0];
			},
		},
		{
			async drainRun(scope) {
				assert.equal(scope, actor);
				calls.push('browser');
				await browser.promise;
				throw failures[2];
			},
		},
	);
	let settled = false;
	const task = resources.drainRun(actor).then(
		() => {
			throw new Error('Unexpected successful drain');
		},
		(error) => {
			settled = true;
			return error;
		},
	);
	await tick();
	assert.deepEqual(calls, ['protocol', 'job', 'browser']);
	assert.equal(settled, false);
	job.resolve();
	await tick();
	assert.equal(settled, false);
	browser.resolve();
	await tick();
	assert.deepEqual(calls, ['protocol', 'job', 'browser', 'ssh']);
	assert.equal(settled, false);
	model.resolve();
	const error = await task;
	assert.ok(error instanceof AggregateError && !(error instanceof ToolExecutionUnknown));
	assert.deepEqual(error.errors, failures);
	assert.equal(calls.at(-1), 'settled');
});

test('Integration races: queued plugin management stops on close and admitted original work drains first', async (t) => {
	const release = gate();
	const entered = gate();
	t.onTestFinished(() => release.resolve());
	let reads = 0;
	let unsubscribed = 0;
	const model = {
		async observeRuntime() {
			reads++;
			entered.resolve();
			await release.promise;
			return null;
		},
	};
	const instances = {
		subscribe() {
			let listening = true;
			return () => {
				if (listening) {
					listening = false;
					unsubscribed++;
				}
			};
		},
	};
	const service = new PluginService(model, null, null, null, null, instances, null, null, '1.1.0', null);
	const tasks = Array.from({ length: 4 }, () =>
		service.runtimeObservation(actor, actor.appId).then(
			(value) => ({ value }),
			(error) => ({ error }),
		),
	);
	await entered.promise;
	assert.equal(reads, 1);
	const closing = service.close();
	assert.strictEqual(service.close(), closing);
	let closed = false;
	void closing.then(() => {
		closed = true;
	});
	await assert.rejects(service.runtimeObservation(actor, actor.appId), refused('provider_unavailable'));
	await tick();
	assert.equal(closed, false);
	assert.equal(unsubscribed, 1, 'Quiesce withdraws listeners immediately while original tasks remain owned');
	release.resolve();
	const results = await Promise.all(tasks);
	assert.equal(results[0].value, null);
	assert.ok(results.slice(1).every((result) => result.error?.code === 'provider_unavailable'));
	await closing;
	assert.equal(reads, 1);
	assert.equal(unsubscribed, 1);
});
