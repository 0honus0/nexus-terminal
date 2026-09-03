# Nexus Agent Runtime Foundation Refactor — Temporary Handoff

> **TEMPORARY DOCUMENT**
>
> This file exists only for the SSH/SFTP/WebSocket/execution foundation refactor that prepares Nexus for AI Agent support.
> **Delete this file when the refactor is fully completed, reviewed, and the final remote E2E Actions run is green.**
>
> Active branch: `test/agent-runtime-foundation`
>
> Base commit when branch was created: `4c9ca8de`
>
> Primary remote E2E workflow: `.github/workflows/e2e.yml`
>
> Baseline workflow run before refactor: `33708567029` — **SUCCESS**
>
> Baseline scope included Docker deployment smoke plus all 8 Playwright E2E groups.

---

## 1. Product Goal

Nexus is being prepared to support a local/remote operations AI Agent capable of tasks such as:

- one-click service deployment;
- server/local-machine diagnostics;
- filesystem inspection and modification;
- Docker operations;
- long-running command execution;
- task/checkpoint recovery;
- future MCP/Skill integration.

The current phase is **foundation-only**. Do not introduce LLM/provider/Agent UI business logic until the execution foundation is clean and stable.

The future AI entry point should behave similarly to the Windows Copilot-style floating experience:

- global floating AI button;
- clicking opens a floating interactive window above the existing UI;
- window can expand into a large interaction surface;
- AI UI is **not** a fixed Workspace pane;
- underlying Agent execution is independent of the browser/workspace session.

---

## 2. Non-Negotiable Refactor Rules

The user explicitly requested the following rules:

1. **No backward compatibility for internal code/interfaces.**
   - Do not keep old fields or APIs merely to ease migration.
   - Do not create adapter layers whose only purpose is preserving obsolete internal contracts.

2. **Functional parity matters, old implementation shape does not.**
   - Existing user-visible SSH, terminal, SFTP, file manager, upload/download, status monitor, Docker, suspend/resume behavior must still work after refactor.

3. **If a module is coupled to the old architecture, refactor the dependent module too.**
   - Do not stop halfway because the blast radius is large.

4. **Agent and user functionality should share reusable primitives, not live sessions.**
   - Same abstractions/services.
   - Separate runtime sessions/transports/channels.

5. **Tests first around foundation behavior.**
   - Add/strengthen E2E for lifecycle, SFTP multi-channel behavior, isolation, and regressions.
   - Final verification must use remote GitHub Actions E2E.

6. **All work stays on the test branch.**
   - Branch: `test/agent-runtime-foundation`.
   - Do not work directly on `main`.

---

## 3. Target Architecture

The desired ownership model is:

```text
Connection configuration / credentials
              │
              ▼
       SSH Connection Factory
              │
              ▼
       ExecutionSessionManager
              │
      ┌───────┴────────┐
      │                │
 Workspace Session   Agent Session
      │                │
      ▼                ▼
 ExecutionSession   ExecutionSession
      │                │
      ├─ SSH client     ├─ SSH client
      ├─ exec channels  ├─ exec channels
      └─ SFTP manager   └─ SFTP manager
           │                 │
     ┌─────┼─────┐      ┌────┼─────┐
     ▼     ▼     ▼      ▼    ▼     ▼
 control transfer background ...
```

Key rule:

```text
Agent and user may reuse:
- connection metadata
- credential resolution
- SSH connection factory
- command executor
- filesystem abstraction
- Docker/system services

Agent and user must NOT share:
- Client instance
- shell channel
- SFTPWrapper
- cwd/env/process state
- command session state
```

Browser/WebSocket disconnection must only destroy the Workspace execution session. Future Agent runs must survive browser/workspace closure because they own a separate ExecutionSession.

---

## 4. Core Runtime Concepts

### ExecutionSession

A live runtime ownership boundary around one SSH client.

Current implementation added:

- `packages/backend/src/execution/execution-session.ts`
- `packages/backend/src/execution/execution-session-manager.ts`

Current intended owner types:

```ts
'workspace' | 'agent' | 'system'
```

ExecutionSession currently owns:

- `Client`
- `SftpChannelManager`
- owner metadata
- lifecycle (`ready`, `detached`, `closed`)

Important distinction:

```text
Conversation != Agent Run != ExecutionSession != persistent Task
```

Only the live SSH transport belongs in ExecutionSession. Future Agent task/checkpoint persistence must not try to persist live SSH connections.

### SFTP channels

Current implementation added:

- `packages/backend/src/transport/sftp-channel-manager.ts`

Roles:

```ts
'control' | 'transfer' | 'background'
```

Intended use:

- `control`: latency-sensitive directory/stat/read/write metadata operations;
- `transfer`: bulk uploads/download/large transfer workloads;
- `background`: Agent search/scanning/background filesystem work.

Do **not** regress to fields such as:

```text
sftp
uploadSftp
downloadSftp
searchSftp
agentSftp
...
```

The manager abstraction exists specifically to prevent that field explosion.

### SSH command execution

Current implementation added:

- `packages/backend/src/execution/ssh-command-executor.ts`

This is the shared bounded non-interactive command primitive for:

- status monitor;
- terminal helper commands;
- Docker service/handler migration;
- archive preflight/helper commands where appropriate;
- future Agent `exec_command` tool.

It supports:

- timeout;
- bounded stdout/stderr;
- structured result;
- non-zero exit handling;
- no use of the interactive shell channel.

Future work should extend this into command session support for long-running jobs instead of introducing more direct `client.exec()` implementations.

---

## 5. Existing Code Problems Identified Before Refactor

### `ClientState` had too many responsibilities

Before refactor it directly contained combinations of:

- WebSocket;
- SSH client;
- shell stream;
- ordinary SFTP;
- upload-only SFTP;
- upload initialization promise;
- terminal state;
- status polling;
- suspend state;
- connection metadata.

This architecture tightly coupled browser session lifetime to execution resources.

### `SftpService` is very large

`packages/backend/src/sftp/sftp.service.ts` is approximately 3.8k–3.9k lines and currently mixes:

