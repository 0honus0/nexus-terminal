# Frontend Refactor Status / Handoff

> **Purpose:** this is the persistent execution ledger for the Nexus Terminal frontend rewrite. A new ChatGPT/AgentDock session should read this file first, then `../../doc/architecture/FRONTEND.md`, and continue from the first unfinished item under **Next actions**.
>
> **Latest detailed execution handoff:** [`../../doc/FRONTEND_REFACTOR_CURRENT_HANDOFF.md`](../../doc/FRONTEND_REFACTOR_CURRENT_HANDOFF.md). Read it before continuing; it contains the current Git/GREQ status, the completed behavior-parity passes through Dashboard/System Overview and management residuals, and the active clean HTTP contract migration boundary.
>
> This file records progress and handoff state. Architecture rules live in `doc/architecture/FRONTEND.md`; do not silently change architecture by editing only this file.

## 1. Repository baseline

- Branch: `test/agent-runtime-foundation`
- Refactor baseline HEAD: `b6ef2955fb9b476122bf8901b502569bb7921f29`
- Backend clean-architecture refactor is already complete on that baseline.
- Current worktree intentionally contains the frontend rewrite and documentation changes; it is not expected to resemble baseline `src/` paths.
- The old frontend is reference material only. **Do not restore old root `components/`, `stores/`, `composables/`, `views/`, `types/`, `utils/` as compatibility paths.**

Recoverable backups exist outside the worktree, including:

- `../_backups/20260903-nexus-frontend-clean-skeleton/`
  - full clean-HEAD frontend archive;
  - backend legacy Interface archive;
  - SHA256 manifest.
- `../_backups/20260903-frontend-refactor/`

If old behavior or UI details are needed, inspect clean HEAD with `git show HEAD:<path>` or extract/read the backup. Do not copy old architecture wholesale.

## 2. Required reading for every new session

Read in this order:

1. [`../../doc/architecture/FRONTEND.md`](../../doc/architecture/FRONTEND.md) — **authoritative frontend architecture**.
2. [`../../doc/architecture/FRONTEND_DEPENDENCY_ANALYSIS.md`](../../doc/architecture/FRONTEND_DEPENDENCY_ANALYSIS.md) — old dependency/business analysis and cycle evidence.
3. [`../../doc/architecture/FRONTEND_MIGRATION_MANIFEST.md`](../../doc/architecture/FRONTEND_MIGRATION_MANIFEST.md) — old-source-to-new-owner rewrite manifest.
4. [`../../doc/architecture/BACKEND_REFACTOR_REPORT.md`](../../doc/architecture/BACKEND_REFACTOR_REPORT.md) — backend clean semantic/API/WS reference.
5. [`../../doc/ENGINEERING_CONSTRAINTS.md`](../../doc/ENGINEERING_CONSTRAINTS.md) — mandatory repository constraints.

## 3. Non-negotiable decisions

### Rewrite, not move

- Old source defines observable behavior, user workflow, visual baseline and E2E selectors only.
- New component/store/composable/runtime code is rewritten in the final ownership graph.
- Do not preserve old internal APIs merely to reduce migration work.
- Do not add compatibility re-exports at deleted old frontend paths.

### Dependency direction

Canonical direction:

```text
foundation
   ↑
shared                         client transport
   ↑                                  ↑
feature model / ports                 │
   ↑                                  │
feature api / store / composable -----┘
   ↑
feature components
   ↑
runtime adapters / runtime composition
   ↑
app pages / shell / bootstrap
```

Hard constraints:

- `client` never imports Pinia/router/UI/product state.
- Cross-feature imports go through `features/<owner>/public.ts` only.
- A feature never imports another feature's private `store/`, `api/`, `protocol/` or component path.
- Lower-level features never import Workspace, Agent or App.
- Workspace and Agent never import each other's internal runtime.
- Full frontend dependency graph must remain acyclic.

### Workspace / Agent

