import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'vitest';
import { RunChanges } from '../../../../../packages/backend/src/modules/agent/runs/model/run-changes.ts';

test('Run invalidations and shutdown keep subscriber authority across unrelated request scopes', async () => {
	const context = new AsyncLocalStorage();
	const changes = new RunChanges();
	const scope = { userId: 1, appId: 'app', runId: 'run' };
	const observed = [];
	let pending;
	let stopped;
	context.run('run-owner', () => {
		changes.subscribe(
			scope,
			() => {
				pending = Promise.resolve().then(() => observed.push(context.getStore()));
			},
			() => {
				stopped = context.getStore();
			},
		);
	});
	context.run('approval-http-request', () => changes.notify(scope));
	await pending;
	assert.deepEqual(observed, ['run-owner']);
	context.run('shutdown-request', () => changes.quiesce());
	assert.equal(stopped, 'run-owner');
	assert.equal(context.getStore(), undefined);
});
