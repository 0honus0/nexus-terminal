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
3. **Context / Token / Prompt efficiency**：`P-093 → P-070 → P-069 → P-064 / P-112 → P-063 → P-081 → P-077 → P-075 → P-065 → P-066`。先保证 Tool exchange 不被拆，再统一 context accounting 与 ToolResult projection；之后落 durable compaction、Tool/Skill progressive disclosure、cache hint、Responses continuation、Artifact input 与 Recall。
4. **Model / Provider reliability**：`P-054 → P-082 → P-087 → P-086 → P-090`。先统一 capability authority 与 AgentDefinition requirement，再修 retry attempt identity、fallback chain，最后删 Provider 网络策略死字段；Provider transport 不重新引入 SSRF/private-host policy。
5. **Workspace / Coding / Browser / Remote execution**：`P-071 → P-072 → P-073 → P-067 → P-094 → P-095 → P-099 → P-083 → P-084 → P-107 → P-056 → P-085`。先补 project instructions、coding primitives/background job、repo map，再处理 lifecycle/approval/checkpoint，之后增强 Browser 与跨设备/重启 continuation。
6. **Subagent 能力层**：`P-104 → P-068 → P-088`。Mailbox TTL 先正确，再做 profile/template/context inheritance，最后开放 governed mutation worker；`P-101/P-102/P-103` 已在前置 correctness/执行控制模块解决，不在这里重复改状态机。
7. **MCP / ACP / Plugin 扩展层**：`P-109 → P-078 → P-108 → P-080 → P-115`。先让 MCP health/management 可用，再补 Resources/Prompts/Task 与 ACP inner permission，最后明确 Plugin Tool/AppIntent SDK 边界；`P-105/P-106` 的 race 必须已在前置模块完成。
8. **Memory / Artifact 产品闭环**：`P-114 → P-113`。先把 Memory candidate review/publish/import 主链真正交付给用户，再补 Artifact 单项删除；底层 Artifact durability 由 P-100 先保证。
9. **架构与死合同清理**：`P-118 → P-059 → P-060 → P-062`。删 StateCommit 旁路，再拆超大 owner、收日志与残余 `any`。这些清理不抢在功能 correctness 前，但相关模块修改时可以顺手完成局部项。

**实施约束**：同一批修改完成前先把对应 P-079 scenario 写出；P1 correctness 不与大规模 capability expansion 混成一个提交；跨模块 schema/settings 字段删除遵守 P-061 的兼容策略。上面顺序是默认施工顺序，若某一 Problem 被后续证据证明已闭环则直接从本文件删除，不为了编号顺序强行施工。

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
  6. Context pressure 与 loop detection 解耦：上下文接近模型窗口由 P-064/P-070 compaction/context usage处理；累计 Run usage只做 telemetry。不要因为“花得多”推断“没进展”，也不要因为 context 低就允许确定性死循环无限重试。
- **明确不做**：不恢复父 Run 总 Token 硬预算；不向模型注入 70%/90% “快没预算了赶紧结束”式压力；不把合法的 edit→test→edit、状态变化中的 polling、瞬态 provider retry 误判为循环；不额外引入 judge LLM 作为每步必经路径。
- **验证**：健康 coding/research Run 可以稳定超过旧 `maxRunTokens` 对应用量继续完成；相同 deterministic Tool failure / same result replay 在很少几次内被 warning→pause；中间发生 file hash/Plan/evidence/job progress 后 streak 自动重置；正常测试修复循环不误停；用户 continue 后可从 durable 现场继续。

## P-054 Provider live capability authority 尚未接入 Model Capability Resolver

- **优先级**：P1
- **状态**：`Registry 主体已实现，Provider live ingestion 未闭环`
- **当前事实**：
  - `model-capability-resolver.ts` 已从 reasoning-only 演进为统一 Registry，可提供已知模型的 `contextWindow/maxOutputTokens/supportsTools/reasoning` 默认能力。
  - 持久化模型可以保存相对 Registry 的人工 capability override；未知/私有模型缺少 context/output/tool 必要能力时会报 `MODEL_CAPABILITY_INCOMPLETE`，不会偷偷回退固定 32K/4K。
  - `capabilitySources` 当前只有 `registry/manual`；普通 `/models` discovery 仍只信任模型 identifier。
- **剩余问题**：部分 Provider 如果未来明确返回有版本语义、可验证的 capability metadata，目前没有统一 ingestion/source precedence；若直接在单个 Provider adapter 内特判，会形成第二套能力事实源。
- **要求**：
  1. Provider live metadata 只能作为显式扩展点进入统一 resolver，必须逐字段合并，不能“某来源有一个字段就覆盖整条模型记录”。
  2. 来源优先级、版本、更新时间与冲突处理必须可观察；普通 OpenAI-compatible `/models` 未定义字段不得猜测。
  3. 模型 alias/date variant 的匹配必须精确，宽泛 regex 不得把物理窗口套给不兼容模型。
- **验证**：Provider/Registry/Manual 三来源组合与冲突有覆盖；未知代理模型不会误套公开模型能力；Run snapshot 保持创建时 capability 不漂移。

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
- **状态**：`本轮 archive→main 审计新增`
- **证据**：
  - `packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter.ts` 的泛型 `request<T>()` 在完成 HTTP status/size 检查后直接 `JSON.parse(text) as T`，Runner/Backend 版本漂移或异常响应可以穿过 adapter 边界进入领域层。
  - `packages/backend/src/infrastructure/agent/repositories/sqlite-subagent.repository.ts` 定义通用 `parseJson<T>() => JSON.parse(...) as T`，durable state 的结构正确性依赖写入端永远正确。
  - `packages/agent-runner/src/controller/journal.ts` 对 Journal 仅检查 schemaVersion 与顶层 collection 形状，nested `CommandRecord/WorkspaceRecord/JobRecord` 未做完整 runtime decode。
  - `packages/agent-runner/src/controller/workspace-runtime-catalog.ts` 检查顶层 revision/digest/arrays 后即信任 `RuntimeCatalog` 内部元素。
  - 其它 SQLite repository 也存在直接 JSON cast；不是所有 cast 都同等危险，`JSON.stringify/parse` 仅用于 clone/JsonValue normalizing 的路径不在本问题范围。
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
- **状态**：`本轮 archive→main 审计新增；无消费者内部 shim 已清理`
- **当前事实**：
  1. `PersistedProviderModelConfig` 的 legacy flat capability 字段与 `legacyOverrides()` 用于读取既有 `models_json`；Agent 已进入 `main` 后，这属于真实已发布数据兼容，不能机械删除。
  2. `sqlite-subagent.repository.ts` 对 migration #23 之前缺少 `source_model_step_id` 的 durable Tool row 使用 `legacy:<id>` 分组；这同样是数据库升级兼容。
  3. 本轮已删除无真实 caller 的 `resolveModelReasoningCapability()` compatibility helper 及其仅为该 helper 存在的 `ReasoningCapability` 类型，确认 internal-only 历史 shim 不再因“兼容”名义长期存活。
- **剩余问题**：真实持久化兼容目前能指出来源，但还没有统一写清 from-version、最低支持版本、何时完成数据迁移/回填、何时允许删除 fallback。若长期只写 `legacy*`，最终会无法判断分支是否仍有真实消费者。
- **要求**：
  - Persisted/wire/public contract 的兼容逻辑只放在对应 Interface/Infrastructure decoder/migration 边界，并写清 from-version、to-version、removal condition。
  - 能通过一次 migration 安全规范化的数据优先迁移，不让 Module domain model 永久携带旧字段。
  - Internal-only rename/helper 没有 consumer 就直接删除，不为分支历史保留 alias/adapter。
- **验证**：所有保留兼容分支都能指出真实已发布数据/protocol consumer 与退出条件；达到退出条件后删除 fallback，build/E2E contract 不变。

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

## P-063 Agent Tool Surface 仍以“全量 schema 常驻”暴露，MCP/Plugin 扩张后会直接吞噬 Context 与 Prompt Cache

- **优先级**：P1
- **状态**：`优化设计已立项，待横向方案收敛`
- **当前事实**：
  - Root Agent 每个 model step 通过 `ToolCallRunner.schemas()` → `ToolCatalog.schemas()` 暴露当前环境全部可用 Tool schema；内建 Tool 数量尚可，但 MCP refresh 会把远端每个 Tool 都注册成顶层 `AgentTool`。
  - `ContextService` 已把完整 Tool schema 的 JSON token 计入预算，并记录 `toolSchemaHash/cachedInputTokens/cacheRate`，所以“Tool schema 很贵”已经可观察，但尚未改变暴露策略。
  - `Skill` 已采用 metadata → `skill_read` 的 progressive disclosure，说明 Nexus 已有“索引常驻、正文按需加载”的先例。
- **问题**：MCP/Plugin Tool 增长时，每轮重复发送大量 description/schema，不仅直接消耗 input token，还会让 Tool set 变化频繁破坏稳定 prompt prefix；模型面对大量相似 Tool 时选择质量也会下降。
- **目标方向**：
  1. 保留 `ToolCatalog` 作为唯一 authoritative catalog，不替换 inspect/policy/lease/approval/execution 链；新增的是 **model-facing Tool projection/router**。
  2. 第一阶段优先把高基数 MCP Tool 改成 deferred discovery：模型常驻看到轻量 `tool_search`/`tool_invoke`（最终命名待设计），搜索结果返回 bounded handle + description + 必要 schema，实际执行仍回到原 ToolCatalog/ToolExecutor。
  3. built-in 高频核心 Tool 可以继续直接暴露；是否把 Browser/Workspace/Collaboration 进一步 family 化，必须根据实际 schema token telemetry 决定，不为了“统一”强制所有 Tool 都间接调用。
  4. Tool metadata search 优先考虑本地 BM25/FTS；第一版不引入 embedding/vector service。
- **明确不做**：不新建第二套 Tool registry；不绕过现有 mutation risk/approval/lease；read-only Tool discovery 本身不增加额外 approval/security ceremony。
- **验证**：大 MCP catalog（例如 100+ Tool）下每轮 model request 的 Tool schema token 显著下降；常用 Tool 仍可在有限额外 step 内发现并调用；实际 mutation 的 operation hash、approval、lease、outcome contract 与现状一致；prompt cache 命中率可观测且不因 catalog 小幅变化频繁归零。

## P-064 Context Compaction 仍以丢弃旧 Raw Ledger 为主，缺少 Durable Context Checkpoint / Summary Engine

- **优先级**：P1
- **状态**：`优化设计已立项，待横向方案收敛`
- **当前事实**：
  - `ContextService` 已有 model physical window、reserved output、recent ledger、thread anchor、thread recall、memory recall、goal、plan、collaboration、Skill metadata、Tool schema budgeting，以及 `contextEpoch/stablePrefixHash/messageDiagnostics`。
  - 当前超预算后的核心 compaction 行为仍是按 compaction ratio 删除较旧 raw ledger turn；canonical ledger 本身不会丢，但模型下一轮可能失去早期决策、失败尝试、关键文件/错误和约束。
  - Checkpoint/Resume 已是 Run durability 一部分，但尚未产出独立、可验证覆盖范围的 context summary artifact。
