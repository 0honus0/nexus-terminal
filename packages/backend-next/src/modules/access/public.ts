import type { AccessHttpErrorCode } from '@nexus-terminal/shared/access/values';

export type AccessErrorCode = Exclude<
	AccessHttpErrorCode,
	'rate_limited' | 'factor_unavailable' | 'unauthenticated' | 'forbidden'
>;

/** Safe Access module identity contract. Never carries a bearer token or password hash. */
export interface AccessIdentity {
	userId: number;
	username: string;
	twoFactorEnabled: boolean;
}

export interface AccessPublicApi {
	needsSetup(): Promise<boolean>;
	/** Missing, invalid, expired and revoked cookies produce null. */
	authenticate(sessionToken: string | null): Promise<AccessIdentity | null>;
}
