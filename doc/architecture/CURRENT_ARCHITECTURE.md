# Nexus 当前架构基线

> 状态：Current implementation snapshot
>
> 日期：2026-09-13
>
> 分支：`dev`
>
> 本文件是当前源码架构的单入口快照，不替代详细规范。Backend 放置规则见 [BACKEND.md](BACKEND.md)，Frontend 放置规则见 [FRONTEND.md](FRONTEND.md)，Agent 架构与当前接线规范见 [../AGENT.md](../AGENT.md)。强制工程约束仍以 [Engineering Constraints](../software-requirements/engineering-constraints.md) 为准。

## 1. 整体结构

```text
Browser
├─ AppShell / Dashboard / Settings
├─ Workspace runtime
│  ├─ Terminal
│  ├─ Filesystem / Editor / Preview
│  ├─ Transfer / Upload / Archive
│  ├─ Status / Docker manager
│  └─ Suspend / Resume
├─ Remote Desktop presentation
└─ Agent Surface Host
   ├─ generic Host Agent surface for installable AgentDefinition Apps
   ├─ Conversation / Task / Approval / Artifact / Workspace Runtime UI
   ├─ default first-party installable nexus.agent (Operations + Developer Skills)
   ├─ first-party nexus.fullstack target reference App
   └─ isolated Plugin frontend iframe
            │
            ├─ HTTP / SSE
            ├─ Workspace WebSocket / upload WebSocket
            └─ Guacamole WebSocket
                     ↓
Backend Interfaces
            ↓
Backend Modules
├─ Workspace / SSH Suspend / Connections / existing product modules
└─ Agent
   ├─ Host
   ├─ AI
   ├─ Capabilities
   ├─ Host Tool contributions
   ├─ Workspace Runtime
   └─ Runtime
            ↓ typed ports
Platform capabilities
├─ execution
├─ filesystem
├─ docker
├─ diagnostics
└─ operations / mutation guard
            ↑ adapters
Infrastructure
├─ SSH/SFTP / database / backup / notifications / Guacamole
└─ Agent repositories / providers / artifacts / integrations / runner adapter
            │
            └─ authenticated Controller HTTP
                         ↓
                 nexus-agent-runner
                 ├─ Workspace Runtime Manager
                 ├─ Pack Manager
                 ├─ Plugin Workspace Store
                 ├─ Plugin Runner Host
                 └─ Workspace generations / runtime profiles
```

核心依赖方向保持：`Interfaces → Modules → Platform contracts ← Infrastructure adapters`，只有 Bootstrap 组装具体实现。Modules/Platform 不直接依赖 Express/WebSocket/ssh2 等技术包；Frontend feature 不反向依赖 runtime/app owner，跨 feature 只能走 public surface。

## 2. 三类独立 runtime owner

### 2.1 Nexus Workspace runtime

Workspace 是用户交互式 SSH 工作面的 live owner。它拥有 connection/session binding、reconnect、terminal、SFTP capability adapter、layout/session presentation 和 suspend handoff。Terminal/FileManager/Editor/Preview/Transfer 等 feature 只依赖 typed capability port，不自己创建 Workspace socket 或直接持 SSH client。

Workspace mutation 通过共享 `MutationGuard` 进入受控资源写入；Workspace 可以和 Agent 复用底层 Platform filesystem/execution/docker 能力，但不共享 AgentRuntime、Runner workspace、Approval 状态或 Agent 的执行身份。Lease provider 是共享的资源冲突原语：Agent mutation 继续获取 connection/target 根 write lease；Workspace 对 upload/compress 这类可证明唯一写目标的长操作使用 connection 根 read + canonical remote file write 的 mixed-mode claim，不同文件可并行、同文件互斥，并仍与 Agent 根 write 冲突；写集合较宽的 Workspace 操作继续拿根 write。所有 mixed claims 在单事务原子获取，未知结果同时 quarantine 协调根与精确写资源。

### 2.2 Remote Desktop runtime

