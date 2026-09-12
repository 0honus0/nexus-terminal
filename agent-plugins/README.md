# Nexus Agent plugins

This directory contains source trees for independently signed Agent App packages. They are intentionally outside the pnpm workspace: plugin packages are distribution artifacts loaded through the Nexus Agent plugin trust/install boundary, not code linked into the Nexus Backend or Frontend process.

`presets/` contains first-party preset Agent sources. Production packages are built with `scripts/agent-plugins/build-package.mjs` and must be signed by an Ed25519 private key supplied outside the repository. Private signing keys and generated package output must never be committed.

A remote repository catalog is discovery metadata only. Nexus still requires the catalog publisher key to be explicitly trusted and verifies each package signature and `files.json` hashes before installation.
