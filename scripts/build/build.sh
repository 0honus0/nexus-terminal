#!/usr/bin/env bash

set -Eeuo pipefail

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly IMAGE_REPOSITORY="${NEXUS_IMAGE_REPOSITORY:-${NEXUS_IMAGE_PREFIX:-ghcr.io/0honus0/nexus-terminal}}"
readonly IMAGE_TAG="${NEXUS_IMAGE_TAG:-latest}"
readonly IMAGE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"

usage() {
    cat <<'USAGE'
Usage:
  scripts/build/build.sh local [backend|frontend]
  scripts/build/build.sh docker
  scripts/build/build.sh docker-save [output-directory]

Commands:
  local        Run npm ci and npm run build in the selected package directories.
  docker       Build the single unified runtime image.
  docker-save  Build and export the unified runtime image as one tar archive.

Environment variables:
  NEXUS_IMAGE_REPOSITORY  Image repository (default: ghcr.io/0honus0/nexus-terminal)
  NEXUS_IMAGE_TAG         Image tag (default: latest)
  VITE_API_BASE_URL        Optional frontend API base URL embedded at build time

Examples:
  scripts/build/build.sh local backend
  scripts/build/build.sh local frontend
  scripts/build/build.sh docker
  NEXUS_IMAGE_TAG=dev scripts/build/build.sh docker
  scripts/build/build.sh docker-save ./dist-scripts/docker-images
USAGE
}

require_command() {
    local command_name="$1"
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Required command not found: $command_name" >&2
        exit 1
    fi
}

build_local() {
    local component="$1"
    local package_dir="$ROOT_DIR/packages/$component"

    echo "==> Building $component locally"
    (
        cd "$package_dir"
        npm ci
        npm run build
    )
}


build_docker() {
    local -a build_args=()

    if [[ -n "${VITE_API_BASE_URL:-}" ]]; then
        build_args+=(--build-arg "VITE_API_BASE_URL=$VITE_API_BASE_URL")
    fi

    echo "==> Building unified Docker image $IMAGE"
    docker build \
        "${build_args[@]}" \
        --file "$ROOT_DIR/Dockerfile" \
        --tag "$IMAGE" \
        "$ROOT_DIR"
}

save_docker() {
    local output_dir="$1"
    local archive_name

    archive_name="${IMAGE//\//_}"
    archive_name="${archive_name//:/-}.tar"

    mkdir -p "$output_dir"
    echo "==> Saving Docker image $IMAGE to $output_dir/$archive_name"
    docker save --output "$output_dir/$archive_name" "$IMAGE"
}

main() {
    local mode="${1:-}"
    local target="${2:-}"
    local output_dir
    local component

    if [[ "$mode" == "-h" || "$mode" == "--help" ]]; then
        usage
        return
    fi

    if [[ -z "$mode" ]]; then
        usage >&2
        exit 2
    fi

    case "$mode" in
        local)
            require_command npm
            require_command node
            target="${target:-backend}"
            case "$target" in
                backend|frontend)
                    build_local "$target"
                    ;;
                *)
                    echo "Unknown local build target: $target" >&2
                    usage >&2
                    exit 2
                    ;;
            esac
            ;;
        docker)
            require_command docker
            if [[ -n "$target" ]]; then
                echo "Docker build does not accept a component target: $target" >&2
                exit 2
            fi
            build_docker
            ;;
        docker-save)
            require_command docker
            output_dir="${target:-$ROOT_DIR/dist-scripts/docker-images}"
            build_docker
            save_docker "$output_dir"
            ;;
        *)
            echo "Unknown build mode: $mode" >&2
            usage >&2
            exit 2
            ;;
    esac
}

main "$@"
