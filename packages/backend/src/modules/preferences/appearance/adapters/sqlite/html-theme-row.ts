import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredHtmlTheme, StoredHtmlThemeListing } from '../../storage/html-theme-storage.js';
import {
	HTML_THEME_NAME_MAX_BYTES,
	HTML_THEME_NAME_PATTERN,
	HTML_THEME_CONTENT_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/html-themes/values';

function integer(value: unknown, min: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt HTML theme integer');
	}
	return value;
}

export function htmlThemeListing(row: SqlRow): StoredHtmlThemeListing {
	if (
		typeof row.name !== 'string' ||
		!row.name.trim() ||
		!HTML_THEME_NAME_PATTERN.test(row.name) ||
		Buffer.byteLength(row.name) > HTML_THEME_NAME_MAX_BYTES ||
		Buffer.from(row.name).toString('utf8') !== row.name
	) {
		throw new Error('Corrupt HTML theme name');
	}
	return { name: row.name, version: integer(row.version, 1), updatedAt: integer(row.updated_at, 0) };
}

export function htmlThemeRow(row: SqlRow): StoredHtmlTheme {
	const summary = htmlThemeListing(row);
	if (
		typeof row.content !== 'string' ||
		Buffer.byteLength(row.content) > HTML_THEME_CONTENT_MAX_BYTES ||
		Buffer.from(row.content).toString('utf8') !== row.content
	) {
		throw new Error('Corrupt HTML theme content');
	}
	return { name: summary.name, version: summary.version, updatedAt: summary.updatedAt, content: row.content };
}
