import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { createAgentProvider, requestAgentJson, requestAgentWorkspace } from '../../support/agent';
import { E2E_URLS } from '../../support/test-env';
import { readAccessNeedsSetup } from '../../../../packages/shared/src/access/http';
import {
	readAgentCreateAppResponse,
	readAgentAppListResponse,
	readAgentAppResponse,
} from '../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentProviderView,
	readAgentProviderTestResponse,
} from '../../../../packages/shared/src/agent/providers/http-codec';

test('the current first-release schema initializes a clean database through normal application startup', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const setup = await request.get('/api/v1/auth/needs-setup');
	expect(setup.ok()).toBeTruthy();
	expect(readAccessNeedsSetup(await setup.json()).needsSetup).toBe(false);
	expect(await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse)).toEqual([]);
	const app = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/apps',
			status: 201,
			data: { name: 'Current schema' },
		},
		readAgentCreateAppResponse,
	);
	const thread = await requestAgentWorkspace(request, app, {
		method: 'agent.threads.create',
		params: { operationId: randomUUID(), title: 'Fresh thread' },
	});
	if (thread.method !== 'agent.threads.create') throw new Error('Unexpected thread confirmation');
	expect(thread.value).toMatchObject({ appId: app.id, title: 'Fresh thread', version: 1 });
});

test('reopening the current schema preserves account, App, thread and encrypted Provider records', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const provider = await createAgentProvider(request);
	const app = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/apps',
			status: 201,
			data: { name: 'Restart persistence' },
		},
		readAgentCreateAppResponse,
	);
	const command = {
		method: 'agent.threads.create',
		params: { operationId: randomUUID(), title: 'Retained thread' },
	} as const;
	const created = await requestAgentWorkspace(request, app, command);
	const token = process.env.NEXUS_E2E_CONTROL_TOKEN;
	if (!token) throw new Error('Missing E2E control token');
	const restarted = await fetch(E2E_URLS.backendControlOrigin + '/restart', {
		method: 'POST',
		headers: { 'X-Nexus-E2E-Control': token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ mode: 'restart' }),
		signal: AbortSignal.timeout(60_000),
	});
	expect(restarted.ok).toBe(true);
	await expect(restarted.json()).resolves.toEqual({ reset: true, mode: 'restart' });
	await loginAsInitialAdmin(request);
	expect(
		await requestAgentJson(
			request,
			{
				method: 'GET',
				path: '/apps/' + app.id,
			},
			readAgentAppResponse,
		),
	).toEqual(app);
	expect(
		await requestAgentJson(
			request,
			{
				method: 'GET',
				path: '/ai/providers/' + provider.id,
			},
			readAgentProviderView,
		),
	).toEqual(provider);
	expect(await requestAgentWorkspace(request, app, command)).toEqual(created);
	const probe = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/ai/providers/' + provider.id + '/test',
			data: { modelId: 'e2e-model' },
		},
		readAgentProviderTestResponse,
	);
	expect(probe.ok).toBe(true);
});
