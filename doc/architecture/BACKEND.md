# Nexus Backend Architecture

> Mandatory engineering rules are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md). If explanatory text differs from that register, the constraint register is authoritative.

This document describes the current backend architecture after the clean-skeleton migration and Agent implementation baseline. It is the placement and dependency reference for Workspace, Agent/App Platform, and subsequent backend work.

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

Workspace and Agent runtimes may reuse the same narrow platform capabilities, but they own independent execution/runtime state:

```text
stored connection configuration
          │
          ├── Workspace ExecutionSession
          └── Agent ExecutionSession
```

The two runtimes are modeled as separate owners of transport/session state. The non-sharing rule for raw runtime resources is registered in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-runtime-003).

The JavaScript baseline is ES2025. Backend currently compiles with TypeScript 7; the Vue frontend uses the project-pinned TypeScript 6 toolchain.

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
├── locales/         backend message catalogs
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
- `remote-desktop/` — technology-neutral remote desktop session issuer port;
- `storage/` — relational database port;
- `diagnostics/` — generic read-only diagnostic probe contract.

A placement test:

> If Nexus users, Workspace state and UI protocol disappeared, would this still be a useful machine capability?

If yes, it probably belongs in `platform`.

The Platform layer stays technology-neutral; its enforced dependency restrictions are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-arch-001).

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
- `guacamole/` — in-process opaque-ticket registry and Guacamole runtime adapter;
- `ssh-suspend/` — suspended-session log storage;
- `system/` — local Node host metrics;
- `diagnostics/` — process/database diagnostic probes.

Concrete objects are constructed by `bootstrap`. Infrastructure implements Platform ports and Module-owned technology/persistence ports; the exact dependency restrictions are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-arch-001).

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

Product resource ownership, persistence, and machine-operation algorithms remain in their owning Module/Platform/Infrastructure layers. The enforceable boundary rules are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-layer-001).

#### Clean frontend contracts

The temporary frontend-compatibility directories have been deleted. HTTP routes now validate/map clean camelCase Interface DTOs directly, while persistence-specific shapes remain behind Module/Repository boundaries. WebSocket routes use only the clean Workspace/upload/remote-desktop protocols.

The deleted `interfaces/http/legacy-api/` and `interfaces/websocket/legacy-api/` paths are not permanent extension points and must not be recreated. The current rules are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-legacy-001).

Permanent transport code such as HTTP streaming and WebSocket upgrade/auth/heartbeat/backpressure remains in Interface owners; direct Guacamole handoff is isolated behind the Guacamole Infrastructure adapter.

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
- cryptographic interfaces;
- genuinely shared types.

The project-wide ownership rule for generic locations such as `shared`, `utils`, and `helpers` is centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-gen-003).

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

Technology-specific SFTP pooling is implemented in Infrastructure. The runtime-resource ownership constraints are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-runtime-003).

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

The current clean Workspace protocol does not use the historical replay/ACK envelope or Base64 data payloads. Server-to-browser binary data uses Workspace binary protocol v1: a fixed 16-byte header distinguishes terminal frames from request-scoped response frames and carries the response requestId/length/final boundary. Terminal bytes, SFTP file bytes, editor raw snapshots and suspended-history pages are raw binary payloads; response payloads are split into bounded 256 KiB frames with WebSocket backpressure. Resume restores shell integration and replays cached terminal bytes through this framed binary transport, while lifecycle/control requests remain JSON and backpressure remains an Interface transport concern.

## Diagnostics and Agent self-diagnosis

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

The intended Agent integration point is that diagnostics service. The corresponding access restrictions are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-diag-003).

Diagnostic actor types are `system`, `agent` and `user`. Actor/scope policy and redaction are applied by `SystemDiagnosticsService`. The complete security constraints for diagnostic access and output are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-diag-003).

## Architecture guard

Run:

```bash
pnpm --filter @nexus-terminal/backend run check:architecture
```

The guard checks the dependency graph, including layer edges, source cycles and module-level cycles. The temporary compatibility-import exceptions were removed when the compatibility directories were deleted. The rules it enforces are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-arch-001).

## Verification and testing

Architecture verification and user-facing E2E are intentionally separate. The concrete verification commands and E2E policy are centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md#ec-ver-001) and [E2E](../testing/E2E.md). The repository does not maintain a second lower-level automated test suite.

## Placement guide

A practical ownership guide for locating code:

**Platform** when it is a reusable machine capability independent of Nexus product ownership.

**Infrastructure** when it implements a port with SQLite, `ssh2`, filesystem/network libraries, Guacamole, crypto, SMTP, etc.

**Modules** when it owns Nexus product state, authorization/ownership, use-case orchestration, persisted preferences or business policy.

**Interfaces** when it exists because an external HTTP/WebSocket protocol exists.

**Bootstrap** when its primary responsibility is construction, configuration or lifecycle of concrete services.

**Shared** only when no stronger domain/capability owner exists.

<a id="future-app-ai-platform"></a>

## Agent App Platform and AI applications

