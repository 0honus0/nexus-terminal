import { ref, type Ref } from 'vue';
import { logger } from '@/client/logging/logger';
import { refreshConnection, confirmConnectionHostKey, type ConnectionSummary } from '@/features/connections/public';
import {
	createTerminalSessionState,
	type TerminalSessionState,
	type TerminalViewport,
} from '@/features/terminal/public';
import { createFileEditorSession, type FileEditorSessionController } from '@/features/file-editor/public';
import { createFilePreviewSession, type FilePreviewSessionController } from '@/features/file-preview/public';
import { createFilesystemSessionState, type FilesystemSessionState } from '@/features/filesystem/public';
import { createTransferController, type TransferController } from '@/features/transfers/public';
import { createStatusMonitorSession, type StatusMonitorSessionController } from '@/features/status-monitor/public';
import { createDockerSession, type DockerSessionController } from '@/features/docker/public';
import { createWorkspaceCapabilityAdapters, type WorkspaceCapabilityAdapters } from '../adapters/capabilityAdapters';
import type { WorkspaceLifecycleState } from '../model/workspace';
import { WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES } from '@nexus-terminal/shared/remote/suspend/values';
import {
	readWorkspaceSuspendResume,
	readWorkspaceSuspendAck,
} from '@nexus-terminal/shared/remote/suspend/workspace-codec';
import {
	readWorkspaceSuspendResumeResponse,
	readWorkspaceSuspendOwnerRenew,
} from '@nexus-terminal/shared/remote/suspend/workspace-result-codec';
import { toSuspendedWorkspace, toSuspendedLease } from '../model/workspace-suspend-mapper';
import {
	WorkspaceSuspendFailure,
	type WorkspaceSuspendedConnection,
	type WorkspaceSuspendResumeOptions,
} from '../model/workspace-suspend-types';
import { WorkspaceDispatchFailure, WorkspaceRequestFailure } from '../model/workspace-error-types';
import { toSuspendedAutoTermination, type SuspendedAutoTermination } from '@/features/ssh-suspend/public';
import { WorkspaceSocket, type WorkspaceAttachmentRequest } from '../protocol/workspaceSocket';
import {
	readWorkspaceConnectRequest,
	readWorkspaceConnectResponse,
	readWorkspaceResumeRequest,
	readWorkspaceResumeAck,
	readWorkspaceCloseRequest,
	readWorkspaceEmptyResponse,
} from '@nexus-terminal/shared/remote/workspace/workspace-codec';
import { toWorkspaceConnection } from '../model/workspace-connection-mapper';
import type {
	WorkspaceConnection,
	WorkspaceConnectionState,
	WorkspaceCloseOutcome,
} from '../model/workspace-connection-types';

export interface WorkspaceRuntimeSessionOptions {
	workspaceId?: string;
	onSuspendedAutoTerminated?: (event: SuspendedAutoTermination) => void;
}

const RECONNECT_MAX_DELAY_MS = 30_000;
const INITIAL_RECONNECT_ATTEMPT_LIMIT = 5;
const SUSPEND_OWNER_HEARTBEAT_MS = 15_000;

export class WorkspaceRuntimeSession {
	readonly id: string;
	readonly state: Ref<WorkspaceLifecycleState> = ref('idle');
	readonly statusMessage = ref('');
	readonly markedForSuspend = ref(false);
	readonly markedForSuspendAt = ref<string | null>(null);
	readonly hasConnected = ref(false);
	readonly recoveryRequired = ref(false);
	readonly resetRequested = ref(false);
	readonly commandDraft = ref('');
	readonly socket: WorkspaceSocket;
	readonly adapters: WorkspaceCapabilityAdapters;
	readonly transferController: TransferController;
	readonly terminalState: TerminalSessionState;
	readonly editorController: FileEditorSessionController;
	readonly previewController: FilePreviewSessionController;
	readonly filesystemState: FilesystemSessionState;
	readonly statusController: StatusMonitorSessionController;
	readonly dockerController: DockerSessionController;

	setCommandDraft(value: string): void {
		this.commandDraft.value = value;
	}

	setTerminalSearchOpen(value: boolean): void {
		this.terminalState.searchOpen.value = value;
	}

	setTerminalSearchTerm(value: string): void {
		this.terminalState.searchTerm.value = value;
	}

	private hostKeyConfirmation?: AbortController;
	private hostKeyRejected = false;
	private waitingForRetry = false;
	private connecting?: Promise<WorkspaceConnectionState>;
	private suspendedResume?: Promise<WorkspaceSuspendedConnection>;
	private suspendMutation?: Promise<unknown>;
	private suspendedResumeIntent?: { id: string; takeover: boolean };
	private suspendedSessionId?: string;
	private lastUnmarkedSuspendedSessionId?: string;
	private ownershipGeneration?: number;
	private leaseExpiresAt?: number;
	private leaseDeadline?: number;
	private heartbeatGeneration = 0;
	private heartbeatController?: AbortController;
	private receivingSuspendBaseline = false;
	private currentConnection?: WorkspaceConnectionState;
	private closeTask?: Promise<WorkspaceCloseOutcome>;
	private disposeTask?: Promise<WorkspaceCloseOutcome>;
	private lifecycleGeneration = 0;
	private attachmentReady = false;
	private attachmentRequest?: WorkspaceAttachmentRequest;
	private reconnectAttempt = 0;
	private reconnectTimer?: number;
	private reconnectInFlight = false;
	private immediateReconnectRequested = false;
	private resumeToken?: string;
	private attachmentGeneration?: number;
	private terminalOffset = 0;
	private suspendOwnerHeartbeat?: number;
	private disposed = false;
	private closing = false;
	private terminalEnded = false;
	private freshConnectionRequired = false;
	private lastViewport?: TerminalViewport;
	private readonly cleanup: Array<() => void> = [];

