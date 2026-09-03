# Nexus Backend Architecture

This document describes the backend architecture after the clean-skeleton migration. It is the placement and dependency reference for future backend work, including future AI/Agent features.

## Core direction

The backend separates product orchestration from reusable machine capabilities and concrete technologies:

```text
HTTP / WebSocket interfaces
          ↓
       modules
          ↓
       platform
          ↑
   infrastructure

bootstrap → constructs and owns the complete graph
shared    → genuinely cross-cutting primitives only
```

Workspace and future Agent runtimes reuse the same platform capabilities, but they own independent execution/runtime state:

```text
stored connection configuration
          │
          ├── Workspace ExecutionSession
          └── Agent ExecutionSession
```

They must not share raw SSH clients, shell channels, SFTP handles, cwd/process state or active command sessions.

The JavaScript baseline is ES2025. Backend and Remote Gateway currently compile with TypeScript 7; the Vue frontend uses the project-pinned TypeScript 6 toolchain.

## Source layout

```text
src/
├── bootstrap/       composition root and application lifecycle
├── config/          validated runtime configuration
├── infrastructure/ concrete technology adapters
├── interfaces/      HTTP and WebSocket protocol boundaries
├── modules/         Nexus product/application services and ports
├── platform/        reusable machine capabilities and ports
├── shared/          cross-cutting errors/events/security/types
├── locales/
├── i18n.ts
└── index.ts          minimal process entrypoint
```

### `platform/` — reusable machine capabilities

`platform` contains functionality that remains meaningful without the Nexus HTTP API, Vue UI, user database or Workspace model.

Examples:

- `execution/` — execution sessions, bounded commands, command sessions and shells;
- `filesystem/` — technology-neutral remote filesystem contracts/services;
- `operations/upload/` — streaming upload capability;
- `operations/transfer/` — stream copy/move and server-to-server transfer capability;
- `operations/archive/` — remote archive operations;
- `docker/` — remote Docker capability;
- `system/` — POSIX remote machine status collection;
- `remote-desktop/` — remote desktop gateway port;
- `storage/` — relational database port;
- `diagnostics/` — generic read-only diagnostic probe contract.

A placement test:

> If Nexus users, Workspace state and UI protocol disappeared, would this still be a useful machine capability?

If yes, it probably belongs in `platform`.

Platform code must not import Express, `ws`, `ssh2`, SQLite repositories or Nexus HTTP/WS DTOs.

### `infrastructure/` — concrete technologies

`infrastructure` implements ports with specific libraries, protocols or storage formats.

Examples:

- `database/` — SQLite adapter, schema/migrations and SQLite repositories;
- `ssh/` — `ssh2` connection/execution/SFTP adapters;
- `session/` — file-backed Express session adapter;
- `security/` — AES-GCM, bcrypt and secure token generators;
- `notifications/` — SMTP/Webhook/Telegram network adapter;
- `appearance/` — local background/HTML theme stores and GitHub catalog adapter;
- `backup/` — Nexus backup codec, snapshot adapter and connection ZIP export;
- `guacamole/` — Remote Gateway HTTP adapter;
- `ssh-suspend/` — suspended-session log storage;
- `system/` — local Node host metrics;
- `diagnostics/` — process/database diagnostic probes.

Concrete objects are constructed only by `bootstrap`. Infrastructure must not runtime-import Modules to call application services. A type-only import is allowed where Infrastructure implements a Module-owned persistence/technology port.

### `modules/` — Nexus product/application behavior

`modules` owns Nexus-specific policy, ownership and persisted product concepts.

Examples:

- auth, 2FA, CAPTCHA, IP access policy and Passkeys;
- users, connections, proxies, SSH keys and tags;
- settings, appearance and terminal themes;
- notifications and audit events;
- Workspace lifecycle and user-owned machine operations;
- suspend/resume ownership transactions;
- transfer-task lifecycle;
- backup authorization/workflow;
- remote desktop session use cases;
- system dashboard/cache behavior;
- diagnostics aggregation/access policy/redaction.

Module repositories are defined as ports next to their domain model, for example:

```text
modules/connections/
├── connection.types.ts
├── connection.repository.port.ts
└── connection.service.ts

infrastructure/database/repositories/
└── sqlite-connection.repository.ts
```