RDP/VNC 的业务 session/ticket 与 Guacamole runtime 分离。浏览器只拿短期、单次、绑定用户的 opaque ticket；统一 Backend WebSocket 边界校验身份/Origin/会话后交给 Infrastructure Guacamole runtime，真实连接凭据不进入浏览器 ticket。`guacd` 是独立原生协议服务，不成为业务状态 owner。

### 2.3 Agent runtime

Agent 是独立 App/Runtime 平台，不是 Workspace 的“自动化模式”。稳定模型为：

```text
App
└─ Thread
   └─ Run
      ├─ AgentRuntime 1..N
      │  └─ Step 1..N
      ├─ PlanProjection → PlanItem[]
      ├─ Approval / Lease / Checkpoint
      ├─ Workspace / Profile / Generation
      ├─ Artifact
      ├─ Mailbox / SharedFacts
      └─ durable events / ledger
```

`Run` 是任务、预算、取消、结果和恢复边界；`AgentRuntime` 是 participant identity；`Step` 是 loop progression boundary；`PlanItem` 是用户可见 durable plan projection，不能与 Step/Workflow node 混为一体。Resume 从 checkpoint 创建新 Run/新执行身份，不复活旧执行栈或旧 lease。

## 3. Agent Backend owner

当前 Backend Agent 源码固定在：

```text
packages/backend/src/modules/agent/
├─ host/
├─ ai/
├─ capabilities/
├─ tools/host/
├─ workspace-runtime/
├─ runtime/
│  ├─ approvals/
│  ├─ collaboration/
│  ├─ definitions/
│  ├─ events/
│  ├─ exchange/
│  ├─ execution/
│  ├─ planning/
│  ├─ recovery/
│  ├─ runs/
│  └─ scheduling/
```

职责边界：Host 负责 App lifecycle/grant/SDK/AppStorage/Plugin lifecycle；AI 负责 Provider/Conversation/Context/Artifact/Recall/Memory/Integration；Capabilities 负责授权、Policy、Approval/Lease 接入和 Tool Catalog contracts；`tools/host` 是允许跨 AI/Runtime/Workspace Runtime 依赖的 Host-owned governed Tool implementation/contribution 层，但真实副作用仍必须经过 Capability Broker/Policy/Approval/Lease；Workspace Runtime 负责稳定 Workspace、Profile/Generation、Tool Store/Runner 控制用例；Exchange 是 Workspace↔Artifact 的显式桥接层；Agent Runtime 负责 Run/participant/plan/scheduler/event/recovery/collaboration。Operations 的 AgentDefinition/Skill/App manifest 已从主镜像移出，改由 first-party installable Plugin 提供。

Tool Catalog 使用 `CapabilityContribution { id, capability, tools[] }`。Target 只回答“代码在哪里运行”，Capability 才回答“允许做什么”。LLM、Plugin、MCP、Subagent 都不能直接形成真实副作用旁路。

## 4. Agent Frontend owner

当前物理结构收敛在一个明确的 Agent feature owner 内；Host、AI presentation、Files、Runtime、Settings 与 Plugin surface 都按子域放置，不另建平行顶层 App/AI package：

```text
packages/frontend/src/features/agent/
├─ host/             AgentSurfaceHost / Hub / Launcher / Plugin bridge
├─ api/              typed HTTP/SSE client
├─ ai/               conversation presentation
├─ files/            Artifact Library / picker
├─ runtime/          Run/Task/Approval/Subagent/Workspace Runtime projection
├─ settings/         Agent settings contribution
└─ plugin-sdk/       Custom Plugin Frontend MessagePort bridge/SDK dispatcher
```

