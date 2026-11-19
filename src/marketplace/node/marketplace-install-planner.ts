import { createHash } from 'node:crypto';
import { alg } from '@dagrejs/graphlib';
import { rcompare, satisfies } from 'semver';
import {
	buildPluginDependencyGraph,
	checkPluginEnvironment,
	readPluginEnvironment,
	type PluginEnvironment,
} from '../../plugin/plugin-api.node.js';
import type { PluginManifest } from '../../plugin/plugin-manifest-types.js';
import type {
	MarketplaceCatalogPlugin,
	MarketplaceRepository,
	PluginDistribution,
} from '../marketplace-catalog-types.js';
import type {
	MarketplaceInstallIssue,
	MarketplaceInstallPlan,
	MarketplaceInstallSource,
	MarketplaceInstallStep,
	MarketplaceRepositorySource,
} from '../marketplace-install-types.js';
import { selectDistribution } from './marketplace-artifacts.js';
import { installedSource, type InstalledPlugin } from './marketplace-storage.js';

export interface InstalledPackage {
	readonly record: InstalledPlugin;
	readonly manifest: PluginManifest | undefined;
}

interface Candidate {
	readonly manifest: PluginManifest;
	readonly source: MarketplaceInstallSource;
	readonly repository?: MarketplaceRepository;
	readonly distribution?: PluginDistribution;
	readonly issue?: MarketplaceInstallIssue;
}

interface Requirement {
	id: string;
	range: string;
	companionFor?: string;
}

function satisfiesRequirement(candidate: Candidate, { range, companionFor }: Requirement): boolean {
	const { version, nexus } = candidate.manifest;
	return satisfies(version, range) && (!companionFor || !!nexus.requiredFor?.includes(companionFor));
}

function indexCandidates(
	catalog: readonly MarketplaceCatalogPlugin[],
	repositories: readonly MarketplaceRepository[],
	environment: PluginEnvironment,
): Map<string, Candidate[]> {
	const sources = new Map(repositories.map((repository) => [repository.id, repository]));
	return new Map(
		catalog.map(({ id, versions }) => {
			const candidates: Candidate[] = [];
			for (const { package: manifest, repositoryId, distributions } of versions) {
				const repository = sources.get(repositoryId);
				if (!repository) continue;

				const { distribution, code } = selectDistribution(distributions, environment);
				const source: MarketplaceRepositorySource = {
					kind: 'repository',
					repositoryId,
					pluginId: id,
					version: manifest.version,
				};
				const required = manifest.peerDependencies['nexus-terminal'];
				const unsupported = checkPluginEnvironment(manifest, environment);
				const issue: MarketplaceInstallIssue | undefined =
					unsupported === 'PLUGIN_SDK_INCOMPATIBLE'
						? { code: 'PLUGIN_SDK_INCOMPATIBLE', pluginId: id, required }
						: unsupported
							? { code: 'PLUGIN_ARTIFACT_UNAVAILABLE', pluginId: id }
							: code && { code, pluginId: id };
				candidates.push({ manifest, source, repository, distribution, issue });
			}
			return [id, candidates.sort((a, b) => rcompare(a.manifest.version, b.manifest.version))];
		}),
	);
}

function indexCompanions(
	catalog: ReadonlyMap<string, Candidate[]>,
	installed: ReadonlyMap<string, InstalledPackage>,
): Map<string, Set<string>> {
	const index = new Map<string, Set<string>>();
	const manifests = [
		...[...catalog.values()].flatMap((candidates) => candidates.map(({ manifest }) => manifest)),
		...[...installed.values()].flatMap(({ manifest }) => (manifest ? [manifest] : [])),
	];
	for (const { name, nexus } of manifests) {
		for (const application of nexus.requiredFor ?? []) {
			if (application === name) continue;
			const companions = index.get(application) ?? new Set();
			companions.add(name);
			index.set(application, companions);
		}
	}
	return index;
}

