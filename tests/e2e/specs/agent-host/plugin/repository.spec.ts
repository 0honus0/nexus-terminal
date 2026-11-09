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
import { selectUiOption } from '../../../support/ui-select';
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
	await section.getByRole('button', { name: 'Manage repositories', exact: true }).click();
	const repositoryDialog = page.getByRole('dialog', { name: 'Manage repositories', exact: true });
	const copySource = repositoryDialog.getByRole('button', { name: 'Third-party repository · Copy', exact: true });
	await expect(copySource).toBeVisible();
	await expect(copySource).toHaveAttribute('title', repositoryUrl);
	await expect(section.getByRole('button', { name: 'Read official catalog', exact: true })).toHaveCount(0);
	const localGroup = repositoryDialog
		.locator('.plugin-market__source')
		.filter({ has: page.getByTitle(repositoryUrl, { exact: true }) });
	await expectReadableCatalogText(localGroup.locator('.ui-catalog-group-label'));
	await expectReadableCatalogText(localGroup.locator('.ui-catalog-type-badge').first());
	await expect(localGroup.locator('.ui-catalog-group-label')).toHaveText(new URL(repositoryUrl).host);
	await expect(localGroup.locator('.fa-server')).toBeVisible();
	await copySource.click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(repositoryUrl);
	await expect(localGroup.getByRole('button', { name: /^Remove · / })).toBeVisible();
	const unavailableUrl = new URL('/missing-repository.json', repositoryUrl).href;
	const addForm = repositoryDialog.getByRole('form', { name: 'Add repository', exact: true });
	await addForm.getByRole('textbox').fill(unavailableUrl);
	const unavailableRead = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent/plugins/remote/catalog' &&
			new URL(response.url()).searchParams.get('repositoryUrl') === unavailableUrl,
	);
	await addForm.getByRole('button', { name: 'Add repository', exact: true }).click();
	await expect(addForm.getByRole('textbox')).toHaveValue('');
	expect((await unavailableRead).ok()).toBe(false);
	await expect(section.getByText(unavailableUrl, { exact: false })).toBeVisible();
	const unavailableGroup = repositoryDialog
		.locator('.plugin-market__source')
		.filter({ has: page.getByTitle(unavailableUrl, { exact: true }) });
	await expect(unavailableGroup).toBeVisible();
	await unavailableGroup.getByRole('button', { name: /^Remove · / }).click();
	await expect(unavailableGroup).toHaveCount(0);
	await expect(localGroup).toBeVisible();
	const saved = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/repositories' },
		readAgentPluginRepositorySettings,
	);
	expect(saved.repositories).toEqual([{ url: repositoryUrl }]);
	await repositoryDialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(repositoryDialog).toHaveCount(0);
	await section.getByRole('button', { name: /^Trusted publishers/ }).click();
	await expect(section.getByRole('textbox', { name: 'Publisher label', exact: true })).toHaveCount(0);
	const addPublisher = section.getByRole('button', { name: 'Add publisher', exact: true });
	await addPublisher.click();
	const publisherDialog = page.getByRole('dialog', { name: 'Add publisher', exact: true });
	await expect(publisherDialog).toBeVisible();
	await expect(publisherDialog.getByRole('button', { name: 'Trust publisher', exact: true })).toBeDisabled();
	await publisherDialog.getByRole('textbox', { name: 'Publisher label', exact: true }).fill('Cancelled publisher');
	await publisherDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(publisherDialog).toHaveCount(0);
	await expect(addPublisher).toBeFocused();
	await addPublisher.click();
	await expect(publisherDialog.getByRole('textbox', { name: 'Publisher label', exact: true })).toHaveValue('');
	await page.keyboard.press('Escape');
	await expect(publisherDialog).toHaveCount(0);
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
		const tabWidths = await page.locator('.extensions-tabs').evaluate((navigation) => {
			const tabs = [...navigation.querySelectorAll('button')].map((tab) => tab.getBoundingClientRect());
			return {
				count: tabs.length,
				spread: Math.max(...tabs.map((tab) => tab.width)) - Math.min(...tabs.map((tab) => tab.width)),
				unused: Math.abs(
					navigation.getBoundingClientRect().width - tabs.reduce((sum, tab) => sum + tab.width, 0),
				),
			};
		});
		expect(tabWidths.count).toBe(3);
		expect(tabWidths.spread).toBeLessThanOrEqual(1);
		expect(tabWidths.unused).toBeLessThanOrEqual(1);
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

test('same package is merged across sources and version selection preserves the exact repository', async ({
	page,
	request,
}) => {
	await loginAsInitialAdmin(request);
	await loginAsInitialAdmin(page.request);
	await setUiLanguage(page.request);
	const catalog = await configureTestPluginRepository(request);
	const entry = catalog.packages.find((item) => item.packageId === 'nexus.custom-surface');
	if (!entry) throw new Error('Missing controlled catalog entry');
	const officialUrl = 'https://github.com/0honus0/nexus-agent-plugins/releases/latest/download/catalog.json';
	await page.route('**/api/v1/agent/plugins/official/catalog', (route) =>
		route.fulfill({ json: { ...catalog, repositoryUrl: officialUrl, packages: [entry] } }),
	);
	await page.goto('/settings?tab=agent');
	await selectAgentExtensionsSection(page, 'market');
	const market = page.locator('.plugin-market');
	const card = market
		.locator('.plugin-market__entry')
		.filter({ has: page.getByText(entry.packageId, { exact: true }) });
	await expect(card).toHaveCount(1);
	const selector = card.getByRole('combobox', { name: 'Choose a version', exact: true });
	const officialKey = JSON.stringify([null, entry.publisherKeyId, entry.packageId, entry.version, entry.sha256]);
	const remoteKey = JSON.stringify([
		repositoryUrl,
		entry.publisherKeyId,
		entry.packageId,
		entry.version,
		entry.sha256,
	]);
	await expect(selector).toHaveAttribute('data-value', officialKey);
	await selector.click();
	await expect(page.getByRole('option', { name: /Official repository/ })).toBeVisible();
	await expect(page.getByRole('option', { name: /Third-party repository/ })).toBeVisible();
	await page.getByRole('option', { name: /Third-party repository/ }).click();
	await expect(selector).toHaveAttribute('data-value', remoteKey);
	await expect(card).toHaveCount(1);
	await market.getByRole('searchbox').fill(new URL(repositoryUrl).host);
	await expect(card).toBeVisible();
	await selectUiOption(selector, officialKey);
	await expect(selector).toHaveAttribute('data-value', officialKey);
	await expect(card).toHaveCount(1);
});
