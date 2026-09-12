# Nexus Agent 架构

> 状态：Current architecture baseline
>
> 适用分支：`dev`
>
> 本文件是 Nexus Agent 的**唯一长期架构文档**。软件行为需求以 [`software-requirements/requirements/agent.md`](software-requirements/requirements/agent.md) 为准；强制工程约束以 [`software-requirements/engineering-constraints.md`](software-requirements/engineering-constraints.md) 为准。历史实现过程、重构 review 和阶段施工记录不再作为规范源。

## 1. 产品定位

Nexus Agent 是 Nexus Terminal 内的全局智能执行层，不是一个独立页面，也不是 Workspace Terminal 的包装层。

核心产品模型：

```text
User
  -> global Agent Launcher / floating Hub
  -> App
  -> Thread
  -> Run
  -> AgentRuntime / Subagent Runtime
  -> Tool / Workspace / Artifact / Integration
```

几个必须保持稳定的边界：

- **App** 是能力、数据与插件贡献的隔离边界。
- **Thread** 是对话与 Ledger 的长期用户上下文边界。
- **Run** 是一次有预算、模型冻结、计划、取消、验证和结果状态的执行边界。
- **AgentRuntime** 是一次具体执行实例，不等同于 Run，也不等同于 Workspace。
- **Workspace** 是由 Agent Runner 管理的稳定项目/文件/工具链环境。
- **Artifact** 是 Agent 输入、输出、证据、下载和跨能力交换的持久文件对象。
- **Plan** 是用户可见的 durable task projection，不是模型隐藏思维，也不是底层 Step 日志。

Nexus Agent 不保存或展示模型隐藏思维链。用户可见的是目标状态、Plan、工具动作、审批、Artifact、验证结果和结构化运行状态。

## 2. 当前源码 Owner

Backend 主要目录：

```text
packages/backend/src/modules/agent/
├── host/                 App registry, lifecycle, grants, settings, plugin lifecycle
├── ai/                   Provider, context, conversation, artifact, memory, integrations
├── capabilities/         Tool catalog, policy, approval, lease, governed execution
├── workspace-runtime/    Workspace Runtime control plane
├── runtime/
│   ├── runs/             Run lifecycle and public Run model
│   ├── execution/        Root Agent execution
│   ├── scheduling/       Root in-process dispatcher
│   ├── planning/         durable Plan projection and plan_update tool
│   ├── recovery/         checkpoint/resume/recovery
│   └── collaboration/    Subagent, mailbox, shared facts, durable child work
└── apps/operations/      Nexus built-in Operations capability contributions

packages/backend/src/infrastructure/agent/
  concrete persistence / runner / plugin / capability adapters

packages/backend/src/interfaces/http/agent/
  HTTP protocol boundary

packages/backend/src/interfaces/websocket/agent-protocol.session.ts
  /ws/agent protocol boundary

packages/backend/src/bootstrap/agent/
  composition and contribution wiring
```

Frontend 主要目录：

```text
packages/frontend/src/features/agent/
├── host/                 global launcher, floating Hub, generic App surface
├── ai/                   conversation UI
├── runtime/              TaskRail, Run details, Workspace runtime UI
├── files/                Artifact Library / picker
├── settings/             Agent settings sections
├── api/                  HTTP and Agent WebSocket clients
└── i18n/                 Agent locale fragments
```

Host Runner：

```text
packages/agent-runner/
```

正式 npm/package owner 是 `@nexus-terminal/agent-runner`。不要重新引入 `agent-runtime` 作为 Host Runner package 名；`AgentRuntime` 仍是 Backend 的领域概念。

## 3. 全局 Agent Surface

### 3.1 不是独立路由

认证后的根应用挂载唯一 `AgentSurfaceHost`。它与 `RouterView` 生命周期解耦，并通过 body root overlay 呈现 Launcher / Hub。

因此：

- 不存在独立 `/agent` 产品页。
- Dashboard、Workspace、Connections、Settings 等 SPA 路由切换不会销毁 Agent Hub。
- 切路由不会取消 Run。
- 首次认证只显示 Launcher，不主动抢焦点。
- Agent feature 从 disabled 切到 enabled 时，打开同一个全局 Hub。
- disabled 时隐藏 Launcher/Hub，但 Settings、历史、安全清理与审计仍保留。

