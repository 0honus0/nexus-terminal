#!/usr/bin/env bash
set -euo pipefail

report="$1"
shift
mkdir -p "$(dirname "$report")"
# GNU time includes reaped descendants' CPU. max_rss_kib is the largest
# individual process RSS, not the sum of concurrent processes' peaks.
status=0
"${NEXUS_TEST_TIME_COMMAND:-/usr/bin/time}" -q \
  -f '{"wall_seconds":%e,"user_seconds":%U,"system_seconds":%S,"max_process_rss_kib":%M}' \
  -o "$report" -- "$@" || status=$?
# time's %x reports zero for signal termination. Preserve the actual shell status.
node --input-type=module - "$report" "$status" <<'JS'
import fs from 'node:fs';
const [report, status] = process.argv.slice(2);
const metrics = JSON.parse(fs.readFileSync(report, 'utf8'));
metrics.exit_code = Number(status);
fs.writeFileSync(report, JSON.stringify(metrics, null, 2) + '\n');
JS
exit "$status"
