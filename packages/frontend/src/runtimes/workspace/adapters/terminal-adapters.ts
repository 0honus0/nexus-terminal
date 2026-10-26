import { readWorkspaceSuspendHistory } from '@nexus-terminal/shared/remote/suspend/workspace-codec';
import {
	readWorkspaceSuspendHistoryResponse,
	readWorkspaceSuspendHistoryReset,
} from '@nexus-terminal/shared/remote/suspend/workspace-result-codec';
import { WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES } from '@nexus-terminal/shared/remote/suspend/values';
import { WorkspaceSuspendFailure } from '../model/workspace-suspend-types';
import { logger } from '@/client/logging/logger';
import {
	RESET_REMOTE_PTY_DISPLAY,
	type TerminalChannel,
	type TerminalOutput,
	type TerminalViewport,
} from '@/features/terminal/public';
import { TerminalDirectoryFailure, type TerminalDirectoryPort } from '@/features/filesystem/public';
import { WorkspaceSocket } from '../protocol/workspaceSocket';
import { WorkspaceDispatchFailure, WorkspaceRequestFailure } from '../model/workspace-error-types';
import {
	toTerminalInputRequest,
	toTerminalResizeRequest,
	toTerminalDirectoryQueue,
} from '../model/workspace-terminal-mapper';
import {
	readWorkspaceTerminalChangeDirectory,
	readWorkspaceTerminalChangeDirectoryResponse,
	readWorkspaceTerminalCurrentDirectory,
} from '@nexus-terminal/shared/remote/terminal/workspace-codec';
import { WORKSPACE_TERMINAL_MAX_INPUT_BYTES } from '@nexus-terminal/shared/remote/workspace/values';

interface WorkspaceTerminalGate {
	canSend(): boolean;
	rememberResize(viewport: TerminalViewport): void;
	onConnected(handler: () => void): () => void;
}

export const createTerminalChannel = (socket: WorkspaceSocket, gate?: WorkspaceTerminalGate): TerminalChannel => {
	const outputHandlers = new Set<(output: TerminalOutput) => void>();
	const inputErrorHandlers = new Set<(message: string) => void>();

	const notifyInputError = (): void => {
		for (const handler of inputErrorHandlers) handler('TERMINAL_INPUT_REJECTED');
	};

	socket.on('protocol.error', ({ operation }) => {
		if (operation === 'terminal.input') {
			logger.warn({ failureKind: 'terminal_input_server_rejected' }, 'Terminal input rejected by server');
			notifyInputError();
		}
	});
	const buffered: TerminalOutput[] = [];
	let previousOutputAvailable = false;
	let resumeCompletePending = false;
	const resumeCompleteHandlers = new Set<() => void>();
	let historyLoad: Promise<{ data: Uint8Array; hasMore: boolean } | null> | null = null;
	let historyReset: Promise<boolean> | null = null;
	let remoteOutputGeneration = 0;

	const invalidateHistory = (): void => {
		remoteOutputGeneration += 1;
		previousOutputAvailable = false;
		resumeCompletePending = false;
		historyLoad = null;
		historyReset = null;
	};

	const discardRemoteOutput = (): void => {
		invalidateHistory();
		for (const output of buffered.splice(0)) output.consumed?.();
	};

	// A detached socket invalidates history requests, but received terminal bytes
	// still belong to the ordinary reconnect cursor and must survive pre-mount.
	socket.onClose(invalidateHistory);
	socket.on('terminal.closed', discardRemoteOutput);
	socket.on('terminal.error', discardRemoteOutput);

	socket.on('suspend.viewport', ({ columns, rows, stage }) => {
		const output: TerminalOutput = {
			data: stage === 'baseline' ? RESET_REMOTE_PTY_DISPLAY : '',
			viewport: { columns, rows },
		};
		if (outputHandlers.size) {
			for (const handler of outputHandlers) handler(output);
		} else buffered.push(output);
	});

	socket.onBinary((data, consumed) => {
		if (outputHandlers.size) {
			for (const handler of outputHandlers) handler({ data, consumed });
			return;
		}
		const copy = data.slice();
		buffered.push({ data: copy, consumed });
		// The negotiated consumer window bounds pre-mount buffering. Never drop bytes:
		// reconnect offsets already include received frames.
	});

	return {
		sendInput: (data) => {
			const inputBytes = new TextEncoder().encode(data).byteLength;
			if ((gate && !gate.canSend()) || inputBytes > WORKSPACE_TERMINAL_MAX_INPUT_BYTES) {
				logger.warn(
					{
						inputBytes,
						transportConnected: socket.connected,
						failureKind:
							inputBytes > WORKSPACE_TERMINAL_MAX_INPUT_BYTES
								? 'terminal_input_too_large'
								: 'terminal_input_workspace_not_ready',
					},
					'Terminal input rejected before transport send',
				);
				notifyInputError();
				return;
			}
			try {
				if (!socket.sendConnected('terminal.input', toTerminalInputRequest(data))) notifyInputError();
			} catch {
				notifyInputError();
			}
		},

		resize: (viewport: TerminalViewport) => {
			const request = toTerminalResizeRequest(viewport);
			gate?.rememberResize({ columns: request.columns, rows: request.rows });
			if (gate && !gate.canSend()) return;
			socket.sendConnected('terminal.resize', request);
		},

		onOutput(handler) {
			outputHandlers.add(handler);
			for (const output of buffered.splice(0)) handler(output);
			return () => outputHandlers.delete(handler);
		},

		onConnected: (handler) => gate?.onConnected(handler) ?? (() => undefined),

		onResumeComplete(handler) {
			resumeCompleteHandlers.add(handler);
			if (resumeCompletePending) {
				resumeCompletePending = false;
				handler();
			}
			return () => resumeCompleteHandlers.delete(handler);
		},

		completeResume() {
			if (!resumeCompleteHandlers.size) {
				resumeCompletePending = true;
				return;
			}
			for (const handler of resumeCompleteHandlers) handler();
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
			inputErrorHandlers.add(handler);
			const stopTransport = socket.onError(handler);
			const stopTerminal = socket.on('terminal.error', (payload) => handler(payload.message));
			return () => {
				inputErrorHandlers.delete(handler);
				stopTransport();
				stopTerminal();
			};
		},

		setPreviousOutputAvailable(available) {
			previousOutputAvailable = available;
		},

		hasPreviousOutput() {
			return previousOutputAvailable;
		},

		async loadPreviousOutput(maxBytes) {
			if (historyReset || !previousOutputAvailable || !socket.connected || (gate && !gate.canSend())) return null;
			if (historyLoad) return historyLoad;
			const request = readWorkspaceSuspendHistory({ maxBytes });
			const generation = remoteOutputGeneration;
			const task = socket
				.requestBinaryConnected('suspend.history.previous', request)
				.then(({ data, bytes }) => {
					if (generation !== remoteOutputGeneration || !socket.connected || (gate && !gate.canSend()))
						return null;
					const page = readWorkspaceSuspendHistoryResponse(data);
					if (
						bytes.byteLength > (request.maxBytes ?? WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES) ||
						(!bytes.byteLength && page.hasMore)
					) {
						throw new WorkspaceSuspendFailure('protocol_failure', 'unknown');
					}
					previousOutputAvailable = page.hasMore;
					return { data: bytes, hasMore: page.hasMore };
				})
				.catch((cause) => {
					// The server cursor may have advanced even when delivery failed. Require reset.
					if (generation === remoteOutputGeneration) previousOutputAvailable = false;
					throw cause;
				})
				.finally(() => {
					if (historyLoad === task) historyLoad = null;
				});
			historyLoad = task;
			return task;
		},

		resetPreviousOutput() {
			if (historyReset) return historyReset;
			const generation = remoteOutputGeneration;
			const request = socket.bindRequests();
			const task = (async () => {
				if (historyLoad) await historyLoad;
				if (generation !== remoteOutputGeneration || !socket.connected || (gate && !gate.canSend()))
					return false;
				const result = readWorkspaceSuspendHistoryReset(await request('suspend.history.reset', {}));
				if (generation !== remoteOutputGeneration || !socket.connected || (gate && !gate.canSend()))
					return false;
				previousOutputAvailable = result.available;
				return result.available;
			})().finally(() => {
				if (historyReset === task) historyReset = null;
			});
			historyReset = task;
			return task;
		},
	};
};