### 3.2 Windows 风格非模态浮窗

Hub 是非模态 floating window，支持：

- move；
- 右下 resize；
- minimize；
- maximize / restore；
- close；
- 用户级 geometry 持久化；
- viewport 变化后的安全 clamp。

响应式布局按 **Agent 窗口自身容器宽度** 决定，不按浏览器 viewport 猜测：

- 宽窗口：Threads / Conversation / TaskRail 三栏；
- 中宽：隐藏 TaskRail，Run Details 按需覆盖；
- 窄窗口：Threads 变 drawer，Run Configuration Bar 换行；
- resize 后 Model 控件必须保持最小可操作宽度，不能被 Environment/Targets 挤压为 0。

窗口 presentation state 只由 root Host 持有。页面组件不得复制一份 Hub/Thread/Run store。

## 4. App、Thread、Run 与 Ledger

### 4.1 App

App 由 manifest / registry 注册。`userId + appId` 是服务端推导的授权作用域；浏览器不能覆盖 owner。

插件可以贡献：

- AgentDefinition；
- Tool / Capability；
- Skill；
- Frontend target；
- Backend / Runner target。

没有 Frontend target、但声明 AgentDefinition 的 App，直接复用 Nexus host-owned `AgentAppSurface`。声明 Frontend target 时，该 iframe 拥有 Hub 内整个 App content surface，而不是附加小面板；AgentDefinition 仍可同时存在并由 Custom Frontend 通过 Plugin Frontend SDK 驱动。

Custom Frontend 只能经 Nexus 同源提供的 `/sdk/frontend-v1.mjs` 建立 MessagePort SDK。第一阶段 SDK 只暴露 AppStorage 与 App-scoped AgentDefinition/Provider/Thread/Run/Subagent/Approval/Run-event 能力；iframe 不获得 Nexus cookie、CSRF token、HTTP client、数据库或内部 service object。

### 4.2 Thread

Thread 是长期 Conversation 边界。一个 Thread 同时最多一个非终态 Root Run。

Ledger `ai_thread_entries` 是对话事实源，至少包含：

- `user_input`；
- `assistant_message`；
- `tool_result`；
- `system_notice`。

Thread 列表、搜索和排序只投影服务端 Thread / Run 事实；前端只保存 draft、scroll、当前 App/Thread 等 view state。

### 4.3 Run

Run 当前状态：

```text
created
running
awaiting_approval
awaiting_budget
cancelling
completed
completed_unverified
failed
cancelled
interrupted
```

Run 创建时冻结 `RunDefinitionSnapshot`：

```text
agentDefinitionId
model { providerId, modelId, configurationVersion }
connectionIds
policyRevision
settingsRevision
contextBoundary (when present)
```

运行中不得用 mutable frontend state 假装 Model / Targets 已切换。

Run 还持有：

- budget；
- usage；
- typed Plan；
- goal status；
- verification status；
- input revision / consumed input watermark；
- event cursor；
- optimistic version；
- reconciliation state。

终态 Run 删除必须拒绝仍有关联的非 deleted 或 retained Workspace，不能依赖 FK cascade 丢失 Runner 控制记录。

## 5. Goal、Plan、Step 与 Verification

### 5.1 当前 Goal 模型

当前代码同时保存两类分离的 durable Goal 事实。`GoalStatus` 表达执行结果状态：

```text
unknown
in_progress
satisfied
not_satisfied
```

用户可编辑 Goal 则由 Run 上独立的 `goal.text / goal.revision / goal.updatedAt` 表达，并通过 versioned `run.goal.set` command 修改。两者不能混用：Goal 文本描述“要达到什么”，`GoalStatus` 描述“是否已经达到”。

Root model step 开始时 `GoalStatus` 进入 `in_progress`；成功验证后可进入 `satisfied`；失败终止可进入 `not_satisfied`。Goal 更新会重置 verification：Root model 正在 streaming 时 supersede 当前 model step 并以新 Goal 重调度；Tool/Approval 已进入安全边界后则只持久化 Goal，不回滚副作用或 supersede approval，下一次 model context 使用新的 durable Goal。

### 5.2 Plan

`RunPlan` 是 durable projection：

```text
schemaVersion
revision
items[]
  id
  title
  detail
  status
  dependsOn[]
  evidenceRefs[]
```

