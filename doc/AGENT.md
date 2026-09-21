# Nexus Agent 架构

> 状态：Current architecture baseline
>
> 适用分支：`main`
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

### 3.2 Windows 风格模态工作台浮窗

当前 Hub 是带全屏 backdrop 的 modal workbench（`role="dialog"` + `aria-modal="true"`）：打开 Hub 后页面背景不再接受滚轮/触摸交互，点击 backdrop 只触发窗口强调反馈，不会把 Hub 静默关闭。Hub 本身仍保留桌面窗口式操作：

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
- **Window chrome**：标题栏直接承载当前已打开的 App tabs；每个 tab 显示 App identity、health 以及 running/approval/budget 微状态，多 tab 时允许就地关闭。尾部 `+` 打开 `AgentAppSwitcher`，只列出 enabled Apps，超过 4 个候选时显示搜索。右侧保留 Conversation/Files 一级 view、pending approval 提示以及 minimize/maximize/close。
- **App 切换**：`AgentAppSwitcher / 顶栏 App tab -> AgentHubWindow.switchApp -> agentSurfaceSession.activateApp -> agentWindowManager.switchApp`。离开 App 前暂停 detail presentation；每个 App 的当前 Thread、draft、Next Run model、Next Run Environment 等 view state 独立保留，不把这些临时状态直接当作 Run truth。disabled App 会从 tabs/switcher 候选中移除，不再作为 fallback 继续展示。
- **Agent surface**：默认 `216px Threads / Conversation`，TaskRail 按需展开为 300px 第三栏；Conversation header 负责 Thread/Run status、历史与任务入口，Composer 内配置区负责 Model / reasoning 能力说明 / Environment / Targets；正文渲染安全 Markdown 与可展开的工具/系统摘要，不改写 Ledger。TaskRail 聚合当前/后台 Run、待处理 Approval/Budget，历史审批、checkpoint 与 Workspace 在详情中渐进展开。
- **响应式**：`AgentHubWindow` 自身是 named container。`<=1180px` 收起 model meta，`<=1040px` 将 TaskRail 改为覆盖面板，`<=880px` 隐藏 Run history select，`<=760px` Threads 变 overlay drawer 且 Composer Configuration 可换行；Hub chrome 在 `<=900px` 隐藏 approval badge，在 `<=760px` 隐藏品牌块与 Conversation/Files 文字标签但保留图标和 App tabs。不得用浏览器 viewport breakpoint 替代上述窗口容器规则。
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

Custom Frontend 只能经 Nexus 同源提供的 `/sdk/frontend-v1.mjs` 建立 MessagePort SDK。第一阶段 SDK 只暴露 AppStorage 与 App-scoped AgentDefinition/Provider/Thread/Run/Subagent/Approval/Run-event 能力；其中 AppStorage 始终按 `userId + appId` 隔离，是已启用 App 的内建私有状态服务而不是 grant capability。iframe 不获得 Nexus cookie、CSRF token、HTTP client、数据库或内部 service object。

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

Provider 使用 OpenAI-compatible 配置模型，credential 加密保存且 API 不回填明文。`ProviderService` 是 Provider 配置应用服务：负责输入校验、CRUD/version、credential revision、模型 capability 解析、model discovery/test 编排，以及配置变化后的 Agent Host health 刷新；它不是模型 HTTP transport owner。当前 Provider endpoint 只做 URL/协议等基础配置校验，不提供 Nexus 内建的 Provider 私网例外、DNS pinning、redirect/SSRF policy。Provider discovery 请求读取上游 `GET <baseUrl>/models`，只把 model id（以及可选 owner/created metadata）当作候选事实，不把未定义语义的上游字段当成可信 capability。

Backend 的 `ModelCapabilityResolver` 统一解析模型物理能力。当前 Nexus Registry 可按已知/canonical model id 提供 `contextWindow`、`maxOutputTokens`、`supportsTools` 与 reasoning metadata；用户保存模型时只持久化相对 Registry 的 capability override。未知/私有模型如果没有完整的人工 capability，必须报 `MODEL_CAPABILITY_INCOMPLETE`，不能偷偷回退到固定 32K/4K。Provider live capability ingestion 仍是后续扩展，未交付前不得把普通 `/models` discovery 描述成 capability authority。

每个 Run 冻结 Provider configuration version、最终 model capability 与 reasoning effort。模型/Registry 能力在 Run 创建后发生变化，不得改写已有 Run 的 definition snapshot；下一次 Run 才使用新能力。模型物理 `contextWindow/maxOutputTokens` 只存在于冻结的 RunDefinition model capability / route snapshot，不再复制进 RunBudget。RunBudget 只保存 step/time/tool/recall/subagent 执行预算与冻结的 context policy；这些预算来自 User defaults + App-scoped execution policy，并受 System/User hard limit 约束。

