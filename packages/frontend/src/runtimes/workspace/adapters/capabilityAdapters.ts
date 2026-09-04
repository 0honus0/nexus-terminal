import { httpClient } from '@/client/http';
import { createWebSocketUrl } from '@/client/websocket';
import type { DockerChannel, DockerCommand, DockerStats, DockerStatus } from '@/features/docker/public';
import type {
  DirectoryListing,
  FileSearchResult,
  FilesystemChannel,
  FilesystemDownloadPort,
  RemoteFileEntry,
  RemoteTextFile,
  ResolvedRemotePath,
  TerminalDirectoryPort,
} from '@/features/filesystem/public';
import type { FileDocumentPort, LoadedEditorDocument } from '@/features/file-editor/public';
import type { FilePreviewSource } from '@/features/file-preview/public';
import type { ServerStatusSample, StatusChannel } from '@/features/status-monitor/public';
import type { SshSuspendChannel } from '@/features/ssh-suspend/public';
import type { TerminalChannel, TerminalOutput, TerminalViewport } from '@/features/terminal/public';
import type {
  ArchiveRequest,
  CopyMoveRequest,
  TransferChannel,
  TransferEvent,
  TransferTask,
  ArchiveTransferErrorCode,
  UploadPrepareRequest,
  UploadRequest,
} from '@/features/transfers/public';
import { WorkspaceSocket } from '../protocol/workspaceSocket';

interface TextReadResponse {
  path: string;
  content: string;
  encoding: string;
  rawContentBase64: string;
}
interface BinaryReadResponse {
  path: string;
  contentBase64: string;
}
interface RealpathResponse {
  requestedPath: string;
  absolutePath: string;
  targetType: 'directory' | 'file' | 'other';
}
interface DirectoryChangeQueuedEvent {
  requestId: string;
  path: string;
  waitingForPrompt: boolean;
}
interface DirectoryChangedEvent {
  requestId: string;
  path: string;
}
interface DirectoryChangeFailedEvent {
  requestId: string;
  message: string;
}
interface UploadEventWire {
  type: 'ready' | 'conflict' | 'skipped' | 'progress' | 'completed' | 'cancelled' | 'failed';
  uploadId?: string;
  destinationPath?: string;
  filename?: string;
  chunkIndex?: number;
  bytesWritten?: number;
  totalSize?: number;
  progress?: number;
  message?: string;
}
interface CopyMoveEventWire {
  type: 'progress' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
  requestId: string;
  transferredBytes?: number;
  totalBytes?: number;
  completedFiles?: number;
  totalFiles?: number;
  totalKnown?: boolean;
  currentFile?: string;
  mode?: 'copy' | 'move';
  message?: string;
}
interface ArchiveEventWire {
  type: 'progress' | 'completed' | 'failed' | 'cancelled';
  operation: 'compress' | 'decompress';
  requestId: string;
  fileCount?: number;
  totalFiles?: number;
  percent?: number;
  currentFile?: string;
  message?: string;
  code?: ArchiveTransferErrorCode;
  warning?: string;
}

const decodeBase64Bytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

interface WorkspaceTerminalGate {
  canSend(): boolean;
  deferResize(viewport: TerminalViewport): void;
}

