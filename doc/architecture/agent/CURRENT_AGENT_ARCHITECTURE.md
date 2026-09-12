# Nexus Agent 当前架构与后续开发基线

> 状态：当前开发基线。用于后续会话继续实现时快速恢复上下文。
>
> 仓库：`/home/agentdock/AgentDock/nexus-terminal`
>
> 分支：`dev`
>
> 本文记录当前源码实际落地/接线状态、Plugin 三目标模型、Workspace/Profile/Generation Runtime 模型、Runtime 拆分、相邻 Nexus Workspace transport 和仍未完成的产品接线/验证项。详细长期规范仍参考同目录 `ARCHITECTURE.md` 与 `IMPLEMENTATION.md`；本文不把“类/adapter 已存在”自动等同为 live capability。

## 1. 总体架构

Nexus Agent 当前采用三层宿主 + Agent 平台模型：

```text
User
 ↓
Frontend
├─ Agent UI / Conversation / TaskRail / Approval / Artifact / Settings
├─ Frontend Core
└─ Frontend Plugin Sandbox
      ↓ authenticated Host API
Backend
├─ App Host
├─ Agent Runtime
├─ Capability / Tool Catalog
├─ Policy / Approval / Lease / MutationGuard
├─ AI / Artifact / Memory / Integration
├─ Workspace Runtime Control Plane
└─ Backend Plugin Sandbox
      ↓ trusted Runner protocol
nexus-agent-runner
├─ Runner Core
├─ Sandbox Manager
├─ Pack Manager
├─ Workspace Broker
└─ Workspace generation
   ├─ Core Task Sandbox
   ├─ Runner Plugin Sandbox A
   └─ Runner Plugin Sandbox B
```

职责原则：

- Frontend：人机交互和 Frontend Plugin 执行宿主。
- Backend：身份、App、Run、权限、Policy、Approval、Lease、Artifact、Memory、Capability 和控制平面。
- Runner：受限本地执行平面，负责 Workspace generation、sandbox、Tool Pack、Workspace Broker 和 Runner Plugin。
- Plugin：签名扩展包，可显式声明 `frontend / backend / runner` 三个 target。
- Docker：真实 Docker 操作属于 Backend/Nexus `machine.docker.*` capability，不是 Runner 基础设施。

## 2. Runtime 功能模型

业务领域模型保持：

```text
App
└─ Thread
   └─ Run
      ├─ AgentRuntime 1..N
      │  └─ Step
      │     ├─ ModelAttempt
      │     ├─ ToolCall
      │     └─ Evidence
      ├─ PlanProjection
      │  └─ PlanItem 0..64
      ├─ Workspace / Profile / Generation
      ├─ Artifact
      ├─ Checkpoint
      ├─ Approval
      ├─ Mailbox
      └─ SharedFacts
```

定义：

- `Thread`：长期会话边界。
- `Run`：一次 durable task，负责目标、预算、取消、计划、结果和恢复。
- `AgentRuntime`：某个 Agent participant 在该 Run 中的一次执行身份，不等于进程/容器。
- `Step`：Agent loop 的 durable progression boundary，一次模型/工具/验证推进。
- `PlanItem`：用户可见的计划节点，与 Step 完全分离。
- Resume 不复活旧 Run 执行栈，而是根据 Checkpoint 创建新 Run。

### 2.1 Runtime 一级目录拆分

为防止 `runtime/` 一级膨胀，当前实现拆成：

```text
packages/backend/src/modules/agent/runtime/
├─ approvals/
├─ collaboration/
├─ definitions/
├─ events/
├─ execution/
├─ planning/
├─ recovery/
├─ runs/
└─ scheduling/
```

这些是实现子域，不是新增业务实体。

原则：

> 外层 durable/control 可以复杂，内层 Agent Loop 保持简单：`context → model → tool/result → next step`。

不要继续增加 `Task / Job / Invocation / Activity / Workflow` 等与 Run/Step 重叠的一级领域实体。

## 3. PlanItem 与 Step

当前已经正式拆分：

```ts
interface RunPlan {
  schemaVersion: 1;
  revision: number;
  items: PlanItem[];
}

interface PlanItem {
  id: string;
  title: string;
  detail: string | null;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  dependsOn: string[];
  evidenceRefs: string[];
}
```

Plan 支持：

- revision；
- 稳定 item id；
- dependency；
- evidence refs；
- 引用检查；
- dependency cycle 检查；
- 后续可自然投影 Execution Graph。

Frontend `TaskRail.vue` 已直接展示 typed PlanItem，而不是 `JSON.stringify(plan)`。

## 4. Capability 与 Tool

核心区分：

```text
Tool
= Agent-facing semantic operation

Capability
= Nexus-controlled real capability
```

真实副作用最终都应该收敛到 Capability，不允许 LLM / Plugin / MCP / Subagent 建立旁路。

当前 Tool Catalog 已使用显式 Capability Contribution：

```ts
interface CapabilityContribution {
  schemaVersion: 1;
  id: string;
  capability: AgentCapability;
  tools: readonly AgentTool[];
}
```

Catalog 会校验 contribution 内所有 Tool 的 `descriptor.capability` 必须与 contribution capability 一致。

当前静态 machine/workspace-runtime/runtime tools 与动态 MCP tools 已使用该模型。

后续增加 Kubernetes、DB、Cloud 等功能，应新增明确 contribution，而不是继续在 composition root 散落 `register(tool)`。

## 5. Plugin 三目标模型

Plugin package 是签名 bundle，不是独立服务，也不创建 Plugin Docker。

Manifest 使用显式 target：

```ts
interface AgentAppTargets {
  frontend?: { entry: string };
  backend?: { entry: string };
  runner?: { entry: string };
}
```

禁止回退到：

```ts
resources: Record<string, string>;
```

也禁止使用“某个 key 是否存在”推断模块类型。

