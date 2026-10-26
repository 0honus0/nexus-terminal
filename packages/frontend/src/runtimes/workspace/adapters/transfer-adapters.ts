import type { WorkspaceArchiveEvent, WorkspaceCopyMoveEvent } from '@nexus-terminal/shared/remote/transfers/workspace';
import {
	readWorkspaceArchiveCompress,
	readWorkspaceArchiveDecompress,
	readWorkspaceCopyMove,
	readWorkspaceTaskCancel,
	readWorkspaceTaskStarted,
	readWorkspaceTaskStopped,
} from '@nexus-terminal/shared/remote/transfers/workspace-codec';
import {
	readWorkspaceArchiveEvent,
	readWorkspaceCopyMoveEvent,
} from '@nexus-terminal/shared/remote/transfers/task-codec';
import { WORKSPACE_MAX_JSON_MESSAGE_BYTES } from '@nexus-terminal/shared/remote/workspace/values';
import {
	TransferFailure,
	type ArchiveCommand,
	type CopyMoveCommand,
	type TransferEvent,
} from '@/features/transfers/public';
import { WorkspaceSocket, type WorkspaceAttachmentRequest } from '../protocol/workspaceSocket';
import { WorkspaceDispatchFailure, WorkspaceRequestFailure } from '../model/workspace-error-types';
import { normalizeFilePath } from '../model/workspace-files-mapper';

type TaskEvent = WorkspaceCopyMoveEvent | WorkspaceArchiveEvent;

interface TransferTask {
	id: string;
	kind: 'copy' | 'move' | 'compress' | 'decompress';
	sources: string[];
	destination: string;
	sourceWorkspaceId: string;
	request: WorkspaceAttachmentRequest;
	acknowledged: boolean;
	earlyProgress?: TaskEvent;
	earlyResult?: TaskEvent;
	bytes: number;
	files: number;
	timer: number;
	controller: AbortController;
}

interface WorkspaceTransferAdapter {
	copyMove(command: CopyMoveCommand): Promise<void>;
	archive(command: ArchiveCommand): Promise<void>;
	cancel(id: string): Promise<boolean>;
	disconnect(): void;
	dispose(): void;
}

const TASK_TIMEOUT_MS = 60 * 60 * 1000 + 30_000;

function failure(cause: unknown, dispatched: boolean): TransferFailure {
	if (cause instanceof TransferFailure) return cause;
	if (cause instanceof WorkspaceDispatchFailure) return new TransferFailure(cause.code, false, { cause });
	if (cause instanceof WorkspaceRequestFailure) {
		const unknown = cause.code === 'operation_unknown';
		return new TransferFailure(unknown ? 'operation_unknown' : 'remote_rejected', unknown, { cause });
	}
	return new TransferFailure(dispatched ? 'operation_unknown' : 'invalid_input', dispatched, { cause });
}

function parent(path: string): string {
	return path.slice(0, path.lastIndexOf('/')) || '/';
}

function within(directory: string, source: string): string {
	return `${directory === '/' ? '' : directory}/${source.split('/').at(-1)}`;
}

function copyProgress(event: Extract<WorkspaceCopyMoveEvent, { type: 'progress' }>): number {
	if (!event.totalKnown) return 0;
	if (event.totalBytes > 0) return Math.round((event.transferredBytes / event.totalBytes) * 100);
	return event.totalFiles > 0 ? Math.round((event.completedFiles / event.totalFiles) * 100) : 0;
}

