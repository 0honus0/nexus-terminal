import { computed, type ComputedRef } from 'vue';
import type {
  AuthLoginRequestDto,
  AuthLoginResultViewModel,
  AuthSessionState,
  AuthSetupRequestDto,
  AuthUserDto,
} from '../model/auth';
import { useAuthStore } from '../store/auth.store';

export interface AuthSessionController {
  user: ComputedRef<AuthUserDto | null>;
  isAuthenticated: ComputedRef<boolean>;
  setupRequired: ComputedRef<boolean>;
  pendingSecondFactor: ComputedRef<boolean>;
  setup(credentials: AuthSetupRequestDto): Promise<void>;
  login(credentials: AuthLoginRequestDto): Promise<AuthLoginResultViewModel>;
  verifyTwoFactor(token: string): Promise<AuthUserDto>;
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
    verifyTwoFactor: store.verifyTwoFactor.bind(store),
    logout: store.logout.bind(store),
    refreshSession: () => store.resolveSession(true),
  };
}
