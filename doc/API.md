# 接口使用补充

本文说明手动接口、协议容量及失败恢复细节，面向脚本和客户端接入；普通界面操作见 [USAGE](USAGE.md)。完整类型/解码以 [Shared](architecture/SHARED.md) 和实际安装路由为准，业务与资源 owner 见 [Backend](architecture/BACKEND.md)，不把本文当作已生成的 OpenAPI。

所有接口使用当前版本格式；身份、同源写入、CAS、幂等意图及未知结果各按真实入口处理。旧阶段验收叙述不构成额外功能承诺；当前验收基线见 [E2E](testing/E2E.md)，详细历史见 [验证索引](testing/HISTORY.md)。

按接口选择：[连接与凭据](#连接与凭据开发接口)、[终端与 Workspace](#独立终端与-workspace-协议)、[文件资源](#独立文件资源)、[传输](#传输开发入口)、[集成](#mcpacp-与-browser)、[插件](#plugin-安装幂等与生命周期)、[授权与审批](#app授权与审批)、[协作](#rootchild-与协作)、[Memory/Artifact](#memoryartifact-与语义检查点)、[执行设置](#执行设置)、[Provider](#provider-与模型冻结)、[认证](#认证开发接口)。

## 连接与凭据开发接口

`/__targets-next` 使用独立后端/数据。完整 JSON 按 UTF-8 字节计量，包含外壳与转义；前端预检，后端超限返回 413 `body_too_large`。

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

`/__targets-next` 确认 Host Key、保存凭据后打开独立 SFTP 资源，不借 PTY 或 Agent 项目授权。当前开发页面仍只提供目录、stat/lstat 和 UTF-8 读取；独立 HTTP 文件接口提供文本保存、新建、重命名、删除、mkdir/rmdir；正式文件界面通过 Workspace 文件能力完成相应操作，两个入口分别核验权限和资源生命周期。

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

## MCP、ACP 与 Browser

模型先通过 `browser_targets_list({})` 读取 Browser Target 的 targetId、expectedVersion 和允许的 URL 模式，再调用 browser_open；目录不返回 CDP 端点或凭据，空列表表示尚未配置目标。已保存 ACP 先用 `acp_integration_list({})` 读取当前 App 中已启用、关联本 Run 所选且未被禁用的 SSH 目标的配置标识、版本、显示名和 connectionId，再调用 acp_integration_execute；不返回凭据、argv 或工作目录。前者需要 browser.read，后者沿用 integration.acp.invoke；只读目录不建立会话、不启动 ACP，也不代替执行审批。 Browser 上传同时需要 browser.interact 与 artifacts.read；截图和下载同时需要 browser.read 与 artifacts.write，浏览器风险仍为只读，创建宿主文件不提升为远端突变。

MCP/ACP 业务配置和 Browser/CDP 目标由对应插件的实例设置页提供，宿主通过统一 Settings Surface 挂载。CDP 目标使用插件配置文档 `{targets}`；目标 ID 最多128 UTF-8字节、端点4096字节、页面规则2048字节，完整配置沿插件配置协议预算。目标、备用端点和页面规则不另设固定数量门槛；每个目标至少有一个端点和规则，优先级为非负安全整数。只有管理员可改变 CDP 信任及 URL 规则，插件不声明 Agent 可编辑路径。保存绑定准确实例、包/配置修订与稳定 operationKey，冲突先重读，结果未知只重试原意图；不自动换键重放。

- MCP/ACP 通过插件逻辑实例提供服务。GET/POST `/api/v1/agent/plugins/apps/:appId/instances` 读取/创建实例；GET/PUT `/:instanceId/configuration` 读取签名 schema 与写入业务文档，写入包含 operationKey、expectedPackageRevision、expectedRevision、schemaRevision、documentJson。同一管理 owner 供人工和 Agent 使用，实例和当前授权分别校验。
- GET/PUT `/:instanceId/connection` 管理 Host 可信目的地，PUT 使用 expectedRevision、connector 与 credential。connector 为 none、http（endpoint/privateAuthorities）或 remoteProcess（connectionId/argv/绝对cwd）；credential 为 keep/clear/replace，响应只有 hasCredential，没有秘密。配置适用性取签名服务声明，保存不授予执行权；旧 `/api/v1/apps/:appId/integrations` 已移除。协议服务通过准确 Registry binding 消费当前连接；模型工具使用 instanceId，不接受旧 integrationId/version。MCP续接保留原requestState和按请求ID索引的响应map，内嵌请求按官方SDK公开schema校验；仅状态续接按SDK语义接受，不自动执行服务器请求。取消与内层权限保持独立，未知效果不自动重放。
- Browser 配置使用 `/api/v1/agent/plugins/apps/:appId/instances/:instanceId/configuration`，旧全局 `/api/v1/agent/browser/configuration` 已移除。宿主从可信调用来源绑定当前实例配置，不接受模型自报 CDP endpoint 或身份。CDP使用明确ws/wss、allowPlaintext与verifyTls；页面规则只允许固定origin，路径可使用末尾`*`，不支持任意host通配。按 priority 从小到大尝试端点；只有上一连接的清理已确认且失败为不可用才尝试下一端点，完整期限不重置。不启用宿主浏览器或 Workspace fallback。
- Browser 工具已有 open/close/snapshot/screenshot/console/navigate/back/scroll/press/select/wait/click/type/upload/download 的真实 CDP 路径。会话绑定原 user/App/Run、插件实例和运行代，不另设固定会话/任务数门槛；实例配置变化使原绑定失效，准确旧代退役等待在途操作后释放其会话，不关闭其它实例。配置解码校验端点、明文许可、页面模式及唯一目标，损坏配置被拒绝。快照节点数由调用者指定，不另设深度或队列门槛，完整字段按宿主单页传输预算投影，超页明确标记truncated；导航及已观察的 DOM 变更使引用失效；快照采集或节点解析期间失效也会拒绝，重新获取快照后再决策。建连完成后 Run 已取消时不发放会话。按键可作用于页面或同时指定 snapshotId/nodeRef 聚焦，支持导航/编辑键、KeyA–KeyZ、Digit0–Digit9、可打印 ASCII、F1–F12 与不重复的 Alt/Control/Meta/Shift 组合；失败也尝试释放每个键，结果未知不自动重放。navigate/back/scroll/press/select/click/type/upload 支持可选 settleMs（默认250ms，范围0–2000ms），仅做有界网络空闲观察；其正常超时不冒充动作失败，但断开/取消仍保留失败或未知结果。scroll 的 deltaX 可省略并取0。显式 wait 的 timeout/networkIdle 按调用者指定时长及实际操作取消信号执行，仍是严格等待。截图和下载按 Artifact 当前剩余空间校验，不另设8/16 MiB文件上限；CDP整体JSON/Base64传输仍受运行时字符串及远端浏览器技术容量约束。二者均生成 Artifact 并返回 ID/版本/hash；既有专项验证截图正文下载、hash/长度与浏览器PNG解码；上传引用现有 Artifact 的 ID/版本/SHA-256，读取保护覆盖真实上传。下载拒绝跳转，不自动开放原生下载。关闭仅收尾本次独立 context/CDP，下载策略也只作用于该 context；Run 结束释放资源，不退出共享远端浏览器。正式管理界面已消费当前契约。

## Plugin 安装、幂等与生命周期

以下插件管理路径以前缀 `/api/v1/agent/plugins` 表示；推荐引导的前缀为 `/api/v1/agent/onboarding`。请求须当前完整管理员会话，安装包签名、界面确认与模型参数都不能替代执行授权。完整类型和严格解码见 Shared `agent/plugins`。

### 签名包与来源

manifest 必须为 schemaVersion=4，含 id/version/displayName、compatibility、capabilities、intents、可空 frontendEntry/backendEntry，以及内嵌 contributions：

- app 为 null 或 {entry,uiContract,uiApiVersion}；完整 run 调度由 App 后端注册，依赖逐项绑定 packageId/publisherKeyId/minVersion/maxVersion。Run 固定准确实现，运行时能力经过 Registry 发现和绑定。
- tools/services 为布尔贡献，真实方法、schema 和说明由 setup 原子注册；ui 为 null 或版本化 contract/apiVersion 声明。settings 为 null 或签名 frontendEntry/instructions/schemaRevision/schemaJson/defaultsJson/agentEditablePaths；skills 每项为 {id,path}。
- compatibility 为 {host:{minVersion,maxVersion},backendSdk:number|null,frontendSdk:number|null}，当前 SDK 为4，entry 分别限定 frontend/ 与 backend/。Settings Surface 也需 frontendSdk=4；无前端贡献时为 null。

贡献必须处于签名 manifest，拒绝独立 agent.json。files.json 与 manifest 原字节使用 Ed25519 的 `NEXUS_AGENT_PLUGIN_V4\0` 域校验；旧包不在运行时转换。包/目录版本采用规范小写 SemVer，不接受 v 前缀、metadata、前导零或不可精确比较的数值；完整包、发布者及每个精确依赖均须当前受信。目录格式自身仍为 schemaVersion=2，与包 manifest 版本分别演进。

原包最多50MiB、展开文件及容器200MiB，拒绝链接、特殊项、路径越界、重复及未列文件，元数据和填充也计入容器预算。Artifact stage 按原 Artifact 总空间准入；受信 publisher 不另设固定条数门槛。暂存清理只处理无引用确定缓存，保留不可变版本、待更新/退役引用及未知证据；删除文件确认后才删除行。重启核对 staging 字节/hash，不自动安装或重派代码。普通插件管理请求256KiB、完整响应32MiB；核心 RPC/IPC 沿 Shared plugins/values 的完整消息预算，各专用请求使用所属预算。

`GET/PUT /repositories` 管配置 CAS，PUT 为 {expectedVersion,repositories:[{url}]}，首次 version=0；规范 HTTP/HTTPS URL、每项4096bytes，集合沿完整请求预算校验，拒绝凭据、fragment、重复。`GET /official/catalog` 与 `GET /remote/catalog?repositoryUrl=...` 返回 schemaVersion=2 目录，包身份使用 packageId，含 compatibility 与 contributionKinds。每项可选 `localizations:[{locale,displayName,description}]`；语言标签规范化且不得重复，市场按当前本体语言精确匹配、同语言回退，缺译使用原文；翻译只影响展示与搜索，不改变签名包身份。原始目录1MiB、完整响应8MiB，发布者和包不另设固定条数门槛；目录公钥不自动形成信任，官方源核对固定发布者公钥。

目录按源独立加载并增量展示；单源失败保留同配置版本的旧页面快照并标 stale。服务端仅按原身份/配置版本/URL 合并在途读取，没有持久目录缓存、定时轮询或新的安装进度事件。配置变化/注销后的晚结果不发布；来源和包的错误各自归属。下载最多50MiB、最多5次重定向、整体120秒，stage 仍受自身60秒期限；合法管理员内网 HTTP 来源保留，不转发宿主凭据。

### 准备、安装与组合

| 方法与路径                              | 输入 / 结果                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| POST /official/stage、/remote/stage     | {packageId,publisherKeyId,version}，remote 另传 repositoryUrl；返回已验证 stage                                |
| POST /official/prepare、/remote/prepare | 同 stage 输入；返回 {repositoryVersion,target:{repositoryUrl,stage,expectedInstallationRevision},dependencies} |
| POST /install-plan                      | {initialization,repositoryVersion,target,dependencies}；返回 {installation,binding}，非 App 包 binding=null    |
| GET /packages                           | {installations,retainedPackageIds}；当前包以 user/package 为单位                                               |
| POST /packages/install                  | {stageId,expectedVersion}；返回 {installation}，不创建 App                                                     |
| GET /apps/bindings                      | {bindings}，每项为精确 App 组合                                                                                |
| POST /apps/compose                      | {packageId}；返回 {binding}，普通新组合禁用且空授权                                                            |
| POST /apps/:appId/restore               | {packageId}；显式复用已移除的原 App，返回 {binding}，禁用且空授权                                              |

ExactRef 为 {packageId,version,packageHash,publisherKeyId}。prepare 的 dependencies 为 staged {kind,repositoryUrl,stage,expectedInstallationRevision} 或 installed {kind,installation,manifest}；stage 必须 verified/installed 且 manifest/publisher 非空。install-plan 的 target 为 {repositoryUrl,stageId,expectedVersion,expectedInstallationRevision,package:ExactRef}；staged 依赖加 kind，installed 依赖为 {kind:'installed',expectedRevision,package:ExactRef}。普通市场初始化值仅 disabled。

prepare 解析目标签名 App 声明的全部依赖，优先原来源，再查配置源；符合发布者/版本区间的已安装可信依赖可以离线复用。执行先核对全部 stage、包修订、来源配置版本、信任与兼容，再安装依赖、目标，最后创建/复用 App 绑定。没有持久安装计划、操作键、状态查询或刷新恢复账本；失败丢弃计划并重新 prepare。此前成功安装的真实包保留，不能将多个包提交解释成原子回滚。

AppBinding 为 {appId,executionRevision,uiRevision,app:ExactRef,tools:ExactRef[],ui:ExactRef|null}。同一包可贡献多个角色，同一工具包可供多个 App 引用；每个执行实例和数据 namespace 仍按 user/App/package 隔离。公共 App.definitionId/definitionVersion 是真实签名 App 包 ID/SemVer；内部执行声明绑定用户与全部精确 app/tool 引用，不用虚构版本表示组合。公共声明目录每个当前 App 来源包只返回一项，App.capabilities 则为其实际执行组合的能力并集。

`GET /onboarding/recommended-plugin` 离线返回已有安装，或读取官方候选。`POST /onboarding/recommended-plugin/install` 接受 {kind:'existing',appId,expectedRevision}，仅返回 {kind:'existing',installation}；或 {kind:'plan',plan}，plan.initialization 必须 declared_grants 且目标为固定官方来源/ID/发布者，返回 {kind:'installed',result:{installation,binding}}。推荐确认可初始化执行包的声明授权，UI-only 包能力不扩大执行权限；已有绑定复用不重新启用或恢复 grant。失败重新 prepare，不能提交旧计划或自动恢复权限。

### 更新、卸载与运行实例

`POST /packages/:packageId/prepare-update` 使用 {expectedRevision,stageId,expectedStageVersion}，准备结果含当前 installation 及精确 dependencies:[{package:ExactRef,installationRevision}]；`POST /packages/:packageId/update` 在同样字段上提交该 dependencies。执行前复验每个准确依赖与全部受影响 App；依赖改变需重新准备，不能按旧区间静默换包。待生效目标持久保存于真实包更新记录，不是安装计划账本。

`POST /packages/:packageId/cancel-update` 接受 {expectedRevision}，成功返回 {installation}；须处于 draining、有待生效目标且原运行资源已关闭。取消后保留旧安装版本，不自动启用 App 或恢复授权。更新涉及的 namespace 已提交实际数据格式变更时，迁移25的 data_migrated 围栏禁止取消回旧代码，快照保留该事实。

执行包更新先停止新 Root/Child 准入，排空原绑定调用，再切换包/受影响 App 声明；executionRevision 和 uiRevision 各推进。旧调用继续绑定原实例/修订，不能由新包代答。纯 UI 包更新只推进 uiRevision、使旧资源 grant 失效，不改 executionRevision、执行声明、Run 或 grant。`DELETE /packages/:packageId` 为 {expectedRevision,clearData}；仍有活动 App 引用时拒绝。已经迁移数据而无法取消的 draining 包，须先移除全部引用 App，再以 clearData:true 清除该包全部 App namespace 与待更新记录；false 仍拒绝 draining。其他包数据保留。

App 卸载仍为 `DELETE /installations/:appId` {expectedRevision}；`POST /installations/:appId/cancel-retirement` 按当前 expectedRevision 操作。先登记 draining/围栏，再独立等待 Run 与所有对应包 runtime；失败保留事实及 unknown，不虚报 removed。取消不自动启用，迁移数据已提交后不允许取消退役；重启不重派旧 Run 或未知代码。

后端入口在独立 Node 进程运行，只授予原物化包目录只读文件权限，禁子进程/Worker/addons、清宿主环境；不承诺 OS 或网络隔离。SDK4 导出 definePlugin，setup 注册版本化 App/工具/服务与 dispose/onReady；调用时取得 Host 派生的 identity、scope 和 signal。目录 discover/describe/bind/invoke、模型、checkpoint、内容、配置、私有数据及受管传输各有明确能力。实际上下文类型以 Shared backend-sdk/runtime 为准；不保留旧 activate/agent/execution 五阶段接口，也不叠加固定实例数或等待数限制。释放分别确认真实进程退出、Host 任务和目录清理。

`GET /installations/:appId/runtime` 返回该 App 的聚合观察，优先 unknown→opening→active→closed，再按时间/包排序；`GET /runtime/:instanceId` 读取精确实例。`POST /runtime/acknowledge` 仍传 {expectedRevision,instanceRevision,instanceId,confirmed:true}，按原 instanceId 定位包；确认不自动启动、不证明远端效果回滚。需先完成服务重启与 Linux /proc/journal 目录对账，无本地绑定且原实例可确认才解除围栏。旧 opening/active 保守转 unknown，不自动激活；每 user/App/package 保留最近128条从未 unknown 的 closed 诊断，未知和曾未知证据不裁剪。真实故障与已有 unknown 准入拒绝分别处理，不使无关 App 因旧围栏发生新故障。

### 工具、SDK 与正式聊天 UI

全部模型工具由精确签名工具包提供名称、说明、schema、默认值、模型参数适配及结果展示；Host 不注册默认模型工具。模型名由 packageId/localName 派生，版本固定为 packageId@version#packageHash。工具与审批观察携带可信 identity：plugin 精确 packageId/packageVersion/packageSha256/name，或 Host operation；历史退役动作仅用于审计，不恢复可执行入口。

App 注册 handler 持完整 run 循环，目录发现、工具绑定、并行分组、模型调用、历史和压缩由插件决定。Host 仅对真实 Operation、固定模型派发、预算、审批及资源完成执行可信准入；服务方法不自动成为模型工具。工具 schema 与说明由贡献者交付，模型 wire name 只是本轮曝光映射，不能代替准确 binding。

后端 SDK 的 perform(operationKey,input) 交付固定受管领域动作；directory.invoke 使用准确 binding 和稳定 operationKey。两者均复查 Host 派生 scope，保留真实子操作审批、整批预检、路径冲突、资源及未知结果。模型工具不能绕过宿主能力扩大授权。run.checkpoint/readCheckpoint、content 分块和原意图回执用于恢复，不重跑整个 App 循环猜测结果。详细协议见 Shared backend-sdk、registry、app-runtime 和 run-context。

Skills 放在 skills/<name>/SKILL.md，manifest id 使用包 namespace，例如 sample.tools.developer；单篇按实际协议读取容量验证，不设固定篇数门槛。frontmatter 的 allowed-tools 不授予权限。目录按当前精确包版本/hash 读取，正文为不可信内容；需要 context.read，仍走原工具账本，撤权/升级拒绝旧读取。

正式 Host 所有 App 通过 PluginAppFrame 加载精确绑定的签名 UI，没有宿主聊天回退；独立插件仓 `plugins/nexus.ui.chat/src` 持有完整聊天源码和构建，不依赖本体快照。descriptor 绑定当前 UI package/uiRevision、原会话和30分钟 grant，frontend 静态资源每项16MiB，sandbox='allow-scripts allow-forms'、CSP/no-store；JS 表单事件可用，form-action 'none' 仍阻止原生外送；backend 与签名元文件不可读。`GET /installations/:appId/descriptor` 返回 sdkVersion='4'/protocolVersion=4；SDK 地址为 `/sdk/frontend-v4.mjs`，运行实现由前端 `features/agent/plugins/sdk` 构建，后端交付同一产物。公开模块类型归 `@nexus-terminal/shared/agent/plugins/frontend-sdk`，插件将 `nexus:frontend-sdk` 外置映射到该 URL，不引用本体私有源码，也不安装独立前端 SDK 包；不提供旧版路径或协议兼容。

`POST /installations/:appId/frontend/rpc` 接受 {grant,envelope}，protocol4 的 nonce/id/seq/method/App 必须关联。前端完整JSON8MiB+1KiB，核心子方法/后端IPC仍512KiB，不叠加固定等待数量门槛；普通 SDK 请求沿30秒等待策略，真实任务与取消仍由原 owner 追踪。Shared frontend-events 组合原核心 RPC、scope/workspace-http 和 plugins/ui-http；后者具名提供 Run 用量、线程工具列表/详情、Memory 列表/读取/审核、Artifact 列表/元数据/创建/保留/删除/关联/范围读取，结果含可信 appId，不提供任意 URL/HTTP 请求。

Host UI bridge 仅投影安全 environment/主题/目标/偏好，并提供版本化 UI checkpoint、可信确认、资源关闭、任务通知、Artifact 上传/下载及 opaque key 附件选择。checkpoint 按 App 与实际 UI 包/发布者隔离，Host 不解聊天草稿字段，UI 自行严格解码。认证、userId、浏览器存储、ConnectionSummary、HTTP/WS 由 Host 持有。上传使用 `PUT /installations/:appId/frontend/artifacts/:artifactId/content?grant=...`、If-Match 与原内容类型/流预算，原 Artifact owner 在每块及写事务核验。确认取消不派发；已提交写入失去回执仍为 unknown，保留原意图，不自动换键重发。

页面共享 `/ws/agent-runs`，subscribe 使用 {type,subscriptionId,generation,source}，source 为 run（含 access/cursor）、run-events（含 grant/after）或 memory（含 access/threadId）；access 是 session/appVersion 或 plugin/grant。data 帧包含 subscriptionId/generation/revision/value，ACK 同身份及 revision，unsubscribe 只停止原代际。Run 正文/状态页与事件页按各自 decoder 校验；Memory 发 epoch/revision 失效通知，再具名读取正文。Host 有界接纳后 ACK 后端，UI 渲染确认后推进游标；重连只读补齐，不能重放变更。插件 SDK 的 runs.subscribe 不再500ms轮询，仍等待异步回调、退订和 close 收敛；callback 不等待自身关闭。

### 数据 namespace、迁移与消息

普通 `GET/PUT/DELETE /installations/:appId/data/:key` 与 UI storage 解析当前 UI package namespace；HTTP 写入的 expectedRevision 使用 descriptor/binding 的 uiRevision。授权、包选择和存储访问在同一事务核对当前 UI 绑定；SDK 内部包身份取自当前 UI grant，不接受调用方另选包；不能用普通入口访问其他执行包或独立 App 主包的 KV。后端 storage 解析实际执行 package。UI 是 App 主包时使用原 App KV，否则写 extension namespace。同一包在不同 App 的数据彼此隔离。key128bytes，单值按现有512KiB RPC中JSON字符串的实际编码容量校验，JSON文本 null 与删除墓碑 valueJson:null 不同；读返回 {value}，写使用 expectedRevision/expectedVersion/operationId，创建 expectedVersion=0。原事务复验当前身份、启用/信任和 CAS；每 namespace 不另设有效键数量或正文总量门槛，删除仍保留版本墓碑。

`GET /installations/:appId/data-snapshot` 返回 {appId,revision,items:[{packageId,key,version,valueJson,updatedAt}]}，读取 App 主包和保留旧依赖的全部 namespace 有效键；超过单次52MiB完整传输预算时明确拒绝，不截断。可使用 `GET /installations/:appId/packages/:packageId/data-snapshot` 独立读取一个 namespace，响应形状相同。

排空并保持 draining 后，`POST /installations/:appId/migrate-data` 为 {expectedRevision,operationId,items:[{packageId,key,expectedVersion,valueJson}]}。输入涉及的每个 namespace 必须覆盖其全部有效键并逐键 CAS，其余 namespace 原样保留；新增未见键用0，删除用null，同名墓碑必须使用原版本。空 items 在 App 仍有任何有效键时拒绝。单次输入沿52MiB完整传输预算，逐值核验其后续RPC读取的编码容量，不另设1024键或每namespace 8MiB准入；数据、墓碑、安装revision与不可变回执同事务。实际值变更会标记本 App 引用中对应包的待更新事实，其他 namespace 和仅重提相同值不触发包更新围栏。迁移提交后不能取消 App 退役，unknown 保留原意图并只读核对，不重跑插件代码；后续 namespace 使用新快照修订和新的明确操作意图继续。

`POST /installations/:appId/delete-data` {expectedRevision,operationId} 只允许 removed App，清除全部包 namespace 正文、旧操作正文、grants、执行覆盖及 MCP/ACP 配置/凭据，推进墓碑/修订；聊天、Run历史、Memory、Artifact和必要未知证据保留。单键写入、迁移与清除仍有各自幂等结果；每键只保留最新有效回执正文，后续修改使旧回执 version_conflict，不用旧结果覆盖当前状态。版本耗尽拒绝需递增的新变更，已确认回执与读取按原规则保留。

跨 App intents 仍在 `/api/v1/agent/apps/:appId/plugin-intents` 创建/列表/撤销及附件读取：双方当前启用受信且有 app.intents.exchange，附件另需双方 artifacts.read；接收 intent 必须由签名 App 声明。创建为 {operationId,receiverAppId,intentId,inputJson,artifactIds,confirmed:true}，正文64KiB/32层、最多16个发送 App 自有 ready 文件、有效期10分钟；禁止保留的凭据/私有上下文字段，不能据此检测任意字符串秘密。消息不创建 Run、不执行模型。

消息冻结原 App/政策修订，重授不复活旧回执；创建未知保留同 ID/同输入，仍按当前授权核对。HTTP请求/RPC512KiB、接收列表16MiB，limit默认50/最大100，只在最终可见项上限流；RPC编码超限需减小limit，不截断正文。SDK附件 readRange 每次最多128KiB，关联 receipt/Artifact/范围/Base64；HTTP content 支持单段 Range，实际流逐块核对权限/版本。失效不自动撤销仍保护源文件的原 grant，显式撤销与读取 lease 分开收尾。

上述内容描述本版源码及外部契约；迁移及真实包/实例/绑定/数据快照归属见 [Agent 架构](architecture/AGENT.md)。正式浏览器、独立包发布、官方新签名包、完整迁移恢复、弱网/撤权与故障组合的验收状态见 testing，不能沿用旧SDK或旧包格式的历史 PASS。

## HTTP 来源与认证

正式 Agent 来源拒绝保留 `error.code=CSRF_REJECTED` envelope/request ID；通用规则见 [安全与认证](USAGE.md#安全与认证)。

后端状态接口与开发前端源码已接入，正式Agent源码已使用Shared，部署切换另行执行。DEV 路由 `/__agent-next` 使用已安装插件的 App UUID，支持创建 Thread/Run、读取/取消 Run 和事件分页；新 Run 初始 pending、可取消为 cancelled；完整状态联合已包含 running/completed/failed/unknown，模型执行须在执行设置显式启用，并满足实际App授权和预算。真实浏览器行为仍待验收，DEV不替代正式Host的功能验收。

| 范围 | 限制与语义                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 认证 | 使用新 Access 会话，只允许管理员 userId=1；不接受客户端自报身份                                                                 |
| 名称 | name/title 原始 UTF-8 ≤128 bytes，保存前 trim                                                                                   |
| 输入 | prompt 沿创建 Run 完整 JSON ≤128 KiB，不允许全空白，保留原文；创建 Run 完整 JSON ≤128 KiB，其余 JSON ≤16 KiB                    |
| 响应 | 完整 UTF-8 JSON ≤32 KiB，包含分页外壳及转义                                                                                     |
| 变更 | 创建/取消使用 UUID Idempotency-Key；同 key 同输入重放原提交快照，内容不同报冲突；取消带 expectedVersion，版本不一致报冲突       |
| 分页 | after 默认0，limit 默认50/最大100；nextCursor 为最后事件序号，空页保持传入游标；重复/未知 query 拒绝                            |
| 前端 | Targets/Agent 共用 Auth next 的公开认证 client；切 scope/run、登录或卸载取消旧等待并失效 generation；事件按 runId/sequence 去重 |

同 App/Thread 只允许一个活动 Run（pending/running/unknown 均占用名额）；明确完成或失败后才释放。网络失败、协议异常或提交结果未知不能证明未写入，重试保持原 key 和输入；改变输入才形成新意图，不自动生成新 key 重放。version_conflict 显示冲突并尝试读取最新 Run，不自动用新版本继续取消；已完成的 Run 拒绝取消，unknown 允许有版本条件地取消但不保证远端回滚。安全失败只返回 code；非 JSON、未知状态/错误码或错误 shape 显示协议失败，不伪造成功，也不返回 prompt、hash、秘密或技术 cause。开发入口与剩余项见 [下一阶段方案](PLAN.md)。

## 项目目录与突变占用

- 当前Agent移除 ssh_session_open/list/close 和 sessionId，使用独立 Remote 任务及当前 Run 的 Job/取消管理，不继承 shell cwd/env，不共享 Root/Child 活跃连接。
- project_directory_bind v2 参数 connectionId/directory；read 参数 connectionId/可选 path；clear 只有 connectionId。目录绝对路径沿 Remote Files 的 4096 UTF-8 bytes，read 仅允许绑定根及其子目录，不另设深度门槛。未绑定返回空上下文；目标 version/fingerprint 变化报冲突，重新绑定须独立批准。绑定按 Run 独立保存，删除 Run/connection 清理，不沿用旧 Thread 共享。
- 从绑定根到选定子目录读取不区分大小写的 AGENT.md/AGENTS.md，逐页读取完整正文，不另设四份／每份8 KiB门槛，拒绝链接和越界；返回 path/scopePath/text/sha256。指导是不可信工具数据，不自动变为系统提示、Shell cwd 或权限；bind/clear 需要当前 file.read 与单次批准，read 需要当前只读授权。
- Agent 文件/Shell/Job/ACP/Docker、普通 Files/上传/复制移动/归档/权限修改与 Workspace Docker 按 lowercase host+port 共用持久独占占用。不同连接ID、用户或凭据不能绕过同一文本 endpoint；跨主机复制/移动原子占用两端。冲突直接拒绝，不设跨endpoint数量上限，不自动排队/重试；同资源已有 Files 队列保留。
- 结果及清理确认才释放，unknown/清理失败和重启后的遗留占用保持 blocked；先只读核对，不按 TTL/重启/改连接自动放行。管理员可通过机器突变恢复入口记录独立证据，再单独 CAS 解除；不能确认原生产者和关联资源已停止则继续阻断。DNS/IP别名无法准确合并；交互PTY、外部进程及远端派生进程不受数据库锁隔离。执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 行为待专项验收（见 PLAN）。

## App、授权与审批

正式 Agent 设置已独立安装“应用与授权”和全局目标禁用名单：从插件市场安装后取得真实实例，通过实例 UUID 启停；选中实例分别读取/保存能力授权与执行策略。授权限于当前服务端声明，能力项只控制启停；目标范围由全局禁用名单和本次 Run 的目标选择统一收窄，不再在每个能力项内重复选择。授权与策略各自绑定原修订，切换实例撤销原界面请求，不沿用新版本自动提交。应用策略可继承全局值或设置更小的上限；移除覆盖即恢复继承，不使用旧自动增额字段。

全局禁用名单保存完整连接集合（最多50项）和本次原因，原因必填，清空名单也须填写；保存会给全部条目应用本次原因。授权不能覆盖禁用名单；全局范围与“聊天中选择的目标不绕过 Host 阻断”说明集中在标题旁的信息提示中，不再占用独立正文行。每个编辑区域独立只读恢复；冲突或结果未知后先点对应“重新读取”，读取失败不解除写入阻止。此批仅完成源码/静态适配，按D17留最终远程Actions E2E验收。

Agent 没有内置应用。App 与能力声明唯一来自当前账号安装的签名插件；新环境的 App 与声明目录均为空，读取目录不产生写入。开启 Agent 总开关时，尚未安装 Nexus Agent 则弹出官方插件安装确认；取消、目录读取失败或安装失败均不开启。已经安装则复用现有安装，不重复下载。通过此引导新装成功时，插件已启用并获得当前包声明的全部能力，文件/Shell 能力授权全部 SSH 目标，然后才开启总开关。已安装复用不重新启用或恢复撤回的授权；普通市场安装、升级不自动授予能力。目标禁用名单、Run 目标选择和批准策略仍生效。声明 ID 与 App 实例 UUID 分开，重启不恢复撤回的权限；治理操作缺失必需政策记录时安全失败，不静默补权限。

官方 Nexus Agent 1.0.2 提供 operations 与 developer 两份签名技能，分别用于运维排查和代码开发。两份说明以“确认目标、检查、授权范围内修改、验证、报告证据”的精简流程组织；权限和审批仍由 Host 执行。已安装旧版本需在插件市场显式升级后才能使用新说明，不会因仓库发布而自动替换当前安装。

安装确认弹窗的安全提示与按钮分开显示；桌面安装与取消并排，手机安装和取消各占一行，按钮文字保持单行。

| App / 目标管理接口                      | 操作                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/api/v1/agent/app-definitions`     | 读取当前账号已安装插件的声明；客户端不能自报 capabilities、版本或执行状态                                                                                                            |
| GET `/api/v1/agent/apps`                | 读取已安装插件实例列表，无手工创建接口；列表最多 1024 项，超限拒绝而非截断                                                                                                           |
| GET/PATCH `/api/v1/agent/apps/:appId`   | 读取实例；PATCH `{enabled,expectedVersion}`，CAS 冲突先读取最新实例；禁用不删除历史，启用不恢复旧 Run                                                                                |
| GET/PUT `/api/v1/agent/target-denylist` | 读取/全量替换全局 Agent 目标拒绝名单；PUT `{connectionIds,reason,expectedRevision}`，初始 revision=1，最多 50 个可信 Targets ID，reason 非空且最多 512 Unicode 码点/2048 UTF-8 bytes |

App 返回必填非空 definitionId/definitionVersion、capabilities、enabled/version、毫秒 createdAt/updatedAt 与 `executionState:governed`；enabled 只表示管理准入，不代表 running/healthy。App 列表/声明完整响应最多 8 MiB。grant 定义只显示实例当前真实声明；来源已卸载的实例拒绝授权与创建 Run（403 `app_disabled/capability_undeclared`）。

禁用或声明变更在同事务失效未决审批、围栏活动 Run/步骤，再由执行 owner 收尾。目标集合变更同事务围栏所有旧 App Run：当前 Run 未绑定单个目标，采用保守取消；仅改拒绝原因不取消 Run。取消不证明远端副作用回滚。拒绝条目保留到显式移除，目标删除后仍保留 ID 防止复用绕过；加入时经 Targets public 读取身份、提交时核对版本。denylist 的 changedAt 对外使用 Unix 秒，App/Run 时间使用毫秒。普通 SSH 不受 Agent denylist 影响。审批创建/决议复查当前声明、启用、grant、拒绝名单及目标版本；旧批准快照不是新执行许可。写入/清理结果未知时读取现状，不盲目重发或恢复运行。

当前后端 Agent 管理员仍使用 Access 登录会话（userId=1），正式前端源码已对接 Shared；具体发布版本与本地后继变更的验证范围见 testing。新建 App 的 grant 默认**为空**，策略修订从 0 开始；不因 capability 出现在定义列表、选择 Full Access、模型答复或 SSH 连接存在就自动批准。普通 SSH 的技术通道与 Agent 授权彼此独立，Agent 还须在每次真实工具执行前复查目标身份、当前 Run、ToolCall 和授权版本；工具派发沿原 ToolService 受管管线，默认 driver 组织模型步骤，RunExecutionOwner 持有完整任务生命周期。

| 已安装的 HTTP 路径                                       | 当前语义                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/PUT `/api/v1/agent/apps/:appId/grants`               | GET 返回当前声明的能力定义、当前 grants 与 policyRevision；PUT 带 `{expectedPolicyRevision,grants:[{capability,scope}]}`，全量替换、同事务 CAS，撤权使未决审批失效；目标 scope 为 `{kind:"targets",targets:{ssh:{mode:"all"}}}` 或 `{kind:"targets",targets:{ssh:{mode:"ids",ids:["1"]}}}`，非目标能力用 `{kind:"global"}` |
| GET/PUT `/api/v1/agent/apps/:appId/execution-policy`     | GET 返回 `{version,overrides,effective}`，PUT 带 `{expectedVersion,overrides}` 全量 CAS；秒/字节/条数必须是正安全整数并满足硬上限。effective 同事务消费全局动态设置与 App 缩窄覆盖项；Root 创建冻结实际值                                                                                                                  |
| GET `/api/v1/apps/:appId/approvals/:approvalId`          | 读取当前可见审批（含请求、截止秒时间、状态、版本、风险摘要），不存在/非本人返回 404                                                                                                                                                                                                                                        |
| GET `/api/v1/apps/:appId/runs/:runId/approvals`          | 按 `after` UUID 游标读取此 App/Run 的审批页 `{items,after,nextCursor,hasMore}`，省略 after 从首页开始；每页最多64条，hasMore 时继续使用 nextCursor；到期或终止 Run 的未决审批于读取事务内刷新，历史总数不受1024条限制                                                                                                      |
| POST `/api/v1/apps/:appId/approvals/:approvalId/resolve` | 发送 decision 为 `approved` 或 `denied`、operationHash、expectedVersion、可选 feedback，并附 UUID `Idempotency-Key`；在同一事务复查 App/Run/operationHash/policyRevision/inputRevision/TTL 后 CAS 决议；同 key 同内容重放，变更内容冲突                                                                                    |

授权目标 ID 最多 256 个、每项最多 128 UTF-8 bytes；grants 请求 JSON 上限 512 KiB，其余治理请求 16 KiB，完整响应最多 8 MiB（包含转义与 envelope）。审批历史按稳定ID分页，每页最多64条并核对完整编码容量，保留所有历史；Workspace 的 `agent.approvals.list` 必传 `after:null` 或上页 nextCursor。聊天界面初次自动读取各页，后续经原WS分批合并并按时间排列，不新增轮询或改变审批卡片；断线重新扫描历史，扫描期间的并发决议通过后续扫描补齐，旧版本不覆盖较新决议。无效类型/未知字段拒绝 400，身份失效 401、非管理员 403、不存在 404、版本/审批漂移或幂等内容冲突 409；不可用/未知提交结果须保留原意图并读取现状，不得自行换 key 自动执行。审批摘要的 toolName 最多256 UTF-8 bytes，toolVersion 按精确包身份预算最多258 UTF-8 bytes，summary 2048，Shell／ACP 的 summary 内含总长仍不超过 2048 bytes 的命令预览与截断标志，审批摘要不附带完整参数；聊天卡片的认证单调用详情可读取原模型参数，未注入宿主凭据；可选 feedback 非空且最多 2000 UTF-8 bytes。审批请求 TTL 600 秒，以实际事务决策时刻核验，超过时限不能批准或消费；已提交审批后的事件发布失败返回未知结果，先按原审批身份读取现状，不新建替代审批；Run 取消已提交而审批失效清理失败时返回 `operation_unknown`，先读取 Run 与审批现状；`approved` 仅表示用户决议已提交，**不是**工具已派发或远端任务已成功。

步骤与工具审计面板、审批中的审计跳转及原审计专用步骤/工具详情和事件 HTTP 接口已移除；聊天卡片仅保留按需调用详情。聊天工具卡片仍通过线程工具列表读取当前状态；展开单个卡片时按需读取该次调用的完整模型参数，以缩进 JSON 显示并保留换行及长文本滚动。失败时同时显示该次调用已记录的具体安全原因与错误码；远端资源不存在（`tool_resource_not_found`）与连接不可用分别提示，远端权限拒绝（`tool_remote_permission_denied`）与 App 未授权、参数错误分别提示。遇到路径不存在时可核对已知父目录中的实际名称；只读工具的确定输入/资源拒绝反馈给模型继续处理，不自动重放原操作。未记录具体原因时明确说明，结果未知时先核对远端状态。读取失败可在卡片内重试，重试只读取详情，不再次执行工具。收起卡片或切换界面取消等待，运行状态变化后已展开的卡片重新读取。详情只向原登录用户开放并绑定 App、Run 和工具调用，不返回宿主注入的认证信息或原始远端结果；Token 用量、审批、Run 状态和正文流继续使用原接口。内部步骤与工具状态及变更日志用于执行恢复和备份一致性校验，不对外提供单独审计查询。

每轮模型请求只提供当前 App 已声明、已授权的工具，并与 Child 继承白名单取交集；需要 SSH 目标的工具在没有可用所选 SSH 连接时不提供，denylist 中的目标不计入可用选择。目录只是调用提示，实际工具派发仍重新核对权限、目标和审批。历史已完成调用可以保留在上下文，不因该工具随后从当前目录移除而被当成无效历史。

模型工具说明按动作区分用途：浏览器各操作说明所需会话、快照引用及后续步骤，项目目录绑定／规则读取／清除与 MCP 工具／资源／提示分别描述。Shell 类型、前后台模式、Job／Docker／删除动作、Child 角色／依赖／等待模式和 Browser 等待模式会在模型参数中列出既有合法选项，执行入口仍按实际字节与语义校验；未调整现有权限、容量或审批流程。file_write 新建的 expectedSha256 必须显式传字符串 `"absent"`，不能省略字段。

后端工具账本现已记录独立操作内容修订、状态修订及状态事件；审批读取真实操作，单次消费与派发意图同事务提交。目录、文件、Shell 和 Docker 工具已有账本与审批消费者；模型派发须 governed 准入与冻结预算，历史批准不可复用。取消/重启将未派发操作关闭、已派发操作标为 unknown，不自动重试。

后端 Agent 状态接口（App/Thread/Run、线程工具列表及 Run 事件页）在异步结果交付前再次核验管理员会话；401/403 或交付失败不证明刚才的创建/取消未提交。写入结果不明时保留原输入与 Idempotency-Key，登录后只读核对，不自动重放。

已派发工具不能报告确定取消；Run 取消或终结后，晚到工具结果不能覆盖账本围栏。存在未结或 unknown 工具时不能报告 Run 成功。启动恢复同时核对模型步骤与工具操作，即使没有模型步骤也保留工具的未知副作用；既有专项已核对前台取消、后台取消/撤权和重启恢复的部分真实链路，其余故障场景见验证清单。

当前原执行链使用 governed 政策，默认执行关闭；目录、诊断及文件只读工具的可信检查和结果反馈已接线；file_write/patch/move/delete 的审批生产者、可取消等待、单次消费与结果反馈已接线；Shell/Docker 与当前 Run 内后台 Job 已接线；ACP调用、独立权限等待/消费、安全HTTP观察和直接 Child/协作已接线；Run-local项目目录与跨Run持久突变占用已接线，用户通知归 Operations；审批只由真实工具动作产生，POST resolve 不会虚构可批准任务。核心持久Settings已接线；外围集成/工具、Settings、上下文及 blocked 恢复均有实际消费者；管理页面已消费当前 Shared；静态接线不等于执行已获得授权。源码设计见后端治理章节，当前行为覆盖与未验范围见验证记录。

首工具 machine_connection_list 参数只能为 {}，只返回持久选中且当前授权、未在 denylist 的 SSH 连接 id/name/host/port/username，不返回凭据或非 SSH 项。参数最多 16 KiB、结果最多 256 KiB，超限失败，不截断。结果确认持久后才回送模型；工具步骤不结束 Root，最终 stop 才可成功。当前执行须 governed 准入；DEV 默认 connectionIds 为 []，正式 Host 提供目标选择与多步呈现，行为范围见 testing。

`machine_diagnostics_read({connectionId})` 保留当前 v2 只读诊断协议。文件工具统一使用 v3 批次输入：`file_read({connectionId,paths,offset?,maxBytes?})`、`file_list({connectionId,paths,after?})`、`file_inspect({connectionId,paths})`。结果为逐项 `items`，读取预算不足时 `nextIndex` 指示剩余路径。file_read 的 offset/nextOffset 为 UTF-8 字节位置，每页默认/最多 32 KiB，最少 4 bytes；页边界不拆分码点，pageSha256 校验本页，只有从零完整读到文件尾才提供完整 sha256。元数据 fingerprint 不是跨页原子快照。file_list 每页最多 200 条，名称词典序的 nextAfter 用于续读；遍历目录只保留当前页候选，不缓冲完整目录。file_inspect 逐页遍历目录并流式哈希，不另设文件／目录总数、深度、单文件或整树大小门槛；返回内容 hash 与元数据指纹，不返回文件正文。

`file_search({connectionId,path,queries,maxResults?})` 一次遍历处理区分大小写的多个字面量查询，返回 queryIndex。maxResults 默认 20、由调用者指定，行和 UTF-16 列从 1 开始，超出结果数标记 truncated；搜索不另设文件／目录总数、深度、整树或单文件大小门槛，非文本跳过。没有旧 regex/glob/contextLines 参数。

写入工具为 v3：`file_write({connectionId,items:[{path,content,expectedSha256}],onError?})`；`file_patch({connectionId,path,expectedSha256,edits:[{oldText,newText}]})`；`file_move({connectionId,items:[{path,destinationPath,expectedFingerprint}],onError?})`；`file_delete({connectionId,items:[{path,expectedFingerprint,scope}],onError?})`。单条也传数组；onError 默认 stop，可选 continue。整批参数沿完整插件 RPC 请求预算，路径统一最多4096 UTF-8 bytes，不另设单项写入／补丁片段配额。新建 expectedSha256 为 absent，替换及补丁使用完整文件哈希；oldText 非空且唯一，edits 逐次应用于同文件。删除 scope 为 entry/tree，移动目的须不存在，拒绝链接、特殊节点及重叠路径计划。首个副作用前预检整批，执行前仍复查指纹和当前授权；这不构成跨文件事务或远端原子 CAS。已确认项保留，逐项报告 completed/failed/not_started/unknown，未知结果不重放整组。新建权限 0600，替换保留普通权限，原暂存、确认和清理保证保持。

`shell_execute` v3 参数为 `{connectionId,commands:string[],cwd?,onError?,mode?,yieldSeconds?}`，单条命令同一路径，脚本沿完整插件请求容量，不另设8 KiB配额。一批使用一次 exec，各命令在独立子 Shell 中应用 cwd/env，分别捕获输出、退出码和未执行项，不创建常驻 Shell 或远端临时文件。onError 默认 stop，可选 continue；cwd 为可选绝对路径、沿4096 UTF-8 bytes路径契约；mode 默认 foreground，可选 background。全部需要 shell.execute 和原独立执行审批。前台 yieldSeconds 默认冻结工具等待预算，允许 0 立即交回，不超过冻结预算；后台或等待到期返回同一个 Job 的受理/运行状态，不重新执行命令。已执行结果含 commands[]、真实 stdout/stderr/退出码和 truncated，输出总捕获预算保持 32 KiB。

`shell_job_control` v3 参数为 `{connectionId,action,jobIds?,waitMode?,waitSeconds?,offset?}`。list 不传 jobIds，按 offset/nextOffset 每页 64 项；status/wait/cancel/output 使用 jobIds 数组。waitMode 为 all/any，waitSeconds 默认 10、最多 30 且受冻结预算约束，等待到期不取消 Job。output 按 UTF-8 字节 offset 返回已捕获实时 stdout/stderr 事件、各 Job 的 nextOffset；复用返回游标避免重复日志，进程未完成也可读取。输出不会恢复超过捕获预算的字节，重启后只从持久终态结果恢复捕获内容。cancel 独立批准；所有动作只允许当前 user/App/Run、目标版本和指纹一致的 Job。权限每秒复查；原 Run 的执行截止时间不因等待/续读延长。启动将 queued 转 failed/not_started、dispatched 转 unknown，不重放；Run 最终结束、撤权或停机排空真实资源。本地取消和关 SSH 不证明远端进程停止。

Job 的执行结果无法确认时，会立即通知所属 Run，停止模型请求和待审批工具的等待；Child 的此类故障也会停止 Root 及同族任务，其他 Run 不受影响。查询不再把 unknown 当作可以继续轮询的执行状态。任务进入终态，未消费的审批失效，并在原错误区域说明“任务已停止，远端操作可能仍在运行”。重启后仍从原 Job 记录展示原因，不自动重试或释放机器占用。这里的“结果无法确认”仅表示无法证明远端是否完成，不等于命令仍在本地等待；继续同一线程前仍需用原结束入口关闭该 Run，结束不解除机器围栏。已确认的非零退出保留退出码和输出，主机公钥未信任等确定未执行的拒绝记为 failed。工具派发、审批消费或完成的数据库回执丢失时，也会独立结束已确认模型步骤所属的总任务，不重试原工具写入或自动继续执行。

主机已有任务正在执行时，新命令提示“尚未执行：该主机有其他任务正在执行”；已有旧任务效果未确认时提示先在“机器突变恢复”核对并恢复。两者都不会把被拒绝的新命令记成新的执行未知，也不会自动解除旧围栏或重跑原命令。

`machine_docker_inspect` v3 使用 `{connectionId,containerIds}`，返回定向容器逐项视图或 not_found，不读取全量 stats。`machine_docker_control` v3 使用 `{connectionId,items:[{containerId,action,expectedFingerprint}],onError?}`。容器 ID 必须为完整小写 64 位 hex；action 为 start/stop/restart/remove。两者需 machine.docker.manage；control 独立批准，remove 为 destructive。整批先预检，执行前复查指纹，完成后核对状态/删除；逐项结算且不承诺原子 CAS，未知不重放。冻结整项期限保持。

后端 acp_execute v2 使用 {connectionId,argv,cwd,prompt}，仅通过独立SSH调用远端已安装的ACP v1程序。argv最多128项、原始UTF-8合计8KiB，cwd为必填绝对路径且最多256bytes，prompt最多8KiB，完整参数JSON最多16KiB。不接受旧integrationId/target/Workspace/profile，也不自动安装程序或添加本机回落。需当前 integration.acp.invoke、选中目标和独立destructive人工批准；当前调用参数绑定批准，插件能力声明不授予 grant。

ACP派发前目标指纹变化返回conflict，重新读取目标并发起新意图；已派发后的结果不确定仍保留operation_unknown，不自动重放。

ACP执行初始化、创建新会话、提交prompt并收集文本更新；输出最多32KiB，超限整项失败而非截断伪报完整。整项受冻结工具期限约束（默认45秒），包含内部权限等待，跨层传递剩余期限；独立远端任务按冻结预算和真实资源占用接纳。stopReason明确返回end_turn/max_tokens/max_turn_requests/refusal/cancelled，协议完成不代表远端副作用已被业务验证或程序处于OS沙箱。

每个受支持的ACP内部权限请求生成独立acp_inner_permission工具操作和kind:acp_permission批准，绑定父调用、会话/请求/远端toolCall身份、目标版本、原输入哈希及独立修订。父批准只允许启动程序，不能批准内部动作。只支持allow_once/reject_once；没有allow_once选项直接取消，不支持allow_always。direct文件/terminal请求拒绝。读取现有审批列表/单项并resolve后，执行方仍须在当前权限有效时原子消费一次，确认许可响应已发送才记录交付；该子操作completed表示许可已交付，不保证远端内部动作成功。审计摘要不展示rawInput或prompt正文，远端title/kind仅是未受信说明。

权限与状态使用现有审批 HTTP 和线程工具列表查询，不透传原始ACP更新或新建独立WS。每父调用最多64个内部权限操作；协议单消息256KiB、总入站8MiB，最多16个在途权限handler。每秒复查当前父授权/目标；撤权、过期、Root取消或停机关闭本次流并等待资源收尾，晚批准不继续。重启收敛未派发子操作与已派发未知意图，不恢复活waiter或自动重放。断线、响应交付/持久确认或清理未知不得报回滚；本地关流不保证远端进程停止。正式 Host 已接 Shared 审批与聊天工具状态，行为按testing原证据及D17核对。

以上写入链须 governed 准入；正式前端沿原工具卡片与审批区域呈现当前状态。

路径必须绝对，拒绝`..`和符号链接跟随；目录可显示symlink条目。读取前后复查版本、指纹、选中与授权。hash只描述捕获内容，不保证远端并发原子快照；已开始的读取不能因撤权追溯撤回，但结果交付仍会拒绝。不可续查的远端操作受冻结toolTimeoutSeconds与Root剩余期限共同限制，Shell的等待窗口和实际Run执行期限按上文分别处理，取消等待实际资源收尾；不自动重放unknown。当前工具执行须 governed 准入，正式前端同步 Shared 字段及安全提示，执行证据见 testing。

## Root/Child 与协作

后端提供十个模型工具：`collaboration_delegate/list/output_read/join/cancel/message_send/message_read/message_consume/fact_read/fact_write`（每项都使用完整 `collaboration_` 前缀）。必须显式授予 `app.intents.exchange`；委派、取消、发送、消费和写事实分别批准，读取也须当前授权。父批准不授予 Child 远端工具许可。正式Host提供子任务状态／取消和只读消息元数据观察，执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。正式前端已消费当前契约；当前验证范围见 testing。

- Root 的直接 Child 按活跃数限制（默认4），已完成且排空的 Child 释放名额，不支持嵌套。Root/Child/依赖等待仍共用冻结配置中的执行名额；执行准入满载拒绝，模型派发并发忙则等待空位，沿用原任务期限和取消，不重放付费请求。Child 直接复制 Root 冻结的模型与执行设置，继承 Root 绝对期限和模型请求上限，不单独分配请求数或运行秒数；全族模型请求、工具调用和 token reservation 共用预算，委派不会额外增加额度。
- delegate 参数为 profile、objective、dependencyMode 及可选 targets/dependencies。profile=explore|review|worker 仅为角色标签，不再管理独立模型、工具或预算；Child 继承主 Agent 工具集合，但不提供嵌套委派及 Root 专属 join/cancel。所有工具仍受实时权限、目标范围、访问模式和逐次审批约束，继承不扩大权限。objective 为独立任务（最多8 KiB），不复制父私有历史；targets 为选中 SSH ID 的十进制字符串子集（最多50项，省略表示无目标），dependencies 为此前 Child UUID，不再另限四个；数量仍须符合完整参数字节容量；发送给模型的工具声明同步该范围，不另卡128项，success 要求成功、settled 接受终态。完整工具参数 JSON 最多16 KiB，不能只看单字段上限。
- list/join 返回安全状态及 Child 最后正文预览（最多1024个字符），并带完整字节数及省略标记；list 支持 after/limit，每页最多16项。Child 正文沿模型步骤容量保存（最多2 MiB），可用 collaboration_output_read 按码点 offset 续读，每页最多4 KiB，并返回原文 SHA-256。正文只是模型生成结果，不是已验证证据。join 只由 Root 发起，childIds 必须为其直接 Child，mode=all|any，waitSeconds 为1–30；超时不停止 Child。父成功前等待全部 Child 实际资源收尾；已明确失败或取消且排空的 Child 可以由父总结处理，仍运行或效果未知的 Child 阻止父成功。纯执行未知结算为 unknown，存储提交未知保留原状态供恢复对账，不能自动重放。join/cancel 的 childIds 不再额外限制四个，仍逐项核对归属及完整参数容量；批量返回超出单次工具结果容量时省略正文预览并保留省略标记，完整正文仍可续读。cancel 独立批准后围栏并等待本地清理；持久围栏确认失败时仍停止并等待原Child任务，保留未知结果与清理失败，不承诺远端进程回滚。
- message_send 使用 recipientId/body/ttlSeconds，只能发给当前族内仍活跃的其他参与者；body 最多8 KiB，TTL为1–300秒。全族累计条数和原始正文字节数由冻结配置控制（默认256条/512 KiB），过期与已消费记录仍计累计配额。接纳不等于消费；不使用旧 runtimeId/任意 JSON/artifactRefs。
- message_read 使用 after/limit（每页1–4条），只读自己的持久邮箱；按服务端 nextCursor 继续，过期文本被省略，但扫描进度保留。message_consume 使用 through/expectedConsumed CAS，只能确认已经连续扫描的范围，跳页不能确认未读间隙。
- fact_read 使用 key；fact_write 使用 key/value/expectedVersion，0表示创建，更新必须匹配当前版本。key 最多128 UTF-8 bytes，value 最多8 KiB，全族最多128 keys。消息和事实均是未验证文本，不能作为权限或可信指令。
- 取消、撤权、Provider变更和停机收尾全族；存储失败仍尝试本地清理并保留失败原因。提交未知不猜测、不重新派发；重启不恢复活 waiter 或旧付费请求，未派发 Child 失败、已运行 Child 保守 unknown。冲突需读取当前状态后由新意图决定下一步，不能自动换键重放。

管理员观察接口前缀为 /api/v1/agent/apps/:appId/runs/:id：GET /subagents 只返回直接 Child 的 id/parentId/status/version/profile/deadlineAt；POST /subagents/:childId/cancel 带 expectedVersion 与稳定 Idempotency-Key，复用 Run 取消结果，冲突先只读核对、unknown 不换键重放。GET /subagents/:childId/messages?after=0&limit=16 只返回 sequence/senderId/bodyBytes/expiresAt，最多32项，完整响应16 KiB；包含过期记录的元数据，按 nextCursor 继续，不读取正文或推进模型消费水位。均须新 Access 管理员会话，错族/错 App/非直接 Child 返回 not_found。外部直接创建 Child 由受审批模型委派替代；已删除独立 Profile 管理及查询工具，不保留旧配置协议。

## Memory、Artifact 与语义检查点

设置中的记忆管理卡片已移除；对话右侧提供当前对话候选的人工保存/拒绝，不提供全 App 管理或撤销界面。后端管理 API 保留，完整请求128 KiB、列表响应8 MiB；不提供跨 App 记忆导入，不改变已有记录和人工发布要求。

Memory 管理归 /api/v1/agent/apps/:appId/memories：列表 status/limit/offset 与可选 threadId、POST 候选、GET 单项、POST /:memoryId/review。threadId 在分页前筛选同用户/App 下来源 Run 属于该对话的记忆，包含子任务；无运行来源的记录不匹配，缺失或不属于该 App 的对话返回 not_found。不传 threadId 则列出全 App 记录。正文最多 16 KiB，审核带 expectedVersion，只有人工 publish 才进入 Recall；模型提案绑定真实 Run。审核结果未知时按原 memoryId 只读查询，不自动重发。

Artifact 位于 /api/v1/agent/apps/:appId/artifacts；先 POST name/mediaType/declaredBytes，再 PUT /:artifactId/content，以 application/octet-stream 发送真实字节并带 If-Match 的带引号版本。不再另设单文件大小和累计文件数量上限，按执行设置的 Artifact 总空间准入（默认512 MiB、最大可配置10 GiB），已有文件与预留字节计入占用，并保留磁盘64 MiB余量。服务端流式校验实际长度，GET 内容支持单个 bytes=start-end Range，下载不内联执行。文件库上传分片读取并计算SHA-256，直接交付File；超过4 MiB的下载使用Range分段获取并核对同一文件版本、范围、长度与最终SHA-256，再交付Blob，不要求整体转成单个ArrayBuffer；4 MiB为传输批次而非文件上限，实际大文件仍受浏览器资源和网络期限约束。后端普通下载、插件包暂存和消息授权读取在分块交付及结束前复查原授权、ready/有效期及版本；空文件同样检查，不绕过认证。短读或超出声明范围终止交付，已交付字节不能撤回。文件库的图片/GIF 预览使用个人“工作区 → 文件”的图片大小上限，默认20 MiB、0取消限制；聊天内联GIF使用原Artifact preview入口。库 /api/v1/agent/files 与 /files/storage；App 内支持 retain、带版本删除、attachments/解除引用及 cleanup/preview、confirm。被引用或保留的文件不能清理；确认绑定资源版本、十分钟期限并只消费一次。文件发布后 SQL 失败是未知结果，预留额度不因此释放，不能自动重传或删除。

模型工具 memory_recall/propose、artifact_create/read/present、file_deliver 与 context_checkpoint 使用独立当前能力和必要审批。file_deliver({connectionId,paths}) 将已选 SSH 普通文件流式复制到当前 App，需同时具备目标 file.read、全局 artifacts.write 和当前批准；artifact_present({artifactIds}) 只展示当前 App 已有 ready 文件，需 artifacts.read。生成、创建、展示、交付和浏览器截图/下载的真实 Host 操作产生可信 outputArtifactIds，包父操作在 failed/cancelled 等已结算状态仍汇总持久子操作的引用，inspected/dispatched 不发布引用，双端工具视图与严格解码同步；前端自动展示图片或复用 FilePreview 的文件卡，不接受模型自报 URL、Artifact 引用或结果 JSON 推断。迁移 v2 转换历史 Shell Job 结果，v3 转换历史交付/展示批次结果，不保留运行时旧格式兼容。Artifact 按字节 offset 续读，encoding 为 base64 或 utf8；UTF-8 页不拆分码点。tool_result_read 使用 items 数组读取原捕获结果，offset 按 Unicode 码点，返回 nextOffset 和原内容哈希；Memory 和摘要均是不可信数据，不能成为授权。语义检查点按冻结 aggressive/balanced/conservative 限制摘要至来源字节的35%/50%/75%，只在完成原步骤工具组后替换已绑定输入前缀，原用户请求和完整当前交换保留；没有开启模型派发就不会伪造摘要。

## 执行设置

模型请求数的默认预算为80、默认硬限制为400；硬限制可由管理员改为800等正安全整数，不再额外限制为400，也不叠加400步的运行上限。修改硬限制不自动增加普通预算：先保存硬限制，再按需要修改并保存实际模型请求预算；App覆盖只能缩窄全局实际预算。其余可编辑硬限制同样不再被默认值充当固定产品上界，普通预算和默认值保持。普通参数错误、资源不存在等确定工具失败会作为工具结果交回模型，允许修正后继续；权限、审批、取消、清理失败和结果未知仍按原保护处理。工具输出配置限制模型预览，预览按配置分配，保留至少1 KiB引用外壳空间，不再另卡8 KiB；超过预览的完整结果保存在原工具账本（最多256 KiB），可通过 tool_result_read 续读，不再因超过默认64 KiB直接结束任务。普通结果与Child输出的续读页会按当前模型预览额度自动缩小，并留出JSON外壳空间，避免续读页再次被截断；nextOffset按实际返回文本推进。不可变结果的hash不匹配作为参数错误反馈模型，读取仍先核对原授权。

无效的额度输入每次点击保存都会显示错误 Toast，关闭提示后再次保存仍会提示；校验未通过不发送保存请求。Agent 窗口打开时全局 Toast 仍可关闭、确认及执行恢复动作，通知不受背景交互锁定影响。

管理员 GET/PUT /api/v1/agent/execution-settings 管理 enabled 与完整 limits；初态 version=0、执行关闭。PUT 带 expectedVersion，硬限制与普通预算共用同一保存动作，服务端在事务内重查当前版本、实际占用和全部预算约束后一次生效。App/治理/执行设置的版本耗尽拒绝继续递增，批量变更整体回滚，不返回越界版本；只读和原确定回执仍按各自原有条件处理。Child 直接继承 Root 冻结模型及配置版本，不支持独立选择或自动回退，Child 工具仍需独立授权和审批。Root 创建冻结设置，全族模型请求、工具登记与 token reservation 共用账本；预算准入使用已报告的真实输入+输出usage，尚未报告用量的调用保留保守reservation；确定未派发的失败不计token消耗，未知或缺usage不当作免费。reservation是估算，不能冒充供应商精确token用量或账单；任务总预算仍可阻止下一次请求。执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。

正式 Agent 设置恢复顶部启用／停用入口；15 项额度分别归入“模型与预算”“执行与集成”的性能／存储和“安全与防护”的子任务卡片。四处共用同一设置草稿和版本，保存提交完整配置；有未保存草稿时不允许切换总开关。子任务卡片仅管理直接子任务数量、协作消息条数和消息总字节数，并说明继承主 Agent；独立角色启用、模型、工具白名单、请求数及秒数设置已移除。文件浏览与清理从悬浮窗口的“文件”入口操作，普通附件从会话输入区的文件选择器上传，不在设置重复铺开文件库。执行设置不再加载独立子模型目录，完整 JSON 最多128 KiB。秒和字节单位在字段标注；带单位输入支持 K/M/G 等缩写。输入超出现行字段上下限时显示允许的最小／最大值，只有无法解析的文本才提示格式错误。

并发 Run 与模型调用数按已保存配置准入，不另叠加固定 8 的可配置上限；默认预算仍为4／2，默认硬限制仍为8／8。管理员可按资源调整硬限制，再保存预算，模型调用并发不能超过 Run 并发；系统不会自动增加并发。

数量、累计字节和Token等额度仅保留JavaScript/JSON正安全整数表示边界，不再额外固定工具4000次、Token800万、Child4个、协作消息5000条/8MiB、Recall20条/32KiB或文件总空间10GiB。实际执行仍由已保存的任务族预算、真实占用、Token和时间共同准入。活动时间与工具超时目前受Node/SSH单次计时器2147483647毫秒的真实表示约束，整秒最大2147483（约24.9天），不再限7200/300秒；Artifact期限不再限30天，但生成的绝对到期时间必须在ECMAScript Date可表示范围内。数据库子任务请求数 CHECK 同样使用此边界；业务运行路径不保留旧 400 上限。

Recall工具请求的条数不再另限20，候选读取至少覆盖本次请求条数；返回条数/总字节按冻结预算和单次工具结果容量核对。MCP/Browser的运行调用使用已配置工具/Run信号，不再另套60秒完整调用期限；管理请求仍保留原期限，连接握手、CDP单次控制请求和清理仍使用各技术owner的期限。MCP/Browser待处理任务及Browser运行会话动态追踪，不另按16项拒绝；全局执行准入、目标冲突、撤权、取消和未确认清理保护继续生效。单次参数/结果捕获、HTTP/WS完整编码、分页和Browser二进制表示容量独立保留，不是任务族总额度；大额度不等于单条响应可以无限扩大。

在“模型与预算”展开“硬限制”直接编辑完整上限；修改硬限制时普通预算锁定，修改普通预算时硬限制锁定。点击“保存”一次提交，不再显示预览或二次确认面板；服务端拒绝低于预算或实际占用的值。冲突、写后断流或结果未知阻止下一次写入；点击“读取已保存设置”放弃草稿并核对服务端，读取失败不会解锁，不自动重发保存。离页、卸载或身份撤销清除原草稿并隔离晚响应。旧聚合预算/并发/子任务控件已移除；正式管理及运行页已接Shared，整体行为回归仍待最终远程Actions E2E。

全用户模型并发、Root/Child 占用、完整期限、工具输出/超时、Recall、Artifact 额度/TTL 与协作消息均接入实际消费者。配置变化先持久围栏旧 Run，再取消本地任务；App 覆盖项只能缩窄全局值。文本模型使用配置的完整上下文容量；未知上下文容量不再阻止文本模型执行、不猜固定窗口，最大输出仍须配置以限定单次输出。不再按normal/extended裁剪成32K，也不再用字节估算提前拒绝模型窗口；真实超窗仍可能被供应商拒绝，网络与持久快照的编码容量检查保留。文本对话按 OpenCode 的思路自动管理上下文：本次 Run 中最近一次有效模型用量校准已计量前缀，仅对新增消息估算；没有可用报告时按字符/4近似计算，不能代替供应商分词器。使用完整模型窗口，预留15%，窗口至少32k时余量至少16k；到达阈值时摘要旧前缀，保留当前请求和近期完整交互/工具组。有效已测输入至少64k且占用达到压缩阈值的85%时，可在工具执行期间预生成摘要，下一轮派发前等待其收敛；预生成失败连续两次后暂停，实际需要压缩时仍允许按原任务预算尝试。摘要只在原前缀和来源仍匹配时应用，不进入用户可见回复。自动摘要和正常模型请求共用任务族的请求数、token、并发与期限，会增加模型费用；缺失用量仍保留预约，不能视为免费。未知模型窗口和图片生成不自动压缩；当前输入或单个近期交互本身过大、摘要不能缩小输入时明确失败，不截断工具组。供应商实际超窗仍可能拒绝，不自动重放未知请求。context_checkpoint仍为模型显式提交摘要的独立工具，需要原能力授权；激进/平衡/保守只校验此工具摘要的比例，不控制自动压缩阈值。原普通/扩展选项暂时保留，两种选择都使用模型完整容量。旧 maxAutoModelRequests/maxAutoActiveExecutionSeconds 删除，不保留自动增额双轨。

聊天输入框外侧沿用对话区背景，不铺设横贯两侧的玻璃底色和高光；输入框自身边框及焦点反馈保留。聊天输入区实际宽度超过730px时，模型名称显示范围加宽，模型选择面板加宽至28rem，仍受窗口可用空间约束；较窄输入区保持原尺寸。聊天底部的运行失败提示保留具体原因和运行编号，不附带固定的“不自动重试”尾句；结果未知时仍要求先核对远端结果。

## Provider 与模型冻结

后端管理员接口前缀为 `/api/v1/agent/ai`。正式 Agent 设置已安装供应商管理及卡片内的紧凑模型目录栏，执行配置按原分类展示，旧聚合设置加载失败不阻止这些卡片。其余管理、运行和插件Host/SDK也已接Shared，当前仍只完成源码及静态，不代表整个Agent已通过行为回归。

模型目录栏可手动更新，读取失败或结果未知时才提供“读取当前状态”。更新期间操作互斥；刷新失败或结果未知后先只读核对，不自动重发。离开缓存页、卸载或身份失效撤销原等待，晚响应不回填。模型查询明确区分“未匹配”与读取失败，供应商未报告的能力保留未知。模型查询最多256 UTF-8字节，Registry完整响应最多8 MiB；时间在界面按本地日期显示。

| 接口                                                                    | 操作                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| GET/POST /providers                                                     | 查询/创建 Provider                                             |
| GET/PATCH/DELETE /providers/:providerId                                 | 查询、部分更新、删除；更新 JSON、删除 query 需 expectedVersion |
| GET /models                                                             | 查询当前可以冻结的模型及配置版本                               |
| POST /providers/discover-endpoint-models                                | 指定 baseUrl 和可选 credential，读取模型目录                   |
| POST /providers/:providerId/discover-models、/test                      | 发现并记录观察；test body 指定 modelId，发送真实模型请求       |
| GET /model-registry、/resolve?modelId=...；POST /model-registry/refresh | 查询缓存状态、解析能力、手动更新 models.dev                    |

能力来源按字段保存，测试详情沿用“模型库 / Provider 实时 / 自定义”标签：自动匹配或重置应用的字段记为模型库；从发现结果添加、或明确应用 Provider 观察的字段记为 Provider 实时；手动修改只把对应字段改为自定义，清空字段同时清除来源。保存、关闭再打开及重启后保留已记录来源，不因其它字段编辑统一变成自定义。未附来源的管理 API 配置值按自定义处理。来源仅解释值如何填入，不证明 Provider 支持该能力；Provider 未返回能力元数据时不伪造实时观察。以前未保存的来源不能追溯，需重新匹配或应用观察并保存后才会记录准确标签。

模型配置按“对话模型”和“图片模型”分两组，分别添加和编辑；同一供应商可共用地址与凭据，单模型协议可覆盖供应商默认值。对话组使用 Chat Completions/Responses，图片组使用 Images。

图片生成有两种入口：聊天模型选择器选 Images 模型后发送图片描述，或使用文字 Agent 调用 `image_models_list` 选择已启用的图片配置，再调用 `image_generate`。工具方式需要 App 声明/授予 `context.read` 和 `artifacts.write`，图片生成属于外部付费请求及文件创建，沿原流程独立批准；直接选择图片模型沿原 Run 执行开关和预算，不伪装成工具批准。两种方式都保存为当前 App 文件，在对话中支持图片预览和下载；也可从文件库查看、保留或删除。图片测试按钮会实际生成一张测试图片并可能计费，测试图片只用于验证接口，不保存到文件库。

模型能力与协议的持久约束由数据库结构校验，更新模型库不代替结构迁移；后续数据库升级见 [数据库迁移](DEPLOYMENT.md#数据库迁移)。

当前接入 OpenAI 兼容 `/images/generations`，一次生成一张 PNG/JPEG/WebP/GIF（GIF 保留原字节，动画生成由供应商能力决定），不另设16 MiB图片上限，按Artifact剩余空间及磁盘余量预检，最终写入事务再次校验总配额。SDK整体解析Base64/JSON，仍受当前Node字符串/Buffer表示容量约束；Node22 x64图片原始字节约384 MiB（扣除JSON余量），处理峰值内存高于文件体积；普通流式文件上传下载不受这个字符串上限影响。默认尺寸和质量由供应商决定；只接受 base64 图片返回，不下载供应商返回的外部 URL。图片模型声明不保证网关提供该接口；网关仅支持原生/Chat 图片生成接口时需使用其兼容 Images 接口。未新增图片编辑或音视频生成。图片不计为虚构的文本实际 Token usage；直接调用受模型请求数/并发/字节估算预留约束，图片工具调用计入工具数量，正式图片生成（直接 Images 和image_generate工具）统一使用当前任务的剩余活动时长，不另套普通工具短超时或固定5分钟网络上限；当前默认任务总时长为30分钟，已消耗时间不会重置，App可缩窄该预算。手动停止、权限/配置撤销或服务关闭仍会取消；普通工具继续使用工具超时配置，设置中的单独图片模型测试最多等待5分钟。文件按原 App 容量和保留期限管理。生成后保存失败、网络中断或取消不能证明供应商未扣费或已停止，结果未知时不自动重试。预览仅显示登录后有权读取的本站栅格图片，不允许任意远程或 data URL。

Provider 配置包含名称、HTTP(S) 端点、启用状态、协议及显式模型能力。配置表单分为“对话模型”和“图片生成模型”：对话使用 Chat Completions / Responses，图片使用 Images 协议；同一供应商可共用地址和凭据，单模型可覆盖协议。图片组不要求或显示文字上下文、输出 Token、工具与推理等级，目录中声明的零文本预算按未知保留，不填假值。单模型协议覆盖 Provider 默认。更新省略字段即保留；credential 省略保留、传新值加密替换、clearCredential:true 清除，两者不能同时指定。缺少加密密钥时拒绝保存凭据；查询只显示 hasCredential 和修订，不回显密钥。发现观察不覆盖手工配置；变更端点、默认协议或凭据会清除旧观察，单独修改模型手工配置保留观察。未知能力不补默认值，放宽已知上限或启用供应商明确拒绝的能力会阻止冻结。

请求最多 128 KiB，模型配置和发现不另设128／1000项门槛，Registry也不以5000项拒绝有效目录；名称 128、modelId 512、URL 2048、credential 8192 UTF-8 bytes。完整响应含 JSON 转义最多 8 MiB；超过返回 413/limit_exceeded，不截断。Provider 请求 10 秒、Registry 单次刷新 15 秒（新请求可能先等待已取消刷新收尾）；非 2xx、网络、无效/未完成流返回安全失败。模型调用、发现、图片生成和模型测试使用OpenAI官方Node SDK，保留自定义兼容端点和匿名端点。文本模型及文本模型测试仅对明确429限流拒绝最多自动重试2次，使用SDK退避并遵守Retry-After，所有尝试共用原总期限及累计响应字节预算；连接无响应、408/409/5xx、TLS证书失败、本地输入/权限/容量/预算拒绝及其它HTTP状态不重试。成功响应后的断流或无效输出不重放；图片生成和模型发现不自动重试。上游通过结构化错误码 moderation_blocked 或 content_policy_violation 拒绝请求/生成结果时，聊天与模型测试明确提示内容审核拒绝；应调整描述后重新提交，不将其解释为模型配置错误，不回显供应商原始正文。重试属于同一逻辑模型步骤，可能增加上游请求及费用，不重新执行Run或工具；模型测试传递推理配置并校验正式终态及SDK正常结束，usage缺省不补零。配置/凭据更新使旧请求失效；取消不能证明上游未处理。

Run 创建必传 model:{providerId,modelId,configurationVersion} 及 connectionIds（最多 50 个唯一正整数，空数组表示未选中目标），与 Run、初始事件、幂等记录同事务冻结模型配置和凭据代际。冻结输入不含密钥；Provider 版本失效/禁用拒绝创建，关联 pending/running/unknown Run 时拒绝删除 Provider。同意图重放保持原 key 和输入及**原提交快照**，不会因后续状态变化修改历史幂等响应；operation_unknown 不代表回滚。当前已有目录、诊断、文件只读及受审批 file_write/patch/move/delete、Shell/后台 Job/Docker 的执行源码，实际执行须 governed 准入。

后端已有独立 Chat Completions/Responses 增量模型流、Run 执行 owner、持久步骤与恢复源码。当前政策为 `governed`，执行设置默认关闭；开启后仅新建且已确认提交的 Run 可进入原执行 owner，权限、版本、预算逐阶段复查。Run 创建时间和持久期限从实际事务读取完成后计算，不使用请求排队前的时间。Run/Step/Tool 及审批递增耗尽拒绝写入；派发和流式累积预留最终结算空间，恢复/级联写入同事务回滚。pending 不表示已派发；重放和未知结果不触发第二次调用。正式界面已消费当前状态、正文及审批协议；后台状态刷新不禁用取消等可用操作，写入仍串行，版本冲突或未知结果需先核对，不自动重试；Run 正文与状态通过 WS 直接增量交付，较新终态后仍逐页推送至空页，避免最终回复缺失；短暂断线退避重连并保留已加载正文，重连通过已接纳游标续传；协议/权限拒绝及其它读取失败仍需先核对，不自动重试写入。真实行为仍按原证据范围及D17验收。DEV 页可选择 Provider 模型和配置版本；候选不保证提交时仍有效，后端按当前配置校验。

Provider/Registry公开失败只使用已定义的安全码，步骤未派发失败码为`DISPATCH_NOT_STARTED`；不返回供应商错误正文。管理接口在异步结果交付前复查会话；创建、更新、删除、发现回写及Registry刷新已写入后，若登录复查、响应编码或交付失败，按operation_unknown处理；先重新登录并查询配置，不能据错误响应推断写入已回滚。Registry resolve的modelId最多256 UTF-8字节；重复或未知query参数拒绝。

模型流由OpenAI官方SDK解码，单个事件沿完整8MiB模型传输预算接收；128KiB仅是文本合批交付目标；注释与分隔符计入完整网络流上限。完整网络流上限 8 MiB、正文上限 2 MiB；JSON 转义和重复快照也计网络量。只有明确成功终态、正常结束和本地资源清理完成才可记 completed；断流、拒绝内容、未知事件和非成功终态不能冒充成功；服务器声明的工具调用可形成 tool_calls 步骤终态，无正文也合法，不能直接记 Root 成功；结束原因只接受原始字符串取值，数组或对象即使可转成同名文本也拒绝。Chat Completions的`[DONE]`由SDK处理，后端仍要求真实正文或工具、标准结束原因及本地清理成功；SDK不把仅有思考或空流变成成功。

Agent模块按真实请求生命周期追踪在途工作，不另设64个请求的固定准入门槛；停机同时中止发现/探测和Registry刷新并等待持久写入；Provider自身关闭也等待网络、末次配置复查与发现结果写入；关闭期间的存储/内部故障保留为关闭失败，单项清理失败仍执行其它清理；网络清理失败后对应owner拒绝后续网络工作。Registry取消后的持久写入异常不静默丢弃。

本机 Run 尝试准入按已保存的并发配置计算，计入在途创建和清理失败任务；默认并发预算4/2、默认硬限制8/8，不另写死8个尝试上限。仍最多64个在途写入；关闭或新建满额在持久创建前拒绝，合法幂等重放不重新占用执行名额。Run 使用创建时冻结的任务期限（默认30分钟，受配置与 App 覆盖约束），不另设5分钟尝试期限；本地 Abort、取消或配置变更不证明供应商端已经停止。停机先停止准入再等待已准入写入和模型任务；清理失败保留内部原因，不暴露供应商诊断。

未派发步骤失败为 failed/DISPATCH_NOT_STARTED；开流前已确认的明确请求拒绝记failed/PROVIDER_REQUEST_REJECTED；已派发后断流、取消或重启保守归unknown，不重放该Run；只有明确429限流可按上述有限SDK政策退避。取消先持久围栏再中止资源；unknown 主 Run 保持活跃直到显式取消。重启核对主子状态、版本、hash 与事件，不一致数据拒绝恢复并保留现场。网络或提交结果未知时保留原输入与幂等键，查询权威状态，不能通过重复创建新意图恢复；version_conflict 明确刷新核对，不自动改版重放。

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
| 恢复     | 同一连接配置的控制动作互斥，unknown 或清理失败保留控制阻断；先只读核对，不自动重试。占用已持久化并与 Agent/Files 共用，同一文本 host/port 冲突；unknown/清理失败跨重启保留 blocked，无自动解除。管理员通过下述机器突变恢复入口核对与恢复；无自动解除。                                                                            |
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

CAPTCHA 默认关闭，由管理员在安全设置页面启用并配置供应商、site key、secret 和准确 hostname，保存到数据库后重启生效。界面沿用供应商选择后展开对应配置和帮助链接；停用或切换供应商清除未提交密钥文本，保留／清除／替换及 hostname 使用后端语义。明确清除密钥可在停用前选择“清除”，随后停用并保存。可选的 `NEXUS_CAPTCHA_*` 环境变量仅用于数据库尚无配置时的首次初始化，后续启动读取持久配置，不覆盖页面保存值。启用时必需字段不完整会拒绝保存，`GET /api/v1/auth/captcha/config` 公开 provider 与适用 site key、不公开 secret；登录 `captchaToken` 必填且最多 4096 UTF-8 bytes。后端向 hCaptcha/Google 验证接口发真实 POST、十秒截止且不重试；启用时必须绑定 `NEXUS_PUBLIC_ORIGIN` 的准确 hostname，成功响应需要 hostname 一致；Google 仅支持 reCAPTCHA v2 checkbox，不接受 v3 score/action 响应，非 2xx 响应体即时关闭；供应商明确失败返回 `captcha_invalid`，网络/格式/超时异常返回 503 `captcha_unavailable`，不固定成功或故障静默关闭。密码与 CAPTCHA 均通过后才签发会话；客户端断连会取消待执行的网络校验/写入意图，已提交的新 token 若未交付则尽力撤销，原 Cookie 不因此失效。本地交付要求原传输仍存活时触发 finish；销毁后清空缓冲或迟到的 finish 不算交付，finish 也不保证浏览器实际收到；SQLite 提交未知仍按未知结果处理。HTTPS/Host/Origin/Fetch Metadata 检查在 Platform 的统一 HTTP/WS 边界实施。核心配置由 持久 Settings 管理，CAPTCHA/Passkey站点保存后重启生效，IP与监控配置热更新；正式CAPTCHA/IP安全面板已接版本化新契约；审计与通知正式前端已接 Shared Operations 契约，TOTP/Passkey 挑战已有 部分验证，详见下节；公网供应商、期限/配额与故障交错按 testing 保留待验。

数据库初始化创建完整表结构；登录失败记录包含最后失败时间和索引。后续结构及历史数据转换从下一版本起按变更逐条迁移，dev 与 latest 使用同一版本链，见 [部署文档](DEPLOYMENT.md#数据库迁移)。成功登录/会话验证等存储访问至多每五分钟惰性清理过期会话与已结束且七天无新失败的黑名单行，不清除活跃封禁。SQLite 提交或回滚状态不确定返回 `operation_unknown`（503），可能已有副作用，客户端不得假定失败并重放密码修改或设置写入；重登/重新查状态由当前身份和持久事实决定。

## TOTP 与 Passkey

本地 既有专项验证 TOTP 设置/激活、部分认证替换与权限隔离、并发单次消费、rememberMe、禁用与注销；受信代理下 HTTP/WS 来源拒绝、封禁与解除通过。CAPTCHA 使用受控 hCaptcha/Google 响应验证表单、hostname、v2/v3区分、拒绝与不可用；Passkey 使用 Chromium 虚拟认证器验证真实注册/签名登录、错误证据拒绝和管理操作。TOTP 生成/验证异常、部分登录密文解密失败和 Passkey options 故障不会启用因素或签完整会话；WebAuthn 实际验签供应商故障返回 factor_unavailable（503），原挑战保留且不降级登录。正式因素设置和安全配置页面已接新契约；未使用实体安全硬件或公网 CAPTCHA；自然过期、配额和提交/撤销竞态继续验收，精确范围见 testing。

- 密码核验正确且当前账户已启用 TOTP 时，`POST /api/v1/auth/login` 返回 200 `{requiresTwoFactor:true}`，设置 HttpOnly/SameSite=Lax 的 `nexus_partial`；服务端待认证记录 5 分钟有效，最多 64 条；同一浏览器重新完成密码核验时，旧部分会话在创建新部分会话的事务内替换。不签 `nexus_session`，该 Cookie 不能用于 SSH/Agent/Targets 管理。`POST /api/v1/auth/login/2fa` 的 JSON `{token}` 需六位数字和原 partial Cookie，TOTP 验证完成后在事务中签普通 Cookie，rememberMe 30 天直到此时才生效。错误验证码计入公网 IP 失败记录；并发完成仅一方可以消费待认证。未启用时“启用两步验证”、已启用时“禁用两步验证”与 Passkey 注册均位于对应分组标题右侧；禁用仍需在正文输入当前密码。
- 已登录管理员可 `POST /api/v1/auth/2fa/setup` 获取一次性 secret/QR（仅向当前已登录的发起者交付），暂存 secret 使用绑定账号的应用密钥 AES-GCM 加密，`POST /api/v1/auth/2fa/verify` 带 `{token}` 验证后启用；`DELETE /api/v1/auth/2fa` 带 `{password}` 再核对当前密码后禁用。TOTP 采用 30 秒、六位数字、相邻 ±1 时间窗；没有恢复码功能，不能向用户暗示已有恢复机制。启用因素不主动注销现有完整会话；禁用撤销未完成的部分认证。
- Passkey 使用独立 5 分钟 `nexus_challenge` Cookie。匿名 options 挑战全局最多 768、每可信来源最多 16，所有因素挑战总额 1024，以免公开入口挤占已认证注册配额；首次无关联 Cookie 的并发匿名请求不能视为同一认证实例，只有携带旧挑战 Cookie 的替换和已登录同 Session 的注册替换才有事务级唯一性。改密递增认证修订、使修改前签发的 Passkey 登录挑战在最终提交时失效；每个 credential 有不可复用的 generation，验签后的会话事务复查 generation 与 counter。已认证用户可请求 `POST /api/v1/auth/passkey/registration-options`，再经 `POST /api/v1/auth/passkey/register` 提交 `{registrationResponse}`。匿名可 `POST /api/v1/auth/passkey/authentication-options`（`{username?}`）和 `POST /api/v1/auth/passkey/authenticate`（`{assertionResponse,rememberMe?}`）登录；`GET /api/v1/auth/passkey/has-configured?username` 查询配置。已认证用户可 `GET /api/v1/auth/user/passkeys`、`DELETE /api/v1/auth/user/passkeys/:credentialID`、`PUT /api/v1/auth/user/passkeys/:credentialID/name` 带 `{name}` 管理本人凭据。
- 注册/认证 JSON 请求最多 128 KiB，单个证据字段最多 96,000 UTF-8 bytes；凭据 ID 最多 1024 bytes，名称最多 128 bytes，transports 最多 16 项、每项 32 bytes。完整options/列表JSON最多8MiB，超限明确拒绝，不截断列表；列表时间为 Unix 秒，前端转换成毫秒展示；交付列表前复查原会话，读取期间登出、改密或到期拒绝交付。持久凭据的账号、编码、名称、transport 和时间损坏返回安全失败，不返回部分正常列表；原始 public key/counter 不公开。
- WebAuthn 只有实际验证完整 challenge、RP ID、公开 Origin、数字签名与 User Verification 才能登录；客户端 options 使用 `required`，与服务端要求的用户验证一致；计数器状态和 challenge 单次消费与会话签发同事务。旧挑战被新请求替换或过期须重新发起，旧失败不能换一个当前挑战重放。每个浏览器上下文 Cookie/Session 绑定挑战，签名结果不等于客户端声称的 verified 标志。支持既有 ES256/RS256 与零 counter 的同步凭据语义；不提供虚构的 recovery-code。公网禁用非安全来源的 WebAuthn RP，独立入口可用 `NEXUS_PASSKEY_RP_ID` 与 `NEXUS_PUBLIC_ORIGIN` 配置。
- 登录/设置流程遵循来源准入和完整会话授权，logout 清理普通、部分、challenge 和 TOTP 设置 Cookie。客户端明确无效的 challenge/Origin/RP/UP/UV/counter 认证证据拒绝登录，不能确定为凭据错误的 Provider 技术失败不回退为通过，也不累计密码错误；密码/因素签发的完整或部分会话以及 TOTP setup/Passkey options 已写入而 HTTP 未完成交付时撤销对应令牌/挑战；会话签发后的身份确认失败保持 operation_unknown 并尽力撤销，HTTP finish 不证明浏览器收到；数据库未知提交不可自动重试；真实第三方浏览器、网络中断和并发安全需在 进一步验收。独立入口已支持持久多 Origin/RP：首次可用 NEXUS_PASSKEY_SITES JSON 数组配置，每项为 {origin,rpId}；未配置时以公共 Origin 和可选 NEXUS_PASSKEY_RP_ID 初始化一个站点。最多16站点，Origin严格规范且与主监听同协议，RP必须匹配域名或其父域；HTTP仅支持localhost/127.0.0.1。HTTP/WS只接收配置站点或主Origin的受信Host/协议，同一请求的Origin必须匹配选中站点，不能跨配置站点借用CSRF许可。未配置RP的主Origin可密码登录但不能签发Passkey挑战；改变/删除Origin/RP在重启后令旧挑战失效，不自动选择首个RP。正式LoginView/Auth Store基础密码与TOTP二阶段、改密及TOTP设置页已接新契约。TOTP二维码只接受inline PNG，完整setup响应最多64KiB；取消/离开缓存页/卸载清除本地secret/验证码/密码，未知结果阻止重复写入，先点“重试”只读核对会话。Passkey登录/注册先严格解码options，再显式转换给浏览器，并强制用户验证；登录页始终显示Passkey入口，不预先查询账号是否已注册，未找到可用凭据、用户取消或验证失败时显示安全提示，不冒充密码登录结果。凭据页支持注册、重命名和删除；结果未知或已成功但刷新失败时先只读刷新，不自动重复写入。离开缓存页、卸载或身份失效取消原等待，旧结果不覆盖新状态。CAPTCHA/IP安全设置已接完整配置与CAS；审计、通知已接Shared，外观、Agent等其余功能继续迁移。当前源码实现及静态执行状态不等于正式功能已经上线。

## 审计与日志

审计观察层现在会在 HTTP 修改请求执行前，通过原会话读取操作者身份并将 userId 绑定到后续事件；Targets 等公开修改回执不包含 user 字段，不能由响应正文推断操作者。匿名/失效会话保持 null，登录等具备身份回执的路由沿用服务端身份事实。这项修复尚待远程 Actions 核对。

GET /api/v1/settings/audit-logs 支持 event/from/to/q/limit/offset：时间为毫秒，默认50条、最多200条，以nextOffset续页。仅记录有限事件、用户/来源IP、资源ID、路由模板与状态码，不记录请求正文、Cookie、密钥或模型正文。相同事件键只接受原绑定内容，改事件、身份、资源或路由/状态返回冲突；HTTP审计记录响应决定，不保证客户端实际收到。审计保留最新50000条和尚未完成通知分发的积压；投递保留最新50000条终态及全部在途项。

GET/PUT /api/v1/settings/logging 使用 {expectedVersion,level}，level为debug/info/warn/error/silent；默认info。已保存阈值启动加载，保存后立即按版本单调激活，GET同时显示effectiveLevel；版本耗尽返回version_conflict，不保存越界版本。Operations事件写有限安全元数据到stderr，失败/未知事件为warn，其余info；后端诊断与审计共用同一Pino实例及有效等级。日志配置和审计只供当前管理员，更新与会话复查同事务，冲突先刷新，未知结果不自动重放。

## Agent 连接资源关闭

`POST /api/v1/agent/apps/:appId/resources/close` 接收 `{appVersion,target,confirmed}`。target 为 `{kind:"app"}` 或 `{kind:"session",runId,sessionId}`。需当前 App 版本及管理员会话；未确认且存在活动 Run/操作/后台 Job 返回 confirmation_required 和计数，confirmed 后停止原任务并等待资源排空。sessionId 绑定精确资源实例，旧请求不关闭后续新实例。资源状态经原 Run WS 推送，包括连接计数、活动数、状态和 expiresAt；隐藏/最小化不调用关闭。

## HTTP 框架接入

后端模块接口直接注册 Fastify 路由，使用 `url`、`handler(request, reply)`、`bodyLimit`；正文从 `request.body` 以 unknown 交 Shared 严格解码，参数和重复查询在协议边界验证。禁止把 Fastify request/reply 传入 Service、Model 或 Shared。

普通 JSON 由框架先有界解析，再执行应用 handler；来源校验及应用写入的完整会话准入在解析前完成，业务 owner 在解析后和实际事务继续复查权限。multipart 路由声明 `config.multipartBodyLimit`，由独立插件 scope 提供流式 parts；`bodyLimit` 仍约束 JSON，multipart 完整封装和每个 part 分别计量，业务入口授权后读取，无自动临时文件。声明长度超限可在读取前返回 413；分块上传实际超限或未结束的 part 被拒绝时终止原连接，不保证能交付 JSON 错误，客户端不得自动重试写入。仅二进制原始上传使用 `config.rawBody` 并由接口承担读取预算和取消。

JSON 对象继续通过 `preSerialization`，模块 serializer 只编码一次并检查最终 UTF-8 字节预算；serializer 失败由原生 route errorHandler 投影安全错误，不能依赖 handler 的 try/catch 捕获。已提交写入的响应失败保留结果未知。普通 Buffer/Readable 使用原生 `reply.send()`；保留必要的 raw 响应时须设置自身内容/传输头；Helmet 已在 onRequest 将安全策略写入 raw 响应，不能另拼一份 CSP。绕过钩子的技术失败由 Platform 清除原实体及凭据头并生成最小安全错误。异步响应钩子完成前不得认为 send 已交付；需要资源确认的接口检查真实 finish、最终成功状态和原身份。审计发布不改写已经交付的业务结果。详细 owner、维护与错误规则见 [Backend HTTP 运行时](architecture/BACKEND.md#fastify-http-运行时)。

Cookie 解析与序列化分别使用已注册的 `@fastify/cookie` 实例；HTTP 的原生 cookies 和 WS 的解析结果经过同一重复名称/容量拒绝，模块继续读取安全事实，不能再手写解析或单独解析出另一份身份。Access Cookie 使用原 HttpOnly、SameSite、Secure、Path 和有效期策略；直接通过实例 serializeCookie 写入响应头，保证失败后移除 Set-Cookie 不会被延迟队列重加。安全头通过 Helmet 的原生 route options 或 reply.helmet 配置，业务策略仍归对应模块；不得直接启用所有默认项改变既有 iframe、SDK 或 HTTP 部署行为。

## OIDC 认证接口

协议 owner 为 Shared `access/oidc/{values,http,http-codec}`，安装在 Access，复用现有 Origin/CSRF、Cookie 和会话交付。所有返回禁止缓存；完整请求/响应沿用基础认证 16 KiB JSON 预算，禁止未知字段。

| 方法与路径（前缀 `/api/v1/auth/oidc`）  | 请求与结果                                                                                                 | 授权                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
| GET `/provider`                         | `{provider:null \| {label}}`                                                                               | 公开，仅已启用且绑定时显示        |
| GET `/settings`                         | revision、enabled、label、issuer、clientId、clientAuthentication、hasSecret、bound、callbackUrl            | 完整会话                          |
| PUT `/settings`                         | 期望 revision（首次为 null）、完整配置、secret keep/replace/clear、password → `{changed:true}`             | 完整会话与密码证明、事务 CAS      |
| DELETE `/binding`                       | revision、password → `{changed:true}`                                                                      | 完整会话与密码证明                |
| POST `/binding/start`                   | revision、password → authorizationUrl                                                                      | 完整会话与密码证明                |
| POST `/login/start`                     | rememberMe → authorizationUrl                                                                              | 来源准入、已绑定配置              |
| POST `/binding/finish`、`/login/finish` | code、state、issuer、error（code/error 二选一，其余可空字段显式 null）→ `{completed:'binding' \| 'login'}` | 原流程 Cookie；绑定还须原完整会话 |

提供方只回调固定 SPA `/login/oidc/callback`；浏览器立即移除敏感查询并同源 POST 完成，不开放任意 redirect URI 或跨站 POST 豁免。完整认证依赖 openid-client Discovery、PKCE、nonce/state、ID Token 声明与数字签名；接口不接收可直接兑换本地权限的邮箱。配置变更与解绑撤销关联 OIDC 会话，重复、过期、旧配置及身份变化拒绝。密码改变、Passkey 强制政策和来源准入在最终写事务重新核验。

### 宿主诊断契约来源

`GET /api/v1/system/diagnostics` 的路径、响应与错误 schema 来自 Shared `system/diagnostics/http`，Fastify 安装同一 schema 的 JSON Schema 投影；双端使用 `readHostDiagnosticResponse` 严格解码。指标含 SQLite 排队、执行和提交的累计计数与总/最大毫秒耗时，名字和单位归 `diagnostics/values`，不输出 SQL 或参数。结构 schema 与跨字段细化共同校验，完整响应预算仍为16KiB；其它端点继续沿各自 codec，完整 OpenAPI/AsyncAPI 生成尚未接入。

### 记忆召回策略归属

执行设置与 App 执行覆盖不再接受 `maxRecallItems`、`maxRecallBytes`；这两个选项归 `nexus.tools.agent` 实例的签名设置 schema，通过既有插件 configuration 接口和公开 SDK 读写。默认5条/8192字节，整数只受安全表示范围约束，不叠加 Host 召回政策。迁移65一次性清除旧字段并保留已有官方未配置实例的有效偏好。

`memory.retrieve/candidates` 的 `maxItems` 是请求的 limit，`maxBytes` 是当前完整编码回复帧容量，不是整次召回配额。候选沿 `nextOffset` 遍历，所有页必须保持同一摘要。`select` 每批核对当前已发布集合摘要、身份和版本，完整返回全部准确引用或明确拒绝；超帧返回 limit_exceeded，不静默截断。插件按双层 JSON 编码容量分批调用、完整汇总为受管内容，任一批失败或取消不返回部分成功。
