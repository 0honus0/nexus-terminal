import { validateConnectionTagCount } from './connection-rules.js';
import type { ConnectionType, ConnectionRoute } from '@nexus-terminal/shared/targets/connections/values';
import { TargetFailure } from '../target-failure.js';
import { SSH_MAX_EXPANDED_TARGETS, SSH_MAX_JUMP_EDGES } from '../ssh-graph-limits.js';
import type { ConnectionRelationshipFacts, SshGraphSnapshot } from './model/connection-types.js';

interface GraphNode {
	type: ConnectionType;
	route: ConnectionRoute;
	jumps: number[];
}

function validateRelationships(connection: ConnectionRelationshipFacts): void {
	validateConnectionTagCount(connection.tagIds.length);
	if (
		(connection.route === 'jump' && (connection.type !== 'SSH' || connection.jumpIds.length === 0)) ||
		(connection.route !== 'jump' && connection.jumpIds.length > 0) ||
		(connection.route === 'proxy' ? connection.proxyId === null : connection.proxyId !== null) ||
		new Set(connection.jumpIds).size !== connection.jumpIds.length ||
		new Set(connection.tagIds).size !== connection.tagIds.length
	) {
		throw new TargetFailure('invalid_input');
	}
}

function buildGraph(
	snapshot: SshGraphSnapshot,
	edges: SshGraphSnapshot['edges'],
): {
	graph: Map<number, GraphNode>;
	reverse: Map<number, Set<number>>;
} {
	const graph = new Map<number, GraphNode>();
	const reverse = new Map<number, Set<number>>();
	const targets = new Map<number, Set<number>>();
	for (const row of snapshot.nodes) {
		graph.set(row.id, {
			type: row.type,
			route: row.route,
			jumps: [],
		});
	}
	for (const row of edges) {
		const parent = row.connectionId;
		const target = row.jumpConnectionId;
		const node = graph.get(parent);
		if (!node || !graph.has(target) || node.jumps.length !== row.position) {
			throw new TargetFailure('invalid_input');
		}
		const seen = targets.get(parent) ?? new Set<number>();
		if (seen.has(target)) {
			throw new TargetFailure('invalid_input');
		}
		seen.add(target);
		targets.set(parent, seen);
		node.jumps.push(target);
		const ancestors = reverse.get(target) ?? new Set<number>();
		ancestors.add(parent);
		reverse.set(target, ancestors);
	}

	return { graph, reverse };
}

function validateRoots(graph: ReadonlyMap<number, GraphNode>, roots: Iterable<number>): void {
	for (const root of roots) {
		const path = new Set<number>();
		let expanded = 0;

		const walk = (id: number, depth: number): void => {
			if (depth > SSH_MAX_JUMP_EDGES || path.has(id) || ++expanded > SSH_MAX_EXPANDED_TARGETS) {
				throw new TargetFailure('invalid_input');
			}
			const node = graph.get(id);
			if (!node) {
				throw new TargetFailure('invalid_input');
			}
			if (node.route === 'jump') {
				if (node.type !== 'SSH' || node.jumps.length === 0) {
					throw new TargetFailure('invalid_input');
				}
			} else if (node.jumps.length) {
				throw new TargetFailure('invalid_input');
			}
			path.add(id);
			for (const child of node.jumps) {
				if (graph.get(child)?.type !== 'SSH') {
					throw new TargetFailure('invalid_input');
				}
				walk(child, depth + 1);
			}
			path.delete(id);
		};

		walk(root, 0);
	}
}

/** Validate the proposed graph, including ancestors, using only transaction snapshot facts. */
export function validateConnectionGraph(
	connection: ConnectionRelationshipFacts,
	snapshot: SshGraphSnapshot,
	changedId: number,
): void {
	validateRelationships(connection);
	const edges = snapshot.edges.filter((edge) => edge.connectionId !== changedId);
	connection.jumpIds.forEach((jumpConnectionId, position) => {
		edges.push({ connectionId: changedId, position, jumpConnectionId });
	});
	const { graph, reverse } = buildGraph(snapshot, edges);
	const affected = new Set<number>([changedId]);
	const queue = [changedId];
	for (let index = 0; index < queue.length; index++) {
		const next = queue[index];
		for (const ancestor of reverse.get(next) ?? []) {
			if (!affected.has(ancestor)) {
				affected.add(ancestor);
				queue.push(ancestor);
			}
		}
	}

	validateRoots(graph, affected);
}

/** A full snapshot builds its graph once instead of rebuilding it for every stored connection. */
export function validateConnectionSnapshot(
	connections: readonly ConnectionRelationshipFacts[],
	snapshot: SshGraphSnapshot,
): void {
	for (const connection of connections) {
		validateRelationships(connection);
	}
	const { graph } = buildGraph(snapshot, snapshot.edges);
	validateRoots(graph, graph.keys());
}