- `runtimes/workspace` and `runtimes/agent` are composition/runtime owners, not capability owners.
- Terminal, filesystem, editor, transfer, status, Docker, remote desktop and SSH suspend semantics live in independent feature owners.
- Runtime adapters implement feature capability ports.
- Agent must never reuse Workspace socket/session/SFTP/terminal/upload objects.

### Contract migration order

Frontend behavior restoration is complete for the current Git/final-old pass. HTTP and WebSocket contracts are now aligned to the clean Backend Interfaces, and the temporary Backend compatibility layers have been deleted.

Current rule:

- frontend Workspace uses only the clean `/ws/workspace`, `/ws/uploads` and `/ws/remote-desktop` contracts;
- frontend HTTP feature APIs consume clean camelCase Nexus DTOs and do not carry historical Nexus wire mappers;
- persistence-specific snake_case row/column names remain private to Infrastructure repositories/storage code;
- `packages/backend/src/interfaces/http/legacy-api/` and `packages/backend/src/interfaces/websocket/legacy-api/` are deleted and must not be recreated;
- Backend Modules/Platform keep business ownership; Interface code validates/maps transport rather than reintroducing compatibility state.

Do not change Backend Module/Platform responsibilities merely for frontend migration.

### Tests

- Automated product tests remain E2E only under `test/e2e`.
- **Do not add any new test files during this refactor.** Reuse the repository's existing E2E suite only as behavior reference and final validation.
- Do not add unit/component/integration/internal implementation tests, test helpers, test-framework dependencies, or CI test jobs.
- Architecture/invariants are checked by static/build/architecture gates.
- Preserve real-user behavior and workflows. Existing DOM selectors/test IDs are not product contracts and may change with the clean component structure. During final validation, update existing E2E locators/selectors when failures are selector-only; do not change product behavior just to satisfy old locators.

## 4. Final ownership map

### App composition

- `app/bootstrap` — startup ordering only.
- `app/router` — route table/guards using public feature surfaces.
- `app/pages/dashboard` — Dashboard composition.
- `app/pages/settings` — Settings composition.
- `app/shell` — global navigation and application shell.

### Foundation/shared/client

- `foundation/ui` — pure visual primitives.
- `foundation/interaction` — generic pointer/touch/resize/drag/wheel behavior.
- `foundation/browser` — browser/device primitives.
- `foundation/async` — generic async coordination.
- `shared/feedback` — global toast/confirm/alert infrastructure.
- `shared/focus` — generic focus/shortcut infrastructure.
- `client/http` — HTTP transport only.
- `client/websocket` — raw WebSocket transport only.

### Catalog/product features

- auth
- security
- preferences
- appearance
- backup
- audit
- notifications
- connections
- tags
- ssh-keys
- proxies
- quick-commands
- command-history
- system-overview

### Reusable runtime capabilities

- terminal
- filesystem
- file-editor
- file-preview
- transfers
- status-monitor
- docker
- remote-desktop
- ssh-suspend

### Runtime composition

- `runtimes/workspace`
- `runtimes/agent`

## 5. Old architecture problems that must not return

Static analysis of clean-HEAD old frontend found:

- 203 TS/Vue/JS source files;
- 539 internal import edges;
- a 19-file strongly-connected dependency cycle involving auth/session/connections/fileEditor/settings/layout/router/apiClient;
- a direct `FileManagerContextMenu.vue <-> useFileManagerContextMenu.ts` cycle;
- `settings.store.ts` imported by ~30 files;
- `connections.store.ts` and `apiClient.ts` imported by ~27 files each;
- `session.store.ts` imported by ~25 files;
- one Session state object owning WebSocket + SFTP + terminal + status + Docker + editor + command input + remote desktop + suspend state.

Do not recreate a renamed "global session/settings store" that owns these responsibilities.

## 6. Progress ledger

Legend: `[x]` complete, `[~]` in progress, `[ ]` not started.

