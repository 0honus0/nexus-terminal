# Nexus Terminal E2E

> Read [AGENTS.md](../AGENTS.md) before development. Observable product requirements are maintained in [USAGE](../USAGE.md). This document owns test commands, coverage and delivery evidence; update them alongside changes to the actual validation flow.

Playwright is used for browser UI, HTTP API, WebSocket, SSH, and SFTP end-to-end coverage.

Terminal pointer tests use locator clicks so layout changes and viewport scrolling cannot redirect clicks outside the terminal. OSC 52 clipboard tests start an independent SSH session: the pipe-based SSH fixture does not provide PTY signal semantics for stopping a preceding foreground command with Ctrl+C. Status detail assertions target the shared tooltip panel and live accessible metric label, not native title attributes.

OSC 52 tests type ASCII-only shell commands and decode the Unicode heading from Base64 on the test server. Playwright's non-ASCII text insertion is not a physical key event and can interact with xterm's retained helper-textarea paste value; it must not be used to construct these shell commands. The clipboard assertion still compares the complete Unicode text and all 2000 lines.

Foreground liveness tests wait for successful probe responses to finish browser-side processing before switching to dropped probes. Observing an outgoing ping or catalog refresh alone does not mean the in-flight probe has settled; an immediate foreground event intentionally reuses it. The fixture tracks completion after message dispatch and promise microtasks, without adding an arbitrary sleep.

Mobile automatic-input investigation uses a real remote read loop to consume DSR replies without contaminating shell command editing. It verifies connected status replies, captures actual query output and delivers it on the replacement WebSocket while workspace resume is held, checks disabled input and absence of replies/rejection logs, then verifies the separately observed server-output replay, its new protocol reply, a fresh query and loop exit after recovery. A reply to a replayed server query is not cached user input. This covers automatic status replies in that controlled recovery window, not physical-device IME composition or every unsolicited-input error source.

CI shards enable `DEBUG=pw:webserver` and retain combined output in `.tmp/shard-server.log` with failure diagnostics. This includes managed-service output needed to investigate backend exits before cascading ECONNRESET/ECONNREFUSED failures. The shell pipeline uses pipefail so collecting logs cannot hide a failing test exit status.

The canonical GitHub workflow is `.github/workflows/e2e.yml`. It runs standard lint/type checks, formatting and production builds, eight duration-balanced Playwright shards on isolated GitHub-hosted runners with Node 24 and the repository-pinned Playwright version, and production-style Docker smoke tests.

The full Docker smoke's direct Browser page fixture binds an OS-assigned loopback port and publishes that port only while retaining the listener. Compose resolves the required page-port environment variable only after binding succeeds; a missing binding fails closed. It does not probe and release a port before starting the page server, which could collide with another fixture and send readiness checks to the wrong service.

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

Wide-touch Pad coverage keeps a desktop user agent and layout while exercising downward drags at empty history, the history boundary and a real alternate-screen input loop. Touch and mouse-wheel recovery are independent scenarios. Wheel recovery observes the scrollbar reaching its bottom before checking the received completion marker: requested Playwright wheel pixels are normalized by browser DPR and xterm and do not imply a particular number of terminal rows. Synthetic touch cancellation and CSS touch-action assertions do not prove native browser pull-to-refresh behavior on a physical device.

`mobile/pad-file-gestures.spec.ts` checks desktop-UA touch file holds with a controlled clock: movement beyond tolerance and pointer cancellation do not open menus, a subsequent hold opens the archive action, a post-hold click preserves the menu, ZIP creation is observed through SFTP, and mouse right-click remains usable afterward. Synthetic pointer dispatch does not establish physical-device pointer capture or native scrolling behavior.

`mobile/pad-suspended-output.spec.ts` releases a real shell producer only after suspended ownership is available, generates 112MiB of either line logs or single-line output while detached, and checks bounded retained storage, the latest screen, original shell identity, input and historical dragging after browser recovery. It does not seed those bytes into a log file and does not establish an unlimited output-rate or long-duration suspend guarantee.

