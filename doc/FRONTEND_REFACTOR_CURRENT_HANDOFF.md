# Nexus Terminal Frontend Refactor — Current Handoff

> Updated: 2026-09-04
>
> This document is the current execution handoff for the frontend rewrite. It complements, rather than replaces, `packages/frontend/REFACTOR_STATUS.md` and the architecture documents. A new session should read this file first, then the authoritative architecture and Git-derived requirement documents listed below.

## 1. Execution scope and hard decisions

Current execution scope is **the old frontend rewrite only**. Do not start Agent work yet.

The user-approved order is:

1. Discover requirements from the complete old frontend Git history and final old baseline.
2. For each behavior, inspect the final old implementation.
3. Decide whether the old implementation is structurally sound or should be redesigned.
4. Adjust the current architecture immediately when ownership/lifecycle/state boundaries are wrong.
5. Re-implement the behavior in the current architecture without restoring old mega-stores or compatibility paths.
6. Pass architecture/i18n/TypeScript/build gates for meaningful slices.
7. Only after frontend behavior is complete: finish clean HTTP contract migration.
8. Delete backend HTTP/WS compatibility directories.
9. Run final static/build gates.
10. Only then run the repository's existing E2E suite.

### Non-negotiable implementation rules

- **Do not add tests.** No new unit/component/integration/internal tests, helpers, dependencies or CI jobs.
- Do not run Playwright/E2E during the rewrite. Existing E2E is behavioral reference only until final validation.
- Do not restore old root `components/`, `stores/`, `composables/`, `views/`, `types/` or `utils/` compatibility architecture.
- Do not use old selectors/DOM shape as product contracts.
- Functionality is currently prioritized over bundle-size trimming. Do not remove a capability just because it increases output size.
- Requirement discovery remains open. **The old 123 FR entries are not the maximum requirement set.**
- Git-derived requirements (`GREQ`) are the execution-level requirement units and may continue to grow.
- Do not remove a discovered capability during requirement discovery merely because it looks redundant. Mark it `REVIEW` first; implementation duplication may be consolidated, but user capability must not be silently removed.
- Same business state/capability must have one owner and one implementation.
- Workspace/Agent are orchestration owners, not capability owners.
- Raw transport belongs to `client`; protocol mapping belongs to Interface/runtime adapters; feature UI must not know concrete WebSocket protocol.
- Prefer public APIs. Current xterm `_core` private API usage remains zero and should stay that way.

## 2. Repository / baseline / backup

Repository:

```text
/home/agentdock/AgentDock/nexus-terminal
```

Branch:

```text
test/agent-runtime-foundation
```

Old/refactor baseline HEAD:

```text
b6ef2955fb9b476122bf8901b502569bb7921f29
```

Primary backup:

```text
/home/agentdock/AgentDock/_backups/20260903-nexus-frontend-clean-skeleton/
```

Old frontend extracted reference used during this work:

```text
/tmp/nexus-old-frontend/packages/frontend/src
```

Do **not** use `git reset --hard` and do not wholesale restore the old frontend.

## 3. Required reading in a new session

Read in this order:

1. `doc/FRONTEND_REFACTOR_CURRENT_HANDOFF.md` — this file.
2. `packages/frontend/REFACTOR_STATUS.md` — persistent phase ledger.
3. `doc/ENGINEERING_CONSTRAINTS.md` — repository constraints.
4. `doc/architecture/FRONTEND.md` — authoritative frontend architecture.
5. `doc/architecture/FRONTEND_DEPENDENCY_ANALYSIS.md` — old dependency/cycle analysis.
6. `doc/architecture/FRONTEND_MIGRATION_MANIFEST.md` — old source to new owner mapping.
7. `doc/architecture/FRONTEND_REFACTOR_PLAN.md` — migration plan/reference.
8. `doc/architecture/BACKEND_REFACTOR_REPORT.md` — backend boundaries.
9. `doc/LEGACY_FRONTEND_FUNCTIONAL_REQUIREMENTS.md` — readable product requirement baseline.
10. `doc/LEGACY_FRONTEND_GIT_HISTORY_AUDIT.md` — complete Git history audit ledger.
11. `doc/LEGACY_FRONTEND_GIT_REQUIREMENT_CATALOG.md` — execution-level Git-derived requirements.

## 4. Git history / requirement-discovery status

### Git audit coverage

The full old frontend runtime audit scope is:

```text
packages/frontend/src
packages/frontend/public
packages/frontend/index.html
```

At the baseline above:

- **1033 / 1033 runtime commits are in the audit ledger.**
- The final-old runtime reverse-coverage matrix reached **170 / 170 files, unmapped = 0**.
- Dead/superseded states are explicitly separated from final reachable product behavior.
- `doc/LEGACY_FRONTEND_GIT_HISTORY_AUDIT.md` is the historical evidence ledger.

This does **not** mean requirement discovery is frozen. Commit coverage and requirement granularity are different things.

### Current requirement layers

`doc/LEGACY_FRONTEND_FUNCTIONAL_REQUIREMENTS.md`

- readable, larger-grained product requirements;
- approximately 1096 lines;
- useful for product overview but **not an execution ceiling**.

`doc/LEGACY_FRONTEND_GIT_REQUIREMENT_CATALOG.md`

- execution-level `GREQ-*` entries;
- currently **53 GREQ entries**;
- currently covered domains include:
  - Auth / Login / Security;
  - Connections;
  - Tags / Quick Command Tags;
  - Proxies;
  - SSH Keys;
  - Quick Commands / Command History;
  - Notifications / Audit / Backup / About;
  - Preferences / Appearance;
  - Terminal;
  - Filesystem / File Manager has started.
- GREQ count is expected to continue growing as further domains are checked commit-by-commit/final-baseline-by-final-baseline.

### Correct requirement workflow

For each domain:

```text
Git evidence
    ↓
final old frontend implementation
    ↓
extract actual user-visible behavior / edge semantics
    ↓
review old implementation quality
    ↓
adjust current owner/lifecycle/architecture if needed
    ↓
rewrite under current architecture
    ↓
static/build gates
    ↓
record GREQ status and continue
```

