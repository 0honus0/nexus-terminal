# Nexus Agent 当前交接进度

> **用途：跨会话施工入口。** 后续会话开始工作前，先完整读取本文件与 `doc/PROBLEM.md`，再核对 branch / HEAD / `git status --short`。本文件只记录“下一会话真正需要知道的当前事实、施工规则、验证证据与继续位置”；历史完成细节以 Git commit 为准。
>
> 最近更新：2026-09-20。本轮用户已明确要求：**审核 `dev` 的累计未提交变更；已完成的历史 Problem 按“一个 Problem 一个 commit”拆分、验证、提交；审核中发现的同 Problem correctness / authority 缺口直接修复并纳入该 Problem commit。**

## 1. 仓库、分支与工作区保护

- Repo：`/home/agentdock/AgentDock/nexus-terminal-dev`
- Branch：`dev`
- 最新功能代码基线：`b6158835044dfa8abe04281258529f8628755cde`
- 最新功能 subject：`fix(agent): close P-121 public contract drift`
- P-121 提交后 `git status --short` 为 **26** 条，其中 2 条是本轮待做 docs-only closeout，剩余 **24** 条是已分类、必须保留的代码 residual。
- **这些 residual 必须全部保留。** 禁止为了“清理”执行 `reset`、`stash`、`clean`、`restore`、checkout overwrite 或其它可能丢失累计工作的命令。
- 当前 index 在 P-121 提交后为空；不要把 residual 整批 stage，也不要把旧 runner 工作副本当成当前 authoritative regression tree。
- 本轮功能 Problem 已全部闭环；`doc/PROBLEM.md` 与本文件只做独立 docs-only closeout，不改变代码树。

## 2. 当前工作目标：本轮 Problem 拆分已收口

`doc/PROBLEM.md` 当前 open Problem 为 **0**；最终 residual 审计新增的 P-121 也已 regression-first 闭环，下一新编号是 `P-122`。

本轮“审核累计 dirty tree、一个 Problem 一个 commit、每个 commit 用 isolated staged tree 验证”的目标已经完成。后续不要因为仍有 residual 就自动创建 P-122；只有出现新的当前代码证据、明确 owner 与可验证完成条件时才建新 Problem。

### 已完成的本轮拆分 commit

从原始基线 `7f88592` 之后，本轮已确认并提交：

- `d89850c` — P-062 type boundaries
- `3b81d01` — P-060 structured logging
- `f0e589c` — P-113 Artifact delete UI
- `a37e98d` — P-095 machine route freshness
- `3acad00` — P-099 workspace checkpoint restore
- `c75f4e9` — P-083 browser screenshot vision
- `5f6a47c` — P-084 browser interactions
- `f81efef` — P-107 browser target freshness
- `c9a90f1` — P-056 suspended session ownership
- `90bc88a` — P-085 restart recovery
- `51c91dd` — P-104 mailbox TTL lifecycle
- `02f64d1` — P-068 Subagent profile strategy
- `75d7857` — P-088 governed Subagent mutation
- `a7d6d0f` — P-078 MCP protocol extensions
- `0cacd85` — P-080 Plugin/App Tool boundary contract
- `c3b201f` — P-109 MCP health / retry / management
- `bd6c714` — P-108 ACP inner permission durable approval
- `d5a6c71` — P-115 Plugin AppIntent SDK / bounded host bridge
- `936d945` — P-114 Memory review/publish/import/notification product closure
- `ea4c03d` — P-059 owner decomposition / codec extraction
- `b615883` — P-121 public contract drift

### 下一步从哪里继续

**当前没有待施工 Problem。**

本轮最终收口事实：

- P-059 已以 `ea4c03d` 独立提交，owner decomposition 不复制 durable authority；isolated deterministic **67/67 PASS**。
- residual 审计随后发现 P-121：P-078/P-109 已提交能力与 public description/type facade 存在 drift；旧 HEAD 在新增 regression 下真实 RED，修复后以 `b615883` 提交，isolated deterministic **68/68 PASS**。
- docs-only closeout 完成后预计只保留 **24 个代码 residual**：19 个格式/展示排版、3 个 JSON deep-equal 的 i18n key-order、1 个无 caller 的 Subagent context `maxBytes` 草稿、1 个混有旧 fixture 且缺当前 P-121 regression 的 runner 工作副本。
- 这些 residual 已审计为“不应整批提交”，也不得擅自 restore/clean。后续若要处理，必须先产生新的可验证代码证据。