OpenAI-compatible Provider 支持 `chat-completions` 与 `responses` 两种协议，由 Provider 配置显式选择。两种协议统一通过唯一的 `@ai-sdk/openai` `createOpenAI({ baseURL, ... })` 接入：Chat 使用 `openai.chat(modelId)`，Responses 使用 `openai.responses(modelId)`；Nexus 不再维护独立 Responses payload/SSE codec，SDK 的统一 `LanguageModelV4` stream 再映射为 Core `ModelEvent`。第三方 endpoint 仍必须真实兼容所选 OpenAI wire，不能因使用该 SDK 就假定任意第三方 API 自动支持 Responses。两种协议都不得透传 caller-owned/raw `prompt_cache_key`、Codex 专属 thread/turn metadata 或为了 cache 命中而扩散 provider-specific identity header；`ModelCacheHint.affinityKey` 仍是 provider-neutral routing hint。只有 frozen model capability `supportsPromptCacheKey=true` 且 endpoint 精确为官方 `https://api.openai.com/v1` 时，Adapter 才可把 `affinityKey ?? scopeKey`、provider/model/config 与稳定 prefix lineage 做不可逆、长度受限的 hash 后映射为 `promptCacheKey`；第三方 OpenAI-compatible endpoint 默认不发送该 vendor 字段。第一版不启用 `promptCacheOptions` 或 explicit cache breakpoint。Provider 双协议不等于恢复 Nexus 内建 DNS pinning、redirect/SSRF policy 或 private-host exception。

Core model input 还必须保持 cache-friendly 且与 Provider 无关：稳定 instructions（Nexus safety → 当前 scope 的 Repo Project Instructions → 已签名 Skill metadata）在前，append-oriented Ledger/tool chronology 随后，本轮 user input 再后，Goal/Plan/Collaboration/Recall 等易变 snapshot 放在尾部。`runId/attemptId/contextEpoch/credential revision/routing identity` 等控制面事实不得为了 cache 或诊断进入模型正文。Tool schema 要确定性 canonicalize/稳定排序；达到 step budget 时通过 `toolMode=none` 禁止新 Tool，而不是删除 schema 破坏前缀。长上下文使用冻结的 model-aware Normal/Extended policy：Normal 默认使用物理 input capacity 的 92% 作为 effective boundary、80% 作为 soft pressure；Extended 分别为 96%/88%。达到 soft pressure 后可提前 compaction，但下一次 inference 所需的最新完整 causal exchange 必须保留；模型可见 Tool result projection 会随 context pressure 收紧到冻结 floor，原始 ToolResult/evidence 仍完整持久化。长上下文压缩采用 generation boundary：一次生成稳定 summary 后开启新 generation，不得每轮重写旧 history。

Repo Project Instructions 第一版只认 Workspace 内的 canonical `AGENTS.md`。Runner 以 `/workspace/work` 为 logical work root，按目标路径向上寻找最近的 `.git` directory 或 worktree-style `.git` file 作为 project root；没有 repo marker 时只使用 work root。只加载 project root → target directory 的 progressive scope，deeper instruction 后置，不扫描 unrelated subtree。Project instruction snapshot 的 path/scope/projectRoot/source SHA-256/byte provenance 只作为当次 Context 的 transient source；它不进入 Memory，不成为 Ledger 或 ContextCheckpoint 的 business truth，也不获得 Tool approval、capability 或安全策略权威。源 hash 进入 stable instruction，因此文件变化通过既有 `stablePrefixHash` / cache lineage 自然失效，不建立第二套 cache invalidation owner。

上下文构建必须有界：

- context tokens；
- output tokens；
- Run total tokens；
- Run steps；
- active execution seconds；
- tool output/raw bytes；
- Recall items/bytes；
- Subagent message count/bytes；

预算不足时进入 `awaiting_budget`，用户可以通过 versioned increase-budget mutation 提升到 Hard Limit 以内。

Context checkpoint / summary 只是可验证的 derived state，不能吞掉尚未消费的用户输入、授权状态、approval 或 reconciliation 事实；canonical Ledger 与各控制状态 owner 继续 authoritative。

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

### 10.1 App capability 只表达跨资源安全边界

App grant 不再表达 Agent 本体是否“能运行”。模型调用、Run 生命周期、Skill/Plan、用户输入、内部 Subagent/协作都属于已启用 Agent App 的核心行为，不设置 `ai.model.use`、`runs.execute` 一类总闸门。App 自己的隔离 App Storage 也属于 App 生命周期内的私有状态服务，只受 App enabled/disabled 状态门禁，不要求额外 grant；Host/Tool 为当前 App 生成 Artifact output 同样不是独立权限，敏感边界在后续读取。

当前 capability 必须保持按真实资源边界划分，唯一集合为：

