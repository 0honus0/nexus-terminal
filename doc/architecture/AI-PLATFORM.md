# Nexus AI / Conversation Platform Architecture

> Status: target architecture / design only.
>
> This document defines the reusable AI/conversation capability layer consumed by Nexus Apps. It does **not** define Operations Agent product behavior and does not imply Roleplay/Development Apps are approved or implemented.
>
> The plugin/application host is defined in [App Platform Architecture](./APP-PLATFORM.md). Operations-specific behavior is defined in [Operations Agent Architecture](./AGENT.md). Software requirements are intentionally deferred until this architecture is accepted.

## 1. Position in the system

The AI Platform is a reusable capability provider under the App Platform, not an App by itself.

```text
                       Nexus App Platform
                              │
                       Capability Broker
                              │
               ┌──────────────┴──────────────┐
               │                             │
        AI / Conversation Platform      Machine Platform
               │                             │
        Model / Provider                ExecutionSession
        Conversation                    Filesystem
        Context                         Docker
        Memory / Recall                 Diagnostics
        Skills / MCP                    Transfer
        Artifact / Telemetry
               │
               └──────────────┬──────────────┘
                              │
                         Nexus Apps
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
              Operations   Roleplay    Development
              built-in     future       future
```

Apps consume the AI Platform through granted capabilities such as `ai.model.use`, `ai.conversation.*`, `ai.context.compose`, `ai.memory.*`, `ai.skills.use`, `ai.tools.discover` and `ai.artifacts.*`.

The AI Platform never imports or depends on an App package.

## 2. Shared ownership

The platform owns capabilities that remain meaningful if Operations Agent does not exist:

```text
Provider / Model Router
Canonical Conversation / User Input Core
Context Engine / token budget
Incremental compaction / handoff
Memory / Recall retrieval infrastructure
Skill registry / progressive disclosure
Generic Tool Catalog / MCP descriptor discovery
Tool-result normalization
Artifact storage/read contracts
Common AI telemetry / eval primitives
```

App-specific meaning remains inside the App:

```text
Operations App
  AgentDefinition / Goal / Plan / Delegation / Approval / target policy

Roleplay App (future example)
  Character / Persona / World / Lore / Scene / Speaker policy

Development App (future example)
  repository / coding task / patch / test / review semantics
```

## 3. Provider and model layer

Shared Provider configuration includes:

- Provider adapter type;
- display name;
- optional Base URL;
- enabled state;
- encrypted API credential;
- normalized model catalog;
- capability metadata;
- refresh/test state.

Conceptual model reference:

```ts
interface AiModelRef {
  providerId: string;
  modelId: string;
}
```

An App stores only model references/configuration. It does not copy Provider credentials.

Provider secrets are write-only. Normal reads return safe state such as:

```ts
interface AiProviderView {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl?: string;
  apiKeyConfigured: boolean;
  modelCatalogStatus: 'unknown' | 'ready' | 'stale' | 'error';
}
```

The Browser never calls a model Provider with stored Nexus credentials.

## 4. Canonical Conversation / User Input Core

Conversation history is a shared factual substrate.

```text
Canonical Conversation
├── participants/senders
├── messages
├── user inputs
├── attachments / Artifact refs
├── branches/variants where enabled
└── source sequence/provenance
```

The original user input is the reconstructable source of truth. Compaction never becomes the only surviving representation of what the user said.

```text
canonical history
      │
      ├── Recent Exact Window
      ├── incremental Digest segments
      ├── app-specific derived state
      ├── Recall
      └── Context Handoff
```

Each user input receives a stable id/sequence. Corrections are appended and can explicitly supersede earlier input; normal operation does not silently rewrite history.

### 4.1 App-specific projections

The shared platform does not invent one universal interpretation of a conversation.

```text
Operations projection
  objective
  constraints
  corrections
  open work
  Goal / Plan references

Roleplay projection (future)
  SceneState
  relationship state
  active speaker
  unresolved story threads
```

The App owns these projections and contributes them back to the Context Engine through a narrow contribution contract.

## 5. Incremental compaction

Every turn may run a cheap compaction planning pass, but a real summarization call occurs only when budget/watermark rules require it.