## 3. P-114 已完成事实与本轮深审修复

P-114 commit `936d945` 已独立提交，范围严格限制为 Memory review/publish/import/notification product closure：

- Frontend `MemorySettings` 复用既有 `MemoryService` / SQLite authority，publish/reject/revoke 全部携带 `expectedVersion`，冲突后刷新 authoritative state。
- Cross-App import 继续复用既有 preview-confirm flow；Backend preview/confirm 都只接受仍为 published 且未过期的 source Memory。
- Recall/index authority 未改变：只有 published + unexpired Memory 可进入 Recall；candidate/rejected/revoked/expired 均保持不可召回。
- Memory mutation 通过既有 durable Host outbox 发布 `memory.changed`；Frontend 只消费 Host event/cross-tab fan-out，不增加 correctness polling。
- candidate attention 复用既有 `AgentNotificationBridge` / `AGENT_ATTENTION_REQUIRED`，projection 不复制 Memory content。

本轮深审额外修复了三个 P-114 correctness gap：

1. **Frontend stale response overwrite**：Memory 主列表和跨 App source 列表都加入 request generation fencing，旧 App/status/source 请求完成后不能覆盖新的 authoritative selection。
2. **expired published source 仍出现在 import picker**：Frontend source picker 现在只展示当前 live published Memory；Backend preview/confirm 继续作为最终 authority。
3. **import confirmation 可并发重复消费**：repository 改为 transaction-scoped `takeImportConfirmation()`，通过 SQLite `BEGIN IMMEDIATE` 原子 read+delete；同一 confirmation 并发 confirm 最多一个成功，另一个 fail closed 为 `MEMORY_IMPORT_CONFIRMATION_NOT_FOUND`。

最终 isolated staged-tree 验证：

- staged files：**15**
- Backend `tsc --noEmit` / build：PASS
- Agent Runner `tsc --noEmit` / build：PASS
- Frontend `vue-tsc --noEmit` / Vite production build：PASS
- deterministic Agent scenarios：**66/66 PASS，0 FAIL**
- `runtime/memory-product-closure`：PASS
- `memory_import_one_shot_confirmations=1`、`memory_host_event_pollers=0`、`memory_notification_content_leaks=0`
- P-059 leakage markers：**0**
- `git diff --cached --check` 与 post-commit `git show --check`：PASS
- 新 `MemorySettings.vue` 已 Prettier clean；runner / compose / agent-events 的 remaining whole-file warnings 可在 HEAD `d5a6c71` 原文件复现，均位于 P-114 hunk 之外。
- 提交期间 branch 被并发推进到 `936d945`；该 commit tree 与最终已验证 temporary commit `b4ed2f2` 的 tree hash 完全相同，因此未重复提交或 amend。

## 4. P-115 已完成事实与本轮深审修复

P-115 commit `d5a6c71` 已独立提交，范围严格限制为 Plugin AppIntent SDK / bounded Host bridge：

- Frontend iframe SDK 与 Backend plugin worker SDK 都只代理现有 `AppIntentService`；intent declaration、sender/receiver active state、grant、TTL、revoke、schema 与 Artifact ownership/read authority 没有复制第二套 owner。
- Frontend iframe sandbox 继续使用既有 CSP `connect-src 'none'`；Plugin 不能通过 SDK 直接获得网络能力。
- Frontend AppIntent Artifact content 走 HostBridge binary RPC，单次 range 最大 128 KiB，使用 transferable `ArrayBuffer`；bytes 不进入 postMessage JSON/Base64。
- Backend worker 的 Artifact range read 同样限制 128 KiB，并在 Host adapter 内要求 stream 总字节数精确等于请求 range 后才通过 bounded local IPC 返回。
- Frontend metadata/create/list/revoke/get 与 Backend worker semantic surface 都复用同一 AppIntent receipt/grant/TTL contract。
- deterministic `runtime/plugin-app-intent-sdk` 覆盖 undeclared intent、missing grant、revoke、TTL、source Artifact disappearance、range read、CSP 与 Frontend no-JSON-byte contract。

