# 远程桌面（RDP/VNC）

## 1. 职责与范围

浏览器使用 noVNC 解码 VNC、IronRDP WASM SDK 解码 RDP，Backend 仅负责认证、一次性票据、受信目标及 WS/TCP/TLS 二进制桥，不运行 guacd 或服务器端图形解码进程。支持普通完整桌面，不支持 RemoteApp；对应表单、Shared 字段和初始数据库列已破坏性删除，不保留兼容转换。

保持原桌面窗口、尺寸偏好、最小化/恢复、全屏、软键盘、触控模式与纯文本剪贴板交互。浏览器通过 HTTPS 签发响应取得连接地址、用户名及明文密码，只交给原连接实例，不进入 URL、日志或本地存储。此为用户接受的新安全边界，不再使用旧版“浏览器只取得 ticket”的保证。

## 2. 子功能与目录

| Owner                                                        | 职责                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| remote/desktop/service/desktop-service.ts                    | 票据、准入、期限、Access/Targets 复查、最近连接记录及实例关闭。 |
| remote/desktop/model                                         | 独立应用事实、秘密白名单转换、技术失败转换及绑定 peer。         |
| remote/interfaces/http/desktop-http.ts、ws/desktop-ws.ts     | Shared 解码、六字段响应、安全失败和 raw WS 接入。               |
| targets/connections                                          | 同事务读取配置/密码密文、解密、direct 准入和版本化凭据。        |
| platform/desktop/desktop-port.ts                             | 绑定 WS 的技术能力、窄目标请求及失败类别。                      |
| platform/desktop/adapters/browser-desktop.ts、rdcleanpath.ts | TCP/TLS、RDCleanPath 严格 DER、流控及真实关闭。                 |
| frontend/features/remote-desktop/adapters                    | 按协议懒加载 SDK、键鼠/输入法、触控、剪贴板及监听清理。         |
| shared/remote/desktop                                        | 协议取值、票据/显示范围、完整 HTTP 成功/失败及容量。            |

## 3. 依赖方向

HTTP/WS → DesktopService → DesktopPeer（DesktopModel 创建）→ DesktopTransport → BrowserDesktopAdapter。Service 不消费 ws、IncomingMessage、TLS 或厂商对象。Model 转换技术能力和具名失败，Platform 不引入 Remote/Targets/Access 对象。

Remote 经 Targets public 的 desktopTargets 取得可信快照。Targets Model 解密，public-mappers 逐字段投影，不把密文透传至 Service。HTTP 再逐字段投影用户已授权交付给浏览器的凭据。

前端 Modal 装配 API、controller 和 browser-desktop factory；controller 只处理独立应用对象。RDP/VNC 的厂商表示分别留各自 Adapter，不引入其它 feature 的私有实现。WS 共用现有 HTTP upgrade owner，没有新增端口或网关进程。

## 4. 类型与转换

| 边界                                   | 唯一类型 owner                                                                      | 转换 owner                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| HTTP path/query/ticket、成功及安全失败 | Shared remote/desktop/{values,http,http-codec}                                      | Interface、前端 API 严格解码及请求协议关联。                         |
| 存储 → Targets 应用                    | connections/storage、model/desktop-target-types                                     | SQLite Adapter 解码，DesktopTargetModel 转换。                       |
| Targets → Remote 应用                  | TrustedDesktopTarget、DesktopConnection                                             | public-mappers、toDesktopConnection。                                |
| 应用 → 二进制桥                        | DesktopTransportRequest                                                             | DesktopModel 仅交付 protocol/host/port/ignoreCertificate，不交密码。 |
| HTTP → 前端会话 → SDK                  | Shared RemoteDesktopSessionResponse、前端 RemoteDesktopSession                      | HTTP projection、前端 mapper、厂商 Adapter 逐字段配置。              |
| 技术失败 → 应用 → 协议                 | DesktopTransportFailure、DesktopFailure/RemoteResourceCleanupFailure、Shared 错误码 | Adapter、Model、Interface 分别归一与安全投影。                       |

签发成功严格为 `{ticket,protocol,host,port,username,password}`，完整 JSON 预算 64 KiB；host/username/password 分别复用 Targets 的 512/256/8192 UTF-8 bytes 限额，秘密不 trim。响应设置 `Cache-Control: no-store` 和 `Pragma: no-cache`。WS URL 只含随机 ticket，不含凭据；页面卸载/断开释放原实例引用，不承诺 JS/WASM 内存被物理清零。

## 5. 入口与安装

```text
POST /api/v1/connections/:id/rdp-session
POST /api/v1/connections/:id/vnc-session
WS   /ws/remote-desktop?ticket=...
```

POST 无 body，query 可选 width/height/dpi。统一 HTTP 核对 Origin/Host/可信代理，WS 使用原有效 Cookie 升级；ticket 绑定 Cookie 摘要、用户、目标版本、协议与显示配置，30 秒有效，同步一次消费。

