# Shared 架构

远端工具错误 `remote/tools/values` 包含 connection_unavailable，表示建立 SSH 连接时的具名原生网络不可达，HTTP 为 503；不与权限、主机信任、工具缺失、安装失败、清理未知或通用 unavailable 混用。后端 Adapter→Model→HTTP 与前端严格解码使用同一取值；只有传输的只读检查可由前端实际消费者延后到逐目标任务结算，安装阶段不因此继续。不将技术错误正文或准备状态放入 Shared。

正式前端已消费当前 Shared；完整远程基线的 SHA、后继修改与未验范围见 [E2E](../testing/E2E.md#当前验收基线) 和 [PLAN](../PLAN.md)。下文 B 阶段编号仅保留设计定位，不代表当前施工进度。

当前设计同时记录尚未纳入全量验收的专项实现；新增目录选择、依赖安装和基础组件接入不自动纳入上述历史验收基线。产品行为见 [USAGE](../USAGE.md)，源码、静态检查和待验范围分别见 [PLAN](../PLAN.md) 与 testing。

本文按 [模块模板](MODULE_TEMPLATE.md) 定义双端契约职责。人工约束见 [HUMAN](../rules/HUMAN.md)，开发入口见 [AGENTS](../AGENTS.md)。

## 1. 职责与范围

### 容量取值与分页集合

1. **职责与范围**：Shared 持有双端实际消费的设置范围、传输期限、归档密码和单次协议预算；历史保留、缓存及技术流窗口由各实际 owner 持有。
2. **子功能与目录**：沿 preferences/presentation/values、preferences/{commands,favorites,history}/http-codec、agent/execution/values 与 remote/{terminal,files,transfers}/values；不新建全局万能 limits 文件。
3. **依赖方向**：前端控件/运行时、Shared codec、后端纯应用规则/存储解码共同引用基础取值，不以 Shared DTO 代替应用或存储对象。
4. **类型与转换**：Presentation 数值范围以同一字段名的 min/max 定义，独立各层对象投影保持；分页 offset/nextOffset 使用安全非负整数与原请求关联，不再绑定集合总数。密码按 Unicode 码点，字节预算继续按 UTF-8 完整编码计算。
5. **入口与安装**：沿既有偏好、快捷命令、标签与收藏 HTTP/前端分页消费者，无新路由或旧协议兼容；Shared build 先于双端检查。
6. **数据、事务与并发**：分页集合不设固定总条数；单页与请求/响应编码预算仍生效。组删除动态接收完整成员快照并同事务校验后删除；单命令标签数与批量关联单次预算仍按现行 Shared。移除收藏与命令/标签创建的总数 COUNT，不改变身份/版本/引用事务核对。历史保留政策不混作分页读限制。
7. **生命周期与失败**：前端等待从服务端 Shared 总期限派生并保留现有交付余量，超时仍不证明远端结束；Agent 的 Run/模型并发配置仅受正安全整数表示约束，实际活跃准入使用管理员保存的预算与硬限制；默认预算4/2与默认硬限制8/8保持，不自动增额。模型请求数同样只保留正安全整数表示边界，默认预算80/默认硬限制400与管理员可调整范围分别持有；步骤索引AGENT_RUN_STEP_MAX_INDEX、工具元数据解码、治理和SQLite解码同步，不再另有固定400步门槛。其余可编辑额度同样移除默认值构成的固定上界；只有活动/工具整秒使用Node与SSH的2147483647ms实际计时器表示边界，Artifact期限使用Date表示边界。默认预算及默认硬限制仍归Backend策略；Artifact总空间/长度/Range随安全整数范围同步，完整编码容量独立保留。未派发/未知及原资源 owner 收尾保持。
8. **当前能力与验收**：产品说明、真实 UI/API/Model/Adapter、codec 与测试消费者同步；不更改视觉设计，不宣称动态数量等于无限内存容量。静态与未执行行为分别见 PLAN/testing，执行 D17。

**Agent Provider**：新增 Provider 管理、模型能力来源/冲突、models.dev 能力注册表、OpenAI-compatible 发现与真实测试的双端线契约，以及 Run 创建的模型选择引用；仅传公开视图（`hasCredential`、版本/修订），不传明文或密文。不让 Shared 持有 Run 的内部不可变冻结存储、模型 SSE、网络失败原因或内部冻结的执行政策。

因素的双端新增范围是密码成功后的 `requiresTwoFactor:true`、TOTP setup/verify/disable/二次登录、WebAuthn 的 options/verify、Passkey 发现/列表/改名/删除。Shared 不持有部分会话密钥、challenge 的服务端归属、TOTP secret 密文和签名算法；完整授权仍须 Access 验证。

`packages/shared` 持有前后端同义同表示的基础取值、业务对象与完整通信契约；不持有后端秘密、权限状态、存储行、技术连接或 UI 草稿。正式认证、Targets、Workspace及已完成的配置管理均已消费 Shared；Agent的Registry、Provider、执行设置、App治理、集成/Browser管理也已接入，正式Agent Host/Run、正文、审批、Child、Step/Tool与插件SDK也已消费Shared；Frontend已移除Protocol依赖，旧 Backend 已移除，原实现从 Git 历史追溯，不被当前运行时调用。

Access 的双端范围是管理员初始化、密码登录、明确的认证状态、改密/登出、CAPTCHA 公开配置与黑名单读/解除；Shared 只规定传输形状/预算/有限值，真正身份、IP、失败阈值、因素生效、事务及来源信任由 Access/Platform 负责。正式前端已消费基础认证与TOTP成功codec，TOTP设置/改密消费者已接入，Passkey严格options/列表/成功联合codec归access/factors/passkey-codec，8MiB完整响应预算归access/values，后端options/列表与前端transport均消费；Auth浏览器Adapter显式投影，Security映射列表本地时间。黑名单完整页256KiB预算同样归Access values并由实际生产者和消费者引用；其余正式业务消费者已完成源码对接；行为覆盖范围统一见测试入口及 PLAN。

核心设置的 GET/PUT、CAPTCHA 专项 PUT、安全视图、secret keep/clear/replace、CAS 与 saved/effective 激活状态归 Shared preferences/configuration；公开 CAPTCHA 读取复用 Access 契约。后端生产者及正式CAPTCHA/IP/采样配置面板的Preferences transport/mapper已消费；Dashboard消费启动生效监控投影。公开CAPTCHA读取不替代管理快照，其他Preferences正式消费者已接Shared，本轮完整行为仍待远程回归。

审批线协议的时间为整Unix秒，HTTP mapper从毫秒向下取整。同秒内的请求、决定、消费及到期可以投影为相等，codec只拒绝整秒倒序与不一致状态；真正批准/派发的严格毫秒有效期仍由Backend原事务核对，不能把展示精度当作授权期限。

## 2. 子功能与目录

### 单连接更新的凭据意图

1. **职责与范围**：targets/connections拥有双端消费的连接更新请求；不公开秘密存储表示。
2. **子功能与目录**：沿http.ts与http-codec.ts，复用TargetCredentialInput和现有credential解码。
3. **依赖方向**：Backend HTTP与Frontend API共同消费Shared；Shared不依赖应用Model或SQLite。
4. **类型与转换**：TargetConnectionUpdateRequest新增可选credential，字段省略表示保留、null表示清除、有限对象表示替换。codec区分缺字段与显式undefined，拒绝额外字段；应用/存储仍分别白名单转换。
5. **入口与安装**：现有PUT连接请求消费；独立凭据端点及批量消费者保持真实用途，不保留旧单编辑双保存分支。
6. **数据、事务与并发**：version与changes和credential绑定一次CAS；Shared仅定义意图，原子性由Backend SQLite保证，无新增协议预算。
7. **生命周期与失败**：既有安全错误和未知结果语义沿用，密码仅在写请求，不加入连接视图、凭据摘要或错误正文。
8. **当前能力与验收**：双端、editor/store、脚本和测试消费者同步；静态与定向行为证据见testing。

### 远端依赖契约

`remote/tools/{values,model,http,http-codec}` 精确导出有限工具/包管理器/提权/安全失败、检测与安装对象和严格 unknown 解码。检查以 tools 或 transfer 联合表达；transfer 由后端根据真实对端凭据决定 sshpass，auto检查默认rsync，客户端明确跳过安装后才检查SCP。tools/values的archiveToolRequirements由前端准备与后端ArchiveModel共同消费，覆盖格式压缩器及核验/快照/发布辅助工具；transfers/values的归档工具取值同步包含gzip/bzip2/cp/ln/grep，严格失败codec保留实际缺失名称。安装只接短期 planId 与可选单行密码，不接 shell/任意包名。完整请求 64 KiB、响应 16 KiB、密码 8192 UTF-8 bytes，包含 JSON 最坏转义余量；计划 ID、目标及缺失工具关联由 codec/客户端分别核对。内部指纹、会话摘要、机器句柄和计划 registry 不公开。remote/mutations 的来源增加 tools，实际后端围栏和前端恢复面板共同消费。

`agent/tools/{values,model,http,http-codec}.ts` 持有有限状态、安全工具列表投影、线程工具分页与认证单调用详情。实际消费者是后端 HTTP 与前端 `native-tools-api`/聊天工具卡片；线程列表使用 `before:createdAt:id` 游标，单项使用 App/Run/Tool 身份关联。`AgentToolCallDetails` 允许读取原模型 `argumentsJson` 和安全 `failureCode`，不含注入凭据、原始结果正文或 providerCallId。旧步骤/工具事件审计接口与对应分页已移除；内部执行账本及恢复事件保留在后端。

`agent/scope` 持有 App 实例 UUID 与受信 definitionId/version 的不同语义、enabled/version/毫秒时间、声明摘要、CAS 输入和完整列表/单项 codec。唯一执行状态基础值在 scope/values；governed 仅表示治理执行政策，不表示 running/healthy。App 及声明仅由真实签名插件安装创建，无手工创建请求、默认来源或内置声明；声明目录按当前账号的真实安装查询。

`agent/providers/{values,model,http,http-codec,registry}` 是 Provider 输入/可见模型/显式来源、严格 unknown 解码、测试联合与远端 Registry 状态的唯一 wire 归属；能力字段名、能力来源和协议取值统一归 providers/values，内部应用/存储引用这些基础值，各层对象仍独立投影；`agent/runs/http` 创建请求增加具名 `model.providerId/modelId/configurationVersion`。Provider 完整响应最多 8 MiB（超限 limit_exceeded）、请求单条最多 128 KiB、单 Provider 最多 128 模型、发现最多 1000、秘密输入 ≤8192 UTF-8 bytes、URL ≤2048、modelId ≤512，完整集合和嵌套观察均计入响应预算。正式Provider管理已消费该契约，Host/SDK已消费当前Shared契约，不导入旧包。 Registry默认能力包含工具、图片、文件、缓存键及推理等级/默认等级/必需标记；`http-codec`严格验证布尔、唯一等级和默认等级所属，`reasoningMandatory:true`依赖非空等级。名称匹配与明确模型修正规则留Backend，手机折叠和本地草稿保护留Frontend。

`access/factors/http.ts` 定义因素请求的 unknown 解码、有限 token/名称/credential 字段、公开 TOTP setup 与 Passkey 摘要；`access/values.ts` 新增 HttpOnly partial/challenge/TOTP setup Cookie 名和 300 秒临时生命周期、`limit_exceeded` 等具名错误；`access/http.ts` 将密码登录结果扩充为成功用户或 `requiresTwoFactor:true` 的判别联合。标准 WebAuthn OPTIONS 的 RP、user、algorithm、credential descriptor 先由后端 Model 投影为具名应用类型，再经 Interface 白名单转为 Shared `access/factors/http.ts` 响应类型；已验证的 browser credential JSON 先由 Shared unknown codec 严格校验必要字段，再经 Interface 转为 Factors 应用证据，由 Model 显式转回技术 Port 所需表示。Provider 对象与存储公钥不进入 Service/Shared。

`access/values.ts` 统一持有后端会话 Cookie 名 `nexus_session`、rememberMe 30 天 Max-Age、CAPTCHA token 4096 UTF-8 bytes、黑名单分页最多 200、CAPTCHA provider 有限值以及登录/来源/供应商的具名安全错误。`access/http.ts` 为 setup/login（可选 captchaToken）/status（成功 200 `isAuthenticated:true/user`；未认证 401 安全码）/改密/logout/公开登录选项（CAPTCHA、OIDC名称、Passkey可用性）/黑名单管理提供请求、响应和 unknown 严格取值；`access/model.ts` 只保留前端可见用户名/id/双因素标志。秘密、SQL 行、封禁策略快照和会话 digest 不属于 Shared；验证码供应商技术参数不进 wire。正式 Auth基础认证与DEV现共用Shared传输，`access/factors/http-codec.ts`持有TOTP登录、setup与changed成功的严格投影，setup完整JSON预算64KiB（含PNG QR）归values；基础认证完整JSON请求/响应通常各16KiB，聚合公开登录选项响应32KiB，预算均归values；Passkey管理沿独立契约。Passkey与CAPTCHA/IP安全配置的正式消费者已接Shared；其他Settings和业务源码已接Shared，完整行为验收仍独立记录。

system/status 同时拥有 SystemHealthResponse、固定健康取值及 readSystemHealthResponse 严格解码；后端 /api/v1/status 为生产者，现有 Docker/smoke 是路径与对象的真实消费者，尚未迁移为 Shared codec 消费者。内部 SystemHealth 独立定义并在 HTTP 白名单投影，不公开采集句柄或数据库事实。

新增 `remote/monitoring/{values,model,http,http-codec,events,workspace,workspace-codec}`、`remote/docker/{values,workspace,workspace-codec}` 和 `system/status/{values,model,http,http-codec}`。基础取值与对象隔离；Docker action 为唯一有限值，技术 Port 仅精确引用 values，不引入 Shared DTO。远端、本机事实分别定义，不通过大量可选字段混成全局状态集合。

`remote/desktop/{values,http,http-codec}` 持有 RDP/VNC、显示范围、30 秒 ticket、1,024 pending/16 active、有限安全码和 2 MiB 二进制帧上限。HTTP 成功严格为 `{ticket,protocol,host,port,username,password}`，完整 JSON 最多 64 KiB；凭据仅供用户已接受的浏览器 SDK 内存消费，响应 no-store，不进入 URL、日志或持久存储。path/query 拒绝未知、重复或非十进制参数，成功/失败 codec 核对完整白名单、容量及 43 字符 ticket；前端另核对请求协议。秘密字段容量引用 Targets values，不 trim。RDP 初次请求可无 body 或传 certificate=null；明确确认以独立 RdpCertificateApproval 写入 host/port/fingerprint/previousFingerprint/remember，未确认响应为 409 certificate_required 和 RdpCertificateView（connectionId、目标、证书主体/颁发者、SHA-256、原指纹、有效期 Unix 毫秒及有限原因）。严格 codec 核对完整白名单、指纹格式及 changed 与原指纹的关联；前端另核对 connectionId/协议。挑战无票据或密码，JSON 沿原 64 KiB 完整预算；Shared 不持授权、证书验证、持久信任或自动重试政策。后端仅取得不含密码且带已确认指纹的 TCP/TLS 技术请求，握手/关闭和队列策略归实际 owner。RemoteApp 契约已删除，完整调用链见远程桌面专题，新证书流程的行为仍待远程验收。

```text
packages/shared/src/<domain>/<feature>/
  values.ts          基础取值、错误码、真实双端容量
  model.ts           双端业务对象
  http.ts            完整请求/响应
  http-codec.ts      确有需要的纯解码
  events.ts          WS/事件契约与必要纯解码
```

Shared已建立Access、Targets、Remote、Agent、Preferences、Operations与System契约；正式消费者按功能分别迁移，不能因存在契约就宣称双端完成。子域按业务语义划分，无实际内容不创建空文件。Agent 使用 `agent/scope`（App/Thread）与 `agent/runs`（有限 Run、变更结果及事件分页）；共同安全码、UUID 取值和完整 JSON 字节预算在 `agent/values.ts`，共同错误响应与纯解码在 `agent/http.ts`、`agent/http-codec.ts`。持久事件对象在 runs/model；runs/events 持有原生 Run 变更订阅。

Remote Files 的 `remote/files` 同时承载只读与 mutation 双端契约：model 保留文件安全对象；http 定义 open/list/stat/read-text 及 write-text/rename/remove/mkdir/rmdir；values 定义路径、目录 metadata、16 MiB UTF-8 文本、完整 JSON wire 预算和安全错误；codec 从 unknown 严格解码。HTTP 路径/条目与 SFTP 一致保留 POSIX 合法的换行、制表符和反斜杠，拒绝 NUL、替换字符和非法 Unicode；路径须绝对，条目名不能包含 `/` 或为 `.`/`..`，不因合法特殊名称使整个目录不可读。files/text-codec 是文件字符串 Unicode 校验的唯一 owner；HTTP、Workspace、Transfers 的纯解码和后端路径政策复用，避免孤立代理字符在 UTF-8 编码中被替换成另一文件名。

Remote Workspace 的共用 envelope、connect/resume/close/ACK、NXW1 帧编解码与容量统一归 `remote/workspace`；`remote/files/workspace.ts` 仅承载 Files 子协议，terminal/suspend/transfers 各归其子域。NXW1的正式前端WorkspaceSocket、Backend生产者及OpenSSH夹具已消费Shared；前端重复协议文件已删除。正式Session的connect/resume/close已消费严格结果codec与独立workspace.resumeAck；WorkspaceAttachment持有普通/挂起共用附件字段，普通connect/resume另有必填replayedBytes，不为旧消费者保留缺字段兜底。terminalOffset为journal端点，replayedBytes定位交付起点；Unix秒仍由前端mapper明确转应用毫秒。Workspace共用响应采用成功/失败判别联合，有限安全码同时容纳实际Files/Observation失败，容量拒绝统一limit_exceeded。remote/terminal/values持有目录切换有限失败取值，workspace-codec严格解码输入、resize/flow、目录成功/事件和终端关闭/故障；正式终端消费者已接入，挂起独立ACK和监控/Docker WS已接入；桌面及整体页面已接当前契约，行为通过范围按 testing 的实际场景记录。Shared 是唯一共享契约包；旧 `packages/protocol` 已删除，历史定义从 Git 追溯，不保留旧路径转导出。

待实施设计：各子域增加实际通信需要的 `http-schema.ts`，协议类型与运行时 schema 使用同一契约来源，业务对象仍归 model，基础取值仍归 values。模块 interfaces 将 schema 关联实际安装路由，汇总生成 OpenAPI；WebSocket 消息另按 AsyncAPI 组织。尚未实现，见 PLAN 的待验与外部依赖；目前手写 codec 不等于已有自动生成能力。

WebAuthn 创建/请求的 User Verification 均要求 `required`，与服务端验证一致；已知不匹配的 challenge、Origin、RP hash 和 UV 等在技术 Adapter 明确归无效，尚无法由供应商具名失败证明的异常只作不可用处理。HTTP 复用单一的可选字段转换过程，TOTP setup/Passkey options 已提交的挑战在响应最终 finish 之前遭遇断连时撤销，不交付未确认的 challenge Cookie。

`preferences/configuration/{values,model,http,http-codec}.ts` 分别持有有限取值/容量、安全对象、完整命令与响应、unknown 严格解码；每个文件精确 export。请求/响应64 KiB、白名单16 KiB、CAPTCHA key1024 bytes、最多16站点，监控周期1–86400秒；不公开明文/密文，写入secret采用显式意图。SettingsView必填effectiveMonitoring，只读投影本次启动的两项监控周期；version与effectiveVersion相等时须与已保存policy一致，写命令不接受该字段。不接受旧缺字段响应。

`system/backups/{values,http,http-codec}.ts`已持有加密导出的JSON请求、安全失败及64MiB载荷/100MiB文件/Access统一1024-byte密码/64KiB请求预算，并精确export。生产者为 System 已安装导出和导入 HTTP；导入使用 multipart backupFile/password，成功回执为 restoredTables/restoredRows/restoredFiles/cleanupPending，字段与严格 codec 同属 system/backups，multipart 总量为 100 MiB 文件加 64 KiB 封装预算。正式备份Panel/全局恢复Store/API已消费，独立应用回执经白名单转换；宿主诊断由正式数据页消费Shared system/diagnostics。加密头部、表行、敏感字段、密钥、暂存文件和恢复 journal 不进入 Shared；源码不等于恢复行为已验收。

Registry的状态与解析响应严格codec归`agent/providers/http-codec`，有限来源取值与安全错误归values；状态解码核对来源/快照字段一致性与可安全转换的秒时间，能力解码保留未知、拒绝额外字段与重复推理取值。正式状态卡片及Provider页模型查询已消费这些契约；内部缓存/etag、供应商正文与请求生命周期仍不进入Shared。

插件descriptor消息容量与frontend RPC完整预算同源，核心storage/intents预算仍独立；不能用描述符的旧核心子预算限制完整Agent结果。

Artifact的完整storage/cleanup/attachment响应codec由正式文件库、附件选择器与引用编辑器消费；bytes/哈希/版本关联仍由持请求上下文的前端transport完成。插件管理/仓库/迁移/运行态及frontend RPC契约已有正式前端消费者；iframe桥转发Shared协议，UI展示配置与descriptor仍映射为独立本地对象，不复制旧SDK取值或构造旧Envelope。

## 3. 依赖方向

HTTP 从 Shared 解码请求，Provider Model 对应用数据与 SQL/第三方事实逐字段转换；Platform 的模型/Registry Adapter 不导入 Shared Agent DTO。`providers/registry.ts` 的模型目录是管理员读/刷新/解析接口，存储缓存、etag 和失败状态不是浏览器可写对象。Shared 只定义明确信任层之间真实使用的取值，不能当后端内部 Service/Storage 的代用品。

HTTP 对 unknown body 调 Shared `access/factors` 解码，再传应用 Service；成功响应由应用→HTTP 逐字段构造。Shared 不导入 `@simplewebauthn/server`、Node crypto/SecretBox 或 SQLite；Platform WebAuthn Port 仍是技术侧唯一协议语境，不借用 Shared 的业务用户类型。正式前端已消费该契约并删除旧Protocol依赖。

Access 的请求字段、错误与容量唯一来源为 Shared；后端 HTTP 接口消费 codec 并逐字段生成响应，Service 使用所属内部类型，技术 Adapter 不导入 Shared 业务 DTO。Platform HTTP 仅提取受信源 IP/Origin/Cookie 字符串，不持有 Access 策略或产品身份对象。

Shared 不依赖 Backend、Frontend、具体 Adapter 或运行时；不访问数据库、网络和环境。values 与 model/http/events 隔离；Platform/业务 SQL Adapter 仅可精确引用确需共用的基础值，不能借 Shared 导入业务对象。package exports 明确列出真实入口，不靠内部深层路径消费。

Run 创建请求必填 connectionIds（最多 50 个唯一正整数），与 model 一起由后端严格解码。空数组不是授权；不存在缺字段兼容。工具轮允许零正文，最终 stop 仍要求正文。参数、结果正文、供应商调用身份与 reasoning 不进入 Shared；正式模型/目标选择器及多步 UI 已消费当前契约。

Agent新增的模型私有诊断/文件/Shell/Docker工具输入、结果、后台Job状态及RemoteMachineOperations后端出口没有前端HTTP消费者，留对应Backend应用/public owner；不因工具目录增加就在Shared复制其内部对象。聊天工具列表与单调用详情消费现有 Shared 工具契约。后台Shell的公开工具completed仅表示受理回执已持久化，真实执行状态归独立Job；不把受理解释为进程健康或Root成功。前台Shell等待到期也返回原Job，yieldSeconds及Job分页仅属于后端/模型工具协议。Run/tool安全失败取值在agent/runs/values统一增加tool_machine_busy/tool_machine_blocked；HTTP codec与持久解码复用该有限集合，前端NativeToolCallDetails及AgentAppSurface沿原错误区域映射三语文案，不新增UI。

项目目录工具与机器突变占用仅有后端模型/Remote 消费者：ProjectScope/Binding/Guidance 与 claim/storage 留各自内部 owner，不建立 Shared 目录正文、凭据或 row。工具状态与 Remote 安全错误继续双端消费；机器突变恢复接口及解除证据已由 `remote/mutations` 契约和正式恢复面板消费。

Agent Run/Tool 的有限安全原因包含 tool_result_unconfirmed：任务已停止，远端执行结果无法确认，需核对远端后再决定后续操作。后端 Job 事实经 RunModel 投影，HTTP/WS 和持久诊断解码复用 runs/values，前端原错误区域提供三语文案；不把内部 Job 的失败回调或执行对象加入 Shared。

## 4. 类型与转换

`agent/governance` 持有 target-denylist 请求/响应、50 项上限、512 Unicode 码点/2048 bytes 原因预算。目标 IDs、CAS 与完整响应严格解码，拒绝原因只作安全用户说明。内部批准 capability、目标 generation、SQL 和运行时资源不进入 Shared。后端 HTTP 是当前实际消费者，DEV 使用已有插件 App UUID；正式 App 管理与目标名单界面已消费这些契约。

区分手工配置、Provider `/models:nexus_capabilities` 观察和远端 Registry 来源。Provider 可见 `models[].capabilitySources` 明示手工配置，`providerCapabilities` 提供有版本/来源的观察，`capabilityConflicts` 表达两者不一致；发现字段缺省不假定 false/zero；`reasoningEfforts/defaultReasoningEffort` 必须为受限取值且默认值在支持集合内。Run 模型选择版本必须正整数；冻结对象包含协议/模型能力/凭据代际，仅在 Run 内部读取，不是 Shared 公共响应；其 `governed` 不能替代 enabled、当前权限与冻结预算。

Provider 手工能力与供应商观察独立，未知不补 false/zero；只有双方明确提供的值才报告冲突。Shared 对象经 HTTP mapper 转内部应用对象；技术 JSON 不进入 Shared。

Factors 注册/认证 JSON 请求预算 128 KiB、证据字段 96,000 bytes、凭据 ID 1024 bytes、名称 128 bytes、transports 最多 16 项且每项 32 UTF-8 bytes，唯一常量归 access/values。内部应用仍保持独立类型与 Model/HTTP 白名单转换。正式因素管理与登录消费者严格解码成功/失败契约并核对请求上下文。

TOTP code 限定 6 位 ASCII 数字（纯边界上限再由应用验证）；密码/Passkey 名称限定 UTF-8 字节，WebAuthn credential JSON 明确读取 id/rawId/type、认证器签名或注册 attestation、extension 结果及有限公共字段。注册/认证完整输入最多由后端 HTTP 128 KiB 读取预算保护，解码不接受任意额外顶层字段；Provider 生成的 OPTIONS 由 Model 显式转换为浏览器 public 字段。Passkey 列表时间对外 Unix 秒，内部存储毫秒，不含 publicKey/counter/secret。

Access `readAccessLoginRequest` 只允许 username/password/rememberMe/captchaToken；黑名单 query 的 `limit` 默认为 50、`offset` 为 0，拒绝重复或未知查询键及非十进制整数；删除请求显式使用 JSON `{ip}`。公开 CAPTCHA 返回启用标志、provider 和两个站点公钥字段，不含 secret；提供严格响应解码。status 未认证 401 返回 `{code:'unauthenticated'}` 供已存在的 DEV Auth client 正确识别，成功 200 为 `{isAuthenticated:true,user}`，不能折叠成 `user:null` 取代 isAuthenticated。后端即使返回字段同名仍保持应用/public/HTTP 三处各自一次白名单投影。

同义同表示的有限取值只定义一次；内部应用表示不同则保留独立类型并显式映射。后端 Service 不把 Shared HTTP/WS 当内部用例类型；公开后端能力可引用消费者需要的 Shared 对象，但逐字段出口投影仍保留。输入从 unknown 解码并执行所属协议真实校验；“严格”不等于擅自收紧旧有效协议，旧入口明确允许额外字段时 codec 只提取已知字段。完整联合结果与安全错误响应都定义，不只迁出成功 DTO。

协议容量是实际 UTF-8/帧字节预算，包含外壳与转义；后端与前端消费相同定义。私有队列、缓存、重放和关闭策略不自动成为 Shared；共享产品限制需有实际契约用途。身份来自认证，不接受 wire 自报 userId。

Remote Files 小 JSON 请求仍为 16 KiB，路径 ≤4096 UTF-8 bytes，目录 ≤200 项/48 KiB metadata。文本原文 ≤16 MiB；write-text 另按最坏 JSON 转义推导完整请求预算，文本响应按最坏转义推导完整响应预算。Shared 的 `expectedSha256`、`conflict` 和 `operation_unknown` 只描述公开语义，不把 hash 预检升级为远端原子 CAS，也不承诺 unknown 已回滚。

transfers values 同时定义 HTTP inline 预览的 20 MiB 硬预算，后端实际路由消费 WORKSPACE_TRANSFER_MAX_INLINE_PREVIEW_BYTES；前端各文件格式的更低预览读取预算有独立语义，不能合并成这项 HTTP 硬限制；正式预览/下载消费者已接 Shared。ticket 的公开结果与完整严格codec归transfers/http、http-codec；固定相对URL、300秒TTL及32KiB完整JSON预算归transfers/values，实际路由/票据owner/正式下载port共同消费。路由message与Platform code是两个实际生产者的失败envelope，均采用有限取值，前端分别解码并核对状态；不按正文判断结果。Interface逐字段投影；应用 sink、final flush、claim/owner 追踪不新增 wire 字段。

transfers/workspace定义完整Upload请求/回执/事件及精确request/response/event map；workspace-codec严格读取prepare根计数、start受理、stop布尔值及七分支事件，校验顺序字段、进度与字节关联、完整FileEntry和安全有限失败。Frontend的原任务owner额外验证目标、声明量、实际发送量、块序号与原附件；Shared不持浏览器File/socket、重连策略或临时任务状态。stop只表达取消受理，完整终态才表达任务结果。后端应用事件保持独立类型并在WS边界逐字段投影。

Remote Files 的路径字节容量由 files/values 唯一定义，transfers/values 以 WORKSPACE_TRANSFER_MAX_PATH_BYTES 引用同一值，保留协议语境而不复制数字。传输派生完整路径由后端 Service 校验；这一约束不扩大到原本不使用该预算的旧 Workspace 基础文件契约。任务 finished、清理失败追踪、名额保留与 attachment 实例绑定是私有生命周期，不增加 Shared wire 字段。

R2 没有新增双端 wire 字段或重新定义容量：Workspace附件与独立HTTP Files由各自后端owner追踪生命周期，不再以固定资源计数拒绝，不能错误迁入Shared；`FileBinaryPiece` 和有效取消/期限交付属于 Remote 内部应用契约，NXW1 frame 仍只归 Shared binary encoder。

已建立 `remote/transfers` 子域：`http.ts`/纯 `http-codec.ts` 定义 download-ticket 的真正前后端 body/结果，`workspace.ts`/纯 `workspace-codec.ts` 定义 upload.prepare/start/cancel/abort、二进制 upload stream 参数及 copy/move、archive 的请求与完整事件。ZIP/Range 是已定义的 HTTP 行为，单独使用 Content-Range、Content-Disposition 和状态码；server-side ticket、task map、WebSocket 技术队列上限、SFTP lease、私有目录扫描配额不能伪装成 Shared 双端业务对象。旧 archive WS 已由 Workspace Interface 严格解码并投影，Service 以逐项计数事件填充原 progress 联合，安全拒绝码保持原含义。密码传给远端工具的方式、原生 zip/unzip/tar 依赖和任务队列属于后端私有实现，密码请求字段及对外容量仍归 Shared；源码接通不等于真实旧前端全链路已通过。旧 Protocol 包已删除，历史定义从 Git 追溯，正式前端已移除依赖，不在 Shared 新增同义新旧桥接层。

Agent name/title 原始输入为 128 bytes、prompt 为 16 KiB；创建 Run 完整 JSON 为 128 KiB，其余 JSON 为 16 KiB。Run/Thread 和单个 App 响应为 32 KiB；App 列表/声明使用 scope 的 8 MiB 独立预算，最多 1024 项；治理/Provider 集合使用各自独立预算。Run 事件页：每页至多 100 个事件，每项固定 UUID、有限事件名与安全整数，编码上界小于 224 bytes；页外壳和其余单项状态响应均落在 32 KiB 预算内。后端在白名单投影后校验完整编码，纯解码同样限制大小；前端还须在读取流时使用此预算。请求正文原始空白由 HTTP 实际读取限额约束，重编码长度不替代实际 wire 限额。

transfers/task-codec持有copy/move与archive事件的完整unknown解码；request/response/event map由transfers/workspace提供，start/stop公共回执codec以Task命名，上传与Workspace任务共用。安全失败只接受RemoteFileErrorCode或有限WorkspaceArchiveErrorCode，归档警告为verified_warning，缺失工具参数限zip/unzip/zipinfo/tar/od；这些基础值唯一归transfers/values。生产者为Backend Workspace WS，正式transfer-adapters和Controller为消费者，旧 Protocol 定义仅从 Git 历史追溯，正式Remote消费者不再依赖。

codec检查完整metadata、计数、路径、有限联合及crossSession/sourceOwnerId关系；持有请求上下文的前端任务owner另核对实际mode、原源集合/目标与终态items。totalKnown=false时的递归完成数可超过顶层源数，不把估计字段当真实上限或百分比。Shared不拥有活跃任务、socket、密码缓存或重放政策。

## 5. 入口与安装

步骤/工具专用审计 HTTP 已移除。线程工具列表保留严格 query、响应解码和白名单状态投影，供正式聊天工具卡片与审批历史使用；读取不产生执行许可。

新 Agent HTTP 的 `/ai/providers` 列表/创建/PATCH/DELETE、`/ai/models`、`/ai/providers/discover-endpoint-models`、`/:providerId/discover-models`/`test`，以及 `/ai/model-registry`、`/resolve`、`/refresh` 使用上述契约；既有 Run 创建端点仍以 `Idempotency-Key` 为提交意图，新增可见模型选择字段。新 Backend 为生产者，正式 Provider/Registry 设置及原生运行界面已消费 Shared；各批实际验证范围见 testing，本轮界面不沿用旧 PASS。

新增 GET/POST/DELETE/PUT HTTP 路由及已安装 path 见 Backend 第 5 节。密码登录正确但要求 TOTP 时返回 200 `{requiresTwoFactor:true}` 和五分钟独立 HttpOnly Cookie；`POST /login/2fa` 需该 Cookie 而不接纳完整 session 伪装部分授权。Passkey 认证 options 用独立 challenge Cookie，同一浏览器调用替换旧挑战；完成后签普通 `nexus_session`。HTTP URI 和 Schema 注册自动化仍属规划，Shared 当前为手写严格 codec。

Access 的 `GET /api/v1/auth/login/options` 与 `GET/DELETE /api/v1/settings/ip-blacklist` 是实际入口；其它初始化、登录、status、logout、密码修改沿真实路由关联本 Shared 协议。全局 IP 来源政策在后端 HTTP/WS 安装处，不是 Shared codec 或 Platform 身份判断。正式Auth Store/刷新及公开CAPTCHA读取已消费Shared，Widget设置与黑名单管理已接Shared；请求、失败联合和恢复路径分别随真实消费者迁移。

真实消费者为后端 Workspace status/Docker 和 system 三条 HTTP。Shared codec 解码 Docker 请求、HTTP path 及完整响应，出口是精确 package exports；正式前端Workspace监控/Docker已消费Shared maps和严格codec，再由各自mapper投影为独立应用对象；正式system-overview HTTP已消费system/status及remote/monitoring严格codec；安全错误对象仅含有限code，额外字段拒绝。Frontend transport另核对HTTP状态及原主机，应用等待状态不进入Shared；采样配置消费者已接Preferences核心配置。

每个协议切片同步 package exports、后端路由解码/投影、前端 transport/codec 和实际功能入口；测试、脚本和公开消费者同批核对。不保留无人消费的兼容转导出。

模块为区分语义而给 Shared 类型建立明确别名可以保留，别名不能引入另一份同义字段定义。待实施的 schema 关联须覆盖 path/query/header/body、成功与失败响应及状态码；认证声明不代替授权执行，UTF-8/编码容量和业务跨字段规则仍由实际 owner 保证。Platform 只消费通用元数据，不导入 Shared 业务类型。实施期间前端迁移与测试时机以实施方案决定项为准。

Agent 六个状态 HTTP 已接入 Shared 的请求、路径、幂等 header、分页 query、成功联合及安全错误；后端 public 只保留可信身份输入、能力和后端结果语义。正式features/agent/api和DEV next均消费Shared codec与容量；正式Host还消费Scope原生工作区。行为验收单列，不以源码接入等同通过。

步骤状态、事件、stop/tool_calls 取值和累计正文容量仍归 Run 子域 values.ts，由后端执行及存储消费。专用步骤审计 DTO、路径、事件分页 codec 和前端审计消费者已移除；Run 状态、正文流及用量保持各自现有契约。

Agent Provider 列表新增纯 `readAgentProviderListResponse`，基于既有 ProviderView 严格 decoder 检查完整 8 MiB 上限及唯一 Provider ID；隔离 `agent/next` 使用它读取 `GET /ai/providers` 的配置候选，最终 Run 创建仍由原 `runs/http-codec` 验证非可选 `model` 三字段及 128 KiB 请求预算。Shared 不代替 Provider 当前版本、观察冲突和 Run 同事务冻结决策；正式 Host 同样消费当前 Provider 与 Run 契约。

Remote Files 的 HTTP 与 Workspace 入口均消费当前契约；正式文件浏览、编辑、上传/下载、复制/移动及归档通过 Workspace 功能 API 消费，独立 `remote-next` 开发页不代表正式页面覆盖范围。

Workspace Files Shared 契约由后端的 `/ws/workspace` Files adapter 生产。正式Frontend普通终端与Files浏览/编辑/预览已消费Shared；files/workspace-codec覆盖请求、完整成功结果、metadata及ready/error有限事件，旧Files应用DTO已删除。目录列表不设条目数量门槛，完整8MiB响应字节预算与500搜索结果由Shared values唯一维护；复制/压缩来源和upload.prepare目录同样不再重复限制数量，完整WS消息字节预算仍有效，遍历并发/目录队列仍属后端私有策略。Files时间为Unix毫秒，不沿用连接时间的秒换算。上传完整回执/事件已接正式能力；Workspace复制/移动/归档已接完整codec；跨服务器HTTP任务已接server-*完整契约；挂起HTTP/WS与监控/Docker WS已接Shared；观测 HTTP/配置及桌面也已接正式消费者；旧 Backend 与二进制 codec 从 Git 历史追溯，不增加旧路径到 Shared 的兼容转导出。正式前端已切换 Shared；当前远程基线及后继未验变更见 testing。

## 6. 数据、事务与并发

Provider `expectedVersion` 是配置 CAS，凭据修订只随替换/清除/删除递增；缺失 credential 表示保留。Registry 远端观察写入通过原 Provider 版本/凭据代际比对，不把过期响应回写；Run 冻结记录与 Run+初始事件+幂等写在同一后端 SQLite 事务，不因 wire 字段相同而以 HTTP 契约替代事务。若 Provider 不可用或版本不符，创建返回安全失败；未知提交结果暴露 `operation_unknown`，不允许客户端假定已回滚。

Shared 不声称数据库原子细节；外部保证为无完整身份的部分 Cookie 不享业务权限，WebAuthn/OTP 验证必须成功后才发完整 Cookie；服务端保留签名 challenge 单次使用与 counter CAS，Unknown 事务状态不得自行重放。Passkey credential ID 是不透明 WebAuthn 标识，前端不得把它当密码或授权。

Access 对外只表达会话到期与撤销所导致的 authenticated 状态、显式错误和黑名单分页；token 摘要、失败累积、CAS、改密原会话的提交时复核与当前账号因素检查在 Access SQLite/Model 内，Shared 不声明数据库强事务或 CAPTCHA 远端一次性 token 的完成保证。

Shared 只表达对外版本、游标、幂等结果等契约，不执行事务。expectedVersion、operationKey、事件序号/分页与 replay 结果的含义由业务 owner 保证；共享类型不替代服务端授权及同事务状态校验。Agent 实例的 definitionId/definitionVersion 必填非空，严格解码不容忍旧缺失来源；denylist changedAt 使用 Unix 秒。Agent 应用和存储对象独立保留，只复用 values 中的状态/事件基础值；内部 scope_not_found 在 HTTP 转为 not_found，不进入成功响应联合。

## 7. 生命周期与失败

Provider 测试用实际 OpenAI-compatible 流终态返回 `ok=true/false`（含有限、无秘密的错误码）；管理/查询层返回 `not_found`、`model_not_found`、`provider_configuration_stale`、`provider_in_use`、`provider_unavailable`、`provider_request_failed`。独立 Registry 对外只报告远端是否可用与缓存状态，不把原始 models.dev JSON 暴露为 wire。10 秒 Provider 查询/测试与 15 秒 Registry 手动刷新均可取消，真实失败覆盖范围见测试入口及 PLAN。

安全错误扩展 `challenge_expired`、`not_found`、`limit_exceeded`，既有 `unauthenticated`/`invalid_credentials`/`factor_unavailable`、`operation_unknown` 仍保留。部分 Cookie 最多 300 秒且服务器挑战至多五分钟，logout 清理完整/部分/challenge Cookie；前端必须在新挑战开始、成功、取消、登出和网络错误时刷新相关状态，并对未知提交避免静默重放。

黑名单 `lastAttemptAt/blockedUntil` 对外使用 Unix 秒（匹配现有安全设置消费者），SQLite 与应用规则保留毫秒；HTTP 显式转换。Access 可见错误区分错误凭据 `invalid_credentials`、验证码明确失败 `captcha_invalid`、验证供应商不可用 `captcha_unavailable`、来源入场拒绝 `forbidden`、封禁 `rate_limited`、认证因素不可用 `factor_unavailable`、SQLite 提交/回滚不确定 `operation_unknown` 与确定存储不可用 `storage_unavailable`。status 成功 200 保留 `isAuthenticated:true`；未认证 401 返回 `{code:'unauthenticated'}`，与实际路由/codec 一致，字段是否精简仍依 D8 延后确认。客户端不要在登录失败后自动重播 CAPTCHA token，未知写入/网络错误不推断服务器已回滚；撤销后的长期任务仍需由原资源 owner 完成收尾。

观测 wire 使用具名安全码，资源结果严格区分 status 与 error；完整观测响应/事件预算 512 KiB，本机状态 16 KiB。monitoring/workspace-codec独占观测空请求与有限status.error解码，Docker不再代持通用监控请求。样本及完整Docker结果各自执行512KiB预算；Docker identifier、重复项、嵌套stats归属与可用状态联合严格验证。Docker stats=null 不代表零用量；operation_unknown 不授权自动重放，控制阻断/缓存及任务名额属于后端私有状态，不加入 Shared。

公开失败使用稳定安全码，未知失败不可当成功；不传技术 cause、秘密或对象 dump。Remote Files 的 `operation_unknown` 表示 mutation 已派发但终态无法可信确认，消费者不得把它当作安全未执行或自动重试依据。协议解码不持有活跃资源。取消、generation、终态和资源关闭分别归实际前后端 owner，Shared 可以描述语义，但不能虚构远端回滚保证。

## 8. 当前能力与验收

ACP的公开观察复用agent/governance的kind:acp_permission、安全批准对象和agent/tools状态事件；已有Shared codec由后端HTTP真实消费。新ACP argv/prompt/原始更新、父权限关联存储和活waiter仅后端消费，不建立无人消费Shared DTO。内部许可子操作的completed仅表示许可响应交付，不等同远端动作成功；正式审批与工具卡片消费现有安全投影。

Agent runs/values 的 tool_resource_not_found 与 tool_remote_permission_denied 区分远端资源缺失/权限拒绝、SSH 目标不可用及 Agent 授权失败；持久结果、详情 codec 与三语显示共同引用有限取值。Provider/Registry错误码、步骤状态/事件/失败码唯一归对应values；Provider test失败采用有限取值及受限HTTP状态参数，Registry resolve/delete完整query在http/codec，SQLite行解码也校验基础取值。Provider Shared 与后端已接线；静态检查结果集中见 testing 最新复审。执行、工具、上下文、外围集成与恢复均已有 Shared、后端及正式前端消费者，具体行为证据与剩余缺口见 testing。

Access因素Shared与后端已接线，正式密码/TOTP/Passkey登录、改密、因素管理及CAPTCHA/IP安全面板已消费Shared；其余正式业务也已消费当前契约。既有专项验证部分 TOTP/Chromium 虚拟认证器 WebAuthn 正常与拒绝链，TOTP 并发单次消费通过；其余数据库并发/期限/容量继续验收，核心持久配置已接线并在重启生效，执行配置与Operations审计/通知已接线；既有专项已有环回HTTP/Telegram协议、实际SMTP及Access事件分发的有限交付证据，完整故障专项按 testing 保留待验。

Access Shared 的codec/类型、后端入口和正式Auth/Security浏览器消费者已迁移，既有专项验证受信/不受信转发来源及部分 HTTP/WS 准入、Cookie和因素链；CAPTCHA仅使用受控供应商响应，真实供应商/部署代理、CSRF 和撤销交错覆盖范围见测试入口及 PLAN。验证范围见测试入口及 PLAN。

### 当前协议边界

源码已将 envelope/codec/NXW1 迁到 `remote/workspace`，并接通 terminal/suspend 后端消费者。正式前端NXW1及普通连接/恢复/关闭已迁移，挂起mark/prepare/commit/resumeAck/renew/history及有限事件也已迁移，其余 JSON 子协议也已由正式消费者接入；不把后端消费当作整个双端完成。

`RemoteFileService` 内部为 prepared/upload/copyMove/archive 新增具体 FileResource owner ID，阻断旧附件异步收尾污染新实例；`RemoteSessionService` 对清理失败继续占名额并使用具名聚合错误。这些都是**内部应用生命周期**修复，无新的前后端 wire 字段，故不应凭空添加 Shared DTO 或复制容量常量。正式前端已删除重复NXW1 codec并迁移普通连接/恢复/关闭，挂起HTTP/WS也已迁移，其余子协议已由正式前端消费。

**C3/C4 协议归属**：`remote/workspace/workspace.ts`、`workspace-codec.ts`、`workspace-binary.ts`、`values.ts` 唯一拥有 envelope、connect/resume/close、显式 `workspace.resumeAck` 字段与 NXW1 编码；`remote/terminal/workspace.ts` 与 `workspace-codec.ts` 定义输入/尺寸/消费确认和目录事件。C4 已新增 `remote/suspend/workspace.ts`、`workspace-codec.ts`、`http.ts`，唯一拥有挂起 mark/prepare/commit/list、resume 和独立 `suspend.resumeAck`、owner renew、history/管理的安全 DTO 与 unknown 解码；Backend-next WS/HTTP 对它们做精确消费，内部应用 history/checkpoint/lease 类型归 sessions/model，技术类型归 Platform，Service 通过 Model 转换能力消费。Files `workspace.ts` 只余 Files 请求/响应/事件，原共用 envelope/旧 binary encoder 已删除；Shared package exports已同步；正式前端普通连接/Terminal/Files/传输/挂起链已经精确消费，status/Docker/桌面也已接入正式消费者。独立 Remote PTY 帧容量不等同普通 Workspace terminal 流。以上仅为源码接线，不证明格式/类型/真实行为完整；普通 8 MiB journal 不可冒充挂起 100 MiB 历史或 VT checkpoint。

transfers HTTP/WS 请求及任务事件已由后端消费；基础格式、操作、错误、冲突政策和协议容量集中在 remote/transfers/values.ts；UNSUPPORTED_ENTRY 表示归档入口不接受设备或特权成员；安全符号链接/TAR 硬链接的私有恢复计划属于后端 Model，不新增 Shared 对象，危险链接按安全失败反馈，前端沿现有安全码显示反馈，不能按 generic 失败自动改通道重试。正式前端已消费上述完整协议，行为范围仍按testing记录。后续按 Remote 真正子域增加通信契约，值与对象隔离；后端取消能力、活跃资源 owner 和私有配额不进入 Shared。

核对范围从所有实际功能和端点开始，不仅扫描 Shared 现有目录。每个切片证明 values/model/http/events 的适用归属、实际消费者、编解码和边界投影完整；没有事件协议不预建 events。

Shared check/build、Backend check/build、适用消费者编译及对应格式检查通过后才收口源码阶段，真实行为仍独立验收。历史隔离 fixture 只证明其记录基线；当前全链路、真实 SSH/SFTP、浏览器与故障覆盖按 testing 逐项记录，当前工作见 [实施方案](../PLAN.md)。

传输 codec 不使用对象断言、String 强制转换或数组断言通过验证；字符串按 UTF-8 字节检查，有限值严格匹配，数组逐项与可选字段显式投影。upload 单帧 1 MiB、路径 4096 bytes、task ID 512 bytes、prepare目录及copy/archive来源不设置重复数量阈值；服务端原生命周期追踪和调度/缓存仍私有。

Suspend 的 snapshot 原文 4 MiB、最坏转义及完整 JSON 预算 24 MiB + 16 KiB、history 页 256 KiB 与 name 长度归 `remote/suspend/values.ts`；完整 wire 上限由真实 WS 路由 opt-in，并受 Platform 技术上限容纳。普通控制消息仍消费 Workspace 的 1 MiB，不因 snapshot 扩大所有用例范围。

### Agent 治理协议与正式双端消费者

`shared/src/agent/governance/{values,model,http,http-codec}.ts` 与 `packages/shared/package.json` exports 统一定义 capability 与 ssh-target grant 的有限取值、policy revision、执行策略覆盖、审批 `requested/approved/denied/expired/superseded`、严格请求及响应解码；不为尚无生产者的工具事件增设虚构 WS 类型。HTTP identity/userId 由 Access session 产生，Shared 中的 `AgentApprovalResolveRequest` 或 Grant JSON **不是**后端批准/持有的授权事实。

完整 API 成功响应的 `AgentGrantView`、`AgentExecutionPolicyView`、`AgentApprovalView` 和审批列表有对应解码函数；`http.ts` 定义具名 App/Run/审批 path、resolve header 及响应；路径 App/Run/审批 ID 采用 UUID，版本原始数值、有限枚举原始字符串及所有字段白名单严格核对，未知/空缺/错型及状态与决议/消费字段矛盾拒绝；消费时间须不早于决议且严格早于截止，持久 decoder 使用相同时间关系。toolName/toolVersion 分别最多 256 UTF-8 bytes、summary 2048、feedback 2000，均引用 values 唯一常量。目标 ID 上限 256/项、单 ID 128 UTF-8 bytes，普通 JSON 16 KiB、grants 写入 JSON 512 KiB、完整治理响应 JSON 8 MiB（均计序列化及转义）；成功和安全错误走实际后端 HTTP mapper。存储态、Trusted AuthorizationFact、SQLite 事务和实际 Approval waiter 不属于 Shared。后端治理 HTTP 为生产者，正式前端 AppGovernanceEditor、原生审批与审计通过各自 API/mapper 消费；SDK/RPC 使用相应严格边界，不借用后端授权事实。源码已接通不等于全部治理故障组合通过行为验收，当前范围见 testing。

Agent file_inspect/patch/move/delete 的模型私有命令、树节点及内容指纹只有后端消费者，分别归 tools/model、Remote machines/model 与 files/model；不为其建立无人消费的 Shared DTO。已有治理基础值与公开审批/审计仍由 Shared 唯一持有，正式前端消费公开对象而不借用后端计划。

### 协作契约边界

`agent/collaboration/{values,model,http,http-codec}.ts` 定义已安装的 Child 列表、路径及消息元数据页、有限 profile 和容量，包出口精确列出。Child历史不再按默认工具4000次设集合上界；完整响应保持原2064384bytes的单次编码预算，独立于用户可调整总额度，不随安全整数上界乘法膨胀；消息元数据每页仍最多32项；取消复用 runs 的 expectedVersion/Idempotency-Key/成功联合与安全错误。严格 codec 检查字段、UUID、取值、唯一 Child/父归属和有序游标。后端 register/HTTP 各自白名单投影，Service 保持独立应用对象，Model 转独立 storage。十个模型协作工具由包提供；host-operations 持其隔离 SDK 的严格正文/事实请求与结果，当前身份、目标缩窄和原账本仍由 Backend owner 决定。观察 HTTP 不暴露正文、不推进扫描/消费水位。正式界面已消费安全投影，行为验收仍按 testing 的实际覆盖。

## Preferences 个人数据契约

`preferences/{presentation,commands,history,favorites}/{values,model,http,http-codec}` 为后端真实HTTP的完整协议并精确export。presentation用明确布局联合及完整偏好，不使用任意配置字典；初始未保存version=0，编辑CAS。commands承载命令/标签/变量/版本及批量命令版本；未标记组删除独立请求仅含完整commands的ID/expectedVersion，与标签组删除共享严格成员解码及完整请求1 MiB预算，不引入虚拟标签ID；history保持command/path不同wire字段、分页及去重；favorites独立编辑版本和排序。基础值/协议预算唯一归values，错误含unknown和容量。HTTP投影与Storage对象独立，SQLite Adapter只引values。commands/history/favorites 已由正式 Workspace 的快捷命令、命令历史、Files 收藏与路径历史消费：transport 严格解码分页、CAS 与有限失败，前端 mapper 再转独立应用对象；旧裸数组及无版本写入已删除。正式 App/Router/Workspace 有限整页与真实个人数据 HTTP 验收见 [testing](https://github.com/0honus0/nexus-terminal/blob/558c4b343ba0ef2316309d2e164b9c6075c47efc/doc/testing/E2E.md#f1-c2-d-workspace页面与个人目录契约)。presentation也已由正式Preferences/Workspace共同消费，四读统一版本、完整写入快照和CAS；日志设置独立消费operations/logging。外观已在后续独立批次接入；完整 Workspace 的交互验收范围以 testing 为准。

### Context 续读权限

治理values新增context.read，与现有严格grants/完整治理响应codec及后端共用，正式治理界面展示该权限。结果续读由隔离工具包消费 host.perform 的 context.readResults typed 单页 DTO，原始账本仍留 Backend；context.read仍须叠加源工具当前能力，不是通用跨Run读取权限。

## 数据、执行与运维协议

1. **职责与范围**：agent/memory、artifacts、execution，operations/{logging,audit,notifications} 和 system/diagnostics 持有已安装管理入口的完整协议与安全对象；不暴露内部摘要来源、密钥、SQL行或网络句柄。
2. **子功能与目录**：各域按 values/model/http/http-codec 放置，operations/http-codec 聚合该域纯解码；common/http-codec 仅放实际跨域复用的 unknown JSON 原语。基础取值与对象隔离，包出口精确列出实际文件。
3. **依赖方向**：业务域可引用无业务依赖的 common；operations、system 不借用 Agent 解码器/默认容量。Shared 不引用 Backend/Frontend；前端 wire→本地状态转换仍归前端。
4. **类型与转换**：请求、成功、错误、path/header/query 与二进制 Range/If-Match 分别表达；内部应用/存储类型保持独立，HTTP/Model 明确白名单。通知 secret 命令为 keep/clear/replace，读取仅含存在标志；executionState=governed 不是任务健康状态。
5. **入口与安装**：Memory 列表、单项读取、提案和审核四管理动作、Artifact元数据/二进制内容/库/引用/确认清理、执行设置和硬限制preview/confirm、Operations管理、宿主诊断均有Backend消费者。Operations日志/审计/通知及宿主诊断已有正式前端消费者；Agent 管理页面也已消费对应契约，不据单个界面缺少入口删减其它实际消费者使用的契约。
6. **数据、事务与并发**：版本/确认ID/分页在实际用例复查。Memory/Artifact/通知时间为毫秒，期限字段名明确单位；治理审批仍使用其既定秒表示。Memory视图校验到期晚于创建、审核位于创建/更新之间、发布审核早于到期；历史读取不要求当前尚未过期。Shared形状校验不能替代当前授权、SQL事务事实、文件发布或外部投递确认。
7. **生命周期与失败**：响应预算含转义与完整外壳；Operations请求64KiB/响应8MiB，宿主诊断16KiB，Memory响应8MiB，Artifact JSON响应128KiB/单内容协议容量随execution.maxArtifactBytes最大可配置值10GiB，实际写入由总配额事务决定，清理一次最多128项，执行设置128KiB。宿主诊断的八个模块 ID、有限资源名/单位/状态由 diagnostics/values 唯一持有；完整响应必须包含唯一分组和名称/单位一致的非负指标，未接入/失败组为空，不能以零冒充缺测。RSS 是进程级，process 扩展堆/外部内存/ArrayBuffer/GC 是主线程级；Storage 的 worker_heap_used_bytes/worker_heap_total_bytes/worker_external_bytes/worker_array_buffer_bytes 单列主库 Worker 的 isolate 内存，pending_operations 表示已接纳的排队及执行项，不与已派发 pending_requests 混用；CPU 与 GC 耗时为有限非负秒数。固定分组和资源名同时限定响应容量及指标标签基数，不能用会话 ID/路径扩展标签。unknown 不触发自动重放，配置/引用/观察不授予执行权。
8. **当前能力与验收**：契约与真实后端消费者已接线；正式前端已接线；故障、双端及外部服务行为按 testing 保留实际结果与未验范围。无业务消费者的预留事件移除，不增加旧字段兼容解码。

通知响应的顶层与内层配置采用同一响应字节预算，保持逐字段限制；NotificationDeliveryOutcome 从唯一 NotificationDeliveryStatus 收窄，供 Model/Service/Storage/Adapter 共用，不能各层重复声明取值。存储密文 JSON 的容量是 Adapter 私有技术限制，不添加 Shared 存储对象。

执行设置的完整 `{settings}` / `{confirmation}` 响应 codec 已由正式前端执行卡片消费，limits/hardLimits 及128KiB预算由 execution/values 唯一持有。请求、响应和持久文档均删除 profiles，严格拒绝旧字段；Child 请求上限继承主 Agent，存储约束与解码共同引用执行额度最大值，不保留独立32次上限。collaboration/values 的 profile 仅作为 explore/review/worker 角色标签，不能配置模型或权限。

## 契约与实施边界

preferences/{appearance,themes,html-themes} 的真实主题、设置和图片协议已由正式前端API/mapper/Store及面板消费；终端主题multipart总预算归themes/values，双端读取与route元数据共同引用。agent/{integrations,plugins}已接入配置、工具与SDK后端消费者；system/backups已有正式前端备份导入/导出与全局恢复消费者。源码及专项验证范围见测试入口，外部依赖见 PLAN。每个子域仍按 values/model/http/http-codec 组织；有实际 SDK/RPC 或流协议才增加对应文件，不提前建立空 events。完整任务与消费者盘点见实施方案，只有下述已接线范围存在目录及精确 exports。

Browser targets/端点政策由浏览器插件实例设置消费，repositories由宿主市场消费；与 MCP/ACP integration 配置按语义区分，不能因它们都属于配置就放进同一宽泛对象。插件还须覆盖 publisher/catalog/stage/verify/install/upgrade/uninstall、前端 descriptor/SDK/RPC、跨 App intents 和有限 Artifact 授权；同 Run collaboration mailbox 不替代跨 App 通信。

前后端共享安全对象、完整输入/成功/失败、path/header/query、媒体类型和真实容量；内部声明校验、包句柄、密钥、存储行、恢复日志和运行态授权留 Backend。备份下载是加密载荷，Shared 不定义其明文表集合或密文存储行；普通导入/导出协议与备份格式是不同边界。

themes 四个精确出口包含 22 个颜色键、完整 view/create/update/delete/import/错误和严格 codec；appearance 四个出口包含独立 patch/view、错误、背景 multipart 字段/delete/安全结果/路径参数及 codec。基础 UUID/URL 前缀、媒体类型和字节/数值范围单独归 values；内部 ID、存储状态、摘要和文件句柄不进入共享对象。UI 变量对象/解码 helper 已有后端入口消费者；线对象保留 JSON 字符串，应用 mapper 明确解析/序列化并复制嵌套变量。128 个 ASCII CSS 变量、单值 2 KiB、完整 UI JSON 16 KiB；HTML 副本和后续主题内容统一 1 MiB，外观请求/响应 8 MiB 包含最坏转义。请求/响应完整预算见 USAGE；背景响应嵌套 appearance 也校验完整预算。真实后端与正式前端外观面板、终端字体、主题编辑器和背景均已接这些契约，旧appearanceApi及Protocol出口删除；有限真实/受控验收见testing，不将其等同完整Workspace交互完成。完整预算由本域 Shared 定义，不复用任意域的默认 JSON 限额；后端消费者就绪不表示正式前端迁移完成。

html-themes 的四个精确出口包含来源取值、名称/正文/完整编码容量、本地 CRUD/CAS、版本摘要、GitHub repository 与完整 query、远端列表/内容及安全错误 codec；文本内容另用 readHtmlThemeContent 严格解码，不将 text/plain 当 JSON。名称 255 UTF-8 bytes、内容 1 MiB、请求 8 MiB/响应 32 MiB、目录 1,000 项；后端私有在途和自定义数政策不放 Shared。远端列表核对文件名与 downloadUrl 关联；Shared 不含 token、SQL 行、预置正文或存储修订账本。正式前端HTML库、活动副本、仓库与远端内容均已消费这些对象，采用独立应用类型与白名单mapper；远端公网未验。

外观副本与 HTML 库共用的正文/来源预算由 preferences/values.ts 唯一持有，各子域 values 具名导出，避免同义容量漂移；该基础文件不包含对象或协议结构。

### 集成与插件源码边界

Shared `agent/integrations/browser-*` 仅持 Browser 可信配置与安全观察。MCP/ACP 协议及私有业务契约归独立服务包；`agent/plugins/settings`、`connection` 和 `service-transport` 持宿主实际管理和传输边界，配置连接不授予执行权。

`agent/plugins/model` 定义 manifest4、准确包引用、安装和 App 组合；manifest contributions 为 app/tools/services/ui/settings/skills，App 声明版本化 entry/UI contract，dependencies 与 namespaces 独立。Registry 的 contract/apiVersion、schema、描述、binding 和事件允许插件扩展；目录描述不是授权，准确包/实例/generation/configuration 在派发前重新核对。安装准备不持久化，失败重新 prepare；包事实、配置写入、运行和真实效果各有独立状态。

`backend-sdk` 的公开运行类型由 `runtime`、`registry`、`run-context`、`app-runtime`、`content`、`settings`、`data` 与 `service-transport` 组成。SDK4 的 definePlugin 注册 App、工具或服务，handler 取得 Host 派生的调用 scope 与 signal。App 持完整 run 循环，模型、目录调用、checkpoint、输出、私有数据和受管 I/O 通过明确能力交付；Host 不再接收五阶段 execution 决议。`host-operations` 保留固定可信领域请求及 typed 结果，不接受调用者自报用户或授权。

`frontend-events/frontend-rpc-codec` 定义 protocol4 ready/init/ack、nonce/id/seq envelope、cancel/close 及订阅。`ui-http` 保留具名 Run、工具、Memory、Artifact 操作；`ui-events` 只交付安全 environment、主题、opaque checkpoint/附件、可信确认及资源操作。token、userId、Cookie 和任意 HTTP 代理不进入插件对象。Shared 只交付类型与严格 codec，真实 MessagePort、timer 和关闭归 Frontend `features/agent/plugins/sdk`，公开资产为 `/sdk/frontend-v4.mjs`；Backend SDK 运行资产为 `dist-plugin-sdk/backend-v4.mjs`。两者目录与宿主保持一致，没有独立 SDK workspace 或旧协议回退。

`repository-*`、`install-plan-*`、`package-update-*` 保留签名目录、依赖准备和准确提交契约。更新先验证、关闭新准入、排空及显式迁移，再切换准确包；UI-only 更新只推进对应 Surface 修订。intents 仍有独立消息与附件授权，普通注册服务不自动成为跨 App 消息。完整归属及生命周期见 [Agent 架构](AGENT.md)，各实际预算取所属 values，单页容量不得冒充总数据上限。

### 前端SDK扩展与数据迁移

ThreadView 有 version/updatedAt，workspace entries/history 使用原四段码点游标、每页16片/每片4096码点与16KiB/完整512KiB，保留 emoji/NUL/空白。appendInput 携原 Run/version、Thread、稳定 operationId 与新输入，成功关联同 Thread 的不同 Root；Shared 不定义运行任务、模型授权或旧数据兼容。

migration-model 的快照 items 为 packageId/key/version/valueJson/updatedAt；migration-http 的写 items 为 packageId/key/expectedVersion/valueJson。migration-http-codec 以 packageId+key 验证唯一性、严格 JSON/版本/请求关联；单次52MiB完整迁移预算沿原 owner；不叠加固定键数或 namespace 总量门槛，逐值仍核对正常 RPC 可读取的完整编码容量。全 App 与单 package 的 data-snapshot 消费同一响应，超限明确拒绝；迁移覆盖输入所涉及 namespace 的全部有效键并逐键 CAS，其余 namespace 保留。Shared 不把不同包同名键合并。普通管理数据与 UI SDK 指向当前 UI namespace，后端 SDK 指向执行包 namespace，同包多 App 隔离。

后端准备更新、data-snapshot/migrate-data 与独立清除为实际消费者；不持有旧 migrate 代码回调或安装操作账本。写数据/迁移/清除各自的原有 operationId 和幂等回执继续存在，不能因安装不持久化而删除。签名 Skill 的正文/解析与内部执行输入归后端；Shared 只声明签名 namespace 元数据、安全工具投影与治理基础值。正式前端无手工 JSON 迁移编辑器，行为验收见 testing。

## 机器突变恢复契约

remote/mutations 的 values/model/http/http-codec 分别持有状态/来源/人工确认结果与容量、安全观察、独立 evidence/release 命令及严格 codec，精确出口安装于 package.json。原 owner 实例、资源摘要与存储行不公开；生产者停止/资源停止必须显式 true，证据来源固定 administrator。服务端 HTTP/mapper 已消费，正式恢复管理前端已对接；应用/存储仍保留独立类型。协议校验 held/blocked/released 与时间、修订、证据序列的一致性，分页最多50项/8MiB，不能把 released 改写成原操作成功。operations/values 增加两个真实审计事件。存储结构及快照校验已同步；行为覆盖见 testing，后续数据库演进按 H-21。

### Targets 导入与测试

TargetConnectionView 的 lastConnectedAt 为必填 Unix 毫秒或 null，readConnectionView 严格拒绝缺字段、非安全整数和早于 createdAt 的时间；lastConnectedAt 可晚于 updatedAt，因为连接观测不修改配置。列表、单项、更新与克隆响应共用此契约，不接受客户端写入，也没有本地观察兜底。后端 Storage/Model/public/HTTP 与前端 Summary 均显式投影。桌面签发响应包含 ticket 与内存连接参数，不把签发时间作为成功时间返回；现有 Workspace 附件秒字段仍属于运行时协议，不用作连接列表最近记录。

正式Connections/Proxy/SSH Key/Tags/Host Key API与组件已消费targets对应http/model/codec，保留本地Summary/草稿及显式投影；readConnectionList/readProxyList/readSshKeyList/readTagList严格核对集合唯一ID及时间关系。targets/values唯一维护管理集合10,000项，Proxy完整JSON 64MiB、SSH Key/Tag/Host Key各16MiB，后端列表生产者与正式前端有界读取共同消费；超限返回安全失败，不截断。Tag预算容纳每项128-byte名称的最坏JSON转义与安全整数元数据。Connections完整集合预算640MiB，容纳10,000项字段最坏JSON转义、关系和整数元数据；单项响应128KiB。正式连接表单、标签树、测试和新导入导出已有消费者，Remote运行协议仍留C2。

connections/http 的导入写命令新增独立密码/Key引用/内联私钥联合与代理密码意图；文件按同一新格式数组读取，不增加旧密文/旧字段转换。values 唯一拥有 connectionsFile、每批50项、1MiB文件/JSON、16KiB multipart余量及64KiB私钥。import/codecs 严格解码，Backend及正式Connections transport/新文件导入已共同消费；浏览器读取文件后发送JSON items，multipart接口仍是独立生产入口。

connections/test-http、test-codec 独立定义未保存输入、成功latencyMs、有限安全失败及严格codec并精确export；values拥有512KiB完整测试正文。失败联合的host_key_untrusted分支必须包含hostKey，复用host-keys/model的TargetHostKeyChallenge与严格解码；其他失败禁止携带该字段，不兼容仅错误码的旧分支。Backend从真实握手具名错误投影挑战，Frontend解码后转为独立应用错误，确认及重新测试由connections Model持有。内部应用/存储/可信明文端点独立，Shared不定义存储快照、已解析秘密或运行句柄。TargetErrorCode新增operation_unknown，不能把提交结果未知降为可安全重试的普通失败。正式双端已接通，真实SSH握手及故障覆盖见testing，未覆盖环境仍独立待验。

### Targets 标签关联

tags/values唯一维护128-byte名称，管理与导入校验共用；tags/http、http-codec、values持有替换连接请求、固定updated:true响应、1,000原始ID/32KiB容量；connections/http、http-codec持有追加标签请求，复用同一ID数组解码，不允许空追加。connections/values唯一维护每连接64标签，读取、写入、导入与后端事务规则共用。实际Backend路由/Model/Adapter及正式Tags/Connections/Workspace标签组均已消费。内部命令、关系事务、版本推进及管理员权限不放Shared。空替换、重复合并和缺引用原子拒绝在USAGE说明，行为覆盖与未验范围见 testing。

Targets的unauthenticated/forbidden现在归TARGET_ERROR_CODES唯一基础定义，HTTP联合不再重复定义；导入使用独立TARGET_IMPORT_ERROR_CODES/TargetImportErrorCode排除两者，严格codec不接收认证失效作为普通单项结果。Backend批次遇到身份失效向外传播，不能继续写入；当前完整HTTP失败/前端安全解码仍使用原401/403，正式前端处理已有部分提交，不自动重传。管理actor/token/digest/事务准入类型只在Backend各自owner，Shared不持有身份句柄或权限回调。

Targets Host Key challenge 唯一归 targets/host-keys/model：host/port、实际 fingerprint 与可空 expectedFingerprint；严格 codec 校验，Workspace 失败信封仅 host_key_untrusted 可带此对象，成功或其他错误携带 challenge 拒绝。它仅是握手观察，不授予信任；没有原始公钥、凭据或技术 cause。

Targets Host Key的列表codec严格核对小写host/port唯一性、完整指纹和安全毫秒时间；确认响应还由客户端核对请求身份及指纹。基础指纹取值模式和主机名UTF-8容量归 `targets/host-keys/values.ts`，由Shared codec及后端应用/存储边界共同消费；规范化和业务准入仍归后端Service，不把纯协议解码器当业务规则。

SSH Key 名称/私钥/口令容量唯一归 `targets/ssh-keys/values.ts`（128 bytes/64 KiB/8 KiB），独立管理、连接导入、未保存测试和可信应用入口复用；移除connections中旧私钥容量导出，不保留别名。Proxy字段容量归 `targets/proxies/values.ts`，连接名称容量归 `targets/connections/values.ts`；Service应用校验不引用HTTP codec，持久行只引用values校验编码与范围。

连接host/username/notes及password容量统一归 `targets/connections/values.ts`，分别为512/256/4096、8192 UTF-8 bytes；完整请求预算仍独立。HTTP严格codec、可信应用入口和持久解码按各自语义消费基础值，不让存储层引用HTTP DTO/codec。

`TARGET_CONNECTION_MAX_JUMPS`是每个保存/草稿连接的直接跳板ID容量16项，分别用于Shared codec、应用输入与恢复/存储校验；不借此常量暗中替代后端递归展开与总数政策。

个人命令/标签与收藏响应codec和持久解码一致核对关联时间：updatedAt不早于createdAt；收藏lastUsedAt非空时位于createdAt与updatedAt之间。不新增线字段或回填损坏时间。

Connections的TargetCredentialView/readCredentialView持有connectionId/version与none/password/ssh_key安全联合，仅返回Key引用，不返回密码、密文或私钥；Backend GET /targets/connections/:id/credential与正式编辑窗口共同消费。编辑快照一致性、权限、事务和秘密生命周期仍属各端实际应用owner。

### 独立后台服务器传输

remote/transfers/server-values唯一持有输入方法auto/rsync/scp、实际方法rsync/scp/sftp、父/子有限状态、安全失败及完整编码容量；server-model/http定义安全任务、输入、分页和取消受理，server-codec严格解码并核对源名称/路径/嵌套、目标集合、完整父子对应、进度/状态/时间及游标。源项禁止根目录，目标目录允许根目录；目录选择保留路径空白，不通过 trim 改写真实名称。来源、目标及展开子项不设固定计数门槛，按输入和每个子项状态的实际编码字节校验总预算；完整输入128KiB、单任务1MiB、每页8项。时间为Unix毫秒，queued受理与终态分开，unknown有独立状态；取消accepted不表达远端停止。Backend真实五HTTP与Frontend正式transport均消费精确包出口。Service私有并发、任务历史、会话digest、pin、公钥、凭据及持久claim不进入Shared；双端对象在各自边界显式转换，不能直接当应用状态。

### 挂起管理 HTTP

`remote/suspend/events` 唯一拥有独立目录流的 snapshot/heartbeat 完整联合、严格 unknown 解码和完整帧预算（目录 1 MiB + 1 KiB）。snapshot 含连接内单调安全整数 revision，sessions 复用原目录严格解码；后端 WS 与前端 stream 共同消费并逐字段转换，不包含 SSH 字节、凭据或订阅者身份。重连版本基线只归当前 socket，不跨连接比较。

remote/suspend的http/http-codec由Backend五管理HTTP与正式Frontend API共同消费，完整目录/命名/固定成功回执与有限安全失败均从unknown严格解码。values持1MiB完整目录、4KiB管理正文及128MiB渲染后日志预算；目录不另设64项数量门槛，私有32/64准入和日志窗口仍归Backend owner。目录ISO日期、Unix毫秒租约与attachment关联分别验证；输入名称规范化，响应名称必须已规范。WS请求/响应maps、严格workspace-result-codec和有限autoTerminated/revoked原因由Backend与正式WorkspaceSocket/Session/terminal消费者共同消费；原始snapshot 4MiB、完整JSON 24MiB+16KiB、history页256KiB分别校验。挂起回执复用基础附件字段，不虚构普通回放replayedBytes；Unix秒连接时间只在前端mapper转毫秒。独立ACK/串行续租、unknown与实际资源owner归Frontend/Backend，Shared不拥有socket或恢复政策。

### Provider 管理消费者

正式供应商卡片经 providers/http-codec 严格解码列表、单项、发现、测试及固定删除响应；创建精确核对201，其余管理成功200。发现集合按Shared容量拒绝超量和重复模型标识。前端mapper逐字段转为独立Provider/能力/草稿状态，观察毫秒时间不乘1000；写入只投影配置与凭据意图，不传来源或秘密存储字段。正式Host的可用模型通过Scope工作区消费实际Provider配置版本；旧Provider transport与Protocol出口已经删除。

### App 与治理正式管理消费者

scope/http-codec的实例/定义集合与状态更新已由正式App管理消费；governance/http-codec的完整授权、策略与目标名单经独立前端应用mapper消费，原版本和请求资源关联在transport核对。App实例UUID与定义ID/版本分开；授权scope在前端转为独立可编辑结构，空目标不表示全部。完整写命令按字段投影，策略继承以省略表达，不能将存在但值为undefined的字段送入严格decoder。前端适配按D17只核对源码与静态，远程Actions E2E待全部适配后统一执行。

### 集成、Browser与Memory管理边界

Browser 目标/端点/URL规则的基础容量归 browser-values，browser-codec 严格解码插件配置 `{targets}`；完整文档沿 plugins 消息预算，目标/端点/规则不叠加数量限制。旧 Browser HTTP 契约移除；插件实例 settings 协议持有配置 CAS/幂等，MCP/ACP 私有配置由各服务包消费。

Memory/Artifact的分页offset与nextOffset采用各自values的安全整数预算，给每页容量预留加法空间，不再把10,000有效资源数当作历史分页终点；Backend准入与双端codec/transport共用。

Memory四HTTP的完整codec由后端管理入口、对话候选审核及既有 API E2E 消费；正式设置记忆管理及其专用前端消费者已移除，不保留旧入口或伪造自动审核。列表查询增加可选 threadId，严格 UUID 解码并拒绝重复参数；后端分页前按来源 Run 的对话过滤，来源为空的记录不匹配。前端只用当前对话候选列表和版本化 publish/reject；不传 threadId 的全 App 列表及撤销 API 仍保留。跨App导入的请求、响应、codec及导入事件已删除，不保留旧协议分支。毫秒、单条/完整JSON预算仍归Shared；已有记忆、人工审核规则及运行时 Recall 保留。Run工具与正式Host各消费所属真实契约，管理接口不替代执行权限。

### 原生与插件共用工作区契约

scope/workspace-http 及 workspace-http-codec 唯一定义通用工作区请求/安全结果、会话 appVersion 外壳与 App 响应关联；完整预算8MiB+1KiB、可选模型上限1024归scope/values。plugins/ui-http 只补 UI 专用领域用例，frontend-events组合消费。Backend 会话 HTTP、插件 RPC、独立签名聊天 UI 和 DEV 会话消费者各用真实身份分支；Workspace mapper 在接口逐字段转换，插件 UI 结果另核对可信 appId，不伪造管理员 session 或借用后端内部记录。

新增 agent.threads.delete 的完整参数为 {threadId,expectedVersion}，成功 value 为 AgentDeleteThreadResponse {appId,threadId}；不接受 operationId、额外字段、缺字段、非 UUID 或非正安全整数版本。删除不递增线程版本，因此当前最大安全整数版本仍合法。结果 decoder 严格验证方法和原 threadId，原生响应还验证外壳 App/version 以及内层 appId；插件响应复用工作区 codec 关联线程与 envelope 的 nonce/id/seq，交付 SDK 按已绑定 App 检查结果归属。Backend workspace-mapper 为唯一协议↔应用白名单转换；删除属于 mutation，即使没有 operationId，丢失确认、超时或本地取消也保持未知副作用语义。

pending/running/unknown 的 Root 或 Child 阻止删除，安全失败复用 agent/values 的 active_run_conflict（HTTP 409）；线程/App版本冲突使用 version_conflict，缺失/异 App线程使用 not_found，不根据错误正文归类。事务删除线程、全部 Run 和所属持久子表及附件引用，Memory 保留并清除 sourceRunId、推进自身版本；Artifact 元数据和文件保留。SQL、事务、状态准入和记忆版本耗尽判断均由 Backend 各自 owner 持有，Shared 不定义存储事实或删除策略对象。没有删除回执重放或墓碑兼容层，重复删除为 not_found；未知结果应保留原 threadId/expectedVersion 并先只读核对，不自动重放旧创建意图。

验收边界为严格 unknown 输入、方法/线程/App/version/envelope 响应关联、现有消费者编译，以及 Backend 当前 v1 隔离 SQLite 的 FK/级联、拒绝和回滚验证；正式删除 UI、真实插件/原生 HTTP 交付丢失与并发竞争仍须各自整链验收，静态和隔离证据不扩大为全量行为通过。

### 对话历史反向分页契约

1. **职责与范围**：scope/model持AgentThreadEntryHistory，供原生Host和插件共用workspace读取最近/更早正文；不承载存储行或执行授权。
2. **子功能与目录**：scope/workspace-http增加history请求/结果，http-codec严格解码正文页及前后锚点，workspace-http-codec关联方法、Thread和App。
3. **依赖方向**：Backend接口/SDK及Frontend API消费Shared，Shared只消费本域纯取值/codec，不引用应用或技术层。
4. **类型与转换**：请求为{threadId,before,limit}，before必填且可为null；响应为{body,startCursor,hasEarlier}。body复用AgentThreadEntries，四段游标及textOffset码点单位与前向协议一致；startCursor是首片段之前的位置，nextCursor是最后片段之后的位置。
5. **入口与安装**：agent.threads.history通过原workspace HTTP及插件RPC，沿同一strict unknown解码和App/version/envelope关联；SDK绑定App检查history.body.appId。
6. **数据、事务与并发**：limit复用既有1–16片段，单片4096码点/16KiB与完整512KiB预算；空页不可hasEarlier，非空首片段必须紧接startCursor，末尾不可超过before，同记录前缀必须连续；返回前向游标无需另做猜测转换。
7. **生命周期与失败**：只读方法不加入mutation；错误沿原有限Agent失败码，无新重试或未知写入语义。协议不定义缓存预算、虚拟行高度或数据库策略。
8. **当前能力与验收**：已同步Backend mapper/Service/Storage、原生API及插件SDK归属分支；类型与双端构建可检查消费者覆盖，分页真实SQL、Unicode和并发交付仍待正式行为回归。

## 图片模型协议与可选预算

Provider 协议统一为 chat-completions/responses/images；配置与目录中的 contextWindow/maxOutputTokens 可缺省，已给值必须为正安全整数，双值存在时输出不超过上下文。supportsImageGeneration 表示图片输出能力，与 supportsImageInput 分开；目录匹配不保证网关支持 Images API。协议、能力基础字段归 providers/values，HTTP、workspace、Registry codec 与双端 mapper 同步消费。执行所需文本预算归后端 Run 校验，不在 Shared 填充虚构默认值；内部图像字节、凭据与 model actor 不进入 Shared。图片预览沿认证 Artifact GET 路由交付，不新增任意 URL 或 base64 的聊天协议字段。

### Agent Run 用量摘要

`agent/runs/model.ts` 的 AgentRunUsageView 由认证 HTTP 用量读取与前端共同消费；http-codec 严格解码身份、非负安全整数、报告覆盖和输入/输出成对可空约束，并拒绝总量超出安全整数。无报告必须为 null；模型请求与工具计数独立，不能用预留预算充当实际 Token。

### Agent 思考等级选择

工作区AgentSelectableModel携带reasoningEfforts、可选defaultReasoningEffort及reasoningMandatory，响应解码拒绝重复/未知等级、默认值越界及Images携带思考选项。AgentCreateRunRequest.model可带reasoningEffort，创建和追加共用同一严格解码；Provider配置、工作区列表和Run请求复用providers/http-codec的readAgentOptionalReasoningEffort，其枚举仍唯一归providers/values。后端ModelReference与StoredModelReference各自持有应用/存储字段并逐字段转换，不公开冻结凭据或内部执行对象。

思考字段的可选性在精确record边界按实际自有字段登记：工作区模型的defaultReasoningEffort和Run模型请求的reasoningEffort缺失均合法，其余字段仍必填，未知字段及非法等级仍拒绝；不放宽通用agentRecord，避免影响其它协议。

### Agent Run 直接增量协议

agent/runs/events 定义页面共享 WS 的 subscribe/ack/unsubscribe，包含 subscriptionId/generation；source 严格区分 run（appId/access/runId/cursor）、run-events（appId/grant/runId/after）与 memory（appId/access/threadId）。access 是 session/appVersion 或 plugin/grant，Shared 只表达来源信息，Backend 逐次校验真实授权。外层 data 帧关联订阅、代际与连接内 revision，rejected 仅 forbidden/resync_required/unavailable；value 仍须由已注册 source decoder 验证，不开放任意 topic/JSON 发布。

run update 复用原 Thread 正文页及可空状态组，状态含 Thread/Run/用量/事件/审批/子任务/资源；首帧须含状态。decoder 核对 App/Run/Thread、事件游标/版本、子任务父关联、正文连续码点与 more。run-events 复用 AgentRunEventsResponse；agent/memory/events 的 memory-invalidated 只有 epoch/revision，接收后通过原具名 Memory 读取补齐。持久游标与连接内 revision 分开，重连不能把写入当补读。

命令1KiB、完整输出及16页未 ACK 窗口仍由 runs/values 定义；原审批8MiB、正文512KiB、事件32KiB、子任务/资源与外壳容量计入完整预算，窗口满仅暂停。插件 MessagePort 的 stream 消息独立 nonce/seq、subscriptionId/generation/ACK，SDK 不再500ms轮询；Host 接纳解码后确认后端，UI 回调/渲染确认后推进本地持久游标。认证、计时、背压队列、订阅重连及资源关闭仍归具体 owner，不进入 Shared。

### 公共版本校验

common/version.ts的readComparableVersion使用node-semver解析并规范化版本，拒绝比较器无法精确排序的超大纯数字预发布标识。插件values的isAgentPluginVersion是签名包/目录/安装记录/工具输入的唯一规范小写无metadata校验；原版本正则删除，所有真实消费者同步。发布检查消费同一基础范围，允许在前端处理外部tag的v前缀；畸形版本不触发更新。第三方SemVer对象不出Shared公开函数，仅返回规范字符串或null，不兼容旧超大版本。协议codec保持当前实现，不引入Zod。

### Agent 运行故障投影

AgentRunView 的必填 failure 为 null 或 {code,toolName}；code 唯一归 runs/values 的有限 AgentRunFailureCode，toolName 可为 null，工具类别必须有工具名。仅 failed/unknown 允许非空，unknown 结果语义独立于错误原因。严格 codec、HTTP 出口、workspace 投影和 WS 状态复用同一 Run 白名单；无供应商异常正文、凭据或底层对象。NativeRun 与内部 RunFailure/StoredRunFailure 各自明确转换，创建/取消的幂等快照仍无故障信息；选中运行经原 get 读取诊断。

AgentRunFailureCode另含context_limit_exceeded，区分上下文容量与execution_limit_exceeded；有限数组由严格HTTP/WS解码及存储故障解码共同消费，工具名为null，三语言显示安全原因，不传外部异常正文。

### Agent 自动标题契约

1. **职责与范围**：workspace create显式声明自动命名意图；Run状态流携带当前Thread安全视图。
2. **子功能与目录**：scope/workspace-http、workspace-http-codec、runs/events；复用scope/model与http-codec的Thread。
3. **依赖方向**：双端与插件SDK消费Shared定义，不将后台标题账本或模型执行类型放入Shared。
4. **类型与转换**：create params必填autoTitle:boolean，仅创建消费；rename不接受该字段。RunStreamState必填thread:AgentThreadView；严格unknown解码核对App/Thread与原订阅关联。
5. **入口与安装**：native workspace与plugin SDK共用decoder；直接Thread创建HTTP保留人工标题语义。
6. **数据与并发**：Thread.version独立于Run.version；客户端只接纳较新Thread版本，创建幂等响应仍核对原提交标题/版本。
7. **生命周期与失败**：辅助命名失败不新增协议错误；标题随原状态推送与最终页交付，不进入正文或增加周期HTTP。
8. **当前能力与验收**：双端mapper和既有协议fixture同版迁移；静态证据见testing，行为按D17待验，无旧协议兼容。

## Run 批准模式契约

1. **职责与范围**：runs/values 唯一定义 ask/full_access 基础值及 execution_storage_failed 安全原因，不能作为后端授权证据。
2. **子功能与目录**：原 runs/{values,model,http,http-codec}、scope/workspace-http-codec；无第二套协议或兼容字段。
3. **依赖方向**：双端经包出口消费；Shared 不依赖后端应用/存储。
4. **类型与转换**：AgentCreateRunRequest 和 AgentRunView 的 approvalMode 必填且有限；Workspace 嵌套创建复用严格解码，回执同时匹配 thread 和模式。HTTP/WS、后端 public 与 native/DEV 实际消费者同步。
5. **入口与安装**：原 create/append 与 Run 读取/推送携带模式；遗漏、未知值、错型拒绝，服务端不默认 full_access 或兼容旧请求。
6. **数据与并发**：幂等意图包含模式；持久化、父子继承、审批消费和数据库签名由后端 owner 负责，不把技术行放入 Shared。
7. **生命周期与失败**：数据库失败仅安全有限码和 toolName/null，不公开 SQL 或供应商异常；未知结果仍保留原操作身份。
8. **当前能力与验收**：双端与既有 fixture 生产者已迁移；静态与待远程范围见 testing，不以类型正确推断运行正确。

## 审批历史页与推送游标

1. **范围**：替换完整数组为AgentApprovalPage，不保留旧协议分支。
2. **目录**：governance定义页/容量/codec，scope与runs分别消费。
3. **依赖**：Shared无技术句柄；HTTP/WS/SDK双端共用严格协议。
4. **转换**：items/after/nextCursor/hasMore必填；每页64项，ID严格递增，after匹配请求，nextCursor等于末项或空页原游标，hasMore要求满页；各入口另查App/Run身份。
5. **入口**：HTTP查询after可省略，Workspace after必填；WS cursor增加approvals，state.approvals为页。
6. **并发**：稳定ID用于遍历，version用于客户端合并，展示仍按requestedAt/id排序；页不声称整个历史的原子快照。
7. **生命周期**：WS more必须覆盖非空正文/事件页和审批hasMore；服务端有并发待补推送时也可为true，客户端不得提前停止。
8. **验收**：原生前端、后端出口、插件SDK及既有夹具同步；静态证据与远程待验范围见testing。

### Provider 能力来源写入

providers/model的AgentProviderModelInput允许可选capabilitySources，取值复用providers/values的AgentModelCapabilityField/AgentModelCapabilitySource；来源只解释配置填充路径，未附来源的显式值为manual。输入/视图codec共用同一来源解码，拒绝未知字段/来源及给未配置能力标来源；已有视图仍必带实际能力的来源映射。Provider观察和发现的Partial能力类型排除此配置元数据。Backend输入/JSON存储/读取投影与Frontend草稿/保存映射同步消费，不改变模型网络、授权及UI设计。

### Artifact 总空间契约

1. **职责与范围**：artifacts/values的内容协议容量引用execution/values总空间最大值，不再维护独立单文件容量政策。
2. **子功能与目录**：沿用agent/artifacts与agent/execution四文件owner。
3. **依赖方向**：artifacts基础取值依赖execution基础取值，均不依赖后端或技术句柄。
4. **类型与转换**：maxSingleArtifactBytes从Shared请求/响应、完整解码、双端内部类型及白名单mapper删除；元数据长度和Range解码一致支持总空间协议上限。
5. **入口与安装**：原设置、Artifact begin/PUT/content/preview与文件库入口不变；设置只保留总空间及期限。
6. **数据、事务与并发**：Shared仅校验形状与协议容量，不代替服务端已有占用、预留和磁盘空间检查。
7. **生命周期与失败**：容量拒绝沿既有limit_exceeded；SDK/浏览器字符串技术上限归Platform，不能下沉为Shared文件政策。不为旧设置文档做兼容转换。
8. **当前能力与验收**：双端及现有流式读取夹具已同步；静态与待验边界见testing。

### 挂起终端画面恢复的尺寸顺序

1. **职责与范围**：恢复原PTY画面时保留快照尺寸与实时输出尺寸，不改变UI设计。
2. **子功能与目录**：复用Remote WorkspaceService/WS、Shared suspend契约、前端Workspace terminal adapter及TerminalView/output writer。
3. **依赖方向**：后端应用提供快照和尺寸，WS投影事件；前端adapter转换为终端输出元数据，xterm操作仍由Terminal功能持有。
4. **类型与转换**：Shared `suspend.viewport`严格解码columns/rows及baseline/live阶段；应用PreparedSuspendedWorkspace持有独立viewport，接口逐字段投影；前端转换为TerminalOutput.viewport。
5. **入口与安装**：原suspend.resume先发送baseline尺寸再发送快照；resumeAck先发送live尺寸，再调整原PTY并释放实时输出，无新增用户入口。
6. **数据、事务与并发**：尺寸切换经过xterm解析队列屏障，容器测量等待恢复完成；同尺寸PTY resize直接返回，checkpoint按捕获的每次尺寸排队，先于相应重绘数据。
7. **生命周期与失败**：原ACK、背压、租约和失效清理保持；屏障绑定writer generation，旧PTY取消后不得调整新画面；本地重挂载快照同样等待解析完成才fit。
8. **当前能力与验收**：实现与静态证据见PLAN/testing；既有fullscreen恢复回归同步协议顺序断言，真实浏览器宽窄切换、正常/备用缓冲区及后台恢复按D17待远程验收。

### Agent 审计契约清理

移除步骤详情/事件和工具事件分页专用 HTTP 契约；保留线程工具列表、认证单调用参数详情、工具状态取值与 Run 状态/事件/用量。条目和详情严格解码均由 tools/http-codec 持有；单调用不返回注入凭据或原始结果，内部存储日志不属于 Shared 对外审计能力。

### 生成图片工具投影

AgentToolView.outputArtifactIds 为必填且无重复的文件 UUID 数组；inspected/dispatched 不允许非空引用；其余已结算状态只发布 Host 已确认的 Artifact 引用，failed/cancelled 包父操作也汇总持久子操作事实。引用不再从模型工具名或结果 JSON 推断，插件文本不能伪造。工具/审批 identity 是 plugin 精确包身份或 Host 固定 operation，审计保留的历史 operation 不进入 callable 列表。应用 Model、StoredToolOperation 与前端 NativeTool 各自声明，经 SQLite→Model→register→HTTP→frontend 白名单转换；工具列表不暴露原始结果、模型参数、URL 或 Base64。

Workspace 传输进度：copyMove.progress 的 transferMethodUsed 为选定工具的实际事实，取值复用 ServerTransferMethodUsed（rsync/scp/sftp），准备期尚未选定时省略；archive.progress 的 processedBytes 为 TAR 原生未压缩记录处理字节，非压缩包大小。task-codec 分别严格校验枚举和非负安全整数，双端 WS 投影与客户端 adapter 逐字段映射；未知总量不伪造 totalFiles 或百分比。

## 插件安装目录响应

plugins/http 的 AgentPluginInstallationListResponse 为 GET /plugins/installations 的完整响应：items 是原安装单项，retainedAppIds 是仍有配置或 KV 正文的 removed App ID。专用 codec 严格核对集合形状、App UUID 唯一、retained ID 唯一且必须属于本次 removed 安装；同一来源包可有多个 App，不能再以 definitionId 唯一拒绝。沿原完整响应字节预算，不为此新增限制。Backend Model/HTTP 与 Frontend API 分别转换独立内部目录对象；Host、管理面板和既有 E2E 全部消费专用 codec。安装单项、原卸载 CAS 与数据清除幂等请求不变。

### 插件 App 目录契约

App 来源仅为真实签名插件安装；删除 AgentCreateAppRequest/Response 及其 codec，App 单项仍消费 readAgentAppResponse。AgentAppDefinitionView 只保留 id/version/displayName/capabilities，删除无意义的默认启用字段；HTTP 与 Workspace 复用同一严格 decoder，双端 mapper 及测试消费者同步，不接受旧字段或旧创建接口。公共定义目录每个当前来源包一项；App.capabilities 为实际执行组合并集。内部 composition digest 与 retained refs 只在 Backend storage，公开 definitionId/version 保持真实签名 App 包 ID/SemVer；Shared 不含内置 ID、迁移事实或签名秘密。

## Agent 插件贡献与模型调用

1. **职责与范围**：Shared 持 SDK4 外部协议；默认 App 的工具调度、模型历史、压缩与展示策略归独立插件仓，不把这些算法放进宿主契约。
2. **子功能与目录**：插件 manifest/registry/runtime、模型 app-runtime、run-context、内容和 Operation 契约各有唯一 owner；真实请求、资源与账本归 Backend。
3. **依赖方向**：签名包、隔离 IPC、前后端 SDK 和管理页消费同一 codec；Shared 不引用 Service、Model、存储行或框架句柄。
4. **类型与转换**：manifest4 与 protocol4 严格解码，描述/schema、准确 binding 和实际调用分开。模型返回确定拒绝、流失败和未知派发保留各自有限结果，不从错误正文猜测。
5. **入口与安装**：插件 definePlugin 注册完整 App entry、工具和服务 handler；Host 逐批原子发布。前端公开 connectNexusPlugin/PluginUiRequestFailure；不提供旧五阶段或 SDK3 回退。
6. **数据、事务与并发**：目录公开贡献不产生权限，Operation 在派发事务复核当前 scope、包/实例/配置与审批。checkpoint 保留已消费回执和稳定意图，不能换键猜测重放。
7. **生命周期与失败**：取消不证明真实效果结束；Run 成功须全部关联效果及资源收口。确定拒绝、取消、执行未知和清理失败分别传播，插件私有失败不能覆盖 Host 事实。
8. **当前能力与验收**：默认 App、Chat UI、四个工具包和 MCP/ACP 服务包独立交付；管理、SDK、浏览器与正式发布的实际证据见 testing，历史版本 PASS 不代替本版验收。

### 图片预览容量契约

1. **职责与范围**：preferences/presentation拥有双端个人图片预览容量的字段、单位、默认值和可表示范围；remote/files拥有实际二进制请求预算语义。
2. **子功能与目录**：原values增加DEFAULT_IMAGE_PREVIEW_MAX_MIB=20及imagePreviewMaxMiB范围；model增加必填字段，http-codec精确字段解码同步，不新增包出口或依赖。
3. **依赖方向**：Backend默认/校验/存储边界、Frontend默认/表单/Registry共同消费；Shared不引入浏览器、Pinia、存储或应用类型。
4. **类型与转换**：imagePreviewMaxMiB为非负安全整数，0取消图片预算；最大Math.floor(Number.MAX_SAFE_INTEGER/1024²)仅来自单位转换的技术表示范围。HTTP完整请求/响应复用原PresentationPreferences解码，未设置不等于0，缺字段拒绝。
5. **入口与安装**：沿现有精确exports和preferences接口；remote/files/workspace-codec接收正安全整数maxBytes，不再有固定64MiB总量上限；同步实际后端和前端收发消费者及既有非法预算fixture。
6. **数据、事务与并发**：不持存储数据、不包含SQL；完整偏好JSON/CAS仍归Preferences。文件格式预算在预览Registry，WS每次总量采用请求预算，帧大小/并发/背压保持独立，HTTP transfer inline的20MiB预算不影响WS读取。
7. **生命周期与失败**：严格解码拒绝缺失/负数/小数/非数和不安全单位转换；不为旧JSON补字段。0不承诺无限资源，取消/晚响应/网络失败由原运行时与读源拥有。
8. **当前能力与验收**：前后端所有真实偏好映射和预览入口已接入；静态、限定CDP证据与未验组合见testing，未运行全量本地E2E；后续新增持久字段由对应独立迁移转换，运行时保持严格解码。

## OIDC 契约

### 1. 职责与范围

`access/oidc` 仅拥有前后端共同消费的认证协议，不持有 IdP Token、加密正文、SQLite 行或应用状态。

### 2. 子功能与目录

values 持有客户端认证取值、Cookie 名和固定回调路径；http 持有完整请求/响应；http-codec 严格解码。

### 3. 依赖方向

两端引用 Shared，Shared 只引用 common/http-codec 与 Access 基础预算，不引用业务包。

### 4. 类型与转换

配置响应与写请求分开定义；密钥操作为 keep/clear/replace 联合；回调显式 code/state/issuer/error，拒绝未知字段、缺字段和 code/error 同时有或同时无。应用边界各自逐字段映射。

### 5. 入口与安装

package exports 暴露 values/http/http-codec，实际消费者为后端 OIDC HTTP、前端 Auth API 和 E2E。

### 6. 数据、事务与并发

revision 为不透明随机版本，首次为空；Shared 只校验表示，CAS、一次性消费和授权在 Access 完成。

### 7. 生命周期与失败

复用 Access 错误码与基本认证完整 JSON 预算。协议不宣称超时或取消已回滚绑定；前端围栏保留未知结果。

### 8. 当前能力与验收

双端与测试同步消费新协议，不提供旧版本兼容。具体静态与行为验收见 testing/HISTORY。

### Agent 日志等待状态

AgentResourceSessionView 增加 waitingOutputJobs 非负整数，严格 codec、后端 WS mapper 和前端 native mapper 同步投影。它表示因日志存储空间不足而暂停接收输出的活动 Job 数量，不是新的执行终态或配额。日志正文、索引和内部 Job 读取能力仅由后端/模型消费，不增加无前端消费者的 Shared DTO。

## 诊断 schema 的唯一来源

1. **职责与范围**：System diagnostics 作为已接入的 schema 契约，统一类型、严格解码和 Fastify 响应结构；其它协议保持原严格 codec，未宣称完成全库迁移。
2. **子功能与目录**：`system/diagnostics/model.ts` 定义 Zod Mini 业务结构与推导类型；`http.ts` 定义完整响应/错误、路径和 JSON Schema 生成；`http-codec.ts` 负责容量与安全失败映射。
3. **依赖方向**：Shared 只依赖 Zod Mini 和所属基础 values；前端 API 与后端 HTTP 共用。Zod 的星数、维护和缺陷修复证据见本轮 testing；不依赖后端框架或数据库。
4. **类型与转换**：计数为安全非负整数，耗时/CPU 为有限非负值；指标名字与单位必须对应，模块与指标不能重复，数据库可用状态与版本关联。类型从 schema 推导，应用与协议仍保留独立白名单 mapper。
5. **入口与安装**：`HOST_DIAGNOSTIC_PATH` 被双端消费，真实 Fastify 路由挂载生成的 response schema 并使用框架序列化，返回前用同一 decoder 执行跨字段校验和既有完整编码预算。
6. **数据、事务与并发**：不持有数据库或请求状态；新增 SQLite 指标由原 System 模块读取，不改变原采样节奏。
7. **生命周期与失败**：未知字段、缺失字段、类型错误及跨字段不一致统一拒绝；不做强制类型转换，不扩大公开错误正文。JSON Schema 只表达结构条件，细化规则仍由 shared decoder 执行。
8. **当前能力与验收**：诊断双端和真实路由已接线，类型、构建及新增契约场景按 testing 记录。全库 OpenAPI/AsyncAPI 生成仍是 PLAN 中的独立待办。

### 插件市场本地化目录

plugins/repository-model 的目录包新增可选 localizations 数组，条目为 locale/displayName/description。repository-http-codec 严格校验嵌套字段、规范 BCP47 标签并拒重复；原始 name/description 作为缺译回退。Backend catalog Adapter、Model、HTTP 与 Frontend mapper 逐字段投影，市场随本体 locale 响应式展示和搜索。翻译属于目录发布者，不进入宿主按官方包名维护的分支，也不改写不可变签名归档。已有插件 UI environment 会推送 locale，沿用 SDK4 环境接口，无新增语言 RPC；Shared 本次导出4.0.3契约。
