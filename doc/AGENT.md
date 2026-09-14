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
├── capabilities/         Tool catalog, policy, approval, lease, governed execution contracts
├── tools/host/            Host-owned governed Tool implementations/contributions
├── workspace-runtime/    Workspace Runtime control plane
├── runtime/
│   ├── runs/             Run lifecycle and public Run model
│   ├── execution/        Root Agent execution
│   ├── scheduling/       Root in-process dispatcher
│   ├── planning/         durable Plan projection and plan_update tool
│   ├── recovery/         checkpoint/resume/recovery
│   └── collaboration/    Subagent, mailbox, shared facts, durable child work

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

- 宽窗口：Threads / Conversation 两栏为默认，TaskRail 按需展开为第三栏；
- 中宽：TaskRail 与 Run Details 按需覆盖，保留任务/审批入口；
- 窄窗口：Threads 变 drawer，输入区内 Model / reasoning / Environment / Targets 控件换行；
- resize 后 Model 控件必须保持最小可操作宽度，不能被 Environment/Targets 挤压为 0。

窗口 presentation state 只由 root Host 持有。页面组件不得复制一份 Hub/Thread/Run store。

### 3.3 当前 UI / 交互审计基线

当前 Host-owned Agent UI 按“全局窗口 → App → Thread → Conversation/Run”四层组织，审核时应以以下行为为准：

- **Launcher**：认证后被动出现，不自动打开 Hub、不抢焦点；feature disabled 时隐藏，但 Agent Settings/历史/审计数据不因此删除。
- **Window chrome**：标题区展示全局 activity count、App selector、Conversation/Files view、pending approval 提示以及 minimize/maximize/close。多 App 时，宽窗口额外显示带 health/running/approval/budget 状态的 App activity strip；selector 是始终可达的主切换入口，App 数量超过 5 时才显示搜索。
- **App 切换**：`AgentAppSwitcher -> AgentHubWindow.switchApp -> agentSurfaceSession.activateApp -> agentWindowManager.switchApp`。离开 App 前暂停 detail presentation；每个 App 的当前 Thread、draft、Next Run model、Next Run Environment 等 view state 独立保留，不把这些临时状态直接当作 Run truth。
- **Agent surface**：默认 `216px Threads / Conversation`，TaskRail 按需展开为 300px 第三栏；Conversation header 负责 Thread/Run status、历史与任务入口，Composer 内配置区负责 Model / reasoning 能力说明 / Environment / Targets；正文渲染安全 Markdown 与可展开的工具/系统摘要，不改写 Ledger。TaskRail 聚合当前/后台 Run、待处理 Approval/Budget，历史审批、checkpoint 与 Workspace 在详情中渐进展开。
- **响应式**：`AgentHubWindow` 自身是 named container。`<=1180px` 收起 model meta，`<=1040px` 将 TaskRail 改为覆盖面板，`<=880px` 隐藏 Run history select，`<=760px` Threads 变 overlay drawer 且 Composer Configuration 可换行；Hub chrome 在 `<=900px` 收起非关键 badge/App search，在 `<=700px` 进一步隐藏 title/nav label/activity strip。不得用浏览器 viewport breakpoint 替代上述窗口容器规则。
- **Next Run / Active Run**：没有活动 Run 时 Model / Environment / Targets 都是下一次执行选择。Environment 选择先以 App-local presentation state 保存；创建 Run 时 Backend 根据当前 Runner Catalog 与 Agent settings 校验并解析为完整 `RunDefinition.environment` snapshot。Run 创建后 Model / Environment / Targets 都从 RunDefinition 冻结展示并显示 lock；选择 `No Workspace` 时该 Run 明确冻结为无 Workspace 环境。
- **审批/预算**：高风险操作不在聊天气泡里“假通过”。顶部 badge、TaskRail 和 Run detail 都投影同一后端 Approval/Run 状态；窄窗口即使 TaskRail 被隐藏，也必须仍能从 Run header/detail 进入处理。
- **Files**：Artifact Library 是 Hub 的一级 view，不复制为每个 App 自己的文件浏览器；Picker/Artifact ref 仍按 App/Run scope 进入 Conversation。
- **Custom Frontend**：声明 `targets.frontend` 的 Plugin iframe 接管 App content area，但不接管 Nexus window chrome、App switching、认证或权限 UI；无 Frontend target 的 AgentDefinition App 直接复用 Host surface。
- **异步状态**：loading、error、reconciliation-required、running/awaiting approval/budget/terminal status 都有明确视觉状态；不得仅靠 toast 表达 durable Run truth。
- **可访问性**：主要 action/select/input 使用可访问名称，窄屏 drawer 有 backdrop/close 语义，`prefers-reduced-motion` 禁用 drawer 动画。窗口 move/resize 仍以 pointer 为主，后续若扩展完整键盘窗口管理，应继续由 `window-manager` 统一实现，不能在各 App 内分叉。

当前多插件体验采用“一套 Host chrome + 多个 App surface”的方式，而不是为每个 Plugin 打开独立窗口。这样可以同时安装多个 Plugin，并通过 App selector/activity strip 切换，同时保持各 App 的 Thread/draft/Run presentation state 独立。

## 4. App、Thread、Run 与 Ledger

### 4.1 App

App 由 manifest / registry 注册。Nexus 产品当前只有一个管理员用户；`userId + appId` 仍作为服务端推导的 owner/scope key，目的是让现有持久化、授权和事件边界保持显式，而不是表示多租户产品模型。浏览器不能覆盖 owner。

