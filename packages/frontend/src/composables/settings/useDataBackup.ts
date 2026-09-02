import { ref } from 'vue';
import { isAxiosError } from 'axios';
import apiClient from '../../utils/apiClient';

const extractErrorMessage = async (error: unknown, fallback: string): Promise<string> => {
  if (isAxiosError(error) && error.response?.data) {
    const data = error.response.data;
    if (data instanceof Blob) {
      try {
        const parsed = JSON.parse(await data.text());
        if (typeof parsed?.message === 'string') return parsed.message;
      } catch {
        /* ignore malformed error response */
      }
    }
    if (typeof data === 'string') return data;
    if (typeof data?.message === 'string') return data.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export function useDataBackup() {
  const exportPassword = ref('');
  const exportLoading = ref(false);
  const exportMessage = ref('');
  const exportSuccess = ref(false);

  const importPassword = ref('');
  const selectedBackupFile = ref<File | null>(null);
  const importLoading = ref(false);
  const importMessage = ref('');
  const importSuccess = ref(false);

  const handleExportBackup = async () => {
    exportLoading.value = true;
    exportMessage.value = '';
    exportSuccess.value = false;
    try {
      const response = await apiClient.post(
        '/settings/backup/export',
        {
          password: exportPassword.value,
        },
        {
          responseType: 'blob',
          timeout: 120_000,
        },
      );

      let filename = 'nexus-terminal-backup.nexus-backup';
      const disposition = response.headers['content-disposition'];
      if (typeof disposition === 'string') {
        const match = /filename[^;=\n]*=(?:(['"])(.*?)\1|([^;\n]*))/.exec(disposition);
        if (match && (match[2] || match[3])) filename = (match[2] || match[3]).trim();
      }

      const blob = new Blob([response.data], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      exportPassword.value = '';
      exportSuccess.value = true;
      exportMessage.value = '完整备份已导出。请妥善保存备份文件和导出时使用的密码。';
    } catch (error) {
      exportMessage.value = await extractErrorMessage(error, '导出完整备份失败。');
    } finally {
      exportLoading.value = false;
    }
  };

  const handleBackupFileChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    selectedBackupFile.value = input.files?.[0] ?? null;
    importMessage.value = '';
    importSuccess.value = false;
  };

  const handleImportBackup = async () => {
    if (!selectedBackupFile.value) {
      importMessage.value = '请先选择备份文件。';
      importSuccess.value = false;
      return;
    }

    importLoading.value = true;
    importMessage.value = '';
    importSuccess.value = false;
    try {
      const formData = new FormData();
      formData.append('backupFile', selectedBackupFile.value);
      if (importPassword.value) formData.append('password', importPassword.value);

      const response = await apiClient.post('/settings/backup/import', formData, {
        timeout: 120_000,
      });
      const rows = Number(response.data?.restoredRows ?? 0);
      const files = Number(response.data?.restoredFiles ?? 0);
      importSuccess.value = true;
      importMessage.value = `备份导入成功：恢复 ${rows} 条数据、${files} 个文件。页面即将刷新。`;
      importPassword.value = '';
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      importMessage.value = await extractErrorMessage(error, '导入完整备份失败。');
    } finally {
      importLoading.value = false;
    }
  };

  return {
    exportPassword,
    exportLoading,
    exportMessage,
    exportSuccess,
    importPassword,
    selectedBackupFile,
    importLoading,
    importMessage,
    importSuccess,
    handleExportBackup,
    handleBackupFileChange,
    handleImportBackup,
  };
}