`nexus.agent` 是默认 first-party installable Plugin App，不是 compile-time built-in。它复用 Host Agent surface，只注册一个通用 `agent.default` AgentDefinition，并在同一签名包内提供 `nexus.operations` / `nexus.developer` 两个 Skill，因此 Operations / Developer 不再产生两个重复 App shell。`nexus.fullstack` 是独立 first-party target reference App，显式覆盖 isolated frontend、native Backend child 和 Workspace Runner target。Agent 初次启用时 Host 通过 pin 住官方 publisher 身份的 catalog 推荐 `nexus.agent`，用户确认后按正常 Plugin lifecycle 安装/授权/启用。单用户 Host 仍可同时持有多个不同 `appId` 的安装式 Plugin；同一 `appId` 的版本变化走 upgrade/drain。`features/agent/plugin-sdk/` 通过 bounded MessagePort 提供 App-scoped SDK，不加载 arbitrary same-origin plugin JavaScript，也不暴露 Nexus session/HTTP client。 Official catalog package entry 同时声明 `sdkVersion` 与 Nexus compatibility range；Host 先做 catalog-level compatibility preflight，再由 signed manifest 做最终校验。已安装推荐 App 的后续 enable/disable 不再依赖 catalog 请求，因此网络故障不会触发重装或 grant 重置。

Frontend architecture checker 已约束 `host/api/ai/files/runtime/settings/plugin-sdk/public` 子域依赖，并继续禁止 feature 反向依赖 Workspace runtime。

## 5. Runner / Workspace Dev Environment

`nexus-agent-runner` 是独立的 Workspace/runtime 执行平面，但**不是 Docker controller，也不是多租户安全沙箱**。Nexus 当前是单用户应用，Runner 的正式模型因此收敛为“多个持久 Workspace + 可切换运行环境”：

- 一个 Workspace 是稳定的项目/代码/文件系统边界；Node、Python、Go 等只是该 Workspace 的 Toolchain 选择，共享同一份 Workspace 文件；
- Workspace Profile 冻结工具版本、Runner Plugin、ACP Profile、Browser Target 与 retention；Generation 是该 Profile 的一次运行实例，稳定 identity 始终是 Workspace；
- 全局 Tool Store 以 `familyId/versionId/contentDigest`（digest 按 arch 解析）保存不可变工具版本，同 family 多版本可并存；不同 Workspace 可以同时选择不同 Node/Python/Go 版本，相同精确版本只保存一份；
- 当前 x64 Catalog 已实际提供 Node 24.21.0/22.23.2、Python 3.14.7/3.13.15、Go 1.27.1/1.26.8；这些 pack 由 SHA-256 固定的 `mise 2026.9.5 install-into` 原生生成，随后校验可执行版本、Nexus canonical tree digest 和 manifest；最终通过 `/opt/nexus/packs/<family>/<version>` 指向精确 digest，不修改全局 `/usr/bin`；
- Workspace 切换工具版本时只创建/重启该 Workspace 的新 generation，并重新解析该 generation 的 PATH；不修改全局 `/usr/bin`，不影响其他 Workspace，项目文件也不随 generation 复制或丢失；
- 平台管理的逻辑 `/workspace/deps`、`/workspace/build` 与 npm/pip/Go cache 按精确 `runtimeDigest + packRefs` 的 `toolchainFingerprint` 分区；不同 ABI 工具组合不共享依赖状态，切回相同组合可复用，项目源码仍保持稳定；native Runner 会把这些逻辑路径解析到真实 Runner data root；
- Workspace job、ACP process、Workspace local Terminal 和 Runner Plugin 都作为 Runner 子进程在对应 Workspace/runtime profile 下运行；job/ACP/Runner Plugin 使用 Runner-managed process group，生命周期结束时整组回收；Terminal 使用系统 `script(1)` 创建真实 PTY，并按 PTY foreground process group 处理 signal；
- **Workspace 之间只有逻辑隔离，不是安全隔离**：不创建 per-Workspace mount/PID/network namespace，也不提供没有执行效果的 Workspace limits/network 假配置；Host Runner 与其子进程共享宿主安全上下文，容器 Runner 则共享同一个 Runner 容器安全上下文；
- Runner 不持 host Docker socket、不启动 dockerd、不使用 nested Docker。独立 Runner 容器不需要 `privileged`、`SYS_ADMIN` 或 unconfined seccomp/AppArmor；镜像仅用 `tini` 作为 PID 1 做信号转发和孤儿进程回收。Docker 容器本身可以作为整个 Runner 服务的操作系统边界，但容器内 Workspace 仍属于同一 Nexus 用户；
- Runner Plugin 按 Workspace generation 显式选择并冻结 `{pluginId, version, sdkVersion, protocolVersion, packageHash, entry}`。由于 Runner 采用单用户 native trust model，用户安装并启用的 Runner Plugin 代码与其他 Workspace 子进程使用同一 Runner OS 权限；每个 target 的 Plugin workspace 只是 SDK/Artifact exchange 使用的逻辑目录，不再提供跨 Plugin ACL，也不描述成 OS 安全边界；
- Host Runner 与独立 `nexus-agent-runner` 镜像使用相同 runtime contract。Backend 以至少 32 字符的 Bearer token 认证所有 Runner HTTP/WS 请求，并使用 `X-Nexus-Agent-Protocol: 2026-09-13` 做显式协议门槛；Compose 中的 Runner service 默认保持注释以兼容现有部署，需要时可直接启用，不再有 container capability 放宽要求。
- Runner 控制协议按职责最小化：`provision` 发送完整冻结 profile；后续 lifecycle 只使用 `workspaceId + generation`；job 只传 execution input。Backend 的 user/app/run identity、optimistic version、operation hash/idempotency 继续由 Backend 持有，不跨进程重复投影。