Do not infer a requirement only from a historical filename or stale store field. Do not discard a capability only because the final old UI emphasized another path; retain uncertain historical capability as `REVIEW` until the complete pass resolves it.

## 5. Current frontend architecture

Target source shape:

```text
packages/frontend/src/
├── app/
├── assets/
├── workers/
├── foundation/
├── shared/
├── client/
├── features/
└── runtimes/
    ├── workspace/
    └── agent/
```

Dependency direction:

```text
foundation
   ↑
shared                 client
   ↑                      ↑
feature model / ports     |
   ↑                      |
feature api/state/composable
   ↑
feature components
   ↑
workspace runtime / agent runtime
   ↑
app pages / shell / bootstrap
```

Hard constraints remain:

- `client` does raw transport only.
- feature → app is forbidden.
- feature → runtime is forbidden.
- cross-feature imports use public surfaces only.
- Workspace and Agent internals remain separate.
- runtime consumes feature public surfaces and supplies capability adapters.
- lower-level feature never owns the live Workspace socket/session.
- dependency graph must remain acyclic.

## 6. Major architecture corrections already made during behavior restoration

The rewrite has deliberately changed architecture when old or early-refactor ownership was wrong.

### Workspace session lifecycle

`WorkspaceRuntimeSession` now owns only runtime-lifetime resources/references:

- Workspace socket and lifecycle;
- capability adapters;
- reconnect state;
- suspend mark state;
- per-session command draft;
- references to feature-owned session controllers.

It does **not** duplicate feature business state.

### Feature controllers moved to correct lifetimes

Per Workspace session:

- `TransferController` lives with `WorkspaceRuntimeSession`;
- File Editor controller lives with `WorkspaceRuntimeSession`;
- File Preview controller lives with `WorkspaceRuntimeSession`;
- Filesystem session state lives with `WorkspaceRuntimeSession`.

Registry-level/shared resources:

- shared File Editor controller lives with the Workspace registry;
- cross-session File Clipboard controller lives with the Workspace registry.

This fixed route-unmount bugs where the SSH session stayed alive but editor/preview/filesystem state disappeared.

### Filesystem owner cleanup

Embedded and popup FileManager presentations now share one session filesystem state:

- cwd;
- entries;
- selection;
- sort/search;
- path-history navigation side effect.

UI mounting no longer decides filesystem business lifetime.

### Command draft ownership

Desktop and mobile Command Bars bind the same `WorkspaceRuntimeSession.commandDraft`.

The draft survives pane switches/route presentation changes without being copied into a global mega-store.

### Transfers ownership

- transfer task state remains in Transfers feature controller;
- route/UI unmount does not orphan tasks;
- adapter transfer listeners follow Workspace session lifetime;
- cross-session copy/move uses target session's single TransferController;
- File Clipboard stores only source intent/generation;
- cross-session Cut waits for copy completion, then removes source;
- source-delete failure becomes truthful partial completion rather than rolling back a successful target copy.

### Suspend ownership

- live `marked` state remains runtime-owned;
- backend suspended catalog contains actual handed-off sessions only;
- SSH Suspend feature composes marked/hanging/disconnected presentation without contaminating clean backend protocol;
- `suspend.autoTerminated` clean WS event is mapped through runtime into feature-owned catalog state and deduplicated.

### Settings / secret ownership improvements

- Auth does not import Workspace runtime; App composition cleans Workspace sessions on logout.
- Notification secret preservation moved into Backend `NotificationSettingsService`; frontend no longer reads old SMTP/bot secrets and resubmits them.
- Connection credential legality remains Backend `ConnectionCredentialService` authority; frontend provides clearer intent/early validation.

## 7. Major product behavior restored/refactored so far

This is not exhaustive; GREQ catalog is authoritative for completed fine-grained items.

### Auth / Security

- setup → login boundary;
- password + 2FA flow;
- discoverable and username Passkey login;
- CAPTCHA first-factor lifecycle/reset behavior;
- CAPTCHA secret preservation;
- logout → Workspace runtime cleanup via App composition.

### Connections

- CRUD/test/clone;
- search including port;
- tag filter/sort persistence;
- Test All / Connect All;
- Jump Chain;
- proxy routing;
- RDP/VNC/RemoteApp;
- script mode and IP-range batch creation;
- truthful partial success;
- batch edit/delete settled outcomes;
- explicit auth-mode intent;
- Saved SSH Key and Direct Private Key/passphrase capabilities retained behind explicit key-source choice;
- Workspace connection grouping and keyboard navigation.

### Tags / Proxy / SSH Key

- generic TokenInput keyboard behavior;
- tag create/select/backspace/local-remove/global-delete;
- Connection tags and Quick Command tags remain separate owners;
- proxy blank-password preserve / explicit clear / new-password mutual exclusion;
- SSH key rename/private-key replacement/passphrase-only update;
- stale selected SSH key is cleared after catalog mutation;
- old unnecessary decrypted-private-key edit fetch is not restored.

### Quick Commands / History

- CRUD/search/tags/grouping;
- inline tag rename;
- Untagged → create tag + bulk assign with partial-outcome reporting;
- variable substitution;
- execute current/all;
- usage accounting no longer blocks command execution;
- usage endpoint returns authoritative updated metadata;
- compact/display modes;
- copy/send-all/context actions;
- Command History only records actual successful current-session normal command sends;
- Send All / Ctrl+C / empty Enter do not pollute history;
- history mutation queue recovers after an individual failure.

### Notifications / Audit / Backup / About

- Webhook/Email/Telegram complete configuration;
- saved vs unsaved notification test semantics;
- SMTP/Telegram secret preservation in Backend Module owner;
- Audit draft → Apply → applied-query behavior;
- numbered pagination and raw-details resilience;
- full encrypted backup import/export;
- independent Connections ZIP export;
- Backend `Content-Disposition` filename parsing;
- import reloads application state;
- About/version/release check.

### Preferences / Appearance

- unified Preferences owner instead of legacy settings mega-store;
- complete timezone list and localized language names;
- terminal scrollback `0` means runtime default 5000, positive values capped at 100000;
- Appearance settings/runtime application;
- UI theme field editor + raw JSON editor;
- Terminal theme field editor + raw JSON editor;
- preset Terminal Theme Edit-as-Copy;
- Terminal/HTML theme lists sorted by name;
- background assets/custom HTML/text stroke/text shadow;
- desktop/mobile font settings;
- PWA/window theme color.

