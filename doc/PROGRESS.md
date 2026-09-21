# Agent Unified Target Capability Refactor

> Temporary cross-session execution handoff. A new session should treat this file as the authoritative implementation plan after first verifying the current branch, HEAD, and worktree status. After the destructive refactor is fully implemented, the legacy architecture is removed, and final verification passes, delete the entire `doc/PROGRESS.md` file.

## Goal

Replace the duplicated Workspace and SSH/Machine Agent tool architecture with a single capability-oriented tool surface plus target adapters.

The model-facing contract must express **what the Agent wants to do** through one shared tool family, while `target + id` identifies **where the action runs**.

No compatibility aliases, transitional shims, legacy tool names, or legacy capability strings are to remain after the refactor.

## Target Model

Shared target selector:

- `target: "workspace" | "ssh"`
- `id: string`
- File operations additionally take `path`.
- Shell operations additionally take `command`.
- Workspace generation, SSH configuration hash, credentials, routes, and other transport identity data are resolved and frozen by the Host; the model must not supply them.

Examples:

```json
{ "target": "workspace", "id": "ws_123", "path": "src/index.ts" }
```

```json
{ "target": "ssh", "id": "12", "path": "/etc/nginx/nginx.conf" }
```

```json
{ "target": "workspace", "id": "ws_123", "command": "pnpm test" }
```

## Architecture

```text
Model / Agent
    |
    v
Capability Tool Layer
    file_read
    file_write
    file_patch
    file_list
    file_search
    file_move
    file_delete
    shell_execute
    shell_job
    target_inspect
    container_manage
    environment_manage
    ...
    |
    v
Target Resolver
    target + id
    |
    +-------------------+
    |                   |
    v                   v
Workspace Adapter      SSH Adapter
    |                   |
Runner / Container     SSH / SFTP
```

Rules:

1. Capability tools define the operation semantics.
2. Target adapters define how the operation reaches Workspace or SSH.
3. Safety, approval, leases, operation hashes, preconditions, reconciliation, and audit remain Host-owned.
4. Shared operations must not have separate Workspace and SSH tool implementations.
5. Target-specific operations may remain specific only when the capability itself is genuinely target-specific.

## New Capability Taxonomy

Permissions are capability-oriented rather than module-oriented.

Primary capabilities:

- `file.read`
  - file read
  - list
  - search
  - stat
  - repository map
  - read-only code intelligence
- `file.write`
  - create
  - write
  - patch
  - move
  - rename
- `file.delete`
  - remove file
  - remove directory
- `shell.execute`
  - command execution on Workspace or SSH
  - foreground/background execution where supported
- `target.inspect`
  - target discovery
  - connection/system diagnostics
- `container.manage`
  - container start/stop/restart/remove
- `environment.manage`
  - Workspace lifecycle/runtime/toolchain management
- `browser.read`
- `browser.interact`
- `integration.read`
- `integration.invoke`
- `artifact.read`
- `artifact.write` when model-authored Artifact creation is exposed
- `app.intent.exchange`

Capability and target are independent dimensions.

Example target-scoped grant:

```json
{
  "capability": "file.read",
  "scope": {
    "kind": "targets",
    "targets": {
      "workspace": { "mode": "all" },
      "ssh": { "mode": "ids", "ids": ["12", "18"] }
    }
  }
}
```

Global capabilities use `{ "kind": "global" }`. Authorization validates both the capability and the concrete canonical `target + id`; target-scoped capabilities are denied when the concrete target is absent from the grant.

## Destructive Migration Status

The shared **file** split has now been removed from runtime code:

- model-facing file operations use one canonical `file_*` family for Workspace and SSH;
- file authorization uses `file.read`, `file.write`, and `file.delete`;
- Workspace repo-map/code-intelligence remain Workspace-specific navigation tools but consume `file.read`;
- Subagent delegation carries scoped grants rather than capability-name arrays;
- persisted App grants use schema v2 typed scopes;
- Frontend permission drafts submit complete `capability + scope` grants.

There are no runtime aliases or legacy scope decoders. Database migrations 35–38 perform a one-time destructive rewrite of persisted grants, Subagent delegation authority, and persisted Plugin manifests into the canonical model; runtime repositories reject old durable shapes after migration.