### 5.1 Runtime consumer / owner 边界

| Consumer                                   | 执行 owner                                                     | 共享内容                                                                    | 明确不共享                                                                        |
| ------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Agent `workspace_execute_argv`             | Workspace Runtime Gateway → Runner generation                  | 当前 Workspace/Profile、稳定文件、Tool Store、toolchain fingerprint         | SSH live session、浏览器 socket、Plugin IPC handle                                |
| Runner Plugin                              | Runner native child process + Plugin Workspace Store           | 当前 generation 冻结的 Tool Pack/Plugin target；自己的逻辑 plugin workspace | Backend DB/API、Agent approval 对象；逻辑目录不宣称 OS 级 filesystem/network 隔离 |
| Workspace local Terminal                   | Runner native PTY session，绑定明确 `workspaceId + generation` | 与 Agent job 相同的 Workspace/Profile/Tool Store                            | 不复用 Nexus Remote SSH session，不直接把 Runner 内部对象暴露给浏览器             |
| 现有 SSH Terminal / Files / Docker Manager | Nexus `modules/workspace` + SSH/SFTP/remote machine capability | 可与 Agent 共享底层 Platform capability/Lease 冲突规则                      | 不进入本地 Runner generation，不共享本地 Workspace PTY/filesystem handle          |
| RDP/VNC                                    | Remote Desktop / Guacamole runtime                             | 仅通用认证、策略与产品 shell                                                | 不进入 Runner，不把 guacd/session ticket 变成 Workspace Runtime handle            |

“统一 Runtime”只统一 **Workspace/Profile/Generation 的本地执行契约与工具解析**，不统一不同传输协议、会话 owner 或授权身份。Workspace local Terminal 已通过 Workspace Runtime interactive-session port 接入 Runner，但仍与 Nexus Remote SSH Workspace 的 live session 完全分离。

现有 Browser ↔ Nexus Workspace 的 `NXW1`、`/ws/uploads`、Runner Plugin `NXR3` 与 Backend ↔ Runner HTTP 仍是四条独立 transport contract；Workspace 产品模型统一不意味着合并 wire protocol。真实远端 Docker 操作仍属于 Nexus Backend 的 `machine.docker.*` capability，与 Runner runtime 基础设施无关。

## 6. Plugin 三目标与隔离

Plugin manifest 只有三个代码运行 target：

```text
frontend  → isolated browser origin / iframe，拥有完整 Custom App Surface
backend   → Backend-owned native child process / bounded SDK
runner    → Workspace-generation-scoped native Runner Plugin process
```

