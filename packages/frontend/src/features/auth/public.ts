import type { Pinia } from 'pinia';
import type { AuthSessionState, SetupState } from './model/auth-types';
import { useAuthSession } from './composables/useAuthSession';
import { useAuthStore } from './store/auth.store';

export { createPasskeyCeremony } from './adapters/browser-passkey';

export { createAccessApi } from './api/access-api';

export { authErrorKey } from './model/auth-errors';

export { AuthRequestFailure } from './model/auth-failure';

export type { AccessApi } from './api/access-api';

export { default as LoginView } from './views/LoginView.vue';

export const loadSetupView = () => import('./views/SetupView.vue');

export type {
	PasskeyLoginInput,
	AuthUser,
	AuthLoginRequest,
	AuthLoginResult,
	AuthSetupRequest,
	AuthSessionState,
	SetupState,
} from './model/auth-types';

export { useAuthSession };

export type { AuthSessionController } from './composables/useAuthSession';

export interface AuthNavigationFacade {
	resolveSetupState(force?: boolean): Promise<SetupState>;
	resolveSession(force?: boolean): Promise<AuthSessionState>;
	invalidateSession(): void;
	readonly setupRequired: boolean;
	readonly setupResolved: boolean;
	readonly authenticated: boolean;
	readonly sessionResolved: boolean;
}

/** Router/bootstrap-only facade. It exposes Auth navigation state without exporting the internal Pinia store. */
export const createAuthNavigationFacade = (pinia: Pinia): AuthNavigationFacade => {
	const store = useAuthStore(pinia);

	return {
		resolveSetupState: (force = false) => store.resolveSetupState(force),

		resolveSession: (force = false) => store.resolveSession(force),

		invalidateSession: () => store.invalidateSession(),

		get setupRequired() {
			return store.setupState === 'required';
		},

		get setupResolved() {
			return store.setupState !== 'unknown';
		},

		get authenticated() {
			return store.sessionState === 'authenticated';
		},

		get sessionResolved() {
			return store.sessionState !== 'unknown';
		},
	};
};
