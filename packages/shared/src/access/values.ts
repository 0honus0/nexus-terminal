export const ACCESS_PASSWORD_MAX_BYTES = 1024;

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

/** Complete JSON budgets for basic authentication and TOTP login, excluding Passkey management. */
export const ACCESS_AUTH_REQUEST_MAX_BYTES = 16 * 1024;

export const ACCESS_AUTH_RESPONSE_MAX_BYTES = 16 * 1024;

/** Complete TOTP setup JSON, including the inline PNG QR code. */
export const ACCESS_TOTP_SETUP_RESPONSE_MAX_BYTES = 64 * 1024;

/** Complete Passkey options/list JSON; individual proofs use the request budget. */
export const ACCESS_FACTOR_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

/** Complete blacklist page JSON, including up to 200 entries and escaping. */
export const ACCESS_IP_BLACKLIST_RESPONSE_MAX_BYTES = 256 * 1024;
