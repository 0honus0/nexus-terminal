import ipaddr from 'ipaddr.js';
import type { LoginFailurePolicyInput, LoginFailureLimits } from '../model/login-failure-types.js';

function isInternalSource(source: string): boolean {
	if (source === 'localhost') {
		return true;
	}
	try {
		const range = ipaddr.process(source).range();
		return ['loopback', 'private', 'linkLocal', 'uniqueLocal'].includes(range);
	} catch {
		// Unrecognized addresses must not receive an internal-source exemption.
		return false;
	}
}

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
	readonly limits: LoginFailureLimits;
	private readonly enabled: boolean;

	constructor(options: LoginFailurePolicyInput = { enabled: false }) {
		this.enabled = options.enabled;
		this.limits = {
			maxAttempts: bounded(options.maxAttempts, 5, 1, 1000),
			banMs: bounded(options.banSeconds, 300, 1, 30 * 86400) * 1000,
			windowMs: 15 * 60_000,
		};
	}

	shouldEnforce(source: string): boolean {
		return this.enabled && !isInternalSource(source);
	}
}
