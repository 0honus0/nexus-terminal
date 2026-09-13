#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <unified-image>" >&2
  exit 2
fi

image="$1"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
suffix="${suffix//[^A-Za-z0-9_.-]/-}"
project_name="nexus-e2e-smoke-${suffix,,}"
http_port="${NEXUS_DOCKER_SMOKE_PORT:-18113}"
printf -v network_hex '%04x' "$(( $$ & 65535 ))"
workspace="$(mktemp -d)"
compose_file="$workspace/docker-compose.yml"
compose_override="$workspace/docker-compose.smoke.yml"
env_file="$workspace/.env"
data_dir="$workspace/data"
cookie_jar="$(mktemp)"
runner_root="$workspace/agent-runner"
runner_log="$workspace/agent-runner.log"
runner_pid=''
browser_probe_log="$workspace/browser-cdp-probe.log"
browser_probe_pid=''
cdp_browser_log="$workspace/direct-cdp-browser.log"
cdp_browser_pid=''
cdp_browser_profile="$workspace/direct-cdp-profile"
cdp_browser_proxy_log="$workspace/direct-cdp-proxy.log"
cdp_browser_proxy_pid=''
browser_page_log="$workspace/direct-browser-page.log"
browser_page_pid=''
plugin_repository_log="$workspace/plugin-repository.log"
plugin_repository_pid=''
runner_port="$(node - <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.listen(0, '0.0.0.0', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  console.log(address.port);
  server.close();
});
NODE
)"
browser_probe_port="$(node - <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  console.log(address.port);
  server.close();
});
NODE
)"
cdp_browser_port="$(node - <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  console.log(address.port);
  server.close();
});
NODE
)"
cdp_browser_proxy_port="$(node - <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.listen(0, '0.0.0.0', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  console.log(address.port);
  server.close();
});
NODE
)"
browser_page_port="$(node - <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  console.log(address.port);
  server.close();
});
NODE
)"
plugin_frontend_port="$(node - <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  console.log(address.port);
  server.close();
});
NODE
)"
plugin_repository_port="$(node - <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.listen(0, '0.0.0.0', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  console.log(address.port);
  server.close();
});
NODE
)"
session_secret='docker-smoke-session-secret-2026-00000000000000000000000000000000'
encryption_key='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
runner_token="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
failed=1

if [[ "$image" != *:* ]]; then
  echo "Unified image must include an explicit tag: $image" >&2
  exit 2
fi
image_repository="${image%:*}"
image_tag="${image##*:}"

compose() {
  docker compose \
    --project-name "$project_name" \
    --project-directory "$workspace" \
    --env-file "$env_file" \
    -f "$compose_file" \
    -f "$compose_override" \
    "$@"
}

set_env() {
  local key="$1"
  local value="$2"
  local temp="$env_file.tmp"
  grep -v "^${key}=" "$env_file" > "$temp" || true
  printf '%s=%s\n' "$key" "$value" >> "$temp"
  mv "$temp" "$env_file"
}

print_logs() {
  echo "--- compose ps ---"
  compose ps --all 2>&1 || true
  echo "--- compose logs ---"
  compose logs --no-color 2>&1 || true
  echo "--- agent runner host log ---"
  cat "$runner_log" 2>/dev/null || true
  echo "--- browser CDP probe log ---"
  cat "$browser_probe_log" 2>/dev/null || true
  echo "--- direct CDP browser log ---"
  cat "$cdp_browser_log" 2>/dev/null || true
  echo "--- direct CDP proxy log ---"
  cat "$cdp_browser_proxy_log" 2>/dev/null || true
  echo "--- direct Browser page log ---"
  cat "$browser_page_log" 2>/dev/null || true
  echo "--- Agent plugin repository log ---"
  cat "$plugin_repository_log" 2>/dev/null || true
}

cleanup() {
  status=$?
  if [[ "$failed" -ne 0 || "$status" -ne 0 ]]; then
    print_logs
  fi
  compose exec -T backend sh -lc 'chmod -R a+rwx /app/data' >/dev/null 2>&1 || true
  compose down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1 || true
  if [[ -n "$plugin_repository_pid" ]]; then
    kill "$plugin_repository_pid" >/dev/null 2>&1 || true
    wait "$plugin_repository_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$browser_page_pid" ]]; then
    kill "$browser_page_pid" >/dev/null 2>&1 || true
    wait "$browser_page_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$cdp_browser_pid" ]]; then
    kill "$cdp_browser_pid" >/dev/null 2>&1 || true
    wait "$cdp_browser_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$cdp_browser_proxy_pid" ]]; then
    kill "$cdp_browser_proxy_pid" >/dev/null 2>&1 || true
    wait "$cdp_browser_proxy_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$browser_probe_pid" ]]; then
    kill "$browser_probe_pid" >/dev/null 2>&1 || true
    wait "$browser_probe_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$runner_pid" ]]; then
    kill "$runner_pid" >/dev/null 2>&1 || true
    wait "$runner_pid" >/dev/null 2>&1 || true
  fi
  chmod -R u+w "$runner_root" >/dev/null 2>&1 || true
  rm -rf "$workspace" "$cookie_jar" || true
  exit "$status"
}
trap cleanup EXIT

cp "$repo_root/docker-compose.yml" "$compose_file"
cp "$repo_root/.env.example" "$env_file"
cat > "$compose_override" <<EOF
services:
  frontend:
    container_name: nexus-e2e-frontend-$suffix
  backend:
    container_name: nexus-e2e-backend-$suffix
    environment:
      AGENT_RUNNER_URL: http://host.docker.internal:$runner_port
      NEXUS_E2E_RESET_ENABLED: 1
      AGENT_OFFICIAL_PLUGIN_CATALOG_URL: http://host.docker.internal:$plugin_repository_port/catalog.json
      AGENT_OFFICIAL_PLUGIN_PUBLISHER_KEY_ID: ed25519:b75cef09083540273828a77809f5ec467bac0df101f5b6ec17727a4103f632f7
      AGENT_OFFICIAL_PLUGIN_PUBLISHER_PUBLIC_KEY_PEM: |-
        -----BEGIN PUBLIC KEY-----
        MCowBQYDK2VwAyEALU2gA/FGdyVBtxtSsTRGmLiNjRsxeE8MdkMt2dndZQ8=
        -----END PUBLIC KEY-----
      AGENT_OFFICIAL_PLUGIN_PRIVATE_HOST_EXCEPTIONS: host.docker.internal:$plugin_repository_port
      NEXUS_E2E_DIRECT_CDP_PORT: $cdp_browser_proxy_port
      NEXUS_E2E_BROWSER_PAGE_PORT: $browser_page_port
  guacd:
    container_name: nexus-e2e-guacd-$suffix
networks:
  nexus-terminal-network:
    name: nexus-e2e-network-$suffix
EOF
mkdir -p "$data_dir"
cp "$repo_root/packages/e2e/fixtures/seeded-data/nexus-terminal.db" "$data_dir/nexus-terminal.db"
cat > "$data_dir/.env" <<EOF
SESSION_SECRET=$session_secret
ENCRYPTION_KEY=$encryption_key
EOF
chmod 0777 "$data_dir"
chmod 0600 "$data_dir/.env"
mkdir -p "$runner_root" "$data_dir/agent/plugins/smoke-static/versions/1/frontend"
printf 'smoke-package-hash\n' > "$data_dir/agent/plugins/smoke-static/versions/1/.nexus-package-hash"
printf '<!doctype html><title>plugin-static-ok</title>\n' > "$data_dir/agent/plugins/smoke-static/versions/1/frontend/index.html"

# Keep the repository Compose/.env.example contract intact while overriding only values that
# must be isolated for this smoke run: image, host port, Docker network, and WebAuthn origin.
set_env NEXUS_IMAGE_REPOSITORY "$image_repository"
set_env NEXUS_IMAGE_TAG "$image_tag"
set_env NEXUS_HTTP_PORT "$http_port"
set_env NEXUS_PUBLIC_ORIGIN "http://127.0.0.1:$http_port"
set_env NEXUS_PLUGIN_FRONTEND_PORT "$plugin_frontend_port"
set_env NEXUS_PLUGIN_FRONTEND_ORIGIN "http://127.0.0.1:$plugin_frontend_port"
set_env NEXUS_IPV6_SUBNET "fd01:ee:${network_hex}::/80"
set_env NEXUS_IPV6_GATEWAY "fd01:ee:${network_hex}::1"
set_env NEXUS_AGENT_RUNNER_TOKEN "$runner_token"
set_env RP_ID 'ssh.honus.top'
set_env RP_ORIGIN 'https://ssh.honus.top,https://ssh.trui.de'

NEXUS_E2E_PLUGIN_REPOSITORY_HOST=0.0.0.0 \
NEXUS_E2E_PLUGIN_REPOSITORY_PORT="$plugin_repository_port" \
NEXUS_E2E_PLUGIN_REPOSITORY_PUBLIC_BASE_URL="http://host.docker.internal:$plugin_repository_port" \
NEXUS_E2E_PLUGIN_SIGNING_KEY_PEM="$(cat "$repo_root/packages/e2e/fixtures/agent/keys/official-e2e-private.pem")" \
node "$repo_root/packages/e2e/fixtures/agent/plugin-repository.mjs" >"$plugin_repository_log" 2>&1 &
plugin_repository_pid=$!
for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:${plugin_repository_port}/health" >/dev/null; then break; fi
  sleep 0.1
done
curl -fsS "http://127.0.0.1:${plugin_repository_port}/health" >/dev/null || {
  echo 'Agent plugin repository did not start.' >&2
  exit 1
}

