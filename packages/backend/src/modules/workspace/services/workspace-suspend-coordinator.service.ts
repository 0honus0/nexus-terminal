import type { Readable } from 'node:stream';
import type { SshSuspendService } from '../../ssh-suspend/ssh-suspend.service';
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
}
interface PendingResume {
  userId: number;
  suspendSessionId: string;
  workspaceId: string;
  logIdentifier: string;
}

export interface BeginWorkspaceResumeResult {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
  logStream: Readable;
}

/**
 * Owns Workspace ↔ suspended-transport handoff. Interfaces participate only in the cached-output ACK
 * window between beginResume() and commitResume().
 */
export class WorkspaceSuspendCoordinatorService {
  private readonly marks = new Map<string, SuspendMark>();
  private readonly pending = new Map<string, PendingResume>();
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
    if (this.marks.has(workspaceId)) return;
    const logIdentifier = workspaceId;
    try {
      if (initialBuffer) await this.logs.append(logIdentifier, initialBuffer);
      await this.logs.flush(logIdentifier);
      this.marks.set(workspaceId, { userId, logIdentifier });
    } catch (error) {
      await this.logs.delete(logIdentifier).catch(() => undefined);
      throw error;
    }
  }
  async unmarkForSuspend(workspaceId: string, userId: number): Promise<void> {
    const mark = this.marks.get(workspaceId);
    if (!mark) return;
    if (mark.userId !== userId) throw new Error('无权取消此会话的挂起标记。');
    this.marks.delete(workspaceId);
    await this.logs.delete(mark.logIdentifier).catch(() => undefined);
  }
  isMarked(workspaceId: string): boolean {
    return this.marks.has(workspaceId);
  }

  async handleClientDisconnect(workspaceId: string): Promise<{ suspended: boolean; suspendSessionId?: string }> {
    const session = this.workspaces.getSession(workspaceId);
    if (!session) return { suspended: false };
    const mark = this.marks.get(workspaceId);
    await this.status.clearSession(workspaceId);
    await this.operations.cleanup(workspaceId);
    this.terminal.detach(workspaceId);
    if (!mark) {
      this.shellIntegration.clear(workspaceId);
      this.events.clear(workspaceId);
      await this.workspaces.closeSession(workspaceId);
      return { suspended: false };
    }
    this.marks.delete(workspaceId);
    const snapshot = this.shellIntegration.snapshot(workspaceId);
    this.shellIntegration.clear(workspaceId);
    this.events.clear(workspaceId);
    let detached;
    try {
      detached = this.workspaces.detach(workspaceId);
    } catch (error) {
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      throw error;
    }
    if (!detached) {
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
      await detached.transport.close().catch(() => undefined);
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
      return { suspended: false };
    }
    return { suspended: true, suspendSessionId };
  }

  async beginResume(
    userId: number,
    suspendSessionId: string,
    newWorkspaceId: string,
  ): Promise<BeginWorkspaceResumeResult> {
    if (this.pending.has(newWorkspaceId)) throw new Error(`Workspace resume ${newWorkspaceId} is already pending.`);
    const prepared = await this.suspended.prepareResume(userId, suspendSessionId);
    if (!prepared) throw new Error('服务未能恢复会话，或会话不存在/状态不正确。');
    let attached = false;
    try {
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
      this.terminal.attach(newWorkspaceId);
      const logStream = await this.logs.openRead(prepared.logIdentifier);
      this.pending.set(newWorkspaceId, {
        userId,
        suspendSessionId,
        workspaceId: newWorkspaceId,
        logIdentifier: prepared.logIdentifier,
      });
      return {
        workspaceId: newWorkspaceId,
        connectionId: session.connectionId,
        connectionName: session.connectionName,
        logStream,
      };
    } catch (error) {
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
      throw error;
    }
  }

  async commitResume(workspaceId: string): Promise<void> {
    const pending = this.pending.get(workspaceId);
    if (!pending) throw new Error(`No pending resume exists for ${workspaceId}.`);
    if (!(await this.suspended.commitResume(pending.userId, pending.suspendSessionId)))
      throw new Error('挂起恢复事务提交失败。');
    this.pending.delete(workspaceId);
    const session = this.workspaces.requireSession(workspaceId);
    session.shell.resume();
    await this.filesystem.initialize(workspaceId).catch(() => undefined);
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
      await this.logs.delete(mark.logIdentifier).catch(() => undefined);
    }
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
