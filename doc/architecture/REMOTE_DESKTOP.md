# 远程桌面（RDP/VNC）

## 1. 职责与范围

浏览器使用 noVNC 解码 VNC、IronRDP WASM SDK 解码 RDP，Backend 仅负责认证、一次性票据、受信目标、RDP 证书信任及 WS/TCP/TLS 二进制桥，不运行 guacd 或服务器端图形解码进程。支持普通完整桌面，不支持 RemoteApp；对应表单、Shared 字段和初始数据库列已破坏性删除，不保留兼容转换。

保持原桌面窗口、尺寸偏好、最小化/恢复、全屏、软键盘、触控模式与纯文本剪贴板交互。浏览器通过 HTTPS 签发响应取得连接地址、用户名及明文密码，只交给原连接实例，不进入 URL、日志或本地存储。此为用户接受的新安全边界，不再使用旧版“浏览器只取得 ticket”的保证。

## 2. 子功能与目录

| Owner                                                                    | 职责                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| remote/desktop/service/desktop-service.ts                                | 票据、准入、期限、Access/Targets 复查、最近连接记录及实例关闭。      |
| remote/desktop/model                                                     | 独立应用事实、秘密白名单转换、技术失败转换及绑定 peer。              |
| remote/interfaces/http/desktop-http.ts、ws/desktop-ws.ts                 | Shared 解码、六字段响应、证书确认请求/挑战、安全失败和 raw WS 接入。 |
| remote/desktop/storage、adapters/sqlite                                  | 按用户及 endpoint 读取/确认证书，持有 DDL、严格行解码和事务 CAS。    |
| targets/connections                                                      | 同事务读取配置/密码密文、解密、direct 准入和版本化凭据。             |
| platform/desktop/desktop-port.ts                                         | 绑定 WS 的技术能力、窄目标请求及失败类别。                           |
| platform/desktop/adapters/browser-desktop.ts、rdcleanpath.ts、rdp-tls.ts | TCP/TLS、RDCleanPath 严格 DER、流控及真实关闭。                      |
| frontend/features/remote-desktop/adapters                                | 按协议懒加载 SDK、键鼠/输入法、触控、剪贴板及监听清理。              |
| shared/remote/desktop                                                    | 协议取值、票据/显示范围、完整 HTTP 成功/失败及容量。                 |

## 3. 依赖方向

HTTP/WS → DesktopService → DesktopPeer（DesktopModel 创建）→ DesktopTransport → BrowserDesktopAdapter。Service 不消费 ws、IncomingMessage、TLS 或厂商对象。Model 转换技术证书/信任存储、能力和具名失败，Platform 不引入 Remote/Targets/Access 对象。

Remote 经 Targets public 的 desktopTargets 取得可信快照。Targets Model 解密，public-mappers 逐字段投影，不把密文透传至 Service。HTTP 再逐字段投影用户已授权交付给浏览器的凭据。

前端 Modal 装配 API、controller、RdpCertificateDialog 和 browser-desktop factory；controller 只处理独立应用对象及带取消信号的确认回调。弹窗复用 UiConfirmationPanel，默认传送到 body，全屏时留在桌面节点内；新增 teleport 能力默认保持所有既有确认弹窗行为。RDP/VNC 的厂商表示分别留各自 Adapter，不引入其它 feature 的私有实现。WS 共用现有 HTTP upgrade owner，没有新增端口或网关进程。

## 4. 类型与转换

| 边界                                   | 唯一类型 owner                                                                      | 转换 owner                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| HTTP path/query/ticket、成功及安全失败 | Shared remote/desktop/{values,http,http-codec}                                      | Interface、前端 API 严格解码及请求协议/connectionId 关联。                |
| 存储 → Targets 应用                    | connections/storage、model/desktop-target-types                                     | SQLite Adapter 解码，DesktopTargetModel 转换。                            |
| Targets → Remote 应用                  | TrustedDesktopTarget、DesktopConnection                                             | public-mappers、toDesktopConnection。                                     |
| 应用 → 二进制桥                        | DesktopTransportRequest                                                             | DesktopModel 仅交付 protocol/host/port/certificateFingerprint，不交密码。 |
| HTTP → 前端会话 → SDK                  | Shared RemoteDesktopSessionResponse、前端 RemoteDesktopSession                      | HTTP projection、前端 mapper、厂商 Adapter 逐字段配置。                   |
| 技术失败 → 应用 → 协议                 | DesktopTransportFailure、DesktopFailure/RemoteResourceCleanupFailure、Shared 错误码 | Adapter、Model、Interface 分别归一与安全投影。                            |

