# Nexus 当前架构基线

> 状态：Current implementation snapshot
>
> 日期：2026-09-12
>
> 分支：`dev`
>
> 本文件是当前源码架构的单入口快照，不替代详细规范。Backend 放置规则见 [BACKEND.md](BACKEND.md)，Frontend 放置规则见 [FRONTEND.md](FRONTEND.md)，Agent 架构与当前接线规范见 [../agent.md](../agent.md)。强制工程约束仍以 [Engineering Constraints](../software-requirements/engineering-constraints.md) 为准。

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
   ├─ Operations built-in App
   ├─ Conversation / Task / Approval / Artifact / Workspace Runtime UI
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
   ├─ Workspace Runtime
   ├─ Runtime
   └─ Apps / Operations
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
                 ├─ Sandbox Manager
                 ├─ Pack Manager
                 ├─ Workspace Broker
                 ├─ Plugin Runner Host
                 └─ Workspace generation sandboxes
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
└─ apps/operations/
```

职责边界：Host 负责 App lifecycle/grant/SDK/AppStorage/Plugin lifecycle；AI 负责 Provider/Conversation/Context/Artifact/Recall/Memory/Integration；Capabilities 负责授权、Policy、Approval/Lease 接入和 Tool Catalog；Workspace Runtime 负责稳定 Workspace、Profile/Generation、Tool Store/Runner 控制用例；Exchange 是 Workspace↔Artifact 的显式桥接层；Agent Runtime 负责 Run/participant/plan/scheduler/event/recovery/collaboration；Operations 只提供具体 App definition/tool/risk/verifier contribution。

Tool Catalog 使用 `CapabilityContribution { id, capability, tools[] }`。Target 只回答“代码在哪里运行”，Capability 才回答“允许做什么”。LLM、Plugin、MCP、Subagent 都不能直接形成真实副作用旁路。

## 4. Agent Frontend owner

当前物理结构收敛在一个明确的 Agent feature owner 内；Host、AI presentation、Files、Runtime、Settings 与 built-in App 都按子域放置，不另建平行顶层 App/AI package：

```text
packages/frontend/src/features/agent/
├─ host/             AgentSurfaceHost / Hub / Launcher / Plugin bridge
├─ api/              typed HTTP/SSE client
├─ ai/               conversation presentation
├─ files/            Artifact Library / picker
├─ runtime/          Run/Task/Approval/Subagent/Workspace Runtime projection
├─ settings/         Agent settings contribution
└─ apps/operations/  built-in Operations App contribution
```

当前只有 `nexus.operations` 一个 built-in App，Host 可以显式组合。新增第二个 built-in Agent App 前先建立明确的 contribution registry；安装式第三方 App UI 始终由独立 origin + sandboxed iframe + MessageChannel bridge 承载，不加载 arbitrary same-origin plugin JavaScript。

Frontend architecture checker 已约束 `host/api/ai/files/runtime/settings/apps/operations/public` 子域依赖，并继续禁止 feature 反向依赖 Workspace runtime。

## 5. Runner / Workspace Dev Environment

`nexus-agent-runner` 是独立受限执行平面，但**不是 Docker controller**。当前正式方向已经收敛为单一 Workspace Runtime；“Workspace Dev Environment”只作为用户可读的开发环境描述，不再是独立领域实体，也不按 Node/Python/Go 分裂运行对象：

- 一个 Workspace 是稳定的项目/代码/文件系统边界；Node、Python、Go 等只是该 Workspace 的工具链选择，共享同一份 Workspace 文件；
- Workspace Profile 冻结工具版本、Runner Plugin、资源/网络策略；Generation 是该 Profile 的一次运行实例，稳定 identity 始终是 Workspace；
- 全局 Tool Store 以 `familyId/versionId/contentDigest`（digest 按 arch 解析） 保存不可变工具版本，同 family 多版本可并存；不同 Workspace 可以同时选择不同 Node/Python/Go 版本；
- 当前 x64 Catalog 已实际提供 Node 24.21.0/22.23.2、Python 3.14.7/3.13.15、Go 1.27.1/1.26.8；这些 pack 由 SHA-256 固定的 `mise 2026.9.5 install-into` 在专用 bubblewrap materializer sandbox 内生成，版本再由无网络 verifier sandbox 检查；最终身份仍由 Nexus canonical tree digest 决定，installer 不写全局 `/usr/bin`；
- Workspace 切换工具版本时只创建/重启该 Workspace 的新 Workspace generation，并重新解析该 generation 的 PATH/只读工具挂载；不修改全局 `/usr/bin`，不影响其他 Workspace，项目文件也不随 generation 复制或丢失；
- 平台管理的 `/workspace/deps`、`/workspace/build` 与 npm/pip/Go cache 按精确 `runtimeDigest + packRefs` 的 `toolchainFingerprint` 分区；不同 ABI 工具组合不共享这些依赖状态，切回相同组合可复用，项目源码仍保持稳定；
- Agent、Plugin、CI/task 以及后续接入的 Terminal runtime 都从当前 Workspace Profile/Generation 解析工具；Rust/JDK/CUDA 等后续工具继续扩展同一 Tool 模型，不新增语言专用 Workspace 类型；
- 当前 Linux sandbox 仍 fail closed，使用上游最新稳定且 SHA-256 固定的 `bubblewrap 0.12.0` 隔离 process/filesystem/PID/IPC/UTS/network；host Runner 使用 Nexus-owned root-only binary，Backend Plugin 镜像也构建同版；具体 release/version/SHA 由构建与仓库 check 脚本统一验证，Runtime 代码不重复嵌入版本策略；sandbox primitive 不可用时 Workspace Runtime availability degraded/unavailable，不退化成 Runner Core/Backend 裸进程执行；
- Runner、Backend、Workspace sandbox、Plugin sandbox 都不持 host Docker socket，Runner 不启动 dockerd、不使用 nested Docker、Plugin 不创建额外 Docker；
- canonical Linux 部署将 Runner 作为专用 host service，使 bubblewrap 的 namespace/mount construction 不需要放宽长期运行的 Docker Runner 容器；Backend 通过受认证 Controller HTTP 到达它；
- Runner Plugin 按 Workspace generation 显式选择并冻结 `{pluginId, version, sdkVersion, protocolVersion, packageHash, entry}`，历史 generation 不根据当前安装状态自动升级协议。

### 5.1 Runtime consumer / owner 边界

| Consumer                                   | 执行 owner                                                                               | 共享内容                                                                      | 明确不共享                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Agent `workspace_execute_argv`             | Workspace Runtime Gateway → Runner generation                                            | 当前 Workspace/Profile、稳定文件、Tool Store、toolchain fingerprint           | SSH live session、PTY、浏览器 socket、Plugin IPC handle                                  |
| Runner Plugin                              | Runner Plugin sandbox + Workspace Broker                                                 | 当前 generation 冻结的 Tool Pack/Plugin target；经 ACL 访问 logical workspace | Backend DB/API、Agent approval 对象、真实 Workspace host path                            |
| future local Terminal                      | 应新增 Workspace Runtime interactive-session port，并绑定明确 `workspaceId + generation` | 与 Agent job 相同的 Workspace/Profile/Tool Store                              | 不复用 Agent 的模型身份或逐按键 Approval；不直接拿 Runner 内部对象                       |
| 现有 SSH Terminal / Files / Docker Manager | Nexus `modules/workspace` + SSH/SFTP/remote machine capability                           | 可与 Agent 共享底层 Platform capability/Lease 冲突规则                        | **不进入本地 Runner sandbox**，不共享本地 Workspace generation、PTY 或 filesystem handle |
| RDP/VNC                                    | Remote Desktop / Guacamole runtime                                                       | 仅通用认证、策略与产品 shell                                                  | 不进入 Runner，不把 guacd/session ticket 变成 Workspace Runtime handle                   |

“统一 Runtime”因此只统一 **Workspace/Profile/Generation 的本地执行契约与工具解析**，不统一不同传输协议、会话 owner 或安全身份。若未来加入本地交互式 Terminal，它应在 Workspace Runtime 下新增受控 interactive session abstraction，而不是把当前 SSH `WorkspaceTerminalService` 搬进 Runner，也不是让 Agent/Plugin 直接持有 PTY。

现有 Browser ↔ Nexus Workspace 的 `NXW1`、`/ws/uploads`、Runner Plugin `NXR2` 与 Backend ↔ Runner HTTP 仍是四条独立 transport contract；Workspace 产品模型的统一不意味着合并 wire protocol。真实远端 Docker 操作仍属于 Nexus Backend 的 `machine.docker.*` capability，与 Runner sandbox 基础设施无关。

## 6. Plugin 三目标与隔离

Plugin manifest 只有三个代码运行 target：

```text
frontend  → isolated browser origin / iframe
backend   → Backend-owned process sandbox
runner    → Workspace-generation-scoped Runner Plugin sandbox
```

不增加 `database/browser/ai/artifact` 等 target；这些属于 SDK capability。Frontend/Backend target 当前各自使用显式 `sdkVersion + protocolVersion=1`，Runner target 当前为 `protocolVersion=2`；三套 target protocol 独立演进，版本数字相同也不代表兼容。

Runner Plugin 不直接 bind 真实 workspace，必须经 Workspace Broker + Host-bound `callerPluginId` 访问。自己的 workspace 默认可用，跨 Plugin 默认 deny，由目标 workspace ACL 以 `target/principal/path/permission` 明确授权；路径 traversal、symlink escape、跨 Workspace target 均拒绝。

## 7. 当前四条 binary/data transport

| 路径                                | 协议 / owner                                       | 当前上限与语义                                                                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser ↔ Nexus Workspace           | `NXW1`, `binaryProtocolVersion=1`, Workspace owner | client→server JSON control 最大 1 MiB；server binary 固定 16-byte header，terminal / request-scoped response 分流；UTF-8 requestId 最多 128 bytes；单 payload frame 最大 256 KiB；response 以 final frame 完成；文件/terminal/history 不走 Base64 JSON |
| Browser → `/ws/uploads`             | raw upload transport, Transfer owner               | 一条 socket 对应一个 upload，binary message 就是有序文件 bytes；不套 `NXW1`，避免 bulk upload 阻塞 Workspace terminal/control                                                                                                                          |
| Runner Plugin sandbox ↔ Runner Host | `NXR2`, Plugin `protocolVersion=2`                 | local stdio fixed 16-byte framing；uint32 requestId；JSON control 最大 256 KiB；单次 workspace binary 最大 16 MiB；caller identity Host-bound                                                                                                          |
| Backend ↔ `nexus-agent-runner`      | authenticated Controller HTTP                      | bounded JSON control；Workspace↔Artifact 使用 `application/octet-stream` streaming + 精确 `Content-Length`，当前 hard cap 256 MiB                                                                                                                      |

四条协议只共享 bounded/raw-byte/backpressure-or-streaming/fail-closed 原则，**不共享 magic、requestId 类型、版本号、lifecycle 或 transport handle**。`NXW1 v1` 和 Frontend/Backend Plugin `protocolVersion=1` 只是碰巧同号，没有兼容关系。

## 8. 数据生命周期

```text
Nexus Workspace remote filesystem
= 用户 SSH 会话的远程 mutable data

