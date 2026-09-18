# Nexus 当前问题清单

> 本文件只保留**尚未闭环、可执行、可验证**的问题。已修复问题、一次性开发环境交接、历史 UI 草案和已经被现行架构/SRS 取代的设计不在这里长期归档；需要追溯时以 Git 历史为准。
>
> 本轮审计以 `origin/archive/main-2026-09-07` 为历史起点；审计启动时到 `main` 的范围为 377 个提交、1574 个变更条目。后续审计修复提交本身不计入这个启动快照。审计同时使用完整 diff 文件清单、Backend/Frontend 依赖图扫描、构建/typecheck、workspace/package 边界审核、Agent 代码反模式扫描，并对 Agent interface/runtime/provider/persistence/runner/frontend/E2E 高风险 owner 做逐批人工复核。

## 当前架构健康结论

当前**宏观模块边界健康**，但存在若干内部质量债务，不能把“依赖图没有违规”等同于“实现完全健康”。本轮基线结果：

- Backend 依赖图审计覆盖 437 个 TypeScript 文件，未发现禁止跨层依赖、源码循环或 module dependency cycle。
- Frontend 依赖图审计覆盖 326 个源码文件，未发现禁止依赖与依赖循环。
- 本轮 workspace/lockfile 审核确认仍只有单一 pnpm workspace 与根 lockfile，未出现第二套 package-manager/install authority。
- Backend、Frontend、Agent Runner build/typecheck 通过；本轮变更涉及的三语言 key 同步已核对。
- Provider E2E 通过，覆盖 OpenAI-compatible Provider 配置与当前 Chat Completions / Responses transport contract；纯 API 的 Nexus Agent plugin 真实 Run E2E 也通过，并实际走到 Skill、Plan multi-tool batch、Machine read、Subagent delegation、Approval 等 runtime 路径。
- 浏览器版 Agent surface E2E 在当前 AgentDock 主机启动 Chromium 前即因系统缺少 `libglib-2.0.so.0` 失败，未进入产品代码；因此完整浏览器证据仍以 Node 24 + Playwright 依赖齐全的远端 canonical E2E 为准。
- E2E 目录与调用面审核未发现新增 unit/component/internal suite；产品自动化仍集中在 `packages/e2e`。
- 当前本机 Node 为 v22，而仓库要求 Node >=24；上述结果只能作为本地静态/构建/非浏览器 E2E 证据，正式 release/CI 仍以 Node 24 canonical environment 为准。

因此当前结论是：**Owner/layer/transport 大边界没有出现合并后架构污染；当前问题已经收敛为几个可分批施工的风险簇：durable runtime/restart/lifecycle correctness、Run/Child 执行控制与异常检测、Context/Tool/token efficiency、Workspace/Artifact/Browser 恢复、MCP/Plugin 产品闭环，以及少量 schema/settings/dead-contract 清理。P-120 已确定正常 Root/Child execution 不再以累计 Token ceiling 作为停止条件；累计 Token 只保留 telemetry，Context pressure 与 progress-aware loop guard 分别由 Context 与执行策略 owner 处理。实施顺序见下节，不再把单个历史编号当总体健康结论。**

## 实施模块与顺序（本轮只定序，不改产品代码）

下面按**主 owner + 依赖顺序**分组；每个 Problem 只放一个主模块，跨模块依赖在条目内部引用，避免实施时重复改同一状态机。总体原则是：先有 deterministic 回归基线，再修 durable correctness，再改执行语义和 Context，最后扩能力与做结构清理。

0. **验证与兼容底座**：`P-079 → P-058 / P-061`。先建立 Backend-level deterministic Agent scenario harness；runtime validation 与持久化兼容窗口是横切规则，随下面各模块触及边界时兑现，不要求为了“先清债”阻塞功能。
1. **Runtime / Durable correctness**：`P-111 → P-117 → P-102 → P-101 → P-098 → P-097 → P-100 → P-105 → P-106 → P-110 → P-119`。先解决 restart/disable/cancel/reconciliation 与两阶段持久化，再处理 Integration race、idempotency TTL 与 public error contract；后续能力优化都建立在这套状态闭包上。
2. **Run 执行控制 / 完成语义**：`P-120 → P-045 → P-103 → P-089 → P-074 → P-076 → P-092 → P-091 → P-096 → P-116`。先移除 Root/Child 累计 Token 硬预算，改成 context pressure + progress-aware loop guard；随后收口 Subagent execution limits、finish reason、completion/user-input/plan/notification，并一起清理失效预算/defaults。
3. **Context / Token / Prompt efficiency**：已闭环。Tool exchange atomicity、Context accounting、ToolResult projection、durable compaction/checkpoint、高基数 Tool progressive disclosure、Provider prompt-cache hint、Responses continuation、Artifact input 与 Recall 均已完成；没有新证据时不再在该组重复施工。
4. **Model / Provider reliability**：`P-054 → P-082 → P-087 → P-086 → P-090`。先统一 capability authority 与 AgentDefinition requirement，再修 retry attempt identity、fallback chain，最后删 Provider 网络策略死字段；Provider transport 不重新引入 SSRF/private-host policy。
5. **Workspace / Coding / Browser / Remote execution**：`P-095 → P-099 → P-083 → P-084 → P-107 → P-056 → P-085`。Repo-scoped project instructions、一等 coding read/search/strict patch primitives、durable background job/wait/cancel、bounded Repo Map/code-intel 与 Storage/Workspace lifecycle 假合同已闭环；下一步处理 Machine approval route dependency、checkpoint，之后增强 Browser 与跨设备/重启 continuation。
6. **Subagent 能力层**：`P-104 → P-068 → P-088`。Mailbox TTL 先正确，再做 profile/template/context inheritance，最后开放 governed mutation worker；`P-101/P-102/P-103` 已在前置 correctness/执行控制模块解决，不在这里重复改状态机。
7. **MCP / ACP / Plugin 扩展层**：`P-109 → P-078 → P-108 → P-080 → P-115`。先让 MCP health/management 可用，再补 Resources/Prompts/Task 与 ACP inner permission，最后明确 Plugin Tool/AppIntent SDK 边界；`P-105/P-106` 的 race 必须已在前置模块完成。
8. **Memory / Artifact 产品闭环**：`P-114 → P-113`。先把 Memory candidate review/publish/import 主链真正交付给用户，再补 Artifact 单项删除；底层 Artifact durability 由 P-100 先保证。
9. **架构与死合同清理**：`P-118 → P-059 → P-060 → P-062`。删 StateCommit 旁路，再拆超大 owner、收日志与残余 `any`。这些清理不抢在功能 correctness 前，但相关模块修改时可以顺手完成局部项。

**实施约束**：同一批修改完成前先把对应 P-079 scenario 写出；P1 correctness 不与大规模 capability expansion 混成一个提交；跨模块 schema/settings 字段删除遵守 P-061 的兼容策略。上面顺序是默认施工顺序，若某一 Problem 被后续证据证明已闭环则直接从本文件删除，不为了编号顺序强行施工。

**会话交接约束**：每次完成一个 Problem 后，先用最终已验证事实更新本文件，再**完整重写** `doc/PROGRESS.md`。前一轮 `PROGRESS.md` 内容必须清空，不保留历史交接，只保存下一次会话所需的完整上下文：repo/branch/HEAD、未提交改动保护规则、最新 deterministic baseline、刚完成 Problem 的 invariant、仍需继承的关键 invariant、下一条 Problem 的真实审计入口、验证要求，以及同一条“完成后先更新 PROBLEM、再重写 PROGRESS、不要同会话继续下一条”的规则。**注意事项、约束和交接细节尽量全部沉淀在 `PROGRESS.md`，不要复制到聊天交接提示词里。** 对用户输出的下一会话启动提示应尽可能短，只要求新会话先读取 `doc/PROGRESS.md` 并按其中要求继续；新会话以 `PROGRESS.md` + 最新 `PROBLEM.md` + 当前代码事实为准，不依赖旧聊天记录。

---

## P-045 Agent 执行策略缺少 progress-aware no-progress / loop guard，不能再用累计 Token 额度代替异常检测

- **优先级**：P1
- **状态**：`已完成（2026-09-17；新增 Run-scoped durable progress-aware loop guard，复用 operationHash + bounded ToolResult fingerprint，识别 exact failure replay / same action+same result / A↔B oscillation / long-window no-progress；分级产生 strategy warning，持续无进展进入可恢复 awaiting_input；Root/Child 共用同一 StateCommit owner，用户新输入恢复 runtime 并开启新 progress epoch；Backend+Frontend build 与全套 deterministic scenarios 通过）`
- **当前事实**：
  - User global defaults → App-scoped execution policy override → Run snapshot 已实现；Run 创建时 context/output 来自模型物理 capability，step/time/tool/recall/subagent 等执行约束来自 effective policy。
  - 当前真正用于“防跑飞”的核心仍是 `maxRunTokens/maxRunSteps/maxActiveExecutionSeconds` 等硬额度；其中父 Run 累计 `maxRunTokens` 已决定由 P-120 删除，因为健康长任务不应仅因累计消耗达到某个数字而停住。
  - 全仓仍没有 Run-scoped repeated-operation / no-progress / oscillation detector；相同 Tool + 相同参数 + 相同错误/结果可以被模型持续重试，系统只能等到 step/time/token fuse。
  - `maxRunSteps` 与 `maxActiveExecutionSeconds` 本轮先保留为**最后一道异常保险丝**，但不再作为“任务完成进度”或模型可见的倒计时压力；等 P-079 benchmark 证明 loop guard 稳定后再决定默认值是否进一步放宽。
- **外部对照（2026-09）**：
  - Hermes Agent 当前 `agent.max_turns` 默认 unlimited；其文档明确记录旧的 70%/90% budget pressure warning 会让复杂任务过早收尾，因此已默认关闭。它把 runaway 识别拆成 exact failure、same-tool failure、idempotent no-progress 与 web-search/subagent per-turn caps，并把 context pressure交给独立 compression。
  - OpenHands `StuckDetector` 会检查重复 action-observation、重复 action-error、交替循环与 monologue；但其 2026-08 的 Goal-loop 修复也说明**单靠低阈值重复检测直接 hard stop 会误杀正常迭代**，因此 Nexus 需要 durable progress signal 与分级响应，而不是“重复 N 次就失败”。
  - Codex 当前公开产品更强调 Context usage/compaction；同时仍有 repeated deterministic tool failure、wait/poll loop 等公开问题，说明“没有总 Token cap”并不等于不需要 loop circuit breaker，真正要补的是重复失败/no-progress owner。
- **目标方向**：
  1. 定义 **progress epoch**：新 User Turn、新显式 continuation 或有意义 durable state change可以推进 epoch；普通 model iteration、无变化 poll/retry 不自动重置。Run resume 保留已有 loop evidence，避免通过 restart/compact 洗掉异常轨迹。
  2. 为 Tool action 生成 canonical fingerprint，优先复用现有 `operationHash/inspection`；read/control Tool 至少包含 tool + normalized args + target/version。Result 再生成 bounded outcome fingerprint（status/error code/高价值 result hash），不要把随机 id/timestamp 当进展。
  3. 至少识别四类异常：**exact failure replay**、**same action + same result/no state delta**、**A↔B oscillation**、**长窗口无 Goal/Plan/evidence/artifact/workspace/result 变化**。Polling/wait Tool 必须比较 authoritative progress cursor/state，而不是仅比较“调用了同一个工具”。
  4. 采用分级响应而非第一次命中就终止：第一次命中只向最新 Tool result 注入简短 strategy-change warning；继续重复则要求换证据源/等待/backoff/compact；仍无进展时进入可恢复的 `loop_detected/awaiting_user`（与 P-076 共用 durable user-input/attention owner），保留现场，用户可 `continue` 后开启新 epoch。
  5. 对天然高 fan-out 且重复几十次几乎一定异常的动作（例如 web search、Subagent spawn）允许单独的 per-turn/per-epoch cap；cap 只阻断该 runaway family，不把整个 Run 的累计 Token 消耗当判断依据。
  6. Context pressure 与 loop detection 解耦：上下文接近模型窗口由已落地的 P-064 durable compaction 与 P-070 context usage 处理；累计 Run usage只做 telemetry。不要因为“花得多”推断“没进展”，也不要因为 context 低就允许确定性死循环无限重试。
- **明确不做**：不恢复父 Run 总 Token 硬预算；不向模型注入 70%/90% “快没预算了赶紧结束”式压力；不把合法的 edit→test→edit、状态变化中的 polling、瞬态 provider retry 误判为循环；不额外引入 judge LLM 作为每步必经路径。
- **验证**：健康 coding/research Run 可以稳定超过旧 `maxRunTokens` 对应用量继续完成；相同 deterministic Tool failure / same result replay 在很少几次内被 warning→pause；中间发生 file hash/Plan/evidence/job progress 后 streak 自动重置；正常测试修复循环不误停；用户 continue 后可从 durable 现场继续。

## P-054 Provider live capability authority 尚未接入 Model Capability Resolver

- **优先级**：P1
- **状态**：`已完成（2026-09-18；Provider live capability 以显式 versioned observation 接入统一 resolver，逐字段 Manual > Provider live > Registry；Root/Child 均冻结 durable capability snapshot；普通 OpenAI-compatible /models 不猜能力；Backend/Frontend typecheck 与 deterministic scenarios 27/27 通过）`
- **完成事实**：
  - `LanguageModelPort.discoverModels()` 的 capability ingestion 现在只能通过显式 `liveCapabilityReport` 进入，report 必须携带 `source/sourceVersion/capabilities`；`ProviderService` 校验后补 `updatedAt`，再把 observation 持久化到 `ai_providers.live_capabilities_json`。migration 29 只新增 observation 列，不改写既有 `models_json` / manual override authority。
  - `model-capability-resolver.ts` 是唯一 effective capability authority：每个字段独立按 `Manual > Provider live > Registry` 合并；缺失 live 字段继续从 Registry 补齐，未知/私有模型缺 required capability 仍 fail closed 为 `MODEL_CAPABILITY_INCOMPLETE`。source 与冲突字段只做可观察 projection，不形成第二套 effective truth。
  - 普通 OpenAI-compatible `/models` 仍只解码 identifier/owned_by/created；没有显式 capability report 就不会根据 model name、proxy 名称或非标准响应字段猜能力，也不会因为一次 identifier-only refresh 擅自抹除已有 versioned observation。
  - Provider live refresh 与人工 Provider 配置版本分离：刷新 observation 不 bump `configurationVersion`；Root Run 创建时把 resolved capability 写入 durable `RunDefinitionSnapshot.modelCapabilities`，Subagent delegation 也冻结同一 resolver 的 snapshot。后续 live refresh 只影响新 Run/新 delegation，不让已启动 Root/Child 漂移。
  - OpenAI transport 的 tools/image/file/output-limit 校验会优先使用 request 的 frozen capability snapshot；旧 Run/旧 delegation 没有 snapshot 时保留原兼容路径。
  - Frontend capability editor 现在能显示 Provider source/version/update time 与冲突字段；恢复 baseline 时按 Provider live 优先、Registry 次之。discovery/manual-add 不再为未知模型伪造 `128000/4096/tools=true` 并保存成 manual fact；required capability 不完整时明确拒绝添加。
- **验证**：
  - 新增 deterministic `model/provider-live-capability-authority`，覆盖 Registry-only、Provider-only、partial merge、Manual precedence、三来源冲突、source precedence、unknown/proxy model、精确 date variant、live refresh 与 durable Run snapshot 不漂移。
  - 完整 deterministic Agent scenarios：`27/27 PASS`；同时明确通过 `model/provider-continuation-roundtrip`、`context/indexed-recall`、`context/skill-progressive-disclosure`。
  - Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、三语言 JSON parse、P-054 targeted `git diff --check` 均通过。
  - 静态复核确认 P-077 continuation truth 仍只在 `agent_model_attempts.continuation_json`，Ledger 只保留 `modelStepId`；P-065 仍使用 indexed recall；P-066 仍保持 signed Skill metadata search → hash-bound `skill_read` 的 progressive disclosure/trust invariant。

## P-056 Suspended SSH Session 缺少跨设备 Takeover/Owner Lease

- **优先级**：P1
- **状态**：`未闭环`
- **当前事实**：
  - `prepareResume → replacement Workspace → checkpoint/history ACK → commitResume` 已形成单次恢复事务，并支持 rollback。
  - P-046 的 Terminal checkpoint + raw history lazy paging 已落地，不再是问题。
  - 当前代码没有独立的跨设备 resume owner lease/generation/revoke 状态机；现有代码里的 “takeover” 主要表示 Backend 从 Workspace 接管 suspend transport，不等价于设备 A/B 间的产品级接管。
- **问题**：同一用户在设备 A 仍持有/恢复某 suspended session 时，设备 B 缺少明确、安全、原子的 ownership transfer 语义。不能通过“重新打开 Connection”新建第二条 SSH 来冒充恢复。
- **要求**：
  - suspended session 是 server-owned resumable resource；同一时刻只能有一个 live terminal consumer。
  - `available → resuming(owner lease/generation) → attached` 必须有可过期 lease；stale owner 自动失效，活跃 owner 可经用户确认被 revoke。
  - takeover 不创建第二条 SSH，也不能允许两个前端同时向同一 PTY 写入；旧客户端收到明确 revoke reason 后不得自动抢回。
- **验证**：设备 A 挂起长任务后，设备 B 可恢复同一 PTY；双端同时恢复只有一个 owner；中途失败 rollback 后 session 仍可恢复；正常关闭/断网/浏览器崩溃/主动 takeover 均有协议级 E2E。

## P-058 Agent 跨进程与持久化 JSON 边界仍大量依赖 TypeScript 断言代替 Runtime Validation

- **优先级**：P1
- **状态**：`已完成（2026-09-17；按当前代码事实收口 Agent durable/IPC/file boundary：Runner HTTP、journal/catalog、Run/Checkpoint/StateCommit、Conversation/Workspace/Integration/Provider/Plugin/Artifact/Memory 等权威路径均先 parse-to-unknown 再由 owner decoder 有界收窄；共享 decoder 只承载跨 repository/transaction 必须一致的 durable domain shape，不引入 safeJson<T> 或第二事实源；新增 boundary/durable-runtime-decode deterministic scenario，完整 Agent scenarios 18/18 通过，Backend 与 Agent Runner build、git diff --check 通过）`
- **完成事实**：
  - `runner-http.adapter.ts`、Runner journal/catalog/IPC 与 package manifest 路径均已是 parse-to-unknown + protocol/domain decoder；旧证据中的泛型 cast/浅层检查已不成立。
  - Backend 新增 Infrastructure-owned durable decoder，统一 Run budget/usage/definition/plan、Tool inspection/result、workspace environment 与 bounded JsonValue；StateCommit Root/Child/replay 与相关 repositories 共用同一 durable contract，corruption/version/enum/type mismatch fail closed。
  - Provider/Integration/Plugin/Artifact/Workspace/Memory 等各自 owner 保留领域语义 decoder；没有引入无语义 mega `safeJson<T>()`，Module service 不承担 persisted compatibility 判断。
  - deterministic `boundary/durable-runtime-decode` 覆盖合法 payload，以及 missing field、wrong type、oversized collection、unknown enum、old schema version、broken JSON；完整 scenarios 18/18 全绿。
- **风险**：
  - 版本偏差、磁盘损坏、旧 schema 残留或边界实现 bug 可能在离真实输入很远的位置才失败，错误被误判为业务逻辑问题。
  - Adapter/Repository 表面上提供强类型，但实际上没有完成“untrusted/persisted bytes → domain value”的转换责任，形成伪类型安全。
- **要求**：
  1. 所有跨进程 HTTP/IPC、签名包 manifest、journal/catalog、关键 durable JSON 先解析为 `unknown`，在 owner 边界做有界 decode/validation 后再返回领域类型。
  2. Decoder 放在 Interface/Infrastructure/Runner protocol owner，不把兼容判断扩散到 Module service。
  3. 对 corruption/version mismatch fail closed；需要保留证据的 journal/database 路径先 quarantine/evidence，再决定 migration/recovery。
  4. 不为了“统一”造一个无语义的 mega `safeJson<T>()`；每个协议/持久化对象应有明确 schema/decoder。
- **验证**：对 missing field、wrong type、oversized nested collection、未知 enum、旧 protocol version、损坏 JSON 增加边界测试；Agent/Runner 权威路径不再出现无 decoder 的泛型 `JSON.parse(...) as T`。 - Frontend `agent-api.ts` 还复制了一组 Backend view 类型，其中 `goalStatus`、`verificationStatus`、部分 health/observed state 等字段退化为裸 `string`；这与后端 JSON 边界同属 contract drift 风险，后续应由共享 schema/decoder 收口，而不是靠两端手工同步。

## P-059 Agent 合并后存在多个超大 Owner 文件，宏观分层健康但内部职责开始聚集

- **优先级**：P2
- **状态**：`本轮 archive→main 审计新增`
- **当前热点（当前 main 行数，仅用于定位，不把行数本身当 bug）**：
  - `packages/frontend/src/features/agent/host/AgentAppSurface.vue`：约 2878 行。
  - `packages/frontend/src/features/agent/settings/ModelProviderSettings.vue`：约 2054 行。
  - `packages/frontend/src/features/agent/api/agent-api.ts`：约 1685 行。
  - `packages/backend/src/modules/agent/runtime/execution/native-agent-backend.ts`：约 1369 行。
  - `packages/backend/src/infrastructure/agent/repositories/sqlite-subagent.repository.ts`：约 1233 行。
  - `packages/backend/src/infrastructure/agent/runtime/state-commit/subagent-transitions.ts`：约 1139 行。
  - `packages/backend/src/modules/agent/host/plugin-install.service.ts`：约 974 行。
  - `packages/backend/src/infrastructure/agent/runtime/state-commit/tool-transitions.ts`：约 873 行。
- **判断**：当前依赖图审计说明这些文件没有突破大层依赖边界；问题是同一 owner 内已经同时承担多组变化频率不同的职责。继续把 batch/recovery/UI/settings/provider/install 逻辑向这些中心文件追加，会让审查、回归与兼容处理越来越依赖局部知识。
- **拆分原则**：
  - 不以“每 300 行一个文件”为目标，不增加纯转发 wrapper、无消费者 port 或 `utils` dumping ground。
  - `native-agent-backend` 优先按 model-step orchestration / batch proposal / governed execution / reconciliation 的真实 invariant 拆分；StateCommit authority 不移动。
  - `AgentAppSurface` 把 host orchestration、conversation/thread navigation、run commands 与纯展示区分开，但 authoritative state 仍由既有 facade/store owner 持有。
  - `ModelProviderSettings` 按 provider form/discovery/model sync/capability editor 的真实流程拆分；不要再造第二套 settings state。
  - `agent-api.ts` 可按 Host/Run/Provider/Plugin/Artifact/Workspace Runtime client surface 分区，同时保持公共 DTO owner 唯一。
  - SQLite repository/transitions 只在 query/projection/decoder/transaction invariant 清晰时拆，不能把一个 transaction 拆成跨 repository 的伪 service。
- **验证**：拆分前后公共 contract、StateCommit transaction boundary、E2E 行为不变；拆分后重新做依赖图审查且 build/E2E 不变；新增文件必须有真实调用方且符合 EC-ARCH-009。

## P-060 Agent Core/HTTP/Scheduler 仍有直接 `console.*`，绕过结构化日志边界

- **优先级**：P2
- **状态**：`本轮 archive→main 审计新增`
- **证据**：
  - `packages/backend/src/modules/agent/runtime/events/event-hub.ts`
  - `packages/backend/src/modules/agent/runtime/collaboration/subagent-participant-executor.ts`
  - `packages/backend/src/modules/agent/runtime/collaboration/subagent-scheduler.ts`
  - `packages/backend/src/interfaces/http/agent/agent-http.ts`
    当前均存在直接 `console.error(...)`。
- **边界说明**：Agent Runner / Plugin child worker 把 stdout/stderr 作为独立进程 protocol/log sink 的实现可单独处理；本问题针对已经处于 Nexus Core/HTTP/Scheduler 内、理应使用统一 structured logger 的路径。
- **风险**：直接 dump Error/object 会绕过统一 event name、correlation、redaction、sampling/retention 约束，也让 Agent 自诊断无法稳定消费同一事件模型。
- **要求**：Core 路径改为结构化 logger，记录 safe ID/state/error code/duration 等 bounded metadata；不得记录 prompt、message、credential、Tool/Runner command payload 或未经筛选的外部 response body。
- **验证**：Agent Core/HTTP/Scheduler 的 `rg 'console\.'` 清零或只剩明确批准的 process-boundary sink；E2E failure diagnostics 仍能关联 run/request/session。

## P-061 Agent 已发布持久化兼容仍缺少明确的支持窗口与退出条件

