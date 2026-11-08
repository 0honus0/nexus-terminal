import { test, expect as verify } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';

test('command history reads every real page then deletes and clears persisted records', async () => {
	await openAuthenticatedFrontendApplication();
	const { commandHistoryApi } =
		await import('../../../../packages/frontend/src/features/command-history/api/command-history-api.ts');
	const { useCommandHistoryStore } =
		await import('../../../../packages/frontend/src/features/command-history/store/commandHistory.store.ts');
	const results = [];

	const expect = (condition, name) => {
		if (!condition) throw Error(name);
		results.push(name);
	};

	for (let index = 0; index < 102; index++) await commandHistoryApi.add('history-page-' + index);
	const history = useCommandHistoryStore();
	await history.load();
	expect(
		history.items.length === 102 && history.items.some((item) => item.command === 'history-page-0'),
		'command history follows actual Shared pagination',
	);
	await history.remove(history.items[0].id);
	await history.clear();
	expect(history.items.length === 0, 'command history delete/clear decode finite actual receipts');

	verify(results).toHaveLength(2);
});