PlanItem 状态：

```text
pending
in_progress
blocked
completed
cancelled
```

`plan_update` Tool 通过 revision CAS 修改 Plan，必须验证：

- item id 唯一；
- dependency 存在；
- 无自依赖；
- 无环；
- item/evidence 数量有界。

TaskRail 直接展示 typed Plan、完成比例、current focus、blocked 数、approval/budget/reconciliation 注意状态。

### 5.3 Plan != Step

`PlanItem` 是用户可理解的任务计划；`agent_steps` 是执行机内部的 model/tool/verification/delegation 边界。

不得把底层 Step dump 当作 Plan，也不得把模型隐藏推理伪装成 Plan。

### 5.4 Goal 文本与 slash command

用户可编辑 Goal 文本与 Conversation slash command 已进入正式产品合同，并继续使用 Conversation Composer 作为控制入口，而不是新增独立设置页：

```text
/goal <text>      set/update current Run goal
/goal             show current goal
/plan             show current plan
/interrupt <text> explicitly interrupt current model generation
/queue            inspect pending user inputs
/stop             cancel current Run
/help             show command reference
```

命令 dispatch 在 parser 层与普通对话严格分离；未知命令直接返回用户可理解错误，绝不能退化为普通 prompt。`//...` 明确逃逸为以 `/` 开头的普通用户输入，Composer 提供 slash suggestion 与 `/help`。已有 Run 时 `/goal <text>` 走 versioned/idempotent `run.goal.set`；空 Thread 上 `/goal <text>` 通过 `run.create` 的 `initialGoal` 直接建立 revision 1 的 durable Goal 并启动 Run。`/plan` 从最新 Run projection 读取 typed durable Plan，`/queue` 从 `consumedInputSequence + Ledger sequence` 派生 pending inputs，`/stop` 复用正式 cancel contract。`/interrupt <text>` 使用独立 `run.interrupt` command：只有事务内确认 Root model 正在 streaming 才会追加输入并 supersede model step，否则返回状态冲突；它不会借“interrupt”名义取消已经开始的 mutation 或 supersede approval。

命令结果是这些 durable Backend 事实的 UI projection，不是新的 frontend authority，也不会伪装成 Ledger 消息或模型隐藏推理。

## 6. 对话输入、打断与待处理输入

### 6.1 当前 appendInput 语义

非终态 Run 可以通过正式 `run.input` command 追加用户输入。StateCommit 事务原子完成：

1. 校验 scope、Run version 与状态；
2. 写入 `user_input` Ledger；
3. 绑定 Artifact；
4. 增加 `input_revision`；
5. 写 `input.appended` durable event；
6. supersede 过期 approval（如果存在）；
7. 更新 Host summary。

如果 append 时 Root model attempt 正处于 streaming，commit 返回 `shouldInterruptModel=true`，Scheduler 对当前 execution 发出 `NEW_INPUT` AbortSignal。

Backend 在安全边界将当前 model step 标记为 superseded，然后以新 input revision 重新调度。它不是整 Run cancel。

### 6.2 Tool / approval 期间的新输入

- `awaiting_approval` 时的新输入会 supersede pending approval，并取消对应 awaiting tool path，再回到 `running`。
- 已开始 mutation 的远端副作用不能通过“打断”假装回滚；unknown outcome 仍进入 reconciliation / quarantine。
- tool execution 的取消与模型 streaming interruption 是不同语义，必须保持安全边界。

### 6.3 Pending-input queue

Conversation `/queue` 已复用现有 `inputRevision + consumedInputSequence + Ledger sequence` durable input stream：Backend 统计当前 Run 中 `sequence > consumedInputSequence` 的全部 `user_input`，并返回有上限的明细页、authoritative `total` 与 `hasMore`；Frontend 不维护第二套 local-only queue，也不会把第一页长度冒充总数。

当前边界：

- Agent 运行时仍可通过正式 append-input 追加输入；
- 普通 append-input 维持现有 `NEW_INPUT` 语义：Root model 正在 streaming 时会 supersede 当前 model step；
- `/interrupt <text>` 使用更严格的 `run.interrupt`：仅 streaming model 可接受，否则 409；
- `/queue` 只做 durable inspection；
- remove/reorder 尚未交付；如果未来增加，必须是 versioned Backend mutation，不能只改前端数组。

