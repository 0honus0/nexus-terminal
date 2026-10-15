import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { AGENT_SCOPE_MAX_NAME_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { ThreadRecord } from '../../storage/scope-storage.js';

function integer(value: unknown, min: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt thread integer');
	}
	return value;
}

function id(value: unknown): string {
	if (typeof value !== 'string' || !AGENT_ID_PATTERN.test(value)) {
		throw new Error('Corrupt thread identity');
	}
	return value;
}

export function threadRow(row: SqlRow): ThreadRecord {
	if (
		typeof row.title !== 'string' ||
		!row.title.trim() ||
		Buffer.byteLength(row.title, 'utf8') > AGENT_SCOPE_MAX_NAME_BYTES ||
		Buffer.from(row.title, 'utf8').toString('utf8') !== row.title
	) {
		throw new Error('Corrupt thread title');
	}
	const createdAt = integer(row.created_at, 0);
	return {
		id: id(row.id),
		userId: integer(row.user_id, 1),
		appId: id(row.app_id),
		title: row.title,
		version: integer(row.version, 1),
		createdAt,
		updatedAt: integer(row.updated_at, createdAt),
	};
}
