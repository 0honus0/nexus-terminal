import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CommandRecord, JobRecord, WorkspaceJobResult, WorkspaceRecord } from '../types';
import { runnerLog } from '../logging';

interface JournalState {
  schemaVersion: 3;
  commands: Record<string, CommandRecord>;
  workspaces: Record<string, WorkspaceRecord>;
  jobs: Record<string, JobRecord>;
}

const empty = (): JournalState => ({ schemaVersion: 3, commands: {}, workspaces: {}, jobs: {} });
const TERMINAL_HISTORY_LIMIT = 4096;
const TERMINAL_HISTORY_MIN_AGE_SECONDS = 24 * 60 * 60;

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

export const payloadHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class RunnerJournal {
  private state: JournalState;
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      this.state = JSON.parse(fs.readFileSync(filePath, 'utf8')) as JournalState;
      if (this.state.schemaVersion !== 3) throw new Error('JOURNAL_SCHEMA_UNSUPPORTED');
      if (
        !this.state.commands ||
        typeof this.state.commands !== 'object' ||
        Array.isArray(this.state.commands) ||
        !this.state.workspaces ||
        typeof this.state.workspaces !== 'object' ||
        Array.isArray(this.state.workspaces) ||
        !this.state.jobs ||
        typeof this.state.jobs !== 'object' ||
        Array.isArray(this.state.jobs)
      ) {
        throw new Error('JOURNAL_STATE_INVALID');
      }
      for (const workspace of Object.values(this.state.workspaces)) {
        workspace.runnerPlugins ??= [];
        workspace.acpProfiles ??= [];
        workspace.browserTarget ??= null;
      }
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
        .sort((a, b) => (b[1].completedAt ?? b[1].createdAt) - (a[1].completedAt ?? a[1].createdAt));
      for (const [id, value] of terminal.slice(TERMINAL_HISTORY_LIMIT)) {
        const completedAt = value.completedAt ?? value.createdAt;
        if (completedAt <= now - TERMINAL_HISTORY_MIN_AGE_SECONDS) delete values[id];
      }
    };
    const commandCount = Object.keys(this.state.commands).length;
    const jobCount = Object.keys(this.state.jobs).length;
    prune(this.state.commands, new Set(['succeeded', 'failed']));
    prune(this.state.jobs, new Set(['succeeded', 'failed', 'cancelled']));
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

  private quarantineCurrent(reason: 'schema-unsupported' | 'corrupt'): void {
    if (!fs.existsSync(this.filePath)) return;
    const target = `${this.filePath}.${reason}.${Date.now()}-${process.pid}`;
    if (reason === 'corrupt') {
      fs.copyFileSync(this.filePath, target, fs.constants.COPYFILE_EXCL);
      fsyncFile(target);
    } else {
      fs.renameSync(this.filePath, target);
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
