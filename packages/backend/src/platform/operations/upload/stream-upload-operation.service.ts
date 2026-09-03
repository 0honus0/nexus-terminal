import path from 'node:path';
import { finished } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import type { ExecutionSessionManager } from '../../execution/execution-session-manager';
import type { RemoteFileSystem } from '../../filesystem/remote-filesystem';
import { toRemoteFileEntry } from '../../filesystem/file-entry';
import type {
  UploadChunkRequest,
  UploadEvent,
  UploadOperation,
  UploadPrepareRequest,
  UploadStartRequest,
} from './upload-operation.port';

interface PreparedBatch {
  ownerId: string;
  sessionId: string;
  basePath: string;
  directories: Set<string>;
}

interface ActiveUpload {
  key: string;
  ownerId: string;
  uploadId: string;
  sessionId: string;
  destinationPath: string;
  temporaryPath: string;
  totalSize: number;
  bytesAccepted: number;
  bytesWritten: number;
  nextChunkIndex: number;
  receivedLastChunk: boolean;
  filesystem: RemoteFileSystem;
  stream: Writable;
  emit: (event: UploadEvent) => void;
  queue: Promise<void>;
  cancelled: boolean;
}

const WRITE_HIGH_WATER_MARK = 1024 * 1024;
const PREPARE_CONCURRENCY = 8;

export class StreamUploadOperationService implements UploadOperation {
  private readonly active = new Map<string, ActiveUpload>();
  private readonly prepared = new Map<string, PreparedBatch>();

  constructor(private readonly sessions: Pick<ExecutionSessionManager, 'require'>) {}

  async prepare(request: UploadPrepareRequest): Promise<{ preparedDirectories: number }> {
    if (!request.prepareId || request.prepareId.length > 512) throw new Error('Invalid upload prepare id.');
    if (request.directories.length > 20_000) throw new Error('Too many upload directories.');
    const filesystem = await this.sessions.require(request.sessionId).fileSystem('transfer');
    const basePath = this.absolutePath(request.basePath, 'upload base');
    const directories = new Set<string>([basePath]);
    for (const input of request.directories) directories.add(this.resolveRelativeDirectory(basePath, input));

    await filesystem.ensureDirectory(basePath);
    const remaining = [...directories].filter(value => value !== basePath).sort((a, b) => {
      const depth = a.split('/').length - b.split('/').length;
      return depth || a.localeCompare(b);
    });
    let index = 0;
    const workers = Math.min(PREPARE_CONCURRENCY, remaining.length);
    await Promise.all(Array.from({ length: workers }, async () => {
      while (index < remaining.length) await filesystem.ensureDirectory(remaining[index++]);
    }));

    this.prepared.set(this.prepareKey(request.ownerId, request.prepareId), {
      ownerId: request.ownerId,
      sessionId: request.sessionId,
      basePath,
      directories,
    });
    return { preparedDirectories: directories.size };
  }

