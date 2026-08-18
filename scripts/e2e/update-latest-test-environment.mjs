import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const versionsPath = path.join(scriptDir, 'versions.json');
const resolveScript = path.join(scriptDir, 'resolve-latest-test-environment.mjs');
const syncScript = path.join(scriptDir, 'sync-test-environment.mjs');
const tempPath = path.join(os.tmpdir(), `nexus-e2e-versions-${process.pid}.json`);

function runNode(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: process.env,
  });
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit ${result.status}`);
  return result.stdout || '';
}

try {
  const resolved = runNode(resolveScript, [], { capture: true });
  JSON.parse(resolved);
  fs.writeFileSync(tempPath, resolved, 'utf8');
  fs.copyFileSync(tempPath, versionsPath);
  runNode(syncScript);
} finally {
  fs.rmSync(tempPath, { force: true });
}
