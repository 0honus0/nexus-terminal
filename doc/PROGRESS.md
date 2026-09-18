# Nexus 开发交接

## 当前 Git / 工作区基线

- 仓库：`/home/agentdock/AgentDock/nexus-terminal-dev`
- branch：`dev`
- baseline HEAD：`1c07306cab45882c38f2f641e17559275bc604d3`
- P-094 文档收口前 `git status --short` 为 **158** 条累计未提交修改；当前 working tree 是唯一代码事实源。
- **必须保留全部现有修改**。禁止 `git reset --hard`、`git restore .`、`git clean`、stash、checkout 覆盖，或任何“先回 HEAD 再重做”的操作。
- 本机 Node 为 `v22.17.0`，仓库 package engine 要求 Node `>=24`；本轮 typecheck/build/scenario 均通过，但 release/CI 仍以 Node 24 canonical environment 为准。
- 本轮只完成并关闭 **P-094**；**没有开始 P-095 产品实现**。

## 刚完成：P-094 Storage / Workspace 生命周期假合同

P-094 已完成并从 `doc/PROBLEM.md` 移除。施工前确认三个关键事实：

1. `storage.maxArtifactBytes` 只有 Settings/UI 与大小关系校验，没有 per-Run Artifact consumer。
2. `unretainedArtifactTtlSeconds` 没有 ready Artifact deadline/sweeper；ready 时原本会把 staging `expires_at` 清成 `NULL`。
3. `workspaceIdleTtlSeconds` 虽然有 UI/API/defaults/hard-limit contract，但 `last_active_at` 只覆盖 create/lifecycle/reconfigure 等少数路径，普通 read/search/argv/terminal activity 没有统一 touch，因此直接做 idle sweeper 会误杀正在使用的 Workspace。

最终按“有真实 owner 才保留设置”的原则分两种处理：Artifact quota/TTL 补真实 runtime semantics；Workspace idle 假设置删除。

## Artifact quota authority

### requested storage limit 真正进入 runtime

`ArtifactLimitPolicyPort` 现在消费：

- `effectiveSettings.storage.maxSingleArtifactBytes`
- `effectiveSettings.storage.maxGlobalArtifactBytes`
- `effectiveSettings.storage.unretainedArtifactTtlSeconds`
- existing `minFreeDiskBytes`

因此 requested single/global 值先由既有 Settings normalization 受 hard limit 约束，再真正进入 Artifact reservation/global quota path；不再只读取 hard-limit ceiling。

### per-Run `maxArtifactBytes`

没有新建第二套 Run quota table，也没有把 per-Run usage 镜像到 Backend/Runner 新 owner。

唯一 authority 是 durable `agent_artifact_links`：

- canonical schema `createAgentArtifactLinksTableSQL` 同时安装 `agent_artifact_links_run_quota_insert` trigger；
- 第一次把一个未 deleted Artifact link 到某个 Run 时，trigger 统计该 Run 当前 **distinct artifact** bytes + incoming Artifact bytes；
- 同一个 Artifact 在同一 Run 的 `input/output/evidence/checkpoint` 多 role 只计一次；
- 普通 Library Artifact 在尚未 link 到 Run 前不伪造 per-Run 归属；
- 超过当前 effective `storage.maxArtifactBytes` 时原子拒绝 `ARTIFACT_RUN_QUOTA_EXCEEDED`；
- HTTP public taxonomy 将该错误规范化为 507 `ARTIFACT_QUOTA_EXCEEDED`；
- quota 使用 **当前 effective setting**，不是 Run-create frozen snapshot。Regression 验证同一既有 Run 在 10-byte setting 下拒绝第二个 6-byte Artifact，Settings 提到 20 bytes 后下一次 link 可通过；
- trigger 属于 existing canonical schema owner，**没有新增 migration #31**，当前 migration baseline 仍为 30。

所有既有 link producer（initial/append input、checkpoint、output/evidence、cross-App attach 等）继续写同一 `agent_artifact_links`，因此不能绕过这个 durable boundary。

## Artifact TTL / retention authority

`storage.unretainedArtifactTtlSeconds` 现在有真实 durable consumer：

- staging reservation 的 upload TTL 仍是独立短期 upload contract；
- Artifact 成功进入 ready 时，按当时 effective TTL 写 durable `expires_at = readyAt + ttl`；
- `retain=true` 清除自动 expiry deadline；
- 之后 `retain=false` 时按当时 effective TTL 从当前时间重新建立 deadline；
- 历史 ready/unavailable row 若仍是 `expires_at IS NULL`，bounded maintenance sweep 首次处理时按 `readyAt`（缺失时 `createdAt`）+ 当前 effective TTL 补成 durable deadline，之后语义固定在 row 上。

现有 Agent lifecycle timer 仍是唯一 maintenance scheduler。Artifact pass 先执行既有 `reconcile()`，再执行新增 bounded `sweepExpired()`；没有创建第二套 timer/GC service。

自动回收继续复用：