本轮深审额外补了一个 SDK authority 边界：

- HostBridge 原本只验证“请求 range <= 128 KiB”，然后直接 transfer HTTP 返回的 `ArrayBuffer`；
- 即使正常 Backend route 会发送精确 `Content-Length`，HostBridge 作为 sandbox 最后一层 byte authority 仍应 fail closed；
- 现在 transfer 前再次要求 `content.byteLength === requested range length` 且不超过 128 KiB；异常/过长/过短响应统一拒绝为 `APP_INTENT_ARTIFACT_RANGE_INVALID`；
- regression 直接断言 exact-length check 发生在 `transfer: [content]` 之前。

施工中还遇到一次并发 HEAD 改写：P-108 从 `c23776a` 变为 `bd6c714`。两棵树审计后确认唯一差异是 runner 两处纯换行格式，P-108 功能树完全相同；因此 P-115 在当前 `bd6c714` 上重新合成并重新验证，未携带那 20 行无关格式差异。

最终 isolated staged-tree 验证：

- Backend `tsc --noEmit`：PASS
- Agent Runner `tsc --noEmit`：PASS
- Backend build：PASS
- Agent Runner build：PASS
- Frontend `vue-tsc --noEmit`：PASS
- Frontend Vite production build：PASS
- deterministic Agent scenarios：**65/65 PASS，0 FAIL**
- P-114 / P-059 leakage markers：**0**
- `git diff --cached --check` 与 post-commit `git show --check`：PASS
- whole-file Prettier warning 仅 runner / compose，且与 HEAD `bd6c714` baseline 完全一致；P-115 没有新增格式退化。

## 5. P-108 已完成事实与本轮深审修复

P-108 commit `bd6c714` 已独立提交，范围严格限制为 ACP inner permission durable approval / live continuation：

- `client.session.requestPermission` 复用现有 `agent_approvals` durable owner 与 Approval UI，通过 `kind='acp_permission'` 绑定 parent ToolCall、runtime、parent operation hash、policy/input revision；没有第二套 approval database/UI。
- outer `acp_execute` Tool 在 inner approval 期间始终保持 `running`；inner request/resolve 不推进 Run version、不 redispatch outer Tool，也不释放/替换 mutation lease。
- raw ACP input 不持久化原文，只保存 bounded title/kind、rawInput byte count/hash 等 inspection projection；实际 rawInput 在 ACP adapter 边界先做 32 KiB bounded JSON。
- durable approval resolve 成功后，live broker 才返回一次性 `allow_once/reject_once` 给当前 ACP session；Backend restart 没有 live waiter 时，仍处于 requested 的 approval 必须 fail stale。
- 已 durable resolved 的同一 idempotency retry 可以通过 StateCommit replay，不要求已经消失的 live waiter，也不会重新调度 outer Tool。
- Frontend 使用 typed transient `approval.changed` wake，Approval UI 对 inner permission 只显示显式 **Allow once / Reject once**。

本轮深审额外修复了四个 P-108 correctness gap：

