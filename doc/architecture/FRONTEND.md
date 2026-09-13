# Nexus Terminal Frontend Architecture

> 本文定义 Nexus Terminal Frontend 重构后的长期架构，是前端目录、依赖方向、组件归属、状态归属、Workspace / Agent 运行时边界以及 HTTP / WebSocket contract 边界的权威说明。
>
> 本文只描述当前长期 Frontend 架构。历史重构计划、迁移清单、临时 handoff 和旧依赖审计已在重构完成后退役；产品行为追溯由 [软件需求](../software-requirements/README.md) 保存，强制工程边界由 [工程约束表](../software-requirements/engineering-constraints.md) 唯一定义。

## 1. Architecture goals

Frontend 重构不是目录搬迁，而是重新建立明确的 ownership 和单向依赖图。

最终目标：

- UI / feature / runtime / transport 责任清晰；
- 删除旧全局 store 相互引用形成的循环依赖；
- Vue component 不直接认识 HTTP snake_case DTO、旧 WebSocket message、NXTM / NXUP legacy framing；
- Workspace 和 Agent 使用独立 runtime，不共享 live socket/session/state object；
- 可复用能力通过 clean model、component、port/service interface 复用；
- Feature 跨域依赖只能经过公开 surface；
- App 只作为 composition root；
- Backend `interfaces/http/legacy-api/` 与 `interfaces/websocket/legacy-api/` 已在 clean contract 切换完成后删除，且不需要修改 Module / Platform responsibility；
- 保持现有用户可见功能和 E2E 行为。

## 2. Why the old structure is not retained

旧前端静态依赖分析包含约 203 个 TypeScript / Vue / JavaScript source file 和 539 条内部 import edge，并存在两个明确的 strongly-connected component：

1. 一个 19 文件大环，跨越 `auth`、`session`、`connections`、`fileEditor`、`settings`、`layout`、router 与 `apiClient`；
2. `FileManagerContextMenu.vue <-> useFileManagerContextMenu.ts` 直接循环。

典型旧依赖：

```text
auth store
  -> session store

session store
  -> connections store
  -> fileEditor store
  -> session action modules

session types
  -> fileEditor store

settings store
  -> auth store
  -> connections store
  -> layout store

apiClient
  -> auth store / router side effects
```

因此旧的：

```text
components/
composables/
stores/
views/
utils/
```

不能通过简单移动到 `features/` 解决问题。Feature restoration 必须是 rewrite。

## 3. Product capability inventory

Frontend architecture 按真实用户能力而不是旧文件类型划分。

### 3.1 Identity and security

- initial administrator setup；
- username/password login/logout；
- authenticated session 与 protected navigation；
- password change；
- 2FA setup / verify / disable；
- passkey login / management；
- CAPTCHA configuration；
- IP whitelist；
- IP blacklist / ban policy。

### 3.2 Connection catalog

- SSH / RDP / VNC connection CRUD；
- connection test；
- clone；
- search / sort / tag filter；
- batch edit / delete；
- script-mode bulk creation；
- notes；
- password / SSH-key auth；
- SSH key management；
- proxy configuration；
- jump host chain；
- RDP RemoteApp；
- RDP / VNC session launch。

### 3.3 Management capabilities

- notifications；
- audit logs；
- user/system preferences；
- backup / restore；
- appearance / themes / backgrounds；
- quick commands；
- command history；
- local/remote system overview。

### 3.4 Interactive runtime capabilities

- terminal；
- remote filesystem；
- file editor；
- file preview；
- upload / copy / move / cross-session transfer；
- archive / decompress；
- progress center；
- status monitor；
- Docker；
- SSH suspend/resume；
- remote desktop；
- Workspace layout / pane composition；
- mobile/touch interaction。

## 4. Final source layout

Current source structure:

