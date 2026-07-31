import { reactive, onUnmounted, type Ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../types/sftp.types'; 
import type { UploadItem } from '../types/upload.types'; 
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types'; 


import type { WebSocketDependencies } from './useSftpActions'; 


// Keep a bounded pipeline so network latency does not leave the SFTP write stream idle.
// Upload chunks use the NXUP v1 binary frame and never pass through JSON/base64.
const UPLOAD_CHUNK_SIZE = 1024 * 1024;
const UPLOAD_MAX_IN_FLIGHT = 4;
const UPLOAD_FRAME_MAGIC = [0x4e, 0x58, 0x55, 0x50] as const; // NXUP
const UPLOAD_FRAME_VERSION = 1;
const UPLOAD_FRAME_FIXED_HEADER_SIZE = 12;
const MAX_UPLOAD_ID_BYTES = 512;

interface UploadTransferState {
    file: File;
    offset: number;
    nextChunkIndex: number;
    inFlight: number;
    pumping: boolean;
}

const textEncoder = new TextEncoder();

const encodeUploadChunkFrame = (
    uploadId: string,
    chunkIndex: number,
    isLast: boolean,
    chunk: ArrayBuffer,
): ArrayBuffer => {
    const uploadIdBytes = textEncoder.encode(uploadId);
    if (uploadIdBytes.byteLength === 0 || uploadIdBytes.byteLength > MAX_UPLOAD_ID_BYTES) {
        throw new Error('上传任务 ID 长度无效');
    }
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 0xffffffff) {
        throw new Error(`上传分块序号无效: ${chunkIndex}`);
    }

    const frame = new ArrayBuffer(UPLOAD_FRAME_FIXED_HEADER_SIZE + uploadIdBytes.byteLength + chunk.byteLength);
    const bytes = new Uint8Array(frame);
    bytes.set(UPLOAD_FRAME_MAGIC, 0);
    const view = new DataView(frame);
    view.setUint8(4, UPLOAD_FRAME_VERSION);
    view.setUint8(5, isLast ? 1 : 0);
    view.setUint16(6, uploadIdBytes.byteLength, false);
    view.setUint32(8, chunkIndex, false);
    bytes.set(uploadIdBytes, UPLOAD_FRAME_FIXED_HEADER_SIZE);
    bytes.set(new Uint8Array(chunk), UPLOAD_FRAME_FIXED_HEADER_SIZE + uploadIdBytes.byteLength);
    return frame;
};

