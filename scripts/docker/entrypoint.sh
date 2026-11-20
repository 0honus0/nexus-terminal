#!/usr/bin/env bash
set -euo pipefail

if (( EUID == 0 )); then
	data_directory=${DATA_DIRECTORY:-/app/data}
	mkdir -p -- "$data_directory"
	chown -h node:node -- "$data_directory"
	exec gosu node "$0" "$@"
fi

PORT=9999 HTTP_TRUST_LOOPBACK_PROXY=1 node --import tsx src/app/node/main.ts &
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
