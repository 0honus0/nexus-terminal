# Nexus Agent 架构设计

版本：2.1。范围：Agent Runtime、AI Platform、App Platform 与 Nexus 的集成设计；实现细节见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。本文与 IMPLEMENTATION.md 是 Agent 长期规范源；当前源码落地、接线状态和验证证据以 [CURRENT_AGENT_ARCHITECTURE.md](CURRENT_AGENT_ARCHITECTURE.md) 为实现快照，并与软件需求状态保持同步。设计条目本身不能被当作“已经验收”的证据。

## 1. 产品边界与三期范围

当前是单管理员产品：沿用 session.userId 的整数类型，不新增 tenant、组织、角色体系。App 是数据与能力隔离边界，不是多用户功能。nexus.operations 随发行版默认 enabled；没有 Provider 时 health=degraded，展示配置引导，不影响原 Workspace、连接管理或远程桌面。

Agent 默认可以选择全部当前及未来连接；全局 connection denylist 优先拒绝，审批不能覆盖。此默认值只影响目标可访问性，不意味着全部动作免审批。第三方 App 还必须获得 manifest 所声明的 capability grant。

| 阶段    | 实际交付                                                                                                                                                                                                  | 不交付                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Phase 1 | 静态 App Host、Operations、Provider 配置、Thread/Run/流式会话、只读诊断/文件读取、Artifact、只读 Recall、内置 Skill、Launcher/Hub、恢复与审计；Workspace Runtime availability 占位                        | 真实 Runner sandbox、远端 mutation、动态插件、MCP/ACP/CDP、多 Agent |
| Phase 2 | Policy/Approval/Lease 完整修改闭环、文件变更、受审批 Shell/远端 Docker、Workspace Runtime Controller、稳定 Workspace + Profile/Generation、多版本 Tool Store、UI/AI 启停删、checkpoint、运行资源配额/固化 | 浏览器自动化和外部协议 Agent                                        |
| Phase 3 | Browser/CDP、MCP、ACP、多 Agent、经审核 Memory 写入、安装式 App/Skill、Frontend/Backend/Runner 三目标 sandbox                                                                                             | 未隔离上传代码直接进入 Core、无限自治或绕过审批                     |

> **当前 Phase 3 接线状态（dev）**：MCP 已进入 live composition；**ACP 未完成**，只保留 integration schema、capability type、Port/Adapter skeleton，当前 `nexus.operations` manifest 不声明 `integration.acp.execute`、不创建默认 grant；**Browser/CDP/Puppeteer 未完成**，只保留 Browser ports、`PuppeteerBrowserGateway` 与 Workspace/browser 设计骨架，当前 manifest 不声明 `browser.operate`、Tool Catalog/composition root 不接入 live execution。两项在完成正式接线、授权、E2E 前都只能视为 `reserved / roadmap-only`，不得因源码中存在 Adapter/Port 而标记为已交付。

Workspace Runtime 是受限本地执行能力；稳定实体是 `Workspace`，运行配置由 `WorkspaceProfile` 冻结，实际运行实例由 `generation` 标识。Runner sandbox 只是 generation 的实现细节，不把 Docker 当作本地执行模型，也不使用裸 `/api/v1/runtime`。Workspace Runtime availability 是设置页的真实消费者；Runner 未配置或 sandbox primitive 不可用时返回 unavailable/degraded，不能回退为宿主裸进程。

适用工程边界引用 [EC-REQ-001、EC-ARCH-001/009、EC-RUNTIME-003/004/005、EC-E2E-001/002](../../software-requirements/engineering-constraints.md)。已定义正式契约不等于已实现产品；软件需求/FR/SRS 已进入正式 Agent 实现基线，后续架构调整必须同步需求、实现快照和对应验证证据，不能只改设计文档或只凭源码目录判断交付状态。

## 2. 分层、源码 owner 与设计理由

```text
App.vue → features/agent/host → 当前 App contribution
                     ↓ Agent HTTP / SSE
interfaces/http/agent
                     ↓ 注入的 use cases
modules/agent/
  host          App 安装/启停/grant/SDK，不能调用某 App 私有实现
  runtime       Run/参与者/Harness/调度/Event/Checkpoint
  ai            Provider/Conversation/Context/Artifact/Recall/Skill/Tool catalog
  capabilities  检查/授权/Policy/Approval/Lease/目标/机器 facade
  workspace-runtime  Workspace/Profile/Generation、Runner 控制与 ports
  apps/operations  仅运维定义、工具与业务策略 contribution
                     ↓ typed ports
既有 Modules diagnostics/connections + Platform execution/filesystem/docker
                     ↑ adapters
infrastructure/agent/{repositories,providers,artifacts,workspace-runtime,integrations}
bootstrap/agent/compose-agent.ts 是具体依赖组装入口
```

通用 Harness 归 runtime，不放 ai/harness 或 apps/operations；AI 层只提供模型和上下文服务，不反向依赖 Run 调度。Policy、Approval、Lease 属于共享 capabilities，Operations 只提供风险分类和 verifier。HTTP/SSE 控制器统一在 interfaces/http/agent，不放 App domain。SQL、SDK、网络客户端只在 Infrastructure。

依赖图固定：apps → runtime/ai/capabilities/host/workspace-runtime 的 public 契约；Agent runtime → ai/capabilities/host 的 ports，不反向拥有 Workspace Runtime；workspace-runtime → host 的授权/Plugin target 契约；capabilities → host 的授权契约和既有机器能力；ai → host scope 类型；`agent/exchange` 可桥接 Workspace Runtime 与 Artifact，但两边不互相反向依赖。Workspace 控制 action 的安全编排通过 capabilities 注册的 Tool 实现，避免 workspace-runtime 与 capabilities 循环。跨 App 不准私有 import。Infrastructure 只 type-import module 的 _.types/_.port；Bootstrap 导入具体类。前后端 architecture checker 都要检查 Agent 子目录，而不只检查顶层 feature。

前端集中于 features/agent/{host,api,ai,files,runtime,settings,apps/operations}；公共会话/事件投影归 runtime，文件库归 files，Agent 宿主设置归 settings，Operations UI 通过 facade 使用。独立容器程序放 packages/agent-runtime；Docker 构建/运维辅助文件仅放 scripts/docker/agent-runtime。内置 App 不另建 npm workspace package。Frontend architecture guard 必须像 Backend 一样约束 Agent 子域依赖，而不能只把整个 `features/agent` 当成一个无内部边界的 feature。

### 2.1 成熟模块优先与自研边界

Agent 实现采用 **reuse-first** 原则：存在成熟、长期维护、许可证清晰且能准确表达当前契约的开源模块时，优先使用模块，不重复实现通用协议解析、标准格式校验、编码、虚拟列表等基础能力。自研只保留 Nexus/Agent 特有的事务语义、安全策略、状态机和跨资源一致性编排。

引入第三方模块前必须同时检查：

1. **维护成熟度**：优先多年维护、社区采用广、GitHub star/下载量有稳定积累、近一年仍有 release/commit/issue 维护的项目；只因“功能匹配”但长期无人维护的库不采用。
2. **许可证与供应链**：许可证必须与 Nexus 发行方式兼容（优先 MIT/ISC/BSD/Apache-2.0）；检查直接/传递依赖、安装脚本、已知安全问题和维护者变更，不引入来源不明的代码片段。
3. **契约匹配**：模块必须能在不弱化当前安全/正确性要求的前提下使用。若为了套库必须放宽 CAS、幂等、scope、审批、DNS 目标校验、Artifact 原子提交等边界，则保留自研。
4. **隔离依赖**：第三方库通过 Infrastructure/adapter 或纯 utility wrapper 使用，不把库私有类型扩散成 domain public API。替换库时不改变 Run/Event/Ledger/Artifact 等公开事实模型。
5. **体积与运行成本**：Frontend 依赖必须通过 bundle budget；Backend 依赖不得为了很小功能引入大而不透明的 runtime。优先小而专一、零/少依赖实现。
6. **可替换性**：依赖升级或移除不得要求重写核心业务状态。协议/格式库由 adapter 隔离；架构 checker 继续约束层间依赖。

当前基线决策：

| 能力                                                          | 基线选择                            | 边界                                                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SemVer 解析/比较                                              | `semver`（npm/node-semver）         | 替换自写 SemVer regex/比较；Manifest 的 App id、capability、路径和业务兼容性检查仍由 Host 负责                                                             |
| JSON Schema 校验                                              | `ajv`                               | 用于 Manifest、Tool/MCP 等结构化输入的 schema 校验；授权、risk classification、policy revision、scope 检查绝不交给 schema validator                        |
| HTTP Content-Disposition                                      | `content-disposition`               | 负责 RFC 兼容的文件名编码；Artifact owner/grant、Range、nosniff 和下载策略仍由 Agent 控制                                                                  |
| Agent Browser 事件通道                                        | 原生 WebSocket `/ws/agent`          | Host/Run 使用 subscription + durable sequence replay；`message.delta`/`tool.delta` 仅 ephemeral、无 durable sequence；不复用 Workspace socket              |
| Provider SSE 解析                                             | `eventsource-parser`                | 仅用于 Backend OpenAI-compatible Provider stream；Provider chunk/Tool 参数/usage 映射继续由 Provider adapter 负责                                          |
| 长列表虚拟化                                                  | `vue-virtual-scroller`              | Conversation / Artifact Library 等大列表使用 Dynamic/Recycle scroller；canonical cursor 分页、anchor 恢复与 streaming buffer 仍由 Agent runtime store 负责 |
| IP 地址分类                                                   | 继续复用 `ipaddr.js` + Node DNS/TLS | DNS rebinding/SSRF 防护是 Nexus policy 组合；集中到 `SafeOutboundClient/OutboundPolicy` adapter，不把“是否允许目标”委托给通用 HTTP 客户端                  |
| Hub drag/resize                                               | 暂不强制引入通用库                  | 只有候选库的维护/安全状态和 bundle 成本通过审计后才替换；现有 Foundation pointer/overlay 原语能满足窄需求时优先复用现有代码                                |
| Run Scheduler / StateCommit / idempotency / retry persistence | 自研                                | 与 SQLite 事务、Run version、input watermark、budget、reconciliation 强绑定，通用 queue/retry 库不能替代这些领域语义                                       |