const DIRECTORY_CHANGE_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000 + 5_000;

export const createTerminalDirectoryPort = (
	socket: WorkspaceSocket,
	workspaceId?: string,
	connectionId?: number,
): TerminalDirectoryPort => ({
	async readCurrentDirectory() {
		try {
			const result = await socket.requestConnected('terminal.currentDirectory', {});
			return readWorkspaceTerminalCurrentDirectory(result);
		} catch (cause) {
			const code =
				cause instanceof WorkspaceRequestFailure || cause instanceof WorkspaceDispatchFailure
					? cause.code
					: 'operation_unknown';
			throw new TerminalDirectoryFailure(code, { cause });
		}
	},

	changeDirectory(path, options) {
		const requestId = crypto.randomUUID();
		return new Promise<{ path: string }>((resolve, reject) => {
			const payload = readWorkspaceTerminalChangeDirectory({ path });
			if (!socket.connected) {
				reject(new TerminalDirectoryFailure('not_connected'));
				return;
			}
			const request = socket.bindRequests();
			let settled = false;
			let acknowledged = false;
			let completedPath: string | undefined;

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
				completedPath = result.path;
				if (!acknowledged) return;
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

			stopQueued = socket.on('terminal.directoryChangeQueued', (event) => {
				if (event.requestId !== requestId) return;
				if (event.path !== payload.path) {
					fail(new TerminalDirectoryFailure('protocol_error'));
					return;
				}
				options?.onQueued?.(toTerminalDirectoryQueue(event));
			});
			stopChanged = socket.on('terminal.directoryChanged', (event) => {
				if (event.requestId === requestId) succeed({ path: event.path });
			});
			stopFailed = socket.on('terminal.directoryChangeFailed', (event) => {
				if (event.requestId !== requestId) return;
				logger.debug(
					{
						workspaceId,
						connectionId,
						requestId,
						reason: event.message,
						failureKind: 'terminal_directory_change_failed',
					},
					'Workspace terminal directory change failed',
				);
				fail(new TerminalDirectoryFailure(event.message));
			});
			stopClose = socket.onClose(() => fail(new TerminalDirectoryFailure('operation_unknown')));
			timer = window.setTimeout(
				() => fail(new TerminalDirectoryFailure('operation_unknown')),
				DIRECTORY_CHANGE_COMPLETION_TIMEOUT_MS,
			);
			void request('terminal.changeDirectory', payload, requestId).then(
				(value) => {
					if (settled) return;
					try {
						readWorkspaceTerminalChangeDirectoryResponse(value);
					} catch {
						fail(new TerminalDirectoryFailure('protocol_error'));
						return;
					}
					acknowledged = true;
					if (completedPath !== undefined) succeed({ path: completedPath });
				},
				(cause) =>
					fail(
						new TerminalDirectoryFailure(
							cause instanceof WorkspaceRequestFailure ? cause.code : 'operation_unknown',
							{ cause },
						),
					),
			);
		});
	},
});
