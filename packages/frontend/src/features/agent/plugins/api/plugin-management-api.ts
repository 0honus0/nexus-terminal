import {
	readAgentPluginPackageUpdatePreparation,
	readAgentPluginPackageUpdate,
	readAgentPluginPackageUpdateCancellation,
} from '@nexus-terminal/shared/agent/plugins/package-update-http-codec';
import {
	readAgentPluginRecommendedInstallRequest,
	readAgentPluginRecommendedInstallResponse,
} from '@nexus-terminal/shared/agent/plugins/recommended-install-codec';
import {
	readAgentPluginInstallPlan,
	readAgentPluginInstallPlanRequest,
	readAgentPluginInstallPlanResponse,
} from '@nexus-terminal/shared/agent/plugins/install-plan-codec';
import type {
	PluginInstallPlan,
	PluginInstallPlanResult,
	PluginPreparedStage,
} from '../model/plugin-install-plan-types';
import { fromPluginInstallPlan, fromPluginInstallPlanResult } from '../model/plugin-install-plan-mapper';
import { readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginPackageInstallationList,
	readAgentPluginPackageRetirement,
	readAgentPluginPackageInstallationResponse,
	readAgentPluginAppBindingList,
	readAgentPluginInstallation,
	readAgentPluginInstallationList,
	readAgentPluginItems,
	readAgentPluginPublisher,
	readAgentPluginPublisherView,
	readAgentPluginRetirement,
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
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import type {
	PluginPackageInstallation,
	PluginPackageDirectory,
	PluginPackageUpdatePreparation,
	PluginAppBinding,
	PluginCatalog,
	PluginCatalogEntry,
	PluginInstallation,
	PluginInstallationDirectory,
	PluginPublisher,
	PluginRecommendation,
	PluginRepositories,
	PluginVersion,
} from '../model/plugin-types';
import {
	fromPluginCatalog,
	fromPluginPackageInstallation,
	fromPluginPackageUpdatePreparation,
	fromPluginAppBinding,
	fromPluginInstallation,
	fromPluginPublisher,
	fromPluginRecommendation,
	fromPluginRepositories,
	fromPluginVersion,
} from '../model/plugin-mapper';
import { AgentManagementFailure } from '../../model/management-failure';
import { requestAgentManagement } from '../../api/management-request';

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

export async function listPluginInstallations(signal?: AbortSignal): Promise<PluginInstallationDirectory> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: '/plugins/installations',
		signal,

		decode: readAgentPluginInstallationList,
	});
	return {
		installations: value.items.map(fromPluginInstallation),
		retainedAppIds: value.retainedAppIds.map((id) => id),
	};
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

export async function listPluginPackageInstallations(signal?: AbortSignal): Promise<PluginPackageDirectory> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: '/plugins/packages',
		signal,
		decode: readAgentPluginPackageInstallationList,
	});
	return {
		installations: value.installations.map(fromPluginPackageInstallation),
		retainedPackageIds: value.retainedPackageIds.map((id) => id),
	};
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

function samePackageIdentity(left: PluginPackageInstallation, right: PluginPackageInstallation): boolean {
	return (
		left.packageId === right.packageId &&
		left.version === right.version &&
		left.packageHash === right.packageHash &&
		left.publisherKeyId === right.publisherKeyId
	);
}

function assertUpdateTarget(original: PluginPackageInstallation, stage: PluginPreparedStage): void {
	if (original.packageId !== stage.manifest.id || original.publisherKeyId !== stage.publisherKeyId) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched');
	}
}

