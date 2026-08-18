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
network="nexus-e2e-smoke-${suffix}"
backend="nexus-e2e-backend-${suffix}"
frontend="nexus-e2e-frontend-${suffix}"
remote_gateway="nexus-e2e-remote-${suffix}"
http_port="${NEXUS_DOCKER_SMOKE_PORT:-18113}"
data_dir="$(mktemp -d)"
cookie_jar="$(mktemp)"
gateway_secret='docker-smoke-remote-gateway-secret-2026-0000000000000000'
session_secret='docker-smoke-session-secret-2026-00000000000000000000000000000000'
encryption_key='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
failed=1

print_logs() {
  echo "--- backend logs ---"
  docker logs "$backend" 2>&1 || true
  echo "--- remote gateway logs ---"
  docker logs "$remote_gateway" 2>&1 || true
  echo "--- frontend logs ---"
  docker logs "$frontend" 2>&1 || true
}

cleanup() {
  status=$?
  if [[ "$failed" -ne 0 || "$status" -ne 0 ]]; then
    print_logs
  fi
  docker rm -f "$frontend" "$backend" "$remote_gateway" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$data_dir" "$cookie_jar"
  exit "$status"
}
trap cleanup EXIT

cp "$repo_root/test/e2e/fixtures/seeded-data/nexus-terminal.db" "$data_dir/nexus-terminal.db"
chmod 0777 "$data_dir"

docker network create "$network" >/dev/null

docker run -d \
  --name "$remote_gateway" \
  --network "$network" \
  --network-alias remote-gateway \
  -e NODE_ENV=production \
  -e REMOTE_GATEWAY_SHARED_SECRET="$gateway_secret" \
  -e REMOTE_GATEWAY_API_HOST=0.0.0.0 \
  -e REMOTE_GATEWAY_API_PORT=9090 \
  -e REMOTE_GATEWAY_WS_PORT=8080 \
  -e GUACD_HOST=127.0.0.1 \
  -e GUACD_PORT=4822 \
  "$image" remote-gateway >/dev/null

remote_ready=0
for _ in {1..30}; do
  if docker exec "$remote_gateway" sh -lc 'nc -z 127.0.0.1 9090 && nc -z 127.0.0.1 8080'; then
    remote_ready=1
    break
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$remote_gateway" 2>/dev/null || true)" != "true" ]]; then
    echo "Remote gateway container exited before becoming ready." >&2
    exit 1
  fi
  sleep 1
done
[[ "$remote_ready" -eq 1 ]] || { echo "Remote gateway did not become ready." >&2; exit 1; }

docker run -d \
  --name "$backend" \
  --network "$network" \
  --network-alias backend \
  -v "$data_dir:/app/data" \
  -e NODE_ENV=production \
  -e PORT=3001 \
  -e NEXUS_DATA_DIR=/app/data \
  -e DEPLOYMENT_MODE=docker \
  -e SESSION_SECRET="$session_secret" \
  -e ENCRYPTION_KEY="$encryption_key" \
  -e REMOTE_GATEWAY_SHARED_SECRET="$gateway_secret" \
  -e REMOTE_GATEWAY_API_BASE_DOCKER=http://remote-gateway:9090 \
  -e REMOTE_GATEWAY_WS_URL_DOCKER=ws://remote-gateway:8080 \
  -e RP_ID=127.0.0.1 \
  -e RP_ORIGIN="http://127.0.0.1:${http_port}" \
  "$image" backend >/dev/null

backend_ready=0
for _ in {1..45}; do
  if docker exec "$backend" sh -lc 'wget -q -O /dev/null http://127.0.0.1:3001/api/v1/status'; then
    backend_ready=1
    break
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$backend" 2>/dev/null || true)" != "true" ]]; then
    echo "Backend container exited before becoming ready." >&2
    exit 1
  fi
  sleep 1
done
[[ "$backend_ready" -eq 1 ]] || { echo "Backend did not become ready." >&2; exit 1; }

docker exec "$backend" node -e "fetch('http://remote-gateway:9090/api/remote-desktop/token',{method:'POST',headers:{'content-type':'application/json','x-nexus-gateway-secret':process.env.REMOTE_GATEWAY_SHARED_SECRET},body:'{}'}).then(r=>{if(r.status!==400)throw new Error('unexpected remote gateway status '+r.status); console.log('remote gateway API reachable: '+r.status)})"

docker run -d \
  --name "$frontend" \
  --network "$network" \
  --network-alias frontend \
  -p "127.0.0.1:${http_port}:80" \
  "$image" frontend >/dev/null

frontend_ready=0
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:${http_port}/" >/dev/null; then
    frontend_ready=1
    break
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$frontend" 2>/dev/null || true)" != "true" ]]; then
    echo "Frontend container exited before becoming ready." >&2
    exit 1
  fi
  sleep 1
done
[[ "$frontend_ready" -eq 1 ]] || { echo "Frontend did not become ready." >&2; exit 1; }

curl -fsS "http://127.0.0.1:${http_port}/" | grep -qi '<html'
curl -fsS "http://127.0.0.1:${http_port}/api/v1/status" | grep -q '"status"'
curl -fsS -H "Host: 127.0.0.1:${http_port}" "http://127.0.0.1:${http_port}/.well-known/webauthn" >/dev/null

login_body='{"username":"e2e-admin","password":"E2e-Admin-Password-2026!","rememberMe":false}'
curl -fsS \
  -c "$cookie_jar" \
  -H 'Content-Type: application/json' \
  --data "$login_body" \
  "http://127.0.0.1:${http_port}/api/v1/auth/login" >/dev/null

cookie="$(awk 'BEGIN { first=1 } (!/^#/ || /^#HttpOnly_/) && NF >= 7 { if (!first) printf "; "; printf "%s=%s", $6, $7; first=0 }' "$cookie_jar")"
[[ -n "$cookie" ]] || { echo "Login succeeded without producing a session cookie." >&2; exit 1; }

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
    'GET /ws/ HTTP/1.1',
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
echo "Docker deployment smoke passed for $image"
