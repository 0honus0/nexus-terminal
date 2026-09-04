# Nexus Terminal Frontend Dependency and Business Analysis

> This document is the architecture input for the frontend rewrite. Feature implementation must not resume until the ownership and dependency rules in this document are treated as the target graph.
>
> Source baseline analyzed: clean `HEAD` frontend source extracted outside the worktree, existing E2E suite, `doc/architecture/FRONTEND.md`, `doc/architecture/BACKEND_REFACTOR_REPORT.md`, and `doc/ENGINEERING_CONSTRAINTS.md`.

## 1. Why the old frontend cannot be reorganized by file moves

The old frontend contains 203 TypeScript/Vue/JavaScript source files and 539 internal import edges.

Static import analysis finds two strongly-connected dependency cycles:

1. a 19-file cycle spanning `auth`, `session`, `connections`, `fileEditor`, `settings`, `layout`, router and `apiClient`;
2. a direct `FileManagerContextMenu.vue <-> useFileManagerContextMenu.ts` cycle.

The first cycle is architectural rather than incidental. Its important edges include:

```text
auth store
  -> session store

session store
  -> connections store
  -> fileEditor store
  -> session action modules

session types
  -> fileEditor store

settings store
  -> auth store
  -> connections store
  -> layout store

apiClient
  -> auth store / router side effects
```

The old central state objects are also over-shared:

- `settings.store.ts` is imported by about 30 source files;
- `apiClient.ts` and `connections.store.ts` by about 27 each;
- `uiNotifications.store.ts` by about 26;
- `session.store.ts` by about 25;
- `workspaceEvents.ts` by about 17.

Therefore the rewrite must change ownership and dependency direction, not merely move files under new folders.

## 2. User-visible business inventory

The current product behavior is larger than the old top-level route list suggests. Existing E2E coverage establishes the following user-visible business capabilities.

### 2.1 Identity and access

- first administrator setup;
- username/password login and logout;
- protected navigation and authenticated HTTP/WebSocket session;
- password change;
- login 2FA setup, verification and disable;
- passkey login and passkey management;
- CAPTCHA provider configuration and login challenge;
- IP whitelist configuration;
- IP blacklist enablement, max-attempt and ban-duration policy.

### 2.2 Connection catalog

- SSH, RDP and VNC connection CRUD;
- connection testing;
- connection clone;
- connection search, sort and tag filtering;
- batch selection/edit/delete;
- script-mode bulk creation;
- notes;
- password/key authentication;
- SSH key selection and management;
- proxy/jump configuration;
- jump chain;
- RDP RemoteApp options;
- RDP/VNC session token creation.

### 2.3 Connection supporting catalogs

- connection tags and connection-tag assignment;
- SSH key CRUD while preserving existing private key on rename/edit;
- proxy CRUD including preserve/update/explicitly-clear password semantics.

### 2.4 Dashboard and system overview

- connection overview and quick connect;
- persisted dashboard search/tag/sort preferences;
- recent audit activity;
- Nexus host resource status;
- active SSH host resource status;
- independently configurable local/remote resource cards and remote refresh cadence;
- responsive mobile dashboard layout.

### 2.5 Notifications and audit

- webhook/email/Telegram notification channel configuration;
- enable/disable channel;
- unsaved channel test and saved channel test;
- real external webhook delivery;
- audit log pagination/filter/search/action display.

### 2.6 Preferences, data and appearance

- language and timezone;
- workspace behavior settings;
- dashboard resource settings;
- file editor/file manager behavior settings;
- status monitor, Docker, terminal, preview and quick-command settings;
- persisted workspace layout/sidebar/navigation visibility;
- backup export/import;
- connection export behavior;
- UI theme switching;
- PWA window theme color;
- terminal preset/custom theme CRUD/import/export/apply;
- terminal/editor fonts and sizing;
- page/terminal backgrounds;
- terminal custom HTML presets and remote preset repository.

### 2.7 Command productivity