- **优先级**：P2
- **状态**：`已完成（2026-09-17；按“产品尚未正式发布”的当前事实删除无产品语义的 Provider persisted flat-field shim；对仍有 durable recovery 语义的 pre-#23 Tool lineage 用 migration #25 一次性回填/规范化并收紧 fresh+upgraded DB invariant，runtime repository 不再保留 synthetic legacy fallback；新增 compat/current-durable-schema deterministic scenario，完整 Agent scenarios 19/19、Backend typecheck/build、git diff --check 全绿）`
- **完成事实**：
  1. `PersistedProviderModelConfig` 现在只保留当前 canonical `{ id, capabilityOverrides? }`；`legacyOverrides()` 与 flat persisted capability fields 已删除，Infrastructure decoder 只接受当前 schema，旧未发布 shape fail closed，不再制造“接受但忽略”的假兼容。
  2. migration #25 将 migration #23 以前 `source_model_step_id IS NULL` 的 durable Tool row 按同 Run/Runtime 中最近前置 Model step 回填，并重算 `batch_index/batch_size`；无法映射的历史 durable row 会使 migration fail closed。
  3. fresh schema 将 `source_model_step_id` 收紧为 `NOT NULL`；升级数据库通过 insert/update trigger 强制 source 必须是同 Run/Runtime 的真实 Model step。Root/Child 当前写路径均显式写入 lineage 与 batch metadata。
  4. `sqlite-subagent.repository.ts::recentRuntimeToolExchanges()` 已删除 `legacy:<tool-call-id>` 分组 fallback，直接消费规范化后的 durable lineage；Module domain model 不再承载旧持久化 schema。
  5. deterministic `compat/current-durable-schema` 用 migration-24 fixture 验证 3 条旧 Tool row 被恢复成两个真实 batch，并验证后续 NULL lineage 写入被拒绝；同时验证 Provider legacy flat persisted shape 已不能通过 decoder。
- **验证**：兼容扫描已无 `legacyOverrides`、`legacy:<id>`、旧 flat-field compatibility runtime 分支；完整 deterministic suite 19/19 全绿，Backend typecheck/build 与 `git diff --check` 通过。

## P-062 少量产品代码仍使用 `any` 绕过已经明确的类型边界

- **优先级**：P2
- **状态**：`本轮 archive→main 逐文件扫描新增`
- **证据**：
  - `packages/frontend/src/features/agent/settings/BudgetContextSettings.vue` 对已知 budget key 连续使用 `(…budget as any)[key]`，绕过 requested/effective budget 的字段合同。
  - `packages/backend/src/modules/settings/settings.service.ts` 的 JSON validator 仍以 `any` 作为输入并在内部继续传播 `any`；这里本来就是 persisted JSON → typed settings 的验证边界，应从 `unknown` 收窄。
  - `packages/backend/src/interfaces/http/quick-commands/quick-commands.routes.ts` 的 `parseBody(body: any)` 位于 HTTP transport 边界；即使当前逐字段读取有运行时判断，参数本身仍让后续新增字段容易绕过 decoder 纪律。
  - `sqlite-migrations.ts` 的 `catch (error: any)` 属于较低风险类型逃逸，也可在触碰 migration runner 时一并改为 `unknown` + Error narrowing。
- **不属于本问题**：Monaco internal ESM import 上带明确原因的 `@ts-ignore`、E2E fixture 中为协议探针使用的宽类型，不应为了“零 any”目标做无意义包装。
- **要求**：产品边界输入统一从 `unknown` 开始；已知字段 key 使用显式 key union/generic accessor，不用 `as any` 绕开编译器；修复时不得为了消灭 `any` 引入更差的双重断言 `as unknown as T`。
- **验证**：上述产品源码 `any` 命中清零或每个剩余例外都有紧邻的第三方/语言限制说明；Backend/Frontend typecheck 与行为 E2E 不变。

## P-065 Recall / Earlier-thread Retrieval 仍采用大范围扫描 + JS Substring 排序，缺少索引化第一阶段检索

- **优先级**：P1
- **状态**：`已完成（2026-09-18；Memory / Earlier-thread 改为 rebuildable SQLite FTS bounded candidate retrieval，保留 Nexus domain rerank；2 字 CJK 不走 LIKE/full scan；新增 context/indexed-recall scenario，完整 deterministic Agent scenarios 25/25、Backend/Frontend typecheck、targeted git diff --check 全绿）`
- **完成事实**：
  1. SQLite 中的 `ai_memories` / `ai_thread_entries` 继续是 canonical truth；新增 `ai_memories_search` / `ai_thread_entries_search` 作为 derived FTS projection。索引由 canonical table trigger 同事务维护，不引入第二份 Memory/Ledger authority。
  2. database worker 注册 deterministic `nexus_search_terms()` / `nexus_ledger_search_terms()`：英文、identifier/code-ish 文本生成 lexical/substring-friendly tokens；CJK 生成 2/3-gram 派生 token，因此 `项目` 等 2 字查询不需要退回 `LIKE` 或 JS 全表扫描。
  3. Memory recall repository 改为 FTS/BM25 第一阶段候选，candidate bound 为 `min(64, max(24, limit * 8))`；随后仍由 `RecallService` 使用 lexical + confidence + freshness 做产品层 rerank 和 byte/item budget selection。旧 `publishedCandidates(..., 1000)` 路径已移除。
  4. Earlier-thread retrieval 下沉到 `ConversationRepositoryPort.searchEarlierEntries()` / SQLite FTS；Context 每次最多读取 64 个 indexed candidates，再使用现有 lexical + sequence recency rerank、去重和 8 KiB/6-item budget。旧 `THREAD_RECALL_SCAN_LIMIT = 800` 分页扫描已移除。
  5. recent verbatim tail、thread anchors 与已落地的 P-064 checkpoint/compaction 职责保持独立；indexed recall 只负责较早历史的按需候选，不替代 Context 的 recent-history owner。
  6. search index schema 与 migration #28 都支持从 canonical rows 重建；worker 启动时会检测缺失/不一致的 derived index 并 rebuild。索引被 drop 后可在重启时恢复，canonical rows 不受影响。
  7. query term normalization 现在保留 camelCase/identifier 边界并做 NFKC 规范化；FTS query 优先使用强 token group，避免简单“任一 trigram 命中”把 bounded candidate 集合污染掉。
  8. 横向核对 Codex / Claude Code / Hermes 后，本问题明确不迁移 durable authority：Nexus 继续使用 SQLite control/ledger truth；per-session JSONL / immutable compressed segment 若未来用于 portable archive、replay 或 cold history，应单独立项。
- **明确不做**：不把 Ledger/Memory 主存储迁成 per-session 文件；不引入 Vector DB、embedding daemon 或远端 retrieval service；不把 Artifact/File 内容无界索引进 memory context；不保留短 CJK 的 LIKE/full-scan fallback。
- **验证**：
  - 新增 `context/indexed-recall`：构造 1200 条近期 Memory filler 与 1000 条 Thread entries，把目标放到旧 1000/800 扫描范围之外；英文 identifier 与 2 字 CJK 均能命中。
  - scenario 指标：`memory_rows_beyond_old_scan_found=2`、`thread_rows_beyond_old_scan_found=2`、`two_character_cjk_indexed_queries=2`、`derived_indexes_rebuilt=2`；本 fixture 的 first-stage Memory/Thread candidate 实际均为 1 row。
  - 完整 deterministic Agent scenarios：25/25 PASS；`model/provider-continuation-roundtrip` 继续 PASS，P-077 continuation authority 未回退。
  - `pnpm --filter @nexus-terminal/backend exec tsc --noEmit`、`pnpm --filter @nexus-terminal/frontend exec vue-tsc --noEmit`、targeted `git diff --check` 均通过。当前环境仍提示 repo 期望 Node >=24，而 AgentDock 为 Node v22.17.0。

## P-066 Skill Progressive Disclosure 已有雏形，但格式与发现机制尚未对齐主流 Agent Skills 生态

- **优先级**：P2
- **状态**：`已完成（2026-09-18；标准 Agent Skills SKILL.md 与 legacy Nexus Skill 共存，signed-plugin authority 不变；低基数继续直接 metadata，高基数改为 bounded lexical discovery + skill_search → skill_read；新增 context/skill-progressive-disclosure deterministic scenario，完整 Agent scenarios 26/26、Backend/Frontend typecheck、targeted git diff --check 全绿）`
- **完成事实**：
  1. `SkillRegistry` 现在承担开放 Skill 文档兼容层，而不是 Plugin installer/verifier：标准 `SKILL.md` 接受必需的 `name/description` 与可选 `license/compatibility/metadata/allowed-tools`；标准 Skill 的 Nexus id 由 signed App id + Skill name 稳定派生，version 由 signed plugin version 派生，文档本身不能声明新的 Nexus capability。现有 Nexus `id/version/requiredCapabilities` legacy frontmatter 继续兼容。
  2. signed-plugin authority 没有迁移进开放文档：publisher trust/signature/package hash/file hash 仍由 package verify/install/source 链负责；legacy `requiredCapabilities` 仍必须属于 signed manifest declared capabilities；标准 `allowed-tools` 只作为兼容 metadata 解析，**不会**转换为 App grant、Tool permission 或 capability authority。
  3. `SkillRegistry.disclose()` 以 8 个 Skill 为 direct/indexed 阈值：`<= 8` 时继续把全部 `id/name/description` metadata 暴露给模型；高于阈值时只根据当前输入注入最多 6 个相关 metadata，并明确提示使用 `skill_search`。Skill body 仍不进入常驻 prompt。
  4. 新增只读 `skill_search(query, limit)`，limit 最大 8；返回仅 `id/name/description`，不返回 body/hash/publisher/capability。候选只来自当前 scope 已安装、已签名且 hash 校验通过的 Skill catalog；全文指令仍只能由 `skill_read(id)` 按需读取。
  5. `skill_read` 原有 TOCTOU contract 保持：inspect 绑定 Skill `id/version/hash`，execute 时重新从当前 installed signed source 加载并复核 version/hash；没有增加第二套 Skill body/cache authority。
  6. P-065 的 lexical 逻辑抽成无 repository/authority 语义的 `platform/search/lexical-search.ts` primitive，保留 NFKC、identifier/camel boundary 与 CJK 2/3-gram；Memory/Thread 的 SQLite FTS repository 与 Skill 的内存 postings/rerank 仍是各自 owner，没有形成跨领域 mega search service。Skill 的 n-gram 只做候选生成，最终至少要求一个规范化 query term 真正命中 metadata，避免弱 trigram overlap 被注入 prompt。
  7. `ContextService.skillMetadataHash` 现在只描述实际 model-facing disclosure（mode/total + projected `id/name/description`），不把 signed hash/capability/trust 隐性复制成另一份 prompt-facing authority。
- **验证**：
  - 新增 `context/skill-progressive-disclosure`：同时覆盖标准 `SKILL.md` 映射、legacy Skill、2-Skill direct metadata、16/48-Skill indexed disclosure、目标 Skill 命中、`skill_search` metadata-only、`skill_read` body on-demand、跨 scope 不泄漏、signed file hash mismatch fail closed、legacy undeclared capability fail closed。
  - 48-Skill fixture 实际只注入 1 条相关 metadata；Skill system block 约 114 estimated tokens，并与同 query 的 16-Skill fixture保持相同 token estimate，证明固定 prompt 成本不再随总 Skill 数线性增长；body prompt-resident 指标为 0。
  - 完整 deterministic Agent scenarios：26/26 PASS；`context/indexed-recall` 与 `model/provider-continuation-roundtrip` 继续 PASS。
  - P-077 复核：authoritative provider continuation 仍只写 `agent_model_attempts.continuation_json`；Ledger assistant payload 仍只保存 `modelStepId` reference，不新增 continuation durable state，也未引入 hidden reasoning text。
  - P-065 复核：`ai_memories/ai_thread_entries` 仍为 canonical truth，FTS 表仍为 trigger-maintained/rebuildable projection；Memory candidate bound `min(64, max(24, limit * 8))`、Earlier-thread 64 indexed candidates、2 字 CJK indexed path 均保持，旧 1000/800 scan 与 LIKE fallback 未恢复。
  - `pnpm --filter @nexus-terminal/backend exec tsc --noEmit`、`pnpm --filter @nexus-terminal/frontend exec vue-tsc --noEmit`、targeted `git diff --check` 均通过。当前 AgentDock 仍为 Node v22.17.0，而 repo 声明 Node >=24；该项仅为既有 environment warning。

## P-068 Subagent Profile 基础设施已完整，但缺少内建任务模板、委派选择策略与轻量 Context Inheritance

- **优先级**：P2
- **状态**：`优化设计已立项，现有能力已复核，待最终方案收敛`
- **当前事实**：
  - Nexus 已有 `delegate_subagent`、mailbox、shared facts、join、durable participant state，不缺“能 spawn subagent”的基础设施。
  - `SubagentPolicyService` 已提供 App-scoped profile；当前 profile 包含 `role/defaultModel/allowedModels/capabilities/peerMessaging/maxTokens/maxSteps/failureMode`，Frontend 也已有完整配置 UI；其中 cumulative `maxTokens` 已由 P-120/P-103 决定退出执行合同。
  - `SubagentService` 已通过现有 Provider/Model contract 选择模型、通过 `AppCapabilityBroker` 收敛 child capability，并执行 depth/token/step/deadline 约束。因此**不需要再造一套 profile/model router**；后续模板只应依赖仍保留的 step/iteration、depth、concurrency/fan-out 与 capability 约束。
- **剩余问题**：Profile 目前主要由用户手工配置和 Root 模型显式选择；没有开箱即用的任务型模板，也没有明确的“什么时候委派比自己做更划算”策略。Child context 仍需要继续控制 project instructions、Tool schema、历史与 mailbox 的继承量，否则 fan-out 会把 token 成本从 Root 转移到 Child。
- **目标方向**：
  1. 在现有 profile schema 之上提供少量可复制/覆盖的内建模板，例如 `explore`（repo/code read-only）、`scout`（外部资料/Integration research）、`review`（diff/test/read-only）与 `general`；它们是默认配置，不是新的运行时类型系统。
  2. Root model 继续通过 `delegate_subagent(profileId, objective, ...)` 做最终选择，但 Context 中只提供简短 profile manifest 与“适合/不适合委派”的指导；第一版不引入额外 classifier model。
  3. 默认只在任务足够大、可并行或需要隔离大量检索上下文时委派；小任务直接由 Root 完成，避免固定 fan-out overhead。
  4. Child 只继承 objective、constraints、必要 artifacts、与其目标路径相关的 project instructions/Tool family；不复制 Root 的完整 raw history/recall。
  5. Root Context 始终从 durable collaboration owner 重新投影一个 bounded child lifecycle 摘要（delegation id/profile/status/objective/result/evidence/capacity），不能依赖“之前某轮模型记得自己 spawn 过谁”。因此已落地的 P-064 compaction/checkpoint 后不会丢 child 状态，也避免 full-history fork 带来的 token/storage 放大。
  6. 可继续使用更快/便宜模型处理 Explore/Scout，但只通过现有 Provider/Model capability contract 配置，不写死厂商 model id。
  7. P-120/P-103 落地后，内建模板与 Profile UI 不再展示/依赖 cumulative Child Token ceiling；仍展示累计 token usage telemetry，并只暴露真正有执行语义的 step/iteration、depth、concurrency/fan-out 等 containment。
- **明确不做**：不引入新的 Multi-Agent framework；不新增第二套 profile storage/router；不强制所有任务 fan-out；不增加 Agent 投票/自治社会等复杂机制；不为了模板管理重新引入 Child cumulative Token budget。
- **验证**：代表性大型代码探索/资料检索任务中 root context token 或 wall-clock 至少一项改善且质量不回退；小任务不会无意义 spawn child；child context 明显小于 root context；现有自定义 profile 行为保持兼容。

## P-074 Run Completion 当前只有 `completed_unverified` 正常成功路径，已有 Tool/Plan Evidence 尚未汇总成 Completion Gate

- **优先级**：P1
- **状态**：`已完成（2026-09-17；Root 正常 stop 现在先进入 deterministic Completion Gate；Gate 只读取既有 durable Plan / ToolResult verification / ready Artifact evidence，不新增第二套 verification store；首次缺证据通过 StateCommit durable continuation 继续同一 Run，无 Tool progress 的重复 gate failure bounded 为 COMPLETION_GATE_UNSATISFIED；verified evidence 可真实落 completed + verification=verified；新增 model/completion-gate scenario，完整 Agent scenarios 21/21、Backend typecheck/build、git diff --check 全绿）`
- **完成事实**：
  1. `completionGateDecision()` 在 P-089 typed finish-reason policy 之后执行：非正常 finish reason 不会进入 Gate；正常 `stop` 才进入 completion candidate。
  2. Gate 直接消费现有 durable truth：未完成 Plan item 会阻止结束；confirmed mutation 会触发 evidence 要求；completed Plan evidence 只有在对应 Artifact 已 ready 时才可计入；Tool evidence 使用持久化 `ToolResult.verification`。
  3. 明确要求 test/build/check/verify 的 coding/mutation Run 必须具有 verified execution evidence（如 foreground `workspace_execute_argv`，或 background job 后续由 `workspace_job` 确认 zero-exit terminal result）或 durable Plan evidence；“写文件成功”或“后台 job 已接受但仍 unverified”不会被误判成无需验证。
  4. 第一次缺证据时 `continueModelStepForCompletionGate` 原子关闭当前 Model attempt/step、保留 assistant 文本、追加 bounded `system_notice(kind=completion_gate)` 与 `completion.gate_blocked` event，同时 Run/Root Runtime 保持 `running/executing`；下一轮 Context 只读取这条 durable notice，不使用 sleep/retry 或 `awaiting_input` 冒充。
  5. 若没有任何 Tool progress 又再次触发相同 Gate，直接 `COMPLETION_GATE_UNSATISFIED`，避免 completion 自循环；正常 Tool progress 会重置 Gate-block 计数并由 P-045 继续负责异常 Tool loop。
  6. 有充分 durable evidence 的 Run 现在可通过 StateCommit 正常落 `status=completed`、`goal_status=satisfied`、`verification_status=verified` 和 `verification.completed(status=verified)`；不需要外部验证的问答/解释任务仍保留 `completed_unverified`，不强制额外 Tool/模型调用。
- **验证**：`model/completion-gate` 用真实 SQLite + StateCommit 验证 unverified mutation 无测试证据时被阻止、durable continuation 保留 Root execution owner、无 progress 重复停止被 bounded、verified test evidence 后成功进入 `completed/verified`；完整 deterministic suite 21/21、Backend typecheck/build 与 `git diff --check` 通过。

## P-075 Artifact 已进入 Run/Thread durable contract，但模型没有通用读取/多模态输入路径

- **优先级**：P1
- **状态**：`已完成（2026-09-18；新增 Run/runtime-scoped Artifact read/projection、artifacts.read 下的通用 artifact_read、typed image/file ModelMessage parts 与显式 provider input capabilities；Root/Child/attachment-only resume 共用同一 Artifact authority，不复制 bytes 到 Ledger；新增 context/artifact-model-input scenario，完整 deterministic Agent scenarios 24/24、Backend/Frontend typecheck、targeted git diff --check 全绿）`
- **完成事实**：
  1. `ArtifactPort/ArtifactService` 增加 Agent 专用 `getForAgent/readForAgent`，底层仍只使用既有 Artifact object store；Root 必须命中当前 Run 的 `agent_artifact_links` 或有效 run-specific grant，Child 还必须是该 Run runtime 且 Artifact 出现在其 delegation 的 `input_artifact_refs_json`。跨 App 输入继续依赖既有 grant，不新增第二套 storage/ACL。
  2. 新增 provider-neutral `artifact-model-projection`：附件始终投影 bounded metadata（id/name/mediaType/size/hash/sourceApp/projection）；单文件最多 16 KiB、总计最多 32 KiB 的 UTF-8 文本可直接 inline；大文本/二进制继续留在 Artifact owner。文本按 bounded line range 读取（最多扫描 8 MiB、单次最多 200 行），binary 按 bounded byte range 读取（单次最多 48 KiB），UTF-8 扫描边界不会因截断半个多字节字符误报非法内容。
  3. ToolCatalog 增加通用 read-risk `artifact_read`，沿用既有 `artifacts.read` capability，提供 `metadata | text | bytes` 三种模式；Root/Child Tool execution 都复用同一 Run/runtime Artifact authority，Child 不会因为知道 UUID 就读取未委派的 Root Artifact。
  4. `ModelMessage` 增加 typed `contentParts`（image/file）；model capability resolver 增加显式 `supportsImageInput/supportsFileInput` Registry/manual override，未知能力默认 false，旧请求字段缺失不会被误写成 false override；已知 `gpt-4o` Registry 显式声明 image input。OpenAI-compatible adapter 只在 effective capability 允许时编码 native image/file part，图片不能通过 file capability 绕过 image capability。
  5. Root `ContextService` 会从 durable current input refs 构造 metadata/小文本/native part；`SubagentContextBuilder` 只有在 delegation 同时显式授予 `artifacts.read` 且列出对应 Artifact ref 时才做内容 projection。native payload 若挤压 context budget 会确定性降级为 metadata + `artifact_read`；历史 Ledger 只保留 Artifact ref，不复制大文件或 provider payload。
  6. Checkpoint/resume 的 `projectRunUserInputs()` 继续从 canonical `payload.artifactRefs` 重建输入；Context 现在允许“空文本 + Artifact refs”的 attachment-only resume，并保持 hash/source App provenance。Frontend Provider 设置也可显式查看/编辑 image/file input capability，不依赖运行时 model-name heuristic。
- **明确不做**：未把所有附件全文塞进 prompt；未绑定 OpenAI Vision/Responses 私有 durable contract；未新增第二套文件存储、Artifact 权限表或 continuation state；未让 Artifact 内容绕过 App/Run/delegation scope。
- **验证**：新增 `context/artifact-model-input` 使用真实 SQLite + `LocalArtifactStore` 验证 Root scoped text read、大文本 metadata-only + on-demand line read、Child 未委派 Artifact 暴露数为 0、unsupported image native part 为 0、显式 image capability native part 为 1、attachment-only resume 成功且 hash/provenance 一致；完整 deterministic suite 24/24，Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit` 与 targeted `git diff --check` 通过。

## P-076 Agent 缺少一等 `request_user_input` / Clarification 状态，信息不足时只能猜测、结束或等待用户主动追加

- **优先级**：P1
- **状态**：`已完成（2026-09-18；新增 Root-only request_user_input 与 durable agent_input_requests owner；专用 StateCommit 原子完成 Tool settle + clarification request + awaiting_input park，并由 appendInput 原子 answer/resume；RunSnapshot/Conversation 提供普通问题卡；重复无进展 clarification 复用 P-045 progress guard；direct cancel / app disable / backend restart 均关闭 pending request；新增 runtime/user-input-clarification scenario，完整 Agent scenarios 22/22、Backend/Frontend typecheck/build、git diff --check 全绿）`
- **完成事实**：
  1. 没有新增第二个 Run wait 状态：`awaiting_input` 继续是唯一 Run wait authority；新增 `agent_input_requests` 只持久化“正在等什么问题、由哪个 Root Runtime 提出、是否已回答/取消”的 clarification control fact，用户回答内容仍只写 canonical `user_input` Ledger。
  2. 新增 Root-only Host control Tool `request_user_input`，支持最多 4 个 bounded 问题、自由文本或有限 choices、optional recommended choice/context；问题结构在 Tool inspect、durable read 两端都显式校验。Subagent 明确不暴露该 Tool，缺失信息继续通过 Parent/Mailbox 协作。
  3. `settleUserInputRequestTool` 在单个 StateCommit transaction 中原子完成 Tool/Step settle、request 创建、ToolResult Ledger 写入、Run→`awaiting_input`、Root Runtime→`waiting_message` 与 active execution slot 释放，避免“Tool 已成功但 park 未落盘”的 crash window。
  4. `appendInput` 现在可区分 P-045 loop wait 与 clarification wait；回答先进入 canonical Ledger，再原子把 request 标为 `answered`、关联 `answer_entry_id`、唤醒同一个 Runtime 为 `runnable` 并恢复 Run=`running`。两种 wait 若同时存在必须指向同一 Runtime，否则 fail closed。
  5. `RunSnapshot.pendingInputRequest` 是 refresh/reconnect 的 authoritative projection；Conversation 展示普通 clarification card/choice，choice 只填充现有 composer，最终仍走 canonical `appendInput`，不复用 Approval Card，也不新增表单提交 API 或第二套聊天事实源。
  6. 重复相同 clarification 的 operation hash 不因 input revision 伪装成进展，继续进入 P-045 durable trajectory；达到既有 no-progress 阈值时由同一个 loop guard park。用户直接取消、App disable 或 Backend restart terminalization 都会在同一事务中把未回答 request 置为 `cancelled`，避免 terminal Run 留下孤立 requested state；Backend restart 仍遵循项目既有“中断 non-terminal Run”策略，不伪造 provider stream resume。
- **验证**：`runtime/user-input-clarification` 走真实 SQLite + StateCommit + Tool proposal/read execution 路径，覆盖 6 次 durable park、5 次回答恢复、等待/回答本身 0 个额外 model attempt、1 次 P-045 bounded pause、1 个未回答 request 随 Run cancel 关闭；完整 deterministic suite 22/22，Backend `tsc --noEmit`/build、Frontend `vue-tsc --noEmit`/build 与 `git diff --check` 通过。

## P-077 Responses + Reasoning Tool Round-trip 丢失 Provider Continuation Metadata，可能破坏无状态推理模型的连续执行

- **优先级**：P1
- **状态**：`已完成（2026-09-18；引入 provider-neutral、JSON/size-bounded ModelProviderContinuation；OpenAI Responses store:false 仅 round-trip AI SDK 暴露的 reasoning itemId + encrypted content 与 Tool item metadata，隐藏 reasoning 文本不进入产品事实；continuation 以 agent_model_attempts 为唯一 durable truth，Root Ledger 仅保存 modelStepId 引用，Root/Child Context 均按具体 model step 恢复；provider/model/configuration/protocol 变化时不复用 opaque state；migration #27；deterministic 两轮 Tool + fresh reconstruction provenance 场景与完整 Agent scenarios 23/23、Backend typecheck/build、git diff --check 全绿）`
- **完成事实**：
  1. Core 增加 `ModelProviderContinuation` envelope，只定义 `schemaVersion/providerId/modelId/configurationVersion/protocol/format/data`；`data` 必须显式 decode 为 JSON value，并受 256 KiB、深度与节点数上限约束。Core 不读取 OpenAI 私有字段，也不把 vendor metadata 当业务状态。
  2. `OpenAiProviderAdapter` 继续完全复用 AI SDK Responses stream/prompt codec：`store:false` 路径只收集 SDK 暴露的 reasoning `itemId + reasoningEncryptedContent` 与 Tool-call `itemId`，下一轮按 assistant content part/providerOptions 回放；`reasoning-delta` 不进入 Nexus `ModelEvent`、Ledger、Memory/Recall、Completion evidence 或用户展示。Chat Completions 与无 continuation 的 provider 不伪造 metadata，继续走简单路径。
  3. `agent_model_attempts.continuation_json` 是 continuation 唯一 durable truth，migration #27 为升级库补列；Root Ledger assistant payload 只增加 `modelStepId` 引用，不复制 opaque data。Root `ContextService` 与 Child tool-exchange reconstruction 都通过同一个 model-step continuation repository 恢复，因此 Tool round、Child、fresh process reconstruction 共用同一 authority。
  4. continuation provenance 绑定冻结的 provider/model/configuration version/protocol；OpenAI adapter 发现 route 不匹配时直接丢弃 opaque continuation，从 canonical text/Tool history 重建，不跨模型/协议搬运。现有 Backend restart 仍遵守“中断 non-terminal Run、不伪造 provider stream resume”的 invariant；已 durable 的历史 model round 可由 fresh repository/context 实例恢复 continuation provenance。
  5. Context accounting 把 opaque continuation 与 text/tool-call/tool-result 使用同一个 message estimator 纳入 selection/diagnostics；没有恢复累计 Run/Child Token ceiling，也没有改变 P-045 progress-aware loop guard、cancellation 或 reconciliation owner。
