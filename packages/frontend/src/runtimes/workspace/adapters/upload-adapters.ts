import {
	readWorkspaceUploadPrepare,
	readWorkspaceUploadStart,
	readWorkspaceUploadStream,
	readWorkspaceUploadPrepared,
	readWorkspaceTaskStarted,
	readWorkspaceTaskStopped,
	readWorkspaceUploadEvent,
} from '@nexus-terminal/shared/remote/transfers/workspace-codec';
import { WORKSPACE_UPLOAD_MAX_CHUNK_BYTES } from '@nexus-terminal/shared/remote/transfers/values';
import { WORKSPACE_MAX_JSON_MESSAGE_BYTES } from '@nexus-terminal/shared/remote/workspace/values';
import type {
	WorkspaceUploadEvent,
	WorkspaceUploadStart,
	WorkspaceUploadPrepare,
} from '@nexus-terminal/shared/remote/transfers/workspace';
import { createWebSocketUrl } from '@/client/websocket';
import { TransferFailure } from '@/features/transfers/public';
import type {
	UploadCommand,
	UploadPrepareCommand,
	TransferEvent,
	TransferErrorKind,
} from '@/features/transfers/public';
import { WorkspaceSocket, type WorkspaceAttachmentRequest } from '../protocol/workspaceSocket';
import { WorkspaceDispatchFailure, WorkspaceRequestFailure } from '../model/workspace-error-types';
import { normalizeFilePath } from '../model/workspace-files-mapper';

interface UploadTask {
	command: UploadCommand;
	input: WorkspaceUploadStart;
	request: WorkspaceAttachmentRequest;
	phase: 'queued' | 'starting' | 'running' | 'conflict' | 'cancelling';
	acknowledged: boolean;
	earlyEvent?: WorkspaceUploadEvent;
	controller: AbortController;
	stream?: WebSocket;
	timer?: number;
	stopStream?: () => void;
	bytesSent: number;
	bytesWritten: number;
	nextChunk: number;
}

interface PreparedBatch {
	root: string;
	directories: Set<string>;
	expiresAt: number;
}

interface WorkspaceUploadAdapter {
	prepare(request: UploadPrepareCommand): Promise<void>;
	upload(request: UploadCommand): Promise<void>;
	owns(id: string): boolean;
	cancel(id: string): Promise<boolean>;
	resolveConflict(id: string, strategy: 'overwrite' | 'skip'): Promise<void>;
	connect(): void;
	disconnect(): void;
	dispose(): void;
}

const MAX_LOCAL_TASKS = 20_000;
const MAX_PREPARED_BATCHES = 64;
const OPEN_TIMEOUT_MS = 10_000;
const TASK_TIMEOUT_MS = 60 * 60 * 1000 + 30_000;
const BUFFER_HIGH_WATER = 8 * 1024 * 1024;
const BUFFER_LOW_WATER = 2 * 1024 * 1024;

function activeStreamLimit(): number {
	// Each active upload opens a separately owned SSH/SFTP connection. A
	// per-Workspace budget reserves host capacity for Files reads and control
	// traffic; a large local drop queues its tail rather than starting every
	// SSH connection simultaneously on high-core-count browsers.
	return 6;
}

function failure(cause: unknown, dispatched: boolean): TransferFailure {
	if (cause instanceof TransferFailure) {
		return cause;
	}
	if (cause instanceof WorkspaceDispatchFailure) {
		return new TransferFailure(cause.code === 'limit_exceeded' ? 'limit_exceeded' : 'not_connected', false, {
			cause,
		});
	}
	if (cause instanceof WorkspaceRequestFailure) {
		const unknown = cause.code === 'operation_unknown';
		return new TransferFailure(unknown ? 'operation_unknown' : 'remote_rejected', unknown, { cause });
	}
	return new TransferFailure(dispatched ? 'operation_unknown' : 'invalid_input', dispatched, { cause });
}

function uploadErrorKind(error: TransferFailure): TransferErrorKind {
	if (error.outcomeUnknown) {
		return 'upload_unknown';
	}
	switch (error.code) {
		case 'protocol_error':
			return 'upload_protocol_error';
		case 'not_connected':
			return 'upload_not_connected';
		default:
			return 'upload_failed';
	}
}

