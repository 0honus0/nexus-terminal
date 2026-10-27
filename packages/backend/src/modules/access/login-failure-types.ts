/** Application policy facts; no Service, registration or storage dependency. */
export interface LoginFailurePolicyInput {
	enabled: boolean;
	maxAttempts?: number;
	banSeconds?: number;
}

export interface LoginFailureLimits {
	maxAttempts: number;
	banMs: number;
	windowMs: number;
}
