import type { Pinia } from 'pinia';
import { useAuthSession } from './composables/useAuthSession';
import { useAuthStore } from './store/auth.store';

export type { AuthUser, LoginCredentials, LoginResult, SetupCredentials } from './model/auth';
export { useAuthSession };

/** Router/bootstrap-only facade. It exposes Auth navigation state without exporting the internal Pinia store. */
export const createAuthNavigationFacade = (pinia: Pinia) => {
  const store = useAuthStore(pinia);

  return {
    resolveSetupState: (force = false) => store.resolveSetupState(force),
    resolveSession: (force = false) => store.resolveSession(force),
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
