import { randomUUID } from 'node:crypto';
import type { RemoteExecutionTransport, RemoteShellSession } from '../../platform/execution/remote-execution.port';
import type { SuspendedSessionLogStore } from './suspended-session-log.port';
import type { SuspendedTerminalCheckpoint, SuspendedTerminalViewport } from './suspended-terminal-checkpoint.port';
import type {
  PreparedResumeSession,
  ShellKind,
  SuspendedSessionInfo,
  SuspendedSessionOwnershipRevoked,
  SuspendedSessionOwnershipState,
  SuspendedSessionStatus,
  SuspendedTerminalCheckpointView,
  SuspendResumeOwnershipRequest,
  SuspendTakeoverRequest,
} from './ssh-suspend.types';

const CHECKPOINT_INTERVAL_MS = 30_000;
const CHECKPOINT_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_OWNER_LEASE_MS = 45_000;
const DEFAULT_OWNER_SWEEP_MS = 2_000;
const DEFAULT_TAKEOVER_WAIT_MS = 8_000;

export interface SshSuspendServiceOptions {
  now?: () => number;
  ownerLeaseMs?: number;
  ownerSweepMs?: number;
  takeoverWaitMs?: number;
}

interface SuspendedSessionRecord {
  userId: number;
  originalSessionId: string;
  connectionName: string;
  connectionId: number;
  logIdentifier: string;
  transport: RemoteExecutionTransport;
  shell: RemoteShellSession;
  checkpoint?: SuspendedTerminalCheckpoint;
  latestCheckpoint?: SuspendedTerminalCheckpointView;
  checkpointRevision: number;
  checkpointBytes: number;
  checkpointAt: number;
  outputChain: Promise<void>;
  customSuspendName?: string;
  suspendStartTime: string;
  backendSshStatus: SuspendedSessionStatus;
  disconnectionTimestamp?: string;
  ownershipState: SuspendedSessionOwnershipState;
  ownershipGeneration: number;
  ownerId?: string;
  ownershipLeaseExpiresAt?: number;
  attachedWorkspaceId?: string;
  revokeRequested: boolean;
  shellPid?: number;
  shellKind?: ShellKind;
  shellIntegrationReady?: boolean;
  shellAtPrompt?: boolean;
  unsubscribe: Array<() => void>;
}

export interface SuspendedSessionAutoTermination {
  userId: number;
  suspendSessionId: string;
  reason: string;
}

/**
 * Owns detached execution transports while a workspace is suspended. It never knows ssh2 types.
 * Resume is a two-phase handoff so an interface can bind the replacement workspace before commit.
 */
