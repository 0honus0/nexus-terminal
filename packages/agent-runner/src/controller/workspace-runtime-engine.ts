import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceJobRequest, WorkspaceJobResult, WorkspaceRecord, WorkspaceProvisionCommand } from '../types';
import { JobRunner } from '../worker/job-runner';
import { WorkspaceRuntimeManager } from './workspace-runtime-manager';
import type { ToolchainStore } from './toolchain-store';
import { resolveProjectInstructions, type RunnerProjectInstructionProjection } from './project-instructions';
import {
  applyWorkspacePatch,
  deleteWorkspaceFile,
  listWorkspaceFiles,
  moveWorkspaceFile,
  readWorkspaceFile,
  searchWorkspace,
  statWorkspacePath,
  writeWorkspaceFile,
  type RunnerWorkspaceApplyPatchRequest,
  type RunnerWorkspaceApplyPatchResult,
  type RunnerWorkspaceFileDeleteRequest,
  type RunnerWorkspaceFileDeleteResult,
  type RunnerWorkspaceFileListRequest,
  type RunnerWorkspaceFileListResult,
  type RunnerWorkspaceFileMoveRequest,
  type RunnerWorkspaceFileMoveResult,
  type RunnerWorkspaceFileReadRequest,
  type RunnerWorkspaceFileReadResult,
  type RunnerWorkspaceFileStatResult,
  type RunnerWorkspaceFileWriteRequest,
  type RunnerWorkspaceFileWriteResult,
  type RunnerWorkspaceSearchRequest,
  type RunnerWorkspaceSearchResult,
} from './workspace-coding-files';
import {
  WorkspaceCodeIntelligence,
  type RunnerWorkspaceCodeIntelRequest,
  type RunnerWorkspaceCodeIntelResult,
  type RunnerWorkspaceRepoMapRequest,
  type RunnerWorkspaceRepoMapResult,
} from './workspace-code-intelligence';
import {
  createWorkspaceCheckpointArchive,
  restoreWorkspaceCheckpointArchive,
  type WorkspaceCheckpointArchiveReadHandle,
} from './workspace-checkpoint-archive';

const workspaceKey = (workspaceId: string, generation: number): string => `${workspaceId}\u0000${generation}`;

export class WorkspaceRuntimeEngine {
  private readonly runtime: WorkspaceRuntimeManager;
  private readonly codeIntelligence = new WorkspaceCodeIntelligence();
  private readonly jobs = new Map<string, Set<AbortController>>();
  private readonly jobControllers = new Map<string, AbortController>();

  constructor(runtimeRoot: string, store: ToolchainStore) {
    this.runtime = new WorkspaceRuntimeManager(runtimeRoot, store);
  }

  async create(command: WorkspaceProvisionCommand): Promise<void> {
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
    this.codeIntelligence.dispose(workspaceKey(workspaceId, generation));
    this.runtime.remove(workspaceId, generation);
  }

  prepareAcpProcess(workspaceId: string, generation: number, argv: readonly string[], cwd: string) {
    return this.runtime.prepareAcpProcess(workspaceId, generation, argv, cwd);
  }

  prepareTerminalProcess(workspaceId: string, generation: number) {
    return this.runtime.prepareTerminalProcess(workspaceId, generation);
  }

  projectInstructions(
    workspaceId: string,
    generation: number,
    targetDirectories: readonly string[],
  ): RunnerProjectInstructionProjection {
    this.runtime.generationRoot(workspaceId, generation);
    const status = this.runtime.status(workspaceId, generation);
    if (status === 'deleted' || status === 'failed') throw new Error('WORKSPACE_NOT_FOUND');
    return resolveProjectInstructions(
      path.join(this.runtime.coreWorkspaceRoot(workspaceId), 'work'),
      targetDirectories,
    );
  }

  readWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceFileReadRequest,
  ): RunnerWorkspaceFileReadResult {
    return readWorkspaceFile(this.codingWorkRoot(workspaceId, generation), request);
  }

  statWorkspacePath(workspaceId: string, generation: number, path: string): RunnerWorkspaceFileStatResult {
    return statWorkspacePath(this.codingWorkRoot(workspaceId, generation), path);
  }

  writeWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceFileWriteRequest,
  ): RunnerWorkspaceFileWriteResult {
    return writeWorkspaceFile(this.codingWorkRoot(workspaceId, generation), request);
  }

  listWorkspaceFiles(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceFileListRequest,
  ): RunnerWorkspaceFileListResult {
    return listWorkspaceFiles(this.codingWorkRoot(workspaceId, generation), request);
  }

  moveWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceFileMoveRequest,
  ): RunnerWorkspaceFileMoveResult {
    return moveWorkspaceFile(this.codingWorkRoot(workspaceId, generation), request);
  }

  deleteWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceFileDeleteRequest,
  ): RunnerWorkspaceFileDeleteResult {
    return deleteWorkspaceFile(this.codingWorkRoot(workspaceId, generation), request);
  }

  searchWorkspace(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceSearchRequest,
  ): RunnerWorkspaceSearchResult {
    return searchWorkspace(this.codingWorkRoot(workspaceId, generation), request);
  }

  repoMap(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceRepoMapRequest,
  ): Promise<RunnerWorkspaceRepoMapResult> {
    return this.codeIntelligence.repoMap(
      workspaceKey(workspaceId, generation),
      this.codingWorkRoot(workspaceId, generation),
      request,
    );
  }

  codeIntel(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceCodeIntelRequest,
  ): Promise<RunnerWorkspaceCodeIntelResult> {
    return this.codeIntelligence.codeIntel(
      workspaceKey(workspaceId, generation),
      this.codingWorkRoot(workspaceId, generation),
      request,
    );
  }

  applyWorkspacePatch(
    workspaceId: string,
    generation: number,
    request: RunnerWorkspaceApplyPatchRequest,
  ): RunnerWorkspaceApplyPatchResult {
    return applyWorkspacePatch(this.codingWorkRoot(workspaceId, generation), request);
  }

  async openCheckpointArchive(workspaceId: string, generation: number): Promise<WorkspaceCheckpointArchiveReadHandle> {
    const status = this.runtime.status(workspaceId, generation);
    if (!['ready', 'running', 'stopped'].includes(status)) {
      throw new Error(status === 'deleted' ? 'WORKSPACE_NOT_FOUND' : 'WORKSPACE_CHECKPOINT_NOT_SAFE');
    }
    if ((this.jobs.get(workspaceKey(workspaceId, generation))?.size ?? 0) > 0) {
      throw new Error('WORKSPACE_CHECKPOINT_NOT_SAFE');
    }
    return createWorkspaceCheckpointArchive(
      path.join(this.runtime.coreWorkspaceRoot(workspaceId), 'work'),
      path.join(this.runtime.workspaceRoot(workspaceId), '.control', 'checkpoints'),
    );
  }

  async restoreCheckpointArchive(
    workspaceId: string,
    generation: number,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
  ): Promise<void> {
    const status = this.runtime.status(workspaceId, generation);
    if (status !== 'ready') {
      throw new Error(status === 'deleted' ? 'WORKSPACE_NOT_FOUND' : 'WORKSPACE_CHECKPOINT_RESTORE_NOT_READY');
    }
    if ((this.jobs.get(workspaceKey(workspaceId, generation))?.size ?? 0) > 0) {
      throw new Error('WORKSPACE_CHECKPOINT_NOT_SAFE');
    }
    await restoreWorkspaceCheckpointArchive(
      path.join(this.runtime.coreWorkspaceRoot(workspaceId), 'work'),
      path.join(this.runtime.workspaceRoot(workspaceId), '.control', 'checkpoints'),
      source,
      expectedBytes,
    );
    this.codeIntelligence.dispose(workspaceKey(workspaceId, generation));
  }

  async executeJob(request: WorkspaceJobRequest): Promise<WorkspaceJobResult> {
    const execution = this.runtime.prepareJob(request);
    const key = workspaceKey(request.workspaceId, request.generation);
    const controller = new AbortController();
    if (this.jobControllers.has(request.jobId)) throw new Error('WORKSPACE_JOB_ACTIVE_CONFLICT');
    let active = this.jobs.get(key);
    if (!active) {
      active = new Set();
      this.jobs.set(key, active);
    }
    active.add(controller);
    this.jobControllers.set(request.jobId, controller);
    try {
      const result = await new JobRunner().run(execution.argv, execution.cwd, request.maxBytes, request.timeoutMs, {
        executable: execution.file,
        env: execution.env,
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new Error('WORKSPACE_JOB_CANCELLED');
      return result;
    } finally {
      this.jobControllers.delete(request.jobId);
      active.delete(controller);
      if (active.size === 0) this.jobs.delete(key);
    }
  }

  cancelJob(jobId: string): boolean {
    const controller = this.jobControllers.get(jobId);
    if (!controller) return false;
    controller.abort(new Error('WORKSPACE_JOB_CANCELLED'));
    return true;
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
    return { ...record, status: mapped };
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

  private codingWorkRoot(workspaceId: string, generation: number): string {
    this.runtime.generationRoot(workspaceId, generation);
    const status = this.runtime.status(workspaceId, generation);
    if (status !== 'running') throw new Error(status === 'deleted' ? 'WORKSPACE_NOT_FOUND' : 'WORKSPACE_NOT_RUNNING');
    return path.join(this.runtime.coreWorkspaceRoot(workspaceId), 'work');
  }
}
