import { Stats } from 'ssh2';
import type { ClientState } from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';

interface PathItemPayload {
  filename: string;
  longname: string;
  attrs: {
    size: number;
    uid: number;
    gid: number;
    mode: number;
    atime: number;
    mtime: number;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
  };
}

const getFilenameFromPath = (path: string): string => {
  return path.substring(path.lastIndexOf('/') + 1);
};

const toPathItemPayload = (path: string, stats: Stats): PathItemPayload => {
  return {
    filename: getFilenameFromPath(path),
    longname: '',
    attrs: {
      size: stats.size,
      uid: stats.uid,
      gid: stats.gid,
      mode: stats.mode,
      atime: stats.atime * 1000,
      mtime: stats.mtime * 1000,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      isSymbolicLink: stats.isSymbolicLink(),
    },
  };
};

export const executeMkdirPathOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string
): Promise<void> => {
  if (!state || !state.sftp) {
    console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 mkdir (ID: ${requestId})`);
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:mkdir:error',
        path,
        payload: 'SFTP 会话未就绪',
        requestId,
      })
    );
    return;
  }

  const { sftp } = state;
  console.debug(`[SFTP ${sessionId}] Received mkdir request for ${path} (ID: ${requestId})`);
  try {
    sftp.mkdir(path, (err) => {
      if (err) {
        console.error(`[SFTP ${sessionId}] mkdir ${path} failed (ID: ${requestId}):`, err);
        state.ws.send(
          JSON.stringify({
            type: 'sftp:mkdir:error',
            path,
            payload: `创建目录失败: ${err.message}`,
            requestId,
          })
        );
        return;
      }

      console.debug(
        `[SFTP ${sessionId}] mkdir ${path} success (ID: ${requestId}). Fetching stats...`
      );
      sftp.lstat(path, (statErr, stats) => {
        if (statErr) {
          console.error(
            `[SFTP ${sessionId}] lstat after mkdir ${path} failed (ID: ${requestId}):`,
            statErr
          );
          state.ws.send(
            JSON.stringify({
              type: 'sftp:mkdir:success',
              path,
              payload: null,
              requestId,
            })
          );
          return;
        }

        state.ws.send(
          JSON.stringify({
            type: 'sftp:mkdir:success',
            path,
            payload: toPathItemPayload(path, stats),
            requestId,
          })
        );
      });
    });
  } catch (error: unknown) {
    console.error(
      `[SFTP ${sessionId}] mkdir ${path} caught unexpected error (ID: ${requestId}):`,
      error
    );
    state.ws.send(
      JSON.stringify({
        type: 'sftp:mkdir:error',
        path,
        payload: `创建目录时发生意外错误: ${getErrorMessage(error)}`,
        requestId,
      })
    );
  }
};

export const executeRmdirPathOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string
): Promise<void> => {
  if (!state || !state.sshClient) {
    console.warn(
      `[SSH Exec] SSH 客户端未准备好，无法在 ${sessionId} 上执行 rmdir (ID: ${requestId})`
    );
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:rmdir:error',
        path,
        payload: 'SSH 会话未就绪',
        requestId,
      })
    );
    return;
  }

  console.debug(`[SSH Exec ${sessionId}] Received rmdir request for ${path} (ID: ${requestId})`);
  const command = `rm -rf '${path.replace(/'/g, "'\\''")}'`;

  console.debug(`[SSH Exec ${sessionId}] 尝试使用 rm -rf 命令删除 ${path} (ID: ${requestId})`);
  console.debug(`[SSH Exec ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

  try {
    state.sshClient.exec(command, (err, stream) => {
      if (err) {
        console.error(
          `[SSH Exec ${sessionId}] Failed to start exec for rm -rf ${path} (ID: ${requestId}):`,
          err
        );
        state.ws.send(
          JSON.stringify({
            type: 'sftp:rmdir:error',
            path,
            payload: `删除目录失败: rm -rf 命令执行失败: ${err.message}`,
            requestId,
          })
        );
        return;
      }

      let stderrOutput = '';
      stream.stderr.on('data', (data: Buffer) => {
        stderrOutput += data.toString();
      });

      stream.on('close', (code: number | null, signal: string | null) => {
        if (code === 0) {
          console.debug(
            `[SSH Exec ${sessionId}] rm -rf ${path} command executed successfully (ID: ${requestId})`
          );
          state.ws.send(JSON.stringify({ type: 'sftp:rmdir:success', path, requestId }));
          return;
        }

        const errorMessage =
          stderrOutput.trim() ||
          `命令退出，代码: ${code ?? 'N/A'}${signal ? `, 信号: ${signal}` : ''}`;
        console.error(
          `[SSH Exec ${sessionId}] rm -rf ${path} command failed (ID: ${requestId}). Code: ${code}, Signal: ${signal}, Stderr: ${errorMessage}`
        );
        state.ws.send(
          JSON.stringify({
            type: 'sftp:rmdir:error',
            path,
            payload: `删除目录失败: ${errorMessage}`,
            requestId,
          })
        );
      });

      stream.on('data', (data: Buffer) => {
        console.debug(
          `[SSH Exec ${sessionId}] rm -rf stdout (ID: ${requestId}): ${data.toString()}`
        );
      });
    });
  } catch (error: unknown) {
    console.error(
      `[SSH Exec ${sessionId}] rm -rf ${path} caught unexpected error during exec setup (ID: ${requestId}):`,
      error
    );
    state.ws.send(
      JSON.stringify({
        type: 'sftp:rmdir:error',
        path,
        payload: `删除目录失败: rm -rf 执行时发生意外错误: ${getErrorMessage(error)}`,
        requestId,
      })
    );
  }
};

export const executeUnlinkPathOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string
): Promise<void> => {
  if (!state || !state.sftp) {
    console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 unlink (ID: ${requestId})`);
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:unlink:error',
        path,
        payload: 'SFTP 会话未就绪',
        requestId,
      })
    );
    return;
  }

  console.debug(`[SFTP ${sessionId}] Received unlink request for ${path} (ID: ${requestId})`);
  try {
    state.sftp.unlink(path, (err) => {
      if (err) {
        console.error(`[SFTP ${sessionId}] unlink ${path} failed (ID: ${requestId}):`, err);
        state.ws.send(
          JSON.stringify({
            type: 'sftp:unlink:error',
            path,
            payload: `删除文件失败: ${err.message}`,
            requestId,
          })
        );
        return;
      }

      console.debug(`[SFTP ${sessionId}] unlink ${path} success (ID: ${requestId})`);
      state.ws.send(JSON.stringify({ type: 'sftp:unlink:success', path, requestId }));
    });
  } catch (error: unknown) {
    console.error(
      `[SFTP ${sessionId}] unlink ${path} caught unexpected error (ID: ${requestId}):`,
      error
    );
    state.ws.send(
      JSON.stringify({
        type: 'sftp:unlink:error',
        path,
        payload: `删除文件时发生意外错误: ${getErrorMessage(error)}`,
        requestId,
      })
    );
  }
};

