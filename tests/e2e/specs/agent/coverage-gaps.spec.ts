import { readAgentPluginPackageUpdatePreparation } from '../../../../packages/shared/src/agent/plugins/package-update-http-codec';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { requestAgentJson } from '../../support/agent-request';
import { requestAgentWorkspace, createTestAgentApp, enableTestAgentExecution } from '../../support/agent';
import { installTestPlugin, stageTestPlugin, getPluginInstallation } from '../../support/plugins';
import { readAgentAppListResponse, readAgentAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentExecutionSettingsResponse,
	readAgentHardLimitPreviewResponse,
} from '../../../../packages/shared/src/agent/execution/http-codec';
import {
	readAgentExecutionPolicyView,
	readAgentGrantView,
} from '../../../../packages/shared/src/agent/governance/http-codec';
import {
	readAgentMemoryListResponse,
	readAgentMemoryResponse,
} from '../../../../packages/shared/src/agent/memory/http-codec';
import {
	readAgentPluginIntentResponse,
	readAgentPluginIntentListResponse,
} from '../../../../packages/shared/src/agent/plugins/intent-http-codec';
import {
	readAgentPluginInstallationList,
	readAgentPluginPackageInstallationList,
	readAgentPluginPackageInstallationResponse,
} from '../../../../packages/shared/src/agent/plugins/http-codec';
import { readAgentErrorResponse } from '../../../../packages/shared/src/agent/http-codec';

async function prepare(request: APIRequestContext): Promise<void> {
	await loginAsInitialAdmin(request);
	await enableTestAgentExecution(request);
}

test('Hard Limit preview and confirm commit exactly once through the public Agent API', async ({ request }) => {
	await prepare(request);
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
	request,
}) => {
	await prepare(request);
	const app = await createTestAgentApp(request);
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
		maxRecallItems: 100,
		maxRecallBytes: 1048576,
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
		maxRecallItems: 100,
		maxRecallBytes: 1048576,
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

test('per-App execution policy persists overrides and rejects stale or over-limit writes', async ({ request }) => {
	await prepare(request);
	const app = await createTestAgentApp(request);
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

test('Memory proposal, review, list, stale-CAS rejection, and revoke close the public lifecycle', async ({
	request,
}) => {
	await prepare(request);
	const app = await createTestAgentApp(request);
	const path = `/apps/${app.id}/memories`;
	const { memory: proposed } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path,
			status: 201,
			data: {
				content: 'E2E candidate memory',
				confidence: 0.9,
				expiresAt: null,
				sourceRunId: null,
			},
		},
		readAgentMemoryResponse,
	);
	expect(proposed).toMatchObject({
		appId: app.id,
		content: 'E2E candidate memory',
		status: 'candidate',
		confidence: 0.9,
		version: 1,
	});
	const candidates = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?status=candidate&limit=20&offset=0' },
		readAgentMemoryListResponse,
	);
	expect(candidates.items).toContainEqual(proposed);
	const thread = await requestAgentWorkspace(request, app, {
		method: 'agent.threads.create',
		params: { autoTitle: false, operationId: randomUUID(), title: 'Memory review scope' },
	});
	if (thread.method !== 'agent.threads.create') throw new Error('Unexpected thread confirmation');
	const scoped = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?status=candidate&limit=50&offset=0&threadId=' + thread.value.id },
		readAgentMemoryListResponse,
	);
	expect(scoped.items).toEqual([]);
	expect(scoped.nextOffset).toBeNull();
	const missingThread = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?threadId=' + randomUUID(), status: 404 },
		readAgentErrorResponse,
	);
	expect(missingThread.code).toBe('not_found');
	for (const query of ['threadId=invalid', 'threadId=' + thread.value.id + '&threadId=' + thread.value.id]) {
		const invalidThread = await requestAgentJson(
			request,
			{ method: 'GET', path: path + '?' + query, status: 400 },
			readAgentErrorResponse,
		);
		expect(invalidThread.code).toBe('invalid_input');
	}
	const { memory: published } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: `${path}/${proposed.id}/review`,
			data: {
				decision: 'publish',
				expectedVersion: proposed.version,
				content: 'E2E published memory',
			},
		},
		readAgentMemoryResponse,
	);
	expect(published).toMatchObject({
		id: proposed.id,
		content: 'E2E published memory',
		status: 'published',
		version: proposed.version + 1,
	});
	const stale = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: `${path}/${proposed.id}/review`,
			status: 409,
			data: {
				decision: 'revoke',
				expectedVersion: proposed.version,
				content: null,
			},
		},
		readAgentErrorResponse,
	);
	expect(stale.code).toBe('version_conflict');
	const publishedList = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?status=published&limit=20&offset=0' },
		readAgentMemoryListResponse,
	);
	expect(publishedList.items).toContainEqual(published);
	const { memory: revoked } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: `${path}/${proposed.id}/review`,
			data: {
				decision: 'revoke',
				expectedVersion: published.version,
				content: null,
			},
		},
		readAgentMemoryResponse,
	);
	expect(revoked).toMatchObject({ id: proposed.id, status: 'revoked', version: published.version + 1 });
	const revokedList = await requestAgentJson(
		request,
		{ method: 'GET', path: path + '?status=revoked&limit=20&offset=0' },
		readAgentMemoryListResponse,
	);
	expect(revokedList.items).toContainEqual(revoked);
});