```text
packages/frontend/src/
├── app/
│   ├── main.ts
│   ├── App.vue
│   ├── bootstrap/
│   ├── config/
│   ├── router/
│   ├── pages/
│   ├── shell/
│   ├── i18n/
│   └── styles/
├── assets/
├── client/
│   ├── http/
│   └── websocket/
├── foundation/
│   ├── async/
│   ├── browser/
│   ├── interaction/
│   └── ui/
├── shared/
│   ├── feedback/
│   └── focus/
├── features/
│   ├── auth/
│   ├── security/
│   ├── preferences/
│   ├── appearance/
│   ├── backup/
│   ├── audit/
│   ├── notifications/
│   ├── connections/
│   ├── tags/
│   ├── ssh-keys/
│   ├── proxies/
│   ├── quick-commands/
│   ├── command-history/
│   ├── system-overview/
│   ├── terminal/
│   ├── filesystem/
│   ├── file-editor/
│   ├── file-preview/
│   ├── transfers/
│   ├── status-monitor/
│   ├── docker/
│   ├── remote-desktop/
│   └── ssh-suspend/
├── runtimes/
│   ├── workspace/
│   │   ├── model/
│   │   ├── session/
│   │   ├── protocol/
│   │   ├── adapters/
│   │   ├── layout/
│   │   ├── settings/
│   │   ├── components/
│   │   └── views/
└── env.d.ts
```

Feature folders只创建实际需要的子目录。普通 HTTP-backed feature 推荐：

```text
features/<feature>/
├── public.ts
├── model/
├── api/
│   └── wire/          # temporary/current external DTO ownership when needed
├── store/
├── composables/
├── components/
├── views/
└── i18n/
    ├── en-US.json
    ├── zh-CN.json
    └── ja-JP.json
```

## 5. Layer responsibilities

### 5.1 `foundation/`

Business-agnostic browser/UI primitives。

可以包含：

- button/input/select/checkbox/modal/panel；
- generic context menu / tabs / toolbar primitives；
- pointer / touch / resize / drag behavior；
- browser/device helpers；
- generic async coordination。

禁止依赖：

- Pinia feature stores；
- Vue Router；
- business i18n key；
- HTTP / WebSocket；
- product model such as Connection/FileEntry/Session；
- persistence key with product meaning。

### 5.2 `shared/`

Application-wide、domain-neutral composition。

当前主要 owner：

- feedback: toast / confirm / alert；
- focus: global focus / shortcut infrastructure；
- components: 只有多个领域真正共享且没有业务语义的 composite component。

`shared/` 不是“放不下的组件垃圾桶”。只因为两个页面都用了一个组件，不代表它属于 shared。

### 5.3 `client/`

只负责 browser transport：

- Axios instance / fetch infrastructure；
- raw WebSocket opening / closing / byte transport；
- transport-level error primitives。

禁止：

- import feature store；
- import router；
- 导航；
- toast；
- token/session product state；
- business DTO mapping。

### 5.4 `features/`

拥有有明确业务语义的模型、API、状态、UI 和 reusable capability interface。

Feature 应尽量自包含。

### 5.5 `runtimes/`

负责实时运行时编排，而不是基础业务 catalog。

Workspace 和 Agent 都是 composition/runtime owner：

- 创建 live session；
- 绑定 transport/protocol adapter；
- 把多个 feature capability 组合成一次运行；
- 管理 runtime lifecycle；
- 将用户操作路由给 capability port。

Runtime 不应该重新实现 Connections、Filesystem、Terminal 等领域逻辑。

### 5.6 `app/`

唯一全应用 composition root：

- Vue/Pinia/i18n/router startup；
- route composition；
- global shell；
- bootstrap ordering；
- settings/dashboard 等跨域 page composition。

Feature 不反向依赖 App。

## 6. Dependency direction

Canonical dependency graph:

```text
foundation
   ↑
shared                         client transport
   ↑                                  ↑
feature model / ports                 │
   ↑                                  │
feature api / store / composable -----┘
   ↑
feature components
   ↑
runtime adapters / runtime composition
   ↑
app pages / shell / bootstrap
```

Hard rules:

1. `foundation` 不依赖任何 product layer；
2. `shared` 只依赖 foundation / framework / domain-neutral library；
3. `client` 不依赖 feature state/router/UI；
4. feature model 不包含 wire DTO、Axios response、raw WebSocket；
5. cross-feature import 必须经过被依赖 feature 的 `public.ts`；
6. feature A 禁止 import feature B 的 `store/`、`api/`、`protocol/` private path；
7. lower-level feature 禁止 import Workspace/Agent/App；
8. Workspace 与 Agent 禁止互相依赖 internal runtime；
9. 完整 graph 必须保持 acyclic；
10. App 是最终 concrete graph owner。

