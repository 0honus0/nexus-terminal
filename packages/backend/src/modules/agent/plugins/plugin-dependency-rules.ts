import { AgentFailure } from '../agent-failure.js';
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
