# Passkey 模块

WebAuthn Passkey 认证模块，提供 Passkey 注册、认证、管理功能。

## 文件结构

| 文件 | 职责 |
|------|------|
| `passkey.service.ts` | Passkey 业务逻辑（注册挑战、认证验证、凭证管理） |
| `passkey.repository.ts` | Passkey 数据访问层 |
| `passkey.service.test.ts` | 单元测试 |

## 无独立 Routes 的原因

Passkey 功能的 HTTP 端点注册在 `auth/auth.routes.ts` 中（`/api/v1/auth/passkey/*`），原因是：

1. **认证流程统一**：Passkey 登录是认证流程的一部分，与密码登录、2FA 共享相同的会话管理和中间件链
2. **依赖 auth 模块**：Passkey 端点需要 auth 中间件（认证检查、IP 黑名单等），放在 auth 模块内可直接引用
3. **避免循环依赖**：Passkey service 被 auth.controller 调用，如果独立路由会引入额外的跨模块引用

## 跨模块依赖

- `passkey.service.ts` 依赖 `auth/auth.repository.ts`（用户表操作）
- `auth/auth.controller.ts` 调用 `passkey/passkey.service.ts`（Passkey 认证流程）
- `auth/auth-passkey-flow.utils.ts` 编排 Passkey 登录流程
