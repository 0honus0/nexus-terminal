## 1. 基础能力与现有归属

以下八项已确认，均按“已有基础能力 → 基础插件 → 公共 API”描述，到 API 层为止；名称表示职责，具体契约与发布包划分后续确定。

### Remote

```text
Remote 基础能力（项目已有 SSH、远程进程及 PTY 实现）
    → Remote 基础插件
    → Remote API（命令、进程、终端输入输出、尺寸及生命周期）
```

复用 Backend 原 `modules/remote` 与 `platform/ssh` 的技术实现；插件化后连接目录、凭据及信任业务由 Workspace 连接服务接收，基础能力消费已授权目标，不依赖 Workspace 应用实例。

### RemoteFile

```text
RemoteFile 基础能力（项目已有远程文件实现，以 SFTP 为主）
    → RemoteFile 基础插件
    → RemoteFile API（目录、文件信息、读写、传输、移动及删除）
```

复用 Backend `modules/remote/files`；必要的远端命令沿用已有 Remote 能力，不另建连接管理。

### Database

```text
Database 基础能力（本体现有 SQLite 实现）
    → Database 基础插件
    → Database API（记录读写、条件查询、索引及事务/原子更新）
```

业务数据结构由使用方插件定义，公开契约与数据隔离方式后续细化。Database 操作记录与事务，LocalFile 操作路径、目录和文件字节；插件按需选择，不增设统一 Storage 中间层。

### SecretBox

```text
SecretBox 基础能力（本体现有 Node crypto AES-256-GCM 实现）
    → 加密基础插件
    → 加密 API（字符串加密、解密及上下文绑定）
```

复用 Backend `platform/security/secret-box.ts`，实例密钥由宿主管理，不向插件暴露。上下文由宿主根据调用身份与授权范围绑定，不能由插件任意指定其他用户或插件的范围；上下文校验不代替权限校验。当前仅有内部工具实现，公开 API 尚未实现。

### LocalProcess

```text
LocalProcess 基础能力（Node 子进程）
    → LocalProcess 基础插件
    → LocalProcess API（启动、标准输入输出、退出通知、取消及关闭）
```

支持参数、工作目录与环境变量，进程生命周期绑定插件作用域，不依赖 Agent Run；PTY 按实际需求确定。LocalProcess 负责本机执行，Remote 负责远端执行。MCP stdio、ACP 客户端可使用本机进程能力，其协议与业务仍归普通插件。

### HTTP

```text
HTTP 基础能力（Node HTTP／fetch）
    → HTTP 基础插件
    → HTTP API（请求、流式响应及取消）
```

负责后端出站 HTTP 通信；供应商协议、鉴权方式与重试策略由使用方插件负责。宿主仍负责调用身份、权限与资源生命周期，前端到宿主的通信另归插件宿主机制。

### WebSocket

```text
WebSocket 基础能力（后端 WebSocket 客户端）
    → WebSocket 基础插件
    → WebSocket API（连接、收发、关闭及状态事件）
```

负责后端出站双向通信，连接绑定插件作用域；消息协议、心跳与重连策略由使用方插件负责。浏览器与宿主之间的通信归插件宿主机制。

### LocalFile

```text
LocalFile 基础能力（Node 文件系统）
    → LocalFile 基础插件
    → LocalFile API（目录、文件信息、读写、移动及删除）
```

操作本体所在机器的文件，支持流式读写，访问范围由宿主授权。配置、附件、日志等业务语义由普通插件负责；本机文件操作与 Database 的记录、查询及事务分别提供能力。

## 2. 本体模块分层与目录设计

后续部署归属以 [Workspace 与 Agent 插件化设计](doc/architecture/PLUGINS.md)为准。本节保留六个业务模块的逐文件职责设计，作为迁入各插件时的内部结构参考，不表示这些业务最终全部保留在本体；宿主共用，同进程/同页面执行，不建设插件沙箱。

