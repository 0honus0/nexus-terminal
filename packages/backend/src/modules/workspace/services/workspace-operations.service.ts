import type {
  ArchiveOperation,
  CompressArchiveRequest,
  DecompressArchiveRequest,
} from '../../../platform/operations/archive/archive-operation.port';
import type { TransferOperation, TransferMode } from '../../../platform/operations/transfer/transfer-operation.port';
import type { UploadConflictPolicy, UploadOperation } from '../../../platform/operations/upload/upload-operation.port';
import type { WorkspaceEventHub } from '../workspace-event-hub';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';

/** Workspace authorization/ownership facade over reusable Platform file operations. */
export class WorkspaceOperationsService {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly uploads: UploadOperation,
    private readonly transfers: TransferOperation,
    private readonly archives: ArchiveOperation,
    private readonly events: WorkspaceEventHub,
  ) {}
  async prepareUpload(workspaceId: string, prepareId: string, basePath: string, directories: readonly string[]) {
    const session = this.sessions.require(workspaceId);
    return this.uploads.prepare({
      ownerId: workspaceId,
      sessionId: session.executionSessionId,
      prepareId,
      basePath,
      directories,
    });
  }
  async startUpload(
    workspaceId: string,
    uploadId: string,
    destinationPath: string,
    size: number,
    options: { relativePath?: string; prepareId?: string; conflictPolicy?: UploadConflictPolicy } = {},
  ) {
    const session = this.sessions.require(workspaceId);
    await this.uploads.start(
      { ownerId: workspaceId, sessionId: session.executionSessionId, uploadId, destinationPath, size, ...options },
      (event) => this.events.publish(workspaceId, { type: 'upload-event', event }),
    );
  }
  appendUpload(workspaceId: string, uploadId: string, chunkIndex: number, data: Uint8Array, isLast: boolean) {
    this.sessions.require(workspaceId);
    return this.uploads.append({ ownerId: workspaceId, uploadId, chunkIndex, data, isLast });
  }
  cancelUpload(workspaceId: string, uploadId: string) {
    return this.uploads.cancel(workspaceId, uploadId);
  }
  abortUpload(workspaceId: string, uploadId: string, message: string) {
    return this.uploads.abort(workspaceId, uploadId, message);
  }
  async runTransfer(
    workspaceId: string,
    sourceWorkspaceId: string,
    sourcePaths: readonly string[],
    destinationPath: string,
    requestId: string,
    mode: TransferMode,
  ) {
    const destination = this.sessions.require(workspaceId),
      source = this.sessions.require(sourceWorkspaceId);
    if (source.userId !== destination.userId) throw new Error('无权访问源 SFTP 会话。');
    await this.transfers.run(
      {
        requestId,
        ownerId: workspaceId,
        sourceOwnerId: sourceWorkspaceId,
        sourceSessionId: source.executionSessionId,
        destinationSessionId: destination.executionSessionId,
        sourcePaths,
        destinationPath,
        mode,
      },
      (event) => this.events.publish(workspaceId, { type: 'transfer-event', event }),
    );
  }
  startTransfer(
    workspaceId: string,
    sourceWorkspaceId: string,
    sourcePaths: readonly string[],
    destinationPath: string,
    requestId: string,
    mode: TransferMode,
  ): void {
    const destination = this.sessions.require(workspaceId),
      source = this.sessions.require(sourceWorkspaceId);
    if (source.userId !== destination.userId) throw new Error('无权访问源 SFTP 会话。');
    void this.transfers
      .run(
        {
          requestId,
          ownerId: workspaceId,
          sourceOwnerId: sourceWorkspaceId,
          sourceSessionId: source.executionSessionId,
          destinationSessionId: destination.executionSessionId,
          sourcePaths,
          destinationPath,
          mode,
        },
        (event) => this.events.publish(workspaceId, { type: 'transfer-event', event }),
      )
      .catch((error) =>
        this.events.publish(workspaceId, {
          type: 'transfer-event',
          event: {
            type: 'failed',
            requestId,
            mode,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
  }
  copy(workspaceId: string, sources: readonly string[], destination: string, requestId: string) {
    return this.runTransfer(workspaceId, workspaceId, sources, destination, requestId, 'copy');
  }
  move(workspaceId: string, sources: readonly string[], destination: string, requestId: string) {
    return this.runTransfer(workspaceId, workspaceId, sources, destination, requestId, 'move');
  }
  crossCopy(
    destinationWorkspaceId: string,
    sourceWorkspaceId: string,
    sources: readonly string[],
    destination: string,
    requestId: string,
  ) {
    return this.runTransfer(destinationWorkspaceId, sourceWorkspaceId, sources, destination, requestId, 'copy');
  }
  cancelTransfer(workspaceId: string, requestId: string) {
    this.sessions.require(workspaceId);
    return this.transfers.cancel(workspaceId, requestId);
  }
  compress(workspaceId: string, input: Omit<CompressArchiveRequest, 'ownerId' | 'sessionId'>) {
    const session = this.sessions.require(workspaceId);
    return this.archives.compress({ ...input, ownerId: workspaceId, sessionId: session.executionSessionId }, (event) =>
      this.events.publish(workspaceId, { type: 'archive-event', event }),
    );
  }
  startCompress(workspaceId: string, input: Omit<CompressArchiveRequest, 'ownerId' | 'sessionId'>): void {
    const session = this.sessions.require(workspaceId);
    void this.archives
      .compress({ ...input, ownerId: workspaceId, sessionId: session.executionSessionId }, (event) =>
        this.events.publish(workspaceId, { type: 'archive-event', event }),
      )
      .catch((error) =>
        this.events.publish(workspaceId, {
          type: 'archive-event',
          event: {
            type: 'failed',
            operation: 'compress',
            requestId: input.requestId,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
  }
  decompress(workspaceId: string, input: Omit<DecompressArchiveRequest, 'ownerId' | 'sessionId'>) {
    const session = this.sessions.require(workspaceId);
    return this.archives.decompress(
      { ...input, ownerId: workspaceId, sessionId: session.executionSessionId },
      (event) => this.events.publish(workspaceId, { type: 'archive-event', event }),
    );
  }
  startDecompress(workspaceId: string, input: Omit<DecompressArchiveRequest, 'ownerId' | 'sessionId'>): void {
    const session = this.sessions.require(workspaceId);
    void this.archives
      .decompress({ ...input, ownerId: workspaceId, sessionId: session.executionSessionId }, (event) =>
        this.events.publish(workspaceId, { type: 'archive-event', event }),
      )
      .catch((error) =>
        this.events.publish(workspaceId, {
          type: 'archive-event',
          event: {
            type: 'failed',
            operation: 'decompress',
            requestId: input.requestId,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
  }
  cancelArchive(workspaceId: string, requestId: string) {
    return this.archives.cancel(workspaceId, requestId);
  }
  async cleanup(workspaceId: string) {
    await Promise.all([
      this.uploads.cancelOwner(workspaceId),
      this.transfers.cancelOwner(workspaceId),
      this.archives.cancelOwner(workspaceId),
    ]);
  }
}
