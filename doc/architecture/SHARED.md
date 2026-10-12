# Shared 架构

本文按 [模块模板](MODULE_TEMPLATE.md) 定义双端契约职责。人工约束见 [HUMAN](../rules/HUMAN.md)，开发入口见 [AGENTS](../AGENTS.md)。

## 1. 职责与范围

**B5.1 Agent Provider（源码接线，行为待 B10）**：新增 Provider 管理、模型能力来源/冲突、models.dev 能力注册表、OpenAI-compatible 发现与真实测试的双端线契约，以及 Run 创建的模型选择引用；仅传公开视图（`hasCredential`、版本/修订），不传明文或密文。B5.1 不让 Shared 持有 Run 的内部不可变冻结存储、模型 SSE、网络失败原因或 B6/B7 未具备的政策。

B4.2 因素的双端新增范围是密码成功后的 `requiresTwoFactor:true`、TOTP setup/verify/disable/二次登录、WebAuthn 的 options/verify、Passkey 发现/列表/改名/删除。Shared 不持有部分会话密钥、challenge 的服务端归属、TOTP secret 密文和签名算法；完整授权仍须 Access 验证。

`packages/shared` 持有前后端同义同表示的基础取值、业务对象与完整通信契约；不持有后端秘密、权限状态、存储行、技术连接或 UI 草稿。旧正式通信仍使用 `packages/protocol`，迁移按功能同步消费者，不让新后端运行时导入旧 Protocol。

B4.1 Access 的双端范围是管理员初始化、密码登录、明确的认证状态、改密/登出、CAPTCHA 公开配置与黑名单读/解除；Shared 只规定传输形状/预算/有限值，真正身份、IP、失败阈值、因素生效、事务及来源信任由 Access/Platform 负责。正式前端在 F1 迁移前尚非新协议消费者，行为验收留 B10。

## 2. 子功能与目录

`agent/providers/{values,model,http,http-codec,registry}` 是 Provider 输入/可见模型/显式来源、严格 unknown 解码、测试联合与远端 Registry 状态的唯一 wire 归属；能力字段名、能力来源和协议取值统一归 providers/values，内部应用/存储引用这些基础值，各层对象仍独立投影；`agent/runs/http` 创建请求增加具名 `model.providerId/modelId/configurationVersion`。Provider 完整响应最多 8 MiB（超限 limit_exceeded）、请求单条最多 128 KiB、单 Provider 最多 128 模型、发现最多 1000、秘密输入 ≤8192 UTF-8 bytes、URL ≤2048、modelId ≤512，完整集合和嵌套观察均计入响应预算。正式前端还使用旧 Protocol，F1 负责迁移，不在 B5.1 导入旧包。

`access/factors/http.ts` 定义因素请求的 unknown 解码、有限 token/名称/credential 字段、公开 TOTP setup 与 Passkey 摘要；`access/values.ts` 新增 HttpOnly partial/challenge/TOTP setup Cookie 名和 300 秒临时生命周期、`limit_exceeded` 等具名错误；`access/http.ts` 将密码登录结果扩充为成功用户或 `requiresTwoFactor:true` 的判别联合。标准 WebAuthn OPTIONS 的 RP、user、algorithm、credential descriptor 先由后端 Model 投影为具名应用类型，再经 Interface 白名单转为 Shared `access/factors/http.ts` 响应类型；已验证的 browser credential JSON 先由 Shared unknown codec 严格校验必要字段，再经 Interface 转为 Factors 应用证据，由 Model 显式转回技术 Port 所需表示。Provider 对象与存储公钥不进入 Service/Shared。

