import { createAccessApi } from './access-api';
import { toAuthUser } from '../model/auth-mapper';
import type { AuthUser, AuthLoginRequest, AuthLoginResult, AuthSetupRequest } from '../model/auth-types';

export interface AuthApi {
	changePassword(currentPassword: string, newPassword: string): Promise<void>;
	needsSetup(): Promise<boolean>;
	readSession(): Promise<AuthUser | null>;
	setup(credentials: AuthSetupRequest): Promise<void>;
	login(credentials: AuthLoginRequest): Promise<AuthLoginResult>;
	verifyTwoFactor(token: string): Promise<AuthUser>;
	logout(): Promise<void>;
}

// Construct lazily so importing a feature has no browser-side network or location dependency.
export const authApi: AuthApi = {
	async changePassword(currentPassword, newPassword) {
		await createAccessApi().changePassword({ currentPassword, newPassword });
	},

	needsSetup: () => createAccessApi().needsSetup(),

	async readSession() {
		const result = await createAccessApi().status();
		return result === null ? null : toAuthUser(result.user);
	},

	async setup(credentials) {
		await createAccessApi().setup(credentials);
	},

	async login(credentials) {
		const result = await createAccessApi().login(credentials);
		return result.requiresTwoFactor
			? { status: 'two-factor-required' }
			: { status: 'authenticated', user: toAuthUser(result.user) };
	},

	async verifyTwoFactor(token) {
		return toAuthUser((await createAccessApi().verifyTwoFactor(token)).user);
	},

	async logout() {
		await createAccessApi().logout();
	},
};
