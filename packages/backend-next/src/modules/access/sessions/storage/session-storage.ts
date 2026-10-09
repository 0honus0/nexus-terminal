export interface SessionWrite {
	accountId: number;
	expectedPasswordHash: string;
	previousTokenDigest: string | null;
	newTokenDigest: string;
	expiresAt: number;
	rememberMe: boolean;
	source: string;
	clearLoginAttempts: boolean;
}

/** Technical persistence parameters supplied by the Access login policy. */
export interface FailureCounterCommand {
	source: string;
	now: number;
	maxAttempts: number;
	banMs: number;
	windowMs: number;
}

export interface SessionRecord {
	userId: number;
	username: string;
	twoFactorEnabled: boolean;
	passkeyRequired: boolean;
	createdAt: number;
	updatedAt: number;
	expiresAt: number;
}

export interface SessionStorage {
	issue(command: SessionWrite): Promise<boolean>;
	validate(tokenDigest: string, now: number): Promise<SessionRecord | null>;
	revoke(tokenDigest: string): Promise<void>;
	recordFailedPassword(command: FailureCounterCommand): Promise<void>;
	checkLoginAdmission(source: string, now: number): Promise<boolean>;
}
