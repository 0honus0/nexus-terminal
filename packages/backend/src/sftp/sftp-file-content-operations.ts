import { Stats } from 'ssh2';
import * as iconv from 'iconv-lite';
import type { ClientState } from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import { detectAndDecodeSftpFileContent } from './sftp-encoding.utils';

interface FileItemPayload {
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

const toFileItemPayload = (path: string, stats: Stats): FileItemPayload => {
  return {
    filename: path.substring(path.lastIndexOf('/') + 1),
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

export const executeReadFileContentOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string,
  requestedEncoding?: string
): Promise<void> => {
  if (!state || !state.sftp) {
    console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readFile (ID: ${requestId})`);
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:readfile:error',
        path,
        payload: 'SFTP 会话未就绪',
        requestId,
      })
    );
    return;
  }

  const { sftp } = state;
  console.debug(
    `[SFTP ${sessionId}] Received readFile request for ${path} (ID: ${requestId}, Requested Encoding: ${requestedEncoding ?? 'auto'})`
  );

  try {
    const readStream = sftp.createReadStream(path);
    let fileData = Buffer.alloc(0);
    let errorOccurred = false;

    readStream.on('data', (chunk: Buffer) => {
      fileData = Buffer.concat([fileData, chunk]);
    });

    readStream.on('error', (err: Error) => {
      if (errorOccurred) {
        return;
      }
      errorOccurred = true;
      console.error(`[SFTP ${sessionId}] readFile ${path} stream error (ID: ${requestId}):`, err);
      state.ws.send(
        JSON.stringify({
          type: 'sftp:readfile:error',
          path,
          payload: `读取文件流错误: ${err.message}`,
          requestId,
        })
      );
    });

    readStream.on('end', () => {
      if (errorOccurred) {
        return;
      }

      console.debug(
        `[SFTP ${sessionId}] readFile ${path} success, size: ${fileData.length} bytes (ID: ${requestId}). Processing content...`
      );
      let encodingUsed = 'utf-8';
      try {
        const decodeResult = detectAndDecodeSftpFileContent({
          fileData,
          requestedEncoding,
          sessionId,
          remotePath: path,
          requestId,
        });
        encodingUsed = decodeResult.encodingUsed;
        console.debug(
          `[SFTP ${sessionId}] Content decoding completed with encoding ${encodingUsed} (ID: ${requestId}).`
        );
      } catch (decodeError: unknown) {
        console.error(
          `[SFTP ${sessionId}] Error detecting/decoding file content for ${path} (ID: ${requestId}):`,
          decodeError
        );
        state.ws.send(
          JSON.stringify({
            type: 'sftp:readfile:error',
            path,
            payload: `文件编码检测或转换失败: ${getErrorMessage(decodeError)}`,
            requestId,
          })
        );
        return;
      }

      state.ws.send(
        JSON.stringify({
          type: 'sftp:readfile:success',
          path,
          payload: {
            rawContentBase64: fileData.toString('base64'),
            encodingUsed,
          },
          requestId,
        })
      );
    });
  } catch (error: unknown) {
    console.error(
      `[SFTP ${sessionId}] readFile ${path} caught unexpected error (ID: ${requestId}):`,
      error
    );
    state.ws.send(
      JSON.stringify({
        type: 'sftp:readfile:error',
        path,
        payload: `读取文件时发生意外错误: ${getErrorMessage(error)}`,
        requestId,
      })
    );
  }
};

export const executeWriteFileContentOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  data: string,
  requestId: string,
  encoding?: string
): Promise<void> => {
  if (!state || !state.sftp) {
    console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 writefile (ID: ${requestId})`);
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:writefile:error',
        path,
        payload: 'SFTP 会话未就绪',
        requestId,
      })
    );
    return;
  }

  const { sftp } = state;
  const targetEncoding = encoding || 'utf-8';
  console.debug(
    `[SFTP ${sessionId}] Received writefile request for ${path} (ID: ${requestId}, Encoding: ${targetEncoding})`
  );

  try {
    let buffer: Buffer;
    try {
      buffer = iconv.encode(data, targetEncoding);
      console.debug(
        `[SFTP ${sessionId}] Encoded content for ${path} using ${targetEncoding} (Buffer size: ${buffer.length})`
      );
    } catch (encodeError: unknown) {
      console.error(
        `[SFTP ${sessionId}] Failed to encode content for ${path} with encoding ${targetEncoding} (ID: ${requestId}):`,
        encodeError
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:writefile:error',
          path,
          payload: `无效的编码或编码失败: ${targetEncoding}`,
          requestId,
        })
      );
      return;
    }

    let originalMode: number | undefined;
    try {
      const fileStats = await new Promise<Stats>((resolve, reject) => {
        sftp.lstat(path, (err, lstatStats) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(lstatStats);
        });
      });
      originalMode = fileStats.mode;
      console.debug(
        `[SFTP ${sessionId}] Retrieved original file mode for ${path}: ${originalMode.toString(8)} (ID: ${requestId})`
      );
    } catch (statError: unknown) {
      console.warn(
        `[SFTP ${sessionId}] Could not retrieve original file mode for ${path} (ID: ${requestId}):`,
        statError
      );
    }

    const writeStreamOptions = originalMode !== undefined ? { mode: originalMode } : {};
    const writeStream = sftp.createWriteStream(path, writeStreamOptions);
    let errorOccurred = false;

    writeStream.on('error', (err: Error) => {
      if (errorOccurred) {
        return;
      }
      errorOccurred = true;
      console.error(`[SFTP ${sessionId}] writefile ${path} stream error (ID: ${requestId}):`, err);
      state.ws.send(
        JSON.stringify({
          type: 'sftp:writefile:error',
          path,
          payload: `写入文件流错误: ${err.message}`,
          requestId,
        })
      );
    });

    writeStream.on('close', () => {
      if (errorOccurred) {
        return;
      }

      if (originalMode !== undefined) {
        console.debug(
          `[SFTP ${sessionId}] Set file mode for ${path} during creation: ${originalMode.toString(8)} (ID: ${requestId})`
        );
      }

      sftp.lstat(path, (statErr, stats) => {
        if (statErr) {
          console.error(
            `[SFTP ${sessionId}] lstat after writefile ${path} failed (ID: ${requestId}):`,
            statErr
          );
          state.ws.send(
            JSON.stringify({
              type: 'sftp:writefile:success',
              path,
              payload: null,
              requestId,
            })
          );
          return;
        }

        state.ws.send(
          JSON.stringify({
            type: 'sftp:writefile:success',
            path,
            payload: toFileItemPayload(path, stats),
            requestId,
          })
        );
      });
    });

    console.debug(
      `[SFTP ${sessionId}] Writing ${buffer.length} bytes to ${path} (ID: ${requestId})`
    );
    writeStream.end(buffer);
    console.debug(`[SFTP ${sessionId}] writefile ${path} end() called (ID: ${requestId})`);
  } catch (error: unknown) {
    console.error(
      `[SFTP ${sessionId}] writefile ${path} caught unexpected error (ID: ${requestId}):`,
      error
    );
    state.ws.send(
      JSON.stringify({
        type: 'sftp:writefile:error',
        path,
        payload: `写入文件时发生意外错误: ${getErrorMessage(error)}`,
        requestId,
      })
    );
  }
};
