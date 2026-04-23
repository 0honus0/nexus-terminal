import type { SFTPWrapper } from 'ssh2';
import type { ClientState } from '../websocket/types';

export const executeInitializeSftpSessionOperation = async (
  state: ClientState | undefined,
  sessionId: string
): Promise<void> => {
  if (!state || !state.sshClient || state.sftp) {
    console.warn(
      `[SFTP] 无法为会话 ${sessionId} 初始化 SFTP：状态无效、SSH客户端不存在或 SFTP 已初始化。`
    );
    return;
  }

  if (!state.sshClient) {
    console.error(`[SFTP] 会话 ${sessionId} 的 SSH 客户端不存在，无法初始化 SFTP。`);
    return;
  }

  return new Promise((resolve, reject) => {
    state.sshClient.sftp((err: Error | undefined, sftpInstance: SFTPWrapper) => {
      if (err) {
        console.error(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话失败:`, err);
        state.ws.send(
          JSON.stringify({
            type: 'sftp_error',
            payload: { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' },
          })
        );
        reject(err);
        return;
      }

      console.info(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话成功。`);
      state.sftp = sftpInstance;
      state.ws.send(
        JSON.stringify({ type: 'sftp_ready', payload: { connectionId: state.dbConnectionId } })
      );
      sftpInstance.on('end', () => {
        console.info(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已结束。`);
        state.sftp = undefined;
      });
      sftpInstance.on('close', () => {
        console.info(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已关闭。`);
        state.sftp = undefined;
      });
      sftpInstance.on('error', (sftpErr: Error) => {
        console.error(`[SFTP] 会话 ${sessionId} 的 SFTP 会话出错:`, sftpErr);
        state.sftp = undefined;
        state.ws.send(
          JSON.stringify({
            type: 'sftp_error',
            payload: { connectionId: state.dbConnectionId, message: 'SFTP 会话错误' },
          })
        );
      });
      resolve();
    });
  });
};

export const executeCleanupSftpSessionOperation = (
  state: ClientState | undefined,
  sessionId: string
): void => {
  if (state?.sftp) {
    console.debug(`[SFTP] 正在清理 ${sessionId} 的 SFTP 会话...`);
    state.sftp.end();
    state.sftp = undefined;
  }
};
