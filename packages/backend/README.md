# Nexus Backend Architecture

This document defines the long-term backend architecture for Nexus. It is intentionally separate from the temporary root-level `AGENT_RUNTIME_REFACTOR.md`, which tracks the active refactor and must be deleted after the pre-Agent refactor is complete.

## Goals

The backend is structured so that interactive Workspace features and future AI Agent features reuse the same machine-operation capabilities without sharing runtime UI state, WebSocket state, SSH channels, or SFTP handles.

The central rule is:

```text
User Workspace ─┐
                ├──> reusable platform capabilities
AI Agent ───────┘
```

The Agent must not automate the Workspace UI. The Workspace and Agent should both call the same application/platform APIs.

A second rule is equally important:

```text
LLM / Workspace intent
        ↓
application/module policy
        ↓
platform capability
        ↓
infrastructure implementation
```

Protocol and infrastructure details must not leak upward unnecessarily.

---

## Top-level source layout

```text
src/
├── bootstrap/
├── config/
├── infrastructure/
├── interfaces/
├── locales/
├── modules/
├── platform/
├── shared/
├── i18n.ts
└── index.ts
```

Each directory answers a different question.

### `platform/` — reusable machine capabilities

`platform` contains capabilities that remain meaningful even if Nexus has no HTTP API, WebSocket UI, user account, or database task history.

Typical examples:

- execution sessions;
- bounded command execution;
- long-running command sessions;
- remote filesystem contracts;
- archive operations;
- file transfer operations;
- Docker operations;
- server status collection.

A useful test is:

> If the Nexus UI, Workspace model, user database and Agent were removed, would this capability still make sense?

If yes, it probably belongs in `platform`.

Current examples:

```text
platform/
├── execution/
├── filesystem/
├── operations/
│   ├── archive/
│   ├── transfer/
│   └── upload/
├── docker/
└── system/
```

### `infrastructure/` — technical implementations

`infrastructure` contains concrete technology and external-library details used to implement capabilities.

Examples include:

- `ssh2.Client`;
- `ssh2.SFTPWrapper`;
- HTTP CONNECT and SOCKS proxy code;
- SQLite;
- Guacamole;
- backup file formats;
- external transport-specific adapters.

Current examples:

```text
infrastructure/
├── ssh/
│   ├── connection/
│   └── sftp/
├── database/
├── backup/
└── guacamole/
```

The conceptual relationship is:

```text
Modules
   ↓
Platform ports / capabilities
   ↑
Infrastructure implementations
```

The concrete objects are wired in `bootstrap`, not constructed throughout business code.

### Platform vs Infrastructure

The distinction is capability vs implementation.

For example, this is a platform idea:

```ts
interface RemoteFileSystem {
  stat(path: string): Promise<FileMetadata>;
  list(path: string): Promise<FileEntry[]>;
  openRead(path: string): Promise<Readable>;
}
```

This is infrastructure:

```text
ssh2 SFTPWrapper
ssh2 Client
SOCKS proxy socket
HTTP CONNECT socket
```

Long term, platform code should depend on ports/interfaces rather than importing technology-specific implementations directly. During migration, existing concrete SSH execution objects may still live in `platform/execution`; F6 is responsible for tightening composition and dependency inversion where required.

### `modules/` — Nexus product/business state

`modules` contains product concepts that depend on Nexus semantics such as users, ownership, Workspace sessions, persisted preferences, transfer tasks, security rules or notification configuration.

Examples:

```text
modules/
├── workspace/
├── transfers/
├── auth/
├── connections/
├── settings/
├── appearance/
├── notifications/
├── audit/
├── ssh-suspend/
├── terminal-themes/
└── ...
```

A useful test is:

> Does the code care who owns the operation, which Workspace it belongs to, how Nexus stores state, or how product policy behaves?

If yes, it belongs in a module rather than the low-level platform.

### `interfaces/` — protocol boundaries

`interfaces` contains code that translates external protocols into module/platform calls.

```text
interfaces/
├── http/
└── websocket/
```

Interface code may:

- parse and validate input;
- extract the authenticated user/session;
- map HTTP status codes;
- map WebSocket request/response/event frames;
- stream protocol responses;
- call module/application services.

Interface code must not implement SSH, SFTP, transfer, archive, Docker or filesystem algorithms.

The desired WebSocket flow is:

```text
WebSocket frame
     ↓
handler/router
     ↓
Workspace/module service
     ↓
platform operation
     ↓
typed result/event
     ↓
handler/adapter
     ↓
WebSocket frame
```

### `bootstrap/` — composition and lifecycle

`bootstrap` is the composition root.

It is the correct place to construct concrete services and connect infrastructure implementations to platform/module consumers.

Examples of responsibilities:

- construct the SSH connection implementation;
- construct execution/session managers;
- construct Workspace registries and Workspace adapters;
- construct notification services;
- construct HTTP/WebSocket application entry points;
- coordinate process startup/shutdown.

Avoid scattered construction such as:

```ts
new NotificationService()
new TransfersService()
new SshConnectionFactory()
```

inside controllers or unrelated services.

Instead, construct dependencies once in bootstrap/container modules and inject them.

### `shared/`

`shared` is reserved for genuinely cross-cutting primitives with no stronger domain ownership.

Examples:

```text
shared/
├── errors/
├── events/
├── security/
└── types/
```

Do not turn `shared`, `utils`, or `helpers` into a dumping ground.

If a helper is specifically POSIX-shell logic, SSH logic, transfer logic or auth logic, keep it with that capability/module.

---

## Required dependency direction

The preferred dependency direction is:

```text
interfaces → modules → platform
                  ↓
              shared types

infrastructure → platform ports
bootstrap → everything needed for composition
```

Important forbidden directions:

```text
platform → websocket
platform → express
platform → workspace
platform → Vue/UI concepts
modules → express response objects
modules → websocket frames
```

Technology-specific infrastructure imports from modules should also be minimized and moved behind injected dependencies during refactors.

---

## Workspace sessions and execution sessions

These are deliberately different concepts.

### `WorkspaceSession`

A Workspace session is Nexus UI/application state.

It may include:

- Workspace ownership;
- active terminal state;
- UI subscription/binding state;
- Workspace-specific status monitoring state;
- its owned `ExecutionSession`.

### `ExecutionSession`

An execution session owns machine-operation runtime resources.

It may include:

- SSH transport;
- command execution channels;
- long-running command sessions;
- SFTP channel manager;
- cleanup/lifecycle state.

The relationship is:

```text
WorkspaceSession
      │ owns
      ▼
ExecutionSession
```

A future Agent session will independently own another `ExecutionSession`:

```text
Connection configuration
          │
          ├── Workspace ExecutionSession
          └── Agent ExecutionSession
```

They may share stored connection configuration and credentials, but they must not share:

- `ssh2.Client` instances;
- shell channels;
- SFTP handles;
- cwd/env/process state;
- active command sessions.

This prevents browser disconnects or FileManager operations from affecting Agent tasks.

---

## SFTP channel ownership

One execution session can maintain multiple SFTP channels for different traffic classes.

Current roles are:

```text
control
transfer
background
```

Typical usage:

- `control`: readdir/stat/read/write control operations;
- `transfer`: uploads and bulk file data;
- `background`: recursive search/scans/background work.

Do not add ad-hoc fields such as `uploadSftp`, `searchSftp`, `agentSftp`, etc. Channel lifecycle belongs in the SFTP channel manager.

---

## Workspace adapters

Workspace adapters are boundary translators between Workspace-specific product state and reusable core operations.

Example:

```text
WebSocket request
      ↓
WorkspaceSftpTransferAdapter
      ├── resolve Workspace session(s)
      ├── check same-user ownership
      ├── obtain ExecutionSession(s)
      ↓
SftpTransferOperationService
      ├── perform copy/move
      └── emit typed events
      ↓
WorkspaceSftpTransferAdapter
      ↓
WebSocket protocol event
```

Workspace adapters belong to `modules/workspace/adapters`, not to the reusable platform operation directory.

They may know about:

- Workspace ownership;
- Workspace session registry;
- Workspace-specific permission rules;
- current UI client/subscriber;
- existing WebSocket protocol mapping.

Core operation services must not know these things.

This design lets a future Agent call the same operation service directly with its own execution context.

---

## Operation services

Core operation services should operate on explicit context rather than locating Workspace state globally.

Preferred shape:

```ts
operation.execute({
  session,
  input,
  signal,
  onEvent,
});
```

Avoid:

```ts
operation.execute(workspaceSessionId)
// then internally find WorkspaceSessionRegistry and ws.send(...)
```

Core operation services should return typed results/events.