证书探测的 DesktopTransportCertificate 在 Model 逐字段转成 DesktopCertificate；信任记录独立归 storage，Model 仅读取其指纹或转换 DesktopCertificateApproval 为 ConfirmCertificateTrust。HTTP 将应用 targetId 投影为挑战的 connectionId，前端 API 与本次路径关联；有效期和 confirmedAt 均为 Unix 毫秒，指纹固定为 32 个大写十六进制字节、冒号分隔。

签发成功严格为 `{ticket,protocol,host,port,username,password}`，完整 JSON 预算 64 KiB；host/username/password 分别复用 Targets 的 512/256/8192 UTF-8 bytes 限额，秘密不 trim。响应设置 `Cache-Control: no-store` 和 `Pragma: no-cache`。WS URL 只含随机 ticket，不含凭据；页面卸载/断开释放原实例引用，不承诺 JS/WASM 内存被物理清零。

## 5. 入口与安装

```text
POST /api/v1/connections/:id/rdp-session
POST /api/v1/connections/:id/vnc-session
WS   /ws/remote-desktop?ticket=...
```

初次 POST 可无 body 或传 `{certificate:null}`；确认 RDP 证书时使用 `{certificate:{host,port,fingerprint,previousFingerprint,remember}}`，VNC 拒绝非 null 证书确认。JSON 请求/挑战沿原 64 KiB 完整预算，严格 unknown 解码；query 可选 width/height/dpi。统一 HTTP 核对 Origin/Host/可信代理，WS 使用原有效 Cookie 升级；ticket 绑定 Cookie 摘要、用户、目标版本、协议、已验证/确认的证书指纹与显示配置，30 秒有效，同步一次消费。

registerRemote 装配 BrowserDesktopAdapter；Bootstrap、环境样例和 Compose 不再含 GUACD 配置或服务。部署仅需现有 Backend/Frontend，Backend 必须能访问目标 RDP/VNC 端口。客户端不直接访问目标 TCP。

## 6. 数据、事务与并发

Targets 在同一只读事务取得连接版本与密码密文；RDP/VNC 只接受密码凭据和 direct route，拒绝 Proxy/Jump，不静默绕过声明路线。当前结构不含三个 RemoteApp 列，应用与协议均不保留旧字段兼容分支。

票据不存明文密码；签发中/待用共用 1,024 项，建连/活跃/未确认清理共用 16 槽。连接时重新获取目标并复查配置及身份。VNC TCP 就绪、RDP TLS/CleanPath 桥就绪后记录服务端最近连接时间；该时点不证明远端认证或画面成功。记录复用 Targets connectionUsage 的版本/创建时间/协议条件和单调更新，不修改配置版本。

bind 在异步授权前登记 WS 监听，避免 SDK 第一帧丢失；授权完成前只做有界缓冲，不连接 TCP。RDP CleanPath 中客户端 destination 仅解码而不参与目标选择，连接始终使用票据对应的受信 Targets 地址。DER 限 128 KiB，X224 有界解析；只接受 SSL/HYBRID/HYBRID_EX，TLS 最低 1.2。选中HYBRID_EX时，实例在DER CredSSP交换后独立转发四字节Early User Authorization Result；跨TLS分包等待完整四字节，交SDK验证结果，消费一次后恢复常规RDP分帧。RDP 签发前仅发送无用户名的标准 19-byte X224/TLS 探测；Node 信任链、checkServerIdentity 和证书有效期提供默认验证事实。Service 对未记住的不可信证书返回具名挑战，对已记住的不同指纹始终要求再次确认，即使新证书 CA 有效。用户可明确接受该具体指纹的例外；不称手动接受为 CA 验证。实际桥只在叶证书 SHA-256 与票据完全一致时交付 CleanPath 响应，避免探测和建连之间的替换；不向 Platform 交付 RDP 密码。

