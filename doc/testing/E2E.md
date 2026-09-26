# Nexus Terminal E2E

> Mandatory engineering rules are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md). If explanatory text differs from that register, the constraint register is authoritative.

Playwright is used for browser UI, HTTP API, WebSocket, SSH, and SFTP end-to-end coverage.

The canonical GitHub workflow is `.github/workflows/e2e.yml`. It runs standard lint/type checks, formatting and production builds, the seven Playwright projects on isolated GitHub-hosted runners with Node 24 and the repository-pinned Playwright version, and production-style Docker smoke tests.

## Structure

- `tests/e2e/specs/auth/` — first-run setup, administrator creation, login, and session establishment.
- `tests/e2e/specs/http/` — HTTP API authentication and protected endpoint flows.
- `tests/e2e/specs/agent/` — Agent Host, Provider, Plugin and Runner-backed product flows.
- `tests/e2e/specs/ingress/` — production Nginx ingress regressions exercised against the production-style ingress.
- `tests/e2e/specs/websocket/` — WebSocket upgrade authentication and protocol frame flows.
- `tests/e2e/specs/ui/` — authenticated browser navigation and UI behavior.
- `tests/e2e/specs/ssh/` — real SSH connection and SFTP/File Manager flows.
- `tests/e2e/specs/mobile/` — mobile Workspace, layout, status monitor and touch interaction.
- `tests/e2e/support/` — shared helpers, test servers and the mirrored log reporter.
- `tests/e2e/fixtures/` — committed deterministic seed and isolated external service fixtures.
- `tests/e2e/.tmp/` and `tests/e2e/logs/` — generated runtime data and per-test logs, ignored by Git.

The main E2E projects do not depend on `auth` to create shared state. Normal specs start from the committed seeded database, while the first-run setup regression explicitly requests an empty database. This keeps project and spec scheduling independent from first-run setup order.

The SSH project starts a real `ssh2.Server` on `127.0.0.1:22222`. Its SFTP filesystem is isolated under `tests/e2e/.tmp/ssh-root`, so GitHub Actions does not depend on any external SSH host.

Test support HTTP controls are limited to deterministic fixture setup and fault injection (for example remote file creation, artificial latency, or SSH availability). Test assertions use the Nexus HTTP/WebSocket/UI/ingress surfaces. Fake external services validate incoming requests directly and return success/failure instead of exposing captured internal request logs to specs.

Functional/documentation screenshots are declared directly at real E2E checkpoints with `captureFunctionalScreenshot(page, filename)`. Screenshot capture remains opt-in for focused maintenance runs; the canonical E2E workflow does not mutate the repository or commit refreshed screenshots.

## Logs

Every test receives its own text log. The archive layout mirrors the test source layout, for example:

```text
tests/e2e/specs/ssh/file-manager-navigation.spec.ts
tests/e2e/logs/ssh/file-manager-navigation/navigates remote directories over real SFTP.log
```

The log records Playwright steps, API/browser actions, stdout/stderr, final status, failure stacks, and attachment paths. Failed GitHub Actions matrix jobs upload logs, Playwright reports, traces, screenshots, and videos in a project-scoped diagnostic artifact.

On GitHub Actions, the mirrored reporter also prints concise live progress to the job log: test start/end, explicit `test.step(...)` start/result, retry number, and duration. Set `E2E_CONSOLE_LOGS=1` to enable the same console output locally without changing the full per-test log files.

## Local commands

From the repository root:

```bash
pnpm run test:e2e:seed
pnpm run test:e2e
pnpm run test:e2e:auth
pnpm run test:e2e:http
pnpm run test:e2e:agent
pnpm run test:e2e:websocket
pnpm run test:e2e:ui
pnpm run test:e2e:ssh
pnpm run test:e2e:mobile
pnpm run test:e2e:list
pnpm run test:e2e:remote -- --project=http specs/http/auth-2fa.spec.ts
pnpm --filter @nexus-terminal/e2e run test:docs
```

GitHub Actions provides the canonical complete delivery evidence. The quality job runs standard lint/type checks, formatting and production builds serially. Each Playwright matrix job installs the frozen workspace plus the pinned Chromium runtime on a fresh hosted runner and runs one project directly. The Docker job builds the unified and standalone Agent Runner images, then exercises standalone Runner, core-without-Runner and full deployment smoke paths. Local commands remain useful for listing tests, running focused specs and reproducing failures. Automated dependency updates dispatch this same workflow on their update branch.

For a long-lived remote development host that may already be serving Nexus on the default E2E ports, use `pnpm run test:e2e:remote -- <Playwright args>`. The remote launcher keeps explicit `NEXUS_E2E_*_PORT` overrides, dynamically reserves unique loopback ports for every unset E2E service, and invokes Playwright through Corepack so a stale system-level `pnpm` shim does not control the run. It enforces the repository Node engine before starting tests. This helper is for focused remote reproduction; it does not replace the canonical GitHub Actions evidence.

## CI project matrix

