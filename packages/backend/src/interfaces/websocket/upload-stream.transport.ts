import WebSocket, { type RawData } from 'ws';
import type { WorkspaceOperationsService } from '../../modules/workspace/services/workspace-operations.service';
import type { WorkspaceService } from '../../modules/workspace/workspace.service';

const MAX_UPLOAD_CHUNK_BYTES = 1024 * 1024;
const SERVER_QUEUE_HIGH_WATER_BYTES = 8 * 1024 * 1024;
const SERVER_QUEUE_LOW_WATER_BYTES = 2 * 1024 * 1024;

export interface UploadStreamRequest {
  workspaceId: string;
  uploadId: string;
  size: number;
}

/**
 * Clean upload transport. One socket carries one upload; every binary WebSocket message is one raw
 * file chunk. WebSocket message order defines chunk order and the declared total size determines the
 * final chunk. Payloads are raw ordered file bytes; the declared size defines completion.
 */
export const bindUploadStream = (
  socket: WebSocket,
  userId: number,
  request: UploadStreamRequest,
  dependencies: { workspace: WorkspaceService; operations: WorkspaceOperationsService },
): boolean => {
  const workspace = dependencies.workspace.getSession(request.workspaceId);
  if (!workspace || workspace.userId !== userId) {
    socket.close(1008, 'Invalid workspace');
    return false;
  }
  if (!request.uploadId || request.uploadId.length > 512 || !Number.isSafeInteger(request.size) || request.size < 0) {
    socket.close(1008, 'Invalid upload request');
    return false;
  }

  let chunkIndex = 0;
  let bytesReceived = 0;
  let closed = false;
  let uploadCompleted = false;
  let cleanupStarted = false;
  let queuedBytes = 0;
  let paused = false;

  const cleanupIncompleteUpload = (): void => {
    if (uploadCompleted || cleanupStarted) return;
    cleanupStarted = true;
    void dependencies.operations
      .abortUpload(request.workspaceId, request.uploadId, 'Upload data transport closed before completion.')
      .catch((error) => {
        console.error(
          `[WebSocket upload/${request.workspaceId}/${request.uploadId}] unable to clean incomplete upload:`,
          error,
        );
      });
  };

  socket.once('close', cleanupIncompleteUpload);
  socket.once('error', cleanupIncompleteUpload);

  const updateReceiveBackpressure = (): void => {
    if (closed || socket.readyState !== WebSocket.OPEN) return;
    if (!paused && queuedBytes >= SERVER_QUEUE_HIGH_WATER_BYTES) {
      socket.pause();
      paused = true;
      return;
    }
    if (paused && queuedBytes <= SERVER_QUEUE_LOW_WATER_BYTES) {
      socket.resume();
      paused = false;
    }
  };

  if (request.size === 0) {
    void dependencies.operations
      .appendUpload(request.workspaceId, request.uploadId, 0, Buffer.alloc(0), true)
      .then(() => {
        uploadCompleted = true;
        if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Upload complete');
      })
      .catch(() => {
        if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Upload append failed');
      });
  }

  socket.on('message', (raw: RawData, isBinary: boolean) => {
    if (closed) return;
    if (!isBinary) {
      socket.close(1003, 'Upload stream accepts binary messages only');
      closed = true;
      return;
    }
    const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
    if (data.byteLength > MAX_UPLOAD_CHUNK_BYTES) {
      socket.close(1009, 'Upload chunk too large');
      closed = true;
      return;
    }
    const nextBytes = bytesReceived + data.byteLength;
    if (nextBytes > request.size) {
      socket.close(1009, 'Upload exceeds declared size');
      closed = true;
      return;
    }
    const isLast = nextBytes === request.size;
    const currentIndex = chunkIndex++;
    bytesReceived = nextBytes;
    queuedBytes += data.byteLength;
    updateReceiveBackpressure();
    void dependencies.operations
      .appendUpload(request.workspaceId, request.uploadId, currentIndex, data, isLast)
      .then(() => {
        queuedBytes = Math.max(0, queuedBytes - data.byteLength);
        updateReceiveBackpressure();
        if (isLast && socket.readyState === WebSocket.OPEN) {
          uploadCompleted = true;
          closed = true;
          socket.close(1000, 'Upload complete');
        }
      })
      .catch((error) => {
        queuedBytes = Math.max(0, queuedBytes - data.byteLength);
        console.error(`[WebSocket upload/${request.workspaceId}/${request.uploadId}] append failed:`, error);
        if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Upload append failed');
        closed = true;
      });
  });

  return true;
};
