import type { SFTPWrapper, Stats } from 'ssh2';
import * as pathModule from 'path';
import type { ClientState } from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import type { FileListItem } from './sftp-utils';
import { getErrorCode } from './sftp-error.utils';

type MkdirWithRecursive = (
  path: string,
  attrs: { recursive?: boolean },
  callback: (err?: Error | undefined) => void
) => void;

interface SftpDirEntry {
  filename: string;
  longname: string;
  attrs: Stats;
}

export const executeCopyOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  sources: string[],
  destinationDir: string,
  requestId: string
): Promise<void> => {
  if (!state || !state.sftp) {
    console.warn(`[SFTP Copy] SFTP 未准备好，无法在 ${sessionId} 上执行 copy (ID: ${requestId})`);
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:copy:error',
        payload: 'SFTP 会话未就绪',
        requestId,
      })
    );
    return;
  }

  const { sftp } = state;
  console.debug(
    `[SFTP ${sessionId}] Received copy request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`
  );

  const copiedItemsDetails: FileListItem[] = [];
  let firstError: Error | null = null;

  try {
    try {
      await ensureDirectoryExists(sftp, destinationDir);
    } catch (ensureErr: unknown) {
      console.error(
        `[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists (ID: ${requestId}):`,
        ensureErr
      );
      throw new Error(`无法创建或访问目标目录: ${getErrorMessage(ensureErr)}`);
    }

    for (const sourcePath of sources) {
      try {
        const copiedItem = await copySingleItem(
          sftp,
          sourcePath,
          destinationDir,
          sessionId,
          requestId
        );
        if (copiedItem) {
          copiedItemsDetails.push(copiedItem);
        }
      } catch (copyErr: unknown) {
        const sourceName = pathModule.basename(sourcePath);
        const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/');
        console.error(
          `[SFTP ${sessionId}] Error copying ${sourcePath} to ${destPath} (ID: ${requestId}):`,
          copyErr
        );
        firstError = copyErr instanceof Error ? copyErr : new Error(getErrorMessage(copyErr));
        break;
      }
    }

    if (firstError) {
      throw firstError;
    }

    console.info(
      `[SFTP ${sessionId}] Copy operation completed successfully (ID: ${requestId}). Copied items: ${copiedItemsDetails.length}`
    );
    state.ws.send(
      JSON.stringify({
        type: 'sftp:copy:success',
        payload: { destination: destinationDir, items: copiedItemsDetails },
        requestId,
      })
    );
  } catch (error: unknown) {
    console.error(`[SFTP ${sessionId}] Copy operation failed (ID: ${requestId}):`, error);
    state.ws.send(
      JSON.stringify({
        type: 'sftp:copy:error',
        payload: `复制操作失败: ${getErrorMessage(error)}`,
        requestId,
      })
    );
  }
};

export const copySingleItem = async (
  sftp: SFTPWrapper,
  sourcePath: string,
  destinationDir: string,
  sessionId: string,
  requestId: string
): Promise<FileListItem | null> => {
  const sourceName = pathModule.basename(sourcePath);
  const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/');

  if (sourcePath === destPath) {
    console.warn(
      `[SFTP ${sessionId}] Skipping copy: source and destination are the same (${sourcePath}) (ID: ${requestId})`
    );
    return null;
  }

  const stats = await getStats(sftp, sourcePath);
  if (stats.isDirectory()) {
    console.debug(
      `[SFTP ${sessionId}] Copying directory ${sourcePath} to ${destPath} (ID: ${requestId})`
    );
    await copyDirectoryRecursive(sftp, sourcePath, destPath);
  } else if (stats.isFile()) {
    console.debug(
      `[SFTP ${sessionId}] Copying file ${sourcePath} to ${destPath} (ID: ${requestId})`
    );
    await copyFile(sftp, sourcePath, destPath);
  } else {
    console.warn(
      `[SFTP ${sessionId}] Skipping copy of unsupported file type: ${sourcePath} (ID: ${requestId})`
    );
    return null;
  }

  const copiedStats = await getStats(sftp, destPath);
  return formatStatsToFileListItem(destPath, copiedStats);
};

export const copyFile = (
  sftp: SFTPWrapper,
  sourcePath: string,
  destPath: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const readStream = sftp.createReadStream(sourcePath);
    const writeStream = sftp.createWriteStream(destPath);
    let errorOccurred = false;

    const onError = (err: Error) => {
      if (errorOccurred) {
        return;
      }
      errorOccurred = true;
      readStream.destroy();
      writeStream.destroy();
      console.error(`Error copying file ${sourcePath} to ${destPath}:`, err);
      reject(new Error(`复制文件失败: ${err.message}`));
    };

    readStream.on('error', onError);
    writeStream.on('error', onError);
    writeStream.on('close', () => {
      if (!errorOccurred) {
        resolve();
      }
    });

    readStream.pipe(writeStream);
  });
};

