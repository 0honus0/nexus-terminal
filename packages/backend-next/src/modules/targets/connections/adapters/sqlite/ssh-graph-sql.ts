import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { CONNECTION_TYPES, CONNECTION_ROUTES } from '@nexus-terminal/shared/targets/connections/values';
import type { ConnectionType, ConnectionRoute } from '@nexus-terminal/shared/targets/connections/values';
import type { StoredSshGraphSnapshot } from '../../storage/connection-storage.js';

function integer(value: unknown, min: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt SSH graph integer');
	}
	return value;
}

function connectionType(value: unknown): ConnectionType {
	for (const type of CONNECTION_TYPES) {
		if (value === type) {
			return type;
		}
	}
	throw new Error('Corrupt SSH graph connection type');
}

function connectionRoute(value: unknown): ConnectionRoute {
	for (const route of CONNECTION_ROUTES) {
		if (value === route) {
			return route;
		}
	}
	throw new Error('Corrupt SSH graph route');
}

export async function readSshGraph(tx: SqlExecutor): Promise<StoredSshGraphSnapshot> {
	const records = await tx.all('SELECT id,type,route FROM connections');
	const edges = await tx.all(
		'SELECT connection_id,position,jump_connection_id FROM connection_jumps ORDER BY connection_id,position',
	);
	return {
		nodes: records.map((row) => ({
			id: integer(row.id, 1),
			type: connectionType(row.type),
			route: connectionRoute(row.route),
		})),
		edges: edges.map((row) => ({
			connectionId: integer(row.connection_id, 1),
			position: integer(row.position, 0),
			jumpConnectionId: integer(row.jump_connection_id, 1),
		})),
	};
}
