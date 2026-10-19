import type { Account } from '../../accounts/model/account-types.js';

export interface LoginFailureState {
	attempts: number;
	windowStartedAt: number;
	blockedUntil: number;
	lastAttemptAt: number;
}

export interface LoginFailureView {
	sourceIp: string;
	attempts: number;
	lastAttemptAt: number;
	blockedUntil: number | null;
}

export interface LoginFailurePage {
	entries: LoginFailureView[];
	total: number;
}

export interface SessionIdentity {
	account: Account;
	expiresAt: number;
}

/** Application command distinct from storage token digest and transaction fields. */
export interface IssueSessionRequest {
	accountId: number;
	passwordHash: string;
	rememberMe: boolean;
	expiresAt: number;
	source: string;
	clearLoginAttempts: boolean;
	signal?: AbortSignal;
}

export type IssueSessionResult =
	| { status: 'issued'; token: string }
	| { status: 'credentials_changed' }
	| { status: 'rate_limited' }
	| { status: 'cancelled' };

/** Application authorization evaluated against the transaction's current session. */
export interface LoginFailureAdmission {
	token: string;
	admit(identity: SessionIdentity | null): void;
}