1. **live waiter reserve/abort race**：旧 `take()` 会在 durable resolve 前提前 settle waiter、移除 abort/timeout guard；outer Tool 若此时 abort，后续 durable success 仍可能把 `allow_once` 续回已失效 session。现在 `take()` 只 reserve resolver，abort/timeout guard 在 durable commit 期间仍有效；abort/timeout 先发生时，后续 allow finish 是 no-op。
2. **pre-P-059 parent ToolCall identity 传播遗漏**：`AcpPermissionBroker` 需要 durable parent `toolCallId`，但该字段后来被 P-059 owner decomposition 搬进 `RootToolExecutionCoordinator`。P-108 commit 在当时 owner `NativeAgentBackend` 中最小补回 `ToolContext.toolCallId` 与 mutation execute 传播，没有提前引入 P-059 coordinator。
3. **resolved approval 的幂等重试被 live waiter 错误阻断**：首次 durable resolve 已成功但 HTTP 响应丢失时，旧 `ApprovalService` 会因为 live waiter 已消失而先报 `APPROVAL_STALE`，到不了 StateCommit replay。现在只有仍为 `requested` 的 ACP approval 才强制要求 live waiter；已 resolved approval 可进入 StateCommit 的 same-key replay，而不同 key 仍由 durable transition 拒绝。
4. **durable resolve 失败后的 requested approval 残留**：旧失败路径只把 live session 返回 `reject_once`，durable approval 仍可能以 `requested` 挂到 TTL。现在 reserved live handle 提供 `failClosed()`，在 resolve 失败时同时 reject live ACP action 并通过同一 StateCommit owner 尝试把 approval `superseded`；abort/race 后重复 close 仍是 fail-closed no-op。

Regression 现在包含：

- `runtime/acp-inner-permission`
- `runtime/acp-inner-permission-abort-race`
- `runtime/acp-inner-permission-replay`
- `runtime/acp-inner-permission-durable`

最终 isolated staged-tree 验证：

- Backend `tsc --noEmit`：PASS
- Agent Runner `tsc --noEmit`：PASS
- Backend build：PASS
- Agent Runner build：PASS
- Frontend `vue-tsc --noEmit`：PASS
- Frontend Vite production build：PASS
- deterministic Agent scenarios：**64/64 PASS，0 FAIL**
- P-115 / P-114 / P-059 leakage markers：**0**
- `git diff --cached --check` 与 post-commit `git show --check`：PASS
- Prettier：P-108 新增/修改行已 clean；共享文件仍有 HEAD `c3b201f` 继承的 whole-file warning，但 P-108 scenario 内两处 warning 已在 amend 中单独修正，没有为了格式制造跨 Problem churn。

## 6. P-109 已完成事实与本轮深审修复

P-109 commit `c3b201f` 已独立提交，范围严格限制为 MCP runtime health / retry / management：

- MCP health 仍是 process-local、可重建 projection，状态为 `idle / refreshing / ready / error`，只暴露 bounded error code、attempt/success/retry timestamps；没有新增第二套 durable health authority。
- Integration 的 durable `version + credentialRevision + schemaHash` 继续由现有 repository CAS 权威持有。
- lifecycle sweep 提供 bounded automatic retry；retry 前重新核对 integration 存在、enabled、version 与 credential revision，旧 generation 不得继续重试。
- Frontend Agent Settings 提供 MCP create/update endpoint/credential、enable/disable、delete、manual refresh/retry、health/error/retry status；existing integration 的 trusted annotation 设置可编辑，delete 有显式确认。
- 对应 SRS / FR / AGENT contract 与三语 i18n 已同步，明确排除 P-108 ACP inner permission、P-115 AppIntent SDK、P-114 Memory 与 P-059 owner decomposition。

本轮最终深审额外发现并修复了一个真实 TOCTOU：

1. 旧实现只在 network refresh 返回后用 durable `updateSchemaHash(version, credentialRevision)` CAS 防 stale。
2. CAS 成功返回后到同步 `mcpRefreshed` 发布 Tool contribution 之间，concurrent update/disable/remove 或 app deactivate 仍可插入。
3. 其中 deactivate 不改变 durable generation，因此旧 refresh 有机会在 teardown 后再次 publish，复活已移除的 Tool contribution。

`c3b201f` 增加 process-local refresh invalidation epoch：

- refresh 启动时捕获 epoch；
- successful update/remove、disabled sync 与 deactivate 都 advance epoch；
- schema CAS 后、publish 前再次校验 epoch；
- stale epoch 必须 close session 并以 `INTEGRATION_REFRESH_STALE` fail closed；
- stale completion 不得覆盖新 generation / deactivated 状态的 runtime health。
- deterministic `runtime/integration-health-retry` 新增 **CAS 已提交后 disable** 的 stale-publication race，以及 **remove 后旧 retry cancellation** 覆盖。

最终 isolated staged-tree 验证：