B4.1 的 `access/values.ts` 统一持有新后端会话 Cookie 名 `nexus_session`、rememberMe 30 天 Max-Age、CAPTCHA token 4096 UTF-8 bytes、黑名单分页最多 200、CAPTCHA provider 有限值以及登录/来源/供应商的具名安全错误。`access/http.ts` 为 setup/login（可选 captchaToken）/status（成功 200 `isAuthenticated:true/user`；未认证 401 安全码）/改密/logout/公开 CAPTCHA config/黑名单管理提供请求、响应和 unknown 严格取值；`access/model.ts` 只保留前端可见用户名/id/双因素标志。秘密、SQL 行、封禁策略快照和会话 digest 不属于 Shared；验证码供应商技术参数不进 wire。正式 Frontend 的旧 Auth/Settings API 仍待 F1 切换，不能把这些单端当前引用算作正式双端迁移。

B3.2 新增 `remote/monitoring/{values,model,http,http-codec,events}`、`remote/docker/{values,workspace,workspace-codec}` 和 `system/status/{values,model,http,http-codec}`。基础取值与对象隔离；Docker action 为唯一有限值，技术 Port 仅精确引用 values，不引入 Shared DTO。远端、本机事实分别定义，不通过大量可选字段混成全局状态集合。

B3.3 新增 `remote/desktop/{values,http,http-codec}`：`values` 是 RDP/VNC 协议取值、显示范围、30 秒 ticket TTL、1,024 pending/16 active 产品容量及稳定安全错误；`http` 是 id path、纯 ticket/lastConnectedAt 响应与可选显示输入 DTO，不含账号密码、目标地址和 Guacamole 内部 bridge；`http-codec` 严格解码正整数 path，并从 query 读取单个 width/height/dpi（拒绝未知/重复/非十进制）、解析 43 字节表示的随机 ticket，不把技术配置放进浏览器。技术握手时限、真实清理与局部资源状态属于 Remote Service/Platform 私有生命周期，不进入 Shared。正式前端旧 `@nexus-terminal/protocol/connections` 和 Guacamole 客户端仍在 F-R12 迁移范围内，不宣称当前已双端迁移。

```text
packages/shared/src/<domain>/<feature>/
  values.ts          基础取值、错误码、真实双端容量
  model.ts           双端业务对象
  http.ts            完整请求/响应
  http-codec.ts      确有需要的纯解码
  events.ts          WS/事件契约与必要纯解码
```

当前已建立 Access、Targets、Remote 和有限 Agent 状态契约。子域按业务语义划分，无实际内容不创建空文件。Agent 使用 `agent/scope`（App/Thread）与 `agent/runs`（有限 Run、变更结果及事件分页）；共同安全码、UUID 取值和完整 JSON 字节预算在 `agent/values.ts`，共同错误响应与纯解码在 `agent/http.ts`、`agent/http-codec.ts`。持久事件对象在 runs/model，本批没有 Agent WS，不创建 events。

Remote Files 的 `remote/files` 同时承载只读与 B1 mutation 双端契约：model 保留文件安全对象；http 定义 open/list/stat/read-text 及 write-text/rename/remove/mkdir/rmdir；values 定义路径、目录 metadata、16 MiB UTF-8 文本、完整 JSON wire 预算和安全错误；codec 从 unknown 严格解码。files/text-codec 是文件字符串 Unicode 校验的唯一 owner；HTTP、Workspace、Transfers 的纯解码和后端路径政策复用，避免孤立代理字符在 UTF-8 编码中被替换成另一文件名。

Remote Workspace 的共用 envelope、connect/resume/close/ACK、NXW1 帧编码与容量现统一归 `remote/workspace`；`remote/files/workspace.ts` 仅承载 Files 子协议，terminal/suspend/transfers 各归其子域。旧 Protocol 仍为正式前端来源，F1 才迁移；Shared 不导入旧 Protocol，也不保留旧路径转导出。

待实施设计：各子域增加实际通信需要的 `http-schema.ts`，协议类型与运行时 schema 使用同一契约来源，业务对象仍归 model，基础取值仍归 values。模块 interfaces 将 schema 关联实际安装路由，汇总生成 OpenAPI；WebSocket 消息另按 AsyncAPI 组织。工具选型与迁移见实施方案 A-01/A-02，目前手写 codec 不等于已有自动生成能力。

