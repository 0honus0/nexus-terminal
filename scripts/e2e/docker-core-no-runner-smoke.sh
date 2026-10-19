#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <unified-image>" >&2
  exit 2
fi
image="$1"
[[ "$image" == *:* ]] || { echo "Image must include a tag: $image" >&2; exit 2; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
suffix="${suffix//[^A-Za-z0-9_.-]/-}"
project="nexus-core-no-runner-${suffix,,}"
work="$(mktemp -d)"
compose_file="$work/docker-compose.yml"
override="$work/docker-compose.override.yml"
env_file="$work/.env"
data_dir="$work/data"
printf -v hex '%04x' "$(( $$ & 65535 ))"
failed=1

repo="${image%:*}"; tag="${image##*:}"
compose() { docker compose --project-name "$project" --project-directory "$work" --env-file "$env_file" -f "$compose_file" -f "$override" "$@"; }
set_env() { local k="$1" v="$2" t="$env_file.tmp"; grep -v "^${k}=" "$env_file" >"$t" || true; printf '%s=%s\n' "$k" "$v" >>"$t"; mv "$t" "$env_file"; }
cleanup() {
  local status=$?
  if [[ "$failed" -ne 0 || "$status" -ne 0 ]]; then compose ps -a >&2 || true; compose logs --no-color >&2 || true; fi
  compose down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1 || true
  rm -rf "$work" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

cp "$repo_root/docker-compose.yml" "$compose_file"
cp "$repo_root/.env.example" "$env_file"
cat >"$override" <<EOF_OVERRIDE
services:
  frontend:
    container_name: nexus-core-no-runner-frontend-$suffix
  backend:
    container_name: nexus-core-no-runner-backend-$suffix
  guacd:
    container_name: nexus-core-no-runner-guacd-$suffix
networks:
  nexus-terminal-network:
    name: nexus-core-no-runner-network-$suffix
EOF_OVERRIDE
mkdir -p "$data_dir"
chmod 0700 "$data_dir"
# Ephemeral test key, injected through the same required setting as deployment.
set_env NEXUS_ENCRYPTION_KEY "$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"
set_env NEXUS_IMAGE_REPOSITORY "$repo"
set_env NEXUS_IMAGE_TAG "$tag"
set_env NEXUS_HTTP_PORT 0
set_env NEXUS_PUBLIC_ORIGIN http://127.0.0.1
set_env NEXUS_IPV6_SUBNET "fd01:ed:${hex}::/80"
set_env NEXUS_IPV6_GATEWAY "fd01:ed:${hex}::1"
grep -v '^COMPOSE_PROFILES=' "$env_file" >"$env_file.tmp" || true; mv "$env_file.tmp" "$env_file"

services="$(compose config --services)"
printf '%s\n' "$services" | grep -qx frontend
printf '%s\n' "$services" | grep -qx backend
printf '%s\n' "$services" | grep -qx guacd
if printf '%s\n' "$services" | grep -qx agent-runner; then echo 'Default Compose unexpectedly includes agent-runner.' >&2; exit 1; fi
compose up -d
for _ in {1..60}; do
  b="$(compose ps --format json backend 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)"
  f="$(compose ps --format json frontend 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)"
  [[ "$b" == *healthy* && "$f" == *healthy* ]] && break
  sleep 1
done
compose exec -T backend node --input-type=module - <<'NODE'
import { existsSync } from 'node:fs';
import { readSystemHealthResponse } from '@nexus-terminal/shared/system/status/http-codec';
const retired = [
  '/app/dist/infrastructure/agent/workspace-runtime/runner-http.adapter.js',
  '/app/dist/modules/agent/workspace-runtime/workspace-runtime.service.js',
];
for (const modulePath of retired) {
  if (existsSync(modulePath)) throw new Error(`Retired Agent Workspace module still shipped: ${modulePath}`);
}
const origin = new URL(process.env.NEXUS_PUBLIC_ORIGIN);
const status = await fetch('http://127.0.0.1:3001/api/v1/status', {
  headers: { 'X-Forwarded-Host': origin.host, 'X-Forwarded-Proto': origin.protocol.slice(0, -1) },
});
if (!status.ok) throw new Error(`Backend health returned ${status.status}`);
readSystemHealthResponse(await status.json());
console.log('Production Backend starts without a Runner or Agent Workspace execution modules.');
NODE
failed=0
echo 'Docker core no-Runner smoke passed.'