禁止示例：

```text
client -> auth store
client -> router
settings store -> auth store
terminal -> workspace socket
filesystem -> workspace session store
agent -> workspace session
feature A -> feature B/store/*
```

允许示例：

```text
connections view -> tags/public.ts
workspace adapter -> terminal/public.ts
workspace view -> connections/public.ts
settings page -> security/public.ts
app router -> auth/public.ts
```

## 7. Feature public surface

每个需要被跨域使用的 feature 提供：

```text
features/<feature>/public.ts
```

可公开：

- clean model/type；
- capability port/service interface；
- deliberate reusable component；
- public composable/use-case facade；
- read-only/public state facade。

不得公开：

- wire DTO；
- legacy mapper；
- raw Axios client；
- raw WebSocket object；
- internal Pinia implementation object；
- private protocol implementation。

`public.ts` 的目的不是 re-export everything，而是定义稳定边界。

## 8. Component architecture

组件分三层。

### 8.1 Foundation UI

例如：

```text
BaseButton
BaseInput
BaseTextarea
BaseSelect
BaseCheckbox
BaseFormField
BaseModal
OverlayPanel
BaseSpinner
BaseBadge
BaseTable
BaseContextMenu
TokenInput
```

只提供 props / events / slots / native attrs。

### 8.2 Shared composite UI

仅 domain-neutral application components，例如：

- generic loading/error surface；
- generic searchable toolbar；
- common focus/shortcut overlay。

### 8.3 Feature components

有业务语义的 UI 必须归 feature owner。

例如：

```text
features/tags/ConnectionTagPicker
features/quick-commands/QuickCommandTagPicker
features/ssh-keys/SshKeySelector
features/connections/ConnectionForm
features/filesystem/FileManager
features/file-editor/FileEditor
features/terminal/TerminalView
features/transfers/ProgressDisplay
features/remote-desktop/RemoteDesktopWindow
```

旧 `TagInput.vue` 的正确拆法：

```text
foundation/ui/TokenInput
           ↑
           ├─ tags/ConnectionTagPicker
           └─ quick-commands/QuickCommandTagPicker
```

这样 shared visual interaction 与业务 tag source 分离。

## 9. State ownership

旧 `session.store.ts` 同时拥有 WebSocket、SFTP、terminal、status、Docker、editor、command input、RDP/VNC 和 suspend state，是主要循环依赖来源之一。

新状态必须按 capability owner 拆开。

```text
runtimes/workspace/session
  - workspace id
  - connection identity
  - runtime lifecycle
  - tab selection
  - reconnect lifecycle

features/terminal
  - terminal viewport/runtime state

features/filesystem
  - directory / selection / path state

features/file-editor
  - editor tabs / content / dirty state

features/transfers
  - upload/copy/archive/progress task state

features/status-monitor
  - status subscription/result state

features/docker
  - Docker view/command state

features/remote-desktop
  - RDP/VNC window/input state

features/ssh-suspend
  - suspended session catalog/resume state
```

Store rules：

- 一个 store 只拥有一个 coherent state owner；
- store 不负责 router navigation；
- store 不直接弹 toast/confirm；
- store 不构造另一个 feature store 形成隐式 dependency graph；
- view/use-case/runtime composition 负责跨 feature orchestration；
- persistent preferences 与 live runtime state 分离。

<a id="workspace-shared-ai-and-app-runtimes"></a>

## 10. Workspace, App Platform and App frontend ownership

这是长期架构中的核心边界。完整产品体验通过 App Platform 注册；共享 AI/Conversation 能力属于 feature/public surface；`nexus.agent` 是默认推荐的 first-party installable Plugin App，一个 Host surface 内承载 Operations / Developer 两个 Skill，不是 compile-time built-in。`nexus.fullstack` 作为独立 first-party target reference App 覆盖 custom frontend/backend/runner。Workspace 仍然是独立 runtime owner 而不是 App host。详细边界见 [Agent 架构](../AGENT.md)。

