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
  const imports = [];
  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) imports.push(specifier);
  }
  importsByFile.set(file, imports);
}

const firstSegment = (rel) => rel.split('/')[0];
const featureName = (rel) => (rel.startsWith('features/') ? rel.split('/')[1] : null);
const runtimeName = (rel) => (rel.startsWith('runtimes/') ? rel.split('/')[1] : null);

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
    if (target) graph.get(file).push(target);
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