### Phase 0 — architecture and safety

- [x] Analyze backend clean architecture and frontend constraints.
- [x] Back up clean-HEAD frontend and backend legacy Interface source.
- [x] Analyze old frontend business inventory and static dependency graph.
- [x] Identify old cycles/high fan-out dependencies.
- [x] Freeze authoritative architecture in `doc/architecture/FRONTEND.md`.
- [x] Write migration manifest in `doc/architecture/FRONTEND_MIGRATION_MANIFEST.md`.
- [x] Add this persistent progress/handoff document.

### Phase 1 — clean skeleton and foundation

- [x] Delete old frontend root implementation paths from the new source tree.
- [x] Create a standalone compiling Vue skeleton.
- [x] Add global style tokens and global CSS boundary.
- [x] Add initial `foundation/ui` primitives (`BaseButton`, inputs, modal, panel, spinner, overlay).
- [x] Add feature-fragment i18n registry and parity gate.
- [x] Add domain-neutral shared feedback infrastructure.
- [x] Add raw HTTP and WebSocket transport owners.
- [x] Normalize the skeleton to the **final** architecture (`app/pages`, independent capability features, `runtimes/workspace`, `runtimes/agent`).
- [x] Rebuild generic foundation interaction/browser/async primitives where proven reusable (latest-value saver, drag, resize-handle, wheel scaling, device capabilities). Old one-off `useResizable` was not restored; Guacamole-specific touch input is deferred to `remote-desktop`.
- [x] Complete foundation primitives required by rewritten features as real reuse appears (`TokenInput`, tabs, overlays/modals, context menu, long-press, drag, resize and wheel scaling); feature-specific toolbars/progress remain with their feature owner instead of being generalized prematurely.

### Phase 2 — UI and product feature rewrite

- [x] Auth/setup/login/logout/session/router base flow.
- [x] Security owner: password, 2FA, passkey, CAPTCHA and IP access settings; Auth/Security remain independently owned and App composes them.
- [x] Preferences/settings value owner and Settings page composition.
- [x] Appearance/style customizer/terminal themes/background settings, window theme color, page background, custom HTML, text stroke/shadow and application-start/runtime application.
- [x] Backup/data management owner.
- [x] Tags owner.
- [x] SSH keys owner.
- [x] Proxies owner.
- [x] Connections CRUD/test/clone/search/batch/forms/RDP/VNC/RemoteApp, password-preserving edits, proxy credential semantics, Jump Chain and script-mode validation are restored under the Connections owner.
- [x] Notifications owner.
- [x] Audit owner.
- [x] System overview owner.
- [x] Dashboard app page composition.
- [x] Settings app page composition.
- [x] Quick Commands owner/UI — CRUD/search/group/tags/execute current-or-all, saved-variable substitution, usage count, collapsible search and row scaling. Old code had no runtime variable prompt; unresolved placeholders are now warned without inventing a new workflow.
- [x] Command History owner/UI and execute intent.

### Phase 3 — reusable live capability rewrite

- [x] Terminal feature: clean model/channel, Xterm, search, clipboard/select-all, mobile controls and visual options are complete.
- [x] Filesystem feature: clean model/channel, navigation/search/mutations, favorites, path history and scoped download UX are complete.
- [x] File editor feature: independent editor session state, desktop Monaco and mobile CodeMirror.
- [x] File preview feature: image/Markdown/PDF/XLSX/DOCX preview owner and tab state.
- [x] Transfers feature: clean task/controller, upload/copy/move, cross-session destination flow, archive/password UX, progress and conflict UI are complete.
- [x] Status monitor feature + `StatusChannel`.
- [x] Docker feature + `DockerChannel`; backend capability remains status/stats/start/stop/restart/remove, while Enter/Logs correctly emit terminal-command intents instead of inventing duplicate Docker protocols.
- [x] Remote desktop feature with Guacamole owned entirely by `remote-desktop`; RDP/VNC connect through the clean remote-desktop WS endpoint.
- [x] SSH suspend feature catalog UI + active-runtime mark/unmark port; resume intent is correctly owned by runtime lifecycle.