export const createTerminalChannel = (socket: WorkspaceSocket, gate?: WorkspaceTerminalGate): TerminalChannel => {
  const outputHandlers = new Set<(output: TerminalOutput) => void>();
  const buffered: Uint8Array[] = [];
  let bufferedBytes = 0;
  const maxBufferedBytes = 4 * 1024 * 1024;

  socket.onBinary((data) => {
    if (outputHandlers.size) {
      for (const handler of outputHandlers) handler({ data });
      return;
    }
    const copy = data.slice();
    buffered.push(copy);
    bufferedBytes += copy.byteLength;
    while (bufferedBytes > maxBufferedBytes && buffered.length > 1) {
      bufferedBytes -= buffered.shift()!.byteLength;
    }
  });

  return {
    sendInput: (data) => {
      if (gate && !gate.canSend()) return;
      socket.sendConnected('terminal.input', { data });
    },
    resize: (viewport: TerminalViewport) => {
      if (gate && !gate.canSend()) {
        gate.deferResize(viewport);
        return;
      }
      if (!socket.sendConnected('terminal.resize', { columns: viewport.columns, rows: viewport.rows })) {
        gate?.deferResize(viewport);
      }
    },
    onOutput(handler) {
      outputHandlers.add(handler);
      for (const data of buffered.splice(0)) handler({ data });
      bufferedBytes = 0;
      return () => outputHandlers.delete(handler);
    },
    onClose(handler) {
      const stopTransport = socket.onClose(handler);
      const stopTerminal = socket.on('terminal.closed', () => handler());
      return () => {
        stopTransport();
        stopTerminal();
      };
    },
    onError(handler) {
      const stopTransport = socket.onError(handler);
      const stopTerminal = socket.on<{ message: string }>('terminal.error', (payload) => handler(payload.message));
      return () => {
        stopTransport();
        stopTerminal();
      };
    },
  };
};

export const createFilesystemChannel = (socket: WorkspaceSocket): FilesystemChannel => ({
  listDirectory: (path): Promise<DirectoryListing> => socket.request('filesystem.list', { path }),
  search: (path, query): Promise<FileSearchResult> => socket.request('filesystem.search', { path, query }),
  stat: (path): Promise<RemoteFileEntry> => socket.request('filesystem.stat', { path }),
  async readText(path, encoding): Promise<RemoteTextFile> {
    const result = await socket.request<TextReadResponse>('filesystem.readText', {
      path,
      ...(encoding ? { encoding } : {}),
    });
    return {
      path: result.path,
      content: result.content,
      encoding: result.encoding,
      rawContentBase64: result.rawContentBase64,
    };
  },
  async writeText(path, content, encoding) {
    await socket.request('filesystem.writeText', { path, content, ...(encoding ? { encoding } : {}) });
  },
  async createDirectory(path) {
    await socket.request('filesystem.createDirectory', { path });
  },
  async createFile(path, content = '') {
    await socket.request('filesystem.createFile', { path, content });
  },
  async remove(paths) {
    await socket.request('filesystem.remove', { paths });
  },
  async rename(from, to) {
    await socket.request('filesystem.rename', { from, to });
  },
  async chmod(path, mode) {
    await socket.request('filesystem.chmod', { path, mode });
  },
  async realpath(path): Promise<ResolvedRemotePath> {
    const resolved = await socket.request<RealpathResponse>('filesystem.realpath', { path });
    return { requestedPath: resolved.requestedPath, path: resolved.absolutePath, targetType: resolved.targetType };
  },
});

const DIRECTORY_CHANGE_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000 + 5_000;

export const createTerminalDirectoryPort = (socket: WorkspaceSocket): TerminalDirectoryPort => ({
  readCurrentDirectory: () => socket.request<string>('terminal.currentDirectory'),
  changeDirectory(path, options) {
    const requestId = crypto.randomUUID();
    return new Promise<{ path: string }>((resolve, reject) => {
      let settled = false;
      let stopQueued: () => void = () => {};
      let stopChanged: () => void = () => {};
      let stopFailed: () => void = () => {};
      let stopClose: () => void = () => {};
      let timer = 0;
      const cleanup = () => {
        stopQueued();
        stopChanged();
        stopFailed();
        stopClose();
        if (timer) window.clearTimeout(timer);
      };
      const succeed = (result: { path: string }) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const fail = (cause: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      };

      stopQueued = socket.on<DirectoryChangeQueuedEvent>('terminal.directoryChangeQueued', (event) => {
        if (event.requestId !== requestId) return;
        options?.onQueued?.({ path: event.path, waitingForPrompt: event.waitingForPrompt });
      });
      stopChanged = socket.on<DirectoryChangedEvent>('terminal.directoryChanged', (event) => {
        if (event.requestId === requestId) succeed({ path: event.path });
      });
      stopFailed = socket.on<DirectoryChangeFailedEvent>('terminal.directoryChangeFailed', (event) => {
        if (event.requestId === requestId) fail(new Error(event.message));
      });
      stopClose = socket.onClose((reason) => fail(new Error(reason || 'Workspace connection closed.')));
      timer = window.setTimeout(
        () => fail(new Error('Terminal directory change timed out.')),
        DIRECTORY_CHANGE_COMPLETION_TIMEOUT_MS,
      );
      void socket
        .requestWithId<{ queued: true }>('terminal.changeDirectory', requestId, { path })
        .catch((cause) => fail(cause));
    });
  },
});

