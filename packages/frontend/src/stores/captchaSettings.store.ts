import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { useAuthStore } from './auth.store';

/** CAPTCHA 服务商类型 */
type CaptchaProvider = 'hcaptcha' | 'recaptcha' | 'none';

/** CAPTCHA 设置状态接口 */
interface CaptchaSettings {
  enabled: boolean;
  provider: CaptchaProvider;
  hcaptchaSiteKey?: string;
  hcaptchaSecretKey?: string;
  recaptchaSiteKey?: string;
  recaptchaSecretKey?: string;
}

/** CAPTCHA 设置更新 DTO */
interface UpdateCaptchaSettingsDto {
  enabled?: boolean;
  provider?: CaptchaProvider;
  hcaptchaSiteKey?: string;
  hcaptchaSecretKey?: string;
  recaptchaSiteKey?: string;
  recaptchaSecretKey?: string;
}

/** 从错误对象中提取可读消息 */
const getApiErrorMessage = (err: unknown, fallback: string): string => {
  const apiErr = err as {
    response?: { data?: unknown };
    message?: string;
  };
  const data = apiErr.response?.data;

  if (typeof data === 'string' && data.trim()) return data.trim();

  if (typeof data === 'object' && data !== null) {
    const obj = data as { message?: unknown; error?: { message?: unknown } };
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    if (typeof obj.error?.message === 'string' && obj.error.message.trim())
      return obj.error.message.trim();
  }

  return extractErrorMessage(err, fallback);
};

/**
 * CAPTCHA 设置独立 Store
 * 从 settings.store.ts 中提取，负责验证码配置的加载与更新
 */
export const useCaptchaSettingsStore = defineStore('captchaSettings', () => {
  // --- State ---
  const captchaSettings = ref<CaptchaSettings | null>(null);
  const captchaError = ref<string | null>(null);
  const isLoading = ref(false);

  // --- Getters ---
  const isCaptchaEnabled = computed(() => captchaSettings.value?.enabled ?? false);
  const captchaProvider = computed(() => captchaSettings.value?.provider ?? 'none');
  const hcaptchaSiteKey = computed(() => captchaSettings.value?.hcaptchaSiteKey ?? '');
  const recaptchaSiteKey = computed(() => captchaSettings.value?.recaptchaSiteKey ?? '');

  // --- Actions ---

  /** 从后端加载 CAPTCHA 设置 */
  async function loadCaptchaSettings() {
    isLoading.value = true;
    captchaError.value = null;
    try {
      console.info('[CaptchaSettingsStore] 加载 CAPTCHA 设置...');
      const response = await apiClient.get<CaptchaSettings>('/settings/captcha');
      captchaSettings.value = response.data;
      console.info('[CaptchaSettingsStore] CAPTCHA 设置加载完成:', {
        ...response.data,
        hcaptchaSecretKey: '***',
        recaptchaSecretKey: '***',
      });
    } catch (err: unknown) {
      console.error('加载 CAPTCHA 设置失败:', err);
      captchaError.value = getApiErrorMessage(err, '加载 CAPTCHA 设置失败');
      captchaSettings.value = null;
    } finally {
      isLoading.value = false;
    }
  }

  /** 更新 CAPTCHA 设置 */
  async function updateCaptchaSettings(updates: UpdateCaptchaSettingsDto) {
    isLoading.value = true;
    captchaError.value = null;
    try {
      console.info('[CaptchaSettingsStore] 更新 CAPTCHA 设置:', {
        ...updates,
        hcaptchaSecretKey: '***',
        recaptchaSecretKey: '***',
      });
      await apiClient.put('/settings/captcha', updates);

      if (captchaSettings.value) {
        captchaSettings.value = { ...captchaSettings.value, ...updates };
      } else {
        await loadCaptchaSettings();
      }
      console.info('[CaptchaSettingsStore] CAPTCHA 设置更新成功。');

      // 强制 authStore 重新获取 CAPTCHA 配置
      const authStore = useAuthStore();
      authStore.publicCaptchaConfig = null;
      await authStore.fetchCaptchaConfig();
    } catch (err: unknown) {
      console.error('更新 CAPTCHA 设置失败:', err);
      captchaError.value = getApiErrorMessage(err, '更新 CAPTCHA 设置失败');
      throw new Error(captchaError.value);
    } finally {
      isLoading.value = false;
    }
  }

  return {
    // State
    captchaSettings,
    captchaError,
    isLoading,
    // Getters
    isCaptchaEnabled,
    captchaProvider,
    hcaptchaSiteKey,
    recaptchaSiteKey,
    // Actions
    loadCaptchaSettings,
    updateCaptchaSettings,
  };
});