```text
# 职责参考目录：覆盖当前 Backend 六个模块；业务迁插件、本体保留范围以 PLUGINS.md 为准，尚未实施。
# 文件后缀职责（按实际需要创建，不要求每个子模块配齐）
# -api.ts        定义调用方法、安全输入与输出契约；不配置权限、不实现业务流程或另写转调层
# -service.ts    实现业务用例，协调规则、存储与资源生命周期；复用公共鉴权，不编写 SQL
# -rules.ts      纯业务判断与计算，只消费已提供的事实，不读数据库、不发网络请求
# -policy.ts     组织可配置策略或公共检查组合；具体纯判断复用 rules，执行流程由 service 协调
# -types.ts      所属子模块的内部应用类型；调用契约归 api，存储命令与记录归 storage
# -mapper.ts     应用、存储、技术及公开边界的对象与错误转换；同一边界只有一个转换 owner
# -storage.ts    声明存储能力、存储命令与记录、事务回调契约，不包含 SQL 实现
# -schema.ts     Adapter 内的表、字段、约束及索引定义，由初始化或迁移入口编排
# -sql.ts        SQLite 存储实现，并导出所属表描述：引用 schema、行解码及备份策略；执行 SQL、事务及并发检查
# -register.ts   模块实例创建、依赖注入与生命周期接线；统一配置每个操作的权限及准入方式，应用公共 protect
# -migrations.ts 编排所属 Adapter 的初始化或迁移，不直接编写 SQL；当前开发阶段保持 v1 最终结构
# -context.ts    调用上下文的创建、关联与释放；保存真实来源，不将上下文存在视为授权通过
# -http.ts       HTTP 路由、输入解码及协议结果映射，经 SDK 调用业务，不承载业务流程
# -ws.ts         WS 握手、帧解码与流交付，经 SDK 操作应用资源，不把原始 socket 交给业务 Service
# -codec.ts      外部协议／技术表示的严格解码；双端共有协议解码继续复用 Shared
# -cookie.ts     HTTP Cookie 的读取、设置与清除，不承担会话验证
# -delivery.ts   协议交付、断连及取消的收尾协调，不将交付失败视为业务回滚
# -provider.ts   所属子模块依赖的外部能力契约及请求、结果、失败类型，不实现协议或库调用
# -verifier.ts   Adapter 内的验证协议实现及响应解码，应用准入政策仍归 service 或 rules
# -casl.ts       CASL 技术适配，构造 Ability 并执行判断，不签发身份或保存授权
# -runtime.ts    底层技术资源、执行环境及生命周期实现，不定义业务政策
# -worker.ts     独立后台任务的事件唤醒、消费、恢复与收尾，不继承已结束请求的临时授权
# -row.ts        Adapter 内的数据库行及持久 JSON 解码，不将原始存储表示交给业务层
# 其他能力文件按具体职责命名，如 password-hasher.ts、secret-box.ts、ip.ts，不另设杂项工具层

packages/backend/
├── package.json                                                   # 私有后端依赖、检查、构建与运行入口
├── tsconfig.json                                                  # 后端 TypeScript 编译边界
└── src/
    ├── main.ts                                                    # 进程启动、信号与致命错误处理，将环境配置交给 Bootstrap
    ├── bootstrap/                                                 # 宿主装配与全局生命周期，不承载业务规则或协议处理
    │   ├── create-app.ts                                          # 创建／重建应用实例，协调监听器、资源排空与恢复维护，关闭不等待自身
    │   ├── module-manifest.ts                                     # 装配六个业务模块、受保护 SDK 与通信入口，按依赖顺序收尾
    │   ├── data-paths.ts                                          # 统一派生数据库、背景资源及挂起日志路径，不决定业务备份政策
    │   ├── oidc-environment.ts                                    # 严格读取 OIDC 安装环境变量，交给 Access 配置用例
    │   ├── schema.ts                                              # 汇总各模块初始化／迁移入口及表描述，开发阶段采用 v1 最终结构
    │   └── startup-configuration-failure.ts                       # 启动配置的具名失败，只公开配置项名称，不泄露秘密值
    ├── modules/                                                   # 当前六个业务模块；业务权限、事务要求、审计及资源生命周期归各真实 owner
    │   ├── access/                                                # 认证、授权、账号与来源准入；认证协议 Adapter 归实际子模块
    │   │   ├── access-api.ts                                      # 聚合对外业务分组；会话签发、认证上下文工厂不导出给插件
    │   │   ├── access-register.ts                                 # 创建实例，配置各操作权限并应用 Access protect，接线改密事务参与者、表描述及生命周期
    │   │   ├── access-migrations.ts                               # 编排各 Adapter 的初始化；开发阶段直接创建 v1 最终结构
    │   │   ├── access-mapper.ts                                   # 共用错误定义及对内、对外错误转换，集中在一个文件
    │   │   ├── accounts/                                          # 账号与密码认证修订
    │   │   │   ├── accounts-api.ts                                # 管理员初始化、账号读取与改密契约，权限在 access-register.ts 配置
    │   │   │   ├── accounts-service.ts                            # 账号规则与改密／撤销会话流程协调，公共授权由统一入口执行
    │   │   │   ├── accounts-types.ts                              # accounts 内部实现类型，不作为子模块调用契约
    │   │   │   ├── accounts-rules.ts                              # 用户名、密码等纯业务规则，不重复管理员及资源权限判断
    │   │   │   ├── accounts-mapper.ts                             # 必要的应用／存储对象转换；简单转换留所属文件
    │   │   │   ├── accounts-storage.ts                            # 账号存储、改密外层事务及关联撤销参与者契约，不执行 SQL
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── accounts-schema.ts                     # 账号表、密码认证修订及索引
    │   │   │           └── accounts-sql.ts                        # 账号及密码修订读写；改密事务调用注入的会话撤销参与者，认证数据排除备份
    │   │   ├── authentication/                                    # 凭据验证、登录、退出与密码复核
    │   │   │   ├── authentication-api.ts                          # 登录、身份认证、退出及密码复核契约，准入方式在 access-register.ts 配置
    │   │   │   ├── authentication-service.ts                      # 验证真实凭据，协调账号、会话及认证因素，不承担业务操作授权
    │   │   │   └── authentication-types.ts                        # 内部登录流程、认证证明及结果类型
    │   │   ├── authorization/                                     # 公共认证／授权策略与 CASL 接入
    │   │   │   ├── authorization-api.ts                           # 授权管理及宿主内部 protect、AccessCallScope、AuthorizedCall 契约
    │   │   │   ├── authorization-service.ts                       # protect 统一执行公共检查，协调 withOperation、事务复查及失效生命周期
    │   │   │   ├── authorization-types.ts                         # 内部调用者、授权规则与判定类型，不暴露 CASL 实例
    │   │   │   ├── authorization-policy.ts                        # authenticated、administrator、permission、passwordProof 公共检查，供 register 组合
    │   │   │   ├── authorization-rules.ts                         # 管理员资格及 CASL 规则，用户、插件、工作区授权范围取交集
    │   │   │   ├── authorization-mapper.ts                        # 授权记录与应用规则、事务授权事实的转换
    │   │   │   ├── authorization-storage.ts                       # 授权读写及事务准入契约，不执行 SQL
    │   │   │   └── adapters/
    │   │   │       ├── casl/
    │   │   │       │   └── authorization-casl.ts                  # assertAllowed：创建 Ability、显式指定 subject、调用 CASL 判断
    │   │   │       └── sqlite/
    │   │   │           ├── authorization-schema.ts                # 授权记录与必要索引，按实际持久化需求定义
    │   │   │           └── authorization-sql.ts                   # 授权读写、事务内事实读取及 withTransactionAdmission 适配
    │   │   ├── sessions/                                          # 完整登录会话，不与远端终端会话混用
    │   │   │   ├── sessions-api.ts                                # Access 内部会话契约，不向插件提供会话签发能力
    │   │   │   ├── sessions-service.ts                            # 签发、验证、撤销及过期清理，不再承担封禁管理
    │   │   │   ├── sessions-types.ts                              # 内部会话身份、签发及验证结果
    │   │   │   ├── sessions-mapper.ts                             # 存储会话与内部对象转换
    │   │   │   ├── sessions-storage.ts                            # 会话存储、事务内身份读取与撤销参与者契约，供改密等流程组合
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── sessions-schema.ts                     # 完整登录会话表及索引
    │   │   │           └── sessions-sql.ts                        # 会话读写及清理；提供身份读取与撤销参与者，共用调用方事务
    │   │   ├── login-options/                                     # 公开登录选项及缓存生命周期
    │   │   │   ├── login-options-api.ts                           # 可用登录方式与验证码公开配置的读取契约
    │   │   │   ├── login-options-service.ts                       # 聚合 CAPTCHA、OIDC、Passkey 展示信息，只缓存公开元数据
    │   │   │   └── login-options-types.ts                         # 内部展示快照类型，不存储授权结论或私密凭据
    │   │   ├── captcha/                                           # CAPTCHA 配置与供应商验证
    │   │   │   ├── captcha-api.ts                                 # Access 内部验证码验证及公开配置读取契约
    │   │   │   ├── captcha-service.ts                             # 验证码启用判断、验证流程及失败处理，不直接调用供应商 HTTP
    │   │   │   ├── captcha-types.ts                               # 内部配置及验证流程类型，秘密不进入公开配置
    │   │   │   ├── captcha-rules.ts                               # 配置合法性及令牌输入的纯校验，不承担供应商协议验证
    │   │   │   ├── captcha-mapper.ts                              # 应用请求与 provider 契约、公开配置及具名失败转换，不实现 HTTP
    │   │   │   ├── captcha-provider.ts                            # 供应商验证能力契约；区分验证不通过与技术不可用
    │   │   │   └── adapters/
    │   │   │       └── http/
    │   │   │           └── captcha-verifier.ts                    # hCaptcha／reCAPTCHA 出站 HTTP、响应解码及供应商协议检查
    │   │   ├── totp/                                              # TOTP 绑定、二阶段验证及原子消费
    │   │   │   ├── totp-api.ts                                    # 绑定、关闭及二阶段登录契约，完整／部分认证准入在 register 配置
    │   │   │   ├── totp-service.ts                                # 设置、激活、关闭及二阶段流程；通过注入能力验证，存储负责原子消费
    │   │   │   ├── totp-types.ts                                  # TOTP 内部类型
    │   │   │   ├── totp-rules.ts                                  # 验证码格式等纯业务规则，不重复通用授权
    │   │   │   ├── totp-mapper.ts                                 # 存储、密文及 TOTP 技术结果与应用对象转换
    │   │   │   ├── totp-storage.ts                                # TOTP 配置、绑定挑战及待完成登录的存储契约
    │   │   │   ├── totp-provider.ts                               # TOTP 生成与验证能力契约，不包含账号或会话政策
    │   │   │   └── adapters/
    │   │   │       ├── otplib/
    │   │   │       │   └── totp-verifier.ts                       # 复用原 rfc-totp 实现：otplib／qrcode 调用及协议参数
    │   │   │       └── sqlite/
    │   │   │           ├── totp-schema.ts                         # TOTP 所属表定义
    │   │   │           └── totp-sql.ts                            # TOTP 挑战与待完成登录的原子消费
    │   │   ├── passkeys/                                          # WebAuthn 注册、登录与凭据管理
    │   │   │   ├── passkeys-api.ts                                # 注册及凭据管理契约、独立匿名登录契约，权限及准入在 register 配置
    │   │   │   ├── passkeys-service.ts                            # 注册、登录及凭据管理流程，通过注入能力验签
    │   │   │   ├── passkeys-types.ts                              # Passkey 内部类型
    │   │   │   ├── passkeys-rules.ts                              # 默认命名、凭据名称等业务规则
    │   │   │   ├── passkeys-mapper.ts                             # WebAuthn 技术结果、存储记录与应用对象转换
    │   │   │   ├── passkeys-storage.ts                            # Passkey 凭据、注册与登录挑战的存储契约
    │   │   │   ├── passkeys-provider.ts                           # WebAuthn 生成与验签能力契约，不暴露第三方库类型
    │   │   │   └── adapters/
    │   │   │       ├── webauthn/
    │   │   │       │   ├── passkeys-verifier.ts                   # SimpleWebAuthn 调用、协议校验及技术响应解码
    │   │   │       │   └── passkeys-authenticators.ts             # 验证器名称元数据，不作为信任证据
    │   │   │       └── sqlite/
    │   │   │           ├── passkeys-schema.ts                     # Passkey 所属表定义
    │   │   │           └── passkeys-sql.ts                        # 挑战消费、凭据更新及计数器并发检查
    │   │   ├── oidc/                                              # OIDC 配置、绑定与单点登录
    │   │   │   ├── oidc-api.ts                                    # 配置、绑定管理、匿名登录及回调契约，权限及准入在 register 配置
    │   │   │   ├── oidc-service.ts                                # 配置、回调、绑定及登录流程；委托注入能力验证协议，保留密码复核
    │   │   │   ├── oidc-types.ts                                  # OIDC 内部类型
    │   │   │   ├── oidc-rules.ts                                  # 配置合法性、绑定与授权流程有效性规则
    │   │   │   ├── oidc-mapper.ts                                 # 提供方结果、存储记录与内部对象转换
    │   │   │   ├── oidc-storage.ts                                # OIDC 配置、流程与会话关联的存储契约
    │   │   │   ├── oidc-provider.ts                               # 授权地址生成与回调验证契约，不包含账号绑定政策
    │   │   │   └── adapters/
    │   │   │       ├── openid-client/
    │   │   │       │   └── oidc-client.ts                         # openid-client 调用、发现、令牌交换及协议验证
    │   │   │       └── sqlite/
    │   │   │           ├── oidc-schema.ts                         # OIDC 所属表定义
    │   │   │           └── oidc-sql.ts                            # OIDC 流程消费及持久化事务
    │   │   └── admission/                                         # 来源准入、失败计数及封禁
    │   │       ├── admission-api.ts                               # 来源准入及封禁管理契约，管理权限在 register 配置
    │   │       ├── admission-service.ts                           # 白名单、封禁、失败计数及解除流程，不重复管理员判定
    │   │       ├── admission-policy.ts                            # 登录失败封禁策略、配置校验与热更新
    │   │       ├── admission-rules.ts                             # 内网豁免、白名单与失败计数状态转换，通用 IP 运算归 utils
    │   │       ├── admission-types.ts                             # 内部准入、封禁及失败记录类型
    │   │       ├── admission-mapper.ts                            # 登录失败存储记录与应用对象转换
    │   │       ├── admission-storage.ts                           # 登录失败计数、封禁查询及解除的存储契约
    │   │       └── adapters/
    │   │           └── sqlite/
    │   │               ├── admission-schema.ts                    # 从 sessions 归入的登录失败及封禁记录表
    │   │               └── admission-sql.ts                       # 失败计数、封禁、解除及清理事务
    │   ├── operations/                                            # 审计、日志配置与通知；统一接收模块内部业务／安全事件
    │   │   ├── operations-api.ts                                  # 聚合 audit、logging、notifications；受信事件发布仅供宿主内部调用
    │   │   ├── operations-register.ts                             # 创建子模块，配置权限并应用 Access protect，汇总表描述，接线同事务写入及生命周期
    │   │   ├── operations-migrations.ts                           # 编排审计、日志配置及通知表初始化；开发阶段直接创建 v1 最终结构
    │   │   ├── operations-service.ts                              # 跨子模块事件编排，追踪发布与收尾，协调通知唤醒及已处理审计裁剪
    │   │   ├── operations-mapper.ts                               # 共用错误定义及对内／对外映射，受信事件与存储任务转换
    │   │   ├── operations-storage.ts                              # 跨子模块事件原子写入契约；审计 Adapter 持有事务，注入通知 pending 写入能力
    │   │   ├── audit/                                             # 业务与安全审计的查询及保留
    │   │   │   ├── audit-api.ts                                   # 审计分页查询契约；裁剪能力仅供宿主内部协作
    │   │   │   ├── audit-service.ts                               # 查询、分页及保留政策，只裁剪已完成通知分发的旧审计
    │   │   │   ├── audit-types.ts                                 # 审计内部查询、记录及分页类型
    │   │   │   ├── audit-rules.ts                                 # 事件、查询条件与时间范围等纯业务校验
    │   │   │   ├── audit-mapper.ts                                # 审计存储记录、应用结果及安全出口转换
    │   │   │   ├── audit-storage.ts                               # 审计查询与裁剪契约，事件追加另实现 operations-storage.ts 的原子写入契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── audit-schema.ts                        # operations_audit 表、唯一事件键及时间索引
    │   │   │           └── audit-sql.ts                           # 审计表描述、行解码及读写；追加去重与注入的 pending 写入共用同一事务
    │   │   ├── logging/                                           # 持久日志等级及实际生效状态
    │   │   │   ├── logging-api.ts                                 # 已保存／实际生效日志等级读取与更新契约
    │   │   │   ├── logging-service.ts                             # 初始默认、配置保存及按版本激活；复用宿主唯一 Logger
    │   │   │   ├── logging-types.ts                               # 日志配置、应用状态及激活事实的内部类型
    │   │   │   ├── logging-rules.ts                               # 日志等级、配置版本校验及事件严重程度等纯规则
    │   │   │   ├── logging-mapper.ts                              # 配置存储转换、Logger 技术调用与失败转换，不另建日志组件
    │   │   │   ├── logging-storage.ts                             # 配置读取、原版本更新及事务授权复查契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── logging-schema.ts                      # operations_logging 单例配置表
    │   │   │           └── logging-sql.ts                         # 日志表描述、解码及配置读写；版本检查复用公共事务准入
    │   │   └── notifications/                                     # 渠道配置、事件分发、投递账本与恢复
    │   │       ├── notifications-api.ts                           # 渠道管理、配置测试与投递查询契约，读取不返回秘密正文
    │   │       ├── notifications-service.ts                       # 配置、秘密保留／清除／替换、测试受理与分发政策，写入后唤醒 worker
    │   │       ├── notifications-types.ts                         # 渠道、配置、派发任务、恢复及结算的内部类型
    │   │       ├── notifications-rules.ts                         # 渠道合法性、订阅选择、模板渲染及状态转换等纯规则
    │   │       ├── notifications-worker.ts                        # 事件唤醒后处理待分发及排队投递，独立追踪发送、恢复、取消与最终结算
    │   │       ├── notifications-mapper.ts                        # 存储／应用及 SecretBox／Delivery 技术契约转换，实际 HTTP／SMTP 发送归 Platform Adapter
    │   │       ├── notifications-storage.ts                       # 配置版本、待分发与已分发状态、投递快照及结算事务契约
    │   │       └── adapters/
    │   │           └── sqlite/
    │   │               ├── notifications-schema.ts                # 渠道、pending、fanout 及 deliveries 四张表与索引
    │   │               ├── notifications-row.ts                   # 配置 JSON、渠道及投递记录解码，运行时与恢复共用
    │   │               └── notifications-sql.ts                   # 四张表描述与读写、备份秘密转换及恢复校验；pending 写入共用外层事务
    │   ├── preferences/                                           # 安装配置、个人偏好、快捷命令、历史、收藏与外观资源
    │   │   ├── preferences-api.ts                                 # 聚合配置、布局、命令、历史、收藏、终端主题及外观业务分组
    │   │   ├── preferences-register.ts                            # 先创建内部配置读取能力，再配置权限并装配 Access protect，汇总表描述及生命周期
    │   │   ├── preferences-migrations.ts                          # 编排各子模块表初始化／迁移，不直接编写 SQL
    │   │   ├── preferences-mapper.ts                              # Preferences 共用应用／安全错误及存储失败转换，收敛分散的错误文件
    │   │   ├── preferences-lifecycle.ts                           # 协调已受理写入、配置激活和资源清理，关闭共享同一完成结果
    │   │   ├── configuration/                                     # 安装配置与生效版本，向 Access、Remote 提供明确的运行配置
    │   │   │   ├── configuration-api.ts                           # 配置读取、更新与安装快照契约，内部安装读取不开放给插件，秘密仅输出存在状态
    │   │   │   ├── configuration-service.ts                       # 初始配置、CAS 保存及热更新协调，区分持久版本与实际激活版本
    │   │   │   ├── configuration-types.ts                         # 配置、秘密修改意图、安装快照及更新结果的内部类型
    │   │   │   ├── configuration-rules.ts                         # 配置合法性、站点与策略取值的纯校验；通用 IP 运算复用 utils/ip.ts
    │   │   │   ├── configuration-mapper.ts                        # 应用／存储／安全契约转换及 SecretBox 调用边界，不直接实现加密
    │   │   │   ├── configuration-storage.ts                       # 单例配置、原版本更新及事务授权复查契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── configuration-schema.ts                # 配置表、版本与约束
    │   │   │           ├── configuration-row.ts                   # 持久配置 JSON、密文及关联字段解码，运行与恢复共用
    │   │   │           └── configuration-sql.ts                   # 配置表描述、秘密备份转换、读写与 CAS 事务
    │   │   ├── presentation/                                      # 个人布局、终端显示偏好与工作区呈现
    │   │   │   ├── presentation-api.ts                            # 当前用户的布局／偏好读取与完整版本写入契约
    │   │   │   ├── presentation-service.ts                        # 布局与偏好用例，保存完整快照并保留版本冲突结果
    │   │   │   ├── presentation-types.ts                          # 独立布局联合、偏好与编辑版本的内部类型
    │   │   │   ├── presentation-rules.ts                          # 布局结构、活动项与关联一致性纯校验
    │   │   │   ├── presentation-defaults.ts                       # 初始偏好与布局默认值，不隐式覆盖已有记录
    │   │   │   ├── presentation-mapper.ts                         # 布局／偏好的应用、存储及安全输出逐字段转换
    │   │   │   ├── presentation-storage.ts                        # 当前用户布局与偏好读取、CAS 更新及事务准入契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── presentation-schema.ts                 # 布局与偏好表、归属和版本约束
    │   │   │           ├── presentation-row.ts                    # 持久布局与偏好 JSON 解码
    │   │   │           └── presentation-sql.ts                    # 表描述、备份校验与当前用户范围内的读写事务
    │   │   ├── commands/                                          # 快捷命令、标签、变量与批量编辑
    │   │   │   ├── commands-api.ts                                # 命令／标签查询及单项、批量修改契约
    │   │   │   ├── commands-service.ts                            # 命令、标签与分组操作流程，整批校验并保留实际提交结果
    │   │   │   ├── commands-types.ts                              # 命令、标签、变量及批量任务内部类型
    │   │   │   ├── commands-rules.ts                              # 命令输入、变量及批量成员版本的纯校验
    │   │   │   ├── commands-mapper.ts                             # 命令、标签、变量与批量任务的应用／存储／安全结果转换
    │   │   │   ├── commands-storage.ts                            # 命令和标签查询、批量版本写入与事务授权回调契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── commands-schema.ts                     # 命令、标签及关联表和索引
    │   │   │           ├── commands-row.ts                        # 命令、变量及关联记录完整持久解码
    │   │   │           └── commands-sql.ts                        # 所属表描述、关联恢复校验及命令／标签批量写入事务
    │   │   ├── history/                                           # 命令历史与目录历史，按当前用户隔离
    │   │   │   ├── history-api.ts                                 # 命令／目录历史分页、记录与清理契约
    │   │   │   ├── history-service.ts                             # 历史记录、去重、分页与保留策略，不把远端执行结果等同于历史保存结果
    │   │   │   ├── history-types.ts                               # 命令／目录历史、分页与写入结果内部类型
    │   │   │   ├── history-mapper.ts                              # 独立历史对象与存储记录、安全契约及失败转换
    │   │   │   ├── history-storage.ts                             # 历史分页、去重写入及清理事务契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── history-schema.ts                      # 命令／目录历史表、去重及分页索引
    │   │   │           ├── history-row.ts                         # 历史记录、类型与时间关系解码
    │   │   │           └── history-sql.ts                         # 历史表描述、备份规则及当前用户范围内的读写事务
    │   │   ├── favorites/                                         # 个人文件／目录收藏及排序
    │   │   │   ├── favorites-api.ts                               # 收藏查询、新建、编辑、排序、使用记录与删除契约
    │   │   │   ├── favorites-service.ts                           # 当前用户收藏用例，复用公共鉴权并保留原版本检查
    │   │   │   ├── favorites-types.ts                             # 收藏、查询、编辑与排序的内部类型
    │   │   │   ├── favorites-mapper.ts                            # 收藏对象、存储命令和安全输出转换，纯校验留本功能 owner
    │   │   │   ├── favorites-storage.ts                           # 收藏读写、排序与触达时间事务契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── favorites-schema.ts                    # 收藏表、归属、版本及排序索引
    │   │   │           ├── favorites-row.ts                       # 收藏记录与时间关系完整解码
    │   │   │           └── favorites-sql.ts                       # 收藏表描述、备份校验及用户范围内的 CAS 写入
    │   │   ├── themes/                                            # 终端配色主题、预置主题与导入
    │   │   │   ├── themes-api.ts                                  # 终端主题查询、编辑、克隆、删除与导入契约
    │   │   │   ├── themes-service.ts                              # 主题管理、预置初始化和导入流程，保持主题编辑版本
    │   │   │   ├── themes-types.ts                                # 终端配色、主题记录、种子与导入内部类型
    │   │   │   ├── themes-rules.ts                                # 颜色键、主题输入、命名及导入的纯校验
    │   │   │   ├── themes-presets.ts                              # 已有终端预置主题内容与初始化来源
    │   │   │   ├── themes-mapper.ts                               # 应用主题、持久颜色文档及公开颜色对象转换
    │   │   │   ├── themes-storage.ts                              # 主题读取、预置初始化与版本写入事务契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── themes-schema.ts                       # 终端主题表及名称、版本约束
    │   │   │           ├── themes-row.ts                          # 持久颜色文档与主题记录解码
    │   │   │           └── themes-sql.ts                          # 主题表描述、备份校验及主题读写事务
    │   │   └── appearance/                                        # 应用外观、背景图片与 HTML 主题库；各职责以 appearance 前缀平铺
    │   │       ├── appearance-api.ts                              # 外观设置、背景资源及本地／远端 HTML 主题的业务契约
    │   │       ├── appearance-service.ts                          # 外观读取、编辑与活动主题副本更新，协调关联资源版本
    │   │       ├── appearance-types.ts                            # 外观、变量、编辑事实与结果的内部类型
    │   │       ├── appearance-rules.ts                            # 外观输入、CSS 变量及关联状态的纯校验
    │   │       ├── appearance-defaults.ts                         # 应用默认 UI 主题变量，收敛原 default-ui-theme.ts
    │   │       ├── appearance-mapper.ts                           # 外观应用对象、持久文档及安全结果转换
    │   │       ├── appearance-storage.ts                          # 外观配置读取与 CAS 更新契约
    │   │       ├── appearance-background-service.ts               # 背景上传、暂存、发布、切换和孤立文件清理的完整生命周期
    │   │       ├── appearance-background-types.ts                 # 背景上传、图片检查与应用内容资源类型
    │   │       ├── appearance-background-rules.ts                 # 背景媒体类型与操作条件的纯校验
    │   │       ├── appearance-background-mapper.ts                # 图片／Blob 技术能力、背景记录及应用资源转换，不暴露本地路径或技术句柄
    │   │       ├── appearance-background-storage.ts               # 背景元数据、激活、移除及清理候选事务契约
    │   │       ├── appearance-html-themes-service.ts              # 本地 HTML 主题 CRUD、活动副本与远端主题获取流程
    │   │       ├── appearance-html-themes-types.ts                # HTML 主题、远端来源、内容及编辑版本的内部类型
    │   │       ├── appearance-html-themes-rules.ts                # 内容、来源、名称及更新条件纯校验，不执行网络请求
    │   │       ├── appearance-html-themes-presets.ts              # 内置 HTML 主题预置内容
    │   │       ├── appearance-html-themes-mapper.ts               # HTML 主题应用／存储／远端技术结果转换
    │   │       ├── appearance-html-themes-storage.ts              # HTML 主题本地列表、正文及版本更新契约
    │   │       ├── appearance-html-themes-provider.ts             # 远端 HTML 主题目录与内容读取契约，不与 SQL 存储契约混放
    │   │       └── adapters/
    │   │           ├── github/
    │   │           │   └── appearance-html-themes-catalog.ts      # GitHub 目录、下载地址与正文协议接入，复用 Platform Network
    │   │           └── sqlite/
    │   │               ├── appearance-schema.ts                   # 外观配置表与关联约束
    │   │               ├── appearance-row.ts                      # 外观及 UI 变量持久文档解码
    │   │               ├── appearance-sql.ts                      # 外观表描述、备份校验与配置 CAS 事务
    │   │               ├── appearance-background-schema.ts        # 背景元数据表与清理状态约束
    │   │               ├── appearance-background-row.ts           # 背景元数据与文件引用持久解码
    │   │               ├── appearance-background-sql.ts           # 背景表描述、备份文件引用及元数据／激活事务，不自行复制物理文件
    │   │               ├── appearance-html-themes-schema.ts       # HTML 主题库表、来源、名称与版本约束
    │   │               ├── appearance-html-themes-row.ts          # HTML 主题持久正文、来源与记录解码
    │   │               └── appearance-html-themes-sql.ts          # HTML 主题表描述、恢复关联校验与本地读写事务
    │   ├── remote/                                                # 真实 SSH、终端、远程文件、桌面、观测、工具安装与后台传输的业务生命周期
    │   │   ├── remote-api.ts                                      # 聚合各子模块安全用例；宿主内部机器能力与外部 SDK 方法明确分开
    │   │   ├── remote-register.ts                                 # 配置权限并装配 Access protect、资源 owner、技术能力、事件订阅及表描述，协调停机排空
    │   │   ├── remote-migrations.ts                               # 编排机器突变与桌面证书信任表初始化／迁移
    │   │   ├── remote-mapper.ts                                   # Remote 共用应用／安全错误及技术、存储失败转换，保留清理失败与执行未知类别
    │   │   ├── machines/                                          # SSH 机器打开与释放、连接测试，以及跨功能机器突变围栏
    │   │   │   ├── machines-api.ts                                # 宿主内部机器能力及连接测试、突变恢复管理契约
    │   │   │   ├── machines-service.ts                            # 目标解析、机器打开和释放流程，技术资源由 mapper 封装为应用能力
    │   │   │   ├── machines-mapper.ts                             # Targets 可信目标与 SSH 能力转换，封装技术资源并保留主机信任挑战
    │   │   │   ├── machines-types.ts                              # 机器打开请求、应用资源及目标身份内部类型
    │   │   │   ├── machines-tests-service.ts                      # 已保存／草稿连接测试，跟踪真实握手、取消、关闭与交付前权限复查
    │   │   │   ├── machines-tests-types.ts                        # 已保存／草稿连接测试请求、延迟与主机信任结果
    │   │   │   ├── machines-tests-mapper.ts                       # 测试应用请求与机器能力、安全测试结果和具名失败转换
    │   │   │   ├── machines-mutations-service.ts                  # 机器写入 claim 准入、执行、结算及未知结果围栏，供文件／Docker／安装／传输复用
    │   │   │   ├── machines-mutations-recovery-service.ts         # 恢复列表、证据记录与人工解除，不把解除围栏当成原操作成功
    │   │   │   ├── machines-mutations-types.ts                    # claim、资源冲突集合、证据与人工恢复内部类型
    │   │   │   ├── machines-mutations-mapper.ts                   # 应用围栏／恢复对象、持久记录和公开观察转换
    │   │   │   ├── machines-mutations-storage.ts                  # claim 获取、当前事实复查、结算、证据及解除事务契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── machines-mutations-schema.ts           # 持久机器突变、冲突资源与恢复证据表及索引
    │   │   │           ├── machines-mutations-row.ts              # 围栏、状态及恢复证据的完整持久解码
    │   │   │           └── machines-mutations-sql.ts              # 所属表描述、恢复状态校验及 claim／证据原子写入，不自动解除未知围栏
    │   │   ├── sessions/                                          # PTY 与 Workspace 的唯一资源登记，以及挂起、恢复、目录和输出历史
    │   │   │   ├── sessions-api.ts                                # 终端与 Workspace 创建、输入、缩放、订阅、关闭及挂起恢复契约
    │   │   │   ├── sessions-service.ts                            # 底层应用终端资源的创建、输入输出、尺寸与关闭流程
    │   │   │   ├── sessions-owner.ts                              # 真实终端归属与附件生命周期，移除重复身份判定后保留资源追踪与释放
    │   │   │   ├── sessions-types.ts                              # 终端状态、应用资源及关闭结果内部类型
    │   │   │   ├── sessions-mapper.ts                             # 机器 PTY、令牌技术能力、应用终端与失败转换，不暴露 ssh2 句柄
    │   │   │   ├── sessions-policy.ts                             # 现有保留期限、任务准入与资源配置的唯一 owner，不向各调用层复制常量
    │   │   │   ├── sessions-workspace-service.ts                  # Workspace 生命周期与唯一登记，协调终端、文件附件、挂起、恢复 ACK 和租约
    │   │   │   ├── sessions-workspace-types.ts                    # Workspace 状态、附件、回放、检查点与挂起目录内部类型
    │   │   │   ├── sessions-workspace-mapper.ts                   # Workspace 与终端／日志／检查点能力及安全快照转换，资源留原 owner
    │   │   │   ├── sessions-history-mapper.ts                     # 历史页、日志范围与检查点转换，保持偏移、输出顺序和资源释放
    │   │   │   ├── sessions-shell-service.ts                      # 目录跟踪、提示符同步、清行提示与目录切换流程，不写入额外终端命令队列
    │   │   │   ├── sessions-shell-mapper.ts                       # Shell Integration、目录探测与应用事件转换，隐藏技术能力
    │   │   │   └── sessions-command-owner.ts                      # 目录探测所用短期命令资源，追踪真实结束、取消与未确认清理
    │   │   ├── files/                                             # SFTP 文件管理、编辑、搜索、上传下载、复制移动及归档
    │   │   │   ├── files-api.ts                                   # 文件目录、元数据、内容、上传下载与后台文件任务的安全契约
    │   │   │   ├── files-service.ts                               # 文件操作准入与任务生命周期，绑定原 Workspace、授权及机器突变围栏
    │   │   │   ├── files-types.ts                                 # 文件元数据、目录与读写请求的内部应用类型
    │   │   │   ├── files-task-types.ts                            # 复制移动、归档与进度事件的内部类型
    │   │   │   ├── files-upload-types.ts                          # 上传冲突策略、暂存与流式附件内部类型
    │   │   │   ├── files-mapper.ts                                # 机器／SFTP 能力、应用文件对象及技术失败转换
    │   │   │   ├── files-resource.ts                              # 封装应用文件资源与 SFTP 租约，维护暂存／提交／关闭和背压，不成为第二套 SSH 实现
    │   │   │   ├── files-text-mapper.ts                           # 文本编解码、换行与编辑请求转换，复用 Platform Text
    │   │   │   ├── files-archive-mapper.ts                        # 原生归档能力、应用归档计划及结果转换，复用 Platform Archive
    │   │   │   ├── files-zip-mapper.ts                            # 目录 ZIP 流、应用下载源与清理结果转换
    │   │   │   ├── files-archive-service.ts                       # 压缩／解压计划、依赖检查、原地及暂存写入和结果确认
    │   │   │   ├── files-copy-service.ts                          # 多项复制／移动计划、总进度、冲突与实际远端结果结算
    │   │   │   ├── files-search-service.ts                        # 文件搜索、取消和增量交付，保持完整结果与应用路径语义
    │   │   │   ├── files-directory-zip-service.ts                 # 目录打包下载的业务流程与交付收尾
    │   │   │   ├── files-archive-rules.ts                         # 归档列表、符号／硬链接目标及路径关系的纯校验
    │   │   │   ├── files-download-rules.ts                        # 下载 Range 与当前内容条件的纯判断
    │   │   │   ├── files-mutation-queue.ts                        # 按真实读写冲突集合组织文件任务，完成与清理前保留原占用
    │   │   │   └── files-download-tickets.ts                      # 下载凭据签发、一次性消费、过期与原身份绑定，后续读取仍检查当前权限
    │   │   ├── monitoring/                                        # 远端状态趋势、后台资源观测与 Docker 管理
    │   │   │   ├── monitoring-api.ts                              # 状态订阅、资源查询、Docker 列表／统计／控制契约
    │   │   │   ├── monitoring-service.ts                          # 采集、Docker 操作及订阅生命周期；远端写操作复用机器突变围栏
    │   │   │   ├── monitoring-types.ts                            # 状态样本、Docker 对象与资源观察内部类型
    │   │   │   ├── monitoring-mapper.ts                           # Platform Status／Docker 与应用观察、安全事件转换，按实际口径保留缺测
    │   │   │   ├── monitoring-targets.ts                          # 归一实际观测目标与采样键，复用同一采样 owner
    │   │   │   └── monitoring-resources-service.ts                # 后台 SSH 资源采样与订阅收尾，复用已有机器能力
    │   │   ├── desktop/                                           # RDP／VNC 连接票据、证书信任与桌面连接生命周期
    │   │   │   ├── desktop-api.ts                                 # 桌面连接签发、证书确认、通道接入与关闭的安全契约
    │   │   │   ├── desktop-service.ts                             # 票据、连接归属、证书确认和运行连接管理，持续复查授权
    │   │   │   ├── desktop-types.ts                               # 桌面连接、证书观察、显示参数与应用通道内部类型
    │   │   │   ├── desktop-mapper.ts                              # Targets 可信目标、DesktopTransport、证书存储与应用资源转换，不接收原始 WS
    │   │   │   ├── desktop-storage.ts                             # 记住证书信任、原指纹 CAS 与事务授权复查契约
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           ├── desktop-certificates-schema.ts         # RDP 证书信任表及用户／端点唯一约束
    │   │   │           └── desktop-certificates-sql.ts            # 证书表描述、恢复解码和当前身份／原指纹事务写入
    │   │   ├── tools/                                             # 远端依赖检测、安装确认与执行
    │   │   │   ├── tools-api.ts                                   # 工具检查、安装计划与用户确认执行契约
    │   │   │   ├── tools-service.ts                               # 检测、短期计划、确认消费、机器突变 claim 与安装收尾
    │   │   │   ├── tools-types.ts                                 # 缺失工具、计划、安装结果及状态的内部类型
    │   │   │   └── tools-mapper.ts                                # 机器／工具安装能力与应用计划、结果及具名失败转换
    │   │   └── transfers/                                         # 独立后台跨服务器传输任务，不依赖前端附件长期存活
    │   │       ├── transfers-api.ts                               # 任务创建、列表、观察、取消与完成事件契约
    │   │       ├── transfers-service.ts                           # 父子任务、源／目标授权、机器 claim、进度与取消／未知结果结算
    │   │       ├── transfers-types.ts                             # 父子任务状态、实际传输方式、进度与结果内部类型
    │   │       └── transfers-mapper.ts                            # 机器／Transfer 能力、应用任务及安全状态转换，凭据不进入公开结果
    │   ├── system/                                                # 宿主诊断、本机状态与全局备份恢复业务
    │   │   ├── system-api.ts                                      # 聚合 diagnostics、status、backups；维护控制仅供宿主内部装配
    │   │   ├── system-register.ts                                 # 注入诊断、备份引擎及宿主维护能力，配置权限并装配 Access protect 与停机收尾
    │   │   ├── system-mapper.ts                                   # 共用应用／安全错误及底层失败转换，保留提交未知与清理失败
    │   │   ├── diagnostics/                                       # 进程、SQLite 与各模块资源观测，不拥有被观测模块的业务状态
    │   │   │   ├── diagnostics-api.ts                             # 宿主诊断快照与可信资源采集注册契约
    │   │   │   ├── diagnostics-service.ts                         # 聚合进程、数据库与已注册模块指标，追踪采样取消与收尾
    │   │   │   ├── diagnostics-types.ts                           # 诊断快照、指标与数据库可用状态的内部类型
    │   │   │   ├── diagnostics-mapper.ts                          # ProcessDiagnostic、资源采集和存储事实到应用／公开诊断的转换
    │   │   │   ├── diagnostics-storage.ts                         # 数据库版本／可用性读取契约，不拥有新的业务表
    │   │   │   └── adapters/
    │   │   │       └── sqlite/
    │   │   │           └── diagnostics-sql.ts                     # 只读数据库元信息，不另建诊断表或独立备份清单
    │   │   ├── status/                                            # 本机健康和系统状态，不与 Remote 的远端状态混合
    │   │   │   ├── status-api.ts                                  # 健康与本机状态契约，匿名／受保护准入在 register 配置
    │   │   │   ├── status-service.ts                              # 本机状态采集及健康流程，复用宿主通用状态能力
    │   │   │   ├── status-types.ts                                # 本机状态与健康内部类型
    │   │   │   └── status-mapper.ts                               # LocalStatus 技术结果、应用状态与安全输出转换
    │   │   └── backups/                                           # 全局备份导入导出与恢复用例，不重新维护各模块表字段
    │   │       ├── backups-api.ts                                 # 加密备份导出、预检与恢复契约；宿主维护能力独立内用
    │   │       ├── backups-service.ts                             # 密码复核、导入导出、取消及恢复结果流程，审计真实结果
    │   │       ├── backups-types.ts                               # 导出内容、预检资源、恢复回执与未知结果内部类型
    │   │       ├── backups-mapper.ts                              # SnapshotCollector、加密载荷和应用备份资源转换，原始表与文件句柄留技术层
    │   │       └── backups-maintenance.ts                         # 与宿主协调停止准入、排空和重建的内部契约，不接收 HTTP Request
    │   └── targets/                                               # 连接配置、凭据、代理、密钥、标签、主机信任及可信目标解析
    │       ├── targets-api.ts                                     # 聚合配置管理分组；解密目标与使用记录能力仅供受信后端协作
    │       ├── targets-register.ts                                # 创建子模块，配置权限并应用 Access protect，装配事务参与者、可信解析及表描述
    │       ├── targets-migrations.ts                              # 编排各 owner 表初始化／迁移，关系表也只有一个 schema owner
    │       ├── targets-mapper.ts                                  # 共用应用／安全错误、存储拒绝和公开对象转换，收敛原 public-mappers
    │       ├── connections/                                       # 连接元数据、关联关系、凭据与桌面目标读取
    │       │   ├── connections-api.ts                             # 连接 CRUD、克隆、标签及凭据管理契约；可信桌面解析不向插件公开
    │       │   ├── connections-service.ts                         # 连接修改、关联和凭据同事务协调，保留版本、使用记录及资源归属规则
    │       │   ├── connections-types.ts                           # 连接、编辑、关系及使用记录内部类型
    │       │   ├── connections-rules.ts                           # 连接输入、类型变更及关系快照的纯业务判断
    │       │   ├── connections-graph-rules.ts                     # SSH 引用图、循环与依赖关系纯校验，通用 IP 逻辑归 utils
    │       │   ├── connections-policy.ts                          # 引用图展开与查询政策的唯一 owner，避免存储／调用层各设一份门槛
    │       │   ├── connections-mapper.ts                          # 连接应用／存储／安全契约和最少授权事实转换
    │       │   ├── connections-storage.ts                         # 连接及真实授权事实读写、当前版本更新与删除事务契约
    │       │   ├── connections-tags-storage.ts                    # 连接标签关系写入的事务参与者契约，供连接、标签与导入复用
    │       │   ├── connections-credentials-service.ts             # 读取凭据摘要、保留／替换／清除及批量管理流程
    │       │   ├── connections-credentials-types.ts               # 密码／密钥凭据写意图与应用内部类型
    │       │   ├── connections-credentials-mapper.ts              # 凭据存储命令与 SecretBox 转换，安全结果只返回摘要及引用
    │       │   ├── connections-credentials-storage.ts             # 凭据读写、原版本及同事务参与者契约
    │       │   ├── connections-desktop-service.ts                 # 受信后端桌面目标读取与连接使用记录，调用前按真实权限校验
    │       │   ├── connections-desktop-types.ts                   # 可信桌面目标内部类型，不序列化到 HTTP 或插件
    │       │   ├── connections-desktop-mapper.ts                  # 存储目标和密文到受信桌面目标转换，明确秘密生命周期
    │       │   ├── connections-desktop-storage.ts                 # 桌面配置与凭据一致快照读取契约
    │       │   └── adapters/
    │       │       └── sqlite/
    │       │           ├── connections-schema.ts                  # 连接与所属关系表、约束及索引
    │       │           ├── connections-sql.ts                     # 连接表描述、读写与删除事务；接入公共授权复查及注入的关系／凭据参与者
    │       │           ├── connections-credentials-schema.ts      # 连接凭据表与关联约束
    │       │           ├── connections-credentials-sql.ts         # 凭据表描述、密文备份转换与同事务读写能力
    │       │           ├── connections-tags-sql.ts                # 连接标签关系表描述与实际 SQL，供两个方向的管理与导入同事务复用
    │       │           ├── connections-desktop-sql.ts             # 一致快照读取桌面配置与凭据，复用所属表描述，不重复注册表
    │       │           └── connections-graph-sql.ts               # 连接引用图的 SQL 与行解码，复用所属表定义，不拥有第二份表
    │       ├── proxies/                                           # 代理配置及受保护凭据
    │       │   ├── proxies-api.ts                                 # 代理列表、读取、新建、修改及删除契约
    │       │   ├── proxies-service.ts                             # 代理管理、凭据修改意图及被引用状态流程
    │       │   ├── proxies-types.ts                               # 代理配置、修改与结果内部类型
    │       │   ├── proxies-rules.ts                               # 代理协议、地址及输入纯校验
    │       │   ├── proxies-mapper.ts                              # 代理应用／存储与 SecretBox 边界转换，公开结果隐藏秘密
    │       │   ├── proxies-storage.ts                             # 代理管理及供导入注入的事务参与者契约
    │       │   └── adapters/
    │       │       └── sqlite/
    │       │           ├── proxies-schema.ts                      # 代理表与约束
    │       │           └── proxies-sql.ts                         # 代理表描述、管理与导入复用的 SQL、秘密备份转换及原版本事务
    │       ├── tags/                                              # 标签目录及其连接关联管理
    │       │   ├── tags-api.ts                                    # 标签 CRUD、替换／追加关联连接契约
    │       │   ├── tags-service.ts                                # 标签与成员管理，连接关系写入复用所属参与者并同事务提交
    │       │   ├── tags-types.ts                                  # 标签、编辑及成员关联内部类型
    │       │   ├── tags-rules.ts                                  # 标签名称及成员操作纯校验
    │       │   ├── tags-mapper.ts                                 # 标签应用／存储／公开契约转换
    │       │   ├── tags-storage.ts                                # 标签读写与导入复用的事务参与者契约，不复制连接关系 SQL
    │       │   └── adapters/
    │       │       └── sqlite/
    │       │           ├── tags-schema.ts                         # 标签表与名称约束；关联表由 connections 声明
    │       │           └── tags-sql.ts                            # 标签表描述、目录管理与导入复用 SQL，同事务调用连接关系能力
    │       ├── ssh-keys/                                          # SSH 私钥与口令管理
    │       │   ├── ssh-keys-api.ts                                # 密钥管理契约，读取只返回安全摘要
    │       │   ├── ssh-keys-service.ts                            # 私钥新建、替换、清除口令及删除引用检查流程
    │       │   ├── ssh-keys-types.ts                              # 密钥编辑、秘密意图与内部记录类型
    │       │   ├── ssh-keys-rules.ts                              # 密钥名称、格式与写入意图纯校验
    │       │   ├── ssh-keys-mapper.ts                             # 私钥／口令到加密存储与安全结果转换
    │       │   ├── ssh-keys-storage.ts                            # 密钥读写、引用校验和导入事务参与者契约
    │       │   └── adapters/
    │       │       └── sqlite/
    │       │           ├── ssh-keys-schema.ts                     # 密钥表、名称与引用约束
    │       │           └── ssh-keys-sql.ts                        # 密钥表描述、密文备份转换及管理／导入事务能力
    │       ├── host-keys/                                         # SSH 主机公钥指纹信任记录，不与连接配置指纹混用
    │       │   ├── host-keys-api.ts                               # 指纹读取、用户确认和移除契约；握手观察不自动授予信任
    │       │   ├── host-keys-service.ts                           # 主机信任确认、原指纹竞争处理与移除流程
    │       │   ├── host-keys-types.ts                             # 主机指纹观察、确认与信任内部类型
    │       │   ├── host-keys-mapper.ts                            # 主机信任应用／存储／安全挑战转换
    │       │   ├── host-keys-storage.ts                           # 信任查询、原指纹 CAS 与移除契约
    │       │   └── adapters/
    │       │       └── sqlite/
    │       │           ├── host-keys-schema.ts                    # 端点／主机公钥指纹信任表与唯一约束
    │       │           └── host-keys-sql.ts                       # 主机信任表描述、恢复校验与指纹 CAS 事务
    │       ├── import/                                            # 批量连接导入；每项连接、代理、密钥、标签及凭据原子创建
    │       │   ├── import-api.ts                                  # 批量导入与逐项结果契约，身份失效不作为普通坏项继续
    │       │   ├── import-service.ts                              # 导入准入、每项流程及批次真实结果汇总，不隐式重放失败项
    │       │   ├── import-types.ts                                # 导入命令、单项结果与事务计划内部类型
    │       │   ├── import-mapper.ts                               # 明文导入意图、加密存储任务和安全逐项结果转换
    │       │   ├── import-batch.ts                                # 按输入顺序执行各项，区分确定拒绝、部分提交与提交未知
    │       │   ├── import-storage.ts                              # 单项导入与依赖参与者的存储命令、结果契约
    │       │   ├── import-transaction.ts                          # 同一事务参与者契约，各 owner 提供自己的 SQL 能力
    │       │   └── adapters/
    │       │       └── sqlite/
    │       │           └── import-sql.ts                          # 持有单项导入外层事务，调用注入的表 owner 能力；不重复注册表或复制别的 owner SQL
    │       └── resolver/                                          # 受信后端目标解析与配置指纹，供 Remote 握手和执行使用
    │           ├── resolver-api.ts                                # 已保存／草稿目标一致快照解析契约，解密结果只供宿主内部使用
    │           ├── resolver-service.ts                            # 目标、凭据与跳板解析流程，复用真实权限与连接图规则
    │           ├── resolver-types.ts                              # 可信 SSH 目标、草稿引用与解析请求内部类型，不公开明文秘密
    │           ├── resolver-rules.ts                              # 目标、凭据及引用快照的纯校验，图政策复用 connections owner
    │           ├── resolver-mapper.ts                             # 存储密文快照与受信目标、指纹转换；安全 SDK 不导出明文解析能力
    │           ├── resolver-storage.ts                            # SSH 目标及引用的一致快照读取契约
    │           └── adapters/
    │               └── sqlite/
    │                   └── resolver-sql.ts                        # 只读组装目标快照，复用各表 owner 的定义／解码，不重复表或备份清单
    ├── sdk/                                                       # 面向 HTTP 与后续插件的统一安全业务 API；不导出原始 Service、秘密解析或技术句柄
    │   ├── sdk-api.ts                                             # 仅聚合 api/ 下各模块的 SDK 契约，不重复定义业务方法
    │   ├── sdk-register.ts                                        # 启动注入六个模块受保护 API，提供 createSdk(scope) 绑定调用上下文并转发
    │   ├── sdk-context.ts                                         # 通过 Access 宿主内部工厂创建、管理及释放 AccessCallScope，绑定真实来源
    │   ├── api/
    │   │   ├── access-api.ts                                      # 开放明确的认证／配置用例，隐藏 scope、上下文工厂及内部会话签发能力
    │   │   ├── operations-api.ts                                  # 审计查询、日志与通知管理，隐藏任意事件伪造及直接派发入口
    │   │   ├── preferences-api.ts                                 # 配置、布局、命令、历史、收藏、终端主题与外观资源的安全调用方视图
    │   │   ├── remote-api.ts                                      # 终端、文件、桌面、测试、观测、安装与传输安全视图，隐藏原始 SSH 机器及凭据
    │   │   ├── system-api.ts                                      # 健康、诊断与备份用例的安全视图，不开放宿主重建／停止准入的原始控制能力
    │   │   └── targets-api.ts                                     # 连接、凭据摘要、代理、密钥、标签、主机信任与导入安全视图，隐藏解密解析能力
    │   └── client/                                                # 后续对外发包的纯客户端边界，具体文件随已确认宿主通信契约落定，不引入服务端实现
    ├── http/                                                      # 所有入站 HTTP／WS 业务协议适配；统一调用受保护 SDK，通用服务器技术仍归 Platform
    │   ├── http-register.ts                                       # 汇总六个业务域 HTTP／WS 路由与交付生命周期，交给 Bootstrap 安装
    │   ├── http-context.ts                                        # 从受信 HTTP／WS 来源提取原凭据交给 sdk-context，绑定取消及关闭，不签发身份
    │   ├── access/
    │   │   ├── access-cookie.ts                                   # 认证 Cookie 读取、设置与清除，属于 HTTP 协议
    │   │   ├── access-delivery.ts                                 # 交付、断连取消及未交付凭据撤销，不在业务 Service 处理 HTTP
    │   │   ├── access-accounts-http.ts                            # 初始化、改密路由 → SDK Access API
    │   │   ├── access-authentication-http.ts                      # 登录、状态与退出路由 → SDK Access API
    │   │   ├── access-authorization-http.ts                       # 实际需要的授权管理路由 → SDK 管理用例，不暴露内部判定工厂
    │   │   ├── access-login-options-http.ts                       # 公开登录选项路由 → SDK Access API
    │   │   ├── access-totp-http.ts                                # TOTP 登录、绑定与关闭路由 → SDK Access API
    │   │   ├── access-passkeys-http.ts                            # 通行密钥路由 → SDK Access API
    │   │   ├── access-oidc-http.ts                                # OIDC 配置、绑定与回调路由 → SDK Access API
    │   │   └── access-admission-http.ts                           # 封禁管理路由 → SDK Access API
    │   ├── operations/                                            # 审计查询、日志配置和通知管理协议入口，不生成业务审计
    │   │   ├── operations-audit-http.ts                           # 审计日志查询路由 → SDK Operations API
    │   │   ├── operations-logging-http.ts                         # 日志配置读取／更新路由 → SDK Operations API
    │   │   ├── operations-notifications-http.ts                   # 渠道、配置测试及投递查询路由 → SDK Operations API
    │   │   └── operations-mapper.ts                               # HTTP DTO 与 SDK 安全对象逐字段投影，不引用应用内部或持久存储类型
    │   ├── preferences/                                           # 配置、个人数据及外观协议入口，删除原 support 中的重复认证
    │   │   ├── preferences-configuration-http.ts                  # 安装配置读取／更新路由 → SDK Configuration，不返回秘密正文
    │   │   ├── preferences-presentation-http.ts                   # 个人布局／偏好读取与完整版本写入 → SDK Presentation
    │   │   ├── preferences-commands-http.ts                       # 快捷命令、标签与批量编辑 → SDK Commands
    │   │   ├── preferences-history-http.ts                        # 命令／目录历史读取与管理 → SDK History
    │   │   ├── preferences-favorites-http.ts                      # 收藏查询、编辑、排序与删除 → SDK Favorites
    │   │   ├── preferences-themes-http.ts                         # 终端主题管理及导入协议 → SDK Themes
    │   │   ├── preferences-appearance-http.ts                     # 外观与活动主题副本协议 → SDK Appearance
    │   │   ├── preferences-backgrounds-http.ts                    # 背景 multipart、内容流及删除协议 → SDK Appearance 背景能力
    │   │   ├── preferences-html-themes-http.ts                    # 本地 HTML 主题管理与内容协议 → SDK Appearance HTML 主题能力
    │   │   ├── preferences-remote-html-themes-http.ts             # 远端 HTML 主题目录／正文协议 → SDK Appearance 远端目录能力
    │   │   ├── preferences-mapper.ts                              # HTTP DTO 与 SDK 安全对象逐字段投影；不重复业务或存储转换
    │   │   └── preferences-delivery.ts                            # 背景／HTML 内容交付、断线和取消收尾，不重新维护业务授权策略
    │   ├── remote/                                                # 终端、文件、观测、桌面与恢复管理的 HTTP／WS 协议入口
    │   │   ├── remote-sessions-http.ts                            # 终端／Workspace 创建、恢复与关闭协议 → SDK Remote Sessions
    │   │   ├── remote-suspend-http.ts                             # 挂起目录、命名、终止、日志导出与租约协议 → SDK Sessions
    │   │   ├── remote-files-http.ts                               # 文件管理、编辑、搜索与文件任务协议 → SDK Files
    │   │   ├── remote-file-download-http.ts                       # 下载票据、Range、目录 ZIP 与流交付 → SDK Files
    │   │   ├── remote-connection-tests-http.ts                    # 已保存／草稿 SSH 测试协议 → SDK Machines，保留既有 Targets 路径
    │   │   ├── remote-mutations-http.ts                           # 机器突变列表、证据及人工解除协议 → SDK Machines
    │   │   ├── remote-resources-http.ts                           # 后台 SSH 资源与采样协议 → SDK Monitoring
    │   │   ├── remote-transfers-http.ts                           # 独立服务器传输任务创建、分页、取消与观察 → SDK Transfers
    │   │   ├── remote-tools-http.ts                               # 远端工具检测、计划确认与安装协议 → SDK Tools
    │   │   ├── remote-desktop-http.ts                             # 桌面票据、显示配置及证书确认协议 → SDK Desktop
    │   │   ├── remote-mapper.ts                                   # HTTP／WS 与 SDK 安全对象的协议转换，收敛 mutation、observation、suspend view
    │   │   ├── remote-pty-ws.ts                                   # PTY 二进制、输入、缩放与背压，绑定应用订阅及原连接生命周期
    │   │   ├── remote-suspended-catalog-ws.ts                     # 挂起目录快照／变化事件流，复用 SDK Sessions 订阅及当前授权
    │   │   ├── remote-upload-ws.ts                                # 上传数据流与取消交付 → SDK Files，保留原任务及晚收尾 owner
    │   │   ├── remote-workspace-files-ws.ts                       # Workspace 文件附件协议与变化推送 → SDK Files／Sessions
    │   │   ├── remote-desktop-ws.ts                               # 原始桌面 WS 与 Platform Desktop 的技术接线；业务接入先经 SDK Desktop
    │   │   └── remote-delivery.ts                                 # 终端回放、下载、上传与桌面断线交付收尾，不把传输结束当成副作用回滚
    │   ├── system/                                                # 健康、宿主诊断及加密备份协议入口
    │   │   ├── system-status-http.ts                              # 健康与本机状态协议 → SDK System Status
    │   │   ├── system-diagnostics-http.ts                         # 管理员诊断快照协议 → SDK Diagnostics
    │   │   ├── system-backups-http.ts                             # 加密备份导入／导出及流交付 → SDK Backups；HTTP 不负责全局维护策略
    │   │   ├── system-mapper.ts                                   # 诊断、状态和备份安全对象到协议的明确转换
    │   │   └── system-delivery.ts                                 # 备份内容与恢复结果交付、断线取消收尾，不重放未确认恢复
    │   └── targets/                                               # 连接目录与依赖管理协议；真实 SSH 测试仍归 Remote
    │       ├── targets-connections-http.ts                        # 连接 CRUD、克隆与标签关联协议 → SDK Connections
    │       ├── targets-credentials-http.ts                        # 凭据摘要及保留／替换／清除协议 → SDK Connections
    │       ├── targets-proxies-http.ts                            # 代理 CRUD 协议 → SDK Proxies
    │       ├── targets-tags-http.ts                               # 标签 CRUD 与关联连接协议 → SDK Tags
    │       ├── targets-ssh-keys-http.ts                           # 密钥管理协议 → SDK SSH Keys
    │       ├── targets-host-keys-http.ts                          # 主机信任列表、确认与移除协议 → SDK Host Keys
    │       ├── targets-import-http.ts                             # JSON／multipart 导入解析与逐项结果 → SDK Import
    │       ├── targets-codec.ts                                   # 路径、查询与 multipart 的协议解码；业务正文复用 Shared codec
    │       └── targets-mapper.ts                                  # Targets HTTP DTO 与 SDK 安全对象逐字段转换，秘密和可信目标不进入响应
    ├── utils/                                                     # 实际跨模块复用的纯函数，按职责命名，不依赖业务 Service 或技术资源
    │   └── ip.ts                                                  # 通用 IP 规范化、地址分类、CIDR 解析和网段匹配，收敛原 source-address 契约与实现
    └── platform/                                                  # 通用技术能力、协议运行时及资源管理；不定义业务权限或备份字段政策
        ├── archive/                                               # 通用远端原生归档与 ZIP 字节流技术；业务计划、路径政策归 Remote Files
        │   ├── archive-port.ts                                    # 归档技术命令、输入输出与执行资源契约
        │   └── adapters/
        │       ├── native/
        │       │   └── archive-commands.ts                        # 原生归档工具命令构造与执行技术适配
        │       └── zip/
        │           └── zip-stream.ts                              # archiver ZIP 字节流及真实资源收尾
        ├── blobs/                                                 # 通用本地 Blob 文件资源
        │   ├── blob-store.ts                                      # 本机 Blob 暂存、发布、读取和删除契约，不含外观激活政策
        │   └── adapters/
        │       └── native-blob-store.ts                           # 本地文件系统 Blob 实现及受控根目录
        ├── cache/                                                 # 常驻缓存与完整失效生命周期
        │   └── resident-cache.ts                                  # 通用常驻缓存、失效与关闭生命周期，缓存内容及失效触发归使用模块
        ├── delivery/                                              # 通用消息投递技术
        │   ├── delivery.ts                                        # 通用 HTTP／SMTP 投递契约，不持有通知账本或订阅
        │   └── adapters/
        │       └── native-delivery.ts                             # HTTP 请求与 nodemailer 发送实现，保留确定／未知结果
        ├── desktop/                                               # RDP／VNC 技术传输与 TLS
        │   ├── desktop-port.ts                                    # RDP／VNC 技术连接与证书探测契约，原始 WS 只在协议／技术层接线
        │   └── adapters/
        │       ├── browser-desktop.ts                             # 桌面字节流桥接及技术资源生命周期，不管理业务票据或身份
        │       ├── rdcleanpath.ts                                 # IronRDP RD Clean Path 协议适配与响应编解码
        │       └── rdp-tls.ts                                     # TLS 证书探测、主机及系统信任事实，不替代用户信任确认
        ├── docker/                                                # Docker 远端技术适配
        │   ├── docker-port.ts                                     # Docker 远端读取／执行技术契约，不决定业务操作权限
        │   └── adapters/
        │       └── native-docker.ts                               # 固定 Docker 命令与响应解码；突变围栏归 Remote Monitoring
        ├── http/                                                  # Fastify／HTTP／WS 运行时，不持有业务 Service
        │   ├── http-types.ts                                      # 通用 HTTP／WS 技术契约，不包含业务会话或 SDK 类型
        │   ├── http-server.ts                                     # HTTP 监听、升级接入与服务资源关闭
        │   ├── http-bindings.ts                                   # Fastify 路由、解析、Cookie／安全头插件及请求日志接线，不发布业务审计
        │   ├── http-request.ts                                    # 可信来源、Origin、Cookie 与请求协议事实读取
        │   ├── http-body.ts                                       # multipart／请求体流式消费与取消，容量复用真实协议 owner
        │   ├── http-errors.ts                                     # 协议输入及交付技术失败，不泄露底层正文
        │   ├── http-lifecycle.ts                                  # 请求交付观察、传输排空、断线与晚收尾的唯一技术 owner
        │   ├── http-limits.ts                                     # 实际 HTTP／WS 底层约束与已有默认值，不复制各业务总预算
        │   └── websocket-channel.ts                               # 通用 WS 通道、二进制交付、背压与关闭，不承载业务操作
        ├── images/                                                # 图片技术检查
        │   ├── image-inspector.ts                                 # 图片媒体类型、尺寸等技术检查契约，不决定用户配置的预览上限
        │   └── adapters/
        │       └── native-image-inspector.ts                      # file-type 与图片元信息解码实现
        ├── lifecycle/                                             # 通用资源接纳、排空和失败汇总
        │   ├── call-admission.ts                                  # 通用调用接纳、在途跟踪、停止与排空；认证及业务准入政策由 owner 决定
        │   ├── failure-summary.ts                                 # 失败收集、因果保留与汇总，不吞掉未知效果或清理失败
        │   └── recent-results.ts                                  # 已结束资源的短期结果缓存，保留原 owner 的失效与关闭要求
        ├── logging/                                               # 唯一日志实现及诊断上下文
        │   ├── logger.ts                                          # 唯一 Logger／等级契约，持久等级政策归 Operations Logging
        │   ├── pino-logger.ts                                     # Pino 实现、运行等级激活及输出配置
        │   └── diagnostic-log.ts                                  # 日志上下文、结构化诊断与秘密脱敏，不存储业务审计
        ├── network/                                               # 通用出站 HTTP 技术能力
        │   ├── bounded-fetch.ts                                   # 通用出站 HTTP 能力、取消与结果契约，实际业务容量由使用方声明
        │   └── adapters/
        │       └── native-bounded-fetch.ts                        # fetch、重定向／响应流与网络资源收尾实现
        ├── security/                                              # 通用密码计算、加密和随机令牌；四类认证协议已归各 Access 子模块
        │   ├── password-hasher.ts                                 # 通用密码哈希与验证技术实现，不决定账号密码政策
        │   ├── secret-box.ts                                      # AES-GCM 加解密与上下文绑定，不对外暴露实例密钥
        │   ├── sealed-bytes.ts                                    # 加密字节载荷封装，备份格式／包含范围由 System 和表 owner 决定
        │   ├── session-tokens.ts                                  # 通用随机令牌、摘要与常量时间核对契约，不拥有业务会话
        │   └── adapters/
        │       └── secure-session-tokens.ts                       # Node crypto 令牌和摘要技术实现，供真实业务 owner 复用
        ├── ssh/                                                   # 通用 SSH／exec／PTY／SFTP 技术能力
        │   ├── ssh-port.ts                                        # SSH 机器、命令、PTY、SFTP 与清理技术契约，不含业务身份或配置解析
        │   └── adapters/
        │       └── ssh2/
        │           ├── ssh-machine.ts                             # ssh2 机器连接、共享资源与技术关闭实现
        │           ├── ssh-route.ts                               # 直连、代理、跳板链技术路由及收尾
        │           ├── ssh-channels.ts                            # exec／PTY 通道、输入输出、背压与真实退出
        │           └── ssh-sftp.ts                                # SFTP 技术租约、读写、暂存及资源关闭
        ├── storage/                                               # 持久化通用技术
        │   └── sqlite/
        │       ├── sqlite-runtime.ts                              # 唯一 SQLite 队列、Worker、事务与 withTransactionAdmission 技术运行时
        │       ├── sql-types.ts                                   # SQL 读写及事务执行器技术契约，业务仅通过明确存储接口消费
        │       ├── worker-types.ts                                # SQLite Worker 请求、响应、参数及行协议
        │       ├── sqlite-errors.ts                               # 数据库不可用、确定拒绝、提交未知及清理技术失败
        │       ├── sqlite-statistics.ts                           # 队列、执行与提交统计，供宿主诊断只读采集
        │       ├── schema.ts                                      # 通用 schema 初始化／迁移执行编排，不定义业务表字段
        │       ├── schema-types.ts                                # 初始化与迁移记录、版本、签名的技术契约
        │       ├── schema-signature.ts                            # 当前结构与迁移内容签名，拒绝不一致结构
        │       ├── snapshot-types.ts                              # 收敛现有注册契约：统一表描述、备份转换、验证与文件引用能力
        │       └── adapters/
        │           ├── schema-sql.ts                              # schema／迁移元数据 SQL、结构检查与版本记录事务
        │           ├── transaction-sql.ts                         # SQLite 真实事务、提交回执及未知结果技术处理
        │           ├── worker.ts                                  # 数据库 Worker 执行、消息校验与退出收尾
        │           ├── unicode-text.ts                            # SQLite 字符串和 Unicode 技术处理，不新增业务输入规则
        │           ├── snapshot-sql.ts                            # 全局备份引擎：收集表描述、一致读取、覆盖核对与恢复编排
        │           ├── snapshot-row.ts                            # 通用快照行编解码，调用表 owner 的完整持久行解码与转换
        │           ├── snapshot-validation-sql.ts                 # 实际 schema、外键与表 owner 校验编排，遗漏／重复归属明确拒绝
        │           ├── snapshot-restore-sql.ts                    # 统一恢复外层事务及依赖顺序，各表操作共用执行器、全成全败
        │           ├── snapshot-archive.ts                        # 通用快照归档格式编解码，不定义业务表清单
        │           └── snapshot-restore-files.ts                  # 文件预检、替换与收尾，独立于 SQLite 回滚并保留失败证据
        ├── system/                                                # 本机／远端系统事实与进程度量技术
        │   ├── status-port.ts                                     # 系统状态采集技术契约，不维护远端订阅或趋势政策
        │   ├── local-status-port.ts                               # 宿主本机状态技术契约
        │   ├── process-diagnostic.ts                              # 进程 CPU、内存、GC 与运行时诊断契约
        │   ├── resource-diagnostic.ts                             # 跨模块资源采集注册与度量契约，不根据 HTTP 请求推断业务结果
        │   ├── disk-percent.ts                                    # 文件系统磁盘比例的通用纯计算
        │   └── adapters/
        │       ├── posix-status.ts                                # 远端 Linux 内核和文件系统事实采集及技术解码
        │       ├── node-local-status.ts                           # Node／宿主本机状态读取
        │       └── node-process-diagnostic.ts                     # 进程与已注册资源指标读取；请求技术指标留协议层
        ├── terminal/                                              # 终端检查点、日志字节与 Shell 协议技术
        │   ├── shell-integration-port.ts                          # Shell Hook、提示符及目录技术契约，切目录业务流程归 Remote Sessions
        │   ├── suspended-checkpoint-port.ts                       # 终端检查点技术契约，挂起权限／租约／恢复 ACK 归 Remote Sessions
        │   ├── suspended-log-port.ts                              # 终端日志字节存储与读取契约，保留／导出政策归 Remote Sessions
        │   ├── terminal-errors.ts                                 # 终端日志、检查点及 Shell 技术失败
        │   └── adapters/
        │       ├── headless-suspended-checkpoint.ts               # xterm headless 检查点与序列化技术实现
        │       ├── headless-suspended-log-export.ts               # 渲染后终端日志导出的技术实现，不自行裁定保留范围
        │       ├── local-suspended-log.ts                         # 挂起日志本机字节存储、读取与清理技术实现
        │       └── native-shell-integration.ts                    # Shell Hook 注入、提示符与目录协议技术实现
        ├── text/                                                  # 通用文本字节编解码
        │   ├── text-codec.ts                                      # 文本编码检测／转换技术契约，编辑与换行选择归 Remote Files
        │   └── adapters/
        │       └── iconv/
        │           └── text-codec.ts                              # iconv-lite 字节／文本编解码
        ├── tools/                                                 # 远端系统工具技术
        │   ├── tool-port.ts                                       # 系统工具探测与安装技术契约，确认计划与授权归 Remote Tools
        │   ├── tool-probe.ts                                      # 远端工具存在性及实际命令能力探测
        │   └── adapters/
        │       └── posix-tool-installer.ts                        # POSIX 包管理器检测与固定安装技术适配，不接收任意包命令
        └── transfers/                                             # 通用跨端点传输技术
            ├── transfer-port.ts                                   # rsync／scp／sftp 传输技术契约，任务进度与生命周期归 Remote Transfers
            └── adapters/
                └── native-transfer.ts                             # 远端直传与 SFTP 中转技术执行，实际清理结果交回原任务 owner
```