同一用户可以同时安装多个不同 `appId` 的 Agent Plugin；`agent_plugin_installations` 以 `(user_id, app_id)` 为主键，因此语义是“每个 App 一条当前安装记录 / 多个 App 可并存”，不是“全局只能装一个 Plugin”。同一 `appId` 的新版本走 upgrade/drain，不通过第二条 installation 伪装并存版本。

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
/queue remove <position>
/queue move <from> <to>
/stop             cancel current Run
/help             show command reference
```

命令 dispatch 在 parser 层与普通对话严格分离；未知命令直接返回用户可理解错误，绝不能退化为普通 prompt。`//...` 明确逃逸为以 `/` 开头的普通用户输入，Composer 提供 slash suggestion 与 `/help`。已有 Run 时 `/goal <text>` 走 versioned/idempotent `run.goal.set`；空 Thread 上 `/goal <text>` 通过 `run.create` 的 `initialGoal` 直接建立 revision 1 的 durable Goal 并启动 Run。`/plan` 从最新 Run projection 读取 typed durable Plan，`/queue` 从 `consumedInputSequence + Ledger sequence` 派生 pending inputs；`/queue remove <position>` 与 `/queue move <from> <to>` 通过 versioned/idempotent Backend mutation 修改仍未消费的 durable `user_input`，并同步 bump Run `inputRevision/version`。`/stop` 复用正式 cancel contract。`/interrupt <text>` 使用独立 `run.interrupt` command：只有事务内确认 Root model 正在 streaming 才会追加输入并 supersede model step，否则返回状态冲突；它不会借“interrupt”名义取消已经开始的 mutation 或 supersede approval。

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

Conversation `/queue` 复用现有 append-only Ledger，并叠加 Run durable event 形成执行队列投影：原始 `user_input` 与 Ledger sequence 永不因 queue mutation 被删除或改号；Backend 先按 Ledger sequence 读取 Run 的输入，再顺序重放 `input.pending_moved` / `input.pending_removed`，最后以 `consumedInputSequence` 划分当前 pending 集合，并返回有上限的明细页、authoritative `total` 与 `hasMore`。Frontend 不维护第二套 local-only queue，也不会把第一页长度冒充总数。

当前边界：

- Agent 运行时仍可通过正式 append-input 追加输入；
- 普通 append-input 维持现有 `NEW_INPUT` 语义：Root model 正在 streaming 时会 supersede 当前 model step；
- `/interrupt <text>` 使用更严格的 `run.interrupt`：仅 streaming model 可接受，否则 409；
- `/queue` 展示 authoritative pending queue；
- `/queue remove <position>` 只能删除 `sequence > consumedInputSequence` 的未消费输入；
- `/queue move <from> <to>` 只能重排同一未消费集合；Backend 在单个 StateCommit 事务内追加 queue mutation durable event 并 bump Run `inputRevision/version`，**绝不修改历史 Ledger sequence 或 Thread entry**；
- `/queue remove` 只从“后续模型执行投影”中移除输入；原始 Ledger entry 作为用户历史事实继续保留，Context projection 会永久忽略该被移除 input；
- 已消费输入不能通过 pending-input mutation 修改；模型正在 streaming 时队列 mutation 会触发与新输入相同的 `NEW_INPUT` safe-boundary supersede 语义；
- Frontend position 只用于交互定位，最终 mutation 仍提交 stable input id + expected Run version，不能以 local array 作为事实源。

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

Provider 使用 OpenAI-compatible 配置模型，credential 加密保存且 API 不回填明文。Backend 支持通过受现有 outbound policy/credential policy 保护的 Provider discovery 请求读取上游 `GET <baseUrl>/models`；discovery 只把 model id（以及可选 owner/created metadata）当作候选事实，不推测 context window、max output、tool capability 或 pricing，用户必须确认这些基础能力后才写入 Provider 配置。

Reasoning capability 不由普通用户手工配置。Backend 的 `ModelCapabilityResolver` 当前以 Nexus 内置 Model Capability Registry 为生效来源，根据已知/canonical model id 派生 `reasoningEfforts`、`defaultReasoningEffort` 等只读能力；未知模型保持 Unknown 并使用 Provider 默认，不猜档位、不发送 reasoning 参数。Resolver 预留未来 Provider live capability 输入层，但当前 `/models` discovery 不解析 reasoning 扩展元数据，也不缓存此类能力。Frontend 只消费 Backend 派生结果生成思考强度滑条。

每个 Run 冻结 Provider configuration version 与最终 reasoning effort。Provider/Registry 能力在 Run 创建后发生变化，不得改写已有 Run 的 definition snapshot；下一次 Run 才使用新能力。

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
- Environment 是真实 Next Run selector。Frontend 只保存 recipe 选择（或显式 `No Workspace`）作为下一次 Run 的输入；创建 Run 时 Backend 同时校验 expected Catalog revision 与 Agent settings revision，解析 Recipe、Toolchain、Runner Plugin、ACP Profile、Browser Target 等完整 profile，并冻结到 `RunDefinition.environment`。

Workspace create 只能消费该 Run 的 frozen Environment snapshot；模型侧 `workspace_create` 不再接受 recipe/toolchain 参数，因此不能在 Run 中途偷偷切换环境。显式 `No Workspace` 的 Run 会拒绝 Workspace create。独立管理 API 仍可为 legacy/administrative flow 创建 Workspace，但 Run-aware 路径必须优先使用 frozen snapshot。

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