`mobile/pad-tui-redraw.spec.ts` uses a remote alternate-screen input loop to show old header/footer rows, Chinese wide characters and explicit true-color background cells before each viewport change. Independent full-screen and individual-row erase scenarios require a new frame marker and disappearance of the old text and colored DOM cells. These assertions cover rendered DOM state, not browser compositor pixels. The pipe-based SSH fixture accepts window changes without delivering real PTY SIGWINCH signals, so this does not validate signal-driven application redraw or explain intermittent rendering artifacts on physical Android devices.

Remote-desktop regressions exercise RemoteApp persistence, route-preserving RDP/VNC launch, clipboard exchange, DPI, fullscreen and pointer resize/minimize/restore through the shared window surface. Docker/layout and mobile-preview regressions use public pane controls, existing layout/session/task state and accessible document controls to verify remote commands, compact geometry, layout locking, PDF outline/pinch/panning, preview reset and upload hide/restore/cancellation.

`ssh/suspend-log-compaction.spec.ts` seeds a near-compaction-threshold log in the isolated fixture filesystem, then uses real SSH output and Workspace WebSocket handoff to cross the threshold, resume during continuing output, verify the original shell identity and confirm the physical log was compacted. It avoids sending a 100MiB seed through the terminal renderer and does not substitute a larger ownership lease for storage recovery.

CAPTCHA and proxy lifecycle coverage uses settings headings, form controls and management cards while retaining public-configuration secrecy and explicit credential-update assertions. Panel scaling and advanced mobile touch coverage uses rendered scale state, accessible menus/document actions and the real terminal surface to verify persistence races, archive creation, CodeMirror editing and virtual-keyboard escape sequences without production test markers.

Dashboard and mobile suspend/resume coverage targets host cards, public connection timestamps, tab semantics and suspend identifiers. It retains assertions for independent resource loading, persisted filters, catalog refresh, single-tab recovery, original-shell continuity and older-history touch scrolling.

Test support HTTP controls are limited to deterministic fixture setup and fault injection (for example remote file creation, artificial latency, or SSH availability). Test assertions use the Nexus HTTP/WebSocket/UI/ingress surfaces. Fake external services validate incoming requests directly and return success/failure instead of exposing captured internal request logs to specs.

The Agent preset flow also starts a dedicated real Chromium fixture with loopback CDP and an external context observation endpoint. A model-response barrier holds the Root Run after `browser_session_open`: the spec verifies a new Chromium context exists while the public Run status is `running`, then releases the response, verifies a successful terminal Run and successful tool result, and waits for context count to return to its baseline. A second Run is cancelled while its context is live: the test waits for public `cancelled` status and context reclamation before releasing the barrier, then executes a fresh Run in the same Thread and verifies successful creation, completion and reclamation. A bounded-budget Run reaches public `awaiting_budget` with a live context; versioned budget increase resumes it, the same context IDs remain present while the model response is held, and successful completion reclaims the context. The test restores the original settings after this scenario. Unique provider tool-call identities prevent earlier Thread history from satisfying a later Run's fixture state. This proves Root normal-completion, cancellation/recovery and budget-wait retention Browser behavior, not Child cleanup or late session creation races. The fixture owns only its own Chromium process; it never attaches to a user's browser. The remote launcher allocates isolated control and CDP ports alongside other fixture ports.

Functional/documentation screenshots are declared directly at real E2E checkpoints with `captureFunctionalScreenshot(page, filename)`. Screenshot capture remains opt-in for focused maintenance runs; the canonical E2E workflow does not mutate the repository or commit refreshed screenshots.

Browser approval-wait retention is exercised by opening a real context, proposing a bounded SSH command in `ask` mode, and observing public `awaiting_approval` status with that context still live. Denying or approving the versioned approval resumes the Run; the same context IDs must remain present until the held model response is released. Both branches verify successful completion and context reclamation. This Run's Ledger must contain successful Browser creation and either `APPROVAL_DENIED` or a successful SSH result with the exact fixture output `browser-approval-e2e`. These Root approval scenarios do not establish Child approval behavior.