WebAuthn 创建/请求的 User Verification 均要求 `required`，与服务端验证一致；已知不匹配的 challenge、Origin、RP hash 和 UV 等在技术 Adapter 明确归无效，尚无法由供应商具名失败证明的异常只作不可用处理。HTTP 复用单一的可选字段转换过程，TOTP setup/Passkey options 已提交的挑战在响应最终 finish 之前遭遇断连时撤销，不交付未确认的 challenge Cookie。

## 3. 依赖方向

B5.1 HTTP 从 Shared 解码请求，Provider Model 对应用数据与 SQL/第三方事实逐字段转换；Platform 的模型/Registry Adapter 不导入 Shared Agent DTO。`providers/registry.ts` 的模型目录是管理员读/刷新/解析接口，存储缓存、etag 和失败状态不是浏览器可写对象。Shared 只定义明确信任层之间真实使用的取值，不能当后端内部 Service/Storage 的代用品。

B4.2 HTTP 对 unknown body 调 Shared `access/factors` 解码，再传应用 Service；成功响应由应用→HTTP 逐字段构造。Shared 不导入 `@simplewebauthn/server`、Node crypto/SecretBox 或 SQLite；Platform WebAuthn Port 仍是技术侧唯一协议语境，不借用 Shared 的业务用户类型。正式前端旧 Protocol 消费者留 F1。

Access 的请求字段、错误与容量唯一来源为 Shared；后端 HTTP 接口消费 codec 并逐字段生成响应，Service 使用所属内部类型，技术 Adapter 不导入 Shared 业务 DTO。Platform HTTP 仅提取受信源 IP/Origin/Cookie 字符串，不持有 Access 策略或产品身份对象。

Shared 不依赖 Backend、Frontend、具体 Adapter 或运行时；不访问数据库、网络和环境。values 与 model/http/events 隔离；Platform/业务 SQL Adapter 仅可精确引用确需共用的基础值，不能借 Shared 导入业务对象。package exports 明确列出真实入口，不靠内部深层路径消费。

## 4. 类型与转换

B5.1 区分手工配置、Provider `/models:nexus_capabilities` 观察和远端 Registry 来源。Provider 可见 `models[].capabilitySources` 明示手工配置，`providerCapabilities` 提供有版本/来源的观察，`capabilityConflicts` 表达两者不一致；发现字段缺省不假定 false/zero；`reasoningEfforts/defaultReasoningEffort` 必须为受限取值且默认值在支持集合内。Run 模型选择版本必须正整数；冻结对象包含协议/模型能力/凭据代际，仅在 Run 内部读取，不是 Shared 公共响应；其 `awaiting_b6_b7` 不能解释成允许执行。

Provider 手工能力与供应商观察独立，未知不补 false/zero；只有双方明确提供的值才报告冲突。Shared 对象经 HTTP mapper 转内部应用对象；技术 JSON 不进入 Shared。

Factors 注册/认证 JSON 请求预算 128 KiB、证据字段 96,000 bytes、凭据 ID 1024 bytes、名称 128 bytes、transports 最多 16 项且每项 32 UTF-8 bytes，唯一常量归 access/values。内部应用仍保持独立类型与 Model/HTTP 白名单转换。正式前端在 F1 实施时同步消费成功/失败契约、补齐实际响应解码与上下文校验；当前没有新增前端消费者。

TOTP code 限定 6 位 ASCII 数字（纯边界上限再由应用验证）；密码/Passkey 名称限定 UTF-8 字节，WebAuthn credential JSON 明确读取 id/rawId/type、认证器签名或注册 attestation、extension 结果及有限公共字段。注册/认证完整输入最多由后端 HTTP 128 KiB 读取预算保护，解码不接受任意额外顶层字段；Provider 生成的 OPTIONS 由 Model 显式转换为浏览器 public 字段。Passkey 列表时间对外 Unix 秒，内部存储毫秒，不含 publicKey/counter/secret。

