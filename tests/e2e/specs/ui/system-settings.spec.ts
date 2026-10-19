import { expect, test } from '../../support/fixtures';
import type { Page, Locator, APIRequestContext } from '@playwright/test';
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';
import { expectUiSelectValue, selectUiOption } from '../../support/ui-select';
import { readPreferencesResponse } from '../../../../packages/shared/src/preferences/presentation/http-codec';
import { readBackendLoggingView } from '../../../../packages/shared/src/operations/http-codec';
import { getTestSettings, updateTestSettings } from '../../support/settings';
import { E2E_URLS } from '../../support/test-env';

const headers = { Origin: E2E_URLS.frontendOrigin };

async function preferences(request: APIRequestContext) {
	const response = await request.get('/api/v1/settings/preferences');
	expect(response.ok()).toBe(true);
	return readPreferencesResponse(await response.json()).preferences;
}

async function saveForm(page: Page, form: Locator, path = '/api/v1/settings/preferences'): Promise<void> {
	const response = page.waitForResponse((value) => value.url().endsWith(path) && value.request().method() === 'PUT');
	await form.locator('button[type="submit"]').click();
	expect((await response).ok()).toBe(true);
	// The section forms deliberately keep Save available; only their active
	// mutation disables the fieldset. Require re-enablement after the 2xx
	// receipt, while callers separately assert the exact persisted API value.
	await expect(form.locator('button[type="submit"]')).toBeEnabled();
}

async function systemTab(page: Page): Promise<void> {
	await page.locator('[role="tab"][aria-controls="settings-panel-system"]:visible').click();
	await expect(page.locator('#settings-panel-system')).toBeVisible();
}

async function workspaceTab(page: Page): Promise<void> {
	await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
	await expect(page.locator('#settings-panel-workspace')).toBeVisible();
}

test('system settings persist timezone and language changes through the UI', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	const original = await preferences(context.request);
	await updateUiPreferences(context.request, (value) => {
		value.language = 'en-US';
		value.timezone = 'UTC';
	});
	try {
		await page.goto('/settings');
		await systemTab(page);
		await expectUiSelectValue(page.locator('#languageSelect'), 'en-US');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
		await captureFunctionalScreenshot(page, 'system-settings.png', { viewport: { width: 1440, height: 900 } });
		await step('save timezone and language through their preference forms', async () => {
			const timezone = page.locator('#timezoneSelect');
			await selectUiOption(timezone, 'Asia/Shanghai');
			await saveForm(page, page.locator('form').filter({ has: timezone }));
			expect((await preferences(context.request)).timezone).toBe('Asia/Shanghai');
			const language = page.locator('#languageSelect');
			await selectUiOption(language, 'zh-CN');
			await saveForm(page, page.locator('form').filter({ has: language }));
			expect((await preferences(context.request)).language).toBe('zh-CN');
			await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
		});
		await page.reload({ waitUntil: 'domcontentloaded' });
		await systemTab(page);
		await expectUiSelectValue(page.locator('#timezoneSelect'), 'Asia/Shanghai');
		await expectUiSelectValue(page.locator('#languageSelect'), 'zh-CN');
		await step('saved server language overrides the browser language on reload', async () => {
			await updateUiPreferences(context.request, (value) => {
				value.language = 'en-US';
			});
			await page.reload({ waitUntil: 'domcontentloaded' });
			await systemTab(page);
			await expectUiSelectValue(page.locator('#languageSelect'), 'en-US');
			await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
		});
	} finally {
		await updateUiPreferences(context.request, (value) => {
			value.language = original.language;
			value.timezone = original.timezone;
		});
	}
});

test('preferences load workspace values from the Shared presentation contract', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	const original = await preferences(context.request);
	await updateUiPreferences(context.request, (value) => {
		value.language = 'en-US';
		value.showPopupFileManager = true;
		value.navBarVisible = true;
		value.showConnectionTags = false;
		value.showQuickCommandTags = false;
	});
	const retiredRequests: string[] = [];
	page.on('request', (request) => {
		if (
			/\/api\/v1\/settings\/(?:nav-bar-visibility|show-connection-tags|show-quick-command-tags|show-status-monitor-ip-address)/.test(
				request.url(),
			)
		)
			retiredRequests.push(request.url());
	});
	try {
		await page.goto('/settings');
		await workspaceTab(page);
		await expect(page.locator('#showPopupFileManager')).toBeChecked();
		await expect(page.locator('#showConnectionTags')).not.toBeChecked();
		await expect(page.locator('#showQuickCommandTags')).not.toBeChecked();
		expect(retiredRequests).toEqual([]);
	} finally {
		await updateUiPreferences(context.request, (value) => {
			value.language = original.language;
			value.showPopupFileManager = original.showPopupFileManager;
			value.navBarVisible = original.navBarVisible;
			value.showConnectionTags = original.showConnectionTags;
			value.showQuickCommandTags = original.showQuickCommandTags;
		});
	}
});

