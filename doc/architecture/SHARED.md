# Shared 架构

本文按 [模块模板](MODULE_TEMPLATE.md) 定义双端契约职责。人工约束见 [HUMAN](../rules/HUMAN.md)，开发入口见 [AGENTS](../AGENTS.md)。

## 1. 职责与范围

**B5.1 Agent Provider（源码接线，行为待 B10）**：新增 Provider 管理、模型能力来源/冲突、models.dev 能力注册表、OpenAI-compatible 发现与真实测试的双端线契约，以及 Run 创建的模型选择引用；仅传公开视图（`hasCredential`、版本/修订），不传明文或密文。B5.1 不让 Shared 持有 Run 的内部不可变冻结存储、模型 SSE、网络失败原因或内部冻结的执行政策。

B4.2 因素的双端新增范围是密码成功后的 `requiresTwoFactor:true`、TOTP setup/verify/disable/二次登录、WebAuthn 的 options/verify、Passkey 发现/列表/改名/删除。Shared 不持有部分会话密钥、challenge 的服务端归属、TOTP secret 密文和签名算法；完整授权仍须 Access 验证。

`packages/shared` 持有前后端同义同表示的基础取值、业务对象与完整通信契约；不持有后端秘密、权限状态、存储行、技术连接或 UI 草稿。旧正式通信仍使用 `packages/protocol`，迁移按功能同步消费者，不让新后端运行时导入旧 Protocol。

B4.1 Access 的双端范围是管理员初始化、密码登录、明确的认证状态、改密/登出、CAPTCHA 公开配置与黑名单读/解除；Shared 只规定传输形状/预算/有限值，真正身份、IP、失败阈值、因素生效、事务及来源信任由 Access/Platform 负责。正式前端在 F1 迁移前尚非新协议消费者，行为验收留 B10。

B7.1 核心设置的 GET/PUT、CAPTCHA 专项 PUT、安全视图、secret keep/clear/replace、CAS 与 saved/effective 激活状态归 Shared preferences/configuration；公开 CAPTCHA 读取复用 Access 契约。源码生产者已安装，正式前端消费者留 F1，不能声称双端对接完成。

## 2. 子功能与目录

`agent/tools/{values,model,http,http-codec}.ts` 持有有限状态、安全 Tool 审计对象（含modelStepIndex）、单项路径、事件分页和严格 unknown 解码，提供精确包出口。实际消费者为新后端 HTTP/public 和应用/存储基础值；正式前端仍待 F1。参数、结果正文、providerCallId、私密摘要及持久预算留 Backend runs。事件游标使用状态 revision，不使用 operationRevision；默认 50、最多 100 项，完整 JSON 响应最多 128 KiB。codec 校验目标 ID/version 成对、修订/时间关系及同工具事件顺序；持有请求上下文的消费者还须核对 App/Run/Tool、after/limit 和空页游标。

`agent/scope` 持有 App 实例 UUID 与受信 definitionId/version 的不同语义、enabled/version/毫秒时间、声明摘要、CAS 输入和完整列表/单项 codec。唯一执行状态基础值在 scope/values；governed 仅表示治理执行政策，不表示 running/healthy。创建请求可选 definitionId，仅选服务器已安装来源，不能自报声明字段；默认来源由后端选择。

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

`preferences/configuration/{values,model,http,http-codec}.ts` 分别持有有限取值/容量、安全对象、完整命令与响应、unknown 严格解码；每个文件精确 export。请求/响应64 KiB、白名单16 KiB、CAPTCHA key1024 bytes、最多16站点；不公开明文/密文，写入secret采用显式意图。

`system/backups/{values,http,http-codec}.ts`已持有加密导出的JSON请求、安全失败及64MiB载荷/100MiB文件/Access统一1024-byte密码/64KiB请求预算，并精确export。生产者为 System 已安装导出和导入 HTTP；导入使用 multipart backupFile/password，成功回执为 restoredTables/restoredRows/restoredFiles/cleanupPending，字段与严格 codec 同属 system/backups，multipart 总量为 100 MiB 文件加 64 KiB 封装预算。正式前端仍 F1。加密头部、表行、敏感字段、密钥、暂存文件和恢复 journal 不进入 Shared；源码不等于恢复行为已验收。

## 3. 依赖方向

B5.1 HTTP 从 Shared 解码请求，Provider Model 对应用数据与 SQL/第三方事实逐字段转换；Platform 的模型/Registry Adapter 不导入 Shared Agent DTO。`providers/registry.ts` 的模型目录是管理员读/刷新/解析接口，存储缓存、etag 和失败状态不是浏览器可写对象。Shared 只定义明确信任层之间真实使用的取值，不能当后端内部 Service/Storage 的代用品。

B4.2 HTTP 对 unknown body 调 Shared `access/factors` 解码，再传应用 Service；成功响应由应用→HTTP 逐字段构造。Shared 不导入 `@simplewebauthn/server`、Node crypto/SecretBox 或 SQLite；Platform WebAuthn Port 仍是技术侧唯一协议语境，不借用 Shared 的业务用户类型。正式前端旧 Protocol 消费者留 F1。

