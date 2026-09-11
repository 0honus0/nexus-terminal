# MODULE_DEPENDENCY_DESIGN Review

审查范围：`MODULE_DEPENDENCY_DESIGN.md`，并对照同目录的 `ARCHITECTURE.md`、`CURRENT_AGENT_ARCHITECTURE.md`、`IMPLEMENTATION.md`。

结论：总体分层方向正确，Port 收窄、StateCommit 单一事务入口、Tool inspect/policy 分离等设计应保留；但当前依赖图仍有几处职责过重和文档口径不一致。建议先处理 P1，再进行目录级重构。

## P1：建议在下一轮重构处理

### 1. `NativeAgentBackend` 依赖过多，成为隐性编排中枢

文档为它注入 `RunRepositoryPort`、`DelegationRepositoryPort`、Provider、Context、Model、StateCommit、ToolCatalog、ToolExecutor、Lease、Policy、Limiter、Clock 等十余项能力，同时承担模型循环、审批重检、lease、取消、结果落库和 delegation 读取。这样会使执行策略与基础设施细节继续耦合，也会让每次新增 capability 都修改核心 backend。

建议拆成三个明确的内部服务，并由 backend 只做顺序编排：

```text
ModelStepRunner       -> Context / LanguageModel / ModelCallLimiter
ToolExecutionCoordinator -> ToolCatalog / ToolExecutor / Policy / Lease
RunProgressCoordinator -> RunRepository / StateCommit / Clock
```

三者都只依赖 Port；`NativeAgentBackend` 保留取消、阶段顺序和最终错误映射。不要把三者提升为新的领域实体或公共 facade。

> **解决方案（已采用）**
>
> 审核后不采用原建议中的第三个 `RunProgressCoordinator`，避免把 `RunRepositoryPort + StateCommitPort + ClockPort` 再包装成一个模糊 facade，削弱 durable transition authority 的可见性。实际拆为两个 execution-internal runner：
>
> ```text
> ModelStepRunner -> Provider / Context / LanguageModel / ModelCallLimiter
> ToolCallRunner  -> ToolCatalog / ToolExecutor / Policy / read lease / staged mutation lease
> ```
>
> `NativeAgentBackend` 继续直接持有 Run execution read capability、`DelegationReaderPort`、`StateCommitPort` 与 `ClockPort`，只负责 Run 主循环、阶段顺序、模型步骤 durable transition、cancel/fail safe boundary。构造依赖由 13 项降为 6 项；模型 transport/context 与 Tool/Policy/Lease 不再直接注入 Backend，Root 也不取得 delegation create/cancel authority。后续 read least-authority 收敛又把 Run 读取固定为 `RunExecutionReaderPort`（`snapshot/rootRuntimeId/pendingMutation`）。Backend architecture checker 固定禁止低层 execution dependency、宽 delegation capability 与额外 Run reader 重新进入 `NativeAgentBackend`。

### 2. Lease 安全职责出现双重入口

当前 Root mutation 同时由 `LeaseCoordinator` 和 `LeasePort` 直接参与：前者负责通用 acquire/renew/release/quarantine，后者又被 `NativeAgentBackend` 直接用于 mutation-active / settled 标记。这样容易出现 read/mutation 两套续租、释放和异常处理语义，尤其在未知结果、取消和进程重启时。

建议增加一个窄的 `MutationLeasePort`（或 `MutationGuardPort`）统一 mutation 生命周期：

```text
beginMutation -> mark active -> side effect -> settle/quarantine
```

`NativeAgentBackend` 只调用该 capability；底层仍可复用 `LeasePort`，但不得同时暴露给 runtime execution。`LeaseCoordinator` 保留只读资源 lease primitive，避免把 mutation 状态机塞进通用 coordinator。

> **解决方案（已采用）**
>
> 不直接复用现有 Workspace `MutationGuardPort`，因为它的 `beginMutation()` 在拿到 lease 后会立即 `markMutationActive`，会把 Agent 要求的 `durable mutation state` 顺序提前。Agent Runtime 改为内部 `MutationLeaseGuard` capability：
>
> ```text
> acquire write lease
> -> StateCommit.beginMutationTool   # durable mutation state
> -> MutationLeaseGuard.activate
> -> side effect
> -> StateCommit.settleMutationTool
> -> MutationLeaseGuard.confirm / quarantine
> ```
>
> `MutationLeaseGuard` 独占 mutation lease 的 acquire/renew/active/settled/release/quarantine 低层操作；`NativeAgentBackend` 不再持有或调用 `LeasePort`。`LeaseCoordinator` 只继续服务 read lease / 非 mutation lease primitive。renewal failure、未知副作用和 state commit after-effect failure 都由该 capability 收敛到 quarantine。Backend architecture checker 已增加静态规则，禁止 `runtime/execution/native-agent-backend.ts` 直接依赖 `LeasePort` 或调用 `markMutationActive/markMutationSettled`。

### 3. `SubagentScheduler` 聚合五类 Repository Port，边界仍偏宽

虽然已经从一个大 Repository 拆成多个 Port，但 Scheduler 仍直接持有 `runScopes`、`work`、`delegations`、`runtimes`、`mailboxes`，并负责 claim、上下文拼装、participant 查找、settle。Port 数量减少了权限泄漏，却没有完全解决调度策略与协作存储细节耦合的问题。

建议引入两个内部 adapter：

```text
SchedulerWorkStore       -> scope/claim/ready/settle
CollaborationContextStore -> delegation/runtime/mailbox reads
```

Scheduler 只依赖这两个 capability；adapter 内部再收窄到现有 Repository Port。这样可独立测试调度策略，也可在未来替换 SQLite 查询而不改 Scheduler。

> **解决方案（已采用，与 R9 合并）**
>
> 审核后确认五个 Repository Port 本身已经按用途收窄，单纯再包装成 `SchedulerWorkStore / CollaborationContextStore` 只会把依赖藏进 facade，不能减少职责，因此不采用原建议。实际根因是 Scheduler 同时承担 durable scheduling 与 participant execution。
>
> 当前改为：
>
> ```text
> SubagentScheduler
>   -> settings / scope / durable work scan+claim / fairness / capacity / active tracking / quiesce
>
> SubagentParticipantExecutor
>   -> 已 claim work 的 child model/tool execution、StateCommit settle、completion/failure/cancel 协作
>
> SubagentContextBuilder
>   -> runtime/mailbox/tool-history context、child tool schema、context/token limits
> ```
>
> durable scan/claim authority 继续只属于 `SubagentScheduler`，其类型依赖已收窄为 `SchedulerWorkClaimPort`；executor 只能拿 `SchedulerWorkExecutionPort` 处理已经 claim 的 work，可使用 `settleWork/enqueueWork` 完成执行结果与后继 work，但类型上不能 scan/claim/reset。Backend architecture checker 已固定该 owner，并禁止 claim capability 回流 executor、execution capability 回流 Scheduler。

## P2：建议同步调整

### 4. Run 读取接口偏宽，但 StateCommit authority 未分裂（审核后降为 P3，已收敛）