- **问题**：长 coding/research Run 不是简单“记住最后几轮”就足够；只裁旧 raw history 会导致重复探索、重复 Tool 调用、忘记用户约束，最终既损能力又浪费 token。
- **目标方向**：
  1. 将 Context 规划从单一 `ContextService` 演进为可替换策略的 `ContextEngine`（最终接口名待设计），至少区分 projection 与 compaction/checkpoint 责任。
  2. canonical Ledger 仍是事实源；新增 `ContextCheckpoint` 只保存派生摘要，至少包含 covered sequence/prefix hash、summary、生成模型/策略版本、token 统计，使 resume 时能验证“摘要对应哪段 canonical history”。
  3. 默认 summary 结构优先覆盖：Objective、Constraints/User decisions、Completed work、Current state、Failed/ruled-out attempts、Pending work、Relevant files/artifacts/evidence、Next action；保留 recent verbatim tail。
  4. 区分 **soft / hard compaction trigger**：soft trigger 只在摘要能产生足够净缩减时运行，并保留稳定的开场 anchor + recent verbatim tail；hard trigger 接近物理 context limit 时必须保证能收敛，摘要失败则回退到现有 drop-only projection。不要为了只省几百 token 固定多打一轮 summarizer。
  5. compaction 可以使用当前模型或可配置的便宜模型，但生成结果必须带策略/模型版本和最小 shrink telemetry；失败不得阻塞 Run durability。
  6. summary 只作为 context optimization，不替代 Memory、Plan、Artifact、Ledger 任何 authoritative owner。Subagent lifecycle/result/capacity、pending approval/input/background job 等 durable control state 必须重新 projection，不能只存在于可能被摘要掉的对话文本里；并且应在 history 选择前为当前 Goal / Plan / Collaboration 等 control-state projection 预留预算，不能先让 raw history 占满窗口再把当前控制状态丢掉。
- **明确不做**：不把 summary 变成新的业务事实源；不为了摘要增加复杂审批/安全状态机；不把全部历史每轮重新摘要。
- **验证**：长任务跨多次 compaction 后仍能准确保留用户约束、已排除方案和当前工作状态；resume 可验证 checkpoint coverage 后继续；canonical Ledger 可重建 projection；相同 benchmark 下重复读取/重复失败尝试下降，token/step 使用可量化改善。

## P-065 Recall / Earlier-thread Retrieval 仍采用大范围扫描 + JS Substring 排序，缺少索引化第一阶段检索

- **优先级**：P1
- **状态**：`优化设计已立项，待横向方案收敛`
- **当前事实**：
  - Memory recall 当前从 SQLite 取最多 1000 条 published candidate，再在 JS 中按 query term substring + confidence + freshness 排序。
  - Earlier-thread recall 最多扫描 800 条 ledger item，并使用类似 lexical substring score。
  - 当前 Recall 数据规模尚能工作，但每轮扫描与 CJK n-gram 逻辑会随历史增长线性增加，且相关性表达有限。
- **目标方向**：
  1. 第一阶段优先使用 SQLite FTS5/BM25（或同等级本地索引能力）在 scope/thread 条件内先选 top candidates，再复用 Nexus 的 confidence/freshness/recency 业务 rerank。
  2. Memory 与 thread retrieval 可以共享检索思想，但保持各自 repository/owner，不造一个跨领域 mega search service。
  3. 只有真实评测证明 lexical recall 不够时，再评估 embedding rerank；第一版不引入独立 Vector DB、embedding daemon 或远端检索服务。
  4. 索引更新必须跟随 authoritative write transaction 或可恢复的增量 rebuild，不让索引成为新的事实源。
- **明确不做**：不为了“AI 化”默认引入向量数据库；不把所有 Artifact/File 内容无界索引进 memory context。
- **验证**：同等 recall budget 下相关命中不低于现状；查询不再扫描 800/1000 条候选；CJK/英文典型 query 有覆盖；索引缺失/损坏可以从 canonical 数据重建。

## P-066 Skill Progressive Disclosure 已有雏形，但格式与发现机制尚未对齐主流 Agent Skills 生态

- **优先级**：P2
- **状态**：`优化设计已立项，待横向方案收敛`
- **当前事实**：
  - Nexus signed plugin Skill 已支持 frontmatter metadata、hash/version/capability/trust 校验；模型默认只看到 metadata，需要时通过 `skill_read` 读取正文。
  - 当前每轮仍会把全部 Skill metadata 拼入 system instructions；Skill 数量变大后同样会形成固定 token 成本。
  - Skill 文档结构是 Nexus 自有格式，尚未明确兼容 Agent Skills / `SKILL.md` 生态。
- **目标方向**：
  1. 评估兼容主流 Agent Skills 文档约定，使第三方 Skill 内容可以低成本导入；Nexus 继续在外层保留 plugin signature、publisher、capability、hash/version 等产品元数据。
  2. Skill 数量较少时可以继续直接暴露 metadata；达到阈值后通过 `skill_search`/metadata retrieval 只注入高相关 Skill，再由 `skill_read` 加载正文。
  3. Skill search 与 P-063 Tool search 尽量共享成熟的 lexical index primitive，但两者 contract/owner 不混在一起。
- **明确不做**：不因为兼容开放 Skill 格式而取消现有 signed-plugin trust/capability contract；不把 Skill body 常驻 prompt。
- **验证**：现有 signed Skill 行为不回退；标准 Skill 文档可以映射进 Nexus；大量 Skill 下 system token 不随 Skill 总量线性增长；Skill 触发准确率有可重复测试。

## P-067 Coding Agent 缺少 Repo Map / Symbol Graph，当前主要依赖逐文件 Search/Read 探索代码库

- **优先级**：P1
- **状态**：`优化设计已立项，待横向方案收敛`
- **当前事实**：Workspace/SSH/Runner 已能执行命令、读写文件和运行真实开发工具，但 Nexus 没有独立的 code intelligence/context owner；模型需要通过 shell/search/read 反复探索目录和源码关系。
- **问题**：对大型仓库，盲目 `find/rg/read` 会消耗大量 tool step 与 context；模型在修改前也缺少稳定的 symbol/reference overview，容易漏掉跨文件调用方。
- **目标方向**：
  1. 增加 bounded Repo Map / Code Index capability：按 task query 输出文件、symbol signature、import/reference/dependency 的高价值摘要，并设置明确 token budget（优先 1–2K 级，而不是把源码塞进 prompt）。
  2. 语义 code intelligence 优先复用 Workspace 已安装 toolchain 的 **LSP / compiler service**（definition/references/diagnostics/symbols）；TypeScript/Vue 可直接复用 TS/Vue language tooling，通用轻量 fallback 再使用 tree-sitter/静态 parser。不要用 regex 自研语言 parser，也不把常驻中央 LSP 集群作为 Nexus 启动前提。
  3. Repo Map 与按需 code-intel 分层：Repo Map 提供 bounded 文件/symbol/import overview；definition/reference/diagnostic 需要时再查询 language service。没有 language server 的语言仍可回退到 static index + `workspace_search/read_file`。
  4. Repo Map 是导航/检索能力，不替代真实文件读取；Agent 在编辑前仍对目标文件读取 authoritative content。
  5. 索引允许 lazy build/incremental update，并绑定 workspace generation/revision/文件 hash，避免把陈旧 symbol map 当事实。
- **明确不做**：不引入常驻重型 language-server 集群作为第一版前提；不把静态索引结果直接授权 mutation。
- **验证**：代表性 multi-file coding task 的前置 read/search step、input token、漏改引用数下降；索引 stale 时能检测并重建/回退；未支持语言仍可使用现有 shell/read 路径。

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
  5. Root Context 始终从 durable collaboration owner 重新投影一个 bounded child lifecycle 摘要（delegation id/profile/status/objective/result/evidence/capacity），不能依赖“之前某轮模型记得自己 spawn 过谁”。因此 P-064 compaction/checkpoint 后不会丢 child 状态，也避免 full-history fork 带来的 token/storage 放大。
  6. 可继续使用更快/便宜模型处理 Explore/Scout，但只通过现有 Provider/Model capability contract 配置，不写死厂商 model id。
  7. P-120/P-103 落地后，内建模板与 Profile UI 不再展示/依赖 cumulative Child Token ceiling；仍展示累计 token usage telemetry，并只暴露真正有执行语义的 step/iteration、depth、concurrency/fan-out 等 containment。
- **明确不做**：不引入新的 Multi-Agent framework；不新增第二套 profile storage/router；不强制所有任务 fan-out；不增加 Agent 投票/自治社会等复杂机制；不为了模板管理重新引入 Child cumulative Token budget。
- **验证**：代表性大型代码探索/资料检索任务中 root context token 或 wall-clock 至少一项改善且质量不回退；小任务不会无意义 spawn child；child context 明显小于 root context；现有自定义 profile 行为保持兼容。

## P-069 Tool Result 仍缺统一的 Model-facing Projection，长日志/搜索/MCP 结果会重复占用 Context

- **优先级**：P1
- **状态**：`优化设计已立项，待横向方案收敛`
- **当前事实**：Tool 已有 raw/output byte hard limit、Artifact 引用和部分 tool-specific summary/truncation，但“什么进入下一轮 model context”仍主要由各 Tool 自己决定；shell/build/test/log/search/MCP 大结果容易形成高 token tool message。
- **目标方向**：
  1. 增加统一的 `ToolResultProjection`（最终名称待设计）：raw evidence 保留在 Artifact/现有 owner，model 默认看到 bounded summary + error/high-signal lines + head/tail + size/hash + artifactRef。
  2. 对结构化 Tool 优先返回 schema-aware compact JSON；对文本日志提供行数/错误提取/去重；需要全文时通过已有 Artifact/File 路径按需读取。
  3. Projection 策略按 Tool family 可扩展，但公共 token/byte budget 与 telemetry 统一，避免每个 Tool 私自发明截断规则。
  4. MCP 返回的 `content/structuredContent` 要纳入同一 projection，而不是因为来自远端就直接全量进入 context。
- **明确不做**：不删除 raw evidence；不默认用额外 LLM 调用总结每个 Tool output；第一版优先 deterministic projection。
- **验证**：大日志/build/search/MCP fixture 下进入下一轮的 tool-result token 明显下降，仍能从 artifactRef 精确追溯完整结果；错误定位/后续修复成功率不低于现状。

## P-070 Context Token Accounting 主要依赖 UTF-8 bytes/4，已有 Provider Usage/Cache 诊断尚未反哺预算模型

- **优先级**：P2
- **状态**：`优化设计已立项，待横向方案收敛`
- **当前事实**：
  - `ContextService` 与 Subagent context 主要以近似 token estimator 做预预算；模型完成后已有真实 `inputTokens/outputTokens/cachedInputTokens`，并记录 `contextEpoch/stablePrefixHash/toolSchemaHash/cacheRate`。
  - Ledger candidate 与 `messageDiagnostics` 当前只对 `message.content` 调 `estimateTokens()`；assistant Tool-call 的 `toolCalls[].name/argumentsJson` 不计入历史 token。实测一个包含约 2 KiB Tool arguments 的 assistant message 仍只记为 1 token，因此 P-093 的 compaction 边界还会被进一步扭曲。Subagent 的 `encodedContext` 也只拼 `message.content`，同样遗漏历史 Tool-call structured parts。
- **问题**：对 CJK、JSON schema、代码和不同 tokenizer，bytes/4 会产生较大误差；同时遗漏 Tool-call structured parts 是确定性的系统性低估。预算过保守会浪费 context，过乐观会导致 provider 侧 context overflow、错误 compaction 或把 Tool exchange 拆坏。
- **目标方向**：
  1. 保留轻量 heuristic 作为首轮/未知模型 fallback；加入 `ContextUsageAnchor`（最终名称待设计），把上一轮同一 context lineage 的 provider actual usage 作为基准，只估算之后新增/删除 delta。
  2. 如果 `@ai-sdk/openai` 或 Provider 能稳定暴露模型 tokenizer/usage metadata，可作为可选增强；不要求为每个第三方 compatible model 集成专属 tokenizer。
  3. 所有 model-facing content part 都必须进入估算：text、assistant tool-call name/arguments、tool-result、未来 P-075 image/file metadata 与 P-077 opaque continuation；候选选择、compaction 与 diagnostics 共用同一个 estimator，不允许 selection 与 telemetry 口径不同。
  4. 把 context 分项 token telemetry 固化：stable instructions、Tool schema、Skill metadata、raw/recent history、summary checkpoint、recall、tool calls/results、cached vs uncached，作为 P-063/P-064/P-069/P-093 的优化验收依据。
  5. 为 P-120 提供唯一 `ContextUsage` projection：至少包含 latest prompt `usedTokens`、`contextWindow`、`source=provider|anchored_estimate|estimate` 与可选 `reservedOutputTokens`。UI 的 Context 百分比基于**当前一次模型请求的上下文占用**，而不是 Run 累计 input/output；compaction 后该值应真实下降。