签名粒度是 **Plugin package/version**，不是单个 Skill。一个签名包可以包含多个 `SKILL.md`；`files.json` 固定每个 Skill 文件的 SHA-256，而 package 的 Ed25519 signature 覆盖整个版本，因此任一 Skill 被单独修改都会使安装/读取校验失败，不需要为每个 Skill 再生成独立签名。

Skill 目录采用单一来源规范：每个 Skill 必须且只能是 `skills/<slug>/SKILL.md`。同一个 Markdown 文件的 frontmatter 同时定义 `id/name/version/description/requiredCapabilities`，正文紧随其后；禁止再放 `skills/index.json`、独立 metadata 文件或单独 body 文件，避免索引与正文漂移。Host package verifier 会拒绝不符合这一布局的签名包。

Skill 对模型采用渐进披露：基础 Context 只发送当前 App 可用 Skill 的 `id/name/description` metadata，不自动发送任意 `SKILL.md` 正文、version/hash/capability 清单。模型判断某个 Skill 与当前任务相关后，调用 Host-owned read-only `skill_read(id)`；Host 再从当前已安装签名包读取同一个 `SKILL.md` 的正文、复核文件 hash，并把该单个 Skill 正文作为 bounded Tool result 返回。这样 Skill 数量增长不会线性污染基础 Context，也不会因为安装 Plugin 就把所有 Skill instructions 自动注入模型。

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

动态 Frontend 资源通过 Nexus 主站同源 `/plugins/...` 与 `/sdk/frontend-v1.mjs` 提供，但 iframe 继续使用 `sandbox=allow-scripts` 且不授予 `allow-same-origin`，因此 Plugin JavaScript 保持 opaque origin。Plugin 只经 bounded MessagePort 调用显式 SDK；Frontend container 不挂载插件 storage，也不向 iframe 暴露 Nexus session/CSRF/HTTP client。

Runner plugin 通过独立 Runner protocol/lifecycle 执行。

### 16.3 第一方插件仓库与术语

第一方可分发插件源和签名发布流程由独立仓库 `0honus0/nexus-agent-plugins` 持有。

术语必须严格区分：

- **Host/Core**：随 `nexus-terminal` 主镜像编译发布的 Run/Scheduler、Capability Broker、Policy/Approval/Lease、Workspace Runtime bridge、Plugin verifier/installer/SDK 等安全与运行原语；修改这些代码需要更新主镜像。
- **first-party installable Plugin App**：由 Nexus 官方维护、独立签名和发布、通过正常 Plugin lifecycle 安装/升级的 App；它不是 compile-time built-in。
- `nexus.agent`：当前默认推荐的 first-party installable Plugin App。它只提供一个通用 `agent.default` AgentDefinition，并在同一个签名包中提供 exactly two App-scoped Skills：`nexus.operations`（Operations）与 `nexus.developer`（Developer）。Agent 初次启用时 Host 从 pin 住 publisher 身份的 official catalog 读取推荐项，用户确认后按 `stage -> verify -> install -> grant -> enable` 正常流程安装；Operations / Developer 不再各自占用独立 App shell。
- `nexus.fullstack`：first-party target-composition reference Plugin App，显式声明 `frontend + backend + runner` 三种 target。Frontend 运行在主站同源 URL + opaque sandboxed iframe；Backend target 在 Nexus Backend 之外的独立 Node child runtime 中加载并通过 App Storage SDK 工作；该进程使用 Node Permission Model 限制插件包以外的文件访问、文件写入、child process、worker、native addon/WASI，但不宣称提供 OS namespace/network sandbox。Runner target 运行在冻结 Workspace generation 下，只拿 Workspace-local Runner SDK。它用于持续证明完整 target lifecycle，而不是把 Host/Core 权限迁入插件包。

Host-owned governed Tool implementations 仍属于 Core，因为它们是 Capability Broker 与真实 machine/workspace/runtime adapter 之间的受控执行原语；Plugin 只通过 manifest grants/AgentDefinition/Skill 使用这些 capability，不把 raw SSH/Runner/Browser authority 带进插件包。这样 `nexus.agent` 的 AgentDefinition/Skills/版本以及 `nexus.fullstack` 的 target 实现可独立远程升级；若新插件要求 Host 尚不具备的新 capability/SDK/protocol，仍必须升级 Nexus 主镜像。

官方 catalog URL 可以通过部署配置指向 GitHub/CDN/镜像；官方 publisher Ed25519 public key/key id 在生产 Host 中固定 pin，普通生产环境变量不能替换信任根。Plugin 管理页始终把该 Host-pinned official catalog 作为只读 first-party source 展示，不要求用户把官方 URL 添加到 `plugins.repositories`；其中的包必须经 `/official/stage` 使用同一 pinned source 下载/校验。用户额外添加的 repository 继续使用独立的显式 publisher trust 流程。只有 `NODE_ENV=test` 或显式 `NEXUS_E2E_RESET_ENABLED=1` 的受控 E2E 模式允许注入测试 publisher。 Catalog package entry 还必须携带 `sdkVersion` 与 `nexus.minVersion/maxVersion`；Host 在展示/推荐/stage 前先按当前 Nexus 版本与支持的 Plugin SDK major 计算 compatibility，不兼容包在 UI 中禁用且 Backend 拒绝 staging，包内 manifest 在签名验证后仍会再次做最终兼容性校验。已经安装的推荐 App 后续重新启用时优先读取本地 immutable installation/version，不依赖 official catalog 网络可用，也不会重置既有 grant。