function requirementsFor(
	chosen: ReadonlyMap<string, Candidate>,
	companions: ReadonlyMap<string, ReadonlySet<string>>,
): Requirement[] {
	const requirements: Requirement[] = [];
	for (const [
		id,
		{
			manifest: { nexus },
		},
	] of chosen) {
		for (const [dependency, range] of Object.entries(nexus.dependsOn ?? {})) {
			requirements.push({ id: dependency, range });
		}
		if (nexus.kind === 'application') {
			for (const companion of companions.get(id) ?? []) {
				// 配套包参与安装确认。运行时仍只根据 dependsOn 启动。
				requirements.push({ id: companion, range: '*', companionFor: id });
			}
		}
	}
	return requirements;
}

function selectDependency(
	target: MarketplaceRepositorySource,
	requirements: readonly Requirement[],
	remote: readonly Candidate[],
	existing: InstalledPackage | undefined,
	environment: PluginEnvironment,
): Candidate[] | MarketplaceInstallIssue {
	const [{ id }] = requirements;
	const required = requirements.map(({ range }) => range).join(' & ');

	const matches = (candidate: Candidate) =>
		requirements.every((requirement) => satisfiesRequirement(candidate, requirement));

	if (existing) {
		// 已安装记录目前只有本地来源。若不能复用，调用方须明确选择要替换的包。
		const { manifest } = existing;
		if (!manifest) return { code: 'MARKETPLACE_INSTALLED_PACKAGE_UNAVAILABLE', pluginId: id };
		const local: Candidate = { manifest, source: { kind: 'local' } };
		if (!matches(local))
			return { code: 'PLUGIN_DEPENDENCY_VERSION_MISMATCH', pluginId: id, required, actual: manifest.version };
		if (checkPluginEnvironment(manifest, environment)) return { code: 'PLUGIN_ARTIFACT_UNAVAILABLE', pluginId: id };
		return [local];
	}

	const matching = remote.filter(matches);
	const preferred = matching.filter(({ repository }) => repository?.id === target.repositoryId);
	const official = matching.filter(({ repository }) => repository?.official);
	const pool = preferred.length ? preferred : official.length ? official : matching;
	const sources = [...new Set(pool.map(({ repository }) => repository!.id))].sort();
	if (sources.length > 1) return { code: 'PLUGIN_SOURCE_AMBIGUOUS', pluginId: id, repositoryIds: sources };

	const compatible = pool.filter(({ issue }) => !issue);
	return compatible.length
		? compatible
		: (pool[0]?.issue ?? { code: 'PLUGIN_DEPENDENCY_MISSING', pluginId: id, required });
}

function installedConsumerIssue(
	chosen: ReadonlyMap<string, Candidate>,
	installed: ReadonlyMap<string, InstalledPackage>,
): MarketplaceInstallIssue | undefined {
	const replacesInstalled = [...chosen].some(([id, { source }]) => installed.has(id) && source.kind === 'repository');
	for (const [id, { manifest }] of installed) {
		if (chosen.has(id)) continue;
		if (!manifest && replacesInstalled) return { code: 'MARKETPLACE_INSTALLED_PACKAGE_UNAVAILABLE', pluginId: id };
		for (const [dependency, required] of Object.entries(manifest?.nexus.dependsOn ?? {})) {
			const candidate = chosen.get(dependency);
			const actual = candidate?.manifest.version;
			if (actual && !satisfies(actual, required))
				return { code: 'PLUGIN_DEPENDENCY_VERSION_MISMATCH', pluginId: dependency, required, actual };
		}
	}
}

export function affectedInstalled(owners: readonly string[], installed: Iterable<InstalledPackage>): string[] {
	const graph = buildPluginDependencyGraph(
		[...installed].map(({ record, manifest }) => ({
			id: record.pluginId,
			dependsOn: manifest?.nexus.dependsOn ?? {},
		})),
	);
	const roots = owners.filter((id) => graph.hasNode(id));
	const targets = new Set(owners);
	return alg
		.preorder(graph, roots)
		.filter((id) => !targets.has(id))
		.sort();
}