const generateUploadId = (): string => {
    return `upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};


const joinPath = (base: string, name: string): string => {
    if (base === '/') return `/${name}`;
    if (base.endsWith('/')) return `${base}${name}`;
    return `${base}/${name}`;
};

export function useFileUploader(
    sessionIdForLog: Ref<string>,
    currentPathRef: Ref<string>,
    fileListRef: Readonly<Ref<readonly FileListItem[]>>, // 使用 Readonly 类型
    wsDeps: Ref<WebSocketDependencies> 
) {
    const { t } = useI18n();

    // 对 uploads 字典使用 reactive 以获得更好的深度响应性
    const uploads = reactive<Record<string, UploadItem>>({});
    const uploadTransferStates = new Map<string, UploadTransferState>();

    // --- 上传逻辑 ---

    const pumpUpload = async (uploadId: string): Promise<void> => {
        const transfer = uploadTransferStates.get(uploadId);
        const upload = uploads[uploadId];
        if (!transfer || transfer.pumping || !upload || upload.status !== 'uploading') return;

        transfer.pumping = true;
        try {
            if (transfer.file.size === 0 && transfer.offset === 0 && transfer.inFlight === 0) {
                transfer.inFlight = 1;
                transfer.offset = 1;
                wsDeps.value.sendBinaryMessage(
                    encodeUploadChunkFrame(uploadId, 0, true, new ArrayBuffer(0)),
                );
                return;
            }

            while (
                wsDeps.value.isConnected.value
                && uploads[uploadId]?.status === 'uploading'
                && transfer.inFlight < UPLOAD_MAX_IN_FLIGHT
                && transfer.offset < transfer.file.size
            ) {
                const slice = transfer.file.slice(transfer.offset, transfer.offset + UPLOAD_CHUNK_SIZE);
                const chunk = await slice.arrayBuffer();
                if (!wsDeps.value.isConnected.value || uploads[uploadId]?.status !== 'uploading') return;

                transfer.offset += slice.size;
                const chunkIndex = transfer.nextChunkIndex++;
                const isLast = transfer.offset >= transfer.file.size;
                transfer.inFlight += 1;
                wsDeps.value.sendBinaryMessage(
                    encodeUploadChunkFrame(uploadId, chunkIndex, isLast, chunk),
                );
            }
        } catch (error) {
            console.error(`[FileUploader ${sessionIdForLog.value}] Failed to read upload chunk for ${uploadId}:`, error);
            const failedUpload = uploads[uploadId];
            if (failedUpload) {
                failedUpload.status = 'error';
                failedUpload.error = t('fileManager.errors.readFileError');
            }
            uploadTransferStates.delete(uploadId);
            if (wsDeps.value.isConnected.value) {
                wsDeps.value.sendMessage({ type: 'sftp:upload:cancel', payload: { uploadId } });
            }
        } finally {
            const current = uploadTransferStates.get(uploadId);
            if (current) {
                current.pumping = false;
                if (
                    uploads[uploadId]?.status === 'uploading'
                    && current.inFlight < UPLOAD_MAX_IN_FLIGHT
                    && current.offset < current.file.size
                ) queueMicrotask(() => void pumpUpload(uploadId));
            }
        }
    };

    const sendFileChunks = (uploadId: string, file: File, startByte = 0) => {
        if (!uploadTransferStates.has(uploadId)) {
            uploadTransferStates.set(uploadId, {
                file,
                offset: startByte,
                nextChunkIndex: Math.floor(startByte / UPLOAD_CHUNK_SIZE),
                inFlight: 0,
                pumping: false,
            });
        }
        void pumpUpload(uploadId);
    };

    const startFileUpload = (file: File, relativePath?: string) => {
        // Roo: 使用 .value 访问响应式的 sessionIdForLog
        if (!wsDeps.value.isConnected.value) { 
            console.warn(`[FileUploader ${sessionIdForLog.value}] Cannot start upload: WebSocket not connected.`);
            
            return;
        }

        const uploadId = generateUploadId();
        
        let finalRemotePath: string;
        if (relativePath) {
            
            const basePath = currentPathRef.value.endsWith('/') ? currentPathRef.value : `${currentPathRef.value}/`;
            // 确保 relativePath 开头没有斜杠，末尾有斜杠 (如果非空)
            let cleanRelativePath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
            // 移除末尾斜杠（如果有），因为文件名会加上
            cleanRelativePath = cleanRelativePath.endsWith('/') ? cleanRelativePath.slice(0, -1) : cleanRelativePath;
            // webkitRelativePath 已包含文件名（如 folder/sub/file.txt），只取目录部分。
            const relativeParts = cleanRelativePath.split('/');
            if (relativeParts.length > 1 && relativeParts[relativeParts.length - 1] === file.name) {
                cleanRelativePath = relativeParts.slice(0, -1).join('/');
            }
            // 拼接路径，确保 cleanRelativePath 和 file.name 之间只有一个斜杠
            finalRemotePath = `${basePath}${cleanRelativePath ? cleanRelativePath + '/' : ''}${file.name}`;
        } else {
            finalRemotePath = joinPath(currentPathRef.value, file.name); // 对于非文件夹上传，保持原样
        }
        // 规范化路径，移除多余的斜杠 e.g. /root//dir -> /root/dir
        finalRemotePath = finalRemotePath.replace(/\/+/g, '/');
        console.log(`[FileUploader ${sessionIdForLog.value}] Calculated finalRemotePath: ${finalRemotePath} (current: ${currentPathRef.value}, relative: ${relativePath}, filename: ${file.name}) // wsDeps.isSftpReady: ${wsDeps.value.isSftpReady.value}`); 
        // --- 结束修正 ---


        // 添加到响应式 uploads 字典
        uploads[uploadId] = {
            id: uploadId,
            file,
            filename: file.name,
            progress: 0,
            status: 'pending' // 初始状态
        };

        console.log(`[FileUploader ${sessionIdForLog.value}] Starting upload ${uploadId} to ${finalRemotePath}`);
        wsDeps.value.sendMessage({ 
            type: 'sftp:upload:start',
            payload: { uploadId, remotePath: finalRemotePath, size: file.size, relativePath: relativePath || undefined }
        });
        // 后端应该响应 sftp:upload:ready
    };

    const cancelUpload = (uploadId: string, notifyBackend = true) => {
        const upload = uploads[uploadId];
        if (upload && ['pending', 'uploading', 'paused'].includes(upload.status)) {
            console.log(`[FileUploader ${sessionIdForLog.value}] Cancelling upload ${uploadId}`);
            upload.status = 'cancelled'; // 立即更新状态
            uploadTransferStates.delete(uploadId);

            if (notifyBackend && wsDeps.value.isConnected.value) { 
                wsDeps.value.sendMessage({ type: 'sftp:upload:cancel', payload: { uploadId } }); 
            }

            // 短暂延迟后从列表中移除，以显示取消状态
            setTimeout(() => {
                if (uploads[uploadId]?.status === 'cancelled') {
                    delete uploads[uploadId];
                }
            }, 3000);
        }
    };

    const cancelAllUploads = () => {
        const cancellableIds = Object.values(uploads)
            .filter(upload => ['pending', 'uploading', 'paused'].includes(upload.status))
            .map(upload => upload.id);
        cancellableIds.forEach(uploadId => cancelUpload(uploadId, true));
    };

    // --- 消息处理器 ---

    const onUploadReady = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        if (upload && upload.status === 'pending') {
            console.log(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} ready, starting chunk sending.`);
            upload.status = 'uploading';
            sendFileChunks(uploadId, upload.file); // 开始发送块
        } else {
             console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:ready for unknown or non-pending upload ID: ${uploadId}`);
        }
    };

    const onUploadSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        if (upload) {
            console.log(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} successful.`);
            upload.status = 'success';
            upload.progress = 100;
            uploadTransferStates.delete(uploadId);

            // 立即删除记录
            if (uploads[uploadId]) { // 确保记录仍然存在
                delete uploads[uploadId];
            }

        } else {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:success for unknown upload ID: ${uploadId}`);
        }
    };

    const onUploadError = (payload: MessagePayload, message: WebSocketMessage) => {
        // 从 message 中获取 uploadId，因为 payload 此时是错误字符串
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) {
             console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:error with missing uploadId:`, message);
             return;
        }

        const upload = uploads[uploadId];
        if (upload) {
            const errorMessage = typeof payload === 'string'
                ? payload
                : (typeof payload?.message === 'string' && payload.message.trim()
                    ? payload.message
                    : t('fileManager.errors.uploadFailed'));
            console.error(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} error:`, errorMessage);
            upload.status = 'error';
            upload.error = errorMessage; // 使用 payload 作为错误消息
            uploadTransferStates.delete(uploadId);

            // 让错误消息可见时间长一些
            setTimeout(() => {
                if (uploads[uploadId]?.status === 'error') {
                    delete uploads[uploadId];
                }
            }, 5000);
        } else {
             console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:error for unknown upload ID: ${uploadId}`);
        }
    };

    const onUploadPause = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (upload && upload.status === 'uploading') {
            console.log(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} paused.`);
            upload.status = 'paused';
        }
    };

    const onUploadResume = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (upload && upload.status === 'paused') {
            console.log(`[FileUploader ${sessionIdForLog.value}] Resuming upload ${uploadId}`);
            upload.status = 'uploading';
            void pumpUpload(uploadId);
        }
    };

     const onUploadCancelled = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (upload) {
            uploadTransferStates.delete(uploadId);
            // 状态可能已经由用户操作设置为 'cancelled'
            if (upload.status !== 'cancelled') {
                 upload.status = 'cancelled';
            }
            // 确保它会被移除（如果尚未计划移除）
            setTimeout(() => {
                if (uploads[uploadId]?.status === 'cancelled') {
                    delete uploads[uploadId];
                }
            }, 3000);
        }
    };

    // +++ 处理上传进度更新 +++
    const onUploadProgress = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId; // 从顶层获取 uploadId
        if (!uploadId) {
            return;
        }

        const upload = uploads[uploadId];
        if (upload && upload.status === 'uploading') {
            // payload 现在应该包含 bytesWritten 和 totalSize
            if (typeof payload?.bytesWritten === 'number' && typeof payload?.totalSize === 'number') {
                upload.progress = Math.min(100, Math.round((payload.bytesWritten / payload.totalSize) * 100));
                
            } else {
                console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:progress with incorrect payload format:`, payload);
            }
        } else if (upload) {
            
        } else {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:progress for unknown upload ID: ${uploadId}`);
        }
    };

    const onUploadChunkAck = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const transfer = uploadTransferStates.get(uploadId);
        if (!transfer) return;
        transfer.inFlight = Math.max(0, transfer.inFlight - 1);
        if (uploads[uploadId]?.status === 'uploading') void pumpUpload(uploadId);
    };
    

    // --- 动态注册和注销处理器 ---
    watchEffect((onCleanup) => {
        // 当 wsDeps.value 变化时，此 effect 会重新运行
        if (!wsDeps.value || !wsDeps.value.onMessage) {
            console.warn(`[FileUploader ${sessionIdForLog.value}] wsDeps.value or wsDeps.value.onMessage is not available for registering listeners.`);
            return;
        }

        const unregisterUploadReady = wsDeps.value.onMessage('sftp:upload:ready', onUploadReady);
        const unregisterUploadSuccess = wsDeps.value.onMessage('sftp:upload:success', onUploadSuccess);
        const unregisterUploadError = wsDeps.value.onMessage('sftp:upload:error', onUploadError);
        const unregisterUploadPause = wsDeps.value.onMessage('sftp:upload:pause', onUploadPause);
        const unregisterUploadResume = wsDeps.value.onMessage('sftp:upload:resume', onUploadResume);
        const unregisterUploadCancelled = wsDeps.value.onMessage('sftp:upload:cancelled', onUploadCancelled);
        const unregisterUploadProgress = wsDeps.value.onMessage('sftp:upload:progress', onUploadProgress);
        const unregisterUploadChunkAck = wsDeps.value.onMessage('sftp:upload:chunk:ack', onUploadChunkAck);

        onCleanup(() => {
            unregisterUploadReady?.();
            unregisterUploadSuccess?.();
            unregisterUploadError?.();
            unregisterUploadPause?.();
            unregisterUploadResume?.();
            unregisterUploadCancelled?.();
            unregisterUploadProgress?.();
            unregisterUploadChunkAck?.();
        });
    });

    // --- 清理 (onUnmounted 仍然用于组件生命周期结束时的清理) ---
    onUnmounted(() => {
        // 注意：消息监听器的注销现在主要由 watchEffect 的 onCleanup 处理。
        // onUnmounted 仍然负责取消正在进行的上传。

        // 当使用此 composable 的组件卸载时，取消任何正在进行的上传
        Object.keys(uploads).forEach(uploadId => {
            cancelUpload(uploadId, true); // 卸载时通知后端
        });
        uploadTransferStates.clear();
    });

    return {
        uploads, 
        startFileUpload,
        cancelUpload,
        cancelAllUploads,
    };
}
