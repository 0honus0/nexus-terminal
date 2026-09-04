import { ref, type Ref } from 'vue';
import type { Connection } from '@/features/connections/public';
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
    this.socket = new WorkspaceSocket();
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
        this.statusMessage.value = message;
      }),
      this.socket.on<{ message: string }>('terminal.error', ({ message }) => {
        this.markCapabilitiesDisconnected();
        this.state.value = 'error';
        this.statusMessage.value = message;
      }),
      this.socket.on('terminal.closed', () => {
        if (this.closing) return;
        this.markCapabilitiesDisconnected();
        this.state.value = 'disconnected';
      }),
      this.socket.on<{ operation: string; message: string }>('protocol.error', ({ operation, message }) => {
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
    this.state.value = this.hasConnected.value ? 'reconnecting' : 'connecting';
    this.statusMessage.value = '';
    try {
      const result = await this.socket.request<WorkspaceConnectResult>('workspace.connect', {
        workspaceId: this.id,
        connectionId: this.connection.id,
        ...(this.lastViewport ? { viewport: this.lastViewport } : {}),
      });
      await this.adapters.workspaceConnected();
      await this.statusController.workspaceConnected();
      this.dockerController.workspaceConnected();
      if (!this.socket.connected) throw new Error('Workspace connection closed during capability recovery.');
      this.hasConnected.value = true;
      this.reconnectAttempt = 0;
      this.state.value = 'connected';
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.state.value = 'error';
      this.statusMessage.value = error.message;
      throw error;
    }
  }

  async resume(suspendedSessionId: string): Promise<WorkspaceConnectResult> {
    if (this.disposed) throw new Error('Workspace session has been disposed.');
    this.clearReconnectTimer();
    this.closing = false;
    this.state.value = 'connecting';
    this.statusMessage.value = '';
    try {
      const result = await this.socket.request<WorkspaceConnectResult & { resumedFrom: string }>('suspend.resume', {
        suspendedSessionId,
        workspaceId: this.id,
      });
      await this.adapters.workspaceConnected();
      await this.statusController.workspaceConnected();
      this.dockerController.workspaceConnected();
      if (!this.socket.connected) throw new Error('Workspace connection closed during capability recovery.');
      this.hasConnected.value = true;
      this.reconnectAttempt = 0;
      this.state.value = 'connected';
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
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

  fallbackSuspendToReconnect(): void {
    if (!this.markedForSuspend.value) return;
    this.markedForSuspend.value = false;
    this.markedForSuspendAt.value = null;
    this.reconnectNow();
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
    this.clearReconnectTimer();
    void this.reconnect();
  }

  close(reason = 'Workspace closed'): void {
    if (this.disposed) return;
    this.closing = true;
    this.clearReconnectTimer();
    this.statusController.workspaceDisconnected();
    this.dockerController.workspaceDisconnected();
    this.socket.close(reason);
    this.state.value = 'disconnected';
  }

  dispose(reason = 'Workspace disposed'): void {
    if (this.disposed) return;
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
      return;
    }
    this.reconnectAttempt += 1;
    const delay = Math.min(2 ** Math.min(this.reconnectAttempt, 5) * 1000, RECONNECT_MAX_DELAY_MS);
    this.state.value = 'reconnecting';
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (this.disposed || this.closing || this.markedForSuspend.value || this.reconnectInFlight) return;
    this.reconnectInFlight = true;
    try {
      await this.connect(this.lastViewport);
    } catch {
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