SQL column names and encrypted database records stay in Infrastructure. HTTP/WebSocket field names stay in Interfaces. Modules use domain names and application semantics.

### `interfaces/` — external protocol adapters

`interfaces` converts external requests/frames into Module calls and converts typed results/events back into protocol responses.

It may:

- authenticate/extract session identity;
- validate protocol input;
- map DTOs;
- select HTTP status codes;
- manage HTTP streaming/Range semantics;
- manage WebSocket upgrade, heartbeat and frame-level backpressure;
- call injected Module services.

It must not:

- execute SQL;
- construct infrastructure adapters;
- create raw SSH/SFTP clients;
- implement archive/transfer/filesystem algorithms;
- hold product resource-ownership rules that belong in Modules.

#### Temporary legacy compatibility directories

The current frontend still uses historical HTTP and WebSocket contracts. Compatibility is deliberately isolated in exactly two temporary directories:

```text
interfaces/http/legacy-api/
interfaces/websocket/legacy-api/
```

They contain old snake_case DTO mapping, historical message names, NXTM/NXUP binary framing and other current-frontend compatibility behavior.

Rules:

1. New Domain/Module APIs must not adopt legacy field/message names.
2. Bootstrap, Modules, Platform and Infrastructure must not import these directories.
3. The architecture guard enforces that each compatibility directory is consumed only by its matching Interface layer.
4. When the frontend is migrated to the new contracts, each `legacy-api/` directory should be deleted as a directory, not gradually spread into services.

Permanent transport code such as WebSocket upgrade/auth/heartbeat and transparent Remote Gateway forwarding stays outside `legacy-api`.

### `bootstrap/` — composition and lifecycle

`bootstrap` is the only layer that knows the complete concrete object graph.

`composition-root.ts` constructs:

- SQLite repositories;
- security/event/network/file adapters;
- SSH transport and execution-session manager;
- Module services;
- Workspace services;
- diagnostics probes/service.

`application.ts` connects the CompositionRoot to HTTP/WebSocket servers and owns session middleware/server lifecycle.

`main.ts` owns process startup/shutdown and signal/fatal-error handling.

Interfaces receive dependencies; they never import Bootstrap.

### `shared/`

`shared` is for cross-cutting primitives with no stronger domain owner, such as:

- common typed errors;
- application event primitives;
- cryptographic interfaces;
- genuinely shared types.

Do not use `shared`, `utils` or `helpers` as a miscellaneous dumping ground.

## Workspace service responsibilities

Workspace is intentionally split instead of using one state-heavy service:

```text
WorkspaceService
  connection/session lifecycle

WorkspaceTerminalService
  shell data/input/resize/backpressure

WorkspaceShellIntegrationService
  shell PID/prompt integration and safe cwd changes

WorkspaceCommandService
  explicitly allowed Workspace command use cases

WorkspaceFilesystemService
  Workspace ownership → remote filesystem capability

WorkspaceOperationsService
  upload/copy/move/archive orchestration for a Workspace

WorkspaceStatusMonitorService
  Workspace remote status polling

WorkspaceDockerService
  Workspace remote Docker actions

WorkspaceSuspendCoordinatorService
  detach/takeover and transactional resume ownership

WorkspaceEventHub
  typed protocol-neutral application events
```

`WorkspaceSession` contains product/platform state, not WebSocket objects, `ssh2.Client`, `SFTPWrapper`, ACK maps or serialized frames.

## Execution and filesystem ownership

`ExecutionSession` owns one machine transport and the machine-operation resources created from it.

Remote filesystem channels are requested by traffic role:

```text
control     interactive metadata/read/write operations
transfer    upload/copy/bulk data
background  recursive scans/search/background work
```

Technology-specific SFTP pooling belongs in Infrastructure. Do not add Workspace fields such as `uploadSftp`, `agentSftp` or raw handles.

## Suspend/resume ownership

Suspend owns abstract platform resources:

```text
RemoteExecutionTransport + RemoteShellSession
```

It never owns `ssh2.Client` or `ClientChannel` directly.

Resume is transactional:

```text
prepare
  pause live output and prepare transport handoff

attach replacement Workspace
  restore shell integration state
  replay cached output through the active interface protocol

commit
  release suspended ownership

failure → rollback
  restore suspended ownership and resume shell output
```