The canonical workflow uses a static matrix with one isolated job for each Playwright project: `auth`, `http`, `agent`, `websocket`, `ui`, `ssh`, and `mobile`. Matrix jobs fail directly when their Playwright command fails.

Each job checks out the tested commit, sets up Node 24 and pnpm, installs the frozen workspace, installs Chromium with Playwright's system dependencies, and runs exactly one project. Fresh GitHub-hosted runners eliminate local port collisions.

Production-ingress coverage can still be run explicitly against a prepared production-style endpoint:

```bash
NEXUS_PRODUCTION_BASE_URL=http://127.0.0.1:18113 pnpm --filter @nexus-terminal/e2e run test:ingress
```

## Regression coverage

The suite intentionally keeps regression tests for previously fixed production issues, including:

- desktop Dashboard keeps the Recent Activity section reachable in the initial common viewport while connection/resource panels own their scrolling;
- Quick Commands preserve text-only group rename, header-area expand/collapse, and narrow-pane toolbar scaling without horizontal overflow;
- File Manager path history and favorite-path popovers keep rounded themed chrome, wrap long paths, resize with the viewport, and remain inside viewport bounds;
- unified document search keeps rounded themed controls, while spreadsheet pagination is absent when the active sheet fits on one page;
- first SSH directory change waiting for the initial real shell prompt;
- extensionless text files opening and saving through the editor;
- streamed previews for Unicode image names, Markdown, and XLSX files, plus stale symlink failure isolation;
- cross-session copy and two-phase move semantics with transfer progress;
- multi-megabyte SFTP uploads completing every block before success;
- SSH suspend/disconnect/resume lifecycle;
- mobile terminal height, command-bar sizing, touch long-press context menus, and the status-monitor modal;
- mobile global navigation remains horizontally swipeable when constrained while its native scrollbar track/thumb stays hidden;
- mobile terminal long-press selection suppresses the xterm helper textarea's soft-keyboard focus during hold/menu/copy, restores its input attributes after Copy without refocusing, and restores normal focus on a later short tap;
- Workspace layout configurator direction rendering, including horizontal sibling alignment and vertical child stacking in the editor preview;
- narrow File Manager presentation collapsing secondary metadata columns, keeping the type icon close to the filename without horizontal overflow, and centering a deliberately delayed directory-loading spinner in the remaining list area;
- Quick Commands keeping Copy/Edit/Delete in the row context menu with the duplicate inline three-button strip absent;
- desktop no-session Workspace connection-pane divider resizing and persisted width restoration;
- status-monitor network samples and Docker status over the live SSH transport;
- full encrypted backup export/import restoring settings and encrypted connection credentials, with the retired standalone connection-export UI/API kept absent and the backup file picker retaining rounded themed chrome;
- legacy official HTML-theme repository URLs resolving to the current remote catalog instead of returning a missing-directory 400;
- HTTP SFTP download-ticket/Range/inline/directory-ZIP behavior bound to an active Workspace session;
- raw binary upload ready/progress/completion and remote-content verification through the clean Workspace/upload protocols;
- real Login CAPTCHA fail-closed/token lifecycle and browser WebAuthn passkey success/credential-failure/password-fallback surfaces.
- TOTP 2FA setup, login gating, verification, and disable lifecycle;
- historical database startup applying connection migrations, including migration 20 normalizing legacy proxy-route rows without `proxy_id` while preserving real proxy references;
- connection update/clone/delete with preserved encrypted credentials and tag associations;

For optional focused local browser debugging, install Chromium when the host already has (or can install) the required system libraries:

```bash
pnpm install --frozen-lockfile
pnpm --filter @nexus-terminal/e2e exec playwright install chromium
```

On Linux hosts that do not already contain Chromium system libraries, Playwright may require root privileges for `playwright install --with-deps chromium`. The canonical complete-E2E environment is documented in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-e2e-001).

## Test reset baseline

Each run uses `tests/e2e/.tmp/backend-data` through `NEXUS_DATA_DIR`. The backend database, generated environment data, and file-backed sessions therefore never touch `packages/backend/data`.

Normal E2E specs use `tests/e2e/fixtures/seeded-data/nexus-terminal.db` as their known baseline. In GitHub Actions, every matrix group runs in its own isolated runner/container and copies this committed seed into that runner's `.tmp/backend-data`, so groups never share a runtime database. The backend exposes the E2E reset endpoint only when both `NODE_ENV=test` and `NEXUS_E2E_RESET_ENABLED=1` are set. Before every E2E test case, the fixture restores the database from the declared baseline, clears file-backed sessions, and resets the isolated SSH test server state. Normal cases use the committed seeded database; the first-run setup case explicitly selects an empty database. No test case depends on database state produced by another case, so any case can be selected directly and every CI group can start independently.

Vite also uses an E2E-specific cache directory so local dependency-cache permissions do not affect the test server.

Runtime databases, reports, traces, screenshots, videos, logs, PID files, caches, and test-installed `node_modules` are ignored by Git.

## Engineering constraints

E2E rules are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-e2e-001). That document is authoritative when adding, moving, grouping, or optimizing tests.