export async function preparePluginPackageUpdate(
	original: PluginPackageInstallation,
	stage: PluginPreparedStage,
	signal?: AbortSignal,
): Promise<PluginPackageUpdatePreparation> {
	assertUpdateTarget(original, stage);
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: '/plugins/packages/' + encodeURIComponent(original.packageId) + '/prepare-update',
		signal,

		input: () =>
			readAgentPluginUpgrade({
				expectedRevision: original.revision,
				stageId: stage.id,
				expectedStageVersion: stage.version,
			}),

		decode(raw) {
			const prepared = readAgentPluginPackageUpdatePreparation(raw, original.packageId);
			const item = fromPluginPackageInstallation(prepared.installation);
			if (!samePackageIdentity(item, original) || item.revision < original.revision)
				throw new Error('Package update preparation mismatch');
			return prepared;
		},
	});
	return fromPluginPackageUpdatePreparation(value);
}

export async function updatePluginPackage(
	prepared: PluginPackageUpdatePreparation,
	stage: PluginPreparedStage,
	signal?: AbortSignal,
): Promise<PluginPackageInstallation> {
	const original = prepared.installation;
	assertUpdateTarget(original, stage);
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: '/plugins/packages/' + encodeURIComponent(original.packageId) + '/update',
		signal,

		input: () =>
			readAgentPluginPackageUpdate({
				expectedRevision: original.revision,
				stageId: stage.id,
				expectedStageVersion: stage.version,
				dependencies: prepared.dependencies.map((item) => ({
					package: {
						packageId: item.package.packageId,
						version: item.package.version,
						packageHash: item.package.packageHash,
						publisherKeyId: item.package.publisherKeyId,
					},
					installationRevision: item.installationRevision,
				})),
			}),

		decode(raw) {
			const item = readAgentPluginPackageInstallationResponse(raw).installation;
			if (
				item.packageId !== stage.manifest.id ||
				item.version !== stage.manifest.version ||
				item.packageHash !== stage.packageHash ||
				item.publisherKeyId !== stage.publisherKeyId ||
				item.revision <= original.revision ||
				item.status !== 'installed'
			)
				throw new Error('Package update confirmation mismatch');
			return item;
		},
	});
	return fromPluginPackageInstallation(value);
}

export async function cancelPluginPackageUpdate(
	original: PluginPackageInstallation,
	signal?: AbortSignal,
): Promise<PluginPackageInstallation> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: '/plugins/packages/' + encodeURIComponent(original.packageId) + '/cancel-update',
		signal,

		input: () => readAgentPluginPackageUpdateCancellation({ expectedRevision: original.revision }),

		decode(raw) {
			const item = fromPluginPackageInstallation(readAgentPluginPackageInstallationResponse(raw).installation);
			if (
				!samePackageIdentity(item, original) ||
				item.revision <= original.revision ||
				item.status !== 'installed'
			)
				throw new Error('Package update cancellation mismatch');
			return item;
		},
	});
	return value;
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

export async function listPluginAppBindings(signal?: AbortSignal): Promise<PluginAppBinding[]> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: '/plugins/apps/bindings',
		signal,
		decode: readAgentPluginAppBindingList,
	});
	return value.bindings.map(fromPluginAppBinding);
}

export async function retirePluginPackage(
	original: PluginPackageInstallation,
	clearData: boolean,
	signal?: AbortSignal,
): Promise<PluginPackageInstallation> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'DELETE',
		path: '/plugins/packages/' + encodeURIComponent(original.packageId),
		signal,

		input: () => readAgentPluginPackageRetirement({ expectedRevision: original.revision, clearData }),

		decode(result) {
			const response = readAgentPluginPackageInstallationResponse(result);
			const item = response.installation;
			if (
				item.packageId !== original.packageId ||
				item.publisherKeyId !== original.publisherKeyId ||
				item.packageHash !== original.packageHash ||
				item.revision <= original.revision ||
				item.status !== 'removed'
			)
				throw new Error('Package removal confirmation mismatch');
			return item;
		},
	});
	return fromPluginPackageInstallation(value);
}