## 7. Root Scheduler 与崩溃语义

Root `AgentScheduler` 是单 Backend 进程内 dispatcher，不是 durable queue owner。

持久事实先由 StateCommit 写入：

```text
Run / Input / Runtime / Event / Ledger
        -> COMMIT
        -> in-process enqueue
```

Root dispatcher：

- 按 App 队列轮转；
- 执行并发受用户级 Runtime limits 约束；
- `signalInput()` 用 `NEW_INPUT` 打断 active Root model execution；
- `cancel()` 用 `CANCELLED` 控制信号；
- shutdown/quiesce 用 `AGENT_QUIESCE`。

Backend 重启时不偷偷恢复旧 Root execution stack。非终态旧 Run 按正式 recovery contract 收敛为 interrupted；需要继续时由 Checkpoint Resume 创建新 Run / Runtime。

这与 Subagent durable work queue 不同。

## 8. StateCommit、事件与一致性

### 8.1 StateCommit 是 durable mutation authority

Run、Model、Tool、Approval、Subagent 的关键状态变化必须由 StateCommit transaction 完成。

一次 commit 根据具体 transition 原子更新：

- domain row；
- optimistic version；
- durable Agent event；
- Ledger entry；
- Host summary event；
- command/idempotency projection；
- approval / runtime / work projections。

不能让 Service 先写一半数据库，再靠 EventHub 补齐事实。

### 8.2 幂等

HTTP mutation 使用：

```text
(userId, appId, commandName, Idempotency-Key)
+ request hash
```

相同 key 不同 payload 必须拒绝；unknown outcome 不能自动重放有副作用的 mutation。

### 8.3 `/ws/agent`

Agent Browser event boundary 是 `/ws/agent`。

Durable event：

- 有 sequence；
- snapshot + cursor catch-up；
- reconnect 后从 repository replay。

Transient streaming delta：

- 不获得 durable sequence；
- 断线可丢；
- 不能伪装成 final assistant message。

Frontend event stream 使用 reconnect/backoff/cursor replay；慢消费者有明确 bufferedAmount/size 边界。

## 9. Context、Provider 与 Budget

Provider 使用 OpenAI-compatible 配置模型，credential 加密保存且 API 不回填明文。Backend 支持通过受现有 outbound policy/credential policy 保护的 Provider discovery 请求读取上游 `GET <baseUrl>/models`；discovery 只把 model id（以及可选 owner/created metadata）当作候选事实，不推测 context window、max output、tool capability 或 pricing，用户必须确认能力后才写入 Provider 配置。

每个 Run 冻结 Provider configuration version。Provider 被修改后，已存在 Run 继续引用创建时 snapshot；下一次 Run 才使用新设置。

上下文构建必须有界：

- context tokens；
- output tokens；
- Run total tokens；
- Run steps；
- active execution seconds；
- tool output/raw bytes；
- Recall items/bytes；
- Subagent message count/bytes；
- optional cost micros。

预算不足时进入 `awaiting_budget`，用户可以通过 versioned increase-budget mutation 提升到 Hard Limit 以内。

Context digest / summary 不能吞掉尚未消费的用户输入、授权状态、approval 或 reconciliation 事实。

## 10. Tool 与安全执行链

Mutation Tool 的正式链路：

```text
inspect
  -> capability / grant
  -> local policy
  -> approval when required
  -> lease / fence
  -> execute
  -> verify / reconcile
  -> durable settle
```

规则：

- hard deny 不可被 approval 覆盖；
- approval 绑定 canonical operation hash；
- stale input / target / policy / approval 不能继续执行；
- remote unknown outcome 不自动 retry mutation；
- unknown side effect 进入 reconciliation / quarantine；
- cancellation 不能声称回滚已经发生的远端副作用。

Read tool 也必须经过 scope/capability/network boundary，只是风险链更轻。

## 11. Artifact、Memory 与文件交换

### 11.1 Artifact

Artifact 是 Agent 文件能力的统一持久边界：

- upload；
- Agent output；
- tool evidence；
- Browser download；
- Workspace exchange；
- plugin input/output。

写入遵循 reserve -> temp -> flush/hash/size -> atomic rename -> metadata commit。

