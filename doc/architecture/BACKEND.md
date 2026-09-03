# Nexus Backend Architecture

> Mandatory engineering rules are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md). If explanatory text differs from that register, the constraint register is authoritative.

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

The two runtimes are modeled as separate owners of transport/session state. The non-sharing rule for raw runtime resources is registered in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#workspace-execution-and-agent-boundaries).

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

The Platform layer stays technology-neutral; its enforced dependency restrictions are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#dependency-and-module-architecture).

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

Concrete objects are constructed by `bootstrap`. Infrastructure implements Platform ports and Module-owned technology/persistence ports; the exact dependency restrictions are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#dependency-and-module-architecture).

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

Current Interface responsibilities include:

- authenticating/extracting session identity;
- validating protocol input;
- mapping DTOs;
- selecting HTTP status codes;
- managing HTTP streaming/Range semantics;
- managing WebSocket upgrade, heartbeat and frame-level backpressure;
- calling injected Module services.

Product resource ownership, persistence, and machine-operation algorithms remain in their owning Module/Platform/Infrastructure layers. The enforceable boundary rules are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#layer-responsibility-constraints).

#### Temporary legacy compatibility directories

The current frontend still uses historical HTTP and WebSocket contracts. Compatibility is deliberately isolated in exactly two temporary directories:

```text
interfaces/http/legacy-api/
interfaces/websocket/legacy-api/
```

They contain old snake_case DTO mapping, historical message names, NXTM/NXUP binary framing and other current-frontend compatibility behavior.

The compatibility directories are intentionally temporary. Their import restrictions, ownership rules, and deletion condition are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#legacy-frontend-compatibility). The architecture guard enforces the import boundary.

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

The project-wide ownership rule for generic locations such as `shared`, `utils`, and `helpers` is centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#general-engineering).

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

Technology-specific SFTP pooling is implemented in Infrastructure. The runtime-resource ownership constraints are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#workspace-execution-and-agent-boundaries).

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

The intended Agent integration point is that diagnostics service. The corresponding access restrictions are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#diagnostics-constraints).

Diagnostic actor types are `system`, `agent` and `user`. Actor/scope policy and redaction are applied by `SystemDiagnosticsService`. The complete security constraints for diagnostic access and output are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#diagnostics-constraints).

## Architecture guard

Run:

```bash
npm --prefix packages/backend run check:architecture
```

The guard checks the dependency graph, including layer edges, source cycles, module-level cycles, and legacy compatibility import boundaries. The rules it enforces are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#dependency-and-module-architecture).

## Verification and testing

Architecture verification and user-facing E2E are intentionally separate. The concrete verification commands and E2E policy are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#verification-commands) and [E2E](../testing/E2E.md).

## Placement guide

A practical ownership guide for locating code:

**Platform** when it is a reusable machine capability independent of Nexus product ownership.

**Infrastructure** when it implements a port with SQLite, `ssh2`, filesystem/network libraries, Guacamole, crypto, SMTP, etc.

**Modules** when it owns Nexus product state, authorization/ownership, use-case orchestration, persisted preferences or business policy.

**Interfaces** when it exists because an external HTTP/WebSocket protocol exists.

**Bootstrap** when its primary responsibility is construction, configuration or lifecycle of concrete services.

**Shared** only when no stronger domain/capability owner exists.

## Future AI/Agent integration

The intended AI/Agent integration follows the same application/module/capability split. The normative ownership constraints are centralized in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md#workspace-execution-and-agent-boundaries).

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

The design reuses execution/filesystem/archive/transfer/Docker/diagnostics capabilities while giving the Agent its own execution sessions and policy/approval/task state.