- **验证**：deterministic `model/provider-continuation-roundtrip` 覆盖 Responses 连续两轮 Tool round、adapter metadata extract/replay、256 KiB 上限、configuration/protocol mismatch 不复用、Chat Completions 不伪造、SQLite durable truth 与 fresh Context reconstruction；完整 deterministic Agent scenarios 23/23 通过，Backend `tsc --noEmit`/build 与 `git diff --check` 通过。本机 Node v22.17.0 仅产生仓库 `>=24` engine warning，不是产品失败。

## P-078 MCP Integration 当前只投影 Tools，尚未利用 Resources/Prompts 与长任务能力，标准协议能力存在明显缺口

- **优先级**：P2
- **状态**：`协议完备性审计确认，待与 P-063/P-066 合并设计；P-073 durable background-handle contract 已闭环`
- **当前事实**：
  - Nexus 使用 `@modelcontextprotocol/client@2.0.0`，Integration pin `2026-07-28`，并已实现 Streamable HTTP、schema refresh、`tools/list`、`tools/call`、动态 ToolCatalog contribution。安装的 Client API 本身已经提供 `listResources/readResource`、`listPrompts/getPrompt`、Tasks 与 multi-round `input_required` 支持，因此这部分不需要自研协议 codec。
  - `McpRuntimePort`/`McpAdapter` 当前仍只封装 Tool：没有把 Resources/Prompts/Tasks 暴露为 Nexus product contract，也没有把 resource/prompt metadata 作为 model-facing discovery source。
  - Tool snapshot 已保存 MCP `annotations`，但 `createMcpTools()` 完全不消费它们，当前每个 MCP Tool 都硬编码为 `riskClass: 'mutate'` / `mutation: true`；因此即使 Server 明确声明 `readOnlyHint`，普通读取也会进入 mutation approval 路径。
  - 当前 MCP Client 明确配置 `inputRequired: { autoFulfill: false, maxRounds: 0 }`。在 2026-07-28 的 multi-round-trip 语义下，需要 elicitation/input 的 Tool/Resource/Prompt 无法继续；这与 P-076 的 Agent durable clarification 正好是同一个产品能力。
  - P-063 已落地高基数 MCP Tool deferred discovery（`tool_search` + version-bound `tool_invoke` router），P-066 已有 Skill progressive disclosure，P-073 已落地 Runner durable background job + bounded status/wait/cancel；因此 MCP 扩展不应各自再造平行机制。
- **目标方向**：
  1. 第一阶段优先补 MCP **Resources metadata discovery + bounded read**，并接入与 Tool/Skill 相同的 deferred/local lexical search 思想；Resources 是远端 evidence，不直接升级为 system instructions。
  2. MCP Prompts 作为可选模板/Skill-like 内容处理：默认只索引 metadata，用户/Agent 明确选择后再 `get`；不要把全部 Prompt 常驻 system context。
  3. 对远端高基数 Tools/Resources 统一考虑 catalog TTL/schema hash/version invalidation，避免每轮全量 refresh/list。
  4. MCP Tasks 只映射为已落地 Workspace durable job contract 同类的 remote background handle：保存 server/task provenance，提供 bounded status/wait/cancel/result projection；Nexus Run/Workspace job 仍是本地 authoritative lifecycle，不复制第二套 scheduler。
  5. MCP annotations 只作为 **behavior/risk hint**：缺失/未知默认保持当前保守 mutation；只有 Integration 被用户明确标记为可信 annotation source 时，`readOnlyHint=true` 才可映射为 read-only Tool projection，`destructiveHint/idempotentHint/openWorldHint` 用于 warning/retry/telemetry。无论如何 annotations 都不能绕过 capability scope、operation hash、lease 或现有 deterministic policy。
  6. 把 2026-07-28 `input_required` 接到 P-076 的同一个 durable user-input request：MCP call park → 用户回答 → 带 opaque `requestState`/inputResponses 重试原请求；不让 SDK 在 Backend 内弹出隐式交互，也不新建 MCP 专用聊天状态。Client v2 对该协议代际已把旧 server-initiated sampling/roots 标为 deprecated，因此不再把“补 sampling/roots”当 Nexus 完备性目标。
  7. 远端 Tool/Resource/Prompt/Task result 统一经过已落地的 P-069 model-facing projection 与 Artifact spill，避免大结果直接污染 Context。
- **明确不做**：不为追求“协议全覆盖”实现 Nexus 当前没有产品用途或在当前协议代际已 deprecated 的 capability；不把 MCP annotation 当安全保证；不让 MCP Resources 变成 Memory 事实源；不让远端 Prompt 获得高于 Nexus system/user 的优先级。
- **验证**：支持 Resources/Prompts 的 MCP fixture 可 list/search/read/get 且有明确 byte/token 上限；`input_required` 可 durable park→用户回答→续回原请求；Task 可映射到 bounded wait/result 且不重复提交；高基数 MCP server 不线性膨胀基础 prompt；schema/resource 变化能 invalidation；现有 Tool invoke contract 不回退。

## P-079 Agent 缺少专门的行为/成本 Eval Harness，后续 Context/Tool 优化没有可重复质量基线

- **优先级**：P1
- **状态**：`已完成`
- **完成情况**：
  - 已建立 `packages/backend/scripts/agent-scenarios/runner.ts` 的 **Backend-level deterministic Agent scenario harness**，直接组合真实 `StateCommit` / SQLite Repository / Context / Tool / Scheduler / Collaboration / HTTP route owner，不启动浏览器、不依赖外部模型或网络。当前共有 17 个 deterministic scenario，覆盖 compaction Tool-exchange atomicity、restart recovery、app disable scope closure、read-tool batch authority、Subagent cancellation/fail-fast/join resume、mutation finalization/output projection、artifact crash reconciliation、integration CAS/refresh race、idempotency TTL、累计 Token ceiling 删除、progress-aware loop guard 与 public error taxonomy。
  - harness 已增加可编程 `ScriptedLanguageModel`，通过真实 `ProviderService → ModelStepRunner → ContextService` 消费 streamed model events；benchmark trajectory 会真实经历 `model tool call → ToolCatalog/ToolExecutor → ledger tool_result → next model step`，而不是在测试脚本中复制 Runtime state machine 或 durable truth。
  - 已增加小型 coding / operations corpus 与统一结构化指标：`task success / model steps / model calls / tool calls / duplicate read-search / input-output-cached token / verification / scenario wall-clock`。当前 deterministic baseline 为 2/2 task success、4 model steps、4 model calls、2 tool calls、0 duplicate read/search、798 input / 79 output / 456 cached tokens、2/2 verified；连续两次运行除 wall-clock 外指标完全一致。
  - P-120/P-045 的专项 deterministic trajectory 已纳入同一 runner：健康 Root/Child 在累计 1.6M token 后仍可继续 step，旧 delegation token budget columns 已删除；loop guard 覆盖 warning → `awaiting_input` → 用户输入恢复新 progress epoch。累计 token 仅保留 telemetry，不作为 completion ceiling。
  - canonical Playwright E2E 继续负责真实产品/transport 行为；本 harness 负责快速、可重复的 correctness/成本回归。后续 Problem 若引入新的 background job / completion gate / Responses continuation / finish-reason 等产品语义，必须在对应修改前向同一 harness 增加 scenario，而不是再建第二套 eval/runtime owner。
- **边界**：不使用 LLM-as-judge 作为 PR gate；默认 scenario 不调用收费/不稳定外部模型；不为 benchmark 复制生产 state machine，不把单一综合分数作为 correctness 结论。
- **验证**：`pnpm --filter @nexus-terminal/backend exec tsc --noEmit` 通过；`pnpm --filter @nexus-terminal/backend build` 通过；完整 `test:agent-scenarios` 连续两次 17/17 通过且 benchmark metrics 稳定。本机 Node v22 仅触发项目要求 Node >=24 的 engine warning，不是产品失败。

## P-080 Plugin / App 的 Tool 扩展边界在文档中存在歧义，当前实现并不支持任意 Plugin 直接注册 governed Agent Tool

- **优先级**：P2
- **状态**：`部分收口：AGENT/BACKEND architecture 已明确，SRS/traceability 仍残留 Plugin Tool contribution 歧义`
- **当前事实**：
  - `doc/AGENT.md` 与 `doc/architecture/BACKEND.md` 当前已经明确：Host-owned governed Tool implementation 属于 Core；Plugin 通过 grants / AgentDefinition / signed Skill 使用这些 capability，动态外部 Tool 主要走 MCP。
  - 但 `doc/software-requirements/requirements/agent.md` 的 `SRS-AGENT-001` 仍把 App 描述为 “AgentDefinition、Tool/Skill 与插件贡献”的隔离边界，`traceability/functional-requirements.md` 的 `FR-AGENT-014` 仍写 signed packages 可以贡献 `AgentDefinitions/Skills/tools/...`，与当前实现和 AGENT/BACKEND 规范相冲突。
  - 当前 Plugin manifest 只声明 capability/intents/agents/targets；`composePlugins()` 安装/升级时动态注册的是 AgentDefinition，Skill 从 signed package 读取；Backend/Runner Plugin worker protocol 只提供 lifecycle/storage 等受限 SDK，没有 `AgentTool` descriptor/inspect/execute registration contract。
- **目标方向**：
  1. 先统一架构文档/SRS：App 是 Tool **授权/可见性/使用** 的 scope，但 arbitrary governed Tool implementation 第一版不是 Plugin package contribution surface。
  2. 外部动态 Tool 优先通过 MCP；本地高权限 primitive 继续由 Host/Runner Core owner 提供，保持 inspect/policy/operation-hash/lease/approval contract 单一。
  3. 如果未来确有“Plugin 自定义 Tool implementation”需求，应单独设计 versioned Tool SDK/IPC、risk declaration、schema lifecycle、outcome/verification contract 后再开放，不能让 Plugin Backend target 直接塞函数进 ToolCatalog。
  4. 当前无需为了文档措辞补一个重型 Plugin Tool API；先消除误导并明确扩展路径。
- **明确不做**：不让安装包通过 dynamic import/IPC 直接获得 Host authority；不复制 MCP 已解决的远端 Tool 扩展；不为了“所有东西都可插件化”破坏现有 Tool governance owner。
- **验证**：AGENT/SRS 对 Plugin Tool 边界表述一致；官方/第三方 App 可以通过 AgentDefinition + Skill + grants + MCP/现有 Core Tool 完成功能组合；未来 Tool SDK 若立项必须有独立 Problem/contract，不依赖本条隐含承诺。

## P-082 AgentDefinition `requiredModelCapabilities` 目前只存不验，模型能力合同无法约束实际 Run

- **优先级**：P1
- **状态**：`已完成（2026-09-18；requiredModelCapabilities 收敛为 tools/image_input/file_input/reasoning typed vocabulary，legacy streaming 作为 LanguageModelPort baseline 在 manifest/durable decode 时规范化掉；Run create 与 Checkpoint/resume 共用单一 capability predicate 并冻结 requirements + resolved snapshot；Frontend 只消费 Backend compatibility matrix 禁用不兼容模型；decorative reasoningSupportsMaxTokens 从有效 schema/API/UI 删除并保留 legacy decode tolerance，reasoningMandatory 接入 Run 创建校验；Backend/Frontend typecheck、targeted git diff --check 与 deterministic Agent scenarios 28/28 全绿）`
- **完成事实**：
  1. Nexus Core 的 Agent selectable capability vocabulary 现在固定为 `tools | image_input | file_input | reasoning`；`requiredModelCapabilities` 在 manifest、definition、Frontend API 均为 typed contract。旧官方/E2E manifest 的 `streaming` 被明确视为 `LanguageModelPort` baseline：validator 与 persisted manifest decoder 可读取后规范化为零 requirement；未知任意字符串 fail closed。
  2. `model-capability-requirements.ts` 是 requirement predicate owner，并直接消费 P-054 的 resolved/frozen `ModelCapabilitySnapshot`：Tools/Image/File 对应显式 boolean；Reasoning 要求至少存在一个非 `none` effort。未知/private OpenAI-compatible model 不根据 model name 猜能力，只有 Registry / Provider live / Manual authority 实际解析出的显式事实才能满足 requirement。
  3. `RunService.create()` 在任何 durable Run 创建前校验 AgentDefinition requirements；成功时把 `requiredModelCapabilities` 与同一次 resolved `modelCapabilities` 一起冻结进 `RunDefinitionSnapshot`。缺能力直接 `MODEL_CAPABILITY_UNSUPPORTED`，不会静默切换用户选择的 Root model。
  4. Checkpoint validate/resume 使用 source Run 冻结的 requirements + capability snapshot 重新判定；Provider live refresh 不会让既有 Run 语义漂移。旧 durable Run 缺这些冻结字段时只在兼容路径回退当前 definition/current resolved model，并在成功 resume 的新 Run 上重新冻结，避免持续依赖 live truth。
  5. Runtime definition API 返回 Backend 生成的 per-provider/model/configuration-version compatibility matrix；Frontend model picker 不重写 capability predicate，只消费该矩阵。兼容模型可选；不兼容模型仍可见但 disabled，并显示缺失 capability；restore/default fallback 也只会选择兼容模型，活跃 Run 的 frozen model 不被自动替换。
  6. Provider capability contract 同批清理 decorative 字段：`reasoningSupportsMaxTokens/supportsMaxTokens` 不再进入有效 Model defaults、resolved model、Run snapshot、HTTP projection 或 Frontend UI；旧 Provider persisted row / old Run snapshot / legacy input 仍做 bounded type validation 后丢弃。保留的 `reasoningMandatory` 现在由 `RunService` 真正消费，显式/默认 effort 为 `none` 时在 durable create 前拒绝。
  7. 新增 deterministic `model/agent-definition-capability-contract`，真实组合 RunService/CheckpointService 覆盖 typed vocabulary、legacy streaming、unknown/private fail-closed、Manual > Provider live > Registry、create pre-commit rejection、frozen snapshot、checkpoint compatible/incompatible recovery、mandatory reasoning 与 decorative-field normalization；public error taxonomy 同时覆盖 `CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED`。
- **验证**：2026-09-18 本机 Node v22.17.0（仓库要求 >=24，保留 engine warning）下 Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、targeted `git diff --check` 全部通过；完整 deterministic Agent scenarios **28/28 PASS**，其中 `model/provider-live-capability-authority`、`model/provider-continuation-roundtrip`、`context/indexed-recall`、`context/skill-progressive-disclosure` 均明确回归通过。正式 release/CI 仍以 Node 24 canonical environment 为准。

## P-083 Browser Agent 只有语义 Accessibility Snapshot，没有 Screenshot / Vision fallback，视觉网页无法可靠完成

- **优先级**：P1
- **状态**：`功能完备性审计确认，待与 P-075 multimodal contract 合并设计`
- **当前事实**：
  - `BrowserGatewayPort` 与 Host Tools 当前提供 create session、navigate、semantic snapshot、click、type、close；snapshot 返回 node ref/tag/role/name/text/href 等 accessibility 结构。
  - Agent Browser 路径没有 screenshot/capture/image Artifact Tool，也没有把 Browser 页面视觉内容交给 model 的通道。
  - Accessibility tree 对普通表单/文本网页成本低且可稳定引用 node ref，但 canvas、图表、纯图片、视觉布局、二维码、部分 CAPTCHA/verification 等内容天然不可见。
- **主流实践对照**：Hermes 同样把 accessibility snapshot 作为默认低成本 Browser representation，但额外提供 `browser_vision`：需要视觉信息时截图；当前模型支持 native vision 时直接作为 image context，否则可回退辅助 vision model。这种“semantic-first, vision-on-demand”比每步截图更省 token/延迟。
- **目标方向**：
  1. 保持现有 semantic snapshot 为默认路径；新增 `browser_screenshot`/`browser_capture`（最终命名待定），从当前 Browser session 生成尺寸/byte 有界的 image Artifact，并返回 viewport/url/hash/Artifact ref。
  2. 与 P-075 共用同一个 multimodal contract：model 声明 `image_input` 时按需把该 screenshot 作为 image part；不支持 vision 时可选择用户配置的 auxiliary vision Subagent/profile，返回 bounded text observation。
  3. screenshot 只在模型明确需要视觉证据或 semantic snapshot 不足时调用；不默认每次 navigate/click 自动截图，不把 base64 长驻 Ledger/Context。
  4. Capture Artifact 遵守现有 Artifact retention/cleanup；Conversation 可以选择性展示/下载真实截图，model-facing projection 只携带必要 ref/metadata。
  5. 第一版不需要扩成全桌面 Computer Use；Browser node-ref interaction 仍是动作 owner，vision 主要补“看见什么”，后续只有评测证明需要 pixel action 才单独立项。
- **明确不做**：不让 screenshot 替代 accessibility snapshot；不在每步固定调用 vision model；不引入第三套图像存储；不把 CAPTCHA solving/anti-bot 作为 Nexus Core 必备能力。
- **验证**：canvas/chart/image-heavy fixture 能通过 screenshot + native/aux vision 获得可用观察；普通文本网页仍不新增 screenshot/model cost；截图可由 Artifact 生命周期回收；无 image capability 的 provider 继续正常使用 semantic Browser。

## P-084 Browser 底层已是 Puppeteer/CDP，但 Agent-facing 交互原语不足，常见网页工作流会卡在 scroll/keyboard/select/upload/download

- **优先级**：P1
- **状态**：`功能完备性审计确认，现有 Browser adapter 可直接扩展`
- **当前事实**：
  - `BrowserRuntimeAdapter` 已经使用 Puppeteer + CDP，并维护 page/context/session/node snapshot；因此底层并不缺成熟 Browser 引擎。
  - Host 当前只暴露 `browser_create_session / browser_snapshot / browser_navigate / browser_click / browser_type / browser_close`。
  - 没有 scroll、press/key、back/forward、select option、bounded wait、console、upload、download 等 Agent 常用 primitive；`Browser.setDownloadBehavior` 当前还明确设置为 `deny`。
  - `browser_click` 直接按 `DOM.getBoxModel` 坐标点击，不先 scroll into view，也不等待 navigation/DOM settle；`browser_type` 只支持 focus + 全选清空 + insertText，不能单独 Enter/Tab/快捷键。现有 Developer Skill 因此要求每次动作后重新 `browser_snapshot`，可靠但容易多耗 Tool step/token。
- **主流实践对照**：Hermes 等成熟 Browser Agent 同时提供 accessibility snapshot 与 scroll/press/back/console 等低层但受控的交互 primitive；关键点不是开放 raw CDP/JS，而是让模型用少量稳定动作覆盖真实网页状态机。
- **目标方向**：
  1. 在现有 Gateway 上补最小完整集：`browser_scroll`、`browser_press`、`browser_back`、`browser_select`、`browser_wait`；所有动作仍绑定 session/snapshot/node ref 或明确的 page-level bounded input。
  2. click/type/navigate/press/select 统一返回轻量 **post-action state**（至少 url/title/navigation-changed），并支持短暂 bounded settle；只有模型需要 DOM 细节时再取完整 snapshot，减少固定“动作→全 snapshot”调用。
  3. 增加 bounded `browser_console` 读取：按 cursor/数量返回 error/warn/log 摘要，适合 UI/debug 任务；不暴露 arbitrary JavaScript evaluate。
  4. `browser_upload` 只接受 Nexus Artifact ref，经 scope 校验后物化到 Browser runtime 可访问的临时文件，再绑定 `<input type=file>`；不接受任意 Backend host path。
  5. `browser_download` 只允许受控临时 download directory，等待完成并检查 size/media type 后立即写入 Artifact，返回 artifactRef；仍禁止网页把文件写到任意 Host/Workspace 路径。
  6. 与 P-083 配合：semantic snapshot 负责结构，screenshot 负责视觉；动作面补齐后仍不开放 raw selector/CDP/evaluate Tool。
- **明确不做**：不把 Browser Tool 变成无边界 Playwright/Puppeteer RPC；不允许 arbitrary JS；不因补 upload/download 引入第二套文件系统；不默认每个动作后截图或全量 snapshot。
- **验证**：无限滚动、Enter 提交、select、back navigation、文件上传、文件下载、console-error 调试等 fixture 能完成；普通表单流程 Tool step 不高于现状；所有下载转 Artifact、上传来源可追溯；旧 node ref 在 DOM 变化后仍正确 stale。

## P-085 Backend 重启当前会安全中断所有非终态 Root Run，但缺少自动 Safe-point Checkpoint / Continuation

- **优先级**：P1
- **状态**：`durability 审计确认；P-064 ContextCheckpoint 与 P-073 durable background job contract 已落地，待 recovery contract 收敛`
- **当前事实**：
  - Root `AgentScheduler` 的 queue/active state 是进程内存；Backend initialize 时不会盲目重放旧 Root execution，而是先调用 `interruptNonTerminalRuns()`，把 `created/running/awaiting_approval/awaiting_budget/cancelling` 全部转成 `interrupted`。
  - 若重启时存在 running/reconciling mutation，当前逻辑会设置 `needsReconciliation`；未执行的 approval/tool work 会被 supersede/cancel。这个行为避免了未知副作用被重复执行，是正确的保守边界。
  - Child scheduler 自身已有 durable scheduler work/reclaim，但 Root restart 会先终止对应 Run，因此也不会构成 Root 的自动 continuation。
  - Checkpoint/Resume 已实现并能冻结 context boundary/plan/evidence/recovery manifest，但 checkpoint 目前只有用户手动保存入口，没有 model/tool safe boundary 的自动 checkpoint。
- **问题**：长 coding/research/background Run 即使所有已完成动作都已 durable，在一次正常 Backend 升级/重启后仍会整体进入 interrupted，用户必须事前手动 checkpoint 才有结构化 resume source。服务端 Agent 因此缺少成熟系统常见的“安全点续跑”。
- **目标方向**：
  1. 在 deterministic safe boundary 自动生成/更新轻量 **Recovery Checkpoint**：例如 model step 已完整 commit、read batch 完成、confirmed mutation+verification 已 commit、Plan/evidence stable 后；不在 mutation outcome unknown 的窗口创建“可无脑续跑”的 checkpoint。
  2. Recovery Checkpoint 复用现有 Checkpoint owner 与已落地的 P-064 ContextCheckpoint，不新建第三套 snapshot；允许区分 user-pinned checkpoint 与 rolling auto checkpoint/retention。
  3. Backend startup 先执行现有 mutation reconciliation classification，再对满足严格条件的 interrupted Run 提供/执行 continuation：冻结 definition/provider/model/inputs/context boundary 仍有效、没有 unknown mutation、Artifact/Workspace/background job 状态可重新确认。
  4. 已落地的 Workspace background job 可能在独立 Runner 中跨 Backend restart 存活；恢复前必须先按 durable jobId 查询真实结果，不重复提交同一 operation；Runner 自身 restart 后仍以既有 journal reconcile 的 terminal/unknown 分类为准。
  5. approval/user-input 等等待状态若要跨重启保留，只在其 policy/input/config revision 仍有效时恢复；否则保持当前 supersede + 重新确认，而不是降低现有 freshness contract。
  6. UI/Ledger 明确记录 `backend_restart` 与 `continued_from_checkpoint`，让用户知道发生过恢复；continuation 失败仍落 interrupted，不隐藏错误。
