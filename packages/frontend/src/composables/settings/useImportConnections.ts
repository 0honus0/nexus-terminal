import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { isAxiosError } from 'axios';
import apiClient from '../../utils/apiClient';

/** 导入连接的 composable，提供文件选择、上传与结果反馈 */
export function useImportConnections() {
  const { t } = useI18n();

  const importLoading = ref(false);
  const importMessage = ref('');
  const importSuccess = ref(false);
  const importResult = ref<{
    successCount: number;
    failureCount: number;
    errors: { connectionName?: string; message: string }[];
  } | null>(null);

  /**
   * 处理连接数据导入
   * @param file 用户选择的 JSON 文件
   */
  const handleImportConnections = async (file: File) => {
    importLoading.value = true;
    importMessage.value = '';
    importSuccess.value = false;
    importResult.value = null;

    try {
      const formData = new FormData();
      formData.append('connectionsFile', file);

      const response = await apiClient.post('/connections/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000, // 导入可能需要更长时间
      });

      const data = response.data;
      importResult.value = {
        successCount: data.successCount ?? 0,
        failureCount: data.failureCount ?? 0,
        errors: data.errors ?? [],
      };

      if (data.failureCount > 0) {
        importMessage.value = t(
          'settings.importConnections.partialSuccess',
          `导入完成，成功 {success} 条，失败 {failure} 条。`
            .replace('{success}', String(data.successCount))
            .replace('{failure}', String(data.failureCount))
        );
        importSuccess.value = false;
      } else {
        importMessage.value = t(
          'settings.importConnections.success',
          `导入成功完成。共导入 {count} 条连接。`.replace('{count}', String(data.successCount))
        );
        importSuccess.value = true;
      }
    } catch (error: unknown) {
      console.error('导入连接失败:', error);
      let message = t('settings.importConnections.error', '导入连接时发生错误。');
      if (isAxiosError(error) && error.response?.data) {
        const data = error.response.data;
        if (typeof data === 'object' && data !== null && typeof data.message === 'string') {
          message = data.message;
        } else if (typeof data === 'string') {
          message = data;
        }
      } else if (error instanceof Error && error.message) {
        message = error.message;
      }
      importMessage.value = message;
      importSuccess.value = false;
    } finally {
      importLoading.value = false;
    }
  };

  /** 重置导入状态 */
  const resetImportState = () => {
    importMessage.value = '';
    importSuccess.value = false;
    importResult.value = null;
  };

  return {
    importLoading,
    importMessage,
    importSuccess,
    importResult,
    handleImportConnections,
    resetImportState,
  };
}