Cancelling instead of deciding that pending approval must reach public `cancelled` and reclaim the real context. The original approval must become `superseded`; late approval requests using either its original version or its refreshed current version must return HTTP 409, and neither the cancelled Run nor its context may be revived. This exercises immediate terminal cancellation without an active scheduler cleanup fallback; cancellation events must traverse the existing StateCommit post-commit observer.

The budget-wait scenario also exercises cancellation rather than resumption: a live context at `awaiting_budget` must be reclaimed after public `cancelled`. Budget increases using both the pre-cancellation version and the current cancelled Run version must return HTTP 409, preserving the terminal status and context baseline. Current-version rejection distinguishes terminal-state protection from stale-version protection.

Child normal-completion coverage delegates to a profile explicitly granted `browser.read`, observes a real context while the Child model response is held, then releases completion and waits for a successful parent Run and context reclamation. The public Subagent record must contain exactly the expected completed Child with a Runtime distinct from its parent. The deterministic Child response projects its actual Browser tool result so the spec can associate the session's Run and Runtime identities with that public Child record and confirm successful creation. This proves Child-created context cleanup at parent Run completion, not cleanup immediately at Child completion while the parent remains active, or cancellation during session creation.

The same delegation flow also cancels the parent while the Child's real context is live and its model response remains held. Both public parent and Child statuses must become `cancelled`, and Chromium contexts must return to baseline before the fixture releases the response. This guards Root execution-slot handoff across model/tool rounds and join waiting: a cancelled Child alone does not satisfy the assertion when the parent remains `cancelling`. It covers cancellation after context creation, not cancellation during asynchronous session creation.

The isolated Runner harness additionally cancels a real HTTP Job whose two descendant levels ignore SIGTERM while the leader retains default termination behavior. Cancellation must reach public `cancelled`, both original descendant identities must stop executing, and a subsequent Job must succeed with exact stdout. This tests normal cancellation independently of restart recovery and does not claim cleanup of descendants that escape the inherited process group.

Creation-race coverage uses a loopback WebSocket proxy in the dedicated Chromium fixture. It forwards real CDP text frames and holds the response to `Browser.setDownloadBehavior`, after the context/page exists but before session registration completes. Separate Root and Child scenarios observe the held response and live context, cancel the parent Run, release the response, and require public `cancelled` plus context reclamation (and a cancelled Child for delegation). This covers that specific late-initialization window, not every asynchronous creation boundary or an independently cancelled Child while its parent stays running. A safety deadline releases abandoned fixture responses; successful assertions explicitly release them rather than relying on the deadline. No production testing endpoint is added.

Independent Child cancellation is exercised both with a live Browser context and with its final initialization response held. The parent explicitly calls `collaboration_subagent_join` and yields its runtime slot before the Child starts. The public versioned Subagent cancel endpoint must return a cancelled delegation without cancelling the parent. A separate provider response barrier observes the resumed parent still `running`; releasing it must allow successful parent completion with the Child still cancelled and Chromium contexts back at baseline. This verifies Root join parking and wake-up as well as final Run-owned cleanup, not immediate context reclamation while the parent remains active.

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

`ssh/reconnect-ui.spec.ts` also exercises hidden-page terminal consumption with animation-frame callbacks suspended and retained until visibility is restored. More than 1.2 MB of real SSH output must be acknowledged while hidden; on return the terminal must display the completion marker and accept input on the original shell without another Workspace connect. Hidden terminals use timer-based output batches with the existing byte threshold rather than relying on animation frames. This deterministic case does not simulate full browser process freezing, prove long-duration timer-throttling behavior, or cover every detached-view replay boundary.

Change coverage is counted by production change, not by test-case count. Mutation Origin/Fetch Metadata has eight HTTP cases and Webhook secret editing has seven HTTP cases plus its UI delivery flow; these represent two production changes, not fifteen.

