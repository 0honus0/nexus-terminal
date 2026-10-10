import type { Account } from '../../accounts/model/account-types.js';

export interface SessionIdentity {
	account: Account;
	expiresAt: number;
}

/** Application command distinct from storage token digest and transaction fields. */
export interface IssueSessionRequest {
	accountId: number;
	passwordHash: string;
	previousToken: string | null;
	rememberMe: boolean;
	expiresAt: number;
	source: string;
	clearLoginAttempts: boolean;
}
