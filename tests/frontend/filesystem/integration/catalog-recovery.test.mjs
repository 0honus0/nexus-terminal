import { test, expect, vi } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import { useFilesystemCatalogStore } from '../../../../packages/frontend/src/features/filesystem/composables/useFilesystemCatalog.ts';
import { filesystemCatalogApi } from '../../../../packages/frontend/src/features/filesystem/api/filesystem-catalog-api.ts';

test('a real favorite commit with lost receipt is not repeated and explicit read finds exactly one entry', async () => {
	const { application } = await openAuthenticatedFrontendApplication();
	const store = useFilesystemCatalogStore();
	let writes = 0;
	vi.stubGlobal('fetch', async (url, options) => {
		const response = await application.fetch(url, options);
		if (String(url).endsWith('/favorite-paths') && options?.method === 'POST') {
			writes++;
			expect(response.status).toBe(201);
			throw new Error('Controlled loss after actual favorite commit');
		}
		return response;
	});
	await expect(store.saveFavorite({ name: 'Unknown delivery', path: '/unknown-delivery' })).rejects.toMatchObject({
		outcome: 'unknown',
	});
	await expect(store.saveFavorite({ name: 'Must not replay', path: '/unknown-delivery' })).rejects.toMatchObject({
		outcome: 'not_dispatched',
	});
	await store.loadFavorites(true);
	expect(writes).toBe(1);
	expect(store.favorites.filter((item) => item.path === '/unknown-delivery')).toHaveLength(1);
});

test('favorite lists refuse bare arrays without a compatibility branch', async () => {
	const { application } = await openAuthenticatedFrontendApplication();
	vi.stubGlobal('fetch', (url, options) =>
		String(url).includes('/favorite-paths?')
			? Promise.resolve(new Response('[]', { headers: { 'Content-Type': 'application/json' } }))
			: application.fetch(url, options),
	);
	await expect(filesystemCatalogApi.listFavorites('name')).rejects.toMatchObject({ code: 'protocol_failure' });
});
