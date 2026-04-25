import { reactive, onUnmounted, type Ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../types/sftp.types';
import type { UploadItem } from '../types/upload.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';

import type { WebSocketDependencies } from './useSftpActions';

const generateUploadId = (): string => {
  return `upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const joinPath = (base: string, name: string): string => {
  if (base === '/') return `/${name}`;
  if (base.endsWith('/')) return `${base}${name}`;
  return `${base}/${name}`;
};

export function useFileUploader(
  sessionIdForLog: Ref<string>,
  currentPathRef: Ref<string>,
  fileListRef: Readonly<Ref<readonly FileListItem[]>>, // 使用 Readonly 类型
  wsDeps: Ref<WebSocketDependencies>
) {
  const { t } = useI18n();
  wsDeps;

  // 对 uploads 字典使用 reactive 以获得更好的深度响应性
  const uploads = reactive<Record<string, UploadItem>>({});

  // --- 上传逻辑 ---

  const sendFileChunks = (uploadId: string, file: File, startByte = 0) => {
    const upload = uploads[uploadId];
    // 在继续之前检查连接和上传状态
    if (!wsDeps.value.isConnected.value || !upload || upload.status !== 'uploading') {
      console.warn(
        `[FileUploader ${sessionIdForLog.value}] Cannot send chunk for ${uploadId}. Connection: ${wsDeps.value.isConnected.value}, Upload status: ${upload?.status}`
      );
      return;
    }

    const CHUNK_SIZE = 1024 * 256; // 256KB 块大小（优化：减少消息数量，降低内存压力）
    const WINDOW_SIZE = 8; // 滑动窗口大小：允许同时在途的最大块数量
    const ACK_TIMEOUT_MS = 3000; // ACK 超时回退时间（兼容旧后端不发送 ack 的场景）
    let offset = startByte;
    let chunkIndex = 0;
    let inFlight = 0; // 当前在途（已发送未确认）的块数量
    let ackReceived = false; // 标记是否收到过 ack（用于判断后端是否支持滑动窗口）
    let ackFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    // 每个块创建独立的 FileReader，避免 InvalidStateError（FileReader 状态机限制）
    const readAndSendChunk = () => {
      if (offset >= file.size || uploads[uploadId]?.status !== 'uploading') return;

      const currentOffset = offset;
      const slice = file.slice(currentOffset, currentOffset + CHUNK_SIZE);
      const currentChunkSize = slice.size;
      offset += currentChunkSize;
      inFlight++;

      const reader = new FileReader();
      reader.onload = (e) => {
        const currentUpload = uploads[uploadId];
        if (
          !wsDeps.value.isConnected.value ||
          !currentUpload ||
          currentUpload.status !== 'uploading'
        ) {
          console.warn(
            `[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} status changed or disconnected before sending chunk at offset ${currentOffset}.`
          );
          inFlight = Math.max(0, inFlight - 1);
          return;
        }

        const chunkResult = e.target?.result as string;
        if (typeof chunkResult === 'string' && chunkResult.startsWith('data:')) {
          const chunkBase64 = chunkResult.split(',')[1];
          const isLast = currentOffset + CHUNK_SIZE >= file.size;

          wsDeps.value.sendMessage({
            type: 'sftp:upload:chunk',
            payload: { uploadId, chunkIndex: chunkIndex++, data: chunkBase64, isLast },
          });
        } else {
          console.error(
            `[FileUploader ${sessionIdForLog.value}] FileReader returned unexpected result for ${uploadId}:`,
            chunkResult
          );
          currentUpload.status = 'error';
          currentUpload.error = t('fileManager.errors.readFileError');
          inFlight = Math.max(0, inFlight - 1);
        }
      };

      reader.onerror = () => {
        console.error(
          `[FileUploader ${sessionIdForLog.value}] FileReader error for upload ID: ${uploadId}`
        );
        const failedUpload = uploads[uploadId];
        if (failedUpload) {
          failedUpload.status = 'error';
          failedUpload.error = t('fileManager.errors.readFileError');
        }
        inFlight = Math.max(0, inFlight - 1);
      };

      reader.readAsDataURL(slice);
    };

    // ACK 超时回退：兼容旧后端（不发送 ack 的场景），超时后视为隐式确认
    const resetAckFallbackTimer = () => {
      if (ackFallbackTimer) clearTimeout(ackFallbackTimer);
      ackFallbackTimer = setTimeout(() => {
        if (!ackReceived && uploads[uploadId]?.status === 'uploading') {
          console.warn(
            `[FileUploader ${sessionIdForLog.value}] ACK timeout for ${uploadId}, using fallback (treating as implicit ack).`
          );
          // 旧后端不支持 ack，回退为每确认一个就补一个
          inFlight = Math.max(0, inFlight - 1);
          while (inFlight < WINDOW_SIZE && offset < file.size) {
            readAndSendChunk();
          }
        }
      }, ACK_TIMEOUT_MS);
    };

    // 后端 chunk ack 处理器：接收窗口槽位信息，触发下一批读取
    const onChunkAck = (payload: MessagePayload, message: WebSocketMessage) => {
      const ackUploadId =
        message.uploadId ||
        (typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).uploadId
          : undefined);
      if (ackUploadId !== uploadId) return;

      ackReceived = true;
      if (ackFallbackTimer) {
        clearTimeout(ackFallbackTimer);
        ackFallbackTimer = null;
      }

      inFlight = Math.max(0, inFlight - 1);

      // serverSlots 表示后端剩余可用窗口槽位（例如 6 表示还可以发 6 个块）
      const payloadObj =
        typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
      const serverSlots =
        typeof payloadObj.windowSlots === 'number' ? payloadObj.windowSlots : WINDOW_SIZE;

      // 在窗口允许范围内继续读取
      while (inFlight < serverSlots && offset < file.size) {
        readAndSendChunk();
      }
    };

    // 注册 ack 处理器
    const unregisterAck = wsDeps.value.onMessage('sftp:upload:chunk:ack', onChunkAck);

    // 保存注销函数到 upload 对象，以便取消时清理
    (upload as UploadItem & { _unregisterAck?: () => void })._unregisterAck = unregisterAck;

    // 初始填充窗口：读取 WINDOW_SIZE 个块
    if (file.size > 0) {
      for (let i = 0; i < WINDOW_SIZE && offset < file.size; i++) {
        readAndSendChunk();
      }
      // 启动 ACK 超时回退定时器（仅在初始批次后启动）
      resetAckFallbackTimer();
    } else {
      // 零字节文件直接发送
      console.info(`[FileUploader ${sessionIdForLog.value}] Processing zero-byte file ${uploadId}`);
      wsDeps.value.sendMessage({
        type: 'sftp:upload:chunk',
        payload: { uploadId, chunkIndex: 0, data: '', isLast: true },
      });
      upload.progress = 100;
    }
  };

  const startFileUpload = (file: File, relativePath?: string) => {
    // Roo: 使用 .value 访问响应式的 sessionIdForLog
    if (!wsDeps.value.isConnected.value) {
      console.warn(
        `[FileUploader ${sessionIdForLog.value}] Cannot start upload: WebSocket not connected.`
      );

      return;
    }

    const uploadId = generateUploadId();

    let finalRemotePath: string;
    if (relativePath) {
      const basePath = currentPathRef.value.endsWith('/')
        ? currentPathRef.value
        : `${currentPathRef.value}/`;
      // 确保 relativePath 开头没有斜杠，末尾有斜杠 (如果非空)
      let cleanRelativePath = relativePath.startsWith('/')
        ? relativePath.substring(1)
        : relativePath;
      // 移除末尾斜杠（如果有），因为文件名会加上
      cleanRelativePath = cleanRelativePath.endsWith('/')
        ? cleanRelativePath.slice(0, -1)
        : cleanRelativePath;
      // 拼接路径，确保 cleanRelativePath 和 file.name 之间只有一个斜杠
      finalRemotePath = `${basePath}${cleanRelativePath ? `${cleanRelativePath}/` : ''}${file.name}`;
    } else {
      finalRemotePath = joinPath(currentPathRef.value, file.name); // 对于非文件夹上传，保持原样
    }
    // 规范化路径，移除多余的斜杠 e.g. /root//dir -> /root/dir
    finalRemotePath = finalRemotePath.replace(/\/+/g, '/');
    console.info(
      `[FileUploader ${sessionIdForLog.value}] Calculated finalRemotePath: ${finalRemotePath} (current: ${currentPathRef.value}, relative: ${relativePath}, filename: ${file.name}) // wsDeps.isSftpReady: ${wsDeps.value.isSftpReady.value}`
    );
    // --- 结束修正 ---

    // 添加到响应式 uploads 字典
    uploads[uploadId] = {
      id: uploadId,
      file,
      filename: file.name,
      progress: 0,
      status: 'pending', // 初始状态
    };

    console.info(
      `[FileUploader ${sessionIdForLog.value}] Starting upload ${uploadId} to ${finalRemotePath}`
    );
    wsDeps.value.sendMessage({
      type: 'sftp:upload:start',
      payload: {
        uploadId,
        remotePath: finalRemotePath,
        size: file.size,
        relativePath: relativePath || undefined,
      },
    });
    // 后端应该响应 sftp:upload:ready
  };

  const cancelUpload = (uploadId: string, notifyBackend = true) => {
    const upload = uploads[uploadId];
    if (upload && ['pending', 'uploading', 'paused'].includes(upload.status)) {
      console.info(`[FileUploader ${sessionIdForLog.value}] Cancelling upload ${uploadId}`);
      upload.status = 'cancelled'; // 立即更新状态

      // 清理滑动窗口 ack 监听器
      const uploadWithAck = upload as UploadItem & { _unregisterAck?: () => void };
      if (uploadWithAck._unregisterAck) {
        uploadWithAck._unregisterAck();
        uploadWithAck._unregisterAck = undefined;
      }

      if (notifyBackend && wsDeps.value.isConnected.value) {
        wsDeps.value.sendMessage({ type: 'sftp:upload:cancel', payload: { uploadId } });
      }

      // 短暂延迟后从列表中移除，以显示取消状态
      setTimeout(() => {
        if (uploads[uploadId]?.status === 'cancelled') {
          delete uploads[uploadId];
        }
      }, 3000);
    }
  };

  // --- 消息处理器 ---

  const onUploadReady = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;

    const upload = uploads[uploadId];
    if (upload && upload.status === 'pending') {
      console.info(
        `[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} ready, starting chunk sending.`
      );
      upload.status = 'uploading';
      sendFileChunks(uploadId, upload.file); // 开始发送块
    } else {
      console.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:ready for unknown or non-pending upload ID: ${uploadId}`
      );
    }
  };

  const onUploadSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;

    const upload = uploads[uploadId];
    if (upload) {
      console.info(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} successful.`);
      upload.status = 'success';
      upload.progress = 100;

      // 清理滑动窗口 ack 监听器
      const uploadWithAck = upload as UploadItem & { _unregisterAck?: () => void };
      if (uploadWithAck._unregisterAck) {
        uploadWithAck._unregisterAck();
        uploadWithAck._unregisterAck = undefined;
      }

      // 立即删除记录
      if (uploads[uploadId]) {
        delete uploads[uploadId];
      }
    } else {
      console.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:success for unknown upload ID: ${uploadId}`
      );
    }
  };

  const onUploadError = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) {
      console.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:error with missing uploadId:`,
        message
      );
      return;
    }

    const upload = uploads[uploadId];
    if (upload) {
      const errorMessage = (() => {
        if (typeof payload === 'string') {
          return payload;
        }
        if (typeof payloadObj.message === 'string' && (payloadObj.message as string).trim()) {
          return payloadObj.message as string;
        }
        return t('fileManager.errors.uploadFailed');
      })();
      console.error(
        `[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} error:`,
        errorMessage
      );
      upload.status = 'error';
      upload.error = errorMessage; // 使用 payload 作为错误消息

      // 清理滑动窗口 ack 监听器
      const uploadWithAck = upload as UploadItem & { _unregisterAck?: () => void };
      if (uploadWithAck._unregisterAck) {
        uploadWithAck._unregisterAck();
        uploadWithAck._unregisterAck = undefined;
      }

      // 让错误消息可见时间长一些
      setTimeout(() => {
        if (uploads[uploadId]?.status === 'error') {
          delete uploads[uploadId];
        }
      }, 5000);
    } else {
      console.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:error for unknown upload ID: ${uploadId}`
      );
    }
  };

  const onUploadPause = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;
    const upload = uploads[uploadId];
    if (upload && upload.status === 'uploading') {
      console.info(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} paused.`);
      upload.status = 'paused';
    }
  };

  const onUploadResume = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;
    const upload = uploads[uploadId];
    if (upload && upload.status === 'paused') {
      console.info(`[FileUploader ${sessionIdForLog.value}] Resuming upload ${uploadId}`);
      upload.status = 'uploading';
      sendFileChunks(uploadId, upload.file);
    }
  };

  const onUploadCancelled = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;
    const upload = uploads[uploadId];
    if (upload) {
      // 状态可能已经由用户操作设置为 'cancelled'
      if (upload.status !== 'cancelled') {
        upload.status = 'cancelled';
      }

      // 清理滑动窗口 ack 监听器
      const uploadWithAck = upload as UploadItem & { _unregisterAck?: () => void };
      if (uploadWithAck._unregisterAck) {
        uploadWithAck._unregisterAck();
        uploadWithAck._unregisterAck = undefined;
      }

      // 确保它会被移除（如果尚未计划移除）
      setTimeout(() => {
        if (uploads[uploadId]?.status === 'cancelled') {
          delete uploads[uploadId];
        }
      }, 3000);
    }
  };

  // +++ 处理上传进度更新 +++
  const onUploadProgress = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined); // 从顶层获取 uploadId
    if (!uploadId) {
      return;
    }

    const upload = uploads[uploadId];
    if (upload && upload.status === 'uploading') {
      // payload 现在应该包含 bytesWritten 和 totalSize
      if (typeof payloadObj.bytesWritten === 'number' && typeof payloadObj.totalSize === 'number') {
        upload.progress = Math.min(
          100,
          Math.round((payloadObj.bytesWritten / payloadObj.totalSize) * 100)
        );
      } else {
        console.warn(
          `[FileUploader ${sessionIdForLog.value}] Received upload:progress with incorrect payload format:`,
          payload
        );
      }
    } else if (upload) {
    } else {
      console.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:progress for unknown upload ID: ${uploadId}`
      );
    }
  };

  // --- 动态注册和注销处理器 ---
  watchEffect((onCleanup) => {
    // 当 wsDeps.value 变化时，此 effect 会重新运行
    if (!wsDeps.value || !wsDeps.value.onMessage) {
      console.warn(
        `[FileUploader ${sessionIdForLog.value}] wsDeps.value or wsDeps.value.onMessage is not available for registering listeners.`
      );
      return;
    }

    const unregisterUploadReady = wsDeps.value.onMessage('sftp:upload:ready', onUploadReady);
    const unregisterUploadSuccess = wsDeps.value.onMessage('sftp:upload:success', onUploadSuccess);
    const unregisterUploadError = wsDeps.value.onMessage('sftp:upload:error', onUploadError);
    const unregisterUploadPause = wsDeps.value.onMessage('sftp:upload:pause', onUploadPause);
    const unregisterUploadResume = wsDeps.value.onMessage('sftp:upload:resume', onUploadResume);
    const unregisterUploadCancelled = wsDeps.value.onMessage(
      'sftp:upload:cancelled',
      onUploadCancelled
    );
    const unregisterUploadProgress = wsDeps.value.onMessage(
      'sftp:upload:progress',
      onUploadProgress
    );

    onCleanup(() => {
      unregisterUploadReady?.();
      unregisterUploadSuccess?.();
      unregisterUploadError?.();
      unregisterUploadPause?.();
      unregisterUploadResume?.();
      unregisterUploadCancelled?.();
      unregisterUploadProgress?.();
    });
  });

  // --- 清理 (onUnmounted 仍然用于组件生命周期结束时的清理) ---
  onUnmounted(() => {
    // 注意：消息监听器的注销现在主要由 watchEffect 的 onCleanup 处理。
    // onUnmounted 仍然负责取消正在进行的上传。

    // 当使用此 composable 的组件卸载时，取消任何正在进行的上传
    Object.keys(uploads).forEach((uploadId) => {
      cancelUpload(uploadId, true); // 卸载时通知后端
    });
  });

  return {
    uploads,
    startFileUpload,
    cancelUpload,
  };
}
