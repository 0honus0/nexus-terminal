import { defineStore } from 'pinia';
import { authApi } from '../api/authApi';
import type {
  AuthSessionState,
  AuthUser,
  LoginCredentials,
  LoginResult,
  SetupCredentials,
  SetupState,
} from '../model/auth';

interface AuthStoreState {
  setupState: SetupState;
  sessionState: AuthSessionState;
  user: AuthUser | null;
  pendingSecondFactor: boolean;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthStoreState => ({
    setupState: 'unknown',
    sessionState: 'unknown',
    user: null,
    pendingSecondFactor: false,
  }),

  actions: {
    async resolveSetupState(force = false): Promise<SetupState> {
      if (!force && this.setupState !== 'unknown') return this.setupState;
      this.setupState = (await authApi.needsSetup()) ? 'required' : 'complete';
      if (this.setupState === 'required') {
        this.sessionState = 'anonymous';
        this.user = null;
        this.pendingSecondFactor = false;
      }
      return this.setupState;
    },

    async resolveSession(force = false): Promise<AuthSessionState> {
      if (!force && this.sessionState !== 'unknown') return this.sessionState;
      const user = await authApi.readSession();
      this.user = user;
      this.sessionState = user ? 'authenticated' : 'anonymous';
      if (!user) this.pendingSecondFactor = false;
      return this.sessionState;
    },

    async setup(credentials: SetupCredentials): Promise<void> {
      await authApi.setup(credentials);
      this.setupState = 'complete';
      this.sessionState = 'anonymous';
      this.user = null;
      this.pendingSecondFactor = false;
    },

    async login(credentials: LoginCredentials): Promise<LoginResult> {
      const result = await authApi.login(credentials);
      if (result.status === 'two-factor-required') {
        this.sessionState = 'anonymous';
        this.user = null;
        this.pendingSecondFactor = true;
        return result;
      }

      this.sessionState = 'authenticated';
      this.user = result.user;
      this.pendingSecondFactor = false;
      return result;
    },

    async verifyTwoFactor(token: string): Promise<AuthUser> {
      if (!this.pendingSecondFactor) throw new Error('No two-factor login challenge is active.');
      const user = await authApi.verifyTwoFactor(token);
      this.sessionState = 'authenticated';
      this.user = user;
      this.pendingSecondFactor = false;
      return user;
    },

    async logout(): Promise<void> {
      await authApi.logout();
      this.sessionState = 'anonymous';
      this.user = null;
      this.pendingSecondFactor = false;
    },
  },
});
