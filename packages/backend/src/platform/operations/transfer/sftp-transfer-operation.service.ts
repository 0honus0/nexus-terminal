import * as pathModule from 'path';
import type { SFTPWrapper, Stats, OpenMode } from 'ssh2';
import { SftpChannelFileSystem } from '../../../infrastructure/ssh/sftp/sftp-channel-file-system';
import type { FileEntry } from '../../filesystem/types';
import type {
  SftpCrossCopySource,
  SftpTransferCancelResult,
  SftpTransferContext,
  SftpTransferEventSink,
} from './sftp-transfer.types';

const SFTP_TRANSFER_CHUNK_SIZE = 32 * 1024;
const SFTP_TRANSFER_CONCURRENCY = 64;
const SFTP_TRANSFER_PROGRESS_INTERVAL_MS = 200;

interface SftpTransferTracker {
  ownerKey: string;
  emit: SftpTransferEventSink;
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

/** Transport-neutral SFTP transfer operations reusable by Workspace and Agent callers. */
export class SftpTransferOperationService {
  private readonly cancelledTransferIds = new Set<string>();
  private readonly activeTransfers = new Map<string, SftpTransferContext>();

  private filesystem(sftp: SFTPWrapper): SftpChannelFileSystem {
    return new SftpChannelFileSystem(sftp);
  }

  cleanupOwner(ownerKey: string): void {
    for (const key of [...this.cancelledTransferIds]) {
      if (key.startsWith(`${ownerKey}:`)) this.cancelledTransferIds.delete(key);
    }
    for (const key of [...this.activeTransfers.keys()]) {
      if (key.startsWith(`${ownerKey}:`)) this.activeTransfers.delete(key);
    }
  }