不增加 `database/browser/ai/artifact` 等 target；这些属于 SDK capability。Frontend target 当前使用 `sdkVersion + protocolVersion=1`，并从 isolated Plugin origin 导入 `/sdk/frontend-v1.mjs`；第一阶段显式暴露 AppStorage 与 App-scoped AgentDefinition/Provider/Thread/Run/Subagent/Approval/Run-event API。Backend target 使用独立 `protocolVersion=1`，Runner target 当前为 `protocolVersion=3`；三套 target protocol 独立演进，版本数字相同也不代表兼容。

Runner Plugin SDK 只暴露当前 Plugin target 自己的逻辑 workspace，不再接受 `targetPluginId` 或跨 Plugin grant。Plugin workspace store 继续拒绝路径 traversal 与 symlink escape，以保证 SDK/Artifact exchange 不会因错误路径写出目标目录；这属于文件 API 正确性约束，不是对 native Plugin 进程的安全隔离。

## 7. 当前四条独立 transport

| 路径                                | 协议 / owner                                                       | 当前上限与语义                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser ↔ Nexus Workspace           | `NXW1`, `binaryProtocolVersion=1`, Workspace owner                 | client→server JSON control 最大 1 MiB；server binary 固定 16-byte header，terminal / request-scoped response 分流；UTF-8 requestId 最多 128 bytes；单 payload frame 最大 256 KiB；response 以 final frame 完成；文件/terminal/history 不走 Base64 JSON |
| Browser → `/ws/uploads`             | raw upload transport, Transfer owner                               | 一条 socket 对应一个 upload，binary message 就是有序文件 bytes；不套 `NXW1`，避免 bulk upload 阻塞 Workspace terminal/control                                                                                                                          |
| Runner Plugin process ↔ Runner Host | `NXR3`, Plugin `protocolVersion=3`                                 | local stdio fixed 16-byte JSON framing；uint32 requestId；单帧最大 256 KiB；只承载 ready/activate/health/quiesce/dispose lifecycle。`sdk.workspace.*` 在 Plugin worker 内直接访问当前 target 的逻辑目录，不再通过 Host IPC 搬运文件 bytes              |
| Backend ↔ `nexus-agent-runner`      | Bearer-authenticated HTTP/WS，`X-Nexus-Agent-Protocol: 2026-09-13` | `provision` 传完整 frozen profile，lifecycle/job 使用最小 workspace/generation payload；Workspace↔Artifact 使用 `application/octet-stream` streaming + 精确 `Content-Length`，当前 hard cap 256 MiB                                                    |

四条协议只共享 bounded/backpressure/fail-closed 原则；需要搬运文件/终端数据的 transport 才使用 raw bytes/streaming。它们**不共享 magic、requestId 类型、版本号、lifecycle 或 transport handle**。`NXW1 v1` 和 Frontend/Backend Plugin `protocolVersion=1` 只是碰巧同号，没有兼容关系。

## 8. 数据生命周期

```text
Nexus Workspace remote filesystem
= 用户 SSH 会话的远程 mutable data

Runner Workspace filesystem
= Workspace 生命周期内稳定 mutable project data；Workspace generation 只切换运行配置/工具版本，不复制该数据

Runner Plugin logical Workspace
= 同一 Workspace 内按 Plugin target 分目录的 mutable data；用于 SDK/Artifact exchange，不作为 Plugin 间安全隔离

Artifact
= durable file/result/evidence

AppStorage
= App/Plugin 长期小型结构化 KV state

Conversation Ledger / Run Events / Checkpoint
= Agent durable facts and recovery state
```

Runner Plugin workspace 不提供跨 Plugin grant；Workspace↔Artifact 是显式生命周期转换：`workspace→artifact` 需要 `workspace.runtime.execute + artifacts.write`，`artifact→workspace` 需要 `workspace.runtime.execute + artifacts.read`；Backend `agent/exchange` 重新校验 scope/capability，Runner Host streaming bridge 不把 transfer handle 暴露给 Frontend/Plugin/模型。