async function authorizeIntentApp(request: APIRequestContext, appId: string): Promise<void> {
	const apps = await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
	const app = apps.find((candidate) => candidate.id === appId);
	if (!app) {
		throw new Error('Installed plugin App is missing');
	}
	if (!app.enabled) {
		await requestAgentJson(
			request,
			{ method: 'PATCH', path: '/apps/' + app.id, data: { enabled: true, expectedVersion: app.version } },
			readAgentAppResponse,
		);
	}
	const path = `/apps/${appId}/grants`;
	const before = await requestAgentJson(request, { method: 'GET', path }, readAgentGrantView);
	const saved = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path,
			data: {
				expectedPolicyRevision: before.policyRevision,
				grants: [{ capability: 'app.intents.exchange', scope: { kind: 'global' } }],
			},
		},
		readAgentGrantView,
	);
	expect(saved.grants).toContainEqual(expect.objectContaining({ capability: 'app.intents.exchange' }));
}

test('AppIntent public API creates, replays, lists, and revokes a confirmed cross-App receipt', async ({ request }) => {
	await prepare(request);
	const sender = await installTestPlugin(request, 'nexus.agent');
	const receiver = await installTestPlugin(request, 'nexus.intent-peer');
	await authorizeIntentApp(request, sender.appId);
	await authorizeIntentApp(request, receiver.appId);
	const path = `/apps/${sender.appId}/plugin-intents`;
	const input = {
		operationId: randomUUID(),
		receiverAppId: receiver.appId,
		intentId: 'e2e.receive',
		inputJson: JSON.stringify({ source: 'e2e', entries: 2 }),
		artifactIds: [],
		confirmed: true,
	};
	const { receipt } = await requestAgentJson(
		request,
		{ method: 'POST', path, status: 201, data: input },
		readAgentPluginIntentResponse,
	);
	expect(receipt).toMatchObject({
		senderAppId: sender.appId,
		receiverAppId: receiver.appId,
		intentId: input.intentId,
		schemaVersion: 1,
		inputJson: input.inputJson,
		artifactIds: [],
	});
	const replay = await requestAgentJson(
		request,
		{ method: 'POST', path, status: 201, data: input },
		readAgentPluginIntentResponse,
	);
	expect(replay.receipt).toEqual(receipt);
	const listPath = `/apps/${receiver.appId}/plugin-intents?limit=10`;
	const received = await requestAgentJson(
		request,
		{ method: 'GET', path: listPath },
		readAgentPluginIntentListResponse,
	);
	expect(received.items).toContainEqual(receipt);
	await requestAgentJson(request, { method: 'DELETE', path: `${path}/${receipt.id}`, data: {} }, (raw) => {
		expect(raw).toEqual({ revoked: true });
	});
	const afterRevoke = await requestAgentJson(
		request,
		{ method: 'GET', path: listPath },
		readAgentPluginIntentListResponse,
	);
	expect(afterRevoke.items).not.toContainEqual(expect.objectContaining({ id: receipt.id }));
});

test('Plugin public API upgrades an installed package to a newer signed version', async ({ request }) => {
	await prepare(request);
	const before = await installTestPlugin(request, 'nexus.upgrade', '1.0.0');
	const verified = await stageTestPlugin(request, 'nexus.upgrade', '2.0.0');
	const packages = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/packages' },
		readAgentPluginPackageInstallationList,
	);
	const installedPackage = packages.installations.find((item) => item.packageId === before.definitionId);
	if (!installedPackage) throw new Error('Missing installed package');
	const input = {
		expectedRevision: installedPackage.revision,
		stageId: verified.id,
		expectedStageVersion: verified.version,
	};
	const { installation: prepared, dependencies } = await requestAgentJson(
		request,
		{ method: 'POST', path: `/plugins/packages/${before.definitionId}/prepare-update`, data: input },
		readAgentPluginPackageUpdatePreparation,
	);
	expect(prepared.status).toBe('draining');
	const { installation: updatedPackage } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: `/plugins/packages/${before.definitionId}/update`,
			data: { ...input, expectedRevision: prepared.revision, dependencies },
		},
		readAgentPluginPackageInstallationResponse,
	);
	expect(updatedPackage.version).toBe('2.0.0');
	expect(updatedPackage.revision).toBeGreaterThan(prepared.revision);
	const upgraded = await getPluginInstallation(request, before.appId);
	expect(upgraded).toMatchObject({
		appId: before.appId,
		definitionId: 'nexus.upgrade',
		version: '2.0.0',
		status: 'installed',
	});
	expect(upgraded.revision).toBeGreaterThan(before.revision);
	const installations = await requestAgentJson(request, { method: 'GET', path: '/plugins/installations' }, (raw) =>
		readAgentPluginInstallationList(raw),
	);
	expect(installations.items).toContainEqual(upgraded);
	const apps = await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
	expect(apps).toContainEqual(expect.objectContaining({ id: before.appId, definitionVersion: '2.0.0' }));
});
