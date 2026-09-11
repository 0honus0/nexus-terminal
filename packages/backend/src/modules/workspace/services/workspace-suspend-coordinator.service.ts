import { Readable } from 'node:stream';
import type { SshSuspendService } from '../../ssh-suspend/ssh-suspend.service';
import { logger } from '../../../shared/logging/logger';
import type { SuspendedSessionLogStore } from '../../ssh-suspend/suspended-session-log.port';
import type { WorkspaceEventHub } from '../workspace-event-hub';
import type { WorkspaceService } from '../workspace.service';
import type { WorkspaceFilesystemService } from './workspace-filesystem.service';
import type { WorkspaceOperationsService } from './workspace-operations.service';
import type {
  WorkspaceShellIntegrationService,
  WorkspaceShellIntegrationSnapshot,
} from './workspace-shell-integration.service';
import type { WorkspaceStatusMonitorService } from './workspace-status-monitor.service';
import type { WorkspaceTerminalService } from './workspace-terminal.service';

interface SuspendMark {
  userId: number;
  logIdentifier: string;
  ready: Promise<void>;
  writeChain: Promise<void>;
  stopOutput?: () => void;
}
interface PendingResume {
  userId: number;
  suspendSessionId: string;
  workspaceId: string;
  logIdentifier?: string;
  historyCursor: number;
}
interface ResumedHistory {
  userId: number;
  logIdentifier: string;
  cursor: number;
  latestCursor: number;
}

const INITIAL_RESUME_LOG_BYTES = 256 * 1024;
const RESUME_HISTORY_PAGE_BYTES = 256 * 1024;

export interface BeginWorkspaceResumeResult {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
  logStream: Readable;
  historyAvailable: boolean;
}

export interface PreviousWorkspaceHistoryResult {
  data: Uint8Array;
  hasMore: boolean;
}

/**
 * Owns Workspace ↔ suspended-transport handoff. Interfaces participate only in the cached-output ACK
 * window between beginResume() and commitResume().
 */
