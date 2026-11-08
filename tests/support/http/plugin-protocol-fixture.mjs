import { test as baseTest, expect } from 'vitest';
import { openPlugins } from '../../backend/agent/plugins/support/plugin-management-fixture.mjs';
import { expectStatus } from '../protocols/openssh-fixture.mjs';
import { readAgentAppResponse } from '../../../packages/shared/src/agent/scope/http-codec.ts';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '../../../packages/shared/src/agent/scope/workspace-http-codec.ts';
import {
	readAgentExecutionSettingsResponse,
	readAgentExecutionSettingsUpdate,
} from '../../../packages/shared/src/agent/execution/http-codec.ts';

export { expect };

export const test = baseTest.extend({
	pluginHost: async ({}, use) => {
		const closeTasks = [];
		try {
			const host = await openPlugins((close) => closeTasks.push(close));
			await use(host);
		} finally {
			const outcomes = await Promise.allSettled(closeTasks.map((close) => Promise.resolve().then(close)));
			const failures = outcomes
				.filter((outcome) => outcome.status === 'rejected')
				.map((outcome) => outcome.reason);
			if (failures.length) throw new AggregateError(failures, 'Plugin protocol host failed to drain');
		}
	},
});

export async function requestAgentJson(api, { method, path, data, status = 200 }, decode) {
	return decode(expectStatus(await api(method, '/api/v1/agent' + path, data), status));
}

export async function createAgentApp(host, label = 'public-lifecycle') {
	const installed = await host.install(label);
	return readAgentAppResponse(expectStatus(await host.api('GET', installed.appPath), 200));
}

export async function requestAgentWorkspace(api, app, input) {
	const body = readAgentWorkspaceRequest({ appVersion: app.version, request: input });
	return requestAgentJson(
		api,
		{ method: 'POST', path: '/apps/' + app.id + '/workspace', data: body },
		(value) => readAgentWorkspaceResponse(value, app.id, body).result,
	);
}

export async function enableAgent(api) {
	const { settings } = await requestAgentJson(
		api,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	if (settings.enabled) return;
	const saved = await requestAgentJson(
		api,
		{
			method: 'PUT',
			path: '/execution-settings',
			data: readAgentExecutionSettingsUpdate({
				expectedVersion: settings.version,
				enabled: true,
				limits: settings.limits,
			}),
		},
		readAgentExecutionSettingsResponse,
	);
	expect(saved.settings.enabled).toBe(true);
}
