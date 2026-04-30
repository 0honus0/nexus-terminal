/**
 * SFTP 文件上传管理器
 * 负责处理文件上传的启动、数据块处理和取消操作
 */

import { WriteStream } from 'ssh2';
import { WebSocket } from 'ws';
import * as pathModule from 'path';
import { ClientState } from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import { SftpUtils } from './sftp-utils';

/** 活动上传状态 */
interface ActiveUpload {
  remotePath: string;
  totalSize: number;
  bytesWritten: number;
  stream: WriteStream;
  sessionId: string;
  relativePath?: string;
  drainPromise?: Promise<void> | null;
  /** 滑动窗口：已接收但尚未写入完成的块数量 */
  inFlightChunks: number;
  /** 待写入的乱序块缓冲区（chunkIndex → Buffer） */
  pendingChunks: Map<number, Buffer>;
  /** 下一个期望写入的块索引 */
  expectedChunkIndex: number;
  /** 是否正在刷写缓冲区（防止重入） */
  flushingChunks: boolean;
}

/** 滑动窗口大小：允许同时在途的最大块数量 */
const UPLOAD_WINDOW_SIZE = 8;

export class SftpUploadManager {
  private clientStates: Map<string, ClientState>;
  private activeUploads: Map<string, ActiveUpload>;

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
    this.activeUploads = new Map();
  }

  /**
   * 清理指定会话的所有活动上传
   */
  cleanupSessionUploads(sessionId: string): void {
    this.activeUploads.forEach((upload, uploadId) => {
      if (upload.sessionId === sessionId) {
        console.warn(`[SFTP Upload] Cleaning up upload ${uploadId} for session ${sessionId}`);
        this.cancelUploadInternal(uploadId, 'Session ended');
      }
    });
  }

  /**
   * 启动新文件上传
   */
  async startUpload(
    sessionId: string,
    uploadId: string,
    remotePath: string,
    totalSize: number,
    relativePath?: string
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP Upload ${uploadId}] SFTP not ready for session ${sessionId}.`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId, message: 'SFTP 会话未就绪' },
        })
      );
      return;
    }
    const sftp = state.sftp;
    if (this.activeUploads.has(uploadId)) {
      console.warn(
        `[SFTP Upload ${uploadId}] Upload already in progress for session ${sessionId}.`
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId, message: 'Upload already started' },
        })
      );
      return;
    }

    try {
      // 确保目录存在
      if (relativePath) {
        const targetDirectory = pathModule.dirname(remotePath).replace(/\\/g, '/');
        try {
          if (!state.sftp) throw new Error('SFTP session is not available.');
          await SftpUtils.ensureDirectoryExists(state.sftp, targetDirectory);
        } catch (dirError: unknown) {
          const dirErrMsg = getErrorMessage(dirError);
          console.error(
            `[SFTP Upload ${uploadId}] Failed to create directory ${targetDirectory}:`,
            dirError
          );
          state.ws.send(
            JSON.stringify({
              type: 'sftp:upload:error',
              payload: { uploadId, message: `创建目录失败: ${dirErrMsg}` },
            })
          );
          return;
        }
      }

      // 预检查文件可写性
      try {
        if (!state.sftp) throw new Error('SFTP session is not available.');
        await new Promise<void>((resolve, reject) => {
          sftp.open(remotePath, 'w', (openErr, handle) => {
            if (openErr) {
              return reject(openErr);
            }
            sftp.close(handle, () => resolve());
          });
        });
      } catch (preCheckError: unknown) {
        const preCheckErrMsg = getErrorMessage(preCheckError);
        console.error(
          `[SFTP Upload ${uploadId}] Writability pre-check failed for ${remotePath}:`,
          preCheckError
        );
        state.ws.send(
          JSON.stringify({
            type: 'sftp:upload:error',
            payload: { uploadId, message: `文件不可写或创建失败: ${preCheckErrMsg}` },
          })
        );
        return;
      }

      if (!state.sftp) throw new Error('SFTP session is not available after pre-check.');
      const stream = state.sftp.createWriteStream(remotePath);
      const uploadState: ActiveUpload = {
        remotePath,
        totalSize,
        bytesWritten: 0,
        stream,
        sessionId,
        relativePath,
        drainPromise: null,
        inFlightChunks: 0,
        pendingChunks: new Map(),
        expectedChunkIndex: 0,
        flushingChunks: false,
      };
      this.activeUploads.set(uploadId, uploadState);

      stream.on('error', (err: Error) => {
        console.error(`[SFTP Upload ${uploadId}] WriteStream error for ${remotePath}:`, err);
        state.ws.send(
          JSON.stringify({
            type: 'sftp:upload:error',
            payload: { uploadId, message: `写入流错误: ${err.message}` },
          })
        );
        this.activeUploads.delete(uploadId);
      });

      stream.on('close', () => {
        const finalState = this.activeUploads.get(uploadId);
        if (finalState) {
          if (finalState.bytesWritten >= finalState.totalSize) {
            sftp.lstat(finalState.remotePath, (statErr, stats) => {
              if (statErr) {
                console.error(`[SFTP Upload ${uploadId}] lstat after close failed:`, statErr);
                state.ws.send(
                  JSON.stringify({
                    type: 'sftp:upload:error',
                    payload: { uploadId, message: `获取最终文件状态失败: ${statErr.message}` },
                  })
                );
              } else if (stats.size < finalState.totalSize) {
                console.error(
                  `[SFTP Upload ${uploadId}] Final size (${stats.size}) < expected (${finalState.totalSize})`
                );
                state.ws.send(
                  JSON.stringify({
                    type: 'sftp:upload:error',
                    payload: {
                      uploadId,
                      message: `最终文件大小 (${stats.size}) 小于预期 (${finalState.totalSize})`,
                    },
                  })
                );
              } else {
                const finalStatsPayload = SftpUtils.formatStatsToFileListItem(
                  finalState.remotePath,
                  stats
                );
                state.ws.send(
                  JSON.stringify({
                    type: 'sftp:upload:success',
                    payload: finalStatsPayload,
                    uploadId,
                    path: finalState.remotePath,
                  })
                );
              }
              this.activeUploads.delete(uploadId);
            });
          } else {
            this.activeUploads.delete(uploadId);
          }
        }
      });

      state.ws.send(JSON.stringify({ type: 'sftp:upload:ready', payload: { uploadId } }));
    } catch (error: unknown) {
      console.error(`[SFTP Upload ${uploadId}] Error starting upload for ${remotePath}:`, error);
      state.ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId, message: `开始上传时出错: ${getErrorMessage(error)}` },
        })
      );
      this.activeUploads.delete(uploadId);
    }
  }

  /**
   * 处理上传数据块
   * 使用排序缓冲区保证按序写入 SFTP 流
   */
  async handleUploadChunk(
    sessionId: string,
    uploadId: string,
    chunkIndex: number,
    dataBase64: string,
    _isLast?: boolean
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const uploadState = this.activeUploads.get(uploadId);

    if (!state || !state.sftp) {
      console.warn(`[SFTP Upload ${uploadId}] Received chunk ${chunkIndex}, but session invalid.`);
      this.cancelUploadInternal(uploadId, 'Session or SFTP invalid');
      return;
    }
    if (!uploadState) {
      console.warn(`[SFTP Upload ${uploadId}] Received chunk ${chunkIndex}, but no active upload.`);
      return;
    }

    // 滑动窗口硬限制：拒绝超出窗口的块，防止恶意/旧客户端绕过流控
    if (uploadState.inFlightChunks >= UPLOAD_WINDOW_SIZE) {
      console.warn(
        `[SFTP Upload ${uploadId}] Window full (${uploadState.inFlightChunks}/${UPLOAD_WINDOW_SIZE}), rejecting chunk ${chunkIndex}.`
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: {
            uploadId,
            message: `滑动窗口已满（${uploadState.inFlightChunks}/${UPLOAD_WINDOW_SIZE}），请等待确认后再发送`,
          },
        })
      );
      return;
    }

    try {
      // 仅在块未重复时才计入在途计数，防止重复块耗尽滑动窗口
      const isDuplicate = uploadState.pendingChunks.has(chunkIndex);
      if (!isDuplicate) {
        uploadState.inFlightChunks++;
      } else {
        console.warn(
          `[SFTP Upload ${uploadId}] Duplicate chunk ${chunkIndex} received, overwriting buffer.`
        );
      }
      const chunkBuffer = Buffer.from(dataBase64, 'base64');

      // 将块存入排序缓冲区（不直接写入流）
      uploadState.pendingChunks.set(chunkIndex, chunkBuffer);

      // 按序刷写缓冲区
      await this.flushPendingChunks(uploadId);
    } catch (error: unknown) {
      console.error(`[SFTP Upload ${uploadId}] Error handling chunk ${chunkIndex}:`, error);
      state.ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId, message: `处理块 ${chunkIndex} 时出错: ${getErrorMessage(error)}` },
        })
      );
      this.cancelUploadInternal(uploadId, `Error handling chunk ${chunkIndex}`);
    }
  }

  /**
   * 按序刷写待写入块缓冲区
   * 从 expectedChunkIndex 开始，连续写入已到达的块
   */
  private async flushPendingChunks(uploadId: string): Promise<void> {
    const uploadState = this.activeUploads.get(uploadId);
    if (!uploadState) return;

    const state = this.clientStates.get(uploadState.sessionId);
    if (!state) return;

    // 防止重入：如果已经在刷写，直接返回（外层 handleUploadChunk 会继续调用）
    if (uploadState.flushingChunks) return;
    uploadState.flushingChunks = true; // eslint-disable-line no-param-reassign

    try {
      while (uploadState.pendingChunks.has(uploadState.expectedChunkIndex)) {
        const currentIndex = uploadState.expectedChunkIndex;
        const bufferedChunk = uploadState.pendingChunks.get(currentIndex);
        if (!bufferedChunk) break;
        uploadState.pendingChunks.delete(currentIndex);
        uploadState.expectedChunkIndex++;

        // 写入流并等待完成（传入 buffer，避免 writeChunkToStream 重新查找已被删除的条目）
        await this.writeChunkToStream(uploadId, bufferedChunk);

        // 写入完成后减少在途计数并发送 ack
        uploadState.inFlightChunks = Math.max(0, uploadState.inFlightChunks - 1);

        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          const progressPercent =
            uploadState.totalSize === 0
              ? 100
              : Math.round((uploadState.bytesWritten / uploadState.totalSize) * 100);
          state.ws.send(
            JSON.stringify({
              type: 'sftp:upload:progress',
              uploadId,
              payload: {
                bytesWritten: uploadState.bytesWritten,
                totalSize: uploadState.totalSize,
                progress: Math.min(100, progressPercent),
              },
            })
          );

          // 发送滑动窗口 ack，告知前端剩余窗口槽位
          const windowSlots = Math.max(0, UPLOAD_WINDOW_SIZE - uploadState.inFlightChunks);
          state.ws.send(
            JSON.stringify({
              type: 'sftp:upload:chunk:ack',
              uploadId,
              payload: { chunkIndex: currentIndex, windowSlots },
            })
          );
        }

        // 检查是否所有字节已写入完毕
        if (uploadState.bytesWritten >= uploadState.totalSize) {
          if (!uploadState.stream.writableEnded) {
            uploadState.stream.end((endErr: (Error & { code?: string }) | undefined) => {
              if (endErr) {
                if (
                  endErr.code === 'ERR_STREAM_DESTROYED' &&
                  uploadState.bytesWritten >= uploadState.totalSize
                ) {
                  console.warn(
                    `[SFTP Upload ${uploadId}] ERR_STREAM_DESTROYED but all bytes written.`
                  );
                } else {
                  console.error(`[SFTP Upload ${uploadId}] Error from stream.end():`, endErr);
                  state.ws.send(
                    JSON.stringify({
                      type: 'sftp:upload:error',
                      payload: { uploadId, message: `结束写入流时出错: ${endErr.message}` },
                    })
                  );
                  this.cancelUploadInternal(uploadId, `Stream end error: ${endErr.message}`);
                }
              }
            });
          }
          break;
        }
      }
    } finally {
      uploadState.flushingChunks = false; // eslint-disable-line no-param-reassign
    }
  }

  /**
   * 将单个块写入 SFTP 流，支持背压处理
   * 写回调作为唯一 resolve/reject 入口；
   * 当 write() 返回 false 时，先等 drain 再从回调 resolve。
   */
  private writeChunkToStream(uploadId: string, chunkBuffer: Buffer): Promise<void> {
    const uploadState = this.activeUploads.get(uploadId);
    if (!uploadState) return Promise.resolve();

    const state = this.clientStates.get(uploadState.sessionId);
    if (!state) return Promise.resolve();

    return new Promise<void>((resolveWrite, reject) => {
      let settled = false;
      const settle = (action: 'resolve' | 'reject', err?: Error) => {
        if (settled) return;
        settled = true;
        if (action === 'resolve') resolveWrite();
        else reject(err);
      };

      const writeSuccess = uploadState.stream.write(chunkBuffer, (err) => {
        if (err) {
          console.error(`[SFTP Upload ${uploadId}] Write callback error:`, err);
          state.ws.send(
            JSON.stringify({
              type: 'sftp:upload:error',
              payload: { uploadId, message: `写入块失败: ${(err as Error).message}` },
            })
          );
          this.cancelUploadInternal(uploadId, `Write error`);
          settle('reject', err as Error);
          return;
        }

        uploadState.bytesWritten += chunkBuffer.length;

        if (writeSuccess) {
          // 内核缓冲区尚有余量，回调即表示数据已入队
          settle('resolve');
        }
        // writeSuccess === false 时不在此 resolve，等 drain
      });

      if (!writeSuccess) {
        // 背压：等 drain 事件后再 resolve（回调中 bytesWritten 已更新）
        if (!uploadState.drainPromise) {
          uploadState.drainPromise = new Promise<void>((drainResolve) => {
            uploadState.stream.once('drain', () => {
              uploadState.drainPromise = null;
              drainResolve();
            });
          });
        }
        uploadState.drainPromise.then(() => settle('resolve'));
      }
    });
  }

  /**
   * 取消上传
   */
  cancelUpload(sessionId: string, uploadId: string): void {
    const state = this.clientStates.get(sessionId);
    const uploadState = this.activeUploads.get(uploadId);

    if (!state) {
      console.warn(`[SFTP Upload ${uploadId}] Cancel requested but session not found.`);
      this.cancelUploadInternal(uploadId, 'Session not found');
      return;
    }
    if (!uploadState) {
      console.warn(`[SFTP Upload ${uploadId}] Cancel requested but no active upload.`);
      state.ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId, message: '无效的上传 ID 或上传已取消/完成' },
        })
      );
      return;
    }

    console.info(`[SFTP Upload ${uploadId}] Cancelling upload for ${uploadState.remotePath}`);
    this.cancelUploadInternal(uploadId, 'User cancelled');
    state.ws.send(JSON.stringify({ type: 'sftp:upload:cancelled', payload: { uploadId } }));
  }

  /**
   * 内部取消上传清理
   */
  private cancelUploadInternal(uploadId: string, reason: string): void {
    const uploadState = this.activeUploads.get(uploadId);
    if (uploadState) {
      console.info(`[SFTP Upload ${uploadId}] Cleaning upload state: ${reason}`);
      const currentStream = uploadState.stream;
      if (currentStream && !currentStream.destroyed) {
        if (!currentStream.writableEnded) {
          currentStream.end((endErr: Error | undefined) => {
            if (endErr && !currentStream.destroyed) {
              currentStream.destroy();
            }
          });
        } else {
          currentStream.destroy();
        }
      }
      this.activeUploads.delete(uploadId);
    }
  }
}
