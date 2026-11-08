import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { requestAgentJson } from './agent-request';
import { E2E_URLS } from '../../support/protocols/test-environment';
import {
	readAgentPluginRepositorySettings,
	readAgentPluginCatalog,
} from '../../../packages/shared/src/agent/plugins/repository-http-codec';
import {
	readAgentPluginItems,
	readAgentPluginInstallationList,
	readAgentPluginPublisherView,
	readAgentPluginStageView,
	readAgentPluginPackageInstallationResponse,
	readAgentPluginPackageInstallationList,
	readAgentPluginAppBindingResponse,
} from '../../../packages/shared/src/agent/plugins/http-codec';
import type { AgentPluginStage, AgentPluginInstallation } from '../../../packages/shared/src/agent/plugins/model';

export const testPluginRepositoryUrl = E2E_URLS.pluginRepositoryOrigin + '/catalog.json';

const repositoryUrl = testPluginRepositoryUrl;
const pinnedPackageIds = [
	'nexus.services.mcp',
	'nexus.services.acp',
	'nexus.tools.remote',
	'nexus.tools.browser',
	'nexus.tools.integrations',
	'nexus.tools.agent',
	'nexus.ui.chat',
	'nexus.agent',
];

export async function configureTestPluginRepository(request: APIRequestContext) {
	const settings = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/repositories' },
		readAgentPluginRepositorySettings,
	);
	if (settings.repositories.length !== 1 || settings.repositories[0].url !== repositoryUrl) {
		await requestAgentJson(
			request,
			{
				method: 'PUT',
				path: '/plugins/repositories',
				data: {
					expectedVersion: settings.version,
					repositories: [{ url: repositoryUrl }],
				},
			},
			readAgentPluginRepositorySettings,
		);
	}
	const catalog = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/remote/catalog?repositoryUrl=' + encodeURIComponent(repositoryUrl) },
		readAgentPluginCatalog,
	);
	return catalog;
}

export async function stageTestPlugin(
	request: APIRequestContext,
	definitionId: string,
	version?: string,
): Promise<AgentPluginStage> {
	const catalog = await configureTestPluginRepository(request);
	const requestedVersion = version ?? (pinnedPackageIds.includes(definitionId) ? null : '1.0.0');
	const entry = catalog.packages.find(
		(item) =>
			item.packageId === definitionId &&
			(requestedVersion === null ? item.compatible : item.version === requestedVersion),
	);
	if (!entry) {
		throw new Error('Controlled plugin package is missing');
	}
	expect(entry.compatible).toBe(true);
	const publisher = catalog.publishers.find((item) => item.keyId === entry.publisherKeyId);
	if (!publisher) {
		throw new Error('Controlled plugin publisher is missing');
	}
	const publishers = await requestAgentJson(request, { method: 'GET', path: '/plugins/publishers' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginPublisherView),
	);
	if (!publishers.items.some((item) => item.keyId === publisher.keyId && item.revokedAt === null)) {
		const trusted = await requestAgentJson(
			request,
			{
				method: 'POST',
				path: '/plugins/publishers',
				data: { label: publisher.label, publicKeyPem: publisher.publicKeyPem },
			},
			readAgentPluginPublisherView,
		);
		expect(trusted.keyId).toBe(publisher.keyId);
	}
	const verified = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/remote/stage',
			data: {
				repositoryUrl,
				packageId: definitionId,
				publisherKeyId: entry.publisherKeyId,
				version: entry.version,
			},
		},
		readAgentPluginStageView,
	);
	expect(['verified', 'installed']).toContain(verified.status);
	expect(verified.manifest).toMatchObject({ id: definitionId, version: entry.version });
	expect(verified.publisherKeyId).toBe(publisher.keyId);
	return verified;
}

export async function getPluginInstallation(
	request: APIRequestContext,
	appId: string,
): Promise<AgentPluginInstallation> {
	const values = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/installations' },
		readAgentPluginInstallationList,
	);
	const installation = values.items.find((item) => item.appId === appId);
	if (!installation) throw new Error('Expected actual App installation: ' + appId);
	return installation;
}

export async function installTestPlugin(
	request: APIRequestContext,
	definitionId: string,
	version?: string,
): Promise<AgentPluginInstallation> {
	for (const packageId of pinnedPackageIds) {
		if (packageId === definitionId) continue;
		const installed = await requestAgentJson(
			request,
			{ method: 'GET', path: '/plugins/packages' },
			readAgentPluginPackageInstallationList,
		);
		if (installed.installations.some((entry) => entry.packageId === packageId && entry.status === 'installed'))
			continue;
		const catalog = await configureTestPluginRepository(request);
		const candidate = catalog.packages.find((entry) => entry.packageId === packageId && entry.compatible);
		if (!candidate) throw new Error('Controlled dependency package is missing: ' + packageId);
		const dependency = await stageTestPlugin(request, packageId, candidate.version);
		await requestAgentJson(
			request,
			{
				method: 'POST',
				path: '/plugins/packages/install',
				data: { stageId: dependency.id, expectedVersion: dependency.version },
			},
			readAgentPluginPackageInstallationResponse,
		);
	}
	const verified = await stageTestPlugin(request, definitionId, version);
	const manifest = verified.manifest;
	if (!manifest) throw new Error('Verified plugin stage is missing its manifest');
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/packages/install',
			data: { stageId: verified.id, expectedVersion: verified.version },
		},
		readAgentPluginPackageInstallationResponse,
	);
	const { binding } = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/apps/compose',
			data: {
				packageId: definitionId,
				selectedRootIds:
					manifest.contributions.app?.uiContract === 'nexus.ui.chat'
						? pinnedPackageIds.filter(
								(id) => id !== 'nexus.agent' && id !== 'nexus.ui.chat' && id !== definitionId,
							)
						: [],
				uiPackageId: manifest.contributions.ui
					? definitionId
					: manifest.contributions.app?.uiContract === 'nexus.ui.chat'
						? 'nexus.ui.chat'
						: null,
			},
		},
		readAgentPluginAppBindingResponse,
	);
	return getPluginInstallation(request, binding.appId);
}
