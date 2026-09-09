import { computed } from 'vue';
import { useAuthStore } from '../store/auth.store';

export function useAuthSession() {
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