compose config >/dev/null
# Browser direct page target. Chromium itself runs on the host, so this loopback HTTP
# server exercises the Browser data plane independently from the Backend -> CDP control plane.
browser_page_script="$workspace/direct-browser-page.cjs"
cat > "$browser_page_script" <<'NODE'
const http = require('node:http');
const port = Number(process.env.NEXUS_BROWSER_PAGE_PORT);
const html = `<!doctype html><title>Nexus Browser Smoke</title><input aria-label="Name"><button onclick="document.querySelector('#status').textContent=document.querySelector('input').value">Apply</button><div id="status">idle</div>`;
const server = http.createServer((request, response) => {
  if (request.url !== '/') { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(html);
});
server.listen(port, '127.0.0.1');
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
NODE
NEXUS_BROWSER_PAGE_PORT="$browser_page_port" node "$browser_page_script" >"$browser_page_log" 2>&1 &
browser_page_pid=$!
for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:${browser_page_port}/" >/dev/null; then break; fi
  sleep 0.1
done
curl -fsS "http://127.0.0.1:${browser_page_port}/" >/dev/null || { echo 'Direct Browser page did not start.' >&2; exit 1; }

# Browser direct smoke target. Chromium intentionally owns only a host-loopback CDP
# listener. Modern Chromium can remain loopback-only even when given a broader debug
# address, so expose that listener through an explicit host TCP proxy for the Backend
# container instead of relying on Chromium's bind-address behavior.
cdp_browser_executable="$(pnpm --filter @nexus-terminal/e2e exec node -e "process.stdout.write(require('@playwright/test').chromium.executablePath())")"
mkdir -p "$cdp_browser_profile"
"$cdp_browser_executable" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --remote-allow-origins='*' \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$cdp_browser_port" \
  --user-data-dir="$cdp_browser_profile" \
  about:blank >"$cdp_browser_log" 2>&1 &
cdp_browser_pid=$!
cdp_browser_ready=0
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:${cdp_browser_port}/json/version" >/dev/null; then
    cdp_browser_ready=1
    break
  fi
  sleep 0.25
done
[[ "$cdp_browser_ready" -eq 1 ]] || { echo 'Direct CDP Chromium did not start.' >&2; exit 1; }

cdp_proxy_script="$workspace/direct-cdp-proxy.cjs"
cat > "$cdp_proxy_script" <<'PROXY_NODE'
const net = require('node:net');
const listenPort = Number(process.env.NEXUS_CDP_PROXY_PORT);
const targetPort = Number(process.env.NEXUS_CDP_TARGET_PORT);
const server = net.createServer((client) => {
  const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
  client.pipe(upstream);
  upstream.pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', close);
  upstream.on('error', close);
});
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(listenPort, '0.0.0.0');
PROXY_NODE
NEXUS_CDP_PROXY_PORT="$cdp_browser_proxy_port" \
NEXUS_CDP_TARGET_PORT="$cdp_browser_port" \
node "$cdp_proxy_script" >"$cdp_browser_proxy_log" 2>&1 &
cdp_browser_proxy_pid=$!
cdp_browser_proxy_ready=0
for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:${cdp_browser_proxy_port}/json/version" >/dev/null; then
    cdp_browser_proxy_ready=1
    break
  fi
  sleep 0.1
done
[[ "$cdp_browser_proxy_ready" -eq 1 ]] || { echo 'Direct CDP host proxy did not start.' >&2; exit 1; }

# Browser tunnel smoke target. This is deliberately only a WebSocket text echo peer,
# not a Browser implementation: Runner must remain a byte/message tunnel and must not
# acquire Puppeteer/CDP session semantics.
browser_probe_script="$workspace/browser-cdp-probe.cjs"
cat > "$browser_probe_script" <<'NODE'
const { WebSocketServer } = require(process.env.NEXUS_WS_MODULE);
const port = Number(process.env.NEXUS_BROWSER_PROBE_PORT);
const server = new WebSocketServer({ host: '127.0.0.1', port, perMessageDeflate: false });
server.on('connection', (socket) => {
  socket.on('message', (data, isBinary) => {
    if (isBinary) { socket.close(1003, 'text only'); return; }
    socket.send(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
  });
});
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
NODE
NEXUS_WS_MODULE="$repo_root/packages/agent-runner/node_modules/ws" \
NEXUS_BROWSER_PROBE_PORT="$browser_probe_port" \
node "$browser_probe_script" >"$browser_probe_log" 2>&1 &
browser_probe_pid=$!
sleep 0.2
kill -0 "$browser_probe_pid" 2>/dev/null || { echo 'Browser CDP probe did not start.' >&2; exit 1; }

# Host Runner 与独立容器 Runner 使用同一套单用户 native Workspace Runtime。
# Workspace 是持久工作目录与运行环境选择边界，不创建额外 namespace/sandbox。
NEXUS_AGENT_RUNNER_HOST=0.0.0.0 \
PORT="$runner_port" \
NEXUS_AGENT_RUNNER_TOKEN="$runner_token" \
NEXUS_AGENT_RUNNER_ROOT="$runner_root" \
NEXUS_AGENT_CATALOG="$repo_root/scripts/docker/agent-runner/catalog/catalog.json" \
NEXUS_AGENT_PLUGIN_SOURCE_ROOT="$data_dir/agent/plugins" \
node "$repo_root/packages/agent-runner/dist/index.js" >"$runner_log" 2>&1 &
runner_pid=$!

runner_listener_ready=0
for _ in {1..30}; do
  if curl -fsS -H "Authorization: Bearer $runner_token" -H "X-Nexus-Agent-Protocol: 2026-09-13" "http://127.0.0.1:${runner_port}/v1/availability" >/dev/null; then
    runner_listener_ready=1
    break
  fi
  sleep 1
done
[[ "$runner_listener_ready" -eq 1 ]] || { echo "Agent Runner host service did not start." >&2; exit 1; }

# Production Compose intentionally depends on guacd being started, not on the image's
# slow built-in health cadence. Start with the same semantics, then verify readiness
# through the application ingress and the authenticated Backend -> host Runner path.
compose up -d --build
compose ps

frontend_ready=0
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:${http_port}/" >/dev/null; then
    frontend_ready=1
    break
  fi
  sleep 1
done
[[ "$frontend_ready" -eq 1 ]] || { echo "Compose frontend did not become ready." >&2; exit 1; }

plugin_frontend_headers="$workspace/plugin-frontend.headers"
plugin_frontend_body="$workspace/plugin-frontend.body"
plugin_frontend_ready=0
for _ in {1..30}; do
  if curl -fsS -D "$plugin_frontend_headers" -o "$plugin_frontend_body" \
    "http://127.0.0.1:${plugin_frontend_port}/plugins/smoke-static/1/index.html"; then
    plugin_frontend_ready=1
    break
  fi
  sleep 1
done
[[ "$plugin_frontend_ready" -eq 1 ]] || { echo "Plugin frontend listener did not become ready." >&2; exit 1; }
grep -Fq 'plugin-static-ok' "$plugin_frontend_body"
grep -Eqi '^Content-Security-Policy: .*frame-ancestors http://127\.0\.0\.1:' "$plugin_frontend_headers"
grep -Eqi '^Cache-Control: public, max-age=31536000, immutable' "$plugin_frontend_headers"
grep -Eqi '^Access-Control-Allow-Origin: \*' "$plugin_frontend_headers"
plugin_sdk_headers="$workspace/plugin-sdk.headers"
plugin_sdk_body="$workspace/plugin-sdk.body"
curl -fsS -D "$plugin_sdk_headers" -o "$plugin_sdk_body" \
  "http://127.0.0.1:${plugin_frontend_port}/sdk/frontend-v1.mjs"
grep -Fq 'connectNexusPlugin' "$plugin_sdk_body"
grep -Eqi '^Content-Type: application/javascript; charset=utf-8' "$plugin_sdk_headers"
grep -Eqi '^Cache-Control: public, max-age=31536000, immutable' "$plugin_sdk_headers"
grep -Eqi '^Access-Control-Allow-Origin: \*' "$plugin_sdk_headers"
if curl -fsS "http://127.0.0.1:${plugin_frontend_port}/plugins/smoke-static/1/.nexus-package-hash" >/dev/null 2>&1; then
  echo "Plugin frontend listener exposed a dotfile." >&2
  exit 1
fi

compose exec -T backend sh -lc 'nc -z guacd 4822'

runner_ready=0
for _ in {1..60}; do
  if compose exec -T backend node - <<'NODE'
const token = process.env.AGENT_RUNNER_TOKEN;
const response = await fetch(process.env.AGENT_RUNNER_URL + '/v1/availability', {
  headers: { authorization: `Bearer ${token}`, 'x-nexus-agent-protocol': '2026-09-13' },
}).catch(() => null);
if (!response?.ok) process.exit(1);
const body = await response.json();
if (body.available !== true || body.mode !== 'native' || body.isolation !== 'logical') process.exit(1);
NODE
  then
    runner_ready=1
    break
  fi
  sleep 1
done
if [[ "$runner_ready" -ne 1 ]]; then
  echo "Agent Runner did not report a usable native runtime." >&2
  compose exec -T backend node - <<'NODE' || true
const token = process.env.AGENT_RUNNER_TOKEN;
const response = await fetch(process.env.AGENT_RUNNER_URL + '/v1/availability', {
  headers: { authorization: `Bearer ${token}`, 'x-nexus-agent-protocol': '2026-09-13' },
}).catch(() => null);
if (!response) {
  console.error('runner availability: unreachable');
  process.exit(1);
}
console.error(`runner availability: ${response.status} ${await response.text()}`);
NODE
  exit 1
fi

host_tool_snapshot() {
  local tool path resolved
  for tool in node python3 go; do
    path="/usr/bin/$tool"
    if [[ -e "$path" || -L "$path" ]]; then
      resolved="$(readlink -f "$path" 2>/dev/null || printf '%s' "$path")"
      printf '%s\t' "$tool"
      stat -Lc '%d:%i:%s:%Y:%a' "$path"
      printf 'link=%s\n' "$(readlink "$path" 2>/dev/null || true)"
      if [[ -f "$resolved" ]]; then sha256sum "$resolved"; fi
    else
      printf '%s\tMISSING\n' "$tool"
    fi
  done | sha256sum | awk '{print $1}'
}
host_tool_snapshot_before="$(host_tool_snapshot)"

# Exercise the actual Controller -> Tool Store -> native Workspace Dev Environment -> job
# path, not only binary presence or HTTP health. The probe originates from Backend
# through the host-gateway path using the same shared Controller token as production.
compose exec -T -e NEXUS_BROWSER_PROBE_PORT="$browser_probe_port" backend node - <<'NODE'
const { randomUUID } = await import('node:crypto');
const { lookup } = await import('node:dns/promises');
const baseUrl = process.env.AGENT_RUNNER_URL;
const token = process.env.AGENT_RUNNER_TOKEN;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-nexus-agent-protocol': '2026-09-13' };
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const get = async (path) => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, { headers });
    } catch (cause) {
      const transportFailure = cause instanceof TypeError && cause.message === 'fetch failed';
      if (!transportFailure || attempt === 5) throw cause;
      console.error(`GET ${path} transport retry ${attempt}/5: ${cause.cause?.code ?? cause.message}`);
      await wait(200 * attempt);
      continue;
    }
    if (!response.ok) throw new Error(`GET ${path} failed: ${response.status} ${await response.text()}`);
    return response.json();
  }
  throw new Error(`GET ${path} exhausted transport retries`);
};
const post = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`POST ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
};
const awaitCommand = async (submitted, timeoutMs = 12 * 60 * 1000) => {
  if (!['pending', 'running'].includes(submitted?.status)) return submitted;
  const deadline = Date.now() + timeoutMs;
  let current = submitted;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    current = await get(`/v1/commands/${encodeURIComponent(submitted.commandId)}`);
    if (!['pending', 'running'].includes(current.status)) return current;
  }
  throw new Error(`Runner command timed out: ${JSON.stringify(current)}`);
};
const submitCommand = async (body) => awaitCommand(await post('/v1/commands', body));
const catalog = await get('/v1/catalog');
const recipe = catalog.recipes.find((candidate) => candidate.id === 'workspace-dev');
const pack = catalog.packs.find((candidate) => candidate.familyId === 'base-tools' && candidate.enabled);
const nodePack = catalog.packs.find(
  (candidate) => candidate.familyId === 'node' && candidate.enabled && candidate.contentDigest,
);
if (!recipe || !pack?.contentDigest || !nodePack?.contentDigest) {
  throw new Error('Smoke catalog does not expose the Workspace Runtime/base-tools/Node profile.');
}

const acpSmokeAgentSource = String.raw`const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const sessionId = 'smoke-acp-session';
let promptRequestId = null;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const fail = (message) => { process.stderr.write(message + '\n'); process.exit(42); };
rl.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { fail('invalid JSON-RPC input'); return; }
  if (message?.method === 'initialize' && message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false } } });
    return;
  }
  if (message?.method === 'session/new' && message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId } });
    return;
  }
  if (message?.method === 'session/prompt' && message.id !== undefined) {
    if (message.params?.sessionId !== sessionId) fail('unexpected session id');
    promptRequestId = message.id;
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'acp-live-' } },
      },
    });
    send({
      jsonrpc: '2.0',
      id: 'permission-1',
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: {
          toolCallId: 'smoke-sensitive-tool',
          title: 'Smoke sensitive operation',
          kind: 'edit',
          status: 'pending',
          rawInput: { action: 'write' },
        },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });
    return;
  }
  if (message?.id === 'permission-1' && message.method === undefined) {
    const outcome = message.result?.outcome;
    if (outcome?.outcome !== 'selected' || outcome.optionId !== 'reject') {
      fail('ACP permission did not fail closed');
    }
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'permission-rejected' },
        },
      },
    });
    send({ jsonrpc: '2.0', id: promptRequestId, result: { stopReason: 'end_turn' } });
    return;
  }
  if (message?.method === 'session/cancel') return;
  if (message?.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
});`;

const now = () => Math.floor(Date.now() / 1000);
const workspaceId = `smoke-workspace-${randomUUID()}`;
const identity = {
  userId: 1,
  appId: 'operations.default',
  runId: 'smoke-run',
  agentRuntimeId: 'smoke-runtime',
  workspaceId,
  generation: 1,
  recipeId: recipe.id,
  recipeRevision: recipe.revision,
  runtimeDigest: catalog.runtimeDigest,
  catalogRevision: catalog.revision,
  toolchain: [
    { familyId: pack.familyId, versionId: pack.versionId, contentDigest: pack.contentDigest },
    { familyId: nodePack.familyId, versionId: nodePack.versionId, contentDigest: nodePack.contentDigest },
  ],
  runnerPlugins: [],
  acpProfiles: [
    {
      id: 'smoke-acp',
      profileRevision: 1,
      argv: [`/opt/nexus/packs/node/${nodePack.versionId}/bin/node`, '-e', acpSmokeAgentSource],
      cwd: '/workspace',
    },
  ],
  browserTarget: null,
  retained: false,
};
const command = (action, generation = 1) => ({
  workspaceId,
  generation,
  ...(action === 'provision'
    ? {
        recipeId: identity.recipeId,
        recipeRevision: identity.recipeRevision,
        runtimeDigest: identity.runtimeDigest,
        catalogRevision: identity.catalogRevision,
        toolchain: identity.toolchain,
        runnerPlugins: identity.runnerPlugins,
        acpProfiles: identity.acpProfiles,
        browserTarget: identity.browserTarget,
        retained: identity.retained,
      }
    : {}),
  commandId: `smoke-${action}-${generation}-${randomUUID()}`,
  action,
  deadlineAt: now() + 60,
});

const provision = await submitCommand(command('provision'));
if (provision.status !== 'succeeded') throw new Error(`Runner provision failed: ${JSON.stringify(provision)}`);
const start = await submitCommand(command('start'));
if (start.status !== 'succeeded') throw new Error(`Runner start failed: ${JSON.stringify(start)}`);

const { RunnerHttpAdapter } = await import('/app/dist/infrastructure/agent/workspace-runtime/runner-http.adapter.js');
const { RunnerWorkspaceTerminalAdapter } = await import(
  '/app/dist/infrastructure/agent/workspace-runtime/runner-workspace-terminal.adapter.js'
);
const runnerAdapter = new RunnerHttpAdapter(baseUrl, token);

// ACP live smoke: run the exact production acp_execute tool over the exact production
// AcpAdapter -> authenticated Runner stream -> native Workspace ACP process. The smoke
// agent requests a sensitive permission and refuses to finish unless Nexus selects reject_once.
{
  const { AcpAdapter } = await import('/app/dist/infrastructure/agent/integrations/acp.adapter.js');
  const { createAcpExecuteTool } = await import('/app/dist/modules/agent/tools/host/acp-tools.js');
  const { NodeCryptoHashAdapter } = await import('/app/dist/infrastructure/agent/capabilities/node-crypto-hash.adapter.js');
  const integrationId = randomUUID();
  const integration = {
    id: integrationId,
    userId: identity.userId,
    appId: identity.appId,
    kind: 'acp',
    configuration: {
      displayName: 'Smoke ACP',
      transport: 'workspace-profile',
      profileId: 'smoke-acp',
      protocolVersion: '1',
    },
    hasCredential: false,
    credentialRevision: 1,
    schemaHash: null,
    enabled: true,
    version: 1,
    createdAt: now(),
    updatedAt: now(),
  };
  const workspaceView = {
    id: workspaceId,
    userId: identity.userId,
    appId: identity.appId,
    runId: identity.runId,
    agentRuntimeId: identity.agentRuntimeId,
    retained: false,
    profile: { acpProfiles: identity.acpProfiles },
    generation: 1,
    status: 'running',
    version: 1,
  };
  const runtime = new AcpAdapter(runnerAdapter);
  const tool = createAcpExecuteTool(
    { get: async () => integration },
    { getWorkspace: async () => workspaceView },
    runtime,
    new NodeCryptoHashAdapter(),
  );
  const context = {
    userId: identity.userId,
    appId: identity.appId,
    actor: { type: 'user', userId: identity.userId },
    runId: identity.runId,
    agentRuntimeId: identity.agentRuntimeId,
    stepId: 'smoke-acp-step',
    signal: AbortSignal.timeout(20_000),
    deadlineAt: now() + 20,
    maxOutputBytes: 4096,
    inputRevision: 1,
  };
  const inspection = await tool.inspect(
    { integrationId, workspaceId, prompt: 'run ACP live smoke', cwd: '/workspace/work' },
    context,
    1,
  );
  if (inspection.risk !== 'mutate' || !inspection.mutation) {
    throw new Error(`ACP tool inspection is not mutation-gated: ${JSON.stringify(inspection)}`);
  }
  const result = await tool.execute(inspection, context);
  if (
    !result.ok ||
    result.data?.text !== 'acp-live-permission-rejected' ||
    result.data?.stopReason !== 'end_turn'
  ) {
    throw new Error(`ACP live execution smoke failed: ${JSON.stringify(result)}`);
  }
}

// Local Workspace Terminal smoke: use the production Backend adapter plus the Workspace
// Runtime terminal registry. Detach/re-attach must preserve the same PTY and replay bounded
// output produced while no browser WebSocket is attached.
{
  const { WorkspaceRuntimeTerminalService } = await import(
    '/app/dist/modules/agent/workspace-runtime/workspace-runtime-terminal.service.js'
  );
  const terminalAdapter = new RunnerWorkspaceTerminalAdapter(runnerAdapter);
  const terminalService = new WorkspaceRuntimeTerminalService(
    { getWorkspace: async () => ({ generation: 1, status: 'running' }) },
    terminalAdapter,
    { get: async () => ({ effectiveSettings: { feature: { enabled: true } } }) },
    { get: async () => ({ desiredState: 'enabled', observedState: 'running' }) },
    { authorize: async () => ({ allowed: true, code: 'ALLOWED' }) },
  );
  const scope = { userId: identity.userId, appId: identity.appId };
  const first = await terminalService.open(scope, workspaceId, 1, 80, 24, undefined, AbortSignal.timeout(15_000));
  first.resize(120, 40);
  let firstOutput = '';
  const firstMarker = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Workspace Terminal first marker timed out: ${JSON.stringify(firstOutput)}`)), 10_000);
    const off = first.onData((chunk) => {
      firstOutput += Buffer.from(chunk).toString('utf8');
      if (
        !firstOutput.includes('workspace-terminal-size-40 120') ||
        !firstOutput.includes('workspace-terminal-first-ok')
      ) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
  first.write(
    "for i in $(seq 1 40); do size=$(stty size); [ \"$size\" = \"40 120\" ] && break; sleep 0.05; done; " +
    "printf 'workspace-terminal-size-%s\\n' \"$size\"; " +
    "export NEXUS_TERMINAL_RECONNECT=preserved; printf 'workspace-terminal-first-%s\\n' ok; " +
    "sleep 0.2; printf 'workspace-terminal-detached-%s\\n' output\n",
  );
  await firstMarker;
  const terminalSessionId = first.sessionId;
  first.detach();
  await new Promise((resolve) => setTimeout(resolve, 400));

  const second = await terminalService.open(
    scope,
    workspaceId,
    1,
    100,
    30,
    terminalSessionId,
    AbortSignal.timeout(15_000),
  );
  let secondOutput = '';
  const replayMarker = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Workspace Terminal replay timed out: ${JSON.stringify(secondOutput)}`)), 10_000);
    const off = second.onData((chunk) => {
      secondOutput += Buffer.from(chunk).toString('utf8');
      if (!secondOutput.includes('workspace-terminal-detached-output')) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
  second.replayBuffered();
  await replayMarker;

  const stateMarker = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Workspace Terminal state check timed out: ${JSON.stringify(secondOutput)}`)), 10_000);
    const off = second.onData((chunk) => {
      secondOutput += Buffer.from(chunk).toString('utf8');
      if (!secondOutput.includes('workspace-terminal-reconnect-preserved')) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
  second.write("printf 'workspace-terminal-reconnect-%s\\n' \"$NEXUS_TERMINAL_RECONNECT\"\n");
  await stateMarker;

  // Programmatic signal must target the PTY foreground process group, not only the shell PID.
  // This catches the native-runtime failure mode where a foreground child survives or the shell is killed instead.
  const signalReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Workspace Terminal signal setup timed out: ${JSON.stringify(secondOutput)}`)), 10_000);
    const off = second.onData((chunk) => {
      secondOutput += Buffer.from(chunk).toString('utf8');
      if (!secondOutput.includes('workspace-terminal-signal-ready')) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
  second.write("printf 'workspace-terminal-signal-%s\\n' ready; sleep 30; printf 'workspace-terminal-signal-%s\\n' missed\n");
  await signalReady;
  await new Promise((resolve) => setTimeout(resolve, 150));
  second.signal('INT');
  const signalDone = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Workspace Terminal foreground signal timed out: ${JSON.stringify(secondOutput)}`)), 10_000);
    const off = second.onData((chunk) => {
      secondOutput += Buffer.from(chunk).toString('utf8');
      if (!secondOutput.includes('workspace-terminal-signal-ok')) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
  second.write("printf 'workspace-terminal-signal-%s\\n' ok\n");
  await signalDone;
  if (secondOutput.includes('workspace-terminal-signal-missed')) {
    throw new Error(`Workspace Terminal foreground process ignored SIGINT: ${JSON.stringify(secondOutput)}`);
  }

  // Closing a PTY session must also reap background/disowned descendants from that terminal session.
  const backgroundReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() =>
      reject(new Error(`Workspace Terminal background setup timed out: ${JSON.stringify(secondOutput)}`)), 10_000);
    const off = second.onData((chunk) => {
      secondOutput += Buffer.from(chunk).toString('utf8');
      if (!secondOutput.includes('workspace-terminal-background-ready')) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
  second.write(
    "nohup sleep 300 </dev/null >/dev/null 2>&1 & " +
    "printf '%s' \"$!\" > \"$NEXUS_WORKSPACE_ROOT/work/.terminal-background-pid\"; " +
    "printf 'workspace-terminal-background-%s\\n' ready\n",
  );
  await backgroundReady;
  await second.close();
  await terminalService.closeAll();
  await terminalAdapter.closeAll();
}

// Browser direct path smoke: the exact production Backend BrowserRuntime connects to
// host/external Chromium without Agent Runner, then exercises the restricted semantic API.
{
  // Chromium rejects DevTools discovery/WebSocket requests whose Host header is an
  // arbitrary DNS name. Docker's host-gateway alias is convenient for reachability,
  // but resolve it here so the actual CDP endpoint uses an IP-literal Host header.
  const hostGateway = await lookup('host.docker.internal', { family: 4 });
  const { BrowserRuntimeAdapter } = await import(
    '/app/dist/infrastructure/agent/integrations/browser-runtime.adapter.js'
  );
  const directOnly = new BrowserRuntimeAdapter({
    openBrowserTunnel: async () => { throw new Error('RUNNER_TUNNEL_MUST_NOT_BE_USED'); },
  });
  const session = await directOnly.createSession(
    {
      userId: 1,
      appId: 'nexus.operations',
      runId: 'smoke-browser-direct-run',
      agentRuntimeId: 'smoke-browser-direct-runtime',
      target: {
        id: 'smoke-direct-chrome',
        profileRevision: 1,
        endpoints: [
          {
            scope: 'external-network',
            via: 'backend',
            url: `http://${hostGateway.address}:${process.env.NEXUS_E2E_DIRECT_CDP_PORT}`,
            priority: 10,
            allowPlaintext: true,
            verifyTls: true,
          },
        ],
        allowedUrlPatterns: [`http://127.0.0.1:${process.env.NEXUS_E2E_BROWSER_PAGE_PORT}`],
      },
    },
    AbortSignal.timeout(15_000),
  );
  try {
    await directOnly.navigate(
      session.sessionId,
      `http://127.0.0.1:${process.env.NEXUS_E2E_BROWSER_PAGE_PORT}/`,
      AbortSignal.timeout(15_000),
    );
    const first = await directOnly.snapshot(session.sessionId, { maxNodes: 100, maxBytes: 32768 }, AbortSignal.timeout(15_000));
    const input = first.nodes.find((node) => node.role === 'textbox' && node.name === 'Name');
    const button = first.nodes.find((node) => node.role === 'button' && node.name === 'Apply');
    if (!input || !button || first.title !== 'Nexus Browser Smoke') throw new Error(`Browser direct snapshot invalid: ${JSON.stringify(first)}`);
    await directOnly.type(session.sessionId, first.snapshotId, input.nodeRef, 'Nexus', AbortSignal.timeout(15_000));
    let staleRejected = false;
    try {
      await directOnly.click(session.sessionId, first.snapshotId, button.nodeRef, AbortSignal.timeout(15_000));
    } catch (error) {
      staleRejected = error instanceof Error && error.message === 'BROWSER_NODE_STALE';
    }
    if (!staleRejected) throw new Error('Browser direct stale nodeRef was not rejected.');
    const second = await directOnly.snapshot(session.sessionId, {}, AbortSignal.timeout(15_000));
    const freshButton = second.nodes.find((node) => node.role === 'button' && node.name === 'Apply');
    if (!freshButton) throw new Error('Browser direct fresh button missing.');
    await directOnly.click(session.sessionId, second.snapshotId, freshButton.nodeRef, AbortSignal.timeout(15_000));
    const third = await directOnly.snapshot(session.sessionId, {}, AbortSignal.timeout(15_000));
    if (!third.nodes.some((node) => node.text === 'Nexus' || node.name === 'Nexus')) {
      throw new Error(`Browser direct click/type result missing: ${JSON.stringify(third)}`);
    }
    let denied = false;
    try {
      await directOnly.navigate(session.sessionId, 'https://not-allowed.invalid/', AbortSignal.timeout(5_000));
    } catch (error) {
      denied = error instanceof Error && error.message === 'BROWSER_URL_DENIED';
    }
    if (!denied) throw new Error('Browser direct URL policy was not enforced.');
  } finally {
    await directOnly.closeAll();
  }
}

// Browser Runner path smoke: Backend sends an opaque configured endpoint and CDP text
// frame through Runner. The target is only an echo peer, proving Runner has no Browser
// session/snapshot/click/type semantics of its own.
{
  const browserTunnel = await runnerAdapter.openBrowserTunnel(
    {
      scope: 'external-network',
      via: 'runner',
      url: `ws://127.0.0.1:${process.env.NEXUS_BROWSER_PROBE_PORT}`,
      priority: 10,
      allowPlaintext: true,
      verifyTls: true,
    },
    { targetId: 'smoke-browser-tunnel', targetRevision: 1 },
    AbortSignal.timeout(10_000),
  );
  const message = JSON.stringify({ id: 1, method: 'Browser.getVersion' });
  const echoed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser tunnel smoke timed out')), 5_000);
    const off = browserTunnel.onMessage((candidate) => {
      clearTimeout(timer);
      off();
      resolve(candidate);
    });
  });
  browserTunnel.send(message);
  if ((await echoed) !== message) throw new Error('Browser tunnel altered the CDP message.');
  await browserTunnel.close();
}

