# Nexus Terminal E2E

> Development rules are maintained in root [AGENTS.md](../../AGENTS.md). Observable product requirements are maintained in [USAGE](../USAGE.md).

Playwright is used for browser UI, HTTP API, WebSocket, SSH, and SFTP end-to-end coverage.

Terminal pointer tests use locator clicks so layout changes and viewport scrolling cannot redirect clicks outside the terminal. OSC 52 clipboard tests start an independent SSH session: the pipe-based SSH fixture does not provide PTY signal semantics for stopping a preceding foreground command with Ctrl+C. Status detail assertions target the shared tooltip panel and live accessible metric label, not native title attributes.

OSC 52 tests type ASCII-only shell commands and decode the Unicode heading from Base64 on the test server. Playwright's non-ASCII text insertion is not a physical key event and can interact with xterm's retained helper-textarea paste value; it must not be used to construct these shell commands. The clipboard assertion still compares the complete Unicode text and all 2000 lines.

Foreground liveness tests wait for successful probe responses to finish browser-side processing before switching to dropped probes. Observing an outgoing ping or catalog refresh alone does not mean the in-flight probe has settled; an immediate foreground event intentionally reuses it. The fixture tracks completion after message dispatch and promise microtasks, without adding an arbitrary sleep.

CI shards enable `DEBUG=pw:webserver` and retain combined output in `.tmp/shard-server.log` with failure diagnostics. This includes managed-service output needed to investigate backend exits before cascading ECONNRESET/ECONNREFUSED failures. The shell pipeline uses pipefail so collecting logs cannot hide a failing test exit status.

The canonical GitHub workflow is `.github/workflows/e2e.yml`. It runs standard lint/type checks, formatting and production builds, eight duration-balanced Playwright shards on isolated GitHub-hosted runners with Node 24 and the repository-pinned Playwright version, and production-style Docker smoke tests.

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

Local cross-server transfer scenarios require `ssh`, `scp`, `rsync` and `sshpass` on the host PATH, matching the E2E runner image. Missing tools must be supplied before running these scenarios, not worked around by weakening transfer assertions.

Run local Playwright invocations sequentially within a checkout: they share fixture services and the report/artifact directories. Select multiple spec files in one invocation rather than overlapping commands; isolated GitHub shard jobs do not share these resources.

Terminal UI coverage uses the rendered font-size state, terminal surface and Workspace-scoped tablist to verify real SSH output, clipboard interaction, scrollback, geometry, font persistence and session cleanup. Appearance coverage uses visible controls, theme names and public appearance API state for preset selection, mobile typography/text effects, background uploads and local/remote HTML theme flows; it does not depend on production test-only attributes.

Remote-desktop regressions exercise RemoteApp persistence, route-preserving RDP/VNC launch, clipboard exchange, DPI, fullscreen and pointer resize/minimize/restore through the shared window surface. Docker/layout and mobile-preview regressions use public pane controls, existing layout/session/task state and accessible document controls to verify remote commands, compact geometry, layout locking, PDF outline/pinch/panning, preview reset and upload hide/restore/cancellation.

`ssh/suspend-log-compaction.spec.ts` seeds a near-compaction-threshold log in the isolated fixture filesystem, then uses real SSH output and Workspace WebSocket handoff to cross the threshold, resume during continuing output, verify the original shell identity and confirm the physical log was compacted. It avoids sending a 100MiB seed through the terminal renderer and does not substitute a larger ownership lease for storage recovery.

CAPTCHA and proxy lifecycle coverage uses settings headings, form controls and management cards while retaining public-configuration secrecy and explicit credential-update assertions. Panel scaling and advanced mobile touch coverage uses rendered scale state, accessible menus/document actions and the real terminal surface to verify persistence races, archive creation, CodeMirror editing and virtual-keyboard escape sequences without production test markers.

