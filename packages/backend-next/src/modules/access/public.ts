/** Safe Access module identity contract. Never carries a bearer token or password hash. */
export interface AccessIdentity {
	userId: number;
	username: string;
	twoFactorEnabled: boolean;
}

export interface AccessAccountView {
	id: number;
	username: string;
}

export interface AccessPublicApi {
	needsSetup(): Promise<boolean>;
	/** Missing, invalid, expired and revoked cookies produce null. */
	authenticate(sessionToken: string | null): Promise<AccessIdentity | null>;
}
