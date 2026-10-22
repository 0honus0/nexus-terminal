import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { E2E_URLS } from './test-env';
import { readAgentCreateAppResponse } from '../../../packages/shared/src/agent/scope/http-codec';
import { readAgentProviderView } from '../../../packages/shared/src/agent/providers/http-codec';
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

export async function requestAgentJson<T>(
	request: APIRequestContext,
	command: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; data?: unknown; status?: number },
	decode: (value: unknown) => T,
): Promise<T> {
	const response = await request.fetch('/api/v1/agent' + command.path, {
		method: command.method,
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: command.data,
	});
	expect(response.status(), command.method + ' ' + command.path).toBe(command.status ?? 200);
	return decode(await response.json());
}

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
				displayName: 'E2E local model',
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
	const created = await requestAgentWorkspace(request, app, {
		method: 'agent.threads.create',
		params: { operationId: randomUUID(), title: 'Event pagination' },
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
			connectionIds: [],
			model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
		},
	};
}

export async function createTestAgentApp(
	request: APIRequestContext,
	name = 'E2E native Agent ' + randomUUID(),
): Promise<AgentAppView> {
	return requestAgentJson(
		request,
		{ method: 'POST', path: '/apps', data: { name }, status: 201 },
		readAgentCreateAppResponse,
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

/** Open the existing docked sidebar or narrow-window drawer through its visible control. */
export async function openAgentConversations(page: Page): Promise<void> {
	const toggle = page.locator('.agent-hub-window').getByRole('button', { name: 'Open conversations', exact: true });
	await expect(toggle).toHaveAttribute('aria-expanded', /^(true|false)$/);
	if ((await toggle.getAttribute('aria-expanded')) === 'false') {
		await toggle.click();
	}
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}