Access `readAccessLoginRequest` 只允许 username/password/rememberMe/captchaToken；黑名单 query 的 `limit` 默认为 50、`offset` 为 0，拒绝重复或未知查询键及非十进制整数；删除请求显式使用 JSON `{ip}`。公开 CAPTCHA 返回启用标志、provider 和两个站点公钥字段，不含 secret；提供严格响应解码。status 未认证 401 返回 `{code:'unauthenticated'}` 供已存在的 DEV Auth client 正确识别，成功 200 为 `{isAuthenticated:true,user}`，不能折叠成 `user:null` 取代 isAuthenticated。后端即使返回字段同名仍保持应用/public/HTTP 三处各自一次白名单投影。

同义同表示的有限取值只定义一次；内部应用表示不同则保留独立类型并显式映射。后端 Service 不把 Shared HTTP/WS 当内部用例类型；公开后端能力可引用消费者需要的 Shared 对象，但逐字段出口投影仍保留。输入从 unknown 解码并执行所属协议真实校验；“严格”不等于擅自收紧旧有效协议，旧入口明确允许额外字段时 codec 只提取已知字段。完整联合结果与安全错误响应都定义，不只迁出成功 DTO。

协议容量是实际 UTF-8/帧字节预算，包含外壳与转义；后端与前端消费相同定义。私有队列、缓存、重放和关闭策略不自动成为 Shared；共享产品限制需有实际契约用途。身份来自认证，不接受 wire 自报 userId。

Remote Files 小 JSON 请求仍为 16 KiB，路径 ≤4096 UTF-8 bytes，目录 ≤200 项/48 KiB metadata。文本原文 ≤16 MiB；write-text 另按最坏 JSON 转义推导完整请求预算，文本响应按最坏转义推导完整响应预算。Shared 的 `expectedSha256`、`conflict` 和 `operation_unknown` 只描述公开语义，不把 hash 预检升级为远端原子 CAS，也不承诺 unknown 已回滚。

transfers values 同时定义 HTTP inline 预览的 20 MiB 硬预算，后端实际路由消费 WORKSPACE_TRANSFER_MAX_INLINE_PREVIEW_BYTES；前端各文件格式的更低预览读取预算有独立语义，不能合并成这项 HTTP 硬限制，F1 再迁移正式消费者。ticket 的公开结果仍归 transfers/http，由 Interface 逐字段投影；应用 sink、final flush、claim/owner 追踪不新增 wire 字段。

Remote Files 的路径字节容量由 files/values 唯一定义，transfers/values 以 WORKSPACE_TRANSFER_MAX_PATH_BYTES 引用同一值，保留协议语境而不复制数字。传输派生完整路径由后端 Service 校验；这一约束不扩大到原本不使用该预算的旧 Workspace 基础文件契约。任务 finished、清理失败追踪、名额保留与 attachment 实例绑定是私有生命周期，不增加 Shared wire 字段。

R2 没有新增双端 wire 字段或重新定义容量：Workspace 的 64 个附件预约与独立 HTTP Files 的 8 个名额是各自后端资源 owner 的私有配额，不能错误迁入 Shared；`FileBinaryPiece` 和有效取消/期限交付属于 Remote 内部应用契约，NXW1 frame 仍只归 Shared binary encoder。

B2 已建立 `remote/transfers` 子域：`http.ts`/纯 `http-codec.ts` 定义 download-ticket 的真正前后端 body/结果，`workspace.ts`/纯 `workspace-codec.ts` 定义 upload.prepare/start/cancel/abort、二进制 upload stream 参数及 copy/move、archive 的请求与完整事件。ZIP/Range 是已定义的 HTTP 行为，单独使用 Content-Range、Content-Disposition 和状态码；server-side ticket、task map、WebSocket 技术队列上限、SFTP lease、私有目录扫描配额不能伪装成 Shared 双端业务对象。旧 archive WS 已由 Workspace Interface 严格解码并投影，Service 以逐项计数事件填充原 progress 联合，安全拒绝码保持原含义。密码传给远端工具的方式、原生 zip/unzip/tar 依赖和任务队列属于后端私有实现，密码请求字段及对外容量仍归 Shared；源码接通不等于真实旧前端全链路已通过。旧 Protocol 包仍作为正式前端未迁移来源，不在 Shared 新增同义新旧桥接层。

