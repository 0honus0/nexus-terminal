import { randomUUID } from 'node:crypto';
import type {
  ArchiveOperation,
  CompressArchiveRequest,
  DecompressArchiveRequest,
} from '../../../platform/operations/archive/archive-operation.port';
import type { MutationGuardHandle, MutationGuardPort } from '../../../platform/operations/mutation-guard.port';
import type { TransferOperation, TransferMode } from '../../../platform/operations/transfer/transfer-operation.port';
import type {
  UploadConflictPolicy,
  UploadEvent,
  UploadOperation,
} from '../../../platform/operations/upload/upload-operation.port';
import type { WorkspaceEventHub } from '../workspace-event-hub';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';

/** Workspace authorization/ownership facade over reusable Platform file operations. */
export class WorkspaceOperationsService {
  private readonly uploadGuards = new Map<string, MutationGuardHandle>();

  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly uploads: UploadOperation,
    private readonly transfers: TransferOperation,
    private readonly archives: ArchiveOperation,
    private readonly events: WorkspaceEventHub,
    private readonly mutationGuard: MutationGuardPort,
  ) {}

  async prepareUpload(workspaceId: string, prepareId: string, basePath: string, directories: readonly string[]) {
    const session = this.sessions.require(workspaceId);
    return this.mutationGuard.withMutation(
      this.guardRequest(workspaceId, `upload.prepare:${prepareId}`, [session.connectionId]),
      async () =>
        this.uploads.prepare({
          ownerId: workspaceId,
          sessionId: session.executionSessionId,
          prepareId,
          basePath,
          directories,
        }),
    );
  }

  async startUpload(
    workspaceId: string,
    uploadId: string,
    destinationPath: string,
    size: number,
    options: { relativePath?: string; prepareId?: string; conflictPolicy?: UploadConflictPolicy } = {},
  ) {
    const session = this.sessions.require(workspaceId);
    if (this.uploadGuards.has(this.uploadKey(workspaceId, uploadId))) throw new Error('LEASE_REENTRANT');
    const handle = await this.mutationGuard.beginMutation(
      this.guardRequest(workspaceId, `upload:${uploadId}`, [session.connectionId], [destinationPath]),
    );
    const key = this.uploadKey(workspaceId, uploadId);
    this.uploadGuards.set(key, handle);
    let terminal: Promise<void> | null = null;
    const emit = (event: UploadEvent): void => {
      this.events.publish(workspaceId, { type: 'upload-event', event });
      if (['completed', 'cancelled', 'skipped', 'failed', 'conflict'].includes(event.type)) {
        terminal = this.finishUploadGuard(
          workspaceId,
          uploadId,
          event.type !== 'failed',
          event.type === 'failed' ? event.message : undefined,
        );
      }
    };
    try {
      await this.uploads.start(
        { ownerId: workspaceId, sessionId: session.executionSessionId, uploadId, destinationPath, size, ...options },
        emit,
      );
      if (terminal) await terminal;
    } catch (error) {
      await this.finishUploadGuard(
        workspaceId,
        uploadId,
        false,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async appendUpload(workspaceId: string, uploadId: string, chunkIndex: number, data: Uint8Array, isLast: boolean) {
    this.sessions.require(workspaceId);
    try {
      await this.uploads.append({ ownerId: workspaceId, uploadId, chunkIndex, data, isLast });
    } catch (error) {
      await this.finishUploadGuard(
        workspaceId,
        uploadId,
        false,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async cancelUpload(workspaceId: string, uploadId: string) {
    const cancelled = await this.uploads.cancel(workspaceId, uploadId);
    if (cancelled) await this.finishUploadGuard(workspaceId, uploadId, true);
    return cancelled;
  }

  async abortUpload(workspaceId: string, uploadId: string, message: string) {
    const aborted = await this.uploads.abort(workspaceId, uploadId, message);
    if (aborted) await this.finishUploadGuard(workspaceId, uploadId, false, message);
    return aborted;
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
    return this.mutationGuard.withMutation(
      this.guardRequest(workspaceId, `transfer.${mode}:${requestId}`, [source.connectionId, destination.connectionId]),
      async () =>
        this.transfers.run(
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
        ),
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
    void this.mutationGuard
      .withMutation(
        this.guardRequest(workspaceId, `transfer.${mode}:${requestId}`, [
          source.connectionId,
          destination.connectionId,
        ]),
        async () =>
          this.transfers.run(
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
          ),
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
    return this.mutationGuard.withMutation(
      this.guardRequest(workspaceId, `archive.compress:${input.requestId}`, [session.connectionId]),
      async () =>
        this.archives.compress({ ...input, ownerId: workspaceId, sessionId: session.executionSessionId }, (event) =>
          this.events.publish(workspaceId, { type: 'archive-event', event }),
        ),
    );
  }

  startCompress(workspaceId: string, input: Omit<CompressArchiveRequest, 'ownerId' | 'sessionId'>): void {
    const session = this.sessions.require(workspaceId);
    void this.mutationGuard
      .withMutation(
        this.guardRequest(workspaceId, `archive.compress:${input.requestId}`, [session.connectionId]),
        async () =>
          this.archives.compress({ ...input, ownerId: workspaceId, sessionId: session.executionSessionId }, (event) =>
            this.events.publish(workspaceId, { type: 'archive-event', event }),
          ),
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
    return this.mutationGuard.withMutation(
      this.guardRequest(workspaceId, `archive.decompress:${input.requestId}`, [session.connectionId]),
      async () =>
        this.archives.decompress({ ...input, ownerId: workspaceId, sessionId: session.executionSessionId }, (event) =>
          this.events.publish(workspaceId, { type: 'archive-event', event }),
        ),
    );
  }

  startDecompress(workspaceId: string, input: Omit<DecompressArchiveRequest, 'ownerId' | 'sessionId'>): void {
    const session = this.sessions.require(workspaceId);
    void this.mutationGuard
      .withMutation(
        this.guardRequest(workspaceId, `archive.decompress:${input.requestId}`, [session.connectionId]),
        async () =>
          this.archives.decompress({ ...input, ownerId: workspaceId, sessionId: session.executionSessionId }, (event) =>
            this.events.publish(workspaceId, { type: 'archive-event', event }),
          ),
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
    const guards = [...this.uploadGuards.entries()].filter(([key]) => key.startsWith(`${workspaceId}:`));
    for (const [key, handle] of guards) {
      this.uploadGuards.delete(key);
      await handle.confirm().catch(() => undefined);
    }
  }

  private guardRequest(
    workspaceId: string,
    operationId: string,
    connectionIds: readonly number[],
    paths: readonly string[] = [],
  ) {
    const resourceKeys = [
      ...connectionIds.map((connectionId) => `connection:${connectionId}`),
      ...connectionIds.flatMap((connectionId) =>
        paths.map((remotePath) => `connection:${connectionId}:file:${remotePath}`),
      ),
    ];
    return {
      ownerType: 'workspace' as const,
      ownerId: workspaceId,
      operationId: `${operationId}:${randomUUID()}`,
      resourceKeys,
      timeoutSeconds: 300,
    };
  }

  private uploadKey(workspaceId: string, uploadId: string): string {
    return `${workspaceId}:${uploadId}`;
  }

  private async finishUploadGuard(
    workspaceId: string,
    uploadId: string,
    confirmed: boolean,
    message?: string,
  ): Promise<void> {
    const key = this.uploadKey(workspaceId, uploadId);
    const handle = this.uploadGuards.get(key);
    if (!handle) return;
    this.uploadGuards.delete(key);
    if (confirmed) await handle.confirm();
    else await handle.unknown('UPLOAD_OUTCOME_UNKNOWN', message ? { message: message.slice(0, 512) } : undefined);
  }
}