function pathWithin(root: string, relative: string): string {
	if (
		relative.startsWith('/') ||
		relative.includes('\0') ||
		relative.split('/').some((part) => part === '..' || part === '.')
	) {
		throw new TransferFailure('invalid_input', false);
	}
	return normalizeFilePath(`${root === '/' ? '' : root}/${relative}`);
}

function uploadRoot(path: string): string {
	if (path.split('/').some((part) => part === '.' || part === '..')) {
		throw new TransferFailure('invalid_input', false);
	}
	return normalizeFilePath(path);
}

function uploadInput(command: UploadCommand, workspaceId: string): WorkspaceUploadStart {
	if (
		command.destination.scopeId !== workspaceId ||
		!command.file.name ||
		command.file.name.includes('/') ||
		command.file.name === '.' ||
		command.file.name === '..'
	) {
		throw new TransferFailure('invalid_input', false);
	}
	const root = uploadRoot(command.destination.path);
	const relativePath = `${command.relativeDirectory ? command.relativeDirectory + '/' : ''}${command.file.name}`;
	return readWorkspaceUploadStart({
		uploadId: command.id,
		destinationPath: pathWithin(root, relativePath),
		size: command.file.size,
		conflictPolicy: command.conflictStrategy ?? 'ask',
		...(command.prepareId === undefined ? {} : { prepareId: command.prepareId, relativePath }),
	});
}