### Phase 4 — Workspace runtime

- [x] Workspace model/session lifecycle separated from capability state.
- [x] Typed clean Workspace protocol boundary (`WorkspaceSocket`).
- [x] Workspace adapters implementing Terminal/Filesystem/Editor/Preview/Transfer/Status/Docker/Suspend capability ports.
- [x] Multi-session registry, active tab state, reconnect lifecycle and tab switching.
- [x] Workspace recursive layout/pane composition and sidebars.
- [x] Clean layout configurator + layout/sidebar persistence.
- [x] Workspace settings composition — Preferences/Appearance drive terminal visuals, nav visibility, layout lock, polling intervals, right-click copy/paste behavior, tags, sidebar persistence, editor/preview mode, scaling, spreadsheet limits and remote-desktop sizing without a duplicate runtime settings store.
- [x] Mobile/touch tools — single-pane Workspace, virtual keyboard modifiers/navigation, terminal long-press selection handles/clipboard/pinch, FileManager multi-select/long-press, PDF/DOCX touch preview, CodeMirror search and remote desktop direct/touchpad/IME input.
- [x] Suspend/close/resume handoff with terminal snapshot and a new unbound clean socket for resume.
- [x] RDP/VNC entry composed through Remote Desktop feature without putting it into Workspace session state.
- [x] Restore all final old-frontend user-visible behavior for the current Git/final-old pass. Dashboard/System Overview is closed through `GREQ-DASH-005`; management residual discovery is closed through `GREQ-SEC-002`, `GREQ-QC-004` and `GREQ-HIST-003`, with no-gap audit conclusions recorded for the remaining rewritten management domains. Behavior parity is frozen unless new concrete evidence appears during transport compatibility removal.

### Phase 5 — Agent runtime

- [ ] **Deferred until the old frontend rewrite is fully complete.** Do not implement Agent during legacy frontend behavior restoration.
- [x] Backend Agent public surface inspected: none exists in the current repository, so no Agent protocol/session/UI will be invented.
- [ ] Revisit Agent only after frontend behavior restoration, clean HTTP/WS migration, compatibility deletion and final validation are complete.

### Phase 6 — final HTTP contract alignment

- [x] For each HTTP family, expose clean Interface DTOs matching clean frontend models.
- [x] Remove historical Nexus snake_case/current-wire DTO knowledge from frontend private API mappers.
- [x] Migrate Backend HTTP Interface without changing Module/Platform business responsibility; persistence row mapping stays in Infrastructure.
- [x] Delete `packages/backend/src/interfaces/http/legacy-api/` as a whole after production imports reached zero.

### Phase 7 — clean WebSocket contract and compatibility deletion

- [x] Define clean request/response/event Workspace WebSocket Interface.
- [x] Replace historical terminal framing: Workspace terminal output is raw server-to-browser binary bytes with transport backpressure.
- [x] Replace historical upload framing: each clean upload socket carries raw ordered file chunks; declared size defines completion.
- [x] Migrate remote desktop to explicit `/ws/remote-desktop` width/height/dpi query contract.
- [x] Switch frontend Workspace runtime/adapters to `/ws/workspace`, `/ws/uploads`, `/ws/remote-desktop`.
- [x] Backend WebSocket server no longer imports or routes through the historical compatibility session.
- [x] Delete `packages/backend/src/interfaces/websocket/legacy-api/` after production imports reached zero.
- [x] Remove compatibility-only architecture-guard exceptions and update current architecture constraints/docs.

### Phase 8 — final validation and cleanup