原则：

> Target 表示代码运行在哪里；Capability 表示代码能做什么。

后续不要新增 `targets.database / targets.browser / targets.ai / targets.artifact` 等 target。目标层保持 `frontend / backend / runner`，新能力通过对应 SDK 增加。

## 6. Frontend Plugin

结构：

```text
Frontend container
├─ Nexus Frontend
└─ Plugin Frontend isolated origin
```

不再有独立 `plugin-ui` Docker。

Backend 使用独立 Plugin Frontend listener 直接提供 `agent/plugins/<appId>/versions/<version>/frontend/` 中的 verified immutable assets；Frontend 容器不挂插件目录，仍保持与 Nexus 页面不同 origin。

iframe：

```html
sandbox="allow-scripts"
```

业务通信通过：

```text
Plugin iframe
 ↓ MessageChannel
Frontend Host Bridge
 ↓ authenticated Backend API
Backend
```

当前 Frontend Plugin RPC 基础能力：

```text
host.appInfo
storage.get
storage.put
storage.delete
```

不能直接访问：

- Nexus cookie/session；
- 主页面 DOM；
- Backend internal API；
- Runner；
- 其他 Plugin 内部状态。

## 7. Backend Plugin

Backend Plugin 运行在 Backend 主容器内部的独立 OS process sandbox。

动态 Plugin 代码不能进入 Backend Core module graph，也不能在 Core 中 `eval/import`。

当前 sandbox 原则：

- 默认无网络；
- 不暴露 `/app/data`；
- 不暴露 SQLite handle；
- 不暴露 Backend env/secrets；
- 只读 Plugin package；
- 通过 Host IPC 使用明确 SDK；
- sandbox 不可建立时 fail closed。

当前 BackendPluginSdk 基础接口：

```ts
interface PluginBackendSdk {
  storage: {
    get(key: string): Promise<unknown>;
    put(key: string, value: unknown, expectedVersion: number | null): Promise<unknown>;
    delete(key: string, expectedVersion: number): Promise<boolean>;
  };
}
```

`storage.app` 不是因为方法存在就自动授权；Host 每次实际调用仍检查 manifest capability + 当前 user grant + App state。

后续扩展 `artifacts / ai / runs / events / settings / machine / intents` 时必须新增 typed SDK/Host IPC，不允许通用字符串 dispatcher 或直接传 Backend object。

## 8. Runner 与 Workspace Dev Environment

`nexus-agent-runner` 的 canonical Linux 部署是专用 host service，不再是需要 `SYS_ADMIN/NET_ADMIN` 的顶层 Runner 容器：

```text
/var/run/docker.sock                 ❌
/run/nexus-agent-runner/docker.sock ❌
nested dockerd                       ❌
dockerode                            ❌
Workspace/generation child Docker  ❌
Plugin child Docker                  ❌
privileged Runner container          ❌
```

Runner 是受限执行服务，不是 Docker orchestrator。一个 Workspace 是稳定的项目/文件系统边界；Workspace Profile 是冻结运行配置，Generation 是该 Profile 的一次运行实例，而不是语言类型：

```text
Workspace A
├─ stable project files
├─ generation -> node22 + python3.12 + go1.23
├─ Core Task Sandbox
├─ plugin1 Runner Sandbox
└─ plugin2 Runner Sandbox

Workspace B
└─ generation -> node18 + python3.10
```

Tool Store 按 `family/version/digest`（digest 按 arch 解析）允许多版本并存。Workspace 切换 Node/Python/Go 版本只重建自己的 generation，重新解析 PATH/只读 Tool Pack，同时继续 bind 同一 Workspace 文件；不得修改全局 `/usr/bin` 或影响其他 Workspace。Generation 由 Runner Sandbox Manager 管理；当前 Linux 实现固定使用受支持的 bubblewrap（当前发行 0.12.0+）作为 process/filesystem/network namespace 隔离边界，并建立独立 process tree、最小环境变量和只读 Tool Pack。不能仅靠 `cwd`、Node `vm` 或 `worker_threads` 宣称 hostile-code 安全隔离。

Runtime consumer/owner 边界：Agent one-shot job、Runner Plugin、CI/task 与已实现的 local Workspace Terminal 共享 Workspace/Profile/Generation 和 Tool Store，但 transport/identity 不合并。local Terminal 使用独立 `WorkspaceRuntimeInteractiveSessionPort`：Frontend `/ws/agent-terminal` → Backend `WorkspaceRuntimeTerminalService` → `RunnerWorkspaceTerminalAdapter` → authenticated Runner WebSocket → sandbox 内 ephemeral Dropbear/SSH PTY；detach grace 30 秒、replay 上限 1 MiB。它不复用 Agent 模型身份或远程 SSH 的高层 `WorkspaceTerminalService`。现有 SSH Terminal/SFTP/remote Docker 仍由 Nexus Workspace/remote-machine 模块持有 live session；RDP/VNC 仍由 Guacamole runtime 持有。

## 9. Runner Plugin 显式选择

Workspace Profile 不自动注入所有 enabled Runner Plugin。

创建请求必须显式：

```ts
interface AgentWorkspaceCreateSpec {
  recipeId: string;
  versions?: Record<string, string>;
  runnerPluginIds?: string[];
}
```

Backend 对每个 requested Plugin 验证：

- 已安装；
- enabled；
- activeVersion 匹配；
- 声明 `targets.runner`；
- package hash 与 target entry 有效。

然后冻结精确 target：

```ts
{
  pluginId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: 2;
  packageHash: string;
  entry: string;
}
```

该列表持久化到 `agent_workspaces.runner_plugins_json`，后续 start/restart/reconcile 使用冻结记录，不根据当前安装状态猜历史 generation。Runner protocol v2 是 wire-incompatible contract；旧 protocol generation 不自动套用 v2，必须重建后再激活。