```text
new messages
    ↓
append canonical history
    ↓
update app projection incrementally
    ↓
Compaction Planner
    ├── within budget -> no-op
    └── over budget
           ↓
       compact only newly eligible old range
```

Avoid repeated whole-history summarization:

```text
BAD
100K history -> summarize -> next turn 101K history -> summarize again

GOOD
Digest A covers seq 1..50
Digest B covers seq 51..90
Recent exact covers seq 91..current
```

Digest segments retain source ranges, generation metadata and provenance so they can be rebuilt from canonical history when drift/invalidation is detected.

## 6. Context Engine

The shared Context Engine constructs a bounded Context Plan; Apps contribute semantic sections.

```text
ContextEngineService
        │
        ├── shared stable sections
        │     system / security / model contract
        │
        ├── App contributions
        │     Operations Goal/Plan/AgentDefinition
        │     or future Roleplay Character/Lore/Scene
        │
        ├── conversation
        │     digest + recent exact
        │
        ├── Recall
        ├── selected Skills
        ├── Tool schemas/results
        └── Artifact refs
```

Conceptual plan:

```ts
interface ContextPlan {
  epochId: string;
  sections: ContextSection[];
  totalBytes: number;
  estimatedTokens?: number;
  truncated: boolean;
}
```

### 6.1 Stable prefix strategy

Prefer deterministic ordering:

```text
Stable
  system / security / stable capability descriptions

Semi-stable
  app definition / Goal / selected Skill / target or scene facts

Dynamic tail
  current input / recent messages / Recall / Tool result
```

When Provider prompt caching exists, stable-prefix reuse is an optimization. Correctness must never depend on a Provider cache.

### 6.2 Context epoch

Start a new context epoch when stable semantics materially change, for example:

- model/provider switch;
- major system/security contract change;
- incompatible Tool schema set;
- App runtime handoff requiring a new backend;
- explicit rebuild after digest drift.

## 7. Context handoff

Model/App runtime switching should transfer explicit structured state instead of replaying an unbounded conversation or attempting to preserve hidden model reasoning.

```ts
interface ContextHandoff {
  conversationId: string;
  latestExactInputRefs: string[];
  digestRefs: string[];
  memoryRefs: string[];
  artifactRefs: string[];
  appContribution: unknown;
}
```

For Operations Agent the App contribution can include objective, constraints, decisions, unresolved items, Goal/Plan/Checkpoint and evidence refs.

The platform does not persist or depend on hidden chain-of-thought.

## 8. Context trust and prompt-injection boundary

Every context source carries provenance/trust metadata.

```text
trusted
  Nexus system/security contract
  explicitly trusted built-in configuration

semi-trusted
  app/project instructions
  approved Skill content

untrusted data
  remote files
  logs
  web results
  MCP output
  Tool output
```

Untrusted content remains data even when it contains instruction-like text.

Context trust classification does not replace App capability policy or action approval.

## 9. Memory / Recall

The shared layer owns storage/retrieval mechanics; the App owns meaning and visibility policy.

```text
App query/context
      ↓
App memory policy
      ↓
RecallPort
      ↓
app-scoped candidate retrieval
      ↓
rank / budget / provenance
      ↓
Context Engine
```

Every memory record carries App ownership/scope so two Apps cannot accidentally recall each other's private domain memories.

Example Operations memory:

```text
incident
  nginx failed because certificate path was invalid
  target = server-a
  source run = ...
```

Future Roleplay memory might represent an episode/relationship fact, but uses the same retrieval mechanics without sharing Operations data.

### 9.1 Recall is informational only

Recall never grants:

- App capability;
- target authorization;
- Tool permission;
- action approval;
- reuse of an old operation hash.

Current protected actions still pass current policy/approval and current machine observation.

### 9.2 Retrieval implementation

Do not lock the architecture to a vector database.

Possible implementations behind the same port:

```text
SQLite FTS
vector retrieval
hybrid lexical + vector
reranker
external memory service
```

Start simple until real history volume demonstrates a need.

## 10. Skills

Skill is shared reusable workflow/knowledge, not an App.

```text
SkillRegistry
     ↓
metadata only
     ↓
SkillResolver
     ↓
selected Skill body
     ↓
resources/scripts only when needed
```

Use progressive disclosure:

1. load name/description/tags first;
2. load selected instructions only;
3. load resource/script only on demand.