## 9. Mutation / security pipeline

Agent mutation 必须统一收敛到：

```text
inspect
  → authorize / scope / target denylist
  → policy
  → approval when required
  → lease / MutationGuard
  → execute
  → verify
  → durable result or reconciliation/quarantine
```

硬 deny 不能被 Approval 覆盖；Approval 绑定 canonical operation hash；未知远端结果不能因为 lease 超时就自动重放。Workspace typed mutation 与 Agent 共用资源冲突/MutationGuard 原语，但仍保留各自 runtime owner。

Secrets 不进入浏览器 view、Artifact、Plugin activation plain payload 或日志。动态 Backend Plugin 在 Nexus Backend 之外的 native child process 中执行，并由 bounded SDK + Node Permission Model 限制文件/进程权限；它不宣称提供 OS namespace/network sandbox。Runner Plugin 属于单用户 native Runner trust model，必须可停止、协议有界；Plugin workspace store 只提供逻辑目录与路径安全，不再维护无法形成 OS 隔离的跨 Plugin ACL。

## 10. 当前 Agent capability 接线状态

Agent 的详细当前架构统一见 [`../AGENT.md`](../AGENT.md)。当前 production wiring 已包含：

- root-mounted global floating Agent Host、Provider、Conversation、Thread/Run/Ledger、typed Plan、append-input interruption；
- Artifact、Context、Capability、Policy/Approval/Lease、Checkpoint/Resume；
- Workspace Runtime + `@nexus-terminal/agent-runner`，包括 native Workspace job、多版本 Toolchain、direct PTY、cleanup/reconcile；
- MCP tool catalog；
- ACP live stream、Browser tunnel/CDP gateway、Workspace local direct PTY Terminal；
- Subagent durable mailbox/shared facts/work queue 与 reviewed Memory；
- signed installable Plugin、versioned AgentDefinition、isolated Frontend target、native Backend child target 与 native Runner target；
- Frontend/Backend/Runner 结构化诊断日志。

已经交付并进入当前合同的交互包括 durable Goal text/revision、`/goal`/`/plan`/`/interrupt`/`/queue`/`/stop`/`/help` slash-command dispatch、`//` literal escape、durable pending-input queue inspection + versioned remove/reorder，以及真正的 Next Run Environment selector。Environment 在 Run create 时由 Backend 对 Runner Catalog + Agent settings 做 CAS/解析并冻结到 `RunDefinition.environment`；Workspace create 只能消费该 snapshot。

### 10.1 关键模块依赖与函数调用链（审计入口）

Bootstrap 是唯一允许把具体 Infrastructure adapter 注入 Module 的地方。当前 Agent 关键依赖可压缩为：

```text
createAgentServices / compose-agent
  ├─ Host: AppLifecycleService + PluginService + AppStorage + Integrations
  ├─ AI: ProviderService + Conversation/Context/Artifact/Memory
  ├─ Capability: ToolCatalog + CapabilityBroker + Policy/Approval/Lease
  ├─ Host Tools: cross-domain governed Tool implementations registered by bootstrap
  ├─ Runtime: RunService + StateCommit + AgentScheduler + SubagentScheduler
  ├─ Workspace Runtime: WorkspaceRuntimeService/Gateway + Runner adapter
  └─ Plugin Host: installable AgentDefinition/Skill/App targets (default nexus.agent; full target reference nexus.fullstack)
```

用户从 Host surface 发起一次 Run 的主链路：