- SFTP lifecycle;
- file CRUD;
- recursive search;
- upload/download;
- cross-session copy;
- archive/compress/decompress;
- progress events;
- WebSocket response formatting;
- direct SSH exec;
- cleanup.

Long-term target is to split it into reusable filesystem/services, for example:

```text
filesystem/
├── filesystem.ts
├── sftp-filesystem.ts
├── file-reader.service.ts
├── file-writer.service.ts
├── directory.service.ts
├── file-search.service.ts
├── transfer.service.ts
├── archive.service.ts
└── types.ts
```

The reusable filesystem layer must not know about WebSocket or Vue.

### Direct SSH exec is duplicated

Direct command execution existed in several locations, including:

- `websocket/handlers/ssh.handler.ts`
- `services/status-monitor.service.ts`
- `websocket/handlers/docker.handler.ts`
- `sftp/sftp.controller.ts`
- `sftp/sftp.service.ts`
- `transfers/transfers.service.ts`

Database `.exec()` calls are unrelated and must not be changed just because they match the string `.exec(`.

---

## 6. Work Completed So Far

### Branch and remote baseline

Created and pushed:

```text
test/agent-runtime-foundation
```

Remote GitHub Actions baseline run:

```text
33708567029
```

Result:

```text
SUCCESS
```

Verified baseline included:

- E2E environment job;
- Docker deployment smoke;
- Playwright groups 1–8.

### New shared SSH command executor

Added:

```text
packages/backend/src/execution/ssh-command-executor.ts
```

Migrated at least these consumers to it:

- terminal helper commands used for remote cwd resolution in `ssh.handler.ts`;
- `StatusMonitorService` combined status command.

Backend build passes after these changes.

### Execution session abstraction

Added:

```text
packages/backend/src/execution/execution-session.ts
packages/backend/src/execution/execution-session-manager.ts
```

New normal SSH connections created in `ssh.handler.ts` now create a Workspace `ExecutionSession`.

Suspend/resume creation path in `websocket/connection.ts` has begun migration so resumed Workspace sessions also receive an ExecutionSession.

`cleanupClientConnection()` has begun migration to use ExecutionSession detach/delete semantics instead of manually nulling the SSH client.

### SFTP channel manager

Added:

```text
packages/backend/src/transport/sftp-channel-manager.ts
```

The old explicit normal/upload SFTP fields were removed from `ClientState`.

`SftpService` now uses the ExecutionSession-owned SFTP manager.

Current upload SFTP initialization method was renamed conceptually from upload-specific to transfer-specific:

```text
ensureTransferSftpSession()
```

### E2E fake SSH server observability

`test/e2e/support/test-ssh-server.mjs` was extended to track:

- active SFTP subsystem channels;
- cumulative opened SFTP channels.

Added control endpoint:

```text
GET /sftp/status
```

Intended response shape:

```json
{
  "activeChannels": 2,
  "openedChannels": 2
}
```

This is intended for upcoming multi-channel/lifecycle E2E assertions.

### Build status

Current backend build command:

```bash
npm run build:backend
```

Current result after latest edits:

```text
PASS
```

Local environment warning exists because local Node is v22 while backend declares Node >=24. The TypeScript build still completed successfully. Remote Actions uses the configured test Node runtime and is authoritative for final E2E.

---

## 7. Files Currently Modified / Added

At minimum, inspect these before continuing:

```text
packages/backend/src/execution/execution-session.ts
packages/backend/src/execution/execution-session-manager.ts
packages/backend/src/execution/ssh-command-executor.ts
packages/backend/src/transport/sftp-channel-manager.ts
packages/backend/src/websocket/types.ts
packages/backend/src/websocket/handlers/ssh.handler.ts
packages/backend/src/websocket/connection.ts
packages/backend/src/websocket/utils.ts
packages/backend/src/services/status-monitor.service.ts
packages/backend/src/sftp/sftp.service.ts
packages/backend/src/sftp/sftp.controller.ts
test/e2e/support/test-ssh-server.mjs
```

Always begin a new continuation session with:

```bash
git status --short
git diff --stat
git diff -- packages/backend/src/execution packages/backend/src/transport packages/backend/src/websocket/types.ts
npm run build:backend
```

Do not assume the working tree is clean.

---

## 8. Immediate Next Work — Highest Priority

### A. Finish ExecutionSession migration cleanly

Goal: no feature code should treat WebSocket `ClientState` as the owner of the SSH transport.

Tasks:

1. Audit all references to:

```text
executionSession.client
```

2. Prefer:

```ts
state.executionSession.isReady
```

for readiness checks rather than accessing the `client` getter just to test existence.

3. Ensure all live Workspace session creation paths construct/register an `ExecutionSession`.

4. Ensure all Workspace cleanup paths call:

```ts
executionSessionManager.delete(sessionId, true)
```

unless ownership is intentionally transferred to suspend service.

5. Suspend handoff must use:

```ts
executionSessionManager.detach(sessionId)
```

before passing the SSH client to `SshSuspendService`.

6. Confirm failed suspend takeover closes the detached client and shell channel.

7. Confirm resume rollback does not double-close or orphan a transport.

8. Confirm no ExecutionSession registry leaks after Workspace close.

Potential future improvement: move shell stream ownership into a Workspace-specific object rather than keeping it on `ClientState`, but do not block core Session ownership cleanup if this is better staged.

### B. Finish SFTP role migration

Tasks:

1. Audit all SFTP operations in `SftpService` and `sftp.controller.ts`.

2. Use `control` for metadata/navigation operations.

3. Use `transfer` for bulk upload/download/large copy where safe.

4. Use `background` for recursive search/background scanning so search cannot block FileManager control operations.

5. Never create ad-hoc SFTP channels directly outside `SftpChannelManager` unless a clearly documented exception exists.

6. Cleanup must close all channels owned by that ExecutionSession.

7. Avoid optional chaining where a previous guard proves a channel exists; prefer stable local references for TypeScript clarity and race reasoning.

### C. Add SFTP multi-channel E2E immediately