- **明确不做**：不在未知 mutation 中途自动重放；不保存活跃进程/socket/lease 伪装“进程级 resume”；不复制 Checkpoint/Runner journal；不为了无缝续跑取消 reconciliation。
- **验证**：重启发生在 safe read/model boundary 时长 Run 可从最新 auto checkpoint 恢复且不重复 Tool；重启发生在 mutation outcome unknown 时仍进入 reconciliation；Runner background job 不重复提交；用户手动 checkpoint/resume 行为保持兼容。

## P-086 Root Model 只有同模型短重试，缺少用户显式配置且能力兼容的 Provider/Model Fallback Chain

- **优先级**：P2
- **状态**：`已完成（2026-09-18；用户显式 fallbackModels 在 Run 创建时按 capability contract 解析并冻结；definition.model 保留 primary，rootModelRoutes 只保存 ordered fallback snapshots；root runtime model_ref_json 是 restart-safe 当前 route；Native production path 在同 route retry exhaust 后仅对 transient/provider availability failure 原子 changeModelRoute，durable model.route_changed 与新 attempt 同事务提交；continuation_json 不跨 route 搬运；审查后完整 deterministic scenarios 31/31 PASS）`
- **当前事实**：
  - `ModelStepRunner.shouldRetry()` 会对 429/502/503/504、连接重置/超时/provider unavailable 等错误在同一冻结 model 上重试，默认最多两次；failed attempt token 也会计入 Run budget。
  - `RunDefinitionSnapshot` 只冻结一个 `ModelRef`；Agent settings 也只有默认 provider/model，没有备用链。
  - 因此 primary provider 在持续 rate-limit/区域故障/服务不可用时，Run 会在同模型 retry exhaust 后失败，即使用户已经配置其它兼容模型。
- **主流实践对照**：Hermes 当前提供显式 provider/model fallback chain，并在主模型重试耗尽或连接/服务错误后切换；这个思路适合 Nexus，但不能照搬成“系统偷偷挑模型”。
- **目标方向**：
  1. 增加 optional、用户显式排序的 `fallbackModels`；Run 创建时与 primary 一起解析并**冻结 provider/model/configuration version**，形成 deterministic route chain。
  2. 每个 candidate 必须通过 P-082 AgentDefinition/model capability compatibility；若任务需要 Tools/reasoning/image/file 等能力，fallback 不能降级这些 required capabilities。
  3. 只在明确 availability/capacity/transient/provider failure 且 primary retry 已耗尽时 fail over；参数无效、Tool schema/业务错误、用户取消等不能触发换模型。
  4. failover 必须产生 durable `model.route_changed`（最终事件名待定），记录 from/to/reason/attempt；P-077 provider continuation 不跨 provider/model 复用，下一轮从 canonical context 重建。
  5. 如果失败 attempt 已产生 transient text，先按 P-087 reset 当前 attempt presentation；尚未 durable commit 的 partial Tool proposal 不能跨 route 直接执行。
  6. 用户可完全关闭 fallback；默认不做成本/质量“智能路由”，不根据系统猜测自动切更便宜/更贵模型。
- **明确不做**：不做黑箱 model router；不静默改变用户冻结的能力/价格预期；不跨模型搬 opaque reasoning continuation；不让 fallback 绕开 Run token/step budget。
- **完成事实**：
  1. Settings `model.fallbackModels` 是唯一用户配置入口，默认空链；RunService 只冻结显式候选，按顺序去重并要求 provider enabled、model 存在且满足 AgentDefinition required capabilities，不做系统猜测/成本路由。
  2. Primary 继续冻结在 `RunDefinitionSnapshot.model/modelCapabilities`；`rootModelRoutes` 只保存 ordered fallback snapshots。`runModelRoutes()` / Native execution 组合出 `primary + fallbacks` 的 effective route chain，避免 primary 重复和 8 个 fallback 时 durable decoder 越界；运行中 Settings/Provider 后续变化不会重写既有 Run route chain。
  3. Root `agent_runtimes.model_ref_json` 作为当前 route 的 durable/restart-safe projection；Native execution 先完成当前 route 的 bounded retry，耗尽后调用 `changeModelRoute`。底层 `retryModelStepTransition` 在该 route change 事务内关闭失败 attempt、更新 runtime route、创建新 attempt并提交 `model.route_changed` / `model.retrying`；普通 `retryModelStep` 不公开 route mutation 字段，没有另建 route/attempt authority。
  4. `ModelStepRunner` 的 prepare/request 都可绑定冻结 route；fallback 使用自己的 capability snapshot。P-077 continuation authority 仍只在 `agent_model_attempts.continuation_json`，route change 新 attempt 从 canonical context 重建，不复制旧 provider continuation。
  5. Frontend Settings 已增加 fallback chain 显式选择；默认关闭（空链）。P-087 attempt identity/reset 继续负责失败 partial delta 的 presentation 隔离。
- **验证**：deterministic `model/provider-fallback-chain` 现在直接驱动 `NativeAgentBackend` production execution，覆盖 primary 三次 transient attempt 后才 fail over、exactly-one durable `model.route_changed`、runtime route persistence、fallback frozen capability decode、attempt usage/audit 与 partial transient isolation；effective route chain 断言 primary 只出现一次。审查后完整 deterministic Agent scenarios `31/31 PASS`。Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、`git diff --check` 通过；本机 Node v22.17.0 对仓库 Node >=24 仅有既有 engine warning。

## P-087 Model Stream Retry 缺少 Attempt Identity / Reset，失败 Attempt 的 Partial Delta 会与重试输出在 UI 临时拼接

- **优先级**：P1
- **状态**：`已完成（2026-09-18；agent_model_attempts 继续作为唯一 durable attempt authority；Root/Child transient delta 显式携带 attemptId/attemptIndex；Frontend 按 attempt generation replace/reset，且不依赖 model.retrying 与 ephemeral delta 的到达顺序；断线/永久 stream error 不恢复旧 partial；新增真实 StateCommit retry scenario，完整 deterministic scenarios 29/29 通过）`
- **完成事实**：
  1. `agent_model_attempts.id + attempt_index` 仍是 authoritative attempt identity。Root `beginModelStep/retryModelStep` 生成的 identity 显式传入 `ModelStepRunner.runAttempt()`；没有另建 generation durable state，也没有把 transport envelope 变成事实源。
  2. Backend transient contract 已从 generic `JsonValue` 收紧为 typed `message.delta/tool.delta` payload；两者都必须携带 `attemptId/attemptIndex`。Root message/tool delta 使用同一 identity；Child 当前实际发布的 message delta 也携带其 `beginSubagentModelStep` identity。
  3. Scheduler 保留 `eventType ↔ payload` discriminated contract，WebSocket 仍只把 transient 作为 `durability: ephemeral` 即时发送；durable replay 与 ephemeral send 的竞态没有被假定成固定顺序。
  4. Frontend event decoder 现在拒绝缺失/非法 attempt identity 的 delta，并把 durable `model.retrying` 保留为带 `previousAttemptId/attemptId/attemptIndex` 的 typed event，而不是丢成 generic snapshot signal。
  5. `AgentAppSurface` 维护当前 `streamingAttempt`：同 attempt 多 delta 继续 append；identity 改变时先清旧 partial 再消费新 delta。若新 attempt delta 先于 durable `model.retrying` 到达，后到的 retry event 只有在当前仍等于 `previousAttemptId` 时才 reset，因此不会误清较新的流。
  6. run selection 切换、transport disconnect、永久 stream error、terminal/final event 与 unmount 都清空 ephemeral presentation；重连只从 durable Run/Ledger projection 恢复，不回放旧 token delta。
  7. retry accounting / budget / final settlement 语义未改变：失败 attempt 自己的 usage 仍 durable 结算到失败 row 与 Run usage；正式 assistant Ledger 只写成功 attempt 的最终文本；P-077 continuation authority 仍在 `agent_model_attempts.continuation_json`。
- **验证**：
  - 新增 deterministic `model/stream-retry-attempt-identity`：真实 SQLite StateCommit 先提交 attempt #1，流出 partial message + tool delta 后制造 `PROVIDER_STREAM_TRUNCATED`，durable retry 创建 attempt #2，再成功完成；同时覆盖 retry event 先到/后到两种 presentation 顺序。
  - scenario 断言失败 attempt 为 `failed`、成功 attempt 为 `completed`，两次 usage 都进入既有 accounting；assistant Ledger 只有 `hello world`，不存在失败 prefix 拼接；`agent_events` 中 `message.delta/tool.delta` durable row 数为 0。
  - 完整 deterministic Agent scenarios：`29/29 PASS`，包含 `model/agent-definition-capability-contract`、`model/provider-live-capability-authority`、`model/provider-continuation-roundtrip`、`model/finish-reason-state-machine`、`runtime/restart-recovery-closure`、`context/indexed-recall`、`context/skill-progressive-disclosure`。
  - Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、targeted `git diff --check` 通过；静态扫描未发现 durable persistence 的 `message.delta/tool.delta`。当前本机仍是 Node v22.17.0，仓库要求 Node >=24，此 engine warning 仍按既有环境限制处理。

## P-088 Subagent Profile 已声明 Capability，但 Child Context 硬过滤所有 Mutation Tool，无法成为真正的 Coding Worker

- **优先级**：P1
- **状态**：`multi-agent 功能完备性审计确认，待与 P-068/P-085 Workspace contract 收敛；P-072 coding primitives 已闭环`
- **当前事实**：
  - `SubagentProfile` 当前已有 `capabilities/defaultModel/allowedModels/maxTokens/maxSteps/failureMode`，Delegation 也会冻结实际 capability/model；其中 cumulative `maxTokens` 是现状字段，已由 P-120/P-103 决定退出未来执行合同。Child Runtime、durable mailbox、shared facts、dependency/join、persistent scheduler work 都已具备。
  - 但 `SubagentContextBuilder.toolSchemas()` 当前在 capability 过滤之外又硬编码只保留 `riskClass === 'read' || 'control'`，因此 `machine_write_file`、`machine_execute_shell`、`workspace_create/control/execute` 等 mutation Tool 不会进入 Child model context。
  - 结果是即使 profile 显式声明 `machine.files.write`、`machine.shell.execute`、`workspace.runtime.*`，Child 也只能探索/读取/协调，不能独立完成实现任务；当前 profile capability 与实际 Agent Tool surface 存在语义落差。
- **主流实践对照**：成熟 multi-agent coding 一般会区分 read-only explorer/reviewer 与可写 worker；可写 worker 不能只是共享同一 checkout 无约束并发，而应有清晰的 task ownership、工作区隔离或不重叠 mutation scope，再走统一 approval/lease/verification。
- **目标方向**：
  1. 保持默认 `explore/scout/review` profile 只读；增加显式 `worker`（最终名称待定）或 profile 级 `mutationMode`，只有用户/Host 配置明确允许时才向 Child 暴露 mutation Tool。
  2. Child mutation 继续复用现有 `ToolExecutor → inspect → capability/grant → policy → approval → lease/fence → execute → verify/reconcile → StateCommit`，不得新增绕过 Root governance 的快捷路径。
  3. 并行 coding 优先给每个 mutation worker 独立 Workspace/branch/worktree 或等价隔离；若共享 Workspace，则必须限制到不重叠 resource/file scope，并让 `resourceKeys` 能表达真实冲突，而不是仅靠“大家小心别改同一文件”。
  4. Parent delegation objective/constraints 应明确 assignment boundary；Worker 完成后返回 diff/commit/artifact/test evidence，再由 Root 做整合/最终 verification。Root 不默认把 Child 的自然语言“完成了”当已验证事实。
  5. Workspace 生命周期与 P-085 recovery 对齐：Child-owned Workspace/background job 在 Backend restart/child reclaim 后必须能重新确认状态，不重复提交 mutation。
  6. P-068 的内建 profile 模板直接体现这一边界：`explore/scout/review` 默认 read-only，`worker` 显式 mutation-capable；不再让所有 profile 看起来都能用其声明 capability 实际却被隐藏过滤。
- **明确不做**：不直接删除当前 read/control filter 后让所有 Child 获得写权限；不允许 Child 绕过 approval/reconciliation；不依赖多个 Agent 在同一脏工作区“自行协调”；不引入第二套 Multi-Agent/Tool runtime。
- **验证**：read-only profile 仍无法提出 mutation；显式 worker 可在独立 Workspace 完成“改文件→测试→返回 evidence”；两个 worker 修改不重叠任务可并行，冲突任务被 resource/workspace contract 阻止或隔离；Child mutation 的 approval/lease/reconcile 事件与 Root 同样可审计。

## P-089 Model Finish Reason 只被记录未参与状态机，`length/content-filter/error` 也可能被误判为任务成功

- **优先级**：P1
- **状态**：`已完成（2026-09-17；Core 引入 provider-neutral ModelFinishReason 与共享 Root/Child modelFinishDisposition；OpenAI adapter 只使用 AI SDK unified reason，厂商 raw reason 不再进入 Core；stop/tool-calls 与实际 Tool proposal 做严格一致性校验，length/content-filter/error/other/missing/mismatch 均不得进入成功完成；因 P-077 opaque continuation contract 尚未存在，length 当前明确 fail 为 MODEL_OUTPUT_TRUNCATED，partial assistant text durable 保留但 goal=not_satisfied；deterministic model/finish-reason-state-machine + 完整 Agent scenarios 20/20、Backend typecheck/build、git diff --check 全绿）`
- **完成事实**：
  1. `ModelEvent.completed.finishReason` 已从无约束字符串收紧为 `stop | length | content-filter | tool-calls | error | other`；OpenAI adapter 仅映射 AI SDK unified reason，未知值统一为 `other`，不使用 provider raw 字符串驱动状态机。
  2. `model-finish-policy.ts` 是 Root/Child 共同 policy owner：`stop` 仅允许零 Tool call，`tool-calls` 必须真的存在 Tool proposal；reason/tool 数量不一致、missing、`other` 均 fail closed。
  3. `length → MODEL_OUTPUT_TRUNCATED`、`content-filter → MODEL_CONTENT_FILTERED`、`error → MODEL_PROVIDER_REPORTED_ERROR`。当前没有 P-077 所需 provider opaque continuation state，因此不伪造“重新提示继续”；后续若补足该 contract，可在同一 policy 上扩展 bounded continuation，而不改变“不允许 truncated satisfied”的 invariant。
  4. Root failure settle 会把 bounded partial assistant text 与 typed finish reason 一并提交 durable Ledger/event 作为诊断，但 Run 为 `failed / goal=not_satisfied / verification=failed`；不会产生 success final。Child 使用同一 disposition，truncated/filter/error child 不会作为 completed evidence 回传 Parent。
  5. StateCommit 仍只提交执行层明确给出的 terminal outcome，没有把 provider policy 下沉到 repository，也没有恢复累计 Token ceiling/`awaiting_budget`；`awaiting_input` 仍保持 P-045 loop-guard owner。
- **验证**：deterministic `model/finish-reason-state-machine` 覆盖 9 个 finish-reason/tool-count 组合，并用真实 SQLite + StateCommit 验证 `length` partial text 可 durable 保留、terminal issue 为 `MODEL_OUTPUT_TRUNCATED`、Run 不 satisfied；完整 deterministic suite 20/20 全绿，P-079 benchmark、restart/cancellation/reconciliation、P-045 loop guard、累计 Token ceiling 删除 invariant 均保持通过。

## P-090 Provider 网络策略已从产品设计移除，但 Agent Settings 仍公开可 patch 的 `providerPrivateNetworkExceptions` 死字段

- **优先级**：P2
- **状态**：`已完成（2026-09-18；Agent Settings 已删除 safety/providerPrivateNetworkExceptions schema/default/patch/frontend contract；legacy persisted safety JSON 读取时由 normalization 直接丢弃；PATCH safety 明确 VALIDATION_FAILED；Provider transport 未增加任何 private-host/SSRF policy；MCP privateHostExceptions 真实 outbound policy 保持不变；deterministic scenarios 31/31 PASS）`
- **当前事实**：
  - 当前架构与 SRS 已明确：OpenAI-compatible Provider endpoint 只做基础 URL/协议配置校验，不提供 Nexus 内建 Provider private-host exception、DNS pinning、redirect/SSRF policy。
  - 但 `AgentSettingsDocument.safety.providerPrivateNetworkExceptions` 仍存在于 Backend defaults/normalization；`AgentSettingsService.patchableSections` 仍允许 patch 整个 `safety` section；Frontend API type 也继续公开该字段。
  - 全仓没有 Provider transport consumer 读取这个 settings value，因此它既不能改变 Provider 网络行为，也没有 UI owner，是纯 decorative/dead contract。
  - MCP Integration 的 `privateHostExceptions` 是另一条真实使用中的 outbound policy：`SafeMcpFetch` 会消费它。两者不能因为字段名相似一起删除。
- **问题**：公开一个无效 settings 字段会让用户/插件误以为可以配置 Provider 私网例外，也给未来维护者留下“是不是漏接 transport”的错误暗示，容易把已经明确删除的 Provider 网络策略重新引入。
- **目标方向**：
  1. 从新 settings schema、Backend patch surface、Frontend type/UI contract 删除 `safety.providerPrivateNetworkExceptions`；如果 `safety` 没有其它字段，整个 Agent settings `safety` section 一并删除。
  2. 旧 SQLite settings JSON 读取时容忍 legacy 字段但 normalization 直接丢弃；不做复杂 migration/墓碑字段，下一次正常写入自然收敛。
  3. Provider E2E 明确验证 create/get/patch serialization 不出现 private-host exception；文档继续只陈述“Provider 没有 Nexus 内建该 policy”。
  4. MCP `configuration.privateHostExceptions` 保持现状并继续由 Integration owner 管理，避免误删真实安全边界。
- **明确不做**：不借清理死字段重新实现 Provider SSRF/private-network policy；不把 MCP outbound policy 搬到全局 Agent settings；不保留一个永远无效的兼容 UI 开关。
- **完成事实**：
  1. `AgentSettingsDocument`、默认 settings、normalization 输出与 Frontend API type 已删除整个 `safety` section；新 GET/serialization 不再暴露无效 Provider 网络例外。
  2. `AgentSettingsService.patchableSections` 已删除 `safety`，因此 PATCH `safety/providerPrivateNetworkExceptions` fail closed 为 `VALIDATION_FAILED`；旧 persisted JSON 的额外 `safety` 字段仍可读取，normalization 直接忽略并在后续正常写入时自然收敛，无 migration/墓碑。
  3. Provider transport 没有新增或恢复 SSRF/private-host policy；MCP Integration `privateHostExceptions`、`SafeMcpFetch` 与 outbound policy owner 完全保留。
- **验证**：deterministic `model/provider-settings-dead-field` 使用真实 SQLite legacy `agent_settings.value_json`，覆盖旧字段可读取但 GET/requested+effective serialization 均丢弃、removed PATCH surface 返回 `VALIDATION_FAILED`、下一次正常 write 自然收敛为当前 schema；完整 deterministic Agent scenarios `31/31 PASS`。Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、`git diff --check` 通过；仅有既有 Node v22.17.0 < repo Node >=24 engine warning。

## P-091 Nexus 已有 Email/Webhook/Telegram 通知系统，但 Agent Run/Attention 生命周期完全未接入

- **优先级**：P2
- **状态**：`已完成（2026-09-18；现有 NotificationEvent/Settings 增加 6 个 Agent lifecycle 事件；SqliteStateCommitAdapter 在事务成功后提供 durable-event observer，bootstrap AgentNotificationBridge 白名单投影到现有 NotificationService；completed/failed/interrupted、approval/input、loop/step-active-time attention 均按真实 durable transition 触发，notification failure 不回流 Run authority；无 prompt/Tool raw/credential/continuation/reasoning 泄漏，无 Token-budget 专用事件；完整 deterministic scenarios 33/33 PASS）`
- **施工前事实**：
  - Nexus 通知模块已经支持 Email/Webhook/Telegram，并通过 `NotificationEvent` + user settings 做选择性 fan-out；Auth/SSH/Settings 等模块已在使用。
  - `composeAgent()` 当前没有 Notification dependency；Agent 的 completed/failed/interrupted、`awaiting_approval`、当前 legacy `awaiting_budget`（P-120 后不再用于累计 Token；未来若保留仅对应 step/emergency fuse）以及未来 P-076 `awaiting_input/attention`，都只通过 durable Run/Host event 与 Agent UI/TaskRail 可见。
  - Frontend 已能列出 `backgroundRuns`，但页面隐藏、浏览器关闭或长任务在另一设备运行时，没有现成渠道主动提醒用户回来处理或查看结果。
- **主流实践对照**：长时间/后台 Agent 的价值依赖“可以离开再回来”；当前 Codex 等产品把 background/ongoing work 作为一等工作流。Nexus 已经有通知基础设施，因此不需要为了 Agent 再引入队列或第三方通知框架。
- **目标方向**：
  1. 给现有 `NotificationEvent` 增加少量 Agent lifecycle 事件：至少 Run completed/failed/interrupted、approval required、input/attention required；如果 P-120 后仍保留 step/emergency fuse 的人工继续入口，可投影统一的 execution-attention 事件，不保留 Token-budget 专用通知。
  2. 在 Composition/Adapter 边界做 **durable Agent event → NotificationService** bridge，不让 Agent domain 直接依赖通知模块；通知是 projection，不成为 Run authority。
  3. 只在状态真正发生 transition 时触发一次，details 使用 runId/appId/thread title/status/error summary 等 bounded metadata；不发送 prompt、Tool raw output、credential/secret。
  4. 用户继续通过现有 Notification Settings 选择 channel/event；默认是否开启沿用全局通知产品原则，不为 Agent 建第二套偏好页。
  5. Approval/input/attention-required 通知应带可导航的 Nexus deep-link metadata（若现有 channel 支持），但实际 approve/input/continue 仍必须回到认证后的 Nexus contract，不能从 webhook/email 直接执行 mutation。
- **明确不做**：不做 Agent 专用 push service；不把每个 Tool/model step 都通知；不允许通知 channel 直接批准 mutation；不要求 notification delivery exactly-once 才能让 Run 正常工作。
- **完成事实**：
  1. 现有 `NotificationEvent` 增加 `AGENT_RUN_COMPLETED / AGENT_RUN_FAILED / AGENT_RUN_INTERRUPTED / AGENT_APPROVAL_REQUIRED / AGENT_INPUT_REQUIRED / AGENT_ATTENTION_REQUIRED` 六个事件；Frontend Notification Settings 继续使用同一 `enabledEvents` 选择列表与 Email/Webhook/Telegram channel，没有新增 Agent 专用偏好存储或通知服务。
  2. `SqliteStateCommitAdapter` 新增可选 post-transaction durable commit observer。普通 event-bearing transition 只有在 `db.transaction()` 成功后才回调；`interruptNonTerminalRuns()` 与 `quiesceApp()` 这两个批量 restart/app-disable 路径也先完整提交事务，再逐 Run 投影已提交 events。observer 同步异常会被 adapter 隔离；bootstrap 对异步 projection 也 fire-and-forget + catch，因此 NotificationService/repository/channel 故障均不能回滚、阻塞或改写 Run durable state。
  3. `AgentNotificationBridge` 位于 bootstrap composition，不进入 Agent domain authority。它只消费 committed `RunEvent`：`run.status_changed -> completed|completed_unverified / failed / interrupted` 分别投影 terminal 通知；`approval.requested`、`input.requested` 投影明确 attention；`run.loop_detected` 与仍保留的 step/active-time execution fuse (`budget.increase_requested/awaiting_budget`) 都投影统一 `AGENT_ATTENTION_REQUIRED`，没有 Token/budget 专用 NotificationEvent，也没有恢复 P-120 的累计 Token ceiling。
  4. Notification details 使用显式白名单与长度边界：`appId/runId/threadId/status/threadTitle/eventId/sequence/time`，以及必要的 `approvalId/risk/expiresAt`、`requestId/questionCount`、typed `errorCode/reason/attentionKind`。bridge 不复制 arbitrary durable payload；prompt、Tool raw output、credential/secret、operation hash、Tool/runtime id、问题正文、opaque continuation、reasoning text 均不会进入通知 payload。
  5. bridge 用 bounded 4096-entry in-memory durable `eventId` set 只抑制同一进程内重复 observer callback；它不是第二套 durable event authority，也不承诺 notification delivery exactly-once。实际 channel fan-out/开关仍由 `NotificationService -> notification_settings.enabled_events` 决定；per-channel failure 继续由既有 `Promise.allSettled` 隔离，repository/settings-level rejection 由 composition projection catch 隔离。
  6. 当前 Agent surface 是全局 authenticated overlay，现有 Notification formatter/channel 没有 Agent authenticated deep-link contract，因此本条没有伪造 URL 或从 Email/Webhook/Telegram 增加可执行 action；通知提供 bounded app/thread/run identity 供用户回到 Nexus 定位，approve/input/continue 仍只能走既有认证后的 Nexus contract。
  7. 没有引入 foreground socket/presence 作为新 authority；只投影 lifecycle/attention transition，不通知 Tool/model step，因此前台正常执行不会产生 step notification storm。