跨 App 可见不等于跨 App 授权。读取仍要 grant/link。

### 11.2 Files Library

Hub 的 Files Library 是用户级 Artifact 视图，支持分页、预览、下载、retain、delete、cleanup preview/confirm 和对话附件选择。

### 11.3 Memory

Memory candidate 与 published memory 分离。AI 不能绕过用户审核直接发布长期 Memory。

## 12. Workspace Runtime 与 Agent Runner

### 12.1 Workspace 是什么

Workspace 是稳定的项目/文件边界，不是一次 Run 的临时目录，也不是“某种语言 Environment”。

一个 Workspace Profile 冻结：

- Recipe；
- Tool family/version；
- Runner Plugin ids；
- ACP Profiles；
- Browser Target；
- retention。

Node/Python/Go 可在同一个 Workspace 中共存。

### 12.2 当前 Agent 主界面的 Environment

Agent Conversation 的 Run Configuration Bar 当前显示：

```text
Model · Environment · Targets
```

其中：

- Model 是真实 Next Run selector；Run 创建后从 `Run.definition.model` 冻结展示。
- Targets 是真实 Next Run SSH `connectionIds` selector；Run 创建后从 `Run.definition.connectionIds` 冻结展示。
- Environment **当前只是 production-backed Workspace Runtime availability/default summary，不是 selector**。

真正 Workspace Profile 在 Workspace 创建时由 Backend 校验/解析并冻结，Run Details 展示该 Workspace 的 frozen profile。

在 Backend RunDefinition 正式扩展前，禁止前端制造“Next Run Environment 已选择”的假状态。

### 12.3 Runner

Runner package：`packages/agent-runner`。Host 与独立 Docker 镜像使用同一套 runtime contract。

Runner 提供：

- availability/catalog；
- Workspace provision/start/stop/delete；
- native Workspace job；
- Tool Store materialization；
- multi-version Node/Python/Go runtime switching；
- ACP stream；
- Workspace local direct PTY terminal；
- Browser tunnel；
- storage report；
- cleanup planning/execution；
- journal/reconcile。

Runner 永远不获得 host Docker socket、不启动 dockerd、不使用 nested Docker。独立 Runner 容器也不需要 `privileged`、`SYS_ADMIN` 或 unconfined seccomp/AppArmor；镜像只使用 `tini` 作为 PID 1 负责信号转发与孤儿进程回收，不把它当成 Workspace 隔离层。

Backend ↔ Runner 控制面统一使用至少 32 字符的 `NEXUS_AGENT_RUNNER_TOKEN` Bearer token，并要求 `X-Nexus-Agent-Protocol: 2026-09-13`；HTTP 与 WebSocket upgrade 在路由分发前使用同一认证。Runner token 代表该 Nexus 实例对 Runner 的完整控制权，不是 per-user credential，不能暴露给浏览器、日志或第三方 Plugin。

Runner wire 只传执行所需事实：`provision` 发送完整冻结 Workspace profile；`start/stop/restart/delete` 只发送 `workspaceId + generation`；Workspace job 只发送 generation 与执行参数。`userId/appId/runId/agentRuntimeId`、Backend optimistic `expectedVersion`、Agent operation hash 仍由 Backend 自己授权、持久化和 reconcile，不重复镜像到 Runner。

### 12.4 单用户 native Workspace Runtime

Nexus 当前是单用户应用。Workspace/Generation/Toolchain 的职责是组织项目数据和运行环境，而不是在同一个 Nexus 用户内部构造 OS 安全沙箱：

- Workspace 项目文件持久且彼此独立；
- Generation 冻结一次 Workspace Profile/runtime 选择；
- Node/Python/Go Tool Pack 全局不可变共享，通过当前 generation 的 PATH 选择；
- `/workspace/deps`、`/workspace/build` 等逻辑路径映射到按 toolchain fingerprint 分区的 Runner data root；
- job、ACP、Terminal 和 Runner Plugin 都是 Runner 原生子进程；job/ACP/Runner Plugin 由独立 process group 管理并随 owner 生命周期整组回收，Terminal 使用真实 PTY foreground process group 处理交互 signal；
- Host Runner 子进程共享宿主安全上下文；Docker Runner 子进程共享同一个 Runner 容器安全上下文；
- Workspace Profile 不提供伪资源配额或伪网络白名单字段；Agent Hard Limits、Browser/Provider outbound policy 等安全/预算约束仍由各自 Backend owner 执行，不冒充 per-Workspace cgroup/network namespace；
- 用户安装并启用 Runner Plugin，等价于允许该代码以 Runner OS 权限执行。Runner 只为每个 Plugin target 提供独立逻辑工作目录作为 SDK/Artifact exchange 的文件组织方式；不再提供跨 Plugin ACL，因为同权限 native Plugin 可以绕过这类逻辑 ACL，它不能构成真实安全边界。

