/** Stable authentication error values consumed by both endpoints. */
export type AccessHttpErrorCode =
	| 'invalid_input'
	| 'already_initialized'
	| 'invalid_credentials'
	| 'rate_limited'
	| 'captcha_invalid'
	| 'captcha_unavailable'
	| 'operation_unknown'
	| 'factor_unavailable'
	| 'conflict'
	| 'storage_unavailable'
	| 'internal_failure'
	| 'unauthenticated'
	| 'forbidden';

export const ACCESS_SESSION_COOKIE_NAME = 'nexus_session';

export const ACCESS_REMEMBER_SECONDS = 30 * 24 * 60 * 60;

export const ACCESS_CAPTCHA_TOKEN_MAX_BYTES = 4096;

export const ACCESS_IP_BLACKLIST_MAX_PAGE_SIZE = 200;

export type AccessCaptchaProvider = 'none' | 'hcaptcha' | 'recaptcha';