Access 的请求字段、错误与容量唯一来源为 Shared；后端 HTTP 接口消费 codec 并逐字段生成响应，Service 使用所属内部类型，技术 Adapter 不导入 Shared 业务 DTO。Platform HTTP 仅提取受信源 IP/Origin/Cookie 字符串，不持有 Access 策略或产品身份对象。

Shared 不依赖 Backend、Frontend、具体 Adapter 或运行时；不访问数据库、网络和环境。values 与 model/http/events 隔离；Platform/业务 SQL Adapter 仅可精确引用确需共用的基础值，不能借 Shared 导入业务对象。package exports 明确列出真实入口，不靠内部深层路径消费。

Run 创建请求必填 connectionIds（最多 50 个唯一正整数），与 model 一起由后端严格解码。空数组不是授权；不存在缺字段兼容。工具轮允许零正文，最终 stop 仍要求正文。参数、结果正文、供应商调用身份与 reasoning 不进入 Shared；正式选择器和多步 UI 留 F1。

Agent新增的模型私有诊断/文件/Shell/Docker工具输入、结果、后台Job状态及RemoteMachineOperations后端出口没有前端HTTP消费者，留对应Backend应用/public owner；不因工具目录增加就在Shared复制其内部对象。安全审计仍消费既有Shared工具契约，正式前端操作差异归F-R18–F-R21。后台Shell的公开工具completed仅表示受理回执已持久化，真实执行状态归独立Job；不把受理解释为进程健康或Root成功。

B6.2E 项目目录工具与机器突变占用仅有后端模型/Remote 消费者：ProjectScope/Binding/Guidance 与 claim/storage 留各自内部 owner，不建立 Shared 目录正文、凭据或 row。既有 Shared 工具安全审计和 Remote 错误继续双端消费；正式前端差异见 F-R24，未来恢复接口必须随真实路由补齐 Shared 和投影。

## 4. 类型与转换

`agent/governance` 持有 target-denylist 请求/响应、50 项上限、512 Unicode 码点/2048 bytes 原因预算。目标 IDs、CAS 与完整响应严格解码，拒绝原因只作安全用户说明。内部批准 capability、目标 generation、默认 grant 安装任务、SQL 和运行时资源不进入 Shared。后端 HTTP 是当前实际消费者，既有 DEV 创建 App 继续通过更新后的 Shared codec 解码；启停/名单与正式界面按 F1 接线，不能声称已有新 UI。

B5.1 区分手工配置、Provider `/models:nexus_capabilities` 观察和远端 Registry 来源。Provider 可见 `models[].capabilitySources` 明示手工配置，`providerCapabilities` 提供有版本/来源的观察，`capabilityConflicts` 表达两者不一致；发现字段缺省不假定 false/zero；`reasoningEfforts/defaultReasoningEffort` 必须为受限取值且默认值在支持集合内。Run 模型选择版本必须正整数；冻结对象包含协议/模型能力/凭据代际，仅在 Run 内部读取，不是 Shared 公共响应；其 `governed` 不能替代 enabled、当前权限与冻结预算。

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

Agent name/title 原始输入为 128 bytes、prompt 为 16 KiB；创建 Run 完整 JSON 为 128 KiB，其余 JSON 为 16 KiB。Run/Thread 和单个 App 响应为 32 KiB；App 列表/声明使用 scope 的 8 MiB 独立预算，最多 1024 项；治理/Provider 集合使用各自独立预算。Run 事件页：每页至多 100 个事件，每项固定 UUID、有限事件名与安全整数，编码上界小于 224 bytes；页外壳和其余单项状态响应均落在 32 KiB 预算内。后端在白名单投影后校验完整编码，纯解码同样限制大小；前端还须在读取流时使用此预算。请求正文原始空白由 HTTP 实际读取限额约束，重编码长度不替代实际 wire 限额。

## 5. 入口与安装

工具审计安装 `GET /api/v1/agent/apps/:appId/runs/:id/tools/:toolCallId` 及其 `/events?after=&limit=`。Shared codec 为 HTTP 的实际路径/query 解码 owner；内部 Model → public 与 public → HTTP 各自逐字段白名单转换。读取不产生检查、审批或执行许可；正式前端消费与请求关联核对归 F1。

新 Agent HTTP 的 `/ai/providers` 列表/创建/PATCH/DELETE、`/ai/models`、`/ai/providers/discover-endpoint-models`、`/:providerId/discover-models`/`test`，以及 `/ai/model-registry`、`/resolve`、`/refresh` 使用上述契约；既有 Run 创建端点仍以 `Idempotency-Key` 为提交意图，新增可见模型选择字段。仅新 Backend 作为本批真实 HTTP 消费者；前端与浏览器动作均未迁移、未测试。