The following mapping groups fifteen production changes with their behavioral E2E entrypoints. Acceptance requires the exact pushed revision's canonical Actions workflow to pass checks/format/build, all eight Playwright shards, and all three Docker smoke modes. Local results are preflight diagnostics only. A passing suite does not imply coverage of behaviors absent from these assertions.

| Production change                          | Behavioral coverage                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP mutation Origin / Fetch Metadata      | `http/mutation-origin.spec.ts`, `agent/provider.spec.ts`: matching public/direct Origins, denied foreign/opaque/path Origins, metadata rejection and unchanged settings                                                                           |
| Webhook secret header editing              | `http/webhook-secret-contract.spec.ts`, `ui/notification-settings.spec.ts`: redaction, preserve/replace/remove, rejected edits and actual outbound credentials                                                                                    |
| Effective Proxy credential validation      | `http/architecture-contracts.spec.ts`: password/key null or empty rejection, metadata atomicity, omission preservation and no credential reuse after switching to none                                                                            |
| SSH Key mutation audit                     | `http/architecture-contracts.spec.ts`, `http/ssh-key-audit-failure.spec.ts`: mutation audit actor/source and field names without credentials; rejected edit preserves state and emits no success audit, subsequent rename succeeds                |
| HTML theme content response isolation      | `ui/html-theme-security.spec.ts`: real direct navigation displays source, restrictive response headers and no script/localStorage side effect; remote upstream response remains outside this assertion                                            |
| Connection tag atomic replacement          | `http/architecture-contracts.spec.ts`: duplicates, invalid/oversized batches, missing targets, preserved associations and explicit empty replacement                                                                                              |
| Quick Command bounded tag batches          | `http/architecture-contracts.spec.ts`: duplicate IDs, raw oversized/invalid input rejection, no partial association and subsequent valid assignment                                                                                               |
| Active terminal theme deletion             | `http/architecture-contracts.spec.ts`, `ui/custom-terminal-theme.spec.ts`, `http/terminal-theme-deletion-isolation.spec.ts`: active reference cleared and visible fallback; inactive/repeated deletion preserves selected theme                   |
| Password-bound session invalidation        | `websocket/authenticated-session.spec.ts`, `ui/change-password.spec.ts`: established socket revoked, old HTTP session rejected and new-password login restores capability                                                                         |
| Logout revokes established WebSocket       | `websocket/authenticated-session.spec.ts`: live ping before logout, server closure, HTTP 401 and rejected new upgrade                                                                                                                             |
| Bounded Workspace binary read              | `ssh/binary-read-limits.spec.ts`: strict budgets, admission recovery, duplicate-ID ownership, pending-OPEN cancellation, in-place growth bounds and remote handle CLOSE on consumer disconnect before/after acquisition                           |
| Runner Journal fail-closed recovery        | `scripts/e2e/docker-deployment-smoke.sh`: malformed SQLite records fail twice with unchanged bytes and legacy JSON startup rejection; not a power-loss/disk-full simulation                                                                       |
| Archive cancellation exit evidence         | `ssh/protocol.spec.ts`, `ssh/progress-display-archive-cancel.spec.ts`, `ssh/archive-cancel-recovery.spec.ts`: remote exit evidence, task retirement, concurrent cancellation isolation, extraction round trip and missing-source failure recovery |
| Fresh SSH Shell listener rebinding         | `ssh/reconnect-ui.spec.ts`: outage/reconnect with fresh prompt and executable output under the same Workspace ID                                                                                                                                  |
| Cross-source credential trust confirmation | `ssh/progress-display-baseline.spec.ts`: Send Files requires public trust confirmation before real task submission and progress assertions                                                                                                        |

Webhook secret coverage reads redacted automatic/custom credential headers, preserves `null` secrets through a real UI save, replaces them, then removes their entries. Each stage sends a saved-channel test to a strict fixture receiver that checks actual outbound credentials without logging or retaining them.

