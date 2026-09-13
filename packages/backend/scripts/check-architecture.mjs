import fs from 'node:fs';
import path from 'node:path';

const srcRoot = path.resolve('src');
const sourceFiles = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.name.endsWith('.ts')) sourceFiles.push(fullPath);
  }
}
walk(srcRoot);

const fileSet = new Set(sourceFiles.map((file) => path.normalize(file)));
const graph = new Map(sourceFiles.map((file) => [path.normalize(file), []]));
const moduleGraph = new Map();
const failures = [];
const importPattern = /(import\s+type\s+[^;]*?from\s+|from\s+|import\s*\()(['"])([^'"]+)\2/g;

const allowedLayers = {
  shared: new Set(['shared']),
  config: new Set(['config', 'shared']),
  platform: new Set(['platform', 'shared']),
  modules: new Set(['modules', 'platform', 'shared']),
  infrastructure: new Set(['infrastructure', 'platform', 'shared']),
  interfaces: new Set(['interfaces', 'modules', 'platform', 'shared']),
  bootstrap: new Set(['bootstrap', 'config', 'infrastructure', 'interfaces', 'modules', 'platform', 'shared']),
};

function layerOf(file) {
  const relative = path.relative(srcRoot, file).split(path.sep);
  if (relative.length === 1) return 'root';
  return relative[0];
}

function moduleOf(file) {
  const relative = path.relative(srcRoot, file).split(path.sep);
  return relative[0] === 'modules' && relative.length > 1 ? relative[1] : null;
}

function agentAreaOf(file) {
  const relative = path.relative(srcRoot, file).split(path.sep);
  if (relative[0] !== 'modules' || relative[1] !== 'agent') return null;
  const area = relative[2];
  if (!area || area.endsWith('.ts')) return 'root';
  if (area === 'apps') return 'apps';
  return area;
}

const allowedAgentAreas = {
  root: new Set(['root', 'host']),
  host: new Set(['root', 'host']),
  ai: new Set(['root', 'host', 'ai']),
  capabilities: new Set(['root', 'host', 'capabilities']),
  tools: new Set(['root', 'host', 'ai', 'capabilities', 'workspace-runtime', 'runtime', 'tools']),
  'workspace-runtime': new Set(['root', 'host', 'workspace-runtime']),
  exchange: new Set(['root', 'host', 'ai', 'workspace-runtime', 'exchange']),
  runtime: new Set(['root', 'host', 'ai', 'capabilities', 'runtime']),
  apps: new Set(['root', 'host', 'ai', 'capabilities', 'workspace-runtime', 'runtime', 'apps']),
};

const allowedRuntimeSubdomains = new Set([
  'approvals',
  'collaboration',
  'definitions',
  'events',
  'execution',
  'planning',
  'recovery',
  'runs',
  'scheduling',
]);

for (const file of sourceFiles) {
  const relativeParts = path.relative(srcRoot, file).split(path.sep);
  if (relativeParts[0] !== 'modules' || relativeParts[1] !== 'agent' || relativeParts[2] !== 'runtime') continue;
  if (relativeParts.length < 5) {
    failures.push(
      `${path.relative(srcRoot, file).split(path.sep).join('/')}: Agent runtime implementation must live in an explicit runtime subdomain`,
    );
    continue;
  }
  if (!allowedRuntimeSubdomains.has(relativeParts[3])) {
    failures.push(`${relative(file)}: unknown Agent runtime subdomain ${relativeParts[3]}`);
  }
}

function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')].map((candidate) => path.normalize(candidate));
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const fromLayer = layerOf(file);
  const relativeFile = path.relative(srcRoot, file).split(path.sep).join('/');
  if (relativeFile.startsWith('modules/agent/runtime/') && /\bmarkMutation(?:Active|Settled)\b/.test(text)) {
    failures.push(`${relativeFile}: Agent Runtime may not call low-level mutation lease markers directly`);
  }
  if (/\bRunRepositoryPort\b|\bcreatedQueue\b/.test(text)) {
    failures.push(
      `${relativeFile}: broad/dead Run repository capability is forbidden; depend on a narrow Run reader port`,
    );
  }
  const snapshotOnlyRunReaders = new Set([
    'modules/agent/runtime/approvals/approval.service.ts',
    'modules/agent/runtime/collaboration/subagent-participant-executor.ts',
    'modules/agent/runtime/planning/plan-tool.ts',
    'modules/agent/runtime/planning/plan.service.ts',
    'modules/agent/runtime/recovery/checkpoint.service.ts',
  ]);
  if (
    snapshotOnlyRunReaders.has(relativeFile) &&
    /\b(?:RunQueryPort|RunListReaderPort|RunEventReaderPort|HostCursorReaderPort|RunExecutionReaderPort)\b/.test(text)
  ) {
    failures.push(`${relativeFile}: this consumer may only depend on RunSnapshotReaderPort`);
  }
  const narrowStateCommitConsumers = new Set([
    'modules/agent/runtime/approvals/approval.service.ts',
    'modules/agent/runtime/runs/run.service.ts',
    'modules/agent/runtime/collaboration/subagent-participant-executor.ts',
    'modules/agent/runtime/planning/plan.service.ts',
    'modules/agent/runtime/recovery/checkpoint.service.ts',
    'modules/agent/runtime/execution/native-agent-backend.ts',
    'bootstrap/agent/lifecycle-sweeps.ts',
  ]);
  if (narrowStateCommitConsumers.has(relativeFile) && /\bStateCommitPort\b/.test(text)) {
    failures.push(`${relativeFile}: depend on a capability-specific StateCommit view, not the full StateCommitPort`);
  }
  if (relativeFile === 'modules/agent/runtime/execution/native-agent-backend.ts') {
    const forbiddenExecutionDependencies = [
      'ContextService',
      'LanguageModelPort',
      'ProviderService',
      'ToolCatalog',
      'ToolExecutor',
      'PolicyService',
      'ModelCallLimiter',
      'LeaseCoordinator',
      'LeasePort',
    ];
    for (const symbol of forbiddenExecutionDependencies) {
      if (new RegExp(`\\b${symbol}\\b`).test(text)) {
        failures.push(
          `${relativeFile}: NativeAgentBackend must depend on ModelStepRunner/ToolCallRunner instead of ${symbol}`,
        );
      }
    }
    if (/\bDelegationRepositoryPort\b/.test(text)) {
      failures.push(`${relativeFile}: NativeAgentBackend may only depend on DelegationReaderPort`);
    }
    if (
      /\b(?:RunQueryPort|RunListReaderPort|RunEventReaderPort|HostCursorReaderPort|RunSnapshotReaderPort)\b/.test(text)
    ) {
      failures.push(`${relativeFile}: NativeAgentBackend may only depend on RunExecutionReaderPort`);
    }
  }
  if (relativeFile === 'modules/agent/runtime/collaboration/subagent.service.ts') {
    if (/\b(?:RunQueryPort|RunListReaderPort|RunEventReaderPort|RunExecutionReaderPort)\b/.test(text)) {
      failures.push(`${relativeFile}: SubagentService may only depend on RunSnapshotReaderPort + HostCursorReaderPort`);
    }
  }
  if (relativeFile === 'modules/agent/runtime/collaboration/subagent-scheduler.ts') {
    const forbiddenSchedulerDependencies = [
      'ProviderService',
      'LanguageModelPort',
      'ModelCallLimiter',
      'StateCommitPort',
      'ToolCatalog',
      'ToolExecutor',
      'LeaseCoordinator',
      'DelegationRepositoryPort',
      'RuntimeParticipantRepositoryPort',
      'MailboxRepositoryPort',
      'RunRepositoryPort',
      'MailboxService',
      'AgentEventHub',
      'SchedulerWorkExecutionPort',
    ];
    for (const symbol of forbiddenSchedulerDependencies) {
      if (new RegExp(`\\b${symbol}\\b`).test(text)) {
        failures.push(
          `${relativeFile}: SubagentScheduler must own scheduling/claim only; participant execution dependency ${symbol} belongs in SubagentParticipantExecutor`,
        );
      }
    }
    if (/\bRelationalDatabase\b|\.transaction\s*\(/.test(text)) {
      failures.push(`${relativeFile}: SubagentScheduler may not own persistence transactions`);
    }
  }
  if (relativeFile === 'modules/agent/runtime/collaboration/subagent-participant-executor.ts') {
    const forbiddenParticipantCapabilities = [
      'SchedulerWorkClaimPort',
      'DelegationRepositoryPort',
      'MailboxRepositoryPort',
    ];
    for (const symbol of forbiddenParticipantCapabilities) {
      if (new RegExp(`\\b${symbol}\\b`).test(text)) {
        failures.push(
          `${relativeFile}: participant executor must use the narrow execution capability instead of ${symbol}`,
        );
      }
    }
    if (/\b(?:readyWork|terminalWork|claimWork|resetClaimedWork)\b/.test(text)) {
      failures.push(`${relativeFile}: durable scheduler scan/claim authority must remain in SubagentScheduler`);
    }
  }
  if (relativeFile === 'modules/agent/runtime/collaboration/subagent-context-builder.ts') {
    if (/\bMailboxRepositoryPort\b/.test(text)) {
      failures.push(`${relativeFile}: context builder may only depend on MailboxReaderPort`);
    }
  }
  if (relativeFile === 'modules/agent/runtime/collaboration/mailbox.service.ts') {
    if (/\bDelegationRepositoryPort\b/.test(text)) {
      failures.push(`${relativeFile}: MailboxService may only depend on DelegationReaderPort`);
    }
  }
  if (/^infrastructure\/agent\/runtime\/state-commit\/.*-transitions\.ts$/.test(relativeFile)) {
    if (/\.transaction\s*\(/.test(text)) {
      failures.push(
        `${relativeFile}: StateCommit transition modules must use the transaction context supplied by the adapter`,
      );
    }
    for (const match of text.matchAll(/export const\s+(\w+Transition)\s*=\s*async\s*\(/g)) {
      const signature = text.slice(match.index, match.index + 320);
      if (!/=\s*async\s*\(\s*tx:\s*RelationalDatabase\b/.test(signature)) {
        failures.push(`${relativeFile}: ${match[1]} must receive tx: RelationalDatabase as its first parameter`);
      }
    }
  }
  if (
    relativeFile === 'interfaces/http/agent/app-runtime.routes.ts' ||
    relativeFile === 'interfaces/http/agent/app-approvals.routes.ts'
  ) {
    if (!text.includes('./agent-runtime-route-input')) {
      failures.push(`${relativeFile}: versioned Agent Runtime mutation bodies must use agent-runtime-route-input`);
    }
    if (/request\.body\s*(?:\.|\[)/.test(text)) {
      failures.push(`${relativeFile}: route handlers may not inspect Runtime mutation body fields directly`);
    }
  }
  if (relativeFile.startsWith('bootstrap/agent/')) {
    for (const symbol of ['PuppeteerBrowserGateway', 'BrowserEndpointPort']) {
      if (text.includes(symbol)) {
        failures.push(
          `${relativeFile}: obsolete raw Browser/CDP symbol ${symbol} may not enter production composition`,
        );
      }
    }
  }
  if (relativeFile === 'bootstrap/agent/compose-agent.ts') {
    const operationsToolCreators = [
      'createDiagnosticsTool',
      'createReadFileTool',
      'createWriteFileTool',
      'createShellTool',
      'createDockerMutationTool',
      'createWorkspaceJobTool',
      'createWorkspaceCreateTool',
      'createWorkspaceControlTool',
      'createWorkspaceSwitchToolVersionsTool',
      'createCollaborationTools',
      'createMcpTools',
      'createAcpExecuteTool',
      'createBrowserTools',
      'createPlanUpdateTool',
    ];
    for (const symbol of operationsToolCreators) {
      if (new RegExp(`\\b${symbol}\\b`).test(text)) {
        failures.push(`${relativeFile}: Tool creator ${symbol} must stay behind bootstrap tool-contribution helpers`);
      }
    }
    if (/\.(?:registerContribution|replaceOwnedContribution)\s*\(/.test(text)) {
      failures.push(`${relativeFile}: Tool contribution metadata must stay behind bootstrap tool-contribution helpers`);
    }
  }
  importPattern.lastIndex = 0;
  for (let match = importPattern.exec(text); match; match = importPattern.exec(text)) {
    const importPrefix = match[1];
    const specifier = match[3];
    const isTypeOnlyImport = importPrefix.startsWith('import type');
    const target = resolveLocalImport(file, specifier);
    if (target) {
      graph.get(path.normalize(file)).push(target);
      const targetLayer = layerOf(target);
      const fromAgentArea = agentAreaOf(file);
      const targetAgentArea = agentAreaOf(target);
      if (fromAgentArea && targetAgentArea) {
        const allowedAreas = allowedAgentAreas[fromAgentArea];
        const publicContractTypeImport =
          relativeFile === 'modules/agent/public.ts' &&
          (targetAgentArea === 'ai' ||
            targetAgentArea === 'runtime' ||
            targetAgentArea === 'workspace-runtime' ||
            targetAgentArea === 'exchange') &&
          isTypeOnlyImport &&
          /(?:\.port|\.types)$/.test(specifier);
        if (!allowedAreas?.has(targetAgentArea) && !publicContractTypeImport) {
          failures.push(
            `${relativeFile}: forbidden Agent ${fromAgentArea} -> ${targetAgentArea} dependency (${specifier})`,
          );
        }
      }
      const fromModule = moduleOf(file);
      const targetModule = moduleOf(target);
      if (fromModule && targetModule && fromModule !== targetModule) {
        const dependencies = moduleGraph.get(fromModule) ?? new Set();
        dependencies.add(targetModule);
        moduleGraph.set(fromModule, dependencies);
        if (!moduleGraph.has(targetModule)) moduleGraph.set(targetModule, new Set());
      }
      if (fromLayer === 'root') {
        if (relativeFile === 'index.ts' && targetLayer !== 'bootstrap') {
          failures.push(`${relativeFile}: root entrypoint may only import bootstrap (found ${targetLayer})`);
        }
      } else {
        const allowed = allowedLayers[fromLayer];
        const infrastructureDomainPort =
          fromLayer === 'infrastructure' &&
          targetLayer === 'modules' &&
          isTypeOnlyImport &&
          /(?:\.port|\.types)$/.test(specifier);
        if (allowed && !allowed.has(targetLayer) && !infrastructureDomainPort) {
          failures.push(`${relativeFile}: forbidden ${fromLayer} -> ${targetLayer} dependency (${specifier})`);
        }
      }
    }

    if ((fromLayer === 'platform' || fromLayer === 'modules') && ['express', 'ws', 'ssh2'].includes(specifier)) {
      failures.push(`${relativeFile}: ${fromLayer} may not import technology package ${specifier}`);
    }
  }
}

const compileTimeOperationsRoot = path.join(srcRoot, 'modules/agent/apps/operations');
if (fs.existsSync(compileTimeOperationsRoot)) {
  failures.push(
    'modules/agent/apps/operations: nexus.operations is an independently signed first-party Plugin and must not be compiled into the Nexus Backend',
  );
}
const obsoleteBrowserAdapterPath = path.join(srcRoot, 'infrastructure/agent/integrations/browser-gateway.adapter.ts');
if (fs.existsSync(obsoleteBrowserAdapterPath)) {
  failures.push(
    'infrastructure/agent/integrations/browser-gateway.adapter.ts: obsolete BrowserGateway adapter must not reappear; BrowserRuntimeAdapter is the single Browser/CDP owner',
  );
}

const browserRuntimePath = path.join(srcRoot, 'infrastructure/agent/integrations/browser-runtime.adapter.ts');
if (!fs.existsSync(browserRuntimePath)) {
  failures.push(
    'infrastructure/agent/integrations/browser-runtime.adapter.ts: live Browser capability requires the Backend BrowserRuntime owner',
  );
} else {
  const browserRuntimeSource = fs.readFileSync(browserRuntimePath, 'utf8');
  if (!browserRuntimeSource.includes("from 'puppeteer-core'")) {
    failures.push(
      'infrastructure/agent/integrations/browser-runtime.adapter.ts: Backend BrowserRuntime must own puppeteer-core',
    );
  }
}
const agentRunnerPackagePath = path.resolve('../agent-runner/package.json');
if (fs.existsSync(agentRunnerPackagePath)) {
  const agentRunnerPackage = JSON.parse(fs.readFileSync(agentRunnerPackagePath, 'utf8'));
  if (agentRunnerPackage.dependencies?.['puppeteer-core'] || agentRunnerPackage.devDependencies?.['puppeteer-core']) {
    failures.push(
      'packages/agent-runner/package.json: Runner must remain a Browser transport/tunnel only and may not depend on puppeteer-core',
    );
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycleKeys = new Set();

function visit(file) {
  if (visited.has(file)) return;
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file];
    const labels = cycle.map((item) => path.relative(srcRoot, item).split(path.sep).join('/'));
    const key = [...new Set(labels)].sort().join('|');
    if (!cycleKeys.has(key)) {
      cycleKeys.add(key);
      failures.push(`circular dependency: ${labels.join(' -> ')}`);
    }
    return;
  }
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}
for (const file of sourceFiles) visit(path.normalize(file));

const moduleVisiting = new Set();
const moduleVisited = new Set();
const moduleStack = [];
const moduleCycleKeys = new Set();

function visitModule(moduleName) {
  if (moduleVisited.has(moduleName)) return;
  if (moduleVisiting.has(moduleName)) {
    const start = moduleStack.indexOf(moduleName);
    const cycle = [...moduleStack.slice(start), moduleName];
    const key = [...new Set(cycle)].sort().join('|');
    if (!moduleCycleKeys.has(key)) {
      moduleCycleKeys.add(key);
      failures.push(`module dependency cycle: ${cycle.join(' -> ')}`);
    }
    return;
  }
  moduleVisiting.add(moduleName);
  moduleStack.push(moduleName);
  for (const dependency of moduleGraph.get(moduleName) ?? []) visitModule(dependency);
  moduleStack.pop();
  moduleVisiting.delete(moduleName);
  moduleVisited.add(moduleName);
}
for (const moduleName of moduleGraph.keys()) visitModule(moduleName);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `Architecture check passed: ${sourceFiles.length} files, no forbidden layer edges, no source cycles, no module cycles.`,
);