新增 GET/POST/DELETE/PUT HTTP 路由及已安装 path 见 Backend B4.2 第 5 节。密码登录正确但要求 TOTP 时返回 200 `{requiresTwoFactor:true}` 和五分钟独立 HttpOnly Cookie；`POST /login/2fa` 需该 Cookie 而不接纳完整 session 伪装部分授权。Passkey 认证 options 用独立 challenge Cookie，同一浏览器调用替换旧挑战；完成后签普通 `nexus_session`。HTTP URI 和 Schema 注册自动化仍属规划，Shared 当前为手写严格 codec。

Access 的 `GET /api/v1/auth/captcha/config` 与 `GET/DELETE /api/v1/settings/ip-blacklist` 是本批真实入口；其它初始化、登录、status、logout、密码修改沿真实路由关联本 Shared 协议。全局 IP 来源政策在后端 HTTP/WS 安装处，不是 Shared codec 或 Platform 身份判断。前端的 captcha Widget、黑名单设置、Auth store/刷新暂时仍使用旧协议，F1 必须同时迁请求、失败联合和恢复路径。

B3.2 真实消费者为新后端 Workspace status/Docker 和 system 三条 HTTP。Shared codec 解码 Docker 请求、HTTP path 及完整响应，出口是精确 package exports；正式前端 systemOverviewApi、Workspace capabilityAdapters 仍用旧 Protocol，差异由实施方案 F-R11 承接，未迁移。

每个协议切片同步 package exports、后端路由解码/投影、前端 transport/codec 和实际功能入口；测试、脚本和公开消费者同批核对。不保留无人消费的兼容转导出。

模块为区分语义而给 Shared 类型建立明确别名可以保留，别名不能引入另一份同义字段定义。待实施的 schema 关联须覆盖 path/query/header/body、成功与失败响应及状态码；认证声明不代替授权执行，UTF-8/编码容量和业务跨字段规则仍由实际 owner 保证。Platform 只消费通用元数据，不导入 Shared 业务类型。实施期间前端迁移与测试时机以实施方案决定项为准。

Agent 六个状态 HTTP 已接入 Shared 的请求、路径、幂等 header、分页 query、成功联合及安全错误；后端 public 只保留可信身份输入、能力和后端结果语义。正式前端 `features/agent/api` 仍消费旧 Protocol；新消费者已在 `features/agent/next` 接入 Shared codec 和容量，真实浏览器行为由实施方案另行验收，不能把正式旧 Agent 当作新 API 消费者。

步骤状态/事件/stop与tool_calls基础取值、400步审计容量及累计正文容量（2 MiB）唯一归 Run 子域 values.ts，Shared codec、Backend应用和存储均消费它；Platform仍保有独立技术上限。B5.2 只读模型步骤审计新增 Run 子域现有 `model.ts/http.ts/http-codec.ts` 中的 `AgentRunStepView`、`AgentRunStepEventView`、严格 stepIndex 1–400 路径和事件分页；仅暴露状态、序号、用量、UTF-8 文本字节数、安全失败分类，**不导出 `textDelta` 或冻结模型/凭据**。Backend-next Service/Model/Storage 保留独立类型，经注册和 HTTP 逐字段白名单投影。隔离开发页 API/Controller 是实际 Shared 解码消费者，正式 F1 仍未迁；100 条每页的小型元数据响应须服从现有 32 KiB 完整 JSON 预算，正文/流式输出需要另定可审核协议，不能把这个审计响应上限擅自提高。

Agent Provider 列表新增纯 `readAgentProviderListResponse`，基于既有 ProviderView 严格 decoder 检查完整 8 MiB 上限及唯一 Provider ID；隔离 `agent/next` 使用它读取 `GET /ai/providers` 的配置候选，最终 Run 创建仍由原 `runs/http-codec` 验证非可选 `model` 三字段及 128 KiB 请求预算。Shared 不代替 Provider 当前版本、观察冲突和 Run 同事务冻结决策；正式 F1 尚未切换。

Remote Files B1 当前真实写消费者是 backend-next HTTP；已有 `remote-next` 前端 transport 继续只读消费同一 read-text/容量契约，未增加 mutation 方法或界面。Shared 变更因此要求现有只读消费者继续编译，但不把后端 B1 描述成前端写入已迁移。

Workspace Files Shared 契约由 backend-next 的 `/ws/workspace` Files adapter 生产。正式 Frontend 的 `WorkspaceSocket`/capability adapters 当前仍消费旧 Protocol，未完成 Shared 类型或运行时迁移；旧 Backend/Protocol 与其二进制 codec 保持原有参考实现，不增加旧路径到 Shared 的兼容转导出。双包期间逐项核对正常 wire 等价，不能宣称旧消费者已迁移；B10 验证正常通信，P1/F1 再破坏性迁移正式前端并移除旧定义与 codec，最终仅保留新契约 owner。R1 不改前端 transport/controller/view。

