import type { Account } from '../../accounts/model/account-types.js';

export interface SessionIdentity {
	account: Account;
	expiresAt: number;
}
