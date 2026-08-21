import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import pkg from '../../../package.json'; // 路径相对于当前文件
import { useI18n } from 'vue-i18n';
import { isNewerRelease, latestReleaseApiUrl } from '../../config/release';

export function useAboutSection() {
  const { t } = useI18n();
  const appVersion = ref(pkg.version);

  // --- Version Check State ---
  const latestVersion = ref<string | null>(null);
  const isCheckingVersion = ref(false);
  const versionCheckError = ref<string | null>(null);

  const isUpdateAvailable = computed(() => {
    return latestVersion.value ? isNewerRelease(latestVersion.value, appVersion.value) : false;
  });

  const checkLatestVersion = async () => {
    isCheckingVersion.value = true;
    versionCheckError.value = null;
    latestVersion.value = null; // Reset before check
    try {
      const response = await axios.get(latestReleaseApiUrl, {
        // 移除 headers 以尝试解决潜在的CORS或请求问题，GitHub API 通常不需要特定 headers 进行公共读取
      });
      if (response.data && response.data.tag_name) {
        latestVersion.value = response.data.tag_name;
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (error: any) {
      console.error('检查最新版本失败:', error);
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          versionCheckError.value = t('settings.about.error.noReleases', '没有找到发布版本。');
        } else if (error.response?.status === 403) {
          versionCheckError.value = t('settings.about.error.rateLimit', 'API 访问频率受限，请稍后再试。');
        } else {
          versionCheckError.value = t('settings.about.error.checkFailed', '检查更新失败，请检查网络连接或稍后再试。');
        }
      } else {
        versionCheckError.value = t('settings.about.error.checkFailed', '检查更新失败，请检查网络连接或稍后再试。');
      }
    } finally {
      isCheckingVersion.value = false;
    }
  };

  onMounted(() => {
    checkLatestVersion();
  });

  return {
    appVersion,
    latestVersion,
    isCheckingVersion,
    versionCheckError,
    isUpdateAvailable,
    checkLatestVersion, // Expose if manual refresh is needed
  };
}