- Backend `tsc --noEmit`：PASS
- Agent Runner `tsc --noEmit`：PASS
- Frontend `vue-tsc --noEmit`：PASS
- Frontend Vite production build：PASS
- deterministic Agent scenarios：**60/60 PASS，0 FAIL**（完整重跑两次均 exit 0）
- P-108 / P-115 / P-114 / P-059 leakage markers：**0**
- `git diff --cached --check`：PASS
- P-109 新增 runner scenario block 与 compose retry hook 按仓库 `.prettierrc` scoped check：PASS；whole-file format warning 来自共享 runner / compose 的非 P-109 既有区域，因此没有为了格式制造跨 Problem churn。

## 7. P-088 已完成事实与最新审核发现

P-088 commit `75d7857` 已包含：

- durable `mutationMode` / migration #32；
- governed `worker` template；
- Full Access gate；
- Child Workspace-only mutation Tool surface；
- approval + lease/fence + StateCommit durable begin/settle；
- verified Tool evidence / restart unknown-outcome no-replay；
- `workspace_apply_patch` exact diff Artifact；
- Frontend `mutationMode` settings / i18n；
- deterministic `runtime/subagent-governed-mutation` regression。

本轮深审额外发现并修复了一个 authority gap：

- **不能只相信 Tool descriptor 的 `workspace.runtime.execute` capability。**
- executor 在 refresh inspection 后必须重新确认真实 target 是合法 Workspace mutation；
- StateCommit 在 durable begin mutation 时也重新解析 persisted `inspection_json` 并再次验证；
- 合法 target 分两类：
  - existing Workspace：必须绑定 `workspaceId + generation + workspace:<id>:<generation>` identity/resource；
  - `workspace_create`：必须精确绑定 `workspace:new:<runId>:<childRuntimeId>`；
- 非 Workspace / capability 伪装 target 在 approval consume / mutation side effect 前拒绝。
- regression 包含 `governed_subagent_non_workspace_target_rejections`。

P-088 commit 已通过 `git show --check`。

## 8. P-078 已完成事实

P-078 commit `a7d6d0f` 已独立提交，范围严格限制为 MCP 2026-07-28 协议扩展：

- Resources / Prompts 进入 schema-hash-bound refresh snapshot，并以 deferred Tool surface 暴露；
- 大型 Resource / Prompt payload 使用 Artifact spill，模型只拿 bounded projection / Artifact ref；
- `trustToolAnnotations` 只有用户显式开启时才允许 `readOnlyHint` / `destructiveHint` 影响 Tool risk，未信任 annotation 默认按 mutation 处理；
- migration #33 为 `agent_input_requests` 增加 nullable `continuation_json`，复用现有 durable clarification owner，不新增第二 input state machine；
- read/control MCP `input_required` 会 durable park，用户回答后重新 inspect 以适配新 `inputRevision`，再用 integrationId + schemaHash + method + requestParams 绑定的 continuation resume；
- 多轮 `input_required` 复用同一个 Tool/input-request durable owner；
- mutation-capable MCP Tool 若在 authority 激活后返回 `input_required`，直接 fail closed 为 `outcome='unknown'`，进入现有 quarantine/reconciliation，不跨用户等待继续 mutation；
- 当前 MCP SDK 没有可用的 2026-07-28 Task runtime，因此 P-078 没有虚构并行 Task scheduler。

拆分时明确排除了：

- P-109 runtime health / retry / management UI；
- P-108 ACP inner permission；
- P-059 `RootToolExecutionCoordinator` owner decomposition（P-078 resume 逻辑保留在当时的 `NativeAgentBackend` owner）。

验证：isolated Backend typecheck PASS、Backend build PASS、Agent Runner build PASS、deterministic **59/59 PASS**，其中 `runtime/mcp-protocol-surface` 与 `runtime/mcp-input-required-durable-lifecycle` 均 PASS；`git show --check` PASS。

## 9. P-080 已完成事实

P-080 commit `0cacd85` 是**文档契约 closure**，没有新增 Plugin Tool runtime/SDK：

