import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd(), 'src');
const sourceExtensions = ['.ts', '.tsx', '.js', '.mjs', '.vue'];
const forbiddenLegacyRoots = ['components', 'composables', 'stores', 'views', 'types', 'utils', 'locales', 'router'];
const failures = [];

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
};

const sourceFiles = walk(root).filter((file) => sourceExtensions.includes(path.extname(file)));
const relative = (file) => path.relative(root, file).replaceAll(path.sep, '/');

for (const legacyRoot of forbiddenLegacyRoots) {
  const full = path.join(root, legacyRoot);
  if (fs.existsSync(full)) failures.push(`Legacy frontend root path must not exist: src/${legacyRoot}`);
}

const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const importsByFile = new Map();
for (const file of sourceFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = relative(file);
  const imports = [];
  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) imports.push(specifier);
  }
  importsByFile.set(file, imports);

  if (
    /^features\/[^/]+\/public\.ts$/.test(rel) &&
    /export\s+(?:type\s+)?(?:\{[^;\n]*\}|\*)\s+from\s+['"]\.\/store\//m.test(content)
  ) {
    failures.push(`${rel}: public feature surface must not re-export an internal Pinia store implementation`);
  }

  if (
    rel.startsWith('features/agent/') &&
    rel !== 'features/agent/runtime/run-facade.ts' &&
    /\bagentApi\.(?:run|runs)\s*\(/.test(content)
  ) {
    failures.push(`${rel}: Run HTTP reads must flow through features/agent/runtime/run-facade.ts`);
  }

  if (
    rel === 'features/agent/runtime/WorkspaceRuntimePanel.vue' &&
    /\bagentApi\.(?:workspaceGrants|replaceWorkspaceGrants)\s*\(/.test(content)
  ) {
    failures.push(`${rel}: Workspace grant request lifecycle must flow through workspace-grant-state.ts`);
  }

  if (rel === 'features/agent/runtime/ApprovalCard.vue' && /\bDate\.now\s*\(/.test(content)) {
    failures.push(`${rel}: approval expiry must use the server clock anchor, not the browser wall clock`);
  }

  if (
    (rel === 'features/agent/apps/operations/OperationsView.vue' ||
      rel === 'features/agent/runtime/WorkspaceRuntimePanel.vue') &&
    !content.includes('runtime-operation-state')
  ) {
    failures.push(`${rel}: Runtime mutation errors must flow through runtime-operation-state.ts`);
  }

  if (rel === 'features/agent/apps/operations/OperationsView.vue' && content.includes('../../api/agent-events')) {
    failures.push(`${rel}: active Run event lifecycle must be owned by runtime/run-facade.ts`);
  }

  if (
    rel === 'features/agent/runtime/run-facade.ts' &&
    (!content.includes('agentEvents.run') || !content.includes('selectRun') || !content.includes('dispose'))
  ) {
    failures.push(`${rel}: Run facade must own explicit start/selectRun/dispose subscription lifecycle`);
  }
}

const firstSegment = (rel) => rel.split('/')[0];
const featureName = (rel) => (rel.startsWith('features/') ? rel.split('/')[1] : null);
const runtimeName = (rel) => (rel.startsWith('runtimes/') ? rel.split('/')[1] : null);
const agentArea = (rel) => {
  const parts = rel.split('/');
  if (parts[0] !== 'features' || parts[1] !== 'agent') return null;
  if (parts.length === 3 && parts[2] === 'public.ts') return 'public';
  if (parts[2] === 'apps') return parts[3] ? `apps/${parts[3]}` : 'apps';
  return parts[2] ?? 'root';
};

const allowedAgentAreas = {
  public: new Set(['public', 'api', 'host', 'settings']),
  host: new Set(['host', 'api', 'files']),
  api: new Set(['api', 'host']),
  ai: new Set(['ai', 'api', 'files']),
  files: new Set(['files', 'api']),
  runtime: new Set(['runtime', 'api']),
  settings: new Set(['settings', 'api']),
  'apps/operations': new Set(['apps/operations', 'ai', 'api', 'host', 'runtime']),
};

for (const [file, imports] of importsByFile) {
  const rel = relative(file);
  const layer = firstSegment(rel);
  const ownerFeature = featureName(rel);
  const ownerRuntime = runtimeName(rel);

  for (const specifier of imports) {
    if (layer === 'client') {
      if (
        /^@\/(?:app|features|runtimes|shared)\//.test(specifier) ||
        /^(?:pinia|vue-router|vue-i18n)(?:\/|$)/.test(specifier)
      ) {
        failures.push(`${rel}: client transport must not import product/application state: ${specifier}`);
      }
    }

    if (layer === 'foundation') {
      if (
        /^@\/(?:app|client|features|runtimes|shared)\//.test(specifier) ||
        /^(?:pinia|vue-router|vue-i18n)(?:\/|$)/.test(specifier)
      ) {
        failures.push(`${rel}: foundation must remain product-agnostic: ${specifier}`);
      }
    }

    if (layer === 'shared') {
      if (/^@\/(?:app|features|runtimes)\//.test(specifier)) {
        failures.push(`${rel}: shared code must not depend on product owners: ${specifier}`);
      }
    }

    if (ownerFeature) {
      if (/^@\/(?:app|runtimes)\//.test(specifier)) {
        failures.push(`${rel}: lower-level feature must not depend on App/runtime: ${specifier}`);
      }

      const crossFeature = specifier.match(/^@\/features\/([^/]+)\/(.+)$/);
      if (crossFeature && crossFeature[1] !== ownerFeature && !/^public(?:\.ts)?$/.test(crossFeature[2])) {
        failures.push(`${rel}: cross-feature imports must use features/${crossFeature[1]}/public.ts: ${specifier}`);
      }
    }

    if (ownerRuntime === 'workspace' && /^@\/runtimes\/agent(?:\/|$)/.test(specifier)) {
      failures.push(`${rel}: Workspace runtime must not import Agent runtime: ${specifier}`);
    }
    if (ownerRuntime === 'agent' && /^@\/runtimes\/workspace(?:\/|$)/.test(specifier)) {
      failures.push(`${rel}: Agent runtime must not import Workspace runtime: ${specifier}`);
    }
  }
}

const resolveInternalImport = (fromFile, specifier) => {
  let base;
  if (specifier.startsWith('@/')) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const candidates = [
    base,
    ...sourceExtensions.map((ext) => `${base}${ext}`),
    ...sourceExtensions.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => sourceFiles.includes(candidate)) ?? null;
};

const graph = new Map(sourceFiles.map((file) => [file, []]));
for (const [file, imports] of importsByFile) {
  for (const specifier of imports) {
    const target = resolveInternalImport(file, specifier);
    if (!target) continue;
    graph.get(file).push(target);

    const fromAgentArea = agentArea(relative(file));
    const targetAgentArea = agentArea(relative(target));
    if (fromAgentArea && targetAgentArea) {
      const allowed = allowedAgentAreas[fromAgentArea];
      const builtinAppPublicImport =
        relative(file) === 'features/agent/host/builtin-apps.ts' &&
        /^features\/agent\/apps\/[^/]+\/public\.ts$/.test(relative(target));
      if (!allowed) {
        failures.push(`${relative(file)}: unknown Agent frontend area ${fromAgentArea}`);
      } else if (!allowed.has(targetAgentArea) && !builtinAppPublicImport) {
        failures.push(
          `${relative(file)}: forbidden Agent frontend ${fromAgentArea} -> ${targetAgentArea} dependency (${specifier})`,
        );
      }
    }
  }
}

const state = new Map();
const stack = [];
const reportedCycles = new Set();
const visit = (file) => {
  const currentState = state.get(file) ?? 0;
  if (currentState === 2) return;
  if (currentState === 1) return;

  state.set(file, 1);
  stack.push(file);
  for (const target of graph.get(file) ?? []) {
    if ((state.get(target) ?? 0) === 1) {
      const start = stack.indexOf(target);
      const cycle = [...stack.slice(start), target].map(relative);
      const key = cycle.join(' -> ');
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        failures.push(`Frontend dependency cycle: ${key}`);
      }
      continue;
    }
    visit(target);
  }
  stack.pop();
  state.set(file, 2);
};

for (const file of sourceFiles) visit(file);

if (failures.length) {
  console.error('Frontend architecture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Frontend architecture check passed: ${sourceFiles.length} source files, no forbidden dependency cycles.`);