The shared **shell/execution** split has now also been removed from runtime code. `shell_execute` is the canonical model-facing execution Tool under target-scoped `shell.execute`; Workspace keeps argv + durable Runner Job transport semantics, SSH keeps bounded foreground shell-text transport semantics, and `shell_job` is the canonical Workspace durable-job control surface. Completion/recovery consume typed execution semantics rather than Tool-name sets. Workspace lifecycle/runtime management remains intentionally Workspace-specific.

## Implementation Plan

### 1. Inventory

- Enumerate all legacy file/shell tools, capabilities, manifests, Skills, frontend permission metadata, Run context projection, Subagent policy, checkpoint/recovery references, deterministic tests, and E2E fixtures.
- Identify Workspace-only features that should remain Workspace-specific, such as lifecycle/runtime management.
- Identify SSH-only features that should remain target-specific, such as SSH diagnostics and remote Docker management.

### 2. Core Target Contract

- Introduce a canonical Agent target type using `target + id`.
- Replace shared `machine/workspace` target identity branching with target resolution.
- Redesign `ToolTargetFingerprint` around the canonical target identity while preserving immutable backend-specific fingerprints.
- Ensure Workspace generation and SSH configuration hashes remain Host-resolved preconditions.

### 3. Unified File Capability

Create one shared file service/tool implementation for Workspace and SSH targets.

Required model-facing operations:

- `file_read`
- `file_write`
- `file_patch`
- `file_list`
- `file_search`
- `file_move`
- `file_delete`

Requirements:

- Same schema shape across supported targets.
- Read results include stable source hash where applicable.
- Write/patch mutations use hash/metadata preconditions.
- Patch keeps strict unified diff semantics and zero-fuzz context matching.
- Atomic replacement and post-write verification are preserved.
- Workspace path confinement remains enforced.
- SSH sensitive-path deny rules remain enforced.
- Resource keys, leases, mutation approval, and reconciliation bind to canonical target identity.

### 4. Unified Shell Capability

Replace Workspace command execution and SSH shell execution with:

- `shell_execute`
- `shell_job` for durable/background job control if retained

Schema starts with:

- `target`
- `id`
- `command` or structured execution payload
- cwd/timeout/mode as supported shared options

Target adapters:

- Workspace -> Runner/container execution
- SSH -> SSH execution

Completion-gate evidence and recovery/checkpoint logic must consume typed execution/job semantics and must not infer execution meaning from Tool names.

### 5. Target Adapters

Implement backend adapters behind the shared capability layer:

- Workspace target adapter
  - Runner/Docker-backed filesystem and execution
  - generation-bound fingerprint
  - Workspace path confinement
- SSH target adapter
  - SFTP-backed filesystem
  - SSH execution
  - configuration-hash-bound fingerprint
  - connection selection and denylist validation

Do not duplicate shared file/shell policy logic inside adapters.

### 6. Authorization / Grants

Replace module-oriented grants with capability-oriented grants.

- Update `AgentCapability`.
- Update App manifests and default grants.
- Extend capability grant scope so it can authorize target kinds and, where required, specific target IDs.
- Update `AppCapabilityBroker` to authorize against concrete `target + id`.
- Ensure model-facing tool availability and execution authorization use the same capability/target truth.
- Preserve policy revision conflict handling.

### 7. Frontend Permission Management

Replace Machine/Workspace permission groupings with capability groupings:

- Files
  - Read
  - Write
  - Delete
- Shell
  - Execute
- Targets
  - Inspect
- Containers
  - Manage
- Environments
  - Manage
- Browser
- Integrations
- Artifacts
- App intents

Permission UI should display/configure allowed target scopes separately from capability identity.

### 8. Agent Context / Tool Projection

- Project the accessible Workspace and SSH target IDs into Run context.
- Teach the model that all shared tools require explicit `target + id`.
- Remove instructions referring to Machine tools or separate Workspace file/shell tools.
- Update Subagent capability projection and mutation restrictions to the new capability/target model.

### 9. Remove Legacy Code

After new paths are wired:

- Delete old Workspace shared file/shell tool factories.
- Delete old Machine shared file/shell tool factories.
- Delete obsolete ports/types created only for duplicated implementations.
- Remove old capability entries from manifests, Skills, frontend metadata, fixtures, and tests.
- Remove stale comments and architectural terminology that describe the deleted model.
- Do not leave deprecated aliases.