- `doc/AGENT.md` 明确 Host-owned governed Tool implementations 仍属于 Core；
- 当前 manifest、Backend Plugin SDK、Runner Plugin SDK/worker protocol **没有** `AgentTool` descriptor/inspect/execute 注册 surface；
- Plugin Backend/Runner target 不得直接向 `ToolCatalog` 注入 Host-authority function；
- Plugin 通过 manifest capability/grant 使用 Core governed Tool，外部动态 Tool 优先通过 MCP；
- 若未来开放 Plugin-defined governed Tool，必须另立 versioned Tool SDK/IPC、risk declaration、schema lifecycle、outcome/verification contract；
- 同步修正 SRS-AGENT-001/SRS-AGENT-014 与 FR-AGENT-001/FR-AGENT-014，去掉“Plugin package 可贡献 arbitrary governed Tools”的错误承诺。

代码反证审计：manifest 当前只暴露 capabilities/intents/targets 等正式贡献面；Plugin runtime/worker surface 中不存在 `AgentTool` / `ToolCatalog` registration/injection 路径。Static contract、Prettier、`git diff --check` 均 PASS。P-080 不改 runtime code，因此代码树与已验证的 P-078 HEAD 相同。

## 10. P-068 / P-085 审核中修掉的重要历史缺陷

### P-068

Root collaboration projection 原先会：

1. `JSON.stringify()`；
2. 再用 `boundedUtf8(..., 8KiB)` 生硬截断。

profile / delegation 多时可能产生半截无效 JSON。

`02f64d1` 已修为 projection 内部按 byte budget 裁剪数组，并显式保留 omission counts；crowded regression 使用 32 profiles + 40 direct delegations，要求：

- 输出 <= 8 KiB；
- `JSON.parse()` 成功；
- omitted profile/delegation 数量可见。

### P-085

旧 canonical E2E seed 只有 migration 21，旧 `agent_checkpoints` 没有 `kind`。此前 current schema bootstrap 会在 migration #31 前创建 recovery index，导致 `no such column: kind`。

`90bc88a` 已修为：

- recovery index 在 migrations 后 ensure；
- migration #31 先补 `kind`；
- canonical seeded migration E2E 已 **1/1 PASS**。

P-085 还补了 backend authority：

- manual/user resume 只接受 `kind='user'`；
- rolling recovery checkpoint 只能走 backend-restart recovery path；
- 不能靠前端隐藏 Resume 按钮作为权限边界。

因此旧文档中的“seed no such column: kind 是基础设施限制”已经失效，后续不要再按那个假设行动。

## 11. 当前验证基线

要区分两套数字：

### 最新已提交代码的 isolated baseline

- Agent scenarios：**68/68 PASS，0 FAIL**
- Backend `tsc --noEmit` / build：PASS
- Agent Runner build：PASS
- 最新涉及 Frontend 的 P-059 isolated `vue-tsc` / Vite build：PASS

当前 dirty worktree 含已知 stale runner residual，因此**不把 dirty worktree 当 canonical baseline**；验证已提交行为时以最新 commit 的 isolated tree 为准。

### 各独立 commit 的 isolated staged-tree 基线

最近几项：

