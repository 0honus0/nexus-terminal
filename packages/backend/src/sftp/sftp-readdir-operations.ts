import type { Stats } from 'ssh2';
import type { ClientState } from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';

interface ReaddirEntry {
  filename: string;
  longname: string;
  attrs: Stats;
}

export const executeReaddirSftpOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string
): Promise<void> => {
  if (!state || !state.sftp) {
    console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readdir (ID: ${requestId})`);
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:readdir:error',
        path,
        payload: 'SFTP 会话未就绪',
        requestId,
      })
    );
    return;
  }

  console.debug(`[SFTP ${sessionId}] Received readdir request for ${path} (ID: ${requestId})`);
  try {
    state.sftp.readdir(path, (err, list: ReaddirEntry[]) => {
      if (err) {
        console.error(`[SFTP ${sessionId}] readdir ${path} failed (ID: ${requestId}):`, err);
        state.ws.send(
          JSON.stringify({
            type: 'sftp:readdir:error',
            path,
            payload: `读取目录失败: ${err.message}`,
            requestId,
          })
        );
        return;
      }

      const files = list.map((item) => ({
        filename: item.filename,
        longname: item.longname,
        attrs: {
          size: item.attrs.size,
          uid: item.attrs.uid,
          gid: item.attrs.gid,
          mode: item.attrs.mode,
          atime: item.attrs.atime * 1000,
          mtime: item.attrs.mtime * 1000,
          isDirectory: item.attrs.isDirectory(),
          isFile: item.attrs.isFile(),
          isSymbolicLink: item.attrs.isSymbolicLink(),
        },
      }));
      state.ws.send(
        JSON.stringify({
          type: 'sftp:readdir:success',
          path,
          payload: files,
          requestId,
        })
      );
    });
  } catch (error: unknown) {
    console.error(
      `[SFTP ${sessionId}] readdir ${path} caught unexpected error (ID: ${requestId}):`,
      error
    );
    state.ws.send(
      JSON.stringify({
        type: 'sftp:readdir:error',
        path,
        payload: `读取目录时发生意外错误: ${getErrorMessage(error)}`,
        requestId,
      })
    );
  }
};
