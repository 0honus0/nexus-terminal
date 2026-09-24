import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceRuntimeEngine } from './workspace-runtime-engine';
import type { RunnerJournal } from './journal';
import { runnerLog } from '../logging';
import { ToolchainMutationCoordinator } from './toolchain-mutation-coordinator';
import type { PluginRunnerRuntime } from './plugin-runner-runtime';

export class CleanupPlanner {
  constructor(
    private readonly root: string,
    private readonly journal: RunnerJournal,
    private readonly runtimeEngine: WorkspaceRuntimeEngine,
    private readonly toolchainMutations = new ToolchainMutationCoordinator(),
    private readonly pluginRunner?: PluginRunnerRuntime,
  ) {}
  async runtimeCleanup(
    workspaceIds: readonly string[],
  ): Promise<{ deleted: string[]; quarantined: string[]; skipped: string[] }> {
    if (workspaceIds.length > 4096) throw new Error('VALIDATION_FAILED');
    runnerLog('info', 'Agent Runner runtime cleanup started', { requestedWorkspaceCount: workspaceIds.length });
    const requested = new Set(workspaceIds);
    if (requested.size !== workspaceIds.length) throw new Error('VALIDATION_FAILED');
    const deleted: string[] = [],
      quarantined: string[] = [],
      skipped: string[] = [];
    const activeProvisionWorkspaceIds = new Set(
      this.journal
        .commands()
        .filter(
          (command) =>
            command.action === 'provision' &&
            (command.status === 'pending' || command.status === 'running') &&
            command.workspaceId,
        )
        .map((command) => command.workspaceId as string),
    );
    const activeWorkspaceIds = new Set(
      this.journal
        .jobs()
        .filter((job) => job.status === 'pending' || job.status === 'running')
        .map((job) => job.workspaceId),
    );
    const byId = new Map(this.journal.workspaces().map((workspace) => [workspace.workspaceId, workspace] as const));
    for (const workspaceId of workspaceIds) {
      const workspace = byId.get(workspaceId);
      if (
        !workspace ||
        workspace.retained ||
        workspace.status === 'running' ||
        (workspace.status === 'creating' && activeProvisionWorkspaceIds.has(workspace.workspaceId)) ||
        activeWorkspaceIds.has(workspace.workspaceId)
      ) {
        skipped.push(workspaceId);
        continue;
      }
      try {
        if (this.pluginRunner) await this.pluginRunner.disposeWorkspace(workspace);
        await this.runtimeEngine.remove(workspace.workspaceId, workspace.generation);
        fs.rmSync(path.join(this.root, 'runtime', 'generations', workspace.workspaceId), {
          recursive: true,
          force: true,
        });
        fs.rmSync(path.join(this.root, 'runtime', 'workspaces', workspace.workspaceId), {
          recursive: true,
          force: true,
        });
        if (this.pluginRunner) this.pluginRunner.cleanupWorkspace(workspace.workspaceId);
        else
          fs.rmSync(path.join(this.root, 'runtime', 'plugin-processes', workspace.workspaceId), {
            recursive: true,
            force: true,
          });
        this.journal.deleteWorkspace(workspace.workspaceId);
        deleted.push(workspace.workspaceId);
      } catch (error) {
        runnerLog('warn', 'Agent Runner Workspace cleanup quarantined', {
          workspaceId: workspace.workspaceId,
          generation: workspace.generation,
          errorCode: error instanceof Error ? error.message : String(error),
        });
        const target = path.join(this.root, 'quarantine', `workspace-${workspace.workspaceId}`);
        fs.mkdirSync(target, { recursive: true, mode: 0o700 });
        fs.writeFileSync(
          path.join(target, 'evidence.json'),
          JSON.stringify({
            schemaVersion: 1,
            workspaceId: workspace.workspaceId,
            generation: workspace.generation,
            reason: error instanceof Error ? error.message.slice(0, 512) : 'cleanup_failed',
            recordedAt: Math.floor(Date.now() / 1000),
          }),
          { mode: 0o600 },
        );
        quarantined.push(workspace.workspaceId);
      }
    }
    this.journal.compact();
    runnerLog('info', 'Agent Runner runtime cleanup finished', {
      requestedWorkspaceCount: workspaceIds.length,
      deletedWorkspaceCount: deleted.length,
      skippedWorkspaceCount: skipped.length,
      quarantinedWorkspaceCount: quarantined.length,
    });
    return { deleted, quarantined, skipped };
  }
  async cacheCleanup(): Promise<{ cleared: true }> {
    return this.toolchainMutations.run(() => {
      const cache = path.join(this.root, 'cache');
      runnerLog('info', 'Agent Runner cache cleanup started');
      fs.rmSync(cache, { recursive: true, force: true });
      fs.mkdirSync(cache, { recursive: true });
      runnerLog('info', 'Agent Runner cache cleanup finished');
      return { cleared: true };
    });
  }
}