  async start(request: UploadStartRequest, emit: (event: UploadEvent) => void): Promise<void> {
    const key = this.uploadKey(request.ownerId, request.uploadId);
    if (!request.uploadId || request.uploadId.length > 512) {
      emit({ type: 'failed', uploadId: request.uploadId, message: 'Invalid upload id.' });
      return;
    }
    if (!Number.isSafeInteger(request.size) || request.size < 0) {
      emit({ type: 'failed', uploadId: request.uploadId, message: 'Invalid upload size.' });
      return;
    }
    if (this.active.has(key)) {
      emit({ type: 'failed', uploadId: request.uploadId, message: 'Upload already started.' });
      return;
    }

    const filesystem = await this.sessions.require(request.sessionId).fileSystem('transfer');
    const destinationPath = this.absolutePath(request.destinationPath, 'upload destination');
    const destinationDirectory = path.posix.dirname(destinationPath);
    if (request.prepareId) {
      const batch = this.prepared.get(this.prepareKey(request.ownerId, request.prepareId));
      if (!batch || batch.sessionId !== request.sessionId) {
        emit({ type: 'failed', uploadId: request.uploadId, message: 'Upload directories were not prepared.' });
        return;
      }
      if (!this.isWithin(batch.basePath, destinationDirectory) || !batch.directories.has(destinationDirectory)) {
        emit({ type: 'failed', uploadId: request.uploadId, message: 'Upload destination is outside prepared directories.' });
        return;
      }
    } else {
      await filesystem.ensureDirectory(destinationDirectory);
    }

    const conflictPolicy = request.conflictPolicy ?? 'ask';
    const exists = await filesystem.exists(destinationPath);
    if (exists && conflictPolicy === 'ask') {
      emit({ type: 'conflict', uploadId: request.uploadId, destinationPath, filename: path.posix.basename(destinationPath) });
      return;
    }
    if (exists && conflictPolicy === 'skip') {
      emit({ type: 'skipped', uploadId: request.uploadId, destinationPath });
      return;
    }

    const temporaryPath = path.posix.join(destinationDirectory, `.nexus-upload-${request.uploadId}.part`);
    await filesystem.removeFile(temporaryPath, { ignoreMissing: true });
    const stream = await filesystem.openWrite(temporaryPath, { highWaterMark: WRITE_HIGH_WATER_MARK });
    const upload: ActiveUpload = {
      key,
      ownerId: request.ownerId,
      uploadId: request.uploadId,
      sessionId: request.sessionId,
      destinationPath,
      temporaryPath,
      totalSize: request.size,
      bytesAccepted: 0,
      bytesWritten: 0,
      nextChunkIndex: 0,
      receivedLastChunk: false,
      filesystem,
      stream,
      emit,
      queue: Promise.resolve(),
      cancelled: false,
    };
    this.active.set(key, upload);
    stream.once('error', (error: Error) => {
      if (this.active.get(key) !== upload || upload.cancelled) return;
      void this.fail(upload, `Upload stream failed: ${error.message}`);
    });
    emit({ type: 'ready', uploadId: request.uploadId });
  }

  async append(request: UploadChunkRequest): Promise<void> {
    const upload = this.active.get(this.uploadKey(request.ownerId, request.uploadId));
    if (!upload) return;
    const task = upload.queue.then(() => this.appendSerial(upload, request));
    upload.queue = task.catch(() => undefined);
    await task;
  }

  async cancel(ownerId: string, uploadId: string): Promise<boolean> {
    const upload = this.active.get(this.uploadKey(ownerId, uploadId));
    if (!upload) return false;
    upload.cancelled = true;
    this.active.delete(upload.key);
    upload.stream.destroy();
    await upload.filesystem.removeFile(upload.temporaryPath, { ignoreMissing: true }).catch(() => undefined);
    upload.emit({ type: 'cancelled', uploadId });
    return true;
  }

  async cancelOwner(ownerId: string): Promise<void> {
    const ids = [...this.active.values()].filter(upload => upload.ownerId === ownerId).map(upload => upload.uploadId);
    await Promise.all(ids.map(uploadId => this.cancel(ownerId, uploadId)));
    for (const [key, batch] of this.prepared) if (batch.ownerId === ownerId) this.prepared.delete(key);
  }

