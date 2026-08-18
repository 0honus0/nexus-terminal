import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const versionsPath = path.join(scriptDir, 'versions.json');

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nexus-terminal-e2e-environment-updater',
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function semverMajor(value) {
  const match = /^v?(\d+)\./.exec(value);
  if (!match) throw new Error(`Could not parse semver major from ${value}`);
  return `v${match[1]}`;
}

async function latestNodeLtsMajor() {
  const releases = await fetchJson('https://nodejs.org/dist/index.json', { Accept: 'application/json' });
  const latestLts = releases.find((release) => release.lts);
  if (!latestLts) throw new Error('Node release index did not contain an LTS release');
  const match = /^v(\d+)\./.exec(latestLts.version);
  if (!match) throw new Error(`Could not parse Node version ${latestLts.version}`);
  return match[1];
}

function latestPlaywrightVersion() {
  const value = execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['view', '@playwright/test@latest', 'version'],
    { encoding: 'utf8' },
  ).trim();
  if (!/^\d+\.\d+\.\d+/.test(value)) throw new Error(`Unexpected Playwright version: ${value}`);
  return value;
}

async function latestReleaseMajor(repo, token) {
  const headers = token ? { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } : {};
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`, headers);
  if (release.prerelease || release.draft) throw new Error(`${repo} latest release is not stable`);
  return semverMajor(release.tag_name);
}

const current = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const [node, playwright, checkout, setupNode, uploadArtifact, setupQemu, setupBuildx, dockerLogin, dockerBuildPush] = await Promise.all([
  latestNodeLtsMajor(),
  Promise.resolve(latestPlaywrightVersion()),
  latestReleaseMajor('actions/checkout', token),
  latestReleaseMajor('actions/setup-node', token),
  latestReleaseMajor('actions/upload-artifact', token),
  latestReleaseMajor('docker/setup-qemu-action', token),
  latestReleaseMajor('docker/setup-buildx-action', token),
  latestReleaseMajor('docker/login-action', token),
  latestReleaseMajor('docker/build-push-action', token),
]);

const resolved = {
  ...current,
  node,
  playwright,
  actions: {
    checkout,
    setupNode,
    uploadArtifact,
    setupQemu,
    setupBuildx,
    dockerLogin,
    dockerBuildPush,
  },
};

process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
