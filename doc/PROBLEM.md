# Nexus 当前问题清单

> 本文件只保留**尚未闭环、可执行、可验证**的问题。已修复问题、一次性开发环境交接、历史 UI 草案和已经被现行架构/SRS 取代的设计不在这里长期归档；需要追溯时以 Git 历史为准。
>
> 本轮审计基线：`origin/archive/main-2026-09-07..main`。该范围共 377 个提交、1574 个变更条目。审计同时使用完整 diff 文件清单、Backend/Frontend 依赖图扫描、构建/typecheck、workspace/package 边界审核、Agent 代码反模式扫描，并对最近 Agent merge/fix 提交与高风险 runtime/provider/persistence/runner 文件做人工复核。

## 当前架构健康结论

当前**宏观模块边界健康**，但存在若干内部质量债务，不能把“依赖图没有违规”等同于“实现完全健康”。本轮基线结果：

- Backend 依赖图审计覆盖 437 个 TypeScript 文件，未发现禁止跨层依赖、源码循环或 module dependency cycle。
- Frontend 依赖图审计覆盖 326 个源码文件，未发现禁止依赖与依赖循环。
- 本轮 workspace/lockfile 审核确认仍只有单一 pnpm workspace 与根 lockfile，未出现第二套 package-manager/install authority。
- Backend、Frontend、Agent Runner build/typecheck 通过；本轮变更涉及的三语言 key 同步已核对。
- E2E 目录与调用面审核未发现新增 unit/component/internal suite；产品自动化仍集中在 `packages/e2e`。
- 当前本机 Node 为 v22，而仓库要求 Node >=24；上述结果只能作为本地静态/构建证据，正式 release/CI 仍以 Node 24 canonical environment 为准。

因此当前结论是：**Owner/layer/transport 大边界没有出现合并后架构污染；主要风险集中在执行策略尚未完全收口、跨进程/持久化解码、少数超大 owner、结构化日志绕过和兼容层生命周期。**

---

## P-045 Agent 执行策略仍缺“健康长任务扩展区”与 no-progress/loop guard

- **优先级**：P1
- **状态**：`部分闭环，保留剩余项`
- **已经闭环**：
  - User global defaults → App-scoped execution policy override → Run snapshot 已实现；`AgentExecutionPolicyService` 只保存 App 与全局不同的 override，并受 Hard Limits 约束。
  - Run 创建时 `maxContextTokens/maxOutputTokens` 来自模型物理 capability；`maxRunTokens/maxRunSteps/time/tool/recall/subagent` 等来自 effective execution policy，不再拿固定 32K/4K 反向裁剪模型物理窗口。
  - 新 Run 重新建立自己的 `RunUsage`，checkpoint/resume 同一 Run 延续原 usage。
- **仍未闭环**：
  1. 当前 `maxRunTokens/maxRunSteps/maxActiveExecutionSeconds` 仍是明确额度；尚未形成“normal budget → 持续有进展时进入 bounded extended region → 无进展立即熔断”的完整策略。
  2. 代码中尚未发现基于 repeated operation / no-progress / stagnation 的 Run-scoped guard；当前主要依赖 step/token/time hard fuse，无法尽早区分健康长任务和死循环。
  3. 旧设计中的“按模型 context-window multiplier 自动形成 normal/extended budget”尚未成为正式 effective policy。
- **要求**：
  - progress signal 必须基于 durable/可验证事实，例如新 Tool evidence、Plan progress、输入 revision、artifact/result 变化，而不是模型自报“有进展”。
  - repeated-operation guard 应基于 canonical operation/inspection hash 与结果变化，不得误杀必要 polling/retry；网络瞬态重试和 mutation unknown-outcome reconciliation 必须继续遵守各自安全合同。
  - 新显式 User Turn / 新 Run 建立新的 progress epoch；同一 Run resume 不得重置已消耗预算或 loop evidence。
- **验证**：健康的长 coding/research Run 能越过 normal 区继续完成；重复同一无效 Tool/相同结果会在远低于 Hard Limit 前终止；新 Run 不继承上一 Run 的 loop penalty。

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
- **验证**：对 missing field、wrong type、oversized nested collection、未知 enum、旧 protocol version、损坏 JSON 增加边界测试；Agent/Runner 权威路径不再出现无 decoder 的泛型 `JSON.parse(...) as T`。

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

---

## 本轮已从 Problem 移出的内容

以下类型已经不再作为“当前问题”保留：

- 已由后续提交闭环的问题，例如 Terminal checkpoint（原 P-046）、顶层页面 KeepAlive/revalidate（原 P-047）、编辑器 `Ctrl+/`（原 P-048）、Agent enable effective-state 校验（原 P-052）以及当前 UI 已吸收的 Toast/Auto-save/安全分区/BaseFormField 等问题。
- P-001～P-044 中已经修复、被后续实现取代、仅描述某次 dev/PVE/CDP/公网调试环境或属于阶段性 UI 施工稿的条目；历史仍可从 Git 找回。
- 原 P-049 的“文档收口施工计划”：有效内容已经进入 `AGENT.md`、SRS、工程约束与本轮审计，不再把施工计划本身当问题。
- 原 P-057 Windows Desktop 规划：它是 roadmap/design，不是缺陷，已迁到 `software-requirements/design/special-designs.md` 的 `SD-DESKTOP-001`。

后续新问题继续使用 `P-063` 起的编号；问题闭环并完成验证后直接从本文件删除，不保留“已完成墓碑”。