## 6. 数据、事务与并发

Provider `expectedVersion` 是配置 CAS，凭据修订只随替换/清除/删除递增；缺失 credential 表示保留。Registry 远端观察写入通过原 Provider 版本/凭据代际比对，不把过期响应回写；Run 冻结记录与 Run+初始事件+幂等写在同一新后端 SQLite 事务，不因 wire 字段相同而以 HTTP 契约替代事务。若 Provider 不可用或版本不符，创建返回安全失败；未知提交结果暴露 `operation_unknown`，不允许客户端假定已回滚。

Shared 不声称数据库原子细节；外部保证为无完整身份的部分 Cookie 不享业务权限，WebAuthn/OTP 验证必须成功后才发完整 Cookie；服务端保留签名 challenge 单次使用与 counter CAS，Unknown 事务状态不得自行重放。Passkey credential ID 是不透明 WebAuthn 标识，前端不得把它当密码或授权。

Access 对外只表达会话到期与撤销所导致的 authenticated 状态、显式错误和黑名单分页；token 摘要、失败累积、CAS、改密原会话的提交时复核与当前账号因素检查在 Access SQLite/Model 内，Shared 不声明数据库强事务或 CAPTCHA 远端一次性 token 的完成保证。

Shared 只表达对外版本、游标、幂等结果等契约，不执行事务。expectedVersion、operationKey、事件序号/分页与 replay 结果的含义由业务 owner 保证；共享类型不替代服务端授权及同事务状态校验。Agent 实例的 definitionId/definitionVersion 必填非空，严格解码不容忍旧缺失来源；denylist changedAt 使用 Unix 秒。Agent 应用和存储对象独立保留，只复用 values 中的状态/事件基础值；内部 scope_not_found 在 HTTP 转为 not_found，不进入成功响应联合。

## 7. 生命周期与失败

B5.1 Provider 测试用实际 OpenAI-compatible 流终态返回 `ok=true/false`（含有限、无秘密的错误码）；管理/查询层返回 `not_found`、`model_not_found`、`provider_configuration_stale`、`provider_in_use`、`provider_unavailable`、`provider_request_failed`。独立 Registry 对外只报告远端是否可用与缓存状态，不把原始 models.dev JSON 暴露为 wire。10 秒 Provider 查询/测试与 15 秒 Registry 手动刷新均可取消，真实失败留 B10。

B4.2 安全错误扩展 `challenge_expired`、`not_found`、`limit_exceeded`，既有 `unauthenticated`/`invalid_credentials`/`factor_unavailable`、`operation_unknown` 仍保留。部分 Cookie 最多 300 秒且服务器挑战至多五分钟，logout 清理完整/部分/challenge Cookie；前端 F1 必须在新挑战开始、成功、取消、登出和网络错误时刷新相关状态，并对未知提交避免静默重放。

黑名单 `lastAttemptAt/blockedUntil` 对外使用 Unix 秒（匹配现有安全设置消费者），SQLite 与应用规则保留毫秒；HTTP 显式转换。Access 可见错误区分错误凭据 `invalid_credentials`、验证码明确失败 `captcha_invalid`、验证供应商不可用 `captcha_unavailable`、来源入场拒绝 `forbidden`、封禁 `rate_limited`、未迁移因素 `factor_unavailable`、SQLite 提交/回滚不确定 `operation_unknown` 与确定存储不可用 `storage_unavailable`。status 成功 200 保留 `isAuthenticated:true`；未认证 401 返回 `{code:'unauthenticated'}`，与实际路由/codec 一致，字段是否精简仍依 D8 延后确认。客户端不要在登录失败后自动重播 CAPTCHA token，未知写入/网络错误不推断服务器已回滚；撤销后的长期任务仍需由原资源 owner 完成收尾。

观测 wire 使用具名安全码，资源结果严格区分 status 与 error；完整观测响应/事件预算 512 KiB，本机状态 16 KiB。Docker stats=null 不代表零用量；operation_unknown 不授权自动重放，控制阻断/缓存及任务名额属于后端私有状态，不加入 Shared。

公开失败使用稳定安全码，未知失败不可当成功；不传技术 cause、秘密或对象 dump。Remote Files 的 `operation_unknown` 表示 mutation 已派发但终态无法可信确认，消费者不得把它当作安全未执行或自动重试依据。协议解码不持有活跃资源。取消、generation、终态和资源关闭分别归实际前后端 owner，Shared 可以描述语义，但不能虚构远端回滚保证。

## 8. 当前能力与验收

B6.2C ACP的公开观察复用agent/governance的kind:acp_permission、安全批准对象和agent/tools状态事件；已有Shared codec由后端HTTP真实消费。新ACP argv/prompt/原始更新、父权限关联存储和活waiter仅后端消费，不建立无人消费Shared DTO。内部许可子操作的completed仅表示许可响应交付，不等同远端动作成功；正式前端F-R22后置。

