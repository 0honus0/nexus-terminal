#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
shard="$1"
shards="$2"
artifacts="${NEXUS_TEST_ARTIFACT_DIR:?An absolute artifact directory is required}"
mkdir -p "$artifacts/reports" "$artifacts/metrics"

measure() {
  NEXUS_TEST_LOG_DIR="$artifacts/logs" bash "$repo_root/scripts/e2e/measure-command.sh" "$artifacts/metrics/$1.json" "${@:2}"
}

if [[ "${3:-}" == native ]]; then
  cd "$repo_root/tests"
  mapfile -d '' native_files < <(find backend tooling -type f -name '*.native.test.mjs' \
    ! -path "$NEXUS_TEST_DOCKER_NATIVE" ! -path "$NEXUS_TEST_FINITE_FS_NATIVE" -print0 | sort -z)
  test "${#native_files[@]}" -ge "$shards"
  measure native node --test --test-concurrency=2 --test-shard="$shard/$shards" \
    --test-reporter=spec --test-reporter=junit \
    --test-reporter-destination=stdout \
    --test-reporter-destination="$artifacts/reports/native.xml" "${native_files[@]}"
  exit
fi

if [[ "${3:-}" != foreground ]]; then
  # Each lane owns a process group, including all framework/fixture descendants.
  # A failed lane does not cancel the other lane's assertions or cleanup.
  pids=()
  stop_lanes() {
    for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
    for pid in "${pids[@]}"; do wait "$pid" || true; done
  }
  trap 'stop_lanes; exit 130' INT
  trap 'stop_lanes; exit 143' TERM
  for lane in native foreground; do
    setsid bash "$0" "$shard" "$shards" "$lane" > >(tee "$artifacts/$lane.log") 2>&1 &
    pids+=("$!")
  done
  failed=0
  for index in "${!pids[@]}"; do
    wait "${pids[index]}" || failed=1
    unset 'pids[index]'
  done
  trap - INT TERM
  exit "$failed"
fi

# Node's process-isolated files own random ports and independent writable data.
# Overlap independent protocol work; browser suites retain sequential fixed-port use.

failed=0
cd "$repo_root/tests"
measure modules pnpm run test:modules --shard "$shard/$shards" || failed=1

if [[ "$shard" == 1 ]]; then
  measure filesystem node --test --test-reporter=spec --test-reporter=junit \
    --test-reporter-destination=stdout \
    --test-reporter-destination="$artifacts/reports/native-filesystem.xml" \
    "$NEXUS_TEST_FINITE_FS_NATIVE" || failed=1
  if measure docker-prepare bash -c 'docker version && docker pull alpine:latest'; then
    measure docker-native node --test --test-reporter=spec --test-reporter=junit \
      --test-reporter-destination=stdout \
      --test-reporter-destination="$artifacts/reports/docker-native.xml" "$NEXUS_TEST_DOCKER_NATIVE" || failed=1
    NEXUS_TEST_ARTIFACT_DIR="$artifacts/docker-module" measure docker-module pnpm run test:docker || failed=1
  else
    failed=1
  fi
fi

cd "$repo_root"
measure host-browser node scripts/e2e/balanced-shards.mjs run --shards "$shards" --shard "$shard" || failed=1


exit "$failed"
