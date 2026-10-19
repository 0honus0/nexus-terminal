import { readWorkspaceSuspendHistory } from '@nexus-terminal/shared/remote/suspend/workspace-codec';
import type {
	WorkspaceSuspendRequests,
	WorkspaceSuspendResponses,
	WorkspaceSuspendEvents,
} from '@nexus-terminal/shared/remote/suspend/workspace';
import {
	readWorkspaceSuspendAutoTerminated,
	readWorkspaceSuspendRevoked,
} from '@nexus-terminal/shared/remote/suspend/workspace-result-codec';
import type {
	WorkspaceUploadRequests,
	WorkspaceUploadResponses,
	WorkspaceUploadEvents,
	WorkspaceTransferRequests,
	WorkspaceTransferResponses,
	WorkspaceTransferEvents,
} from '@nexus-terminal/shared/remote/transfers/workspace';
import type {
	WorkspaceFilesRequestMap,
	WorkspaceFilesResponseMap,
	WorkspaceFilesEventMap,
} from '@nexus-terminal/shared/remote/files/workspace';
import { readWorkspaceFileReady, readWorkspaceFileError } from '@nexus-terminal/shared/remote/files/workspace-codec';
import type {
	WorkspaceProtocolResponse,
	WorkspaceProtocolEvent,
	WorkspaceCoreRequests,
	WorkspaceCoreResponses,
	WorkspaceCoreEvents,
} from '@nexus-terminal/shared/remote/workspace/workspace';
import {
	readWorkspaceMessage,
	readWorkspaceProtocolError,
	readWorkspaceEmptyResponse,
} from '@nexus-terminal/shared/remote/workspace/workspace-codec';
import { WorkspaceRequestFailure, WorkspaceDispatchFailure } from '../model/workspace-error-types';
import type {
	WorkspaceMonitoringRequests,
	WorkspaceMonitoringResponses,
	WorkspaceMonitoringEvents,
} from '@nexus-terminal/shared/remote/monitoring/workspace';
import type { WorkspaceDockerRequests, WorkspaceDockerResponses } from '@nexus-terminal/shared/remote/docker/workspace';
import { readRemoteStatusSample } from '@nexus-terminal/shared/remote/monitoring/http-codec';
import { readWorkspaceStatusError } from '@nexus-terminal/shared/remote/monitoring/workspace-codec';
import type {
	WorkspaceTerminalEvents,
	WorkspaceTerminalRequests,
	WorkspaceTerminalResponses,
} from '@nexus-terminal/shared/remote/terminal/workspace';
import {
	readWorkspaceTerminalClosed,
	readWorkspaceTerminalError,
	readWorkspaceTerminalDirectoryQueued,
	readWorkspaceTerminalDirectoryChanged,
	readWorkspaceTerminalDirectoryFailed,
	readWorkspaceTerminalFlow,
} from '@nexus-terminal/shared/remote/terminal/workspace-codec';
import { logger } from '@/client/logging/logger';
import { openWebSocket } from '@/client/websocket';
import { decodeWorkspaceBinaryFrame } from '@nexus-terminal/shared/remote/workspace/workspace-binary';
import { readWorkspaceFileReadBinaryRequest } from '@nexus-terminal/shared/remote/files/workspace-codec';
import { WORKSPACE_FILES_MAX_BINARY_READ_BYTES } from '@nexus-terminal/shared/remote/files/values';
import {
	WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES,
	WORKSPACE_SUSPEND_MAX_JSON_BYTES,
} from '@nexus-terminal/shared/remote/suspend/values';

type ProtocolResponse = WorkspaceProtocolResponse;
type ProtocolEvent = WorkspaceProtocolEvent;
type ProtocolMessage = ProtocolResponse | ProtocolEvent;

type WorkspaceRequests = WorkspaceMonitoringRequests &
	WorkspaceDockerRequests &
	WorkspaceTerminalRequests &
	WorkspaceFilesRequestMap &
	WorkspaceTransferRequests &
	WorkspaceUploadRequests &
	WorkspaceCoreRequests &
	WorkspaceSuspendRequests;
type WorkspaceResponses = WorkspaceMonitoringResponses &
	WorkspaceDockerResponses &
	WorkspaceTerminalResponses &
	WorkspaceFilesResponseMap &
	WorkspaceTransferResponses &
	WorkspaceUploadResponses &
	WorkspaceCoreResponses &
	WorkspaceSuspendResponses;
