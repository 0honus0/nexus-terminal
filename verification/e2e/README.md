# Nexus Terminal E2E

Playwright is used for browser UI, HTTP API, WebSocket, SSH, and SFTP end-to-end coverage.

## Structure

- `tests/auth/` — first-run setup, administrator creation, login, and session establishment.
- `tests/http/` — HTTP API authentication and protected endpoint flows.
- `tests/ingress/` — production Nginx ingress regressions that must not be hidden by the Vite development server.
- `tests/websocket/` — WebSocket upgrade authentication and protocol frame flows.
- `tests/ui/` — authenticated browser navigation and UI behavior.
- `tests/ssh/` — real SSH connection flows and file-manager SFTP behavior against an isolated in-process SSH server.
- `tests/mobile/` — mobile-only SSH workspace, layout, status-monitor, and touch-interaction regressions.
- `support/` — shared E2E helpers, test credentials, the test SSH server, and the mirrored log reporter.
- `logs/` — generated per-test logs. Its directory structure mirrors `tests/` and it is ignored by Git.

The Playwright projects are ordered with dependencies: `auth` runs first, and `http`, `websocket`, `ui`, `ssh`, and `mobile` depend on it. This guarantees that a clean E2E database is initialized through the real first-run setup flow before dependent tests execute.

The SSH project starts a real `ssh2.Server` on `127.0.0.1:22222`. Its SFTP filesystem is isolated under `verification/e2e/.tmp/ssh-root`, so GitHub Actions does not depend on any external SSH host.

## Logs

Every test receives its own text log. The archive layout mirrors the test source layout, for example:

```text
tests/ssh/file-manager-context-menu.spec.ts
logs/ssh/file-manager-context-menu/verifies file manager right-click actions over real SFTP.log
```

The log records Playwright steps, API/browser actions, stdout/stderr, final status, failure stacks, and attachment paths. GitHub Actions uploads `verification/e2e/logs/` as the `playwright-e2e-logs` artifact on every run.

## Local commands

From the repository root:

```bash
npm run test:e2e
npm run test:e2e:auth
npm run test:e2e:http
npm run test:e2e:websocket
npm run test:e2e:ui
npm run test:e2e:ssh
npm run test:e2e:mobile
npm run test:e2e:list
```

The production ingress suite is run separately because it targets a real Nginx endpoint rather than the Vite development server. Set `NEXUS_PRODUCTION_BASE_URL` to the prepared ingress URL and run:

```bash
NEXUS_PRODUCTION_BASE_URL=http://127.0.0.1:18112 npm --prefix verification/e2e run test:ingress
```

GitHub Actions prepares that ingress with `RP_ID=ssh.honus.top` and `RP_ORIGIN=https://ssh.honus.top,https://ssh.trui.de`, then sends `Host: ssh.honus.top` so the regression does not depend on public DNS.

## Regression coverage

The suite intentionally keeps regression tests for previously fixed production issues, including:

- first SSH directory change waiting for the initial real shell prompt;
- extensionless text files opening and saving through the editor;
- streamed previews for Unicode image names, Markdown, and XLSX files, plus stale symlink failure isolation;
- cross-session copy and two-phase move semantics with transfer progress;
- multi-megabyte SFTP uploads completing every block before success;
- SSH suspend/disconnect/resume lifecycle;
- mobile terminal height, command-bar sizing, touch long-press context menus, and the status-monitor modal;
- status-monitor network samples and Docker status over the live SSH transport;
- full encrypted backup export/import restoring settings and encrypted connection credentials.
- TOTP 2FA setup, login gating, verification, and disable lifecycle;
- connection update/clone/delete with preserved encrypted credentials and tag associations;

Install the browser once when needed:

```bash
npm --prefix verification/e2e ci
npm --prefix verification/e2e exec -- playwright install chromium
```

On Linux hosts that do not already contain Chromium system libraries, Playwright may require root privileges for `playwright install --with-deps chromium`. GitHub Actions performs this automatically.

## Isolation

Each run uses `verification/e2e/.tmp/backend-data` through `NEXUS_DATA_DIR`. The backend database, generated environment data, and file-backed sessions therefore never touch `packages/backend/data`.

Vite also uses an E2E-specific cache directory so local dependency-cache permissions do not affect the test server.

Runtime databases, reports, traces, screenshots, videos, logs, PID files, caches, and test-installed `node_modules` are ignored by Git.