| 大类      | Capability               | 含义                                                                    |
| --------- | ------------------------ | ----------------------------------------------------------------------- |
| 文件      | `file.read`              | 读取、列举、搜索授权 Workspace/SSH target 的文件                        |
| 文件      | `file.write`             | 创建、替换、移动、严格 patch 授权 Workspace/SSH target 文件             |
| 文件      | `file.delete`            | 删除授权 Workspace/SSH target 的文件或目录                              |
| 主机      | `machine.inspect`        | 读取连接、系统状态与受控诊断信息                                        |
| 主机      | `machine.shell.execute`  | 当前 SSH Shell 执行权限；将在 Unified Shell 阶段迁到共享执行能力        |
| 主机      | `machine.docker.manage`  | 管理授权 SSH target 上的 Docker 容器生命周期                            |
| Workspace | `workspace.execute`      | 当前 Workspace argv / durable Job 执行权限；将在 Unified Shell 阶段收敛 |
| Workspace | `workspace.manage`       | 创建、启停、删除 Workspace 与切换工具链                                 |
| Browser   | `browser.read`           | 创建/读取浏览会话、导航、快照、截图、console、download 等读面           |
| Browser   | `browser.interact`       | click/type/press/select/upload 等可能改变远端页面状态的交互             |
| 外部集成  | `integration.mcp.read`   | MCP Resource/Prompt/只读 Tool 的发现与读取                              |
| 外部集成  | `integration.mcp.invoke` | 调用具有控制或修改效果的 MCP Tool                                       |
| 外部集成  | `integration.acp.invoke` | 调用外部 ACP Agent                                                      |
| 数据      | `artifacts.read`         | 读取当前 App 被授权可访问的持久 Artifact                                |
| 数据      | `app.intents.exchange`   | 通过声明的 AppIntent 跨 App 发送/接收数据                               |

Tool descriptor 是 capability 的唯一声明来源；Tool contribution 只负责模块注册，不再复制 capability 并制造双重配置。一个 Tool 若没有跨资源边界（例如 `skill_read`、Plan、内部协作），descriptor 可以没有 capability；有真实资源边界的 Tool 必须显式声明上表中的 capability。

Grant 使用 schema v2 typed scope。无 target 维度的 capability 使用 `{ "kind": "global" }`；文件 capability 使用 `{ "kind": "targets", "targets": ... }`，每个 target kind 的 selection 是 `all` 或明确的 `ids`。Host 的 `CapabilityRegistry` 是 capability identity、scope kind、supported target kinds、default scope、scope parser/intersection/restriction 和 concrete target authorization 的唯一权威。App grant Repository 只接受 schema v2；旧 durable scope 只在一次性数据库 migration 中被转换，runtime 不提供 compatibility decoder。

权限管理 UI 初次打开时必须用服务端**已保存完整 grants**初始化草稿，而不是只复制 capability 名称。Frontend 从 Host capability definitions 得到 scope kind、supported target kinds 与 default scope；本地只持有 label/icon/description。用户可为 `file.*` 分别启用 Workspace/SSH，并选择全部 target 或指定 target IDs。总控初态严格反映已保存状态；用户修改后按当前未保存草稿实时呈现三态，最终由“保存权限”统一提交 CAS；保存成功返回的新 grants 成为下一轮已保存初态。

模型单次 step 可以提出有界的 multi-tool batch。整批 proposal 必须先完成 inspection 并写入 durable lineage；可恢复的单项拒绝也必须持久化，不能因同批其他 Tool 合法而丢失。执行阶段只有 `read`、明确 `parallelSafe` 且 `resourceKeys` 不冲突的 Tool 可以小批并行；`control` 保持边界顺序，有副作用 Tool 继续遵守 approval、lease/fence、verify/reconcile 并按安全边界推进。Provider transport 不再强制关闭 upstream parallel tool proposals；上游可以返回一个或多个 Tool call，Nexus Runtime 仍以 durable batch、risk、resource conflict、approval 与 verify/reconcile 作为唯一执行权威。

## 11. Artifact、Memory 与文件交换

### 11.1 Artifact

Artifact 是 Agent 文件能力的统一持久边界：

- upload；
- Agent output；
- tool evidence；
- Browser download；
- Workspace exchange；
- plugin input/output。

写入遵循 reserve -> temp -> flush/hash/size -> atomic rename -> metadata commit。Artifact 容量与生命周期设置必须由真实 owner 消费，不能只停留在 Settings/UI：

- `storage.maxSingleArtifactBytes` 与 `storage.maxGlobalArtifactBytes` 由 `LocalArtifactStore` 的 effective storage policy 消费；requested value 先经既有 hard-limit normalization，再进入 reservation/global quota 判断。
- `storage.maxArtifactBytes` 是 per-Run linked Artifact quota，authority 位于 durable `agent_artifact_links` 写入边界。第一次把某个未删除 Artifact link 到 Run 时，SQLite trigger 按该 Run 已有 distinct Artifact bytes + 新 Artifact bytes 与**当前 effective setting**比较；同一 Artifact 在同一 Run 的 input/output/evidence/checkpoint 多 role 不重复计费。它不新建第二套 usage table，也不把 Library 中尚未 link 到 Run 的普通 Artifact 伪计入某个 Run。
- `storage.unretainedArtifactTtlSeconds` 在 Artifact 进入 ready 时冻结为 durable `expires_at`；retain 会清除 deadline，之后取消 retain 会按当时 effective TTL 从当前时间重新建立 deadline。旧 ready row 若历史上没有 deadline，bounded maintenance sweep 首次看到时按其 readyAt（无则 createdAt）+ 当前 effective TTL 补成 durable deadline。
- Artifact lifecycle sweep 复用既有 maintenance timer、`artifactProtectionReason` 与 `ready/unavailable -> deleting -> deleted` two-phase delete/reconcile；只回收已到期、未 retained、且没有 active Run/checkpoint/active grant/AppIntent grant protection 的对象。自动 TTL 不直接删文件，也不绕过 quota reconciliation。
- Workspace 当前没有足够准确的 activity authority：普通 read/search/argv/terminal 活动不会统一维护一个可信 idle timestamp。因此产品不暴露 `workspaceIdleTtlSeconds`，也没有基于不完整 `last_active_at` 的自动 idle cleanup；在出现单一可信 activity owner 前，不得重新加回这个“可配置但不生效”的设置。

