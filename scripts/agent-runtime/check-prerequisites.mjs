import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..', '..');
const expected = {
  bubblewrap: {
    version: '0.12.0',
    sha256: '9760d007363e3abba7c747489910f9f82d9fca53ba3bd3282e396fa3c97a3314',
  },
};

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (relative, needle, message) => {
  if (!read(relative).includes(needle)) failures.push(`${relative}: ${message}`);
};
const forbidText = (relative, needle, message) => {
  if (read(relative).includes(needle)) failures.push(`${relative}: ${message}`);
};

const catalog = JSON.parse(read('scripts/docker/agent-runtime/catalog/catalog.json'));
const miseSources = (catalog.packs ?? [])
  .flatMap((pack) => Object.values(pack.downloadRefByArch ?? {}))
  .filter((source) => typeof source === 'string' && source.startsWith('mise://'));
const miseVersions = new Set(miseSources.map((source) => /^mise:\/\/([^/]+)\//.exec(source)?.[1]).filter(Boolean));
if (miseVersions.size !== 1) {
  failures.push(
    'scripts/docker/agent-runtime/catalog/catalog.json: all mise Tool Packs must pin one installer version',
  );
}
const [miseVersion = ''] = [...miseVersions];
if (miseVersion) {
  requireText(
    'scripts/agent-runtime/prepare-ubuntu-host.sh',
    `MISE_VERSION=${miseVersion}`,
    'host mise version must match the Tool Catalog installer pin',
  );
  requireText(
    'scripts/agent-runtime/prepare-ubuntu-host.sh',
    'mise_stable_bin=/usr/local/bin/mise',
    'host must publish the checked mise binary at the stable command path',
  );
  forbidText(
    'packages/agent-runtime/src/controller/pack-installer.ts',
    miseVersion,
    'mise release policy belongs in Catalog/prepare/check, not Runner runtime code',
  );
}

const { version, sha256 } = expected.bubblewrap;
for (const relative of ['Dockerfile', 'scripts/docker/agent-runtime/Dockerfile']) {
  requireText(relative, `ARG BWRAP_VERSION=${version}`, `Bubblewrap version must be ${version}`);
  requireText(relative, `ARG BWRAP_SHA256=${sha256}`, 'Bubblewrap release SHA-256 is out of sync');
  requireText(
    relative,
    "CFLAGS='-include linux/limits.h'",
    'Alpine builder must expose PATH_MAX for upstream bubblewrap',
  );
}
requireText(
  'scripts/agent-runtime/prepare-ubuntu-host.sh',
  `BWRAP_VERSION=${version}`,
  'host Bubblewrap version is out of sync',
);
requireText(
  'scripts/agent-runtime/prepare-ubuntu-host.sh',
  `BWRAP_SHA256=${sha256}`,
  'host Bubblewrap SHA-256 is out of sync',
);
requireText(
  'scripts/agent-runtime/prepare-ubuntu-host.sh',
  'bwrap_bin=/usr/local/bin/bwrap',
  'host must install the checked binary at the stable command path',
);
requireText(
  'scripts/agent-runtime/apparmor/nexus-bwrap-userns-restrict',
  'profile nexus_bwrap /usr/local/bin/bwrap ',
  'AppArmor profile must target the stable checked binary path',
);

for (const relative of [
  'packages/agent-runtime/src/controller/sandbox-manager.ts',
  'packages/agent-runtime/src/controller/plugin-runner-runtime.ts',
  'packages/agent-runtime/src/controller/pack-installer.ts',
  'packages/agent-runtime/src/index.ts',
  'packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter.ts',
]) {
  forbidText(relative, version, 'sandbox release policy belongs in build/check scripts, not runtime code');
  forbidText(relative, 'BUBBLEWRAP_MINIMUM_VERSION', 'sandbox minimum-version policy belongs in build/check scripts');
  forbidText(relative, 'MINIMUM_BUBBLEWRAP_VERSION', 'sandbox minimum-version policy belongs in build/check scripts');
}

if (failures.length) {
  console.error(`Agent sandbox prerequisite check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

if (process.argv.includes('--verify-latest')) {
  const response = await fetch('https://api.github.com/repos/containers/bubblewrap/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nexus-terminal-ci' },
  });
  if (!response.ok) throw new Error(`Unable to resolve latest Bubblewrap release: HTTP ${response.status}`);
  const release = await response.json();
  const tag = String(release.tag_name ?? '');
  if (tag !== `v${version}`) {
    throw new Error(
      `Bubblewrap pin ${version} is not latest stable (${tag || 'unknown'}). Update the prerequisite pin before merging.`,
    );
  }
  const assetName = `bubblewrap-${version}.tar.xz`;
  const asset = Array.isArray(release.assets) ? release.assets.find((value) => value?.name === assetName) : null;
  if (!asset?.browser_download_url) throw new Error(`Latest Bubblewrap release is missing ${assetName}`);
  const assetResponse = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'nexus-terminal-ci' } });
  if (!assetResponse.ok) throw new Error(`Unable to download ${assetName}: HTTP ${assetResponse.status}`);
  const digest = createHash('sha256')
    .update(Buffer.from(await assetResponse.arrayBuffer()))
    .digest('hex');
  if (digest !== sha256) throw new Error(`Bubblewrap ${version} SHA-256 mismatch: expected ${sha256}, got ${digest}`);
}

console.log(
  `Agent sandbox prerequisite check passed: bubblewrap ${version}${process.argv.includes('--verify-latest') ? ' is latest stable and SHA-256 verified' : ' pins are consistent'}.`,
);