Use the fake SSH server endpoint:

```text
GET http://127.0.0.1:22223/sftp/status
```

Required tests:

#### Test 1 — control + transfer channels are distinct

Flow:

1. login;
2. connect test SSH;
3. open FileManager to force control SFTP;
4. query `/sftp/status` and confirm at least one active channel;
5. start a real upload;
6. while upload is active, query `/sftp/status`;
7. assert at least 2 active/opened channels;
8. finish upload;
9. close Workspace/session;
10. assert active SFTP channels eventually return to 0.

#### Test 2 — slow transfer does not head-of-line block control operations

Use existing:

```text
POST /sftp/write-delay?ms=<delay>
```

Flow:

1. set write delay;
2. start large upload;
3. while upload is still in progress, perform a FileManager directory navigation/list/stat operation;
4. assert the control operation completes promptly rather than waiting for delayed upload WRITE acknowledgements;
5. ensure upload still completes byte-correctly.

This is one of the most important acceptance tests for this refactor.

#### Test 3 — recursive/background work does not block control channel

After recursive search migrates to `background` role:

1. start recursive search over a fixture tree;
2. while search is running, perform ordinary directory list/navigation;
3. verify control interaction remains responsive.

### D. Finish command execution consolidation

Search command:

```bash
rg -n "\.exec\(" packages/backend/src
```

Relevant SSH direct exec remains in at least:

```text
packages/backend/src/websocket/handlers/docker.handler.ts
packages/backend/src/sftp/sftp.controller.ts
packages/backend/src/sftp/sftp.service.ts
packages/backend/src/transfers/transfers.service.ts
```

Do not touch SQLite `db.exec()` calls.

Refactor direction:

- simple bounded commands -> shared `executeSshCommand()`;
- long-running/archive/streaming commands -> introduce a proper command-session/streaming execution abstraction rather than forcing them into a buffered helper;
- Docker should ideally move out of WebSocket-specific implementation and into a reusable remote Docker service callable by UI and future Agent tools.

### E. Introduce long-running command session abstraction

Target structure:

```text
packages/backend/src/execution/
├── command-executor.ts
├── ssh-command-executor.ts
├── command-session.ts
├── command-session-manager.ts
└── types.ts
```

Desired conceptual operations:

```text
start
observe
write
kill
close
```

This is needed later for:

- npm install;
- apt install;
- docker build;
- docker compose pull/up;
- logs/watch commands;
- interactive prompts when explicitly allowed.

Do not let future Agent code implement its own process tracking.

---

## 9. Filesystem Refactor Plan

After ExecutionSession + SFTP roles stabilize, split `SftpService` instead of continuing to grow it.

Suggested reusable contract:

```ts
interface FileSystem {
  stat(path: string): Promise<FileStat>;
  list(path: string): Promise<FileEntry[]>;
  read(path: string, options?: ReadOptions): Promise<FileContent>;
  write(path: string, data: Buffer, options?: WriteOptions): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}
```

Expected layering:

```text
WebSocket handler
      │
      ▼
Filesystem/Transfer/Archive service
      │
      ▼
SftpFileSystem adapter
      │
      ▼
ExecutionSession.sftp
```

Future Agent file tools must call the same filesystem services, not the WebSocket handlers.

Important architecture rule:

```text
Core filesystem service must not call state.ws.send().
```

Handlers/events should format transport responses outside the filesystem domain layer.

---

## 10. WebSocket Refactor Plan

Current `packages/backend/src/websocket/connection.ts` is a large switch/router and should eventually be split.

Target shape:

```text
websocket/
├── server.ts
├── protocol.ts
├── router.ts
└── handlers/
```

Desired protocol direction (old protocol compatibility is not required internally):

Request:

```json
{
  "type": "filesystem.list",
  "requestId": "...",
  "payload": {}
}
```

Response:

```json
{
  "type": "response",
  "requestId": "...",
  "ok": true,
  "data": {}
}
```

Error:

```json
{
  "type": "response",
  "requestId": "...",
  "ok": false,
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

Events:

```json
{
  "type": "event",
  "event": "transfer.progress",
  "payload": {}
}
```

Do not mix Agent realtime traffic into the terminal WebSocket. Future AI realtime transport should be separate (`/ws/ai` or equivalent).

---

## 11. Docker Refactor Plan

`websocket/handlers/docker.handler.ts` currently duplicates remote Docker CLI execution logic.

Target:

```text
DockerManager UI ─┐
                  ├──> reusable RemoteDockerService
Agent DockerTool ─┘
```

Remote Docker service should expose structured operations such as:

```text
availability/version
list
inspect
stats
logs
start
stop
restart
remove
pull
compose (later)
```

Use shared command execution primitives.

WebSocket handler should only validate/dispatch/serialize.

---

## 12. Status Monitor Requirement

StatusMonitor was migrated to the shared SSH executor.

Regression requirements:

- monitor must never use interactive shell;
- terminal may be running `vim`, `top`, etc. while monitor continues independently;
- monitor command output must not appear in the terminal;
- polling cleanup follows Workspace session lifecycle;
- future Agent session creation must not accidentally subscribe to Workspace status polling.

---

## 13. Suspend / Resume Requirement

This is a high-risk regression area because it transfers SSH ownership.

Required invariant:

```text
normal workspace:
ExecutionSessionManager owns SSH client

marked suspend + browser closes:
ExecutionSessionManager.detach()
→ SshSuspendService owns SSH client + shell

resume:
SshSuspendService transfers SSH client + shell
→ new Workspace ExecutionSession owns SSH client

