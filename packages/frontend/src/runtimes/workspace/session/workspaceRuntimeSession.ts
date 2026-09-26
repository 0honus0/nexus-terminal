import type {
  WorkspaceConnectResponseDto,
  WorkspaceConnectRequestDto,
  WorkspaceSuspendAutoTerminatedEventDto,
  WorkspaceSuspendResumeResponseDto,
  WorkspaceSuspendResumeRequestDto,
} from '@nexus-terminal/protocol/workspace';
import { ref, type Ref } from 'vue';
import { logger } from '@/client/logging/logger';
import { markConnectionConnected, type ConnectionDto } from '@/features/connections/public';
import {
  createTerminalSessionState,
  type TerminalSessionState,
  type WorkspaceTerminalViewportDto,
} from '@/features/terminal/public';
import { createFileEditorSession, type FileEditorSessionController } from '@/features/file-editor/public';
import { createFilePreviewSession, type FilePreviewSessionController } from '@/features/file-preview/public';
import { createFilesystemSessionState, type FilesystemSessionState } from '@/features/filesystem/public';
import { createTransferController, type TransferController } from '@/features/transfers/public';
import { createStatusMonitorSession, type StatusMonitorSessionController } from '@/features/status-monitor/public';
import { createDockerSession, type DockerSessionController } from '@/features/docker/public';
import { createWorkspaceCapabilityAdapters, type WorkspaceCapabilityAdapters } from '../adapters/capabilityAdapters';
import type { WorkspaceLifecycleState } from '../model/workspace';
import { WORKSPACE_BINARY_PROTOCOL_VERSION } from '../protocol/workspaceBinaryProtocol';
import { WorkspaceSocket } from '../protocol/workspaceSocket';

type WorkspaceSuspendResumeOptions = Pick<WorkspaceSuspendResumeRequestDto, 'takeover'>;

export interface WorkspaceRuntimeSessionOptions {
  workspaceId?: string;
  onSuspendedAutoTerminated?: (event: WorkspaceSuspendAutoTerminatedEventDto) => void;
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