- [x] No old frontend compatibility/re-export paths.
- [x] No historical Nexus DTO/message/framing names in final frontend APIs or Backend Interfaces. Lowercase snake_case that remains at persistence/external-library boundaries is not a Nexus wire contract; the retained `nexus_connections_export.zip` download filename is a user-visible filename, not a DTO/message identifier.
- [x] No cross-feature private imports in current rewritten frontend graph.
- [x] Current frontend graph is acyclic.
- [x] Current i18n fragments have exact three-locale structural parity.
- [ ] Remove unused dependencies confirmed obsolete after rewrite.
- [x] Latest `git diff --check` passes.
- [x] `npm run check:test-policy` final static gate passes on the contract-clean worktree.
- [x] Latest `npm run build:frontend` passes.
- [x] Latest backend architecture/type/build checks pass; remote-gateway production build also passes.
- [ ] Existing relevant E2E paths run only after code/contract restoration is complete.
- [ ] Canonical full GitHub Actions E2E before final commit/merge evidence.

## 7. Current implementation state

- Old frontend root implementation paths are removed from the worktree and remain recoverable from backup/HEAD.
- Foundation, shared feedback, raw clients, app shell/router/i18n and the full final top-level ownership skeleton are in place.
- Product owners for Auth/Security/Preferences/Appearance/Backup/Tags/SSH Keys/Proxies/Connections/Notifications/Audit/System Overview/Quick Commands/Command History are rewritten and App pages compose them.
- Reusable live owners for Terminal/Filesystem/File Editor/File Preview/Transfers/Status/Docker/Remote Desktop/SSH Suspend exist with transport-neutral ports.
- Terminal GREQ pass is closed for the current Git/final-old sweep. Filesystem/File Manager is closed through `GREQ-FS-013`; Transfers through `GREQ-XFER-006`; File Editor through `GREQ-EDIT-004`; File Preview through `GREQ-PREVIEW-005`; Status Monitor through `GREQ-STATUS-004`; Docker through `GREQ-DOCKER-004`; Remote Desktop through `GREQ-RDP-004`; SSH Suspend through `GREQ-SSH-004`; Workspace lifecycle/tab/layout/focus/mobile composition is now closed through `GREQ-WORK-005`. Workspace parity keeps reconnect policy in `WorkspaceRuntimeSession`, protocol-bound Terminal gating in runtime adapters, tab order in the registry, persisted layout ownership in `workspaceLayout`, focus actions in `focusRegistry`, and transient mobile Ctrl/Alt composition in presentation state; no old Session mega-store/event bus was restored.
- `FilesystemChannel` is filesystem-only again. File Manager's genuine cross-capability dependency on the interactive shell is represented by the narrow `TerminalDirectoryPort`; Workspace adapter correlation owns queued/result/error protocol details and resolves only after verified shell directory change.
- Workspace now has real runtime code, not a placeholder route: clean session registry/socket/adapters, recursive layout/sidebars/configurator, focus switcher, multi-tab/reconnect, terminal search/visuals, scoped filesystem catalogs/download, cross-session transfers/archive, shared-or-local editor controller + popup presentation, RDP/VNC, suspend/resume, and mobile single-pane tools. Per-session File Editor, File Preview, Filesystem browser state, Status controller/history, Docker controller/state and command draft now live with `WorkspaceRuntimeSession`; shared editor state lives once with the registry, so route/popup/pane presentation changes do not duplicate or discard business state.
- Settings configuration schema now has its own versioned migration history (`settings_migrations`); settings data changes and version records commit atomically, and Backup carries the configuration migration history. Historical setting keys exist only where required by migration/storage compatibility, not as frontend state owners.
- Backend clean WebSocket Interface is active. The WebSocket server accepts only `/ws/workspace`, `/ws/uploads`, `/ws/remote-desktop`; terminal output and uploads use the clean raw-binary transports. Suspend auto-termination is consumed through the clean event path, and the frontend composes live `marked` runtime sessions with backend `active/disconnected` suspended records.
- Clean HTTP migration is complete. Frontend feature APIs consume camelCase Nexus DTOs; Backend HTTP Interfaces validate/map transport and redact sensitive Notification secrets; persistence-specific row names stay in Infrastructure repositories.
- Both Backend compatibility directories are deleted after production imports reached zero. Compatibility-only architecture-guard exceptions are removed, and current engineering constraints prohibit recreating those paths.
- Frontend architecture guard checks deleted old frontend roots, layer direction, cross-feature public boundaries, runtime isolation and cycles.
- Frontend source is formatted for reviewability; current TS/Vue source has no >240-character implementation lines. `check:i18n` also rejects missing static `t(...)` keys and user-visible English literals in Vue templates except a small language-neutral protocol/format allowlist. Xterm integration uses public APIs only; private `_core`/internal renderer services are not part of the rewrite contract.
- Frontend static/build gates currently pass: architecture, i18n, TypeScript and production build.
- Backend architecture and production build currently pass.
- No new tests have been added; Playwright/E2E remains intentionally deferred until the final validation stage.
- Size policy: **functionality first**. Restore the complete reachable final-old-frontend feature set before deciding what to trim. Bundle/chunk measurement and any deliberate capability reduction happen only after behavior parity, clean contract migration and validation are complete.