每个 P1/P2/P3 子任务开工前先做一次轻量依赖复用扫描；若采用模块，在实施交接中记录包名、版本范围、许可证、采用理由和 adapter 边界；若已有成熟候选但决定自研，也要记录“不采用”的具体原因。

## 3. 实体、作用域与资源关系

```text
App → Thread(0..N) → Run(0..N)
Run → AgentRuntime(1..N；前两期为1，三期可按 delegation 动态增加参与者，执行并发统一受 maxConcurrentRuntimes 调度)
AgentRuntime → Workspace(0..1 active root Workspace；同一稳定 id 可有递增 Generation)
Run → PlanProjection(0..1) → PlanItem(0..64，依赖/evidence投影)
Run → Step → ModelAttempt / ToolCall → Approval(0..N历史，最多1个有效请求)
Run → DurableEvent、Checkpoint、ArtifactRef
Thread → LedgerEntry → UserInput / Message / ToolResult引用
```

Thread 可为空；同一 Thread 同时只有一个非终态 Run。Run 是预算、计划、取消和结果边界。AgentRuntime 是 participant 的一次执行身份，拥有独立模型引用、AbortSignal、execution owner；不等于进程、窗口或容器。Resume 创建带 parentRunId/checkpointRef 的新 Run，不复活旧执行栈，因此每 Run 的 participant 唯一约束不会与重启历史冲突。

`PlanItem` 与 Runtime `Step` 明确分离：PlanItem 是用户可见、可持久化的计划投影，拥有稳定 id、status、dependsOn 与 evidenceRefs，可投影成 Execution Graph；Step 只表示 Agent loop 的 durable progression boundary（一次模型/工具/验证推进），不能拿用户计划项充当执行状态机节点。产品 UI 可称“Task”，但不再新增 `Task → Run` 一级领域实体。

Runtime 实现也不继续在一级目录堆服务；当前按职责拆为 `definitions / runs / execution / planning / scheduling / approvals / recovery / events / collaboration / exchange`。这些是实现子域而非新的业务层级：外层负责 durable/control，内层 Agent Loop 保持 `context → model → tool/result → next step` 的轻循环。

一个 AgentRuntime 当前最多关联一个状态非 `deleted/failed` 的 root Workspace；Workspace 保存稳定项目文件和 ownership，Profile 冻结 recipe/tool refs/Runner Plugin/resource/network，Generation 是可替换的运行实例。Harness 在 Backend，不创建“control workspace”。参与者通过显式 Artifact grant、Workspace Runtime Gateway 或 Runner Plugin Workspace Broker 交换结果，不能直接获得 sandbox/process/PTY handle。

userId/connectionId 沿用整数；Agent 实例 ID 使用 node:crypto.randomUUID()；appId 为稳定 namespaced manifest 字符串。数据库时间使用整数 epoch seconds，HTTP/SSE 转 ISO 8601；计时器使用单调时钟，毫秒参数须以 Ms 命名。App 数据查询必须携带服务端推导的 userId/appId；父子复合 FK 与 repository scope 检查共同防止串 App，用户提供的 owner 字段不能授权。

ExecutionSession ownerType='agent'，ownerId=agentRuntimeId。Workspace 继续拥有自己的 ExecutionSession；只共享机器能力代码，不共享实时连接、PTY/SFTP/上传 socket/cwd。关闭 AgentRuntime 只 closeByOwner('agent', agentRuntimeId)。

## 4. App Platform 与插件机制

### 4.1 Manifest、Registry 和生命周期

manifest 唯一来源为内置 App 的 `modules/agent/apps/<slug>/app.manifest.json` 或安装包根目录 `manifest.json`。固定字段为 `schemaVersion=1`、`id`、semver `version`、`displayName`、`sdkVersion`、`nexus.minVersion/maxVersion`、`capabilities`、`intents`，安装式插件另外通过**显式目标**声明可执行入口：

```ts
type AgentAppTargets = {
  frontend?: { entry: string };
  backend?: { entry: string };
  runner?: { entry: string };
};
```

不再存在 `resources: Record<string,string>` 或“某个 key 是否存在就推断模块类型”的通用映射。`frontend.entry` 必须位于 `frontend/`，`backend.entry` 必须位于 `backend/`，`runner.entry` 必须位于 `runner/`；Host 对每个目标分别校验。App id 正则固定为 `^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$`。拒绝未知 schema/capability、重复 id/intent、未知 target、路径穿越、符号链接越界、非法 semver 和不相容 Nexus/SDK 版本。

Backend `public.ts` 导出内置 factory，Bootstrap 静态注册；Frontend 同 App id 的 `public.ts` 导出 lazy contribution。安装式插件由 Backend 统一处理 publisher trust、验签、hash、版本和安装状态。服务器只返回安全 manifest/target view，不返回宿主真实安装路径、DB handle 或 Runtime 内部对象。

register 仅注册内存定义；持久化 `desiredState` 与 `observedState` 分开。enable 检查版本/grants 后分别启动声明过的目标；disable 先禁止新 Run/命令，再 quiesce/dispose 对应目标。授权撤销提升 `policyRevision`，后续 capability 调用重新检查。目标不存在与目标不可用是两个不同状态：未声明 target 不启动；已声明但 sandbox 不可用则 App 明确 degraded/failed，不降级到 Core 内直接执行。

### 4.2 三目标 Plugin Sandbox 与 target-specific SDK

Plugin package 是签名扩展包，不是独立服务。运行位置固定为三个明确宿主层：

```text
Frontend container
├─ Frontend Core
└─ Frontend Plugin Sandbox

Backend container
├─ Backend Core
└─ Backend Plugin Sandbox

nexus-agent-runner host service
├─ Runner Core
└─ Workspace A / generation
   ├─ core/task sandbox
   ├─ plugin1 runner sandbox
   └─ plugin2 runner sandbox
```

**Frontend target** 由 Backend 主进程的独立 Plugin Frontend listener 直接读取已安装 immutable package 中的 `frontend/`，形成与 Nexus 页面不同的 origin；Frontend 容器不挂插件目录，也不再维护 `plugin-ui` 静态投影。该 listener 只接受 GET/HEAD 静态资源，不挂 Nexus API/session/RPC。iframe 固定 `sandbox="allow-scripts"`，不给 `allow-same-origin`、导航、下载、表单或 Nexus cookie。父页面用 `event.source + nonce` 建立 MessageChannel，初始化后业务 RPC 只走绑定 port。

**Backend target** 在 Backend 容器内启动独立 OS process sandbox；动态插件绝不在 Backend Core module graph 中 `eval/import`。sandbox 默认无网络，不可见 `/app/data`、SQLite、Backend env/secrets 或任意宿主路径，只读挂载该插件的已验证代码和最小系统 runtime。sandbox 不可建立时 fail closed。

**Runner target** 不是全局 Backend 插件的替代执行位置。它只在某个 Workspace Profile 明确选择后随 generation 实例化。`AgentWorkspaceCreateSpec.runnerPluginIds` 指定目标插件；Backend 逐个验证安装、enabled、activeVersion 和 `targets.runner`，冻结为 `{pluginId,version,sdkVersion,protocolVersion,packageHash,entry}` 并持久化到 Workspace Profile。Runner 不扫描目录猜插件，也不自动把所有 enabled 插件注入所有 Workspace。Agent 的 `workspace_create` tool 也使用同一显式 `runnerPluginIds` 字段，不存在“模型路径自动注入插件”的旁路。

SDK 同样按目标明确，不提供一个通过字符串 method/key 动态扩张的万能对象。当前基础接口为：

```ts
type FrontendPluginSdk = {
  host: { appInfo(): Promise<AppInfo> };
  storage: AppStorageSdk;
};

type BackendPluginSdk = {
  storage: AppStorageSdk;
};

type RunnerPluginSdk = {
  workspace: {
    read(targetPluginId: string, path: string): Promise<Uint8Array>;
    write(targetPluginId: string, path: string, value: Uint8Array): Promise<void>;
    list(targetPluginId: string, path: string): Promise<string[]>;
    stat(targetPluginId: string, path: string): Promise<WorkspaceStat>;
    mkdir(targetPluginId: string, path: string): Promise<void>;
    rename(targetPluginId: string, path: string, destinationPath: string): Promise<void>;
    remove(targetPluginId: string, path: string): Promise<void>;
  };
};
```

SDK contract 不是只在安装阶段检查：三 target 都明确携带 `sdkVersion + protocolVersion`，但三个 target 的 wire protocol 独立演进，不要求数值相同。Frontend descriptor 返回安装包 `sdkVersion` 与 Host `protocolVersion=1`，建立 bridge 前校验；Backend sandbox activation context 固定 `{schemaVersion:1,protocolVersion:1,scope,plugin:{pluginId,version,sdkVersion},sdk}`，worker 的 `runtime.ready` 回报并由 Host 复核两种版本；Runner target 把 `sdkVersion + protocolVersion=2` 一起随 Workspace Profile snapshot 冻结，sandbox activation/`runtime.ready` 再次校验。Runner protocol v2 将 stdio 改为固定 16-byte header 的 framed IPC：小控制消息是 bounded JSON frame，workspace bytes 是 raw binary frame，以 `requestId` 关联，禁止 Base64 内联。协议版本不匹配直接拒绝，不根据宿主当前版本猜测历史 generation 应使用哪个 SDK/协议；冻结为旧 Runner protocol 的 generation 必须重建后才能使用新 runtime。