### 10.1 Workspace owns

Workspace runtime 只拥有 Workspace-specific live composition，例如：

- workspace lifecycle；
- connection-to-session binding；
- workspace WS protocol adapter；
- pane/layout composition；
- reconnect and suspend handoff orchestration；
- 将 terminal/filesystem/status/docker/etc capability 绑定到该 runtime。

### 10.2 Agent frontend Host / App Platform owner

当前 Agent App Platform 的前端物理 owner 是 `features/agent/host`；内置 Agent App 继续作为同一 Agent feature 下的 contribution，不另设顶层 App Platform feature 或独立 npm App package：

```text
App.vue
  ↓ features/agent/public.ts
AgentSurfaceHost
  ↓
AgentHubWindow
  ├── Host Agent surface（安装式 App 无 frontend target）
  └── PluginAppFrame → full Custom App Surface → isolated plugin origin
                         ↓
                    plugin-sdk/ MessagePort bridge
```

`host/` 只负责 Launcher/Hub/App switcher、每 App 轻量 view state、Host Agent surface 与 Custom Surface iframe 生命周期；它不拥有 Plugin SDK dispatch，也不拥有 Run/Provider/Artifact 的后端事实。`plugin-sdk/` 高内聚拥有 Plugin Frontend protocol、MessagePort host bridge 与 App-scoped Agent SDK dispatcher；它复用 `runtime/run-facade.ts` 和 `api/` transport，不重新实现 Run 状态机。默认 `nexus.agent` 通过正常安装式 Plugin lifecycle 注册，并在一个 Host Agent surface 下暴露 `nexus.operations` / `nexus.developer` 两个 Skill；不再为两个 Skill 建两套 App presentation state。`nexus.fullstack` 因声明 frontend target 而使用 Custom Surface iframe。当前单用户 Host 仍允许同时安装多个不同 `appId` 的 Plugin，`AgentAppSwitcher` 与 activity strip 在同一个 Hub 中切换这些 App；每个 App 的当前 Thread、draft、Next Run model、Next Run Environment 等 presentation state 独立保存，同一 `appId` 的新版本通过 upgrade/drain 替换当前安装而不是制造第二份平行 App。

Agent Hub 的响应式规则必须以 named container `agent-hub-window` 为准，而不是浏览器 viewport：宽窗口保留 Threads / Conversation / TaskRail，逐级收起 model meta、TaskRail、Run history，窄窗口把 Threads 变为 drawer 并允许 Run Configuration 换行；Hub chrome 的 App search/activity strip/title 等非关键元素也使用同一 container query 收缩。这样用户把浮窗拖窄时，内部交互与布局仍按真实可用空间变化，而不会因为浏览器本身很宽继续显示拥挤控件。

没有 Frontend target 的安装式 AgentDefinition App 使用 Nexus 默认 Agent surface；有 Frontend target 时 iframe 获得 Hub 内整个 App content surface，可完全自定义布局。动态 UI 始终走独立 origin + `sandbox=allow-scripts` + MessageChannel/nonce/source 校验，不允许 arbitrary same-origin JavaScript 获得 Nexus 页面权限。Plugin static origin 只承载公开 immutable package assets 与 Nexus Frontend SDK，并显式允许无凭证 CORS（`Access-Control-Allow-Origin: *`），以支持 opaque sandbox origin 的 ES module 加载；Nexus 主站 API 不因此开放跨域访问。隔离 Plugin origin 由 Nexus 同源提供 `/sdk/frontend-v1.mjs`；SDK 只代理显式 App-scoped 能力，不向 iframe 暴露 cookie、CSRF、HTTP client 或内部 service object。MessagePort request/response/event envelope 最大 256 KB；AppStorage Backend RPC 仍独立限制为 64 KB。Custom UI 可读取 Subagent/message 并取消 delegation，但 Subagent 创建、调度和 capability delegation 仍由 Agent Runtime/Tool policy 拥有。

### 10.3 Agent 共享前端能力

