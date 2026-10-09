import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';

test('Agent execution concurrency validates, saves and rejects retired Workspace capacity settings', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/settings?tab=agent');
	const panel = page.locator('#settings-panel-agent');
	await panel.getByRole('button', { name: 'Execution & Integrations', exact: true }).click();
	const section = panel
		.getByRole('heading', { name: 'Execution and performance', exact: true })
		.locator('xpath=ancestor::section[1]');
	const input = section.getByRole('spinbutton', { name: 'Agent execution concurrency' });
	const save = section.getByRole('button', { name: 'Save', exact: true });
	const before = (await (await context.request.get('/api/v1/agent/settings')).json()).data;
	const hard = before.hardLimits.maxConcurrentRuntimes;
	const initial = before.requestedSettings.performance.maxConcurrentRuntimes;
	const desired = initial === 2 ? 1 : 2;
	expect(hard).toBeGreaterThanOrEqual(desired);
	await expect(input).toHaveValue(String(initial));
	for (const value of ['0', String(hard + 1), '1.5']) {
		await input.fill(value);
		await expect(save).toBeDisabled();
	}
	await input.fill(String(desired));
	await expect(save).toBeEnabled();
	await save.click();
	await expect(section.getByText('Current concurrency settings are in effect', { exact: true })).toBeVisible();

	const persisted = await context.request.get('/api/v1/agent/settings');
	expect(persisted.ok()).toBeTruthy();
	const settings = (await persisted.json()).data;
	expect(settings.requestedSettings.performance.maxConcurrentRuntimes).toBe(desired);
	expect(settings.effectiveSettings.performance.maxConcurrentRuntimes).toBe(desired);
	expect(settings.requestedSettings.performance).not.toHaveProperty('maxConcurrentWorkspaceJobs');

	const csrf = (await (await context.request.get('/api/v1/agent/security/csrf')).json()).data.token;
	for (const value of [0, 65, 1.5]) {
		const rejected = await context.request.patch('/api/v1/agent/settings', {
			headers: { 'X-Nexus-CSRF': csrf },
			data: { expectedVersion: settings.revision, patch: { performance: { maxConcurrentWorkspaceJobs: value } } },
		});
		expect(rejected.status()).toBe(400);
	}
	await page.reload();
	await panel.getByRole('button', { name: 'Execution & Integrations', exact: true }).click();
	await expect(input).toHaveValue(String(desired));
	const unchanged = (await (await context.request.get('/api/v1/agent/settings')).json()).data;
	expect(unchanged.revision).toBe(settings.revision);
});