  private reconnectAttempt = 0;
  private reconnectTimer?: number;
  private reconnectInFlight = false;
  private suspendOwnerHeartbeat?: number;
  private disposed = false;
  private closing = false;
  private lastViewport?: WorkspaceTerminalViewportDto;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    readonly connection: ConnectionDto,
    options: WorkspaceRuntimeSessionOptions = {},
  ) {
    this.id = options.workspaceId ?? crypto.randomUUID();
    this.socket = new WorkspaceSocket({ workspaceId: this.id, connectionId: this.connection.id });
    this.adapters = createWorkspaceCapabilityAdapters(this.socket, this.id, this.connection.id);
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
        if (this.disposed || this.closing) return;
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
        if (this.closing) return;
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
      this.socket.on('suspend.autoTerminated', (event) => options.onSuspendedAutoTerminated?.(event)),
      this.socket.on('suspend.revoked', (event) => {
        this.clearSuspendOwnerHeartbeat();
        this.markCapabilitiesDisconnected();
        this.state.value = 'disconnected';
        this.statusMessage.value = event.message;
        logger.warn(
          {
            workspaceId: this.id,
            suspendedSessionId: event.suspendedSessionId,
            generation: event.generation,
            reason: event.reason,
          },
          'Workspace suspended-session ownership revoked',
        );
      }),
    );
  }

  async connect(viewport?: WorkspaceTerminalViewportDto): Promise<WorkspaceConnectResponseDto> {
    if (this.disposed) throw new Error('Workspace session has been disposed.');
    const latestViewport = viewport ?? this.adapters.terminalViewport();
    if (latestViewport) this.lastViewport = latestViewport;
    this.clearReconnectTimer();
    this.closing = false;
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
      },
      'Workspace connection attempt started',
    );
    try {
      const request: WorkspaceConnectRequestDto = {
        workspaceId: this.id,
        connectionId: this.connection.id,
        ...(this.lastViewport ? { viewport: this.lastViewport } : {}),
      };
      const result = await this.socket.request('workspace.connect', request);
      if (result.binaryProtocolVersion !== WORKSPACE_BINARY_PROTOCOL_VERSION) {
        throw new Error('Workspace binary protocol version mismatch.');
      }
      await this.adapters.workspaceConnected();
      if (!this.socket.connected) throw new Error('Workspace connection closed during terminal activation.');
      this.hasConnected.value = true;
      this.reconnectAttempt = 0;
      this.state.value = 'connected';
      logger.debug(
        {
          workspaceId: this.id,
          connectionId: this.connection.id,
          phase,
          reconnectAttempt,
          elapsedMs: Math.round(performance.now() - startedAt),
        },
        'Workspace connection attempt succeeded',
      );
      if (result.lastConnectedAt !== undefined) markConnectionConnected(this.connection.id, result.lastConnectedAt);
      void this.filesystemState
        .ensureLoaded()
        .catch((error) =>
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
      this.state.value = 'error';
      this.statusMessage.value = error.message;
      throw error;
    }
  }

  async resume(
    suspendedSessionId: string,
    markedAt?: string,
    options: WorkspaceSuspendResumeOptions = {},
  ): Promise<WorkspaceSuspendResumeResponseDto> {
    if (this.disposed) throw new Error('Workspace session has been disposed.');
    this.clearReconnectTimer();
    this.closing = false;
    this.state.value = 'connecting';
    this.statusMessage.value = '';
    const startedAt = performance.now();
    logger.debug(
      { workspaceId: this.id, connectionId: this.connection.id, suspendedSessionId },
      'Workspace suspended-session resume started',
    );
    try {
      const viewport = this.adapters.terminalViewport();
      const request: WorkspaceSuspendResumeRequestDto = {
        suspendedSessionId,
        workspaceId: this.id,
        ...(viewport ? { viewport } : {}),
        ...(options.takeover ? { takeover: true } : {}),
      };
      const result = await this.socket.request('suspend.resume', request);
      if (result.binaryProtocolVersion !== WORKSPACE_BINARY_PROTOCOL_VERSION) {
        throw new Error('Workspace binary protocol version mismatch.');
      }
      this.adapters.terminal.setPreviousOutputAvailable?.(Boolean(result.historyAvailable));
      await this.adapters.workspaceConnected();
      if (!this.socket.connected) throw new Error('Workspace connection closed during terminal activation.');
      this.adapters.terminal.completeResume?.();
      this.hasConnected.value = true;
      this.reconnectAttempt = 0;
      this.markedForSuspend.value = true;
      this.markedForSuspendAt.value = markedAt ?? new Date().toISOString();
      this.state.value = 'connected';
      this.startSuspendOwnerHeartbeat();
      logger.debug(
        {
          workspaceId: this.id,
          connectionId: this.connection.id,
          suspendedSessionId,
          elapsedMs: Math.round(performance.now() - startedAt),
        },
        'Workspace suspended-session resume succeeded',
      );
      void this.filesystemState
        .ensureLoaded()
        .catch((error) =>
          logger.debug({ err: error, workspaceId: this.id }, 'Resumed workspace filesystem warmup failed'),
        );
      void this.statusController
        .workspaceConnected()
        .catch((error) => logger.debug({ err: error, workspaceId: this.id }, 'Resumed workspace status warmup failed'));
      this.dockerController.workspaceConnected();
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      logger.warn(
        {
          err: error,
          workspaceId: this.id,
          connectionId: this.connection.id,
          suspendedSessionId,
          elapsedMs: Math.round(performance.now() - startedAt),
        },
        'Workspace suspended-session resume failed',
      );
      this.state.value = 'error';
      this.statusMessage.value = error.message;
      throw error;
    }
  }

  async markForSuspend(terminalSnapshot?: string): Promise<string> {
    const result = await this.adapters.suspend.mark(this.id, terminalSnapshot);
    this.close('Workspace suspended');
    return result.suspendedSessionId;
  }

  async unmarkSuspend(): Promise<void> {
    await this.adapters.suspend.unmark(this.id);
    this.clearSuspendOwnerHeartbeat();
    this.markedForSuspend.value = false;
    this.markedForSuspendAt.value = null;
  }

  reconnectNow(): void {
    if (
      this.disposed ||
      this.closing ||
      this.markedForSuspend.value ||
      this.state.value === 'connected' ||
      this.state.value === 'connecting' ||
      this.reconnectInFlight
    )
      return;
    logger.debug(
      {
        workspaceId: this.id,
        connectionId: this.connection.id,
        state: this.state.value,
        reconnectAttempt: this.reconnectAttempt,
      },
      'Workspace reconnect requested immediately',
    );
    this.clearReconnectTimer();
    void this.reconnect();
  }

  close(reason = 'Workspace closed'): void {
    if (this.disposed) return;
    const context = {
      workspaceId: this.id,
      connectionId: this.connection.id,
      state: this.state.value,
      reason,
      markedForSuspend: this.markedForSuspend.value,
      visibilityState: document.visibilityState,
      ...(this.markedForSuspend.value ? { triggerStack: new Error('Workspace runtime close trigger').stack } : {}),
    };
    if (this.markedForSuspend.value) logger.info(context, 'Marked Workspace runtime close requested');
    else logger.debug(context, 'Workspace runtime close requested');
    this.closing = true;
    this.clearReconnectTimer();
    this.clearSuspendOwnerHeartbeat();
    this.statusController.workspaceDisconnected();
    this.dockerController.workspaceDisconnected();
    this.socket.close(reason);
    this.state.value = 'disconnected';
  }

  dispose(reason = 'Workspace disposed'): void {
    if (this.disposed) return;
    const context = {
      workspaceId: this.id,
      connectionId: this.connection.id,
      state: this.state.value,
      reason,
      markedForSuspend: this.markedForSuspend.value,
      visibilityState: document.visibilityState,
      ...(this.markedForSuspend.value ? { triggerStack: new Error('Workspace runtime dispose trigger').stack } : {}),
    };
    if (this.markedForSuspend.value) logger.info(context, 'Marked Workspace runtime dispose requested');
    else logger.debug(context, 'Workspace runtime dispose requested');
    this.disposed = true;
    this.closing = true;
    this.clearReconnectTimer();
    this.clearSuspendOwnerHeartbeat();
    this.transferController.dispose();
    this.filesystemState.dispose();
    this.statusController.dispose();
    this.dockerController.dispose();
    this.adapters.dispose();
    while (this.cleanup.length) this.cleanup.pop()?.();
    this.socket.close(reason);
    this.state.value = 'disconnected';
  }

  private handleTransportClosed(reason?: string): void {
    this.clearSuspendOwnerHeartbeat();
    if (this.disposed || this.closing) return;
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
    if (this.markedForSuspend.value) logger.info(context, 'Marked Workspace transport closed');
    else logger.debug(context, 'Workspace transport closed');
    this.markCapabilitiesDisconnected();
    this.state.value = 'disconnected';
    if (reason) this.statusMessage.value = reason;
    if (this.markedForSuspend.value) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined || this.disposed || this.closing || this.markedForSuspend.value) return;
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
    if (this.disposed || this.closing || this.markedForSuspend.value || this.reconnectInFlight) return;
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
    }
  }

  private markCapabilitiesDisconnected(): void {
    this.adapters.workspaceDisconnected();
    this.statusController.workspaceDisconnected();
    this.dockerController.workspaceDisconnected();
  }

  private startSuspendOwnerHeartbeat(): void {
    this.clearSuspendOwnerHeartbeat();
    const renew = async (): Promise<void> => {
      if (this.disposed || this.closing || !this.markedForSuspend.value || !this.socket.connected) return;
      try {
        await this.socket.request('suspend.owner.renew', {});
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        logger.warn(
          { err: error, workspaceId: this.id, connectionId: this.connection.id },
          'Suspended-session owner lease renewal failed',
        );
        this.statusMessage.value = error.message;
      }
    };
    this.suspendOwnerHeartbeat = window.setInterval(() => void renew(), SUSPEND_OWNER_HEARTBEAT_MS);
  }

  private clearSuspendOwnerHeartbeat(): void {
    if (this.suspendOwnerHeartbeat === undefined) return;
    window.clearInterval(this.suspendOwnerHeartbeat);
    this.suspendOwnerHeartbeat = undefined;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}
