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
"${SUDO[@]}" apt-get install -y bubblewrap apparmor apparmor-utils apparmor-profiles

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

echo 'Nexus Agent Runner bubblewrap host prerequisite is ready.'