### 10. Verification

Required before this plan may be removed:

- Backend TypeScript check passes.
- Backend build passes.
- Frontend typecheck/build passes.
- Deterministic Agent scenarios pass.
- Relevant E2E coverage passes or any environment-only blocker is documented and independently verified.
- Unified file operations are tested for both:
  - Workspace target
  - SSH target
- Unified shell execution is tested for both:
  - Workspace target
  - SSH target
- Capability scope tests prove target-kind/target-ID restrictions.
- Mutation approval, policy revision, lease, hash precondition, stale target configuration, and reconciliation regressions pass.
- Legacy scan shows no obsolete shared architecture remains:
  - no old shared tool names
  - no old file/shell capability strings
  - no compatibility aliases/shims
  - no duplicated Workspace-vs-SSH implementation of the same shared operation
- Final diff is reviewed for architectural leakage.

## Architecture Audit Findings (2026-09-21)

A whole-Agent architecture audit was performed while Step 3 was in progress. The long-term App -> Thread -> Run -> AgentRuntime -> Tool/Workspace/Artifact/Integration model remains sound. The refactor should preserve the existing StateCommit, Approval, Lease, reconciliation, checkpoint, MCP/ACP, Browser, and Artifact authorities. The following findings refine the remaining implementation order.

### A. Capability / Grant scope is now a typed authority

**Implemented during Unified File.** `CapabilityGrant` now uses schema v2 `CapabilityGrantScope` with explicit `global` or `targets` variants. `CapabilityRegistry` owns capability identity, scope kind, supported target kinds, default scope construction, parsing, intersection, target restriction, and concrete target authorization.

Manifest capability validation, App grant persistence/API, onboarding defaults, `AppCapabilityBroker`, Frontend permission editing, deterministic tests, and durable decoding now consume the same canonical capability model. Runtime code does not decode the removed scope shape. Capability/Grant authorization remains separate from Approval and Lease, and policy-revision CAS remains intact.

### B. Subagent delegation now carries scoped grants

**Implemented during Unified File.** Durable `DelegationView` stores bounded delegated grants rather than capability-name arrays. Child authority is derived from the App grant and parent delegated grant intersection; file authority is further restricted to Workspace targets by default for Subagents, so SSH file access is not inherited implicitly.

Subagent model-facing Tool projection validates both descriptor capability and proposal/inspection target scope. Governed mutation execution still keeps the existing Workspace-only safety boundary until the later shared governed-execution refactor.

### C. Share governed mutation execution between Root and Subagent runtimes

`RootToolExecutionCoordinator` and `SubagentParticipantExecutor` both implement reinspection, policy decision, approval, duplicate-operation guard, lease acquisition, execution, quarantine, settlement, lease finalization, loop guard, and recovery-safe-point logic.

Extract a shared governed tool/mutation execution pipeline with runtime-specific durable commit callbacks. Keep Root/Subagent scheduling and lifecycle orchestration separate; do not create a second StateCommit authority.

### D. Target adapters are capability-specific narrow ports

**Implemented during Step 5.** Shared services no longer consume broad Workspace/Machine facades. `AgentTargetResolver` consumes `SshTargetResolverPort`; `FileCapabilityService` consumes `WorkspaceFileTargetPort + SshFileTargetPort`; `ShellCapabilityService` consumes `WorkspaceShellTargetPort + SshShellTargetPort`.

Physical adapters are split by backend capability: Workspace has dedicated File and Shell adapters over repository/controller/gateway ownership; SSH has distinct Target, File and Shell adapters over connection/session transports. `SshTargetAdapter` independently validates Run-selected connection membership and the Host denylist before freezing the connection fingerprint. `MachineCapabilityPort` now retains only Machine-specific connection/diagnostics/Docker operations, and `WorkspaceRuntimeService` no longer forwards canonical shared File operations. Shared policy/precondition/verification semantics remain in the capability layer. Do not recombine these into one universal God `TargetAdapter`.

### E. Durable execution semantics no longer depend on shell/job Tool names

