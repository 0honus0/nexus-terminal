import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceRuntimeCatalog } from './controller/workspace-runtime-catalog';
import { RunnerJournal } from './controller/journal';
import { WorkspaceRuntimeEngine } from './controller/workspace-runtime-engine';
import { ToolchainStore } from './controller/toolchain-store';
import { PackInstaller } from './controller/pack-installer';
import { SpaceReporter } from './controller/space-reporter';
import { CleanupPlanner } from './controller/cleanup-planner';
import { Reconciler } from './controller/reconciler';
import { CertificateManager } from './controller/certificate-manager';
import { RunnerControllerServer } from './controller/server';
import { PluginRunnerRuntime } from './controller/plugin-runner-runtime';
import { AcpProcessRuntime } from './controller/acp-process-runtime';
import { WorkspaceTerminalRuntime } from './controller/workspace-terminal-runtime';
import { BrowserTunnelRuntime } from './controller/browser-tunnel-runtime';
import { runnerLog } from './logging';

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
  const catalog = new WorkspaceRuntimeCatalog(catalogFile);
  runnerLog('info', 'Agent Runner starting', { deploymentId, runtimeMode: 'native', isolation: 'logical' });
  const journal = new RunnerJournal(path.join(root, 'state', 'journal.json'));
  const store = new ToolchainStore(path.join(root, 'packs'));
  const runtimeEngine = new WorkspaceRuntimeEngine(path.join(root, 'runtime'), store);
  const installer = new PackInstaller(catalog, store, path.join(root, 'cache'));
  const storage = new SpaceReporter(root, journal, catalog, runtimeEngine);
  const cleanup = new CleanupPlanner(root, journal, runtimeEngine);
  const pluginRunner = new PluginRunnerRuntime(
    path.join(root, 'runtime'),
    process.env.NEXUS_AGENT_PLUGIN_SOURCE_ROOT?.trim() || '',
  );
  await new Reconciler(journal, runtimeEngine, pluginRunner).reconcile();
  const acpRuntime = new AcpProcessRuntime(journal, runtimeEngine);
  const terminalRuntime = new WorkspaceTerminalRuntime(journal, runtimeEngine);
  const browserTunnel = new BrowserTunnelRuntime(journal);
  const server = new RunnerControllerServer({
    token,
    deploymentId,
    catalog,
    journal,
    runtimeEngine,
    installer,
    storage,
    cleanup,
    pluginRunner,
    acpRuntime,
    terminalRuntime,
    browserTunnel,
  }).createServer();
  const port = Number(process.env.PORT || 8790);
  const host = process.env.NEXUS_AGENT_RUNNER_HOST?.trim() || '127.0.0.1';
  server.listen(port, host, () => runnerLog('info', 'Agent Runner controller listening', { host, port, deploymentId }));
};

void main().catch((error) => {
  runnerLog('error', 'Agent Runner fatal startup failure', {
    errorCode: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
