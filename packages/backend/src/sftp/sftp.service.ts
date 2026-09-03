import { SFTPWrapper, Stats, WriteStream, type OpenMode } from 'ssh2';
import { WebSocket } from 'ws';
import { ClientState, AuthenticatedWebSocket } from '../websocket/types';
import * as pathModule from 'path';
import { quotePosixShellArg } from '../utils/shell';
import type { CommandSession } from '../execution/command-session';
// +++ 导入新类型 +++
import {
  SftpCompressRequestPayload,
  SftpCompressSuccessPayload,
  SftpCompressErrorPayload,
  SftpDecompressRequestPayload,
  SftpDecompressSuccessPayload,
  SftpDecompressErrorPayload,
} from '../websocket/types';

// +++ Define local interface for readdir results +++
interface SftpDirEntry {
  filename: string;
  longname: string;
  attrs: Stats;
}

// 定义服务器状态的数据结构 (与前端 StatusMonitor.vue 匹配)
// Note: This interface seems out of place here, but keeping it for now as it was in the original file.
// Ideally, it should be in a shared types file.
interface ServerStatus {
  cpuPercent?: number;
  memPercent?: number;
  memUsed?: number; // MB
  memTotal?: number; // MB
  swapPercent?: number;
  swapUsed?: number; // MB
  swapTotal?: number; // MB
  diskPercent?: number;
  diskUsed?: number; // KB
  diskTotal?: number; // KB
  cpuModel?: string;
  netRxRate?: number; // Bytes per second
  netTxRate?: number; // Bytes per second
  netInterface?: string;
  osName?: string;
  loadAvg?: number[]; // 系统平均负载 [1min, 5min, 15min]
  timestamp: number; // 状态获取时间戳
}

// Interface for parsed network stats - Also seems out of place here.
interface NetworkStats {
  [interfaceName: string]: {
    rx_bytes: number;
    tx_bytes: number;
  };
}

// Note: These constants seem related to StatusMonitorService, not SftpService.
const DEFAULT_POLLING_INTERVAL = 1000;
const previousNetStats = new Map<string, { rx: number; tx: number; timestamp: number }>();
const ARCHIVE_TOTAL_MARKER = '__NEXUS_ARCHIVE_TOTAL__:';
const ARCHIVE_WARNING_MARKER = '__NEXUS_ARCHIVE_WARNING__:';
const ARCHIVE_PASSWORD_REQUIRED_MARKER = '__NEXUS_ARCHIVE_PASSWORD_REQUIRED__';
const ARCHIVE_INVALID_PASSWORD_MARKER = '__NEXUS_ARCHIVE_INVALID_PASSWORD__';
const MAX_ARCHIVE_PASSWORD_LENGTH = 128;
const UPLOAD_WRITE_HIGH_WATER_MARK = 1024 * 1024;
const UPLOAD_DIRECTORY_PREPARE_CONCURRENCY = 8;
const SFTP_TRANSFER_CHUNK_SIZE = 32 * 1024;
const SFTP_TRANSFER_CONCURRENCY = 64;
const SFTP_TRANSFER_PROGRESS_INTERVAL_MS = 200;

type ArchivePasswordValidationError = {
  code: 'PASSWORD_TOO_LONG' | 'INVALID_PASSWORD_FORMAT';
  message: string;
};

const validateArchivePassword = (password: string | undefined): ArchivePasswordValidationError | null => {
  if (password === undefined) return null;
  if (password.length === 0) return { code: 'INVALID_PASSWORD_FORMAT', message: 'ZIP 密码不能为空' };
  if (Array.from(password).length > MAX_ARCHIVE_PASSWORD_LENGTH) {
    return { code: 'PASSWORD_TOO_LONG', message: `ZIP 密码不能超过 ${MAX_ARCHIVE_PASSWORD_LENGTH} 个字符` };
  }
  if (/[\0\r\n]/.test(password)) {
    return { code: 'INVALID_PASSWORD_FORMAT', message: 'ZIP 密码不能包含换行或空字符' };
  }
  return null;
};

interface SftpTransferTracker {
  sessionId: string;
  state: ClientState;
  requestId: string;
  totalBytes: number;
  transferredBytes: number;
  totalFiles: number;
  completedFiles: number;
  totalKnown: boolean;
  topLevelRemaining: number;
  containsDirectory: boolean;
  currentFile?: string;
  lastEmittedAt: number;
}

// Interface for tracking active uploads
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
  sessionId: string; // Link back to the session for cleanup
  relativePath?: string;
  drainPromise?: Promise<void> | null; // +++ For managing drain event listeners +++
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

interface ActiveArchiveOperation {
  sessionId: string;
  requestId: string;
  workspacePath?: string;
  commandSession: CommandSession;
  heartbeatInterval: ReturnType<typeof setInterval>;
  cancelled: boolean;
}

interface PendingArchiveOperation {
  sessionId: string;
  requestId: string;
  cancelled: boolean;
  preflightSession?: CommandSession;
}

