# Nexus Terminal E2E

Playwright is used for browser UI, HTTP API, and WebSocket end-to-end coverage.

## Structure

- `tests/auth/` — first-run setup, administrator creation, login, and session establishment.
- `tests/http/` — HTTP API authentication and protected endpoint flows.
- `tests/websocket/` — WebSocket upgrade authentication and protocol frame flows.
- `tests/ui/` — authenticated browser navigation and UI behavior.
- `support/` — shared E2E helpers and test credentials.

The Playwright projects are ordered with dependencies: `auth` runs first, and `http`, `websocket`, and `ui` depend on it. This guarantees that a clean E2E database is initialized through the real first-run setup flow before dependent tests execute.

## Local commands

From the repository root:

```bash
npm run test:e2e
npm run test:e2e:auth
npm run test:e2e:http
npm run test:e2e:websocket
npm run test:e2e:ui
npm run test:e2e:list
```

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
