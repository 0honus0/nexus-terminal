import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(e2eRoot, '../..');
const stagingDir = path.join(e2eRoot, '.tmp', 'manual-functional-screenshots');
const targetDir = path.join(repoRoot, 'doc', 'imgs', 'e2e');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'functional-screenshot-manifest.json'), 'utf8'));

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test'],
  {
    cwd: e2eRoot,
    env: {
      ...process.env,
      E2E_CAPTURE_SCREENSHOTS: '1',
      E2E_SCREENSHOT_OUTPUT_DIR: stagingDir,
    },
    stdio: 'inherit',
  },
);

if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const actual = fs.readdirSync(stagingDir).filter((name) => name.endsWith('.png')).sort();
const expected = [...manifest].sort();
const missing = expected.filter((name) => !actual.includes(name));
const unexpected = actual.filter((name) => !expected.includes(name));
if (missing.length || unexpected.length) {
  if (missing.length) console.error(`Missing functional screenshots: ${missing.join(', ')}`);
  if (unexpected.length) console.error(`Unexpected functional screenshots: ${unexpected.join(', ')}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
for (const filename of expected) {
  fs.copyFileSync(path.join(stagingDir, filename), path.join(targetDir, filename));
}
console.log(`Updated ${expected.length} functional screenshots in ${targetDir}`);
