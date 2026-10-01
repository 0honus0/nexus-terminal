import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const rootPackage = readJson('package.json');
const e2ePackage = readJson('tests/e2e/package.json');

const nodeVersion = '24';
const pnpmVersion = /^pnpm@(.+)$/.exec(String(rootPackage.packageManager ?? ''))?.[1];
const playwrightVersion = e2ePackage.devDependencies?.['@playwright/test'];

if (!pnpmVersion) throw new Error(`Invalid root packageManager: ${rootPackage.packageManager}`);
if (!/^\d+\.\d+\.\d+$/.test(String(playwrightVersion))) {
  throw new Error(`Invalid Playwright version: ${playwrightVersion}`);
}

const definitionFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'packages/backend/package.json',
  'packages/frontend/package.json',
  'packages/protocol/package.json',
  'packages/agent-runner/package.json',
  'tests/e2e/package.json',
  'tests/e2e/Dockerfile.runner',
  'scripts/e2e/build-runner-image.sh',
  'scripts/e2e/runner-image-info.mjs',
  ...fs
    .readdirSync(path.join(repoRoot, 'scripts/patches'))
    .sort()
    .map((name) => `scripts/patches/${name}`),
];
const hash = crypto.createHash('sha256');
hash.update(`node=${nodeVersion}\nplaywright=${playwrightVersion}\npnpm=${pnpmVersion}\n`);
for (const relativePath of definitionFiles) {
  hash.update(`file=${relativePath}\n`);
  hash.update(fs.readFileSync(path.join(repoRoot, relativePath)));
  hash.update('\n');
}

const info = {
  node: nodeVersion,
  playwright: playwrightVersion,
  pnpm: pnpmVersion,
  fingerprint: hash.digest('hex'),
};

const field = process.argv[2];
if (!field || field === 'json') {
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
} else if (Object.hasOwn(info, field)) {
  process.stdout.write(`${info[field]}\n`);
} else {
  throw new Error(`Unknown runner image info field: ${field}`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}
