import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { requestAgentJson, createTestAgentApp, enableTestAgentExecution } from '../../support/agent';
import { installTestPlugin, stageTestPlugin } from '../../support/plugins';
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
	readAgentPluginInstallation,
	readAgentPluginItems,
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
	// Raising back to the actual protocol ceiling also requires a fresh, single-use confirmation.
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
		contextCompactionMode: 'aggressive',
		contextProfile: 'extended',
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
	const input = { expectedRevision: before.revision, stageId: verified.id, expectedStageVersion: verified.version };
	const prepared = await requestAgentJson(
		request,
		{ method: 'POST', path: `/plugins/installations/${before.appId}/prepare-upgrade`, data: input },
		readAgentPluginInstallation,
	);
	expect(prepared.status).toBe('draining');
	const upgraded = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: `/plugins/installations/${before.appId}/upgrade`,
			data: { ...input, expectedRevision: prepared.revision },
		},
		readAgentPluginInstallation,
	);
	expect(upgraded).toMatchObject({
		appId: before.appId,
		definitionId: 'nexus.upgrade',
		version: '2.0.0',
		status: 'installed',
	});
	expect(upgraded.revision).toBeGreaterThan(prepared.revision);
	const installations = await requestAgentJson(request, { method: 'GET', path: '/plugins/installations' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginInstallation),
	);
	expect(installations.items).toContainEqual(upgraded);
	const apps = await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
	expect(apps).toContainEqual(expect.objectContaining({ id: before.appId, definitionVersion: '2.0.0' }));
});