当前共享 Agent 前端能力仍收敛在同一个 feature owner 内，而不是另造顶层 AI feature：

```text
features/agent/
├── api/       typed HTTP + `/ws/agent` client + transport parsing
├── ai/        conversation presentation
├── files/     Files / Artifact Library 与 picker
├── runtime/      Run/Task/Approval/Subagent/Environment presentation + facade
├── plugin-sdk/   Custom Frontend protocol/MessagePort/Agent SDK dispatcher
├── settings/     Agent host/settings contribution
└── host/         Launcher/Hub/App/Host Surface/Custom Surface lifecycle owner
```

Frontend 不执行权威 Recall/vector search、context budgeting、Tool authorization、Policy/Approval/Lease 或 Environment isolation。浏览器只持有安全 view/projection 和交互状态；Backend 仍是 canonical conversation、Run、Artifact、Capability、Memory/Context 和安全决策的事实 owner。

### 10.4 Host Agent surface for installable AgentDefinition Apps

没有 Frontend target、但 manifest 声明 AgentDefinition 的安装式 App 统一使用 `features/agent/host/AgentAppSurface.vue`。默认 `nexus.agent` 走这条通用路径，Operations / Developer 只是该 App 内的两个 Skill；Frontend 主仓不再存在 Skill-specific App component 或 compile-time Operations/Developer View。`nexus.fullstack` 因声明 frontend target 而改走 isolated Custom Surface。

Host Agent surface owns presentation only:

- App-scoped conversation/run live projection；
- `/api/v1/apps/:appId/...` typed protocol clients；
- event-stream reconnect/lifecycle；
- Agent participant/runtime presentation；
- Goal/Plan/delegation/tool/approval/verification UI state；
- context/Recall/Skill/Artifact explainability presentation；
- Next Run Model / Environment / Targets presentation state and frozen Active Run projection.

它只组合 `features/agent` 内已定义的 Host/API/AI/runtime public behavior；不拥有 Provider credentials、Backend Context planning、Recall engines、generic Skill registry、Workspace runtime 或另一个 App 的 runtime。App-specific AgentDefinition/Skill/version 来自已验证的 Plugin manifest/package，而不是本地 component registry。

用户输入历史仍是 canonical conversation source。Frontend 可以展示完整历史、修正关系和 compaction/context 状态，但浏览器裁剪不是权威历史，不能本地覆盖 Backend digest/projection 后继续执行。Backend 分配稳定 sequence/id；显式编辑/删除必须走后端 conversation mutation contract 并失效相关派生状态。

Frontend 不直接实现 ACP client。浏览器通过 App-scoped HTTP + `/ws/agent` contract 与 Nexus backend 通信；ACP wire/session/permission 由 Backend/Runner capability owner 隔离，安装式 App 只获得其 manifest grant/policy 允许的 capability。

### 10.5 Future Agent App contributions

未来 Roleplay/Research 等 App 只有在真实需求出现后才新增独立 Plugin package；不在 Nexus 主仓预建 compile-time sibling App contribution。无 Frontend target 的 App 复用 Host Agent surface；有 Frontend target 的 App 通过 Backend 验证 manifest 后由 `PluginAppFrame` 加载隔离 UI。App 可以消费明确的 Agent 公共能力，但永远不能 import 另一个 App 的私有 runtime/store，也不能继承 Operations 的 SSH/approval 业务语义。

### 10.6 Apps must not reuse Workspace internals

禁止：

```text
Installable Agent App / Host Agent surface -> Workspace raw WebSocket
Installable Agent App / Host Agent surface -> Workspace SessionStore
Installable Agent App / Host Agent surface -> Workspace SFTP manager
Installable Agent App / Host Agent surface -> Workspace Terminal manager
Installable Agent App / Host Agent surface -> Workspace current cwd
Installable Agent App / Host Agent surface -> Workspace upload socket
```

如果 Workspace 和某个 App 都需要 terminal/filesystem/transfer UI capability，应复用 feature public interface，而不是 runtime object：

```text
Terminal Feature public port
        ↑
        ├── Workspace adapter
        └── Agent Host surface adapter
```

