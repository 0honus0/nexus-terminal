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
  importPattern.lastIndex = 0;
  for (let match = importPattern.exec(text); match; match = importPattern.exec(text)) {
    const importPrefix = match[1];
    const specifier = match[3];
    const isTypeOnlyImport = importPrefix.startsWith('import type');
    const target = resolveLocalImport(file, specifier);
    if (target) {
      graph.get(path.normalize(file)).push(target);
      const targetLayer = layerOf(target);
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

    if (target) {
      const targetRelative = path.relative(srcRoot, target).split(path.sep).join('/');
      if (targetRelative.startsWith('interfaces/http/legacy-api/') && !relativeFile.startsWith('interfaces/http/')) {
        failures.push(
          `${relativeFile}: legacy HTTP compatibility layer may only be imported from interfaces/http (${specifier})`,
        );
      }
      if (
        targetRelative.startsWith('interfaces/websocket/legacy-api/') &&
        !relativeFile.startsWith('interfaces/websocket/')
      ) {
        failures.push(
          `${relativeFile}: legacy WebSocket compatibility layer may only be imported from interfaces/websocket (${specifier})`,
        );
      }
    }

    if ((fromLayer === 'platform' || fromLayer === 'modules') && ['express', 'ws', 'ssh2'].includes(specifier)) {
      failures.push(`${relativeFile}: ${fromLayer} may not import technology package ${specifier}`);
    }
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