- **明确不做**：不为了精确 token 计数引入远端 tokenizer service；未知模型仍允许保守 fallback；不拿累计 Run usage 反推当前 context occupancy。
- **验证**：连续 model step 的 estimated vs actual input token 误差可观测并显著低于纯 bytes/4；compaction threshold 更稳定；不同语言/代码/JSON fixture 有基准测试；长 Run 即使累计 Token 持续增加，Context usage 仍随 projection/compaction 正确升降。

## P-071 Workspace 缺少 Repo-scoped Project Instructions Owner，尚不能自动遵守 `AGENTS.md` 等仓库约定

- **优先级**：P1
- **状态**：`横向方案基本收敛，待并入最终设计`
- **当前事实**：全仓当前没有 `AGENTS.md` / `CLAUDE.md` / project-context loader 对应的 Agent runtime owner；Workspace 默认逻辑工作目录为 `/workspace/work`，Coding Run 因此只能依赖用户输入、Skill、Memory 或模型自己读取 README/文档来推断仓库约定。
- **主流实践对照**：
  - Codex 将 `AGENTS.md` 作为一等 project instruction：从 repo root → cwd 合并，nested file 对其目录树生效，更深层规则覆盖更泛规则。
  - Claude Code 使用 `CLAUDE.md`/rules，root→cwd 加载，并在真正进入子目录时才加载 nested instructions，避免启动 prompt 无界膨胀。
  - Hermes 同样支持 `AGENTS.md` chain + progressive subdirectory discovery；OpenHands 也将 repo instructions / repo skills 作为仓库上下文。
- **目标方向**：
  1. Nexus 第一版以 **`AGENTS.md` 为 canonical project instruction filename**；`/workspace/work` 内向上只走到项目 root，不读取 Workspace 外部 HOME/host parent。
  2. Project root 优先使用 `.git`/worktree metadata 判定；没有 repo marker 时仅使用当前 work root，不向更高目录猜测。
  3. Root→target directory 按作用域加载；更深层 instruction 后置并覆盖冲突。Nested `AGENTS.md` **按需**在 read/search/patch/execute 涉及对应路径时进入 Context，不在 Run 启动时扫描全树。
  4. 每个文件与总量有独立 token/byte budget，并记录 path/hash/provenance；ContextCheckpoint 只引用当前有效 instruction snapshot/hash，不把其内容复制成 Memory。
  5. 可提供 `CLAUDE.md` 等 fallback/import 兼容，但第一版不默认同时合并多个 vendor 格式；有 `AGENTS.md` 时不再自动叠加其它规则文件，避免冲突和 token 膨胀。
- **安全边界保持轻量**：Repo instruction 是项目上下文，优先级低于 Nexus system contract 和当前用户输入；不额外做复杂 prompt-injection 扫描/审批系统，继续依赖现有 Tool capability/approval 对真实动作做边界控制。
- **验证**：monorepo root/nested instruction scope 与 precedence 有 E2E；进入 unrelated subtree 不消耗其规则 token；修改/读取文件前能看到正确 scoped instructions；无 `.git` 的普通 Workspace 不会读取 `/workspace` 之外的文件。

## P-072 Workspace Coding Tool Surface 过于底层，缺少一等 Read/Search/Incremental Patch

- **优先级**：P1
- **状态**：`横向方案基本收敛，待 patch contract 最终确认`
- **当前事实**：
  - Coding Workspace 主要依赖 `workspace_execute_argv` 执行任意 argv；该 Tool 作为通用执行能力按 mutation 管理，所以在 `approvalMode=ask` 下连 `rg/git status/test` 这类正常开发读取/验证也会产生额外操作摩擦。
  - `machine_write_file` 是从 Artifact 做整文件 replacement，并不适合作为频繁代码局部修改 primitive。
  - Nexus 已有 `approvalMode=ask | full_access` 并完整贯通 Backend；**不需要再新增 autonomy/permission mode**。
- **主流实践对照**：Codex/Cline/Claude Code 都将 read/search/edit 与通用 shell 分开；Cline 当前 built-in 明确提供 batch read、ripgrep search、unified `apply_patch` 与 bash。Aider 也长期证明 whole-file edit 成本高，search/replace/diff 更适合 Coding Agent；mini-SWE-agent 则提醒 Tool 不应无限细分。
- **目标方向**：第一版只增加最小高价值集合：
  1. `workspace_read_file`：支持 path + bounded line/byte range，返回 hash/size/line metadata；read risk。
  2. `workspace_search`：优先直接使用 Runner 内可用 `rg`（不存在时有受限 fallback），支持 query/path/glob/maxResults/contextLines，输出严格有界；read risk。
  3. `workspace_apply_patch`：接受受限 unified diff + 每目标文件 `expectedSha256`（或等价 precondition）；使用成熟 patch library 做 **strict apply (`fuzz=0`)**，支持非 Git Workspace，不通过 shell `git apply` 假定 repo 类型；mutation 继续走现有 ask/full_access、operation hash、lease/outcome contract。
  4. 每次 patch 产出可审计的 change evidence：目标路径、before/after hash、bounded diff summary；大 diff spill 到 Artifact。需要整体 review 时提供一个只读 `workspace_changes`（最终名称待定）汇总本 Run/Workspace 的已确认文件 mutation，Git repo 可复用 `git diff --no-ext-diff` 增强展示，非 Git Workspace 仍以 mutation journal/hash 为事实源。
  5. `workspace_execute_argv` 保留作为 build/test/git/package-manager/脚本等 escape hatch，不再继续拆出几十个特殊 Coding Tool。
  6. P-071 Project Instructions 与未来 P-067 Repo Map 都通过这些 path-aware Tool 获得访问事件/目标路径，不各自重复解析 shell 文本。
- **明确不做**：不新增复杂 shell allow/deny DSL；不实现自有 diff 语法；不要求 Git；不把 Git index/commit 当 Nexus mutation authority；不以 whole-file write 作为普通局部编辑路径；不删除 argv escape hatch。
- **验证**：常见定位→读取→局部修改任务不需要 shell 拼装；小改动 output token 明显低于 whole-file rewrite；stale hash/ambiguous patch fail cleanly；ask/full_access 语义保持现状；非 Git workspace 也能 patch；用户/Root 可以从 change evidence 精确看到本 Run 改了哪些文件而无需重新扫描整个仓库。

## P-073 Runner 已有 Durable Job Journal，但 Agent-facing Workspace Tool 仍同步轮询，缺少 Background/Wait 语义

- **优先级**：P1
- **状态**：`横向方案基本收敛，待事件唤醒细节确认`
- **当前事实**：Agent Runner 已经持久化 `jobId/status/result/error`，Controller 接受 job 后异步执行并可查询；但 Backend `RunnerHttpAdapter.invoke()` 会内部约每 250ms 轮询至 terminal state，`workspace_execute_argv` 因而对模型表现为同步阻塞调用。
- **问题**：长 build/test/server/CI wait 会占住 Agent step；模型若需要同时做其它分析只能串行等待。若把 polling 暴露给模型又会浪费 model turn/token。
- **主流实践对照**：Hermes 将 terminal foreground/background 分离，background 返回 session id，`process wait/poll/log/kill` 管理；完成 watcher 可以直接触发新 Agent turn，并且 standing-goal 在等待 background process 时会 park，不消耗 continuation turn。
- **目标方向**：
  1. 扩展现有 `workspace_execute_argv`（或同 owner 的兼容版本）支持 `mode: foreground | background`；background 在 Runner 接受 job 后立即返回 durable `jobId/status`。
  2. 增加一个小型 `workspace_job` 控制 Tool，优先只提供 `status/wait/cancel` 与 bounded output tail；不要为 list/log/tail/wait 各造一个 Tool。完整输出仍走 Artifact/结果投影。
  3. `wait` 是 **server-side wait**：Backend/Runner 自己等待 terminal/timeout，一次 Tool call 返回，不让模型反复 poll。
  4. 后续可用 Scheduler/EventHub 在 job terminal 时 wake 对应 Run，实现真正 event-driven resume；第一版如果事件桥会显著扩大改动，可先以 background + explicit `wait` 落地，但不能要求模型 250ms/秒级轮询。
  5. Background job 绑定 workspaceId/generation/run/runtime provenance；Workspace stop/restart/delete 继续复用 Runner 已有 abort/reconcile 逻辑。
- **明确不做**：不另建第二个任务队列/进程管理系统；不暴露 host PID 作为产品 identity；不让模型自己实现 busy polling。
- **验证**：长 test/build 可后台启动后继续其它 read/search；`wait` 不新增 model turn；Run resume 仍能查询已有 durable job；Workspace generation 切换后旧 job 不会被误认为新环境结果。

## P-074 Run Completion 当前只有 `completed_unverified` 正常成功路径，已有 Tool/Plan Evidence 尚未汇总成 Completion Gate

- **优先级**：P1
- **状态**：`横向方案基本收敛，待最终 contract 设计`
- **当前事实**：
  - ToolResult 已有 `verification.status/evidenceRefs`；Plan item 已有 `evidenceRefs`；Run schema 也定义 `verificationStatus = verified | unverified | failed | not_started`。
  - 但当前 Root model 在“无 Tool call + 无 active child”时直接 `settleModelStep(... terminalStatus: completed_unverified)`；StateCommit 同时把 `goal_status` 写成 `satisfied`、`verification_status` 写成 `unverified`。当前 main 没有正常路径把成功 Run 提升为 `verification_status='verified'`。
- **主流实践对照**：Codex 主要通过 project instructions/base prompt 要求先跑相关测试再完成；Hermes 的 persistent goal 进一步提供 completion contract、deterministic quality gate，然后才可选轻量 judge，并且 verify-on-stop 默认可关闭，避免所有任务固定多一次模型调用。
- **目标方向**：
  1. 在现有 Run/Plan/Tool verification 字段上增加 **Completion Gate**，不新建第二套 verification 状态模型。
  2. 默认 deterministic-first：若 Run 有明确 completion criteria / completed Plan item evidence / 最近 mutation 后的 test/build/check Tool evidence，则根据可验证事实判定；配置的 quality gate command 必须 exit 0 才能完成。
  3. 没有任何需要外部验证的问答/解释型任务仍允许 `completed_unverified`，不要为了形式主义强制跑测试或额外 LLM。
  4. Coding/mutation Run 若 evidence 明显不足，第一次 model 想结束时返回一个 bounded continuation notice（说明缺什么证据），让同一 Run 继续验证，而不是立刻终止后要求用户说“继续”。
  5. 可选 `review` subagent/profile 或 auxiliary judge 只用于复杂/用户启用场景；不是默认 completion 前置，也不取代 deterministic gate。
  6. 与 P-045 Progress Guard 配合：红 gate/新验证证据算 progress；相同 gate failure 重复达到阈值后停止，不无限自我修复。
