import fs from 'node:fs';
import path from 'node:path';
import type { EnvironmentCommand, EnvironmentJobRequest, EnvironmentJobResult, EnvironmentRecord } from '../types';
import { JobRunner } from '../worker/job-runner';
import { SandboxManager, type SandboxAvailability } from './sandbox-manager';

export class SandboxEngine {
  private readonly sandbox: SandboxManager;
  private readonly jobs = new Map<string, Set<AbortController>>();

  constructor(runtimeRoot: string, packsRoot: string, sandboxBinary?: string) {
    this.sandbox = new SandboxManager(runtimeRoot, packsRoot, sandboxBinary);
  }

  availability(): SandboxAvailability {
    return this.sandbox.availability();
  }

  available(): boolean {
    return this.availability().available;
  }

  async ping(): Promise<boolean> {
    return this.available();
  }

  async create(command: EnvironmentCommand): Promise<string> {
    return this.sandbox.create(command);
  }

  async start(sandboxId: string): Promise<void> {
    this.sandbox.start(sandboxId);
  }

  async stop(sandboxId: string): Promise<void> {
    this.abortJobs(sandboxId);
    this.sandbox.stop(sandboxId);
  }

  async restart(sandboxId: string): Promise<void> {
    this.abortJobs(sandboxId);
    this.sandbox.restart(sandboxId);
  }

  async remove(sandboxId: string): Promise<void> {
    this.abortJobs(sandboxId);
    this.sandbox.remove(sandboxId);
  }

  async executeJob(sandboxId: string, request: EnvironmentJobRequest): Promise<EnvironmentJobResult> {
    const execution = this.sandbox.prepareJob(sandboxId, request);
    const controller = new AbortController();
    let active = this.jobs.get(sandboxId);
    if (!active) {
      active = new Set();
      this.jobs.set(sandboxId, active);
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
      if (active.size === 0) this.jobs.delete(sandboxId);
    }
  }

  async status(sandboxId: string): Promise<string> {
    return this.sandbox.status(sandboxId);
  }

  async overheadBytes(_runtimeDigest: string): Promise<number> {
    return 0;
  }

  async reconcile(record: EnvironmentRecord): Promise<EnvironmentRecord> {
    if (!record.sandboxId) return record;
    const state = await this.status(record.sandboxId);
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

  runtimeBytes(environmentId: string, generation: number): number {
    const root = this.sandbox.environmentRoot(environmentId, generation);
    let total = 0;
    const stack = [root];
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
            // A concurrent cleanup may remove the file.
          }
        }
      }
    }
    return total;
  }

  private abortJobs(sandboxId: string): void {
    for (const controller of this.jobs.get(sandboxId) ?? []) controller.abort();
    this.jobs.delete(sandboxId);
  }
}
