# 远程桌面架构

按 [模块模板](MODULE_TEMPLATE.md) 维护 backend-next RDP/VNC 设计。正式前端与旧 Backend 尚未切换；旧实现只作为功能盘点依据，源码/静态与 B10 行为验收分别记录于 [testing](../testing/后端重构待实机验证.md#b33-源码阶段最终收口)。

## 1. 职责与范围

Remote desktop 持有桌面 ticket、入场、容量、授权复查及会话生命周期；Targets 持有配置、密文和版本；Access 提供可信身份。浏览器只取得不透明 ticket，经统一 Backend WS、Guacamole Adapter、guacd 访问 RDP/VNC。普通 SSH、Agent 和桌面分别持有资源与权限，共用通用技术能力，不共享活跃会话。

当前只支持 direct route。旧 Guacamole 入口没有真正的桌面 Proxy/Jump 转发；新目标声明其他 route 时明确拒绝，不能静默直连。真实代理能力需另行设计。产品入口和限制见 [USAGE](../USAGE.md#远程桌面)。

## 2. 子功能与目录

| 位置                                                            | 职责                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| remote/desktop/service/desktop-service.ts                       | ticket、准入、期限、身份/配置复查、轮询与关闭；只消费应用 DesktopPeer。              |
| remote/desktop/model/desktop-types.ts                           | DesktopConnection、Display、Ticket/Result、实例绑定 DesktopPeer。                    |
| remote/desktop/model/desktop-model.ts                           | 捕获 WS/HTTP 技术句柄，转换参数和失败，返回窄应用能力；关闭技术 owner。              |
| remote/interfaces/http/desktop-http.ts、ws/desktop-ws.ts        | Shared 解码、逐字段响应、安全错误、raw WS 交付。                                     |
| targets/connections/{service,model,storage,adapters/sqlite}     | 桌面配置/密文原子读取、应用转换、技术解密、近期尝试事务；出口投影归 public-mappers。 |
| platform/desktop/desktop-port.ts、adapters/guacamole-desktop.ts | 技术请求/失败、guacamole-lite/guacd 原生参数、派发和关闭观察。                       |
| platform/desktop/adapters/guacamole-lite.d.ts                   | 实际第三方 API 的局部声明，不散落通用 src/types。                                    |
| shared/remote/desktop/{values,http,http-codec}                  | 双端基础值、显示/path/ticket 请求、成功/安全错误响应及纯解码。                       |

旧依据为 modules/remote-desktop/remote-desktop-session.service、infrastructure/guacamole/guacamole-runtime.adapter、connections HTTP routes、旧 WS 和正式 remoteDesktopApi/Guacamole 客户端；不沿用其内部层级作为新设计。

## 3. 依赖方向

HTTP/WS → DesktopService → DesktopPeer（DesktopModel 创建）→ DesktopTransport → GuacamoleDesktopAdapter。Service 不导入 ws、IncomingMessage 或技术 Port；Model 不反向依赖 Service。

Remote 经 Targets public 的 desktopTargets 消费可信快照；Targets 内部使用自己的 ResolvedDesktopTarget，register 经 public-mappers 白名单转成 TrustedDesktopTarget。SecretBox 调用在 Targets Model，Service 只负责目标政策；密文不越过可信出口，明文不进入 Shared/HTTP。

Platform 不引入 Remote/Targets/Access 对象或业务注册槽。原生 Guacamole 字节流由统一 Platform HTTP 的 raw WS 能力接入，不新增 listener。

## 4. 类型与转换

| 边界                          | 类型 owner                                                                          | 转换 owner                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| HTTP path/query、WS ticket    | Shared remote/desktop/http 与 codec                                                 | Interface 严格解码后逐字段构造 DesktopDisplay。                   |
| 存储 → Targets 应用           | connections/storage 与 model/desktop-target-types                                   | DesktopTargetModel；Adapter 校验实际行，Model 校验桌面用途。      |
| Targets 内部 → 跨模块可信输出 | ResolvedDesktopTarget 与 public TrustedDesktopTarget                                | public-mappers/toTrustedDesktopTarget。                           |
| 可信输出 → Remote 应用 → 技术 | DesktopConnection/Display 与 DesktopTransportRequest                                | desktop-model；即使字段一致也保留转换。                           |
| 技术失败 → 应用 → 协议        | DesktopTransportFailure、DesktopFailure/RemoteResourceCleanupFailure、Shared 安全码 | Adapter 归一，Model 转换，Interface 安全投影；原始 cause 不外泄。 |

技术内部 AES token 只含随机 bridge ID；目标地址、密码和 RemoteApp 参数保存在 Adapter 私有映射。正式前端 Shared 消费与响应 codec 对接留 F-R12，不宣称当前双端迁移完成。

## 5. 入口与安装

```text
POST /api/v1/connections/:id/rdp-session
POST /api/v1/connections/:id/vnc-session
WS   /ws/remote-desktop?ticket=...
```

HTTP 无 body，仅支持可选 width/height/dpi；成功仅返回 ticket、lastConnectedAt。统一 HTTP owner 核对 Origin/Host/可信代理，WS 入场检查 Cookie；跨升级、建连和交付后仍复查当前身份/配置。

registerRemote 安装 Model、Service、HTTP/WS；Guacd 使用 GUACD_HOST/GUACD_PORT，默认 localhost:4822，Compose 为 guacd:4822。没有独立 8080/9090 服务。部署见 [DEPLOYMENT](../DEPLOYMENT.md)。

## 6. 数据、事务与并发

Targets 在同一 SQLite 只读事务读取连接版本与密码密文，Model 解密；RDP/VNC credentials.set 接受密码、拒绝 SSH key。初始 Connections 表的 last_connected_at 单独记录尝试，版本匹配更新，不改变配置版本；SQL/DDL 均归 Adapter，Bootstrap 只编排迁移。

ticket 绑定当前 Cookie 摘要、用户、目标版本、协议及显示配置，30 秒有效，WS 同步一次消费；票据不保存明文凭据。签发与待用共用 1024 配额，连接中/活跃/未确认清理共用16槽。近期连接记录表示尝试，不表示远端已连接；取消后不再派发新的近期写入，已派发写入不声称回滚。

Guacamole vendor 在 await 后读取可变编号；Adapter 只串行客户端构造/派发，握手仍并发，晚清理绑定原 WS 实例。业务 ticket、技术 bridge 映射及 vendor registry 各有明确 owner，不混为全局会话表。

## 7. 生命周期与失败

签发等待15秒、整个初始化等待30秒、技术握手20秒；超时只结束等待，原 Access/Targets/派发任务继续追踪。已撤销/过期身份、配置版本变化或旧实例失效不能交付资源。活跃授权每15秒复查，轮询不重叠，其真实任务参与关闭/晚退役。

第三方 newConnection Promise 只表示派发完成；ready 通过 Server.open 确认。Server.close 只表明关闭已请求，Adapter 继续观察原 guacd TCP close。技术关闭、WS 关闭、原 opening 和轮询均收敛后归还名额；未知清理留槽，不自动重放或声称远端应用回滚。

vendor 会移除 WS close listener，也可能构造时先 CLOSED 再创建 guacd；原 Adapter 追踪晚客户端并再次清理其原 GuacdClient。Platform HTTP 通过完整 raw task/activeSockets 跟踪，不能因 task 拒绝就假定 WS 已关。Model/Service 关闭在 register 并发开始，共享 Promise 保留实际结果；独立操作拒绝与具名清理失败分别汇总。

Adapter 显式保留 RDP/VNC 默认 audio/image、96 dpi，以及 RDP security any、ignore-cert、display-update、RemoteApp 参数。技术日志不打印秘密；vendor 原生输出的真实范围由 B10 核验。

## 8. 当前能力与验收

B3.3 HTTP/WS、可信 Targets、Shared、ticket/生命周期、Guacamole、初始表结构及架构矫正已有源码，本轮最终静态全部通过。真实 RDP/VNC/guacd、屏幕输入输出、取消/并发/故障均未测试，全部 B3.3-V01–V12 留 B10。

完整 IP/2FA/认证与主动撤销策略归 B4；持久 Settings 治理归 B7；正式前端 Shared、密码保存、错误反馈、代理拒绝和最近连接可见性归 F-R12。上述独立依赖不能通过本批接线声明完成。测试与交接见 [实施方案](../后端重构下一阶段实施方案.md)。
