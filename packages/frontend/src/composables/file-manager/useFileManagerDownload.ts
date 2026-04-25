/**
 * 文件管理器下载逻辑
 * 从 FileManager.vue 提取，负责文件和目录的下载触发
 */

import type { ComputedRef } from 'vue';
import type { SftpManagerInstance, WebSocketDependencies } from '../../composables/useSftpActions';
import type { FileListItem } from '../../types/sftp.types';

export interface UseFileManagerDownloadOptions {
  /** SFTP 管理器实例（响应式） */
  currentSftpManager: ComputedRef<SftpManagerInstance | null>;
  /** WebSocket 依赖项 */
  wsDeps: WebSocketDependencies;
  /** 数据库连接 ID */
  dbConnectionId: string;
  /** 会话 ID */
  sessionId: string;
  /** 实例 ID */
  instanceId: string;
}

export function useFileManagerDownload(options: UseFileManagerDownloadOptions) {
  const { currentSftpManager, wsDeps, dbConnectionId, sessionId, instanceId } = options;

  const logPrefix = `[FileManager ${sessionId}-${instanceId}]`;

  /** 触发文件下载（支持多文件） */
  const triggerDownload = (items: FileListItem[]) => {
    if (!wsDeps.isConnected.value) {
      return;
    }
    if (!dbConnectionId) {
      console.error(`${logPrefix} Cannot download: Missing connection ID.`);
      return;
    }
    const manager = currentSftpManager.value;
    if (!manager) {
      console.error(`${logPrefix} Cannot download: SFTP manager is not available.`);
      return;
    }

    items.forEach((item) => {
      if (!item.attrs.isFile) {
        console.warn(`${logPrefix} Skipping download for non-file item: ${item.filename}`);
        return;
      }

      const downloadPath = manager.joinPath(manager.currentPath.value, item.filename);
      const downloadUrl = `/api/v1/sftp/download?connectionId=${dbConnectionId}&remotePath=${encodeURIComponent(downloadPath)}`;
      console.info(`${logPrefix} Triggering download for ${item.filename}: ${downloadUrl}`);

      const link = document.createElement('a');
      link.href = downloadUrl;
      // 移除文件名中的双引号以兼容 Chrome
      const safeFilename = item.filename.replace(/"/g, '');
      link.setAttribute('download', safeFilename);
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
    });
  };

  /** 触发目录下载（通过后端压缩后下载） */
  const triggerDownloadDirectory = (item: FileListItem) => {
    if (!wsDeps.isConnected.value) {
      return;
    }
    if (!dbConnectionId) {
      console.error(`${logPrefix} Cannot download directory: Missing connection ID.`);
      return;
    }
    const manager = currentSftpManager.value;
    if (!manager) {
      console.error(`${logPrefix} Cannot download directory: SFTP manager is not available.`);
      return;
    }

    if (!item.attrs.isDirectory) {
      console.warn(
        `${logPrefix} Skipping directory download for non-directory item: ${item.filename}`
      );
      return;
    }

    const directoryPath = manager.joinPath(manager.currentPath.value, item.filename);
    const downloadUrl = `/api/v1/sftp/download-directory?connectionId=${dbConnectionId}&remotePath=${encodeURIComponent(directoryPath)}`;

    console.info(`${logPrefix} Attempting directory download for ${item.filename}: ${downloadUrl}`);

    fetch(downloadUrl)
      .then(async (response) => {
        if (response.ok) {
          const blob = await response.blob();
          const contentDisposition = response.headers.get('content-disposition');
          let filename = `${item.filename}.zip`;
          if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
            if (filenameMatch && filenameMatch.length > 1) {
              filename = filenameMatch[1];
            }
          }

          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          const safeZipFilename = filename.replace(/"/g, '');
          link.setAttribute('download', safeZipFilename);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
          console.info(`${logPrefix} Directory download triggered for: ${filename}`);
        } else {
          console.error(
            `${logPrefix} Directory download failed: ${response.status} ${response.statusText}`
          );
          let _errorMsg = `Server responded with status ${response.status}`;
          try {
            const errorData = await response.json();
            _errorMsg = errorData.message || _errorMsg;
          } catch {
            try {
              const textError = await response.text();
              if (textError) _errorMsg = textError;
            } catch {
              /* ignore */
            }
          }
        }
      })
      .catch((error) => {
        console.error(`${logPrefix} Network error during directory download:`, error);
      });
  };

  return {
    triggerDownload,
    triggerDownloadDirectory,
  };
}
