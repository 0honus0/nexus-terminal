# 后端架构

本文约束新后端及后续功能的放置和依赖。开发前由 [AGENTS](../AGENTS.md) 读取 [人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 与 [编码规范](../rules/CODE_STYLE.md)。按 [模块模板](MODULE_TEMPLATE.md) 维护下面八个章节，不复制人工规则和编码列表。

## 1. 职责与范围

### B4.2 Factors / Passkey 认证范围（源码阶段）

Access 在 B4.1 完整密码和摘要会话之上扩展 TOTP 与 WebAuthn。Factors 只拥有部分认证、挑战、密码因素启停与凭据操作；**完整身份权威仍为 access_sessions / AccessPublicApi**。五分钟 `nexus_partial` 是独立随机 bearer，只能用于 `POST /auth/login/2fa`，不能传给普通 SSH、Agent 或其它需完整身份的路由。Passkey 登录最终直接核实 WebAuthn signature/RP/Origin/user verification 并签完整摘要会话；已经建立的完整会话不因启用新 TOTP 被隐式撤销。真实 UI 对接在 F1，审计/通知/动态 Settings 在 B7。当前独立 HTTP 入口只接一个 publicOrigin/RP；旧正式多 Origin/RP 安装配置由 B7 统一盘点接入，当前不声称已迁移。

B4.2 本轮复审：WebAuthn 技术 Port 以具名选项表达 RP/user/credential descriptors，Adapter 先对浏览器 clientDataJSON 的 challenge/Origin/type 与 assertion RP Hash、UP/UV、counter 做确定性拒绝；第三方验证仍是最终权威，无法可靠分类的供应商异常映射为不可用而非凭据失败。注册与登录 options 明确要求 User Verification（required），与最终 requireUserVerification 一致。Model 在写 challenge 之前投影技术选项，HTTP 对 options 仅维护一套可选字段白名单；HTTP 签发后的挑战 Cookie 必须交付成功，若在完成之前断开连接则撤销已提交的 challenge/TOTP setup，回收失败保留因果。源码/静态已收口，B10 行为尚未验收。

### B4.1 Access 核心认证与入场策略

Access 统一拥有初始管理员、密码身份认证、token 摘要会话、登录失败/封禁、来源白名单和 CAPTCHA 准入。HTTP/WS 接收由 Platform HTTP 从 TCP peer 与明确受信代理链解析的来源，不读取业务客户端自报 userId/IP；已登录身份由 Access public 的 token/digest 实时复验。安装态策略现在真实执行，但 B7 尚未提供持久 Settings 及运行时配置更新；TOTP/Passkey 已由 factors 实现完整挑战流程，完整因素不能被密码闸门绕过。

### B3.2 资源观测与 Docker

Remote 的 monitoring 子功能负责普通 Workspace 状态订阅、Docker 查询/控制和后台 SSH 资源采样；不执行任意用户命令、不复制 Workspace registry。System 负责本机状态。cwd 已归 sessions，快捷命令/命令历史仍归后续用户数据阶段。SSH/Agent 可分别消费通用 Linux/Docker 技术能力，不能复用普通用户权限和活跃会话。

### Workspace 当前边界（源码收口，行为待验）

Remote 的普通 SSH Workspace 是一条持续存在的交互式 shell，而非 Files attachment 或一次性 HTTP PTY。一个 Workspace ID 对应唯一应用会话 owner，涵盖 pending/open/离线宽限/挂起/恢复交付/closing/清理待确认；外部 WS 仅持有可撤销 attachment。已有独立 Remote HTTP/PTY 保留其实际消费者与关闭语义，不冒充可恢复 Workspace。Agent 仍仅复用 Platform SSH/字节通道，不继承普通 Workspace 的令牌、用户权限或资源额度。

正式后端仍为 `packages/backend`；新架构在 `packages/backend-next`，新包不运行时导入旧 Backend/Protocol。旧包是功能和调用链参考，正式切换需单独迁移与验收，不因新包能构建就切流量。

| 一级模块 | 业务 owner                                                    | 当前边界                                                                                                                                         |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access   | 账号、认证、会话与访问策略                                    | B4.1 增量实现管理员、密码、摘要会话、可信来源、IP 策略和 CAPTCHA；源码/架构复审已收口，B4.2 因素源码/静态已收口、行为待 B10；B7 持久配置仍未迁移 |
| Targets  | 连接配置、凭据、Proxy、SSH Key、Tag、目标解析与 Host Key 信任 | 已有 SSH/RDP/VNC 定义和基础管理；RDP/VNC 定义不等于运行能力                                                                                      |
| Remote   | 普通用户终端、文件与其他远程用例                              | PTY/Workspace/Files/传输/终端挂起恢复及 B3.3 桌面源码已接线；正式浏览器桌面操作与其他真实行为仍待 B10                                            |
| System   | 本机资源状态                                                  | 已有认证状态 HTTP、Service/Model 与 Node 技术 Adapter；无管理配置持久化。                                                                        |
| Agent    | Agent scope、Run 与后续执行/治理                              | 已有 App/Thread、pending/cancelled Root Run、幂等与事件；无执行链；Shared 与开发前端源码已接入                                                   |

本机状态已有独立 System owner；后续 preferences、notifications、audit 及其他 system 能力按各自业务所有权实施，不提前创建空模块；Agent 的 Provider/调度/Tool/授权/审批/Job/Artifact/Memory/集成归 Agent 子功能，不复制技术底座。

## 2. 子功能与目录

### B4.2 目录与唯一 owner

`access/factors/service/factor-service.ts` 管因素用例、cookie 对应的授权、失败与恢复政策；`factors/model/{factor-model,factor-types,options-projector}.ts` 管存储↔应用字段投影、SecretBox 加解密、TOTP/WebAuthn Port 调用、WebAuthn 浏览器选项白名单；`factors/storage/factor-storage.ts` 仅定义持久命令；Access 一级 `access-failure.ts` 持有跨账户/认证/因素共用的内部具名错误；`factors/adapters/sqlite/{factor-schema,factor-sql}.ts` 持 DDL、事务、challenge 与 counter 原子更新。Platform 的 `security/{totp-port,webauthn-port}` 与 `adapters/{rfc-totp,native-webauthn}` 只拥有通用算法、签名验证和提供者消息。HTTP `interfaces/http/factor-http.ts` 接真实路由，Shared `access/factors/http.ts` 负责严格未知输入解码；不向其他模块新增部分登录 public。

### B4.1 Access 目录

`access/authentication/service/access-service.ts` 编排账号初始化、改密与密码登录用例，`accounts/model/account-model.ts` 隔离 Scrypt Port 调用、账号行转换和存储能力；`accounts/adapters/sqlite` 负责唯一初始化与改密撤销事务。`sessions/model/session-model.ts` 负责会话 token/digest 应用转换，`sessions/adapters/sqlite` 负责会话查验、CAS 签发、原子失败计数、封禁解除与分页。`admission/service/source-admission.ts` 消费安装时验证的 IP 白名单和失败政策；`admission/source-ip-rules.ts` 只含白名单容量/条目和内网分类纯规则；`admission/model/source-address-model.ts` 将技术解析转为普通应用地址/网络事实；`platform/security/source-address.ts` 定义通用地址契约，`adapters/source-addresses.ts` 独占 ipaddr.js。`captcha/service` 决定配置、是否需要验证与 token 预算；`captcha/model` 持有第三方验证调用与错误转换；`platform/security/adapters/network-captcha-verifier.ts` 负责带期限和受限响应读取的供应商 HTTPS 表单协议。Access HTTP 只实现 Shared 的解码和逐字段结果投影，不接触 hash、SQL、CAPTCHA secret。

### B3.2 目录

`remote/monitoring/service` 持有准入、采样状态、按主机缓存、授权及 Docker 操作用例；`monitoring/model` 持有内部事实类型、可信目标到临时 SSH 能力的转换、技术失败及输出转换。`platform/system/adapters` 解析 Linux/Node 状态，`platform/docker/adapters` 构造 Docker 命令并严格解析原生 JSON。`system/status/{service,model}` 负责本机状态用例，不依赖 Remote 私有代码。Shared 的 `remote/monitoring`、`remote/docker` 和 `system/status` 持有双端协议。

### B3.1 子功能设计

- `remote/sessions/service`：唯一 Workspace 状态、实例绑定 attachment/lease、认证续接、准入、恢复 ACK、挂起、取消、终止及最终任务追踪；terminal 的背压/offset/输入与 shell cwd 的应用流程分职责实现，共享原 Workspace 实例而非复制 registry。目录请求的排队/替换/期限/安全事件由 workspace-shell-service 持有；Model 转换 shell 能力，命令语法和输出解析归 Native Shell Adapter。
- `remote/sessions/model`：Workspace、终端、历史及 checkpoint 的内部复用类型与明确应用↔技术转换；底层 SSH shell/字节流通过已有 machines/model、session-model 和 ssh-port；技术文件 I/O/Headless 终端只放独立 Platform Adapter，不在 Service 直接访问 fs/ssh2。workspace-history-model 隐藏日志/checkpoint/renderer Port、Node Stream 和技术失败；所有复用应用类型均在 workspace-types。
- `remote/interfaces/ws`：单一 `/ws/workspace` envelope、终端流与 resume 事件投影，接入现有 Files/transfer 调用与 NXW1，旧 attachment 的 lifetime 与新 owner generation 独立。管理 HTTP 在 `remote/interfaces/http` 显式安装。
- `remote/files/service`：FileAttachment、上传、copy/move、archive 仍独立掌管 SSH/SFTP 与任务资源；由 Workspace owner 绑定实例化释放能力，不另设可恢复 shell registry。
- `shared/src/remote`：共用 envelope 移交 Workspace 子域；terminal/suspend 协议按其消费者单独定义，Files/transfer 保留既有领域 DTO。

```text
packages/backend-next/src/
  main.ts                         进程配置与启动
  bootstrap/                      技术实例、模块安装、全库迁移与停机
  platform/
    storage/sqlite/               SQL 契约与 Runtime
      adapters/                   SQLite 方言、版本表及实际 Worker
    ssh/adapters/ssh2/            SSH/SFTP/命令技术实现
    archive/adapters/             原生命令格式与流式 ZIP 技术能力
    text/adapters/                文本编码技术能力
    http/                         通用 HTTP/WS
    security/                     通用加密与密码散列
    lifecycle/                    通用有界结果/失败记录
  modules/<module>/
    public.ts                     后端跨模块安全契约
    public-errors.ts              确有消费的安全错误出口
    register.ts                   装配、安装选项与生命周期
    migrations.ts / schema.ts     安装接口与顺序，不含 SQL
    interfaces/http/              HTTP 协议解码与投影
    interfaces/ws/                WebSocket 协议解码、投影与通道生命周期
    <feature>/
      *-rules.ts                  确需独立的纯业务规则，不访问存储或网络
      service/                    用例、权限、顺序与应用资源 owner
      model/                      应用类型及存储/技术转换
      storage/                    内部存储任务契约
      adapters/sqlite/            SQL、行解码、事务和 DDL
```

Targets 的 connections/proxies/ssh-keys/tags/host-keys/resolver/import 为同一模块子功能；Remote 的 sessions/files 各有资源，共用可信目标→SSH 建连转换归 `remote/machines/model`，不为该共用 Model 机械创建空 Service/Storage；Agent 当前为 scope/runs；通信对象在 Shared，内部可信输入和用例/存储对象仍各有 owner。无持久化功能不创建 storage。文件按职责和消费者拆分，独立 helper 不自动升级为公用能力。

## 3. 依赖方向

### B4.2 实际调用链

B4.1 密码成功且 TOTP 已启用时，`AccessService → FactorService → FactorModel → FactorStorage → SQLite` 写五分钟待认证；`POST /auth/login/2fa` 读取独立部分 Cookie，再经 `FactorModel → TotpPort → RfcTotp` 真实验证，最终同事务删除 pending、插入完整 session、清失败计数。WebAuthn OPTIONS/VERIFY 经相同 FactorService/Model，Model 消费 `WebauthnPort`，Adapter 调 `@simplewebauthn/server` 并将不可确定的供应商异常封装为具名技术失败；Model 转为安全应用失败；Shared unknown 解码经 HTTP 显式转换为内部 credential evidence，不让原始第三方凭据对象进入 Service。只有已提交的完整 SessionModel/AccessPublicApi 能供 Targets、Remote、Agent 使用。Platform Port 是合法通用技术契约，Service 不直接调用。

### B4.1 Access 调用链

Bootstrap 安装 Access、注入技术 Scrypt/SQLite/CAPTCHA Adapter；`platform/http` 只解析来源、Host/Origin/CSRF 和通用路由。安装模块时，对业务 HTTP 与 WS 路由施加 `AccessPublicApi.admitSource(trustedIp)`，登录/状态/登出/管理员黑名单恢复 HTTP 路由使用只检查白名单的 `admitAuthenticationSource(trustedIp)`（登录封禁由用例返回 429）；未匹配 HTTP 路由通过 Platform 可选通用回调先执行完整来源准入；业务端点依旧经各自 Access public `authenticate/authenticateDigest` 判定当前身份。Access Service → Accounts/Sessions/Captcha Model → 各自 Storage/Platform Port → Adapter。Remote/Targets/Agent/System 只依赖 Access public；Service 不直接调用密码、网络、SQL Port，Platform 不依赖 Access 业务类型。正常 HTTP/WS 入场不重复身份查询，长时建连、资源交付和敏感操作由所属 Service 复验原会话及实例身份。

### B3.2 调用链

Workspace WS → RemoteObservationService → WorkspaceService 实例绑定任务能力 → ObservationModel → machines/model、System/Docker Port → Adapter。Dashboard HTTP → 同一 ObservationService → Model；本机 HTTP → SystemStatusService → SystemStatusModel → LocalStatusPort。技术命令与供应商输出只在 Adapter，Platform 不导入模块/Shared 业务对象。

### B3.1 依赖约束

WS/HTTP → Workspace Service → sessions Model → machines/model → Platform ssh-port → ssh2 Adapter；Workspace Service → Files Service 的实例绑定能力，不经 WS 反向寻找资源。Workspace Service → History Model → Platform 日志/checkpoint/renderer Port → 本机文件/终端 Adapter。Interface 只投影 Shared 协议和安全错误，Service 不导入 Shared wire；Platform 不导入 user、Workspace、suspend 或 Agent 应用类型。Agent 通过各自 owner 使用通用 Platform，不深层引用 Remote 私有 Model。

```text
Bootstrap → 模块 register / 迁移安装入口
Bootstrap → Platform 技术实例
Interface → 本模块用例 + Shared 协议
Service → 本模块 Model / 子功能纯业务规则 + 所需跨模块公开能力
Model → 模块 storage 契约 / Platform 技术契约 / 子功能纯业务规则
SQLite Adapter → storage 契约 + Platform SQL
```

Platform 不依赖业务模块、不持有 Connection/Run/User、业务表、授权状态或业务注册槽。业务 SQL Adapter 不依赖 Model/Service/Shared 对象与协议；确需共享的基础值只从 Shared 精确 values 路径引用。

跨一级模块仅用 public 安全能力和明确安装契约，不深层导入 Model/Service；模块内部可直接协作，不绕全局 dispatcher。Service 定义密码/凭据保护的业务政策，Model 通过技术 Port 调用 SecretBox/PasswordHasher 并映射应用结果，技术细节和密码哈希算法由 Platform Adapter 持有。应用实例依赖由 Bootstrap/register 安装，不使用可变进程级数据库单例。

Port 文件表达 Platform 的技术能力及技术输入/输出，不是新增业务层：Model 调 Port，具体 Adapter 实现 Port。不得在 Port 中定义账户、连接、Run、授权或业务 registry，不允许 Service 绕 Model 直接调用；原始第三方对象不得进入应用类型。文件是否命名为 *-port 不改变此边界。

## 4. 类型与转换

### B4.2 类型及公开白名单

Shared 的 `access/factors/http.ts` 拥有 TOTP token/disable、WebAuthn credential JSON 和 Passkey 名称/发现 query 的未知输入解码，以及公开成功结果。Factors 内部身份、PendingLogin/FactorChallenge/PasskeyCredential 分别归 `factors/model/factor-types.ts`，Storage 行/命令归 `factors/storage`，Port 的公钥/注册结果不含 account/user 类型。HTTP 明确构造用户/id/计数/时间响应，登录成功联合含 `requiresTwoFactor:true` 的部分分支，注册 options 由 Model `publicWebauthnOptions` 投影；完整会话 bearer、服务端 pending/challenge cookie 和加密的 TOTP secret 不进入跨模块 public。

### B4.1 Access 类型唯一归属

Shared `access/{values,http,model}` 持有 cookie 名与持久时长、CAPTCHA 有限值/预算、登录 body、status 联合、公开 site key、黑名单分页与安全错误；Access 内部身份和密码登录请求归 `authentication/model/access-types.ts`，账号归 `accounts/model/account-types.ts`，登录计数/会话归 `sessions/model/session-types.ts`，验证码安装事实归 `captcha/model/captcha-types.ts`，技术 CAPTCHA 请求/失败归 `platform/security/captcha-verifier.ts`，存储行归对应 storage。接口 unknown → Shared codec → Access 应用命令；Account/Session Model 逐字段转换 SQL 行，Captcha Model 逐字段转换供应商请求和失败；`register.ts` 及 HTTP 接口逐字段投影 public 身份及 wire 响应。未暴露 password_hash、secret、cookie token 给其他模块。安装 CAPTCHA 字段独立定义在 register，并逐字段转内部 CaptchaConfiguration；SourceAddress/AllowedNetwork 在 admission/model，不含 ipaddr 实例。

### B3.2 类型

Shared wire 与内部观测事实独立定义；HTTP/WS 投影逐字段构造，包括 Docker stats、ports、labels 和 loadAvg。内部复用事实在 monitoring/model/observation-types，本机类型在 system/status/model/status-types；技术事实归 Platform。任务 scope 归 sessions/model/workspace-types，不暴露机器句柄。

### B3.1 唯一类型与转换

| 边界                                                   | 真实输入/输出                                                             | 唯一 owner                                                     | 白名单转换/消费者                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| WS envelope 与 connect/resume/terminal/suspend         | unknown JSON、requestId、viewport、token、generation、ACK、事件及安全失败 | Shared `remote/workspace`、`remote/terminal`、`remote/suspend` | Shared codec 严格读取；WS → sessions model 入参逐字段；WS 逐字段投影响应及事件；正式前端 F1 消费 |
| Workspace 应用会话、attached owner、pending 恢复、游标 | 状态判别联合、身份摘要、实例 generation、任务与关闭能力                   | `remote/sessions/model/*-types.ts`                             | sessions Service 消费；Model 转为纯技术连接/日志命令，敏感值不出 HTTP                            |
| SSH/PTY/channel/technical error                        | machine/shell 字节、开关/退出与派发结果                                   | `platform/ssh/ssh-port.ts`                                     | ssh2 Adapter 归一技术错误；sessions Model 映射具名应用失败，保留 cause                           |
| 日志/checkpoint 技术事实                               | 有界字节范围、偏移/修订、模式与视口                                       | sessions Model + Platform 本机日志/terminal 技术契约           | Model 字段投影；Service 持有页大小/保留/恢复政策；WS/HTTP 安全输出                               |
| 关联 Files 资源                                        | workspaceId、会话绑定与附件实例                                           | `remote/files/model/file-types.ts`                             | Workspace Service 调用 FileService 的实例绑定 release；Files Service 自行管理任务                |

现有 Files `workspace.ts` envelope 的迁移须与 backend-next 各消费者、codec、exports 和 fixture 同步；不留转导出兼容桥。与旧正式前端仍用 Protocol 的差异只登记 F1，不在此批改前端。

内部复用应用类型在所属 `model/*-types.ts`；存储契约在 storage；技术契约在 Platform；后端跨模块类型在 public；双端契约按 [Shared 架构](SHARED.md) 归属。类型与实现分开，低层不反向引用上层。Remote 内部会话关闭原因归 sessions/model，后端公开原因独立定义；内部 Model/Service 不引用本模块 public 类型。

业务流程、权限和操作顺序由 Service 持有；复杂或共用的纯判断放所属子功能 `*-rules.ts`，输入/结果类型仍归 model。规则只消费应用事实，不引用 Model 类、Service、Storage、SQL 或网络；简单判断直接留 Service，不为每个操作创建规则文件。Model 不内置业务算法，可以在事实转换回调中调用规则。

Model 逐字段转换应用与存储/技术输入结果；模块入口/出口 mapper 保护公开边界；HTTP/WS 逐字段投影完整 wire。三个边界各有职责，即使字段相同也保留运行时白名单；同一边界不复制转换。复杂公开投影可独立 public-mappers，单处投影就地保留。

应用与存储/底层能力之间明确保留 Model 转换层，即使当前字段一致、暂不需要变换，也不让 Service 绕过 Model；协议入口/出口 mapper 同样保留。精简只合并同一边界的重复实现，不删除转换边界。同一用例兼有存储与远端资源时，由 Service 协调；复杂度确有需要时按存储转换和资源封装拆分 Model，数据库事务不覆盖远端副作用。

协议差异由 interfaces 解码和投影，Service 以真实业务语义组织用例，不使用 Legacy/New 等迁移标签构造长期双轨。同语义共用路径归一、结果确认及资源执行机制；不同的覆盖前提、编码和操作范围保留明确用例。协议容量由 Shared codec/interface 校验，Service 另守应用路径、操作权限、预算与副作用约束。

Files 的 `FileResource` 只提供应用身份、可用状态、metadata/字节读取、staged write、基础 SFTP mutation、realpath/chmod 及受约束 command 结果；Machine/SFTP lease/Node Stream 私有持有于 Model 的 `SftpFileResource`。Model 负责技术 metadata/byte source、同目录临时项和技术 commit/discard 转换；Service 持有 UTF-8/hash/文件类型、覆盖、编码、search、递归/force 删除、批量顺序和写后确认等业务政策；目录搜索流程归 `files/service/file-search.ts`，资源准入与整项期限由主 Service 统一管理，不取得技术句柄。Files 内部失败码归 model，HTTP/WS 分别白名单投影公开契约。

ssh2 的 SFTP status、异步 read stream error 与 command channel 派发结果在 Platform Adapter 转为具名技术失败；Model 只消费 `remoteStatus` / `not_started|failed|unknown` 等技术契约，不读取供应商 `cause.code` 或错误正文。原始 cause 仅作诊断。PTY 同样通过应用资源操作。公开出口不传 cause 或凭据。Agent 的安全错误类在 public-errors，内部 agent-errors 只映射失败，不重复定义公开码；HTTP 使用 Shared 严格解码并逐字段投影。

## 5. 入口与安装

### B4.2 安装与真实接口

`registerAccess({sqlite,secrets,passkeys})` 装配 Factors，`createApp` 的 passkeys 可选安装配置为明确 `{origin,rpId}`，独立入口从 `NEXUS_NEXT_PUBLIC_ORIGIN` 推断并允许 `NEXUS_NEXT_PASSKEY_RP_ID` 收窄。RP 必须与公开来源 hostname 一致或是其合法父域；非 localhost 的 HTTP Origin 禁止启用。

因素路由：`POST /api/v1/auth/login/2fa`、`POST /api/v1/auth/2fa/{setup,verify}`、`DELETE /api/v1/auth/2fa`、`POST /api/v1/auth/passkey/{registration-options,register,authentication-options,authenticate}`、`GET /api/v1/auth/passkey/has-configured`、`GET /api/v1/auth/user/passkeys`、`DELETE /api/v1/auth/user/passkeys/:credentialID`、`PUT /api/v1/auth/user/passkeys/:credentialID/name`。Auth HTTP 仅签 HttpOnly/SameSite/Lax 受控 cookie；FactorService 始终通过完整 SessionModel 验证管理权限。

### B4.1 Access 安装与入口

`createApp` 从 `AppOptions.loginFailurePolicy/ipWhitelist/captcha` 安装快照；独立 `main.ts` 提供 `NEXUS_NEXT_IP_WHITELIST`（逗号/换行分隔 CIDR）、`NEXUS_NEXT_IP_BLACKLIST_ENABLED`（默认 true）、`NEXUS_NEXT_MAX_LOGIN_ATTEMPTS`（默认 5）、`NEXUS_NEXT_LOGIN_BAN_SECONDS`（默认 300）、`NEXUS_NEXT_CAPTCHA_ENABLED/PROVIDER/SITE_KEY/SECRET_KEY`（默认关闭）并在开放监听前检查值。实际 Access HTTP：`GET /api/v1/auth/{needs-setup,status,captcha/config}`、`POST /api/v1/auth/{setup,login,logout}`、`PUT /api/v1/auth/password`；认证的黑名单 `GET/DELETE /api/v1/settings/ip-blacklist`；其它 Targets/Remote/Agent/System 路由经全局完整来源准入，未知路径同样检查来源；仅状态、登出、登录及管理员黑名单恢复保留白名单级入场（后者须 Access Service 验证 userId=1）。CAPTCHA 成功绑定公共 Origin hostname；安装时从公共 Origin 推导，未绑定拒绝启用。B7 持久 Settings 应在 Access 注册前提供经过校验的版本化策略快照，后续安全刷新必须确保原子替换和无静默默认，不能复用技术 Platform 注册槽。

### B3.2 入口

同一 `/ws/workspace` 安装 status.start/stop、docker.status/command/stats，事件 status.sample/error；HTTP 保留 `/api/v1/system/status`、`/ssh-resources` 与 `/ssh-resources/:connectionId`。Remote/register 装配观测能力，System/register 安装本机能力；Bootstrap 仅调用模块安装入口。

### B3.1 安装设计

`registerRemote` 只安装一个 `/ws/workspace`，接入 `workspace.connect/resume/ping/close`、`terminal.input/resize/flow/currentDirectory/changeDirectory`、`suspend.mark/prepare/commit/unmark/list/resume/owner.renew/history.previous/history.reset/terminate/remove/rename`，保留 Files/transfer 实际协议；另安装 `/api/v1/ssh-suspend` 的列表、终止、移除断线条目、重命名、日志导出。旧 PTY HTTP/WS 仍在独立消费者范围内运行；不得因新入口存在就宣称旧接口等价。管理和 WS 共用 sessions 的权限、结果与资源 owner。

main 读取环境和启动；Bootstrap 安装实例与全库迁移；模块 register 组装内部 Model/Service/Adapter，并返回消费者需要的能力、HTTP/WS 安装及 quiesce/close。Bootstrap 不逐个构造所有业务 Repository，也不引用私有配置类型。

Targets 导入仅公开 importMany；单项使用一元素集合，每项仍有独立事务与安全结果。importOne 保留为模块内部实现，不因测试方便扩大出口。管理类型为区分模块保留 Shared 别名，不复制字段定义。

待实施：模块 interfaces 将 Shared 协议 schema 绑定到真实 HTTP 路由，Platform 提供通用元数据契约，Bootstrap 汇总已安装路由生成 OpenAPI；WS 契约另行汇总。当前 HttpRoute 尚无完整 schema 关联，此设计不能写成已完成。

Platform HTTP 已支持 HEAD、流响应和按路由 opt-in 的 binary 入站，队列/背压属于技术层。票据、Workspace/任务、目标授权与业务预算归 Remote；Platform 不注册业务资源。统一 Files 应用绑定由 FileService 持有，Interface 不作为 Service 的资源查询来源。

Access 取得可信会话身份；Targets 管理出口只给非敏感对象，可信 SSH 解析为独立后端能力；Remote 普通资源绑定登录会话；Agent 绑定自己的 user/App/Thread/Run。UUID 和目标选择不替代授权。模块内部 HTTP 可调用本模块明确 Service，跨模块仍走 public。

Remote 会话 HTTP 仅负责协议解码和失败投影，入场身份查询与管理员授权统一由 RemoteSessionOwner 执行。读取/关闭对未认证或无权限身份抛具名失败，认证通过但资源不属于该会话时返回未找到；建连完成后再次核对权威身份，WebSocket 访问/输出也继续复查。入场去重不删除异步期间会话撤销保护。

Remote 同时安装 `/ws/workspace` 的旧 Files 子协议适配层。Interface 持有旧 envelope、requestId/in-flight、binary read owner、NXW1 发送、cancel 和 ready/error；旧 WorkspaceEventHub/Protocol 复查确认没有独立 Files mutation change event，因此适配层不虚构 `filesystem.changed` 一类消息。Files Service 持有路径/编码/操作政策；Model/Platform 不知道旧 Workspace DTO。R1 恢复 fresh `workspace.connect`、`workspace.ping` 与 Files 消息；完整 `workspace.resume`、Terminal/suspend 已有 B3.1 源码，status/docker 已有 B3.2 源码，行为统一待 B10。下载/上传/传输/归档的 B2 源码已收口，行为待 B10。现有 `/api/v1/remote/files` 暂由 DEV `remote-next` 消费，后续 P1/F1 决定最终 API，不把双入口固化成长期设计。

## 6. 数据、事务与并发

### B4.2 v6 与挑战原子性

应用迁移 v6 在不重写 v1–v5 的前提下给 `access_accounts` 增加 `totp_secret_encrypted`，新建 `access_pending_logins`、`access_factor_challenges`、`access_passkeys`。待登录只保存 digest、用户、密码修订、rememberMe 与五分钟到期，同一浏览器旧 partial 按摘要同事务替换，最大 64 在事务中准入；挑战只保存 digest、kind、用户/完整会话摘要、加密的暂存 TOTP secret 或 WebAuthn challenge、RP/Origin 与到期，最多 1024。保存新 challenge 会删除旧 cookie 对应项，完整会话下同类 challenge 被替换。注册只有在原 challenge 未过期、同一账号完整 session 仍有效、credential ID 未占用时入库。认证在存储事务内复验 challenge、账户/credential 所属、counter 变化、来源封禁，并同事务消耗 challenge、更新计数、签发完整 session；零 counter 遵循旧技术契约，非零 counter 必须递增。TOTP 激活在 session 与 challenge 上 CAS，禁用在密码旧 hash、session 和当前加密 secret 上 CAS；禁用后删除该账户 pending/challenge。

Access 改密由 Service 一次入场认证、AccountModel 转 token digest，SQLite 在修改同一事务复核原 session 仍存在且未到期、旧 password hash 未变，再撤销账号全部会话；计算密码期间撤销或过期阻止写入。登录签发 Storage 与 Model 各自持有具名结果，明确 issued、credentials_changed、rate_limited、cancelled，避免并发封禁被降为错误密码。accounts/sessions Model 使用共用 access-storage-boundary 转技术失败，公开 accessBoundary 只消费应用失败并投影安全码。该 helper 只用于 Model 的技术错误转换，不是新的 Service 或公开能力。

### B4.1 Access 持久权威与竞态

Access 登录失败记录的最后失败时间通过应用统一迁移序列 `bootstrap/schema.ts` v5 增量添加，不更改 v1 已有迁移的建表合同；v5 将旧行 `window_started_at` 回填为 `last_attempt_at` 并建索引。后续旧 v1–v4 原数据与 v5 新装数据库均需 B10 验证，不能只以最新空库启动证明迁移安全。

`access_accounts` 对管理员初始化使用同一 SQLite 事务的空库检查/唯一写入；改密以旧 hash CAS 更新并同事务删除用户全部 `access_sessions`。`access_sessions` 只保存 256-bit 随机 bearer 的 SHA-256 摘要、账号凭据修订、remember 标志与 30 天到期；状态每次验证从存储重新查，撤销即失效，不复制到 Platform。`access_login_attempts` 按规范化公网 IP 保存次数、窗口起点、封禁至与最后失败时间。失败计数的读改写在存储事务内使用应用规则回调；成功登录在创建会话事务里复核账号密码/因素及当时封禁、检查取消意图，然后原子新增 token 摘要并清除失败记录；不预先撤销旧浏览器会话：HTTP Cookie 交付无法与 SQLite 提交原子绑定，断连时旧 Cookie 必须仍可使用。若事务已提交、响应尚未交付，则尝试撤销新 token；确认不了撤销/提交时保持 `operation_unknown`，不声称自动回滚。每 5 分钟至多执行一次后台数据库惰性 sweep，删除过期会话与封禁已结束且最后失败超过 7 天的记录，不提前清活跃封禁。名单解除是独立删除；登录先检允许入场，验证码网络 await 后、会话提交前复检封禁。当前单 SQLite v1 初始化表结构尚无单独 Settings schema，B7 统一拥有长期配置。

### B3.2 并发与缓存

无新增业务持久化，不创建空 storage。当前缓存和控制阻断为本进程状态，不假装已迁移旧持久资源 lease；B6 接入跨 Agent 治理，B7 接入持久化设置。Workspace 操作绑定具体 attachment、配置 fingerprint 与原 owner；后台主机缓存当前仅供 userId=1，按 host/port 及完整可信配置指纹隔离，同配置在途采样共享，TTL 从开始计算。删除/改配置及 reset 后旧任务不可回填。默认状态间隔 3 秒、后台 TTL 60 秒；后续 preferences owner 在 B7 接入安装配置，不伪装已有配置持久化。Docker 同连接配置的本地变更互斥，覆盖容器名称与短/完整 ID 别名；unknown 保留该配置的控制阻断，不声称涵盖尚未迁移 Agent 的跨进程/持久 lease。

### B3.1 权威状态与竞态

活跃 SSH/PTY、attachment/generation、lease、ACK 等由进程内唯一 Workspace Service 状态机权威持有，重启不持久化技术句柄。64 个普通 Workspace 名额在首次异步身份/目标解析前原子预留，覆盖排队、opening、attached/detached、closing 和未确认清理；重复 ID 不能抢占或重复计数。挂起目录另按用户 32/进程 64 限额与 24h 生存期，重附着同一 Workspace 不再占第二槽。每次 await/WS delivery/ACK 都复查记录实例与 generation；过期/旧 attachment 不能归还新实例或恢复旧 input。技术日志在私有本机临时目录，可重启清理，无持久活跃 shell。文件记录若无需 SQL 则不创建数据库层；任何未来持久变更仍经 Model/Storage/Adapter 执行。

真实 SQL 仅在 Adapter：Agent scope/runs 和 Targets Host Key DDL 归各子功能 `adapters/sqlite`，模块迁移通过初始化接口调用。Bootstrap 持有唯一全库版本顺序，已编号迁移保持签名和安装语义，版本 marker 与 DDL 同事务提交。

Platform 的 SQL Executor 契约在 `storage/sqlite/sql-types.ts`；版本表 Adapter、事务控制 Adapter 和 Worker 在 adapters。Runtime 持有队列、隔离和失败语义：回调失败回滚，rollback_failed/commit_unknown 保留因果并使实例不可用；未知提交不自动重试。Worker 严格验证完整消息，损坏/不可关联结果使待完成调用全部拒绝。

业务多表写入和引用/CAS/幂等校验归存储 Adapter 的真实事务。需要当前状态的业务规则采用明确同步回调：Adapter 在事务内读存储事实 → Model 白名单转换为应用事实 → 纯规则判断 → Model 转回存储结果 → Adapter 写入/提交；回调不执行网络、异步任务或开启嵌套事务。Adapter 只依赖 storage 中的回调契约，不导入应用类型、规则实现或业务策略配置；禁止先在 Service 读旧状态、判断后另开事务写入。

B1 Files mutation 不新增数据库或 SQL。单个文件资源由 Service 串行执行操作，但远端 SFTP 预检与后续 mutation 之间仍存在服务器侧竞争窗口；`expectedSha256` 的两次复查只提供尽力冲突检测，不是事务/CAS。目录项 rename 的目标不存在预检同样不是原子 no-overwrite 保证。

Access 的失败窗口/封禁计算在 sessions/login-failure-rules，Adapter 只读取、解码计数并原子写回。Targets 的 connections/ssh-graph-rules 根据同事务图快照覆盖拟修改边，再校验成环、深度、展开数量及受影响祖先；Adapter 读图及写关系，Model 持有回调转换，register 同时装配普通写入与导入/克隆路径。Agent 的 runs/run-rules 同样独立于 Model，版本/状态判断继续在事务内执行。Targets 可信解析在同一 SQL 快照读取目标、凭据与路由，Model 计算指纹并在解密前核对 expectedFingerprint；先读指纹后重新解析不能替代同快照检查。指纹不替代 Host Key 信任，也不证明后续配置永不变化。

## 7. 生命周期与失败

Factors 的期限/容量和已启用政策由 Service 决定，Model 接收应用政策再转换为 storage/技术命令。应用时间保持毫秒，Unix 秒只在 HTTP mapper 转换。统一 access/interfaces/http/access-delivery 对会话及挑战追踪到 HTTP finish/close，未交付时撤销；finish 不证明浏览器接收。已签会话后确认失败按 operation_unknown 表达并尝试撤销，保留全部失败因果。Platform WebAuthn Port 以独立技术证据定义输入，Adapter 明确投影 vendor JSON，产品 issuer/RP 显示名由应用传入。

### B4.2 安全失败与清理

TOTP 使用随机 20-byte 秘钥的 Base32/HMAC-SHA1 6 位 RFC6238、30 秒步进前后各一窗，向用户展示 otpauth QR；仅在加密 `SecretBox` 生效时允许初始化，密钥以账户绑定 AAD 存 SQLite，失败拒绝而非明文降级。WebAuthn 由本地 `@simplewebauthn/server` 验证签名、challenge、公开 Origin、RP ID 与 user verification，认证 counter 用 SQLite CAS，不能信任客户端自报结果。多个并发完成只能消费同一 token 一次，重试未知结果先重新获取权威会话。完成登录前检查来源黑名单，错误因素验证码累计来源失败。Logout 同时撤销完整/部分 bearer 和设置/Passkey challenge；过期与替换 challenge 不成为资源授权。已经派发的数据库事务不因断连而假定回滚；WebAuthn 浏览器结果的真实交付行为留 B10。

### B4.1 Access 生命周期

账号不存在时仍执行无账号的耗时密码校验以缩小用户枚举时差；密码错误与 CAPTCHA 拒绝只记有权限的公网失败计数，强制 Passkey 的账号拒绝密码路径（`factor_unavailable`），TOTP 账号转部分认证而不签发完整会话。CAPTCHA 网络 Adapter 单次 POST、不自动重试、十秒截止、16 KiB 响应预算；配置无效在安装时拒绝，网络/非预期响应是安全 `captcha_unavailable`，供应商明确 `success:false` 是 `captcha_invalid`；成功时还必须匹配配置的公开 Origin hostname，Google 仅支持 v2 checkbox、不接受 v3 action/score，非 2xx 响应体取消，不能固定成功。请求断连传播 AbortSignal，已开始的 SQLite 事务不凭取消推断回滚。失败计数/签发是独立事务，供应商失败不影响既有会话。改密和登出持久撤销立即阻断下一次身份复查，但不能撤回已经发出的远端副作用；Workspace、Files、PTY、desktop、Agent 原 owner 仍在操作/交付/定期状态门槛复验会话摘要并自行收尾。HTTP 与各独立模块关闭并发收尾，SQLite 在二者实际结束后关闭；失败聚合，不把定时等待终结当资源释放。

### B3.2 生命周期

临时命令任务有全局准入和整项期限，取消不提前释放；Workspace detach/close 和观察 owner shutdown 取消关联任务并等待真实收敛。Model 关闭临时 SSH，不修改最近连接时间，不在 PTY 注入采集命令。Docker 非零退出是确定失败，已派发但无退出证据为 operation_unknown，清理失败保持具名类别并占用名额；不自动重放。订阅取消使旧结果失效，慢采样不重叠，资源缓存不交付已失效身份/配置。

### B3.1 生命周期设计

连接按 reserve → 身份/可信目标 → SSH open → shell open → FileAttachment → 认证复查 → 绑定 WS/交付 → ACK/运行推进；异步拒绝或取消后晚到 shell 和 Files 仍由其原 owner 追踪关闭，确认清理前不释放预留。异常 WS 断线只解除当前 generation，默认保留约 120 秒再终止；主动关闭先失效附着，终止 shell 及相关 Files/transfer。标记/prepare/commit 挂起应完整记录日志/checkpoint、先暂停后移交再恢复消费，部分副作用未确认的结果保留 `operation_unknown`。接管先撤旧 generation，再有界交付历史/状态与明确恢复 ACK；未 ACK 不能宣称恢复完成，原 owner 在 rollback/lease expiry 继续跟踪资源。历史 100 MiB 最大保留、初始约 256 KiB、翻页约 256 KiB、checkpoint 4 MiB，流读取/完整编码/客户端背压单独设限，先做输入预检、再对读到的实际字节检查；不声称快照或磁盘硬配额。同步抛错、异步拒绝、清理多个失败经具名错误与 AggregateError 收敛，同一失败只登记一次。远端失控/断网后不主动重放命令与 unknown 变更；D12/D13 的原生工具与非原子窗口取舍不变。

资源有唯一 owner；准入、半开、活跃和关闭任务追踪至真实收敛。等待超时不归还仍被资源占用的名额；晚成功关闭，晚拒绝中的清理失败进入有界诊断及停机汇总。`RemoteResourceCleanupFailure` 区分清理完整性失败与普通授权/建连拒绝。

外部操作和按 ID 释放继续认证；已获资源的内部 owner 使用绑定该实例的窄关闭能力，撤销会话、取消或断开后仍能完成清理，不重新认证后才关闭，不增加任意 ID 的无认证释放入口。关闭能力不进入 Shared/HTTP，关闭 Promise 与失败仍归原资源 owner。

二进制读取的允许类型、容量和初始范围由 Service 确定，Model/Platform 按明确字节范围读取；空文件不创建无界流，短读不能伪报完整成功，后续追加不扩张本次范围。范围确定不等于内容快照；失败、提前终止和消费者断开都须收敛底层读取。

R2 后，Files Service 的 `runAdmitted` 统一限定二进制数据及 final 帧发送期限，Service 将同一有效 signal/剩余期限交给 Interface 的 NXW1/backpressure 发送循环；Interface 不再独立无限等待。应用交付联合类型 `FileBinaryPiece`/回调归 Files Model 类型 owner，Interface 仅投影具体帧。Workspace `ping` 调用 Service 核对登录身份、配置指纹、资源权威状态及 Workspace ID 并续期；失效绑定不继续发布成功。Files Service 对普通 Workspace 保留 64 个含 opening/closing 的预约，独立 HTTP Files 另有 8 个名额，晚到清理与无法确认的关闭仍占对应名额，避免错误释放。

R2 二次审核：Workspace `connect` 的 Targets `get` 不再由 Interface 在容量/期限之外等待，Files Service 在第一次 await 前预留 workspaceId 和 64 槽，将身份/Targets 查找/SSH open 置于同一个可中断的建连期限；返回 `WorkspaceFileAttachment.connectionName` 的应用事实，WS Interface 仅投影。关闭期间底层 SSH cleanup 可能无界，不能以强制短路伪称已清理；WS 心跳和断开先失效绑定、交还确定失败，Service 对迟到资源、关闭 Promise 和清理错误持续负责，**只有确认释放成功才归还名额**。测试夹具的 Service 构造调用已同步注入 Targets public 查询；相关慢查、竞态与失败清理仍留 B10。

关闭先保存共享 Promise，再执行可能重入的清理；取消订阅也属于可能失败的清理步骤，一项失败仍继续其余退订、资源关闭和终态通知，保留全部因果并聚合。停机停止新准入、关闭 HTTP/WS 并等待已接纳任务、取消并 drain 模块资源，最后关闭 SQLite。当前动态资源由 Remote 持有，后续 Agent 调度/执行必须提供自己的生命周期。

普通 PTY、Files 和 Agent 使用共同 SSH/SFTP Platform 工厂，但不共用授权或活跃资源；Remote sessions/files 共用的可信目标建连转换由本模块 `machines/model` 持有，Agent 不深层导入它。PTY 协议 owner 管 ACK/背压/EOF；Files Service 管身份/指纹复查、准入/期限和文件业务流程，Files Model 管 SFTP lease、byte source、metadata 转换与 staged temp/commit。新建文件使用标准 SFTP rename，不调用可覆盖目标的 POSIX replace；覆盖已有文件才使用 replace。实际 SFTP 目录扫描以 opendir/readdir(handle)/close 收敛，文件读取经 Adapter `readChunks` 将异步 ssh2 error 归一后再交 Model。

B2 源码已包含独立 HTTP 文件下载 ticket/GET/HEAD/目录 ZIP 和 binary 上传 WS。Platform HTTP 提供通用 HEAD 与 opt-in binary ingress（其余 PTY/Workspace 控制消息仍拒绝原始字节），Platform SFTP 按明确 byte offset/end 读取及技术流期限；不会接收 Workspace、票据或 Task 业务类型。Files Model 对外提供 byte source 和临时写流 staged append/commit/discard；HTTP Interface 解码 Range 语法/状态码，FileService 负责应用范围政策、票据、上传冲突、目录 allowlist、原有 Workspace owner/身份与指纹、任务准入与长流确认。ZIP 目录遍历政策由 Service file-directory-zip 持有，条目/字节经 file-zip-model 转给技术 ZIP Adapter，库/reader/producer 的收尾归 Adapter；file-copy 则完成文件/目录 SFTP copy/move 技术流程，Interface 单向投影状态和 metadata，不在 Platform 放文件业务政策。

本批没有把旧传输实现照搬为远端通用命令：旧跨机器执行曾将私钥临时放在远端机器上、使用包含密码的命令参数，新 copy/move 使用独立的 SFTP 源/目标技术资源；未知副作用不自动重放。旧上传传输层异步触发 append，但其 Service 本来有串行队列；新 binary WS 在技术接收层额外显式串行并受背压/字节上限控制。旧目录 ZIP 遍历与短期下载票据活跃流过期等隐患均增加有界 owner 处理。跨不同登录 token 的同用户 Workspace 源资源改经 Access authenticateDigest 校验原会话有效性及当前请求者身份；原 bearer 不保留。Model 的 SFTP readlink/symlink 支撑保留链接本体，目录复制后显式恢复 mode，旧隐式跟随 symlink 的行为不照搬。

B2 archive 由 Service 决定输入/成员安全/任务/取消与发布；file-archive-model 将应用参数/结果和错误显式转换，Platform archive native Adapter 持有 shell 命令、原生列表及退出码解码；FileResource 管 SSH/SFTP 技术资源：压缩通过原生 `zip`、GNU `tar` 直接在远端写带格式后缀的私有 `.part`，由 SFTP 确认后 rename/replace；支持归档输出位于所选源目录内部，源树先经 SFTP 有界扫描并拒绝控制字符（防止 native stdout 进度伪造），命令明确排除旧目标和临时项。解压先用远端原生 `cp --reflink=auto --no-dereference` 建立权限受限的私有归档快照并经 SFTP 核验文件类型/大小，`unzip`/`zipinfo` 或 GNU `tar` 对该快照分别列出简略成员名与详细成员元数据并逐项交叉检查名称/类型/大小（GNU tar 顶层 `./` 不占发布条目预算），实际提取使用同一份快照，按规范化路径、非目录祖先、重复名称、特殊成员、20k 项/64 GiB 声明展开预算与 64 层深度校验，GNU tar 使用 `--no-overwrite-dir` 防止根条目改写私有 stage 权限，先提取至私有 stage，再由 SFTP 复核每一项的真实类型、实际文件大小、总展开体积/层级及 setuid/setgid 权限位，并预检查目标路径类型冲突后发布；原生提取显式排除 symlink/hardlink，只提取普通文件和目录；应用校验通过后，符号链接经 FileResource/SFTP 创建，TAR 硬链接由 ArchiveModel → native Adapter 的 `ln -P` 创建，避免提取中沿归档链接写入；设备/特权成员仍在提取前拒绝。源可能并发变化，预检不等于文件快照；保留 unknown 退役、取消与进度边界。密码执行器按实施方案 D12 保留原生 zip/unzip `-P`：密码经 POSIX shell quote 直接拼入原生命令参数，与旧正式实现一致；接受 SSH command string 和工具 argv 中包含密码，不额外导出密码环境变量，不记录完整命令或回传诊断。无需新增归档 PTY、Python 或 Expect；现有 Model 转换不变。B10 核对密码/失败/秘密日志行为；不承诺 AES 兼容。

归档纯政策归 `files/file-archive-rules.ts`：成员名称/结构/预算、符号链接逐段目标及硬链接引用完整性只消费应用事实，不访问资源。归档内部 `FileArchiveEntry`、链接计划和提取计划归 `files/model/file-task-types.ts`，不放 Shared；Service 编排快照、提取、链接物化、发布与恢复。Model 对提取计划及成员 kind/linkTarget 显式白名单转换；native Adapter 解码 GNU tar 的 `->`/`link to` 与 ZIP 链接载荷，处理 Info-ZIP 的字面量 pattern 和原生排除参数；压缩时临时输出/旧目标的 ZIP 排除项同样逐项转义，shell 引号不替代工具 pattern 转义。ZIP 链接载荷按 4096-byte 预算、严格 UTF-8、具名密码失败和真实结束 marker 解码，不给 Service 原始 CLI 输出。硬链接保留真实 inode 关联，不自动退化为复制。

Remote 协议入口按通道归 `interfaces/http` 与 `interfaces/ws`；PTY、Workspace Files 和 upload binary 都归 ws，业务语境留文件名。目录迁移同步 register 和后端 fixture，URL、Shared 协议及授权 owner 不变；没有旧路径转导出。

Native Adapter 的列表输出按 names/modes 顺序分段，每段 od 独立检查退出状态；只有完整两段之后才输出完成标记，不依赖 POSIX 管道的最后一步掩盖前一步失败。列表工具写入前设置单文件大小限制，后端每段 8 MiB 解码预算仍保留；限额及工具语法是技术策略，不进入 Shared。该单文件限额不提供解压总配额。命令 stdin finished 监听在 Model 完成/取消后清理，stderr 与 channel 继续由原 finally 收尾。

Native Adapter 将原始工具退出码归一为 NativeArchiveOperationOutcome；Model 只消费 missing_tool/limit_exceeded/password_required/invalid_password/rejected 技术事实，再显式投影应用失败。压缩 writerExited 来自工具返回后的独立 marker，容量超限继续 drain，未确认 writer 退出不能清理或通过 ZIP warning 发布。ZIP/TAR 成员的 mode 在技术 parser 解码，DOS ZIP 没有 POSIX 元数据时为 null；Service 拒绝特权成员，记录 native stage 的 mtime，并在发布后由深至浅恢复明确成员的普通 mode/mtime，stat 确认整项结果。未显式声明的既有 implicit directory 不重写属性。发布及恢复前检查根规范路径与父目录 lstat/realpath；这是有界复查，不能替代 fd/nofollow 原子能力。安全链接有源码实现、实机待验，设备/特权成员的 UNSUPPORTED_ENTRY 与前端消费延后项在 Shared/实施方案对应 owner 维护。

mutation 技术结果区分 `not_started / failed / unknown`；远端 command channel 建立也使用同样派发分类。已派发后取消、deadline 或连接终止不证明远端回滚，unknown 资源退役且不自动重试。写入已生效后的读取或结果校验失败同样保持未知结果，不能按普通未写入失败处理。确定失败尽力清理临时项；unknown 时不继续发可能与晚到 mutation 竞争的清理命令，因此真实服务器可能残留私有 temp/backup，B10 必须核对。整体停机有界、原子 nofollow、原子 CAS 和文件快照不能凭接口宣称。

远端能力按实施方案 D13 保持现有 SSH/SFTP 和原生工具要求，不部署新增 helper 或特权/文件系统配额。路径检查与发布间的同权限并发替换窗口、解压期间无总磁盘硬配额均为明确接受的能力限制；64 GiB 是声明/事后展开量的应用预算。保留私有 snapshot/stage、成员拒绝、逐项复查、结果确认及清理失败追踪，不将这些机制描述为强隔离或实时磁盘限额。

原 Python 版 `dir_fd`/`O_NOFOLLOW` 解压审查为历史记录，不构成原生 CLI 安全保证。当前原生工具排除全部归档内链接，安全相对 symlink 和指向归档普通文件的 TAR hardlink 在独立步骤恢复；device/特权节点和危险链接拒绝；通过私有 staging + SFTP 类型检查限制已知攻击面，但最终目标目录替换仍存在竞态；取消或断线后只在能确认远端命令结束时尝试清理 staging，不能宣称所有资源已原子清理。原生命令退出 marker/进度解析、POSIX/DOS 属性、ZIP 加密及目录合并需 B10 验证。旧正式实现本来不支持 AES；Python 迁移中间方案不是旧功能基线。Model SSH stdout 按行白名单解析，stderr 独立 drain 且不回显。Service upload/copy/move/archive 仍统一阻止活跃 taskId 冲突、复查异步身份与任务实例。

Files Service 区分直接借用 Workspace 与独立传输：direct 操作取消沿原资源退役，dedicated_transfer 只收尾独立 SSH/SFTP，健康 Workspace 续闲置期限；显式关闭仍中止全部关联任务。任务 finished/cleanupFailure 是 Service 单文件私有状态，打开阶段、任务正文临时项清理与关闭阶段的具名清理失败均追踪并保留任务标识及配额；copy/归档整项 unknown 转换不抹除清理失败类别，Workspace 关闭尽力完成其余清理再聚合失败，不提前归还预约。prepare 在串行准入内计数，登记前复查取消及具体 owner；start 始终重新检查真实父目录，部分 mkdir 后失败保留 unknown。派生路径按 Shared 传输预算检查，不将该预算施加到旧 Workspace 基础路径。WS callback 绑定具体 attachment，接口只投影安全 operation_unknown，不暴露 cleanup cause。

file-copy 由 Service 在首次副作用前预检整批目标与源的重叠。同 target/fingerprint 用源父目录 realpath 保留叶节点链接语义，目标的缺失后缀基于现有祖先解析，不为预检创建目录；检测相等/祖先/后代及规范位置的嵌套源。原始同路径 move 仍 no-op，别名解析与 metadata 只是变化检测，不是远端原子隔离。move 删除目录后的复查豁免自身删除引起的 mtime/size 变化，但 mode 仍须一致。ZIP 技术 Adapter 在 append 同步拒绝时同样停止并等待 reader finished，保证其拒绝被观察且原 producer/consumer 因果保留。

Files Service 统一维护每 Workspace 16 个 prepare/upload/copy-move/archive 活跃名额，排队与清理失败任务计入总数；同步检查后立即登记，prepare 收尾释放名额，已完成 allowlist 独立缓存。FileArchiveModel 将 NativeArchiveFailure.cleanup_failed 显式转换为模块具名清理失败，不以普通 unknown 抹除生命周期事实。

Files 操作在准入后、串行排队前登记 active/inFlight，关闭和 quiesce 覆盖排队与执行，追踪到 finally 退订和解锁完成。尚未执行的排队请求取消不退役健康 Workspace，也不提前解除前序门禁；入场认证等待归既有 authorizing owner。跨 Workspace copy/move 的私有任务记录双端归属，任一端关闭取消任务，双端关闭都汇总关联清理失败；控制协议、任务 ID 和授权仍归原目标端。

Files 内部 FileDownloadSink<TPlan> 由 files/model/file-types 唯一定义，表达 plan/write/finish 应用能力。HTTP 构造 sink 并持有 response/drain/finished；Service 将 finish 放在原操作期限和 inFlight 内，交付前复查当前身份/owner/指纹，交付后原 run 再确认当前权威状态，ticket 只在完整操作成功后续期并随后释放 claim。不以 Service 字节迭代结束代替响应收尾。票据登记在读取及最终授权成功后，登记前再次同步核对具体 owner/取消；HTTP ticket 响应按 Shared 白名单投影，inline 20 MiB 硬预算只引用 Shared，技术对象不穿透应用 sink。

下载票据只保存原会话摘要及原 FileResource ID，重新打开相同 Workspace 不复用旧票据；claim 对外不暴露私有 digest Buffer/可变 lease。上传 byte channel 取得实例绑定的 append/abort 能力：append 持续认证，断开清理可在会话撤销后执行。SFTP scan 的 finally 覆盖 break/return；ZIP 消费者拒绝或取消时停止并等待生产者/读者收尾。供应商 stdout 使用增量严格 UTF-8 解码，不按 SSH packet 独立转字符串。

Remote Files 的流 attachment 绑定具体任务实例；prepare 配额由资源串行 mutation 边界判断。下载票据分别维护有效期准入与在途 claim 生命周期，过期不再接纳新请求，在途读取不因清扫被破坏。跨目标 move 的源变化检查与目录 ZIP 的持续身份复查归 Service；ZIP Adapter 只负责生产、消费和清理收敛，多项失败保留因果。源 metadata 检查不提供原子快照或条件删除保证。

归档解压的目录、普通文件和链接统一逐项发布，不以整树 rename 绕过子项复查；stage 根及中间目录的类型/规范路径检查归 Service，不能冒充原子 nofollow。新建目录集合仅是局部属性恢复状态，已有隐式目录不被重写。原生列表 EXIT 清理由 Adapter 确认，具名 cleanup_failed 经 Model 转安全 unknown，原操作与清理因果只留内部。HTTP 下载 Interface 持有覆盖最终 flush 的完整传输期限与取消监听；Service 的写入执行在 mutation 队列后重新核对身份、owner 与指纹。

## 8. 当前能力与验收

### B4.2 施工状态

B4.2 因素/Passkey 主链、v6 迁移、Shared/HTTP、登录联合与 Platform Adapter 已落源码，旧正式 Frontend/Backend/Protocol 未改。本轮安装依赖并修复真实静态失败，Shared/Backend-next/Frontend、根检查与格式门禁实际通过；四表、命令证据与未验场景归 testing。静态通过不能视为行为验收完成。B7 的动态 Settings、审计/通知和 F1 前端迁移仍未实施；实际 TOTP 客户端、RP、challenge 并发、回滚/断连、库升级均留 B10。v6 增加凭据 generation、匿名挑战来源约束与全局改密修订，最终签发事务复验 generation/counter/挑战修订；静态与行为门禁均不得用设计声明替代。

### B4.1 Access 验收界限

B4.1 已建立上述源码及安装配置入口，并完成 Review 纠正（入场例外、身份和时间边界、断连令牌、供应商 hostname、既有测试源码契约），当前静态结果归 testing，后续修改需按实际工作区重跑。B7 持久 Settings、审计/通知与在线策略更新尚未接通；B4.2 TOTP/Passkey 挑战已在新 Access 收口，密码登录对已启用因素仍拒绝降级，源码/静态已收口，仍待 B10 行为验收。全套 HTTP/WS、真实代理、受控验证码供应商、封禁并发、撤销后的长任务收敛和实机浏览器行为统一留 B10；正式 Frontend 仍消费旧 Protocol，按 F1 登记差异，不能宣称已切换。

### B3.2 施工范围

资源状态、Docker 和后台采样已接线，完整静态结果见实施方案/testing；正式前端 Shared 对接延至 F1，行为检查留 B10。当前施工状态与真实静态证据归实施方案/testing，不能把本段设计视为功能已通过。

### B3.1 设计与验收边界

本设计建立于原 `workspace.service`、`workspace-terminal.service`、shell integration、suspend coordinator/registry、ssh-suspend HTTP、log/xterm Adapter、现有 Files WS/transfer 与前端 WorkspaceSocket 实际消费者盘点；B3.1 源码及四表已收口，行为待 B10；Shared/backend-next check/build、Frontend build、根 check、格式和 diff 静态门禁须对应最终工作区重新运行。逻辑/故障/E2E 保留 B10，浏览器协议/反馈迁移与静态消费者差异进入 F1。

Workspace 的当前源码由唯一 sessions Service 持有：64 项准入覆盖 opening、detached、resuming、closing 和 cleanup_unknown；普通恢复使用同一 SSH shell、8 MiB journal、120 秒宽限及显式 workspace.resumeAck。独立 Remote HTTP/PTY 使用自己的技术 SessionService，复用 machines Model/Platform，不暴露用户 Workspace 的活跃 shell 或权限。

挂起标记、prepare/commit/unmark、lease/takeover、pending 恢复与历史由同一 Workspace 实例拥有；只为新 ID 临时登记别名，不另建 SSH shell。历史/checkpoint 经 History Model 转换到 Platform Port/Adapter，Shared 只传安全管理对象、请求及事件。suspend.resumeAck 与普通 ACK 独立，baseline 已发送不代表 ownership 已提交；准备/ACK 超时、WS 关闭和接管回滚原 owner，晚字节有界保留。

目录协作由 Shell Service 持有排队、替换、期限与事件；Shell Model 转换应用能力，Native Shell Adapter 构造 Bash/Zsh 命令、解析 PID/提示符和字节输出。每实例随机 marker 避免普通 stdout 充当 prompt；未完成探测而已接收用户输入时安全拒绝迟到注入。真实登录脚本、前台程序与并发提示符行为仍待 B10。

日志由技术 Adapter 串行 append/read/compact/delete，绝对 offset 不随 100 MiB 可见窗口裁剪回退；checkpoint 和 renderer 的技术资源通过 Model 隐藏。日志导出在 Service 对每个最多 64 KiB 的块复查身份和实例，技术分块归 renderer Adapter；取消与清理失败分别判断，不能把 allSettled 的完成当作释放成功。历史前页交付成功并复查原 cursor 后才推进。HTTP/WS 管理视图共用 suspend-view 白名单；当前身份、attachment/generation 和 45 秒租约在异步边界复查，2 秒 sweep 不代替实时授权。关闭、背压、导出和失败边界见第 7 节与下述当前范围。

B3.1 源码收口不等于行为验收。实际类型、构建和格式结论以 [B3.1 收口证据](../testing/后端重构待实机验证.md#b31-源码阶段最终收口) 为准；真实 Bash/Zsh、SSH/SFTP、磁盘背压、双 ACK/接管、VT 模式、日志导出和故障恢复均待 B10。正式前端仍未消费新的双 ACK/Shared（F-R10），完整 Access/IP/2FA 源码已收口、行为待 B10。

Access/Targets/Remote 基础切片与有限 Agent 状态已具备源码；未实现能力见职责表。Remote Files 已同时具备 B1 新 HTTP 读写能力及 R1 旧 Workspace Files 子协议源码：编码写入/独占新建、list/search/stat、binary read/cancel、递归/force 批量删除、rename/chmod/realpath、ready/error 均有真实调用链；A-04 machines owner、SFTP 技术失败边界及 Files Service/Model 职责已收口。R1 行为验证未运行，真实 SSH/SFTP、故障窗口和旧消费者全链路仍待 B10。

R2-01–R2-05 的源码缺口已修补：背压/final 纳入同一操作截止时间，心跳按实际资源 owner 验证并续期，Workspace 64 与独立 Files 8 的预算分别计数；WS authorize 的身份查询异常沿技术握手返回服务不可用而非伪装未登录；PTY 定时/EOF 身份查询异常与正常拒绝分开，所有 unsubscribe 与 release 失败聚合进入原关闭追踪。以上仅是源码/静态完成，B10 的长背压、撤销、故障及容量行为尚未执行，不能标为已验收。

B2 下载/上传/copy/move/目录 ZIP、原生归档、密码与进度、属性及链接恢复的源码已收口；D12/D13 的部署取舍已确定，B2-V01–V66 全部待 B10 行为验证。Files 子协议不等于完整 Workspace 已迁移：完整 reconnect/resume、Terminal/挂起恢复的 B3.1 源码已收口、行为待 B10；status/docker 的 B3.2 源码已收口、行为待 B10；RDP/VNC 的 B3.3 源码复审已矫正，本轮最终静态通过，行为待 B10；完整 Access/IP/2FA 源码已收口、行为待 B10。按明确决定，旧 writer 的隐式 metadata 失败容错不在后端保留，正式编辑器的显式失败处理转 F1。Agent Shared、六个 HTTP 与开发前端源码消费者已接入；真实浏览器与故障行为仍待验收，不能因静态通过就声称正式通信迁移完成。

**B3.3 RDP/VNC 新后端源码**：`remote/desktop/service/desktop-service.ts` 持有单次短期 ticket、pending/opening/active 限额与当前 Access/Targets 版本、周期复核及精确关闭实例；`remote/desktop/model` 显式转换 Targets 的可信配置/解密快照与 Platform 技术请求。Targets 的 Desktop resolver 在同一 SQLite 只读事务获取连接/密码密文，Targets Model 持有 `SecretBox` 技术解密与应用转换；独立 v4 migration 增加 recent attempt 时间字段，版本不随单纯连接尝试变化；RDP/VNC 的 `credentials.set` 允许密码但拒绝 SSH key。Guacamole 技术 Port/Adapter 独占 guacamole-lite 1.2.0 与 guacd：独立 raw WS 仍由统一 Platform HTTP origin/upgrade owner 接入，内部 AES token 仅含一次 bridge ID，真实密码和远端参数只在适配器私有映射内。`POST /api/v1/connections/:id/{rdp,vnc}-session`、`WS /ws/remote-desktop` 和 Shared `remote/desktop` 均已接线；双端正式消费者仍留 F-R12。B3.3 功能/类型/生命周期详细八节见 [远程桌面专题](REMOTE_DESKTOP.md)，源码/静态进度和 B10 未验证单列实施方案与 testing，不以接线作为验收。

产品行为与容量以 [USAGE](../USAGE.md) 为准，当前工作见 [实施方案](../后端重构下一阶段实施方案.md)，未执行真实专项见 [待实机验证](../testing/后端重构待实机验证.md)。新后端独立 check/build，Shared 与实际双端消费者同步检查；架构审核按模块模板和工程经验执行，静态通过不能证明真实 SSH、并发、清理与浏览器验收完成。

B3.3 实施复核已修正实际注入接口：`registerRemote.targets` 精确包含 `desktopTargets`，Desktop Failure 位于同一子功能独立错误 owner；Targets 密码凭据内部命名统一为 ConnectionCredential（password 用于 SSH/RDP/VNC，SSH key 仅允许 SSH）。Desktop Service 只消费 Model 创建的 DesktopPeer，WS/HTTP/Port 句柄不越过 Model；Targets 内部 ResolvedDesktopTarget 与 public TrustedDesktopTarget 分别定义并经 public-mappers 白名单转换。Guacamole 原始设置有明确的媒体与 DPI 默认值，第三方自带 SIGTERM/SIGINT 回调撤除，由 Bootstrap 和 Remote Service 统一决定收口；Guacamole Server 的 `close` 不等于底层 guacd TCP `close`，技术 Adapter 在真实 socket close 才通知 Service 可计为终态。Platform HTTP raw WS 在技术 unknown 时不无条件删除 active socket，完整关闭仍保留故障因果。此前 store lock 阻断属于历史环境；本轮按 frozen lockfile 离线安装成功，当前实际静态证据归 testing，不沿用旧 PASS。

当前实施顺序为完成全部保留后端功能及后端最终环境验收，再启动前端对接。后端 HTTP/WS 通过 Shared 与实际协议消费者核对，行为回归按实施决定统一留 B10；已有 DEV 前端未验收，不作为后端功能完整或正式迁移完成的证明。

B3.1 当前关闭/导出边界：Workspace Service 跟踪导出准入、60 秒完整期限、交付 sink 及实例关联取消；HTTP Interface 持有 response/pipeline，History Model 暴露应用字节源与可等待释放，Platform 只提供技术流/VT 操作。全 Remote 导出最多 2 项，清理失败保留名额。checkpoint dispose 返回共享 Promise，参与关闭确认；临时日志删除及渲染释放的具名技术失败经 Model 转为模块清理失败，HTTP/WS 都输出 operation_unknown。模块各独立 owner 并发关闭，30 秒确认截止不代表真实任务结束，晚任务继续观察；应用整体验收仍待 B10。