type WorkspaceEvents = WorkspaceMonitoringEvents &
	WorkspaceTerminalEvents &
	WorkspaceFilesEventMap &
	WorkspaceTransferEvents &
	WorkspaceUploadEvents &
	WorkspaceCoreEvents &
	WorkspaceSuspendEvents;

type EventHandler<T = unknown> = (payload: T) => void;
type BinaryHandler = (data: Uint8Array, consumed?: () => void) => void;

export type WorkspaceAttachmentRequest = (
	type: string,
	payload?: object,
	requestId?: string,
	signal?: AbortSignal,
) => Promise<unknown>;

function readKnownEvent(type: string, payload: unknown): unknown {
	switch (type) {
		case 'status.sample':
			return readRemoteStatusSample(payload);
		case 'status.error':
			return readWorkspaceStatusError(payload);
		case 'suspend.autoTerminated':
			return readWorkspaceSuspendAutoTerminated(payload);
		case 'suspend.revoked':
			return readWorkspaceSuspendRevoked(payload);
		case 'filesystem.ready':
			return readWorkspaceFileReady(payload);
		case 'filesystem.error':
			return readWorkspaceFileError(payload);
		case 'protocol.error':
			return readWorkspaceProtocolError(payload);
		case 'terminal.closed':
			return readWorkspaceTerminalClosed(payload);
		case 'terminal.error':
			return readWorkspaceTerminalError(payload);
		case 'terminal.directoryChangeQueued':
			return readWorkspaceTerminalDirectoryQueued(payload);
		case 'terminal.directoryChanged':
			return readWorkspaceTerminalDirectoryChanged(payload);
		case 'terminal.directoryChangeFailed':
			return readWorkspaceTerminalDirectoryFailed(payload);
		default:
			return payload;
	}
}

const MAX_SEND_BUFFER_BYTES = 1024 * 1024;
const messageEncoder = new TextEncoder();

interface PendingRequest {
	maxBytes?: number;
	operation: string;
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: number;
	expectBinary: boolean;
	responseReceived: boolean;
	responseValue?: unknown;
	binaryDone: boolean;
	binaryChunks: Uint8Array[];
	binaryBytes: number;
}

interface WorkspaceSocketLogContext {
	workspaceId?: string;
	connectionId?: number;
}

const OPEN_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const HIGH_FREQUENCY_OPERATIONS = new Set([
	'terminal.input',
	'terminal.resize',
	'terminal.flow',
	'docker.stats',
	'suspend.owner.renew',
]);
const HIGH_FREQUENCY_EVENTS = new Set(['status.sample', 'transfer.upload', 'transfer.copyMove', 'transfer.archive']);

export class WorkspaceSocket {
	private socket?: WebSocket;
	private consumedTerminalBytes = 0;
	private consumptionTimer?: number;

	private scheduleConsumptionAck(): void {
		if (this.consumptionTimer !== undefined) {
			return;
		}
		const socket = this.socket;
		this.consumptionTimer = window.setTimeout(() => {
			this.consumptionTimer = undefined;
			if (this.socket !== socket || !this.connected) {
				return;
			}
			if (!this.sendConnected('terminal.flow', { consumedBytes: this.consumedTerminalBytes })) {
				this.scheduleConsumptionAck();
			}
		}, 20);
	}

	private readonly pending = new Map<string, PendingRequest>();
	private readonly handlers = new Map<string, Set<EventHandler>>();
	private readonly binaryHandlers = new Set<BinaryHandler>();
	private readonly closeHandlers = new Set<(reason?: string) => void>();
	private readonly errorHandlers = new Set<(message: string) => void>();
	private opening?: Promise<void>;
	private rejectOpening?: (error: Error) => void;
	private probe?: Promise<void>;

	constructor(private readonly logContext: WorkspaceSocketLogContext = {}) {}

	private context(fields: Record<string, unknown> = {}): Record<string, unknown> {
		return { ...this.logContext, ...fields };
	}

