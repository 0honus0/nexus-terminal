import type { ConflictStrategy, UploadConflict, TransferController } from '../model/transfer-types';
import { computed, ref } from 'vue';
import type { TransferChannel } from '../ports/transfer-channel';
import { TransferFailure } from '../model/transfer-types';
import type {
	ArchiveCommand,
	CopyMoveCommand,
	TransferLocation,
	TransferTask,
	UploadSourceFile,
} from '../model/transfer-types';

const TERMINAL_TASK_CLEANUP_DELAY_MS = 800;

const isDone = (status: TransferTask['status']): boolean =>
	['completed', 'cancelled', 'skipped', 'partial', 'unknown', 'error'].includes(status);

const normalizeRelativeDirectory = (value?: string): string => {
	if (!value) {
		return '';
	}
	const normalized = value
		.replace(/\\/g, '/')
		.replace(/^\.\//, '')
		.replace(/^\/+|\/+$/g, '');
	const parts = normalized.split('/').filter(Boolean);
	if (parts.some((part) => part === '.' || part === '..')) {
		throw new Error(`Invalid upload directory: ${value}`);
	}
	return parts.join('/');
};

const normalizeUploadSource = (value: File | UploadSourceFile): UploadSourceFile =>
	value instanceof File ? { file: value } : { file: value.file, relativeDirectory: value.relativeDirectory };

export function createTransferController(channel: TransferChannel): TransferController {
	const tasks = ref<TransferTask[]>([]);
	const conflictQueue = ref<UploadConflict[]>([]);
	const uploadBatches = new Map<string, string>();
	const batchPolicies = new Map<string, ConflictStrategy>();
	const taskWaiters = new Map<string, Set<(task: TransferTask) => void>>();
	const completionCleanupTimers = new Map<string, number>();
	const submittedUploads = new Set<string>();
	let disposed = false;
	const conflict = computed(() => conflictQueue.value[0] ?? null);

	const upsert = (task: TransferTask): void => {
		const index = tasks.value.findIndex((current) => current.id === task.id);
		if (index >= 0) {
			tasks.value[index] = task;
		} else {
			tasks.value.unshift(task);
		}
	};

	const settleTask = (task: TransferTask): void => {
		if (!isDone(task.status)) {
			return;
		}
		const waiters = taskWaiters.get(task.id);
		taskWaiters.delete(task.id);
		for (const resolve of waiters ?? []) {
			resolve(task);
		}
	};

	const remove = (id: string): void => {
		const timer = completionCleanupTimers.get(id);
		if (timer !== undefined) {
			window.clearTimeout(timer);
		}
		completionCleanupTimers.delete(id);
		const index = tasks.value.findIndex((task) => task.id === id);
		if (index >= 0) {
			tasks.value.splice(index, 1);
		}
	};

	const scheduleTerminalCleanup = (task: TransferTask): void => {
		if (!['completed', 'skipped', 'cancelled'].includes(task.status)) {
			return;
		}
		const existing = completionCleanupTimers.get(task.id);
		if (existing !== undefined) {
			window.clearTimeout(existing);
		}
		completionCleanupTimers.set(
			task.id,
			window.setTimeout(() => remove(task.id), TERMINAL_TASK_CLEANUP_DELAY_MS),
		);
	};

	const failTask = (id: string, cause: unknown): void => {
		const task = tasks.value.find((current) => current.id === id);
		if (!task || isDone(task.status)) {
			return;
		}
		const unknown = cause instanceof TransferFailure && cause.outcomeUnknown;
		task.status = unknown ? 'unknown' : 'error';
		if (unknown) {
			task.errorKind = task.kind === 'upload' ? 'upload_unknown' : 'transfer_unknown';
		} else if (task.kind === 'upload') {
			task.errorKind = 'upload_failed';
		} else {
			task.errorKind =
				task.kind === 'compress' || task.kind === 'decompress' ? 'archive_failed' : 'transfer_failed';
		}

		if (task.kind === 'upload') {
			cleanupUpload(id);
		}
		settleTask(task);
	};

	const waitForTask = (id: string): Promise<TransferTask> => {
		const task = tasks.value.find((current) => current.id === id);
		if (!task) {
			return Promise.reject(new Error(`Transfer task not found: ${id}`));
		}
		if (isDone(task.status)) {
			return Promise.resolve(task);
		}
		return new Promise<TransferTask>((resolve) => {
			const waiters = taskWaiters.get(id) ?? new Set<(task: TransferTask) => void>();
			waiters.add(resolve);
			taskWaiters.set(id, waiters);
		});
	};

	const cleanupUpload = (id: string): void => {
		submittedUploads.delete(id);
		const batchId = uploadBatches.get(id);
		uploadBatches.delete(id);
		conflictQueue.value = conflictQueue.value.filter((item) => item.id !== id);
		if (batchId && ![...uploadBatches.values()].includes(batchId)) {
			batchPolicies.delete(batchId);
		}
	};

	const resolveAutomatically = async (id: string, strategy: ConflictStrategy): Promise<void> => {
		if (!channel.resolveConflict) {
			return;
		}
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
			const task = tasks.value.find((current) => current.id === event.id);
			if (!task || isDone(task.status) || task.status === 'cancelling') {
				return;
			}
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
		if (!task) {
			return;
		}
		if (event.type === 'paused') {
			if (isDone(task.status) || task.status === 'cancelling') {
				return;
			}
			task.status = 'paused';
			conflictQueue.value = conflictQueue.value.filter((item) => item.id !== task.id);
			return;
		}
		if (event.type === 'resumed') {
			if (isDone(task.status) || task.status === 'cancelling') {
				return;
			}
			Object.assign(task, {
				status: 'running',
				progress: 0,
				bytesWritten: 0,
				completedFiles: 0,
				currentFile: undefined,
				error: undefined,
				errorKind: undefined,
				errorCode: undefined,
				warning: undefined,
				warningKind: undefined,
			});
			return;
		}
		if (event.type === 'progress') {
			if (task.status === 'cancelling' || isDone(task.status)) {
				return;
			}
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

		if (isDone(task.status)) {
			return;
		}
		if (event.type === 'completed') {
			Object.assign(
				task,
				event.warning
					? { status: 'partial', progress: 100, warning: event.warning, warningKind: event.warningKind }
					: { status: 'completed', progress: 100 },
				task.kind === 'upload' ? { bytesWritten: task.totalBytes, completedFiles: 1 } : {},
			);
		} else if (event.type === 'skipped') {
			task.status = 'skipped';
		} else if (event.type === 'cancelled') {
			task.status = 'cancelled';
		} else if (event.type === 'error') {
			Object.assign(task, {
				status:
					event.errorKind === 'upload_unknown' || event.errorKind === 'transfer_unknown'
						? 'unknown'
						: 'error',
				error: event.message,
				errorKind: event.errorKind,
				errorCode: event.code,
			});
		}

		if (isDone(task.status) && task.kind === 'upload') {
			cleanupUpload(task.id);
		}
		settleTask(task);
		scheduleTerminalCleanup(task);
	});

	const active = computed(() => tasks.value.filter((task) => !isDone(task.status)));

	const startUploadBatch = async (
		sources: readonly (File | UploadSourceFile)[],
		destination: TransferLocation,
		directories: readonly string[] = [],
	): Promise<string[]> => {
		if (disposed) {
			throw new TransferFailure('not_connected', false);
		}
		if (!sources.length && !directories.length) {
			return [];
		}
		const batchId = crypto.randomUUID();
		const normalizedSources = sources.map(normalizeUploadSource).map((source) => ({
			...source,
			relativeDirectory: normalizeRelativeDirectory(source.relativeDirectory),
		}));
		const directorySet = new Set(directories.map(normalizeRelativeDirectory).filter(Boolean));
		for (const source of normalizedSources) {
			if (source.relativeDirectory) {
				directorySet.add(source.relativeDirectory);
			}
		}
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
					if (task && task.status === 'preparing') {
						task.status = 'queued';
					}
				}
			} catch (cause) {
				for (const upload of uploads) {
					failTask(upload.id, cause);
				}
				throw cause;
			}
		}

		for (const upload of uploads) {
			const task = tasks.value.find((current) => current.id === upload.id);
			if (disposed || !task || isDone(task.status)) {
				continue;
			}
			const conflictStrategy = batchPolicies.get(batchId) ?? 'ask';
			try {
				submittedUploads.add(upload.id);
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

	const copyMove = async (request: Omit<CopyMoveCommand, 'id'>) => {
		if (disposed) throw new TransferFailure('not_connected', false);
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
			failTask(id, cause);
			throw cause;
		}
		return id;
	};

	const archive = async (request: Omit<ArchiveCommand, 'id'>) => {
		if (disposed) throw new TransferFailure('not_connected', false);
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
		if (!task || isDone(task.status)) {
			return;
		}
		if (task.kind === 'upload' && !submittedUploads.has(id)) {
			task.status = 'cancelled';
			cleanupUpload(id);
			settleTask(task);
			scheduleTerminalCleanup(task);
			return;
		}
		const previousStatus = task.status;
		task.status = 'cancelling';
		const accepted = await channel.cancel(id);
		if (!accepted && task.status === 'cancelling') {
			task.status = previousStatus;
		}
	};

	const cancelAll = async () => {
		await Promise.allSettled(active.value.map((task) => cancel(task.id)));
	};

	const resolveConflict = async (strategy: ConflictStrategy, applyToAll = false) => {
		const current = conflict.value;
		if (!current || !channel.resolveConflict) {
			return;
		}

		try {
			await channel.resolveConflict(current.id, strategy, false);
		} catch (cause) {
			failTask(current.id, cause);
			return;
		}
		conflictQueue.value = conflictQueue.value.filter((item) => item.id !== current.id);
		if (!applyToAll) {
			return;
		}

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
		remove,

		dispose() {
			disposed = true;
			stop();
			for (const timer of completionCleanupTimers.values()) {
				window.clearTimeout(timer);
			}
			completionCleanupTimers.clear();
			for (const task of active.value) {
				task.status = 'unknown';
				task.errorKind = task.kind === 'upload' ? 'upload_unknown' : 'transfer_unknown';
				settleTask(task);
			}
			taskWaiters.clear();
		},
	};
}