跨 App 可见不等于跨 App 授权：普通 Artifact 读取要求 `artifacts.read`；跨 App 数据发送/接收要求双方拥有 `app.intents.exchange`；AppIntent 携带 Artifact 时还必须额外满足双方 `artifacts.read`。

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

Runner package：`packages/agent-runner`。Host 与独立 Docker 镜像使用同一套 runtime contract。Runner 是**可选增强能力**：核心 Nexus/Backend 在没有 Runner URL、Runner 未启动或 Runner 暂时不可达时仍必须正常启动并提供连接管理、SSH/基础 machine capability 等核心功能；Workspace Runtime availability 明确降级为 unavailable。Compose 中 Runner 通过显式 profile/部署配置启用，不把 `host.docker.internal` 或任何固定 Runner 地址写成产品默认硬依赖。

Runner 提供：

- availability/catalog；
- Workspace provision/start/stop/delete；
- durable native Workspace job start/query/server-side wait/cancel；
- Tool Store materialization；
- multi-version Node/Python/Go runtime switching；
- ACP stream；
- Workspace local direct PTY terminal；
- Browser tunnel；
- bounded Repo Project Instructions projection；
- bounded Workspace file stat/read/list/search/write/move/delete/strict patch primitives（由 Backend canonical File capability 调用）；
- bounded Workspace Repo Map / TypeScript-native code-intelligence projection；
- storage report；
- cleanup planning/execution；
- journal/reconcile。

Runner 永远不获得 host Docker socket、不启动 dockerd、不使用 nested Docker。独立 Runner 容器也不需要 `privileged`、`SYS_ADMIN` 或 unconfined seccomp/AppArmor；镜像只使用 `tini` 作为 PID 1 负责信号转发与孤儿进程回收，不把它当成 Workspace 隔离层。

Backend ↔ Runner 控制面统一使用至少 32 字符的 `NEXUS_AGENT_RUNNER_TOKEN` Bearer token，并要求 `X-Nexus-Agent-Protocol: 2026-09-13`；HTTP 与 WebSocket upgrade 在路由分发前使用同一认证。Runner token 代表该 Nexus 实例对 Runner 的完整控制权，不是 per-user credential，不能暴露给浏览器、日志或第三方 Plugin。

Runner wire 只传执行所需事实：`provision` 发送完整冻结 Workspace profile；`start/stop/restart/delete` 只发送 `workspaceId + generation`；Workspace job 只发送 generation 与执行参数；Repo Project Instructions 使用窄 `POST /v1/workspaces/:workspaceId/project-instructions` contract，只携带当前 generation 与最多 8 个 logical target directories，由 Runner 内部只读 resolver 读取当前 Workspace。该读取不借 `workspace_execute_argv` mutation Tool，也不是通用 filesystem API；live Workspace 不存在或 Runner 不可用时 Model Context fail-soft，不伪造 Repo rules。`userId/appId/runId/agentRuntimeId`、Backend optimistic `expectedVersion`、Agent operation hash 仍由 Backend 自己授权、持久化和 reconcile，不重复镜像到 Runner。

模型文件面使用统一 Host Tool family：`file_read`、`file_list`、`file_search`、`file_write`、`file_patch`、`file_move`、`file_delete`。所有 Tool 都要求 canonical `target + id`；Workspace 与 SSH 共享同一 descriptor/capability/inspection/operation-hash/precondition 语义，再由 `FileCapabilityService` 路由到对应后端。read/list/search 使用 `file.read`；write/patch/move 使用 `file.write`；delete 使用 `file.delete`。Read Tool 是 read risk 并可进入 plan mode；mutation/destructive Tool 在 plan mode 不暴露，execute mode 继续走现有 policy/approval、operation hash、mutation lease、outcome/finalization owner。`workspace_execute_argv` 暂时继续作为 build/test/git/package-manager escape hatch，直到 Unified Shell 阶段收敛。

Workspace 的实际文件 authority 位于 Runner `workspace-coding-files` owner，不复用/扩张 Project Instructions resolver。logical root 固定为 `/workspace/work`，path traversal 与 symlink fail closed；read 投影 bounded UTF-8 range 并返回完整源文件 SHA-256/size；list/search 有明确 entries/files/bytes/results/context/output 上限；write 使用 expected SHA-256/null creation precondition；move/delete 冻结 source/destination metadata；Patch 使用 `diff@9.0.0` unified-diff parser/apply engine，要求 frozen source SHA-256、精确 declared hunk location 与 `fuzzFactor=0`，不调用 shell `git apply`。SSH 侧通过受限 SFTP/file adapter 提供同一语义，并继续受 SSH target fingerprint、configuration hash、敏感路径规则与 denylist 约束。成功 mutation 由真实 resulting SHA-256/metadata 验证，不另建第二个 change journal/truth owner。

