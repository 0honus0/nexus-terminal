import assert from 'node:assert/strict';
import { PluginPackageInstallCoordinator } from '../../packages/backend/src/modules/agent/host/plugin-package-install-coordinator';
import type {
  PluginInstallRepositoryPort,
  PluginPendingUpgradeRecord,
  PluginStageRecord,
} from '../../packages/backend/src/modules/agent/host/plugin-install.repository.port';
import type { PackageVerifierPort } from '../../packages/backend/src/modules/agent/host/package-verifier.port';
import type { ClockPort } from '../../packages/backend/src/modules/agent/agent.types';

const now = 2_000_000;
const day = 24 * 60 * 60;

const stage = (
  id: string,
  userId: number,
  status: PluginStageRecord['status'],
  updatedAt: number,
): PluginStageRecord => ({
  id,
  userId,
  source: { kind: 'artifact', appId: 'source-app', id: `artifact-${id}` },
  packageHash: `hash-${id}`,
  sizeBytes: 1,
  publisherKeyId: null,
  appId: status === 'staged' ? null : 'plugin.app',
  version: status === 'staged' ? null : '1.0.0',
  manifest: null,
  status,
  errorCode: null,
  createdAt: updatedAt,
  updatedAt,
  versionNumber: 1,
});

const rows = new Map<string, PluginStageRecord>([
  ['expired', stage('expired', 1, 'verified', now - day - 1)],
  ['fresh', stage('fresh', 1, 'verified', now - day + 1)],
  ['installed', stage('installed', 2, 'installed', now)],
  ['pending-expired', stage('pending-expired', 1, 'verified', now - day * 2)],
]);

const pending: PluginPendingUpgradeRecord = {
  userId: 1,
  appId: 'plugin.app',
  stageId: 'pending-expired',
  fromVersion: '0.9.0',
  targetVersion: '1.0.0',
  packageHash: 'hash-pending-expired',
  appStateVersion: 1,
  createdAt: now - day * 2,
  updatedAt: now - day * 2,
};

const deleted: string[] = [];
const repository = {
  listStages: async () => [...rows.values()],
  listPendingUpgrades: async (userId: number) => (userId === 1 ? [pending] : []),
  deleteStage: async (userId: number, stageId: string) => {
    const current = rows.get(stageId);
    if (!current || current.userId !== userId) return false;
    rows.delete(stageId);
    deleted.push(stageId);
    return true;
  },
} as unknown as PluginInstallRepositoryPort;

const discarded: string[] = [];
let reconciled: Array<{ stageId: string; appId: string | null }> = [];
const verifier = {
  discardStage: async (stageId: string) => {
    discarded.push(stageId);
  },
  reconcileStages: async (active: readonly { stageId: string; appId: string | null }[]) => {
    reconciled = [...active];
  },
} as unknown as PackageVerifierPort;

const clock: ClockPort = {
  nowUnixSeconds: () => now,
  nowUnixMilliseconds: () => now * 1000,
};

const coordinator = new PluginPackageInstallCoordinator(
  repository,
  verifier,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  clock,
  '1.0.2',
);

const main = async (): Promise<void> => {
  await coordinator.reconcileStages();

  assert.deepEqual(new Set(discarded), new Set(['expired', 'installed']));
  assert.deepEqual(new Set(deleted), new Set(['expired', 'installed']));
  assert.deepEqual(
    new Set(reconciled.map((item) => item.stageId)),
    new Set(['fresh', 'pending-expired']),
    'fresh stages and pending-upgrade continuations must remain active',
  );
  assert(rows.has('pending-expired'), 'pending upgrade stage must be protected from TTL cleanup');

  process.stdout.write('agent plugin stage retention regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
