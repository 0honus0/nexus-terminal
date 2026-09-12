import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..', '..');
const expected = {
  mise: {
    version: '2026.9.5',
    amd64Sha256: 'd71e94e1ed59d4d0ca4ac847fa321d6d6615a8e613e9b468c9fb39f0dddd06d5',
    arm64Sha256: '3a52c7c7c58d21a0791516950ebf4bc915f403277b49c93d657fc585259625ec',
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

const catalog = JSON.parse(read('scripts/docker/agent-runner/catalog/catalog.json'));
const miseSources = (catalog.packs ?? [])
  .flatMap((pack) => Object.values(pack.downloadRefByArch ?? {}))
  .filter((source) => typeof source === 'string' && source.startsWith('mise://'));
const miseVersions = new Set(miseSources.map((source) => /^mise:\/\/([^/]+)\//.exec(source)?.[1]).filter(Boolean));
if (miseVersions.size !== 1) {
  failures.push('scripts/docker/agent-runner/catalog/catalog.json: all mise Tool Packs must pin one installer version');
}
const [miseVersion = ''] = [...miseVersions];
if (miseVersion && miseVersion !== expected.mise.version) {
  failures.push(
    `scripts/docker/agent-runner/catalog/catalog.json: mise pin ${miseVersion} does not match checked release ${expected.mise.version}`,
  );
}

requireText(
  'scripts/agent-runner/prepare-ubuntu-host.sh',
  `MISE_VERSION=${expected.mise.version}`,
  'host mise version must match the Tool Catalog installer pin',
);
requireText(
  'scripts/docker/agent-runner/Dockerfile',
  `ARG MISE_VERSION=${expected.mise.version}`,
  'Runner image mise version must match the Tool Catalog installer pin',
);
requireText(
  'scripts/docker/agent-runner/Dockerfile',
  `ARG MISE_AMD64_SHA256=${expected.mise.amd64Sha256}`,
  'Runner image amd64 mise SHA-256 is out of sync',
);
requireText(
  'scripts/docker/agent-runner/Dockerfile',
  `ARG MISE_ARM64_SHA256=${expected.mise.arm64Sha256}`,
  'Runner image arm64 mise SHA-256 is out of sync',
);
requireText(
  'scripts/agent-runner/prepare-ubuntu-host.sh',
  'mise_stable_bin=/usr/local/bin/mise',
  'host must publish the checked mise binary at the stable command path',
);
for (const relative of ['scripts/agent-runner/prepare-ubuntu-host.sh', 'scripts/docker/agent-runner/Dockerfile']) {
  requireText(relative, 'command -v script', 'native Runner requires util-linux script(1) for Workspace PTY sessions');
  requireText(relative, 'command -v stty', 'native Runner requires stty for Workspace PTY resize support');
}
requireText(
  'scripts/docker/agent-runner/Dockerfile',
  'command -v tini',
  'standalone Runner image requires tini as PID 1 for orphan process reaping',
);
requireText(
  'scripts/docker/agent-runner/Dockerfile',
  'ENTRYPOINT ["/usr/bin/tini", "--"]',
  'standalone Runner image must launch through tini',
);
forbidText(
  'packages/agent-runner/src/controller/pack-installer.ts',
  expected.mise.version,
  'mise release policy belongs in Catalog/prepare/check, not Runner runtime code',
);

// 单用户 native Runner 不允许重新引入内部 sandbox、nested container 或自编译 PTY helper。
for (const relative of [
  'scripts/docker/agent-runner/Dockerfile',
  'scripts/agent-runner/prepare-ubuntu-host.sh',
  'packages/agent-runner/src/index.ts',
  'packages/agent-runner/src/types.ts',
  'packages/agent-runner/src/controller/workspace-runtime-manager.ts',
  'packages/agent-runner/src/controller/workspace-runtime-engine.ts',
  'packages/agent-runner/src/controller/workspace-terminal-runtime.ts',
  'packages/agent-runner/src/controller/pack-installer.ts',
  'packages/agent-runner/src/controller/plugin-runner-runtime.ts',
]) {
  forbidText(relative, 'bwrap', 'native Agent Runner must not depend on bubblewrap');
  forbidText(relative, 'bubblewrap', 'native Agent Runner must not depend on bubblewrap');
  forbidText(relative, 'dropbear', 'native Agent Runner must not depend on Dropbear');
  forbidText(relative, 'socat', 'native Agent Runner must not depend on socat');
}
for (const compiler of ['gcc ', 'g++ ', 'clang ', 'node-gyp']) {
  forbidText(
    'scripts/docker/agent-runner/Dockerfile',
    compiler,
    'standalone Runner image must not compile or install a custom native helper',
  );
}
for (const capability of ['SYS_ADMIN', 'privileged', 'seccomp=unconfined', 'apparmor=unconfined']) {
  forbidText(
    'scripts/docker/agent-runner/Dockerfile',
    capability,
    'standalone Runner image must not require elevated container privileges',
  );
}

if (failures.length) {
  console.error(`Agent Runner prerequisite check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `Agent Runner prerequisite check passed: native Workspace runtime uses mise ${expected.mise.version} + script/stty; standalone image uses tini PID 1 with no internal sandbox or custom native compilation.`,
);