export const createFilesystemDownloadPort = (workspaceId: string, connectionId: number): FilesystemDownloadPort => ({
  async createDownload(path, kind) {
    if (kind === 'directory') {
      const query = new URLSearchParams({
        connectionId: String(connectionId),
        sessionId: workspaceId,
        remotePath: path,
      });
      return { url: `/api/v1/sftp/download-directory?${query}` };
    }
    const { data } = await httpClient.post<{ url: string }>('/sftp/download-ticket', {
      connectionId,
      sessionId: workspaceId,
      remotePath: path,
    });
    return data;
  },
});

export const createFileDocumentPort = (filesystem: FilesystemChannel): FileDocumentPort => ({
  async load(path, encoding): Promise<LoadedEditorDocument> {
    const file = await filesystem.readText(path, encoding);
    return {
      path: file.path,
      content: file.content,
      encoding: file.encoding,
      rawContentBase64: file.rawContentBase64,
    };
  },
  save: (path, content, encoding) => filesystem.writeText(path, content, encoding),
});

const racePreviewAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Preview read aborted.', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Preview read aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener('abort', abort);
        reject(cause);
      },
    );
  });
};

export const createFilePreviewSource = (socket: WorkspaceSocket): FilePreviewSource => ({
  async read(path, options) {
    const signal = options?.signal;
    if (options?.maxBytes !== undefined) {
      const entry = await racePreviewAbort(socket.request<RemoteFileEntry>('filesystem.stat', { path }), signal);
      if (entry.metadata.size > options.maxBytes) {
        return { tooLarge: true, actualBytes: entry.metadata.size, maxBytes: options.maxBytes };
      }
    }
    const result = await racePreviewAbort(
      socket.request<BinaryReadResponse>('filesystem.readBinary', { path }),
      signal,
    );
    const bytes = decodeBase64Bytes(result.contentBase64);
    return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  },
});

const transferProgress = (
  id: string,
  progress: number,
  extras: Partial<Extract<TransferEvent, { type: 'progress' }>> = {},
): TransferEvent => ({ type: 'progress', id, progress, ...extras });

const uploadDestinationPath = (request: UploadRequest): string => {
  const base = request.destination.path === '/' ? '' : request.destination.path.replace(/\/+$/, '');
  const relative = request.relativeDirectory ? `${request.relativeDirectory.replace(/^\/+|\/+$/g, '')}/` : '';
  return `${base}/${relative}${request.file.name}`.replace(/\/{2,}/g, '/');
};

interface TransferChannelAdapter extends TransferChannel {
  workspaceConnected(): Promise<void>;
  workspaceDisconnected(): void;
  dispose(): void;
}

const UPLOAD_SCHEDULER_MIN_STREAMS = 6;
const UPLOAD_SCHEDULER_STREAM_CEILING = 12;
const UPLOAD_SCHEDULER_MIN_CAPACITY_UNITS = 8;
const UPLOAD_SCHEDULER_CAPACITY_CEILING = 24;
const UPLOAD_SCHEDULER_MAX_HEAD_BYPASSES = 3;

interface ScheduledUpload {
  request: UploadRequest;
  bypassCount: number;
}

const uploadReservationUnits = (size: number): number => {
  if (size <= 1024 * 1024) return 1;
  if (size <= 16 * 1024 * 1024) return 2;
  if (size <= 64 * 1024 * 1024) return 4;
  return 6;
};

