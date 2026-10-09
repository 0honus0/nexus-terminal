export interface Account {
	id: number;
	username: string;
	createdAt: number;
	updatedAt: number;
	twoFactorEnabled: boolean;
	passkeyRequired: boolean;
}

export interface AuthenticatingAccount extends Account {
	passwordHash: string;
}

export interface InitialAdminCommand {
	username: string;
	passwordHash: string;
}
