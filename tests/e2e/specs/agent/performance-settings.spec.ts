import { selectAgentSettingsGroup } from '../../support/agent';
import { dismissToasts } from '../../support/feedback';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { requestAgentJson } from '../../support/agent';
import { E2E_URLS } from '../../support/test-env';
import { readAgentExecutionSettingsResponse } from '../../../../packages/shared/src/agent/execution/http-codec';

test('execution settings validate before dispatch, save the original CAS and reject retired capacity fields', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const initial = await requestAgentJson(
		context.request,
		{
			method: 'GET',
			path: '/execution-settings',
		},
		readAgentExecutionSettingsResponse,
	);
	await page.goto('/settings?tab=agent');
	await selectAgentSettingsGroup(page, 'runtime');
	const section = page.getByRole('region', { name: 'Execution and performance', exact: true });
	const input = section.getByRole('textbox', { name: 'Concurrent Runs', exact: true });
	const save = section.getByRole('button', { name: 'Save', exact: true });
	const original = initial.settings.limits.maxConcurrentRuns;
	await expect(input).toHaveValue(String(original));
	let writes = 0;
	page.on('request', (request) => {
		if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/agent/execution-settings')
			writes++;
	});
	for (const value of ['0', String(initial.settings.hardLimits.maxConcurrentRuns + 1), '1.5']) {
		await input.fill(value);
		await save.click();
		await expect(
			page.locator('.ui-notification[data-kind="error"]').filter({ hasText: 'Invalid settings.' }),
		).toBeVisible();
		expect(writes).toBe(0);
		await dismissToasts(page);
	}
	// The master switch is a complete versioned setting; it must not disappear on read failure.
	await input.fill(String(original));
	const toggle = page.getByRole('switch', { name: 'Agent feature', exact: true });
	await expect(toggle).toBeChecked({ checked: initial.settings.enabled });
	await toggle.click();
	await expect(
		page.locator('.ui-notification[data-kind="success"]').filter({ hasText: 'Settings saved.' }),
	).toBeVisible();
	expect(writes).toBe(1);
	const persisted = await requestAgentJson(
		context.request,
		{
			method: 'GET',
			path: '/execution-settings',
		},
		readAgentExecutionSettingsResponse,
	);
	expect(persisted.settings.version).toBe(initial.settings.version + 1);
	expect(persisted.settings.enabled).toBe(!initial.settings.enabled);
	expect(persisted.settings.limits).toEqual(initial.settings.limits);
	expect(persisted.settings).not.toHaveProperty('profiles');

	for (const value of [0, 65, 1.5]) {
		const rejected = await context.request.put('/api/v1/agent/execution-settings', {
			headers: { Origin: E2E_URLS.frontendOrigin },
			data: {
				expectedVersion: persisted.settings.version,
				enabled: persisted.settings.enabled,
				limits: Object.assign({}, persisted.settings.limits, { maxConcurrentWorkspaceJobs: value }),
			},
		});
		expect(rejected.status()).toBe(400);
		await expect(rejected.json()).resolves.toEqual({ code: 'invalid_input' });
	}
	await page.reload();
	await selectAgentSettingsGroup(page, 'runtime');
	await expect(input).toHaveValue(String(original));
	await expect(toggle).toBeEnabled();
	await expect(toggle).toBeChecked({ checked: persisted.settings.enabled });
	const unchanged = await requestAgentJson(
		context.request,
		{
			method: 'GET',
			path: '/execution-settings',
		},
		readAgentExecutionSettingsResponse,
	);
	expect(unchanged).toEqual(persisted);
});

test('Agent feature master switch remains visible when execution settings cannot be read', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.route('**/api/v1/agent/execution-settings', (route) =>
		route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({ code: 'storage_unavailable' }),
		}),
	);
	await page.goto('/settings?tab=agent');
	const toggle = page.getByRole('switch', { name: 'Agent feature', exact: true });
	await expect(toggle).toBeVisible();
	await expect(toggle).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Reload settings', exact: true })).toBeVisible();
});

test('Recall byte quantities distinguish range errors from invalid syntax', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/settings?tab=agent');
	await selectAgentSettingsGroup(page, 'models');
	const budget = page.getByRole('region', { name: 'Budget and context', exact: true });
	const recall = budget.getByRole('textbox', { name: 'Recall total (bytes)', exact: true }).first();
	const original = await recall.inputValue();

	await recall.fill('1G');
	await expect(budget.getByText('Out of range; maximum 32K', { exact: true })).toBeVisible();
	await expect(
		budget.getByText('Invalid format; use a number with an optional unit', { exact: true }),
	).not.toBeVisible();

	await recall.fill('not-a-size');
	await expect(budget.getByText('Invalid format; use a number with an optional unit', { exact: true })).toBeVisible();

	await recall.fill(original);
});