Dashboard and mobile suspend/resume coverage targets host cards, public connection timestamps, tab semantics and suspend identifiers. It retains assertions for independent resource loading, persisted filters, catalog refresh, single-tab recovery, original-shell continuity and older-history touch scrolling.

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

GitHub Actions provides the canonical complete delivery evidence. The quality job runs standard lint/type checks, formatting and production builds serially. Push and pull-request runs use eight Playwright runners by default. Manual workflow dispatch can select 6–10 runners. The selected matrix uses `scripts/e2e/duration-estimates.json` and a longest-estimated-spec-first allocator to distribute the seven normal Playwright projects across duration-balanced shards. Each shard job pulls the current prewarmed E2E runner image, links the frozen workspace from its offline pnpm store, deterministically regenerates the same assignment and runs its assigned spec files. New specs without a direct estimate use the median for their Playwright project, then the global median as a fallback. The Docker job restores the repository-pinned Playwright browser and separate BuildKit caches for the unified and standalone Agent Runner images, builds both delivery images, then exercises standalone Runner, core-without-Runner and full deployment smoke paths. Cache hits only avoid repeated downloads and unchanged image layers; every run still executes all three smoke paths against images built from the tested revision. Local commands remain useful for listing tests, running focused specs and reproducing failures. Automated dependency updates dispatch this same workflow on their update branch.

For a long-lived remote development host that may already be serving Nexus on the default E2E ports, use `pnpm run test:e2e:remote -- <Playwright args>`. The remote launcher keeps explicit `NEXUS_E2E_*_PORT` overrides, dynamically reserves unique loopback ports for every unset E2E service, and invokes the installed `pnpm` executable directly. It enforces the repository Node engine before starting tests. This helper is for focused remote reproduction; it does not replace the canonical GitHub Actions evidence.

The standalone Runner smoke installs supported Node, Python and Go versions through public catalog/command endpoints, submits family/version references without content digests, and verifies installed-state projection. The full deployment smoke retains real execution, version switching, shared installation and lifecycle checks.

## CI balanced shards

Release publication validates a complete successful run of this workflow for the current main SHA, so every selected shard and Docker smoke must pass together; retired per-project check names are not release prerequisites. UI regression locators must use accessible roles, names and existing product state or rendered component classes instead of requiring production-only test markers.

The canonical push/pull-request workflow keeps eight isolated Playwright jobs, but their spec assignments are duration-balanced rather than fixed at one job per project. Manual dispatch can select 6–10 jobs. The allocator covers every spec under `auth`, `http`, `agent`, `websocket`, `ui`, `ssh`, and `mobile` exactly once. Matrix jobs fail directly when their Playwright command fails.

Each job checks out the tested commit inside the current E2E runner image, links the frozen workspace offline, and regenerates the same deterministic shard assignment before running it. The image supplies Node 24, pnpm, Chromium and Playwright's system dependencies. Fresh GitHub-hosted runners eliminate local port collisions. The default balance can be inspected locally with `node scripts/e2e/balanced-shards.mjs plan --shards 8`.

Every Playwright shard publishes its successful per-spec runtime after the run. A final aggregation job smooths those observations into `scripts/e2e/duration-estimates.json`; a new spec is added immediately, while an existing estimate changes only when the smoothed value differs by at least two seconds and five percent. Pull-request and manual runs upload the proposed baseline as an artifact without writing either branch. A successful branch push writes a material timing update directly back to the same branch that triggered the workflow. The workflow skips the update if that branch advanced after the tested revision. The generated commit contains `[skip ci]`, so pushing the baseline cannot recursively start another E2E workflow. The next E2E run therefore starts from the latest committed balance while one noisy run cannot completely replace established history.