```text
AgentConversation @send
  → AgentAppSurface.send/createNewRun
  → run-facade
  → agentApi.createRun / appendRunInput / interruptRun / setRunGoal
  → POST /api/v1/agent/apps/:appId/runs...
  → app-runtime.routes parse + auth/CSRF/idempotency/version check
  → AgentRunFacade
  → RunService
  → RunCommandCommitPort (StateCommit durable transaction)
  → compose-agent callbacks
      create/reschedule → AgentScheduler.enqueue
      appended input    → AgentScheduler.signalInput
      goal update       → AgentScheduler.signalInput(..., GOAL_UPDATED)
      cancel            → AgentScheduler.cancel + SubagentScheduler.cancel
  → AgentScheduler / model step loop
  → Context/Provider/LanguageModel
  → ToolCallRunner when a tool is requested
  → CapabilityBroker → policy → approval → lease/MutationGuard → concrete capability adapter
  → StateCommit + EventHub
  → /ws/agent wake/event cursor
  → Frontend refreshes durable Run/Ledger/Approval projection
```

这条链里 `RunService` 不直接执行模型或真实机器副作用，`StateCommit` 不替 Scheduler 做模型循环，Frontend 也不直接改 Run 状态；三者分别负责 command validation/orchestration、durable mutation authority、presentation。

Workspace Runtime 的执行链是另一条明确边界：

```text
Agent tool workspace_execute_argv
  → Host workspace tool inspect/normalize
  → ToolCallRunner governed mutation pipeline
  → WorkspaceRuntimeGatewayPort
  → Backend Runner adapter
  → authenticated /v1 Runner controller request
  → WorkspaceRuntimeEngine / generation
  → bounded argv child process
  → job result/evidence
  → Agent tool result → StateCommit/Ledger
```

Plugin 安装链：

```text
PluginManagementSettings
  → agentApi remote stage/upload stage
  → verifyPlugin (manifest/files/hash/signature/path/size)
  → installPlugin / upgradePlugin
  → Plugin facade/service
  → immutable version store + installation row + App registry/lifecycle
  → optional frontend/backend/runner target activation
  → Host summary/event update
  → AgentAppSwitcher / Host surface sees the installed App
```

多 Plugin 的关键数据语义是 `agent_plugin_installations PRIMARY KEY(user_id, app_id)`：当前单管理员用户可以拥有多条不同 `app_id` 安装记录；`user_id` 继续作为 owner/scope key，并不表示 Nexus 已变成多租户产品。

## 11. 当前验证状态

Canonical GitHub E2E 的 Runner 验收面覆盖 Docker deployment smoke、Playwright groups、Host Runner runtime prerequisites、native Workspace job、ACP stream、direct PTY Terminal、Browser tunnel、stable Workspace generation、Node/Python/Go multi-version switching、runtime cleanup scope 与 Run deletion Workspace guard。具体当前 commit 的最终绿色 run 以 CI 记录为事实源；文档不把尚未执行的新 runtime 重构误写成已验证。

## 12. 当前不可破坏的架构约束

1. Workspace、Remote Desktop、Agent 各自拥有 live runtime/session，不互借内部 transport/state。
2. Backend 决定“能不能做”，Runner 决定“在哪个 Workspace/runtime profile 执行”，Frontend 决定“怎么交互”；Runner 不再宣称 per-Workspace OS 安全隔离。
3. Runner 永远不重新获得 Docker socket/dockerd/nested Docker；Docker 是 Backend machine capability。
4. Plugin target 固定 frontend/backend/runner；新能力通过 SDK/Capability，不增加同义 target。
5. Run/AgentRuntime/Step/PlanItem 保持语义分离，不新增与其重叠的 Task/Job/Workflow 一级领域包装。
6. 大 bytes 走对应 owner 的 raw binary/streaming transport，不回退 Base64 JSON；不同 runtime 的二进制协议不合并。
7. Workspace mutable data、Artifact durable data、AppStorage KV、Ledger durable facts 保持不同生命周期。
8. 动态 Plugin/App、外部 MCP/ACP/Browser 输入永远不能扩大本地 capability/policy 权限。
9. Architecture checker 必须持续覆盖 Backend Agent area、Runtime subdomain 和 Frontend Agent subdomain，不能只检查顶层目录。
10. 设计规范、CURRENT 实现快照、SRS/FR 和验证证据必须同步更新；不能用“设计存在”或“adapter 存在”代替交付状态。
