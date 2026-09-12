#!/usr/bin/env bash
set -euo pipefail

image="${1:-nexus-agent-runner:e2e-smoke}"
container="nexus-agent-runner-image-smoke-${GITHUB_RUN_ID:-local}-$$"
token='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
deployment_id='nexus-runner-image-smoke'
failed=1

cleanup() {
  if docker inspect "$container" >/dev/null 2>&1; then
    if [[ "$failed" -ne 0 ]]; then
      echo '--- standalone Agent Runner container log ---' >&2
      docker logs "$container" >&2 || true
    fi
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# 单用户 native Runner 不创建 Workspace namespace/sandbox。这里故意使用 Docker 默认
# capability/seccomp/AppArmor，不使用 privileged、SYS_ADMIN、Docker socket 或 nested Docker。
docker run -d \
  --name "$container" \
  --publish 127.0.0.1::8790 \
  --env NEXUS_AGENT_RUNNER_TOKEN="$token" \
  --env NEXUS_AGENT_DEPLOYMENT_ID="$deployment_id" \
  "$image" >/dev/null

mapping="$(docker port "$container" 8790/tcp | head -n 1)"
[[ -n "$mapping" ]] || { echo 'Agent Runner container port mapping is missing.' >&2; exit 1; }
base_url="http://${mapping}"

availability=''
for _ in {1..30}; do
  if availability="$(curl -fsS \
    -H "Authorization: Bearer $token" \
    -H 'X-Nexus-Agent-Protocol: 2026-09-12' \
    "$base_url/v1/availability" 2>/dev/null)"; then
    if RUNNER_AVAILABILITY="$availability" node -e '
      const value = JSON.parse(process.env.RUNNER_AVAILABILITY || "{}");
      process.exit(value.available === true && value.state === "ready" ? 0 : 1);
    '; then
      break
    fi
  fi
  sleep 1
done

RUNNER_AVAILABILITY="$availability" node -e '
  const value = JSON.parse(process.env.RUNNER_AVAILABILITY || "{}");
  if (value.available !== true || value.state !== "ready") {
    console.error("Runner native runtime availability probe failed:", value);
    process.exit(1);
  }
  if (value.deploymentId !== "nexus-runner-image-smoke") {
    console.error("Runner deployment id mismatch:", value.deploymentId);
    process.exit(1);
  }
  if (value.runtime?.mode !== "native" || value.runtime?.isolation !== "logical") {
    console.error("Runner runtime mode mismatch:", value.runtime);
    process.exit(1);
  }
'

# 再安装一个真实 Node Toolchain pack，验证容器内 pinned mise、解包工具、网络 materializer、
# canonical digest 和 Runner journal 异步命令链都真正可用，而不是只验证二进制存在。
RUNNER_BASE_URL="$base_url" RUNNER_TOKEN="$token" RUNNER_DEPLOYMENT_ID="$deployment_id" node <<'NODE'
const baseUrl = process.env.RUNNER_BASE_URL;
const token = process.env.RUNNER_TOKEN;
const deploymentId = process.env.RUNNER_DEPLOYMENT_ID;
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'x-nexus-agent-protocol': '2026-09-12',
};
const readJson = async (response) => {
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : {}; } catch { throw new Error(`Invalid JSON (${response.status}): ${text}`); }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value;
};
const getJson = async (path) => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await readJson(await fetch(`${baseUrl}${path}`, { headers }));
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  throw lastError;
};
const catalog = await getJson('/v1/catalog');
const pack = catalog.packs.find(
  (candidate) => candidate.familyId === 'node' && candidate.versionId === '24.21.0' && candidate.status === 'supported',
);
if (!pack?.contentDigest) throw new Error('Node 24.21.0 Toolchain pack is unavailable in the standalone Runner catalog.');

const now = Math.floor(Date.now() / 1000);
const commandId = `image-pack-install-${Date.now()}`;
const command = {
  action: 'packInstall',
  commandId,
  deploymentId,
  userId: 1,
  appId: 'nexus.runner-image-smoke',
  operationHash: `v1:${'0'.repeat(64)}`,
  issuedAt: now,
  deadlineAt: now + 300,
  nonce: 'runner-image-smoke-nonce',
  packs: [{ familyId: pack.familyId, versionId: pack.versionId, contentDigest: pack.contentDigest }],
};
await readJson(await fetch(`${baseUrl}/v1/commands`, { method: 'POST', headers, body: JSON.stringify(command) }));
let record;
for (let attempt = 0; attempt < 180; attempt += 1) {
  record = await getJson(`/v1/commands/${encodeURIComponent(commandId)}`);
  if (record.status === 'succeeded') break;
  if (record.status === 'failed' || record.status === 'unknown') {
    throw new Error(`Toolchain pack install failed: ${JSON.stringify(record)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (record?.status !== 'succeeded') throw new Error(`Toolchain pack install timed out: ${JSON.stringify(record)}`);

const after = await getJson('/v1/catalog');
const installed = after.packs.find(
  (candidate) => candidate.familyId === pack.familyId && candidate.versionId === pack.versionId,
);
if (installed?.installed !== true) throw new Error('Installed Node Toolchain pack was not projected as installed.');
console.log('standalone Agent Runner container smoke passed: native runtime ready + Node 24.21.0 Toolchain materialized');
NODE

failed=0
