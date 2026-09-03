import WebSocket, { type RawData } from 'ws';
import type { WorkspaceOperationsService } from '../../../modules/workspace/services/workspace-operations.service';
import type { WorkspaceService } from '../../../modules/workspace/workspace.service';
import { parseLegacyUploadBinaryFrame } from './upload-binary.transport';

export interface LegacyUploadSocketDependencies {
  workspace: WorkspaceService;
  operations: WorkspaceOperationsService;
}

/** Bind the current frontend's dedicated /ws/upload NXUP data channel. */
export const bindLegacyUploadSocket = (
  socket: WebSocket,
  userId: number,
  workspaceId: string,
  dependencies: LegacyUploadSocketDependencies,
): boolean => {
  const workspace = dependencies.workspace.getSession(workspaceId);
  if (!workspace || workspace.userId !== userId) {
    socket.close(1008, 'Invalid upload session');
    return false;
  }

  socket.send(JSON.stringify({ type: 'sftp:upload:transport:ready', payload: { sessionId: workspaceId } }));
  socket.on('message', (raw: RawData, isBinary: boolean) => {
    if (!isBinary) {
      socket.close(1003, 'Upload transport accepts binary frames only');
      return;
    }
    void (async () => {
      try {
        const chunk = parseLegacyUploadBinaryFrame(raw);
        await dependencies.operations.appendUpload(
          workspaceId,
          chunk.uploadId,
          chunk.chunkIndex,
          chunk.data,
          chunk.isLast,
        );
      } catch (error) {
        console.error(`[WebSocket upload/${workspaceId}] invalid upload frame:`, error);
        socket.close(1003, 'Invalid upload frame');
      }
    })();
  });
  return true;
};