const uploadSchedulerPolicy = (): { streamLimit: number; capacityUnits: number } => {
  const detected = typeof navigator === 'undefined' ? 4 : Number(navigator.hardwareConcurrency || 4);
  const hardwareConcurrency = Number.isFinite(detected) ? Math.max(1, Math.min(16, Math.round(detected))) : 4;
  return {
    streamLimit: Math.max(
      UPLOAD_SCHEDULER_MIN_STREAMS,
      Math.min(UPLOAD_SCHEDULER_STREAM_CEILING, Math.ceil(hardwareConcurrency * 1.5)),
    ),
    capacityUnits: Math.max(
      UPLOAD_SCHEDULER_MIN_CAPACITY_UNITS,
      Math.min(UPLOAD_SCHEDULER_CAPACITY_CEILING, hardwareConcurrency * 2),
    ),
  };
};

export const createTransferChannel = (socket: WorkspaceSocket, workspaceId: string): TransferChannelAdapter => {
  const handlers = new Set<(event: TransferEvent) => void>();
  const uploads = new Map<string, UploadRequest>();
  const uploadSockets = new Map<string, WebSocket>();
  const queuedUploads: ScheduledUpload[] = [];
  const activeUploads = new Set<string>();
  const prepareRequests = new Map<string, UploadPrepareRequest>();
  const activeRemoteOperations = new Map<string, 'copy' | 'move' | 'compress' | 'decompress'>();
  let workspaceAvailable = false;
  let recoveryPending = false;
  let recovering = false;
  const emit = (event: TransferEvent) => {
    for (const handler of handlers) handler(event);
  };

  const closeUploadStream = (id: string, reason = 'Upload stream closed'): void => {
    const uploadSocket = uploadSockets.get(id);
    uploadSockets.delete(id);
    if (uploadSocket && uploadSocket.readyState < WebSocket.CLOSING) uploadSocket.close(1000, reason);
  };

  const removeQueuedUpload = (id: string): void => {
    for (let index = queuedUploads.length - 1; index >= 0; index -= 1) {
      if (queuedUploads[index]?.request.id === id) queuedUploads.splice(index, 1);
    }
  };

  const enqueueUpload = (request: UploadRequest): void => {
    removeQueuedUpload(request.id);
    queuedUploads.push({ request, bypassCount: 0 });
  };

  const forgetUpload = (id: string): UploadRequest | undefined => {
    const request = uploads.get(id);
    uploads.delete(id);
    removeQueuedUpload(id);
    activeUploads.delete(id);
    if (request?.prepareId && ![...uploads.values()].some((item) => item.prepareId === request.prepareId)) {
      prepareRequests.delete(request.prepareId);
    }
    return request;
  };

  const failUploadStream = (request: UploadRequest, message: string): void => {
    if (uploads.get(request.id) !== request) return;
    forgetUpload(request.id);
    closeUploadStream(request.id, 'Upload stream failed');
    emit({ type: 'error', id: request.id, message });
    pumpUploadQueue();
    if (workspaceAvailable && socket.connected) {
      void socket.request<boolean>('upload.abort', { uploadId: request.id, message }).catch(() => undefined);
    }
  };

  const startUploadRequest = async (request: UploadRequest): Promise<void> => {
    await socket.request('upload.start', {
      uploadId: request.id,
      destinationPath: uploadDestinationPath(request),
      size: request.file.size,
      ...(request.prepareId ? { prepareId: request.prepareId } : {}),
      conflictPolicy: request.conflictStrategy ?? 'ask',
    });
  };

  const sendPrepareRequest = async (request: UploadPrepareRequest): Promise<void> => {
    await socket.request('upload.prepare', {
      prepareId: request.id,
      basePath: request.destination.path,
      directories: [...request.directories],
    });
  };

  const recoverUploads = async (): Promise<void> => {
    if (!workspaceAvailable || !recoveryPending || recovering || !uploads.size) return;
    recovering = true;
    recoveryPending = false;
    try {
      const snapshot = [...uploads.values()];
      const prepareIds = [
        ...new Set(snapshot.map((request) => request.prepareId).filter((id): id is string => Boolean(id))),
      ];
      for (const prepareId of prepareIds) {
        const prepare = prepareRequests.get(prepareId);
        if (!prepare) {
          for (const request of snapshot.filter((item) => item.prepareId === prepareId)) {
            if (uploads.get(request.id) !== request) continue;
            forgetUpload(request.id);
            emit({ type: 'error', id: request.id, message: 'Upload directory preparation state was lost.' });
          }
          continue;
        }
        try {
          await sendPrepareRequest(prepare);
        } catch (cause) {
          if (!workspaceAvailable) {
            recoveryPending = true;
            return;
          }
          const message = cause instanceof Error ? cause.message : String(cause);
          for (const request of snapshot.filter((item) => item.prepareId === prepareId)) {
            if (uploads.get(request.id) !== request) continue;
            forgetUpload(request.id);
            emit({ type: 'error', id: request.id, message });
          }
        }
      }

      if (!workspaceAvailable) {
        recoveryPending = true;
        return;
      }
      queuedUploads.splice(0);
      activeUploads.clear();
      for (const request of [...uploads.values()]) {
        emit({ type: 'resumed', id: request.id });
        enqueueUpload(request);
      }
      pumpUploadQueue();
    } finally {
      recovering = false;
    }
  };

  const activeUploadCapacityUnits = (): number =>
    [...activeUploads].reduce((total, id) => {
      const request = uploads.get(id);
      return total + (request ? uploadReservationUnits(request.file.size) : 0);
    }, 0);

  function pumpUploadQueue(): void {
    if (!workspaceAvailable) return;
    const policy = uploadSchedulerPolicy();
    let activeCapacityUnits = activeUploadCapacityUnits();

    while (queuedUploads.length > 0 && activeUploads.size < policy.streamLimit) {
      for (let index = queuedUploads.length - 1; index >= 0; index -= 1) {
        const queued = queuedUploads[index]!;
        if (uploads.get(queued.request.id) !== queued.request) queuedUploads.splice(index, 1);
      }
      if (!queuedUploads.length) return;

      const availableCapacityUnits = policy.capacityUnits - activeCapacityUnits;
      const head = queuedUploads[0]!;
      const headReservation = uploadReservationUnits(head.request.file.size);
      let selectedIndex = 0;

      if (headReservation > availableCapacityUnits) {
        if (head.bypassCount >= UPLOAD_SCHEDULER_MAX_HEAD_BYPASSES) return;
        selectedIndex = queuedUploads.findIndex(
          (queued, index) => index > 0 && uploadReservationUnits(queued.request.file.size) <= availableCapacityUnits,
        );
        if (selectedIndex < 0) return;
        head.bypassCount += 1;
      }

      const [selected] = queuedUploads.splice(selectedIndex, 1);
      if (!selected) return;
      const request = selected.request;
      const reservation = uploadReservationUnits(request.file.size);
      activeUploads.add(request.id);
      activeCapacityUnits += reservation;
      void startUploadRequest(request).catch((cause) => {
        if (uploads.get(request.id) !== request) return;
        if (!workspaceAvailable) return;
        forgetUpload(request.id);
        closeUploadStream(request.id, 'Upload start failed');
        pumpUploadQueue();
        emit({ type: 'error', id: request.id, message: cause instanceof Error ? cause.message : String(cause) });
      });
    }
  }

  const streamUpload = async (request: UploadRequest): Promise<void> => {
    const params = new URLSearchParams({ workspaceId, uploadId: request.id, size: String(request.file.size) });
    const uploadSocket = new WebSocket(createWebSocketUrl(`/ws/uploads?${params}`));
    uploadSockets.set(request.id, uploadSocket);
    uploadSocket.binaryType = 'arraybuffer';
    uploadSocket.onclose = (event) => {
      if (uploadSockets.get(request.id) === uploadSocket) uploadSockets.delete(request.id);
      if (event.code !== 1000 && workspaceAvailable && uploads.get(request.id) === request) {
        failUploadStream(
          request,
          event.reason
            ? `Upload stream closed (${event.code}: ${event.reason}).`
            : `Upload stream closed unexpectedly (${event.code}).`,
        );
      }
    };
    await new Promise<void>((resolve, reject) => {
      uploadSocket.onopen = () => resolve();
      uploadSocket.onerror = () => reject(new Error(`Unable to open upload stream for ${request.file.name}.`));
    });
    if (request.file.size === 0) return;
    const chunkSize = 512 * 1024;
    const highWater = 8 * 1024 * 1024;
    const lowWater = 2 * 1024 * 1024;
    for (let offset = 0; offset < request.file.size; offset += chunkSize) {
      if (!uploads.has(request.id) || uploadSocket.readyState !== WebSocket.OPEN) return;
      if (uploadSocket.bufferedAmount >= highWater) {
        while (uploadSocket.bufferedAmount > lowWater) {
          if (!uploads.has(request.id) || uploadSocket.readyState !== WebSocket.OPEN) return;
          await new Promise((resolve) => window.setTimeout(resolve, 8));
        }
      }
      const chunk = await request.file.slice(offset, Math.min(request.file.size, offset + chunkSize)).arrayBuffer();
      if (!uploads.has(request.id) || uploadSocket.readyState !== WebSocket.OPEN) return;
      uploadSocket.send(chunk);
    }
  };

  const stopUpload = socket.on<UploadEventWire>('transfer.upload', (event) => {
    const id = event.uploadId;
    if (!id) return;
    if (event.type === 'ready') {
      const request = uploads.get(id);
      if (request)
        void streamUpload(request).catch((cause) => {
          if (uploads.get(id) !== request) return;
          failUploadStream(request, cause instanceof Error ? cause.message : String(cause));
        });
      return;
    }
    if (event.type === 'conflict') {
      activeUploads.delete(id);
      pumpUploadQueue();
      emit({ type: 'conflict', id, path: event.destinationPath ?? event.filename ?? '' });
      return;
    }
    if (event.type === 'progress') {
      emit(
        transferProgress(id, event.progress ?? 0, {
          bytesWritten: event.bytesWritten,
          totalBytes: event.totalSize,
          completedFiles: event.progress === 100 ? 1 : 0,
          totalFiles: 1,
        }),
      );
      return;
    }
    if (event.type === 'completed' || event.type === 'skipped') {
      forgetUpload(id);
      closeUploadStream(id, 'Upload finished');
      pumpUploadQueue();
      emit({ type: event.type === 'skipped' ? 'skipped' : 'completed', id });
      return;
    }
    if (event.type === 'cancelled') {
      forgetUpload(id);
      closeUploadStream(id, 'Upload cancelled');
      pumpUploadQueue();
      emit({ type: 'cancelled', id });
      return;
    }
    if (event.type === 'failed') {
      forgetUpload(id);
      closeUploadStream(id, 'Upload failed');
      pumpUploadQueue();
      emit({ type: 'error', id, message: event.message ?? 'Upload failed.' });
    }
  });

  const stopCopyMove = socket.on<CopyMoveEventWire>('transfer.copyMove', (event) => {
    const id = event.requestId;
    if (event.type === 'progress') {
      const progress =
        event.totalKnown && event.totalBytes
          ? Math.min(100, Math.round(((event.transferredBytes ?? 0) / event.totalBytes) * 100))
          : event.totalFiles
            ? Math.min(100, Math.round(((event.completedFiles ?? 0) / event.totalFiles) * 100))
            : 0;
      emit(
        transferProgress(id, progress, {
          bytesWritten: event.transferredBytes,
          totalBytes: event.totalBytes,
          completedFiles: event.completedFiles,
          totalFiles: event.totalFiles,
          currentFile: event.currentFile,
        }),
      );
    } else if (event.type === 'completed') {
      activeRemoteOperations.delete(id);
      emit({ type: 'completed', id });
    } else if (event.type === 'cancelled') {
      activeRemoteOperations.delete(id);
      emit({ type: 'cancelled', id });
    } else if (event.type === 'failed') {
      activeRemoteOperations.delete(id);
      emit({ type: 'error', id, message: event.message ?? 'Transfer failed.' });
    }
  });

  const stopArchive = socket.on<ArchiveEventWire>('transfer.archive', (event) => {
    const id = event.requestId;
    if (event.type === 'progress') {
      const progress =
        event.percent ?? (event.totalFiles ? Math.round(((event.fileCount ?? 0) / event.totalFiles) * 100) : 0);
      emit(
        transferProgress(id, progress, {
          completedFiles: event.fileCount,
          totalFiles: event.totalFiles ?? null,
          currentFile: event.currentFile,
        }),
      );
    } else if (event.type === 'completed') {
      activeRemoteOperations.delete(id);
      emit({ type: 'completed', id, ...(event.warning ? { warning: event.warning } : {}) });
    } else if (event.type === 'cancelled') {
      activeRemoteOperations.delete(id);
      emit({ type: 'cancelled', id });
    } else if (event.type === 'failed') {
      activeRemoteOperations.delete(id);
      emit({
        type: 'error',
        id,
        message: event.message ?? 'Archive operation failed.',
        ...(event.code ? { code: event.code } : {}),
      });
    }
  });

  return {
    async prepareUpload(request) {
      prepareRequests.set(request.id, request);
      try {
        await sendPrepareRequest(request);
      } catch (cause) {
        prepareRequests.delete(request.id);
        throw cause;
      }
    },
    async upload(request) {
      uploads.set(request.id, request);
      enqueueUpload(request);
      if (!workspaceAvailable) {
        recoveryPending = true;
        emit({ type: 'paused', id: request.id });
        return;
      }
      pumpUploadQueue();
    },
    async copyMove(request: CopyMoveRequest) {
      const sourceWorkspaceId = request.sources[0]?.scopeId;
      activeRemoteOperations.set(request.id, request.kind);
      try {
        await socket.requestWithId('transfer.copyMove', request.id, {
          mode: request.kind,
          sources: request.sources.map((source) => source.path),
          destination: request.destination.path,
          ...(sourceWorkspaceId && sourceWorkspaceId !== workspaceId ? { sourceWorkspaceId } : {}),
        });
      } catch (cause) {
        activeRemoteOperations.delete(request.id);
        throw cause;
      }
    },
    async archive(request: ArchiveRequest) {
      activeRemoteOperations.set(request.id, request.kind);
      if (request.kind === 'compress') {
        try {
          await socket.requestWithId('transfer.compress', request.id, {
            sources: request.sources.map((source) => source.path),
            destination: request.destination.path,
            format: request.format ?? 'zip',
            ...(request.password ? { password: request.password } : {}),
          });
        } catch (cause) {
          activeRemoteOperations.delete(request.id);
          throw cause;
        }
      } else {
        try {
          await socket.requestWithId('transfer.decompress', request.id, {
            source: request.sources[0]?.path,
            ...(request.password ? { password: request.password } : {}),
          });
        } catch (cause) {
          activeRemoteOperations.delete(request.id);
          throw cause;
        }
      }
    },
    async cancel(id) {
      const hadUpload = Boolean(forgetUpload(id));
      const remoteOperation = activeRemoteOperations.get(id);
      closeUploadStream(id, 'Upload cancelled');
      pumpUploadQueue();
      if (!workspaceAvailable || !socket.connected) return hadUpload;
      if (hadUpload) {
        const accepted = await socket.request<boolean>('upload.cancel', { uploadId: id }).catch(() => false);
        return hadUpload || accepted;
      }
      if (remoteOperation === 'copy' || remoteOperation === 'move') {
        return socket.request<boolean>('transfer.cancel', { taskId: id }).catch(() => false);
      }
      if (remoteOperation === 'compress' || remoteOperation === 'decompress') {
        return socket.request<boolean>('transfer.cancelArchive', { taskId: id }).catch(() => false);
      }
      return false;
    },
    async resolveConflict(id, strategy) {
      const request = uploads.get(id);
      if (!request) return;
      const retry = { ...request, conflictStrategy: strategy };
      uploads.set(id, retry);
      enqueueUpload(retry);
      pumpUploadQueue();
    },
    onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async workspaceConnected() {
      workspaceAvailable = true;
      await recoverUploads();
      pumpUploadQueue();
    },
    workspaceDisconnected() {
      if (!workspaceAvailable && recoveryPending) return;
      workspaceAvailable = false;
      for (const [id, operation] of activeRemoteOperations) {
        emit({ type: 'error', id, message: `Workspace connection closed during ${operation}.` });
      }
      activeRemoteOperations.clear();
      if (!uploads.size) return;
      recoveryPending = true;
      queuedUploads.splice(0);
      activeUploads.clear();
      for (const request of uploads.values()) {
        emit({ type: 'paused', id: request.id });
        closeUploadStream(request.id, 'Workspace connection closed');
      }
    },
    dispose() {
      workspaceAvailable = false;
      recoveryPending = false;
      handlers.clear();
      uploads.clear();
      prepareRequests.clear();
      activeRemoteOperations.clear();
      queuedUploads.splice(0);
      activeUploads.clear();
      for (const id of [...uploadSockets.keys()]) closeUploadStream(id);
      stopUpload();
      stopCopyMove();
      stopArchive();
    },
  };
};