	get connected(): boolean {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	/** Probe only the current attachment; never open a new, unbound socket. */
	checkLiveness(): Promise<void> {
		if (this.probe) {
			return this.probe;
		}
		const socket = this.socket;
		if (!socket || !this.connected) {
			return Promise.resolve();
		}
		const task = this.requestInternal('workspace.ping', crypto.randomUUID(), {}, false, 5_000, socket)
			.then(readWorkspaceEmptyResponse)
			.then(() => undefined)
			.catch(() => {
				if (this.socket !== socket || document.visibilityState !== 'visible') {
					return;
				}
				this.socket = undefined;
				this.rejectPending(new Error('Workspace transport liveness check failed.'));
				// An abnormal transport close preserves ordinary-session reconnect credentials/PTY.
				try {
					socket.close(4000, 'Workspace transport liveness check failed');
				} catch {
					// A frozen browser may already have discarded the underlying transport.
				} finally {
					for (const handler of this.closeHandlers) {
						handler();
					}
				}
			})
			.finally(() => {
				if (this.probe === task) {
					this.probe = undefined;
				}
			});
		this.probe = task;
		return task;
	}

	async open(): Promise<void> {
		if (this.connected) {
			return;
		}
		if (this.opening) {
			return this.opening;
		}

		logger.debug(this.context({ pendingRequests: this.pending.size }), 'Workspace WebSocket opening');
		const socket = openWebSocket('/ws/workspace');
		socket.binaryType = 'arraybuffer';
		this.socket = socket;

		let rejectOpening!: (error: Error) => void;
		const opening = new Promise<void>((resolve, reject) => {
			let settled = false;
			let openTimer: number | undefined;

			const clearOpenTimer = () => {
				if (openTimer === undefined) {
					return;
				}
				window.clearTimeout(openTimer);
				openTimer = undefined;
			};

			const settleResolve = () => {
				if (settled) {
					return;
				}
				settled = true;
				clearOpenTimer();
				resolve();
			};

			const settleReject = (error: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearOpenTimer();
				reject(error);
			};

			rejectOpening = settleReject;
			this.rejectOpening = rejectOpening;

			openTimer = window.setTimeout(() => {
				const error = new Error('Workspace WebSocket connection timed out.');
				logger.warn(
					this.context({ pendingRequests: this.pending.size, failureKind: 'transport_open_timeout' }),
					'Workspace WebSocket open timed out',
				);
				settleReject(error);
				if (this.socket !== socket) {
					return;
				}

				// Release the transport slot immediately so reconnect can create a fresh socket even if
				// the browser delays the close event for the timed-out CONNECTING socket.
				this.socket = undefined;
				this.rejectPending(error);
				for (const handler of this.errorHandlers) {
					handler(error.message);
				}
				for (const handler of this.closeHandlers) {
					handler(error.message);
				}
				try {
					socket.close(1000, 'Workspace WebSocket open timed out');
				} catch {
					// The browser may already have discarded the failed transport.
				}
			}, OPEN_TIMEOUT_MS);

			socket.onopen = () => {
				if (this.socket !== socket) {
					logger.debug(
						this.context({ pendingRequests: this.pending.size }),
						'Workspace WebSocket open ignored because transport was superseded',
					);
					settleReject(new Error('Workspace WebSocket connection was superseded.'));
					return;
				}
				logger.debug(this.context({ pendingRequests: this.pending.size }), 'Workspace WebSocket opened');
				this.consumedTerminalBytes = 0;
				window.clearTimeout(this.consumptionTimer);
				this.consumptionTimer = undefined;
				this.sendConnected('terminal.flow', { consumedBytes: 0 });
				settleResolve();
			};
			socket.onmessage = (event) => {
				if (this.socket === socket) {
					this.handleMessage(event.data);
				}
			};
			socket.onerror = () => {
				const error = new Error('Workspace WebSocket connection failed.');
				logger.debug(
					this.context({
						pendingRequests: this.pending.size,
						readyState: socket.readyState,
						failureKind: 'transport_error',
					}),
					'Workspace WebSocket error event',
				);
				settleReject(error);
				if (this.socket !== socket) {
					return;
				}
				for (const handler of this.errorHandlers) {
					handler(error.message);
				}
			};
			socket.onclose = (event) => {
				const error = new Error(
					`Workspace WebSocket closed (${event.code}${event.reason ? `: ${event.reason}` : ''}).`,
				);
				// A close-before-open must settle open(); otherwise callers can remain in "connecting"
				// forever because the request timeout starts only after the socket has opened.
				const closeContext = this.context({
					closeCode: event.code,
					reason: event.reason || undefined,
					wasClean: event.wasClean,
					pendingRequests: this.pending.size,
					failureKind: event.code === 1000 ? undefined : 'transport_closed',
				});
				logger.debug(closeContext, 'Workspace WebSocket close event');
				if (event.code !== 1000) {
					logger.warn(closeContext, 'Workspace WebSocket closed unexpectedly');
				}
				settleReject(error);
				if (this.socket !== socket) {
					logger.debug(closeContext, 'Workspace WebSocket stale close ignored');
					return;
				}

				// Ignore late close/error events from an older socket after a reconnect has already
				// installed a replacement. They must never clear the replacement or reject its requests.
				this.socket = undefined;
				this.rejectPending(error);
				for (const handler of this.closeHandlers) {
					handler(event.reason || undefined);
				}
			};
		});

		let tracked!: Promise<void>;
		tracked = opening.finally(() => {
			if (this.opening === tracked) {
				this.opening = undefined;
			}
			if (this.rejectOpening === rejectOpening) {
				this.rejectOpening = undefined;
			}
		});
		this.opening = tracked;
		return tracked;
	}

	close(reason = 'Workspace closed'): void {
		window.clearTimeout(this.consumptionTimer);
		this.consumptionTimer = undefined;
		const error = new Error(reason);
		const socket = this.socket;
		logger.debug(
			this.context({
				reason,
				readyState: socket?.readyState,
				pendingRequests: this.pending.size,
				opening: Boolean(this.opening),
			}),
			'Workspace WebSocket close requested',
		);
		this.socket = undefined;
		this.rejectOpening?.(error);
		this.rejectPending(error);
		if (!socket) {
			return;
		}
		if (socket.readyState < WebSocket.CLOSING) {
			try {
				socket.close(1000, reason);
			} catch {
				// Best effort: the transport has already been detached from this WorkspaceSocket.
			}
		}
		// Local detach suppresses the native stale-close callback. Event-based
		// operations still need to release their listeners and completion waits.
		for (const handler of this.closeHandlers) {
			handler(reason);
		}
	}

	request<K extends keyof WorkspaceRequests>(type: K, payload: WorkspaceRequests[K]): Promise<WorkspaceResponses[K]>;

	request<T = unknown>(type: string, payload?: object): Promise<T>;

	request<T = unknown>(type: string, payload: object = {}): Promise<T> {
		return this.requestWithId<T>(type, crypto.randomUUID(), payload);
	}

	/** Correlated request on this exact attachment; never creates a replacement transport. */
	requestConnected(type: string, payload: object = {}, signal?: AbortSignal): Promise<unknown> {
		return this.bindRequests()(type, payload, undefined, signal);
	}

	/** Capture once for multi-step operations whose confirmation must use the original socket. */
	bindRequests(): WorkspaceAttachmentRequest {
		const socket = this.socket;
		return (type, payload = {}, requestId = crypto.randomUUID(), signal) => {
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				return Promise.reject(new WorkspaceDispatchFailure('not_connected'));
			}
			return this.requestInternal<unknown>(type, requestId, payload, false, REQUEST_TIMEOUT_MS, socket, signal);
		};
	}

