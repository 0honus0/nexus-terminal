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
import { enablePluginApp, repositoryUrl } from '../../../support/agent-host/plugin-fixture';
import { expectReadableCatalogText } from '../../../support/catalog-colors';

test.use({ e2eServices: ['plugins', 'provider'] });

test.use({ actionTimeout: 10_000 });

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
			data: {
				packageId: 'nexus.fullstack',
				publisherKeyId: catalog.packages.find((entry) => entry.packageId === 'nexus.fullstack')?.publisherKeyId,
				version: '1.0.0',
				repositoryUrl,
			},
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

for (const [locale, width, groupLabel, marketLabel, name, description] of [
	[
		'en-US',
		1440,
		'Apps and extensions',
		'Plugin market',
		'Custom Surface',
		'Localized marketplace acceptance fixture.',
	],
	['zh-CN', 320, 'App 与扩展', '插件市场', '自定义界面', '插件市场本地化验收说明。'],
	['ja-JP', 390, 'App と拡張', 'プラグインマーケット', 'カスタム画面', 'プラグイン市場の翻訳検証。'],
] as const) {
	test(`plugin market follows ${locale} and fits ${width}px`, async ({ page, request }) => {
		await loginAsInitialAdmin(request);
		await loginAsInitialAdmin(page.request);
		await setUiLanguage(page.request, locale);
		await configureTestPluginRepository(request);
		await page.route('**/api/v1/agent/plugins/official/catalog', (route) =>
			route.fulfill({
				json: {
					schemaVersion: 2,
					repositoryUrl: 'https://github.com/0honus0/nexus-agent-plugins',
					publishers: [],
					packages: [],
				},
			}),
		);
		await page.setViewportSize({ width, height: 900 });
		await page.goto('/settings?tab=agent');
		await page.getByRole('button', { name: groupLabel, exact: true }).click();
		await page.getByRole('tab', { name: marketLabel, exact: true }).click();
		const market = page.locator('.plugin-market');
		await expect(market.getByText(name, { exact: true })).toBeVisible();
		await expect(market.getByText(description, { exact: true })).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					document: document.documentElement.scrollWidth <= innerWidth,
					tabs: [...document.querySelectorAll('.extensions-tabs button')].every(
						(tab) => tab.scrollWidth <= tab.clientWidth + 1,
					),
					entries: [...document.querySelectorAll('.plugin-market__entry')].every(
						(entry) => entry.scrollWidth <= entry.clientWidth + 1,
					),
				})),
			)
			.toEqual({ document: true, tabs: true, entries: true });
		await market.getByRole('searchbox').fill(description);
		await expect(market.locator('.plugin-market__entry')).toHaveCount(1);
		await expect(market.getByText(name, { exact: true })).toBeVisible();
		await market.getByRole('searchbox').fill('E2E-only AppIntent receiver fixture.');
		await expect(market.locator('.plugin-market__entry')).toHaveCount(1);
		await expect(market.getByText('E2E-only AppIntent receiver fixture.', { exact: true })).toBeVisible();
	});
}
