import fs from 'node:fs';
import path from 'node:path';
import { EnvironmentCatalog } from './controller/environment-catalog';
import { RunnerJournal } from './controller/journal';
import { SandboxEngine } from './controller/sandbox-engine';
import { ToolchainStore } from './controller/toolchain-store';
import { PackInstaller } from './controller/pack-installer';
import { QuotaManager } from './controller/quota-manager';
import { SpaceReporter } from './controller/space-reporter';
import { CleanupPlanner } from './controller/cleanup-planner';
import { Reconciler } from './controller/reconciler';
import { CertificateManager } from './controller/certificate-manager';
import { RunnerControllerServer } from './controller/server';
import { PluginRunnerRuntime } from './controller/plugin-runner-runtime';

const main = async (): Promise<void> => {
  const root = process.env.NEXUS_AGENT_RUNNER_ROOT?.trim() || '/var/lib/nexus-agent-runner';
  for (const name of ['state', 'packs', 'cache', 'runtime', 'quarantine']) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  const catalogFile = process.env.NEXUS_AGENT_CATALOG?.trim() || '/app/catalog/catalog.json';
  const deploymentId = process.env.NEXUS_AGENT_DEPLOYMENT_ID?.trim() || 'nexus-local';
  const token = new CertificateManager(process.env.NEXUS_AGENT_RUNNER_TOKEN_FILE).token(
    process.env.NEXUS_AGENT_RUNNER_TOKEN,
  );
  const catalog = new EnvironmentCatalog(catalogFile);
  const journal = new RunnerJournal(path.join(root, 'state', 'journal.json'));
  const sandboxEngine = new SandboxEngine(
    path.join(root, 'runtime'),
    path.join(root, 'packs'),
    process.env.NEXUS_AGENT_SANDBOX_BIN?.trim() || undefined,
  );
  const store = new ToolchainStore(path.join(root, 'packs'));
  const installer = new PackInstaller(catalog, store, path.join(root, 'cache'));
  const quota = new QuotaManager({
    maxMemoryBytes: Number(process.env.NEXUS_AGENT_MAX_MEMORY_BYTES || 8 * 1024 * 1024 * 1024),
    maxCpus: Number(process.env.NEXUS_AGENT_MAX_CPUS || 4),
    maxPids: Number(process.env.NEXUS_AGENT_MAX_PIDS || 1024),
    maxTmpfsBytes: Number(process.env.NEXUS_AGENT_MAX_TMPFS_BYTES || 2 * 1024 * 1024 * 1024),
  });
  const storage = new SpaceReporter(root, journal, catalog, sandboxEngine);
  const cleanup = new CleanupPlanner(root, journal, sandboxEngine);
  const pluginRunner = new PluginRunnerRuntime(
    path.join(root, 'runtime'),
    process.env.NEXUS_AGENT_PLUGIN_SOURCE_ROOT?.trim() || '',
    process.env.NEXUS_AGENT_SANDBOX_BIN?.trim() || undefined,
  );
  await new Reconciler(journal, sandboxEngine, pluginRunner).reconcile();
  const server = new RunnerControllerServer({
    token,
    deploymentId,
    catalog,
    journal,
    sandboxEngine,
    installer,
    quota,
    storage,
    cleanup,
    pluginRunner,
  }).createServer();
  const port = Number(process.env.PORT || 8790);
  const host = process.env.NEXUS_AGENT_RUNNER_HOST?.trim() || '127.0.0.1';
  server.listen(port, host, () => console.log(`[nexus-agent-runner] controller listening on ${host}:${port}`));
};

void main().catch((error) => {
  console.error('[nexus-agent-runner] fatal:', error);
  process.exitCode = 1;
});