normal resumed workspace close:
new ExecutionSession closes normally
```

Required E2E/regression coverage:

- mark for suspend;
- disconnect browser/workspace;
- suspended session remains alive;
- resume;
- terminal output/history restoration still works;
- terminate suspended session;
- failed resume/rollback does not leak SSH clients.

---

## 14. E2E Strategy

Existing E2E infrastructure is strong and should be extended rather than replaced.

Important assets:

```text
test/e2e/support/test-ssh-server.mjs
test/e2e/support/ssh.ts
.github/workflows/e2e.yml
```

Fake SSH server already supports:

- shell;
- exec;
- SFTP;
- write delay;
- archive delay/hold;
- command recording;
- active SSH client status;
- newly added SFTP channel status.

### Required foundation E2E additions

#### Session isolation

At least:

- two Workspace SSH sessions do not share transports;
- closing one does not terminate the other;
- future Agent execution session test should prove closing Workspace does not kill Agent transport.

#### SFTP lifecycle

- control channel opens lazily;
- transfer channel opens independently;
- all channels close when owning ExecutionSession closes;
- no leaked SFTP channels after cleanup;
- no leaked active SSH clients after session cleanup.

#### Head-of-line blocking

Use real delayed SFTP writes and prove directory control operations remain responsive.

#### Existing file operations regression

Keep coverage for:

- list/navigation;
- recursive search;
- read/edit/save;
- mkdir/rename/chmod/delete;
- upload;
- download;
- cross-session copy/move;
- compress/decompress/cancel;
- preview/download ticket paths.

#### SSH terminal regression

Keep coverage for:

- connect;
- input/output;
- resize;
- cwd sync/change directory;
- disconnect;
- suspend/resume.

#### Docker regression

Keep user-visible behavior stable while implementation moves behind reusable service.

---

## 15. Remote GitHub Actions Procedure

All authoritative E2E should run remotely on the test branch.

Current branch:

```bash
git branch --show-current
# test/agent-runtime-foundation
```

Before triggering Actions:

```bash
npm run build:backend
npm run build:frontend
```

Then commit and push to:

```text
origin/test/agent-runtime-foundation
```

Manual workflow dispatch:

```bash
gh workflow run e2e.yml --ref test/agent-runtime-foundation
```

Find latest run:

```bash
gh run list \
  --workflow e2e.yml \
  --branch test/agent-runtime-foundation \
  --limit 5 \
  --json databaseId,status,conclusion,headBranch,event,createdAt,url
```

Inspect run:

```bash
gh run view <RUN_ID> --json status,conclusion,jobs,url
```

If failures occur, inspect failed logs:

```bash
gh run view <RUN_ID> --log-failed
```

Do not claim final success until the latest run containing the refactor commit is green.

---

## 16. Current Milestones

### M1 — Execution foundation

Status: **IN PROGRESS**

Scope:

```text
ExecutionSession
SSH ownership
SFTP multi-channel
Filesystem decomposition
shared command executor
long command sessions
WebSocket routing/protocol cleanup
foundation E2E
```

### M2 — AI foundation

Status: **NOT STARTED**

Only begin after M1 is stable.

Planned scope:

```text
AI Providers
Models
API key encryption
AI settings page
Conversation
Run
Agent Runtime
Tool Registry
Approval/Policy
```

### M3 — Operations Agent

Status: **NOT STARTED**

Planned scope:

```text
Task/checkpoint
Memory/summary
Skills
Deployment flows
Diagnostics flows
MCP
```

---

## 17. Future AI Settings/UI Requirements

Do not implement yet unless M1 is complete, but preserve these requirements.

Settings should add a dedicated **AI** section supporting at least:

```text
Providers
Models
Agent
Tools
MCP
Memory
Permissions
```

Provider support direction:

```text
OpenAI
Anthropic
Gemini
OpenAI-compatible
Ollama
custom provider
```

API keys must be encrypted at rest and never returned in plaintext to frontend.

AI visual entry point requirement:

```text
Global floating AI button
      ↓
small floating window
      ↓
expand
      ↓
large floating interactive AI workspace
```

Do not make Agent UI dependent on an active terminal pane or terminal WebSocket.

---

## 18. Completion Criteria for This Refactor

The foundation refactor is complete only when all conditions below are true:

1. Existing SSH/SFTP/upload/download/FileManager/status monitor/suspend/Docker user behavior is functionally intact.
2. Workspace SSH transport ownership is represented by ExecutionSession, not raw fields on WebSocket state.
3. Future Agent sessions can use the exact same execution/filesystem abstractions while owning independent runtime sessions.
4. SFTP control and bulk-transfer channels are independent.
5. Slow uploads do not head-of-line block control FileManager operations.
6. Recursive/background SFTP work does not block control channel operations.
7. Direct SSH exec duplication has been consolidated or intentionally isolated behind streaming command-session abstractions.
8. Session cleanup has no SSH/SFTP resource leaks in E2E.
9. Suspend/resume ownership transfer remains correct.
10. Backend build passes.
11. Frontend build passes.
12. New foundation E2E passes.
13. Existing full remote GitHub Actions E2E passes on `test/agent-runtime-foundation`.
14. Architecture review finds no temporary compatibility shims preserving obsolete internal APIs.
15. **This temporary `AGENT_RUNTIME_REFACTOR.md` file is deleted in the final cleanup commit.**

---

## 19. Recommended Next Session Startup Checklist

A different ChatGPT/Agent session can resume work with this exact order:

```bash
cd nexus-terminal

git branch --show-current
git status --short
git diff --stat

npm run build:backend

rg -n "executionSession|sshClient|sftpChannels|uploadSftp|\.exec\(" packages/backend/src