**Implemented during Unified Shell.** `ToolResult` now carries typed `semantic.kind = "execution"` with canonical target, execution status, and optional durable Workspace job identity. Completion Gate consumes verified successful execution semantic; checkpoint/restart recovery consumes the durable job semantic. Neither owner maintains a Tool-name allowlist. One-time migrations project historical split-shell ToolResults into the typed semantic so runtime recovery does not retain legacy Tool-name compatibility branches.

### F. Unified Shell unifies Host semantics without erasing transport differences

**Implemented.** `shell_execute` exposes one Host execution capability with explicit command variants. Workspace accepts argv and supports foreground/background durable Runner jobs; SSH accepts shell text and currently supports foreground only. `shell_job` controls Workspace durable jobs. All executions share target-scoped authorization, inspection/operation-hash governance, frozen target fingerprint execution, approval/lease/reconciliation, and typed execution result semantics; backend transport syntax remains explicit instead of being falsely normalized.

### G. Frontend permission scope is contract-driven; Run target defaults still need tightening

**Partially implemented during Unified File.** Permission management now receives Host capability definitions and edits complete scoped grants. The Frontend retains only localized names/icons/descriptions; target scope kind, supported target kinds, and default scope come from the Host contract.

Still required in later target/UI cleanup:

- default new Runs to no SSH target unless the user explicitly selects/persists one;
- show canonical target kind/name/id and Environment in Run/TaskRail surfaces, not only raw connection IDs;
- expose read-only hard guardrail values from Backend instead of duplicating numeric values in i18n strings.

### H. Keep Host-owned Tool authority for installable Plugins for now

The current installable Plugin manifest can declare Host capabilities, AgentDefinitions, intents, Skills/frontend/backend/runner targets, but there is no general public custom Tool contribution ABI comparable to MCP-owned ToolCatalog replacement. The architecture docs should not imply arbitrary Plugin-defined Tool/Capability authority unless such an ABI is deliberately designed with namespace, scope, risk, operation-hash, recovery, and durable-state rules.

Near-term direction: keep Tool execution authority Host-owned; Plugins request declared Host capabilities and contribute supported higher-level surfaces.

### I. Small shared Tool construction helpers are justified

Many Host tool modules duplicate JSON record/scalar validation and operation-hash assembly. Extract small explicit helpers (`tool-input`, `inspection-builder`/canonical operation builder) to reduce drift. Do not build a framework that auto-infers risk, resource keys, or preconditions; those security semantics remain explicit in each Tool.

### J. Large-owner decomposition candidates after the target refactor

Do not split modules merely by line count. The confirmed multi-responsibility candidates are:

- `SubagentParticipantExecutor`: split model/tool/completion collaborators after shared governed execution is extracted.
- `Browser tools`: split tool families around one shared browser binding/session authority.
- `PluginInstallService`: separate package/install transaction, runtime lifecycle, and data-management collaborators while retaining one install orchestration facade.
- `WorkspaceRuntimeService`: continue extracting narrow file/shell/lifecycle adapters rather than making shared capability services depend on the broad service.
- `RootToolExecutionCoordinator`: should shrink naturally when governed tool execution is shared.

Do **not** split StateCommit into multiple durable mutation authorities. Internal transition helpers may remain separate, but the transactional facade stays singular.

## Implementation Status

