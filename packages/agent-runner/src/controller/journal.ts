import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CommandRecord, JobRecord, WorkspaceJobResult, WorkspaceRecord } from '../types';
import { runnerLog } from '../logging';
import { PLUGIN_RUNNER_PROTOCOL_VERSION } from '../plugin-sdk.types';

interface JournalState {
  schemaVersion: 4;
  commands: Record<string, CommandRecord>;
  workspaces: Record<string, WorkspaceRecord>;
  jobs: Record<string, JobRecord>;
}

const empty = (): JournalState => ({ schemaVersion: 4, commands: {}, workspaces: {}, jobs: {} });
const TERMINAL_HISTORY_LIMIT = 4096;
const TERMINAL_HISTORY_MIN_AGE_SECONDS = 24 * 60 * 60;
const MAX_JOURNAL_COLLECTION_ITEMS = 16_384;
const JOURNAL_COLLECTION_HIGH_WATER = 12_288;
const MAX_JOURNAL_RECOVERY_COLLECTION_ITEMS = 32_768;
const MAX_JOURNAL_STRING_BYTES = 64 * 1024;
const MAX_WORKSPACE_JOB_OUTPUT_BYTES = 1024 * 1024;
const CORRUPT_EVIDENCE_LIMIT = 4;

type UnknownRecord = Record<string, unknown>;

const invalidJournal = (): never => {
  throw new Error('JOURNAL_STATE_INVALID');
};

const recordValue = (value: unknown): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidJournal();
  return value as UnknownRecord;
};

const stringValue = (value: unknown, nullable = false): string | null => {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_JOURNAL_STRING_BYTES) return invalidJournal();
  return value;
};

const jobOutputStringValue = (value: unknown): string => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_WORKSPACE_JOB_OUTPUT_BYTES) {
    return invalidJournal();
  }
  return value;
};

const integerValue = (value: unknown, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) return invalidJournal();
  return Number(value);
};

const booleanValue = (value: unknown): boolean => {
  if (typeof value !== 'boolean') return invalidJournal();
  return value;
};

const stringArrayValue = (value: unknown, maxItems: number): string[] => {
  if (!Array.isArray(value) || value.length > maxItems) return invalidJournal();
  return value.map((item) => stringValue(item) as string);
};

const decodeToolchain = (value: unknown): WorkspaceRecord['toolchain'] => {
  if (!Array.isArray(value) || value.length > 32) return invalidJournal();
  return value.map((item) => {
    const record = recordValue(item);
    return {
      familyId: stringValue(record.familyId) as string,
      versionId: stringValue(record.versionId) as string,
      contentDigest: stringValue(record.contentDigest) as string,
    };
  });
};

const decodeRunnerPlugins = (value: unknown): WorkspaceRecord['runnerPlugins'] => {
  if (!Array.isArray(value) || value.length > 128) return invalidJournal();
  return value.map((item) => {
    const record = recordValue(item);
    if (record.protocolVersion !== PLUGIN_RUNNER_PROTOCOL_VERSION) return invalidJournal();
    return {
      pluginId: stringValue(record.pluginId) as string,
      version: stringValue(record.version) as string,
      sdkVersion: stringValue(record.sdkVersion) as string,
      protocolVersion: PLUGIN_RUNNER_PROTOCOL_VERSION,
      packageHash: stringValue(record.packageHash) as string,
      entry: stringValue(record.entry) as string,
    };
  });
};

const decodeAcpProfiles = (value: unknown): WorkspaceRecord['acpProfiles'] => {
  if (!Array.isArray(value) || value.length > 64) return invalidJournal();
  return value.map((item) => {
    const record = recordValue(item);
    return {
      id: stringValue(record.id) as string,
      profileRevision: integerValue(record.profileRevision, 1),
      argv: stringArrayValue(record.argv, 128),
      cwd: stringValue(record.cwd) as string,
    };
  });
};

const decodeBrowserTarget = (value: unknown): WorkspaceRecord['browserTarget'] => {
  if (value === null) return null;
  const record = recordValue(value);
  if (!Array.isArray(record.endpoints) || record.endpoints.length > 32) return invalidJournal();
  return {
    id: stringValue(record.id) as string,
    profileRevision: integerValue(record.profileRevision, 1),
    endpoints: record.endpoints.map((item) => {
      const endpoint = recordValue(item);
      if (!['docker-network', 'external-network'].includes(String(endpoint.scope))) return invalidJournal();
      if (!['backend', 'runner'].includes(String(endpoint.via))) return invalidJournal();
      return {
        scope: endpoint.scope as 'docker-network' | 'external-network',
        via: endpoint.via as 'backend' | 'runner',
        url: stringValue(endpoint.url) as string,
        priority: integerValue(endpoint.priority),
        allowPlaintext: booleanValue(endpoint.allowPlaintext),
        verifyTls: booleanValue(endpoint.verifyTls),
      };
    }),
    allowedUrlPatterns: stringArrayValue(record.allowedUrlPatterns, 256),
  };
};

