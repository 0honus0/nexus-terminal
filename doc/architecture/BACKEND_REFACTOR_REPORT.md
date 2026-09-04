# 后端重构报告与前端迁移参考

> 本文是本轮 Backend clean-skeleton 重构的结果报告，也是接下来 Frontend contract / state / API 重构的主要参考文档。
>
> 永久工程约束统一记录在 [Engineering Constraints](../software-requirements/engineering-constraints.md)。本文保留 Backend 重构与 Frontend contract 迁移过程中的历史证据，不替代约束登记表。
>
> **当前状态更新：** Frontend clean HTTP/WS contract 已完成对齐；`interfaces/http/legacy-api/` 与 `interfaces/websocket/legacy-api/` 已在 production import 归零后删除。本文后续标为 legacy compatibility 的章节属于迁移前/迁移中快照，用于解释删除路径与历史 contract，不代表当前 production 仍存在这些目录。

## 1. 报告范围

本轮后端重构不是简单移动目录，而是把原来混合在 controller/service/SSH/SFTP/DB/WebSocket 中的职责重新建立边界，目标是形成可长期演进的 Backend application graph。

重构完成后的核心状态：

- Backend 已从旧的“路由、业务、数据库、SSH、WebSocket 相互引用”迁移为分层结构；
- Module 使用 clean camelCase domain model，不再以数据库 snake_case 或旧前端 DTO 作为内部模型；
- SSH/SFTP/SQLite/Guacamole/SMTP/WebAuthn 等具体技术实现被隔离在 Infrastructure；
- HTTP / WebSocket 只负责外部协议和 DTO/frame 映射；
- Workspace 不再持有 WebSocket、`ssh2.Client`、SFTP wrapper、ACK map 等协议/技术对象；
- Upload / Transfer / Archive / Filesystem / Docker / System Status 等能力已经抽成可被 Workspace 和未来 Agent 复用的 Platform capability；
- Frontend clean contract 迁移完成后，两个临时 `legacy-api/` 目录已在 production import 归零后整体删除；
- Architecture Guard 已验证 layer graph、source graph、module graph 都无循环，并已移除只服务于临时 compatibility directory 的 import 例外。

本轮用户行为基线曾在 GitHub Actions 标准 E2E 环境验证。当前重构 worktree 已完成 behavior/GREQ 与 contract cleanup，仍需在最新冻结 worktree 上重新执行最终 static/build gates 与现有 E2E，不能把早期 E2E 结果当作最终证据。

## 前端开工快速索引

如果是为了马上开始 Frontend 重构，建议按下面顺序阅读：