export const createStatusChannel = (socket: WorkspaceSocket): StatusChannel => ({
  subscribe(handler, error) {
    const stopSample = socket.on<ServerStatusSample>('status.sample', handler);
    const stopError = socket.on<{ message: string }>('status.error', (payload) => error?.(payload.message));
    return () => {
      stopSample();
      stopError();
    };
  },
  start: () => socket.request('status.start'),
  stop: () => socket.request('status.stop'),
});

export const createDockerChannel = (socket: WorkspaceSocket): DockerChannel => ({
  getStatus: (): Promise<DockerStatus> => socket.request('docker.status'),
  async command(containerId: string, command: DockerCommand) {
    await socket.request('docker.command', { containerId, command });
  },
  getStats: (containerId: string): Promise<DockerStats | null> => socket.request('docker.stats', { containerId }),
});

export const createSshSuspendChannel = (socket: WorkspaceSocket): SshSuspendChannel => ({
  mark: (workspaceId, terminalSnapshot) =>
    socket.request('suspend.mark', { workspaceId, ...(terminalSnapshot ? { terminalSnapshot } : {}) }),
  unmark: (workspaceId) => socket.request('suspend.unmark', { workspaceId }),
});

export interface WorkspaceCapabilityAdapters {
  terminal: TerminalChannel;
  filesystem: FilesystemChannel;
  terminalDirectory: TerminalDirectoryPort;
  download: FilesystemDownloadPort;
  documents: FileDocumentPort;
  preview: FilePreviewSource;
  transfers: TransferChannel;
  status: StatusChannel;
  docker: DockerChannel;
  suspend: SshSuspendChannel;
  workspaceConnected(): Promise<void>;
  workspaceDisconnected(): void;
  dispose(): void;
}

