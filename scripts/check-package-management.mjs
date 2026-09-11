import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(repoRoot, relative));

const rootPackage = JSON.parse(read('package.json'));
if (!/^pnpm@\d+\.\d+\.\d+$/.test(String(rootPackage.packageManager ?? ''))) {
  failures.push('package.json: packageManager must pin an exact pnpm version');
}
if (!exists('pnpm-workspace.yaml')) failures.push('pnpm-workspace.yaml is required at repository root');
if (!exists('pnpm-lock.yaml')) failures.push('pnpm-lock.yaml is required at repository root');

const workspaceText = exists('pnpm-workspace.yaml') ? read('pnpm-workspace.yaml') : '';
for (const pattern of ['packages/*', 'test/e2e']) {
  if (!workspaceText.includes(`- ${pattern}`))
    failures.push(`pnpm-workspace.yaml: missing workspace member pattern ${pattern}`);
}

const packageRoots = ['.', 'packages/agent-runtime', 'packages/backend', 'packages/frontend', 'test/e2e'];
for (const relative of packageRoots) {
  for (const lockName of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock']) {
    const candidate = relative === '.' ? lockName : `${relative}/${lockName}`;
    if (exists(candidate)) failures.push(`${candidate}: workspace package roots must use only root pnpm-lock.yaml`);
  }
  if (relative !== '.') {
    const nestedPnpmLock = `${relative}/pnpm-lock.yaml`;
    if (exists(nestedPnpmLock)) failures.push(`${nestedPnpmLock}: nested pnpm lockfile is not allowed`);
  }
}

const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(String(rootPackage.packageManager ?? ''))?.[1];
if (pnpmVersion && exists('test/e2e/Dockerfile.runner')) {
  const runner = read('test/e2e/Dockerfile.runner');
  if (!runner.includes(`ARG PNPM_VERSION=${pnpmVersion}`)) {
    failures.push('test/e2e/Dockerfile.runner: PNPM_VERSION default must match root packageManager');
  }
}

const engineeringFiles = [
  'Dockerfile',
  'scripts/build/build.sh',
  'scripts/docker/agent-runtime/Dockerfile',
  'scripts/e2e/build-runner-image.sh',
  'scripts/e2e/docker-deployment-smoke.sh',
  'scripts/e2e/resolve-latest-test-environment.mjs',
  'scripts/e2e/sync-test-environment.mjs',
  'test/e2e/Dockerfile.runner',
  'test/e2e/playwright.config.ts',
  'test/e2e/support/groups.mjs',
  'test/e2e/support/run-functional-screenshots.mjs',
  '.github/workflows/e2e.yml',
  '.github/workflows/publish-ghcr.yml',
  '.github/workflows/update-dependencies.yml',
];
const forbiddenEngineeringPatterns = [
  [/\bnpm\s+(?:ci|install|run|exec|audit|update|pkg)\b/, 'npm CLI package-management command'],
  [/\bnpm\s+--prefix\b/, 'npm --prefix'],
  [/\bnpx\s+/, 'npx executor'],
  [/package-lock\.json/, 'package-lock.json'],
  [/cache:\s*npm\b/, 'npm Actions cache'],
];
for (const relative of engineeringFiles) {
  if (!exists(relative)) continue;
  const content = read(relative);
  for (const [pattern, label] of forbiddenEngineeringPatterns) {
    if (pattern.test(content)) failures.push(`${relative}: forbidden ${label}; use the root pnpm workspace`);
  }
}

for (const relative of [
  'package.json',
  'packages/agent-runtime/package.json',
  'packages/backend/package.json',
  'packages/frontend/package.json',
  'test/e2e/package.json',
]) {
  const manifest = JSON.parse(read(relative));
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (/\bnpm\s/.test(String(command)))
      failures.push(`${relative}#scripts.${name}: use pnpm/workspace commands instead of npm`);
  }
}

if (failures.length) {
  console.error('Package-management architecture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  'Package-management architecture check passed: one pnpm workspace, one root lockfile, no npm install paths.',
);