sed -n '1,260p' packages/backend/src/execution/execution-session.ts
sed -n '1,260p' packages/backend/src/execution/execution-session-manager.ts
sed -n '1,260p' packages/backend/src/transport/sftp-channel-manager.ts
sed -n '1,260p' packages/backend/src/execution/ssh-command-executor.ts
```

Then continue in this priority order (updated after the SFTP physical split):

```text
1. Verify the current SFTP physical split with remote Actions.
2. Fix only real product regressions; do not restore deleted SftpService compatibility APIs.
3. Audit remaining direct ssh2 Client.exec calls and route simple commands through SshCommandExecutor.
4. Route streaming/long-running commands through ExecutionSession.commands / CommandSessionManager.
5. Finish ExecutionSession lifecycle migration for any remaining raw SSH ownership fields.
6. Add explicit ExecutionSession/Agent-session isolation E2E beyond Workspace SFTP channel tests.
7. Refactor WebSocket state/router so protocol transport does not own domain services.
8. Keep backend/frontend builds green after every slice.
9. Push each meaningful slice to test/agent-runtime-foundation and require remote Actions green.
10. Delete this document only after the full foundation completion criteria pass.
```

---

## 20. Temporary Notes / Progress Log

### 2026-09-03

- Created branch `test/agent-runtime-foundation` from `main` at `4c9ca8de`.
- Pushed branch to origin.
- Ran remote E2E baseline via workflow dispatch.
- Baseline run `33708567029` completed successfully.
- Added shared bounded SSH executor.
- Migrated StatusMonitor and SSH cwd helper execution to shared executor.
- Added `ExecutionSession` and `ExecutionSessionManager`.
- Began Workspace connection + resume path migration to ExecutionSession ownership.
- Began cleanup/suspend ownership migration to manager `detach/delete` semantics.
- Added `SftpChannelManager` with control/transfer/background roles.
- Removed old ordinary/upload SFTP fields from `ClientState`.
- Migrated SFTP state references toward ExecutionSession-owned channel manager.
- Added fake SSH server SFTP channel counters + `/sftp/status` endpoint.
- Added first multi-channel E2E covering control + transfer channel separation, control navigation during delayed transfer, and channel cleanup after leaving Workspace.
- Backend build currently passes.
- Frontend build currently passes.
- First foundation slice was committed and pushed as commit `2ff6392f` after rebasing the workflow-generated E2E environment update from the remote test branch.
- Remote Actions run `33709300680` was automatically triggered for `2ff6392f`; it is still in progress at the time of this note.
- Additional local work after `2ff6392f` (currently uncommitted): recursive SFTP search now acquires the `background` role; the multi-channel E2E now expects all three control/transfer/background channels; Docker handler command execution is being consolidated onto the shared bounded SSH executor. Backend build passes after these local changes.
- Remote Actions run `33709300680` for `2ff6392f` completed **SUCCESS**: Docker smoke and all 8 Playwright groups passed.
- Physical module decomposition has started. Added `filesystem/types.ts`, `filesystem/sftp-file-system.ts`, and `filesystem/file-removal.service.ts`. Core FileManager operations (`list/search/stat/read/write/mkdir/unlink/rename/chmod/realpath/rmdir/delete_paths`) now go through reusable filesystem services that depend only on `ExecutionSession`, not WebSocket/ClientState.
- The corresponding old methods were deleted from `SftpService`; it dropped from ~3723 lines to ~2617 lines. Do not re-add wrapper methods to `SftpService`.
- Added `CommandSession` + `CommandSessionManager` under `execution/`; `ExecutionSession` now owns long-running command sessions and closes them with the parent session. Archive execution is being migrated onto this primitive.
- Backend and frontend builds passed after the core filesystem extraction; backend passed again after removal-service extraction.
- Next concrete task: commit/push this physical-decomposition slice, trigger remote Actions, then continue splitting the remaining `SftpService` into dedicated transfer/archive/upload services while Actions runs.

- Remote Actions run `33710363320` for commit `d580ca9d` completed **FAILURE**, but the failure was isolated to the newly added multi-channel E2E selector: `page.getByTitle('Search files...')` matched both the active modal FileManager and another FileManager instance. Docker smoke, Playwright groups 1-6 and 8, and every other test in group 7 passed. This was a test locator defect, not an observed product regression.
- Fixed the multi-channel E2E to scope the search button/input to `data-testid="file-manager-modal"`.
- Completed the physical SFTP split. **Deleted `packages/backend/src/sftp/sftp.service.ts` entirely. Do not recreate it.**
- Deleted the temporary `filesystem/sftp-helpers.ts`; the intermediate helper bucket is no longer part of the architecture.
- Added `filesystem/sftp-channel-file-system.ts` as the concrete primitive adapter around one `SFTPWrapper`. It owns stat/list/rename/mkdir/unlink/chmod/realpath/ensure-directory primitives and normalized stat-to-domain conversion.
- `filesystem/sftp-file-system.ts` is now the ExecutionSession-aware filesystem facade. It chooses the `control` or `background` channel and is directly reusable by future Agent tools without WebSocket state.
- `filesystem/file-removal.service.ts` now reuses `SftpChannelFileSystem` plus the shared bounded SSH executor for force-delete fallback.
- Added `archive/archive.service.ts`; archive active/pending state, preflight, progress, cancellation, long-running command sessions, and workspace cleanup no longer live in the SFTP monolith.
- Added `transfers/sftp-transfer.service.ts`; Workspace copy/cross-copy/move state and progress are isolated from upload and filesystem CRUD.
- Added `uploads/sftp-upload.service.ts`; browser upload active/pending/cancel/prepared-batch state is isolated and uses only the transfer SFTP role.
- Added `sftp/workspace-sftp-session.service.ts`; this is now the thin Workspace-only control-channel ready/close layer. Agent sessions must not call this service; they use `ExecutionSession` + filesystem primitives directly.
- Migrated `websocket/state.ts`, `sftp.controller.ts`, `websocket.ts`, `websocket/connection.ts`, `ssh.handler.ts`, `sftp.handler.ts`, and cleanup flow to the new services. There are no runtime imports/references to the deleted `SftpService`.
- Cleanup order is now explicit: archive cleanup -> transfer cancellation state cleanup -> upload cleanup -> Workspace SFTP channel close -> remaining ExecutionSession/SSH cleanup.
- Backend build passes after deleting the monolith and helper file. Frontend build also passes.
- A local targeted Playwright run was attempted for cross-session transfer, FileManager context menu and uploads. The non-browser cross-session transfer passed; UI cases could not start because the local host lacks Playwright Chromium `chromium_headless_shell-1234`. Per project policy, do not mutate the local browser environment just to compensate; remote GitHub Actions is the authoritative E2E runtime.
- Next concrete task: commit/push the full SFTP physical split + selector fix, wait for remote Actions, and fix any real remote regressions before proceeding to remaining direct-exec/WebSocket refactors.

## 2026-09-03 execution-layer consolidation slice

- Remote Actions run `33711281059` for commit `0052fc29` completed **FAILURE** with two failures sharing one real regression: recursive search results preserved `path`/`relativePath` but `filename` was accidentally normalized to the basename (`nested.txt`) by the new generic SFTP formatter. This broke both `ssh/protocol.spec.ts` and the recursive-search display assertion in `ssh/file-manager-navigation.spec.ts`. Docker smoke, archive progress/cancel, upload/multi-channel, status/Docker protocol, SSH lifecycle, and the remaining groups passed.
- Fixed `SftpFileSystem.search()` to preserve the historical/user-visible search contract: `filename` is the root-relative path (for example `folder-seed/nested.txt`), `basename` remains the leaf name, and `path` remains absolute. Targeted real-SSH protocol E2E now passes locally.
- Removed the now-dead legacy WebSocket archive handler block from `sftp/sftp.controller.ts` after confirming `ArchiveService` owns those flows. The controller is now HTTP download/stream concerns only instead of retaining an unreachable second archive implementation.
- Consolidated every business-layer `ssh2 Client.exec` call. `rg '\.exec\(' packages/backend/src` now finds SSH exec only inside `execution/ssh-command-executor.ts` and `execution/command-session-manager.ts` (SQLite `.exec` is unrelated). Do not add raw SSH exec calls back to domain services.
- `TransfersService` command discovery and target `mkdir -p` now use the bounded `executeSshCommand`; target mkdir accepts an `AbortSignal`. rsync/scp streaming now uses `CommandSessionManager`, preserving PTY support, stdout progress parsing, stderr capture, user cancellation, timeout, and post-command SSH transport reuse.
- `executeSshCommand` now accepts `AbortSignal`, preserves `AbortError` semantics, settles cancellation/timeout before terminating the channel, and leaves the parent SSH client usable. A hash-before/after experiment confirmed `npm ci` does **not** rewrite this source file; the earlier apparent source reversion was caused by overlapping local edits, not the build pipeline.
- `CommandSessionManager.start()` now accepts ssh2 `ExecOptions` and an output bound. `CommandSession` retains bounded stdout/stderr snapshots so output emitted immediately after exec-channel creation is not lost before an observer attaches; it exposes `snapshot()` for future Agent long-task observation/checkpointing.
- Added `test/e2e/tests/ssh/execution-foundation.spec.ts`, which imports the real backend execution primitives and connects them directly to the existing real fake-SSH server (no production-only E2E API). It verifies: (1) a bounded command aborts with `AbortError` and a subsequent command succeeds on the same SSH client; (2) a command session retains early output, can be terminated, does not emit the post-sleep output, and the same SSH transport remains usable afterwards. Both tests pass locally.
- E2E grouping was regenerated from 63 to 64 specs; `groups.mjs check --workers 8` passes. Only group files whose assignment changed are modified.
- Current local validation for this slice: direct backend TypeScript build passes; frontend production build passed after the physical SFTP split; targeted recursive-search protocol E2E passes; both new execution-foundation E2E cases pass. Local browser UI tests remain intentionally delegated to remote Actions because the host lacks the pinned Playwright Chromium binary.
- Next concrete task: commit/push this execution/search-regression slice to `test/agent-runtime-foundation`, require the next remote Actions run to go green, then continue with remaining ExecutionSession ownership/WebSocket router decomposition. If remote Actions finds a real regression, fix that before expanding the refactor.


---

## 21. Backend-Wide Foundation Plan Before Agent Development

AI/LLM/Agent feature development is explicitly blocked until the backend foundation below is completed and remote E2E is green. The goal is not to refactor every large file in the repository; the goal is to clean every shared runtime boundary that Agent and Workspace/User execution will rely on.

### F1 — Workspace runtime ownership and composition root

Status: **IN PROGRESS**

Target:

```text
workspace/
  workspace-session.ts
  workspace-session-registry.ts
  workspace-status-monitor.service.ts

