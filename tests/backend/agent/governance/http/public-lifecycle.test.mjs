import {
	test,
	expect,
	requestAgentJson,
	createAgentApp,
	enableAgent,
} from '../../../../support/http/plugin-protocol-fixture.mjs';
import {
	readAgentExecutionSettingsResponse,
	readAgentHardLimitPreviewResponse,
} from '../../../../../packages/shared/src/agent/execution/http-codec';
import { readAgentExecutionPolicyView } from '../../../../../packages/shared/src/agent/governance/http-codec';
import { readAgentErrorResponse } from '../../../../../packages/shared/src/agent/http-codec';
test('Hard Limit preview and confirm commit exactly once through the public Agent API', async ({ pluginHost }) => {
	const request = pluginHost.api;
	await enableAgent(request);
	const { settings: before } = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	const proposed = { ...before.hardLimits, maxModelRequests: before.hardLimits.maxModelRequests - 1 };
	const { confirmation } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/execution-settings/hard-limits/preview',
			data: {
				expectedVersion: before.version,
				proposed,
			},
		},
		readAgentHardLimitPreviewResponse,
	);
	expect(confirmation.expectedVersion).toBe(before.version);
	expect(confirmation.proposed).toEqual(proposed);
	expect(confirmation.expiresAt).toBeGreaterThan(Date.now());
	const { settings: unchanged } = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	expect(unchanged).toEqual(before);
	const { settings: saved } = await requestAgentJson(
		request,
		{ method: 'POST', path: '/execution-settings/hard-limits/confirm', data: { confirmationId: confirmation.id } },
		readAgentExecutionSettingsResponse,
	);
	expect(saved.version).toBe(before.version + 1);
	expect(saved.hardLimits).toEqual(proposed);
	const replay = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/execution-settings/hard-limits/confirm',
			status: 409,
			data: { confirmationId: confirmation.id },
		},
		readAgentErrorResponse,
	);
	expect(replay.code).toBe('version_conflict');
	const { settings: after } = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	expect(after).toEqual(saved);
	// Restoring the saved hard limit also requires a fresh, single-use confirmation.
	const increase = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/execution-settings/hard-limits/preview',
			data: {
				expectedVersion: saved.version,
				proposed: before.hardLimits,
			},
		},
		readAgentHardLimitPreviewResponse,
	);
	const restored = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/execution-settings/hard-limits/confirm',
			data: {
				confirmationId: increase.confirmation.id,
			},
		},
		readAgentExecutionSettingsResponse,
	);
	expect(restored.settings.version).toBe(saved.version + 1);
	expect(restored.settings.hardLimits).toEqual(before.hardLimits);
});
test('editable hard limits persist above defaults while budgets and App policy retain their actual constraints', async ({
	pluginHost,
}) => {
	const request = pluginHost.api;
	await enableAgent(request);
	const app = await createAgentApp(pluginHost);
	const { settings: before } = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	const proposed = {
		maxModelRequests: 800,
		maxToolExecutions: 8000,
		maxActiveSeconds: 86400,
		toolTimeoutSeconds: 600,
		maxToolOutputBytes: 1048576,
		maxTokenReservations: 16000000,
		maxConcurrentRuns: 16,
		maxConcurrentModelCalls: 12,
		maxChildren: 12,
		maxMessages: 10000,
		maxMessageBytes: 16777216,
		maxArtifactBytes: 21474836480,
		artifactTtlSeconds: 5184000,
	};
	const { confirmation } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/execution-settings/hard-limits/preview',
			data: { expectedVersion: before.version, proposed },
		},
		readAgentHardLimitPreviewResponse,
	);
	const { settings: raised } = await requestAgentJson(
		request,
		{ method: 'POST', path: '/execution-settings/hard-limits/confirm', data: { confirmationId: confirmation.id } },
		readAgentExecutionSettingsResponse,
	);
	expect(raised.hardLimits).toEqual(proposed);
	expect(raised.limits).toEqual(before.limits);
	const { settings: saved } = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: '/execution-settings',
			data: { expectedVersion: raised.version, enabled: raised.enabled, limits: proposed },
		},
		readAgentExecutionSettingsResponse,
	);
	expect(saved.limits).toEqual(proposed);
	expect(
		(
			await requestAgentJson(
				request,
				{ method: 'GET', path: '/execution-settings' },
				readAgentExecutionSettingsResponse,
			)
		).settings,
	).toEqual(saved);
	const path = `/apps/${app.id}/execution-policy`;
	const policy = await requestAgentJson(request, { method: 'GET', path }, readAgentExecutionPolicyView);
	const overrides = {
		maxModelRequests: 800,
		maxActiveExecutionSeconds: 86400,
		toolTimeoutSeconds: 600,
		maxToolOutputBytes: 1048576,
		maxSubagentMessages: 10000,
		maxSubagentMessageBytes: 16777216,
	};
	const updated = await requestAgentJson(
		request,
		{ method: 'PUT', path, data: { expectedVersion: policy.version, overrides } },
		readAgentExecutionPolicyView,
	);
	expect(updated.overrides).toEqual(overrides);
	expect(updated.effective).toMatchObject(overrides);
	for (const invalid of [
		{ ...proposed, maxModelRequests: Number.MAX_SAFE_INTEGER + 1 },
		{ ...proposed, toolTimeoutSeconds: 2147484, maxActiveSeconds: 2147484 },
	]) {
		const rejected = await requestAgentJson(
			request,
			{
				method: 'POST',
				path: '/execution-settings/hard-limits/preview',
				status: 400,
				data: { expectedVersion: saved.version, proposed: invalid },
			},
			readAgentErrorResponse,
		);
		expect(rejected.code).toBe('invalid_input');
	}
	const overBudget = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: '/execution-settings',
			status: 400,
			data: {
				expectedVersion: saved.version,
				enabled: saved.enabled,
				limits: { ...proposed, maxModelRequests: 801 },
			},
		},
		readAgentErrorResponse,
	);
	expect(overBudget.code).toBe('invalid_input');
	expect(
		(
			await requestAgentJson(
				request,
				{ method: 'GET', path: '/execution-settings' },
				readAgentExecutionSettingsResponse,
			)
		).settings,
	).toEqual(saved);
});
test('per-App execution policy persists overrides and rejects stale or over-limit writes', async ({ pluginHost }) => {
	const request = pluginHost.api;
	await enableAgent(request);
	const app = await createAgentApp(pluginHost);
	const path = `/apps/${app.id}/execution-policy`;
	const { settings } = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	const before = await requestAgentJson(request, { method: 'GET', path }, readAgentExecutionPolicyView);
	expect(before.overrides).toEqual({});
	const overrides = {
		maxModelRequests: Math.min(3, settings.hardLimits.maxModelRequests),
	};
	const saved = await requestAgentJson(
		request,
		{ method: 'PUT', path, data: { expectedVersion: before.version, overrides } },
		readAgentExecutionPolicyView,
	);
	expect(saved.version).toBe(before.version + 1);
	expect(saved.overrides).toEqual(overrides);
	expect(saved.effective).toMatchObject(overrides);
	const stale = await requestAgentJson(
		request,
		{ method: 'PUT', path, status: 409, data: { expectedVersion: before.version, overrides: {} } },
		readAgentErrorResponse,
	);
	expect(stale.code).toBe('version_conflict');
	const overLimit = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path,
			status: 400,
			data: {
				expectedVersion: saved.version,
				overrides: { maxModelRequests: settings.hardLimits.maxModelRequests + 1 },
			},
		},
		readAgentErrorResponse,
	);
	expect(overLimit.code).toBe('invalid_input');
	expect(await requestAgentJson(request, { method: 'GET', path }, readAgentExecutionPolicyView)).toEqual(saved);
});