  private transferCancellationKey(ownerKey: string, requestId: string): string {
    return `${ownerKey}:${requestId}`;
  }
  private assertTransferNotCancelled(tracker: SftpTransferTracker | undefined): void {
    if (!tracker) return;
    if (this.cancelledTransferIds.has(this.transferCancellationKey(tracker.ownerKey, tracker.requestId))) {
      throw new Error('SFTP_TRANSFER_CANCELLED');
    }
  }
  private isTransferCancelledError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('SFTP_TRANSFER_CANCELLED');
  }
  async cancel(ownerKey: string, requestId: string): Promise<SftpTransferCancelResult> {
    const key = this.transferCancellationKey(ownerKey, requestId);
    const context = this.activeTransfers.get(key);
    if (!context) return { active: false };
    // Keep cancellation attached to the real transfer lifecycle. A single SFTP read/write
    // may remain blocked for much longer than 30 seconds; a TTL would let the task resume.
    this.cancelledTransferIds.add(key);
    context.emit({ type: 'cancelling', requestId });
    return { active: true };
  }
  private createTransferTracker(
    context: SftpTransferContext,
    sources: string[],
    requestId: string,
  ): SftpTransferTracker {
    // Do not block transfer startup just to calculate progress. Top-level metadata is
    // collected by the copy loop itself, so a single file needs only one source stat.
    const tracker: SftpTransferTracker = {
      ownerKey: context.ownerKey,
      emit: context.emit,
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
    tracker.emit({
      type: 'progress',
      requestId: tracker.requestId,
      transferredBytes: tracker.transferredBytes,
      totalBytes: tracker.totalBytes,
      completedFiles: tracker.completedFiles,
      totalFiles: tracker.totalFiles,
      totalKnown: tracker.totalKnown,
      ...(tracker.currentFile ? { currentFile: tracker.currentFile } : {}),
    });
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
  async copy(
    context: SftpTransferContext,
    sources: string[],
    destinationDir: string,
    requestId: string,
  ): Promise<void> {
    const { ownerKey, session, emit } = context;
    if (!session.isReady) {
      emit({ type: 'copy-error', requestId, message: 'SFTP 会话未就绪' });
      return;
    }

    let sftp: SFTPWrapper;
    try {
      sftp = await session.sftp.ensure('control');
    } catch (error) {
      emit({ type: 'copy-error', requestId, message: `SFTP 会话未就绪: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    console.debug(`[SFTP ${ownerKey}] copy request ${requestId}: ${sources.join(', ')} -> ${destinationDir}`);
    const copiedItemsDetails: FileEntry[] = [];
    let firstError: Error | null = null;
    const transferKey = this.transferCancellationKey(ownerKey, requestId);
    this.activeTransfers.set(transferKey, context);

    try {
      const tracker = this.createTransferTracker(context, sources, requestId);
      this.assertTransferNotCancelled(tracker);

      for (const sourcePath of sources) {
        this.assertTransferNotCancelled(tracker);
        const sourceName = pathModule.basename(sourcePath);
        const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/');
        if (sourcePath === destPath) continue;

        try {
          const stats = await this.filesystem(sftp).stat(sourcePath);
          this.registerTopLevelTransferEntry(tracker, stats);
          if (stats.isDirectory()) {
            await this.copyDirectoryRecursive(sftp, sourcePath, destPath, new Set(), tracker);
          } else if (stats.isFile()) {
            this.beginTransferFile(tracker, sourcePath);
            await this.copyFile(sftp, sourcePath, destPath, stats.size, tracker);
            this.completeTransferFile(tracker);
          } else {
            continue;
          }
          const copiedStats = await this.filesystem(sftp).lstat(destPath);
          copiedItemsDetails.push(SftpChannelFileSystem.toFileEntry(destPath, copiedStats));
        } catch (error) {
          firstError = error instanceof Error ? error : new Error(String(error));
          break;
        }
      }

      if (firstError) throw firstError;
      this.assertTransferNotCancelled(tracker);
      this.finalizeTransferTracker(tracker);
      emit({ type: 'copy-success', requestId, destination: destinationDir, items: copiedItemsDetails });
    } catch (error) {
      const cancelled = this.isTransferCancelledError(error) || this.cancelledTransferIds.has(transferKey);
      if (cancelled) emit({ type: 'cancelled', requestId });
      else emit({ type: 'copy-error', requestId, message: `复制操作失败: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      this.activeTransfers.delete(transferKey);
      this.cancelledTransferIds.delete(transferKey);
    }
  }

  async copyAcrossSessions(
    context: SftpTransferContext,
    source: SftpCrossCopySource,
    sources: string[],
    destinationDir: string,
    requestId: string,
  ): Promise<void> {
    const { ownerKey, session: destinationSession, emit } = context;
    if (!destinationSession.isReady) {
      emit({ type: 'copy-error', requestId, message: '目标 SFTP 会话未就绪' });
      return;
    }
    if (!source.session.isReady) {
      emit({ type: 'copy-error', requestId, message: '源 SFTP 会话未就绪或已断开' });
      return;
    }

    let sourceSftp: SFTPWrapper;
    let destinationSftp: SFTPWrapper;
    try {
      [sourceSftp, destinationSftp] = await Promise.all([
        source.session.sftp.ensure('control'),
        destinationSession.sftp.ensure('control'),
      ]);
    } catch (error) {
      emit({ type: 'copy-error', requestId, message: `跨主机复制失败: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    const copiedItemsDetails: FileEntry[] = [];
    const transferKey = this.transferCancellationKey(ownerKey, requestId);
    this.activeTransfers.set(transferKey, context);

    try {
      const tracker = this.createTransferTracker(context, sources, requestId);
      this.assertTransferNotCancelled(tracker);
      for (const sourcePath of sources) {
        this.assertTransferNotCancelled(tracker);
        if (typeof sourcePath !== 'string' || !sourcePath.startsWith('/')) throw new Error('源路径无效');
        const destPath = pathModule.join(destinationDir, pathModule.basename(sourcePath)).replace(/\\/g, '/');
        const stats = await this.filesystem(sourceSftp).stat(sourcePath);
        this.registerTopLevelTransferEntry(tracker, stats);
        if (stats.isDirectory()) {
          await this.copyDirectoryBetweenSftp(sourceSftp, destinationSftp, sourcePath, destPath, new Set(), tracker);
        } else if (stats.isFile()) {
          this.beginTransferFile(tracker, sourcePath);
          await this.copyFileBetweenSftp(sourceSftp, destinationSftp, sourcePath, destPath, stats.size, tracker);
          this.completeTransferFile(tracker);
        } else {
          continue;
        }
        const copiedStats = await this.filesystem(destinationSftp).lstat(destPath);
        copiedItemsDetails.push(SftpChannelFileSystem.toFileEntry(destPath, copiedStats));
      }
      this.assertTransferNotCancelled(tracker);
      this.finalizeTransferTracker(tracker);
      emit({
        type: 'copy-success',
        requestId,
        destination: destinationDir,
        items: copiedItemsDetails,
        sourceOwnerKey: source.ownerKey,
        crossHost: true,
      });
    } catch (error) {
      const cancelled = this.isTransferCancelledError(error) || this.cancelledTransferIds.has(transferKey);
      if (cancelled) emit({ type: 'cancelled', requestId });
      else emit({ type: 'copy-error', requestId, message: `跨主机复制失败: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      this.activeTransfers.delete(transferKey);
      this.cancelledTransferIds.delete(transferKey);
    }
  }

  async move(
    context: SftpTransferContext,
    sources: string[],
    destinationDir: string,
    requestId: string,
  ): Promise<void> {
    const { ownerKey, session, emit } = context;
    if (!session.isReady) {
      emit({ type: 'move-error', requestId, message: 'SFTP 会话未就绪' });
      return;
    }

    let sftp: SFTPWrapper;
    try {
      sftp = await session.sftp.ensure('control');
    } catch (error) {
      emit({ type: 'move-error', requestId, message: `SFTP 会话未就绪: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    const movedItemsDetails: FileEntry[] = [];
    let firstError: Error | null = null;
    const transferKey = this.transferCancellationKey(ownerKey, requestId);
    this.activeTransfers.set(transferKey, context);
    const tracker: SftpTransferTracker = {
      ownerKey,
      emit,
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
      await this.filesystem(sftp).ensureDirectory(destinationDir);
      this.assertTransferNotCancelled(tracker);
      for (const oldPath of sources) {
        this.assertTransferNotCancelled(tracker);
        const newPath = pathModule.join(destinationDir, pathModule.basename(oldPath)).replace(/\\/g, '/');
        if (oldPath === newPath) continue;
        try {
          let targetExists = false;
          try {
            await this.filesystem(sftp).lstat(newPath);
            targetExists = true;
          } catch (error) {
            if (!SftpChannelFileSystem.isMissing(error)) throw error;
          }
          if (targetExists) throw new Error(`目标路径 ${pathModule.basename(newPath)} 已存在`);
          this.beginTransferFile(tracker, oldPath);
          await this.filesystem(sftp).rename(oldPath, newPath);
          this.completeTransferFile(tracker);
          const movedStats = await this.filesystem(sftp).lstat(newPath);
          movedItemsDetails.push(SftpChannelFileSystem.toFileEntry(newPath, movedStats));
        } catch (error) {
          firstError = error instanceof Error ? error : new Error(String(error));
          break;
        }
      }
      if (firstError) throw firstError;
      this.assertTransferNotCancelled(tracker);
      emit({ type: 'move-success', requestId, sources, destination: destinationDir, items: movedItemsDetails });
    } catch (error) {
      const cancelled = this.isTransferCancelledError(error) || this.cancelledTransferIds.has(transferKey);
      if (cancelled) emit({ type: 'cancelled', requestId });
      else emit({ type: 'move-error', requestId, message: `移动操作失败: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      this.activeTransfers.delete(transferKey);
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
