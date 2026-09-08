# Nexus App Platform Architecture

> Status: target architecture / design only.
>
> This document defines the plugin-style application host that future Nexus AI applications use. It does **not** mean dynamic third-party plugin installation, an App marketplace, Roleplay, Development, or Operations Agent product code already exists.
>
> Mandatory engineering constraints remain centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md). This document is architecture exploration only; product/software requirements are intentionally deferred until the architecture is accepted.

## 1. Goal

Nexus should provide reusable machine and AI capabilities, while complete product experiences are packaged as **Apps**.

```text
                              Nexus Core
                                  │
                           Nexus App Platform
                 ┌────────────────┼────────────────┐
                 │                │                │
            App Registry      Lifecycle       Permission
                 │                │                │
                 └──────── Capability Broker ──────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
             Shared AI Platform          Machine Platform
                    │                           │
          Model / Conversation           ExecutionSession
          Context / Recall               Filesystem
          Skills / MCP                   Docker
          Artifact / Telemetry           Diagnostics / Transfer
                    │                           │
                    └─────────────┬─────────────┘
                                  │
                            Installed Apps
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              Operations       Roleplay      Development
              built-in App     future App    future App
```

The Operations Agent described in [Operations Agent Architecture](./AGENT.md) is the first **built-in App**. It must use the same App contract that future Apps use instead of receiving an invisible permanent exception merely because it ships with Nexus.

## 2. App, Skill, MCP and ACP are different extension levels

```text
App
  = complete product experience
    routes + UI + domain state + settings + workflows

Skill
  = reusable instructions/workflow/knowledge used inside an App

MCP
  = external Tool/Data capability exposed to an App/Agent

ACP
  = external Agent backend that an App can integrate behind its own runtime contract
```

Examples:

```text
Operations App
├── Agent team / Goal / Plan / approvals
├── Skills: nginx-debug, docker-recovery
├── MCP: Grafana, GitHub, Jira
└── ACP: optional external coding/operations Agent

Roleplay App (future)
├── Character / Persona / Lore / Scene
├── Skills: dialogue/narrative helpers
└── MCP: optional image/TTS/game-state services
```

Installing a Skill does not install an App. Installing an MCP server does not grant an App every MCP Tool. Connecting an ACP backend does not make ACP the Nexus App protocol.

<a id="app-package-contract"></a>
## 3. App package contract

Each App is described by an immutable versioned manifest plus optional Backend, Frontend and static-resource contributions.

Conceptual manifest:

```ts
interface NexusAppManifest {
  schemaVersion: 1;

  id: string;            // stable globally unique id, e.g. "nexus.operations"
  slug: string;          // URL/UI-friendly stable slug, e.g. "operations"
  version: string;
  name: string;
  description?: string;

  nexus: {
    minVersion: string;
    maxVersion?: string;
  };

  trust: 'builtin' | 'signed' | 'isolated';

  capabilities: AppCapabilityRequest[];

  dependencies?: {
    apps?: Array<{ id: string; version?: string; optional?: boolean }>;
    skills?: Array<{ id: string; version?: string; optional?: boolean }>;
  };

  backend?: {
    entry?: string;
    apiNamespace?: string;
    events?: boolean;
  };

  frontend?: {
    entry?: string;
    routeBase?: string;
    navigation?: AppNavigationContribution;
    settings?: AppSettingsContribution[];
  };

  ai?: {
    conversation?: boolean;
    context?: boolean;
    memory?: boolean;
    skills?: boolean;
    toolDiscovery?: boolean;
    artifacts?: boolean;
  };

  resources?: {
    locales?: string[];
    assets?: string[];
  };
}
```

Capability requests may include bounded scope instead of being only booleans:

```ts
interface AppCapabilityRequest {
  id: string;
  required: boolean;
  reason?: string;
  scope?: Record<string, unknown>; // capability-defined validated constraints
}
```

