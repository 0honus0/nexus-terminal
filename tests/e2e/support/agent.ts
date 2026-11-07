import { agentChatSurface } from '../fixtures/agent/workbench';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { E2E_URLS } from './test-env';
import { requestAgentJson } from './agent-request';
import { installTestPlugin } from './plugins';
import { readAgentAppResponse } from '../../../packages/shared/src/agent/scope/http-codec';
import { readAgentProviderView } from '../../../packages/shared/src/agent/providers/http-codec';
import { readAgentGrantView } from '../../../packages/shared/src/agent/governance/http-codec';
import {
	readAgentExecutionSettingsResponse,
	readAgentExecutionSettingsUpdate,
} from '../../../packages/shared/src/agent/execution/http-codec';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '../../../packages/shared/src/agent/scope/workspace-http-codec';
import type {
	AgentWorkspaceRequest,
	AgentWorkspaceResult,
} from '../../../packages/shared/src/agent/scope/workspace-http';
import type { AgentAppView, AgentThreadView } from '../../../packages/shared/src/agent/scope/model';
import type { AgentProviderView } from '../../../packages/shared/src/agent/providers/model';
import type { AgentCreateRunRequest } from '../../../packages/shared/src/agent/runs/http';

export async function requestAgentWorkspace(
	request: APIRequestContext,
	app: AgentAppView,
	input: AgentWorkspaceRequest['request'],
): Promise<AgentWorkspaceResult> {
	const body = readAgentWorkspaceRequest({ appVersion: app.version, request: input });
	return requestAgentJson(
		request,
		{ method: 'POST', path: '/apps/' + app.id + '/workspace', data: body },
		(value) => readAgentWorkspaceResponse(value, app.id, body).result,
	);
}

export async function createAgentProvider(request: APIRequestContext): Promise<AgentProviderView> {
	return requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/ai/providers',
			status: 201,
			data: {
				kind: 'openai-compatible',
				displayName: 'E2E local model ' + randomUUID(),
				baseUrl: E2E_URLS.openAiProviderOrigin + '/v1',
				protocol: 'chat-completions',
				// Include the current server-owned tool catalog in the request budget.
				models: [{ id: 'e2e-model', contextWindow: 131072, maxOutputTokens: 128, supportsTools: true }],
				enabled: true,
				credential: 'e2e-provider-secret',
			},
		},
		readAgentProviderView,
	);
}

export async function prepareAgentRun(
	request: APIRequestContext,
	existingApp?: AgentAppView,
): Promise<{
	app: AgentAppView;
	thread: AgentThreadView;
	provider: AgentProviderView;
	input: AgentCreateRunRequest;
}> {
	const app = existingApp ?? (await createTestAgentApp(request));
	const grants = await requestAgentJson(
		request,
		{ method: 'GET', path: `/apps/${app.id}/grants` },
		readAgentGrantView,
	);
	if (!grants.grants.some((grant) => grant.capability === 'plugin.invoke')) {
		await requestAgentJson(
			request,
			{
				method: 'PUT',
				path: `/apps/${app.id}/grants`,
				data: {
					expectedPolicyRevision: grants.policyRevision,
					grants: [
						...grants.grants.map((grant) => ({ capability: grant.capability, scope: grant.scope })),
						{ capability: 'plugin.invoke', scope: { kind: 'global' } },
					],
				},
			},
			readAgentGrantView,
		);
	}
	const created = await requestAgentWorkspace(request, app, {
		method: 'agent.threads.create',
		params: { autoTitle: false, operationId: randomUUID(), title: 'Event pagination' },
	});
	if (created.method !== 'agent.threads.create') throw new Error('Unexpected thread confirmation');
	const provider = await createAgentProvider(request);
	await enableTestAgentExecution(request);
	return {
		app,
		thread: created.value,
		provider,
		input: {
			prompt: 'Reply OK without using tools.',
			approvalMode: 'ask',
			connectionIds: [],
			inputJson: JSON.stringify({
				model: {
					providerId: provider.id,
					modelId: 'e2e-model',
					configurationVersion: provider.version,
					reasoningEffort: null,
				},
				artifacts: [],
			}),
		},
	};
}