未来增加 `ai/runs/machine/browser/...` 时必须在对应 target SDK 增加明确 typed interface，并仍经过 manifest grant、Policy/Approval/Lease/Quota/Audit；不能通过任意 method 名、任意 URL、任意 host object 或 payload 自带 `appId/userId/callerPluginId` 绕过边界。调用者身份由 Host 绑定。

AppStorage 使用 `(userId,appId,key)`，单 value 64 KiB、单 App 16 MiB，CAS version；插件不能自建 SQL 或读取其他 App 表。Frontend/Backend target 访问 AppStorage 都由 Backend 重新校验当前 App 安装/启用状态。Runner Plugin 的 `workspace.read/write` SDK 仍是单次有界 `Uint8Array` API（当前 binary frame 最大 16 MiB），避免插件通过一个 IPC 请求无限占用内存；需要长期保留或搬运更大文件时，由 Backend 的 `agent/exchange` Workspace↔Artifact bridge 做明确生命周期转换。Host-only bridge 使用 `application/octet-stream` streaming，不再整文件 `arrayBuffer()/Buffer.concat()`，Runner transport hard cap 为 256 MiB，并继续受 Artifact 自身单文件/总量/磁盘 quota 限制；分别要求 `workspace.runtime.execute + artifacts.write`（workspace→artifact）或 `workspace.runtime.execute + artifacts.read`（artifact→workspace）。这不是跨 Plugin workspace 共享机制，也不会把 Artifact API 或 transfer handle 直接交给 Runner Plugin。

跨层调用必须经过 Host：Frontend Plugin → Frontend bridge → authenticated Backend API；Backend Plugin → Backend Host IPC；Runner Plugin → Runner Host IPC。Frontend Plugin 不能直连 Runner，Backend Plugin 不能拿 Runner 内部对象，Runner Plugin 不能直连 Backend DB/API。Docker 也不是 Runner Plugin SDK 的隐式能力；真实 Docker 操作属于 Nexus Backend 的 `machine.docker.*` capability。

### 4.3 安装式扩展、workspace 共享与跨 App 交接

包由 `manifest.json`、`files.json`、Ed25519 签名、`frontend/`、`backend/`、`runner/`、`skills/` 等显式部分组成。可信 publisher key 由用户显式导入。拒绝未签名包、路径穿越、压缩炸弹（压缩包 50 MiB、展开 200 MiB、1 万文件）、设备文件、链接逃逸和清单/hash 不一致。正式代码存 `NEXUS_DATA_DIR/agent/plugins/<appId>/versions/<version>` immutable 目录；验签前暂存只允许进入 `agent/plugins/.staging/<stageId>`，身份验证并写入 DB 后原子迁入 `<appId>/staging/<stageId>`。可变长期数据只经 AppStorage/Artifact。

升级流程：stage → 验签/校验 targets → 暂停该 App 新 Run → 等待旧 Run 终态 → AppStorage snapshot → 在 Backend target sandbox 执行 migration（若声明）→ health → 原子切 `activeVersion`。失败恢复 snapshot/旧 pointer；不声称能回滚已发生的远端副作用。停用不卸载；卸载代码不自动删除长期数据；`deleteData` 是独立高风险动作。

每个 Workspace generation 内的 Runner Plugin 有自己的逻辑 workspace：

```text
Workspace A
├─ core/workspace/
├─ plugins/plugin1/workspace/
├─ plugins/plugin2/workspace/
└─ .control/workspace-acl.json   # 仅 Runner Core 可见
```

Runner Plugin sandbox **不直接 bind 真实 workspace 目录**。所有访问统一经过 `workspace.*(targetPluginId,path)`，Host 从当前 sandbox 绑定 `callerPluginId`。自己的 workspace 默认允许；跨 Plugin 默认 deny，并读取**目标 workspace 的权限列表**：

```ts
type WorkspaceGrant = {
  targetPluginId: string;
  principalPluginId: string;
  path: string; // 目标 workspace 内的逻辑绝对路径，可用 /dir/**
  permissions: ('read' | 'write' | 'list' | 'delete')[];
};
```

例如 plugin2 调用 `workspace.read('plugin1','/output/report.json')` 时，Runner 检查 `plugin1` 的 grant 是否允许 `principalPluginId=plugin2 + read + path`。授权后读取的是 plugin1 workspace 的**同一份底层文件**，不 copy/paste；撤销 grant 后访问立即失败，原文件不变。`..`、真实宿主绝对路径、symlink 逃逸和跨 Workspace target 全部拒绝。Backend 的 grant API 先验证 `userId + appId + workspaceId + generation` 所有权以及 target/principal 均是该 Workspace Profile 冻结的 Runner Plugin，Runner 再做第二次验证。

AppIntent 只传 schema-validated 小 JSON/ArtifactRef：发送/接收双方 manifest、当前 grants 和目标 App 状态均检查；确认后创建 receiver grant，原 Artifact owner 不变。grant 可撤销、有 TTL，不带 SSH handle、secret 或完整私有历史；接收 App 再执行工具时重新授权。AppIntent 是跨 App 的长期数据交接机制，与同一 Workspace generation 内 Runner Plugin 的 workspace grant 不混用。

### 4.4 Nexus Workspace、Runner Plugin 与 Host bridge 的协议必须独立

Nexus 现在同时存在多条“传 bytes”的路径，但它们属于不同 runtime owner，协议版本和 framing **不能因为都传二进制就合并**：

| 路径                                | 当前协议                            | Owner / 用途                                                                  | 关键边界                                                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser ↔ Nexus Workspace           | `NXW1` / `binaryProtocolVersion=1`  | Workspace runtime 的交互终端、SFTP 读取、编辑器 raw snapshot、suspend history | client→server 仍是最大 1 MiB JSON control；server→browser binary 使用固定 16-byte header，区分 terminal / request-scoped response，UTF-8 requestId 最多 128 bytes，单 payload frame 最大 256 KiB，binary response 以 final frame 收尾；禁止 Base64 data payload |
| Browser → upload stream             | `/ws/uploads` raw binary            | Workspace Transfer/Upload                                                     | 一条 socket 对应一个 upload，WebSocket message 按序就是文件 bytes；声明总大小决定完成边界，不套 `NXW1`，避免 bulk upload 与主 Workspace control/terminal 互相 head-of-line blocking                                                                             |
| Runner Plugin sandbox ↔ Runner Host | `NXR2` / Runner `protocolVersion=2` | 单个 Runner Plugin 的 local stdio SDK IPC                                     | 固定 16-byte header + uint32 requestId；JSON control 最大 256 KiB，单次 workspace binary 最大 16 MiB；callerPluginId 由 Host 绑定；禁止 Base64 和任意 Host object                                                                                               |
| Backend ↔ `nexus-agent-runner`      | authenticated Controller HTTP       | Workspace command、Catalog、Workspace↔Artifact Host bridge                    | 控制体有界 JSON；workspace bridge 使用 `application/octet-stream` streaming，精确 `Content-Length`，当前 hard cap 256 MiB；它不是 Runner Plugin SDK，也不把 transport handle 暴露给 Plugin/Frontend                                                             |

这四条路径只共享“有界、可取消、fail closed、raw bytes 不 Base64 膨胀”的原则，不共享 magic、requestId 类型、版本号或生命周期。`NXW1 v1` 与 Plugin Frontend/Backend target 的 `protocolVersion=1` 也只是各自独立协议碰巧同号，不能建立兼容关系。Workspace 和 Agent 可以复用 Platform filesystem/execution capability，但不得复用彼此 live socket、PTY/SFTP、cwd、ExecutionSession、Runner workspace handle 或协议内部对象。

## 5. Harness、模型与节省 Token

借鉴的是公开可观察的 Agent 模式：工具循环/审批沙箱、渐进 Skill 加载、可恢复会话、工具结果裁剪、外部协议适配。Codex、Claude Code 等产品不能一概称为全部开源；“Grok Build/DeepSeek Harness”在未锁定仓库/许可证/commit 前不作为可复制代码依据。本方案不依赖任何这些实现的私有接口，后续引入代码必须另记来源与许可证。

Native Harness 的固定流程：持久化输入→构造预算上下文→模型 attempt→持久化完整 proposal→inspect→授权/Policy→审批→lease→执行→结果处理→验证→提交事实→下一 step。Planner 输出目标、步骤和成功条件，不持久化隐藏思维链。Verifier 只根据用户目标和可追溯证据给 verified/unverified/failed；模型自称完成不算独立验证。

首发一个 OpenAI-compatible Chat Completions HTTP streaming adapter（含 OpenAI preset），统一 LanguageModelPort.stream；Anthropic adapter 三期增加。模型配置包含真实 contextWindow/outputLimit/tool 支持能力，工具能力不支持则 model-only，不臆造 tools。Provider 仅由用户设置；密钥用既有 SecretCipher 加密保存，API 只返回 hasCredential，日志禁止 request body/authorization。

公网 HTTPS 默认允许；私网默认拒绝，用户可在设置里逐个配置准确 host:port 例外并看到风险提示。HTTP 仅显式开发模式的 loopback；云 metadata、link-local、组播、未指定地址始终禁止。DNS 全部地址先校验、连接固定本次校验地址并保留 TLS SNI；禁止重定向（3xx 失败），防止跨目的地址泄露凭据。模型不能修改 endpoint/allowlist。Runner 未配置/不可用和无模型均不导致 Core startup 失败；真实 Docker capability 是否可用也不影响 Core startup。

Context 分稳定前缀（安全/工具协议）、半稳定任务计划和动态尾部；按目标选最多12个工具 schema，Skill 先加载 metadata、最多3个 body/总12 KiB。工具输出先脱敏、摘要再进上下文，大对象放 Artifact。原始输入留 ledger；旧输入在上下文可被带来源范围的增量摘要替代，但当前未消费用户输入和安全/授权状态必须保留。摘要按 thread sequence 区间+sourceHash+model 配置版本缓存，只追加新范围，不能重复摘要同一区间。