```text
# 目标调用关系：覆盖 SDK → Access、Operations、Preferences、Remote、System、Targets。
# -api.ts、-storage.ts 定义契约，-types.ts 定义类型，不是额外的运行时调用层。
# sdk/api/<模块>-api.ts 定义调用方视图，sdk-api.ts 聚合分组，不增加运行时转调层。
# rules 与 mapper 是按需分支，不要求每个方法逐个经过；内部协作不重新绕行 SDK。

1. SDK → Access

启动装配：
各子模块 -api.ts（调用方法与安全输入、输出契约）
    ↓ access-register.ts 创建 Service，配置权限及准入方式，应用 Access protect，聚合模块 API
    ↓ sdk-register.ts 注入受保护的模块 API，提供 createSdk(scope)

实际调用：
sdk-context.ts（通过 Access 内部工厂创建 AccessCallScope）
    ↓ createSdk(scope)（绑定原始作用域，不代表认证通过）
sdk.access.<子模块>.<方法>(input)（遵循 sdk/api/access-api.ts 契约）
    ↓ Access 模块公共方法（遵循对应子模块 -api.ts 契约）
Access protect（authorization-service.ts）
    ├── 按 register 的操作配置组合执行 authorization-policy.ts 提供的公共检查
    ├── authentication-service.ts：需要时验证会话或密码复核凭据
    │   └── sessions-api.ts / accounts-api.ts：读取真实认证事实，按需使用内部能力
    ├── authorization-rules.ts：需要时根据当前事实生成授权规则
    └── authorization-casl.ts：需要时按规则判定当前资源权限
    ↓ 检查通过，内部用例取得 AuthorizedCall；匿名或部分认证入口使用各自准入契约
按目标方法进入所属 Service：
    ├── accounts-service.ts
    │   ├── accounts-rules.ts：账号业务判断
    │   └── accounts-mapper.ts → accounts-sql.ts（实现 accounts-storage.ts，改密事务组合 sessions 撤销参与者）
    ├── authentication-service.ts
    │   └── 按需调用 accounts / sessions / captcha / admission / totp / passkeys 内部 API
    ├── authorization-service.ts（显式授权管理用例，区别于 protect 的内部判定）
    │   ├── authorization-rules.ts：授权规则
    │   └── authorization-mapper.ts → authorization-sql.ts（实现 authorization-storage.ts 契约）
    ├── login-options-service.ts
    │   └── captcha / oidc / passkeys 内部 API → 聚合公开信息，管理展示缓存与失效
    ├── totp-service.ts
    │   ├── totp-rules.ts：业务判断
    │   ├── totp-mapper.ts → totp-provider.ts 定义的能力 → totp/adapters/otplib/totp-verifier.ts
    │   └── totp-mapper.ts → totp-sql.ts（实现 totp-storage.ts 契约）
    ├── passkeys-service.ts
    │   ├── passkeys-rules.ts：业务判断
    │   ├── passkeys-mapper.ts → passkeys-provider.ts 定义的能力 → passkeys/adapters/webauthn/passkeys-verifier.ts
    │   └── passkeys-mapper.ts → passkeys-sql.ts（实现 passkeys-storage.ts 契约）
    ├── oidc-service.ts
    │   ├── oidc-rules.ts：业务判断
    │   ├── oidc-mapper.ts → oidc-provider.ts 定义的能力 → oidc/adapters/openid-client/oidc-client.ts
    │   └── oidc-mapper.ts → oidc-sql.ts（实现 oidc-storage.ts 契约）
    └── admission-service.ts
        ├── admission-policy.ts / admission-rules.ts：配置策略与纯业务判断
        └── admission-mapper.ts → admission-sql.ts（实现 admission-storage.ts 契约）

Access 内部能力（不增加插件 SDK 分组）：
sessions-api.ts → sessions-service.ts → sessions-mapper.ts → sessions-sql.ts
captcha-api.ts → captcha-service.ts
    ├── captcha-rules.ts：配置与输入纯校验
    └── captcha-mapper.ts → captcha-provider.ts 定义的能力 → adapters/http/captcha-verifier.ts → 验证供应商
access-register.ts 创建并注入各子模块的外部能力实现；mapper 只转换对象与失败，不直接执行 HTTP 或调用第三方库。
内部事实读取与验证不再次进入 protect，避免公共鉴权依赖自身形成递归。

2. SDK → Operations

启动装配：
audit-api.ts / logging-api.ts / notifications-api.ts（各自调用契约）
    ↓ operations-register.ts 创建 Service 与 worker，配置各操作权限并应用 Access protect
    ↓ operations-api.ts 聚合宿主模块契约；sdk/api/operations-api.ts 明确对调用方开放的方法
    ↓ sdk-register.ts 提供绑定原始 scope 的 sdk.operations

实际调用：
sdk.operations.<audit / logging / notifications>.<方法>(input)
    ↓ Operations 模块公共方法 → Access protect（按 register 配置检查身份、管理权限及插件／工作区范围）
    ↓ 检查通过，内部用例取得 AuthorizedCall
    ├── audit-service.ts（查询、分页）
    │   ├── audit-rules.ts：查询条件与时间范围校验
    │   └── audit-mapper.ts → audit-sql.ts（遵循 audit-storage.ts 契约）
    ├── logging-service.ts（读取／保存日志配置，协调实际等级激活）
    │   ├── logging-rules.ts：配置与事件规则
    │   └── logging-mapper.ts
    │       ├── logging-sql.ts：事务内复查授权与原版本，保存配置
    │       └── platform/logging：按最新有效版本激活同一 Logger，不把旧保存结果重新激活
    └── notifications-service.ts（渠道管理、配置测试受理、投递记录查询）
        ├── notifications-rules.ts：配置、秘密修改意图与订阅规则
        └── notifications-mapper.ts → notifications-sql.ts
            └── 配置／测试受理提交后唤醒 notifications-worker.ts；受理成功不等于投递成功

宿主内部事件（不向插件公开任意追加审计或直接派发的入口）：
统一业务用例发布实际操作结果；Access 在认证／授权入口发布安全事件
    ↓ operations-service.ts（追踪发布及完整收尾；主体来自宿主事实，不采信插件自报身份）
    ↓ operations-mapper.ts → audit-sql.ts（实现 operations-storage.ts 的原子写入契约）
同一事务：audit-sql.ts 按事件键去重并追加审计，调用注入的 notifications-sql.ts 能力写 pending
各 Adapter 只维护自己的表与 SQL；通知写入沿用同一事务执行器，不另开事务或独立提交
    ↓ 提交确认后唤醒 worker；提交未知保留围栏，不猜测重写或派发
notifications-worker.ts（事件唤醒与启动恢复，无定时空轮询）
    ↓ notifications-service.ts 内部分发／取件用例 → mapper → SQL
按当前订阅创建投递快照，同事务登记 fanout 并消费 pending
    ↓ 登记 dispatched，使用受理时的加密配置快照
notifications-mapper.ts → platform/delivery（现有 HTTP／SMTP 实现）
    ↓ 区分确定失败、投递未知及清理失败，回到原 worker 追踪与结算
notifications-sql.ts（经内部用例及 mapper 保存 sent／failed／unknown）
    ↓ operations-service.ts 协调 audit 内部裁剪，只移除已分发的旧审计

生命周期：停止新的外部调用，允许已接纳业务发布事件 → 等待操作及发布收尾 → 停止并排空 worker → 汇总真实失败。
Operations 最后关闭，以接收其他模块退出时的事件；后台投递不继承已结束请求的临时授权。
业务提交与事件发布保留独立结果；审计故障不回滚已提交业务。
普通启动继续合法 queued，原 dispatched 转 unknown 不重发；备份恢复将 queued 结算为 failed，并抑制历史分发。
HTTP、插件经 SDK 进入同一受保护用例，由用例内部审计；后台内部用例同样覆盖，不依赖 HTTP URL 或状态码推断业务结果。
认证失败及授权拒绝由 Access 入口记录，不因未进入业务 Service 而遗漏；HTTP 状态码、耗时及协议故障归请求日志。

3. SDK → Preferences

启动装配：
各子模块 -api.ts 定义契约 → preferences-register.ts 配置权限并应用 Access protect，注入存储／技术能力
    ↓ sdk-register.ts 聚合 → sdk.preferences

实际调用：
sdk.preferences.<configuration / presentation / commands / history / favorites / themes / appearance>.<方法>(input)
    ↓ Preferences 受保护入口 → Access protect → 所属 Service
    ├── configuration-service.ts：原版本保存 → mapper → configuration-sql.ts
    │   └── 提交确认后协调 Access／Remote 配置激活；保存与实际生效分别表达
    ├── presentation-service.ts：完整布局／偏好快照 → mapper → presentation-sql.ts
    ├── commands-service.ts：命令／标签／批量任务 → rules／mapper → commands-sql.ts
    ├── history-service.ts：命令／目录历史分页、去重与清理 → mapper → history-sql.ts
    ├── favorites-service.ts：收藏编辑、排序与使用记录 → mapper → favorites-sql.ts
    ├── themes-service.ts：终端主题管理、预置与导入 → rules／mapper → themes-sql.ts
    └── appearance 的三个职责：
        ├── appearance-service.ts → mapper → appearance-sql.ts
        ├── appearance-background-service.ts → mapper → 图片检查／Blob 能力及背景 SQL
        │   └── 暂存、发布、激活与清理由同一应用 owner 协调；文件写入不冒充 SQLite 事务
        └── appearance-html-themes-service.ts → mapper
            ├── 本地主题：appearance-html-themes-sql.ts
            └── 远端目录：appearance-html-themes-provider → GitHub Adapter → Platform Network

4. SDK → Remote

启动装配：
各子模块 -api.ts 定义契约 → remote-register.ts 配置权限并应用 Access protect，注入 Targets 内部解析及 Platform 能力
    ↓ sdk-register.ts 聚合 → sdk.remote

实际调用：
sdk.remote.<sessions / files / machines / monitoring / desktop / tools / transfers>.<方法>(input)
    ↓ Remote 受保护入口 → Access protect → 所属应用 owner
    ├── machines-tests-service.ts → mapper → machines 能力 → Targets resolver／Platform SSH
    ├── sessions-service.ts／sessions-owner.ts：终端资源创建、归属、输入、尺寸及实际关闭
    │   └── sessions-mapper.ts → machines 能力 → Platform SSH PTY
    ├── sessions-workspace-service.ts：唯一 Workspace 登记、文件附件、挂起与恢复 ACK／租约
    │   ├── workspace／history mapper → Platform Terminal 的日志与检查点
    │   └── sessions-shell-service.ts → shell mapper／command owner → Shell Integration／目录探测
    ├── files-service.ts 及复制／搜索／归档子用例 → rules／mapper／应用文件资源
    │   └── machines／Platform SFTP、Text、Archive；写入复用 machines-mutations-service.ts
    ├── monitoring-service.ts／monitoring-resources-service.ts → mapper → Platform Status／Docker／SSH
    ├── desktop-service.ts → mapper → Targets 可信桌面目标／DesktopTransport／desktop-certificates-sql.ts
    ├── tools-service.ts → mapper → machines／Platform Tools，执行前取得同一机器突变 claim
    └── transfers-service.ts → mapper → machines／Platform Transfers，追踪父子任务及源／目标 claim

机器突变：machines-mutations-service.ts／machines-mutations-recovery-service.ts → mapper → machines-mutations-sql.ts。
HTTP／WS 只经 SDK 创建或订阅应用资源；原始 socket 在 http/remote 与 Platform 技术实现之间接线。
终端／桌面／文件流保留原任务 owner、背压和晚收尾；入口检查不替代后续租约、授权及资源事实复查。
业务结果由 Remote 内部发布审计；技术协议错误归请求／连接日志，不根据 HTTP 结果反推操作。

5. SDK → System

启动装配：
diagnostics-api.ts／status-api.ts／backups-api.ts 定义契约 → system-register.ts 配置权限及准入，应用 Access protect
    ↓ sdk-register.ts 聚合 → sdk.system

实际调用：
sdk.system.<diagnostics / status / backups>.<方法>(input)
    ↓ System 受保护入口 → Access protect → 所属 Service
    ├── diagnostics-service.ts → mapper → ProcessDiagnostic／已注册资源采集／diagnostics-sql.ts
    ├── status-service.ts → mapper → Platform LocalStatus
    └── backups-service.ts → mapper → 加密载荷／SnapshotCollector
        ├── 导出：全局一致读取各 owner 表描述，执行秘密转换及文件采集后加密交付
        └── 恢复：预检 → 注入的宿主维护能力停止准入并排空 → 统一恢复事务／文件协调
            └── Bootstrap 重建模块及 SDK；旧上下文、缓存和资源失效，提交未知保留现场

维护控制不接收原始 HTTP Request，不把应用重建职责塞入路由；恢复任务不等待自身排空。
SQLite 诊断只读取真实数据库元信息，不为观测额外创建业务表或备份清单。

6. SDK → Targets

启动装配：
各子模块 -api.ts 定义契约 → targets-register.ts 配置权限并应用 Access protect，注入同事务参与者
    ↓ sdk-register.ts 聚合 → sdk.targets

实际调用：
sdk.targets.<connections / proxies / tags / sshKeys / hostKeys / import>.<方法>(input)
    ↓ Targets 受保护入口 → Access protect → 所属 Service → rules／mapper → 所属 SQL Adapter
    ├── connections：元数据、关联关系、凭据和使用记录；同一修改事务只推进一次连接版本
    ├── proxies／sshKeys：秘密意图明确转换，SQL 只消费加密存储命令
    ├── tags：标签 owner 写自己的表，连接关系由注入的 connections 参与者同事务写入
    ├── hostKeys：按真实端点和原指纹 CAS 确认信任，观察结果不自动授权
    └── import：外层单项事务调用连接、凭据、代理、标签与密钥 owner 的存储参与者
        └── 各参与者复用同一执行器；确定失败整体回滚，提交未知不自动重放

受信后端内部：Remote → resolver-api.ts／connections 桌面目标能力 → mapper → 一致存储快照／SecretBox。
可信目标、密码和私钥只在原宿主调用范围使用；SDK 对外视图不暴露这些内部解析能力。

删除连接示例：

启动装配：connections-api.ts 定义契约 → targets-register.ts 配置权限并应用 Access protect → sdk-register.ts 聚合
实际调用：
sdk.targets.connections.remove({ id })（遵循 sdk/api/targets-api.ts 契约，已绑定 scope）
    ↓ Targets 模块公共方法（遵循 connections-api.ts 契约）
Access protect
    ├── Access 内部认证能力：验证当前调用来源
    └── Connections 提供真实资源事实 → Access 公共授权规则 → CASL 判定
    ↓ 检查通过
connections-service.ts（业务状态、关联更新及资源生命周期）
    ↓ connections-mapper.ts（应用／存储转换，遵循 connections-storage.ts 契约）
connections-sql.ts（实际写事务：先读取当前身份、授权及连接事实并校验，再删除与提交）

共同返回：存储／技术结果 → 所属 mapper 转成应用结果 → 模块安全出口转换 → SDK 调用方
共同复查：敏感写事务经 sqlite-runtime.ts 的 withTransactionAdmission 在首个业务写入前读取当前事实并执行同一策略。
不在写入后重复要求本操作已删除的资源或已撤销的会话仍存在；长连接及远端副作用按各自阶段复查。
```