### Terminal / Workspace behavior already restored before current pending setting change

- raw clean Workspace terminal stream;
- output pre-mount buffering;
- search;
- Ctrl/Cmd+Shift+C/V;
- desktop right-click selection copy vs no-selection paste behavior;
- mobile long-press selection handles/menu;
- Ctrl+wheel and mobile pinch font scaling;
- disconnect interaction can interrupt reconnect backoff;
- empty Enter reconnect path;
- command input first-handshake readiness boundary;
- layout/pane/mobile Workspace composition;
- multiple session tabs and reorder/context operations;
- Suspend mark/unmark/resume lifecycle.

### File / Transfer / Editor / Preview behavior substantially restored

- favorites/path history including inline history dropdown;
- keyboard navigation and remote drag-to-move;
- symlink target handling;
- external file/directory drop upload, including empty files/directories;
- no per-chunk application ACK upload pacing; bounded browser/server backpressure instead;
- upload conflict handling;
- cross-session File Clipboard Copy/Cut/Paste;
- Send Files multi-server/tag grouping and server task polling;
- archive format/password/cancel/progress;
- File Editor encoding, line ending, refresh, per-tab scroll, context bulk close, Monaco save and mobile CodeMirror behavior;
- PDF/XLSX/DOCX/Image/Markdown preview lifecycle/search/scroll behaviors;
- Shared Progress Display and derived aggregate transfer speed.

## 8. Clean WebSocket status

New frontend Workspace already uses the clean Backend WebSocket Interface.

Paths:

```text
/ws/workspace
/ws/uploads
/ws/remote-desktop
```

Clean request/event examples:

```text
workspace.connect
terminal.input
terminal.resize
filesystem.*
transfer.*
upload.*
status.*
docker.*
suspend.*
```

Terminal output is raw binary. Upload uses raw binary on the dedicated upload WebSocket. Historical terminal/upload envelope framing is not used by the new runtime.

Backend `interfaces/websocket/legacy-api/` has been deleted after production imports reached zero. The WebSocket server now has only the clean Workspace/upload/remote-desktop protocol owners.

## 9. Clean HTTP migration status

HTTP clean migration is **complete** on the current worktree.

- frontend HTTP feature APIs consume clean camelCase Nexus DTOs directly;
- Backend HTTP Interfaces validate/map transport and redact response secrets where required;
- Auth/Security/Connections/Tags/SSH Keys/Proxies/Notifications/Audit/Quick Commands/Favorites/Appearance/Terminal Themes/Settings/SSH Suspend have no historical Nexus wire mapper dependency in the frontend;
- persistence-specific SQL row/column names are isolated in Infrastructure repositories/storage rather than exposed by Module public models or HTTP DTOs;
- the duplicate unconsumed `/settings/appearance` surface was removed so Appearance has one HTTP owner;
- `packages/backend/src/interfaces/http/legacy-api/` was deleted after production imports reached zero.

The remaining boundary is final latest-worktree static/build validation, not further compatibility migration.

## 10. Latest verified static/build state

The compatibility-deleted, contract-clean worktree has passed the complete pre-E2E gate set. Because this handoff/status update changes tracked documentation, the same full gate set is rerun once more after these records are written; only that latest frozen-worktree rerun is final evidence.

Current pre-rerun result:

```text
format / format:check: PASS
check:test-policy: PASS — 65 existing E2E spec files, policy clean
Frontend architecture: PASS — 253 source files, no forbidden dependency cycles
I18n: PASS — 1686 keys across 3 locales in 81 fragments
vue-tsc --noEmit: PASS
Backend architecture: PASS — 218 files, no forbidden layer/source/module cycles
Backend tsc --noEmit: PASS
git diff --check: PASS
Frontend production build: PASS — 1817 modules transformed
Backend production build: PASS
Remote Gateway production build: PASS
```

Frontend build still has only the deferred session chunk warning at about **4,874.18 kB minified / 1,445.30 kB gzip**. Backend still has only the known local Node 22 vs package `>=24` engine warning. No E2E has run on this final contract-clean worktree yet.

`find` may report a slightly different raw TS/Vue file count than the architecture guard; use the architecture guard's count as the canonical source count for validation reporting.

## 11. Terminal preference migration — COMPLETE

The user-directed Terminal setting change is now implemented and verified against Git history and the final old frontend.

Historical/final-old evidence:

- `978aa942` introduced `terminalEnableRightClickPaste`, default ON;
- final-old settings still carried `autoCopyOnSelect`, default OFF;
- `9f6597ce` changed final right-click behavior to:
  - selection present → copy, clear selection, focus terminal;
  - no selection → paste through xterm and focus terminal.

Current clean behavior:

```text
terminalRightClickCopyPaste
```

- default is `true`;
- desktop right-click with selection copies, clears selection and refocuses;
- desktop right-click without selection pastes through xterm semantics and refocuses;
- disabled means the app does not take over desktop right-click;
- mobile keeps its dedicated long-press selection/clipboard path;
- automatic copy-on-selection has been removed completely.

Compatibility is owned only by versioned Backend Settings migrations:

- v1 renames `terminalEnableRightClickPaste` to `terminalRightClickCopyPaste` without overwriting an already-present new value;
- v2 removes `autoCopyOnSelect`;
- v3 removes the older `clearFileEditorTabsOnClose` cleanup key.

`settings_migrations(version,name,applied_at)` is independent from SQL schema migration history. Each settings patch and migration-history row commit in one database transaction. Backup includes the settings migration table; restoring an older backup without history produces version 0 and reruns the migration chain during `SettingsService.ensureDefaults()`.

Production-code legacy-key sweep is clean: old Terminal setting names remain only inside migration definitions.

## 12. Terminal GREQ review — COMPLETE

The remaining Terminal review items from the previous handoff were checked against the final old implementation and are now implemented under the clean owners:

1. xterm initialization preserves `convertEol=true`, `scrollOnUserInput=true`, stable block cursor and transparency.
2. OSC 11/111 background protection is implemented with public xterm parser APIs; OSC 11 query remains available. No `_core` usage exists.
3. Mobile long-press/touch selection is independent from the removed auto-copy behavior.
4. Resize traffic is de-duplicated when effective rows/columns do not change.
5. `TerminalSessionState` is retained by `WorkspaceRuntimeSession` for the Workspace-session lifetime so pane remounts do not own session state.
6. Terminal snapshot serialization is bounded to roughly 1 MiB, keeps up to roughly 1000 scrollback lines, drops older history first and has a plain-text fallback.
7. The Workspace terminal adapter buffers output while no TerminalView output handler exists and replays it when the next presentation mounts.
8. `WorkspaceLayoutRenderer` watches the actual Terminal ref and emits replacement/null APIs across mount transitions so mobile tools and suspend do not intentionally retain a disposed component API.
9. Real terminal interaction can interrupt reconnect backoff after a session has previously connected; first-handshake readiness remains protected.

No legacy Session mega-store or event bus was restored.

Terminal slice validation at this checkpoint:

- `npm run format` / `npm run format:check` — PASS;
- `npm run check:test-policy` — PASS;
- frontend architecture — PASS, 254 source files, no forbidden dependency cycles;
- frontend i18n — PASS, 1684 keys × 3 locales in 81 fragments;
- `vue-tsc --noEmit` — PASS;
- `npm run build:frontend` — PASS;
- backend architecture — PASS, 232 files, no forbidden layer/source/module cycles;
- backend production build — PASS;
- `git diff --check` — PASS.

The Vite large-chunk warning remains intentionally deferred to the later size-review phase. No tests were added and no E2E was run.

## 13. GREQ domains still to continue after Terminal

Continue systematically rather than jumping to HTTP migration.

Filesystem / File Manager is now closed through `GREQ-FS-013` for the current Git/final-old pass:

- recursive search uses a distinct `FileSearchEntry.relativePath` model, 250 ms debounce, stale query/root rejection, truncation feedback and active-search refresh;
- large directory/search results virtualize above 250 rows with 12-row overscan while full logical selection/sort/keyboard state remains intact;
- Terminal/File Manager cwd coordination is split out of `FilesystemChannel` into the narrow `TerminalDirectoryPort`; Workspace adapter correlation now waits for verified shell completion and exposes queued/waiting state without leaking protocol names;
- empty-directory parent navigation, live action recovery after session/reconnect/non-fatal errors and narrow-pane control reachability were rechecked against final-old fixes and are already preserved by the clean design.

Filesystem slice validation is **PASS**: format check, frontend architecture, i18n, Vue typecheck, full Vite production build and `git diff --check`. The existing large-chunk warning remains deferred by policy.

Transfers / Upload / Archive / Send Files / Progress is now closed through `GREQ-XFER-006` for the current Git/final-old pass:

- uploads preserve exact bytes/relative paths/zero-byte files, prepare directory trees, keep conflicts explicit, use bounded isolated `/ws/uploads` streams with adaptive weighted/fair active-file scheduling, and abort incomplete data transports cleanly;
- main Workspace disconnect pauses unfinished uploads, closes stale data streams, replays directory preparation after reconnect and restarts unfinished files from byte zero; a dedicated upload-stream failure while control remains healthy is a real file failure, not a fake Workspace reconnect;
- copy/move uses event-driven long-task completion, cross-Workspace cut remains copy-then-delete with partial outcome on source-delete failure, cancel request transport IDs are separated from business task IDs, and non-replayable operations fail explicitly on Workspace disconnect;
- archive keeps temporary-output cleanup, valid-warning preservation, Unicode ZIP extraction and typed password-required/invalid-password retry; cancellation remains correlated to the real Backend task lifetime;
- progress state is session-owned rather than pane-owned, hidden sources can be restored centrally, new work resurfaces automatically, and the unified progress window retains drag/resize/viewport-safe behavior;
- Send Files remains a distinct connection-ID-keyed HTTP background-task owner with tag-grouped SSH targets, auto/rsync/scp selection, central polling/cancel/remove and automatic progress opening after initiation.

Transfers slice validation is **PASS** on its closed checkpoint: `npm run format` / `format:check`, `check:test-policy`, frontend architecture/i18n/Vue typecheck/root production build, backend architecture/root production build, remote-gateway production build and `git diff --check`. That checkpoint reported 254 frontend source files and 1685 i18n keys × 3 locales in 81 fragments. The existing >3 MB Vite chunk warning remains deliberately deferred. Backend build on the current host reports only the known Node 22 vs package `>=24` engine warning and still exits successfully. No tests were added and no E2E was run.

File Editor is now closed through `GREQ-EDIT-004` for the current Git/final-old pass:

- opened documents retain the raw byte snapshot and decoded baseline; encoding changes reinterpret the same bytes locally, while explicit Refresh is the only remote reread path;
- editor-facing encoding labels are canonicalized across UTF-16 and legacy iconv aliases, save preserves the chosen encoding, line-ending conversion participates in the same dirty baseline, and undoing back to the baseline clears modified state;
- shared-vs-session editor ownership remains in the clean File Editor/Workspace runtime owners, live `shareFileEditorTabs` changes switch controller ownership without a remount, shared tabs retain source scope identity/label, and Workspace removal closes that scope;
- popup backdrop dismissal is hide-only while the explicit close action clears the relevant editor/preview cache; the close action is reachable in mobile full-screen presentation;
- desktop Monaco restores final-old `vs-dark`, minimap, save shortcut, per-tab scroll and Foundation Ctrl-wheel 8–40 scaling persisted through Appearance; desktop popup dimensions remain browser-local with viewport-safe minimums;
- mobile CodeMirror retains search/language/history/folding/bracket/autocomplete/pinch behavior and keeps active-line highlighting without the historically removed active-line gutter highlight.