Before Playwright starts, the workflow fingerprints the runner definition, dependency lockfile, Node, pnpm, and Playwright versions. It anonymously reads only the `nexus-terminal-e2e-runner:latest` manifest/config metadata and compares the embedded fingerprint with the current repository, without logging in to GHCR or downloading image layers. A missing or outdated image triggers GHCR login, rebuild, an exact offline workspace-install verification through an Actions-style bind-mounted checkout, and a push directly as `latest`; an unchanged image skips all four operations. Every Playwright shard pulls `latest` when its job starts and links the frozen workspace from the image's prewarmed offline pnpm store. The image fixes pnpm's effective store with `PNPM_CONFIG_STORE_DIR` and enables its side-effects cache, so a checkout mounted outside the image work directory reuses both downloaded packages and lifecycle outputs. Python and the native compiler toolchain build the optional `ssh2` crypto binding once in the same image layer that removes them and clears the apt metadata afterward; release verification confirms those build-only tools are absent and rejects an image if a fresh mounted checkout tries to run the build again. If another branch replaces `latest` before a shard starts, or a fork pull request cannot update the repository package, the shard detects the fingerprint mismatch and downloads only dependencies and the headless browser revision absent from the image. The slim image includes only Chromium's headless shell, its system dependencies, and the command-line tools used by the suite, so normal E2E runs do not reinstall the browser or carry the full headed Chromium package.

Manual workflow dispatch exposes a `refresh_screenshots` option. When enabled, the normal duration-balanced E2E shards capture the declared documentation checkpoints during the same test run and upload their PNG artifacts. After quality checks, every Playwright shard, and Docker smoke succeed, a final job merges the produced screenshots into `doc/imgs/e2e/` and pushes a single `docs(e2e): refresh screenshots [skip ci]` commit back to the selected branch. It skips the write if that branch advanced after the tested revision, and `[skip ci]` prevents the generated commit from starting another E2E workflow.

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
- real SFTP navigation uses the actual list scroll container and rendered filename label to verify long-list scrolling, truncation, sorting, popup resizing and path history; shared Progress Display helpers distinguish the tab-bar manager from the per-session restore button and use task state, named actions and rendered source cards;
- terminal-tool regressions exercise terminal search, clear-and-redraw, command-history replay and saved quick-command execution through the rendered terminal and command controls; hidden upload progress verifies the visible fractional percentage beside its progress bar;
- document preview coverage uses the active document mode, named preview tabs, PDF toolbar and spreadsheet pager to verify cached state, close/hide behavior, single content scrollbars, external refresh and persisted pagination limits;
- file preview/editor scenarios retain real remote-content, encoding, line-ending, search, database-table and resize assertions using existing editor controls and preview semantics;
- connection creation coverage uses named actions, saved connection cards and inline test results while verifying real SSH authentication, credential-preserving clones, script imports and filtered bulk tests;
- batch connection editing verifies persisted notes, failed-item selection after partial updates, lazy auxiliary catalogs and narrow-screen row selection through existing cards, switches and modal controls;
- SSH key management coverage uses named dialogs and actions to verify file import, name-only edits, saved-key/password authentication switches, delete recovery and narrow-screen loading errors without exposing private-key details;
- password-change coverage uses the Security heading, associated password labels and named submit action to verify local validation, rejected current credentials, cleared inputs, authenticated-session continuity and real login with the changed credential before restoring the test account;
- audit-log coverage uses the page heading, named filters, durable audit row identities and pagination navigation to verify combined filtering, filter persistence across pages and narrow-screen detail scrolling;
- quick-command management uses the rendered panel, named dialogs and row/context actions to verify persisted creation/edit/deletion, live SSH execution and usage counts, dialog resizing/reset and usable flat commands when the tag catalog fails;
- SSH reconnect coverage observes Workspace protocol requests, rendered terminal geometry and named connection-picker controls to verify initial failures, periodic/key-triggered recovery, hidden sessions, HTML backgrounds and mobile tab lifecycle;
- saved connection lifecycle coverage verifies real SSH tests before and after a name-only edit and confirmed deletion from both the visible list and persistence using named card/form actions;
- collapsible quick-command search coverage verifies default visibility, group-save persistence, search focus/Escape behavior and centered controls across sidebar widths using the existing panel and named controls;
- file upload scenarios verify clipboard/file-picker/folder uploads, remote bytes, conflict decisions, delayed SFTP acknowledgements, stream concurrency and hidden progress restoration/cancellation through existing file-manager and progress controls;
- hidden upload batch cancellation waits for every remaining row to reach a terminal state or for the empty-progress surface after automatic record cleanup; a cancelling action is not treated as cancellation completion;
- custom terminal theme and Workspace tag-management scenarios use current editor, token-input and named manager controls while retaining theme persistence/deletion and narrow-screen tag association assertions;
- backup and IP-control scenarios verify real export/import and persisted blacklist policy through named settings controls; mobile touch coverage retains RDP mode persistence without reconnect, live SSH Ctrl input, dormant progress, single-tap navigation and multi-select/editor behavior using current product surfaces;
- notification channel and tagged quick-command scenarios retain persistence, narrow-screen geometry and live SSH variable substitution through current controls; suspended-history recovery waits for available ownership, and fullscreen checkpoint scenarios synchronize with real shell readiness before freezing terminal state;
- multi-megabyte SFTP uploads completing every block before success;
- SSH suspend/disconnect/resume lifecycle;
- mobile terminal height, command-bar sizing, touch long-press context menus, and the status-monitor modal;
- settings regressions locate IP whitelist and logging forms through their labelled controls and verify persisted API values; appearance title-bar tests use the accessible color textbox and document theme state;
- dark/default UI theme switching and legacy input-token normalization use the rendered appearance editor and named Dashboard controls, while retaining contrast, persistence and viewport assertions;
- desktop and mobile no-session Workspace coverage verifies the unified start page, both connection and suspended-session panels, and page-owned vertical scrolling without horizontal overflow;
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
- RDP/VNC conditional forms and filtered bulk selection/deletion use named controls and connection cards, with API checks for saved connection fields and exact deletion results;
- command-history search, clipboard copy, replay and individual deletion are exercised through real SSH output and persisted history IDs;
- notification delivery tests use localized Add/Test controls and real webhook/SMTP receivers to verify unsaved delivery, localized event content, HTML email and persisted channel error recovery;
- Agent Host coverage verifies launcher passivity, cached conversation visibility, user-scoped layout reset including launcher docking, provider controls and expanded batched tool-call details through existing labels and tool-name state;