Examples include an allowed outbound-host list, read-only vs mutate class, or an Artifact size ceiling. Capability-specific scope is validated by the host; an App cannot invent scope keys that the capability owner does not understand.

The manifest describes requested capabilities and contributions. It never contains credentials, live sessions, user authorization decisions or raw executable permission tokens.

The manifest is validated before an App can be registered. Unknown schema versions, invalid ids, incompatible Nexus versions, duplicate route ownership or undeclared capability requests fail closed.

## 4. App capability model

An App never receives a generic service locator or raw access to Nexus internals. It requests named capabilities from `AppCapabilityBroker`.

Illustrative capabilities:

```text
AI
├── ai.model.use
├── ai.conversation.read
├── ai.conversation.write
├── ai.context.compose
├── ai.memory.read
├── ai.memory.write
├── ai.skills.use
├── ai.tools.discover
├── ai.artifacts.read
└── ai.artifacts.write

Managed-machine
├── connections.read
├── diagnostics.read
├── execution.command.read
├── execution.command.mutate
├── filesystem.read
├── filesystem.mutate
├── docker.read
├── docker.mutate
├── transfer.read
└── transfer.mutate

App host
├── app.storage
├── app.secrets.write
├── app.secrets.use
├── app.events
├── app.notifications
├── app.settings
└── network.outbound            # scoped hosts/protocols, never blanket by default
```

The permission chain is deliberately layered:

```text
Capability exists in Nexus
        ↓
App declares capability
        ↓
App is granted capability ceiling
        ↓
current user owns/has access to resource
        ↓
App-specific policy
        ↓
operation-specific approval if required
        ↓
execution
```

Therefore:

```text
discoverable != declared != granted != callable != approved
```

For the Operations App, installation/grant of `execution.command.mutate` is only a **maximum ceiling**. `AgentPolicyService`, exact operation hashing and human approval still decide each risky action.

A Roleplay App that never declares machine capabilities cannot obtain an SSH `ExecutionSession` by prompt injection or MCP output.

<a id="app-runtime-boundary"></a>
## 5. Runtime isolation and trust tiers

### 5.1 Built-in App

Built-in Apps ship with Nexus, are compiled/tested with the repository and can run in-process through explicit App SDK contracts.

They still do not receive:

- raw Express router ownership;
- raw SQLite/database handles;
- Workspace runtime objects;
- raw `ssh2` clients;
- another App's store/runtime;
- unrestricted filesystem/process access merely because they are built-in.

The Operations App is initially a built-in App.

### 5.2 Signed trusted App

Future signed Apps may be loaded only after signature/hash/version verification. Whether their Backend code can run in-process is a separate security decision; architecture must not assume signature alone makes arbitrary code safe.

### 5.3 Isolated external App

Untrusted/community Apps should run outside the Nexus Backend process:

```text
external App process/container
        │
        │ App RPC
        ▼
App Host Adapter
        ▼
AppCapabilityBroker
        ▼
approved Nexus capabilities
```

They cannot import Backend source packages or read the Nexus data directory directly.

### 5.4 V1 implementation strategy

The first implementation should support **static built-in App registration only**.

Do not start by executing arbitrary uploaded JavaScript/Node packages. Dynamic install, signed bundles, isolated process hosting and marketplace distribution are later phases after two real built-in Apps have proven the App contract.

This gives plugin-first architecture without prematurely creating a dangerous plugin execution engine.

<a id="app-placement"></a>
## 6. Where Apps live

App placement has two distinct concepts: **repository source** and **installed runtime package/data**.

### 6.1 Built-in App source packages

Target repository ownership:

```text
packages/apps/
└── operations/
    ├── app.manifest.json
    ├── backend/
    │   ├── domain/
    │   ├── orchestration/
    │   ├── backend/
    │   ├── safety/
    │   ├── tools/
    │   ├── settings/
    │   ├── repositories/       # App-owned persistence ports when typed storage is needed
    │   ├── infrastructure/     # App-private technology adapters only when required
    │   └── public.ts
    ├── frontend/
    │   ├── model/
    │   ├── client/
    │   ├── runtime/
    │   ├── components/
    │   ├── views/
    │   └── public.ts
    ├── locales/
    └── assets/
```

Future built-in Apps use sibling packages:

```text
packages/apps/operations/
packages/apps/roleplay/       # only after product requirement exists
packages/apps/development/    # only after product requirement exists
```

The package is an ownership boundary, not permission to cross Nexus layers. Backend code inside the package uses App SDK capability contracts; Frontend code uses the App UI SDK and feature public surfaces.

For Backend dependency enforcement, a compiled built-in App is **not** a new privileged top-level layer. Its domain/application code is treated as application/module-like code; any App-private concrete adapter is isolated in the package's `backend/infrastructure/` subtree. Before the first App package is implemented, the architecture guard must explicitly recognize both source classes without weakening existing rules:

```text
packages/apps/<app>/backend/
  domain | orchestration | safety | tools | settings | ports | public

  may import:
    its own application/domain/port code
    App Platform public SDK/types
    shared AI public contracts/types when explicitly exposed
    shared primitives

  must not import:
    Backend Interfaces
    Bootstrap
    core Infrastructure concrete adapters
    Express / ws / ssh2
    another App package
    Workspace runtime internals
    raw database adapters

packages/apps/<app>/backend/infrastructure/
  may import:
    its own App-owned ports/types
    App SDK adapter contracts
    required external protocol/client libraries
    shared primitives

  must not be imported by:
    App domain/orchestration/safety/tool policy code
```

Machine and secret-bearing Nexus capabilities should normally be injected through `AppCapabilityBroker`/App SDK interfaces rather than obtained by importing concrete Platform/AI services. This keeps App business code portable to a future isolated App host.

If a trusted built-in App defines typed repository ports, either core Infrastructure or the App-private Infrastructure contribution may implement those ports under the same narrow dependency rule; Bootstrap performs the concrete wiring. App-private Infrastructure cannot use its location as a backdoor to import unrelated Nexus repositories/services. The architecture guard must encode these distinctions explicitly when implementation begins.

Do not create empty future App directories merely to demonstrate the architecture.

### 6.2 Core App Platform source

The App host itself stays in the normal Backend/Frontend architecture:

```text
packages/backend/src/modules/app-platform/
├── app-registry.service.ts
├── app-lifecycle.service.ts
├── app-capability-broker.ts
├── app-permission.service.ts
├── app-storage.port.ts
├── app-event.port.ts
└── app.types.ts

packages/frontend/src/features/app-platform/
├── registry/
├── navigation/
├── bridge/
├── settings/
└── public.ts
```

Bootstrap is still the only owner of the complete concrete graph. Built-in App registration is performed from Bootstrap using an explicit registry of compiled App packages.

### 6.3 Installed App packages

Future dynamically installed packages live under the configured Nexus data directory, not repository source and not arbitrary CWD paths:

```text
${NEXUS_DATA_DIR}/apps/
├── installed/
│   └── <app-id>/
│       └── <version>/
│           ├── app.manifest.json
│           ├── backend.bundle
│           ├── frontend.bundle
│           ├── assets/
│           └── integrity.json
│
├── data/
│   └── <app-id>/
│       └── ... app-owned mutable data ...
│
├── cache/
│   └── <app-id>/
│
└── staging/
    └── ... verified before activation ...
```

Rules:

1. uploaded packages enter `staging` first;
2. manifest/integrity/signature/compatibility are verified before installation;
3. activation uses an immutable version directory;
4. mutable App data never lives inside the installed version directory;
5. update installs a new version beside the old version, then switches the active pointer only after health validation;
6. uninstall removes code only after lifecycle shutdown; App data deletion is a separate explicit action;
7. Nexus never executes a package directly from upload/temp/staging;
8. App ids are canonicalized and cannot escape the data directory through `../`, symlink or path tricks.