- **明确不做**：不默认每个 Run 多调用一次 judge model；不把“模型说已完成”当 verified；不把 unrelated failing test 变成强制修复范围。
- **验证**：明确要求“测试通过”的 coding task 不会在测试未跑/失败时提前完成；纯解释任务无需额外 Tool/模型调用；verification status 能真实出现 `verified`；重复同一失败 gate 有 bounded stop；resume 保留 completion evidence。

## P-075 Artifact 已进入 Run/Thread durable contract，但模型没有通用读取/多模态输入路径

- **优先级**：P1
- **状态**：`功能完备性审计确认，待最终 contract 设计`
- **当前事实**：
  - Frontend 已支持 Artifact Library / Picker，创建或追加 Run input 时会提交 `artifactRefs`；Run/Checkpoint/Subagent/mailbox 也都能 durable 保存 Artifact ref。
  - 但 `ModelMessage.content` 当前仍只有 `string`；`ContextService` 组装 user input 时只投影文本，`artifactRefs` 不会转换成 model-facing text/file/image part。
  - `ToolCatalog` 当前也没有通用 `artifact_read`；现有 `ArtifactService.read()` 主要由 HTTP/Workspace transfer/plugin package 等 Host 路径消费。因此模型即使知道一个 Artifact UUID，也没有稳定、provider-neutral 的能力读取它。
  - Subagent 的 `inputArtifactRefs` 同样只是引用列表；`SubagentContextBuilder` 会把 ref 写进 objective/context metadata，但不会读取对应内容。
- **问题**：产品 UI 表面上已经支持“附件”，但 Agent 目前无法可靠理解附件内容；文档、代码、日志、截图/图片任务都可能退化成模型只看到 UUID。这个断点同时影响 Root Agent、Subagent、Checkpoint resume 与 Plugin App 体验。
- **目标方向**：
  1. 先增加 provider-neutral 的 **Artifact read/projection**：提供 bounded metadata + ranged text/binary read，文本类 Artifact 可按 UTF-8/line range 返回，完整大文件继续保留在 Artifact owner，不整包塞入 Context。
  2. 对 Run input 的附件先注入轻量 metadata（id/name/mediaType/size/hash），让模型按需调用 Artifact read；小型文本附件可在明确 token budget 内直接 projection，避免每个小文件固定多一步 Tool。
  3. 扩展 `ModelMessage` 为 typed content parts，使支持多模态的模型可直接接收 image/file part；capability resolver 增加显式 multimodal/input capability，不根据 model id 猜测。
  4. Provider 不支持 native file/image 时必须有 deterministic fallback：文本类走 Artifact read；二进制/图片至少保留 metadata + Artifact ref，并由可用的 Tool/Skill/Integration 决定是否进一步解析。
  5. Subagent 只继承 delegation 明确列出的 Artifact，且采用同一 read/projection contract，不复制 Root 全部附件内容。
- **明确不做**：不把所有附件在 Run 启动时全文塞进 prompt；不把实现绑死在 OpenAI Vision/Responses；不新增第二套文件存储；不让 Artifact 内容绕过现有 App/Run scope。
- **验证**：纯文本/代码附件能被 Root 与 Child 准确读取；大附件只按需消耗 token；支持 image input 的模型能真实收到 image part；不支持多模态的第三方 OpenAI-compatible provider 仍可正常运行；Checkpoint/resume 后 Artifact ref 仍可读取且 hash/provenance 一致。

## P-076 Agent 缺少一等 `request_user_input` / Clarification 状态，信息不足时只能猜测、结束或等待用户主动追加

- **优先级**：P1
- **状态**：`功能完备性审计确认，待状态机设计`
- **当前事实**：
  - Nexus 已支持用户主动 `appendInput`、Run input revision、pending input/interrupt/replay，以及 approval/budget 等 durable wait state。
  - 但 Runtime Tool surface 没有 `request_user_input` / `clarify`，Run status 也没有表达“Agent 已提出一个问题，正在等待用户回答”的一等语义。
  - Approval 只应用于 governed operation，不应该被复用成普通产品澄清；Mailbox 则是 Agent↔Agent，不是 Agent↔User。
- **主流实践对照**：Claude Code、Cline/Roo、Hermes 等主流 Agent 都允许 Agent 在执行中主动向用户提问，通常支持结构化选项和自由文本；这能降低不必要猜测、错误 mutation 与无效 token 消耗。
- **目标方向**：
  1. 增加 Host-owned read/control Tool `request_user_input`：支持一个 bounded question batch，每题可为自由文本或有限 choices，并允许 optional recommended/default context，但不得替用户作答。
  2. Tool commit 后 Run 进入明确 `awaiting_input`（或等价的一等 durable wait reason），释放 scheduler/runtime slot，不持续消耗 model turn。
  3. 用户回答继续复用 canonical `user_input` + input revision；回答与 request id/correlation 关联后唤醒同一 Run，不另建聊天/消息事实源。
  4. Context 只恢复“问题 + 用户回答 + 必要 surrounding state”，避免等待前完整上下文重复注入；P-064 ContextCheckpoint 可承担长等待恢复。
  5. UI 在 Conversation 中展示普通问题卡/choice，而不是 Approval Card；没有回答时可取消 Run或继续追加普通输入。
- **明确不做**：不把 clarification 当 approval；不增加复杂表单 DSL；不允许无限提问循环，P-045 progress/loop guard 继续生效；简单任务不鼓励为了确认而确认。
- **验证**：需要路径/方案/账号目标等关键信息的任务能 durable park→回答→继续；等待期间没有额外模型调用；refresh/reconnect 后问题仍存在；回答进入 canonical Ledger；连续无进展提问会被 bounded guard 终止。

## P-077 Responses + Reasoning Tool Round-trip 丢失 Provider Continuation Metadata，可能破坏无状态推理模型的连续执行

- **优先级**：P1
- **状态**：`模型协议审计确认，待 provider-neutral continuation contract 设计`
- **当前事实**：
  - Provider transport 已统一使用 `@ai-sdk/openai`，并支持 `chat-completions | responses` 双协议；Responses 路径使用 `store:false`。
  - AI SDK LanguageModel V4 对 Responses reasoning/tool output 会产生 `reasoning-*`、custom/provider metadata，例如 OpenAI `itemId`、`reasoningEncryptedContent` 等；在 `store:false` 下 SDK 会通过 `reasoning.encrypted_content` 支持 stateless continuation。
  - Nexus 当前 `ModelEvent` 只保留 `message.delta / tool.delta / usage / completed`；`ModelStepRunner` 与 Ledger assistant payload 也只持久化可见 text + toolCalls。上述 continuation metadata 会在 Tool round-trip 前丢失。
- **问题**：普通 Chat Completions 模型通常不受影响，但 Responses reasoning model 在第一次 Tool call 后，下一次请求可能缺少 provider 需要的 opaque reasoning/item continuation，造成推理质量下降、重复 reasoning、provider warning，甚至部分模型请求失败。
- **目标方向**：
  1. 在 LanguageModelPort 增加 **opaque provider continuation part/state**，只允许 JSON-serializable、size-bounded、provider/protocol/version 标记的数据通过；Core 不解释 vendor 内部字段。
  2. Adapter 从 AI SDK reasoning/custom/tool-call provider metadata 提取 SDK 已公开要求 round-trip 的最小状态；下一次 prompt 重建时原样映射回对应 assistant content part/providerOptions。
  3. continuation 跟随具体 model step/assistant Tool round 固化，Checkpoint/resume 必须能恢复；协议/provider/model configuration 变化时不得跨边界复用。
  4. reasoning **文本内容不是产品事实源**：默认不展示、不进入 Memory/Recall/Project Instructions，也不作为 Completion evidence；若 SDK 只需要 encrypted/opaque content，就只保存 opaque content。
  5. Chat Completions/不返回 continuation 的第三方 provider 继续走当前简单路径，不强制伪造 metadata。
- **明确不做**：不展示或持久化模型隐藏思维链作为用户可见功能；不自研 OpenAI Responses SSE/事件解析；不让 Core 依赖 OpenAI 私有字段名做业务判断。
- **验证**：Responses reasoning 模型连续完成“reason→Tool→result→reason→Tool/final”至少两轮；adapter round-trip fixture 验证 opaque metadata 未丢失；Chat Completions 与普通第三方 provider 行为不变；Checkpoint resume 不破坏 continuation provenance。

## P-078 MCP Integration 当前只投影 Tools，尚未利用 Resources/Prompts 与长任务能力，标准协议能力存在明显缺口

- **优先级**：P2
- **状态**：`协议完备性审计确认，待与 P-063/P-073/P-066 合并设计`
- **当前事实**：
  - Nexus 使用 `@modelcontextprotocol/client@2.0.0`，Integration pin `2026-07-28`，并已实现 Streamable HTTP、schema refresh、`tools/list`、`tools/call`、动态 ToolCatalog contribution。安装的 Client API 本身已经提供 `listResources/readResource`、`listPrompts/getPrompt`、Tasks 与 multi-round `input_required` 支持，因此这部分不需要自研协议 codec。
  - `McpRuntimePort`/`McpAdapter` 当前仍只封装 Tool：没有把 Resources/Prompts/Tasks 暴露为 Nexus product contract，也没有把 resource/prompt metadata 作为 model-facing discovery source。
  - Tool snapshot 已保存 MCP `annotations`，但 `createMcpTools()` 完全不消费它们，当前每个 MCP Tool 都硬编码为 `riskClass: 'mutate'` / `mutation: true`；因此即使 Server 明确声明 `readOnlyHint`，普通读取也会进入 mutation approval 路径。
  - 当前 MCP Client 明确配置 `inputRequired: { autoFulfill: false, maxRounds: 0 }`。在 2026-07-28 的 multi-round-trip 语义下，需要 elicitation/input 的 Tool/Resource/Prompt 无法继续；这与 P-076 的 Agent durable clarification 正好是同一个产品能力。
  - P-063 已计划高基数 Tool deferred discovery，P-066 已有 Skill progressive disclosure，P-073 计划复用现有 durable background job；因此 MCP 扩展不应各自再造平行机制。
- **目标方向**：
  1. 第一阶段优先补 MCP **Resources metadata discovery + bounded read**，并接入与 Tool/Skill 相同的 deferred/local lexical search 思想；Resources 是远端 evidence，不直接升级为 system instructions。
  2. MCP Prompts 作为可选模板/Skill-like 内容处理：默认只索引 metadata，用户/Agent 明确选择后再 `get`；不要把全部 Prompt 常驻 system context。
  3. 对远端高基数 Tools/Resources 统一考虑 catalog TTL/schema hash/version invalidation，避免每轮全量 refresh/list。
  4. MCP Tasks 只映射为 P-073 同类的 remote background handle：保存 server/task provenance，提供 bounded status/wait/cancel/result projection；Nexus Run/Workspace job 仍是本地 authoritative lifecycle，不复制第二套 scheduler。
  5. MCP annotations 只作为 **behavior/risk hint**：缺失/未知默认保持当前保守 mutation；只有 Integration 被用户明确标记为可信 annotation source 时，`readOnlyHint=true` 才可映射为 read-only Tool projection，`destructiveHint/idempotentHint/openWorldHint` 用于 warning/retry/telemetry。无论如何 annotations 都不能绕过 capability scope、operation hash、lease 或现有 deterministic policy。
  6. 把 2026-07-28 `input_required` 接到 P-076 的同一个 durable user-input request：MCP call park → 用户回答 → 带 opaque `requestState`/inputResponses 重试原请求；不让 SDK 在 Backend 内弹出隐式交互，也不新建 MCP 专用聊天状态。Client v2 对该协议代际已把旧 server-initiated sampling/roots 标为 deprecated，因此不再把“补 sampling/roots”当 Nexus 完备性目标。
  7. 远端 Tool/Resource/Prompt/Task result 统一经过 P-069 model-facing projection 与 Artifact spill，避免大结果直接污染 Context。
