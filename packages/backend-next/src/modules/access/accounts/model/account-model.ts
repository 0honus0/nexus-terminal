import type { AccountStorage, AccountRecord } from '../storage/account-storage.js';
import type { Account, AuthenticatingAccount, InitialAdminCommand, ChangePasswordCommand } from './account-types.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { PasswordHasher } from '../../../../platform/security/password-hasher.js';

import { accessStorageBoundary } from '../../access-storage-boundary.js';
import { AccessFailure } from '../../authentication/model/access-failure.js';

export class AccountModel {
	private dummyHash: Promise<string> | null = null;

	constructor(
		private readonly storage: Readonly<AccountStorage>,
		private readonly hasher: PasswordHasher,
		private readonly tokens: SessionTokens,
	) {}

	async hashPassword(password: string): Promise<string> {
		try {
			return await this.hasher.hash(password);
		} catch (error) {
			throw new AccessFailure('internal_failure', { cause: error });
		}
	}

	async verifyPassword(password: string, account: AuthenticatingAccount | null): Promise<boolean> {
		try {
			const hash =
				account?.passwordHash ?? (await (this.dummyHash ??= this.hashPassword('never-used-unknown-account')));
			return (await this.hasher.verify(password, hash)) && account !== null;
		} catch (error) {
			throw new AccessFailure('internal_failure', { cause: error });
		}
	}

	needsSetup(): Promise<boolean> {
		return accessStorageBoundary(() => this.storage.needsSetup());
	}

	async getById(id: number): Promise<AuthenticatingAccount | null> {
		const record = await accessStorageBoundary(() => this.storage.findById(id));
		return record === null ? null : this.toAuthenticatingAccount(record);
	}

	async getByUsername(username: string): Promise<AuthenticatingAccount | null> {
		const record = await accessStorageBoundary(() => this.storage.findByUsername(username));
		return record === null ? null : this.toAuthenticatingAccount(record);
	}

	async createInitialAdmin(command: InitialAdminCommand): Promise<Account | null> {
		const created = await accessStorageBoundary(() =>
			this.storage.createInitialAdmin({
				username: command.username,
				passwordHash: command.passwordHash,
			}),
		);
		return created === null ? null : this.toAccount(created);
	}

	changePassword(command: ChangePasswordCommand): Promise<boolean> {
		return accessStorageBoundary(() =>
			this.storage.updatePasswordAndRevoke({
				userId: command.accountId,
				expectedHash: command.expectedHash,
				newHash: command.newHash,
				sessionDigest: this.tokens.digest(command.sessionToken),
			}),
		);
	}

	private toAuthenticatingAccount(record: AccountRecord): AuthenticatingAccount {
		return {
			id: record.id,
			username: record.username,
			twoFactorEnabled: record.twoFactorEnabled,
			passkeyRequired: record.passkeyRequired,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			passwordHash: record.passwordHash,
		};
	}

	private toAccount(account: AccountRecord): Account {
		return {
			id: account.id,
			username: account.username,
			twoFactorEnabled: account.twoFactorEnabled,
			passkeyRequired: account.passkeyRequired,
			createdAt: account.createdAt,
			updatedAt: account.updatedAt,
		};
	}
}