	constructor(
		readonly connection: ConnectionSummary,
		options: WorkspaceRuntimeSessionOptions = {},
	) {
		this.id = options.workspaceId ?? crypto.randomUUID();
		this.socket = new WorkspaceSocket({ workspaceId: this.id, connectionId: this.connection.id });
		this.adapters = createWorkspaceCapabilityAdapters(this.socket, this.id, this.connection.id);
		this.cleanup.push(
			this.socket.onBinary((data) => {
				this.terminalOffset += data.byteLength;
				if (this.receivingSuspendBaseline && this.terminalOffset > WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES) {
					this.socket.close('Suspended baseline exceeds budget');
				}
			}),
		);
		this.transferController = createTransferController(this.adapters.transfers);
		this.terminalState = createTerminalSessionState();
		this.editorController = createFileEditorSession(this.adapters.documents);
		this.previewController = createFilePreviewSession(this.adapters.preview);
		this.filesystemState = createFilesystemSessionState(this.adapters.filesystem);
		this.statusController = createStatusMonitorSession(this.adapters.status);
		this.dockerController = createDockerSession(this.adapters.docker);
		this.cleanup.push(
			this.socket.onClose((reason) => this.handleTransportClosed(reason)),
			this.socket.onError((message) => {
				if (this.disposed || this.closing || this.waitingForRetry) {
					return;
				}
				logger.debug(
					{
						workspaceId: this.id,
						connectionId: this.connection.id,
						state: this.state.value,
						reconnectAttempt: this.reconnectAttempt,
						reason: message,
					},
					'Workspace transport error event',
				);
				this.statusMessage.value = message;
			}),
			this.socket.on('terminal.error', ({ message }) => {
				this.terminalEnded = true;
				this.prepareFreshConnection();
				logger.debug(
					{
						workspaceId: this.id,
						connectionId: this.connection.id,
						state: this.state.value,
						reconnectAttempt: this.reconnectAttempt,
						reason: message,
					},
					'Workspace terminal error event',
				);
				logger.warn(
					{ workspaceId: this.id, connectionId: this.connection.id, reason: message },
					'Workspace terminal error',
				);
				this.markCapabilitiesDisconnected();
				this.state.value = 'error';
				this.statusMessage.value = message;
				this.scheduleReconnect();
			}),
			this.socket.on('terminal.closed', () => {
				if (this.closing) {
					return;
				}
				this.terminalEnded = true;
				this.prepareFreshConnection();
				logger.debug(
					{
						workspaceId: this.id,
						connectionId: this.connection.id,
						state: this.state.value,
						reconnectAttempt: this.reconnectAttempt,
					},
					'Workspace terminal closed event',
				);
				this.markCapabilitiesDisconnected();
				this.state.value = 'disconnected';
				this.scheduleReconnect();
			}),
			this.socket.on('protocol.error', ({ operation, message }) => {
				logger.debug(
					{
						workspaceId: this.id,
						connectionId: this.connection.id,
						state: this.state.value,
						operation,
						reason: message,
					},
					'Workspace protocol error event',
				);
				this.statusMessage.value = `${operation}: ${message}`;
			}),
			this.socket.on('suspend.autoTerminated', (event) =>
				options.onSuspendedAutoTerminated?.(toSuspendedAutoTermination(event)),
			),
			this.socket.on('suspend.unmarked', (event) => {
				if (this.disposed || this.closing) return;
				if (
					event.suspendedSessionId === this.suspendedSessionId &&
					this.ownershipGeneration !== undefined &&
					event.generation !== this.ownershipGeneration
				) {
					return;
				}
				this.lastUnmarkedSuspendedSessionId = event.suspendedSessionId;
				if (event.suspendedSessionId !== this.suspendedSessionId) return;
				this.clearSuspendedState();
			}),
			this.socket.on('suspend.revoked', (event) => {
				if (
					this.disposed ||
					this.closing ||
					event.suspendedSessionId !== this.suspendedSessionId ||
					(this.ownershipGeneration !== undefined && event.generation !== this.ownershipGeneration)
				) {
					return;
				}
				this.lifecycleGeneration += 1;
				this.recoveryRequired.value = true;
				this.clearSuspendOwnerHeartbeat();
				this.markCapabilitiesDisconnected();
				this.state.value = 'disconnected';
				this.statusMessage.value = event.reason;
				this.socket.close('Suspended ownership revoked');
			}),
		);
	}

	/** Stable suspension identity, independent of each resumed Workspace UUID. */
	get associatedSuspendedSessionId(): string | undefined {
		return this.suspendedSessionId;
	}

	connect(viewport?: TerminalViewport): Promise<WorkspaceConnectionState> {
		if (this.suspendedResume) {
			return Promise.reject(new WorkspaceSuspendFailure('conflict', 'not_dispatched'));
		}
		if (this.connecting) {
			return this.connecting;
		}
		if (this.disposed || this.closing || this.recoveryRequired.value) {
			return Promise.reject(new Error('Workspace cannot reconnect; close it and open a new workspace.'));
		}
		if (this.state.value === 'connected' && this.socket.connected && this.currentConnection) {
			return Promise.resolve(this.currentConnection);
		}
		const task = this.runConnect(viewport).finally(() => {
			if (this.connecting === task) {
				this.connecting = undefined;
			}
		});
		this.connecting = task;
		return task;
	}