export const createWorkspaceCapabilityAdapters = (
  socket: WorkspaceSocket,
  workspaceId: string,
  connectionId: number,
): WorkspaceCapabilityAdapters => {
  let workspaceBound = false;
  let deferredTerminalViewport: TerminalViewport | undefined;
  const filesystem = createFilesystemChannel(socket);
  const transfers = createTransferChannel(socket, workspaceId);
  const terminal = createTerminalChannel(socket, {
    canSend: () => workspaceBound && socket.connected,
    deferResize: (viewport) => {
      deferredTerminalViewport = viewport;
    },
  });
  return {
    terminal,
    filesystem,
    terminalDirectory: createTerminalDirectoryPort(socket),
    download: createFilesystemDownloadPort(workspaceId, connectionId),
    documents: createFileDocumentPort(filesystem),
    preview: createFilePreviewSource(socket),
    transfers,
    status: createStatusChannel(socket),
    docker: createDockerChannel(socket),
    suspend: createSshSuspendChannel(socket),
    async workspaceConnected() {
      await transfers.workspaceConnected();
      workspaceBound = true;
      if (deferredTerminalViewport) {
        const viewport = deferredTerminalViewport;
        deferredTerminalViewport = undefined;
        await terminal.resize(viewport);
      }
    },
    workspaceDisconnected() {
      workspaceBound = false;
      transfers.workspaceDisconnected();
    },
    dispose() {
      workspaceBound = false;
      deferredTerminalViewport = undefined;
      transfers.dispose();
    },
  };
};