const decodeWorkspaceRecord = (value: unknown): WorkspaceRecord => {
  const record = recordValue(value);
  if (!['creating', 'ready', 'running', 'stopped', 'deleted', 'failed'].includes(String(record.status)))
    return invalidJournal();
  return {
    workspaceId: stringValue(record.workspaceId) as string,
    generation: integerValue(record.generation, 1),
    status: record.status as WorkspaceRecord['status'],
    retained: booleanValue(record.retained),
    toolchain: decodeToolchain(record.toolchain),
    runnerPlugins: decodeRunnerPlugins(record.runnerPlugins),
    acpProfiles: decodeAcpProfiles(record.acpProfiles),
    browserTarget: decodeBrowserTarget(record.browserTarget),
  };
};

const decodeCommandRecord = (value: unknown): CommandRecord => {
  const record = recordValue(value);
  if (!['pending', 'running', 'succeeded', 'failed', 'unknown'].includes(String(record.status)))
    return invalidJournal();
  return {
    commandId: stringValue(record.commandId) as string,
    payloadHash: stringValue(record.payloadHash) as string,
    status: record.status as CommandRecord['status'],
    action: stringValue(record.action) as string,
    workspaceId: stringValue(record.workspaceId, true),
    result: record.result ?? null,
    error: stringValue(record.error, true),
    createdAt: integerValue(record.createdAt),
    completedAt: record.completedAt === null ? null : integerValue(record.completedAt),
  };
};

const decodeJobResult = (value: unknown): WorkspaceJobResult => {
  const record = recordValue(value);
  return {
    exitCode: record.exitCode === null ? null : integerValue(record.exitCode),
    signal: stringValue(record.signal, true),
    stdout: jobOutputStringValue(record.stdout),
    stderr: jobOutputStringValue(record.stderr),
    truncated: booleanValue(record.truncated),
    timedOut: booleanValue(record.timedOut),
  };
};

const decodeJobRecord = (value: unknown): JobRecord => {
  const record = recordValue(value);
  if (!['pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled'].includes(String(record.status)))
    return invalidJournal();
  return {
    jobId: stringValue(record.jobId) as string,
    payloadHash: stringValue(record.payloadHash) as string,
    workspaceId: stringValue(record.workspaceId) as string,
    generation: integerValue(record.generation, 1),
    status: record.status as JobRecord['status'],
    result: record.result === null ? null : decodeJobResult(record.result),
    error: stringValue(record.error, true),
    createdAt: integerValue(record.createdAt),
    completedAt: record.completedAt === null ? null : integerValue(record.completedAt),
  };
};

const decodeRecordCollection = <T>(
  value: unknown,
  decode: (entry: unknown) => T,
  id: (entry: T) => string,
  maxItems = MAX_JOURNAL_COLLECTION_ITEMS,
): Record<string, T> => {
  const record = recordValue(value);
  const entries = Object.entries(record);
  if (entries.length > maxItems) return invalidJournal();
  const decoded: Record<string, T> = {};
  for (const [key, raw] of entries) {
    const entry = decode(raw);
    if (key !== id(entry)) return invalidJournal();
    decoded[key] = entry;
  }
  return decoded;
};

const decodeJournalState = (value: unknown): JournalState => {
  const record = recordValue(value);
  if (record.schemaVersion !== 4) throw new Error('JOURNAL_SCHEMA_UNSUPPORTED');
  return {
    schemaVersion: 4,
    commands: decodeRecordCollection(
      record.commands,
      decodeCommandRecord,
      (entry) => entry.commandId,
      MAX_JOURNAL_RECOVERY_COLLECTION_ITEMS,
    ),
    workspaces: decodeRecordCollection(record.workspaces, decodeWorkspaceRecord, (entry) => entry.workspaceId),
    jobs: decodeRecordCollection(
      record.jobs,
      decodeJobRecord,
      (entry) => entry.jobId,
      MAX_JOURNAL_RECOVERY_COLLECTION_ITEMS,
    ),
  };
};

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';

const fsyncFile = (filePath: string): void => {
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};

const fsyncDirectory = (directory: string): void => {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};

const corruptMarkerPath = (filePath: string): string => `${filePath}.corrupt-marker`;

