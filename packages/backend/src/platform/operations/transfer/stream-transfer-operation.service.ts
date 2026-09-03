import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ExecutionSessionManager } from '../../execution/execution-session-manager';
import type { RemoteFileSystem, RemoteFileMetadata } from '../../filesystem/remote-filesystem';
import type { RemoteFileEntry } from '../../filesystem/file-entry';
import { toRemoteFileEntry } from '../../filesystem/file-entry';
import type { TransferEvent, TransferOperation, TransferRequest } from './transfer-operation.port';

interface ActiveTransfer {
  requestId: string;
  ownerId?: string;
  controller: AbortController;
  emit: (event: TransferEvent) => void;
}

interface TransferTracker {
  requestId: string;
  transferredBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  totalKnown: boolean;
  currentFile?: string;
  lastEmittedAt: number;
  emit: (event: TransferEvent) => void;
}

const PROGRESS_INTERVAL_MS = 150;

export class StreamTransferOperationService implements TransferOperation {
  private readonly active = new Map<string, ActiveTransfer>();

  constructor(private readonly sessions: Pick<ExecutionSessionManager, 'require'>) {}

  async run(request: TransferRequest, emit: (event: TransferEvent) => void): Promise<void> {
    if (this.active.has(request.requestId)) throw new Error(`Transfer ${request.requestId} already exists.`);
    const controller = new AbortController();
    const active: ActiveTransfer = { requestId: request.requestId, ownerId: request.ownerId, controller, emit };
    this.active.set(request.requestId, active);

    try {
      const sourceSession = this.sessions.require(request.sourceSessionId);
      const destinationSession = this.sessions.require(request.destinationSessionId);
      const [sourceFs, destinationFs] = await Promise.all([
        sourceSession.fileSystem('control'),
        destinationSession.fileSystem('control'),
      ]);
      await destinationFs.ensureDirectory(request.destinationPath);

      const tracker: TransferTracker = {
        requestId: request.requestId,
        transferredBytes: 0,
        totalBytes: 0,
        completedFiles: 0,
        totalFiles: 0,
        totalKnown: false,
        lastEmittedAt: 0,
        emit,
      };
      this.emitProgress(tracker, true);
      const results: RemoteFileEntry[] = [];
      const sameSession = request.sourceSessionId === request.destinationSessionId;

      for (const sourcePath of request.sourcePaths) {
        this.throwIfAborted(controller.signal);
        const normalizedSource = this.requireAbsolutePath(sourcePath, 'source');
        const targetPath = path.posix.join(this.requireAbsolutePath(request.destinationPath, 'destination'), path.posix.basename(normalizedSource));
        if (normalizedSource === targetPath) continue;

        if (request.mode === 'move' && sameSession) {
          if (await destinationFs.exists(targetPath)) throw new Error(`Destination already exists: ${targetPath}`);
          tracker.currentFile = normalizedSource;
          tracker.totalFiles += 1;
          tracker.totalKnown = true;
          this.emitProgress(tracker, true);
          await sourceFs.rename(normalizedSource, targetPath);
          tracker.completedFiles += 1;
          this.emitProgress(tracker, true);
          results.push(toRemoteFileEntry(targetPath, await destinationFs.metadata(targetPath)));
          continue;
        }

        await this.copyEntry(sourceFs, destinationFs, normalizedSource, targetPath, tracker, controller.signal, new Set());
        const metadata = await destinationFs.metadata(targetPath);
        results.push(toRemoteFileEntry(targetPath, metadata));
        if (request.mode === 'move') await this.removeSource(sourceFs, normalizedSource, new Set(), controller.signal);
      }

      this.throwIfAborted(controller.signal);
      tracker.currentFile = undefined;
      tracker.totalKnown = true;
      this.emitProgress(tracker, true);
      emit({ type: 'completed', requestId: request.requestId, mode: request.mode, items: results, crossSession: !sameSession });
    } catch (error) {
      if (controller.signal.aborted) emit({ type: 'cancelled', requestId: request.requestId });
      else emit({ type: 'failed', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.active.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<boolean> {
    const active = this.active.get(requestId);
    if (!active) return false;
    active.emit({ type: 'cancelling', requestId });
    active.controller.abort();
    return true;
  }

  async cancelOwner(ownerId: string): Promise<void> {
    for (const active of this.active.values()) {
      if (active.ownerId === ownerId) await this.cancel(active.requestId);
    }
  }

  private async copyEntry(
    sourceFs: RemoteFileSystem,
    destinationFs: RemoteFileSystem,
    sourcePath: string,
    destinationPath: string,
    tracker: TransferTracker,
    signal: AbortSignal,
    ancestorRealPaths: ReadonlySet<string>,
  ): Promise<void> {
    this.throwIfAborted(signal);
    const metadata = await sourceFs.metadata(sourcePath);
    if (metadata.isSymbolicLink) {
      const followed = await sourceFs.metadata(sourcePath, { followSymbolicLinks: true });
      if (followed.isDirectory) {
        await this.copyDirectory(sourceFs, destinationFs, sourcePath, destinationPath, tracker, signal, ancestorRealPaths);
      } else if (followed.isFile) {
        await this.copyFile(sourceFs, destinationFs, sourcePath, destinationPath, followed, tracker, signal);
      }
      return;
    }
    if (metadata.isDirectory) {
      await this.copyDirectory(sourceFs, destinationFs, sourcePath, destinationPath, tracker, signal, ancestorRealPaths);
    } else if (metadata.isFile) {
      await this.copyFile(sourceFs, destinationFs, sourcePath, destinationPath, metadata, tracker, signal);
    }
  }

  private async copyDirectory(
    sourceFs: RemoteFileSystem,
    destinationFs: RemoteFileSystem,
    sourcePath: string,
    destinationPath: string,
    tracker: TransferTracker,
    signal: AbortSignal,
    ancestorRealPaths: ReadonlySet<string>,
  ): Promise<void> {
    const realPath = await sourceFs.resolvePath(sourcePath);
    if (ancestorRealPaths.has(realPath)) return;
    const nextAncestors = new Set(ancestorRealPaths);
    nextAncestors.add(realPath);
    await destinationFs.ensureDirectory(destinationPath);
    for (const entry of await sourceFs.readDirectory(sourcePath)) {
      this.throwIfAborted(signal);
      if (entry.name === '.' || entry.name === '..') continue;
      await this.copyEntry(
        sourceFs,
        destinationFs,
        path.posix.join(sourcePath, entry.name),
        path.posix.join(destinationPath, entry.name),
        tracker,
        signal,
        nextAncestors,
      );
    }
  }

  private async copyFile(
    sourceFs: RemoteFileSystem,
    destinationFs: RemoteFileSystem,
    sourcePath: string,
    destinationPath: string,
    metadata: RemoteFileMetadata,
    tracker: TransferTracker,
    signal: AbortSignal,
  ): Promise<void> {
    tracker.totalFiles += 1;
    tracker.totalBytes += Math.max(0, metadata.size);
    tracker.currentFile = sourcePath;
    this.emitProgress(tracker, true);
    await destinationFs.ensureDirectory(path.posix.dirname(destinationPath));
    const temporaryPath = `${destinationPath}.nexus-transfer-${tracker.requestId}.part`;
    await destinationFs.removeFile(temporaryPath, { ignoreMissing: true });
    const source = await sourceFs.openRead(sourcePath);
    const destination = await destinationFs.openWrite(temporaryPath, { mode: metadata.mode, highWaterMark: 1024 * 1024 });
    const progress = new Transform({
      transform: (chunk, _encoding, callback) => {
        tracker.transferredBytes += Buffer.byteLength(chunk);
        this.emitProgress(tracker);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(source, progress, destination, { signal });
      await destinationFs.replaceFile(temporaryPath, destinationPath);
    } catch (error) {
      await destinationFs.removeFile(temporaryPath, { ignoreMissing: true }).catch(() => undefined);
      throw error;
    }
    tracker.completedFiles += 1;
    this.emitProgress(tracker, true);
  }

  private async removeSource(
    filesystem: RemoteFileSystem,
    remotePath: string,
    ancestorRealPaths: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<void> {
    this.throwIfAborted(signal);
    const metadata = await filesystem.metadata(remotePath);
    if (!metadata.isDirectory || metadata.isSymbolicLink) {
      await filesystem.removeFile(remotePath, { ignoreMissing: true });
      return;
    }
    const realPath = await filesystem.resolvePath(remotePath);
    if (ancestorRealPaths.has(realPath)) return;
    const nextAncestors = new Set(ancestorRealPaths);
    nextAncestors.add(realPath);
    for (const entry of await filesystem.readDirectory(remotePath)) {
      if (entry.name === '.' || entry.name === '..') continue;
      await this.removeSource(filesystem, path.posix.join(remotePath, entry.name), nextAncestors, signal);
    }
    await filesystem.removeDirectory(remotePath);
  }

  private emitProgress(tracker: TransferTracker, force = false): void {
    const now = Date.now();
    if (!force && now - tracker.lastEmittedAt < PROGRESS_INTERVAL_MS) return;
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

  private requireAbsolutePath(value: string, label: string): string {
    const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
    if (!path.posix.isAbsolute(normalized)) throw new Error(`${label} path must be absolute: ${value}`);
    return normalized;
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Transfer cancelled.', 'AbortError');
  }
}