  private async appendSerial(upload: ActiveUpload, request: UploadChunkRequest): Promise<void> {
    if (upload.cancelled || this.active.get(upload.key) !== upload) return;
    if (request.chunkIndex !== upload.nextChunkIndex) {
      await this.fail(upload, `Upload chunk order mismatch: expected ${upload.nextChunkIndex}, received ${request.chunkIndex}.`);
      return;
    }
    if (upload.receivedLastChunk) {
      await this.fail(upload, `Received chunk ${request.chunkIndex} after the final chunk.`);
      return;
    }
    const data = Buffer.from(request.data);
    const nextBytes = upload.bytesAccepted + data.length;
    if (nextBytes > upload.totalSize) {
      await this.fail(upload, `Upload exceeds declared size: ${nextBytes}/${upload.totalSize}.`);
      return;
    }
    const reachesSize = nextBytes === upload.totalSize;
    if (request.isLast !== reachesSize) {
      await this.fail(upload, request.isLast
        ? `Final chunk arrived too early: ${nextBytes}/${upload.totalSize}.`
        : `Declared size reached without final chunk: ${nextBytes}/${upload.totalSize}.`);
      return;
    }

    upload.nextChunkIndex += 1;
    upload.bytesAccepted = nextBytes;
    upload.receivedLastChunk = request.isLast;
    await new Promise<void>((resolve, reject) => {
      upload.stream.write(data, error => error ? reject(error) : resolve());
    }).catch(async error => {
      await this.fail(upload, `Unable to write upload chunk ${request.chunkIndex}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    });
    if (upload.cancelled || this.active.get(upload.key) !== upload) return;
    upload.bytesWritten += data.length;
    upload.emit({
      type: 'chunk-ack',
      uploadId: upload.uploadId,
      chunkIndex: request.chunkIndex,
      bytesWritten: upload.bytesWritten,
      totalSize: upload.totalSize,
      progress: upload.totalSize === 0 ? 100 : Math.min(100, Math.round(upload.bytesWritten / upload.totalSize * 100)),
    });
    if (request.isLast) await this.complete(upload);
  }

  private async complete(upload: ActiveUpload): Promise<void> {
    if (upload.bytesWritten !== upload.totalSize || !upload.receivedLastChunk) {
      await this.fail(upload, `Upload incomplete: ${upload.bytesWritten}/${upload.totalSize}.`);
      return;
    }
    upload.stream.end();
    try {
      await finished(upload.stream);
      const temporaryMetadata = await upload.filesystem.metadata(upload.temporaryPath);
      if (temporaryMetadata.size !== upload.totalSize) {
        throw new Error(`Temporary upload size mismatch: ${temporaryMetadata.size}/${upload.totalSize}.`);
      }
      await upload.filesystem.replaceFile(upload.temporaryPath, upload.destinationPath);
      const metadata = await upload.filesystem.metadata(upload.destinationPath);
      this.active.delete(upload.key);
      upload.emit({ type: 'completed', uploadId: upload.uploadId, destinationPath: upload.destinationPath, item: toRemoteFileEntry(upload.destinationPath, metadata) });
    } catch (error) {
      await this.fail(upload, `Unable to finalize upload: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async fail(upload: ActiveUpload, message: string): Promise<void> {
    if (this.active.get(upload.key) !== upload) return;
    this.active.delete(upload.key);
    upload.cancelled = true;
    if (!upload.stream.destroyed) upload.stream.destroy();
    await upload.filesystem.removeFile(upload.temporaryPath, { ignoreMissing: true }).catch(() => undefined);
    upload.emit({ type: 'failed', uploadId: upload.uploadId, message });
  }

  private uploadKey(ownerId: string, uploadId: string): string { return `${ownerId}\u0000${uploadId}`; }
  private prepareKey(ownerId: string, prepareId: string): string { return `${ownerId}\u0000${prepareId}`; }

  private absolutePath(value: string, label: string): string {
    const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
    if (!path.posix.isAbsolute(normalized)) throw new Error(`${label} must be absolute: ${value}`);
    return normalized;
  }

  private resolveRelativeDirectory(basePath: string, relativePath: string): string {
    const normalizedRelative = path.posix.normalize(relativePath.replace(/\\/g, '/').replace(/^\.\//, '')).replace(/\/$/, '');
    if (!normalizedRelative || normalizedRelative === '.') return basePath;
    if (path.posix.isAbsolute(normalizedRelative) || normalizedRelative === '..' || normalizedRelative.startsWith('../')) {
      throw new Error(`Upload directory contains traversal: ${relativePath}`);
    }
    const fullPath = path.posix.normalize(path.posix.join(basePath, normalizedRelative));
    if (!this.isWithin(basePath, fullPath)) throw new Error(`Upload directory escapes base path: ${relativePath}`);
    return fullPath;
  }

  private isWithin(basePath: string, candidate: string): boolean {
    return basePath === '/' ? candidate.startsWith('/') : candidate === basePath || candidate.startsWith(`${basePath}/`);
  }
}