> **审核结论：原竞态判断不成立；不按原 race 方案重构。**
>
> 原审核确认当时的 `RunRepositoryPort` 是纯读取 Port，没有 durable mutation 方法。`RunSnapshot` 自带 `version/eventCursor`，`SqliteRunRepository.snapshot()` 在同一数据库 transaction 中读取 Run projection 与 recent entries；所有 Run/Step/Tool/Approval/Subagent durable transition 仍由 `StateCommitPort` 持有，并通过 `expectedRunVersion`、Tool/Step version、work `ownerEpoch/version` 等 CAS 防止旧快照覆盖新状态。因此“读取快照来自 A、提交版本来自 B”属于正常 optimistic concurrency，冲突会 fail closed 为 `STATE_CONFLICT`，不是现存竞态缺陷。
>
> **解决方案（已采用，与 P2-代码-2 同一实施）**：删除 broad `RunRepositoryPort`，按真实消费面拆成 `RunSnapshotReaderPort`、`RunQueryPort`、`RunExecutionReaderPort`、`RunEventReaderPort` 与 `HostCursorReaderPort`。`NativeAgentBackend` 只拿 `RunExecutionReaderPort`；Plan/Approval/Checkpoint/Subagent participant 只拿 snapshot reader；`SubagentService` 只拿 snapshot + host cursor；`RunService` 只拿 snapshot + list。`SqliteRunRepository` 仍是同一个 adapter，不拆数据库实现、不改变 transaction/StateCommit authority。
>
> `createdQueue()` 经当前 HEAD 全仓扫描确认无产品 consumer，已按 pre-release 策略从 Port 与 SQLite adapter 删除；未来若 durable scheduler 确有该查询需求，再按当时 owner 重新引入。Architecture checker 禁止 broad `RunRepositoryPort` / `createdQueue` 回流，并固定各核心 consumer 的最大 Run read capability。该项保持 P3 定性，但结构问题已关闭。

### 5. Plugin / Workspace Runtime 的阶段边界在依赖文档中不够显式

`MODULE_DEPENDENCY_DESIGN.md` 同时描述当前 dev 架构、ACP/Browser/MCP 后继边界和 Workspace Runtime 调用边界，但没有在每个依赖图旁标注 Phase。读者容易把保留的后继 Port 当成当前 live dependency，导致提前实现或错误接线。

建议在每个后继模块标注 `Phase 2/Phase 3 / reserved`，并在依赖图中区分：

```text
active dependency      实线
reserved capability    虚线
```

同时增加一张“当前已接线依赖”小图，作为代码审查和架构 checker 的唯一输入。

> **解决方案（已采用，按审核结论修订）**
>
> 该问题仅保留为文档状态表达问题，不采用“Phase 2/Phase 3 = 当前状态”的标注，也不让 architecture checker 以文档依赖图作为唯一规则源。源码 import graph 与显式 source rule 继续是静态硬门禁，文档负责准确描述当前 wiring。
>
> `MODULE_DEPENDENCY_DESIGN.md` 现在统一使用 **Active / live** 与 **Reserved / roadmap-only** 两类状态：Plugin Runtime、Workspace Runtime、MCP 标为 Active/live；ACP、Browser/CDP/Puppeteer 继续标为 Reserved/roadmap-only。原“ACP / Browser / MCP 保留边界”标题已改为中性的 execution 状态边界，避免把已 live 的 MCP 误读为 reserved。P1/P2/P3 明确只作为历史实施/验收分组，不作为当前交付状态。

### 6. `exchange` 目录边界与 architecture checker 曾存在实际漂移

> **解决方案（已采用，按审核结论修订）**
>
> 审核后确认，真实问题不是缺少一张覆盖所有能力的 owner 总表，而是 canonical docs 与静态 guard 对 `exchange` 的物理 owner 已发生具体漂移：当前实现与 `IMPLEMENTATION.md` 都把 Workspace↔Artifact 等跨资源 bridge 固定在独立 `modules/agent/exchange`，但 `ARCHITECTURE.md` 曾把 `exchange` 误列为 Runtime 子域，Backend architecture checker 的 `allowedRuntimeSubdomains` 也曾继续允许 `runtime/exchange/*`。
>
> 当前已统一为：Runtime 子域仅包含 `definitions / runs / execution / planning / scheduling / approvals / recovery / events / collaboration`；跨资源协调固定放在独立 `modules/agent/exchange`。Backend architecture checker 已从 Runtime allowlist 删除 `exchange`，未来若重新创建 `modules/agent/runtime/exchange/*` 会直接失败。
>
> 不新增一张需要人工同步的全局 `Public Port / Orchestrator / Concrete Adapter` registry；真实源码 import graph、目录 guard 与显式 source rule 继续作为硬约束，文档按能力章节记录 owner。

## P3：可维护性改进

### 7. Collaboration Repository capability 的 least-authority 需要在类型层表达

> **解决方案（已采用，按实际 consumer 拆 capability）**
>
> 审核确认问题真实，但不做机械的全局 `Reader/Writer/Store` 重命名。`RuntimeParticipantRepositoryPort` 本身已经是纯 read，`SharedFactRepositoryPort.getFact/compareAndSetFact` 也应保持原子 CAS capability，不为命名整齐而拆散。
>
> 实际收窄的是存在权限冗余的消费边界：`DelegationReaderPort` 只读，`DelegationCancellationPort` 增加 cancel，只有 `DelegationRepositoryPort` 再增加 create；`MailboxReaderPort`、`MailboxConsumerPort` 与完整 `MailboxRepositoryPort` 分开；Scheduler work 拆成共享 settle、`SchedulerWorkClaimPort` 与 `SchedulerWorkExecutionPort`。`NativeAgentBackend`、`MailboxService`、`SubagentContextBuilder`、`SubagentParticipantExecutor` 与 `SubagentScheduler` 现在分别只拿真实调用所需 capability，同一个 `SqliteSubagentRepository` 继续作为 concrete adapter。
>
> 未使用的 `claimNextWork()` 已删除；pre-release 阶段不为假设性后继需求保留 API，未来若出现真实 consumer 再按当时 owner/语义加入。Backend architecture checker 同时阻止宽 capability 或 claim/execution authority 回流。

### 8. 增加依赖约束的自动化验收项

> **解决方案（已采用，按审核后的 coverage 补 guard）**
>
> 原建议第 1 条不再增加重复专用规则：`modules -> infrastructure/interfaces` 的 layer checker 已阻止 `NativeAgentBackend` 直接取得 SQLite/Runner concrete adapter，`modules` 直接 import `express/ws/ssh2` 也已有 technology-package guard。
>
> 本轮补齐其余真实 coverage 缺口：
>
> 1. 整个 `modules/agent/runtime/**` 禁止直接调用底层 `markMutationActive/markMutationSettled`；mutation marker 继续只属于 staged mutation lease infrastructure capability；
> 2. `SubagentScheduler` 明确禁止取得 `RelationalDatabase` 或调用 `.transaction()`，避免 scheduler 获得 persistence transaction authority；
> 3. `infrastructure/agent/runtime/state-commit/*-transitions.ts` 的每个导出 `*Transition` 必须以 `tx: RelationalDatabase` 为首参数，且 transition module 自身禁止重新 `.transaction()`；
> 4. `bootstrap/agent/**` 禁止 ACP/Browser reserved runtime/gateway symbol 与 `integration.acp.execute` / `browser.operate` capability 进入 production composition；Operations manifest 同样静态禁止声明这两个 reserved capability。
>
> 当前代码在加 guard 前已满足以上边界；本项修复的是自动化防回退能力，不改变 Runtime 行为。ACP/Browser 的 Port/Adapter/schema skeleton 继续保留，只有 production live wiring 被禁止。

## 建议实施顺序

1. 先统一 mutation lease 入口，并补未知结果/取消路径的契约测试；
2. 拆 `NativeAgentBackend` 的三个内部 coordinator，保持 public API 不变；
3. 将 Scheduler 的五个 Port 收敛为两个内部 capability；
4. 拆分 `RunSnapshotPort` 与 `StateCommitPort` 的读写语义；
5. 更新依赖图、owner 表和 Phase 标记，再同步 architecture checker。

以上调整不改变 Run、ToolCall、Approval、Workspace、Artifact 等领域实体，也不建议引入新的 `Task`、`Job`、`Workflow` 一级实体。

## 代码实现复核补充

以下意见来自对 `packages/backend/src` 与 `packages/frontend/src/features/agent` 当前实现的检查。

