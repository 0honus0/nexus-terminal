#!/usr/bin/env bash

set -Eeuo pipefail

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly IMAGE_PREFIX="${NEXUS_IMAGE_PREFIX:-nexus-terminal}"
readonly IMAGE_TAG="${NEXUS_IMAGE_TAG:-latest}"

usage() {
    cat <<'EOF'
Usage:
  ./build.sh local [all|backend|frontend|remote-gateway]
  ./build.sh docker [all|backend|frontend|remote-gateway]
  ./build.sh docker-save [all|backend|frontend|remote-gateway] [output-directory]

Commands:
  local        Run npm ci and npm run build in the selected package directories.
  docker       Build the selected Docker images.
  docker-save  Build and export the selected Docker images as tar archives.

Environment variables:
  NEXUS_IMAGE_PREFIX  Docker image prefix (default: nexus-terminal)
  NEXUS_IMAGE_TAG     Docker image tag (default: latest)

Examples:
  ./build.sh local
  ./build.sh local frontend
  ./build.sh docker backend
  NEXUS_IMAGE_TAG=dev ./build.sh docker all
  ./build.sh docker-save all ./dist-scripts/docker-images
EOF
}

require_command() {
    local command_name="$1"
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Required command not found: $command_name" >&2
        exit 1
    fi
}

select_components() {
    case "$1" in
        all)
            COMPONENTS=(backend frontend remote-gateway)
            ;;
        backend|frontend|remote-gateway)
            COMPONENTS=("$1")
            ;;
        *)
            echo "Unknown build target: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
}

image_name() {
    local component="$1"
    printf '%s-%s:%s' "$IMAGE_PREFIX" "$component" "$IMAGE_TAG"
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
    local component="$1"
    local image
    image="$(image_name "$component")"

    echo "==> Building Docker image $image"
    docker build \
        --file "$ROOT_DIR/packages/$component/Dockerfile" \
        --tag "$image" \
        "$ROOT_DIR"
}

save_docker() {
    local component="$1"
    local output_dir="$2"
    local image archive_name

    image="$(image_name "$component")"
    archive_name="${image//\//_}"
    archive_name="${archive_name//:/-}.tar"

    mkdir -p "$output_dir"
    echo "==> Saving Docker image $image to $output_dir/$archive_name"
    docker save --output "$output_dir/$archive_name" "$image"
}

main() {
    local mode="${1:-}"
    local target="${2:-all}"
    local output_dir="${3:-$ROOT_DIR/dist-scripts/docker-images}"
    local component

    if [[ "$mode" == "-h" || "$mode" == "--help" ]]; then
        usage
        return
    fi

    if [[ -z "$mode" ]]; then
        usage >&2
        exit 2
    fi

    select_components "$target"

    case "$mode" in
        local)
            require_command npm
            for component in "${COMPONENTS[@]}"; do
                build_local "$component"
            done
            ;;
        docker)
            require_command docker
            for component in "${COMPONENTS[@]}"; do
                build_docker "$component"
            done
            ;;
        docker-save)
            require_command docker
            for component in "${COMPONENTS[@]}"; do
                build_docker "$component"
                save_docker "$component" "$output_dir"
            done
            ;;
        *)
            echo "Unknown build mode: $mode" >&2
            usage >&2
            exit 2
            ;;
    esac
}

main "$@"