Additional production-change mapping: SFTP upload pipelining and download prefetch (`847bb4f2`) is exercised by `ssh/upload-protocol.spec.ts`. With real remote WRITE/READ latency, the test requires bounded throughput and byte-identical full downloads, unaligned ranges, suffix ranges and open-ended ranges crossing prefetch windows through EOF. An out-of-bounds range must return 416 with the exact unsatisfied Content-Range, followed by a successful full download. Cancellation waits until multiple actual remote WRITEs are pending, then requires public cancelled state, remote writes draining to zero, temporary-file removal and preservation of an existing destination; a subsequent upload on the same Workspace must complete with exact bytes. This does not claim rollback of already committed uploads, a content snapshot under concurrent remote edits, or download-disconnect handle reclamation.

`ssh/download-network-profile.spec.ts` measures three samples per isolated SFTP READ profile: no added latency, 20/80/200ms response delays, shared 100/10/2Mbps response bandwidth and four concurrent downloads at 80ms. Each stream verifies length and SHA-256, disposes its HTTP response, and checks remote delivered bytes and pending READ settlement. Attachments include durations, per-stream/aggregate throughput, request count and peak pending requests. Comparisons require identical test harnesses; no universal speed threshold is inferred. Fixture response delay/rate shaping is not full network RTT, packet loss, TCP retransmission or browser-to-backend throttling.

`ssh/download-admission.spec.ts` fills all eight GET slots with fixture-confirmed pending OPENs, rejects excess authenticated and ticket requests with 429, and verifies HEAD at capacity. Aborting consumers must close all late-acquired handles, then eight downloads and the previously rejected ticket must return identical bytes. Resource CLOSE settlement is observed before subsequent sequential missing-file failures and recovery; neither remote CLOSE nor receiving Content-Length bytes alone establishes handler admission cleanup. Directory ZIP cancellation and other transfer phases are not covered by this case.

The Webhook case-collision regressions submit an explicit replacement and a differently cased `null` entry in both orders while removing custom secret classification. They require rejection before persisted mutation, no old secret in the response, unchanged redacted configuration and successful outbound delivery with the original credentials. Create and unsaved-test entrypoints also reject case collisions without persisting a channel. Mixed-case preservation with a single entry remains supported.

The Agent Provider fixture handles semantic handoff requests separately from normal tool scenarios, emitting all eight required sections. The installed-plugin continuation must complete successfully after retained Skill history triggers context compaction, before inline approval is exercised.

Provider discovery verifies both direct-backend and public-frontend same-Origin mutations, rejects a mismatched Origin, and rejects cross-site Fetch Metadata even with an otherwise matching Origin; all Agent rejections preserve the standard error envelope.

The SSH outage regression checks the fresh shell prompt and executable input after reconnecting the same logical Workspace ID; fresh connections replace ended-shell listeners and terminal replay/input state rather than reusing stale bindings.

The no-Workspace-tool fixture assertion is scoped to the latest user input too: subsequent Runs on the same thread can explicitly select SSH Hosts and request approval without inheriting the earlier no-target fixture scenario.

Runner Journal recovery validates existing records before write-capable initialization PRAGMAs; the Docker corruption smoke checks byte preservation across both failed startup attempts.

The full deployment smoke also invokes `tests/e2e/support/runner-kill-recovery.mjs`: an isolated host Runner executes a real HTTP Job that appends a marker and remains running, then is killed with SIGKILL. The Job spawns a Child and Grandchild; both must be live and inherit the Job's managed process group before the kill. Startup must durably mark that Job unknown, an identical Job request must not replay its side effect, and a new Job must complete with exact stdout. The recorded old Job PID must no longer exist after restart. Each descendant's PID/start-time identity must also disappear or reach a dead state; an orphan zombie awaiting host init reaping is not treated as a running process. This covers two levels of inherited process-group descendants, not processes that escape into a new session/group. A second restart preserves both terminal records and the single marker. The Workspace is seeded with an empty toolchain fixture; this does not cover installation/provisioning, power loss, disk-full failures or Backend restart recovery.

Send Files regression coverage accepts the public credential-transfer trust confirmation before checking task submission, while keeping the held initial-list race and independent form-loading assertions.