Agent 自己调用 `workspace_create` Tool 也使用同一 `runnerPluginIds`，没有模型调用旁路。

## 10. Workspace 模型

每个 Runner Plugin 有自己的 logical workspace，但属于同一个稳定 Workspace：

```text
Workspace A
├─ core/workspace/
├─ plugins/plugin1/workspace/
├─ plugins/plugin2/workspace/
└─ .control/workspace-acl.json
```

`.control` 只允许 Runner Core 访问。

Runner Plugin sandbox 不直接 bind 真实 workspace。Plugin 必须调用 Workspace SDK：

```ts
workspace.read(targetPluginId, path);
workspace.write(targetPluginId, path, value);
workspace.list(targetPluginId, path);
workspace.stat(targetPluginId, path);
workspace.mkdir(targetPluginId, path);
workspace.rename(targetPluginId, path, destinationPath);
workspace.remove(targetPluginId, path);
```

Runner Plugin Host↔sandbox 当前使用 `protocolVersion=2` 的二进制 framing，而不是 newline JSON + Base64：固定 16-byte header 携带 frame type/requestId/payload length；控制消息是最大 256 KiB 的 JSON frame，`workspace.read/write` 数据是最大 16 MiB 的 raw binary frame。该 16 MiB 是 Plugin SDK 单次内存调用上限，不是 Host Workspace↔Artifact bridge 上限。

调用例子：

```ts
workspace.read('plugin1', '/output/report.json');
```

Host 实际绑定：

```text
workspaceId + generation
callerPluginId   // Host 根据当前 sandbox 绑定，插件不能传
 targetPluginId  // plugin1
path             // /output/report.json
permission       // read
```

### 10.1 Workspace ACL

跨 Plugin 默认 deny。

权限由**目标 workspace**的 ACL 决定：

```ts
interface WorkspaceGrant {
  targetPluginId: string;
  principalPluginId: string;
  path: string;
  permissions: ('read' | 'write' | 'list' | 'delete')[];
}
```

自己的 workspace 默认允许；访问其他 Plugin 时必须匹配 target workspace grant。

例如：

```text
target: plugin1
principal: plugin2
path: /output/**
permissions: [read]
```

则：

```text
plugin2 -> plugin1:/output/report.json read  ✅
plugin2 -> plugin1:/private/a.txt       read  ❌
plugin2 -> plugin1:/output/report.json write ❌
```

### 10.2 不复制

跨 Plugin 授权读取的是同一份底层文件：

```text
plugin1 workspace file
       ↑
       │ Workspace Broker
       │
plugin2
```

不 copy/paste、不生成第二份副本。

撤销 grant 后访问立即失败，原文件仍属于 plugin1 workspace。

`rename` 权限语义：源路径要求 `delete`，目标路径要求 `write`。

所有路径都是目标 workspace 内的逻辑绝对路径。拒绝：

- `..` traversal；
- Runner/宿主真实绝对路径；
- symlink escape；
- 跨 Workspace target。

## 11. Workspace ↔ Artifact bridge

Workspace 是稳定 mutable working data；Generation 只承载当前 Profile 的运行实例。Artifact 是长期 durable result。

两者转换由 Backend Agent 顶层 `exchange` 子域负责，不让 Workspace Runtime 反向依赖 Artifact，也不把 Artifact SDK 直接交给 Runner Plugin。

代码位置：

```text
packages/backend/src/modules/agent/exchange/
├─ workspace-artifact.service.ts
└─ workspace-artifact.types.ts
```

当前语义：

```text
workspace -> artifact
requires workspace.runtime.execute + artifacts.write

artifact -> workspace
requires workspace.runtime.execute + artifacts.read
```

Backend 先验证 `scope + workspaceId + generation + targetPluginId`，然后通过 Runner Controller 受控读写目标 workspace。Host-only bridge 使用 `application/octet-stream` streaming：GET 在 Runner 打开并 `fstat` 文件后以 read handle 固定本次读取对象，Backend 消费完/失败/timeout 都关闭；PUT 必须有 `Content-Length`，Runner 写同目录临时文件、精确校验长度、`fsync` 后原子 rename，失败清理临时文件。Backend 不再使用整文件 `arrayBuffer()` / `Buffer.concat()`。

当前 Runner Host transport hard cap：256 MiB；Artifact 自身单文件、总量和磁盘 quota 仍独立生效。Artifact→Workspace 按 Artifact 8 MiB range 上限分段读取并连续传输，因此 bridge 可以真实处理 >16 MiB 文件而不把大文件塞进 JSON/Base64。

注意：Workspace↔Artifact 是生命周期转换，因此会创建/写入另一个 durable Artifact；它和同 Workspace 内跨 Plugin logical workspace 共享不是同一机制，transfer handle 也不会暴露给 Frontend/Plugin/模型。

### 11.1 当前四条 binary/data transport 边界

本轮把相邻 Nexus SSH/Workspace 一起纳入架构审核后，当前必须同时记住四条独立 transport：

```text
Browser ↔ Nexus Workspace
  NXW1 / binaryProtocolVersion=1
  JSON control <= 1 MiB
  server binary frame payload <= 256 KiB
  terminal + request-scoped file/history response

Browser → /ws/uploads
  one upload = one raw binary socket
  不套 NXW1

Runner Plugin sandbox ↔ Runner Host
  NXR2 / plugin protocolVersion=2
  JSON control <= 256 KiB
  SDK workspace binary <= 16 MiB / call

Backend ↔ nexus-agent-runner
  authenticated Controller HTTP
  workspace bridge = application/octet-stream streaming
  hard cap = 256 MiB
```