export async function preparePluginInstallPlan(
	entry: PluginCatalogEntry,
	repositoryUrl: string | null,
	signal?: AbortSignal,
): Promise<PluginInstallPlan> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: repositoryUrl === null ? '/plugins/official/prepare' : '/plugins/remote/prepare',
		signal,

		input: () =>
			repositoryUrl === null
				? readAgentPluginOfficialStage({
						packageId: entry.definitionId,
						publisherKeyId: entry.publisherKeyId,
						version: entry.version,
					})
				: readAgentPluginRepositoryStage({
						repositoryUrl,
						packageId: entry.definitionId,
						publisherKeyId: entry.publisherKeyId,
						version: entry.version,
					}),

		decode(result) {
			const plan = readAgentPluginInstallPlan(result);
			const stage = plan.target.stage;
			if (
				stage.manifest.id !== entry.definitionId ||
				stage.publisherKeyId !== entry.publisherKeyId ||
				stage.manifest.version !== entry.version ||
				stage.packageHash !== entry.sha256 ||
				stage.sizeBytes !== entry.sizeBytes ||
				(repositoryUrl !== null && plan.target.repositoryUrl !== readAgentPluginRepositoryUrl(repositoryUrl))
			)
				throw new Error('Prepared install plan mismatch');
			return plan;
		},
	});
	return fromPluginInstallPlan(value);
}

export async function executePluginInstallPlan(
	plan: PluginInstallPlan,
	signal?: AbortSignal,
	initialization: 'disabled' | 'declared_grants' = 'disabled',
): Promise<PluginInstallPlanResult> {
	const target = plan.target.stage;
	const input = readAgentPluginInstallPlanRequest({
		initialization,
		repositoryVersion: plan.repositoryVersion,
		target: {
			repositoryUrl: plan.target.repositoryUrl,
			stageId: target.id,
			expectedVersion: target.version,
			expectedInstallationRevision: plan.target.expectedInstallationRevision,
			package: {
				packageId: target.manifest.id,
				version: target.manifest.version,
				packageHash: target.packageHash,
				publisherKeyId: target.publisherKeyId,
			},
		},
		dependencies: plan.dependencies.map((dependency) =>
			dependency.kind === 'installed'
				? {
						kind: 'installed',
						expectedRevision: dependency.installation.revision,
						package: {
							packageId: dependency.installation.packageId,
							version: dependency.installation.version,
							packageHash: dependency.installation.packageHash,
							publisherKeyId: dependency.installation.publisherKeyId,
						},
					}
				: {
						kind: 'staged',
						repositoryUrl: dependency.repositoryUrl,
						stageId: dependency.stage.id,
						expectedVersion: dependency.stage.version,
						expectedInstallationRevision: dependency.expectedInstallationRevision,
						package: {
							packageId: dependency.stage.manifest.id,
							version: dependency.stage.manifest.version,
							packageHash: dependency.stage.packageHash,
							publisherKeyId: dependency.stage.publisherKeyId,
						},
					},
		),
	});
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: initialization === 'declared_grants' ? '/onboarding/recommended-plugin/install' : '/plugins/install-plan',
		signal,

		input: () =>
			initialization === 'declared_grants'
				? readAgentPluginRecommendedInstallRequest({ kind: 'plan', plan: input })
				: input,

		decode(raw) {
			const result =
				initialization === 'declared_grants'
					? (() => {
							const response = readAgentPluginRecommendedInstallResponse(raw);
							if (response.kind !== 'installed')
								throw new Error('Recommended installation result mismatch');
							return response.result;
						})()
					: readAgentPluginInstallPlanResponse(raw);
			const installed = result.installation;
			if (
				installed.packageId !== input.target.package.packageId ||
				installed.publisherKeyId !== input.target.package.publisherKeyId ||
				installed.version !== input.target.package.version ||
				installed.packageHash !== input.target.package.packageHash ||
				installed.status !== 'installed'
			)
				throw new Error('Installed plan result mismatch');
			return result;
		},
	});
	return fromPluginInstallPlanResult(value);
}