- P-085：54/54 PASS；Backend typecheck PASS；Frontend `vue-tsc` + Vite build PASS；canonical seed migration E2E 1/1 PASS。
- P-104：55/55 PASS；Backend typecheck PASS。
- P-068：56/56 PASS；Backend typecheck PASS；Frontend `vue-tsc` / build PASS。
- P-088：pure staged tree Backend typecheck PASS；Frontend `vue-tsc` PASS；deterministic **57/57 PASS**。
- P-078：pure staged tree Backend typecheck PASS；Backend build PASS；Agent Runner build PASS；deterministic **59/59 PASS**；本 Problem 无 Frontend 文件变更。
- P-080：docs-only staged tree；static contract PASS；Prettier PASS；`git diff --check` PASS；runtime code 与 P-078 已验证代码树一致。
- P-109：pure staged tree Backend typecheck PASS；Agent Runner typecheck PASS；Frontend `vue-tsc` PASS；Vite production build PASS；deterministic **60/60 PASS**；`git diff --cached --check` PASS。
- P-108：pure staged tree Backend/Agent Runner typecheck PASS；Backend/Agent Runner build PASS；Frontend `vue-tsc` + Vite build PASS；deterministic **64/64 PASS**；P-115/P-114/P-059 leakage **0**；`git diff --cached --check` PASS。
- P-115：pure staged tree Backend/Agent Runner typecheck PASS；Backend/Agent Runner build PASS；Frontend `vue-tsc` + Vite build PASS；deterministic **65/65 PASS**；P-114/P-059 leakage **0**；`git diff --cached --check` PASS。
- P-114：pure staged tree Backend/Agent Runner typecheck + build PASS；Frontend `vue-tsc` + Vite build PASS；deterministic **66/66 PASS**；P-059 leakage **0**；`git diff --cached --check` PASS。
- P-059：pure staged tree Backend/Agent Runner typecheck + build PASS；Frontend `vue-tsc` + Vite build PASS；deterministic **67/67 PASS**；`architecture/agent-owner-decomposition` PASS；duplicate authority metric = 0。
- P-121：regression-first 旧 HEAD 在 `architecture/public-contract-alignment` 真实 RED；最终 pure staged tree Backend typecheck/build + Agent Runner build PASS；deterministic **68/68 PASS**；P-121 runner region scoped Prettier clean，`git diff --cached --check` PASS。

未来若出现新 Problem，继续以“**isolated staged tree** 能独立 typecheck + deterministic PASS”为 commit 门槛；不要用当前 residual dirty worktree 替代已提交代码验证。

## 12. 必须保持的架构 invariant

继续审核/拆提交时，至少保持：

- StateCommit 是 Run / Tool / Approval / Subagent durable transition 的权威 owner。
- `NativeAgentBackend` 负责 Root model/run orchestration。
- `RootToolExecutionCoordinator` 负责已 durable pending Root Tool execution。
- SQLite Subagent repository 是 transaction/query owner；后期 codec extraction 只负责 persisted decode/projection，不建立第二 durable authority。
- frontend `agentApi` 仍是单一 public facade。
- AgentThreadSidebar 仅 presentation；ModelCapabilityEditor 仅 ephemeral form state。
- P-077 continuation truth：
  - authoritative continuation = `agent_model_attempts.continuation_json`
  - Ledger 只保留 modelStepId reference
  - 不新增第二 durable continuation state
  - reasoning text 不成为产品事实源。
- P-120：Root/Child execution 不再用累计 Token ceiling 停止执行；累计 Token 只做 telemetry，Context pressure 与 loop guard 各自独立。
- P-045：durable progress-aware loop guard 继续保持。
- P-056：SSH owner generation / lease / takeover 语义不得回退。
- P-085：restart safe-point recovery 与 recovery/user checkpoint kind authority 不得回退。
- P-095：Machine route freshness 必须包含 dependency-complete configuration hash。
- P-099：Workspace checkpoint + verified Artifact evidence authority 不得绕开 StateCommit。
- P-068：Child 不继承 Root raw history/Recall；parent Workspace project instructions 只能作为 bounded inherited project context。
- P-088：governed Child mutation 只能是 Full Access + Workspace mutation；executor 和 StateCommit 双层 target verification 都要保留。
- P-078：MCP `input_required` durable truth 复用 `agent_input_requests.continuation_json`；resume 必须绑定 integration/schema/method/request params；mutation `input_required` 不得跨等待继续 side effect。
- P-080：Plugin 当前没有 arbitrary governed `AgentTool` contribution surface；Host Core Tool authority 不得通过 Plugin target/SDK 文档或实现被悄悄旁路。
- P-109：MCP runtime health 只能是可重建 projection；durable version / credentialRevision / schemaHash 仍是 authority；refresh publication 除 durable CAS 外还必须受 process-local invalidation epoch fencing，disable/remove/deactivate 后旧 refresh 不得复活 Tool contribution。
- P-108：ACP inner permission 复用同一 `agent_approvals` durable owner/UI；outer Tool 保持 running，inner resolve 不推进 Run version、不重新调度 outer Tool；live waiter 只是当前 ACP session 的可丢失 continuation，abort/timeout/restart 必须 fail closed。
- P-115：Plugin iframe / Backend worker SDK 只能代理现有 `AppIntentService` authority；iframe CSP 必须保持 `connect-src 'none'`；Frontend Artifact bytes 只允许 bounded transferable `ArrayBuffer`，并在 transfer 前二次验证实际 byteLength 精确等于请求 range。
- P-114：Memory durable authority 继续由 `MemoryService` + SQLite repository 持有；Recall 只能暴露 published + unexpired Memory；跨 App import confirmation 必须一次性原子消费，Frontend stale list response 不得覆盖新 App/status/source 的 authoritative state。
- P-059：`RootToolExecutionCoordinator` 只接手已 durable pending Root Tool execution；`NativeAgentBackend` 仍是 Root model/run orchestration owner；Subagent codecs 只做 persisted decode/projection；Frontend extracted components/transports 不建立第二 command/mutation authority。
- P-121：模型可见 `tool_search/tool_invoke` 描述必须与实际 MCP Tool/Resource/Prompt deferred capability surface 一致；`AgentIntegrationFacade` list/get/create/update 必须暴露实际返回的 `IntegrationManagementView`，不得再次窄化 health/retry management contract。
- external / persisted input 从 `unknown` 收窄；不要重新引入 `any` / 双重断言边界逃逸。
- Agent Core / HTTP / Scheduler 不重新引入 direct `console.*` 或 raw arbitrary external error/body 日志泄漏。

