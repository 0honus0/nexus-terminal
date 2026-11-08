import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../../support/auth';
import { installTestPlugin } from '../../../support/plugins';
import { selectAgentExtensionsSection } from '../../../support/agent';
import { pluginInstance, pluginSettings } from '../../../support/plugin-settings';
import { selectUiOption } from '../../../support/ui-select';

test('Browser plugin owns mobile CDP settings and persists only valid instance configuration', async ({
	page,
	request,
}) => {
	await loginAsInitialAdmin(request);
	await loginAsInitialAdmin(page.request);
	await setUiLanguage(page.request);
	const installed = await installTestPlugin(request, 'nexus.agent');
	const instance = await pluginInstance(request, installed.appId, 'nexus.tools.browser');
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
	const row = page
		.locator('div.border-b')
		.filter({ has: page.getByText('Browser Tools', { exact: true }) })
		.filter({ has: page.getByRole('button', { name: 'Settings', exact: true }) });
	await row.getByRole('button', { name: 'Settings', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Plugin settings', exact: true });
	const selector = dialog.getByRole('combobox', { name: 'App using this plugin', exact: true });
	if ((await selector.getAttribute('data-value')) !== installed.appId)
		await selectUiOption(selector, installed.appId);
	const frame = dialog.frameLocator('iframe[title="Plugin settings"]');
	await frame.getByRole('button', { name: 'Add target', exact: true }).click();
	await frame.getByRole('textbox', { name: 'Target ID', exact: true }).fill('review');
	await frame.getByRole('textbox', { name: 'CDP address', exact: true }).fill('ws://browser.example.test/cdp');
	await frame.getByRole('textbox', { name: 'Allowed pages', exact: true }).fill('https://example.test/*');
	const before = await pluginSettings(request, installed.appId, instance.id);
	await expect(frame.getByText('Allow plaintext WebSocket', { exact: true })).toBeVisible();
	await expect(frame.getByText('Verify TLS certificate', { exact: true })).toBeVisible();
	await expect(frame.getByText('One HTTP(S) URL per line;', { exact: false })).toBeVisible();
	await frame.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(frame.getByRole('alert')).toContainText('Settings could not be confirmed.');
	expect((await pluginSettings(request, installed.appId, instance.id)).configuration).toEqual(before.configuration);
	await frame.getByRole('checkbox', { name: 'Allow plaintext WebSocket', exact: true }).check();
	await frame.getByRole('spinbutton', { name: 'Priority', exact: true }).fill('800');
	await frame.getByRole('button', { name: 'Save', exact: true }).click();
	await expect
		.poll(async () =>
			JSON.parse((await pluginSettings(request, installed.appId, instance.id)).configuration.documentJson),
		)
		.toEqual({
			targets: [
				{
					id: 'review',
					endpoints: [
						{ url: 'ws://browser.example.test/cdp', priority: 800, allowPlaintext: true, verifyTls: true },
					],
					allowedUrlPatterns: ['https://example.test/*'],
				},
			],
		});
	const content = frame.locator('body');
	await expect
		.poll(() => content.evaluate((body) => body.scrollWidth <= document.documentElement.clientWidth))
		.toBe(true);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await row.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(frame.getByRole('textbox', { name: 'Target ID', exact: true })).toHaveValue('review');
	await expect(frame.getByRole('spinbutton', { name: 'Priority', exact: true })).toHaveValue('800');
});
