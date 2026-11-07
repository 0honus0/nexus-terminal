import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { requestAgentJson } from '../../support/agent-request';
import { E2E_URLS } from '../../support/test-env';
import { configureTestPluginRepository, stageTestPlugin, testPluginRepositoryUrl } from '../../support/plugins';
import { readAgentAppListResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentExecutionSettingsResponse } from '../../../../packages/shared/src/agent/execution/http-codec';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

test('official recommendation validates the pinned catalog and explicit offline outcomes through real HTTP', async () => {
	test.setTimeout(120_000);
	const result = await promisify(execFile)(
		process.execPath,
		[
			'--test',
			'--test-name-pattern=B10 official pinned catalog',
			path.resolve(__dirname, '../../../backend/http/backend-next-plugin-repositories.integration.mjs'),
		],
		{ timeout: 90_000, maxBuffer: 1024 * 1024 },
	);
	expect(result.stdout).toContain('uninstalled recommendation reports provider unavailable when catalog is offline');
	expect(result.stdout).toContain('installed recommendation is returned offline without fetching or enabling it');
});

test('onboarding initializes the enabled App and full declared grants in the installation transaction', async () => {
	test.setTimeout(120_000);
	const result = await promisify(execFile)(
		process.execPath,
		[
			'--test',
			'--test-name-pattern=B10 onboarding initialization',
			path.resolve(__dirname, '../../../backend/http/backend-next-plugin-repositories.integration.mjs'),
		],
		{ timeout: 90_000, maxBuffer: 1024 * 1024 },
	);
	expect(result.stdout).toContain('full declared grants without restoring revoked grants');
});

test('first enable requires installation confirmation and cancellation or confirmed failure keeps Agent off', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	expect(await requestAgentJson(context.request, { method: 'GET', path: '/apps' }, readAgentAppListResponse)).toEqual(
		[],
	);
	expect(
		(await context.request.post(E2E_URLS.pluginRepositoryOrigin + '/control/official-catalog/enable')).status(),
	).toBe(204);
	const catalog = await configureTestPluginRepository(context.request);
	const entry = catalog.packages.find((item) => item.packageId === 'nexus.agent' && item.compatible);
	expect(entry).toBeDefined();
	// The controlled remote source requires explicit publisher trust, unlike the pinned official source.
	await stageTestPlugin(context.request, 'nexus.agent');
	// Route the official lookup to the controlled signed repository; package preparation remains real.
	await page.route('**/api/v1/agent/plugins/official/prepare', async (route) => {
		const response = await context.request.post('/api/v1/agent/plugins/remote/prepare', {
			headers: { Origin: E2E_URLS.frontendOrigin },
			data: { ...route.request().postDataJSON(), repositoryUrl: testPluginRepositoryUrl },
		});
		expect(response.status()).toBe(200);
		await route.fulfill({ response });
	});
	// Control only the recommendation response; the separate install remains a rejected write.
	await page.route('**/api/v1/agent/onboarding/recommended-plugin', (route) =>
		route.fulfill({ json: { entry, installation: null } }),
	);
	const writes: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (
			request.method() !== 'GET' &&
			(path.endsWith('/execution-settings') || path.endsWith('/recommended-plugin/install'))
		)
			writes.push(path);
	});
	await page.goto('/settings?tab=agent');
	const toggle = page.getByRole('switch', { name: 'Agent feature', exact: true });
	const modal = page.getByRole('dialog', { name: 'Enable Agent with Nexus Agent', exact: true });
	await expect(toggle).toBeEnabled();
	await expect(toggle).not.toBeChecked();
	await toggle.click();
	await expect(modal).toBeVisible();
	await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(modal).toBeHidden();
	await expect(toggle).not.toBeChecked();
	expect(writes).toEqual([]);
	await page.route('**/api/v1/agent/onboarding/recommended-plugin/install', (route) =>
		route.fulfill({ status: 400, json: { code: 'invalid_input' } }),
	);
	await toggle.click();
	await expect(modal).toBeVisible();
	const rejected = page.waitForResponse(
		(response) => response.url().endsWith('/recommended-plugin/install') && response.status() === 400,
	);
	await modal.getByRole('button', { name: 'Install Nexus Agent & enable Agent', exact: true }).click();
	await rejected;
	await expect(modal.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
	await expect(toggle).not.toBeChecked();
	expect(writes).toEqual(['/api/v1/agent/onboarding/recommended-plugin/install']);
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

test('unavailable recommendation does not install or enable Agent', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.route('**/api/v1/agent/onboarding/recommended-plugin', (route) =>
		route.fulfill({ status: 503, json: { code: 'provider_unavailable' } }),
	);
	const writes: string[] = [];
	page.on('request', (request) => {
		if (request.method() !== 'GET' && request.url().includes('/api/v1/agent/')) writes.push(request.url());
	});
	await page.goto('/settings?tab=agent');
	const toggle = page.getByRole('switch', { name: 'Agent feature', exact: true });
	await expect(toggle).toBeEnabled();
	const failed = page.waitForResponse(
		(response) => response.url().endsWith('/recommended-plugin') && response.status() === 503,
	);
	await toggle.click();
	await failed;
	await expect(toggle).toBeEnabled();
	await expect(toggle).not.toBeChecked();
	await expect(page.getByRole('dialog', { name: 'Enable Agent with Nexus Agent', exact: true })).toHaveCount(0);
	expect(writes).toEqual([]);
	expect(await requestAgentJson(context.request, { method: 'GET', path: '/apps' }, readAgentAppListResponse)).toEqual(
		[],
	);
});