export class SshSuspendService {
  private readonly sessions = new Map<number, Map<string, SuspendedSessionRecord>>();
  private readonly autoTerminationListeners = new Set<(event: SuspendedSessionAutoTermination) => void>();
  private readonly ownershipRevokedListeners = new Set<(event: SuspendedSessionOwnershipRevoked) => void>();
  private readonly availabilityWaiters = new Map<string, Set<() => void>>();
  private readonly now: () => number;
  private readonly ownerLeaseMs: number;
  private readonly takeoverWaitMs: number;
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly logs: SuspendedSessionLogStore,
    options: SshSuspendServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ownerLeaseMs = options.ownerLeaseMs ?? DEFAULT_OWNER_LEASE_MS;
    this.takeoverWaitMs = options.takeoverWaitMs ?? DEFAULT_TAKEOVER_WAIT_MS;
    const sweepMs = options.ownerSweepMs ?? DEFAULT_OWNER_SWEEP_MS;
    this.sweepTimer = setInterval(() => this.sweepExpiredOwnership(), sweepMs);
    this.sweepTimer.unref?.();
  }

  onAutoTerminated(listener: (event: SuspendedSessionAutoTermination) => void): () => void {
    this.autoTerminationListeners.add(listener);
    return () => this.autoTerminationListeners.delete(listener);
  }

  onOwnershipRevoked(listener: (event: SuspendedSessionOwnershipRevoked) => void): () => void {
    this.ownershipRevokedListeners.add(listener);
    return () => this.ownershipRevokedListeners.delete(listener);
  }

  async takeOver(request: SuspendTakeoverRequest): Promise<string | null> {
    if (!request.transport.isOpen || !request.shell.isOpen) {
      request.checkpoint?.dispose();
      await request.transport.close().catch(() => undefined);
      return null;
    }
    const suspendSessionId = randomUUID();
    const now = this.now();
    const record: SuspendedSessionRecord = {
      ...request,
      connectionId: request.connectionId,
      suspendStartTime: new Date(now).toISOString(),
      backendSshStatus: 'hanging',
      ownershipState: 'available',
      ownershipGeneration: 0,
      revokeRequested: false,
      checkpointRevision: 0,
      checkpointBytes: 0,
      checkpointAt: now,
      outputChain: Promise.resolve(),
      unsubscribe: [],
    };
    try {
      await this.logs.flush(record.logIdentifier);
      const offset = await this.logs.position(record.logIdentifier);
      await this.refreshCheckpoint(record, offset, true).catch(() => undefined);
    } catch {
      // Raw history/checkpoint are recovery aids. A healthy SSH transport remains suspendable.
    }
    this.userSessions(request.userId).set(suspendSessionId, record);
    this.attachListeners(suspendSessionId, record);
    return suspendSessionId;
  }

  list(userId: number): SuspendedSessionInfo[] {
    return [...this.userSessions(userId).entries()].map(([id, s]) => ({
      suspendSessionId: id,
      originalSessionId: s.originalSessionId,
      connectionName: s.connectionName,
      connectionId: String(s.connectionId),
      suspendStartTime: s.suspendStartTime,
      customSuspendName: s.customSuspendName,
      backendSshStatus: s.backendSshStatus,
      disconnectionTimestamp: s.disconnectionTimestamp,
      ownershipState: s.ownershipState,
      ownershipGeneration: s.ownershipGeneration,
      ownershipLeaseExpiresAt: s.ownershipLeaseExpiresAt,
      attachedWorkspaceId: s.attachedWorkspaceId,
    }));
  }
  listSuspendedSessions(userId: number) {
    return Promise.resolve(this.list(userId));
  }

  async prepareResume(
    userId: number,
    suspendSessionId: string,
    viewport: SuspendedTerminalViewport | undefined,
    ownership: SuspendResumeOwnershipRequest,
  ): Promise<PreparedResumeSession | null> {
    const ownerId = ownership.ownerId.trim();
    if (!ownerId || ownerId.length > 128) throw new Error('SUSPENDED_SESSION_OWNER_INVALID');
    let record: SuspendedSessionRecord | null | undefined = this.userSessions(userId).get(suspendSessionId);
    if (!record || record.backendSshStatus !== 'hanging' || !record.transport.isOpen || !record.shell.isOpen) {
      return null;
    }
    record = await this.acquireForResume(userId, suspendSessionId, ownerId, Boolean(ownership.takeover));
    if (!record) return null;
    record.shell.pause();
    this.detachListeners(record);
    try {
      await record.outputChain.catch(() => undefined);
      if (viewport) {
        record.shell.resize(viewport.columns, viewport.rows);
        await record.checkpoint?.resize(viewport);
      }
      await this.logs.flush(record.logIdentifier);
      const offset = await this.logs.position(record.logIdentifier);
      const terminalCheckpoint = await this.refreshCheckpoint(record, offset, true).catch(() => undefined);
      return {
        transport: record.transport,
        shell: record.shell,
        logIdentifier: record.logIdentifier,
        connectionName: record.connectionName,
        originalConnectionId: record.connectionId,
        checkpoint: record.checkpoint,
        terminalCheckpoint,
        viewport: terminalCheckpoint
          ? { columns: terminalCheckpoint.columns, rows: terminalCheckpoint.rows }
          : viewport,
        shellPid: record.shellPid,
        shellKind: record.shellKind,
        shellIntegrationReady: record.shellIntegrationReady,
        shellAtPrompt: record.shellAtPrompt,
        ownership: {
          ownerId,
          generation: record.ownershipGeneration,
          leaseExpiresAt: record.ownershipLeaseExpiresAt!,
        },
      };
    } catch {
      this.releaseToAvailable(suspendSessionId, record);
      if (record.transport.isOpen && record.shell.isOpen) {
        this.attachListeners(suspendSessionId, record);
        record.shell.resume();
      }
      return null;
    }
  }

  async commitResume(
    userId: number,
    id: string,
    ownership: { ownerId: string; generation: number; workspaceId: string },
  ): Promise<boolean> {
    const record = this.userSessions(userId).get(id);
    if (!record || record.ownershipState !== 'resuming') return false;
    if (
      record.ownerId !== ownership.ownerId ||
      record.ownershipGeneration !== ownership.generation ||
      record.revokeRequested
    ) {
      return false;
    }
    if (record.ownershipLeaseExpiresAt === undefined || record.ownershipLeaseExpiresAt <= this.now()) {
      this.requestRevoke(userId, id, record, 'lease_expired');
      return false;
    }
    this.detachListeners(record);
    record.ownershipState = 'attached';
    record.attachedWorkspaceId = ownership.workspaceId;
    record.ownershipLeaseExpiresAt = this.now() + this.ownerLeaseMs;
    record.revokeRequested = false;
    return true;
  }

  async rollbackResume(
    userId: number,
    id: string,
    ownership?: { ownerId: string; generation: number },
  ): Promise<boolean> {
    const record = this.userSessions(userId).get(id);
    if (!record || record.ownershipState !== 'resuming') return false;
    if (ownership && (record.ownerId !== ownership.ownerId || record.ownershipGeneration !== ownership.generation)) {
      return false;
    }
    this.releaseToAvailable(id, record);
    if (!record.transport.isOpen || !record.shell.isOpen) {
      this.markDisconnected(id, record, 'SSH connection terminated while resume was being rolled back.');
      return true;
    }
    this.attachListeners(id, record);
    record.shell.resume();
    return true;
  }

  renewOwnership(
    userId: number,
    id: string,
    ownerId: string,
    generation: number,
    workspaceId: string,
  ): { generation: number; leaseExpiresAt: number } | null {
    const record = this.userSessions(userId).get(id);
    if (
      !record ||
      record.ownershipState !== 'attached' ||
      record.ownerId !== ownerId ||
      record.ownershipGeneration !== generation ||
      record.attachedWorkspaceId !== workspaceId ||
      record.revokeRequested
    ) {
      return null;
    }
    if (record.ownershipLeaseExpiresAt === undefined || record.ownershipLeaseExpiresAt <= this.now()) {
      this.requestRevoke(userId, id, record, 'lease_expired');
      return null;
    }
    record.ownershipLeaseExpiresAt = this.now() + this.ownerLeaseMs;
    return { generation: record.ownershipGeneration, leaseExpiresAt: record.ownershipLeaseExpiresAt };
  }

  returnAttached(
    userId: number,
    id: string,
    ownership: {
      ownerId: string;
      generation: number;
      workspaceId: string;
      transport: RemoteExecutionTransport;
      shell: RemoteShellSession;
      checkpoint?: SuspendedTerminalCheckpoint;
      shellPid?: number;
      shellKind?: ShellKind;
      shellIntegrationReady?: boolean;
      shellAtPrompt?: boolean;
    },
  ): boolean {
    const record = this.userSessions(userId).get(id);
    if (
      !record ||
      record.ownershipState !== 'attached' ||
      record.ownerId !== ownership.ownerId ||
      record.ownershipGeneration !== ownership.generation ||
      record.attachedWorkspaceId !== ownership.workspaceId
    ) {
      return false;
    }
    record.transport = ownership.transport;
    record.shell = ownership.shell;
    record.checkpoint = ownership.checkpoint ?? record.checkpoint;
    record.shellPid = ownership.shellPid;
    record.shellKind = ownership.shellKind;
    record.shellIntegrationReady = ownership.shellIntegrationReady;
    record.shellAtPrompt = ownership.shellAtPrompt;
    record.originalSessionId = ownership.workspaceId;
    this.releaseToAvailable(id, record);
    if (!record.transport.isOpen || !record.shell.isOpen) {
      this.markDisconnected(id, record, 'SSH connection terminated while returning attached ownership.');
      return true;
    }
    this.attachListeners(id, record);
    return true;
  }

  forgetAttached(
    userId: number,
    id: string,
    ownership: { ownerId: string; generation: number; workspaceId: string },
  ): boolean {
    const map = this.userSessions(userId);
    const record = map.get(id);
    if (
      !record ||
      record.ownershipState !== 'attached' ||
      record.ownerId !== ownership.ownerId ||
      record.ownershipGeneration !== ownership.generation ||
      record.attachedWorkspaceId !== ownership.workspaceId ||
      record.revokeRequested ||
      record.ownershipLeaseExpiresAt === undefined ||
      record.ownershipLeaseExpiresAt <= this.now()
    ) {
      return false;
    }
    this.releaseToAvailable(id, record);
    map.delete(id);
    this.detachListeners(record);
    // The live Workspace keeps transport/shell/checkpoint ownership. Removing the resumable
    // catalog record must never close the SSH transport or dispose resources still used by it.
    record.checkpoint = undefined;
    return true;
  }

  sweepExpiredOwnership(now = this.now()): number {
    let expired = 0;
    for (const [userId, sessions] of this.sessions) {
      for (const [id, record] of sessions) {
        if (
          record.ownershipState === 'available' ||
          record.ownershipLeaseExpiresAt === undefined ||
          record.ownershipLeaseExpiresAt > now ||
          record.revokeRequested ||
          !record.ownerId
        ) {
          continue;
        }
        expired += 1;
        this.requestRevoke(userId, id, record, 'lease_expired');
      }
    }
    return expired;
  }

  async terminate(userId: number, id: string): Promise<boolean> {
    const map = this.userSessions(userId);
    const record = map.get(id);
    if (!record) return false;
    this.releaseToAvailable(id, record);
    this.detachListeners(record);
    map.delete(id);
    await record.outputChain.catch(() => undefined);
    record.checkpoint?.dispose();
    record.checkpoint = undefined;
    if (record.backendSshStatus === 'hanging') await record.transport.close().catch(() => undefined);
    await this.logs.delete(record.logIdentifier).catch(() => undefined);
    return true;
  }
  terminateSuspendedSession(userId: number, id: string) {
    return this.terminate(userId, id);
  }

  async removeDisconnected(userId: number, id: string): Promise<boolean> {
    const map = this.userSessions(userId);
    const record = map.get(id);
    if (!record || record.backendSshStatus === 'hanging') return false;
    map.delete(id);
    this.detachListeners(record);
    await record.outputChain.catch(() => undefined);
    record.checkpoint?.dispose();
    record.checkpoint = undefined;
    await this.logs.delete(record.logIdentifier).catch(() => undefined);
    return true;
  }
  removeDisconnectedSessionEntry(userId: number, id: string) {
    return this.removeDisconnected(userId, id);
  }

  rename(userId: number, id: string, name: string): boolean {
    const record = this.userSessions(userId).get(id);
    if (!record) return false;
    const trimmed = name.trim();
    if (trimmed.length > 128) throw new Error('挂起会话名称不能超过 128 个字符。');
    record.customSuspendName = trimmed || undefined;
    return true;
  }
  editSuspendedSessionName(userId: number, id: string, name: string) {
    return Promise.resolve(this.rename(userId, id, name));
  }

  handleUnexpectedDisconnection(userId: number, id: string): void {
    const record = this.userSessions(userId).get(id);
    if (record && record.backendSshStatus === 'hanging')
      this.markDisconnected(id, record, 'Unexpected disconnection handled by SshSuspendService.');
  }

  async getSessionLogStream(userId: number, id: string) {
    const record = this.userSessions(userId).get(id);
    if (!record || !['hanging', 'disconnected_by_backend'].includes(record.backendSshStatus)) return null;
    try {
      await record.outputChain.catch(() => undefined);
      await this.logs.flush(record.logIdentifier);
      const base = record.customSuspendName || record.connectionName || id.slice(0, 8);
      const safe = base.replace(/[^\w.-]/g, '_');
      const timestamp = new Date(record.suspendStartTime).toISOString().replace(/[:.]/g, '-');
      return {
        stream: await this.logs.openRead(record.logIdentifier),
        filename: `ssh_log_${safe}_${record.logIdentifier}_${timestamp}.log`,
      };
    } catch {
      return null;
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.sweepTimer);
    const records = [...this.sessions.values()].flatMap((map) => [...map.values()]);
    this.sessions.clear();
    this.availabilityWaiters.clear();
    this.ownershipRevokedListeners.clear();
    for (const record of records) {
      this.detachListeners(record);
      await record.outputChain.catch(() => undefined);
      record.checkpoint?.dispose();
      record.checkpoint = undefined;
      await record.transport.close().catch(() => undefined);
      await this.logs.flush(record.logIdentifier).catch(() => undefined);
    }
  }

  private async acquireForResume(
    userId: number,
    id: string,
    ownerId: string,
    takeover: boolean,
  ): Promise<SuspendedSessionRecord | null> {
    let record = this.userSessions(userId).get(id);
    if (!record || record.backendSshStatus !== 'hanging') return null;
    if (record.ownershipState !== 'available') {
      if (!takeover) throw new Error('SUSPENDED_SESSION_OWNED');
      this.requestRevoke(userId, id, record, 'takeover');
      if (!(await this.waitForAvailable(userId, id))) throw new Error('SUSPENDED_SESSION_TAKEOVER_TIMEOUT');
      record = this.userSessions(userId).get(id);
      if (!record || record.backendSshStatus !== 'hanging' || record.ownershipState !== 'available') return null;
    }
    record.ownershipState = 'resuming';
    record.ownershipGeneration += 1;
    record.ownerId = ownerId;
    record.ownershipLeaseExpiresAt = this.now() + this.ownerLeaseMs;
    record.attachedWorkspaceId = undefined;
    record.revokeRequested = false;
    return record;
  }

  private requestRevoke(
    userId: number,
    id: string,
    record: SuspendedSessionRecord,
    reason: SuspendedSessionOwnershipRevoked['reason'],
  ): void {
    if (record.revokeRequested || !record.ownerId || record.ownershipState === 'available') return;
    record.revokeRequested = true;
    const event: SuspendedSessionOwnershipRevoked = {
      userId,
      suspendSessionId: id,
      ownerId: record.ownerId,
      generation: record.ownershipGeneration,
      reason,
    };
    for (const listener of this.ownershipRevokedListeners) {
      try {
        listener(event);
      } catch {
        /* observers are isolated */
      }
    }
  }

  private waitForAvailable(userId: number, id: string): Promise<boolean> {
    const current = this.userSessions(userId).get(id);
    if (current?.ownershipState === 'available') return Promise.resolve(true);
    const key = this.availabilityKey(userId, id);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const waiters = this.availabilityWaiters.get(key);
        waiters?.delete(onAvailable);
        if (waiters && waiters.size === 0) this.availabilityWaiters.delete(key);
        resolve(value);
      };
      const onAvailable = () => finish(true);
      const waiters = this.availabilityWaiters.get(key) ?? new Set<() => void>();
      waiters.add(onAvailable);
      this.availabilityWaiters.set(key, waiters);
      const timer = setTimeout(() => finish(false), this.takeoverWaitMs);
      timer.unref?.();
    });
  }

  private releaseToAvailable(id: string, record: SuspendedSessionRecord): void {
    record.ownershipState = 'available';
    record.ownerId = undefined;
    record.ownershipLeaseExpiresAt = undefined;
    record.attachedWorkspaceId = undefined;
    record.revokeRequested = false;
    const key = this.availabilityKey(record.userId, id);
    const waiters = this.availabilityWaiters.get(key);
    if (!waiters) return;
    this.availabilityWaiters.delete(key);
    for (const notify of waiters) {
      try {
        notify();
      } catch {
        /* waiter isolation */
      }
    }
  }

  private availabilityKey(userId: number, id: string): string {
    return `${userId}:${id}`;
  }

  private attachListeners(id: string, record: SuspendedSessionRecord): void {
    this.detachListeners(record);
    record.unsubscribe.push(
      record.shell.onData((data) => this.queueOutput(record, data)),
      record.shell.onStderr((data) => this.queueOutput(record, data)),
      record.shell.onClose(() => this.markDisconnected(id, record, 'SSH shell closed.')),
      record.shell.onError(() => this.markDisconnected(id, record, 'SSH shell errored.')),
      record.transport.onClose(() => this.markDisconnected(id, record, 'SSH transport closed.')),
      record.transport.onError(() => this.markDisconnected(id, record, 'SSH transport errored.')),
    );
  }

  private queueOutput(record: SuspendedSessionRecord, data: Uint8Array): void {
    if (record.backendSshStatus !== 'hanging' || record.ownershipState !== 'available') return;
    const copy = data.slice();
    record.outputChain = record.outputChain
      .catch(() => undefined)
      .then(() => this.appendOutput(record, copy))
      .catch(() => undefined);
  }

  private async appendOutput(record: SuspendedSessionRecord, data: Uint8Array): Promise<void> {
    let offset: number | undefined;
    try {
      offset = await this.logs.append(record.logIdentifier, data);
    } catch {
      // Keep the VT state current even if retained history storage has a transient failure.
    }
    if (!record.checkpoint) return;
    await record.checkpoint.write(data);
    record.checkpointBytes += data.byteLength;
    if (offset !== undefined) await this.refreshCheckpoint(record, offset, false).catch(() => undefined);
  }

  private async refreshCheckpoint(
    record: SuspendedSessionRecord,
    rawLogOffset: number,
    force: boolean,
  ): Promise<SuspendedTerminalCheckpointView | undefined> {
    if (!record.checkpoint) return undefined;
    const now = this.now();
    if (
      !force &&
      record.latestCheckpoint &&
      record.checkpointBytes < CHECKPOINT_OUTPUT_BYTES &&
      now - record.checkpointAt < CHECKPOINT_INTERVAL_MS
    ) {
      return record.latestCheckpoint;
    }
    const snapshot = await record.checkpoint.snapshot();
    const latest: SuspendedTerminalCheckpointView = {
      ...snapshot,
      rawLogOffset,
      revision: ++record.checkpointRevision,
      createdAt: now,
    };
    record.latestCheckpoint = latest;
    record.checkpointBytes = 0;
    record.checkpointAt = now;
    return latest;
  }

  private detachListeners(record: SuspendedSessionRecord): void {
    for (const off of record.unsubscribe.splice(0))
      try {
        off();
      } catch {
        /* best effort */
      }
  }
  private markDisconnected(id: string, record: SuspendedSessionRecord, reason: string): void {
    if (record.backendSshStatus !== 'hanging') return;
    record.backendSshStatus = 'disconnected_by_backend';
    record.disconnectionTimestamp = new Date(this.now()).toISOString();
    this.releaseToAvailable(id, record);
    this.detachListeners(record);
    for (const listener of this.autoTerminationListeners)
      try {
        listener({ userId: record.userId, suspendSessionId: id, reason });
      } catch {
        /* observers are isolated */
      }
  }
  private userSessions(userId: number): Map<string, SuspendedSessionRecord> {
    let map = this.sessions.get(userId);
    if (!map) {
      map = new Map();
      this.sessions.set(userId, map);
    }
    return map;
  }
}
