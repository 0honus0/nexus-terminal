import { installTestPlugin } from '../../../support/plugins';
import {
	selectAgentSettingsGroup,
	selectAgentExtensionsSection,
	requestAgentJson,
	enableTestAgentExecution,
} from '../../../support/agent';
import { readAgentAppResponse } from '../../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentPluginItems,
	readAgentPluginInstallation,
	readAgentPluginDataView,
} from '../../../../../packages/shared/src/agent/plugins/http-codec';
import { agentRecord } from '../../../../../packages/shared/src/agent/http-codec';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../../support/auth';
import { captureFunctionalScreenshot } from '../../../support/functional-screenshots';
import { enablePluginApp, openAgentHub } from './fixtures';

test.use({ actionTimeout: 10_000 });

test('frontend target owns a full Custom App Surface and connects through the isolated Plugin SDK', async ({
	page,
	context,
}) => {
	const request = context.request;
	await loginAsInitialAdmin(request);
	await setUiLanguage(request);
	await enableTestAgentExecution(request);
	const custom = await installTestPlugin(request, 'nexus.custom-surface');
	const agent = await installTestPlugin(request, 'nexus.agent');
	const fullstack = await installTestPlugin(request, 'nexus.fullstack');
	for (const installed of [custom, agent, fullstack]) {
		await enablePluginApp(request, installed.appId);
	}
	const installations = await requestAgentJson(request, { method: 'GET', path: '/plugins/installations' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginInstallation),
	);
	for (const installed of [custom, agent, fullstack]) {
		expect(installations.items).toContainEqual(installed);
	}
	await page.goto('/settings?tab=agent');
	await selectAgentSettingsGroup(page, 'tools');
	const section = page.getByRole('region', { name: 'Plugin management', exact: true });

	const appsSection = page.getByRole('region', { name: 'Agent apps', exact: true });
	await selectAgentExtensionsSection(page, 'market');
	await expect(section.getByRole('button', { name: 'Refresh repositories', exact: true })).toBeVisible();
	await expect(section.locator('input[type="file"]')).toHaveCount(0);
	await expect(section.getByRole('button', { name: 'Choose signed package', exact: true })).toHaveCount(0);
	for (const installed of [custom, agent, fullstack]) {
		await selectAgentExtensionsSection(page, 'apps');
		const card = appsSection.locator('article[data-app-id="' + installed.appId + '"]');
		await expect(card).toBeVisible();
		await expect(card.getByText('v' + installed.version, { exact: true })).toBeVisible();
		await expect(card.getByRole('button', { name: 'Uninstall', exact: true })).toBeDisabled();
		await expect(card.getByRole('button', { name: 'Configure Policies', exact: true })).toBeVisible();
	}

	await captureFunctionalScreenshot(page, 'agent-plugins-multiple-installed.png', {
		viewport: { width: 1440, height: 900 },
	});
	await selectAgentExtensionsSection(page, 'market');
	await expect(section.getByText('Runtime observations', { exact: true })).toHaveCount(0);
	await page.goto('/settings?tab=data');
	const maintenance = page.locator('details').filter({
		has: page.locator('summary').filter({ hasText: /^Diagnostics and recovery \(advanced\)$/ }),
	});
	await maintenance.getByText('Diagnostics and recovery (advanced)', { exact: true }).click();
	await expect(maintenance.getByText('Host diagnostics', { exact: true })).toBeVisible();
	await expect(maintenance.getByText('Machine mutation recovery', { exact: true })).toBeVisible();
	await expect(maintenance.getByText('Installation recovery and upgrade packages', { exact: true })).toHaveCount(0);
	await expect(maintenance.getByText('Runtime observations', { exact: true })).toHaveCount(0);
	await page.goto('/connections');
	const hub = await openAgentHub(page);

	const choose = async (appId: string) => {
		const app = await requestAgentJson(request, { method: 'GET', path: '/apps/' + appId }, readAgentAppResponse);
		await hub.getByRole('button', { name: 'Choose an Agent app', exact: true }).click();
		await page
			.locator('[data-agent-hub-portal]')
			.getByRole('button')
			.filter({ has: page.getByText(app.name, { exact: true }) })
			.click();
	};

	await choose(custom.appId);
	const customFrame = hub.locator('iframe').filter({ visible: true }).contentFrame();
	await expect(customFrame.getByRole('heading', { name: 'Custom Surface Fixture' })).toBeVisible();
	await expect(customFrame.getByTestId('custom-sdk-status')).toHaveText(
		`ready:${custom.appId}:nexus.custom-surface`,
		{ timeout: 15_000 },
	);
	await expect(hub.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
	await choose(fullstack.appId);
	const frame = hub.locator('iframe').filter({ visible: true });
	await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
	const surface = frame.contentFrame();
	await expect(surface.getByTestId('fullstack-frontend-status')).toHaveText(
		`frontend:ready:${fullstack.appId}@1.0.0`,
	);
	await expect(surface.getByTestId('fullstack-backend-status')).toHaveText('backend:active');
	await surface.getByTestId('fullstack-write-storage').click();
	await expect(surface.getByTestId('fullstack-storage-result')).toHaveText('storage:version:1:counter:1');
	const stored = await requestAgentJson(
		request,
		{ method: 'GET', path: `/plugins/installations/${fullstack.appId}/data/frontend.demo` },
		(raw) => {
			const row = agentRecord(raw, ['value']);
			return readAgentPluginDataView(row.value);
		},
	);
	expect(JSON.parse(stored.valueJson!)).toEqual({ source: 'frontend', counter: 1 });
	const backend = await requestAgentJson(
		request,
		{ method: 'GET', path: `/plugins/installations/${fullstack.appId}/data/backend.status` },
		(raw) => {
			const row = agentRecord(raw, ['value']);
			return readAgentPluginDataView(row.value);
		},
	);
	expect(JSON.parse(backend.valueJson!)).toMatchObject({
		appId: fullstack.appId,
		state: 'active',
		fileReadDenied: true,
		childProcessDenied: true,
	});
	const crossed = await requestAgentJson(
		request,
		{ method: 'GET', path: `/plugins/installations/${custom.appId}/data/frontend.demo` },
		(raw) => agentRecord(raw, ['value']),
	);
	expect(crossed.value).toBeNull();
	await choose(custom.appId);
	await expect(
		hub.locator('iframe').filter({ visible: true }).contentFrame().getByTestId('custom-sdk-status'),
	).toHaveText(`ready:${custom.appId}:nexus.custom-surface`);
});
