/** Persistence input is owned by storage, not the Account application model. */
export interface CreateInitialAdminRecord {
	username: string;
	passwordHash: string;
}

export interface AccountRecord {
	id: number;
	username: string;
	passwordHash: string;
	twoFactorEnabled: boolean;
	passkeyRequired: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface AccountStorage {
	needsSetup(): Promise<boolean>;
	findByUsername(username: string): Promise<AccountRecord | null>;
	findById(id: number): Promise<AccountRecord | null>;
	createInitialAdmin(command: CreateInitialAdminRecord): Promise<AccountRecord | null>;
	updatePasswordAndRevoke(userId: number, expectedHash: string, newHash: string): Promise<boolean>;
}