第一方插件仓的 `pnpm run check` 是源码/manifest 基线检查；发布产物由 `build-package.mjs` / `build-catalog-release.mjs` 生成 Ed25519 签名 tar + catalog。仓库要求 Node `>=24`，发布/CI 证据必须以标准 Node 24 workflow 为准，不能把低版本开发机的 engine warning 当成发布结果。

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
- Environment 可选启用的 Workspace Recipe，或显式选择 `No Workspace`；
- Targets 可选。

Active Run：

- Model 从 frozen `RunDefinition.model` 显示；
- Environment 从 frozen `RunDefinition.environment` 显示；
- Targets 从 frozen `connectionIds` 显示。

Environment selection 不是 frontend authority：Run create 携带 recipe selection + observed Catalog revision，Backend 用当前 settings revision 与 Runner Catalog 做 CAS/解析并写入完整 snapshot。Workspace create 随后消费 snapshot，而不是重新从当前 defaults 推导。

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
- signed Plugin install/upgrade/custom surface 与**多个不同 `appId` 安装式 Plugin 同时并存**；
- Developer preset 真实 Run、App switching、窄窗审批、checkpoint、Artifact 与功能截图；
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
- durable pending-input queue inspection + versioned remove/reorder mutation；
- appendInput + streaming model interruption；
- approval supersede on newer input；
- budget/cancel/checkpoint/resume；
- Artifact Library；
- governed Tool execution；
- Workspace Runtime + Host Runner；
- ACP / Browser / Workspace local Terminal live execution；
- Subagent durable mailbox/work queue；
- signed installable Agent plugins；
- `nexus.agent` 作为默认 first-party installable Plugin 分发，一个 `agent.default` AgentDefinition 内承载 `nexus.operations` / `nexus.developer` 两个 Skill；Agent 初次启用时由 Host 推荐并安装该合并插件，而不是从 Nexus 主镜像启动编译期 App；`nexus.fullstack` 独立验证 frontend/backend/runner target 组合；
- server-validated/frozen Next Run Environment snapshot；
- structured diagnostics。

### 已决定、待实现

1. 更完整的 `Agent UI -> Workspace create -> Runner execute -> visible UI result` 单路径产品 E2E。
2. First-party Plugin 发布前必须把 GitHub Actions `NEXUS_AGENT_PLUGIN_SIGNING_KEY_PEM` 与仓库 pin 的 official publisher public key 保持一致；生产 Host 只允许通过部署配置替换 catalog/mirror URL，不允许替换官方 publisher trust root。

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

## 25. 当前 Agent 问题测试环境与操作交接（2026-09-14）

本节记录当前用于 Nexus Agent 问题定位与验证的真实开发环境、Git/文档规则、PVE/Windows CDP 拓扑、本地开发链路和测试方法。它是当前会话恢复与继续测试的操作基线；若环境事实发生变化，应先重新验证再更新本节。

### 25.1 源码与 Git 规则

Nexus Terminal 唯一源码工作区：

```text
/home/agentdock/AgentDock/nexus-terminal
```

源码、文档、测试修改都只在该仓库进行。不要在 honus.top 的 `/home/honus/product/nexus_terminal*` 或其它 project 目录里修改源码。

Git 只使用一个开发分支：

```text
dev
```

不要为每个问题创建新 branch，也不要复制多个源码树。开发流程固定为：

```text
dev 修改
  -> 本地 Node/Vite 热更新
  -> api.honus.top
  -> Windows Chrome CDP 真浏览器测试
  -> commit
  -> push dev
```

只有需要验证 Docker/Compose 部署行为时，才构建 Docker image。

当前 Git 状态：

- branch：`dev`
- local HEAD：`6ae13e623bb5`
- `origin/dev = 6ae13e623bb5`
- `origin/main = 3d790e4c8cac`
- 已确认 `origin/main` 是当前 `dev` 的 ancestor。
- 最近提交：`6ae13e6 docs: record AgentDock dev port mapping`
- local dev 与 origin/dev 当前一致。
- GitHub CLI 已认证账号 `0honus0`，HTTPS Git operations 已配置，`git push origin dev` 已实测成功。

### 25.2 PROBLEM 文档规则

唯一问题记录：

```text
/home/agentdock/AgentDock/nexus-terminal/doc/PROBLEM.md
```

不要在 honus.top 另外创建 PROBLEM.md。

每次发现需要修改代码的问题，必须按以下顺序：

1. 先复现并收集证据。
2. 在 `doc/PROBLEM.md` 写清问题现象、根因、决策、计划修改、验证方法。
3. 再修改代码。
4. 本地真实验证。
5. 补实施结果和最终状态。
6. commit 到 `dev`。
7. push `origin/dev`。

不要先改代码后补问题记录。

当前 PROBLEM 已记录到 P-018。P-018 只记录 AgentDock 当前开发端口映射，不修改任何 Nexus 默认端口。特别注意：不要修改 Frontend/Vite 或 Backend 的源码默认端口，除非后续单独形成新的问题和明确决策。

### 25.3 AgentDock 当前环境

AgentDock 当前版本：

```text
0.8.3
```

AgentDock Core 健康。AgentDock 实际运行在 PVE 里的 Debian VM：

```text
hostname: hermes
Debian VM IP: 172.30.31.10
AgentDock Docker IP: 172.18.0.2
```