类似模式应用于 Filesystem/Transfer/Status/Docker 等展示能力。Backend machine execution 仍由 App Capability Broker + Host governed Tool/Policy/Approval boundary 管理，不等于把 frontend port 暴露给模型。

## 11. HTTP architecture

当前 URL family 可以继续使用 `/api/v1`。Clean architecture 不等于必须新增 `/api/v2`。

Frontend internal model 与 external HTTP transport 必须保持明确边界。当前 clean contract 已完成对齐：

```text
Vue component
    ↓
feature clean model / use-case
    ↓
feature API boundary
    ↓
clean camelCase Nexus HTTP DTO
    ↓
HTTP transport
    ↓
Backend HTTP Interface validation / mapping / redaction
    ↓
Backend Module clean model
```

Frontend feature API 不再维护历史 Nexus snake_case wire mapper。数据库 row/column 的 snake_case 只允许存在于 Backend Infrastructure repository/storage 边界，不得泄漏回 HTTP Interface 或 frontend model/store/component。

已删除的路径：

```text
packages/backend/src/interfaces/http/legacy-api/
```

不是未来扩展点，不得重新创建。删除 compatibility 不改变 Backend Module / Platform business responsibility。

## 12. WebSocket architecture

Raw WebSocket transport 只属于：

```text
client/websocket/
```

Workspace protocol ownership belongs to `runtimes/workspace/protocol/`. Agent/App-scoped HTTP + `/ws/agent` transport ownership belongs to `features/agent/api/`; Run-facing state/facade belongs to `features/agent/runtime/`; Custom Frontend protocol/MessagePort dispatch belongs to `features/agent/plugin-sdk/`; Host owns window/App switching、generic Agent surface 与 iframe lifecycle in `features/agent/host/`. Agent code must not reuse Workspace sockets/sessions, and Workspace code must not import Agent live state. Dynamic Plugin UI uses the Plugin SDK bridge rather than Workspace WebSocket or direct Nexus API/session access.

Terminal/Filesystem/Transfer 等 feature 不应该直接发送 string message name。

正确结构：

```text
FileManager
  ↓
Filesystem use-case
  ↓
FilesystemPort
  ↓
WorkspaceFilesystemAdapter
  ↓
Workspace typed protocol
  ↓
raw websocket transport
```

而不是：

```text
FileManager -> sendMessage({ type: 'sftp:readdir', ... })
```

新 protocol 要使用 typed discriminated unions / request-response-event families，而不是：

```ts
{
  type: string;
  payload: any;
}
```

### 12.1 Terminal binary transport

当前正式 Workspace binary transport 使用独立 protocol v1，不使用历史 replay/ACK envelope，也不把文件/历史 bytes 放进 Base64 JSON。server-to-browser binary message 带固定 16-byte header，frame kind 区分 `terminal` 与 request-scoped `response`；response 通过 requestId + final flag 与 JSON metadata request 对齐，每个 raw binary payload frame 最大 256 KiB。Terminal output、SFTP `filesystem.readBinary`、文本编辑器 raw byte snapshot 与 suspend history 都走该 framing；`WorkspaceSocket` 负责解帧/按 requestId 重组，Terminal/File Preview/File Editor 只消费自己的 typed capability bytes。`workspace.connect` / resume 返回 `binaryProtocolVersion`，Frontend 不匹配时 fail closed。Backpressure/queueing 仍由 WebSocket transport owner 负责，不进入 feature domain model。

### 12.2 Upload binary transport

当前正式 upload transport 为“一条 upload socket 对应一个 upload”：binary WebSocket message 是按序 raw file bytes，声明的总大小决定完成边界；ready/conflict/skipped/completed/cancelled/failed 等 lifecycle 语义通过 clean control contract 表达。

Upload feature 只认识 upload semantics，不认识历史 binary envelope。Chunk ordering、size validation、queue/backpressure 属于 runtime protocol/transport adapter。

## 13. File and operation models

Filesystem feature 使用 clean `FileEntry` model，不继续传播历史：

```text
filename
longname
attrs
atime
mtime
```

推荐语义：

