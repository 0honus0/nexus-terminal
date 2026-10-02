import type {
  WorkspaceRuntimeCommand,
  WorkspaceProvisionCommand,
  WorkspaceLifecycleCommand,
  WorkspaceJobInput,
  WorkspaceJobRequest,
} from '@nexus-terminal/protocol/runner';
import { PLUGIN_RUNNER_PROTOCOL_VERSION } from '../plugin-sdk.types';
import type { WorkspaceRecord } from '../types';
import { WorkspaceRuntimeCatalog } from './workspace-runtime-catalog';
import { WorkspaceRuntimeEngine } from './workspace-runtime-engine';
import { RunnerJournal, payloadHash } from './journal';
import { PackInstaller } from './pack-installer';
import { CleanupPlanner } from './cleanup-planner';
import { PluginRunnerRuntime } from './plugin-runner-runtime';
import type { AcpProcessRuntime } from './acp-process-runtime';
import type { WorkspaceTerminalRuntime } from './workspace-terminal-runtime';
import type { BrowserTunnelRuntime } from './browser-tunnel-runtime';

import { runnerLog } from '../logging';

import { asRecord, hasOnlyKeys, validateWorkspaceBindings } from './runner-request-validation';

export interface RunnerCommandExecutorDependencies {
  catalog: WorkspaceRuntimeCatalog;
  journal: RunnerJournal;
  runtimeEngine: WorkspaceRuntimeEngine;
  installer: PackInstaller;
  cleanup: CleanupPlanner;
  pluginRunner: PluginRunnerRuntime;
  acpRuntime: AcpProcessRuntime;
  terminalRuntime: WorkspaceTerminalRuntime;
  browserTunnel: BrowserTunnelRuntime;
}

export class RunnerCommandExecutor {
  private toolchainAdminActive = false;

  constructor(private readonly dependencies: RunnerCommandExecutorDependencies) {}

