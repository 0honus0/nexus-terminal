import { randomUUID } from 'node:crypto';
import { configureTestPluginRepository, installTestPlugin, stageTestPlugin } from '../../../support/plugins';
import { requestAgentJson } from '../../../support/agent-request';
import { selectAgentExtensionsSection, enableTestAgentExecution } from '../../../support/agent';
import { readAgentAppListResponse } from '../../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentPluginItems,
	readAgentPluginInstallationList,
	readAgentPluginStageView,
	readAgentPluginInstallation,
	readAgentPluginDataView,
	readAgentPluginDataPurgeView,
} from '../../../../../packages/shared/src/agent/plugins/http-codec';
import { readAgentPluginRepositorySettings } from '../../../../../packages/shared/src/agent/plugins/repository-http-codec';
import { agentRecord, readAgentErrorResponse } from '../../../../../packages/shared/src/agent/http-codec';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../../support/auth';
import { enablePluginApp, repositoryUrl } from './fixtures';
import { expectReadableCatalogText } from '../../../support/catalog-colors';

test.use({ actionTimeout: 10_000 });

test('unsafe remote plugin archive fails validation without terminating the Backend', async ({ request }) => {
	await loginAsInitialAdmin(request);
	await configureTestPluginRepository(request);
	// Trust the controlled publisher first, so rejection actually reaches archive inspection.
	await stageTestPlugin(request, 'nexus.custom-surface');
	const before = await requestAgentJson(request, { method: 'GET', path: '/plugins/stages' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginStageView),
	);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/remote/stage',
			status: 400,
			data: { repositoryUrl, appId: 'nexus.unsafe', version: '1.0.0' },
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'invalid_input' }),
	);
	const after = await requestAgentJson(request, { method: 'GET', path: '/plugins/stages' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginStageView),
	);
	expect(after).toEqual(before);
	await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
});

test('official plugin source cannot be overridden by a configured third-party repository', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	await loginAsInitialAdmin(page.request);
	await setUiLanguage(page.request);
	const empty = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/repositories' },
		readAgentPluginRepositorySettings,
	);
	expect(empty.repositories).toEqual([]);
	const catalog = await configureTestPluginRepository(request);
	expect(catalog.repositoryUrl).toBe(repositoryUrl);
	await requestAgentJson(
		request,
		{
			method: 'GET',
			path: '/plugins/official/catalog?repositoryUrl=' + encodeURIComponent(repositoryUrl),
			status: 400,
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'invalid_input' }),
	);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/official/stage',
			status: 400,
			data: { appId: 'nexus.fullstack', version: '1.0.0', repositoryUrl },
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'invalid_input' }),
	);
	const installations = await requestAgentJson(request, { method: 'GET', path: '/plugins/installations' }, (raw) =>
		readAgentPluginInstallationList(raw),
	);
	expect(installations.items).toEqual([]);
	// Keep this third-party/source-isolation check independent of public GitHub latency.
	// The genuine HTTP checks above still reject attempts to override the official source.
	await page.route('**/api/v1/agent/plugins/official/catalog', (route) => route.abort('failed'));
	const officialRead = page.waitForRequest(
		(candidate) =>
			candidate.method() === 'GET' &&
			new URL(candidate.url()).pathname === '/api/v1/agent/plugins/official/catalog',
	);
	await page.goto('/settings?tab=agent');
	await selectAgentExtensionsSection(page, 'market');
	expect(new URL((await officialRead).url()).search).toBe('');
	const section = page.getByRole('region', { name: 'Plugin management', exact: true });
	await expect(
		section.getByRole('button', { name: 'Copy', exact: true }).filter({ hasText: repositoryUrl }),
	).toBeVisible();
	await expect(section.getByRole('button', { name: 'Read official catalog', exact: true })).toHaveCount(0);
	const localGroup = section
		.locator('[role="button"][aria-expanded]')
		.filter({ has: page.getByRole('button', { name: 'Copy', exact: true }).filter({ hasText: repositoryUrl }) });
	await expectReadableCatalogText(localGroup.locator('.ui-catalog-group-label'));
	await expectReadableCatalogText(localGroup.locator('.ui-catalog-type-badge').first());
	// D16: actual first-party catalog, pinned publisher and signed download require external acceptance.
});

test('uninstalled plugin retained AppStorage can be permanently deleted', async ({ request }) => {
	await loginAsInitialAdmin(request);
	await enableTestAgentExecution(request);
	const installation = await installTestPlugin(request, 'nexus.custom-surface');
	const app = await enablePluginApp(request, installation.appId);
	const path = `/plugins/installations/${app.id}`;
	const stored = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: path + '/data/e2e.retained',
			data: {
				expectedRevision: installation.revision,
				expectedVersion: 0,
				operationId: randomUUID(),
				valueJson: JSON.stringify({ retained: true }),
			},
		},
		readAgentPluginDataView,
	);
	expect(JSON.parse(stored.valueJson!)).toEqual({ retained: true });
	const fetched = await requestAgentJson(request, { method: 'GET', path: path + '/data/e2e.retained' }, (raw) => {
		const row = agentRecord(raw, ['value']);
		return row.value === null ? null : readAgentPluginDataView(row.value);
	});
	expect(fetched).toEqual(stored);
	const removed = await requestAgentJson(
		request,
		{
			method: 'DELETE',
			path,
			data: { expectedRevision: installation.revision },
		},
		readAgentPluginInstallation,
	);
	expect(removed.status).toBe('removed');
	const apps = await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
	expect(apps.some((item) => item.id === app.id)).toBe(false);
	const retained = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/installations' },
		readAgentPluginInstallationList,
	);
	expect(retained.items).toContainEqual(removed);
	expect(retained.retainedAppIds).toContain(app.id);
	const purge = { expectedRevision: removed.revision, operationId: randomUUID() };
	const deleted = await requestAgentJson(
		request,
		{ method: 'POST', path: path + '/delete-data', data: purge },
		readAgentPluginDataPurgeView,
	);
	expect(deleted.deletedKeys).toBe(1);
	expect(deleted.revision).toBe(removed.revision + 1);
	const cleared = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/installations' },
		readAgentPluginInstallationList,
	);
	expect(cleared.retainedAppIds).not.toContain(app.id);
	const replay = await requestAgentJson(
		request,
		{ method: 'POST', path: path + '/delete-data', data: purge },
		readAgentPluginDataPurgeView,
	);
	expect(replay).toEqual(deleted);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: path + '/delete-data',
			status: 409,
			data: { expectedRevision: removed.revision, operationId: randomUUID() },
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'version_conflict' }),
	);
	const empty = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: path + '/delete-data',
			data: { expectedRevision: deleted.revision, operationId: randomUUID() },
		},
		readAgentPluginDataPurgeView,
	);
	expect(empty.deletedKeys).toBe(0);
});
