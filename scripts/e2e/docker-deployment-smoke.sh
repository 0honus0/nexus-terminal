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
project="nexus-deployment-smoke-${suffix,,}"
artifact_root="${NEXUS_TEST_ARTIFACT_DIR:-$repo_root/tests/.artifacts/docker-smoke}"
mkdir -p "$artifact_root"
artifact_root="$(cd "$artifact_root" && pwd)"
work="$(mktemp -d "$artifact_root/work.XXXXXX")"
diagnostics="$artifact_root/diagnostics"
mkdir -p "$diagnostics"
unset COMPOSE_PROFILES
compose_file="$work/docker-compose.yml"
override="$work/docker-compose.override.yml"
env_file="$work/.env"
data_dir="$work/data"
printf -v hex '%04x' "$(( $$ & 65535 ))"
failed=1

repo="${image%:*}"; tag="${image##*:}"
compose() { docker compose --project-name "$project" --project-directory "$work" --env-file "$env_file" -f "$compose_file" -f "$override" "$@"; }
set_env() {
  local k="$1" v="$2" t="$env_file.tmp" status=0
  grep -v "^${k}=" "$env_file" >"$t" || status=$?
  [[ "$status" -le 1 ]] || return "$status"
  printf '%s=%s\n' "$k" "$v" >>"$t"
  mv "$t" "$env_file"
  # Compose gives process variables precedence over --env-file.
  export "$k=$v"
}
capture_diagnostics() {
  compose ps -a >>"$diagnostics/containers.log" 2>&1 || echo "Unable to collect container state." >&2
  compose logs --no-color >>"$diagnostics/compose.log" 2>&1 || echo "Unable to collect Compose logs." >&2
}
cleanup() {
  local status=$? cleanup_status=0
  trap - EXIT
  if [[ "$failed" -ne 0 || "$status" -ne 0 ]]; then capture_diagnostics; fi
  compose down --volumes --remove-orphans --timeout 10 >"$diagnostics/cleanup.log" 2>&1 || cleanup_status=$?
  if [[ "$cleanup_status" -ne 0 ]]; then
    capture_diagnostics
    echo "Docker cleanup failed; retained workspace: $work" >&2
    cat "$diagnostics/cleanup.log" >&2
    [[ "$status" -ne 0 ]] || status="$cleanup_status"
  fi
  if [[ "$failed" -eq 0 && "$status" -eq 0 ]]; then
    rm -rf "$work" || status=$?
  else
    echo "Deployment smoke failed; retained workspace: $work" >&2
    # Full logs remain in the artifact; keep the Actions console concise.
    tail -n 80 "$diagnostics/compose.log" >&2
    [[ "$status" -ne 0 ]] || status=1
  fi
  printf 'test_completed=%s\nexit_status=%s\ncleanup_status=%s\nworkspace=%s\n' \
    "$((1 - failed))" "$status" "$cleanup_status" "$work" >"$diagnostics/result.txt"
  exit "$status"
}
trap cleanup EXIT

cp "$repo_root/docker-compose.yml" "$compose_file"
cp "$repo_root/.env.example" "$env_file"
cat >"$override" <<EOF_OVERRIDE
services:
  frontend:
    container_name: nexus-deployment-smoke-frontend-$suffix
  backend:
    container_name: nexus-deployment-smoke-backend-$suffix
networks:
  nexus-terminal-network:
    name: nexus-deployment-smoke-network-$suffix
EOF_OVERRIDE
mkdir -p "$data_dir"
chmod 0700 "$data_dir"
# Ephemeral test key, injected through the same required setting as deployment.
set_env NEXUS_ENCRYPTION_KEY "$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"
set_env NEXUS_DATA_DIR "$data_dir"
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
if printf '%s\n' "$services" | grep -qx guacd; then echo 'Default Compose unexpectedly includes guacd.' >&2; exit 1; fi
if printf '%s\n' "$services" | grep -qx agent-runner; then echo 'Default Compose unexpectedly includes agent-runner.' >&2; exit 1; fi
compose up -d --wait --wait-timeout 60
compose exec -T backend node --input-type=module - <<'NODE'
import { readSystemHealthResponse } from '@nexus-terminal/shared/system/status/http-codec';
const origin = new URL(process.env.NEXUS_PUBLIC_ORIGIN);
const status = await fetch('http://127.0.0.1:3001/api/v1/status', {
  headers: { 'X-Forwarded-Host': origin.host, 'X-Forwarded-Proto': origin.protocol.slice(0, -1) },
});
if (!status.ok) throw new Error(`Backend health returned ${status.status}`);
readSystemHealthResponse(await status.json());
console.log('Production Backend health contract passed.');
NODE
failed=0
echo 'Docker deployment smoke passed.'
