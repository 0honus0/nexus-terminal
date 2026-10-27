import { computed, type ComputedRef } from 'vue';
import type {
	AuthLoginRequest,
	AuthLoginResult,
	AuthSessionState,
	AuthSetupRequest,
	PasskeyLoginInput,
	AuthUser,
} from '../model/auth-types';
import { useAuthStore } from '../store/auth.store';

export interface AuthSessionController {
	user: ComputedRef<AuthUser | null>;
	isAuthenticated: ComputedRef<boolean>;
	setupRequired: ComputedRef<boolean>;
	pendingSecondFactor: ComputedRef<boolean>;
	setup(credentials: AuthSetupRequest): Promise<void>;
	login(credentials: AuthLoginRequest): Promise<AuthLoginResult>;
	loginWithPasskey(input: PasskeyLoginInput, signal?: AbortSignal): Promise<AuthUser>;
	verifyTwoFactor(token: string): Promise<AuthUser>;
	changePassword(currentPassword: string, newPassword: string): Promise<void>;
	logout(): Promise<void>;
	refreshSession(): Promise<AuthSessionState>;
}

export function useAuthSession(): AuthSessionController {
	const store = useAuthStore();

	return {
		user: computed(() => store.user),
		isAuthenticated: computed(() => store.sessionState === 'authenticated'),
		setupRequired: computed(() => store.setupState === 'required'),
		pendingSecondFactor: computed(() => store.pendingSecondFactor),
		setup: store.setup.bind(store),
		login: store.login.bind(store),
		loginWithPasskey: store.loginWithPasskey.bind(store),
		verifyTwoFactor: store.verifyTwoFactor.bind(store),
		changePassword: store.changePassword.bind(store),
		logout: store.logout.bind(store),

		refreshSession: () => store.resolveSession(true),
	};
}
