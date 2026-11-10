# 接口使用补充

本文说明手动接口、协议容量及失败恢复细节，面向脚本和客户端接入；普通界面操作见 [USAGE](USAGE.md)。完整类型/解码以 [Shared](architecture/SHARED.md) 和实际安装路由为准，业务与资源 owner 见 [Backend](architecture/BACKEND.md)，不把本文当作已生成的 OpenAPI。

所有接口使用当前版本格式；身份、同源写入、CAS、幂等意图及未知结果各按真实入口处理。旧阶段验收叙述不构成额外功能承诺；当前验收基线见 [E2E](testing/E2E.md)，详细历史见 [验证索引](testing/HISTORY.md)。

按接口选择：[连接与凭据](#连接与凭据开发接口)、[终端与 Workspace](#独立终端与-workspace-协议)、[文件资源](#独立文件资源)、[传输](#传输开发入口)、[认证](#认证开发接口)。

## 连接与凭据开发接口

连接、凭据及关系接口由正式连接管理页面和受认证客户端消费；旧独立开发页面已移除。完整 JSON 按 UTF-8 字节计量，包含外壳与转义；前端预检，后端超限返回 413 `body_too_large`。

| 请求                 | 上限                                                                |
| -------------------- | ------------------------------------------------------------------- |
| Connection / SSH Key | 128 KiB                                                             |
| Proxy                | 64 KiB                                                              |
| Tag / Host Key       | 16 KiB                                                              |
| 连接导入 JSON/文件   | 每批 50 项，JSON/文件 1 MiB；multipart 完整正文另有 16 KiB 封装余量 |
| 未保存 SSH 测试      | 完整 JSON 512 KiB，私钥原文 64 KiB                                  |

开发认证与终端见对应章节。后端管理接口仅管理员可用，每个实际读取/写入事务在开始及提交前复查原会话；排队期间登出、会话到期或改密失效将拒绝该事务，返回401，非管理员返回403。已在撤销之前提交的修改仍保留；已经读取后交付的网络响应不保证可撤回。后端连接、代理、SSH Key、标签和 Host Key 的持久修改若返回 `operation_unknown`，先重新读取核对，不自动重做；普通存储不可用与提交结果未知分别表示。Host Key 主机名按小写保存，最多253 UTF-8 bytes，拒绝空白、控制字符及非法Unicode；指纹须为SSH公钥的SHA-256。凭据省略保留，代理密码显式 `null` 清除，SSH Key 的空/`null` 口令清除；私钥正文和连接密码不允许空值。后端独立SSH Key、导入及未保存测试统一支持最多64 KiB私钥、8 KiB口令和128-byte密钥名称；名称去首尾空格，秘密正文不trim。Proxy名称/主机/用户名分别最多128/512/256 UTF-8 bytes，密码最多8 KiB；清除用null，纯空格密码保留原值，不作为空值。Proxy只支持HTTP/SOCKS5的用户名/密码，不保留旧管理API中没有实际传输消费者的key认证字段。连接克隆名称同样最多128 UTF-8 bytes，克隆在同事务复制凭据与关系。连接主机/用户名/备注分别最多512/256/4096 UTF-8 bytes；密码最多8 KiB。每条连接最多16个直接跳板，与递归深度/总展开数量分别计算；新建、编辑、导入及恢复使用相同字段容量，测试密码仍可为空，不因此允许保存空密码。
Proxy 删除结果未知时，列表继续显示最后一次已确认的代理记录，错误通过全局 Toast 提示，不挤占实体列表；Store 的 `needsRefresh` 禁用全部增删改按钮，只有明确成功的只读刷新才解除写入围栏。不得用错误告警遮住待核对的旧数据。

## 独立终端与 Workspace 协议

后端独立 Remote HTTP/PTY 有自己的 SessionOwner，不等于普通 SSH Workspace。当前 `/ws/workspace` 已承载真实终端、Files/transfer 和挂起恢复的源码；源码与静态收口不代替实际验收。多标签终端、挂起恢复及管理 HTTP 已由当前后端提供，实际验收范围见 testing。正式前端普通连接/恢复/关闭、NXW1和挂起事件已对接 Shared；本轮完整界面回归按 D17 统一留远程 Actions E2E。

**当前 Workspace 协议**：后端已将 `/ws/workspace` 对接真实 SSH shell/关联 Files lease：终端输出、8 MiB 普通断线 journal、120 秒宽限期、generation/offset 与明确 `workspace.resumeAck`。Shell 先交付，SFTP 后台异步初始化；cwd/PID、Bash/Zsh prompt/queued cd 有源码。挂起子协议包括 `suspend.mark/prepare/commit/unmark/list/resume/resumeAck/owner.renew/history.previous/history.reset/terminate/remove/rename`，同一 SSH shell 在后台挂起 24 小时、日志最多可见 100 MiB、1000 行/4 MiB headless VT checkpoint、256 KiB 历史分页和异常断线 catalog；`/api/v1/ssh-suspend` 五管理 HTTP 与本地文本导出已接线。挂起恢复同样**必须客户端显式发送 `suspend.resumeAck`**，完整 baseline 已发送不代表 owner 已提交；失败/超时退回原挂起 owner，不在新 Workspace 创建 SSH shell。普通workspace.resumeAck已由正式前端迁移并通过真实本机SSH专项；挂起管理五HTTP的正式前端已消费Shared并完成有限专项；挂起ACK与模式事件的正式前端源码已迁移，静态类型/构建与逐项行为结论见 testing。既有专项验证普通续接的错误 ACK/旧 generation 拒绝、离线输出回放、同一 PTY；挂起 prepare/commit、恢复未确认即断开回滚、租约续期及 takeover；注销后旧 Cookie 拒绝、新登录续接及 Files 实际读取。普通 WS 终端未确认输出最多 1 MiB，客户端通过 terminal.flow 累计确认消费；确认超出已发送字节或倒退会拒绝。另已验证 6 MiB 慢消费后精确恢复、满窗口断线后继续原 Shell、续接回放等待字节消费后仍要求独立所有权 ACK，以及 10 MiB 离线输出裁剪后的旧/未来 offset 拒绝和合法尾段回放。既有专项已补验挂起 baseline 消费窗口、慢日志积压期间断开仍保持背压，以及真实 45 秒租约到期后不带 takeover 续接同一 PTY；技术日志已核对压缩、绝对分页游标和打开中的旧文件句柄。另已验证准备阶段自然超时或取消挂起标记后仍保留消费背压；prepared状态断开后原PTY继续向日志输出，日志实际写失败会关闭原PTY并保留停机原因。历史数据帧/终帧失败后同页可重读、reset与并发页保持原字节顺序；日志 append/replace/trim 的实际文件系统拒绝、导出渲染后注销、两名额准入和客户端断连已验证。慢日志恢复被另一客户端接管时，回滚仍保留原日志背压，最终原始输出完整。日志追加遇真实空间耗尽可能留下未确认的部分字节，不能当作原子回滚或自动重写；写入失败后该日志保持失败，替换/压缩未发布时保留原文件及已打开的历史窗口，临时删除也失败则保留两项原因。其余管理/容量/期限组合与本轮正式前端整链仍待验收。

挂起历史只保留**最新 100 MiB**，不承诺无限向前翻页：当更早内容已被压缩窗口裁剪，前页查询必须停止，不能重复已显示内容。历史分页发送失败时不得跳过未送达的数据；关闭若仍有未经确认的远端 SSH/SFTP/本地日志清理，报告资源结果未知，而不是显示已释放成功。真实消费与故障行为的验证范围见 testing，不从协议设计推断全部故障组合通过。

正式终端输入每次最多256 KiB UTF-8，拒绝畸形Unicode；窗口尺寸为2–1000列、1–500行。文件管理器的终端目录读取/切换使用当前已连接附件，路径最多4096 UTF-8 bytes；切换需同时收到有效请求回执和实际完成事件，排队不代表完成。断线、超时或回执异常时显示结果未知，先读取当前目录核对，不自动重发切换命令；主动关闭也会结束本地等待，不能据此认为远端切换已撤销。

文件管理器“将终端目录切换到当前路径”在 Shell 提示符就绪后发送普通 `cd '路径'`，安全转义路径中的单引号，不附带随机标记或历史清理长命令。切换成功不弹通知；后端确认需要等待 Shell 提示符时显示一次提示：若有未执行输入，先按 Ctrl+C 清空当前行，随后自动切换；若已有命令运行，等待其结束。等待期间保留按钮的处理中状态，不自动清行、执行或保存草稿；失败或结果未知沿原 Toast 提示。命令和真实错误正常显示，后台输出不隐藏；是否记录这条 cd 由用户的 Shell 历史配置决定。

Workspace 在首个附件可以进行终端输入前，以同一次隐藏命令完成 Bash/Zsh PID 探测与提示符 Hook 初始化，避免两次初始化之间切换回显；结果识别不依赖命令回显，关闭回显的 Shell 仍可初始化。内部探测和 Hook 安装命令不进入终端输出，初始化不额外插入空行或重复显示提示符；保留服务器登录信息、原有空行和用户命令的正常输出。用户主动发起的普通 `cd '路径'` 仍正常回显。初始化等待期间撤销登录或关闭原会话，不能交付失效附件。非 Bash/Zsh 或初始化失败的会话保持可用，但目录读取/切换明确不可用，不能展示虚构目录；后端不会在用户已输入后向未验证 PTY 注入迟到的内部命令。挂起自动终止事件与日志导出需要有效的当前登录身份；无效或被撤销的 Cookie 不能继续利用先前 WS 升级结果获取管理事件。本段为待验源码行为，非正式前端承诺。

挂起恢复时，即使服务器发送完终端基线并收到 `suspend.resumeAck`，也必须继续尊重浏览器 `terminal.flow` 的已消费字节：用户尚未确认消费的输出不能被“恢复已完成”事件绕过背压。所有权租约超过 45 秒且未续期时旧附件应立即失去写入/管理权限，不能依赖周期性定时器出现短暂授权窗口。一般 `workspace.close` 也只允许当前有效附件发起；旧 generation、旧 socket 不能关闭正在接管的会话。既有专项验证旧 generation 关闭拒绝、显式恢复 ACK 与主动 takeover；未消费输出背压与45秒租约自然过期已有限验证；到期至扫描前的完整写入/管理交错仍待验证。

同一 WS 连接内重开其他 Workspace 时，终端已消费/已发送计数必须以新附件重新计量；旧恢复请求的迟到二进制输出或失败清理不能影响新标签。挂起标记与准备/提交请求在等待磁盘或身份授权期间若已被取消、断开或替换，不得再报告标记成功；45 秒 owner 租约已过期时新设备无需等待周期扫描即可尝试恢复。正式前端已适配上述消息及生命周期；行为结论以 testing 的实际证据为准，本轮变更仍待远程回归。

仅原 Access 会话可操作；WS 断开关闭 PTY，无挂起恢复/命令重放。正常退出等待尾部渲染，异常断线或清理失败报不可用，主动关闭不冒充正常退出。退订失败仍继续关闭底层资源；所有清理失败保留到停机汇总，不能报告清理成功。

打开、读取和关闭终端要求有效管理员会话：未认证返回 401，无权限返回 403；认证有效但资源不存在或不属于当前会话返回 404。建连完成后复查登录会话，期间失效则关闭新建资源，不交付终端。

| 范围              | 限制                                                |
| ----------------- | --------------------------------------------------- |
| 终端尺寸          | 500 列、300 行                                      |
| 输入/输出数据单帧 | 32 KiB                                              |
| 待渲染确认输出    | 128 KiB                                             |
| 已完成释放结果    | 同会话最多保留 128 条、120 秒，窗口内复用成功或失败 |

挂起初始快照最多 4 MiB UTF-8，mark/prepare/commit 的完整 JSON 消息预算为 24 MiB + 16 KiB（包含转义与外壳）；普通控制消息仍最多 1 MiB，历史前页最多 256 KiB。正式前端对接时须消费 Shared 容量，不能把原文上限当成实际发送字节上限。

后端全 Remote 最多同时导出 2 项日志，单项完整期限 60 秒，包含渲染、响应交付与收尾；超过返回 limit_exceeded。输出每块最多 64 KiB，并在交付每块前重新检查登录身份和原资源是否仍有效；已交付内容无法撤回。终止/删除/取消会中止关联导出并等待真实资源收敛，清理无法确认时报告 operation_unknown，保留名额，不自动重放。临时日志删除失败即使 SSH 已关闭也不算清理成功。

## 独立文件资源

独立 HTTP 文件接口确认 Host Key、保存凭据后打开 SFTP 资源，不借 PTY，提供目录、stat/lstat、UTF-8读取/保存、新建、重命名、删除及mkdir/rmdir；旧独立开发页面已移除。正式文件界面通过 Workspace 文件能力完成相应操作，协议接口分别核验权限和资源生命周期。

| 范围      | 限制与行为                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径      | 远端绝对路径 UTF-8 ≤4096 bytes；mutation 拒绝根路径 `/`，不使用 Backend 本机 realpath 解释远端路径                                                                                                                     |
| 完整目录  | 200 项、48 KiB metadata，超限失败，不返回截断快照                                                                                                                                                                      |
| 文本      | 有效 UTF-8 原文 ≤16 MiB；拒绝 NUL/明显控制字符；读取/保存普通文件，不把现有符号链接当文本目标。完整 JSON 请求/响应另按转义后的 Shared wire 预算约束                                                                    |
| 保存      | 同目录独占临时文件；预期新建时用标准 SFTP rename，目标已存在则失败，新文件默认 0600；覆盖已有文件才走 replace，并保留原 mode。客户端提交 `expectedSha256=null` 表示预期不存在，或提交读取所得 SHA-256 表示预期现有版本 |
| 基础操作  | rename 要求目标预检不存在且不主动覆盖；remove 删除单个文件或符号链接自身；mkdir 只建单层目录；rmdir 只删空目录，不递归                                                                                                 |
| 资源/期限 | 不设独立资源数量门槛，闲置约 2 分钟；JSON body 接收仍受 Platform 约 15 秒 request timeout，完整解码后单次打开/读写/基础操作的认证、指纹复查和多步文件流程约 30 秒                                                      |

绑定当前会话、目标及配置指纹，敏感操作前后复查。hash/metadata 预检只能尽力发现冲突，SSH/SFTP 不提供需要的原子 CAS；普通 rename 也不宣称跨所有服务器的原子 no-overwrite。覆盖已有文件优先使用服务器的 OpenSSH POSIX rename 替换；不支持时使用 backup→rename→cleanup 回退，其恢复/清理也不保证跨断线原子完成。

派发前已取消可确定没有该次文件副作用；请求已派发后若超时、断线、取消或无法确认收尾，返回 `operation_unknown`，资源退役且不自动重试。写入已生效后的读取或结果校验失败同样保持未知结果，不能按普通未写入失败处理。unknown 可能表示远端操作已经成功，也可能留下私有临时/backup 项，须重新打开资源并核对实际路径。确定失败会尽力清理临时文件；清理失败不覆盖原失败。上传/下载流与批量传输已有 源码入口，见下节；正式 Workspace 文件读写与挂起恢复已消费 Shared；独立 HTTP 资源仍保持自身生命周期和权限，真实 SSH/SFTP 与浏览器验收范围见验证记录。

## Workspace Files 子协议

Workspace 文件 attachment 与独立 HTTP Files 不再按资源数量拒绝创建；Files Service 仍追踪 opening、active、closing 和清理未确认的资源至真实关闭，两个入口不复用活跃 SFTP lease。有效的 `workspace.ping` 会重新核对登录会话、文件资源/目标指纹并续期，失效则拒绝并开始清理。二进制数据与 0-byte final 帧的背压等待均受同一文件操作的取消和约 30 秒期限约束，不在 Service 返回后再作无限等待。既有专项有限验证Service排队撤销、执行前身份/指纹复查、晚构造资源及失败保留；Access/SFTP为受控接缝，真实传输并发与故障继续验收，不能把Files-only接口当完整正式Workspace。

为保持正式 Files 消费者的现有通信入口，后端已安装 `/ws/workspace` 的 Files 子协议源码：fresh `workspace.connect`、`workspace.ping`、`filesystem.list/search/stat/readBinary/cancelRead/writeText/createDirectory/createFile/remove/rename/chmod/realpath`，以及 `filesystem.ready/error`。请求/响应继续使用旧 `{type,requestId?,payload?}` / `type=response + payload.ok/data/error` 外壳；控制消息上限 1 MiB、最多 64 个在途请求。binary read 单请求最多 64 MiB、同 socket 最多 4 个，NXW1 response frame 每帧最多 256 KiB；数据结束后先发 0-byte final frame，再发 JSON success。取消只停止当前读取 owner，不证明远端瞬时停止。读取范围固定为开始时的文件大小，后续追加不扩大本次读取；空文件只发送 final，短读报失败，固定范围不代表内容快照。断开后的资源释放绑定原 owner，不要求失效会话重新认证。独立 Files/PTY HTTP 开启接口在响应真正完成前保留断连清理（取得资源后最多等待 15 秒交付），不能以 send 返回判定交付完成。Workspace attachment 撤销时丢弃尚未派发的终端输入，重附着者不会继承旧输入；已写入远端的输入无法撤回。传输层在同步准入完成后立即释放消息名额，只有真正等待的异步回调继续占队列，避免同一网络批次的小按键触发64条未处理消息断流；无回执的终端按键通知按收到顺序合并派发，不占文件 RPC 的64个名额；合并后每批仍不超过256KiB，鉴权中与待派发消息按完整消息计入既有1MiB在途字节预算。每批派发重新检查原附件权限，关闭/更换附件丢弃旧输入，不自动重发被拒绝或结果未知的输入。

二次审核进一步把 `workspace.connect` 的 Targets 名称查询放进 Files Service 的同一 30 秒入场预算；Workspace 的 64 槽在**首次认证/目标查询之前**就预留，取消或关闭 socket 只中断本次请求，实际 SSH 清理继续由原 Service 追踪。失效心跳不再同步等待远端 close 才返回失败；无法确认的清理不提前释放名额。底层 Targets 查询没有可取消接口时，期限只保证调用方及时失败，不能声称底层数据库查询已撤销。上述均是源码事实，慢查询、失败清理及 64/65 并发的覆盖范围见测试入口及 PLAN。

旧事件面复查确认只有 `filesystem.ready/error`：保存、新建、删除、重命名、chmod 等 mutation 的完成由对应 request/response 表达，旧 Backend/Protocol 没有独立 `filesystem.changed` / file-modified 事件。不定义独立的修改通知；界面在 mutation 响应后的刷新/失效仍由前端用例负责。

Workspace Files 路径按 POSIX 绝对路径及 NUL 拒绝规则规范化，不套用上表新 HTTP 的 4096-byte 路径产品限制。list/stat 继续返回旧 metadata（含 uid/gid/atime/mtime 与 file/directory/symlink 标识）；search 保留8并发及子目录消失时跳过并标明截断，不设置结果条数、扫描目录总数或单目录条目门槛，完整结果沿8MiB协议预算校验；root或其他目录读取故障明确失败。Workspace列目录不设条目数量门槛，仍校验完整8MiB响应。普通递归remove不限制节点总数或目录深度；已经发生部分删除后失败仍保留operation_unknown，不自动重试。批量删除和上传目录准备由前端等待原1小时后端期限及最终回执，不再在30秒时提前提示失败。普通 remove 对目录做 symlink-safe 递归删除且缺失路径视为 no-op；批量按输入顺序执行；明确 force 的目录依次尝试 `rm -rf`、`sudo rm -rf`，命令使用同一删除任务的剩余期限，不另设5分钟门槛。write/create 保留已知 iconv 编码、未知编码回退 UTF-8、输入 BOM 处理和 UTF-16LE/BE BOM。

旧 `RemoteTextWriter` 的“已有目标 metadata 读取失败也静默继续保存”**不再由后端兼容**：目标不存在仍是正常新文件情况，但目标存在时 stat/metadata 失败直接返回真实失败。正式前端须显式刷新/重新载入并由用户决定再次保存，不依赖后端吞错或自动重放未知写入。

Files 子协议复用 Workspace 的连接、续期与生命周期；恢复和终端由 sessions 持有，下载票据与传输由 Files 持有，IP/2FA/登录会话由 Access 持有。正式前端普通终端和Files浏览/编辑/预览已接Shared与独立应用映射；Files等待当前附件SFTP就绪，取消预览同时停止metadata等待或原二进制读取，断线不自动新建socket。上传/下载port已接Shared；服务器传输、挂起与监控也已接Shared；桌面与完整页面已接当前 Shared，三语操作及实际覆盖以 testing 为准。旧包已删除，历史定义从 Git 追溯，不保留旧路径兼容桥接。浏览器验收按 testing 的实际范围记录。

## 传输开发入口

本节覆盖 Files 传输；终端、重附着和挂起恢复见[Workspace 协议](#独立终端与-workspace-协议)。入口：POST /api/v1/sftp/download-ticket、GET/HEAD /api/v1/sftp/download、GET /api/v1/sftp/download-directory、独立 /ws/uploads 与 Workspace 的 upload.prepare/start/cancel/abort、transfer.copyMove/cancel。短期下载票据绑定原会话摘要、原活动文件资源实例、Workspace、目标、路径、大小/修改时间及来源 IP；直接下载接受单段 Range 或 suffix Range，206 返回 Content-Range，无法满足范围返回 416；HEAD 不读取正文，响应以流式背压和客户端关闭取消收敛。ZIP 目录下载不限制条目总数或目录深度，使用真实路径祖先去环和流式压缩，不预先缓冲整个压缩包；消费者断开或失败后，生产者和源读取者一起停止并收尾。

非票据 GET `/download` 遇目录时也应直接流式 ZIP，HEAD `/download` 遇目录只返回 ZIP 类型头；inline 预览超出大小限制须明确返回 413 而非并发配额 429。旧版本未实现 ETag、If-Range、Last-Modified 条件下载，不为这些不存在的旧契约增加猜测性兼容。实际覆盖范围见[测试入口](testing/E2E.md)。

下载票据在认证、资源和指纹复查成功后才登记；HEAD/GET（含空文件、Range）只有完成响应收尾后才续期，最终 flush 失败不按成功续期。Workspace 的下载操作及票据 claim 覆盖整个交付，显式关闭或取消也覆盖 final 等待。定长下载保留最后1字节至源读取及最终授权复查完成，再随响应结束交付；空文件不附加字节。服务器完成响应收尾不替代客户端确认文件完整；断流后核对结果，不以 headers 或进度 100% 判成功。HTTP inline 预览最多 20 MiB，按 Shared 容量定义；前端各格式可以采用更低预算。

每个 Workspace 的准备、上传、copy/move 与归档不按固定任务数量拒绝；写入按原文件变更队列调度，同组最多16项，其余等待下一组，不丢任务。相同 prepareId 正在执行时返回 conflict；准备完成后的 allowlist 按有效期清理。

上传使用独立 SFTP lease、同目录随机私有 staged 文件，按 WS binary 顺序写入，完成最后一块后提交、校验并发送 transfer.upload 终态；零字节文件不要求前端另开上传 socket。前后端上传准备记录按实际批次分配，既有30分钟有效期到期后自动清理目录集合，无需再发起上传；前端上传准备不限制批次数量，上传与复制/归档本地队列不按任务总数拒绝，仍按原调度窗口执行；upload.prepare 不设置目录项数量门槛，建立限定根目录的相对路径 allowlist；cancel/abort、超时、断线不能证明已派发写入回滚，未知完成保留 operation_unknown 而不自动重试。未知上传可能保留临时文件并阻止同主机其他 Workspace、路径的后续写入；原 Workspace 的健康读取、终端与其他 SSH 端点（host/port）不因此失效。先核对原资源和实际文件，再按机器突变恢复流程处理，不反复重传。SFTP copy/move、目录ZIP下载和普通递归删除不设置20,000项或64层门槛，批量复制/压缩不再限制64个来源；实际路径仍受POSIX路径和协议字节容量约束。SFTP copy/move 使用文件/目录遍历、独立读写 lease、copy 后确认，move 在全部目标确认后删除源；中途可能已有副作用时按 unknown 对待。中转复制按256 KiB聚合，保持最多4个写入确认在途、源读取约1 MiB预取并连续补位，不等待整批确认才继续读写；不缓存整个文件。同一复制或上传目录准备任务内，已确认/创建的父目录去重检查；任务结束释放，后续任务重新确认。上传实际写入仍独立复查目录，准备记录不作为长期权限凭证。读写流共用完整传输期限，不再被元数据RPC的5分钟期限提前中断，进度只计已确认数据；上传取消停止派发后续写入批次，并等待在途批次和临时文件清理确认。

上传 start 即使携带 prepareId，也重新检查实际父目录；prepare 创建部分目录后失败按 operation_unknown 反馈。目录准备最多4个独立根分支并行，共享隐式父目录的路径串行处理；每条路径仍重新检查完整父链。失败后停止新分支并等待在途创建结束，已经创建的目录不自动回滚。传输路径及 prepare 拼接后的完整路径均不超过 4096 UTF-8 bytes，超限在派发前拒绝；旧 Workspace 基础文件路径政策不变。独立上传、copy/move 和归档取消只收尾自己的资源，健康 Workspace 可继续使用；显式关闭 Workspace 仍中止关联任务，包括正在排队的写操作；尚未执行的排队请求取消不会关闭健康 Workspace。跨 Workspace copy/move 任一端关闭都会中止任务，双端均追踪关联清理失败。上传临时文件、copy/move staged 文件、归档输出/stage/snapshot 清理失败，或独立资源在打开或关闭阶段无法确认清理时，安全出口返回 operation_unknown，任务 ID、在途资源及所属 Workspace 的关联继续保留，关闭不得虚报成功；终态任务拒绝晚追加或再次取消，不自动重试。旧 attachment 的迟到传输事件不进入新 attachment。

同一已存目标与配置指纹的 copy/move 在写入前检查整批计划：父目录链接别名先规范化，源链接叶节点仍保留本体；目标与任一源相等或互为祖先/后代时拒绝，原始同路径 move 仍不做修改。冲突时重新选择目标或拆分意图，不自动换入口重试。跨目标 move 删除源前，源权限改变也停止并保留整项 unknown；删除子项造成的目录大小/mtime 变化不算外部改写。不同目标 ID 的同主机别名、bind mount 及并发路径交换不构成已解决的原子快照保证。

归档执行器采用远端原生 `zip`、`unzip`/`zipinfo`、GNU `tar`，不依赖远端 Python/`pyzipper`；执行主机需要 POSIX shell、对应格式的归档工具、GNU `cp`、`od` 和基本文件管理工具。TAR 硬链接恢复另需支持 `-P` 的 `ln`。普通文件内容留在远端；ZIP 链接目标只按每项最多 4096 bytes 读取到后端。支持 ZIP、tar.gz、tar.bz2。开始前独立检查所需归档工具；此只读阶段取消不会创建归档、快照或解压目录，已派发写入后的取消仍须核对真实退出和清理，确认缺失时保留 unknown。

归档列表的名称和 metadata 分别按最多 8 MiB 解码；远端 shell 必须能设置文件大小限制，两个列表临时文件各受 8–16 MiB 上限约束（取决于 shell 的单位）。列表工具或编码读取失败直接拒绝，不接受部分列表；收尾清理失败保留 unknown。此限制只保护列表临时文件，不能当作解压任务的总磁盘硬配额。

压缩直接将所选路径交给远端原生 `zip` / GNU `tar` 递归处理，不提前遍历目录树，不设置压缩总条目数或目录深度上限。ZIP 复用工具原生 `-dc` 统计的已处理／剩余条目数计算进度，不额外扫描目录；条目包括文件、目录和链接，按条目数量推进，单个大文件处理期间不会连续显示字节百分比。发布产物检查完成前最多显示 99%，成功后才显示 100%；tar 格式仍只显示工具输出的已处理条目数。进度仅供展示，完成依据实际命令退出状态与产物检查，不依赖进度计数。归档先写同目录带正确格式后缀的私有 `.part`，完成检查后 rename/replace；仅无密码 ZIP 的非零退出可在独立 `zip -T` 校验成功后携带 warning 提交，加密 ZIP 和其他失败不发布。压缩源可包含输出目录，命令按字面量排除临时归档和旧目标，路径含 `*`、`?`、`[]` 或反斜线也不作为排除通配符。特殊文件按工具原生行为处理：ZIP 跳过 FIFO/socket 等不可收录项，GNU tar 可保存 FIFO 元数据并跳过 socket；不读取 FIFO 内容。只有远端命令确定结束才尝试清理临时输出。命令明确失败、尚未发布且私有临时输出已清理时，提示普通压缩失败，后续任务可继续；退出、清理或发布结果未知仍要求核对，不自动重试。

同一 Workspace 中，同一真实目录下的普通文件可并行压缩到不同的新文件，每组最多16项，后续任务排队而非拒绝；输出不能同时是另一任务的输入。目录/链接源、覆盖既有目标、解压及其他写操作仍排队，共用原整机持久围栏。各任务独立取消：压缩命令已派发但尚未启动 writer 时，请求远端 TERM 并等待实际退出和完整输出，确认未越过写入标记、独立资源已关闭才报告 cancelled；同组其余任务继续。无退出证据、已启动 writer 或清理不明仍保留 unknown，不推定回滚。正常写入结果继续等待整组资源排空和围栏结算。此补修待远程 Actions 验证。

解压先用 GNU `cp --reflink=auto --no-dereference` 创建同目录私有快照，核对类型/大小；成员预检与提取使用同一份快照。预检交叉核对名称、类型、大小，拒绝绝对/越界、重复名称和非目录祖先，不设置成员数量、目录深度或固定64GiB展开体积门槛，逐文件核对安全整数大小与真实stage内容。原生工具只提取普通文件和目录；符号链接与 TAR 硬链接排除后单独创建，再经 SFTP 核对完整 stage 后合并发布。只有链接的归档也有实际恢复路径。

符号链接仅允许归档根内的相对目标，保留原 target 字符串；支持叶节点链接链和根内悬空链接，拒绝循环、越界、将链接作目录以及经过现有特殊节点的目标。路径中的 `..` 逐段检查，不以字符串规范化代替实际路径前提。TAR 硬链接必须最终指向归档内声明的普通文件，真实创建硬链接，不静默复制；不一致权限、循环及非文件目标拒绝。设备及 setuid/setgid 成员仍以 `UNSUPPORTED_ENTRY` 拒绝。不同对象类型不互相覆盖；归档内的链接、目录及文件都计入进度。

密码 ZIP 使用原生 `zip/unzip -P` 的 ZipCrypto，与旧正式方案一致：密码经 shell 转义后直接作为命令参数，**会出现在 SSH 命令字符串及远端 zip/unzip 子进程 argv 中**，此方式已明确保留。不会额外通过环境变量传递密码，不记录完整命令或回传原始诊断；不需要 Python、Expect 或交互 PTY，不提供 AES 兼容承诺。私有 stage/SFTP 检查不提供 `dir_fd/O_NOFOLLOW` 原子隔离；同 SSH 权限的并发替换仍可能产生竞态。取消、断线或超时不等于回滚，未知结果不自动重放，也不冒险清理仍可能在使用的快照。本机OpenSSH下三格式往返、ZipCrypto正确/错误密码及部分链接/属性已验证；跨主机、断流取消和其余终态故障覆盖范围见测试入口及 PLAN。

跨 Workspace copy/move 也已增加对源会话原 token 摘要的 Access 复验，允许当前请求会话与源 Workspace 是同用户的不同有效登录会话，无需保存原始 token；源会话撤销后应拒绝。SFTP 技术层支持 readlink/symlink，复制保留链接对象而不静默跟随目标，目录复制后尝试恢复 mode。旧版本在符号链接上隐式跟随可能改变对象类型或陷入目录循环，新实现明确纠正。

copy/move 还原旧行为：目标为普通文件时以 staged replace 覆盖，已有普通目录递归合并，同目标移动在目标不存在时优先 SFTP rename；已有普通文件或目录走复制确认后删除来源（同路径不重复复制）；复制后恢复来源 mode 与访问/修改时间，并校验类型、大小、mode、mtime。应用时间戳用毫秒，Model 转换为 SFTP 所需 Unix 秒，不能将毫秒直接提交远端。批量请求如果包含同名目标冲突、重复源或父子源路径，**在首次远端创建前明确拒绝**，避免旧循环先部分覆盖或移动后再失败。符号链接目标已存在仍明确拒绝，避免偷偷跟随或覆盖其他文件类型；复制成功的符号链接也计入 completedFiles 并产生逐项进度事件。**能力范围已确定**：保持现有 SSH/SFTP 与原生工具部署要求，不新增远端 helper 或文件系统配额；不提供并发发布原子隔离或解压过程总磁盘硬配额。实际可用空间由远端文件系统决定，应用不提供解压期间磁盘配额；逐成员大小/类型、路径与权限仍校验，磁盘不足等真实工具错误正常反馈。本机OpenSSH下ZIP/TAR链接、普通mode/mtime和部分正常终态已验证；其他格式属性及故障仍待验收。正式前端 Files 运行时已对接 Shared；路由和源码完成不代表完整行为验收。既有专项验证本机OpenSSH/SFTP、三格式归档、普通Range/票据下载、多块上传及同主机跨Workspace复制/移动；WS大流背压、晚到cleanup、跨主机及取消/断流故障仍待验。

解压现在逐项检查并发布所有成员，目标目录不存在也不整树移动；发布前复查 stage 根/父目录、普通文件大小/mtime/mode 和链接目标。新建目录先允许 owner 遍历，再恢复归档属性；隐式目录仅在本次新建时恢复属性，已有隐式目录保持原属性。发现变化会停止并保留 unknown，不自动重试；原生列表临时文件删除无法确认时同样报告 unknown；逐项 SFTP 检查仍不提供原子隔离。下载 GET（含目录 ZIP）从准入到最终响应 flush 共用 1 小时期限，HEAD 为 30 秒，超时终止未完成响应并归还名额；排队写入在开始执行前复查当前权限，撤销后不沿用排队前的授权。

普通文件下载 GET 使用原 Workspace/会话/路径的相同授权，但实际字节流在独立 SFTP 租约上读取并在请求结束或取消后回收。高 RTT 链路允许限定窗口内按偏移并行读取，响应仍严格按原文件顺序传输并校验完整字节；HEAD 只需元数据，不占用额外字节流。原最长传输期限、鉴权中途撤销、下载 ticket、背压与清理失败不可冒充成功的规则不变。用户明确取消未提交上传时，须等待已经派发的写入确认并删除暂存文件才返回确认；已派发提交或断流的不确定结果仍提示 unknown。以上源码修改尚待下一轮八组 Actions 验收。

新的前端 Workspace 上传队列每个会话同时启动最多六个独立 SSH/SFTP 上传，剩余任务保持排队，不放弃或提前标记完成；需要在远程十文件拖入、冲突 apply-to-all、取消/断流场景单独验证。后台 Agent Job 不继承单次工具调用结束后的超时取消源，而是由其 Run 结束/撤销以及独立的 Job 期限共同约束；受限的 shell 执行及权限校验不变。SSH 挂起会话 `originalWorkspaceId` 记录首次标记时的 ID，不因后续恢复重写，前端前台恢复用稳定 suspended session ID 与当前 Workspace 重新关联。以上为源码拟修复行为，尚待远程独立断言。

登录密码轮换在正式账户事务中撤销全部旧 session token。既有 Workspace WebSocket 即使空闲也由服务端独立定期认证复核（当前每 3 秒一次）；身份失效主动关闭连接，旧 Cookie 不因为 WS 已建立而继续获得能力，不依赖用户下一次手动操作。此频率调整待远程密码变更/登出安全断言验收。通知渠道设置卡片绑定正式唯一渠道 ID 方便精确操作；秘密 keep/replace/clear、发送回执和投递最终态仍分开，单次测试按钮受理的 queued 不承诺 sent。外观编辑器上传/移除背景图像确认成功后，在当前编辑器推进 CAS 版本，但不丢掉用户尚未保存的遮罩透明度等草稿；后续保存仍按新版本一次提交，不自动覆盖外部并发冲突。备份恢复、IP 黑名单删除分别需显式二次确认；文件下载票据每用户最多 64 张有效票据，超额拒绝而非悄悄逐出合法持有人。以上前端和消费侧修正仍待新远程八组验收。

GNU tar 提取使用 `--no-overwrite-dir` 防止归档中的 `./` 根条目改变私有 stage 权限。Stage 目录先临时保持 owner 可遍历；明确成员的 mode/mtime 在发布后从深到浅恢复并确认，链接确认在收紧目录权限之前执行，绝不对符号链接调用会跟随目标的 chmod/utimes。已有隐式目录没有归档属性声明时不重写属性。目标路径与链接目标在发布前复查，发现变化不虚报成功；SFTP 逐项检查仍不能隔离远端同权限并发写入。

Workspace 的 SFTP 列表和直接文件操作按 POSIX 字面量保留引号、反斜线和换行文件名；终端目录切换与原生归档继续各自拒绝控制字符，不将文件名直接作为终端指令。Workspace 文件操作及传输路径、文本和密码现在同样拒绝孤立 Unicode 代理字符，避免 UTF-8 编码替换后访问不同文件名或改变内容；有效 Unicode 字符不受影响。

归档属性已补源码恢复：Unix 归档成员的普通 mode 与原生提取后的 mtime 在发布后逐项恢复并校验，目录按从深到浅的顺序处理，已有目录合并也恢复明确声明的目录属性；隐式父目录没有归档属性声明时不重写其已有属性。私有 staging 内临时保持目录 owner 可遍历，最终恢复原 mode，包括只读目录。DOS/Windows ZIP 不再按 Unix mode 误判，不宣称其携带 POSIX 权限。mtime 精度及 ZIP 本地时区以原生工具/文件格式为准，不保证 ACL、所有者或纳秒保真。

设备及 setuid/setgid 成员使用 Shared `UNSUPPORTED_ENTRY`；危险链接在派发前使用 `invalid_input`，已有目标类型冲突明确拒绝；已派发后的不确定副作用保留 `operation_unknown`，不把已发生的远端工作误报为未执行。正式前端按安全失败码显示对应提示。链接恢复已经有源码，不代表实机兼容和安全验收通过；密码 argv 可见是已接受的执行方式；并发发布限制仍保留。旧正式版没有 AES 支持。

下载票据过期后拒绝新的 GET/HEAD 准入，已经接纳的慢下载可继续；成功完成续期，重复释放不会影响其他请求。目录 ZIP 长读在输出时按 5 秒间隔复查身份，撤销后停止继续交付。上传流绑定具体任务实例，同 ID 新任务不能接收旧流数据；准备批次按串行操作核对身份和路径。跨目标 move 在开始删除前复查所有源的类型、大小、mode、mtime 与链接目标，逐项删除前再次复查（目录删除子项后的大小/mtime 不比较）；观测到源变化时停止删除并报告 unknown，保留已复制的目标，不自动重试。这些检查不能识别同大小/mtime 的内容替换，也不能消除检查与删除间的 SFTP 竞争窗口。

传输任务的请求标识现在由同一 Workspace 内的 upload、copy/move、archive **统一拒绝同时活跃的重名标识**；上传追加和各类取消在 await 身份验证后复查活跃任务仍是同一实例，防止晚到身份结果作用于已经结束或同 ID 新建的任务。SSH 归档 stdout 与 stderr 分别处理：仅白名单协议行进入进度/终态，stderr 在 Model 层排空，不收集或传给客户端，以免远端错误输出堵塞技术通道。取消、错帧、符号链接交换及大规模解压的覆盖范围见测试入口及 PLAN。

## 主题、外观与背景

完整认证用户只能消费自己的主题、外观和图片；403 个内置终端主题全局只读。GET/POST /api/v1/terminal-themes、GET/PUT/DELETE /:id；更新/删除带 expectedVersion。POST /import 保留 multipart themeFile 和可选 name，GET /:id/export 下载完整颜色 JSON，包含 selectionForeground。删除活跃主题同事务清空引用并推进外观版本；preset 同名处理保留用户颜色、ID 和引用。每用户最多 2,000 个自定义主题。

GET /api/v1/appearance 首次建立该用户默认设置（version=1）；之后读取、重启不会覆盖选择或主动清空的主题。PUT 带 expectedVersion 和实际修改字段；支持 UI JSON、桌面/移动端/editor 字体、窗口色、描边/阴影、背景显示参数、活动主题、HTML 内容副本和 GitHub 来源地址。图片引用只能通过图片接口更改，不接收任意服务端路径。尚未建立设置时 PUT 返回 version_conflict，先 GET；主题选择在写事务核对归属。

POST /api/v1/appearance/background/{page,terminal} 使用 pageBackgroundFile/terminalBackgroundFile 和 expectedVersion；DELETE 同路径使用 JSON expectedVersion。返回 {appearance,cleanupPending}，图片通过返回的 /background/file/<UUID> 路径读取，旧图片更换后不再公开。保留 JPEG/PNG/GIF/WebP/SVG，校验格式签名；SVG 为 UTF-8 内容，沙箱 CSP 交付。读取不代表后端执行 HTML/SVG；交付受服务关闭与请求期限共同取消，以响应完成确认交付，写入错误不会报告读取成功。

上传/读取/删除共用 16 个在途名额并串行，名额覆盖大文件读取、等待、发布和收尾；完整请求期限 60 秒。文件先登记 pending、持久发布，再同事务替换引用/版本并标 ready；旧项 retired 后清理。cleanupPending=true 表示引用已经提交，但仍有文件或元数据待清理；启动、下一次上传和停机复查无引用 pending/retired，失败保留记录和诊断。最多 1,024 个存储记录，未清理项继续占用。文件与数据库不是物理原子事务。

| 范围                    | UTF-8/编码预算                                                                    |
| ----------------------- | --------------------------------------------------------------------------------- |
| 主题名称/单个颜色       | 1,024 / 128 bytes                                                                 |
| 主题 JSON 请求/导入文件 | 32 KiB / 1 MiB；导入请求另留 16 KiB multipart 外壳                                |
| 主题列表/完整响应       | 最多 4,096 项 / 128 MiB，含 JSON 转义                                             |
| 外观请求/响应           | 各 8 MiB；UI JSON 16 KiB、HTML 副本 1 MiB、字体 1,024 bytes、来源 URL 4,096 bytes |
| 背景文件/完整 multipart | 5 MiB / 5 MiB + 16 KiB；五种媒体类型                                              |

UI JSON 为 CSS 变量对象：最多 128 个 ASCII --变量名，单值 2 KiB；HTTP 使用 JSON 字符串，内部使用对象。普通 JSON 在来源和完整会话准入后由 Fastify 有界解析，随后进入外观应用名额与 60 秒操作期限；原始图片上传仍在应用作用域内读取，停机或断连取消原任务。字体范围 0.1–512、蒙版 0–1、描边宽度 0–32、阴影偏移 ±512/模糊 0–512。400 invalid_input、401 unauthenticated、403 forbidden、404 not_found/theme_not_found、409 version_conflict/name_conflict/preset_readonly、413 limit_exceeded、415 unsupported_media_type；不可用/内部失败/清理失败/提交未知为安全 503。冲突先只读刷新；operation_unknown 或响应中断先核对当前主题/外观，不自动重传、重删或换版本重试。缺内容/损坏记录报失败，不静默修改用户设置。畸形 JSON、错误媒体类型和超限输入在写入前拒绝，不记为后台停机故障；输入取消不自动重试，已分类的存储或提交未知不因超时降为普通取消。

## HTML 主题库

完整认证用户使用 GET/POST /api/v1/appearance/html-presets/local 和 GET/PUT/DELETE /local/:themeName。17 个预置只读，自定义按用户隔离，可覆盖同名预置；删除自定义后再次读取同名预置。列表同时包含两种来源，返回 {name,type,version,updatedAt}；内容 GET 返回 text/plain，后端不执行 HTML。活动 HTML 保存在外观设置的内容副本，修改或删除库条目不会自动修改副本。编辑时改变名称表示另存副本，保留原条目；删除原条目需独立确认。内容允许为空。

POST 使用 {name,content}；PUT 使用 {expectedVersion,content}，DELETE 使用 {expectedVersion}。名称是单个 .html 文件名，最多 255 UTF-8 bytes，允许中文和空格，禁止路径、..、控制字符；放入路径时使用 encodeURIComponent，字节预算按解码后的名称计算。内容最多 1 MiB，允许空文本。更新/删除以自定义列表项的 version 为准；用户级持久修订不因删除重建而复用，也不保证每项版本连续。JSON 请求 8 MiB、完整响应 32 MiB（容纳远端目录最坏转义），列表最多 4,096 项，每用户最多 2,048 个自定义主题。普通 JSON 经来源和完整会话准入后由 Fastify 有界解析，应用处理期限为 60 秒；unknown 或响应断开后只读核对，不自动重写。预期输入拒绝、输入取消及文本交付前断连不记为整个主题服务故障；认证存储失败保留安全失败类别，不冒充未登录。

远端使用 GET/PUT /html-presets/remote/repository-url，读取 {url,version}，写入 {url,expectedVersion}（url 可为 null，版本与外观设置共用）。GET /remote/list 可提供单个 repoUrl，否则使用已保存来源；GET /remote/content 必须提供单个 fileUrl。仓库仅接受 HTTPS github.com 的 owner/repo 或 /tree/ref/path，内容仅接受 HTTPS raw.githubusercontent.com 的 .html；不跟随重定向，不自动改写旧官方 URL。保存来源不证明仓库可用或授予执行权。

目录最多 1,000 个上游条目（含非 HTML 条目），超过返回 413 limit_exceeded，返回 {name,downloadUrl}，只列合法 HTML 文件；内容最多 1 MiB，UTF-8 严格解码、纯文本交付。目录/下载共用 HTML 在途名额（16），网络期限 10 秒，关闭/断连会取消；读取已保存来源期间设置版本变化返回 409 source_changed，重新读取后人工确认。远端不可用为 503 source_unavailable，超限为 413，来源无效为 400；资源释放未确认返回 cleanup_failed 并停止该 owner 新准入，保留诊断。可选 GITHUB_TOKEN/GH_TOKEN 只发给 GitHub API，不发给 raw 内容地址，也不返回给前端。

## 状态与 Docker 对接

GET /api/v1/status 无需用户会话，正常返回 {status:"ok",service:"nexus-backend"}，用于现有 Docker 健康检查；不接受额外 query。仍受全局来源/IP 准入约束，关闭准入后返回503，不承诺数据库、SSH 或外部模型健康。宿主诊断的数据库不可用以 available=false 返回，本机状态采集失败为 remote_unavailable，宿主诊断采集失败为 unavailable；关闭等待中的采集失败会汇总，非历史故障记录。

停止监控或关闭后端会等待已启动采样及退订清理；SSH/SFTP关闭未确认保留清理失败，不作为已释放。状态采样遇到清理未确认时停止该订阅的自动采样并保留“结果未知”提示，避免反复新建 SSH 累积未释放资源；这不表示交互终端已断开，也不会因全局观测计数阻止其它连接采样。应核对服务端 SSH 资源与日志，必要时由管理员处理后重启后端，重新打开面板不会清除原未确认释放记录。普通读取失败仍按原周期重试。WS协议错误关闭对应连接，维护开始后不再派发原排队消息。Docker labels保留原生字符串，不转换成字符索引对象。既有专项验证 Workspace 原生 Docker 列表/实际采样及四种控制；Docker CLI 对停止容器若实际返回零样本则保留该样本，没有样本时才返回 null。上传中断后的 HTTP 排空同时观察请求中断和原连接关闭，业务与清理仍由原 owner 等待。

同一 Workspace WS 支持 status.start/stop、status.sample/error 与 docker.status/stats/command；Docker 控制仍为 Start/Stop/Restart/Remove，Enter/Logs 继续走交互终端，不新增任意命令接口。三个 HTTP 保留为 GET /api/v1/system/status、/api/v1/system/ssh-resources、/api/v1/system/ssh-resources/:connectionId。只接受新 Access 管理员会话；正式前端监控/Docker WS、Dashboard本机/SSH单项HTTP与采样配置已接Shared，完整页面验收单列。Dashboard资源读取失败显示有限安全提示；切换页面或隐藏标签会取消在途读取但保留最后一次成功结果，返回后按生效周期决定是否刷新，晚到的旧请求结果不回填；退出登录清除缓存。SSH按规范host/port去重，最多四路独立显示、每个worker的两次请求间隔200ms；同主机可能回退另一连接。缺测不补零，网络失败不伪造服务端检查时间。浏览器单次JSON读取期限15秒，结束等待不代表后端共享采样停止。

| 项目     | 后端当前语义                                                                                                                                                                                                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 采样     | 独立临时 SSH，不在交互式 PTY 注入命令、不刷新最近连接时间；首轮间隔 500ms 采两次，之后每次完成再等待默认 3 秒，不重叠。                                                                                                                                                                                                           |
| 后台     | 同主机/配置仅在同一登录内合并在途采样，已完成的成功结果缓存仍跨登录共享；一处登录失效不连带取消其它有效设备的采样。TTL 使用当前生效设置（首次默认30秒），从采样完成算；多端登录不设全局4请求限制，每个请求仍最多并行2个主机，单次等待最多120秒。命中缓存仍核对当前会话与配置，保留实际采样时间；当前不复用Workspace活跃SSH。      |
| 本机     | 本机状态在后端共享在途采样，成功结果从采样完成起缓存3秒，采样失败不缓存；多端登录不设全局4请求限制，每次返回仍复核当前管理员会话。单个请求等待最多10秒，等待超时不停止共享采样。                                                                                                                                                  |
| 配置     | 后端从持久核心设置安装状态间隔和后台资源 TTL，首次默认3秒/30秒，范围1–86400秒；保存后热更新，订阅重排间隔、清除旧TTL缓存，在途采样仍等待实际结算。                                                                                                                                                                                |
| 容量     | 普通 Remote 观测不设跨连接的任务总数上限，9个及更多已接纳 Workspace 可各自采样，不因全局8任务额度拒绝；单订阅仍串行，单项完整期限45秒。仍受服务器实际资源及其它入口既有准入约束。Docker identifier 最多128 ASCII字符、列表最多4096个容器；完整观测HTTP/WS JSON（含外壳）最多512 KiB，本机状态JSON最多16 KiB，输出超限仍明确失败。 |
| Docker   | 非零控制退出返回 command_failed；已派发但缺少退出证据或后续确认失败为 operation_unknown。容器中途停止/确定 stats 读取失败可返回 stats=null，不当成零值。                                                                                                                                                                          |
| 恢复     | 同一连接配置的控制动作互斥，unknown 或清理失败保留控制阻断；先只读核对，不自动重试。占用已持久化并与 Files 共用，同一文本 host/port 冲突；unknown/清理失败跨重启保留 blocked，无自动解除。管理员通过下述机器突变恢复入口核对与恢复；无自动解除。                                                                                  |
| 取消     | stop、附件断开/接管、Workspace 终止及停机取消原实例的观测任务；原 owner 持续追踪真实收尾，清理失败不冒充成功。HTTP 请求取消只结束其等待，其他请求共享的采样由原 owner 继续追踪。                                                                                                                                                  |
| 安全失败 | HTTP 返回 code；WS response.error/status.error.message 和资源 error 使用 Shared 安全码，不回传技术 stderr、cause 或凭据。                                                                                                                                                                                                         |

## 资源采集与缓存

Linux 内存与 Swap 直接读取内核的 `/proc/meminfo`，优先使用 `MemAvailable`；老内核缺少该字段时使用空闲、缓存和可回收内存估算。负载读取 `/proc/loadavg`，采集命令统一设置 `LC_ALL=C`，不依赖 `free` 或 `uptime` 的本地化标签，中文系统不会因“Mem:”被翻译而缺失内存数据。当前远端内存以 MiB 四舍五入显示，可能与 `free -m` 的截断值相差 1 MiB；未提供非 Linux 的远端采集回退。

每次采样重读机器信息，不跨采样复用技术采集状态；同主机/配置在途采集共用，只有成功结果进入缓存，TTL 从采样完成计算。失败不占用成功缓存期限，下次读取可重新采样，不自动重放任何控制动作。删/改地址不复用旧配置缓存，reset 不允许旧结果回填；TTL 内可能短暂显示旧状态。

多个并行主机同时返回同一种认证、权限或容量失败时，保留对应错误码和 HTTP 状态，不改报一般网络不可用；真实资源清理失败仍优先按结果未知处理，不被普通拒绝掩盖。

## 认证开发接口

正式认证页面：初始化、密码登录、TOTP二次登录、状态探测和登出消费新Access契约，基础JSON请求/响应各16KiB。探测失败保留未确认状态，不伪装未登录或已初始化；请求发送后断流/协议失败提示结果未知，先刷新页面核对会话再决定操作，不自动重发密码或验证码。错误使用安全三语文案，不展示技术异常正文。DEV Agent/Targets复用同一认证client，遇到二阶段要求只显示提示，不显示假登录成功。正式改密、TOTP设置、Passkey登录/凭据管理以及CAPTCHA/IP安全设置已对接新契约；正式前端源码适配已收口，当前完整远程基线及后继未验变更见 testing，不因源码适配宣称行为验收。

当前 Backend 使用 Access 摘要会话，不使用已移除的 Express session/cookie。空库管理员 setup 成功一次，密码长度至少 8、最多 1024 UTF-8 bytes，用户名去空白后不超过 64 字符；普通密码登录的返回身份不含密码 hash 或秘密。会话 Cookie 名 `nexus_session`，HttpOnly/SameSite=Lax，同外部 HTTPS origin 时 Secure；服务端仅存随机 token 摘要和 30 天期限，普通 Cookie 仅本次浏览器会话，rememberMe 才设置 30 天 Max-Age。再次登录创建独立新会话，不提前撤销浏览器原有 token；断连或响应丢失不废止原会话；登出清除当前 cookie 并撤销当前 token，改密提交时会复核原会话仍有效与密码版本，计算期间登出、过期或并发改密可返回冲突且不写入；成功则原子撤销该账号所有会话。状态 200 带 `isAuthenticated:true/user`，无效/过期返回 401 `{code:'unauthenticated'}`（当前开发客户端据此返回未登录）；成功结果仍保留 `isAuthenticated:true`；认证因素不可用时明确返回 `factor_unavailable`，不能降级为仅密码登录；TOTP/Passkey的现行流程与验证范围见下节。

首次初始化读取 `NEXUS_IP_WHITELIST` 的逗号/换行分隔 IP/CIDR（最多 256 项、16 KiB），空值放行全部已知来源；非法条目在监听前拒绝启动。HTTP/WS 入口统一使用直接 TCP/受信代理链提供的真实 IP；未知来源拒绝，loopback、RFC1918、link-local 和 ULA 豁免白名单与封禁，但**不**豁免密码、CAPTCHA、Origin。独立入口 `NEXUS_IP_BLACKLIST_ENABLED` 默认 true、最多 5 次失败、封禁 300 秒，可通过 `NEXUS_MAX_LOGIN_ATTEMPTS` 与 `NEXUS_LOGIN_BAN_SECONDS` 设置有效范围；`createApp.configuration` 的首次初始化工厂可显式关闭；后续重启和配置保存从持久设置读取，不重新用环境覆盖。其他业务的公网封禁入场返回 403 `forbidden`；登录路由由 Access Service 返回 429 `rate_limited`，状态、登出与黑名单管理员恢复路由仅执行来源白名单检查；未知 HTTP 路径也先做来源准入；管理员凭有效 Cookie 可读 `GET /api/v1/settings/ip-blacklist?limit=50&offset=0`（最大 200）及使用 `DELETE /api/v1/settings/ip-blacklist` JSON `{ip}` 解除，保留明确 `removed` 结果。列表读取和解除在实际事务复查原会话；排队期间撤销或到期返回401，不交付列表或提交解除。损坏账户/会话事实返回安全内部失败，不冒充普通未登录；登录失败窗口以真实计数事务的当前时刻计算。登录错误/CAPTCHA 明确拒绝按来源原子计数，正常成功才清对应失败记录；第三方校验期间出现并发封禁，签发事务仍拒绝并返回 429 rate_limited。

CAPTCHA 默认关闭，由管理员在安全设置页面启用并配置供应商、site key、secret 和准确 hostname，保存到数据库后重启生效。界面沿用供应商选择后展开对应配置和帮助链接；停用或切换供应商清除未提交密钥文本，保留／清除／替换及 hostname 使用后端语义。明确清除密钥可在停用前选择“清除”，随后停用并保存。可选的 `NEXUS_CAPTCHA_*` 环境变量仅用于数据库尚无配置时的首次初始化，后续启动读取持久配置，不覆盖页面保存值。启用时必需字段不完整会拒绝保存，`GET /api/v1/auth/login/options` 的captcha字段公开provider与适用site key、不公开secret；登录 `captchaToken` 必填且最多 4096 UTF-8 bytes。后端向 hCaptcha/Google 验证接口发真实 POST、十秒截止且不重试；启用时必须绑定 `NEXUS_PUBLIC_ORIGIN` 的准确 hostname，成功响应需要 hostname 一致；Google 仅支持 reCAPTCHA v2 checkbox，不接受 v3 score/action 响应，非 2xx 响应体即时关闭；供应商明确失败返回 `captcha_invalid`，网络/格式/超时异常返回 503 `captcha_unavailable`，不固定成功或故障静默关闭。密码与 CAPTCHA 均通过后才签发会话；客户端断连会取消待执行的网络校验/写入意图，已提交的新 token 若未交付则尽力撤销，原 Cookie 不因此失效。本地交付要求原传输仍存活时触发 finish；销毁后清空缓冲或迟到的 finish 不算交付，finish 也不保证浏览器实际收到；SQLite 提交未知仍按未知结果处理。HTTPS/Host/Origin/Fetch Metadata 检查在 Platform 的统一 HTTP/WS 边界实施。核心配置由 持久 Settings 管理，CAPTCHA/Passkey站点保存后重启生效，IP与监控配置热更新；正式CAPTCHA/IP安全面板已接版本化新契约；审计与通知正式前端已接 Shared Operations 契约，TOTP/Passkey 挑战已有 部分验证，详见下节；公网供应商、期限/配额与故障交错按 testing 保留待验。

数据库初始化创建完整表结构；登录失败记录包含最后失败时间和索引。后续结构及历史数据转换从下一版本起按变更逐条迁移，dev 与 latest 使用同一版本链，见 [部署文档](DEPLOYMENT.md#数据库迁移)。成功登录/会话验证等存储访问至多每五分钟惰性清理过期会话与已结束且七天无新失败的黑名单行，不清除活跃封禁。SQLite 提交或回滚状态不确定返回 `operation_unknown`（503），可能已有副作用，客户端不得假定失败并重放密码修改或设置写入；重登/重新查状态由当前身份和持久事实决定。

## TOTP 与 Passkey

本地 既有专项验证 TOTP 设置/激活、部分认证替换与权限隔离、并发单次消费、rememberMe、禁用与注销；受信代理下 HTTP/WS 来源拒绝、封禁与解除通过。CAPTCHA 使用受控 hCaptcha/Google 响应验证表单、hostname、v2/v3区分、拒绝与不可用；Passkey 使用 Chromium 虚拟认证器验证真实注册/签名登录、错误证据拒绝和管理操作。TOTP 生成/验证异常、部分登录密文解密失败和 Passkey options 故障不会启用因素或签完整会话；WebAuthn 实际验签供应商故障返回 factor_unavailable（503），原挑战保留且不降级登录。正式因素设置和安全配置页面已接新契约；未使用实体安全硬件或公网 CAPTCHA；自然过期、配额和提交/撤销竞态继续验收，精确范围见 testing。

- 密码核验正确且当前账户已启用 TOTP 时，`POST /api/v1/auth/login` 返回 200 `{requiresTwoFactor:true}`，设置 HttpOnly/SameSite=Lax 的 `nexus_partial`；服务端待认证记录 5 分钟有效，最多 64 条；同一浏览器重新完成密码核验时，旧部分会话在创建新部分会话的事务内替换。不签 `nexus_session`，该 Cookie 不能用于 SSH/Agent/Targets 管理。`POST /api/v1/auth/login/2fa` 的 JSON `{token}` 需六位数字和原 partial Cookie，TOTP 验证完成后在事务中签普通 Cookie，rememberMe 30 天直到此时才生效。错误验证码计入公网 IP 失败记录；并发完成仅一方可以消费待认证。未启用时“启用两步验证”、已启用时“禁用两步验证”与 Passkey 注册均位于对应分组标题右侧；禁用仍需在正文输入当前密码。
- 已登录管理员可 `POST /api/v1/auth/2fa/setup` 获取一次性 secret/QR（仅向当前已登录的发起者交付），暂存 secret 使用绑定账号的应用密钥 AES-GCM 加密，`POST /api/v1/auth/2fa/verify` 带 `{token}` 验证后启用；`DELETE /api/v1/auth/2fa` 带 `{password}` 再核对当前密码后禁用。TOTP 采用 30 秒、六位数字、相邻 ±1 时间窗；没有恢复码功能，不能向用户暗示已有恢复机制。启用因素不主动注销现有完整会话；禁用撤销未完成的部分认证。
- Passkey 使用独立 5 分钟 `nexus_challenge` Cookie。匿名 options 挑战全局最多 768、每可信来源最多 16，所有因素挑战总额 1024，以免公开入口挤占已认证注册配额；首次无关联 Cookie 的并发匿名请求不能视为同一认证实例，只有携带旧挑战 Cookie 的替换和已登录同 Session 的注册替换才有事务级唯一性。改密递增认证修订、使修改前签发的 Passkey 登录挑战在最终提交时失效；每个 credential 有不可复用的 generation，验签后的会话事务复查 generation 与 counter。已认证用户可请求 `POST /api/v1/auth/passkey/registration-options`，再经 `POST /api/v1/auth/passkey/register` 提交 `{registrationResponse}`。匿名可 `POST /api/v1/auth/passkey/authentication-options`（`{username?}`）和 `POST /api/v1/auth/passkey/authenticate`（`{assertionResponse,rememberMe?}`）登录；公开登录选项统一返回已注册状态，不按用户名额外查询配置。已认证用户可 `GET /api/v1/auth/user/passkeys`、`DELETE /api/v1/auth/user/passkeys/:credentialID`、`PUT /api/v1/auth/user/passkeys/:credentialID/name` 带 `{name}` 管理本人凭据。
- 注册/认证 JSON 请求最多 128 KiB，单个证据字段最多 96,000 UTF-8 bytes；凭据 ID 最多 1024 bytes，名称最多 128 bytes，transports 最多 16 项、每项 32 bytes。完整options/列表JSON最多8MiB，超限明确拒绝，不截断列表；列表时间为 Unix 秒，前端转换成毫秒展示；交付列表前复查原会话，读取期间登出、改密或到期拒绝交付。持久凭据的账号、编码、名称、transport 和时间损坏返回安全失败，不返回部分正常列表；原始 public key/counter 不公开。
- WebAuthn 只有实际验证完整 challenge、RP ID、公开 Origin、数字签名与 User Verification 才能登录；客户端 options 使用 `required`，与服务端要求的用户验证一致；计数器状态和 challenge 单次消费与会话签发同事务。旧挑战被新请求替换或过期须重新发起，旧失败不能换一个当前挑战重放。每个浏览器上下文 Cookie/Session 绑定挑战，签名结果不等于客户端声称的 verified 标志。支持既有 ES256/RS256 与零 counter 的同步凭据语义；不提供虚构的 recovery-code。公网禁用非安全来源的 WebAuthn RP，独立入口可用 `NEXUS_PASSKEY_RP_ID` 与 `NEXUS_PUBLIC_ORIGIN` 配置。
- 登录/设置流程遵循来源准入和完整会话授权，logout 清理普通、部分、challenge 和 TOTP 设置 Cookie。客户端明确无效的 challenge/Origin/RP/UP/UV/counter 认证证据拒绝登录，不能确定为凭据错误的 Provider 技术失败不回退为通过，也不累计密码错误；密码/因素签发的完整或部分会话以及 TOTP setup/Passkey options 已写入而 HTTP 未完成交付时撤销对应令牌/挑战；会话签发后的身份确认失败保持 operation_unknown 并尽力撤销，HTTP finish 不证明浏览器收到；数据库未知提交不可自动重试；真实第三方浏览器、网络中断和并发安全需在 进一步验收。独立入口已支持持久多 Origin/RP：首次可用 NEXUS_PASSKEY_SITES JSON 数组配置，每项为 {origin,rpId}；未配置时以公共 Origin 和可选 NEXUS_PASSKEY_RP_ID 初始化一个站点。最多16站点，Origin严格规范且与主监听同协议，RP必须匹配域名或其父域；HTTP仅支持localhost/127.0.0.1。HTTP/WS只接收配置站点或主Origin的受信Host/协议，同一请求的Origin必须匹配选中站点，不能跨配置站点借用CSRF许可。未配置RP的主Origin可密码登录但不能签发Passkey挑战；改变/删除Origin/RP在重启后令旧挑战失效，不自动选择首个RP。正式LoginView/Auth Store基础密码与TOTP二阶段、改密及TOTP设置页已接新契约。TOTP二维码只接受inline PNG，完整setup响应最多64KiB；取消/离开缓存页/卸载清除本地secret/验证码/密码，未知结果阻止重复写入，先点“重试”只读核对会话。Passkey登录/注册先严格解码options，再显式转换给浏览器，并强制用户验证；登录页始终显示Passkey入口，不预先查询账号是否已注册，未找到可用凭据、用户取消或验证失败时显示安全提示，不冒充密码登录结果。凭据页支持注册、重命名和删除；结果未知或已成功但刷新失败时先只读刷新，不自动重复写入。离开缓存页、卸载或身份失效取消原等待，旧结果不覆盖新状态。CAPTCHA/IP安全设置已接完整配置与CAS；审计、通知已接Shared，外观、Agent等其余功能继续迁移。当前源码实现及静态执行状态不等于正式功能已经上线。

## 审计与日志

审计观察层现在会在 HTTP 修改请求执行前，通过原会话读取操作者身份并将 userId 绑定到后续事件；Targets 等公开修改回执不包含 user 字段，不能由响应正文推断操作者。匿名/失效会话保持 null，登录等具备身份回执的路由沿用服务端身份事实。这项修复尚待远程 Actions 核对。

GET /api/v1/settings/audit-logs 支持 event/from/to/q/limit/offset：时间为毫秒，默认50条、最多200条，以nextOffset续页。仅记录有限事件、用户/来源IP、资源ID、路由模板与状态码，不记录请求正文、Cookie、密钥或模型正文。相同事件键只接受原绑定内容，改事件、身份、资源或路由/状态返回冲突；HTTP审计记录响应决定，不保证客户端实际收到。审计保留最新50000条和尚未完成通知分发的积压；投递保留最新50000条终态及全部在途项。

GET/PUT /api/v1/settings/logging 使用 {expectedVersion,level}，level为debug/info/warn/error/silent；默认info。已保存阈值启动加载，保存后立即按版本单调激活，GET同时显示effectiveLevel；版本耗尽返回version_conflict，不保存越界版本。Operations事件写有限安全元数据到stderr，失败/未知事件为warn，其余info；后端诊断与审计共用同一Pino实例及有效等级。日志配置和审计只供当前管理员，更新与会话复查同事务，冲突先刷新，未知结果不自动重放。

## HTTP 框架接入

后端模块接口直接注册 Fastify 路由，使用 `url`、`handler(request, reply)`、`bodyLimit`；正文从 `request.body` 以 unknown 交 Shared 严格解码，参数和重复查询在协议边界验证。禁止把 Fastify request/reply 传入 Service、Model 或 Shared。

普通 JSON 由框架先有界解析，再执行应用 handler；来源校验及应用写入的完整会话准入在解析前完成，业务 owner 在解析后和实际事务继续复查权限。multipart 路由声明 `config.multipartBodyLimit`，由独立插件 scope 提供流式 parts；`bodyLimit` 仍约束 JSON，multipart 完整封装和每个 part 分别计量，业务入口授权后读取，无自动临时文件。声明长度超限可在读取前返回 413；分块上传实际超限或未结束的 part 被拒绝时终止原连接，不保证能交付 JSON 错误，客户端不得自动重试写入。仅二进制原始上传使用 `config.rawBody` 并由接口承担读取预算和取消。

JSON 对象继续通过 `preSerialization`，模块 serializer 只编码一次并检查最终 UTF-8 字节预算；serializer 失败由原生 route errorHandler 投影安全错误，不能依赖 handler 的 try/catch 捕获。已提交写入的响应失败保留结果未知。普通 Buffer/Readable 使用原生 `reply.send()`；保留必要的 raw 响应时须设置自身内容/传输头；Helmet 已在 onRequest 将安全策略写入 raw 响应，不能另拼一份 CSP。绕过钩子的技术失败由 Platform 清除原实体及凭据头并生成最小安全错误。异步响应钩子完成前不得认为 send 已交付；需要资源确认的接口检查真实 finish、最终成功状态和原身份。审计发布不改写已经交付的业务结果。详细 owner、维护与错误规则见 [Backend HTTP 运行时](architecture/BACKEND.md#fastify-http-运行时)。

Cookie 解析与序列化分别使用已注册的 `@fastify/cookie` 实例；HTTP 的原生 cookies 和 WS 的解析结果经过同一重复名称/容量拒绝，模块继续读取安全事实，不能再手写解析或单独解析出另一份身份。Access Cookie 使用原 HttpOnly、SameSite、Secure、Path 和有效期策略；直接通过实例 serializeCookie 写入响应头，保证失败后移除 Set-Cookie 不会被延迟队列重加。安全头通过 Helmet 的原生 route options 或 reply.helmet 配置，业务策略仍归对应模块；不得直接启用所有默认项改变既有 iframe、SDK 或 HTTP 部署行为。

## OIDC 认证接口

协议 owner 为 Shared `access/oidc/{values,http,http-codec}`，安装在 Access，复用现有 Origin/CSRF、Cookie 和会话交付。所有返回禁止缓存；完整请求/响应沿用基础认证 16 KiB JSON 预算，禁止未知字段。

| 方法与路径（前缀 `/api/v1/auth/oidc`）  | 请求与结果                                                                                                 | 授权                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
| GET `/settings`                         | revision、label、issuer、clientId、clientAuthentication、hasSecret、bound、callbackUrl                     | 完整会话                          |
| PUT `/settings`                         | 期望 revision（首次为 null）、完整配置、secret keep/replace/clear、password → `{changed:true}`             | 完整会话与密码证明、事务 CAS      |
| DELETE `/binding`                       | revision、password → `{changed:true}`                                                                      | 完整会话与密码证明                |
| POST `/binding/start`                   | revision、password → authorizationUrl                                                                      | 完整会话与密码证明                |
| POST `/login/start`                     | rememberMe → authorizationUrl                                                                              | 来源准入、已绑定配置              |
| POST `/binding/finish`、`/login/finish` | code、state、issuer、error（code/error 二选一，其余可空字段显式 null）→ `{completed:'binding' \| 'login'}` | 原流程 Cookie；绑定还须原完整会话 |

公开`GET /api/v1/auth/login/options`返回`{captcha:{enabled,provider,hcaptchaSiteKey,recaptchaSiteKey},oidc:null|{label},hasPasskeys:boolean}`，由Shared Access严格解码。登录页只读取一次，不再请求独立OIDC provider/CAPTCHA接口。OIDC绑定即显示、解绑即隐藏，设置请求/响应不含enabled；Passkey以是否有注册密钥决定入口。展示元数据使用实例内常驻缓存，相关写入结束（包括提交未知）、管理员初始化及新模块实例使其失效；不缓存实际认证结果、凭据或权限。HTTP响应仍no-store，不把服务端缓存扩展为浏览器持久缓存。合并响应预算为32KiB，按原OIDC与验证码两份公开负载的JSON转义组合预留，不收紧合法名称或site key；其余认证请求/响应预算保持。

提供方只回调固定 SPA `/login/oidc/callback`；浏览器立即移除敏感查询并同源 POST 完成，不开放任意 redirect URI 或跨站 POST 豁免。完整认证依赖 openid-client Discovery、PKCE、nonce/state、ID Token 声明与数字签名；接口不接收可直接兑换本地权限的邮箱。配置变更与解绑撤销关联 OIDC 会话，重复、过期、旧配置及身份变化拒绝。密码改变、Passkey 强制政策和来源准入在最终写事务重新核验。

### 宿主诊断契约来源

`GET /api/v1/system/diagnostics` 的路径、响应与错误 schema 来自 Shared `system/diagnostics/http`，Fastify 安装同一 schema 的 JSON Schema 投影；双端使用 `readHostDiagnosticResponse` 严格解码。指标含 SQLite 排队、执行和提交的累计计数与总/最大毫秒耗时，名字和单位归 `diagnostics/values`，不输出 SQL 或参数。结构 schema 与跨字段细化共同校验，完整响应预算仍为16KiB；其它端点继续沿各自 codec，完整 OpenAPI/AsyncAPI 生成尚未接入。
