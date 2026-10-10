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

export interface LoginFailureRecord {
	attempts: number;
	windowStartedAt: number;
	blockedUntil: number;
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
	recordFailedPassword(
		source: string,
		decide: (current: LoginFailureRecord | null) => LoginFailureRecord,
	): Promise<void>;
	getLoginFailure(source: string): Promise<LoginFailureRecord | null>;
}
