import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredFavorite } from '../../storage/favorite-storage.js';
import { FAVORITE_NAME_MAX_BYTES, FAVORITE_PATH_MAX_BYTES } from '@nexus-terminal/shared/preferences/favorites/values';

function integer(value: unknown, min: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt favorite integer');
	}
	return value;
}

function text(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		value.includes('\0') ||
		Buffer.from(value, 'utf8').toString('utf8') !== value ||
		Buffer.byteLength(value, 'utf8') > max
	) {
		throw new Error('Corrupt favorite text');
	}
	return value;
}

export function favoriteRow(row: SqlRow): StoredFavorite {
	const path = text(row.path, FAVORITE_PATH_MAX_BYTES);
	if (!path.trim()) {
		throw new Error('Corrupt favorite path');
	}
	return {
		id: integer(row.id, 1),
		version: integer(row.version, 1),
		name: row.name === null ? null : text(row.name, FAVORITE_NAME_MAX_BYTES),
		path,
		lastUsedAt: row.last_used_at === null ? null : integer(row.last_used_at, 0),
		createdAt: integer(row.created_at, 0),
		updatedAt: integer(row.updated_at, 0),
	};
}
