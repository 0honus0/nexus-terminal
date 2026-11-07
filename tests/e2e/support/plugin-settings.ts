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
	await selectAgentExtensionsSection(page, 'integrations');
	const section = page.getByRole('region', { name: 'MCP / ACP integrations', exact: true });
	const selector = section.getByRole('combobox', { name: 'Choose an App instance', exact: true });
	if (await selector.count()) await selectUiOption(selector, appId);
	const card = section
		.getByRole('article')
		.filter({ has: page.getByRole('heading', { name: instanceName, exact: true }) });
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: 'Settings', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Plugin settings', exact: true });
	await expect(dialog.getByRole('combobox', { name: 'App using this plugin', exact: true })).toHaveAttribute(
		'data-value',
		appId,
	);
	return dialog;
}
