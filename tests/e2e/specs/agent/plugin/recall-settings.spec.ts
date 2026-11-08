import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../../support/auth';
import { installTestPlugin } from '../../../support/plugins';
import { selectAgentExtensionsSection, selectAgentSettingsGroup } from '../../../support/agent';
import { pluginInstance, pluginSettings, pluginInstances } from '../../../support/plugin-settings';
import { selectUiOption } from '../../../support/ui-select';

test('Recall policy is configured only through the signed Agent tool settings and is isolated per instance', async ({
	page,
	request,
}) => {
	await loginAsInitialAdmin(request);
	await loginAsInitialAdmin(page.request);
	await setUiLanguage(page.request);
	const installed = await installTestPlugin(request, 'nexus.agent');
	const original = await pluginInstance(request, installed.appId, 'nexus.tools.agent');
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
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto('/settings?tab=agent');
	await selectAgentExtensionsSection(page, 'market');
	await expect(page.getByRole('tab', { name: 'MCP / ACP', exact: true })).toHaveCount(0);
	const row = page
		.locator('div.border-b')
		.filter({ has: page.getByText('Agent Collaboration and Content Tools', { exact: true }) })
		.filter({ has: page.getByRole('button', { name: 'Settings', exact: true }) });
	await row.getByRole('button', { name: 'Settings', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Plugin settings', exact: true });
	const selector = dialog.getByRole('combobox', { name: 'App using this plugin', exact: true });
	if ((await selector.getAttribute('data-value')) !== installed.appId)
		await selectUiOption(selector, installed.appId);
	const frame = dialog.frameLocator('iframe[title="Plugin settings"]');
	await expect(frame.getByRole('spinbutton', { name: 'Memory recall items', exact: true })).toHaveValue('5');
	await expect(frame.getByRole('spinbutton', { name: 'Memory recall total bytes', exact: true })).toHaveValue('8192');
	await frame.getByRole('spinbutton', { name: 'Memory recall items', exact: true }).fill('800');
	await frame.getByRole('spinbutton', { name: 'Memory recall total bytes', exact: true }).fill('1048576');
	await frame.getByRole('button', { name: 'Save', exact: true }).click();
	await expect
		.poll(async () =>
			JSON.parse((await pluginSettings(request, installed.appId, original.id)).configuration.documentJson),
		)
		.toEqual({ maxRecallItems: 800, maxRecallBytes: 1048576 });
	await expect
		.poll(() => frame.locator('body').evaluate((body) => body.scrollWidth <= document.documentElement.clientWidth))
		.toBe(true);
	await dialog.getByRole('button', { name: 'Add instance', exact: true }).click();
	await expect
		.poll(
			async () =>
				(await pluginInstances(request, installed.appId)).filter(
					(entry) => entry.packageId === 'nexus.tools.agent',
				).length,
		)
		.toBe(2);
	await expect(frame.getByRole('spinbutton', { name: 'Memory recall items', exact: true })).toHaveValue('5');
	const instanceSelector = dialog.locator('[id="nexus.tools.agent-instance"]');
	await selectUiOption(instanceSelector, original.id);
	await expect(frame.getByRole('spinbutton', { name: 'Memory recall items', exact: true })).toHaveValue('800');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await selectAgentSettingsGroup(page, 'models');
	const panel = page.locator('#settings-panel-agent');
	await expect(panel.getByText('Recall items', { exact: true })).toHaveCount(0);
	await expect(panel.getByText('Recall total (bytes)', { exact: true })).toHaveCount(0);
});