- quick command CRUD/search/grouping/sorting;
- quick-command-specific tags;
- saved variables;
- command execution through active SSH session;
- send to all live SSH sessions;
- command history search/copy/re-run/delete/clear;
- command bar integration;
- collapsible quick command search.

### 2.8 Workspace runtime

The Workspace is a composition surface, not one indivisible feature. It currently contains these independent capabilities:

- live SSH workspace session lifecycle and reconnect;
- terminal rendering/input/resize/search/selection/clipboard/virtual keyboard;
- terminal tab lifecycle;
- terminal output flow-control ACK and cached resume output;
- remote filesystem browse/search/stat/read/write/create/delete/rename/chmod/realpath;
- terminal/file-manager current-directory synchronization;
- file download through HTTP download ticket;
- file editor and editor tabs;
- desktop Monaco and mobile CodeMirror editing;
- image/Markdown/PDF/XLSX/DOCX preview;
- per-preview state and refresh behavior;
- favorites and path history;
- upload, conflict resolution, multi-file upload and cancellation;
- same-session copy/move;
- cross-session copy/move;
- compression/decompression/password flows;
- global progress display and hidden/restored operations;
- remote status monitoring and charts;
- remote Docker list/stats/actions;
- SSH suspend/mark/disconnect/resume/terminate/rename/log behavior;
- RDP and VNC viewer windows;
- desktop/mobile remote touch modes;
- workspace pane layout, sidebars, resize, scaling and configuration;
- focus switcher/keyboard shortcuts.

### 2.9 Agent runtime

There is no old frontend Agent implementation to migrate. Agent is a new runtime owner. It must be able to reuse clean capability interfaces/components without importing Workspace session state or Workspace WebSocket implementation.

## 3. Old component ownership analysis

The old `components/` directory mixes four different kinds of code. They must be separated by ownership in the rewrite.

### 3.1 Business-neutral UI primitives

These should be represented by `foundation/ui` interfaces, not copied as feature components:

- overlay/modal shell;
- button/input/textarea/select/checkbox/form field;
- panel/card surface;
- spinner/loading shell;
- context-menu shell;
- tab strip/tab item shell;
- toolbar/icon button;
- progress bar;
- generic token/chip input;
- generic resizable/draggable window shell.

`ConfirmDialog` / `AlertDialog` are not base controls because they have application feedback semantics. Their visual shell uses Foundation, while their service/host belongs to Shared Feedback.

### 3.2 Shared application infrastructure

Cross-feature code with no product-domain owner belongs under `shared/`:

- feedback service/hosts: confirm, alert, toast;
- generic focus target registry and keyboard shortcut registry;
- generic tab/context-menu composition if more than one feature uses the same behavior.

`shared/` must not contain Connection, SSH, SFTP, Workspace, Agent or API contract types.

### 3.3 Feature-owned reusable components

The following old components have a clear domain owner and may be reused through that owner's public surface:

| Target owner      | Old components / behavior                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `connections`     | `AddConnectionForm*`, `BatchEditConnectionForm`, connection management list/forms                               |
| `tags`            | connection-tag picker and tag management; old `TagInput` must be split into generic TokenInput + domain wrapper |
| `ssh-keys`        | `SshKeySelector`, `SshKeyManagementModal`                                                                       |
| `proxies`         | `AddProxyForm`, `ProxyList`                                                                                     |
| `notifications`   | `NotificationSettings`, `NotificationSettingForm`                                                               |
| `appearance`      | `StyleCustomizer` and its four tabs                                                                             |
| `security`        | change-password, 2FA, CAPTCHA, IP whitelist/blacklist, passkey management settings components                   |
| `quick-commands`  | quick command view/form and quick-command tag UI                                                                |
| `command-history` | command history view/menu                                                                                       |
| `terminal`        | `Terminal`, `VirtualKeyboard` and terminal-local tools                                                          |
| `filesystem`      | `FileManager`, file action/context menu, file manager modal, path/favorite navigation UI                        |
| `file-editor`     | editor container/overlay/tabs, Monaco, CodeMirror mobile editor                                                 |
| `file-preview`    | all `preview/*` components and preview provider registry                                                        |
| `transfers`       | upload/transfer/archive progress, conflict/password dialogs, progress display, send-files workflow              |
| `status-monitor`  | `StatusMonitor`, `StatusCharts`, modal wrapper                                                                  |
| `docker`          | `DockerManager`                                                                                                 |
| `remote-desktop`  | `RemoteDesktopModal`, `VncModal`                                                                                |
| `ssh-suspend`     | suspended-session list/modal and suspend-specific controls                                                      |