export class SftpService {
  private clientStates: Map<string, ClientState>; // 使用导入的 ClientState
  private activeUploads: Map<string, ActiveUpload>; // Map<uploadId, ActiveUpload>
  private pendingUploads: Map<string, PendingUpload>;
  private cancelledUploadIds: Set<string>;
  private activeArchives: Map<string, ActiveArchiveOperation>;
  private pendingArchives: Map<string, PendingArchiveOperation>;
  private cancelledTransferIds: Set<string>;
  private activeTransferKeys: Set<string>;
  private directoryEnsurePromises = new WeakMap<SFTPWrapper, Map<string, Promise<void>>>();
  private preparedUploadBatches: Map<string, PreparedUploadBatch>;

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
    this.activeUploads = new Map(); // Initialize the map
    this.pendingUploads = new Map();
    this.cancelledUploadIds = new Set();
    this.activeArchives = new Map();
    this.pendingArchives = new Map();
    this.cancelledTransferIds = new Set();
    this.activeTransferKeys = new Set();
    this.preparedUploadBatches = new Map();
  }

  /**
   * 初始化 SFTP 会话
   * @param sessionId 会话 ID
   */
  async initializeSftpSession(sessionId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state?.executionSession.isReady) {
      console.warn(`[SFTP] 无法为会话 ${sessionId} 初始化 SFTP：SSH 会话未就绪。`);
      return;
    }
    if (state.executionSession.sftp.control) {
      return;
    }
    const channels = state.executionSession.sftp;
    try {
      await channels.ensure('control');
      console.log(`[SFTP] 会话 ${sessionId} 的 control channel 已就绪。`);
      state.ws.send(JSON.stringify({ type: 'sftp_ready', payload: { connectionId: state.dbConnectionId } }));
    } catch (error) {
      console.error(`[SFTP] 为会话 ${sessionId} 初始化 control channel 失败:`, error);
      state.ws.send(
        JSON.stringify({
          type: 'sftp_error',
          payload: { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' },
        }),
      );
      channels.close('control');
      throw error;
    }
  }

  /** Lazily open a transfer SFTP channel independent from control operations. */
  async ensureTransferSftpSession(sessionId: string): Promise<SFTPWrapper> {
    const state = this.clientStates.get(sessionId);
    if (!state?.executionSession.isReady) throw new Error('SSH 会话未就绪');
    return state.executionSession.sftp.ensure('transfer');
  }

  /**
   * 清理 SFTP 会话
   * @param sessionId 会话 ID
   */
  cleanupSftpSession(sessionId: string): void {
    const state = this.clientStates.get(sessionId);
    if (!state) return;
    const channels = state.executionSession.sftp;
    const cleanupTasks: Promise<unknown>[] = [];

    this.activeUploads.forEach((upload, uploadId) => {
      if (upload.sessionId === sessionId) cleanupTasks.push(this.cancelUploadInternal(uploadId, 'SFTP session ended'));
    });
    this.pendingUploads.forEach((upload, uploadId) => {
      if (upload.sessionId === sessionId) {
        this.cancelledUploadIds.add(uploadId);
        cleanupTasks.push(this.removeRemoteUploadFile(sessionId, upload.temporaryPath, upload.sftp));
      }
    });
    this.activeArchives.forEach((archive) => {
      if (archive.sessionId === sessionId) cleanupTasks.push(this.cancelArchive(sessionId, archive.requestId, false));
    });
    this.pendingArchives.forEach((archive) => {
      if (archive.sessionId === sessionId) cleanupTasks.push(this.cancelArchive(sessionId, archive.requestId, false));
    });
    this.preparedUploadBatches.forEach((batch, prepareId) => {
      if (batch.sessionId === sessionId) this.preparedUploadBatches.delete(prepareId);
    });

    for (const key of [...this.cancelledTransferIds]) {
      if (key.startsWith(`${sessionId}:`)) this.cancelledTransferIds.delete(key);
    }
    for (const key of [...this.activeTransferKeys]) {
      if (key.startsWith(`${sessionId}:`)) this.activeTransferKeys.delete(key);
    }

    void Promise.allSettled(cleanupTasks).finally(() => {
      channels.closeAll();
    });
  }

  // --- SFTP 操作方法 ---

  /** 读取目录内容 */


  /** 从指定目录开始按名称递归搜索文件和目录。符号链接目录不会继续向下遍历。 */

  /** 获取文件/目录状态信息 */

  /** 读取文件内容 (支持指定编码) */

  /** 写入文件内容 (支持指定编码) */
  // --- 修改：添加 encoding 参数 ---

  /** 创建目录 */

  /** 删除目录 (强制递归) */

  /** 删除文件 */

  /** 重命名/移动文件或目录 */

  /** 修改文件/目录权限 */

  /** 获取路径的绝对表示 */

  private transferCancellationKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }

  private assertTransferNotCancelled(tracker: SftpTransferTracker | undefined): void {
    if (!tracker) return;
    if (this.cancelledTransferIds.has(this.transferCancellationKey(tracker.sessionId, tracker.requestId))) {
      throw new Error('SFTP_TRANSFER_CANCELLED');
    }
  }

  private isTransferCancelledError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('SFTP_TRANSFER_CANCELLED');
  }

  private sendTransferCancelled(state: ClientState | undefined, requestId: string): void {
    if (state?.ws.readyState === WebSocket.OPEN) {
      state.ws.send(
        JSON.stringify({
          type: 'sftp:transfer:cancelled',
          requestId,
          payload: { requestId },
        }),
      );
    }
  }

  async cancelTransfer(sessionId: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const key = this.transferCancellationKey(sessionId, requestId);
    if (!this.activeTransferKeys.has(key)) {
      // The task already finished (or never started). Acknowledge the user's request
      // without leaving a cancellation marker that has no owner to clear it.
      this.sendTransferCancelled(state, requestId);
      return;
    }
    // Keep cancellation attached to the real transfer lifecycle. A single SFTP read/write
    // may remain blocked for much longer than 30 seconds; a TTL would let the task resume.
    this.cancelledTransferIds.add(key);
    if (state?.ws.readyState === WebSocket.OPEN) {
      state.ws.send(
        JSON.stringify({
          type: 'sftp:transfer:cancelling',
          requestId,
          payload: { requestId },
        }),
      );
    }
  }

  private createTransferTracker(
    sessionId: string,
    state: ClientState,
    sources: string[],
    requestId: string,
  ): SftpTransferTracker {
    // Do not block transfer startup just to calculate progress. Top-level metadata is
    // collected by the copy loop itself, so a single file needs only one source stat.
    const tracker: SftpTransferTracker = {
      sessionId,
      state,
      requestId,
      totalBytes: 0,
      transferredBytes: 0,
      totalFiles: 0,
      completedFiles: 0,
      totalKnown: false,
      topLevelRemaining: sources.length,
      containsDirectory: false,
      lastEmittedAt: 0,
    };
    this.emitTransferProgress(tracker, true);
    return tracker;
  }

  private registerTopLevelTransferEntry(tracker: SftpTransferTracker | undefined, stats: Stats): void {
    if (!tracker) return;
    if (stats.isFile()) {
      tracker.totalBytes += Math.max(0, stats.size);
      tracker.totalFiles += 1;
    } else if (stats.isDirectory()) {
      tracker.containsDirectory = true;
    }
    tracker.topLevelRemaining = Math.max(0, tracker.topLevelRemaining - 1);
    if (tracker.topLevelRemaining === 0 && !tracker.containsDirectory) {
      tracker.totalKnown = true;
    }
    this.emitTransferProgress(tracker, true);
  }

  private discoverTransferFile(tracker: SftpTransferTracker | undefined, bytes: number): void {
    if (!tracker || tracker.totalKnown) return;
    tracker.totalBytes += Math.max(0, bytes);
    tracker.totalFiles += 1;
    this.emitTransferProgress(tracker);
  }

  private finalizeTransferTracker(tracker: SftpTransferTracker | undefined): void {
    if (!tracker) return;
    tracker.totalKnown = true;
    tracker.currentFile = undefined;
    this.emitTransferProgress(tracker, true);
  }

  private emitTransferProgress(tracker: SftpTransferTracker, force = false): void {
    const now = Date.now();
    if (!force && now - tracker.lastEmittedAt < SFTP_TRANSFER_PROGRESS_INTERVAL_MS) return;
    tracker.lastEmittedAt = now;
    tracker.state.ws.send(
      JSON.stringify({
        type: 'sftp:transfer:progress',
        requestId: tracker.requestId,
        payload: {
          transferredBytes: tracker.transferredBytes,
          totalBytes: tracker.totalBytes,
          completedFiles: tracker.completedFiles,
          totalFiles: tracker.totalFiles,
          totalKnown: tracker.totalKnown,
          currentFile: tracker.currentFile,
        },
      }),
    );
  }

  private beginTransferFile(tracker: SftpTransferTracker | undefined, remotePath: string): void {
    if (!tracker) return;
    tracker.currentFile = remotePath;
    this.emitTransferProgress(tracker, true);
  }

  private recordTransferredBytes(tracker: SftpTransferTracker | undefined, bytes: number): void {
    if (!tracker || bytes <= 0) return;
    tracker.transferredBytes += bytes;
    this.emitTransferProgress(tracker);
  }

  private completeTransferFile(tracker: SftpTransferTracker | undefined): void {
    if (!tracker) return;
    tracker.completedFiles += 1;
    this.emitTransferProgress(tracker, true);
  }

  // +++ 复制文件或目录 +++
  async copy(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.executionSession.sftp.control) {
      console.warn(`[SFTP Copy] SFTP 未准备好，无法在 ${sessionId} 上执行 copy (ID: ${requestId})`);
      state?.ws.send(JSON.stringify({ type: 'sftp:copy:error', payload: 'SFTP 会话未就绪', requestId: requestId }));
      return;
    }
    const sftp = state.executionSession.sftp.control;
    console.debug(
      `[SFTP ${sessionId}] Received copy request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`,
    );

    const copiedItemsDetails: any[] = []; // Store details of successfully copied items
    let firstError: Error | null = null;
    const transferKey = this.transferCancellationKey(sessionId, requestId);
    this.activeTransferKeys.add(transferKey);

    try {
      const tracker = this.createTransferTracker(sessionId, state, sources, requestId);
      this.assertTransferNotCancelled(tracker);

      for (const sourcePath of sources) {
        this.assertTransferNotCancelled(tracker);
        const sourceName = pathModule.basename(sourcePath);
        const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

        if (sourcePath === destPath) {
          console.warn(
            `[SFTP ${sessionId}] Skipping copy: source and destination are the same (${sourcePath}) (ID: ${requestId})`,
          );
          continue; // Skip if source and destination are identical
        }

        try {
          const stats = await this.getTargetStats(sftp, sourcePath);
          this.registerTopLevelTransferEntry(tracker, stats);
          if (stats.isDirectory()) {
            console.log(`[SFTP ${sessionId}] Copying directory ${sourcePath} to ${destPath} (ID: ${requestId})`);
            await this.copyDirectoryRecursive(sftp, sourcePath, destPath, new Set(), tracker);
          } else if (stats.isFile()) {
            console.log(`[SFTP ${sessionId}] Copying file ${sourcePath} to ${destPath} (ID: ${requestId})`);
            this.beginTransferFile(tracker, sourcePath);
            await this.copyFile(sftp, sourcePath, destPath, stats.size, tracker);
            this.completeTransferFile(tracker);
          } else {
            // Handle symlinks or other types if necessary, for now just skip/warn
            console.warn(
              `[SFTP ${sessionId}] Skipping copy of unsupported file type: ${sourcePath} (ID: ${requestId})`,
            );
            continue;
          }
          // Get stats of the *newly copied* item
          const copiedStats = await this.getStats(sftp, destPath);
          copiedItemsDetails.push(this.formatStatsToFileListItem(destPath, copiedStats));
        } catch (copyErr: any) {
          console.error(`[SFTP ${sessionId}] Error copying ${sourcePath} to ${destPath} (ID: ${requestId}):`, copyErr);
          firstError = copyErr; // Store the first error encountered
          break; // Stop processing further sources on error
        }
      }

      if (firstError) {
        throw firstError; // Throw the first error to be caught below
      }

      this.assertTransferNotCancelled(tracker);
      this.finalizeTransferTracker(tracker);

      // Send success message with details of copied items
      console.log(
        `[SFTP ${sessionId}] Copy operation completed successfully (ID: ${requestId}). Copied items: ${copiedItemsDetails.length}`,
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:copy:success',
          payload: { destination: destinationDir, items: copiedItemsDetails },
          requestId: requestId,
        }),
      );
    } catch (error: any) {
      const cancelled = this.isTransferCancelledError(error) || this.cancelledTransferIds.has(transferKey);
      if (cancelled) {
        console.log(`[SFTP ${sessionId}] Copy operation cancelled (ID: ${requestId}).`);
        this.sendTransferCancelled(state, requestId);
        return;
      }
      console.error(`[SFTP ${sessionId}] Copy operation failed (ID: ${requestId}):`, error);
      state.ws.send(
        JSON.stringify({ type: 'sftp:copy:error', payload: `复制操作失败: ${error.message}`, requestId: requestId }),
      );
    } finally {
      this.activeTransferKeys.delete(transferKey);
      this.cancelledTransferIds.delete(transferKey);
    }
  }

  async copyAcrossSessions(
    destinationSessionId: string,
    sourceSessionId: string,
    sources: string[],
    destinationDir: string,
    requestId: string,
  ): Promise<void> {
    const destinationState = this.clientStates.get(destinationSessionId);
    const sourceState = this.clientStates.get(sourceSessionId);
    const fail = (message: string) => {
      destinationState?.ws.send(JSON.stringify({ type: 'sftp:copy:error', payload: message, requestId }));
    };

    if (!destinationState?.executionSession.sftp.control) {
      fail('目标 SFTP 会话未就绪');
      return;
    }
    if (!sourceState?.executionSession.sftp.control) {
      fail('源 SFTP 会话未就绪或已断开');
      return;
    }
    if (destinationState.ws.userId === undefined || sourceState.ws.userId !== destinationState.ws.userId) {
      fail('无权访问源 SFTP 会话');
      return;
    }

    const sourceSftp = sourceState.executionSession.sftp.control;
    const destinationSftp = destinationState.executionSession.sftp.control;
    const copiedItemsDetails: any[] = [];
    const transferKey = this.transferCancellationKey(destinationSessionId, requestId);
    this.activeTransferKeys.add(transferKey);

    try {
      const tracker = this.createTransferTracker(destinationSessionId, destinationState, sources, requestId);
      this.assertTransferNotCancelled(tracker);

      for (const sourcePath of sources) {
        this.assertTransferNotCancelled(tracker);
        if (typeof sourcePath !== 'string' || !sourcePath.startsWith('/')) {
          throw new Error('源路径无效');
        }
        const sourceName = pathModule.basename(sourcePath);
        const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/');
        const stats = await this.getTargetStats(sourceSftp, sourcePath);
        this.registerTopLevelTransferEntry(tracker, stats);

        if (stats.isDirectory()) {
          await this.copyDirectoryBetweenSftp(sourceSftp, destinationSftp, sourcePath, destPath, new Set(), tracker);
        } else if (stats.isFile()) {
          this.beginTransferFile(tracker, sourcePath);
          await this.copyFileBetweenSftp(sourceSftp, destinationSftp, sourcePath, destPath, stats.size, tracker);
          this.completeTransferFile(tracker);
        } else {
          console.warn(`[SFTP Cross Copy] Skipping unsupported type: ${sourcePath}`);
          continue;
        }

        const copiedStats = await this.getStats(destinationSftp, destPath);
        copiedItemsDetails.push(this.formatStatsToFileListItem(destPath, copiedStats));
      }

      this.assertTransferNotCancelled(tracker);
      this.finalizeTransferTracker(tracker);

      destinationState.ws.send(
        JSON.stringify({
          type: 'sftp:copy:success',
          payload: {
            destination: destinationDir,
            items: copiedItemsDetails,
            sourceSessionId,
            crossHost: true,
          },
          requestId,
        }),
      );
    } catch (error: any) {
      const cancelled = this.isTransferCancelledError(error) || this.cancelledTransferIds.has(transferKey);
      if (cancelled) {
        console.log(`[SFTP Cross Copy ${sourceSessionId} -> ${destinationSessionId}] Cancelled (ID: ${requestId}).`);
        this.sendTransferCancelled(destinationState, requestId);
        return;
      }
      console.error(
        `[SFTP Cross Copy ${sourceSessionId} -> ${destinationSessionId}] Failed (ID: ${requestId}):`,
        error,
      );
      fail(`跨主机复制失败: ${error.message}`);
    } finally {
      this.activeTransferKeys.delete(transferKey);
      this.cancelledTransferIds.delete(transferKey);
    }
  }


  // +++ 移动文件或目录 +++
  async move(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.executionSession.sftp.control) {
      console.warn(`[SFTP Move] SFTP 未准备好，无法在 ${sessionId} 上执行 move (ID: ${requestId})`);
      state?.ws.send(JSON.stringify({ type: 'sftp:move:error', payload: 'SFTP 会话未就绪', requestId: requestId }));
      return;
    }
    const sftp = state.executionSession.sftp.control;
    console.debug(
      `[SFTP ${sessionId}] Received move request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`,
    );

    const movedItemsDetails: any[] = [];
    let firstError: Error | null = null;
    const transferKey = this.transferCancellationKey(sessionId, requestId);
    this.activeTransferKeys.add(transferKey);
    const tracker: SftpTransferTracker = {
      sessionId,
      state,
      requestId,
      totalBytes: 0,
      transferredBytes: 0,
      totalFiles: sources.length,
      completedFiles: 0,
      totalKnown: true,
      topLevelRemaining: 0,
      containsDirectory: false,
      lastEmittedAt: 0,
    };
    this.emitTransferProgress(tracker, true);

    try {
      // Ensure destination directory exists (important for move)
      try {
        await this.ensureDirectoryExists(sftp, destinationDir);
      } catch (ensureErr: any) {
        console.error(
          `[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists for move (ID: ${requestId}):`,
          ensureErr,
        );
        throw new Error(`无法创建或访问目标目录: ${ensureErr.message}`);
      }

      this.assertTransferNotCancelled(tracker);
      for (const oldPath of sources) {
        this.assertTransferNotCancelled(tracker);
        const sourceName = pathModule.basename(oldPath);
        const newPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

        if (oldPath === newPath) {
          console.warn(
            `[SFTP ${sessionId}] Skipping move: source and destination are the same (${oldPath}) (ID: ${requestId})`,
          );
          continue; // Skip if source and destination are identical
        }

        try {
          // --- 移动前检查目标是否存在 ---
          let targetExists = false;
          try {
            await this.getStats(sftp, newPath);
            targetExists = true;
          } catch (statErr: any) {
            if (!this.isNoSuchFileError(statErr)) {
              // 如果 stat 失败不是因为 "No such file"，则抛出未知错误
              throw new Error(`检查目标路径 ${newPath} 状态时出错: ${statErr.message}`);
            }
            // 如果是 "No such file"，则 targetExists 保持 false，可以继续移动
          }

          if (targetExists) {
            console.error(`[SFTP ${sessionId}] Move failed: Target path ${newPath} already exists (ID: ${requestId})`);
            throw new Error(`目标路径 ${pathModule.basename(newPath)} 已存在`);
          }

          console.log(`[SFTP ${sessionId}] Moving ${oldPath} to ${newPath} (ID: ${requestId})`);
          this.beginTransferFile(tracker, oldPath);
          await this.performRename(sftp, oldPath, newPath); // Use helper for rename logic
          this.completeTransferFile(tracker);

          // Get stats of the *moved* item at the new location
          const movedStats = await this.getStats(sftp, newPath);
          movedItemsDetails.push(this.formatStatsToFileListItem(newPath, movedStats));
        } catch (moveErr: any) {
          console.error(`[SFTP ${sessionId}] Error moving ${oldPath} to ${newPath} (ID: ${requestId}):`, moveErr);
          firstError = moveErr;
          break; // Stop on first error for move
        }
      }

      if (firstError) {
        throw firstError;
      }

      this.assertTransferNotCancelled(tracker);
      console.log(
        `[SFTP ${sessionId}] Move operation completed successfully (ID: ${requestId}). Moved items: ${movedItemsDetails.length}`,
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:move:success',
          payload: { sources: sources, destination: destinationDir, items: movedItemsDetails },
          requestId: requestId,
        }),
      );
    } catch (error: any) {
      const cancelled = this.isTransferCancelledError(error) || this.cancelledTransferIds.has(transferKey);
      if (cancelled) {
        console.log(`[SFTP ${sessionId}] Move operation cancelled (ID: ${requestId}).`);
        this.sendTransferCancelled(state, requestId);
        return;
      }
      console.error(`[SFTP ${sessionId}] Move operation failed (ID: ${requestId}):`, error);
      state.ws.send(
        JSON.stringify({ type: 'sftp:move:error', payload: `移动操作失败: ${error.message}`, requestId: requestId }),
      );
    } finally {
      this.activeTransferKeys.delete(transferKey);
      this.cancelledTransferIds.delete(transferKey);
    }
  }

  // +++ 辅助方法 - 复制文件 +++
  private copyFile(
    sftp: SFTPWrapper,
    sourcePath: string,
    destPath: string,
    fileSize: number,
    tracker?: SftpTransferTracker,
  ): Promise<void> {
    return this.copyFileBetweenSftp(sftp, sftp, sourcePath, destPath, fileSize, tracker);
  }

  private openSftpFile(sftp: SFTPWrapper, remotePath: string, flags: OpenMode): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      sftp.open(remotePath, flags, (error, handle) => {
        if (error) reject(error);
        else resolve(handle);
      });
    });
  }

  private closeSftpFile(sftp: SFTPWrapper, handle: Buffer | undefined): Promise<void> {
    if (!handle) return Promise.resolve();
    return new Promise((resolve) => {
      sftp.close(handle, () => resolve());
    });
  }

  private readSftpBlock(
    sftp: SFTPWrapper,
    handle: Buffer,
    buffer: Buffer,
    position: number,
    length: number,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      sftp.read(handle, buffer, 0, length, position, (error, bytesRead) => {
        if (error) reject(error);
        else resolve(bytesRead);
      });
    });
  }

  private writeSftpBlock(
    sftp: SFTPWrapper,
    handle: Buffer,
    buffer: Buffer,
    position: number,
    length: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.write(handle, buffer, 0, length, position, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async copyFileBetweenSftp(
    sourceSftp: SFTPWrapper,
    destinationSftp: SFTPWrapper,
    sourcePath: string,
    destPath: string,
    fileSize: number,
    tracker?: SftpTransferTracker,
  ): Promise<void> {
    let sourceHandle: Buffer | undefined;
    let destinationHandle: Buffer | undefined;
    try {
      this.assertTransferNotCancelled(tracker);
      const [sourceOpen, destinationOpen] = await Promise.allSettled([
        this.openSftpFile(sourceSftp, sourcePath, 'r'),
        this.openSftpFile(destinationSftp, destPath, 'w'),
      ]);
      if (sourceOpen.status === 'fulfilled') sourceHandle = sourceOpen.value;
      if (destinationOpen.status === 'fulfilled') destinationHandle = destinationOpen.value;
      if (sourceOpen.status === 'rejected') throw sourceOpen.reason;
      if (destinationOpen.status === 'rejected') throw destinationOpen.reason;
      if (fileSize <= 0) return;

      let nextPosition = 0;
      const workerCount = Math.min(
        SFTP_TRANSFER_CONCURRENCY,
        Math.max(1, Math.ceil(fileSize / SFTP_TRANSFER_CHUNK_SIZE)),
      );

      const worker = async () => {
        while (true) {
          this.assertTransferNotCancelled(tracker);
          const position = nextPosition;
          if (position >= fileSize) return;
          const blockLength = Math.min(SFTP_TRANSFER_CHUNK_SIZE, fileSize - position);
          nextPosition += blockLength;

          let blockOffset = 0;
          while (blockOffset < blockLength) {
            const remaining = blockLength - blockOffset;
            const buffer = Buffer.allocUnsafe(remaining);
            const bytesRead = await this.readSftpBlock(
              sourceSftp,
              sourceHandle!,
              buffer,
              position + blockOffset,
              remaining,
            );
            if (bytesRead <= 0) {
              throw new Error(`读取 ${sourcePath} 时提前到达文件末尾`);
            }
            this.assertTransferNotCancelled(tracker);
            await this.writeSftpBlock(destinationSftp, destinationHandle!, buffer, position + blockOffset, bytesRead);
            blockOffset += bytesRead;
            this.recordTransferredBytes(tracker, bytesRead);
          }
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } catch (error: any) {
      throw new Error(`复制文件失败: ${error.message}`);
    } finally {
      await Promise.all([
        this.closeSftpFile(sourceSftp, sourceHandle),
        this.closeSftpFile(destinationSftp, destinationHandle),
      ]);
    }
  }

  private async copyDirectoryBetweenSftp(
    sourceSftp: SFTPWrapper,
    destinationSftp: SFTPWrapper,
    sourcePath: string,
    destPath: string,
    ancestorRealPaths: ReadonlySet<string> = new Set(),
    tracker?: SftpTransferTracker,
  ): Promise<void> {
    this.assertTransferNotCancelled(tracker);
    const realPath = await this.getRealPath(sourceSftp, sourcePath);
    if (ancestorRealPaths.has(realPath)) {
      console.warn(`[SFTP Cross Copy] Skipping circular symbolic link: ${sourcePath} -> ${realPath}`);
      return;
    }
    const nextAncestors = new Set(ancestorRealPaths);
    nextAncestors.add(realPath);

    await this.ensureDirectoryExists(destinationSftp, destPath);
    const items = await this.listDirectory(sourceSftp, sourcePath);

    for (const item of items) {
      this.assertTransferNotCancelled(tracker);
      const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
      const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
      const itemStats = item.attrs.isSymbolicLink()
        ? await this.getTargetStats(sourceSftp, currentSourcePath)
        : item.attrs;

      if (itemStats.isDirectory()) {
        await this.copyDirectoryBetweenSftp(
          sourceSftp,
          destinationSftp,
          currentSourcePath,
          currentDestPath,
          nextAncestors,
          tracker,
        );
      } else if (itemStats.isFile()) {
        this.discoverTransferFile(tracker, itemStats.size);
        this.beginTransferFile(tracker, currentSourcePath);
        await this.copyFileBetweenSftp(
          sourceSftp,
          destinationSftp,
          currentSourcePath,
          currentDestPath,
          itemStats.size,
          tracker,
        );
        this.completeTransferFile(tracker);
      } else {
        console.warn(`[SFTP Cross Copy] Skipping unsupported type: ${currentSourcePath}`);
      }
    }
  }

  // +++ 辅助方法 - 递归复制目录 +++
  private async copyDirectoryRecursive(
    sftp: SFTPWrapper,
    sourcePath: string,
    destPath: string,
    ancestorRealPaths: ReadonlySet<string> = new Set(),
    tracker?: SftpTransferTracker,
  ): Promise<void> {
    try {
      this.assertTransferNotCancelled(tracker);
      const realPath = await this.getRealPath(sftp, sourcePath);
      if (ancestorRealPaths.has(realPath)) {
        console.warn(`[SFTP Copy Recurse] Skipping circular symbolic link: ${sourcePath} -> ${realPath}`);
        return;
      }
      const nextAncestors = new Set(ancestorRealPaths);
      nextAncestors.add(realPath);

      // Create destination directory
      await this.ensureDirectoryExists(sftp, destPath);

      // Read source directory contents
      const items = await this.listDirectory(sftp, sourcePath);

      for (const item of items) {
        this.assertTransferNotCancelled(tracker);
        const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
        const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
        const itemStats = item.attrs.isSymbolicLink() ? await this.getTargetStats(sftp, currentSourcePath) : item.attrs;

        if (itemStats.isDirectory()) {
          await this.copyDirectoryRecursive(sftp, currentSourcePath, currentDestPath, nextAncestors, tracker);
        } else if (itemStats.isFile()) {
          this.discoverTransferFile(tracker, itemStats.size);
          this.beginTransferFile(tracker, currentSourcePath);
          await this.copyFile(sftp, currentSourcePath, currentDestPath, itemStats.size, tracker);
          this.completeTransferFile(tracker);
        } else {
          console.warn(`[SFTP Copy Recurse] Skipping unsupported type: ${currentSourcePath}`);
        }
      }
    } catch (error: any) {
      console.error(`Error recursively copying directory ${sourcePath} to ${destPath}:`, error);
      throw new Error(`递归复制目录失败: ${error.message}`);
    }
  }

  // +++ 辅助方法 - 获取 Stats (Promise wrapper) +++
  private getStats(sftp: SFTPWrapper, path: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      sftp.lstat(path, (err, stats) => {
        if (err) {
          reject(err);
        } else {
          resolve(stats);
        }
      });
    });
  }

  // Follow symbolic links when an operation needs the target type/content.
  private getTargetStats(sftp: SFTPWrapper, path: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      sftp.stat(path, (err, stats) => {
        if (err) {
          reject(err);
        } else {
          resolve(stats);
        }
      });
    });
  }

  private getRealPath(sftp: SFTPWrapper, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      sftp.realpath(path, (err, realPath) => {
        if (err) {
          reject(err);
        } else {
          resolve(realPath);
        }
      });
    });
  }

  // +++ 修改：辅助方法 - 确保目录存在 (递归创建) +++
  private async ensureDirectoryExists(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    const normalizedPath = dirPath.replace(/\/$/, '');
    if (!normalizedPath || normalizedPath === '/') return;

    let sessionPromises = this.directoryEnsurePromises.get(sftp);
    if (!sessionPromises) {
      sessionPromises = new Map<string, Promise<void>>();
      this.directoryEnsurePromises.set(sftp, sessionPromises);
    }

    const existingPromise = sessionPromises.get(normalizedPath);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    const ensurePromise = this.ensureDirectoryExistsInternal(sftp, normalizedPath).finally(() => {
      sessionPromises?.delete(normalizedPath);
    });
    sessionPromises.set(normalizedPath, ensurePromise);
    await ensurePromise;
  }

  private async ensureDirectoryExistsInternal(sftp: SFTPWrapper, normalizedPath: string): Promise<void> {
    try {
      const stats = await this.getStats(sftp, normalizedPath);
      if (!stats.isDirectory()) {
        throw new Error(`路径 ${normalizedPath} 已存在但不是目录`);
      }
      return;
    } catch (statError: any) {
      if (!this.isNoSuchFileError(statError)) {
        throw new Error(`检查目录失败 ${normalizedPath}: ${statError.message}`);
      }
    }

    const parentDir = pathModule.dirname(normalizedPath).replace(/\\/g, '/');
    if (parentDir && parentDir !== '/' && parentDir !== '.') {
      await this.ensureDirectoryExists(sftp, parentDir);
    }

    try {
      await new Promise<void>((resolveMkdir, rejectMkdir) => {
        sftp.mkdir(normalizedPath, (mkdirErr) => {
          if (mkdirErr) {
            rejectMkdir(new Error(`创建目录失败 ${normalizedPath}: ${mkdirErr.message}`));
          } else {
            console.log(`[SFTP Util] Created directory: ${normalizedPath}`);
            resolveMkdir();
          }
        });
      });
    } catch (mkdirError: unknown) {
      // Some SFTP servers return a generic "Failure" when another request creates the
      // same directory first. Verify the final state and treat that race as success.
      const finalStats = await this.getStats(sftp, normalizedPath).catch(() => null);
      if (finalStats?.isDirectory()) {
        console.debug(`[SFTP Util] Directory already exists after concurrent mkdir: ${normalizedPath}`);
        return;
      }
      throw mkdirError;
    }
  }

  // +++ 辅助方法 - 列出目录内容 (Promise wrapper) +++
  private listDirectory(sftp: SFTPWrapper, path: string): Promise<SftpDirEntry[]> {
    // 使用本地接口 SftpDirEntry
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        // list 的类型现在是 SftpDirEntry[]
        if (err) {
          reject(err);
        } else {
          resolve(list);
        }
      });
    });
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

  // +++ 辅助方法 - 格式化 Stats 为 FileListItem +++
  private formatStatsToFileListItem(itemPath: string, stats: Stats): any {
    return {
      filename: pathModule.basename(itemPath),
      longname: '', // stat doesn't provide longname, maybe generate a basic one?
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
  }

  // --- Compress/Decompress Methods ---
  /**
   * 压缩远程服务器上的文件/目录
   * @param sessionId 会话 ID
   * @param payload 压缩请求的 payload
   */
  async compress(sessionId: string, payload: SftpCompressRequestPayload): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const { sources, destinationArchiveName, format, targetDirectory, password, requestId } = payload;
    const archiveKey = `${sessionId}:${requestId}`;

    if (!state?.executionSession.isReady) {
      this.sendCompressError(state?.ws, 'SSH 会话未就绪', requestId);
      return;
    }

    const passwordError = validateArchivePassword(password);
    if (passwordError) {
      this.sendCompressError(state.ws, passwordError.message, requestId, undefined, passwordError.code);
      return;
    }
    if (password !== undefined && format !== 'zip') {
      this.sendCompressError(state.ws, '只有 ZIP 格式支持密码保护', requestId);
      return;
    }

    const requiredCommand = format === 'zip' ? 'zip' : 'tar';
    const pendingArchive: PendingArchiveOperation = { sessionId, requestId, cancelled: false };
    this.pendingArchives.set(archiveKey, pendingArchive);
    try {
      if (!(await this.checkCommandExists(state, sessionId, requiredCommand, pendingArchive))) {
        this.pendingArchives.delete(archiveKey);
        if (!pendingArchive.cancelled) {
          this.sendCompressError(
            state.ws,
            `命令 '${requiredCommand}' 在服务器上未找到`,
            requestId,
            `Command '${requiredCommand}' not found on server.`,
          );
        }
        return;
      }
    } catch (checkError: any) {
      this.pendingArchives.delete(archiveKey);
      if (!pendingArchive.cancelled) {
        this.sendCompressError(state.ws, `检查命令 '${requiredCommand}' 时出错`, requestId, checkError.message);
      }
      return;
    }

    if (pendingArchive.cancelled) {
      this.pendingArchives.delete(archiveKey);
      return;
    }

    const extension = format === 'zip' ? '.zip' : format === 'targz' ? '.tar.gz' : '.tar.bz2';
    const safeRequestId = requestId.replace(/[^A-Za-z0-9_-]/g, '_');
    const workspaceName = `.nexus-archive-${safeRequestId}.work`;
    const workspacePath = pathModule.posix.join(targetDirectory, workspaceName);
    const relativeSources: string[] = [];
    for (const source of sources) {
      const relativePath = pathModule.posix.relative(targetDirectory, source);
      if (relativePath === '..' || relativePath.startsWith('../')) {
        this.pendingArchives.delete(archiveKey);
        this.sendCompressError(state.ws, `压缩源路径不在目标目录内: ${source}`, requestId);
        return;
      }
      const normalized = relativePath === '' || relativePath === '.' ? pathModule.posix.basename(source) : relativePath;
      relativeSources.push(`./${normalized.replace(/^\.\/+/, '')}`);
    }

    const workspaceRelativePath = `./${workspaceName}`;
    const temporaryArchiveRelativePath = `${workspaceRelativePath}/archive${extension}`;
    const destinationArchiveRelativePath = `./${destinationArchiveName}`;
    const quotedSources = relativeSources.map(quotePosixShellArg).join(' ');
    const quotedTargetDir = quotePosixShellArg(targetDirectory);
    const quotedWorkspace = quotePosixShellArg(workspaceRelativePath);
    const quotedTemporaryArchive = quotePosixShellArg(temporaryArchiveRelativePath);
    const quotedDestinationName = quotePosixShellArg(destinationArchiveRelativePath);
    const quotedPassword = password !== undefined ? quotePosixShellArg(password) : null;
    const countCommand = `total=$(find ${quotedSources} -print 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
    const archiveCommand =
      format === 'zip'
        ? `zip ${quotedPassword ? `-P ${quotedPassword} ` : ''}-b ${quotedWorkspace} -r ${quotedTemporaryArchive} ${quotedSources}`
        : format === 'targz'
          ? `tar -czvf ${quotedTemporaryArchive} ${quotedSources}`
          : `tar -cjvf ${quotedTemporaryArchive} ${quotedSources}`;
    const cleanupFunction = [
      'cleanup_archive() {',
      'status=$?;',
      'trap - EXIT HUP INT TERM;',
      'if [ -n "${archive_pid:-}" ]; then kill "$archive_pid" 2>/dev/null || true; stop_attempt=0; while kill -0 "$archive_pid" 2>/dev/null && [ "$stop_attempt" -lt 5 ]; do sleep 0.2; stop_attempt=$((stop_attempt + 1)); done; kill -9 "$archive_pid" 2>/dev/null || true; wait "$archive_pid" 2>/dev/null || true; fi;',
      `rm -rf -- ${quotedWorkspace};`,
      'exit "$status";',
      '}',
    ].join(' ');
    const archiveResultCheck =
      format === 'zip' && password === undefined
        ? `if [ "$archive_status" -ne 0 ]; then if [ -s ${quotedTemporaryArchive} ] && zip -T ${quotedTemporaryArchive} >/dev/null 2>&1; then printf '${ARCHIVE_WARNING_MARKER}%s\n' "$archive_status"; else exit "$archive_status"; fi; fi`
        : 'if [ "$archive_status" -ne 0 ]; then exit "$archive_status"; fi';
    const command = [
      `cd ${quotedTargetDir} || exit $?`,
      `rm -rf -- ${quotedWorkspace}`,
      `mkdir -p -- ${quotedWorkspace} || exit $?`,
      cleanupFunction,
      'trap cleanup_archive EXIT HUP INT TERM',
      countCommand,
      `${archiveCommand} & archive_pid=$!`,
      'wait "$archive_pid"; archive_status=$?; archive_pid=',
      archiveResultCheck,
      `mv -f -- ${quotedTemporaryArchive} ${quotedDestinationName}`,
    ].join('; ');

    try {
      const commandSession = await state.executionSession.commands.start({ command, id: `archive:${requestId}` });
      this.pendingArchives.delete(archiveKey);
      if (pendingArchive.cancelled) {
        void this.stopArchiveCommandSession(commandSession).then(() =>
          this.removeRemoteArchiveWorkspace(sessionId, workspacePath),
        );
        return;
      }

      let stderrData = '';
        let stdoutRemainder = '';
        let stderrRemainder = '';
        let fileCount = 0;
        let totalFiles: number | undefined;
        let archiveWarningCode: number | undefined;
        let archiveWarningData = '';
        let lastProgressTime = 0;
        let lastSeenFileName: string | undefined;
        let streamFinished = false;

        const sendProgress = (force = false) => {
          const now = Date.now();
          if (!force && now - lastProgressTime < 1000) return;
          lastProgressTime = now;
          this.sendArchiveProgress(state.ws, 'compress', requestId, fileCount, lastSeenFileName, totalFiles);
        };
        const consumeOutput = (chunk: string, remainder: string): string => {
          const lines = `${remainder}${chunk}`.split(/\r?\n/);
          const nextRemainder = lines.pop() || '';
          for (const line of lines) {
            const parsedTotal = this.parseArchiveTotal(line);
            if (parsedTotal !== null) {
              totalFiles = parsedTotal > 0 ? parsedTotal : undefined;
              sendProgress(true);
              continue;
            }
            const parsedWarningCode = this.parseArchiveWarningCode(line);
            if (parsedWarningCode !== null) {
              archiveWarningCode = parsedWarningCode;
              continue;
            }
            if (/\b(?:zip|tar) warning:/i.test(line)) {
              archiveWarningData = this.appendBoundedOutput(archiveWarningData, `${line.trim()}\n`, 8192);
            }
            const fileName = this.parseArchiveFileName(line, format);
            if (fileName) {
              fileCount++;
              lastSeenFileName = fileName;
            }
          }
          if (lastSeenFileName) sendProgress();
          return nextRemainder;
        };

        const heartbeatInterval = setInterval(() => sendProgress(true), 10000);
      const operation: ActiveArchiveOperation = {
        sessionId,
        requestId,
        workspacePath,
        commandSession,
        heartbeatInterval,
        cancelled: false,
      };
      this.activeArchives.set(archiveKey, operation);

      commandSession.on('stdout', (data: Buffer) => {
        stdoutRemainder = consumeOutput(data.toString(), stdoutRemainder);
      });
      commandSession.on('stderr', (data: Buffer) => {
        const chunk = data.toString();
        stderrData = this.appendBoundedOutput(stderrData, chunk);
        stderrRemainder = consumeOutput(chunk, stderrRemainder);
      });
      commandSession.on('close', ({ exitCode }) => {
          if (streamFinished) return;
          streamFinished = true;
          clearInterval(heartbeatInterval);
          const active = this.activeArchives.get(archiveKey);
          if (active === operation) this.activeArchives.delete(archiveKey);
          if (operation.cancelled || !active) return;

          if (stdoutRemainder) stdoutRemainder = consumeOutput(`${stdoutRemainder}\n`, '');
          if (stderrRemainder) stderrRemainder = consumeOutput(`${stderrRemainder}\n`, '');
          if (fileCount > 0) sendProgress(true);
          if (exitCode === 0) {
            const warningDetails =
              archiveWarningData.trim() ||
              (archiveWarningCode !== undefined
                ? `ZIP 完成时返回警告代码 ${archiveWarningCode}，部分在压缩期间变化或消失的文件可能未包含在归档中。`
                : undefined);
            const successPayload: SftpCompressSuccessPayload = {
              message: warningDetails ? '压缩完成，但存在警告' : '压缩成功',
              requestId,
              ...(warningDetails ? { warning: warningDetails } : {}),
            };
            if (state.ws.readyState === WebSocket.OPEN) {
              state.ws.send(JSON.stringify({ type: 'sftp:compress:success', requestId, payload: successPayload }));
            }
          } else {
            void this.removeRemoteArchiveWorkspace(sessionId, workspacePath);
            const details = stderrData.trim() || `压缩命令退出，代码: ${exitCode ?? 'N/A'}`;
            this.sendCompressError(state.ws, '压缩失败', requestId, details);
          }
      });
      commandSession.on('error', (streamError: Error) => {
        if (streamFinished) return;
        streamFinished = true;
        clearInterval(heartbeatInterval);
        if (this.activeArchives.get(archiveKey) === operation) this.activeArchives.delete(archiveKey);
        if (operation.cancelled) return;
        void this.removeRemoteArchiveWorkspace(sessionId, workspacePath);
        this.sendCompressError(state.ws, '压缩命令流错误', requestId, streamError.message);
      });
    } catch (execError: any) {
      this.pendingArchives.delete(archiveKey);
      void this.removeRemoteArchiveWorkspace(sessionId, workspacePath);
      if (!pendingArchive.cancelled)
        this.sendCompressError(state.ws, `执行压缩时发生意外错误: ${execError.message}`, requestId);
    }
  }

  async cancelArchive(sessionId: string, requestId: string, notifyClient = true): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const archiveKey = `${sessionId}:${requestId}`;
    const operation = this.activeArchives.get(archiveKey);
    const pending = this.pendingArchives.get(archiveKey);

    let cleaned = true;
    if (operation) {
      operation.cancelled = true;
      this.activeArchives.delete(archiveKey);
      clearInterval(operation.heartbeatInterval);
      await this.stopArchiveCommandSession(operation.commandSession);
      if (operation.workspacePath) {
        cleaned = await this.removeRemoteArchiveWorkspace(sessionId, operation.workspacePath);
      }
    } else if (pending) {
      // Cancellation remains attached to the actual request until preflight exits.
      // Do not use a time-based marker: a stalled SSH exec may resume much later.
      pending.cancelled = true;
      await pending.preflightSession?.terminate();
    }

    if (notifyClient && state?.ws.readyState === WebSocket.OPEN) {
      state.ws.send(
        JSON.stringify({
          type: 'sftp:archive:cancelled',
          requestId,
          payload: { requestId, cleaned },
        }),
      );
    }
  }

  /** Ask the remote wrapper shell to stop its compressor, then wait for its EXIT trap. */
  private async stopArchiveCommandSession(commandSession: CommandSession): Promise<void> {
    await commandSession.terminate({ signal: 'TERM', graceMs: 1500, forceMs: 4000 });
  }

  /**
   * 解压远程服务器上的压缩文件
   * @param sessionId 会话 ID
   * @param payload 解压请求的 payload
   */
  async decompress(sessionId: string, payload: SftpDecompressRequestPayload): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const { archivePath, password, requestId } = payload;
    const archiveKey = `${sessionId}:${requestId}`;

    if (!state || !state.executionSession.isReady) {
      console.warn(`[SFTP Decompress] SSH 客户端未准备好，无法在 ${sessionId} 上执行 decompress (ID: ${requestId})`);
      this.sendDecompressError(state?.ws, 'SSH 会话未就绪', requestId);
      return;
    }

    const lowerArchivePath = archivePath.toLowerCase(); // 在此声明一次

    const passwordError = validateArchivePassword(password);
    if (passwordError) {
      this.sendDecompressError(state.ws, passwordError.message, requestId, undefined, passwordError.code);
      return;
    }
    if (password !== undefined && !lowerArchivePath.endsWith('.zip')) {
      this.sendDecompressError(state.ws, '只有 ZIP 格式支持密码解压', requestId);
      return;
    }

    // 命令检查
    let requiredCommand = '';
    // 使用已经声明的 lowerArchivePath
    if (lowerArchivePath.endsWith('.zip')) {
      requiredCommand = 'unzip';
    } else if (
      lowerArchivePath.endsWith('.tar.gz') ||
      lowerArchivePath.endsWith('.tgz') ||
      lowerArchivePath.endsWith('.tar.bz2') ||
      lowerArchivePath.endsWith('.tbz2')
    ) {
      requiredCommand = 'tar';
    } else {
      this.sendDecompressError(state.ws, `不支持的压缩文件格式: ${archivePath}`, requestId);
      return;
    }

    const pendingArchive: PendingArchiveOperation = { sessionId, requestId, cancelled: false };
    this.pendingArchives.set(archiveKey, pendingArchive);
    try {
      const commandExists = await this.checkCommandExists(state, sessionId, requiredCommand, pendingArchive);
      if (!commandExists) {
        this.pendingArchives.delete(archiveKey);
        if (!pendingArchive.cancelled) {
          this.sendDecompressError(
            state.ws,
            `命令 '${requiredCommand}' 在服务器上未找到`,
            requestId,
            `Command '${requiredCommand}' not found on server.`,
          );
        }
        return;
      }
    } catch (checkError: any) {
      this.pendingArchives.delete(archiveKey);
      if (!pendingArchive.cancelled) {
        this.sendDecompressError(state.ws, `检查命令 '${requiredCommand}' 时出错`, requestId, checkError.message);
      }
      return;
    }
    if (pendingArchive.cancelled) {
      this.pendingArchives.delete(archiveKey);
      return;
    }

    console.debug(`[SFTP Decompress ${sessionId}] Received request for ${archivePath} (ID: ${requestId})`);

    const extractDir = pathModule.posix.dirname(archivePath);
    const archiveBasename = pathModule.posix.basename(archivePath);
    const safeArchiveArgument = archiveBasename.startsWith('-') ? `./${archiveBasename}` : archiveBasename;

    // --- 构建 Shell 命令 ---
    let command: string;
    // 确保路径被正确引用
    const quotedExtractDir = quotePosixShellArg(extractDir);
    const quotedArchiveBasename = quotePosixShellArg(safeArchiveArgument);
    const quotedPassword = password !== undefined ? quotePosixShellArg(password) : null;

    const cdCommand = `cd ${quotedExtractDir}`;

    // 使用在方法开始处声明的 lowerArchivePath
    if (lowerArchivePath.endsWith('.zip')) {
      // Detect encryption before extraction so a mixed archive is never partially
      // unpacked while we are only discovering that a password is required.
      const passwordPreflight = quotedPassword
        ? [
            `password_test_output=$(LC_ALL=C unzip -tq -P ${quotedPassword} ${quotedArchiveBasename} 2>&1)`,
            'password_test_status=$?',
            `if [ "$password_test_status" -eq 82 ] || printf '%s' "$password_test_output" | grep -Eqi 'incorrect password|bad password'; then printf '${ARCHIVE_INVALID_PASSWORD_MARKER}\n' >&2; exit 82; fi`,
            'if [ "$password_test_status" -ne 0 ]; then printf "%s\n" "$password_test_output" >&2; exit "$password_test_status"; fi',
          ].join('; ')
        : `if LC_ALL=C unzip -Z -v ${quotedArchiveBasename} 2>/dev/null | grep -Eqi 'file security status:[[:space:]]*encrypted'; then printf '${ARCHIVE_PASSWORD_REQUIRED_MARKER}\n' >&2; exit 82; fi`;
      const passwordOption = quotedPassword ? `-P ${quotedPassword} ` : '';
      const countCommand = `total=$(unzip -Z1 ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
      // Info-ZIP turns Unicode Path extra fields into #Uxxxx names under the
      // C/POSIX locale. Extract under an available UTF-8 locale instead.
      const utf8LocaleCommand = [
        '{',
        `nexus_utf8_locale=$(locale -a 2>/dev/null | grep -Eim1 '^(C\\.UTF-8|C\\.utf8|en_US\\.UTF-8|en_US\\.utf8)$' || true);`,
        `if [ -z "$nexus_utf8_locale" ]; then nexus_utf8_locale=$(locale -a 2>/dev/null | grep -Eim1 'utf-?8' || true); fi;`,
        `if [ -z "$nexus_utf8_locale" ]; then nexus_utf8_locale=C.UTF-8; fi;`,
        '}',
      ].join(' ');
      command = `${cdCommand} && ${passwordPreflight} && ${countCommand} && ${utf8LocaleCommand} && LC_ALL="$nexus_utf8_locale" unzip -o ${passwordOption}${quotedArchiveBasename}`;
    } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
      const countCommand = `total=$(tar -tzf ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
      command = `${cdCommand} && ${countCommand} && tar -xzvf ${quotedArchiveBasename}`;
    } else if (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
      const countCommand = `total=$(tar -tjf ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
      command = `${cdCommand} && ${countCommand} && tar -xjvf ${quotedArchiveBasename}`;
    } else {
      this.sendDecompressError(state.ws, `不支持的压缩文件格式: ${archivePath}`, requestId);
      return;
    }

    if (password === undefined) {
      console.log(`[SFTP Decompress ${sessionId}] Executing command: ${command} (ID: ${requestId})`);
    } else {
      console.log(`[SFTP Decompress ${sessionId}] Executing password-protected ZIP extraction (ID: ${requestId})`);
    }

    if (pendingArchive.cancelled) {
      this.pendingArchives.delete(archiveKey);
      return;
    }

    // --- 执行命令 ---
    try {
      const commandSession = await state.executionSession.commands.start({ command, id: `archive:${requestId}` });
      this.pendingArchives.delete(archiveKey);
      if (pendingArchive.cancelled) {
        void this.stopArchiveCommandSession(commandSession);
        return;
      }

      let stderrData = '';
        let stdoutRemainder = '';
        let stderrRemainder = '';
        let code: number | null = null;
        let fileCount = 0;
        let totalFiles: number | undefined;
        let lastProgressTime = 0;
        let lastSeenFileName: string | undefined;
        let streamFinished = false;
        const progressFormat: 'decompress' | 'targz' | 'tarbz2' = lowerArchivePath.endsWith('.zip')
          ? 'decompress'
          : lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')
            ? 'tarbz2'
            : 'targz';

        const sendProgress = (force = false) => {
          const now = Date.now();
          if (!force && now - lastProgressTime < 1000) return;
          lastProgressTime = now;
          this.sendArchiveProgress(state.ws, 'decompress', requestId, fileCount, lastSeenFileName, totalFiles);
        };

        const consumeOutput = (chunk: string, remainder: string): string => {
          const lines = `${remainder}${chunk}`.split(/\r?\n/);
          const nextRemainder = lines.pop() || '';
          for (const line of lines) {
            const parsedTotal = this.parseArchiveTotal(line);
            if (parsedTotal !== null) {
              totalFiles = parsedTotal > 0 ? parsedTotal : undefined;
              sendProgress(true);
              continue;
            }
            const fileName = this.parseArchiveFileName(line, progressFormat);
            if (fileName) {
              fileCount++;
              lastSeenFileName = fileName;
            }
          }
          if (lastSeenFileName) sendProgress();
          return nextRemainder;
        };

      const heartbeatInterval = setInterval(() => sendProgress(true), 10000);
      const operation: ActiveArchiveOperation = {
        sessionId,
        requestId,
        commandSession,
        heartbeatInterval,
        cancelled: false,
      };
      this.activeArchives.set(archiveKey, operation);

      commandSession.on('stdout', (data: Buffer) => {
        // 必须持续消费 stdout，否则大型归档会耗尽 SSH 通道窗口并永久挂起。
        stdoutRemainder = consumeOutput(data.toString(), stdoutRemainder);
      });
      commandSession.on('stderr', (data: Buffer) => {
        const chunk = data.toString();
        stderrData = this.appendBoundedOutput(stderrData, chunk);
        stderrRemainder = consumeOutput(chunk, stderrRemainder);
      });

      commandSession.on('close', ({ exitCode }) => {
          if (streamFinished) return;
          streamFinished = true;
          clearInterval(heartbeatInterval);
          const active = this.activeArchives.get(archiveKey);
          if (active === operation) this.activeArchives.delete(archiveKey);
          if (operation.cancelled || !active) return;
          if (stdoutRemainder) stdoutRemainder = consumeOutput(`${stdoutRemainder}\n`, '');
          if (stderrRemainder) stderrRemainder = consumeOutput(`${stderrRemainder}\n`, '');
          code = exitCode;
          if (fileCount > 0) sendProgress(true);

          const trimmedStderr = stderrData.trim();
          const passwordRequired =
            lowerArchivePath.endsWith('.zip') &&
            password === undefined &&
            (trimmedStderr.includes(ARCHIVE_PASSWORD_REQUIRED_MARKER) ||
              code === 82 ||
              /unable to get password|password required/i.test(trimmedStderr));
          const invalidPassword =
            lowerArchivePath.endsWith('.zip') &&
            password !== undefined &&
            (trimmedStderr.includes(ARCHIVE_INVALID_PASSWORD_MARKER) ||
              code === 82 ||
              /incorrect password|bad password/i.test(trimmedStderr));

          if (passwordRequired) {
            console.log(`[SFTP Decompress ${sessionId}] ZIP requires a password (ID: ${requestId}).`);
            this.sendDecompressError(state.ws, '该 ZIP 文件需要密码', requestId, undefined, 'PASSWORD_REQUIRED');
            return;
          }
          if (invalidPassword) {
            console.warn(`[SFTP Decompress ${sessionId}] ZIP password was rejected (ID: ${requestId}).`);
            this.sendDecompressError(state.ws, 'ZIP 密码不正确', requestId, undefined, 'INVALID_PASSWORD');
            return;
          }

          console.log(
            `[SFTP Decompress ${sessionId}] Command finished with code ${code} (ID: ${requestId}). Stderr: ${trimmedStderr}`,
          );
          if (code === 0 && !this.isErrorInStdErr(stderrData)) {
            // 检查退出码和 stderr
            console.log(`[SFTP Decompress ${sessionId}] Decompression successful (ID: ${requestId}).`);
            const successPayload: SftpDecompressSuccessPayload = {
              message: '解压成功',
              requestId: requestId,
            };
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
              state.ws.send(
                JSON.stringify({ type: 'sftp:decompress:success', requestId: requestId, payload: successPayload }),
              ); // Ensure requestId is included
            }
          } else {
            const errorDetails = stderrData.trim() || `解压命令退出，代码: ${code ?? 'N/A'}`;
            console.error(`[SFTP Decompress ${sessionId}] Decompression failed (ID: ${requestId}): ${errorDetails}`);
            this.sendDecompressError(state.ws, '解压失败', requestId, errorDetails);
          }
      });
      commandSession.on('error', (streamErr: Error) => {
        if (streamFinished) return;
        streamFinished = true;
        clearInterval(heartbeatInterval);
        if (this.activeArchives.get(archiveKey) === operation) this.activeArchives.delete(archiveKey);
        if (operation.cancelled) return;
        console.error(`[SFTP Decompress ${sessionId}] Command stream error (ID: ${requestId}):`, streamErr);
        this.sendDecompressError(state.ws, '解压命令流错误', requestId, streamErr.message);
      });
    } catch (execError: any) {
      this.pendingArchives.delete(archiveKey);
      console.error(
        `[SFTP Decompress ${sessionId}] Decompress command caught unexpected error during exec setup (ID: ${requestId}):`,
        execError,
      );
      if (!pendingArchive.cancelled)
        this.sendDecompressError(state.ws, `执行解压时发生意外错误: ${execError.message}`, requestId);
    }
  }

  // --- 辅助方法 ---

  /** 检查远程服务器上是否存在指定的命令。每次 exec 都有独立 settle guard 和超时。 */
  private async checkCommandExists(
    state: ClientState,
    sessionId: string,
    commandName: string,
    pendingArchive?: PendingArchiveOperation,
  ): Promise<boolean> {
    if (!state.executionSession.isReady) throw new Error('SSH client is not available.');

    const checkCommands = [`command -v ${commandName}`, `which ${commandName}`];
    for (let index = 0; index < checkCommands.length; index += 1) {
      if (pendingArchive?.cancelled) throw new Error('ARCHIVE_CANCELLED');

      const checkCmd = checkCommands[index];
      console.log(`[SFTP Command Check ${sessionId}] Executing: ${checkCmd}`);

      let commandSession: CommandSession;
      try {
        commandSession = await state.executionSession.commands.start({
          command: checkCmd,
          id: `archive-preflight:${pendingArchive?.requestId ?? commandName}:${index}`,
        });
      } catch (error) {
        console.error(`[SFTP Command Check ${sessionId}] Failed to start exec for "${checkCmd}":`, error);
        continue;
      }

      if (pendingArchive) pendingArchive.preflightSession = commandSession;
      if (pendingArchive?.cancelled) {
        await commandSession.terminate();
        if (pendingArchive.preflightSession === commandSession) pendingArchive.preflightSession = undefined;
        throw new Error('ARCHIVE_CANCELLED');
      }

      let output = '';
      const result = await new Promise<{ exitCode?: number | null; error?: Error; timedOut?: boolean }>((resolve) => {
        let settled = false;
        const finish = (value: { exitCode?: number | null; error?: Error; timedOut?: boolean }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        };
        const timeout = setTimeout(() => {
          if (settled) return;
          void commandSession.terminate().finally(() => finish({ timedOut: true }));
        }, 10_000);
        timeout.unref?.();

        commandSession.on('stdout', (data: Buffer) => {
          output += data.toString();
        });
        commandSession.on('stderr', () => {
          /* consumed by CommandSession to avoid channel backpressure */
        });
        commandSession.once('close', ({ exitCode }) => finish({ exitCode }));
        commandSession.once('error', (error: Error) => finish({ error }));
      });

      if (pendingArchive?.preflightSession === commandSession) pendingArchive.preflightSession = undefined;
      if (pendingArchive?.cancelled) throw new Error('ARCHIVE_CANCELLED');
      if (result.timedOut) throw new Error(`Command check timed out for '${commandName}'`);
      if (result.error) {
        console.error(`[SFTP Command Check ${sessionId}] Stream error for "${checkCmd}":`, result.error);
        continue;
      }
      if (result.exitCode === 0 && output.trim() !== '') {
        console.log(
          `[SFTP Command Check ${sessionId}] Command '${commandName}' found using "${checkCmd}". Output: ${output.trim()}`,
        );
        return true;
      }

      console.log(
        `[SFTP Command Check ${sessionId}] Command '${commandName}' not found with "${checkCmd}" (code: ${result.exitCode}, output: "${output.trim()}").`,
      );
    }

    return false;
  }

  /** 发送压缩错误消息 */
  private sendCompressError(
    ws: AuthenticatedWebSocket | undefined,
    error: string,
    requestId: string,
    details?: string,
    code?: SftpCompressErrorPayload['code'],
  ): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload: SftpCompressErrorPayload = { error, requestId };
      if (details) payload.details = details;
      if (code) payload.code = code;
      // 检查是否是命令未找到的特定错误
      if (error.includes('在服务器上未找到')) {
        ws.send(
          JSON.stringify({
            type: 'sftp:command_not_found',
            payload: {
              operation: 'compress',
              command: error.match(/'([^']+)'/)?.[1] || 'unknown',
              message: details || error,
            },
            requestId,
          }),
        );
      } else {
        ws.send(JSON.stringify({ type: 'sftp:compress:error', requestId, payload }));
      }
    } else {
      console.warn(`[SFTP Compress] WebSocket closed or invalid, cannot send error for request ${requestId}.`);
    }
  }

  /** 发送解压错误消息 */
  private sendDecompressError(
    ws: AuthenticatedWebSocket | undefined,
    error: string,
    requestId: string,
    details?: string,
    code?: SftpDecompressErrorPayload['code'],
  ): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload: SftpDecompressErrorPayload = { error, requestId };
      if (details) payload.details = details;
      if (code) payload.code = code;
      // 检查是否是命令未找到的特定错误
      if (error.includes('在服务器上未找到')) {
        ws.send(
          JSON.stringify({
            type: 'sftp:command_not_found',
            payload: {
              operation: 'decompress',
              command: error.match(/'([^']+)'/)?.[1] || 'unknown',
              message: details || error,
            },
            requestId,
          }),
        );
      } else {
        ws.send(JSON.stringify({ type: 'sftp:decompress:error', requestId, payload }));
      }
    } else {
      console.warn(`[SFTP Decompress] WebSocket closed or invalid, cannot send error for request ${requestId}.`);
    }
  }

  /** 只保留最近的命令错误输出，避免大型归档把整个进程输出留在内存中。 */
  private appendBoundedOutput(existing: string, chunk: string, maxLength = 65536): string {
    const combined = existing + chunk;
    return combined.length > maxLength ? combined.slice(-maxLength) : combined;
  }

  /** Parse the private line emitted before an archive command starts. */
  private parseArchiveTotal(line: string): number | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith(ARCHIVE_TOTAL_MARKER)) return null;
    const total = Number.parseInt(trimmed.slice(ARCHIVE_TOTAL_MARKER.length), 10);
    return Number.isFinite(total) && total >= 0 ? total : 0;
  }

  /** Parse a warning exit code emitted after a valid ZIP archive was preserved. */
  private parseArchiveWarningCode(line: string): number | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith(ARCHIVE_WARNING_MARKER)) return null;
    const code = Number.parseInt(trimmed.slice(ARCHIVE_WARNING_MARKER.length), 10);
    return Number.isFinite(code) && code > 0 ? code : 0;
  }

  /** 从 zip、tar 和 unzip 的详细输出中提取正在处理的文件名。 */
  private parseArchiveFileName(line: string, format: 'zip' | 'targz' | 'tarbz2' | 'decompress'): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (format === 'zip') {
      const match = trimmed.match(/^adding:\s+(.+?)(?:\s+\(.*\))?$/i);
      return match?.[1]?.trim() || null;
    }

    if (format === 'decompress') {
      const match = trimmed.match(/^(?:inflating|extracting|creating):\s+(.+)/i);
      return match?.[1]?.trim() || null;
    }

    if (
      !trimmed.startsWith('/') &&
      !/^tar(?:\s|:|\()/i.test(trimmed) &&
      trimmed.length < 1024 &&
      !/^[A-Za-z]+:\s/.test(trimmed)
    ) {
      return trimmed;
    }
    return null;
  }

  /** 发送归档进度或心跳；前端据此重置空闲超时。 */
  private sendArchiveProgress(
    ws: AuthenticatedWebSocket | undefined,
    operation: 'compress' | 'decompress',
    requestId: string,
    fileCount: number,
    currentFile?: string,
    totalFiles?: number,
  ): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const percent =
        totalFiles && totalFiles > 0 ? Math.min(100, Math.round((fileCount / totalFiles) * 100)) : undefined;
      ws.send(
        JSON.stringify({
          type: `sftp:${operation}:progress`,
          requestId,
          payload: { requestId, fileCount, totalFiles, percent, currentFile },
        }),
      );
    }
  }

  /** 检查 stderr 输出是否包含表示错误的常见模式 */
  private isErrorInStdErr(stderr: string): boolean {
    if (!stderr || stderr.trim().length === 0) {
      return false; // 空 stderr 不是错误
    }
    const lowerStderr = stderr.toLowerCase();
    // 常见的错误关键词或模式
    const errorPatterns = [
      'error',
      'fail',
      'cannot',
      'not found',
      'no such file',
      'permission denied',
      'invalid',
      '不支持',
    ];
    // tar/zip 进度信息通常包含百分比或文件名，不应视为错误
    if (
      /[\d.]+%/.test(stderr) ||
      /adding:/.test(lowerStderr) ||
      /inflating:/.test(lowerStderr) ||
      /extracting:/.test(lowerStderr)
    ) {
      // 忽略一些明确的非错误输出
      if (errorPatterns.some((pattern) => lowerStderr.includes(pattern))) {
        // 如果进度信息中包含错误关键词，则可能真的是错误
        return true;
      }
      return false;
    }

    return errorPatterns.some((pattern) => lowerStderr.includes(pattern));
  }

  // --- File Upload Methods ---

  private normalizeUploadBasePath(basePath: string): string {
    const normalized = pathModule.posix.normalize(basePath.replace(/\\/g, '/'));
    if (!pathModule.posix.isAbsolute(normalized)) {
      throw new Error(`上传目标基础路径必须是绝对路径: ${basePath}`);
    }
    return normalized;
  }

  private normalizeUploadRelativeDirectory(relativePath: string): string {
    const slashNormalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const normalized = pathModule.posix.normalize(slashNormalized).replace(/\/$/, '');
    if (!normalized || normalized === '.') return '';
    if (pathModule.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`上传目录包含非法路径: ${relativePath}`);
    }
    return normalized;
  }

  private resolvePreparedUploadDirectory(basePath: string, relativePath: string): string {
    const fullPath = pathModule.posix.normalize(pathModule.posix.join(basePath, relativePath));
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
    const uploadSftp = await this.ensureTransferSftpSession(sessionId);
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
    await this.ensureDirectoryExists(uploadSftp, normalizedBasePath);

    const branchDirectories = new Map<string, string[]>();
    for (const directory of fullDirectories) {
      if (directory === normalizedBasePath) continue;
      const relativeDirectory = pathModule.posix.relative(normalizedBasePath, directory);
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
            await this.ensureDirectoryExists(uploadSftp, directory);
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
      uploadSftp = await this.ensureTransferSftpSession(sessionId);
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

    const normalizedRemotePath = pathModule.posix.normalize(remotePath.replace(/\\/g, '/'));
    const targetDirectory = pathModule.posix.dirname(normalizedRemotePath);
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
              filename: pathModule.posix.basename(normalizedRemotePath),
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

    const temporaryPath = pathModule.posix.join(targetDirectory, `.nexus-upload-${uploadId}.part`);
    this.pendingUploads.set(uploadId, { sessionId, remotePath: normalizedRemotePath, temporaryPath, sftp: uploadSftp });

    const stopIfCancelled = async (): Promise<boolean> => {
      if (!this.cancelledUploadIds.has(uploadId)) return false;
      await this.removeRemoteUploadFile(sessionId, temporaryPath, uploadSftp);
      return true;
    };

    try {
      // Prepared batches create their complete directory tree before uploads start.
      // Keep the legacy fallback for older clients that do not send a prepareId.
      if (!directoryWasPrepared) await this.ensureDirectoryExists(uploadSftp, targetDirectory);
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
              filename: pathModule.posix.basename(finalState.remotePath),
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

    const partStats = await this.getStats(uploadSftp, uploadState.temporaryPath);
    if (partStats.size !== uploadState.totalSize) {
      throw new Error(`临时文件大小 (${partStats.size}) 与预期 (${uploadState.totalSize}) 不一致`);
    }

    await this.replaceRemoteUploadFile(uploadSftp, uploadState.temporaryPath, uploadState.remotePath);
    return this.getStats(uploadSftp, uploadState.remotePath);
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
        await this.performRename(sftp, temporaryPath, remotePath);
        return;
      }

      const backupPath = `${temporaryPath}.previous`;
      await this.unlinkSftpPath(sftp, backupPath, true);
      await this.performRename(sftp, remotePath, backupPath);
      try {
        await this.performRename(sftp, temporaryPath, remotePath);
        await this.unlinkSftpPath(sftp, backupPath, true);
      } catch (fallbackError) {
        try {
          await this.performRename(sftp, backupPath, remotePath);
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
      await this.getStats(sftp, remotePath);
      return true;
    } catch (error) {
      if (this.isNoSuchFileError(error)) return false;
      throw error;
    }
  }

  private unlinkSftpPath(sftp: SFTPWrapper, remotePath: string, ignoreMissing = false): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (!err || (ignoreMissing && this.isNoSuchFileError(err))) {
          resolve();
        } else {
          reject(err);
        }
      });
    });
  }

  private lstatSftpPath(sftp: SFTPWrapper, remotePath: string): Promise<Stats | null> {
    return new Promise((resolve, reject) => {
      sftp.lstat(remotePath, (error, stats) => {
        if (!error) {
          resolve(stats);
        } else if (this.isNoSuchFileError(error)) {
          resolve(null);
        } else {
          reject(error);
        }
      });
    });
  }

  private readSftpDirectoryEntries(
    sftp: SFTPWrapper,
    remotePath: string,
  ): Promise<Array<{ filename: string; attrs: Stats }>> {
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (error, entries) => {
        if (error) reject(error);
        else resolve(entries);
      });
    });
  }

  private rmdirSftpPath(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.rmdir(remotePath, (error) => {
        if (!error || this.isNoSuchFileError(error)) resolve();
        else reject(error);
      });
    });
  }

  private async removeSftpPathRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    const stats = await this.lstatSftpPath(sftp, remotePath);
    if (!stats) return;

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      await this.unlinkSftpPath(sftp, remotePath, true);
      return;
    }

    const entries = await this.readSftpDirectoryEntries(sftp, remotePath);
    for (const entry of entries) {
      await this.removeSftpPathRecursive(sftp, pathModule.posix.join(remotePath, entry.filename));
    }
    await this.rmdirSftpPath(sftp, remotePath);
  }

  private async removeRemoteArchiveWorkspace(sessionId: string, workspacePath: string): Promise<boolean> {
    const workspaceName = pathModule.posix.basename(workspacePath);
    if (!/^\.nexus-archive-[A-Za-z0-9_-]+\.work$/.test(workspaceName)) {
      console.error(`[SFTP Archive] Refusing to recursively remove unexpected path: ${workspacePath}`);
      return false;
    }

    for (let attempt = 1; attempt <= 5; attempt++) {
      const state = this.clientStates.get(sessionId);
      if (!state?.executionSession.sftp.control) return false;
      try {
        await this.removeSftpPathRecursive(state.executionSession.sftp.control, workspacePath);
        return true;
      } catch (error) {
        if (attempt === 5) {
          console.warn(`[SFTP Archive] Unable to remove workspace ${workspacePath}:`, error);
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
    return false;
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

  private isNoSuchFileError(error: unknown): boolean {
    const candidate = error as { code?: string | number; message?: string } | null;
    return (
      candidate?.code === 'ENOENT' || candidate?.code === 2 || /no such file|not found/i.test(candidate?.message || '')
    );
  }
}