Token 以每次 request input+output 累计，包括重试、cached input 和失败调用的保守估计；不是仅计算新增文本。Context 输入上限 min(32000, modelWindow-outputReserve)，估算额外预留15%；每次调用前同时预留输入和最大输出，完成后按 usage 结算。usage 缺失用保守上界，不当作零。价格来自版本化配置，以 integer micro-USD 存储；未知价格返回 null，不伪装免费。设置了 cost budget 而价格未知时禁止开始。用户可调的 Run token/step/active-time/cost 都是**软预算**：下一步预留会越过当前预算时不把 Run 判失败，而是在安全边界进入 `awaiting_budget`、释放执行/model/tool slot并提醒用户；只有用户显式提高**本次 Run**预算后才继续。Agent Settings 同时提供管理员可配置的 Hard Limits，作为本实例对 Run/并发/环境资源的最终策略上限；普通 Settings 上调不自动放大已运行 Run。Hard Limit 提高必须二次确认，确认界面显示旧值→新值、可能增加的模型成本/CPU/内存/磁盘/并发压力及当前资源状态。模型真实 context/output 能力、Runner/宿主实际可分配资源和协议/数据库固定 guardrail 是运行事实或正确性约束，不再形成第二套配置层；超出真实能力时该次操作明确失败或降级，不悄悄套用其他资源上限。

Agent Settings是宿主级配置中心，不只配置模型。UI分为模型与Provider、执行与性能、预算与上下文、Hard Limits、Subagent、Artifact与存储、Workspace Runtime、安全与网络等小模块，并提供只读系统保护页。软预算显示requested/effective，Hard Limits模块允许管理员配置本实例的Run/并发/Artifact/Workspace Runtime资源上限；任何提高都必须经过二次确认。数据库/event/Agent WebSocket正确性guardrail保持只读，模型真实window与宿主当前资源作为运行时能力直接展示，不再作为另一层Hard Limit。模型并发默认`auto`跟随当前有效AgentRuntime执行并发（默认2），用户可主动降到1等更保守值；实际模型请求仍受Provider自身限流/能力影响。

只缓存只读工具：key 包含 app、target fingerprint、规范化参数、观察版本、工具版本，TTL 最多5秒；命中仍计 Run step 并重新授权。修改成功或未知结果立即失效相关缓存；不缓存 mutation、审批或凭据。每个 model/tool/verification/delegation 都计入统一 `maxRunSteps` 软预算；连续3步无新增证据或相同失败签名连续3次由 loop guard 阻止继续自动换方法。软预算耗尽只暂停询问用户，Agent Settings Hard Limits 和 loop guard 才是无限运行的最终保护。评测同时比较任务成功率、验证率、Token 与恢复率，不能只用省 Token 掩盖失败。

## 6. 安全执行、竞争与远端不确定性

唯一 AgentTool 接口为 descriptor/inspect/execute/verify；inspect 无副作用，execute 只收已经复查的 ToolInspection。共享 ToolExecutor 控制所有安全步骤，工具不能自行省略。

Tool 不再在 composition root 以大量零散 `register(tool)` 形成隐式目录。每个能力通过显式 `CapabilityContribution {schemaVersion,id,capability,tools[]}` 注册，Catalog 强制 contribution 内每个 Tool 的 `descriptor.capability` 与声明 capability 相同；静态 machine/workspace-runtime/runtime 能力和动态 MCP 都走同一 contribution 边界。Target 表示代码运行位置，Capability 表示“允许做什么”，二者不能互相替代；以后增加 Kubernetes/DB/Cloud 也是新增明确 capability contribution，而不是增加新的 Plugin target 或字符串映射 dispatcher。

operationHash 使用版本化 canonical JSON 的 UTF-8 SHA-256，包含 actor scope、tool/version、target fingerprint、normalized arguments、secret 引用版本、policyRevision 和前置条件。具体编码与测试向量见实施 §5。Approval 绑定精确 hash，600秒有效；前端 hash 只是 UI 对齐，服务端复算。approval resolve 与 execute 前都复查；网络 inspect 在事务外，提交用 version/policyRevision/hash CAS，不能拿 DB 锁等待 SSH。

Policy 顺序：App enabled/grant→连接存在及 denylist→硬禁止→read allow/修改审批。Phase 1 任何 mutation 返回 CAPABILITY_UNAVAILABLE。Phase 2 结构化文件/服务/Docker 修改都审批；Shell 优先受限 argv catalog，未知 shell 文本一律审批，deny 模式先于审批；不把正则识别当 sandbox。远端 Shell 使用目标用户本来的系统权限，必须在 UI 提示不是容器隔离。

Lease 30秒、每10秒续约；读共享、写互斥，resourceKey 不含 caller/App。Agent 修改继续获取 target 根 write lease，Agent 读取获取 target 根 read lease，确保不同 App/Agent 对同一目标仍按保守 target 边界互斥。LeasePort 的 `acquireMany(owner, keys, mode)` 保留为同 mode convenience API；底层同时支持一次事务中的 mixed-mode resource claims，供能证明写集合的调用方表达“协调根 read + 精确资源 write”。targetIdentity 由受信 SSH host key+规范化 endpoint 推导，连接别名可显式映射同一 target；无法判定的别名/外部终端并发不能声称已互斥。

Workspace typed mutation 通过注入的共享 MutationGuardPort 接入同一 lease provider；Platform 不依赖 Agent 模块。对于 upload 与 compress 这类可在执行前确定唯一写目标的长 mutation，Workspace 取 connection 根 read lease + canonical remote path write lease，使不同文件可以并行、同一文件保持互斥，同时仍与 Agent 的 target 根 write lease 冲突；decompress、copy/move、目录准备等写集合较宽或不能完整证明的操作继续取 connection 根 write lease。稳定 `ownerId` 表示 Workspace actor，具体并发持锁者通过独立 `leaseOwnerId` 区分；所有 claims 在一次事务原子获取，未知结果同时 quarantine 协调根与精确写资源。远端路径必须在实际 I/O 与 resourceKey 构造前使用同一个 Platform canonicalization 原语。Workspace 交互终端和外部 SSH 无法受此锁控制，界面注明，文件操作额外比对 hash/metadata，仍不声称远端任意工具有原子 CAS。Agent 不自动覆盖观测到的外部修改。

Lease 过期只说明持有人失联，不说明远端作业已停止：已 started 的 mutation 对应 resource quarantine 保留，阻止下一次写，直到 reconciler 验证终止/结果或用户带证据确认解除。fencing 序号只对能校验的 Controller/本地 Gateway 有效，不能保证远端普通 SSH 命令受 fencing。取消/超时先拒绝新步骤，再请求中断；结果未知为 interrupted + needsReconciliation，不标 cancelled 成功，不重放 mutation。

## 7. 状态、事件和恢复

Run 状态唯一为 created/running/awaiting_approval/awaiting_budget/cancelling/completed/completed_unverified/failed/cancelled/interrupted。终态不原位重启。正常问答可 completed_unverified；运维有证据才 completed。ToolCall 的 reconciling 与 Run.needsReconciliation 表达远端未知，不复用 failed 掩盖副作用。

用户中途输入先 append ledger：模型 streaming 时 abort 当前 attempt、下个安全 step 合并；tool 已 started 则等其完成/核实，不强杀不可安全中断的修改；awaiting_approval 时 supersede 旧未消费审批，重新计划；awaiting_budget 时输入照常入 ledger，但不恢复执行，直到用户提高本 Run 预算或取消。按 consumedInputSequence 精确消费，不能把更新后的输入配给旧 proposal。

Model transport 最多重试2次（总3 attempts），仅超时/连接故障/429/502/503/504，退避1秒、2秒加0～250ms jitter，Retry-After 上限30秒。取消优先。完整 tool proposal 一旦提交，本 step 不因 provider 断流重新产生第二次 mutation。tool_call JSON 未完整结束不能执行；相同 step 的 operationHash 去重，跨 step 不凭 hash 永久禁止用户合理重复操作。

Durable events、领域投影、canonical message/ledger 与 Host summary outbox 在同一 SQLite transaction 提交；事件能重建运行投影，不替代 Provider/config/Artifact 文件等各自事实源。原有 DatabaseAdapter 全局串行，事务只做有界 SQL，不在其中做网络/模型/磁盘写。delta/tool output chunk 为 transient，没有 durable sequence/SSE id；重连丢弃草稿，从 snapshot/final 恢复。

当前单Backend/单scheduler部署继续以现有单连接SQLite为正式基线；默认 Runtime 软值2、默认 Hard Limit 4 是首轮已验证容量基线，不是不可突破的隐藏上限。用户可在 Agent Settings 二次确认后提高 Hard Limit，但设置页必须提示已超出当前验证基线并建议重新执行负载验收；只有进入多Backend、多用户高并发，或提高并发后在正确限流/batch/分页下仍无法满足DB queue wait与transaction p95目标时，才连同scheduler/claim/lease/idempotency拓扑一起重新设计数据库方案。

Run durable events 与 Host durable events 各自维护独立 sequence，两个序列不混用；`/ws/agent` 的 subscriptionId 只是连接内路由标识，不是事实 id。V1 不做自动 event compaction，Run 删除才级联清 run events；Host summary 是独立安全摘要，不含消息/工具 payload。游标校验、sequence replay、背压/心跳见实施 §7。

重启：停止接入→迁移→注册 App→重建非终态状态→全部未决运行收敛 interrupted→未完成修改进入 quarantine→启动订阅/调度。Checkpoint 只在无正在运行工具的安全边界保存 plan/input watermark/evidence/version；不存 live handle/secret 或可继续使用的 lease。Resume 创建新 Run、新 AgentRuntime、新执行资源，重新 inspect，旧审批失效，旧 mutation 不自动执行。

## 8. Artifact、Memory 与数据生命周期