function installStep(candidate: Candidate, previous?: InstalledPackage): MarketplaceInstallStep {
	const { source, manifest, distribution, repository } = candidate;
	const record = previous?.record;
	return {
		package: manifest,
		source,
		...(distribution && { distribution }),
		...(repository && { repository }),
		action: !record ? 'install' : source.kind === 'local' ? 'reuse' : 'update',
		...(record && {
			previous: {
				source: installedSource(record),
				version: record.version,
				enabled: record.enabled,
				// 预览只返回不透明的本地基线。执行前还需重读安装记录和包。
				revision: createHash('sha256')
					.update(JSON.stringify([record.pluginId, record.version, record.directory, previous.manifest]))
					.digest('hex'),
			},
		}),
	};
}

/** 用 SemVer 匹配候选，回溯处理共享依赖，交给 Graphlib 检查环和排序。 */
export function planMarketplaceInstall(input: {
	target: MarketplaceRepositorySource;
	catalog: readonly MarketplaceCatalogPlugin[];
	repositories: readonly MarketplaceRepository[];
	installed: readonly InstalledPackage[];
}): MarketplaceInstallPlan {
	const { target } = input;
	const rootId = target.pluginId;
	const environment = readPluginEnvironment();
	const catalog = indexCandidates(input.catalog, input.repositories, environment);
	const installed = new Map(input.installed.map((item) => [item.record.pluginId, item]));
	const companions = indexCompanions(catalog, installed);
	const root = catalog
		.get(rootId)
		?.find(
			({ repository, manifest }) => repository?.id === target.repositoryId && manifest.version === target.version,
		);
	if (!root)
		return { target, steps: [], blockers: [{ code: 'MARKETPLACE_PLUGIN_SOURCE_NOT_FOUND', pluginId: rootId }] };
	if (root.issue) return { target, steps: [], blockers: [root.issue] };

	const search = [new Map([[rootId, root]])];
	const failures = new Map<string, MarketplaceInstallIssue>();

	const reject = (issue: MarketplaceInstallIssue) => failures.set(JSON.stringify(issue), issue);

	while (search.length) {
		const chosen = search.pop()!;
		const requirements = requirementsFor(chosen, companions);
		// 新选中的包可能增加一个已选依赖的约束。此分支失败后继续尝试前面的候选版本。
		const mismatch = requirements.find((requirement) => {
			const candidate = chosen.get(requirement.id);
			return candidate && !satisfiesRequirement(candidate, requirement);
		});
		if (mismatch) {
			reject({
				code: 'PLUGIN_DEPENDENCY_VERSION_MISMATCH',
				pluginId: mismatch.id,
				required: mismatch.range,
				actual: chosen.get(mismatch.id)!.manifest.version,
			});
			continue;
		}

		const missing = requirements.find(({ id }) => !chosen.has(id));
		if (missing) {
			const { id } = missing;
			const candidates = selectDependency(
				target,
				requirements.filter((item) => item.id === id),
				catalog.get(id) ?? [],
				installed.get(id),
				environment,
			);
			if (!Array.isArray(candidates)) reject(candidates);
			else for (const candidate of candidates.reverse()) search.push(new Map([...chosen, [id, candidate]]));
			continue;
		}

		// 计划之外的已安装消费者也可能使用本次替换的包。
		const issue = installedConsumerIssue(chosen, installed);
		if (issue) {
			reject(issue);
			continue;
		}

		const graph = buildPluginDependencyGraph(
			[...chosen].map(([id, { manifest }]) => ({ id, dependsOn: manifest.nexus.dependsOn ?? {} })),
		);
		const [cycle] = alg.findCycles(graph);
		if (cycle) {
			reject({ code: 'PLUGIN_DEPENDENCY_CYCLE', pluginId: rootId, path: cycle });
			continue;
		}

		// steps 按依赖顺序排列；被选中的包由 target 指明。
		const order = alg.topsort(graph);
		const steps = order.map((id) => installStep(chosen.get(id)!, installed.get(id)));
		const updated = steps.filter((step) => step.action === 'update').map((step) => step.package.name);
		const affected = affectedInstalled(updated, installed.values());
		return { target, steps, blockers: [], ...(affected.length && { affected }) };
	}
	return { target, steps: [], blockers: [...failures.values()] };
}
