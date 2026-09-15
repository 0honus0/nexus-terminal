import { randomUUID } from 'node:crypto';
import type { RemoteExecutionTransport, RemoteShellSession } from '../../platform/execution/remote-execution.port';
import type { SuspendedSessionLogStore } from './suspended-session-log.port';
import type { SuspendedTerminalCheckpoint, SuspendedTerminalViewport } from './suspended-terminal-checkpoint.port';
import type {
  PreparedResumeSession,
  ShellKind,
  SuspendedSessionInfo,
  SuspendedSessionStatus,
  SuspendedTerminalCheckpointView,
  SuspendTakeoverRequest,
} from './ssh-suspend.types';

const CHECKPOINT_INTERVAL_MS = 30_000;
const CHECKPOINT_OUTPUT_BYTES = 1024 * 1024;

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
  resumeInProgress: boolean;
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
  constructor(private readonly logs: SuspendedSessionLogStore) {}

  onAutoTerminated(listener: (event: SuspendedSessionAutoTermination) => void): () => void {
    this.autoTerminationListeners.add(listener);
    return () => this.autoTerminationListeners.delete(listener);
  }

  async takeOver(request: SuspendTakeoverRequest): Promise<string | null> {
    if (!request.transport.isOpen || !request.shell.isOpen) {
      request.checkpoint?.dispose();
      await request.transport.close().catch(() => undefined);
      return null;
    }
    const suspendSessionId = randomUUID();
    const now = Date.now();
    const record: SuspendedSessionRecord = {
      ...request,
      connectionId: request.connectionId,
      suspendStartTime: new Date(now).toISOString(),
      backendSshStatus: 'hanging',
      resumeInProgress: false,
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
    }));
  }
  listSuspendedSessions(userId: number) {
    return Promise.resolve(this.list(userId));
  }

  async prepareResume(
    userId: number,
    suspendSessionId: string,
    viewport?: SuspendedTerminalViewport,
  ): Promise<PreparedResumeSession | null> {
    const record = this.userSessions(userId).get(suspendSessionId);
    if (
      !record ||
      record.backendSshStatus !== 'hanging' ||
      record.resumeInProgress ||
      !record.transport.isOpen ||
      !record.shell.isOpen
    )
      return null;
    record.resumeInProgress = true;
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
      };
    } catch {
      record.resumeInProgress = false;
      this.attachListeners(suspendSessionId, record);
      record.shell.resume();
      return null;
    }
  }
  prepareResumeSession(userId: number, id: string) {
    return this.prepareResume(userId, id);
  }

  async commitResume(userId: number, id: string, preserveLog = false): Promise<boolean> {
    const map = this.userSessions(userId);
    const record = map.get(id);
    if (!record?.resumeInProgress) return false;
    map.delete(id);
    this.detachListeners(record);
    if (preserveLog) record.checkpoint = undefined;
    else {
      record.checkpoint?.dispose();
      record.checkpoint = undefined;
      await this.logs.delete(record.logIdentifier).catch(() => undefined);
    }
    return true;
  }
  commitResumeSession(userId: number, id: string) {
    return this.commitResume(userId, id);
  }

  async rollbackResume(userId: number, id: string): Promise<boolean> {
    const record = this.userSessions(userId).get(id);
    if (!record?.resumeInProgress) return false;
    record.resumeInProgress = false;
    if (!record.transport.isOpen || !record.shell.isOpen) {
      this.markDisconnected(id, record, 'SSH connection terminated while resume was being rolled back.');
      return true;
    }
    this.attachListeners(id, record);
    record.shell.resume();
    return true;
  }
  rollbackResumeSession(userId: number, id: string) {
    return this.rollbackResume(userId, id);
  }

  async terminate(userId: number, id: string): Promise<boolean> {
    const map = this.userSessions(userId);
    const record = map.get(id);
    if (!record) return false;
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
    const records = [...this.sessions.values()].flatMap((map) => [...map.values()]);
    this.sessions.clear();
    for (const record of records) {
      this.detachListeners(record);
      await record.outputChain.catch(() => undefined);
      record.checkpoint?.dispose();
      record.checkpoint = undefined;
      await record.transport.close().catch(() => undefined);
      await this.logs.flush(record.logIdentifier).catch(() => undefined);
    }
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
    if (record.backendSshStatus !== 'hanging' || record.resumeInProgress) return;
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
    const now = Date.now();
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
    record.disconnectionTimestamp = new Date().toISOString();
    record.resumeInProgress = false;
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
