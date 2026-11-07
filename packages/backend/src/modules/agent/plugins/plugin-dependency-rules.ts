import { AgentFailure } from '../agent-failure.js';
import { matchesAppExecutionDependency } from './plugin-app-execution-rules.js';
import type { PluginCodeDependencyNode } from './model/plugin-dependency-types.js';

/** Iterative DFS reports a real cycle path and does not impose an artificial depth limit. */
export function assertPluginCodeDependencies(nodes: readonly PluginCodeDependencyNode[]): void {
	const directory = new Map(nodes.map((node) => [node.id, node]));
	if (directory.size !== nodes.length) {
		throw new AgentFailure('version_conflict');
	}
	const complete = new Set<string>();
	for (const root of nodes) {
		if (complete.has(root.id)) {
			continue;
		}
		const path = [{ node: root, next: 0 }];
		const active = new Map([[root.id, 0]]);
		while (path.length) {
			const current = path[path.length - 1];
			if (current.next === current.node.dependencies.length) {
				complete.add(current.node.id);
				active.delete(current.node.id);
				path.pop();
				continue;
			}
			const id = current.node.dependencies[current.next++];
			const start = active.get(id);
			if (start !== undefined) {
				throw new AgentFailure('version_conflict', {
					cause: new Error(
						'Code dependency cycle: ' + [...path.slice(start).map((item) => item.node.id), id].join(' -> '),
					),
				});
			}
			if (complete.has(id)) {
				continue;
			}
			const node = directory.get(id);
			if (!node) {
				throw new AgentFailure('version_conflict', { cause: new Error('Missing code dependency: ' + id) });
			}
			active.set(id, path.length);
			path.push({ node, next: 0 });
		}
	}
}

interface PluginPackageDependency {
	packageId: string;
	publisherKeyId: string;
	minVersion: string;
	maxVersion: string;
}

interface PluginDependencyCandidate {
	manifest: { id: string; version: string; dependencies: readonly PluginPackageDependency[] };
	installation: {
		package: { packageId: string; version: string; packageHash: string; publisherKeyId: string };
		status: 'installed' | 'draining' | 'removed' | 'incompatible';
	};
	publisher: { keyId: string; revokedAt: number | null } | null;
}

/** Resolve every package's signed dependencies against the installed single-version set. */
export function resolvePluginPackageClosure<Candidate extends PluginDependencyCandidate>(
	rootPackageIds: readonly string[],
	candidates: readonly Candidate[],
): Candidate[] {
	const directory = new Map<string, Candidate>();
	for (const candidate of candidates) {
		const packageId = candidate.installation.package.packageId;
		if (directory.has(packageId)) {
			throw new AgentFailure('version_conflict');
		}
		directory.set(packageId, candidate);
	}
	if (rootPackageIds.length === 0 || new Set(rootPackageIds).size !== rootPackageIds.length) {
		throw new AgentFailure('version_conflict');
	}
	const roots = rootPackageIds.map((packageId) => {
		const root = directory.get(packageId);
		if (!root) {
			throw new AgentFailure('version_conflict');
		}
		return root;
	});
	const selected = new Map<string, Candidate>();
	const pending: Candidate[] = [...roots];
	while (pending.length > 0) {
		const candidate = pending.pop();
		if (!candidate) {
			throw new AgentFailure('version_conflict');
		}
		const reference = candidate.installation.package;
		if (selected.has(reference.packageId)) {
			continue;
		}
		if (
			candidate.installation.status !== 'installed' ||
			!candidate.publisher ||
			candidate.publisher.revokedAt !== null ||
			candidate.publisher.keyId !== reference.publisherKeyId
		) {
			throw new AgentFailure('forbidden');
		}
		if (candidate.manifest.id !== reference.packageId || candidate.manifest.version !== reference.version) {
			throw new AgentFailure('version_conflict');
		}
		selected.set(reference.packageId, candidate);
		for (const dependency of candidate.manifest.dependencies) {
			const target = directory.get(dependency.packageId);
			if (!target || !matchesAppExecutionDependency(dependency, target.installation.package)) {
				throw new AgentFailure('version_conflict');
			}
			if (!selected.has(dependency.packageId)) {
				pending.push(target);
			}
		}
	}
	assertPluginCodeDependencies(
		[...selected.values()].map((candidate) => ({
			id: candidate.manifest.id,
			dependencies: candidate.manifest.dependencies.map((dependency) => dependency.packageId),
		})),
	);
	return [
		...roots,
		...[...selected.values()]
			.filter((candidate) => !rootPackageIds.includes(candidate.manifest.id))
			.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id)),
	];
}
