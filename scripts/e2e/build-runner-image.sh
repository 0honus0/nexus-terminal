#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
versions_file="$repo_root/scripts/e2e/versions.json"
image="ghcr.io/0honus0/nexus-terminal-e2e-runner"
push=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      push=true
      shift
      ;;
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

node_version="$(node -p "require('$versions_file').node")"
playwright_version="$(node -p "require('$versions_file').playwright")"
runner_revision="$(node -p "require('$versions_file').runnerRevision")"
tag="playwright-${playwright_version}-node${node_version}-v${runner_revision}"
full_image="$image:$tag"

echo "[E2E runner] building $full_image"
docker build \
  --pull \
  --build-arg "PLAYWRIGHT_VERSION=$playwright_version" \
  -f "$repo_root/test/e2e/Dockerfile.runner" \
  -t "$full_image" \
  "$repo_root"

echo "[E2E runner] smoke-checking $full_image"
docker run --rm "$full_image" node --version
docker run --rm "$full_image" sh -lc "npx -y playwright@${playwright_version} --version && test -d \"\$PLAYWRIGHT_BROWSERS_PATH\" && command -v zip && command -v unzip && command -v bzip2"

if [[ "$push" == "true" ]]; then
  echo "[E2E runner] pushing $full_image"
  docker push "$full_image"
fi

echo "$full_image"
