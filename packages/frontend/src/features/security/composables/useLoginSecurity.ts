import { computed, ref } from 'vue';
import { startAuthentication } from '@simplewebauthn/browser';
import { securityApi } from '../api/securityApi';
import type { CaptchaConfig } from '../model/security';

type CaptchaStatus = 'loading' | 'ready' | 'error' | 'invalid';

const DEFAULT_CAPTCHA_CONFIG: CaptchaConfig = { enabled: false, provider: 'none' };

const hasValue = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const hasConfiguredCaptchaWidget = (config: CaptchaConfig): boolean => {
  if (!config.enabled) return true;
  if (config.provider === 'hcaptcha') return hasValue(config.hcaptchaSiteKey);
  if (config.provider === 'recaptcha') return hasValue(config.recaptchaSiteKey);
  return false;
};

export function useLoginSecurity() {
  const captchaConfig = ref<CaptchaConfig>(DEFAULT_CAPTCHA_CONFIG);
  const captchaLoading = ref(true);
  const captchaLoadError = ref(false);
  const hasPasskeys = ref(false);
  const loading = ref(false);

  const refresh = async (username?: string): Promise<void> => {
    captchaLoading.value = true;
    captchaLoadError.value = false;
    const captcha = securityApi
      .getCaptchaConfig()
      .then((config) => {
        captchaConfig.value = config;
      })
      .catch(() => {
        captchaConfig.value = DEFAULT_CAPTCHA_CONFIG;
        captchaLoadError.value = true;
      })
      .finally(() => {
        captchaLoading.value = false;
      });
    const passkeys = securityApi.hasPasskeys(username).catch(() => false);
    const [, passkeyAvailable] = await Promise.all([captcha, passkeys]);
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
    captchaStatus: computed<CaptchaStatus>(() => {
      if (captchaLoading.value) return 'loading';
      if (captchaLoadError.value) return 'error';
      if (!hasConfiguredCaptchaWidget(captchaConfig.value)) return 'invalid';
      return 'ready';
    }),
    hasPasskeys: computed(() => hasPasskeys.value),
    loading: computed(() => loading.value),
    refresh,
    loginWithPasskey,
  };
}
