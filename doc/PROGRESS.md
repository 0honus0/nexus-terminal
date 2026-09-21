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

Example grant scope:

```json
{
  "capability": "file.read",
  "scope": {
    "targets": ["workspace", "ssh"]
  }
}
```

A more restrictive grant may limit target kinds and target IDs. Authorization must validate both the capability and the concrete `target + id`.

## Legacy Architecture To Remove

Delete, do not alias or preserve:

- `workspace_read_file`
- `workspace_apply_patch`
- `workspace_execute_argv`
- Workspace-only equivalents of shared file/shell operations
- `machine_read_file`
- `machine_write_file`
- `machine_execute_shell`
- Shared file/shell behavior embedded in Machine-specific tool factories

Delete old capability strings:

- `workspace.read`
- `workspace.write`
- `workspace.execute`
- `machine.files.read`
- `machine.files.write`
- `machine.shell.execute`

Rename/remove Machine taxonomy where it is only an SSH target abstraction. SSH-only diagnostics/container behavior should use the new capability taxonomy rather than inheriting file/shell authority from `machine.*`.

No compatibility migration layer is required. Existing persisted grants using removed capabilities may become invalid and should be handled as part of the destructive schema/update path rather than supported indefinitely.

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

## Implementation Status

- [x] **1. Inventory** — legacy shared Workspace/Machine file and shell tools, capability strings, grants, frontend metadata, context/Subagent policy, completion gates, recovery references, deterministic fixtures, and docs were enumerated on `dev` at baseline `6ca5aab`.
- [x] **2. Core Target Contract** — canonical `{ target: "workspace" | "ssh", id }` selector and `AgentTargetResolver` are wired into Workspace coding inspections; SSH fingerprints now use `ssh`; durable target decoding requires canonical target/id; Subagent Workspace mutation governance binds the selector; deterministic scenarios, Backend typecheck, and Backend build pass.
- [ ] **3. Unified File Capability** — **next implementation entry point**. Build the shared file capability/service over Workspace and SSH adapters, then remove the old shared file tools only after the new path is wired and tested.
- [ ] **4. Unified Shell Capability**
- [ ] **5. Target Adapters**
- [ ] **6. Authorization / Grants**
- [ ] **7. Frontend Permission Management**
- [ ] **8. Agent Context / Tool Projection**
- [ ] **9. Remove Legacy Code**
- [ ] **10. Verification**

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
