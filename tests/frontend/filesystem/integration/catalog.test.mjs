import { test, expect as verify } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';

test('personal catalog persists actual CAS, touch, removal and complete paginated history', async () => {
	await openAuthenticatedFrontendApplication();
	const { filesystemCatalogApi } =
		await import('../../../../packages/frontend/src/features/filesystem/api/filesystem-catalog-api.ts');
	const { useFilesystemCatalogStore } =
		await import('../../../../packages/frontend/src/features/filesystem/composables/useFilesystemCatalog.ts');
	const { PreferenceRequestFailure } =
		await import('../../../../packages/frontend/src/client/preferences/preference-request.ts');
	const results = [];

	const expect = (condition, name) => {
		if (!condition) throw Error(name);
		results.push(name);
	};

	const catalog = useFilesystemCatalogStore();
	const favorite = await catalog.saveFavorite({ path: '/catalog-original', name: 'Original' });
	const updated = await catalog.saveFavorite({
		id: favorite.id,
		expectedVersion: favorite.version,
		path: '/catalog-updated',
		name: 'Updated',
	});
	expect(
		updated.version === favorite.version + 1 && updated.path === '/catalog-updated',
		'real favorite create/update uses Shared response and original CAS',
	);
	let conflict;
	try {
		await catalog.saveFavorite({
			id: favorite.id,
			expectedVersion: favorite.version,
			path: '/stale-overwrite',
			name: null,
		});
	} catch (cause) {
		conflict = cause;
	}
	expect(
		conflict instanceof PreferenceRequestFailure && conflict.code === 'version_conflict',
		'stale favorite editing is rejected rather than upgraded to the latest version',
	);
	await catalog.loadFavorites(true);
	expect(
		catalog.favorites.find((item) => item.id === favorite.id)?.path === '/catalog-updated',
		'explicit favorite recovery reads actual saved content',
	);
	await catalog.useFavorite(updated);
	await catalog.loadFavorites(true);
	const touched = catalog.favorites.find((item) => item.id === favorite.id);
	expect(
		touched?.version === updated.version + 1 && touched.lastUsedAt !== null,
		'favorite touch consumes versioned Shared mutation',
	);
	await catalog.removeFavorite(touched);
	expect(
		!catalog.favorites.some((item) => item.id === favorite.id),
		'favorite delete consumes original version and deleted receipt',
	);
	for (let index = 0; index < 102; index++) await filesystemCatalogApi.addHistory('/catalog-page-' + index);
	await catalog.loadHistory(true);
	expect(
		catalog.history.length >= 102 && catalog.history.some((item) => item.path === '/catalog-page-0'),
		'path history follows actual Shared pagination beyond one hundred entries',
	);
	await catalog.removeHistory(catalog.history[0].id);
	await catalog.clearHistory();
	expect(catalog.history.length === 0, 'path history delete and clear consume actual finite receipts');

	verify(results).toHaveLength(7);
});
