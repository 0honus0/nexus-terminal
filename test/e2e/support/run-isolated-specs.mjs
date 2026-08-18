import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(__dirname, '..');
const testsRoot = path.join(e2eRoot, 'tests');
const projectNames = ['auth', 'http', 'websocket', 'ui', 'ssh', 'mobile'];
const requestOnly = process.argv.includes('--request-only');

const specUsesBrowserFixture = (source) => {
  const callbackFixtures = [...source.matchAll(/async\s*\(\s*\{([^}]*)\}/gs)]
    .map((match) => match[1])
    .join(' ');
  return /\b(page|context|browser|browserName)\b/.test(callbackFixtures);
};

const specs = projectNames.flatMap((project) => {
  const projectDir = path.join(testsRoot, project);
  return fs.readdirSync(projectDir)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
    .map((name) => ({
      project,
      absolutePath: path.join(projectDir, name),
      relativePath: path.posix.join('tests', project, name),
    }));
});

const selected = requestOnly
  ? specs.filter((spec) => !specUsesBrowserFixture(fs.readFileSync(spec.absolutePath, 'utf8')))
  : specs;

const failures = [];
const skipped = specs.length - selected.length;

for (const [index, spec] of selected.entries()) {
  console.log(`\n[E2E isolation ${index + 1}/${selected.length}] ${spec.relativePath}`);
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'test', spec.relativePath, `--project=${spec.project}`],
    {
      cwd: e2eRoot,
      env: process.env,
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    failures.push({ spec: spec.relativePath, status: result.status });
  }
}

console.log(`\n[E2E isolation] passed=${selected.length - failures.length} failed=${failures.length} skipped=${skipped}`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[E2E isolation] FAILED ${failure.spec} (exit ${failure.status ?? 'unknown'})`);
  }
  process.exitCode = 1;
}
