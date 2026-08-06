import { Client, ClientChannel, SFTPWrapper, Stats, WriteStream } from 'ssh2';
import { WebSocket } from 'ws';
import { ClientState, AuthenticatedWebSocket } from '../websocket/types';
import * as pathModule from 'path'; 
import * as jschardet from 'jschardet'; 
import * as iconv from 'iconv-lite';
import { quotePosixShellArg } from '../utils/shell';
// +++ 导入新类型 +++
import {
    SftpCompressRequestPayload,
    SftpCompressSuccessPayload,
    SftpCompressErrorPayload,
    SftpDecompressRequestPayload,
    SftpDecompressSuccessPayload,
    SftpDecompressErrorPayload
} from '../websocket/types';

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
    }
}

// Note: These constants seem related to StatusMonitorService, not SftpService.
const DEFAULT_POLLING_INTERVAL = 1000;
const previousNetStats = new Map<string, { rx: number, tx: number, timestamp: number }>();
const ARCHIVE_TOTAL_MARKER = '__NEXUS_ARCHIVE_TOTAL__:';
const ARCHIVE_WARNING_MARKER = '__NEXUS_ARCHIVE_WARNING__:';
const UPLOAD_WRITE_HIGH_WATER_MARK = 1024 * 1024;
const UPLOAD_DIRECTORY_PREPARE_CONCURRENCY = 8;

// Interface for tracking active uploads
interface ActiveUpload {
    remotePath: string;
    temporaryPath: string;
    totalSize: number;
    bytesAccepted: number;
    bytesWritten: number;
    nextChunkIndex: number;
    receivedLastChunk: boolean;
    stream: WriteStream;
    sessionId: string; // Link back to the session for cleanup
    relativePath?: string;
    drainPromise?: Promise<void> | null; // +++ For managing drain event listeners +++
}

interface PendingUpload {
    sessionId: string;
    remotePath: string;
    temporaryPath: string;
}

interface PreparedUploadBatch {
    sessionId: string;
    basePath: string;
    directories: Set<string>;
}

interface ActiveArchiveOperation {
    sessionId: string;
    requestId: string;
    workspacePath: string;
    stream: ClientChannel;
    heartbeatInterval: ReturnType<typeof setInterval>;
    cancelled: boolean;
}

export class SftpService {
    private clientStates: Map<string, ClientState>; // 使用导入的 ClientState
    private activeUploads: Map<string, ActiveUpload>; // Map<uploadId, ActiveUpload>
    private pendingUploads: Map<string, PendingUpload>;
    private cancelledUploadIds: Set<string>;
    private activeArchives: Map<string, ActiveArchiveOperation>;
    private cancelledArchiveIds: Set<string>;
    private directoryEnsurePromises = new WeakMap<SFTPWrapper, Map<string, Promise<void>>>();
    private preparedUploadBatches: Map<string, PreparedUploadBatch>;

    constructor(clientStates: Map<string, ClientState>) {
        this.clientStates = clientStates;
        this.activeUploads = new Map(); // Initialize the map
        this.pendingUploads = new Map();
        this.cancelledUploadIds = new Set();
        this.activeArchives = new Map();
        this.cancelledArchiveIds = new Set();
        this.preparedUploadBatches = new Map();
    }

    /**
     * 初始化 SFTP 会话
     * @param sessionId 会话 ID
     */
    async initializeSftpSession(sessionId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sshClient || state.sftp) {
            console.warn(`[SFTP] 无法为会话 ${sessionId} 初始化 SFTP：状态无效、SSH客户端不存在或 SFTP 已初始化。`);
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
                    state.ws.send(JSON.stringify({ type: 'sftp_error', payload: { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' } }));
                    reject(err);
                } else {
                    console.log(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话成功。`);
                    state.sftp = sftpInstance;
                    state.ws.send(JSON.stringify({ type: 'sftp_ready', payload: { connectionId: state.dbConnectionId } }));
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
                         state?.ws.send(JSON.stringify({ type: 'sftp_error', payload: { connectionId: state.dbConnectionId, message: 'SFTP 会话错误' } }));
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
        if (!state) return;
        const sftp = state.sftp;
        const cleanupTasks: Promise<unknown>[] = [];

        this.activeUploads.forEach((upload, uploadId) => {
            if (upload.sessionId === sessionId) cleanupTasks.push(this.cancelUploadInternal(uploadId, 'SFTP session ended'));
        });
        this.pendingUploads.forEach((upload, uploadId) => {
            if (upload.sessionId === sessionId) {
                this.cancelledUploadIds.add(uploadId);
                cleanupTasks.push(this.removeRemoteUploadFile(sessionId, upload.temporaryPath));
            }
        });
        this.activeArchives.forEach((archive) => {
            if (archive.sessionId === sessionId) cleanupTasks.push(this.cancelArchive(sessionId, archive.requestId, false));
        });
        this.preparedUploadBatches.forEach((batch, prepareId) => {
            if (batch.sessionId === sessionId) this.preparedUploadBatches.delete(prepareId);
        });

        void Promise.allSettled(cleanupTasks).finally(() => {
            if (sftp) sftp.end();
            if (state.sftp === sftp) state.sftp = undefined;
        });
    }

    // --- SFTP 操作方法 ---

    /** 读取目录内容 */
    async readdir(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readdir (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
             return;
        }
        console.debug(`[SFTP ${sessionId}] Received readdir request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.readdir(path, (err, list) => {
                 if (err) {
                    console.error(`[SFTP ${sessionId}] readdir ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: `读取目录失败: ${err.message}`, requestId: requestId }));
                 } else {
                    const files = list.map((item) => ({
                        filename: item.filename,
                        longname: item.longname,
                        attrs: {
                            size: item.attrs.size, uid: item.attrs.uid, gid: item.attrs.gid, mode: item.attrs.mode,
                            atime: item.attrs.atime * 1000, mtime: item.attrs.mtime * 1000,
                            isDirectory: item.attrs.isDirectory(), isFile: item.attrs.isFile(), isSymbolicLink: item.attrs.isSymbolicLink(),
                         }
                     }));
                    state.ws.send(JSON.stringify({ type: 'sftp:readdir:success', path: path, payload: files, requestId: requestId }));
                 }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] readdir ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: `读取目录时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 获取文件/目录状态信息 */
    async stat(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 stat (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received stat request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.lstat(path, (err, stats: Stats) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] stat ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: `获取状态失败: ${err.message}`, requestId: requestId }));
                } else {
                     const fileStats = {
                         size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                         atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                         isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                     };
                    // Send specific success type
                    state.ws.send(JSON.stringify({ type: 'sftp:stat:success', path: path, payload: fileStats, requestId: requestId }));
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] stat ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: `获取状态时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 读取文件内容 (支持指定编码) */
    async readFile(sessionId: string, path: string, requestId: string, requestedEncoding?: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readFile (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        console.debug(`[SFTP ${sessionId}] Received readFile request for ${path} (ID: ${requestId}, Requested Encoding: ${requestedEncoding ?? 'auto'})`);
        try {
            const readStream = state.sftp.createReadStream(path);
            const chunks: Buffer[] = [];
            let errorOccurred = false;

            readStream.on('data', (chunk: Buffer) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            readStream.on('error', (err: Error) => {
                if (errorOccurred) return; errorOccurred = true;
                console.error(`[SFTP ${sessionId}] readFile ${path} stream error (ID: ${requestId}):`, err);
                state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: `读取文件流错误: ${err.message}`, requestId: requestId }));
            });
            readStream.on('end', () => {
                if (errorOccurred) return;
                const fileData = Buffer.concat(chunks);

                console.log(`[SFTP ${sessionId}] readFile ${path} success, size: ${fileData.length} bytes (ID: ${requestId}). Processing content...`);
                let encodingUsed: string = 'utf-8'; // Default encoding
                let decodedContent: string = '';
                let decodeError: string | null = null;

                try {
                    if (requestedEncoding) {
                        // 用户指定了编码
                        encodingUsed = requestedEncoding;
                        console.log(`[SFTP ${sessionId}] Using requested encoding: ${encodingUsed} (ID: ${requestId})`);
                        const normalizedEncoding = encodingUsed.toLowerCase().replace(/[^a-z0-9]/g, ''); // Normalize more aggressively
                        if (iconv.encodingExists(normalizedEncoding)) {
                            decodedContent = iconv.decode(fileData, normalizedEncoding);
                            encodingUsed = normalizedEncoding; // Use the normalized name if valid
                        } else {
                            console.warn(`[SFTP ${sessionId}] Requested encoding "${requestedEncoding}" is not supported by iconv-lite. Falling back to UTF-8. (ID: ${requestId})`);
                            encodingUsed = 'utf-8'; // Fallback
                            decodedContent = iconv.decode(fileData, encodingUsed);
                            // Optionally add a warning?
                        }
                    } else {
                        // 自动检测编码
                        console.log(`[SFTP ${sessionId}] Detecting encoding for ${path} (ID: ${requestId})`);
                        const detection = jschardet.detect(fileData);
                        const detectedEncodingRaw = detection.encoding ? detection.encoding.toLowerCase() : 'utf-8'; // Default to utf-8 if detection fails
                        const confidence = detection.confidence || 0;
                        console.log(`[SFTP ${sessionId}] Detected encoding: ${detectedEncodingRaw} (confidence: ${confidence})`);

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
                            console.log(`[SFTP ${sessionId}] Decoded ${path} from detected Chinese encoding (${normalizedDetected}) as ${encodingUsed}.`);
                        } else if (confidence < 0.90) { // Low confidence threshold
                            console.warn(`[SFTP ${sessionId}] Low confidence detection (${normalizedDetected}, ${confidence}) for ${path}. Attempting GB18030 decode first.`);
                            try {
                                // Try decoding as GB18030 first
                                const tempContent = iconv.decode(fileData, 'gb18030');
                                // Basic check for Mojibake
                                if (tempContent.includes('\uFFFD')) {
                                     console.warn(`[SFTP ${sessionId}] GB18030 decoding resulted in replacement characters. Falling back to original detection (${normalizedDetected}) or UTF-8.`);
                                     // Fallback: Try the originally detected encoding if supported, otherwise UTF-8
                                     if (iconv.encodingExists(normalizedDetected)) {
                                         encodingUsed = normalizedDetected;
                                         decodedContent = iconv.decode(fileData, encodingUsed);
                                         console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as originally detected ${encodingUsed}.`);
                                     } else {
                                         encodingUsed = 'utf-8';
                                         decodedContent = fileData.toString('utf8');
                                         console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as UTF-8.`);
                                     }
                                } else {
                                     encodingUsed = 'gb18030'; // Success with GB18030
                                     decodedContent = tempContent;
                                     console.log(`[SFTP ${sessionId}] Decoded ${path} as ${encodingUsed} due to low confidence detection.`);
                                }
                            } catch (gbkError) {
                                console.warn(`[SFTP ${sessionId}] Error decoding as GB18030, falling back to original detection (${normalizedDetected}) or UTF-8:`, gbkError);
                                // Fallback: Try the originally detected encoding if supported, otherwise UTF-8
                                if (iconv.encodingExists(normalizedDetected)) {
                                    encodingUsed = normalizedDetected;
                                    decodedContent = iconv.decode(fileData, encodingUsed);
                                    console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as originally detected ${encodingUsed}.`);
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
                            console.log(`[SFTP ${sessionId}] Decoded ${path} from ${encodingUsed} using iconv-lite (high confidence).`);
                        } else {
                            console.warn(`[SFTP ${sessionId}] Unsupported or unknown encoding detected for ${path}: ${normalizedDetected}. Falling back to UTF-8.`);
                            encodingUsed = 'utf-8'; // Final fallback
                            decodedContent = fileData.toString('utf8');
                        }
                    }

                    // Final check for replacement characters after deciding the encoding
                    if (decodedContent.includes('\uFFFD')) {
                         console.warn(`[SFTP ${sessionId}] Final decoded content for ${path} (using ${encodingUsed}) contains replacement characters (U+FFFD). Decoding might be incorrect. (ID: ${requestId})`);
                         // decodeError = `解码内容可能不正确 (使用 ${encodingUsed})，检测到无效字符。`; // Optionally set error
                    }

                } catch (err: any) {
                    console.error(`[SFTP ${sessionId}] Error detecting/decoding file content for ${path} (ID: ${requestId}):`, err);
                    decodeError = `文件编码检测或转换失败: ${err.message}`;
                    state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: decodeError, requestId: requestId }));
                    return; // Stop processing
                }