WS 单二进制帧最多 2 MiB，私有待写队列最多 4 MiB。TCP 写阻塞暂停 WS；远端到浏览器方向按 WS 实际 bufferedAmount 控制背压，达到 64 KiB 高水位暂停 TCP，send 完成回调确认降至 16 KiB 低水位后恢复，避免逐块暂停；水位属于技术调度参数，不替代原 4 MiB 发送缓冲拒绝与关闭保护。并行排队的 send 保持 WS 原字节顺序并逐个追踪，超量或异常关闭原桥，不丢弃或重放 RDP 协议数据。TCP/TLS socket、初始化、队列消费、全部 WS send 回调及 WS 真正关闭全部收敛后才通知退役，不以 terminate 调用代替释放。该透明桥调度同时适用于 VNC。

信任持久化于 `remote_desktop_certificates(user_id,host,port,fingerprint,confirmed_at)`，主键为用户/小写主机/端口；独立于连接 ID，多个相同 endpoint 的连接共用该用户的选择。首次记住要求 previousFingerprint=null，替换使用原指纹 CAS；事务开始与提交前均经已安装的 Access 当前身份读取及 Model 回调复核准入。SQL/DDL 仅在 Desktop SQLite Adapter，Model 显式转换独立存储命令；冲突不覆盖，提交/回滚未知投影 operation_unknown，不自动重放。Remote snapshots 注册同表、固定列和用户分区，校验严格复用行解码；当前 v1 结构签名已同步；下一版本起的结构与数据变化按 H-21 逐条新增迁移交付，业务不保留旧值兼容。

## 7. 生命周期与失败

签发等待 15 秒（含证书探测与当前信任读取）、Backend 初始化等待 30 秒、桥握手 20 秒。探测与活跃桥共用原 16 个 TCP 槽；HTTP 待签发仍计入原 1,024 项。超时/HTTP 取消/quiesce 中止原探测，Platform 销毁 TCP/TLS 并等待真实 close 后才释放探测槽；Adapter 同时追踪探测与桥，关闭按原 10 秒技术期限等待，未收敛任务不视为已释放。超时只结束等待，原任务仍归原 owner；技术 close 10 秒不能确认时返回 cleanup_failed。Service 在原技术终止、WS 关闭、opening 和授权轮询收敛后归还名额。活跃身份/目标约每 15 秒复查，失败关闭原实例。

证书挑战不签发票据或返回密码；前端确认前没有 SDK/WS。取消、关闭或登出使原确认 Promise 收敛，generation 复查阻止晚选择创建新 Peer；证书/信任变化返回新挑战，须再次明确确认，不自动接受或重放写入。信任写入开始后等待超时/失效返回 operation_unknown；原事务仍由 owner 追踪，晚成功不签发票据，不能把取消当作回滚。票据响应直到 HTTP 实际 finish 前保留断开撤销监听。网络失败不自动重放，显式重连签发新票据；取消和旧 generation 晚返回不能建立新展示或覆盖当前状态。前端 SDK 懒加载期间保留最新尺寸、触控和文本输入模式，关闭后晚加载不能接线。

IronRDP SDK 没有取消 pending connect 的 API；前端保留其晚结果 owner，晚连接成功后 shutdown 并运行收尾，run 结束及剪贴板任务收敛后释放 WASM session。30 秒 UI 等待不声称 SDK 实际结束；vendor 日志关闭，不输出凭据。noVNC disconnect 与本地监听释放不证明远端程序终止。

手机指南由原Modal复用全局UiInfoHint按点击展示，桌面保留原行内说明。desktop-touch可选回调提供与派发鼠标事件一致的client坐标；RDP Adapter仅在有触控能力时安装本地指针覆盖层，按容器比例定位以兼容缩放，覆盖层不截输入也不修改解码Canvas，不作为远端操作确认。触控板首次定位派发mousemove，独立初始化标志避免左上角坐标被重置；实体鼠标事件隐藏覆盖层，关闭随原实例移除，VNC沿用原厂商光标而不新增该覆盖层。