	private async runConnect(viewport?: TerminalViewport): Promise<WorkspaceConnection> {
		if (this.disposed) {
			throw new Error('Workspace session has been disposed.');
		}
		const latestViewport = viewport ?? this.adapters.terminalViewport();
		if (latestViewport) {
			this.lastViewport = latestViewport;
		}
		this.clearReconnectTimer();
		this.hostKeyRejected = false;
		this.markCapabilitiesDisconnected();
		this.waitingForRetry = false;
		const reconnectAttempt = this.reconnectAttempt;
		const phase = this.hasConnected.value ? 'reconnect' : 'initial';
		const startedAt = performance.now();
		this.state.value = phase === 'reconnect' ? 'reconnecting' : 'connecting';
		this.statusMessage.value = '';
		logger.debug(
			{
				workspaceId: this.id,
				connectionId: this.connection.id,
				phase,
				reconnectAttempt,
				hasViewport: Boolean(this.lastViewport),
				viewport: this.lastViewport,
			},
			'Workspace connection attempt started',
		);
		try {
			const result =
				!this.resumeToken || this.freshConnectionRequired
					? await this.connectWithHostKeyConfirmation()
					: await this.resumeWorkspace();
			if (this.disposed || this.closing) {
				throw new DOMException('Workspace closed', 'AbortError');
			}
			await this.adapters.workspaceConnected();
			if (this.disposed || this.closing || !this.socket.connected) {
				throw new Error('Workspace connection closed during terminal activation.');
			}
			this.hasConnected.value = true;
			this.terminalEnded = false;
			this.freshConnectionRequired = false;
			this.reconnectAttempt = 0;
			this.state.value = 'connected';
			logger.debug(
				{
					workspaceId: this.id,
					connectionId: this.connection.id,
					phase,
					reconnectAttempt,
					elapsedMs: Math.round(performance.now() - startedAt),
					viewport: this.adapters.terminalViewport(),
				},
				'Workspace connection attempt succeeded',
			);
			void refreshConnection(this.connection.id).catch((cause) =>
				logger.debug({ err: cause, workspaceId: this.id }, 'Connection metadata refresh failed'),
			);
			void (
				phase === 'reconnect' ? this.filesystemState.browser.refresh() : this.filesystemState.ensureLoaded()
			).catch((error) =>
				logger.debug(
					{ err: error, workspaceId: this.id, connectionId: this.connection.id },
					'Workspace filesystem warmup failed',
				),
			);
			void this.statusController
				.workspaceConnected()
				.catch((error) =>
					logger.debug(
						{ err: error, workspaceId: this.id, connectionId: this.connection.id },
						'Workspace status warmup failed',
					),
				);
			this.dockerController.workspaceConnected();
			return result;
		} catch (cause) {
			const error = cause instanceof Error ? cause : new Error(String(cause));
			logger.warn(
				{
					err: error,
					workspaceId: this.id,
					connectionId: this.connection.id,
					phase,
					reconnectAttempt,
					elapsedMs: Math.round(performance.now() - startedAt),
				},
				'Workspace runtime connection failed',
			);
			this.markCapabilitiesDisconnected();
			this.waitingForRetry = true;
			this.immediateReconnectRequested = false;
			this.clearReconnectTimer();
			if (!this.closing) {
				this.socket.close('Workspace connection failed');
			}
			if (!this.disposed && !this.closing) {
				this.state.value = 'error';
				this.statusMessage.value = error.message;
			}
			throw error;
		}
	}

	private async connectWithHostKeyConfirmation(): Promise<WorkspaceConnection> {
		const confirmed = new Set<string>();
		while (true) {
			try {
				return await this.connectWorkspace();
			} catch (cause) {
				if (!(cause instanceof WorkspaceRequestFailure) || cause.code !== 'host_key_untrusted') {
					throw cause;
				}
				this.hostKeyRejected = true;
				if (!cause.hostKey) {
					throw cause;
				}
				const key = cause.hostKey;
				const identity = JSON.stringify([key.host, key.port]);
				// A route may contain several hops. Each gets one explicit confirmation;
				// a changing key or an additional verifier rejection never loops automatically.
				if (
					confirmed.has(identity) ||
					key.fingerprint === key.expectedFingerprint ||
					this.disposed ||
					this.closing
				) {
					throw cause;
				}
				const controller = new AbortController();
				this.hostKeyConfirmation = controller;
				try {
					const accepted = await confirmConnectionHostKey(key, controller.signal);
					if (!accepted || controller.signal.aborted || this.disposed || this.closing) {
						throw cause;
					}
				} finally {
					if (this.hostKeyConfirmation === controller) {
						this.hostKeyConfirmation = undefined;
					}
				}
				confirmed.add(identity);
				this.hostKeyRejected = false;
				this.statusMessage.value = '';
			}
		}
	}

