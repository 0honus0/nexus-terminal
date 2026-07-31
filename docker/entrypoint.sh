#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
    set -- "${NEXUS_ROLE:-frontend}"
fi

role="$1"
shift

case "$role" in
    frontend)
        exec nginx -g 'daemon off;' "$@"
        ;;
    backend)
        cd /app
        exec node dist/index.js "$@"
        ;;
    remote-gateway)
        cd /app/remote-gateway
        exec node dist/server.js "$@"
        ;;
    *)
        exec "$role" "$@"
        ;;
esac
