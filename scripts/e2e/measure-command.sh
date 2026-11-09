#!/usr/bin/env bash
set -euo pipefail

report="$1"
shift
mkdir -p "$(dirname "$report")"
# GNU time includes reaped descendants' CPU. max_rss_kib is the largest
# individual process RSS, not the sum of concurrent processes' peaks.
status=0
measured_command=(
  "${NEXUS_TEST_TIME_COMMAND:-/usr/bin/time}" -q
  -f '{"wall_seconds":%e,"user_seconds":%U,"system_seconds":%S,"max_process_rss_kib":%M}'
  -o "$report" -- "$@"
)
command_log=""
if [[ -n "${NEXUS_TEST_LOG_DIR:-}" ]]; then
  mkdir -p "$NEXUS_TEST_LOG_DIR"
  command_log="$NEXUS_TEST_LOG_DIR/$(basename "$report" .json).log"
  echo "[Tests] Starting $(basename "$report" .json); full output: $command_log"
  "${measured_command[@]}" >> "$command_log" 2>&1 || status=$?
else
  "${measured_command[@]}" || status=$?
fi
# time's %x reports zero for signal termination. Preserve the actual shell status.
node --input-type=module - "$report" "$status" "$command_log" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const [report, status, commandLog] = process.argv.slice(2);
const metrics = JSON.parse(fs.readFileSync(report, 'utf8'));
metrics.exit_code = Number(status);
fs.writeFileSync(report, JSON.stringify(metrics, null, 2) + '\n');
if (commandLog) {
  const result = metrics.exit_code === 0 ? 'passed' : `failed (exit ${metrics.exit_code})`;
  console.log(`[Tests] ${path.basename(report, '.json')}: ${result} in ${metrics.wall_seconds}s; full output: ${commandLog}`);
}
JS
exit "$status"
