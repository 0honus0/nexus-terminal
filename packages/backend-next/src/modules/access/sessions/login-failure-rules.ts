import type { LoginFailureState } from './model/session-types.js';
import type { LoginFailureLimits } from '../authentication/model/login-failure-types.js';

export function mayAttemptLogin(state: LoginFailureState | null, now: number): boolean {
	return state === null || state.blockedUntil <= now;
}

export function nextLoginFailure(
	state: LoginFailureState | null,
	now: number,
	limits: LoginFailureLimits,
): LoginFailureState {
	const existingBlock = state?.blockedUntil ?? 0;
	const activeBlock = existingBlock > now;
	const expiredBlock = existingBlock > 0 && existingBlock <= now;
	const currentWindow = state !== null && !expiredBlock && now - state.windowStartedAt < limits.windowMs;
	const attempts = currentWindow ? state.attempts + 1 : 1;
	const blockedUntil = activeBlock ? existingBlock : attempts >= limits.maxAttempts ? now + limits.banMs : 0;
	return {
		attempts,
		windowStartedAt: currentWindow ? state.windowStartedAt : now,
		blockedUntil,
	};
}
