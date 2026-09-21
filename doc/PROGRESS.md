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

The remaining legacy split is **shell/execution**, not file I/O. Workspace argv/job execution and SSH shell execution remain separate until Unified Shell is implemented. Workspace lifecycle/runtime management also remains intentionally Workspace-specific.

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

Completion-gate evidence and recovery/checkpoint logic must use the new shared shell tool names.

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

### D. Target adapters should be capability-specific narrow ports

The new shared file semantics are correct, but `MachineCapabilityPort` is growing into a broad target/files/shell/docker port and `FileCapabilityService` still branches directly between `WorkspaceRuntimeService` and Machine implementations.

Step 5 should converge on narrow backend capability adapters, for example:

- `FileTargetAdapter`
- `ShellTargetAdapter`
- `TargetInspectionAdapter`
- `ContainerTargetAdapter`
- `EnvironmentTargetAdapter`

Workspace and SSH provide the adapters they support. Shared services own policy/precondition/verification semantics. Avoid one universal God `TargetAdapter`.

### E. Durable semantics must stop depending on shell/job tool names

Unified File removed the file-name coupling from project-instruction targeting and Workspace code-intelligence fallback metadata: those paths now consume canonical file operations. The remaining name-based durable behavior is in shell/execution evidence and background Workspace job recovery.

During Unified Shell, introduce typed execution/result semantics (for example execution evidence and durable job references) so completion/recovery consume semantic metadata rather than execution Tool-name string sets. This is required before the remaining legacy shell names can be deleted safely.

### F. Unified Shell must unify Host semantics, not transport syntax

Workspace currently executes explicit argv and supports durable Runner jobs; SSH currently executes shell text through the SSH transport. `shell_execute` should expose one Host execution capability with an explicit structured command variant and shared timeout/cwd/result semantics. Target adapters declare supported variants. If durable/background jobs remain, use a shared typed `JobRef` / `shell_job` control surface rather than Workspace-only job identity.

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
- [ ] **4. Unified Shell Capability** — next major implementation entry point after this File change is committed.
- [ ] **5. Target Adapters** — File currently shares semantics but still branches between broad WorkspaceRuntime/Machine ports; replace with narrow capability-specific adapters during the next structural pass.
- [x] **6. Authorization / Grants (File + foundation)** — schema v2 typed `CapabilityGrantScope`, `CapabilityRegistry`, scoped App grant API/persistence/authorization, one-time durable migrations, and scoped Subagent delegation are implemented. Shell-specific target scope will reuse this foundation.
- [x] **7. Frontend Permission Management (grant scope)** — permission UI consumes Host capability definitions and submits complete scoped grants. Least-authority Run target defaults/TaskRail target presentation remain later UI cleanup.
- [x] **8. Agent Context / Tool Projection (File)** — model/project-instruction/code-intel file projection uses canonical file operations; Subagent proposal/inspection projection enforces delegated target scope. Shell/job semantic projection remains Step 4 work.
- [x] **9. Remove Legacy File Code** — no runtime aliases/compatibility decoders or superseded shared file Tool/capability registration remain. Old strings exist only in destructive database migration SQL and migration fixtures that prove conversion.
- [ ] **10. Verification** — the **Unified File checkpoint is fully verified**; this overall item remains open because Unified Shell / target-adapter work has not yet been implemented and therefore still requires its own final regression pass.

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