## 13. 拆 Problem 的标准操作流程

后续会话请严格按这个顺序做：

1. `git branch --show-current`
2. `git rev-parse HEAD`
3. `git status --short`
4. 读完整 `doc/PROGRESS.md`、`doc/PROBLEM.md`
5. 获取目标历史 Problem 的 task record / 完成条件
6. 用 scenario / symbol / task record 建 candidate file map
7. 用相邻后续 Problem 的 task record做反证，明确“什么不能进这个 commit”
8. shared-owner 文件不要整文件 stage；从 HEAD 重建目标版本到 index
9. `git diff --cached --check`
10. 扫描后续 Problem 特征标记，确认无 leakage
11. `git write-tree` + temp commit / `git archive` 建 isolated staged snapshot
12. 在 isolated tree 跑：
    - Backend typecheck
    - Frontend typecheck（涉及 Frontend 时）
    - deterministic Agent scenarios
    - Problem 专属 E2E / build（如适用）
13. 失败时先判断：
    - 产品 bug；
    - 历史 regression fixture 漏字段；
    - migration 最新版本断言漏更新；
    - 临时 archive/worktree 依赖链接问题。
14. 修复后重新生成**最新** staged snapshot；不要复用旧验证目录冒充最新结果。
15. 最后再跑 `git diff --cached --check` 和 leakage scan。
16. 一个 Problem 一个 commit。
17. commit 后：
    - `git show --check --format=fuller HEAD --`
    - 核对关键 marker 确实进入 commit
    - `git status --short`，确认累计工作区仍保留。
18. **每完成一个 Problem commit，立即更新本 `doc/PROGRESS.md` 的 HEAD、已提交链、下一目标、验证基线和新发现。**
    - 这是后续跨会话必须遵守的新规则；
    - 不要等到整轮审计结束才更新；
    - `PROGRESS.md` 更新不要混进当前功能 Problem commit。

## 14. 当前环境

- 本机 Node：`v22.17.0`
- Repo engine：`>=24`
- canonical release / CI 仍以 Node 24 环境为准。
- 当前本地 Node 22 已能运行上述 typecheck / deterministic / build，但不要把本地 engine mismatch 当作 release 环境证明。

## 15. 后续会话一句话入口

> 当前最新功能代码基线应包含 `b615883`（P-121 已提交）；随后可能紧跟一个 docs-only closeout commit，但代码树不变。open Problem 应为 **0**，下一编号 `P-122`。index 应为空；worktree 仍应保留约 **24 个已审计代码 residual**，不要整批 stage/restore。若没有新的当前代码证据，不继续人为创建 Problem。