因此安全边界必须表述准确：Backend capability/policy/approval/lease 仍决定 Nexus 是否允许某个操作；Runner 负责把已允许的操作放到正确 Workspace/runtime profile 中执行，但不再声称它能隔离同一用户自己的代码。

“单用户”只意味着 Nexus 不为多个互不信任的人建立租户隔离，不意味着所有输入和扩展代码都可信。登录/session、CSRF、SSRF/private-network policy、Plugin 包签名与 Backend/Frontend Plugin 隔离、App capability/grant、Agent mutation approval/lease/reconcile/quarantine、Runner Bearer token 仍保护当前用户免受第三方 Plugin、模型误操作、恶意网页/协议输入、并发写冲突和未知远端结果影响，因此不因单用户模型删除。

### 12.5 Generation 与版本切换

Tool version switch 只重建目标 Workspace generation：

- 项目文件保持；
- 旧 generation process/session 被终止；
- 全局 `/usr/bin` 不修改；
- 其他 Workspace 不受影响。

### 12.6 Cleanup

Runtime cleanup 是 destructive two-phase flow：

```text
preview -> frozen workspaceIds -> confirm -> Runner re-check -> deleted[] -> Backend projection sync
```

Confirm 不能重新扫描并扩大 preview 范围。

Runner 执行时仍需跳过：

- retained；
- active；
- 有 active job/session；
- 其他不再满足安全条件的 Workspace。

Backend 只根据 Runner 明确返回的 `deleted[]` 同步 Workspace projection。

### 12.7 Journal

Runner journal 是执行面 recovery 事实之一。

损坏 journal：

- 保存 corrupt evidence；
- 原损坏文件保持；
- Runner fail closed；
- 不能自动变成空状态继续启动。

## 13. ACP、Browser 与 Workspace Terminal

这些能力已经不是 reserved-only 类型，而是当前 live Runner contract 的一部分。

### 13.1 ACP

ACP profile 冻结在 Workspace profile 中。ACP process 在 Runner Workspace 环境中启动，由 Backend 受控 bridge 消费 stream。

外层 `acp_execute` 仍经过 Nexus capability / policy / approval / lease / StateCommit；ACP 内部 permission 请求不能自行扩大 Nexus 权限，拒绝或未知权限必须 fail closed。

### 13.2 Browser/CDP

Browser target 由 Workspace profile 冻结。Browser execution 通过受控 Browser gateway/tunnel，不把任意宿主 CDP endpoint 交给插件或页面。

网页内容视为不可信输入；下载内容先落 Artifact，再进入其他 Agent/Workspace 能力。

### 13.3 Workspace local Terminal

Workspace local Terminal 通过 Runner 管理的 direct PTY lifecycle：

- open；
- resize；
- write；
- detach；
- reattach；
- bounded replay。

它不是 Nexus Remote SSH Workspace 的 live session 复用。Runner 用系统 `script(1)` 分配 PTY，Backend 保持 session attach/detach/replay，浏览器仍只连接 Nexus 的受认证 terminal WebSocket。

## 14. MCP 与网络集成

MCP 已进入 composition/tool catalog。外部 MCP server/tool schema 必须通过本地 schema、scope、network 和风险策略。

任何外部协议声明的“安全等级”都不能覆盖 Nexus 本地 policy。

Outbound policy：

- public HTTPS 默认允许；
- private targets 需要精确 allow；
- metadata/link-local/危险目标硬拒绝；
- DNS/IP classification 在连接前后都要防 rebinding/redirect 绕过。

## 15. Subagent / Multi-Agent

Subagent 与 Root Run 共享父 Run 预算与全局 Runtime concurrency，不存在绕过全局限制的独立 child pool。

Subagent 持久模型：