### P1-代码-1：`NativeAgentBackend` 的实际依赖比设计文档更集中

`packages/backend/src/modules/agent/runtime/execution/native-agent-backend.ts` 的构造函数当前直接接收 13 项依赖，并在同一个类中完成 snapshot 读取、provider/model 选择、上下文组装、预算预留、模型调用、Tool inspect/execute、delegation 上下文、lease、取消和 StateCommit。此前文档中的“建议拆分”已经被源码验证为真实重构点，而不是预防性建议。

建议先抽出 `ModelStepRunner` 和 `ToolCallRunner` 两个文件，保留 `NativeAgentBackend` 的 public `AgentBackendPort` 不变；每次只迁移一条完整调用链，避免一次性拆散状态顺序。

> **解决方案（已采用，与 P1 #1 同一实施）**：新增 execution-internal `ModelStepRunner` 与 `ToolCallRunner`，保留 `AgentBackendPort` 不变，不新增公共 facade。`ModelStepRunner` 接管 Provider/Context/model stream/model limiter/retry transport；`ToolCallRunner` 接管 inspect/policy、read lease 与 staged mutation lease/Tool execution。`NativeAgentBackend` 保留 Run snapshot、StateCommit 编排和 terminal boundary，避免把 durable authority 移入新的“进度协调器”。

### P1-代码-2：mutation lease 仍存在直接旁路

源码中 `NativeAgentBackend` 同时注入 `LeaseCoordinator` 和 `LeasePort`（见其构造函数及 `compose-agent.ts` 的实例化），与文档描述的双重入口完全一致。这样 runtime execution 可以绕过 coordinator 直接操作底层 lease，后续很难保证 read、mutation、quarantine 的统一审计和释放顺序。

建议删除 `NativeAgentBackend` 对 `LeasePort` 的直接依赖，改为注入窄的 mutation guard port；`LeaseCoordinator` 只作为该 port 的 infrastructure-backed implementation 或只服务 read lease。

> **解决方案（已采用，与 P1 #2 同一实施）**：采用 Agent 专用 staged `MutationLeaseGuard`，不采用会提前 mark-active 的通用 Workspace `MutationGuardPort`。底层 `LeasePort` 只留在 guard adapter owner 内，`NativeAgentBackend` 只经 `ToolCallRunner` 使用窄 mutation lease capability。安全顺序固定为 `Lease acquire → StateCommit.begin → mark active → side effect → StateCommit.settle → settle/release 或 quarantine`，不得把 `mark active` 移到 durable begin 之前。

### P1-代码-3：`composeAgent()` 的 Tool contribution 注册过度集中（审核后降为 P2）

审核确认结构问题真实，但原“第二个业务编排层”判断偏重：Run/Tool/Policy/Lease/Workspace/MCP 的实际业务行为仍在各自 Service/Tool/Adapter 中，`composeAgent()` 主要承担依赖连接。真实增长点是它曾直接 import Operations Tool creator，并手写 machine、workspace、plan、collaboration 与 MCP 的 contribution id/capability/lifecycle 注册细节，导致新增 Tool 持续扩大组合根。

> **解决方案（已采用，只拆 Tool contribution registration）**
>
> 新增 `bootstrap/agent/tool-contributions.ts`，提供 `registerMachineToolContributions()`、`registerWorkspaceToolContributions()`、`registerRuntimeToolContributions()` 与 `createMcpToolContributionHooks()`。这些函数只把已构造的 Port/Service 转成 `CapabilityContribution` 并注册到 `ToolCatalog`；不拥有 Scheduler、StateCommit、Policy、Lease 或 lifecycle 状态机。
>
> `composeAgent()` 继续保留 concrete adapter 创建、scheduler/lifecycle callback、AgentServices facade 与 App contribution wiring，不为了缩文件行数拆出无意义 facade，也不引入通用 DI/container。Backend architecture checker 禁止 Operations Tool creator、`registerContribution()` 或 `replaceOwnedContribution()` 重新直接进入 `compose-agent.ts`。

### P2-代码-1：Frontend Host 直接 import Operations UI，违反已声明 App 隔离边界

审核确认问题真实：`AgentHubWindow.vue` 曾直接静态 import `apps/operations/OperationsView.vue`，且 frontend architecture checker 还显式允许 `host -> apps/operations`，与 canonical `IMPLEMENTATION.md` 的 Host/App ownership 约束相冲突。

> **解决方案（已采用）**
>
> 新增 `apps/operations/public.ts`，只从 Operations owner 内部 lazy export `OperationsAppView`；新增 `host/builtin-apps.ts` 作为唯一静态 builtin composition seam，按 App id 返回 public view。`AgentHubWindow.vue` 只依赖 `builtin-apps.ts`，不再知道 `OperationsView.vue` 的私有路径；安装式 App 仍统一走 `PluginAppFrame`。
>
> Frontend architecture checker 已移除通用 `host -> apps/operations` 许可：`host/**` 默认不得依赖 `apps/**`，仅 `host/builtin-apps.ts` 可 import `apps/<app>/public.ts`，不能直接 import App 私有 Vue 实现。这样内置 App 的静态 composition 例外被集中、可审计，也保留未来增加 builtin App 时的明确扩展点。

### P2-代码-2：后端 Run read capability 过宽（已收敛）

审核确认不是 Infrastructure 越层问题，而是 read least-authority：同一个 `SqliteRunRepository` 可以继续复用，但此前多个 runtime consumer 都通过 broad `RunRepositoryPort` 获得与实际调用无关的查询权限。

> **解决方案（已采用，与 Review #4 同一实施）**
>
> 不按业务名复制 `RunPlanReader/CheckpointReader`，因为这些 consumer 实际都只需要同一个 `snapshot()` capability。改为按方法权限拆 `RunSnapshotReaderPort`、`RunQueryPort`、`RunExecutionReaderPort`、`RunEventReaderPort`、`HostCursorReaderPort`；同一个 `SqliteRunRepository` 同时实现这些接口，composition root 依赖 TypeScript structural typing 注入窄 capability。
>
> `NativeAgentBackend` 只拿 `snapshot/rootRuntimeId/pendingMutation`；`SubagentParticipantExecutor`、Plan、Approval、Checkpoint 只拿 snapshot；`SubagentService` 只拿 snapshot + host cursor；`RunService` 只拿 snapshot + list。无 consumer 的 `createdQueue()` 已删除。Backend architecture checker 禁止 broad Run repository capability 回流，并针对上述核心 consumer 固定其允许的 reader 上限。

### P2-代码-3：运行时与后继能力在源码目录中已并列，但 production wiring 已有硬门禁（已解决）

审核后确认目录并列本身不是 authority，也不需要为了“看起来未接线”移动或删除 ACP / Browser/CDP/Puppeteer skeleton。当前真正需要保证的是 production composition 与 manifest 不把 reserved 能力接入 live execution。

> **解决方案（已采用，由前述状态文档与 Review #8 静态 guard 完成）**
>
> `ARCHITECTURE.md`、`IMPLEMENTATION.md`、`MODULE_DEPENDENCY_DESIGN.md`、`CURRENT_AGENT_ARCHITECTURE.md` 已统一标记：MCP = **Active / live**，ACP = **Reserved / roadmap-only**，Browser/CDP/Puppeteer = **Reserved / roadmap-only**。Backend architecture checker 已禁止 ACP/Browser reserved adapter/Port 符号进入 `bootstrap/agent/**`，并静态禁止 Operations manifest 声明 `integration.acp.execute` / `browser.operate`；当前 production composition 只实例化 MCP live runtime。ACP/Browser skeleton 继续原位保留，未来只有在 capability、Policy/Approval/Lease/StateCommit、runtime wiring、UI/API、failure/recovery 与产品 E2E 全部完成后才能移除 reserved 状态。