- `artifactProtectionReason`
- `ready/unavailable -> deleting -> deleted`
- `finalizeDeleting()`
- existing quota reconciliation

因此不会直接 `fs.rm` 后改表，也不会新造另一套保护规则。Deterministic fixture 已锁定以下过期 Artifact 不被删除：

- retained；
- active Run linked；
- checkpoint linked；
- active Artifact grant。

只有 expired + unretained + unprotected Artifact 会进入 two-phase delete。

## Workspace idle setting 的处理

`workspaceIdleTtlSeconds` 选择**删除假合同**，而不是在不完整 activity truth 上实现 unsafe sweeper。

已从以下产品面删除：

- Backend `AgentSettingsDocument.hardLimits`
- Backend `AgentSettingsDocument.workspaceRuntime`
- defaults / normalization / hard-limit cap
- Frontend API types
- Hard Limits UI
- en-US / ja-JP / zh-CN Agent Settings 文案

Legacy Settings JSON 中即使仍携带该 extra field，`normalizeRequestedSettings()` 会按当前 schema 重建并丢弃；新增 deterministic regression 已验证 defaults 与 legacy normalization 都不再暴露该字段。

产品代码与 SRS 范围扫描（排除 P-094 自身历史 handoff/regression assertion）为 **0 个 `workspaceIdleTtlSeconds` 残余**。

当前 `last_active_at` 仍只是 Workspace lifecycle metadata，不允许被描述成完整用户 activity authority；未来若重新引入 idle cleanup，必须先建立 read/search/argv/terminal/job/session 共用的单一可信 activity owner，再决定产品 setting。

## P-094 regression-first 与行为验证

新增 deterministic scenario：

`storage/artifact-lifecycle-settings`

产品修改前完整 suite **真实 FAIL**，首个失败：

`P-094 must not expose an idle Workspace setting until Workspace activity has a trustworthy runtime owner`

即旧 defaults 仍暴露 `workspaceIdleTtlSeconds`，regression-first 证据成立。

最终 scenario 覆盖：

- defaults 不再暴露 Workspace idle setting；
- legacy Settings normalization 丢弃 Workspace idle extra fields；
- ready unretained Artifact 获得 durable TTL deadline；
- retained Artifact 清除 deadline；
- 极小 per-Run quota 稳定拒绝第二个 distinct linked Artifact；
- 同 Artifact 多 role 不重复计费；
- current effective per-Run setting 修改后既有 Run 下一次 link 使用新 setting；
- expired reclaimable Artifact 被 bounded sweep 删除；
- retained / active Run / checkpoint / active grant 四类 protection 均保留；
- per-Run quota public error 映射为 HTTP 507 `ARTIFACT_QUOTA_EXCEEDED`。

最终 P-094 metrics：

- `artifact_run_quota_rejections = 1`
- `artifact_run_quota_current_setting_updates = 1`
- `artifact_run_quota_distinct_link_accounting = 1`
- `artifact_ready_ttl_deadlines = 1`
- `artifact_expiry_sweeps = 1`
- `artifact_expiry_protected_cases = 4`
- `workspace_idle_fake_settings = 0`

## 最终验证 baseline

全部通过：

- Backend `pnpm --filter @nexus-terminal/backend exec tsc --noEmit`：PASS
- Backend build：PASS
- Agent Runner `pnpm --filter @nexus-terminal/agent-runner exec tsc --noEmit`：PASS
- Agent Runner build：PASS
- Frontend `pnpm --filter @nexus-terminal/frontend exec vue-tsc --noEmit`：PASS
- Frontend build：PASS（Vite 2913 modules）
- deterministic Agent scenarios：**45/45 PASS**
- `storage/artifact-lifecycle-settings`：PASS
- Agent en-US / ja-JP / zh-CN locale JSON parse：PASS
- `workspaceIdleTtlSeconds` 产品/SRS残余扫描：0
- `git diff --check`：PASS

唯一环境提示仍是 Node `v22.17.0` < repo Node `>=24` engine warning。

## Problem 清单当前实算状态

P-094 移除后按当前 `doc/PROBLEM.md` headings + 状态字段实算：

- **54 total / 34 completed / 20 open**

当前 open Problem：

`P-056 P-059 P-060 P-062 P-068 P-078 P-080 P-083 P-084 P-085 P-088 P-095 P-099 P-104 P-107 P-108 P-109 P-113 P-114 P-115`

Workspace / Coding / Browser / Remote execution 默认顺序现在从 **P-095** 开始。

P-080 仍 open：`doc/AGENT.md` 与 `doc/architecture/BACKEND.md` 已明确 Host-owned governed Tool 属于 Core，但 `SRS-AGENT-001` / `FR-AGENT-014` 仍有 Plugin 可贡献 tools 的旧表述。

## 必须继续保持的 invariant

