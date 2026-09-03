import { WebSocket } from 'ws';
import type { AuthenticatedWebSocket } from '../websocket/types';
import type { WorkspaceSessionRegistry } from '../workspace/workspace-session-registry';
import { ArchiveOperationService } from './archive-operation.service';
import type {
  ArchiveOperationContext,
  ArchiveOperationEvent,
  CompressArchiveRequest,
  DecompressArchiveRequest,
} from './archive.types';

/** Maps transport-neutral archive events onto the existing Workspace WebSocket protocol. */
export class WorkspaceArchiveAdapter {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly operations: ArchiveOperationService,
  ) {}

  async cleanupSession(sessionId: string): Promise<void> {
    await this.operations.cleanupOwner(sessionId);
  }

  async compress(sessionId: string, payload: CompressArchiveRequest): Promise<void> {
    const context = this.createContext(sessionId, 'compress', payload.requestId);
    if (!context) return;
    await this.operations.compress(context, payload);
  }

  async decompress(sessionId: string, payload: DecompressArchiveRequest): Promise<void> {
    const context = this.createContext(sessionId, 'decompress', payload.requestId);
    if (!context) return;
    await this.operations.decompress(context, payload);
  }

  async cancelArchive(sessionId: string, requestId: string): Promise<void> {
    const result = await this.operations.cancel(sessionId, requestId);
    const state = this.sessions.get(sessionId);
    if (state?.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({
      type: 'sftp:archive:cancelled',
      requestId,
      payload: { requestId, cleaned: result.cleaned },
    }));
  }

  private createContext(
    sessionId: string,
    operation: 'compress' | 'decompress',
    requestId: string,
  ): ArchiveOperationContext | null {
    const state = this.sessions.get(sessionId);
    if (!state?.executionSession.isReady) {
      this.sendEvent(state?.ws, {
        type: 'error',
        operation,
        requestId,
        error: 'SSH 会话未就绪',
      });
      return null;
    }
    return {
      ownerKey: sessionId,
      session: state.executionSession,
      emit: (event) => this.sendEvent(state.ws, event),
    };
  }

  private sendEvent(ws: AuthenticatedWebSocket | undefined, event: ArchiveOperationEvent): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (event.type === 'progress') {
      ws.send(JSON.stringify({
        type: `sftp:${event.operation}:progress`,
        requestId: event.requestId,
        payload: {
          requestId: event.requestId,
          fileCount: event.fileCount,
          totalFiles: event.totalFiles,
          percent: event.percent,
          currentFile: event.currentFile,
        },
      }));
      return;
    }

    if (event.type === 'success') {
      ws.send(JSON.stringify({
        type: `sftp:${event.operation}:success`,
        requestId: event.requestId,
        payload: {
          message: event.message,
          requestId: event.requestId,
          ...(event.warning ? { warning: event.warning } : {}),
        },
      }));
      return;
    }

    if (event.commandNotFound) {
      ws.send(JSON.stringify({
        type: 'sftp:command_not_found',
        requestId: event.requestId,
        payload: {
          operation: event.operation,
          command: event.commandNotFound,
          message: event.details || event.error,
        },
      }));
      return;
    }

    ws.send(JSON.stringify({
      type: `sftp:${event.operation}:error`,
      requestId: event.requestId,
      payload: {
        error: event.error,
        requestId: event.requestId,
        ...(event.details ? { details: event.details } : {}),
        ...(event.code ? { code: event.code } : {}),
      },
    }));
  }
}
