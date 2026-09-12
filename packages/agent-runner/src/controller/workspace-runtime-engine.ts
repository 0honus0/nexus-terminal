import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceJobRequest, WorkspaceJobResult, WorkspaceRecord, WorkspaceRuntimeCommand } from '../types';
import { JobRunner } from '../worker/job-runner';
import { WorkspaceRuntimeManager, type WorkspaceRuntimeAvailability } from './workspace-runtime-manager';
import type { ToolchainStore } from './toolchain-store';

const workspaceKey = (workspaceId: string, generation: number): string => `${workspaceId}\u0000${generation}`;

export class WorkspaceRuntimeEngine {
  private readonly runtime: WorkspaceRuntimeManager;
  private readonly jobs = new Map<string, Set<AbortController>>();

  constructor(runtimeRoot: string, store: ToolchainStore) {
    this.runtime = new WorkspaceRuntimeManager(runtimeRoot, store);
  }

  availability(): WorkspaceRuntimeAvailability {
    return this.runtime.availability();
  }

  async create(command: WorkspaceRuntimeCommand): Promise<void> {
    this.runtime.create(command);
  }

  async start(workspaceId: string, generation: number): Promise<void> {
    this.runtime.start(workspaceId, generation);
  }

  async stop(workspaceId: string, generation: number): Promise<void> {
    this.abortJobs(workspaceId, generation);
    this.runtime.stop(workspaceId, generation);
  }

  async restart(workspaceId: string, generation: number): Promise<void> {
    this.abortJobs(workspaceId, generation);
    this.runtime.restart(workspaceId, generation);
  }

  async remove(workspaceId: string, generation: number): Promise<void> {
    this.abortJobs(workspaceId, generation);
    this.runtime.remove(workspaceId, generation);
  }

  prepareAcpProcess(workspaceId: string, generation: number, argv: readonly string[], cwd: string) {
    return this.runtime.prepareAcpProcess(workspaceId, generation, argv, cwd);
  }

  prepareTerminalProcess(workspaceId: string, generation: number) {
    return this.runtime.prepareTerminalProcess(workspaceId, generation);
  }

  async executeJob(request: WorkspaceJobRequest): Promise<WorkspaceJobResult> {
    const execution = this.runtime.prepareJob(request);
    const key = workspaceKey(request.workspaceId, request.generation);
    const controller = new AbortController();
    let active = this.jobs.get(key);
    if (!active) {
      active = new Set();
      this.jobs.set(key, active);
    }
    active.add(controller);
    try {
      return await new JobRunner().run(execution.argv, execution.cwd, request.maxBytes, request.timeoutMs, {
        executable: execution.file,
        env: execution.env,
        signal: controller.signal,
      });
    } finally {
      active.delete(controller);
      if (active.size === 0) this.jobs.delete(key);
    }
  }

  async status(workspaceId: string, generation: number): Promise<string> {
    return this.runtime.status(workspaceId, generation);
  }

  async reconcile(record: WorkspaceRecord): Promise<WorkspaceRecord> {
    const state = await this.status(record.workspaceId, record.generation);
    const mapped =
      state === 'running'
        ? 'running'
        : state === 'deleted'
          ? 'deleted'
          : state === 'ready'
            ? 'ready'
            : state === 'stopped'
              ? 'stopped'
              : 'failed';
    return { ...record, status: mapped, updatedAt: Math.floor(Date.now() / 1000) };
  }

  runtimeBytes(workspaceId: string, generation: number): number {
    let total = 0;
    const stack = [this.runtime.generationRoot(workspaceId, generation), this.runtime.workspaceRoot(workspaceId)];
    while (stack.length) {
      const current = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(target);
        else if (entry.isFile()) {
          try {
            total += fs.statSync(target).size;
          } catch {
            // 并发清理可能在 readdir/stat 之间删除文件。
          }
        }
      }
    }
    return total;
  }

  private abortJobs(workspaceId: string, generation: number): void {
    const key = workspaceKey(workspaceId, generation);
    for (const controller of this.jobs.get(key) ?? []) controller.abort();
    this.jobs.delete(key);
  }
}
