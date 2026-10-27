export interface SessionWrite {
	accountId: number;
	expectedPasswordHash: string;
	newTokenDigest: string;
	expiresAt: number;
	rememberMe: boolean;
	source: string;
	clearLoginAttempts: boolean;
	signal?: AbortSignal;
}

export interface LoginFailureRecord {
	attempts: number;
	windowStartedAt: number;
	blockedUntil: number;
	lastAttemptAt: number;
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

export type SessionIssueResult = 'issued' | 'credentials_changed' | 'rate_limited' | 'cancelled';

/** Authorization consumes storage facts; the bearer remains in Model. */
export interface SessionTransactionAdmission {
	tokenDigest: string;
	admit(record: SessionRecord | null): void;
}

export interface SessionStorage {
	issue(command: SessionWrite): Promise<SessionIssueResult>;
	validate(tokenDigest: string, now: () => number): Promise<SessionRecord | null>;
	revoke(tokenDigest: string): Promise<void>;
	recordFailedPassword(
		source: string,
		decide: (current: LoginFailureRecord | null) => LoginFailureRecord,
	): Promise<void>;
	getLoginFailure(source: string): Promise<LoginFailureRecord | null>;
	listLoginFailures(
		admission: SessionTransactionAdmission,
		limit: number,
		offset: number,
	): Promise<{ entries: Array<{ source: string; record: LoginFailureRecord }>; total: number }>;
	clearLoginFailure(source: string, admission: SessionTransactionAdmission): Promise<boolean>;
}