Agent name/title 原始输入为 128 bytes、prompt 为 16 KiB；创建 Run 完整 JSON 为 128 KiB，其余 JSON 为 16 KiB。响应统一 32 KiB：每页至多 100 个事件，每项固定 UUID、有限事件名与安全整数，编码上界小于 224 bytes；页外壳和其余响应均落在预算内。后端在白名单投影后校验完整编码，纯解码同样限制大小；前端还须在读取流时使用此预算。请求正文原始空白由 HTTP 实际读取限额约束，重编码长度不替代实际 wire 限额。

## 5. 入口与安装

新 Agent HTTP 的 `/ai/providers` 列表/创建/PATCH/DELETE、`/ai/models`、`/ai/providers/discover-endpoint-models`、`/:providerId/discover-models`/`test`，以及 `/ai/model-registry`、`/resolve`、`/refresh` 使用上述契约；既有 Run 创建端点仍以 `Idempotency-Key` 为提交意图，新增可见模型选择字段。仅新 Backend 作为本批真实 HTTP 消费者；前端与浏览器动作均未迁移、未测试。

新增 GET/POST/DELETE/PUT HTTP 路由及已安装 path 见 Backend B4.2 第 5 节。密码登录正确但要求 TOTP 时返回 200 `{requiresTwoFactor:true}` 和五分钟独立 HttpOnly Cookie；`POST /login/2fa` 需该 Cookie 而不接纳完整 session 伪装部分授权。Passkey 认证 options 用独立 challenge Cookie，同一浏览器调用替换旧挑战；完成后签普通 `nexus_session`。HTTP URI 和 Schema 注册自动化仍属规划，Shared 当前为手写严格 codec。

Access 的 `GET /api/v1/auth/captcha/config` 与 `GET/DELETE /api/v1/settings/ip-blacklist` 是本批真实入口；其它初始化、登录、status、logout、密码修改沿真实路由关联本 Shared 协议。全局 IP 来源政策在后端 HTTP/WS 安装处，不是 Shared codec 或 Platform 身份判断。前端的 captcha Widget、黑名单设置、Auth store/刷新暂时仍使用旧协议，F1 必须同时迁请求、失败联合和恢复路径。

B3.2 真实消费者为新后端 Workspace status/Docker 和 system 三条 HTTP。Shared codec 解码 Docker 请求、HTTP path 及完整响应，出口是精确 package exports；正式前端 systemOverviewApi、Workspace capabilityAdapters 仍用旧 Protocol，差异由实施方案 F-R11 承接，未迁移。

每个协议切片同步 package exports、后端路由解码/投影、前端 transport/codec 和实际功能入口；测试、脚本和公开消费者同批核对。不保留无人消费的兼容转导出。

模块为区分语义而给 Shared 类型建立明确别名可以保留，别名不能引入另一份同义字段定义。待实施的 schema 关联须覆盖 path/query/header/body、成功与失败响应及状态码；认证声明不代替授权执行，UTF-8/编码容量和业务跨字段规则仍由实际 owner 保证。Platform 只消费通用元数据，不导入 Shared 业务类型。实施期间前端迁移与测试时机以实施方案决定项为准。

Agent 六个状态 HTTP 已接入 Shared 的请求、路径、幂等 header、分页 query、成功联合及安全错误；后端 public 只保留可信身份输入、能力和后端结果语义。正式前端 `features/agent/api` 仍消费旧 Protocol；新消费者已在 `features/agent/next` 接入 Shared codec 和容量，真实浏览器行为由实施方案另行验收，不能把正式旧 Agent 当作新 API 消费者。

