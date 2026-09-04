import { computed, ref } from 'vue';
import { startAuthentication } from '@simplewebauthn/browser';
import { securityApi } from '../api/securityApi';
import type { CaptchaConfig } from '../model/security';

export function useLoginSecurity() {
  const captchaConfig = ref<CaptchaConfig>({ enabled: false, provider: 'none' });
  const hasPasskeys = ref(false);
  const loading = ref(false);

  const refresh = async (username?: string): Promise<void> => {
    const [captcha, passkeyAvailable] = await Promise.all([
      securityApi.getCaptchaConfig().catch(() => ({ enabled: false, provider: 'none' }) as CaptchaConfig),
      securityApi.hasPasskeys(username).catch(() => false),
    ]);
    captchaConfig.value = captcha;
    hasPasskeys.value = passkeyAvailable;
  };

  const loginWithPasskey = async (username?: string): Promise<void> => {
    loading.value = true;
    try {
      const optionsJSON = await securityApi.getPasskeyAuthenticationOptions(username);
      const assertionResponse = await startAuthentication({ optionsJSON });
      await securityApi.authenticatePasskey(username, assertionResponse);
    } finally {
      loading.value = false;
    }
  };

  return {
    captchaConfig: computed(() => captchaConfig.value),
    hasPasskeys: computed(() => hasPasskeys.value),
    loading: computed(() => loading.value),
    refresh,
    loginWithPasskey,
  };
}
