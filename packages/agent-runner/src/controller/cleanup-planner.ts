import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceRuntimeEngine } from './workspace-runtime-engine';
import type { RunnerJournal } from './journal';
import { runnerLog } from '../logging';

export class CleanupPlanner {
  constructor(
    private readonly root: string,
    private readonly journal: RunnerJournal,
    private readonly runtimeEngine: WorkspaceRuntimeEngine,
  ) {}
  async runtimeCleanup(
    userId: number,
    workspaceIds: readonly string[],
  ): Promise<{ deleted: string[]; quarantined: string[]; skipped: string[] }> {
    if (!Number.isSafeInteger(userId) || userId < 1 || workspaceIds.length > 4096) {
      throw new Error('VALIDATION_FAILED');
    }
    runnerLog('info', 'Agent Runner runtime cleanup started', { userId, requestedWorkspaceCount: workspaceIds.length });
    const requested = new Set(workspaceIds);
    if (requested.size !== workspaceIds.length) throw new Error('VALIDATION_FAILED');
    const deleted: string[] = [],
      quarantined: string[] = [],
      skipped: string[] = [];
    const activeStatuses = new Set(['creating', 'starting', 'running', 'stopping', 'deleting']);
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
        workspace.userId !== userId ||
        workspace.retained ||
        activeStatuses.has(workspace.status) ||
        activeWorkspaceIds.has(workspace.workspaceId)
      ) {
        skipped.push(workspaceId);
        continue;
      }
      try {
        await this.runtimeEngine.remove(workspace.workspaceId, workspace.generation);
        fs.rmSync(path.join(this.root, 'runtime', 'generations', workspace.workspaceId), {
          recursive: true,
          force: true,
        });
        fs.rmSync(path.join(this.root, 'runtime', 'workspaces', workspace.workspaceId), {
          recursive: true,
          force: true,
        });
        this.journal.deleteWorkspace(workspace.workspaceId);
        deleted.push(workspace.workspaceId);
      } catch (error) {
        runnerLog('warn', 'Agent Runner Workspace cleanup quarantined', {
          userId,
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
      userId,
      requestedWorkspaceCount: workspaceIds.length,
      deletedWorkspaceCount: deleted.length,
      skippedWorkspaceCount: skipped.length,
      quarantinedWorkspaceCount: quarantined.length,
    });
    return { deleted, quarantined, skipped };
  }
  cacheCleanup(): { cleared: true } {
    const cache = path.join(this.root, 'cache');
    runnerLog('info', 'Agent Runner cache cleanup started');
    fs.rmSync(cache, { recursive: true, force: true });
    fs.mkdirSync(cache, { recursive: true });
    runnerLog('info', 'Agent Runner cache cleanup finished');
    return { cleared: true };
  }
}
