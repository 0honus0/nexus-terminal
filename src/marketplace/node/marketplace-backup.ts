import { alg } from '@dagrejs/graphlib';
import { isDeepStrictEqual } from 'node:util';
import satisfies from 'semver/functions/satisfies.js';
import type { BackupPackage } from '../../backup/backup-types.js';
import {
	buildPluginDependencyGraph,
	checkPluginEnvironment,
	readPluginEnvironment,
} from '../../plugin/plugin-api.node.js';
import { CodedError } from '../../utils/error.js';
import type {
	MarketplaceCatalogPlugin,
	MarketplaceRepository,
	PluginDistribution,
} from '../marketplace-catalog-types.js';
import type { MarketplaceInstallStep, MarketplaceRepositorySource } from '../marketplace-install-types.js';
import { selectDistribution } from './marketplace-artifacts.js';
import type { InstalledPackage } from './marketplace-install-planner.js';
import type { InstalledPlugin } from './marketplace-storage.js';

export interface BackupOwner {
	readonly pluginId: string;
	readonly pluginVersion: string;
}

type BackupInstallStep = MarketplaceInstallStep & {
	readonly action: 'install';
	readonly source: MarketplaceRepositorySource;
	readonly repository: MarketplaceRepository;
	readonly distribution: PluginDistribution;
};

export interface MarketplaceBackupPlan {
	readonly present: readonly InstalledPlugin[];
	readonly installs: readonly { readonly step: BackupInstallStep; readonly enabled: boolean }[];
}

export function planBackupPackages(
	owners: readonly BackupOwner[],
	packages: readonly BackupPackage[],
	installed: readonly InstalledPackage[],
	repositories: readonly MarketplaceRepository[],
	catalog: readonly MarketplaceCatalogPlugin[],
): MarketplaceBackupPlan {
	const metadata = new Map(packages.map((item) => [item.pluginId, item]));
	const local = new Map(installed.map((item) => [item.record.pluginId, item]));
	const present = new Map<string, InstalledPlugin>();
	const installs = new Map<string, MarketplaceBackupPlan['installs'][number]>();
	const env = readPluginEnvironment();
	const remaining = [...owners];
	const checked = new Map<string, { id: string; version: string; dependsOn: BackupPackage['dependsOn'] }>();

	while (remaining.length) {
		const { pluginId, pluginVersion } = remaining.pop()!;
		const saved = metadata.get(pluginId);
		const current = local.get(pluginId);
		const previous = checked.get(pluginId);
		if (previous) {
			if (previous.version !== pluginVersion) throw new CodedError('BACKUP_PLUGIN_VERSION_CONFLICT');
			continue;
		}

		let dependsOn: BackupPackage['dependsOn'];
		if (current) {
			const { record, manifest } = current;
			if (
				record.version !== pluginVersion ||
				!manifest ||
				(saved && !isDeepStrictEqual(manifest.nexus.dependsOn ?? {}, saved.dependsOn))
			)
				throw new CodedError('BACKUP_PLUGIN_VERSION_CONFLICT');
			const source = repositories.find(({ id }) => id === record.repositoryId);
			if (source && saved?.repositoryUrl && source.url !== saved.repositoryUrl)
				throw new CodedError('BACKUP_PLUGIN_SOURCE_UNAVAILABLE');

			present.set(pluginId, record);
			// 旧归档只有所属插件版本。现有机器仍按原流程暂停和恢复。
			dependsOn = saved?.dependsOn ?? {};
		} else {
			// 归档中的 URL 只匹配目标已登记的来源，不能自行新增仓库或下载地址。
			const repository = repositories.find(({ url }) => url === saved?.repositoryUrl);
			const artifact =
				repository &&
				catalog
					.find(({ id }) => id === pluginId)
					?.versions.find(
						(item) => item.repositoryId === repository.id && item.package.version === pluginVersion,
					);
			if (!saved || !repository || !artifact) throw new CodedError('BACKUP_PLUGIN_SOURCE_UNAVAILABLE');

			const manifest = artifact.package;
			dependsOn = manifest.nexus.dependsOn ?? {};
			const { distribution } = selectDistribution(artifact.distributions, env);
			if (
				!distribution ||
				checkPluginEnvironment(manifest, env) ||
				!isDeepStrictEqual(dependsOn, saved.dependsOn)
			)
				throw new CodedError('BACKUP_PLUGIN_ARTIFACT_UNAVAILABLE');

			installs.set(pluginId, {
				enabled: saved.enabled,
				step: {
					action: 'install',
					package: manifest,
					source: { kind: 'repository', repositoryId: repository.id, pluginId, version: pluginVersion },
					repository,
					distribution,
				},
			});
		}

		checked.set(pluginId, { id: pluginId, version: pluginVersion, dependsOn });
		for (const [dependency, range] of Object.entries(dependsOn)) {
			const version = metadata.get(dependency)?.pluginVersion ?? local.get(dependency)?.record.version;
			if (!version || !satisfies(version, range)) throw new CodedError('BACKUP_PLUGIN_DEPENDENCY_UNAVAILABLE');
			remaining.push({ pluginId: dependency, pluginVersion: version });
		}
	}

	const graph = buildPluginDependencyGraph(checked.values());
	if (!alg.isAcyclic(graph)) throw new CodedError('BACKUP_PLUGIN_DEPENDENCY_UNAVAILABLE');

	return {
		present: [...present.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId)),
		installs: alg.topsort(graph).flatMap((id) => installs.get(id) ?? []),
	};
}
