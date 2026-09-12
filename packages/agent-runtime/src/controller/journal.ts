import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CommandRecord, JobRecord, WorkspaceJobResult, WorkspaceRecord } from '../types';

interface JournalState {
  schemaVersion: 2;
  commands: Record<string, CommandRecord>;
  workspaces: Record<string, WorkspaceRecord>;
  jobs: Record<string, JobRecord>;
}

const empty = (): JournalState => ({ schemaVersion: 2, commands: {}, workspaces: {}, jobs: {} });

export const payloadHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class RunnerJournal {
  private state: JournalState;
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      this.state = JSON.parse(fs.readFileSync(filePath, 'utf8')) as JournalState;
      if (this.state.schemaVersion !== 2) throw new Error('JOURNAL_SCHEMA_UNSUPPORTED');
      this.state.commands ??= {};
      this.state.workspaces ??= {};
      this.state.jobs ??= {};
      for (const workspace of Object.values(this.state.workspaces)) {
        workspace.runnerPlugins ??= [];
        workspace.acpProfiles ??= [];
        workspace.browserTarget ??= null;
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'JOURNAL_SCHEMA_UNSUPPORTED') {
        // Unpublished dev model: old execution-plane journals are intentionally discarded.
        this.state = empty();
        this.flush();
      } else {
        this.state = empty();
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
    fs.writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }
}