```text
1. 认证校验策略采用新方式：
   Access 的 authorization 提供全局认证与授权检查策略；
   每个 API 在所属模块的 register 中配置所需权限，装配公共检查；
   通过 SDK 调用时携带绑定的调用上下文，在模块受保护入口校验权限，通过后执行业务。

2. SQLite 与备份策略按表归属维护：
   SQL Adapter 放在实际拥有数据表的子模块内，移除一级业务模块仅用于汇总 SQL 或备份清单的 adapters/sqlite。
   谁拥有表，谁维护字段、约束、行解码及字段级备份规则；同一张表只有一个描述 owner。
   所属 -sql.ts 导出表描述，引用同目录 schema、完整持久行解码器，以及备份包含／排除、秘密转换和必要校验。
   认证及授权数据的排除也由各自表描述声明，不再维护独立排除清单；普通读写与恢复共用真实解码器。
   模块 register 只汇总并交付描述；全局备份引擎核对实际 schema，拒绝遗漏、重复归属或结构不符。
   导出采用一致的读取事务；恢复由全局引擎预检后开启统一写事务，按依赖顺序恢复并完成关联校验。
   只恢复声明包含的数据，排除项保留目标实例数据，不能把排除理解为恢复时清空。
   各 Adapter 的恢复操作共用外层事务，不各自提交；全部成功才提交，确定失败统一回滚，提交未知先核对。
   表级转换、恢复状态结算与跨表校验由实际 owner 提供，全局只编排，不重写各子模块的数据规则。
   文件预检、替换与清理由全局备份流程协调，SQLite 事务本身不承担文件系统回滚。

3. 审计归统一业务入口内部：
   各业务用例发布实际操作结果，Access 记录认证与授权安全事件，Operations 统一接收并存储。
   HTTP、插件及后台调用复用这些入口，不在 SDK 转发层或 HTTP 结果回调重复生成业务审计。
   不设置 operations-observer.ts；HTTP 状态码、耗时及协议故障使用请求日志。

4. 技术能力按真实归属调整：
   Platform 是跨模块通用技术能力的归属层，Adapter 是实现角色；Platform 内部也可有 adapters。
   CAPTCHA、TOTP、WebAuthn、OIDC 的契约及实现分别归 captcha、totp、passkeys、oidc 子模块。
   各子模块根目录的 -provider.ts 定义依赖契约，adapters/ 实现供应商协议或第三方库调用，由 access-register.ts 注入。
   Service 负责业务流程，mapper 负责对象与失败转换；模块 Adapter 按需复用 Platform 的通用能力。
   SQLite 运行时、SSH 连接、通用密码计算与加解密继续归 Platform；各业务表 SQL 归所属子模块 Adapter。
   归属依据实际消费者与复用需求，同一技术适配只有一个实现，移除旧位置及转导出，不叠加重复封装。

5. 启动采用分阶段装配，避免配置与鉴权相互依赖：
   创建数据库及内部技术能力 → 创建 Preferences 内部配置读取能力并取得安装配置 → 创建 Operations 内部事件接收及 Access → 装配各模块受保护 API → 发布 SDK 与通信入口。
   安装配置读取只供宿主内部启动，不经过尚未创建的受保护 SDK，不伪造登录作用域，也不开放给插件。
   Operations 内部事件接收不依赖其对外受保护 API；公共入口就绪前不接纳外部调用，启动失败清理已创建资源。
   恢复后重建沿用相同依赖顺序，旧上下文与实例资源不复用。

6. Access 跨表写入遵循同一事务与表 owner：
   改密由 Accounts 协调，账号与密码认证修订由 accounts-sql.ts 写入，会话撤销由 sessions-sql.ts 提供参与者。
   access-register.ts 注入参与者，accounts-storage.ts 与 sessions-storage.ts 定义各自存储契约。
   复用 SqliteRuntime.composeTransaction 及同一事务执行器，实际写事务内先校验当前身份、权限及原密码事实，再更新密码、推进修订并撤销会话。
   各 Adapter 只操作自己拥有的表，不复制跨 owner SQL，不独立提交；确定失败整体回滚。
   本次撤销不触发写后重复鉴权而回滚；原会话的后续调用仍然失效。

待完善：Targets、Preferences 等数据变化的订阅机制，后续单独设计，不在本次新增订阅接口。
```