	private async connectWorkspace(): Promise<WorkspaceConnection> {
		const generation = this.lifecycleGeneration;
		const request = readWorkspaceConnectRequest({
			workspaceId: this.id,
			connectionId: this.connection.id,
			viewport: this.lastViewport
				? { columns: this.lastViewport.columns, rows: this.lastViewport.rows }
				: undefined,
		});
		await this.socket.open();
		this.assertConnectionActive();
		const requestAttached = this.socket.bindRequests();
		this.terminalOffset = 0;
		// Once sent, absence of a valid receipt does not prove that creation failed.
		this.recoveryRequired.value = true;
		let response: unknown;
		try {
			response = await requestAttached('workspace.connect', request);
		} catch (cause) {
			// A typed server rejection is an authoritative negative receipt: the
			// server's Workspace owner has finished its failed-open cleanup before
			// returning any code other than operation_unknown. A local dispatch
			// rejection proves that nothing was sent. Neither can strand the
			// session behind the unknown-result fence during an SSH outage.
			// Lost transport, deadline expiry, protocol failure, and an explicit
			// operation_unknown must continue to retain that fence.
			if (
				cause instanceof WorkspaceDispatchFailure ||
				(cause instanceof WorkspaceRequestFailure && cause.code !== 'operation_unknown')
			) {
				this.recoveryRequired.value = false;
			}
			throw cause;
		}
		const wire = readWorkspaceConnectResponse(response);
		const result = toWorkspaceConnection(wire);
		this.validateConnectionIdentity(result);
		this.assertConnectionGeneration(generation);
		this.terminalOffset += result.terminalOffset - result.replayedBytes;
		this.commitAttachment(result, requestAttached);
		return result;
	}

	private async resumeWorkspace(): Promise<WorkspaceConnection> {
		const generation = this.lifecycleGeneration;
		if (!this.resumeToken || this.attachmentGeneration === undefined) {
			throw new Error('Workspace resume credentials are unavailable.');
		}
		const request = readWorkspaceResumeRequest({
			workspaceId: this.id,
			connectionId: this.connection.id,
			resumeToken: this.resumeToken,
			attachmentGeneration: this.attachmentGeneration,
			terminalOffset: this.terminalOffset,
			viewport: this.lastViewport
				? { columns: this.lastViewport.columns, rows: this.lastViewport.rows }
				: undefined,
		});
		await this.socket.open();
		this.assertConnectionActive();
		const requestAttached = this.socket.bindRequests();
		this.attachmentReady = false;
		const result = toWorkspaceConnection(
			readWorkspaceConnectResponse(await requestAttached('workspace.resume', request)),
		);
		this.validateConnectionIdentity(result);
		this.assertConnectionGeneration(generation);
		if (
			result.attachmentGeneration !== request.attachmentGeneration + 1 ||
			result.resumeToken === request.resumeToken ||
			result.terminalOffset !== request.terminalOffset + result.replayedBytes ||
			this.terminalOffset !== result.terminalOffset
		) {
			throw new Error('Workspace replay does not match the requested attachment.');
		}
		this.assertConnectionActive();
		// Flow confirms rendered bytes. Only this separate ACK commits ownership.
		this.recoveryRequired.value = true;
		readWorkspaceEmptyResponse(
			await requestAttached(
				'workspace.resumeAck',
				readWorkspaceResumeAck({
					resumeToken: result.resumeToken,
					attachmentGeneration: result.attachmentGeneration,
				}),
			),
		);
		this.assertConnectionGeneration(generation);
		this.commitAttachment(result, requestAttached);
		return result;
	}

	private assertConnectionActive(): void {
		if (this.disposed || this.closing) {
			throw new DOMException('Workspace closed', 'AbortError');
		}
	}

	private assertConnectionGeneration(generation: number): void {
		if (generation !== this.lifecycleGeneration) {
			throw new DOMException('Workspace terminal ended', 'AbortError');
		}
	}

	private validateConnectionIdentity(result: WorkspaceConnectionState): void {
		if (result.workspaceId !== this.id || result.connectionId !== this.connection.id) {
			throw new Error('Workspace response identity does not match the request.');
		}
	}

	private commitAttachment(result: WorkspaceConnectionState, requestAttached: WorkspaceAttachmentRequest): void {
		this.attachmentRequest = requestAttached;
		this.currentConnection = result;
		this.resumeToken = result.resumeToken;
		this.attachmentGeneration = result.attachmentGeneration;
		this.recoveryRequired.value = false;
		this.attachmentReady = true;
	}

	resume(
		suspendedSessionId: string,
		markedAt?: string,
		options: WorkspaceSuspendResumeOptions = {},
	): Promise<WorkspaceSuspendedConnection> {
		if (this.suspendedResume) {
			return this.suspendedResumeIntent?.id === suspendedSessionId &&
				this.suspendedResumeIntent.takeover === (options.takeover ?? false)
				? this.suspendedResume
				: Promise.reject(new WorkspaceSuspendFailure('conflict', 'not_dispatched'));
		}
		if (this.disposed || this.closing || this.connecting || this.recoveryRequired.value || this.attachmentReady) {
			return Promise.reject(new WorkspaceSuspendFailure('conflict', 'not_dispatched'));
		}
		const task = this.resumeSuspendedWorkspace(suspendedSessionId, markedAt, options).finally(() => {
			if (this.suspendedResume === task) {
				this.suspendedResume = undefined;
				this.suspendedResumeIntent = undefined;
			}
		});
		this.suspendedResumeIntent = { id: suspendedSessionId, takeover: options.takeover ?? false };
		this.suspendedResume = task;
		return task;
	}