### 3.4 Workspace-runtime composition components

These are not reusable domain features; they wire multiple capabilities together and therefore belong to the Workspace runtime:

- `WorkspaceView`;
- `LayoutRenderer`;
- `LayoutConfigurator`;
- `LayoutNodeEditor`;
- `PaneTitleBar`;
- `WorkspaceConnectionList`;
- `TerminalTabBar` because it owns Workspace session tabs, not terminal rendering itself;
- `CommandInputBar` because it coordinates terminal + history + quick commands + active session;
- `FocusSwitcherConfigurator` because it configures Workspace pane targets;
- touch-only Workspace tool surfaces.

## 4. Important component reuse corrections

### 4.1 `TagInput` is not itself a Tags feature component

The old `TagInput.vue` is used by connection, proxy, quick-command and batch-edit code while importing the global Tags store. That creates hidden domain coupling and is semantically wrong for quick-command tags, which have their own catalog.

Rewrite as:

```text
foundation/ui/TokenInput.vue
        ↑
features/tags/components/ConnectionTagPicker.vue
features/quick-commands/components/QuickCommandTagPicker.vue
```

The base token input accepts values/options/slots/events only. Domain wrappers own tag fetching/creation.

### 4.2 tab context menus are generic shell + feature action definitions

`TabBarContextMenu` is currently shared by terminal tabs and editor tabs. The new implementation should use a business-neutral menu/tab primitive and let each owner provide its own actions.

### 4.3 preview controls stay inside File Preview

`PreviewSearchBar`, `PreviewHorizontalScrollbar`, PDF outline/page helpers and preview dialogs are reused across preview formats, but their reuse is entirely inside the File Preview domain. They should not be promoted to global Shared.

### 4.4 progress UI belongs to Transfers

Upload/copy/archive progress is currently spread across File Manager and global Session state. All task/progress state and progress presentation belong to the Transfers feature. File Manager starts operations and observes public transfer state; it does not own the tasks.

## 5. External library ownership

Third-party libraries must be isolated to the feature that gives them meaning.

| Library              | New owner                                              |
| -------------------- | ------------------------------------------------------ |
| Axios                | `client/http` only                                     |
| native WebSocket     | `client/websocket` only                                |
| xterm + addons       | `features/terminal`                                    |
| Monaco               | `features/file-editor`                                 |
| CodeMirror packages  | `features/file-editor`                                 |
| PDF.js               | `features/file-preview`                                |
| docx-preview         | `features/file-preview`                                |
| SheetJS/xlsx         | `features/file-preview`                                |
| marked + DOMPurify   | `features/file-preview`                                |
| guacamole-common-js  | `features/remote-desktop`                              |
| chart.js/vue-chartjs | `features/status-monitor`                              |
| splitpanes           | `runtimes/workspace/layout`                            |
| vuedraggable         | Workspace layout/focus configuration only where needed |
| SimpleWebAuthn       | auth/security boundary only                            |
| hCaptcha/reCAPTCHA   | security/auth UI only                                  |
| vue-i18n             | app registry + feature locale consumption              |
| Pinia                | owning feature/runtime stores only                     |

`element-plus` is registered globally in the old entrypoint but no old source uses an `el-*` component. Unless a real new use is identified, it should be removed rather than carried into the rewrite.

The old `mitt` usage is only the untyped Workspace event bus. The rewrite should prefer typed runtime ports/events; retaining `mitt` is not required.

## 6. Revised target source structure

The earlier idea of putting every interactive capability under `features/workspace/` is rejected because it would make Agent reuse depend on Workspace. The target is capability features plus separate runtime compositions.