- 当前 working tree 是唯一事实源，累计未提交修改必须全部保留。
- 仍只有一个 `@ai-sdk/openai` SDK/Adapter。
- 不透传 raw/caller-owned `prompt_cache_key`。
- P-081 vendor cache key 只允许 official OpenAI endpoint + frozen capability gate。
- P-063 ToolCatalog / model Tool surface owner 不变。
- P-064 canonical Ledger / derived ContextCheckpoint owner 不变。
- P-069 raw ToolResult / model projection 分离不变。
- P-070 cumulative usage 与 latest Context occupancy 分离。
- P-077 continuation truth 仍是 `agent_model_attempts.continuation_json`；Ledger 只保留 `modelStepId` reference。
- P-093 Tool-call batch + terminal Tool results 保持原子。
- P-071 Project Instructions 仍是 transient Context source，不成为 approval/capability/security/Memory/durable business truth。
- P-071 resolver、P-072 `workspace-coding-files` 与 P-067 `workspace-code-intelligence` 必须保持独立 owner。
- P-072 `workspace_read_file/workspace_search` 与 P-067 `workspace_repo_map/workspace_code_intel` 保持 read risk；`workspace_apply_patch/workspace_execute_argv` 保持 mutation governance。
- Repo Map/code-intel cache 只可重建，不允许进入 Ledger/ContextCheckpoint/Memory/Run durable truth。
- Repo Map 不能替代 authoritative file read；任何编辑仍需真实 file content + hash precondition。
- P-073 Runner Job Journal 仍是唯一 background-job durable truth；不得在 Backend/Run/Ledger 新建第二份 authoritative job state。
- background launch 的 `confirmed` 只表示 Runner durable acceptance，verification 必须保持 unverified，直到 durable terminal evidence 出现。
- Artifact global quota 的 durable usage 继续由 existing `agent_quota_usage` owner 管理；P-094 没有再建 per-Run usage table。
- per-Run Artifact quota authority 是 `agent_artifact_links` insert boundary；同 Artifact/Run 多 role 不能重复计费。
- Artifact TTL authority 是 durable `ai_artifacts.expires_at` + existing protection/two-phase delete；不得创建旁路 GC。
- `workspaceIdleTtlSeconds` 当前不存在于产品设置合同；没有完整 activity owner 前不得重新加回假 idle cleanup。

## 下一会话入口：P-095，仅下一会话开始

**本会话到 P-094 closeout 为止，不继续 P-095。**

P-095 是 Machine mutation approval 对 Proxy / Jump-chain dependency revision 覆盖不完整导致的 stale-approval TOCTOU gap。下一会话开始时：

1. 重新检查 branch / HEAD / `git status --short`，确认累计未提交修改全部保留；若状态与本文件不同，以最新 current working tree 为事实源。
2. 完整读取本文件与最新 `doc/PROBLEM.md` 的 P-095。
3. 先审计当前真实 owner，不根据 Problem 文案直接实现，至少核对：
   - `packages/backend/src/bootstrap/agent/machine-support.ts`
   - `packages/backend/src/modules/agent/capabilities/tool-target.types.ts`
   - `packages/backend/src/modules/agent/runtime/execution/tool-call-runner.ts` 的 approval refresh / stale comparison
   - `packages/backend/src/modules/connections/services/ssh-connection-resolver.service.ts`
   - `packages/backend/src/infrastructure/agent/capabilities/machine-capability.adapter.ts`
   - SSH transport/session cache 的当前失效 key
4. 先向现有 P-079 deterministic harness 增加能真实 FAIL 的 P-095 regression，再做产品修改。
5. 第一目标是 **dependency-complete Machine target fingerprint**：direct Connection、Proxy 与所有 Jump hop 的非秘密配置/revision，以及 credential 的 opaque revision/hash 必须影响 approval refresh 的 operation identity；不得把 password/private key 明文或可逆值放进 ToolInspection/Ledger。
6. 必须先决定现有 `secretRefs` 的真实去留：若用于 credential lineage，就定义并真正生产/验证 `{id,version}`；若 route dependency fingerprint 已完整覆盖 credential revision，则删除这个全仓永远空的假抽象。不要留下两套半实现机制。
7. execution session/cache 必须与同一 dependency fingerprint 一致失效，不能 inspection 变 stale 但底层仍复用旧 route/credential session。
8. 验证至少覆盖 direct Connection、Proxy host/credential、任一 Jump hop host/credential、无关 Connection 修改、未变 route 正常审批，以及 inspection/log/ledger 无明文 secret。
9. P-095 完成后仍按固定规则：更新 `doc/PROBLEM.md`、完整重写本文件、重新实算 Problem 数量，并在同一会话停止，不继续 P-099。

## 新会话启动提示词

新会话直接发送：

> 继续开发 Nexus。进入 `/home/agentdock/AgentDock/nexus-terminal-dev`，先核对 branch/HEAD/status，完整读取 `doc/PROGRESS.md` 和最新 P-095，严格按 handoff 只完成 P-095；先做 regression-first，再实现、全量验证、更新 PROBLEM/PROGRESS，完成后停在 P-099 前。保留所有现有改动，禁止 reset/stash/clean/restore 覆盖。
