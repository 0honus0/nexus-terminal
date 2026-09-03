import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const versionsPath = path.join(scriptDir, 'versions.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) throw new Error(`Unexpected argument: ${raw}`);
    const key = raw.slice(2);
    if (key === 'no-lock') {
      args.noLock = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function replaceRequired(file, regex, replacement, label) {
  const absolute = path.join(repoRoot, file);
  const current = fs.readFileSync(absolute, 'utf8');
  if (!regex.test(current)) throw new Error(`Could not find ${label} in ${file}`);
  const next = current.replace(regex, replacement);
  if (next !== current) fs.writeFileSync(absolute, next, 'utf8');
}

function replaceAllRequired(file, regex, replacement, label) {
  const absolute = path.join(repoRoot, file);
  const current = fs.readFileSync(absolute, 'utf8');
  const matches = current.match(regex);
  if (!matches?.length) throw new Error(`Could not find ${label} in ${file}`);
  const next = current.replace(regex, replacement);
  if (next !== current) fs.writeFileSync(absolute, next, 'utf8');
}

function syncActionVersions(actions) {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  const workflowFiles = fs
    .readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => `.github/workflows/${name}`)
    .sort();

  const mappings = [
    ['actions/checkout', actions.checkout],
    ['actions/setup-node', actions.setupNode],
    ['actions/upload-artifact', actions.uploadArtifact],
    ['actions/download-artifact', actions.downloadArtifact],
    ['docker/setup-qemu-action', actions.setupQemu],
    ['docker/setup-buildx-action', actions.setupBuildx],
    ['docker/login-action', actions.dockerLogin],
    ['docker/build-push-action', actions.dockerBuildPush],
  ];

  for (const file of workflowFiles) {
    const absolute = path.join(repoRoot, file);
    let content = fs.readFileSync(absolute, 'utf8');
    let next = content;
    for (const [action, version] of mappings) {
      next = next.replace(new RegExp(`${action.replaceAll('/', '\\/')}@v?[^\\s]+`, 'g'), `${action}@${version}`);
    }
    if (next !== content) fs.writeFileSync(absolute, next, 'utf8');
  }
}

function syncNodeVersions(nodeVersion) {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  for (const name of fs
    .readdirSync(workflowsDir)
    .filter((value) => /\.ya?ml$/.test(value))
    .sort()) {
    const file = `.github/workflows/${name}`;
    const absolute = path.join(repoRoot, file);
    const content = fs.readFileSync(absolute, 'utf8');
    if (!/node-version:\s*\d+(?:\.x)?/.test(content)) continue;
    replaceAllRequired(file, /node-version:\s*\d+(?:\.x)?/g, `node-version: ${nodeVersion}.x`, 'node-version');
  }
}

function syncPlaywrightPackage(playwrightVersion, updateLock) {
  const packagePath = path.join(repoRoot, 'test/e2e/package.json');
  const packageJson = readJson(packagePath);
  packageJson.devDependencies['@playwright/test'] = playwrightVersion;
  writeJson(packagePath, packageJson);

  if (!updateLock) return;
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--prefix', 'test/e2e', '--package-lock-only', '--ignore-scripts'],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error(`npm package-lock refresh failed with exit ${result.status}`);
}

function syncRunnerFiles(config) {
  const tag = `playwright-${config.playwright}-node${config.node}-v${config.runnerRevision}`;

  replaceRequired(
    'test/e2e/Dockerfile.runner',
    /^FROM node:[^\n]+/m,
    `FROM node:${config.node}-bookworm`,
    'runner Node base',
  );
  replaceRequired(
    'test/e2e/Dockerfile.runner',
    /^ARG PLAYWRIGHT_VERSION=[^\n]+/m,
    `ARG PLAYWRIGHT_VERSION=${config.playwright}`,
    'runner Playwright arg',
  );

  replaceRequired(
    'test/e2e/README.md',
    /ghcr\.io\/0honus0\/nexus-terminal-e2e-runner:playwright-[^`\s]+/,
    `ghcr.io/0honus0/nexus-terminal-e2e-runner:${tag}`,
    'documented E2E runner image',
  );
}

const args = parseArgs(process.argv.slice(2));
const config = readJson(versionsPath);

if (args.node) config.node = args.node;
if (args.playwright) config.playwright = args.playwright;
if (args['runner-revision']) config.runnerRevision = Number(args['runner-revision']);

const actionArgMap = {
  checkout: 'checkout',
  'setup-node': 'setupNode',
  'upload-artifact': 'uploadArtifact',
  'download-artifact': 'downloadArtifact',
  'setup-qemu': 'setupQemu',
  'setup-buildx': 'setupBuildx',
  'docker-login': 'dockerLogin',
  'docker-build-push': 'dockerBuildPush',
};
for (const [argName, configName] of Object.entries(actionArgMap)) {
  if (args[argName]) config.actions[configName] = args[argName];
}

if (!Number.isInteger(config.runnerRevision) || config.runnerRevision < 1) {
  throw new Error('runnerRevision must be a positive integer');
}
if (!/^\d+$/.test(config.node)) throw new Error(`Invalid Node major: ${config.node}`);
if (!/^\d+\.\d+\.\d+/.test(config.playwright)) throw new Error(`Invalid Playwright version: ${config.playwright}`);

writeJson(versionsPath, config);
syncActionVersions(config.actions);
syncNodeVersions(config.node);
syncPlaywrightPackage(config.playwright, !args.noLock);
syncRunnerFiles(config);

console.log(`[E2E env] Node ${config.node}`);
console.log(`[E2E env] Playwright ${config.playwright}`);
console.log(`[E2E env] runner revision ${config.runnerRevision}`);
console.log(`[E2E env] image tag playwright-${config.playwright}-node${config.node}-v${config.runnerRevision}`);
console.log('[E2E env] CI action versions synchronized');