The legacy NXTM replay/ACK details live only in the WebSocket compatibility layer.

## Diagnostics and future Agent self-diagnosis

Diagnostics are a first-class, read-only extension point.

Platform defines the generic contract:

```text
platform/diagnostics/DiagnosticProbe
```

Infrastructure and Platform capabilities contribute probes. Bootstrap registers probes. Module System owns aggregation, access policy and output redaction:

```text
probe implementations
       ↓
SystemDiagnosticsService
  - actor/scope policy
  - probe selection
  - failure isolation
  - sensitive detail-key redaction
       ↓
structured DiagnosticReport
```

Current CompositionRoot exposure is:

```ts
compositionRoot.modules.diagnostics;
```

A future Agent should call that service, not inspect raw repositories, SSH clients, process internals or database handles.

Diagnostic actor types are `system`, `agent` and `user`:

- `system` may run registered read-only probes;
- `agent` must have an actor ID and may use the safe self-diagnostics scopes;
- `user` diagnostics require an actor ID plus a concrete product subject and cannot inspect host/storage internals through the default policy.

Diagnostic probes must never expose credentials, authorization headers, session cookies, passwords, private keys, raw secrets or arbitrary command output. The Module service additionally redacts sensitive detail keys before returning observations.

Diagnostics are observational only. They are not a command-execution or arbitrary-repair interface.

## Architecture guard

Run:

```bash
npm --prefix packages/backend run check:architecture
```

The guard checks layer edges and circular dependencies. Important rules include:

- root `index.ts` only enters Bootstrap;
- Platform/Modules do not import Express, `ws` or `ssh2`;
- Interfaces do not import Bootstrap/Infrastructure;
- Infrastructure does not runtime-import Modules;
- HTTP/WS legacy compatibility directories cannot leak outside their matching interface layer;
- circular source dependencies are rejected.

Do not add guard exceptions to hide a poor dependency. Fix the ownership/port boundary instead.

## Testing policy

The migration deliberately separates architecture verification from user-facing E2E.

During internal refactors use:

```bash
npm --prefix packages/backend run check:architecture
npm run build:backend
npm --prefix packages/remote-gateway run build
npm --prefix packages/frontend run build
git diff --check
```

Playwright E2E is for behavior a real user can reach through HTTP, WebSocket or the UI. New E2E cases must not directly instantiate internal services/adapters just to test architecture boundaries.

Internal invariants should be protected with TypeScript, the architecture guard and focused lower-level regression checks where necessary.

User-facing regression coverage includes:

- setup/login/2FA/Passkey/session flows;
- connection/settings/theme/backup HTTP behavior;
- terminal connect/reconnect/suspend;
- FileManager and HTTP download behavior;
- upload/copy/move/archive operations;
- Docker and status monitoring;
- Remote Desktop token/tunnel behavior;
- mobile/UI workflows.

The canonical complete Playwright environment is the repository E2E runner image (Node 24 + pinned Playwright Chromium). A local host missing the pinned browser is an environment limitation, not a passing E2E result.

## Placement checklist

Use this order when adding code.

**Platform** when it is a reusable machine capability independent of Nexus product ownership.

**Infrastructure** when it implements a port with SQLite, `ssh2`, filesystem/network libraries, Guacamole, crypto, SMTP, etc.

**Modules** when it owns Nexus product state, authorization/ownership, use-case orchestration, persisted preferences or business policy.

**Interfaces** when it exists because an external HTTP/WebSocket protocol exists.

**Bootstrap** when its primary responsibility is construction, configuration or lifecycle of concrete services.

**Shared** only when no stronger domain/capability owner exists.

## Future AI/Agent integration

AI/Agent functionality belongs in Modules, not Infrastructure and not Platform primitives.

Expected dependency direction:

```text
interfaces
    ↓
modules/ai
    ↓
platform capabilities
    ↑
infrastructure adapters
```

The Agent should reuse execution/filesystem/archive/transfer/Docker/diagnostics capabilities while owning separate execution sessions and its own policy/approval/task state.

Do not make the Agent automate the Workspace UI and do not give it raw infrastructure handles merely to reuse existing functionality.