Repo Map/code-intelligence 仍是 Workspace-only 的只读导航能力，但授权统一消费 `file.read`。Runner owner `workspace-code-intelligence` 不成为代码事实源或 mutation authority；`workspace_repo_map` 返回 bounded TypeScript/JavaScript file SHA-256、imports 与 symbol signatures，`workspace_code_intel` 提供 `symbols | definition | references | diagnostics`。索引是可重建 cache，绑定 `workspaceId + generation` 和 source/config hashes；未支持语言明确返回 `file_search` + `file_read` fallback。编辑前 authoritative content 仍必须来自真实 canonical file read，所有 mutation 继续由 canonical file mutation或执行能力治理。

Workspace command 的长任务生命周期继续只由 Runner 已有 durable Job Journal 持有，不另建 Backend job queue。`workspace_execute_argv` 新调用可显式选择 `mode: foreground | background`，省略时默认 `foreground`；P-073 之前已持久化、没有 `mode` 的旧 Tool inspection 在恢复执行时同样按 foreground 处理，不改写旧 operation hash。foreground 仍向模型返回 terminal command result，但 Backend 不再每约 250ms GET poll；`RunnerHttpAdapter.invoke()` 提交后只调用 Runner 的 server-side `POST /v1/jobs/:jobId/wait`。background 在 Runner 已把 job 写入 durable journal 后立即返回 `jobId/workspaceId/generation/status`，该 Tool mutation 的提交 outcome 是 confirmed，但 verification 必须保持 unverified，不能把“后台任务已接受”伪装成“命令已成功完成”。

`workspace.execute` capability 下提供一个 `workspace_job` control Tool，只包含 `status | wait | cancel`；它不为 list/log/tail/wait 各造 Tool，也不暴露 host PID。Tool inspect 先查询 durable job，再用 Backend Workspace repository 验证该 stable Workspace 仍属于当前 `runId + agentRuntimeId`；job 自己冻结的 generation 保持 provenance，即使 Workspace 后续切到新 generation，旧 job 仍只能以旧 generation 身份查询。status/wait/cancel result 的 stdout/stderr 只投影 bounded UTF-8 tail；只有 durable terminal zero-exit result 才是 verified execution evidence，pending/running 只 unverified，cancelled/failed 不得计为成功验证。Completion Gate 因此可由后续 `workspace_job` terminal evidence 满足 test/build/check 要求，而 background launch 自身不能提前放行。

Runner 仍复用每个 Workspace generation 的原生 process-group/AbortController owner：`workspace_job cancel` 请求取消当前 job 并等待 journal 确认 `cancelled`；Workspace stop/restart/delete 继续按 generation 中断在跑 job。由于 background Tool 返回后 Backend mutation lease 已结束，第一版用**同一个 Runner durable job journal**做 fail-closed single-writer guard：一个 generation 存在 pending/running argv job 时，拒绝第二个 argv job 与实际 `file_patch` Workspace mutation，但 read/search 与 patch inspection/dry-run 仍可继续；这不是第二套 lock/journal。Runner restart 的既有 reconcile 仍把无法证明 outcome 的遗留 running job 标为 unknown。第一版不增加 Scheduler/EventHub 自动 job-terminal wake；模型可在后台任务运行期间继续 read/search，需要结果时发一次 `workspace_job wait`，wait 在 Runner server-side 完成，不要求模型 busy-poll。

### 12.4 单用户 native Workspace Runtime

Nexus 当前是单用户应用。Workspace/Generation/Toolchain 的职责是组织项目数据和运行环境，而不是在同一个 Nexus 用户内部构造 OS 安全沙箱：

- Workspace 项目文件持久且彼此独立；
- Generation 冻结一次 Workspace Profile/runtime 选择；
- Node/Python/Go Tool Pack 全局不可变共享，通过当前 generation 的 PATH 选择；
- `/workspace/deps`、`/workspace/build` 等逻辑路径映射到按 toolchain fingerprint 分区的 Runner data root；
- job、ACP、Terminal 和 Runner Plugin 都是 Runner 原生子进程；job/ACP/Runner Plugin 由独立 process group 管理并随 owner 生命周期整组回收，Terminal 使用真实 PTY foreground process group 处理交互 signal；
- Host Runner 子进程共享宿主安全上下文；Docker Runner 子进程共享同一个 Runner 容器安全上下文；
- Workspace Profile 不提供伪资源配额或伪网络白名单字段；Agent Hard Limits、Browser/MCP 等实际存在的网络边界仍由各自 Backend owner 执行，不冒充 per-Workspace cgroup/network namespace，也不把 Provider transport 描述成拥有 Nexus 内建 outbound policy；
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