test('preferences load failure fences writes until an explicit successful refresh', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await updateUiPreferences(context.request, (value) => {
		value.language = 'en-US';
	});
	let writes = 0;
	page.on('request', (request) => {
		if (request.url().endsWith('/api/v1/settings/preferences') && request.method() === 'PUT') writes += 1;
	});
	await page.route('**/api/v1/settings/preferences', async (route) => {
		if (route.request().method() === 'GET') await route.abort('failed');
		else await route.continue();
	});
	await page.goto('/settings');
	await workspaceTab(page);
	const panel = page.locator('#settings-panel-workspace');
	await expect(
		panel.getByText(
			'The result is unknown. Read the list again and verify before editing or repeating the action.',
			{ exact: true },
		),
	).toBeVisible();
	await expect(page.locator('#showPopupFileManager')).toBeDisabled();
	expect(writes).toBe(0);
	await page.unroute('**/api/v1/settings/preferences');
	await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
	await expect(page.locator('#showPopupFileManager')).toBeEnabled();
	expect(writes).toBe(0);
});

test('dashboard toggles are personal preferences while monitoring changes require restart', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	const original = await preferences(context.request);
	const core = await getTestSettings(context.request);
	await updateUiPreferences(context.request, (value) => {
		value.language = 'en-US';
		value.dashboardShowLocalResources = true;
		value.dashboardShowRemoteResources = true;
	});
	try {
		await page.goto('/settings');
		await workspaceTab(page);
		const local = page.getByRole('checkbox', { name: 'Show local resources', exact: true });
		const remote = page.getByRole('checkbox', { name: 'Show remote resources', exact: true });
		const resourceForm = page.locator('form').filter({ has: local });
		await expect(local).toBeChecked();
		await expect(remote).toBeChecked();
		await step('save monitoring policy without claiming it is already effective', async () => {
			const monitoring = page.locator('[data-monitoring-configuration]');
			const hostInterval = core.policy.remoteHostRefreshIntervalSeconds === 17 ? 18 : 17;
			await monitoring.locator('[data-monitoring-host]').fill(String(hostInterval));
			const savedResponse = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
			);
			await monitoring.locator('[data-monitoring-save]').click();
			expect((await savedResponse).ok()).toBe(true);
			await expect(monitoring.locator('[data-monitoring-feedback]')).toContainText('Saved');
			const saved = await getTestSettings(context.request);
			expect(saved.policy.remoteHostRefreshIntervalSeconds).toBe(hostInterval);
			expect(saved.policy.statusMonitorIntervalSeconds).toBe(core.policy.statusMonitorIntervalSeconds);
			expect(saved.effectiveMonitoring).toEqual(core.effectiveMonitoring);
			expect(saved.requiresRestart).toBe(true);
			const invalid = await context.request.put('/api/v1/settings', {
				headers,
				data: {
					expectedVersion: saved.version,
					policy: { ...saved.policy, remoteHostRefreshIntervalSeconds: 0 },
					captcha: {
						enabled: saved.captcha.enabled,
						provider: saved.captcha.provider,
						siteKey: saved.captcha.siteKey,
						expectedHostname: saved.captcha.expectedHostname,
						secret: { action: 'keep' },
					},
				},
			});
			expect(invalid.status()).toBe(400);
			expect((await getTestSettings(context.request)).version).toBe(saved.version);
		});
		await step('disable only local resources then persist local-only resources', async () => {
			await local.uncheck();
			await saveForm(page, resourceForm);
			expect(await preferences(context.request)).toMatchObject({
				dashboardShowLocalResources: false,
				dashboardShowRemoteResources: true,
			});
			await local.check();
			await remote.uncheck();
			await saveForm(page, resourceForm);
			await page.reload({ waitUntil: 'domcontentloaded' });
			await workspaceTab(page);
			await expect(local).toBeChecked();
			await expect(remote).not.toBeChecked();
		});
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'SSH resources', exact: true })).not.toBeVisible();
	} finally {
		const failures: unknown[] = [];
		try {
			await updateUiPreferences(context.request, (value) => {
				value.language = original.language;
				value.dashboardShowLocalResources = original.dashboardShowLocalResources;
				value.dashboardShowRemoteResources = original.dashboardShowRemoteResources;
			});
		} catch (cause) {
			failures.push(cause);
		}
		try {
			await updateTestSettings(context.request, (value) => {
				value.policy.remoteHostRefreshIntervalSeconds = core.policy.remoteHostRefreshIntervalSeconds;
				value.policy.statusMonitorIntervalSeconds = core.policy.statusMonitorIntervalSeconds;
			});
		} catch (cause) {
			failures.push(cause);
		}
		if (failures.length) throw new AggregateError(failures, 'Settings restoration failed');
	}
});

