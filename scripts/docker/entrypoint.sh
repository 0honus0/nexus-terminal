#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
    set -- "${NEXUS_ROLE:-frontend}"
fi

role="$1"
shift

case "$role" in
    frontend)
        origin="${NEXUS_PUBLIC_ORIGIN:-}"
        if ! printf '%s\n' "$origin" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
            echo "NEXUS_PUBLIC_ORIGIN must be an exact http(s) origin without a path." >&2
            exit 1
        fi
        sed "s|__NEXUS_PUBLIC_ORIGIN__|$origin|g" \
            /etc/nginx/templates/plugin-frontend.conf.template \
            > /etc/nginx/http.d/plugin-frontend.conf
        exec nginx -g 'daemon off;' "$@"
        ;;
    backend)
        cd /app
        exec node dist/index.js "$@"
        ;;
    *)
        exec "$role" "$@"
        ;;
esac
