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

"${SUDO[@]}" apt-get update
"${SUDO[@]}" apt-get install -y bubblewrap apparmor apparmor-utils apparmor-profiles ca-certificates curl


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
  "${SUDO[@]}" install -m 0755 "$extracted_mise" "$mise_bin"
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

profile=/etc/apparmor.d/bwrap-userns-restrict
extra_profile=/usr/share/apparmor/extra-profiles/bwrap-userns-restrict
if [[ -f "$extra_profile" ]]; then
  "${SUDO[@]}" install -m 0644 "$extra_profile" "$profile"
elif [[ ! -f "$profile" ]]; then
  echo 'Ubuntu bwrap-userns-restrict AppArmor profile is unavailable; refusing to disable AppArmor userns restrictions.' >&2
  exit 4
fi

"${SUDO[@]}" apparmor_parser -r "$profile"

sandbox_bin=$(command -v bwrap)
if [[ $(readlink -f "$sandbox_bin") != /usr/bin/bwrap ]]; then
  echo "Expected distro bubblewrap at /usr/bin/bwrap, got $sandbox_bin; the AppArmor profile is path-scoped." >&2
  exit 5
fi

# Validate exactly the capability that Nexus requires: an unprivileged user namespace
# containing a private network namespace. This intentionally does not relax the host-wide
# AppArmor/sysctl policy, and the sandbox payload still drops all capabilities.
/usr/bin/bwrap \
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

echo "Nexus Agent Runner prerequisites are ready (bubblewrap + mise $MISE_VERSION)."
