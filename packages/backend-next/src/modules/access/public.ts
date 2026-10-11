import type { AccessHttpErrorCode } from '@nexus-terminal/shared/access/values';

export type AccessErrorCode = Exclude<AccessHttpErrorCode, 'rate_limited' | 'factor_unavailable'>;

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
	/** Backend-only session revalidation by stored SHA-256 token digest. */
	authenticateDigest(tokenDigest: string): Promise<AccessIdentity | null>;
	/** Admission for a trusted transport-derived source IP, before any HTTP/WS handler. */
	admitSource(sourceIp: string): Promise<boolean>;
	/** Whitelist-only admission for authentication and blacklist recovery routes. */
	admitAuthenticationSource(sourceIp: string): Promise<boolean>;
}
