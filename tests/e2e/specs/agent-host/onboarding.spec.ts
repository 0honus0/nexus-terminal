import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { requestAgentJson } from '../../support/agent-request';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import { configureTestPluginRepository, stageTestPlugin, testPluginRepositoryUrl } from '../../support/plugins';
import { readAgentAppListResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentExecutionSettingsResponse } from '../../../../packages/shared/src/agent/execution/http-codec';

test.use({ e2eServices: ['plugins'] });

test('first enable requires installation confirmation and cancellation or confirmed failure keeps Agent off', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	expect(await requestAgentJson(context.request, { method: 'GET', path: '/apps' }, readAgentAppListResponse)).toEqual(
		[],
	);
	const created = await context.request.post(E2E_URLS.pluginRepositoryOrigin + '/native-package', {
		data: { name: 'Required onboarding App', settingsKind: 'none', requiredOnEnable: true },
	});
	expect(created.status()).toBe(201);
	const { packageId } = await created.json();
	const catalog = await configureTestPluginRepository(context.request);
	const entry = catalog.packages.find((item) => item.packageId === packageId && item.compatible);
	expect(entry).toBeDefined();
	await stageTestPlugin(context.request, packageId);
	// Prepare actual signed bytes; only the later installation is rejected by the fixture.
	await page.route('**/api/v1/agent/onboarding/prepare', async (route) => {
		const response = await context.request.post('/api/v1/agent/plugins/remote/prepare', {
			headers: { Origin: E2E_URLS.frontendOrigin },
			data: {
				packageId,
				publisherKeyId: entry!.publisherKeyId,
				version: entry!.version,
				repositoryUrl: testPluginRepositoryUrl,
			},
		});
		expect(response.status()).toBe(200);
		await route.fulfill({
			json: { packages: [{ kind: 'plan', plan: await response.json() }], bindings: [], ready: false },
		});
	});
	const writes: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (
			request.method() !== 'GET' &&
			(path.endsWith('/execution-settings') || path.endsWith('/onboarding/install'))
		)
			writes.push(path);
	});
	await page.goto('/settings?tab=agent');
	const toggle = page.getByRole('switch', { name: 'Agent feature', exact: true });
	const modal = page.getByRole('dialog', { name: 'Enable Agent', exact: true });
	await expect(toggle).toBeEnabled();
	await expect(toggle).not.toBeChecked();
	await toggle.click();
	await expect(modal).toBeVisible();
	await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(modal).toBeHidden();
	await expect(toggle).not.toBeChecked();
	expect(writes).toEqual([]);
	await page.route('**/api/v1/agent/onboarding/install', (route) =>
		route.fulfill({ status: 400, json: { code: 'invalid_input' } }),
	);
	await toggle.click();
	await expect(modal).toBeVisible();
	const rejected = page.waitForResponse(
		(response) => response.url().endsWith('/onboarding/install') && response.status() === 400,
	);
	await modal.getByRole('button', { name: 'Install & enable', exact: true }).click();
	await rejected;
	await expect(modal.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
	await expect(toggle).not.toBeChecked();
	expect(writes).toEqual(['/api/v1/agent/onboarding/install']);
	expect(await requestAgentJson(context.request, { method: 'GET', path: '/apps' }, readAgentAppListResponse)).toEqual(
		[],
	);
	const settings = await requestAgentJson(
		context.request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	expect(settings.settings.enabled).toBe(false);
});

test('unavailable required-plugin plan does not install or enable Agent', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.route('**/api/v1/agent/onboarding/prepare', (route) =>
		route.fulfill({ status: 503, json: { code: 'provider_unavailable' } }),
	);
	const writes: string[] = [];
	page.on('request', (request) => {
		if (
			request.method() !== 'GET' &&
			(request.url().endsWith('/execution-settings') || request.url().endsWith('/onboarding/install'))
		)
			writes.push(request.url());
	});
	await page.goto('/settings?tab=agent');
	const toggle = page.getByRole('switch', { name: 'Agent feature', exact: true });
	await expect(toggle).toBeEnabled();
	const failed = page.waitForResponse(
		(response) => response.url().endsWith('/onboarding/prepare') && response.status() === 503,
	);
	await toggle.click();
	await failed;
	await expect(toggle).toBeEnabled();
	await expect(toggle).not.toBeChecked();
	await expect(page.getByRole('dialog', { name: 'Enable Agent', exact: true })).toHaveCount(0);
	expect(writes).toEqual([]);
	expect(await requestAgentJson(context.request, { method: 'GET', path: '/apps' }, readAgentAppListResponse)).toEqual(
		[],
	);
});