它们不共享 magic、requestId 类型、协议版本和 lifecycle；`NXW1 v1` 与 Plugin Frontend/Backend target 的 `protocolVersion=1` 也没有兼容关系。共同原则只有：有界、raw bytes、可取消/backpressure、错误 fail closed、不把文件 bytes Base64 内联进 JSON。Workspace 与 Agent 能复用 Platform filesystem/execution capability，但不能复用彼此 live socket、PTY/SFTP、cwd、ExecutionSession 或 Runner workspace handle。

## 12. Pack

Runner Pack 是 immutable/versioned toolchain：

```text
node
python
go
jdk
chromium
kubectl
terraform
...
```

Workspace Profile 使用 Recipe + 精确 Pack refs。Pack 共享 immutable store，但 Workspace generation/Plugin 不能修改 Pack。

目标是让 Workspace Profile 描述“需要什么运行能力”，而不是把 Node/Python/JDK 映射成不同 Docker image。

## 13. Artifact / AppStorage / Workspace 分工

```text
Workspace
= Workspace 中 mutable working data

Artifact
= durable file/result

AppStorage
= App/Plugin 长期小型结构化 KV state
```

典型：

```text
node_modules / build tmp / plugin output -> Workspace
report.pdf / patch.diff / screenshot.png -> Artifact
cursor / config / plugin state -> AppStorage
```

Workspace generation delete 不应自动删除 Artifact、AppStorage 或稳定 Workspace 文件。

## 14. Subagent / Multi-Agent

多 Agent 使用同一 Run 内多个 AgentRuntime participant：

```text
Run
├─ Coordinator Runtime
├─ Worker Runtime
└─ Reviewer Runtime
```

协作通过：

- Mailbox；
- SharedFacts；
- Artifact refs。

不共享直接内存、DB handle、Workspace generation process handle。

Handoff 可以作为调度语义，但不能取代 AgentRuntime participant 模型。

## 15. 后续功能扩展分类规则

增加功能前先分类：

```text
产品组合                 -> App
代码运行位置             -> frontend/backend/runner target
Agent 能做的一件事       -> Capability / Tool
运行所需软件             -> Pack
一次隔离运行实例         -> Workspace generation
执行中 mutable 文件      -> Workspace
长期文件/结果            -> Artifact
长期小状态               -> AppStorage
另一个 Agent 参与者      -> AgentRuntime / Subagent
外部协议                 -> Integration adapter
知识/操作说明            -> Skill
长期可召回事实           -> Memory
```

不要因为新增业务就再增加新的 Plugin target 或与现有概念重叠的一级 Runtime 实体。

## 16. 当前代码位置

仓库：

```text
/home/agentdock/AgentDock/nexus-terminal
```

主要路径：

```text
Backend Agent
packages/backend/src/modules/agent/
packages/backend/src/infrastructure/agent/
packages/backend/src/interfaces/http/agent/
packages/backend/src/bootstrap/agent/

Runtime
packages/backend/src/modules/agent/runtime/

Runner
packages/agent-runner/src/

Frontend Agent
packages/frontend/src/features/agent/

Plugin Frontend host
packages/frontend/src/features/agent/host/

Agent docs
doc/architecture/agent/
```

重要实现文件：

```text
packages/backend/src/modules/agent/capabilities/tool-catalog.ts
packages/backend/src/modules/agent/apps/operations/workspace-runtime-management-tools.ts
packages/backend/src/modules/agent/runtime/planning/
packages/backend/src/modules/agent/exchange/
packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service.ts
packages/backend/src/modules/agent/host/plugin-install.service.ts
packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter.ts
packages/backend/src/infrastructure/agent/plugins/plugin-backend-sandbox.worker.ts
packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter.ts

packages/agent-runner/src/controller/sandbox-engine.ts
packages/agent-runner/src/controller/plugin-runner-runtime.ts
packages/agent-runner/src/controller/workspace-broker.ts
packages/agent-runner/src/controller/server.ts
packages/agent-runner/src/worker/plugin-runner-sandbox.worker.ts

packages/frontend/src/features/agent/runtime/TaskRail.vue
packages/frontend/src/features/agent/host/app-bridge.ts
packages/frontend/src/features/agent/api/agent-api.ts
```

## 17. 已完成的近期调整

当前工作树里已经包含：

- Runner 移除 Docker socket / nested Docker / dockerode；
- `EngineClient` 改为 Runner 内部 `SandboxEngine`；
- Plugin package 使用显式 `targets.frontend/backend/runner`；
- Frontend Plugin 不再单独创建 `plugin-ui` Docker；
- Backend Plugin 在 Backend 内部 process sandbox；
- Runner Plugin 按 Workspace Profile 显式选择并冻结到 generation；
- `runner_plugins_json` 持久化；
- Workspace target ACL；
- Workspace `read/write/list/stat/mkdir/rename/remove`；
- Workspace caller identity Host-bound；
- Workspace↔Artifact bridge；
- Runtime 一级子域拆分；
- PlanItem 与 Runtime Step 分离；
- Capability Contribution；
- Agent `workspace_create` Tool 支持明确 `runnerPluginIds`；
- Frontend Agent plan 使用 `AgentRunPlan`，TaskRail 直接展示 PlanItem；
- Frontend architecture checker 增加 Agent `host/api/ai/files/runtime/settings/apps/operations/public` 子域依赖矩阵；
- Nexus Workspace `NXW1 v1` binary framing 与 SSH/SFTP Base64 data-path 清理；
- Agent 长期规范、Backend/Frontend 总架构和 SRS/FR 已按当前实现重新对齐。

近期验证中已通过过：

```text
agent-runner build
backend build
backend architecture check
frontend architecture/i18n/typecheck/build（前一轮）
migration smoke
workspace ACL smoke
git diff --check（前一轮）
```

最新 Backend architecture check 为：

```text
383 files
no forbidden layer edges
no source cycles
no module cycles
```

## 18. 本轮架构审核后的当前状态与后续项