### P3-代码-1：Tool contribution owner 元数据建议过度；公开 API 仍可收窄（审核后已收敛）

审核确认原问题的大部分已经被 Tool contribution wiring 重构覆盖：静态 contribution 已集中到 `bootstrap/agent/tool-contributions.ts`；`registerContribution()` 对同名 Tool fail-closed；MCP 动态 contribution 通过 `scope + ownerKey` 调用 `replaceOwnedContribution()`，只能替换同 scope、同 owner 的 Tool，因此静态与动态 contribution、不同 MCP integration 之间都不能互相覆盖。

> **解决方案（已采用）**
>
> 不增加 `ownerAppId / phase / lifecycle / replacePolicy`。`ownerAppId` 会把实现 owner 与授权 scope 混淆；`phase` 已明确不作为当前 live 状态；`lifecycle/replacePolicy` 已由 `registerContribution()` 与 `replaceOwnedContribution()/removeOwned()` 两组 fail-closed API 表达，重复元数据会形成第二份真相。
>
> 实际剩余问题只做 API least-authority 清理：`registerContribution()` 收窄为仅接受静态 contribution，不再公开可选 `scope/ownerKey`；动态 scoped ownership 只能走 `replaceOwnedContribution()`。无产品 consumer 的 `CapabilityContributionView`、`ToolCatalog.contributions()` 以及随之失去用途的内部 `contributionId` 存储已删除。未来若出现真实 contribution introspection consumer，再按其授权与数据需求重新设计。

### P3-代码-2：架构违规检查应纳入源码门禁（已完成）

审核确认原建议的四类违规路径现在都已有硬门禁，不需要继续叠加重复规则：

1. Frontend `host/**` 默认禁止依赖 `apps/**`，仅 `host/builtin-apps.ts -> apps/<app>/public.ts` 是唯一静态 builtin 例外；
2. `NativeAgentBackend` 禁止依赖底层 `LeasePort`，整个 Agent Runtime 也禁止直接调用 `markMutationActive/markMutationSettled`；
3. `compose-agent.ts` 禁止 Operations Tool creator 以及直接 `registerContribution()/replaceOwnedContribution()`，Tool contribution metadata 与 creator 已收敛到专用 bootstrap helper；
4. ACP/Browser reserved adapter/Port 禁止进入 `bootstrap/agent/**`，Operations manifest 也静态禁止 `integration.acp.execute` / `browser.operate`。

这些规则已分别由 Review #2/#8、P1-代码-3、P2-代码-1 等实施完成；本项作为汇总验收关闭，不再新增同义 checker 规则。

## 前后端 Runtime 深度审核（第一批）

本节基于当前源码逐文件检查，重点覆盖 Backend Scheduler/Execution/Event、HTTP/WS 事件链路，以及 Frontend API/Run 投影。

### R1：`AgentScheduler` 的并发计数混用了全局 active 与按用户限制

位置：`packages/backend/src/modules/agent/runtime/scheduling/scheduler.ts`。

`pump()` 使用：

```ts
this.active.size + this.externalActiveCount(next.run.userId) >= maxConcurrent;
```

`this.active.size` 是整个进程、所有用户和所有 App 的运行数，而 `maxConcurrent` 是当前用户设置。只要用户 A 已经运行了较多 Run，用户 B 即使没有任何运行中的 Run，也可能被错误阻塞；反过来，当 `externalActiveCount` 只统计协作 scheduler 时，也无法准确表示同一用户的全部 Runtime。

影响：多用户场景下调度公平性和配置语义错误，可能出现无关用户互相阻塞；单用户场景下也无法区分 root runtime 与 subagent runtime 的配额。

建议：维护 `activeByUser: Map<number, number>`，统一由 root/subagent scheduler 上报按用户计数；检查条件改为：

```text
activeByUser[userId] + externalActiveByUser[userId] < effectiveLimit[userId]
```

如果产品还需要全局上限，单独增加 `globalMaxConcurrentRuntimes` 并单独判断，不要复用用户级上限。启动、正常结束、异常结束和 quiesce 都必须通过同一计数器增减，并用 finally 防止泄漏。

### R2：调度队列为进程内存结构，恢复依赖外部唤醒，重启后存在“已创建但不再执行”窗口

位置：`scheduler.ts` 的 `queues`、`active`，以及 `SubagentScheduler` 的同类内存状态。

当前队列、active controller 和 requeue 状态都只存在内存。虽然 Run/Work 状态会持久化，但进程重启后是否能被重新扫描、重新入队，取决于 bootstrap sweep 和调用方是否恰好触发 wake；文档要求 durable scheduler，但代码主调度器仍是 memory-first。

影响：进程在 `created/running` 与真正 enqueue 之间崩溃时，Run 可能长期停留在非终态；active 执行中断后如果没有 recovery sweep，可能没有明确的 `interrupted` 或 reconciliation 记录。

建议：将 scheduler 明确拆为 `DurableRunnableScanner` 与 `InProcessDispatcher`：

1. scanner 按固定周期和启动阶段扫描 `created/running/awaiting_*` 中可运行项；
2. dispatcher 只保存短期执行句柄，不把它作为 work existence 的事实来源；
3. claim 使用数据库版本/CAS，带 owner epoch、lease expiry 和 attempt watermark；
4. 进程重启先把过期 owner 标记为 interrupted/reconciling，再重新扫描可恢复项。

### R3：`AgentScheduler` 使用 `Date.now()`，没有遵循统一 `ClockPort`

位置：`scheduler.ts` 中的 `enqueuedAt`、quiesce deadline 和 transient event 时间。

Runtime 其他模块已注入 `ClockPort`，但 Scheduler 直接使用墙上时间，导致测试无法稳定控制时间，也可能在系统时钟回拨/跳跃时错误计算排空超时。`enqueuedAt` 目前没有被使用，反而增加了误导性的时间状态。

建议：注入 `ClockPort`，同时区分 `nowUnixSeconds()` 与 `nowMonotonicMilliseconds()`；排空、重试和 lease deadline 使用单调时钟，事件落库时间使用 Unix 时间。删除未使用的 `enqueuedAt`，或将其真正用于公平性/超时策略。

### R4：Scheduler 捕获执行异常后只记录日志，没有保证 Run durable failure

位置：`AgentScheduler.start()` 的 `catch`。

当前异常路径只执行 `console.error`，随后从 `active` 删除并继续 pump。若异常发生在 backend 尚未调用 StateCommit 的窗口，Run 可能继续保持 `running`，没有 `failed/interrupted`、错误码或 reconciliation 标记。

建议：为 `AgentBackendPort.execute()` 定义可恢复/不可恢复错误契约；Scheduler catch 必须调用一个幂等的 `StateCommit.markExecutionInterrupted/failed`，带 expected version、owner epoch 和错误分类。若提交失败，写入 recovery queue，由 lifecycle sweep 重试，而不是仅依赖日志。

### R5：Backend EventHub 只负责进程内分发，无法单独保证订阅期间的顺序与背压

位置：`packages/backend/src/modules/agent/runtime/events/event-hub.ts`。

EventHub 直接同步遍历 listener，listener 异常会向发布方传播；没有 per-listener queue、顺序序号校验、慢消费者隔离或最大缓存。当前 durable 事件依靠外部 cursor replay，transient 事件则可能在慢客户端或 listener 抛错时丢失，这种差异没有在接口类型中明确表达。

建议：将 EventHub 分成 `DurableWakeBus` 与 `TransientEventBus`。前者只发布“有新 cursor”的提示，不承载事件内容；后者为每个订阅建立有界异步队列，listener 异常隔离，超限时主动丢弃并发送 `transient_gap`。对所有 publish 使用 try/catch，禁止订阅者异常破坏状态提交调用栈。