export const copyDirectoryRecursive = async (
  sftp: SFTPWrapper,
  sourcePath: string,
  destPath: string
): Promise<void> => {
  try {
    await ensureDirectoryExists(sftp, destPath);
    const items = await listDirectory(sftp, sourcePath);

    for (const item of items) {
      const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
      const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
      const itemStats = item.attrs;

      if (itemStats.isDirectory()) {
        await copyDirectoryRecursive(sftp, currentSourcePath, currentDestPath);
      } else if (itemStats.isFile()) {
        await copyFile(sftp, currentSourcePath, currentDestPath);
      } else {
        console.warn(`[SFTP Copy Recurse] Skipping unsupported type: ${currentSourcePath}`);
      }
    }
  } catch (error: unknown) {
    console.error(`Error recursively copying directory ${sourcePath} to ${destPath}:`, error);
    throw new Error(`递归复制目录失败: ${getErrorMessage(error)}`);
  }
};

export const getStats = (sftp: SFTPWrapper, path: string): Promise<Stats> => {
  return new Promise((resolve, reject) => {
    sftp.lstat(path, (err, stats) => {
      if (err) {
        reject(err);
      } else {
        resolve(stats);
      }
    });
  });
};

export const ensureDirectoryExists = async (sftp: SFTPWrapper, dirPath: string): Promise<void> => {
  const normalizedPath = dirPath.replace(/\/$/, '');
  if (!normalizedPath || normalizedPath === '/') {
    return;
  }

  try {
    await getStats(sftp, normalizedPath);
  } catch (statError: unknown) {
    const statErrCode = getErrorCode(statError);
    const statErrMsg = getErrorMessage(statError);
    if (statErrCode === 'ENOENT' || statErrMsg.includes('No such file')) {
      try {
        const mkdirWithRecursive = sftp.mkdir as unknown as MkdirWithRecursive;
        await new Promise<void>((resolveMkdir, rejectMkdir) => {
          mkdirWithRecursive(normalizedPath, { recursive: true }, (mkdirErr) => {
            if (mkdirErr) {
              console.warn(
                `[SFTP Util] Recursive mkdir failed for ${normalizedPath}, falling back to iterative creation:`,
                mkdirErr
              );
              rejectMkdir(mkdirErr);
            } else {
              console.debug(`[SFTP Util] Recursively created directory: ${normalizedPath}`);
              resolveMkdir();
            }
          });
        });
      } catch {
        const parentDir = pathModule.dirname(normalizedPath).replace(/\\/g, '/');
        if (parentDir && parentDir !== '/' && parentDir !== '.') {
          await ensureDirectoryExists(sftp, parentDir);
        }

        try {
          await new Promise<void>((resolveMkdir, rejectMkdir) => {
            sftp.mkdir(normalizedPath, (mkdirErr) => {
              if (mkdirErr) {
                rejectMkdir(new Error(`创建目录失败 ${normalizedPath}: ${mkdirErr.message}`));
              } else {
                console.debug(`[SFTP Util] Iteratively created directory: ${normalizedPath}`);
                resolveMkdir();
              }
            });
          });
        } catch (iterativeMkdirError: unknown) {
          console.error(
            `[SFTP Util] Iterative mkdir failed for ${normalizedPath}:`,
            iterativeMkdirError
          );
          try {
            const finalStats = await getStats(sftp, normalizedPath);
            if (!finalStats.isDirectory()) {
              throw new Error(`路径 ${normalizedPath} 已存在但不是目录`);
            }
            console.debug(
              `[SFTP Util] Directory ${normalizedPath} exists after iterative mkdir failure, likely created concurrently.`
            );
          } catch {
            throw iterativeMkdirError;
          }
        }
      }
    } else {
      throw new Error(`检查目录失败 ${normalizedPath}: ${statErrMsg}`);
    }
  }
};

const listDirectory = (sftp: SFTPWrapper, path: string): Promise<SftpDirEntry[]> => {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) {
        reject(err);
      } else {
        resolve(list);
      }
    });
  });
};

export const formatStatsToFileListItem = (itemPath: string, stats: Stats): FileListItem => {
  return {
    filename: pathModule.basename(itemPath),
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