## 3. 对外 API 设计

根 API 只聚合分组，方法及输入、输出类型由各子模块维护。以下作为模块/插件内部受保护用例示例；插件宿主按公开契约动态注册，不在核心固化六模块 API。CASL、SDK 与新目录尚未实施。

`AccessApi` 是宿主内部的聚合契约；SDK 保持业务分组，按授权投影公开用例，不直接透出内部认证、判定和上下文工厂。`sessions`、`captcha` 是 Access 内部协作能力，不额外成为插件可直接操作的分组。

`sdk/api/<模块>-api.ts` 按模块整理调用方可见的方法契约，显式选择开放用例，隐藏已绑定的 `AccessCallScope`，复用业务模块定义的安全输入、输出类型，不重复声明同义数据结构。根级 `sdk-api.ts` 仅聚合这些分组；模块内部 API 保留宿主上下文参数，操作检查统一在所属模块 register 配置，SDK 契约不携带内部授权工厂、规则或存储类型。方法绑定与转发仍由 `sdk-register.ts` 完成，`sdk/api/` 不另写业务实现或转调包装。

`modules/access/access-api.ts`：

```ts
import type { AccountsApi } from './accounts/accounts-api.js';
import type { AuthenticationApi } from './authentication/authentication-api.js';
import type { AuthorizationApi } from './authorization/authorization-api.js';
import type { LoginOptionsApi } from './login-options/login-options-api.js';
import type { AdmissionApi } from './admission/admission-api.js';
import type { TotpApi } from './totp/totp-api.js';
import type { PasskeysApi } from './passkeys/passkeys-api.js';
import type { OidcApi } from './oidc/oidc-api.js';

export interface AccessApi {
	readonly accounts: AccountsApi;
	readonly authentication: AuthenticationApi;
	readonly authorization: AuthorizationApi;
	readonly loginOptions: LoginOptionsApi;
	readonly admission: AdmissionApi;
	readonly totp: TotpApi;
	readonly passkeys: PasskeysApi;
	readonly oidc: OidcApi;
}
```