Artifact 对象独立于容器：上传/工具输出先配额预留→私有 tmp 文件→流式字节统计/hash→fsync→同盘 rename→目录 fsync→metadata ready 与事件事务。数据库失败留下可对账孤儿；不能先 ready 后写文件。对象 ID 不由用户路径或全局 content hash 授权；跨 App 同内容不自动共享。

默认单对象50 MiB、工具原始输出10 MiB、单 Run256 MiB、单用户/全局2 GiB；未归 Run 的上传也算全局配额。磁盘至少保留1 GiB 可用空间，写入前/过程中检查，配额包括 reserved bytes；payload ready 后从 reserved 转 committed。工具输出超过 raw limit 截断并标 truncated，上传超过 limit 返回413并清 tmp。retain 不绕过全局配额。

未 retain 的 ready Artifact 在最后关联 Run 终态7天后可回收；无 Run 的暂存上传24小时回收；活跃 Run、跨 App 有效 grant、有效 checkpoint 引用保护内容。tmp 1小时后对账清理；deleted 用 tombstone，定时清理失败可重试。删除 Run 不隐式删除其他 App 授权持有或 retain 的对象。GET range 检查 owner/grant、单 range、max8 MiB，返回206/416；缺 payload 返回410 ARTIFACT_UNAVAILABLE 并更新 metadata，不500。默认下载 attachment+nosniff，HTML/SVG 不能在 Nexus origin 执行。

Agent Hub 提供长期存在的**文件库（Files / Artifact Library）**作为用户级管理视图，统一聚合当前用户在已授权 App 中的用户上传、Agent 生成结果、任务证据和保留的中间产物；它管理的是文件 bytes、来源、引用和生命周期，不等同知识库/Memory，也不单独引入“数据集”一级概念。列表按来源 App/Thread/Run、类型、大小、时间、retained/可回收状态过滤，支持搜索、快速预览、下载、回到来源、retain/unretain、删除和“引用到当前对话”。统一列表只扩大**用户可见性**，不扩大 App capability：某 App 读取另一个 App 的 Artifact 前仍必须由用户动作创建显式 run link/grant，不能因为文件库能看见就绕过 app scope。

文件库提供空间概览与安全清理：至少区分 retained、active-reference、reclaimable、staging/tmp 与 unavailable metadata；“清理可回收文件”先 preview 数量/字节/来源和被保护对象，再确认删除，仅处理无活跃 Run/checkpoint/grant 且未 retain 的对象。受保护对象不可被批量清理按钮强删，用户必须先解除对应引用或 retain；删除失败进入既有 deleting/reconcile 流程。大文件预览继续使用有界 Range/ArtifactViewer，不把完整文件加载到浏览器内存；文件库分页/虚拟化，不能因长期任务累计上万 Artifact 而全量挂 DOM。

Memory 一期只读检索；默认不自动写，不安装向量数据库。采用 SQLite FTS5（不可用时 bounded LIKE）与最近确认事实加权，最多5条/8 KiB，带 source/时间/scope/trust，注入为非指令。三期 AI 可提交候选，用户在审查 UI 确认后发布；每条有 source refs、置信度、expiresAt，撤销/源删除后不再召回。Skill 一期只读仓库内版本化 SKILL.md 与资源，限制路径/体积，不执行脚本；三期安装式 Skill 复用包签名与 capability 审批。

备份包含 Agent DB 表及既有格式加密的 Provider credential；默认不包含 Artifact payload、Runner runtime/workspace 或插件代码。备份 API/UI 必须明确 exclusions；二期可选包含 ready/retain Artifact 的一致性快照。恢复缺 payload 标 unavailable，缺加密密钥 Provider degraded 且要求重新配置，不尝试明文降级。恢复后撤销所有 runtime tokens/审批，运行全部 interrupted；不能恢复正在执行的 sandbox/process。用户数据恢复不视为继续授权旧作业。

## 9. Workspace Dev Environment：Tool Store、Runtime Sandbox、隔离与还原

### 9.0 产品作用与部署边界

`nexus-agent-runner` 是 Nexus 的受限本地执行服务，但**不是 Docker controller**。Runner、Backend、Workspace sandbox 与 Plugin sandbox 都不持 host Docker socket；Runner 不运行 dockerd、不使用 dockerode、不使用 nested Docker，Plugin 也不会创建额外 Docker。

当前 canonical Linux 部署将 `nexus-agent-runner` 作为专用 host service，而不是在长期运行的 Docker Runner 容器里嵌套 bubblewrap。原因是 bubblewrap 构造 mount namespace 时需要 mount propagation 操作，Docker 默认 AppArmor 会在外层容器边界拒绝这类 mount；不能为了让测试通过而把整个 Runner 改成 `privileged`、`apparmor=unconfined` 或继续堆叠 capability。Ubuntu 24.04+ 若启用了 AppArmor unprivileged-userns 限制，仓库通过 `scripts/agent-runtime/prepare-ubuntu-host.sh` 从上游 release 安装当前固定的最新稳定 `bubblewrap 0.12.0`（SHA-256 校验）到 Nexus-owned root-only 路径，并只为该路径加载 `nexus-bwrap-userns-restrict` profile；系统 `/usr/bin/bwrap` 不被覆盖，脚本明确不会关闭 `kernel.apparmor_restrict_unprivileged_userns`。具体 Bubblewrap release/version/SHA 由 host prepare、Docker build 与仓库 check 脚本统一约束；Runner/Plugin Runtime 代码只做 sandbox availability/真实执行的 fail-closed，不重复硬编码版本门槛。Backend 容器通过 host-gateway 到达 Runner 的受认证 Controller HTTP；Runner 默认只监听 loopback，部署时应显式绑定仅 Backend 可达的宿主接口并配合防火墙。Runner availability 必须真实执行与 job 共用的最小 sandbox probe，sandbox primitive 不可用时继续 degraded/fail closed。

```text
Host deployment
├─ Frontend container
├─ Backend container ── authenticated Controller HTTP ──┐
└─ nexus-agent-runner host service                      │
   ├─ Runner Core / Controller ◀────────────────────────┘
   ├─ immutable Tool Store
   │  ├─ node/18 + node/20 + node/22
   │  ├─ python/3.10 + python/3.12
   │  └─ go/1.22 + go/1.23
   ├─ Workspace A
   │  ├─ stable project filesystem
   │  ├─ generation -> node22 + python3.12 + go1.23
   │  └─ runtime sessions -> Agent / Plugin / CI-task / future Terminal
   └─ Workspace B
      ├─ stable project filesystem
      └─ generation -> node18 + python3.10
```

**Workspace 是稳定项目边界，Profile 是运行配置，Generation 是一次运行实例。** Node、Python、Go 不是独立运行实体，而是一个 Workspace Profile 里的工具族。每个 sandbox 仍至少隔离 filesystem view、PID/IPC/UTS/network namespace、环境变量、cwd、临时目录和 process tree；generation 停止/重建会终止旧 runtime session，但不会替换 Workspace 项目文件。

Runtime consumer 的统一范围必须固定：Agent one-shot job、Runner Plugin、CI/task 与未来的**本地** Terminal 可以共享 `workspaceId + generation`、Workspace/Profile、Tool Store 和 sandbox execution contract；但 owner/transport 仍各自独立。现有 SSH Terminal/SFTP/远程 Docker 属于 Nexus `modules/workspace` 与 remote-machine capability，它们的 live SSH session、PTY、cwd、SFTP socket 不进入 Runner；RDP/VNC 继续属于 Guacamole runtime。未来若实现本地交互式 Terminal，应新增 Workspace Runtime interactive-session port，不能复用 Agent 模型身份，也不能把现有 `WorkspaceTerminalService` 搬进本地 Runner。

真实 Docker 管理仍是另一条业务能力：Agent → Backend capability → manifest grant → Policy → Approval → Lease/MutationGuard → Nexus `RemoteDockerService` → 用户目标机器。它不经过本地 Workspace Runtime，也不会把任何 Docker socket 交给 Runner/Plugin。

典型流程变为 Artifact/受控输入 → 选择 Workspace → 冻结该 Workspace 的 Tool versions/Runner Plugin targets → Sandbox Manager 建立 runtime generation → Agent/Plugin/CI-task 在同一 Workspace 文件视图中执行 → Artifact/结构化证据 → Verifier；若之后要修改真实远端机器，再进入 Backend 的 Policy/Approval/Lease 链。

### 9.1 Catalog、runtimeDigest 与多版本 Tool Store

Workspace Runtime Catalog 由 Nexus 发行物提供，Frontend 不硬编码版本。Catalog 包含：

1. **Tool Pack**：Node/Python/Go/JDK/Rust/CUDA/Chromium/data-tools 等 content-addressed immutable 工具链，记录 `familyId/versionId/contentDigest`、架构下载来源、capabilities、`runnerApiRange`、diskBytes、依赖、支持架构及 supported/deprecated/unavailable 状态。
2. **Workspace Profile**：当前产品只暴露统一的 `workspace-dev` 开发环境 profile；它定义允许的 Tool family、基础工具、资源需求和网络默认值。当前 transport 中 `kind=code` 仍作为兼容字段保留，不再代表产品上存在独立的 code 运行实体。
3. **runtimeDigest**：当前 Runner sandbox ABI/runtime 的精确版本事实，不表示某个子 Docker image。

Tool Store 的安装 key 为 `familyId/versionId/contentDigest`；Catalog 先按当前 arch 解析对应 digest。同一 family 的多个版本可以同时 installed/enabled/inUse，例如 Node 18/20/22 与 Python 3.10/3.12 并存；不同 Workspace Profile 冻结各自精确 `packRefs`，因此 Workspace A 可以使用 Node 22 而 Workspace B 同时保持 Node 18。

Workspace 切换工具版本必须执行：确保目标 Tool Pack 已下载并校验 → 停止/替换该 Workspace 的旧 runtime generation → 创建新 generation 并冻结新的 `packRefs` → 把**同一稳定 Workspace filesystem** bind 到 `/workspace` → 根据新 generation 生成 PATH/只读工具挂载。这个过程不得修改 Runner 进程全局 PATH、宿主 `/usr/bin` 或其他 Workspace 的 profile。旧 generation 的 process/session 必须终止，不能在版本切换后继续持有旧工具或 lease。

