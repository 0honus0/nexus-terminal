import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relative = (value) => path.relative(repoRoot, value).split(path.sep).join('/');
const failures = [];

const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => fs.existsSync(path.join(repoRoot, file)));

const isE2e = (file) => file.startsWith('test/e2e/');
const testFilePatterns = [
  /(?:^|\/)[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/i,
  /(?:^|\/)test_[^/]+\.py$/i,
  /(?:^|\/)[^/]+_test\.(?:py|go|rs)$/i,
  /(?:^|\/)[^/]+\.bats$/i,
  /(?:^|\/)__tests__\//i,
];

for (const file of listed) {
  if (!isE2e(file) && testFilePatterns.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: automated test cases are only allowed under test/e2e`);
  }
}

const frameworkPattern = /(?:^|[/@-])(jest|vitest|mocha|chai|ava|supertest|testing-library)(?:$|[/@-])/i;
for (const file of listed.filter((item) => item === 'package.json' || /^packages\/[^/]+\/package\.json$/.test(item))) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
  for (const [name] of Object.entries(manifest.scripts ?? {})) {
    if ((name === 'test' || name.startsWith('test:')) && !(file === 'package.json' && name.startsWith('test:e2e'))) {
      failures.push(`${file}: script "${name}" is a non-E2E test entrypoint`);
    }
  }
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      if (frameworkPattern.test(dependency)) {
        failures.push(`${file}: ${section} contains non-E2E test dependency ${dependency}`);
      }
    }
  }
}

const e2eCode = listed.filter(
  (file) => isE2e(file) && /\.(?:[cm]?[jt]s|tsx)$/.test(file) && !file.includes('/node_modules/'),
);
const internalSourcePatterns = [
  /packages\/(?:backend|frontend|remote-gateway)\/src\//,
  /(?:import\s*\(|from\s+)["']\/src\//,
];
for (const file of e2eCode) {
  const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  for (const pattern of internalSourcePatterns) {
    if (pattern.test(text)) {
      failures.push(`${file}: E2E must not import application source internals (${pattern})`);
      break;
    }
  }
}

const specFiles = e2eCode.filter((file) => /\/tests\/.*\.spec\.[cm]?[jt]sx?$/.test(`/${file}`));
const forbiddenAssertionOracles = [
  /\/control\/latest\b/,
  /E2E_SSH\.controlUrl}\/\s*(?:files|read|stat|path-exists|commands)\b/,
  /127\.0\.0\.1:22223\/(?:files|read|stat|path-exists|commands|webhooks)\b/,
  /__NEXUS_E2E_/,
  /route\.fulfill\(\{\s*(?:status|body|json|contentType)\s*:/s,
  /\b(?:localStorage|sessionStorage)\b/,
  /test\.describe\.serial\s*\(/,
];
for (const file of specFiles) {
  const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  for (const pattern of forbiddenAssertionOracles) {
    if (pattern.test(text))
      failures.push(`${file}: forbidden implementation/test-fixture assertion oracle (${pattern})`);
  }
}

const screenshotDeclarations = new Map();
const screenshotCallPattern = /\bcaptureFunctionalScreenshot\s*\(/g;
const screenshotDeclarationPattern = /\bcaptureFunctionalScreenshot\s*\(\s*[^,\n]+,\s*(["'])([^"'\n]+)\1/g;
const screenshotFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;
for (const file of specFiles) {
  const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const calls = [...text.matchAll(screenshotCallPattern)].length;
  const declarations = [...text.matchAll(screenshotDeclarationPattern)];
  if (calls !== declarations.length) {
    failures.push(
      `${file}: every captureFunctionalScreenshot call must declare a literal screenshot filename in the owning E2E spec`,
    );
  }

  for (const match of declarations) {
    const filename = match[2];
    if (!screenshotFilenamePattern.test(filename)) {
      failures.push(`${file}: invalid functional screenshot filename ${filename}`);
      continue;
    }
    const previous = screenshotDeclarations.get(filename);
    if (previous) {
      failures.push(`${file}: functional screenshot filename ${filename} is already declared by ${previous}`);
      continue;
    }
    screenshotDeclarations.set(filename, file);
  }
}

const timingsPath = path.join(repoRoot, 'test/e2e/groups/timings.json');
if (fs.existsSync(timingsPath)) {
  const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  for (const spec of Object.keys(timings.specs ?? {})) {
    if (!fs.existsSync(path.join(repoRoot, 'test/e2e', spec))) {
      failures.push(`test/e2e/groups/timings.json: stale timing entry for missing spec ${spec}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Test policy check passed: ${specFiles.length} E2E spec files, ${screenshotDeclarations.size} unique functional screenshot declarations, no non-E2E test cases, no application-source imports, no forbidden fixture oracles.`,
);
