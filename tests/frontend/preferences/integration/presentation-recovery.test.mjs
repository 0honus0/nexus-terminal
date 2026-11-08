import { test, expect, vi, onTestFinished } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import { usePresentationStore } from '../../../../packages/frontend/src/features/preferences/public.ts';
import { presentationApi } from '../../../../packages/frontend/src/features/preferences/api/presentation-api.ts';
import { PreferenceRequestFailure } from '../../../../packages/frontend/src/client/preferences/preference-request.ts';

test('a real presentation commit with lost receipt keeps its fence until a deliberate later read', async () => {
	const { application } = await openAuthenticatedFrontendApplication();
	const store = usePresentationStore();
	const value = await store.load(true);
	let writes = 0;
	vi.stubGlobal('fetch', async (url, options) => {
		const response = await application.fetch(url, options);
		if (String(url).endsWith('/settings/preferences') && options?.method === 'PUT') {
			writes++;
			expect(response.status).toBe(200);
			throw new Error('Controlled loss after actual presentation commit');
		}
		return response;
	});
	const change = {
		action: 'preferences',
		expectedVersion: value.version,
		preferences: { ...value.preferences, timezone: 'UTC' },
	};
	const write = store.update(change).catch((cause) => cause);
	const premature = store.load(true).catch((cause) => cause);
	const failure = await write;
	expect(failure).toBeInstanceOf(PreferenceRequestFailure);
	expect(failure.outcome).toBe('unknown');
	await premature;
	expect(store.blocked).toBe(true);
	expect(store.snapshot).toBe(value);
	expect(store.error).toBe(failure);
	await expect(store.update(change)).rejects.toMatchObject({ code: 'refresh_required', outcome: 'not_dispatched' });
	expect(writes).toBe(1);
	const recovered = await store.load(true);
	expect(recovered.preferences.timezone).toBe('UTC');
	expect(recovered.version).toBe(value.version + 1);
	expect(store.blocked).toBe(false);
	expect(writes).toBe(1);
});

test('a presentation draft cancelled behind a real read never dispatches a write', async () => {
	const { application } = await openAuthenticatedFrontendApplication();
	const store = usePresentationStore();
	const value = await store.load(true);
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	onTestFinished(() => release.resolve());
	let writes = 0;
	let hold = true;
	vi.stubGlobal('fetch', async (url, options) => {
		if (options?.method === 'PUT') writes++;
		const response = await application.fetch(url, options);
		if (hold && String(url).endsWith('/settings/sidebar')) {
			hold = false;
			entered.resolve();
			await release.promise;
		}
		return response;
	});
	const read = store.load(true);
	const permission = new AbortController();
	const write = store
		.update({ action: 'focus', expectedVersion: value.version, focus: value.focus }, permission.signal)
		.catch((cause) => cause);
	await entered.promise;
	permission.abort();
	release.resolve();
	await read;
	expect(await write).toMatchObject({ code: 'cancelled', outcome: 'not_dispatched' });
	expect(writes).toBe(0);
});

test('personal presentation refuses a bare legacy layout without synthesizing a snapshot', async () => {
	const { application } = await openAuthenticatedFrontendApplication();
	const requests = [];
	vi.stubGlobal('fetch', (url, options) => {
		const request = String(url).endsWith('/settings/layout')
			? Promise.resolve(
					new Response(JSON.stringify({ type: 'container', id: 'legacy', children: [] }), {
						headers: { 'Content-Type': 'application/json' },
					}),
				)
			: application.fetch(url, options);
		requests.push(request);
		return request;
	});
	await expect(presentationApi.load()).rejects.toMatchObject({ code: 'protocol_failure' });
	await Promise.allSettled(requests);
	expect(usePresentationStore().snapshot).toBeNull();
});