步骤状态/事件基础取值及累计正文容量（2 MiB）唯一归 Run 子域 values.ts，Shared codec、Backend应用和存储均消费它；Platform仍保有独立技术上限。B5.2 只读模型步骤审计新增 Run 子域现有 `model.ts/http.ts/http-codec.ts` 中的 `AgentRunStepView`、`AgentRunStepEventView`、严格 stepIndex=1 路径和事件分页；仅暴露状态、序号、用量、UTF-8 文本字节数、安全失败分类，**不导出 `textDelta` 或冻结模型/凭据**。Backend-next Service/Model/Storage 保留独立类型，经注册和 HTTP 逐字段白名单投影。隔离开发页 API/Controller 是实际 Shared 解码消费者，正式 F1 仍未迁；100 条每页的小型元数据响应须服从现有 32 KiB 完整 JSON 预算，正文/流式输出需要另定可审核协议，不能把这个审计响应上限擅自提高。

Agent Provider 列表新增纯 `readAgentProviderListResponse`，基于既有 ProviderView 严格 decoder 检查完整 8 MiB 上限及唯一 Provider ID；隔离 `agent/next` 使用它读取 `GET /ai/providers` 的配置候选，最终 Run 创建仍由原 `runs/http-codec` 验证非可选 `model` 三字段及 128 KiB 请求预算。Shared 不代替 Provider 当前版本、观察冲突和 Run 同事务冻结决策；正式 F1 尚未切换。

Remote Files B1 当前真实写消费者是 backend-next HTTP；已有 `remote-next` 前端 transport 继续只读消费同一 read-text/容量契约，未增加 mutation 方法或界面。Shared 变更因此要求现有只读消费者继续编译，但不把后端 B1 描述成前端写入已迁移。

Workspace Files Shared 契约由 backend-next 的 `/ws/workspace` Files adapter 生产。正式 Frontend 的 `WorkspaceSocket`/capability adapters 当前仍消费旧 Protocol，未完成 Shared 类型或运行时迁移；旧 Backend/Protocol 与其二进制 codec 保持原有参考实现，不增加旧路径到 Shared 的兼容转导出。双包期间逐项核对正常 wire 等价，不能宣称旧消费者已迁移；B10 验证正常通信，P1/F1 再破坏性迁移正式前端并移除旧定义与 codec，最终仅保留新契约 owner。R1 不改前端 transport/controller/view。

## 6. 数据、事务与并发

Provider `expectedVersion` 是配置 CAS，凭据修订只随替换/清除/删除递增；缺失 credential 表示保留。Registry 远端观察写入通过原 Provider 版本/凭据代际比对，不把过期响应回写；Run 冻结记录与 Run+初始事件+幂等写在同一新后端 SQLite 事务，不因 wire 字段相同而以 HTTP 契约替代事务。若 Provider 不可用或版本不符，创建返回安全失败；未知提交结果暴露 `operation_unknown`，不允许客户端假定已回滚。

Shared 不声称数据库原子细节；外部保证为无完整身份的部分 Cookie 不享业务权限，WebAuthn/OTP 验证必须成功后才发完整 Cookie；服务端保留签名 challenge 单次使用与 counter CAS，Unknown 事务状态不得自行重放。Passkey credential ID 是不透明 WebAuthn 标识，前端不得把它当密码或授权。

Access 对外只表达会话到期与撤销所导致的 authenticated 状态、显式错误和黑名单分页；token 摘要、失败累积、CAS、改密原会话的提交时复核与当前账号因素检查在 Access SQLite/Model 内，Shared 不声明数据库强事务或 CAPTCHA 远端一次性 token 的完成保证。

Shared 只表达对外版本、游标、幂等结果等契约，不执行事务。expectedVersion、operationKey、事件序号/分页与 replay 结果的含义由业务 owner 保证；共享类型不替代服务端授权及同事务状态校验。Agent 应用和存储对象独立保留，只复用 values 中的状态/事件基础值；内部 scope_not_found 在 HTTP 转为 not_found，不进入成功响应联合。

## 7. 生命周期与失败

