import type { ClientState } from '../websocket/types';

/**
 * Workspace-only SFTP channel lifecycle.
 *
 * It announces control-channel readiness to the browser, but it does not implement
 * filesystem operations. Agent sessions use ExecutionSession/SftpFileSystem directly.
 */
export class WorkspaceSftpSessionService {
  constructor(private readonly clientStates: Map<string, ClientState>) {}

  async initialize(sessionId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state?.executionSession.isReady) {
      console.warn(`[SFTP] 无法为 Workspace 会话 ${sessionId} 初始化 SFTP：SSH 会话未就绪。`);
      return;
    }

    if (!state.executionSession.sftp.control) {
      try {
        await state.executionSession.sftp.ensure('control');
      } catch (error) {
        console.error(`[SFTP] 为 Workspace 会话 ${sessionId} 初始化 control channel 失败:`, error);
        state.executionSession.sftp.close('control');
        if (state.ws.readyState === state.ws.OPEN) {
          state.ws.send(
            JSON.stringify({
              type: 'sftp_error',
              payload: { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' },
            }),
          );
        }
        throw error;
      }
    }

    if (state.ws.readyState === state.ws.OPEN) {
      state.ws.send(JSON.stringify({ type: 'sftp_ready', payload: { connectionId: state.dbConnectionId } }));
    }
  }

  closeChannels(sessionId: string): void {
    this.clientStates.get(sessionId)?.executionSession.sftp.closeAll();
  }
}
