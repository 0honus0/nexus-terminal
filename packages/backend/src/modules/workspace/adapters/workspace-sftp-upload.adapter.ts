import { WebSocket } from 'ws';
import type { AuthenticatedWebSocket } from '../../../interfaces/websocket/types';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';
import { SftpUploadOperationService } from '../../../platform/operations/upload/sftp-upload-operation.service';
import type { SftpUploadContext, SftpUploadEvent, UploadConflictPolicy } from '../../../platform/operations/upload/sftp-upload.types';

/** Workspace ownership and WebSocket mapping for transport-neutral upload operations. */
export class WorkspaceSftpUploadAdapter {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly operations: SftpUploadOperationService,
  ) {}

  async cleanupSession(sessionId: string): Promise<void> {
    await this.operations.cleanupOwner(sessionId);
  }

  async prepareUploadDirectories(
    sessionId: string,
    prepareId: string,
    basePath: string,
    directories: string[],
  ): Promise<{ preparedDirectories: number }> {
    const context = this.requireContext(sessionId);
    return this.operations.prepareUploadDirectories(context, prepareId, basePath, directories);
  }

  async startUpload(
    sessionId: string,
    uploadId: string,
    remotePath: string,
    totalSize: number,
    relativePath?: string,
    prepareId?: string,
    conflictPolicy: UploadConflictPolicy = 'ask',
  ): Promise<void> {
    const context = this.context(sessionId);
    if (!context) return;
    await this.operations.startUpload(context, uploadId, remotePath, totalSize, relativePath, prepareId, conflictPolicy);
  }

  async handleUploadChunk(
    sessionId: string,
    uploadId: string,
    chunkIndex: number,
    chunkBuffer: Buffer,
    isLast: boolean,
  ): Promise<void> {
    await this.operations.handleUploadChunk(sessionId, uploadId, chunkIndex, chunkBuffer, isLast);
  }

  async cancelUpload(sessionId: string, uploadId: string): Promise<void> {
    const context = this.context(sessionId);
    if (!context) return;
    await this.operations.cancelUpload(context, uploadId);
  }

  async cancelUploads(sessionId: string, uploadIds: string[]): Promise<void> {
    const context = this.context(sessionId);
    if (!context) return;
    await this.operations.cancelUploads(context, uploadIds);
  }

  private requireContext(sessionId: string): SftpUploadContext {
    const context = this.context(sessionId);
    if (!context) throw new Error('SSH 会话未就绪');
    return context;
  }

  private context(sessionId: string): SftpUploadContext | null {
    const state = this.sessions.get(sessionId);
    if (!state?.executionSession.isReady) return null;
    return {
      ownerKey: sessionId,
      session: state.executionSession,
      emit: (event) => this.sendEvent(state.ws, event),
    };
  }

  private sendEvent(ws: AuthenticatedWebSocket | undefined, event: SftpUploadEvent): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    switch (event.type) {
      case 'error':
        ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: event.uploadId, message: event.message } }));
        return;
      case 'conflict':
        ws.send(JSON.stringify({
          type: 'sftp:upload:conflict',
          uploadId: event.uploadId,
          payload: { uploadId: event.uploadId, remotePath: event.remotePath, filename: event.filename },
        }));
        return;
      case 'skipped':
        ws.send(JSON.stringify({
          type: 'sftp:upload:skipped',
          uploadId: event.uploadId,
          path: event.remotePath,
          payload: { uploadId: event.uploadId, remotePath: event.remotePath },
        }));
        return;
      case 'ready':
        ws.send(JSON.stringify({ type: 'sftp:upload:ready', payload: { uploadId: event.uploadId } }));
        return;
      case 'chunk-ack':
        ws.send(JSON.stringify({
          type: 'sftp:upload:chunk:ack',
          uploadId: event.uploadId,
          payload: {
            uploadId: event.uploadId,
            chunkIndex: event.chunkIndex,
            bytesWritten: event.bytesWritten,
            totalSize: event.totalSize,
            progress: event.progress,
          },
        }));
        return;
      case 'success':
        ws.send(JSON.stringify({
          type: 'sftp:upload:success',
          payload: event.item,
          uploadId: event.uploadId,
          path: event.remotePath,
        }));
        return;
      case 'cancelled':
        ws.send(JSON.stringify({ type: 'sftp:upload:cancelled', payload: { uploadId: event.uploadId } }));
    }
  }
}
