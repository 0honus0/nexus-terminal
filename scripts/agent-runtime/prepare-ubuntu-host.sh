#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo 'prepare-ubuntu-host.sh requires an Ubuntu/Debian host with apt-get.' >&2
  exit 2
fi

if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  SUDO=()
elif command -v sudo >/dev/null 2>&1; then
  SUDO=(sudo)
else
  echo 'Root privileges or sudo are required to install the host sandbox prerequisite.' >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

"${SUDO[@]}" apt-get update
"${SUDO[@]}" apt-get install -y \
  apparmor apparmor-utils ca-certificates curl gcc libcap-dev meson ninja-build pkg-config xz-utils

# Ubuntu 24.04 still ships bubblewrap 0.9.x. Versions before 0.12.0 are affected by
# GHSA-pxhw-h44j-8pfx, a setup-time symlink traversal that is directly relevant when
# constructing a sandbox around downloaded tool content. Build the patched upstream
# release into a Nexus-owned root-only path instead of replacing /usr/bin/bwrap.
BWRAP_VERSION=0.12.0
BWRAP_SHA256=9760d007363e3abba7c747489910f9f82d9fca53ba3bd3282e396fa3c97a3314
bwrap_root="/usr/local/lib/nexus-agent-runner/bubblewrap/$BWRAP_VERSION"
bwrap_release_bin="$bwrap_root/bin/bwrap"
bwrap_bin=/usr/local/bin/bwrap
if [[ ! -x "$bwrap_release_bin" ]] || [[ $("$bwrap_release_bin" --version 2>/dev/null) != "bubblewrap $BWRAP_VERSION" ]]; then
  bwrap_tmp=$(mktemp -d)
  trap 'rm -rf "$bwrap_tmp"' EXIT
  bwrap_archive="$bwrap_tmp/bubblewrap.tar.xz"
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://github.com/containers/bubblewrap/releases/download/v$BWRAP_VERSION/bubblewrap-$BWRAP_VERSION.tar.xz" \
    --output "$bwrap_archive"
  printf '%s  %s\n' "$BWRAP_SHA256" "$bwrap_archive" | sha256sum -c -
  tar -xJf "$bwrap_archive" -C "$bwrap_tmp"
  meson setup "$bwrap_tmp/build" "$bwrap_tmp/bubblewrap-$BWRAP_VERSION" \
    -Dselinux=disabled \
    -Dman=disabled \
    -Dtests=false \
    -Dbash_completion=disabled \
    -Dzsh_completion=disabled
  meson compile -C "$bwrap_tmp/build"
  [[ -f "$bwrap_tmp/build/bwrap" ]] || { echo 'Pinned bubblewrap build did not produce bwrap.' >&2; exit 9; }
  "${SUDO[@]}" install -d -m 0755 "$bwrap_root/bin"
  "${SUDO[@]}" install -o root -g root -m 0755 "$bwrap_tmp/build/bwrap" "$bwrap_release_bin"
  rm -rf "$bwrap_tmp"
  trap - EXIT
fi
if [[ $("$bwrap_release_bin" --version 2>/dev/null) != "bubblewrap $BWRAP_VERSION" ]]; then
  echo 'Pinned bubblewrap version verification failed.' >&2
  exit 10
fi
"${SUDO[@]}" install -o root -g root -m 0755 "$bwrap_release_bin" "$bwrap_bin"
bwrap_mode=$(stat -Lc '%a' "$bwrap_bin")
bwrap_uid=$(stat -Lc '%u' "$bwrap_bin")
if [[ "$bwrap_uid" != 0 ]] || (( (8#$bwrap_mode & 8#022) != 0 )); then
  echo 'Pinned bubblewrap must be root-owned and not group/world writable.' >&2
  exit 11
fi

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

if [[ -r /proc/sys/kernel/unprivileged_userns_clone ]] && [[ $(cat /proc/sys/kernel/unprivileged_userns_clone) != 1 ]]; then
  echo 'Unprivileged user namespaces are disabled by the kernel; refusing to weaken the host security policy automatically.' >&2
  exit 3
fi

profile_source="$script_dir/apparmor/nexus-bwrap-userns-restrict"
profile=/etc/apparmor.d/nexus-bwrap-userns-restrict
[[ -f "$profile_source" ]] || { echo 'Nexus bubblewrap AppArmor profile is missing.' >&2; exit 4; }
"${SUDO[@]}" install -o root -g root -m 0644 "$profile_source" "$profile"
"${SUDO[@]}" apparmor_parser -r "$profile"

# Validate exactly the capability that Nexus requires: an unprivileged user namespace
# containing a private network namespace. This intentionally does not relax the host-wide
# AppArmor/sysctl policy, and the sandbox payload still drops all capabilities.
"$bwrap_bin" \
  --die-with-parent \
  --new-session \
  --unshare-user \
  --unshare-pid \
  --unshare-ipc \
  --unshare-uts \
  --unshare-net \
  --ro-bind / / \
  --cap-drop ALL \
  -- /bin/true

echo "Nexus Agent Runner prerequisites are ready (bubblewrap $BWRAP_VERSION + mise $MISE_VERSION)."