	private async resumeSuspendedWorkspace(
		suspendedSessionId: string,
		markedAt: string | undefined,
		options: WorkspaceSuspendResumeOptions,
	): Promise<WorkspaceSuspendedConnection> {
		const generation = this.lifecycleGeneration;
		const viewport = this.adapters.terminalViewport();
		const input = readWorkspaceSuspendResume({
			suspendedSessionId,
			workspaceId: this.id,
			viewport: viewport ? { columns: viewport.columns, rows: viewport.rows } : undefined,
			takeover: options.takeover,
		});
		this.clearReconnectTimer();
		this.markCapabilitiesDisconnected();
		this.state.value = 'connecting';
		this.statusMessage.value = '';
		this.suspendedSessionId = suspendedSessionId;
		this.ownershipGeneration = undefined;
		this.leaseExpiresAt = undefined;
		let dispatched = false;
		let prepared = false;
		try {
			await this.socket.open();
			this.assertConnectionActive();
			this.assertConnectionGeneration(generation);
			const request = this.socket.bindRequests();
			this.terminalOffset = 0;
			this.receivingSuspendBaseline = true;
			dispatched = true;
			this.recoveryRequired.value = true;
			const result = toSuspendedWorkspace(
				readWorkspaceSuspendResumeResponse(await request('suspend.resume', input)),
			);
			this.receivingSuspendBaseline = false;
			prepared = true;
			this.validateConnectionIdentity(result);
			this.assertConnectionActive();
			this.assertConnectionGeneration(generation);
			if (result.suspendedSessionId !== suspendedSessionId || this.terminalOffset !== result.terminalOffset) {
				throw new WorkspaceSuspendFailure('protocol_failure', 'unknown');
			}
			this.ownershipGeneration = result.ownershipGeneration;
			this.leaseExpiresAt = result.ownershipLeaseExpiresAt;
			readWorkspaceEmptyResponse(
				await request(
					'suspend.resumeAck',
					readWorkspaceSuspendAck({
						suspendedSessionId,
						resumeToken: result.resumeToken,
						attachmentGeneration: result.attachmentGeneration,
						ownershipGeneration: result.ownershipGeneration,
					}),
				),
			);
			this.assertConnectionActive();
			this.assertConnectionGeneration(generation);
			// ACK can release queued live output. Keep the already accumulated offset.
			this.commitAttachment(result, request);
			if (this.lastUnmarkedSuspendedSessionId !== suspendedSessionId) {
				this.markedForSuspend.value = true;
				this.markedForSuspendAt.value = markedAt ?? new Date().toISOString();
			}
			await this.adapters.workspaceConnected();
			this.assertConnectionActive();
			this.assertConnectionGeneration(generation);
			if (!this.socket.connected) {
				throw new WorkspaceSuspendFailure('remote_unavailable', 'unknown');
			}
			this.adapters.terminal.setPreviousOutputAvailable?.(this.markedForSuspend.value && result.historyAvailable);
			this.adapters.terminal.completeResume?.();
			this.hasConnected.value = true;
			this.terminalEnded = false;
			this.freshConnectionRequired = false;
			this.reconnectAttempt = 0;
			this.state.value = 'connected';
			this.startSuspendOwnerHeartbeat();
			void refreshConnection(this.connection.id).catch((cause) =>
				logger.debug({ err: cause, workspaceId: this.id }, 'Connection metadata refresh failed'),
			);
			void this.filesystemState
				.ensureLoaded()
				.catch((cause) =>
					logger.debug({ err: cause, workspaceId: this.id }, 'Resumed workspace filesystem warmup failed'),
				);
			void this.statusController
				.workspaceConnected()
				.catch((cause) =>
					logger.debug({ err: cause, workspaceId: this.id }, 'Resumed workspace status warmup failed'),
				);
			this.dockerController.workspaceConnected();
			return result;
		} catch (cause) {
			this.receivingSuspendBaseline = false;
			const refused =
				cause instanceof WorkspaceRequestFailure &&
				cause.operation === 'suspend.resume' &&
				cause.code !== 'operation_unknown' &&
				cause.code !== 'remote_unavailable';
			const unsent = !prepared && cause instanceof WorkspaceDispatchFailure;
			if (generation === this.lifecycleGeneration) {
				this.recoveryRequired.value = dispatched && !refused && !unsent;
			}
			this.markCapabilitiesDisconnected();
			this.socket.close('Suspended resume failed');
			if (!this.disposed && !this.closing && generation === this.lifecycleGeneration) {
				this.state.value = 'error';
				this.statusMessage.value = this.recoveryRequired.value ? 'operation_unknown' : 'remote_unavailable';
			}
			throw cause;
		}
	}

	markForSuspend(terminalSnapshot: () => Promise<string>): Promise<string> {
		if (this.suspendMutation) return Promise.reject(new WorkspaceSuspendFailure('conflict', 'not_dispatched'));
		const task = Promise.resolve()
			.then(() => this.runMarkForSuspend(terminalSnapshot))
			.finally(() => {
				if (this.suspendMutation === task) this.suspendMutation = undefined;
			});
		this.suspendMutation = task;
		return task;
	}

	private async runMarkForSuspend(terminalSnapshot: () => Promise<string>): Promise<string> {
		this.assertConnectionActive();
		const generation = this.lifecycleGeneration;
		try {
			const result = await this.adapters.suspend.mark(this.id, terminalSnapshot);
			this.assertConnectionActive();
			this.assertConnectionGeneration(generation);
			if (this.lastUnmarkedSuspendedSessionId === result.suspendedSessionId) {
				throw new WorkspaceSuspendFailure('conflict', 'confirmed');
			}
			this.suspendedSessionId = result.suspendedSessionId;
			this.ownershipGeneration = undefined;
			this.leaseExpiresAt = undefined;
			this.markedForSuspend.value = true;
			this.markedForSuspendAt.value = new Date().toISOString();
			this.startSuspendOwnerHeartbeat();
			return result.suspendedSessionId;
		} catch (cause) {
			this.handleSuspendMutationFailure(cause, generation);
			throw cause;
		}
	}

