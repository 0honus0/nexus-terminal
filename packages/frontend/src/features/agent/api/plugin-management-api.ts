import { agentRecord, readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginInstall,
	readAgentPluginInstallation,
	readAgentPluginItems,
	readAgentPluginPublisher,
	readAgentPluginPublisherView,
	readAgentPluginRetirement,
	readAgentPluginStageView,
	readAgentPluginUpgrade,
	readAgentPluginVersion,
	readAgentPluginVersionView,
} from '@nexus-terminal/shared/agent/plugins/http-codec';
import {
	readAgentPluginCatalog,
	readAgentPluginOfficialStage,
	readAgentPluginRecommended,
	readAgentPluginRepositorySettings,
	readAgentPluginRepositoryStage,
	readAgentPluginRepositoryUpdate,
	readAgentPluginRepositoryUrl,
} from '@nexus-terminal/shared/agent/plugins/repository-http-codec';
import {
	readAgentPluginRuntimeAcknowledgement,
	readAgentPluginRuntimeAcknowledged,
	readAgentPluginRuntimeObservation,
} from '@nexus-terminal/shared/agent/plugins/runtime-http-codec';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import type {
	PluginCatalog,
	PluginCatalogEntry,
	PluginInstallation,
	PluginPublisher,
	PluginRecommendation,
	PluginRepositories,
	PluginRuntime,
	PluginStage,
	PluginVersion,
} from '../model/plugin-types';
import {
	fromPluginCatalog,
	fromPluginInstallation,
	fromPluginPublisher,
	fromPluginRecommendation,
	fromPluginRepositories,
	fromPluginRuntime,
	fromPluginStage,
	fromPluginVersion,
} from '../model/plugin-mapper';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

const budgets = { maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES, maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES };

function installationPath(appId: string): string {
	try {
		return '/plugins/installations/' + encodeURIComponent(readAgentId(appId));
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

export async function listPluginPublishers(signal?: AbortSignal): Promise<PluginPublisher[]> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: '/plugins/publishers',
		signal,

		decode: (value) => readAgentPluginItems(value, readAgentPluginPublisherView),
	});
	return value.items.map(fromPluginPublisher);
}

export async function trustPluginPublisher(
	label: string,
	publicKeyPem: string,
	signal?: AbortSignal,
): Promise<PluginPublisher> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: '/plugins/publishers',
		signal,

		input: () => readAgentPluginPublisher({ label, publicKeyPem }),

		decode(value) {
			const publisher = readAgentPluginPublisherView(value);
			if (publisher.label !== label || publisher.revokedAt !== null) {
				throw new Error('Publisher confirmation mismatch');
			}
			return publisher;
		},
	});
	return fromPluginPublisher(value);
}

export async function revokePluginPublisher(original: PluginPublisher, signal?: AbortSignal): Promise<PluginPublisher> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'DELETE',
		path: '/plugins/publishers/' + encodeURIComponent(original.keyId),
		signal,

		input() {
			return { expectedVersion: readAgentPluginVersion({ expectedVersion: original.version }) };
		},

		decode(value) {
			const publisher = readAgentPluginPublisherView(value);
			if (
				publisher.keyId !== original.keyId ||
				publisher.version !== original.version + 1 ||
				publisher.revokedAt === null
			) {
				throw new Error('Publisher revocation confirmation mismatch');
			}
			return publisher;
		},
	});
	return fromPluginPublisher(value);
}

export async function listPluginInstallations(signal?: AbortSignal): Promise<PluginInstallation[]> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: '/plugins/installations',
		signal,

		decode: (value) => readAgentPluginItems(value, readAgentPluginInstallation),
	});
	return value.items.map(fromPluginInstallation);
}

export async function listPluginStages(signal?: AbortSignal): Promise<PluginStage[]> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: '/plugins/stages',
		signal,

		decode: (value) => readAgentPluginItems(value, readAgentPluginStageView),
	});
	return value.items.map(fromPluginStage);
}

export async function listPluginVersions(signal?: AbortSignal): Promise<PluginVersion[]> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: '/plugins/versions',
		signal,

		decode: (value) => readAgentPluginItems(value, readAgentPluginVersionView),
	});
	return value.items.map(fromPluginVersion);
}

