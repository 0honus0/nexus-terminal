export const SETTINGS_REQUEST_MAX_BYTES = 64 * 1024;

export const SETTINGS_RESPONSE_MAX_BYTES = 64 * 1024;

export const SETTINGS_WHITELIST_MAX_BYTES = 16 * 1024;

export const SETTINGS_CAPTCHA_KEY_MAX_BYTES = 1024;

export const SETTINGS_MAX_PASSKEY_SITES = 16;

export const SETTINGS_ERROR_CODES = [
	'invalid_input',
	'limit_exceeded',
	'unauthenticated',
	'forbidden',
	'version_conflict',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'unavailable',
] as const;

export type SettingsErrorCode = (typeof SETTINGS_ERROR_CODES)[number];
