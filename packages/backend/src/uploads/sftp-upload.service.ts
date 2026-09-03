import type { SFTPWrapper, Stats, WriteStream } from 'ssh2';
import { WebSocket } from 'ws';
import type { ClientState } from '../websocket/types';
import path from 'node:path';
import { SftpChannelFileSystem } from '../filesystem/sftp-channel-file-system';

const UPLOAD_WRITE_HIGH_WATER_MARK = 1024 * 1024;
const UPLOAD_DIRECTORY_PREPARE_CONCURRENCY = 8;

interface ActiveUpload {
  remotePath: string;
  temporaryPath: string;
  totalSize: number;
  bytesAccepted: number;
  bytesWritten: number;
  nextChunkIndex: number;
  receivedLastChunk: boolean;
  stream: WriteStream;
  sftp: SFTPWrapper;
  sessionId: string;
  relativePath?: string;
  drainPromise?: Promise<void> | null;
}

interface PendingUpload {
  sessionId: string;
  remotePath: string;
  temporaryPath: string;
  sftp: SFTPWrapper;
}

interface PreparedUploadBatch {
  sessionId: string;
  basePath: string;
  directories: Set<string>;
}

/** Browser upload lifecycle. It owns upload state but not Workspace SSH/SFTP session ownership. */
export class SftpUploadService {
  private readonly activeUploads = new Map<string, ActiveUpload>();
  private readonly pendingUploads = new Map<string, PendingUpload>();
  private readonly cancelledUploadIds = new Set<string>();
  private readonly preparedUploadBatches = new Map<string, PreparedUploadBatch>();

  constructor(private readonly clientStates: Map<string, ClientState>) {}

  private filesystem(sftp: SFTPWrapper): SftpChannelFileSystem {
    return new SftpChannelFileSystem(sftp);
  }

  private async ensureTransferChannel(sessionId: string): Promise<SFTPWrapper> {
    const state = this.clientStates.get(sessionId);
    if (!state?.executionSession.isReady) throw new Error('SSH 会话未就绪');
    return state.executionSession.sftp.ensure('transfer');
  }

  async cleanupSession(sessionId: string): Promise<void> {
    const cleanupTasks: Promise<unknown>[] = [];
    for (const [uploadId, upload] of this.activeUploads) {
      if (upload.sessionId === sessionId) cleanupTasks.push(this.cancelUploadInternal(uploadId, 'SFTP session ended'));
    }
    for (const [uploadId, upload] of this.pendingUploads) {
      if (upload.sessionId === sessionId) {
        this.cancelledUploadIds.add(uploadId);
        cleanupTasks.push(this.removeRemoteUploadFile(sessionId, upload.temporaryPath, upload.sftp));
      }
    }
    for (const [prepareId, batch] of this.preparedUploadBatches) {
      if (batch.sessionId === sessionId) this.preparedUploadBatches.delete(prepareId);
    }
    await Promise.allSettled(cleanupTasks);
  }


  private normalizeUploadBasePath(basePath: string): string {
    const normalized = path.posix.normalize(basePath.replace(/\\/g, '/'));
    if (!path.posix.isAbsolute(normalized)) {
      throw new Error(`上传目标基础路径必须是绝对路径: ${basePath}`);
    }
    return normalized;
  }

