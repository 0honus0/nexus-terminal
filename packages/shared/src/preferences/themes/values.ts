export const TERMINAL_THEME_COLOR_KEYS = [
	'foreground',
	'background',
	'cursor',
	'cursorAccent',
	'selectionBackground',
	'selectionForeground',
	'black',
	'red',
	'green',
	'yellow',
	'blue',
	'magenta',
	'cyan',
	'white',
	'brightBlack',
	'brightRed',
	'brightGreen',
	'brightYellow',
	'brightBlue',
	'brightMagenta',
	'brightCyan',
	'brightWhite',
] as const;

export type TerminalThemeColorKey = (typeof TERMINAL_THEME_COLOR_KEYS)[number];

export const TERMINAL_THEME_NAME_MAX_BYTES = 1024;

export const TERMINAL_THEME_COLOR_MAX_BYTES = 128;

export const TERMINAL_THEME_REQUEST_MAX_BYTES = 32 * 1024;

export const TERMINAL_THEME_IMPORT_MAX_BYTES = 1024 * 1024;

export const TERMINAL_THEME_RESPONSE_MAX_BYTES = 128 * 1024 * 1024;

export const TERMINAL_THEME_LIST_MAX_ITEMS = 4096;

export const TERMINAL_THEME_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'version_conflict',
	'name_conflict',
	'preset_readonly',
	'limit_exceeded',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'unavailable',
	'unsupported_media_type',
] as const;

export type TerminalThemeErrorCode = (typeof TERMINAL_THEME_ERROR_CODES)[number];
