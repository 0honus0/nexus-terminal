import type { WorkspaceEvent } from '../../../modules/workspace/workspace-event-hub';
import type { WebSocketOutboundMessage } from '../websocket-boundary';
import { toLegacyFileItem } from './file-dto.mapper';

export type LegacyWorkspaceJsonMessage = WebSocketOutboundMessage & Record<string, unknown>;

export const mapLegacyWorkspaceEvent = (event: WorkspaceEvent): LegacyWorkspaceJsonMessage | null => {
  switch (event.type) {
    case 'terminal-output':
      return null;
    case 'terminal-input-ack':
      return { type: 'ssh:input:ack', payload: { sequence: event.sequence, bytes: event.bytes } };
    case 'terminal-closed':
      return { type: 'ssh:disconnected', payload: 'Shell 通道已关闭。' };
    case 'terminal-error':
      return { type: 'ssh:error', payload: `SSH 连接错误: ${event.message}` };
    case 'directory-change-queued':
      return {
        type: 'ssh:change_directory:queued',
        requestId: event.requestId,
        payload: { path: event.path, waitingForPrompt: event.waitingForPrompt },
      };
    case 'directory-change-result':
      return { type: 'ssh:change_directory:result', requestId: event.requestId, payload: { path: event.path } };
    case 'directory-change-error':
      return { type: 'ssh:change_directory:error', requestId: event.requestId, payload: { error: event.message } };
    case 'status-update':
      return { type: 'status_update', payload: { connectionId: event.connectionId, status: event.status } };
    case 'status-error':
      return { type: 'status:error', payload: { connectionId: event.connectionId, message: event.message } };
    case 'filesystem-ready':
      return { type: 'sftp_ready', payload: { connectionId: event.connectionId } };
    case 'filesystem-error':
      return { type: 'sftp_error', payload: { connectionId: event.connectionId, message: event.message } };
    case 'upload-event': {
      const upload = event.event;
      switch (upload.type) {
        case 'ready':
          return { type: 'sftp:upload:ready', payload: { uploadId: upload.uploadId } };
        case 'conflict':
          return {
            type: 'sftp:upload:conflict',
            uploadId: upload.uploadId,
            payload: { uploadId: upload.uploadId, remotePath: upload.destinationPath, filename: upload.filename },
          };
        case 'skipped':
          return {
            type: 'sftp:upload:skipped',
            uploadId: upload.uploadId,
            path: upload.destinationPath,
            payload: { uploadId: upload.uploadId, remotePath: upload.destinationPath },
          };
        case 'chunk-ack':
          return {
            type: 'sftp:upload:chunk:ack',
            uploadId: upload.uploadId,
            payload: {
              uploadId: upload.uploadId,
              chunkIndex: upload.chunkIndex,
              bytesWritten: upload.bytesWritten,
              totalSize: upload.totalSize,
              progress: upload.progress,
            },
          };
        case 'completed':
          return {
            type: 'sftp:upload:success',
            uploadId: upload.uploadId,
            path: upload.destinationPath,
            payload: toLegacyFileItem(upload.item),
          };
        case 'cancelled':
          return { type: 'sftp:upload:cancelled', payload: { uploadId: upload.uploadId } };
        case 'failed':
          return { type: 'sftp:upload:error', payload: { uploadId: upload.uploadId, message: upload.message } };
      }
    }
    case 'transfer-event': {
      const transfer = event.event;
      switch (transfer.type) {
        case 'progress':
          return {
            type: 'sftp:transfer:progress',
            requestId: transfer.requestId,
            payload: {
              transferredBytes: transfer.transferredBytes,
              totalBytes: transfer.totalBytes,
              completedFiles: transfer.completedFiles,
              totalFiles: transfer.totalFiles,
              totalKnown: transfer.totalKnown,
              currentFile: transfer.currentFile,
            },
          };
        case 'cancelling':
          return {
            type: 'sftp:transfer:cancelling',
            requestId: transfer.requestId,
            payload: { requestId: transfer.requestId },
          };
        case 'cancelled':
          return {
            type: 'sftp:transfer:cancelled',
            requestId: transfer.requestId,
            payload: { requestId: transfer.requestId },
          };
        case 'completed':
          return {
            type: transfer.mode === 'copy' ? 'sftp:copy:success' : 'sftp:move:success',
            requestId: transfer.requestId,
            payload: {
              sources: transfer.sourcePaths,
              destination: transfer.destinationPath,
              items: transfer.items.map(toLegacyFileItem),
              ...(transfer.sourceOwnerId ? { sourceSessionId: transfer.sourceOwnerId } : {}),
              ...(transfer.crossSession ? { crossHost: true } : {}),
            },
          };
        case 'failed':
          return {
            type: transfer.mode === 'copy' ? 'sftp:copy:error' : 'sftp:move:error',
            requestId: transfer.requestId,
            payload: transfer.message,
          };
      }
    }
    case 'archive-event': {
      const archive = event.event;
      switch (archive.type) {
        case 'progress':
          return {
            type: `sftp:${archive.operation}:progress`,
            requestId: archive.requestId,
            payload: {
              requestId: archive.requestId,
              fileCount: archive.fileCount,
              totalFiles: archive.totalFiles,
              percent: archive.percent,
              currentFile: archive.currentFile,
            },
          };
        case 'completed':
          return {
            type: `sftp:${archive.operation}:success`,
            requestId: archive.requestId,
            payload: {
              requestId: archive.requestId,
              path: archive.path,
              ...(archive.warning ? { warning: archive.warning } : {}),
            },
          };
        case 'cancelled':
          return {
            type: 'sftp:archive:cancelled',
            requestId: archive.requestId,
            payload: { requestId: archive.requestId },
          };
        case 'failed':
          if (archive.commandNotFound) {
            return {
              type: 'sftp:command_not_found',
              requestId: archive.requestId,
              payload: {
                operation: archive.operation,
                command: archive.commandNotFound,
                message: archive.details || archive.message,
              },
            };
          }
          return {
            type: `sftp:${archive.operation}:error`,
            requestId: archive.requestId,
            payload: {
              error: archive.message,
              requestId: archive.requestId,
              ...(archive.details ? { details: archive.details } : {}),
              ...(archive.code ? { code: archive.code } : {}),
            },
          };
      }
    }
  }
};
