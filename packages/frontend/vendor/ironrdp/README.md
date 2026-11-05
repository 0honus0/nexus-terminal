# IronRDP pinned build with upstream Web audio patch

The npm `0.7.0` release predates bitmap source stride and invalid-bounds fixes. This build keeps those fixes and applies the public upstream Web audio proposal [PR #2020](https://github.com/Devolutions/IronRDP/pull/2020), pinned to its exact commit. The PR is **not merged** as of 2026-11-05; this is a locally rebuilt dependency, not an official audio release.

- Base source: [Devolutions/IronRDP `62246b364a0282bab85087f658a81fe4207b6b31`](https://github.com/Devolutions/IronRDP/commit/62246b364a0282bab85087f658a81fe4207b6b31).
- Audio source: PR #2020, commit `3bf4a223f7765a05597849691eb76da34d7e5cc8`. `audio-output.patch` contains the upstream changes, attribution and tests; empty context lines are normalized for repository whitespace checks; SHA-256 `de4c85804372753191a8057cfaa776b8fa94395759ab57141ff1fed65223f3f1`.
- Package version: `0.7.0-nexus.audio.1`; archive `iron-remote-desktop-rdp-62246b364a02-audio-3bf4a223f776.tgz`.
- Archive SHA-256: `616f3720728f2ae014c0091b97788873b6434025bfceb1b96e10c3d90158d7c8`.
- Retained fixes: [bitmap source stride](https://github.com/Devolutions/IronRDP/commit/80bb81b344dba0197aa7b870c685f398dc4bcaee) and [malformed bitmap recovery](https://github.com/Devolutions/IronRDP/commit/20e2d414e5ac060db25a100ed219f417e19f79b2).
- License: MIT OR Apache-2.0; both upstream license texts are retained here.

The `audioPlayback` builder extension enables RDPSND and delivers PCM16 stereo at 22.05/44.1/48 kHz, volume and close events. It also attaches a device-less RDPDR channel when needed by Windows, without redirecting disks or printers. The application owns browser playback, user activation and cleanup; microphone capture is not enabled. RDPGFX, RemoteApp, monitor layout and color/bandwidth controls are not added by this patch.

Build prerequisites used: Rust 1.94.1 with `wasm32-unknown-unknown`, wasm-pack 0.15.1, Node 26.13.0 and npm 11.20.0. An isolated Docker builder used `rust:1.94.1-bookworm` and Node from `node:26.13.0-bookworm-slim`; logs are outside the repository. Disposable source, caches and builder images were removed after the authorized Windows test; the pinned patch and instructions here retain the reproduction inputs. No build tool is required at application installation or runtime.

To rebuild, check out the base commit in an external build directory, apply `audio-output.patch` with `git apply --check` followed by `git apply`, and use the checked-in Cargo/npm lockfiles. From `crates/ironrdp-web`:

```sh
RUSTFLAGS='-Ctarget-feature=+simd128,+bulk-memory --cfg getrandom_backend="wasm_js" -Copt-level=s -Ccodegen-units=1 -Cllvm-args=-enable-dfa-jump-thread' wasm-pack build --target web --locked
```

Then perform the generated JS URL rewrite used by upstream `xtask/src/web.rs`: prepend `import wasmUrl from './ironrdp_web_bg.wasm?url';` to `crates/ironrdp-web/pkg/ironrdp_web.js`, and replace `new URL('ironrdp_web_bg.wasm', import.meta.url)` with `wasmUrl`. From `web-client/iron-remote-desktop-rdp`, run `npm ci`, set **public/package.json** version to `0.7.0-nexus.audio.1`, run `npm run check` and `npm run build-alone`, then `npm pack` from `dist`. Use the explicit WASM build above rather than relying on `pre-build.js`, whose error handling can hide build failures. Toolchain/packaging differences may change binary hashes; verify and record the actual archive instead of assuming a byte-identical rebuild.

The previous unmodified archive came from successful official build [39196965692](https://github.com/Devolutions/IronRDP/actions/runs/39196965692), artifact `12162695756`, SHA-256 `be9364441f5ef8059d55c33109ba4f688bb4532ea6d4f04ec6d69b0bd3cc7921`; it remains in Git history rather than duplicating binaries here.

When upstream publishes a Web audio release containing both bitmap fixes, migrate to that release and remove this patch/archive together. Recheck the callback API and regress real RDP/VNC graphics, input, clipboard, audio, resizing and reconnect. npm installation, Docker and the E2E runner use the repository archive with pnpm integrity verification; they do not download expiring Actions artifacts.