```text
packages/frontend/src/
├── app/
│   ├── main.ts
│   ├── App.vue
│   ├── bootstrap/
│   ├── router/
│   ├── shell/
│   ├── pages/                  # route-level composition only
│   │   ├── dashboard/
│   │   ├── settings/
│   │   └── ...
│   ├── i18n/
│   └── styles/
│
├── assets/
├── workers/
│
├── foundation/
│   ├── ui/
│   ├── interaction/
│   ├── browser/
│   └── async/
│
├── shared/
│   ├── feedback/
│   ├── focus/
│   └── tabs/                   # only if genuinely shared after rewrite
│
├── client/
│   ├── http/
│   └── websocket/
│
├── features/
│   ├── auth/                   # setup/login/logout/session
│   ├── security/               # password/2FA/CAPTCHA/IP/passkey settings
│   ├── connections/
│   ├── tags/
│   ├── ssh-keys/
│   ├── proxies/
│   ├── notifications/
│   ├── audit/
│   ├── preferences/            # canonical generic setting serialization
│   ├── backup/
│   ├── appearance/
│   ├── quick-commands/
│   ├── command-history/
│   ├── system-overview/        # HTTP host/SSH resource overview
│   ├── terminal/
│   ├── filesystem/
│   ├── file-editor/
│   ├── file-preview/
│   ├── transfers/
│   ├── status-monitor/
│   ├── docker/
│   ├── remote-desktop/
│   └── ssh-suspend/
│
└── runtimes/
    ├── workspace/
    │   ├── public.ts
    │   ├── model/
    │   ├── protocol/           # Workspace clean WS DTO/message owner
    │   ├── session/            # session registry/tab lifecycle/reconnect
    │   ├── adapters/           # implements feature ports over WS
    │   ├── layout/
    │   ├── focus/
    │   ├── components/
    │   └── views/
    │
    └── agent/
        ├── public.ts
        ├── model/
        ├── protocol/
        ├── session/
        ├── adapters/
        ├── components/
        └── views/
```

A feature uses only the folders it needs. HTTP-backed domain features normally use:

```text
features/<owner>/
├── public.ts
├── model/
├── api/
├── store/          # only durable/shared feature state
├── composables/    # view/use-case coordination
├── components/
└── i18n/
```

Interactive capability features additionally own a transport-neutral port:

```text
features/terminal/ports/terminal-channel.ts
features/filesystem/ports/filesystem-channel.ts
features/transfers/ports/transfer-channel.ts
features/status-monitor/ports/status-channel.ts
features/docker/ports/docker-channel.ts
```

## 7. Dependency direction

The target graph is:

```text
foundation
   ↑
shared                 client
   ↑                      ↑
feature model/ports       |
   ↑                      |
feature api/state/composable
   ↑
feature components
   ↑
workspace runtime / agent runtime
   ↑
app pages / app shell / bootstrap
```

More precisely:

```text
foundation -> nothing in the product
shared     -> foundation
client     -> foundation only when a generic primitive is truly needed
feature    -> foundation + shared + client + explicitly allowed lower feature public surfaces
runtime    -> feature public surfaces + shared + foundation + client transport
app        -> runtime public surfaces + feature public surfaces + shared + foundation
```

Forbidden arrows:

```text
foundation -X-> feature/runtime/app/client state
shared     -X-> business feature/runtime
client     -X-> Pinia/router/i18n/UI/business model
feature    -X-> app
feature    -X-> workspace runtime
feature    -X-> agent runtime
agent      -X-> workspace runtime/internal files
workspace  -X-> agent runtime/internal files
feature A  -X-> feature B internal store/api/protocol/component paths
```

Cross-feature imports, when unavoidable, use only `features/<owner>/public.ts` and must preserve a DAG.

## 8. Runtime-port design: the key to Agent support

Workspace and Agent should reuse capability contracts, not live runtime objects.

For example Terminal owns the interface it needs:

```text
Terminal feature
  owns TerminalChannel interface
  owns xterm rendering/state
  knows no Workspace message names

Workspace runtime adapter
  implements TerminalChannel over Workspace WebSocket protocol

Agent runtime adapter
  may later implement the same TerminalChannel (if Agent exposes a terminal)
```

The same pattern applies to Filesystem, Transfers, Status Monitor and Docker.

Therefore none of these feature models may contain:

- Workspace WebSocket instance;
- `sessionId` aliases invented by the old runtime unless they are genuine product IDs;
- `sftp:*`, `ssh:*`, `docker:*` legacy message strings;
- NXTM/NXUP framing;
- request dispatcher maps from the old WebSocket manager.

## 9. Replacement for the old Session store

The old `SessionState` contains:

```text
WebSocket manager
SFTP managers
terminal manager
status monitor manager
Docker manager
editor tabs
active editor tab
command input content
connection identity
modal state
suspend state
```

This is the main coupling center and must not be recreated.

Target ownership:

| Old session responsibility                                  | New owner                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| session registry, active Workspace tab, reconnect lifecycle | `runtimes/workspace/session`                              |
| WebSocket connection/protocol dispatch                      | `runtimes/workspace/protocol` + `client/websocket`        |
| terminal renderer/input state                               | `features/terminal`                                       |
| filesystem operation state                                  | `features/filesystem`                                     |
| editor tabs/content state                                   | `features/file-editor`                                    |
| transfer/upload/archive tasks                               | `features/transfers`                                      |
| status subscription/UI state                                | `features/status-monitor`                                 |
| Docker state                                                | `features/docker`                                         |
| RDP/VNC window state                                        | `features/remote-desktop`                                 |
| suspended-session state                                     | `features/ssh-suspend`                                    |
| command input UI text                                       | Workspace command-bar component/composable                |
| global modals                                               | local feature state or Shared Feedback; not session state |

Workspace Session should retain only live runtime identity/lifecycle and adapters required to bind capability ports to one active backend workspace.

## 10. Allowed feature dependencies

The feature graph should remain intentionally small.

```text
proxies -----------\
ssh-keys -----------+--> connections management composition
tags ---------------/

appearance ----------> app/terminal/editor consumers via public settings
preferences ---------> settings page + capability settings adapters

filesystem ----------> transfers (FileEntry/path semantics only if needed)
filesystem ----------> file-editor/file-preview only through narrow file ports/models

quick-commands ------> no Workspace import; emits execute intent
command-history -----> no Workspace import; emits execute intent
```

Prefer page/runtime composition instead of adding a feature dependency. Example: Dashboard should not become a store that imports four stores. `app/pages/dashboard` reads the public APIs/models of Connections, Tags, Audit and System Overview and owns dashboard-only filter/sort UI state itself.

## 11. HTTP boundary before final backend contract migration

Per the current requested order, UI/functionality is restored first and HTTP/WS clean backend alignment happens last.

During frontend rewrite before that final contract step:

```text
component/store clean model
        ↓
feature API adapter
        ↓
legacy wire DTO (temporary, private to api/)
        ↓
current backend /api/v1 compatibility
```

Rules:

- snake_case may exist temporarily only in private `api/wire.ts` or mapper files;
- no component/store/composable clean model can expose snake_case;
- no raw Axios response escapes the feature API;
- no feature store handles global 401 navigation;
- client HTTP has transport behavior only; app bootstrap owns auth/session reaction.

When UI/functionality is complete, each HTTP family is switched to the Backend clean Interface DTO and the corresponding legacy HTTP mapping is deleted.

## 12. WebSocket boundary before final backend contract migration

During UI/functionality restoration, legacy WS compatibility may temporarily be implemented only inside:

```text
runtimes/workspace/protocol/legacy-wire/
```

Feature ports and components still see clean semantics.

Example:

```text
filesystem component
   -> FilesystemChannel.readDirectory(path)
   -> Workspace adapter
   -> temporary legacy wire mapper
   -> `sftp:readdir`
```

This lets all UI/functionality be rewritten without making clean components understand old message strings.