各子模块自己定义方法与类型。例如 `modules/access/passkeys/passkeys-api.ts` 的凭据管理部分：

```ts
import type { AccessCallScope } from '../authorization/authorization-api.js';

export interface PasskeySummary {
	credentialId: string;
	name: string | null;
	lastUsedAt: number | null;
}

export interface RenamePasskeyInput {
	credentialId: string;
	name: string;
}

export interface PasskeysApi {
	list(scope: AccessCallScope): Promise<PasskeySummary[]>;
	rename(scope: AccessCallScope, input: RenamePasskeyInput): Promise<void>;
}
```

`AccessCallScope` 是 Access 定义的宿主内部待校验作用域，`sdk-context.ts` 通过 Access 的宿主内部工厂建立并绑定真实调用来源。模块公共 API 接收该作用域，经 `protect` 完成 register 配置的检查后，才生成传给内部 Service 的 `AuthorizedCall`，绑定原身份、实际操作、资源范围及生命周期。具体契约在实施时确定，不把类型名、断言、只读属性或普通 `{ userId, permissions }` 对象当成安全证明。插件不接收上下文工厂，也不能通过方法参数提交上下文。关键事务及长生命周期资源复用同一授权能力复查，不要求各业务 Service 重复实现整套鉴权。上例仅展示凭据管理，注册与登录使用各自明确的准入契约。

