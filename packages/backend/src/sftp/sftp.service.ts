import { Client, SFTPWrapper, Stats, WriteStream } from 'ssh2';
import { WebSocket } from 'ws';
import * as pathModule from 'path';
import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';
import {
  ClientState,
  AuthenticatedWebSocket,
  SftpCompressRequestPayload,
  SftpCompressSuccessPayload,
  SftpCompressErrorPayload,
  SftpDecompressRequestPayload,
  SftpDecompressSuccessPayload,
  SftpDecompressErrorPayload,
} from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import { SftpUploadManager } from './sftp-upload.manager';
import { SftpArchiveManager } from './sftp-archive.manager';
import { SftpUtils, type FileListItem } from './sftp-utils';

// +++ Define local interface for readdir results +++
interface SftpDirEntry {
  filename: string;
  longname: string;
  attrs: Stats;
}

// 定义服务器状态的数据结构 (与前端 StatusMonitor.vue 匹配)
// Note: This interface seems out of place here, but keeping it for now as it was in the original file.
// Ideally, it should be in a shared types file.
interface ServerStatus {
  cpuPercent?: number;
  memPercent?: number;
  memUsed?: number; // MB
  memTotal?: number; // MB
  swapPercent?: number;
  swapUsed?: number; // MB
  swapTotal?: number; // MB
  diskPercent?: number;
  diskUsed?: number; // KB
  diskTotal?: number; // KB
  cpuModel?: string;
  netRxRate?: number; // Bytes per second
  netTxRate?: number; // Bytes per second
  netInterface?: string;
  osName?: string;
  loadAvg?: number[]; // 系统平均负载 [1min, 5min, 15min]
  timestamp: number; // 状态获取时间戳
}

// Interface for parsed network stats - Also seems out of place here.
interface NetworkStats {
  [interfaceName: string]: {
    rx_bytes: number;
    tx_bytes: number;
  };
}

// Note: These constants seem related to StatusMonitorService, not SftpService.
const DEFAULT_POLLING_INTERVAL = 1000;
const previousNetStats = new Map<string, { rx: number; tx: number; timestamp: number }>();