Tool Pack 安装由 Runner Core 完成。内置 `base-tools` 继续走 release archive 的 archive-safety/manifest/digest 校验；Node/Python/Go 只允许 Catalog 锁定的 `mise://<installerVersion>/<family>/<exactVersion>` source，由 host prerequisite 安装并 SHA-256 固定 `mise 2026.9.5`；Runner 再把 `mise install-into` 放进专用 bubblewrap materializer sandbox，只暴露可写 mise cache + staging、只读系统 runtime，隔离 user/PID/IPC/UTS 并 drop all capabilities，安装阶段保留网络仅用于下载。Nexus 随后拒绝逃逸 symlink，把 Python 等安装树中的 staging prefix 规范化为 sandbox canonical `/opt/nexus/packs/<family>/<version>`；exact tool version 会在第二个无网络 bubblewrap verifier 中执行并校验，然后计算包含 path/type/exec-bit/file-content/safe-symlink 的 canonical tree digest；只有与 Catalog 的 arch digest 精确一致才写 manifest、fsync/read-only 并 atomic rename。mise 是受信任的发行 prerequisite，但不能决定最终 Pack identity，也不能写 `/usr/bin` 或 Runner Core；普通 API 不能提供任意 installer/source。Workspace job 只获得该 generation 冻结的精确 Tool Pack 只读视图；历史恢复找不到原 digest 时明确 pack unavailable，不静默替换。

### 9.2 Runner 数据布局、Workspace 与 ACL

Runner 数据根固定分区：

```text
/var/lib/nexus-agent-runner/
  state/        # durable journal/inventory/watermark
  packs/        # durable immutable packs
  cache/        # reclaimable download/staging cache
  runtime/      # stable Workspace data + generation/runtime lifecycle data
  quarantine/   # 未确认 ownership/side-effect 残余
/run/nexus-agent-runner/
  ...           # 仅短期控制面数据；不放长期业务事实
```

Workspace 的稳定数据与 generation 分开存放：

```text
runtime/
  workspaces/<workspaceId>/
    .control/
      workspace-acl.json
    core/workspace/
      work/
      deps/      # mountpoint; active backing comes from the pinned toolchain profile
      build/     # mountpoint; active backing comes from the pinned toolchain profile
      browser/
      jobs/
      tmp/
    core/toolchains/<toolchainFingerprint>/
      deps/
        cache/node/
        cache/python/
        cache/go/
        go/pkg/mod/
      build/
    plugins/
      <plugin1>/workspace/
      <plugin2>/workspace/
  generations/<workspaceId>/<generation>/
    .control/
      metadata.json
      state
```

`runtime/workspaces/<workspaceId>/` 是稳定项目边界；切换 Node/Python/Go 版本或重建 generation 不改变它。`runtime/generations/.../<generation>/` 只保存这一代运行配置与状态，因此旧 runtime 可以被停止/删除而不复制项目文件。平台管理的工具依赖与构建缓存按冻结 `runtimeDigest + packRefs` 计算的 `toolchainFingerprint` 分区到 `core/toolchains/<fingerprint>/`；sandbox 把当前 profile 的 `deps/build` 映射为 `/workspace/deps`、`/workspace/build`，并把 npm/pip/Go cache 指向该 profile，所以切到 Node 22/Python 3.12 不会污染 Node 20/Python 3.10 的平台依赖缓存，切回旧版本时又能复用原 profile。用户自行在源码树创建的 `node_modules`、`.venv` 或其他目录属于项目数据，不宣称自动 ABI 隔离；需要稳定跨版本行为时应使用 `/workspace/deps` 或由上层依赖管理器基于当前 `NEXUS_TOOLCHAIN_FINGERPRINT` 建立自己的版本化目录。`.control` 只属于 Runner Core，任何 job/plugin sandbox 都不可见。core task sandbox 只看到稳定 `/workspace` 和该 generation 冻结的精确 Tool Pack；Runner Plugin sandbox 不直接看到真实 `plugins/<id>/workspace`，只经 Workspace Broker SDK 访问。

Workspace 规则固定：自己的 logical workspace 默认允许，其他 Plugin workspace 默认拒绝；跨 Plugin grant 存在于**目标 workspace ACL**，并随稳定 Workspace 保存。授权对象由 `targetPluginId + principalPluginId + path + permissions` 明确表达。`workspace.read('plugin1','/output/report.json')` 直接读取 plugin1 的原文件，不复制；grant revoke 只撤访问，不移动/删除文件。target/principal 必须都属于当前 Workspace generation 的冻结 `runnerPlugins`；跨 Workspace 永远拒绝。

空间统计分 `stateBytes / packBytes / cacheBytes / runtimeBytes / quarantineBytes / sandboxOverheadBytes`。`sandboxOverheadBytes` 只表示无法归入前五类的 sandbox/process runtime 开销，不再统计 Docker image/container/volume。当前没有额外可归因开销时可为 0。禁止重复计费。

### 9.3 Sandbox Manager、Job 与网络边界

Runner 使用独立 Sandbox Manager（当前 Linux 实现基于 bubblewrap）启动 Workspace generation job 和 Runner Plugin process。边界要求：

- 新 PID、IPC、UTS、network namespace；默认 network `none`。
- sandbox payload 启动前显式 drop all Linux capabilities；host Runner 只承担 sandbox construction，不把 Runner token/env 或宿主控制目录传入 payload。
- 最小只读系统 runtime；当前 generation 精确 Tool Pack 只读；`/tmp` 独立。
- core job 只 bind 当前 Workspace 的稳定 core workspace，不能看到其他 Workspace、Plugin workspace、Runner `state/packs/cache/quarantine` 控制目录。
- Runner Plugin 只读挂自己的已验证 package target 与最小 runtime；真实 workspace 不 bind，通过 local IPC 调 Workspace Broker。
- generation stop/delete/version-switch 必须终止其 process tree；新 generation 使用同一 Workspace 文件但重新建立 sandbox/PATH/tool mounts，旧 generation 回调不得写新 generation。
- allowlist 网络只有存在真实 enforcement broker 时才 advertise；当前若 `egressAllowlist=false`，请求 allowlist 必须 fail closed，不能退化为 unrestricted 网络。

Workspace Profile ResourceLimits 仍用于 admission/quota、运行监控和后续 kernel enforcement。某项要求严格 kernel limit 而当前部署无法提供时，Runner 必须报告 capability 缺失或拒绝对应高风险模式，不能用“目录隔离”冒充完整资源隔离。

Backend 与 Runner 只通过受认证 Controller protocol 交换冻结命令；请求包含 `deploymentId/userId/appId/runId/agentRuntimeId/workspaceId/generation/runtimeDigest/catalogRevision/toolchain/runnerPlugins/operationHash/deadline/nonce`。Runner 再校验 Catalog、generation、quota 和 target 格式。Frontend/模型不能提交宿主路径、进程 handle 或 sandbox binary 参数。

### 9.4 生命周期、Cleanup 与恢复

provision：验证命令 → ensure Tool Pack → 创建/复用稳定 Workspace tree → 创建新的 generation `.control` → 冻结该 generation 的 tool refs/Runner Plugin targets → journal `ready`。不会创建 Docker/container/network/volume。

start：Workspace generation 转 running，并按冻结 target 启动 Runner Plugin sandboxes。stop：先 quiesce/dispose Runner Plugin，再终止该 generation 活跃 job/process tree，保留稳定 Workspace。restart：终止旧 process tree，按同一 generation 冻结事实重新建立 sandbox。version-switch/recreate：先停止旧 generation，再使用新的 tool refs 创建下一 generation；稳定 Workspace 不移动、不复制。delete generation：dispose 插件、终止 job、删除该 generation runtime；长期 AppStorage/Artifact 与稳定 Workspace 不因 generation 删除而自动消失。

Runner startup reconcile 遍历 journal：running Workspace 检查 generation sandbox runtime 事实并重新激活其冻结 Runner Plugin；中断中的 command/job 标记 unknown/reconciliation-required，不假装成功。旧 generation 的回调不得写新 generation。

“清运行残余”不再删除 Docker resource，而是：freeze new workspace/jobs → quiesce/terminate owned process trees → reconcile unknown → 删除确认归属的 generation runtime；只有在明确执行 Workspace runtime cleanup 且不存在受保护/活跃 generation 时才删除 `runtime/workspaces/<workspaceId>` → 清短期控制面数据 → release quota → compact journal → second inventory。无法确认 ownership/side effect 的数据进入 `quarantine/`。Tool Pack uninstall 与 runtime cleanup 分开；停止/切换 Workspace generation 都不会自动卸载 Tool Pack。

Runner 备份默认不包含 Packs/runtime/cache，只保存 Nexus DB 中 Settings、PackRef、Workspace Profile/Runner target snapshot 和 Run/Checkpoint 事实。恢复后 Runner 根据 Catalog/Settings 重新核对所需 Pack；缺失明确显示，不伪装旧 sandbox 仍存在。

## 10. MCP、ACP、CDP 和多 Agent（Phase 3）

当前状态必须区分设计目标与已交付能力：**MCP 已接线；ACP = 未完成（reserved）；Browser/CDP/Puppeteer = 未完成（reserved）**。以下 ACP/CDP 段落描述未来正式接线时必须满足的安全与协议约束，不表示当前 dev 已提供对应执行能力。

MCP 首版只支持管理员登记的 Streamable HTTP，非任意模型提供 URL；stdio 只在隔离环境内按固定 command profile。server trust/version、工具 schema hash、工具名 namespacing、输入32 KiB/输出10 MiB/超时60秒逐工具限制；工具刷新改 schema 后旧审批失效。MCP declared annotations 不能自证 read，未知工具当 mutation，走本地 executor。