export function createWorkspaceUploadAdapter(
	socket: WorkspaceSocket,
	workspaceId: string,
	canUse: () => boolean,
	emit: (event: TransferEvent) => void,
): WorkspaceUploadAdapter {
	const tasks = new Map<string, UploadTask>();
	const prepared = new Map<string, PreparedBatch>();
	const preparations = new Map<string, AbortController>();
	let disposed = false;
	let disconnected = false;
	let generation = 0;

	const current = (task: UploadTask): boolean =>
		!disposed && tasks.get(task.command.id) === task && !task.controller.signal.aborted;

	const canStream = (task: UploadTask): boolean => current(task) && task.phase !== 'cancelling';

	const available = (): void => {
		if (disposed || disconnected || !canUse() || !socket.connected) {
			throw new TransferFailure('not_connected', false);
		}
	};

	const control = async (
		request: WorkspaceAttachmentRequest,
		type: string,
		input: object,
		signal?: AbortSignal,
	): Promise<unknown> => {
		available();
		const requestId = crypto.randomUUID();
		if (
			new TextEncoder().encode(JSON.stringify({ type, requestId, payload: input })).length >
			WORKSPACE_MAX_JSON_MESSAGE_BYTES
		) {
			throw new TransferFailure('limit_exceeded', false);
		}
		try {
			return await request(type, input, requestId, signal);
		} catch (cause) {
			throw failure(cause, true);
		}
	};

	const finish = (task: UploadTask, event: TransferEvent): void => {
		if (!current(task)) {
			return;
		}
		tasks.delete(task.command.id);
		window.clearTimeout(task.timer);
		task.controller.abort();
		task.stopStream?.();
		if (task.stream && task.stream.readyState < WebSocket.CLOSING) {
			task.stream.close(1000, 'Upload owner closed');
		}
		emit(event);
		pump();
	};

	const abortRemote = (task: UploadTask): void => {
		if (disposed || disconnected || !canUse() || !socket.connected) {
			return;
		}
		// This request is bound to the original control attachment. Its admission
		// cannot turn an already unknown result into confirmed cleanup.
		void control(task.request, 'upload.abort', { uploadId: task.command.id, message: 'operation_unknown' })
			.then(readWorkspaceTaskStopped)
			.catch(() => undefined);
	};

	const fail = (task: UploadTask, error: TransferFailure): void => {
		if (!current(task)) {
			return;
		}
		const shouldAbort = error.outcomeUnknown && task.phase !== 'queued' && task.phase !== 'conflict';
		finish(task, {
			type: 'error',
			id: task.command.id,
			errorKind: uploadErrorKind(error),
		});
		if (shouldAbort) {
			abortRemote(task);
		}
	};

	const waitForBuffer = (task: UploadTask, stream: WebSocket): Promise<void> =>
		new Promise((resolve, reject) => {
			let timer: number | undefined;

			const settle = (error?: Error): void => {
				window.clearTimeout(timer);
				task.controller.signal.removeEventListener('abort', abort);
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};

			const abort = (): void => settle(new TransferFailure('operation_unknown', true));

			const poll = (): void => {
				if (!current(task) || stream.readyState !== WebSocket.OPEN) {
					return abort();
				}
				if (stream.bufferedAmount <= BUFFER_LOW_WATER) {
					return settle();
				}
				timer = window.setTimeout(poll, 8);
			};

			task.controller.signal.addEventListener('abort', abort, { once: true });
			poll();
		});

	const failStream = (task: UploadTask, error: TransferFailure): void => {
		// Cancellation closes the binary stream before its control receipt can
		// arrive. The original cancel request still owns that settlement; only
		// its result or the control event can confirm cleanup or report unknown.
		if (task.phase !== 'cancelling') {
			fail(task, error);
		}
	};

	const streamUpload = async (task: UploadTask): Promise<void> => {
		if (!current(task) || task.stream || task.input.size === 0) {
			throw new TransferFailure('protocol_error', true);
		}
		available();
		const params = new URLSearchParams({
			workspaceId,
			uploadId: task.input.uploadId,
			size: String(task.input.size),
		});
		readWorkspaceUploadStream(params);
		const stream = new WebSocket(createWebSocketUrl(`/ws/uploads?${params}`));
		task.stream = stream;
		await new Promise<void>((resolve, reject) => {
			let opened = false;
			const timer = window.setTimeout(() => lost(), OPEN_TIMEOUT_MS);

			const lost = (): void => {
				const error = new TransferFailure('operation_unknown', true);
				reject(error);
				failStream(task, error);
			};

			const open = (): void => {
				window.clearTimeout(timer);
				opened = true;
				resolve();
			};

			const close = (event: CloseEvent): void => {
				window.clearTimeout(timer);
				if (!opened || event.code !== 1000 || task.bytesSent !== task.input.size) {
					lost();
				}
			};

			const message = (): void => lost();

			stream.addEventListener('open', open, { once: true });
			stream.addEventListener('error', lost);
			stream.addEventListener('close', close);
			stream.addEventListener('message', message);
			task.stopStream = () => {
				window.clearTimeout(timer);
				stream.removeEventListener('open', open);
				stream.removeEventListener('error', lost);
				stream.removeEventListener('close', close);
				stream.removeEventListener('message', message);
				reject(new TransferFailure('operation_unknown', true));
			};
		});
		for (let offset = 0; offset < task.input.size; offset += WORKSPACE_UPLOAD_MAX_CHUNK_BYTES) {
			if (!canStream(task)) {
				return;
			}
			if (stream.bufferedAmount >= BUFFER_HIGH_WATER) {
				await waitForBuffer(task, stream);
			}
			const chunk = await task.command.file
				.slice(offset, Math.min(task.input.size, offset + WORKSPACE_UPLOAD_MAX_CHUNK_BYTES))
				.arrayBuffer();
			if (!canStream(task)) {
				return;
			}
			available();
			if (stream.readyState !== WebSocket.OPEN) {
				throw new TransferFailure('operation_unknown', true);
			}
			stream.send(chunk);
			task.bytesSent += chunk.byteLength;
		}
		// Sending every byte is not success. Only the control-channel terminal
		// event confirms publication and its final metadata/cleanup checks.
	};

	const applyEvent = (task: UploadTask, event: WorkspaceUploadEvent): void => {
		if (!current(task)) {
			return;
		}
		if (!task.acknowledged) {
			if ((task.phase !== 'starting' && task.phase !== 'cancelling') || task.earlyEvent) {
				throw new TransferFailure('protocol_error', true);
			}
			task.earlyEvent = event;
			return;
		}
		if ('destinationPath' in event && event.destinationPath !== task.input.destinationPath) {
			throw new TransferFailure('protocol_error', true);
		}
		switch (event.type) {
			case 'ready':
				if (task.phase === 'cancelling') {
					return;
				}
				if (task.phase !== 'starting') {
					throw new TransferFailure('protocol_error', true);
				}
				task.phase = 'running';
				void streamUpload(task).catch((cause) => failStream(task, failure(cause, true)));
				return;
			case 'progress':
				if (
					(task.phase !== 'running' && task.phase !== 'cancelling') ||
					event.totalSize !== task.input.size ||
					event.chunkIndex !== task.nextChunk ||
					event.bytesWritten <= task.bytesWritten ||
					event.bytesWritten - task.bytesWritten > WORKSPACE_UPLOAD_MAX_CHUNK_BYTES ||
					event.bytesWritten > task.bytesSent
				) {
					throw new TransferFailure('protocol_error', true);
				}
				task.nextChunk++;
				task.bytesWritten = event.bytesWritten;
				if (task.phase === 'cancelling') {
					return;
				}
				emit({
					type: 'progress',
					id: task.command.id,
					progress: event.progress,
					bytesWritten: event.bytesWritten,
					totalBytes: event.totalSize,
					completedFiles: 0,
					totalFiles: 1,
				});
				return;
			case 'conflict':
				if (task.phase === 'cancelling') {
					finish(task, { type: 'cancelled', id: task.command.id });
					return;
				}
				if (task.phase !== 'starting' || task.input.conflictPolicy !== 'ask') {
					throw new TransferFailure('protocol_error', true);
				}
				task.phase = 'conflict';
				window.clearTimeout(task.timer);
				emit({ type: 'conflict', id: task.command.id, path: event.destinationPath });
				pump();
				return;
			case 'completed':
				if (
					task.phase === 'queued' ||
					task.phase === 'conflict' ||
					event.item.metadata.size !== task.input.size ||
					(task.input.size > 0 && task.bytesWritten !== task.input.size)
				) {
					throw new TransferFailure('protocol_error', true);
				}
				finish(task, { type: 'completed', id: task.command.id });
				return;
			case 'skipped':
				if (task.input.conflictPolicy !== 'skip') {
					throw new TransferFailure('protocol_error', true);
				}
				finish(task, { type: 'skipped', id: task.command.id });
				return;
			case 'cancelled':
				finish(task, { type: 'cancelled', id: task.command.id });
				return;
			case 'failed':
				fail(
					task,
					new TransferFailure(
						event.message === 'operation_unknown' ? 'operation_unknown' : 'remote_rejected',
						event.message === 'operation_unknown',
					),
				);
		}
	};

	const stop = socket.on('transfer.upload', (input) => {
		try {
			const event = readWorkspaceUploadEvent(input);
			const task = tasks.get(event.uploadId);
			if (task) {
				try {
					applyEvent(task, event);
				} catch (cause) {
					fail(task, new TransferFailure('protocol_error', true, { cause }));
				}
			}
		} catch (cause) {
			for (const task of [...tasks.values()]) {
				fail(
					task,
					new TransferFailure('protocol_error', task.phase !== 'queued' && task.phase !== 'conflict', {
						cause,
					}),
				);
			}
		}
	});

	const start = async (task: UploadTask): Promise<void> => {
		task.phase = 'starting';
		task.timer = window.setTimeout(
			() => fail(task, new TransferFailure('operation_unknown', true)),
			TASK_TIMEOUT_MS,
		);
		try {
			const result = await control(task.request, 'upload.start', task.input, task.controller.signal);
			if (!current(task)) {
				return;
			}
			readWorkspaceTaskStarted(result);
			task.acknowledged = true;
			const early = task.earlyEvent;
			task.earlyEvent = undefined;
			if (early) {
				applyEvent(task, early);
			}
		} catch (cause) {
			fail(task, failure(cause, true));
		}
	};

	function pump(): void {
		if (disposed || disconnected || !canUse() || !socket.connected) {
			return;
		}
		let active = [...tasks.values()].filter((task) => task.phase !== 'queued' && task.phase !== 'conflict').length;
		const streamLimit = activeStreamLimit();
		for (const task of tasks.values()) {
			if (active >= streamLimit) {
				break;
			}
			if (task.phase !== 'queued') {
				continue;
			}
			active++;
			void start(task);
		}
	}

	const disconnect = (): void => {
		disconnected = true;
		generation++;
		for (const controller of preparations.values()) {
			controller.abort();
		}
		preparations.clear();
		prepared.clear();
		for (const task of [...tasks.values()]) {
			const dispatched = task.phase !== 'queued' && task.phase !== 'conflict';
			fail(task, new TransferFailure(dispatched ? 'operation_unknown' : 'not_connected', dispatched));
		}
	};

	return {
		async prepare(command) {
			available();
			for (const [id, batch] of prepared) {
				if (batch.expiresAt <= Date.now()) {
					prepared.delete(id);
				}
			}
			if (command.destination.scopeId !== workspaceId) {
				throw new TransferFailure('invalid_input', false);
			}
			if (prepared.has(command.id) || preparations.has(command.id)) {
				throw new TransferFailure('invalid_input', false);
			}
			if (prepared.size + preparations.size >= MAX_PREPARED_BATCHES) {
				throw new TransferFailure('limit_exceeded', false);
			}
			let input: WorkspaceUploadPrepare;
			let paths: Set<string>;
			try {
				input = readWorkspaceUploadPrepare({
					prepareId: command.id,
					basePath: uploadRoot(command.destination.path),
					directories: command.directories.map((path) => path),
				});
				paths = new Set([
					input.basePath,
					...input.directories.map((relative) => pathWithin(input.basePath, relative)),
				]);
				for (const path of paths) {
					readWorkspaceUploadStart({ uploadId: command.id, destinationPath: path, size: 0 });
				}
			} catch (cause) {
				throw failure(cause, false);
			}
			const revision = generation;
			const controller = new AbortController();
			preparations.set(command.id, controller);
			try {
				const result = await control(socket.bindRequests(), 'upload.prepare', input, controller.signal);
				if (revision !== generation || disposed) {
					throw new TransferFailure('operation_unknown', true);
				}
				const response = readWorkspaceUploadPrepared(result);
				if (response.preparedDirectories !== paths.size) {
					throw new TransferFailure('protocol_error', true);
				}
				prepared.set(command.id, {
					root: input.basePath,
					directories: paths,
					expiresAt: Date.now() + 30 * 60 * 1000,
				});
			} catch (cause) {
				throw failure(cause, true);
			} finally {
				if (preparations.get(command.id) === controller) {
					preparations.delete(command.id);
				}
			}
		},

		async upload(command) {
			available();
			if (tasks.has(command.id)) {
				throw new TransferFailure('invalid_input', false);
			}
			if (tasks.size >= MAX_LOCAL_TASKS) {
				throw new TransferFailure('limit_exceeded', false);
			}
			let input: WorkspaceUploadStart;
			try {
				input = uploadInput(command, workspaceId);
			} catch (cause) {
				throw failure(cause, false);
			}
			if (input.prepareId) {
				const batch = prepared.get(input.prepareId);
				const parent = input.destinationPath.slice(0, input.destinationPath.lastIndexOf('/')) || '/';
				if (
					!batch ||
					batch.expiresAt <= Date.now() ||
					batch.root !== uploadRoot(command.destination.path) ||
					!batch.directories.has(parent)
				) {
					throw new TransferFailure('invalid_input', false);
				}
			}
			const snapshot: UploadCommand = {
				id: command.id,
				file: command.file,
				destination: { scopeId: command.destination.scopeId, path: command.destination.path },
				relativeDirectory: command.relativeDirectory,
				prepareId: command.prepareId,
				conflictStrategy: command.conflictStrategy,
			};
			tasks.set(command.id, {
				command: snapshot,
				input,
				request: socket.bindRequests(),
				phase: 'queued',
				acknowledged: false,
				controller: new AbortController(),
				bytesSent: 0,
				bytesWritten: 0,
				nextChunk: 0,
			});
			pump();
		},

		owns: (id) => tasks.has(id),

		async cancel(id) {
			const task = tasks.get(id);
			if (!task) {
				return false;
			}
			if (task.phase === 'queued' || task.phase === 'conflict') {
				finish(task, { type: 'cancelled', id });
				return true;
			}
			task.phase = 'cancelling';
			try {
				const response = readWorkspaceTaskStopped(
					await control(task.request, 'upload.cancel', { uploadId: id }),
				);
				if (!current(task)) {
					return true;
				}
				if (!response) {
					fail(task, new TransferFailure('operation_unknown', true));
				}
				return response;
			} catch (cause) {
				const error = failure(cause, true);
				fail(task, new TransferFailure('operation_unknown', true, { cause: error }));
				return false;
			}
		},

		async resolveConflict(id, strategy) {
			available();
			const task = tasks.get(id);
			if (!task || task.phase !== 'conflict') {
				throw new TransferFailure('invalid_input', false);
			}
			task.input = {
				uploadId: task.input.uploadId,
				destinationPath: task.input.destinationPath,
				size: task.input.size,
				conflictPolicy: strategy,
				...(task.input.prepareId === undefined
					? {}
					: { prepareId: task.input.prepareId, relativePath: task.input.relativePath }),
			};
			task.phase = 'queued';
			task.acknowledged = false;
			pump();
		},

		disconnect,

		connect() {
			if (!disposed) {
				disconnected = false;
			}
		},

		dispose() {
			if (disposed) {
				return;
			}
			disconnect();
			disposed = true;
			stop();
		},
	};
}
