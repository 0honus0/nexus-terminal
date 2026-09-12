import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceRuntimeEngine } from './workspace-runtime-engine';
import type { WorkspaceRuntimeCatalog } from './workspace-runtime-catalog';
import type { RunnerJournal } from './journal';

const size = (root: string): number => {
  let total = 0;
  if (!fs.existsSync(root)) return 0;
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
          // Concurrent cleanup may remove a file between readdir/stat.
        }
      }
    }
  }
  return total;
};

export class SpaceReporter {
  constructor(
    private readonly root: string,
    private readonly journal: RunnerJournal,
    private readonly catalog: WorkspaceRuntimeCatalog,
    private readonly runtimeEngine: WorkspaceRuntimeEngine,
  ) {}

  async report() {
    const stat = fs.statfsSync(this.root);
    const stateBytes = size(path.join(this.root, 'state'));
    const packBytes = size(path.join(this.root, 'packs'));
    const cacheBytes = size(path.join(this.root, 'cache'));
    const runtimeBytes = size(path.join(this.root, 'runtime'));
    const quarantineBytes = size(path.join(this.root, 'quarantine'));
    const workspaces = this.journal.workspaces();
    const byWorkspace = workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      runtimeBytes: this.runtimeEngine.runtimeBytes(workspace.workspaceId, workspace.generation),
      status: workspace.status,
    }));
    const runtimeReclaimableBytes = byWorkspace.reduce((total, item) => {
      const workspace = workspaces.find((candidate) => candidate.workspaceId === item.workspaceId);
      return (
        total +
        (workspace && !workspace.retained && ['stopped', 'deleted', 'failed'].includes(workspace.status)
          ? item.runtimeBytes
          : 0)
      );
    }, 0);
    const active = workspaces.filter((workspace) => !['deleted', 'failed'].includes(workspace.status));
    const byPack = this.catalog.load().packs.flatMap((pack) => {
      const digest = pack.contentDigestByArch[process.arch];
      if (!digest) return [];
      const digestPath = digest.replace(/^sha256:/, '');
      const bytes = size(path.join(this.root, 'packs', pack.familyId, pack.versionId, digestPath));
      return [
        {
          familyId: pack.familyId,
          versionId: pack.versionId,
          bytes,
          inUse: active.some((workspace) =>
            workspace.toolchain.some(
              (candidate) =>
                candidate.familyId === pack.familyId &&
                candidate.versionId === pack.versionId &&
                candidate.contentDigest === digest,
            ),
          ),
        },
      ];
    });
    return {
      stateBytes,
      packBytes,
      cacheBytes,
      runtimeBytes,
      quarantineBytes,
      reclaimableBytes: cacheBytes + runtimeReclaimableBytes,
      byPack,
      byWorkspace,
      filesystem: { totalBytes: stat.blocks * stat.bsize, freeBytes: stat.bavail * stat.bsize },
    };
  }
}