1. [最重要的迁移事实](#2-最重要的迁移事实)：先确认 clean contract 与 legacy adapter 的关系；
2. [HTTP legacy compatibility 现状](#6-http-legacy-compatibility-现状)：处理 snake_case / camelCase；
3. [WebSocket legacy compatibility 现状](#8-websocket-legacy-compatibility-现状)：处理旧消息和 NXTM/NXUP；
4. [文件模型](#9-文件模型frontend-重构的重要目标)：FileManager clean model；
5. [Frontend 当前 legacy contract 集中位置](#11-frontend-当前-legacy-contract-集中位置)：定位需要改的前端文件；
6. [建议的 Frontend 迁移顺序](#12-建议的-frontend-迁移顺序)：按 family 推进；
7. [每个 API family 的完成判据](#13-每个-api-family-的完成判据)：判断一个 family 是否真正迁完；
8. [优先阅读的 Backend 文件](#16-前端重构建议优先阅读的-backend-文件)：需要看实现时从这里进入。

## 2. 最重要的迁移事实

> 本节记录 clean contract 对齐前的迁移起点。当前 `/api/v1` 已由 clean Frontend/Backend Interface contract 直接使用，临时 compatibility directories 已删除。

### 2.1 Backend 内部 clean contract 与 `/api/v1`

HTTP 入口保持：

```text
/api/v1/*
```

迁移过程中 `/api/v1` 曾通过 `interfaces/http/legacy-api/` 适配历史 Frontend 字段；该目录现已删除。当前一个 endpoint family 的正式结构是：

```text
Frontend clean model/client
        ↓
clean camelCase `/api/v1` DTO
        ↓
Backend HTTP Interface validation / mapping / redaction
        ↓
Backend Module clean model
```

Persistence row/column mapping 留在 Infrastructure repository/storage 边界，不回流到 HTTP DTO。

### 2.2 WebSocket clean protocol 已成为唯一 production contract

Backend 内部使用 protocol-neutral 的：

- Workspace services；
- WorkspaceEventHub；
- UploadEvent；
- TransferEvent；
- ArchiveEvent；
- RemoteFileEntry / RemoteFileMetadata；
- ServerStatus；
- Docker capability。

迁移前浏览器 wire contract 曾由 `interfaces/websocket/legacy-api/` 翻译历史消息/framing；该目录现已删除。Production WebSocket 只暴露 clean `/ws/workspace`、`/ws/uploads`、`/ws/remote-desktop` contract，Terminal/Upload 使用正式 raw-binary transport，Module class/method 名不直接暴露为 wire protocol。

### 2.3 Compatibility deletion 的完成状态

以下两个临时目录已经整体删除：

```text
packages/backend/src/interfaces/http/legacy-api/
packages/backend/src/interfaces/websocket/legacy-api/
```

删除前 production import 已归零；删除后 compatibility-only architecture-guard exception 也已移除。Business ownership 仍在原有 Modules/Platform/Infrastructure，当前最新 worktree 还需通过最终 static/build gates 与现有 E2E，才构成本轮最终验证证据。

## 3. 重构后的 Backend 文件夹设计

当前 Backend 主结构：

```text
packages/backend/src/
├── bootstrap/       组合根、应用生命周期、启动/关闭
├── config/          已验证运行时配置
├── infrastructure/ SQLite / ssh2 / 网络 / crypto / Guacamole 等具体实现
├── interfaces/
│   ├── http/        REST/HTTP/session/download 协议边界
│   └── websocket/   WS upgrade/heartbeat/frame/protocol 边界
├── modules/         Nexus 产品领域与 application services
├── platform/        与 Nexus UI 无关的机器能力
├── shared/          真正跨层的基础错误、event、security contract
├── locales/
└── index.ts         最小进程入口
```

依赖设计可以理解为：

```text
interfaces  ─────→ modules ─────→ platform
                         ↘          ↑
                          └──────────┘

infrastructure ─────────────────→ platform ports
       │
       └─ type-only → Module-owned ports/types（需要实现领域 port 时）

bootstrap → 构造完整 concrete graph
```

`bootstrap/composition-root.ts` 是唯一完整知道“哪个 concrete adapter 实现哪个 port、哪个 service 注入哪个 dependency”的位置。

### 3.1 `platform/`

Platform 表示“即使 Nexus UI、用户数据库、Workspace 都不存在，仍然有意义”的机器能力。

当前主要能力：

| Platform area          | 责任                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `execution/`           | ExecutionSession、remote execute、shell、command session           |
| `filesystem/`          | technology-neutral remote filesystem、metadata、text/search/remove |
| `operations/upload/`   | streaming/chunk upload 生命周期                                    |
| `operations/transfer/` | copy/move、跨 session transfer、progress/cancel                    |
| `operations/archive/`  | compress/decompress/progress/password/cancel                       |
| `docker/`              | remote Docker status/command/stats                                 |
| `system/`              | POSIX server status collector                                      |
| `remote-desktop/`      | Remote Desktop Gateway port                                        |
| `storage/`             | relational database port                                           |
| `diagnostics/`         | generic read-only diagnostic probes                                |

这层是未来 Agent 复用 SSH/filesystem/transfer/archive/Docker/system 能力的基础。

### 3.2 `infrastructure/`

Infrastructure 只负责具体技术：

- SQLite schema/migrations/repositories；
- `ssh2` connect/jump/proxy/exec/shell/SFTP；
- SFTP channel pool；
- local file-backed session；
- AES-GCM / bcrypt / secure token；
- SMTP/Webhook/Telegram；
- WebAuthn / Speakeasy / CAPTCHA network verifier；
- backup codec / ZIP export；
- Guacamole Remote Gateway client；
- process/database diagnostics；
- local suspended log storage。

Frontend 不应该根据 Infrastructure shape 设计 API。比如 SQLite row、SFTP handle、`ssh2.Client`、Axios response 都不属于前端 contract。

### 3.3 `modules/`

Modules 是 Nexus 产品/application 层。它决定：

- 用户是谁；
- 哪个资源属于谁；
- 连接配置是什么；
- 凭证如何组合；
- Workspace 生命周期是什么；
- 哪个操作允许开始/取消；
- Settings/Appearance/Notification/Backup 的产品语义；
- Suspend/resume 的资源所有权事务；
- Diagnostics 谁可以看到哪些内容。

Frontend 重构时，Module types 是理解“干净产品模型”的第一参考，但 Module method 本身不是 HTTP/WS wire API。

### 3.4 `interfaces/`

Interfaces 是 Frontend contract 真正应该对齐的 Backend 层。

HTTP 负责：

- Express/session；
- request/response DTO；
- status code；
- multipart；
- stream / Range / download ticket；
- legacy HTTP field mapping。

WebSocket 负责：

- upgrade/auth/origin/IP；
- heartbeat；
- JSON message contract；
- binary frame；
- browser ACK / `bufferedAmount` backpressure；
- Remote Desktop transparent proxy；
- legacy WS message mapping。

## 4. 本轮 Module 重写总览

### 4.1 Connection / Proxy / SSH Key

旧实现的问题是 connection、credential、proxy、saved key、DB encrypted fields、SSH connect 逻辑彼此交织。

现在拆成：

```text
ConnectionService
  连接配置 CRUD、clone、tags、lastConnected、audit

ConnectionCredentialService
  password/privateKey/passphrase/saved SSH key credential state

SshConnectionResolver
  产品 Connection → Platform ResolvedSshConnection
  proxy/jump chain/cycle validation

SshConnectionTestService
  resolve → connect → latency → close

ProxyService
  Proxy CRUD + credential protection/decryption

SshKeyService
  saved SSH key CRUD + decrypt
```

Frontend 最重要的变化是：Backend clean `Connection` 已经不使用旧 snake_case。

```ts
interface Connection {
  id: number;
  name: string | null;
  type: 'SSH' | 'RDP' | 'VNC';
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key';
  sshKeyId: number | null;
  proxyId: number | null;
  route: 'proxy' | 'jump' | null;
  tagIds: number[];
  notes: string | null;
  jumpChain: number[] | null;
  rdpOptions: {
    remoteApp?: string | null;
    remoteAppDirectory?: string | null;
    remoteAppArguments?: string | null;
  } | null;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
}
```

### 4.2 Auth / User / 2FA / CAPTCHA / IP policy

旧 Auth service 曾混合 session、password、2FA、captcha、IP blacklist、Express request。

现在：

```text
AuthService             用户初始化、密码认证、密码修改
TwoFactorService        TOTP setup/activate/login verify/disable
CaptchaService          CAPTCHA 产品策略 + verifier port
IpBlacklistService      登录失败/封禁状态
IpWhitelistService      HTTP/WS 共用 IP policy
UserService             用户 persistence/domain
```

Express session regenerate/cookie 等只存在 HTTP Interface。

### 4.3 Passkey / WebAuthn

Passkey ownership 与 SimpleWebAuthn concrete 类型已经分开：

```text
PasskeyService
    ↓
WebAuthnProvider port
    ↑
SimpleWebAuthnAdapter
```

注册完成时 owner 使用 server/session user identity，不再从 client-supplied `userHandle` 决定。

Frontend 重构可以围绕：

```ts
interface PasskeySummary {
  credentialId: string;
  name: string | null;
  transports: PasskeyTransport[];
  createdAt: number;
  lastUsedAt: number | null;
}
```

清理旧前端的 snake_case summary。

### 4.4 Settings / Appearance / Terminal Theme

旧 Appearance 大 service 已拆成：

```text
AppearanceSettingsService
  UI/terminal appearance setting + reference integrity

BackgroundAssetService
  背景文件 save/read/delete

HtmlThemeService
  preset/custom/remote HTML theme catalog

TerminalThemeService
  terminal themes + presets + import/export

SettingsService
  generic application settings
```

文件系统和 GitHub catalog concrete 实现都在 Infrastructure。

### 4.5 Notifications

旧 notification CRUD、模板、i18n、channel network delivery 已拆开：

```text
NotificationSettingsService
  notification setting CRUD/test/audit

NotificationService
  product event → enabled setting → format → dispatch

NotificationFormatter
  template interpolation / time formatting

NotificationChannel port
  network delivery abstraction
```

clean setting model：

```ts
interface NotificationSetting {
  id: number;
  channelType: 'webhook' | 'email' | 'telegram';
  name: string;
  enabled: boolean;
  config: NotificationChannelConfig;
  enabledEvents: NotificationEvent[];
  createdAt: number;
  updatedAt: number;
}
```

### 4.6 Backup / Remote Desktop

Backup 拆成：

```text
BackupService           产品用例、当前密码验证
BackupSnapshotPort      应用数据 snapshot/restore
BackupCodecPort         .nexus-backup V1 codec
```

Remote Desktop 拆成：

```text
RemoteDesktopSessionService
  Connection credential/options → remote desktop request

RemoteDesktopGateway port
  gateway abstraction

GuacamoleAdapter
  concrete HTTP gateway call
```

Frontend 不再需要知道 remote-gateway internal API/shared secret。

### 4.7 Transfer task

跨服务器 transfer 的用户任务状态与机器传输能力分开：

```text
TransferTaskRegistry
  in-process task state + AbortController

TransferOrchestratorService
  source execution session + target resolution + concurrency

TransfersService
  user-facing lifecycle

Platform ServerTransferExecutor
  rsync/scp strategy
```

### 4.8 System / Docker / Diagnostics

```text
SystemStatusService
  local backend host status

SshResourceStatusService
  dashboard remote SSH resource grouping/cache/polling

RemoteDockerService
  Docker CLI capability over ExecutionSession

SystemDiagnosticsService
  diagnostic aggregation + access policy + redaction
```

Diagnostics 已经为未来 Agent 保留稳定入口：

```ts
compositionRoot.modules.diagnostics;
```

## 5. Workspace 是本轮最重要的拆分

旧 Workspace/WebSocket handler 同时承担：

- SSH connection；
- terminal stream；
- WebSocket frames；
- SFTP；
- status timer；
- Docker；
- upload/copy/archive；
- suspend/resume；
- ACK/backpressure；
- shell prompt/cwd integration。

现在拆为：

```text
WorkspaceService
  Workspace ↔ ExecutionSession 生命周期

WorkspaceTerminalService
  shell output/input/resize/consumer backpressure

WorkspaceShellIntegrationService
  shell PID/prompt marker/cwd/safe cd

WorkspaceCommandService
  明确允许的 Workspace command use case

WorkspaceFilesystemService
  Workspace ownership → filesystem capability

WorkspaceOperationsService
  upload/copy/move/archive

WorkspaceStatusMonitorService
  status subscription timers

WorkspaceDockerService
  Workspace → Docker capability

WorkspaceSuspendCoordinatorService
  suspend disconnect takeover + transactional resume

WorkspaceEventHub
  typed protocol-neutral events
```

`WorkspaceSession` 现在只持有产品/platform runtime state，不持有浏览器协议对象。

这意味着 Frontend 新 WS 协议只是在调用这些 use case 和消费 event，不需要参与 SSH/SFTP 资源所有权设计。

## 6. HTTP legacy compatibility 现状

目录：

```text
packages/backend/src/interfaces/http/legacy-api/
├── connection-http.mapper.ts
├── connection-import.compat.ts
├── notification-http.mapper.ts
├── passkey-http.mapper.ts
├── proxy-http.mapper.ts
├── settings-http.mapper.ts
└── ssh-key-http.mapper.ts
```

### 6.1 Connection 字段迁移

| 当前旧 Frontend / HTTP | Backend clean model  |
| ---------------------- | -------------------- |
| `auth_method`          | `authMethod`         |
| `ssh_key_id`           | `sshKeyId`           |
| `proxy_id`             | `proxyId`            |
| `proxy_type`           | `route`              |
| `tag_ids`              | `tagIds`             |
| `jump_chain`           | `jumpChain`          |
| `rdp_options`          | `rdpOptions`         |
| `remote_app`           | `remoteApp`          |
| `remote_app_dir`       | `remoteAppDirectory` |
| `remote_app_args`      | `remoteAppArguments` |
| `created_at`           | `createdAt`          |
| `updated_at`           | `updatedAt`          |
| `last_connected_at`    | `lastConnectedAt`    |

Legacy mapper 还包含两个历史容错：

- `proxy_type = "proxy"` 但没有 `proxy_id` 时，旧前端语义被归一成 direct route；
- `proxy_type = "jump"` 但 jump chain 为空时，同样归一成 direct route。

新 Frontend contract 不应该继续依赖这两个隐式容错，而应该直接表达真实 `route`。

### 6.2 Proxy

| 当前旧 Frontend / HTTP | Backend clean model |
| ---------------------- | ------------------- |
| `auth_method`          | `authMethod`        |
| `private_key`          | `privateKey`        |
| `created_at`           | `createdAt`         |
| `updated_at`           | `updatedAt`         |

Legacy mapper 还会从 `password/private_key` 推断 `authMethod`。新 Frontend 应显式发送认证方式。

### 6.3 SSH Key

```text
private_key  → privateKey
```

当前 mapper 同时接受 `private_key` 和 `privateKey`，说明这一族可以较早完成迁移。

### 6.4 Notification

```text
channel_type    → channelType
enabled_events  → enabledEvents
created_at      → createdAt
updated_at      → updatedAt
```

当前 mapper 已经在 input 同时接受 camelCase 与 snake_case，但 response 仍输出旧 shape。

### 6.5 Passkey

```text
credential_id → credentialId
created_at    → createdAt
last_used_at  → lastUsedAt
```

### 6.6 Settings

当前旧 Vue number input 会直接产生 number/bool，而新的 generic Settings domain 保存 canonical string value。

Legacy mapper 当前会做：

```text
number / boolean → String(value)
```

Frontend clean settings client 应明确负责 generic setting value 的 canonical serialization，不再依赖 Backend 猜测 Vue input 类型。

### 6.7 Obsolete connection JSON import

`connection-import.compat.ts` 是纯历史 JSON import workflow。

Frontend 重构时如果该 UI/功能不再需要这个历史 JSON 格式，可以直接删除对应旧 endpoint/compat workflow；如果仍需要“连接导入”，应围绕正式 `ConnectionExportService` 的产品模型重新定义格式，而不是继续把旧 JSON schema 当永久 contract。

## 7. 当前 HTTP endpoint family

当前 HTTP app 仍使用 `/api/v1`，主要 family：

```text
/api/v1/auth
/api/v1/settings
/api/v1/connections
/api/v1/proxies
/api/v1/ssh-keys
/api/v1/tags
/api/v1/quick-command-tags
/api/v1/quick-commands
/api/v1/command-history
/api/v1/path-history
/api/v1/favorite-paths
/api/v1/notifications
/api/v1/audit-logs
/api/v1/terminal-themes
/api/v1/appearance
/api/v1/sftp
/api/v1/ssh-suspend
/api/v1/transfers
/api/v1/system
/api/v1/status
/.well-known/webauthn
```

Frontend contract 重构不需要为了“clean”强行更换 URL version。可以保持 endpoint path，先把 DTO/schema/typed client 清理完成；是否升级 URL version 是独立产品/API versioning 决策。

## 8. WebSocket legacy compatibility 现状

目录：

```text
packages/backend/src/interfaces/websocket/legacy-api/
├── file-dto.mapper.ts
├── remote-desktop-request.mapper.ts
├── terminal-binary.transport.ts
├── upload-binary.transport.ts
├── upload-socket.adapter.ts
├── workspace-event.mapper.ts
└── workspace-protocol.session.ts
```

这里包含当前 Frontend 的所有历史 WS contract 成本。

### 8.1 旧消息 → clean use case

| 当前旧消息                             | Backend clean semantic                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| `ssh:connect`                          | `WorkspaceService.connect()`                                        |
| `ssh:input`                            | `WorkspaceTerminalService.writeInput()`                             |
| `ssh:resize`                           | `WorkspaceTerminalService.resize()`                                 |
| `ssh:exec_silent`                      | `WorkspaceCommandService.readCurrentDirectory()`（当前仅 pwd 用例） |
| `ssh:change_directory`                 | `WorkspaceShellIntegrationService.requestDirectoryChange()`         |
| `status:subscribe`                     | `WorkspaceStatusMonitorService.start()`                             |
| `status:unsubscribe`                   | `WorkspaceStatusMonitorService.stop()`                              |
| `docker:get_status`                    | `WorkspaceDockerService.getStatus()`                                |
| `docker:command`                       | `WorkspaceDockerService.command()`                                  |
| `docker:get_stats`                     | `WorkspaceDockerService.getStats()`                                 |
| `sftp:readdir`                         | `WorkspaceFilesystemService.readDirectory()`                        |
| `sftp:search`                          | `WorkspaceFilesystemService.search()`                               |
| `sftp:stat`                            | `WorkspaceFilesystemService.stat()`                                 |
| `sftp:readfile`                        | `WorkspaceFilesystemService.readFile()`                             |
| `sftp:writefile`                       | `WorkspaceFilesystemService.writeFile()`                            |
| `sftp:mkdir/rmdir/unlink/delete_paths` | filesystem mutation services                                        |
| `sftp:rename/chmod/realpath`           | filesystem services                                                 |
| `sftp:copy/move/cross_copy`            | `WorkspaceOperationsService` transfer                               |
| `sftp:transfer:cancel`                 | transfer cancellation                                               |
| `sftp:compress/decompress`             | archive operation                                                   |
| `sftp:archive:cancel`                  | archive cancellation                                                |
| `sftp:upload:prepare/start/cancel`     | upload operation                                                    |
| `SSH_MARK_FOR_SUSPEND`                 | `WorkspaceSuspendCoordinatorService.markForSuspend()`               |
| `SSH_UNMARK_FOR_SUSPEND`               | `unmarkForSuspend()`                                                |
| `SSH_SUSPEND_*`                        | `SshSuspendService` + Workspace suspend coordinator                 |

### 8.2 `ssh:output:ack` 不是 Domain 事件

`ssh:output:ack` 对应的是浏览器对二进制终端 frame 的 ACK。

它存在的目的：

```text
browser ACK / WS bufferedAmount
        ↓
Interface backpressure state
        ↓
WorkspaceTerminalService.setConsumerBackpressure()
        ↓
RemoteShellSession pause/resume
```

Frontend 重构时，如果更换 terminal wire protocol，这部分应仍然是 WebSocket transport responsibility，不要设计成 Workspace business message。

### 8.3 NXTM terminal binary protocol

当前 `NXTM v1`：

- magic: `NXTM`；
- header: 16 bytes；
- frame types: `Output`, `CachedOutput`；
- sequence ACK；
- max payload: 256 KiB；
- high/low water: 1 MiB / 256 KiB；
- ACK timeout: 120s；
- suspend resume cached output 也走该 frame，并用 `Final` flag 标记结束。

Frontend 当前实现：

```text
packages/frontend/src/utils/terminalBinaryProtocol.ts
```

按照当前工程约束，NXTM 被视为 legacy compatibility 的一部分。如果 Frontend 重构计划决定“NXTM 本身设计合理，希望变成永久协议”，这属于约束变更点：需要先确认，再把 framing 从 legacy adapter 提升为正式 WebSocket protocol，而不是直接复制一份继续用。

### 8.4 NXUP upload binary protocol

当前 `NXUP v1`：

- dedicated `/ws/upload` data channel；
- magic `NXUP`；
- upload ID；
- chunkIndex；
- final flag；
- payload ≤ 1 MiB；
- progress/flow control 通过 application upload events/ACK。

Frontend 当前 framing 直接存在：

```text
packages/frontend/src/composables/useFileUploader.ts
```

它和 NXTM 一样，目前属于 legacy protocol 决策范围。

### 8.5 Remote Desktop legacy DPI

旧 Remote Desktop WS query 中虽然有 `dpi`，历史 Backend 实际根据 width 计算：

```text
width > 1920 → 120
otherwise    → 96
```

该规则现在只保留在：

```text
legacy-api/remote-desktop-request.mapper.ts
```

Frontend clean contract 应显式决定 DPI，不继续依赖这个历史推断。

## 9. 文件模型：Frontend 重构的重要目标

当前旧 SFTP frontend shape：

```ts
interface LegacyFileListItem {
  filename: string;
  longname: string;
  attrs: {
    size: number;
    uid: number;
    gid: number;
    mode: number;
    atime: number;
    mtime: number;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
  };
  path?: string;
}
```

Backend clean model：

```ts
interface RemoteFileEntry {
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

建议 Frontend 文件管理重构优先建立一个 clean `FileEntry` model，组件只依赖 clean model。这样可以一次消除大量：

```text
filename / longname / attrs / atime / mtime
```

历史命名。

搜索结果额外包含：

```text
relativePath
```

可以自然成为 `RemoteFileSearchEntry` 的扩展字段。

## 10. Upload / Transfer / Archive 已有 clean event semantics

Frontend 新 progress center / file operation state 可以直接以这些语义建模。

### 10.1 UploadEvent

```text
ready
conflict
skipped
chunk-ack
completed
cancelled
failed
```

关键 clean fields：

```text
uploadId
chunkIndex
bytesWritten
totalSize
progress
destinationPath
item
```

### 10.2 TransferEvent

```text
progress
completed
failed
cancelling
cancelled
```

clean progress：

```text
requestId
transferredBytes
totalBytes
completedFiles
totalFiles
totalKnown
currentFile
```

completed：

```text
mode: copy | move
sourcePaths
destinationPath
items
crossSession
sourceOwnerId?
```

### 10.3 ArchiveEvent

```text
progress
completed
failed
cancelled
```

clean operation：

```text
compress | decompress
```

error codes：

```text
PASSWORD_REQUIRED
INVALID_PASSWORD
PASSWORD_TOO_LONG
INVALID_PASSWORD_FORMAT
COMMAND_NOT_FOUND
UNSUPPORTED_FORMAT
```

这比旧前端分散监听 `sftp:compress:* / sftp:decompress:* / sftp:archive:*` 更适合统一 typed operation state。

## 11. Frontend 当前 legacy contract 集中位置

### 11.1 HTTP 历史字段主要消费者

当前扫描到的主要文件：

```text
components/AddConnectionFormAdvanced.vue
components/AddConnectionFormAuth.vue
components/AddProxyForm.vue
components/BatchEditConnectionForm.vue
components/ConnectionList.vue
components/ManageTagConnectionsModal.vue
components/NotificationSettingForm.vue
components/NotificationSettings.vue
components/SshKeyManagementModal.vue
components/WorkspaceConnectionList.vue
composables/useAddConnectionForm.ts
stores/auth.store.ts
stores/connections.store.ts
stores/notifications.store.ts
stores/proxies.store.ts
stores/settings.store.ts
stores/sshKeys.store.ts
stores/tags.store.ts
types/server.types.ts
views/ConnectionsView.vue
views/DashboardView.vue
```

这说明 Frontend contract 当前仍泄漏到 component/store/type 多层。重构时最好先建立 typed client/domain boundary，再让 Vue component 消费 frontend clean model，而不是逐组件替换字段名。

### 11.2 WebSocket 历史协议主要消费者

```text
components/FileManager.vue
composables/useDockerManager.ts
composables/useFileUploader.ts
composables/useSftpActions.ts
composables/useSshTerminal.ts
composables/useStatusMonitor.ts
composables/useWebSocketConnection.ts
stores/session/actions/sshSuspendActions.ts
types/ssh-suspend.types.ts
types/websocket.types.ts
utils/terminalBinaryProtocol.ts
```

尤其当前：

```ts
interface WebSocketMessage {
  type: string;
  payload?: any;
  [key: string]: any;
}
```

是下一轮 Frontend 重构非常值得优先消除的边界。新协议层应该形成 discriminated unions / typed request-response-event，而不是继续由 component 自己判断任意 string payload。

## 12. 建议的 Frontend 迁移顺序

这部分是当前迁移建议，不是新的永久工程约束。

### Phase A：先建立 Frontend contract boundary

目标：Vue component/store 不再直接拼 HTTP/WS historical DTO。

可以先形成类似：

```text
frontend contract/client layer
├── http
│   ├── connections
│   ├── proxies
│   ├── sshKeys
│   ├── notifications
│   └── ...
└── websocket
    ├── workspace messages
    ├── terminal transport
    ├── file operations
    └── suspend
```

具体目录名可以在 Frontend 架构重构时决定；重点是先有唯一 contract owner。

### Phase B：优先迁 HTTP 简单 family

推荐顺序：

```text
SSH Keys
→ Proxies
→ Notifications
→ Passkeys
→ Connections
→ Settings
```

理由：这些 family 的 legacy mapper 边界明确，迁移完成后可以逐文件删除 HTTP `legacy-api` mapper。

Connections 放在后面，因为它关联：

- auth method；
- saved SSH key；
- proxy/jump route；
- tags；
- RDP options；
- clone/test/export/import。

### Phase C：统一 Frontend FileEntry / operation model

先把 FileManager 内部从：

```text
filename / longname / attrs
```

迁到 frontend clean file model。

再统一：

- upload state；
- transfer state；
- archive state；
- progress center。

完成这一阶段后，WS `file-dto.mapper.ts` 和大量 `sftp:*` response mapping 就更容易删除。

### Phase D：重构 Workspace JSON protocol

把当前任意 string message registry：

```text
sftp:*
ssh:*
docker:*
status:*
SSH_SUSPEND_*
```

转换为一个 typed protocol boundary。

新 wire contract 可以参考 Backend clean semantics，但不要把 Module service 名直接当协议名。

建议至少形成：

```text
Workspace command/request union
Workspace response/event union
requestId correlation
operation-specific typed payload
explicit error shape
```

### Phase E：最后决定 Binary protocol

最后单独处理：

- NXTM；
- NXUP；
- output ACK；
- cached resume frames；
- upload dedicated socket。

原因是 binary/backpressure 与 UI/domain field rename 没有必要绑在同一个大改动里。

如果决定保留现有 framing，则先进行工程约束决策，再把它从 legacy adapter 正式化；如果决定更换，则新老 binary transport 可以短期并存于 WebSocket Interface，直到 Frontend 完成切换。

### Phase F：删除 compatibility directories

HTTP 完成条件：

```text
packages/backend/src/interfaces/http/legacy-api/
```

可以整体删除。

WebSocket 完成条件：

```text
packages/backend/src/interfaces/websocket/legacy-api/
```

可以整体删除。

最终 Architecture Guard 应继续保持：

```text
0 forbidden edges
0 source cycles
0 module cycles
```

用户 E2E 在 GitHub Actions 保持通过。

## 13. 每个 API family 的完成判据

迁移一个 family 时，可以用下面的完成定义判断是否真的结束：

1. Frontend component 不直接出现该 family 的 legacy wire field/message；
2. Frontend store/composable 使用 clean frontend model；
3. 只有 Frontend contract/client owner 知道 wire DTO；
4. Backend HTTP/WS Interface 接收 clean DTO；
5. 该 family 对应 legacy mapper/case 可以删除；
6. Module/Platform 没有为了 Frontend 重构而改成 UI-specific shape；
7. 原有用户 E2E 通过；
8. 新增 E2E 只覆盖真实用户可达行为。

## 14. Frontend 重构过程中不要误删的 Backend 边界

### 14.1 HTTP session/auth 是 Interface concern

Frontend 可以重构 auth store/client，但 Backend 的 session regenerate、cookie lifetime、Passkey challenge session context 仍应留在 HTTP Interface。

### 14.2 HTTP download ticket 是下载协议状态

SFTP HTTP download 的：

- ticket；
- TTL；
- source IP binding；
- Range；
- per-user/global limits；

属于 HTTP download protocol，不应迁进 Workspace domain，也不需要 Frontend 把它变成文件业务模型。

### 14.3 Workspace resource ownership 不应由 Frontend 管理

Frontend 只表达 connect/disconnect/suspend/resume intent。

真正的：

- ExecutionSession ownership；
- shell detach/attach；
- SFTP capability；
- suspend takeover；
- rollback；
- operation cleanup；

都在 Backend Modules/Platform。

### 14.4 Backpressure 是 transport concern

Frontend 可以改变 terminal renderer 或 WS client，但 Browser ACK / binary flow control 不应该渗透到 Connection/Workspace product model。

## 15. Backend clean model 与 Frontend model 的关系

Frontend 不需要 1:1 import/copy Backend TypeScript interfaces，但建议语义对齐：

```text
Backend Domain/Platform semantic
          ↓
Backend Interface DTO
          ↕
Frontend contract DTO
          ↓
Frontend feature model/store
          ↓
Vue UI
```

可以存在 Frontend-specific fields，例如：

- UI selection；
- loading；
- modal state；
- temporary form validation；
- optimistic state；
- display-only labels。

但不要再把 HTTP snake_case、WS historical type string 当作组件业务模型。

## 16. 前端重构建议优先阅读的 Backend 文件

### Architecture / Composition

```text
doc/architecture/BACKEND.md
packages/backend/src/bootstrap/composition-root.ts
packages/backend/scripts/check-architecture.mjs
```

### Clean connection model

```text
packages/backend/src/modules/connections/connection.types.ts
packages/backend/src/modules/connections/connection.service.ts
packages/backend/src/modules/connections/connection-credential.service.ts
packages/backend/src/modules/connections/services/ssh-connection-resolver.service.ts
```

### Clean filesystem / operations

```text
packages/backend/src/platform/filesystem/file-entry.ts
packages/backend/src/platform/filesystem/remote-filesystem.ts
packages/backend/src/platform/operations/upload/upload-operation.port.ts
packages/backend/src/platform/operations/transfer/transfer-operation.port.ts
packages/backend/src/platform/operations/archive/archive-operation.port.ts
```

### Workspace semantics

```text
packages/backend/src/modules/workspace/workspace-event-hub.ts
packages/backend/src/modules/workspace/workspace.service.ts
packages/backend/src/modules/workspace/services/
```

### Current legacy contract — migration deletion list

```text
packages/backend/src/interfaces/http/legacy-api/
packages/backend/src/interfaces/websocket/legacy-api/
```

Frontend 重构每完成一个 family，都应回到这两个目录检查是否可以删除对应 adapter/case。

## 17. 验证基线

后端 clean-skeleton 重构完成后，验证基线包括：

```text
Backend build             PASS
Frontend build            PASS
Remote Gateway build      PASS
Architecture Guard        PASS
  forbidden layer edge    0
  source cycle            0
  module cycle            0

GitHub Actions user E2E   PASS
```

本轮重构曾通过完整 GitHub Actions E2E run `33741993076` 验证旧用户行为。后续 Frontend 重构每个阶段都应以相同“真实用户路径”思路验证，而不是用 E2E 去锁定内部 adapter/class 实现。

## 18. Frontend 重构的最终目标图

```text
Vue component / view
        ↓
feature composable / store
        ↓
typed frontend contract client
        ↓
HTTP / WebSocket clean Interface DTO
        ↓
Backend Modules
        ↓
Platform capabilities
        ↑
Infrastructure adapters
```

同时 Backend 中：

```text
interfaces/http/legacy-api/       deleted
interfaces/websocket/legacy-api/  deleted
```

这时 Frontend 和 Backend 的边界会真正完成从“历史实现兼容”到“显式 typed product contract”的切换，而本轮后端重写建立的 Module / Platform / Infrastructure 分层不需要再做第二次架构拆分。
