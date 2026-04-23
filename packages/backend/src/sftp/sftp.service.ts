import { SFTPWrapper } from 'ssh2';
import * as pathModule from 'path';
import {
  ClientState,
  SftpCompressRequestPayload,
  SftpDecompressRequestPayload,
} from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import { SftpUploadManager } from './sftp-upload.manager';
import { SftpArchiveManager } from './sftp-archive.manager';
import type { FileListItem } from './sftp-utils';
import { getErrorCode } from './sftp-error.utils';
import {
  executeMkdirPathOperation,
  executeRenamePathOperation,
  executeRmdirPathOperation,
  executeUnlinkPathOperation,
} from './sftp-path-operations';
import {
  executeReadFileContentOperation,
  executeWriteFileContentOperation,
} from './sftp-file-content-operations';
import {
  executeChmodPathQueryOperation,
  executeRealpathPathQueryOperation,
  executeStatPathQueryOperation,
} from './sftp-path-query-operations';
import {
  ensureDirectoryExists,
  executeCopyOperation,
  formatStatsToFileListItem,
  getStats,
} from './sftp-copy-operations';

export class SftpService {
  private clientStates: Map<string, ClientState>;
  private uploadManager: SftpUploadManager;
  private archiveManager: SftpArchiveManager;

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
    this.uploadManager = new SftpUploadManager(clientStates);
    this.archiveManager = new SftpArchiveManager(clientStates);
  }

  /**
   * 初始化 SFTP 会话
   * @param sessionId 会话 ID
   */
  async initializeSftpSession(sessionId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sshClient || state.sftp) {
      console.warn(
        `[SFTP] 无法为会话 ${sessionId} 初始化 SFTP：状态无效、SSH客户端不存在或 SFTP 已初始化。`
      );
      return;
    }
    if (!state.sshClient) {
      console.error(`[SFTP] 会话 ${sessionId} 的 SSH 客户端不存在，无法初始化 SFTP。`);
      return;
    }
    return new Promise((resolve, reject) => {
      state.sshClient.sftp((err, sftpInstance) => {
        if (err) {
          console.error(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话失败:`, err);
          state.ws.send(
            JSON.stringify({
              type: 'sftp_error',
              payload: { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' },
            })
          );
          reject(err);
        } else {
          console.info(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话成功。`);
          state.sftp = sftpInstance;
          state.ws.send(
            JSON.stringify({ type: 'sftp_ready', payload: { connectionId: state.dbConnectionId } })
          );
          sftpInstance.on('end', () => {
            console.info(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已结束。`);
            if (state) state.sftp = undefined;
          });
          sftpInstance.on('close', () => {
            console.info(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已关闭。`);
            if (state) state.sftp = undefined;
          });
          sftpInstance.on('error', (sftpErr: Error) => {
            console.error(`[SFTP] 会话 ${sessionId} 的 SFTP 会话出错:`, sftpErr);
            if (state) state.sftp = undefined;
            state?.ws.send(
              JSON.stringify({
                type: 'sftp_error',
                payload: { connectionId: state.dbConnectionId, message: 'SFTP 会话错误' },
              })
            );
          });
          resolve();
        }
      });
    });
  }

  /**
   * 清理 SFTP 会话
   * @param sessionId 会话 ID
   */
  cleanupSftpSession(sessionId: string): void {
    const state = this.clientStates.get(sessionId);
    if (state?.sftp) {
      console.debug(`[SFTP] 正在清理 ${sessionId} 的 SFTP 会话...`);
      state.sftp.end();
      state.sftp = undefined;
    }
    // Delegate upload cleanup to SftpUploadManager
    this.uploadManager.cleanupSessionUploads(sessionId);
  }

  // --- SFTP 操作方法 ---

  /** 读取目录内容 */
  async readdir(sessionId: string, path: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readdir (ID: ${requestId})`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:readdir:error',
          path,
          payload: 'SFTP 会话未就绪',
          requestId,
        })
      );
      return;
    }
    console.debug(`[SFTP ${sessionId}] Received readdir request for ${path} (ID: ${requestId})`);
    try {
      state.sftp.readdir(path, (err, list) => {
        if (err) {
          console.error(`[SFTP ${sessionId}] readdir ${path} failed (ID: ${requestId}):`, err);
          state.ws.send(
            JSON.stringify({
              type: 'sftp:readdir:error',
              path,
              payload: `读取目录失败: ${err.message}`,
              requestId,
            })
          );
        } else {
          const files = list.map((item) => ({
            filename: item.filename,
            longname: item.longname,
            attrs: {
              size: item.attrs.size,
              uid: item.attrs.uid,
              gid: item.attrs.gid,
              mode: item.attrs.mode,
              atime: item.attrs.atime * 1000,
              mtime: item.attrs.mtime * 1000,
              isDirectory: item.attrs.isDirectory(),
              isFile: item.attrs.isFile(),
              isSymbolicLink: item.attrs.isSymbolicLink(),
            },
          }));
          state.ws.send(
            JSON.stringify({
              type: 'sftp:readdir:success',
              path,
              payload: files,
              requestId,
            })
          );
        }
      });
    } catch (error: unknown) {
      console.error(
        `[SFTP ${sessionId}] readdir ${path} caught unexpected error (ID: ${requestId}):`,
        error
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:readdir:error',
          path,
          payload: `读取目录时发生意外错误: ${getErrorMessage(error)}`,
          requestId,
        })
      );
    }
  }

  /** 获取文件/目录状态信息 */
  async stat(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeStatPathQueryOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      requestId
    );
  }

  /** 读取文件内容 (支持指定编码) */
  async readFile(
    sessionId: string,
    path: string,
    requestId: string,
    requestedEncoding?: string
  ): Promise<void> {
    await executeReadFileContentOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      requestId,
      requestedEncoding
    );
  }

  /** 写入文件内容 (支持指定编码) */
  // --- 修改：添加 encoding 参数 ---
  async writefile(
    sessionId: string,
    path: string,
    data: string,
    requestId: string,
    encoding?: string
  ): Promise<void> {
    await executeWriteFileContentOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      data,
      requestId,
      encoding
    );
  }

  /** 创建目录 */
  async mkdir(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeMkdirPathOperation(this.clientStates.get(sessionId), sessionId, path, requestId);
  }

  /** 删除目录 (强制递归) */
  async rmdir(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeRmdirPathOperation(this.clientStates.get(sessionId), sessionId, path, requestId);
  }

  /** 删除文件 */
  async unlink(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeUnlinkPathOperation(this.clientStates.get(sessionId), sessionId, path, requestId);
  }

  /** 重命名/移动文件或目录 */
  async rename(
    sessionId: string,
    oldPath: string,
    newPath: string,
    requestId: string
  ): Promise<void> {
    await executeRenamePathOperation(
      this.clientStates.get(sessionId),
      sessionId,
      oldPath,
      newPath,
      requestId
    );
  }

  /** 修改文件/目录权限 */
  async chmod(sessionId: string, path: string, mode: number, requestId: string): Promise<void> {
    await executeChmodPathQueryOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      mode,
      requestId
    );
  }

  /** 获取路径的绝对表示 */
  async realpath(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeRealpathPathQueryOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      requestId,
      () => this.clientStates.get(sessionId)
    );
  }

  // +++ 复制文件或目录 +++
  async copy(
    sessionId: string,
    sources: string[],
    destinationDir: string,
    requestId: string
  ): Promise<void> {
    await executeCopyOperation(
      this.clientStates.get(sessionId),
      sessionId,
      sources,
      destinationDir,
      requestId
    );
  }

  // +++ 移动文件或目录 +++
  async move(
    sessionId: string,
    sources: string[],
    destinationDir: string,
    requestId: string
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP Move] SFTP 未准备好，无法在 ${sessionId} 上执行 move (ID: ${requestId})`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:move:error',
          payload: 'SFTP 会话未就绪',
          requestId,
        })
      );
      return;
    }
    const { sftp } = state;
    console.debug(
      `[SFTP ${sessionId}] Received move request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`
    );

    const movedItemsDetails: FileListItem[] = [];
    let firstError: Error | null = null;

    try {
      // Ensure destination directory exists (important for move)
      try {
        await ensureDirectoryExists(sftp, destinationDir);
      } catch (ensureErr: unknown) {
        console.error(
          `[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists for move (ID: ${requestId}):`,
          ensureErr
        );
        throw new Error(`无法创建或访问目标目录: ${getErrorMessage(ensureErr)}`);
      }

      for (const oldPath of sources) {
        const sourceName = pathModule.basename(oldPath);
        const newPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

        if (oldPath === newPath) {
          console.warn(
            `[SFTP ${sessionId}] Skipping move: source and destination are the same (${oldPath}) (ID: ${requestId})`
          );
          continue; // Skip if source and destination are identical
        }

        try {
          // --- 移动前检查目标是否存在 ---
          let targetExists = false;
          try {
            await getStats(sftp, newPath);
            targetExists = true;
          } catch (statErr: unknown) {
            const statErrCode = getErrorCode(statErr);
            const statErrMsg = getErrorMessage(statErr);
            if (!(statErrCode === 'ENOENT' || statErrMsg.includes('No such file'))) {
              // 如果 stat 失败不是因为 "No such file"，则抛出未知错误
              throw new Error(`检查目标路径 ${newPath} 状态时出错: ${statErrMsg}`);
            }
            // 如果是 "No such file"，则 targetExists 保持 false，可以继续移动
          }

          if (targetExists) {
            console.error(
              `[SFTP ${sessionId}] Move failed: Target path ${newPath} already exists (ID: ${requestId})`
            );
            throw new Error(`目标路径 ${pathModule.basename(newPath)} 已存在`);
          }

          console.debug(`[SFTP ${sessionId}] Moving ${oldPath} to ${newPath} (ID: ${requestId})`);
          await this.performRename(sftp, oldPath, newPath); // Use helper for rename logic

          // Get stats of the *moved* item at the new location
          const movedStats = await getStats(sftp, newPath);
          movedItemsDetails.push(formatStatsToFileListItem(newPath, movedStats));
        } catch (moveErr: unknown) {
          console.error(
            `[SFTP ${sessionId}] Error moving ${oldPath} to ${newPath} (ID: ${requestId}):`,
            moveErr
          );
          firstError = moveErr instanceof Error ? moveErr : new Error(getErrorMessage(moveErr));
          break; // Stop on first error for move
        }
      }

      if (firstError) {
        throw firstError;
      }

      console.info(
        `[SFTP ${sessionId}] Move operation completed successfully (ID: ${requestId}). Moved items: ${movedItemsDetails.length}`
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:move:success',
          payload: { sources, destination: destinationDir, items: movedItemsDetails },
          requestId,
        })
      );
    } catch (error: unknown) {
      console.error(`[SFTP ${sessionId}] Move operation failed (ID: ${requestId}):`, error);
      state.ws.send(
        JSON.stringify({
          type: 'sftp:move:error',
          payload: `移动操作失败: ${getErrorMessage(error)}`,
          requestId,
        })
      );
    }
  }

  // +++ 辅助方法 - 执行重命名 (Promise wrapper) +++
  private performRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // --- Compress/Decompress Methods (delegated to SftpArchiveManager) ---
  /**
   * 压缩远程服务器上的文件/目录
   * @param sessionId 会话 ID
   * @param payload 压缩请求的 payload
   */
  async compress(sessionId: string, payload: SftpCompressRequestPayload): Promise<void> {
    return this.archiveManager.compress(sessionId, payload);
  }

  /**
   * 解压远程服务器上的压缩文件
   * @param sessionId 会话 ID
   * @param payload 解压请求的 payload
   */
  async decompress(sessionId: string, payload: SftpDecompressRequestPayload): Promise<void> {
    return this.archiveManager.decompress(sessionId, payload);
  }

  // --- File Upload Methods ---

  /** Start a new file upload (delegated to SftpUploadManager) */
  async startUpload(
    sessionId: string,
    uploadId: string,
    remotePath: string,
    totalSize: number,
    relativePath?: string
  ): Promise<void> {
    return this.uploadManager.startUpload(sessionId, uploadId, remotePath, totalSize, relativePath);
  }

  /** Handle an incoming file chunk (delegated to SftpUploadManager) */
  async handleUploadChunk(
    sessionId: string,
    uploadId: string,
    chunkIndex: number,
    dataBase64: string
  ): Promise<void> {
    return this.uploadManager.handleUploadChunk(sessionId, uploadId, chunkIndex, dataBase64);
  }

  /** Cancel an ongoing upload (delegated to SftpUploadManager) */
  cancelUpload(sessionId: string, uploadId: string): void {
    return this.uploadManager.cancelUpload(sessionId, uploadId);
  }
}