Provider/Registry错误码、步骤状态/事件/失败码唯一归对应values；Provider test失败采用有限取值及受限HTTP状态参数，Registry resolve/delete完整query在http/codec，SQLite行解码也校验基础取值。Provider Shared 与新后端已接线；静态检查结果集中见 testing 最新复审。B5/B6/B7 原执行链和协议已有源码；正式前端 F1、外围能力 B8、恢复 B9、行为 B10。

Access 因素 Shared 与新后端已接线；正式前端仍消费旧 Protocol。TOTP/WebAuthn 与数据库并发行为留 B10，核心持久配置已接线并在重启生效，执行配置与 Operations 审计/通知已接线，真实交付待 B10、正式前端待 F1。

B4.1 Access Shared 的 codec/类型和后端入口已有源码，但正式浏览器尚未迁移，所有真实供应商响应、反向代理链、HTTP/WS 准入、Cookie/CSRF 和撤销交错的行为归 B10。静态与架构状态由当前阶段四表和命令证据单独记录，源码接线不等于双端及行为验收。

### B3.1 当前协议边界（行为待验）

B3.1 源码已将 envelope/codec/NXW1 迁到 `remote/workspace`，并接通 terminal/suspend 后端消费者。正式前端尚未迁移，不把后端消费当作双端已完成；完整行为统一留 B10/F1。

本轮 `RemoteFileService` 内部为 prepared/upload/copyMove/archive 新增具体 FileResource owner ID，阻断旧附件异步收尾污染新实例；`RemoteSessionService` 对清理失败继续占名额并使用具名聚合错误。这些都是**内部应用生命周期**修复，无新的前后端 wire 字段，故不应凭空添加 Shared DTO 或复制容量常量。正式前端仍引用 `@nexus-terminal/protocol/workspace`、旧 NXW1 codec 和 SSH suspend DTO；协议真实完成后其唯一迁移消费点归实施方案固定 F-R10，不在本批改前端。

**C3/C4 本轮实际协议迁移**：`remote/workspace/workspace.ts`、`workspace-codec.ts`、`workspace-binary.ts`、`values.ts` 唯一拥有 envelope、connect/resume/close、显式 `workspace.resumeAck` 字段与 NXW1 编码；`remote/terminal/workspace.ts` 与 `workspace-codec.ts` 定义输入/尺寸/消费确认和目录事件。C4 已新增 `remote/suspend/workspace.ts`、`workspace-codec.ts`、`http.ts`，唯一拥有挂起 mark/prepare/commit/list、resume 和独立 `suspend.resumeAck`、owner renew、history/管理的安全 DTO 与 unknown 解码；Backend-next WS/HTTP 对它们做精确消费，内部应用 history/checkpoint/lease 类型归 sessions/model，技术类型归 Platform，Service 通过 Model 转换能力消费。Files `workspace.ts` 只余 Files 请求/响应/事件，原共用 envelope/旧 binary encoder 已删除；Shared package exports 已同步，但正式前端仍使用旧 `@nexus-terminal/protocol/workspace`，F-R10 未执行。独立 Remote PTY 帧容量不等同普通 Workspace terminal 流。以上仅为源码接线，不证明格式/类型/真实行为完整；普通 8 MiB journal 不可冒充挂起 100 MiB 历史或 VT checkpoint。

transfers HTTP/WS 请求及任务事件已由新后端消费；基础格式、操作、错误、冲突政策和协议容量集中在 remote/transfers/values.ts；UNSUPPORTED_ENTRY 表示归档入口不接受设备或特权成员；安全符号链接/TAR 硬链接的私有恢复计划属于后端 Model，不新增 Shared 对象，危险链接按安全失败反馈，前端专用反馈归 F1，不能按 generic 失败自动改通道重试。正式前端仍待 F1 迁移，不能把后端消费 Shared 当作双端已完成。后续按 Remote 真正子域增加通信契约，值与对象隔离；后端取消能力、活跃资源 owner 和私有配额不进入 Shared。

核对范围从所有实际功能和端点开始，不仅扫描 Shared 现有目录。每个切片证明 values/model/http/events 的适用归属、实际消费者、编解码和边界投影完整；没有事件协议不预建 events。

