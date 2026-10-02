# Nexus Terminal 开发规则与 Agent 架构

本文是仓库开发约束与 Nexus Agent 长期架构的统一入口。开发前完整阅读；用户可见行为与软件需求只由 [USAGE.md](USAGE.md) 定义，通用实现边界见 [Frontend](architecture/FRONTEND.md)、[Backend](architecture/BACKEND.md)，验证流程见 [E2E](testing/E2E.md)，部署见 [DEPLOYMENT.md](DEPLOYMENT.md)。本文只记录有效规则与当前架构，不维护完成报告或独立需求清单。

## 导航

- [1. 项目所有者规则](#1-项目所有者规则)：逐条保留原意，新规则独立追加。
- [2. 通用开发规范](#2-通用开发规范)：修改、依赖、状态、UI、数据与交付。
- [3. Agent 定位与源码职责](#3-agent-定位与源码职责)：产品对象与模块 owner。
- [4. 界面与执行配置](#4-界面与执行配置)：全局 Hub、App 与冻结配置。
- [5. 执行状态与持久一致性](#5-执行状态与持久一致性)：Run、Ledger、输入、调度、恢复。
- [6. 模型上下文与预算](#6-模型上下文与预算)：Provider、能力解析与 Context。
- [7. 能力授权与安全执行](#7-能力授权与安全执行)：Tool、审批、lease、结果语义。
- [8. Workspace 与 Runner](#8-workspace-与-runner)：环境、文件、执行和生命周期。
- [9. Artifact、Memory 与集成](#9-artifactmemory-与集成)：文件交换、ACP、Browser、MCP。
- [10. Plugin 平台](#10-plugin-平台)：签名、SDK、安装与运行边界。
- [11. 诊断与交付验证](#11-诊断与交付验证)：日志、行为证据与发布门槛。

## 1. 项目所有者规则

本节优先于后续规范。每条规则独立生效，不通过改写其他条目改变原意；规则冲突时停止受影响的工作并询问项目所有者，不自行选择或合并。

1. 每次开发都必须遵守本文件的全部内容。
2. 项目所有者提出的新规则若更新或取代已有规则，应直接修改原条目，以最新明确要求为准，不保留重复或冲突条目；仅独立的新要求另行追加。
3. 发现本节规则相互冲突时，必须询问项目所有者如何处理，不得自行选择或合并冲突规则。
4. 处理问题清单时，一次解决一个问题；修改前先确认问题与修改方案，修复后同步更新相关文档、完成快速检查并单独创建本地提交，不自动推送，仅在项目所有者明确要求时推送已有提交。当前快速修复阶段不新增 E2E 用例。
5. 问题修复完成后，必须同步关闭或删除 `doc/` 中对应的未解决记录，不得保留已解决问题的开放状态或残余描述。
6. 自动化测试源码和测试专用 harness 必须统一放在仓库根目录 `tests/` 下，并按功能分类；生产包中不得新增分散的测试目录。
7. 可复用的开发、检查、构建、Docker 和 E2E 辅助脚本必须放在 `scripts/` 下，并按功能目录分类。
8. `tests/` 不得用读取源码文本、匹配字符串、检查 import 写法、统计文件行数或检查目录形状的方式充当架构和编码规范门禁。
9. 不得新增用于强制 AI 开发规范的自定义源码扫描质量门；这类开发约束写入本文件，由 AI 在修改和审查时执行。
10. 测试应验证可观察行为、公开 contract、真实状态变化或故障恢复结果，不得锁定内部实现文本。
11. E2E workflow 保持流程精简；仓库基础检查串行执行，真实产品 E2E 按既定项目拆分执行，Docker 部署 smoke 作为交付验证保留。
12. 所有修改除明确要求兼容的接口或数据外，均允许破坏式更新，须同步迁移全部消费者，不保留兼容别名、双轨入口或无消费者残骸；破坏式更新仍须限于当前任务，不擅自删除无关产品功能。明确要求兼容的部分保持既定 contract。
13. 无人消费的旧代码、脚本、检查、文档和引用关系应一并删除，不得保留兼容残骸或历史痕迹。
14. 修改代码时必须同步更新相关文档、命令、workflow 和引用，保证文档描述的是当前实现。
15. 提交前必须检查工作区残余、未跟踪文件、失效引用、未完成标记和对应远程检查结果。
16. 移动端的聊天、终端、文件管理器和其他可滚动交互面必须支持正常的纵向滚动与上下交互，不得由外层手势或遮罩错误拦截。
17. `ui` 组件是通用界面组件的正式入口；不得重新引入已退出的 `base` 组件层，也不得新增检查或文档去维护 `ui`/`base` 双轨结构。
18. 不得保留 image review、截图人工审核流程或其脚本、文档、配置和引用；产品截图只能作为文档或真实 E2E 产物使用。
19. 点击挂起会话不得立即关闭当前标签或终端；普通会话弱网续接只允许持有原恢复凭据的发起端，挂起会话则允许具有会话访问权限的任意设备恢复或确认接管，不要求原设备的普通会话恢复凭据。
20. 不使用或新增单元测试（unittest）；保留 E2E 测试、Agent 场景测试及 ESLint、类型检查、格式检查等静态检查，不得将 Agent 场景测试作为单元测试删除。
21. `doc/USAGE.md` 是实际软件需求与用户可见行为的唯一规范入口；Bug 修复和需求变更必须在同一提交同步维护对应内容，架构或 owner 变化同时更新 `doc/architecture/` 与适用的 `doc/AGENTS.md`，不得重建独立的软件需求登记体系。
22. UI 统一样式需求优先修改公共组件及其 foundation 样式 owner，使所有使用处同步生效；通用结构应组件化，不以全局覆盖、深层选择器或使用处补丁替代组件能力。仅在项目所有者明确允许时，才可对某个使用公共组件的 UI 添加局部样式补丁；业务布局仍由业务 owner 持有。
23. UI 生产代码不得新增或保留测试专用标记、属性、接口或 hook（包括 `data-testid` 和 TestId props）。删除前须核对消费者，确认没有产品逻辑或其他非 E2E 消费者；有真实行为用途的状态、语义、ARIA 和 `data-ui` 属性不得作为测试残骸删除。保留 E2E 与 Agent 场景测试，本次 UI 清理不修复 E2E 问题。
24. Workspace 保持独立、简单的项目与运行环境管理模块；保留 Node/Python/Go 支持版本 JSON 供用户选择，不限制具体上游构建来源，不维护预设安装树摘要或选择指纹；保留基本安装与版本检查、上游完整性校验和生命周期管理。
25. 仓库开发规则与 Agent 架构统一维护在 `doc/AGENTS.md`；合并内容并按职责精简分章，不再保留根目录 `AGENTS.md`。
26. OpenCode V2 项目规则文件使用大写复数文件名 `AGENTS.md`；本仓库规则位于 `doc/`，开发前须读取该目录规则，不假定它在仓库根目录会话启动时自动加载。

## 2. 通用开发规范

### 文档维护分工

项目文档统一放在 `doc/`，根 README 只保留项目简介与导航，不另建需求、review 或进度文件。

| 文档                  | 唯一维护内容                             | 同步时机                       |
| --------------------- | ---------------------------------------- | ------------------------------ |
| `AGENTS.md`           | 开发前必读规则、关键 owner 与安全不变量  | 开发规则或关键边界改变         |
| `USAGE.md`            | 当前功能、用户流程、限制、失败与恢复行为 | Bug 修复或需求变化，同一提交   |
| `architecture/`       | 模块职责、依赖、数据/协议与调用关系      | owner、contract 或实现关系变化 |
| `DEPLOYMENT.md`       | 安装、配置、升级与镜像发布命令           | 部署参数、命令或发布流程变化   |
| `testing/E2E.md`      | 验证命令、覆盖与交付判据                 | 测试入口、覆盖或 CI 流程变化   |
| `FEATURES.md`、README | 功能摘要与导航，不复制详细规范           | 功能入口增删或链接变化         |

维护顺序：先确认受影响的用户行为和真实 owner → 修改代码与对应文档 → 核对命令/路径/链接 → 用真实检查与行为证据验证。无变化的文档不机械更新，不用“已完成”记录替代当前事实。详细功能以 USAGE 为准，详细实现以 architecture 为准，本文只保留开发需要遵守的边界，不再建立重复清单。

### 2.1 修改与文档

- 修改前查看 `git status`、源码、公开 contract、测试与文档，确认真实 owner 和调用链；未知改动视为潜在用户工作，不覆盖或删除。
- 修复产生问题的 owner/边界，不放宽断言、复制状态或增加兼容分支掩盖问题。相邻独立缺陷先记录证据，不扩大当前任务。
- 删除或替换能力时核对代码、导出、package script、workflow、文档和测试消费者，同步清理失效引用。
- `doc/` 只描述当前需求、架构、使用和部署事实，不保留阶段 review、迁移完成报告、废弃方案或平行 Agent 架构文档。行为变化更新 USAGE，owner/contract 变化更新对应架构。

### 2.2 分层与依赖

- `packages/protocol` 唯一持有 HTTP、WebSocket 与 Runner wire DTO；adapter 直接使用规范名称，不重复声明或创建兼容别名。
- Runner wire 类型直接从 `@nexus-terminal/protocol/runner` 导入，HTTP/WebSocket 协议版本从 `@nexus-terminal/protocol/runner-version.json` 读取；本地 durable record 与授权 port 不成为 wire 类型的重复 owner。
- Backend 按 `shared -> platform -> modules -> interfaces/infrastructure -> bootstrap` 分工：Module 持有用例与 port，Infrastructure 实现 adapter，Interface 仅转换协议，Bootstrap 组装。Interface 不访问数据库或持有产品事务；业务模块不读 `process.env` 或依赖具体 Infrastructure。
- Frontend 分为 `app/features/runtimes/foundation/shared`；跨模块通过 `public.ts` 或 foundation `index.ts`，不深层导入私有实现。共享能力提升到已有公共 owner。
- Workspace 路由页面的跨 Feature 组合位于 `app/pages/workspace`，只通过 Feature 与 Runtime 的公开入口消费能力；Runtime 保留会话、布局、组件与 transport owner，不反向加载 App 页面。
- Workspace transport 由 adapter/session owner 管理；View/composable 不持有 HTTP、WebSocket、frame、重连、心跳或 backpressure。Agent 与 Workspace Runtime 通过公开 contract/capability 协作，不读对方私有状态。
- 根 pnpm workspace、lockfile、catalog 是唯一依赖 authority。

### 2.3 状态、并发与资源

- durable/mutable 状态只有一个 owner，前端 view state 不复制服务端事实。Vue 模块级响应式状态只存在于明确 store、registry/service 或工厂；`defineStore` 实例闭包持有生命周期状态。
- 异步结果用 generation、AbortSignal、CAS/version 防过期覆盖；旧请求不能清除新请求的 loading/error。
- 外部副作用使用稳定 operation identity、幂等、lease/outcome/reconcile；timeout 不等于确定失败，取消不等于回滚。
- listener、timer、进程、channel、句柄与临时资源由创建者关闭，等待必要 drain，保留安全诊断。破坏性操作遵循 preview/freeze/confirm/recheck/reconcile。

### 2.4 UI 与国际化

- 通用交互与材质由 `foundation/ui` 公共组件/token 持有，业务布局由 feature 持有；拆分同时承担 transport、持久化、跨域状态和展示的大组件。
- 用户可见文本进入 i18n，同步 `en-US/zh-CN/ja-JP` 并删除不可达 key；品牌、协议名、示例值可保持原文。错误码在边界映射稳定语义，再本地化。
- 验证桌面与手机主要流程，特别检查纵向滚动、触摸、虚拟键盘、safe area、drawer/modal 遮罩和固定区域的事件竞争。
- 控件有名称、状态与键盘语义；modal/drawer 管理焦点、关闭与背景交互；动画尊重 `prefers-reduced-motion`。

### 2.5 协议与数据

- 外部 JSON 使用 camelCase，数据库 snake_case 留在 repository/infrastructure 边界。
- HTTP/WebSocket/Runner/持久化 JSON 先以 `unknown` 解析并做有界验证，不用 `JSON.parse()` 类型断言代替 decode；领域层接收明确类型，边界映射规范 DTO。
- SQLite schema 描述当前新安装结构，migration 只升级已发布结构并支持可重入/故障恢复。兼容层必须绑定已发布版本与删除条件，不为历史 dev 状态保留永久 shim。
- SQLite 定义集中在 Infrastructure `database/schema/`，初始化顺序只由 `sqlite-schema.registry.ts` 持有；迁移定义位于 `database/migrations/`，全局编号／列表由 `migrations/registry.ts` 汇总，`sqlite-migrations.ts` 唯一执行。物理拆分不改变 SQL、已发布迁移或创建／升级顺序，消费者直接导入真实定义模块。
- 事务由真实状态 owner 建立；状态、事件、Ledger、幂等结果与 projection 在同一 commit boundary 内更新。Runner 执行冻结 generation/input，Backend 不失去 durable 产品状态权威。

### 2.6 测试、提交与发布

- `tests/e2e` 验证公开 HTTP/WebSocket/SSH/Agent/移动端/UI 行为；`tests/backend/agent-scenarios` 保留确定性 Agent 集成场景。回归断言输出、真实状态与副作用，不锁定实现文本。
- 低风险可逆文本/样式改动不增加测试；并发、持久化、权限、协议与恢复修复保留行为证据。类型、ESLint、格式或构建能发现的问题不编镜像测试。
- 本地运行受影响检查/构建/E2E；提交前运行 `pnpm run check`、`pnpm run format:all:check`、`git diff --check`。不加 sleep、扩大 timeout 或允许 flaky 掩盖问题。
- 提交描述单一完成事项；推送后检查对应 workflow 的日志/artifact。合并或发布前确认工作区、未跟踪文件、失效引用、未完成标记、版本一致与远程 E2E/Docker smoke，无被忽略的失败。

## 3. Agent 定位与源码职责

Nexus Agent 是全局智能执行层，不是独立 `/agent` 页面或 Workspace Terminal 包装层。不保存/展示模型隐藏思维链，只展示目标、Plan、动作、审批、Artifact、验证与结构化状态。

| 对象         | 职责与事实边界                                                          |
| ------------ | ----------------------------------------------------------------------- |
| App          | 能力、数据与插件隔离；服务端推导 `userId + appId`，浏览器不能覆盖 owner |
| Thread       | 长期 Conversation/Ledger；同时最多一个非终态 Root Run                   |
| Run          | 冻结模型/环境/目标、预算、计划、取消、验证与结果的执行边界              |
| AgentRuntime | 具体 Root/Subagent 执行实例，不等于 Run 或 Workspace                    |
| Workspace    | 独立、稳定的项目文件与运行环境                                          |
| Artifact     | 输入、输出、证据、下载与跨能力交换的持久文件                            |
| Plan         | 用户可见 durable task projection，不是内部 Step dump                    |

Backend Agent 的 Module 根为 `packages/backend/src/modules/agent/`：

| 目录                                  | Owner                                                          |
| ------------------------------------- | -------------------------------------------------------------- |
| `host/`                               | App registry/lifecycle、grant、settings、Plugin lifecycle      |
| `ai/`                                 | Provider、Context、Conversation、Artifact、Memory、Integration |
| `capabilities/`、`tools/host/`        | 授权/治理 contract 与 Host-owned Tool 实现                     |
| `workspace-runtime/`                  | 独立 Workspace 控制面与公开能力                                |
| `runtime/runs/`、`execution/`         | Run 生命周期与 Root 执行                                       |
| `runtime/scheduling/`、`planning/`    | 进程内 Root dispatcher、durable Plan                           |
| `runtime/recovery/`、`collaboration/` | checkpoint/resume、Subagent/mailbox/durable work               |

具体 adapter 位于 `infrastructure/agent/`；HTTP 边界位于 `interfaces/http/agent/`，事件边界为 `interfaces/websocket/agent-protocol.session.ts`，组装位于 `bootstrap/agent/`。

Frontend owner 为 `packages/frontend/src/features/agent/` 下的 `host/ai/runtime/files/settings/api/i18n`；Host 管窗口，API 管 transport。Runner package 是 `packages/agent-runner` / `@nexus-terminal/agent-runner`，不重新命名为 `agent-runtime`。

Agent App 的应用控制逻辑由实例级 `host/useAgentAppController` 持有，Surface 消费其状态和动作并负责展示／尺寸观察；异步订阅、缓存和 facade 清理由 controller 负责，不在模板组件复制 controller 状态。

## 4. 界面与执行配置

### 4.1 全局 Host 与 App

- 认证后唯一 `AgentSurfaceHost` 与路由生命周期解耦；切路由不销毁 Hub 或取消 Run。首次认证只出现 Launcher，不抢焦点；disabled 隐藏窗口但保留 Settings、历史、审计与清理。
- Hub 是 `role="dialog"`、`aria-modal="true"` 的 modal workbench。backdrop 阻断背景交互，点击只强调窗口；Host/window-manager 唯一持有 move、resize、minimize、maximize/restore、close、用户 geometry 与 viewport clamp。
- 一套 Host chrome 承载 App tabs/switcher；每个 App 保留自己的 Thread、draft 与 Next Run presentation。disabled App 从候选移除，离开 App 暂停 detail presentation。
- 默认 Threads/Conversation 两栏，TaskRail 按需展开；按 Hub named container 而非 viewport 适配。窄窗 Threads 用 drawer，TaskRail/Run Details 可覆盖，Composer 配置换行；审批入口与 Model 最小操作宽度不能丢失。
- Files Library 是用户级一级 view，不为每个 App 复制。Custom Frontend 只接管 App content，不接管窗口、认证或权限 UI。
- Agent 复用公共 UI；模型下拉使用 `UiSelect.fitContent`，模型卡片操作由 `UiActionGroup` 的 model 布局承载，不用 Agent 深层 CSS 覆盖公共组件。

### 4.2 Next Run 与 Active Run

Model、Environment、Targets 在无活动 Run 时是下一次选择；已有 Run 时只展示冻结的 `RunDefinition`。Frontend 保存 recipe 或 `No Workspace` 选择，创建 Run 携带 observed Catalog revision，Backend 校验 settings/Catalog 并解析完整 environment snapshot。

Run 冻结 Provider/model configuration、capability/reasoning、SSH `connectionIds`、policy/settings revision、可选 context boundary，以及 Recipe、Toolchain、Runner Plugin、ACP、Browser、retention。Run-aware `workspace_create` 只消费此 snapshot，不接受模型临时 recipe/toolchain；`No Workspace` 拒绝创建。独立管理 API 使用自己的管理 contract。

## 5. 执行状态与持久一致性

### 5.1 Run、Goal、Plan 与输入

- Run 状态：`created/running/awaiting_approval/awaiting_budget/cancelling/completed/completed_unverified/failed/cancelled/interrupted`；持有 usage/budget、Plan、goal/verification、input watermark、event cursor、version、reconciliation。删除终态 Run 仍须拒绝关联的未删除或 retained Workspace。
- `ai_thread_entries` Ledger 保存 `user_input/assistant_message/tool_result/system_notice`；前端列表、排序和搜索投影服务端事实，只保存 draft/scroll/selection。
- Goal 文本的 `text/revision/updatedAt` 与结果 `unknown/in_progress/satisfied/not_satisfied` 分离。Goal 更新重置 verification；streaming model 可 supersede，已开始 Tool/Approval 不回滚副作用。
- `RunPlan` 持有 schema/revision 与有界 `items{id,title,detail,status,dependsOn,evidenceRefs}`。`plan_update` 使用 CAS，检查 id 唯一、依赖存在、无自依赖/环；item 状态为 `pending/in_progress/blocked/completed/cancelled`。
- Composer 命令 `/goal`、`/plan`、`/interrupt`、`/queue`、`/queue remove`、`/queue move`、`/stop`、`/help` 与普通输入分离；未知命令不退化为 prompt，`//` 逃逸。空 Thread 的 `/goal` 用 `initialGoal` 建立 revision 1；`/interrupt` 仅事务确认 Root streaming 时接受，否则冲突，不取消已开始 mutation。
- `run.input` 在 StateCommit 内校验 scope/version/status、写 Ledger/Artifact/event、增加 input revision、supersede 过期 approval、更新 Host summary。streaming 通过 `NEW_INPUT` 在安全边界 supersede，不是整 Run cancel。
- Pending queue 从 Ledger + `input.pending_moved/removed` event + `consumedInputSequence` 派生，返回 bounded page、authoritative total/hasMore。mutation 用 stable input id + expected version，只改未消费投影，原 Ledger sequence 不删改；移除的输入不再进入 Context。streaming 时按 `NEW_INPUT` 处理。

### 5.2 StateCommit、事件与调度

- StateCommit 是 Run/Model/Tool/Approval/Subagent durable mutation authority；domain row、version、event、Ledger、Host summary、command/idempotency 与 runtime/work projection 同事务更新，不能先写一半再由 EventHub 补齐。
- StateCommit 恢复与 App 禁用转换集中在 `state-commit/recovery-transitions.ts`，接收 Adapter 当前事务；Adapter 持有事务与提交后通知，不在事务外另建 recovery mutation authority。
- HTTP 幂等身份为 `(userId, appId, commandName, Idempotency-Key) + request hash`，同 key 不同 payload 拒绝，unknown side effect 不自动重放。
- `/ws/agent` durable event 有 sequence、snapshot/cursor catch-up/repository replay；transient delta 无 durable sequence、断线可丢、不冒充 final message。transport 有 reconnect/backoff/backpressure 边界。
- Root `AgentScheduler` 是单 Backend 进程内 dispatcher，按 App 轮转并受用户 Runtime limits 约束；先 commit 再 enqueue。`NEW_INPUT/CANCELLED/AGENT_QUIESCE` 区分输入、取消和关闭。
- Subagent 使用 SQLite `agent_scheduler_work` durable CAS/owner epoch claim 队列（`queued/claimed/waiting/completed/cancelled`），与父 Run 共享预算/并发；depth、环、message bytes/count、TTL、backpressure、取消与父状态有界。
- Backend 重启将遗留 Root Run 收敛为 interrupted，不恢复旧 stack；checkpoint/resume 创建新 Run/Runtime/资源并重新授权，不复用旧 approval 或重放 mutation。checkpoint 不含 secret、live handle、active lease/mutation continuation，只含 Plan、watermark、evidence、冻结事实和安全恢复元数据。
- SQLite schema/migration 按已进入 `main` 的版本升级，不以 dev 数据可重建跳过迁移。多 Backend 需一并设计 leader/claim、owner epoch、lease/fence、幂等、恢复与事件顺序，不能仅替换 queue。

## 6. 模型上下文与预算

### 6.1 Provider 与能力

- `ProviderService` 管配置 CRUD/version、加密 credential revision、capability、discovery/test 与 Host health，不持有 HTTP transport；API 不回填凭据。配置只做基础 URL/协议校验，不声称 Provider transport 有内建 DNS pinning、redirect/SSRF policy 或 private-host exception。
- OpenAI-compatible `chat-completions/responses` 共用 `@ai-sdk/openai`，将统一 stream 映射为 Core ModelEvent；模型可覆盖 Provider 默认 protocol，test/execute/continuation 使用同一有效协议。
- `/models` 普通字段只提供候选 id，不能推断 capability。显式 `nexus_capabilities` schema v1 只允许已定义 context/output/tools/image/file/cache/reasoning 字段，类型、未知 key、非法 effort/容量 fail closed。
- `ModelCapabilityResolver` 优先级为 `manual > provider > registry`。Registry 来自 models.dev 持久快照，启动同步 3 秒、手动刷新 15 秒，无周期刷新；失败复用已有快照。未知模型不完整报 `MODEL_CAPABILITY_INCOMPLETE`，不静默回退 32K/4K。
- Provider observation 绑定规范 endpoint hash/content version，刷新不 bump configuration version；baseUrl CAS 更新原子清空旧 observation，校验真实 manual + Registry，不把旧 effective 值固化为 manual。Run 冻结最终 capability，变化只影响新 Run。
- 错误由 `providers/provider-error.ts` 与前端 `agent-api-error.ts` 分类，保留 HTTP/DNS/TLS/timeout/validation 及模型错误区别，不记录上游正文。

### 6.2 Context 与预算

- 稳定 instructions 按 Nexus safety → Repo instructions → signed Skill metadata 排序，再放 append-oriented Ledger/tool chronology、用户输入，Goal/Plan/Collaboration/Recall 易变快照置尾。控制面 run/attempt/epoch/credential/routing ID 不进入模型正文。
- Tool schema canonicalize/稳定排序；预算耗尽用 `toolMode=none` 禁新 Tool，不删除 schema。generation compaction 不每轮改写旧 history，保留最新完整 causal exchange；Tool 可见结果按 pressure 收紧到冻结 floor，原 evidence 完整持久化。
- Normal input boundary/soft pressure 为物理容量的 92%/80%，Extended 为 96%/88%。模型物理容量只在 definition/route capability snapshot；RunBudget 保存 step/time/tool/recall/subagent 与冻结 context policy，受用户/App 默认和 hard limit 约束。预算不足进入 `awaiting_budget`，versioned 增额不能超 hard limit。
- Context checkpoint 是 derived state，不能吞掉未消费输入、授权、审批或 reconciliation。Ledger 和控制 owner 仍 authoritative。
- 不透传 raw prompt cache key 或 Codex thread/turn identity。仅官方 `https://api.openai.com/v1` 且 frozen capability 允许时，将 provider-neutral hint、配置与稳定 lineage 有界 hash 为 `promptCacheKey`；第三方不默认发送，不启用 explicit breakpoint。
- 项目规则识别 `AGENTS.md` / `AGENT.md`，大小写不限（不同于本仓库规则入口）。Runner 按最近 `.git` directory/worktree file 定 Workspace project root，无 repo 用 work root；只加载 root→target scope。SSH 由 conversation-scoped project directory binding 明确根目录，经 file.read 授权和配置 hash 验证读取根→已探索子目录；Root/Subagent 使用统一 source，子 Agent 不越过 delegation grants。path/scope/hash/bytes provenance 是 transient Context source，不进入 Memory/Ledger/checkpoint，不获得审批或安全权威；源变化通过 stablePrefixHash 自然失效。

## 7. 能力授权与安全执行

### 7.1 Capability 与治理

Mutation 链：`inspect -> capability/grant -> policy -> approval -> lease/fence -> execute -> verify/reconcile -> durable settle`。hard deny 不可被 approval 覆盖；approval 绑定 operation hash，stale input/target/policy fail closed；unknown outcome quarantine，不自动 retry 或声称取消回滚。Read 仍受 scope/capability/network 边界。

| 资源边界   | Capability                                                  |
| ---------- | ----------------------------------------------------------- |
| 文件       | `file.read/write/delete`                                    |
| 命令与主机 | `shell.execute`、`machine.inspect`、`machine.docker.manage` |
| Workspace  | `workspace.manage`                                          |
| Browser    | `browser.read/interact`                                     |
| 外部集成   | `integration.mcp.read/invoke`、`integration.acp.invoke`     |
| 数据交换   | `artifacts.read`、`app.intents.exchange`                    |

Tool descriptor 唯一声明 capability。模型调用、Run/Skill/Plan/输入/内部协作、当前 App Storage 与生成 Artifact 是 enabled App 的核心行为，不增加 `ai.model.use/runs.execute` 总闸门。

Grant 仅 schema v2：无 target 用 global，`file.*`/`shell.execute` 用 typed targets（Workspace/SSH 的 all 或 ids）。`CapabilityRegistry` 唯一持有 identity/scope/parser/intersection/authorization；旧 scope 只通过一次性 migration 转换。UI 从服务端完整 grants 初始化，definition 来自 Host，本地只持有 label/icon；编辑三态 draft，保存 CAS 后才更新已保存状态。

### 7.2 执行职责与结果

- `GovernedMutationExecutor` 共享 Root/Subagent 治理顺序，包括 reinspection、approval、lease、unknown outcome、settle/finalization/recovery；durable transition 仍只提交 StateCommit。
- Root 分派由 `RootToolExecutionCoordinator`，read/control wave 与 read lease 由 `RootReadToolExecutor`，Root hooks/信号由 `RootMutationExecutionAdapter`。Subagent 的 Tool、Model、completion/mailbox/fail-fast 分别由 `SubagentToolStepExecutor/ModelStepExecutor/CompletionCoordinator`；Participant 仅 dispatch/inbox/join，不回吸职责或新建 authority。
- Multi-tool proposal 先 bounded inspection + durable lineage，拒绝单项也持久化；只有 read、parallelSafe、resourceKeys 不冲突可小批并行，control 顺序执行，mutation 不削弱单 Tool 安全链。
- execution identity 为 Run + Runtime + canonical target + revision + ToolCall/Job；Workspace 冻结 generation，SSH 冻结 configurationHash。execute 不重绑定“当前终端/SSH”。
- Completion Gate/checkpoint 只消费 durable `ToolResult.semantic`，不按 Tool 名猜成功；terminal zero-exit 才 verified，后台 accepted/running 仍 unverified，unknown/failed/cancelled 不计成功。遗留 split-shell 只由 migration 转换，不保留运行时 shim。

## 8. Workspace 与 Runner

### 8.1 环境与生命周期

- Runner 可选：未配置/未启动/不可达不阻止核心 Backend、连接管理、SSH 能力启动；availability 明确 unavailable。Compose 显式 profile 启用，无固定宿主 URL 硬依赖。
- Backend→Runner HTTP/WebSocket 统一 Bearer `NEXUS_AGENT_RUNNER_TOKEN`（至少 32 字符）与 `X-Nexus-Agent-Protocol: 2026-09-13`；token 是实例完整控制权，不暴露给浏览器、日志或 Plugin。
- provision 发送完整 profile；start/stop/restart/delete 仅 `workspaceId + generation`；job 发送 generation/参数。Backend 自己持有 user/App/Run/Runtime 授权、version、operation hash 和 reconcile，不镜像给 Runner。
- Runner Server 只持有 transport/route 边界；实例级 `RunnerCommandExecutor` 编排 command/job 与 Workspace 生命周期、工具链互斥及 Journal transition，复用现有 runtime 和 Journal，不在 Server 复制执行流程或持久状态。
- 单用户 native Runtime 组织项目而非 OS sandbox；generation 冻结环境，Workspace 文件独立持久。Host 子进程共享宿主上下文，Docker 子进程共享 Runner 容器，不用 Docker socket/dockerd/nested Docker/privileged/SYS_ADMIN/unconfined。
- Node/Python/Go 支持版本/架构保留在 `scripts/docker/agent-runner/catalog/catalog.json`；mise 按版本安装并做上游与实际版本检查，ref 仅 family/version，缓存按架构，不固定来源/安装树摘要/选择指纹。已安装不自动替换，使用中不可卸载。
- 全局共享不可变 Tool Pack，generation PATH 选版本；deps/build 按环境 profile 分区。版本切换仅重建目标 generation，终止其旧 process/session，项目文件与其他 Workspace 不受影响，不修改 `/usr/bin`。
- job/ACP/Plugin 原生 process group 随 owner 整组回收，Terminal 用真实 PTY foreground group。启用 Runner Plugin 等于允许以 Runner OS 权限运行；逻辑工作目录不是跨 Plugin ACL 或安全沙箱，不暴露伪 cgroup/network/quota 字段。
- cleanup：preview 冻结 workspaceIds → confirm → Runner recheck → deleted[] → Backend projection sync；不扩大范围，跳过 retained/active/job/session。journal 损坏保留原件与 evidence 并 fail closed，不能当空 journal 启动。

### 8.2 文件、执行与传输边界

- `FileCapabilityService` 只消费 WorkspaceFileTargetPort + SshFileTargetPort，`ShellCapabilityService` 消费对应 Shell ports；`AgentTargetResolver` 消费 SshTargetResolverPort。Workspace adapter 重检 Run/Runtime/generation，SSH adapter 冻结所选连接与 denylist/configuration。Machine port 只持有 connection/diagnostics/Docker，不建万能 facade。
- canonical `file_read/list/search/write/patch/move/delete` 显式 target/id。Runner `workspace-coding-files` 持有 `/workspace/work` 文件 authority，防 traversal/symlink，read/list/search 有 bytes/entries/results 上限；write 用 expected SHA-256/null-create，move/delete 冻结 metadata；patch 用严格 unified diff、精确 hunk、`fuzzFactor=0`，不 shell git apply。结果验证真实 SHA/metadata，不建第二 journal。
- `workspace_repo_map` / `workspace_code_query` 为 Workspace-only read navigation，使用 file.read；索引按 generation + source/config hash 可重建，支持 TS/JS symbols/definition/references/diagnostics，不支持语言回退 file_search/read。编辑前真实文件 read 仍 authoritative。
- `shell_execute` 显式 target/id/结构化 command：Workspace 为 argv、foreground/background/cwd，SSH 为 shell text、foreground/background，无 Workspace cwd。SSH 可选 sessionId 组合 `ssh_session_open/list/close`，后台任务必须指定长会话；会话按 user/App/Thread 隔离，每条命令使用独立 channel。两者共享授权与结果语义，不伪造相同 transport。
- Runner durable Job Journal 持有 Workspace 后台任务；AgentSshSessions 与 agent_ssh_jobs 持有 SSH 后台任务。后台 accepted 不等于完成；`shell_job_control status/wait/cancel` 先 concrete target 授权，Workspace 按 Job generation/Run/Runtime 控制，SSH 按 user/App/Thread 与会话配置控制。SSH 断线或重启收敛 unknown，不重放。
- 同 generation 的 pending/running argv job 阻止第二 argv 和实际 file_patch，允许 read/search/patch inspection；无第二 lock/journal。cancel 等 journal confirmed cancelled，stop/restart/delete 中断该 generation；restart 将无法证明结果的遗留 running 标 unknown。无自动 model terminal wake，需结果时 server-side wait，不 busy-poll。
- Repo instructions 窄 endpoint 仅 generation + 最多 8 个 target directory；Resolver 与文件 mutation owner 分离，Runner 不可用/live Workspace 消失时 Context fail-soft，不伪造 rules。
- Nexus `NXW1`、upload socket、Agent `/ws/agent`、Plugin `NXR3`、Runner streaming、Browser tunnel、local terminal 独立 owner/protocol/version/requestId/handle，只共享 bounded/backpressure 原则。

## 9. Artifact、Memory 与集成

### 9.1 Artifact 与 Memory

- Artifact 写入 reserve→temp→flush/hash/size→atomic rename→metadata commit；LocalArtifactStore 消费 effective 单文件/全局 quota，Run links 边界按 distinct bytes 检查 per-Run quota，同一 Artifact 多 role 不重复计费。
- ready 冻结 expiresAt，retain 清 deadline，取消 retain 按当时 TTL 重建；旧无 deadline 的 ready row 由 bounded sweep 补齐。到期回收复用 protection + two-phase delete/reconcile，不绕过 active Run/checkpoint/grant/AppIntent。
- Workspace 尚无统一可信 activity timestamp，不暴露无效 idle TTL/自动清理设置。Files Library 支持分页、预览、下载、retain/delete/cleanup 与附件选择。
- Memory candidate 与 published 分离，AI 不能跳过用户审核发布。跨 App Artifact 读取须 artifacts.read，发送/接收还须双方 app.intents.exchange，不把可见当授权。

### 9.2 ACP、Browser、Terminal 与 MCP

- ACP profile 冻结，外层 acp_execute 走同一治理；outer approval 不授权 inner action。`client.session.requestPermission` 使用同一 durable approval owner，绑定 active Tool/Runtime/revisions/operation hash，用户 allow_once/reject_once；不改 Run version、重调度或替换 lease。rawInput 只保留 bounded projection/hash，timeout/abort/restart fail closed，不伪造 completion。
- Browser target 冻结，受控 gateway/tunnel 不暴露任意宿主 CDP。唯一 `BrowserSessionBindingAuthority` 持有 target/config hash/session scope、inspection/revalidation；gateway/service 持有真实 session/process。stale generation/target 先关闭后 fail closed，无关 settings revision 不误关；网页不可信，下载先落 Artifact。
- Workspace local Terminal 用 Runner direct PTY open/resize/write/detach/reattach/bounded replay，不复用 Remote SSH live session；系统 script(1) 分配 PTY，Backend 管 attach/replay，浏览器仅连受认证 WebSocket。
- MCP 配置 enabled 不等于 ready。health 为可重建 `idle/refreshing/ready/error` projection；version/credential generation 的 refresh 经 schema-hash CAS 才发布 contribution，失败先撤销，再 bounded backoff；disable/delete/version 取消旧 retry，restart 从 durable config 重建。
- MCP UI 提供 endpoint/credential、enable/delete/refresh 与 health，不让单个可选 MCP error 拖垮 App。MCP/Browser 网络边界要求 public HTTPS、精确 private allow、metadata/link-local hard deny、连接前后防 DNS rebinding/redirect；外部安全声明不覆盖本地 policy，不将此边界虚构给 Provider transport。

## 10. Plugin 平台

- Package 校验 manifest/allowlist/SHA-256/Ed25519/traversal/symlink/device/archive bomb/size；stage 位于 `agent/plugins/.staging`，验证后入 `agent/plugins/<appId>/versions/<version>` immutable scope。每 App 一条 current installation，同 App upgrade/drain，不伪装并存版本。
- Skill 唯一来源 `skills/<slug>/SKILL.md`，标准 frontmatter 的 name 对应 slug、description 非空；id 派生自 App/slug，version 来自 package，不用旧 Nexus 私有字段或独立 index/body。签名覆盖 package/version，files.json 固定每 Skill hash；Context 只发 metadata，skill_read 时复验并 bounded 读取正文。
- Plugin Frontend 主站同源资源 + `sandbox=allow-scripts` opaque iframe，不授予 allow-same-origin；只走 `/sdk/frontend-v1.mjs` bounded MessagePort，不拿 cookie/CSRF/HTTP client/内部 service，不拆独立公开 Origin/端口。
- Backend target 不在主 Backend eval/import，独立 Node child Permission Model 限制文件/写入/child/worker/native/WASI，但不冒充 OS/network sandbox。Runner target 在冻结 generation 下通过本地 SDK 执行。
- Host/Core 持有 Run、Broker、Policy/Approval/Lease、bridge、verifier/SDK 与 governed Tool；Plugin 无 Host-authority Tool 注入接口，外部 Tool 优先 MCP。扩展需明确 versioned SDK/IPC/risk/outcome contract，不借动态 target 获得 raw authority。
- 第一方源码与签名发布归 `0honus0/nexus-agent-plugins`；`nexus.agent` 是可安装 App，含 agent.default 与 Operations/Developer 两个 Skill；`nexus.fullstack` 是 Frontend/Backend/Runner 组合 reference。主仓只持 protocol/installer/permission/host/runtime/自包含 fixture，不依赖外仓在线做普通 E2E。
- 官方 catalog 可镜像，publisher pin 不由普通生产变量替换；签名前核对同一 identity。官方 stage 使用 pinned source，额外 repo 显式 trust；仅 test/E2E 可注入 publisher。catalog/manifest 双重检查 SDK major/Nexus min/maxVersion，已安装重新启用优先本地，不重置 grant。
- `PluginInstallService` 薄 facade，PackageInstallCoordinator 管 trust/stage/verify/transaction/drain/CAS/rollback，RuntimeLifecycleCoordinator 管注册/reconcile/target/runtime，DataManager 管 retained storage/intents/snapshot。复用原 repository/authority，保持 stage reconcile 先于 installed reconcile 及 drain/migration/rollback/cleanup 顺序。

## 11. 诊断与交付验证

### 11.1 日志与反馈

- Core/HTTP/Scheduler 通过结构化 logger，不用 console 绕过字段约束。记录生命周期、state commit、policy/approval/lease、Provider/MCP/Plugin、Subagent、Workspace、Artifact、reconcile 等真实边界。
- 用现存 user/App/Run/Runtime/ToolCall/Job/work/integration/stage/delegation ID 串联；仅记录 state/version/generation/count/bounds/duration/errorCode，不写 prompt/message、credential/token/cookie、正文、command payload/argv/cwd 或对象 dump。
- 高频成功 debug，生命周期完成 info，可恢复降级 warn，commit/rollback/quarantine 完整性失败 error。上游、Skill 与 Browser 异常只记录安全 error code。
- Frontend 记录 Host/window/App/stream 生命周期；设置失败由 useOperationFeedback 同时 logger + 常驻可关闭 error toast，成功短 toast。字段校验、资源 loading/error 和确认仍局部显示，不复制顶部结果 banner。

### 11.2 行为证据与交付

- canonical E2E 使用 Node 24；基础 check/format/build 串行，七个 Playwright 项目按耗时分片（默认 8，手动 6–10），构建统一/Runner 镜像后运行 standalone、core-without-Runner、full deployment smoke。依赖更新触发同一 workflow。
- 等待真实业务终态，不把按钮、socket 关闭、HTTP 返回视为完成；挂起恢复看 ownership，终端快照先真实 shell 往返。自动清理持续验证剩余记录终态或空态，“取消中”不是完成。
- UI E2E 用可访问 role/name/label 与真实状态，不恢复生产测试标记；几何/滚动验证不锁定实现文本。
- 挂起日志物理压缩缓冲不扩大公开历史：read/offset/export 仍限最近 100MiB；分批压缩是摊销优化，不宣称 append 严格 O(1) 或任意输出率不积压，状态仍由 Workspace/Backend owner 持有。
- Provider/Runner/Plugin/mutation/approval/lease/reconcile/JSON fail closed；签名、scope、版本切换、drain、恢复通过真实产品、Agent 场景与 smoke 验证，日志保持 bounded/redacted。
