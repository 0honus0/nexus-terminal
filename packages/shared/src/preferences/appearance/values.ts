export const APPEARANCE_UI_THEME_MAX_BYTES = 16 * 1024;

export { HTML_CONTENT_MAX_BYTES as APPEARANCE_HTML_MAX_BYTES } from '../values.js';

export const APPEARANCE_FONT_MAX_BYTES = 1024;

export { HTML_SOURCE_MAX_BYTES as APPEARANCE_URL_MAX_BYTES } from '../values.js';

export const APPEARANCE_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

export const APPEARANCE_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

export const APPEARANCE_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'version_conflict',
	'theme_not_found',
	'not_found',
	'cleanup_failed',
	'limit_exceeded',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'unavailable',
	'unsupported_media_type',
] as const;

export type AppearanceErrorCode = (typeof APPEARANCE_ERROR_CODES)[number];

export const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;

export const BACKGROUND_MULTIPART_MAX_BYTES = BACKGROUND_MAX_BYTES + 16384;

export const BACKGROUND_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'] as const;

export type BackgroundMediaType = (typeof BACKGROUND_MEDIA_TYPES)[number];

export const BACKGROUND_KINDS = ['page', 'terminal'] as const;

export type BackgroundKind = (typeof BACKGROUND_KINDS)[number];

export const BACKGROUND_FILE_PREFIX = '/api/v1/appearance/background/file/';

export const BACKGROUND_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export const APPEARANCE_COLOR_MAX_BYTES = 128;

export const APPEARANCE_FONT_MIN_SIZE = 0.1;

export const APPEARANCE_FONT_MAX_SIZE = 512;

export const APPEARANCE_STROKE_MAX_WIDTH = 32;

export const APPEARANCE_SHADOW_MAX_DISTANCE = 512;

export const APPEARANCE_SHADOW_MAX_BLUR = 512;

export const APPEARANCE_UI_THEME_MAX_ENTRIES = 128;

export const APPEARANCE_UI_THEME_VALUE_MAX_BYTES = 2048;

export const APPEARANCE_UI_THEME_KEY_PATTERN = /^--[a-z0-9-]{1,126}$/iu;