runtime/
  service-container.ts
```

Rules:

- `WorkspaceSession` owns browser/terminal/WebSocket-specific state only.
- `ExecutionSession` owns live SSH/SFTP/command resources.
- `WorkspaceSessionRegistry` replaces the old raw `Map<string, ClientState>`.
- `websocket/state.ts` is deleted; WebSocket transport does not own service singletons.
- reusable system status collection lives in `system/server-status.collector.ts`; Workspace polling is only an adapter.

Acceptance:

- no `ClientState` symbol remains;
- no domain service imports `websocket/state`;
- backend build + session/SFTP/suspend/status E2E pass.

### F2 — SSH connection foundation

Priority: **NEXT / HIGHEST**

Current blocker:

`packages/backend/src/services/ssh.service.ts` (~893 lines) mixes connection metadata resolution, credential decryption, direct SSH connection setup, SOCKS/HTTP proxying, jump chains, shell creation, saved connection tests and unsaved connection tests.

Target physical split:

```text
transport/ssh/
  ssh-connection.types.ts
  ssh-credential-resolver.ts
  ssh-connection-factory.ts
  ssh-direct-connector.ts
  ssh-proxy-connector.ts
  ssh-jump-connector.ts
  ssh-shell.service.ts
  ssh-connection-tester.ts
```

Required outcome:

- callers ask a connection factory for a connected SSH transport/client;
- credential/proxy/jump resolution is not duplicated by Transfers/System/Agent;
- `ExecutionSessionManager` becomes the normal owner/factory entrypoint for runtime execution sessions;
- business modules do not know how SOCKS, HTTP proxy or jump-chain connection establishment works;
- direct/proxy/jump/test behavior retains E2E coverage.

### F3 — Filesystem application boundary

Current core is already split into `SftpChannelFileSystem`, `SftpFileSystem`, `FileRemovalService`, and `SftpChannelManager`, but HTTP/Workspace edges still expose ssh2 types and duplicate low-level SFTP helpers.

Target:

```text
filesystem/
  remote-filesystem.ts          # transport-neutral interface/domain types
  sftp-channel-file-system.ts   # ssh2 adapter only
  sftp-file-system.ts           # ExecutionSession-aware facade
  file-removal.service.ts
  file-stream.service.ts        # HTTP download/read streaming primitives
  filesystem-target.service.ts  # resolve workspace/connection target where needed