- **明确不做**：不为追求“协议全覆盖”实现 Nexus 当前没有产品用途或在当前协议代际已 deprecated 的 capability；不把 MCP annotation 当安全保证；不让 MCP Resources 变成 Memory 事实源；不让远端 Prompt 获得高于 Nexus system/user 的优先级。
- **验证**：支持 Resources/Prompts 的 MCP fixture 可 list/search/read/get 且有明确 byte/token 上限；`input_required` 可 durable park→用户回答→续回原请求；Task 可映射到 bounded wait/result 且不重复提交；高基数 MCP server 不线性膨胀基础 prompt；schema/resource 变化能 invalidation；现有 Tool invoke contract 不回退。

## P-079 Agent 缺少专门的行为/成本 Eval Harness，后续 Context/Tool 优化没有可重复质量基线

- **优先级**：P1
- **状态**：`优化前置能力，待 benchmark corpus 设计`
- **当前事实**：
  - 当前 Agent 产品 E2E 主要集中在 `host.spec.ts`、`preset-plugin.spec.ts`、`provider.spec.ts`，能覆盖真实产品路径/UI/Provider contract，但没有专门衡量 Agent 多步任务质量、重复 Tool 调用、context token、compaction 后约束保持等行为指标。
  - Runtime 已拥有 `usage.inputTokens/outputTokens/cachedInputTokens/steps`、context diagnostics、Tool/Plan/verification durable events，实际上已经具备建立 deterministic metrics 的大部分观测面。`messageDiagnostics` 本身只保存 role/hash/token estimate，当前没有为观测而复制整份 prompt 的额外数据膨胀。
  - Backend package 当前没有独立 Agent unit/integration test harness；Agent correctness 主要压在 `packages/e2e/tests/agent/{host,preset-plugin,provider}.spec.ts` 三个 Playwright spec 上。它们覆盖真实产品主链很好，但 CI 分组里三者目前都落在同一个 Agent group，且每个 group 内 Playwright `workers: 1`。
  - scripted provider fixture 已覆盖 multi-tool、Skill、interrupt、approval 等确定行为，但还没有专门 fault scenario 覆盖 restart/crash state closure、compaction Tool-exchange boundary、非 stop finish reason、stream partial retry、MCP update/refresh race、Subagent cancel/reservation/mailbox TTL 等本轮已确认 correctness invariants。
  - P-063/P-064/P-065/P-067/P-069/P-070 等优化都可能出现“token 降了但成功率/约束保持也下降”的 trade-off；仅靠 build/E2E pass 无法发现。
- **目标方向**：
  1. 新增 **Backend-level deterministic Agent scenario harness**，优先直接组合真实 StateCommit/Context/Tool/Repository 与 scripted/fake model port，不要求启动浏览器；再由现有 fake OpenAI-compatible fixture 验证 transport/product E2E。覆盖 Tool discovery、compaction、artifact、clarification、multi-tool、background job、completion gate、Responses continuation，以及 restart/crash/race/finish-reason 等 fault contract。
  2. 增加小型 coding/operations benchmark corpus，记录 task success、steps、model calls、Tool calls、重复 read/search、input/output/cached token、verification result、wall-clock 等；基线按场景存阈值/趋势，不追求单一综合分数。
  3. 真实模型 eval 作为 manual/nightly/研发对比工具，允许按 provider/model 配置；默认 PR gate 不依赖外部模型稳定性或付费 API。
  4. Context/Tool 优化合入前至少对对应 deterministic scenarios 做 before/after；真实模型结果作为补充证据，不替代 deterministic contract tests。
  5. 与现有 canonical E2E 原则一致：产品行为仍由真实 E2E 验证；Eval Harness 用于 Agent 决策/成本质量，不重新引入大量独立 architecture quality gate。
  6. P-120/P-045 必须有一组专门 trajectory fixture：健康长任务累计消耗超过旧 Run Token 上限仍能完成；exact failure / same-result / A↔B loop 能稳定触发 guard；一次真实 state delta 能重置 streak；Context compaction 后 context-usage meter 下降而 cumulative usage 不清零。
- **明确不做**：不把 LLM-as-judge 作为唯一质量标准；不在 PR 默认调用收费/不稳定外部模型；不为了“一个总分”掩盖具体 failure mode。
- **验证**：每个重大 Agent 优化都有可重复 baseline；同一 fixture 多次运行结果稳定；token/step regressions 可直接定位到 Context/Tool phase；长任务/loop/context-meter 三类 P-120 场景可重复；真实模型 nightly 失败不会阻塞与其无关的普通 PR。

## P-080 Plugin / App 的 Tool 扩展边界在文档中存在歧义，当前实现并不支持任意 Plugin 直接注册 governed Agent Tool

- **优先级**：P2
- **状态**：`文档/扩展边界审计确认，待规范收口`
- **当前事实**：
  - `doc/AGENT.md` 和部分 SRS 文案把 App 描述为 AgentDefinition、Tool/Skill/插件贡献的隔离边界，容易理解为“安装 Plugin 可以动态注册新的 Host governed Tool”。
  - 但当前 Plugin manifest 只声明 capability/intents/agents/targets；`composePlugins()` 安装/升级时动态注册的是 AgentDefinition，Skill 从 signed package 读取；Backend/Runner Plugin worker protocol 只提供 lifecycle/storage 等受限 SDK，没有 `AgentTool` descriptor/inspect/execute registration contract。
  - 当前 `ToolCatalog` 的动态外部 Tool 主要来自 MCP；Host-owned machine/workspace/browser/runtime Tool 由 Core Bootstrap 注册。`doc/AGENT.md` 后文实际上也明确 Host-owned governed Tool 属于 Core，Plugin 通过 grants/AgentDefinition/Skill 使用它们。
- **目标方向**：
  1. 先统一架构文档/SRS：App 是 Tool **授权/可见性/使用** 的 scope，但 arbitrary governed Tool implementation 第一版不是 Plugin package contribution surface。
  2. 外部动态 Tool 优先通过 MCP；本地高权限 primitive 继续由 Host/Runner Core owner 提供，保持 inspect/policy/operation-hash/lease/approval contract 单一。
  3. 如果未来确有“Plugin 自定义 Tool implementation”需求，应单独设计 versioned Tool SDK/IPC、risk declaration、schema lifecycle、outcome/verification contract 后再开放，不能让 Plugin Backend target 直接塞函数进 ToolCatalog。
  4. 当前无需为了文档措辞补一个重型 Plugin Tool API；先消除误导并明确扩展路径。
- **明确不做**：不让安装包通过 dynamic import/IPC 直接获得 Host authority；不复制 MCP 已解决的远端 Tool 扩展；不为了“所有东西都可插件化”破坏现有 Tool governance owner。
- **验证**：AGENT/SRS 对 Plugin Tool 边界表述一致；官方/第三方 App 可以通过 AgentDefinition + Skill + grants + MCP/现有 Core Tool 完成功能组合；未来 Tool SDK 若立项必须有独立 Problem/contract，不依赖本条隐含承诺。

## P-081 Runtime 已生成 Model Cache Hint，但 Provider Adapter 完全未消费，Prompt Cache 只停留在 telemetry

- **优先级**：P1
- **状态**：`token/cache 审计确认，待与 P-070/模型 capability contract 合并设计`
- **当前事实**：
  - Root `ModelStepRunner` 与 Child participant 每轮都向 `LanguageModelPort` 传 `cache: { scopeKey, affinityKey }`，当前值稳定绑定 Thread；`ContextService` 也已经计算 `stablePrefixHash/toolSchemaHash` 并记录 provider 返回的 `cachedInputTokens/cacheRate`。
  - `OpenAiProviderAdapter` 当前从不读取 `request.cache`，所以 `ModelCacheHint` 实际是 dead contract；它既没有映射到 `@ai-sdk/openai` provider options，也没有参与任何本地 routing。
  - 当前 `@ai-sdk/openai` 已支持 OpenAI `promptCacheKey/promptCacheOptions/promptCacheBreakpoint`。OpenAI 端本身会自动缓存符合条件的稳定前缀，而稳定 cache key 可进一步提高相关请求被路由到同一 cache 的概率。
- **问题**：Nexus 已为稳定 prefix、cache affinity 与实际 cached token 付出了设计/telemetry 成本，却没有把 hint 交给真正能使用它的 Provider；在长 system/tool prefix、多步 coding Run 中会错失延迟和 input cost 优化。
- **目标方向**：
  1. `ModelCacheHint` 保持 provider-neutral，并增加明确 capability gate；Adapter 只有在当前 Provider/Model 声明支持相应 cache option 时才映射 vendor-specific 字段。
  2. OpenAI Responses/Chat 支持时，把 `affinityKey/scopeKey` 做不可逆、长度受限的稳定 hash 后映射为 `promptCacheKey`；不发送 Thread title、用户文本或其它可识别内容作为 key。
  3. 第一版优先使用 provider 自动 cache + stable key；`promptCacheOptions` / explicit breakpoint 只有模型 capability 明确支持且 P-079 benchmark 证明有收益时再启用，避免给第三方 OpenAI-compatible endpoint 发送其不认识的扩展字段。
  4. Prefix 布局继续由 P-063/P-064 控制：稳定 system/project/Tool metadata 放前，current input/volatile collaboration 放后；cache hint 不能用来掩盖每轮 schema/context 抖动。
  5. telemetry 按 provider/model/context lineage 对比 cached/uncached input；cache miss 不影响正确性，第三方 provider 不支持时透明回退。
- **明确不做**：不自建分布式 prompt cache；不假定所有 OpenAI-compatible API 都接受 OpenAI 专有 cache 字段；不把原始用户/thread identity 发给 Provider 作为 cache key。
- **验证**：支持 cache key 的 fixture 能看到稳定、匿名化 key；同 Thread 稳定 prefix 的真实 provider benchmark cached token/cache hit 改善；Tool/Project instruction 变化会正确改变 prefix/cache lineage；不支持字段的第三方 endpoint 请求 body 与现状兼容。

## P-082 AgentDefinition `requiredModelCapabilities` 目前只存不验，模型能力合同无法约束实际 Run

- **优先级**：P1
- **状态**：`功能 contract 审计确认，P-075/P-077 落地前必须收口`
- **当前事实**：
  - Plugin manifest/AgentDefinition 已公开 `requiredModelCapabilities: string[]`；当前官方/E2E definition 声明 `['streaming']`。
  - `RunService.create()` 会 `definitions.require(...)` 确认 definition 存在，却丢弃返回值，从未把 `requiredModelCapabilities` 与选中的 model 做匹配；Checkpoint resume 同样只校验 definition version/provider/model 是否仍存在。
  - 当前 `ProviderModelConfig` capability 实际只结构化管理 context window、max output、Tools 与 reasoning；`streaming` 没有显式字段，未来 P-075 的 image/file input、P-081 cache option、以及协议 continuation 支持也缺少统一 capability vocabulary。也就是说现有官方 definition 已经声明了一个当前 model schema 无法表达/验证的 requirement。
  - `reasoningMandatory/reasoningSupportsMaxTokens` 等字段已经进入持久化/UI，但后者几乎没有实际 execution consumer，说明现有 capability schema 已开始出现“描述字段与运行时行为脱节”。
