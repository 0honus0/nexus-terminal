import { test, expect, vi, onTestFinished } from 'vitest';
import { openNotifications, webhookChange } from '../support/fixture.mjs';
import { OperationsRequestFailure } from '../../../../packages/frontend/src/client/operations/operations-request.ts';

function gate() {
	const value = Promise.withResolvers();
	onTestFinished(() => value.resolve());
	return value;
}

test('real commit with lost response retains unknown and rejects recovery requested before the fault', async () => {
	const { app, store, origin } = await openNotifications();
	const saved = await store.save(webhookChange(origin, 'Original channel'), null);
	const committed = gate();
	const release = gate();
	let writes = 0;
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (input?.method !== 'POST') return response;
		writes++;
		committed.resolve();
		await release.promise;
		throw new TypeError('fixture response lost after actual commit');
	});
	const write = store.save(webhookChange(origin, 'Lost response fixture', '/unknown'), null).catch((cause) => cause);
	const prematureRead = store.load(true).catch((cause) => cause);
	await committed.promise;
	release.resolve();
	const [failure, read] = await Promise.all([write, prematureRead]);
	expect(failure).toBeInstanceOf(OperationsRequestFailure);
	expect(failure.outcome).toBe('unknown');
	expect(read).toBeInstanceOf(OperationsRequestFailure);
	expect(read.code).toBe('refresh_required');
	await expect(store.testSaved(saved.id)).rejects.toMatchObject({
		code: 'refresh_required',
		outcome: 'not_dispatched',
	});
	expect(store.needsRefresh).toBe(true);
	await store.load(true);
	expect(store.items.filter((item) => item.name === 'Lost response fixture')).toHaveLength(1);
	expect(writes).toBe(1);
});

test('cancelled view intent behind an actual settings read never dispatches its queued write', async () => {
	const { app, store, origin } = await openNotifications();
	const started = gate();
	const release = gate();
	let writes = 0;
	vi.stubGlobal('fetch', async (path, input) => {
		if (input?.method === 'POST') writes++;
		const response = await app.fetch(path, input);
		if (input?.method === 'GET') {
			started.resolve();
			await release.promise;
		}
		return response;
	});
	const controller = new AbortController();
	const read = store.load(true);
	const write = store
		.save(webhookChange(origin, 'Never dispatched'), null, controller.signal)
		.catch((cause) => cause);
	controller.abort();
	await started.promise;
	release.resolve();
	const [, failure] = await Promise.all([read, write]);
	expect(failure).toBeInstanceOf(OperationsRequestFailure);
	expect(failure).toMatchObject({ code: 'cancelled', outcome: 'not_dispatched' });
	expect(writes).toBe(0);
});