键鼠、原生触控、剪贴板监听与 timer 绑定原实例；切模式取消原手势，失焦/关闭释放 RDP 按键。剪贴板纯文本最多 1 MiB；浏览器权限拒绝不阻断桌面。批量文本输入最多 64 KiB UTF-8，超量整次拒绝，不发送部分文本。RDP 动态尺寸通过 display-control；DPI 换算为 SDK 的 100–500% 缩放提示，初始协商仍受 SDK/远端能力限制。音频与文件剪贴板见下节；视频加速/媒体重定向、磁盘映射等能力尚未接入。

### 本地输入法与文件剪贴板

1. **职责与范围**：rdp-keyboard-anchor将隐藏textarea定位到最近点击的Canvas位置，防止候选框使用flex布局中的静态位置；SDK没有远端文本光标坐标，不承诺Tab/方向键之后的精确追踪。RDP文件剪贴板接入现有SDK Provider，VNC仍仅文本；没有磁盘映射、视频加速、多显示器或RemoteApp扩展；音频单独接入如下。
2. **子功能与目录**：rdp-desktop装配键盘锚点、原文本同步和rdp-file-clipboard；后者唯一持有RdpFileTransferProvider、厂商文件信息/流ID和原始Promise。RdpFileClipboard组件使用原UiOverlayPanel提供选择文件与逐项下载，嵌在桌面窗口内以保留全屏可达性。
3. **依赖方向**：Modal/组件→原Peer窄文件能力；browser-desktop懒加载Adapter后转交能力，厂商扩展与存储后端选择留Adapter，不引入Backend路由或另一份传输协议。
4. **类型与转换**：RemoteDesktopClipboardFile/Progress、FileClipboardState与FileClipboard唯一归本功能model-types；SDKFileInfo先核对后逐字段转换。列表修订与索引组成原实例内ID，下载流ID独立关联进度，旧列表不能指向新同索引文件。File/Blob仅为前端浏览器能力，无Shared、存储或秘密契约变动。
5. **入口与安装**：SessionBuilder注册Provider全部文件/锁/应答扩展，connect成功后绑定原session；文件选择只发布剪贴板供用户在远端目录粘贴，浏览器提供文件的原生paste在接受列表后至多派发一次远端Ctrl+V。远端文件列表只显示，不自动下载，不承诺写入系统通用文件剪贴板。
6. **数据与并发**：上传不替换尚未完成的主动选择/粘贴批次，按文件进度累计；已完成批次的远端重复粘贴可由新明确选择替换，避免旧重粘贴阻塞后续上传。批次完成仍核对error事件，避免SDK对含失败文件的完成Promise误报成功。下载复查列表身份及实际报告的总量与Blob大小；剪贴板自动读取在上传期间不派发文本，文件有效期间不重复发布已知旧文本。沿SDK既有2 GiB下载门槛及64KiB分块，无新增产品配额；使用Blob后端避免持久临时文件。
7. **生命周期与失败**：键盘锚点保存Canvas内比例，按当前offsetParent/缩放/滚动重算，监听ResizeObserver、窗口/visualViewport和全屏，关闭完整退订并恢复共享mobile textarea样式。文件Provider随原peer关闭dispose，原上传/下载Promise收敛后释放WASM；已关闭session的晚到Provider调用释放Extension后停止派发，避免异步写回再次访问已释放session。组件订阅、晚结果、下载URL及回收timer随实例/销毁清理；关闭不撤销远端部分文件。
8. **当前能力与验收**：支持文件选择、浏览器提供的文件paste、等待/进度与远端文件逐项下载，目录本身不打包。当前源码/静态状态与未验范围见PLAN/testing，不能以历史文本剪贴板回归证明新文件通道或原生输入法候选窗口已通过实机验收。

### 音频输出