- **目标方向**：
  1. 把 `requiredModelCapabilities` 收敛为 Nexus 定义的 **typed capability vocabulary**，而不是任意字符串；至少覆盖 runtime 真正会选择路径的能力，例如 `tools`、`reasoning`、`image_input`、`file_input`，以及确有必要时的 provider-specific optional feature gate。
  2. `streaming` 若是 `LanguageModelPort` 的基础合同，就从可选 capability 中移除/视为 baseline，不继续让 manifest 声明一个无法不支持的伪可选项。
  3. Run 创建时必须验证 AgentDefinition requirements；Frontend model picker 对不兼容 model 禁用/说明原因。Checkpoint/resume 重新验证冻结 definition 的 requirements，不能只看 model id 还存在。
  4. Provider registry/manual override 只暴露对实际 runtime 有影响的能力；没有 consumer 的 `reasoningSupportsMaxTokens` 等字段要么接入 request construction，要么在兼容窗口后删除，不保留 decorative capability。
  5. 第三方 OpenAI-compatible model 可由用户手工声明 capability；未知能力默认不推断为支持，不根据 model name 猜 image/file/provider extension。
- **明确不做**：不建立厂商型号百科式 mega registry；不把 provider 专有选项全部提升为 Core capability；不因 capability 缺失静默切换用户冻结的 Root model。
- **验证**：要求 Tools/image 等 capability 的 AgentDefinition 无法选择不支持模型；兼容模型正常创建/恢复；UI 与 Backend 判定一致；每个保留 capability 字段都有至少一个明确 runtime consumer 与 E2E/contract test。

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
- **状态**：`durability 审计确认，待与 P-064/P-073 recovery contract 收敛`
- **当前事实**：
  - Root `AgentScheduler` 的 queue/active state 是进程内存；Backend initialize 时不会盲目重放旧 Root execution，而是先调用 `interruptNonTerminalRuns()`，把 `created/running/awaiting_approval/awaiting_budget/cancelling` 全部转成 `interrupted`。
  - 若重启时存在 running/reconciling mutation，当前逻辑会设置 `needsReconciliation`；未执行的 approval/tool work 会被 supersede/cancel。这个行为避免了未知副作用被重复执行，是正确的保守边界。
  - Child scheduler 自身已有 durable scheduler work/reclaim，但 Root restart 会先终止对应 Run，因此也不会构成 Root 的自动 continuation。
  - Checkpoint/Resume 已实现并能冻结 context boundary/plan/evidence/recovery manifest，但 checkpoint 目前只有用户手动保存入口，没有 model/tool safe boundary 的自动 checkpoint。
- **问题**：长 coding/research/background Run 即使所有已完成动作都已 durable，在一次正常 Backend 升级/重启后仍会整体进入 interrupted，用户必须事前手动 checkpoint 才有结构化 resume source。服务端 Agent 因此缺少成熟系统常见的“安全点续跑”。
- **目标方向**：
  1. 在 deterministic safe boundary 自动生成/更新轻量 **Recovery Checkpoint**：例如 model step 已完整 commit、read batch 完成、confirmed mutation+verification 已 commit、Plan/evidence stable 后；不在 mutation outcome unknown 的窗口创建“可无脑续跑”的 checkpoint。
  2. Recovery Checkpoint 复用现有 Checkpoint owner 与 P-064 ContextCheckpoint，不新建第三套 snapshot；允许区分 user-pinned checkpoint 与 rolling auto checkpoint/retention。
  3. Backend startup 先执行现有 mutation reconciliation classification，再对满足严格条件的 interrupted Run 提供/执行 continuation：冻结 definition/provider/model/inputs/context boundary 仍有效、没有 unknown mutation、Artifact/Workspace/background job 状态可重新确认。
  4. P-073 Workspace background job 可能在独立 Runner 中跨 Backend restart 存活；恢复前必须先按 durable jobId 查询真实结果，不重复提交同一 operation。
  5. approval/user-input 等等待状态若要跨重启保留，只在其 policy/input/config revision 仍有效时恢复；否则保持当前 supersede + 重新确认，而不是降低现有 freshness contract。
  6. UI/Ledger 明确记录 `backend_restart` 与 `continued_from_checkpoint`，让用户知道发生过恢复；continuation 失败仍落 interrupted，不隐藏错误。
- **明确不做**：不在未知 mutation 中途自动重放；不保存活跃进程/socket/lease 伪装“进程级 resume”；不复制 Checkpoint/Runner journal；不为了无缝续跑取消 reconciliation。
- **验证**：重启发生在 safe read/model boundary 时长 Run 可从最新 auto checkpoint 恢复且不重复 Tool；重启发生在 mutation outcome unknown 时仍进入 reconciliation；Runner background job 不重复提交；用户手动 checkpoint/resume 行为保持兼容。

## P-086 Root Model 只有同模型短重试，缺少用户显式配置且能力兼容的 Provider/Model Fallback Chain

- **优先级**：P2
- **状态**：`可靠性能力缺口确认，待 P-082 capability contract 完成后实现`
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
- **验证**：primary 连续 429/503 后按冻结顺序切到兼容 fallback 并完成；无 fallback 时行为与现状一致；不兼容候选在 Run 创建前被拒绝；route change 和各 attempt usage 可审计；普通 validation/tool error 不触发 failover。

## P-087 Model Stream Retry 缺少 Attempt Identity / Reset，失败 Attempt 的 Partial Delta 会与重试输出在 UI 临时拼接

- **优先级**：P1
- **状态**：`实际运行时/UI 一致性缺口确认`
- **当前事实**：
  - `runAttempt()` 一收到 provider `message.delta` 就发布 ephemeral event，Frontend 对 Root Run 直接执行 `streamingText += delta`。
  - 若 stream 在已有 partial text 后发生 retryable error，Backend 会 durable commit `model.retrying` 并开始新 attempt；新 attempt 的 text buffer 从空重新生成，但 Frontend 没有 attempt id，也不会在 `model.retrying` 时清掉旧 partial buffer。
  - Frontend 当前只在 `transport.disconnected` 或最终 `message.final` 时清空 streaming text，因此用户可能暂时看到类似 `helhello...` 的失败流+重试流拼接；未来 P-086 model failover 也会放大同一问题。
- **目标方向**：
  1. ephemeral `message.delta/tool.delta` 增加 `attemptId/attemptIndex`（或等价 generation token），由 model step begin/retry durable event提供当前 authoritative attempt。
  2. Frontend streaming state 按 attempt identity replace；收到新 attempt/retrying 时丢弃旧 attempt 的非 durable partial buffer，而不是继续 append。
  3. WebSocket reconnect 继续遵守“ephemeral 不恢复”：清空 buffer，重新从 durable Ledger/Run projection 展示；不要把 delta 本身持久化来解决 UI 问题。
  4. Tool delta 也使用同一 attempt identity，后续若 UI 展示 streaming Tool args 不会把失败 proposal 与重试 proposal混合。
  5. retry/fallback UI 可显示轻量 `Retrying…` / route change 状态，但最终对话只以 durable `message.final`/assistant Ledger 为事实源。
- **明确不做**：不把每个 token delta 写数据库；不把失败 attempt partial text当正式 assistant message；不因为 UI reset 改变现有 retry budget/usage accounting。
- **验证**：fixture 先流式输出 partial text 后断流，再成功 retry，UI 只显示当前 attempt，不出现重复前缀；断线重连不恢复旧 partial；Tool delta/fallback 使用同一 generation contract。

## P-088 Subagent Profile 已声明 Capability，但 Child Context 硬过滤所有 Mutation Tool，无法成为真正的 Coding Worker

- **优先级**：P1
- **状态**：`multi-agent 功能完备性审计确认，待与 P-068/P-072/P-085 Workspace contract 收敛`
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
- **状态**：`实际完成语义缺口确认，待与 P-074 Completion Gate/P-077 Responses contract 合并修复`
- **当前事实**：
  - AI SDK LanguageModel V4 已提供统一 finish reason：`stop | length | content-filter | tool-calls | error | other`。
  - Nexus `LanguageModelPort` 当前把 finish reason 作为字符串向上透传；Root `NativeAgentBackend` 在 model 没有 Tool call 时，不判断 finish reason 就直接 `settleModelStep(... terminalStatus='completed_unverified')`，StateCommit 随后把 `goal_status` 写成 `satisfied`。
  - 因此模型因 output token 上限截断（`length`）、content filter 停止或 provider 以非正常 reason 结束时，只要没有 Tool call，仍可能得到正常 assistant Ledger + `completed_unverified/satisfied`。
  - Subagent 也只把 `finishReason` 写进 result metadata；没有 Tool call 且未抛 transport error 时默认 `outcome='completed'`，存在同类“半截结果算完成”的风险。
- **问题**：finish reason 是模型执行结果的关键控制信号，不应只是诊断字段。截断输出被标成 satisfied 会误导用户、破坏 P-074 completion/verification，也让长回答或 reasoning model 在预算临界点出现 silent partial success。
- **目标方向**：
  1. 将 finish reason 升为 provider-neutral typed contract，直接使用/映射 AI SDK unified reason；Adapter 不再把厂商 raw reason 当 Core 业务语义。
  2. `stop` 才可作为“模型正常结束”的候选，再进入 P-074 Completion Gate；`tool-calls` 必须与实际 Tool proposal 一致，否则视为 provider/model contract error。
  3. `length` 不得直接完成：在模型物理 `contextWindow/maxOutputTokens`、P-045 loop/fuse 与当前 Context headroom 允许时，可进行 bounded continuation model step，并把前一段作为 canonical assistant continuation context；若 continuation 已无法安全构造或连续 length 无进展，则进入明确的 `MODEL_OUTPUT_TRUNCATED`/attention 状态，不能写 goal satisfied，也不再用累计 Token `awaiting_budget` 解释截断。
  4. `content-filter` / `error` 默认走明确失败/受限结果状态并保留可展示原因；`other` 保守处理，只有经明确兼容映射后才能当 stop。
  5. Root/Subagent 使用同一 finish-reason policy，避免 child 把 truncated completion 发送给 Parent 当完成证据。
  6. 与 P-077 配合：Responses reasoning continuation 若需要 opaque metadata，`length` continuation 同样必须保留正确 provider continuation；不能靠重新提示“继续”伪装无状态协议连续性。
- **明确不做**：不把所有非 `stop` 都盲目 retry；不隐藏 content filter/provider error；不因 continuation 临时提高模型物理 `maxOutputTokens/contextWindow`；不恢复父/Child 累计 Token budget；不使用 provider 私有 raw 字符串直接驱动 Core 状态机。
- **验证**：fixture 分别返回 `stop/length/content-filter/error/tool-calls`；只有合法 stop + Completion Gate 可正常完成，length 能 continuation 或进入明确 truncated/attention 状态且不触发累计 Token budget wait，filter/error 不会写 `goal=satisfied`；Root 与 Subagent 行为一致。

## P-090 Provider 网络策略已从产品设计移除，但 Agent Settings 仍公开可 patch 的 `providerPrivateNetworkExceptions` 死字段

- **优先级**：P2
- **状态**：`清理审计确认，属于已移除 Provider 网络策略的 API 残余`
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
- **验证**：Agent settings GET 不再返回该字段，PATCH `safety/providerPrivateNetworkExceptions` 明确拒绝；已有 legacy settings 可正常加载；Provider 请求行为不变；MCP private-host exception fixture 继续通过。

## P-091 Nexus 已有 Email/Webhook/Telegram 通知系统，但 Agent Run/Attention 生命周期完全未接入

- **优先级**：P2
- **状态**：`长任务产品闭环缺口确认，可复用现有 NotificationService`
- **当前事实**：
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
- **验证**：后台 Run 完成/失败和 approval/input/attention wait 各只产生一次可配置通知；关闭相应 event 不发送；通知失败不改变 Run 状态；details 不包含敏感 prompt/credential；前台正常运行没有通知风暴；不存在累计 Token budget 专用通知。