外层 `acp_execute` 仍经过 Nexus capability / policy / approval / lease / StateCommit；outer approval（包括 Full Access 下自动满足的 outer gate）不能静默授权 remote agent 后续选择的 ACP inner action。`client.session.requestPermission` 必须复用同一 `agent_approvals` durable owner 与现有 Approval UI，以 `acp_permission` kind 绑定仍处于 `running` 的 parent ToolCall、runtime、policy/input revision 与 parent operation hash；用户只做 `allow_once` / `reject_once` 决策。inner approval request/resolve 不改变 Run version、不得重新调度 outer Tool，也不得释放/替换正在续租的 mutation lease；只有 durable approval resolve 成功后，live broker 才把一次性 decision 续回原 ACP session/toolCall。rawInput 不落 Ledger/approval 原文，只保留 bounded title/kind、rawInput bytes/hash 等 inspection projection。等待受 outer Tool deadline/Approval TTL 约束；timeout/abort 返回 reject 或中断，Backend restart 无法恢复 live ACP session 时继续沿既有 active-mutation quarantine/interrupted/reconciliation 与 approval supersede 路径 fail closed，不伪造 completion。

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

MCP Integration 的 `enabled` 只表示配置被启用，不等于远端当前可调用。Host 维护轻量 runtime health projection：`idle | refreshing | ready | error`，并暴露 bounded `lastErrorCode`、最近尝试/成功时间与下次 retry 时间。只有当前 durable integration version + credential revision 的 refresh 通过 schema-hash CAS 后才进入 `ready` 并发布 Tool/Resource/Prompt contribution；refresh 失败会先移除当前 contribution，再由 lifecycle sweep 按有界 backoff 重试。disable/remove/version/credential generation 变化必须取消旧 generation retry，旧网络结果永远不能复活旧 schema。该 health 是可重建的 runtime projection，不成为第二套 Integration durable truth；Backend restart/user initialization 通过现有 `syncEnabled` 从 durable Integration 配置重新建立。

Agent Settings 必须提供 MCP management surface，至少允许配置 endpoint/credential、enable/disable、delete、显式 Refresh/Retry，并解释 Ready/Refreshing/Error/Idle；单个可选 MCP 的 error 只降低该 Integration capability，不把整个 Agent App 或无关 Run 标记为 unavailable。

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

Skill 目录采用单一来源规范：每个 Skill 必须且只能是 `skills/<slug>/SKILL.md`。`SKILL.md` 使用当前标准 frontmatter，至少包含与目录 slug 一致的 `name` 和非空 `description`；可使用 `license`、`compatibility`、`metadata`、`allowed-tools` 等标准字段。Skill `id` 由签名 App id 与 slug 派生，Skill `version` 由签名 Plugin package version 派生；不得再在 Skill frontmatter 中声明旧的 `id/version/requiredCapabilities` Nexus 私有结构。禁止再放 `skills/index.json`、独立 metadata 文件或单独 body 文件，避免索引与正文漂移。Host package verifier 会拒绝不符合这一布局的签名包。

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

动态 Frontend 资源通过 Nexus 主站同源 `/plugins/...` 与 `/sdk/frontend-v1.mjs` 提供，但 iframe 继续使用 `sandbox=allow-scripts` 且不授予 `allow-same-origin`，因此 Plugin JavaScript 保持 opaque origin。Plugin 只经 bounded MessagePort 调用显式 SDK；Frontend container 不挂载插件 storage，也不向 iframe 暴露 Nexus session/CSRF/HTTP client。浏览器可见的 Plugin/SDK 不得重新拆成独立公网 Origin、独立子域名或额外公开端口；内部 handler 继续复用主 Backend listener 的正式路由/安全边界。

Runner plugin 通过独立 Runner protocol/lifecycle 执行。

### 16.3 第一方插件仓库与术语

第一方可分发插件源和签名发布流程由独立仓库 `0honus0/nexus-agent-plugins` 持有。

术语必须严格区分：

- **Host/Core**：随 `nexus-terminal` 主镜像编译发布的 Run/Scheduler、Capability Broker、Policy/Approval/Lease、Workspace Runtime bridge、Plugin verifier/installer/SDK 等安全与运行原语；修改这些代码需要更新主镜像。
- **first-party installable Plugin App**：由 Nexus 官方维护、独立签名和发布、通过正常 Plugin lifecycle 安装/升级的 App；它不是 compile-time built-in。
- `nexus.agent`：当前默认推荐的 first-party installable Plugin App。它只提供一个通用 `agent.default` AgentDefinition，并在同一个签名包中提供 exactly two App-scoped Skills：`nexus.agent.operations`（Operations）与 `nexus.agent.developer`（Developer）。Agent 初次启用时 Host 从 pin 住 publisher 身份的 official catalog 读取推荐项，用户确认后按 `stage -> verify -> install -> grant -> enable` 正常流程安装；Operations / Developer 不再各自占用独立 App shell。
- `nexus.fullstack`：first-party target-composition reference Plugin App，显式声明 `frontend + backend + runner` 三种 target。Frontend 运行在主站同源 URL + opaque sandboxed iframe；Backend target 在 Nexus Backend 之外的独立 Node child runtime 中加载并通过 App Storage SDK 工作；该进程使用 Node Permission Model 限制插件包以外的文件访问、文件写入、child process、worker、native addon/WASI，但不宣称提供 OS namespace/network sandbox。Runner target 运行在冻结 Workspace generation 下，只拿 Workspace-local Runner SDK。它用于持续证明完整 target lifecycle，而不是把 Host/Core 权限迁入插件包。