Debian 上 Compose：

```text
/home/honus/agentdock/docker-compose.yml
```

AgentDock 容器当前 host port：

```text
8765:8765
9998:9998
```

公网 MCP：

```text
https://mcp.honus.top
```

### 25.4 SSH MCP 持久化配置

SSH MCP 之前安装在容器临时目录：

```text
/home/agentdock/.local/mcp-ssh/...
```

AgentDock 容器重建后 package 消失，但 registry 仍保留，因此出现 `MCP_CONNECTION_FAILED`。

现在已经重新安装到持久化目录：

```text
/home/agentdock/.agentdock/mcp/ssh-runtime
```

入口：

```text
/home/agentdock/.agentdock/mcp/ssh-runtime/node_modules/@aiondadotcom/mcp-ssh/bin/mcp-ssh.js
```

SSH dynamic MCP 已重新注册、refresh，当前：

```text
status = ready
tool_count = 7
```

可用能力：

- `checkConnectivity`
- `listKnownHosts`
- `getHostInfo`
- `runRemoteCommand`
- `runCommandBatch`
- `uploadFile`
- `downloadFile`

重要 SSH alias：

```text
honus
  host: honus.top
  port: 9902
  user: root

debian
  host: honus.top
  port: 19902
  user: root
```

访问 PVE 内 Debian VM 时使用 `debian`。不要直接使用 `honus.top`，否则可能走 SSH 默认 22。

### 25.5 PVE / Debian / Windows 网络拓扑

整体链路：

```text
Internet
  -> honus.top
  -> Docker 化 PVE
  -> Debian VM + Windows VM
```

外层 honus.top 运行 Docker project：

```text
pve
```

PVE container：

```text
10.240.31.2
```

PVE 内部 bridge：

```text
vmbr0 = 172.30.31.1/24
```

VM 100：

```text
name: debian
IP: 172.30.31.10
```

VM 101：

```text
name: windows
IP: 172.30.31.11
```

Debian 和 Windows 都挂在同一个 `172.30.31.0/24` 内部网络。

### 25.6 Windows Chrome CDP

Windows Chrome CDP：

```text
http://172.30.31.11:9223
```

已实际验证：

```text
http://172.30.31.11:9223/json/version
```

返回 HTTP 200，Chrome 为：

```text
Chrome/152.0.7977.83
```

AgentDock Docker container 内也已经实际验证可以访问 `172.30.31.11:9223`。

AgentDock Core 当前实际配置：

```text
AGENTDOCK_BROWSER_ENABLED=true
AGENTDOCK_BROWSER_CDP_URL=http://172.30.31.11:9223
```

AgentDock Browser 已实测返回：

```text
connection_mode=external_configured
```

因此 `browser_session`、`browser_act`、`browser_snapshot` 当前控制的是 Windows VM 中真实 Chrome，而不是 AgentDock container 临时启动的 Chromium。

以后所有 UI / Agent 用户行为问题，优先使用真实 Windows Chrome 验证。不要把 CDP 9223 暴露公网。

AgentDock 已通过 `AGENTDOCK_BROWSER_CDP_URL` 配好外部 Chrome，因此调用 `browser_session` 时应直接使用默认 `external_configured` 连接，不要在单次调用里手动传 `cdp_url`。如果本地 Playwright 因缺少自带 Chromium/Headless Shell 无法启动，UI 验证优先继续走这个 Windows CDP 真浏览器，不要仅为当前验证临时下载浏览器；只有标准 E2E/CI 需要 Playwright 自带浏览器时才按对应环境准备依赖。

### 25.7 Nexus 本地开发服务当前状态

当前两个 AgentDock command sessions 仍处于 running：

```text
Backend  -> session-84fda9a5e6893657debc34c7
Frontend -> session-d24e7364efb5a67a6145f6cc
```

Backend 当前开发入口：

```text
3001
```

Frontend 当前开发实例：

```text
9998
```

注意：`9998` 是当前 AgentDock 开发环境显式传入的运行端口，不是 Nexus Frontend 的源码默认端口。Frontend 源码 dev script 仍然是：

```text
vite --host
```

不要修改默认端口。当前 Vite 是通过显式命令运行：

```bash
pnpm exec vite --host 0.0.0.0 --port 9998
```

### 25.8 Backend 本地开发配置

Backend dev script：

```bash
pnpm --filter @nexus-terminal/backend dev
```

当前公网开发测试使用：

```text
AGENT_PUBLIC_ORIGIN=https://api.honus.top
RP_ID=api.honus.top
RP_ORIGIN=https://api.honus.top
```

Backend：

```text
HTTP API: 0.0.0.0:3001
Plugin / SDK: 同一 3001 listener 下的 /plugins/... 与 /sdk/...
```

P-023 起 Backend 不再启动独立 `3002` listener。Plugin/SDK 保留专用静态 request handler 与安全头，但和 API/WebSocket 复用 `3001`；浏览器仍只通过同源 `/plugins/...` 和 `/sdk/...` 访问。

Backend 开发数据目录：

```text
/home/agentdock/AgentDock/nexus-terminal/packages/backend/data
```

这是本地独立开发数据。已经生成：

```text
packages/backend/data/.env
```

其中包含本地自动生成的 `ENCRYPTION_KEY` 和 `SESSION_SECRET`。不要使用正式环境数据库进行本地 Agent 测试。

### 25.9 Frontend / Vite 当前代理关系

