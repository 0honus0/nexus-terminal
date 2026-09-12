#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo 'prepare-ubuntu-host.sh requires an Ubuntu/Debian host with apt-get.' >&2
  exit 2
fi

if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  SUDO=()
  runner_owner=${NEXUS_AGENT_RUNNER_USER:-root}
elif command -v sudo >/dev/null 2>&1; then
  SUDO=(sudo)
  runner_owner=${NEXUS_AGENT_RUNNER_USER:-$(id -un)}
else
  echo 'Root privileges or sudo are required to install the host Runner prerequisites.' >&2
  exit 2
fi

"${SUDO[@]}" apt-get update
"${SUDO[@]}" apt-get install -y \
  bsdutils bzip2 ca-certificates curl gzip tar unzip xz-utils zstd

MISE_VERSION=2026.9.5
case "$(uname -m)" in
  x86_64|amd64)
    mise_arch=x64
    mise_sha256=d71e94e1ed59d4d0ca4ac847fa321d6d6615a8e613e9b468c9fb39f0dddd06d5
    ;;
  aarch64|arm64)
    mise_arch=arm64
    mise_sha256=3a52c7c7c58d21a0791516950ebf4bc915f403277b49c93d657fc585259625ec
    ;;
  *)
    echo "Unsupported architecture for pinned mise installer: $(uname -m)" >&2
    exit 6
    ;;
esac
mise_root="/usr/local/lib/nexus-agent-runner/mise/$MISE_VERSION"
mise_bin="$mise_root/bin/mise"
if [[ ! -x "$mise_bin" ]] || [[ $("$mise_bin" --version 2>/dev/null | awk '{print $1}') != "$MISE_VERSION" ]]; then
  mise_tmp=$(mktemp -d)
  trap 'rm -rf "$mise_tmp"' EXIT
  mise_archive="$mise_tmp/mise.tar.gz"
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://github.com/jdx/mise/releases/download/v$MISE_VERSION/mise-v$MISE_VERSION-linux-$mise_arch.tar.gz" \
    --output "$mise_archive"
  printf '%s  %s\n' "$mise_sha256" "$mise_archive" | sha256sum -c -
  mkdir -p "$mise_tmp/extract"
  tar -xzf "$mise_archive" -C "$mise_tmp/extract"
  extracted_mise="$mise_tmp/extract/mise/bin/mise"
  [[ -f "$extracted_mise" ]] || { echo 'Pinned mise archive did not contain mise/bin/mise.' >&2; exit 7; }
  "${SUDO[@]}" install -d -m 0755 "$mise_root/bin"
  "${SUDO[@]}" install -o root -g root -m 0755 "$extracted_mise" "$mise_bin"
  rm -rf "$mise_tmp"
  trap - EXIT
fi
[[ $("$mise_bin" --version 2>/dev/null | awk '{print $1}') == "$MISE_VERSION" ]] || {
  echo 'Pinned mise version verification failed.' >&2
  exit 8
}
mise_stable_bin=/usr/local/bin/mise
"${SUDO[@]}" install -o root -g root -m 0755 "$mise_bin" "$mise_stable_bin"

# Tool Pack 会以 canonical path 暴露给多个 Workspace；目录归 Runner 服务用户所有。
"${SUDO[@]}" install -d -m 0755 -o "$runner_owner" /opt/nexus /opt/nexus/packs
command -v script >/dev/null 2>&1 || { echo 'script(1) is required for Workspace Terminal PTY sessions.' >&2; exit 13; }
command -v stty >/dev/null 2>&1 || { echo 'stty is required for Workspace Terminal resize support.' >&2; exit 13; }

echo "Nexus Agent Runner prerequisites are ready (mise $MISE_VERSION + script/stty; native Workspace runtime)."