export async function verifyPluginStage(original: PluginStage, signal?: AbortSignal): Promise<PluginStage> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: '/plugins/verify',
		signal,

		input: () => readAgentPluginInstall({ stageId: original.id, expectedVersion: original.version }),

		decode(value) {
			const stage = readAgentPluginStageView(value);
			if (
				stage.id !== original.id ||
				stage.version <= original.version ||
				stage.status !== 'verified' ||
				stage.packageHash !== original.packageHash
			) {
				throw new Error('Plugin verification confirmation mismatch');
			}
			return stage;
		},
	});
	return fromPluginStage(value);
}

export async function installPluginStage(original: PluginStage, signal?: AbortSignal): Promise<PluginInstallation> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: '/plugins/install',
		signal,

		input: () => readAgentPluginInstall({ stageId: original.id, expectedVersion: original.version }),

		decode(value) {
			const item = readAgentPluginInstallation(value);
			if (
				item.packageHash !== original.packageHash ||
				item.definitionId !== original.manifest?.id ||
				item.status !== 'installed'
			) {
				throw new Error('Plugin installation confirmation mismatch');
			}
			return item;
		},
	});
	return fromPluginInstallation(value);
}

export async function retirePluginInstallation(
	original: PluginInstallation,
	cancel: boolean,
	signal?: AbortSignal,
): Promise<PluginInstallation> {
	const value = await requestAgentManagement({
		...budgets,
		method: cancel ? 'POST' : 'DELETE',
		path: installationPath(original.appId) + (cancel ? '/cancel-retirement' : ''),
		signal,

		input: () => readAgentPluginRetirement({ expectedRevision: original.revision }),

		decode(value) {
			const item = readAgentPluginInstallation(value);
			if (
				item.appId !== original.appId ||
				item.revision < original.revision ||
				item.packageHash !== original.packageHash ||
				(cancel && item.status !== 'installed') ||
				(!cancel && item.status === 'installed')
			) {
				throw new Error('Plugin retirement confirmation mismatch');
			}
			return item;
		},
	});
	return fromPluginInstallation(value);
}

export async function upgradePluginInstallation(
	original: PluginInstallation,
	stage: PluginStage,
	prepare: boolean,
	signal?: AbortSignal,
): Promise<PluginInstallation> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: installationPath(original.appId) + (prepare ? '/prepare-upgrade' : '/upgrade'),
		signal,

		input: () =>
			readAgentPluginUpgrade({
				expectedRevision: original.revision,
				stageId: stage.id,
				expectedStageVersion: stage.version,
			}),

		decode(value) {
			const item = readAgentPluginInstallation(value);
			if (
				item.appId !== original.appId ||
				item.definitionId !== original.definitionId ||
				item.revision < original.revision ||
				(prepare
					? item.status !== 'draining' || item.packageHash !== original.packageHash
					: item.status !== 'installed' || item.packageHash !== stage.packageHash)
			) {
				throw new Error('Plugin upgrade confirmation mismatch');
			}
			return item;
		},
	});
	return fromPluginInstallation(value);
}

export async function getPluginRepositories(signal?: AbortSignal): Promise<PluginRepositories> {
	return fromPluginRepositories(
		await requestAgentManagement({
			...budgets,
			method: 'GET',
			path: '/plugins/repositories',
			decode: readAgentPluginRepositorySettings,
			signal,
		}),
	);
}

export async function updatePluginRepositories(
	original: PluginRepositories,
	urls: string[],
	signal?: AbortSignal,
): Promise<PluginRepositories> {
	let expected: string[] = [];
	const value = await requestAgentManagement({
		...budgets,
		method: 'PUT',
		path: '/plugins/repositories',
		signal,

		input() {
			const input = readAgentPluginRepositoryUpdate({
				expectedVersion: original.version,
				repositories: urls.map((url) => ({ url })),
			});
			expected = input.repositories.map((item) => item.url);
			return input;
		},

		decode(value) {
			const item = readAgentPluginRepositorySettings(value);
			if (
				item.version !== original.version + 1 ||
				JSON.stringify(item.repositories.map((entry) => entry.url)) !== JSON.stringify(expected)
			) {
				throw new Error('Repository update confirmation mismatch');
			}
			return item;
		},
	});
	return fromPluginRepositories(value);
}