Runner Workspace filesystem
= Workspace 生命周期内稳定 mutable project data；Workspace generation 只切换运行配置/工具版本，不复制该数据

Runner Plugin logical Workspace
= 同一 Workspace 内的 Plugin scoped mutable data；跨 Plugin 默认 deny

Artifact
= durable file/result/evidence

AppStorage
= App/Plugin 长期小型结构化 KV state

Conversation Ledger / Run Events / Checkpoint
= Agent durable facts and recovery state
```

Runner Plugin workspace 跨 Plugin 授权读取同一底层文件，不复制。Workspace↔Artifact 是显式生命周期转换：`workspace→artifact` 需要 `workspace.runtime.execute + artifacts.write`，`artifact→workspace` 需要 `workspace.runtime.execute + artifacts.read`；Backend `agent/exchange` 重新校验 scope/capability，Runner Host streaming bridge 不把 transfer handle 暴露给 Frontend/Plugin/模型。

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

Secrets 不进入浏览器 view、Artifact、Plugin activation plain payload 或日志；动态 Backend/Runner Plugin 执行必须使用可停止、可限权的 sandbox，安全 primitive 不可用时 fail closed。

## 10. 当前 Agent capability 接线状态

Agent 的详细当前架构统一见 [`../agent.md`](../agent.md)。当前 production wiring 已包含：

- root-mounted global floating Agent Host、Provider、Conversation、Thread/Run/Ledger、typed Plan、append-input interruption；
- Artifact、Context、Capability、Policy/Approval/Lease、Checkpoint/Resume；
- Workspace Runtime + `@nexus-terminal/agent-runner`，包括 sandbox job、多版本 Toolchain、cleanup/reconcile；
- MCP tool catalog；
- ACP live stream、Browser tunnel/CDP gateway、Workspace local SSH/PTTY Terminal；
- Subagent durable mailbox/shared facts/work queue 与 reviewed Memory；
- signed installable Plugin、versioned AgentDefinition、isolated Frontend/Backend/Runner target；
- Frontend/Backend/Runner 结构化诊断日志。

仍未交付的产品合同必须明确标记为 roadmap，而不能靠前端制造状态：用户可编辑 durable Goal 文本和 slash-command、用户可见 pending-input queue，以及冻结进 RunDefinition 的 Next Run Environment selector。

## 11. 当前验证状态

Canonical GitHub E2E 在 2026-09-12 已验证当前 Agent/Runner 主链：Docker deployment smoke、8/8 Playwright groups、Host Runner sandbox prerequisites、sandbox job、ACP stream、Workspace SSH/PTTY Terminal、Browser tunnel、stable Workspace generation、Node/Python/Go multi-version switching、runtime cleanup scope、Run deletion Workspace guard、全局 floating Agent 跨路由行为以及 66/66 functional screenshots。宿主本地 Chromium 缺少动态库时的单机执行限制不作为代码失败；远程 canonical CI 是浏览器与 Runner 生产验收事实源。

## 12. 当前不可破坏的架构约束

1. Workspace、Remote Desktop、Agent 各自拥有 live runtime/session，不互借内部 transport/state。
2. Backend 决定“能不能做”，Runner 决定“怎么隔离执行”，Frontend 决定“怎么交互”。
3. Runner 永远不重新获得 Docker socket/dockerd/nested Docker；Docker 是 Backend machine capability。
4. Plugin target 固定 frontend/backend/runner；新能力通过 SDK/Capability，不增加同义 target。
5. Run/AgentRuntime/Step/PlanItem 保持语义分离，不新增与其重叠的 Task/Job/Workflow 一级领域包装。
6. 大 bytes 走对应 owner 的 raw binary/streaming transport，不回退 Base64 JSON；不同 runtime 的二进制协议不合并。
7. Workspace mutable data、Artifact durable data、AppStorage KV、Ledger durable facts 保持不同生命周期。
8. 动态 Plugin/App、外部 MCP/ACP/Browser 输入永远不能扩大本地 capability/policy 权限。
9. Architecture checker 必须持续覆盖 Backend Agent area、Runtime subdomain 和 Frontend Agent subdomain，不能只检查顶层目录。
10. 设计规范、CURRENT 实现快照、SRS/FR 和验证证据必须同步更新；不能用“设计存在”或“adapter 存在”代替交付状态。