At the final protocol stage, `legacy-wire/` is replaced by clean Workspace message families and backend `interfaces/websocket/legacy-api/` is removed.

NXTM/NXUP remain a separate protocol decision because Engineering Constraints currently classify them as legacy. They must not be silently copied into a new permanent protocol folder.

## 13. i18n ownership

The current split-locale skeleton direction is valid, with one correction: namespace follows the final owner, not old file location.

Examples:

```text
auth.*
security.*
connections.*
filesystem.*
fileEditor.*
filePreview.*
transfers.*
workspace.*
agent.*
```

The build check must continue requiring all three locales to have identical key sets.

No `t(key, hard-coded fallback)` is used as a substitute for missing translations in final code.

## 14. Rewrite sequence after this analysis

No business implementation should be filled before the ownership skeleton exists.

### Phase 0 — architecture/skeleton

1. keep old frontend backed up outside the active source tree;
2. keep active source as a compiling skeleton;
3. create the final `features/` and `runtimes/` folder owners from this document;
4. add README/public boundary contracts for each owner;
5. add/adjust an architecture check for forbidden cross-layer imports where feasible through build/architecture tooling (not a unit test).

### Phase 1 — visual foundation

1. finish base UI primitives;
2. restore theme tokens/global CSS/assets;
3. implement Shared Feedback;
4. implement generic Focus registry;
5. implement generic TokenInput/context-menu/tab primitives only when a real second consumer exists.

### Phase 2 — independent management UI/functionality

Rewrite from clean models outward:

1. Auth + Security;
2. Tags + SSH Keys + Proxies;
3. Connections;
4. Notifications + Audit;
5. Preferences + Backup + Appearance;
6. Dashboard and Settings page composition;
7. Quick Commands + Command History.

### Phase 3 — reusable runtime capabilities

Rewrite independently behind transport-neutral ports:

1. Terminal;
2. Filesystem;
3. File Editor;
4. File Preview;
5. Transfers/Progress;
6. Status Monitor;
7. Docker;
8. Remote Desktop;
9. SSH Suspend.

### Phase 4 — Workspace runtime

1. typed Workspace session registry;
2. protocol adapter boundary;
3. session tabs/reconnect;
4. Workspace layout registry;
5. command bar/focus coordination;
6. compose capability ports/components;
7. mobile/touch Workspace behavior.

### Phase 5 — Agent runtime

Build Agent against reusable feature ports/public surfaces. Agent must not import Workspace internals.

### Phase 6 — backend contract alignment

Only after frontend UI/functionality is restored:

1. clean HTTP family DTOs + delete HTTP legacy layer family-by-family;
2. clean Workspace WS message families;
3. decide/replace/formalize terminal and upload binary framing according to constraints;
4. delete backend WebSocket legacy layer;
5. remove temporary frontend runtime legacy-wire adapters.

## 15. Completion criteria for every rewritten capability

A feature/capability is not considered migrated merely because it builds.

It must satisfy all of the following:

1. user-visible UI and behavior remain consistent with the existing E2E baseline;
2. old code was used only as behavior/reference material, not copied wholesale;
3. no circular import is introduced;
4. store owns only coherent durable/shared feature state;
5. local ephemeral modal/form state stays local where appropriate;
6. cross-feature references use public surfaces only;
7. raw HTTP/WS DTOs do not reach feature components/models;
8. third-party implementation library is isolated to its owner;
9. i18n keys are owner-scoped and three-language complete;
10. relevant real-user E2E is preserved/passes;
11. project architecture/test-policy/build gates pass.

## 16. Immediate refactor decision

The active worktree has been returned to a compiling frontend skeleton. Premature Auth/Connection/etc. feature implementations were removed before this analysis was finalized.

The next code change after this document should be **folder/public-boundary skeleton creation according to the revised structure**, not feature implementation.

## 17. File-level rewrite manifest

The path-level owner checklist is maintained in [`FRONTEND_MIGRATION_MANIFEST.md`](./FRONTEND_MIGRATION_MANIFEST.md). It is the execution checklist for old store/composable/component responsibilities and candidate removals.