B5.1 Provider 测试用实际 OpenAI-compatible 流终态返回 `ok=true/false`（含有限、无秘密的错误码）；管理/查询层返回 `not_found`、`model_not_found`、`provider_configuration_stale`、`provider_in_use`、`provider_unavailable`、`provider_request_failed`。独立 Registry 对外只报告远端是否可用与缓存状态，不把原始 models.dev JSON 暴露为 wire。10 秒 Provider 查询/测试与 15 秒 Registry 手动刷新均可取消，真实失败留 B10。

B4.2 安全错误扩展 `challenge_expired`、`not_found`、`limit_exceeded`，既有 `unauthenticated`/`invalid_credentials`/`factor_unavailable`、`operation_unknown` 仍保留。部分 Cookie 最多 300 秒且服务器挑战至多五分钟，logout 清理完整/部分/challenge Cookie；前端 F1 必须在新挑战开始、成功、取消、登出和网络错误时刷新相关状态，并对未知提交避免静默重放。

黑名单 `lastAttemptAt/blockedUntil` 对外使用 Unix 秒（匹配现有安全设置消费者），SQLite 与应用规则保留毫秒；HTTP 显式转换。Access 可见错误区分错误凭据 `invalid_credentials`、验证码明确失败 `captcha_invalid`、验证供应商不可用 `captcha_unavailable`、来源入场拒绝 `forbidden`、封禁 `rate_limited`、未迁移因素 `factor_unavailable`、SQLite 提交/回滚不确定 `operation_unknown` 与确定存储不可用 `storage_unavailable`。status 成功 200 保留 `isAuthenticated:true`；未认证 401 返回 `{code:'unauthenticated'}`，与实际路由/codec 一致，字段是否精简仍依 D8 延后确认。客户端不要在登录失败后自动重播 CAPTCHA token，未知写入/网络错误不推断服务器已回滚；撤销后的长期任务仍需由原资源 owner 完成收尾。

观测 wire 使用具名安全码，资源结果严格区分 status 与 error；完整观测响应/事件预算 512 KiB，本机状态 16 KiB。Docker stats=null 不代表零用量；operation_unknown 不授权自动重放，控制阻断/缓存及任务名额属于后端私有状态，不加入 Shared。

公开失败使用稳定安全码，未知失败不可当成功；不传技术 cause、秘密或对象 dump。Remote Files 的 `operation_unknown` 表示 mutation 已派发但终态无法可信确认，消费者不得把它当作安全未执行或自动重试依据。协议解码不持有活跃资源。取消、generation、终态和资源关闭分别归实际前后端 owner，Shared 可以描述语义，但不能虚构远端回滚保证。

## 8. 当前能力与验收

Provider/Registry错误码、步骤状态/事件/失败码唯一归对应values；Provider test失败采用有限取值及受限HTTP状态参数，Registry resolve/delete完整query在http/codec，SQLite行解码也校验基础取值。Provider Shared 与新后端已接线；静态检查结果集中见 testing 最新复审。正式前端 F1、完整执行 B5.2、工具 B6、配置 B7 与行为 B10 未完成。

Access 因素 Shared 与新后端已接线；正式前端仍消费旧 Protocol。TOTP/WebAuthn 与数据库并发行为留 B10，动态配置及审计通知留 B7。

B4.1 Access Shared 的 codec/类型和后端入口已有源码，但正式浏览器尚未迁移，所有真实供应商响应、反向代理链、HTTP/WS 准入、Cookie/CSRF 和撤销交错的行为归 B10。静态与架构状态由当前阶段四表和命令证据单独记录，B4.2/B7 未实现部分不得写成已完成。

### B3.1 当前协议边界（行为待验）

B3.1 源码已将 envelope/codec/NXW1 迁到 `remote/workspace`，并接通 terminal/suspend 后端消费者。正式前端尚未迁移，不把后端消费当作双端已完成；完整行为统一留 B10/F1。