1. **职责与范围**：复用RDPSND及公开上游Web音频PR #2020，不另写音频协议/解码器。仅输出PCM16立体声，22.05/44.1/48kHz；不启用麦克风，不扩展视频通道。
2. **子功能与目录**：vendor/ironrdp保留固定上游补丁、编译包、许可证及来源；rdp-audio-output持有AudioContext、播放源、音量和手势监听，rdp-desktop装配builder并随原连接关闭。
3. **依赖方向**：RDP Adapter→audioPlayback扩展→RDPSND；库的Send后端仅经mpsc交付数据，JS回调留session loop，无unsafe Send。Backend继续透明传输，无新路由或服务端声音解码。
4. **类型与转换**：上游callback以unknown交付wave/volume/close；Adapter严格核对判别字段、PCM采样率/声道/帧对齐和音量范围，逐样本将交错小端PCM16转换为浏览器Float32声道。全部技术类型仅在当前Adapter，无Shared或存储变化。
5. **入口与安装**：AudioContext可用时注册audioPlayback；上游补丁启用playback并装配RDPSND，Windows需要时附加不含设备的RDPDR，打印通道存在时复用它。浏览器不具备AudioContext时保持桌面可用，不显示无效设置。
6. **数据与并发**：音频只存当前实例内存，采用AudioContext时钟连续排程；按用户授权实时优先，超过设备报告的延迟加相邻实际音频块时长时停止旧播放队列。没有固定毫秒数、额外文件、总量配额或上传录音；暂停期间丢弃块，不把远端声音无限积压。
7. **生命周期与失败**：自动resume可能保持pending，后续真实pointer/touch/key仍再次调用resume，不被旧Promise阻挡；拒绝仅等待手势。AudioContext暂停清空播放，正常RDPSND close保留已排程尾音；连接失败、run结束与窗口close都停止声音、释放context并移除监听。回调晚到由closed拒绝；单次播放失败关闭音频，安全日志一次，不让桌面失败。
8. **当前能力与验收**：源码及WASM/TypeScript/生产构建见testing；上游PR公开但未合并，不能称为官方发布能力。指定Windows非零PCM/播放排程、暂停丢弃/恢复和重连资源释放已验证；物理声音、自动播放受限、移动设备、网络抖动与尾音仍待专项验收。上游正式发布包含位图修复及音频后删除临时补丁与二进制替代物。

RDP Adapter 的输入事务按完整字符计数，每批最多 32 字符（按下/释放成对），不加等待计时；普通键立即派发。仅连续 mousemove 合并为约 16ms 内最新坐标，所有按键、按钮与滚轮事务先携带尚未提交的坐标，避免点击/键盘越过之前的指针移动；blur、切文本输入与 close 在 releaseAllInputs 前刷新并清理指针 timer，动态 resize 前也先提交旧坐标。输入事务不重试，某批失败停止后续文本，不把未知结果当作未发送而重放；保留原 IME 去重、修饰键集合与 64 KiB 预检。类型与状态留当前 Adapter，不新增 Shared 字段或全局队列；WASM 解码/绘制仍在原 SDK，本轮不承诺消除 RTT 或主线程解码成本。

### 重绘与接收调度

