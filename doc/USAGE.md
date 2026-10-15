# 使用

本文统一记录正式产品的功能、操作、限制和失败恢复。新后端开发入口单独标注，不等于正式功能已迁移。部署命令见 [DEPLOYMENT](DEPLOYMENT.md)，设计见 [Frontend](architecture/FRONTEND.md) / [Backend](architecture/BACKEND.md)，开发流程见 [AGENTS](AGENTS.md)。

## 每版产品行为维护

按 [人工规则 H-09](rules/HUMAN.md#人工规则列表)，每版逐项维护所有变更功能点：

- 已有功能就地修改对应章节；新增功能补充章节及导航；删除功能清理失效说明。
- 同版写清变更后的操作、输入输出、权限、容量和失败恢复，合并旧描述，不另追加近义条目。
- 仅内部调整且行为一致时，核对原说明仍真实即可。
- 使用短句、列表、表格和必要示例；保留有效限制，不堆历史叙述或无归属的文末变更项。
- 设计、施工任务和验证证据分别维护在 architecture、实施方案和 testing；未实现、未验收不能写成完成。

## 章节导航

| 功能                   | 章节                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| 连接、代理、密钥与通知 | [连接、代理与通知管理](#连接代理与通知管理)                      |
| SSH 挂起与重连         | [SSH 会话](#ssh-会话)                                            |
| 输入、快捷指令与历史   | [命令输入框](#命令输入框)、[历史命令](#历史命令)                 |
| 终端交互               | [终端](#终端)                                                    |
| 文件、编辑、预览与传输 | [文件管理器与在线编辑](#文件管理器与在线编辑)                    |
| RDP / VNC              | [远程桌面](#远程桌面)                                            |
| Agent、工具与集成      | [Agent](#agent)                                                  |
| 布局与外观             | [布局与通用操作](#布局与通用操作)、[外观自定义](#外观自定义)     |
| 首页、状态与 Docker    | [Dashboard](#dashboard)、[状态监控与 Docker](#状态监控与-docker) |
| 认证与审计             | [安全与认证](#安全与认证)                                        |
| 数据备份               | [备份与恢复](#备份与恢复)                                        |
| 客户端与发布           | [客户端与平台](#客户端与平台)、[镜像发布](#镜像发布)             |

## 连接、代理与通知管理

- 连接支持搜索、筛选、排序、批量操作；连接、代理和通知采用自适应卡片及表单，长名称、地址和测试说明可换行。
- 手机批量操作分为“全选/取消/反选”和“编辑/删除”两排；管理操作通常四列，窄卡片两列。代理/通知桌面按钮至少 44×96px，手机按钮底部等宽，代理不显示更新时间。
- Proxy 的 password/key 认证必须有密码/私钥；省略保留原凭据，显式空值拒绝，passphrase 可清空。缺凭据旧记录须补齐或切换认证方式。

### 引用、跳板与导入

- 被引用的 Proxy、SSH Key 不可删除；跳板连接不可删除或改为非 SSH，须先解除引用。保存时事务内重检，不自动改路由。
- 跳板链按显式顺序逐跳连接，只消费各跳的地址、用户名与认证，不递归执行该连接自身的 Proxy/Jump 路由。
- 标签替换最多 1,000 个安全正整数连接 ID，重复合并，空数组清空。引用不存在返回 404，失败保留原关联。
- 导入按记录提交，可部分成功；单条的内联 Proxy、Connection、标签同事务成功，失败不遗留新 Proxy，保留 Legacy 导入格式。
- 登出后旧响应不回填连接/代理/标签/通知缓存；已提交的服务端修改不撤销。

### 通知配置与投递

- Webhook 常见凭据 Header 自动脱敏；自定义秘密须显式标记。响应为 `null`，更新 `null` 保留、字符串替换、删除条目移除；取消秘密标记须同时替换或删除值。
- Header 大小写不敏感判重；重复返回 400，不修改配置。
- 管理员可配置内网 SMTP、Webhook、自定义 Telegram 域名及 HTTP 重定向。只使用可信目标，出站隔离由部署网络提供。

### 新后端通知（源码接线，行为待 B10）

管理员使用 /api/v1/settings/notifications：GET列表、POST新增、PUT/DELETE /:id带expectedVersion；最多64项。配置明确 webhook/email/telegram 联合，秘密用 keep/clear/replace，读取仅有存在标志。POST /:id/test测试已保存配置；POST /test-unsaved 带{config}测试未保存输入；都返回delivery受理回执，真实结果读取 /notification-deliveries，不能把queued当成功。

事件只含有限 event、subjectId 和 UTC time；模板支持 {event}/{subjectId}/{time}，Email纯文本，默认Webhook为JSON。订阅采用分发时已启用配置，不追溯新配置创建前的事件；禁用阻止后续分发，已排队项仍使用原加密快照，删除令queued失败，不能撤回已派发请求。队列最多4096在途，满载保留事件等待空位；单项20秒、串行派发。重启把dispatched标unknown，不自动重发；管理写入响应中断/认证失效也可能已提交，先只读核对。

请求64KiB、响应8MiB（包含JSON转义）；400 invalid_input、401 unauthenticated、403 forbidden、404 not_found、409 version_conflict、413 limit_exceeded、503不可用/未知。正式前端仍使用下述旧通道，迁移归F1；业务提交与事件发布分事务，未发布前崩溃可能缺事件，不作为执行结果权威。

派发前取消记 failed；SMTP 部分收件人已接受而其余拒绝记 unknown，不能据此重发整项。

### 通知容量与失败

| 范围              | 限制                                                               |
| ----------------- | ------------------------------------------------------------------ |
| 通知/测试共用队列 | 4 个并发、128 个排队；队列不跨进程保存                             |
| 通道              | 最多新建 64 条；旧超额配置保留，每事件投递 ID 最小的 64 条匹配通道 |
| SMTP              | 连接/问候 10 秒，socket 空闲 15 秒，不是总期限                     |

认证不等待投递；满载通知丢弃并记诊断，测试报错，退出可能丢失待投递任务。

### 独立重构管理入口

`/__targets-next` 使用独立后端/数据。完整 JSON 按 UTF-8 字节计量，包含外壳与转义；前端预检，后端超限返回 413 `body_too_large`。

| 请求                 | 上限                                   |
| -------------------- | -------------------------------------- |
| Connection / SSH Key | 128 KiB                                |
| Proxy                | 64 KiB                                 |
| Tag / Host Key       | 16 KiB                                 |
| 连接导入             | 每批 50 项且合计 128 KiB；超限整批拒绝 |

开发认证与终端见对应章节。

## SSH 会话

支持多标签、挂起、续接和布局定制；普通 Workspace 与 Agent SSH 分别授权和管理。

### 挂起与恢复

- 点击挂起仅标记保留；关闭标签或断线后 Backend 接管原 SSH/PTY，适合长任务。
- 有权限的设备可恢复无人使用的会话，或确认接管使用中的会话；不要求原设备的普通续接凭据。接管撤销原设备控制权，不允许双写。
- 挂起成功返回真实会话 ID；失效或注册失败不报成功。
- 恢复在历史基线和所有权提交完成后确认，不等待 SFTP。历史先显示不证明恢复完成，未确认输入不自动重发。
- 保留最近 100 MiB 原始历史，先恢复状态和尾部，旧历史按需分页；达到上限仍可恢复原 PTY。

### 自动重连

- 异常断线约 120 秒内保留原 SSH/PTY、压缩及复制/移动任务，优先续接并补回输出/结果，不重新 SSH 登录替换终端。
- 回到前台、恢复网络或返回终端时检查存活；正常链路不重连，并发恢复共用一次请求。
- 普通续接校验原标签凭据、用户、Workspace 和连接；新标签不可接管旧 Workspace。
- 待挂起标签自动恢复无人使用的会话，不抢占其他设备或关闭后来打开的启动页。页面被回收后通过挂起目录恢复；未标记会话超出窗口不保证保留。
- 主动关闭立即释放；远端退出或宽限期结束无法恢复。断线时可按终端/命令栏 Enter，或再次点击同一连接提前尝试。

### 会话容量与关闭

| 范围           | 限制                                                             |
| -------------- | ---------------------------------------------------------------- |
| 普通 Workspace | 单 Backend 64 个，包含建连预留及弱网续接；已有会话续接不重复占槽 |
| 挂起 Registry  | 每用户 32、全进程 64，包含附着/断开记录                          |
| 连续挂起       | 24 小时后终止；已恢复不按旧时间终止，再挂起重新计时              |

满载拒绝新建/恢复；Server Transfer/Suspend 的独立预算不计入普通 Workspace 上限。Backend reset/shutdown 清理挂起日志，启动清理无 owner 遗留日志，不提供跨重启挂起恢复。

跳板总期限覆盖握手/forwarding，取消后关闭已建资源，晚到 channel 不发布。远端断线回收会话，旧关闭事件不误关新 owner。命令仅零退出码且无 exit signal 算成功；关闭但缺退出状态属于未知结果，不自动重放，也不证明远端进程停止。

### 新后端开发终端

独立 `backend-next` 的 Remote HTTP/PTY 有独立 SessionOwner，不等于普通 SSH Workspace。当前 `/ws/workspace` 已承载真实终端、Files/transfer 和挂起恢复的源码；B3.1 源码与静态收口不代替实际验收。上文多标签终端、完整挂起恢复及管理 HTTP 仍以正式旧 Backend 的产品行为为基线；B3.1 源码完成并于 B10 验证前不得宣称新后端已具备全套能力。正式前端的 Protocol/客户端差异登记在固定 F-R10，不在此批修改。

**B3.1 后端源码状态（非行为验收）**：`backend-next` 已将 `/ws/workspace` 对接真实 SSH shell/关联 Files lease：终端输出、8 MiB 普通断线 journal、120 秒宽限期、generation/offset 与明确 `workspace.resumeAck`。Shell 先交付，SFTP 后台异步初始化；cwd/PID、Bash/Zsh prompt/queued cd 有源码。C4 已继续安装 `suspend.mark/prepare/commit/unmark/list/resume/resumeAck/owner.renew/history.previous/history.reset/terminate/remove/rename`，同一 SSH shell 在后台挂起 24 小时、日志最多可见 100 MiB、1000 行/4 MiB headless VT checkpoint、256 KiB 历史分页和异常断线 catalog；`/api/v1/ssh-suspend` 五管理 HTTP 与本地文本导出已接线。挂起恢复同样**必须客户端显式发送 `suspend.resumeAck`**，完整 baseline 已发送不代表 owner 已提交；失败/超时退回原挂起 owner，不在新 Workspace 创建 SSH shell。两个 ACK、管理响应及模式事件正式前端均未迁移（F-R10），静态类型/构建结论见 testing，实际行为尚未验收，故不可将此描述当作产品验收。

挂起历史只保留**最新 100 MiB**，不承诺无限向前翻页：当更早内容已被压缩窗口裁剪，前页查询必须停止，不能重复已显示内容。历史分页发送失败时不得跳过未送达的数据；关闭若仍有未经确认的远端 SSH/SFTP/本地日志清理，报告资源结果未知，而不是显示已释放成功。此为当前新后端源码设计，真实消费与故障行为仍未通过 B10。

终端已经接收过用户输入、但还未完成 Shell PID 或提示符探测时，新的后端将拒绝迟到的 Shell 内部探测/Hook 安装，避免在可能运行编辑器或全屏程序的 PTY 内注入命令；这时目录读取/切换可能不可用，不能展示虚构目录。挂起自动终止事件与日志导出需要有效的当前登录身份；无效或被撤销的 Cookie 不能继续利用先前 WS 升级结果获取管理事件。本段为待验源码行为，非正式前端承诺。

挂起恢复时，即使服务器发送完终端基线并收到 `suspend.resumeAck`，也必须继续尊重浏览器 `terminal.flow` 的已消费字节：用户尚未确认消费的输出不能被“恢复已完成”事件绕过背压。所有权租约超过 45 秒且未续期时旧附件应立即失去写入/管理权限，不能依赖周期性定时器出现短暂授权窗口。一般 `workspace.close` 也只允许当前有效附件发起；旧 generation、旧 socket 不能关闭正在接管的会话。上述新后端源码仍待 B10 实际消费验证。

同一 WS 连接内重开其他 Workspace 时，终端已消费/已发送计数必须以新附件重新计量；旧恢复请求的迟到二进制输出或失败清理不能影响新标签。挂起标记与准备/提交请求在等待磁盘或身份授权期间若已被取消、断开或替换，不得再报告标记成功；45 秒 owner 租约已过期时新设备无需等待周期扫描即可尝试恢复。此为新后端待验源码语义，正式前端 F-R10 尚未适配。

仅原 Access 会话可操作；WS 断开关闭 PTY，无挂起恢复/命令重放。正常退出等待尾部渲染，异常断线或清理失败报不可用，主动关闭不冒充正常退出。退订失败仍继续关闭底层资源；所有清理失败保留到停机汇总，不能报告清理成功。

打开、读取和关闭终端要求有效管理员会话：未认证返回 401，无权限返回 403；认证有效但资源不存在或不属于当前会话返回 404。建连完成后复查登录会话，期间失效则关闭新建资源，不交付终端。

| 范围              | 限制                                                |
| ----------------- | --------------------------------------------------- |
| 终端尺寸          | 500 列、300 行                                      |
| 输入/输出数据单帧 | 32 KiB                                              |
| 待渲染确认输出    | 128 KiB                                             |
| 已完成释放结果    | 同会话最多保留 128 条、120 秒，窗口内复用成功或失败 |

挂起初始快照最多 4 MiB UTF-8，mark/prepare/commit 的完整 JSON 消息预算为 24 MiB + 16 KiB（包含转义与外壳）；普通控制消息仍最多 1 MiB，历史前页最多 256 KiB。正式前端对接时须消费 Shared 容量，不能把原文上限当成实际发送字节上限。

新后端全 Remote 最多同时导出 2 项日志，单项完整期限 60 秒，包含渲染、响应交付与收尾；超过返回 limit_exceeded。输出每块最多 64 KiB，并在交付每块前重新检查登录身份和原资源是否仍有效；已交付内容无法撤回。终止/删除/取消会中止关联导出并等待真实资源收敛，清理无法确认时报告 operation_unknown，保留名额，不自动重放。临时日志删除失败即使 SSH 已关闭也不算清理成功。

## 命令输入框

- Enter 发送；`↑/↓` 选择历史/快捷命令，命令同步发送至选定目标。
- `Alt + ↑/↓` 切 SSH 标签，`Alt + ←/→` 切编辑器标签。
- 桌面宽栏单行，480px 及以下输入在上、按钮换行在下；矮栏可滚动，不按高度切列。手机保留常驻输入和横向工具。
- 快捷指令单击执行，Copy/Edit/Delete 使用右键菜单；仅点击分组文字编辑名称，箭头/空白展开收起，工具栏适应 pane 宽度。

### 快捷命令标签与提交

- 批量关联每批 1–1,000 个安全正整数命令 ID，标签 ID 同样校验，重复合并；非法/超量返回 400，引用不存在返回 404 `QUICK_COMMAND_TAG_REFERENCE_NOT_FOUND`，不部分写入。
- 新增/编辑命令与标签关联同事务，失败整体回滚。
- “创建标签后批量关联”是两个请求：关联失败标签仍存在，先刷新再重试关联或删除，不重复建同名标签。

### 新后端快捷命令（源码已接线，行为待 B10）

登录后通过 `/api/v1/quick-commands` 与 `/api/v1/quick-command-tags` 管理当前用户数据。命令保留变量、标签和使用次数；新增/编辑/删除/计数、标签 CRUD 与批量关联已安装，记录数据不执行 Shell。列表使用 offset/limit，命令每页最多50项，按名称或usageCount排序；标签按名称排序。每用户最多2,000命令、200标签，每命令50标签、32变量；命令16 KiB、名称256 bytes、变量值4 KiB、变量名为最多64字符的标识符且拒绝原型保留键。完整请求1 MiB、响应64 MiB，包含JSON转义。

修改/删除/计数带 expectedVersion；批量关联为 `{commands:[{id,expectedVersion}],tagId}`，最多1,000项且不重复，全部检查后同事务写入，已有关联不增加计数。删除标签同时移除关联并推进受影响命令版本；缺记录404、名称或版本冲突409。成功分别返回command/tag、deleted或实际新增count；unknown不自动重放，先只读核对。正式UI待F1。

## 历史命令

截断命令可悬停查看全文。

### 命令与路径历史

- 最近命令 10,000 条、路径 2,000 条；新增/复用时同事务裁剪，同秒优先保留本次触及记录。
- 并发写入按值合并，旧重复保留最小 ID 并更新时间。旧超额备份可导入，读取只展示窗口，下次写入再清理。

### 新后端个人历史与收藏（源码已接线，行为待 B10）

- 命令历史与路径历史保留原 `/api/v1/command-history`、`/api/v1/path-history` 的 GET/POST/DELETE 方法；仅当前用户可读写。POST分别为 `{command}` / `{path}`，按原值去重并更新时间；10,000命令/2,000路径同事务修剪，同秒保留本次记录。单条4 KiB、请求32 KiB；GET用offset/limit（默认100、最多100）返回entries/nextOffset，按时间/ID升序，完整响应4 MiB。新增返回id，删除返回deleted，清空返回count；不执行命令。分页不是跨请求快照，写入/清空后从首页刷新。生产者仍是前端HTTP，后端Workspace不自动记录。
- `/api/v1/favorite-paths` 保留收藏 CRUD、`PUT /:id/update-last-used` 及按name/lastUsedAt排序。列表默认100、每页最多100，返回entries/nextOffset；最多2,000条/用户，名称可null（256 bytes）、路径4 KiB，请求32 KiB/响应4 MiB。编辑/删除/更新时间都必填expectedVersion；修改返回favoritePath，删除返回deleted。其他用户记录视为not_found，版本冲突重新读取，unknown仅核对、不自动重放。正式前端待F1。

## 终端

- 点连接立即显示等待页，连接中禁用输入，成功启用；`＋` 打开连接/挂起启动页，不停止已有会话，后台连接完成不关闭后来打开的启动页。
- 启动页桌面双栏、手机纵向滚动且连接在前；会话栏可横滑，分组、批量管理、启动/停止录制入口常显。
- `Ctrl + Shift + C/V` 复制/粘贴；桌面有选区右键复制，无选区右键粘贴。接管鼠标的程序保留自身右键，Shift 拖选/右键可执行本地操作。
- OSC 52 只允许当前聚焦且可输入的终端，在用户按键/松开鼠标后 2 秒内写入有效 UTF-8 文本，Base64 最多 1 MiB；不读取本机剪贴板。需浏览器写入许可及 HTTPS/localhost。
- 示例：OpenCode v2.0.18 `Ctrl+X` 后 `Y`，Codex CLI 0.159.2 `Ctrl+O`；实际以应用键位为准。Shift 选区只复制终端缓冲，不拼接应用翻页。
- 移动端双指缩放字体；长按复制不反复唤起软键盘，Copy 后不强制聚焦，普通点按/Paste 恢复输入。触摸能力按设备判断，拖动不交给外层页面；选区清除后尺寸变化不复活选区。
- 小键盘固定 Esc/Fn/Shift、Tab/Ctrl/Alt；Shift 为修饰键，↑ 为方向键，Fn 切换 F1–F12。

| 范围                   | 限制    |
| ---------------------- | ------- |
| 单次终端输入           | 256 KiB |
| SSH 浏览器发送缓冲     | 1 MiB   |
| 文件二进制累计读取     | 128 MiB |
| 终端历史单次二进制响应 | 1 MiB   |

未连接/超量/背压时拒绝并提示，不重发输入；读取超限取消并释放缓冲。输出解析过慢暂停发送，解析后继续，不丢中间输出；历史恢复暂停与网络背压分别解除。

- 前台输出直接解析，后台按 80ms 或 512 KiB 合并；重绘使用动画帧及每批一次 100ms 兜底，DEC 2026 完整画面提交。浏览器冻结不触发自动重发。
- 恢复实时画面不等待历史游标重置；新翻页等待重置，旧页面不能覆盖新画面。
- 重连、前台恢复和字体加载后同步尺寸；隐藏时保留最近有效尺寸，恢复按可见区域测量。

## 文件管理器与在线编辑

- SFTP 浏览支持自然数字排序，目录始终在前，同列相等按名称排序；刷新/搜索替换远端快照，不用本地 metadata 冒充操作成功。
- `↑/↓` 选择搜索结果，`Ctrl/Shift` 多选；右键复制、剪切、粘贴、删除、重命名、权限修改；内部拖动移动，外部拖入文件/目录上传。
- 桌面列表选中项后 `Ctrl+V` 上传截图；输入框仍粘贴文字。手机使用可用文件选择器，取消不上传/报错，失败可重新选择；系统菜单由浏览器决定。
- 表格列为 Type/Name/Size/Permissions/Modified，列宽/行缩放持久化，窄栏收起次要列；路径历史/收藏弹层随视口调整，长路径可换行。
- Monaco 编辑文本；预览 Markdown、图片、PDF、电子表格、DOCX，支持多标签、刷新、宽内容横滚。文本类预览共用 `Ctrl/Cmd+F` 搜索、计数和跳转，电子表格多页时才显示分页。
- 上传/复制移动/归档/跨会话传输进入 Progress Display，可隐藏/恢复/取消/移除记录。浮窗不透明，默认 360×190px、最小 280×130px，保存位置/尺寸且不超视口；显示文件、状态、数量/字节、速度与错误，多任务窗内滚动。
- 顶部工具两端对齐、最小间距 4px；窄面板输入/按钮上下排列。大量文件或深目录建议先压缩再上传。

### 上传、下载与搜索

| 范围               | 限制                                                       |
| ------------------ | ---------------------------------------------------------- |
| Workspace 文件操作 | 16 个准备/上传/复制移动/归档操作，控制 WS 64 个请求        |
| 上传目录 batch     | 30 分钟滑动有效期，过期须重新 prepare                      |
| 活跃上传           | 5 分钟无有效块或写入无法收敛则失败并清理临时文件           |
| GET/ZIP 下载       | 单用户部署共用 8 个在途任务，满载 429；HEAD 不打开流       |
| 下载预读           | 每流 16 KiB × 最多 64 块，约 1 MiB；按顺序输出，支持 Range |
| 递归搜索           | 8 个并行目录、500 个结果、5,000 个扫描目录                 |
| 上传目录准备       | 按深度分层，每层最多 8 路，全部准备后才上传文件            |

- 上传保留分块顺序、声明大小和完成校验，使用临时文件。下载名额等待真实读取收敛后归还，HTTP 断开不提前释放；不承诺带宽/公平分配。
- 搜索超限标记截断；根目录失败报错，子目录失败跳过，不跟随目录链接，不承诺遍历顺序。
- 目录准备失败停止新任务并等待已启动任务，可能留下空目录，不递归回滚；仅明确目录类型冲突可释放变更租约，其他未知结果保留隔离。隐式父目录不自动成为授权上传目标。
- 重复二进制 requestId 拒绝，不接管原读取；原请求仍可取消。

### 编辑、预览与失败恢复

- 文本打开/重载/换编码最多 16 MiB，Large File Mode 不突破容量；预览每 socket 4 个读取，单请求最多 64 MiB，实际接收时检查增长。`maxBytes` 必须正安全整数；关闭预览取消读取，不保证远端即时终止。
- 保存先写同目录临时文件再 replace，保留编码/mode，失败不先截断原文件；原子性取决于远端 replace/rename 支持，断链后须核对实际文件。
- 重命名/删除失效旧路径及后代文档，草稿保留但旧标签不可保存；保存中阻止该文件操作。操作失败须检查实际路径后重新打开。
- 关闭文档/批量标签/弹窗确认丢弃草稿，保存中不可关闭；强制断连保留可复制草稿但不能保存。草稿不跨网页刷新，旧打开请求不插入已失效标签。
- 批量删除/解压可部分成功，无逐项删除结果清单；失败刷新核对，未知结果不自动重试。双文件管理器属实验功能，多编辑器布局未完整支持。
- 失败/取消等待并行写入和句柄收敛后清理。归档须远端退出码/exit signal 才确认结束；仅 channel 关闭或清理结果不明返回 `OPERATION_OUTCOME_UNKNOWN`，隔离资源，不推定回滚或 writer 停止。

### 服务器传输

| 范围   | 限制                                                                        |
| ------ | --------------------------------------------------------------------------- |
| 任务   | 全进程 32 个在途，保留最近 100 个已收敛终态；取消未收敛不裁剪，不跨重启保存 |
| 单任务 | 64 个目标、256 个源项，乘积最多 1,024；重复目标 ID/源路径拒绝，须主动分批   |

探测 sshpass/rsync/scp 可取消；不同路径的同名源保留原路径，目标重名按覆盖策略，不自动改名。直传含 auto 会把目标密码/私钥/口令交给源端，须信任源服务器并逐次确认，0600/清理不隔离源端管理员；不是 Backend relay。

### 新后端独立文件资源

`/__targets-next` 确认 Host Key、保存凭据后打开独立 SFTP 资源，不借 PTY 或 Agent 项目授权。当前开发页面仍只提供目录、stat/lstat 和 UTF-8 读取；backend-next 的 B1 文件接口已补文本保存、新建、重命名、删除、mkdir/rmdir，前端写入入口延期到 F1，不等于正式文件界面已切换。

| 范围      | 限制与行为                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径      | 远端绝对路径 UTF-8 ≤4096 bytes；本批 mutation 拒绝根路径 `/`，不使用 Backend 本机 realpath 解释远端路径                                                                                                                |
| 完整目录  | 200 项、48 KiB metadata，超限失败，不返回截断快照                                                                                                                                                                      |
| 文本      | 有效 UTF-8 原文 ≤16 MiB；拒绝 NUL/明显控制字符；读取/保存普通文件，不把现有符号链接当文本目标。完整 JSON 请求/响应另按转义后的 Shared wire 预算约束                                                                    |
| 保存      | 同目录独占临时文件；预期新建时用标准 SFTP rename，目标已存在则失败，新文件默认 0600；覆盖已有文件才走 replace，并保留原 mode。客户端提交 `expectedSha256=null` 表示预期不存在，或提交读取所得 SHA-256 表示预期现有版本 |
| 基础操作  | rename 要求目标预检不存在且不主动覆盖；remove 删除单个文件或符号链接自身；mkdir 只建单层目录；rmdir 只删空目录，不递归                                                                                                 |
| 资源/期限 | 单实例 8 个，闲置约 2 分钟；JSON body 接收仍受 Platform 约 15 秒 request timeout，完整解码后单次打开/读写/基础操作的认证、指纹复查和多步文件流程约 30 秒                                                               |

绑定当前会话、目标及配置指纹，敏感操作前后复查。hash/metadata 预检只能尽力发现冲突，SSH/SFTP 不提供本批所需的原子 CAS；普通 rename 也不宣称跨所有服务器的原子 no-overwrite。覆盖已有文件优先使用服务器的 OpenSSH POSIX rename 替换；不支持时使用 backup→rename→cleanup 回退，其恢复/清理也不保证跨断线原子完成。

派发前已取消可确定没有该次文件副作用；请求已派发后若超时、断线、取消或无法确认收尾，返回 `operation_unknown`，资源退役且不自动重试。写入已生效后的读取或结果校验失败同样保持未知结果，不能按普通未写入失败处理。unknown 可能表示远端操作已经成功，也可能留下私有临时/backup 项，须重新打开资源并核对实际路径。确定失败会尽力清理临时文件；清理失败不覆盖原失败。上传/下载流与批量传输已有 B2 源码入口，见下节；挂起恢复和前端写入界面仍未迁移；真实 SSH/SFTP 与浏览器环境验收留 B10/F1。

### backend-next 的旧 Workspace Files 子协议

当前仍是源码开发入口，R2 已将 Workspace 文件 attachment 的 64 个含 pending/closing 准入名额与独立 HTTP Files 的 8 个名额分开。名额由 Files Service 持有，资源关闭真正完成后才归还，清理无法确认时不提前释放；两个入口不复用活跃 SFTP lease。有效的 `workspace.ping` 会重新核对登录会话、文件资源/目标指纹并续期，失效则拒绝并开始清理。二进制数据与 0-byte final 帧的背压等待均受同一文件操作的取消和约 30 秒期限约束，不在 Service 返回后再作无限等待。这些是源码判据，真实并发、撤销与故障行为仍留 B10，不能把 Files-only 接口当完整正式 Workspace。

为保持正式 Files 消费者的现有通信入口，backend-next 已安装 `/ws/workspace` 的 Files 子协议源码：fresh `workspace.connect`、`workspace.ping`、`filesystem.list/search/stat/readBinary/cancelRead/writeText/createDirectory/createFile/remove/rename/chmod/realpath`，以及 `filesystem.ready/error`。请求/响应继续使用旧 `{type,requestId?,payload?}` / `type=response + payload.ok/data/error` 外壳；控制消息上限 1 MiB、最多 64 个在途请求。binary read 单请求最多 64 MiB、同 socket 最多 4 个，NXW1 response frame 每帧最多 256 KiB；数据结束后先发 0-byte final frame，再发 JSON success。取消只停止当前读取 owner，不证明远端瞬时停止。读取范围固定为开始时的文件大小，后续追加不扩大本次读取；空文件只发送 final，短读报失败，固定范围不代表内容快照。断开后的资源释放绑定原 owner，不要求失效会话重新认证。

二次审核进一步把 `workspace.connect` 的 Targets 名称查询放进 Files Service 的同一 30 秒入场预算；Workspace 的 64 槽在**首次认证/目标查询之前**就预留，取消或关闭 socket 只中断本次请求，实际 SSH 清理继续由原 Service 追踪。失效心跳不再同步等待远端 close 才返回失败；无法确认的清理不提前释放名额。底层 Targets 查询没有可取消接口时，期限只保证调用方及时失败，不能声称底层数据库查询已撤销。上述均是源码事实，B10 仍需验证慢查询、失败清理及 64/65 并发。

旧事件面复查确认只有 `filesystem.ready/error`：保存、新建、删除、重命名、chmod 等 mutation 的完成由对应 request/response 表达，旧 Backend/Protocol 没有独立 `filesystem.changed` / file-modified 事件。R1 不为“修改通知”臆造新 WS 消息；界面在 mutation 响应后的刷新/失效仍由前端用例负责。

旧 Workspace Files 路径按 POSIX 绝对路径及 NUL 拒绝规则规范化，不套用上表新 HTTP 的 4096-byte 路径产品限制。list/stat 继续返回旧 metadata（含 uid/gid/atime/mtime 与 file/directory/symlink 标识）；search 保留 500 结果、5000 目录、8 并发及子目录消失时跳过并标明截断，root 或其他目录读取故障明确失败。普通 remove 对目录做 symlink-safe 递归删除且缺失路径视为 no-op；批量按输入顺序执行；明确 force 的目录依次尝试 `rm -rf`、`sudo rm -rf`。write/create 保留已知 iconv 编码、未知编码回退 UTF-8、输入 BOM 处理和 UTF-16LE/BE BOM。

旧 `RemoteTextWriter` 的“已有目标 metadata 读取失败也静默继续保存”**不再由后端兼容**：目标不存在仍是正常新文件情况，但目标存在时 stat/metadata 失败直接返回真实失败。正式前端在 F1 联调时须显式刷新/重新载入并由用户决定再次保存，不依赖后端吞错或自动重放未知写入。

R1/R2 只补齐 Files 子协议的 fresh attachment、受认证存活续期与有界读/发送；不表示整个旧 Workspace 已可在正式页面运行。异常重连的 `workspace.resume`、Terminal/status/docker/suspend 生命周期归 B3；download ticket、HEAD/Range、二进制 upload、copy/move、archive 等传输任务归 B2；旧完整 IP/2FA/会话策略归 B4。正式前端仍使用旧 `WorkspaceSocket`/capability adapters 与原 Protocol；新后端按 Shared 还原旧正常通信，尚未迁移正式前端类型或运行时。旧包原样作为参考，F1 再迁移实际消费者并删除旧定义，不增加旧路径兼容桥接。浏览器验收仍留 F1/B10。

### backend-next B2 传输开发入口（源码已收口、行为待验）

B2 源码阶段已收口，行为验收统一留 B10；当前 `/ws/workspace` 只具备 Files 子协议，不表示完整终端、重附着和挂起恢复已经迁移，正式前端对接仍后置。已有源码入口：POST /api/v1/sftp/download-ticket、GET/HEAD /api/v1/sftp/download、GET /api/v1/sftp/download-directory、独立 /ws/uploads 与 Workspace 的 upload.prepare/start/cancel/abort、transfer.copyMove/cancel。短期下载票据绑定原会话摘要、原活动文件资源实例、Workspace、目标、路径、大小/修改时间及来源 IP；直接下载接受单段 Range 或 suffix Range，206 返回 Content-Range，无法满足范围返回 416；HEAD 不读取正文，响应以流式背压和客户端关闭取消收敛。ZIP 目录下载使用有界递归、真实路径祖先去环和流式压缩，不预先缓冲整个压缩包；消费者断开或失败后，生产者和源读取者一起停止并收尾。

对照旧 `sftp.routes.ts` 再核实：非票据 GET `/download` 遇目录时也应直接流式 ZIP，HEAD `/download` 遇目录只返回 ZIP 类型头；inline 预览超出大小限制须明确返回 413 而非并发配额 429。旧版本未实现 ETag、If-Range、Last-Modified 条件下载，不为这些不存在的旧契约增加猜测性兼容。B2 已补上述源码路径，但响应流、断线和实际浏览器行为仍需 B10。

下载票据在认证、资源和指纹复查成功后才登记；HEAD/GET（含空文件、Range）只有完成响应收尾后才续期，最终 flush 失败不按成功续期。Workspace 的下载操作及票据 claim 覆盖整个交付，显式关闭或取消也覆盖 final 等待。服务器完成响应收尾不替代客户端确认文件完整；断流后核对结果，不以 headers 或进度 100% 判成功。HTTP inline 预览最多 20 MiB，按 Shared 容量定义；前端各格式可以采用更低预算。

B2 每个 Workspace 的准备、上传、copy/move 与归档共用 16 个活跃任务名额，排队任务及清理失败的保留任务也占用名额；满载返回 limit_exceeded。相同 prepareId 正在执行时返回 conflict，准备完成后 allowlist 不继续占用活跃任务名额。

上传使用独立 SFTP lease、同目录随机私有 staged 文件，按 WS binary 顺序写入，完成最后一块后提交、校验并发送 transfer.upload 终态；零字节文件不要求前端另开上传 socket。upload.prepare 单批最多 20,000 个目录，建立限定根目录的相对路径 allowlist；cancel/abort、超时、断线不能证明已派发写入回滚，未知完成保留 operation_unknown 而不自动重试。SFTP copy/move 使用文件/目录遍历、独立读写 lease、copy 后确认，move 在全部目标确认后删除源；中途可能已有副作用时按 unknown 对待。

上传 start 即使携带 prepareId，也重新检查实际父目录；prepare 创建部分目录后失败按 operation_unknown 反馈。传输路径及 prepare 拼接后的完整路径均不超过 4096 UTF-8 bytes，超限在派发前拒绝；旧 Workspace 基础文件路径政策不变。独立上传、copy/move 和归档取消只收尾自己的资源，健康 Workspace 可继续使用；显式关闭 Workspace 仍中止关联任务，包括正在排队的写操作；尚未执行的排队请求取消不会关闭健康 Workspace。跨 Workspace copy/move 任一端关闭都会中止任务，双端均追踪关联清理失败。上传临时文件、copy/move staged 文件、归档输出/stage/snapshot 清理失败，或独立资源在打开或关闭阶段无法确认清理时，安全出口返回 operation_unknown，任务 ID、任务名额及所属 Workspace 预约名额继续保留，关闭不得虚报成功；终态任务拒绝晚追加或再次取消，不自动重试。旧 attachment 的迟到传输事件不进入新 attachment。

同一已存目标与配置指纹的 copy/move 在写入前检查整批计划：父目录链接别名先规范化，源链接叶节点仍保留本体；目标与任一源相等或互为祖先/后代时拒绝，原始同路径 move 仍不做修改。冲突时重新选择目标或拆分意图，不自动换入口重试。跨目标 move 删除源前，源权限改变也停止并保留整项 unknown；删除子项造成的目录大小/mtime 变化不算外部改写。不同目标 ID 的同主机别名、bind mount 及并发路径交换不构成已解决的原子快照保证。

B2 归档执行器采用远端原生 `zip`、`unzip`/`zipinfo`、GNU `tar`，不依赖远端 Python/`pyzipper`；执行主机需要 POSIX shell、对应格式的归档工具、GNU `cp`、`od` 和基本文件管理工具。TAR 硬链接恢复另需支持 `-P` 的 `ln`。普通文件内容留在远端；ZIP 链接目标只按每项最多 4096 bytes 读取到后端。支持 ZIP、tar.gz、tar.bz2。

归档列表的名称和 metadata 分别按最多 8 MiB 解码；远端 shell 必须能设置文件大小限制，两个列表临时文件各受 8–16 MiB 上限约束（取决于 shell 的单位）。列表工具或编码读取失败直接拒绝，不接受部分列表；收尾清理失败保留 unknown。此限制只保护列表临时文件，不能当作解压任务的总磁盘硬配额。

压缩在同目录写带正确格式后缀的私有 `.part`，完成检查后 rename/replace；仅无密码 ZIP 的非零退出可在独立 `zip -T` 校验成功后携带 warning 提交，加密 ZIP 和其他失败不发布。压缩源可包含输出目录，命令按字面量排除临时归档和旧目标，路径含 `*`、`?`、`[]` 或反斜线也不作为排除通配符；源树先做有界 SFTP 扫描，拒绝控制字符、超过 20,000 项或 64 层的树。只有远端命令确定结束才尝试清理临时输出。

解压先用 GNU `cp --reflink=auto --no-dereference` 创建同目录私有快照，核对类型/大小；成员预检与提取使用同一份快照。预检交叉核对名称、类型、大小，拒绝绝对/越界、重复名称和非目录祖先，预算包含隐式目录、硬链接逻辑大小，最多 20,000 项、64 GiB 与 64 层。原生工具只提取普通文件和目录；符号链接与 TAR 硬链接排除后单独创建，再经 SFTP 核对完整 stage 后合并发布。只有链接的归档也有实际恢复路径。

符号链接仅允许归档根内的相对目标，保留原 target 字符串；支持有界的叶节点链接链和根内悬空链接，拒绝循环、越界、将链接作目录以及经过现有特殊节点的目标。路径中的 `..` 逐段检查，不以字符串规范化代替实际路径前提。TAR 硬链接必须最终指向归档内声明的普通文件，真实创建硬链接，不静默复制；不一致权限、循环及非文件目标拒绝。设备及 setuid/setgid 成员仍以 `UNSUPPORTED_ENTRY` 拒绝。不同对象类型不互相覆盖；归档内的链接、目录及文件都计入进度。

密码 ZIP 使用原生 `zip/unzip -P` 的 ZipCrypto，与旧正式方案一致：密码经 shell 转义后直接作为命令参数，**会出现在 SSH 命令字符串及远端 zip/unzip 子进程 argv 中**，此方式已明确保留。不会额外通过环境变量传递密码，不记录完整命令或回传原始诊断；不需要 Python、Expect 或交互 PTY，不提供 AES 兼容承诺。私有 stage/SFTP 检查不提供 `dir_fd/O_NOFOLLOW` 原子隔离；同 SSH 权限的并发替换仍可能产生竞态。取消、断线或超时不等于回滚，未知结果不自动重放，也不冒险清理仍可能在使用的快照。真实工具格式、权限与终态行为全部待 B10。

跨 Workspace copy/move 也已增加对源会话原 token 摘要的 Access 复验，允许当前请求会话与源 Workspace 是同用户的不同有效登录会话，无需保存原始 token；源会话撤销后应拒绝。SFTP 技术层支持 readlink/symlink，复制保留链接对象而不静默跟随目标，目录复制后尝试恢复 mode。旧版本在符号链接上隐式跟随可能改变对象类型或陷入目录循环，新实现明确纠正。

copy/move 还原旧行为：目标为普通文件时以 staged replace 覆盖，已有普通目录递归合并，同目标移动优先 SFTP rename（同路径不重复复制）；复制后恢复来源 mode 与访问/修改时间，并校验类型、大小、mode、mtime。应用时间戳用毫秒，Model 转换为 SFTP 所需 Unix 秒，不能将毫秒直接提交远端。批量请求如果包含同名目标冲突、重复源或父子源路径，**在首次远端创建前明确拒绝**，避免旧循环先部分覆盖或移动后再失败。符号链接目标已存在仍明确拒绝，避免偷偷跟随或覆盖其他文件类型；复制成功的符号链接也计入 completedFiles 并产生逐项进度事件。**能力范围已确定**：保持现有 SSH/SFTP 与原生工具部署要求，不新增远端 helper 或文件系统配额；不提供并发发布原子隔离或解压过程总磁盘硬配额。20,000 项、64 层、64 GiB 是成员预检及事后结果预算，不能防止解压期间磁盘先超量；保留结果检查和失败反馈。各格式属性、故障与终态行为仍待验收。B2 路由存在不代表全部旧功能已还原，正式前端运行时仍未迁移。真实 SSH/SFTP、ZIP、Range、WS 字节背压、晚到 cleanup、部分 move 与归档任务终态全部转 B10；源码阶段不运行行为测试。

解压现在逐项检查并发布所有成员，目标目录不存在也不整树移动；发布前复查 stage 根/父目录、普通文件大小/mtime/mode 和链接目标。新建目录先允许 owner 遍历，再恢复归档属性；隐式目录仅在本次新建时恢复属性，已有隐式目录保持原属性。发现变化会停止并保留 unknown，不自动重试；原生列表临时文件删除无法确认时同样报告 unknown；逐项 SFTP 检查仍不提供原子隔离。下载 GET（含目录 ZIP）从准入到最终响应 flush 共用 1 小时期限，HEAD 为 30 秒，超时终止未完成响应并归还名额；排队写入在开始执行前复查当前权限，撤销后不沿用排队前的授权。

GNU tar 提取使用 `--no-overwrite-dir` 防止归档中的 `./` 根条目改变私有 stage 权限。Stage 目录先临时保持 owner 可遍历；明确成员的 mode/mtime 在发布后从深到浅恢复并确认，链接确认在收紧目录权限之前执行，绝不对符号链接调用会跟随目标的 chmod/utimes。已有隐式目录没有归档属性声明时不重写属性。目标路径与链接目标在发布前复查，发现变化不虚报成功；SFTP 逐项检查仍不能隔离远端同权限并发写入。

Workspace 文件操作及传输路径、文本和密码现在同样拒绝孤立 Unicode 代理字符，避免 UTF-8 编码替换后访问不同文件名或改变内容；有效 Unicode 字符不受影响。

归档属性已补源码恢复：Unix 归档成员的普通 mode 与原生提取后的 mtime 在发布后逐项恢复并校验，目录按从深到浅的顺序处理，已有目录合并也恢复明确声明的目录属性；隐式父目录没有归档属性声明时不重写其已有属性。私有 staging 内临时保持目录 owner 可遍历，最终恢复原 mode，包括只读目录。DOS/Windows ZIP 不再按 Unix mode 误判，不宣称其携带 POSIX 权限。mtime 精度及 ZIP 本地时区以原生工具/文件格式为准，不保证 ACL、所有者或纳秒保真。

设备及 setuid/setgid 成员使用 Shared `UNSUPPORTED_ENTRY`；危险链接在派发前使用 `invalid_input`，已有目标类型冲突明确拒绝；已派发后的不确定副作用保留 `operation_unknown`，不把已发生的远端工作误报为未执行。正式前端专用提示在 F1 对接。链接恢复已经有源码，不代表实机兼容和安全验收通过；密码 argv 可见是已接受的执行方式；并发发布限制仍保留。旧正式版没有 AES 支持。

下载票据过期后拒绝新的 GET/HEAD 准入，已经接纳的慢下载可继续；成功完成续期，重复释放不会影响其他请求。目录 ZIP 长读在输出时按 5 秒间隔复查身份，撤销后停止继续交付。上传流绑定具体任务实例，同 ID 新任务不能接收旧流数据；准备配额在串行操作内判断。跨目标 move 在开始删除前复查所有源的类型、大小、mode、mtime 与链接目标，逐项删除前再次复查（目录删除子项后的大小/mtime 不比较）；观测到源变化时停止删除并报告 unknown，保留已复制的目标，不自动重试。这些检查不能识别同大小/mtime 的内容替换，也不能消除检查与删除间的 SFTP 竞争窗口。

B2 传输任务的请求标识现在由同一 Workspace 内的 upload、copy/move、archive **统一拒绝同时活跃的重名标识**；上传追加和各类取消在 await 身份验证后复查活跃任务仍是同一实例，防止晚到身份结果作用于已经结束或同 ID 新建的任务。SSH 归档 stdout 与 stderr 分别处理：仅白名单协议行进入进度/终态，stderr 在 Model 层排空，不收集或传给客户端，以免远端错误输出堵塞技术通道。上述真实取消、错帧、符号链接交换及大规模解压行为仍须 B10 检验。

## 远程桌面

支持 RDP/VNC，经 Backend Guacamole runtime 与 guacd 在浏览器访问；单 Backend 最多 16 个建连/活跃会话，满载拒绝新建，不踢旧会话。票据配额独立，任务/socket 收敛后归还名额。

新 `backend-next` 的 B3.3 开发入口已编码独立 RDP/VNC ticket 与 Guacamole bridge：使用当前认证 Cookie 调用 `POST /api/v1/connections/:id/rdp-session` 或 `vnc-session`，查询选项 width/height 为 200–8192、dpi 为 48–480；不填时 Guacamole 使用 1024×768、RDP 96 dpi。成功仅返回 `ticket` 与 `lastConnectedAt`，不泄露主机或密码；浏览器用同一个有效登录的 Cookie 在 30 秒内连接 `/ws/remote-desktop?ticket=...`，ticket 仅可消费一次。待签发最多 1,024 项（含正在查询配置的申请），连接中/活跃最多 16 个；满额拒绝，不踢旧连接。连接目标/版本已变化、密码未解密、登录撤销、ticket 重复或过期均不得继续接管旧桌面，必须重新发起签发。签发等待15秒，整个桌面初始化等待30秒，技术握手20秒；超时后原任务仍被追踪，不提前归还名额。技术握手与关闭结果不确定时，不能把 socket terminate 解释为远端成功清理。

RDP/VNC 的密码使用 Targets 中加密存储的版本化 `credentials.set`；旧新后端凭据提交接口不同，正式前端的保存/更新/错误反馈和 Guacamole 客户端对接归 F-R12，当前不保证旧前端直接访问新后端。RDP 的 RemoteApp、证书忽略、显示动态更新及 VNC 鼠标/键盘行为保持设计语义，尚未取得新后端真实 guacd 或 B10 浏览器/远端实测。新的 HTTP 错误使用 `{code}` 安全类别，不再返回第三方错误文字；B4 完整 IP/2FA/认证策略未完成前不得称权限等价于旧正式包。

当前新 RDP/VNC 技术连接只接受 `direct` route：旧 Guacamole 入口也未真正实现桌面 Proxy/Jump 转发，不能将带 Proxy 标记的目标静默直连并声称已走代理。声明为其他 route 的桌面目标会被拒绝，前端明确解释留 F-R12。Guacamole 连接建立只以 guacd ready 判定；本地 WebSocket 终止、Guacamole `close` 和底层 guacd TCP 真正关闭是不同事实，只有确认全部所属技术资源、初始化和授权轮询结束才释放会话名额。本段仍是未运行 B10 的新后端行为设计，不是实际通过记录。

手机点按只操作鼠标；选输入区域后用右上“键盘”按钮开关软键盘，全屏可用，最小化/断开释放焦点。设计见 [远程桌面架构](architecture/REMOTE_DESKTOP.md)。

## Agent

- 首次启用按 onboarding 安装官方签名 Plugin，在 Settings 配 Provider/模型/SSH 授权；认证后悬浮 Host 可跨页面保留 Thread/Run，设置 Goal、提交输入、查看 Plan/审批/Artifact/Checkpoint/历史。
- 运行中输入进入持久队列，按状态中断或后续消费。远程 File/Shell/ACP 只使用显式授权 SSH，Browser 使用独立 Backend CDP，不回落 Backend 本机。
- Agent Workspace/Runner/Toolchain 与旧 environment/profile/manifest/job 契约已移除，旧配置、Runner Manifest/备份不能自动转换。迁移 #58 删除旧表及相关设置，不删除普通终端/SSH 数据或用户外部备份；普通 Workspace、Artifact/Memory 保留。
- Plugin 只获得声明并授权的 capability。旧 Workspace 或混合 grant 拒绝，不自动转 SSH；Root/Child mutation 仍受目标、审批、lease 约束。
- 悬浮按钮 44px，可拖动、贴边半隐藏、悬停/聚焦展开，手机点击露出部分打开；保存位置/贴边侧，右键重置。窗口拖动，缩放围绕中心，边界限制鼠标/键盘扩展。
- 设置开关靠右，窄栏状态/数量/开关等宽；SSH/模型弹层随视口定位。SSH 列表独立滚动，全选显示空/部分/全选及数量，运行冻结时不可改目标。

### Provider 与模型配置

每模型选择调用协议，未设置沿用 Provider 默认；保存、测试、运行一致，不自动降级。测试执行真实模型请求，显示本地化类别与安全码；能访问网站/模型列表不等于调用成功。模型名称完整换行，桌面操作四列、手机两列，按钮至少 32px。

| 错误码                                                                                | 含义                               |
| ------------------------------------------------------------------------------------- | ---------------------------------- |
| `PROVIDER_RESPONSE_INVALID` / `PROVIDER_RESPONSE_EMPTY` / `PROVIDER_STREAM_TRUNCATED` | 格式、空响应、未完成流             |
| `PROVIDER_HTTP_<status>`                                                              | 原上游 HTTP 状态，包括 401/403/429 |
| `PROVIDER_DNS_FAILED` / `PROVIDER_TLS_FAILED` / `PROVIDER_NETWORK_FAILED`             | DNS、证书、网络故障                |
| `PROVIDER_NETWORK_TIMEOUT` / `PROVIDER_TEST_TIMEOUT` / `PROVIDER_DISCOVERY_TIMEOUT`   | 对应超时                           |
| `PROVIDER_REQUEST_FAILED`                                                             | 未分类失败                         |
| `PROVIDER_UNAVAILABLE`                                                                | Provider 不存在/停用               |

响应缺 ID 不伪造。OpenAI-compatible 支持可信管理员配置的本地/内网 HTTP(S)，discovery/test/run 共用 baseUrl；无私网封禁/逐跳 allowlist/DNS pinning，网络隔离由部署负责。

### Agent 长对话上下文

- 使用冻结模型按历史顺序分批摘要，保留近期完整交互，关注目标/约束/纠正/决策/状态/下一步/证据；不按关键词或首尾裁切代替语义摘要。
- 摘要计入请求/活动时间/token，不作为回复、不提前消费输入/mailbox；空、截断、取消、超预算或来源变化不覆盖有效摘要。
- 不缩小或不能安全压缩时，仅完整原始历史仍符合硬预算才继续，否则明确结束/中断；超大单条明确失败。原始对话/工具结果保留，摘要可能遗漏细节且不授予权限。
- `tool_result_read` 用 ToolCall 引用/hash、Unicode offset/nextOffset 分页当前已捕获结果，不重执行原工具；范围隔离/预算仍生效，capture limit 外内容不可恢复，读取不改变原验证结论。
- Child 不继承 Root 私有对话、Recall、Goal/Plan，只使用委派资料与自身历史；保留已消费纠正，不因 8 组工具自动遗忘。摘要失败不覆盖旧历史，不能安全继续则明确结束，由父级决定重委派。
- Child 交接从全部已保存成功且已验证历史收集证据，最多 64 个引用/16 个工具摘要；超量或读取失败明确失败，不删除原始数据。
- 实时事件按字段解码，其余合法事件刷新快照，sequence 去重/续接；未知事件、非法 payload/schema 报错，不静默跳过。

新后端已接线 Run-local 交换、Thread 历史和逐步骤持久内容快照，默认执行关闭，行为待 B10。Root 按 Thread 内序号读取此前 Root，保留失败/取消/unknown 及实际记录的工具结果，缺失结果不补成功；历史仅作为不可信数据，不授予权限。Child 不继承父私有历史。一组当前 proposal 的全部结果确定后才进入下一轮。历史来源最多4096个 Root，未压缩部分最多1024步骤、4096工具、512KiB原始正文；每 Run 最多1024消息，消息与工具定义合计4MiB。派发前估算完整 UTF-8/JSON、框架及冻结输出预留，超限拒绝，不静默截断或重跑工具；估算不是供应商精确 token 用量。每次步骤预留同事务保存内容、来源与哈希，来源变化或续接与账本不符时拒绝；快照不允许重启后自动重放。首轮确定拒绝只结算原版本/请求且无步骤的 pending Run，后续按真实派发事实结算；未知提交不重试。语义检查点、Memory/Recall、Artifact/清理已接线；Thread 来源最多4096个 Root，只有当前来源一致的持久摘要可替换已覆盖前缀，未压缩部分仍受容量约束；行为待 B10。

新后端工具结果账本最多保存256KiB原始捕获文本；模型直接结果超过8KiB时改为标记 captured_result_preview，包含 toolCallId、SHA-256、originalBytes、首段及nextOffset，原文不删除。tool_result_read v2传toolCallId/sha256，可选offset（默认0）和maxBytes（默认4096，8–4096）；offset/nextOffset计Unicode码点，maxBytes计JSON编码文本（含引号），nextOffset=null表示结束。仅读取同user/App/Run较早模型步骤的completed结果，拒绝Root/Child互读、unknown/缺失正文、hash变化及递归读取续读工具；需要context.read及原工具当前权限，原SSH目标版本在结果确认事务复查。连接目录结果若当前选择中存在denylist项则拒绝续读。页和预览均非授权/当前指令，不能恢复执行capture已丢弃输出。原始账本和下一轮投影在步骤预留事务通过Model验证，不绕过完整工具组；整个上下文仍可能明确超限。执行冻结/行为待B10保持。

### 审批、协作与 Browser

- `ask` 逐次审批；`full_access` 只在已有 capability/目标/deny 内自动批准，无按路径/命令记忆批准的第三档。Child 仍受 grant；审批后重检，拒绝/过期/新输入失效旧审批。
- `plan` 对 Root/Child 仅开放 read/control，执行和审批消费前拒绝写入，full_access 不解除禁写。
- execute 的 deferred 原生/MCP 及 Child MCP 用 `tool_search` + 版本绑定 `tool_invoke` 按需发现；发现不授予执行权限，过期引用/旧检查拒绝，须重新发现检查。plan 直接提供可用原生 read/control。
- Child 仅瞬态连接/429/502/503/504 在冻结模型、期限/预算内退避；失败计 usage，不提交部分回复/建议或消费 mailbox，不重放工具副作用。
- `/interrupt` 只中断 streaming Root；仅 Child streaming 返回冲突。Goal/普通输入/队列更新不自动取消 Child，纠正用 mailbox；移动/删除待输入仅中断 Root 流，不中断已开始命令。
- Root join 未满足时让出执行槽，不发模型请求；单独取消 Child 可唤醒 Root。取消 Run 中断全部参与者，结算后 cancelling→cancelled，使审批失效并回收 Browser，不回滚副作用。
- 停机/新输入/目标更新不误记用户取消；重启只按安全 checkpoint 创建新执行，不恢复旧模型流/Child 原地执行。
- `browser_session_open` 必须配置 targetId，仅 via=backend，按 user/App/Run/runtime 隔离。改目标 endpoints/URL allowlist 或删除目标会关旧 Session；无关设置变化不误关。导航/子请求/下载仍受 URL 与审批边界。
- 点击/输入须最新 snapshot nodeRef。派发前拒绝旧引用返回 `BROWSER_NODE_STALE`，读取新 snapshot 后再决策；派发后的断连/超时仍可能有副作用。

### Agent 执行额度与进度

| 范围        | 默认额度                                         |
| ----------- | ------------------------------------------------ |
| Balanced    | 80 次模型请求、1800 秒                           |
| Deep        | 150 次、3600 秒                                  |
| hard limits | 400 次模型请求、4000 次工具执行、7200 秒活动时间 |
| 收尾预留    | Root 最多 2 次请求、30 秒，Child 不占用请求预留  |

- `maxModelRequests` 包含 Root/Child/摘要/重试/fallback 每次获准请求，失败/取消不退；`toolExecutions` 仅实际启动，批量逐项计，检查拒绝不计。
- App 策略可降低自动扩展上限，Run 冻结边界；修改设置不改在途 Run。工具/请求受各自及冻结期限限制，不为初始软额度强行打断副作用。
- 新成功观察或验证/Artifact 证据、无循环警告且最近三次工具非连续失败时，当前批次完成后按 1.5 倍扩展至上限，记录 `budget.auto_extended`。旧证据/重复结果/只改 Plan 不支持再扩展，启发式不保证完成。
- 无进展或逼近上限记录 `budget.finishing`，停止新工具/委派，保存安全 checkpoint 和已完成/验证/未完成结果，以 interrupted 收尾；未知写操作保持隔离。
- 普通执行不等待手动增额；`awaiting_budget`/versioned API 仅保留协作 mailbox 数量/字节增额。
- checkpoint 继承累计消耗，耗尽/收尾 Run 不通过恢复绕过上限；独立新任务才有新额度。仅接受当前字段，不保留 maxRunSteps/maxSteps/usage.steps 别名。
- 进度展示持久 Goal/Plan/验证、消耗与剩余额度，不虚构百分比，Plan 完成不等于验证通过。deadlineAt 使用服务器 currentUnixSeconds，不能超过 Root 剩余硬时间或父委派期限。

### Agent 项目目录规则

- SSH 用 `project_directory_bind(connectionId, directory)` 绑定绝对目录，read/clear 查看/清除。按 user/App/Thread/connection 持久隔离，获文件权限的 Child 可共享；删 Thread/停用 App 清除，不改变 cwd/连接或授予权限。
- 从绑定根到已探索子目录读取 AGENTS.md/AGENT.md，大小写不限，目录浅到深/同目录文件名排序；不读远端 home、项目外或 CLAUDE.md。配置变更不自动换目标。
- 仅从已观察且有显式 SSH ID 的 File/Shell 路径推导最多 8 个目标目录，不从 Goal/Plan 猜目标或全仓扫描。
- 规则只指导对应目标/子树，不覆盖用户/安全/审批，冲突提出；每次请求重读，不可用不伪造或写长期 Memory。
- 最多 16 文件，每正文 16 KiB，合计 64 KiB；源文件超过 64 KiB 不加载，上下文预算可再截断。历史 Workspace 根规则不恢复退役的 Agent Workspace 执行能力。

### Agent SSH 长会话与后台任务

| 范围     | 限制                                                                  |
| -------- | --------------------------------------------------------------------- |
| 前台命令 | 最长 300 秒，受剩余工具期限限制                                       |
| 后台 Job | 默认 3600 秒、最长 86400 秒，每用户 32 个活跃任务                     |
| 长会话   | 默认闲置 1800 秒，0 不空闲关闭，最大 86400 秒；每用户 32、服务 128 条 |

- `ssh_session_open(connectionId, idleTimeoutSeconds?)` 返回 sessionId；list 查看当前 Thread 的目标状态/活动数，close 普通拒绝活动会话，force 按破坏性操作审批。
- 同 user/App/Thread 的 Root/Child 可显式共享，仍校验授权；跨范围拒绝。exec/SFTP 各自独立 channel，不继承前次 cwd/env；远端共享文件/服务可能互相影响。
- 任务结束不自动关长连接；删 Thread、停用 App、撤权、配置变更、服务退出清理。任务运行时不空闲回收。
- `shell_execute` 接受 `{kind:"argv",argv:[...]}` 或 `{kind:"shell",shellScript:"..."}`、可选 cwd/sessionId；argv 安全引用，shellScript 由远端 Shell 执行。旧 text/Workspace 拒绝，env 显式传入。
- 不带 sessionId 临时建连，指定时同连接检查/执行/验证；失效不自动重连、降级或重放，后台必须显式 sessionId。
- 后台返回原 jobId；`shell_job_control(target="ssh", id=连接ID, jobId, action="status/wait/cancel")` 管理，list 不带 jobId，只列本范围活跃受管 Job，不列任意进程。授权/配置失效拒绝，不重绑。
- accepted/running 不算成功；wait 超时保留原身份，服务用健康检查验收。timeoutSeconds 是实际执行期限，不是启动探测，过期不自动重启。
- Job 状态/终态持久保存，不存原命令/凭据；断连、force close、重启未确认任务标 unknown，不重放。单 Job 取消不关闭共享连接，远端退出证据才确认停止。
- 临时文件操作取消关闭临时连接；显式长连接只关闭本次 SFTP channel，待 I/O 拒绝，不影响其他操作/Job。force close 不证明全部远端进程停止。

### SSH 工具与控制中断

- 工具使用当前 shell__/ssh__/file__/machine__/workspace__/collaboration__/memory__/browser__/tool__/skill__/plan__/user__/artifact__/acp__/mcp_* 名称，不保留旧别名。
- 七项 file_read/list/search/write/patch/move/delete 仅显式 target=ssh 和授权连接，不改选目标或本地执行；代码调查用这些文件工具，验证用授权 Shell，不提供语言语义导航。
- file_search 用 JS Unicode 正则 u flag，每行首匹配，column 为 1-based UTF-16；glob 相对搜索目录或 basename，不按是否有 rg 改语义。不限制扫描目录/文件/累计字节，结果及输出有界；单文件 1 MiB，超量跳过并标 truncated，继续其他文件，不改变 file_read 契约。
- file_write 新建默认 0600，覆盖/patch 保留 mode；可选十进制权限 0–511（384=0600，420=0644），纳入审批 hash 并验证。
- file_move 源不存在/同路径/目标存在分别 FILE_NOT_FOUND / FILE_MOVE_SAME_PATH / FILE_MOVE_DESTINATION_EXISTS，不覆盖；write 目录为 FILE_WRITE_REQUIRES_FILE，delete/search 不存在为 FILE_NOT_FOUND。FILE_ARGUMENT_* 指明字段/约束，不回显值/路径。
- 多文件 patch 全部预检后逐文件替换，非集合原子提交；仅全部成功为 applied，失败可部分修改，重读全部内容/hash 后重规划。
- 已确认非零命令退出保留 stdout/stderr/码，不仅因此隔离；超时/断链/缺退出状态/signal 属未知副作用，不自动重放。

### ACP

仅 SSH：配置远端 argv JSON 数组、绝对 cwd，env 显式传入，不自动装程序。`acp_execute` 必须 integrationId、target=ssh、已选 connection ID、prompt，可选绝对 cwd；旧 Workspace/profile/generation/别名或省略目标拒绝。

非 PTY ACP v1 channel 执行前重检集成版本、SSH 配置和冻结目标；full_access 不跳过内层敏感操作审批。取消关本次执行，晚批准不继续；断链 unknown 可使 Run interrupted，不重放、不保证回滚。ACP 非 OS 沙箱，协议完成仍须独立验证。

### 执行、完成判定与治理

- 副作用身份是持久 ToolCall；协议重放先核对，不重新启动 Job，新 ToolCall 即使同参数也是新操作，审批 hash 不代替执行身份。
- 重复失败/观察或无进展先提示调整，再暂停；loopPause 与澄清输入分开，暂停不取消后台 Job，不自动重放/停止占端口者。
- Plan 只含当前交付，未请求修复/部署作为建议。完成门禁拒绝后继续必要工作、取消范围外未来项，或结构化询问并挂起；blocked 不等于已请求输入，不自动放行/推定授权。
- 遵守用户最终输出格式，必要 Plan/验证先记录；模型指令不保证输出成功，权限/完成门禁独立执行。
- 派发前参数/授权/目标拒绝明确未执行，保留 VALIDATION_FAILED、TOOL_ARGUMENTS_INVALID、APP_CAPABILITY_DENIED 等原码，不统一成 RESOURCE_FORBIDDEN；后派发异常仍核对副作用。
- 成功测试后普通已确认空闲 close 不废弃证据；改文件/重启命令/force close 须重新验证，accepted/running 不是测试通过。
- Root/Child 共用 Runtime 并发，满载 queued，Root 按 App 轮转，不承诺严格公平。单轮 Root 64、Child 32 个 ToolCall；Responses continuation 512 parts/64 identity，超量批次不执行。

### 运行额度、终态与清理

Run completed/completed_unverified/failed/cancelled/interrupted 回收 Browser Session；等待审批/预算或新输入不自动关闭，Child 结束不关闭整个 Run。interrupted 的 checkpoint 新 Run 须新建 Session；显式/global close 仍生效。关闭连接不等于停远端浏览器，失败诊断及全局清理兜底。

### Memory

候选 confidence 为 0–1 有限小数，经用户审核发布才 Recall。管理/跨 App 导入每页 200，创建时间/ID 倒序，审核不改排序，重载从首页；非跨请求快照。revoked/expired 历史保留，无总量硬配额，Recall 限制不等于存储容量。

### Artifact 容量与清理

每批预览最旧 1,000 个可回收对象，确认重检保留/授权/活跃 Run，仅清理本批，可再次预览继续。

### Plugin 与 MCP

- Stage 全 Backend 8 个，24 小时过期后清理；每个 archive 50 MiB/展开 200 MiB，约 2 GiB payload 不是总磁盘上限。
- 包身份 appId+version 全局不可变，同版本不同内容拒绝，换 publisher 不扩 namespace；改内容须新版本/App ID。verify 元数据无自动回收。
- Publisher 撤销保留记录，禁止新验证，可显式重新信任；列表全量，无分页/自动历史删除。
- 可信 catalog/包地址支持内网/重定向，无逐跳 allowlist/DNS pinning；签名不是网络隔离。
- 前端/SDK 静态代码可匿名缓存获取，含 sourcemap 不可放秘密；代码可见不授予 App/RPC 权限。
- MCP 每 integration 有限制，无 aggregate 硬配额；Backend Plugin 独立 Node 进程，也无 aggregate 进程配额，按部署资源启停。

### 新后端 MCP、ACP 与 Browser（源码就绪，行为待 B10）

- 管理员通过 `/api/v1/apps/:appId/integrations` 查询/创建，`/:integrationId` 查询、PATCH 和删除；`/:integrationId/refresh` 刷新 MCP 目录。创建用 UUID `Idempotency-Key`，修改/删除/刷新用 `expectedVersion`；未知结果保留原键、输入和版本，不自动重放。同一创建键重放返回首次提交的安全回执，即使该集成之后修改或删除也不重建；回执只说明首次创建结果，当前状态另行查询。每 App 最多128项，配置 JSON 最多32 KiB、完整响应16 MiB，时间为毫秒。MCP 为 streamable HTTP/2026-07-28，握手使用实际产品版本；ACP 显式保存 SSH connectionId/argv/cwd，保存配置的执行与直接 ACP 执行均按 destructive 风险独立审批。
- 凭据写意图为 keep/clear/replace；创建不能 keep，ACP 仅 clear。响应只有 hasCredential/credentialRevision，密码在服务器加密；URL 不允许内嵌密码。私网例外使用明确 host:port，保留合法内网 HTTPS；HTTP 仅非生产的显式 loopback例外。远端跳转/跨源拒绝，DNS地址固定到本次连接。每个MCP连接复用一个固定DNS连接池（最多4条socket），不以累计请求次数充当在途配额；技术目录/结果编码上限8 MiB、单工具schema 1 MiB，重复目录标识拒绝；关闭涵盖尚未建立完成的原连接，清理失败仍占用资源名额。
- 模型通过 `mcp_discover` 列出本 App 的 MCP ID/版本，指定 ID/版本后发现真实 tool/resource/prompt 与 schemaHash；不要求先由管理页刷新。模型调用绑定原 integrationId/version/schemaHash，派发前重取目录核对 hash；管理页已保存的目录仅为观察，不当授权。调用和每次续接沿原Run工具账本/权限/审批，不自动授予 capability。input_required返回服务器生成的续接身份，最多10分钟、全局最多128项，只能用于原user/App/Run、配置、方法、名称及参数；原始远端state不直接当权限。取消或关闭后不发布迟到续接；Run结束释放等待，重启不自动重放。远端执行结果未知不等同本地资源清理失败；真实清理失败仍保留诊断并阻止继续准入。
- Browser配置独立 GET/PUT `/api/v1/agent/browser/configuration`，CAS覆盖完整targets；最多32目标、每目标8个CDP端点和32条HTTP(S)页面规则。CDP使用明确ws/wss、allowPlaintext与verifyTls；页面规则只允许固定origin，路径可使用末尾`*`，不支持任意host通配。按 priority 从小到大尝试端点；只有上一连接的清理已确认且失败为不可用才尝试下一端点，完整期限不重置。不启用宿主浏览器或 Workspace fallback。
- Browser 工具已有 open/close/snapshot/screenshot/console/navigate/back/scroll/press/select/wait/click/type/upload/download 的真实 CDP 路径。会话限原 user/App/Run，最多 16 活跃会话与 16 在途任务；配置更新释放旧会话。存储和备份恢复也校验端点、明文许可、页面模式、数量及唯一目标，损坏配置被拒绝。快照最多 1024 节点、64 KiB、8 层；导航及已观察的 DOM 变更使引用失效；快照采集或节点解析期间失效也会拒绝，重新获取快照后再决策。建连完成后 Run 已取消时不发放会话。按键可作用于页面或同时指定 snapshotId/nodeRef 聚焦，支持导航/编辑键、KeyA–KeyZ、Digit0–Digit9、可打印 ASCII、F1–F12 与不重复的 Alt/Control/Meta/Shift 组合；失败也尝试释放每个键，结果未知不自动重放。navigate/back/scroll/press/select/click/type/upload 支持可选 settleMs（默认250ms，范围0–2000ms），仅做有界网络空闲观察；其正常超时不冒充动作失败，但断开/取消仍保留失败或未知结果。scroll 的 deltaX 可省略并取0。显式 wait 的 timeout/networkIdle 最长10秒，仍是严格等待。截图最多 8 MiB，下载最多 16 MiB，均生成 Artifact 并返回 ID/版本/hash；上传引用现有 Artifact 的 ID/版本/SHA-256，读取保护覆盖真实上传。下载拒绝跳转，不自动开放原生下载。关闭仅收尾本次独立 context/CDP，下载策略也只作用于该 context；Run 结束释放资源，不退出共享远端浏览器。全部行为待 B10。
- 插件管理位于 `/api/v1/agent/plugins`：publisher 列表/创建/CAS 撤销，Artifact stage、stage 查询/verify/install，以及 installations/versions 查询。原包预算 50 MiB、展开文件 200 MiB；Artifact 暂存来源仍受 Artifact 的 16 MiB 限制；仓库下载入口支持完整 50 MiB 包。拒绝链接、特殊条目、路径跳转、重复/未列文件；整个 TAR（含元数据/填充）也有展开上限。每用户最多 256 publisher/256 stage，JSON 请求 256 KiB、响应 32 MiB。重启只核对 staging 文件/hash，完整则转 staged，缺失/不一致转 failed，不自动安装。

- 新签名 manifest 的 frontendEntry/backendEntry 显式可空，分别限定 `frontend/` 与 `backend/`，不转换旧包。安装经 Scope 同事务写入不可变声明和用户 App，初始禁用、空 grant；签名不代替授权。撤销 publisher 同事务禁用对应 App/围栏 Run，再取消本地任务。
- `POST /installations/:appId/upgrade` 提交 expectedRevision、stageId、expectedStageVersion；`DELETE /installations/:appId` 卸载，`POST /installations/:appId/cancel-retirement` 取消退役，后两者传 expectedRevision。先持久 draining/围栏，再分别启动并等待原 Run 与 runtime 收尾；一项失败仍收尾另一项。失败保留 draining，按当前 revision 查询/继续原操作，不能自动换意图重试。取消保留旧版本且不自动启用；重启不重放退役或工具。当前覆盖 Run、前端内容、独立持久数据和后端runtime；数据迁移使用下述明确流程，不执行旧migrate回调。
- `GET /installations/:appId/descriptor` 为当前已启用、受信安装发放30分钟资源地址，绑定会话与安装revision。`/plugins/:appId/:version/:grant/<frontend asset>` 每文件16 MiB，no-store、sandbox/CSP，不提供后端代码或签名元文件。SDK入口 `/sdk/frontend-v1.mjs` 交付完整白名单依赖图；父页通过认证 `POST /installations/:appId/frontend/rpc` 转发 `{grant,envelope}`，严格关联nonce/id/seq/method/App。前端RPC完整JSON为8 MiB+1 KiB；原核心方法仍有512 KiB子预算，后端IPC仍512 KiB。单次等待30秒、最多32个待响应；写入超时、协议失败或关闭后保留原operationId与输入，不自动重发。正式父页桥留F1。
- 前端SDK的request已有26个方法（subagents.messages只返回序号/发送者/正文长度/期限，不输出模型私有mailbox正文；approvals只输出安全inspection）：原host/storage/intents九方法，加definitions/providers.list、threads.list/create/rename/entries、runs.list/get/events/create/appendInput/cancel、subagents.list/messages/cancel、approvals.list/resolve。Thread列表最多50项，新增UUID operationId和rename expectedVersion；每App最多512 Thread、4096条线程意图，重放返回原提交快照。entries只读取Root的用户输入和assistant文字，不含工具正文、凭据或私有reasoning；每页最多16片，每片4096 Unicode码点/16 KiB，完整512 KiB，以服务器四段码点游标续读，支持emoji/NUL，分片未读完不跳到后项。
- appendInput改为在同一Thread创建新的后续Root Run：原Run必须completed/failed/cancelled且expectedVersion匹配，调用方显式选择当前模型和连接；running/pending/unknown拒绝，不改写活跃上下文。`agent.runs.subscribe/unsubscribe` 是SDK本地500ms轮询既有事件页，最多8个订阅、同订阅不重叠；不是WS推送。退订取消原等待并等待任务，close返回共享Promise并等待订阅；切换/关闭后不发布迟到页。回调可以异步，须收敛；回调内不要等待自身unsubscribe/close。失败回调失败保留两项因果；订阅已退出后显式 close 仍汇总这些失败，最多保留32项并记录额外失败数量，不自动重订阅。
- 插件独立数据通过 GET/PUT/DELETE /installations/:appId/data/:key 消费；key为128-byte ASCII标识，valueJson为合法JSON文本（128 KiB），JSON null文本与删除墓碑不同。写入传 expectedRevision、expectedVersion、UUID operationId，创建用expectedVersion=0；读取返回 {value}，已删除键保留version/valueJson:null。仅当前已启用、受信安装可读写，身份/信任/版本在写入事务复核；同键同内容操作重放不重复写，不同内容冲突。每App最多1024个键（含墓碑）、当前正文8 MiB；每次清除周期最多4096个写意图、正文账本32 MiB，满额仍可重放已有确定结果。
- 升级需转换数据时先POST `/installations/:appId/prepare-upgrade`（与upgrade同输入），排空后保持draining；GET `/data-snapshot` 返回当前revision及所有键/墓碑；版本耗尽记录仍可读取，不能继续写入。管理员自行转换后POST `/migrate-data` `{expectedRevision,operationId,items:[{key,expectedVersion,valueJson}]}`，须包含快照全部键，新增键用版本0，删除用null，遗漏/旧版本拒绝。最多1024键、最终正文8 MiB、完整请求/快照52 MiB；每App最多32次迁移。数据、安装revision+1和不可变迁移回执同事务；消费者核对changedKeys不超过本次提交条目数。未知结果保持原键/输入，不重复执行插件代码。之后用新revision继续原目标upgrade；迁移已提交后禁止cancel-retirement，避免旧版本读取新数据。取消、重启及失败不自动切换版本或重放迁移。
- 卸载仅保留数据；明确删除使用 POST /installations/:appId/delete-data {expectedRevision,operationId}，仅removed安装允许。事务清除正文/历史结果正文、推进安装修订及数据墓碑，保留旧意图摘要以拒绝换内容重放；返回revision/deletedKeys/updatedAt。未知结果保留原键和输入，明确重试同一意图返回原结果；每App最多32次明确删除。重新安装不接受旧修订或重新发放旧资源grant。全部行为待 B10。

签名包可包含 `skills/<name>/SKILL.md`，最多64份，每份12KiB；name须与目录一致，description最多1024字节。支持受限 frontmatter（name/description/license/compatibility/metadata/allowed-tools），不执行文档，也不将 allowed-tools 当授权。模型通过 `skill_search` 查询当前 App 的文档元数据（query最多512字节、limit最多8），再用精确 name/version/sha256 调用 `skill_read`；需要当前 context.read grant，沿原工具账本。内置 App 返回空搜索，不跨 App 查找；文档明确为不可信内容，不再自动注入每轮提示。升级、撤销、禁用、取消和版本变化拒绝旧读取；未知写入仍不重放。

新后端插件后端入口使用独立 Node 进程：重新校验原包大小/hash/签名后物化到数据库旁的私有 `.modules` 目录，只允许该目录的文件读取，禁止子进程、Worker 和原生扩展，不继承宿主环境变量；这不是操作系统级沙箱，也不承诺网络隔离。SDK 类型位于 Shared agent/plugins/backend-sdk；模块导出可选 activate({context,request})、health()→boolean、quiesce(deadlineUnixMs)、dispose()，当前request支持host.appInfo、storage.get/put/delete和intents.create/listReceived/revoke/artifacts.get/artifacts.readRange。它们绑定原用户/App/安装revision，并在真实SQL事务复核启用与当前信任；intents使用原运行实例的存活授权，在实际事务检查安装revision/双方声明与grant，不伪造后台会话Cookie，也不继承Workspace权限；confirmed:true只是本次公开消息意图，不能替代grant。手工启用App后启动，启动复核/health失败会返回unknown，先读取已保存状态；重启只重新初始化上次已确认关闭、仍启用的受信模块；上次opening/active转unknown并停止自动激活，不重派旧Run、写意图或未知插件任务。最多32个实例、同时2个构造、每实例32个host调用；完整IPC为512KiB，初始化/控制15秒、SDK等待30秒，整体构造60秒。构造/host/进程退出/目录清理均由原owner等待；运行中异常退出会立即围栏原实例、取消它的读取并追踪清理，不继续把旧实例当可用或自动重启。退出通知不等于目录/host任务已清理，失败保留并阻止旧实例退役；升级/卸载/撤销先围栏权限，再排空Run和对应runtime。后端SDK仍限定九个已实现方法，不因前端SDK扩展获得额外Agent权限；完整备份恢复及 B8 源码复审已收口，行为待 B10。

插件运行状态可由管理员GET /api/v1/agent/plugins/installations/:appId/runtime查询，历史实例用/runtime/:instanceId。状态为opening/active/closed/unknown，包含原instanceId/revision及毫秒unknownAt/acknowledgedAt。出现unknown先完成服务重启与目录对账，再检查可能生效的写入；POST /runtime/acknowledge传{expectedRevision,instanceRevision,instanceId,confirmed:true}，两份revision分别取当前installation与原实例。确认不自动启动、不表示回滚；之后明确启用才可启动新实例，原未知证据保留。升级/卸载的draining按当前安装revision继续。运行目录对账需要Linux /proc；活父进程、缺失/损坏journal或无法确认清理会阻止启动，应保留现场排查。每用户最多4096条历史记录，满额拒绝新构造，不自动清除。所有行为仍待B10。

新后端仓库接口位于 /api/v1/agent/plugins：GET/PUT /repositories，PUT传{expectedVersion,repositories:[{url}]}，首次读取为version=0，最多16个规范HTTP/HTTPS URL（每个4096bytes），拒绝URL凭据、fragment、重复项；保存不证明远端可用。GET /official/catalog、GET /remote/catalog?repositoryUrl，远端必须已配置；原始目录1MiB/64发布者/512包，公开完整目录8MiB。版本范围与实际安装包的产品version核对，最新包sdkVersion为字符串`1`；不转换旧SDK/manifest。目录公钥允许标准 PEM 的 LF/CRLF 换行，拒绝其他控制字符；目录中的公钥不自动成为信任。POST /official/stage与/remote/stage按appId/version下载完整包，远端还带repositoryUrl；最多50MiB，大小/hash、签名与实际manifest身份均须匹配，复用同一stage/verify/install。官方来源固定公钥，显式官方stage可登记该公钥，但不能恢复已撤销信任或授予grant。包下载后复查原仓库配置版本与当前身份，变化返回冲突，重新读取配置后再发起新意图。下载最多5次重定向、120秒整体期限，插件stage仍有60秒子期限；合法管理员内网HTTP部署保留，不发出宿主凭据。源码未进行外部网络验证。

推荐入口保留GET /api/v1/agent/onboarding/recommended-plugin、POST /recommended-plugin/install（空JSON）。已安装项离线可读，安装复用既有用例；新安装仍禁用、空grant，需明确授权并启用，不自动继承旧推荐入口的全能力授权。返回entry/installation或安装对象，前端F1对齐；数据提交后交付失败保留unknown，不自动重复安装。部署必须同时提供根package.json的产品version，启动读取一次，不使用硬编码版本或工作目录猜测。

新后端跨 App 消息位于 /api/v1/agent/apps/:appId/plugin-intents：POST 创建、GET 接收列表、DELETE /:receiptId 撤销；GET /:receiptId/artifacts/:artifactId 读取元数据，GET 同路径 /content 下载并支持单段 Range。仅当前管理员完整会话；发送和接收 App 均须启用、受信声明并授予 app.intents.exchange，带文件还须双方 artifacts.read。接收意图必须在当前 manifest 声明。消息绑定原 App/授权修订与声明版本，禁用、改授权或升级后旧消息不会恢复有效；接收不生成 Run、不执行模型。

创建传 {operationId,receiverAppId,intentId,inputJson,artifactIds,confirmed:true}；inputJson 是显式公开 JSON 文本，最多 64 KiB、32 层，拒绝保留的凭据/隐私上下文字段名（不检测字符串正文是否包含秘密）；最多 16 个发送 App 自有、ready 的文件。有效期 10 分钟，时间为毫秒。HTTP 完整请求 512 KiB、接收列表完整响应 16 MiB，limit 默认50、最大100；不是跨请求快照。SDK 使用同一创建对象、显式 limit、receiptId 和 artifactId；RPC 仍为512 KiB，列表编码超限时减小 limit，不截断正文；后端SDK保留1 KiB IPC封装余量。intents.artifacts.readRange传{receiptId,artifactId,start,endInclusive}，单次最多128 KiB且结束字节必须存在；返回同身份/范围的dataBase64，严格校验完整长度和规范编码，短读或授权失效不交付部分结果。两端均复用Artifact lease，运行实例退役取消对应读取。

创建与文件授权同一事务，原 operationId/内容重放不会重复发消息，改内容冲突；撤销后/过期后原键拒绝，不复活旧意图。每发送 App 最多100条有效消息，每用户最多4096条持久意图、正文64 MiB；过期或撤销不删除防重放证据，满额明确拒绝新消息，仍可查询/撤销及重放有效确定结果。管理面身份允许在 App 禁用后撤销自己的发送消息；SDK 仍须有效资源授权。有效文件授权进入 Artifact 删除/清理/容量保护，流由 Artifact owner 持有 lease，每块交付前复查原会话、双方当前修订、有效期和文件版本；撤销/失效终止后续交付，已交付字节不能撤回。SQLite unknown、响应断流与已提交后身份失效不得自动换键重发。真实行为待 B10，正式 UI/SDK 父页对接留 F1。

### Plugin 安装、幂等与生命周期

- intents.create 首次前持久保存 UUID operationId，未知结果同 ID/同 payload 重试；不同 payload 拒绝，重试仍校验 App/grant。receipt 仅 10 分钟，过期先核对业务，不保证外部动作一次性。
- SDK 创建 Thread/Run、追加输入、Run 取消、审批透传稳定身份；Thread 重命名/Child 取消用 CAS，超时重读，不盲目带新版本重发。
- 同用户/App 首次安装串行，先完成版本生效，后请求走 upgrade。升级/卸载 drain App Run/runtime；Runner Manifest 拒绝，无安装引用旧包可清理。
- Frontend Run 订阅每实例 2、每页面合计 4，同实例不重复订同 Run，取消 transport 收敛后归还。
- ready 30 秒超时 PLUGIN_BACKEND_READY_TIMEOUT，RPC 写入/drain 有硬期限，不无限等待。正常关闭须 dispose/操作收敛并确认退出；SIGTERM 2 秒后 SIGKILL 再等 5 秒，未确认报错，只保证直接子进程。
- 重启恢复 builtin/已装 App 的 enabled MCP，失败显示错误，可刷新；全局 Agent 开关 quiesce/启用两类 App，生命周期失败记诊断，不回滚配置或保证所有插件按时退出。
- 删除/禁用使旧 integration refresh 失效，临时 generation 在在途任务结束回收。

### HTTP 来源与认证

正式 Agent 来源拒绝保留 `error.code=CSRF_REJECTED` envelope/request ID；通用规则见 [安全与认证](#安全与认证)。

新后端状态接口与开发前端源码已接入，正式 Agent 不切换。DEV 路由 `/__agent-next` 只支持创建 App/Thread/Run、读取/取消 Run 和事件分页；新 Run 初始 pending、可取消为 cancelled；完整状态联合已包含 running/completed/failed/unknown，**当前没有获授权的模型执行者使 Run 进入真实运行/完成**。真实浏览器行为仍待验收，旧 DEV 消费差异归 F1。

| 范围 | 限制与语义                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 认证 | 使用新 Access 会话，只允许管理员 userId=1；不接受客户端自报身份                                                                 |
| 名称 | name/title 原始 UTF-8 ≤128 bytes，保存前 trim                                                                                   |
| 输入 | prompt UTF-8 ≤16 KiB，不允许全空白，保留原文；创建 Run 完整 JSON ≤128 KiB，其余 JSON ≤16 KiB                                    |
| 响应 | 完整 UTF-8 JSON ≤32 KiB，包含分页外壳及转义                                                                                     |
| 变更 | 创建/取消使用 UUID Idempotency-Key；同 key 同输入重放原提交快照，内容不同报冲突；取消带 expectedVersion，版本不一致报冲突       |
| 分页 | after 默认0，limit 默认50/最大100；nextCursor 为最后事件序号，空页保持传入游标；重复/未知 query 拒绝                            |
| 前端 | Targets/Agent 共用 Auth next 的公开认证 client；切 scope/run、登录或卸载取消旧等待并失效 generation；事件按 runId/sequence 去重 |

同 App/Thread 只允许一个活动 Run（pending/running/unknown 均占用名额）；明确完成或失败后才释放。网络失败、协议异常或提交结果未知不能证明未写入，重试保持原 key 和输入；改变输入才形成新意图，不自动生成新 key 重放。version_conflict 显示冲突并尝试读取最新 Run，不自动用新版本继续取消；已完成的 Run 拒绝取消，unknown 允许有版本条件地取消但不保证远端回滚。安全失败只返回 code；非 JSON、未知状态/错误码或错误 shape 显示协议失败，不伪造成功，也不返回 prompt、hash、秘密或技术 cause。开发入口与剩余项见 [下一阶段方案](后端重构下一阶段实施方案.md#延后的前端事项未验收不删除)。

### 新后端项目目录与突变占用（源码已接线，行为待 B10）

- 旧正式 Agent 长会话仍按上方说明运行；新后端移除 ssh_session_open/list/close 和 sessionId，使用独立45秒 Remote 任务及当前 Run 的 Job/取消管理，不继承 shell cwd/env，不共享 Root/Child 活跃连接。
- project_directory_bind v2 参数 connectionId/directory；read 参数 connectionId/可选 path；clear 只有 connectionId。目录绝对路径≤256 UTF-8 bytes，read 仅允许绑定根及深度≤8的子目录。未绑定返回空上下文；目标 version/fingerprint 变化报冲突，重新绑定须独立批准。绑定按 Run 独立保存，删除 Run/connection 清理，不沿用旧 Thread 共享。
- 从绑定根到选定子目录读取不区分大小写的 AGENT.md/AGENTS.md，最多4份、每份≤8 KiB，拒绝链接、超量和越界；返回 path/scopePath/text/sha256。指导是不可信工具数据，不自动变为系统提示、Shell cwd 或权限；bind/clear 需要当前 file.read 与单次批准，read 需要当前只读授权。
- Agent 文件/Shell/Job/ACP/Docker、普通 Files/上传/复制移动/归档/权限修改与 Workspace Docker 按 lowercase host+port 共用持久独占占用。不同连接ID、用户或凭据不能绕过同一文本 endpoint；跨主机复制/移动原子占用两端。冲突直接拒绝，最多128个 endpoint，不自动排队/重试；同资源已有 Files 队列保留。
- 结果及清理确认才释放，unknown/清理失败和重启后的遗留占用保持 blocked；先只读核对，不按 TTL/重启/改连接自动放行。当前没有解锁入口，B9须补证据核对与授权恢复。DNS/IP别名无法准确合并；交互PTY、外部进程及远端派生进程不受数据库锁隔离。执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 行为待 B10。

### 新后端 App、授权与审批（源码范围）

新后端内置声明为 `nexus.terminal@1.3.0`，声明文件读/写/删除、状态、Shell、Docker、ACP 调用、本地协作与context.read能力；声明不等于授权或已能执行工具。声明 ID 与 App 实例 UUID 分开：GET `/api/v1/agent/apps` 首次为当前账号原子初始化默认实例，默认启用、grants 为空。重启不重建已存在实例，不恢复用户撤回的权限。治理操作遇到实例缺失必需政策记录时返回安全失败，不静默补权限或假定默认状态。创建新实例使用受信来源，不按名称自动绑定旧实例。

| App / 目标管理接口                      | 操作                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/api/v1/agent/app-definitions`     | 读取服务器受信声明，客户端不能自报 capabilities、版本或执行状态                                                                                                                      |
| GET/POST `/api/v1/agent/apps`           | 读取实例列表；POST `{name,definitionId?}`，省略来源时使用内置声明，返回新 UUID；列表最多 1024 项，超限拒绝而非截断                                                                   |
| GET/PATCH `/api/v1/agent/apps/:appId`   | 读取实例；PATCH `{enabled,expectedVersion}`，CAS 冲突先读取最新实例；禁用不删除历史，启用不恢复旧 Run                                                                                |
| GET/PUT `/api/v1/agent/target-denylist` | 读取/全量替换全局 Agent 目标拒绝名单；PUT `{connectionIds,reason,expectedRevision}`，初始 revision=1，最多 50 个可信 Targets ID，reason 非空且最多 512 Unicode 码点/2048 UTF-8 bytes |

App 返回必填非空 definitionId/definitionVersion、capabilities、enabled/version、毫秒 createdAt/updatedAt 与 `executionState:governed`；enabled 只表示管理准入，不代表 running/healthy。App 列表/声明完整响应最多 8 MiB。grant 定义只显示实例当前真实声明；来源已卸载的实例拒绝授权与创建 Run（403 `app_disabled/capability_undeclared`）。

禁用或声明变更在同事务失效未决审批、围栏活动 Run/步骤，再由执行 owner 收尾。目标集合变更同事务围栏所有旧 App Run：当前 Run 未绑定单个目标，采用保守取消；仅改拒绝原因不取消 Run。取消不证明远端副作用回滚。拒绝条目保留到显式移除，目标删除后仍保留 ID 防止复用绕过；加入时经 Targets public 读取身份、提交时核对版本。denylist 的 changedAt 对外使用 Unix 秒，App/Run 时间使用毫秒。普通 SSH 不受 Agent denylist 影响。审批创建/决议复查当前声明、启用、grant、拒绝名单及目标版本；旧批准快照不是新执行许可。写入/清理结果未知时读取现状，不盲目重发或恢复运行。

当前新后端 Agent 管理员仍使用 Access 登录会话（userId=1），正式前端和生产切换**尚未**完成。新建 App 的 grant 默认**为空**，策略修订从 0 开始；不因 capability 出现在定义列表、选择 Full Access、模型答复或 SSH 连接存在就自动批准。普通 SSH 的技术通道与 Agent 授权彼此独立，Agent 还须在每次真实工具执行前复查目标身份、当前 Run、ToolCall 和授权版本；该最终执行链由 B6.2/B5-R 承接。

| 已安装的 B6.1 HTTP 路径                                  | 当前语义                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/PUT `/api/v1/agent/apps/:appId/grants`               | GET 返回当前声明的能力定义、当前 grants 与 policyRevision；PUT 带 `{expectedPolicyRevision,grants:[{capability,scope}]}`，全量替换、同事务 CAS，撤权使未决审批失效；目标 scope 为 `{kind:"targets",targets:{ssh:{mode:"all"}}}` 或 `{kind:"targets",targets:{ssh:{mode:"ids",ids:["1"]}}}`，非目标能力用 `{kind:"global"}` |
| GET/PUT `/api/v1/agent/apps/:appId/execution-policy`     | GET 返回 `{version,overrides,effective}`，PUT 带 `{expectedVersion,overrides}` 全量 CAS；秒/字节/条数必须是正安全整数并满足硬上限。effective 同事务消费全局动态设置与 App 缩窄覆盖项；Root 创建冻结实际值                                                                                                                  |
| GET `/api/v1/apps/:appId/approvals/:approvalId`          | 读取当前可见审批（含请求、截止秒时间、状态、版本、风险摘要），不存在/非本人返回 404                                                                                                                                                                                                                                        |
| GET `/api/v1/apps/:appId/runs/:runId/approvals`          | 读取此 App/Run 的审批记录数组；到期或终止 Run 的未决审批于读取事务内刷新；最多返回 1024 条，超出时明确拒绝，不截断                                                                                                                                                                                                         |
| POST `/api/v1/apps/:appId/approvals/:approvalId/resolve` | 发送 decision 为 `approved` 或 `denied`、operationHash、expectedVersion、可选 feedback，并附 UUID `Idempotency-Key`；在同一事务复查 App/Run/operationHash/policyRevision/inputRevision/TTL 后 CAS 决议；同 key 同内容重放，变更内容冲突                                                                                    |

授权目标 ID 最多 256 个、每项最多 128 UTF-8 bytes；grants 请求 JSON 上限 512 KiB，其余治理请求 16 KiB，完整响应最多 8 MiB（包含转义与 envelope）。审批列表还受到 1024 条完整记录上限约束，超出返回 413 `limit_exceeded`；仍可按 ID 查询单项，当前无分页接口。无效类型/未知字段拒绝 400，身份失效 401、非管理员 403、不存在 404、版本/审批漂移或幂等内容冲突 409；不可用/未知提交结果须保留原意图并读取现状，不得自行换 key 自动执行。审批摘要的 toolName/toolVersion 各最多 256 UTF-8 bytes、summary 2048；可选 feedback 非空且最多 2000 UTF-8 bytes。审批请求 TTL 600 秒，以实际事务决策时刻核验，超过时限不能批准；Run 取消已提交而审批失效清理失败时返回 `operation_unknown`，先读取 Run 与审批现状；`approved` 仅表示用户决议已提交，**不是**工具已派发或远端任务已成功。

新后端已安装两个管理员只读工具审计入口：`GET /api/v1/agent/apps/:appId/runs/:id/tools/:toolCallId` 及其 `/events?after=0&limit=50`。事件默认 50、最多 100 条，after/nextCursor 是状态 revision；空页保留 after，非空页取最后一项 revision。未知或重复 query、非规范整数拒绝 400；跨 user/App/Run/Tool 或不存在返回 404；交付前会话失效返回 401，非管理员 403。完整响应最多 128 KiB；只含安全身份、工具名称/版本、能力、目标 ID/version、风险/变更标志、hash/修订/状态及毫秒时间，不含参数、结果正文或供应商调用 ID。正式前端未迁移，读取审计不创建工具或授予执行许可。

新后端工具账本现已记录独立操作内容修订、状态修订及状态事件；审批读取真实操作，单次消费与派发意图同事务提交。目录、文件、Shell 和 Docker 工具已有账本与审批消费者；模型派发须 governed 准入与冻结预算，历史批准不可复用。取消/重启将未派发操作关闭、已派发操作标为 unknown，不自动重试。

新后端 Agent 状态接口（App/Thread/Run/步骤/工具及事件页）在异步结果交付前再次核验管理员会话；401/403 或交付失败不证明刚才的创建/取消未提交。写入结果不明时保留原输入与 Idempotency-Key，登录后只读核对，不自动重放。

已派发工具不能报告确定取消；Run 取消或终结后，晚到工具结果不能覆盖账本围栏。存在未结或 unknown 工具时不能报告 Run 成功。启动恢复同时核对模型步骤与工具操作，即使没有模型步骤也保留工具的未知副作用；这些源码约束仍待 B10 行为验证。

当前原执行链使用 governed 政策，默认执行关闭；目录、诊断及文件只读工具的可信检查和结果反馈已接线；file_write/patch/move/delete 的审批生产者、可取消等待、单次消费与结果反馈已接线；Shell/Docker 与当前 Run 内后台 Job 已接线；ACP调用、独立权限等待/消费、安全HTTP观察和直接 Child/协作已接线；Run-local项目目录与跨Run持久突变占用已接线，用户通知归 Operations；审批只由真实工具动作产生，POST resolve 不会虚构可批准任务。核心持久Settings已接线；外围集成/工具由B8、Settings与上下文已由B7接线、blocked恢复由B9承接；不得把新后台管理页面未迁移误认为已可操作。源码/静态与真实行为分别见 B6.1 审核及 B10。

首工具 machine_connection_list 参数只能为 {}，只返回持久选中且当前授权、未在 denylist 的 SSH 连接 id/name/host/port/username，不返回凭据或非 SSH 项。参数最多 16 KiB、结果最多 256 KiB，超限失败，不截断。结果确认持久后才回送模型；工具步骤不结束 Root，最终 stop 才可成功。当前执行须 governed 准入，未运行行为验证。DEV 尚无选中器，默认 []，多步 UI 留正式前端阶段。

新后端还提供v2只读工具：`machine_diagnostics_read({connectionId})`读取所选SSH机器的CPU百分比、内存/磁盘bytes及1/5/15分钟load指标，generatedAt为毫秒（CPU以同一任务两次采样差值计算），不读取宿主诊断；`file_read({connectionId,path})`读取整个UTF-8文件（最多32KiB，含captured-content SHA-256），不支持旧offset；`file_list({connectionId,path})`最多200条/48KiB metadata，超额拒绝；`file_search({connectionId,path,query,maxResults?})`做区分大小写字面量内容搜索，不接受旧regex/glob/contextLines。maxResults默认20、最多100，每行首匹配，行/UTF-16列从1开始；发现超量匹配时返回truncated。搜索最多100文件、100目录、8层和2MiB，超遍历/编码预算失败，不截断伪报完整结果；非文本文件跳过，文件单项超过32KiB则失败。

新后端 file_write v2 参数为 {connectionId,path,content,expectedSha256}：绝对路径最多256 UTF-8 bytes，content最多8KiB且允许空文本，完整参数JSON最多16KiB。新建必须传 expectedSha256: 'absent'；替换必须传 file_read 返回的原内容小写SHA-256。每次写入单独申请人工批准，审批摘要只含动作、路径、字节数及哈希，不展示正文。拒绝、过期、撤权或取消停止等待；批准需在当前权限/目标版本有效时消费一次，不能授权下一次写入。新建权限0600，替换保留普通权限，不保留特殊权限位，不提供旧mode参数。使用同目录暂存、提交后回读确认；哈希预检并非远端原子CAS，存在跨调用竞争窗口。暂存/提交/确认/最终交付或清理不能确认时记录unknown，不自动重放；需人工核对远端文件与临时文件。读写任务共用8个名额，整项最长45秒，清理未确认仍占名额。

新后端 file_inspect v2 参数为 {connectionId,path}，返回规范路径、kind、fingerprint、fileCount、directoryCount、bytes，不返回内容。允许普通文件（含二进制）与目录；最多100文件/100目录、深度8、单文件1MiB、累计2MiB、元数据256KiB；超过预算整项拒绝，不截断。指纹包含相对路径、权限/所有者、大小/修改时间及文件内容哈希，不是原子文件系统快照。

file_patch v2 参数为 {connectionId,path,expectedSha256,oldText,newText}，原 SHA 来自 file_read；oldText 必须非空且在原文件中唯一出现（重叠重复也拒绝），newText 可以为空，但不能与 oldText 相同。oldText/newText 各最多4KiB，原文件/结果各最多32KiB。取消旧 unified diff/多文件请求，每个文件分别调用、审批，不承诺多文件事务。

file_move v2 参数为 {connectionId,path,destinationPath,expectedFingerprint}，file_delete v2 参数为 {connectionId,path,expectedFingerprint,scope}，指纹来自 file_inspect。移动目的必须不存在，拒绝同路径/祖先关系；删除 scope:'entry' 仅普通文件或空目录，scope:'tree' 明确递归删除。路径各最多256 UTF-8 bytes，不允许控制字符、根目录、链接或特殊节点。移动/删除采用上述有界目录预算，每项独立审批；patch/move 要 file.write，delete 要 file.delete 且为 destructive，inspect 要 file.read。删除逐节点复查，部分执行或提交后确认失败为 unknown，不自动重放，人工核对源、目的和剩余树。全部工具参数完整JSON最多16KiB，审批摘要不包含文件正文。

shell_execute v2 参数为 {connectionId,kind,argv?,script?,cwd?,mode?}：kind:'argv' 只允许 argv（最多128项、原始UTF-8合计8KiB），kind:'shell' 只允许可执行 script（8KiB）。cwd 可选绝对路径，最多256 bytes；mode 默认 foreground，也可 background。所有执行均需 shell.execute 和独立 destructive 人工批准，不根据命令文本推断安全。前台返回真实退出状态、stdout/stderr（合计捕获32KiB）和 truncated；非零退出是确认的命令失败。后台返回 {jobId,accepted:true}，只表示受理，不表示进程健康或成功。完整参数JSON最多16KiB，结果最多256KiB，包含转义预算。

shell_job_control v2 使用 {connectionId,action,jobId?,waitSeconds?}。list 不传 jobId；status/wait/cancel 使用原 Shell 工具账本 UUID，只操作当前 user/App/Run（Root 或 Child 各自隔离）、目标版本和指纹一致的 Job。list/status/wait 需当前 shell.execute；cancel 还需独立 control 批准。wait 默认10秒、最多30秒，等待结束不取消 Job。状态为 queued/dispatched/completed/failed/unknown；dispatched 是派发意图，非进程健康。每 Run 最多64条历史，全后端最多8个活跃 Job预约，远端与文件任务仍共用8个资源名额。后台属于实际 Run，Root/Child 各自在结束/取消时收尾自己的 Job，Root 最终收尾覆盖整族；unknown 子任务阻止 Root 成功。启动将 queued 转 failed/not_started、dispatched 转 unknown，不重放。权限每秒复查，撤权/过期取消并等待收尾。每个 Job 从 launch 到远端执行最长45秒，不提供旧24小时后台服务承诺；本地取消或 SSH 关闭不证明远端子进程停止。

machine_docker_inspect v2 使用 {connectionId,containerId}，要求完整小写64位hex容器ID，返回 containerId/state/image/fingerprint。machine_docker_control v2 使用 {connectionId,containerId,action,expectedFingerprint}，action 为 start/stop/restart/remove，指纹取自 inspect。两者需 machine.docker.manage；control 独立批准，remove 为 destructive，其余 mutate。执行前核对指纹，后核对请求状态或容器不存在；并发窗口不提供原子CAS，派发/后验未知不得自动重放。Docker 与其他独立远端任务共用45秒整项期限。

新后端 acp_execute v2 使用 {connectionId,argv,cwd,prompt}，仅通过独立SSH调用远端已安装的ACP v1程序。argv最多128项、原始UTF-8合计8KiB，cwd为必填绝对路径且最多256bytes，prompt最多8KiB，完整参数JSON最多16KiB。不接受旧integrationId/target/Workspace/profile，也不自动安装程序或添加本机回落。需当前 integration.acp.invoke、选中目标和独立destructive人工批准；当前调用参数绑定批准，内置声明不授予grant。

ACP执行初始化、创建新会话、提交prompt并收集文本更新；输出最多32KiB，超限整项失败而非截断伪报完整。整项最长45秒，包含内部权限等待，跨层传递剩余期限；独立远端任务共用8名额。stopReason明确返回end_turn/max_tokens/max_turn_requests/refusal/cancelled，协议完成不代表远端副作用已被业务验证或程序处于OS沙箱。

每个受支持的ACP内部权限请求生成独立acp_inner_permission工具操作和kind:acp_permission批准，绑定父调用、会话/请求/远端toolCall身份、目标版本、原输入哈希及独立修订。父批准只允许启动程序，不能批准内部动作。只支持allow_once/reject_once；没有allow_once选项直接取消，不支持allow_always。direct文件/terminal请求拒绝。读取现有审批列表/单项并resolve后，执行方仍须在当前权限有效时原子消费一次，确认许可响应已发送才记录交付；该子操作completed表示许可已交付，不保证远端内部动作成功。审计摘要不展示rawInput或prompt正文，远端title/kind仅是未受信说明。

权限与状态使用现有审批HTTP和工具事件页查询，不透传原始ACP更新或新建独立WS。每父调用最多64个内部权限操作；协议单消息256KiB、总入站8MiB，最多16个在途权限handler。每秒复查当前父授权/目标；撤权、过期、Root取消或停机关闭本次流并等待资源收尾，晚批准不继续。重启收敛未派发子操作与已派发未知意图，不恢复活waiter或自动重放。断线、响应交付/持久确认或清理未知不得报回滚；本地关流不保证远端进程停止。正式前端改动见F1，全部行为待B10。

以上写入链须 governed 准入；源码接线不表示 B10 已通过；正式前端的参数及审批呈现调整统一留F1。

路径必须绝对，拒绝`..`和符号链接跟随；目录可显示symlink条目。读取前后复查版本、指纹、选中与授权。hash只描述捕获内容，不保证远端并发原子快照；已开始的读取不能因撤权追溯撤回，但结果交付仍会拒绝。每个远端操作受冻结 toolTimeoutSeconds 与 Root 剩余期限共同限制，取消等待实际资源收尾；不自动重放unknown。当前工具执行须 governed 准入，没有运行测试，正式前端按F1同步新字段与提示。

### 新后端 Root/Child 与协作（源码接线，默认执行关闭，行为待 B10）

新后端提供十个模型工具：`collaboration_delegate/profiles/list/join/cancel/message_send/message_read/message_consume/fact_read/fact_write`（每项都使用完整 `collaboration_` 前缀）。必须显式授予 `app.intents.exchange`；委派、取消、发送、消费和写事实分别批准，读取也须当前授权。父批准不授予 Child 远端工具许可。正式旧界面的协作管理尚未切换，执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 真实模型与协作行为待 B10。

- Root 最多累计四个直接 Child，不支持嵌套。Root/Child/依赖等待共用八个任务名额，满载拒绝，不自动排队或重放。Root 五分钟绝对期限，Child durationSeconds 为1–120秒且不超父期限，maxRequests 为1–32；全族预算、并发和期限由创建时冻结的执行设置约束。
- delegate 参数为 profile、objective、maxRequests、durationSeconds、dependencyMode 及可选 targets/dependencies。profile=explore|review|worker；explore/review 限远端只读与本地协作，worker 的写动作仍逐次批准。objective 为独立任务（最多8 KiB），不复制父私有历史；targets 为选中 SSH ID 的十进制字符串子集（最多50项，省略表示无目标），dependencies 为最多四个此前 Child UUID，success 要求成功、settled 接受终态。完整工具参数 JSON 最多16 KiB，不能只看单字段上限。
- list/join 返回安全状态及 Child 最后正文（最多8 KiB），Child 每步正文也最多8 KiB；正文只是模型生成结果，不是已验证证据。join 只由 Root 发起，childIds 必须为其直接 Child，mode=all|any，waitSeconds 为1–30；超时不停止 Child。父成功前等待全部 Child 成功和实际资源收尾。cancel 独立批准后围栏并等待本地清理，不承诺远端进程回滚。
- message_send 使用 recipientId/body/ttlSeconds，只能发给当前族内仍活跃的其他参与者；body 最多8 KiB，TTL为1–300秒。全族最多累计256条/512 KiB原始正文，过期与已消费记录仍计累计配额。接纳不等于消费；不使用旧 runtimeId/任意 JSON/artifactRefs。
- message_read 使用 after/limit（每页1–4条），只读自己的持久邮箱；按服务端 nextCursor 继续，过期文本被省略，但扫描进度保留。message_consume 使用 through/expectedConsumed CAS，只能确认已经连续扫描的范围，跳页不能确认未读间隙。
- fact_read 使用 key；fact_write 使用 key/value/expectedVersion，0表示创建，更新必须匹配当前版本。key 最多128 UTF-8 bytes，value 最多8 KiB，全族最多128 keys。消息和事实均是未验证文本，不能作为权限或可信指令。
- 取消、撤权、Provider变更和停机收尾全族；存储失败仍尝试本地清理并保留失败原因。提交未知不猜测、不重新派发；重启不恢复活 waiter 或旧付费请求，未派发 Child 失败、已运行 Child 保守 unknown。冲突需读取当前状态后由新意图决定下一步，不能自动换键重放。

管理员观察接口前缀为 /api/v1/agent/apps/:appId/runs/:id：GET /subagents 只返回直接 Child 的 id/parentId/status/version/profile/deadlineAt；POST /subagents/:childId/cancel 带 expectedVersion 与稳定 Idempotency-Key，复用 Run 取消结果，冲突先只读核对、unknown 不换键重放。GET /subagents/:childId/messages?after=0&limit=16 只返回 sequence/senderId/bodyBytes/expiresAt，最多32项，完整响应16 KiB；包含过期记录的元数据，按 nextCursor 继续，不读取正文或推进模型消费水位。均须新 Access 管理员会话，错族/错 App/非直接 Child 返回 not_found。外部直接创建 Child 改为受审批模型委派；可配置 profile 管理由执行设置接口承接，正式前端后置 F1。

### 新后端 Memory、Artifact 与语义检查点（源码接线，行为待 B10）

Memory 管理归 /api/v1/agent/apps/:appId/memories：列表 status/limit/offset、POST 候选、GET 单项、POST /:memoryId/review、POST /imports/preview 和 /confirm。正文最多 16 KiB，审核带 expectedVersion，只有人工 publish 才进入 Recall；模型提案绑定真实 Run。跨 App 导入限同一用户、已发布且未过期的来源，确认重新核对版本，目标仍为候选。确认一次消费，未知结果按 preview.memoryId 只读查询，不重发。

Artifact 位于 /api/v1/agent/apps/:appId/artifacts；先 POST name/mediaType/declaredBytes，再 PUT /:artifactId/content，以 application/octet-stream 发送真实字节并带 If-Match 的带引号版本。单项最多 16 MiB，服务端校验实际长度，GET 内容支持单个 bytes=start-end Range，下载不内联执行。库 /api/v1/agent/files 与 /files/storage；App 内支持 retain、带版本删除、attachments/解除引用及 cleanup/preview、confirm。被引用或保留的文件不能清理；确认绑定资源版本、十分钟期限并只消费一次。文件发布后 SQL 失败是未知结果，预留额度不因此释放，不能自动重传或删除。

模型工具 memory_recall/propose、artifact_create/read 与 context_checkpoint 使用独立当前能力和必要审批。Artifact 续读按字节 offset 返回 base64；Memory 和摘要均是不可信数据，不能成为授权。语义检查点按冻结 aggressive/balanced/conservative 限制摘要至来源字节的35%/50%/75%，只在完成原步骤工具组后替换已绑定输入前缀，原用户请求和完整当前交换保留；没有开启模型派发就不会伪造摘要。

### 新后端执行设置（源码接线，行为待 B10）

管理员 GET/PUT /api/v1/agent/execution-settings 管理 enabled、完整 limits 与三个 profile；初态 version=0、执行关闭。PUT 带 expectedVersion，硬限制通过 /hard-limits/preview 与 /confirm 单次确认，确认重查版本和实际占用。profile 可继承 Root 模型或显式选择 Provider/model/configurationVersion；不会自动回退另一个模型，Child 仍需独立工具权限。Root 创建冻结设置，全族模型请求、工具登记与 token reservation 共用账本；token reservation 是保守预算单位，实际供应商用量另记，不声称精确 token 硬限制。执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。

全用户模型并发、Root/Child 占用、完整期限、工具输出/超时、Recall、Artifact 额度/TTL 与协作消息均接入实际消费者。配置变化先持久围栏旧 Run，再取消本地任务；App 覆盖项只能缩窄全局值。normal 上下文窗口取 Provider 窗口与 max(32768, 输出预留+2048) 的较小值，extended 使用 Provider 窗口；摘要按冻结压缩模式校验，容量不足明确拒绝。旧 maxAutoModelRequests/maxAutoActiveExecutionSeconds 删除，不保留自动增额双轨。

### 新后端 Provider 与模型冻结

新后端管理员接口前缀为 `/api/v1/agent/ai`；正式界面尚未迁移。

| 接口                                                                    | 操作                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| GET/POST /providers                                                     | 查询/创建 Provider                                             |
| GET/PATCH/DELETE /providers/:providerId                                 | 查询、部分更新、删除；更新 JSON、删除 query 需 expectedVersion |
| GET /models                                                             | 查询当前可以冻结的模型及配置版本                               |
| POST /providers/discover-endpoint-models                                | 指定 baseUrl 和可选 credential，读取模型目录                   |
| POST /providers/:providerId/discover-models、/test                      | 发现并记录观察；test body 指定 modelId，发送真实模型请求       |
| GET /model-registry、/resolve?modelId=...；POST /model-registry/refresh | 查询缓存状态、解析能力、手动更新 models.dev                    |

Provider 配置包含名称、HTTP(S) 端点、启用状态、协议及显式模型能力。单模型协议覆盖 Provider 默认。更新省略字段即保留；credential 省略保留、传新值加密替换、clearCredential:true 清除，两者不能同时指定。缺少加密密钥时拒绝保存凭据；查询只显示 hasCredential 和修订，不回显密钥。发现观察不覆盖手工配置；变更端点、默认协议或凭据会清除旧观察，单独修改模型手工配置保留观察。未知能力不补默认值，放宽已知上限或启用供应商明确拒绝的能力会阻止冻结。

请求最多 128 KiB、每 Provider 最多 128 模型、发现最多 1000；名称 128、modelId 512、URL 2048、credential 8192 UTF-8 bytes。完整响应含 JSON 转义最多 8 MiB；超过返回 413/limit_exceeded，不截断。Provider 请求 10 秒、Registry 单次刷新 15 秒（新请求可能先等待已取消刷新收尾）；非 2xx、网络、无效/未完成流返回安全失败。模型测试传递推理配置并校验完整 SSE 终态，usage 缺省不补零。配置/凭据更新使旧请求失效；取消不能证明上游未处理。

Run 创建必传 model:{providerId,modelId,configurationVersion} 及 connectionIds（最多 50 个唯一正整数，空数组表示未选中目标），与 Run、初始事件、幂等记录同事务冻结模型配置和凭据代际。冻结输入不含密钥；Provider 版本失效/禁用拒绝创建，关联 pending/running/unknown Run 时拒绝删除 Provider。同意图重放保持原 key 和输入及**原提交快照**，不会因后续状态变化修改历史幂等响应；operation_unknown 不代表回滚。当前已有目录、诊断、文件只读及受审批 file_write/patch/move/delete、Shell/后台 Job/Docker 的执行源码，实际执行须 governed 准入。

新后端已有独立 Chat Completions/Responses 增量模型流、Run 执行 owner、持久步骤与恢复源码。当前政策为 `governed`，执行设置默认关闭；开启后仅新建且已确认提交的 Run 可进入原执行 owner，权限、版本、预算逐阶段复查。pending 不表示已派发；重放和未知结果不触发第二次调用。正式界面与输出交付留 F1，真实行为留 B10。DEV 页可选择 Provider 模型和配置版本；候选不保证提交时仍有效，后端按当前配置校验。

Provider/Registry公开失败只使用已定义的安全码，步骤未派发失败码为`DISPATCH_NOT_STARTED`；不返回供应商错误正文。管理接口在异步结果交付前复查会话；写入完成后若登录失效或响应失败，先重新登录并查询配置，不能据错误响应推断写入已回滚。Registry resolve的modelId最多256 UTF-8字节；重复或未知query参数拒绝。

模型流普通帧/注释帧上限 128 KiB；Responses 的 done/completed 完整文本快照帧可至 8 MiB。完整网络流上限 8 MiB、正文上限 2 MiB；JSON 转义和重复快照也计网络量。只有明确成功终态、正常结束和本地资源清理完成才可记 completed；断流、拒绝内容、未知事件和非成功终态不能冒充成功；服务器声明的工具调用可形成 tool_calls 步骤终态，无正文也合法，不能直接记 Root 成功；结束原因只接受原始字符串取值，数组或对象即使可转成同名文本也拒绝。Chat Completions 的 `[DONE]` 帧同样受普通帧上限约束。

管理员可读取 `GET /api/v1/agent/apps/:appId/runs/:id/steps/:stepIndex` 及其 `/events?after=&limit=`（stepIndex 为 1–400，属于审计容量，不授予执行额度）。不存在或不属于当前用户/App/Run 的步骤返回 404；默认 50、每页最多 100 条，完整响应限 32 KiB。只返回状态、版本、用量和文本**字节数**，不返回正文、prompt、冻结配置或秘密。DEV 切换 Run/登出会取消旧读取并隔离状态和游标。

Agent模块最多64个在途请求，停机同时中止发现/探测和Registry刷新并等待持久写入；Provider自身关闭也等待实际网络任务，单项清理失败仍执行其它清理；网络清理失败后对应owner拒绝后续网络工作。Registry取消后的持久写入异常不静默丢弃。

本机最多 8 个 Run 尝试名额（含在途创建和清理失败任务）、64 个在途写入；关闭或满额时在持久创建前返回安全不可用错误。尝试期限 5 分钟，仅触发本地 Abort；取消/配置变更不证明供应商端已经停止。停机先停止准入再等待已准入写入和模型任务；清理失败保留内部原因，不暴露供应商诊断。

未派发步骤失败为 failed/DISPATCH_NOT_STARTED；已派发后断流、取消或重启保守归 unknown，不自动重试付费调用。取消先持久围栏再中止资源；unknown 主 Run 保持活跃直到显式取消。重启核对主子状态、版本、hash 与事件，不一致数据拒绝恢复并保留现场。网络或提交结果未知时保留原输入与幂等键，查询权威状态，不能通过重复创建新意图恢复；version_conflict 明确刷新核对，不自动改版重放。

## 布局与通用操作

- 失败 toast 默认 8 秒，成功/信息/警告 3 秒，可提前关；常驻错误须手动关，显式时长优先。
- 导航高 48px，上下各 6px，桌面左右 8px、手机无额外边距，占正常布局且可隐藏；预留滚动条空间，设置/终端共用高度计算。
- 窄屏页面菜单/标签可访问所有入口，桌面窄栏支持鼠标拖动及原生触摸滚动；拖动不触发选择/切页或带动终端。
- 弹窗/表单/进度使用不透明主题底色；危险确认、上传冲突统一面板，保留跳过/覆盖/应用全部，长内容可滚动。桌面按钮至少 44px，手机等宽；登录控件 44px，编辑器下拉紧凑。
- 工作区偏好扁平分组，手机单列/桌面双列，保留独立保存、未保存提示、高级折叠。
- Ctrl+滚轮缩放终端/文件/编辑/快捷指令；容器水平/垂直只改直接子项排列。
- 侧栏宽度持久化，默认点击外部收回，“保持侧栏”持续展开；popup/embedded/sidebar 共用功能状态。
- SSH/文件标签右键支持关当前/左侧/其他/右侧，分组名可点改；触摸终端规则见 [终端](#终端)。

### 独立重构入口：核心持久设置（源码已接线，行为待 B10）

管理员使用 GET /api/v1/settings 读取 {version,effectiveVersion,requiresRestart,policy,captcha}；PUT 同路径提交完整 {expectedVersion,policy,captcha}。policy 包含 ipWhitelist、ipBlacklistEnabled、maxLoginAttempts（1–1000）、loginBanDuration（1–2592000秒）、statusMonitorIntervalSeconds / remoteHostRefreshIntervalSeconds（1–86400秒）、passkeys。白名单最多256条IP/CIDR、16 KiB；Passkey站点最多16项。未知字段、旧字符串字典、布局/外观字段均拒绝；个人偏好使用独立 /settings/preferences 与布局入口；外观归 B8。

CAPTCHA配置为 {enabled,provider,siteKey,expectedHostname,secret}，secret 显式使用 {action:'keep'}、{action:'clear'} 或 {action:'replace',value}；key最多1024 UTF-8 bytes，启用时须有效供应商、非空site/secret和准确hostname。更换供应商不能keep旧密钥。读响应只含hasSecret，不含明文或密文。匿名 GET /api/v1/settings/captcha 与 GET /api/v1/auth/captcha/config 都返回当前实际生效的公开验证码配置；管理员 PUT /api/v1/settings/captcha 只更新CAPTCHA，但与完整设置共享expectedVersion，返回安全配置及生效元数据。

所有核心设置保存后需要重启：version为已保存版本，effectiveVersion为本次启动版本，requiresRestart表明二者是否不同。重启前来源准入、登录、CAPTCHA、Passkey和监控共同保持原快照；重启读取/校验/解密全部持久设置后才开放监听。已有配置不受初始化环境覆盖；数据库或密钥异常拒绝启动，不回落默认。网络/主Origin/代理/加密密钥/Guacd仍由部署提供；站点协议必须与监听主Origin一致，修改协议须同时调整部署后重启。管理员应保留可用部署入口，不能把保存成功当已通过实际外部验证码或域名配置验证。

请求/响应完整JSON最多64 KiB；400 invalid_input、401 unauthenticated、403 forbidden、409 version_conflict、413 limit_exceeded、415 invalid_input（媒体类型）、503 storage_unavailable/operation_unknown/internal_failure/unavailable。冲突先重新读取并人工核对；设置CAS在同一SQLite事务复查当前管理员会话，先完成撤销则拒绝写入；写入后认证失效、响应中断或未知提交可能已保存，恢复身份后只读核对version与内容，不自动重放PUT，也不以新版本覆盖。源码/静态完成不代表正式前端已迁移，全部真实行为留B10。

### 新后端界面偏好与布局（源码已接线，行为待 B10）

GET/PUT `/api/v1/settings/preferences` 读取/替换当前用户的完整界面偏好；安全配置仍独立于 `/settings`。保留语言/时区、前端日志级别、终端/编辑器/预览/缩放、Docker面板轮询、标签显示、侧栏尺寸及桌面窗口尺寸字段。backendLogLevel通过独立 /api/v1/settings/logging 管理，状态采样/资源缓存间隔归核心policy；不会因保存UI字段修改这些后端限制。语言仅en-US/zh-CN/ja-JP，时区必须有效；终端scrollback0–100000，预览行10–2000/列5–200，桌面宽320–8192/高200–8192。

GET/PUT `/settings/layout`、`/settings/sidebar`、`/settings/focus-switcher-sequence` 与PUT `/settings/workspace-layout` 均安装；最后一项原子更新布局与侧栏。每项共享同一用户版本，未保存时明确version=0/默认布局，PUT带expectedVersion，首写变成1，冲突先刷新。布局用明确pane/container联合，id/size必填、ID及pane不重复，深度最多12/总节点100，容器至少一项；焦点最多32项、不重复，快捷键为序列项→字符串。请求/响应128 KiB，未知字段拒绝。

成功保存立即成为后续读取权威，不要求重启；实际显示及终端参数生效由正式前端F1接线。本版没有声称DEV终端或后端checkpoint已消费这些UI字段，也不把客户端显示偏好当后端资源许可。unknown先读取核对，不自动重放。

### 系统设置截图

![系统设置](imgs/e2e/system-settings.png)

## 外观自定义

支持明暗、终端配色、页面/终端背景、工作区样式。设置统一分区/控件，桌面侧栏/窄屏顶部导航；主题/HTML 背景共用搜索，主题可下拉切换，长名称和手机按钮不横向溢出。

内置背景深黑，应用时保存内容副本，预设更新须重新应用。背景仅非零尺寸加载，resize/恢复通知隔离文档，不重载；主题须自行处理 resize。

手机/粗指针 HTML 动画最高 20 帧/秒，不可见暂停帧/CSS，减少动态效果只保留首帧；不限制终端/桌面，自定义 timer/视频仍可能耗资源。

### 外观与 HTML Theme

支持本地 HTML 和 GitHub catalog，升级/保存/读取/备份恢复规范化，保留第三方仓库地址。内容 API 返回文本，终端只在 sandbox iframe 执行，GitHub 来源不意味着可信。

### 主题升级与背景保存

- 删除活跃主题同事务清空设置引用；同名新 preset 将用户主题改名“原名 (user ID)”（冲突再编号），保留颜色/ID/引用。
- 上传/删除顺序执行；删背景先清设置再删文件，设置失败不先删，清理失败记诊断但不改变已清引用结果。崩溃可能遗留文件，非文件/数据库跨资源原子更新。

上述界面仍使用正式后端。独立 backend-next 已接入主题、外观设置和图片背景源码，行为待 B10；本地/远端 HTML 主题库也已接入，正式前端切换留 F1。

### 新后端主题、外观与背景（源码接线，行为待 B10）

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

UI JSON 为 CSS 变量对象：最多 128 个 ASCII --变量名，单值 2 KiB；HTTP 使用 JSON 字符串，内部使用对象。完整外观输入在应用名额取得后读取，读取期限 60 秒，停机或断连取消读取。字体范围 0.1–512、蒙版 0–1、描边宽度 0–32、阴影偏移 ±512/模糊 0–512。400 invalid_input、401 unauthenticated、403 forbidden、404 not_found/theme_not_found、409 version_conflict/name_conflict/preset_readonly、413 limit_exceeded、415 unsupported_media_type；不可用/内部失败/清理失败/提交未知为安全 503。冲突先只读刷新；operation_unknown 或响应中断先核对当前主题/外观，不自动重传、重删或换版本重试。缺内容/损坏记录报失败，不静默修改用户设置。

### 新后端 HTML 主题库（源码接线，行为待 B10）

完整认证用户使用 GET/POST /api/v1/appearance/html-presets/local 和 GET/PUT/DELETE /local/:themeName。17 个预置只读，自定义按用户隔离，可覆盖同名预置；删除自定义后再次读取同名预置。列表同时包含两种来源，返回 {name,type,version,updatedAt}；内容 GET 返回 text/plain，后端不执行 HTML。活动 HTML 保存在外观设置的内容副本，修改或删除库条目不会自动修改副本。

POST 使用 {name,content}；PUT 使用 {expectedVersion,content}，DELETE 使用 {expectedVersion}。名称是单个 .html 文件名，最多 255 UTF-8 bytes，允许中文和空格，禁止路径、..、控制字符；放入路径时使用 encodeURIComponent，字节预算按解码后的名称计算。内容最多 1 MiB，允许空文本。更新/删除以自定义列表项的 version 为准；用户级持久修订不因删除重建而复用，也不保证每项版本连续。JSON 请求 8 MiB、完整响应 32 MiB（容纳远端目录最坏转义），列表最多 4,096 项，每用户最多 2,048 个自定义主题。输入先准入再读取，60 秒期限；unknown 或响应断开后只读核对，不自动重写。

远端使用 GET/PUT /html-presets/remote/repository-url，读取 {url,version}，写入 {url,expectedVersion}（url 可为 null，版本与外观设置共用）。GET /remote/list 可提供单个 repoUrl，否则使用已保存来源；GET /remote/content 必须提供单个 fileUrl。仓库仅接受 HTTPS github.com 的 owner/repo 或 /tree/ref/path，内容仅接受 HTTPS raw.githubusercontent.com 的 .html；不跟随重定向，不自动改写旧官方 URL。保存来源不证明仓库可用或授予执行权。

目录最多 1,000 个上游条目，返回 {name,downloadUrl}，只列合法 HTML 文件；内容最多 1 MiB，UTF-8 严格解码、纯文本交付。目录/下载共用 HTML 在途名额（16），网络期限 10 秒，关闭/断连会取消；读取已保存来源期间设置版本变化返回 409 source_changed，重新读取后人工确认。远端不可用为 503 source_unavailable，超限为 413，来源无效为 400；资源释放未确认返回 cleanup_failed 并停止该 owner 新准入，保留诊断。可选 GITHUB_TOKEN/GH_TOKEN 只发给 GitHub API，不发给 raw 内容地址，也不返回给前端。

### 新后端宿主诊断（源码接线，行为待 B10）

管理员 GET /api/v1/system/diagnostics 读取 collectedAt、进程uptimeSeconds/residentBytes/heapUsedBytes/runtimeVersion 与数据库available/schemaVersion，响应最多16KiB。进程/数据库并非同一物理采样时刻，不含路径、环境或表内容。Agent 的 host_diagnostics_read 需单独 host.inspect grant，默认不授予；与普通SSH目标诊断分开。正式界面迁移留F1。

## Dashboard

连接目录加载后结束 loading，不等待审计/挂起；返回保留内容并刷新。快速连接/SSH 资源列表限高内滚动，保留最近活动首屏，手机搜索随列表滚动，长列表有回顶按钮。

资源按主机去重、主机间隔 200ms 请求，独立显示成功/失败，不一次全量启动；页面销毁取消待请求，不让单主机失败阻止其他状态展示。采集与缓存见下节。

## 状态监控与 Docker

- 默认显示在线状态，可设置显示/复制 IP，采样/缩放/Docker 间隔持久化，Docker 默认 5 秒。
- CPU/内存/Swap/磁盘/网络显示实时数值、总量/单位，适应宽窄矮栏，历史可切指标/时间并关闭；极小面板存在可读性限制。
- 指标提示支持悬停/键盘聚焦并原位更新，不重启原生 title。
- Docker 宽栏表格/窄栏卡片；Start/Stop/Restart/Remove 管容器，Enter/Logs 进入当前 Workspace。

### 新后端开发入口（源码已接线，行为待 B10）

同一 Workspace WS 支持 status.start/stop、status.sample/error 与 docker.status/stats/command；Docker 控制仍为 Start/Stop/Restart/Remove，Enter/Logs 继续走交互终端，不新增任意命令接口。三个 HTTP 保留为 GET /api/v1/system/status、/api/v1/system/ssh-resources、/api/v1/system/ssh-resources/:connectionId。只接受新 Access 管理员会话；正式前端对接留 F1。

| 项目     | 新后端当前语义                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 采样     | 独立临时 SSH，不在交互式 PTY 注入命令、不刷新最近连接时间；首轮间隔 500ms 采两次，之后每次完成再等待默认 3 秒，不重叠。                                                                                                      |
| 后台     | 同主机/配置共享在途采样，默认 TTL 60 秒从开始算；每个请求最多并行 2 个主机、最多 4 个后台请求；单个请求等待最多 120 秒。当前不复用 Workspace 活跃 SSH。                                                                      |
| 配置     | 新后端从持久核心设置安装状态间隔和后台资源 TTL，首次默认3秒/30秒，范围1–86400秒；保存后下次重启统一生效。                                                                                                                    |
| 容量     | Remote 观测操作合计最多 8 项、单项完整期限 45 秒；Docker identifier 最多 128 ASCII 字符、列表最多 4096 个容器；完整观测 HTTP/WS JSON（含外壳）最多 512 KiB，本机状态 JSON 最多 16 KiB。超限明确失败。                        |
| Docker   | 非零控制退出返回 command_failed；已派发但缺少退出证据或后续确认失败为 operation_unknown。容器中途停止/确定 stats 读取失败可返回 stats=null，不当成零值。                                                                     |
| 恢复     | 同一连接配置的控制动作互斥，unknown 或清理失败保留控制阻断；先只读核对，不自动重试。占用已持久化并与 Agent/Files 共用，同一文本 host/port 冲突；unknown/清理失败跨重启保留 blocked，无自动解除。证据核对恢复入口由 B9 补齐。 |
| 取消     | stop、附件断开/接管、Workspace 终止及停机取消原实例的观测任务；真实收尾前仍占名额，清理失败不冒充成功。HTTP 请求取消只结束其等待，其他请求共享的采样由原 owner 继续追踪。                                                    |
| 安全失败 | HTTP 返回 code；WS response.error/status.error.message 和资源 error 使用 Shared 安全码，不回传技术 stderr、cause 或凭据。                                                                                                    |

### 资源采集与缓存

每次采样重读机器信息，不跨采样复用；同主机/配置在途采集共用，TTL 从开始计算，慢结果可能已过期。删/改地址清旧缓存，reset 不允许旧结果回填；TTL 内可能短暂显示旧状态。

## 安全与认证

支持密码、Passkey/WebAuthn、TOTP 2FA、hCaptcha/reCAPTCHA、IP 白/黑名单、登录通知和审计。Passkey 配置见 [部署文档](DEPLOYMENT.md#passkey--webauthn)。

### 初始化、因素与会话

- 空库初始化仅成功一次，并发保护不验证部署者身份；没有部署 token，先在受控网络建管理员再开放。
- Session 目录 0700、文件 0600，权限失败/异常条目拒绝；仍明文，不隔离 root/同 UID/额外 ACL，保护数据与备份。
- 新增 Passkey/启用 TOTP 由完整会话授权，无统一 recent-auth；改密码/禁用 2FA 仍验证密码。新因素不撤销泄露旧会话。
- 部分 2FA 会话固定 5 分钟、不续期，Backend 最多 64 个，满载拒绝；记住我第二因素成功才生效，不是完整会话/磁盘总配额。
- 2FA 验证失败记 LOGIN_FAILURE、通知及 IP 失败；不存验证码/secret，投递依实际配置。
- Passkey discovery 可公开配置状态、credential ID/transports，标识不是秘密，须签名验证；false 不区分账号不存在/未配置，无专用限流保证。
- 启用 2FA 约束新密码登录，不自动注销/重挑战已有完整会话。

### 认证并发、撤销与秘密存储

- 改密码失效所有旧 session/WS，旧无凭据版本会话也须重登，Passkey 可继续认证；已接纳副作用不回滚。
- 登出撤销同 session 的 Workspace/上传/桌面/Agent WS，包括其他页面，不撤其他 session；前端缓存/传输轮询清空，晚响应不回填，交错握手可能拒绝。
- 同 session 只支持一个 Passkey 注册/登录 challenge，新流程失效旧流程；失败重新发起。提交重检签名计数器，并发旧快照拒绝；同步零计数器不要求递增。
- TOTP/CAPTCHA/通知配置按部署密钥加密，旧明文启动迁移，错误密钥不当明文。备份配置 envelope 加密、导入用目标密钥；用户/TOTP 不在 Full Backup。旧页/WAL/外部备份不擦除。
- 生产建议 HTTPS。

### 来源、反向代理与网络准入

普通写请求检查 Origin/Fetch Metadata，兄弟域 same-site 不放行；无 Origin 的 same-origin 或无浏览器 metadata API 客户端可用，认证不变。Agent 仍须 CSRF。WS 只在可信 TCP peer 时采用 forwarded host/proto，不读取 X-Real-IP，Origin 不替代认证。

代理须正确覆盖外部 Host/Proto/来源。宿主 TRUST_PROXY 默认 loopback，自定义代理指定精确 IP/最小可信 CIDR；Compose 默认 Frontend 一个 hop，不公开 Backend；Frontend 信任私网入口，必须保护转发路径，不能让不可信私网 peer 伪造 IP。具体示例见 [部署文档](DEPLOYMENT.md#反向代理来源信任)。

### 来源与登录失败策略

- loopback/RFC1918/IPv6 ULA/link-local（含 IPv4 映射）豁免 IP 白名单/失败封禁，不免密码/2FA/Origin；旧内网黑名单行可保留但不阻断。
- 公网按配置阈值/封禁；到期后下次失败开启新周期，未到期不追加延长。并发失败原子累计，仅首次进入封禁触发通知。
- 7 天无新失败且封禁结束可惰性清记录，每 5 分钟至多清一次，不删活跃封禁；分页最多 200，时间戳对外为 Unix 秒、内部存储毫秒，无保留期来源总量配额。

### 独立重构入口认证

新的 `backend-next` 入口不复用正式旧 Backend 的 Express session/cookie。空库管理员 setup 成功一次，密码长度至少 8、最多 1024 UTF-8 bytes，用户名去空白后不超过 64 字符；普通密码登录的返回身份不含密码 hash 或秘密。会话 Cookie 名 `nexus_session`，HttpOnly/SameSite=Lax，同外部 HTTPS origin 时 Secure；服务端仅存随机 token 摘要和 30 天期限，普通 Cookie 仅本次浏览器会话，rememberMe 才设置 30 天 Max-Age。再次登录创建独立新会话，不提前撤销浏览器原有 token；断连或响应丢失不废止原会话；登出清除当前 cookie 并撤销当前 token，改密提交时会复核原会话仍有效与密码版本，计算期间登出、过期或并发改密可返回冲突且不写入；成功则原子撤销该账号所有会话。状态 200 带 `isAuthenticated:true/user`，无效/过期返回 401 `{code:'unauthenticated'}`（当前开发客户端据此返回未登录）；成功结果仍保留 `isAuthenticated:true`；未迁移已启用因素 403 `factor_unavailable`，不能退回密码登录或宣称完整 2FA 已通过。

首次初始化读取 `NEXUS_NEXT_IP_WHITELIST` 的逗号/换行分隔 IP/CIDR（最多 256 项、16 KiB），空值放行全部已知来源；非法条目在监听前拒绝启动。HTTP/WS 入口统一使用直接 TCP/受信代理链提供的真实 IP；未知来源拒绝，loopback、RFC1918、link-local 和 ULA 豁免白名单与封禁，但**不**豁免密码、CAPTCHA、Origin。独立入口 `NEXUS_NEXT_IP_BLACKLIST_ENABLED` 默认 true、最多 5 次失败、封禁 300 秒，可通过 `NEXUS_NEXT_MAX_LOGIN_ATTEMPTS` 与 `NEXUS_NEXT_LOGIN_BAN_SECONDS` 设置有效范围；`createApp.configuration` 的首次初始化工厂可显式关闭；后续重启和配置保存从持久设置读取，不重新用环境覆盖。其他业务的公网封禁入场返回 403 `forbidden`；登录路由由 Access Service 返回 429 `rate_limited`，状态、登出与黑名单管理员恢复路由仅执行来源白名单检查；未知 HTTP 路径也先做来源准入；管理员凭有效 Cookie 可读 `GET /api/v1/settings/ip-blacklist?limit=50&offset=0`（最大 200）及使用 `DELETE /api/v1/settings/ip-blacklist` JSON `{ip}` 解除，保留明确 `removed` 结果。登录错误/CAPTCHA 明确拒绝按来源原子计数，正常成功才清对应失败记录；第三方校验期间出现并发封禁，签发事务仍拒绝并返回 429 rate_limited。

CAPTCHA 默认关闭；启用需配置 `NEXUS_NEXT_CAPTCHA_ENABLED=true`、`NEXUS_NEXT_CAPTCHA_PROVIDER=hcaptcha|recaptcha`、`NEXUS_NEXT_CAPTCHA_SITE_KEY` 与 `NEXUS_NEXT_CAPTCHA_SECRET_KEY`。配置缺失在启动时报错，`GET /api/v1/auth/captcha/config` 公开 provider 与适用 site key、不公开 secret；登录 `captchaToken` 必填且最多 4096 UTF-8 bytes。后端向 hCaptcha/Google 验证接口发真实 POST、十秒截止且不重试；启用时必须绑定 `NEXUS_NEXT_PUBLIC_ORIGIN` 的准确 hostname，成功响应需要 hostname 一致；Google 仅支持 reCAPTCHA v2 checkbox，不接受 v3 score/action 响应，非 2xx 响应体即时关闭；供应商明确失败返回 `captcha_invalid`，网络/格式/超时异常返回 503 `captcha_unavailable`，不固定成功或故障静默关闭。密码与 CAPTCHA 均通过后才签发会话；客户端断连会取消待执行的网络校验/写入意图，已提交的新 token 若未交付则尽力撤销，原 Cookie 不因此失效；SQLite 提交未知仍按未知结果处理。HTTPS/Host/Origin/Fetch Metadata 检查在 Platform 的统一 HTTP/WS 边界实施。核心安装快照已由 B7.1 持久 Settings 管理，保存后重启生效；正式设置页尚未切换到新协议；新后端审计/通知已有 Operations 管理入口，正式前端尚未迁移，TOTP/Passkey 挑战已在 B4.2 源码/静态收口但行为仍待 B10，前端同步留 F1，源码不等于 B10 行为验收。

独立入口第一版只保留一个 v1 初始化项，直接创建当前完整表结构，不升级开发版数据库；登录失败记录包含最后失败时间和索引。成功登录/会话验证等存储访问至多每五分钟惰性清理过期会话与已结束且七天无新失败的黑名单行，不清除活跃封禁。SQLite 提交或回滚状态不确定返回 `operation_unknown`（503），可能已有副作用，客户端不得假定失败并重放密码修改或设置写入；重登/重新查状态由当前身份和持久事实决定。

### 独立重构入口 B4.2：TOTP 与 Passkey（源码已接线，尚未行为验收）

- 密码核验正确且当前账户已启用 TOTP 时，`POST /api/v1/auth/login` 返回 200 `{requiresTwoFactor:true}`，设置 HttpOnly/SameSite=Lax 的 `nexus_partial`；服务端待认证记录 5 分钟有效，最多 64 条；同一浏览器重新完成密码核验时，旧部分会话在创建新部分会话的事务内替换。不签 `nexus_session`，该 Cookie 不能用于 SSH/Agent/Targets 管理。`POST /api/v1/auth/login/2fa` 的 JSON `{token}` 需六位数字和原 partial Cookie，TOTP 验证完成后在事务中签普通 Cookie，rememberMe 30 天直到此时才生效。错误验证码计入公网 IP 失败记录；并发完成仅一方可以消费待认证。
- 已登录管理员可 `POST /api/v1/auth/2fa/setup` 获取一次性 secret/QR（仅向当前已登录的发起者交付），暂存 secret 使用绑定账号的应用密钥 AES-GCM 加密，`POST /api/v1/auth/2fa/verify` 带 `{token}` 验证后启用；`DELETE /api/v1/auth/2fa` 带 `{password}` 再核对当前密码后禁用。TOTP 采用 30 秒、六位数字、相邻 ±1 时间窗；没有恢复码功能，不能向用户暗示已有恢复机制。启用因素不主动注销现有完整会话；禁用撤销未完成的部分认证。
- Passkey 使用独立 5 分钟 `nexus_challenge` Cookie。匿名 options 挑战全局最多 768、每可信来源最多 16，所有因素挑战总额 1024，以免公开入口挤占已认证注册配额；首次无关联 Cookie 的并发匿名请求不能视为同一认证实例，只有携带旧挑战 Cookie 的替换和已登录同 Session 的注册替换才有事务级唯一性。改密递增认证修订、使修改前签发的 Passkey 登录挑战在最终提交时失效；每个 credential 有不可复用的 generation，验签后的会话事务复查 generation 与 counter。已认证用户可请求 `POST /api/v1/auth/passkey/registration-options`，再经 `POST /api/v1/auth/passkey/register` 提交 `{registrationResponse}`。匿名可 `POST /api/v1/auth/passkey/authentication-options`（`{username?}`）和 `POST /api/v1/auth/passkey/authenticate`（`{assertionResponse,rememberMe?}`）登录；`GET /api/v1/auth/passkey/has-configured?username` 查询配置。已认证用户可 `GET /api/v1/auth/user/passkeys`、`DELETE /api/v1/auth/user/passkeys/:credentialID`、`PUT /api/v1/auth/user/passkeys/:credentialID/name` 带 `{name}` 管理本人凭据。
- 注册/认证 JSON 请求最多 128 KiB，单个证据字段最多 96,000 UTF-8 bytes；凭据 ID 最多 1024 bytes，名称最多 128 bytes，transports 最多 16 项、每项 32 bytes。列表时间为 Unix 秒；原始 public key/counter 不公开。
- WebAuthn 只有实际验证完整 challenge、RP ID、公开 Origin、数字签名与 User Verification 才能登录；客户端 options 使用 `required`，与服务端要求的用户验证一致；计数器状态和 challenge 单次消费与会话签发同事务。旧挑战被新请求替换或过期须重新发起，旧失败不能换一个当前挑战重放。每个浏览器上下文 Cookie/Session 绑定挑战，签名结果不等于客户端声称的 verified 标志。支持既有 ES256/RS256 与零 counter 的同步凭据语义；不提供虚构的 recovery-code。公网禁用非安全来源的 WebAuthn RP，独立入口可用 `NEXUS_NEXT_PASSKEY_RP_ID` 与 `NEXUS_NEXT_PUBLIC_ORIGIN` 配置。
- 登录/设置流程遵循来源准入和完整会话授权，logout 清理普通、部分、challenge 和 TOTP 设置 Cookie。客户端明确无效的 challenge/Origin/RP/UP/UV/counter 认证证据拒绝登录，不能确定为凭据错误的 Provider 技术失败不回退为通过，也不累计密码错误；密码/因素签发的完整或部分会话以及 TOTP setup/Passkey options 已写入而 HTTP 未完成交付时撤销对应令牌/挑战；会话签发后的身份确认失败保持 operation_unknown 并尽力撤销，HTTP finish 不证明浏览器收到；数据库未知提交不可自动重试；真实第三方浏览器、网络中断和并发安全需在 B10 进一步验收。独立入口已支持持久多 Origin/RP：首次可用 NEXUS_NEXT_PASSKEY_SITES JSON 数组配置，每项为 {origin,rpId}；未配置时以公共 Origin 和可选 NEXUS_NEXT_PASSKEY_RP_ID 初始化一个站点。最多16站点，Origin严格规范且与主监听同协议，RP必须匹配域名或其父域；HTTP仅支持localhost/127.0.0.1。HTTP/WS只接收配置站点或主Origin的受信Host/协议，同一请求的Origin必须匹配选中站点，不能跨配置站点借用CSRF许可。未配置RP的主Origin可密码登录但不能签发Passkey挑战；改变/删除Origin/RP在重启后令旧挑战失效，不自动选择首个RP。正式前端 `LoginView`、Auth store/2FA 组件、Passkey 浏览器选项转换与凭据设置页仍由 F1 迁移；审计、通知和持久 Settings 已由新后端接线，正式设置页待 F1。当前源码实现及静态执行状态不等于正式功能已经上线。

### 审计日志

列表时间/类型/原详情代码块逐行展示，长内容换行，窄屏纵排，不弹窗或内部滚动。关键词防抖/类型自动筛选，每批 40，近底加载/手动加载，失败保留旧项可重试，动态虚拟列表及回顶。

SSH Key 新增/更新/删除记录 ID、操作者、来源、字段名，不记录私钥/passphrase，无额外外部通知。

### 新后端审计与日志（源码接线，行为待 B10）

GET /api/v1/settings/audit-logs 支持 event/from/to/q/limit/offset：时间为毫秒，默认50条、最多200条，以nextOffset续页。仅记录有限事件、用户/来源IP、资源ID、路由模板与状态码，不记录请求正文、Cookie、密钥或模型正文。审计保留最新50000条和尚未完成通知分发的积压；投递保留最新50000条终态及全部在途项。

GET/PUT /api/v1/settings/logging 使用 {expectedVersion,level}，level为debug/info/warn/error/silent；默认info。已保存阈值启动加载，保存后立即按版本单调激活，GET同时显示effectiveLevel。Operations事件写有限安全元数据到stderr，失败/未知事件为warn，其余info；不声称所有模块已有详细debug诊断。日志配置和审计只供当前管理员，更新与会话复查同事务，冲突先刷新，未知结果不自动重放。

### 审计保留与失败

保留 50,000 条，新增/按时间及 ID 裁剪同事务。审计 best-effort，故障记安全诊断，不回滚已提交业务，也不保证存储故障时全部落库。

### 安全设置截图

![安全设置](imgs/e2e/security-settings.png)

## 备份与恢复

完整认证会话可导入合法备份，同实例用 instance key，跨实例需备份密码；校验完整性/密钥，不含认证表。无额外 recent-auth/服务端破坏式确认，导入前核对目标，合法旧备份可能回放旧状态。

上段说明当前正式后端。独立 backend-next 已安装 `POST /api/v1/settings/backup/export`：完整管理员会话提交 JSON `{password}`，验证当前密码后下载二进制 `nexus-terminal.nexus-backup`。正式前端尚未对接。新后端已接入同路径 backup/import，使用 multipart backupFile 和可选 password；仅完整管理员会话可导入最新备份，不兼容旧备份。password 用于备份解封：同实例可省略，跨实例需备份密码，不是再次验证当前登录密码。源码已接线，运行恢复仍待 B10 验证。

新导出采用最新 NXSEALED2 认证加密封装，载荷及数据密钥分别保护，包含同实例密钥包和密码密钥包；跨实例秘密以受加密保护的明文传递，不复制源实例密文。覆盖五个产品模块的85张固定表和被引用的背景、Artifact、插件原包；HTML自定义库及活动副本已在SQLite。认证表、会话、模型目录缓存和活跃进程目录不导出。

新导出的快照最多64 MiB，文件最多100 MiB；导入/导出共用一个在途名额，输入、预检和执行共用120秒期限；导出的交付也计入期限。采集前后核对全部表内容，复用实际持久记录解码器和跨表读取，检查跳板关系/成环/展开上限、Agent 声明与原包/内置目录一致性、文件实际大小/hash、外观引用和插件清单/签名；上传/发布/删除中的内容或数据变化返回`source_changed`，稍后重新导出，不返回缺引用包。文件句柄清理未确认时停止新的导出；下载断流须重新导出。此链仅完成源码与静态检查，运行行为待B10。

### 容量、一致性与运行资源

| 范围              | 限制                                          |
| ----------------- | --------------------------------------------- |
| V1 快照 JSON      | 64 MiB，文件读取前计算 base64 膨胀            |
| 编码导入/导出文件 | 100 MiB，超限明确失败；内存生成，不保证低内存 |

- Artifact 配额不等于备份容量，保留整个 data 的外部备份，勿因导出失败盲删数据。
- 表快照短暂阻塞数据库，扫描文件不占事务；非跨文件/数据库同一物理时点。验证 ready Artifact 大小/hash、Plugin 包/入口/清单，缺失或并发变化拒绝，不交付缺引用包。
- 新后端先完成解密和隔离预检，再暂停 HTTP/WS/public 能力并排空旧 owner；不能安全排空时停止准入。文件和数据库按持久日志及同事务提交标记对账，确认成功或回滚后重建全部模块和接口。
- 导入响应为 restoredTables/restoredRows/restoredFiles/cleanupPending；cleanupPending 只表示已确认恢复后的旧文件清理待续，不表示恢复回滚。operation_unknown、重建失败或响应断流可能已经恢复，不能自动再次导入；保留数据现场，通过重启对账和只读状态核对处理。
- 认证表和当前会话不恢复；旧模型/工具/Job 不自动续跑，派发未知状态仍保留。历史 queued 通知结算 failed、dispatched 保留 unknown，旧审计不重新派发通知；导入的插件运行时不自动启动，需显式管理操作。
- 恢复清理挂起会话并撤销旧订阅；恢复成功或确认回滚且模块重建完成后，可新建挂起会话。提交未知、排空/重建或旧实例关闭失败时保持维护状态，不继续接受新操作。

## 客户端与平台

支持响应式 Web/PWA；[桌面安装包](https://github.com/0honus0/nexus-terminal/releases/latest) 的部分认证/会话能力可能不同。镜像支持 AMD64/ARM64，部署见 [DEPLOYMENT](DEPLOYMENT.md)。

## 镜像发布

Alpine latest、APK 最新 nodejs-current/nginx，更新须重建。稳定发布只发布当前 main，通过完整 E2E 与 high 级生产依赖审计；channel、架构和目标可从 Actions 识别。命令见 [部署与更新](DEPLOYMENT.md)。

## 当前限制与注意事项

具体限制就地维护在各功能章节；开发入口不替代正式能力，静态通过不等于真实行为验收完成。
