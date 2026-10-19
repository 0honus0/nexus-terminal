import { AuthRequestFailure } from './auth-failure';

/** Safe UI keys; never interpolate a server or transport error message. */
export function authErrorKey(cause: unknown): string {
	if (!(cause instanceof AuthRequestFailure)) {
		return 'auth.errors.generic';
	}
	if (cause.outcome === 'unknown') {
		return 'auth.errors.unknown';
	}
	switch (cause.code) {
		case 'invalid_input':
			return 'auth.errors.invalidInput';
		case 'invalid_credentials':
			return 'auth.errors.credentials';
		case 'unauthenticated':
		case 'challenge_expired':
			return 'auth.errors.expired';
		case 'rate_limited':
			return 'auth.errors.rateLimited';
		case 'captcha_invalid':
			return 'auth.errors.captcha';
		case 'already_initialized':
			return 'auth.errors.initialized';
		case 'cancelled':
			return 'auth.errors.cancelled';
		default:
			return 'auth.errors.generic';
	}
}
