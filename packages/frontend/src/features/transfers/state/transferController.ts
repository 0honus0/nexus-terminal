import { computed, ref } from 'vue';
import type { TransferChannel } from '../ports/transfer-channel';
import type {
  ArchiveRequest,
  CopyMoveRequest,
  TransferLocation,
  TransferTask,
  UploadRequest,
  UploadSourceFile,
} from '../model/transfer';

type ConflictStrategy = 'overwrite' | 'skip';
interface UploadConflict {
  id: string;
  path: string;
  batchId: string;
}

const isDone = (status: TransferTask['status']): boolean =>
  ['completed', 'cancelled', 'skipped', 'partial', 'error'].includes(status);

const normalizeRelativeDirectory = (value?: string): string => {
  if (!value) return '';
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error(`Invalid upload directory: ${value}`);
  return parts.join('/');
};

const normalizeUploadSource = (value: File | UploadSourceFile): UploadSourceFile =>
  value instanceof File ? { file: value } : { file: value.file, relativeDirectory: value.relativeDirectory };

export function createTransferController(channel: TransferChannel) {
  const tasks = ref<TransferTask[]>([]);
  const conflictQueue = ref<UploadConflict[]>([]);
  const uploadBatches = new Map<string, string>();
  const batchPolicies = new Map<string, ConflictStrategy>();
  const taskWaiters = new Map<string, Set<(task: TransferTask) => void>>();
  const conflict = computed(() => conflictQueue.value[0] ?? null);

  const upsert = (task: TransferTask): void => {
    const index = tasks.value.findIndex((current) => current.id === task.id);
    if (index >= 0) tasks.value[index] = task;
    else tasks.value.unshift(task);
  };
  const settleTask = (task: TransferTask): void => {
    if (!isDone(task.status)) return;
    const waiters = taskWaiters.get(task.id);
    taskWaiters.delete(task.id);
    for (const resolve of waiters ?? []) resolve(task);
  };
  const failTask = (id: string, cause: unknown): void => {
    const task = tasks.value.find((current) => current.id === id);
    if (!task || isDone(task.status)) return;
    Object.assign(task, { status: 'error', error: cause instanceof Error ? cause.message : String(cause) });
    if (task.kind === 'upload') cleanupUpload(id);
    settleTask(task);
  };

  const waitForTask = (id: string): Promise<TransferTask> => {
    const task = tasks.value.find((current) => current.id === id);
    if (!task) return Promise.reject(new Error(`Transfer task not found: ${id}`));
    if (isDone(task.status)) return Promise.resolve(task);
    return new Promise<TransferTask>((resolve) => {
      const waiters = taskWaiters.get(id) ?? new Set<(task: TransferTask) => void>();
      waiters.add(resolve);
      taskWaiters.set(id, waiters);
    });
  };
  const markPartial = (id: string, message: string): void => {
    const task = tasks.value.find((current) => current.id === id);
    if (!task) return;
    Object.assign(task, { status: 'partial', progress: 100, warning: message, error: undefined });
    task.errorCode = undefined;
    settleTask(task);
  };

  const cleanupUpload = (id: string): void => {
    const batchId = uploadBatches.get(id);
    uploadBatches.delete(id);
    conflictQueue.value = conflictQueue.value.filter((item) => item.id !== id);
    if (batchId && ![...uploadBatches.values()].includes(batchId)) batchPolicies.delete(batchId);
  };

  const resolveAutomatically = async (id: string, strategy: ConflictStrategy): Promise<void> => {
    if (!channel.resolveConflict) return;
    try {
      await channel.resolveConflict(id, strategy, false);
    } catch (cause) {
      failTask(id, cause);
    }
  };

  const stop = channel.onEvent((event) => {
    if (event.type === 'task') {
      upsert(event.task);
      return;
    }

    if (event.type === 'conflict') {
      const batchId = uploadBatches.get(event.id) ?? event.id;
      const policy = batchPolicies.get(batchId);
      if (policy) {
        void resolveAutomatically(event.id, policy);
        return;
      }
      if (!conflictQueue.value.some((item) => item.id === event.id)) {
        conflictQueue.value.push({ id: event.id, path: event.path, batchId });
      }
      return;
    }

    const task = tasks.value.find((current) => current.id === event.id);
    if (!task) return;
    if (event.type === 'paused') {
      if (isDone(task.status) || task.status === 'cancelling') return;
      task.status = 'paused';
      conflictQueue.value = conflictQueue.value.filter((item) => item.id !== task.id);
      return;
    }
    if (event.type === 'resumed') {
      if (isDone(task.status) || task.status === 'cancelling') return;
      Object.assign(task, {
        status: 'running',
        progress: 0,
        bytesWritten: 0,
        completedFiles: 0,
        currentFile: undefined,
        error: undefined,
        errorCode: undefined,
        warning: undefined,
      });
      return;
    }
    if (event.type === 'progress') {
      if (task.status === 'cancelling' || task.status === 'cancelled') return;
      Object.assign(task, {
        status: 'running',
        progress: event.progress,
        bytesWritten: event.bytesWritten ?? task.bytesWritten,
        totalBytes: event.totalBytes ?? task.totalBytes,
        completedFiles: event.completedFiles ?? task.completedFiles,
        totalFiles: event.totalFiles ?? task.totalFiles,
        currentFile: event.currentFile ?? task.currentFile,
      });
      return;
    }

    if (isDone(task.status)) return;
    if (event.type === 'completed')
      Object.assign(
        task,
        event.warning
          ? { status: 'partial', progress: 100, warning: event.warning }
          : { status: 'completed', progress: 100 },
      );
    else if (event.type === 'skipped') task.status = 'skipped';
    else if (event.type === 'cancelled') task.status = 'cancelled';
    else if (event.type === 'error')
      Object.assign(task, {
        status: 'error',
        error: event.message,
        errorCode: event.code,
      });

    if (isDone(task.status) && task.kind === 'upload') cleanupUpload(task.id);
    settleTask(task);
  });

  const active = computed(() => tasks.value.filter((task) => !isDone(task.status)));

  const startUploadBatch = async (
    sources: readonly (File | UploadSourceFile)[],
    destination: TransferLocation,
    directories: readonly string[] = [],
  ): Promise<string[]> => {
    if (!sources.length && !directories.length) return [];
    const batchId = crypto.randomUUID();
    const normalizedSources = sources.map(normalizeUploadSource).map((source) => ({
      ...source,
      relativeDirectory: normalizeRelativeDirectory(source.relativeDirectory),
    }));
    const directorySet = new Set(directories.map(normalizeRelativeDirectory).filter(Boolean));
    for (const source of normalizedSources) if (source.relativeDirectory) directorySet.add(source.relativeDirectory);
    const requiresPrepare = directorySet.size > 0;
    const prepareId = requiresPrepare ? batchId : undefined;
    const uploads = normalizedSources.map((source) => {
      const id = crypto.randomUUID();
      uploadBatches.set(id, batchId);
      upsert({
        id,
        kind: 'upload',
        label: source.relativeDirectory ? `${source.relativeDirectory}/${source.file.name}` : source.file.name,
        status: requiresPrepare ? 'preparing' : 'queued',
        progress: 0,
        bytesWritten: 0,
        totalBytes: source.file.size,
        completedFiles: 0,
        totalFiles: 1,
        createdAt: Date.now(),
      });
      return { id, ...source };
    });

    if (requiresPrepare) {
      try {
        await channel.prepareUpload({ id: batchId, destination, directories: [...directorySet] });
        for (const upload of uploads) {
          const task = tasks.value.find((current) => current.id === upload.id);
          if (task && task.status === 'preparing') task.status = 'queued';
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        for (const upload of uploads) {
          const task = tasks.value.find((current) => current.id === upload.id);
          if (task) {
            Object.assign(task, { status: 'error', error: message });
            settleTask(task);
          }
          cleanupUpload(upload.id);
        }
        throw cause;
      }
    }

    for (const upload of uploads) {
      const conflictStrategy = batchPolicies.get(batchId) ?? 'ask';
      try {
        await channel.upload({
          id: upload.id,
          file: upload.file,
          destination,
          ...(upload.relativeDirectory ? { relativeDirectory: upload.relativeDirectory } : {}),
          ...(prepareId ? { prepareId } : {}),
          conflictStrategy,
        });
      } catch (cause) {
        failTask(upload.id, cause);
      }
    }
    return uploads.map((upload) => upload.id);
  };

  const copyMove = async (request: Omit<CopyMoveRequest, 'id'>) => {
    const id = crypto.randomUUID();
    const task: TransferTask = {
      id,
      kind: request.kind,
      label: request.sources.map((source) => source.path.split('/').pop()).join(', '),
      status: 'queued',
      progress: 0,
      bytesWritten: 0,
      totalBytes: 0,
      completedFiles: 0,
      totalFiles: null,
      createdAt: Date.now(),
    };
    upsert(task);
    try {
      await channel.copyMove({ id, ...request });
    } catch (cause) {
      Object.assign(task, { status: 'error', error: cause instanceof Error ? cause.message : String(cause) });
      settleTask(task);
      throw cause;
    }
    return id;
  };

  const archive = async (request: Omit<ArchiveRequest, 'id'>) => {
    const id = crypto.randomUUID();
    upsert({
      id,
      kind: request.kind,
      label:
        (request.kind === 'compress' ? request.destination.path : request.sources[0]?.path)?.split('/').pop() ??
        request.kind,
      status: 'queued',
      progress: 0,
      bytesWritten: 0,
      totalBytes: 0,
      completedFiles: 0,
      totalFiles: null,
      createdAt: Date.now(),
    });
    try {
      await channel.archive({ id, ...request });
    } catch (cause) {
      failTask(id, cause);
      throw cause;
    }
    return id;
  };

  const cancel = async (id: string) => {
    const task = tasks.value.find((current) => current.id === id);
    if (!task || isDone(task.status)) return;
    const previousStatus = task.status;
    task.status = 'cancelling';
    const accepted = await channel.cancel(id);
    if (accepted && task.status === 'cancelling' && task.kind === 'upload') {
      task.status = 'cancelled';
      cleanupUpload(task.id);
      settleTask(task);
    } else if (!accepted && task.status === 'cancelling') {
      task.status = previousStatus;
    }
  };

  const cancelAll = async () => {
    await Promise.allSettled(active.value.map((task) => cancel(task.id)));
  };

  const resolveConflict = async (strategy: ConflictStrategy, applyToAll = false) => {
    const current = conflict.value;
    if (!current || !channel.resolveConflict) return;

    try {
      await channel.resolveConflict(current.id, strategy, false);
    } catch (cause) {
      failTask(current.id, cause);
      return;
    }
    conflictQueue.value = conflictQueue.value.filter((item) => item.id !== current.id);
    if (!applyToAll) return;

    batchPolicies.set(current.batchId, strategy);
    const queued = conflictQueue.value.filter((item) => item.batchId === current.batchId);
    conflictQueue.value = conflictQueue.value.filter((item) => item.batchId !== current.batchId);
    await Promise.all(queued.map((item) => resolveAutomatically(item.id, strategy)));
  };

  return {
    tasks,
    active,
    conflict,
    startUploadBatch,
    copyMove,
    archive,
    cancel,
    cancelAll,
    resolveConflict,
    waitForTask,
    markPartial,
    dispose() {
      stop();
      for (const task of active.value) {
        task.status = 'cancelled';
        settleTask(task);
      }
      taskWaiters.clear();
    },
  };
}

export type TransferController = ReturnType<typeof createTransferController>;