截至 2026-09-11，核心 Agent/Workspace Runtime/Plugin 架构基线已经收敛，但不能把所有 Phase 3 文件的存在都视为完整产品接线。以下按“已进入 live composition / 部分实现 / 验证受限”记录当前事实。

1. Plugin SDK contract：**完成**。
   - Frontend descriptor 明确返回安装包 `sdkVersion + protocolVersion=1`，Frontend 建立 bridge 前校验；
   - Backend activation context 固定 `schemaVersion=1 + protocolVersion=1 + pluginId/version/sdkVersion`，sandbox `runtime.ready` 回报 `sdkVersion/protocolVersion` 并由 Host fail-closed 校验；
   - Runner frozen target 当前固定 `{pluginId,version,sdkVersion,protocolVersion=2,packageHash,entry}`，Workspace generation start/reconcile 使用冻结值，Runner sandbox activation/`runtime.ready` 再次校验；旧 protocol generation 不自动升级；
   - Runner protocol v2 使用 16-byte framed IPC：bounded JSON control + raw binary workspace frame，已去掉 workspace Base64 IPC；
   - 没有声明尚未实现的未来 SDK，也没有通用 method dispatcher。

2. Frontend TaskRail PlanItem：**完成**。
   - PlanItem 保持 typed projection，不回退 JSON dump；
   - PlanItem status、depends/evidence 标签、Run status 与 verification status 均已进入 Agent 三语 i18n，不再直接显示内部枚举作为用户文案。

3. Workspace Runtime 产品 API/UI：**完成当前 bounded contract**。
   - root Run Workspace 列表使用 `?runtime=root` 由 Backend 解析 root runtime；创建请求不接受浏览器提供 `agentRuntimeId`；
   - `WorkspaceRuntimePanel` 提供 Recipe、显式 Runner Plugin target 选择，以及 start/stop/restart/delete/tool version switch；
   - 同一 AgentRuntime 最多一个非 `deleted/failed` root Workspace；failed/deleted 后允许重建，Service 与 repository 语义一致；
   - Workspace grant 管理由目标 workspace ACL 决定，跨 Plugin 默认 deny；target/principal 必须属于同一 Workspace generation 冻结的 Runner targets；
   - Workspace↔Artifact 产品入口已接入 Frontend，仍通过 Backend `agent/exchange` 并重新检查 `workspace.runtime.execute + artifacts.write/read`；Frontend API 不变，底层已升级为 Host-only binary streaming。

4. Capability Catalog：**保持完成态约束**。
   - 新增 capability 继续通过 `CapabilityContribution` 注册；
   - Workspace Runtime 管理与执行能力保持 `workspace.runtime.manage` / `workspace.runtime.execute` 分离；
   - 不创建万能字符串 registry，不让 Frontend/Plugin/MCP/Runner 形成真实副作用旁路。

5. Workspace 大文件：**当前 stream/handle 收尾完成**。
   - Runner Plugin SDK 的单次 `workspace.read/write` 仍保持 16 MiB binary frame 上限，避免单 IPC 无界内存占用；
   - Backend↔Runner Host bridge 已改为 `application/octet-stream` streaming，read handle/写临时文件生命周期有界，不再 `arrayBuffer()/Buffer.concat()`；
   - Runner Host transport hard cap 为 256 MiB，PUT 必须声明精确 `Content-Length`，超限/长度不匹配 fail closed；Artifact quota/limit 继续独立生效；
   - Artifact→Workspace 按 8 MiB Artifact range 分段读取，20 MiB+ 本地 smoke 已验证，未通过放大 Base64/JSON 上限实现。

6. 长期规范：**完成同步**。
   - `ARCHITECTURE.md` 与 `IMPLEMENTATION.md` 已同步三 target SDK/protocol freeze、Workspace root 产品入口、Runner target、Workspace ACL、Workspace↔Artifact 与 Capability 边界。

7. 本地/远程验证状态：
   - `packages/agent-runner` build：**通过**；Backend build：**通过**；Frontend architecture/i18n/`vue-tsc`/Vite/bundle budget：**通过（318 source files；2255 i18n keys / 3 locales / 84 fragments；Initial JS 209.4/260.0 KiB gzip）**；
   - Backend architecture：**通过（426 files，无 forbidden layer edge/source cycle/module cycle）**；
   - root package-management guard：**通过**；root test policy：**通过（72 E2E spec files / 66 functional screenshot declarations）**；
   - E2E groups generator/check：**通过（70 grouped specs / 8 groups，exactly once）**；
   - migration 53 专项 E2E：**本地通过**，验证旧 `artifact_app_id/artifact_id` stage 无损迁移到 `source_kind/source_json` 并保留 hash/size/status/timestamp/CAS version；
   - `pnpm run format:check`、`git diff --check`、Backend architecture、package-management、test-policy、Docker smoke/host-prepare shell syntax 与完整 Frontend build：**通过**；
   - 当前宿主 Node `v22.17.0` 低于仓库声明的 Node `>=24`，pnpm 命令会产生预期 engine warning；Node 24 CI 为最终权威；
   - 当前宿主 Chromium 仍缺 `libglib-2.0.so.0`，且本机没有可作为 production evidence 的 Docker/bubblewrap 环境，因此 Browser UI 全量与 production Docker smoke 不在本机伪造通过；当前 Agent workspace/Settings UI 产品验收以产品代码 SHA `3fdc273621c9` 为准：GitHub Actions run `34678153826` 整体 **success**，Docker deployment smoke 与 Playwright groups 1–8 全部 **success**，日志无 `retry=1`/flaky marker。该 SHA 在既有 Conversation-first surface 上完成多 App activity quick-switch、每 App Thread/draft/next-Run model 轻量状态恢复、会话本地搜索与 selected→active→updatedAt 排序、下一次 Run 模型/当前冻结模型区分、typed Plan 进度与等待态，以及 Agent Settings 分组导航/概览/默认模型与折叠 capability grant；E2E 真实验证切到 Operations 再切回 Developer 后 Thread、draft、next-Run model 保留，并验证默认模型通过 production Settings PATCH/GET 持久化。后续 `54e6f4b` 仅为 timing/group rebalance `[skip ci]`。
   - 当前功能截图验收以 `workflow_dispatch` run `34678360509` 为证据：Docker smoke、8 个 Playwright groups、`Commit functional screenshots` 与 rebalance job 均为 **success**；verifier 对 source SHA `54e6f4bc57ce2b5045b8454f66d75d4249558641` 明确报告 `66/66`。截图由生成提交 `805f2cf` 刷新进 `doc/imgs/e2e/`。Agent 功能截图现有 9 张：8 张 `1440×900`（`agent-developer-preset.png`、`agent-run-history.png`、`agent-run-details.png`、`agent-checkpoint-recovery.png`、`agent-artifact-library.png`、`agent-settings-overview.png`、`agent-settings-subagents.png`、`agent-settings-runtime.png`）以及窄布局 `agent-approval-narrow.png` `1000×800`；9 张 PNG header/文件大小与 SHA-256 已在同步后独立复核。