## 8. Next actions

**Execution mode remains: restore all code first, add no tests, run no Playwright/E2E between slices.**

Execute in this order:

1. Freeze the contract-clean worktree and run the complete static/build gate set: formatting, test-policy, frontend architecture/i18n/Vue typecheck, backend architecture/typecheck, `git diff --check`, then root frontend/backend/remote-gateway production builds.
2. Only after those latest-worktree gates pass, run/update the repository's existing E2E suite; selector-only failures may update existing locators, but no new tests are added and product behavior is not distorted for stale selectors.
3. After parity + contract cleanup + E2E validation, measure final frontend output/chunk sizes and decide whether code splitting or deliberate feature trimming is warranted.
4. Revisit Agent only after final validation and size review; do not invent an Agent protocol while Backend still exposes no Agent public surface.

Immediate executable starting point:

`final static/build gates -> existing E2E -> size review -> Agent later`.

## 9. Session handoff protocol

Before ending any future refactor session:

1. update the checkboxes above;
2. update **Current implementation state** if architecture/build state changed;
3. replace **Next actions** with the exact next executable steps;
4. record the latest successful/failed validation commands below;
5. during the full-code-restoration stage, progress may be marked implementation-complete after architecture/type/build gates; product validation remains explicitly pending until the final unified E2E stage;
6. do not preserve old `data-testid`/DOM IDs merely for compatibility. If an existing E2E later fails only because the clean UI uses different selectors, update that existing locator without changing the feature behavior and without adding tests.

### Latest validation record

