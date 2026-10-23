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

WS 单二进制帧最多 2 MiB，私有待写队列最多 4 MiB。TCP 写阻塞暂停 WS；远端到浏览器方向按 WS 实际 bufferedAmount 控制背压，达到 64 KiB 高水位暂停 TCP，send 完成回调确认降至 16 KiB 低水位后恢复，避免逐块暂停；水位属于技术调度参数，不替代原 4 MiB 发送缓冲拒绝与关闭保护。并行排队的 send 保持 WS 原字节顺序并逐个追踪，超量或异常关闭原桥，不丢弃或重放 RDP 协议数据。TCP/TLS socket、初始化、队列消费、全部 WS send 回调及 WS 真正关闭全部收敛后才通知退役，不以 terminate 调用代替释放。该透明桥调度同时适用于 VNC。

## 7. 生命周期与失败

签发等待 15 秒、Backend 初始化等待 30 秒、桥握手 20 秒。超时只结束等待，原任务仍归原 owner；技术 close 10 秒不能确认时返回 cleanup_failed。Service 在原技术终止、WS 关闭、opening 和授权轮询收敛后归还名额。活跃身份/目标约每 15 秒复查，失败关闭原实例。

票据响应直到 HTTP 实际 finish 前保留断开撤销监听。网络失败不自动重放，显式重连签发新票据；取消和旧 generation 晚返回不能建立新展示或覆盖当前状态。前端 SDK 懒加载期间保留最新尺寸、触控和文本输入模式，关闭后晚加载不能接线。

IronRDP SDK 没有取消 pending connect 的 API；前端保留其晚结果 owner，晚连接成功后 shutdown 并运行收尾，run 结束及剪贴板任务收敛后释放 WASM session。30 秒 UI 等待不声称 SDK 实际结束；vendor 日志关闭，不输出凭据。noVNC disconnect 与本地监听释放不证明远端程序终止。

键鼠、原生触控、剪贴板监听与 timer 绑定原实例；切模式取消原手势，失焦/关闭释放 RDP 按键。剪贴板纯文本最多 1 MiB；浏览器权限拒绝不阻断桌面。批量文本输入最多 64 KiB UTF-8，超量整次拒绝，不发送部分文本。RDP 动态尺寸通过 display-control；DPI 换算为 SDK 的 100–500% 缩放提示，初始协商仍受 SDK/远端能力限制。音视频、文件通道等 SDK 能力未作为本版产品承诺。

RDP Adapter 的输入事务按完整字符计数，每批最多 32 字符（按下/释放成对），不加等待计时；普通键立即派发。仅连续 mousemove 合并为约 16ms 内最新坐标，所有按键、按钮与滚轮事务先携带尚未提交的坐标，避免点击/键盘越过之前的指针移动；blur、切文本输入与 close 在 releaseAllInputs 前刷新并清理指针 timer，动态 resize 前也先提交旧坐标。输入事务不重试，某批失败停止后续文本，不把未知结果当作未发送而重放；保留原 IME 去重、修饰键集合与 64 KiB 预检。类型与状态留当前 Adapter，不新增 Shared 字段或全局队列；WASM 解码/绘制仍在原 SDK，本轮不承诺消除 RTT 或主线程解码成本。

### 重绘与接收调度

1. **职责与范围**：减少重复的远端分辨率重建，保持 RDP 协议消息边界；不改窗口、画面质量、输入及协议内容，不承诺消除网络造成的渐进更新。
2. **子功能与目录**：rdp-desktop 持有最新显示请求、上次有效尺寸和短期 timer；BrowserDesktopPeer 持有未完成的 RDP 消息残片。固定 SDK 0.7.0 的 softbuffer 负责像素生成，rdp-frame-presenter 在当前实例 Canvas 的 2D context 上合并已解码像素；不修改全局 prototype。
3. **依赖方向**：前端仍经窄 Peer 能力请求尺寸，SDK 类型只在 Adapter；后端只识别 TPKT、Fast-Path 与 CredSSP DER 的长度，不解码图形、凭据、丢弃或重放 PDU。VNC 保持原逐块转发。
4. **类型与转换**：复用 RemoteDesktopDisplay，DPI 映射为原 100–500% 有效整数缩放；SDK DesktopSize 读取后释放。Buffer 仅在 Platform，不扩散到 Shared。
5. **入口与安装**：原 resize、connect、forward 和 stop 路径安装调度，无新配置、路由或依赖；无需升级或重编译 WASM。
6. **数据、事务与并发**：尺寸变化静默 150ms 后提交最新值，相同宽高及有效缩放跳过；建连以 SDK 协商尺寸和 100% 初始缩放建立基准，非默认 DPI 仍请求更新。TLS 流按完整协议消息逐条发送 WebSocket，不按任意字节数或 I/O 轮次合并；避免 SDK 握手结束时丢弃同一 WS 消息中的后续预读数据。完整消息立即发送，不设凑批 timer；保留原发送水位和有界缓冲，DER 消息受原 2 MiB 单帧预算约束。
7. **生命周期与失败**：关闭取消尺寸 timer 并清空未完成残片；晚建连不重新调度。resize 失败不记录为已提交，本地提交记录不代表远端已确认应用；非法长度、发送错误关闭原桥，并等待所有已派发发送回调与 socket 真实收敛。活跃传输保持完整字节顺序，不重放失败消息。像素 presenter 单实例保留最多 32 MiB 底图，只复制 dirty region，临近且合并面积至多原面积 1.3 倍时合并；最多 32 个区域，超量合成一个外包矩形，不积压中间帧。animation frame 一次提交最新像素，不改 SDK 读取/输入节奏；后台无 animation frame 时继续更新同一有界底图。尺寸赋值即使数值相同也清空 Canvas，因此在当前 canvas 实例拦截 width/height setter 清理旧底图与回调。超预算/分配 RangeError 回退直接绘制，非支持的像素输入先提交待绘内容再回退原生校验；异步提交异常走原连接失败出口。关闭取消回调、释放底图并恢复原实例方法/属性，不保留全局监听或计时器。
8. **当前能力与验收**：两轮源码及静态/构建证据归 testing；真实拖动/全屏/恢复、DPI、弱网大画面、混合 PDU 与关闭失败留远程回归。不更改主线程解码或宣称获得视频编码/Worker 解码能力。

## 8. 当前能力与验收

源码已替换双端传输并移除 guacd/RemoteApp，既有集成与 E2E 已迁移为真实 TigerVNC/xrdp、浏览器 SDK 和 X selection/xterm/鼠标证据，不用虚假 Guacamole 指令证明画面或输入。

当前已完成静态检查与构建；PLAN D17 的一般本地测试限制保持，D19 授权的指定 HTTPS 站点真实 RDP 基础链路、常用键盘、composition 去重、双向纯文本剪贴板及拒绝授权、窗口/全屏切换，以及 Chromium 移动仿真输入和触控已验证。后续已补证分钟级持续输入、票据重放/过期拒绝不影响原连接、受控 WS 关闭/新票据重连、两次建连中取消及刷新后实际 TCP 释放；页面销毁后的 WS 事件观察缺口由独立 TCP 证据补充，不记录原脚本整体 PASS。该证据不覆盖 VNC、其它系统组合键、原生输入法/手机真机、小时级或空闲稳定性、16 路并发、强制晚成功/复杂故障及多平台。旧 Guacamole 的 B10/Windows PASS 只属于旧实现，不能作为新桥的验收。具体命令/结果归 [testing](../testing/E2E.md)，操作见 [USAGE](../USAGE.md#远程桌面)，实施状态见 [PLAN](../PLAN.md)。