Skill fixture scenarios are selected from the latest user input, not retained historical scenario markers; initial metadata-only exposure and explicit `skill_read` body checks remain enforced.

Docker deployment smoke injects an invalid record into the current SQLite Runner Journal, checks fail-closed startup twice, and verifies the journal bytes remain unchanged as recovery evidence.

The SSH exec fixture handles supported SSH signal requests against its command process group and reports actual exit status or exit-signal. Archive cancellation checks require remote exit evidence rather than channel closure alone.

The direct archive cancellation/recovery regression waits for a real held compression process to start before cancellation. On the cancelled terminal event it requires that process to have exited, checks the retired task no longer accepts cancellation and the held destination does not exist, then completes a subsequent compression and checks its output metadata. This does not establish rollback for archives that have already written partial output.

The concurrent archive regression starts two held commands in one Workspace, cancels only one and requires the other process to remain alive. After releasing the hold it checks the second archive completes, removes the unique source fixture, decompresses the surviving archive and compares the restored bytes exactly. Cancellation isolation is not inferred from progress UI or file existence alone.

The missing-source archive regression requires a failed terminal event, retirement of the old cancellation handle and absence of the requested destination, then verifies a subsequent compression completes and returns a ZIP header through binary read. The header check is not a full archive integrity check; the concurrent regression above supplies an extraction round trip.

Direct Workspace binary-read regressions require a numeric safe-integer `maxBytes` ceiling and reject coercible strings, booleans and arrays. Delayed real SFTP reads fill all four admission slots, reject a fifth read, then cancel every admitted read and verify four subsequent reads return identical bytes. A duplicate request-ID regression verifies that rejecting the duplicate preserves the original read's cancellation handle and confirms its aborted result before a successful subsequent read. Three batches of four missing-file reads verify stream-acquisition failures release admission, followed by four successful byte-identical reads. A fixture-confirmed pending SFTP OPEN is cancelled before its delayed reply; the read must abort, retire its cancellation handle and allow four successful byte-identical reads afterward. The growth regression appends to the same fixture file after a confirmed delayed SFTP READ: the existing read returns only its original size-bounded range, reopening with the old budget fails with a size-limit error, and reopening with the exact new budget returns all bytes. This does not promise a content snapshot for concurrent edits; other concurrent edit races remain outside these assertions.

The pending-OPEN disconnect regression confirms the fixture received SFTP OPEN before closing the Workspace WebSocket, then requires one additional read-only handle open and one additional successful SFTP CLOSE. It covers delayed acquisition after consumer disconnect, not SSH transport loss, channel shutdown cleanup or all remote handle lifecycles.

The pending-READ disconnect regression confirms the read-only handle is already open and not yet closed, and the fixture has received a delayed SFTP READ. Closing the consumer WebSocket must then produce a successful remote CLOSE for that handle. A new Workspace on the same SSH connection must also read a unique fixture back byte-for-byte. Together these two regressions cover consumer disconnection before and after acquisition; they do not establish cleanup under SSH transport loss or reconnection of the same Workspace.

The suite intentionally keeps regression tests for previously fixed production issues, including:

- quick-command tag batches reject missing command references in either order and missing tags with 404 / `QUICK_COMMAND_TAG_REFERENCE_NOT_FOUND`, leave no partial associations and permit a subsequent valid assignment;

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
- password-change coverage uses the Security heading, associated password labels and named submit action to verify local validation, rejected current credentials, cleared inputs, old-session rejection and real login with the changed credential before restoring the test account;
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

When adding, moving, grouping, or optimizing tests, follow [AGENTS.md](../AGENTS.md) and verify observable behavior described in [USAGE](../USAGE.md).

`specs/ssh/upload-protocol.spec.ts` includes an 8MiB upload/download latency regression with 60ms SFTP read/write delay, completion-time budgets, byte equality and an unaligned HTTP Range. Timing attachments record actual durations; this is a pipeline regression check, not a real-network bandwidth guarantee. The new case has not yet been verified successfully because the local E2E environment had an occupied service port.