- **验证**：新增 deterministic `runtime/agent-lifecycle-notifications`，先在 no-op bridge 上真实 FAIL，完成后覆盖 completion duplicate callback 去重、failed/interrupted/approval/input/loop/execution-limit 映射、敏感字段注入不外泄、generic attention 无 BUDGET/TOKEN 事件、publisher rejection 隔离、现有 `enabledEvents` 关闭时不发送、channel send rejection 不抛。`runtime/restart-recovery-closure`、`runtime/app-disable-scope-closure`、`runtime/user-input-clarification` 进一步用真实 SQLite 验证 restart/app-disable/P-076 durable transition 每次仅向 post-commit observer 投影一次。完整 deterministic Agent scenarios `33/33 PASS`；Backend `tsc --noEmit` + build、Frontend `vue-tsc --noEmit` + Vite build、Backend/Frontend 三语言 notification locale JSON parse、`git diff --check` 全部通过；仅有既有 Node v22.17.0 < repo Node >=24 engine warning。

## P-092 `/plan` 目前只显示 Durable Plan，缺少真正的 Read-only / Plan-only Run Execution Mode

- **优先级**：P2
- **状态**：`已完成（2026-09-18；新增 frozen executionMode=execute|plan，与 approvalMode 正交；plan Run 在 model surface 前仅投影 descriptor riskClass=read/control 的 Tool，已知/伪造 mutation Tool fail closed；plan_update/request_user_input 保持可用；Plan 本身作为 plan Run 输出允许含 pending implementation items；确认计划后创建独立 execute Run，复用 parentRunId 单一 lineage authority 并继承 durable Plan/goal，但重新冻结当前 policy/model/approval；现有 /plan 仍只显示 durable Plan；完整 deterministic scenarios 32/32 PASS）`
- **当前事实**：
  - Nexus 已有 typed durable `RunPlan`、`plan_update` Tool 与 `/plan` slash command；但 `/plan` 当前语义只是读取/显示最近 Run 的 Plan projection。
  - Run 只有 `approvalMode = ask | full_access`。`ask` 仍会把 mutation Tool 暴露给模型，只是在真正执行前进入 approval；它不是“只研究、绝不提出/执行修改”的 planning mode。
  - P-071 Repo Project Instructions、P-072 read/search/strict patch primitives 与 P-067 bounded Repo Map/code-intelligence 已落地；现有 plan mode 可使用这些低风险 read/navigation 能力做只读探索，mutation Tool 仍不进入 model surface。
- **主流实践对照**：Claude Code 的 `plan` permission mode 会限制为只读探索并产出可审阅计划，用户明确批准后才切换到可写执行模式；它与普通“每次写操作询问”是两个不同维度。
- **目标方向**：
  1. 增加与 `approvalMode` 正交的 `executionMode: execute | plan`（最终命名待定），在 Run 创建时冻结；plan mode 只投影 read/control Tool，mutation Tool 根本不进入 model surface。
  2. plan mode 可更新 durable Plan、读取 Artifact/Repo/Browser/MCP evidence、提出 P-076 clarification，但不得写文件、执行有副作用 shell、Browser mutation 或远端 mutation。
  3. 第一版不支持同一 Run 中途切 mode，避免重新定义 operation hash/policy/input lineage；用户确认计划后，从同一 Thread/Plan 创建一个新的 execute Run，并明确链接 `plannedFromRunId`（或等价 lineage）。
  4. `/plan` 现有“显示计划”语义保持兼容；可以新增 UI mode selector 或 `/plan start`（最终交互待定），不要把旧命令静默改成启动新 Run。
  5. execute Run 仍按 ask/full_access 决定 mutation approval；“批准计划”不等于批准后续每个 mutation，也不能替代 operation-specific approval/reconciliation。
- **明确不做**：不新增第三套 Tool runtime；不把 `ask` 重命名成 plan；不让 plan approval 自动授权未来 mutation；不为了 planning 默认多调用额外 planner model。
- **完成事实**：
  1. `RunExecutionMode = execute | plan` 已进入 CreateRun request / `RunDefinitionSnapshot` durable contract；HTTP 省略字段时默认 `execute` 保持旧行为，新 Run 始终冻结具体 mode，durable decoder 对未知值 fail closed。`approvalMode = ask | full_access` 仍独立冻结，不因 plan/execute 改写。
  2. Root model Tool surface 复用 `ToolDescriptor.riskClass` authority：`ToolCallRunner.schemas(..., 'plan')` 只投影 `read/control`，`inspect(..., 'plan')` 对 catalog 中已知 mutation/destructive Tool 明确 `PLAN_MODE_TOOL_FORBIDDEN`。因此 Machine/Workspace/ACP/MCP/Browser mutation 不进入 model schema，模型即使伪造已知 mutation call 也不能绕过；没有新增 name whitelist 或第三套 Tool runtime。
  3. `plan_update` 与 `request_user_input` 都是现有 `control + mutation=false` contract，因此 plan Run 可持续更新 durable Plan、提出 P-076 clarification，并使用现有 read/control 能力。Subagent 当前本来就只投影 read/control Tool，未形成 mutation 绕路。MCP Tool 当前 descriptor 全部仍为 `mutate`，所以 plan mode 保守排除 MCP invocation；没有把 untrusted remote annotation 提升为 Nexus read-risk authority，未来若有可信 read-only MCP Resources/contract 再由对应 owner 开放。
  4. Completion Gate 对 plan Run 使用独立完成语义：必须至少产出一个 durable Plan；Plan 中 pending/in_progress 的未来 implementation item 是计划输出，不再被误判为当前 plan Run 未完成。若 durable evidence 显示 plan Run 实际发生 mutation，则 fail closed 为 `COMPLETION_GATE_UNSATISFIED`。
  5. 第一版不支持同一 Run 中途切 mode。Frontend 提供独立 Execute / Plan only selector，active Run 显示 frozen mode；完成 plan Run 后用户切回 Execute 并提交新 Run 时发送 `plannedFromRunId`。Backend 只接受同 thread、已完成、确为 plan mode 且已有 Plan 的 source，复用现有 `agent_runs.parent_run_id` 作为单一 durable lineage，并把 source `RunPlan`（含 evidenceRefs）与 goal 作为新 execute Run 初始状态；新 Run 仍重新解析当前 Provider/Definition/Settings/Policy，并使用用户当前选择的 `approvalMode`，计划确认不等于 mutation approval。
  6. 现有 `/plan` slash command 的 parser/executor 未修改，仍是 `plan.show`，只读取并显示当前 durable Plan；没有静默改成启动新 Run。
- **验证**：新增 deterministic `model/plan-execution-mode`，先在未实现状态真实 FAIL，完成后覆盖实际 `ModelRequest.tools` 零 mutation schema、`plan_update/request_user_input/read` 可见、伪造 mutation fail closed、HTTP explicit plan / omitted→execute、durable executionMode decoder、plan Completion Gate，以及 plan→execute `parentRunId + initialPlan/evidenceRefs + goal` lineage 且 approvalMode 独立。完整 deterministic Agent scenarios `32/32 PASS`；Backend `tsc --noEmit` + build、Frontend `vue-tsc --noEmit` + Vite build、三语言 JSON parse、`git diff --check` 全部通过；仅有既有 Node v22.17.0 < repo Node >=24 engine warning。

## P-095 Machine Mutation 审批未绑定 Proxy / Jump-chain 依赖 revision，审批后路由变更可绕过 stale-operation 检测

- **优先级**：P1
- **状态**：`代码路径审计确认，属于 approval TOCTOU correctness gap`
- **当前事实**：
  - mutation Tool 在用户审批后、真正执行前会正确调用 `refreshInspection()`，并要求 refreshed `operationHash/inputRevision/policyRevision` 与审批时完全一致；这是现有 stale-approval 防线。
  - Machine target 的 `configurationHash` 来自父 Connection 的 `id/host/port/username/authMethod/proxyId/route/jumpChain/updatedAt`。父 Connection 自己被编辑（包括直接 credential 更新）会改变 `updatedAt`，因此直接 target 变化可以被 stale 检测捕获。
  - 但 `proxyId` 与 `jumpChain` 只把 **引用 ID** 放进父 hash，不包含被引用 Proxy / Jump Connection 的 `updatedAt`、configuration hash 或 credential revision。Proxy/Jump 对象可独立更新，不会同步 bump 父 Connection `updatedAt`。
  - refresh 后真正执行 `MachineCapabilityAdapter` 会调用 `SshConnectionResolver.resolveStored()`，实时读取并解密当前 Proxy / Jump Connection；所以“审批时的中间 route”与“执行时的中间 route”可以不同，而 refreshed operation hash 仍保持不变。
  - `ToolInspection.secretRefs` 虽然存在并被纳入 Tool operation-hash schema 的设计意图，但当前全仓所有 Tool 都写 `secretRefs: []`，没有任何 producer 能补上这些依赖 revision。
- **问题**：用户批准的是一个具体 target + route context 下的 mutation，但审批后修改 jump host、proxy host/port/auth/credential，旧审批仍可能执行并通过新的中间路径。最终目标 host 不一定变化，但授权事实与实际网络依赖已不一致；这正是 operation hash / reinspection 本来要避免的 TOCTOU 类问题。
- **目标方向**：
  1. 由 Connection resolver 提供 **dependency-complete machine target snapshot**：父 Connection + Proxy + 全部 Jump hop 的非秘密配置 hash/revision，并对 credential 只记录 opaque revision/hash，不把明文 secret 进入 ToolInspection/Ledger。
  2. `MachineTargetFingerprint.configurationHash` 必须覆盖整条 route dependency graph；任一 hop/proxy host/port/user/auth/credential revision 改变，都应让 refresh 后 `operationHash` 改变并触发 `APPROVAL_STALE`。
  3. `secretRefs` 若保留，就把它定义为 `{id,version}` 的真正 credential lineage，并在 refresh/execute 前验证；若 route dependency hash 已能完整覆盖 revision，则删除这个全仓永远空的字段，避免假安全抽象。不要两套半实现机制并存。
  4. execution session cache 也必须以同一 dependency fingerprint 失效；不能 operation hash 已刷新而底层仍复用旧 route/credential session。
  5. MCP/Provider credential revision 已有独立 owner，不把这条改成全系统 secret framework；第一阶段只修 Machine connection graph 的真实缺口。
- **明确不做**：不把 password/private key 明文或其可逆值写入 operation hash/Ledger；不因为最终 host 未变就忽略 route dependency；不删除 approval refresh 机制；不引入复杂 PKI/host-key 产品设计来扩大范围。
- **验证**：审批后分别修改 direct Connection、Proxy host/credential、任一 Jump hop host/credential，旧 mutation 都稳定被 supersede 为 stale 且不执行；无关 Connection 修改不影响该 operation；未变 route 的正常审批仍可执行；inspection/log/ledger 中不存在明文 secret。

## P-096 Agent Budget / Hard-limit Settings 仍包含三个“可保存但不执行”的假合同

- **优先级**：P1
- **状态**：`已完成（2026-09-18；删除 Settings soft/hard 的 context/output 假预算与 maxRawToolBytes 全链路假合同；RunBudget maxContextTokens/maxOutputTokens 保留为 frozen Model Capability projection；legacy Settings/App policy/Run budget 读时兼容并在下一次正常写入自然收敛；maxRunTokens 继续不存在；完整 deterministic scenarios 34/34 PASS）`
- **施工前事实**：
  - `hardLimits.maxContextTokens` 与 `hardLimits.maxOutputTokens` 仍存在于 `AgentSettingsDocument`、API type 与三语言 i18n，Hard-limit preview API 仍可手工提交；但当前 `HardLimitsSettings.vue.fieldGroups` 已不再渲染它们。`budget.maxContextTokens/maxOutputTokens` 也仍在 Backend/API schema 中可 patch，当前 Budget UI 已不显示。
  - 但当前 `RunService` 已明确把 `maxContextTokens = model.contextWindow`、`maxOutputTokens = min(model.maxOutputTokens, contextWindow - 1)` 视为模型物理 capability；全仓没有 `settings.hardLimits.maxContextTokens/maxOutputTokens` 的 runtime consumer。Checkpoint 同样根据当前冻结模型 capability 重建这两个值，而不是应用 Settings hard limit。因此用户修改这两个“硬限制”不会影响任何 Run。
  - `budget.maxRawToolBytes` / `hardLimits.maxRawToolBytes` 会进入 execution policy、Run budget 与 checkpoint snapshot，Frontend 还分别描述为“任务中工具调用原始传输数据累计上限 / 原始工具输出留存大小”；但 Tool executor、StateCommit、Ledger、Artifact 与 Gateway 全部没有消费 `run.budget.maxRawToolBytes`。真实生效的只有单次 model-facing `maxToolOutputBytes`。
  - 这与已闭环的 Storage/Workspace lifecycle 假合同属于同一审计类别，但职责不同：Artifact quota/TTL 已有真实 runtime owner，Workspace idle 假设置已删除；本条只处理 model/tool budget API 与现行 runtime authority 的不一致。
- **目标方向**：
  1. 删除 `hardLimits.maxContextTokens/maxOutputTokens` 这两个已经被 Model Capability authority 取代的设置、API 字段、UI 和历史文案；不要为了让旧字段“看起来有效”而重新用用户 hard limit 反向裁剪模型物理窗口。模型 capability 的补全/authority 继续由 P-054/P-082 负责。
  2. 对 `maxRawToolBytes` 先确定唯一语义。如果要保留，应定义 Run-scoped raw Tool payload accounting：明确哪些 bytes 计入（Tool input、raw stdout/stderr、MCP raw content、Browser extraction 等）、何时 spill 到 Artifact、超过预算后的 deterministic 行为，并让 Root/Child/Checkpoint 使用同一计数；如果已落地的 P-069 ToolResultProjection + Artifact-first 已足够，则直接删除该字段，避免重复 quota。
  3. Settings schema/version migration 必须能读取已有文档中的旧字段并规范化掉，不能因为删除 UI/runtime 合同导致旧用户 Settings 无法加载。
  4. 原始 Problem 文案曾把 `maxRunTokens` 视为仍有效的累计预算，但本条施工前 current worktree 已由 P-120 完成删除；P-096 只需确认 production surface 不再存在该字段，并禁止把它重新包装成另一个 hard limit。
- **明确不做**：不重新引入固定 32K/4K 一类全局 context/output ceiling；不把 Provider model capability 和 User Run budget 混成同一个 owner；不保留仅用于 UI 展示但不影响执行的“装饰性限制”；不以“成本保护”为名恢复 P-120 删除的父 Run 总 Token ceiling。
- **完成事实**：
  1. `AgentSettingsDocument.budget` 已删除 `maxContextTokens / maxOutputTokens / maxRawToolBytes`，`hardLimits` 同样删除这三项；默认值、normalization、soft→hard cap matrix、Frontend API type、Budget/Hard-limit UI 与三语言文案同步收口。当前 Budget UI 原本已经不显示 context/output，但 Backend API 仍可 patch；删除 schema 后 `AgentSettingsService.settingsPatch()` 会对这三项 fail closed 为 `VALIDATION_FAILED`，Hard-limit preview 同理。
  2. `RunBudget.maxContextTokens / maxOutputTokens` **没有删除**：它们现在只表示 Run 创建时冻结的模型物理 capability。`RunService` 继续使用 `model.contextWindow` 与 `min(model.maxOutputTokens, contextWindow - 1)`，Checkpoint resume 也只按当前允许恢复的 model capability重建这两个值；新增 regression 明确断言它们不再有 User Settings owner。
  3. `maxRawToolBytes` 选择删除而不是补一套新 quota。P-097 已把 `maxToolOutputBytes` 定义为完整 model-visible `ToolResult` 的真实输出边界，而当前系统没有独立 raw transport capture/retention authority；因此从 Settings、Hard Limits、App execution-policy override/effective、Run durable budget、Checkpoint clamp、Root/Subagent durable decoder、Frontend Run/API/UI/i18n 全链路删除。生产代码仅保留 `delete storedOverrides.maxRawToolBytes` 这一处 legacy App-policy 读兼容。
  4. Legacy `agent_settings.value_json` 可继续包含上述旧字段：`normalizeRequestedSettings()` 按当前 schema 重建并直接丢弃 extra keys，GET requested/effective 均不再暴露；下一次正常 Settings write 会自然写回当前 schema，无 migration/墓碑。Legacy App execution policy 的 `maxRawToolBytes` 在 GET 时先删除再 parse，下一次正常 replace 自然收敛；新 replace 显式提交该字段会 `VALIDATION_FAILED`。
  5. Durable Run compatibility 采用同样的 tolerant-extra 策略：`parseRunBudget()` 与 `SqliteSubagentRepository.decodeRunBudget()` 不再要求/返回 `maxRawToolBytes`，因此旧 `budget_json` 多一个旧字段仍可读，新 Run JSON 不带该字段也可读；现有 restart/subagent scenarios 全部继续通过，无 durable migration。
  6. P-096 范围内仍保留的可编辑 Run/tool/context预算均有明确 runtime consumer：`maxRunSteps`→Root/Subagent step fuse，`maxActiveExecutionSeconds`→active-time fuse，`toolTimeoutSeconds`→Root/Child Tool deadline + lease TTL，`maxToolOutputBytes`→ToolContext→`ToolExecutor.projectToolResult()`，`maxRecallItems/maxRecallBytes`→`ContextService.recall()`；对应 hard limits 继续约束 Settings/App override/Checkpoint。Artifact/Workspace lifecycle 假合同已另行闭环，不在本条重复施工。
  7. `maxRunTokens` 在 production source 继续为零引用；只保留 deterministic invalid-input fixture，确保旧累计 Token budget 不会被重新接受。没有恢复固定 32K/4K global ceiling，也没有把 Provider capability 与 User budget 混回同一 authority。
- **验证**：新增 deterministic `runtime/budget-settings-dead-fields`，先在旧 defaults 上真实 FAIL；完成后覆盖 default/legacy normalization 不暴露 3 个死字段、Settings patch/Hard-limit preview removed surface fail closed、legacy App policy raw quota 读时丢弃 + 正常 write 收敛、新 App policy raw quota reject、legacy durable Run budget extra field 可读、新 budget 无该字段可读。`model/agent-definition-capability-contract` 增加 Run context/output == frozen Model capability 断言；`boundary/durable-runtime-decode` 更新为当前 durable budget schema。完整 deterministic Agent scenarios `34/34 PASS`；Backend `tsc --noEmit` + build、Frontend `vue-tsc --noEmit` + Vite build、三语言 Agent i18n JSON parse、`git diff --check` 全部通过；仅有既有 Node v22.17.0 < repo Node >=24 engine warning。

## P-097 Mutation Tool 的输出大小校验发生在副作用完成之后，可能把已确认完成降级成 reconciliation

- **优先级**：P1
- **状态**：`已完成（2026-09-17；ToolExecutor 改为对完整 model-visible ToolResult 做 post-execution bounded projection，不再因大回包抛错；MCP/ACP/Workspace 大结果均保持 confirmed 且只执行一次，真实 transport interruption 仍为 unknown）`
- **当前事实**：
  - `ToolExecutor.executeAuthorized()` 先执行 `tool.execute()`，随后只对 `result.data` 做 `maxOutputBytes` 检查；超限直接抛 `TOOL_OUTPUT_TOO_LARGE`。
  - mutation 路径会把任何 execute exception 保守映射为 `outcome='unknown'` 并进入 quarantine/reconciliation，这避免把不确定副作用误报成失败。
  - MCP Tool 在 server 已经返回 protocol-complete result 后会构造 `ToolResult.data={content, structuredContent}`；若该 data 过大，后置大小检查仍会抛错，因此一个已收到确定响应的外部 mutation 会被改写为 unknown。
- **问题**：model-visible output budget 是“结果投影/截断”问题，不应在副作用完成并已获得确定结果后改变 mutation outcome 语义；否则大回包会制造不必要的人工 reconciliation，并让完成状态与真实外部状态失配。
- **目标方向**：
  1. 将 Tool output budget 拆成 raw capture 与 model-visible projection；执行完成后先冻结 `outcome/ok/verification`，再对可见 payload 做 bounded projection。
  2. 对 text/JSON 结果优先结构化截断并设置 `truncated=true`；必要时把完整结果保存成 Artifact，只把 summary + artifact ref 给模型。
  3. `maxToolOutputBytes` 限制整个 model-visible ToolResult，而不只是 `data`；P-096 已确认删除无 Consumer 的 `maxRawToolBytes`，当前没有第二套 raw-retention quota。
  4. 只有 transport/lease/state commit 等确实无法确认 mutation outcome 的异常才进入 `unknown/reconciliation`。
- **明确不做**：不因为结果过大重试 mutation；不把大回包静默丢失；不降低现有 unknown-outcome fail-closed 行为。
- **验证**：MCP/ACP/Workspace mutation fixture 返回超大 payload 时，副作用只执行一次、Run 保持真实 confirmed outcome、模型只看到 bounded/truncated result；真正的 transport interruption 仍进入 reconciliation。

## P-098 Mutation 已确认后若 Lease settle/release 失败，会产生不可见且无法从 UI/API 解除的 Resource Quarantine

- **优先级**：P1
- **状态**：`已完成（2026-09-17；confirmed mutation 的 Lease finalize 结果显式返回，失败时 StateCommit 标记 reconciliation；mark-settled/release 故障注入、resolve 解隔离、无 mutation 重放及三语言 UI 文案均验证通过）`
- **当前事实**：
  - Root mutation 顺序是 `side effect -> durable settleMutationTool() -> confirmMutation()`；因此外部结果 confirmed 时，Tool/Run 的 durable result 会先落盘。
  - `AgentMutationLeaseGuardAdapter.confirm()` 若 `markMutationSettled()` 或 `release()` 失败，会创建 `LEASE_STATE_UNCERTAIN_AFTER_MUTATION` quarantine，但内部 catch 会吞掉异常，不把失败返回给 caller。
  - 这条路径不会设置 `agent_runs.needs_reconciliation=1`。`RunRepository.reconciliation()` 虽能查到 quarantine resources，但 `required` 仅取该 flag；Frontend 只有在 `needsReconciliation=true` 时才加载/显示 reconciliation，`resolveRunReconciliationTransition()` 也明确拒绝 flag=false 的 Run。
  - quarantine 会阻止后续 write lease，因此同一资源之后的 mutation 会持续得到 `RESOURCE_QUARANTINED`，却没有正常产品入口解除。
- **问题**：lease bookkeeping failure 不应把已经确认的外部 mutation 改写为 unknown，但也不能产生一个 durable、阻塞未来写入、却不进入可见恢复状态的 quarantine。
- **目标方向**：
  1. 将 confirmed mutation 的“业务 outcome”与“lease finalization health”分开建模；外部 outcome 保持 confirmed。
  2. `confirmMutation()` 必须向 caller 返回 lease-finalization 结果；失败时通过 StateCommit 原子设置 `needsReconciliation`（或专门的 infrastructure reconciliation 状态）并发布 durable event/host wake。
  3. reconciliation API/UI 必须能展示并解除这类 quarantine；文案明确“副作用已确认，待修复/核验的是 lease/resource state”，避免误导用户重做 mutation。
  4. 修复后仍禁止自动重试原 mutation；只处理资源 quarantine 与 stale active lease。
- **验证**：注入 `markMutationSettled` / `release` DB failure 后，Tool 仍显示真实 confirmed outcome，但 Run 明确进入可恢复 attention state；UI 能看到 resource/reason 并完成 resolve；resolve 后新 mutation 可正常获取 write lease，原 mutation 不会再次执行。

## P-099 Checkpoint 的 Workspace / Evidence Artifact 恢复合同没有 producer，Retained Workspace 无法被新 Run 继续使用

- **优先级**：P1
- **状态**：`本轮 Workspace/Artifact 矩阵确认`
- **当前事实**：
  - `CheckpointSnapshot` 已定义 `evidenceRefs` 与 `workspaceArtifactManifestRefs`；保存时分别读取 `agent_artifact_links.role='evidence'` 和 `agent_workspaces.retained_manifest_ref`，resume 时再把这些 ref 附到新 Run。
  - 全仓当前没有任何 `role='evidence'` 的 link writer，也没有任何 `retained_manifest_ref` writer，因此这两个 checkpoint collection 目前天然为空。
  - Workspace 可在创建时设置 `retained=true`，cleanup 会跳过 retained Workspace，但 retained 只代表“不清理当前 runtime”；没有生成可移植 manifest/artifact。
  - Workspace Tool 明确要求 `workspace.runId === context.runId && workspace.agentRuntimeId === context.agentRuntimeId`。Checkpoint resume 会创建全新的 Run/runtime，因此旧 retained Workspace 不能被 resumed Run 直接使用。
  - resume 当前也没有 manifest→Workspace restore/import 路径；即使未来手工写入 `workspaceArtifactManifestRefs`，现有实现也只把它们当作 input Artifact ref，并不会重建 coding Workspace。