const jobId = `smoke-job-${randomUUID()}`;
const job = {
  jobId,
  generation: 1,
  deadlineAt: now() + 30,
  argv: [
    'nexus-sh',
    '-c',
    'terminal_pid=$(cat "$NEXUS_WORKSPACE_ROOT/work/.terminal-background-pid"); terminal_alive=1; terminal_check=0; while [ "$terminal_check" -lt 40 ]; do if ! kill -0 "$terminal_pid" 2>/dev/null; then terminal_alive=0; break; fi; terminal_state=$(awk "{print \$3}" "/proc/$terminal_pid/stat" 2>/dev/null || true); if [ "$terminal_state" = Z ]; then terminal_alive=0; break; fi; terminal_check=$((terminal_check + 1)); sleep 0.05; done; if [ "$terminal_alive" -ne 0 ]; then printf terminal-process-leaked >&2; exit 41; fi; sleep 300 & printf "%s" "$!" > "$NEXUS_WORKSPACE_ROOT/work/.background-pid"; printf workspace-stable > "$NEXUS_WORKSPACE_ROOT/work/.version-switch-marker"; printf "%s" "$NEXUS_TOOLCHAIN_FINGERPRINT" > "$NEXUS_DEPS_ROOT/.toolchain-profile-marker"; printf runner-runtime-ok',
  ],
  cwd: '/workspace',
  maxBytes: 4096,
  timeoutMs: 5000,
};
await post(`/v1/workspaces/${encodeURIComponent(workspaceId)}/jobs`, job);
let result;
for (let attempt = 0; attempt < 100; attempt += 1) {
  result = await get(`/v1/jobs/${encodeURIComponent(jobId)}`);
  if (!['pending', 'running'].includes(result.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (result?.status !== 'succeeded' || result.result?.stdout !== 'runner-runtime-ok' || result.result?.exitCode !== 0) {
  throw new Error(`Runner native runtime job failed: ${JSON.stringify(result)}`);
}

// One-shot jobs must not leak daemon/background descendants after their leader exits.
const processTreeJobId = `smoke-process-tree-${randomUUID()}`;
await post(`/v1/workspaces/${encodeURIComponent(workspaceId)}/jobs`, {
  ...job,
  jobId: processTreeJobId,
  deadlineAt: now() + 30,
  argv: [
    'nexus-sh',
    '-c',
    'pid=$(cat "$NEXUS_WORKSPACE_ROOT/work/.background-pid"); ! kill -0 "$pid" 2>/dev/null && printf workspace-process-tree-clean-ok',
  ],
});
let processTreeResult;
for (let attempt = 0; attempt < 100; attempt += 1) {
  processTreeResult = await get(`/v1/jobs/${encodeURIComponent(processTreeJobId)}`);
  if (!['pending', 'running'].includes(processTreeResult.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (
  processTreeResult?.status !== 'succeeded' ||
  processTreeResult.result?.stdout !== 'workspace-process-tree-clean-ok' ||
  processTreeResult.result?.exitCode !== 0
) {
  throw new Error(`Runner Workspace job leaked a descendant process: ${JSON.stringify(processTreeResult)}`);
}
const remove = await submitCommand(command('delete'));
if (remove.status !== 'succeeded') throw new Error(`Runner delete failed: ${JSON.stringify(remove)}`);

// A tool-version switch recreates only the runtime generation. The Workspace filesystem
// must remain stable so a new Node/Python/Go selection never copies or loses project files.
const reprovision = await submitCommand(command('provision', 2));
if (reprovision.status !== 'succeeded') {
  throw new Error(`Runner reprovision failed: ${JSON.stringify(reprovision)}`);
}
const restart = await submitCommand(command('start', 2));
if (restart.status !== 'succeeded') throw new Error(`Runner generation 2 start failed: ${JSON.stringify(restart)}`);
const generationJobId = `smoke-generation-${randomUUID()}`;
const generationJob = {
  ...job,
  jobId: generationJobId,
  generation: 2,
  deadlineAt: now() + 30,
  argv: [
    'nexus-sh',
    '-c',
    'test "$(cat "$NEXUS_WORKSPACE_ROOT/work/.version-switch-marker")" = workspace-stable && test "$(cat "$NEXUS_DEPS_ROOT/.toolchain-profile-marker")" = "$NEXUS_TOOLCHAIN_FINGERPRINT" && printf workspace-generation-ok',
  ],
};
await post(`/v1/workspaces/${encodeURIComponent(workspaceId)}/jobs`, generationJob);
let generationResult;
for (let attempt = 0; attempt < 100; attempt += 1) {
  generationResult = await get(`/v1/jobs/${encodeURIComponent(generationJobId)}`);
  if (!['pending', 'running'].includes(generationResult.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (
  generationResult?.status !== 'succeeded' ||
  generationResult.result?.stdout !== 'workspace-generation-ok' ||
  generationResult.result?.exitCode !== 0
) {
  throw new Error(`Runner stable Workspace generation check failed: ${JSON.stringify(generationResult)}`);
}
const removeGeneration = await submitCommand(command('delete', 2));
if (removeGeneration.status !== 'succeeded') {
  throw new Error(`Runner generation 2 delete failed: ${JSON.stringify(removeGeneration)}`);
}

const ref = (familyId, versionId) => {
  const candidate = catalog.packs.find(
    (item) => item.familyId === familyId && item.versionId === versionId && item.enabled && item.contentDigest,
  );
  if (!candidate) throw new Error(`Required smoke Tool Pack unavailable: ${familyId}@${versionId}`);
  return { familyId, versionId, contentDigest: candidate.contentDigest };
};
const baseRef = ref('base-tools', '1');
const newToolchain = [baseRef, ref('go', '1.27.1'), ref('node', '24.21.0'), ref('python', '3.14.7')];
const oldToolchain = [baseRef, ref('go', '1.26.8'), ref('node', '22.23.2'), ref('python', '3.13.15')];
const makeIdentity = (workspaceId, generation, toolchain) => ({
  workspaceId,
  generation,
  recipeId: recipe.id,
  recipeRevision: recipe.revision,
  runtimeDigest: catalog.runtimeDigest,
  catalogRevision: catalog.revision,
  toolchain,
  runnerPlugins: [],
  acpProfiles: [],
  browserTarget: null,
  retained: false,
});
const lifecycle = (identity, action) => ({
  workspaceId: identity.workspaceId,
  generation: identity.generation,
  ...(action === 'provision'
    ? {
        recipeId: identity.recipeId,
        recipeRevision: identity.recipeRevision,
        runtimeDigest: identity.runtimeDigest,
        catalogRevision: identity.catalogRevision,
        toolchain: identity.toolchain,
        runnerPlugins: identity.runnerPlugins,
        acpProfiles: identity.acpProfiles,
        browserTarget: identity.browserTarget,
        retained: identity.retained,
      }
    : {}),
  commandId: `smoke-${action}-${identity.generation}-${randomUUID()}`,
  action,
  deadlineAt: now() + 15 * 60,
});
const runWorkspaceJob = async (identity, shell, expectedStdout) => {
  const id = `smoke-toolchain-${randomUUID()}`;
  await post(`/v1/workspaces/${encodeURIComponent(identity.workspaceId)}/jobs`, {
    jobId: id,
    generation: identity.generation,
    deadlineAt: now() + 60,
    argv: ['nexus-sh', '-c', shell],
    cwd: '/workspace',
    maxBytes: 16 * 1024,
    timeoutMs: 30_000,
  });
  let current;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    current = await get(`/v1/jobs/${encodeURIComponent(id)}`);
    if (!['pending', 'running'].includes(current.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (current?.status !== 'succeeded' || current.result?.exitCode !== 0 || current.result?.stdout !== expectedStdout) {
    throw new Error(`Workspace toolchain job failed: ${JSON.stringify(current)}`);
  }
};
const requireLifecycle = async (identity, action) => {
  const result = await submitCommand(lifecycle(identity, action));
  if (result.status !== 'succeeded') {
    throw new Error(`Runner ${action} failed for ${identity.workspaceId}: ${JSON.stringify(result)}`);
  }
  return result;
};

const workspaceA = `smoke-toolchain-a-${randomUUID()}`;
const workspaceB = `smoke-toolchain-b-${randomUUID()}`;
const aNew1 = makeIdentity(workspaceA, 1, newToolchain);
const bOld1 = makeIdentity(workspaceB, 1, oldToolchain);
await requireLifecycle(aNew1, 'provision');
await requireLifecycle(aNew1, 'start');
await requireLifecycle(bOld1, 'provision');
await requireLifecycle(bOld1, 'start');
await runWorkspaceJob(
  aNew1,
  [
    'test "$(node --version)" = v24.21.0',
    'test "$(python3 --version)" = "Python 3.14.7"',
    'test "$(go version | awk \'{print $3}\')" = go1.27.1',
    'test ! -e "$NEXUS_DEPS_ROOT/.profile-marker"',
    'printf A-stable > "$NEXUS_WORKSPACE_ROOT/work/.workspace-marker"',
    'printf A-new > "$NEXUS_DEPS_ROOT/.profile-marker"',
    'printf "%s" "$NEXUS_TOOLCHAIN_FINGERPRINT" > "$NEXUS_WORKSPACE_ROOT/work/.new-fingerprint"',
    'printf A-new-ok',
  ].join(' && '),
  'A-new-ok',
);
await runWorkspaceJob(
  bOld1,
  [
    'test "$(node --version)" = v22.23.2',
    'test "$(python3 --version)" = "Python 3.13.15"',
    'test "$(go version | awk \'{print $3}\')" = go1.26.8',
    'test ! -e "$NEXUS_DEPS_ROOT/.profile-marker"',
    'printf B-stable > "$NEXUS_WORKSPACE_ROOT/work/.workspace-marker"',
    'printf B-old > "$NEXUS_DEPS_ROOT/.profile-marker"',
    'printf B-old-ok',
  ].join(' && '),
  'B-old-ok',
);

await requireLifecycle(aNew1, 'delete');
const aOld2 = makeIdentity(workspaceA, 2, oldToolchain);
await requireLifecycle(aOld2, 'provision');
await requireLifecycle(aOld2, 'start');
await runWorkspaceJob(
  aOld2,
  [
    'test "$(cat "$NEXUS_WORKSPACE_ROOT/work/.workspace-marker")" = A-stable',
    'test "$(node --version)" = v22.23.2',
    'test "$(python3 --version)" = "Python 3.13.15"',
    'test "$(go version | awk \'{print $3}\')" = go1.26.8',
    'test ! -e "$NEXUS_DEPS_ROOT/.profile-marker"',
    'test "$(cat "$NEXUS_WORKSPACE_ROOT/work/.new-fingerprint")" != "$NEXUS_TOOLCHAIN_FINGERPRINT"',
    'printf A-old > "$NEXUS_DEPS_ROOT/.profile-marker"',
    'printf A-old-ok',
  ].join(' && '),
  'A-old-ok',
);
await runWorkspaceJob(
  bOld1,
  [
    'test "$(cat "$NEXUS_WORKSPACE_ROOT/work/.workspace-marker")" = B-stable',
    'test "$(cat "$NEXUS_DEPS_ROOT/.profile-marker")" = B-old',
    'test "$(node --version)" = v22.23.2',
    'test "$(python3 --version)" = "Python 3.13.15"',
    'test "$(go version | awk \'{print $3}\')" = go1.26.8',
    'printf B-stable-ok',
  ].join(' && '),
  'B-stable-ok',
);

await requireLifecycle(aOld2, 'delete');
const aNew3 = makeIdentity(workspaceA, 3, newToolchain);
await requireLifecycle(aNew3, 'provision');
await requireLifecycle(aNew3, 'start');
await runWorkspaceJob(
  aNew3,
  [
    'test "$(cat "$NEXUS_WORKSPACE_ROOT/work/.workspace-marker")" = A-stable',
    'test "$(cat "$NEXUS_DEPS_ROOT/.profile-marker")" = A-new',
    'test "$(cat "$NEXUS_WORKSPACE_ROOT/work/.new-fingerprint")" = "$NEXUS_TOOLCHAIN_FINGERPRINT"',
    'test "$(node --version)" = v24.21.0',
    'test "$(python3 --version)" = "Python 3.14.7"',
    'test "$(go version | awk \'{print $3}\')" = go1.27.1',
    'printf A-new-reused-ok',
  ].join(' && '),
  'A-new-reused-ok',
);
await requireLifecycle(aNew3, 'delete');
await requireLifecycle(bOld1, 'delete');

// Runtime cleanup is confirmation-scoped by the Backend. Runner must delete only the
// explicitly authorized Workspace ids and must not rescan unrelated reclaimable state.
const cleanupWorkspaceA = `smoke-cleanup-a-${randomUUID()}`;
const cleanupWorkspaceB = `smoke-cleanup-b-${randomUUID()}`;
const cleanupA = makeIdentity(cleanupWorkspaceA, 1, oldToolchain);
const cleanupB = makeIdentity(cleanupWorkspaceB, 1, oldToolchain);
await requireLifecycle(cleanupA, 'provision');
await requireLifecycle(cleanupB, 'provision');
const cleanupCommand = await submitCommand({
  commandId: `smoke-runtime-cleanup-${randomUUID()}`,
  action: 'runtimeCleanup',
  deadlineAt: now() + 60,
  workspaceIds: [cleanupWorkspaceA],
});
if (
  cleanupCommand.status !== 'succeeded' ||
  JSON.stringify(cleanupCommand.result?.deleted) !== JSON.stringify([cleanupWorkspaceA]) ||
  (cleanupCommand.result?.skipped?.length ?? 0) !== 0
) {
  throw new Error(`Runner scoped runtime cleanup failed: ${JSON.stringify(cleanupCommand)}`);
}
const cleanupStorage = await get('/v1/storage');
if (cleanupStorage.byWorkspace.some((item) => item.workspaceId === cleanupWorkspaceA)) {
  throw new Error('Runtime cleanup kept the confirmed Workspace in Runner storage.');
}
if (!cleanupStorage.byWorkspace.some((item) => item.workspaceId === cleanupWorkspaceB && item.status === 'ready')) {
  throw new Error('Runtime cleanup removed or changed an unconfirmed Workspace.');
}
await requireLifecycle(cleanupB, 'delete');
const cleanupBCommand = await submitCommand({
  commandId: `smoke-runtime-cleanup-${randomUUID()}`,
  action: 'runtimeCleanup',
  deadlineAt: now() + 60,
  workspaceIds: [cleanupWorkspaceB],
});
if (cleanupBCommand.status !== 'succeeded' || cleanupBCommand.result?.deleted?.[0] !== cleanupWorkspaceB) {
  throw new Error(`Runner cleanup teardown failed: ${JSON.stringify(cleanupBCommand)}`);
}

console.log(
  'agent runner: native job + ACP stream + direct PTY terminal + Browser tunnel ok; stable workspace generation ok; multi-version node/python/go runtime profiles reusable; runtime cleanup scoped',
);
NODE

# Both multi-version Workspaces share the global immutable Tool Store. Reusing the same
# exact PackRef must not create per-Workspace copies or duplicate digest directories.
assert_single_pack_copy() {
  local family="$1"
  local version="$2"
  local root="$runner_root/packs/$family/$version"
  local copies
  [[ -d "$root" ]] || { echo "Expected Tool Store pack missing: $family@$version" >&2; exit 1; }
  copies="$(find "$root" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  [[ "$copies" == "1" ]] || {
    echo "Tool Store contains $copies immutable copies for $family@$version; expected exactly one." >&2
    exit 1
  }
}
assert_single_pack_copy base-tools 1
assert_single_pack_copy node 24.21.0
assert_single_pack_copy node 22.23.2
assert_single_pack_copy python 3.14.7
assert_single_pack_copy python 3.13.15
assert_single_pack_copy go 1.27.1
assert_single_pack_copy go 1.26.8

host_tool_snapshot_after="$(host_tool_snapshot)"
[[ "$host_tool_snapshot_before" == "$host_tool_snapshot_after" ]] || {
  echo 'Runner Tool Store modified host /usr/bin tool state.' >&2
  exit 1
}

# A damaged execution journal must fail closed and preserve evidence instead of silently
# booting with an empty control plane while runtime directories still exist.
corrupt_runner_root="$workspace/agent-runner-corrupt"
corrupt_runner_log="$workspace/agent-runner-corrupt.log"
mkdir -p "$corrupt_runner_root/state"
printf '{not-json' > "$corrupt_runner_root/state/journal.json"
if NEXUS_AGENT_RUNNER_HOST=127.0.0.1 \
  PORT=0 \
  NEXUS_AGENT_RUNNER_TOKEN="$runner_token" \
  NEXUS_AGENT_RUNNER_ROOT="$corrupt_runner_root" \
  NEXUS_AGENT_CATALOG="$repo_root/scripts/docker/agent-runner/catalog/catalog.json" \
  node "$repo_root/packages/agent-runner/dist/index.js" >"$corrupt_runner_log" 2>&1; then
  echo 'Agent Runner accepted a corrupt journal.' >&2
  exit 1
fi
grep -Fq 'RUNNER_JOURNAL_INVALID' "$corrupt_runner_log"
grep -Fq '{not-json' "$corrupt_runner_root/state/journal.json" || {
  echo 'Agent Runner replaced the corrupt journal instead of failing closed.' >&2
  exit 1
}
compgen -G "$corrupt_runner_root/state/journal.json.corrupt.*" >/dev/null || {
  echo 'Agent Runner did not preserve the corrupt journal evidence.' >&2
  exit 1
}
if NEXUS_AGENT_RUNNER_HOST=127.0.0.1 \
  PORT=0 \
  NEXUS_AGENT_RUNNER_TOKEN="$runner_token" \
  NEXUS_AGENT_RUNNER_ROOT="$corrupt_runner_root" \
  NEXUS_AGENT_CATALOG="$repo_root/scripts/docker/agent-runner/catalog/catalog.json" \
  node "$repo_root/packages/agent-runner/dist/index.js" >>"$corrupt_runner_log" 2>&1; then
  echo 'Agent Runner accepted the same corrupt journal on a retry.' >&2
  exit 1
fi
grep -Fq '{not-json' "$corrupt_runner_root/state/journal.json" || {
  echo 'Agent Runner changed corrupt journal state after a retry.' >&2
  exit 1
}

curl -fsS "http://127.0.0.1:${http_port}/" | grep -qi '<html'
curl -fsS "http://127.0.0.1:${http_port}/api/v1/status" | grep -q '"status"'
curl -fsS -H "Host: ssh.honus.top" "http://127.0.0.1:${http_port}/.well-known/webauthn" >/dev/null

NEXUS_PRODUCTION_BASE_URL="http://127.0.0.1:${http_port}" pnpm --dir "$repo_root/packages/e2e" run test:ingress

login_body='{"username":"e2e-admin","password":"E2e-Admin-Password-2026!","rememberMe":false}'
curl -fsS \
  -c "$cookie_jar" \
  -H 'Content-Type: application/json' \
  --data "$login_body" \
  "http://127.0.0.1:${http_port}/api/v1/auth/login" >/dev/null

cookie="$(awk 'BEGIN { first=1 } (!/^#/ || /^#HttpOnly_/) && NF >= 7 { if (!first) printf "; "; printf "%s=%s", $6, $7; first=0 }' "$cookie_jar")"
[[ -n "$cookie" ]] || { echo "Login succeeded without producing a session cookie." >&2; exit 1; }

# Destructive Agent lifecycle smoke through the real authenticated HTTP API and host Runner.
# This fixes two regressions that static architecture checks cannot observe: Run deletion must
# refuse attached Workspaces, and runtime-cleanup confirmation must not expand after preview.
COOKIE="$cookie" PORT="$http_port" node <<'NODE'
const { randomUUID } = require('node:crypto');
const port = Number(process.env.PORT);
const baseUrl = `http://127.0.0.1:${port}`;
const cookie = process.env.COOKIE;
const origin = baseUrl;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
void (async () => {
const call = async (method, path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  return { response, json, text };
};
const ok = async (method, path, body, headers = {}, expectedStatus) => {
  const result = await call(method, path, body, headers);
  if (expectedStatus !== undefined ? result.response.status !== expectedStatus : !result.response.ok) {
    throw new Error(`${method} ${path} failed: ${result.response.status} ${result.text}`);
  }
  return result.json?.data;
};
const csrf = (await ok('GET', '/api/v1/agent/security/csrf')).token;
const mutationHeaders = { 'X-Nexus-CSRF': csrf };
const recommended = await ok('GET', '/api/v1/agent/onboarding/recommended-plugin');
if (recommended.appId !== 'nexus.operations' || recommended.installed) {
  throw new Error(`Unexpected initial recommended plugin state: ${JSON.stringify(recommended)}`);
}
const installedOperations = await ok(
  'POST',
  '/api/v1/agent/onboarding/recommended-plugin/install',
  {},
  mutationHeaders,
  201,
);
if (!installedOperations.installedNow || installedOperations.app.id !== 'nexus.operations') {
  throw new Error(`Operations onboarding install failed: ${JSON.stringify(installedOperations)}`);
}
let featureSettings = await ok('GET', '/api/v1/agent/settings');
featureSettings = await ok(
  'PATCH',
  '/api/v1/agent/settings',
  { patch: { feature: { enabled: true } }, expectedVersion: featureSettings.revision },
  mutationHeaders,
);
if (!featureSettings.effectiveSettings.feature.enabled) throw new Error('Agent feature did not enable after Operations install.');
const provider = await ok(
  'POST',
  '/api/v1/agent/ai/providers',
  {
    kind: 'openai-compatible',
    displayName: 'Docker lifecycle smoke provider',
    baseUrl: 'https://host.docker.internal:443/v1',
    credential: 'docker-lifecycle-smoke-secret',
    models: [{ id: 'smoke-model', contextWindow: 8192, maxOutputTokens: 64, supportsTools: true }],
    privateHostExceptions: ['host.docker.internal:443'],
    enabled: true,
  },
  mutationHeaders,
  201,
);
const definitions = await ok('GET', '/api/v1/apps/nexus.operations/agent-definitions');
const definition = definitions[0];
if (!definition?.id) throw new Error('Operations Agent definition unavailable in deployment smoke.');
let lifecycleSettings = await ok('GET', '/api/v1/agent/settings');
lifecycleSettings = await ok(
  'PATCH',
  '/api/v1/agent/settings',
  { patch: { budget: { maxRunTokens: 1 } }, expectedVersion: lifecycleSettings.revision },
  mutationHeaders,
);
if (lifecycleSettings.effectiveSettings.budget.maxRunTokens !== 1) {
  throw new Error(`Lifecycle smoke budget was not applied: ${JSON.stringify(lifecycleSettings.effectiveSettings.budget)}`);
}
const catalog = await ok('GET', '/api/v1/agent/workspace-runtime/catalog');
const recipe = catalog.recipes.find((candidate) => candidate.id === 'workspace-dev');
if (!recipe) throw new Error('Workspace dev recipe unavailable through Backend API.');
lifecycleSettings = await ok(
  'PATCH',
  '/api/v1/agent/settings',
  { patch: { workspaceRuntime: { enabledRecipeIds: [recipe.id] } }, expectedVersion: lifecycleSettings.revision },
  mutationHeaders,
);
if (!lifecycleSettings.effectiveSettings.workspaceRuntime.enabledRecipeIds.includes(recipe.id)) {
  throw new Error(`Workspace recipe was not explicitly enabled for Run Environment smoke: ${JSON.stringify(lifecycleSettings.effectiveSettings.workspaceRuntime)}`);
}

const terminalRunStatuses = new Set(['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted']);
const createRun = async (title) => {
  const thread = await ok('POST', '/api/v1/apps/nexus.operations/threads', { title }, mutationHeaders, 201);
  const created = await ok(
    'POST',
    '/api/v1/apps/nexus.operations/runs',
    {
      schemaVersion: 1,
      threadId: thread.id,
      input: { text: 'deployment lifecycle smoke', artifactRefs: [] },
      agentDefinitionId: definition.id,
      model: { providerId: provider.id, modelId: 'smoke-model', configurationVersion: provider.version },
      connectionIds: [],
      environment: { recipeId: recipe.id, catalogRevision: catalog.revision },
    },
    { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
    201,
  );
  let current = created;
  const deadline = Date.now() + 10_000;
  while (['created', 'running'].includes(current.status)) {
    if (Date.now() >= deadline) throw new Error(`Lifecycle Run did not reach budget wait: ${JSON.stringify(current)}`);
    await wait(100);
    current = await ok('GET', `/api/v1/apps/nexus.operations/runs/${created.id}`);
  }
  if (current.status !== 'awaiting_budget') {
    throw new Error(`Lifecycle Run reached unexpected state before Workspace creation: ${JSON.stringify(current)}`);
  }
  if (
    current.definition?.environment?.recipeId !== recipe.id ||
    current.definition.environment.catalogRevision !== catalog.revision ||
    !current.definition.environment.runtimeDigest ||
    !Array.isArray(current.definition.environment.toolchain)
  ) {
    throw new Error(`Run Environment was not server-resolved and frozen: ${JSON.stringify(current.definition)}`);
  }
  return current;
};

const cancelToTerminal = async (run) => {
  let current = run;
  for (let attempt = 0; attempt < 8 && !terminalRunStatuses.has(current.status); attempt += 1) {
    const cancelled = await call(
      'POST',
      `/api/v1/apps/nexus.operations/runs/${run.id}/cancel`,
      { expectedVersion: current.version },
      { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
    );
    if (cancelled.response.ok) current = cancelled.json?.data;
    else if (cancelled.response.status !== 409) {
      throw new Error(`Run cancellation failed: ${cancelled.response.status} ${cancelled.text}`);
    }
    if (!terminalRunStatuses.has(current.status)) {
      await wait(150);
      current = await ok('GET', `/api/v1/apps/nexus.operations/runs/${run.id}`);
    }
  }
  const deadline = Date.now() + 45_000;
  while (!terminalRunStatuses.has(current.status)) {
    if (Date.now() >= deadline) throw new Error(`Run did not become terminal: ${JSON.stringify(current)}`);
    await wait(250);
    current = await ok('GET', `/api/v1/apps/nexus.operations/runs/${run.id}`);
  }
  return current;
};

const createReadyWorkspace = async (run, title) => {
  const conflict = await call(
    'POST',
    `/api/v1/apps/nexus.operations/runs/${run.id}/workspaces`,
    { schemaVersion: 1, workspace: { recipeId: 'not-the-frozen-environment' }, retained: false },
    { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
  );
  if (conflict.response.status !== 409 || conflict.json?.error?.code !== 'RUN_ENVIRONMENT_CONFLICT') {
    throw new Error(`Workspace create did not enforce frozen Run Environment: ${conflict.response.status} ${conflict.text}`);
  }
  const created = await ok(
    'POST',
    `/api/v1/apps/nexus.operations/runs/${run.id}/workspaces`,
    { schemaVersion: 1, workspace: { recipeId: recipe.id }, retained: false, catalogRevision: catalog.revision },
    { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
    202,
  );
  let current = created;
  const deadline = Date.now() + 45_000;
  while (current.status === 'creating') {
    if (Date.now() >= deadline) throw new Error(`${title} Workspace did not provision: ${JSON.stringify(current)}`);
    await wait(500);
    current = await ok('GET', `/api/v1/apps/nexus.operations/workspaces/${created.id}`);
  }
  if (current.status !== 'ready') throw new Error(`${title} Workspace is not ready: ${JSON.stringify(current)}`);
  return current;
};

let queueRun = await createRun('Docker pending-input smoke');
const appendQueueInput = async (text) => {
  const appended = await ok(
    'POST',
    `/api/v1/apps/nexus.operations/runs/${queueRun.id}/inputs`,
    { schemaVersion: 1, text, artifactRefs: [], expectedVersion: queueRun.version },
    { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
    202,
  );
  queueRun = await ok('GET', `/api/v1/apps/nexus.operations/runs/${queueRun.id}`);
  if (queueRun.version !== appended.runVersion) {
    throw new Error(`Pending-input append projection did not advance atomically: ${JSON.stringify({ appended, queueRun })}`);
  }
};
await appendQueueInput('pending input two');
await appendQueueInput('pending input three');
let pendingQueue = await ok('GET', `/api/v1/apps/nexus.operations/runs/${queueRun.id}/pending-inputs`);
if (pendingQueue.total !== 3 || pendingQueue.items.map((item) => item.text).join('|') !== 'deployment lifecycle smoke|pending input two|pending input three') {
  throw new Error(`Unexpected initial pending-input queue: ${JSON.stringify(pendingQueue)}`);
}
const originalQueue = [...pendingQueue.items];
const staleQueueVersion = queueRun.version;
queueRun = await ok(
  'PATCH',
  `/api/v1/apps/nexus.operations/runs/${queueRun.id}/pending-inputs`,
  {
    schemaVersion: 1,
    action: 'move',
    inputId: originalQueue[2].id,
    beforeInputId: originalQueue[0].id,
    expectedVersion: queueRun.version,
  },
  { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
);
pendingQueue = await ok('GET', `/api/v1/apps/nexus.operations/runs/${queueRun.id}/pending-inputs`);
if (pendingQueue.items.map((item) => item.id).join('|') !== [originalQueue[2].id, originalQueue[0].id, originalQueue[1].id].join('|')) {
  throw new Error(`Pending-input move was not durable: ${JSON.stringify(pendingQueue)}`);
}
const originalSequences = new Map(originalQueue.map((item) => [item.id, item.sequence]));
if (pendingQueue.items.some((item) => originalSequences.get(item.id) !== item.sequence)) {
  throw new Error(`Pending-input move rewrote immutable Ledger sequences: ${JSON.stringify(pendingQueue)}`);
}
const staleMutation = await call(
  'PATCH',
  `/api/v1/apps/nexus.operations/runs/${queueRun.id}/pending-inputs`,
  {
    schemaVersion: 1,
    action: 'remove',
    inputId: originalQueue[1].id,
    beforeInputId: null,
    expectedVersion: staleQueueVersion,
  },
  { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
);
if (staleMutation.response.status !== 409 || staleMutation.json?.error?.code !== 'STATE_CONFLICT') {
  throw new Error(`Pending-input mutation did not enforce Run version CAS: ${staleMutation.response.status} ${staleMutation.text}`);
}
queueRun = await ok(
  'PATCH',
  `/api/v1/apps/nexus.operations/runs/${queueRun.id}/pending-inputs`,
  {
    schemaVersion: 1,
    action: 'remove',
    inputId: originalQueue[1].id,
    beforeInputId: null,
    expectedVersion: queueRun.version,
  },
  { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
);
pendingQueue = await ok('GET', `/api/v1/apps/nexus.operations/runs/${queueRun.id}/pending-inputs`);
if (pendingQueue.total !== 2 || pendingQueue.items.some((item) => item.id === originalQueue[1].id)) {
  throw new Error(`Pending-input remove was not durable: ${JSON.stringify(pendingQueue)}`);
}
const queueLedger = await ok(
  'GET',
  `/api/v1/apps/nexus.operations/threads/${queueRun.threadId}/entries?limit=50`,
);
const removedLedgerEntry = queueLedger.items.find((entry) => entry.id === originalQueue[1].id);
if (!removedLedgerEntry || removedLedgerEntry.sequence !== originalQueue[1].sequence) {
  throw new Error(`Pending-input remove mutated append-only Ledger history: ${JSON.stringify(queueLedger)}`);
}
queueRun = await cancelToTerminal(queueRun);
console.log('agent pending-input HTTP: durable move/remove + version CAS ok');

let runA = await createRun('Docker lifecycle smoke A');
const workspaceA = await createReadyWorkspace(runA, 'A');
runA = await cancelToTerminal(runA);
const blockedDelete = await call(
  'DELETE',
  `/api/v1/apps/nexus.operations/runs/${runA.id}?expectedVersion=${runA.version}`,
  undefined,
  { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
);
if (blockedDelete.response.status !== 409 || blockedDelete.json?.error?.code !== 'RUN_DELETE_WORKSPACE_ATTACHED') {
  throw new Error(`Run deletion did not reject attached Workspace: ${blockedDelete.response.status} ${blockedDelete.text}`);
}

let runB = await createRun('Docker lifecycle smoke B');
const workspaceB = await createReadyWorkspace(runB, 'B');
runB = await cancelToTerminal(runB);
const settings = await ok('GET', '/api/v1/agent/settings');
const cleanupPreview = await ok(
  'POST',
  '/api/v1/agent/workspace-runtime/runtime-cleanup/preview',
  { expectedVersion: settings.revision },
  mutationHeaders,
);
if (!cleanupPreview.workspaceIds.includes(workspaceA.id) || !cleanupPreview.workspaceIds.includes(workspaceB.id)) {
  throw new Error(`Runtime cleanup preview omitted reclaimable Workspaces: ${JSON.stringify(cleanupPreview)}`);
}

// This Workspace becomes reclaimable only after preview and therefore must not be authorized
// by the existing confirmation even though Runner sees it by the time confirm executes.
let runC = await createRun('Docker lifecycle smoke C');
const workspaceC = await createReadyWorkspace(runC, 'C');
runC = await cancelToTerminal(runC);
if (cleanupPreview.workspaceIds.includes(workspaceC.id)) throw new Error('Cleanup preview unexpectedly included future Workspace.');

let cleanupCommand = await ok(
  'POST',
  '/api/v1/agent/workspace-runtime/runtime-cleanup/confirm',
  { confirmationId: cleanupPreview.confirmationId, expectedVersion: settings.revision },
  mutationHeaders,
  202,
);
const cleanupDeadline = Date.now() + 45_000;
while (['pending', 'running', 'unknown'].includes(cleanupCommand.status)) {
  if (Date.now() >= cleanupDeadline) throw new Error(`Runtime cleanup command did not settle: ${JSON.stringify(cleanupCommand)}`);
  await wait(500);
  cleanupCommand = await ok('GET', `/api/v1/agent/workspace-runtime/commands/${cleanupCommand.id}`);
}
if (cleanupCommand.status !== 'succeeded') throw new Error(`Runtime cleanup failed: ${JSON.stringify(cleanupCommand)}`);
if (!cleanupCommand.result?.deleted?.includes(workspaceA.id) || !cleanupCommand.result?.deleted?.includes(workspaceB.id)) {
  throw new Error(`Runtime cleanup did not delete previewed Workspaces: ${JSON.stringify(cleanupCommand)}`);
}
if (cleanupCommand.result.deleted.includes(workspaceC.id)) {
  throw new Error(`Runtime cleanup expanded beyond preview scope: ${JSON.stringify(cleanupCommand)}`);
}
const afterA = await ok('GET', `/api/v1/apps/nexus.operations/workspaces/${workspaceA.id}`);
const afterB = await ok('GET', `/api/v1/apps/nexus.operations/workspaces/${workspaceB.id}`);
const afterC = await ok('GET', `/api/v1/apps/nexus.operations/workspaces/${workspaceC.id}`);
if (afterA.status !== 'deleted' || afterB.status !== 'deleted' || afterC.status !== 'ready') {
  throw new Error(`Backend Workspace projection did not match Runner cleanup: ${JSON.stringify({ afterA, afterB, afterC })}`);
}
const refreshedRunA = await ok('GET', `/api/v1/apps/nexus.operations/runs/${runA.id}`);
await ok(
  'DELETE',
  `/api/v1/apps/nexus.operations/runs/${runA.id}?expectedVersion=${refreshedRunA.version}`,
  undefined,
  { ...mutationHeaders, 'Idempotency-Key': randomUUID() },
  202,
);

console.log('agent lifecycle HTTP: Run delete guard + scoped runtime cleanup + Backend projection sync ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

COOKIE="$cookie" PORT="$http_port" node <<'NODE'
const net = require('node:net');
const crypto = require('node:crypto');
const port = Number(process.env.PORT);
const cookie = process.env.COOKIE;
const socket = net.createConnection({ host: '127.0.0.1', port });
let response = '';
const timer = setTimeout(() => {
  console.error('Timed out waiting for WebSocket upgrade response');
  socket.destroy();
  process.exitCode = 1;
}, 5000);

socket.on('connect', () => {
  const key = crypto.randomBytes(16).toString('base64');
  socket.write([
    'GET /ws/workspace HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    `Origin: http://127.0.0.1:${port}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    `Sec-WebSocket-Key: ${key}`,
    `Cookie: ${cookie}`,
    '',
    '',
  ].join('\r\n'));
});

socket.on('data', (chunk) => {
  response += chunk.toString('latin1');
  if (!response.includes('\r\n\r\n')) return;
  clearTimeout(timer);
  const statusLine = response.split('\r\n', 1)[0];
  if (!statusLine.includes('101 Switching Protocols')) {
    console.error(`Unexpected WebSocket response: ${statusLine}`);
    process.exitCode = 1;
  } else {
    console.log('authenticated WebSocket upgrade: 101 Switching Protocols');
  }
  socket.end();
});

socket.on('error', (error) => {
  clearTimeout(timer);
  console.error(error);
  process.exitCode = 1;
});
NODE

failed=0
echo "Docker Compose deployment smoke passed for $image"
