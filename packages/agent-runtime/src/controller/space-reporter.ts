import fs from 'node:fs';
import path from 'node:path';
import type { SandboxEngine } from './sandbox-engine';
import type { EnvironmentCatalog } from './environment-catalog';
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
    private readonly catalog: EnvironmentCatalog,
    private readonly sandboxEngine: SandboxEngine,
  ) {}

  async report() {
    const stat = fs.statfsSync(this.root);
    const stateBytes = size(path.join(this.root, 'state'));
    const packBytes = size(path.join(this.root, 'packs'));
    const cacheBytes = size(path.join(this.root, 'cache'));
    const runtimeBytes = size(path.join(this.root, 'runtime'));
    const quarantineBytes = size(path.join(this.root, 'quarantine'));
    const environments = this.journal.environments();
    const byEnvironment = environments.map((environment) => ({
      environmentId: environment.environmentId,
      runtimeBytes: this.sandboxEngine.runtimeBytes(environment.environmentId, environment.generation),
      status: environment.status,
    }));
    const runtimeReclaimableBytes = byEnvironment.reduce((total, item) => {
      const environment = environments.find((candidate) => candidate.environmentId === item.environmentId);
      return (
        total +
        (environment && !environment.retained && ['stopped', 'deleted', 'failed'].includes(environment.status)
          ? item.runtimeBytes
          : 0)
      );
    }, 0);
    const active = environments.filter((environment) => !['deleted', 'failed'].includes(environment.status));
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
          inUse: active.some((environment) =>
            environment.packs.some(
              (candidate) =>
                candidate.familyId === pack.familyId &&
                candidate.versionId === pack.versionId &&
                candidate.contentDigest === digest,
            ),
          ),
        },
      ];
    });
    const sandboxOverheadBytes = await this.sandboxEngine.overheadBytes(this.catalog.load().runtimeDigest);
    return {
      stateBytes,
      packBytes,
      cacheBytes,
      runtimeBytes,
      quarantineBytes,
      sandboxOverheadBytes,
      reclaimableBytes: cacheBytes + runtimeReclaimableBytes,
      byPack,
      byEnvironment,
      filesystem: { totalBytes: stat.blocks * stat.bsize, freeBytes: stat.bavail * stat.bsize },
    };
  }
}
