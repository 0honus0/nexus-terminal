## 1. 基础能力与现有归属

以下八项已确认，均按“已有基础能力 → 基础插件 → 公共 API”描述，到 API 层为止；名称表示职责，具体契约与发布包划分后续确定。

### Remote

```text
Remote 基础能力（项目已有 SSH、远程进程及 PTY 实现）
    → Remote 基础插件
    → Remote API（命令、进程、终端输入输出、尺寸及生命周期）
```

复用 Backend `modules/remote` 与 `platform/ssh`，连接配置、凭据、代理及主机信任沿用本体。

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

```text
packages/backend/src/
├── modules/
│   └── access/
│       ├── access-api.ts                  # 业务模块安全出口，供 SDK 绑定，独立于 HTTP 与 Agent
│       ├── access-register.ts             # 创建并注入业务实例、聚合返回 AccessApi，管理配置与生命周期
│       ├── access-migrations.ts           # 模块迁移入口，只编排所属 Adapter 的迁移函数
│       ├── access-mapper.ts               # 共用错误定义及对内、对外错误转换，集中在一个文件
│       ├── accounts/
│       │   ├── accounts-api.ts            # 子模块调用契约及对调用方公开的输入、结果类型
│       │   ├── accounts-service.ts        # 应用用例：权限、业务规则与流程协调
│       │   ├── accounts-types.ts          # accounts 内部实现类型，不作为子模块调用契约
│       │   ├── accounts-rules.ts          # 必要的纯业务规则，不访问存储或调用 Service
│       │   ├── accounts-mapper.ts         # 必要的应用／存储对象转换；简单转换留所属文件
│       │   ├── accounts-storage.ts        # 存储接口及存储命令、记录类型，不执行 SQL
│       │   └── adapters/sqlite/
│       │       ├── accounts-schema.ts     # 建表定义
│       │       └── accounts-sql.ts        # 存储接口实现：SQL、事务与并发条件检查
│       ├── authentication/
│       │   ├── authentication-api.ts      # 认证调用契约及对调用方公开的输入、结果类型
│       │   └── authentication-service.ts  # 实现认证 API：登录、身份认证、退出与密码复核
│       ├── login-options/
│       │   ├── login-options-api.ts       # 可用登录方式与验证码公开配置的读取契约
│       │   └── login-options-service.ts   # 聚合公开登录配置，管理缓存及失效生命周期
│       ├── totp/
│       │   ├── totp-api.ts                # 动态验证码认证、绑定与关闭的调用契约
│       │   ├── totp-service.ts            # 两步验证用例、待完成密码登录与验证流程
│       │   ├── totp-types.ts              # TOTP 内部类型
│       │   ├── totp-storage.ts            # TOTP 配置、绑定挑战及待完成登录的存储契约
│       │   └── adapters/sqlite/
│       │       ├── totp-schema.ts         # TOTP 所属表定义
│       │       └── totp-sql.ts            # TOTP 挑战与待完成登录的原子消费
│       ├── passkeys/
│       │   ├── passkeys-api.ts            # 通行密钥注册、登录和凭据管理的调用契约
│       │   ├── passkeys-service.ts        # 注册、登录、查询、重命名与删除用例
│       │   ├── passkeys-types.ts          # Passkey 内部类型
│       │   ├── passkeys-storage.ts        # Passkey 凭据、注册与登录挑战的存储契约
│       │   └── adapters/sqlite/
│       │       ├── passkeys-schema.ts     # Passkey 所属表定义
│       │       └── passkeys-sql.ts        # 挑战消费、凭据更新及计数器并发检查
│       ├── oidc/
│       │   ├── oidc-api.ts                # OIDC 配置、绑定与登录的调用契约
│       │   ├── oidc-service.ts            # OIDC 配置、授权回调与绑定、登录用例
│       │   ├── oidc-types.ts              # OIDC 内部类型
│       │   ├── oidc-storage.ts            # OIDC 配置、流程与会话关联的存储契约
│       │   └── adapters/sqlite/
│       │       ├── oidc-schema.ts         # OIDC 所属表定义
│       │       └── oidc-sql.ts            # OIDC 流程消费及持久化事务
│       └── admission/
│           ├── admission-api.ts           # 准入调用契约及对调用方公开的输入、结果类型
│           ├── admission-service.ts       # 实现准入 API：组合白名单与封禁状态，决定是否放行
│           ├── admission-policy.ts        # 登录失败封禁策略、配置校验与热更新
│           ├── admission-rules.ts         # 内网放行、白名单等业务准入规则
│           └── admission-types.ts         # admission 内部实现类型
├── sdk/
│   ├── sdk-api.ts                         # 统一 SDK 调用契约，按业务模块组织 API
│   ├── sdk-register.ts                    # 注入业务能力，创建绑定可信身份与权限的 SDK
│   ├── access/
│   │   ├── access-api.ts                  # SDK 的 Access API 与安全输入、输出契约
│   │   └── access-bindings.ts             # 绑定 Access 用例、调用身份、权限范围与错误转换
│   └── client/                            # 后续对外发包的纯 SDK 代理，不包含服务端装配实现
├── http/
│   ├── http-register.ts                   # 汇总各业务域路由，交给 Bootstrap 安装
│   └── access/
│       ├── access-cookie.ts               # 认证 Cookie 读取、设置与清除，属于 HTTP 协议
│       ├── access-accounts-http.ts        # 初始化、改密路由 → SDK Access API
│       ├── access-authentication-http.ts  # 登录、状态与退出路由 → SDK Access API
│       ├── access-totp-http.ts            # TOTP 登录、绑定与关闭路由 → SDK Access API
│       ├── access-passkeys-http.ts        # 通行密钥路由 → SDK Access API
│       ├── access-oidc-http.ts            # OIDC 配置、绑定与回调路由 → SDK Access API
│       └── access-admission-http.ts       # 封禁管理路由 → SDK Access API
├── utils/
│   └── ip.ts                              # 通用 IP 规范化、地址分类、CIDR 解析与网段匹配
└── platform/security/
    ├── password-hasher.ts                 # 通用密码计算契约
    ├── secret-box.ts                      # 通用加解密能力
    └── adapters/                          # 对应技术实现，按实际能力组织
```

