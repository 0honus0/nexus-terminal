# Nexus Operations Agent App Architecture

> Status: target architecture / design only / not implemented yet.
>
> Operations Agent is designed as the first **built-in Nexus App/plugin**, not as a permanent hard-coded subsystem. The App host/package/capability model is defined by [App Platform Architecture](./APP-PLATFORM.md); shared Provider/Conversation/Context/Memory/Skill/Artifact infrastructure is defined by [AI / Conversation Platform](./AI-PLATFORM.md).
>
> This document collects the current Agent design in architecture only. It does **not** mean an Agent App package, Agent routes, event streams, persistence tables, dynamic plugin loader or user-visible Agent behavior already exists. Software requirements are intentionally deferred until this architecture is accepted.
>
> Mandatory engineering rules remain centralized in [Engineering Constraints](../software-requirements/engineering-constraints.md). If this design conflicts with the constraint register, the constraint register is authoritative.

## 1. Goal

Nexus Operations Agent is an execution-oriented **multi-Agent operations App** for remote machines managed by Nexus. It is packaged/registered through the Nexus App Platform and consumes only declared/granted AI and managed-machine capabilities. A conversation may contain one or more role-defined Agents. Each Agent can use an independent language-model provider/model/configuration from the shared AI Platform, while the App owns operations-specific coordination, Tool policy, approval, audit, persistence and execution semantics.

Multi-Agent is a baseline architectural capability, not a later rewrite. A single-Agent conversation is simply the degenerate case of a conversation with one Agent participant. V1 may ship only a small default team and limited delegation behavior, but the domain model, runtime ownership, model routing, persistence, and protocol must not assume there is only one assistant identity.

Typical V1 scenario:

```text
User selects one SSH connection + Agent team
        ↓
"帮我看看这台服务器为什么 nginx 起不来"
        ↓
Coordinator delegates diagnosis to Linux Ops Agent
        ↓
Linux Ops inspects diagnostics / service status / logs / config
        ↓
Reviewer Agent validates diagnosis/risk
        ↓
Coordinator explains the likely root cause
        ↓
User asks "帮我修"
        ↓
Linux Ops proposes concrete mutation(s)
        ↓
Shared Policy requires approval
        ↓
User approves exact Agent + target + operation
        ↓
Linux Ops executes bounded tool(s)
        ↓
Reviewer verifies nginx state independently
        ↓
Coordinator returns final answer + auditable multi-Agent history
```

## 2. Design principles

### 2.1 Reuse capabilities, not Workspace runtime

Agent and Workspace may operate on the same stored connection configuration, but they must own independent execution/runtime state.

```text
stored connection configuration
          │
          ├── Workspace ExecutionSession
          └── Agent ExecutionSession
```

Agent must not reuse or reach through Workspace internals:

```text
Agent -> Workspace raw WebSocket          forbidden
Agent -> Workspace SessionStore           forbidden
Agent -> Workspace shell/channel          forbidden
Agent -> Workspace SFTP manager           forbidden
Agent -> Workspace current cwd            forbidden
Agent -> Workspace upload socket          forbidden
```

Operations Agent consumes reusable Nexus machine capabilities through its declared/granted App capability contracts; it does not reuse Workspace runtime objects or import concrete Platform/Infrastructure implementations.