export class SftpService {
  private clientStates: Map<string, ClientState>;
  private uploadManager: SftpUploadManager;
  private archiveManager: SftpArchiveManager;

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
    this.uploadManager = new SftpUploadManager(clientStates);
    this.archiveManager = new SftpArchiveManager(clientStates);
  }

  /**
   * 初始化 SFTP 会话
   * @param sessionId 会话 ID
   */
  async initializeSftpSession(sessionId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
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
      state.sshClient.sftp((err, sftpInstance) => {
        if (err) {
          console.error(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话失败:`, err);
          state.ws.send(
            JSON.stringify({
              type: 'sftp_error',
              payload: { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' },
            })
          );
          reject(err);
        } else {
          console.log(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话成功。`);
          state.sftp = sftpInstance;
          state.ws.send(
            JSON.stringify({ type: 'sftp_ready', payload: { connectionId: state.dbConnectionId } })
          );
          sftpInstance.on('end', () => {
            console.log(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已结束。`);
            if (state) state.sftp = undefined;
          });
          sftpInstance.on('close', () => {
            console.log(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已关闭。`);
            if (state) state.sftp = undefined;
          });
          sftpInstance.on('error', (sftpErr: Error) => {
            console.error(`[SFTP] 会话 ${sessionId} 的 SFTP 会话出错:`, sftpErr);
            if (state) state.sftp = undefined;
            state?.ws.send(
              JSON.stringify({
                type: 'sftp_error',
                payload: { connectionId: state.dbConnectionId, message: 'SFTP 会话错误' },
              })
            );
          });
          resolve();
        }
      });
    });
  }

  /**
   * 清理 SFTP 会话
   * @param sessionId 会话 ID
   */
  cleanupSftpSession(sessionId: string): void {
    const state = this.clientStates.get(sessionId);
    if (state?.sftp) {
      console.log(`[SFTP] 正在清理 ${sessionId} 的 SFTP 会话...`);
      state.sftp.end();
      state.sftp = undefined;
    }
    // Delegate upload cleanup to SftpUploadManager
    this.uploadManager.cleanupSessionUploads(sessionId);
  }

  // --- SFTP 操作方法 ---

  /** 读取目录内容 */
  async readdir(sessionId: string, path: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
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
      state.sftp.readdir(path, (err, list) => {
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
        } else {
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
        }
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
  }

  /** 获取文件/目录状态信息 */
  async stat(sessionId: string, path: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 stat (ID: ${requestId})`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:stat:error',
          path,
          payload: 'SFTP 会话未就绪',
          requestId,
        })
      ); // Use specific error type
      return;
    }
    console.debug(`[SFTP ${sessionId}] Received stat request for ${path} (ID: ${requestId})`);
    try {
      state.sftp.lstat(path, (err, stats: Stats) => {
        if (err) {
          console.error(`[SFTP ${sessionId}] stat ${path} failed (ID: ${requestId}):`, err);
          state.ws.send(
            JSON.stringify({
              type: 'sftp:stat:error',
              path,
              payload: `获取状态失败: ${err.message}`,
              requestId,
            })
          );
        } else {
          const fileStats = {
            size: stats.size,
            uid: stats.uid,
            gid: stats.gid,
            mode: stats.mode,
            atime: stats.atime * 1000,
            mtime: stats.mtime * 1000,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            isSymbolicLink: stats.isSymbolicLink(),
          };
          // Send specific success type
          state.ws.send(
            JSON.stringify({
              type: 'sftp:stat:success',
              path,
              payload: fileStats,
              requestId,
            })
          );
        }
      });
    } catch (error: unknown) {
      console.error(
        `[SFTP ${sessionId}] stat ${path} caught unexpected error (ID: ${requestId}):`,
        error
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:stat:error',
          path,
          payload: `获取状态时发生意外错误: ${getErrorMessage(error)}`,
          requestId,
        })
      );
    }
  }

  /** 读取文件内容 (支持指定编码) */
  async readFile(
    sessionId: string,
    path: string,
    requestId: string,
    requestedEncoding?: string
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
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
    console.debug(
      `[SFTP ${sessionId}] Received readFile request for ${path} (ID: ${requestId}, Requested Encoding: ${requestedEncoding ?? 'auto'})`
    );
    try {
      const readStream = state.sftp.createReadStream(path);
      let fileData = Buffer.alloc(0);
      let errorOccurred = false;

      readStream.on('data', (chunk: Buffer) => {
        fileData = Buffer.concat([fileData, chunk]);
      });
      readStream.on('error', (err: Error) => {
        if (errorOccurred) return;
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
        if (errorOccurred) return;

        console.log(
          `[SFTP ${sessionId}] readFile ${path} success, size: ${fileData.length} bytes (ID: ${requestId}). Processing content...`
        );
        let encodingUsed: string = 'utf-8'; // Default encoding
        let decodedContent: string = '';
        let decodeError: string | null = null;

        try {
          if (requestedEncoding) {
            // 用户指定了编码
            encodingUsed = requestedEncoding;
            console.log(
              `[SFTP ${sessionId}] Using requested encoding: ${encodingUsed} (ID: ${requestId})`
            );
            const normalizedEncoding = encodingUsed.toLowerCase().replace(/[^a-z0-9]/g, ''); // Normalize more aggressively
            if (iconv.encodingExists(normalizedEncoding)) {
              decodedContent = iconv.decode(fileData, normalizedEncoding);
              encodingUsed = normalizedEncoding; // Use the normalized name if valid
            } else {
              console.warn(
                `[SFTP ${sessionId}] Requested encoding "${requestedEncoding}" is not supported by iconv-lite. Falling back to UTF-8. (ID: ${requestId})`
              );
              encodingUsed = 'utf-8'; // Fallback
              decodedContent = iconv.decode(fileData, encodingUsed);
              // Optionally add a warning?
            }
          } else {
            // 自动检测编码
            console.log(`[SFTP ${sessionId}] Detecting encoding for ${path} (ID: ${requestId})`);
            const detection = jschardet.detect(fileData);
            const detectedEncodingRaw = detection.encoding
              ? detection.encoding.toLowerCase()
              : 'utf-8'; // Default to utf-8 if detection fails
            const confidence = detection.confidence || 0;
            console.log(
              `[SFTP ${sessionId}] Detected encoding: ${detectedEncodingRaw} (confidence: ${confidence})`
            );

            const chineseEncodings = ['gbk', 'gb2312', 'gb18030', 'big5', 'euc-tw'];
            let normalizedDetected = detectedEncodingRaw.replace(/[^a-z0-9]/g, '');
            if (normalizedDetected === 'windows1252') normalizedDetected = 'cp1252';
            else if (normalizedDetected === 'gb2312') normalizedDetected = 'gbk'; // Prefer gbk

            if (normalizedDetected === 'utf8' || normalizedDetected === 'ascii') {
              encodingUsed = 'utf-8';
              decodedContent = fileData.toString('utf8');
              console.log(`[SFTP ${sessionId}] Decoded ${path} as UTF-8/ASCII.`);
            } else if (chineseEncodings.includes(normalizedDetected)) {
              // If detected as a common Chinese encoding, trust it and use gb18030 for broader compatibility
              encodingUsed = 'gb18030'; // Report gb18030 as used
              decodedContent = iconv.decode(fileData, encodingUsed);
              console.log(
                `[SFTP ${sessionId}] Decoded ${path} from detected Chinese encoding (${normalizedDetected}) as ${encodingUsed}.`
              );
            } else if (confidence < 0.9) {
              // Low confidence threshold
              console.warn(
                `[SFTP ${sessionId}] Low confidence detection (${normalizedDetected}, ${confidence}) for ${path}. Attempting GB18030 decode first.`
              );
              try {
                // Try decoding as GB18030 first
                const tempContent = iconv.decode(fileData, 'gb18030');
                // Basic check for Mojibake
                if (tempContent.includes('\uFFFD')) {
                  console.warn(
                    `[SFTP ${sessionId}] GB18030 decoding resulted in replacement characters. Falling back to original detection (${normalizedDetected}) or UTF-8.`
                  );
                  // Fallback: Try the originally detected encoding if supported, otherwise UTF-8
                  if (iconv.encodingExists(normalizedDetected)) {
                    encodingUsed = normalizedDetected;
                    decodedContent = iconv.decode(fileData, encodingUsed);
                    console.log(
                      `[SFTP ${sessionId}] Falling back to decoding ${path} as originally detected ${encodingUsed}.`
                    );
                  } else {
                    encodingUsed = 'utf-8';
                    decodedContent = fileData.toString('utf8');
                    console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as UTF-8.`);
                  }
                } else {
                  encodingUsed = 'gb18030'; // Success with GB18030
                  decodedContent = tempContent;
                  console.log(
                    `[SFTP ${sessionId}] Decoded ${path} as ${encodingUsed} due to low confidence detection.`
                  );
                }
              } catch (gbkError: unknown) {
                console.warn(
                  `[SFTP ${sessionId}] Error decoding as GB18030, falling back to original detection (${normalizedDetected}) or UTF-8: ${getErrorMessage(gbkError)}`
                );
                // Fallback: Try the originally detected encoding if supported, otherwise UTF-8
                if (iconv.encodingExists(normalizedDetected)) {
                  encodingUsed = normalizedDetected;
                  decodedContent = iconv.decode(fileData, encodingUsed);
                  console.log(
                    `[SFTP ${sessionId}] Falling back to decoding ${path} as originally detected ${encodingUsed}.`
                  );
                } else {
                  encodingUsed = 'utf-8';
                  decodedContent = fileData.toString('utf8');
                  console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as UTF-8.`);
                }
              }
            } else if (iconv.encodingExists(normalizedDetected)) {
              // Higher confidence, non-Chinese, supported encoding
              encodingUsed = normalizedDetected;
              decodedContent = iconv.decode(fileData, encodingUsed);
              console.log(
                `[SFTP ${sessionId}] Decoded ${path} from ${encodingUsed} using iconv-lite (high confidence).`
              );
            } else {
              console.warn(
                `[SFTP ${sessionId}] Unsupported or unknown encoding detected for ${path}: ${normalizedDetected}. Falling back to UTF-8.`
              );
              encodingUsed = 'utf-8'; // Final fallback
              decodedContent = fileData.toString('utf8');
            }
          }

          // Final check for replacement characters after deciding the encoding
          if (decodedContent.includes('\uFFFD')) {
            console.warn(
              `[SFTP ${sessionId}] Final decoded content for ${path} (using ${encodingUsed}) contains replacement characters (U+FFFD). Decoding might be incorrect. (ID: ${requestId})`
            );
            // decodeError = `解码内容可能不正确 (使用 ${encodingUsed})，检测到无效字符。`; // Optionally set error
          }
        } catch (err: unknown) {
          console.error(
            `[SFTP ${sessionId}] Error detecting/decoding file content for ${path} (ID: ${requestId}):`,
            err
          );
          decodeError = `文件编码检测或转换失败: ${getErrorMessage(err)}`;
          state.ws.send(
            JSON.stringify({
              type: 'sftp:readfile:error',
              path,
              payload: decodeError,
              requestId,
            })
          );
          return; // Stop processing
        }

        // 发送 Base64 编码的原始数据和实际使用的编码
        console.log(
          `[SFTP ${sessionId}] Sending raw content (Base64) and encoding used (${encodingUsed}) for ${path} (ID: ${requestId})`
        );
        state.ws.send(
          JSON.stringify({
            type: 'sftp:readfile:success',
            path,
            payload: {
              rawContentBase64: fileData.toString('base64'), // 发送 Base64 字符串
              encodingUsed, // 发送实际使用的编码
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
  }

  /** 写入文件内容 (支持指定编码) */
  // --- 修改：添加 encoding 参数 ---
  async writefile(
    sessionId: string,
    path: string,
    data: string,
    requestId: string,
    encoding?: string
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
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
    // --- 修改：使用传入的 encoding 或默认 utf-8 ---
    const targetEncoding = encoding || 'utf-8';
    console.debug(
      `[SFTP ${sessionId}] Received writefile request for ${path} (ID: ${requestId}, Encoding: ${targetEncoding})`
    );
    try {
      // --- 修改：使用 iconv-lite 根据指定编码创建 Buffer ---
      let buffer: Buffer;
      try {
        buffer = iconv.encode(data, targetEncoding);
        console.log(
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

      // 获取文件当前权限
      let originalMode: number | undefined;
      try {
        const stats = await new Promise<Stats>((resolve, reject) => {
          state.sftp!.lstat(path, (err, stats) => {
            if (err) {
              reject(err);
            } else {
              resolve(stats);
            }
          });
        });
        originalMode = stats.mode;
        console.log(
          `[SFTP ${sessionId}] Retrieved original file mode for ${path}: ${originalMode.toString(8)} (ID: ${requestId})`
        );
      } catch (statError: unknown) {
        console.warn(
          `[SFTP ${sessionId}] Could not retrieve original file mode for ${path} (ID: ${requestId}):`,
          statError
        );
        // 如果文件不存在或其他错误，继续写入操作，不设置权限
      }

      console.debug(`[SFTP ${sessionId}] Creating write stream for ${path} (ID: ${requestId})`);
      // 在创建写入流时设置文件权限
      const writeStreamOptions = originalMode !== undefined ? { mode: originalMode } : {};
      const writeStream = state.sftp.createWriteStream(path, writeStreamOptions);
      let errorOccurred = false;

      writeStream.on('error', (err: Error) => {
        if (errorOccurred) return; // Prevent sending multiple errors
        errorOccurred = true;
        console.error(
          `[SFTP ${sessionId}] writefile ${path} stream error (ID: ${requestId}):`,
          err
        );
        state.ws.send(
          JSON.stringify({
            type: 'sftp:writefile:error',
            path,
            payload: `写入文件流错误: ${err.message}`,
            requestId,
          })
        );
      });

      // Listen for the 'close' event which indicates the stream has finished writing and the file descriptor is closed.
      writeStream.on('close', () => {
        if (!errorOccurred) {
          console.log(
            `[SFTP ${sessionId}] writefile ${path} stream closed successfully (ID: ${requestId}). Fetching updated stats...`
          );
          if (originalMode !== undefined) {
            console.log(
              `[SFTP ${sessionId}] Set file mode for ${path} during creation: ${originalMode.toString(8)} (ID: ${requestId})`
            );
          }
          // Get updated stats after writing
          state.sftp!.lstat(path, (statErr, stats) => {
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
            } else {
              const updatedItem = {
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
              console.log(
                `[SFTP ${sessionId}] Sending writefile success with updated item for ${path} (ID: ${requestId})`
              );
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:writefile:success',
                  path,
                  payload: updatedItem,
                  requestId,
                })
              );
            }
          });
        }
      });

      console.debug(
        `[SFTP ${sessionId}] Writing ${buffer.length} bytes to ${path} (ID: ${requestId})`
      );
      writeStream.end(buffer); // Start writing and close the stream afterwards
      console.debug(`[SFTP ${sessionId}] writefile ${path} end() called (ID: ${requestId})`);

      // Success message is now sent in the 'close' event handler
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
  }

  /** 创建目录 */
  async mkdir(sessionId: string, path: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 mkdir (ID: ${requestId})`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:mkdir:error',
          path,
          payload: 'SFTP 会话未就绪',
          requestId,
        })
      ); // Use specific error type
      return;
    }
    console.debug(`[SFTP ${sessionId}] Received mkdir request for ${path} (ID: ${requestId})`);
    try {
      state.sftp.mkdir(path, (err) => {
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
        } else {
          console.log(
            `[SFTP ${sessionId}] mkdir ${path} success (ID: ${requestId}). Fetching stats...`
          );
          // Get stats for the new directory
          state.sftp!.lstat(path, (statErr, stats) => {
            if (statErr) {
              console.error(
                `[SFTP ${sessionId}] lstat after mkdir ${path} failed (ID: ${requestId}):`,
                statErr
              );
              // Send success anyway, but without item details
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:mkdir:success',
                  path,
                  payload: null,
                  requestId,
                })
              );
            } else {
              const newItem = {
                filename: path.substring(path.lastIndexOf('/') + 1),
                longname: '', // lstat doesn't provide longname
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
              console.log(
                `[SFTP ${sessionId}] Sending mkdir success with new item for ${path} (ID: ${requestId})`
              );
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:mkdir:success',
                  path,
                  payload: newItem,
                  requestId,
                })
              );
            }
          });
        }
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
  }

  /** 删除目录 (强制递归) */
  async rmdir(sessionId: string, path: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
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

    // 使用 rm -rf 命令删除目录（不使用 sudo 以避免权限提升风险）
    const executeRmRfCommand = async () => {
      const command = `rm -rf '${path.replace(/'/g, "'\\''")}'`;

      console.log(`[SSH Exec ${sessionId}] 尝试使用 rm -rf 命令删除 ${path} (ID: ${requestId})`);
      console.log(`[SSH Exec ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

      try {
        state.sshClient.exec(command, (err, stream) => {
          if (err) {
            console.error(
              `[SSH Exec ${sessionId}] Failed to start exec for rm -rf ${path} (ID: ${requestId}):`,
              err
            );
            // 【安全修复】移除危险的自动 sudo 回退，直接返回错误
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
              console.log(
                `[SSH Exec ${sessionId}] rm -rf ${path} command executed successfully (ID: ${requestId})`
              );
              state.ws.send(JSON.stringify({ type: 'sftp:rmdir:success', path, requestId }));
            } else {
              const errorMessage =
                stderrOutput.trim() ||
                `命令退出，代码: ${code ?? 'N/A'}${signal ? `, 信号: ${signal}` : ''}`;
              console.error(
                `[SSH Exec ${sessionId}] rm -rf ${path} command failed (ID: ${requestId}). Code: ${code}, Signal: ${signal}, Stderr: ${errorMessage}`
              );
              // 【安全修复】移除危险的自动 sudo 回退，直接返回错误
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:rmdir:error',
                  path,
                  payload: `删除目录失败: ${errorMessage}`,
                  requestId,
                })
              );
            }
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
        // 【安全修复】移除危险的自动 sudo 回退，直接返回错误
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

    // 执行 rm -rf 命令删除目录
    executeRmRfCommand();
  }

  /** 删除文件 */
  async unlink(sessionId: string, path: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 unlink (ID: ${requestId})`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:unlink:error',
          path,
          payload: 'SFTP 会话未就绪',
          requestId,
        })
      ); // Use specific error type
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
        } else {
          console.log(`[SFTP ${sessionId}] unlink ${path} success (ID: ${requestId})`);
          state.ws.send(JSON.stringify({ type: 'sftp:unlink:success', path, requestId })); // Send specific success type
        }
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
  }

  /** 重命名/移动文件或目录 */
  async rename(
    sessionId: string,
    oldPath: string,
    newPath: string,
    requestId: string
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
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
      ); // Use specific error type
      return;
    }
    console.debug(
      `[SFTP ${sessionId}] Received rename request ${oldPath} -> ${newPath} (ID: ${requestId})`
    );
    try {
      state.sftp.rename(oldPath, newPath, (err) => {
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
        } else {
          console.log(
            `[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} success (ID: ${requestId}). Fetching stats for new path...`
          );
          // Get stats for the new path
          state.sftp!.lstat(newPath, (statErr, stats) => {
            if (statErr) {
              console.error(
                `[SFTP ${sessionId}] lstat after rename ${newPath} failed (ID: ${requestId}):`,
                statErr
              );
              // Send success anyway, but without item details
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:rename:success',
                  payload: { oldPath, newPath, newItem: null },
                  requestId,
                })
              );
            } else {
              const newItem = {
                filename: newPath.substring(newPath.lastIndexOf('/') + 1),
                longname: '', // lstat doesn't provide longname
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
              console.log(
                `[SFTP ${sessionId}] Sending rename success with new item for ${newPath} (ID: ${requestId})`
              );
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:rename:success',
                  payload: { oldPath, newPath, newItem },
                  requestId,
                })
              );
            }
          });
        }
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
  }

  /** 修改文件/目录权限 */
  async chmod(sessionId: string, path: string, mode: number, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 chmod (ID: ${requestId})`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:chmod:error',
          path,
          payload: 'SFTP 会话未就绪',
          requestId,
        })
      ); // Use specific error type
      return;
    }
    console.debug(
      `[SFTP ${sessionId}] Received chmod request for ${path} to ${mode.toString(8)} (ID: ${requestId})`
    );
    try {
      state.sftp.chmod(path, mode, (err) => {
        if (err) {
          console.error(
            `[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} failed (ID: ${requestId}):`,
            err
          );
          state.ws.send(
            JSON.stringify({
              type: 'sftp:chmod:error',
              path,
              payload: `修改权限失败: ${err.message}`,
              requestId,
            })
          );
        } else {
          console.log(
            `[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} success (ID: ${requestId}). Fetching updated stats...`
          );
          // Get updated stats after chmod
          state.sftp!.lstat(path, (statErr, stats) => {
            if (statErr) {
              console.error(
                `[SFTP ${sessionId}] lstat after chmod ${path} failed (ID: ${requestId}):`,
                statErr
              );
              // Send success anyway, but without updated item details
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:chmod:success',
                  path,
                  payload: null,
                  requestId,
                })
              );
            } else {
              const updatedItem = {
                filename: path.substring(path.lastIndexOf('/') + 1),
                longname: '', // lstat doesn't provide longname
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
              console.log(
                `[SFTP ${sessionId}] Sending chmod success with updated item for ${path} (ID: ${requestId})`
              );
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:chmod:success',
                  path,
                  payload: updatedItem,
                  requestId,
                })
              );
            }
          });
        }
      });
    } catch (error: unknown) {
      console.error(
        `[SFTP ${sessionId}] chmod ${path} caught unexpected error (ID: ${requestId}):`,
        error
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:chmod:error',
          path,
          payload: `修改权限时发生意外错误: ${getErrorMessage(error)}`,
          requestId,
        })
      );
    }
  }

  /** 获取路径的绝对表示 */
  async realpath(sessionId: string, path: string, requestId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 realpath (ID: ${requestId})`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:realpath:error',
          path,
          payload: 'SFTP 会话未就绪',
          requestId,
        })
      );
      return;
    }
    console.debug(`[SFTP ${sessionId}] Received realpath request for ${path} (ID: ${requestId})`);
    try {
      state.sftp.realpath(path, (err, absPath) => {
        if (err) {
          console.error(`[SFTP ${sessionId}] realpath ${path} failed (ID: ${requestId}):`, err);
          state.ws.send(
            JSON.stringify({
              type: 'sftp:realpath:error',
              path,
              payload: { requestedPath: path, error: `获取绝对路径失败: ${err.message}` },
              requestId,
            })
          );
        } else {
          console.log(
            `[SFTP ${sessionId}] realpath ${path} -> ${absPath} success (ID: ${requestId}). Fetching target type...`
          );
          // 再次检查 state 和 state.sftp 是否仍然有效，因为回调是异步的
          const currentState = this.clientStates.get(sessionId);
          if (!currentState || !currentState.sftp) {
            console.warn(
              `[SFTP ${sessionId}] SFTP session for ${absPath} became invalid before stat call (ID: ${requestId}).`
            );
            // 即使 SFTP 会话失效，也尝试发送已解析的路径，但标记错误
            state.ws.send(
              JSON.stringify({
                type: 'sftp:realpath:error',
                path, // 原始请求路径
                payload: {
                  requestedPath: path,
                  absolutePath: absPath,
                  error: 'SFTP 会话在获取目标类型前已失效',
                },
                requestId,
              })
            );
            return;
          }
          // 对 absPath 执行 stat 操作以获取其真实类型
          currentState.sftp.stat(absPath, (statErr, stats) => {
            // 使用 sftp.stat()
            if (statErr) {
              console.error(
                `[SFTP ${sessionId}] stat on realpath target ${absPath} failed (ID: ${requestId}):`,
                statErr
              );
              // 如果 stat 失败，发送带有错误信息的 realpath:error，但仍包含已解析的路径
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:realpath:error',
                  path, // 原始请求路径
                  payload: {
                    requestedPath: path,
                    absolutePath: absPath, // 仍然发送已解析的路径
                    error: `获取目标类型失败: ${statErr.message}`,
                  },
                  requestId,
                })
              );
            } else {
              let targetType: 'file' | 'directory' | 'unknown' = 'unknown';
              if (stats.isFile()) {
                targetType = 'file';
              } else if (stats.isDirectory()) {
                targetType = 'directory';
              }
              console.log(
                `[SFTP ${sessionId}] Target type for ${absPath} is ${targetType} (ID: ${requestId})`
              );
              state.ws.send(
                JSON.stringify({
                  type: 'sftp:realpath:success',
                  path, // 原始请求路径
                  payload: {
                    requestedPath: path,
                    absolutePath: absPath,
                    targetType, // 新增字段
                  },
                  requestId,
                })
              );
            }
          });
        }
      });
    } catch (error: unknown) {
      console.error(
        `[SFTP ${sessionId}] realpath ${path} caught unexpected error (ID: ${requestId}):`,
        error
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:realpath:error',
          path,
          payload: `获取绝对路径时发生意外错误: ${getErrorMessage(error)}`,
          requestId,
        })
      );
    }
  }

  // +++ 复制文件或目录 +++
  async copy(
    sessionId: string,
    sources: string[],
    destinationDir: string,
    requestId: string
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
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

    const copiedItemsDetails: any[] = []; // Store details of successfully copied items
    let firstError: Error | null = null;

    try {
      // Ensure destination directory exists
      try {
        await this.ensureDirectoryExists(sftp, destinationDir);
      } catch (ensureErr: unknown) {
        console.error(
          `[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists (ID: ${requestId}):`,
          ensureErr
        );
        throw new Error(`无法创建或访问目标目录: ${getErrorMessage(ensureErr)}`);
      }

      for (const sourcePath of sources) {
        const sourceName = pathModule.basename(sourcePath);
        const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

        if (sourcePath === destPath) {
          console.warn(
            `[SFTP ${sessionId}] Skipping copy: source and destination are the same (${sourcePath}) (ID: ${requestId})`
          );
          continue; // Skip if source and destination are identical
        }

        try {
          const stats = await this.getStats(sftp, sourcePath);
          if (stats.isDirectory()) {
            console.log(
              `[SFTP ${sessionId}] Copying directory ${sourcePath} to ${destPath} (ID: ${requestId})`
            );
            await this.copyDirectoryRecursive(sftp, sourcePath, destPath);
          } else if (stats.isFile()) {
            console.log(
              `[SFTP ${sessionId}] Copying file ${sourcePath} to ${destPath} (ID: ${requestId})`
            );
            await this.copyFile(sftp, sourcePath, destPath);
          } else {
            // Handle symlinks or other types if necessary, for now just skip/warn
            console.warn(
              `[SFTP ${sessionId}] Skipping copy of unsupported file type: ${sourcePath} (ID: ${requestId})`
            );
            continue;
          }
          // Get stats of the *newly copied* item
          const copiedStats = await this.getStats(sftp, destPath);
          copiedItemsDetails.push(this.formatStatsToFileListItem(destPath, copiedStats));
        } catch (copyErr: unknown) {
          console.error(
            `[SFTP ${sessionId}] Error copying ${sourcePath} to ${destPath} (ID: ${requestId}):`,
            copyErr
          );
          firstError = copyErr instanceof Error ? copyErr : new Error(getErrorMessage(copyErr)); // Store the first error encountered
          break; // Stop processing further sources on error
        }
      }

      if (firstError) {
        throw firstError; // Throw the first error to be caught below
      }

      // Send success message with details of copied items
      console.log(
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
  }

  // +++ 移动文件或目录 +++
  async move(
    sessionId: string,
    sources: string[],
    destinationDir: string,
    requestId: string
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      console.warn(`[SFTP Move] SFTP 未准备好，无法在 ${sessionId} 上执行 move (ID: ${requestId})`);
      state?.ws.send(
        JSON.stringify({
          type: 'sftp:move:error',
          payload: 'SFTP 会话未就绪',
          requestId,
        })
      );
      return;
    }
    const { sftp } = state;
    console.debug(
      `[SFTP ${sessionId}] Received move request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`
    );

    const movedItemsDetails: any[] = [];
    let firstError: Error | null = null;

    try {
      // Ensure destination directory exists (important for move)
      try {
        await this.ensureDirectoryExists(sftp, destinationDir);
      } catch (ensureErr: unknown) {
        console.error(
          `[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists for move (ID: ${requestId}):`,
          ensureErr
        );
        throw new Error(`无法创建或访问目标目录: ${getErrorMessage(ensureErr)}`);
      }

      for (const oldPath of sources) {
        const sourceName = pathModule.basename(oldPath);
        const newPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

        if (oldPath === newPath) {
          console.warn(
            `[SFTP ${sessionId}] Skipping move: source and destination are the same (${oldPath}) (ID: ${requestId})`
          );
          continue; // Skip if source and destination are identical
        }

        try {
          // --- 移动前检查目标是否存在 ---
          let targetExists = false;
          try {
            await this.getStats(sftp, newPath);
            targetExists = true;
          } catch (statErr: unknown) {
            const statErrCode = (statErr as any)?.code;
            const statErrMsg = getErrorMessage(statErr);
            if (!(statErrCode === 'ENOENT' || statErrMsg.includes('No such file'))) {
              // 如果 stat 失败不是因为 "No such file"，则抛出未知错误
              throw new Error(`检查目标路径 ${newPath} 状态时出错: ${statErrMsg}`);
            }
            // 如果是 "No such file"，则 targetExists 保持 false，可以继续移动
          }

          if (targetExists) {
            console.error(
              `[SFTP ${sessionId}] Move failed: Target path ${newPath} already exists (ID: ${requestId})`
            );
            throw new Error(`目标路径 ${pathModule.basename(newPath)} 已存在`);
          }

          console.log(`[SFTP ${sessionId}] Moving ${oldPath} to ${newPath} (ID: ${requestId})`);
          await this.performRename(sftp, oldPath, newPath); // Use helper for rename logic

          // Get stats of the *moved* item at the new location
          const movedStats = await this.getStats(sftp, newPath);
          movedItemsDetails.push(this.formatStatsToFileListItem(newPath, movedStats));
        } catch (moveErr: unknown) {
          console.error(
            `[SFTP ${sessionId}] Error moving ${oldPath} to ${newPath} (ID: ${requestId}):`,
            moveErr
          );
          firstError = moveErr instanceof Error ? moveErr : new Error(getErrorMessage(moveErr));
          break; // Stop on first error for move
        }
      }

      if (firstError) {
        throw firstError;
      }

      console.log(
        `[SFTP ${sessionId}] Move operation completed successfully (ID: ${requestId}). Moved items: ${movedItemsDetails.length}`
      );
      state.ws.send(
        JSON.stringify({
          type: 'sftp:move:success',
          payload: { sources, destination: destinationDir, items: movedItemsDetails },
          requestId,
        })
      );
    } catch (error: unknown) {
      console.error(`[SFTP ${sessionId}] Move operation failed (ID: ${requestId}):`, error);
      state.ws.send(
        JSON.stringify({
          type: 'sftp:move:error',
          payload: `移动操作失败: ${getErrorMessage(error)}`,
          requestId,
        })
      );
    }
  }

  // +++ 辅助方法 - 复制文件 +++
  private copyFile(sftp: SFTPWrapper, sourcePath: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = sftp.createReadStream(sourcePath);
      const writeStream = sftp.createWriteStream(destPath);
      let errorOccurred = false;

      const onError = (err: Error) => {
        if (errorOccurred) return;
        errorOccurred = true;
        // Ensure streams are destroyed on error
        readStream.destroy();
        writeStream.destroy();
        console.error(`Error copying file ${sourcePath} to ${destPath}:`, err);
        reject(new Error(`复制文件失败: ${err.message}`));
      };

      readStream.on('error', onError);
      writeStream.on('error', onError);

      writeStream.on('close', () => {
        // Use 'close' for write stream completion
        if (!errorOccurred) {
          resolve();
        }
      });

      readStream.pipe(writeStream);
    });
  }

  // +++ 辅助方法 - 递归复制目录 +++
  private async copyDirectoryRecursive(
    sftp: SFTPWrapper,
    sourcePath: string,
    destPath: string
  ): Promise<void> {
    try {
      // Create destination directory
      await this.ensureDirectoryExists(sftp, destPath);

      // Read source directory contents
      const items = await this.listDirectory(sftp, sourcePath);

      for (const item of items) {
        const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
        const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
        const itemStats = item.attrs; // Assuming readdir provides stats

        if (itemStats.isDirectory()) {
          await this.copyDirectoryRecursive(sftp, currentSourcePath, currentDestPath);
        } else if (itemStats.isFile()) {
          await this.copyFile(sftp, currentSourcePath, currentDestPath);
        } else {
          console.warn(`[SFTP Copy Recurse] Skipping unsupported type: ${currentSourcePath}`);
        }
      }
    } catch (error: unknown) {
      console.error(`Error recursively copying directory ${sourcePath} to ${destPath}:`, error);
      throw new Error(`递归复制目录失败: ${getErrorMessage(error)}`);
    }
  }

  // +++ 辅助方法 - 获取 Stats (Promise wrapper) +++
  private getStats(sftp: SFTPWrapper, path: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      sftp.lstat(path, (err, stats) => {
        if (err) {
          reject(err);
        } else {
          resolve(stats);
        }
      });
    });
  }

  // +++ 修改：辅助方法 - 确保目录存在 (递归创建) +++
  private async ensureDirectoryExists(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    // 规范化路径，移除尾部斜杠（如果存在）
    const normalizedPath = dirPath.replace(/\/$/, '');
    if (!normalizedPath || normalizedPath === '/') {
      return; // 根目录不需要创建
    }

    try {
      // 1. 尝试直接 stat 目录
      await this.getStats(sftp, normalizedPath);
      // console.log(`[SFTP Util] Directory already exists: ${normalizedPath}`);
      // 目录已存在
    } catch (statError: unknown) {
      const statErrCode = (statError as any)?.code;
      const statErrMsg = getErrorMessage(statError);
      // 2. 如果 stat 失败，检查是否是 "No such file" 错误
      if (statErrCode === 'ENOENT' || statErrMsg.includes('No such file')) {
        // 目录不存在，尝试创建
        try {
          // 3. 尝试递归创建 (ssh2 的 mkdir 支持非标准 recursive 属性)
          // 注意：这可能不适用于所有 SFTP 服务器
          await new Promise<void>((resolveMkdir, rejectMkdir) => {
            // @ts-ignore - ssh2 types might not include 'recursive' in attributes
            sftp.mkdir(normalizedPath, { recursive: true }, (mkdirErr) => {
              if (mkdirErr) {
                // 如果递归创建失败，尝试逐级创建
                console.warn(
                  `[SFTP Util] Recursive mkdir failed for ${normalizedPath}, falling back to iterative creation:`,
                  mkdirErr
                );
                rejectMkdir(mkdirErr); // Reject to trigger fallback
              } else {
                console.log(`[SFTP Util] Recursively created directory: ${normalizedPath}`);
                resolveMkdir();
              }
            });
          });
          // 递归创建成功
        } catch (_recursiveMkdirError: unknown) {
          // 4. 递归创建失败，回退到逐级创建
          const parentDir = pathModule.dirname(normalizedPath).replace(/\\/g, '/');
          if (parentDir && parentDir !== '/' && parentDir !== '.') {
            // 递归确保父目录存在
            await this.ensureDirectoryExists(sftp, parentDir);
          }
          // 创建当前目录
          try {
            await new Promise<void>((resolveMkdir, rejectMkdir) => {
              sftp.mkdir(normalizedPath, (mkdirErr) => {
                if (mkdirErr) {
                  // 如果逐级创建也失败，则抛出错误
                  rejectMkdir(new Error(`创建目录失败 ${normalizedPath}: ${mkdirErr.message}`));
                } else {
                  console.log(`[SFTP Util] Iteratively created directory: ${normalizedPath}`);
                  resolveMkdir();
                }
              });
            });
          } catch (iterativeMkdirError: unknown) {
            console.error(
              `[SFTP Util] Iterative mkdir failed for ${normalizedPath}:`,
              iterativeMkdirError
            );
            // 检查是否是因为目录已存在（可能由并发操作创建）
            try {
              const finalStats = await this.getStats(sftp, normalizedPath);
              if (!finalStats.isDirectory()) {
                throw new Error(`路径 ${normalizedPath} 已存在但不是目录`);
              }
              // 如果目录现在存在，则忽略错误
              console.log(
                `[SFTP Util] Directory ${normalizedPath} exists after iterative mkdir failure, likely created concurrently.`
              );
            } catch (_finalStatError: unknown) {
              // 如果最终检查也失败，则抛出原始的逐级创建错误
              throw iterativeMkdirError;
            }
          }
        }
      } else {
        // 其他 stat 错误
        throw new Error(`检查目录失败 ${normalizedPath}: ${statErrMsg}`);
      }
    }
  }

  // +++ 辅助方法 - 列出目录内容 (Promise wrapper) +++
  private listDirectory(sftp: SFTPWrapper, path: string): Promise<SftpDirEntry[]> {
    // 使用本地接口 SftpDirEntry
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        // list 的类型现在是 SftpDirEntry[]
        if (err) {
          reject(err);
        } else {
          resolve(list);
        }
      });
    });
  }

  // +++ 辅助方法 - 执行重命名 (Promise wrapper) +++
  private performRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // +++ 辅助方法 - 格式化 Stats 为 FileListItem +++
  private formatStatsToFileListItem(itemPath: string, stats: Stats): any {
    return {
      filename: pathModule.basename(itemPath),
      longname: '', // stat doesn't provide longname, maybe generate a basic one?
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
  }

  // --- Compress/Decompress Methods (delegated to SftpArchiveManager) ---
  /**
   * 压缩远程服务器上的文件/目录
   * @param sessionId 会话 ID
   * @param payload 压缩请求的 payload
   */
  async compress(sessionId: string, payload: SftpCompressRequestPayload): Promise<void> {
    return this.archiveManager.compress(sessionId, payload);
  }

  /**
   * 解压远程服务器上的压缩文件
   * @param sessionId 会话 ID
   * @param payload 解压请求的 payload
   */
  async decompress(sessionId: string, payload: SftpDecompressRequestPayload): Promise<void> {
    return this.archiveManager.decompress(sessionId, payload);
  }

  // --- 辅助方法 ---

  /** 检查远程服务器上是否存在指定的命令 */
  private checkCommandExists(
    state: ClientState,
    sessionId: string,
    commandName: string
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!state.sshClient) {
        return reject(new Error('SSH client is not available.'));
      }
      // 优先使用 command -v, 其次 which
      const checkCommands = [`command -v ${commandName}`, `which ${commandName}`];
      let currentCheckIndex = 0;

      const tryCommand = () => {
        if (currentCheckIndex >= checkCommands.length) {
          resolve(false); // 所有检查命令都尝试过了，未找到
          return;
        }
        const checkCmd = checkCommands[currentCheckIndex];
        console.log(`[SFTP Command Check ${sessionId}] Executing: ${checkCmd}`);
        state.sshClient.exec(checkCmd, (err, stream) => {
          if (err) {
            console.error(
              `[SFTP Command Check ${sessionId}] Failed to start exec for "${checkCmd}":`,
              err
            );
            currentCheckIndex++;
            tryCommand(); // 尝试下一个检查命令
            return;
          }
          let output = '';
          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });
          stream.on('close', (code: number | null) => {
            if (code === 0 && output.trim() !== '') {
              console.log(
                `[SFTP Command Check ${sessionId}] Command '${commandName}' found using "${checkCmd}". Output: ${output.trim()}`
              );
              resolve(true);
            } else {
              console.log(
                `[SFTP Command Check ${sessionId}] Command '${commandName}' not found with "${checkCmd}" (code: ${code}, output: "${output.trim()}").`
              );
              currentCheckIndex++;
              tryCommand(); // 尝试下一个检查命令
            }
          });
          stream.stderr.on('data', (data: Buffer) => {
            // console.debug(`[SFTP Command Check ${sessionId}] stderr for "${checkCmd}": ${data.toString()}`);
          });
          stream.on('error', (streamErr: Error) => {
            console.error(
              `[SFTP Command Check ${sessionId}] Stream error for "${checkCmd}":`,
              streamErr
            );
            currentCheckIndex++;
            tryCommand(); // 尝试下一个检查命令
          });
        });
      };
      tryCommand();
    });
  }

  /** 发送压缩错误消息 */
  private sendCompressError(
    ws: AuthenticatedWebSocket | undefined,
    error: string,
    requestId: string,
    details?: string
  ): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload: SftpCompressErrorPayload = { error, requestId };
      if (details) payload.details = details;
      // 检查是否是命令未找到的特定错误
      if (error.includes('在服务器上未找到')) {
        ws.send(
          JSON.stringify({
            type: 'sftp:command_not_found',
            payload: {
              operation: 'compress',
              command: error.match(/'([^']+)'/)?.[1] || 'unknown',
              message: details || error,
            },
            requestId,
          })
        );
      } else {
        ws.send(JSON.stringify({ type: 'sftp:compress:error', payload }));
      }
    } else {
      console.warn(
        `[SFTP Compress] WebSocket closed or invalid, cannot send error for request ${requestId}.`
      );
    }
  }

  /** 发送解压错误消息 */
  private sendDecompressError(
    ws: AuthenticatedWebSocket | undefined,
    error: string,
    requestId: string,
    details?: string
  ): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload: SftpDecompressErrorPayload = { error, requestId };
      if (details) payload.details = details;
      // 检查是否是命令未找到的特定错误
      if (error.includes('在服务器上未找到')) {
        ws.send(
          JSON.stringify({
            type: 'sftp:command_not_found',
            payload: {
              operation: 'decompress',
              command: error.match(/'([^']+)'/)?.[1] || 'unknown',
              message: details || error,
            },
            requestId,
          })
        );
      } else {
        ws.send(JSON.stringify({ type: 'sftp:decompress:error', payload }));
      }
    } else {
      console.warn(
        `[SFTP Decompress] WebSocket closed or invalid, cannot send error for request ${requestId}.`
      );
    }
  }

  /** 检查 stderr 输出是否包含表示错误的常见模式 */
  private isErrorInStdErr(stderr: string): boolean {
    if (!stderr || stderr.trim().length === 0) {
      return false; // 空 stderr 不是错误
    }
    const lowerStderr = stderr.toLowerCase();
    // 常见的错误关键词或模式
    const errorPatterns = [
      'error',
      'fail',
      'cannot',
      'not found',
      'no such file',
      'permission denied',
      'invalid',
      '不支持',
    ];
    // tar/zip 进度信息通常包含百分比或文件名，不应视为错误
    if (
      /[\d.]+%/.test(stderr) ||
      /adding:/.test(lowerStderr) ||
      /inflating:/.test(lowerStderr) ||
      /extracting:/.test(lowerStderr)
    ) {
      // 忽略一些明确的非错误输出
      if (errorPatterns.some((pattern) => lowerStderr.includes(pattern))) {
        // 如果进度信息中包含错误关键词，则可能真的是错误
        return true;
      }
      return false;
    }

    return errorPatterns.some((pattern) => lowerStderr.includes(pattern));
  }

  // --- File Upload Methods ---

  /** Start a new file upload (delegated to SftpUploadManager) */
  async startUpload(
    sessionId: string,
    uploadId: string,
    remotePath: string,
    totalSize: number,
    relativePath?: string
  ): Promise<void> {
    return this.uploadManager.startUpload(sessionId, uploadId, remotePath, totalSize, relativePath);
  }

  /** Handle an incoming file chunk (delegated to SftpUploadManager) */
  async handleUploadChunk(
    sessionId: string,
    uploadId: string,
    chunkIndex: number,
    dataBase64: string
  ): Promise<void> {
    return this.uploadManager.handleUploadChunk(sessionId, uploadId, chunkIndex, dataBase64);
  }

  /** Cancel an ongoing upload (delegated to SftpUploadManager) */
  cancelUpload(sessionId: string, uploadId: string): void {
    return this.uploadManager.cancelUpload(sessionId, uploadId);
  }
}