- **问题**：Checkpoint 表面冻结了 Workspace/Evidence 恢复字段，但真实执行链没有生产和恢复 owner。长 coding Run 即使能保存 checkpoint，也不能凭该 checkpoint 恢复工作目录/变更证据；这会直接限制 P-085 的自动 safe-point continuation。
- **目标方向**：
  1. 定义唯一的 Workspace snapshot/manifest owner：safe checkpoint 时将需要跨 Run 延续的 Workspace state 输出成 versioned Artifact manifest（至少包含 source workspace/generation/profile、repo/worktree identity、content/change snapshot refs、toolchain/runtime digest）。
  2. `retained=true` 与“可 checkpoint/resume”不要混为一谈：retained 继续表示 runtime retention；checkpoint manifest 表示 durable/portable state。
  3. resume 时根据 manifest 创建/恢复新 Run/runtime 所属 Workspace，恢复成功后再开放 Workspace Tool；不能绕过现有 run/runtime ownership 检查去共享旧 Workspace。
  4. Tool/verification 产生的 durable Artifact evidence 必须原子建立 `role='evidence'` link，Plan/Completion Gate 引用前验证 Artifact ownership/status；Checkpoint 只收集真实 linked evidence。
  5. P-088 的并行 mutation worker 若采用 worktree/独立 Workspace，同样复用该 manifest contract，不另造 Subagent snapshot 格式。
- **明确不做**：不让 resumed Run 直接夺取旧 runtime 的 Workspace ownership；不把整个 Workspace 二进制目录无条件打包进每个 checkpoint；不把任意字符串 evidence ref 当成已验证 Artifact。
- **验证**：coding fixture 修改文件→safe checkpoint→终止 source Run→resume 后在新的 Run/runtime Workspace 中看到相同受控工作状态；manifest 缺失/损坏时 fail closed；linked evidence 能被 checkpoint 保护并在 resume 后读取；未 linked Artifact 不会被误当 durable evidence。

## P-100 Artifact Store 的文件系统与 SQLite 两阶段写入缺少 Crash Reconciliation，可留下永久 staging/deleting 与 quota 漂移

- **优先级**：P1
- **状态**：`已完成（2026-09-17；LocalArtifactStore 统一 finalizeReady/finalizeDeleting 与 bounded reconcile，startup/周期 lifecycle sweep 接线；rename/ready、deleting/fs.rm 两侧 crash window、过期 staging 与重复 reconcile 幂等场景通过）`
- **当前事实**：
  - `begin()` 会先把 `declaredBytes` 加到 `agent_quota_usage.reserved_bytes`，再创建带 `expires_at` 的 `staging` row。并发上传计数只统计 `expires_at > now`，所以过期 staging 不再占 upload slot，但 reservation 仍会继续占 hard quota。
  - upload `write()` 在临时文件完成后先 `rename(tmp -> objects)` 并 fsync directory，随后才在 SQLite transaction 中把 Artifact 从 `staging` 改成 `ready`、把 reserved quota 转为 used quota。
  - `renamed=true` 后若 SQLite transaction 抛错或进程崩溃，catch 不会调用 `releaseStaging()`；object file 已存在，但 DB 仍可能是 `staging`、reserved quota 仍占用。即使没有进入 rename crash window，客户端在 `begin()` 后弃传/进程退出也会留下过期 staging；`releaseStaging()` 只在后续 `write()` 发现过期或显式 `delete()` 时调用，没有 startup/background expiry owner。
  - staging 对应的 `tmp/*.part` 同样没有 restart reconciliation；`storageSummary()` 会把所有未 deleted staging 的 reservation计入 staging/reserved，包括已经过期的 row。
  - delete/cleanup 先把 row 标记成 `deleting`，然后删 object file，再用第二个 DB transaction 改成 `deleted` 并扣 used quota。若删除文件后 DB transaction 失败/崩溃，row 会停在 `deleting`。
  - 普通 `delete()` 的 mark 阶段只接受 `ready/unavailable`，因此已经卡在 `deleting` 的 row 不能通过同一 API 重试；全仓也没有 startup `deleting/staging` reconciler。`storageSummary()` 还会把 `deleting` 算进 total bytes，而 `agent_quota_usage.used_bytes` 继续保持旧值。
  - schema 已有 `ai_artifacts_gc(status, retained, expires_at)` 索引，具备 bounded status/TTL sweep 的基础；当前 lifecycle sweeps 只处理 Approval expiry 与 Workspace command reconciliation，没有 Artifact owner。
- **问题**：文件系统与 SQLite 无法形成单一事务是正常的，但当前没有 journal/reconciliation 来闭合 crash window。结果可能是 orphan object、永久 reserved quota、永久 deleting row、Library/Storage summary 漂移，最终阻塞新 Artifact。
- **目标方向**：
  1. 把 `staging -> ready` 与 `ready -> deleting -> deleted` 明确定义为可重放状态机，并在 Backend 启动/周期维护时 reconcile 非终态 Artifact。
  2. upload commit 必须能根据 DB row + tmp/object existence + expected size/hash 幂等完成或回滚：object 已存在且完整则 finalize ready；不完整/过期则清文件并释放 reservation。
  3. deleting reconciliation 以“目标状态是 deleted”为准：file 已不存在时直接 finalize DB/quota；file 仍存在则重试删除，再 finalize。所有 quota 变更必须幂等，不能重复扣减。
  4. storage summary/cleanup 要明确是否展示 repairing state；至少不能让用户只能看到一个永远无法操作的 `deleting` Artifact。
  5. Artifact TTL sweep 已复用这套 durable transition/reconciler：只把到期且无 protection 的 row 标记 `deleting`，再走既有 finalize/reconcile；不得回退成直接 `fs.rm` + 改表。
- **明确不做**：不要求文件系统与 SQLite 变成分布式事务；不靠人工删目录/改 quota 表作为正常恢复；不在 crash 后静默把未知文件当 ready。
- **验证**：在 rename 后/ready DB commit 前、mark deleting 后/fs.rm 前、fs.rm 后/deleted DB commit 前分别注入进程终止或 DB failure；重启后状态自动收敛，quota 与磁盘一致，无永久 staging/deleting/orphan，重复 reconcile 幂等。

## P-101 嵌套 Subagent Join 的 Durable 唤醒依赖 Completion Mailbox，发送失败可让 Parent 永久停在 `joining`

- **优先级**：P1
- **状态**：`已完成（2026-09-17；child terminal/cancel 事务创建幂等 join_resume，执行时重算 join；嵌套与 Root parent、epoch reset、mailbox 独立性场景通过）`
- **当前事实**：
  - `join_subagents` 在条件未满足时返回 `ready=false`；Child runtime 的 Tool settle 会把 delegation 设为 `waiting`、runtime `schedule_state='joining'`，且不会留下新的 `model_step` work。
  - child delegation 结束后 `SubagentParticipantExecutor.sendCompletion()` 会发送一条 durable completion mailbox message；`sendMessage()` 会顺带创建/唤醒 recipient 的 `consume_inbox` work，并把 `joining` runtime 改回 `runnable`。
  - 但 completion mailbox 明确以 `.catch(() => undefined)` / 仅日志方式隔离失败。之后 `resumeParent()` 对 Root parent 会显式 `enqueueRootRun()`；对本身也是 Subagent 的 parent 却只调用 `wakeChildScheduler()`，不会创建 durable work，也不会修改其 `joining` 状态。
  - `SchedulerWorkKind` / DB CHECK 已声明 `join_resume`，但全仓没有创建这种 work 的 producer，因此它目前不能作为 mailbox 之外的 join completion wake path。
- **问题**：嵌套 delegation 的控制流正确性不应依赖“通知型 completion message 必须成功”。一次 DB/idempotency/mailbox 状态错误即可让 child parent 在所有 children 已终态后仍永久 `joining`，scheduler wake 也没有 queued work 可 claim。
- **目标方向**：
  1. child terminal transition 与 parent join wake 必须有独立的 durable control path；优先真正实现 `join_resume`（或等价 work），由 child settle transaction/紧邻的可重试 owner 根据 parent runtime + join condition enqueue。
  2. completion mailbox 继续作为模型可见协作消息，但不再承担 scheduler correctness；消息失败只影响 context 信息，不影响 parent 被重新调度。
  3. wake 应幂等：多个 children 同时 terminal 只能产生可去重/可合并的 parent resume work，并在执行时重新 `pollJoin()`，不能假设最后一个通知一定对应最终条件。
  4. Root 与 Child parent 采用同一 durable wake invariant，避免两套不同可靠性等级。
- **明确不做**：不通过无限轮询 `joining` runtime 掩盖缺失 work；不把 completion mailbox 改成不可失败的跨模块事务；不依赖进程内 scheduler wake 作为 durable signal。
- **验证**：两层以上 delegation fixture 中注入 completion mailbox send failure，child terminal 后 parent 仍出现 durable resume work、重新检查 join 并继续；重启/重复 terminal wake 不产生重复 model step；正常 completion message 仍可进入 mailbox/context。

## P-102 Subagent Cancel / FailFast 不会中止已 Claimed Worker，可留下同 Owner Epoch 的永久 `claimed` Work

- **优先级**：P1
- **状态**：`已完成（2026-09-17；claimed work 随 delegation 原子取消，runtime 精确 Abort，迟到 settle 幂等，same-epoch orphan recovery 与 failFast sibling/descendant 场景通过）`
- **当前事实**：
  - `cancelTree()` / failFast sibling cancellation 最终调用 repository `cancelDelegation()`；它会把 delegation 标 `cancelled`、runtime 标 `stopped/finished`，但只把 `agent_scheduler_work.status IN ('queued','waiting')` 改成 `cancelled`，不会处理已经 `claimed` 的 work。
  - `SubagentScheduler` 的 in-memory `AbortController` 以 work id 保存；当前只暴露整 Run 的 `cancel(runId)`，没有按 delegation/runtime/work 取消的入口，因此 repository 层 cancellation 不会 signal 已在执行的 model/tool worker。
  - 已 claimed worker 若之后正常返回，会进入 StateCommit；此时 delegation 已经是 `cancelled`，多条 settle transition 要求 delegation 为 `running`，会抛 `DELEGATION_STATE_CONFLICT`。scheduler 顶层只记录异常并从 `active` map 删除，没有把该 work settle/cancel 回 DB。
  - `resetClaimedWork(ownerEpoch)` 只在 scheduler initialize 时执行，并只重置 `owner_epoch IS NULL OR owner_epoch <> 当前 epoch` 的 claimed work；同一进程、同一 owner epoch 下由上述竞态留下的 work 不会被周期扫描回收。
- **问题**：用户 cancel 或一个 failFast child 失败后，被取消 sibling 仍可能继续消耗模型时间/token；更严重的是完成时的状态冲突可留下永久 claimed scheduler row，使 runtime/work projection 直到 Backend 重启才有机会恢复。
- **目标方向**：
  1. Subagent cancellation 需要统一的 scheduler cancellation owner：durable cancel transition 后，按 runtime/work id 通知当前 scheduler abort 对应 active controller；不存在本机 active worker时仍由 DB 状态保证后续不可 claim。
  2. claimed work 的取消必须可原子/幂等 settle 为 `cancelled`，或引入 cancellation requested/fence，使迟到 worker 无法提交业务结果但能安全完成 work cleanup。
  3. scheduler 增加本 epoch 的 orphan claimed recovery 条件（例如 active map 不含该 work 且超过 bounded heartbeat/updatedAt），而不是只能等待下一次进程启动换 epoch。
  4. model/tool transport 收到 abort 后仍按现有副作用语义处理；未来 P-088 worker mutation 启用前尤其必须保证 mutation 不能被“逻辑取消但物理继续”。
- **明确不做**：不靠删 claimed row 强行恢复；不把 cancel 等同于 unknown mutation；不因为当前 Child 默认只读就忽略该状态机缺口。
- **验证**：运行中的 child model step、read Tool step、failFast sibling 分别在 claimed 后取消，AbortSignal 能触发；work 最终为 cancelled/terminal，不留同 epoch claimed 孤儿；迟到结果不能复活 delegation；无需 Backend restart 即可继续调度其它 child。

## P-103 Subagent Future Token / Step Reservation 与真实执行不一致；应删除累计 Token Ceiling，保留局部 Iteration / Fan-out 控制

- **优先级**：P1
- **状态**：`已完成（2026-09-17；Child cumulative maxTokens/reservedTokens/reservedSteps 已从 API/type/SQLite schema/执行判断彻底删除，usage.tokens 仅保留 telemetry；Child 只受 local maxSteps + 父 Run step/time emergency fuse + physical context/output 限制；>旧累计 Token 阈值仍可开始下一 Child step 的 deterministic scenario 通过）`
- **当前事实**：
  - 现有 delegation 创建会从父 Run `maxRunTokens/maxRunSteps` 中扣除 active delegation 的 future `reservedTokens/reservedSteps`，但 Root 后续 model/tool execution 完全不看这些 reservation，因此所谓“预留”并不能阻止 Root 抢占额度。
  - Step 侧最终仍由 StateCommit 的 `run.usage.steps < maxRunSteps` 挡住，所以不会静默越过全局 step fuse，但 Child 可能在自己仍有 `reservedSteps` 时被父 Run hard fuse截断。
  - Token 侧更严重：Child settle 会把 usage 合并进 Run，但没有全局 `maxRunTokens` settle check；这在**当前实现**里可让 Run usage超过冻结 hard budget。若单独修它，需要一套复杂的 Run-scoped token reservation authority。
  - P-120 已决定移除父 Run `maxRunTokens` 作为执行 ceiling，因此上述“Run token oversubscription”不应通过新建全局 token allocator修复；否则会先实现一套即将删除的预算体系。
  - `SubagentProfile.maxTokens/maxSteps` 当前同时存在，但两者不是同一种约束：`maxSteps` 可以直接表达“这个 worker 最多运行多少 agentic iterations”；`maxTokens` 则把不同模型、cache rate、context size 与 provider计量方式混成一个累计停止条件。
- **外部对照（2026-09）**：
  - Hermes Delegation 对每个 Child 使用独立 `max_iterations`，并另外限制 `max_concurrent_children/max_spawn_depth`；默认没有 Child wall-clock timeout，也没有公开的 per-child cumulative token ceiling。其 Context 由 Child 自己 compaction，真正 stuck 由 activity/loop 机制处理。
  - Codex 当前 multi-agent 配置主要提供 spawned-agent concurrency、depth、child model/reasoning effort；没有把 per-child cumulative token budget作为常规 Agent 配置。
  - Claude Code custom subagent 暴露 `maxTurns`；公开问题也显示达到该值时 Child 会被停止。其 subagent配置没有等价的累计 token budget字段，单次 API `max_output_tokens` 属于模型调用物理限制而不是任务累计预算。
  - Goose 的 recipe/subagent同样以 `max_turns` 控制 worker，默认主 recipe 1000 turns、subagent 25 turns；仍不是累计 Token ceiling。
  - OpenHands 是少数同时提供 `max_iteration_per_run` 与可选 `max_budget_per_run`（金额）的实现；后者属于显式成本治理，更适合无人值守/批任务，而不是用 Token 数作为“是否还能正常做任务”的能力边界。
- **目标方向**：
  1. **P-120 先落地**：父 Run 移除 cumulative Token ceiling、remainingRunTokens/budget-wait/token-increase path 后，再删除 delegation 对父 Run token pool 的 reservation 逻辑。
  2. Child 的累计 `maxTokens/reservedTokens` 从默认执行合同删除；`usage.tokens` 继续完整累计并展示，用于成本/benchmark/cache telemetry，不参与“还能不能继续”的判断。
  3. Child 保留 `maxSteps/maxIterations` 作为 delegation-local emergency backstop，但默认值应足够宽松，并由 P-045 的 progress-aware loop guard优先处理真正异常；达到 step limit 时返回明确 `partial/max_iterations`，允许 Root拆分、续派或接管，而不是伪装成功。
  4. 并发与递归继续用 `maxConcurrentChildren/maxDepth`（现有能力若命名不同则复用现有 owner）；对 Subagent spawn 采用 P-045 的 per-turn/per-epoch fan-out cap，防止模型一轮无限扩散。
  5. Context/输出只受各 Child 模型的 physical `contextWindow/maxOutputTokens` + 已落地的 P-064 compaction控制；不要用累计 Token 数限制 Child 长任务。
  6. `reservedSteps` 若只用于承诺未来 step pool且无法真正兑现，则删除 future reservation语义；每个 Child 开始 step时只原子检查自己的 local iteration limit + 父 Run emergency fuse即可。
  7. 如果未来确实需要 unattended cron/batch 的**成本保护**，另设计显式 optional cost ceiling（优先按 Provider actual cost/金额，且放在 automation/job policy 层），不要恢复 Core Agent 的 cumulative token ceiling。
- **明确不做**：不实现新的 Run-wide Token reservation ledger；不保留 Child cumulative `maxTokens` 仅为了“看起来有保险”；不让 Root 因某个 Child累计 Token耗尽而整体 `awaiting_budget`；不取消 Child 的 iteration/concurrency/depth/loop backstop；不靠串行禁用 Subagent 回避并发。
- **验证**：父 Run 和 Child 都可稳定超过旧累计 Token阈值继续工作；多个 Child 的 total token只作为 telemetry累加；每个 Child仍受 local iteration/fan-out/depth约束；一个 Child达到 iteration limit只返回 partial/stop reason，不阻断 Root/peer；deterministic loop会由 P-045 在远低于宽松 iteration backstop前拦截；Context compaction后 Child可继续工作且 cumulative usage不重置。

## P-104 Subagent Mailbox TTL 没有 Sweep Owner，且 Runtime Read 会继续投影 Expired Message

- **优先级**：P1
- **状态**：`本轮 Subagent mailbox lifecycle 矩阵确认`
- **当前事实**：
  - `MailboxService.send()` 接受 `ttlSeconds` 并持久化 `expires_at`；repository 也提供 `expireMessages()`，可把 `accepted/delivered` 改成 `expired`。
  - 但全仓没有任何 runtime/scheduler/startup owner 调用 `MailboxService.sweepExpired()`；该方法目前只是未使用的 service API，因此消息不会自动过期。
  - 即使显式执行 sweep，`readMessages()` 也只按 `recipient_sequence > after` 查询，不过滤 `status` 或 `expires_at`；它会返回 expired/consumed row，并只把当次 `accepted` 改成 `delivered`。
  - `SubagentContextBuilder` 直接使用 `readMessages()` 的结果生成 mailbox context，序列化时没有携带 message status；模型因此无法知道一条消息已经过期，TTL 对 model-facing delivery 实际不起作用。
  - `consumeMessages()` 依赖完整连续 sequence，这要求 expired row 仍参与 watermark 推进；因此正确修法不能简单物理删除过期消息。
- **问题**：调用方显式设置的协作消息 TTL 没有执行语义。陈旧 request/progress/evidence 可能在很久以后仍进入 Child Context，导致过时指令重新影响任务；同时 API status 与实际 delivery 行为不一致。
- **目标方向**：
  1. 定义 Mailbox lifecycle owner：scheduler 周期/Run wake/startup 以 bounded batch 扫描到期消息，或在 read 时原子 lazy-expire；不要求高频后台线程。
  2. Runtime inbox read 只返回当前可投影的 `accepted/delivered` 且未过期消息；expired/consumed row 保留在 durable log 中用于 sequence continuity/audit，但不再进入模型 context。
  3. consumption watermark 必须允许跨过 expired sequence：repository 根据连续持久化 rows 验证 gap，同时只把 live message 改 consumed，避免 expired row 永久卡住 cursor。
  4. `consume_inbox` work 到 deadline 后也要能终态清理，不能留下无意义 wake；completion control message 是否允许特殊 TTL/保留策略要显式定义。
- **明确不做**：不物理删除消息来实现 TTL；不重新使用 sequence 编号；不让模型自行根据时间戳判断“是否应该忽略”。
- **验证**：短 TTL fixture 到期后消息仍存在于历史/API 且 status=expired，但 Child context 不含该 body；cursor 可安全跨过 expired row；restart 后 TTL 语义一致；未到期消息仍按原顺序 delivery/consume。

## P-105 Integration Update / Remove 在 Version CAS 之前先撤销 MCP Runtime，失败请求会改变仍有效 Integration 的运行态

- **优先级**：P1
- **状态**：`已完成（2026-09-17；update/remove 改为 durable CAS 成功后才撤 MCP session/Tool contribution；stale conflict 零 runtime side effect，成功切换与 refresh failure→schemaHash=null→syncEnabled retry 场景通过）`
- **当前事实**：
  - `IntegrationService.update()` 先读取 current integration，随后立即 `mcp.close(integrationId)` + `hooks.removed(scope, integrationId)`，最后才调用 repository `update(... expectedVersion ...)`。
  - `remove()` 同样先 close session / remove ToolCatalog contribution，再用 `expectedVersion` 删除 DB row。
  - repository update/remove 正确使用 optimistic version CAS；若调用方持有 stale version，会抛 `INTEGRATION_VERSION_CONFLICT`，数据库中的旧 integration 仍保持 enabled/有效。
  - 但前置的 runtime side effect 已不可回滚：MCP session 已关闭、动态 Tool contribution 已删除；失败请求因此会让持久化状态与当前 Tool surface 不一致，直到后续 `syncEnabled()` / refresh 才可能恢复。
- **问题**：一个按合同应为“无副作用的 version conflict”请求会破坏现有 Integration 可用性。并发 Settings/UI 更新、重复 tab 或 stale API client 都可以触发，且错误响应本身无法说明运行态已经改变。
- **目标方向**：
  1. lifecycle mutation 先完成 durable CAS，再根据成功后的新状态执行 runtime reconcile；失败 CAS 不得触碰现有 session/contribution。
  2. runtime reconcile 使用幂等的 `reconcileIntegration(previous,next)` 思路：成功 update 后关闭旧 session、撤旧 schema、按新 enabled/config refresh；成功 remove 后再 close/remove。
  3. 若 durable commit 成功但 runtime reconcile 失败，integration 应进入显式 degraded/refresh-needed 状态或至少保持 schemaHash=null + 可重试 owner，不能回滚 durable version。
  4. HTTP/API conflict E2E 必须验证 ToolCatalog 仍保留旧有效 contribution，而不只断言 409。
- **明确不做**：不为了原子性把远端 MCP 网络调用塞进 SQLite transaction；不在 CAS 失败后偷偷 refresh 来掩盖 ordering bug。
- **验证**：stale update/remove 请求返回 conflict 后，旧 integration version、session/tool surface 仍可正常 invoke；成功 update/remove 后 runtime 才切换；注入 reconcile failure 时状态可观测并可重试。

## P-106 MCP Refresh 的 Schema Hash 回写没有 Integration Version CAS，旧 Refresh 可覆盖新配置并注册错代 Tool Schema

- **优先级**：P1
- **状态**：`已完成（2026-09-17；schemaHash 回写绑定 exact version+credentialRevision CAS 并返回同代 IntegrationView，per-integration refresh 串行化；v1→v2 barrier 与 credential 更新竞态均验证 stale snapshot 不发布 ToolCatalog）`
- **当前事实**：
  - `IntegrationService.refresh()` 先 `get()` 得到某一 integration snapshot，基于其中的 `version/credentialRevision/config` 建立 session、`listTools()` 并计算 schemaHash。
  - repository `updateSchemaHash()` 只按 `(integrationId,userId,appId)` 更新，没有 `expectedVersion` / `credentialRevision` 条件，也不会 bump version。
  - 因此 refresh(v1) 在网络等待期间若 concurrent update 成功到 v2（该 update 会 `schema_hash=NULL`），迟到的 refresh(v1) 仍可把 v1 schema hash 写进 v2 row。
  - refresh 随后重新 `get()` 得到 v2 integration，却调用 `hooks.mcpRefreshed(scope, updatedV2, snapshotV1, schemaHashV1)`；动态 Tool contribution 因而使用 v1 descriptors/schema，但执行时 `currentIntegration()` 看到 v2 row 且 schemaHash 已被旧 refresh 写成 hashV1，会通过 stale 检查并对 v2 endpoint/credential 发起调用。
- **问题**：Tool name/input/output schema 与真正执行的 endpoint/credential/configuration 可以跨版本错配。这既会造成模型按旧 contract 调新 server，也破坏 schemaHash 原本承担的 stale-tool 防线。
- **目标方向**：
  1. `updateSchemaHash` 必须带 `expectedIntegrationVersion + expectedCredentialRevision`（或完整 refresh generation）做 CAS；不匹配时 refresh 结果直接丢弃，不注册 Tool contribution。
  2. refresh hook 必须只接收与 snapshot 同一 generation 的 IntegrationView；禁止“重新 get 最新 row + 复用旧 snapshot”的混代组合。
  3. concurrent refresh 去重/序列化到 integration id；较旧 generation 完成时不能覆盖较新 generation。
  4. update 成功后 `schemaHash=null` 是 authoritative stale 标记，只有针对该 exact version 的成功 refresh 才能填回。
- **明确不做**：不以最后完成者覆盖为准；不靠 remote tool invoke 失败来发现 schema 错代；不把 schema hash 从 stale guard 中删除。
- **验证**：用 barrier fixture 让 refresh(v1) 卡在 listTools、并发 update 到 v2 后再放行 v1；最终 row 保持 v2 schema null/由 v2 refresh 写入，ToolCatalog 不出现 v1 descriptor；credential-only 更新也覆盖同一竞态。

## P-107 Standalone Browser Session 用全局 Agent Settings Revision 作为 Target Revision，无关设置更新也会强制 Session Stale

