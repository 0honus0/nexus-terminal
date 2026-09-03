import * as pathModule from 'path';
import { WebSocket } from 'ws';
import type { SFTPWrapper, Stats, OpenMode } from 'ssh2';
import type { WorkspaceSession } from '../workspace/workspace-session';
import type { WorkspaceSessionRegistry } from '../workspace/workspace-session-registry';
import { SftpChannelFileSystem } from '../filesystem/sftp-channel-file-system';

const SFTP_TRANSFER_CHUNK_SIZE = 32 * 1024;
const SFTP_TRANSFER_CONCURRENCY = 64;
const SFTP_TRANSFER_PROGRESS_INTERVAL_MS = 200;

interface SftpTransferTracker {
  sessionId: string;
  state: WorkspaceSession;
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

/** Workspace transfer orchestration. The SFTP primitives it uses are shared with Agent filesystem code. */
export class SftpTransferService {
  private readonly cancelledTransferIds = new Set<string>();
  private readonly activeTransferKeys = new Set<string>();

  constructor(private readonly workspaceSessionRegistry: WorkspaceSessionRegistry) {}

  private filesystem(sftp: SFTPWrapper): SftpChannelFileSystem {
    return new SftpChannelFileSystem(sftp);
  }

  cleanupSession(sessionId: string): void {
    for (const key of [...this.cancelledTransferIds]) {
      if (key.startsWith(`${sessionId}:`)) this.cancelledTransferIds.delete(key);
    }
    for (const key of [...this.activeTransferKeys]) {
      if (key.startsWith(`${sessionId}:`)) this.activeTransferKeys.delete(key);
    }
  }

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
  private sendTransferCancelled(state: WorkspaceSession | undefined, requestId: string): void {
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
    const state = this.workspaceSessionRegistry.get(sessionId);
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
    state: WorkspaceSession,
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
  async copy(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
    const state = this.workspaceSessionRegistry.get(sessionId);
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
          const stats = await this.filesystem(sftp).stat(sourcePath);
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
          const copiedStats = await this.filesystem(sftp).lstat(destPath);
          copiedItemsDetails.push(SftpChannelFileSystem.toFileEntry(destPath, copiedStats));
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
    const destinationState = this.workspaceSessionRegistry.get(destinationSessionId);
    const sourceState = this.workspaceSessionRegistry.get(sourceSessionId);
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
        const stats = await this.filesystem(sourceSftp).stat(sourcePath);
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

        const copiedStats = await this.filesystem(destinationSftp).lstat(destPath);
        copiedItemsDetails.push(SftpChannelFileSystem.toFileEntry(destPath, copiedStats));
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
  async move(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
    const state = this.workspaceSessionRegistry.get(sessionId);
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
        await this.filesystem(sftp).ensureDirectory(destinationDir);
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
            await this.filesystem(sftp).lstat(newPath);
            targetExists = true;
          } catch (statErr: any) {
            if (!SftpChannelFileSystem.isMissing(statErr)) {
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
          await this.filesystem(sftp).rename(oldPath, newPath); // Use helper for rename logic
          this.completeTransferFile(tracker);

          // Get stats of the *moved* item at the new location
          const movedStats = await this.filesystem(sftp).lstat(newPath);
          movedItemsDetails.push(SftpChannelFileSystem.toFileEntry(newPath, movedStats));
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
    const realPath = await this.filesystem(sourceSftp).realpath(sourcePath);
    if (ancestorRealPaths.has(realPath)) {
      console.warn(`[SFTP Cross Copy] Skipping circular symbolic link: ${sourcePath} -> ${realPath}`);
      return;
    }
    const nextAncestors = new Set(ancestorRealPaths);
    nextAncestors.add(realPath);

    await this.filesystem(destinationSftp).ensureDirectory(destPath);
    const items = await this.filesystem(sourceSftp).list(sourcePath);

    for (const item of items) {
      this.assertTransferNotCancelled(tracker);
      const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
      const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
      const itemStats = item.attrs.isSymbolicLink()
        ? await this.filesystem(sourceSftp).stat(currentSourcePath)
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
  private async copyDirectoryRecursive(
    sftp: SFTPWrapper,
    sourcePath: string,
    destPath: string,
    ancestorRealPaths: ReadonlySet<string> = new Set(),
    tracker?: SftpTransferTracker,
  ): Promise<void> {
    try {
      this.assertTransferNotCancelled(tracker);
      const realPath = await this.filesystem(sftp).realpath(sourcePath);
      if (ancestorRealPaths.has(realPath)) {
        console.warn(`[SFTP Copy Recurse] Skipping circular symbolic link: ${sourcePath} -> ${realPath}`);
        return;
      }
      const nextAncestors = new Set(ancestorRealPaths);
      nextAncestors.add(realPath);

      // Create destination directory
      await this.filesystem(sftp).ensureDirectory(destPath);

      // Read source directory contents
      const items = await this.filesystem(sftp).list(sourcePath);

      for (const item of items) {
        this.assertTransferNotCancelled(tracker);
        const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
        const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
        const itemStats = item.attrs.isSymbolicLink() ? await this.filesystem(sftp).stat(currentSourcePath) : item.attrs;

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
}