export async function createTestAgentApp(
	request: APIRequestContext,
	name = 'E2E native Agent ' + randomUUID(),
): Promise<AgentAppView> {
	const response = await fetch(E2E_URLS.pluginRepositoryOrigin + '/native-package', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
	});
	expect(response.ok).toBe(true);
	const created: unknown = await response.json();
	if (
		typeof created !== 'object' ||
		created === null ||
		!('packageId' in created) ||
		typeof created.packageId !== 'string'
	) {
		throw new Error('Invalid native plugin fixture identity');
	}
	const installed = await installTestPlugin(request, created.packageId);
	const app = await requestAgentJson(
		request,
		{ method: 'GET', path: '/apps/' + installed.appId },
		readAgentAppResponse,
	);
	return requestAgentJson(
		request,
		{
			method: 'PATCH',
			path: '/apps/' + app.id,
			data: { expectedVersion: app.version, enabled: true },
		},
		readAgentAppResponse,
	);
}

export async function enableTestAgentExecution(request: APIRequestContext): Promise<void> {
	const current = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	if (current.settings.enabled) {
		return;
	}
	const saved = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: '/execution-settings',
			data: readAgentExecutionSettingsUpdate({
				expectedVersion: current.settings.version,
				enabled: true,
				limits: current.settings.limits,
			}),
		},
		readAgentExecutionSettingsResponse,
	);
	expect(saved.settings.enabled).toBe(true);
	expect(saved.settings.version).toBe(current.settings.version + 1);
}

export async function openAgentHub(page: Page): Promise<void> {
	const hub = page.getByRole('dialog', { name: 'Agent', exact: true });
	const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
	await expect.poll(async () => (await hub.isVisible()) || (await launcher.isVisible())).toBe(true);
	if (!(await hub.isVisible())) {
		await launcher.click();
	}
	await expect(hub).toBeVisible();
}

export async function selectAgentModel(page: Page, provider: AgentProviderView, modelId = 'e2e-model'): Promise<void> {
	const hub = agentChatSurface(page);
	const trigger = hub.getByRole('button', { name: 'Model for this execution', exact: true });
	const models = hub.getByRole('listbox', { name: 'Model for this execution', exact: true });
	await trigger.click();
	const option = models
		.getByRole('option')
		.filter({
			has: page.getByText(provider.displayName + ' · ' + provider.protocol, { exact: true }),
		})
		.filter({ has: page.getByText(modelId, { exact: true }) });
	await expect(option).toHaveCount(1);
	await option.click();
	await expect(models).toBeHidden();
	await expect(trigger).toContainText(modelId);
	await trigger.click();
	await expect(option).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Escape');
	await expect(models).toBeHidden();
}

export async function selectAgentSettingsGroup(
	page: Page,
	group: 'models' | 'tools' | 'runtime' | 'safety',
): Promise<void> {
	const labels = {
		models: 'Models & Budget',
		tools: 'Apps and extensions',
		runtime: 'Execution & Integrations',
		safety: 'Safety and system',
	};
	await page
		.getByRole('navigation', { name: 'Agent settings sections', exact: true })
		.getByRole('button', { name: labels[group], exact: true })
		.click();
}

export async function selectAgentExtensionsSection(
	page: Page,
	section: 'apps' | 'integrations' | 'market' | 'budget',
): Promise<void> {
	await selectAgentSettingsGroup(page, 'tools');
	const labels = {
		apps: 'Agent apps',
		integrations: 'MCP / ACP',
		market: 'Plugin market',
		budget: 'Execution budget',
	};
	const tab = page
		.getByRole('tablist', { name: 'Apps and extensions', exact: true })
		.getByRole('tab', { name: labels[section], exact: true });
	await tab.click();
	await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Open the existing docked sidebar or narrow-window drawer through its visible control. */
export async function openAgentConversations(page: Page): Promise<void> {
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
	const toggle = agentChatSurface(page).getByRole('button', { name: 'Open conversations', exact: true });
	await expect(toggle).toHaveAttribute('aria-expanded', /^(true|false)$/);
	if ((await toggle.getAttribute('aria-expanded')) === 'false') {
		await toggle.click();
	}
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}