Agent/AI functionality follows a **Nexus App Platform + reusable capability platforms + App contributions** model. The current Backend implementation lives under `modules/agent/{host,ai,capabilities,workspace-runtime,runtime,apps/operations}`, concrete adapters under `infrastructure/agent`, HTTP boundaries under `interfaces/http/agent`, the Browser Agent event boundary under `interfaces/websocket/agent-protocol.session.ts` (`/ws/agent`), and composition under `bootstrap/agent`. The plugin host, shared AI capabilities and built-in Operations App are defined in [Agent Architecture](../AGENT.md).

Target composition:

```text
interfaces/http/agent
        │
        ▼
modules/agent/
├── host             App registry/lifecycle/grants/AppStorage/Plugin lifecycle
├── ai               Provider/Conversation/Context/Artifact/Memory/Integration
├── capabilities     Tool Catalog/authorization/policy/approval/lease boundary
├── workspace-runtime Workspace lifecycle/profile/control use cases
├── runtime          Run/event/planning/recovery/collaboration/exchange
└── apps/operations  built-in Operations contribution only
        │
        ▼ typed ports
platform capabilities
        ▲
        │
infrastructure/agent + existing infrastructure adapters

bootstrap/agent validates/registers built-ins and constructs the concrete graph
```

`modules/agent/host` owns App manifest/registry/lifecycle/capability grants/AppStorage/AppIntent and Plugin lifecycle/SDK contracts. It must not import Operations or Runtime private implementation. Backend architecture guard enforces the Agent area dependency matrix.

`modules/agent/ai` owns reusable Provider/model routing, canonical Conversation/User Input, Context, Recall/Memory, Skills, Artifacts and external integration contracts. Generic Tool Catalog and real capability authorization belong to `modules/agent/capabilities`, not AI. AI has no dependency on Operations private implementation.

`modules/agent/workspace-runtime` owns Backend-side Workspace identity/profile/version, settings/setup/cleanup confirmation and Runner control use cases. `infrastructure/agent/workspace-runtime/runner-http.adapter.ts` is the only Backend↔Runner transport adapter: every HTTP/WebSocket call carries the shared Bearer token plus `X-Nexus-Agent-Protocol: 2026-09-13`. Only `provision` sends the full frozen Runner profile; later lifecycle and job calls use the minimal `workspaceId + generation + execution input` contract. Backend user/App/Run identity, optimistic version and operation-hash/idempotency facts remain Backend-owned and are not duplicated into Runner payloads.

The built-in Operations contribution lives at `modules/agent/apps/operations/`. Generic AgentDefinition/Run/AgentRuntime/Plan/Checkpoint/Subagent scheduling belongs to `modules/agent/runtime`; Operations contributes concrete definitions, Tools, risk classification and verification policy through public Agent contracts. It consumes AI and machine capabilities through the Host/Capability boundary rather than owning Infrastructure handles.

### Built-in vs installable Apps

Built-in Apps are trusted compile-time contributions registered by Bootstrap. Installable packages follow the Agent Plugin contract: package staging/signature/file-list verification occurs before activation; Backend target code runs through the Backend-owned process sandbox, Runner target code runs as a generation-scoped native Runner child process under the single-user trust model, and Frontend target assets are served from a separate origin into a sandboxed iframe that owns the full Custom App Surface. That isolated origin also serves the Nexus-owned `/sdk/frontend-v1.mjs`; Frontend Plugin code reaches App-scoped Agent/AppStorage operations only through the bounded MessagePort SDK and never receives Nexus cookies, CSRF material, raw HTTP clients, database, Workspace, Docker socket or other Host objects.

Plugin package bytes, immutable installed versions, AppStorage and runtime workspace/Artifact data remain separate lifecycle owners. Upgrade is stage→validate→quiesce/snapshot→activate/health; migration failure may restore package/version state but cannot claim rollback of already executed remote side effects.

### Capability boundary

An App declaration/grant is a ceiling, not user authorization or action approval:

```text
Nexus capability exists
        ↓
App manifest declares it
        ↓
App grant permits it
        ↓
current user/resource authorization
        ↓
App domain policy
        ↓
operation approval where required
        ↓
Platform execution
```

Apps never receive raw `ssh2` clients, raw database handles, Workspace runtime objects, Express routers or another App's store through the public App SDK.

Provider credentials/model catalogs remain shared AI state and are not copied per App. Conversation history is shared at the canonical factual layer while derived App state remains App-owned. Recall/memory is explicitly App-scoped. Shared Tool discovery does not make Operations shell/filesystem/Docker capabilities available to unrelated Apps.

### App protocol

Apps do not own Express directly. The Interface/App Host dispatches authenticated transport-neutral operations under a generic App namespace:

```text
/api/v1/apps/<app-id>/...
```

Operations examples use `/api/v1/apps/nexus.operations/...`; shared Provider/model resources remain `/api/v1/ai/...`.

HTTP/WebSocket authentication, request bounds, streaming/backpressure and transport lifecycle remain Interface responsibilities. Provider SSE parsing stays inside the Provider adapter; Browser Agent events use the `/ws/agent` Interface boundary. A plugin cannot register a route that bypasses them.