- Contract-clean final static/build checkpoint: **PASS before E2E** — on the compatibility-deleted worktree, `npm run format`, `format:check`, `check:test-policy`, frontend architecture/i18n/Vue typecheck, backend architecture/typecheck, `git diff --check`, and root frontend/backend/remote-gateway production builds all pass. Current count: **253 frontend source files**, **1686 i18n keys × 3 locales / 81 fragments**, **1817 transformed frontend modules**, and **218 backend architecture-scanned files**. Vite still reports only the deferred session chunk warning at **4,874.18 kB minified / 1,445.30 kB gzip**; Backend still reports only the known Node 22 vs package `>=24` engine warning. Both Backend `legacy-api/` directories are deleted, production compatibility imports are zero, and no historical Workspace framing/scheme identifiers remain in production source. No E2E has run yet on this final contract-clean checkpoint.
- Dashboard/System Overview checkpoint: **PASS** — `GREQ-DASH-001` through `GREQ-DASH-005` are Git/final-old audited and validated. Latest-used reconnect and row last-connected/tag context, recent-audit failure/summary/relative-time semantics, non-destructive independently rescheduled local/remote resource refresh, Backend first-discovery SSH CPU bootstrap sampling, and remote CPU/memory/root-disk snapshot content all pass formatting, test-policy, frontend/backend architecture and type checks, i18n, `git diff --check`, and frontend/backend/remote-gateway production builds. Backend host:port de-duplication, credential fallback, four-way concurrency, connection+interval cache identity and collection-start TTL remain in their existing clean owner. No old Session/status mega-store was restored.
- Security residual checkpoint: **PASS** — `GREQ-SEC-001` and `GREQ-SEC-002` are Git/final-old audited and validated. IP blacklist immediate enable/rollback, disabled-state reachability, threshold validation, blocked-entry lifecycle/confirmation and the single effective IP-whitelist policy state all pass formatting, test-policy, frontend/backend architecture/type checks, i18n, `git diff --check`, and frontend/backend/remote-gateway production builds. The inert clean-frontend `whitelistEnabled` copy and the dormant Backend `ipWhitelistEnabled` compatibility setting/methods were removed during final contract cleanup; whitelist admission now has one effective owner.
- Workspace checkpoint: **PASS** — `GREQ-WORK-001` through `GREQ-WORK-005` are Git/final-old audited and validated. Initial-vs-post-connect reconnect policy, protocol-bound Terminal input/resize, mobile tab drag behavior, layout lock/resize persistence/pane multiplicity, strict Alt shortcut capture, and shared mobile sticky Ctrl/Alt composition all pass formatting, test-policy, frontend/backend architecture/type checks, i18n, `git diff --check`, and frontend/backend/remote-gateway production builds. No old Session mega-store or Workspace event bus was restored.
- SSH Suspend checkpoint: **PASS** — `GREQ-SSH-001` through `GREQ-SSH-004` are Git/final-old audited and validated. Catalog search/poll/rename/log/remove/auto-termination, live mark/unmark and retained Terminal snapshot, clean Backend resume transaction + frontend tab replacement/failure cleanup, and mobile foreground recovery all pass formatting, test-policy, frontend/backend architecture and type checks, i18n, `git diff --check`, and frontend/backend/remote-gateway production builds. No old Session mega-store/ACK event state was restored.
- Remote Desktop checkpoint: **PASS** — `GREQ-RDP-001` through `GREQ-RDP-004` are Git/final-old audited and the clean implementation passed formatting, test-policy, frontend/backend architecture, i18n, Vue typecheck, `git diff --check` and frontend/backend/remote-gateway production builds. The first parallel backend/remote-gateway root build attempts hung in `npm ci` before compilation; serial reruns with npm audit/fund disabled passed immediately.
- Docker checkpoint: **PASS** — `GREQ-DOCKER-001` through `GREQ-DOCKER-004` are Git/final-old audited and the clean implementation passed formatting, test-policy, frontend/backend architecture, i18n, Vue typecheck, clean Backend Docker WS DTO build, frontend/backend/remote-gateway production builds and `git diff --check`.
- Status Monitor checkpoint: **PASS** — `GREQ-STATUS-001` through `GREQ-STATUS-004` remain closed and validated.
- File Preview checkpoint: **PASS** — `GREQ-PREVIEW-001` through `GREQ-PREVIEW-005` remain closed and validated.
- File Editor checkpoint: **PASS** — `GREQ-EDIT-001` through `GREQ-EDIT-004` remain closed and validated.
- Transfers checkpoint: **PASS** — `GREQ-XFER-001` through `GREQ-XFER-006` remain closed and validated.
- Backend: **PASS** — architecture and root `npm run build:backend`; current host Node 22 emits only the package engine `>=24` warning and the build exits successfully.
- Remote gateway: **PASS** — root `npm run build:remote-gateway` / TypeScript build.
- Repository hygiene: **PASS** — `npm run format`, `npm run format:check`, `npm run check:test-policy` and `git diff --check` at the latest completed checkpoint.
- E2E: **not run yet** by design; no new tests were added.