- [x] **1. Inventory** — legacy shared Workspace/Machine file and shell surfaces, capability strings, grants, frontend metadata, context/Subagent policy, completion gates, recovery references, deterministic fixtures, and docs were enumerated on `dev`.
- [x] **2. Core Target Contract** — canonical `{ target: "workspace" | "ssh", id }` selector and `AgentTargetResolver` are wired through file/coding target resolution; SSH fingerprints use `ssh`; durable target decoding requires canonical target/id.
- [x] **3. Unified File Capability** — canonical `file_read/list/search/write/patch/move/delete` now share one `FileCapabilityService` across Workspace and SSH. Superseded shared file Tool factories/capabilities are removed from production registration, repo-map/code-intel consume `file.read`, project-instruction targeting/fallback metadata use canonical file operations, and execute paths consume the inspection-frozen Workspace generation / SSH configuration fingerprint rather than re-resolving `target + id`. Workspace/SSH behavior, target-scope authorization, and stale-target rejection are covered by deterministic scenarios.
- [x] **4. Unified Shell Capability** — canonical `shell_execute` now serves Workspace argv execution and SSH shell-text execution under target-scoped `shell.execute`; `shell_job` controls durable Workspace background jobs. ToolResult carries typed execution/job semantics, and completion/checkpoint/restart recovery no longer infer execution meaning from Tool names. Superseded Shell Tool factories are removed from production registration.
- [x] **5. Target Adapters** — shared File/Shell/target resolution now consume narrow capability-specific ports. Workspace uses dedicated File/Shell adapters; SSH uses dedicated Target/File/Shell adapters; `MachineCapabilityPort` no longer exposes shared File/Shell transport, and `WorkspaceRuntimeService` no longer forwards canonical File operations. Deterministic architecture assertions prevent broad-port regression.
- [x] **6. Authorization / Grants** — schema v2 typed `CapabilityGrantScope`, `CapabilityRegistry`, scoped App grant API/persistence/authorization, one-time durable migrations, and scoped Subagent delegation cover both File and Shell. Subagent File/Shell target authority is restricted to Workspace by default.
- [x] **7. Frontend Permission Management (grant scope)** — permission UI consumes Host capability definitions and submits complete scoped File/Shell grants. Least-authority Run target defaults/TaskRail target presentation remain later UI cleanup.
- [x] **8. Agent Context / Tool Projection (File + Shell)** — project-instruction/code-intel file projection uses canonical File operations; Workspace command path extraction uses canonical `shell_execute`; Subagent proposal/inspection projection enforces delegated target scope; durable execution projection uses typed semantics.
- [x] **9. Remove Legacy Shared File/Shell Code** — no runtime aliases/compatibility decoders or superseded shared File/Shell Tool/capability registration remain. Old strings exist only in destructive database migration SQL, dedicated migration fixtures, and negative legacy-leak assertions.
- [x] **10. Verification** — Unified File, Unified Shell, scoped grants, canonical target resolution, and narrow Target Adapters are fully verified. The destructive refactor plan is complete; after final review/commit this temporary handoff must be deleted per the cleanup rule below.

### Narrow Target Adapter verification checkpoint

- Backend `tsc --noEmit`: PASS.
- Agent Runner `tsc --noEmit`: PASS.
- Frontend `vue-tsc --noEmit`: PASS.
- Backend / Agent Runner / Frontend production builds: PASS.
- `pnpm format:check`: PASS.
- deterministic Agent scenarios: **73/73 PASS** after physical adapter extraction and architecture anti-regression assertions.
- `file/unified-targets`: PASS with real `WorkspaceFileTargetAdapter`, including Workspace generation stale rejection; SSH File continues to cover frozen configuration rejection, all canonical operations, and target-scoped grants.
- `shell/unified-targets` and `workspace/background-job-lifecycle`: PASS with narrow Shell target contracts and real `WorkspaceShellTargetAdapter`, preserving Workspace durable job lifecycle, SSH target isolation, and stale target failure.
- physical composition: PASS; compose constructs distinct `SshTargetAdapter`, `SshFileTargetAdapter`, `SshShellTargetAdapter`, `WorkspaceFileTargetAdapter`, and `WorkspaceShellTargetAdapter`.
- broad dependency scan: **0** for `WorkspaceRuntimeService/MachineCapabilityPort` in Unified File, `WorkspaceRuntimeGatewayPort/AgentWorkspaceRepositoryPort/MachineCapabilityPort` in Unified Shell, and `MachineCapabilityPort` in canonical target resolution.
- broad owner scan: **0** shared File/Shell transport methods in `MachineCapabilityPort`; **0** canonical shared File forwarders in `WorkspaceRuntimeService`.
- request-only Agent E2E: **2/2 PASS** after adapter extraction; migrations 35–44, canonical `shell_execute`, approval/duplicate-operation guard, SSH mutation, and SSH `file_read` all execute through the real product composition.
- `git diff --check`: PASS before final review.

### Unified Shell verification checkpoint