const pruneCorruptEvidence = (filePath: string): void => {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.corrupt.`;
  let evidence: Array<{ path: string; mtimeMs: number }> = [];
  try {
    evidence = fs
      .readdirSync(directory)
      .filter((name) => name.startsWith(prefix))
      .map((name) => {
        const target = path.join(directory, name);
        return { path: target, mtimeMs: fs.statSync(target).mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch {
    return;
  }
  for (const stale of evidence.slice(CORRUPT_EVIDENCE_LIMIT)) {
    try {
      fs.rmSync(stale.path, { force: true });
    } catch {
      // Evidence retention is best-effort; never discard the newest preserved corruption.
    }
  }
};

export const payloadHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class RunnerJournal {
  private state: JournalState;
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(corruptMarkerPath(filePath))) throw new Error('RUNNER_JOURNAL_INVALID');
    try {
      this.state = decodeJournalState(JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown);
    } catch (error) {
      if (isMissingFile(error)) {
        this.state = empty();
        this.flush();
      } else if (error instanceof Error && error.message === 'JOURNAL_SCHEMA_UNSUPPORTED') {
        // Pre-release schema replacement is explicit: preserve the old journal before starting fresh.
        this.quarantineCurrent('schema-unsupported');
        this.state = empty();
        this.flush();
      } else {
        this.quarantineCurrent('corrupt');
        throw new Error('RUNNER_JOURNAL_INVALID');
      }
    }
    this.compact();
    if (
      Object.keys(this.state.commands).length > MAX_JOURNAL_COLLECTION_ITEMS ||
      Object.keys(this.state.jobs).length > MAX_JOURNAL_COLLECTION_ITEMS
    ) {
      this.quarantineCurrent('corrupt');
      throw new Error('RUNNER_JOURNAL_INVALID');
    }
  }

  command(id: string): CommandRecord | null {
    return this.state.commands[id] ?? null;
  }

  workspace(id: string): WorkspaceRecord | null {
    return this.state.workspaces[id] ?? null;
  }

  workspaces(): WorkspaceRecord[] {
    return Object.values(this.state.workspaces);
  }

  commands(): CommandRecord[] {
    return Object.values(this.state.commands);
  }

  job(id: string): JobRecord | null {
    return this.state.jobs[id] ?? null;
  }

  jobs(): JobRecord[] {
    return Object.values(this.state.jobs);
  }

  beginJob(jobId: string, hash: string, workspaceId: string, generation: number): JobRecord {
    const existing = this.state.jobs[jobId];
    if (existing) {
      if (existing.payloadHash !== hash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
      return existing;
    }
    this.ensureCollectionCapacity(this.state.jobs);
    const record: JobRecord = {
      jobId,
      payloadHash: hash,
      workspaceId,
      generation,
      status: 'pending',
      result: null,
      error: null,
      createdAt: Math.floor(Date.now() / 1000),
      completedAt: null,
    };
    this.state.jobs[jobId] = record;
    this.flush();
    return record;
  }

  runningJob(jobId: string): void {
    this.patchJob(jobId, { status: 'running' });
  }

  succeedJob(jobId: string, result: WorkspaceJobResult): void {
    if (
      Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8') >
      MAX_WORKSPACE_JOB_OUTPUT_BYTES
    ) {
      throw new Error('JOB_OUTPUT_LIMIT_INVALID');
    }
    this.patchJob(jobId, {
      status: 'succeeded',
      result,
      error: null,
      completedAt: Math.floor(Date.now() / 1000),
    });
  }

  failJob(jobId: string, error: string): void {
    this.patchJob(jobId, {
      status: 'failed',
      error: error.slice(0, 1024),
      completedAt: Math.floor(Date.now() / 1000),
    });
  }

  cancelJob(jobId: string, error = 'WORKSPACE_JOB_CANCELLED'): void {
    this.patchJob(jobId, {
      status: 'cancelled',
      error: error.slice(0, 1024),
      completedAt: Math.floor(Date.now() / 1000),
    });
  }

  unknownJob(jobId: string, error: string): void {
    this.patchJob(jobId, {
      status: 'unknown',
      error: error.slice(0, 1024),
      completedAt: Math.floor(Date.now() / 1000),
    });
  }

  begin(commandId: string, hash: string, action: string, workspaceId: string | null): CommandRecord {
    const existing = this.state.commands[commandId];
    if (existing) {
      if (existing.payloadHash !== hash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
      return existing;
    }
    this.ensureCollectionCapacity(this.state.commands);
    const now = Math.floor(Date.now() / 1000);
    const record: CommandRecord = {
      commandId,
      payloadHash: hash,
      status: 'pending',
      action,
      workspaceId,
      result: null,
      error: null,
      createdAt: now,
      completedAt: null,
    };
    this.state.commands[commandId] = record;
    this.flush();
    return record;
  }

  running(commandId: string): void {
    this.patchCommand(commandId, { status: 'running' });
  }

  succeed(commandId: string, result: unknown): void {
    this.patchCommand(commandId, {
      status: 'succeeded',
      result,
      error: null,
      completedAt: Math.floor(Date.now() / 1000),
    });
  }

  fail(commandId: string, error: string): void {
    this.patchCommand(commandId, {
      status: 'failed',
      error: error.slice(0, 1024),
      completedAt: Math.floor(Date.now() / 1000),
    });
  }

  unknown(commandId: string, error: string): void {
    this.patchCommand(commandId, {
      status: 'unknown',
      error: error.slice(0, 1024),
      completedAt: Math.floor(Date.now() / 1000),
    });
  }

  saveWorkspace(record: WorkspaceRecord): void {
    this.state.workspaces[record.workspaceId] = record;
    this.flush();
  }

  deleteWorkspace(id: string): void {
    delete this.state.workspaces[id];
    this.flush();
  }

  compact(now = Math.floor(Date.now() / 1000)): void {
    const prune = <T extends { status: string; completedAt: number | null; createdAt: number }>(
      values: Record<string, T>,
      terminalStatuses: ReadonlySet<string>,
    ): void => {
      const terminal = Object.entries(values)
        .filter(([, value]) => terminalStatuses.has(value.status) && value.completedAt !== null)
        .sort((a, b) => b[1].completedAt! - a[1].completedAt!);
      for (const [id, value] of terminal.slice(TERMINAL_HISTORY_LIMIT)) {
        if (value.completedAt! <= now - TERMINAL_HISTORY_MIN_AGE_SECONDS) delete values[id];
      }
      let remaining = Object.keys(values).length;
      if (remaining <= JOURNAL_COLLECTION_HIGH_WATER) return;
      const oldestTerminal = [...terminal].reverse();
      for (const [id] of oldestTerminal) {
        if (!(id in values)) continue;
        if (remaining <= JOURNAL_COLLECTION_HIGH_WATER) break;
        delete values[id];
        remaining -= 1;
      }
    };
    const commandCount = Object.keys(this.state.commands).length;
    const jobCount = Object.keys(this.state.jobs).length;
    prune(this.state.commands, new Set(['succeeded', 'failed', 'unknown']));
    prune(this.state.jobs, new Set(['succeeded', 'failed', 'cancelled', 'unknown']));
    const nextCommandCount = Object.keys(this.state.commands).length;
    const nextJobCount = Object.keys(this.state.jobs).length;
    if (commandCount !== nextCommandCount || jobCount !== nextJobCount) {
      this.flush();
      runnerLog('debug', 'Agent Runner journal compacted', {
        prunedCommandCount: commandCount - nextCommandCount,
        prunedJobCount: jobCount - nextJobCount,
        remainingCommandCount: nextCommandCount,
        remainingJobCount: nextJobCount,
      });
    }
  }

  private ensureCollectionCapacity<T extends { status: string; completedAt: number | null; createdAt: number }>(
    values: Record<string, T>,
  ): void {
    if (Object.keys(values).length < MAX_JOURNAL_COLLECTION_ITEMS) return;
    this.compact();
    if (Object.keys(values).length >= MAX_JOURNAL_COLLECTION_ITEMS) {
      throw new Error('RUNNER_JOURNAL_CAPACITY_EXCEEDED');
    }
  }

  private quarantineCurrent(reason: 'schema-unsupported' | 'corrupt'): void {
    if (!fs.existsSync(this.filePath)) return;
    const target = `${this.filePath}.${reason}.${Date.now()}-${process.pid}-${process.hrtime.bigint()}`;
    fs.renameSync(this.filePath, target);
    if (reason === 'corrupt') {
      fsyncFile(target);
      const marker = corruptMarkerPath(this.filePath);
      fs.writeFileSync(
        marker,
        `${JSON.stringify({ schemaVersion: 1, evidenceFile: path.basename(target), recordedAt: Math.floor(Date.now() / 1000) })}\n`,
        { mode: 0o600, flag: 'wx' },
      );
      fsyncFile(marker);
      pruneCorruptEvidence(this.filePath);
    }
    fsyncDirectory(path.dirname(this.filePath));
    runnerLog(reason === 'corrupt' ? 'error' : 'warn', 'Agent Runner journal evidence preserved', {
      reason,
      evidenceFile: path.basename(target),
    });
  }

  private patchJob(id: string, patch: Partial<JobRecord>): void {
    const current = this.state.jobs[id];
    if (!current) throw new Error('JOB_NOT_FOUND');
    this.state.jobs[id] = { ...current, ...patch };
    this.flush();
  }

  private patchCommand(id: string, patch: Partial<CommandRecord>): void {
    const current = this.state.commands[id];
    if (!current) throw new Error('COMMAND_NOT_FOUND');
    this.state.commands[id] = { ...current, ...patch };
    this.flush();
  }

  private flush(): void {
    const temp = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 });
      fsyncFile(temp);
      fs.renameSync(temp, this.filePath);
      fsyncDirectory(path.dirname(this.filePath));
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
  }
}
