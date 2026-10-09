import type { Account } from '../../accounts/model/account-types.js';

export interface AuthenticatedIdentity {
	userId: number;
	username: string;
	twoFactorEnabled: boolean;
}

export interface PasswordLogin {
	username: string;
	password: string;
	rememberMe: boolean;
	source: string;
	previousToken: string | null;
}

export type LoginAttempt =
	| {
			status: 'authenticated';
			token: string;
			identity: AuthenticatedIdentity;
			expiresAt: number;
			rememberMe: boolean;
	  }
	| { status: 'invalid_credentials' }
	| { status: 'rate_limited' }
	| { status: 'factor_unavailable' };

export function toIdentity(account: Account): AuthenticatedIdentity {
	return { userId: account.id, username: account.username, twoFactorEnabled: account.twoFactorEnabled };
}