```

Required outcome:

- `sftp/sftp.controller.ts` stops implementing stat/realpath/readdir primitives itself;
- `ssh2` `SFTPWrapper`/`Stats` do not leak into controllers/application code;
- Agent and Workspace can both call the same filesystem abstraction with different ExecutionSessions.

F3 status (2026-09-03): locally complete and ready for remote validation.

- Added transport-neutral `filesystem/remote-filesystem.ts` with metadata/directory/read-stream primitives.
- `SftpFileSystem` implements the RemoteFileSystem boundary while `SftpChannelFileSystem` remains the ssh2 adapter.
- Added `filesystem/directory-archive.service.ts`; HTTP ZIP streaming no longer recursively traverses raw SFTP handles.
- Added `workspace/workspace-filesystem.service.ts` to resolve Workspace ownership and expose canonical filesystem/removal services.
- `sftp/sftp.controller.ts` no longer imports `ssh2`, `SFTPWrapper`, `Stats`, Workspace registry/session types, or implements SFTP stat/realpath/readdir/read-stream helpers.
- Direct FileManager filesystem commands now obtain `SftpFileSystem`/`FileRemovalService` through `WorkspaceFilesystemService` instead of constructing them in the WebSocket handler.
- Added `test/e2e/tests/ssh/filesystem-foundation.spec.ts`, exercising download ticket, HTTP Range, inline streaming and directory ZIP over the real fake-SSH fixture without Chromium.
- Backend build passes. Focused filesystem + SSH protocol regression: **7 passed, 2 skipped, 0 failed**; skipped cases require host `zip` and remain covered by remote Actions.
- F2 remote Actions run `33713989053` for `4da44507` is **SUCCESS**.

### F4 — Operation services: archive, upload and transfers

Current issue:

- `archive/archive.service.ts` still sends WebSocket messages directly;
- `transfers/sftp-transfer.service.ts` still sends WebSocket messages directly and resolves Workspace identity internally;
- `uploads/sftp-upload.service.ts` mixes upload engine state with WebSocket notification framing;
- `transfers/transfers.service.ts` (~1.2k lines) mixes task registry/orchestration, credential/connect logic, rsync/scp strategy selection, progress and cancellation.

Target split:

```text
archive/
  archive-operation.service.ts      # ExecutionSession + events/results only
  workspace-archive.adapter.ts      # WS mapping only

transfers/
  transfer-task-registry.ts
  transfer-orchestrator.ts
  strategies/
    sftp-transfer.strategy.ts
    rsync-transfer.strategy.ts
    scp-transfer.strategy.ts
  workspace-sftp-transfer.adapter.ts

uploads/
  upload-session.service.ts         # browser upload state/engine
  workspace-upload.adapter.ts       # WS frames only
```

Rules:

- core operation services return results/events and never call `ws.send()`;
- Workspace adapters translate operation events into the existing protocol;
- future Agent tools consume the core operations directly without faking a Workspace session;
- transfer connection establishment uses F2's SSH connection factory.

### F5 — WebSocket transport/router decomposition

Current large files:

- `websocket/connection.ts` ~840 lines;
- `websocket/handlers/ssh.handler.ts` ~886 lines;
- `websocket/handlers/sftp.handler.ts` ~415 lines;
- `websocket/handlers/docker.handler.ts` ~396 lines.

Target:

```text
websocket/
  server.ts
  upgrade.ts
  router.ts
  protocol.ts
  connection-lifecycle.ts
  upload-transport.ts
  handlers/
    workspace-session.handler.ts
    terminal.handler.ts
    filesystem.handler.ts
    archive.handler.ts
    transfer.handler.ts
    docker.handler.ts
    suspend.handler.ts