`sdk-register.ts` 在启动时注入各模块已受保护的 API，提供 `createSdk(scope)`；调用时由 `sdk-context.ts` 创建作用域，再由该工厂生成绑定当前作用域的 SDK，对 HTTP 或 Agent 提供相同分组形式。上下文绑定与方法转发统一在 `sdk-register.ts` 完成，不新增独立 binding 层或逐模块绑定文件。共享工厂不保存某个用户的当前会话，各 SDK 实例始终绑定自己的原始作用域。

```ts
// sdk 已由宿主绑定当前调用身份、权限与生命周期。
const passkeys = await sdk.access.passkeys.list();
await sdk.access.passkeys.rename({ credentialId, name: '手机' });
```

SDK 保持相同业务分组，只绑定作用域并转发；各模块受保护的公共入口逐次检查，内部业务用例接收当前操作的 `AuthorizedCall`。认证方式、授权策略与业务流程分别由对应模块负责，SDK 不维护另一套权限状态，也不能删减检查。

### 可组合的公共检查

参考 [Strapi 的公共与模块策略](https://docs.strapi.io/cms/backend-customization/policies)、[Fastify Auth 的检查组合](https://github.com/fastify/fastify-auth)及 [Backstage 的公共权限服务](https://backstage.io/docs/backend-system/core-services/permissions/)，Access 集中提供公共检查，各业务模块在所属 register 中配置每个操作的检查组合。复用其策略与入口分离方式，不新增权限表达式语言或更换 HTTP 框架；Fastify Auth 的默认 OR 关系不直接作为本项目默认政策。

| 公共检查                       | 职责                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `authenticated`                | 委托认证服务验证原会话当前有效，取得可信身份；不重复实现会话验证      |
| `administrator`                | 根据当前可信身份判断管理员资格，复用统一资格规则                      |
| `permission(action, resource)` | 由业务 owner 提供真实资源事实，委托 CASL 判断操作、范围及实际写入字段 |
| `passwordProof`                | 委托认证服务检查当前敏感操作所需的密码复核凭据及其绑定范围            |

| 操作示例               | 检查组合                                         |
| ---------------------- | ------------------------------------------------ |
| 读取个人设置           | `authenticated`，实际查询限定当前用户            |
| 修改系统配置           | `authenticated + administrator`                  |
| 删除连接               | `authenticated + permission(delete, connection)` |
| 需要密码复核的敏感操作 | `authenticated + 对应权限 + passwordProof`       |

各模块在所属 `*-register.ts` 中统一配置每个操作的检查组合、资源读取及准入方式，调用 Access 的 `protect`，将检查与真实资源读取、业务处理装配成模块公共 API；SDK 只消费这些已受保护的方法。一级业务模块的 `*-register.ts` 负责模块装配，`sdk-register.ts` 负责聚合这些模块并绑定调用上下文，不重复应用 `protect`，也不要求每个子模块新增注册文件。组合由宿主代码维护，插件不能选择检查、提交权限结果或取得原始 Service。检查默认全部通过才放行；确有可替代的认证方式时显式声明 OR，身份失效、插件范围与工作区约束仍是不可绕过的共同前提。后台插件实例使用宿主验证的实例身份准入，不伪造会话套用 `authenticated`。

同一次准入按依赖顺序验证身份、读取必要事实并检查权限，后续检查复用本次可信身份，避免逐项重新查询会话。未声明政策的公共操作默认不开放，匿名及部分认证入口在 register 中显式配置准入方式；部分认证不能被视为完整登录。检查保留未认证、无权限及验证服务故障等具名失败，不能把服务故障当作 OR 的普通不匹配而降级放行。

用户权限、插件获授权限和工作区范围取交集，管理员资格不绕过这些共同约束。租约、连接状态、版本与业务流程仍归实际业务 owner；事务执行、异步交付及长连接后续操作在必要边界复查当前事实，不把本次检查结果作为永久许可。

### 认证与 CASL 授权适配

采用 [CASL](https://github.com/stalniy/casl) 统一授权判定，复用现有 Fastify、会话及登录体系，本次设计不引入 tRPC，也不改变已有 HTTP 路径、请求响应格式和 Cookie 语义。CASL 不提供身份认证、凭据签发、会话撤销、授权持久化或自动方法拦截，这些适配由宿主集中完成。

```text
HTTP / Agent / Workspace
    → sdk-context：根据真实会话及运行实例创建待校验的 AccessCallScope
    → sdk-register 提供的 createSdk(scope)：绑定作用域，转发到模块受保护的公共 API
    → 模块入口的 Access protect：按 register 配置组合执行公共检查，取得必要的真实资源事实
    → Access authorization：需要资源授权时取得当前规则，委托 CASL 判定
    → Access 授权服务生成绑定当前操作与资源范围的 AuthorizedCall
    → 业务用例：执行业务校验、流程协调与资源管理
    → 存储 Adapter：敏感写入在同一事务内先校验当前身份、授权及资源，再执行 SQL
```

| 所属层                          | 适配职责                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `modules/access/authentication` | 保留凭据验证、会话认证、退出及密码复核；同一入场阶段只做一次完整身份认证                                  |
| `modules/access/authorization`  | 提供公共检查与 `protect`；`getEffectiveRules` 读取当前规则，`withOperation` 管理授权及事务复查生命周期    |
| `authorization/adapters/casl`   | 隔离 CASL 类型与实例，执行规则计算；不解析 Cookie、不查询业务数据库、不接收插件提供的 Ability             |
| `authorization/adapters/sqlite` | 保存授权记录，读取事务内授权事实；规则可序列化不代表 CASL 自动负责持久化                                  |
| `sdk/api/<模块>-api.ts`         | 定义显式选择的调用方方法，隐藏宿主上下文，复用模块安全输入、输出类型；根级 `sdk-api.ts` 只聚合分组        |
| `sdk/sdk-register.ts`           | 注入受保护的模块 API，提供 `createSdk(scope)` 完成上下文绑定与方法转发，不重复授权                        |
| `sdk/sdk-context.ts`            | 创建、管理及释放调用作用域，保存可信凭据来源与实例关联，不签发业务许可                                    |
| 各业务模块                      | 在所属 register 维护唯一检查组合、资源读取及准入配置，应用 Access `protect`，保留业务流程、事务与生命周期 |

`protect` 只在 Access 的 `authorization-service.ts` 实现一次，通过宿主内部契约提供给各模块注册入口，不交付给插件。`authorization-policy.ts` 提供可复用的公共检查，各模块 register 配置具体组合，真实凭据验证与密码复核归认证服务，`getEffectiveRules`、授权判定及 `withOperation` 归授权服务，CASL Adapter 的 `assertAllowed` 负责库调用。各模块 register 按操作配置装配检查、资源读取与处理函数，SDK 不直接导入 CASL Adapter 或操作数据库。

`withOperation` 通过授权存储契约及 SQLite Adapter 接入 `withTransactionAdmission`：公共入口可预检，实际 SQLite 写事务在首个业务写入前读取当前身份、授权及必要资源事实，执行同一策略后再写入。校验与写入共用事务，不依赖入口阶段的旧资源快照。删除资源、改密撤销会话或退出后，不重复要求本操作已删除的资源或已撤销的凭据仍有效。现有 `SqliteRuntime` 会在业务回调前后调用准入检查，实施时需调整这一行为，不能直接沿用写后重复鉴权。`AuthorizedCall` 的创建与有效性由 Access 授权服务管理，SDK 只取得本次操作使用的结果，不自行签发授权。

每个对外操作在所属模块的 register 中统一配置所需检查、动作、资源类型及必要的资源读取方式，生成受保护的公共方法；`*-api.ts` 仅定义调用契约。HTTP、插件及跨业务域调用使用同一受保护出口，不能因直接调用模块 API 而跳过检查；原始 Service、上下文工厂及 CASL 实例不交给插件，授权管理仅通过显式获准的管理用例进行。同模块内部协作不强制逐函数绕行 SDK。

身份来自有效凭据，插件身份来自宿主管理的真实运行实例或通信通道；Workspace 是需验证的作用范围，可以与 Agent 插件身份同时存在。操作范围同时受用户权限、插件获授权限及工作区约束，不能把三者允许项简单合并而扩大权限；声明自己需要某项权限不等于获得授权。资源类型由宿主显式指定，归属、目标及工作区事实从真实 owner 读取，不信任客户端提交的同名属性。

业务中的重复管理员判断及可表达为 CASL 条件的归属权限迁入统一授权，业务 Service 保留状态校验、关联更新、副作用协调与失败清理。字段授权需核对实际修改字段；列表、读取和写入仍在真实查询中落实已授权范围。CASL 不会自动给现有 SQLite 查询添加过滤，也不替代参数校验、CAS、事务或远端路径检查。

调用作用域随请求或插件调用结束释放，不能把创建时的认证结果永久固化为许可。退出、到期、插件停用及工作区关闭后，相关旧作用域的后续调用失效；授权变更后按当前规则重新判定。如缓存 CASL 规则，缓存归授权 owner，写入成功及提交未知均使相关快照失效，重新读取权威记录后再判定，存活作用域不继续持有旧 Ability 作为许可。敏感写入按前述事务内写前校验执行；一次事务的准入不作为后续事务或独立任务的永久许可。

长连接、传输及独立后台任务保留原 owner 和授权生命周期，在既有派发、交付等边界调用公共复查能力，不能继承已结束请求的临时许可。撤权不跳过必要清理。拒绝、认证失效、存储故障与提交未知继续使用明确安全错误，不泄露 CASL 或数据库内部错误，不把已发生副作用改报为确定未执行。

CASL 负责正常调用的统一授权规则计算。按当前决定，后端插件同进程、前端插件同页面运行，不建设沙箱；SDK 和 CASL 不承诺限制受信插件直接使用 Node 或页面对象。登录、当前用户、资源权限及可信确认仍按统一入口执行。

### 现有实现的归属与收敛范围

以下为实施时的替换范围；新受保护出口及相应事务、交付检查接通后移除旧实现，不长期保留两套策略。

| 现有模块实现                                                                                         | 目标归属                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts/model/account-model.ts`                                                                    | 账号用例归 `accounts-service.ts`，应用与存储对象转换归 `accounts-mapper.ts`，SQL 留 Adapter                                                                                               |
| `accounts/adapters/sqlite/account-sql.ts` 的改密与会话撤销 SQL                                       | Accounts 保留账号及密码修订写入，Sessions 提供身份读取与撤销参与者；register 注入，共用改密外层事务，不跨 owner 写表                                                                      |
| `authentication/service/access-service.ts` 中混合的初始化、改密、封禁管理及验证码配置读取            | 分别归 accounts、admission、login-options；authentication 专注登录、身份认证、退出与密码复核                                                                                              |
| `sessions/model/session-model.ts`、`sessions/login-failure-rules.ts` 及 Session Adapter 中的失败记录 | 完整会话归 sessions；失败计数、封禁、解除及其表定义归 admission                                                                                                                           |
| `factors` 下的 Service、Model、types、storage、SQLite Adapter、`options-projector.ts` 与命名规则     | 按 TOTP、Passkey 拆归两个子模块；WebAuthn 转换归 `passkeys-mapper.ts`，命名归 `passkeys-rules.ts`；密码认证修订归 accounts，挑战各归实际认证子模块，表定义只保留一个 owner                |
| `oidc/model/oidc-model.ts`                                                                           | 用例协调归 `oidc-service.ts`，纯规则归 `oidc-rules.ts`，技术及存储对象转换归 `oidc-mapper.ts`，原子流程消费留 SQLite Adapter                                                              |
| `captcha` 的 Model／Service 及 Platform 的 CAPTCHA 契约、网络实现                                    | 按 tree 归入 captcha：流程归 service，纯校验归 rules，转换归 mapper，契约归 provider，出站 HTTP 归 `adapters/http/captcha-verifier.ts`；不保留两套实现                                    |
| `platform/security` 的 TOTP、WebAuthn、OIDC 契约及对应 Adapter                                       | 契约分别归 `totp-provider.ts`、`passkeys-provider.ts`、`oidc-provider.ts`；实现及验证器名称元数据移至所属子模块 adapters，沿用已有库和协议验证，不保留原路径转导出                        |
| `login-options/model/login-options-model.ts`                                                         | 展示聚合、缓存及失效生命周期归 `login-options-service.ts`                                                                                                                                 |
| 根级 `login-failure-policy.ts`、`login-failure-types.ts` 及 admission 中的通用 IP 运算               | 封禁政策与内部类型归 admission，通用 IP 能力归同级 `utils/ip.ts`                                                                                                                          |
| `accounts/adapters/sqlite/backup-exclusions.ts`                                                      | 移除独立排除清单；各认证与授权子模块在所属 SQL Adapter 的表描述中声明排除，由全局备份引擎核对覆盖                                                                                         |
| `interfaces/http`、`public.ts`、`register.ts`、`migrations.ts` 及四个错误文件                        | HTTP 移至同级 `http/access`；契约、装配及初始化按 tree 命名；`access-failure.ts`、`access-errors.ts`、`public-errors.ts`、`access-storage-boundary.ts` 归并到 `access-mapper.ts`          |
| `operations/audit/service/audit-event-owner.ts`、`operations/register.ts` 的跨子模块协调             | 归 `operations-service.ts` 与 `operations-register.ts`；事件发布、请求追踪、停机排空及失败汇总不留在 HTTP 中                                                                              |
| `operations` 下 audit、logging、notifications 的 Model 与 Service                                    | 按 tree 平铺到各子模块；流程归 service、纯规则归 rules、存储及技术转换归 mapper；notifications 的内部工作任务归 worker                                                                    |
| `operations/audit/adapters/sqlite/audit-sql.ts` 的审计追加与 pending 写入                            | 审计追加及去重留 audit；pending 的 SQL 归 notifications，通过注入能力共用审计外层事务，不新增模块级 SQL Adapter                                                                           |
| `operations/interfaces/http`、`snapshots/adapters/sqlite` 及分散错误文件                             | HTTP 移至 `http/operations`；备份声明随各子模块表描述，通知备份转换与恢复校验归 `notifications-sql.ts`；错误归 `operations-mapper.ts`，存储拒绝由 mapper 转换                             |
| `preferences` 各子功能的 Service、Model、types、storage 及分散错误文件                               | 按完整 tree 平铺：流程归 service、对象及失败转换归 mapper，现有存储契约及行解码保留真实 owner；共用错误收敛到 `preferences-mapper.ts`，不额外创建无用的 rules 或存储层                    |
| `preferences/appearance` 内背景、HTML 主题及远端目录能力                                             | 保留 appearance 功能归属，以 `appearance-background-*`、`appearance-html-themes-*` 明确职责；GitHub 协议留 Adapter，远端目录契约从 storage 移到 provider，Blob／图片技术继续复用 Platform |
| `preferences/interfaces/http/*-http-support.ts`、deadline 与各 mapper                                | 协议解码与投影归 `http/preferences`；交付／断线协调归 `preferences-delivery.ts`；重复认证和管理员判定由受保护 SDK 入口替代，不能把业务超时或资源 owner 搬进通用 HTTP helper               |
| `remote` 下 machines、sessions、files、monitoring、desktop、tools、transfers 的 Service／Model       | 全部按 tree 平铺并加所属子模块前缀；Model 中流程归 service／资源 owner，转换归 mapper，具体 ssh2／RDP／Docker／归档／传输实现继续通过 Platform 契约消费，不机械包第二层 Adapter           |
| `remote/sessions` 的 session-owner、Workspace、history、shell、command 与 session-limits             | 各职责分别落到 sessions 前缀文件，保留唯一 Workspace 登记及原资源 owner；重复身份判断接入公共授权，挂起／恢复 ACK／租约、输出顺序、背压和真实清理继续由 Sessions 管理                     |
| `remote/files/model/file-resource.ts` 及文件任务辅助流程                                             | 应用资源封装归 `files-resource.ts`；复制／移动、搜索、归档、ZIP 下载、队列与下载票据各归 tree 中对应职责，通用 SFTP 读写和协议实现仍归 Platform SSH，不删除原未知效果与清理语义           |
| `remote/interfaces/http`、`interfaces/ws`、observation-view 与 suspend-view                          | 所有协议入口移到 `http/remote`，投影收敛到协议 mapper；业务经 SDK，原始 socket 与技术传输在协议／技术层接线，不进入应用 Service                                                           |
| `targets` 各子功能及根级 model、storage、validation、public-mappers、ssh-graph 文件                  | 按 tree 收敛到对应子模块，公共错误归 `targets-mapper.ts`；图规则与政策归 connections，凭据与桌面目标继续归 connections，可信 SSH 快照归 resolver；原管理鉴权壳由 Access protect 替代      |
| `targets` 的连接／标签关系、代理／标签管理 SQL 和 import 事务参与者                                  | 每张表只有一个 owner；管理与导入复用同一 SQL 能力，跨功能事务由协调入口共享执行器，不复制关系 SQL、不各自提交；只读连接图、桌面目标及 resolver 不重复注册表                               |
| Preferences、Remote、Targets 的 `snapshots/adapters/sqlite/snapshot-registration.ts`                 | 移除独立快照目录与清单，表描述随各 owner SQL，register 只汇总；字段、秘密、文件引用、恢复状态及关联校验规则由原 owner 就近维护，Platform 统一核对并执行                                   |
| `system` 的 Service／Model／types、diagnostic SQL 与接口                                             | 按 tree 平铺到 diagnostics、status、backups；诊断 SQL 继续只读，协议移到 `http/system`；备份应用用例不接收原始 HTTP Request，宿主维护与实例重建由 Bootstrap 协调                          |
| `platform/security/source-address.ts`、`adapters/source-addresses.ts` 与 Access 内通用 IP 运算       | 收敛到 `utils/ip.ts`，继续复用 ipaddr.js；Access 保留来源准入政策，HTTP 保留可信代理来源解析，不保留平行解析实现                                                                          |
| `bootstrap` 中模块路由汇总、schema／快照接线及全局维护                                               | 继续只做宿主装配：依赖、受保护 API、表描述与生命周期由模块 register 提供；通信入口由同级 http 装配，恢复期间重建模块与 SDK，真实业务决策不移到 Bootstrap                                  |

| 现有部分                                                                                                                                                         | 目标处理                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `targets/interfaces/http/target-http.ts` 的 `readActor`，`preferences/interfaces/http/*`、`operations/interfaces/http/operations-http.ts` 的重复认证及管理员判断 | 路由改走受保护 SDK，删除重复 helper；Cookie 处理集中保留在 HTTP 入口                                                     |
| `targets/management` 的 Service、Model、types、storage、SQLite Adapter 五个文件                                                                                  | 认证、管理员判定及事务作用域接入公共授权后整体移除；保留实际写事务内首个业务写入前的当前事实校验，不机械重放写后授权检查 |
| Preferences、Operations、System、Remote 等用例中散落的 `userId === 1`／`userId !== 1` 授权分支                                                                   | 管理员资格映射及授权集中为公共策略，模块 register 配置各操作权限；不删除用例自身的业务状态及资源管理                     |
| 各层只为传递 token、计算摘要或重复授权而存在的 Actor 与包装                                                                                                      | 归并到宿主可信上下文和公共授权适配，真实存储契约及必要数据转换保留                                                       |
| `bootstrap/module-manifest.ts` 的应用写入提前认证                                                                                                                | 接入公共认证能力，保留正文解析前拒绝未认证写入的时点，不能仅用 handler 内 CASL 检查替代                                  |
| SDK 的上下文绑定、方法转发及计划重复编写的鉴权逻辑                                                                                                               | 绑定与转发合并到 `sdk-register.ts`；授权复用模块入口的 Access `protect`，错误沿所属模块 mapper 转换                      |

保留 Access 的账号、会话、密码复核、TOTP、Passkey、OIDC，保留来源白名单、封禁、Cookie、Origin/CSRF 与安全头。保留 SQLite 事务准入及当前身份读取能力、资源租约、连接指纹、后台任务与流式交付的有效性复查。现有 `@fastify/cookie`、`openid-client`、WebAuthn、TOTP 等依赖不由 CASL 替代；新增依赖限定为实际使用的 CASL 包，原有依赖仅在失去真实消费者时移除。
