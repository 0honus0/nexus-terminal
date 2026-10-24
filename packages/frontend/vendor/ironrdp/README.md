# IronRDP pinned upstream build

The npm `0.7.0` release predates fixes for bitmap source stride and invalid bitmap bounds. Valid padded updates can panic the WASM renderer and stop input. The width alignment workaround does not address per-rectangle source padding and has been removed.

This directory retains the **unmodified upstream-built npm archive**, so installation and Docker builds do not download an expiring Actions artifact. No third-party source or binary is patched locally.

- Source: [Devolutions/IronRDP `62246b364a0282bab85087f658a81fe4207b6b31`](https://github.com/Devolutions/IronRDP/commit/62246b364a0282bab85087f658a81fe4207b6b31).
- Successful official build: [39196965692](https://github.com/Devolutions/IronRDP/actions/runs/39196965692), artifact `npm` (`12162695756`). The publish step was skipped; the archive still identifies itself as `0.7.0`.
- Archive: `iron-remote-desktop-rdp-62246b364a02.tgz` (original name `devolutions-iron-remote-desktop-rdp-0.7.0.tgz`).
- SHA-256: `be9364441f5ef8059d55c33109ba4f688bb4532ea6d4f04ec6d69b0bd3cc7921`.
- Fixes included: [bitmap source stride](https://github.com/Devolutions/IronRDP/commit/80bb81b344dba0197aa7b870c685f398dc4bcaee) and [malformed bitmap recovery](https://github.com/Devolutions/IronRDP/commit/20e2d414e5ac060db25a100ed219f417e19f79b2).
- License: MIT OR Apache-2.0; both upstream license texts are included alongside the archive.

To reproduce the upstream build, check out the exact source commit, install its Rust/Node prerequisites and follow `.github/workflows/npm-publish.yml` and `cargo xtask web --help` from that checkout. To refresh this snapshot, select an official successful build at a fixed commit, verify its archive/source/API and licenses, update the local dependency and lockfile, and run the complete remote RDP/VNC regressions. Never replace the archive without updating the source identifier and integrity evidence. Switch back to an npm release only after it contains both fixes and passes the same regressions.
