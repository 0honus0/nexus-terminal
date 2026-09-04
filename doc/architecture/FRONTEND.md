# Nexus Terminal Frontend Architecture

> 本文定义 Nexus Terminal Frontend 重构后的长期架构，是前端目录、依赖方向、组件归属、状态归属、Workspace / Agent 运行时边界以及 HTTP / WebSocket contract 边界的权威说明。
>
> 详细的旧前端依赖扫描、循环依赖证据和业务清单见 [`FRONTEND_DEPENDENCY_ANALYSIS.md`](./FRONTEND_DEPENDENCY_ANALYSIS.md)。旧文件到新 owner 的执行清单见 [`FRONTEND_MIGRATION_MANIFEST.md`](./FRONTEND_MIGRATION_MANIFEST.md)。Backend clean architecture 与 legacy compatibility 现状见 [`BACKEND_REFACTOR_REPORT.md`](./BACKEND_REFACTOR_REPORT.md)。

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

Target structure:

```text
packages/frontend/src/
├── app/
│   ├── main.ts
│   ├── App.vue
│   ├── bootstrap/
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
│   ├── focus/
│   └── components/
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
│   └── agent/
│       ├── model/
│       ├── session/
│       ├── protocol/
│       ├── adapters/
│       ├── components/
│       └── views/
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
BasePanel
BaseModal
OverlayPanel
BaseSpinner
TokenInput
ContextMenu
Tabs
Toolbar
ProgressBar
ResizableWindow
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

## 10. Workspace and Agent runtime separation

这是长期架构中的核心边界。

### 10.1 Workspace owns

Workspace runtime 只拥有 Workspace-specific live composition，例如：

- workspace lifecycle；
- connection-to-session binding；
- workspace WS protocol adapter；
- pane/layout composition；
- reconnect and suspend handoff orchestration；
- 将 terminal/filesystem/status/docker/etc capability 绑定到该 runtime。

### 10.2 Agent owns

Agent 独立拥有：

- agent conversation/execution runtime；
- agent protocol；
- agent session lifecycle；
- agent-specific UI/state。

### 10.3 Agent must not reuse Workspace internals

禁止：

```text
Agent -> Workspace raw WebSocket
Agent -> Workspace SessionStore
Agent -> Workspace SFTP manager
Agent -> Workspace Terminal manager
Agent -> Workspace current cwd
Agent -> Workspace upload socket
```

如果两者都需要 terminal/filesystem/transfer 能力，应复用 capability interface，而不是 runtime object。

例如：

```text
Terminal Feature
  └─ TerminalChannel port
        ↑
        ├─ WorkspaceTerminalAdapter -> Workspace protocol
        └─ AgentTerminalAdapter     -> Agent protocol
```

类似模式应用于：

```text
FilesystemPort
TransferPort
StatusPort
DockerPort
RemoteDesktopPort   # if Agent later requires it
```

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

Workspace/Agent protocol ownership属于对应 runtime：

```text
runtimes/workspace/protocol/
runtimes/agent/protocol/
```

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

当前正式 Workspace terminal transport 不使用历史 envelope/framing：server-to-browser terminal output 是 raw binary bytes，浏览器通过 clean Workspace control messages 处理 shell lifecycle；Backpressure/queueing 由 WebSocket transport owner 负责，不进入 terminal domain model。

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

Settings page 组合：

- Preferences；
- Security；
- Appearance；
- Backup；
- Workspace settings。

Settings screen 不再拥有一个万能 `settings.store.ts`。

## 17. Rewrite rules

Feature restoration 必须遵守：

- 旧源码仅作为 user-visible behavior / E2E / visual baseline reference；
- 不 wholesale copy old store/composable/component；
- 不保留 old file boundary 作为兼容层；
- 不建立旧 path re-export；
- duplicated state/fetch/mutation logic 要合并；
- circular dependency 必须通过 ownership/ports 拆掉；
- user-visible selector 与行为应保留，除非明确批准 UI change；
- 功能组件使用 foundation/shared primitives，但不把业务逻辑下沉到基础组件。

## 18. Refactor sequence

固定顺序：

1. 冻结业务 inventory、component ownership、dependency graph；
2. 保留完整旧 frontend backup；
3. 维持独立可编译 clean skeleton；
4. 完成 foundation/shared UI infrastructure；
5. 还原 App shell 与 visual baseline；
6. 重写 Auth/Security/Preferences/Appearance；
7. 重写 Tags/SSH Keys/Proxies/Connections；
8. 重写 Notifications/Audit/System Overview/Backup；
9. 重写 Quick Commands/Command History；
10. 重写 Terminal/Filesystem/File Editor/File Preview/Transfers/Status/Docker/Remote Desktop/Suspend capability；
11. 使用这些 capability 组合 Workspace runtime；
12. 独立实现 Agent runtime，不依赖 Workspace internals；
13. Frontend 功能行为完成后统一对齐 Backend clean HTTP contract；
14. 再统一对齐 clean WebSocket protocol；
15. 删除 Backend legacy HTTP/WS compatibility layer；
16. 完成 architecture/test-policy/build/E2E gates。

HTTP/WS contract migration 被明确放在 frontend UI/functionality rewrite 之后，以避免 UI 重构和 external protocol migration 同时改变。

## 19. Testing and validation

自动化 product behavior test 仅允许真实 E2E，遵守 [工程约束表](../software-requirements/engineering-constraints.md)。

Frontend architecture invariant 使用 build/static architecture check，而不是新增 unit/component/internal implementation test。

正常架构改动至少验证：

```bash
npm run check:test-policy
npm run build:frontend
npm --prefix packages/backend run check:architecture
```

User-facing behavior 改动运行对应真实 E2E；完整 browser evidence 以 GitHub Actions 的 pinned environment 为准。

E2E 不得：

- import frontend/backend internal source；
- 直接断言 Pinia/localStorage/internal fixture；
- 依赖其他 test case 先运行；
- 用 mock successful business response 替代真实 product surface。

## 20. Completion criteria

Frontend clean rewrite 完成必须同时满足：

1. 旧 root `components/stores/composables/views/utils/types` 组织方式不再作为 compatibility structure 存在；
2. dependency graph 无循环；
3. feature cross-import 仅经过 public surface；
4. feature model 无 HTTP snake_case DTO；
5. components/store 无 legacy WS type string；
6. Terminal/Filesystem/Transfer 等 capability 不依赖 Workspace internal runtime；
7. Agent 不依赖 Workspace internal runtime；
8. App 是唯一完整 composition root；
9. Backend Module / Platform 不因 frontend migration 承担 UI-specific responsibility；
10. `interfaces/http/legacy-api/` 已删除且 production 不依赖历史 HTTP compatibility；
11. `interfaces/websocket/legacy-api/` 已删除且 production 只使用 clean Workspace/upload/remote-desktop contract；
12. frontend build、architecture guard、test-policy 和相关 E2E 全部通过。

最终依赖图：

```text
Browser UI
   ↓
Feature components / App pages
   ↓
Feature clean models + capability ports
   ↓
Workspace runtime / Agent runtime adapters
   ↓
Typed frontend HTTP / WS contract
   ↓
Backend Interfaces
   ↓
Backend Modules
   ↓
Platform capabilities
```

Frontend 不再认识 Backend Infrastructure shape，也不再承担历史 wire compatibility。