8. 相邻 Nexus SSH/Workspace binary transport：**完成 Base64 data-path 清理**。
   - `/ws/workspace` 使用独立 `binaryProtocolVersion=1`，固定 16-byte header 区分 terminal 与 request-scoped response；binary response 通过 requestId/final 分片重组，每个 payload frame 最大 256 KiB；
   - `filesystem.readText` raw snapshot、`filesystem.readBinary` 与 `suspend.history.previous` 不再返回 `rawContentBase64/contentBase64/dataBase64`，统一走 raw binary frame；
   - File Editor 持有 `Uint8Array rawContent`，encoding reinterpret 不再执行 `atob/btoa`；upload 继续使用既有独立 `/ws/uploads` raw binary transport；
   - 现有 SSH E2E helper/spec 已同步 framing；700 KiB raw upload→SFTP→多帧 binary read round-trip 通过，request-only suspend/resume history 用例通过；浏览器 UI E2E 仍受上述宿主 Chromium `libglib-2.0.so.0` 缺失限制。

9. Phase 3 / preset 接线状态：**MCP / ACP / Browser-CDP / Subagent / Memory / Plugin / Workspace local Terminal 均已进入当前 composition**。
   - MCP：`McpAdapter` 由 `compose-agent.ts` 创建，refresh 后用 owned contribution 注入 scoped MCP tools；
   - ACP：Operations manifest 声明 `integration.acp.execute`；`compose-agent.ts` 构造 `AcpAdapter` 并注册 `acp_execute`。外层 tool 是 mutation，经过 Capability/Policy/Approval/Lease/StateCommit；Runner `AcpProcessRuntime` 只在冻结 Workspace generation/profile 中 spawn ACP backend。ACP direct fs/terminal deny，nested permission 当前固定 `reject_once` fail closed；
   - Browser：Operations manifest 声明 `browser.operate`；`BrowserRuntimeAdapter` 在 Backend 持有 Puppeteer/BrowserContext/Page/CDPSession 与 semantic operation。`via=backend` 直接连接配置 CDP；`via=runner` 只借 Runner `BrowserTunnelRuntime` 转发 bounded text CDP frame。Runner 不拥有 Browser session/snapshot/click/type，因此 Runner unavailable 不阻断 standalone direct target；
   - Browser data plane：target 支持 `docker-network | external-network` reachability 与独立 `allowPlaintext/verifyTls`；Agent 不提交 raw endpoint。Page request interception 检查 HTTP(S) navigation/redirect/subresource allowlist，popup close、download deny，navigate/click/type 后 nodeRef stale；
   - Workspace local Terminal：`/ws/agent-terminal` + `WorkspaceRuntimeTerminalService` + `WorkspaceRuntimeInteractiveSessionPort` + `RunnerWorkspaceTerminalAdapter` + Runner `WorkspaceTerminalRuntime`/Dropbear 已 live，支持 detach/attach/replay/resize/signal/close，并随 generation teardown；
   - Subagent/Memory：repository、policy/service/scheduler、mailbox/shared facts、Memory review/import 继续由 composition root 组装并暴露窄 facade；
   - Plugin：manifest 新增 versioned `agents[]`；安装/升级/卸载通过 hook 动态注册 AgentDefinition。无 Frontend target 且声明 AgentDefinition 的插件使用 host-owned generic Agent surface；自定义 Frontend target 继续 isolated iframe；
   - Remote Plugin：Agent Settings 配置 repository；Backend 以 OutboundPolicy + DNS pinning + redirect deny + bounded HTTP 读取 catalog/package，stage 先校验 catalog size/SHA-256，再进入显式 trusted publisher + Ed25519 signature + `files.json` hash 链。catalog discovery 不等于 publisher trust；migration 53 将 stage source 泛化为 artifact/remote；
   - 首个官方 preset：独立仓库 `0honus0/nexus-agent-plugins` 的 `plugins/nexus.developer/`，App `nexus.developer`，AgentDefinition `developer.default`，只携带 manifest + Skill，使用 generic Agent UI。插件仓的 `scripts/build-package.mjs` 用仓库外 Ed25519 私钥生成可复现签名包和 release catalog；主仓普通 E2E 使用 `packages/e2e/fixtures/agent/plugin-source/nexus.developer/` 的协议 fixture，不依赖外部仓库网络，再覆盖远程 catalog → trust → stage/verify/install → enable → dynamic AgentDefinition → real Run → `agent-developer-preset.png`。

10. 本轮文档/guard 审核：**已修正已知正式矛盾**。