```ts
interface FileEntry {
  name: string;
  path: string;
  longName?: string;
  metadata: {
    size: number;
    uid: number;
    gid: number;
    mode: number;
    accessedAt: number;
    modifiedAt: number;
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
  };
}
```

Transfer/Upload/Archive progress 统一归 `features/transfers`，组件不直接解释 legacy WS message family。

## 14. i18n ownership

Locale runtime/selection 位于：

```text
app/i18n/
```

Translation content 跟随 owner：

```text
features/connections/i18n/en-US.json
features/connections/i18n/zh-CN.json
features/connections/i18n/ja-JP.json
```

Rules：

- one namespace per owner；
- 三种 locale key tree 必须完全一致；
- 不通过 `t(key, "hard-coded fallback")` 掩盖缺失 key；
- dynamic key 必须来自 typed/closed mapping；
- Backend message string 不直接成为 translation key；
- legacy DTO/message name 不成为 namespace；
- app/common/shared 文案各自由自己的 owner 管理。

## 15. Third-party dependency ownership

第三方 library 也必须有 owner，避免再次变成全局隐式依赖。

| Dependency                            | Owner                              |
| ------------------------------------- | ---------------------------------- |
| Axios                                 | `client/http`                      |
| browser WebSocket                     | `client/websocket`                 |
| xterm                                 | `features/terminal`                |
| Monaco / CodeMirror                   | `features/file-editor`             |
| PDF.js / xlsx / docx-preview / marked | `features/file-preview`            |
| Guacamole                             | `features/remote-desktop`          |
| Chart.js                              | `features/status-monitor`          |
| splitpanes                            | `runtimes/workspace/layout`        |
| SimpleWebAuthn                        | `features/security` / auth surface |
| hCaptcha / reCAPTCHA                  | `features/security`                |

旧 frontend 全局注册 Element Plus，但当前没有有效 `el-*` component consumer。重构后如果仍无真实 owner，应删除该 dependency，而不是继续全局注册。

旧 `mitt` 主要承担 Workspace event bus。新 runtime 应优先使用 typed port/event contracts，而不是恢复全局 string event bus。

## 16. App page composition

有些 route 是 composition page，不是业务 owner。

例如：

### Dashboard

Dashboard page 组合：

- Connections；
- Tags；
- System Overview；
- Audit recent activity；
- Workspace launch action。

Dashboard 不拥有这些数据模型。

### Settings

Settings page 继续是 composition surface，不拥有 Agent 设置状态。当前 Agent 通过一个明确 public contribution 接入：

```text
SettingsPage
├── existing Nexus settings
│   ├── Preferences / Security / Appearance / Backup / Workspace
│   └── ...
└── Agent tab
    └── features/agent/public.ts → AgentSettingsPanel
        ├── Host / App management
        ├── Providers / model configuration
        ├── budgets / hard limits / safety / target denylist
        ├── Environment / Plugin / storage
        └── Subagent profiles
```

`SettingsPage` 只 import `features/agent/public.ts` 暴露的 `AgentSettingsPanel`，不 import 任何安装式 App 私有 store/runtime，也不持有 Provider secret。未来 Plugin-specific settings 必须通过显式 Plugin/Host contract 接入；不能为尚不存在的 App 预建一套全局 settings registry。

Provider API keys 与 Integration credentials 都属于 write-only secret input，不得保存在普通 preferences store 或回传明文；前端只持有 `apiKeyConfigured` / `hasCredential` 等安全状态。第三方 Provider/MCP/未来 ACP 的模型/工具/capability/status 均由 Nexus Backend 获取、归一化和授权，浏览器不得携带 secret 直接调用外部服务。

Settings screen 不再拥有一个万能 `settings.store.ts`。当前 Agent settings 仍由 `features/agent/settings` 自己管理；未来 sibling App 若需要设置入口，通过 Host 明确 contribution 接入，而不是继续扩大中心化 store。

## 17. Source ownership notes

Source directories do not carry their own README policy files. Durable placement guidance is recorded here; mandatory rules continue to come from the [engineering constraint table](../software-requirements/engineering-constraints.md).