本轮 `RemoteFileService` 内部为 prepared/upload/copyMove/archive 新增具体 FileResource owner ID，阻断旧附件异步收尾污染新实例；`RemoteSessionService` 对清理失败继续占名额并使用具名聚合错误。这些都是**内部应用生命周期**修复，无新的前后端 wire 字段，故不应凭空添加 Shared DTO 或复制容量常量。正式前端仍引用 `@nexus-terminal/protocol/workspace`、旧 NXW1 codec 和 SSH suspend DTO；协议真实完成后其唯一迁移消费点归实施方案固定 F-R10，不在本批改前端。

**C3/C4 本轮实际协议迁移**：`remote/workspace/workspace.ts`、`workspace-codec.ts`、`workspace-binary.ts`、`values.ts` 唯一拥有 envelope、connect/resume/close、显式 `workspace.resumeAck` 字段与 NXW1 编码；`remote/terminal/workspace.ts` 与 `workspace-codec.ts` 定义输入/尺寸/消费确认和目录事件。C4 已新增 `remote/suspend/workspace.ts`、`workspace-codec.ts`、`http.ts`，唯一拥有挂起 mark/prepare/commit/list、resume 和独立 `suspend.resumeAck`、owner renew、history/管理的安全 DTO 与 unknown 解码；Backend-next WS/HTTP 对它们做精确消费，内部应用 history/checkpoint/lease 类型归 sessions/model，技术类型归 Platform，Service 通过 Model 转换能力消费。Files `workspace.ts` 只余 Files 请求/响应/事件，原共用 envelope/旧 binary encoder 已删除；Shared package exports 已同步，但正式前端仍使用旧 `@nexus-terminal/protocol/workspace`，F-R10 未执行。独立 Remote PTY 帧容量不等同普通 Workspace terminal 流。以上仅为源码接线，不证明格式/类型/真实行为完整；普通 8 MiB journal 不可冒充挂起 100 MiB 历史或 VT checkpoint。

transfers HTTP/WS 请求及任务事件已由新后端消费；基础格式、操作、错误、冲突政策和协议容量集中在 remote/transfers/values.ts；UNSUPPORTED_ENTRY 表示归档入口不接受设备或特权成员；安全符号链接/TAR 硬链接的私有恢复计划属于后端 Model，不新增 Shared 对象，危险链接按安全失败反馈，前端专用反馈归 F1，不能按 generic 失败自动改通道重试。正式前端仍待 F1 迁移，不能把后端消费 Shared 当作双端已完成。后续按 Remote 真正子域增加通信契约，值与对象隔离；后端取消能力、活跃资源 owner 和私有配额不进入 Shared。

核对范围从所有实际功能和端点开始，不仅扫描 Shared 现有目录。每个切片证明 values/model/http/events 的适用归属、实际消费者、编解码和边界投影完整；没有事件协议不预建 events。

Shared check/build、Backend-next check/build、适用消费者编译及对应格式检查通过后才收口源码阶段，真实行为仍独立验收。Remote Files B1 的历史隔离 fixture 仅证明其记录基线，不覆盖 R1 对旧 WS、编码、批量/递归、技术失败边界的修改；R1 按阶段决定不运行行为测试，真实 SSH/SFTP、旧 Workspace Files 全链路与浏览器行为统一留 B10/F1。Agent 实际消费者与具体收口见 [实施方案](../后端重构下一阶段实施方案.md#延后的前端事项未验收不删除)。

传输 codec 不使用对象断言、String 强制转换或数组断言通过验证；字符串按 UTF-8 字节检查，有限值严格匹配，数组逐项与可选字段显式投影。upload 单帧 1 MiB、路径 4096 bytes、task ID 512 bytes、单批 prepare 20k 目录、copy/archive 64 sources 归 values；服务端资源名额/缓存和每 Workspace 总配额仍私有。

Suspend 的 snapshot 原文 4 MiB、最坏转义及完整 JSON 预算 24 MiB + 16 KiB、history 页 256 KiB 与 name 长度归 `remote/suspend/values.ts`；完整 wire 上限由真实 WS 路由 opt-in，并受 Platform 技术上限容纳。普通控制消息仍消费 Workspace 的 1 MiB，不因 snapshot 扩大所有用例范围。
