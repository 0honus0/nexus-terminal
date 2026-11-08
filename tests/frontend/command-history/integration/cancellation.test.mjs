import { test, expect, vi, onTestFinished } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import { commandHistoryApi } from '../../../../packages/frontend/src/features/command-history/api/command-history-api.ts';
import { useCommandHistoryStore } from '../../../../packages/frontend/src/features/command-history/store/commandHistory.store.ts';
import { PreferenceRequestFailure } from '../../../../packages/frontend/src/client/preferences/preference-request.ts';

test('history intent revoked behind an actual read never dispatches a queued POST', async () => {
	const { application } = await openAuthenticatedFrontendApplication();
	const history = useCommandHistoryStore();
	await commandHistoryApi.add('confirmed history baseline');
	await history.load();
	expect(history.items.map((item) => item.command)).toEqual(['confirmed history baseline']);
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	onTestFinished(() => release.resolve());
	let writes = 0;
	let held = false;
	vi.stubGlobal('fetch', async (url, options) => {
		if (String(url).endsWith('/command-history') && options?.method === 'POST') writes++;
		const response = await application.fetch(url, options);
		if (!held && String(url).includes('/command-history') && options?.method === 'GET') {
			held = true;
			entered.resolve();
			await release.promise;
		}
		return response;
	});
	const loading = history.load();
	await entered.promise;
	const permission = new AbortController();
	const queued = history.add('revoked-queued-history', permission.signal).catch((cause) => cause);
	permission.abort();
	release.resolve();
	await loading;
	const failure = await queued;
	expect(failure).toBeInstanceOf(PreferenceRequestFailure);
	expect(failure.outcome).toBe('not_dispatched');
	expect(writes).toBe(0);
	expect((await commandHistoryApi.list()).map((item) => item.command)).toEqual(['confirmed history baseline']);
	await history.clear();
	expect(await commandHistoryApi.list()).toEqual([]);
});