File Editor slice validation is **PASS** on the frozen Editor worktree: format/format-check, test-policy, frontend architecture/i18n/Vue typecheck, backend architecture, `git diff --check`, root frontend/backend/remote-gateway production builds. Current frontend count is **255 source files** and **1685 i18n keys × 3 locales in 81 fragments**. The first frontend root build was intentionally aborted before compilation because `npm ci` hung after an npm audit request failure; the same root `npm run build:frontend` then passed with `npm_config_audit=false`. Vite still reports the deferred >3 MB chunk warning. Backend still has only the known Node 22 vs package `>=24` engine warning. No tests were added and no E2E was run.

File Preview is now closed through `GREQ-PREVIEW-005` for the current Git/final-old pass:

- provider eligibility and inline-size limits remain File Preview owned; remote SVG is again excluded, Markdown uses the final restricted DOMPurify profile, and image loading/failure feedback is restored without reviving the old global provider registry/prewarm owner;
- `FilePreviewSessionController` owns per-session tab/source/operation lifetime with AbortSignal/token stale-result suppression and non-destructive refresh; Foundation `OverlayPanel`/`BaseModal` now owns generic Escape/focus-on-open/restore-focus semantics, while Workspace owns only popup hide-vs-explicit-close and Preview → Editor composition;
- non-popup Preview close now actually hides the preview presentation by returning to Editor while preserving tabs; active preview tabs auto-scroll into view and mobile tab/toolbar/search controls restore the late touch-target behavior from `30c4a6fd`;
- Spreadsheet uses a File Preview model parser over the real worksheet range with formatted cell text, bounded settings, explicit workbook dimensions, pagination, row numbers, first-page-only header styling, capped cross-sheet all/active search, keyboard navigation and the dedicated horizontal scrollbar;
- PDF retains lazy continuous page rendering but restores the final measured-page pending-jump state machine, hidden/unmeasured-page filtering, hide/reveal anchoring, PageUp/PageDown, exact repeated-occurrence search, desktop/mobile outline synchronization, fit/zoom/pinch and touch-safe toolbar behavior;
- DOCX restores the intentional non-default page-break/resource options (`ignoreLastRenderedPageBreak=false`, `useBase64URL=true`), loading/localized failure feedback, refresh rerender, exact search and horizontal navigation.

File Preview slice validation is **PASS** on the frozen Preview worktree: `npm run format` / `format:check`, `check:test-policy`, frontend architecture/i18n/Vue typecheck, backend architecture, `git diff --check`, and root frontend/backend/remote-gateway production builds. That checkpoint reported **256 source files**, **1685 i18n keys × 3 locales in 81 fragments**, and 1817 transformed modules. The existing >3 MB session chunk warning remains deliberately deferred. Backend still reports only the known Node 22 vs package `>=24` engine warning and exits successfully. No tests were added and no E2E was run.

Status Monitor is now closed through `GREQ-STATUS-004` for the current Git/final-old pass:

- Status current/error/history is owned by one Status feature session controller retained by `WorkspaceRuntimeSession`; desktop pane and mobile modal attach as ref-counted consumers, share one aligned 1800-sample sequence history, stop Backend polling only after the last consumer detaches and resume active sampling after real reconnect/resume without restoring the old singleton Session store;
- `StatusChannel` exposes parameterless `start()` / `stop()` because Settings/Backend owns the interval; an interval preference change restarts an active sampler so Backend re-reads Settings, while Status start/stop transport failures remain local Status errors rather than failing the Workspace connection;
- frontend Status units now match the Backend collector contract: memory/swap MiB, disk KiB and network bytes/second. Feature-owned formatters restore used/total details, adaptive network units, interface identity, CPU/OS details and optional copyable host/IP;
- history chart windows are sequence/sample-count based, completed buckets stay fixed, percentage buckets average, network buckets keep maxima, the nice/hysteresis network axis is preserved, and chart tick/tooltip/theme colors update from live UI theme variables;
- responsive behavior is pane/container based rather than viewport based. Low-height panes degrade range controls and switch to a compact resource/network summary at the final extreme-height threshold; mobile uses the same session controller in a bounded Foundation modal with an explicit touch-sized close action; shared Ctrl-wheel scaling remains 0.65–1.6 and persists through the existing latest-value Preferences saver.

Status slice validation is **PASS**: `npm run format` / `format:check`, `check:test-policy`, frontend architecture/i18n/Vue typecheck, backend architecture, `git diff --check`, and root frontend/backend/remote-gateway production builds. Frontend currently reports **257 source files**, **1685 i18n keys × 3 locales in 81 fragments**, and **1819 transformed modules**. The Vite session chunk warning remains deliberately deferred (about 4.86 MB minified / 1.44 MB gzip). Backend still reports only the known Node 22 vs package `>=24` engine warning and exits successfully. No tests were added and no E2E was run.

Docker is now closed through `GREQ-DOCKER-004` for the current Git/final-old pass:

- one Docker-owned session controller retained by `WorkspaceRuntimeSession` owns availability, container snapshot, expansion/default-first-load state, demand-driven consumer count, polling timer and stale-request generation; presentation detach stops polling while preserving state, whereas real Workspace disconnect clears Docker runtime state and active consumers resume after reconnect;
- the historical `dockerStatusIntervalSeconds` requirement is live again: the Preferences-owned value is the actual client polling interval. This intentionally fixes the late `e745e176` regression where Backend polling was removed but a hard-coded 15-second frontend safety interval left the visible setting ineffective;
- the clean Backend Workspace WebSocket Interface now maps Platform Docker CLI-shaped `Names/Image/State/Ports/CPUPerc/...` objects to the frontend camelCase DTO boundary. Bulk status carries running-container CPU, memory, network I/O, Block I/O and PIDs; the separate stats capability remains available but does not create another polling owner;
- start/stop/restart/remove run through the Docker capability and perform one post-command refresh; remove remains available for running containers through Backend `rm -f`; Enter/Logs stay terminal-command intents composed by Workspace, with stopped-container Logs reachable and no duplicate Docker shell protocol/event bus;
- Docker presentation is a named pane-size container: wide table/detail rows switch to labeled cards at <=600px and collapse further at <=320px. Workspace supplies only lifecycle presentation state/message, preserving connecting/reconnecting/disconnected/error/loading/unavailable/fetch-error/empty states and coarse-pointer action reachability.