| Area                                         | Permanent ownership guidance                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/bootstrap/`                             | Owns application startup ordering and public-feature bootstrap sequencing. It is not a product service locator and must not replace feature/runtime ownership.                                         |
| `app/pages/dashboard/`                       | Application composition surface for public capabilities such as Connections, Tags, Audit, and System Overview; it does not own those domains.                                                          |
| `app/pages/settings/`                        | Application composition surface for existing Nexus settings plus registered shared/App settings contributions. It does not own Provider secrets or App runtime/domain state.                           |
| `features/agent/host/`                       | Agent Host/Launcher/Hub/App switch and Custom Surface iframe lifecycle owner. It composes presentation but does not own Plugin SDK dispatch or canonical Run/Provider/Artifact facts.                  |
| `features/agent/plugin-sdk/`                 | Plugin Frontend protocol, bounded MessagePort host bridge and App-scoped Agent SDK dispatcher. It adapts existing API/runtime owners and does not create a second Agent state machine.                 |
| `features/agent/api/`                        | Typed Agent HTTP + `/ws/agent` clients and transport parsing. It does not own user-visible runtime state or security decisions.                                                                        |
| `features/agent/{ai,files,runtime,settings}` | Shared Agent presentation/use-case boundaries for conversation, Artifact Library, Run/Environment projection and settings. They consume Backend facts and do not own Workspace live runtime resources. |
| `foundation/async/`                          | Business-neutral async coordination primitives, including latest-value persistence mechanics used by debounced UI settings.                                                                            |
| `foundation/browser/`                        | Business-neutral browser/device capability primitives; product behavior stays in features/runtimes/App packages.                                                                                       |
| `foundation/interaction/`                    | Business-neutral pointer/touch/drag/resize/wheel mechanics. Guacamole/remote-desktop input remains owned by the Remote Desktop feature.                                                                |
| `runtimes/workspace/`                        | Owns Workspace lifecycle, connection/session binding, protocol adapters, layout composition, reconnect orchestration, and suspend handoff. It is a composition owner, not a reusable capability owner. |
| `features/agent/host/AgentAppSurface.vue`    | Generic Host surface for installed AgentDefinition Apps without a frontend target; it never embeds App-specific authority or Workspace raw runtime state.                                              |
| first/third-party Plugin packages            | App-specific AgentDefinition/Skill/custom UI code lives outside the compile-time Host and enters through verified Plugin lifecycle; sibling Apps never import each other's private runtime/store.      |
| `shared/feedback/`                           | Cross-feature feedback primitives such as toast/confirm/alert with no domain policy.                                                                                                                   |
| `shared/focus/`                              | Cross-feature focus/shortcut infrastructure with no feature-owned business behavior.                                                                                                                   |

The mandatory frontend ownership and Agent boundaries are referenced by [EC-FE-001](../software-requirements/engineering-constraints.md#ec-fe-001), [EC-GEN-003](../software-requirements/engineering-constraints.md#ec-gen-003), [EC-RUNTIME-003](../software-requirements/engineering-constraints.md#ec-runtime-003), [EC-RUNTIME-004](../software-requirements/engineering-constraints.md#ec-runtime-004), and [EC-RUNTIME-005](../software-requirements/engineering-constraints.md#ec-runtime-005).

## 18. Current validation model

Architecture/static invariants are checked through the repository build and architecture guard. User-reachable behavior is validated through the real E2E system documented in [E2E](../testing/E2E.md). The mandatory verification and E2E policies are defined only by [EC-VER-001](../software-requirements/engineering-constraints.md#ec-ver-001) and the [EC-E2E-*](../software-requirements/engineering-constraints.md#ec-e2e-001) constraint rows.

Current + target dependency model:

```text
Browser UI
   ↓
AppShell / App pages
   ↓
Feature public surfaces
   ├── Workspace runtime
   └── features/agent/host
          ├── generic Host Agent surface for installed AgentDefinition Apps
          └── isolated PluginAppFrame for custom frontend targets
            ↓
Typed HTTP / SSE / WS contracts
            ↓
Backend Interfaces / App Host
            ↓
App Platform + owning App backend contribution + shared AI where applicable
            ↓
Platform capabilities
```

Frontend does not depend on Backend Infrastructure shapes and does not own historical wire compatibility.