Host-owned governed Tool implementations 仍属于 Core，因为它们是 Capability Broker 与真实 machine/workspace/runtime adapter 之间的受控执行原语；Plugin 只通过 manifest grants/AgentDefinition/Skill 使用这些 capability，不把 raw SSH/Runner/Browser authority 带进插件包。当前 manifest 与 Backend/Runner Plugin SDK/worker protocol 不存在 `AgentTool` descriptor/inspect/execute 注册 surface，Plugin Backend/Runner target 也不得直接向 `ToolCatalog` 注入 Host-authority function；外部动态 Tool 继续优先通过 MCP。若未来开放 Plugin 自定义 governed Tool implementation，必须单独定义 versioned Tool SDK/IPC、risk declaration、schema lifecycle、outcome/verification contract，并作为独立需求立项。这样 `nexus.agent` 的 AgentDefinition/Skills/版本以及 `nexus.fullstack` 的 target 实现可独立远程升级；若新插件要求 Host 尚不具备的新 capability/SDK/protocol，仍必须升级 Nexus 主镜像。

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
- layout restore/persist；
- Settings 操作失败通过统一 `useOperationFeedback` 写入结构化 logger，并同时显示右上角错误 toast。成功操作只显示短时成功 toast；操作失败 toast 默认常驻，直到用户显式关闭，避免错误码在定位前消失。字段级校验、资源本身的 loading/error 状态和危险操作确认仍可保留局部 UI，但不得再为普通操作结果复制模块顶部 success/error banner。

Backend 记录：

- Run create/input/interrupt/cancel/delete 与 durable state transition；Conversation create/rename/delete、Plan durable update、Approval resolve/fail-closed；Context checkpoint reuse/create/skip/commit failure；
- Settings patch/default initialization、hard-limit preview/confirm 与 CAS commit failure；
- App enable/disable/resume/health transition 与 App state CAS commit failure；
- Skill signed index build/search/read；索引失败记录安全 `errorCode`，不得记录 search query 或 Skill 正文；
- Tool proposal inspection、policy decision、lease acquire/renew/release、mutation quarantine/reconciliation；
- capability allow/deny 及 deny reason；
- Provider create/update/remove、model discovery/test/dispatch，以及 persisted change 后的 Host refresh failure；
- MCP integration create/update/remove/refresh/retry；
- Plugin stage/verify/install/upgrade/uninstall、drain、rollback、startup/runtime reconcile；
- Subagent scheduler/participant dispatch、completion notification、mailbox/lease 异常；
- Memory propose/review/import，以及 audit/hook 异常；Skill index/search/load 与 signed Skill 解析异常；
- Agent settings patch、hard-limit preview/confirm/default initialization 与 CAS commit failure；
- Workspace commands、reconcile、cleanup；Workspace↔Artifact import/export/stream close 异常与其它 critical state transition failures。

关键分发链的日志必须能用稳定 ID 串联一次失败：优先携带 `userId/appId/runId/runtimeId/workId/toolCallId/toolName/integrationId/stageId/delegationId` 中实际存在的字段，以及安全的 `errorCode/state/version/generation/count`。高频成功路径使用 `debug`，重要生命周期完成使用 `info`，可恢复/降级异常使用 `warn`，durable commit、rollback、quarantine 等完整性失败使用 `error`。不得为了“更详细”写入 prompt/message、credential、Tool command payload 或其它敏感正文。

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

Agent schema 已进入 `main`，从此数据库兼容按正式 `main` 升级路径维护。`sqlite-schema.ts` 描述新数据库的当前最终结构，`sqlite-migrations.ts` 维护已发布/已进入 `main` 的增量演进；当前 migration 已到 #24（Thread title ownership、Tool risk enum、durable multi-tool batch lineage，以及升级库的 source-model-step same-run 约束补强）。不得再以“旧 dev 数据库可重建”为理由跳过 `main` 数据迁移，也不得为尚未发布的临时分支状态堆叠无消费者的兼容 migration。

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

CI 保持最小化，只把能够直接证明仓库可交付的通用检查当门槛。完整 E2E 的 canonical evidence 必须来自 GitHub Actions 远程 runner：本地环境只用于单 spec、定向 smoke、日志复现和开发调试，不把开发机 Node/浏览器/端口/缓存状态当成完整回归或发布结论。

- Prettier 全仓格式检查；
- Backend、Frontend、Agent Runner production build/typecheck；
- 按 group 运行的真实产品 E2E；
- Docker/Runner 打包相关变更，以及 `main`、定时或手动全量运行时执行 deployment smoke；
- release 发布前仍执行 production dependency audit 与 Release gate。
- `Update dependencies` workflow 只负责 workspace 依赖更新、frozen install、格式、production build/audit 与创建/更新 PR；由于 `GITHUB_TOKEN` push 不会递归触发 workflow，updater 在更新分支后显式 `workflow_dispatch` 同一 canonical E2E workflow，不在 updater 内再维护第二套 Chromium/ingress/full-E2E 流程。