export const executeRenamePathOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  oldPath: string,
  newPath: string,
  requestId: string
): Promise<void> => {
  if (!state || !state.sftp) {
    console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 rename (ID: ${requestId})`);
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:rename:error',
        oldPath,
        newPath,
        payload: 'SFTP 会话未就绪',
        requestId,
      })
    );
    return;
  }

  const { sftp } = state;
  console.debug(
    `[SFTP ${sessionId}] Received rename request ${oldPath} -> ${newPath} (ID: ${requestId})`
  );
  try {
    sftp.rename(oldPath, newPath, (err) => {
      if (err) {
        console.error(
          `[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} failed (ID: ${requestId}):`,
          err
        );
        state.ws.send(
          JSON.stringify({
            type: 'sftp:rename:error',
            oldPath,
            newPath,
            payload: `重命名/移动失败: ${err.message}`,
            requestId,
          })
        );
        return;
      }

      console.debug(
        `[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} success (ID: ${requestId}). Fetching stats for new path...`
      );
      sftp.lstat(newPath, (statErr, stats) => {
        if (statErr) {
          console.error(
            `[SFTP ${sessionId}] lstat after rename ${newPath} failed (ID: ${requestId}):`,
            statErr
          );
          state.ws.send(
            JSON.stringify({
              type: 'sftp:rename:success',
              payload: { oldPath, newPath, newItem: null },
              requestId,
            })
          );
          return;
        }

        state.ws.send(
          JSON.stringify({
            type: 'sftp:rename:success',
            payload: { oldPath, newPath, newItem: toPathItemPayload(newPath, stats) },
            requestId,
          })
        );
      });
    });
  } catch (error: unknown) {
    console.error(
      `[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} caught unexpected error (ID: ${requestId}):`,
      error
    );
    state.ws.send(
      JSON.stringify({
        type: 'sftp:rename:error',
        oldPath,
        newPath,
        payload: `重命名/移动时发生意外错误: ${getErrorMessage(error)}`,
        requestId,
      })
    );
  }
};
