#!/usr/bin/env bash
set -euo pipefail

PORT=9999 node --import tsx src/app/node/main.ts &
backend=$!
nginx -c /etc/nexus-nginx.conf -g 'daemon off;' &
frontend=$!

stop() {
	kill -TERM "$backend" "$frontend" 2>/dev/null || true
	wait "$backend" "$frontend" 2>/dev/null || true
}

trap stop EXIT
trap 'exit 0' TERM INT

wait -n "$backend" "$frontend"