	unmarkSuspend(): Promise<void> {
		if (this.suspendMutation) return Promise.reject(new WorkspaceSuspendFailure('conflict', 'not_dispatched'));
		const task = Promise.resolve()
			.then(() => this.runUnmarkSuspend())
			.finally(() => {
				if (this.suspendMutation === task) this.suspendMutation = undefined;
			});
		this.suspendMutation = task;
		return task;
	}

	private async runUnmarkSuspend(): Promise<void> {
		this.assertConnectionActive();
		const generation = this.lifecycleGeneration;
		try {
			await this.adapters.suspend.unmark(this.id);
			this.assertConnectionActive();
			this.assertConnectionGeneration(generation);
			this.clearSuspendedState();
		} catch (cause) {
			this.handleSuspendMutationFailure(cause, generation);
			throw cause;
		}
	}

	private clearSuspendedState(): void {
		this.clearSuspendOwnerHeartbeat();
		this.markedForSuspend.value = false;
		this.markedForSuspendAt.value = null;
		this.suspendedSessionId = undefined;
		this.ownershipGeneration = undefined;
		this.leaseExpiresAt = undefined;
		this.adapters.terminal.setPreviousOutputAvailable?.(false);
	}

	private handleSuspendMutationFailure(cause: unknown, generation: number): void {
		if (this.disposed || this.closing || generation !== this.lifecycleGeneration) {
			return;
		}
		if (cause instanceof WorkspaceSuspendFailure && cause.outcome !== 'unknown') {
			return;
		}
		this.recoveryRequired.value = true;
		this.clearSuspendOwnerHeartbeat();
		this.markCapabilitiesDisconnected();
		this.socket.close('Suspended mutation result unknown');
		this.statusMessage.value = 'operation_unknown';
	}

	reconnectNow(options: { automatic?: boolean } = {}): void {
		if (
			this.disposed ||
			this.closing ||
			this.markedForSuspend.value ||
			this.state.value === 'connected' ||
			(options.automatic && (this.hostKeyRejected || this.waitingForRetry))
		) {
			return;
		}
		if (this.reconnectInFlight || this.state.value === 'connecting') {
			this.immediateReconnectRequested = true;
			this.clearReconnectTimer();
			return;
		}
		logger.debug(
			{
				workspaceId: this.id,
				connectionId: this.connection.id,
				state: this.state.value,
				reconnectAttempt: this.reconnectAttempt,
			},
			'Workspace reconnect requested immediately',
		);
		this.hostKeyRejected = false;
		this.clearReconnectTimer();
		void this.reconnect();
	}

	async recoverForeground(): Promise<void> {
		if (this.disposed || this.closing || this.terminalEnded) {
			return;
		}
		if (this.state.value === 'connected') {
			if (this.markedForSuspend.value) await this.startSuspendOwnerHeartbeat(true);
			else await this.socket.checkLiveness();
		}
		if (this.disposed || this.closing || document.visibilityState !== 'visible') {
			return;
		}
		if (this.state.value !== 'connected') {
			this.reconnectNow({ automatic: true });
		}
	}

	get canResetTerminal(): boolean {
		return (
			this.connection.type === 'SSH' &&
			this.state.value === 'connected' &&
			!this.markedForSuspend.value &&
			!this.recoveryRequired.value &&
			!this.resetRequested.value &&
			!this.disposed &&
			!this.closing &&
			!this.suspendMutation
		);
	}

	async closeForReset(): Promise<boolean> {
		this.resetRequested.value = true;
		let confirmed = false;
		try {
			confirmed = (await this.close('Terminal reset requested')) === 'closed';
			return confirmed;
		} finally {
			// Detaching or losing the close receipt does not prove the old PTY stopped.
			// Keep its tab fenced instead of starting another remote workspace.
			if (!confirmed && !this.disposed) {
				this.recoveryRequired.value = true;
				this.statusMessage.value = 'operation_unknown';
				this.state.value = 'error';
			}
		}
	}

	close(reason = 'Workspace closed'): Promise<WorkspaceCloseOutcome> {
		if (this.closeTask) {
			return this.closeTask;
		}
		const context = {
			workspaceId: this.id,
			connectionId: this.connection.id,
			state: this.state.value,
			reason,
			markedForSuspend: this.markedForSuspend.value,
			visibilityState: document.visibilityState,
			...(this.markedForSuspend.value
				? { triggerStack: new Error('Workspace runtime close trigger').stack }
				: {}),
		};
		if (this.markedForSuspend.value) {
			logger.info(context, 'Marked Workspace runtime close requested');
		} else {
			logger.debug(context, 'Workspace runtime close requested');
		}
		this.closing = true;
		this.hostKeyConfirmation?.abort();
		this.clearReconnectTimer();
		this.clearSuspendOwnerHeartbeat();
		this.markCapabilitiesDisconnected();
		if (this.suspendedResume || this.suspendMutation) {
			if (this.suspendMutation) this.recoveryRequired.value = true;
			this.socket.close(reason);
		}
		const task = this.closeRemoteWorkspace(reason);
		this.closeTask = task;
		this.state.value = 'disconnected';
		return task;
	}