1. **职责与范围**：减少重复的远端分辨率重建，保持 RDP 协议消息边界；不改窗口、画面质量、输入及协议内容，不承诺消除网络造成的渐进更新。
2. **子功能与目录**：rdp-desktop 持有最新显示请求、上次有效尺寸和短期 timer；BrowserDesktopPeer 持有未完成的 RDP 消息残片。固定上游构建的 ironrdp-web Canvas 将提取后的变化区域交给 putImageData，rdp-frame-presenter 在当前实例 Canvas 的 2D context 上合并已解码像素；不修改全局 prototype。
3. **依赖方向**：前端仍经窄 Peer 能力请求尺寸，SDK 类型只在 Adapter；后端只识别 TPKT、Fast-Path 与 CredSSP DER 的长度，不解码图形、凭据、丢弃或重放 PDU。VNC 保持原逐块转发。
4. **类型与转换**：复用 RemoteDesktopDisplay，DPI 映射为原 100–500% 有效整数缩放；SDK DesktopSize 读取后释放。Buffer 仅在 Platform，不扩散到 Shared。
5. **入口与安装**：原 resize、connect、forward 和 stop 路径安装调度，无新配置、路由或依赖；无需升级或重编译 WASM。
6. **数据、事务与并发**：尺寸变化静默 150ms 后提交最新值，相同宽高及有效缩放跳过；建连以 SDK 协商尺寸和 100% 初始缩放建立基准，非默认 DPI 仍请求更新。TLS 流按完整协议消息逐条发送 WebSocket；HYBRID_EX额外按实际协商状态识别一次四字节认证结果，不按任意字节数或 I/O 轮次合并；避免 SDK 握手结束时丢弃同一 WS 消息中的后续预读数据。完整消息立即发送，不设凑批 timer；保留原发送水位和有界缓冲，DER 消息受原 2 MiB 单帧预算约束。
7. **生命周期与失败**：关闭取消尺寸 timer 并清空未完成残片；晚建连不重新调度。resize 失败不记录为已提交，本地提交记录不代表远端已确认应用；非法长度、发送错误关闭原桥，并等待所有已派发发送回调与 socket 真实收敛。活跃传输保持完整字节顺序，不重放失败消息。像素 presenter 单实例保留最多 32 MiB 底图，只复制 dirty region，临近且合并面积至多原面积 1.3 倍时合并；最多 32 个区域，超量时只合并新增重绘面积最小的一对，不将全部分散变化直接扩成整屏外包矩形；扫描范围由原区域预算约束，不积压中间帧。同一 animation frame 提交全部区域的最新像素，不改 SDK 读取/输入节奏；后台无 animation frame 时继续更新同一有界底图。尺寸赋值即使数值相同也清空 Canvas，因此在当前 canvas 实例拦截 width/height setter 清理旧底图与回调。超预算/分配 RangeError 回退直接绘制，非支持的像素输入先提交待绘内容再回退原生校验；异步提交异常走原连接失败出口。关闭取消回调、释放底图并恢复原实例方法/属性，不保留全局监听或计时器。
8. **当前能力与验收**：两轮源码及静态/构建证据归 testing；真实拖动/全屏/恢复、DPI、弱网大画面、混合 PDU 与关闭失败留远程回归。不更改主线程解码或宣称获得视频编码/Worker 解码能力。

### 绘制能力与性能方向

当前固定 IronRDP 构建由 `ironrdp-web/session.rs` 在主线程处理 PDU、维护 DecodedImage，再由 image.rs 提取变化区域、canvas.rs 构造 ImageData 并调用 putImageData。较高或较宽的变化区域可能按完整图像行提取，之后本项目 presenter 再复制到整张底图并记录 dirty region。SDK交付的 ImageData 引用 WASM 内存，后续解码可复用它，因此保存到本地底图必须在接收时完成，不能仅保留引用等下一帧再读。同一 animation frame 可合并已收到的更新，但 SDK 未向应用公开远端整帧完成回调，跨多个浏览器帧到达的区域仍会渐进显示；不能把 PDU 或 TLS chunk 当成完整画面帧。单实例 32 MiB 合并底图预算外采用直接绘制，较大画面也可能失去本地合并。

该构建默认 `legacy_graphics=false`，已有位图 codec 协商；同时固定 `ConnectionType::Lan`、`compression_type=None`、`support_dyn_vc_gfx_protocol=false`。现有 SessionBuilder 扩展没有应用可用的 RDPGFX/H.264/Worker 绘制开关。`legacyGraphics(true)` 面向旧服务器的无 codec 位图模式，不是加速模式；库内部存在某种解码代码也不证明当前 Web 客户端已协商并消费该通道。当前不能宣称浏览器视频解码或硬件加速已启用。

