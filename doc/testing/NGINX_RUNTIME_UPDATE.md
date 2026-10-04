# nginx and Node.js runtime update

The Dockerfile follows `node:current-alpine` and `nginx:stable-alpine` at the user's request. Build with `--pull --no-cache` to refresh base images and package installation layers. Build and runtime system packages are upgraded from their stable Alpine repositories; application dependencies, pnpm and the dependency lockfile are unchanged. The runtime copies Node.js from the build stage and installs libstdc++ and tini. The project entrypoint remains unchanged; nginx configuration now loads from `/etc/nginx/conf.d/default.conf`.

The `/ws/` location uses `proxy_buffer_size 8k`. On the isolated official-nginx TCP echo fixture, baseline/candidate/baseline/candidate 16 MiB echo medians were 138.66/101.69/134.39/107.48 ms, with three samples per invocation. The reductions were 26.7% and 20.0%. On the older local Alpine nginx 1.30.4 image, candidate/baseline medians were 108.56/135.23 ms. Small-message latency was not consistently improved and one comparison regressed; these measurements are not proof of real interactive terminal improvement.

The attempted 16 KiB directive failed nginx buffer configuration validation and was removed. Failure artifacts remain under `/tmp/opencode/`. A separate TCP fixture setup failed before measurement due to a missing host port on its internal network; the fixture now uses a dedicated bridge and loopback-only published ports. Unix-socket and TCP results are not pooled.

## Local validation

- Full `--pull --no-cache` image build succeeded after reclaiming Docker build cache and unreferenced images following an ENOSPC failure.
- Final image: `nexus-terminal:node-current-nginx-stable-local`; observed Node.js 26.10.0 and nginx 1.30.5.
- Actual dependency probes passed SQLite queries, bcrypt hashing/comparison and ssh2 loading. The initial probe incorrectly requested absent `node-pty`; that was a probe error, not product incompatibility.
- `scripts/e2e/docker-core-no-runner-smoke.sh` passed, including project entrypoint, backend health, frontend startup and no-Runner behavior.
- Final-image TCP fixture passed `nginx -t`, exact binary echo, recovery of eight 1 MiB blocks after paused reads, upstream release after client termination, and three abrupt upstream disconnects (client code 1006) followed by fresh 64 KiB echo connections.
- `pnpm run check`, `pnpm run format:all:check` and `git diff --check` passed before this evidence file was added.
- Logs: `/tmp/opencode/opt-24-node-current-{build-after-cleanup,native-validation,core-smoke,final-ws,final-check,final-format}.log`.

The echo fixture does not validate authenticated terminal automatic reconnect, resend safety or sustained slow-consumer memory bounds. The other two Docker smokes and fixed-SHA complete E2E shards remain outstanding. Item 24 is not fully accepted. Configuration is retained by explicit user request, not as a claim that all acceptance requirements passed. No remote deployment was changed; no push or deployment is authorized by this local commit.
