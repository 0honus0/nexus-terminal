import { randomUUID } from 'node:crypto';
import type { Scope } from '../agent.types';
import type { AppCapabilityBroker } from '../host/app-capability-broker';
import type { AppLifecycleService } from '../host/app-lifecycle.service';
import type { AgentSettingsService } from '../host/agent-settings.service';
import type { AgentWorkspaceRepositoryPort } from './workspace-runtime.repository.port';
import type {
  WorkspaceRuntimeInteractiveSession,
  WorkspaceRuntimeInteractiveSessionPort,
  WorkspaceRuntimeTerminalAttachment,
} from './workspace-runtime-interactive-session.port';

const DETACH_GRACE_MS = 30_000;
const MAX_REPLAY_BYTES = 1024 * 1024;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validViewport = (columns: number, rows: number): void => {
  if (
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(rows) ||
    columns < 2 ||
    rows < 1 ||
    columns > 1000 ||
    rows > 500
  ) {
    throw new Error('VALIDATION_FAILED');
  }
};

type BufferedOutput = { kind: 'data' | 'stderr'; data: Uint8Array };

interface ManagedTerminalSession {
  id: string;
  scope: Scope;
  workspaceId: string;
  generation: number;
  session: WorkspaceRuntimeInteractiveSession;
  attachment: TerminalAttachment | null;
  replay: BufferedOutput[];
  replayBytes: number;
  detachTimer: NodeJS.Timeout | null;
  unsubscribers: Array<() => void>;
  closed: boolean;
}

class TerminalAttachment implements WorkspaceRuntimeTerminalAttachment {
  private readonly drainListeners = new Set<() => void>();
  private readonly dataListeners = new Set<(data: Uint8Array) => void>();
  private readonly stderrListeners = new Set<(data: Uint8Array) => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private detached = false;

  constructor(
    private readonly owner: WorkspaceRuntimeTerminalService,
    private readonly managed: ManagedTerminalSession,
  ) {}

  get sessionId(): string {
    return this.managed.id;
  }
  get workspaceId(): string {
    return this.managed.workspaceId;
  }
  get generation(): number {
    return this.managed.generation;
  }
  get isOpen(): boolean {
    return !this.detached && !this.managed.closed && this.managed.session.isOpen;
  }
  write(data: string | Uint8Array): boolean {
    return this.isOpen && this.managed.session.write(data);
  }
  resize(columns: number, rows: number): void {
    if (!this.isOpen) return;
    validViewport(columns, rows);
    this.managed.session.resize(columns, rows);
  }
  signal(signal: string): void {
    if (this.isOpen) this.managed.session.signal(signal);
  }
  pause(): void {
    if (this.isOpen) this.managed.session.pause();
  }
  resume(): void {
    if (this.isOpen) this.managed.session.resume();
  }
  replayBuffered(): void {
    if (!this.isOpen) return;
    this.owner.replay(this.managed, this);
  }
  onDrain(listener: () => void): () => void {
    this.drainListeners.add(listener);
    return () => this.drainListeners.delete(listener);
  }
  onData(listener: (data: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }
  onStderr(listener: (data: Uint8Array) => void): () => void {
    this.stderrListeners.add(listener);
    return () => this.stderrListeners.delete(listener);
  }
  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.owner.detach(this.managed, this);
    this.clearListeners();
  }
  async close(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    await this.owner.closeManaged(this.managed, this);
    this.clearListeners();
  }

  deliverDrain(): void {
    if (!this.detached) for (const listener of this.drainListeners) listener();
  }
  deliver(kind: 'data' | 'stderr', data: Uint8Array): boolean {
    if (this.detached) return false;
    const listeners = kind === 'data' ? this.dataListeners : this.stderrListeners;
    if (listeners.size === 0) return false;
    for (const listener of listeners) listener(data);
    return true;
  }
  deliverClose(): void {
    if (this.detached) return;
    this.detached = true;
    for (const listener of this.closeListeners) listener();
    this.clearListeners();
  }
  deliverError(error: Error): void {
    if (!this.detached) for (const listener of this.errorListeners) listener(error);
  }

  private clearListeners(): void {
    this.drainListeners.clear();
    this.dataListeners.clear();
    this.stderrListeners.clear();
    this.closeListeners.clear();
    this.errorListeners.clear();
  }
}

export class WorkspaceRuntimeTerminalService {
  private readonly managed = new Map<string, ManagedTerminalSession>();

  constructor(
    private readonly repository: AgentWorkspaceRepositoryPort,
    private readonly sessions: WorkspaceRuntimeInteractiveSessionPort,
    private readonly settings: AgentSettingsService,
    private readonly lifecycle: AppLifecycleService,
    private readonly capabilities: AppCapabilityBroker,
  ) {}