## P-092 `/plan` 目前只显示 Durable Plan，缺少真正的 Read-only / Plan-only Run Execution Mode

- **优先级**：P2
- **状态**：`产品工作流缺口确认，保持与 approval mode 正交`
- **当前事实**：
  - Nexus 已有 typed durable `RunPlan`、`plan_update` Tool 与 `/plan` slash command；但 `/plan` 当前语义只是读取/显示最近 Run 的 Plan projection。
  - Run 只有 `approvalMode = ask | full_access`。`ask` 仍会把 mutation Tool 暴露给模型，只是在真正执行前进入 approval；它不是“只研究、绝不提出/执行修改”的 planning mode。
  - P-072/P-071/P-067 落地后，Nexus 会拥有更完整的 read/search/repo-map 能力，天然可以支持低风险的只读探索阶段。
- **主流实践对照**：Claude Code 的 `plan` permission mode 会限制为只读探索并产出可审阅计划，用户明确批准后才切换到可写执行模式；它与普通“每次写操作询问”是两个不同维度。
- **目标方向**：
  1. 增加与 `approvalMode` 正交的 `executionMode: execute | plan`（最终命名待定），在 Run 创建时冻结；plan mode 只投影 read/control Tool，mutation Tool 根本不进入 model surface。
  2. plan mode 可更新 durable Plan、读取 Artifact/Repo/Browser/MCP evidence、提出 P-076 clarification，但不得写文件、执行有副作用 shell、Browser mutation 或远端 mutation。
  3. 第一版不支持同一 Run 中途切 mode，避免重新定义 operation hash/policy/input lineage；用户确认计划后，从同一 Thread/Plan 创建一个新的 execute Run，并明确链接 `plannedFromRunId`（或等价 lineage）。
  4. `/plan` 现有“显示计划”语义保持兼容；可以新增 UI mode selector 或 `/plan start`（最终交互待定），不要把旧命令静默改成启动新 Run。
  5. execute Run 仍按 ask/full_access 决定 mutation approval；“批准计划”不等于批准后续每个 mutation，也不能替代 operation-specific approval/reconciliation。
- **明确不做**：不新增第三套 Tool runtime；不把 `ask` 重命名成 plan；不让 plan approval 自动授权未来 mutation；不为了 planning 默认多调用额外 planner model。
- **验证**：plan Run 的 model request 中完全没有 mutation Tool schema；模型仍可 read/search/update plan/clarify；用户确认后新 execute Run 能继承计划/evidence lineage但重新走当前 policy/approval；现有 `/plan` show 行为不变。

## P-093 Context Compaction 会拆散 Assistant Tool-call / Tool-result Exchange，实际可产生 `MODEL_TOOL_RESULT_INVALID`

- **优先级**：P1
- **状态**：`最小真实代码复现确认，属于 runtime correctness bug`
- **当前事实**：
  - canonical Ledger 会把一次 Tool round 写成 `assistant_message{toolCalls:[...]}`，随后各 Tool settle/deny/expire 再写 `tool_result{toolCallId,...}`；Provider 下一轮必须收到完整且按顺序的 assistant Tool-call → Tool result exchange。
  - `ContextService` 当前把每条 Ledger entry 独立变成 `CandidateSection`，按最新优先选择后再按 compaction ratio 从旧端逐条删除；没有任何 exchange/group identity 保证 assistant batch 与其 Tool results 同进同退。
  - assistant Tool-call candidate 的 token 目前只按 `message.content` 计算，Tool arguments 完全不计；空文本 Tool-call 常被算成 1 token，进一步使 compaction boundary 容易落在 assistant/result 中间（token accounting 本身由 P-070 统一修正）。
  - 本轮直接调用真实 `ContextService.compose()` 做随机化 budget probe，已得到可达案例：`balanced`、`maxContextTokens=273` 时 `assistant(tool-call id=c1)` 被标记 dropped，但对应 `tool_result(c1)` 留在最终 messages 的第一项。
  - 再把这个 orphan context 交给真实 `OpenAiProviderAdapter.stream()`，Adapter 在任何网络请求前因为找不到 `toolCallId → toolName` lineage 明确抛出 `MODEL_TOOL_RESULT_INVALID`。因此这不是 provider 差异，而是 Nexus 自己的 Context projection 破坏了模型协议。
- **目标方向**：
  1. 在 Context selection 前把 canonical Ledger 投影成 **atomic semantic groups**：普通 user/assistant turn 可单项；一个 assistant Tool-call batch + 该 batch 的所有 terminal tool results 必须组成不可拆 group。multi-tool batch 必须完整保留 batch order 与每个 result。
  2. candidate budget/compaction 对 group 做选择，输出仍保持 canonical chronological order；若整个 group 放不下就整体丢弃/交给 P-064 summary checkpoint，绝不能输出 orphan assistant Tool-call 或 orphan Tool result。
  3. denied/expired/superseded/cancelled Tool result 同样属于原 assistant batch；它们是模型后续决策需要的正式 result，不能因为“没执行成功”跳出 grouping。
  4. Context history boundary/checkpoint resume 也必须在 Tool exchange safe boundary 截断；如果 legacy checkpoint boundary 恰好落在 exchange 中间，projection 应向安全边界收缩或明确拒绝，而不是拼出非法 prompt。
  5. P-070 修复 structured-part token accounting，使 group token 包含 assistant Tool arguments + 全部 Tool results；P-069 projection 负责缩短大 Tool result，但不能改变 grouping lineage。
  6. Adapter 保留 defensive validation，并把 orphan exchange 错误作为 Context/runtime invariant violation 记录；不要在 Adapter 里“猜 tool name”或伪造缺失 result 来掩盖上游损坏。
- **明确不做**：不通过关闭 compaction 回避问题；不把 Tool messages 展平为普通文本；不让 Adapter 根据当前 ToolCatalog 猜历史 Tool name；不丢弃 denied/error Tool result 来凑合法序列。
- **验证**：deterministic fixture 覆盖单 Tool、多 Tool batch、denied/expired、紧预算与 checkpoint boundary；任意预算下一个 exchange 要么完整出现且 assistant→results 顺序合法，要么整体不出现；上述 `273/balanced` 复现不再产生 orphan；Provider Adapter 不再因合法历史 compaction 抛 `MODEL_TOOL_RESULT_INVALID`。

## P-094 Storage / Workspace 生命周期设置存在“可配置但不生效”的假合同

- **优先级**：P1
- **状态**：`设置消费链审计确认，需先收口真实语义再决定实现或删字段`
- **当前事实**：
  - Frontend Settings 明确暴露 `storage.maxArtifactBytes` 为“单 Run 产物配额”、`storage.unretainedArtifactTtlSeconds` 为“临时产物生命周期 (TTL)”，并同时暴露 `workspaceRuntime.workspaceIdleTtlSeconds`；对应 Hard Limit 也可配置。
  - `LocalArtifactStore` 的 `ArtifactLimitPolicyPort` 目前只接收 `maxSingleArtifactBytes / maxGlobalArtifactBytes / minFreeDiskBytes`。`maxArtifactBytes` 只参与 Settings 的大小关系校验，没有任何 per-Run Artifact 累计计费/拒绝路径，因此所谓“单 Run 产物配额”实际不生效。
  - `unretainedArtifactTtlSeconds` 没有进入 Artifact limit policy，也没有 ready Artifact TTL sweeper。Artifact upload 的 `expires_at` 只用于 staging reservation（默认 120 秒），写入 ready 后会明确设为 `NULL`；用户主动 cleanup 是独立的 preview→confirm 行为，并不使用该 TTL。
  - Workspace 会持久化 `last_active_at`，但全仓没有按 `workspaceIdleTtlSeconds` 停止/删除 non-retained idle Workspace 的 sweeper；这个设置目前同样只有 defaults/normalization/UI contract，没有 runtime consumer。
  - 其它已抽查的重要执行设置（Run budget、Tool timeout/output、model/runtime concurrency、Workspace count、recipe/tool version/ACP profile）都有明确 runtime owner，因此问题不是“所有 Settings 都是假的”，而是生命周期/配额这组字段实现断链。
- **问题**：用户能保存这些值并看到 Settings revision 更新，却不会改变真实执行/回收行为；这比隐藏的 dead field 更危险，因为 UI 给出了明确的资源治理承诺。长期还会让 Hard Limit 看似保护资源、实际只保护部分维度。
- **目标方向**：
  1. 先定义唯一的 **Artifact retention owner**：`maxSingleArtifactBytes` 限单对象、`maxArtifactBytes` 限单 Run 所有 linked artifact 的累计 ready/reserved bytes、`maxGlobalArtifactBytes` 限用户全局；创建 reservation 与跨 Run link 时都用同一 authoritative accounting，避免只在 upload begin 做局部判断。
  2. `unretainedArtifactTtlSeconds` 若保留，ready Artifact 需要记录明确的 retention deadline（或按 readyAt + 当前 frozen policy 计算），后台 sweep 只回收未 retained、无 active Run/checkpoint/grant protection 且已到期的对象；与手动 cleanup 复用同一 `artifactProtectionReason`/两阶段删除逻辑，不另造 GC 规则。
  3. `workspaceIdleTtlSeconds` 若保留，增加轻量 lifecycle sweep：只处理 non-retained、无 active Tool/job/interactive session、超过 last-active deadline 的 Workspace；stop/delete 应继续复用现有 Workspace service/Runner reconcile，而不是直接改 DB。
  4. 生命周期 policy 要么在资源创建时冻结进 durable snapshot，要么文档明确使用“当前设置”；不能运行中悄悄改变旧资源语义。Hard Limit 与 requested setting 的关系继续由现有 effective-settings normalization 处理。
  5. 如果当前产品阶段不准备做自动 TTL/idle cleanup，则直接从 Settings/API/Hard Limit 删除这两个 TTL 字段，并把 UI 改成只有显式 cleanup；不要保留无效旋钮。`maxArtifactBytes` 同理：实现 per-Run quota 或删除“单 Run 配额”合同，二选一。
- **明确不做**：不增加第二套 Artifact store；不以定时任务直接删除文件绕过 DB/quota/protection；不把 retained/checkpoint/active grant Artifact 当普通 TTL 垃圾；不让 idle Workspace sweep 杀死仍在运行的 job/session。
- **验证**：设置极小 per-Run quota 后第二个/后续 Artifact reservation 能稳定被拒绝；短 TTL fixture 到期后只有真正 reclaimable Artifact 被 sweep；retained/checkpoint/active Run/grant Artifact 不被删；idle Workspace 到期可安全 stop/delete，活跃 Workspace 不受影响；若选择删字段，则 Backend/Frontend/SRS 不再出现任何该设置残余。

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
- **状态**：`本轮配置合同矩阵确认`
- **当前事实**：
  - `hardLimits.maxContextTokens` 与 `hardLimits.maxOutputTokens` 仍存在于 `AgentSettingsDocument`、三语言 Settings UI 和 Hard Limits 编辑器，文案分别承诺“单请求历史 Context 的绝对上限”和“单次模型生成的最大 Token”。
  - 但当前 `RunService` 已明确把 `maxContextTokens = model.contextWindow`、`maxOutputTokens = min(model.maxOutputTokens, contextWindow - 1)` 视为模型物理 capability；全仓没有 `settings.hardLimits.maxContextTokens/maxOutputTokens` 的 runtime consumer。Checkpoint 同样根据当前冻结模型 capability 重建这两个值，而不是应用 Settings hard limit。因此用户修改这两个“硬限制”不会影响任何 Run。
  - `budget.maxRawToolBytes` / `hardLimits.maxRawToolBytes` 会进入 execution policy、Run budget 与 checkpoint snapshot，Frontend 还分别描述为“任务中工具调用原始传输数据累计上限 / 原始工具输出留存大小”；但 Tool executor、StateCommit、Ledger、Artifact 与 Gateway 全部没有消费 `run.budget.maxRawToolBytes`。真实生效的只有单次 model-facing `maxToolOutputBytes`。
  - 这与 P-094 的 Storage/Workspace lifecycle 假合同属于同一审计类别，但职责不同：P-094 是资源生命周期/配额执行缺失；本条是 model/tool budget API 本身与现行 runtime authority 不一致。