Shared check/build、Backend-next check/build、适用消费者编译及对应格式检查通过后才收口源码阶段，真实行为仍独立验收。Remote Files B1 的历史隔离 fixture 仅证明其记录基线，不覆盖 R1 对旧 WS、编码、批量/递归、技术失败边界的修改；R1 按阶段决定不运行行为测试，真实 SSH/SFTP、旧 Workspace Files 全链路与浏览器行为统一留 B10/F1。Agent 实际消费者与具体收口见 [实施方案](../后端重构下一阶段实施方案.md#延后的前端事项未验收不删除)。

传输 codec 不使用对象断言、String 强制转换或数组断言通过验证；字符串按 UTF-8 字节检查，有限值严格匹配，数组逐项与可选字段显式投影。upload 单帧 1 MiB、路径 4096 bytes、task ID 512 bytes、单批 prepare 20k 目录、copy/archive 64 sources 归 values；服务端资源名额/缓存和每 Workspace 总配额仍私有。

Suspend 的 snapshot 原文 4 MiB、最坏转义及完整 JSON 预算 24 MiB + 16 KiB、history 页 256 KiB 与 name 长度归 `remote/suspend/values.ts`；完整 wire 上限由真实 WS 路由 opt-in，并受 Platform 技术上限容纳。普通控制消息仍消费 Workspace 的 1 MiB，不因 snapshot 扩大所有用例范围。

### B6.1 Agent 治理协议（静态源码，正式双端未迁移）

`shared/src/agent/governance/{values,model,http,http-codec}.ts` 与 `packages/shared/package.json` exports 统一定义 capability 与 ssh-target grant 的有限取值、policy revision、执行策略覆盖、审批 `requested/approved/denied/expired/superseded`、严格请求及响应解码；不为尚无生产者的工具事件增设虚构 WS 类型。HTTP identity/userId 由 Access session 产生，Shared 中的 `AgentApprovalResolveRequest` 或 Grant JSON **不是**后端批准/持有的授权事实。

完整 API 成功响应的 `AgentGrantView`、`AgentExecutionPolicyView`、`AgentApprovalView` 和审批列表有对应解码函数；`http.ts` 定义具名 App/Run/审批 path、resolve header 及响应；路径 App/Run/审批 ID 采用 UUID，版本原始数值、有限枚举原始字符串及所有字段白名单严格核对，未知/空缺/错型及状态与决议/消费字段矛盾拒绝。toolName/toolVersion 分别最多 256 UTF-8 bytes、summary 2048、feedback 2000，均引用 values 唯一常量。目标 ID 上限 256/项、单 ID 128 UTF-8 bytes，普通 JSON 16 KiB、grants 写入 JSON 512 KiB、完整治理响应 JSON 8 MiB（均计序列化及转义）；成功和安全错误走实际后端 HTTP mapper。存储态、Trusted AuthorizationFact、SQLite 事务和实际 Approval waiter 不属于 Shared。新后端当前只生成这些 HTTP 响应；**正式前端仍由 F1 迁移**，不能因存在 codec 就声称双端已经通过验证。

Agent file_inspect/patch/move/delete 的模型私有命令、树节点及内容指纹只有后端消费者，分别归 tools/model、Remote machines/model 与 files/model；不为其建立无人消费的 Shared DTO。已有治理基础值与公开审批/审计仍由 Shared 唯一持有，F1 消费公开对象而不借用后端计划。

### B6.2D 协作契约边界

`agent/collaboration/{values,model,http,http-codec}.ts` 定义已安装的 Child 列表、路径及消息元数据页、有限 profile 和容量，包出口精确列出。列表最多4项，消息元数据每页最多32项，完整响应16 KiB；取消复用 runs 的 expectedVersion/Idempotency-Key/成功联合与安全错误。严格 codec 检查字段、UUID、取值、唯一 Child/父归属和有序游标。后端 register/HTTP 各自白名单投影，Service 保持独立应用对象，Model 转独立 storage。十个模型协作工具的目标缩窄、正文/事实和上下文仍属私有 owner；观察 HTTP 不暴露正文、不推进模型扫描/消费水位。正式前端按 F-R23 后置，不能宣称已有双端验收。

## Preferences 个人数据契约

`preferences/{presentation,commands,history,favorites}/{values,model,http,http-codec}` 为新后端真实HTTP的完整协议并精确export。presentation用明确布局联合及完整偏好，不使用任意配置字典；初始未保存version=0，编辑CAS。commands承载命令/标签/变量/版本及批量命令版本；history保持command/path不同wire字段、分页及去重；favorites独立编辑版本和排序。基础值/协议预算唯一归values，错误含unknown和容量。HTTP投影与Storage对象独立，SQLite Adapter只引values。正式前端消费者等待F1，不以新增Shared文件宣称双端迁移完成。

### Context 续读权限

治理values新增context.read，与现有严格grants/完整治理响应codec及后端共用，正式前端F1需要展示该权限。结果续读仅有后端模型消费者，私有ResultPage/原始账本不加入Shared；context.read仍须叠加源工具当前能力，不是通用跨Run读取权限。

## B7 数据、执行与运维协议

1. **职责与范围**：agent/memory、artifacts、execution，operations/{logging,audit,notifications} 和 system/diagnostics 持有已安装管理入口的完整协议与安全对象；不暴露内部摘要来源、密钥、SQL行或网络句柄。
2. **子功能与目录**：各域按 values/model/http/http-codec 放置，operations/http-codec 聚合该域纯解码；common/http-codec 仅放实际跨域复用的 unknown JSON 原语。基础取值与对象隔离，包出口精确列出实际文件。
3. **依赖方向**：业务域可引用无业务依赖的 common；operations、system 不借用 Agent 解码器/默认容量。Shared 不引用 Backend/Frontend；前端 wire→本地状态转换仍归前端。
4. **类型与转换**：请求、成功、错误、path/header/query 与二进制 Range/If-Match 分别表达；内部应用/存储类型保持独立，HTTP/Model 明确白名单。通知 secret 命令为 keep/clear/replace，读取仅含存在标志；executionState=governed 不是任务健康状态。
5. **入口与安装**：Memory 六管理动作、Artifact元数据/二进制内容/库/引用/确认清理、执行设置和硬限制preview/confirm、Operations管理、宿主诊断均有 Backend消费者。正式前端F1尚未迁移，不据缺少前端目录删减契约。
6. **数据、事务与并发**：版本/确认ID/分页在实际用例复查。Memory/Artifact/通知时间为毫秒，期限字段名明确单位；治理审批仍使用其既定秒表示。Shared形状校验不能替代当前授权、SQL事务事实、文件发布或外部投递确认。
7. **生命周期与失败**：响应预算含转义与完整外壳；Operations请求64KiB/响应8MiB，宿主诊断16KiB，Memory响应8MiB，Artifact JSON响应128KiB/单内容16MiB，清理一次最多128项，执行设置64KiB。unknown 不触发自动重放，配置/引用/观察不授予执行权。
8. **当前能力与验收**：契约与真实后端消费者已接线；正式前端F1、故障/双端/外部服务行为B10。无业务消费者的预留事件移除，不增加旧字段兼容解码。

B7 通知响应的顶层与内层配置采用同一响应字节预算，保持逐字段限制；NotificationDeliveryOutcome 从唯一 NotificationDeliveryStatus 收窄，供 Model/Service/Storage/Adapter 共用，不能各层重复声明取值。存储密文 JSON 的容量是 Adapter 私有技术限制，不添加 Shared 存储对象。

## B8 契约与实施边界（源码收口，正式前端待 F1）

B8 已增加 preferences/{appearance,themes,html-themes} 的真实主题、设置和图片协议；agent/{integrations,plugins}及system/backups 已接入配置、工具、SDK与备份导入导出的实际后端消费者，B8 源码复审已收口，行为仍待 B10。每个子域仍按 values/model/http/http-codec 组织；有实际 SDK/RPC 或流协议才增加对应文件，不提前建立空 events。完整任务与消费者盘点见实施方案，只有下述已接线范围存在目录及精确 exports。

Browser targets/端点政策和插件 repositories 原来由 Agent settings 消费；与 MCP/ACP integration 配置按语义区分，不能因它们都属于配置就放进同一宽泛对象。插件还须覆盖 publisher/catalog/stage/verify/install/upgrade/uninstall、前端 descriptor/SDK/RPC、跨 App intents 和有限 Artifact 授权；同 Run collaboration mailbox 不替代跨 App 通信。

前后端共享安全对象、完整输入/成功/失败、path/header/query、媒体类型和真实容量；内部声明校验、包句柄、密钥、存储行、恢复日志和运行态授权留 Backend。备份下载是加密载荷，Shared 不定义其明文表集合或密文存储行；普通导入/导出协议与备份格式是不同边界。

themes 四个精确出口包含 22 个颜色键、完整 view/create/update/delete/import/错误和严格 codec；appearance 四个出口包含独立 patch/view、错误、背景 multipart 字段/delete/安全结果/路径参数及 codec。基础 UUID/URL 前缀、媒体类型和字节/数值范围单独归 values；内部 ID、存储状态、摘要和文件句柄不进入共享对象。UI 变量对象/解码 helper 已有后端入口消费者；线对象保留 JSON 字符串，应用 mapper 明确解析/序列化并复制嵌套变量。128 个 ASCII CSS 变量、单值 2 KiB、完整 UI JSON 16 KiB；HTML 副本和后续主题内容统一 1 MiB，外观请求/响应 8 MiB 包含最坏转义。请求/响应完整预算见 USAGE；背景响应嵌套 appearance 也校验完整预算。真实后端已安装这些消费者；复查旧 appearanceApi/store/终端/editor/背景的调用，正式前端仍按 F1 后置，双端消费未完成。完整预算由本域 Shared 定义，不复用任意域的默认 JSON 限额；后端消费者就绪不表示正式前端迁移完成。

html-themes 的四个精确出口包含来源取值、名称/正文/完整编码容量、本地 CRUD/CAS、版本摘要、GitHub repository 与完整 query、远端列表/内容及安全错误 codec；文本内容另用 readHtmlThemeContent 严格解码，不将 text/plain 当 JSON。名称 255 UTF-8 bytes、内容 1 MiB、请求 8 MiB/响应 32 MiB、目录 1,000 项；后端私有在途和自定义数政策不放 Shared。远端列表核对文件名与 downloadUrl 关联；Shared 不含 token、SQL 行、预置正文或存储修订账本。正式前端 F1 尚未消费这些新对象。

外观副本与 HTML 库共用的正文/来源预算由 preferences/values.ts 唯一持有，各子域 values 具名导出，避免同义容量漂移；该基础文件不包含对象或协议结构。

### B8 集成与插件源码边界

Shared agent/integrations的model/http/http-codec/values及browser-*契约由新管理HTTP和模型工具消费者消费；内部配置、存储对象和技术资源保持独立类型并显式投影。秘密只定义写意图与存在标志。Shared agent/plugins已有publisher/stage/verify/install、升级/卸载/取消退役请求、安装/不可变版本/descriptor及严格响应codec。基础预算、entry命名空间和取值归values；32 MiB完整响应容纳当前用户256个stage/版本。新增独立数据/清除请求和安全对象，JSON文本128 KiB、key128 bytes；完整数据写入与RPC消息512 KiB，管理列表仍32 MiB。events/rpc-codec持有两端核心九方法；frontend-events/frontend-rpc-codec精确导出iframe握手、前端26方法及纯解码，实际消费者是Backend HTTP与交付的有限SDK。SDK窗口/MessagePort/计时器归Backend插件frontend Adapter，不进入Shared；host.appInfo和storage.get/put/delete与intents五方法均已有两端实际消费者，前端Agent管理/Run/订阅已有SDK消费者，正式父页F1尚未消费。不能从导出文件存在推断消费者完备。新manifest与正式前端迁移差异归实施方案F1，当前不保留旧Protocol桥。

插件backend-sdk提供纯后端扩展context/请求/安全回复和生命周期类型；NativePluginBackendRuntime是实际consumer，NodeWorker不依赖App类型。repository-model/http/http-codec提供完整仓库设置CAS、目录、stage及推荐响应；版本格式、完整目录容量和源数量在values唯一维护，Shared与包/目录Adapter消费同一版本取值。所有新出口精确列入package.json；后端已接HTTP/Source管理，正式前端对接与浏览器行为仍未完成。

intents 的 intent-values/model/http/http-codec 四个精确出口承载消息创建、接收、撤销、安全视图、分页/容量及严格纯解码；Backend HTTP、前端 SDK/RPC 与后端运行实例都是实际消费者。线协议采用显式inputJson、artifactIds和UUID operationId，冻结双方声明/授权修订；HTTP列表16MiB与RPC512KiB分别检查，不能静默截断。Shared不持有存储grant、密码、进程或Artifact流；文件视图复用agent/artifacts。后端SDK消费当前九方法联合；Artifact分段读取单次128 KiB，带完整receipt/Artifact/范围与规范base64，codec校验请求关联、长度及编码；base64和IPC封装量分别计入预算。正式前端父页仍待F1。

Browser基础动作取值包含全部15项，ToolDefinition的实际生产者消费该类型；settleMs的协议上限在browser-values唯一维护，模型工具描述与应用入参校验共用，Platform不引入该业务容量。

B8 plugins运行时契约按runtime-values（有限状态）、runtime-model（安全实例观察）、runtime-http（完整确认请求）、runtime-http-codec（严格输入、联合状态及确认响应关联）分开，并精确导出。state/revision/instanceId/unknownAt/acknowledgedAt归双端对象，PID、物化路径、journal、账本行与处理政策不进入Shared。确认响应关联原instanceId/instanceRevision及closed，不能把当前安装修订当成原实例修订。正式管理页消费者留F1，不声称已完成前端接线。

### B8 前端SDK扩展与数据迁移

frontend-sdk为实际交付SDK的纯类型；前端消息预算8 MiB+1 KiB包含定义/审批集合与RPC封装，原核心方法子预算和后端IPC仍512 KiB。实际生产者/消费者为后端HTTP及交付SDK；不因扩大前端联合使后台获得Agent管理权限。ThreadView新增必填version/updatedAt；scope/model/codec定义entries与四段码点游标，16片/4096码点/16KiB片段/512KiB完整页，模型文字中emoji/NUL/空白均保留。appendInput带原Run/version、Thread、稳定operationId与新Run输入；响应核对同Thread和不同Run身份。

migration-model持有安全快照与回执，migration-http持有独立写命令，migration-http-codec严格解码全集/唯一键/版本/JSON及请求关联；values持有1024键和52MiB完整预算，精确包出口。真实HTTP有prepare-upgrade/data-snapshot/migrate-data，Model/Adapter类型仍独立。正式迁移面板和父页在F1实现，不提供旧对象兼容。

B8 签名 Skill 文档、解析结果与内部执行输入仅由后端 Tool/Plugin 消费，归 Agent Model，不在 Shared 创建无人消费的 DTO。搜索/读取仍使用原 Shared 工具账本、安全错误和治理基础值；正式前端 F1 消费原工具记录并显示精确名称/版本/hash。B8 两轮源码收口，静态证据见 testing，行为均待 B10。