- SRS/FR 不再描述 Runner 持 Docker Engine 或每 Workspace generation 创建子容器；当前正式模型是 Runner 内部 Sandbox Manager，Runner/Backend/work sandbox 都没有 Docker socket/dockerd/nested Docker；
- Frontend 总架构已对齐真实 `features/agent/{host,api,ai,files,runtime,settings,apps/operations}` owner，不再保留平行的虚构 App/AI package 结构；
- Frontend architecture checker 已补 Agent 子域 guard，与长期架构中“前后端都检查 Agent 子目录”的要求一致；
- `ARCHITECTURE.md` / `IMPLEMENTATION.md` 不再保留“Agent 尚未开工 / software-requirements 尚未同步”的历史前言；
- `NXW1`、`/ws/uploads`、`NXR2`、Backend↔Runner HTTP streaming 已冻结为彼此独立的 transport contract。

11. Workspace mixed-mode lease：**完成并通过远程 Actions 验收**。
    - `LeasePort.acquireMany(owner, keys, mode)` 保留为同 mode convenience API，底层新增单事务 `acquireResources([{resourceKey,mode}])`，重复 key 按 write 优先合并；
    - `MutationGuardRequest.ownerId` 保持稳定 actor identity，并发长 mutation 使用独立 `leaseOwnerId` 表达具体 holder，避免把 actor 与 operation identity 混在一起；
    - upload/compress 对可证明唯一写目标使用 connection root read + canonical file write；decompress/copy-move/upload prepare 等宽写集合继续 connection root write；
    - mixed-mode root read 也记录 active mutation；未知结果同时 quarantine root coordination key 与精确 write key；
    - Platform 新增统一 absolute remote path canonicalization，Archive/Upload/Transfer/Workspace lease key 与真实 I/O 使用同一规范化规则；
    - GitHub Actions run `34498027448`（HEAD `e62847c`）整体 success，8 个 Playwright groups 全绿；新增同 Workspace 两个不同 ZIP 目标并发用例 1.6s passed，group 5 为 52 passed、group 3 为 37 passed、group 4 为 16 passed，并覆盖 archive overlap、mobile progress、multi-file upload 与 slow-SFTP batch。

12. Root execution owner 收敛：**本轮代码已完成，本地完整门禁通过**。
    - `NativeAgentBackend` 构造依赖由 13 项收敛为 6 项，只直接持有 Run/Delegation snapshot、`StateCommitPort`、`ModelStepRunner`、`ToolCallRunner` 与 `ClockPort`；
    - `ModelStepRunner` 负责 Provider/model/Context/model stream/ModelCallLimiter 与 transport retry，`ToolCallRunner` 负责 Tool inspect/policy、read lease 与 Tool execution；
    - Agent mutation 使用独立 staged `MutationLeaseGuardPort`，底层 `LeasePort` 只存在于 infrastructure adapter；顺序固定为 `lease acquire → StateCommit.beginMutationTool → mark active → side effect → StateCommit.settleMutationTool → settle/release 或 quarantine`；
    - Backend architecture checker 禁止 `NativeAgentBackend` 重新直接依赖 Provider/Context/Tool/Lease execution services 或调用 mutation lease marker；
    - Backend/Frontend architecture + build、Agent Runtime build、test-policy、70 specs/8 groups assignment、sandbox prerequisite、shell syntax 与 `git diff --check` 均已通过；最终远端产品证据见上文验证状态中的产品代码 SHA `a15cf3bb3b29`。

13. Child execution owner 收敛：**完成并通过远端 Actions 验收**。
    - `SubagentScheduler` 从接近 1000 行收敛为 durable work scheduler，只负责 scope/fairness/capacity、`ready/terminal` scan、claim CAS、active tracking 与 quiesce；
    - 已 claim 的 `model_step/tool_step/consume_inbox/terminal` execution 进入 `SubagentParticipantExecutor`，其 durable Run/Runtime/Delegation/Step/Tool 状态仍显式经 `StateCommitPort`；
    - `SubagentContextBuilder` 独立负责 runtime/mailbox/tool-history context、child tool schema 与 context/token limit，避免 context assembly 继续长在 Scheduler 中；
    - 不采用只把五个 Repository Port 包成两个 Store facade 的方案，也不新增会隐藏 StateCommit authority 的 `SubagentWorkCoordinator`；
    - Backend architecture checker 禁止 Provider/Model/Tool/Lease/StateCommit/collaboration repository 回流 `SubagentScheduler`，并禁止 participant executor 获取 `readyWork/terminalWork/claimWork/resetClaimedWork` durable scan/claim authority。
    - Collaboration persistence 进一步按 consumer authority 收窄：Root 只拿 `DelegationReaderPort`，Participant 拿 `DelegationCancellationPort`、`MailboxConsumerPort` 与 `SchedulerWorkExecutionPort`，Scheduler 拿 `SchedulerWorkClaimPort`，ContextBuilder 只拿 `MailboxReaderPort`；未使用的 `claimNextWork()` 已删除，不为 roadmap 假设保留 API。
    - GitHub Actions run `34579244526`（产品代码 HEAD `9f4ffbd`）整体 success，Docker deployment smoke 与 8 个 Playwright groups 全部通过；随后只生成 E2E timing/group rebalance `[skip ci]` 提交。
    - GitHub Actions run `34576022008`（产品代码 HEAD `15f821b`）整体 success，Docker deployment smoke 与 8 个 Playwright groups 全部通过；随后只生成 E2E timing/group rebalance `[skip ci]` 提交。