registerRemote 装配 BrowserDesktopAdapter；Bootstrap、环境样例和 Compose 不再含 GUACD 配置或服务。部署仅需现有 Backend/Frontend，Backend 必须能访问目标 RDP/VNC 端口。客户端不直接访问目标 TCP。

## 6. 数据、事务与并发

Targets 在同一只读事务取得连接版本与密码密文；RDP/VNC 只接受密码凭据和 direct route，拒绝 Proxy/Jump，不静默绕过声明路线。初始结构不再有三个 RemoteApp 列；旧开发数据库/备份不兼容，应使用新空数据目录。

票据不存明文密码；签发中/待用共用 1,024 项，建连/活跃/未确认清理共用 16 槽。连接时重新获取目标并复查配置及身份。VNC TCP 就绪、RDP TLS/CleanPath 桥就绪后记录服务端最近连接时间；该时点不证明远端认证或画面成功。记录复用 Targets connectionUsage 的版本/创建时间/协议条件和单调更新，不修改配置版本。

bind 在异步授权前登记 WS 监听，避免 SDK 第一帧丢失；授权完成前只做有界缓冲，不连接 TCP。RDP CleanPath 中客户端 destination 仅解码而不参与目标选择，连接始终使用票据对应的受信 Targets 地址。DER 限 128 KiB，X224 有界解析；只接受 SSL/HYBRID/HYBRID_EX，TLS 最低 1.2。当前延续原 ignore-certificate 行为，不验证目标证书链；部署需自行保障目标网络可信，不宣传为远端身份已验证。

WS 单二进制帧最多 2 MiB，私有待写队列最多 4 MiB。TCP 写阻塞暂停 WS，WS send 回调完成前暂停 TCP；超量或异常关闭原桥，不截断协议数据。TCP/TLS socket、初始化、队列消费、WS send 回调及 WS 真正关闭全部收敛后才通知退役，不以 terminate 调用代替释放。

## 7. 生命周期与失败

签发等待 15 秒、Backend 初始化等待 30 秒、桥握手 20 秒。超时只结束等待，原任务仍归原 owner；技术 close 10 秒不能确认时返回 cleanup_failed。Service 在原技术终止、WS 关闭、opening 和授权轮询收敛后归还名额。活跃身份/目标约每 15 秒复查，失败关闭原实例。

票据响应直到 HTTP 实际 finish 前保留断开撤销监听。网络失败不自动重放，显式重连签发新票据；取消和旧 generation 晚返回不能建立新展示或覆盖当前状态。前端 SDK 懒加载期间保留最新尺寸、触控和文本输入模式，关闭后晚加载不能接线。

IronRDP SDK 没有取消 pending connect 的 API；前端保留其晚结果 owner，晚连接成功后 shutdown 并运行收尾，run 结束及剪贴板任务收敛后释放 WASM session。30 秒 UI 等待不声称 SDK 实际结束；vendor 日志关闭，不输出凭据。noVNC disconnect 与本地监听释放不证明远端程序终止。

键鼠、原生触控、剪贴板监听与 timer 绑定原实例；切模式取消原手势，失焦/关闭释放 RDP 按键。剪贴板纯文本最多 1 MiB；浏览器权限拒绝不阻断桌面。批量文本输入最多 64 KiB UTF-8，超量整次拒绝，不发送部分文本。RDP 动态尺寸通过 display-control；DPI 换算为 SDK 的 100–500% 缩放提示，初始协商仍受 SDK/远端能力限制。音视频、文件通道等 SDK 能力未作为本版产品承诺。

## 8. 当前能力与验收

源码已替换双端传输并移除 guacd/RemoteApp，既有集成与 E2E 已迁移为真实 TigerVNC/xrdp、浏览器 SDK 和 X selection/xterm/鼠标证据，不用虚假 Guacamole 指令证明画面或输入。

当前已完成静态检查与构建；PLAN D17 的一般本地测试限制保持，D19 授权的指定 HTTPS 站点真实 RDP 基础链路、常用键盘、composition 去重、双向纯文本剪贴板及拒绝授权、窗口/全屏切换，以及 Chromium 移动仿真输入和触控已验证。后续已补证分钟级持续输入、票据重放/过期拒绝不影响原连接、受控 WS 关闭/新票据重连、两次建连中取消及刷新后实际 TCP 释放；页面销毁后的 WS 事件观察缺口由独立 TCP 证据补充，不记录原脚本整体 PASS。该证据不覆盖 VNC、其它系统组合键、原生输入法/手机真机、小时级或空闲稳定性、16 路并发、强制晚成功/复杂故障及多平台。旧 Guacamole 的 B10/Windows PASS 只属于旧实现，不能作为新桥的验收。具体命令/结果归 [testing](../testing/E2E.md)，操作见 [USAGE](../USAGE.md#远程桌面)，实施状态见 [PLAN](../PLAN.md)。