See [Backend Architecture](./BACKEND.md#future-app-ai-platform), [Frontend Architecture](./FRONTEND.md#workspace-shared-ai-and-app-runtimes), [App Platform Architecture](./APP-PLATFORM.md), and [AI Platform Architecture](./AI-PLATFORM.md).

### 2.2 Multi-Agent is a composition boundary, not a separate machine layer

Each Agent has its own identity, instructions, model selection, conversation view, runtime state, and allowed capabilities. Multi-Agent coordination happens above the shared tool/execution substrate:

```text
Conversation / Run
      │
      ├── AgentRuntime: coordinator
      │      └── model A
      ├── AgentRuntime: operator
      │      └── model B
      └── AgentRuntime: reviewer
             └── model C
                    │
                    ▼
          Tool / Policy / Approval
                    │
                    ▼
                 Platform
```

Do not create role-specific Platform services or bypass policy because one Agent delegated to another. Delegation changes who is reasoning about the task; it does not change the authorization boundary.

### 2.3 Keep each Agent loop small

The orchestration loop should remain intentionally simple:

```text
model input
   ↓
assistant response
   ├── final/message
   └── tool call proposal(s)
             ↓
         tool policy
      ┌──────┼────────┐
    allow  approval   deny
      │       │         │
      │     user        └── tool error/result to model
      │       │
      └───────┴──→ tool execution
                     ↓
                  tool result
                     ↓
               append history
                     ↓
                    model
```

Complexity belongs around the loop in policy, persistence, streaming, cancellation, audit, checkpointing, and adapters—not in a large opaque Agent framework.

### 2.4 Safety boundaries are deterministic

The model may propose an action and may provide risk hints, but the model is not the security boundary.

Tool availability, target scope, command/path restrictions, mutation classification, approval requirements, timeout/output limits, and secret redaction must be enforced by deterministic Nexus code.

### 2.5 No speculative compatibility layer

Agent V1 must use its own clean contract. It must not create temporary legacy-style adapters, reuse Workspace protocol messages, or add fake endpoints/runtime directories before there is a real consumer.

### 2.6 Native capabilities first, ecosystem adapters later

Nexus-native SSH/filesystem/Docker/diagnostics tools should call typed Nexus capabilities directly. MCP is an extension mechanism for external tools, not a wrapper around Nexus's own core machine capabilities.

## 3. External projects used as design references

The following projects are useful references, but Nexus should not copy any single framework wholesale.

| Project | Nexus should learn from | Nexus should not copy blindly |
| --- | --- | --- |
| OpenHands | Agent / conversation / tool / workspace-style separation, Agent Server boundary, event-oriented runtime | its code-sandbox-oriented Workspace model |
| OpenAI Codex | thread/turn-style execution model, approval protocol, sandbox/permission concepts, deterministic execution policy, context compaction/cache-aware stable prompt evolution | product-specific configuration complexity |
| Claude Code | progressive-disclosure Skills/instructions, bounded tool-result/context discipline, checkpoints/hooks and prompt-injection-aware tool/context handling | coding-IDE assumptions or treating model-side safety classifiers as the primary authorization boundary |
| Grok Build | Goal/Plan concepts, Skills/plugins/hooks/MCP/subagent packaging, explicit no-progress/loop safeguards | adopting marketplace/plugin complexity before Nexus core ownership contracts are stable |
| Cline | task lifecycle, Plan/Act-style UX, approval flow, checkpoints, clear tool activity in UI | IDE-specific coupling |
| mini-SWE-agent | very small Agent loop, bounded independent command execution, linear trajectory | coding-benchmark assumptions |
| Goose | tool permission modes, MCP extension model, explicit risk levels | coarse shell-wide permission as the final policy model |
| LangGraph | durable state-machine concepts, checkpoint/resume, human-in-the-loop | framework ownership of Nexus domain/runtime state |
| MCP | external tool ecosystem | turning all native Nexus capabilities into MCP servers |
| ACP | client↔Agent interoperability, backend decoupling, external Agent runtime integration | using ACP as Nexus internal multi-Agent coordination or making the concrete adapter a V1 requirement |

Resulting design direction:

```text
Agent loop                      ← mini-SWE-agent
Agent/runtime/tool separation   ← OpenHands
Execution/approval protocol     ← Codex
Task/approval UX                ← Cline
Context/cache discipline        ← Codex + Claude Code
Skills progressive disclosure   ← Claude Code + Grok Build
Goal/Plan/checkpoint ideas       ← Cline + Grok Build + LangGraph
Tool permission ideas           ← Codex + Goose
Loop/no-progress guard ideas     ← Grok Build
Durable state-machine concepts  ← LangGraph
External tools                  ← MCP
External Agent backend boundary ← ACP (architecture extension point)
```

## 4. Target architecture: Operations Agent as a built-in App/plugin

Operations Agent is the first built-in application registered through the [Nexus App Platform](./APP-PLATFORM.md). It is **not** a permanent hard-coded Backend subsystem and is not allowed to bypass the same manifest/capability boundaries future Apps use.

Target composition:

```text
Browser
  ↓
Nexus App Shell / App Registry
  ↓
Operations App frontend contribution
  ↓
/api/v1/apps/nexus.operations/...
  ↓
App Interface Host
  ↓
Operations App backend runtime
  │
  ├────────► shared AI capabilities through AppCapabilityBroker
  │            Model / Conversation / Context / Recall / Skills / Artifact
  │
  └────────► managed-machine capabilities through AppCapabilityBroker
               Connections / Diagnostics / Execution / Filesystem / Docker
                       ↓
                    Platform
                       ↑
                Infrastructure adapters

Bootstrap constructs the in-process graph and registers the built-in App.
```

The dependency/capability direction is intentionally one-way:

```text
Operations App
      ↓
App SDK / Capability Broker
      ├── AI Platform
      └── Machine Platform

AI Platform -X-> Operations App
App Platform -X-> Operations domain
other Apps  -X-> Operations runtime/store
```

### 4.1 Operations App package placement

The built-in source package follows the general App placement contract rather than scattering one App permanently across Backend and Frontend core source trees:

```text
packages/apps/operations/
├── app.manifest.json
├── backend/
│   ├── domain/
│   │   ├── agent.types.ts
│   │   ├── agent-definition.service.ts
│   │   ├── agent-goal.service.ts
│   │   ├── agent-plan.service.ts
│   │   └── agent-checkpoint.types.ts
│   ├── orchestration/
│   │   ├── agent-run.service.ts
│   │   ├── agent-runtime.registry.ts
│   │   ├── agent-coordinator.service.ts
│   │   ├── agent-delegation.service.ts
│   │   ├── agent-message-projector.ts
│   │   ├── agent-loop-guard.ts
│   │   └── agent-evaluator.service.ts
│   ├── backend/
│   │   ├── agent-backend.port.ts
│   │   ├── agent-backend-router.ts
│   │   └── native-agent-backend.ts
│   ├── safety/
│   │   ├── agent-policy.service.ts
│   │   ├── agent-approval.service.ts
│   │   └── agent-resource-lease.service.ts
│   ├── tools/
│   │   ├── command.tool.ts
│   │   ├── filesystem.tool.ts
│   │   ├── diagnostics.tool.ts
│   │   └── docker.tool.ts
│   ├── settings/
│   │   ├── operations-settings.service.ts
│   │   └── agent-acp-backend.service.ts
│   ├── repositories/
│   │   ├── agent-definition.repository.port.ts
│   │   ├── agent-run.repository.port.ts
│   │   ├── agent-goal.repository.port.ts
│   │   ├── agent-checkpoint.repository.port.ts
│   │   ├── operations-settings.repository.port.ts
│   │   └── agent-acp-backend.repository.port.ts
│   ├── infrastructure/              # App-private technology adapters only
│   │   └── acp/
│   │       └── acp-agent-backend.adapter.ts
│   └── public.ts
│
├── frontend/
│   ├── model/
│   ├── client/
│   ├── runtime/
│   ├── components/
│   ├── views/
│   └── public.ts
│
├── locales/
└── assets/
```

This package tree is a target ownership model only. No empty package should be created before implementation begins.

Shared Provider/model routing, canonical Conversation/User Input Core, Context Engine/compaction/handoff mechanics, Recall infrastructure, Skills, generic Tool Catalog/discovery/result envelopes, Artifact storage and common telemetry stay in the shared [AI Platform](./AI-PLATFORM.md).

The App Platform owns manifest validation, App registration/lifecycle, capability grants, App storage boundary, route/UI contribution registration and future installation/update isolation. Operations domain code never receives a raw App registry, raw DB handle, raw Express router or Workspace runtime.

### 4.2 Operations App manifest

Conceptually the built-in App declares only the capabilities it needs:

```json
{
  "schemaVersion": 1,
  "id": "nexus.operations",
  "slug": "operations",
  "version": "<nexus-build-version>",
  "name": "Operations Agent",
  "trust": "builtin",
  "capabilities": [
    "ai.model.use",
    "ai.conversation.read",
    "ai.conversation.write",
    "ai.context.compose",
    "ai.memory.read",
    "ai.memory.write",
    "ai.skills.use",
    "ai.tools.discover",
    "ai.artifacts.read",
    "ai.artifacts.write",
    "connections.read",
    "diagnostics.read",
    "execution.command.read",
    "execution.command.mutate",
    "filesystem.read",
    "filesystem.mutate",
    "docker.read",
    "docker.mutate"
  ],
  "frontend": {
    "routeBase": "/apps/operations"
  }
}
```

The manifest is a capability ceiling, **not** a grant to execute every declared operation. The effective action path remains:

```text
App capability granted
        ↓
current user/target authorization
        ↓
AgentDefinition permission profile
        ↓
Tool policy
        ↓
approval when required
        ↓
ResourceLease when required
        ↓
Platform execution
```

So installing/enabling the Operations App cannot itself approve `rm`, service restarts or Docker mutations.

### 4.3 Built-in first, installable later

The first implementation should statically register `nexus.operations` from Bootstrap. Do **not** dynamically execute arbitrary uploaded App code in the Backend process.

Later plugin phases can package the same manifest/backend/frontend contributions under `${NEXUS_DATA_DIR}/apps/installed/<app-id>/<version>/`, as defined by [App placement](./APP-PLATFORM.md#app-placement), without changing the Operations domain model.

### 4.4 Multi-model routing and why the model port stays shared

For `runtime.kind = 'native'`, model selection is owned by each `AgentDefinition.runtime.model`, not globally by the thread or run. Different native Agent participants in the same run may use different providers/models/configuration:

```text
AgentRuntime: coordinator
  └── AgentDefinition.runtime = native / provider-a/model-x

AgentRuntime: operator
  └── AgentDefinition.runtime = native / provider-b/model-y

AgentRuntime: reviewer
  └── AgentDefinition.runtime = native / provider-c/model-z
```

The shared AI Platform `LanguageModelRouter` resolves a native Agent's model configuration to a provider-neutral `LanguageModelPort` implementation after `nexus.operations` has been granted `ai.model.use`:

```text
AgentRuntime
    ↓
LanguageModelRouter
    ├── provider-a adapter
    ├── provider-b adapter
    └── provider-n adapter
```

Model inference is intentionally shared AI Platform capability because multiple Apps may consume the same Provider/model catalog without copying credentials or SDK logic. It remains above concrete Provider adapters and below App-specific orchestration; the Operations App only stores model references and receives normalized model capabilities/events.

### 4.5 Agent backend routing: native and ACP

Multi-Agent orchestration must depend on a provider-neutral **Agent backend** contract rather than assuming every participant is implemented by the Nexus native model loop.

```ts
interface AgentBackendPort {
  start(input: AgentBackendInput, context: AgentRunContext): AsyncIterable<AgentBackendEvent>;
  cancel(runtimeId: string): Promise<void>;
}
```

`AgentBackendRouter` selects the backend from `AgentDefinition.runtime.kind`:

```text
AgentCoordinatorService
        ↓
AgentBackendRouter
   ┌────┴───────────────┐
   ▼                    ▼
NativeAgentBackend   AcpAgentBackendAdapter
   │                    │
   ▼                    ▼
LanguageModelRouter   ACP-compatible external Agent
```

`NativeAgentBackend` owns the Operations App native model/tool loop and uses the shared `LanguageModelRouter`. A future `AcpAgentBackendAdapter` is an Operations-specific technology adapter behind the App-owned `AgentBackendPort`; it translates ACP session/prompt/streaming/permission events into normalized Operations `AgentBackendEvent` values. The concrete adapter may be wired as a trusted App infrastructure contribution, but Coordinator/domain code never imports ACP protocol/client details.

This keeps `AgentCoordinatorService`, `AgentDelegationService`, persistence, budgets, message routing, cancellation, UI events, and audit independent of whether a participant is native or ACP-backed.

A single run may therefore mix backend kinds:

```text
Coordinator  -> native
Linux Ops    -> native
Reviewer     -> native
Coding Agent -> acp
```

ACP is an architecture-supported runtime extension point from the beginning, but the ACP adapter itself is **not currently implemented and is not a V1 delivery requirement unless separately approved**.

## 5. Domain model

### 5.1 AgentDefinition

`AgentDefinition` is the durable role/persona/capability definition. It answers **who this Agent is**, not what one specific run is doing.

```ts
interface AgentDefinition {
  id: string;
  ownerUserId?: number;          // absent for built-in/system definitions
  name: string;
  description?: string;
  instructions: string;
  runtime: AgentRuntimeSpec;
  allowedTools: string[];
  permissionProfile: AgentPermissionProfileName;
  delegationPolicy: AgentDelegationPolicy;
  createdAt: string;
  updatedAt: string;
}

type AgentRuntimeSpec =
  | {
      kind: 'native';
      model: AgentModelConfig;
    }
  | {
      kind: 'acp';
      backendId: string;
      model?: AgentExternalModelRef; // only when that ACP backend exposes safe model selection
      options?: Record<string, unknown>;
    };

interface AgentModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: string;
  providerOptions?: Record<string, unknown>;
}

interface AgentExternalModelRef {
  modelId: string;
  displayName?: string;
}
```

Each Agent can independently select its runtime backend. Native Agents select a Nexus model provider/model; ACP Agents select a configured ACP backend and may optionally select a model only when that backend exposes a safe model-selection capability. The effective runtime/backend/model configuration is snapshotted or version-referenced when a run starts so historical runs remain auditable even if the reusable definition changes later.

Examples:

```text
Coordinator  -> native / provider-a / model-x
Linux Ops    -> native / provider-b / model-y
DBA          -> native / provider-b / model-z
Reviewer     -> native / provider-c / model-r
Coding Agent -> acp / codex-backend / backend-selected-or-explicit-model
```

Provider credentials and ACP backend credentials are never stored in `AgentDefinition`; it stores only logical provider/backend references and safe runtime options.

Delegation must also be bounded per Agent/team. Illustrative policy:

```ts
interface AgentDelegationPolicy {
  canDelegate: boolean;
  allowedAgentDefinitionIds?: string[];
  maxDelegationDepth: number;
  maxDelegationsPerRun: number;
  maxConcurrentChildren: number;
}
```

The run/coordinator additionally owns global budgets such as maximum total model steps, maximum active runtimes, maximum wall time, and optional token/cost budget. These limits prevent infinite Agent ping-pong, recursive delegation loops, and accidental fan-out. Crossing a budget terminates or pauses orchestration through deterministic Nexus policy, not through another model decision.

### 5.2 AgentThread

A thread is the durable user conversation container. It may have one or more Agent participants.

```ts
interface AgentThread {
  id: string;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

A thread may contain multiple messages, runs, and different participant sets over time.

### 5.3 AgentParticipant

A participant binds an AgentDefinition to a thread/run role.

```ts
interface AgentParticipant {
  id: string;
  threadId: string;
  agentDefinitionId: string;
  role: 'coordinator' | 'worker' | 'reviewer' | 'specialist';
  displayName: string;
  enabled: boolean;
}
```

The role controls orchestration semantics only. It does not grant machine permissions by itself; effective permissions still come from the AgentDefinition, run policy, user ownership, and target/tool policy.

### 5.4 AgentMessage

Messages must identify the sender explicitly; the architecture must not assume one global `assistant` identity.

```ts
type AgentMessageRole = 'user' | 'agent' | 'system' | 'tool';

type AgentMessageSender =
  | { type: 'user'; userId: number }
  | { type: 'agent'; participantId: string; runtimeId?: string }
  | { type: 'tool'; toolCallId: string }
  | { type: 'system' };

interface AgentMessage {
  id: string;
  threadId: string;
  runId?: string;
  sender: AgentMessageSender;
  role: AgentMessageRole;
  visibility: 'shared' | 'user' | 'participant';
  recipientParticipantId?: string;
  content: unknown;
  createdAt: string;
}
```

`visibility` lets the coordinator create bounded private working context without forcing every internal thought/tool artifact into every participant's model context. It is a routing/context concept, not a way to hide privileged actions from audit.

Persist model-visible conversation material in normalized/structured form where practical. Do not persist raw SSH/SFTP handles or live transport objects in message content.

<a id="conversation-input-core"></a>
#### 5.4.1 Conversation / User Input Core

User input is a first-class durable source of truth, not disposable prompt text. In normal operation, every user turn is appended to a canonical input ledger and is never overwritten by compaction. A later correction creates a new input that supersedes the old intent semantically; it does not silently rewrite history. Explicit product data-deletion/redaction operations are the exception and remain governed by privacy/retention requirements.

```ts
interface AgentUserInputRecord {
  id: string;
  threadId: string;
  userId: number;
  sequence: number;
  content: unknown;
  attachmentRefs?: string[];
  supersedesInputIds?: string[];
  createdAt: string;
}
```

The runtime does **not** send the entire input ledger to every model turn. Nexus derives several separate views:

```text
Canonical User Input Ledger     = exact durable user source
Recent Exact Window             = latest important turns kept verbatim
User Intent State               = structured current objective/constraints/decisions/open items
Conversation Digest Segments    = compact older history with source ranges
Recall                          = selectively retrieved older facts/history
Checkpoint / Handoff            = explicit durable runtime transition state
```

The important distinction is:

```text
source of truth != compressed working context
```

A compacted summary may be regenerated; the original user inputs remain the canonical evidence for what the user actually requested.

Suggested structured intent state:

```ts
interface AgentUserIntentState {
  threadId: string;
  version: number;
  objective?: string;
  activeRequests: string[];
  constraints: AgentIntentConstraint[];
  preferences: AgentIntentPreference[];
  decisions: AgentIntentDecision[];
  targetRefs: string[];
  openQuestions: string[];
  unresolvedItems: string[];
  corrections: AgentIntentCorrection[];
  sourceInputIds: string[];
  updatedAt: string;
}
```

Intent state is derived context, not a replacement for source messages. Every material objective/constraint/decision should retain source input references so a model switch, evaluator, audit/debug tool or compaction rebuild can trace it back to the user's exact input.

### 5.5 AgentRun

A run is one bounded attempt by a participant set to satisfy a user request.

```ts
type AgentRunStatus =
  | 'created'
  | 'running'
  | 'awaiting_approval'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

interface AgentRun {
  id: string;
  threadId: string;
  userId: number;
  coordinatorParticipantId: string;
  status: AgentRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failure?: AgentFailure;
}
```

A run does not have one global model. Each participant/runtime resolves its own model through its AgentDefinition snapshot.

`interrupted` means durable state survived but live execution resources did not, for example after a backend restart.

### 5.6 AgentRuntime

`AgentRuntime` is the live/durable execution identity for one participant inside one run. This is the key Multi-Agent ownership boundary.

```ts
interface AgentRuntime {
  id: string;
  runId: string;
  participantId: string;
  agentDefinitionSnapshotId: string;
  status: 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
}
```

A single-Agent run still creates exactly one AgentRuntime. A multi-Agent run creates multiple AgentRuntimes under the same AgentRun.

### 5.7 AgentRunContext

Runtime-only context binds one AgentRuntime to its model, targets, live resources, and policy view:

```ts
interface AgentRunContext {
  runId: string;
  runtimeId: string;
  participantId: string;
  userId: number;
  runtimeSpec: AgentRuntimeSpec;
  targets: AgentTargetBinding[];
  permissionProfile: AgentPermissionProfile;
  abortSignal: AbortSignal;
}
```

The context maps logical target aliases to Agent-owned execution sessions:

```text
runtime:ops / "server-a" -> ExecutionSession <opaque internal id>
runtime:dba / "server-a" -> another ExecutionSession <opaque internal id>
```

By default, independent AgentRuntimes do not share raw execution sessions, shell channels, SFTP handles, cwd/process state, or command sessions. Shared target configuration is allowed; shared live transport resources are not.

The model must not receive or choose raw internal `executionSessionId` values.

### 5.8 AgentDelegation

Delegation is a durable orchestration record, not an implicit model-to-model call.

```ts
interface AgentDelegation {
  id: string;
  runId: string;
  fromParticipantId: string;
  toParticipantId: string;
  task: string;
  contextRefs: string[];
  status: 'proposed' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
}
```

Delegation does not transfer permissions. The receiving Agent executes only within its own tool allowlist, permission profile, user/target authorization, and approval policy.

### 5.9 AgentStep

A step is a durable unit in a run trajectory and is always attributed to a participant/runtime when applicable.

```ts
type AgentStepKind =
  | 'model'
  | 'delegation'
  | 'tool'
  | 'approval'
  | 'checkpoint';

interface AgentStep {
  id: string;
  runId: string;
  runtimeId?: string;
  participantId?: string;
  kind: AgentStepKind;
  sequence: number;
}
```

Steps provide audit/debug visibility and make future resume behavior possible without introducing a general workflow engine.

### 5.10 AgentToolCall

```ts
type AgentToolCallStatus =
  | 'proposed'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'denied'
  | 'cancelled';

interface AgentToolCall {
  id: string;
  runId: string;
  runtimeId: string;
  participantId: string;
  stepId: string;
  toolName: string;
  targetAlias?: string;
  normalizedArguments: unknown;
  risk: AgentToolRisk;
  status: AgentToolCallStatus;
  createdAt: string;
  completedAt?: string;
}
```

### 5.11 AgentApproval

Approval is a first-class domain record, not a transient frontend confirm dialog.

```ts
type AgentApprovalDecision = 'approved' | 'denied';

interface AgentApproval {
  id: string;
  runId: string;
  runtimeId: string;
  participantId: string;
  toolCallId: string;
  operationHash: string;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: number;
  decision?: AgentApprovalDecision;
}
```

`operationHash` binds approval to **App id (`nexus.operations`) + acting participant/runtime + target + the exact normalized operation**. A later change to App, Agent, command, path, target, arguments, or mutation semantics creates a different hash and requires a new approval. This prevents approval reuse after a model/coordinator changes the action and prevents a future sibling App from reusing an Operations approval.

## 6. Run lifecycle

Canonical V1 run state model:

```text
created
   ↓
running
   ├───────────────┐
   │               │
   │ tool proposal │
   │               ▼
   │       awaiting_approval
   │          │          │
   │       approve      deny
   │          │          │
   │          ▼          └────→ running
   │       running
   │
   ├──→ completed
   ├──→ failed
   ├──→ cancelling → cancelled
   └──→ interrupted
```

The durable run state and live runtime registry are separate concepts.

Backend process restart behavior:

1. persisted runs previously marked `running`, `awaiting_approval`, or `cancelling` are reconciled;
2. runs with no recoverable live runtime become `interrupted` unless the future checkpoint contract explicitly supports safe resume;
3. raw SSH connections, SFTP handles, shell channels, process streams, and AbortControllers are never reconstructed from database rows;
4. a future resume creates fresh Agent ExecutionSessions and continues only from an explicit durable checkpoint.

### 6.1 Multi-Agent coordination lifecycle

A run has one explicit coordinator participant. The coordinator may answer directly, delegate bounded subtasks, request review, or aggregate participant results.

```text
User request
    ↓
Coordinator AgentRuntime
    │
    ├── direct answer
    │
    ├── delegate → Linux Ops AgentRuntime
    │                   ↓
    │                result
    │
    ├── delegate → DBA AgentRuntime
    │                   ↓
    │                result
    │
    └── review → Reviewer AgentRuntime
                        ↓
                     result
    ↓
Coordinator synthesizes user-facing answer
```

The coordinator is not a privileged super-Agent. It cannot execute another participant's tools by impersonation, inherit another participant's permission profile, or approve operations on behalf of the user.

### 6.2 Delegation and message routing rules

`AgentCoordinatorService` owns orchestration policy; the Operations `AgentMessageProjector` selects the app-specific conversation view for each participant, while the shared Context Engine performs final bounded composition.

Required rules:

1. every delegation has explicit `fromParticipantId` and `toParticipantId`;
2. delegated context is bounded and referenced, not an uncontrolled copy of the entire thread/runtime state;
3. tool results are attributed to the AgentRuntime that actually executed them;
4. an Agent cannot call another model provider directly; cross-Agent work goes through delegation/orchestration;
5. coordinator decisions and worker/reviewer results are persisted as normal run trajectory;
6. user-visible responses must retain participant attribution where it matters;
7. private participant context never bypasses audit or safety policy.

### 6.3 Concurrency model

The architecture supports multiple AgentRuntimes being active in one run, but concurrency must be explicitly bounded by Nexus policy.

```text
AgentRun
  ├── runtime coordinator  running
  ├── runtime ops          running
  ├── runtime dba          waiting
  └── runtime reviewer     idle
```

V1 may execute delegations sequentially even though the data model supports concurrency. Later parallelism can be added without changing ownership because each runtime already has independent model calls, cancellation state, and ExecutionSessions.

Shared mutation serialization is required when multiple Agents operate on the same target/resource. For example, two Agents must not concurrently edit the same file or restart the same service merely because they have independent sessions. Resource-level conflict policy belongs above Platform transport and below model reasoning.

## 7. ExecutionSession ownership behind the App capability boundary

The existing Platform execution model already supports Agent-scoped ownership, but the plugin App must **not** receive `ExecutionSessionManager` or raw session ids directly.

Operations requests a bounded execution capability from `AppCapabilityBroker`:

```text
Operations AgentRuntime
      ↓ runtimeId + logical target
Operations execution Tool
      ↓
AppCapabilityBroker
      ↓ verifies nexus.operations execution capability + current target authorization
Execution capability adapter
      ↓
ExecutionSessionManager / Platform
```

Internally, the trusted capability adapter creates independent Platform sessions with the existing Agent owner semantics:

```ts
// internal adapter/composition detail, not an App SDK method
executionSessions.connect({
  ownerType: 'agent',
  ownerId: runtimeId,
  connection: resolvedConnection,
});
```

The App sees a bounded logical execution capability/target binding, not the raw `ExecutionSession`, SSH client or internal session id. This also prevents the current `ownerType: 'agent'` implementation detail from becoming a required public contract for every future App.

### 7.1 `ownerId` rule

Use the `AgentRuntime.id` as the live execution owner id, not the user id and not the parent run id.

Durable authorization remains on the run/participant definition:

```text
AgentRun.id              = run-123
AgentRun.userId          = 42
AgentRuntime.id          = runtime-ops-1
AgentRuntime.runId       = run-123
AgentRuntime.participant = linux-ops
```

Live resource ownership becomes:

```text
ExecutionSession.ownerType = agent
ExecutionSession.ownerId   = runtime-ops-1
```

This provides deterministic per-Agent cleanup. The execution capability adapter performs the internal cleanup:

```ts
// internal adapter/composition detail
executionSessions.closeByOwner('agent', runtimeId);
```

Operations cancellation asks the capability boundary to close the runtime; the App does not retain the manager. Cancelling the whole run closes every runtime owned by that run. Multi-target AgentRuntimes may create multiple sessions with the same runtime owner while the App maps logical target aliases rather than persisting concrete session ids.

Two AgentRuntimes may target the same stored connection, but they still receive separate live ExecutionSessions by default. This prevents one Agent's cwd/process/channel state from becoming hidden shared state for another Agent.

### 7.2 V1 does not use interactive PTY as the default tool

Although Platform supports `openShell`, Agent V1 should prefer bounded execution:

```text
ExecutionSession.execute()
ExecutionSession.startCommand()  // only when long-lived command semantics are required
```

Do not build a long-lived autonomous interactive PTY in V1. Interactive shells immediately introduce extra state and recovery problems:

- cwd ownership;
- prompt detection;
- foreground-process ownership;
- stdin routing;
- terminal control state;
- reconnect semantics;
- accidental coupling to WorkspaceTerminal behavior.

If later requirements prove an interactive shell is necessary, add an Agent-owned shell-session abstraction instead of reusing Workspace shell state.

## 8. Tool model

### 8.1 Tool contract

Tools are narrow Agent-owned wrappers around existing capabilities.

Illustrative contract:

```ts
interface AgentTool<TInput, TResult> {
  readonly name: string;
  readonly description: string;

  inspect(input: TInput, context: AgentRunContext): Promise<AgentToolInspection>;

  execute(input: TInput, context: AgentRunContext): Promise<TResult>;
}
```

`inspect` normalizes the operation and returns deterministic metadata used by policy:

```ts
interface AgentToolInspection {
  normalizedArguments: unknown;
  targetAlias?: string;
  risk: AgentToolRisk;
  mutation: boolean;
  operationHash: string;
}
```

The exact TypeScript API may evolve during implementation; the ownership and policy separation are the required part.

### 8.2 Native V1 tools

Start with a deliberately small tool set:

```text
diagnostics.run
shell.exec
fs.list
fs.read
```

Then expand only after the approval/audit path is proven:

```text
fs.write
fs.remove
docker.inspect
docker.restart
transfer.*
archive.*
```

Native tool mapping:

```text
AgentCommandTool
    ↓
ExecutionSession.execute()

AgentFilesystemTool
    ↓
ExecutionSession.fileSystem('control')

AgentDiagnosticsTool
    ↓
compositionRoot.modules.diagnostics / DiagnosticsService

AgentDockerTool
    ↓
Platform Docker capability
```

Do not expose a generic "call arbitrary Platform method" tool to the model.

### 8.3 Tool output constraints

Every tool owns bounded, model-safe output behavior, including as applicable:

- timeout;
- maximum stdout/stderr bytes;
- maximum file read size;
- maximum directory result count;
- path normalization;
- connection/target scope;
- sensitive-value redaction;
- structured error normalization;
- cancellation propagation;
- audit metadata.

Large raw command/file output should be truncated or summarized with explicit truncation metadata rather than streamed unbounded into model context.

## 9. Policy and approval

### 9.1 Decision model

```ts
type ToolDecision =
  | { kind: 'allow' }
  | { kind: 'requireApproval'; reason: string }
  | { kind: 'deny'; reason: string };
```

Every tool call goes through policy before execution.

### 9.2 Risk model

Suggested initial risk levels:

```ts
type AgentToolRisk =
  | 'read'
  | 'mutate'
  | 'destructive'
  | 'forbidden';
```

Examples:

| Operation | Suggested risk |
| --- | --- |
| `diagnostics.run` | read |
| `fs.list` | read |
| `fs.read` | read |
| `systemctl status nginx` | read |
| bounded `journalctl` | read |
| `fs.write` | mutate |
| `systemctl restart nginx` | mutate |
| `docker restart` | mutate |
| `fs.remove` | destructive |
| destructive disk/host operations | forbidden or explicit exceptional policy |

### 9.3 Command risk is not shell-wide permission

`shell.exec` cannot permanently be treated as one undifferentiated risk level.

A deterministic command policy should classify recognized operations where possible:

```text
ls /etc/nginx                 → read
systemctl status nginx        → read
journalctl -u nginx           → read
systemctl restart nginx       → mutate
apt install ...               → mutate
rm ...                        → destructive
mkfs ...                      → forbidden by default
shutdown / reboot             → destructive / explicit policy
```

Unknown or hard-to-parse shell operations should fail closed into approval or denial according to the active permission profile.

The model may help explain an operation, but deterministic Nexus policy decides whether the operation can run.

### 9.4 Permission profiles

V1 can keep profiles simple:

```text
observe
standard
autonomous
```

Suggested semantics:

#### `observe`

- read-only diagnostics/filesystem/status operations allowed;
- mutation tools denied;
- intended for analysis-only sessions.

#### `standard`

- bounded read operations auto-allowed;
- mutations require approval;
- destructive operations require stricter approval or remain denied.

#### `autonomous`

- selected low-risk mutations may be auto-allowed by explicit Nexus policy;
- destructive/high-impact operations still require approval or are forbidden;
- this profile must never mean "model can run anything".

Profile names and exact permissions are product policy and may change, but the policy service remains the owner.

### 9.5 Approval flow

```text
model proposes tool call
        ↓
tool normalizes arguments
        ↓
policy = requireApproval
        ↓
persist AgentToolCall + AgentApproval(operationHash)
        ↓
emit tool.awaiting_approval
        ↓
user sees exact target / operation / reason / risk
        ↓
approve or deny
        ↓
server recomputes/validates operationHash
        ↓
execute exact approved operation or reject stale approval
```

Approval must be server-side authoritative. The frontend cannot bypass it by sending a tool-execute request directly.

## 10. Diagnostics integration

Agent self-diagnosis goes through the existing Module diagnostics service:

```text
AgentDiagnosticsTool
        ↓
DiagnosticsService / SystemDiagnosticsService
        ↓
registered bounded probes
```

The Agent must not read diagnostic data directly from repositories, raw SSH clients, database handles, unrestricted process internals, or arbitrary logs.

Existing diagnostics access policy/redaction remains authoritative. Agent tool output must preserve the same secret-safety expectations.

<a id="recall-long-term-memory"></a>
### 10.1 Recall / long-term memory boundary

Recall is a context-retrieval capability, not an authorization mechanism. Its purpose is to retrieve a small amount of relevant historical knowledge without replaying the entire thread/run history into every model call.

```text
current AgentRuntime task
        ↓
shared ContextEngineService
        ↓
Operations AgentRecallPolicy
        ↓
shared RecallPort
        ↓
shared MemoryRepositoryPort
        ↓
relevant bounded memory items
        ↓
context budget / redaction
        ↓
Native or ACP-backed Agent context
```

The shared AI Platform contract stays retrieval-engine neutral; the Operations Agent supplies its app-specific scope/policy context:

```ts
interface RecallPort {
  recall(request: AgentRecallRequest, context: AgentRecallContext): Promise<AgentRecallResult>;
}

type AgentRecallScope = 'thread' | 'target' | 'agent' | 'task' | 'user';

interface AgentRecallRequest {
  query: string;
  scopes: AgentRecallScope[];
  limit: number;
  maxContextBytes?: number;
}

interface AgentRecallContext {
  userId: number;
  runId: string;
  runtimeId: string;
  participantId: string;
  agentDefinitionId: string;
  targetIds: string[];
}

interface AgentRecallItem {
  id: string;
  type: 'message' | 'run-summary' | 'fact' | 'procedure' | 'outcome';
  content: string;
  source: {
    threadId?: string;
    runId?: string;
    targetId?: string;
    agentDefinitionId?: string;
  };
  relevance?: number;
  createdAt: string;
}
```

V1 does not require embeddings, a vector database, or a general-purpose memory framework. The first implementation may use only recent messages, thread/run summaries, and bounded structured history retrieval. The shared `RecallPort` allows later implementations to use SQLite FTS, vector search, hybrid retrieval, reranking, or an external memory service without changing Operations Agent orchestration or future app domains.

#### Recall scopes

The most useful Nexus scopes are:

```text
thread
  previous relevant conversation/run summaries in the same thread

target
  previous incidents, changes, outcomes and operational facts for the same managed connection/server

agent
  durable role-specific knowledge that is allowed for the current AgentDefinition

task
  prior related task/run outcomes and procedures

user
  explicitly allowed user-level preferences/context only
```

`target` recall is especially valuable for Nexus operations: an Agent can know that a server previously had an nginx certificate-path failure or that a particular deployment uses a non-default config path, while the original bounded tool/audit history remains available separately.

#### Memory records vs raw history

Do not turn every raw tool output into long-term memory. Large logs, file contents and command output remain in bounded run/audit persistence according to their existing retention rules. Long-term memory should prefer compact structured records such as:

```ts
interface AgentMemoryRecord {
  id: string;
  userId: number;
  targetId?: string;
  agentDefinitionId?: string;
  sourceRunId: string;
  kind: 'fact' | 'procedure' | 'incident' | 'outcome';
  summary: string;
  facts?: string[];
  actions?: string[];
  outcome?: string;
  visibility: AgentMemoryVisibility;
  createdAt: string;
}
```

Memory creation is a Nexus-owned post-run/context process. A model may suggest candidate facts, but Nexus decides what is eligible to persist, applies size/redaction/visibility policy, and records source provenance.

#### Multi-Agent recall visibility

Multi-Agent does not imply one shared unrestricted memory pool. `AgentRecallPolicy` filters candidates by user ownership, target authorization, participant role, AgentDefinition, memory visibility and current task context before anything enters a participant's model context.

For example:

```text
Coordinator -> thread summaries + delegation outcomes
Linux Ops   -> target operational history + relevant procedures
DBA         -> database-related target memory
Reviewer    -> proposed mutations + audit/review outcomes
```

A private participant memory or another Agent's internal working context is not automatically visible to every participant. Recall visibility affects model context only; it never hides privileged actions from durable audit.

#### Recall never grants permission

Historical memory is informational only:

```text
"user approved nginx restart last week"
                  ≠
"restart nginx is approved now"
```

Recall output cannot raise a permission profile, satisfy an approval, authorize a target, reuse an old `operationHash`, or bypass current `AgentPolicyService`. Every current privileged action still goes through the normal Tool → Policy → Approval path.

Recall results must also pass the same secret/redaction and context-size rules as other model-visible input. Memory containing stale, conflicting, or low-confidence information should retain provenance and must not be treated as authoritative machine state; current diagnostics/tool observation wins when verification is required.

<a id="agent-harness-optimization"></a>
### 10.2 Agent Harness optimization layer

The Nexus Agent should be treated as an **Agent Harness / control plane**, not only as a loop that forwards messages to a model. The harness owns context efficiency, skill/tool exposure, large-result handling, loop safety, resource coordination, durable goals/checkpoints, verification and measurable quality/cost.

Target runtime flow:

```text
AgentRun / AgentGoal
        ↓
AgentCoordinatorService
        ↓
AgentRuntime
        ↓
AgentBackendRouter
        ↓
shared ContextEngineService
   ├── Context Planner / Budget
   ├── Instruction sources
   ├── Skills
   ├── Recall
   ├── Checkpoint
   └── Artifact references
        ↓
Native Model / ACP Agent
        ↓
Tool Discovery
   ├── Native tools
   └── MCP tools
        ↓
Tool proposal
        ↓
Policy / Approval
        ↓
Resource Lease
        ↓
Platform / ExecutionSession
        ↓
ToolResultProcessor
   ├── model-visible summary
   ├── structured data
   └── full Artifact reference
        ↓
LoopGuard / Evaluator
        ↓
continue / replan / verify / stop
```

Cross-cutting services:

```text
shared AiTelemetryService
Operations Agent Eval Harness
shared ContextSafetyService
Operations AgentCheckpointService
```

The following sections define the architecture boundaries. They do not mean every advanced capability is required in the first product release.

#### 10.2.1 Context Engine and token budget

The shared `ContextEngineService` should not concatenate every available message, memory, Skill and tool result. It delegates to shared planning/budget mechanics while Operations Agent contributes app-specific AgentDefinition/Goal/Plan/delegation/target sections.

```ts
interface ContextPlan {
  epochId: string;
  sections: ContextSection[];
  estimatedTokens?: number;
  totalBytes: number;
  truncated: boolean;
}

interface ContextSection {
  kind:
    | 'system'
    | 'agent-definition'
    | 'instructions'
    | 'goal-plan'
    | 'skill'
    | 'recent-message'
    | 'recall'
    | 'delegation'
    | 'tool-result'
    | 'checkpoint'
    | 'artifact-ref';
  stability: 'stable' | 'semi-stable' | 'dynamic';
  content: unknown;
  bytes: number;
  priority: number;
  provenance?: AgentContextProvenance;
}
```

Recommended ordering:

```text
Stable prefix
├── Nexus system/security contract
├── AgentDefinition instructions
├── stable environment/capability metadata
└── stable tool-discovery primitives

Semi-stable
├── active Goal
├── active Plan
├── target facts
├── loaded Skill instructions
└── current checkpoint

Dynamic tail
├── current user/delegation task
├── recent messages
├── Recall results
├── tool results
└── verification feedback
```

Rules:

1. each section has an independent byte/token budget and priority;
2. low-priority history is summarized/recalled rather than replayed wholesale;
3. large tool/file/log content is represented through Artifact references;
4. the context planner preserves a stable ordering and, where provider behavior supports it, keeps the stable prefix unchanged across turns to improve prompt-cache reuse;
5. model/provider/tool-schema/security-contract changes that materially alter the stable prefix start a new **context epoch** instead of silently mutating the meaning of an old epoch;
6. changing models repeatedly inside one AgentRuntime merely to save a small amount of cost is discouraged because it complicates context/cache semantics; deliberate model changes should occur at a checkpoint/runtime-epoch boundary;
7. the planner records which sources were included so debugging/token telemetry can explain context growth.

The architecture must not depend on a provider-specific prompt-cache API. Cache-aware ordering is an optimization policy above the provider adapter, not a correctness requirement.

##### 10.2.1.1 Incremental conversation compaction

Every completed user/model/tool turn runs a **compaction planning pass**, but that pass does not automatically call a model or rewrite the full history. It updates the working state incrementally and performs real summary work only when a budget/watermark requires it.

```text
new user input
    ↓
append canonical input/message
    ↓
update UserIntentState from previous state + new delta
    ↓
advance Recent Exact Window
    ↓
Compaction Planner
    ├── under budget -> no-op / metadata update only
    └── over budget  -> compact only newly-eligible older range
                           ↓
                   Conversation Digest Segment
                           ↓
                source message/input references
```

Do **not** implement this as:

```text
turn 1 -> summarize history
turn 2 -> summarize full history again
turn 3 -> summarize full history again
...
```

That pattern wastes tokens and compounds summary drift.

Suggested durable compaction record:

```ts
interface AgentConversationDigest {
  id: string;
  threadId: string;
  fromSequence: number;
  toSequence: number;
  sourceMessageIds: string[];
  sourceInputIds: string[];
  previousDigestId?: string;
  summary: string;
  preservedFacts: string[];
  preservedConstraints: string[];
  openItems: string[];
  tokenEstimate?: number;
  createdAt: string;
}
```

Working context should normally be composed from:

```text
stable system/Agent instructions
+ current Goal / Plan / Checkpoint
+ current UserIntentState
+ compact digest segment(s) for older history
+ recent exact user/agent messages
+ relevant Recall
+ current tool/delegation evidence
```

The **recent exact window** preferentially keeps the latest user inputs verbatim, especially corrections, explicit constraints, approvals/denials, target selections and unresolved questions. Older assistant verbosity and repetitive tool chatter should be compacted before user-authored constraints are removed from exact context.

Compaction rules:

1. original user inputs/messages are never replaced by a digest;
2. every digest has exact source sequence/message/input references;
3. each turn updates `AgentUserIntentState` incrementally from the previous state plus the new source delta;
4. a compaction operation normally summarizes only the newly eligible range after the previous compaction watermark;
5. recursive summary-of-summary chains are bounded; after a configured generation/depth, checksum mismatch, evaluator warning, major model/context-epoch switch, or suspected drift, Nexus rebuilds the compact state from canonical source ranges rather than repeatedly compressing the latest summary;
6. exact high-priority user constraints can be pinned independently of normal history eviction;
7. duplicated facts appearing in Goal/Plan/Intent/Recall/Digest should be de-duplicated in the final Context Plan rather than paid for multiple times;
8. compaction itself has token/cost budgets and should prefer deterministic extraction/structured merging where possible before invoking an additional summarizer model;
9. tool outputs remain Artifact-backed and are referenced by evidence ids instead of copied into conversation digests;
10. compaction never invents authorization. Approval/denial events may be summarized as history, but current operation authorization is always recomputed.

##### 10.2.1.2 Model / Runtime switch handoff

Switching model, provider, AgentRuntime, coordinator, or context epoch must not depend on replaying the complete conversation. Nexus builds a structured handoff bundle from durable state:

```ts
interface AgentContextHandoff {
  threadId: string;
  runId?: string;
  fromContextEpochId: string;
  toContextEpochId: string;
  latestExactUserInputIds: string[];
  intentStateVersion: number;
  goalId?: string;
  planId?: string;
  checkpointId?: string;
  digestIds: string[];
  unresolvedItems: string[];
  criticalConstraintRefs: string[];
  decisionRefs: string[];
  targetRefs: string[];
  recallRefs: string[];
  artifactRefs: string[];
  createdAt: string;
}
```

The new runtime/model receives the same explicit objective, user constraints, decisions, unresolved questions, current plan/checkpoint and evidence references, plus a bounded recent exact window. It does **not** require provider-specific hidden reasoning or hidden chain-of-thought from the previous model. Nexus preserves explicit durable state and evidence, not inaccessible internal model reasoning.

For a major switch, the Context Planner may rebuild a fresh context epoch from canonical source + current structured state. This can cost more once, but avoids carrying forward accumulated compression errors indefinitely.

##### 10.2.1.3 Participant-specific conversation views

The canonical history is thread-wide, but model context is runtime-specific. Multi-Agent must not multiply token cost by sending the same complete conversation to every participant.

```ts
interface AgentConversationView {
  threadId: string;
  runtimeId: string;
  participantId: string;
  intentStateVersion: number;
  exactInputIds: string[];
  digestIds: string[];
  criticalConstraintRefs: string[];
  relevantDecisionRefs: string[];
  unresolvedItemRefs: string[];
  delegationContextRefs: string[];
  evidenceRefs: string[];
}
```

Typical projections:

```text
Coordinator
  -> broad current UserIntentState
  -> latest exact user inputs
  -> Goal/Plan/open questions
  -> worker/reviewer results

Specialist / Worker
  -> delegated task
  -> only relevant target/user constraints
  -> selected exact source inputs when wording matters
  -> relevant evidence/Recall

Reviewer
  -> claimed objective/acceptance criteria
  -> mutation proposal/result
  -> critical user constraints
  -> independent verification evidence
```

Operations `AgentMessageProjector` + shared `ContextPlanner` own this projection. A participant-specific view may omit irrelevant conversation content but cannot silently omit a critical constraint scoped to that participant's operation. Critical user constraints therefore support explicit scope/pinning and source references, and compaction/context validation checks that required pinned constraints survive into the effective view.

This gives Nexus one durable conversation truth with many bounded execution views instead of many duplicated conversations.

#### 10.2.2 Instruction sources and context trust

Nexus will eventually receive instructions/data from multiple trust levels. They must not all become equivalent system instructions.

```ts
type AgentInstructionTrust = 'trusted' | 'semi-trusted' | 'untrusted';

type AgentInstructionSourceKind =
  | 'system'
  | 'user-settings'
  | 'agent-definition'
  | 'skill'
  | 'project'
  | 'remote-file'
  | 'mcp'
  | 'web'
  | 'tool-output';
```

Typical policy:

```text
system / explicit user settings / approved built-in skill
    -> trusted

project AGENTS.md / CLAUDE.md / NEXUS.md
    -> semi-trusted instructions with bounded scope

logs / remote file contents / MCP output / web content
    -> untrusted data, not instructions
```

`AgentContextSafetyService` classifies/sanitizes model-visible content and may annotate, quarantine, truncate or reject suspicious instruction-like text from untrusted sources. This is defense in depth; it never replaces Tool/Policy/Approval.

Project instruction compatibility may support common files such as `AGENTS.md`, `CLAUDE.md`, or a Nexus-specific file later, but remote repository content must not silently become equivalent to Nexus system policy.

#### 10.2.3 Tool result processor and Artifact Store

Large tool output must not be copied directly into model context or general audit logs.

```ts
interface AgentToolResultEnvelope<TStructured = unknown> {
  summary: string;
  structured?: TStructured;
  preview?: string;
  artifactRef?: string;
  truncated: boolean;
  originalBytes: number;
  modelVisibleBytes: number;
}
```

Processing flow:

```text
Tool raw result
      ↓
shared ToolResultProcessor
      ├── secret/redaction filter
      ├── structured extraction
      ├── bounded preview
      ├── summary
      └── full/bounded Artifact storage when needed
             ↓
        artifactRef
```

The shared `ArtifactStorePort` owns large run artifacts such as bounded command output, generated patches, diff previews, test reports or other data that should be fetched incrementally rather than injected repeatedly; ownership metadata still records `nexus.operations` and the producing Run.

Artifacts require:

- user/run ownership;
- MIME/type and byte size metadata;
- retention/expiry policy;
- secret/redaction rules before model-visible reads;
- bounded range/read APIs;
- audit correlation;
- no public unauthenticated path by default.

The Agent may use a narrow `artifact.read` tool or equivalent context operation to request a bounded range/section. Artifact access is context retrieval, not a raw filesystem escape hatch.

#### 10.2.4 Skills with progressive disclosure

A **Skill** describes reusable task knowledge/workflow. It is distinct from both Agent identity and executable tools:

```text
AgentDefinition = who performs the work
Skill           = how a class of work should be approached
Tool / MCP      = what capability can actually be invoked
```

Suggested manifest:

```ts
interface AgentSkillManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  source: 'builtin' | 'user' | 'project' | 'extension';
  trust: AgentInstructionTrust;
  tags?: string[];
  requiredCapabilities?: string[];
  suggestedTools?: string[];
  resources?: AgentSkillResourceDescriptor[];
  scripts?: AgentSkillScriptDescriptor[];
}
```

Progressive disclosure is required for token efficiency:

```text
startup/context planning
      ↓
load only skill metadata
(name/description/tags/requirements)
      ↓
shared SkillResolver finds relevant candidates
      ↓
load selected Skill instructions
      ↓
load referenced resource/script only if needed
```

Rules:

1. installing many Skills must not inject all Skill bodies into every prompt;
2. `suggestedTools` can narrow/discover capabilities but never grant a tool permission;
3. Skill scripts run only through an explicit Nexus execution/tool boundary with policy/approval appropriate to their actions; a Skill is not an unrestricted shell plugin;
4. project/user Skills carry explicit trust/source metadata;
5. Skill content is versioned/snapshotted for an auditable run when it materially affects execution;
6. Skills can declare optional MCP dependencies without making MCP a required internal capability path.

Examples:

```text
nginx-diagnostics
systemd-debug
linux-disk-pressure
ssl-certificate-repair
docker-troubleshooting
mysql-performance
```

Do not create a separate AgentDefinition for every narrow procedure when the difference is primarily reusable knowledge rather than identity/model/permission policy.

#### 10.2.5 Dynamic Tool Discovery and MCP

The model should not receive every registered native/MCP tool schema when the tool catalog becomes large.

```text
shared ToolCatalog
    ├── Native descriptors
    └── MCP descriptors
            ↓
shared ToolDiscoveryService
    ├── search(query)
    └── describe(toolIds)
            ↓
selected tool schemas only
```

A lightweight descriptor may contain:

```ts
interface AgentToolDescriptor {
  name: string;
  description: string;
  source: 'native' | 'mcp';
  serverId?: string;
  tags?: string[];
  riskHint?: AgentToolRisk;
  requiredCapabilities?: string[];
}
```

Tool discovery and tool authorization are separate:

```text
discoverable != callable != approved
```

The normal path remains:

```text
Tool Discovery
      ↓
load selected schema
      ↓
tool proposal
      ↓
AgentPolicyService
      ↓
Approval if required
      ↓
execute
```

For a small V1 native tool set it is acceptable to expose all four core tools directly. Dynamic discovery becomes important when Skills/MCP/extensions cause the catalog to grow.

#### 10.2.6 Goal, Plan and structured Checkpoint

`AgentThread`, `AgentRun` and `AgentGoal` represent different lifetimes:

```text
Thread = conversation container
Goal   = durable user objective that may span runs/checkpoints
Run    = one bounded orchestration attempt/execution window
```

Suggested goal model:

```ts
interface AgentGoal {
  id: string;
  threadId: string;
  userId: number;
  objective: string;
  status: 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  activePlanId?: string;
  createdAt: string;
  updatedAt: string;
}
```

A Plan is a user/model-visible execution proposal, not a blanket permission grant:

```ts
interface AgentPlan {
  id: string;
  goalId: string;
  version: number;
  steps: AgentPlanStep[];
  status: 'draft' | 'accepted' | 'superseded' | 'completed';
}
```

**Plan acceptance does not approve later mutating tool calls.** Current exact operations still require normal Policy/Approval.

A checkpoint is structured durable context, not serialized sockets/process state:

```ts
interface AgentCheckpoint {
  id: string;
  runId: string;
  goalId?: string;
  contextEpochId: string;
  objective: string;
  completedSteps: string[];
  pendingSteps: string[];
  decisions: string[];
  constraints: string[];
  targetFacts: string[];
  changedResources: AgentChangedResourceRef[];
  failures: string[];
  verificationResults: string[];
  recallRefs: string[];
  artifactRefs: string[];
  createdAt: string;
}
```

Resume semantics:

1. restore durable goal/plan/checkpoint context;
2. create fresh AgentRuntime(s) and fresh ExecutionSessions;
3. re-resolve targets/authorization;
4. re-observe machine state where decisions depend on it;
5. never pretend old SSH/SFTP/process state survived restart.

#### 10.2.7 Loop Guard and no-progress detection

`maxSteps` is a final budget, not enough by itself. `AgentLoopGuard` detects common non-progress patterns before resources/tokens are exhausted.

Signals include:

```text
same tool + normalized args repeated
same failing command repeated
A -> B -> A delegation oscillation
repeated identical approval request
repeated context/recall query with no new evidence
plan step cycling without state change
high token/tool activity with no progress markers
```

Possible decisions:

```ts
type AgentLoopGuardDecision =
  | 'continue'
  | 'replan'
  | 'ask-coordinator'
  | 'require-user-input'
  | 'stop';
```

The guard uses deterministic fingerprints/counters plus optional evaluator signals. A model cannot disable the guard for its own run.

#### 10.2.8 Resource Lease for Multi-Agent mutation safety

Independent AgentRuntime execution prevents shared raw transport state, but it does not by itself prevent two Agents from mutating the same logical resource concurrently.

`AgentResourceLeaseService` coordinates logical resource access across runtimes in the same Nexus instance/run.

Illustrative keys:

```text
target:<connectionId>
target:<connectionId>:path:/etc/nginx/nginx.conf
target:<connectionId>:service:nginx
target:<connectionId>:container:<id>
target:<connectionId>:database:<name>
```

Modes:

```text
READ       -> shared when safe
MUTATE     -> exclusive for overlapping resource scope
DESTRUCTIVE-> exclusive + normal destructive approval policy
```

Suggested mutation path:

```text
tool inspect / normalize
        ↓
Policy + Approval
        ↓
acquire resource lease
        ↓
revalidate operation/target state if needed
        ↓
execute
        ↓
verify
        ↓
release lease
```

Do not hold an exclusive lease for the entire human approval wait unless a concrete operation requires reservation semantics; long-lived approvals and locks should not create accidental deadlocks.

Leases are orchestration/concurrency guards, not substitutes for remote OS/database locking. They require expiry/owner/runtime metadata and deterministic cleanup on cancellation/failure.

#### 10.2.9 Evaluator / Reviewer policy

A reviewer/evaluator should be used when expected quality/risk benefit exceeds its token/latency cost. Do not force three Agents onto every trivial read operation.

```ts
interface AgentVerificationPolicy {
  mode: 'none' | 'self-check' | 'independent-reviewer' | 'mandatory-reviewer';
  triggerReasons: string[];
}
```

Possible triggers:

```text
read-only status query             -> none/self-check
configuration mutation             -> independent reviewer
service restart                    -> independent reviewer
high-risk destructive operation    -> mandatory reviewer + human approval
large/multi-target goal            -> periodic evaluator/checkpoint review
```

The evaluator can inspect goal/plan, selected evidence, artifacts, tool outcomes and current state. It does not gain extra tool permissions merely because it is a reviewer, and its positive judgment never substitutes for required human approval.

#### 10.2.10 ChangeSet / staged mutation and rollback boundary

For file/configuration mutations, Nexus should prefer a staged change flow instead of immediately overwriting remote state whenever the underlying capability supports it:

```text
read original
    ↓
create proposed patch/change set
    ↓
show bounded diff
    ↓
static/domain validation where available
    ↓
Policy / Approval
    ↓
backup or capture rollback material
    ↓
apply
    ↓
verify
    ↓
success OR rollback/escalate
```

This may later become an `AgentChangeSetService`. It is not a promise that every remote operation is reversible. The change set must explicitly declare whether rollback is supported, partial or impossible.

#### 10.2.11 Telemetry, token efficiency and Eval Harness

Agent quality/cost must be measurable independently of provider marketing claims.

The shared `AiTelemetryService` records common bounded metrics; the Operations App adds Agent/run-specific dimensions such as:

```text
run/runtime/model/provider
input tokens
cached input tokens when provider reports them
output tokens
estimated/actual cost when available
model calls
tool calls
MCP calls
context bytes/tokens by section
skill loads
tool schemas loaded
artifact bytes vs model-visible bytes
recall queries/hits
conversation compaction passes / real compactions / rebuilds
canonical history bytes vs effective context bytes
recent-exact / digest / intent-state contribution
pinned user-constraint count/bytes
handoff count and rebuilt context epochs
context compactions/checkpoints
delegations/replans
approvals
loop-guard interventions
resource-lease waits/conflicts
wall time
final status
```

Do not log raw prompt/tool contents merely to obtain metrics.

`AgentEvalPort` / an external repository-standard eval harness should support repeatable scenarios covering at least:

```text
successful diagnosis
safe mutation
prompt injection in logs/files/MCP output
stale Recall requiring current verification
dangerous command policy
multi-Agent resource conflict
repeated/no-progress loop
large tool output/artifact truncation
long-thread incremental compaction preserving later user corrections/constraints
model/runtime handoff preserving active objective/open items without replaying full history
compaction-drift rebuild from canonical source
participant-specific context projection preserving scoped critical constraints
Skill selection correctness
MCP tool discovery correctness
model/provider comparison
```

Evaluation dimensions:

```text
task success
unsafe action/proposal rate
verification quality
model/tool calls
input/output/cached tokens
cost
latency
context growth
approval burden
replan/loop rate
```

Model/Skill/Tool/Prompt/Context changes should be evaluated against these scenarios before being treated as an improvement.

#### 10.2.12 Operations-internal Hooks / extension bundles

These are **not Nexus Apps**. They are optional lower-level extension bundles consumed inside the Operations App after Skill/Tool/Policy ownership is stable. A future Operations extension may contribute bounded metadata such as:

```text
Extension
├── Skills
├── AgentDefinition templates
├── MCP server descriptors
├── Hooks
└── UI metadata (if explicitly supported)
```

A Hook reacts to Nexus-owned Agent events such as:

```text
run.started
before.tool
before.mutation
after.tool
after.mutation
approval.requested
run.completed
run.failed
```

Hooks do **not** get unrestricted `child_process`/SSH/database access merely because they are installed. Any hook-triggered machine action re-enters an explicit Nexus capability/tool path with normal policy, approval, ResourceLease and audit semantics. Extension manifests carry source/version/trust/signature metadata where applicable, and extension-provided Skills/MCP descriptors remain subject to the same Context/Tool discovery rules.

Do not confuse this with the Nexus App Platform. App packages are the top-level product plugin boundary; these Operations-internal bundles are optional content/automation extensions inside one App. A marketplace/auto-install model for these lower-level bundles is deferred until Skills, Tool discovery, MCP, Hooks and permission ownership are proven.

## 11. Persistence

V1 should persist the product trajectory, not live transports.

Persistence is split between shared AI/conversation records and Operations Agent application records.

Shared AI Platform records:

```text
ai_providers
ai_provider_models
ai_conversations
ai_messages
ai_user_inputs
ai_conversation_digests
ai_memories
ai_artifacts
```

Operations Agent records:

```text
agent_definitions
agent_definition_versions
agent_participants
agent_runs
agent_runtimes
agent_delegations
agent_steps
agent_tool_calls
agent_approvals
agent_settings
agent_acp_backends
agent_intent_states
agent_goals
agent_plans
agent_checkpoints
```

Suggested ownership:

```text
packages/apps/operations/backend repository ports ─┐
                                                   ├─► Infrastructure persistence adapters
packages/backend/src/modules/ai repository ports ──┘

Bootstrap wires the trusted built-in App ports; App domain code never receives the raw database handle.
```

Persist at minimum:

- shared Provider metadata/Base URL/enabled state plus encrypted credential storage and model catalog/capability metadata;
- shared canonical conversation/message/user-input sequence plus digest/watermark/provenance sufficient to reconstruct context history;
- shared/app-scoped memory and Artifact metadata with explicit `appKind`/owner scope;
- AgentDefinition metadata and immutable/versioned run snapshot reference;
- typed Operations Agent Settings and bounded runtime ceilings;
- ACP backend metadata/transport config/capability snapshot plus encrypted backend credential storage where required;
- Operations Agent-specific `AgentUserIntentState`/Goal/Plan/Checkpoint projections referencing shared conversation sources;
- per-run/context-epoch references to effective Skills/tool descriptors/context sources when needed for audit/debugging, without persisting every expanded prompt;
- per-Agent native provider/model or ACP backend selection without embedding credentials;
- participant membership/roles associated with the shared conversation/run;
- run status and failure summary;
- AgentRuntime status per participant;
- delegation records and outcomes;
- step ordering with runtime/participant attribution;
- normalized tool call and bounded result metadata;
- approval request and decision;
- effective permission profile used by the acting Agent;
- timestamps and audit correlation identifiers.

Do not persist as resumable runtime state:

- SSH client/transport objects;
- SFTP handles;
- shell/command stream objects;
- raw sockets;
- AbortControllers;
- in-process streaming subscribers;
- active ResourceLease mutex/lock objects (unless a future distributed-worker design explicitly introduces a durable lease service);
- provider SDK clients / prompt-cache handles;
- Workspace runtime objects.

Raw secrets and credentials must not be copied into Agent persistence or model-visible logs.

## 12. Public protocol

### 12.1 V1 transport choice

Use normal HTTP commands plus Server-Sent Events for the first Agent protocol unless a real bidirectional streaming requirement appears.

Rationale:

- chat/tool progress is primarily server → client event streaming;
- approval/cancel are normal client → server commands;
- HTTP/SSE is easier to inspect, reconnect, authorize, proxy, and test than another early WebSocket protocol;
- it avoids coupling Agent V1 to Workspace WebSocket infrastructure.

Illustrative App-scoped API surface:

```text
GET   /api/v1/apps/nexus.operations/definitions
POST  /api/v1/apps/nexus.operations/definitions
PATCH /api/v1/apps/nexus.operations/definitions/:definitionId

POST /api/v1/apps/nexus.operations/conversations
GET  /api/v1/apps/nexus.operations/conversations/:conversationId
PUT  /api/v1/apps/nexus.operations/conversations/:conversationId/participants
POST /api/v1/apps/nexus.operations/conversations/:conversationId/runs

POST /api/v1/apps/nexus.operations/runs/:runId/cancel
POST /api/v1/apps/nexus.operations/runs/:runId/approvals/:approvalId
GET  /api/v1/apps/nexus.operations/runs/:runId/events
```

The generic Interface/App Host owns authentication, HTTP/SSE mechanics, output bounds and route dispatch; the Operations package supplies transport-neutral handlers. These paths are target architecture, not evidence that routes currently exist.

### 12.2 Agent event protocol

Suggested V1 event types:

```text
run.started
runtime.started
runtime.completed
delegation.started
delegation.completed
message.delta
message.completed
tool.proposed
tool.awaiting_approval
tool.started
tool.output
tool.completed
tool.failed
approval.resolved
run.completed
run.failed
run.cancelled
run.interrupted
```

Every event should carry enough correlation identity to be idempotently applied by the frontend, for example:

```ts
interface AgentEventEnvelope<T> {
  eventId: string;
  runId: string;
  runtimeId?: string;
  participantId?: string;
  sequence: number;
  type: string;
  createdAt: string;
  payload: T;
}
```

Do not put raw infrastructure handles or credentials in protocol events.

When Harness features are enabled, additional user/debug-relevant event families may include:

```text
goal.updated
plan.updated
checkpoint.created
skill.loaded
artifact.created
intent.updated
conversation.compacted
handoff.created
context.truncated
context.compacted
loop_guard.triggered
resource.waiting
resource.acquired
resource.released
verification.started
verification.completed
```

Not every internal telemetry signal belongs on SSE. High-volume token/context/tool metrics may stay in observability storage and be queried separately; the live protocol should carry only state needed for user experience/reconnect/explainability.

### 12.3 Reconnect semantics

SSE/client reconnect must not create a new run implicitly.

The frontend should be able to:

1. fetch durable run/thread state;
2. reconnect to the existing run event stream;
3. continue applying events after the last known sequence/event id when supported;
4. see `interrupted` if the backend lost unrecoverable live runtime state.

Browser disconnect does not necessarily cancel the Agent run. Cancellation is an explicit domain action.

### 12.4 Future WebSocket

Add a dedicated Agent WebSocket only if later features require real bidirectional live streams such as:

- interactive Agent PTY takeover;
- continuous stdin;
- voice streaming;
- other low-latency duplex channels.

If added, use a dedicated Agent protocol/path. Never reuse `/ws/workspace` or Workspace frames.

## 13. Operations Agent App UI architecture

Operations Agent UI is a Frontend contribution from `packages/apps/operations/frontend/`. It is registered with the Frontend App Registry and rendered inside the Nexus App Shell. Shared Provider/conversation/Artifact clients remain in `features/ai`; Workspace remains a separate runtime.

Target source ownership:

```text
packages/frontend/src/features/app-platform/
└── public.ts                    # App registry/bridge/shell contracts

packages/frontend/src/features/ai/
└── public.ts                    # shared Provider/conversation/Artifact/Skill clients

packages/apps/operations/frontend/
├── model/
│   ├── operations-app.types.ts
│   ├── conversation-view.types.ts
│   ├── run-view.types.ts
│   └── approval-view.types.ts
├── client/
│   ├── operations-api.client.ts
│   └── operations-events.client.ts
├── runtime/
│   ├── operations-app.runtime.ts
│   ├── conversation-session.ts
│   └── run-event-reducer.ts
├── components/
│   ├── conversation/
│   ├── composer/
│   ├── approvals/
│   ├── timeline/
│   ├── plan/
│   ├── artifacts/
│   └── inspector/
├── views/
│   ├── OperationsHomeView.vue
│   ├── OperationsConversationView.vue
│   └── OperationsSettingsView.vue
└── public.ts
```

The Operations frontend package owns only Operations UI/runtime state. It must not import Workspace runtime internals or another App package.

<a id="agent-ui-layout"></a>
### 13.1 Primary Agent UI layout

Recommended desktop layout:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Nexus App Shell                                                            │
├──────────────┬───────────────────────────────────────┬──────────────────────┤
│ Left rail    │ Main conversation                     │ Inspector            │
│              │                                       │                      │
│ New task     │ Header                                │ Tabs                 │
│ Threads      │ target / team / run status            │ Plan                 │
│ Goals        │                                       │ Timeline             │
│ Recent       │ Messages                              │ Context              │
│              │ user                                  │ Artifacts            │
│              │ coordinator                           │ Participants         │
│              │ specialist/reviewer                   │                      │
│              │ tool/approval cards inline            │                      │
│              │                                       │                      │
│              │ Composer pinned to bottom             │                      │
└──────────────┴───────────────────────────────────────┴──────────────────────┘
```

The central conversation is primary. The timeline/plan/context details remain inspectable without forcing every internal event into the chat transcript.

### 13.2 App navigation and home

The App manifest contributes one top-level navigation item such as **Operations**. The Shell decides final placement/order.

`/apps/operations` can provide an App home surface:

```text
Operations
├── New task
├── Resume active run
├── Recent conversations
├── Active Goals
├── pending approvals
└── App health/provider warning if action is required
```

Selecting a conversation opens:

```text
/apps/operations/conversations/:conversationId
```

The App should not add many unrelated global navigation entries for internal concepts like Runs, Artifacts or Approvals; those belong inside the Operations experience unless later usage proves a global entry is necessary.

### 13.3 New task / conversation creation

The creation flow should make the execution scope explicit before the first model call:

```text
New Operations task
├── Target
│   └── one or more allowed managed connections (within App/policy limits)
├── Team
│   ├── Coordinator
│   ├── Specialists
│   └── Reviewer policy
├── Models
│   └── defaults with optional per-Agent override
├── Permission profile
└── User request
```

Do not require users to configure every advanced field on every task. Defaults come from shared AI/App settings; advanced team/model/permission controls can live behind an expandable section.

### 13.4 Conversation stream

Messages always expose sender identity:

```text
You
Coordinator · GPT/Claude/Grok/...
Linux Ops · model/backend badge
Reviewer · model/backend badge
```

Tool execution is represented as structured cards instead of raw internal protocol lines:

```text
Linux Ops
┌─ Read service logs ──────────────────────────┐
│ target: prod-web-01                          │
│ result: 3 relevant errors found              │
│ [Show details] [Open artifact]               │
└──────────────────────────────────────────────┘
```

Large logs/results remain collapsed and lazy-loaded through Artifact APIs.

### 13.5 User input composer

The composer is the canonical user-input entry surface and should support:

- normal multiline text;
- attachment/Artifact references when implemented;
- explicit target mention or participant mention only when useful;
- Stop/Cancel while a Run is active;
- clear indication when a message will start a new Run versus append instructions to an active Run;
- keyboard send/newline behavior consistent with the rest of Nexus.

The frontend may optimistically show the submitted text, but Backend canonical message id/sequence remains authoritative.

Do not place large hidden prompt/config editors in the normal composer. AgentDefinition/Skill/context settings belong in dedicated configuration surfaces.

### 13.6 Approval UI

Approval is a high-priority interrupt and must be visually distinct from normal chat.

```text
Approval required
────────────────────────────────────────
Agent       Linux Ops
Target      prod-web-01
Operation   restart service nginx
Risk        service interruption
Reason      apply validated config change

[View exact details]
[Deny]                         [Approve]
```

For file/process mutations, details should show the normalized exact action/diff/arguments used by the approval hash. The UI must not approve a vague Plan while the Backend executes materially different arguments.

Multiple pending approvals should be individually addressable. A global “approve all future actions” toggle should not exist unless a separately designed permission profile explicitly supports that behavior.

### 13.7 Plan and Goal UI

The Inspector **Plan** tab shows:

```text
Goal
  Fix nginx startup failure

Plan
  ✓ inspect service status
  ✓ inspect recent logs
  → validate certificate configuration
  ○ propose fix
  ○ apply approved change
  ○ verify health
```

Users may inspect/comment/edit a Plan when supported, but Plan acceptance is separate from mutation approval.

Long-running Goals can survive multiple bounded Runs and show resume/pause/completion state.

### 13.8 Timeline / Multi-Agent UI

The **Timeline** tab is the durable execution/audit-oriented view:

```text
12:01 Coordinator started
12:01 delegated diagnosis -> Linux Ops
12:02 Linux Ops read systemd status
12:02 Linux Ops read logs
12:03 Linux Ops reported certificate-path issue
12:03 Reviewer verified evidence
12:04 approval requested
...
```

An optional delegation tree can show parent/child relationships without turning the main chat into an internal orchestration console.

The UI should show which Agent/model/backend acted, but does not expose raw provider request objects, ACP wire messages or internal ExecutionSession ids.

### 13.9 Context / token inspector

The **Context** inspector is primarily an explainability/performance surface, not a prompt-secret viewer.

Safe information may include:

```text
Context epoch: 4
Model: provider/model
Estimated context: 14.2K tokens
Recent exact: 4.1K
Digest: 3.8K
Pinned user constraints: 0.9K
Recall: 1.2K
Skills: 1.4K
Tool schemas/results: 2.8K
Compacted: yes
```

It may show source/provenance references and why a Recall/Skill was included. It must not automatically reveal system secrets, stored credentials, hidden model reasoning or full unredacted Tool output.

### 13.10 Artifact UI

Artifacts are first-class inspectable outputs:

```text
Artifacts
├── nginx.log excerpt
├── proposed nginx.conf diff
├── validation report
└── verification report
```

Opening an Artifact performs bounded lazy reads. Very large content uses range/pagination/search rather than loading everything into browser memory.

### 13.11 Participant/team editor

A conversation/team configuration surface can manage:

```text
Coordinator
  definition / model / permission profile

Specialists
  Linux Ops
  DBA
  ...

Reviewer policy
  automatic / risk-based / disabled where allowed
```

AgentDefinitions are reusable templates. Editing a definition does not silently mutate historical Runs; a Run snapshots the effective definition/version/backend/model references it used.

### 13.12 Mobile and narrow layouts

On narrow screens:

```text
main conversation = primary
left rail          = drawer
Inspector          = drawer/bottom sheet
approval           = sticky/high-priority card
composer           = bottom anchored
```

Do not squeeze three desktop columns into a narrow viewport. Tool/Artifact details open on demand.

### 13.13 Reusing Nexus feature UI/capabilities

If the Operations App later needs terminal/filesystem/transfer UI, consume feature public surfaces rather than Workspace runtime internals.

```text
Terminal Feature public port
        ↑
        ├── Workspace adapter
        └── Operations App adapter
```

Same principle applies to Filesystem/Transfer/Status/Docker feature presentation. This does not mean the model receives raw feature handles; model execution still goes through Agent Tool/Policy/Capability Broker boundaries.

### 13.14 Settings contributions

Because Apps are plugin-style, the Operations package contributes settings panels rather than requiring `SettingsPage` to know Agent internals.

Recommended composition before product requirements are finalized:

```text
Settings
├── AI
│   ├── Providers / credentials
│   ├── Model catalog
│   ├── Context / compaction limits
│   ├── Skills / MCP when implemented
│   └── Artifact retention
│
└── Apps
    └── Operations Agent
        ├── default Coordinator/Specialist/Reviewer model refs
        ├── Multi-Agent limits / delegation limits
        ├── run/token/cost budgets
        ├── permission defaults
        ├── verification defaults
        └── ACP backends
```

The App Platform may later choose another visual grouping (for example a contextual Operations settings page), but ownership does not change: shared Provider/model secrets belong to AI Platform; Operations-specific settings belong to the Operations App.

Provider/API secret fields are write-only. The Browser retains only safe configured/status metadata after save.

### 13.15 Apps management UI

The generic Apps UI described in [App Platform Architecture](./APP-PLATFORM.md#app-ui-contributions) should show `nexus.operations` as a built-in App with version, enabled state, health and requested/granted capabilities.

Disabling the App hides/stops its Operations surfaces and runtimes but must not disable Workspace or shared AI Provider configuration.

## 14. Multi-model provider boundary

Each native AgentDefinition owns an independent `AgentModelConfig`; an ACP AgentDefinition owns an ACP backend reference and may optionally expose a backend-supported model selection. A run therefore has no single global model or backend setting.

For native Agents, `LanguageModelPort` hides provider-specific request/streaming formats from `modules/ai`, while `LanguageModelRouter` selects the correct model adapter. At the next level up, `AgentBackendRouter` decides whether the acting AgentRuntime uses the native loop or an ACP backend.

```text
Coordinator AgentRuntime
    └── model config: provider-a/model-x ─┐
Linux Ops AgentRuntime                   │
    └── model config: provider-b/model-y ├─→ LanguageModelRouter
Reviewer AgentRuntime                    │          │
    └── model config: provider-c/model-z ┘          ├── provider-a adapter
                                                   ├── provider-b adapter
                                                   └── provider-c adapter
```

Illustrative responsibilities:

```text
packages/apps/operations/backend
  - owns AgentDefinition model selection/reference
  - snapshots effective model reference per AgentRuntime/run
  - contributes participant-specific Goal/Plan/delegation/operations context
  - owns AgentBackendRouter/native-vs-ACP choice
  - owns Agent retry/runtime/delegation/verification semantics

packages/backend/src/modules/ai
  - owns shared Provider configuration/model catalog
  - owns LanguageModelPort / LanguageModelRouter
  - owns generic Context Engine/compaction/handoff mechanics
  - normalizes provider model events/capabilities/usage metadata

AppCapabilityBroker
  - verifies nexus.operations has ai.model.use before model access
  - exposes only the bounded AI capability contract to the App

infrastructure/ai/providers/<provider>.adapter
  - provider SDK/client
  - decrypted provider credential use
  - provider request mapping
  - streaming response parsing
  - provider-specific error mapping
```

The router must support multiple provider adapters simultaneously in one process. Provider/model capability differences are normalized at the Module boundary: tool calling, streaming, reasoning controls, structured output, context limits, and cancellation are represented as explicit capability metadata rather than scattered provider-name conditionals.

An AgentDefinition that requests unsupported capabilities must fail validation before a run starts or degrade only through an explicit documented policy; Nexus must not silently remove safety-critical tool/structured-output behavior.

Plaintext Provider credentials are transient shared-AI secret material: they enter only through authenticated AI Platform secret writes, are encrypted with the Nexus secret boundary before persistence, and are decrypted only immediately before an Infrastructure Provider call. The Operations App receives model-use capability, not Provider secret plaintext. Credentials must never be stored in AgentDefinition, returned to frontend clients, copied into AppStorage, shared with another Agent, or exposed to Agent Tool/model context.

The Module contract should avoid provider-specific concepts unless Nexus product behavior genuinely depends on them.

### 14.1 Settings ownership under the plugin model

Settings are contributed by owners instead of hard-coded into `SettingsPage` as Agent-specific state. The recommended architecture is:

```text
AI Platform settings contribution
├── Providers / credentials
├── model catalog refresh
├── Context / compaction ceilings
├── Artifact retention
└── shared Skill/MCP settings when implemented

Operations App settings contribution
├── default role model references
├── Multi-Agent/runtime/delegation limits
├── run token/cost budgets
├── permission/approval defaults
├── verification defaults
└── ACP backends
```

The App Shell/Settings composition may later display these as `Settings > AI` plus `Settings > Apps > Operations`, or another approved grouping. Architecture does not require a fixed Agent tab before UI requirements are confirmed. Provider records are never duplicated into App state merely because the Operations UI links to them.

Operations Agent effective policy remains the most restrictive combination:

```text
server hard safety ceiling
          ↓
shared AI hard/context ceilings + global Operations Agent Settings
          ↓
AgentDefinition limits/capabilities
          ↓
run/request overrides (only if allowed)
          ↓
effective AgentRuntime policy
```

A lower layer may reduce a limit or capability, but it must not raise a value beyond its parent/global ceiling.

Suggested split settings models:

```ts
interface AiPlatformSettings {
  modelCatalogRefreshMinutes: number;
  maxContextBytesPerTurn: number;
  maxRecentExactConversationBytes: number;
  conversationCompactionTargetBytes: number;
  maxConversationDigestBytes: number;
  maxCompactionGenerations: number;
  maxModelVisibleToolResultBytes: number;
  maxLoadedSkillBodiesPerTurn: number;
  maxLoadedToolSchemasPerTurn: number;
  artifactRetentionHours: number;
}

interface AgentGlobalSettings {
  defaultCoordinatorModel?: AgentModelRef;
  defaultSpecialistModel?: AgentModelRef;
  defaultReviewerModel?: AgentModelRef;

  maxParticipantsPerRun: number;
  maxActiveRuntimesPerRun: number;
  maxConcurrentModelCalls: number;
  maxDelegationDepth: number;
  maxDelegationsPerRun: number;
  maxConcurrentChildrenPerRuntime: number;
  maxStepsPerRuntime: number;
  maxTotalStepsPerRun: number;
  maxRunDurationMinutes: number;

  defaultPermissionProfile: AgentPermissionProfileName;
  defaultVerificationMode: AgentVerificationPolicy['mode'];
  maxPinnedUserConstraintBytes: number;

  maxInputTokensPerRun?: number;
  maxOutputTokensPerRun?: number;
  maxEstimatedCostPerRun?: number;
}

interface AgentModelRef {
  providerId: string;
  modelId: string;
}
```

Exact product defaults and hard ceilings must be specified in the Agent SRS before implementation. The architecture requires bounded values and server-side validation; it does not make UI-entered numbers authoritative by themselves.

### 14.2 Shared Provider configuration

The shared AI settings surface supports configuring multiple model Providers at the same time. These records are AI Platform-owned so every granted App can reuse them; a Provider is a Nexus-owned shared configuration record, not a credential-bearing field embedded directly in an AgentDefinition.

```ts
interface AiProviderConfig {
  id: string;
  name: string;
  adapter: string;          // e.g. openai, anthropic, google, openai-compatible
  baseUrl?: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  modelCatalogUpdatedAt?: string;
  modelCatalogStatus: 'unknown' | 'ready' | 'stale' | 'error';
}
```

For native Agents, `AgentDefinition.runtime.model.provider` resolves to a configured provider id/reference rather than containing credentials or raw connection details. ACP Agents reference an ACP backend id instead of a model Provider credential.

Conceptual settings composition:

```text
Settings > AI
  ├── Providers
  │    ├── OpenAI
  │    │    ├── API Base URL
  │    │    ├── API Key (write-only)
  │    │    ├── Test connection
  │    │    └── Refresh models
  │    ├── Anthropic
  │    ├── Google
  │    └── OpenAI-compatible / custom endpoint
  │
  ├── Skills (when Skill management is implemented)
  │    ├── installed/enabled
  │    ├── source / trust / version
  │    └── capability dependency status
  │
  └── MCP Servers (when MCP is implemented)
       ├── endpoint/transport
       ├── write-only credential status
       ├── enabled/test
       └── discovered tool count/capabilities

Settings > Apps > Operations Agent
  ├── External Agent Backends
  │    └── ACP backend
  │         ├── transport/endpoint or local command
  │         ├── credential status (write-only when required)
  │         ├── Test backend
  │         └── discovered backend capabilities
  │
  └── Harness defaults
       ├── Multi-Agent/runtime limits
       ├── run/token/cost budgets
       ├── pinned user-constraint limit
       ├── permission defaults
       └── default verification policy
```

Custom/local endpoints may be supported, but model-controlled values must never be able to change provider Base URL. Provider endpoint configuration is a privileged user/admin setting and requires explicit URL/network validation so an Agent cannot turn model inference configuration into an SSRF primitive.

### 14.3 API credential storage

Provider API credentials must **not** use the current generic `/settings` key/value DTO and must never be returned through `getAllSettings()`.

Use the shared AI Platform Provider repository plus the existing Nexus `SecretCipher`/AES-GCM infrastructure for at-rest encryption. The Operations App never owns or copies the Provider secret record:

```text
Settings UI
   │  write API key
   ▼
Shared AI HTTP Interface
   ▼
AiProviderService
   ▼
SecretCipher.encrypt(apiKey)
   ▼
ai_providers.encrypted_api_key
```

Read responses return only redacted state such as:

```json
{
  "apiKeyConfigured": true
}
```

They never return the plaintext key or encrypted ciphertext. Updating provider metadata without an `apiKey` leaves the existing credential unchanged. Credential rotation/clear must be an explicit write action.

Provider keys are decrypted only immediately before Infrastructure model-provider calls. ACP backend credentials follow the same rule and are decrypted only immediately before the ACP adapter establishes/uses the external Agent connection. Neither secret type is placed in AgentDefinition, AgentRunContext exposed to tools/models, messages, diagnostics, audit details, SSE events, backups in plaintext, or frontend stores.

### 14.4 Automatic model discovery and model catalog

A provider adapter may implement a provider-neutral model-catalog capability in addition to inference:

```ts
interface ModelCatalogPort {
  listModels(provider: ResolvedAiProvider, signal?: AbortSignal): Promise<DiscoveredAiModel[]>;
}

interface DiscoveredAiModel {
  id: string;
  displayName?: string;
  capabilities: {
    streaming?: boolean;
    toolCalling?: boolean;
    structuredOutput?: boolean;
    reasoning?: boolean;
    contextWindow?: number;
    maxOutputTokens?: number;
  };
}
```

`AiProviderService` in the shared AI Platform owns discovery/cache policy; the frontend never calls OpenAI/Anthropic/Google/custom provider APIs directly.

Recommended behavior:

1. user creates/updates Provider Base URL + credential;
2. backend validates the provider and attempts model discovery;
3. discovered models are normalized and cached as the provider model catalog;
4. Settings model selectors use the cached catalog;
5. a **Refresh models** action forces a new backend discovery;
6. stale catalogs may auto-refresh according to `modelCatalogRefreshMinutes`;
7. if a provider does not support model listing or discovery fails, Nexus preserves the last good catalog and may allow an explicitly entered model id according to product policy;
8. discovery failure does not expose API keys or raw provider error bodies containing secrets.

Suggested shared AI Platform persistence:

```text
ai_providers
  metadata + encrypted credential

ai_provider_models
  provider_id
  model_id
  normalized capability metadata
  source = discovered | manual
  discovered_at
```

Provider-reported capabilities are advisory input. Nexus adapter validation remains authoritative for safety-critical requirements such as tool calling or structured tool output.

### 14.5 Default models and per-Agent model selection

The Operations App settings contribution defines defaults for newly created roles/teams:

```text
Default coordinator model
Default specialist model
Default reviewer model
```

Each AgentDefinition may override the default with any enabled provider/model that satisfies its required capabilities:

```text
Global default: provider-a/model-x

Coordinator  -> provider-a/model-x
Linux Ops    -> provider-b/model-y
DBA          -> provider-c/model-z
Reviewer     -> provider-a/model-r
```

Changing a global default does not mutate historical runs or silently rewrite existing AgentDefinitions. A run snapshots the effective provider/model configuration at start for auditability.

### 14.6 Multi-Agent limits, concurrency, and budget settings

The Operations App settings surface should expose bounded Multi-Agent controls, including at minimum:

| Setting | Purpose |
| --- | --- |
| `maxParticipantsPerRun` | Maximum Agent participants, including coordinator, in one run |
| `maxActiveRuntimesPerRun` | Maximum simultaneously active AgentRuntimes |
| `maxConcurrentModelCalls` | Cap provider calls to control cost/rate limits |
| `maxDelegationDepth` | Prevent recursive delegation chains |
| `maxDelegationsPerRun` | Bound total subtask fan-out |
| `maxConcurrentChildrenPerRuntime` | Bound one Agent's child delegations |
| `maxStepsPerRuntime` | Stop one Agent loop from running indefinitely |
| `maxTotalStepsPerRun` | Bound total work across all Agents |
| `maxRunDurationMinutes` | Wall-clock run deadline |
| token/cost budgets | Optional global per-run spend/context protection |

These settings are runtime ceilings, not suggestions to the model. `AgentCoordinatorService`/`AgentRuntimeRegistry` enforce them before creating a runtime, starting a model call, accepting a delegation, or executing another step.

A future system-wide provider concurrency limit may also exist above per-run limits to protect the Nexus instance from multiple users/runs exhausting provider quotas.

### 14.7 Settings / Provider HTTP contract split

Shared Provider/model resources use the AI Platform namespace; Operations Agent policy/ACP resources use the Agent application namespace. Neither extends the generic settings allowlist with secret-bearing fields.

Illustrative target contract:

```text
# Shared AI Platform
GET  /api/v1/ai/settings
PUT  /api/v1/ai/settings

GET    /api/v1/ai/providers
POST   /api/v1/ai/providers
PATCH  /api/v1/ai/providers/:providerId
DELETE /api/v1/ai/providers/:providerId

PUT    /api/v1/ai/providers/:providerId/credential
DELETE /api/v1/ai/providers/:providerId/credential
POST   /api/v1/ai/providers/:providerId/test

GET  /api/v1/ai/providers/:providerId/models
POST /api/v1/ai/providers/:providerId/models/refresh

# Operations App
GET  /api/v1/apps/nexus.operations/settings
PUT  /api/v1/apps/nexus.operations/settings

GET    /api/v1/apps/nexus.operations/acp-backends
POST   /api/v1/apps/nexus.operations/acp-backends
PATCH  /api/v1/apps/nexus.operations/acp-backends/:backendId
DELETE /api/v1/apps/nexus.operations/acp-backends/:backendId
POST   /api/v1/apps/nexus.operations/acp-backends/:backendId/test
PUT    /api/v1/apps/nexus.operations/acp-backends/:backendId/credential
DELETE /api/v1/apps/nexus.operations/acp-backends/:backendId/credential
```

The Settings/App UI may call both namespaces through separate shared-AI and App clients. These are target architecture contracts only; they do not exist in the current implementation. Provider test/model-refresh and future ACP-backend test endpoints must be authenticated, capability-checked, bounded by timeout/output/error sanitization, and must never echo credentials or raw protocol data containing secrets.

## 15. Cancellation and resource cleanup

Cancellation is first-class.

On run cancel:

1. mark run `cancelling`;
2. cancel/abort every active AgentRuntime model/delegation/tool operation;
3. terminate active Agent-owned command sessions per runtime;
4. close Agent ExecutionSessions owned by every runtime in the run;
5. mark unfinished delegations/runtimes cancelled;
6. persist terminal run state as `cancelled`;
7. emit runtime/delegation cancellation events as applicable, then `run.cancelled`.

Cleanup must also occur on unhandled run failure.

The run registry must never leave Agent-owned transports attached indefinitely after terminal run state.

## 16. Audit and observability

Agent actions are privileged machine operations and require strong correlation.

At minimum correlate:

```text
userId
threadId
runId
runtimeId
participantId
agentDefinition/version
provider/model identifier (non-secret)
delegationId
stepId
toolCallId
approvalId
target alias / connection id (server-side)
```

Audit should distinguish:

- model proposal;
- policy decision;
- approval request;
- approval decision;
- actual execution;
- execution result;
- verification action.

Do not store full arbitrary command output in general audit logs when bounded Agent-step storage already owns that result. Audit events should remain structured and secret-safe.

<a id="mcp-extension-strategy"></a>
## 17. MCP extension strategy

MCP is the future external-tool extension layer, but it participates in the same dynamic Tool Catalog rather than injecting every MCP tool schema into every model turn:

```text
shared ToolCatalog
   │
   ├── Native descriptors
   │      ├── shell.exec
   │      ├── fs.read
   │      ├── diagnostics.run
   │      └── docker.*
   │
   └── MCP descriptors
          ├── GitHub
          ├── issue trackers
          ├── cloud services
          └── other approved MCP servers
                 │
                 ▼
       shared ToolDiscoveryService
          search / describe
                 │
                 ▼
       selected schemas only
                 │
                 ▼
         McpAgentToolAdapter
```

Rules:

1. native Nexus capabilities stay direct and typed;
2. MCP tools are normalized into the same AgentTool policy/approval/audit path;
3. MCP server-provided metadata does not bypass Nexus permission policy;
4. remote/external tool outputs pass `shared ToolResultProcessor`, Artifact/context-size and redaction constraints;
5. discovery is metadata exposure only: `discoverable != callable != approved`;
6. large MCP catalogs use progressive schema loading so context cost grows with selected tools, not installed servers;
7. Skill manifests may suggest MCP capabilities, but Skills do not grant MCP permissions;
8. MCP connectivity is not a V1 blocker.

When the catalog is still tiny, direct schema exposure is acceptable. Dynamic discovery becomes the default scaling strategy once installed native/MCP/extension tools would materially inflate the prompt.

<a id="acp-external-agent-interoperability"></a>
## 18. ACP / external Agent interoperability

ACP is part of the **target architecture boundary from day one**, even though the concrete ACP adapter is not implemented yet.

Nexus acts as the Agent host/client boundary. The browser does not speak ACP directly:

```text
Operations App frontend
      │
      │ /api/v1/apps/nexus.operations/... + SSE
      ▼
Nexus App Host
      │
      ▼
Operations App AgentRuntime
      │
      ▼
AgentBackendRouter
   ┌──┴───────────────┐
   ▼                  ▼
NativeAgentBackend   ACP Backend Adapter
   │                  │
   ▼                  ▼
Nexus native loop    external ACP-compatible Agent
```

This means the frontend, coordinator, persistence model and run timeline only understand normalized Nexus concepts such as participant/runtime/message/delegation/tool/approval events. ACP transport/session details remain behind the backend adapter.

### 18.1 ACP backend configuration

ACP backends are Operations App-owned resources, separate from shared AI model Providers:

```ts
interface AcpBackendConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'remote';
  endpoint?: string;
  command?: string;
  args?: string[];
  credentialConfigured?: boolean;
  capabilities?: AcpBackendCapabilities;
}
```

The exact ACP transport/config surface is defined when the adapter is implemented. Secret credentials follow the same write-only/encrypted-at-rest principles as model Provider credentials and must not be embedded in `AgentDefinition`.

`AgentDefinition.runtime` then references the backend:

```text
runtime.kind = acp
runtime.backendId = codex-acp
```

### 18.2 ACP is not the Multi-Agent coordinator

ACP is used to connect Nexus to one external Agent backend. Nexus still owns participant orchestration:

```text
AgentCoordinatorService
   ├── Native Ops Agent
   ├── Native Reviewer Agent
   └── ACP Coding Agent
```

Agent-to-Agent delegation remains a Nexus `AgentDelegation` operation. Nexus must not create uncontrolled ACP peer-to-peer conversations that bypass `AgentCoordinatorService`, run budgets, participant attribution or cancellation.

### 18.3 Tool and permission safety boundary

An ACP-backed Agent is treated as an external/untrusted reasoning backend. It does not receive raw Nexus Infrastructure resources.

For Nexus-managed servers and resources, privileged actions must remain Nexus-mediated:

```text
ACP Agent proposes action / requests tool
             ↓
AcpAgentBackendAdapter
             ↓
normalized AgentToolCall / permission request
             ↓
AgentPolicyService
             ↓
Approval if required
             ↓
Nexus AgentTool
             ↓
Platform / ExecutionSession
```

Required rules:

1. ACP Agents never receive raw SSH clients, SFTP handles, `ExecutionSession` ids, database handles or provider credentials;
2. ACP permission requests do not automatically imply approval;
3. actions against Nexus-managed targets must pass the same Tool/Policy/Approval/Audit path as native Agents;
4. `nexus.operations`, the acting ACP participant/runtime, target and normalized exact operation are included in `operationHash`/audit correlation;
5. an external ACP Agent that executes privileged operations entirely outside Nexus mediation is a separate trust boundary and must not be treated as equivalent to a Nexus-managed operations Agent;
6. V1 ACP integration, when implemented, should prefer advisory/reasoning or Nexus-mediated-tool modes rather than granting opaque external execution authority.

### 18.4 Normalized backend events

The ACP adapter translates protocol-specific events into Operations App-owned normalized backend events such as:

```text
backend.message.delta
backend.message.completed
backend.tool.proposed
backend.permission.requested
backend.status.changed
backend.completed
backend.failed
```

These are then converted into durable Operations message/step/tool/approval/run events. ACP wire message types must not leak into shared frontend AI state, canonical shared Conversation records beyond normalized messages, or Coordinator/domain logic.

### 18.5 Why ACP is in the architecture now

Making the backend boundary explicit now prevents the native implementation from hard-coding assumptions such as:

```text
AgentRuntime always has a LanguageModelPort
AgentDefinition always has model config
Coordinator always calls LanguageModelRouter directly
```

Instead:

```text
Coordinator -> AgentBackendRouter -> native | acp
```

This keeps native Multi-Agent V1 simple while avoiding a later foundational rewrite when external Agents are added.

## 19. Explicit non-goals for V1

V1 does **not** require:

- separate Agent microservice;
- arbitrary dynamic Agent spawning;
- unbounded parallel Agent swarms;
- general workflow/DAG engine;
- LangGraph/CrewAI/AutoGen dependency;
- autonomous interactive PTY;
- multi-host parallel orchestration;
- unrestricted arbitrary shell access;
- MCP ecosystem support;
- full vector database / embedding / hybrid-rerank Recall implementation (the shared `RecallPort` boundary is present; the first implementation may use recent/history summaries only);
- concrete ACP backend adapter/client delivery (the architecture boundary is present, implementation is deferred);
- checkpoint continuation across arbitrary process states;
- browser automation of the Workspace UI.

V1 **does** require the Multi-Agent-capable domain/runtime model, at least one coordinator + one specialist/reviewer collaboration path, and independent model configuration per AgentDefinition. Sequential delegation is acceptable for the first implementation.

V1 must not automate Workspace UI as a substitute for proper capabilities.

## 20. Implementation phases

### Phase 0 — architecture confirmation first

Before product code or new Agent SRS entries, confirm the architecture decisions in this document and [App Platform Architecture](./APP-PLATFORM.md):

- App package/manifest identity and source placement;
- static built-in registration strategy;
- AppCapabilityBroker capability vocabulary and grant model;
- Operations AgentDefinition/participant/run/runtime/delegation lifecycle;
- shared AI Provider credential lifecycle/model discovery;
- per-Agent model/provider selection and model capability validation;
- coordinator/delegation limits, concurrency and run budgets;
- permission profiles and exact approval semantics;
- Context Engine budget/trust rules, Artifact retention and initial Skill/Tool exposure model;
- LoopGuard/ResourceLease safety semantics and measurable telemetry fields;
- App-scoped HTTP/SSE protocol;
- Agent UI layout/navigation/settings contributions;
- user-visible Multi-Agent behavior and later E2E/eval acceptance cases.

Only after the architecture is approved should the corresponding software requirements be written and implementation begin.

### Phase 1 — App Platform + shared AI headless foundations

Implement only the minimum platform pieces needed by the first real App consumer:

```text
# App Platform
NexusAppManifest validation
Static AppRegistry
AppCapabilityBroker
App permission/grant resolution
App-scoped request/event dispatch contracts

# Shared AI Platform
LanguageModelPort / LanguageModelRouter
AiProviderService / ModelCatalogPort
ConversationInputLedgerService
ConversationCompactor / ContextHandoffService
ContextEngineService / ContextPlanner / ContextBudget
AiTelemetryService
```

No arbitrary dynamic App code loading is required.

### Phase 2 — Operations App headless Harness

Implement the built-in `packages/apps/operations/` backend contribution:

```text
AgentDefinitionService
AgentRunService
AgentRuntimeRegistry
AgentCoordinatorService
AgentDelegationService
AgentMessageProjector
AgentBackendPort / AgentBackendRouter
NativeAgentBackend
AgentToolRegistry
AgentPolicyService / AgentApprovalService
AgentIntentStateService
AgentLoopGuard
Operations settings service
```

The headless App must prove that two AgentDefinitions can participate in one run with different provider/model selections while still passing App capability checks plus the same Tool/Policy/Approval path and bounded shared Context plan.

First tools:

```text
diagnostics.run
shell.exec
fs.list
fs.read
```

The first context implementation can use the canonical user-input/message ledger + recent exact window + incremental `AgentUserIntentState` + bounded digest segments; shared `RecallPort`, Skills and advanced checkpoints may remain simple behind their final boundaries. Even in this minimal form, the App must not recompute a full-thread summary on every turn.

No frontend dependency should be required to exercise the core behavior through the future public Interface.

### Phase 3 — execution + result/artifact safety

- resolve existing stored connection through the current credential/connection path;
- create independent `ownerType: 'agent'` ExecutionSessions per AgentRuntime;
- map each runtime's logical target alias → internal session;
- enforce deterministic cleanup by runtime id and aggregate cleanup by parent run;
- propagate cancellation to all runtimes/delegations;
- keep credentials outside model/tool-visible data;
- use the shared AI Platform `ToolResultProcessor` so command/file/tool output is bounded before model context;
- use the shared `ArtifactStorePort` for large outputs/diffs/reports and bounded read-back;
- establish `AgentResourceLeaseService` primitives before enabling concurrent mutation;
- feed tool/result/context-size telemetry into the run metrics path.

### Phase 4 — persistence + App protocol + durable goal/checkpoint base

- implement Operations App repository ports plus Infrastructure adapters for complex typed records, or use namespaced AppStorage where appropriate;
- persist Operations AgentDefinitions/versions, participants, UserIntentState, runs/runtimes, delegations, steps, tool calls, approvals, App settings, ACP backend definitions/capability snapshots and Goals/Plans/Checkpoints while referencing shared canonical Conversation/Digest/Provider/Memory/Artifact records;
- add App-scoped transport-neutral handlers under `/api/v1/apps/nexus.operations/...` and shared AI contracts under `/api/v1/ai/...`;
- ensure Provider and ACP backend credentials remain write-only/redacted and use SecretCipher at rest; Provider secrets remain AI Platform-owned while ACP secrets remain Operations App-owned;
- implement ordered SSE events/reconnect;
- reconcile in-flight runs to `interrupted` after restart where needed;
- checkpoint only structured durable state; resume always creates fresh AgentRuntime/ExecutionSession resources.

### Phase 5 — Operations App frontend contribution

Implement `packages/apps/operations/frontend/` and register it through the Frontend App Registry:

- App navigation contribution and `/apps/operations` home;
- left conversation/Goal rail, primary conversation surface and responsive Inspector;
- target/team/model setup for a new task;
- participant-attributed streaming conversation;
- user input composer backed by canonical Conversation APIs;
- structured Tool result cards and lazy Artifact viewer;
- exact Approve/Deny cards;
- Goal/Plan view;
- run/runtime/delegation Timeline;
- safe Context/token/Recall/Skill provenance inspector;
- participant/team/model editor;
- Cancel/reload/reconnect durable state;
- Operations-specific settings contribution;
- shared Provider/model settings consumed from `features/ai`, not duplicated in the App.

Do not import Workspace runtime internals or register global navigation/router state directly; use App UI contributions.

### Phase 6 — Skills + dynamic Tool Discovery

After the native core is stable:

- use the shared AI Platform `SkillRegistry`/Resolver/Loader with metadata-first progressive disclosure;
- support built-in Skills first, then user/project/extension Skills with explicit trust metadata and per-app capability acceptance;
- record effective Skill id/version for audit where it changes Operations Agent behavior;
- use shared `ToolCatalog`/`ToolDiscoveryService` so large catalogs do not place every schema in context;
- retain direct exposure for the small native V1 tool set;
- make Skill tool hints capability-discovery hints only, never permissions;
- prepare the catalog for MCP descriptors without making MCP a V1 dependency.

### Phase 7 — mutation hardening + verification

Add after the V1 approval path is reliable:

```text
fs.write
fs.remove
docker.inspect
docker.restart
```

With these mutation tools also add/activate:

- ResourceLease enforcement for overlapping logical resources;
- independent Reviewer/Evaluator policy for risky changes;
- staged ChangeSet/diff/validation/rollback metadata where the capability supports it;
- post-action verification;
- LoopGuard handling of repeated failing mutations/replans.

Every new mutating tool requires explicit risk classification and approval policy before exposure to the model.

### Phase 8 — ecosystem and advanced execution

Only after real product requirements:

- long-running command UX;
- multi-target/multi-host runs;
- transfer/archive tools;
- richer Goal/checkpoint/resume UX;
- vector/hybrid Recall and reranking if history volume justifies it;
- external MCP servers through dynamic Tool Discovery;
- concrete ACP backend adapter/client implementation behind `AgentBackendPort`;
- additional explicitly supported external Agent backends;
- Operations-internal Hook/extension bundles after Skill/Tool/Policy ownership is stable;
- optional Agent-owned interactive shell.

At every phase, use the Eval Harness and token/cost telemetry to confirm that added complexity improves task success or safety rather than only increasing prompt/tool overhead.

## 21. Recommended V1 vertical slice

Use one end-to-end scenario to validate the whole architecture **including Multi-Agent and multi-model routing**:

Example team:

```text
Coordinator
  model: provider-a/model-x
  tools: none or read-only coordination tools

Linux Ops
  model: provider-b/model-y
  tools: diagnostics.run, shell.exec, fs.list, fs.read, later mutation tools

Reviewer
  model: provider-c/model-z
  tools: read-only verification tools
```

### Request

```text
帮我看看这台服务器为什么 nginx 起不来
```

### Multi-Agent diagnosis sequence

```text
User
  ↓
Coordinator delegates diagnosis to Linux Ops
  ↓
Linux Ops:
  diagnostics.run
  shell.exec: systemctl status nginx
  shell.exec: bounded journalctl -u nginx
  fs.read: relevant nginx config
  ↓
Linux Ops returns structured findings
  ↓
Coordinator asks Reviewer to validate diagnosis/risk
  ↓
Reviewer performs bounded read-only verification
  ↓
Reviewer returns concerns/confirmation
  ↓
Coordinator synthesizes explanation for user
```

### Agent response

The coordinator explains the likely root cause with participant-attributed findings and, if a mutation is needed, asks the capable Agent to propose the exact operation.

### Repair request

```text
帮我修
```

### Approval sequence

```text
Linux Ops proposes exact config write / restart
        ↓
policy = requireApproval
        ↓
frontend displays acting Agent + exact operation
        ↓
user approves
        ↓
server validates participant/runtime + operationHash
        ↓
Linux Ops executes exact approved operation
        ↓
Reviewer performs independent read-only verification
        ↓
Coordinator returns final response
```

This single slice validates:

- multiple AgentDefinitions in one run;
- different provider/model selection per Agent;
- LanguageModelRouter dispatch;
- coordinator → specialist → reviewer delegation;
- participant-attributed model streaming/messages;
- connection resolution;
- independent AgentRuntime-owned SSH execution;
- diagnostics;
- filesystem read;
- bounded command execution;
- deterministic policy shared across Agents;
- approval bound to the acting participant/runtime + operation;
- persistence of runtimes/delegations;
- audit;
- cancellation;
- frontend event handling;
- independent post-action verification.

## 22. Architecture acceptance for the first Operations App slice

Architecture acceptance:

- `nexus.operations` is registered through the App Platform using a validated built-in App manifest rather than a hard-coded special-case host path;
- requested App capabilities are resolved through `AppCapabilityBroker`; an undeclared/ungranted machine or AI capability cannot be obtained by Operations code;
- Multi-Agent is the Operations domain/runtime baseline; a one-Agent run is a valid special case;
- each AgentDefinition selects a runtime backend (`native` or architecture-supported `acp`) and native definitions independently select provider/model/config;
- Coordinator/Delegation depend on Operations App-owned `AgentBackendPort`/`AgentBackendRouter`, not directly on the shared `LanguageModelRouter`;
- native model calls route through the shared AI Platform `LanguageModelPort`/Router after App capability resolution;
- future ACP wire/session details remain behind an Operations App technology adapter and do not leak into Coordinator/domain/frontend App protocol state;
- every participant creates an independent AgentRuntime;
- AgentRuntime owns independent live ExecutionSession state;
- no Workspace raw runtime object is reused;
- no AgentRuntime shares raw SSH/SFTP/shell/process state with another AgentRuntime by default;
- coordinator/delegation cannot bypass the receiving Agent's App capability, target authorization, Tool policy or approval constraints;
- App package/Core Module/Platform/Infrastructure dependency direction remains valid and the architecture guard understands App source classes;
- Bootstrap remains the concrete in-process graph/App registration owner;
- every Operations Tool passes through App capability + Agent policy;
- approval is server-side and bound to `nexus.operations` + acting participant/runtime + target + exact normalized operation;
- raw model-provider/ACP-backend credentials and other secrets are not sent to models, other Agents, AppStorage, or persisted in Agent logs;
- Agent diagnostics use the existing diagnostics capability through the App boundary;
- canonical user inputs remain reconstructable and are not overwritten by conversation compaction;
- each turn updates UserIntentState/compaction metadata incrementally and does not require a full-thread summarization call;
- conversation digests carry source message/input ranges and can be invalidated/rebuilt from canonical history;
- every model turn uses a bounded Context Plan rather than unbounded concatenation of history/tool output;
- Goal/Intent/Digest/Recall overlap is de-duplicated before model context construction;
- model/runtime/context-epoch transition can build a structured handoff containing objective, user constraints, unresolved items and source/evidence refs without relying on hidden previous-model reasoning;
- large tool output is processed into bounded model-visible data with Artifact references when needed;
- installed Skills/Tool catalogs do not require all bodies/schemas to remain in context;
- LoopGuard can deterministically interrupt at least identical repeated tool calls/no-progress patterns;
- mutation-capable Multi-Agent paths have a ResourceLease ownership point before concurrent mutation is enabled;
- token/context/tool/cost telemetry can be recorded without raw prompt/secret logging;
- terminal run states clean up all AgentRuntime-owned ExecutionSessions.

Product acceptance for the first vertical slice:

- user can create a thread/run against one owned SSH connection;
- the run contains at least coordinator + specialist/reviewer participants;
- at least two participants can use different configured models/providers;
- coordinator can delegate a bounded task and receive a persisted result;
- specialist can perform bounded read-only diagnosis;
- messages/progress/results show the acting participant;
- risky mutation pauses for approval and shows the acting Agent;
- user can approve or deny;
- approved operation cannot change Agent/runtime/target/arguments before execution;
- reviewer can independently verify the post-action state;
- user can cancel an active run and all child runtimes/delegations stop;
- page reload can recover durable thread/run/runtime/delegation history;
- long conversation history can compact without removing the canonical user inputs or losing a later user correction/constraint from current IntentState;
- when a model/runtime/context-epoch handoff is exercised, the receiving runtime retains the active objective, critical constraints, unresolved items and relevant source/evidence references without replaying the entire thread;
- backend restart does not pretend live SSH state was restored;
- completed run shows an auditable participant-attributed sequence of model/delegation/tool/approval actions.

Verification acceptance:

- backend architecture guard passes;
- frontend architecture guard passes once frontend Agent code exists;
- TypeScript compilation passes;
- user-reachable Agent behavior is covered by repository-standard E2E tests, consistent with [Engineering Constraints](../software-requirements/engineering-constraints.md) and [E2E](../testing/E2E.md).

## 23. Architecture decisions summary

The current Nexus architecture is suitable for Agent functionality without a foundational rewrite.

Final decisions:

1. **Operations Agent is a Nexus App/plugin, not a permanent hard-coded Agent subsystem.** Its stable App id is conceptually `nexus.operations` and it is initially shipped as a built-in App.
2. **Built-in Operations uses the same App Manifest/Registry/Capability Broker model reserved for future Apps.** Built-in trust does not grant raw DB/Express/SSH/Workspace handles.
3. **Plugin-first does not mean arbitrary-code-first.** V1 statically registers compiled built-in Apps; dynamic install/signed packages/isolated third-party execution are later App Platform phases.
4. **Operations source ownership belongs under `packages/apps/operations/` with backend/frontend/locales/assets contributions.** Shared AI/Core capabilities stay outside the App package.
5. **Future installed App code and mutable App data are separate.** Versioned packages live under `${NEXUS_DATA_DIR}/apps/installed/...`; mutable data lives under `${NEXUS_DATA_DIR}/apps/data/...` and staging is never executed directly.
6. **App capabilities are ceilings, not action approvals.** `discoverable != declared != granted != callable != approved`.
7. **Operations requests AI and managed-machine capabilities through `AppCapabilityBroker`.** It never receives a generic service locator.
8. **Multi-Agent is the Operations App baseline from day one.** A one-Agent run is only a special case.
9. **Each Agent is defined by an `AgentDefinition` with a runtime backend.** Native Agents select provider/model/config; ACP Agents reference a configured external backend and optional backend-supported model selection.
10. **Each participant gets its own `AgentRuntime`; backend execution and live resource ownership are runtime-scoped.**
11. **Use `AgentCoordinatorService` + durable `AgentDelegation` for collaboration instead of hidden model-to-model or ACP peer-to-peer calls.**
12. **Coordinator is not privileged.** Delegation never transfers App capability, target access, Tool permission or approval.
13. **Coordinator depends on `AgentBackendPort`/`AgentBackendRouter`, not directly on `LanguageModelRouter`.** This is the native/ACP backend boundary inside the Operations App.
14. **Keep the built-in App in the existing Nexus process for the first implementation.** Do not start with a separate Agent microservice.
15. **Do not refactor Workspace into an Agent/App host.** Workspace remains an independent runtime; the App Platform is the host.
16. **Reuse Platform execution/filesystem/Docker/transfer/archive/status capabilities only through App-granted capability contracts.**
17. **Use independent Agent ExecutionSessions with `ownerType: 'agent'` and `AgentRuntime.id` ownership.** An App-level grant never permits runtime session sharing.
18. **Keep each Agent loop small.** Reusable Provider/Conversation/Context/Memory/Skill/Artifact concerns live in shared AI Platform; Operations orchestration/safety/managed-target semantics stay in the Operations package.
19. **Keep `LanguageModelPort`, `ModelCatalogPort`, `LanguageModelRouter` and Provider configuration in shared `modules/ai`.** Keep `AgentBackendPort`/Router inside `packages/apps/operations/backend`.
20. **Support multiple native Provider adapters simultaneously and normalize model capability differences at the shared AI boundary.**
21. **ACP wire/session/permission details remain behind an adapter implementing the Operations App backend contract.** The browser never speaks ACP directly.
22. **Settings are contributions, not a hard-coded Agent tab requirement.** Shared AI settings belong to AI Platform; ACP/Multi-Agent/permission/runtime settings belong to the Operations App. Final visual grouping is decided when UI requirements are confirmed.
23. **Provider and ACP backend credentials are write-only/encrypted with Nexus SecretCipher.** Provider secrets are shared AI state; ACP secrets are Operations App state; neither is copied into AppStorage or normal DTOs.
24. **Shared model catalogs are discovered server-side, cached, refreshable, and reusable by every granted App.**
25. **Multi-Agent participant/concurrency/delegation/step/time/token/cost limits are deterministic server-enforced ceilings.**
26. **Use narrow Operations Agent tools rather than exposing the Capability Broker or Platform APIs generically to models/ACP backends.**
27. **Make deterministic policy and first-class approval mandatory before protected mutation.**
28. **Bind approval to acting participant/runtime + App id + target + exact normalized operation hash.**
29. **ACP-backed actions against Nexus-managed resources enter the same Operations Tool/Policy/Approval/Audit/Capability path as native actions.**
30. **Use bounded command execution first; do not default autonomous execution to persistent interactive PTY.**
31. **Persist product trajectory/Goal/Plan/Checkpoint/Artifact metadata, never raw live transports or Provider-client/prompt-cache objects.**
32. **Use App-scoped HTTP + SSE under `/api/v1/apps/nexus.operations/...` for the first UI protocol.** Add a dedicated duplex channel only for a proven requirement; never reuse Workspace WS frames.
33. **Operations frontend lives in `packages/apps/operations/frontend/` and contributes navigation/routes/settings through the Frontend App Registry.** It never mutates global router/store ownership directly and never imports Workspace internals.
34. **The primary UI is conversation-centered:** left conversation/Goal rail, central attributed conversation/composer, right Plan/Timeline/Context/Artifact/Participant inspector; narrow screens collapse rails into drawers.
35. **Approval UI is a distinct high-priority card showing acting Agent, App, target, exact operation, risk and details.** Plan acceptance is not mutation approval.
36. **Context/token UI is explainability metadata, not a raw system-prompt/hidden-reasoning viewer.**
37. **Use MCP for external tools/data, not as a wrapper requirement for native Nexus machine capabilities.**
38. **ACP is architecture-supported as an Operations Agent backend kind; concrete ACP delivery is deferred until separately chosen.**
39. **Recall retrieval/storage mechanics are shared AI capabilities with mandatory App scoping.** Operations decides which target/incident memories are meaningful; memory never grants permission or satisfies approval.
40. **Context Engine is shared and bounded.** Operations contributes AgentDefinition/Goal/Plan/delegation/target sections through an App-owned projection/contributor boundary.
41. **Canonical user input/history is shared conversation truth.** Recent exact history, incremental digests and source refs prevent long conversations from requiring full replay; summaries never replace original user input.
42. **Model/runtime/context-epoch switching uses structured handoff plus App-specific state contribution.** Preserve objective, constraints, corrections, decisions, unresolved items and evidence refs; do not depend on hidden previous-model reasoning.
43. **Instruction/data trust is explicit.** Logs, remote files, MCP/web/Tool output are untrusted data by default and cannot silently become system instructions.
44. **Skills use shared progressive disclosure.** Load metadata first, selected body next, resources/scripts on demand; Skill selection never grants App/Tool permission.
45. **Tool catalogs scale through dynamic discovery.** Installed Native/MCP/extension Tools do not imply every schema is permanently injected into model context.
46. **Large Tool results use shared ToolResult/Artifact infrastructure.** Models receive bounded summaries/previews and fetch Artifact ranges only when needed.
47. **`AgentLoopGuard` detects repeat/no-progress patterns before max-step exhaustion.** The model cannot disable its own guard.
48. **`AgentResourceLeaseService` coordinates overlapping Multi-Agent mutations.** Independent ExecutionSessions alone do not prevent logical resource races.
49. **Goal, Plan and structured Checkpoint have separate lifetimes.** Checkpoint resume creates fresh runtimes/sessions and revalidates current machine state.
50. **Reviewer/Evaluator activation is risk/complexity-policy driven.** Trivial reads should not pay unnecessary reviewer/model cost.
51. **Prefer staged ChangeSet/diff/validation/rollback flows where a mutation capability supports them.** Reversibility is declared, never assumed.
52. **Common token/cost/context telemetry belongs to the AI Platform; Operations owns task-success/safety interpretation and app-specific evals.** Do not log raw secrets/prompts merely for metrics.
53. **App-to-App isolation is default.** Future Roleplay/Development Apps reuse App/AI contracts but do not import Operations domain/runtime/store; explicit AppIntent/AppEvent/Artifact contracts mediate collaboration.
54. **Do not introduce swarm/DAG/marketplace/general third-party plugin complexity merely because the architecture is extensible.** Add those only after real product requirements and security boundaries are proven.

## 24. When a separate Agent service becomes justified

Do not split Agent execution into a separate service merely because model calls are asynchronous.

Reconsider the boundary only when there is a demonstrated requirement such as:

- independent horizontal scaling of model/Agent workers;
- dedicated sandbox/container fleet;
- durable distributed queue ownership;
- workloads that must survive Nexus API process restarts independently;
- separate security/network boundary;
- high-cost model workloads requiring independent scheduling/admission control.

If that time arrives, preserve the current Module contract and move the concrete Agent runner/model executor behind it rather than leaking distributed-system concepts through the whole product.

---

This document defines the target Agent architecture. Implementation must still update the relevant software requirements before introducing user-reachable Agent behavior, and must keep the current engineering constraint register authoritative.
