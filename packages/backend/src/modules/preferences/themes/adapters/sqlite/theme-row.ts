import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredTheme, StoredThemeColors } from '../../storage/theme-storage.js';
import {
	TERMINAL_THEME_COLOR_KEYS,
	TERMINAL_THEME_COLOR_MAX_BYTES,
	TERMINAL_THEME_NAME_MAX_BYTES,
	TERMINAL_THEME_REQUEST_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/themes/values';

function integer(value: unknown, min = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt theme integer');
	}
	return value;
}

function text(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		Buffer.byteLength(value) > max ||
		Buffer.from(value).toString('utf8') !== value ||
		value.includes('\0')
	) {
		throw new Error('Corrupt theme text');
	}
	return value;
}

export function storedThemeColors(input: unknown): StoredThemeColors {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('Corrupt theme colors');
	}
	const entries: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (!TERMINAL_THEME_COLOR_KEYS.some((allowed) => allowed === key)) {
			throw new Error('Corrupt theme color key');
		}
		entries[key] = value;
	}
	const colors: StoredThemeColors = {
		foreground: text(entries.foreground, TERMINAL_THEME_COLOR_MAX_BYTES),
		background: text(entries.background, TERMINAL_THEME_COLOR_MAX_BYTES),
	};
	for (const key of TERMINAL_THEME_COLOR_KEYS) {
		if (entries[key] !== undefined) {
			colors[key] = text(entries[key], TERMINAL_THEME_COLOR_MAX_BYTES);
		}
	}
	return colors;
}

export function themeRow(row: SqlRow): StoredTheme {
	const createdAt = integer(row.created_at);
	const updatedAt = integer(row.updated_at, createdAt);
	const presetKey = row.preset_key === null ? null : text(row.preset_key, 256);
	if (
		(presetKey === null &&
			(typeof row.user_id !== 'number' || !Number.isSafeInteger(row.user_id) || row.user_id < 1)) ||
		(presetKey !== null && row.user_id !== null)
	) {
		throw new Error('Corrupt theme owner');
	}
	const colorsJson = text(row.colors_json, TERMINAL_THEME_REQUEST_MAX_BYTES);
	const raw: unknown = JSON.parse(colorsJson);
	return {
		id: integer(row.id, 1),
		version: integer(row.version, 1),
		name: text(row.name, TERMINAL_THEME_NAME_MAX_BYTES),
		colors: storedThemeColors(raw),
		presetKey,
		createdAt,
		updatedAt,
	};
}
