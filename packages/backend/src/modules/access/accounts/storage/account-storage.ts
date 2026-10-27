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

export interface PasswordUpdateRecord {
	userId: number;
	expectedHash: string;
	newHash: string;
	sessionDigest: string;
}

export interface CredentialConfirmation {
	userId: number;
	passwordHash: string;
	sessionDigest: string;
	now(): number;
}

export interface AccountStorage {
	confirmCredential(input: CredentialConfirmation): Promise<boolean>;
	needsSetup(): Promise<boolean>;
	findByUsername(username: string): Promise<AccountRecord | null>;
	findById(id: number): Promise<AccountRecord | null>;
	createInitialAdmin(command: CreateInitialAdminRecord): Promise<AccountRecord | null>;
	updatePasswordAndRevoke(command: PasswordUpdateRecord): Promise<boolean>;
}