	dispose(reason = 'Workspace disposed'): Promise<WorkspaceCloseOutcome> {
		if (this.disposeTask) {
			return this.disposeTask;
		}
		const completion = Promise.withResolvers<WorkspaceCloseOutcome>();
		this.disposeTask = completion.promise;
		this.disposed = true;
		const failures: unknown[] = [];
		let closed: Promise<WorkspaceCloseOutcome>;
		try {
			closed = this.close(reason);
		} catch (cause) {
			closed = Promise.reject(cause);
			try {
				this.socket.close(reason);
			} catch (cleanupError) {
				failures.push(cleanupError);
			}
		}
		const context = {
			workspaceId: this.id,
			connectionId: this.connection.id,
			state: this.state.value,
			reason,
			markedForSuspend: this.markedForSuspend.value,
			visibilityState: document.visibilityState,
			...(this.markedForSuspend.value
				? { triggerStack: new Error('Workspace runtime dispose trigger').stack }
				: {}),
		};
		if (this.markedForSuspend.value) {
			logger.info(context, 'Marked Workspace runtime dispose requested');
		} else {
			logger.debug(context, 'Workspace runtime dispose requested');
		}
		this.closing = true;
		const cleanup = [
			() => this.clearReconnectTimer(),
			() => this.clearSuspendOwnerHeartbeat(),
			() => this.editorController.reset(),
			() => this.previewController.clear(),
			() => this.transferController.dispose(),
			() => this.filesystemState.dispose(),
			() => this.statusController.dispose(),
			() => this.dockerController.dispose(),
			() => this.adapters.dispose(),
			...this.cleanup.splice(0).reverse(),
		];
		for (const release of cleanup) {
			try {
				release();
			} catch (cause) {
				failures.push(cause);
			}
		}
		this.state.value = 'disconnected';
		void closed.then(
			(outcome) => {
				if (failures.length) {
					const causes =
						outcome === 'unknown'
							? [new Error('Workspace close outcome is unknown'), ...failures]
							: failures;
					completion.reject(new AggregateError(causes, 'Workspace cleanup failed'));
				} else completion.resolve(outcome);
			},
			(cause) => completion.reject(new AggregateError([cause, ...failures], 'Workspace cleanup failed')),
		);
		return completion.promise;
	}

	private handleTransportClosed(reason?: string): void {
		this.clearSuspendOwnerHeartbeat();
		if (this.disposed || this.closing) {
			return;
		}
		const context = {
			workspaceId: this.id,
			connectionId: this.connection.id,
			state: this.state.value,
			reason,
			hasConnected: this.hasConnected.value,
			reconnectAttempt: this.reconnectAttempt,
			markedForSuspend: this.markedForSuspend.value,
			visibilityState: document.visibilityState,
		};
		if (this.markedForSuspend.value) {
			logger.info(context, 'Marked Workspace transport closed');
		} else {
			logger.debug(context, 'Workspace transport closed');
		}
		if (this.waitingForRetry) return;
		this.markCapabilitiesDisconnected();
		this.state.value = this.recoveryRequired.value ? 'error' : 'disconnected';
		if (reason && !this.recoveryRequired.value) {
			this.statusMessage.value = reason;
		}
		if (this.markedForSuspend.value || this.terminalEnded) {
			return;
		}
		this.scheduleReconnect();
	}

	private async closeRemoteWorkspace(reason: string): Promise<WorkspaceCloseOutcome> {
		// Closing during acquisition still owns the eventual receipt and its cleanup.
		await this.connecting?.catch(() => undefined);
		await this.suspendedResume?.catch(() => undefined);
		await this.suspendMutation?.catch(() => undefined);
		try {
			if (this.recoveryRequired.value) {
				return 'unknown';
			}
			// Marked PTYs belong to the suspension owner; closing this tab only detaches.
			if (this.markedForSuspend.value) return 'detached';
			if (
				!this.attachmentReady ||
				!this.attachmentRequest ||
				!this.socket.connected ||
				!this.resumeToken ||
				this.attachmentGeneration === undefined
			) {
				return 'detached';
			}
			readWorkspaceEmptyResponse(
				await this.attachmentRequest(
					'workspace.close',
					readWorkspaceCloseRequest({
						workspaceId: this.id,
						connectionId: this.connection.id,
						resumeToken: this.resumeToken,
						attachmentGeneration: this.attachmentGeneration,
					}),
				),
			);
			this.attachmentReady = false;
			return 'closed';
		} catch {
			this.recoveryRequired.value = true;
			logger.warn(
				{ workspaceId: this.id, connectionId: this.connection.id },
				'Workspace close result is unknown',
			);
			return 'unknown';
		} finally {
			this.socket.close(reason);
		}
	}

	private prepareFreshConnection(): void {
		this.lifecycleGeneration += 1;
		this.clearSuspendOwnerHeartbeat();
		// Terminal termination during a suspended handover cannot prove its remote outcome.
		this.recoveryRequired.value = this.recoveryRequired.value || Boolean(this.suspendedResume);
		this.ownershipGeneration = undefined;
		this.leaseExpiresAt = undefined;
		this.socket.close('Workspace terminal ended');
		this.currentConnection = undefined;
		this.attachmentReady = false;
		this.resumeToken = undefined;
		this.attachmentGeneration = undefined;
		this.terminalOffset = 0;
		this.freshConnectionRequired = true;
		this.terminalState.discardRemotePty();
	}

