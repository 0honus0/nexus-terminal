/** Stable authentication error values consumed by both endpoints. */
export type AccessHttpErrorCode =
	| 'invalid_input'
	| 'already_initialized'
	| 'invalid_credentials'
	| 'rate_limited'
	| 'limit_exceeded'
	| 'captcha_invalid'
	| 'captcha_unavailable'
	| 'operation_unknown'
	| 'factor_unavailable'
	| 'challenge_expired'
	| 'not_found'
	| 'conflict'
	| 'storage_unavailable'
	| 'internal_failure'
	| 'unauthenticated'
	| 'forbidden';

export const ACCESS_SESSION_COOKIE_NAME = 'nexus_session';

export const ACCESS_PARTIAL_COOKIE_NAME = 'nexus_partial';

export const ACCESS_CHALLENGE_COOKIE_NAME = 'nexus_challenge';

export const ACCESS_TOTP_SETUP_COOKIE_NAME = 'nexus_totp_setup';

export const ACCESS_PARTIAL_SECONDS = 5 * 60;

export const ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES = 1024;

export const ACCESS_REMEMBER_SECONDS = 30 * 24 * 60 * 60;

export const ACCESS_CAPTCHA_TOKEN_MAX_BYTES = 4096;

export const ACCESS_IP_BLACKLIST_MAX_PAGE_SIZE = 200;

export type AccessCaptchaProvider = 'none' | 'hcaptcha' | 'recaptcha';

export const ACCESS_FACTOR_REQUEST_MAX_BYTES = 128 * 1024;

export const ACCESS_PASSKEY_NAME_MAX_BYTES = 128;

export const ACCESS_PASSKEY_EVIDENCE_MAX_BYTES = 96_000;

export const ACCESS_PASSKEY_MAX_TRANSPORTS = 16;

export const ACCESS_PASSKEY_TRANSPORT_MAX_BYTES = 32;
