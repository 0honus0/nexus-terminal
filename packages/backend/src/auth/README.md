# Auth 模块

本模块负责用户认证全流程，采用扁平文件结构组织，按功能命名区分。

## 文件结构

### 核心文件

| 文件                 | 职责       |
| -------------------- | ---------- |
| `auth.routes.ts`     | 路由定义   |
| `auth.controller.ts` | 请求处理   |
| `auth.middleware.ts` | 认证中间件 |

### Flow 文件（认证流程编排）

| 文件                                              | 职责                      |
| ------------------------------------------------- | ------------------------- |
| `auth-main-flow.utils.ts`                         | 主登录流程编排            |
| `auth-login-2fa-flow.utils.ts`                    | 登录 2FA 流程             |
| `auth-passkey-flow.utils.ts`                      | Passkey 登录流程          |
| `auth-passkey-2fa-flow.utils.ts`                  | Passkey + 2FA 流程        |
| `auth-two-factor-flow.utils.ts`                   | 2FA 通用流程              |
| `auth-2fa-mutation-flow.utils.ts`                 | 2FA 变更流程（启用/禁用） |
| `auth-2fa-state-flow.utils.ts`                    | 2FA 状态查询流程          |
| `auth-login-two-factor-actions.utils.ts`          | 登录 2FA 动作执行         |
| `auth-two-factor-enabled-actions.utils.ts`        | 2FA 已启用时的动作        |
| `auth-two-factor-session-actions.utils.ts`        | 2FA 会话管理动作          |
| `auth-two-factor-setup-actions.utils.ts`          | 2FA 初始化设置动作        |
| `auth-two-factor-verify-failure-actions.utils.ts` | 2FA 验证失败处理          |
| `auth-two-factor-verify-success-actions.utils.ts` | 2FA 验证成功处理          |
| `auth-password-disable2fa-flow.utils.ts`          | 密码禁用 2FA 流程         |
| `auth-passkey-register-auth-flow.utils.ts`        | Passkey 注册认证流程      |

### Action 文件（具体操作）

| 文件                                       | 职责              |
| ------------------------------------------ | ----------------- |
| `auth-login-log-actions.utils.ts`          | 登录日志记录      |
| `auth-passkey-log-actions.utils.ts`        | Passkey 日志记录  |
| `auth-passkey-management-actions.utils.ts` | Passkey CRUD 动作 |
| `auth-passkey-management-flow.utils.ts`    | Passkey 管理流程  |
| `auth-passkey-register-auth-flow.utils.ts` | Passkey 注册流程  |
| `auth-password-security-actions.utils.ts`  | 密码安全操作      |
| `auth-two-factor-log-actions.utils.ts`     | 2FA 日志记录      |
| `auth-security-side-effects.utils.ts`      | 安全副作用执行    |
| `auth-side-effects-executor.utils.ts`      | 副作用执行器      |
| `auth-init-data.utils.ts`                  | 初始化数据处理    |
| `auth-init-status-flow.utils.ts`           | 初始化状态流程    |

### 基础设施

| 文件                             | 职责                |
| -------------------------------- | ------------------- |
| `auth-controller-sql.utils.ts`   | 控制器层 SQL 工具   |
| `captcha.service.ts`             | 验证码服务          |
| `ip-blacklist.service.ts`        | IP 黑名单服务       |
| `ipBlacklistCheck.middleware.ts` | IP 黑名单检查中间件 |
| `ipWhitelist.middleware.ts`      | IP 白名单中间件     |

## 设计说明

auth 模块文件较多（26 个工具文件），采用扁平结构而非子目录分组，原因：

1. 所有文件均以 `auth-` 前缀命名，可通过前缀快速筛选
2. Flow/Action 文件之间存在交叉依赖，子目录会增加导入路径复杂度
3. 测试文件与源文件同名配对（`.test.ts`），扁平结构便于查找

如果未来文件数继续增长，建议按 `flows/`、`actions/`、`utils/` 分组重构。
