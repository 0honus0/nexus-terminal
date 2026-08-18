import { computed, reactive, ref, onUnmounted, type Ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../types/sftp.types';
import type { UploadItem } from '../types/upload.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';


import type { WebSocketDependencies } from './useSftpActions';
import { useProgressCenterStore } from '../stores/progressCenter.store';


// Upload chunks use the NXUP v1 binary frame and never pass through JSON/base64.
// The pipeline adapts to measured ACK RTT + committed throughput. Weak links keep a
// deliberately small browser/SFTP queue so terminal traffic is not stuck behind MiBs of
// upload data; healthy links progressively open the window again.
const KiB = 1024;
const MiB = 1024 * KiB;
const UPLOAD_SMALL_FILE_THRESHOLD = 256 * KiB;
const UPLOAD_MEDIUM_FILE_THRESHOLD = 2 * MiB;
const UPLOAD_RECONNECT_RESTART_DELAY_MS = 750;
const UPLOAD_FRAME_MAGIC = [0x4e, 0x58, 0x55, 0x50] as const; // NXUP
const UPLOAD_FRAME_VERSION = 1;
const UPLOAD_FRAME_FIXED_HEADER_SIZE = 12;
const MAX_UPLOAD_ID_BYTES = 512;
const UPLOAD_NETWORK_MIN_THROUGHPUT_SAMPLES = 1;
const UPLOAD_NETWORK_PROFILE_CONFIRM_SAMPLES = 2;
const UPLOAD_NETWORK_THROUGHPUT_EWMA_ALPHA = 0.35;
const UPLOAD_NETWORK_RTT_EWMA_ALPHA = 0.2;
const UPLOAD_THROUGHPUT_WINDOW_MIN_MS = 500;
const UPLOAD_THROUGHPUT_WINDOW_MAX_MS = 1000;
const UPLOAD_THROUGHPUT_WINDOW_MIN_BYTES = 256 * KiB;
const UPLOAD_NETWORK_IDLE_RESET_MS = 10_000;
const UPLOAD_WEAK_RTT_MS = 900;
const UPLOAD_WEAK_THROUGHPUT_BPS = 1 * MiB;
const UPLOAD_WEAK_HIGH_RTT_THROUGHPUT_BPS = 2 * MiB;
const UPLOAD_FAST_THROUGHPUT_BPS = 6 * MiB;

type UploadPipelineMode = 'single' | 'batch';
type UploadNetworkProfile = 'probing' | 'weak' | 'normal' | 'fast';
type UploadConflictPolicy = 'ask' | 'overwrite' | 'skip';
export type UploadConflictDecision = Exclude<UploadConflictPolicy, 'ask'>;

interface UploadTuning {
    singleChunkSize: number;
    singleByteWindow: number;
    batchChunkSize: number;
    batchByteWindow: number;
    wsBufferedBytes: number;
    maxActiveFiles: number;
    activeWeightBudget: number;
}

const UPLOAD_TUNING: Record<UploadNetworkProfile, UploadTuning> = {
    probing: {
        singleChunkSize: 256 * KiB,
        singleByteWindow: 4 * MiB,
        batchChunkSize: 256 * KiB,
        batchByteWindow: 1 * MiB,
        // Keep the browser WebSocket queue small. Upload data and file-manager control
        // messages share one socket, so cancel/refresh JSON frames cannot overtake binary
        // upload frames that are already buffered by the browser. The larger byte windows
        // above still provide SFTP ACK pipelining; this limit only bounds browser-side
        // head-of-line blocking when the user cancels an upload and immediately refreshes.
        wsBufferedBytes: 512 * KiB,
        maxActiveFiles: 4,
        activeWeightBudget: 8,
    },
    weak: {
        singleChunkSize: 128 * KiB,
        singleByteWindow: 2 * MiB,
        batchChunkSize: 128 * KiB,
        batchByteWindow: 512 * KiB,
        wsBufferedBytes: 256 * KiB,
        maxActiveFiles: 2,
        activeWeightBudget: 8,
    },
    normal: {
        singleChunkSize: 256 * KiB,
        singleByteWindow: 8 * MiB,
        batchChunkSize: 256 * KiB,
        batchByteWindow: 2 * MiB,
        wsBufferedBytes: 1 * MiB,
        maxActiveFiles: 6,
        activeWeightBudget: 16,
    },
    fast: {
        singleChunkSize: 512 * KiB,
        singleByteWindow: 12 * MiB,
        batchChunkSize: 256 * KiB,
        batchByteWindow: 4 * MiB,
        wsBufferedBytes: 2 * MiB,
        maxActiveFiles: 10,
        activeWeightBudget: 28,
    },
};

interface SentUploadChunk {
    sentAt: number;
    size: number;
}

interface UploadTransferState {
    file: File;
    remotePath: string;
    relativePath?: string;
    prepareId: string;
    pipelineMode: UploadPipelineMode;
    offset: number;
    nextChunkIndex: number;
    inFlight: number;
    inFlightBytes: number;
    sentChunks: Map<number, SentUploadChunk>;
    pumping: boolean;
    startRequestSent: boolean;
    conflictPolicyOverride?: UploadConflictDecision;
}

export interface UploadBatchFile {
    file: File;
    relativePath?: string;
}

interface UploadBatchState {
    prepareId: string;
    basePath: string;
    directories: string[];
    uploadIds: Set<string>;
    prepared: boolean;
    prepareRequestSent: boolean;
    conflictPolicy?: UploadConflictDecision;
}

export interface UploadConflictPrompt {
    uploadId: string;
    filename: string;
    remotePath: string;
    prepareId: string;
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

const generatePrepareId = (): string => {
    return `prepare-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const joinPath = (base: string, name: string): string => {
    if (base === '/') return `/${name}`;
    if (base.endsWith('/')) return `${base}${name}`;
    return `${base}/${name}`;
};

const normalizeRelativeDirectory = (relativePath?: string): string => {
    if (!relativePath) return '';
    const normalized = relativePath
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..')) {
        throw new Error(`上传目录包含非法路径: ${relativePath}`);
    }
    return parts.join('/');
};

const normalizeRemoteBasePath = (basePath: string): string => {
    const parts = basePath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length ? `/${parts.join('/')}` : '/';
};

const getUploadActiveWeight = (fileSize: number): number => {
    if (fileSize <= UPLOAD_SMALL_FILE_THRESHOLD) return 1;
    if (fileSize <= UPLOAD_MEDIUM_FILE_THRESHOLD) return 2;
    return 4;
};

export function useFileUploader(
    sessionIdForLog: Ref<string>,
    currentPathRef: Ref<string>,
    fileListRef: Readonly<Ref<readonly FileListItem[]>>, // 使用 Readonly 类型
    wsDeps: Ref<WebSocketDependencies>,
    progressInstanceId: string,
) {
    const { t } = useI18n();
    const progressCenter = useProgressCenterStore();

    // 对 uploads 字典使用 reactive 以获得更好的深度响应性
    const uploads = reactive<Record<string, UploadItem>>({});
    const uploadTransferStates = new Map<string, UploadTransferState>();
    const uploadBatches = new Map<string, UploadBatchState>();
    const activeUploadIds = new Set<string>();
    const activeUploadWeights = new Map<string, number>();
    const queuedUploadStarts = new Map<string, boolean>();
    const uploadConflictQueue = ref<UploadConflictPrompt[]>([]);
    const uploadConflict = computed(() => uploadConflictQueue.value[0] ?? null);
    const uploadNetwork = reactive({
        profile: 'probing' as UploadNetworkProfile,
        smoothedRttMs: 0,
        smoothedThroughputBps: 0,
        rttSampleCount: 0,
        throughputSampleCount: 0,
        throughputWindowStartedAt: 0,
        throughputWindowBytes: 0,
        lastThroughputSampleAt: 0,
        candidateProfile: 'probing' as UploadNetworkProfile,
        candidateCount: 0,
    });

    // --- 上传逻辑 ---
    let reconnectRestartTimer: ReturnType<typeof setTimeout> | null = null;

    const getUploadTuning = (): UploadTuning => UPLOAD_TUNING[uploadNetwork.profile];

    const getTransferTuning = (transfer: UploadTransferState) => {
        const tuning = getUploadTuning();
        return transfer.pipelineMode === 'single'
            ? {
                chunkSize: tuning.singleChunkSize,
                byteWindow: tuning.singleByteWindow,
                wsBufferedBytes: tuning.wsBufferedBytes,
            }
            : {
                chunkSize: tuning.batchChunkSize,
                byteWindow: tuning.batchByteWindow,
                wsBufferedBytes: tuning.wsBufferedBytes,
            };
    };

    const classifyUploadNetwork = (): UploadNetworkProfile => {
        if (uploadNetwork.throughputSampleCount < UPLOAD_NETWORK_MIN_THROUGHPUT_SAMPLES) return 'probing';
        if (uploadNetwork.smoothedThroughputBps <= UPLOAD_WEAK_THROUGHPUT_BPS) return 'weak';
        if (
            uploadNetwork.smoothedRttMs >= UPLOAD_WEAK_RTT_MS
            && uploadNetwork.smoothedThroughputBps < UPLOAD_WEAK_HIGH_RTT_THROUGHPUT_BPS
        ) return 'weak';
        if (uploadNetwork.smoothedThroughputBps >= UPLOAD_FAST_THROUGHPUT_BPS) return 'fast';
        return 'normal';
    };

    const describeUploadTuning = (profile: UploadNetworkProfile): string => {
        const tuning = UPLOAD_TUNING[profile];
        const largeFileSlots = Math.min(
            tuning.maxActiveFiles,
            Math.floor(tuning.activeWeightBudget / getUploadActiveWeight(UPLOAD_MEDIUM_FILE_THRESHOLD + 1)),
        );
        return `profile=${profile}, rtt=${Math.round(uploadNetwork.smoothedRttMs)}ms, throughput=${(uploadNetwork.smoothedThroughputBps / MiB).toFixed(2)}MiB/s, `
            + `single=${tuning.singleChunkSize / KiB}KiB/${(tuning.singleByteWindow / MiB).toFixed(1)}MiB, `
            + `batch=${tuning.batchChunkSize / KiB}KiB/${(tuning.batchByteWindow / MiB).toFixed(1)}MiB, `
            + `maxActiveFiles=${tuning.maxActiveFiles}, largeFileSlots=${largeFileSlots}, weightBudget=${tuning.activeWeightBudget}`;
    };

    const applyUploadNetworkCandidate = () => {
        const candidate = classifyUploadNetwork();
        if (candidate === 'probing') return;
        if (candidate === uploadNetwork.profile) {
            uploadNetwork.candidateProfile = candidate;
            uploadNetwork.candidateCount = 0;
            return;
        }
        if (candidate !== uploadNetwork.candidateProfile) {
            uploadNetwork.candidateProfile = candidate;
            uploadNetwork.candidateCount = 1;
            return;
        }

        uploadNetwork.candidateCount += 1;
        if (uploadNetwork.candidateCount < UPLOAD_NETWORK_PROFILE_CONFIRM_SAMPLES) return;

        uploadNetwork.profile = candidate;
        uploadNetwork.candidateCount = 0;
        console.log(`[FileUploader ${sessionIdForLog.value}] Adaptive upload tuning changed: ${describeUploadTuning(candidate)}`);
        drainUploadStartQueue();
        for (const uploadId of activeUploadIds) void pumpUpload(uploadId);
    };

    const markUploadDataSent = (sentAt: number) => {
        if (uploadNetwork.throughputWindowStartedAt === 0) {
            uploadNetwork.throughputWindowStartedAt = sentAt;
        }
    };

    const recordUploadNetworkAck = (sampleRttMs: number, committedBytes: number) => {
        if (!Number.isFinite(sampleRttMs) || sampleRttMs <= 0 || committedBytes <= 0) return;

        if (uploadNetwork.rttSampleCount === 0) {
            uploadNetwork.smoothedRttMs = sampleRttMs;
        } else {
            uploadNetwork.smoothedRttMs = uploadNetwork.smoothedRttMs * (1 - UPLOAD_NETWORK_RTT_EWMA_ALPHA)
                + sampleRttMs * UPLOAD_NETWORK_RTT_EWMA_ALPHA;
        }
        uploadNetwork.rttSampleCount += 1;

        const now = performance.now();
        if (uploadNetwork.throughputWindowStartedAt === 0) {
            uploadNetwork.throughputWindowStartedAt = Math.max(0, now - sampleRttMs);
        }
        uploadNetwork.throughputWindowBytes += committedBytes;
        const elapsedMs = Math.max(1, now - uploadNetwork.throughputWindowStartedAt);
        const enoughData = uploadNetwork.throughputWindowBytes >= UPLOAD_THROUGHPUT_WINDOW_MIN_BYTES;
        const shouldSample = elapsedMs >= UPLOAD_THROUGHPUT_WINDOW_MAX_MS
            || (elapsedMs >= UPLOAD_THROUGHPUT_WINDOW_MIN_MS && enoughData);
        if (!shouldSample) return;

        const sampleThroughputBps = uploadNetwork.throughputWindowBytes * 1000 / elapsedMs;
        if (uploadNetwork.throughputSampleCount === 0) {
            uploadNetwork.smoothedThroughputBps = sampleThroughputBps;
        } else {
            uploadNetwork.smoothedThroughputBps = uploadNetwork.smoothedThroughputBps * (1 - UPLOAD_NETWORK_THROUGHPUT_EWMA_ALPHA)
                + sampleThroughputBps * UPLOAD_NETWORK_THROUGHPUT_EWMA_ALPHA;
        }
        uploadNetwork.throughputSampleCount += 1;
        uploadNetwork.lastThroughputSampleAt = now;
        uploadNetwork.throughputWindowStartedAt = now;
        uploadNetwork.throughputWindowBytes = 0;
        applyUploadNetworkCandidate();
    };

    const prepareUploadNetworkForNewBatch = () => {
        if (activeUploadIds.size > 0 || queuedUploadStarts.size > 0) return;

        const now = performance.now();
        // Never let idle time leak into the next aggregate throughput window.
        uploadNetwork.throughputWindowStartedAt = 0;
        uploadNetwork.throughputWindowBytes = 0;
        if (
            uploadNetwork.lastThroughputSampleAt === 0
            || now - uploadNetwork.lastThroughputSampleAt < UPLOAD_NETWORK_IDLE_RESET_MS
        ) return;

        // A stale weak/fast classification should not permanently throttle a later transfer.
        uploadNetwork.profile = 'probing';
        uploadNetwork.smoothedRttMs = 0;
        uploadNetwork.smoothedThroughputBps = 0;
        uploadNetwork.rttSampleCount = 0;
        uploadNetwork.throughputSampleCount = 0;
        uploadNetwork.lastThroughputSampleAt = 0;
        uploadNetwork.candidateProfile = 'probing';
        uploadNetwork.candidateCount = 0;
    };

    const resetTransferForRestart = (transfer: UploadTransferState) => {
        transfer.offset = 0;
        transfer.nextChunkIndex = 0;
        transfer.inFlight = 0;
        transfer.inFlightBytes = 0;
        transfer.sentChunks.clear();
        transfer.pumping = false;
        transfer.startRequestSent = false;
    };

    const releaseUploadSlot = (uploadId: string) => {
        activeUploadIds.delete(uploadId);
        activeUploadWeights.delete(uploadId);
        queuedUploadStarts.delete(uploadId);
    };

    const getActiveUploadWeightTotal = (): number => {
        let total = 0;
        for (const weight of activeUploadWeights.values()) total += weight;
        return total;
    };

    const removeUploadFromBatch = (uploadId: string) => {
        const transfer = uploadTransferStates.get(uploadId);
        if (!transfer) return;
        const batch = uploadBatches.get(transfer.prepareId);
        batch?.uploadIds.delete(uploadId);
        if (batch && batch.uploadIds.size === 0) uploadBatches.delete(batch.prepareId);
    };

    const requestUploadBatchPrepare = (prepareId: string) => {
        const batch = uploadBatches.get(prepareId);
        if (!batch || batch.prepared || batch.prepareRequestSent) return;
        if (!wsDeps.value.isConnected.value || !wsDeps.value.isSftpReady.value) return;

        batch.prepareRequestSent = true;
        console.log(`[FileUploader ${sessionIdForLog.value}] Preparing ${batch.directories.length} remote directories for ${prepareId}.`);
        wsDeps.value.sendMessage({
            type: 'sftp:upload:prepare',
            payload: {
                prepareId,
                basePath: batch.basePath,
                directories: batch.directories,
            },
        });
    };

    const requestUploadStartNow = (uploadId: string, restart = false): boolean => {
        const transfer = uploadTransferStates.get(uploadId);
        const upload = uploads[uploadId];
        const batch = transfer ? uploadBatches.get(transfer.prepareId) : undefined;
        if (!transfer || !batch?.prepared || !upload || upload.status === 'cancelled' || upload.status === 'success' || upload.status === 'error') return false;
        if (!wsDeps.value.isConnected.value || !wsDeps.value.isSftpReady.value || transfer.startRequestSent) return false;

        if (restart) {
            resetTransferForRestart(transfer);
            upload.progress = 0;
            upload.bytesWritten = 0;
        }
        const conflictPolicy: UploadConflictPolicy = transfer.conflictPolicyOverride ?? batch.conflictPolicy ?? 'ask';
        transfer.conflictPolicyOverride = undefined;
        transfer.startRequestSent = true;
        upload.status = 'pending';
        upload.error = undefined;
        console.log(`[FileUploader ${sessionIdForLog.value}] Starting upload ${uploadId} to ${transfer.remotePath}${restart ? ' after reconnect' : ''}`);
        wsDeps.value.sendMessage({
            type: 'sftp:upload:start',
            payload: {
                uploadId,
                remotePath: transfer.remotePath,
                size: transfer.file.size,
                relativePath: transfer.relativePath,
                prepareId: transfer.prepareId,
                conflictPolicy,
            },
        });
        return true;
    };

    const drainUploadStartQueue = () => {
        if (!wsDeps.value.isConnected.value || !wsDeps.value.isSftpReady.value) return;

        const tuning = getUploadTuning();
        let activeWeight = getActiveUploadWeightTotal();
        for (const [uploadId, restart] of queuedUploadStarts) {
            if (activeUploadIds.size >= tuning.maxActiveFiles) break;

            const upload = uploads[uploadId];
            const transfer = uploadTransferStates.get(uploadId);
            const batch = transfer ? uploadBatches.get(transfer.prepareId) : undefined;
            if (!upload || !transfer || upload.status === 'cancelled' || upload.status === 'success' || upload.status === 'error') {
                queuedUploadStarts.delete(uploadId);
                continue;
            }
            if (!batch?.prepared) continue;

            const uploadWeight = getUploadActiveWeight(transfer.file.size);
            if (activeWeight + uploadWeight > tuning.activeWeightBudget) {
                // Avoid head-of-line blocking: later small files may still fit the current network budget.
                continue;
            }

            queuedUploadStarts.delete(uploadId);
            if (requestUploadStartNow(uploadId, restart)) {
                activeUploadIds.add(uploadId);
                activeUploadWeights.set(uploadId, uploadWeight);
                activeWeight += uploadWeight;
                console.log(
                    `[FileUploader ${sessionIdForLog.value}] Upload scheduler: `
                    + `profile=${uploadNetwork.profile}, activeFiles=${activeUploadIds.size}/${tuning.maxActiveFiles}, `
                    + `activeWeight=${activeWeight}/${tuning.activeWeightBudget}`,
                );
            }
        }
    };

    const requestUploadStart = (uploadId: string, restart = false) => {
        const upload = uploads[uploadId];
        if (!upload || upload.status === 'cancelled' || upload.status === 'success' || upload.status === 'error') return;

        const queuedRestart = queuedUploadStarts.get(uploadId) ?? false;
        queuedUploadStarts.set(uploadId, queuedRestart || restart);
        drainUploadStartQueue();
    };

    const pumpUpload = async (uploadId: string): Promise<void> => {
        const transfer = uploadTransferStates.get(uploadId);
        const upload = uploads[uploadId];
        if (!transfer || transfer.pumping || !upload || upload.status !== 'uploading') return;

        transfer.pumping = true;
        try {
            if (transfer.file.size === 0 && transfer.offset === 0 && transfer.inFlight === 0) {
                const tuning = getTransferTuning(transfer);
                await wsDeps.value.sendBinaryMessage(
                    encodeUploadChunkFrame(uploadId, 0, true, new ArrayBuffer(0)),
                    tuning.wsBufferedBytes,
                );
                const sentAt = performance.now();
                transfer.inFlight = 1;
                transfer.sentChunks.set(0, { sentAt, size: 0 });
                transfer.offset = 1;
                return;
            }

            while (
                wsDeps.value.isConnected.value
                && uploads[uploadId]?.status === 'uploading'
                && transfer.offset < transfer.file.size
            ) {
                const tuning = getTransferTuning(transfer);
                const availableWindow = tuning.byteWindow - transfer.inFlightBytes;
                if (availableWindow <= 0) break;

                const remainingBytes = transfer.file.size - transfer.offset;
                const nextChunkSize = Math.min(tuning.chunkSize, availableWindow, remainingBytes);
                if (nextChunkSize <= 0) break;

                const slice = transfer.file.slice(transfer.offset, transfer.offset + nextChunkSize);
                const chunk = await slice.arrayBuffer();
                if (!wsDeps.value.isConnected.value || uploads[uploadId]?.status !== 'uploading') return;

                const chunkIndex = transfer.nextChunkIndex;
                const nextOffset = transfer.offset + slice.size;
                const isLast = nextOffset >= transfer.file.size;
                await wsDeps.value.sendBinaryMessage(
                    encodeUploadChunkFrame(uploadId, chunkIndex, isLast, chunk),
                    tuning.wsBufferedBytes,
                );
                const sentAt = performance.now();
                markUploadDataSent(sentAt);
                transfer.offset = nextOffset;
                transfer.nextChunkIndex += 1;
                transfer.inFlight += 1;
                transfer.inFlightBytes += slice.size;
                transfer.sentChunks.set(chunkIndex, { sentAt, size: slice.size });
            }
        } catch (error) {
            const failedUpload = uploads[uploadId];
            // cancelUpload removes the transfer state immediately. A send that was already
            // waiting on WebSocket backpressure may reject afterwards; that stale pump must
            // never overwrite the user's terminal cancelled state with paused/error.
            if (!failedUpload || failedUpload.status === 'cancelled' || uploadTransferStates.get(uploadId) !== transfer) return;

            if (!wsDeps.value.isConnected.value) {
                console.warn(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} paused because the WebSocket disconnected.`);
                failedUpload.status = 'paused';
                resetTransferForRestart(transfer);
                return;
            }

            console.error(`[FileUploader ${sessionIdForLog.value}] Failed to send upload chunk for ${uploadId}:`, error);
            failedUpload.status = 'error';
            failedUpload.error = error instanceof Error && error.message
                ? error.message
                : t('fileManager.errors.readFileError');
            removeUploadFromBatch(uploadId);
            uploadTransferStates.delete(uploadId);
            releaseUploadSlot(uploadId);
            drainUploadStartQueue();
            wsDeps.value.sendMessage({ type: 'sftp:upload:cancel', payload: { uploadId } });
        } finally {
            const current = uploadTransferStates.get(uploadId);
            if (current) {
                current.pumping = false;
                const tuning = getTransferTuning(current);
                if (
                    wsDeps.value.isConnected.value
                    && uploads[uploadId]?.status === 'uploading'
                    && current.inFlightBytes < tuning.byteWindow
                    && current.offset < current.file.size
                ) queueMicrotask(() => void pumpUpload(uploadId));
            }
        }
    };

    const startFileUploadBatch = (files: UploadBatchFile[], directories: string[] = []) => {
        if (!files.length && !directories.length) return;
        prepareUploadNetworkForNewBatch();
        if (!wsDeps.value.isConnected.value) {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Cannot start upload batch: WebSocket not connected.`);
            return;
        }

        const basePath = normalizeRemoteBasePath(currentPathRef.value);
        const prepareId = generatePrepareId();
        const directorySet = new Set<string>();

        let preparedFiles: Array<{ file: File; relativeDirectory: string; remotePath: string }>;
        try {
            for (const directory of directories) {
                directorySet.add(normalizeRelativeDirectory(directory));
            }
            preparedFiles = files.map(({ file, relativePath }) => {
                const sourcePath = relativePath || file.webkitRelativePath || '';
                let relativeDirectory = normalizeRelativeDirectory(sourcePath);
                const relativeParts = relativeDirectory.split('/').filter(Boolean);
                if (relativeParts[relativeParts.length - 1] === file.name) {
                    relativeParts.pop();
                    relativeDirectory = relativeParts.join('/');
                }
                directorySet.add(relativeDirectory);
                const targetDirectory = relativeDirectory ? joinPath(basePath, relativeDirectory) : basePath;
                return {
                    file,
                    relativeDirectory,
                    remotePath: joinPath(targetDirectory, file.name).replace(/\/+/g, '/'),
                };
            });
        } catch (error) {
            console.error(`[FileUploader ${sessionIdForLog.value}] Invalid upload path:`, error);
            return;
        }

        const pipelineMode: UploadPipelineMode = files.length === 1
            && directories.length === 0
            && preparedFiles[0]?.relativeDirectory === ''
            ? 'single'
            : 'batch';
        const initialTuning = getUploadTuning();
        const initialChunkSize = pipelineMode === 'single'
            ? initialTuning.singleChunkSize
            : initialTuning.batchChunkSize;
        const initialByteWindow = pipelineMode === 'single'
            ? initialTuning.singleByteWindow
            : initialTuning.batchByteWindow;
        console.log(
            `[FileUploader ${sessionIdForLog.value}] Using ${pipelineMode} adaptive upload pipeline: `
            + `${initialChunkSize / KiB} KiB chunks, ${(initialByteWindow / MiB).toFixed(1)} MiB byte window, `
            + `network=${uploadNetwork.profile}.`,
        );

        const uploadIds = new Set<string>();
        uploadBatches.set(prepareId, {
            prepareId,
            basePath,
            directories: [...directorySet].sort((left, right) => {
                const depthDiff = left.split('/').filter(Boolean).length - right.split('/').filter(Boolean).length;
                return depthDiff || left.localeCompare(right);
            }),
            uploadIds,
            prepared: false,
            prepareRequestSent: false,
        });

        for (const preparedFile of preparedFiles) {
            const uploadId = generateUploadId();
            uploadIds.add(uploadId);
            uploads[uploadId] = {
                id: uploadId,
                file: preparedFile.file,
                filename: preparedFile.file.name,
                progress: 0,
                bytesWritten: 0,
                status: 'pending',
            };
            uploadTransferStates.set(uploadId, {
                file: preparedFile.file,
                remotePath: preparedFile.remotePath,
                relativePath: preparedFile.relativeDirectory || undefined,
                prepareId,
                pipelineMode,
                offset: 0,
                nextChunkIndex: 0,
                inFlight: 0,
                inFlightBytes: 0,
                sentChunks: new Map(),
                pumping: false,
                startRequestSent: false,
            });
        }

        requestUploadBatchPrepare(prepareId);
    };

    const startFileUpload = (file: File, relativePath?: string) => {
        startFileUploadBatch([{ file, relativePath }]);
    };

    const cancelUpload = (uploadId: string, notifyBackend = true) => {
        const upload = uploads[uploadId];
        if (upload && ['pending', 'uploading', 'paused', 'conflict'].includes(upload.status)) {
            console.log(`[FileUploader ${sessionIdForLog.value}] Cancelling upload ${uploadId}`);
            upload.status = 'cancelled'; // 立即更新状态
            removeConflictFromQueue(uploadId);
            removeUploadFromBatch(uploadId);
            uploadTransferStates.delete(uploadId);
            releaseUploadSlot(uploadId);
            drainUploadStartQueue();

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
            .filter(upload => ['pending', 'uploading', 'paused', 'conflict'].includes(upload.status))
            .map(upload => upload.id);
        cancellableIds.forEach(uploadId => cancelUpload(uploadId, true));
    };

    const uploadProgressSourceId = computed(() => `upload:${sessionIdForLog.value}:${progressInstanceId}`);
    let registeredUploadProgressSourceId = uploadProgressSourceId.value;

    const syncUploadProgress = () => {
        const sourceId = uploadProgressSourceId.value;
        if (registeredUploadProgressSourceId !== sourceId) {
            progressCenter.unregisterSource(registeredUploadProgressSourceId);
            registeredUploadProgressSourceId = sourceId;
        }
        progressCenter.syncSourceTasks(
            { id: sourceId, sessionId: sessionIdForLog.value, label: 'upload' },
            Object.values(uploads)
                .filter(upload => {
                    const effectivelyComplete = upload.status === 'success'
                        || upload.status === 'cancelled'
                        || (upload.status === 'uploading' && upload.progress >= 100);
                    return !effectivelyComplete;
                })
                .map(upload => ({
                    id: upload.id,
                    kind: 'upload' as const,
                    title: upload.filename,
                    progress: upload.progress,
                    status: upload.status,
                    cancellable: ['pending', 'uploading', 'paused', 'conflict'].includes(upload.status),
                    cancel: () => cancelUpload(upload.id, true),
                })),
        );
    };

    watch(uploads, syncUploadProgress, { deep: true, immediate: true });
    watch(sessionIdForLog, syncUploadProgress);

    const removeConflictFromQueue = (uploadId: string) => {
        uploadConflictQueue.value = uploadConflictQueue.value.filter(conflict => conflict.uploadId !== uploadId);
    };

    const resolveUploadConflict = (decision: UploadConflictDecision, applyToAll = false) => {
        const conflict = uploadConflict.value;
        if (!conflict) return;

        const transfer = uploadTransferStates.get(conflict.uploadId);
        const batch = transfer ? uploadBatches.get(transfer.prepareId) : undefined;
        const upload = uploads[conflict.uploadId];
        removeConflictFromQueue(conflict.uploadId);
        if (!transfer || !batch || !upload) return;

        if (applyToAll) batch.conflictPolicy = decision;
        transfer.conflictPolicyOverride = decision;
        upload.status = 'pending';
        requestUploadStart(conflict.uploadId);

        if (applyToAll) {
            const sameBatchConflicts = uploadConflictQueue.value.filter(item => item.prepareId === batch.prepareId);
            for (const queuedConflict of sameBatchConflicts) {
                const queuedTransfer = uploadTransferStates.get(queuedConflict.uploadId);
                const queuedUpload = uploads[queuedConflict.uploadId];
                removeConflictFromQueue(queuedConflict.uploadId);
                if (!queuedTransfer || !queuedUpload) continue;
                queuedTransfer.conflictPolicyOverride = decision;
                queuedUpload.status = 'pending';
                requestUploadStart(queuedConflict.uploadId);
            }
        }
        drainUploadStartQueue();
    };

    // --- 消息处理器 ---

    const onUploadPrepareReady = (payload: MessagePayload) => {
        const prepareId = payload?.prepareId;
        if (!prepareId) return;
        const batch = uploadBatches.get(prepareId);
        if (!batch) return;

        batch.prepared = true;
        batch.prepareRequestSent = true;
        console.log(`[FileUploader ${sessionIdForLog.value}] Remote directories prepared for ${prepareId}.`);
        if (batch.uploadIds.size === 0) {
            uploadBatches.delete(prepareId);
            return;
        }
        for (const uploadId of batch.uploadIds) {
            const upload = uploads[uploadId];
            if (!upload) continue;
            if (upload.status === 'conflict') continue;
            requestUploadStart(uploadId, upload.status === 'paused');
        }
        drainUploadStartQueue();
    };

    const onUploadPrepareError = (payload: MessagePayload) => {
        const prepareId = payload?.prepareId;
        if (!prepareId) return;
        const batch = uploadBatches.get(prepareId);
        if (!batch) return;
        const errorMessage = typeof payload?.message === 'string' && payload.message.trim()
            ? payload.message
            : t('fileManager.errors.uploadFailed');

        console.error(`[FileUploader ${sessionIdForLog.value}] Remote directory preparation failed for ${prepareId}: ${errorMessage}`);
        for (const uploadId of [...batch.uploadIds]) {
            const upload = uploads[uploadId];
            if (upload) {
                upload.status = 'error';
                upload.error = errorMessage;
                setTimeout(() => {
                    if (uploads[uploadId]?.status === 'error') delete uploads[uploadId];
                }, 5000);
            }
            removeConflictFromQueue(uploadId);
            releaseUploadSlot(uploadId);
            uploadTransferStates.delete(uploadId);
        }
        uploadBatches.delete(prepareId);
        drainUploadStartQueue();
    };

    const onUploadConflict = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const transfer = uploadTransferStates.get(uploadId);
        const upload = uploads[uploadId];
        const batch = transfer ? uploadBatches.get(transfer.prepareId) : undefined;
        if (!transfer || !upload || !batch) return;

        transfer.startRequestSent = false;
        upload.status = 'conflict';
        releaseUploadSlot(uploadId);

        if (batch.conflictPolicy) {
            transfer.conflictPolicyOverride = batch.conflictPolicy;
            upload.status = 'pending';
            requestUploadStart(uploadId);
            return;
        }

        if (!uploadConflictQueue.value.some(conflict => conflict.uploadId === uploadId)) {
            uploadConflictQueue.value.push({
                uploadId,
                filename: typeof payload?.filename === 'string' ? payload.filename : upload.filename,
                remotePath: typeof payload?.remotePath === 'string' ? payload.remotePath : transfer.remotePath,
                prepareId: transfer.prepareId,
            });
        }
        drainUploadStartQueue();
    };

    const onUploadSkipped = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (!upload) return;

        console.log(`[FileUploader ${sessionIdForLog.value}] Skipped existing remote file for upload ${uploadId}.`);
        removeConflictFromQueue(uploadId);
        removeUploadFromBatch(uploadId);
        uploadTransferStates.delete(uploadId);
        releaseUploadSlot(uploadId);
        delete uploads[uploadId];
        drainUploadStartQueue();
    };

    const onUploadReady = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        const transfer = uploadTransferStates.get(uploadId);
        if (upload && transfer && upload.status === 'pending') {
            console.log(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} ready, starting chunk sending.`);
            upload.status = 'uploading';
            void pumpUpload(uploadId);
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
            upload.bytesWritten = upload.file.size;
            removeConflictFromQueue(uploadId);
            removeUploadFromBatch(uploadId);
            uploadTransferStates.delete(uploadId);
            releaseUploadSlot(uploadId);
            drainUploadStartQueue();

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
            removeConflictFromQueue(uploadId);
            removeUploadFromBatch(uploadId);
            uploadTransferStates.delete(uploadId);
            releaseUploadSlot(uploadId);
            drainUploadStartQueue();

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
            removeConflictFromQueue(uploadId);
            removeUploadFromBatch(uploadId);
            uploadTransferStates.delete(uploadId);
            releaseUploadSlot(uploadId);
            drainUploadStartQueue();
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
                upload.bytesWritten = Math.max(0, Math.min(payload.totalSize, payload.bytesWritten));
                upload.progress = payload.totalSize === 0
                    ? 100
                    : Math.min(100, (upload.bytesWritten / payload.totalSize) * 100);

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

        const upload = uploads[uploadId];
        if (upload && typeof payload?.bytesWritten === 'number') {
            upload.bytesWritten = Math.max(0, Math.min(transfer.file.size, payload.bytesWritten));
            upload.progress = transfer.file.size === 0
                ? 100
                : Math.min(100, (upload.bytesWritten / transfer.file.size) * 100);
        } else if (upload && typeof payload?.progress === 'number') {
            upload.progress = Math.min(100, Math.max(upload.progress, payload.progress));
        }

        const acknowledgedChunkIndex = typeof payload?.chunkIndex === 'number'
            ? payload.chunkIndex
            : undefined;
        let sentChunk: SentUploadChunk | undefined;
        if (acknowledgedChunkIndex !== undefined) {
            sentChunk = transfer.sentChunks.get(acknowledgedChunkIndex);
            transfer.sentChunks.delete(acknowledgedChunkIndex);
        } else {
            const oldest = transfer.sentChunks.entries().next().value as [number, SentUploadChunk] | undefined;
            if (oldest) {
                transfer.sentChunks.delete(oldest[0]);
                sentChunk = oldest[1];
            }
        }
        if (sentChunk) {
            transfer.inFlightBytes = Math.max(0, transfer.inFlightBytes - sentChunk.size);
            if (sentChunk.size > 0) {
                recordUploadNetworkAck(Math.max(1, performance.now() - sentChunk.sentAt), sentChunk.size);
            }
        }

        transfer.inFlight = Math.max(0, transfer.inFlight - 1);
        if (upload?.status === 'uploading') void pumpUpload(uploadId);
    };

    // A reconnect invalidates both the prepared directory token and all in-flight ACKs.
    // Re-submit the complete local path tree first; only after the backend confirms that
    // every remote directory exists do file streams restart from byte 0.
    watch(
        () => [wsDeps.value.isConnected.value, wsDeps.value.isSftpReady.value] as const,
        ([connected, sftpReady]) => {
            if (!connected || !sftpReady) {
                if (reconnectRestartTimer) {
                    clearTimeout(reconnectRestartTimer);
                    reconnectRestartTimer = null;
                }
                activeUploadIds.clear();
                activeUploadWeights.clear();
                queuedUploadStarts.clear();
                uploadBatches.forEach((batch) => {
                    batch.prepared = false;
                    batch.prepareRequestSent = false;
                });
                uploadTransferStates.forEach((transfer, uploadId) => {
                    const upload = uploads[uploadId];
                    if (!upload || !['pending', 'uploading', 'paused'].includes(upload.status)) return;
                    upload.status = 'paused';
                    resetTransferForRestart(transfer);
                });
                return;
            }

            if (reconnectRestartTimer) clearTimeout(reconnectRestartTimer);
            reconnectRestartTimer = setTimeout(() => {
                reconnectRestartTimer = null;
                uploadBatches.forEach((batch) => requestUploadBatchPrepare(batch.prepareId));
            }, UPLOAD_RECONNECT_RESTART_DELAY_MS);
        },
        { immediate: true },
    );


    // --- 动态注册和注销处理器 ---
    watchEffect((onCleanup) => {
        // 当 wsDeps.value 变化时，此 effect 会重新运行
        if (!wsDeps.value || !wsDeps.value.onMessage) {
            console.warn(`[FileUploader ${sessionIdForLog.value}] wsDeps.value or wsDeps.value.onMessage is not available for registering listeners.`);
            return;
        }

        const unregisterUploadPrepareReady = wsDeps.value.onMessage('sftp:upload:prepare:ready', onUploadPrepareReady);
        const unregisterUploadPrepareError = wsDeps.value.onMessage('sftp:upload:prepare:error', onUploadPrepareError);
        const unregisterUploadConflict = wsDeps.value.onMessage('sftp:upload:conflict', onUploadConflict);
        const unregisterUploadSkipped = wsDeps.value.onMessage('sftp:upload:skipped', onUploadSkipped);
        const unregisterUploadReady = wsDeps.value.onMessage('sftp:upload:ready', onUploadReady);
        const unregisterUploadSuccess = wsDeps.value.onMessage('sftp:upload:success', onUploadSuccess);
        const unregisterUploadError = wsDeps.value.onMessage('sftp:upload:error', onUploadError);
        const unregisterUploadPause = wsDeps.value.onMessage('sftp:upload:pause', onUploadPause);
        const unregisterUploadResume = wsDeps.value.onMessage('sftp:upload:resume', onUploadResume);
        const unregisterUploadCancelled = wsDeps.value.onMessage('sftp:upload:cancelled', onUploadCancelled);
        const unregisterUploadProgress = wsDeps.value.onMessage('sftp:upload:progress', onUploadProgress);
        const unregisterUploadChunkAck = wsDeps.value.onMessage('sftp:upload:chunk:ack', onUploadChunkAck);

        onCleanup(() => {
            unregisterUploadPrepareReady?.();
            unregisterUploadPrepareError?.();
            unregisterUploadConflict?.();
            unregisterUploadSkipped?.();
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

        if (reconnectRestartTimer) {
            clearTimeout(reconnectRestartTimer);
            reconnectRestartTimer = null;
        }

        // 当使用此 composable 的组件卸载时，取消任何正在进行的上传
        Object.keys(uploads).forEach(uploadId => {
            cancelUpload(uploadId, true); // 卸载时通知后端
        });
        uploadTransferStates.clear();
        uploadBatches.clear();
        activeUploadIds.clear();
        activeUploadWeights.clear();
        queuedUploadStarts.clear();
        uploadConflictQueue.value = [];
        progressCenter.unregisterSource(registeredUploadProgressSourceId);
    });

    return {
        uploads,
        progressSourceId: uploadProgressSourceId,
        uploadConflict,
        uploadNetworkProfile: computed(() => uploadNetwork.profile),
        startFileUpload,
        startFileUploadBatch,
        cancelUpload,
        cancelAllUploads,
        resolveUploadConflict,
    };
}