```

Required outcome:

- handlers validate protocol, call application services, send responses/events;
- handlers do not implement SSH/SFTP/transfer/archive algorithms;
- connection lifecycle cleanup is centralized and idempotent;
- terminal shell integration/backpressure stays Workspace-only and does not contaminate ExecutionSession.

### F6 — Service composition / dependency ownership

Current repository still constructs multiple duplicate instances such as `new AuditLogService()`, `new NotificationService()` and local service instances in controllers/services.

Target:

- `runtime/service-container.ts` is the backend composition root for long-lived application services;
- controllers/handlers receive or import canonical application service instances rather than constructing duplicates;
- stateful services must have one explicit owner;
- stateless helpers may remain plain functions/classes;
- remove the generic `services/` dumping-ground as modules are moved to their domain (`transport`, `workspace`, `system`, `backup`, etc.).

Important: this is not a DI-framework project. Keep composition explicit and simple.

### F7 — Foundation E2E gate

After F1-F6 are complete, establish a green foundation baseline before the broader maintainability pass:

1. backend and frontend production builds pass;
2. direct/proxy/jump SSH behavior remains covered;
3. Workspace session lifecycle/suspend-resume is green;
4. execution-foundation E2E is green;
5. SFTP control/transfer/background isolation is green;
6. upload/download/cross-session transfer/archive/status/Docker E2E is green;
7. no raw business-layer `Client.exec()` returns;
8. no core operation service calls `WebSocket.send`;
9. no fake Workspace registry/session is created to reuse a core service;
10. remote GitHub Actions E2E is green.

F7 is a checkpoint, not permission to begin Agent work. Continue directly to F8.

### F8 — Backend maintainability / large-module decomposition

Per user direction, the previously non-blocking large controller/service cleanup is now part of the pre-Agent backend refactor. The goal is not line-count reduction by itself; each change must improve ownership, dependency direction, testability, error boundaries or reuse.

Current high-value targets include:

```text
auth/auth.controller.ts             ~1069
notifications/notification.service  ~751
connections/connection.service.ts   ~741
appearance/appearance.service.ts    ~729
settings/settings.controller.ts     ~681
settings/settings.service.ts        ~641
connections/connections.controller  ~589
```

Required F8 principles:

- controllers stay transport-focused: request validation/mapping, status codes and response serialization;
- authentication domain logic moves out of `auth.controller.ts` into explicit application/domain services;
- appearance/settings persistence, validation and runtime side effects are separated instead of living in monolithic service/controller pairs;
- notification orchestration, channel dispatch and persistence/configuration ownership are separated where currently mixed;
- connection CRUD/import-export/test/credential responsibilities remain separated after F2 rather than accumulating again in one service;
- application services use the canonical composition root instead of constructing stateful dependencies themselves;
- shared error/result semantics are introduced where repeated controller-local `try/catch + message.includes(...)` branching exists;
- no compatibility facade is retained solely to preserve an obsolete monolith when all callers can migrate cleanly;
- behavior must be protected by focused API/E2E tests before deleting old paths.

F8 is complete only when the reviewed large modules have explicit responsibilities and there are no obvious controller/service god objects that future Agent/API work would need to route through.

### F9 — Final pre-Agent regression gate

Because F8 changes broad backend structure after the F7 foundation checkpoint, run the complete gate again before Agent work:

1. backend/frontend production builds pass;
2. focused auth/settings/appearance/notification/connection tests pass;
3. all F7 architecture guards still hold;
4. full local/remote E2E coverage is green;
5. `git diff --check` and repository architecture scans are clean;
6. no new duplicate stateful service construction or transport-to-domain dependency inversion has been introduced.

Only after F1-F9 pass may M2 AI / Agent foundation work begin.


### 2026-09-03 backend-wide foundation review / F1 Workspace boundary

- Remote Actions run `33712260822` for commit `e2b79642` completed **SUCCESS**. Docker smoke and all 8 Playwright groups are green; this is the current remote baseline for subsequent foundation slices.
- Per user direction, AI/Agent feature work is now explicitly blocked until the backend pre-Agent F1-F9 plan is complete.
- Completed a backend-wide architecture scan. Pre-Agent refactors are now explicitly tracked in section 21: Workspace/runtime ownership, SSH connection factory, filesystem application boundary, operation-service WebSocket decoupling, WebSocket router decomposition, service composition, foundation E2E, broad backend maintainability cleanup, and the final regression gate.
- Moved interactive runtime state out of `websocket/types.ts`: the old `ClientState` symbol is gone. Added `workspace/workspace-session.ts` and `workspace/workspace-session-registry.ts`.
- Deleted `websocket/state.ts`. Long-lived application service construction moved to `runtime/service-container.ts`; WebSocket transport now consumes the composition root rather than owning the state/service container.
- All Workspace-facing services (SFTP session/upload/archive/transfer/status, SSH/Docker/SFTP handlers, HTTP SFTP target lookup and cleanup) now use `WorkspaceSessionRegistry` instead of a raw `Map<string, ClientState>`.
- Split status monitoring correctly instead of manufacturing a fake Workspace registry: reusable SSH sampling/parsing now lives in `system/server-status.collector.ts`; Workspace-specific polling/WebSocket delivery lives in `workspace/workspace-status-monitor.service.ts`. `system/ssh-resource-status.service.ts` consumes the reusable collector directly.
- Backend TypeScript build passes after F1 restructuring.
- Targeted non-browser real-SSH E2E after F1: `protocol.spec.ts`, `execution-foundation.spec.ts`, `status-docker-protocol.spec.ts`, and `suspend-resume.spec.ts` => **10 passed, 2 skipped, 0 failed**. The skipped archive cases depend on missing `zip` in the local host fixture; they are covered by remote Actions.
- Next: commit/push F1 and immediately start F2 physical split of `services/ssh.service.ts` while remote Actions validates F1.


### 2026-09-03 F2 SSH connection foundation

- F1 remote validation is green: Actions run `33713129527` for `0a236700` => SUCCESS.
- Physically deleted the old `packages/backend/src/services/ssh.service.ts` monolith (~894 lines); no facade or compatibility alias remains.
- Added `transport/ssh/` modules for resolved connection types, credential resolution, raw client connection, HTTP/SOCKS proxy routing, jump-chain routing, connection factory and connection testing.
- All old `SshService`, `DecryptedConnectionDetails`, `getConnectionDetails`, and `establishSshConnection` references are removed.
- `connections.controller`, Workspace SSH, remote system status collection and `TransfersService` now use the same resolver/factory foundation.
- `TransfersService` no longer constructs/configures raw ssh2 Clients; source/target/mkdir connections all use `sshConnectionFactory`, including AbortSignal support. Raw SSH connect ownership is confined to `transport/ssh`.
- `ExecutionSessionManager.connect()` now atomically creates the SSH transport and registers its `ExecutionSession`; Workspace SSH uses this path instead of connecting first and registering later.
- Transport networking no longer statically depends on DB repositories. `last_connected_at` is an upper-layer async factory hook; this allows pure ExecutionSession transport tests without pulling SQLite persistence into the primitive.
- Jump-chain intermediate SSH clients are explicitly tied to the final client lifecycle and released on final close.
- Extended fake SSH server with `forwardOut` support and an HTTP CONNECT proxy fixture.
- `execution-foundation.spec.ts` now verifies bounded exec, long command sessions, managed SSH+SFTP lifecycle, real HTTP CONNECT routing, and real jump-host routing/cleanup: **5 passed** locally.
- Workspace protocol/status/suspend targeted E2E after `ExecutionSessionManager.connect()` migration exits **0**; direct saved/unsaved SSH product paths remain functional. Local archive cases can skip when host `zip` is unavailable; remote Actions is the final gate.
- Known gap intentionally deferred to F4: legacy `TransfersService` rsync/scp strategy has no dedicated E2E today. Add strategy-level E2E while physically replacing that monolith rather than writing tests around code scheduled for immediate deletion.
- Next: F3 filesystem application boundary. Remove ssh2 `SFTPWrapper`/`Stats` and low-level stat/realpath/readdir/read-stream implementation from `sftp.controller.ts`; controllers should consume reusable filesystem services only.
