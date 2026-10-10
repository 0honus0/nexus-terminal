import { TargetFailure } from '../../../target-failure.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { SSH_MAX_EXPANDED_TARGETS, SSH_MAX_JUMP_EDGES } from '../../../ssh-graph-limits.js';

interface SshGraphNode {
	type: string;
	route: string;
	jumps: number[];
}

function positiveId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new TargetFailure('invalid_input');
	}
	return value;
}

/**
 * Executed after relational writes, before commit. Reading the complete edge
 * snapshot also detects changes that invalidate any ancestor referencing id.
 * This is deliberately a Targets business invariant, not a Platform rule.
 */
export async function validateAffectedSshGraph(tx: SqlExecutor, changedId: number): Promise<void> {
	const records = await tx.all('SELECT id,type,route FROM connections');
	const edgeRows = await tx.all(
		'SELECT connection_id,position,jump_connection_id FROM connection_jumps ORDER BY connection_id,position',
	);
	const graph = new Map<number, SshGraphNode>();
	const reverse = new Map<number, Set<number>>();
	for (const row of records) {
		graph.set(positiveId(row.id), {
			type: String(row.type),
			route: String(row.route),
			jumps: [],
		});
	}
	for (const row of edgeRows) {
		const parent = positiveId(row.connection_id);
		const target = positiveId(row.jump_connection_id);
		const node = graph.get(parent);
		if (!node || !graph.has(target) || node.jumps.length !== row.position) {
			throw new TargetFailure('invalid_input');
		}
		if (node.jumps.includes(target)) {
			throw new TargetFailure('invalid_input');
		}
		node.jumps.push(target);
		const ancestors = reverse.get(target) ?? new Set<number>();
		ancestors.add(parent);
		reverse.set(target, ancestors);
	}

	const affected = new Set<number>([changedId]);
	const queue = [changedId];
	while (queue.length) {
		const next = queue.shift()!;
		for (const ancestor of reverse.get(next) ?? []) {
			if (!affected.has(ancestor)) {
				affected.add(ancestor);
				queue.push(ancestor);
			}
		}
	}

	for (const root of affected) {
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
