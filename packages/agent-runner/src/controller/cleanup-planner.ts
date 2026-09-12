import fs from 'node:fs';
import path from 'node:path';
import type { SandboxEngine } from './sandbox-engine';
import type { RunnerJournal } from './journal';

export class CleanupPlanner {
  constructor(
    private readonly root: string,
    private readonly journal: RunnerJournal,
    private readonly sandboxEngine: SandboxEngine,
  ) {}
  async runtimeCleanup(userId: number): Promise<{ deleted: string[]; quarantined: string[] }> {
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('VALIDATION_FAILED');
    const deleted: string[] = [],
      quarantined: string[] = [];
    const activeStatuses = new Set(['creating', 'starting', 'running', 'stopping', 'deleting']);
    const activeWorkspaceIds = new Set(
      this.journal
        .jobs()
        .filter((job) => job.status === 'pending' || job.status === 'running')
        .map((job) => job.workspaceId),
    );
    for (const workspace of this.journal.workspaces()) {
      if (
        workspace.userId !== userId ||
        workspace.retained ||
        activeStatuses.has(workspace.status) ||
        activeWorkspaceIds.has(workspace.workspaceId)
      ) {
        continue;
      }
      try {
        if (workspace.sandboxId) await this.sandboxEngine.remove(workspace.sandboxId);
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
    return { deleted, quarantined };
  }
  cacheCleanup(): { cleared: true } {
    const cache = path.join(this.root, 'cache');
    fs.rmSync(cache, { recursive: true, force: true });
    fs.mkdirSync(cache, { recursive: true });
    return { cleared: true };
  }
}