Each App defines which Skill capabilities are accepted. A Skill hint can narrow Tool discovery but cannot grant an App a capability or bypass its own action policy.

## 11. Tool Catalog and MCP

The shared Tool Catalog stores descriptors, not universal execution permission.

```text
Native capability descriptors
MCP descriptors
App-provided descriptors
        ↓
ToolDiscoveryService
        ↓
search / describe
        ↓
selected schemas only
```

This prevents hundreds of installed Tool schemas from occupying every model turn.

Execution remains App-owned when domain safety differs. In particular, Operations shell/filesystem/Docker tools are owned by the Operations App and ultimately use granted machine capabilities through the App Capability Broker.

## 12. Tool Result / Artifact handling

Large data should not repeatedly enter model context.

```text
Tool output 100 KB
       ↓
ToolResultProcessor
       ├── short summary
       ├── structured metadata
       ├── bounded preview
       └── artifactRef
```

The model can request a bounded range later.

Shared Artifact metadata includes:

- owner user/App/conversation/run;
- content type;
- size;
- retention;
- redaction/sensitivity metadata;
- source/provenance;
- bounded read/range support.

Artifact access is not a raw filesystem escape hatch.

## 13. Common telemetry / eval primitives

Shared telemetry can record:

```text
provider/model
input/output/cached tokens
cost
context section sizes
compaction count/rebuild count
Skill loads
Tool schemas loaded
Artifact original vs visible bytes
Recall query/hits
model latency
```

App-specific telemetry adds domain outcomes. Operations can add run/runtime/delegation/approval/LoopGuard/ResourceLease/task success data.

Do not log raw prompts, full Tool output or secrets merely for telemetry.

## 14. Shared settings and public API

Provider/model and genuinely shared AI resources are not owned by a particular App.

Target public namespace:

```text
/api/v1/ai/providers
/api/v1/ai/providers/:providerId/credential
/api/v1/ai/providers/:providerId/models
/api/v1/ai/settings
```

The App Platform may compose shared AI settings into a global AI Settings surface or expose them contextually from an App. UI placement does not change ownership.

## 15. Source ownership

Target shared Backend ownership:

```text
packages/backend/src/modules/ai/
├── model/
│   ├── language-model.port.ts
│   ├── language-model-router.ts
│   ├── model-catalog.port.ts
│   └── provider.service.ts
├── conversation/
│   ├── conversation.types.ts
│   ├── conversation.service.ts
│   ├── input-ledger.service.ts
│   ├── conversation-compactor.ts
│   └── context-handoff.ts
├── context/
│   ├── context-engine.service.ts
│   ├── context-planner.ts
│   ├── context-budget.ts
│   └── context-safety.service.ts
├── memory/
│   ├── recall.port.ts
│   └── memory.service.ts
├── skills/
├── tools/
│   ├── tool-catalog.ts
│   ├── tool-discovery.service.ts
│   └── tool-result-processor.ts
├── artifacts/
├── observability/
└── repositories/
```

Shared Frontend capability ownership:

```text
packages/frontend/src/features/ai/
├── providers/
├── conversation/
├── skills/
├── artifacts/
└── public.ts
```

Complete App UIs do not live here. They live inside their App package as defined by [App placement](./APP-PLATFORM.md#app-placement).

## 16. Persistence ownership

Illustrative shared records:

```text
ai_providers
ai_provider_models
ai_conversations
ai_messages
ai_user_inputs
ai_conversation_digests
ai_artifacts
ai_memories
```

Every App-scoped record includes explicit owner/App identity. Shared records are never a backdoor around App permission boundaries.

## 17. Architecture acceptance

The AI Platform boundary is correct when:

- it can exist with Operations App disabled;
- it has no runtime import from any App package;
- Provider credentials/model catalogs are configured once and reused safely;
- canonical history survives compaction and App/model handoff;
- context is bounded and reconstructable;
- app-specific derived state stays app-owned;
- Recall is app-scoped and cannot grant permission;
- Skill/Tool discovery is metadata exposure, not authorization;
- large outputs can stay in Artifact storage rather than repeated context;
- frontend shared AI features do not own App runtime state;
- all protected machine actions still flow through the owning App and Capability Broker.
