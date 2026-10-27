import type { LoginFailurePolicyInput, LoginFailureLimits } from './login-failure-types.js';

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
	const chosen = value ?? fallback;
	if (!Number.isSafeInteger(chosen) || chosen < min || chosen > max) {
		throw new Error('Invalid Access login failure policy');
	}
	return chosen;
}

/**
 * IP admission is Access business policy. An unset/disabled configuration
 * never silently activates a fixed ban for public clients.
 */
export class LoginFailurePolicy {
	private current: { enabled: boolean; limits: LoginFailureLimits };

	get limits(): LoginFailureLimits {
		return this.current.limits;
	}

	constructor(options: LoginFailurePolicyInput = { enabled: false }) {
		if (typeof options.enabled !== 'boolean') {
			throw new Error('Invalid Access login failure policy');
		}
		this.current = {
			enabled: options.enabled,
			limits: {
				maxAttempts: bounded(options.maxAttempts, 5, 1, 1000),
				banMs: bounded(options.banSeconds, 300, 1, 30 * 86400) * 1000,
				windowMs: 15 * 60_000,
			},
		};
	}

	prepare(options: LoginFailurePolicyInput): () => void {
		const next = new LoginFailurePolicy(options);
		return () => {
			this.current = next.current;
		};
	}

	shouldEnforce(isInternal: boolean): boolean {
		return this.current.enabled && !isInternal;
	}
}