Docker slice validation is **PASS**: format/format-check, test-policy, frontend architecture/i18n/Vue typecheck, backend architecture, `git diff --check`, and root frontend/backend/remote-gateway production builds all pass. Frontend currently reports **257 source files**, **1686 i18n keys × 3 locales in 81 fragments**, and **1820 transformed modules**. The deferred Vite session chunk warning is about 4.87 MB minified / 1.44 MB gzip. Backend still reports only the known Node 22 vs package `>=24` engine warning and exits successfully. No tests were added and no E2E was run.

Remote Desktop is now closed through `GREQ-RDP-004` for the current Git/final-old pass:

- Guacamole session state remains feature/modal-lifetime rather than Workspace-session state. A connect generation rejects stale token/session results after close or connection replacement, errors clean the failed client while preserving retry presentation, reconnect is non-overlapping, and `RemoteDesktopSessionPort` is now the sole frontend session-creation owner after removing duplicate unused Connections API methods;
- final desktop pointer/focus/clipboard behavior is restored: scaled mouse forwarding, browser cursor hide/restore over the remote surface, raised Guacamole cursor layer, display-focus recovery after local controls, host-to-remote clipboard synchronization and remote plain-text clipboard handling. VNC keeps the explicit text-send control while local field focus suppresses direct remote keyboard forwarding;
- final RDP mobile behavior is preserved through browser-local `nexus.rdp.touch-mode`, direct/touchpad Guacamole translators, the final 300 ms / 12 px tap recognizer, synchronous hidden-keyboard focus and IME-safe composition handling. Touch/input listeners are destroyed on client replacement/close;
- Remote Desktop uses raw Foundation `OverlayPanel` around its custom window chrome rather than stacking the standard `BaseModal` header/body. RDP/VNC preserve protocol-specific nominal minima (1024x768 / 800x600), clamp to the real smaller viewport when required, RAF-coalesce display-size updates, keep minimize from sending 0x0, and re-sync on restore;
- RDP browser fullscreen fills the viewport, hides window chrome/resize controls, keeps Escape scoped to fullscreen exit and exits fullscreen before modal/session close. The existing Connections -> Backend Module -> Guacamole adapter -> remote-gateway RemoteApp path remains intact; Transfers/Progress ownership was not moved into Remote Desktop.

Remote Desktop slice validation is **PASS**: format/format-check, test-policy, frontend architecture/i18n/Vue typecheck, backend architecture, `git diff --check`, and root frontend/backend/remote-gateway production builds pass. Frontend remains **257 source files**, **1686 i18n keys × 3 locales in 81 fragments**, and **1820 transformed modules**. The first parallel backend/remote-gateway root build attempts hung inside `npm ci` before compilation; they were terminated and the same root build commands passed immediately when rerun serially with npm audit/fund network requests disabled. Backend still has only the known Node 22 vs package `>=24` engine warning. The existing ~4.87 MB / 1.44 MB gzip session chunk warning remains deferred. No tests were added and no E2E was run.

SSH Suspend is now closed through `GREQ-SSH-004` for the current Git/final-old pass:

- the authenticated-user suspended catalog stays in the SSH Suspend feature while each mounted manager owns its own search term. Ref-counted polling preserves the final 3-second cadence, 429 exponential backoff to 60 seconds, 10-second floor for other failures and success reset. Forced refreshes queued behind an in-flight request perform a fresh follow-up read rather than reusing a potentially stale transition snapshot;
- `05747a46` rename semantics are restored through the HTTP owner: blank/unchanged edits do not submit, Backend trims/returns the authoritative `customName`, and the frontend applies that returned value. `f3b190bd` log export keeps hanging/disconnected logs reachable with a real body-attached temporary download link and shared success/error feedback. Hanging terminate, disconnected-entry removal and modal close behavior remain status/presentation specific;
- Backend auto-termination now leaves the catalog/log record reachable as `disconnected_by_backend` rather than deleting it. The clean `suspend.autoTerminated` event updates the local snapshot and triggers a fresh catalog read; narrow manager panes retain icon actions while labels collapse through the final inline-size behavior;
- one `WorkspaceRuntimeSession` still owns only its live mark/time and clean `SshSuspendChannel.mark/unmark`. Mark sends live Terminal serialization when mounted or the Terminal feature's retained snapshot when the pane is absent, and marked tabs suppress ordinary reconnect. Connected marked Resume only re-activates the existing tab and never implicitly unmarks it;
- Backend `WorkspaceSuspendCoordinatorService` remains the sole transport/cached-output resume transaction owner. The old frontend `SSH_OUTPUT_CACHED_CHUNK` ACK map / 135-second pending-resume state machine was not restored. `WorkspaceRuntimeRegistry` owns only temporary-tab composition, waits a Vue tick for a real Terminal consumer, cleans failed resume tabs, replaces a matching old marked-disconnected tab at the same order position after success and restores the previously active unrelated tab when required;
- mobile foreground recovery restores the final `3572edfa` behavior through clean owners: one deduped Workspace transaction checks marked disconnected tabs for up to 10 attempts at 400 ms, refreshes the feature catalog silently, matches Backend hanging records by `originalWorkspaceId`, resumes/replaces through the registry and only clears a stale local mark for ordinary reconnect after a final successful catalog read proves no hanging transport exists. Leaving Workspace stops the recovery transaction rather than consuming a Backend hanging session off-route.

SSH Suspend slice validation is **PASS**: format/format-check, test-policy, frontend architecture/i18n/Vue typecheck, backend architecture/typecheck, `git diff --check`, and root frontend/backend/remote-gateway production builds all pass. Frontend remains **257 source files**, **1686 i18n keys × 3 locales in 81 fragments**, and now reports **1821 transformed modules**. The existing Vite session chunk warning is about 4.87 MB minified / 1.45 MB gzip and remains deliberately deferred. Backend still reports only the known Node 22 vs package `>=24` engine warning. No tests were added and no E2E was run.

Workspace runtime/layout/mobile composition is now closed through `GREQ-WORK-005` for the current Git/final-old pass:

- `WorkspaceRuntimeSession` retains the final initial-vs-post-connect reconnect policy: automatic first-connect recovery is capped at 5 attempts, while a session that has connected once retries indefinitely with 2/4/8/16/30-second backoff and then 30-second periodic attempts. Interaction-triggered reconnect cannot overlap another handshake;
- Terminal feature traffic is protocol-bound rather than raw-socket-bound. Runtime adapters consume input while the Workspace binding is absent, retain only the latest deferred viewport, flush resize after a successful `workspace.connect`/resume binding and use `WorkspaceSocket.sendConnected()` so Terminal input/resize can never reopen a raw WebSocket behind RuntimeSession ownership;
- desktop tabs keep reorder/horizontal-wheel/context operations while mobile tabs explicitly disable drag. Registry remains the sole live order/activation owner and the old persisted Session-store ordering source was not restored;
- runtime splitter sizes now flow through Renderer composition into `workspaceLayout`, update the in-memory tree immediately and persist only the latest layout after a 1-second serial debounce. `layoutLocked` now locks the actual splitters; configurator close/reset confirmations are restored; only Terminal is globally single-instance while non-Terminal pane presentations may be cloned across layout/sidebar locations subject to final per-sidebar uniqueness;
- `focusRegistry` remains the multi-instance action owner while persisted focus config now enforces/canonicalizes the final `Alt+[A-Z0-9]` shortcut grammar. Configurator shortcuts are captured from keydown rather than arbitrary text;
- mobile controls are a normal-flow content-sized sibling rather than an absolute overlay. One transient Surface-owned Ctrl/Alt state is shared by direct Terminal input, VirtualKeyboard and CommandBar/system-keyboard input, consumes itself only after a valid transformed input and clears when leaving Terminal/closing the keyboard.

Workspace slice validation is **PASS** on the frozen cross-pass worktree: `npm run format` / `format:check`, `check:test-policy`, frontend architecture/i18n/Vue typecheck, backend architecture/typecheck, `git diff --check`, and root frontend/backend/remote-gateway production builds all pass. Frontend now reports **258 source files**, **1686 i18n keys × 3 locales in 81 fragments**, and **1822 transformed modules**. The existing Vite session chunk warning remains about 4.87 MB minified / 1.45 MB gzip and deliberately deferred. Backend still reports only the known Node 22 vs package `>=24` engine warning. No tests were added and no E2E was run.

Dashboard / System Overview is now closed through `GREQ-DASH-005` for the current Git/final-old pass:

- Dashboard derives the newest used Connection from the existing Connections owner and restores the normal Workspace reconnect entry point plus per-row relative last-connected/tag context;
- recent activity remains Audit-owned and restores the final failure/error/denied emphasis, bounded structured summary, latest-five limit and locale-aware relative-time presentation without creating a second audit owner;
- `useSystemOverview()` preserves the last successful local/remote snapshot across transient refresh failures. Dashboard keeps independent overlap-guarded local/remote polling and resynchronizes each timer when its persisted display/interval preference changes; unrelated initial management reads use `Promise.allSettled` so one failure does not abort Dashboard setup;
- Backend `SshResourceStatusService` keeps its existing normalized host:port de-duplication, duplicate credential fallback, four-host concurrency, connection+refresh fingerprint cache identity and collection-start TTL. It now also owns the final-old 500 ms first-discovery second CPU sample, leaving the generic POSIX collector unchanged;
- remote resource cards again expose CPU, memory percentage/capacity and root-disk usage from the clean `ResourceStatus` model. `2983b036` / `2853e3f2` exact panel sizing remains presentation-only, while the `a21f361d` mobile reachability constraint is already preserved by the clean min-width-safe/full-width action layout and did not reopen a separate GREQ.

Dashboard/System Overview slice validation is **PASS** on the frozen Dashboard worktree: `npm run format` / `format:check`, `check:test-policy`, frontend architecture/i18n/Vue typecheck, backend architecture/typecheck, `git diff --check`, and root frontend/backend/remote-gateway production builds all pass. Frontend remains **258 source files**, **1686 i18n keys × 3 locales in 81 fragments**, and **1822 transformed modules**. The existing Vite session chunk warning remains about 4.87 MB minified / 1.45 MB gzip and deliberately deferred. Backend still reports only the known Node 22 vs package `>=24` engine warning. The first combined build invocation returned an AgentDock 502 with no command result; serial root reruns passed, and the frontend npm network stage required the already-authorized `npm_config_audit=false npm_config_fund=false` environment. No tests were added and no E2E was run.

Security residual discovery is now closed through `GREQ-SEC-002`:

- `GREQ-SEC-001` restores the final blacklist lifecycle under the clean Security/Backend owners: enablement persists immediately and rolls back on failure, disabled state hides inactive-looking threshold/list controls, threshold save performs explicit positive-integer validation, blocked rows keep last-attempt + ban-expiry context, and destructive unblock requires shared confirmation before authoritative refresh;
- `GREQ-SEC-002` removes the clean frontend's inert `whitelistEnabled` state. Final-old exposes only the effective IPv4/IPv6/CIDR allow-list and Backend `IpWhitelistService` evaluates that list directly; the dormant compatibility key remains only for later contract/settings cleanup and is no longer a second frontend source of truth.

Security residual slice validation is **PASS** on the frozen Security worktree: format/format-check, test-policy, frontend architecture/i18n/Vue typecheck, backend architecture/typecheck, `git diff --check`, and root frontend/backend/remote-gateway production builds all pass. Frontend remains **258 source files**, **1686 i18n keys × 3 locales in 81 fragments**, and **1822 transformed modules**. The same deferred Vite session chunk warning and Node 22 vs Backend `>=24` engine warning remain the only known build warnings. No tests were added and no E2E was run.

The **management-domain residual Git/final-old sweep is now closed**. Auth/Security/Connections/Tags/SSH Keys/Proxies/Preferences/Appearance/Backup/Notifications/Audit/Quick Commands/Command History have been rechecked against final-old reachability and current clean owners. Only evidence-backed gaps were reopened:

