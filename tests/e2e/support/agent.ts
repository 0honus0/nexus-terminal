import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
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
				models: [{ id: 'e2e-model', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true }],
				enabled: true,
				credential: 'e2e-provider-secret',
			},
		},
		readAgentProviderView,
	);
}

export async function prepareAgentRun(request: APIRequestContext): Promise<{
	app: AgentAppView;
	thread: AgentThreadView;
	provider: AgentProviderView;
	input: AgentCreateRunRequest;
}> {
	const app = await requestAgentJson(
		request,
		{ method: 'POST', path: '/apps', data: { name: 'E2E native Agent' }, status: 201 },
		readAgentCreateAppResponse,
	);
	const created = await requestAgentWorkspace(request, app, {
		method: 'agent.threads.create',
		params: { operationId: randomUUID(), title: 'Event pagination' },
	});
	if (created.method !== 'agent.threads.create') throw new Error('Unexpected thread confirmation');
	const provider = await createAgentProvider(request);
	const settings = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: '/execution-settings',
			data: readAgentExecutionSettingsUpdate({
				expectedVersion: settings.settings.version,
				enabled: true,
				limits: settings.settings.limits,
				profiles: settings.settings.profiles,
			}),
		},
		readAgentExecutionSettingsResponse,
	);
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