Protocol-specific mapping belongs in interface/adapters.

---

## Server-to-server transfers

Server transfer responsibilities are intentionally separated:

```text
TransferTaskRegistry
    product task ownership/state

TransferOrchestrator
    bounded scheduling and task/sub-task transitions

RemoteTransferExecutor
    one source → target transfer operation

RsyncTransferStrategy / ScpTransferStrategy
    command construction and progress parsing
```

The executor must not own HTTP/API/user task history.

Strategies must not know task IDs, users, Workspace state or controller details.

---

## HTTP controllers and WebSocket handlers

Controllers/handlers should be thin.

They are responsible for:

1. authentication/session extraction;
2. input validation;
3. calling an application/module service;
4. protocol response mapping.

They should not:

- instantiate their own service graph;
- perform SQL directly;
- create SSH clients;
- manipulate raw SFTP handles;
- contain long transfer/archive algorithms;
- infer domain errors by matching arbitrary error-message strings when a typed error can be used.

F5/F8 continue moving the existing large handlers/controllers toward this rule.

---

## Error handling

Prefer explicit error types/codes at application boundaries.

Avoid patterns such as:

```ts
if (error.message.includes('not found')) {
  res.status(404)
}
```

Prefer:

```ts
throw new NotFoundError(...)
```

or an explicit typed result that the interface layer maps to HTTP/WebSocket protocol errors.

Infrastructure errors should be normalized before they reach interface code when practical.

---

## Service composition

Only bootstrap/container modules should know the complete concrete service graph.

Instead of a single ever-growing global service container, prefer small composition groups, for example:

```text
bootstrap/container/
├── platform.container.ts
├── workspace.container.ts
├── auth.container.ts
├── notification.container.ts
└── application.container.ts
```

F6 completes this split.

---

## Testing expectations

Architecture changes are not complete when TypeScript compiles. The backend is protected by layered tests.

### Foundation tests

Foundation E2E/integration tests should directly validate reusable capabilities, including:

- SSH connection factory direct/proxy/jump behavior;
- execution-session lifecycle;
- bounded command cancellation;
- long command cancellation and transport reuse;
- SFTP control/transfer/background channel isolation;
- filesystem HTTP streaming and Range behavior;
- Workspace/Agent-style session isolation;
- archive/upload/transfer operation contracts;
- task cancellation/ownership/concurrency.

### Product E2E

Existing user behavior must remain consistent after internal refactors:

- terminal connect/reconnect/suspend;
- FileManager operations;
- uploads/downloads;
- copy/move;
- archive/decompress;
- Docker manager;
- status monitoring;
- settings/auth flows.

Local browser availability is not the final gate. Full Playwright coverage is validated by remote GitHub Actions.

### Remote Actions gate

Before Agent development begins, the final pre-Agent refactor must pass the full remote Actions E2E suite.

---

## Placement checklist

When adding a backend file, use this decision order.

### Put it in `platform` when:

- it models a reusable machine capability;
- Workspace and Agent could both use it;
- it does not require Nexus user/UI/task semantics.

### Put it in `infrastructure` when:

- it implements a port using `ssh2`, SQLite, Guacamole, filesystem/network libraries, etc.;
- it is fundamentally a technology adapter.

### Put it in `modules` when:

- it owns Nexus product state or policy;
- it needs user ownership, Workspace ownership, preferences or persisted business state.

### Put it in `interfaces` when:

- it exists because HTTP/WebSocket protocol exists;
- it validates/maps external protocol data.

### Put it in `bootstrap` when:

- its primary responsibility is constructing/wiring/lifecycle management of services.

### Put it in `shared` only when:

- there is no stronger feature/capability owner;
- it is genuinely cross-cutting.

---

## Future AI/Agent integration

AI/Agent functionality is a product module, not infrastructure and not a platform primitive.

Planned shape:

```text
modules/ai/
├── providers/
├── conversations/
├── agent/
│   ├── runtime/
│   ├── tools/
│   ├── policy/
│   ├── approvals/
│   └── tasks/
├── memory/
├── skills/
└── mcp/
```

Its dependency direction should be:

```text
interfaces/http|websocket
          ↓
       modules/ai
          ↓
        platform
          ↑
    infrastructure
```

The Agent will use the same execution/filesystem/operation capabilities as Workspace while owning separate runtime sessions.

Agent work must not begin until the backend foundation refactor and final remote E2E gate are complete.