## 7. App lifecycle

```text
package discovered
      ↓
manifest validated
      ↓
integrity / compatibility checked
      ↓
capabilities reviewed
      ↓
installed
      ↓
enabled
      ↓
initialized
      ↓
running
      ↓
disable / upgrade / uninstall
```

Suggested states:

```ts
type AppLifecycleState =
  | 'discovered'
  | 'installed'
  | 'disabled'
  | 'enabling'
  | 'running'
  | 'degraded'
  | 'disabling'
  | 'failed';
```

Enabling an App is idempotent. A failed App must not prevent Nexus Core from starting unless it is an explicitly required built-in dependency.

App shutdown must release:

- event subscriptions;
- timers/background jobs;
- App-owned model streams;
- App-owned ExecutionSessions;
- temporary artifacts;
- leases;
- external App RPC sessions.

## 8. App storage

Apps never receive the raw relational database handle.

Two persistence patterns are allowed:

### 8.1 Portable namespaced App storage

General plugins use `AppStoragePort` with App identity enforced by the host:

```text
app id + user/tenant scope + logical collection/key
                       ↓
                  AppStoragePort
                       ↓
             Infrastructure storage
```

An App cannot supply another App id to read its data.

### 8.2 Built-in typed persistence

A built-in App with complex durable domain records may define typed repository ports. Concrete persistence adapters are composed through normal Infrastructure/Bootstrap ownership and still never expose the database handle to App domain code.

This is appropriate for Operations Agent records such as runs, delegations and approvals.

Built-in status does not allow raw SQL from domain/orchestration code.

## 9. Backend App protocol

Apps do not register Express routes directly. The Interface layer owns HTTP/SSE/WebSocket mechanics and dispatches through an App host contract.

Target namespace:

```text
/api/v1/apps
/api/v1/apps/<app-id>/...
```

For example:

```text
/api/v1/apps/nexus.operations/definitions
/api/v1/apps/nexus.operations/conversations/:id/runs
/api/v1/apps/nexus.operations/runs/:runId/events
/api/v1/apps/nexus.operations/runs/:runId/approvals/:approvalId
```

Shared platform resources stay outside the App namespace:

```text
/api/v1/ai/providers/...
/api/v1/ai/models/...
```

Transport-neutral App handlers receive authenticated actor/request context from the Interface layer. They cannot choose to skip Nexus authentication, CSRF/session policy, output limits or SSE backpressure behavior.

## 10. Frontend App host

The frontend App Platform owns registration and composition, not App business state.

```text
AppShell
   ↓
FrontendAppRegistry
   ├── navigation contribution
   ├── route contribution
   ├── settings contribution
   └── command/action contribution
          ↓
      App runtime
```

An App cannot directly mutate the global router/sidebar/Pinia graph. It declares contributions; the App Shell decides where/how they appear.

### 10.1 Built-in frontend Apps

Built-in Apps are compile-time lazy chunks imported through a static App registry. This keeps normal Vue performance/tooling and avoids runtime arbitrary-code loading.

### 10.2 Future isolated frontend Apps

Untrusted dynamically installed frontend Apps must not run arbitrary same-origin JavaScript with full page privileges. Prefer a sandboxed iframe/App Bridge model:

```text
sandboxed App UI
      │
      │ postMessage / App Bridge
      ▼
Frontend App Host
      ▼
allowed navigation/theme/i18n/API capabilities
```

The App Bridge exposes explicit UI capabilities rather than `window`, global Pinia stores or internal Vue components.

<a id="app-ui-contributions"></a>
## 11. UI contribution model

An App may contribute only declared surfaces, for example:

