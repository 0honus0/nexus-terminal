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
  --build-arg "NODE_VERSION=$node_version" \
  --build-arg "PLAYWRIGHT_VERSION=$playwright_version" \
  --build-arg "PNPM_VERSION=$pnpm_version" \
  --build-arg "E2E_RUNNER_FINGERPRINT=$fingerprint" \
  -f "$repo_root/tests/e2e/Dockerfile.runner" \
  -t "$full_image" \
  "$repo_root"

echo "[E2E runner] verifying $full_image"
docker run --rm "$full_image" sh -lc \
  "node --version && pnpm --version | grep -Fx '$pnpm_version' && test -d \"\$PLAYWRIGHT_BROWSERS_PATH\" && pnpm install --frozen-lockfile --offline && pnpm --filter @nexus-terminal/e2e exec playwright --version | grep -F 'Version $playwright_version'"

echo "[E2E runner] pushing $full_image"
docker push "$full_image"