不要为 Agent 的每条内部约束继续增加一次性 CI checker。已删除的 package-management、E2E-only test-policy、Runner prerequisite 独立 gate 不再恢复；这些要求作为本文件/工程约束中的 review invariant，由正常 build、真实 E2E 与 Docker smoke 证明最终行为。新增专用 gate 只有在通用 build/E2E 无法观察到一个高风险不变量、并且确有持续回归证据时才考虑。

Agent 改动仍必须遵守以下 review invariant：

- 依赖解析只使用根 pnpm workspace/lockfile/catalog，不新增 workspace-local lockfile 或第二套 install flow；
- 自动化测试源码统一进入仓库根 `tests/`，生产 `packages/` 下不再放测试目录；用户可达 Playwright E2E 位于 `tests/e2e`，Agent deterministic integration scenarios 位于 `tests/backend/agent-scenarios`；不再把测试源码分散回 Module/Repository/Adapter 所在生产目录；
- Backend/Frontend 继续遵守既有 owner/layer/public API 依赖方向，新增 import 必须在 review 中检查跨层、feature 私有目录和循环依赖；不再用独立 architecture quality gate 代替架构审查；
- Agent 三个 locale fragment 的 key 与用户可见语义保持同步；新增/修改 UI 文案时同一改动更新 `zh-CN/en-US/ja-JP`，不再设置独立 i18n checker；
- Frontend 大依赖、编辑器/预览器等重资源继续按 route/feature 懒加载，异常 bundle 增长在变更审查中说明，不再设置独立 bundle-budget gate；
- Runner 镜像/宿主是否具备所需 runtime 以真实 standalone/container smoke 为准，不用单独的二进制存在性 quality gate 代替行为验证；
- GitHub Actions grouped E2E 使用长期 GHCR runner image 预装 Node/pnpm/Chromium，并按根 `package.json` + `pnpm-lock.yaml` + `pnpm-workspace.yaml` fingerprint 在固定 image path 预热 pnpm content-addressable store 与 supply-chain metadata cache；CI 实际拉取 immutable `fingerprint-*` image tag，避免并行分支争写版本 alias；matrix shard 只做 `pnpm install --offline` 链接依赖。依赖 authority 变化时重建一次 runner image，不在每个 shard 重新下载同一依赖；
- Provider 同时支持 Chat Completions 与 Responses，但 Provider 网络访问没有 Nexus 内建 private-host/SSRF policy；
- Agent mutation、StateCommit、approval/lease/reconcile、Plugin 签名与 scope 等安全不变量不得为了减少 CI 项而放宽；它们通过对应产品路径 E2E 与代码审查维持。

### 已决定、待实现

1. Provider live capability ingestion：只有语义明确且可验证的 Provider metadata 才能覆盖/补充 Registry；普通 `/models` discovery 仍不能猜 capability。
2. Suspended SSH session 的跨设备 takeover/owner lease 仍未形成正式状态机；现有 `prepareResume/commitResume/rollbackResume` 解决单次恢复事务，不等价于跨设备抢占。
3. 更完整的 `Agent UI -> Workspace create -> Runner execute -> visible UI result` 单路径产品 E2E。
4. First-party Plugin 发布前必须把 GitHub Actions `NEXUS_AGENT_PLUGIN_SIGNING_KEY_PEM` 与仓库 pin 的 official publisher public key 保持一致；生产 Host 只允许通过部署配置替换 catalog/mirror URL，不允许替换官方 publisher trust root。

## 24. 修改规则

后续 Agent 改动必须遵守：

1. 业务语义改变时，同时更新本文件和 Agent SRS。
2. 不再新建 `doc/architecture/agent/*`、Agent review/implementation/current snapshot 平行文档。
3. 只有当前事实进入“已交付”；roadmap 必须显式标记待实现。
4. 不恢复已删除的 legacy Agent Environment 数据模型；Runtime 环境以 Workspace Runtime contract 为唯一方向。
5. 不为 UI 便利复制 Run/Thread/Workspace/queue 的 authoritative state。
6. destructive operation 必须 preview/freeze/confirm/recheck/reconcile。
7. 不为可由 format/build/E2E 覆盖的规则增加专用 quality gate；特殊 Agent invariant 先更新本文件并在对应真实产品路径验证。
8. mutation unknown outcome 必须 fail closed。
9. 不记录隐藏思维链或敏感业务正文到诊断日志；Agent Core/HTTP/Scheduler 不直接 `console.*` 绕过结构化 logger 与字段约束。
10. 新增跨进程/持久化 JSON 边界必须先以 `unknown` 解析并做有界 runtime validation；禁止把 `JSON.parse()` 的结果直接泛型断言成领域对象来代替协议校验。
11. Agent 已进入 `main` 后，兼容层必须绑定明确的已发布数据/protocol 版本与删除条件；不得继续保留只服务历史 dev 数据或旧测试调用方的永久 shim。
12. multi-tool batch 不得弱化单 Tool 安全链：批量只改变 proposal/调度粒度，不改变 scope、policy、approval、resource conflict、verify/reconcile 的权威 owner。
