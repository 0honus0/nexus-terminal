import { test, expect, vi, onTestFinished } from 'vitest';
import { openAppearance } from '../support/fixture.mjs';
import { AppearanceRequestFailure } from '../../../../packages/frontend/src/features/appearance/model/appearance-failure.ts';

function gate() {
	const value = Promise.withResolvers();
	onTestFinished(() => value.resolve());
	return value;
}

test('a lost actual commit fences appearance writes and requires explicit recovery without replay', async () => {
	const { app, store } = await openAppearance();
	let writes = 0;
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (path === '/api/v1/appearance' && input?.method === 'PUT') {
			writes++;
			throw new TypeError('fixture committed response lost');
		}
		return response;
	});
	await expect(
		store.update({ windowThemeColor: '#654321' }, store.version, new AbortController().signal),
	).rejects.toMatchObject({ outcome: 'unknown' });
	expect(store.blocked).toBe(true);
	await expect(
		store.update({ windowThemeColor: '#654321' }, store.version, new AbortController().signal),
	).rejects.toMatchObject({ code: 'refresh_required' });
	await expect(store.load()).rejects.toMatchObject({ code: 'refresh_required' });
	expect(writes).toBe(1);
	await store.load(true);
	expect(store.blocked).toBe(false);
	expect(store.snapshot.windowThemeColor).toBe('#654321');
	expect(writes).toBe(1);
});

test('recovery requested before a fault must not publish its later read or clear preview and error evidence', async () => {
	const { app, store } = await openAppearance();
	const committed = gate();
	const release = gate();
	const before = store.snapshot;
	let writes = 0;
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (path === '/api/v1/appearance' && input?.method === 'PUT') {
			writes++;
			committed.resolve();
			await release.promise;
			throw new TypeError('fixture committed response lost');
		}
		return response;
	});
	store.previewSettings({ terminalFontSize: 22 });
	const write = store
		.update({ windowThemeColor: '#654321' }, store.version, new AbortController().signal)
		.catch((cause) => cause);
	const prematureRecovery = store.load(true).catch((cause) => cause);
	await committed.promise;
	release.resolve();
	const [failure, read] = await Promise.all([write, prematureRecovery]);
	expect(failure).toBeInstanceOf(AppearanceRequestFailure);
	expect(failure.outcome).toBe('unknown');
	expect(read).toMatchObject({ code: 'refresh_required', outcome: 'not_dispatched' });
	expect(store.snapshot).toEqual(before);
	expect(store.settings.terminalFontSize).toBe(22);
	expect(store.error).toBe(failure);
	expect(store.blocked).toBe(true);
	await store.load(true);
	expect(store.snapshot.windowThemeColor).toBe('#654321');
	expect(store.error).toBeNull();
	expect(store.blocked).toBe(false);
	expect(writes).toBe(1);
});

test('malformed successful appearance reads preserve authority and reject unexpected private fields', async () => {
	const { app, store } = await openAppearance();
	const before = store.version;
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (path !== '/api/v1/appearance') return response;
		return Response.json({ ...(await response.json()), privateField: 'must not leak' });
	});
	await expect(store.load(true)).rejects.toMatchObject({ code: 'protocol_failure' });
	expect(store.blocked).toBe(true);
	expect(store.version).toBe(before);
	expect(store.snapshot).not.toHaveProperty('privateField');
	vi.stubGlobal('fetch', app.fetch);
	await store.load(true);
	expect(store.blocked).toBe(false);
});

test('an actual late authenticated read cannot repopulate an appearance store after reset', async () => {
	const { app, store } = await openAppearance();
	const reached = gate();
	const release = gate();
	vi.stubGlobal('fetch', async (path, input) => {
		const response = await app.fetch(path, input);
		if (path === '/api/v1/appearance') {
			reached.resolve();
			await release.promise;
		}
		return response;
	});
	const pending = store.load(true).catch((cause) => cause);
	await reached.promise;
	store.reset();
	release.resolve();
	expect(await pending).toMatchObject({ code: 'cancelled' });
	expect({ snapshot: store.snapshot, loaded: store.loaded, blocked: store.blocked }).toEqual({
		snapshot: null,
		loaded: false,
		blocked: false,
	});
});