## 3. 对外 API 设计

根 API 只聚合分组，方法及输入、输出类型由各子模块维护。以下为设计示例。

`modules/access/access-api.ts`：

```ts
import type { AccountsApi } from './accounts/accounts-api.js';
import type { AuthenticationApi } from './authentication/authentication-api.js';
import type { LoginOptionsApi } from './login-options/login-options-api.js';
import type { AdmissionApi } from './admission/admission-api.js';
import type { TotpApi } from './totp/totp-api.js';
import type { PasskeysApi } from './passkeys/passkeys-api.js';
import type { OidcApi } from './oidc/oidc-api.js';

export interface AccessApi {
	readonly accounts: AccountsApi;
	readonly authentication: AuthenticationApi;
	readonly loginOptions: LoginOptionsApi;
	readonly admission: AdmissionApi;
	readonly totp: TotpApi;
	readonly passkeys: PasskeysApi;
	readonly oidc: OidcApi;
}
```

各子模块自己定义方法与类型。例如 `modules/access/passkeys/passkeys-api.ts` 的凭据管理部分：

```ts
import type { AuthenticatedCall } from '../authentication/authentication-api.js';

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
	list(context: AuthenticatedCall): Promise<PasskeySummary[]>;
	rename(context: AuthenticatedCall, input: RenamePasskeyInput): Promise<void>;
}
```

`AuthenticatedCall` 表示由可信入口建立的认证调用上下文，其具体契约在实施时确定；业务端仍须复查实际身份与权限，不能把传入的用户 ID 当作授权。上例仅展示凭据管理，注册与登录使用各自明确的准入契约。

SDK 将可信上下文绑定到上述业务调用，对 HTTP 或 Agent 提供相同分组形式：

```ts
// sdk 已由宿主绑定当前调用身份、权限与生命周期。
const passkeys = await sdk.access.passkeys.list();
await sdk.access.passkeys.rename({ credentialId, name: '手机' });
```

SDK 保持相同分组，绑定调用上下文并按授权提供能力，复用业务实现与安全类型。