- **优先级**：P2
- **状态**：`本轮 Browser revision 粒度审计确认`
- **当前事实**：
  - standalone Browser binding 从 `AgentSettingsService.get()` 读取 target，并直接把 `view.revision` 写成 `BrowserTargetSnapshot.profileRevision`。
  - Agent Settings revision 是整份文档的单一 CAS revision；修改 feature/model/budget/subagents/storage/workspace/plugins/safety 等任意 section 都会整体 `revision + 1`。
  - 后续每个 Browser Tool 都经 `sessionBinding()` 重新读取当前 target；只要当前全局 settings revision 与 session.targetRevision 不同，就关闭 session 并抛 `BROWSER_TARGET_STALE`，即使目标 endpoints/allowlist 一个字节都没变。
  - Workspace-bound Browser 不受此问题影响，因为 browser target 已冻结进 Workspace profile；问题集中在 standalone target。
- **问题**：长 Browser workflow 会被与 Browser 完全无关的设置保存打断，target stale contract 粒度过粗，也造成无谓的重新连接和上下文丢失。
- **目标方向**：
  1. 为 Browser target 使用 target-scoped content hash/revision，覆盖 endpoints + allowlist 等真正影响 session 的字段；不要复用整份 Agent Settings revision。
  2. standalone session validation 比较 target identity/hash；target 被删除或内容变化才 close + stale。
  3. Workspace frozen target 继续保持现有 immutable snapshot，不引入第二套不兼容语义。
- **明确不做**：不取消 stale 检测；不让已修改 target 的旧 session 无限继续；不为每个 Browser action重建 session。
- **验证**：修改 artifact/budget/subagent settings 后 standalone browser session 继续可用；只修改该 target endpoint/allowlist 时旧 session 稳定变 stale；Workspace-bound session 行为不变。

## P-108 ACP `requestPermission` 协议已接入但 Product 永久 `reject_once`，受控 Inner Action 没有用户确认路径

- **优先级**：P2
- **状态**：`本轮 ACP 功能闭环审计确认`
- **当前事实**：
  - `AcpAdapter` 已完整处理 ACP `client.session.requestPermission`，能读取 session/toolCall/title/kind/rawInput，并根据 `AcpExecutionContext.requestPermission()` 选择 server 提供的 `allow_once` / `reject_once` option。
  - 但 `acp_execute` Tool 当前把 `requestPermission` 固定实现为 `async () => 'reject_once'`；注释明确这是因为 Nexus 尚无 nested Approval broker。
  - 外层 `acp_execute` 本身已经走现有 mutation inspection → Approval → lease → StateCommit；因此 ACP transport 已 live，但任何 remote agent 在执行中请求一次受控敏感操作都会固定被拒绝，用户没有机会基于具体 inner action 决策。
  - 当前 SRS/AGENT 只要求 ACP inner permission fail closed，并未提供“允许用户确认后继续同一 ACP session”的产品路径。
- **问题**：ACP 集成对只读/无需权限的 agent 可用，但对主流 coding agent 常见的 Tool permission round-trip 功能不完整；remote agent 明明提供了结构化 permission request，Nexus 却只能拒绝，导致 ACP 能力被人为截断。
- **目标方向**：
  1. 复用现有 Run Approval durable contract，为 ACP session 增加 bounded nested permission request：保存 session/toolCall/kind/title/有限 rawInput digest/projection，Run 进入可恢复 waiting state。
  2. 用户只选择 `allow_once` / `reject_once`，结果续回原 ACP session；不新增新的全局 autonomy/permission mode。
  3. outer `acp_execute` approval 不能自动授权 inner action；`full_access` 是否覆盖 ACP inner permission需明确产品语义，第一阶段可仍要求显式 once approval。
  4. ACP session transport 在等待用户期间必须可 suspend/resume 或有明确 bounded timeout；Backend restart 若无法保活则返回确定的 interrupted outcome，不伪装完成。
  5. rawInput 只做 bounded model/UI projection；大型或敏感 payload 不直接复制进 Ledger，沿已落地的 P-069 ToolResult projection / P-097 Artifact 规则处理。
- **明确不做**：不让 ACP 自己决定 Nexus authority；不把所有 inner request 自动 allow；不另造第二套 Approval UI/数据库。
- **验证**：ACP fixture 发起 allow_once/reject_once permission request，UI 能显示并恢复原 session；拒绝时 agent 收到 reject，一次允许后只授权该 toolCall；未知 option/超时/restart 仍 fail closed。

## P-109 MCP Integration `enabled=true` 与“已成功 Refresh/可调用”没有 Health Contract，失败被吞且无持续恢复 Owner

- **优先级**：P2
- **状态**：`本轮 Integration availability 矩阵确认`
- **当前事实**：
  - MCP integration create/update 成功持久化后，只以 fire-and-forget `void refresh(...).catch(() => undefined)` 尝试建立 session / listTools；远端不可达、鉴权失败、协议错误等不会让 create/update API 失败，也不会写入任何 error state。
  - `IntegrationView` 只有 `enabled/schemaHash/version/...`，没有 `refreshState`、`lastError`、`lastSuccessAt`、`nextRetryAt`。refresh 失败时 Tool contribution 被移除，`schemaHash` 通常为 null，但这无法区分“尚未刷新”“远端失败”“被更新后待刷新”等状态。
  - `syncEnabled()` 会在 App enable / user initialization 时再尝试 refresh；失败后 close/remove contribution。但 Agent lifecycle sweep 只负责 Approval expiry 与 Workspace reconciliation，没有 MCP 周期 retry/backoff owner。
  - Backend 已暴露 MCP Integration 的 list/create/update/delete/refresh，Frontend `agentApi` 也封装了通用 Integration API；但当前产品设置只有 `AcpRuntimeSettings.vue` 会消费这些接口，**没有 MCP endpoint/credential/enable-disable/refresh/health 管理 surface**。用户只能在 grants/Subagent capability 中看到 `integration.mcp.invoke` 能力名，无法从主产品创建或维护对应 MCP Integration。
- **问题**：`enabled` 被误解成“可用”，但真正 Tool surface 可能不存在且长期不会自动恢复。短暂 MCP outage 在启动/更新瞬间发生后，即使远端恢复，Nexus 也可能一直没有该 Tool，直到 App 再启用/用户重新初始化或外部调用 refresh。
- **目标方向**：
  1. 给 Integration 增加轻量 runtime health projection：至少 `refreshState=idle|refreshing|ready|error`、bounded `lastErrorCode`、`lastAttemptAt/lastSuccessAt`；是否持久化 nextRetry 可按实现简化。
  2. enabled MCP 在 refresh error 后由一个 bounded backoff owner 重试，成功后原子更新 schema generation 并恢复 Tool contribution；disabled/removed/version changed 应取消旧 retry。
  3. Integration health 是局部 capability health，不把一个可选 MCP 故障升级为整个 Agent App disabled；Context/Tool discovery只暴露 ready generation。
  4. 增加 MCP management surface：至少支持 endpoint + credential、enable/disable、删除、显式 Refresh/Retry，并显示 Ready / Error / Refreshing 与最近 bounded 错误；如果未来改由 Plugin surface 承担，也必须消费同一 Backend health contract，不能只存在 HTTP API。
  5. 与 P-106 共用 generation/CAS：旧 retry 完成不能覆盖更新后的 integration。
- **明确不做**：不引入通用监控平台；不无限高频探测；不因为 MCP 暂时失败阻止其它 Agent capability 或新 Run。
- **验证**：fixture 在 create 时离线后恢复，integration 从 error 经 backoff 自动到 ready 且 ToolCatalog 恢复；更新/禁用期间旧 retry 不能复活旧 schema；UI/API 能解释当前不可用原因并手工 retry。

## P-110 `agent_commands.expires_at` 没有任何 Runtime 语义或 Cleanup Owner，Idempotency Key 实际永久占用

- **优先级**：P1
- **状态**：`已完成（2026-09-17；所有 replay lookup 统一经 command TTL gate，在同一事务回收 expired committed；pending/unknown 永久保留 recovery evidence；startup/周期 bounded cleanup 接线，24h TTL replay/conflict/reuse 场景通过）`
- **当前事实**：
  - `agent_commands` 以 `UNIQUE(user_id, app_id, command_name, idempotency_key)` 持久化 Run create/cancel/budget/delete、Goal、Input/Queue、Approval、Workspace create 等命令；表同时有 `expires_at` 和 `agent_commands_cleanup(status,expires_at)` index。
  - Root Run/Approval/Input/Goal 路径写入的 TTL 是 24 小时；`workspace.create` 写入 7 天 TTL。
  - 但所有 command replay lookup 都只按 `(user_id,app_id,command_name,idempotency_key)` 查找，不带 `expires_at > now`；过期 row 仍会返回旧 response、`IDEMPOTENCY_PAYLOAD_MISMATCH`、`IDEMPOTENCY_IN_PROGRESS` 或 `RECONCILIATION_REQUIRED`。
  - 全仓没有 `DELETE FROM agent_commands ... expires_at`、sweep/service owner 或 lifecycle cleanup；因此 schema 上的 cleanup index 目前没有消费者。
  - UNIQUE constraint 也不会因 timestamp 过期自动释放，所以同一个 key 对同一 command 会永久被旧 row 占用，而不是 TTL 后重新可用。
- **问题**：API 对外表现宣称/实现了 bounded idempotency TTL，但 durable 行为其实是永久幂等历史。长期运行既会让 `agent_commands` 无界增长，也会让客户端在 TTL 之后重用 key 时错误 replay 已不存在实体、永久 payload conflict，或被历史 `unknown/pending` 状态卡死。
- **目标方向**：
  1. 明确 TTL contract：只有 terminal `committed`（以及经过明确 reconciliation/terminalization 的其它状态）在 `expires_at <= now` 后可被回收；`pending/unknown` 不能仅因时间到期直接删除，否则会丢失 crash/reconciliation 证据。
  2. command lookup 必须在一个原子边界内处理过期 terminal row：先确认可回收，再删除/replace 后接受新 command；不能仅在 SELECT 中忽略旧 row，否则 UNIQUE INSERT 仍冲突。
  3. 增加 bounded lifecycle cleanup owner，按 index 分页删除可安全回收的过期 row，限制每轮 work；Workspace 7 天与普通 command 24h 可继续按各自写入 TTL。
  4. 对 `result_entity_id` 已删除的 replay 要有清晰语义；TTL 内 replay 仍保持当前 exact response/冲突 contract，TTL 外重新执行不引用旧实体。
  5. 文档/API 测试固定 TTL 边界，避免未来把 `expires_at` 再退化成只用于观测的死字段。
- **明确不做**：不把所有 idempotency 历史永久保留；不直接 sweep `pending/unknown`；不靠客户端保证 key 永不重复来绕过 server-side TTL contract。
- **验证**：构造 committed command 在 TTL 前稳定 replay、TTL 后相同 key 可作为新请求执行；不同 payload TTL 前 conflict、TTL 后可执行；pending/unknown 即使过期仍保留并要求 recovery；大量 expired committed row 经 bounded sweep 收敛且不会删除 active/reconciliation evidence。

## P-111 Backend Restart 只终止顶层 Run，不完整收敛 In-flight Attempt / Tool / Mutation Lease，`needsReconciliation` 可出现空资源死锁

- **优先级**：P1
- **状态**：`已完成（2026-09-17；restart recovery 已收敛 model/read Tool/active mutation lease，deterministic SQLite 场景通过）`
- **当前事实**：
  - Backend 启动先调用 `interruptNonTerminalRuns()`，把所有 `created/running/awaiting_approval/awaiting_budget/cancelling` Run 改成 `interrupted`，并结束 runtime、取消 scheduler work。
  - 该 transition 不会把 streaming `agent_model_attempts`、running model step、running/read Tool step/ToolCall 统一改成 interrupted/failed/cancelled；因此 terminal `interrupted` Run 下可以永久保留 durable child `status='running'/'streaming'`。
  - 对 mutation，restart 只通过 `agent_tool_calls risk <> 'read' AND status IN ('running','reconciling')` 决定 `needs_reconciliation=1`，但不会把该 Tool 对应的 active mutation lease materialize 为 `agent_resource_quarantine`。
  - 正常 mutation 顺序是 acquire write lease → `beginMutationTool()` 令 Tool running → `executeMutation()` 首先 `markMutationActive()` → side effect；所以 Backend crash 可以稳定留下 `running Tool + active_mutation lease`。
  - `SqliteLeaseRepository.quarantineExpiredMutations()` 只在未来某次 `acquireResources()` 再次请求同一个 resource key 时懒触发；restart/lifecycle sweep 不主动扫描 expired active mutations。
  - Run reconciliation API 的 `resources` 只来自 `agent_resource_quarantine`。因此 restart 后可出现 `required=true, resources=[]`；而 `resolveRunReconciliation()` 明确要求当前 quarantine 非空且与提交资源全集一致，否则 `STATE_CONFLICT`。Run 删除又在 `needs_reconciliation=1` 时拒绝。
- **问题**：crash recovery 的顶层状态与 durable 子状态/lease authority 不闭合。无副作用的 model/read Tool 留下“Run 已终止但 attempt/tool 仍 running”的永久假状态；有副作用的 mutation 更可能进入无法立即 reconcile、无法删除的 Run，只有将来碰巧有人再次争用同一 resource 且 lease 已过期时才会生成 quarantine，恢复依赖偶然外部流量。
- **目标方向**：
  1. restart recovery 在一个明确 orchestration 中完整分类 in-flight model/tool/approval/scheduler state：无副作用 attempt/read Tool 直接 durable settle 为 interrupted/cancelled，并关闭 step/attempt timestamps/status。
  2. 对 running/reconciling mutation，读取其 inspection/resource keys 与 active mutation lease；在标记 `needsReconciliation` 前，主动 materialize quarantine（保留 toolCallId/operationId/fence/evidence），或建立等价的 durable recovery record。
  3. 保证 invariant：`run.needs_reconciliation=1` 时 reconciliation view 必须给出至少一个可解析 recovery resource/reason；禁止 `required=true + resources=[]`。
  4. restart 后 stale active mutation lease 不依赖下一次 acquire 才转 quarantine；可由启动 recovery 或 bounded lifecycle sweep 扫描。
  5. recovery 完成后 tool/step/lease/quarantine 状态一起收敛；Run delete/checkpoint/metrics 不再看到 terminal parent 下的伪 running child。
- **明确不做**：不在 restart 后自动假定 mutation 成功或失败；不静默释放 active mutation lease；不要求用户通过“再执行一次同资源操作”来触发 recovery。
- **验证**：分别在 streaming model、running read Tool、`markMutationActive` 后/side effect 前后注入进程终止；重启后前两类 child state 均已 terminal，mutation Run 立即返回非空 reconciliation resources 并可 resolve；未 resolve 前同资源 write 继续 fail closed，resolve 后 lease/quarantine 被一致清除并允许删除 Run。

## P-113 Artifact Library 没有单项删除入口，只能 Retain/Download 或全局 Cleanup

- **优先级**：P2
- **状态**：`本轮 Frontend/API capability closure 审计确认`
- **当前事实**：
  - Backend 已提供 `DELETE /apps/:appId/artifacts/:artifactId?expectedVersion=...`，Frontend `agentApi.deleteArtifact()` 也已完整封装 versioned mutation。
  - 但 `ArtifactLibraryView` 没有任何 `deleteArtifact()` consumer；每行只提供 retain/unretain 与 download。
  - 用户若希望释放一个特定 Artifact，只能先保证它 unretained，然后执行 `/agent/files/cleanup/preview + confirm`；该 cleanup 会选中**所有**当前 reclaimable Artifact，而不是指定单项。
  - 因此“删除一个大文件”和“批量回收所有可回收文件”被迫共用同一操作，虽然 Backend 已经具备更精确的 capability。
- **问题**：现成的精确 mutation 没有产品入口，用户不能只删除选定 Artifact；为了清掉一个文件必须承担全局 cleanup 的额外影响或保留其它文件来规避。
- **目标方向**：
  1. Artifact Library 每项提供 Delete，复用现有 `deleteArtifact()` + expectedVersion；删除前显示文件名/大小并做轻量确认。
  2. Backend 现有 active Run/checkpoint/grant 等保护继续 authoritative；UI 不自行猜“是否允许删除”，409/保护错误后 refresh authoritative list/storage。
  3. 单删成功后更新当前 page 与 storage summary；version conflict 时只刷新目标/列表，不把错误吞成成功。
  4. Global cleanup 继续保留用于批量 reclaim，不替代单删。
- **明确不做**：不增加新的 Artifact 删除协议；不允许 UI 绕过 Backend 的 protected/retained 引用检查；不把全局 cleanup 改成隐式单删。
- **验证**：ready/unprotected Artifact 可单独删除且其它 reclaimable Artifact 保持不变；protected/version-stale Artifact 删除失败后 UI 解释并刷新；批量 cleanup 行为不变。

## P-114 Durable Memory 有完整 Backend 状态机但没有 Frontend Review/Publish 入口，Candidate 永远不能进入 Recall 主链

- **优先级**：P1
- **状态**：`本轮 Frontend/API capability closure 审计确认`
- **当前事实**：
  - Backend `MemoryService` 已实现 candidate/published/revoked 状态、list、proposal、publish/reject/revoke review，以及 cross-App import preview/confirm；HTTP routes 也完整暴露。
  - Agent Tool `memory_propose` 明确告诉模型：`Candidates are not recalled until the user explicitly publishes them.`；`RecallService` 只读取 published 且未过期 Memory。
  - 但 Frontend `agent-api.ts` 没有任何 memory list/review/import client 方法，`features/agent` 也没有 Memory 管理/审核 UI。
  - 因此 Agent 可以成功创建 candidate，但普通用户无法通过产品界面查看、编辑、publish/reject；candidate 会长期停留且永远不参与 recall。Cross-App published Memory import 同样没有产品入口。
- **问题**：Memory Backend 看似完整，实际用户闭环缺失，导致长期记忆的核心价值不可达；Agent 产生 candidate 后没有可发现的 follow-up action，用户也无法治理已 published/revoked Memory。
- **目标方向**：
  1. 在 Agent Settings/Hub 增加 Memory surface，按 App + status 列出 candidate/published/revoked，显示 bounded content、confidence、expiresAt 和 provenance projection。
  2. Candidate 支持 publish/reject，publish 前允许编辑 content；published 支持 revoke。所有 mutation 使用 expectedVersion，并在 conflict 后 refresh authoritative item/list。
  3. Agent 产生 candidate 后通过现有 Run event/Notification 体系提供“有待审核 Memory”的轻量提示；与 P-091 通知桥共用 owner，不新增消息系统。
  4. Cross-App import 只展示来源 App 的 published Memory，复用 Backend preview→confirm；第一阶段可放在 Memory surface，不要求 Agent 自动 import。
  5. 与 P-065 FTS recall 联动：只索引 published live Memory，candidate/revoked 不进入 recall index。
- **明确不做**：不让 Agent 自己自动 publish 自己提出的 Memory；不为了省 UI 直接把 candidate 纳入 recall；不另建第二套 Memory storage。
- **验证**：Agent fixture 通过 `memory_propose` 创建 candidate 后 UI 可立即发现；publish 后下一 Run recall 可命中，reject/revoke 后不可命中；version conflict 能恢复；cross-App import preview/confirm 可从产品完成。

## P-115 AppIntent 是正式 App Manifest/Host Contract，但受隔离的 Plugin SDK 没有发送/接收入口

- **优先级**：P2
- **状态**：`本轮 Frontend/Plugin SDK capability closure 审计确认`
- **当前事实**：
  - Plugin manifest 把 `intents` 作为 required 顶层 contract；官方 `nexus.agent` 已声明 `memory.import`，Backend `AppIntentService` 也完整实现 confirmed receipt、receiver list、revoke、Artifact grant/read 与 TTL。
  - Host 暴露 `/agent/apps/:appId/plugin-intents` 等 REST routes，但 Plugin Frontend 运行在 `sandbox="allow-scripts"` opaque-origin iframe，静态 CSP 为 `connect-src 'none'`，不能直接 fetch Host API。
  - Plugin Frontend 只能走 `PluginFrontendHostBridge` 的白名单 RPC；当前 SDK 只提供 host info、AppStorage、Agent Run/Thread/Subagent/Approval 等方法，没有 AppIntent create/list/revoke/artifact read。
  - Plugin Backend worker SDK 同样只暴露 lifecycle/storage 请求，没有 AppIntent capability；全仓 `createAppIntent/listReceivedAppIntents/revokeAppIntent` 的业务消费者只有 Host HTTP facade。
  - Memory cross-App import目前只是直接检查 target manifest 是否声明 `memory.import` 后调用 `MemoryService`，并不使通用 AppIntent contract 对插件本身可达。
- **问题**：Nexus 声明了“App 可以拥有 Intent”的正式扩展模型，也持久化了 receipt/artifact grant，但受控 Plugin SDK 无法使用它。第三方 App 即使在 manifest 声明 intent，也不能通过推荐执行边界发送/消费 intent，形成 Backend-only 半实现 contract。
- **目标方向**：
  1. 明确 AppIntent 是 Plugin SDK 的正式 cross-App capability；在 Frontend/Backend Plugin SDK 中提供 bounded sender/receiver API，底层继续调用唯一 `AppIntentService`，不让 sandbox iframe自行联网。
  2. sender 至少支持 receiverAppId/intentId/bounded JSON input/Artifact refs + explicit confirmation；receiver 支持 list received/revoke 与受 grant 保护的 Artifact metadata/range read。
  3. RPC 层复用 manifest intent ownership、capability grants、TTL、Artifact grant 与 message-size limits；大 Artifact 内容继续走受控 stream/download path，不塞进 postMessage JSON。
  4. 如果产品最终不希望第三方 Plugin 使用 AppIntent，则反向收口：从 manifest/public contract 删除通用 intents/receipt surface，只保留 Memory 等明确 Host-owned capability，避免伪开放扩展点。
- **明确不做**：不为 Plugin iframe 开 `connect-src self` 来绕过 bridge；不复制第二套 cross-App storage；不让 sender 越过 receiver manifest intent/capability 校验。
- **验证**：fixture Plugin A 通过 SDK 向 Plugin B 的已声明 intent 发送 bounded payload/Artifact，B 能读取 receipt/content并 revoke；未声明 intent、无 grant、过期 receipt/Artifact 都拒绝；sandbox 仍保持 `connect-src 'none'`。

## P-116 `AGENT_DEFAULTS` 顶层仍保留多组无 Consumer 的旧执行策略常量，形成第二事实源

- **优先级**：P2
- **状态**：`已完成（2026-09-18；删除 AGENT_DEFAULTS 中 5 个无 Consumer 的旧执行策略字段；Approval TTL 收口为 runtime/approvals 单一 contract；Root/Child Agent Tool lease TTL 收口为 toolTimeout+15 bounded helper；三个 live lease renewal path 共用单一 10s cadence；minFreeDiskBytes/modelRetryCount 保留真实 consumer；deterministic scenarios 35/35 PASS）`
- **施工前事实**：
  - `AGENT_DEFAULTS` 仍声明 `approvalTtlSeconds=600`、`leaseTtlSeconds=30`、`leaseRenewSeconds=10`、`estimateMargin=0.15`、`maxConcurrentToolCalls=1`，但全仓除定义外没有任何 consumer。
  - Approval 的真实 TTL 目前在 `NativeAgentBackend` 与 StateCommit validation 中直接使用 `600`；因此 `approvalTtlSeconds` 看似是 authority，实际改它不会改变行为。
  - Root/Child Tool lease TTL 已改成基于 `toolTimeoutSeconds + 15` 的动态值（30～300 秒）；`LeaseCoordinator` 的 renewal cadence则直接 hardcode 为 `10_000ms`。因此旧 `leaseTtlSeconds` 已失效，而 `leaseRenewSeconds=10` 只是与另一处 magic number 重复、改动不会生效。
  - Root read Tool 并行上限由 `MAX_PARALLEL_READ_TOOLS=4` 控制，`maxConcurrentToolCalls=1` 已不是 runtime policy。
  - Model budget reservation 直接按 `estimatedInputTokens + maxOutputTokens` 处理，`estimateMargin` 没有参与 Root/Child/Context accounting；P-070 已收口 usage anchor/estimate contract，也不受一个无 owner 的历史 margin 影响。
- **问题**：同一类执行策略同时存在“看起来官方的 defaults 常量”和真正 runtime 逻辑，修改前者不会产生任何效果。后续优化/排障很容易基于错误事实源做配置，或把已废弃策略意外复活。
- **目标方向**：
  1. 删除没有 runtime owner 的顶层常量；需要共享的固定值（例如 Approval TTL）提取成离实际 producer/validator最近的单一 typed constant/module，并由两端共同引用。
  2. Lease TTL继续以当前 Tool timeout 动态语义为唯一事实源；renew cadence如果保留固定 10 秒，应在 `LeaseCoordinator` 附近定义唯一常量并解释与最小 TTL 的关系，不要同时保留一个失联的 `AGENT_DEFAULTS.leaseRenewSeconds`。
  3. Read Tool parallelism 若未来需要用户/系统可调，单独定义明确 budget/settings contract；当前先保留 `MAX_PARALLEL_READ_TOOLS` 的 bounded internal policy并删除误导性的 `maxConcurrentToolCalls`。
  4. `estimateMargin` 直接删除；token estimation/accounting 已由 P-070 的 provider usage anchor + estimator contract 接管。