	private scheduleReconnect(): void {
		if (
			this.reconnectTimer !== undefined ||
			this.disposed ||
			this.closing ||
			this.recoveryRequired.value ||
			this.hostKeyRejected ||
			this.waitingForRetry ||
			this.markedForSuspend.value
		) {
			return;
		}
		if (!this.hasConnected.value && this.reconnectAttempt >= INITIAL_RECONNECT_ATTEMPT_LIMIT) {
			this.state.value = 'error';
			logger.warn(
				{ workspaceId: this.id, connectionId: this.connection.id, reconnectAttempt: this.reconnectAttempt },
				'Workspace initial reconnect limit reached',
			);
			return;
		}
		if (navigator.onLine === false) {
			this.state.value = 'disconnected';
			logger.debug(
				{ workspaceId: this.id, connectionId: this.connection.id, reconnectAttempt: this.reconnectAttempt },
				'Workspace reconnect deferred while browser is offline',
			);
			return;
		}
		this.reconnectAttempt += 1;
		const delay = Math.min(2 ** Math.min(this.reconnectAttempt, 5) * 1000, RECONNECT_MAX_DELAY_MS);
		this.state.value = 'reconnecting';
		logger.debug(
			{
				workspaceId: this.id,
				connectionId: this.connection.id,
				reconnectAttempt: this.reconnectAttempt,
				delayMs: delay,
			},
			'Workspace reconnect scheduled',
		);
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = undefined;
			logger.debug(
				{
					workspaceId: this.id,
					connectionId: this.connection.id,
					reconnectAttempt: this.reconnectAttempt,
				},
				'Workspace reconnect backoff elapsed',
			);
			void this.reconnect();
		}, delay);
	}

	private async reconnect(): Promise<void> {
		if (
			this.disposed ||
			this.closing ||
			this.recoveryRequired.value ||
			this.hostKeyRejected ||
			this.markedForSuspend.value ||
			this.reconnectInFlight
		) {
			return;
		}
		const reconnectAttempt = this.reconnectAttempt;
		this.reconnectInFlight = true;
		logger.debug(
			{ workspaceId: this.id, connectionId: this.connection.id, reconnectAttempt },
			'Workspace reconnect attempt started',
		);
		try {
			await this.connect();
		} catch (cause) {
			const error = cause instanceof Error ? cause : new Error(String(cause));
			logger.debug(
				{ err: error, workspaceId: this.id, connectionId: this.connection.id, reconnectAttempt },
				'Workspace reconnect attempt failed',
			);
			this.scheduleReconnect();
		} finally {
			this.reconnectInFlight = false;
			if (this.immediateReconnectRequested && !this.disposed && !this.closing && !this.markedForSuspend.value) {
				this.immediateReconnectRequested = false;
				// A foreground kick can arrive while resume is already in flight. Once that
				// attachment succeeds, replaying the kick would resume an already-bound socket.
				if (this.state.value !== 'connected') {
					this.clearReconnectTimer();
					void this.reconnect();
				}
			}
		}
	}

	private markCapabilitiesDisconnected(): void {
		this.adapters.workspaceDisconnected();
		this.statusController.workspaceDisconnected();
		this.dockerController.workspaceDisconnected();
	}

	private startSuspendOwnerHeartbeat(revalidate = false): Promise<void> {
		this.clearSuspendOwnerHeartbeat();
		if (!this.markedForSuspend.value) return Promise.resolve();
		const generation = this.heartbeatGeneration;
		const lifecycle = this.lifecycleGeneration;
		const controller = new AbortController();
		this.heartbeatController = controller;
		const request = this.socket.bindRequests();

		const current = () =>
			generation === this.heartbeatGeneration &&
			lifecycle === this.lifecycleGeneration &&
			!controller.signal.aborted &&
			!this.disposed &&
			!this.closing &&
			this.markedForSuspend.value &&
			this.socket.connected;

		const expire = () => {
			if (!current()) {
				return;
			}
			this.recoveryRequired.value = true;
			this.clearSuspendOwnerHeartbeat();
			this.markCapabilitiesDisconnected();
			this.socket.close('Suspended lease unavailable');
			// Only suspend.revoked carries an authoritative lease-expired reason.
			this.statusMessage.value = 'operation_unknown';
		};

		const armDeadline = () => {
			window.clearTimeout(this.leaseDeadline);
			if (this.leaseExpiresAt !== undefined) {
				this.leaseDeadline = window.setTimeout(expire, Math.max(0, this.leaseExpiresAt - Date.now()));
			}
		};

		const renew = async (): Promise<void> => {
			if (!current()) {
				return;
			}
			try {
				const lease = toSuspendedLease(
					readWorkspaceSuspendOwnerRenew(
						await request('suspend.owner.renew', {}, undefined, controller.signal),
					),
				);
				if (!current()) {
					return;
				}
				if (
					(this.ownershipGeneration !== undefined && lease.generation !== this.ownershipGeneration) ||
					(this.leaseExpiresAt !== undefined && lease.expiresAt < this.leaseExpiresAt) ||
					lease.expiresAt <= Date.now()
				) {
					throw new WorkspaceSuspendFailure('protocol_failure', 'unknown');
				}
				this.ownershipGeneration = lease.generation;
				this.leaseExpiresAt = lease.expiresAt;
				armDeadline();
				this.suspendOwnerHeartbeat = window.setTimeout(() => void renew(), SUSPEND_OWNER_HEARTBEAT_MS);
			} catch (cause) {
				if (!current()) {
					return;
				}
				logger.warn({ err: cause, workspaceId: this.id }, 'Suspended owner renewal failed');
				expire();
			}
		};

		// Foreground recovery first asks the server; a queued local deadline is not current ownership evidence.
		if (!revalidate) armDeadline();
		return renew();
	}

	private clearSuspendOwnerHeartbeat(): void {
		this.heartbeatGeneration += 1;
		this.heartbeatController?.abort();
		this.heartbeatController = undefined;
		window.clearTimeout(this.suspendOwnerHeartbeat);
		window.clearTimeout(this.leaseDeadline);
		this.suspendOwnerHeartbeat = undefined;
		this.leaseDeadline = undefined;
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer === undefined) {
			return;
		}
		window.clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}
}