- **目标方向**：
  1. 删除 `hardLimits.maxContextTokens/maxOutputTokens` 这两个已经被 Model Capability authority 取代的设置、API 字段、UI 和历史文案；不要为了让旧字段“看起来有效”而重新用用户 hard limit 反向裁剪模型物理窗口。模型 capability 的补全/authority 继续由 P-054/P-082 负责。
  2. 对 `maxRawToolBytes` 先确定唯一语义。如果要保留，应定义 Run-scoped raw Tool payload accounting：明确哪些 bytes 计入（Tool input、raw stdout/stderr、MCP raw content、Browser extraction 等）、何时 spill 到 Artifact、超过预算后的 deterministic 行为，并让 Root/Child/Checkpoint 使用同一计数；如果 P-069 ToolResultProjection + Artifact-first 已足够，则直接删除该字段，避免重复 quota。
  3. Settings schema/version migration 必须能读取已有文档中的旧字段并规范化掉，不能因为删除 UI/runtime 合同导致旧用户 Settings 无法加载。
  4. `maxRunTokens` 与本条不同：它当前**确实会影响执行**，但产品方向已由 P-120 决定删除父 Run 累计 Token hard budget；Settings/Hard Limits/App override 中的该字段与 P-120 同批迁移，不要在本条把它重新包装成另一个有效 hard limit。
- **明确不做**：不重新引入固定 32K/4K 一类全局 context/output ceiling；不把 Provider model capability 和 User Run budget 混成同一个 owner；不保留仅用于 UI 展示但不影响执行的“装饰性限制”；不以“成本保护”为名恢复 P-120 删除的父 Run 总 Token ceiling。
- **验证**：Settings 的每个可编辑 budget/hard-limit leaf 都有可定位的 runtime consumer 或已被删除；修改保留字段能在 deterministic E2E 中改变对应执行结果；旧 Settings 文档升级后不会继续暴露无效字段。

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
  3. `maxToolOutputBytes` 限制整个 model-visible ToolResult，而不只是 `data`；P-096 的 `maxRawToolBytes` 若保留，则负责 raw-retention 累计预算。
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
  5. P-094 的 TTL sweeper 后续只能调用这套 durable transition/reconciler，不能再直接 fs.rm + 改表。
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
  5. Context/输出只受各 Child 模型的 physical `contextWindow/maxOutputTokens` + P-064 compaction控制；不要用累计 Token 数限制 Child 长任务。
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
  5. rawInput 只做 bounded model/UI projection；大型或敏感 payload 不直接复制进 Ledger，沿 P-069/P-097 的 ToolResult/Artifact 规则处理。
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

## P-112 `ai_context_digests` 是无 Producer/Consumer 的 Durable Schema，当前 Context Summary Contract 实际未落地

- **优先级**：P2
- **状态**：`本轮 Persistence / durable derived-state 审计确认`
- **当前事实**：
  - `ai_context_digests` 仍是 current base schema 的正式表，包含 `thread_id / from_sequence / to_sequence / source_hash / model_config_version / content`，结构明显用于 durable Context digest/summary。
  - 但全仓没有任何 INSERT/SELECT/UPDATE producer/consumer；当前唯一 runtime 引用是 Run/Thread 删除时执行 DELETE。
  - 当前 `ContextService` 直接从 Ledger/Goal/Plan/Recall 等现有源投影上下文，不读取该表；Checkpoint 也不使用它。
  - `doc/AGENT.md` 仍保留“Context digest / summary 不能吞掉控制状态”的架构约束，而 P-064 已计划引入 durable compaction checkpoint，因此现有死表很容易被误认为已存在的 summary owner。
- **问题**：数据库 schema、删除逻辑和架构语言暗示 Nexus 已有 durable context digest，但真实运行时完全没有该能力。它既增加维护/迁移表面积，也会让 P-064 的 owner 选择产生歧义。
- **目标方向**：
  1. P-064 实现前明确唯一 owner：如果新的 durable ContextCheckpoint 采用 `ai_context_digests`，则正式定义 version/schema/hash/boundary/read-write contract，并迁移到真实 producer/consumer；否则新增 migration 删除该表及对应手工 cleanup。
  2. 不允许同时保留“旧 digest 表 + 新 checkpoint 表”两套相似 derived-state owner。
  3. 删除/失效规则由真正的 compaction owner负责；Run 删除不应无理由清空整个 Thread 的可复用 summary，除非 source boundary 确实失效。
  4. 文档与 schema 状态同步：未实现前不把 Context digest 描述成已交付能力。
- **明确不做**：不因为表已经存在就强行把新 compaction 设计绑在旧 schema 上；不保留永远只有 DELETE 的历史表。
- **验证**：实现后全仓只能找到一个 authoritative durable summary/checkpoint owner；fresh/upgraded DB schema 与 runtime producer/consumer 一致；Thread mutation/delete 能按 source boundary 精确失效，且没有只写不读/只删不写的 context-derived table。

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
- **状态**：`第二轮配置合同反向扫描确认`
- **当前事实**：
  - `AGENT_DEFAULTS` 仍声明 `approvalTtlSeconds=600`、`leaseTtlSeconds=30`、`leaseRenewSeconds=10`、`estimateMargin=0.15`、`maxConcurrentToolCalls=1`，但全仓除定义外没有任何 consumer。
  - Approval 的真实 TTL 目前在 `NativeAgentBackend` 与 StateCommit validation 中直接使用 `600`；因此 `approvalTtlSeconds` 看似是 authority，实际改它不会改变行为。
  - Root/Child Tool lease TTL 已改成基于 `toolTimeoutSeconds + 15` 的动态值（30～300 秒）；`LeaseCoordinator` 的 renewal cadence则直接 hardcode 为 `10_000ms`。因此旧 `leaseTtlSeconds` 已失效，而 `leaseRenewSeconds=10` 只是与另一处 magic number 重复、改动不会生效。
  - Root read Tool 并行上限由 `MAX_PARALLEL_READ_TOOLS=4` 控制，`maxConcurrentToolCalls=1` 已不是 runtime policy。
  - Model budget reservation 直接按 `estimatedInputTokens + maxOutputTokens` 处理，`estimateMargin` 没有参与 Root/Child/Context accounting；P-070 将重新定义 usage anchor/estimate contract，也不应受一个无 owner 的历史 margin 影响。
- **问题**：同一类执行策略同时存在“看起来官方的 defaults 常量”和真正 runtime 逻辑，修改前者不会产生任何效果。后续优化/排障很容易基于错误事实源做配置，或把已废弃策略意外复活。
- **目标方向**：
  1. 删除没有 runtime owner 的顶层常量；需要共享的固定值（例如 Approval TTL）提取成离实际 producer/validator最近的单一 typed constant/module，并由两端共同引用。
  2. Lease TTL继续以当前 Tool timeout 动态语义为唯一事实源；renew cadence如果保留固定 10 秒，应在 `LeaseCoordinator` 附近定义唯一常量并解释与最小 TTL 的关系，不要同时保留一个失联的 `AGENT_DEFAULTS.leaseRenewSeconds`。
  3. Read Tool parallelism 若未来需要用户/系统可调，单独定义明确 budget/settings contract；当前先保留 `MAX_PARALLEL_READ_TOOLS` 的 bounded internal policy并删除误导性的 `maxConcurrentToolCalls`。
  4. `estimateMargin` 直接删除；token estimation/accounting 统一由 P-070 的 provider usage anchor + estimator contract 接管。
- **明确不做**：不为了消灭 dead code 把每个内部常量都暴露成 Settings；不恢复已经被动态策略替代的固定 lease 参数；不让 Approval producer/validator继续各写一个 magic number。
- **验证**：`AGENT_DEFAULTS` 每个非 settings 字段都有至少一个明确 runtime consumer；修改/删除策略只有一个 authority；Approval TTL producer/validator 引用同一常量；全仓不再出现上述 5 个 dead defaults。

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
  - Nexus 已有正确 Context meter 的基础：冻结模型 `contextWindow`、每次 `ContextPlan.estimatedInputTokens/reservedOutputTokens`、Provider 返回的实际 `inputTokens/cachedInputTokens` 与 stable-prefix/context diagnostics。P-070 只需把它们收口成一份 current-context projection。
- **外部对照（2026-09）**：
  - OpenAI Codex CLI 已公开显示 `Context XX% used`，同时继续在 turn usage 中报告 input/cached/output tokens；Codex 主要通过 context window + auto/manual compaction维持长会话。到 2026-07 仍有人单独请求 `codex exec --max-agent-turns`，说明 deterministic iteration ceiling是可选执行控制问题，不是 UI 的累计 Token progress。
  - Claude Code 的 prompt box同样显示当前 context-window usage，并提供 `/context` 详情与 auto/manual `/compact`；它把“上下文还有多少空间”和“套餐/usage 消耗”分成不同产品概念。
  - Hermes Agent 当前默认 `agent.max_turns=none`，明确说明固定 turn cap/中途 budget warning曾让复杂任务过早结束；其默认控制组合是 context compression + retry/fallback + tool-loop guard + 特定高 fan-out cap，而不是父任务累计 Token hard stop。
  - OpenHands 的 `StuckDetector` 证明重复 action/result/error trajectory 可以直接检测，但其 Goal-loop bug也说明阈值过激会误杀正常迭代；因此 Nexus 采用 P-045 的“durable progress + staged response”，不复制简单重复次数 hard stop。
- **目标方向**：
  1. 从 **父 Run execution contract** 删除 `maxRunTokens`：`AgentSettingsDocument.budget/hardLimits`、App execution override、`RunBudget`、budget increase request、checkpoint budget、Root `remainingRunTokens`/reservation、Subagent parent-pool calculation与对应三语言 UI/文案一起收口。当前产品尚未发布，不为这些未使用字段保留 legacy decoder/兼容分支；旧字段出现在当前 API/持久化 contract 时直接视为无效数据。
  2. **保留累计总 Token 消耗**：`RunUsage.inputTokens/outputTokens/cachedInputTokens` 继续 durable 累加，用于详情、成本诊断、cache rate、benchmark与后续 FinOps；删除的是“达到某累计值就不许继续”，不是 usage telemetry。
  3. Agent 主界面保留现有 Token 总数展示，例如 `123k tok` + tooltip 的 input/output/cache breakdown，但取消 `123k / 100k` 和“budget xx%”语义。累计总数可以无限增长，不映射成红黄进度。
  4. `TaskRail`/任务使用进度条改成 **Context Usage**：消费 P-070 的 latest `ContextUsage`，显示类似 `74k / 200k · 37%`。百分比表示当前模型请求 prompt 对物理 context window 的占用；`reservedOutputTokens`/source/是否估算放 tooltip/详情，不把历史累计 usage混进去。
  5. Context pressure只触发 P-064 compaction/projection：soft threshold 提前整理，hard threshold保证下一次模型调用有 headroom；compaction成功后 Context bar 应下降，而累计 Run token counter保持原值。Provider 真实 context overflow 走可恢复 compaction/failure path，不转换成“总预算耗尽”。
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