### R6：Frontend WebSocket 订阅没有自动重连、退避和 cursor 重新同步

位置：`packages/frontend/src/features/agent/api/agent-events.ts`。

`connect()` 建立单个 socket，关闭后直接结束 async iterator；调用方如果没有重新创建 iterator，订阅即永久停止。代码也没有指数退避、最大重连间隔、连接代次或重新从最后 durable sequence 订阅的机制。ephemeral 事件在断线期间丢失是允许的，但 durable wake 必须触发 API 重新拉取，否则 UI 会停留在旧 Run snapshot。

建议实现 `AgentEventSubscription`：

```text
lastDurableCursor
  -> socket close
  -> exponential backoff + jitter
  -> subscribe(lastDurableCursor)
  -> replay API / snapshot refresh
```

重连期间合并重复 cursor，只允许单个 active socket；认证失效立即停止并交给 auth session 处理。把“durable wake 只表示需要 refresh”写进类型和调用约定，避免组件把它当作完整事件流。

### R7：Frontend API 层缺少统一的 Run cursor/store，组件容易各自拉取并覆盖新状态

位置：`packages/frontend/src/features/agent/runtime/run-facade.ts`、`api/agent-api.ts` 及 Runtime Vue 组件。

`createAgentRunFacade()` 只是 API 方法转发器，没有维护当前 Run 的 `version/eventCursor/inputRevision`，也没有处理并发请求返回乱序。组件收到事件后若分别调用 `getRun/listApprovals/listSubagents`，旧响应可能覆盖新响应，形成状态回退。

建议新增按 `appId/runId` 索引的 `run-store`：

1. 所有 snapshot 采用 `version` 单调合并，旧版本直接丢弃；
2. durable wake 按 cursor 去重并串行刷新；
3. approval/plan/subagent 子资源随同一 snapshot revision 更新；
4. mutation 请求带 `expectedVersion`，冲突统一转换为 refresh-and-retry 或显式冲突状态；
5. 组件只读 store，不直接管理请求竞态。

### R8：前端事件解析允许任意 `payload`，协议校验停留在外壳层

位置：`agent-events.ts` 的 `parseWireEvent()`。

当前只校验 durability、sequence、eventType 和 occurredAt，事件 payload 保持 `unknown` 后直接交给上层。这样一旦后端变更字段或恶意/损坏消息进入客户端，错误会延迟到任意组件，难以定位；同时 eventType 与 payload 的对应关系没有类型保证。

建议建立 discriminated union：按 `eventType` 为 `run.status_changed`、`tool.*`、`message.*`、`approval.*` 定义 payload schema，解析阶段完成校验和版本兼容；未知事件保留为 `AgentUnknownEvent` 并记录 telemetry，不直接投影到业务状态。

### R9：`SubagentScheduler` 文件接近 1000 行，调度、模型执行和协作上下文没有形成可替换边界

位置：`packages/backend/src/modules/agent/runtime/collaboration/subagent-scheduler.ts`。

该文件同时包含初始化清理、claim、work selection、delegation/runtime/mailbox 查询、上下文截断、model call、tool execution、lease、StateCommit settle、重试和 quiesce。它实际上复制了 Root Runtime 的一部分执行循环，又额外耦合 collaboration 查询，后续 Root 与 Subagent 的修复很容易分叉。

建议拆为四层：

```text
SubagentWorkScanner       -> durable ready/claim/recovery
SubagentContextBuilder    -> delegation/mailbox/shared facts + limits
ParticipantExecutor       -> model/tool/lease execution
SubagentWorkCoordinator   -> state commit、重试、取消、事件
```

其中 `ParticipantExecutor` 应复用 Root 的通用 `ModelStepRunner`/`ToolCallRunner`，差异通过 participant policy 注入；不要继续复制 NativeAgentBackend 的逻辑。

> **解决方案（已采用，与 P1 #3 同一实施）**
>
> `subagent-scheduler.ts` 已从接近 1000 行收敛为只负责 durable work scheduling 的窄 Scheduler；新增 `SubagentParticipantExecutor` 与 `SubagentContextBuilder`，分别形成 participant execution 与 collaboration context 的可替换边界。没有新增 `SubagentWorkCoordinator` facade，因为 child durable transition 仍应显式通过现有 `StateCommitPort`，避免把 StateCommit authority 隐藏到新的大协调器中。
>
> 当前也没有强行让 child 直接复用 Root `ModelStepRunner`：Root runner 的 `ContextService + RunSnapshot` 输入和 retry/budget durable transition 是 Root-specific，直接复用会改变 child budget/context 语义。共享点保持在已有 `ModelCallLimiter`、model accounting、execution error、lease primitive；后续若抽出 participant-neutral model transport primitive，必须先证明不会改变 Root/child 的 StateCommit ordering。`ToolCallRunner` 同理暂不直接注入 child，因为它包含 Root policy/staged-mutation 语义，而 child 当前只允许 read/control Tool。

### R10：Subagent 与 Root 的预算/并发/取消语义可能分裂

从 composition wiring 看，Root scheduler 与 `SubagentScheduler` 分别拥有 active count、model limiter、lease coordinator 和 enqueue callback。若一个 Run 同时包含 root 与 child，预算检查、取消传播和 app quiesce 由两个循环分别处理，容易出现 parent 已取消但 child 仍可 claim 新 work，或 child 用量未及时反映到 parent hard limit。

建议定义 Run 级 `ExecutionBudgetCoordinator` 和 `CancellationTree`：

- parent cancel 先写 durable cancellation intent，再广播给所有 participant；
- child claim 前检查 parent status/version 和 cancellation epoch；
- token/cost/step/message 使用统一原子 reserve/settle；
- active count 只由 coordinator 汇总，Root/Subagent 不各自维护独立事实。

### R11：`StateCommitPort` 接口过大，跨越 Run、Model、Tool、Approval、Subagent 多种事务语义

位置：`packages/backend/src/modules/agent/runtime/runs/state-commit.port.ts`。

该 Port 当前包含大量不同状态机的 command/result，调用者可以看到不属于自身生命周期的方法。虽然 concrete adapter 只有一个事务入口是正确的，但公共 Port 过大仍会造成权限和认知耦合。

建议保留一个 infrastructure 内部事务 facade，同时向模块暴露 capability-specific ports：

```text
RunCommitPort
ModelStepCommitPort
ToolCommitPort
ApprovalCommitPort
CollaborationCommitPort
```

这些 Port 由同一个 `SqliteStateCommitAdapter` 实现，内部共享 transaction context。这样既不破坏跨表原子性，也能让构造函数表达最小权限。

### R12：StateCommit command 需要统一幂等键、attempt 和 owner epoch

当前 RunService 已有 idempotency key，但模型 step、tool begin/settle、subagent work settle 等不同 command 的幂等语义分散在 transition 实现中。对于进程崩溃后重试，单靠 `expectedRunVersion` 只能拒绝旧写，不能区分“同一 attempt 的重放”与“新 attempt”。

建议所有外部副作用相关 command 统一携带：

```text
commandId / idempotencyKey
attemptId
ownerEpoch
expectedVersion
inputWatermark
```

数据库为 `(runId, commandId)` 或 `(toolCallId, attemptId)` 建唯一约束；重复提交返回原结果，owner epoch 过期返回明确 `STALE_EXECUTOR`，不要统一转成普通 conflict。

### R13：HTTP Runtime 路由虽有公共解析函数，但缺少统一 request schema 版本

位置：`packages/backend/src/interfaces/http/agent/app-runtime.routes.ts`、`agent-route-input.ts`。

当前路由大量依赖 `pathParam/queryString/parseLimit` 和 service 内部的手写字段校验。校验逻辑分散后，新增 endpoint 很容易漏掉 unknown key、数组长度、版本字段或 body 上限；前端也无法根据 endpoint 版本安全演进。