export class WorkspaceSuspendCoordinatorService {
  private readonly marks = new Map<string, SuspendMark>();
  private readonly pending = new Map<string, PendingResume>();
  private readonly resumedHistory = new Map<string, ResumedHistory>();
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly terminal: WorkspaceTerminalService,
    private readonly shellIntegration: WorkspaceShellIntegrationService,
    private readonly status: WorkspaceStatusMonitorService,
    private readonly operations: WorkspaceOperationsService,
    private readonly filesystem: WorkspaceFilesystemService,
    private readonly suspended: SshSuspendService,
    private readonly logs: SuspendedSessionLogStore,
    private readonly events: WorkspaceEventHub,
  ) {}

  async markForSuspend(workspaceId: string, userId: number, initialBuffer?: string): Promise<void> {
    const session = this.workspaces.requireSession(workspaceId);
    if (session.userId !== userId) throw new Error('无权挂起此会话。');
    const existing = this.marks.get(workspaceId);
    if (existing) {
      if (existing.userId !== userId) throw new Error('无权挂起此会话。');
      await existing.ready;
      return;
    }

    const mark = this.createMark(workspaceId, userId, workspaceId, initialBuffer);
    try {
      await mark.ready;
    } catch (error) {
      if (this.marks.get(workspaceId) === mark) this.marks.delete(workspaceId);
      await this.finishMark(mark);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      throw error;
    }
  }
  async unmarkForSuspend(workspaceId: string, userId: number): Promise<void> {
    const mark = this.marks.get(workspaceId);
    if (!mark) return;
    if (mark.userId !== userId) throw new Error('无权取消此会话的挂起标记。');
    await mark.ready.catch(() => undefined);
    if (this.marks.get(workspaceId) !== mark) return;
    this.marks.delete(workspaceId);
    await this.finishMark(mark);
    if (!this.resumedHistory.has(workspaceId)) await this.logs.delete(mark.logIdentifier).catch(() => undefined);
  }
  isMarked(workspaceId: string): boolean {
    return this.marks.has(workspaceId);
  }

  async handleClientDisconnect(workspaceId: string): Promise<{ suspended: boolean; suspendSessionId?: string }> {
    const session = this.workspaces.getSession(workspaceId);
    if (!session) return { suspended: false };
    await this.clearResumedHistory(workspaceId);

    let mark = this.marks.get(workspaceId);
    if (mark) {
      try {
        await mark.ready;
      } catch {
        mark = undefined;
      }
      if (mark && this.marks.get(workspaceId) !== mark) mark = undefined;
    }

    this.status.clear(workspaceId);
    // Keep the mark listener alive through terminal detach so a decoder flush is retained too.
    this.terminal.detach(workspaceId);
    if (!mark) {
      await this.operations.cleanup(workspaceId);
      this.shellIntegration.clear(workspaceId);
      this.events.clear(workspaceId);
      await this.workspaces.closeSession(workspaceId);
      return { suspended: false };
    }

    this.marks.delete(workspaceId);
    await this.finishMark(mark);
    const snapshot = this.shellIntegration.snapshot(workspaceId);
    this.shellIntegration.clear(workspaceId);
    this.events.clear(workspaceId);

    let detached;
    try {
      detached = this.workspaces.detach(workspaceId);
    } catch (error) {
      await this.operations.cleanup(workspaceId).catch(() => undefined);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      throw error;
    }
    if (!detached) {
      await this.operations.cleanup(workspaceId).catch(() => undefined);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      return { suspended: false };
    }

    const suspendSessionId = await this.suspended.takeOver({
      userId: session.userId,
      originalSessionId: session.id,
      connectionName: session.connectionName,
      connectionId: session.connectionId,
      logIdentifier: mark.logIdentifier,
      transport: detached.transport,
      shell: session.shell,
      ...this.toSuspendSnapshot(snapshot),
    });
    if (!suspendSessionId) {
      await this.operations.cleanup(workspaceId).catch(() => undefined);
      await detached.transport.close().catch(() => undefined);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      return { suspended: false };
    }

    // The transport is now owned by SshSuspendService and immediately visible as `hanging`.
    // Cleanup of ancillary file operations must not delay the user-visible suspend handoff.
    await this.operations.cleanup(workspaceId).catch(() => undefined);
    logger.info({ workspaceId, suspendedSessionId: suspendSessionId }, 'Workspace suspended');
    return { suspended: true, suspendSessionId };
  }

  async beginResume(
    userId: number,
    suspendSessionId: string,
    newWorkspaceId: string,
  ): Promise<BeginWorkspaceResumeResult> {
    if (this.pending.has(newWorkspaceId)) throw new Error(`Workspace resume ${newWorkspaceId} is already pending.`);

    // Reserve the replacement Workspace before the first async handoff step. A socket can close
    // while prepareResume() is flushing the retained log; closeWorkspace() must see this as an
    // in-flight resume and rollback the suspended record instead of treating it as a normal,
    // unmarked Workspace and closing the shared transport.
    const pending: PendingResume = {
      userId,
      suspendSessionId,
      workspaceId: newWorkspaceId,
      historyCursor: 0,
    };
    this.pending.set(newWorkspaceId, pending);
    logger.debug(
      { workspaceId: newWorkspaceId, suspendedSessionId: suspendSessionId, pendingResumes: this.pending.size },
      'Suspended Workspace resume queued',
    );

    let prepared: Awaited<ReturnType<SshSuspendService['prepareResume']>>;
    let attached = false;
    try {
      prepared = await this.suspended.prepareResume(userId, suspendSessionId);
      if (!prepared) throw new Error('服务未能恢复会话，或会话不存在/状态不正确。');
      if (this.pending.get(newWorkspaceId) !== pending) {
        throw new Error('挂起恢复已被客户端关闭操作取消。');
      }
      pending.logIdentifier = prepared.logIdentifier;

      const session = this.workspaces.attach({
        workspaceId: newWorkspaceId,
        userId,
        connectionId: prepared.originalConnectionId,
        connectionName: prepared.connectionName,
        transport: prepared.transport,
        shell: prepared.shell,
      });
      attached = true;
      this.shellIntegration.restore(newWorkspaceId, {
        shellPid: prepared.shellPid,
        shellKind: prepared.shellKind,
        integrationReady: prepared.shellIntegrationReady,
        atPrompt: prepared.shellAtPrompt,
      });
      // Keep the live terminal detached until the retained tail has been sent. Even with the
      // remote shell paused, already-buffered PTY data can race a newly attached listener and
      // appear ahead of the cached-tail stream. commitResume() attaches immediately before resume.
      const tail = await this.logs.readTail(prepared.logIdentifier, INITIAL_RESUME_LOG_BYTES);
      if (this.pending.get(newWorkspaceId) !== pending) {
        throw new Error('挂起恢复已被客户端关闭操作取消。');
      }
      pending.historyCursor = tail.startOffset;
      const logStream = Readable.from(tail.data.byteLength ? [Buffer.from(tail.data)] : []);
      return {
        workspaceId: newWorkspaceId,
        connectionId: session.connectionId,
        connectionName: session.connectionName,
        logStream,
        historyAvailable: tail.startOffset > 0,
      };
    } catch (error) {
      // If closeWorkspace() already consumed this reservation, it has also detached/rolled back
      // whatever state existed at that point. This is an expected client-cancellation path, not an
      // operational warning; real preparation failures remain visible at warn.
      const cancelledByClient = this.pending.get(newWorkspaceId) !== pending;
      const context = { err: error, workspaceId: newWorkspaceId, suspendedSessionId: suspendSessionId };
      if (cancelledByClient) logger.debug(context, 'Suspended Workspace resume preparation cancelled');
      else logger.warn(context, 'Suspended Workspace resume preparation failed');
      if (!cancelledByClient) {
        this.pending.delete(newWorkspaceId);
        if (attached) {
          this.terminal.detach(newWorkspaceId);
          this.shellIntegration.clear(newWorkspaceId);
          try {
            this.workspaces.detach(newWorkspaceId);
          } catch {
            /* same transport still belongs to suspended record */
          }
        }
        await this.suspended.rollbackResume(userId, suspendSessionId).catch(() => false);
      }
      throw error;
    }
  }

  async commitResume(workspaceId: string): Promise<void> {
    const pending = this.pending.get(workspaceId);
    if (!pending?.logIdentifier) throw new Error(`No prepared resume exists for ${workspaceId}.`);
    // The retained tail is fully sent before commitResume() is called. Attach the live listener only
    // now, while the shell is still paused, so the first resumed PTY bytes are ordered strictly after
    // the cached history already delivered on the WebSocket.
    this.terminal.attach(workspaceId);
    if (!(await this.suspended.commitResume(pending.userId, pending.suspendSessionId, true)))
      throw new Error('挂起恢复事务提交失败。');
    this.pending.delete(workspaceId);
    if (pending.historyCursor > 0) {
      this.resumedHistory.set(workspaceId, {
        userId: pending.userId,
        logIdentifier: pending.logIdentifier,
        cursor: pending.historyCursor,
        latestCursor: pending.historyCursor,
      });
    }
    // Resume does not implicitly cancel suspend. Keep recording into the same retained log;
    // the frontend can explicitly unmark later if the user wants a normal reconnect lifecycle.
    this.createMark(workspaceId, pending.userId, pending.logIdentifier);
    const session = this.workspaces.requireSession(workspaceId);
    session.shell.resume();
    logger.info(
      { workspaceId, suspendedSessionId: pending.suspendSessionId, historyAvailable: pending.historyCursor > 0 },
      'Suspended Workspace resumed',
    );
    await this.filesystem
      .initialize(workspaceId)
      .catch((error) =>
        logger.warn({ err: error, workspaceId }, 'Workspace filesystem initialization after resume failed'),
      );
  }

  async loadPreviousHistory(workspaceId: string, userId: number): Promise<PreviousWorkspaceHistoryResult> {
    const session = this.workspaces.requireSession(workspaceId);
    if (session.userId !== userId) throw new Error('无权读取此会话的历史输出。');
    const history = this.resumedHistory.get(workspaceId);
    if (!history || history.userId !== userId || history.cursor <= 0) {
      return { data: new Uint8Array(), hasMore: false };
    }
    const page = await this.logs.readBefore(history.logIdentifier, history.cursor, RESUME_HISTORY_PAGE_BYTES);
    history.cursor = page.startOffset;
    const hasMore = page.startOffset > 0;
    return { data: page.data, hasMore };
  }

  resetPreviousHistory(workspaceId: string, userId: number): boolean {
    const session = this.workspaces.requireSession(workspaceId);
    if (session.userId !== userId) throw new Error('无权读取此会话的历史输出。');
    const history = this.resumedHistory.get(workspaceId);
    if (!history || history.userId !== userId || history.latestCursor <= 0) return false;
    history.cursor = history.latestCursor;
    return true;
  }

  async rollbackResume(workspaceId: string): Promise<boolean> {
    const pending = this.pending.get(workspaceId);
    if (!pending) return false;
    this.pending.delete(workspaceId);
    this.status.clear(workspaceId);
    await this.operations.cleanup(workspaceId);
    this.terminal.detach(workspaceId);
    this.shellIntegration.clear(workspaceId);
    this.events.clear(workspaceId);
    try {
      this.workspaces.detach(workspaceId);
    } catch {
      /* suspended record still references the same transport */
    }
    return this.suspended.rollbackResume(pending.userId, pending.suspendSessionId);
  }

  async closeWorkspace(workspaceId: string): Promise<void> {
    if (this.pending.has(workspaceId)) {
      await this.rollbackResume(workspaceId);
      return;
    }
    await this.handleClientDisconnect(workspaceId);
  }

  async dispose(): Promise<void> {
    for (const workspaceId of [...this.pending.keys()]) await this.rollbackResume(workspaceId).catch(() => false);
    for (const session of [...this.workspaces.listAllSessions()]) {
      this.status.clear(session.id);
      await this.operations.cleanup(session.id).catch(() => undefined);
      this.terminal.detach(session.id);
      this.shellIntegration.clear(session.id);
      this.events.clear(session.id);
      await this.workspaces.closeSession(session.id).catch(() => undefined);
    }
    for (const [workspaceId, mark] of [...this.marks.entries()]) {
      this.marks.delete(workspaceId);
      await this.finishMark(mark);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
    }
    for (const workspaceId of [...this.resumedHistory.keys()]) await this.clearResumedHistory(workspaceId);
  }

  private async clearResumedHistory(workspaceId: string): Promise<void> {
    const history = this.resumedHistory.get(workspaceId);
    if (!history) return;
    this.resumedHistory.delete(workspaceId);
    if (!this.marks.has(workspaceId)) await this.logs.delete(history.logIdentifier).catch(() => undefined);
  }

  private createMark(workspaceId: string, userId: number, logIdentifier: string, initialBuffer?: string): SuspendMark {
    const initialWrite = initialBuffer ? this.logs.append(logIdentifier, initialBuffer) : Promise.resolve();
    const mark: SuspendMark = {
      userId,
      logIdentifier,
      ready: initialWrite.then(() => this.logs.flush(logIdentifier)),
      writeChain: initialWrite,
    };
    // Publish the transaction before awaiting I/O so disconnect cannot bypass suspend takeover.
    this.marks.set(workspaceId, mark);
    mark.stopOutput = this.events.subscribe(workspaceId, (event) => {
      if (event.type !== 'terminal-output' || this.marks.get(workspaceId) !== mark) return;
      mark.writeChain = mark.writeChain
        .catch(() => undefined)
        .then(() => this.logs.append(logIdentifier, event.data))
        .catch(() => undefined);
    });
    return mark;
  }

  private async finishMark(mark: SuspendMark): Promise<void> {
    mark.stopOutput?.();
    mark.stopOutput = undefined;
    await mark.writeChain.catch(() => undefined);
    await this.logs
      .flush(mark.logIdentifier)
      .catch((error) => logger.warn({ err: error }, 'Suspended Workspace log flush failed'));
  }

  private toSuspendSnapshot(snapshot: WorkspaceShellIntegrationSnapshot) {
    return {
      shellPid: snapshot.shellPid,
      shellKind: snapshot.shellKind,
      shellIntegrationReady: snapshot.integrationReady,
      shellAtPrompt: snapshot.atPrompt,
    };
  }
}