For optional focused local browser debugging, install Chromium when the host already has (or can install) the required system libraries:

```bash
pnpm install --frozen-lockfile
pnpm --filter @nexus-terminal/e2e exec playwright install chromium
```

On Linux hosts that do not already contain Chromium system libraries, Playwright may require root privileges for `playwright install --with-deps chromium`.

## Test reset baseline

Each run uses `tests/e2e/.tmp/backend-data` through `NEXUS_DATA_DIR`. The backend database, generated environment data, and file-backed sessions therefore never touch `packages/backend/data`.

Normal E2E specs use `tests/e2e/fixtures/seeded-data/nexus-terminal.db` as their known baseline. In GitHub Actions, every matrix group runs in its own isolated runner/container and copies this committed seed into that runner's `.tmp/backend-data`, so groups never share a runtime database. The backend exposes the E2E reset endpoint only when both `NODE_ENV=test` and `NEXUS_E2E_RESET_ENABLED=1` are set. Before every E2E test case, the fixture restores the database from the declared baseline, clears file-backed sessions, and resets the isolated SSH test server state. Normal cases use the committed seeded database; the first-run setup case explicitly selects an empty database. No test case depends on database state produced by another case, so any case can be selected directly and every CI group can start independently.

Vite also uses an E2E-specific cache directory so local dependency-cache permissions do not affect the test server.

Runtime databases, reports, traces, screenshots, videos, logs, PID files, caches, and test-installed `node_modules` are ignored by Git.

## Engineering constraints

When adding, moving, grouping, or optimizing tests, follow root [AGENTS.md](../../AGENTS.md) and verify observable behavior described in [USAGE](../USAGE.md).