Frontend 开发服务器：

```text
0.0.0.0:9998
```

Vite 当前负责：

```text
/api               -> Backend 3001
/uploads           -> Backend 3001
/ws/workspace      -> Backend
/ws/uploads        -> Backend
/ws/remote-desktop -> Backend
/ws/agent          -> Backend
/plugins           -> Backend 3001 Plugin static handler
/sdk               -> Backend 3001 Plugin static handler
```

因此浏览器只需要访问一个 Origin。

### 25.10 api.honus.top 公网开发链

Nginx Proxy Manager 已经存在：

```text
api.honus.top
```

NPM：

```text
api.honus.top -> 127.0.0.1:9998
```

外层 PVE 已经存在：

```text
9998 -> 172.30.31.10:9998
```

Debian AgentDock Docker：

```text
host 9998 -> AgentDock container 9998
```

最终链路：

```text
AgentDock Vite
  -> Debian VM
  -> nested PVE
  -> honus.top
  -> Nginx Proxy Manager
  -> https://api.honus.top
```

当前已重新验证：

```text
http://127.0.0.1:3001/api/v1/status       -> 200
http://127.0.0.1:9998/                    -> 200
http://127.0.0.1:9998/api/v1/status       -> 200
http://127.0.0.1:9998/sdk/frontend-v1.mjs -> 200
https://api.honus.top/                     -> 200
https://api.honus.top/api/v1/status       -> 200
https://api.honus.top/sdk/frontend-v1.mjs -> 200
```

所以当前开发环境已经完全可用。

### 25.11 Windows 真浏览器验证 Nexus

AgentDock 已通过 Windows Chrome CDP 实际打开：

```text
https://api.honus.top
```

页面 title：

```text
Nexus Terminal
```

本地开发数据库是全新的，因此当前自动进入：

```text
https://api.honus.top/setup
```

页面显示“创建第一个管理员账号”。当时 browser snapshot：

```text
console_errors = []
network_errors = []
page_errors = []
```

所以浏览器、公网、Frontend、Backend 当前链路正常。接下来可以直接创建本地开发管理员并开始 Agent UI 测试。不要拿线上账户/线上数据库替代这套独立开发数据。

### 25.12 Node / pnpm 状态

当前：

```text
Node v22.17.0
pnpm 11.26.0
```

Nexus repo 当前声明 `Node >= 24`，因此执行时会出现 engine warning。目前实际 Backend dev、Frontend Vite、API、Browser 均正常，所以该 warning 当前没有阻塞 Agent 测试。

如果后续遇到 Node API / SQLite / build 行为差异，应优先考虑升级 AgentDock container 到 Node 24 环境，而不是直接修改 Nexus 代码绕过。

### 25.13 Plugin 同源架构规则

历史 P-002 / P-005 / P-006 / P-016 已确定：Plugin 不使用独立公网 Origin。

浏览器看到的是：

```text
https://<nexus-origin>/plugins/...
https://<nexus-origin>/sdk/...
```

P-023 起 Plugin/SDK 与 API 复用 Backend `3001` listener，但 Plugin 静态 handler 继续保留独立 CSP、iframe 与路径校验安全语义。不要重新引入独立 Plugin listener、公网端口或 `plugin.honus.top`。

Plugin iframe 继续保持：

```text
sandbox=allow-scripts
```

不要添加：

```text
allow-same-origin
```

Plugin route 不应该继承主页面：

```text
X-Frame-Options: DENY
```

### 25.14 Runner 当前产品边界

历史 P-008 / P-016 已确定：Agent Runner 是 optional capability。

核心 Nexus 不应该：

- 默认硬依赖 Runner。
- 因 Runner 不存在而不能启动。
- 默认写死 `host.docker.internal` Runner URL。

Runner 使用 Compose profile 显式启用。当前本地 Agent 问题测试如果不涉及 Workspace Runner，不要先启动 Runner。

### 25.15 Agent / Model 历史问题重点

接下来主要开始测试 Agent。历史 PROBLEM 有 P-009～P-013。这些记录很重要，但必须重新对照当前 dev 源码，不能因为文档写了就假定代码已经完整实现。

#### P-009：模型没有正确使用 Nexus Tool

方向：模型应该知道声明出来的 Tool 是 Nexus 当前可用 capability。例如 `machine_list_connections` 这种安全只读工具应该可以被模型正确选择。

#### P-010：Prompt Cache ordering

稳定上下文应该尽可能在前。当前目标顺序：

1. static safety / tool instruction
2. Skill metadata
3. append-only ledger/history
4. current user input
5. goal
6. plan
7. collaboration
8. recall

不要把频繁变化内容放在稳定 prefix 前部。

#### P-011～P-013：当前模型输入与 Prompt Cache 架构（2026-09-14 最终校正）

Core 不拥有 Provider 私有 cache 字段。当前通用 `ModelRequest` 的关键结构是：

```text
instructions[]
messages[]
tools[]
toolMode
cache.scopeKey
cache.affinityKey?
```

职责边界：

```text
Nexus Core
  -> deterministic / stable-prefix-first / append-oriented model input
Provider adapter
  -> Chat 或 Responses wire serialization
CPA / upstream provider
  -> cache/session identity 与 routing
```

不要再把 OpenAI/Codex 的 `prompt_cache_key` 放回 Nexus 普通调用路径。2026-09-14 的最终隔离实验已经证明：

