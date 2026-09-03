import { WebSocket } from 'ws';
import type { AuthenticatedWebSocket } from '../websocket/types';
import type { WorkspaceSession } from '../workspace/workspace-session';
import type { WorkspaceSessionRegistry } from '../workspace/workspace-session-registry';
import { SftpTransferOperationService } from './sftp-transfer-operation.service';
import type { SftpTransferContext, SftpTransferEvent } from './sftp-transfer.types';

/** Workspace authorization and WebSocket protocol mapping for reusable SFTP transfer operations. */
export class WorkspaceSftpTransferAdapter {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly operations: SftpTransferOperationService,
  ) {}

  cleanupSession(sessionId: string): void {
    this.operations.cleanupOwner(sessionId);
  }

  async copy(sessionId: string, sources: string[], destination: string, requestId: string): Promise<void> {
    const target = this.createContext(sessionId, 'copy-error', requestId);
    if (!target) return;
    await this.operations.copy(target, sources, destination, requestId);
  }

  async copyAcrossSessions(
    destinationSessionId: string,
    sourceSessionId: string,
    sources: string[],
    destination: string,
    requestId: string,
  ): Promise<void> {
    const destinationState = this.sessions.get(destinationSessionId);
    const sourceState = this.sessions.get(sourceSessionId);
    if (!destinationState?.executionSession.isReady) {
      this.sendEvent(destinationState?.ws, { type: 'copy-error', requestId, message: '目标 SFTP 会话未就绪' });
      return;
    }
    if (!sourceState?.executionSession.isReady) {
      this.sendEvent(destinationState.ws, { type: 'copy-error', requestId, message: '源 SFTP 会话未就绪或已断开' });
      return;
    }
    if (destinationState.ws.userId === undefined || sourceState.ws.userId !== destinationState.ws.userId) {
      this.sendEvent(destinationState.ws, { type: 'copy-error', requestId, message: '无权访问源 SFTP 会话' });
      return;
    }

    const context = this.contextFromState(destinationSessionId, destinationState);
    await this.operations.copyAcrossSessions(
      context,
      { ownerKey: sourceSessionId, session: sourceState.executionSession },
      sources,
      destination,
      requestId,
    );
  }

  async move(sessionId: string, sources: string[], destination: string, requestId: string): Promise<void> {
    const target = this.createContext(sessionId, 'move-error', requestId);
    if (!target) return;
    await this.operations.move(target, sources, destination, requestId);
  }

  async cancelTransfer(sessionId: string, requestId: string): Promise<void> {
    const result = await this.operations.cancel(sessionId, requestId);
    if (result.active) return;
    const state = this.sessions.get(sessionId);
    this.sendEvent(state?.ws, { type: 'cancelled', requestId });
  }

  private createContext(
    sessionId: string,
    errorType: 'copy-error' | 'move-error',
    requestId: string,
  ): SftpTransferContext | null {
    const state = this.sessions.get(sessionId);
    if (!state?.executionSession.isReady) {
      this.sendEvent(state?.ws, { type: errorType, requestId, message: 'SFTP 会话未就绪' });
      return null;
    }
    return this.contextFromState(sessionId, state);
  }

  private contextFromState(sessionId: string, state: WorkspaceSession): SftpTransferContext {
    return {
      ownerKey: sessionId,
      session: state.executionSession,
      emit: (event) => this.sendEvent(state.ws, event),
    };
  }

  private sendEvent(ws: AuthenticatedWebSocket | undefined, event: SftpTransferEvent): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (event.type === 'progress') {
      ws.send(JSON.stringify({
        type: 'sftp:transfer:progress',
        requestId: event.requestId,
        payload: {
          transferredBytes: event.transferredBytes,
          totalBytes: event.totalBytes,
          completedFiles: event.completedFiles,
          totalFiles: event.totalFiles,
          totalKnown: event.totalKnown,
          currentFile: event.currentFile,
        },
      }));
      return;
    }
    if (event.type === 'cancelling' || event.type === 'cancelled') {
      ws.send(JSON.stringify({
        type: `sftp:transfer:${event.type}`,
        requestId: event.requestId,
        payload: { requestId: event.requestId },
      }));
      return;
    }
    if (event.type === 'copy-success') {
      ws.send(JSON.stringify({
        type: 'sftp:copy:success',
        requestId: event.requestId,
        payload: {
          destination: event.destination,
          items: event.items,
          ...(event.sourceOwnerKey ? { sourceSessionId: event.sourceOwnerKey } : {}),
          ...(event.crossHost ? { crossHost: true } : {}),
        },
      }));
      return;
    }
    if (event.type === 'move-success') {
      ws.send(JSON.stringify({
        type: 'sftp:move:success',
        requestId: event.requestId,
        payload: { sources: event.sources, destination: event.destination, items: event.items },
      }));
      return;
    }
    ws.send(JSON.stringify({
      type: event.type === 'copy-error' ? 'sftp:copy:error' : 'sftp:move:error',
      requestId: event.requestId,
      payload: event.message,
    }));
  }
}