  async open(
    scope: Scope,
    workspaceId: string,
    generation: number,
    columns: number,
    rows: number,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceRuntimeTerminalAttachment> {
    if (!workspaceId || workspaceId.length > 128 || !Number.isSafeInteger(generation) || generation < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    if (sessionId !== undefined && !SESSION_ID.test(sessionId)) throw new Error('VALIDATION_FAILED');
    validViewport(columns, rows);
    if (signal?.aborted) throw signal.reason ?? new Error('ABORTED');
    const [settings, app, decision, workspace] = await Promise.all([
      this.settings.get(scope.userId),
      this.lifecycle.get(scope),
      this.capabilities.authorize(scope, 'workspace.runtime.execute'),
      this.repository.getWorkspace(scope, workspaceId),
    ]);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState)) {
      throw new Error('AGENT_APP_DISABLED');
    }
    if (!decision.allowed) throw new Error(decision.code);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.generation !== generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
    if (workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');

    if (sessionId) {
      const existing = this.managed.get(sessionId);
      if (!existing || existing.closed || !existing.session.isOpen)
        throw new Error('WORKSPACE_TERMINAL_SESSION_NOT_FOUND');
      if (
        existing.scope.userId !== scope.userId ||
        existing.scope.appId !== scope.appId ||
        existing.workspaceId !== workspaceId ||
        existing.generation !== generation
      ) {
        throw new Error('RESOURCE_FORBIDDEN');
      }
      if (existing.attachment) throw new Error('WORKSPACE_TERMINAL_ALREADY_ATTACHED');
      if (existing.detachTimer) clearTimeout(existing.detachTimer);
      existing.detachTimer = null;
      existing.session.resize(columns, rows);
      const attachment = new TerminalAttachment(this, existing);
      existing.attachment = attachment;
      return attachment;
    }

    const session = await this.sessions.open({ ...scope, workspaceId, generation, columns, rows }, signal);
    const managed: ManagedTerminalSession = {
      id: randomUUID(),
      scope: { ...scope },
      workspaceId,
      generation,
      session,
      attachment: null,
      replay: [],
      replayBytes: 0,
      detachTimer: null,
      unsubscribers: [],
      closed: false,
    };
    managed.unsubscribers = [
      session.onDrain(() => managed.attachment?.deliverDrain()),
      session.onData((data) => this.output(managed, 'data', data)),
      session.onStderr((data) => this.output(managed, 'stderr', data)),
      session.onError((error) => managed.attachment?.deliverError(error)),
      session.onClose(() => this.finishManaged(managed)),
    ];
    this.managed.set(managed.id, managed);
    const attachment = new TerminalAttachment(this, managed);
    managed.attachment = attachment;
    return attachment;
  }

  closeWorkspace(workspaceId: string, generation?: number): void {
    for (const managed of [...this.managed.values()]) {
      if (managed.workspaceId === workspaceId && (generation === undefined || managed.generation === generation)) {
        void this.closeManaged(managed).catch(() => undefined);
      }
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.managed.values()].map((managed) => this.closeManaged(managed).catch(() => undefined)));
  }

  replay(managed: ManagedTerminalSession, attachment: TerminalAttachment): void {
    if (managed.closed || managed.attachment !== attachment) return;
    const replay = managed.replay.splice(0);
    managed.replayBytes = 0;
    for (const item of replay) {
      if (attachment.deliver(item.kind, item.data)) continue;
      managed.replay.push(item);
      managed.replayBytes += item.data.byteLength;
    }
  }

  detach(managed: ManagedTerminalSession, attachment: TerminalAttachment): void {
    if (managed.closed || managed.attachment !== attachment) return;
    managed.attachment = null;
    if (managed.detachTimer) clearTimeout(managed.detachTimer);
    managed.detachTimer = setTimeout(() => void this.closeManaged(managed).catch(() => undefined), DETACH_GRACE_MS);
    managed.detachTimer.unref?.();
  }

  async closeManaged(managed: ManagedTerminalSession, attachment?: TerminalAttachment): Promise<void> {
    if (attachment && managed.attachment !== attachment) return;
    if (managed.closed) return;
    const currentAttachment = managed.attachment;
    this.finishManaged(managed);
    currentAttachment?.deliverClose();
    await managed.session.close().catch(() => undefined);
  }

  private output(managed: ManagedTerminalSession, kind: 'data' | 'stderr', data: Uint8Array): void {
    if (managed.closed || data.byteLength === 0) return;
    const copy = Uint8Array.from(data);
    if (managed.attachment?.deliver(kind, copy)) return;
    if (managed.replayBytes + copy.byteLength > MAX_REPLAY_BYTES) {
      void this.closeManaged(managed).catch(() => undefined);
      return;
    }
    managed.replay.push({ kind, data: copy });
    managed.replayBytes += copy.byteLength;
  }

  private finishManaged(managed: ManagedTerminalSession): void {
    if (managed.closed) return;
    managed.closed = true;
    this.managed.delete(managed.id);
    if (managed.detachTimer) clearTimeout(managed.detachTimer);
    managed.detachTimer = null;
    for (const off of managed.unsubscribers.splice(0)) off();
    managed.replay.length = 0;
    managed.replayBytes = 0;
    const attachment = managed.attachment;
    managed.attachment = null;
    attachment?.deliverClose();
  }
}