  beginWorkspaceJob(workspaceId: string, input: WorkspaceJobInput) {
    const workspace = this.dependencies.journal.workspace(workspaceId);
    if (!workspace || workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
    const now = Math.floor(Date.now() / 1000);
    const record = input as unknown as Record<string, unknown>;
    if (
      !hasOnlyKeys(record, ['jobId', 'generation', 'deadlineAt', 'argv', 'cwd', 'maxBytes', 'timeoutMs']) ||
      typeof input.jobId !== 'string' ||
      !/^[A-Za-z0-9-]{8,128}$/.test(input.jobId) ||
      input.generation !== workspace.generation ||
      !Number.isSafeInteger(input.deadlineAt) ||
      input.deadlineAt <= now ||
      !Array.isArray(input.argv) ||
      input.argv.length < 1 ||
      input.argv.length > 128 ||
      input.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      typeof input.cwd !== 'string' ||
      input.cwd.length < 1 ||
      input.cwd.length > 4096 ||
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes < 1 ||
      input.maxBytes > 1024 * 1024 ||
      !Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 1 ||
      input.timeoutMs > 5 * 60 * 1000
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const request: WorkspaceJobRequest = { ...input, workspaceId };
    const hash = payloadHash(request);
    const priorJob = this.dependencies.journal.job(request.jobId);
    if (!priorJob && this.hasActiveWorkspaceJob(workspaceId, request.generation)) {
      throw new Error('WORKSPACE_JOB_ACTIVE_CONFLICT');
    }
    const job = this.dependencies.journal.beginJob(request.jobId, hash, workspaceId, request.generation);
    runnerLog('debug', 'Agent Runner Workspace job accepted', {
      jobId: request.jobId,
      workspaceId,
      generation: request.generation,
      replayed: priorJob !== null,
    });
    if (job.status === 'pending') {
      this.dependencies.journal.runningJob(request.jobId);
      void this.executeWorkspaceJob(request).catch((error) =>
        this.logExecutorPersistenceFailure('workspace-job', request.jobId, error),
      );
    }
    return this.dependencies.journal.job(request.jobId)!;
  }

  private async executeWorkspaceJob(request: WorkspaceJobRequest): Promise<void> {
    let result;
    try {
      result = await this.dependencies.runtimeEngine.executeJob(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        if (message === 'WORKSPACE_JOB_CANCELLED') this.dependencies.journal.cancelJob(request.jobId, message);
        else this.dependencies.journal.failJob(request.jobId, message);
      } catch (persistenceError) {
        this.markJobOutcomeUnknown(request.jobId, persistenceError);
      }
      runnerLog(
        message === 'WORKSPACE_JOB_CANCELLED' ? 'info' : 'warn',
        'Agent Runner Workspace job finished unsuccessfully',
        {
          jobId: request.jobId,
          workspaceId: request.workspaceId,
          generation: request.generation,
          errorCode: message.slice(0, 200),
        },
      );
      return;
    }
    try {
      this.dependencies.journal.succeedJob(request.jobId, result);
    } catch (persistenceError) {
      this.markJobOutcomeUnknown(request.jobId, persistenceError);
      return;
    }
    runnerLog('debug', 'Agent Runner Workspace job completed', {
      jobId: request.jobId,
      workspaceId: request.workspaceId,
      generation: request.generation,
      exitCode: result.exitCode,
    });
  }

  async waitWorkspaceJob(jobId: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = this.dependencies.journal.job(jobId);
      if (!job) throw new Error('JOB_NOT_FOUND');
      if (job.status !== 'pending' && job.status !== 'running') return job;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return job;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining)));
    }
  }

  async cancelWorkspaceJob(jobId: string) {
    const job = this.dependencies.journal.job(jobId);
    if (!job) throw new Error('JOB_NOT_FOUND');
    if (job.status !== 'pending' && job.status !== 'running') return job;
    this.dependencies.runtimeEngine.cancelJob(jobId);
    return this.waitWorkspaceJob(jobId, 5_000);
  }

  hasActiveWorkspaceJob(workspaceId: string, generation: number): boolean {
    return this.dependencies.journal
      .jobs()
      .some(
        (candidate) =>
          candidate.workspaceId === workspaceId &&
          candidate.generation === generation &&
          (candidate.status === 'pending' || candidate.status === 'running'),
      );
  }

  beginCommand(input: unknown) {
    const record = asRecord(input);
    const action = typeof record.action === 'string' ? record.action : '';
    if (['cacheCleanup', 'runtimeCleanup', 'packInstall', 'packUninstall'].includes(action)) {
      return this.beginAdminCommand(
        record,
        action as 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
      );
    }
    const command = record as unknown as WorkspaceRuntimeCommand;
    this.validateCommand(command);
    const hash = payloadHash(command);
    const priorCommand = this.dependencies.journal.command(command.commandId);
    const existing = this.dependencies.journal.begin(command.commandId, hash, command.action, command.workspaceId);
    runnerLog('debug', 'Agent Runner Workspace command accepted', {
      commandId: command.commandId,
      action: command.action,
      workspaceId: command.workspaceId,
      generation: command.generation,
      replayed: priorCommand !== null,
    });
    if (existing.status === 'pending') {
      this.dependencies.journal.running(command.commandId);
      void this.executeWorkspaceCommand(command).catch((error) =>
        this.logExecutorPersistenceFailure('workspace-command', command.commandId, error),
      );
    }
    return this.dependencies.journal.command(command.commandId)!;
  }

  private async executeWorkspaceCommand(command: WorkspaceRuntimeCommand): Promise<void> {
    try {
      if (command.action === 'provision') await this.provision(command);
      else await this.workspaceAction(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.dependencies.journal.fail(command.commandId, message);
      } catch (persistenceError) {
        this.markCommandOutcomeUnknown(command.commandId, persistenceError);
      }
      runnerLog('warn', 'Agent Runner Workspace command failed', {
        commandId: command.commandId,
        action: command.action,
        workspaceId: command.workspaceId,
        generation: command.generation,
        errorCode: message.slice(0, 200),
      });
      return;
    }
    try {
      this.dependencies.journal.succeed(command.commandId, null);
    } catch (persistenceError) {
      this.markCommandOutcomeUnknown(command.commandId, persistenceError);
      return;
    }
    runnerLog('debug', 'Agent Runner Workspace command completed', {
      commandId: command.commandId,
      action: command.action,
      workspaceId: command.workspaceId,
      generation: command.generation,
    });
  }

  private beginAdminCommand(
    command: Record<string, unknown>,
    action: 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
  ) {
    this.validateAdminCommand(command, action);
    const commandId = String(command.commandId);
    const hash = payloadHash(command);
    const priorCommand = this.dependencies.journal.command(commandId);
    const existing = this.dependencies.journal.begin(commandId, hash, action, null);
    runnerLog('debug', 'Agent Runner admin command accepted', { commandId, action, replayed: priorCommand !== null });
    if (existing.status === 'pending') {
      this.dependencies.journal.running(commandId);
      void this.executeAdminCommand(command, action).catch((error) =>
        this.logExecutorPersistenceFailure('admin-command', commandId, error),
      );
    }
    return this.dependencies.journal.command(commandId)!;
  }

  private async executeAdminCommand(
    command: Record<string, unknown>,
    action: 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
  ): Promise<void> {
    const commandId = String(command.commandId);
    let result: unknown;
    try {
      if (action === 'runtimeCleanup') {
        result = await this.dependencies.cleanup.runtimeCleanup(command.workspaceIds as string[]);
      } else {
        result = await this.withToolchainAdminCommand(async () => {
          if (action === 'cacheCleanup') return this.dependencies.cleanup.cacheCleanup();
          if (action === 'packInstall') {
            const packs = command.packs as Array<{ familyId: string; versionId: string }>;
            await this.dependencies.installer.ensure(packs, commandId);
            if (packs.some((ref) => !this.dependencies.installer.installed(ref))) {
              throw new Error('WORKSPACE_TOOLCHAIN_POSTCONDITION_FAILED');
            }
            return { installed: packs.length };
          }
          const ref = command.pack as { familyId: string; versionId: string };
          const inUse = this.dependencies.journal
            .workspaces()
            .filter((workspace) => !['deleted', 'failed'].includes(workspace.status))
            .some((workspace) =>
              workspace.toolchain.some(
                (candidate) => candidate.familyId === ref.familyId && candidate.versionId === ref.versionId,
              ),
            );
          if (inUse) throw new Error('WORKSPACE_TOOLCHAIN_IN_USE');
          await this.dependencies.installer.uninstall(ref);
          if (this.dependencies.installer.installed(ref)) {
            throw new Error('WORKSPACE_TOOLCHAIN_POSTCONDITION_FAILED');
          }
          return { uninstalled: true };
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.dependencies.journal.fail(commandId, message);
      } catch (persistenceError) {
        this.markCommandOutcomeUnknown(commandId, persistenceError);
      }
      runnerLog('warn', 'Agent Runner admin command failed', { commandId, action, errorCode: message.slice(0, 200) });
      return;
    }

    try {
      this.dependencies.journal.succeed(commandId, result);
    } catch (persistenceError) {
      this.markCommandOutcomeUnknown(commandId, persistenceError);
      return;
    }
    const cleanupResult =
      action === 'runtimeCleanup' && result && typeof result === 'object' && !Array.isArray(result)
        ? (result as { deleted?: unknown[]; skipped?: unknown[]; quarantined?: unknown[] })
        : null;
    runnerLog('info', 'Agent Runner admin command completed', {
      commandId,
      action,
      ...(cleanupResult
        ? {
            deletedWorkspaceCount: cleanupResult.deleted?.length ?? 0,
            skippedWorkspaceCount: cleanupResult.skipped?.length ?? 0,
            quarantinedWorkspaceCount: cleanupResult.quarantined?.length ?? 0,
          }
        : {}),
    });
  }

  private markCommandOutcomeUnknown(commandId: string, persistenceError: unknown): void {
    const errorCode = persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
    this.dependencies.journal.unknown(commandId, 'RUNNER_TERMINAL_PERSISTENCE_FAILED');
    runnerLog('error', 'Agent Runner command terminal outcome persistence failed', {
      commandId,
      errorCode: errorCode.slice(0, 200),
    });
  }

  private markJobOutcomeUnknown(jobId: string, persistenceError: unknown): void {
    const errorCode = persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
    this.dependencies.journal.unknownJob(jobId, 'RUNNER_TERMINAL_PERSISTENCE_FAILED');
    runnerLog('error', 'Agent Runner Job terminal outcome persistence failed', {
      jobId,
      errorCode: errorCode.slice(0, 200),
    });
  }

  private logExecutorPersistenceFailure(kind: string, id: string, error: unknown): void {
    runnerLog('error', 'Agent Runner executor persistence failure', {
      kind,
      id,
      errorCode: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    });
  }

  private async withToolchainAdminCommand<T>(work: () => Promise<T>): Promise<T> {
    if (this.toolchainAdminActive) throw new Error('RUNNER_TOOLCHAIN_MUTATION_BUSY');
    this.toolchainAdminActive = true;
    try {
      return await work();
    } finally {
      this.toolchainAdminActive = false;
    }
  }

  private validateCommonCommand(command: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof command.commandId !== 'string' ||
      !/^[A-Za-z0-9-]{8,128}$/.test(command.commandId) ||
      !Number.isSafeInteger(command.deadlineAt) ||
      (command.deadlineAt as number) <= now
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }

  private validateAdminCommand(
    command: Record<string, unknown>,
    action: 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
  ): void {
    this.validateCommonCommand(command);
    const common = ['commandId', 'action', 'deadlineAt'];
    const specific =
      action === 'runtimeCleanup'
        ? ['workspaceIds']
        : action === 'packInstall'
          ? ['packs']
          : action === 'packUninstall'
            ? ['pack']
            : [];
    if (!hasOnlyKeys(command, [...common, ...specific]) || command.action !== action) {
      throw new Error('VALIDATION_FAILED');
    }
    if (action === 'runtimeCleanup') {
      const workspaceIds = command.workspaceIds;
      if (
        !Array.isArray(workspaceIds) ||
        workspaceIds.length > 4096 ||
        workspaceIds.some((value) => typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value)) ||
        new Set(workspaceIds).size !== workspaceIds.length
      ) {
        throw new Error('VALIDATION_FAILED');
      }
    } else if (action === 'packInstall') {
      if (!Array.isArray(command.packs) || command.packs.length < 1 || command.packs.length > 32) {
        throw new Error('VALIDATION_FAILED');
      }
    } else if (action === 'packUninstall') {
      const pack = command.pack;
      if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('VALIDATION_FAILED');
      const ref = pack as { familyId?: unknown; versionId?: unknown };
      if (typeof ref.familyId !== 'string' || typeof ref.versionId !== 'string') {
        throw new Error('VALIDATION_FAILED');
      }
    }
  }

  private validateCommand(command: WorkspaceRuntimeCommand): void {
    const record = command as unknown as Record<string, unknown>;
    this.validateCommonCommand(record);
    if (
      !['provision', 'start', 'stop', 'restart', 'delete'].includes(command.action) ||
      typeof command.workspaceId !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(command.workspaceId) ||
      !Number.isSafeInteger(command.generation) ||
      command.generation < 1
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const common = ['commandId', 'workspaceId', 'generation', 'action', 'deadlineAt'];
    if (command.action !== 'provision') {
      if (!hasOnlyKeys(record, common)) throw new Error('VALIDATION_FAILED');
      return;
    }
    const provisionKeys = [
      ...common,
      'recipeId',
      'recipeRevision',
      'runtimeDigest',
      'catalogRevision',
      'toolchain',
      'runnerPlugins',
      'acpProfiles',
      'browserTarget',
      'retained',
    ];
    if (
      !hasOnlyKeys(record, provisionKeys) ||
      typeof command.recipeId !== 'string' ||
      typeof command.recipeRevision !== 'string' ||
      typeof command.runtimeDigest !== 'string' ||
      typeof command.catalogRevision !== 'string' ||
      !Array.isArray(command.toolchain) ||
      typeof command.retained !== 'boolean'
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    validateWorkspaceBindings(command);
    const catalog = this.dependencies.catalog.load();
    if (command.catalogRevision !== catalog.revision || command.runtimeDigest !== catalog.runtimeDigest) {
      throw new Error('CATALOG_REVISION_CONFLICT');
    }
    const recipe = this.dependencies.catalog.recipe(command.recipeId);
    if (recipe.revision !== command.recipeRevision) throw new Error('WORKSPACE_RECIPE_STALE');
    this.dependencies.catalog.validateSelection(command.recipeId, command.toolchain);
    const targets = command.runnerPlugins;
    if (!Array.isArray(targets) || targets.length > 64) throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
    const targetIds = new Set<string>();
    for (const target of targets) {
      if (
        !target ||
        typeof target.pluginId !== 'string' ||
        typeof target.version !== 'string' ||
        typeof target.sdkVersion !== 'string' ||
        target.protocolVersion !== PLUGIN_RUNNER_PROTOCOL_VERSION ||
        typeof target.packageHash !== 'string' ||
        typeof target.entry !== 'string' ||
        targetIds.has(target.pluginId)
      ) {
        throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
      }
      targetIds.add(target.pluginId);
    }
  }

  private async provision(command: WorkspaceProvisionCommand): Promise<void> {
    const current = this.dependencies.journal.workspace(command.workspaceId);
    if (current && current.generation >= command.generation && current.status !== 'deleted') {
      throw new Error('WORKSPACE_GENERATION_CONFLICT');
    }
    await this.dependencies.installer.ensure(command.toolchain, command.commandId);
    const creating: WorkspaceRecord = {
      workspaceId: command.workspaceId,
      generation: command.generation,
      status: 'creating',
      retained: command.retained,
      toolchain: command.toolchain.map((pack) => ({ ...pack })),
      runnerPlugins: command.runnerPlugins.map((target) => ({ ...target })),
      acpProfiles: command.acpProfiles.map((profile) => ({ ...profile, argv: [...profile.argv] })),
      browserTarget: command.browserTarget
        ? {
            ...command.browserTarget,
            endpoints: command.browserTarget.endpoints.map((endpoint) => ({ ...endpoint })),
            allowedUrlPatterns: [...command.browserTarget.allowedUrlPatterns],
          }
        : null,
    };
    this.dependencies.journal.saveWorkspace(creating);
    try {
      await this.dependencies.runtimeEngine.create(command);
      const ready: WorkspaceRecord = { ...creating, status: 'ready' };
      this.dependencies.pluginRunner.prepareWorkspace(ready);
      this.dependencies.journal.saveWorkspace(ready);
    } catch (error) {
      let stateError: unknown = null;
      try {
        this.dependencies.journal.saveWorkspace({ ...creating, status: 'failed' });
      } catch (candidate) {
        stateError = candidate;
        runnerLog('error', 'Agent Runner failed to persist failed provision owner state', {
          workspaceId: command.workspaceId,
          generation: command.generation,
          errorCode: (candidate instanceof Error ? candidate.message : String(candidate)).slice(0, 200),
        });
      }
      await this.dependencies.runtimeEngine.remove(command.workspaceId, command.generation).catch((cleanupError) => {
        runnerLog('warn', 'Agent Runner failed to remove partial provision runtime', {
          workspaceId: command.workspaceId,
          generation: command.generation,
          errorCode: (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)).slice(0, 200),
        });
      });
      try {
        this.dependencies.pluginRunner.cleanupGeneration(command.workspaceId, command.generation);
      } catch (cleanupError) {
        runnerLog('warn', 'Agent Runner failed to remove partial provision Plugin HOME', {
          workspaceId: command.workspaceId,
          generation: command.generation,
          errorCode: (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)).slice(0, 200),
        });
      }
      if (stateError) throw stateError;
      throw error;
    }
  }

  private async workspaceAction(command: WorkspaceLifecycleCommand): Promise<void> {
    const workspace = this.dependencies.journal.workspace(command.workspaceId);
    if (!workspace || workspace.generation !== command.generation) throw new Error('WORKSPACE_NOT_FOUND');
    const releaseLifecycleDrain = this.dependencies.runtimeEngine.beginWorkspaceLifecycleDrain(
      workspace.workspaceId,
      workspace.generation,
    );
    try {
      if (command.action === 'start') {
        await this.dependencies.runtimeEngine.start(workspace.workspaceId, workspace.generation);
        try {
          await this.dependencies.pluginRunner.activateWorkspace(workspace);
        } catch (error) {
          await this.dependencies.runtimeEngine
            .stop(workspace.workspaceId, workspace.generation)
            .catch(() => undefined);
          throw error;
        }
        this.save(workspace, 'running');
        return;
      }
      if (command.action === 'stop') {
        await Promise.all([
          this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation),
          this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation),
        ]);
        this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
        await this.dependencies.pluginRunner.quiesceWorkspace(workspace, Math.floor(Date.now() / 1000) + 10);
        await this.dependencies.pluginRunner.disposeWorkspace(workspace);
        await this.dependencies.runtimeEngine.stop(workspace.workspaceId, workspace.generation);
        this.save(workspace, 'stopped');
        return;
      }
      if (command.action === 'restart') {
        await Promise.all([
          this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation),
          this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation),
        ]);
        this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
        await this.dependencies.pluginRunner.disposeWorkspace(workspace);
        try {
          await this.dependencies.runtimeEngine.restart(workspace.workspaceId, workspace.generation);
          await this.dependencies.pluginRunner.activateWorkspace(workspace);
        } catch (error) {
          await this.dependencies.pluginRunner.disposeWorkspace(workspace).catch(() => undefined);
          await this.dependencies.runtimeEngine
            .stop(workspace.workspaceId, workspace.generation)
            .catch(() => undefined);
          this.save(workspace, 'failed');
          throw error;
        }
        this.save(workspace, 'running');
        return;
      }
      await Promise.all([
        this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation),
        this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation),
      ]);
      this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
      await this.dependencies.pluginRunner.disposeWorkspace(workspace);
      await this.dependencies.runtimeEngine.remove(workspace.workspaceId, workspace.generation);
      this.dependencies.pluginRunner.cleanupGeneration(workspace.workspaceId, workspace.generation);
      this.save(workspace, 'deleted');
    } finally {
      releaseLifecycleDrain();
    }
  }

  private save(workspace: WorkspaceRecord, status: WorkspaceRecord['status']): void {
    this.dependencies.journal.saveWorkspace({
      ...workspace,
      status,
      retained: status === 'deleted' ? false : workspace.retained,
    });
  }
}
