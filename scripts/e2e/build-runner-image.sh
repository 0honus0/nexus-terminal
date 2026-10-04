#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${E2E_RUNNER_REPOSITORY:-ghcr.io/0honus0/nexus-terminal-e2e-runner}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      image="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

node_version="$(node "$repo_root/scripts/e2e/runner-image-info.mjs" node)"
playwright_version="$(node "$repo_root/scripts/e2e/runner-image-info.mjs" playwright)"
pnpm_version="$(node "$repo_root/scripts/e2e/runner-image-info.mjs" pnpm)"
fingerprint="$(node "$repo_root/scripts/e2e/runner-image-info.mjs" fingerprint)"
full_image="$image:latest"

echo "[E2E runner] building $full_image"
docker build \
  --pull \
  --no-cache \
  --build-arg "NODE_VERSION=$node_version" \
  --build-arg "PLAYWRIGHT_VERSION=$playwright_version" \
  --build-arg "PNPM_VERSION=$pnpm_version" \
  --build-arg "E2E_RUNNER_FINGERPRINT=$fingerprint" \
  -f "$repo_root/tests/e2e/Dockerfile.runner" \
  -t "$full_image" \
  "$repo_root"

echo "[E2E runner] verifying $full_image"
verification_workspace="$(mktemp -d)"
cleanup_verification_workspace() {
  docker run --rm \
    --volume "$verification_workspace:/verification-workspace" \
    "$full_image" sh -c 'find /verification-workspace -mindepth 1 -delete' >/dev/null 2>&1 || true
  rm -rf "$verification_workspace"
}
trap cleanup_verification_workspace EXIT
git -C "$repo_root" archive HEAD | tar -x -C "$verification_workspace"
docker run --rm \
  --workdir /__w/nexus-terminal/nexus-terminal \
  --volume "$verification_workspace:/__w/nexus-terminal/nexus-terminal" \
  "$full_image" sh -lc \
  "node --version && pnpm --version | grep -Fx '$pnpm_version' && ! command -v python3 && ! command -v make && ! command -v g++ && command -v ssh && command -v scp && command -v rsync && command -v sshpass && test -d \"\$PLAYWRIGHT_BROWSERS_PATH\" && test \"\$(pnpm store path)\" = /opt/pnpm/store/v11 && test \"\$(pnpm config get side-effects-cache)\" = true && install_log=\$(mktemp) && { pnpm install --frozen-lockfile --offline >\"\$install_log\" 2>&1 || { cat \"\$install_log\"; exit 1; }; } && cat \"\$install_log\" && ! grep -F 'node_modules/ssh2 install$' \"\$install_log\" && pnpm --filter @nexus-terminal/e2e exec playwright --version | grep -F 'Version $playwright_version'"
cleanup_verification_workspace
trap - EXIT

echo "[E2E runner] pushing $full_image"
docker push "$full_image"
