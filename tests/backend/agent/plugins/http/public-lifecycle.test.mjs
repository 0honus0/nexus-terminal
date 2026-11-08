import { randomUUID } from 'node:crypto';
import { test, expect, requestAgentJson, enableAgent } from '../../../../support/http/plugin-protocol-fixture.mjs';
import { readAgentPluginPackageUpdatePreparation } from '../../../../../packages/shared/src/agent/plugins/package-update-http-codec';
import {
	readAgentAppListResponse,
	readAgentAppResponse,
} from '../../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentGrantView } from '../../../../../packages/shared/src/agent/governance/http-codec';
import {
	readAgentPluginIntentResponse,
	readAgentPluginIntentListResponse,
} from '../../../../../packages/shared/src/agent/plugins/intent-http-codec';
import {
	readAgentPluginInstallationList,
	readAgentPluginPackageInstallationList,
	readAgentPluginPackageInstallationResponse,
} from '../../../../../packages/shared/src/agent/plugins/http-codec';

test('retired Workspace control-plane endpoints do not expose a production Runner', async ({ pluginHost }) => {
	for (const path of [
		'/api/v1/agent/workspace-runtime/availability',
		'/api/v1/agent/workspace-runtime/catalog',
		'/api/v1/apps/nexus.agent/workspaces',
	]) {
		expect((await pluginHost.api('GET', path)).status).toBe(404);
	}
});

async function authorizeIntentApp(request, appId) {
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

test('AppIntent public API creates, replays, lists, and revokes a confirmed cross-App receipt', async ({
	pluginHost,
}) => {
	const request = pluginHost.api;
	await enableAgent(request);
	const sender = (await pluginHost.install('intent-sender', { capabilities: ['app.intents.exchange'] })).installation;
	const receiver = (
		await pluginHost.install('intent-receiver', {
			capabilities: ['app.intents.exchange'],
			intents: [{ id: 'e2e.receive', schemaVersion: 1 }],
		})
	).installation;
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
test('Plugin public API upgrades an installed package to a newer signed version', async ({ pluginHost }) => {
	const request = pluginHost.api;
	await enableAgent(request);
	const before = (await pluginHost.install('upgrade', { definitionId: 'nexus.upgrade', version: '1.0.0' }))
		.installation;
	const verified = await pluginHost.stage('upgrade', { definitionId: 'nexus.upgrade', version: '2.0.0' });
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
	const current = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/installations' },
		readAgentPluginInstallationList,
	);
	const upgraded = current.items.find((item) => item.appId === before.appId);
	if (!upgraded) throw new Error('Upgraded App installation is missing');
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
