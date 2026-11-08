import { test, expect, vi, onTestFinished } from 'vitest';
import { openMutations, evidence, persisted } from '../support/fixture.mjs';
import { MutationRequestFailure } from '../../../../packages/frontend/src/features/mutation-recovery/model/mutation-types.ts';

function gate() {
	const value = Promise.withResolvers();
	onTestFinished(() => value.resolve());
	return value;
}

test('real recovery commits survive lost responses, stale reads, protocol corruption and authenticated reset', async () => {
	const fixture = await openMutations();
	const { app, api, store } = fixture;
	const permission = new AbortController().signal;
	await store.load(permission);
	await store.select('fixture-03', permission);
	const original = store.selected;
	const input = evidence(original);
	let posts = 0;
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (path === '/api/v1/remote/mutations/fixture-03/evidence' && input?.method === 'POST') {
			posts++;
			expect(response.status).toBe(200);
			throw new TypeError('fixture evidence committed but response lost');
		}
		return response;
	});
	await expect(store.evidence(original, input, permission)).rejects.toMatchObject({ outcome: 'unknown' });
	await expect(store.evidence(original, input, permission)).rejects.toMatchObject({ code: 'refresh_required' });
	expect(store.blocked).toBe(true);
	expect(store.selected.revision).toBe(2);
	expect(posts).toBe(1);
	vi.stubGlobal('fetch', app.fetch);
	await store.load(permission, true);
	expect(store.selected.revision).toBe(3);
	expect(store.selected.evidence).toHaveLength(1);
	expect(store.blocked).toBe(false);

	const before = store.items;
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (!path.startsWith('/api/v1/remote/mutations?')) return response;
		const body = await response.json();
		body.items[0].privateSecret = 'DO_NOT_RENDER';
		return Response.json(body);
	});
	await expect(store.load(permission, true)).rejects.toMatchObject({ code: 'protocol_failure' });
	expect(store.blocked).toBe(true);
	expect(store.items).toEqual(before);
	expect(JSON.stringify(store.items)).not.toContain('DO_NOT_RENDER');
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (path !== '/api/v1/remote/mutations/fixture-05') return response;
		const body = await response.json();
		body.id = 'fixture-06';
		return Response.json(body);
	});
	await expect(api.get('fixture-05')).rejects.toMatchObject({ code: 'protocol_failure' });
	vi.stubGlobal('fetch', app.fetch);
	await store.load(permission, true);
	await store.select('fixture-05', permission);
	const committed = gate();
	const release = gate();
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (path === '/api/v1/remote/mutations/fixture-05/evidence' && input?.method === 'POST') {
			expect(response.status).toBe(200);
			committed.resolve();
			await release.promise;
			throw new TypeError('fixture late evidence response lost');
		}
		return response;
	});
	const write = store.evidence(store.selected, evidence(store.selected), permission).catch((cause) => cause);
	await committed.promise;
	const prematureRecovery = store.load(permission, true).catch((cause) => cause);
	release.resolve();
	const [failure, read] = await Promise.all([write, prematureRecovery]);
	expect(failure).toBeInstanceOf(MutationRequestFailure);
	expect(failure.outcome).toBe('unknown');
	expect(read).toMatchObject({ code: 'refresh_required' });
	expect(store.blocked).toBe(true);
	expect(store.error).toBe(failure);
	vi.stubGlobal('fetch', app.fetch);
	await store.load(permission, true);
	const reached = gate();
	const finish = gate();
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (path === '/api/v1/remote/mutations/fixture-06') {
			reached.resolve();
			await finish.promise;
		}
		return response;
	});
	const selection = store.select('fixture-06', permission).catch((cause) => cause);
	await reached.promise;
	store.reset();
	finish.resolve();
	expect(await selection).toMatchObject({ code: 'cancelled' });
	expect({ selected: store.selected, count: store.items.length, busy: store.busy }).toEqual({
		selected: null,
		count: 0,
		busy: false,
	});
	const [lost, early] = await persisted(fixture, ['fixture-03', 'fixture-05']);
	expect(lost.evidenceCount).toBe(1);
	expect(early.evidenceCount).toBe(1);
});
