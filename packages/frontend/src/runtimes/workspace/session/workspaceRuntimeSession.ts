import { ref, type Ref } from 'vue';
import { logger } from '@/client/logging/logger';
import { markConnectionConnected, type Connection } from '@/features/connections/public';
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
import type { WorkspaceConnectResult, WorkspaceLifecycleState } from '../model/workspace';
import { WORKSPACE_BINARY_PROTOCOL_VERSION } from '../protocol/workspaceBinaryProtocol';
import { WorkspaceSocket } from '../protocol/workspaceSocket';

export interface WorkspaceRuntimeSessionOptions {
  workspaceId?: string;
  onSuspendedAutoTerminated?: (event: { suspendedSessionId: string; reason: string }) => void;
}

const RECONNECT_MAX_DELAY_MS = 30_000;
const INITIAL_RECONNECT_ATTEMPT_LIMIT = 5;

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

  private reconnectAttempt = 0;
  private reconnectTimer?: number;
  private reconnectInFlight = false;
  private disposed = false;
  private closing = false;
  private lastViewport?: TerminalViewport;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    readonly connection: Connection,
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
      this.socket.on<{ message: string }>('terminal.error', ({ message }) => {
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
      }),
      this.socket.on<{ operation: string; message: string }>('protocol.error', ({ operation, message }) => {
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
      this.socket.on<{ suspendedSessionId: string; reason: string }>('suspend.autoTerminated', (event) =>
        options.onSuspendedAutoTerminated?.(event),
      ),
    );
  }

  async connect(viewport?: TerminalViewport): Promise<WorkspaceConnectResult> {
    if (this.disposed) throw new Error('Workspace session has been disposed.');
    if (viewport) this.lastViewport = viewport;
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
      const result = await this.socket.request<WorkspaceConnectResult>('workspace.connect', {
        workspaceId: this.id,
        connectionId: this.connection.id,
        ...(this.lastViewport ? { viewport: this.lastViewport } : {}),
      });
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

  async resume(suspendedSessionId: string, markedAt?: string): Promise<WorkspaceConnectResult> {
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
      const result = await this.socket.request<
        WorkspaceConnectResult & { resumedFrom: string; historyAvailable?: boolean }
      >('suspend.resume', {
        suspendedSessionId,
        workspaceId: this.id,
      });
      if (result.binaryProtocolVersion !== WORKSPACE_BINARY_PROTOCOL_VERSION) {
        throw new Error('Workspace binary protocol version mismatch.');
      }
      this.adapters.terminal.setPreviousOutputAvailable?.(Boolean(result.historyAvailable));
      await this.adapters.workspaceConnected();
      if (!this.socket.connected) throw new Error('Workspace connection closed during terminal activation.');
      this.hasConnected.value = true;
      this.reconnectAttempt = 0;
      this.markedForSuspend.value = true;
      this.markedForSuspendAt.value = markedAt ?? new Date().toISOString();
      this.state.value = 'connected';
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

  async markForSuspend(terminalSnapshot?: string): Promise<void> {
    await this.adapters.suspend.mark(this.id, terminalSnapshot);
    this.markedForSuspend.value = true;
    this.markedForSuspendAt.value = new Date().toISOString();
  }

  async unmarkSuspend(): Promise<void> {
    await this.adapters.suspend.unmark(this.id);
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
    logger.debug(
      { workspaceId: this.id, connectionId: this.connection.id, state: this.state.value, reason },
      'Workspace runtime close requested',
    );
    this.closing = true;
    this.clearReconnectTimer();
    this.statusController.workspaceDisconnected();
    this.dockerController.workspaceDisconnected();
    this.socket.close(reason);
    this.state.value = 'disconnected';
  }

  dispose(reason = 'Workspace disposed'): void {
    if (this.disposed) return;
    logger.debug(
      { workspaceId: this.id, connectionId: this.connection.id, state: this.state.value, reason },
      'Workspace runtime dispose requested',
    );
    this.disposed = true;
    this.closing = true;
    this.clearReconnectTimer();
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
    if (this.disposed || this.closing) return;
    logger.debug(
      {
        workspaceId: this.id,
        connectionId: this.connection.id,
        state: this.state.value,
        reason,
        hasConnected: this.hasConnected.value,
        reconnectAttempt: this.reconnectAttempt,
        markedForSuspend: this.markedForSuspend.value,
      },
      'Workspace transport closed',
    );
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
      await this.connect(this.lastViewport);
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

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}