ACP 采用隔离外部 backend adapter，权限请求映射成本地 ToolInspection/Approval；外部 Agent 的自主 filesystem/network 禁止访问 Nexus 或生产连接，所有生产作用经过本地 capability RPC。无法拦截外部实现自主副作用的 ACP backend 只允许离线分析，不注册为运维执行器。适配器握手协商协议版本，不支持版本直接 degraded，不静默 fallback。

CDP endpoint 只在 browser Workspace Profile/Generation 内由 Gateway 代理；BrowserSession 绑定明确的 workspaceId + generation。snapshot 返回 nodeRef=(snapshotId,nodeIndex)，导航/DOM版本改变后旧 ref失效；navigate/click/type/download均按 action检查域名、会话、风险和预算。evaluate默认无capability，不接受任意selector/JS替代nodeRef。Cookie/profile不跨Run；页面文本、下载文件是untrusted。截图/DOM超64KiB转Artifact；type secret用短期secretRef，审计只存redacted。

多 Agent 通过原生 Subagent 实现 Coordinator/Worker/Reviewer。Subagent **不设置累计创建数量上限，也不再设置独立的 Subagent 并发上限**；完成/失败/取消的历史 Subagent 不占未来创建名额。所有 root/child 统一受全局 `maxConcurrentRuntimes`（默认软值2，默认Hard Limit 4）调度，超过可执行 Runtime 数量的子任务进入有界队列；设置页直接显示当前 executing Runtime 数、requested/effective 与当前 Hard Limit。全局模型并发是独立软上限，默认`auto`跟随有效Runtime并发并可由用户调低；因此 Runtime 可以处于 runnable/tool/waiting，而只有取得model slot的参与者才能发起模型stream。Subagent只保留 `maxDelegationDepth`（默认软值2、默认Hard Limit 3且可在Agent Settings二次确认调整，root为0）及 profile/model/budget 约束。

每个Subagent单独冻结ModelRef={providerId,modelId,configurationVersion}，可与root及其他Subagent不同。用户在App设置中维护带名称/角色/模型/预算的SubagentProfile，发起Run时可在授权模型列表中覆盖本次分配；模型delegate工具只能选择已配置profileId，不能设置任意endpoint/credential。未给模型显式采用profile默认，仍缺失才快照继承root模型并在UI标注。不同模型的contextWindow/tools能力/价格分别校验，不以主模型能力替代检查。

委派包含parentRuntimeId/profileId/modelRef/objective/constraints/inputArtifactRefs/maxTokens/maxSteps/deadline/completionCriteria。创建事务原子校验深度、父Run状态、剩余预算与profile授权；每次 delegation 都写入统一 `agent_steps(kind='delegation')` 并消耗 `maxRunSteps`，父预算预留子配额，所有模型/工具使用量统一结算到同一Run。这样允许任务按需要顺序创建任意多个已完成 Subagent，但不能靠反复换 Subagent 绕过 Run token/step/active-time/cost 预算、hard limit 或 no-progress loop guard。拒绝循环委派和跨Run reparent。

Coordinator等待子任务时释放自己的模型调用slot，不持有工具lease等待子任务，防止slot/锁死锁；child完成后只传摘要、状态、证据引用和用量，不复制完整私有上下文。子Agent只能使用父grant与profile capability的交集，不能替父/兄弟审批。父取消递归取消子队列/作业；已started未知mutation仍quarantine。可单独取消子任务，父得到结构化cancelled结果后决定后续。Worker完成不直接把Run标成功，Reviewer独立验证证据。

UI增加Subagent设置（深度、每角色模型与预算）和Run内子任务树；Runtime同时执行数量统一在“执行与性能”中显示和调整；每张卡显示模型、排队/运行/等待审批状态、输入输出Token、预算预留、证据和取消按钮。历史Run显示创建时的配置快照，不被后续模型设置覆盖。后端任务及接口见实施文档§10。

### 10.1 多 Agent 通信：Run-scoped 持久化邮箱

采用Backend管理的MailboxPort，不使用全应用global event bus，不让Agent进程互连。每条消息绑定server-derived senderRuntimeId、recipientRuntimeId、runId、appId、delegationId；接收方必须在同一Run且被profile通信权限允许。parent/child默认可通信，siblings默认经parent协调，确需直接协作由profile显式允许。跨Run/App只能通过AppIntent交接，不可借mailbox绕过隔离。

消息种类为request/reply/progress/evidence/completion；控制性的cancel、grant、approval、spawn必须走宿主use case，不把字符串“停止/批准/创建”当授权。Agent提供的消息永远标agent-origin/untrusted，不能升级为用户或system输入。正文最多16KiB、完整信封64KiB、单收件人最多64条未消费消息属于固定协议容量；单Run累计消息默认软预算1000条/2MiB，达到时进入`awaiting_budget`询问用户，默认Hard Limit 5000条/8MiB并可在Agent Settings二次确认调整。固定容量超限返回MAILBOX_FULL/MESSAGE_TOO_LARGE；发送方不得持tool lease阻塞等待。

消息有messageId、idempotencyKey、recipientSequence、correlationId、replyTo、causationId、taskRevision、createdAt、expiresAt。服务端在同事务分配recipientSequence、插入消息、写Run event并唤醒scheduler；队列/回调只是通知，丢失后扫描DB补齐。传输采用至少一次交付，消费以messageId/sequence幂等；ack表示已作为输入写入消费水位，不表示模型理解或外部动作成功。

消息顺序只保证每recipient sequence单调，跨recipient不用全局“先到先执行”假设；Run event sequence提供审计顺序。request默认120秒TTL，progress30秒，evidence/completion使用所属任务/委派的有界TTL，并在Run取消或终态时失效；超时写expired并唤醒等待者，不无穷重试。重复key相同payload返回原messageId，不同payload409；旧taskRevision回复进入stale结果，只保留审计不驱动新计划。

入箱消息不默认全文塞模型；runtime先按correlation合并progress、过滤过期、构造摘要+证据引用，每个模型step最多8条/8KiB，强相关request/completion优先，原始消息仍在邮箱可按需查。跨模型交接只传任务目标/约束/当前结论/Artifact证据/未决问题，不复制私有完整历史。父级没有读取子私有prompt或隐藏思维链的接口。

### 10.2 调度、等待与无死锁

Scheduler是Backend单进程的持久队列，不引入Redis或分布式锁。工作项为model_step/tool_step/consume_inbox/verify/join_resume，持久记录queued/claimed/waiting/completed/cancelled、generation、deadline、依赖和attempt；重启从DB恢复，已started mutation只转reconcile，不重新执行。未来多Backend实例必须先引入一致的leader/claim协议，本版部署只启一个Agent scheduler。

配额分为 Run 通用 token/step/active-time/cost 预算与全局 Runtime/Provider/工具/环境并发配额，不再维护累计Subagent创建预算或独立子执行并发额度。模型streaming与tool执行持execution permit；等待reply/join/approval释放permit但保留有界checkpoint，不继续占着名额阻塞子任务。子工具仍受同Run默认一个toolCall并发限制。cancel、expiry、lease续约、reconcile为控制路径，不排在模型任务后面；控制路径不能绕过mutation策略。

公平性为App round-robin→Run round-robin→该Run的root/child队列（root权重2、child权重1）；同层FIFO，等待10秒的ready工作提升一次优先级防饥饿。每轮只claim一个可满足全部资源条件的work，先原子预留执行/模型slot，再事务外执行。不能拿着一个slot等另一个slot；拿不到完整资源就回queued。需要tool lease的工作只在执行槽已可用时短事务尝试获取，不持lease等待Provider/子任务。

委派依赖只引用同Run已经存在的delegation，默认依赖成功才运行；dependencyMode=settled允许失败后做诊断。新依赖或等待边加入前检测wait-for图，形成环返回DELEGATION_WAIT_CYCLE；禁止child join祖先。parent join期间收到child request可暂停join并调度parent处理邮箱，不能因为等待所有child完成而永远不回复。

join默认all，也允许any；任何join必须有显式deadline并受Run取消/终态截断，父任务等待不持lease/permit。Run本身不另设绝对生命周期deadline。any返回后未完成child不会悄悄取消，由调用者显式cancelRemaining；all收到失败返回结构化结果，不隐藏失败。单子失败默认isolate，父得到失败/证据后决定重试或替代；failFast需要profile声明并记录。完成的 Subagent 不占后续创建名额；每次新 delegation 都消耗一个 Run step，重复派生但无新增证据会触发 loop guard，因此不依赖历史数量上限防止无限换方法。

### 10.3 取消、恢复与共享事实

parent取消设置Run cancelRequested/epoch，原子取消queued work、拒绝新spawn/send/action，再向running children传播AbortSignal；确认停止的child转cancelled，未知远端修改quarantine并使Run interrupted。单独取消child不自动取消siblings；child的后代递归取消；晚到的reply/result可记录，但不推进取消后的计划。

SharedFacts只允许run-scoped key/value+version CAS，值64KiB、单Run总1MiB；消息可带factVersion作为前置条件。多Agent修改冲突返回FACT_VERSION_CONFLICT，必须重新读再规划，禁止last-writer-wins覆盖证据。文件共享用ArtifactRef/grant，不共享sqlite连接/内存对象/环境目录。共享fact、message ack与scheduler唤醒使用同一个StateCommitPort事务。

重启对claimed model_step记aborted并结算预留，再按Run interrupted规则要求用户Resume；不后台自动恢复成本消耗。邮箱保留未消费消息和终态，Resume只导入用户确认的摘要/证据，重新生成runtime IDs，不把旧recipient消息改投新身份。Controller未决job按commandId核实，Subagent失败不能导致父忽略仍在运行的远端作业。

## 11. 前端 UI 与原页面兼容

