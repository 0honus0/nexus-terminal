import { Readable } from 'node:stream';
import type { SshSuspendService } from '../../ssh-suspend/ssh-suspend.service';
import type { SuspendedSessionOwnershipRevoked } from '../../ssh-suspend/ssh-suspend.types';
import { logger } from '../../../shared/logging/logger';
import type { SuspendedSessionLogStore } from '../../ssh-suspend/suspended-session-log.port';
import type {
  SuspendedTerminalCheckpoint,
  SuspendedTerminalCheckpointFactory,
  SuspendedTerminalViewport,
} from '../../ssh-suspend/suspended-terminal-checkpoint.port';
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
  checkpoint?: SuspendedTerminalCheckpoint;
  stopOutput?: () => void;
  suspendSessionId?: string;
  ownerId?: string;
  ownershipGeneration?: number;
}
interface PendingResume {
  userId: number;
  suspendSessionId: string;
  workspaceId: string;
  ownerId: string;
  ownershipGeneration?: number;
  ownershipLeaseExpiresAt?: number;
  logIdentifier?: string;
  historyCursor: number;
  checkpoint?: SuspendedTerminalCheckpoint;
  viewport?: SuspendedTerminalViewport;
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
  ownershipGeneration: number;
  ownershipLeaseExpiresAt: number;
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
  private readonly suspendHandoffs = new Map<string, Promise<{ suspended: boolean; suspendSessionId?: string }>>();
  private readonly ownershipRevocationUnsubscribe: () => void;
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly terminal: WorkspaceTerminalService,
    private readonly shellIntegration: WorkspaceShellIntegrationService,
    private readonly status: WorkspaceStatusMonitorService,
    private readonly operations: WorkspaceOperationsService,
    private readonly filesystem: WorkspaceFilesystemService,
    private readonly suspended: SshSuspendService,
    private readonly logs: SuspendedSessionLogStore,
    private readonly checkpoints: SuspendedTerminalCheckpointFactory,
    private readonly events: WorkspaceEventHub,
  ) {
    this.ownershipRevocationUnsubscribe = suspended.onOwnershipRevoked((event) => {
      void this.handleOwnershipRevoked(event);
    });
  }

  async markForSuspend(workspaceId: string, userId: number, initialBuffer?: string): Promise<void> {
    const session = this.workspaces.requireSession(workspaceId);
    if (session.userId !== userId) throw new Error('无权挂起此会话。');
    const viewport = this.terminal.viewport(workspaceId) ?? { columns: 80, rows: 24 };
    const existing = this.marks.get(workspaceId);
    if (existing) {
      if (existing.userId !== userId) throw new Error('无权挂起此会话。');
      await existing.ready;
      if (initialBuffer) await this.refreshMarkCheckpoint(existing, initialBuffer, viewport);
      return;
    }

    const mark = this.createMark(workspaceId, userId, workspaceId, initialBuffer, undefined, viewport);
    try {
      await mark.ready;
    } catch (error) {
      if (this.marks.get(workspaceId) === mark) this.marks.delete(workspaceId);
      await this.finishMark(mark);
      mark.checkpoint?.dispose();
      mark.checkpoint = undefined;
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      throw error;
    }
  }
  async suspendNow(workspaceId: string, userId: number, initialBuffer?: string): Promise<{ suspendSessionId: string }> {
    await this.markForSuspend(workspaceId, userId, initialBuffer);
    const result = await this.handleClientDisconnect(workspaceId);
    if (!result.suspended || !result.suspendSessionId) throw new Error('会话挂起失败。');
    return { suspendSessionId: result.suspendSessionId };
  }

  async unmarkForSuspend(workspaceId: string, userId: number): Promise<void> {
    const mark = this.marks.get(workspaceId);
    if (!mark) return;
    if (mark.userId !== userId) throw new Error('无权取消此会话的挂起标记。');
    await mark.ready.catch(() => undefined);
    if (this.marks.get(workspaceId) !== mark) return;
    this.marks.delete(workspaceId);
    await this.finishMark(mark);
    if (
      mark.suspendSessionId &&
      mark.ownerId &&
      mark.ownershipGeneration !== undefined &&
      !this.suspended.forgetAttached(userId, mark.suspendSessionId, {
        ownerId: mark.ownerId,
        generation: mark.ownershipGeneration,
        workspaceId,
      })
    ) {
      throw new Error('SUSPENDED_SESSION_OWNER_STALE');
    }
    mark.checkpoint?.dispose();
    mark.checkpoint = undefined;
    if (!this.resumedHistory.has(workspaceId)) await this.logs.delete(mark.logIdentifier).catch(() => undefined);
  }
  isMarked(workspaceId: string): boolean {
    return this.marks.has(workspaceId);
  }

  async handleClientDisconnect(workspaceId: string): Promise<{ suspended: boolean; suspendSessionId?: string }> {
    const existing = this.suspendHandoffs.get(workspaceId);
    if (existing) return existing;
    const handoff = this.handleClientDisconnectOnce(workspaceId).finally(() => {
      if (this.suspendHandoffs.get(workspaceId) === handoff) this.suspendHandoffs.delete(workspaceId);
    });
    this.suspendHandoffs.set(workspaceId, handoff);
    return handoff;
  }

  private async handleClientDisconnectOnce(
    workspaceId: string,
  ): Promise<{ suspended: boolean; suspendSessionId?: string }> {
    const session = this.workspaces.getSession(workspaceId);
    if (!session) return { suspended: false };
    await this.clearResumedHistory(workspaceId);

    let mark = this.marks.get(workspaceId);
    if (mark) {
      try {
        await mark.ready;
      } catch {
        if (this.marks.get(workspaceId) === mark) this.marks.delete(workspaceId);
        await this.finishMark(mark);
        mark.checkpoint?.dispose();
        mark.checkpoint = undefined;
        await this.logs.delete(mark.logIdentifier).catch(() => undefined);
        mark = undefined;
      }
      if (mark && this.marks.get(workspaceId) !== mark) mark = undefined;
    }

    this.status.clear(workspaceId);
    // Freeze a marked PTY across the short Workspace -> suspended-owner handoff so no bytes can
    // fall into the listener gap between terminal.detach() and SshSuspendService listener binding.
    if (mark) session.shell.pause();
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
      mark.checkpoint?.dispose();
      mark.checkpoint = undefined;
      session.shell.resume();
      await this.operations.cleanup(workspaceId).catch(() => undefined);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      throw error;
    }
    if (!detached) {
      mark.checkpoint?.dispose();
      mark.checkpoint = undefined;
      session.shell.resume();
      await this.operations.cleanup(workspaceId).catch(() => undefined);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      return { suspended: false };
    }

    let suspendSessionId: string | null;
    try {
      if (mark.suspendSessionId) {
        if (!mark.ownerId || mark.ownershipGeneration === undefined) {
          throw new Error('SUSPENDED_SESSION_OWNERSHIP_INVALID');
        }
        const returned = this.suspended.returnAttached(session.userId, mark.suspendSessionId, {
          ownerId: mark.ownerId,
          generation: mark.ownershipGeneration,
          workspaceId,
          transport: detached.transport,
          shell: session.shell,
          checkpoint: mark.checkpoint,
          ...this.toSuspendSnapshot(snapshot),
        });
        if (!returned) throw new Error('SUSPENDED_SESSION_RETURN_FAILED');
        suspendSessionId = mark.suspendSessionId;
      } else {
        suspendSessionId = await this.suspended.takeOver({
          userId: session.userId,
          originalSessionId: session.id,
          connectionName: session.connectionName,
          connectionId: session.connectionId,
          logIdentifier: mark.logIdentifier,
          transport: detached.transport,
          shell: session.shell,
          checkpoint: mark.checkpoint,
          ...this.toSuspendSnapshot(snapshot),
        });
      }
    } catch (error) {
      mark.checkpoint?.dispose();
      mark.checkpoint = undefined;
      await this.operations.cleanup(workspaceId).catch(() => undefined);
      await detached.transport.close().catch(() => undefined);
      if (!mark.suspendSessionId) await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      throw error;
    }
    if (!suspendSessionId) {
      mark.checkpoint?.dispose();
      await this.operations.cleanup(workspaceId).catch(() => undefined);
      await detached.transport.close().catch(() => undefined);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      return { suspended: false };
    }

    mark.checkpoint = undefined;
    session.shell.resume();

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
    viewport: SuspendedTerminalViewport | undefined,
    ownership: { ownerId: string; takeover?: boolean },
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
      ownerId: ownership.ownerId,
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
      prepared = await this.suspended.prepareResume(userId, suspendSessionId, viewport, ownership);
      if (!prepared) throw new Error('服务未能恢复会话，或会话不存在/状态不正确。');
      if (this.pending.get(newWorkspaceId) !== pending) {
        throw new Error('挂起恢复已被客户端关闭操作取消。');
      }
      pending.ownershipGeneration = prepared.ownership.generation;
      pending.ownershipLeaseExpiresAt = prepared.ownership.leaseExpiresAt;
      pending.logIdentifier = prepared.logIdentifier;
      pending.checkpoint = prepared.checkpoint;
      pending.viewport = prepared.viewport;

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
      // Prefer a serialized VT checkpoint. The shell is paused while it is captured, so the
      // first live PTY byte after commit is strictly ordered after this snapshot. Legacy/no-checkpoint
      // sessions fall back to the bounded raw tail used before terminal checkpoints existed.
      let logStream: Readable;
      if (prepared.terminalCheckpoint) {
        pending.historyCursor = prepared.terminalCheckpoint.rawLogOffset;
        logStream = Readable.from(
          prepared.terminalCheckpoint.data ? [Buffer.from(prepared.terminalCheckpoint.data)] : [],
        );
      } else {
        const tail = await this.logs.readTail(prepared.logIdentifier, INITIAL_RESUME_LOG_BYTES);
        pending.historyCursor = tail.startOffset;
        logStream = Readable.from(tail.data.byteLength ? [Buffer.from(tail.data)] : []);
      }
      if (this.pending.get(newWorkspaceId) !== pending) {
        throw new Error('挂起恢复已被客户端关闭操作取消。');
      }
      return {
        workspaceId: newWorkspaceId,
        connectionId: session.connectionId,
        connectionName: session.connectionName,
        logStream,
        historyAvailable: pending.historyCursor > 0,
        ownershipGeneration: prepared.ownership.generation,
        ownershipLeaseExpiresAt: prepared.ownership.leaseExpiresAt,
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
        await this.suspended
          .rollbackResume(
            userId,
            suspendSessionId,
            pending.ownershipGeneration === undefined
              ? undefined
              : { ownerId: pending.ownerId, generation: pending.ownershipGeneration },
          )
          .catch(() => false);
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
    this.terminal.attach(workspaceId, pending.viewport ?? { columns: 80, rows: 24 });
    if (
      pending.ownershipGeneration === undefined ||
      !(await this.suspended.commitResume(pending.userId, pending.suspendSessionId, {
        ownerId: pending.ownerId,
        generation: pending.ownershipGeneration,
        workspaceId,
      }))
    ) {
      throw new Error('挂起恢复事务提交失败。');
    }
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
    this.createMark(
      workspaceId,
      pending.userId,
      pending.logIdentifier,
      undefined,
      pending.checkpoint,
      pending.viewport ?? { columns: 80, rows: 24 },
      {
        suspendSessionId: pending.suspendSessionId,
        ownerId: pending.ownerId,
        ownershipGeneration: pending.ownershipGeneration,
      },
    );
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

  async loadPreviousHistory(
    workspaceId: string,
    userId: number,
    maxBytes?: number,
  ): Promise<PreviousWorkspaceHistoryResult> {
    const session = this.workspaces.requireSession(workspaceId);
    if (session.userId !== userId) throw new Error('无权读取此会话的历史输出。');
    const history = this.resumedHistory.get(workspaceId);
    if (!history || history.userId !== userId || history.cursor <= 0) {
      return { data: new Uint8Array(), hasMore: false };
    }
    const requestedBytes =
      typeof maxBytes === 'number' && Number.isFinite(maxBytes) ? maxBytes : RESUME_HISTORY_PAGE_BYTES;
    const pageBytes = Math.max(4096, Math.min(RESUME_HISTORY_PAGE_BYTES, Math.floor(requestedBytes)));
    const page = await this.logs.readBefore(history.logIdentifier, history.cursor, pageBytes);
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
    return this.suspended.rollbackResume(
      pending.userId,
      pending.suspendSessionId,
      pending.ownershipGeneration === undefined
        ? undefined
        : { ownerId: pending.ownerId, generation: pending.ownershipGeneration },
    );
  }

  renewOwnership(workspaceId: string, userId: number, ownerId: string): { generation: number; leaseExpiresAt: number } {
    const mark = this.marks.get(workspaceId);
    if (
      !mark ||
      mark.userId !== userId ||
      !mark.suspendSessionId ||
      !mark.ownerId ||
      mark.ownerId !== ownerId ||
      mark.ownershipGeneration === undefined
    ) {
      throw new Error('SUSPENDED_SESSION_OWNER_STALE');
    }
    const renewed = this.suspended.renewOwnership(
      userId,
      mark.suspendSessionId,
      ownerId,
      mark.ownershipGeneration,
      workspaceId,
    );
    if (!renewed) throw new Error('SUSPENDED_SESSION_OWNER_STALE');
    return renewed;
  }

  async closeWorkspace(workspaceId: string): Promise<void> {
    const pendingResume = this.pending.has(workspaceId);
    const markedForSuspend = this.marks.has(workspaceId);
    const sessionExists = Boolean(this.workspaces.getSession(workspaceId));
    const context = { workspaceId, pendingResume, markedForSuspend, sessionExists };
    if (pendingResume || markedForSuspend) logger.info(context, 'Workspace close handoff started');
    else logger.debug(context, 'Workspace close handoff started');

    if (pendingResume) {
      const rolledBack = await this.rollbackResume(workspaceId);
      logger.info({ ...context, rolledBack }, 'Workspace close rolled back pending resume');
      return;
    }

    const result = await this.handleClientDisconnect(workspaceId);
    if (markedForSuspend || result.suspended)
      logger.info({ ...context, ...result }, 'Workspace close handoff completed');
    else logger.debug({ ...context, ...result }, 'Workspace close handoff completed');
  }

  async dispose(): Promise<void> {
    this.ownershipRevocationUnsubscribe();
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
      mark.checkpoint?.dispose();
      mark.checkpoint = undefined;
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

  private async handleOwnershipRevoked(event: SuspendedSessionOwnershipRevoked): Promise<void> {
    for (const [workspaceId, pending] of [...this.pending.entries()]) {
      if (
        pending.userId === event.userId &&
        pending.suspendSessionId === event.suspendSessionId &&
        pending.ownerId === event.ownerId &&
        pending.ownershipGeneration === event.generation
      ) {
        await this.rollbackResume(workspaceId).catch(() => false);
      }
    }
    for (const [workspaceId, mark] of [...this.marks.entries()]) {
      if (
        mark.userId === event.userId &&
        mark.suspendSessionId === event.suspendSessionId &&
        mark.ownerId === event.ownerId &&
        mark.ownershipGeneration === event.generation
      ) {
        await this.closeWorkspace(workspaceId).catch(() => undefined);
      }
    }
  }

  private createMark(
    workspaceId: string,
    userId: number,
    logIdentifier: string,
    initialBuffer?: string,
    checkpoint?: SuspendedTerminalCheckpoint,
    viewport: SuspendedTerminalViewport = { columns: 80, rows: 24 },
    ownership?: { suspendSessionId: string; ownerId: string; ownershipGeneration: number },
  ): SuspendMark {
    const ownedCheckpoint = checkpoint ?? this.checkpoints.create(initialBuffer, viewport);
    const initialWrite = initialBuffer
      ? this.logs.append(logIdentifier, initialBuffer).then(() => undefined)
      : Promise.resolve();
    const mark: SuspendMark = {
      userId,
      logIdentifier,
      ready: initialWrite.then(() => this.logs.flush(logIdentifier)),
      writeChain: initialWrite,
      checkpoint: ownedCheckpoint,
      ...(ownership ?? {}),
    };
    // Publish the transaction before awaiting I/O so disconnect cannot bypass suspend takeover.
    this.marks.set(workspaceId, mark);
    mark.stopOutput = this.events.subscribe(workspaceId, (event) => {
      if (this.marks.get(workspaceId) !== mark) return;
      if (event.type === 'terminal-output') {
        const data = event.data.slice();
        mark.writeChain = mark.writeChain
          .catch(() => undefined)
          .then(async () => {
            await this.logs.append(logIdentifier, data).catch(() => undefined);
            await mark.checkpoint?.write(data).catch(() => undefined);
          });
      } else if (event.type === 'terminal-resize') {
        mark.writeChain = mark.writeChain
          .catch(() => undefined)
          .then(() => mark.checkpoint?.resize({ columns: event.columns, rows: event.rows }) ?? Promise.resolve())
          .catch(() => undefined);
      }
    });
    return mark;
  }

  private async refreshMarkCheckpoint(
    mark: SuspendMark,
    snapshot: string,
    viewport: SuspendedTerminalViewport,
  ): Promise<void> {
    if (!mark.checkpoint) mark.checkpoint = this.checkpoints.create(undefined, viewport);
    const operation = mark.writeChain.catch(() => undefined).then(() => mark.checkpoint!.reset(snapshot, viewport));
    mark.writeChain = operation;
    await operation;
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
