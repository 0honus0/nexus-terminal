export const HTML_THEME_KINDS = ['preset', 'custom'] as const;

export type HtmlThemeKind = (typeof HTML_THEME_KINDS)[number];

export const HTML_THEME_NAME_MAX_BYTES = 255;

export { HTML_CONTENT_MAX_BYTES as HTML_THEME_CONTENT_MAX_BYTES } from '../values.js';

export const HTML_THEME_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

export const HTML_THEME_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;

export const HTML_THEME_LIST_MAX_ITEMS = 4096;

export const HTML_THEME_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'name_conflict',
	'version_conflict',
	'limit_exceeded',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'unavailable',
	'unsupported_media_type',
	'source_invalid',
	'source_unavailable',
	'source_changed',
	'cleanup_failed',
] as const;

export type HtmlThemeErrorCode = (typeof HTML_THEME_ERROR_CODES)[number];

export const HTML_THEME_NAME_PATTERN = /^(?!.*\.\.)[^/\\\u0000-\u001f\u007f]+\.html$/u;

export { HTML_SOURCE_MAX_BYTES as HTML_THEME_SOURCE_MAX_BYTES } from '../values.js';

export const HTML_THEME_REMOTE_LIST_MAX_ITEMS = 1000;
