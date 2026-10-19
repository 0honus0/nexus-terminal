import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { requestAgentJson } from './agent';
import { E2E_URLS } from './test-env';
import {
	readAgentPluginRepositorySettings,
	readAgentPluginCatalog,
} from '../../../packages/shared/src/agent/plugins/repository-http-codec';
import {
	readAgentPluginItems,
	readAgentPluginPublisherView,
	readAgentPluginStageView,
	readAgentPluginInstallation,
} from '../../../packages/shared/src/agent/plugins/http-codec';
import type { AgentPluginStage, AgentPluginInstallation } from '../../../packages/shared/src/agent/plugins/model';

export const testPluginRepositoryUrl = E2E_URLS.pluginRepositoryOrigin + '/catalog.json';

const repositoryUrl = testPluginRepositoryUrl;

export async function configureTestPluginRepository(request: APIRequestContext) {
	const settings = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/repositories' },
		readAgentPluginRepositorySettings,
	);
	if (!settings.repositories.some((entry) => entry.url === repositoryUrl)) {
		await requestAgentJson(
			request,
			{
				method: 'PUT',
				path: '/plugins/repositories',
				data: {
					expectedVersion: settings.version,
					repositories: settings.repositories
						.map((entry) => ({ url: entry.url }))
						.concat({ url: repositoryUrl }),
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
	version = '1.0.0',
): Promise<AgentPluginStage> {
	const catalog = await configureTestPluginRepository(request);
	const entry = catalog.packages.find((item) => item.appId === definitionId && item.version === version);
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
		{ method: 'POST', path: '/plugins/remote/stage', data: { repositoryUrl, appId: definitionId, version } },
		readAgentPluginStageView,
	);
	expect(verified.status).toBe('verified');
	expect(verified.manifest).toMatchObject({ id: definitionId, version });
	expect(verified.publisherKeyId).toBe(publisher.keyId);
	return verified;
}

export async function installTestPlugin(
	request: APIRequestContext,
	definitionId: string,
	version = '1.0.0',
): Promise<AgentPluginInstallation> {
	const verified = await stageTestPlugin(request, definitionId, version);
	return requestAgentJson(
		request,
		{ method: 'POST', path: '/plugins/install', data: { stageId: verified.id, expectedVersion: verified.version } },
		readAgentPluginInstallation,
	);
}