建议为 Run、Approval、Checkpoint、Workspace command 定义 versioned DTO schema（可用 AJV adapter），HTTP 层一次完成：unknown key 拒绝、大小/深度限制、枚举校验和 schemaVersion 检查；Service 只接收已解析的 domain command。错误响应统一返回 `code、field、expectedVersion、currentVersion?`，便于前端冲突处理。

### R14：Checkpoint resume 需要显式防重放与副作用状态检查

位置：`packages/backend/src/modules/agent/runtime/recovery/checkpoint.service.ts`。

Resume 虽然创建新 Run 是正确方向，但恢复前必须把 checkpoint 中的 tool/delegation 状态按“已确认、未知、未开始”分类。若 checkpoint 只保存 projection 而未保存 side-effect watermark，恢复逻辑可能把未知 mutation 当作未执行重新执行。

建议 checkpoint 增加 `recoveryManifest`：记录每个 tool attempt、operationHash、sideEffectStatus、verificationStatus、resource quarantine 和最后 event cursor。resume 只复制可安全重放的模型上下文；未知 mutation 必须先进入 reconciliation，不能直接进入 runnable。

### R15：前端 `WorkspaceRuntimePanel` 的多请求刷新保护不完整

位置：`packages/frontend/src/features/agent/runtime/WorkspaceRuntimePanel.vue`。

`refresh()` 使用 `refreshGeneration` 防止主请求覆盖，但 `loadGrants()` 在主请求完成后异步读取，未携带 generation 检查；用户快速切换 workspace/plugin target 时，旧 grants 响应可能覆盖新选择。`replaceGrants()` 也没有 expected revision/CAS 参数，连续保存可能丢更新。

建议：

1. 所有子资源请求携带 `generation` 和选中 key，响应只在两者仍匹配时写入；
2. grants API 返回 revision，替换时提交 expectedRevision；
3. 目标切换时取消旧请求（AbortController）；
4. 将 workspace、plugin installation、grant 分成 store slice，避免一个组件管理多个资源生命周期。

### R16：审批卡片使用本地墙上时钟，可能提前或延后显示过期

位置：`packages/frontend/src/features/agent/runtime/ApprovalCard.vue`。

组件用 `Date.now()` 每秒计算剩余时间，但服务端 approval expiry 是权威时间，客户端时钟偏差会导致按钮在服务端已过期时仍可点击，或反之。后端 CAS 会最终拒绝，但用户会看到错误操作。

建议后端返回 `serverNow` 或在 bootstrap/响应头提供时间偏移；前端以 `serverNow + monotonic elapsed` 计算倒计时。按钮点击前仍必须刷新 approval 或接受服务端 409，并将状态更新为 expired/stale，而不是只显示通用请求失败。

### R17：前端 Runtime 组件缺少统一的错误/冲突恢复状态

`TaskRail`、`WorkspaceRuntimePanel`、审批和文件传输组件各自维护 `busy/error/notice`。当 API 返回 version conflict、app draining、run interrupted 或 unknown outcome 时，组件通常只显示本地字符串，未触发 snapshot refresh 或 reconciliation UI。

建议定义 Runtime error state machine：`idle/loading/mutating/conflict/reconciling/failed`，在 API client 层映射错误码；组件只处理状态和用户动作。对 `VERSION_CONFLICT` 自动拉取最新 snapshot，对 `OUTCOME_UNKNOWN` 显示“需要核实”并提供 reconciliation 入口，避免用户重复点击产生第二次副作用。

### R18：Frontend `run-facade` 仍是无状态转发层，无法承载 Runtime 生命周期

`createAgentRunFacade()` 返回的函数直接调用 `agentApi`，没有 `dispose()`、事件订阅、请求取消、缓存或 active run 切换语义。Host/Hub 销毁时如果上层没有逐个停止 subscription，后台 async iterator 可能继续持有 socket。

建议 facade 变成显式生命周期对象：`start()` 建立 host/run subscriptions，`dispose()` 取消全部 AbortController，`selectRun()` 切换并清理旧资源；内部委托 `run-store` 做 cursor 合并。Vue 组件只消费 facade/store，不直接创建长期网络任务。

## Runtime 重构落地顺序

1. 先修复 `AgentScheduler` 按用户计数、异常 durable settle 和 Clock 注入；
2. 建立 durable scanner/recovery sweep，明确重启后的 claim/owner epoch；
3. 抽取 Root/Subagent 共用的 model/tool runner，削减两个超大执行文件；
4. 将 StateCommit 拆成 capability-specific ports，统一 command idempotency/attempt；
5. 增加 WebSocket 自动重连和前端 `run-store`，以 cursor/version 为唯一合并规则；
6. 修正 Workspace grants、approval server clock 和 Runtime error state machine；
7. 最后再做 HTTP schema/version 收敛和架构 checker 门禁。

## dev 分支兼容性复核

对比基线 `main` 与当前 `dev` 分支（重点检查 `1aa44fc`、`06445c5`、`4b79386`、`ae78197`）后，结论是：整体架构方向与此前 Agent 设计兼容，但有三类需要调整的兼容性问题：传输协议替换的迁移完整性、Runtime ownership 文档与实现的同步、以及新增 WebSocket 的事件一致性边界。

### D1：SSE→WebSocket 的替换方向合理，但属于协议 breaking change，不能只做代码切换

`1aa44fc` 删除了 Agent SSE 路由和 `agent-sse.ts`，新增 `/ws/agent`、`AgentProtocolSession` 和前端 WebSocket client。此前架构文档已经把原生 WebSocket 作为目标方案，因此方向兼容；但现有前端/第三方调用方若仍使用旧 SSE endpoint，会直接失效。

建议：

1. 在 `ARCHITECTURE.md`、`IMPLEMENTATION.md` 和 API 变更记录中明确协议版本与迁移窗口；
2. 保留一个短期 SSE compatibility adapter，或至少返回明确的 `410 AGENT_STREAM_PROTOCOL_REPLACED`；
3. E2E 同时覆盖 host/run 两种订阅、断线重连、cursor replay、权限拒绝和 quiesce；
4. 不要让 WebSocket 传输层反向改变 Event/Run 领域模型，继续保持“durable event replay + ephemeral delta”边界。

### D2：WebSocket subscribe 存在高水位读取与监听注册之间的竞态，可能永久漏掉 durable wake

位置：`packages/backend/src/interfaces/websocket/agent-protocol.session.ts` 的 `subscribe()`。

当前流程先读取 `highWater`，然后创建 listener、加入 `subscriptions`，最后 `scheduleDrain()`。如果事件在读取 highWater 后、listener 注册前提交，后续没有新的事件触发 wake，客户端会停在旧 cursor；这与原 SSE 的“注册后读取/定时唤醒”语义不兼容。

建议将订阅建立改为原子化顺序：先登记 subscription 和 wake listener，再读取起始 high-water，随后立即执行一次 drain；或采用两次读取校验：注册后再次读取 high-water，若高于初值则强制 drain。Run/host 两条路径都必须使用同一策略。

### D3：WebSocket 客户端当前仍是一次性连接，未完成新协议要求的断线恢复

`1aa44fc` 的后端实现支持 cursor replay，但前端 `agent-events.ts` 的 `connect()` 在 socket close 后直接结束 iterator，没有自动重连。也就是说，后端已经提供了 durable replay 能力，前端没有消费该能力，实际兼容性只完成了一半。

建议优先补齐前端 subscription supervisor：保存最后 durable sequence、指数退避重连、重连时重新 subscribe、连接期间只丢弃 ephemeral event，并在恢复后触发 snapshot refresh。否则 Agent UI 在代理重启、网络切换、浏览器休眠后会永久停止更新。