- CPA 标准 session / Chat-style 长历史不传 caller `prompt_cache_key`，约 21k input 的 warm `11/11` 非零，稳定约 98%~99% cached。
- 相同 Responses `instructions + input` 只去掉 caller `prompt_cache_key`，保留既有 affinity 行为，`21344/0` 后连续 11 轮都是 `20992 cached`，warm 约 97.4%~98.3%。
- 因此 Responses 不是根因，`instructions + input` 不是根因；让 Nexus 显式拥有 caller `prompt_cache_key` 才是最终被撤掉的耦合点。

更早的 per-Thread-key vs stable-prefix-key A/B 仍有历史价值：它证明了 per-Thread 高基数 key 会破坏相同 prompt 的 cache grouping；但 **stable-prefix key 也只是阶段性实验，不是当前实现**。详细序列与语义校正都以 `doc/PROBLEM.md` P-012 为准。

当前 canonical input 顺序与预算优先级：

```text
[STABLE INSTRUCTIONS]
safety
signed Skill metadata

[APPEND-ORIENTED HISTORY]
user / assistant / tool chronology

[CURRENT TURN]
current user input

[VOLATILE TAIL]
goal
plan
collaboration
recall
```

稳定 Skill metadata 必须在预算分配时也优先于 history/volatile tail，不能只在最终数组中移动到前面。动态 snapshot 不要放到历史前面；`contextEpoch`、runId、attemptId、credential revision、routing/cache identity 等控制面数据不得进入模型正文。

Tool schema 要保持 deterministic/canonical。达到 step budget 时保留同一 schema，改用 `toolMode=none`，不要删除 tools 导致 prefix 改变。Tool history 保留原始 `assistant tool_call -> tool_result -> assistant` chronology，不要每轮重写旧 tool 结果。

#### Chat Completions / Responses 双协议

OpenAI-compatible Provider 现在正式支持两种可切换协议：

```text
chat-completions
responses
```

协议是 **per-Provider 配置**，不是全局 `AGENT_OPENAI_PROTOCOL` 环境变量；存储在现有 Provider `endpoint_policy_json`，旧 Provider 缺字段时默认 `chat-completions`。不同 Provider 可以同时使用不同协议。

两种协议必须消费完全相同的 Core canonical input：

- Chat：`instructions[]` 依次序列化为 leading `system` messages，然后追加 `messages[]`。
- Responses：`instructions[]` 合并为顶层 `instructions`，`messages[]` 映射到 `input`；尾部动态 system 映射为 `developer`。
- 两边使用相同稳定 Tool schema、相同 `toolMode`；当前都设置 `parallel_tool_calls=false`。
- Nexus 不发送 `prompt_cache_key`，也不注入 Codex 专属 turn/thread metadata。
- 2026-09-14 最终真实 New API→CPA 回归：Chat `17074/0` 后 warm 4 轮均 `16128 cached`；Responses `17072/0` 后 warm 4 轮均 `16128 cached`，两边约 94%。Responses A→B→A 为 `A 17071/0 -> B 17071/0 -> A 17071/16128`，证明协议双路径与多 session 切换在当前实现下都能维持预期 cache continuity。P-012/P-013 因此已闭环。
- 最终 cache/session 压力基线：A/B 测试必须使用不同 instructions/payload，并刻意拉开总 token 长度，以便从 `cachedInputTokens` block 判断是否串 cache。单批不同长度测试中 A 约 14.3k input、warm 固定 `14080 cached`，B 约 20.8k input、warm 固定 `20224 cached`；随后 5 个 fresh batch × 每批 12 请求，共 60 次真实 Responses 调用，10 个 cold 请求全部为 0，50 个 warm 请求全部非零，A/B cached block 0 次交叉。
- Cache 回归判定：`cachedInputTokens=0` 只表示该次是 cold/miss，本身是合法结果，不应直接判失败。真正需要报警的是稳定 append-only 前缀长期无法 warm、或不同 session 命中到对方的 cache block/identity。上游允许偶发单次 warm miss；若下一轮恢复且大样本压力回归稳定，不据此修改 identity/header contract。

`affinityKey` 仍是 provider-neutral routing hint：Root 使用 `nexus:thread:<threadId>`，Subagent 继承所属 Thread；OpenAI-compatible adapter 当前仍可把它映射成既有 `session-id`。不要把它描述成 Prompt Cache 根因或充分修复，也不要再增加 identity header 组合，除非新的 wire 证据证明必要。

#### 多会话切换约束

A→B→A 必须满足：A 的 model body 只由 A 自己的 Provider config + context 决定，B 不得改变 A 的 instructions、tools、history serialization 或正文。不要从“当前 UI active thread/session”向 model builder 注入任何全局状态。

本地 loopback contract 已验证：相同 A canonical request 在 A→B→A 后两次 Chat JSON body 完全一致；同一 canonical request 也能切换成 Responses wire，且两边都没有 caller `prompt_cache_key`。协议切换改变 wire codec，不改变 Core context semantics。

#### 长上下文 compaction

未来做 history compaction 时按 generation boundary：一代 history 尽量 append-only；达到阈值后一次性生成稳定 summary 并开启新 generation，接受一次 cold-cache cost。不要每一轮重新总结/改写旧 history。

缓存观测优先看 warm `cached/input` 比例、warm turn 掉 0 的频率和精确 prefix hash；不要跨不同总输入长度只比较 `cachedInputTokens` 绝对值。约 4.2k~4.6k input 上的 `3584 cached` 已接近完整 cache block，不能被描述成“缓存深度只能到 3584”。

