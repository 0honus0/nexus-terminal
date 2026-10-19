import { defineStore } from 'pinia';
import { createAccessApi } from '../api/access-api';
import { createPasskeyCeremony } from '../adapters/browser-passkey';
import { toAuthUser } from '../model/auth-mapper';
import { authApi } from '../api/auth-api';
import { AuthRequestFailure } from '../model/auth-failure';
import type {
	AuthSessionState,
	PasskeyLoginInput,
	AuthUser,
	AuthLoginRequest,
	AuthLoginResult,
	AuthSetupRequest,
	SetupState,
} from '../model/auth-types';

interface AuthStoreState {
	setupState: SetupState;
	sessionState: AuthSessionState;
	user: AuthUser | null;
	pendingSecondFactor: boolean;
	setupGeneration: number;
	sessionGeneration: number;
}

// Browser ceremonies belong to their Store instance, outside serializable application state.
const passkeyCeremonies = new WeakMap<object, AbortController>();

export const useAuthStore = defineStore('auth', {
	state: (): AuthStoreState => ({
		setupState: 'unknown',
		sessionState: 'unknown',
		user: null,
		pendingSecondFactor: false,
		setupGeneration: 0,
		sessionGeneration: 0,
	}),

	actions: {
		async resolveSetupState(force = false): Promise<SetupState> {
			if (!force && this.setupState !== 'unknown') {
				return this.setupState;
			}
			const generation = ++this.setupGeneration;
			try {
				const required = await authApi.needsSetup();
				if (generation !== this.setupGeneration) {
					return this.setupState;
				}
				this.setupState = required ? 'required' : 'complete';
				if (required) {
					this.invalidateSession();
				}
			} catch {
				if (generation === this.setupGeneration) {
					this.setupState = 'unknown';
				}
			}
			return this.setupState;
		},

		async resolveSession(force = false): Promise<AuthSessionState> {
			if (!force && this.sessionState !== 'unknown') {
				return this.sessionState;
			}
			passkeyCeremonies.get(this)?.abort();
			const generation = ++this.sessionGeneration;
			try {
				const user = await authApi.readSession();
				if (generation !== this.sessionGeneration) {
					return this.sessionState;
				}
				this.user = user;
				this.sessionState = user ? 'authenticated' : 'anonymous';
				if (user) {
					this.pendingSecondFactor = false;
				}
			} catch {
				if (generation === this.sessionGeneration) {
					this.user = null;
					this.sessionState = 'unknown';
				}
			}
			return this.sessionState;
		},

		beginAuthentication(): number {
			passkeyCeremonies.get(this)?.abort();
			this.setupGeneration += 1;
			this.sessionGeneration += 1;
			this.user = null;
			this.sessionState = 'unknown';
			this.pendingSecondFactor = false;
			return this.sessionGeneration;
		},

		assertCurrent(generation: number): void {
			if (generation !== this.sessionGeneration) {
				throw new AuthRequestFailure('cancelled', 'unknown');
			}
		},

		async setup(credentials: AuthSetupRequest): Promise<void> {
			const generation = this.beginAuthentication();
			this.setupState = 'unknown';
			await authApi.setup(credentials);
			this.assertCurrent(generation);
			this.setupState = 'complete';
			this.sessionState = 'anonymous';
		},

		async login(credentials: AuthLoginRequest): Promise<AuthLoginResult> {
			const generation = this.beginAuthentication();
			const result = await authApi.login(credentials);
			this.assertCurrent(generation);
			this.setupState = 'complete';
			if (result.status === 'two-factor-required') {
				this.sessionState = 'anonymous';
				this.pendingSecondFactor = true;
			} else {
				this.sessionState = 'authenticated';
				this.user = result.user;
			}
			return result;
		},

		async loginWithPasskey(input: PasskeyLoginInput, signal?: AbortSignal): Promise<AuthUser> {
			const generation = this.beginAuthentication();
			const controller = new AbortController();
			passkeyCeremonies.set(this, controller);
			const operationSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
			try {
				const api = createAccessApi().passkeys;
				const options = await api.authenticationOptions(input.username, operationSignal);
				this.assertCurrent(generation);
				const credential = await createPasskeyCeremony().authenticate(options, operationSignal);
				this.assertCurrent(generation);
				const result = await api.authenticate(credential, input.rememberMe, operationSignal);
				this.assertCurrent(generation);
				const user = toAuthUser(result.user);
				this.user = user;
				this.sessionState = 'authenticated';
				this.setupState = 'complete';
				return user;
			} finally {
				if (passkeyCeremonies.get(this) === controller) {
					passkeyCeremonies.delete(this);
				}
			}
		},

		async verifyTwoFactor(token: string): Promise<AuthUser> {
			if (!this.pendingSecondFactor) {
				throw new AuthRequestFailure('challenge_expired', 'not_dispatched');
			}
			const generation = ++this.sessionGeneration;
			try {
				const user = await authApi.verifyTwoFactor(token);
				this.assertCurrent(generation);
				this.sessionState = 'authenticated';
				this.user = user;
				this.pendingSecondFactor = false;
				return user;
			} catch (cause) {
				if (generation === this.sessionGeneration && cause instanceof AuthRequestFailure) {
					if (cause.code === 'challenge_expired' || cause.code === 'unauthenticated') {
						this.pendingSecondFactor = false;
					}
				}
				throw cause;
			}
		},

		invalidateSession(): void {
			passkeyCeremonies.get(this)?.abort();
			this.sessionGeneration += 1;
			this.sessionState = 'anonymous';
			this.user = null;
			this.pendingSecondFactor = false;
		},

		async changePassword(currentPassword: string, newPassword: string): Promise<void> {
			const generation = ++this.sessionGeneration;
			try {
				await authApi.changePassword(currentPassword, newPassword);
				this.assertCurrent(generation);
				this.invalidateSession();
			} catch (cause) {
				if (
					generation === this.sessionGeneration &&
					cause instanceof AuthRequestFailure &&
					cause.status === 401 &&
					cause.code === 'unauthenticated'
				) {
					this.invalidateSession();
				}
				if (
					generation === this.sessionGeneration &&
					(!(cause instanceof AuthRequestFailure) || cause.outcome === 'unknown')
				) {
					// An unconfirmed password write may have revoked every server session.
					this.sessionGeneration += 1;
					this.sessionState = 'unknown';
					this.user = null;
					this.pendingSecondFactor = false;
				}
				throw cause;
			}
		},

		async logout(): Promise<void> {
			const generation = this.beginAuthentication();
			await authApi.logout();
			this.assertCurrent(generation);
			this.invalidateSession();
		},
	},
});
