import { selectAgentSettingsGroup } from '../../support/agent';
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
	const input = section.getByRole('spinbutton', { name: 'Concurrent Runs', exact: true });
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
		await expect(section.getByRole('alert')).toContainText('Invalid settings.');
		expect(writes).toBe(0);
	}
	// The execution switch is a complete versioned setting, not the removed feature toggle.
	await input.fill(String(original));
	const toggle = page.getByRole('button', {
		name: initial.settings.enabled ? 'Disable Agent' : 'Enable Agent',
		exact: true,
	});
	await toggle.click();
	await expect(section.getByRole('status')).toHaveText('Settings saved.');
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
	expect(persisted.settings.profiles).toEqual(initial.settings.profiles);

	for (const value of [0, 65, 1.5]) {
		const rejected = await context.request.put('/api/v1/agent/execution-settings', {
			headers: { Origin: E2E_URLS.frontendOrigin },
			data: {
				expectedVersion: persisted.settings.version,
				enabled: persisted.settings.enabled,
				limits: Object.assign({}, persisted.settings.limits, { maxConcurrentWorkspaceJobs: value }),
				profiles: persisted.settings.profiles,
			},
		});
		expect(rejected.status()).toBe(400);
		await expect(rejected.json()).resolves.toEqual({ code: 'invalid_input' });
	}
	await page.reload();
	await selectAgentSettingsGroup(page, 'runtime');
	await expect(input).toHaveValue(String(original));
	await expect(
		page.getByRole('button', { name: initial.settings.enabled ? 'Enable Agent' : 'Disable Agent', exact: true }),
	).toBeEnabled();
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