全局只有一个 AgentLauncher 和一个 AgentHubWindow，挂在 App.vue 的 RouterView 外、登录后可见；**Agent 只提供全局非模态浮窗，不提供独立全页 presentation，不修改当前 RouterView 路由，也不改 AppHeader/顶部横向导航。** Agent Hub 采用**conversation-first**：中间 Conversation 是始终存在的主工作区，用户通过自然语言产生目标、计划、执行任务、审批和结果；Run/Step/Subagent/Workspace 是对话派生的执行事实，不把用户强制切换到独立“任务管理后台”。窗口非模态，不锁body、不遮原终端，不引用 RemoteDesktopModal 的连接或Guacamole对象。默认1080×700、最小640×420（小视口例外），边界按顶部导航/visualViewport clamp；宽<1200收任务详情，宽<768用全宽sheet，避让虚拟键盘/安全区。

Launcher只定义**单击**打开：恢复上一次选中的有效App及其会话视图状态；移动>6px视为拖动并取消本次打开，pointercancel/卸载释放capture，Enter/Space立即打开并忽略repeat/合成click。App切换始终在Hub内部完成：标题区/会话栏顶部提供常驻的单选`AgentAppSwitcher`，可搜索授权App并显示最近项；选择A→B只改变前台presentation，A已启动的Run/Workspace/Subagent/审批/预算等待全部继续，不能因切换App、最小化或关闭Hub而cancel。Host持续订阅各App安全summary；非当前App暂停详细 Agent event subscription和重型视图，重新切回时用snapshot+catchup恢复。每个已访问App在当前登录生命周期内保留独立的threadId/draft/scroll/选中task等轻量view state；刷新后运行事实从服务端恢复，未提交draft仍不持久化。无历史默认Operations；停用App过滤，全部无效显示empty-state。

Hub内部左侧为可收起的会话/App导航，并提供用户级“文件”入口；中间始终是当前 Conversation + 固定 Composer，右侧为可折叠 TaskRail。文件库打开时复用 Hub 主内容区展示统一 Artifact 管理视图，关闭/返回后恢复原 Thread 的 scroll/draft，不创建第二套会话状态。TaskRail 展示当前会话由 Agent 生成的 typed PlanItem/进行中任务及同 App 的后台活跃 Run 摘要，不复制完整日志；PlanItem 的 status/depends/evidence 与 Run/verification 状态统一走 Agent i18n。点击任务在右侧 TaskDetailDrawer 原位展开步骤、状态、资源、审批、Artifact、Subagent、Workspace Runtime 与日志，关闭详情恢复原 Conversation 滚动锚点和 draft，不切换到第二套 Composer。Root Run 的 Workspace 产品入口读取 `/apps/:appId/runs/:runId/workspaces?runtime=root`，创建请求只提交 Workspace spec（Recipe、版本选择、显式 Runner Plugin ids、资源/网络）与 retention，由 Backend 解析 root `agentRuntimeId`，浏览器不能伪造 runtime identity。同一 runtime 最多一个状态非 `deleted/failed` 的活跃 Workspace，repository 在幂等重放后执行唯一性约束。Workspace create/start/restart 与目标 Workspace ACL 写入必须重新通过 `workspace.runtime.manage` Capability；stop/delete 作为安全收敛路径仍允许 teardown。Workspace↔Artifact 转换继续走 Backend exchange/capability 路径，并分别检查 `workspace.runtime.execute + artifacts.write/read`，不把 Artifact/Runner 内部对象直接交给前端或 Plugin。Operations 的 Timeline/Approval/Artifact/Token 都作为消息内卡片或 TaskDetail 的按需视图存在；消息 Composer 的“附件/文件”按钮打开轻量选择器，从文件库选现有 Artifact 或上传新文件，“引用知识”则是另一条知识检索入口，二者名称和职责不混用。App切换保留内存draft/scroll，暂停旧详细 Agent event subscription而不cancel；新App先授权registry→本地contribution map→lazy import→snapshot+catchup。navigationGeneration丢弃过期异步加载。授权失败绝不因本地chunk存在继续渲染。

Hub标题/工具区只提供**单选 App 切换**及当前会话/任务所需控制，不支持一个 Run 同时组合多个 App，也不提供 Settings 或 Runner 配置跳转。Agent 的宿主级配置统一并入现有 Nexus `/settings` 页面，新增 `Agent` tab；其中管理 Agent 总开关、App 启停、模型与Provider、执行与性能、预算与上下文、Hard Limits、Subagent、Artifact与存储、Workspace Runtime/Runner、安全与网络、系统保护。 Agent总开关默认开启；关闭时服务端先禁止新 Run/step/Workspace Runtime claim，再按现有cancel/quiesce/reconcile收敛执行，未知远端副作用仍quarantine。关闭完成后隐藏Launcher；Settings及安全清理/审计入口仍可用，历史会话、文件、配置和审计数据都保留但不通过已关闭的Hub继续交互，重新开启后可重新浏览；重新开启不自动续跑旧Run。Workspace Runtime Manager 在该 tab 内长期存在：一期显示真实 unavailable，二期启用完整 Catalog/Pack/cleanup 管理，不另造第二套配置状态。系统保护只读展示event batch、commit queue、Agent WebSocket订阅/缓冲上限、transient delta策略和当前数据库压力/availability；普通用户不能关闭背压或改成逐chunk持久化。执行与性能页允许调低Runtime/模型并发等软上限，模型并发默认Auto跟随Runtime并发。

Launcher角标只订阅Host summary，不加载每App的private store；后台运行、审批和预算请求只更新角标/通知，不自动抢焦点。关闭Hub/最小化/切App都只是presentation动作：释放或暂停不可见重型视图与详细流，保留每App轻量view state和Host摘要，**绝不取消 Run/Workspace/Subagent**。重新打开默认回到最后选中的App；切回后台App时重新snapshot+catchup当前真实状态。Agent 不新增顶栏导航、不注册独立 Agent 页面路由；任何文件/任务详情都在同一 Hub 内切换并可返回原 Conversation 滚动锚点和 draft。

运行中的 Conversation **始终允许继续输入**。Composer提交先持久化用户输入并立即返回，不等待当前模型/tool/job结束；若模型正在stream则按§7规则终止旧attempt并在下一安全step合并新输入，若不可安全中断的tool/job已started则标记pending input并在结果确认后优先处理。用户可用自然语言纠正目标、改变约束、要求暂停某类动作或继续询问相关内容；前端不猜测“这是聊天还是控制命令”，Harness根据最新input watermark重新规划，任何生产副作用仍需原Policy/Approval/Lease。UI不得因为Run busy/awaiting approval/awaiting budget而禁用Composer，仅取消/登出/会话不可写时禁用。

localStorage仅存 nexus.agent.surface.v1.user.<userId> 的bounds/maximized/launcherPosition/recentAppIds，版本1与大小8KiB限制；不存threadId/runId/draft/message/approval/token。刷新后最近会话由authorized server API恢复。登出清内存、订阅、preview票据、iframe/message ports，重新登录不复用旧事实。

长时间会话的UI性能是固定架构边界：Conversation 只通过cursor分页读取 canonical ledger，采用反向增量加载和虚拟化/windowing，禁止把整个Thread全部挂进Vue响应式树或DOM；加载旧页时保持视觉anchor，不因prepend跳动。streaming delta先进入非持久buffer，以requestAnimationFrame/有界节流批量刷新可见消息，Markdown/代码高亮只对final或停止stream后的内容做完整解析，不能每token重跑全文渲染。TaskRail读取独立Run/plan摘要投影并按id增量patch，禁止每个 Agent event扫描全ledger；TaskDetail、Artifact、tool output、Subagent树按点击lazy load并分页，大内容只显示有界preview。前端对离屏旧页做LRU淘汰、需要时按cursor重取，服务端仍保留canonical事实；关闭/切换会话应释放不可见的重型DOM、parser和detail订阅但不取消运行。

通过现有focus public facade登记；overlayStack新增只读modal-presence订阅，Agent位于既有modal之下，模态存在时Launcher暂停，Escape仅由当前top/focus owner处理。关闭恢复仍挂载的之前焦点。原生RDP全屏不强制退出或覆盖；主题复用tokens、翻译放agent/i18n三语同键。

## 12. 可观测、生产运维与验收边界

Agent审计记录requestId/runId/stepId/operationHash/目标别名/结果/token/耗时/配额，不保存明文密钥、隐藏思维链或无限prompt；业务messages按用户会话权限读取，不进入全局诊断日志。redaction不能保证识别所有秘密，因此外部日志默认最小读取，用户主动提交敏感资料仍提示模型出站风险。

Agent Browser 事件统一使用独立 `/ws/agent` WebSocket，不修改全局 Axios timeout，也不复用 Workspace/NXR2 socket。upgrade 复用现有 WebSocket 的同源 Origin、IP whitelist、session/2FA 与 heartbeat 边界；Host/Run 通过显式 subscription 订阅，durable 事件只以数据库 sequence 推进 cursor，`message.delta`/`tool.delta` 仅实时发送且无 durable id。Nginx 复用现有 `/ws/` upgrade 代理，不再需要 Agent SSE 专用 location；登出、reset、shutdown 或 WebSocket quiesce 必须关闭订阅。

reset/restore先quiesce：关闭入口、递增generation、abort作业、等待有界inflight提交、关闭 Agent WebSocket subscription/timer、处理执行owner/容器，再重置DB；旧回调不能写入新库。超时reset失败，不在仍有写者时清库。shutdown同序，30秒总期限，未知远端结果持久化以便reconcile。

验收包括：生产dist启动、空库/升级、授权/串App、输入调度、重复请求、`/ws/agent` 断线重连/sequence replay/慢客户端、审批竞争、lease丢失/未知结果、Artifact中途失败、Runner/sandbox unavailable降级、停机/reset、已有Workspace/RDP交互与隔离。自动行为测试仅按EC-E2E放test/e2e并从真实产品API/UI/ingress断言；build/architecture guard验证内部边界。三期扩展用同一基准测质量和成本，不能以“模型说完成”作为通过条件。