```text
Delegation
AgentRuntime
Mailbox cursor
Message
Shared Fact
agent_scheduler_work
```

与 Root scheduler 不同，Subagent work 使用 SQLite durable queue，状态包括：

```text
queued
claimed
waiting
completed
cancelled
```

claim 使用 durable CAS / owner epoch。进程重启后可以 reset/scan child work；不能用普通内存 queue 替代 claim/settle authority。

通信必须受：

- max depth；
- dependency cycle；
- message count/bytes；
- deadline/TTL；
- backpressure；
- cancellation propagation；
- parent Run status。

约束。

## 16. Plugin Platform

### 16.1 安装包

Installable App/Skill package 必须验证：

- manifest；
- file allowlist；
- SHA-256；
- Ed25519 signature；
- path traversal；
- symlink/device；
- archive bomb / size limits。

未验证 stage 位于：

```text
agent/plugins/.staging
```

验证身份后迁入 App scope，正式 immutable version：

```text
agent/plugins/<appId>/versions/<version>
```

### 16.2 动态代码边界

上传 Backend code 不在 Nexus Backend 进程内 eval/import。

动态 Frontend 资源通过 Backend-owned isolated static origin + sandboxed iframe 提供；有 Frontend target 时它拥有完整 Custom App Surface。隔离 origin 同源提供 `/sdk/frontend-v1.mjs`，Plugin 只经 bounded MessagePort 调用显式 SDK；Frontend container 不挂载插件 storage，也不向 iframe 暴露 Nexus session/CSRF/HTTP client。

Runner plugin 通过独立 Runner protocol/lifecycle 执行。

### 16.3 第一方插件仓库

第一方可分发插件源和签名发布流程由独立仓库 `0honus0/nexus-agent-plugins` 持有。

当前首个 `nexus.developer` 是刻意保持最小的 Host-surface App：只贡献 `AgentDefinition + Skill`，不为了形式补空的 Frontend/Backend/Runner target。需要完全不同产品体验的 App（例如多角色/角色卡应用）再声明 Frontend target 并使用 Custom App Surface + Plugin Frontend SDK。

Nexus Terminal 主仓只持有：

- protocol；
- installer / verifier；
- permissions；
- host UI；
- Backend / Runner runtime；
- self-contained E2E fixture。

普通主仓 E2E 不依赖外部插件仓库在线可用。

## 17. Checkpoint 与 Resume

Checkpoint 只在安全边界创建，不能保存：

- live process handle；
- secret；
- active lease；
- 正在执行的 mutation continuation。

可以保存：

- Plan；
- input watermark；
- evidence；
- frozen definition/context facts；
- safe recovery metadata。

Resume 创建**新 Run、新 Runtime、新执行资源**，重新 inspect/authorize。旧 approval 不自动复用，旧 mutation 不自动执行。

## 18. 日志与可观测性

Agent 使用 Nexus 结构化 logger。

Frontend 记录：

- Host attach/detach；
- summary/event socket reconnect；
- window open/minimize/maximize/close；
- App/view switch；
- move/resize completion；
- layout restore/persist。

Backend 记录：

- Run create/input/cancel/delete；
- Workspace commands；
- reconcile；
- cleanup；
- critical state transition failures。

Runner 记录：

- startup/reconcile；
- workspace command/job；
- runtime cleanup；
- journal compaction/corruption evidence；
- ACP/terminal/browser lifecycle summary。

允许字段：

- safe IDs；
- state/status；
- generation；
- bounds/counts；
- duration；
- error code。

禁止字段：

- prompt/message 正文；
- credential/token/cookie；
- Tool/Runner command payload；
- argv/cwd；
- 可能包含用户正文的任意对象 dump。

## 19. 数据与传输 Owner 隔离

以下 transport 彼此独立：

- Nexus Workspace `NXW1`；
- upload socket；
- Agent `/ws/agent`；
- Runner Plugin `NXR3`；
- Backend <-> Host Runner streaming；
- Browser tunnel；
- Workspace local terminal stream。

它们可以共享 bounded/backpressure/fail-closed 原则，但不能共享 protocol magic、version、requestId 语义或 live handle。

Agent 复用 Platform capability，不复用 Workspace runtime transport owner。

## 20. 运行时与数据库基线

当前生产基线：

