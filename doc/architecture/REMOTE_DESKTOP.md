# 远程桌面架构

按 [模块模板](MODULE_TEMPLATE.md) 维护当前 Backend 的 RDP/VNC 设计。正式前端已对接 Shared；远程回归通过的版本和环境范围见 [E2E](../testing/E2E.md#当前验收基线)。本文不声明生产部署已切换；旧实现仅作历史功能依据。

## 1. 职责与范围

Remote desktop 持有桌面 ticket、入场、容量、授权复查及会话生命周期；Targets 持有配置、密文和版本；Access 提供可信身份。浏览器只取得不透明 ticket，经统一 Backend WS、Guacamole Adapter、guacd 访问 RDP/VNC。普通 SSH、Agent 和桌面分别持有资源与权限，共用通用技术能力，不共享活跃会话。

当前只支持 direct route。旧 Guacamole 入口没有真正的桌面 Proxy/Jump 转发；新目标声明其他 route 时明确拒绝，不能静默直连。真实代理能力需另行设计。产品入口和限制见 [USAGE](../USAGE.md#远程桌面)。

## 2. 子功能与目录

前端桌面设计：`features/remote-desktop/model/remote-desktop-types.ts` 拥有独立应用连接、显示、会话、状态与安全失败；mapper 将协议秒转换为应用毫秒。api 严格解码 Shared 完整响应和 HTTP 状态，controller 持有签发请求、取消、generation 与原 peer；`adapters/guacamole-desktop.ts` 独占第三方实例、键鼠、触控和剪贴板。Modal 只持窗口、全屏和软键盘 UI，经窄能力调用，不读取 Guacamole 对象。

| 位置                                                            | 职责                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| remote/desktop/service/desktop-service.ts                       | ticket、准入、期限、身份/配置复查、轮询与关闭；只消费应用 DesktopPeer。                |
| remote/desktop/model/desktop-types.ts                           | DesktopConnection、Display、Ticket/Result、实例绑定 DesktopPeer。                      |
| remote/desktop/model/desktop-model.ts                           | 捕获 WS/HTTP 技术句柄，转换参数、票据生成/摘要和失败，返回窄应用能力；关闭技术 owner。 |
| remote/interfaces/http/desktop-http.ts、ws/desktop-ws.ts        | Shared 解码、逐字段响应、安全错误、raw WS 交付。                                       |
| targets/connections/{service,model,storage,adapters/sqlite}     | 桌面配置/密文原子读取、应用转换、技术解密、近期尝试事务；出口投影归 public-mappers。   |
| platform/desktop/desktop-port.ts、adapters/guacamole-desktop.ts | 技术请求/失败、guacamole-lite/guacd 原生参数、派发和关闭观察。                         |
| platform/desktop/adapters/guacamole-lite.d.ts                   | 实际第三方 API 的局部声明，不散落通用 src/types。                                      |
| shared/remote/desktop/{values,http,http-codec}                  | 双端基础值、显示/path/ticket 请求、成功/安全错误响应及纯解码。                         |

旧依据为 modules/remote-desktop/remote-desktop-session.service、infrastructure/guacamole/guacamole-runtime.adapter、connections HTTP routes、旧 WS 和正式 remoteDesktopApi/Guacamole 客户端；不沿用其内部层级作为新设计。

## 3. 依赖方向

HTTP/WS → DesktopService → DesktopPeer（DesktopModel 创建）→ DesktopTransport → GuacamoleDesktopAdapter。Service 不导入 ws、IncomingMessage 或技术 Port；票据生成与Cookie摘要由Model消费SessionTokens，register安装通用SecureSessionTokens；Model 不反向依赖 Service。跨模块错误仅经Targets public-errors消费。

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

技术内部 AES token 只含随机 bridge ID；目标地址、密码和 RemoteApp 参数保存在 Adapter 私有映射。正式前端经 Shared 成功/失败 codec 校验完整对象与 HTTP 状态，完整响应预算 1 KiB；wire 的 Unix 秒仅在 remote-desktop-mapper 转应用毫秒。公开入口只提供 launcher、Modal 和实际连接契约，不导出裸 API 或 tunnel Port。

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

Guacamole vendor 在 await 后读取可变编号；Adapter 只串行客户端构造/派发，握手仍并发，晚清理绑定原 WS 实例。共享 Server 的 open/close 各保留一个监听，按原 WebSocket 实例索引分发；ready 回调单次消费，索引在原终止事件收口，不按连接数叠加全局监听。业务 ticket、技术 bridge 映射及 vendor registry 各有明确 owner，不混为全局会话表。

## 7. 生命周期与失败

前端每次显式重连签发新票据，不自动重放未知派发。取消、停用、卸载和会话变化撤销原请求及 peer；晚响应不打开 WS、不发布最近尝试。`attempted` 事件只携带应用毫秒，不代表远端画面已连接。第三方错误正文不显示或记录；浏览器剪贴板采用 1 MiB 私有缓冲上限，超限拒绝本次同步，不截断。Guacamole 1.5.0 的实例释放由 pnpm 精确版本补丁提供 Display.retire 与 Touchpad/Touchscreen.cancelGesture：解除原 display 的全局 blur、待绘制帧和触控定时器，保留原 dispose(layer) 协议语义。键鼠及软键盘原生监听通过实例局部目标代理登记/解除，不替换共享 Window 方法。切换触控模式先取消原手势并移除原监听，再建立新模式。VNC 批量文本单次最多 64 KiB（本地输入策略），超限拒绝派发。

本地 disconnect 只请求关闭，不证明后端 TCP 已释放或远端程序已停止；真实释放由 Backend owner 确认。

HTTP签发结果在本地响应finish前保留close撤销监听；send返回或writableEnded不等于实际写完，写出前断连撤销尚未消费票据，finish后释放监听，不宣称浏览器确认收到。清理失败使用有界FailureSummary并按同一Error身份去重，超出采样仍保留失败数量。

签发等待15秒、整个初始化等待30秒、技术握手20秒；超时只结束等待，原 Access/Targets/派发任务继续追踪。已撤销/过期身份、配置版本变化或旧实例失效不能交付资源。活跃授权每15秒复查，轮询不重叠，其真实任务参与关闭/晚退役。

第三方 newConnection Promise 只表示派发完成；ready 通过 Server.open 确认。Server.close 只表明关闭已请求，Adapter 继续观察原 guacd TCP close。技术关闭、WS 关闭、原 opening 和轮询均收敛后归还名额；未知清理留槽，不自动重放或声称远端应用回滚。

vendor 会移除 WS close listener，也可能构造时先 CLOSED 再创建 guacd；原 Adapter 追踪晚客户端并再次清理其原 GuacdClient。Platform HTTP 通过完整 raw task/activeSockets 跟踪，不能因 task 拒绝就假定 WS 已关。Model/Service 关闭在 register 并发开始，共享 Promise 保留实际结果；独立操作拒绝与具名清理失败分别汇总。

Adapter 显式保留 RDP/VNC 默认 audio/image、96 dpi，以及 RDP security any、ignore-cert、display-update、RemoteApp 参数。技术日志不打印秘密；vendor 原生输出的真实范围由 B10 核验。

## 8. 当前能力与验收

正式App桌面整页已在隔离Xvnc/xrdp/guacd验证两协议的真实非空画面、宽高保存、最小化/恢复、浏览器全屏、软键盘输入、新票据重连及真实TCP释放。尺寸保存期间禁用尺寸输入与拖动，避免旧偏好响应覆盖下一次编辑；失败经Preferences有限类别反馈，不自动重试。扩大触控、剪贴板权限及物理输入法的证据分别按testing记录，不由普通键入推断。

B3.3 源码已接线。B10 已用隔离 TigerVNC、TLS xrdp 与 guacd 1.6.0，经实际新 Backend HTTP/WS 验证两协议的图像字节/Chromium 解码、远端键盘/鼠标、票据重放/版本/到期/满额、16 路活跃与第17路拒绝、身份轮询、服务故障及受控重启。guacd ready 只确认桥接，不证明远端认证或画面就绪；验收另核对实际图像、xterm 输入与原 TCP 释放。原生 Windows Server 2022 的普通 RDP 画面、键盘/鼠标、动态分辨率和新票据重连也已有独立实机证据。完整 B3.3-V01–V12 仍按 testing 逐项承接未覆盖范围：RemoteApp 未配置，慢建连/迟到失败、全部清理故障与扩大正式前端触控/缩放/全屏故障组合未验，不把有限子集标为整个桌面通过。

完整 IP/2FA/认证与主动撤销策略归 B4；持久 Settings 治理归 B7；正式前端 Shared、密码保存、有限错误反馈、直连限制和最近尝试毫秒已接线；桌面专项和待验范围以 testing 为准。上述独立依赖不能通过本批接线声明完成。测试与交接见 [实施方案](../PLAN.md)。
