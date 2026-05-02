/**
 * 文件上传分块管理器
 * 从 useFileUploader.ts 提取，负责文件分块读取与滑动窗口发送
 */

import type { UploadItem } from '../../types/upload.types';

/** 分块大小：256KB */
const CHUNK_SIZE = 1024 * 256;

/** 滑动窗口大小：允许同时在途的最大块数量 */
const WINDOW_SIZE = 8;

/** ACK 超时回退时间（兼容旧后端不发送 ack 的场景） */
const ACK_TIMEOUT_MS = 3000;

export interface ChunkManagerOptions {
  chunkSize?: number;
  windowSize?: number;
  ackTimeoutMs?: number;
}

/**
 * 创建分块上传管理器
 */
export function createChunkManager(options?: ChunkManagerOptions) {
  const chunkSize = options?.chunkSize ?? CHUNK_SIZE;
  const windowSize = options?.windowSize ?? WINDOW_SIZE;
  const ackTimeoutMs = options?.ackTimeoutMs ?? ACK_TIMEOUT_MS;

  /**
   * 发送文件分块
   * @param file - 要上传的文件
   * @param uploadId - 上传任务 ID
   * @param startByte - 起始字节偏移
   * @param sendChunk - 实际发送分块的回调函数
   * @param onProgress - 进度回调
   * @param onComplete - 完成回调
   * @param onError - 错误回调
   */
  const sendChunks = (
    file: File,
    uploadId: string,
    startByte: number,
    sendChunk: (chunk: Blob, offset: number, uploadId: string) => void,
    onProgress?: (loaded: number) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void
  ) => {
    let offset = startByte;
    let inFlight = 0;
    let ackReceived = false;
    let ackFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const readAndSendChunk = () => {
      if (offset >= file.size) return;

      const currentOffset = offset;
      const slice = file.slice(currentOffset, currentOffset + chunkSize);
      const currentChunkSize = slice.size;
      offset += currentChunkSize;
      inFlight++;

      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result;
        if (data instanceof ArrayBuffer) {
          sendChunk(new Blob([data]), currentOffset, uploadId);
          onProgress?.(currentOffset + currentChunkSize);
        }
        inFlight--;

        // 滑动窗口：如果还有数据且窗口未满，继续发送
        if (inFlight < windowSize && offset < file.size) {
          readAndSendChunk();
        }

        // 所有分块已发送
        if (inFlight === 0 && offset >= file.size) {
          onComplete?.();
        }
      };
      reader.onerror = () => {
        onError?.(new Error(`读取文件分块失败: offset=${currentOffset}`));
        inFlight--;
      };
      reader.readAsArrayBuffer(slice);
    };

    // ACK 超时回退（兼容旧后端）
    if (!ackReceived) {
      ackFallbackTimer = setTimeout(() => {
        ackReceived = true; // 假设后端不支持滑动窗口
      }, ackTimeoutMs);
    }

    // 启动发送
    readAndSendChunk();

    /**
     * 收到 ACK 时调用（由外部调用）
     */
    const onAck = () => {
      ackReceived = true;
      if (ackFallbackTimer) {
        clearTimeout(ackFallbackTimer);
        ackFallbackTimer = null;
      }
      // 继续发送下一个分块
      if (inFlight < windowSize && offset < file.size) {
        readAndSendChunk();
      }
    };

    /**
     * 取消上传
     */
    const cancel = () => {
      if (ackFallbackTimer) {
        clearTimeout(ackFallbackTimer);
        ackFallbackTimer = null;
      }
      offset = file.size; // 停止发送
    };

    return { onAck, cancel };
  };

  return { sendChunks, CHUNK_SIZE: chunkSize, WINDOW_SIZE: windowSize };
}
