import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const versions = JSON.parse(fs.readFileSync(path.join(scriptDir, 'versions.json'), 'utf8'));

if (!/^\d+$/.test(String(versions.node))) throw new Error(`Invalid Node major: ${versions.node}`);
if (!/^\d+\.\d+\.\d+/.test(String(versions.playwright))) {
  throw new Error(`Invalid Playwright version: ${versions.playwright}`);
}

const definitionFiles = [
  'test/e2e/Dockerfile.runner',
  'scripts/e2e/build-runner-image.sh',
  'scripts/e2e/runner-image-info.mjs',
];
const hash = crypto.createHash('sha256');
hash.update(`node=${versions.node}\nplaywright=${versions.playwright}\n`);
for (const relative of definitionFiles) {
  hash.update(`file=${relative}\n`);
  hash.update(fs.readFileSync(path.join(repoRoot, relative)));
  hash.update('\n');
}

const info = {
  node: String(versions.node),
  playwright: String(versions.playwright),
  tag: `playwright-${versions.playwright}-node${versions.node}`,
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