noVNC 1.7.0 自身持有 backbuffer、damage bounds 与有序 render queue，在 FramebufferUpdate 全部矩形处理完成后 flip，并在下一次更新前等待未完成的异步绘制，避免本地队列无限堆积。它默认协商 CopyRect、Tight、TightPNG、ZRLE 等；浏览器支持 WebCodecs H.264 时也会声明对应 encoding，但仍需服务器选择。项目未覆盖 qualityLevel=6、compressionLevel=2 的库默认值。没有真实协商/网络记录时，不能判定当前服务器使用哪种编码，或认定提高压缩一定更快；压缩、图像质量、服务器与客户端 CPU 存在取舍。

已核对的外部接入依据：

- [IronRDP 官方 Web 接入](https://github.com/Devolutions/IronRDP/blob/62246b364a0282bab85087f658a81fe4207b6b31/web-client/iron-remote-desktop/src/services/remote-desktop.service.ts) 通过 SessionBuilder.renderCanvas 和 extension 配置原 SDK；[固定构建的 session 配置](https://github.com/Devolutions/IronRDP/blob/62246b364a0282bab85087f658a81fe4207b6b31/crates/ironrdp-web/src/session.rs) 才决定实际图形能力。
- [Devolutions Gateway 的 RDP 接入](https://github.com/Devolutions/devolutions-gateway/blob/0e65dc2637f29d8e84dbfd326ce887960f5ca2a0/webapp/apps/gateway-ui/src/client/app/modules/web-client/rdp/web-client-rdp.component.ts) 使用同一 IronRDP Backend 与官方 Web component，并对动态尺寸做 debounce；没有在该接入中发现可直接移植的视频绘制开关。其 VNC 使用另一 Iron VNC SDK，不作为本项目 noVNC 的直接接入依据。
- [Cockpit Machines 的 noVNC 接入](https://github.com/cockpit-project/cockpit-machines/blob/c03f14ae4abb8175c3a9b53d75db53905b55d3c0/src/components/vm/consoles/VncConsole.tsx) 直接配置 RFB 的缩放/远端尺寸等公开能力，不包装私有显示队列；[noVNC Display](https://github.com/novnc/noVNC/blob/v1.7.0/core/display.js) 与 [RFB](https://github.com/novnc/noVNC/blob/v1.7.0/core/rfb.js) 是本项目已安装版本的真实绘制 owner。

本地 presenter 保留 ImageData 底图与 rAF 提交，超过原32区域预算时按最小新增重绘面积两两合并，减少分散小块引发的大面积重绘；仍在同一浏览器帧提交全部区域，保留最新像素、透明替换和原分配/不支持输入回退。原生 Canvas backbuffer/drawImage 与零复制行视图均未采用；基准数据、环境和验收边界归 [testing](../testing/E2E.md#rdpvnc-绘制性能验证2026-11-04)。

真实端到端定位仍需测量接收间隔、解码主线程耗时、分辨率与协商编码，覆盖静态文本、拖窗和大面积滚动。VNC优先核对协商及服务器能力，保留库自身提交边界；不额外延迟协议或绘制、不盲目改质量/压缩默认值。RDPGFX/视频及 Worker 属于 SDK/构建能力评估，不能通过应用层假开关实现。

## 8. 当前能力与验收

证书确认/记住已接入源码，取消/一次/记住与同指纹复用的既有协议/浏览器消费者已迁移；新证书变化、CA/名称/有效期、实际建连指纹替换和并发/取消尚待本批正式行为验收，不复用下述历史通过结论。源码已替换双端传输并移除 guacd/RemoteApp，既有集成与 E2E 已迁移为真实 TigerVNC/xrdp、浏览器 SDK 和 X selection/xterm/鼠标证据，不用虚假 Guacamole 指令证明画面或输入。

当前已完成静态检查与构建；PLAN D17 的一般本地测试限制保持，D19 授权的指定 HTTPS 站点真实 RDP 基础链路、常用键盘、composition 去重、双向纯文本剪贴板及拒绝授权、窗口/全屏切换，以及 Chromium 移动仿真输入和触控已验证。后续已补证分钟级持续输入、票据重放/过期拒绝不影响原连接、受控 WS 关闭/新票据重连、两次建连中取消及刷新后实际 TCP 释放；页面销毁后的 WS 事件观察缺口由独立 TCP 证据补充，不记录原脚本整体 PASS。该证据不覆盖 VNC、其它系统组合键、原生输入法/手机真机、小时级或空闲稳定性、16 路并发、强制晚成功/复杂故障及多平台。旧 Guacamole 的 B10/Windows PASS 只属于旧实现，不能作为新桥的验收。具体命令/结果归 [testing](../testing/E2E.md)，操作见 [USAGE](../USAGE.md#远程桌面)，实施状态见 [PLAN](../PLAN.md)。

IronRDP npm 0.7.0 尚未包含位图 source stride 与边界修复；Adapter 对齐桌面宽度不能处理单个位图矩形的源行填充，已移除该规避。正式依赖以 `62246b364a0282bab85087f658a81fe4207b6b31` 为基线，应用上游公开Web音频PR #2020的固定提交 `3bf4a223f7765a05597849691eb76da34d7e5cc8` 后重编译WASM/npm archive，仓库 vendor 目录保留完整来源、SHA-256 与双许可证，pnpm lockfile 验证完整性，Docker 与 E2E runner 安装前复制该文件。运行时不下载 Actions 产物；音频源码补丁与构建步骤见vendor/ironrdp/README，窗口UI保持；保持现有 initial/dynamic 尺寸、像素 presenter、输入与关闭 owner。更新上游构建或恢复 npm 正式版均须回归真实画面、键鼠、剪贴板、动态缩放及重连，不能仅凭版本号判为兼容。

上游能力截至2026-11-05：RemoteApp原生Viewer窗口支持[#2201](https://github.com/Devolutions/IronRDP/pull/2201)、完整RAIL消息[#2196](https://github.com/Devolutions/IronRDP/pull/2196)、原生压缩音频/DVC[#2203](https://github.com/Devolutions/IronRDP/pull/2203)和多显示器/DPI[#2182](https://github.com/Devolutions/IronRDP/pull/2182)均已合并，不能描述为只有协议草稿或秘密功能。Web音频[#2020](https://github.com/Devolutions/IronRDP/pull/2020)仍open，较早的Web Audio方案[#904](https://github.com/Devolutions/IronRDP/pull/904)仍draft；Web图形接入/修复[#1977](https://github.com/Devolutions/IronRDP/pull/1977)仍open。原生能力已合并不表示当前Web SDK有相应公开接口，也无据承诺Web交付时间。

### 非全屏 RDP 顶部工具栏

1. **职责与范围**：仅非全屏RDP使用顶部浮动工具栏；所有原标题、窗口操作、文件剪贴板和尺寸控件合并在同一顶部区域，窄屏自然换行。VNC保留原上下布局，全屏保留原交互。
2. **子功能与目录**：RemoteDesktopModal持toolsOpen和floatingTools，以同一chrome容器复用原控件，不新增全局状态或通用弹窗规则。
3. **依赖方向**：Modal消费原Controller/Peer和Foundation按钮/输入/覆盖层，无后端、Shared或SDK扩展。
4. **类型与转换**：局部布尔状态与PointerEvent/MouseEvent留组件；无外部协议或持久化变化。
5. **入口与安装**：顶部短横条支持鼠标悬停、触屏点击和键盘Enter；Esc关闭并返回触发点。已连接时收起，连接中/失败及文件面板打开时保持可见。
6. **数据与并发**：从初次建连前就使用绝对定位，避免晚切布局使不支持动态resize的服务器留下黑边；展开收起不改变显示区域和协商尺寸。focus-within保留键盘操作，点桌面释放工具栏焦点。横条展开会替换触发节点，因此同时由面板pointermove/pointerleave核对鼠标已进入桌面或离开窗口，避免只依赖被替换节点的mouseleave。
7. **生命周期与失败**：断开/关闭重置浮出状态；异步键盘聚焦核对active/visible/当前状态。文件面板仍挂在桌面节点内并提升原chrome层级，不使用会改变fixed定位的transform；隐藏/关闭不重建连接。
8. **当前能力与验收**：真实Windows、桌面及触屏仿真范围以testing为准；不将仿真视为原生手机键盘或VNC全链通过。