### D4：新 WebSocket 事件加入 `schemaVersion`，但前端解析器丢弃该字段

后端 `AgentProtocolSession.drain()` 会在 durable event 中发送可选 `schemaVersion`；前端 `AgentWireEventPayload` 和 `parseWireEvent()` 没有保留或校验该字段。未来事件 schema 演进时，客户端无法判断兼容版本，只能把不认识的 payload 当当前版本处理。

建议把 `schemaVersion` 纳入 wire event 类型并做正整数校验；按 `(eventType, schemaVersion)` 选择 parser，未知版本进入 `unknown event` 分支并触发 snapshot refresh，而不是静默投影。

### D5：WebSocket 生命周期已接入通用 server，但 Agent 专属连接配额和指标缺失

旧 SSE 实现有每 session 的连接上限、待发送事件上限和 writer drain；新实现有单 socket `MAX_SUBSCRIPTIONS` 与 bufferedAmount 限制，但没有 Agent connection/session 级限额，也没有区分订阅数、replay lag、重连次数和关闭原因的指标。

建议在 `websocket-server.ts` 的 `ClientRecord`/metrics 中增加 Agent 专属计数：每 user/session 的 socket 上限、每 socket subscription 上限、最大 replay duration、slow-consumer 次数和 protocol error 次数。连接配额应在 upgrade 或 session attach 阶段拒绝，不能等到订阅后才耗尽资源。

### D6：`4b79386` 的 StateCommit 拆文件是兼容性正向改动，但公共 Port 仍未同步收窄

将 3458 行的 `sqlite-state-commit.adapter.ts` 拆为 run/model/tool/approval/subagent transitions，符合“单一事务入口、transition 接收 tx”的既有设计，属于合理重构。但 `StateCommitPort` 仍暴露跨所有状态机的宽接口，调用方没有随拆分同步获得最小权限。

建议下一步只改 Port 与 constructor 注入，不再继续拆 concrete transition 文件：为 Run、Model、Tool、Approval、Collaboration 提供 capability-specific ports，均由同一 adapter 实现。

### D7：`06445c5` 前端 Workspace Runtime 拆分与既有边界兼容，但状态仍由父组件集中管理

将 `WorkspaceRuntimePanel.vue` 拆成 Create、Toolchain、Grants、ArtifactTransfer 子组件，改善了视图复杂度，符合 Frontend feature 内聚原则。但父组件仍持有 catalog/apps/installations/versions/workspaces/artifacts/grants 全部状态，且 grants 请求存在前述竞态；这属于文件拆分而非真正状态边界拆分。

建议进一步抽出 `workspace-runtime-store` 或 composable，按 catalog/workspace/plugin/grant 分片管理 revision、AbortController 和 refresh generation；组件只接收 typed state 与 command。

### D8：`ae78197` 的 ownership 规则与已有 Host→Operations 直接 import 冲突

新文档强调统一 runtime ownership、Host 不拥有 App 私有实现；但当前 `AgentHubWindow.vue` 仍直接 import `apps/operations/OperationsView.vue`。因此文档方向合理，代码尚未完全兼容。应将该路径列为架构门禁失败项，而不是继续依赖约定。

### D9：dev 新增能力范围已超过“当前 live execution”说明，需区分已接线与仅存在代码

当前分支同时包含 ACP、Browser/CDP adapter、MCP、Workspace Runner、multi-version toolchain 等代码。与既有 Phase 规划相比，只有部分能力进入 composition root；如果不标记 phase，维护者会把“文件存在”误认为“功能可用”。

建议在每个 Port/adapter/contribution 上增加 `phase: active | reserved` 元数据，composition root 启动时拒绝将 reserved capability 注册到 production catalog，并在 CURRENT_AGENT_ARCHITECTURE 中维护一张实际接线表。

## dev 分支建议调整优先级

### 必须先改（兼容性/正确性）

1. 修复 WebSocket subscribe 的 high-water/listener race；
2. 补前端 WebSocket 自动重连、cursor replay 和 snapshot refresh；
3. 明确 SSE→WebSocket 协议迁移策略与错误码；
4. 修正 AgentScheduler 按用户计数和异常 durable settle。

### 随后改（结构优化）

1. 收窄 StateCommit capability ports；
2. 抽取 Root/Subagent 共用执行器；
3. 将 Workspace Runtime 状态移出父组件；
4. 修正 Host→Operations import 并加入架构 checker；
5. 统一 active/reserved phase 标记与 composition root 校验。

总体判断：dev 分支新增 Agent 架构大部分沿着既有设计演进，StateCommit 拆分、Workspace Runtime 子组件拆分和专用 WebSocket 都是合理方向；但 WebSocket 迁移尚未达到端到端兼容，Runtime 的 durable recovery、前端状态生命周期和 ownership 门禁仍需补齐后，才能视为与原架构完整兼容。

## Agent 功能的成熟 Node 模块复用评估

### 总体结论

当前项目已经引入 `ajv`、`semver`、`eventsource-parser`、`ws`、`tar`、`archiver`、`ipaddr.js`、`undici` 和 `vue-virtual-scroller`，这些选择基本合理。后续应继续坚持“通用协议/格式/并发原语优先复用，Nexus 特有的 durable 状态机和安全策略保留自研”的原则。

下面的建议分为三类：

- **建议直接复用或扩大使用**：已有依赖能覆盖当前自写代码；
- **可选复用**：能减少样板，但不能替代领域语义；
- **不建议替换**：看似通用，实际与 Run/CAS/Lease/审计强绑定。

### M1：JSON Schema 校验应统一通过 `ajv`，避免重复手写 shape validator

项目已有 `ajv` 和 `modules/agent/json-schema-validator.ts`，但 Runtime HTTP command、Provider、Workspace、Plugin、Approval 等仍大量使用 `isRecord`、`hasOnlyKeys`、`typeof`、数组长度和枚举的手写组合。手写校验容易出现不同 endpoint 的 unknown key、深度、数值范围和错误路径不一致。

建议：

1. 为 `CreateRunCommand`、`AppendInputCommand`、`BudgetIncreaseCommand`、`ApprovalDecision`、`CheckpointResume`、Workspace command、Plugin manifest 建立 versioned JSON Schema；
2. HTTP 层统一调用 AJV adapter，开启 `allErrors`、`strict`、`unevaluatedProperties: false` 和显式 format；
3. Domain service 接收已解析 DTO，保留业务校验（scope、policy revision、目标权限、CAS）在 Service/StateCommit；
4. 不把 AJV 当作授权或状态迁移器。

### M2：SemVer、tar、archiver、Content-Disposition、虚拟列表的复用已经正确，应禁止再次自写

当前已有 `semver`、`tar`、`archiver`、`content-disposition` 和 `vue-virtual-scroller`，与架构文档的 reuse-first 决策一致。后续优化重点不是换库，而是把边界固定下来：

- `semver` 只负责版本解析/比较，App id、target、capability 和兼容性仍由 Host 校验；
- `tar` 只负责归档读取，路径穿越、symlink、digest、签名文件和原子安装仍由 PackageVerifier 负责；
- `archiver` 只负责打包，Artifact owner/grant、大小、临时文件和 fsync 仍由 Artifact Store 负责；
- `content-disposition` 只负责 header 编码，Range、授权和 nosniff 仍由 HTTP 层负责；
- `vue-virtual-scroller` 只负责渲染窗口，cursor 分页、stream buffer、anchor 恢复仍由 Runtime store 负责。

### M3：事件协议解析应继续使用 `eventsource-parser`/`ws`，但 WebSocket wire schema 应增加 schema validator

Provider SSE 已使用 `eventsource-parser`，传输 WebSocket 已使用 `ws`，不应再实现底层 frame/parser。当前缺口在于 Agent WebSocket message/event payload 的手写校验仍较薄。