                // 发送 Base64 编码的原始数据和实际使用的编码
                console.log(`[SFTP ${sessionId}] Sending raw content (Base64) and encoding used (${encodingUsed}) for ${path} (ID: ${requestId})`);
                state.ws.send(JSON.stringify({
                    type: 'sftp:readfile:success',
                    path: path,
                    payload: {
                        rawContentBase64: fileData.toString('base64'), // 发送 Base64 字符串
                        encodingUsed: encodingUsed // 发送实际使用的编码
                    },
                    requestId: requestId
                }));
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] readFile ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: `读取文件时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 写入文件内容 (支持指定编码) */
    // --- 修改：添加 encoding 参数 ---
    async writefile(sessionId: string, path: string, data: string, requestId: string, encoding?: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 writefile (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
             return;
         }
        // --- 修改：使用传入的 encoding 或默认 utf-8 ---
        const targetEncoding = encoding || 'utf-8';
        console.debug(`[SFTP ${sessionId}] Received writefile request for ${path} (ID: ${requestId}, Encoding: ${targetEncoding})`);
        try {
            // --- 修改：使用 iconv-lite 根据指定编码创建 Buffer ---
            let buffer: Buffer;
            try {
                buffer = iconv.encode(data, targetEncoding);
                console.log(`[SFTP ${sessionId}] Encoded content for ${path} using ${targetEncoding} (Buffer size: ${buffer.length})`);
            } catch (encodeError: any) {
                 console.error(`[SFTP ${sessionId}] Failed to encode content for ${path} with encoding ${targetEncoding} (ID: ${requestId}):`, encodeError);
                 state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `无效的编码或编码失败: ${targetEncoding}`, requestId: requestId }));
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
                console.log(`[SFTP ${sessionId}] Retrieved original file mode for ${path}: ${originalMode.toString(8)} (ID: ${requestId})`);
            } catch (statError: any) {
                console.warn(`[SFTP ${sessionId}] Could not retrieve original file mode for ${path} (ID: ${requestId}):`, statError);
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
                console.error(`[SFTP ${sessionId}] writefile ${path} stream error (ID: ${requestId}):`, err);
                state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `写入文件流错误: ${err.message}`, requestId: requestId }));
            });

            // Listen for the 'close' event which indicates the stream has finished writing and the file descriptor is closed.
            writeStream.on('close', () => {
                if (!errorOccurred) {
                    console.log(`[SFTP ${sessionId}] writefile ${path} stream closed successfully (ID: ${requestId}). Fetching updated stats...`);
                    if (originalMode !== undefined) {
                        console.log(`[SFTP ${sessionId}] Set file mode for ${path} during creation: ${originalMode.toString(8)} (ID: ${requestId})`);
                    }
                    // Get updated stats after writing
                    state.sftp!.lstat(path, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after writefile ${path} failed (ID: ${requestId}):`, statErr);
                            state.ws.send(JSON.stringify({ type: 'sftp:writefile:success', path: path, payload: null, requestId: requestId }));
                        } else {
                            const updatedItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '',
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending writefile success with updated item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:writefile:success', path: path, payload: updatedItem, requestId: requestId }));
                        }
                    });
                }
            });

            console.debug(`[SFTP ${sessionId}] Writing ${buffer.length} bytes to ${path} (ID: ${requestId})`);
            writeStream.end(buffer); // Start writing and close the stream afterwards
            console.debug(`[SFTP ${sessionId}] writefile ${path} end() called (ID: ${requestId})`);

            // Success message is now sent in the 'close' event handler

        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] writefile ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `写入文件时发生意外错误: ${error.message}`, requestId: requestId }));
         }
    }

    /** 创建目录 */
    async mkdir(sessionId: string, path: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 mkdir (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received mkdir request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.mkdir(path, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] mkdir ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: `创建目录失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] mkdir ${path} success (ID: ${requestId}). Fetching stats...`);
                    // Get stats for the new directory
                    state.sftp!.lstat(path, (statErr, stats) => {
                         if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after mkdir ${path} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without item details
                            state.ws.send(JSON.stringify({ type: 'sftp:mkdir:success', path: path, payload: null, requestId: requestId }));
                         } else {
                            const newItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending mkdir success with new item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:mkdir:success', path: path, payload: newItem, requestId: requestId }));
                         }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] mkdir ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: `创建目录时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 删除目录 (强制递归) */
    async rmdir(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sshClient) { 
            console.warn(`[SSH Exec] SSH 客户端未准备好，无法在 ${sessionId} 上执行 rmdir (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: 'SSH 会话未就绪', requestId: requestId }));
            return;
        }
        const normalizedPath = pathModule.posix.normalize(path);
        if (!normalizedPath || normalizedPath === '/' || normalizedPath === '.') {
            state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path, payload: '拒绝删除根目录或无效目录。', requestId }));
            return;
        }
        console.debug(`[SSH Exec ${sessionId}] Received rmdir request for ${path} (ID: ${requestId})`);

        // 第一种方案：尝试 rm -rf 命令
        const tryRmRfCommand = async (isSudo: boolean) => {
            const commandPrefix = isSudo ? 'sudo ' : '';
            const command = `${commandPrefix}rm -rf -- ${quotePosixShellArg(path)}`;
            const attemptDescription = isSudo ? 'sudo rm -rf' : 'rm -rf';

            console.log(`[SSH Exec ${sessionId}] 尝试使用 ${attemptDescription} 命令删除 ${path} (ID: ${requestId})`);
            console.log(`[SSH Exec ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

            try {
                state.sshClient.exec(command, (err, stream) => {
                    if (err) {
                        console.error(`[SSH Exec ${sessionId}] Failed to start exec for ${attemptDescription} ${path} (ID: ${requestId}):`, err);
                        if (!isSudo) {
                            // 如果普通 rm -rf 失败，尝试 sudo rm -rf
                            tryRmRfCommand(true);
                        } else {
                            // 如果 sudo rm -rf 也失败
                            state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `删除目录失败: ${attemptDescription} 命令执行失败: ${err.message}`, requestId: requestId }));
                        }
                        return;
                    }

                    let stderrOutput = '';
                    stream.stderr.on('data', (data: Buffer) => {
                        stderrOutput += data.toString();
                    });

                    stream.on('close', (code: number | null, signal: string | null) => {
                        if (code === 0) {
                            console.log(`[SSH Exec ${sessionId}] ${attemptDescription} ${path} command executed successfully (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:rmdir:success', path: path, requestId: requestId }));
                        } else {
                            const errorMessage = stderrOutput.trim() || `命令退出，代码: ${code ?? 'N/A'}${signal ? `, 信号: ${signal}` : ''}`;
                            console.error(`[SSH Exec ${sessionId}] ${attemptDescription} ${path} command failed (ID: ${requestId}). Code: ${code}, Signal: ${signal}, Stderr: ${errorMessage}`);
                            if (!isSudo) {
                                // 如果普通 rm -rf 失败，尝试 sudo rm -rf
                                console.log(`[SSH Exec ${sessionId}] 普通 rm -rf 失败，错误: ${errorMessage}。尝试 sudo rm -rf。`);
                                tryRmRfCommand(true);
                            } else {
                                // 如果 sudo rm -rf 也失败
                                state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `删除目录失败: 普通 rm -rf 和 sudo rm -rf 命令均失败。最后错误: ${errorMessage}`, requestId: requestId }));
                            }
                        }
                    });

                    stream.on('data', (data: Buffer) => {
                        console.debug(`[SSH Exec ${sessionId}] ${attemptDescription} stdout (ID: ${requestId}): ${data.toString()}`);
                    });
                });
            } catch (error: any) {
                console.error(`[SSH Exec ${sessionId}] ${attemptDescription} ${path} caught unexpected error during exec setup (ID: ${requestId}):`, error);
                if (!isSudo) {
                     // 如果普通 rm -rf 期间发生意外错误，尝试 sudo rm -rf
                    console.log(`[SSH Exec ${sessionId}] 普通 rm -rf 发生意外错误。尝试 sudo rm -rf。`);
                    tryRmRfCommand(true);
                } else {
                    state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `删除目录失败: ${attemptDescription} 执行时发生意外错误: ${error.message}`, requestId: requestId }));
                }
            }
        };

        // 首先尝试不带 sudo 的 rm -rf
        tryRmRfCommand(false);
    }

    /** 删除文件 */
     async unlink(sessionId: string, path: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 unlink (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received unlink request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.unlink(path, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] unlink ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: `删除文件失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] unlink ${path} success (ID: ${requestId})`);
                    state.ws.send(JSON.stringify({ type: 'sftp:unlink:success', path: path, requestId: requestId })); // Send specific success type
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] unlink ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: `删除文件时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 重命名/移动文件或目录 */
     async rename(sessionId: string, oldPath: string, newPath: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 rename (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received rename request ${oldPath} -> ${newPath} (ID: ${requestId})`);
        try {
            state.sftp.rename(oldPath, newPath, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: `重命名/移动失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} success (ID: ${requestId}). Fetching stats for new path...`);
                    // Get stats for the new path
                    state.sftp!.lstat(newPath, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after rename ${newPath} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without item details
                            state.ws.send(JSON.stringify({ type: 'sftp:rename:success', payload: { oldPath: oldPath, newPath: newPath, newItem: null }, requestId: requestId }));
                        } else {
                            const newItem = {
                                filename: newPath.substring(newPath.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending rename success with new item for ${newPath} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:rename:success', payload: { oldPath: oldPath, newPath: newPath, newItem: newItem }, requestId: requestId }));
                        }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: `重命名/移动时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 修改文件/目录权限 */
     async chmod(sessionId: string, path: string, mode: number, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 chmod (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received chmod request for ${path} to ${mode.toString(8)} (ID: ${requestId})`);
        try {
            state.sftp.chmod(path, mode, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: `修改权限失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} success (ID: ${requestId}). Fetching updated stats...`);
                    // Get updated stats after chmod
                    state.sftp!.lstat(path, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after chmod ${path} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without updated item details
                            state.ws.send(JSON.stringify({ type: 'sftp:chmod:success', path: path, payload: null, requestId: requestId }));
                        } else {
                            const updatedItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending chmod success with updated item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:chmod:success', path: path, payload: updatedItem, requestId: requestId }));
                        }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] chmod ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: `修改权限时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }


    /** 获取路径的绝对表示 */
    async realpath(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 realpath (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        console.debug(`[SFTP ${sessionId}] Received realpath request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.realpath(path, (err, absPath) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] realpath ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: { requestedPath: path, error: `获取绝对路径失败: ${err.message}` }, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] realpath ${path} -> ${absPath} success (ID: ${requestId}). Fetching target type...`);
                    // 再次检查 state 和 state.sftp 是否仍然有效，因为回调是异步的
                    const currentState = this.clientStates.get(sessionId);
                    if (!currentState || !currentState.sftp) {
                        console.warn(`[SFTP ${sessionId}] SFTP session for ${absPath} became invalid before stat call (ID: ${requestId}).`);
                        // 即使 SFTP 会话失效，也尝试发送已解析的路径，但标记错误
                        state.ws.send(JSON.stringify({
                            type: 'sftp:realpath:error',
                            path: path, // 原始请求路径
                            payload: {
                                requestedPath: path,
                                absolutePath: absPath,
                                error: 'SFTP 会话在获取目标类型前已失效'
                            },
                            requestId: requestId
                        }));
                        return;
                    }
                    // 对 absPath 执行 stat 操作以获取其真实类型
                    currentState.sftp.stat(absPath, (statErr, stats) => { // 使用 sftp.stat()
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] stat on realpath target ${absPath} failed (ID: ${requestId}):`, statErr);
                            // 如果 stat 失败，发送带有错误信息的 realpath:error，但仍包含已解析的路径
                            state.ws.send(JSON.stringify({
                                type: 'sftp:realpath:error',
                                path: path, // 原始请求路径
                                payload: {
                                    requestedPath: path,
                                    absolutePath: absPath, // 仍然发送已解析的路径
                                    error: `获取目标类型失败: ${statErr.message}`
                                },
                                requestId: requestId
                            }));
                        } else {
                            let targetType: 'file' | 'directory' | 'unknown' = 'unknown';
                            if (stats.isFile()) {
                                targetType = 'file';
                            } else if (stats.isDirectory()) {
                                targetType = 'directory';
                            }
                            console.log(`[SFTP ${sessionId}] Target type for ${absPath} is ${targetType} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({
                                type: 'sftp:realpath:success',
                                path: path, // 原始请求路径
                                payload: {
                                    requestedPath: path,
                                    absolutePath: absPath,
                                    targetType: targetType // 新增字段
                                },
                                requestId: requestId
                            }));
                        }
                    });
                }
            });
        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] realpath ${path} caught unexpected error (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: `获取绝对路径时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    // +++ 复制文件或目录 +++
    async copy(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Copy] SFTP 未准备好，无法在 ${sessionId} 上执行 copy (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:copy:error', payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        const sftp = state.sftp;
        console.debug(`[SFTP ${sessionId}] Received copy request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`);

        const copiedItemsDetails: any[] = []; // Store details of successfully copied items
        let firstError: Error | null = null;

        try {
            // Ensure destination directory exists
            try {
                await this.ensureDirectoryExists(sftp, destinationDir);
            } catch (ensureErr: any) {
                 console.error(`[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists (ID: ${requestId}):`, ensureErr);
                 throw new Error(`无法创建或访问目标目录: ${ensureErr.message}`);
            }

            for (const sourcePath of sources) {
                const sourceName = pathModule.basename(sourcePath);
                const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

                if (sourcePath === destPath) {
                     console.warn(`[SFTP ${sessionId}] Skipping copy: source and destination are the same (${sourcePath}) (ID: ${requestId})`);
                     continue; // Skip if source and destination are identical
                }

                try {
                    const stats = await this.getTargetStats(sftp, sourcePath);
                    if (stats.isDirectory()) {
                        console.log(`[SFTP ${sessionId}] Copying directory ${sourcePath} to ${destPath} (ID: ${requestId})`);
                        await this.copyDirectoryRecursive(sftp, sourcePath, destPath);
                    } else if (stats.isFile()) {
                        console.log(`[SFTP ${sessionId}] Copying file ${sourcePath} to ${destPath} (ID: ${requestId})`);
                        await this.copyFile(sftp, sourcePath, destPath);
                    } else {
                        // Handle symlinks or other types if necessary, for now just skip/warn
                        console.warn(`[SFTP ${sessionId}] Skipping copy of unsupported file type: ${sourcePath} (ID: ${requestId})`);
                        continue;
                    }
                    // Get stats of the *newly copied* item
                    const copiedStats = await this.getStats(sftp, destPath);
                    copiedItemsDetails.push(this.formatStatsToFileListItem(destPath, copiedStats));

                } catch (copyErr: any) {
                    console.error(`[SFTP ${sessionId}] Error copying ${sourcePath} to ${destPath} (ID: ${requestId}):`, copyErr);
                    firstError = copyErr; // Store the first error encountered
                    break; // Stop processing further sources on error
                }
            }

            if (firstError) {
                throw firstError; // Throw the first error to be caught below
            }

            // Send success message with details of copied items
            console.log(`[SFTP ${sessionId}] Copy operation completed successfully (ID: ${requestId}). Copied items: ${copiedItemsDetails.length}`);
            state.ws.send(JSON.stringify({
                type: 'sftp:copy:success',
                payload: { destination: destinationDir, items: copiedItemsDetails },
                requestId: requestId
            }));

        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] Copy operation failed (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:copy:error', payload: `复制操作失败: ${error.message}`, requestId: requestId }));
        }
    }

    // +++ 移动文件或目录 +++
    async move(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Move] SFTP 未准备好，无法在 ${sessionId} 上执行 move (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:move:error', payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        const sftp = state.sftp;
        console.debug(`[SFTP ${sessionId}] Received move request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`);

        const movedItemsDetails: any[] = [];
        let firstError: Error | null = null;

        try {
             // Ensure destination directory exists (important for move)
            try {
                await this.ensureDirectoryExists(sftp, destinationDir);
            } catch (ensureErr: any) {
                 console.error(`[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists for move (ID: ${requestId}):`, ensureErr);
                 throw new Error(`无法创建或访问目标目录: ${ensureErr.message}`);
            }

            for (const oldPath of sources) {
                const sourceName = pathModule.basename(oldPath);
                const newPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

                 if (oldPath === newPath) {
                     console.warn(`[SFTP ${sessionId}] Skipping move: source and destination are the same (${oldPath}) (ID: ${requestId})`);
                     continue; // Skip if source and destination are identical
                 }

                try {
                    // --- 移动前检查目标是否存在 ---
                    let targetExists = false;
                    try {
                        await this.getStats(sftp, newPath);
                        targetExists = true;
                    } catch (statErr: any) {
                        if (!(statErr.code === 'ENOENT' || (statErr.message && statErr.message.includes('No such file')))) {
                            // 如果 stat 失败不是因为 "No such file"，则抛出未知错误
                            throw new Error(`检查目标路径 ${newPath} 状态时出错: ${statErr.message}`);
                        }
                        // 如果是 "No such file"，则 targetExists 保持 false，可以继续移动
                    }

                    if (targetExists) {
                        console.error(`[SFTP ${sessionId}] Move failed: Target path ${newPath} already exists (ID: ${requestId})`);
                        throw new Error(`目标路径 ${pathModule.basename(newPath)} 已存在`);
                    }
                    
                    console.log(`[SFTP ${sessionId}] Moving ${oldPath} to ${newPath} (ID: ${requestId})`);
                    await this.performRename(sftp, oldPath, newPath); // Use helper for rename logic

                    // Get stats of the *moved* item at the new location
                    const movedStats = await this.getStats(sftp, newPath);
                    movedItemsDetails.push(this.formatStatsToFileListItem(newPath, movedStats));

                } catch (moveErr: any) {
                    console.error(`[SFTP ${sessionId}] Error moving ${oldPath} to ${newPath} (ID: ${requestId}):`, moveErr);
                    firstError = moveErr;
                    break; // Stop on first error for move
                }
            }

            if (firstError) {
                throw firstError;
            }

            console.log(`[SFTP ${sessionId}] Move operation completed successfully (ID: ${requestId}). Moved items: ${movedItemsDetails.length}`);
            state.ws.send(JSON.stringify({
                type: 'sftp:move:success',
                payload: { sources: sources, destination: destinationDir, items: movedItemsDetails },
                requestId: requestId
            }));

        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] Move operation failed (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:move:error', payload: `移动操作失败: ${error.message}`, requestId: requestId }));
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

            writeStream.on('close', () => { // Use 'close' for write stream completion
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
        destPath: string,
        ancestorRealPaths: ReadonlySet<string> = new Set()
    ): Promise<void> {
        try {
            const realPath = await this.getRealPath(sftp, sourcePath);
            if (ancestorRealPaths.has(realPath)) {
                console.warn(`[SFTP Copy Recurse] Skipping circular symbolic link: ${sourcePath} -> ${realPath}`);
                return;
            }
            const nextAncestors = new Set(ancestorRealPaths);
            nextAncestors.add(realPath);

            // Create destination directory
            await this.ensureDirectoryExists(sftp, destPath);

            // Read source directory contents
            const items = await this.listDirectory(sftp, sourcePath);

            for (const item of items) {
                const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
                const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
                const itemStats = item.attrs.isSymbolicLink()
                    ? await this.getTargetStats(sftp, currentSourcePath)
                    : item.attrs;

                if (itemStats.isDirectory()) {
                    await this.copyDirectoryRecursive(sftp, currentSourcePath, currentDestPath, nextAncestors);
                } else if (itemStats.isFile()) {
                    await this.copyFile(sftp, currentSourcePath, currentDestPath);
                } else {
                    console.warn(`[SFTP Copy Recurse] Skipping unsupported type: ${currentSourcePath}`);
                }
            }
        } catch (error: any) {
            console.error(`Error recursively copying directory ${sourcePath} to ${destPath}:`, error);
            throw new Error(`递归复制目录失败: ${error.message}`);
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

    // Follow symbolic links when an operation needs the target type/content.
    private getTargetStats(sftp: SFTPWrapper, path: string): Promise<Stats> {
        return new Promise((resolve, reject) => {
            sftp.stat(path, (err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stats);
                }
            });
        });
    }

    private getRealPath(sftp: SFTPWrapper, path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            sftp.realpath(path, (err, realPath) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(realPath);
                }
            });
        });
    }

    // +++ 修改：辅助方法 - 确保目录存在 (递归创建) +++
    private async ensureDirectoryExists(sftp: SFTPWrapper, dirPath: string): Promise<void> {
        const normalizedPath = dirPath.replace(/\/$/, '');
        if (!normalizedPath || normalizedPath === '/') return;

        let sessionPromises = this.directoryEnsurePromises.get(sftp);
        if (!sessionPromises) {
            sessionPromises = new Map<string, Promise<void>>();
            this.directoryEnsurePromises.set(sftp, sessionPromises);
        }

        const existingPromise = sessionPromises.get(normalizedPath);
        if (existingPromise) {
            await existingPromise;
            return;
        }

        const ensurePromise = this.ensureDirectoryExistsInternal(sftp, normalizedPath)
            .finally(() => {
                sessionPromises?.delete(normalizedPath);
            });
        sessionPromises.set(normalizedPath, ensurePromise);
        await ensurePromise;
    }

    private async ensureDirectoryExistsInternal(sftp: SFTPWrapper, normalizedPath: string): Promise<void> {
        try {
            const stats = await this.getStats(sftp, normalizedPath);
            if (!stats.isDirectory()) {
                throw new Error(`路径 ${normalizedPath} 已存在但不是目录`);
            }
            return;
        } catch (statError: any) {
            const isMissing = statError.code === 'ENOENT'
                || (typeof statError.message === 'string' && statError.message.includes('No such file'));
            if (!isMissing) {
                throw new Error(`检查目录失败 ${normalizedPath}: ${statError.message}`);
            }
        }

        const parentDir = pathModule.dirname(normalizedPath).replace(/\\/g, '/');
        if (parentDir && parentDir !== '/' && parentDir !== '.') {
            await this.ensureDirectoryExists(sftp, parentDir);
        }

        try {
            await new Promise<void>((resolveMkdir, rejectMkdir) => {
                sftp.mkdir(normalizedPath, (mkdirErr) => {
                    if (mkdirErr) {
                        rejectMkdir(new Error(`创建目录失败 ${normalizedPath}: ${mkdirErr.message}`));
                    } else {
                        console.log(`[SFTP Util] Created directory: ${normalizedPath}`);
                        resolveMkdir();
                    }
                });
            });
        } catch (mkdirError: unknown) {
            // Some SFTP servers return a generic "Failure" when another request creates the
            // same directory first. Verify the final state and treat that race as success.
            const finalStats = await this.getStats(sftp, normalizedPath).catch(() => null);
            if (finalStats?.isDirectory()) {
                console.debug(`[SFTP Util] Directory already exists after concurrent mkdir: ${normalizedPath}`);
                return;
            }
            throw mkdirError;
        }
    }

     // +++ 辅助方法 - 列出目录内容 (Promise wrapper) +++
    private listDirectory(sftp: SFTPWrapper, path: string): Promise<SftpDirEntry[]> { // 使用本地接口 SftpDirEntry
        return new Promise((resolve, reject) => {
            sftp.readdir(path, (err, list) => { // list 的类型现在是 SftpDirEntry[]
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
                size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
            }
        };
    }


    // --- Compress/Decompress Methods ---
/**
     * 压缩远程服务器上的文件/目录
     * @param sessionId 会话 ID
     * @param payload 压缩请求的 payload
     */
    async compress(sessionId: string, payload: SftpCompressRequestPayload): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const { sources, destinationArchiveName, format, targetDirectory, requestId } = payload;
        const archiveKey = `${sessionId}:${requestId}`;

        if (!state?.sshClient) {
            this.sendCompressError(state?.ws, 'SSH 会话未就绪', requestId);
            return;
        }

        const requiredCommand = format === 'zip' ? 'zip' : 'tar';
        try {
            if (!await this.checkCommandExists(state, sessionId, requiredCommand)) {
                this.sendCompressError(state.ws, `命令 '${requiredCommand}' 在服务器上未找到`, requestId, `Command '${requiredCommand}' not found on server.`);
                return;
            }
        } catch (checkError: any) {
            this.sendCompressError(state.ws, `检查命令 '${requiredCommand}' 时出错`, requestId, checkError.message);
            return;
        }

        if (this.cancelledArchiveIds.delete(archiveKey)) return;

        const extension = format === 'zip' ? '.zip' : format === 'targz' ? '.tar.gz' : '.tar.bz2';
        const safeRequestId = requestId.replace(/[^A-Za-z0-9_-]/g, '_');
        const workspaceName = `.nexus-archive-${safeRequestId}.work`;
        const workspacePath = pathModule.posix.join(targetDirectory, workspaceName);
        const relativeSources: string[] = [];
        for (const source of sources) {
            const relativePath = pathModule.posix.relative(targetDirectory, source);
            if (relativePath === '..' || relativePath.startsWith('../')) {
                this.sendCompressError(state.ws, `压缩源路径不在目标目录内: ${source}`, requestId);
                return;
            }
            const normalized = (relativePath === '' || relativePath === '.')
                ? pathModule.posix.basename(source)
                : relativePath;
            relativeSources.push(`./${normalized.replace(/^\.\/+/, '')}`);
        }

        const workspaceRelativePath = `./${workspaceName}`;
        const temporaryArchiveRelativePath = `${workspaceRelativePath}/archive${extension}`;
        const destinationArchiveRelativePath = `./${destinationArchiveName}`;
        const quotedSources = relativeSources.map(quotePosixShellArg).join(' ');
        const quotedTargetDir = quotePosixShellArg(targetDirectory);
        const quotedWorkspace = quotePosixShellArg(workspaceRelativePath);
        const quotedTemporaryArchive = quotePosixShellArg(temporaryArchiveRelativePath);
        const quotedDestinationName = quotePosixShellArg(destinationArchiveRelativePath);
        const countCommand = `total=$(find ${quotedSources} -print 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
        const archiveCommand = format === 'zip'
            ? `zip -b ${quotedWorkspace} -r ${quotedTemporaryArchive} ${quotedSources}`
            : format === 'targz'
                ? `tar -czvf ${quotedTemporaryArchive} ${quotedSources}`
                : `tar -cjvf ${quotedTemporaryArchive} ${quotedSources}`;
        const cleanupFunction = [
            'cleanup_archive() {',
            'status=$?;',
            'trap - EXIT HUP INT TERM;',
            'if [ -n "${archive_pid:-}" ]; then kill "$archive_pid" 2>/dev/null || true; stop_attempt=0; while kill -0 "$archive_pid" 2>/dev/null && [ "$stop_attempt" -lt 5 ]; do sleep 0.2; stop_attempt=$((stop_attempt + 1)); done; kill -9 "$archive_pid" 2>/dev/null || true; wait "$archive_pid" 2>/dev/null || true; fi;',
            `rm -rf -- ${quotedWorkspace};`,
            'exit "$status";',
            '}',
        ].join(' ');
        const archiveResultCheck = format === 'zip'
            ? `if [ "$archive_status" -ne 0 ]; then if [ -s ${quotedTemporaryArchive} ] && zip -T ${quotedTemporaryArchive} >/dev/null 2>&1; then printf '${ARCHIVE_WARNING_MARKER}%s\n' "$archive_status"; else exit "$archive_status"; fi; fi`
            : 'if [ "$archive_status" -ne 0 ]; then exit "$archive_status"; fi';
        const command = [
            `cd ${quotedTargetDir} || exit $?`,
            `rm -rf -- ${quotedWorkspace}`,
            `mkdir -p -- ${quotedWorkspace} || exit $?`,
            cleanupFunction,
            'trap cleanup_archive EXIT HUP INT TERM',
            countCommand,
            `${archiveCommand} & archive_pid=$!`,
            'wait "$archive_pid"; archive_status=$?; archive_pid=',
            archiveResultCheck,
            `mv -f -- ${quotedTemporaryArchive} ${quotedDestinationName}`,
        ].join('; ');

        try {
            state.sshClient.exec(command, (err, stream) => {
                if (err) {
                    this.sendCompressError(state.ws, `执行压缩命令失败: ${err.message}`, requestId);
                    return;
                }
                if (this.cancelledArchiveIds.delete(archiveKey)) {
                    void this.stopArchiveChannel(stream)
                        .then(() => this.removeRemoteArchiveWorkspace(sessionId, workspacePath));
                    return;
                }

                let stderrData = '';
                let stdoutRemainder = '';
                let stderrRemainder = '';
                let fileCount = 0;
                let totalFiles: number | undefined;
                let archiveWarningCode: number | undefined;
                let archiveWarningData = '';
                let lastProgressTime = 0;
                let lastSeenFileName: string | undefined;
                let streamFinished = false;

                const sendProgress = (force = false) => {
                    const now = Date.now();
                    if (!force && now - lastProgressTime < 1000) return;
                    lastProgressTime = now;
                    this.sendArchiveProgress(state.ws, 'compress', requestId, fileCount, lastSeenFileName, totalFiles);
                };
                const consumeOutput = (chunk: string, remainder: string): string => {
                    const lines = `${remainder}${chunk}`.split(/\r?\n/);
                    const nextRemainder = lines.pop() || '';
                    for (const line of lines) {
                        const parsedTotal = this.parseArchiveTotal(line);
                        if (parsedTotal !== null) {
                            totalFiles = parsedTotal > 0 ? parsedTotal : undefined;
                            sendProgress(true);
                            continue;
                        }
                        const parsedWarningCode = this.parseArchiveWarningCode(line);
                        if (parsedWarningCode !== null) {
                            archiveWarningCode = parsedWarningCode;
                            continue;
                        }
                        if (/\b(?:zip|tar) warning:/i.test(line)) {
                            archiveWarningData = this.appendBoundedOutput(archiveWarningData, `${line.trim()}\n`, 8192);
                        }
                        const fileName = this.parseArchiveFileName(line, format);
                        if (fileName) {
                            fileCount++;
                            lastSeenFileName = fileName;
                        }
                    }
                    if (lastSeenFileName) sendProgress();
                    return nextRemainder;
                };

                const heartbeatInterval = setInterval(() => sendProgress(true), 10000);
                const operation: ActiveArchiveOperation = {
                    sessionId,
                    requestId,
                    workspacePath,
                    stream,
                    heartbeatInterval,
                    cancelled: false,
                };
                this.activeArchives.set(archiveKey, operation);

                stream.on('data', (data: Buffer) => { stdoutRemainder = consumeOutput(data.toString(), stdoutRemainder); });
                stream.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString();
                    stderrData = this.appendBoundedOutput(stderrData, chunk);
                    stderrRemainder = consumeOutput(chunk, stderrRemainder);
                });
                stream.on('close', (exitCode: number | null) => {
                    if (streamFinished) return;
                    streamFinished = true;
                    clearInterval(heartbeatInterval);
                    const active = this.activeArchives.get(archiveKey);
                    if (active === operation) this.activeArchives.delete(archiveKey);
                    if (operation.cancelled || !active) return;

                    if (stdoutRemainder) stdoutRemainder = consumeOutput(`${stdoutRemainder}\n`, '');
                    if (stderrRemainder) stderrRemainder = consumeOutput(`${stderrRemainder}\n`, '');
                    if (fileCount > 0) sendProgress(true);
                    if (exitCode === 0) {
                        const warningDetails = archiveWarningData.trim() || (archiveWarningCode !== undefined
                            ? `ZIP 完成时返回警告代码 ${archiveWarningCode}，部分在压缩期间变化或消失的文件可能未包含在归档中。`
                            : undefined);
                        const successPayload: SftpCompressSuccessPayload = {
                            message: warningDetails ? '压缩完成，但存在警告' : '压缩成功',
                            requestId,
                            ...(warningDetails ? { warning: warningDetails } : {}),
                        };
                        if (state.ws.readyState === WebSocket.OPEN) {
                            state.ws.send(JSON.stringify({ type: 'sftp:compress:success', requestId, payload: successPayload }));
                        }
                    } else {
                        void this.removeRemoteArchiveWorkspace(sessionId, workspacePath);
                        const details = stderrData.trim() || `压缩命令退出，代码: ${exitCode ?? 'N/A'}`;
                        this.sendCompressError(state.ws, '压缩失败', requestId, details);
                    }
                });
                stream.on('error', (streamError: Error) => {
                    if (streamFinished) return;
                    streamFinished = true;
                    clearInterval(heartbeatInterval);
                    if (this.activeArchives.get(archiveKey) === operation) this.activeArchives.delete(archiveKey);
                    if (operation.cancelled) return;
                    void this.removeRemoteArchiveWorkspace(sessionId, workspacePath);
                    this.sendCompressError(state.ws, '压缩命令流错误', requestId, streamError.message);
                });
            });
        } catch (execError: any) {
            void this.removeRemoteArchiveWorkspace(sessionId, workspacePath);
            this.sendCompressError(state.ws, `执行压缩时发生意外错误: ${execError.message}`, requestId);
        }
    }

    async cancelArchive(sessionId: string, requestId: string, notifyClient = true): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const archiveKey = `${sessionId}:${requestId}`;
        const operation = this.activeArchives.get(archiveKey);
        this.cancelledArchiveIds.add(archiveKey);

        let cleaned = true;
        if (operation) {
            operation.cancelled = true;
            this.activeArchives.delete(archiveKey);
            clearInterval(operation.heartbeatInterval);
            await this.stopArchiveChannel(operation.stream);
            cleaned = await this.removeRemoteArchiveWorkspace(sessionId, operation.workspacePath);
            this.cancelledArchiveIds.delete(archiveKey);
        } else {
            // Cancellation may arrive while command availability is still being checked.
            // compress() consumes this marker before creating any workspace.
            setTimeout(() => this.cancelledArchiveIds.delete(archiveKey), 30000);
        }

        if (notifyClient && state?.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: 'sftp:archive:cancelled',
                requestId,
                payload: { requestId, cleaned },
            }));
        }
    }


    /** Ask the remote wrapper shell to stop its compressor, then wait for its EXIT trap. */
    private async stopArchiveChannel(stream: ClientChannel): Promise<void> {
        await new Promise<void>((resolve) => {
            let settled = false;
            let forceCloseTimer: ReturnType<typeof setTimeout> | undefined;
            let finalTimer: ReturnType<typeof setTimeout> | undefined;

            const finish = () => {
                if (settled) return;
                settled = true;
                if (forceCloseTimer) clearTimeout(forceCloseTimer);
                if (finalTimer) clearTimeout(finalTimer);
                stream.off('close', onClose);
                stream.off('error', onError);
                resolve();
            };
            const onClose = () => finish();
            const onError = () => finish();

            stream.once('close', onClose);
            stream.once('error', onError);
            try {
                stream.signal('TERM');
            } catch {
                // The channel may already be closing; the listeners/timeouts still settle.
            }

            forceCloseTimer = setTimeout(() => {
                if (settled) return;
                try {
                    stream.close();
                } catch {
                    stream.destroy();
                }
            }, 1500);
            finalTimer = setTimeout(() => {
                if (!stream.destroyed) stream.destroy();
                finish();
            }, 4000);
        });
    }

    /**
     * 解压远程服务器上的压缩文件
     * @param sessionId 会话 ID
     * @param payload 解压请求的 payload
     */
    async decompress(sessionId: string, payload: SftpDecompressRequestPayload): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const { archivePath, requestId } = payload;

        if (!state || !state.sshClient) {
            console.warn(`[SFTP Decompress] SSH 客户端未准备好，无法在 ${sessionId} 上执行 decompress (ID: ${requestId})`);
            this.sendDecompressError(state?.ws, 'SSH 会话未就绪', requestId);
            return;
        }

        const lowerArchivePath = archivePath.toLowerCase(); // 在此声明一次

        // 命令检查
        let requiredCommand = '';
        // 使用已经声明的 lowerArchivePath
        if (lowerArchivePath.endsWith('.zip')) {
            requiredCommand = 'unzip';
        } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz') || lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
            requiredCommand = 'tar';
        } else {
            this.sendDecompressError(state.ws, `不支持的压缩文件格式: ${archivePath}`, requestId);
            return;
        }

        try {
            const commandExists = await this.checkCommandExists(state, sessionId, requiredCommand); // 传递 sessionId
            if (!commandExists) {
                this.sendDecompressError(state.ws, `命令 '${requiredCommand}' 在服务器上未找到`, requestId, `Command '${requiredCommand}' not found on server.`);
                return;
            }
        } catch (checkError: any) {
            this.sendDecompressError(state.ws, `检查命令 '${requiredCommand}' 时出错`, requestId, checkError.message);
            return;
        }

        console.debug(`[SFTP Decompress ${sessionId}] Received request for ${archivePath} (ID: ${requestId})`);

        const extractDir = pathModule.posix.dirname(archivePath);
        const archiveBasename = pathModule.posix.basename(archivePath);
        const safeArchiveArgument = archiveBasename.startsWith('-') ? `./${archiveBasename}` : archiveBasename;

        // --- 构建 Shell 命令 ---
        let command: string;
        // 确保路径被正确引用
        const quotedExtractDir = quotePosixShellArg(extractDir);
        const quotedArchiveBasename = quotePosixShellArg(safeArchiveArgument);

        const cdCommand = `cd ${quotedExtractDir}`;

        // 使用在方法开始处声明的 lowerArchivePath
        if (lowerArchivePath.endsWith('.zip')) {
            // List first to provide an exact total; extraction still proceeds when the
            // listing command cannot determine a count (the pipeline yields zero).
            const countCommand = `total=$(unzip -Z1 ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
            command = `${cdCommand} && ${countCommand} && unzip -o ${quotedArchiveBasename}`;
        } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
            const countCommand = `total=$(tar -tzf ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
            command = `${cdCommand} && ${countCommand} && tar -xzvf ${quotedArchiveBasename}`;
        } else if (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
            const countCommand = `total=$(tar -tjf ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
            command = `${cdCommand} && ${countCommand} && tar -xjvf ${quotedArchiveBasename}`;
        } else {
            this.sendDecompressError(state.ws, `不支持的压缩文件格式: ${archivePath}`, requestId);
            return;
        }

        console.log(`[SFTP Decompress ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

        // --- 执行命令 ---
        try {
            state.sshClient.exec(command, (err, stream) => {
                if (err) {
                    console.error(`[SFTP Decompress ${sessionId}] Failed to start exec for decompress (ID: ${requestId}):`, err);
                    this.sendDecompressError(state.ws, `执行解压命令失败: ${err.message}`, requestId);
                    return;
                }

                let stderrData = '';
                let stdoutRemainder = '';
                let stderrRemainder = '';
                let code: number | null = null;
                let fileCount = 0;
                let totalFiles: number | undefined;
                let lastProgressTime = 0;
                let lastSeenFileName: string | undefined;
                let streamFinished = false;
                const progressFormat: 'decompress' | 'targz' | 'tarbz2' = lowerArchivePath.endsWith('.zip')
                    ? 'decompress'
                    : (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2') ? 'tarbz2' : 'targz');

                const sendProgress = (force = false) => {
                    const now = Date.now();
                    if (!force && now - lastProgressTime < 1000) return;
                    lastProgressTime = now;
                    this.sendArchiveProgress(state.ws, 'decompress', requestId, fileCount, lastSeenFileName, totalFiles);
                };

                const consumeOutput = (chunk: string, remainder: string): string => {
                    const lines = `${remainder}${chunk}`.split(/\r?\n/);
                    const nextRemainder = lines.pop() || '';
                    for (const line of lines) {
                        const parsedTotal = this.parseArchiveTotal(line);
                        if (parsedTotal !== null) {
                            totalFiles = parsedTotal > 0 ? parsedTotal : undefined;
                            sendProgress(true);
                            continue;
                        }
                        const fileName = this.parseArchiveFileName(line, progressFormat);
                        if (fileName) {
                            fileCount++;
                            lastSeenFileName = fileName;
                        }
                    }
                    if (lastSeenFileName) sendProgress();
                    return nextRemainder;
                };

                const heartbeatInterval = setInterval(() => sendProgress(true), 10000);

                stream.on('data', (data: Buffer) => {
                    // 必须持续消费 stdout，否则大型归档会耗尽 SSH 通道窗口并永久挂起。
                    stdoutRemainder = consumeOutput(data.toString(), stdoutRemainder);
                });
                stream.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString();
                    stderrData = this.appendBoundedOutput(stderrData, chunk);
                    stderrRemainder = consumeOutput(chunk, stderrRemainder);
                });

                stream.on('close', (exitCode: number | null) => {
                    if (streamFinished) return;
                    streamFinished = true;
                    clearInterval(heartbeatInterval);
                    if (stdoutRemainder) stdoutRemainder = consumeOutput(`${stdoutRemainder}\n`, '');
                    if (stderrRemainder) stderrRemainder = consumeOutput(`${stderrRemainder}\n`, '');
                    code = exitCode;
                    if (fileCount > 0) sendProgress(true);
                    console.log(`[SFTP Decompress ${sessionId}] Command finished with code ${code} (ID: ${requestId}). Stderr: ${stderrData.trim()}`);
                    if (code === 0 && !this.isErrorInStdErr(stderrData)) { // 检查退出码和 stderr
                        console.log(`[SFTP Decompress ${sessionId}] Decompression successful (ID: ${requestId}).`);
                        const successPayload: SftpDecompressSuccessPayload = {
                            message: '解压成功',
                            requestId: requestId
                        };
                         if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                            state.ws.send(JSON.stringify({ type: 'sftp:decompress:success', requestId: requestId, payload: successPayload })); // Ensure requestId is included
                         }
                    } else {
                        const errorDetails = stderrData.trim() || `解压命令退出，代码: ${code ?? 'N/A'}`;
                        console.error(`[SFTP Decompress ${sessionId}] Decompression failed (ID: ${requestId}): ${errorDetails}`);
                        this.sendDecompressError(state.ws, '解压失败', requestId, errorDetails);
                    }
                });
                 stream.on('error', (streamErr: Error) => {
                     if (streamFinished) return;
                     streamFinished = true;
                     clearInterval(heartbeatInterval);
                     console.error(`[SFTP Decompress ${sessionId}] Command stream error (ID: ${requestId}):`, streamErr);
                     this.sendDecompressError(state.ws, '解压命令流错误', requestId, streamErr.message);
                 });
            });
        } catch (execError: any) {
            console.error(`[SFTP Decompress ${sessionId}] Decompress command caught unexpected error during exec setup (ID: ${requestId}):`, execError);
            this.sendDecompressError(state.ws, `执行解压时发生意外错误: ${execError.message}`, requestId);
        }
    }

    // --- 辅助方法 ---

    /** 检查远程服务器上是否存在指定的命令 */
    private checkCommandExists(state: ClientState, sessionId: string, commandName: string): Promise<boolean> {
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
                        console.error(`[SFTP Command Check ${sessionId}] Failed to start exec for "${checkCmd}":`, err);
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
                            console.log(`[SFTP Command Check ${sessionId}] Command '${commandName}' found using "${checkCmd}". Output: ${output.trim()}`);
                            resolve(true);
                        } else {
                            console.log(`[SFTP Command Check ${sessionId}] Command '${commandName}' not found with "${checkCmd}" (code: ${code}, output: "${output.trim()}").`);
                            currentCheckIndex++;
                            tryCommand(); // 尝试下一个检查命令
                        }
                    });
                    stream.stderr.on('data', (data: Buffer) => {
                        // console.debug(`[SFTP Command Check ${sessionId}] stderr for "${checkCmd}": ${data.toString()}`);
                    });
                    stream.on('error', (streamErr: Error) => {
                        console.error(`[SFTP Command Check ${sessionId}] Stream error for "${checkCmd}":`, streamErr);
                        currentCheckIndex++;
                        tryCommand(); // 尝试下一个检查命令
                    });
                });
            };
            tryCommand();
        });
    }


    /** 发送压缩错误消息 */
    private sendCompressError(ws: AuthenticatedWebSocket | undefined, error: string, requestId: string, details?: string): void {
         if (ws && ws.readyState === WebSocket.OPEN) {
            const payload: SftpCompressErrorPayload = { error, requestId };
            if (details) payload.details = details;
            // 检查是否是命令未找到的特定错误
            if (error.includes('在服务器上未找到')) {
                 ws.send(JSON.stringify({ type: 'sftp:command_not_found', payload: { operation: 'compress', command: error.match(/'([^']+)'/)?.[1] || 'unknown', message: details || error }, requestId }));
            } else {
                 ws.send(JSON.stringify({ type: 'sftp:compress:error', requestId, payload }));
            }
         } else {
             console.warn(`[SFTP Compress] WebSocket closed or invalid, cannot send error for request ${requestId}.`);
         }
    }

    /** 发送解压错误消息 */
    private sendDecompressError(ws: AuthenticatedWebSocket | undefined, error: string, requestId: string, details?: string): void {
         if (ws && ws.readyState === WebSocket.OPEN) {
            const payload: SftpDecompressErrorPayload = { error, requestId };
            if (details) payload.details = details;
            // 检查是否是命令未找到的特定错误
            if (error.includes('在服务器上未找到')) {
                ws.send(JSON.stringify({ type: 'sftp:command_not_found', payload: { operation: 'decompress', command: error.match(/'([^']+)'/)?.[1] || 'unknown', message: details || error }, requestId }));
            } else {
                ws.send(JSON.stringify({ type: 'sftp:decompress:error', requestId, payload }));
            }
        } else {
             console.warn(`[SFTP Decompress] WebSocket closed or invalid, cannot send error for request ${requestId}.`);
         }
    }

    /** 只保留最近的命令错误输出，避免大型归档把整个进程输出留在内存中。 */
    private appendBoundedOutput(existing: string, chunk: string, maxLength = 65536): string {
        const combined = existing + chunk;
        return combined.length > maxLength ? combined.slice(-maxLength) : combined;
    }

    /** Parse the private line emitted before an archive command starts. */
    private parseArchiveTotal(line: string): number | null {
        const trimmed = line.trim();
        if (!trimmed.startsWith(ARCHIVE_TOTAL_MARKER)) return null;
        const total = Number.parseInt(trimmed.slice(ARCHIVE_TOTAL_MARKER.length), 10);
        return Number.isFinite(total) && total >= 0 ? total : 0;
    }

    /** Parse a warning exit code emitted after a valid ZIP archive was preserved. */
    private parseArchiveWarningCode(line: string): number | null {
        const trimmed = line.trim();
        if (!trimmed.startsWith(ARCHIVE_WARNING_MARKER)) return null;
        const code = Number.parseInt(trimmed.slice(ARCHIVE_WARNING_MARKER.length), 10);
        return Number.isFinite(code) && code > 0 ? code : 0;
    }

    /** 从 zip、tar 和 unzip 的详细输出中提取正在处理的文件名。 */
    private parseArchiveFileName(line: string, format: 'zip' | 'targz' | 'tarbz2' | 'decompress'): string | null {
        const trimmed = line.trim();
        if (!trimmed) return null;

        if (format === 'zip') {
            const match = trimmed.match(/^adding:\s+(.+?)(?:\s+\(.*\))?$/i);
            return match?.[1]?.trim() || null;
        }

        if (format === 'decompress') {
            const match = trimmed.match(/^(?:inflating|extracting|creating):\s+(.+)/i);
            return match?.[1]?.trim() || null;
        }

        if (!trimmed.startsWith('/') && !/^tar(?:\s|:|\()/i.test(trimmed) && trimmed.length < 1024 && !/^[A-Za-z]+:\s/.test(trimmed)) {
            return trimmed;
        }
        return null;
    }

    /** 发送归档进度或心跳；前端据此重置空闲超时。 */
    private sendArchiveProgress(
        ws: AuthenticatedWebSocket | undefined,
        operation: 'compress' | 'decompress',
        requestId: string,
        fileCount: number,
        currentFile?: string,
        totalFiles?: number,
    ): void {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const percent = totalFiles && totalFiles > 0
                ? Math.min(100, Math.round((fileCount / totalFiles) * 100))
                : undefined;
            ws.send(JSON.stringify({
                type: `sftp:${operation}:progress`,
                requestId,
                payload: { requestId, fileCount, totalFiles, percent, currentFile },
            }));
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
            'error', 'fail', 'cannot', 'not found', 'no such file', 'permission denied', 'invalid', '不支持'
        ];
        // tar/zip 进度信息通常包含百分比或文件名，不应视为错误
        if (/[\d.]+%/.test(stderr) || /adding:/.test(lowerStderr) || /inflating:/.test(lowerStderr) || /extracting:/.test(lowerStderr)) {
            // 忽略一些明确的非错误输出
            if (errorPatterns.some(pattern => lowerStderr.includes(pattern))) {
                 // 如果进度信息中包含错误关键词，则可能真的是错误
                 return true;
            }
            return false;
        }

        return errorPatterns.some(pattern => lowerStderr.includes(pattern));
    }


    // --- File Upload Methods ---

    private normalizeUploadBasePath(basePath: string): string {
        const normalized = pathModule.posix.normalize(basePath.replace(/\\/g, '/'));
        if (!pathModule.posix.isAbsolute(normalized)) {
            throw new Error(`上传目标基础路径必须是绝对路径: ${basePath}`);
        }
        return normalized;
    }

    private normalizeUploadRelativeDirectory(relativePath: string): string {
        const slashNormalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
        const normalized = pathModule.posix.normalize(slashNormalized).replace(/\/$/, '');
        if (!normalized || normalized === '.') return '';
        if (pathModule.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
            throw new Error(`上传目录包含非法路径: ${relativePath}`);
        }
        return normalized;
    }

    private resolvePreparedUploadDirectory(basePath: string, relativePath: string): string {
        const fullPath = pathModule.posix.normalize(pathModule.posix.join(basePath, relativePath));
        const isInsideBase = basePath === '/'
            ? fullPath.startsWith('/')
            : fullPath === basePath || fullPath.startsWith(`${basePath}/`);
        if (!isInsideBase) {
            throw new Error(`上传目录超出目标基础路径: ${relativePath}`);
        }
        return fullPath;
    }

    /** Create the complete remote directory tree before any file stream is opened. */
    async prepareUploadDirectories(
        sessionId: string,
        prepareId: string,
        basePath: string,
        directories: string[],
    ): Promise<{ preparedDirectories: number }> {
        const state = this.clientStates.get(sessionId);
        if (!state?.sftp) throw new Error('SFTP 会话未就绪');
        if (!prepareId || prepareId.length > 512) throw new Error('上传准备任务 ID 无效');
        if (!Array.isArray(directories) || directories.length > 20000) {
            throw new Error('上传目录列表无效或数量过多');
        }

        const normalizedBasePath = this.normalizeUploadBasePath(basePath);
        const fullDirectories = new Set<string>([normalizedBasePath]);
        for (const directory of directories) {
            if (typeof directory !== 'string') throw new Error('上传目录必须是字符串');
            const normalizedRelative = this.normalizeUploadRelativeDirectory(directory);
            fullDirectories.add(this.resolvePreparedUploadDirectory(normalizedBasePath, normalizedRelative));
        }

        // Create the base path once, then parallelize by independent first-level branches.
        // Directories inside the same branch are created sequentially so concurrent mkdir
        // requests never race on one shared branch root.
        await this.ensureDirectoryExists(state.sftp, normalizedBasePath);

        const branchDirectories = new Map<string, string[]>();
        for (const directory of fullDirectories) {
            if (directory === normalizedBasePath) continue;
            const relativeDirectory = pathModule.posix.relative(normalizedBasePath, directory);
            const branchRoot = relativeDirectory.split('/')[0];
            const branch = branchDirectories.get(branchRoot) ?? [];
            branch.push(directory);
            branchDirectories.set(branchRoot, branch);
        }

        const branches = [...branchDirectories.values()]
            .map((branch) => branch.sort((left, right) => {
                const depthDiff = left.split('/').length - right.split('/').length;
                return depthDiff || left.localeCompare(right);
            }))
            .sort((left, right) => right.length - left.length);

        let nextBranchIndex = 0;
        const workerCount = Math.min(UPLOAD_DIRECTORY_PREPARE_CONCURRENCY, branches.length);
        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (nextBranchIndex < branches.length) {
                const branch = branches[nextBranchIndex++];
                for (const directory of branch) {
                    await this.ensureDirectoryExists(state.sftp!, directory);
                }
            }
        }));

        this.preparedUploadBatches.set(prepareId, {
            sessionId,
            basePath: normalizedBasePath,
            directories: fullDirectories,
        });
        console.log(`[SFTP Upload Prepare ${prepareId}] Prepared ${fullDirectories.size} directories in ${branches.length} independent branches under ${normalizedBasePath}.`);
        return { preparedDirectories: fullDirectories.size };
    }

    /** Start a new file upload */
    async startUpload(
        sessionId: string,
        uploadId: string,
        remotePath: string,
        totalSize: number,
        relativePath?: string,
        prepareId?: string,
    ): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Upload ${uploadId}] SFTP not ready for session ${sessionId}.`);
            state?.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: 'SFTP 会话未就绪' } }));
            return;
        }
        if (this.activeUploads.has(uploadId) || this.pendingUploads.has(uploadId)) {
            console.warn(`[SFTP Upload ${uploadId}] Upload already in progress for session ${sessionId}.`);
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: 'Upload already started' } }));
            return;
        }

        const normalizedRemotePath = pathModule.posix.normalize(remotePath.replace(/\\/g, '/'));
        const targetDirectory = pathModule.posix.dirname(normalizedRemotePath);
        let directoryWasPrepared = false;
        if (prepareId) {
            const preparedBatch = this.preparedUploadBatches.get(prepareId);
            if (!preparedBatch || preparedBatch.sessionId !== sessionId) {
                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: '上传目录尚未准备完成' } }));
                return;
            }
            const isInsidePreparedBase = preparedBatch.basePath === '/'
                ? targetDirectory.startsWith('/')
                : targetDirectory === preparedBatch.basePath || targetDirectory.startsWith(`${preparedBatch.basePath}/`);
            if (!isInsidePreparedBase) {
                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: '上传文件路径超出已准备目录' } }));
                return;
            }
            if (!preparedBatch.directories.has(targetDirectory)) {
                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `上传目录未在准备阶段创建: ${targetDirectory}` } }));
                return;
            }
            directoryWasPrepared = true;
        }
        const temporaryPath = pathModule.posix.join(targetDirectory, `.nexus-upload-${uploadId}.part`);
        this.pendingUploads.set(uploadId, { sessionId, remotePath: normalizedRemotePath, temporaryPath });

        const stopIfCancelled = async (): Promise<boolean> => {
            if (!this.cancelledUploadIds.has(uploadId)) return false;
            await this.removeRemoteUploadFile(sessionId, temporaryPath);
            return true;
        };

        try {
            // Prepared batches create their complete directory tree before uploads start.
            // Keep the legacy fallback for older clients that do not send a prepareId.
            if (!directoryWasPrepared) await this.ensureDirectoryExists(state.sftp, targetDirectory);
            if (await stopIfCancelled()) return;

            // createWriteStream already creates/truncates the temporary file. Avoiding a
            // separate open+close probe removes two SFTP round trips for every small file.
            const stream = state.sftp.createWriteStream(temporaryPath, {
                highWaterMark: UPLOAD_WRITE_HIGH_WATER_MARK,
            });
            const uploadState: ActiveUpload = {
                remotePath: normalizedRemotePath,
                temporaryPath,
                totalSize,
                bytesAccepted: 0,
                bytesWritten: 0,
                nextChunkIndex: 0,
                receivedLastChunk: false,
                stream,
                sessionId,
                relativePath,
                drainPromise: null,
            };
            this.activeUploads.set(uploadId, uploadState);

            stream.on('error', (err: Error) => {
                if (this.activeUploads.get(uploadId) !== uploadState) return;
                console.error(`[SFTP Upload ${uploadId}] WriteStream error for ${temporaryPath}:`, err);
                if (state.ws.readyState === WebSocket.OPEN) {
                    state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `写入流错误: ${err.message}` } }));
                }
                void this.cancelUploadInternal(uploadId, `Write stream error: ${err.message}`, err);
            });

            stream.on('close', () => {
                const finalState = this.activeUploads.get(uploadId);
                if (!finalState) return; // Cancel/error already owns cleanup.

                if (finalState.bytesWritten !== finalState.totalSize || !finalState.receivedLastChunk) {
                    const message = `最终文件不完整（写入 ${finalState.bytesWritten}/${finalState.totalSize} 字节，结束分块: ${finalState.receivedLastChunk ? '是' : '否'}）`;
                    if (state.ws.readyState === WebSocket.OPEN) {
                        state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message } }));
                    }
                    void this.cancelUploadInternal(uploadId, message);
                    return;
                }

                void this.finalizeUploadedFile(uploadId, finalState)
                    .then((stats) => {
                        if (state.ws.readyState !== WebSocket.OPEN) return;
                        const finalStatsPayload = {
                            filename: pathModule.posix.basename(finalState.remotePath),
                            longname: '',
                            attrs: {
                                size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                            }
                        };
                        state.ws.send(JSON.stringify({
                            type: 'sftp:upload:success',
                            payload: finalStatsPayload,
                            uploadId,
                            path: finalState.remotePath,
                        }));
                    })
                    .catch(async (error: Error) => {
                        console.error(`[SFTP Upload ${uploadId}] Failed to finalize ${finalState.remotePath}:`, error);
                        await this.removeRemoteUploadFile(sessionId, finalState.temporaryPath);
                        if (state.ws.readyState === WebSocket.OPEN) {
                            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `完成上传失败: ${error.message}` } }));
                        }
                    })
                    .finally(() => {
                        this.activeUploads.delete(uploadId);
                        this.cancelledUploadIds.delete(uploadId);
                    });
            });

            state.ws.send(JSON.stringify({ type: 'sftp:upload:ready', payload: { uploadId } }));
        } catch (error: any) {
            console.error(`[SFTP Upload ${uploadId}] Error starting upload for ${remotePath}:`, error);
            await this.removeRemoteUploadFile(sessionId, temporaryPath);
            if (!this.cancelledUploadIds.has(uploadId) && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `开始上传时出错: ${error.message}` } }));
            }
        } finally {
            this.pendingUploads.delete(uploadId);
            if (!this.activeUploads.has(uploadId)) {
                this.cancelledUploadIds.delete(uploadId);
            }
        }
    }

    /** Handle a decoded NXUP binary file chunk. */
    async handleUploadChunk(
        sessionId: string,
        uploadId: string,
        chunkIndex: number,
        chunkBuffer: Buffer,
        isLast: boolean,
    ): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const uploadState = this.activeUploads.get(uploadId);

        if (!state?.sftp) {
            console.warn(`[SFTP Upload ${uploadId}] Received binary chunk ${chunkIndex}, but session ${sessionId} or SFTP is invalid.`);
            void this.cancelUploadInternal(uploadId, 'Session or SFTP invalid');
            return;
        }
        if (!uploadState) {
            console.warn(`[SFTP Upload ${uploadId}] Received binary chunk ${chunkIndex}, but no active upload found.`);
            return;
        }

        const rejectChunk = (message: string) => {
            console.error(`[SFTP Upload ${uploadId}] ${message}`);
            if (state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message } }));
            }
            void this.cancelUploadInternal(uploadId, message);
        };

        if (chunkIndex !== uploadState.nextChunkIndex) {
            rejectChunk(`上传分块顺序错误：期望 ${uploadState.nextChunkIndex}，收到 ${chunkIndex}`);
            return;
        }
        if (uploadState.receivedLastChunk) {
            rejectChunk(`结束分块之后又收到分块 ${chunkIndex}`);
            return;
        }

        const nextAcceptedBytes = uploadState.bytesAccepted + chunkBuffer.length;
        if (nextAcceptedBytes > uploadState.totalSize) {
            rejectChunk(`上传数据超过声明大小：${nextAcceptedBytes}/${uploadState.totalSize} 字节`);
            return;
        }
        const reachesDeclaredSize = nextAcceptedBytes === uploadState.totalSize;
        if (isLast !== reachesDeclaredSize) {
            rejectChunk(isLast
                ? `结束分块过早：${nextAcceptedBytes}/${uploadState.totalSize} 字节`
                : `已达到声明大小但分块未标记结束：${nextAcceptedBytes}/${uploadState.totalSize} 字节`);
            return;
        }

        uploadState.nextChunkIndex += 1;
        uploadState.bytesAccepted = nextAcceptedBytes;
        uploadState.receivedLastChunk = isLast;

        try {
            const writeSuccess = uploadState.stream.write(chunkBuffer, (error) => {
                if (this.activeUploads.get(uploadId) !== uploadState) return;
                if (error) {
                    rejectChunk(`写入块 ${chunkIndex} 失败: ${error.message}`);
                    return;
                }

                uploadState.bytesWritten += chunkBuffer.length;
                if (state.ws.readyState === WebSocket.OPEN) {
                    const progressPercent = uploadState.totalSize === 0
                        ? 100
                        : Math.round((uploadState.bytesWritten / uploadState.totalSize) * 100);
                    // ACK and progress share one frame to reduce JSON/WebSocket overhead,
                    // which is especially noticeable when uploading many small files.
                    state.ws.send(JSON.stringify({
                        type: 'sftp:upload:chunk:ack',
                        uploadId,
                        payload: {
                            uploadId,
                            chunkIndex,
                            bytesWritten: uploadState.bytesWritten,
                            totalSize: uploadState.totalSize,
                            progress: Math.min(100, progressPercent),
                        },
                    }));
                }

                if (isLast && uploadState.bytesWritten === uploadState.totalSize && !uploadState.stream.writableEnded) {
                    uploadState.stream.end((endError: Error & { code?: string } | undefined) => {
                        if (!endError) return;
                        if (endError.code === 'ERR_STREAM_DESTROYED' && uploadState.bytesWritten === uploadState.totalSize) {
                            console.warn(`[SFTP Upload ${uploadId}] Stream already closed after all bytes were written.`);
                            return;
                        }
                        rejectChunk(`结束写入流时出错: ${endError.message}`);
                    });
                }
            });

            if (!writeSuccess) {
                if (!uploadState.drainPromise) {
                    uploadState.drainPromise = new Promise<void>((resolve) => {
                        uploadState.stream.once('drain', () => {
                            uploadState.drainPromise = null;
                            resolve();
                        });
                    });
                }
                await uploadState.drainPromise;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            rejectChunk(`处理二进制分块 ${chunkIndex} 时出错: ${message}`);
        }
    }

    /** Cancel an ongoing upload. Cancellation is idempotent, including the window
     * before the write stream has been created. */
    async cancelUpload(sessionId: string, uploadId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        this.cancelledUploadIds.add(uploadId);

        const activeUpload = this.activeUploads.get(uploadId);
        const pendingUpload = this.pendingUploads.get(uploadId);

        if (activeUpload) {
            console.log(`[SFTP Upload ${uploadId}] Cancelling upload for ${activeUpload.remotePath}`);
            await this.cancelUploadInternal(uploadId, 'User cancelled');
        } else if (pendingUpload) {
            // The start routine checks cancelledUploadIds after every await. Removing here
            // as well handles the case where its writability probe already created the part.
            await this.removeRemoteUploadFile(sessionId, pendingUpload.temporaryPath);
        } else {
            console.log(`[SFTP Upload ${uploadId}] Cancel request is already complete or unknown; treating it as idempotent.`);
        }

        if (!this.pendingUploads.has(uploadId) && !this.activeUploads.has(uploadId)) {
            this.cancelledUploadIds.delete(uploadId);
        }
        if (state?.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: 'sftp:upload:cancelled', payload: { uploadId } }));
        }
    }

    /** Stop an active stream and remove only its private temporary file. */
    private async cancelUploadInternal(uploadId: string, reason: string, triggeringError?: unknown): Promise<void> {
        const uploadState = this.activeUploads.get(uploadId);
        if (!uploadState) return;

        // Remove first so stream close can never finalize a cancelled upload.
        this.activeUploads.delete(uploadId);
        const stream = uploadState.stream;

        if (triggeringError) {
            console.warn(`[SFTP Upload ${uploadId}] Aborting after ${reason}:`, triggeringError);
        }

        if (!stream.destroyed) {
            await new Promise<void>((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutId);
                    stream.off('close', finish);
                    resolve();
                };
                const timeoutId = setTimeout(finish, 2000);
                stream.once('close', finish);
                stream.destroy();
            });
        }

        await this.removeRemoteUploadFile(uploadState.sessionId, uploadState.temporaryPath);
        this.cancelledUploadIds.delete(uploadId);
    }

    /** Validate the completed part and atomically replace the destination where supported. */
    private async finalizeUploadedFile(_uploadId: string, uploadState: ActiveUpload): Promise<Stats> {
        const state = this.clientStates.get(uploadState.sessionId);
        if (!state?.sftp) throw new Error('SFTP 会话已断开');

        const partStats = await this.getStats(state.sftp, uploadState.temporaryPath);
        if (partStats.size !== uploadState.totalSize) {
            throw new Error(`临时文件大小 (${partStats.size}) 与预期 (${uploadState.totalSize}) 不一致`);
        }

        await this.replaceRemoteUploadFile(
            state.sftp,
            uploadState.temporaryPath,
            uploadState.remotePath,
        );
        return this.getStats(state.sftp, uploadState.remotePath);
    }

    /** Prefer OpenSSH POSIX rename. The fallback keeps the old destination as a backup
     * until the new part has been moved successfully. */
    private async replaceRemoteUploadFile(sftp: SFTPWrapper, temporaryPath: string, remotePath: string): Promise<void> {
        try {
            await new Promise<void>((resolve, reject) => {
                sftp.ext_openssh_rename(temporaryPath, remotePath, (err) => err ? reject(err) : resolve());
            });
            return;
        } catch (posixRenameError) {
            const destinationExists = await this.remotePathExists(sftp, remotePath);
            if (!destinationExists) {
                await this.performRename(sftp, temporaryPath, remotePath);
                return;
            }

            const backupPath = `${temporaryPath}.previous`;
            await this.unlinkSftpPath(sftp, backupPath, true);
            await this.performRename(sftp, remotePath, backupPath);
            try {
                await this.performRename(sftp, temporaryPath, remotePath);
                await this.unlinkSftpPath(sftp, backupPath, true);
            } catch (fallbackError) {
                try {
                    await this.performRename(sftp, backupPath, remotePath);
                } catch (restoreError) {
                    console.error(`[SFTP Upload] Failed to restore backup ${backupPath}:`, restoreError);
                }
                const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                const firstMessage = posixRenameError instanceof Error ? posixRenameError.message : String(posixRenameError);
                throw new Error(`替换目标文件失败: ${message} (POSIX rename: ${firstMessage})`);
            }
        }
    }

    private async remotePathExists(sftp: SFTPWrapper, remotePath: string): Promise<boolean> {
        try {
            await this.getStats(sftp, remotePath);
            return true;
        } catch (error) {
            if (this.isNoSuchFileError(error)) return false;
            throw error;
        }
    }

    private unlinkSftpPath(sftp: SFTPWrapper, remotePath: string, ignoreMissing = false): Promise<void> {
        return new Promise((resolve, reject) => {
            sftp.unlink(remotePath, (err) => {
                if (!err || (ignoreMissing && this.isNoSuchFileError(err))) {
                    resolve();
                } else {
                    reject(err);
                }
            });
        });
    }

    private lstatSftpPath(sftp: SFTPWrapper, remotePath: string): Promise<Stats | null> {
        return new Promise((resolve, reject) => {
            sftp.lstat(remotePath, (error, stats) => {
                if (!error) {
                    resolve(stats);
                } else if (this.isNoSuchFileError(error)) {
                    resolve(null);
                } else {
                    reject(error);
                }
            });
        });
    }

    private readSftpDirectoryEntries(sftp: SFTPWrapper, remotePath: string): Promise<Array<{ filename: string; attrs: Stats }>> {
        return new Promise((resolve, reject) => {
            sftp.readdir(remotePath, (error, entries) => {
                if (error) reject(error);
                else resolve(entries);
            });
        });
    }

    private rmdirSftpPath(sftp: SFTPWrapper, remotePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            sftp.rmdir(remotePath, (error) => {
                if (!error || this.isNoSuchFileError(error)) resolve();
                else reject(error);
            });
        });
    }

    private async removeSftpPathRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
        const stats = await this.lstatSftpPath(sftp, remotePath);
        if (!stats) return;

        if (!stats.isDirectory() || stats.isSymbolicLink()) {
            await this.unlinkSftpPath(sftp, remotePath, true);
            return;
        }

        const entries = await this.readSftpDirectoryEntries(sftp, remotePath);
        for (const entry of entries) {
            await this.removeSftpPathRecursive(sftp, pathModule.posix.join(remotePath, entry.filename));
        }
        await this.rmdirSftpPath(sftp, remotePath);
    }

    private async removeRemoteArchiveWorkspace(sessionId: string, workspacePath: string): Promise<boolean> {
        const workspaceName = pathModule.posix.basename(workspacePath);
        if (!/^\.nexus-archive-[A-Za-z0-9_-]+\.work$/.test(workspaceName)) {
            console.error(`[SFTP Archive] Refusing to recursively remove unexpected path: ${workspacePath}`);
            return false;
        }

        for (let attempt = 1; attempt <= 5; attempt++) {
            const state = this.clientStates.get(sessionId);
            if (!state?.sftp) return false;
            try {
                await this.removeSftpPathRecursive(state.sftp, workspacePath);
                return true;
            } catch (error) {
                if (attempt === 5) {
                    console.warn(`[SFTP Archive] Unable to remove workspace ${workspacePath}:`, error);
                    return false;
                }
                await new Promise(resolve => setTimeout(resolve, attempt * 250));
            }
        }
        return false;
    }

    private async removeRemoteUploadFile(sessionId: string, remotePath: string): Promise<boolean> {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const state = this.clientStates.get(sessionId);
            if (!state?.sftp) return false;
            try {
                await this.unlinkSftpPath(state.sftp, remotePath, true);
                return true;
            } catch (error) {
                if (attempt === 3) {
                    console.warn(`[SFTP Upload] Unable to remove temporary file ${remotePath}:`, error);
                    return false;
                }
                // Some servers briefly keep the file handle busy after stream.destroy().
                await new Promise(resolve => setTimeout(resolve, attempt * 200));
            }
        }
        return false;
    }

    private isNoSuchFileError(error: unknown): boolean {
        const candidate = error as { code?: string | number; message?: string } | null;
        return candidate?.code === 'ENOENT'
            || candidate?.code === 2
            || /no such file|not found/i.test(candidate?.message || '');
    }

}
