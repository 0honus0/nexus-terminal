# Remote Desktop Architecture

本文记录正式 `packages/backend` 的 RDP/VNC 实现，按 [模块模板](MODULE_TEMPLATE.md) 组织。新 `backend-next` 尚未迁移桌面运行能力，不能将下述旧包目录用于新模块放置；新能力须遵守 [Backend 架构](BACKEND.md)。

## 1. 职责与范围

浏览器经主 Backend 的 `guacamole-lite` 连接独立 `guacd`，再访问 RDP/VNC。凭据仅在后端，前端只取得短期不透明 ticket。正式操作与容量见 [USAGE](../USAGE.md#远程桌面)。

## 2. 子功能与目录

| 正式包位置                                                      | 职责                                           |
| --------------------------------------------------------------- | ---------------------------------------------- |
| `modules/remote-desktop/remote-desktop-session.service.ts`      | 解析连接、解密凭据、验证显示选项、记录连接尝试 |
| `platform/remote-desktop/remote-desktop-session-issuer.port.ts` | 正式包桌面会话技术契约                         |
| `infrastructure/guacamole/guacamole-runtime.adapter.ts`         | 票据、Guacamole bridge、guacd 连接及关闭       |
| HTTP/WS 接口                                                    | 创建 ticket、身份/Origin/IP/2FA 校验、upgrade  |

这些是现存旧包 owner，不是新架构的例外或迁移计划。

## 3. 依赖方向

正式协议入口 → RemoteDesktopSessionService → 会话契约 → GuacamoleRuntimeAdapter → guacd。WS 由 Backend 唯一 upgrade owner 安装，验证完成后才交给 Guacamole。

新桌面用例应归 Remote、配置归 Targets、技术实现归 Adapter；具体迁移设计待对应阶段按新规则补齐。

## 4. 类型与转换

浏览器只收随机 ticket，真实连接请求保留后端内存，不返回主机凭据。`guacamole-lite` 1.2.0 的加密 token 仅为私有桥接，内容为一次性 bridge ID；Adapter 将 ID 转回已消费的内存请求，不含 hostname/password/RemoteApp 凭据。

该私有桥接不属于前端 API。新 Shared 类型与逐字段转换须随桌面真实消费者迁移，当前不预建。

## 5. 入口与安装

```text
POST /api/v1/connections/:id/rdp-session
POST /api/v1/connections/:id/vnc-session
WS   /ws/remote-desktop?ticket=...
```

无独立 9090 token API 或 8080 WS listener。Compose 使用统一镜像 frontend/backend 两种角色，独立 guacd 服务：

```text
browser → frontend/nginx → backend:3001 → guacamole-lite → guacd:4822 → target
```

宿主直接运行 Backend 可配置 GUACD_HOST/GUACD_PORT；Compose 固定 guacd:4822，见 [DEPLOYMENT](../DEPLOYMENT.md)。

## 6. 数据、事务与并发

ticket 绑定认证用户、限时且一次消费；待用票据与连接容量独立，实际请求只在内存，不提供持久会话恢复。连接创建与 TCP/WS 关闭不视为数据库原子事务。

## 7. 生命周期与失败

认证、Origin、IP 和 2FA 在消费票据前检查。Backend shutdown 关闭 WS、Guacamole 连接与待用票据。票据不可跨用户复用，过期或重复消费拒绝；关闭本地连接不证明远端应用副作用回滚。

## 8. 当前能力与验收

正式包已提供 RDP/VNC；新后端尚未提供桌面 runtime。测试范围与历史证据见 [E2E](../testing/E2E.md)，当前重构任务见 [实施方案](../后端重构下一阶段实施方案.md)。正式桌面测试不能算新后端迁移完成，新阶段必须补 Shared、真实消费者与适用检查。
