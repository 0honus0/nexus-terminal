import type { WorkspaceJobResult } from '@nexus-terminal/protocol/runner';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CommandRecord, JobRecord, WorkspaceRecord } from '../types';
import { runnerLog } from '../logging';
import { PLUGIN_RUNNER_PROTOCOL_VERSION } from '../plugin-sdk.types';

interface JournalState {
  schemaVersion: 5;
  commands: Record<string, CommandRecord>;
  workspaces: Record<string, WorkspaceRecord>;
  jobs: Record<string, JobRecord>;
}

const empty = (): JournalState => ({ schemaVersion: 5, commands: {}, workspaces: {}, jobs: {} });
const TERMINAL_HISTORY_LIMIT = 4096;
const TERMINAL_HISTORY_MIN_AGE_SECONDS = 24 * 60 * 60;
const MAX_JOURNAL_COLLECTION_ITEMS = 16_384;
const JOURNAL_COLLECTION_HIGH_WATER = 12_288;
const MAX_JOURNAL_RECOVERY_COLLECTION_ITEMS = 32_768;
const MAX_JOURNAL_STRING_BYTES = 64 * 1024;
const MAX_WORKSPACE_JOB_OUTPUT_BYTES = 1024 * 1024;

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
  if ('acpProfiles' in record) return invalidJournal();
  if (!['creating', 'ready', 'running', 'stopped', 'deleted', 'failed'].includes(String(record.status)))
    return invalidJournal();
  return {
    workspaceId: stringValue(record.workspaceId) as string,
    generation: integerValue(record.generation, 1),
    status: record.status as WorkspaceRecord['status'],
    retained: booleanValue(record.retained),
    toolchain: decodeToolchain(record.toolchain),
    runnerPlugins: decodeRunnerPlugins(record.runnerPlugins),
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
  if (record.schemaVersion !== 5) throw new Error('JOURNAL_SCHEMA_UNSUPPORTED');
  return {
    schemaVersion: 5,
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

const corruptMarkerPath = (filePath: string): string => `${filePath}.corrupt-marker`;

export const payloadHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class RunnerJournal {
  private state: JournalState;
  private readonly database: DatabaseSync;
  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(corruptMarkerPath(filePath))) throw new Error('RUNNER_JOURNAL_INVALID');
    const existing = fs.existsSync(filePath);
    if (existing) {
      const fd = fs.openSync(filePath, 'r');
      const header = Buffer.alloc(16);
      try {
        fs.readSync(fd, header, 0, 16, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (header.toString() !== 'SQLite format 3\0') throw new Error('RUNNER_JOURNAL_FORMAT_UNSUPPORTED');
    } else {
      fs.closeSync(fs.openSync(filePath, 'wx', 0o600));
    }
    this.database = new DatabaseSync(filePath);
    try {
      const version = this.database.prepare('PRAGMA user_version').get();
      if (existing && version?.user_version !== 5) throw new Error('JOURNAL_SCHEMA_UNSUPPORTED');
      if (this.database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') invalidJournal();
      const raw = empty();
      const counts = { commands: 0, jobs: 0, workspaces: 0 };
      const records = existing ? this.database.prepare('SELECT kind,id,payload FROM journal_records').iterate() : [];
      for (const row of records) {
        if (
          typeof row.kind !== 'string' ||
          !['commands', 'jobs', 'workspaces'].includes(row.kind) ||
          typeof row.id !== 'string' ||
          typeof row.payload !== 'string'
        )
          invalidJournal();
        const kind = row.kind as keyof Pick<JournalState, 'commands' | 'jobs' | 'workspaces'>;
        if (++counts[kind] > MAX_JOURNAL_RECOVERY_COLLECTION_ITEMS) invalidJournal();
        Object.defineProperty(raw[kind], row.id as string, {
          value: JSON.parse(row.payload as string),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      this.state = decodeJournalState(raw);
      // Validate recovery completely before any write, including PRAGMAs that can
      // change the database header. Invalid journals must retain their original bytes.
      this.database.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS journal_records (
          kind TEXT NOT NULL CHECK(kind IN ('commands','jobs','workspaces')),
          id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id)
        ) STRICT;`);
      this.database.exec('PRAGMA user_version=5');
    } catch (error) {
      this.database.close();
      throw error instanceof Error && error.message === 'JOURNAL_SCHEMA_UNSUPPORTED'
        ? error
        : new Error('RUNNER_JOURNAL_INVALID');
    }
    try {
      this.compact();
    } catch (error) {
      this.database.close();
      throw error;
    }
    if (
      Object.keys(this.state.commands).length > MAX_JOURNAL_COLLECTION_ITEMS ||
      Object.keys(this.state.jobs).length > MAX_JOURNAL_COLLECTION_ITEMS
    ) {
      this.database.close();
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
    this.ensureCollectionCapacity('jobs');
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
    this.commitRecord('jobs', jobId, record);
    return record;
  }

  runningJob(jobId: string): void {
    this.patchJob(jobId, { status: 'running' });
  }

  completeJob(jobId: string, result: WorkspaceJobResult): void {
    if (
      Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8') >
      MAX_WORKSPACE_JOB_OUTPUT_BYTES
    ) {
      throw new Error('JOB_OUTPUT_LIMIT_INVALID');
    }
    const succeeded = result.exitCode === 0 && !result.timedOut && result.signal === null;
    this.patchJob(jobId, {
      status: succeeded ? 'succeeded' : 'failed',
      result,
      error: succeeded ? null : result.timedOut ? 'WORKSPACE_JOB_TIMEOUT' : 'WORKSPACE_JOB_NONZERO_EXIT',
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
    this.ensureCollectionCapacity('commands');
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
    this.commitRecord('commands', commandId, record);
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
    this.commitRecord('workspaces', record.workspaceId, record);
  }

  deleteWorkspace(id: string): void {
    this.database.prepare("DELETE FROM journal_records WHERE kind='workspaces' AND id=?").run(id);
    delete this.state.workspaces[id];
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
    const commands = { ...this.state.commands };
    const jobs = { ...this.state.jobs };
    const commandCount = Object.keys(commands).length;
    const jobCount = Object.keys(jobs).length;
    prune(commands, new Set(['succeeded', 'failed', 'unknown']));
    prune(jobs, new Set(['succeeded', 'failed', 'cancelled', 'unknown']));
    const nextCommandCount = Object.keys(commands).length;
    const nextJobCount = Object.keys(jobs).length;
    if (commandCount !== nextCommandCount || jobCount !== nextJobCount) {
      this.commitPrunedState({ ...this.state, commands, jobs });
      runnerLog('debug', 'Agent Runner journal compacted', {
        prunedCommandCount: commandCount - nextCommandCount,
        prunedJobCount: jobCount - nextJobCount,
        remainingCommandCount: nextCommandCount,
        remainingJobCount: nextJobCount,
      });
    }
  }

  private ensureCollectionCapacity(kind: 'commands' | 'jobs'): void {
    if (Object.keys(this.state[kind]).length < MAX_JOURNAL_COLLECTION_ITEMS) return;
    this.compact();
    if (Object.keys(this.state[kind]).length >= MAX_JOURNAL_COLLECTION_ITEMS) {
      throw new Error('RUNNER_JOURNAL_CAPACITY_EXCEEDED');
    }
  }

  private patchJob(id: string, patch: Partial<JobRecord>): void {
    const current = this.state.jobs[id];
    if (!current) throw new Error('JOB_NOT_FOUND');
    this.commitRecord('jobs', id, { ...current, ...patch });
  }

  private patchCommand(id: string, patch: Partial<CommandRecord>): void {
    const current = this.state.commands[id];
    if (!current) throw new Error('COMMAND_NOT_FOUND');
    this.commitRecord('commands', id, { ...current, ...patch });
  }

  private commitPrunedState(nextState: JournalState): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const remove = this.database.prepare('DELETE FROM journal_records WHERE kind=? AND id=?');
      for (const kind of ['commands', 'jobs', 'workspaces'] as const) {
        for (const id of Object.keys(this.state[kind])) {
          if (!Object.hasOwn(nextState[kind], id)) remove.run(kind, id);
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.state = nextState;
  }

  private commitRecord<K extends 'commands' | 'jobs' | 'workspaces'>(
    kind: K,
    id: string,
    record: JournalState[K][string],
  ): void {
    this.database
      .prepare(
        'INSERT INTO journal_records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload',
      )
      .run(kind, id, JSON.stringify(record));
    Object.defineProperty(this.state[kind], id, {
      value: record,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  close(): void {
    this.database.close();
  }
}