- Backend `tsc --noEmit`: PASS.
- Agent Runner `tsc --noEmit`: PASS.
- Frontend `vue-tsc --noEmit`: PASS.
- Backend / Agent Runner / Frontend production builds: PASS.
- `pnpm format:check`: PASS.
- deterministic Agent scenarios: **73/73 PASS**, including the new `shell/unified-targets`, expanded `migration/capability-grants-v2`, Workspace durable background-job lifecycle, completion gate, restart recovery, Subagent governed mutation, Machine target availability, and public contract alignment.
- canonical Shell target-isolation regressions: PASS for one Workspace plus multiple SSH targets in the same Run; fingerprints, operation hashes, backend calls, and typed execution results remain isolated per concrete target.
- canonical Shell stale-target regressions: PASS for Workspace generation changes and SSH configuration changes after inspection; execution consumes the inspection-frozen fingerprint and fails closed instead of rebinding `target + id`.
- canonical Shell transport-boundary regressions: PASS; Workspace accepts argv execution, SSH accepts foreground shell text, Workspace shell-text / SSH argv / SSH background misuse is rejected.
- migration 39–44 regression: PASS for Workspace-only / SSH-only / combined `shell.execute` App scopes, scoped Subagent grants, persisted/staged Plugin manifests, and legacy Workspace/SSH ToolResult projection into typed execution/job semantics.
- request-only Agent E2E directly affected by Unified Shell: **2/2 PASS** (`Agent Host installs Nexus Agent safely...` and `remote signed Nexus Agent plugin installs...`). The seeded database applies migrations 35–44, the provider emits canonical `shell_execute`, SSH mutation runs through approval/operation-hash governance, duplicate mutation is blocked, and subsequent `file_read` proves the side effect occurred once.
- runtime/doc/current-E2E legacy scan: superseded split-shell Tool/capability identifiers are zero outside one-time database migration SQL, the dedicated migration fixture, and the negative leak assertion.
- `git diff --check`: PASS at the Unified Shell verification checkpoint.

### Unified File verification checkpoint

- Backend `tsc --noEmit`: PASS.
- Agent Runner `tsc --noEmit`: PASS.
- Frontend `vue-tsc --noEmit`: PASS.
- Backend / Agent Runner / Frontend production builds: PASS.
- `pnpm format:check`: PASS.
- deterministic Agent scenarios: **72/72 PASS**, including `migration/capability-grants-v2`, `file/unified-targets`, Subagent governed mutation, restart/recovery, completion gate, MCP/ACP, Browser, AppIntent, and public HTTP error taxonomy.
- canonical File stale-target regressions: PASS for Workspace generation changes, SSH configuration changes before mutation execution, and SSH configuration changes before read execution; execution stays pinned to the inspected fingerprint and fails closed.
- request-only Agent E2E directly affected by this change: **2/2 PASS** (`Agent Host installs Nexus Agent safely...` and `remote signed Nexus Agent plugin installs...`), including migrations 35–38, typed grant API, real Agent Run, and SSH `file_read`.
- broader UI Agent E2E was attempted; Chromium cannot launch in the current container because `libglib-2.0.so.0` is absent. All 11 affected UI failures report that missing shared library before application assertions; this is an environment blocker, not a product assertion failure.
- runtime/doc legacy scan: superseded File Tool/capability/scope names are zero outside one-time migration SQL and the dedicated migration fixture. Provider `live_capabilities_json` is unrelated telemetry and intentionally remains.
- `git diff --check`: PASS at the final Unified File checkpoint.

Current validation note: local commands run under Node `22.17.0` and emit the repository's existing `node >=24` engine warning; the validated commands above still exit successfully.

## New Session Resume Rule

At the start of a new session:

1. Open this file first and treat it as the current implementation handoff.
2. Verify `git branch --show-current`, `git rev-parse HEAD`, and `git status --short` before editing.
3. Preserve any existing local changes; do not reset, clean, or overwrite unrelated work.
4. Re-scan the current code before implementing a step because the repository may have advanced since this plan was written.
5. Continue from the first incomplete implementation section below; do not recreate the legacy Workspace/Machine split.

## Completion / Cleanup Rule

When all implementation and verification requirements above pass:

1. Review the final code and confirm the old duplicated architecture is gone.
2. Confirm no compatibility layer or deprecated aliases remain.
3. Run the required final builds, deterministic scenarios, E2E checks where available, and legacy-symbol scans.
4. Commit the completed destructive refactor.
5. Delete the entire `doc/PROGRESS.md` file from the repository.
6. Verify `doc/PROGRESS.md` no longer exists and the working tree contains only intended final changes.
