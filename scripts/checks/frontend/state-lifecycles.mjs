import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.resolve(root, 'packages/frontend/src');
const scanRoots = ['features', 'runtimes', 'shared'].map((name) => path.join(sourceRoot, name));
const explicitReactiveOwners = new Set([
  'packages/frontend/src/features/remote-desktop/state/remoteDesktopLauncher.ts',
  'packages/frontend/src/runtimes/workspace/session/workspaceRuntimeRegistry.ts',
]);

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(child);
  }
  return files;
};

const moduleReactivePattern =
  /^(?:const|let)\s+[A-Za-z_$][\w$]*(?:\s*:[^=\n]+)?\s*=\s*(?:ref|shallowRef|reactive)(?:<[^\n;]+>)?\(/gmu;
const storeMutableLetPattern = /^let\s+[A-Za-z_$][\w$]*/gmu;
const storeMutableCollectionPattern =
  /^const\s+[A-Za-z_$][\w$]*(?:\s*:[^=\n]+)?\s*=\s*new\s+(?:Map|Set)(?:<[^\n;]+>)?\(/gmu;

const findings = [];
const files = (await Promise.all(scanRoots.map(walk))).flat();
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const text = await readFile(file, 'utf8');

  if (!explicitReactiveOwners.has(relative)) {
    moduleReactivePattern.lastIndex = 0;
    let match;
    while ((match = moduleReactivePattern.exec(text))) {
      findings.push({
        file: relative,
        line: text.slice(0, match.index).split('\n').length,
        reason: 'module-scope Vue reactive state must live in an explicit store, registry/service owner, or factory',
      });
    }
  }

  if (!file.endsWith('.store.ts')) continue;
  const defineStoreIndex = text.indexOf('defineStore(');
  if (defineStoreIndex < 0) continue;
  const prefix = text.slice(0, defineStoreIndex);
  for (const pattern of [storeMutableLetPattern, storeMutableCollectionPattern]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(prefix))) {
      findings.push({
        file: relative,
        line: prefix.slice(0, match.index).split('\n').length,
        reason: 'mutable store lifecycle state must be owned by the defineStore closure, not the import module',
      });
    }
  }
}

if (findings.length) {
  console.error('Frontend state lifecycle guard failed:');
  for (const finding of findings) console.error(`- ${finding.file}:${finding.line}: ${finding.reason}.`);
  process.exit(1);
}

console.log(
  `Frontend state lifecycle guard passed (${files.length} feature/runtime/shared TypeScript files inspected; ${explicitReactiveOwners.size} explicit reactive owners allowed).`,
);
