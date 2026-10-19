import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredCommand, StoredCommandTag } from '../../storage/command-storage.js';
import {
	COMMAND_TEXT_MAX_BYTES,
	COMMAND_NAME_MAX_BYTES,
	COMMAND_MAX_VARIABLES,
	COMMAND_VARIABLE_MAX_BYTES,
	COMMAND_MAX_TAGS,
} from '@nexus-terminal/shared/preferences/commands/values';

function integer(value: unknown, min: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt command integer');
	}
	return value;
}

function text(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		value.includes('\0') ||
		Buffer.byteLength(value, 'utf8') > max ||
		Buffer.from(value, 'utf8').toString('utf8') !== value
	) {
		throw new Error('Corrupt command text');
	}
	return value;
}

function variables(input: unknown): Record<string, string> {
	const decoded: unknown = JSON.parse(text(input, 1024 * 1024));
	if (
		decoded === null ||
		typeof decoded !== 'object' ||
		Array.isArray(decoded) ||
		Object.keys(decoded).length > COMMAND_MAX_VARIABLES
	) {
		throw new Error('Corrupt command variables');
	}
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(decoded)) {
		if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
			throw new Error('Corrupt command variable name');
		}
		Object.defineProperty(result, key, { value: text(value, COMMAND_VARIABLE_MAX_BYTES), enumerable: true });
	}
	return result;
}

export function commandRow(row: SqlRow, tagRows: SqlRow[]): StoredCommand {
	const command = text(row.command, COMMAND_TEXT_MAX_BYTES);
	if (!command.trim() || tagRows.length > COMMAND_MAX_TAGS) {
		throw new Error('Corrupt command record');
	}
	const createdAt = integer(row.created_at, 0);
	return {
		id: integer(row.id, 1),
		version: integer(row.version, 1),
		name: row.name === null ? null : text(row.name, COMMAND_NAME_MAX_BYTES),
		command,
		variables: variables(row.variables_json),
		tagIds: tagRows.map((value) => integer(value.tag_id, 1)),
		usageCount: integer(row.usage_count, 0),
		createdAt,
		updatedAt: integer(row.updated_at, createdAt),
	};
}

export function commandTagRow(row: SqlRow): StoredCommandTag {
	const name = text(row.name, COMMAND_NAME_MAX_BYTES);
	if (!name.trim()) {
		throw new Error('Corrupt command tag');
	}
	const createdAt = integer(row.created_at, 0);
	return {
		id: integer(row.id, 1),
		version: integer(row.version, 1),
		name,
		createdAt,
		updatedAt: integer(row.updated_at, createdAt),
	};
}