当前 `dev` 的实际代码和 `doc/PROBLEM.md` 必须作为事实源一起检查；不要仅凭更早的 P-009～P-013 文字推断实现状态。

### 25.16 当前推荐 Agent 测试方法

新一轮测试不要一上来读很多代码，也不要先改代码。先用真实系统复现。

优先定位顺序：

```text
Windows Chrome CDP
  -> Agent UI 操作
  -> Backend logs
  -> /api
  -> /ws/agent
  -> Model request
  -> Tool schema
  -> Tool call
  -> Provider adapter
  -> Agent execution state
```

目标是先确定“第一个发生偏差的层”。

例如如果 Agent 不调用工具，不要直接判断是 prompt 问题。需要区分：

- Tool 是否真的注册。
- 前端请求是否把 Agent 配置传正确。
- Backend 是否向模型声明 tools。
- `toolMode` 是否允许。
- Provider payload 中 tools 是否存在。
- 模型是否返回 tool_call。
- Backend 是否正确解析 tool_call。
- Tool execution 是否被权限/策略拒绝。
- Tool result 是否重新加入模型上下文。
- UI 是否正确显示执行状态。

### 25.17 推荐的第一个 Agent 测试

先从真实 Agent UI 开始。

1. 打开 `https://api.honus.top`。
2. 如果仍在 `/setup`，创建本地开发管理员。
3. 进入 Agent。
4. 设计一个最简单、可验证、只读、安全的 Tool 测试，例如让 Agent 查看当前机器连接列表。
5. 同时检查 Agent UI 请求、`/ws/agent`、Backend Agent 日志、ModelRequest 实际 tools、Provider adapter 发出的请求、模型 tool call、Nexus Tool execution、Tool result 回灌和最终回答。
6. 找到第一个真实问题以后，先写 `doc/PROBLEM.md`，再修改代码。

### 25.18 当前开发验证原则

UI / 浏览器行为：优先用 Windows CDP 真 Chrome。

API contract：使用 curl / backend test。

代码结构：使用 architecture check / unit test。

Frontend 修改：依靠 Vite hot reload，直接在 Windows Chrome 看效果。

Backend 修改：tsx watch 自动重载。

不要每次修改都走：

```text
build Docker
  -> push GHCR
  -> deploy
```

只有以下情况才需要 Docker 验证：

- Compose
- Docker networking
- Nginx container
- Runner profile
- container-only path
- production deployment boundary

### 25.19 明确禁止事项

- 不要创建新的测试源码目录。
- 不要在 honus product/project 里修改 Nexus 源码。
- 不要创建多个 issue branch。
- 不要修改 Frontend 默认端口来适配 9998。
- 不要重新引入独立 Backend Plugin listener 或把 Plugin 暴露为独立公网 Origin。
- 不要把 Windows CDP 9223 暴露公网。
- 不要直接拿正式数据库做本地测试。
- 不要看到 PROBLEM 历史记录就假设代码已经实现。
- 不要在定位问题之前大规模重构。
- 不要先改代码后补 PROBLEM。

### 25.20 新会话开始后的直接执行顺序

当前 Git、SSH MCP、本地开发服务、公网入口和 Windows CDP 均已经准备好。新会话直接执行：

1. 确认 Backend session / Frontend session 仍 running。
2. 检查 `https://api.honus.top/api/v1/status`。
3. 使用 AgentDock Windows CDP 打开 `https://api.honus.top`。
4. 如果首次 setup，则创建本地开发管理员。
5. 进入 Agent UI。
6. 选择一个最简单的真实 Agent Tool 场景。
7. 同时观察 Backend / WebSocket / Model / Tool execution。
8. 找到第一个真实故障点。
9. 在 `doc/PROBLEM.md` 新增问题记录。
10. 再开始修改。
11. 验证。
12. 只有用户明确要求时才 commit 到 `dev`。
13. 只有用户明确要求时才 push `origin/dev`。

本节仅作为当前 Agent 测试环境与操作基线记录；本次写入不要求单独提交。

### 2026-09-14 Agent UI 重构补充

- Settings 从左侧目录改为顶部可换行分区导航；固定工作区高度，各分区保留草稿和独立 scrollTop，不再 scrollIntoView 外层页面。
- Provider 测试独立记录 provider/version/model 对应的 loading/success/error，就地显示延迟与错误；不占用页面顶部通告。创建成功关闭表单并清空 credential，失败保留输入。
- Thread 创建直接复用无 title 的既有 API；排序不受当前选中状态影响；切换清除旧投影并等待加载完成后开放发送。
- 空 assistant entry 不占阅读区；完整工具输出可展开；用户输入保持纯文本，assistant Markdown 经 DOMPurify allowlist 清洗，禁用图片/嵌入内容。
- 中文 IME Enter 不发送，错误/对账提示位于 Composer；对账仍锁定 mutation。Popover 有可视边界定位与 Escape 返回焦点；详情 drawer 支持键盘焦点管理。
- 自动命名仍记录在 PROBLEM P-025；P-026 的 reasoning effort 已补齐 Backend Run 冻结与 OpenAI-compatible 映射，并由内置 Model Capability Registry 自动驱动可选档位。普通用户不编辑 capability；Provider live capability 解析留作后续扩展。
- 用户要求先完成功能，不修改测试；既有测试的旧导航/命名交互断言留待后续同步。