14. Architecture guard coverage：**已补齐当前已知 owner/phase 防回退缺口**。
    - 整个 Agent Runtime 禁止直接调用底层 mutation lease marker；
    - `SubagentScheduler` 禁止取得 `RelationalDatabase` / `.transaction()` authority；
    - StateCommit `*-transitions.ts` 的导出 transition 必须以 `tx: RelationalDatabase` 为首参数，且不得自行开启 transaction；
    - ACP/Browser architecture guard 已从“禁止 live wiring”切换为**约束 live owner**：Operations manifest 必须保留对应 capability，`compose-agent.ts` 只经 tool-contribution seam 注册；Browser semantic runtime 固定在 Backend adapter，Runner 只允许 tunnel/runtime transport，不得出现第二套 Puppeteer semantic owner；
    - `NativeAgentBackend` 的 SQLite/Express/Runner concrete dependency 已由既有 layer / technology-package checker 覆盖，不再增加重复专用规则。

15. Composition Root Tool contribution owner：**已收敛**。
    - `compose-agent.ts` 不再直接 import Operations Tool creator，也不再手写 machine/workspace/runtime/MCP contribution metadata；
    - `bootstrap/agent/tool-contributions.ts` 只负责把已构造 Port/Service 注册为 Tool contribution，并维护 MCP owned contribution hook；
    - `ToolCatalog.registerContribution()` 只接受静态 contribution；动态 scoped ownership 只能走 `replaceOwnedContribution()/removeOwned()`，避免公开 API 暗含 scope/owner 双重语义；无 consumer 的 contribution introspection API 已删除；
    - scheduler、StateCommit、Policy/Lease、lifecycle 与 `AgentServices` facade 仍留在真正 composition root，不为缩行数拆成二次业务 facade；
    - Backend architecture checker 禁止 Operations Tool creator、`registerContribution()` / `replaceOwnedContribution()` 重新直接进入 `compose-agent.ts`。
    - GitHub Actions run `34581381495`（产品代码 HEAD `af04bf7`）整体 success，Docker deployment smoke 与 8 个 Playwright groups 全部通过；随后只生成 E2E timing/group rebalance `[skip ci]` 提交。
    - GitHub Actions run `34584611396`（产品代码 HEAD `aaff050`）整体 success，Docker deployment smoke 与 8 个 Playwright groups 全部通过；随后只生成 E2E timing/group rebalance `[skip ci]` 提交。

16. Frontend Host / builtin App ownership：**已收敛**。
    - `AgentHubWindow.vue` 不再直接 import 任何 builtin App view；通用 Conversation/TaskRail/Workspace composition 已提升为 `host/AgentAppSurface.vue`；
    - Operations 通过 `apps/operations/public.ts` lazy export host-owned `AgentAppSurface`，`host/builtin-apps.ts` 仍是唯一静态 builtin composition seam；声明 `agents[]` 且无 Frontend target 的安装式 App 直接复用 `AgentAppSurface`，自定义 Frontend target 才走 `PluginAppFrame`；
    - Frontend architecture checker 默认禁止 `host/** -> apps/**`，仅允许 `host/builtin-apps.ts -> apps/<app>/public.ts`，因此 Host 无法重新依赖 App 私有组件。
    - GitHub Actions run `34582398075`（产品代码 HEAD `debdac1`）整体 success，Docker deployment smoke 与 8 个 Playwright groups 全部通过；随后只生成 E2E timing/group rebalance `[skip ci]` 提交。

17. Run read least-authority：**已收敛**。
    - broad `RunRepositoryPort` 已删除，`SqliteRunRepository` 仍是单一 concrete adapter，但分别实现 `RunSnapshotReaderPort`、`RunQueryPort`、`RunExecutionReaderPort`、`RunEventReaderPort`、`HostCursorReaderPort`；
    - Plan/Approval/Checkpoint/Subagent participant 只拿 snapshot；`SubagentService` 只拿 snapshot + host cursor；`RunService` 只拿 snapshot + list；`NativeAgentBackend` 只拿 `snapshot/rootRuntimeId/pendingMutation`；
    - 无产品 consumer 的 `createdQueue()` 已删除，后继若需要必须按新的 durable owner 重新引入；
    - Backend architecture checker 禁止 broad Run repository/dead queue API 回流，并固定核心 consumer 的 reader 上限；StateCommit 的单一 durable mutation authority 与 snapshot transaction 语义未改变。
    - GitHub Actions run `34583565258`（产品代码 HEAD `5234c32`）整体 success，Docker deployment smoke 与 8 个 Playwright groups 全部通过；随后只生成 E2E timing/group rebalance `[skip ci]` 提交。

继续开发时不要为让本机 E2E 变绿而改 `reuseExistingServer`、跳过浏览器项目、降低 sandbox/Capability 门槛或引入 Plugin Docker；环境证据与产品 contract 必须分开处理。

## 19. 开发约束

继续开发时保持：

- 新增正式能力必须补产品 E2E；测试只使用公开 API/UI/真实 downstream fixture，不从 application source import 或读取 fixture 内部计数充当 oracle。
- 只格式化/修改本次 Agent 相关文件。
- Runner 不重新拿 Docker socket。
- Plugin 不创建额外 Docker。
- 不把 Node `vm/worker_threads/cwd` 单独宣称为 hostile plugin 安全边界。
- 如果高风险 sandbox primitive 不可用，fail closed。
- Backend 决定 Capability/Policy/状态提交与 Browser semantic authority；Runner 只持 Workspace sandbox/process/transport authority；Frontend 决定交互，不自行推进 durable 状态。

## 20. 一句话架构基线

> Nexus Agent 是一个以 Backend 为 durable/control plane 与 Browser semantic plane、以**可选** `nexus-agent-runner` 为 Workspace sandbox/process/transport plane、以 Frontend 为 interaction plane 的 Agent Platform；Plugin 通过明确 `frontend/backend/runner` target、可选 versioned `agents[]` 与 target-specific SDK 扩展，Runtime 保持 `Thread → Run → AgentRuntime → Step`，真实副作用统一进入 Capability/StateCommit，Workspace 内 Plugin logical workspace 默认隔离，长期结果通过 Artifact 管理，Runner 永远不以 Docker socket/nested Docker 作为执行基础设施。