export function createWorkspaceTransferAdapter(
	socket: WorkspaceSocket,
	workspaceId: string,
	canUse: () => boolean,
	emit: (event: TransferEvent) => void,
): WorkspaceTransferAdapter {
	const tasks = new Map<string, TransferTask>();
	let disposed = false;

	const current = (task: TransferTask): boolean => tasks.get(task.id) === task;

	const finish = (task: TransferTask, event: TransferEvent): void => {
		if (!current(task)) return;
		tasks.delete(task.id);
		window.clearTimeout(task.timer);
		task.controller.abort();
		emit(event);
	};

	const fail = (task: TransferTask, error: TransferFailure): void => {
		finish(task, {
			type: 'error',
			id: task.id,
			errorKind: error.outcomeUnknown
				? 'transfer_unknown'
				: task.kind === 'compress' || task.kind === 'decompress'
					? 'archive_failed'
					: 'transfer_failed',
		});
	};

	const receive = (task: TransferTask, event: TaskEvent): void => {
		if (!current(task) || task.earlyResult) return;
		const archive = task.kind === 'compress' || task.kind === 'decompress';
		const archiveEvent = 'operation' in event;
		if (
			archive !== archiveEvent ||
			('operation' in event && event.operation !== task.kind) ||
			('mode' in event && event.mode !== task.kind)
		)
			throw new TransferFailure('protocol_error', true);
		if (event.type === 'progress') {
			const files = 'fileCount' in event ? event.fileCount : event.completedFiles;
			const bytes = 'transferredBytes' in event ? event.transferredBytes : 0;
			if (files < task.files || bytes < task.bytes) throw new TransferFailure('protocol_error', true);
			task.files = files;
			task.bytes = bytes;
		}
		if (event.type === 'completed') {
			if ('path' in event) {
				if (normalizeFilePath(event.path) !== task.destination)
					throw new TransferFailure('protocol_error', true);
			} else {
				if (
					event.mode !== task.kind ||
					normalizeFilePath(event.destinationPath) !== task.destination ||
					event.sourcePaths.length !== task.sources.length ||
					event.sourcePaths.some((source, index) => normalizeFilePath(source) !== task.sources[index]) ||
					event.crossSession !== (task.sourceWorkspaceId !== workspaceId) ||
					(event.crossSession && event.sourceOwnerId !== task.sourceWorkspaceId)
				)
					throw new TransferFailure('protocol_error', true);
				for (const [index, item] of event.items.entries()) {
					const source = task.sources[index];
					if (
						source === undefined ||
						normalizeFilePath(item.path) !== within(task.destination, source) ||
						item.name !== source.split('/').at(-1)
					)
						throw new TransferFailure('protocol_error', true);
				}
			}
		}
		if (!task.acknowledged) {
			// Bound storage: only the latest progress and one terminal result await admission.
			if (task.earlyResult) return;
			if (event.type === 'progress' || event.type === 'cancelling') task.earlyProgress = event;
			else task.earlyResult = event;
			return;
		}
		publish(task, event);
	};

	const publish = (task: TransferTask, event: TaskEvent): void => {
		if (!current(task)) return;
		switch (event.type) {
			case 'progress': {
				if ('fileCount' in event) {
					emit({
						type: 'progress',
						id: task.id,
						progress:
							event.percent ??
							(event.totalFiles ? Math.round((event.fileCount / event.totalFiles) * 100) : 0),
						completedFiles: event.fileCount,
						totalFiles: event.totalFiles ?? null,
						currentFile: event.currentFile,
					});
				} else {
					emit({
						type: 'progress',
						id: task.id,
						progress: copyProgress(event),
						bytesWritten: event.transferredBytes,
						totalBytes: event.totalKnown ? event.totalBytes : 0,
						completedFiles: event.completedFiles,
						totalFiles: event.totalKnown ? event.totalFiles : null,
						currentFile: event.currentFile,
					});
				}
				return;
			}
			case 'cancelling':
				return;
			case 'cancelled':
				finish(task, { type: 'cancelled', id: task.id });
				return;
			case 'completed': {
				const result: TransferEvent = { type: 'completed', id: task.id };
				if ('warning' in event && event.warning !== undefined) {
					result.warning = event.warning;
					result.warningKind = 'archive_completed_with_warning';
				}
				finish(task, result);
				return;
			}
			case 'failed': {
				const result: TransferEvent = {
					type: 'error',
					id: task.id,
					errorKind:
						event.message === 'operation_unknown'
							? 'transfer_unknown'
							: 'operation' in event
								? 'archive_failed'
								: 'transfer_failed',
				};
				if ('code' in event && event.code !== undefined) result.code = event.code;
				finish(task, result);
			}
		}
	};

	const listen = (kind: 'copy' | 'archive', input: unknown): void => {
		let event: TaskEvent;
		try {
			event = kind === 'copy' ? readWorkspaceCopyMoveEvent(input) : readWorkspaceArchiveEvent(input);
		} catch (cause) {
			// A malformed ID cannot safely select just one active task on this channel.
			for (const task of [...tasks.values()]) {
				const archive = task.kind === 'compress' || task.kind === 'decompress';
				if (archive === (kind === 'archive'))
					fail(task, new TransferFailure('protocol_error', true, { cause }));
			}
			return;
		}
		const task = tasks.get(event.requestId);
		if (!task) return;
		try {
			receive(task, event);
		} catch (cause) {
			fail(task, new TransferFailure('protocol_error', true, { cause }));
		}
	};

	const stops = [
		socket.on('transfer.copyMove', (event) => listen('copy', event)),
		socket.on('transfer.archive', (event) => listen('archive', event)),
	];

	const disconnect = (): void => {
		for (const task of [...tasks.values()]) fail(task, new TransferFailure('operation_unknown', true));
	};

	stops.push(socket.onClose(disconnect));

	const start = async (command: CopyMoveCommand | ArchiveCommand): Promise<void> => {
		if (disposed || !canUse() || !socket.connected) throw new TransferFailure('not_connected', false);
		if (tasks.has(command.id)) throw new TransferFailure('invalid_input', false);
		let task: TransferTask | undefined;
		let dispatched = false;
		try {
			const sources = command.sources.map((source) => normalizeFilePath(source.path));
			const sourceWorkspaceId = command.sources[0]?.scopeId;
			if (
				!sourceWorkspaceId ||
				command.sources.some((source) => source.scopeId !== sourceWorkspaceId) ||
				command.destination.scopeId !== workspaceId
			)
				throw new TransferFailure('invalid_input', false);
			const kind = command.kind;
			const archive = kind === 'compress' || kind === 'decompress';
			if (archive && sourceWorkspaceId !== workspaceId) throw new TransferFailure('invalid_input', false);
			if (kind === 'decompress' && sources.length !== 1) throw new TransferFailure('invalid_input', false);
			const destination = normalizeFilePath(command.destination.path);
			const operation =
				kind === 'copy' || kind === 'move'
					? 'transfer.copyMove'
					: kind === 'compress'
						? 'transfer.compress'
						: 'transfer.decompress';
			let input: object;
			if (kind === 'copy' || kind === 'move') {
				input = readWorkspaceCopyMove({
					mode: kind,
					sources,
					destination,
					...(sourceWorkspaceId === workspaceId ? {} : { sourceWorkspaceId }),
				});
			} else if (command.kind === 'compress') {
				input = readWorkspaceArchiveCompress({
					sources,
					destination,
					format: command.format ?? 'zip',
					...(command.password === undefined ? {} : { password: command.password }),
				});
			} else if (command.kind === 'decompress') {
				input = readWorkspaceArchiveDecompress({
					source: sources[0],
					...(command.password === undefined ? {} : { password: command.password }),
				});
			} else {
				throw new TransferFailure('invalid_input', false);
			}
			readWorkspaceTaskCancel({ taskId: command.id });
			if (
				new TextEncoder().encode(JSON.stringify({ type: operation, requestId: command.id, payload: input }))
					.byteLength > WORKSPACE_MAX_JSON_MESSAGE_BYTES
			)
				throw new TransferFailure('limit_exceeded', false);
			if (new Set(sources).size !== sources.length) throw new TransferFailure('invalid_input', false);
			task = {
				id: command.id,
				kind,
				sources,
				destination: kind === 'decompress' ? parent(sources[0] ?? '') : destination,
				sourceWorkspaceId,
				request: socket.bindRequests(),
				acknowledged: false,
				bytes: 0,
				files: 0,
				controller: new AbortController(),
				timer: 0,
			};
			const active = task;
			task.timer = window.setTimeout(
				() => fail(active, new TransferFailure('operation_unknown', true)),
				TASK_TIMEOUT_MS,
			);
			tasks.set(task.id, task);
			dispatched = true;
			const response = await task.request(operation, input, task.id, task.controller.signal);
			readWorkspaceTaskStarted(response);
			if (!current(task)) return;
			task.acknowledged = true;
			if (task.earlyProgress) publish(task, task.earlyProgress);
			if (task.earlyResult) publish(task, task.earlyResult);
			task.earlyProgress = undefined;
			task.earlyResult = undefined;
		} catch (cause) {
			const error = failure(cause, dispatched);
			if (task && current(task)) fail(task, error);
			throw error;
		}
	};

	return {
		copyMove: start,
		archive: start,

		async cancel(id) {
			const task = tasks.get(id);
			if (!task) return false;
			try {
				const result = readWorkspaceTaskStopped(
					await task.request(
						task.kind === 'copy' || task.kind === 'move' ? 'transfer.cancel' : 'transfer.cancelArchive',
						{ taskId: id },
						undefined,
						task.controller.signal,
					),
				);
				return current(task) && result;
			} catch (cause) {
				if (current(task)) fail(task, new TransferFailure('operation_unknown', true, { cause }));
				return false;
			}
		},

		disconnect,

		dispose() {
			if (disposed) return;
			disposed = true;
			disconnect();
			for (const stop of stops) stop();
		},
	};
}