- `GREQ-SEC-001` / `GREQ-SEC-002` close IP blacklist lifecycle/validation and remove the inert clean-frontend whitelist enable state while leaving the dormant compatibility key for later settings-contract cleanup;
- `GREQ-QC-004` restores direct Quick Command search ArrowUp/ArrowDown/Enter selection/execution, selected-row reveal and empty collapsible-search Escape behavior through the existing Quick Commands selection owner;
- `GREQ-HIST-003` restores direct Command History search ArrowUp/ArrowDown/Enter selection/execution and selected-row reveal through the existing History selection owner.

Connections direct-private-key REVIEW is closed: final-old Connection auth requires Saved SSH Key, while the clean direct-key path is retained as a mutually-exclusive extension rather than treated as missing parity. Historical raw Connection JSON import/export is final-old-dead and is not restored; the surviving connection-data ZIP export remains `GREQ-BACKUP-002`. Standalone Tags presentation is also final-old-dead because its route is disabled. Preferences compatibility-only `spreadsheetPreviewMaxRows`, the removed intermediate Terminal-theme hold-preview behavior, and other non-reachable/dead presentation artifacts are recorded as residual audit conclusions instead of new GREQ.

Management residual validation is **PASS** on the frozen worktree: `npm run format` / `format:check`, `check:test-policy`, frontend architecture/i18n/Vue typecheck, backend architecture/typecheck, `git diff --check`, and root frontend/backend/remote-gateway production builds all pass. Frontend remains **258 source files**, **1686 i18n keys × 3 locales in 81 fragments**, and **1822 transformed modules**. Vite still reports only the known session chunk warning at about **4.875 MB minified / 1.446 MB gzip**, deliberately deferred. Backend still reports only the known Node 22 vs package `>=24` engine warning. No tests were added and no E2E was run.

The clean HTTP/WS contract migration and compatibility deletion are now **implementation-complete**. Behavior/GREQ parity remains closed for the current Git/final-old pass unless new concrete evidence appears during validation. Frontend feature APIs consume clean camelCase Nexus DTOs; Backend Interfaces validate/map transport; persistence-specific row names remain in Infrastructure; both Backend `legacy-api/` directories were deleted only after production imports reached zero.

## 14. Final phases after GREQ/behavior closure

### Clean HTTP — complete

- every frontend HTTP family now consumes clean camelCase Nexus DTOs;
- historical Nexus frontend wire mappers are removed;
- Backend Modules retain business validation/state-machine ownership;
- Backend Interfaces own HTTP transport validation/mapping/redaction;
- `packages/backend/src/interfaces/http/legacy-api/` is deleted.

### Compatibility cleanup — complete

- `packages/backend/src/interfaces/websocket/legacy-api/` is deleted;
- compatibility-only architecture-guard exceptions are removed and current constraints/docs prohibit recreating those paths;
- production grep has no historical Workspace framing/scheme identifiers or Nexus snake_case DTO/message names in frontend APIs / Backend Interfaces. `node:string_decoder` is a Node builtin module name and `nexus_connections_export.zip` is the preserved user-visible download filename, not a Nexus DTO/message/framing identifier.

### Final gates

Run repository static/build gates, including:

```text
npm run format
npm run format:check
npm run check:test-policy
npm run build:backend
npm run build:frontend
npm run build:remote-gateway
npm --prefix packages/backend run check:architecture
git diff --check
```

Only after these pass, run the **existing** E2E suite. Selector-only failures may update existing locators; do not distort product architecture/behavior for stale selectors.

## 15. Things a new session must not do

- Do not start Agent before final static/build gates, existing E2E and size review are complete.
- Do not recreate deleted Backend HTTP/WS compatibility directories or frontend historical Nexus wire mappers.
- Do not run E2E unless the latest contract-clean static/build gates are PASS.
- Do not add tests.
- Do not optimize bundle size by removing functionality before E2E validation.
- Do not reopen closed behavior domains without new concrete Git/final-old evidence.
- Do not restore old mega-stores/event bus/session architecture.
- Do not create parallel feature services/controllers when an owner already exists.
- Do not use xterm `_core` or other private implementation APIs unless public APIs are proven insufficient and the reason is explicitly reviewed first.
- Do not `git reset --hard` or otherwise discard the existing dirty worktree.

## 16. New-session first action

Behavior/GREQ discovery, clean HTTP/WS migration and whole-layer compatibility deletion are complete. The next executable boundary is **final latest-worktree static/build validation**.

Run formatting/format-check, test-policy, frontend architecture+i18n+Vue typecheck, backend architecture+typecheck, `git diff --check`, and all three root production builds. If root npm install/build stalls on audit/fund network requests, rerun the same root command with `npm_config_audit=false npm_config_fund=false` rather than changing dependencies.

Only after that frozen worktree is PASS may the existing repository E2E suite run. Adjust existing selectors only for selector-only failures; add no tests. After E2E, measure final bundle/chunk output and review splitting/trimming. Agent remains last and must not be invented while Backend exposes no Agent public surface.

## 17. Final size and Agent review

The post-E2E size review keeps every behavior-backed capability and splits only optional heavy presentation/runtime dependencies. File Preview now lazy-loads Markdown/PDF/Spreadsheet/DOCX renderers; File Editor lazy-loads desktop Monaco or mobile CodeMirror; Status Monitor lazy-loads Chart.js through `StatusCharts`. Unused component re-exports were removed so these dynamic imports form real chunk boundaries instead of being pulled back into the Workspace session through feature barrels.

On the final local production build for this split, the Workspace `session` chunk fell from roughly **4.88 MB minified / 1.45 MB gzip** to roughly **878 kB minified / 337 kB gzip**. Monaco is an independent roughly **2.67 MB / 687 kB gzip** on-demand chunk; PDF, Spreadsheet, DOCX, StatusCharts and CodeMirror are also independent on-demand chunks. The previous >3 MB application chunk warning is therefore gone without removing functionality. Terminal/xterm remains eager because Terminal is the primary Workspace path.

Agent review is intentionally **no implementation** at this stage. `runtimes/agent/` contains only its architecture boundary README, App exposes no Agent route, and Backend `interfaces/` exposes no Agent HTTP/WebSocket public surface. Backend's existing `agent` owner/diagnostic types are future capability foundations, not an Agent product contract. Do not invent an Agent UI, protocol, session lifecycle or Workspace-internal reuse until Backend exposes an explicit clean Agent public surface.