```ts
interface AppUiContribution {
  navigation?: {
    label: string;
    icon?: string;
    route: string;
    order?: number;
  };

  routes?: Array<{
    path: string;
    title: string;
  }>;

  settings?: Array<{
    id: string;
    title: string;
    category: 'ai' | 'app';
  }>;

  commandPalette?: Array<{
    id: string;
    title: string;
  }>;
}
```

The Shell owns:

- top-level navigation consistency;
- app enabled/disabled visibility;
- mobile collapse behavior;
- permission/trust badges;
- error boundary if an App UI fails;
- theme/i18n primitives;
- route conflict resolution.

Apps own their interior page layout.

## 12. Apps management UI

A future **Apps** management surface should show:

```text
Apps
├── Installed
│   ├── Operations
│   │    ├── version
│   │    ├── Built-in / trust status
│   │    ├── Enabled
│   │    ├── requested/granted capabilities
│   │    ├── health
│   │    └── data usage
│   └── ...
│
└── Install / Updates        # future dynamic-plugin phase
```

For future installable Apps, install confirmation should present human-readable capability groups such as:

```text
Operations requests:
✓ AI models/conversations
✓ managed connections
✓ diagnostics
✓ execute commands
✓ modify remote files
✓ Docker mutation

Roleplay requests:
✓ AI models/conversations
✓ memory
✓ Skills
✗ managed connections
✗ shell
✗ Docker
```

Capability grants are visible and revocable where technically safe. Revoking a capability can degrade/disable an App rather than silently allowing it.

## 13. App-to-App communication

Apps do not import or reach into each other's runtime/store.

Allowed collaboration uses explicit host-mediated contracts:

```text
App A
  ↓
AppIntent / AppEvent / shared Artifact reference
  ↓
App Platform
  ↓
App B (only if B registered the contract and policy permits)
```

Examples might later include “open this Artifact in Development App” or “send generated image to Roleplay”, but no App receives another App's private state by default.

## 14. Backup and secrets

App packages and App data have separate backup policies.

- built-in package code is restored by Nexus version, not user backup;
- dynamically installed package metadata/version may be backed up as references/checksums where supported;
- App mutable data can opt into the Nexus backup contract only through the App Platform;
- secrets use Nexus secret storage/`SecretCipher`, never generic AppStorage plaintext;
- Apps receive secret references or bounded use capabilities, not decrypted secret listings;
- frontend App state never receives stored secret plaintext.

## 15. Architecture acceptance

The App architecture is healthy when:

- Nexus can compile/run with zero optional Apps enabled;
- Operations Agent is registered through the same App Registry/manifest model as future Apps;
- disabling Operations Agent does not disable shared AI Provider configuration or Workspace;
- AI Platform does not depend on Operations Agent;
- an App cannot obtain undeclared machine capability;
- App capability grant cannot replace user/resource authorization or operation approval;
- App code cannot directly obtain raw DB/SSH/Workspace runtime handles through the public SDK;
- future Roleplay can use model/conversation/context/memory without importing Operations code;
- App frontend contributions cannot mutate another App's runtime state;
- dynamically installed code is not executed in-process until a separately reviewed trust/isolation design is implemented;
- package code, mutable App data and cache/staging have distinct storage locations;
- Bootstrap remains the concrete in-process composition owner and dependency graph remains acyclic.

## 16. Implementation phases

```text
Phase 1
  App Manifest + static App Registry + Capability Broker contracts
  built-in Apps only

Phase 2
  Operations Agent implemented as first built-in App
  proves Backend/Frontend/AppStorage/UI contributions

Phase 3
  second real built-in App
  proves the shared contract is not Operations-specific

Phase 4
  package install/disable/update lifecycle
  integrity/version/capability UI

Phase 5
  signed App distribution

Phase 6
  isolated third-party Backend/Frontend runtime
  marketplace only after security/update model is proven
```

Do not build Phase 4–6 scaffolding before there is a real consumer. The architecture reserves the boundary; implementation follows proven requirements.