建议使用现有 AJV 为 subscribe/unsubscribe、subscribed、event、error 定义 wire schema，并将 `schemaVersion` 纳入校验；`ws` 只负责连接、背压和 close code，订阅 cursor、replay 和权限继续由 Agent protocol service 管理。

### M4：重试退避可考虑 `p-retry`，但只能包装无副作用的 Provider/HTTP 请求

当前 `NativeAgentBackend`、Provider adapter、Runner adapter 各自实现 retryable error、Retry-After、timeout 和 AbortSignal 等逻辑。`p-retry`（或同类成熟库）可以减少指数退避、attempt 上限、AbortSignal 和随机抖动的样板。

适用范围：

- Provider 建连、幂等的 model request 建立阶段；
- Runner catalog/read-only query；
- MCP metadata refresh。

不适用范围：

- Tool mutation side effect；
- `StateCommit` transition；
- lease acquire/renew/release；
- 已写入 `started` 的 tool attempt。

即便采用 `p-retry`，每次 attempt 仍必须由领域代码记录 attemptId、预算、取消原因和最终 outcome，不能让库内部重试绕过 durable ledger。若不希望增加一个小依赖，也可以抽一个仅供 adapter 使用的 `RetryPolicy`，但不要复制到每个 Runtime 文件。

### M5：内存并发队列可用 `p-queue`/`bottleneck`，但不能替换当前 durable Scheduler

`AgentScheduler` 和 `SubagentScheduler` 当前自写 queue、fairness、active map、pump、quiesce。`p-queue` 或 `bottleneck` 能提供并发上限、优先级、暂停和事件，但它们是进程内队列，不能表达 Run version、DB claim、owner epoch、recovery 或跨进程互斥。

建议只在 `InProcessDispatcher` 层考虑使用 `p-queue`：

```text
Durable scanner/claim/CAS  ->  p-queue dispatcher  ->  execution handle
```

不要把 library queue 直接注入 RunService，也不要用它替代 SQLite work claim。若当前调度器仍是单进程且需要减少维护，可先抽出自己的 `DispatcherQueuePort`，未来再决定是否换库。

### M6：Canonical JSON/hash 可以评估 `fast-json-stable-stringify`，但必须先做兼容性基准

项目在 `operation-hash.ts`、Run idempotency 中自写 canonicalization。成熟的 `fast-json-stable-stringify` 可减少排序键、数组/数字/递归处理的重复代码，但 operationHash 是审批、重检和 mutation 防重放的安全契约，不能直接替换。

建议先建立 golden vectors：

- `-0`、浮点、Unicode、嵌套对象、数组顺序；
- undefined/非 JSON 值拒绝策略；
- schemaVersion 变化后的 hash 是否有意变化；
- 旧数据和旧 approval 的 hash 兼容。

只有确认新库输出与现有 v1 完全一致，或明确升级为 `operationHash v2` 并迁移历史数据，才可采用。否则保留自研 canonicalizer，并把它移动到一个共享纯 utility，避免两份实现继续漂移。

### M7：HTTP 客户端、超时和 AbortSignal 优先复用 `undici` 原生能力

项目已在 safe MCP fetch 使用 `undici`，但 Provider/Runner/部分 Agent HTTP 仍分别实现 timeout timer、response size 和错误映射。可以统一一个 Infrastructure `SafeHttpClient`，内部使用 `undici` 的 `fetch/Agent/AbortSignal.timeout`（Node 24），提供：

- connect/header/body timeout；
- 最大响应字节数和流式读取；
- DNS/TLS/outbound policy hook；
- Retry-After 和标准错误映射。

目标是减少 transport 样板；DNS rebinding、connection denylist、目标 scope 和 mutation verification 仍必须由 Nexus policy/adapter 控制，不能交给 HTTP 库。

### M8：网络目标分类继续使用 `ipaddr.js`，不建议引入“全自动 SSRF”库

当前使用 `ipaddr.js` + Node DNS/TLS + 自有 `OutboundPolicyAdapter`，符合架构要求。`ssrf-req-filter` 等黑盒库不能表达当前的 connection denylist、DNS rebinding、代理信任和审批 scope，也可能与 `undici` agent 行为冲突。

建议只复用底层 IP parser，补充针对 IPv4-mapped IPv6、DNS 多地址、重解析和 redirect 禁止的测试；不要把“是否允许目标”委托给第三方库。

### M9：限流/熔断库只能用于 Provider transport，不能代替 Agent budget/lease

可以评估 `Bottleneck` 或 `opossum`：

- `Bottleneck` 适合 provider per-user/per-provider request rate/concurrency；
- `opossum` 适合 Provider/Runner 连续失败时的短路。

但 Run hard limit、model call limiter、tool timeout、lease TTL、approval expiry 和 app quiesce 是 durable 领域约束，不能由内存 limiter/circuit breaker 作为事实来源。若采用，必须把它放在 adapter 外层，并在 StateCommit/metrics 中记录拒绝原因。

### M10：Cursor、分页和状态合并不应引入通用数据 fetching 库替代领域 store

Frontend 可以评估 TanStack Query/Vue Query 来处理 HTTP cache、请求取消、失效和重试，但当前 Agent 的 `version/eventCursor/inputRevision` 合并规则不是普通 cache invalidation。直接套用 query cache 可能让旧响应覆盖新 durable snapshot。

建议先实现轻量 `run-store`，明确版本单调合并和 cursor replay；若后续引入 Vue Query，只把它作为 transport cache，所有 Run snapshot 必须经过 domain merge function，不能由库默认替换。

### M11：成熟模块采用建议表

| 能力                  | 当前实现                    | 建议                                      | 边界                       |
| --------------------- | --------------------------- | ----------------------------------------- | -------------------------- |
| JSON Schema           | 已有 AJV + 部分手写校验     | 扩大 AJV DTO 覆盖                         | 不负责授权/CAS             |
| SemVer/归档/下载头    | 已复用成熟库                | 保持现状                                  | 安全、owner、原子提交自研  |
| WebSocket/SSE parser  | `ws`/`eventsource-parser`   | 增加 AJV wire schema                      | cursor/replay 自研         |
| Retry/backoff         | 多处手写                    | adapter 层评估 `p-retry`                  | 不重试 mutation/transition |
| 内存 dispatcher       | 自写 Map/queue              | 可评估 `p-queue`/`bottleneck`             | 不替代 durable scheduler   |
| Canonical JSON        | 自写                        | 先 golden vector，再评估 stable stringify | hash 契约不可破坏          |
| HTTP transport        | `undici` 部分使用           | 统一 SafeHttpClient                       | policy/verification 自研   |
| SSRF/IP               | `ipaddr.js` + policy        | 保持现状                                  | 不采用黑盒 SSRF 库         |
| Frontend virtual list | 已有 `vue-virtual-scroller` | 保持现状                                  | store/pagination 自研      |
| Data fetching         | 轻量 API facade             | 可选 Vue Query作为缓存层                  | version/cursor merge 自研  |

### M12：依赖引入的门禁

每个新增库应在实现交接中记录：版本、许可证、维护状态、bundle/runtime 成本、适配层位置、替换失败时的回退方案。对 Agent 特别增加三条门禁：

1. 库不能持有 Run/Tool/Approval 的 durable truth；
2. 库不能绕过 capability/policy/lease/verification；
3. 库的 retry、queue、cache 行为必须可观测，且不会改变既有公开事件和状态迁移。

本轮评估的优先落地项是：扩大 AJV DTO 校验、统一 undici SafeHttpClient、为 adapter 评估 p-retry、抽出可替换的 in-process dispatcher；暂不建议引入通用 workflow/queue/state-machine 库替代自研 Runtime。