- SQLite；
- 单 Backend Agent scheduler process；
- StateCommit transaction 作为 durable mutation authority；
- Root dispatcher process-local；
- Subagent work durable SQLite claim queue。

当前 Agent schema 尚未进入 `main` 时，`dev` **不维护 dev→dev Agent migration 兼容链**：`sqlite-schema.registry.ts` 直接描述当前最终 Agent/AI 表结构，`sqlite-migrations.ts` 只保留 `main` 已存在的历史 migration（当前最高 #20）。旧 dev 数据库若与当前 Agent schema 不兼容，应重建开发数据库，而不是继续堆叠临时 add/rename/drop migration。

如果未来进入多 Backend 实例，不允许只把 Root queue 换成 Redis 就宣称支持分布式。必须同时设计：

- leader / claim authority；
- execution owner epoch；
- idempotency；
- lease/fence；
- recovery；
- host event ordering。

## 21. 前端 Run Configuration

当前 Conversation header 的执行配置语义：

```text
Next Run / Active Run
  Model
  Environment
  Targets
```

Next Run：

- Model 可选；
- Targets 可选；
- Environment 是只读 runtime summary。

Active Run：

- Model 从 frozen RunDefinition 显示；
- Targets 从 frozen `connectionIds` 显示；
- Environment 不能伪装成 RunDefinition snapshot；如果 Workspace 已创建，Run Details 展示 frozen Workspace profile。

真正的 Next Run Environment selector 必须先扩展 Backend Run/Workspace contract，让选择在服务端解析、校验、冻结并由 Workspace create 消费。

## 22. 测试与发布门槛

Agent 用户可达行为必须由 production-style E2E 验收，不以 unit test 或 console log 代替。

当前 canonical CI 覆盖包括：

- Docker deployment smoke；
- Host Runner native runtime prerequisites；
- Runner build；
- native Workspace job；
- ACP stream；
- Workspace direct PTY terminal；
- Browser tunnel；
- stable Workspace generation；
- Node/Python/Go multi-version runtime profile switching；
- runtime cleanup scope；
- Run deletion Workspace guard；
- global floating Agent across routes；
- Agent functional Playwright scenarios；
- functional screenshot verifier。

E2E 不得为了定位新增 product-only `data-testid` 等测试 seam；优先使用可访问角色、名称和真实用户行为。

## 23. 当前已知边界与下一步

### 已交付

- 全局 floating Agent Host；
- App/Thread/Run/Ledger；
- Provider/model snapshot；
- typed durable Plan；
- durable Goal text/revision + GoalStatus 分离；
- Conversation slash-command dispatch：`/goal`、`/plan`、`/interrupt`、`/queue`、`/stop`、`/help` 与 `//` literal escape；
- durable pending-input queue inspection；
- appendInput + streaming model interruption；
- approval supersede on newer input；
- budget/cancel/checkpoint/resume；
- Artifact Library；
- governed Tool execution；
- Workspace Runtime + Host Runner；
- ACP / Browser / Workspace local Terminal live execution；
- Subagent durable mailbox/work queue；
- signed installable Agent plugins；
- structured diagnostics。

### 已决定、待实现

1. Pending-input queue 的 remove/reorder mutation（如产品确有需要）；任何实现都必须 versioned、durable。
2. 真正的 Next Run Environment selector：需要扩 RunDefinition / Workspace profile contract，不允许 frontend-only selector。
3. 更完整的 `Agent UI -> Workspace create -> Runner execute -> visible UI result` 单路径产品 E2E。

## 24. 修改规则

后续 Agent 改动必须遵守：

1. 业务语义改变时，同时更新本文件和 Agent SRS。
2. 不再新建 `doc/architecture/agent/*`、Agent review/implementation/current snapshot 平行文档。
3. 只有当前事实进入“已交付”；roadmap 必须显式标记待实现。
4. 不恢复已删除的 legacy Agent Environment 数据模型；Runtime 环境以 Workspace Runtime contract 为唯一方向。
5. 不为 UI 便利复制 Run/Thread/Workspace/queue 的 authoritative state。
6. destructive operation 必须 preview/freeze/confirm/recheck/reconcile。
7. mutation unknown outcome 必须 fail closed。
8. 不记录隐藏思维链或敏感业务正文到诊断日志。