export async function getPluginCatalog(repositoryUrl: string | null, signal?: AbortSignal): Promise<PluginCatalog> {
	let normalized: string | null = null;
	try {
		normalized = repositoryUrl === null ? null : readAgentPluginRepositoryUrl(repositoryUrl);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path:
			normalized === null
				? '/plugins/official/catalog'
				: '/plugins/remote/catalog?' + new URLSearchParams({ repositoryUrl: normalized }),
		signal,

		decode(value) {
			const catalog = readAgentPluginCatalog(value);
			if (normalized !== null && catalog.repositoryUrl !== normalized) {
				throw new Error('Catalog source mismatch');
			}
			return catalog;
		},
	});
	return fromPluginCatalog(value);
}

export async function stagePluginCatalogEntry(
	entry: PluginCatalogEntry,
	repositoryUrl: string | null,
	signal?: AbortSignal,
): Promise<PluginStage> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: repositoryUrl === null ? '/plugins/official/stage' : '/plugins/remote/stage',
		signal,

		input: () =>
			repositoryUrl === null
				? readAgentPluginOfficialStage({ appId: entry.definitionId, version: entry.version })
				: readAgentPluginRepositoryStage({ repositoryUrl, appId: entry.definitionId, version: entry.version }),

		decode(value) {
			const stage = readAgentPluginStageView(value);
			if (
				stage.packageHash !== entry.sha256 ||
				stage.sizeBytes !== entry.sizeBytes ||
				stage.status !== 'verified' ||
				stage.manifest?.id !== entry.definitionId ||
				stage.manifest.version !== entry.version ||
				stage.publisherKeyId !== entry.publisherKeyId
			) {
				throw new Error('Catalog stage confirmation mismatch');
			}
			return stage;
		},
	});
	return fromPluginStage(value);
}

export async function getPluginRecommendation(signal?: AbortSignal): Promise<PluginRecommendation> {
	return fromPluginRecommendation(
		await requestAgentManagement({
			...budgets,
			method: 'GET',
			path: '/onboarding/recommended-plugin',
			decode: readAgentPluginRecommended,
			signal,
		}),
	);
}

export async function installRecommendedPlugin(signal?: AbortSignal): Promise<PluginInstallation> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: '/onboarding/recommended-plugin/install',
		signal,

		input() {
			return agentRecord({}, []);
		},

		decode: readAgentPluginInstallation,
	});
	return fromPluginInstallation(value);
}

export async function getPluginRuntime(
	appId: string,
	instanceId: string | null,
	signal?: AbortSignal,
): Promise<PluginRuntime | null> {
	let suffix = '';
	try {
		if (instanceId !== null) {
			suffix = '/' + encodeURIComponent(readAgentId(instanceId));
		}
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: installationPath(appId) + '/runtime' + suffix,
		signal,

		decode(value) {
			const item = readAgentPluginRuntimeObservation(value, appId);
			if (item && instanceId !== null && item.instanceId !== instanceId) {
				throw new Error('Runtime instance mismatch');
			}
			return item;
		},
	});
	return value === null ? null : fromPluginRuntime(value);
}

export async function acknowledgePluginRuntime(
	installation: PluginInstallation,
	original: PluginRuntime,
	signal?: AbortSignal,
): Promise<PluginRuntime> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: installationPath(installation.appId) + '/runtime/acknowledge',
		signal,

		input: () =>
			readAgentPluginRuntimeAcknowledgement({
				expectedRevision: installation.revision,
				instanceRevision: original.revision,
				instanceId: original.instanceId,
				confirmed: true,
			}),

		decode: (value) =>
			readAgentPluginRuntimeAcknowledged(value, installation.appId, {
				expectedRevision: installation.revision,
				instanceRevision: original.revision,
				instanceId: original.instanceId,
				confirmed: true,
			}),
	});
	return fromPluginRuntime(value);
}
