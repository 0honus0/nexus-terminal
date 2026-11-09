import { randomUUID } from 'node:crypto';
import type { AgentBrowserTarget } from '../../../packages/shared/src/agent/integrations/browser-model';
import { readAgentPluginConfigurationView } from '../../../packages/shared/src/agent/plugins/settings-codec';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { agentRecord } from '../../../packages/shared/src/agent/http-codec';
import {
	readAgentPluginInstanceView,
	readAgentPluginInstanceSettings,
} from '../../../packages/shared/src/agent/plugins/settings-codec';
import { readAgentPluginConnectionView } from '../../../packages/shared/src/agent/plugins/connection-codec';
import { requestAgentJson } from './agent-request';
import { selectAgentExtensionsSection } from './agent';
import { selectUiOption } from './ui-select';

export function pluginInstancePath(appId: string, instanceId?: string): string {
	return '/plugins/apps/' + appId + '/instances' + (instanceId ? '/' + instanceId : '');
}

export async function pluginInstances(request: APIRequestContext, appId: string) {
	return requestAgentJson(request, { method: 'GET', path: pluginInstancePath(appId) }, (value) => {
		const row = agentRecord(value, ['instances']);
		if (!Array.isArray(row.instances)) throw new Error('Missing plugin instances');
		return row.instances.map(readAgentPluginInstanceView);
	});
}

export async function pluginInstance(request: APIRequestContext, appId: string, packageId: string) {
	const instance = (await pluginInstances(request, appId)).find(
		(value) => value.packageId === packageId && value.selected,
	);
	if (!instance) throw new Error('Selected plugin instance missing: ' + packageId);
	return instance;
}

export async function pluginSettings(request: APIRequestContext, appId: string, instanceId: string) {
	return requestAgentJson(
		request,
		{ method: 'GET', path: pluginInstancePath(appId, instanceId) + '/configuration' },
		readAgentPluginInstanceSettings,
	);
}

export async function pluginConnection(request: APIRequestContext, appId: string, instanceId: string) {
	return requestAgentJson(
		request,
		{ method: 'GET', path: pluginInstancePath(appId, instanceId) + '/connection' },
		readAgentPluginConnectionView,
	);
}

export async function openProtocolSettings(page: Page, appId: string, instanceName: string) {
	await page.goto('/settings?tab=agent');
	await selectAgentExtensionsSection(page, 'apps');
	const instance = (await pluginInstances(page.request, appId)).find((entry) => entry.name === instanceName);
	if (!instance) throw new Error('Plugin settings instance missing: ' + instanceName);
	const names: Record<string, string> = { 'nexus.services.mcp': 'MCP Service', 'nexus.services.acp': 'ACP Service' };
	const packageName = names[instance.packageId];
	if (!packageName) throw new Error('Unknown protocol package: ' + instance.packageId);
	const row = page.getByRole('article', { name: packageName, exact: true });
	await row.getByRole('button', { name: 'Settings', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Plugin settings', exact: true });
	const appSelector = dialog.getByRole('combobox', { name: 'App using this plugin', exact: true });
	if ((await appSelector.getAttribute('data-value')) !== appId) await selectUiOption(appSelector, appId);
	const instanceSelector = dialog.locator('[id="' + instance.packageId + '-instance"]');
	await expect(instanceSelector).toBeVisible();
	if ((await instanceSelector.getAttribute('data-value')) !== instance.id)
		await selectUiOption(instanceSelector, instance.id);
	await expect(appSelector).toHaveAttribute('data-value', appId);

	return dialog;
}

export async function configureBrowserTargets(
	request: APIRequestContext,
	appId: string,
	targets: AgentBrowserTarget[],
) {
	const instance = await pluginInstance(request, appId, 'nexus.tools.browser');
	const current = await pluginSettings(request, appId, instance.id);
	if (!current.settings) throw new Error('Browser settings contribution missing');
	const saved = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: pluginInstancePath(appId, instance.id) + '/configuration',
			data: {
				operationKey: randomUUID(),
				expectedPackageRevision: current.packageRevision,
				expectedRevision: current.configuration.revision,
				schemaRevision: current.settings.schemaRevision,
				documentJson: JSON.stringify({ targets }),
			},
		},
		(value) => {
			const row = agentRecord(value, ['configuration', 'changed']);
			return readAgentPluginConfigurationView(row.configuration);
		},
	);
	return { version: saved.revision, targets };
}
