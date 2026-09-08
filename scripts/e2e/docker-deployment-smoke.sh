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
session_secret='docker-smoke-session-secret-2026-00000000000000000000000000000000'
encryption_key='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
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
}

cleanup() {
  status=$?
  if [[ "$failed" -ne 0 || "$status" -ne 0 ]]; then
    print_logs
  fi
  compose exec -T backend sh -lc 'chmod -R a+rwx /app/data' >/dev/null 2>&1 || true
  compose down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1 || true
  rm -rf "$workspace" "$cookie_jar" || true
  exit "$status"
}
trap cleanup EXIT

cp "$repo_root/docker-compose.yml" "$compose_file"
cp "$repo_root/.env" "$env_file"
cat > "$compose_override" <<EOF
services:
  frontend:
    container_name: nexus-e2e-frontend-$suffix
  backend:
    container_name: nexus-e2e-backend-$suffix
  guacd:
    container_name: nexus-e2e-guacd-$suffix
networks:
  nexus-terminal-network:
    name: nexus-e2e-network-$suffix
EOF
mkdir -p "$data_dir"
cp "$repo_root/test/e2e/fixtures/seeded-data/nexus-terminal.db" "$data_dir/nexus-terminal.db"
cat > "$data_dir/.env" <<EOF
SESSION_SECRET=$session_secret
ENCRYPTION_KEY=$encryption_key
EOF
chmod 0777 "$data_dir"
chmod 0600 "$data_dir/.env"

# Keep the repository Compose/.env contract intact while overriding only values that
# must be isolated for this smoke run: image, host port, Docker network, and WebAuthn origin.
set_env NEXUS_IMAGE_REPOSITORY "$image_repository"
set_env NEXUS_IMAGE_TAG "$image_tag"
set_env NEXUS_HTTP_PORT "$http_port"
set_env NEXUS_IPV6_SUBNET "fd01:ee:${network_hex}::/80"
set_env NEXUS_IPV6_GATEWAY "fd01:ee:${network_hex}::1"
set_env RP_ID 'ssh.honus.top'
set_env RP_ORIGIN 'https://ssh.honus.top,https://ssh.trui.de'

compose config >/dev/null
# Production Compose intentionally depends on guacd being started, not on the image's
# slow built-in health cadence. Start with the same semantics, then verify readiness
# through the application ingress and an explicit Backend-to-guacd TCP probe.
compose up -d
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

compose exec -T backend sh -lc 'nc -z guacd 4822'

curl -fsS "http://127.0.0.1:${http_port}/" | grep -qi '<html'
curl -fsS "http://127.0.0.1:${http_port}/api/v1/status" | grep -q '"status"'
curl -fsS -H "Host: ssh.honus.top" "http://127.0.0.1:${http_port}/.well-known/webauthn" >/dev/null

NEXUS_PRODUCTION_BASE_URL="http://127.0.0.1:${http_port}" npm --prefix "$repo_root/test/e2e" run test:ingress

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
