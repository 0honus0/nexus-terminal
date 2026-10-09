import type { AccountStorage, AccountRecord } from '../storage/account-storage.js';
import type { Account, AuthenticatingAccount, InitialAdminCommand } from './account-types.js';

export class AccountModel {
	constructor(private readonly storage: Readonly<AccountStorage>) {}

	needsSetup(): Promise<boolean> {
		return this.storage.needsSetup();
	}

	async getById(id: number): Promise<AuthenticatingAccount | null> {
		const record = await this.storage.findById(id);
		return record === null ? null : this.toAuthenticatingAccount(record);
	}

	async getByUsername(username: string): Promise<AuthenticatingAccount | null> {
		const record = await this.storage.findByUsername(username);
		return record === null ? null : this.toAuthenticatingAccount(record);
	}

	async createInitialAdmin(command: InitialAdminCommand): Promise<Account | null> {
		const created = await this.storage.createInitialAdmin({
			username: command.username,
			passwordHash: command.passwordHash,
		});
		return created === null ? null : this.toAccount(created);
	}

	changePassword(id: number, oldHash: string, newHash: string): Promise<boolean> {
		return this.storage.updatePasswordAndRevoke(id, oldHash, newHash);
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