- **明确不做**：不为了消灭 dead code 把每个内部常量都暴露成 Settings；不恢复已经被动态策略替代的固定 lease 参数；不让 Approval producer/validator继续各写一个 magic number。
- **完成事实**：
  1. `AGENT_DEFAULTS` 已删除 `approvalTtlSeconds / leaseTtlSeconds / leaseRenewSeconds / estimateMargin / maxConcurrentToolCalls`。当前顶层只剩 `minFreeDiskBytes`、`modelRetryCount` 与 `settings`；deterministic regression 直接锁定这个 shape，避免未来再把无 consumer 策略塞回通用 defaults bag。
  2. 两个保留字段均继续有真实 owner：`minFreeDiskBytes` 由 `compose-agent` 注入 Artifact limit policy，并在 `LocalArtifactStore.ensureFreeSpace()` reservation/write path消费；`modelRetryCount` 由 `ModelStepRunner.shouldRetry()` 控制 same-route provider retry。它们没有为了“清理整齐”被误删。
  3. Tool Approval TTL 新增唯一 `runtime/approvals/approval-policy.ts::TOOL_APPROVAL_TTL_SECONDS = 10 * 60`。`NativeAgentBackend` producer 先捕获一个 `now`，使用 `expiresAt = now + TOOL_APPROVAL_TTL_SECONDS`；StateCommit `requestToolApprovalTransition()` validator 使用同一 constant。两处不再存在独立 magic `600`，也没有把 TTL 重新放回 `AGENT_DEFAULTS`。
  4. Root read、Root mutation、Child read 的 Agent Tool lease TTL 抽成 `runtime/execution/tool-lease-policy.ts::toolLeaseTtlSeconds()`，保持原语义 `min(300, max(30, toolTimeoutSeconds + 15))`。因此 frozen Run `toolTimeoutSeconds` 继续是 Agent Tool lease TTL 的输入 authority，没有恢复固定 30s Agent lease default。
  5. Lease renewal cadence 抽成 `capabilities/lease-policy.ts::LEASE_RENEW_INTERVAL_MS = 10_000`，由 `LeaseCoordinator`、`AgentMutationLeaseGuardAdapter`、以及 composition-root 中真实被 Workspace services 使用的通用 `LeaseMutationGuardAdapter` 共同引用。该 constant 明确是 infrastructure policy，不是 Settings；注释记录所有当前 lease contract TTL 均不低于 30 秒，因此 10 秒 cadence 在到期前保留多次 renewal 机会。
  6. 通用 Workspace `LeaseMutationGuardAdapter` 自己的 local `LEASE_TTL_SECONDS=30` 是另一条真实 platform mutation contract，并非 P-116 的 dead `AGENT_DEFAULTS.leaseTtlSeconds`；本条没有把它强行改成 Agent Run 的 `toolTimeout+15` 语义。
  7. `MAX_PARALLEL_READ_TOOLS=4` 继续作为 `NativeAgentBackend` 内部 bounded policy；没有因为删除 `maxConcurrentToolCalls=1` 就新增用户 Settings。`estimateMargin` 直接删除，未被重新接入 token reservation；P-070 已完成 usage/accounting 统一。
- **验证**：新增 deterministic `runtime/default-policy-authority`，先在旧 defaults 上真实 FAIL；完成后验证 5 个 dead top-level defaults 为 0、仅 2 个 live non-settings defaults、Approval TTL 单一 authority、lease renewal cadence 单一 authority，以及 Agent Tool lease minimum / timeout+grace / 300s cap 三个 policy case。全仓审计确认 dead defaults 名称零 production 引用、Approval producer/validator 无 magic `600`、Agent Tool TTL 无重复 `toolTimeout+15` 公式、三个 renewal path 无裸 `setInterval(renew, 10_000)`；Backend `tsc --noEmit` + build、Frontend `vue-tsc --noEmit` + Vite build、完整 deterministic Agent scenarios `35/35 PASS`、`git diff --check` 全部通过；仅有既有 Node v22.17.0 < repo Node >=24 engine warning。

## P-117 App / 全局 Agent Disable 没有收敛 Host-owned Root/Subagent Run，`quiesceApp()` 成为未接线的恢复合同

- **优先级**：P1
- **状态**：`已完成（2026-09-17；scope-aware Root/Subagent quiesce + durable Run closure 已接入 App/global disable，隔离场景通过）`
- **当前事实**：
  - `RunService.create()` 会检查 App `desiredState/observedState/acceptNewRuns`，因此 App disable 后确实会拒绝**新** Run；这一部分合同有效。
  - `AppLifecycleService.disable()` 进入 `disabling` 后会调用 `definition.quiesceForScope()` 或 `definition.quiesce()`。安装式 Plugin App 的 definition 只实现 `quiesceForScope -> PluginBackendRuntime.quiesce(scope, plugin, deadline)`；它收敛的是插件 Backend child runtime，不拥有 Host Core 的 Root/Subagent Agent execution。
  - Root `AgentScheduler` 与 `SubagentScheduler` 是全局 Host owner；普通 App disable 路径没有按 `(userId, appId)` cancel/quiesce 它们，也没有调用 StateCommit 做 durable Run closure。
  - 全局 `feature.enabled: true -> false` 目前循环调用 `lifecycle.quiesce(definition.manifest.id, deadline)`；`AppLifecycleService.quiesce(appId)` 只调用 `definition.quiesce`，而安装式 Plugin definition 没有该 global hook，因此这一步对它可为空操作。该分支也没有直接 `scheduler.quiesce()` / `subagentScheduler.quiesce()`。
  - `StateCommitPort` / `SqliteStateCommitAdapter` 已存在完整 `quiesceApp(appId, now)`：会把指定 App 的非终态 Run 收敛为 `interrupted/cancelled` 并写 durable events；但全仓没有任何调用者。这是很强的“原本 intended Host Run closure 没接上”信号。
  - Plugin upgrade/uninstall 通过 `acceptNewRuns=false + runningCount==0` 走 drain，因此不会在已有 Run 存在时切版本；但普通 App disable / 全局 Agent disable 走的是另一条 lifecycle，不能借 upgrade drain 自动解决 active Run。
- **问题**：用户关闭某个 Agent App 或关闭全局 Agent feature 后，产品面会隐藏/禁用且新 Run 被拒绝，但已经在 Host Core 执行的 Root/Child Run 没有对应的 durable quiesce contract。它们可能继续模型/Tool执行，或者在 Plugin Backend 已被 quiesce 后继续运行到后续失败；全局 disable 尤其可能出现“UI 已关闭但 Agent 仍在后台执行”的语义分裂。
- **目标方向**：
  1. 定义唯一的 **scope-aware Agent execution quiesce**：普通 App disable 按 `(userId, appId)` 停止 Root scheduler queue、abort active Root/Child execution，并通过 StateCommit 把未完成 Run 收敛到明确 `interrupted/cancelled` / reconciliation 状态。
  2. 复用并收口现有 `quiesceApp()`，但补齐它对 P-111 所要求的 attempt/tool/lease/reconciliation state closure；不要只更新顶层 Run。
  3. 全局 feature disable 应先阻止所有新 Agent scheduling，再对所有 enabled App/active Run 执行同一 Host-owned quiesce，最后关闭/隐藏产品面；不要依赖 Plugin definition 的 optional global `quiesce`。
  4. Plugin Backend/Runner target 的 `quiesceForScope` 继续由 Plugin lifecycle owner 执行，但顺序要与 Host Run quiesce 明确：先停止产生新 Host work并 abort/settle Run，再回收其动态 target，避免正在执行的 Run失去 dependency。
  5. App upgrade/uninstall 继续使用 `acceptNewRuns=false + runningCount drain`；是否允许“自然跑完”与普通 disable 的“主动停止”语义明确区分，不混用一个模糊 quiesce hook。
- **明确不做**：不因为 disable 就删除 Run/Ledger；不静默把 active mutation 标成 cancelled；不把全局 scheduler 全停作为单 App disable 的替代；不要求 Plugin 自己管理 Host Run 状态。
- **验证**：启动 streaming Root Run（含 Child/Tool 变体）后禁用 App，Run 在 bounded 时间进入正确 terminal/reconciliation，后续无新 model/tool attempt；另一个 App 的 Run 不受影响。启动 active Run 后关闭全局 feature，所有 Agent Run 都有 durable closure，重新启用后不会复活旧 in-flight attempt；Plugin upgrade drain 现有行为不回退。

## P-118 StateCommit 收口后仍保留可直接修改 Approval / Quarantine / Read-Tool Durable State 的无 Caller 旁路接口

- **优先级**：P2
- **状态**：`已完成（2026-09-17；Approval/Quarantine direct mutation 旁路与 single-read StateCommit 已删除，Checkpoint Approval cleanup 迁入 StateCommit，size=1/parallel read batch 场景通过）`
- **当前事实**：
  - `ApprovalRepositoryPort.expire()` / `supersedeRun()` 仍直接更新 `agent_approvals`，但全仓没有业务调用者；当前真正的 expiry/supersede 已由 StateCommit transition 在同一事务内同步 Tool/Run/App counters/events。
  - `LeasePort.getQuarantine()` / `resolveQuarantine()` 仍允许直接读取/删除 `agent_resource_quarantine`，同样没有 caller；正式 reconciliation 已由 `run.reconciliation` + `StateCommit.resolveRunReconciliation()` 同时处理 quarantine、active mutation lease、Run flag 和 durable event。
  - `StateCommitPort.beginReadTool()` / `settleReadTool()` 及对应 single-item transition/adapter 仍存在但没有 caller；Root read execution 已统一走 `beginReadToolBatch/settleReadToolBatch`，即使 batch 只有 1 项也不使用旧接口。
  - `StateCommitPort.quiesceApp()` 也没有 caller，但它不是普通 dead code：其 Host lifecycle 断线已经单独记录为 P-117，应在修复 App disable state closure 时重用/重构，而不是和本条一起简单删除。
- **问题**：这些无 caller 的 mutation API 仍然公开表达“可以直接改 durable truth”的替代路径。未来维护者如果复用它们，会绕过 StateCommit 的 version/CAS、Run event、App counter、Tool status、reconciliation 等原子不变量；而旧 single-read transition 也让 batch lineage 出现双实现事实源。
- **目标方向**：
  1. 删除 Approval repository 的直接 lifecycle mutation，只保留 StateCommit 所需的 query/read（若仍有消费者）；expiry/supersede 必须通过唯一 transaction owner。
  2. 删除 LeasePort 的独立 quarantine resolution API；quarantine 查询/resolve 对外统一经 Run reconciliation contract，底层 Lease repository只保留执行 lease/quarantine producer 所需能力。
  3. 删除 single `beginReadTool/settleReadTool` command/types/transitions/adapter 方法，单 Tool 继续作为 size=1 batch执行，保持一份 batch lineage/state machine。
  4. 对 `*.port.ts` 增加轻量 dead-contract 审计约定：有 side-effect 的 Port method 若没有业务 owner，应删除而不是“为以后留着”；P-079 harness至少覆盖唯一正式路径。
- **明确不做**：不删除 P-117 需要的 App quiesce 能力；不因为 API cleanup 改变现有 batch/read行为；不把 repository query 全部强塞进 StateCommit，只有 durable mutation 必须收口。
- **验证**：上述 Approval/Lease/single-read mutation 方法和实现全仓消失；Approval expiry、input supersede、Run reconciliation、single read Tool、parallel read batch 仍由现有正式路径通过 deterministic/E2E；无新的 DB direct mutation bypass。

## P-119 Public Agent Facade 的业务错误没有完整进入 HTTP Error Taxonomy，可恢复状态会退化成 `500 INTERNAL_ERROR`

- **优先级**：P1
- **状态**：`已完成（2026-09-17；补齐 Subagent/Workspace selection/Plugin AppStorage/Artifact/MCP outbound public taxonomy，outbound policy 改用 INTEGRATION_* ownership；真实 agentRoute 14-case contract 场景验证 0 个业务错误退化为 500）`
- **当前事实**：
  - `agentRoute()` 对未命中 `agent-error-rules` 的异常统一返回 `500 / INTERNAL_ERROR / Agent request failed.`；因此 public service/repository 抛出的业务 code 必须显式进入 exact/prefix taxonomy，才能让 Frontend 正确区分 refresh/retry/404/422/507 等动作。
  - Subagent HTTP contract已有可达缺口：`createSubagent()` 会直接抛 `RUN_NOT_FOUND` / `RUN_NOT_ACTIVE`，`cancelSubagent()` 的 repository CAS 会抛 `DELEGATION_VERSION_CONFLICT`；`collaborationErrorRules` 当前都没映射这些 code，所以不存在的 Run、终态 Run、stale cancel 都会退成 500。
  - Workspace create 会直接执行 `resolveRunEnvironment()`，可抛 `ACP_PROFILE_SELECTION_INVALID`、`ACP_PROFILE_NOT_FOUND`、`BROWSER_TARGET_NOT_FOUND`、`BROWSER_TARGET_REQUIRES_BROWSER_RECIPE`；`workspaceRuntimeErrorRules` 没有这些 code/prefix，用户选了过期 profile/target 时得到服务器错误而不是 400/404/422。
  - Plugin Frontend RPC 直接调用 `AppStoragePort`；key shape先被 wrapper收口，但 `APP_STORAGE_VALUE_TOO_LARGE`、`APP_STORAGE_QUOTA_EXCEEDED`、`APP_STORAGE_VERSION_CONFLICT` 等 repository error 没有 Plugin/Common rule，因此正常的 CAS conflict、quota、payload limit会通过 `/plugins/:appId/frontend/rpc` 变成 500。
  - Workspace Artifact import 的 public route可直接抛 `ARTIFACT_NOT_READY`；Artifact rules只映射 upload/range/quota/protected 等错误，未覆盖该 ready-state conflict。
  - MCP Integration create/update 会在 `IntegrationService.validateMcp()` 中调用 shared outbound policy；该实现仍位于 `infrastructure/agent/providers/` 并抛 `PROVIDER_DNS_RESOLUTION_FAILED`、`PROVIDER_PRIVATE_ENDPOINT_DENIED`、`PROVIDER_ENDPOINT_DENIED` 等 Provider 命名 code。Provider model transport 本身已经不使用这套 policy；但这些 code 从 MCP public route 逃出时既不匹配 `MCP_*` / `INTEGRATION_ENDPOINT_*` rules，也没有对应 Provider HTTP rule，因此同样会退成 500。
  - 机械扫描还会发现大量 Runtime/internal code未映射；它们不应全部暴露为 HTTP contract，因为 scheduler/Tool/StateCommit 内部错误通常会先被 Runtime settle 成 durable failure。真正问题是**没有一个可验证机制区分 public-facade business error 与 internal-only error**。
- **问题**：前端/Plugin SDK 无法根据稳定 HTTP code执行正确恢复动作，同一类 stale/not-found/quota/invalid selection在不同 surface 有的返回 409/404/422、有的退化成 500。新增 service error 时也没有测试提醒维护者补 taxonomy，错误合同会持续漂移。
- **目标方向**：
  1. 为 public Agent facade 建立显式 error taxonomy：至少区分 validation(400)、authorization(403)、not-found(404)、state/CAS conflict(409)、semantic unavailable(422)、payload(413)、quota/resource(507)、upstream/runtime unavailable(502/503)。
  2. 补齐已确认的 Subagent、Workspace ACP/Browser selection、Plugin AppStorage、Workspace Artifact、MCP outbound validation error mapping；MCP policy/error ownership迁到 Integration/MCP 语义（或至少返回 `MCP_*` / `INTEGRATION_ENDPOINT_*`），不要为了复用它重新给 Provider transport接 SSRF/private-host policy。保留具体可操作 code，Frontend 需要 refresh/retry的 conflict 不要全压成 generic INTERNAL_ERROR。
  3. 对 public service boundary优先使用 typed/domain error 或统一 error catalog；`agent-error-rules` 可以继续是 HTTP adapter，但不要依赖维护者手工记住每个字符串。
  4. P-079 deterministic harness增加 route-level contract test：枚举/触发关键 public error，断言 status/code；internal-only error则明确允许被 Runtime settle或 500，不要求全部公开。
  5. Frontend `classifyRuntimeFailure()` 与 Plugin SDK 只依赖稳定公开 code，不根据英文 message猜恢复动作。
- **明确不做**：不把所有内部 SQLite/scheduler error原样泄露给客户端；不把所有未知错误映成 409 来掩盖真正 bug；不因为 HTTP taxonomy补齐而改变 Runtime durable failure语义。
- **验证**：上述 6 组已确认路径分别返回预期 4xx/507 code；stale Subagent cancel进入 conflict refresh、missing Run/profile/target进入 not-found/semantic error、AppStorage CAS/size/quota可被 Plugin SDK区分；新增 public domain error若无 mapping/schema contract，deterministic test失败。

## P-120 父 Run 累计 Token Hard Budget 应移除；总消耗保留 Telemetry，UI 进度改为当前 Context Usage

- **优先级**：P1
- **状态**：`已完成（2026-09-17；父 Run maxRunTokens 已从 Settings/Hard Limit/App override/RunBudget/budget-increase/API/UI/Checkpoint 执行合同删除；累计 input/output/cached usage 继续 durable 统计，TaskRail 改显示 latest Context Usage；未发布产品不保留旧 maxRunTokens/Child token-budget 字段兼容；Root/Child 在累计 1.6M Token 后仍可开始下一步，Backend/Frontend build 与 deterministic scenario 全通过）`
- **当前事实**：
  - Nexus 当前 `budget.maxRunTokens` 默认 `100_000`、Hard Limit 默认 `1_000_000`；它不是装饰字段，而是贯穿 `AgentExecutionPolicyService → Run snapshot → Root model reservation/output cap → Subagent context → budget wait/increase → checkpoint` 的真实执行 ceiling。
  - Root 每轮用 `maxRunTokens - cumulative inputTokens - cumulative outputTokens` 计算 remaining tokens；接近上限时会缩小本次 output，最终进入 `awaiting_budget`/`RUN_BUDGET_EXCEEDED`。Frontend 还提供“Increase run budget”路径。
  - `AgentConversation` 与 `TaskRail` 当前把 `run.usage.inputTokens + outputTokens` 除以 `run.budget.maxRunTokens` 显示百分比/进度条；这会把“本任务累计花了多少 Token”误表示成“还剩多少可工作空间”。
  - 累计 usage 与 Context occupancy 是两个完全不同的量：每次模型调用都会再次累计 input tokens，cache hit 也仍有 input/cached usage；因此一个健康长 Run 即使 compaction 后当前 prompt 已明显变小，累计 usage 仍只会上升，最终必然撞 `maxRunTokens`。
  - Nexus 已有正确 Context meter 的基础：冻结模型 `contextWindow`、每次 `ContextPlan.estimatedInputTokens/reservedOutputTokens`、Provider 返回的实际 `inputTokens/cachedInputTokens` 与 stable-prefix/context diagnostics。P-070 已把它们收口成一份 current-context projection。
- **外部对照（2026-09）**：
  - OpenAI Codex CLI 已公开显示 `Context XX% used`，同时继续在 turn usage 中报告 input/cached/output tokens；Codex 主要通过 context window + auto/manual compaction维持长会话。到 2026-07 仍有人单独请求 `codex exec --max-agent-turns`，说明 deterministic iteration ceiling是可选执行控制问题，不是 UI 的累计 Token progress。
  - Claude Code 的 prompt box同样显示当前 context-window usage，并提供 `/context` 详情与 auto/manual `/compact`；它把“上下文还有多少空间”和“套餐/usage 消耗”分成不同产品概念。
  - Hermes Agent 当前默认 `agent.max_turns=none`，明确说明固定 turn cap/中途 budget warning曾让复杂任务过早结束；其默认控制组合是 context compression + retry/fallback + tool-loop guard + 特定高 fan-out cap，而不是父任务累计 Token hard stop。
  - OpenHands 的 `StuckDetector` 证明重复 action/result/error trajectory 可以直接检测，但其 Goal-loop bug也说明阈值过激会误杀正常迭代；因此 Nexus 采用 P-045 的“durable progress + staged response”，不复制简单重复次数 hard stop。
- **目标方向**：
  1. 从 **父 Run execution contract** 删除 `maxRunTokens`：`AgentSettingsDocument.budget/hardLimits`、App execution override、`RunBudget`、budget increase request、checkpoint budget、Root `remainingRunTokens`/reservation、Subagent parent-pool calculation与对应三语言 UI/文案一起收口。当前产品尚未发布，不为这些未使用字段保留 legacy decoder/兼容分支；旧字段出现在当前 API/持久化 contract 时直接视为无效数据。
  2. **保留累计总 Token 消耗**：`RunUsage.inputTokens/outputTokens/cachedInputTokens` 继续 durable 累加，用于详情、成本诊断、cache rate、benchmark与后续 FinOps；删除的是“达到某累计值就不许继续”，不是 usage telemetry。
  3. Agent 主界面保留现有 Token 总数展示，例如 `123k tok` + tooltip 的 input/output/cache breakdown，但取消 `123k / 100k` 和“budget xx%”语义。累计总数可以无限增长，不映射成红黄进度。
  4. `TaskRail`/任务使用进度条改成 **Context Usage**：消费已落地的 P-070 latest `ContextUsage`，显示类似 `74k / 200k · 37%`。百分比表示当前模型请求 prompt 对物理 context window 的占用；`reservedOutputTokens`/source/是否估算放 tooltip/详情，不把历史累计 usage混进去。
  5. Context pressure只触发已落地的 P-064 compaction/projection：soft threshold 提前整理，hard threshold保证下一次模型调用有 headroom；compaction成功后 Context bar 应下降，而累计 Run token counter保持原值。Provider 真实 context overflow 走可恢复 compaction/failure path，不转换成“总预算耗尽”。
  6. 正常长任务**不因累计 Token 消耗终止**。Runaway 改由 P-045 负责：exact failure replay、same-result no-progress、A↔B oscillation、长期无 durable progress，以及 web-search/subagent 等特定 runaway cap；必要时 pause/await user，而不是伪装任务完成。
  7. 本批先**不删除 `maxRunSteps/maxActiveExecutionSeconds`**：它们保留为非常规故障/无人值守场景的 emergency fuse，但 TaskRail 不再把 step fuse画成任务完成进度条，只在 usage/details 中显示累计 step 与必要的 fuse 信息；也不向模型做“预算快用完”的中途施压。P-079 数据稳定后再评估默认是否进一步放宽。
  8. Subagent 同样删除 cumulative `profile.maxTokens/reservedTokens` execution ceiling；保留 `usage.tokens` telemetry，并以 Child-local `maxSteps/maxIterations`、concurrency/depth/fan-out、P-045 loop guard 与各自 physical context window做 containment。若未来无人值守任务需要成本 ceiling，另在 automation/job policy 设计显式 optional cost budget，不回灌 Core Agent Token ceiling。
  9. `increaseRunBudget` 若去掉 `maxRunTokens` 后只剩 step fuse，重新命名/收窄 contract，避免 UI 仍出现“增加 Token 预算”；所有 API/type/i18n/SRS/Checkpoint字段一次性清理，避免第二事实源。
- **明确不做**：不把 context window当成本预算；不把累计 total token 清零来伪装“预算恢复”；不为了防死循环重新加一个更大的 `maxRunTokens`；不让 compaction 改写 Run 累计 usage；不取消模型物理 `maxOutputTokens/contextWindow`。
- **验证**：
  1. deterministic 长任务累计消耗稳定超过旧 100k/1m阈值仍继续，直到真实完成、用户停止或其它明确状态机条件；不出现 `awaiting_budget` 的 Token 原因。
  2. UI 总 Token 数持续累加；Context bar按 latest prompt/window升降，compact 后明显下降，切换不同 context-window 模型后 denominator正确更新。
  3. 同一个长任务多次 compaction 后累计 usage不重置、cache统计不丢；Provider context overflow可恢复而不是把 Run判为 budget exhausted。
  4. exact deterministic Tool failure / same-result polling loop 在远低于旧 Token ceiling 前由 P-045 warning→pause；edit→test→edit、状态变化 polling、长时间但持续产出 evidence 的任务不误停。
  5. 多个 Subagent不再因累计 Token命中 local ceiling而停止；Child达到 iteration/fan-out/depth backstop时只收敛该 Child，Root/peer继续；当前 schema/API 中不再接受或持久化 `maxRunTokens`、delegation `maxTokens/reservedTokens/reservedSteps`。

---

## 本轮已从 Problem 移出的内容

以下类型已经不再作为“当前问题”保留：

- 已由后续提交闭环的问题，例如 Terminal checkpoint（原 P-046）、顶层页面 KeepAlive/revalidate（原 P-047）、编辑器 `Ctrl+/`（原 P-048）、Agent enable effective-state 校验（原 P-052）以及当前 UI 已吸收的 Toast/Auto-save/安全分区/BaseFormField 等问题。
- P-001～P-044 中已经修复、被后续实现取代、仅描述某次 dev/PVE/CDP/公网调试环境或属于阶段性 UI 施工稿的条目；历史仍可从 Git 找回。
- 原 P-049 的“文档收口施工计划”：有效内容已经进入 `AGENT.md`、SRS、工程约束与本轮审计，不再把施工计划本身当问题。
- 原 P-057 Windows Desktop 规划：它是 roadmap/design，不是缺陷，已迁到 `software-requirements/design/special-designs.md` 的 `SD-DESKTOP-001`。

后续新问题继续使用 `P-121` 起的编号；问题闭环并完成验证后直接从本文件删除，不保留“已完成墓碑”。