	requestWithId<K extends keyof WorkspaceRequests>(
		type: K,
		requestId: string,
		payload: WorkspaceRequests[K],
	): Promise<WorkspaceResponses[K]>;

	requestWithId<T = unknown>(type: string, requestId: string, payload?: object): Promise<T>;

	async requestWithId<T = unknown>(type: string, requestId: string, payload: object = {}): Promise<T> {
		return this.requestInternal<T>(type, requestId, payload, false) as Promise<T>;
	}

	requestBinary<K extends keyof WorkspaceRequests>(
		type: K,
		payload: WorkspaceRequests[K],
		signal?: AbortSignal,
	): Promise<{ data: WorkspaceResponses[K]; bytes: Uint8Array }>;

	requestBinary<T = unknown>(
		type: string,
		payload: object = {},
		signal?: AbortSignal,
	): Promise<{ data: T; bytes: Uint8Array }> {
		const requestId = crypto.randomUUID();
		const operation = this.requestInternal<T>(
			type,
			requestId,
			payload,
			true,
			REQUEST_TIMEOUT_MS,
			undefined,
			signal,
		);
		return operation as Promise<{
			data: T;
			bytes: Uint8Array;
		}>;
	}

	/** Binary reads are bound to the current attachment and never open another socket. */
	requestBinaryConnected(
		type: 'filesystem.readBinary' | 'suspend.history.previous',
		payload:
			WorkspaceFilesRequestMap['filesystem.readBinary'] | WorkspaceSuspendRequests['suspend.history.previous'],
		signal?: AbortSignal,
	): Promise<{ data: unknown; bytes: Uint8Array }> {
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('Workspace transport is not connected.'));
		}
		return this.requestInternal<unknown>(
			type,
			crypto.randomUUID(),
			payload,
			true,
			REQUEST_TIMEOUT_MS,
			socket,
			signal,
		) as Promise<{ data: unknown; bytes: Uint8Array }>;
	}

	private async requestInternal<T>(
		type: string,
		requestId: string,
		payload: object,
		expectBinary: boolean,
		timeoutMs = REQUEST_TIMEOUT_MS,
		expectedSocket?: WebSocket,
		signal?: AbortSignal,
	): Promise<T | { data: T; bytes: Uint8Array }> {
		if (!requestId) {
			throw new Error('Workspace requestId is required.');
		}
		if (this.pending.has(requestId)) {
			throw new Error(`Workspace request is already pending: ${requestId}`);
		}
		const binaryRead = type === 'filesystem.readBinary' ? readWorkspaceFileReadBinaryRequest(payload) : undefined;
		const historyRead = type === 'suspend.history.previous' ? readWorkspaceSuspendHistory(payload) : undefined;
		if (expectedSocket) {
			if (this.socket !== expectedSocket || expectedSocket.readyState !== WebSocket.OPEN) {
				throw new WorkspaceDispatchFailure('not_connected');
			}
		} else {
			await this.open();
		}
		if (signal?.aborted) {
			throw new DOMException('Binary read aborted', 'AbortError');
		}
		// Opening can be shared by concurrent callers with the same request ID.
		if (this.pending.has(requestId)) {
			throw new Error('Workspace request is already pending.');
		}
		if (expectedSocket && this.socket !== expectedSocket) {
			throw new Error('Workspace probe transport was superseded.');
		}
		return new Promise<T | { data: T; bytes: Uint8Array }>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				const pending = this.pending.get(requestId);
				this.pending.delete(requestId);
				pending?.binaryChunks.splice(0);
				if (type === 'filesystem.readBinary') {
					this.sendConnected('filesystem.cancelRead', { requestId });
				}
				logger.warn(
					this.context({
						operation: type,
						requestId,
						pendingRequests: this.pending.size,
						failureKind: 'request_timeout',
					}),
					'Workspace request timed out',
				);
				(pending?.reject ?? reject)(new Error(`Workspace request timed out: ${type}`));
			}, timeoutMs);
			this.pending.set(requestId, {
				operation: type,

				resolve: (value) => resolve(value as T | { data: T; bytes: Uint8Array }),

				reject,
				timer,
				expectBinary,
				responseReceived: false,
				binaryDone: false,
				binaryChunks: [],
				binaryBytes: 0,
				maxBytes: binaryRead?.maxBytes ?? historyRead?.maxBytes,
			});

			const abort = () => {
				const pending = this.pending.get(requestId);
				if (!pending) {
					return;
				}
				this.pending.delete(requestId);
				window.clearTimeout(pending.timer);
				pending.binaryChunks.length = 0;
				if (type === 'filesystem.readBinary') {
					this.sendConnected('filesystem.cancelRead', { requestId });
				}
				pending.reject(new DOMException('Binary read aborted', 'AbortError'));
			};

			signal?.addEventListener('abort', abort, { once: true });
			const pending = this.pending.get(requestId)!;
			const resolveOriginal = pending.resolve;
			const rejectOriginal = pending.reject;
			pending.resolve = (value) => {
				signal?.removeEventListener('abort', abort);
				resolveOriginal(value);
			};
			pending.reject = (error) => {
				signal?.removeEventListener('abort', abort);
				rejectOriginal(error);
			};
			try {
				if (!HIGH_FREQUENCY_OPERATIONS.has(type)) {
					logger.trace(
						this.context({ operation: type, requestId, pendingRequests: this.pending.size }),
						'Workspace request queued',
					);
				}
				this.sendJson({ type, requestId, payload: binaryRead ?? payload });
			} catch (cause) {
				window.clearTimeout(timer);
				this.pending.delete(requestId);
				const error = cause instanceof Error ? cause : new Error(String(cause));
				logger.debug(
					this.context({
						err: error,
						operation: type,
						requestId,
						pendingRequests: this.pending.size,
						failureKind: 'request_dispatch_failed',
					}),
					'Workspace request dispatch failed',
				);
				pending.reject(error);
			}
		});
	}

	send<K extends keyof WorkspaceRequests>(type: K, payload: WorkspaceRequests[K]): Promise<void>;

	send(type: string, payload?: object): Promise<void>;

	async send(type: string, payload: object = {}): Promise<void> {
		await this.open();
		if (!HIGH_FREQUENCY_OPERATIONS.has(type)) {
			logger.trace(this.context({ operation: type }), 'Workspace message dispatch');
		}
		this.sendJson({ type, payload });
	}

	/** Send only through the currently open Workspace transport; never opens/reopens the socket. */
	sendConnected<K extends keyof WorkspaceRequests>(type: K, payload: WorkspaceRequests[K]): boolean;

	sendConnected(type: string, payload?: object): boolean;

	sendConnected(type: string, payload: object = {}): boolean {
		if (!this.connected) {
			return false;
		}
		try {
			this.sendJson({ type, payload: type === 'terminal.flow' ? readWorkspaceTerminalFlow(payload) : payload });
			return true;
		} catch (cause) {
			if (type === 'terminal.input') {
				logger.warn(
					this.context({
						err: cause,
						operation: type,
						socketBufferedBytes: this.socket?.bufferedAmount,
						failureKind: 'terminal_input_transport_send_failed',
					}),
					'Terminal input rejected by transport',
				);
			}
			return false;
		}
	}

	on<K extends keyof WorkspaceEvents>(type: K, handler: EventHandler<WorkspaceEvents[K]>): () => void;

	on<T = unknown>(type: string, handler: EventHandler<T>): () => void;

	on<T = unknown>(type: string, handler: EventHandler<T>): () => void {
		const listeners = this.handlers.get(type) ?? new Set<EventHandler>();
		listeners.add(handler as EventHandler);
		this.handlers.set(type, listeners);
		return () => {
			listeners.delete(handler as EventHandler);
			if (!listeners.size) {
				this.handlers.delete(type);
			}
		};
	}

	onBinary(handler: BinaryHandler): () => void {
		this.binaryHandlers.add(handler);
		return () => this.binaryHandlers.delete(handler);
	}

	onClose(handler: (reason?: string) => void): () => void {
		this.closeHandlers.add(handler);
		return () => this.closeHandlers.delete(handler);
	}

	onError(handler: (message: string) => void): () => void {
		this.errorHandlers.add(handler);
		return () => this.errorHandlers.delete(handler);
	}

	private sendJson(value: { type: string; requestId?: string; payload?: object }): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			throw new WorkspaceDispatchFailure('not_connected');
		}
		const message = JSON.stringify(value);
		const limit =
			value.type === 'suspend.mark' || value.type === 'suspend.prepare' || value.type === 'suspend.commit'
				? WORKSPACE_SUSPEND_MAX_JSON_BYTES
				: MAX_SEND_BUFFER_BYTES;
		if (this.socket.bufferedAmount + messageEncoder.encode(message).byteLength > limit) {
			throw new WorkspaceDispatchFailure('limit_exceeded');
		}
		this.socket.send(message);
	}

	private handleMessage(raw: unknown): void {
		if (raw instanceof ArrayBuffer) {
			this.handleBinaryMessage(new Uint8Array(raw));
			return;
		}
		// binaryType is arraybuffer: asynchronous Blob conversion could publish an old
		// attachment's bytes after a reconnect and reorder frames around its response.
		if (typeof raw !== 'string') {
			this.failProtocol('Workspace message type is invalid.');
			return;
		}
		let message: ProtocolMessage;
		try {
			message = readWorkspaceMessage(JSON.parse(raw));
		} catch {
			logger.warn(
				this.context({ failureKind: 'protocol_invalid_json' }),
				'Workspace protocol returned invalid JSON',
			);
			this.failProtocol('Workspace protocol returned invalid JSON.');
			return;
		}
		if (message.type === 'response' && 'requestId' in message) {
			const response = message;
			const pending = this.pending.get(response.requestId);
			if (!pending) {
				logger.debug(
					this.context({ requestId: response.requestId, failureKind: 'stale_response' }),
					'Workspace response has no pending request',
				);
				return;
			}
			if (pending.responseReceived) {
				this.failProtocol('Workspace response was received more than once.');
				return;
			}
			if (!HIGH_FREQUENCY_OPERATIONS.has(pending.operation)) {
				logger.trace(
					this.context({
						operation: pending.operation,
						requestId: response.requestId,
						ok: response.payload.ok,
						pendingRequests: this.pending.size,
					}),
					'Workspace response dispatched',
				);
			}
			if (!response.payload.ok) {
				this.pending.delete(response.requestId);
				window.clearTimeout(pending.timer);
				const reason = response.payload.error;
				logger.debug(
					this.context({
						operation: pending.operation,
						requestId: response.requestId,
						reason,
						failureKind: 'request_rejected',
					}),
					'Workspace request rejected',
				);
				pending.reject(new WorkspaceRequestFailure(pending.operation, reason));
				return;
			}
			if (!pending.expectBinary) {
				this.pending.delete(response.requestId);
				window.clearTimeout(pending.timer);
				pending.resolve(response.payload.data);
				return;
			}
			pending.responseReceived = true;
			pending.responseValue = response.payload.data;
			this.resolveBinaryPending(response.requestId, pending);
			return;
		}
		const handlers = this.handlers.get(message.type) ?? new Set<EventHandler>();
		if (!HIGH_FREQUENCY_EVENTS.has(message.type)) {
			logger.trace(
				this.context({ eventType: message.type, handlerCount: handlers.size }),
				'Workspace event dispatched',
			);
		}
		let payload: unknown;
		try {
			payload = readKnownEvent(message.type, message.payload);
		} catch {
			this.failProtocol('Workspace event is invalid.');
			return;
		}
		for (const handler of handlers) {
			handler(payload);
		}
	}

	private handleBinaryMessage(raw: Uint8Array): void {
		let frame;
		try {
			frame = decodeWorkspaceBinaryFrame(raw);
		} catch {
			this.failProtocol('Workspace binary protocol error');
			return;
		}
		if (frame.kind === 'terminal') {
			const socket = this.socket;
			let acknowledged = false;

			const consumed = () => {
				if (acknowledged || this.socket !== socket) {
					return;
				}
				acknowledged = true;
				this.consumedTerminalBytes += frame.data.byteLength;
				this.scheduleConsumptionAck();
			};

			for (const handler of this.binaryHandlers) {
				handler(frame.data, consumed);
			}
			return;
		}
		const pending = this.pending.get(frame.requestId);
		if (!pending || !pending.expectBinary) {
			return;
		}
		if (pending.binaryDone) {
			this.failProtocol('Workspace binary response continued after its final frame.');
			return;
		}
		if (frame.data.byteLength) {
			const maxBytes =
				pending.operation === 'suspend.history.previous'
					? Math.min(
							pending.maxBytes ?? WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES,
							WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES,
						)
					: Math.min(
							pending.maxBytes ?? WORKSPACE_FILES_MAX_BINARY_READ_BYTES,
							WORKSPACE_FILES_MAX_BINARY_READ_BYTES,
						);
			if (pending.binaryBytes + frame.data.byteLength > maxBytes) {
				this.pending.delete(frame.requestId);
				window.clearTimeout(pending.timer);
				pending.binaryChunks.length = 0;
				pending.reject(new Error('Workspace binary response limit exceeded.'));
				if (pending.operation === 'filesystem.readBinary') {
					this.sendConnected('filesystem.cancelRead', { requestId: frame.requestId });
				}
				return;
			}
			const copy = frame.data.slice();
			pending.binaryChunks.push(copy);
			pending.binaryBytes += copy.byteLength;
		}
		if (frame.final) {
			pending.binaryDone = true;
		}
		this.resolveBinaryPending(frame.requestId, pending);
	}

	private resolveBinaryPending(requestId: string, pending: PendingRequest): void {
		if (!pending.expectBinary || !pending.responseReceived || !pending.binaryDone) {
			return;
		}
		this.pending.delete(requestId);
		window.clearTimeout(pending.timer);
		const bytes = new Uint8Array(pending.binaryBytes);
		let offset = 0;
		for (const chunk of pending.binaryChunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		pending.resolve({ data: pending.responseValue, bytes });
	}

	private failProtocol(message: string): void {
		// Reject waits and detach before notifying subscribers; invalid wire data must
		// not leave requests alive or allow further frames to update this attachment.
		this.close(message);
		for (const handler of this.errorHandlers) {
			handler(message);
		}
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			window.clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}