test('workspace popup editor setting is the only editor and preview close control', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	const original = await preferences(context.request);
	expect(original).not.toHaveProperty('clearFileEditorTabsOnClose');
	await updateUiPreferences(context.request, (value) => {
		value.language = 'en-US';
		value.showPopupFileEditor = true;
	});
	try {
		await page.goto('/settings');
		await workspaceTab(page);
		const toggle = page.locator('#showPopupFileEditor');
		const form = page.locator('form').filter({ has: toggle });
		await expect(toggle).toBeChecked();
		await expect(toggle.locator('xpath=ancestor::label')).toContainText('Show popup editor when opening files');
		await toggle.uncheck();
		await saveForm(page, form);
		expect((await preferences(context.request)).showPopupFileEditor).toBe(false);
		await toggle.check();
		await saveForm(page, form);
		expect((await preferences(context.request)).showPopupFileEditor).toBe(true);
	} finally {
		await updateUiPreferences(context.request, (value) => {
			value.language = original.language;
			value.showPopupFileEditor = original.showPopupFileEditor;
		});
	}
});

test('frontend preferences and backend logging persist independently through the UI', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	const original = await preferences(context.request);
	const loggingResponse = await context.request.get('/api/v1/settings/logging');
	expect(loggingResponse.ok()).toBe(true);
	const logging = readBackendLoggingView(await loggingResponse.json());
	await updateUiPreferences(context.request, (value) => {
		value.language = 'en-US';
		value.frontendLogLevel = 'info';
	});
	try {
		await page.goto('/settings');
		await systemTab(page);
		const frontend = page.locator('#frontendLogLevelSelect');
		const backend = page.locator('#backendLogLevelSelect');
		const targetLevel = logging.level === 'debug' ? 'info' : 'debug';
		await expectUiSelectValue(frontend, 'info');
		await expectUiSelectValue(backend, logging.level);
		await selectUiOption(frontend, 'debug');
		await saveForm(page, page.locator('form').filter({ has: frontend }));
		expect((await preferences(context.request)).frontendLogLevel).toBe('debug');
		await selectUiOption(backend, targetLevel);
		const savedResponse = page.waitForResponse(
			(response) => response.url().endsWith('/api/v1/settings/logging') && response.request().method() === 'PUT',
		);
		await page.locator('[data-backend-logging] button[type="submit"]').click();
		const saved = readBackendLoggingView(await (await savedResponse).json());
		expect(saved.version).toBe(logging.version + 1);
		expect(saved.level).toBe(targetLevel);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await systemTab(page);
		await expectUiSelectValue(frontend, 'debug');
		await expectUiSelectValue(backend, targetLevel);
		const invalid = await context.request.put('/api/v1/settings/logging', {
			headers,
			data: { expectedVersion: saved.version, level: 'verbose' },
		});
		expect(invalid.status()).toBe(400);
	} finally {
		const failures: unknown[] = [];
		try {
			await updateUiPreferences(context.request, (value) => {
				value.language = original.language;
				value.frontendLogLevel = original.frontendLogLevel;
			});
		} catch (cause) {
			failures.push(cause);
		}
		try {
			const currentResponse = await context.request.get('/api/v1/settings/logging');
			expect(currentResponse.ok()).toBe(true);
			const current = readBackendLoggingView(await currentResponse.json());
			const restored = await context.request.put('/api/v1/settings/logging', {
				headers,
				data: { expectedVersion: current.version, level: logging.level },
			});
			expect(restored.ok()).toBe(true);
			expect(readBackendLoggingView(await restored.json()).level).toBe(logging.level);
		} catch (cause) {
			failures.push(cause);
		}
		if (failures.length) throw new AggregateError(failures, 'Logging settings restoration failed');
	}
});