  private normalizeUploadRelativeDirectory(relativePath: string): string {
    const slashNormalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const normalized = path.posix.normalize(slashNormalized).replace(/\/$/, '');
    if (!normalized || normalized === '.') return '';
    if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`上传目录包含非法路径: ${relativePath}`);
    }
    return normalized;
  }

  private resolvePreparedUploadDirectory(basePath: string, relativePath: string): string {
    const fullPath = path.posix.normalize(path.posix.join(basePath, relativePath));
    const isInsideBase =
      basePath === '/' ? fullPath.startsWith('/') : fullPath === basePath || fullPath.startsWith(`${basePath}/`);
    if (!isInsideBase) {
      throw new Error(`上传目录超出目标基础路径: ${relativePath}`);
    }
    return fullPath;
  }

  /** Create the complete remote directory tree before any file stream is opened. */
  async prepareUploadDirectories(
    sessionId: string,
    prepareId: string,
    basePath: string,
    directories: string[],
  ): Promise<{ preparedDirectories: number }> {
    const state = this.clientStates.get(sessionId);
    if (!state) throw new Error('SSH 会话未就绪');
    const uploadSftp = await this.ensureTransferChannel(sessionId);
    if (!prepareId || prepareId.length > 512) throw new Error('上传准备任务 ID 无效');
    if (!Array.isArray(directories) || directories.length > 20000) {
      throw new Error('上传目录列表无效或数量过多');
    }

    const normalizedBasePath = this.normalizeUploadBasePath(basePath);
    const fullDirectories = new Set<string>([normalizedBasePath]);
    for (const directory of directories) {
      if (typeof directory !== 'string') throw new Error('上传目录必须是字符串');
      const normalizedRelative = this.normalizeUploadRelativeDirectory(directory);
      fullDirectories.add(this.resolvePreparedUploadDirectory(normalizedBasePath, normalizedRelative));
    }

    // Create the base path once, then parallelize by independent first-level branches.
    // Directories inside the same branch are created sequentially so concurrent mkdir
    // requests never race on one shared branch root.
    await this.filesystem(uploadSftp).ensureDirectory(normalizedBasePath);

    const branchDirectories = new Map<string, string[]>();
    for (const directory of fullDirectories) {
      if (directory === normalizedBasePath) continue;
      const relativeDirectory = path.posix.relative(normalizedBasePath, directory);
      const branchRoot = relativeDirectory.split('/')[0];
      const branch = branchDirectories.get(branchRoot) ?? [];
      branch.push(directory);
      branchDirectories.set(branchRoot, branch);
    }

    const branches = [...branchDirectories.values()]
      .map((branch) =>
        branch.sort((left, right) => {
          const depthDiff = left.split('/').length - right.split('/').length;
          return depthDiff || left.localeCompare(right);
        }),
      )
      .sort((left, right) => right.length - left.length);

    let nextBranchIndex = 0;
    const workerCount = Math.min(UPLOAD_DIRECTORY_PREPARE_CONCURRENCY, branches.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextBranchIndex < branches.length) {
          const branch = branches[nextBranchIndex++];
          for (const directory of branch) {
            await this.filesystem(uploadSftp).ensureDirectory(directory);
          }
        }
      }),
    );

    this.preparedUploadBatches.set(prepareId, {
      sessionId,
      basePath: normalizedBasePath,
      directories: fullDirectories,
    });
    console.log(
      `[SFTP Upload Prepare ${prepareId}] Prepared ${fullDirectories.size} directories in ${branches.length} independent branches under ${normalizedBasePath}.`,
    );
    return { preparedDirectories: fullDirectories.size };
  }

  /** Start a new file upload */
  async startUpload(
    sessionId: string,
    uploadId: string,
    remotePath: string,
    totalSize: number,
    relativePath?: string,
    prepareId?: string,
    conflictPolicy: 'ask' | 'overwrite' | 'skip' = 'ask',
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state) {
      console.warn(`[SFTP Upload ${uploadId}] SSH session not ready for ${sessionId}.`);
      return;
    }
    let uploadSftp: SFTPWrapper;
    try {
      uploadSftp = await this.ensureTransferChannel(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SFTP Upload ${uploadId}] Upload SFTP channel unavailable for session ${sessionId}:`, error);
      if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(
          JSON.stringify({
            type: 'sftp:upload:error',
            payload: { uploadId, message: `上传通道初始化失败: ${message}` },
          }),
        );
      }
      return;
    }
    if (this.activeUploads.has(uploadId) || this.pendingUploads.has(uploadId)) {
      console.warn(`[SFTP Upload ${uploadId}] Upload already in progress for session ${sessionId}.`);
      state.ws.send(
        JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: 'Upload already started' } }),
      );
      return;
    }

    const normalizedRemotePath = path.posix.normalize(remotePath.replace(/\\/g, '/'));
    const targetDirectory = path.posix.dirname(normalizedRemotePath);
    let directoryWasPrepared = false;
    if (prepareId) {
      const preparedBatch = this.preparedUploadBatches.get(prepareId);
      if (!preparedBatch || preparedBatch.sessionId !== sessionId) {
        state.ws.send(
          JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: '上传目录尚未准备完成' } }),
        );
        return;
      }
      const isInsidePreparedBase =
        preparedBatch.basePath === '/'
          ? targetDirectory.startsWith('/')
          : targetDirectory === preparedBatch.basePath || targetDirectory.startsWith(`${preparedBatch.basePath}/`);
      if (!isInsidePreparedBase) {
        state.ws.send(
          JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: '上传文件路径超出已准备目录' } }),
        );
        return;
      }
      if (!preparedBatch.directories.has(targetDirectory)) {
        state.ws.send(
          JSON.stringify({
            type: 'sftp:upload:error',
            payload: { uploadId, message: `上传目录未在准备阶段创建: ${targetDirectory}` },
          }),
        );
        return;
      }
      directoryWasPrepared = true;
    }

    const destinationExists =
      conflictPolicy === 'overwrite' ? false : await this.remotePathExists(uploadSftp, normalizedRemotePath);
    if (destinationExists && conflictPolicy === 'ask') {
      if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(
          JSON.stringify({
            type: 'sftp:upload:conflict',
            uploadId,
            payload: {
              uploadId,
              remotePath: normalizedRemotePath,
              filename: path.posix.basename(normalizedRemotePath),
            },
          }),
        );
      }
      return;
    }
    if (destinationExists && conflictPolicy === 'skip') {
      if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(
          JSON.stringify({
            type: 'sftp:upload:skipped',
            uploadId,
            path: normalizedRemotePath,
            payload: { uploadId, remotePath: normalizedRemotePath },
          }),
        );
      }
      return;
    }

    const temporaryPath = path.posix.join(targetDirectory, `.nexus-upload-${uploadId}.part`);
    this.pendingUploads.set(uploadId, { sessionId, remotePath: normalizedRemotePath, temporaryPath, sftp: uploadSftp });

    const stopIfCancelled = async (): Promise<boolean> => {
      if (!this.cancelledUploadIds.has(uploadId)) return false;
      await this.removeRemoteUploadFile(sessionId, temporaryPath, uploadSftp);
      return true;
    };

    try {
      // Prepared batches create their complete directory tree before uploads start.
      // Keep the legacy fallback for older clients that do not send a prepareId.
      if (!directoryWasPrepared) await this.filesystem(uploadSftp).ensureDirectory(targetDirectory);
      if (await stopIfCancelled()) return;

      // createWriteStream already creates/truncates the temporary file. Avoiding a
      // separate open+close probe removes two SFTP round trips for every small file.
      const stream = uploadSftp.createWriteStream(temporaryPath, {
        highWaterMark: UPLOAD_WRITE_HIGH_WATER_MARK,
      });
      const uploadState: ActiveUpload = {
        remotePath: normalizedRemotePath,
        temporaryPath,
        totalSize,
        bytesAccepted: 0,
        bytesWritten: 0,
        nextChunkIndex: 0,
        receivedLastChunk: false,
        stream,
        sftp: uploadSftp,
        sessionId,
        relativePath,
        drainPromise: null,
      };
      this.activeUploads.set(uploadId, uploadState);

      stream.on('error', (err: Error) => {
        if (this.activeUploads.get(uploadId) !== uploadState) return;
        console.error(`[SFTP Upload ${uploadId}] WriteStream error for ${temporaryPath}:`, err);
        if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(
            JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `写入流错误: ${err.message}` } }),
          );
        }
        void this.cancelUploadInternal(uploadId, `Write stream error: ${err.message}`, err);
      });

      stream.on('close', () => {
        const finalState = this.activeUploads.get(uploadId);
        if (!finalState) return; // Cancel/error already owns cleanup.

        if (finalState.bytesWritten !== finalState.totalSize || !finalState.receivedLastChunk) {
          const message = `最终文件不完整（写入 ${finalState.bytesWritten}/${finalState.totalSize} 字节，结束分块: ${finalState.receivedLastChunk ? '是' : '否'}）`;
          if (state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message } }));
          }
          void this.cancelUploadInternal(uploadId, message);
          return;
        }

        void this.finalizeUploadedFile(uploadId, finalState)
          .then((stats) => {
            if (state.ws.readyState !== WebSocket.OPEN) return;
            const finalStatsPayload = {
              filename: path.posix.basename(finalState.remotePath),
              longname: '',
              attrs: {
                size: stats.size,
                uid: stats.uid,
                gid: stats.gid,
                mode: stats.mode,
                atime: stats.atime * 1000,
                mtime: stats.mtime * 1000,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
                isSymbolicLink: stats.isSymbolicLink(),
              },
            };
            state.ws.send(
              JSON.stringify({
                type: 'sftp:upload:success',
                payload: finalStatsPayload,
                uploadId,
                path: finalState.remotePath,
              }),
            );
          })
          .catch(async (error: Error) => {
            console.error(`[SFTP Upload ${uploadId}] Failed to finalize ${finalState.remotePath}:`, error);
            await this.removeRemoteUploadFile(sessionId, finalState.temporaryPath, finalState.sftp);
            if (state.ws.readyState === WebSocket.OPEN) {
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:upload:error',
                  payload: { uploadId, message: `完成上传失败: ${error.message}` },
                }),
              );
            }
          })
          .finally(() => {
            this.activeUploads.delete(uploadId);
            this.cancelledUploadIds.delete(uploadId);
          });
      });

      state.ws.send(JSON.stringify({ type: 'sftp:upload:ready', payload: { uploadId } }));
    } catch (error: any) {
      console.error(`[SFTP Upload ${uploadId}] Error starting upload for ${remotePath}:`, error);
      await this.removeRemoteUploadFile(sessionId, temporaryPath, uploadSftp);
      if (!this.cancelledUploadIds.has(uploadId) && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(
          JSON.stringify({
            type: 'sftp:upload:error',
            payload: { uploadId, message: `开始上传时出错: ${error.message}` },
          }),
        );
      }
    } finally {
      this.pendingUploads.delete(uploadId);
      if (!this.activeUploads.has(uploadId)) {
        this.cancelledUploadIds.delete(uploadId);
      }
    }
  }

  /** Handle a decoded NXUP binary file chunk. */
  async handleUploadChunk(
    sessionId: string,
    uploadId: string,
    chunkIndex: number,
    chunkBuffer: Buffer,
    isLast: boolean,
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const uploadState = this.activeUploads.get(uploadId);

    if (!state) {
      console.warn(
        `[SFTP Upload ${uploadId}] Received binary chunk ${chunkIndex}, but session ${sessionId} is invalid.`,
      );
      void this.cancelUploadInternal(uploadId, 'Session invalid');
      return;
    }
    if (!uploadState) {
      console.warn(`[SFTP Upload ${uploadId}] Received binary chunk ${chunkIndex}, but no active upload found.`);
      return;
    }

    const rejectChunk = (message: string) => {
      console.error(`[SFTP Upload ${uploadId}] ${message}`);
      if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message } }));
      }
      void this.cancelUploadInternal(uploadId, message);
    };

    if (chunkIndex !== uploadState.nextChunkIndex) {
      rejectChunk(`上传分块顺序错误：期望 ${uploadState.nextChunkIndex}，收到 ${chunkIndex}`);
      return;
    }
    if (uploadState.receivedLastChunk) {
      rejectChunk(`结束分块之后又收到分块 ${chunkIndex}`);
      return;
    }

    const nextAcceptedBytes = uploadState.bytesAccepted + chunkBuffer.length;
    if (nextAcceptedBytes > uploadState.totalSize) {
      rejectChunk(`上传数据超过声明大小：${nextAcceptedBytes}/${uploadState.totalSize} 字节`);
      return;
    }
    const reachesDeclaredSize = nextAcceptedBytes === uploadState.totalSize;
    if (isLast !== reachesDeclaredSize) {
      rejectChunk(
        isLast
          ? `结束分块过早：${nextAcceptedBytes}/${uploadState.totalSize} 字节`
          : `已达到声明大小但分块未标记结束：${nextAcceptedBytes}/${uploadState.totalSize} 字节`,
      );
      return;
    }

    uploadState.nextChunkIndex += 1;
    uploadState.bytesAccepted = nextAcceptedBytes;
    uploadState.receivedLastChunk = isLast;

    try {
      const writeSuccess = uploadState.stream.write(chunkBuffer, (error) => {
        if (this.activeUploads.get(uploadId) !== uploadState) return;
        if (error) {
          rejectChunk(`写入块 ${chunkIndex} 失败: ${error.message}`);
          return;
        }

        uploadState.bytesWritten += chunkBuffer.length;
        if (state.ws.readyState === WebSocket.OPEN) {
          const progressPercent =
            uploadState.totalSize === 0 ? 100 : Math.round((uploadState.bytesWritten / uploadState.totalSize) * 100);
          // ACK and progress share one frame to reduce JSON/WebSocket overhead,
          // which is especially noticeable when uploading many small files.
          state.ws.send(
            JSON.stringify({
              type: 'sftp:upload:chunk:ack',
              uploadId,
              payload: {
                uploadId,
                chunkIndex,
                bytesWritten: uploadState.bytesWritten,
                totalSize: uploadState.totalSize,
                progress: Math.min(100, progressPercent),
              },
            }),
          );
        }

        if (isLast && uploadState.bytesWritten === uploadState.totalSize && !uploadState.stream.writableEnded) {
          uploadState.stream.end((endError: (Error & { code?: string }) | undefined) => {
            if (!endError) return;
            if (endError.code === 'ERR_STREAM_DESTROYED' && uploadState.bytesWritten === uploadState.totalSize) {
              console.warn(`[SFTP Upload ${uploadId}] Stream already closed after all bytes were written.`);
              return;
            }
            rejectChunk(`结束写入流时出错: ${endError.message}`);
          });
        }
      });

      if (!writeSuccess) {
        if (!uploadState.drainPromise) {
          uploadState.drainPromise = new Promise<void>((resolve) => {
            uploadState.stream.once('drain', () => {
              uploadState.drainPromise = null;
              resolve();
            });
          });
        }
        await uploadState.drainPromise;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rejectChunk(`处理二进制分块 ${chunkIndex} 时出错: ${message}`);
    }
  }

  /** Cancel an ongoing upload. Cancellation is idempotent, including the window
   * before the write stream has been created. */
  async cancelUpload(sessionId: string, uploadId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    this.cancelledUploadIds.add(uploadId);

    const activeUpload = this.activeUploads.get(uploadId);
    const pendingUpload = this.pendingUploads.get(uploadId);

    if (activeUpload) {
      console.log(`[SFTP Upload ${uploadId}] Cancelling upload for ${activeUpload.remotePath}`);
      // Logical cancellation takes effect synchronously inside cancelUploadInternal
      // (the active state is removed before its first await). Do the potentially slow
      // stream-close + remote .part cleanup in the background so the WebSocket handler
      // can acknowledge cancellation immediately instead of making the file manager wait.
      void this.cancelUploadInternal(uploadId, 'User cancelled').catch((error) => {
        console.warn(`[SFTP Upload ${uploadId}] Background cleanup after cancel failed:`, error);
      });
    } else if (pendingUpload) {
      // The start routine observes cancelledUploadIds at its next checkpoint and owns
      // cleanup of the temporary path. Do not issue a second SFTP unlink here: avoiding
      // duplicate remote I/O keeps an immediate cancel from competing with directory UI work.
      console.log(`[SFTP Upload ${uploadId}] Marked pending upload cancelled; start routine will clean it up.`);
    } else {
      console.log(
        `[SFTP Upload ${uploadId}] Cancel request is already complete or unknown; treating it as idempotent.`,
      );
      this.cancelledUploadIds.delete(uploadId);
    }

    if (state?.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'sftp:upload:cancelled', payload: { uploadId } }));
    }
  }

  /** Cancel a user-selected upload set with one control-plane request. */
  async cancelUploads(sessionId: string, uploadIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(uploadIds)].filter((id) => typeof id === 'string' && id.length > 0).slice(0, 20000);
    await Promise.all(uniqueIds.map((uploadId) => this.cancelUpload(sessionId, uploadId)));
  }

  /** Stop an active stream and remove only its private temporary file. */
  private async cancelUploadInternal(uploadId: string, reason: string, triggeringError?: unknown): Promise<void> {
    const uploadState = this.activeUploads.get(uploadId);
    if (!uploadState) return;

    // Remove first so stream close can never finalize a cancelled upload.
    this.activeUploads.delete(uploadId);
    const stream = uploadState.stream;

    if (triggeringError) {
      console.warn(`[SFTP Upload ${uploadId}] Aborting after ${reason}:`, triggeringError);
    }

    if (!stream.destroyed) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          stream.off('close', finish);
          resolve();
        };
        const timeoutId = setTimeout(finish, 2000);
        stream.once('close', finish);
        stream.destroy();
      });
    }

    await this.removeRemoteUploadFile(uploadState.sessionId, uploadState.temporaryPath, uploadState.sftp);
    this.cancelledUploadIds.delete(uploadId);
  }

  /** Validate the completed part and atomically replace the destination where supported. */
  private async finalizeUploadedFile(_uploadId: string, uploadState: ActiveUpload): Promise<Stats> {
    const state = this.clientStates.get(uploadState.sessionId);
    if (!state) throw new Error('SSH 会话已断开');
    const uploadSftp = uploadState.sftp;

    const partStats = await this.filesystem(uploadSftp).lstat(uploadState.temporaryPath);
    if (partStats.size !== uploadState.totalSize) {
      throw new Error(`临时文件大小 (${partStats.size}) 与预期 (${uploadState.totalSize}) 不一致`);
    }

    await this.replaceRemoteUploadFile(uploadSftp, uploadState.temporaryPath, uploadState.remotePath);
    return this.filesystem(uploadSftp).lstat(uploadState.remotePath);
  }

  /** Prefer OpenSSH POSIX rename. The fallback keeps the old destination as a backup
   * until the new part has been moved successfully. */
  private async replaceRemoteUploadFile(sftp: SFTPWrapper, temporaryPath: string, remotePath: string): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        sftp.ext_openssh_rename(temporaryPath, remotePath, (err) => (err ? reject(err) : resolve()));
      });
      return;
    } catch (posixRenameError) {
      const destinationExists = await this.remotePathExists(sftp, remotePath);
      if (!destinationExists) {
        await this.filesystem(sftp).rename(temporaryPath, remotePath);
        return;
      }

      const backupPath = `${temporaryPath}.previous`;
      await this.unlinkSftpPath(sftp, backupPath, true);
      await this.filesystem(sftp).rename(remotePath, backupPath);
      try {
        await this.filesystem(sftp).rename(temporaryPath, remotePath);
        await this.unlinkSftpPath(sftp, backupPath, true);
      } catch (fallbackError) {
        try {
          await this.filesystem(sftp).rename(backupPath, remotePath);
        } catch (restoreError) {
          console.error(`[SFTP Upload] Failed to restore backup ${backupPath}:`, restoreError);
        }
        const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        const firstMessage = posixRenameError instanceof Error ? posixRenameError.message : String(posixRenameError);
        throw new Error(`替换目标文件失败: ${message} (POSIX rename: ${firstMessage})`);
      }
    }
  }

  private async remotePathExists(sftp: SFTPWrapper, remotePath: string): Promise<boolean> {
    try {
      await this.filesystem(sftp).lstat(remotePath);
      return true;
    } catch (error) {
      if (SftpChannelFileSystem.isMissing(error)) return false;
      throw error;
    }
  }

  private unlinkSftpPath(sftp: SFTPWrapper, remotePath: string, ignoreMissing = false): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (!err || (ignoreMissing && SftpChannelFileSystem.isMissing(err))) {
          resolve();
        } else {
          reject(err);
        }
      });
    });
  }






  private async removeRemoteUploadFile(
    sessionId: string,
    remotePath: string,
    preferredSftp?: SFTPWrapper,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const state = this.clientStates.get(sessionId);
      const uploadSftp = preferredSftp ?? state?.executionSession.sftp.transfer ?? state?.executionSession.sftp.control;
      if (!uploadSftp) return false;
      try {
        await this.unlinkSftpPath(uploadSftp, remotePath, true);
        return true;
      } catch (error) {
        if (attempt === 3) {
          console.warn(`[SFTP Upload] Unable to remove temporary file ${remotePath}:`, error);
          return false;
        }
        // Some servers briefly keep the file handle busy after stream.destroy().
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      }
    }
    return false;
  }

}
