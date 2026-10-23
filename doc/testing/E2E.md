# Nexus Terminal E2E

## 第七批：当前入口与发送预检前提（2026-10-23，待远程）

基线 `dev` / `9aa53b96`；远程 `40001250164` 尚在运行，不用新推送取消。前批 `39998158139` / `72dd5714` 的八组日志最终仍为 435 通过、23 失败、1 超时；质量与 Docker smoke 通过，原日志 `/tmp/nexus-e2e-39998158139-shard{1..8}.log`，最终去重清单 `/tmp/nexus-e2e-39998158139-cases.json`。相同总数不代表失败停在相同步骤，以下以离线 trace 确认。

Send Files 的特殊目录创建、导航、取消与记忆已通过，后续真实工具检查返回 503（目标初始离线），没有发出创建任务请求；测试仍等待弹窗关闭。新前提让测试目标先通过真实预检，在原回执交付前通过正式 CAS 将第二目标设为可信但不可达的端口，再验证实际任务部分成功、rsync、错误详情和真实文件内容。只转发一次原检查请求并交付同一回执，不伪造成功、不扩大超时。目标配置更新和返回版本/身份均严格核对，既有 finally 仍移除本场景任务与连接。

Agent 审批 hash/version 和真实命令结果已通过，失败发生在重新打开 Tasks 后关闭的技术详情中；测试经可见 summary 展开，再检查直接属于审计 details 的 summary 与原 operationHash。收藏目录菜单末处同步 menuitem；桌面/移动进度入口按 USAGE 的常显行为验证空列表可开关、返回后终端及命令栏可用；移动快捷命令 Add 按当前 28px 紧凑控件和实际图标验证。保留原功能断言，不修改产品 UI。

两轮源码复审覆盖这五份测试、当前组件/Shared 消费者及正常/失败/收尾路径；根 `pnpm run check`、双端 `pnpm run build` 和五份测试静态类型通过，日志 `/tmp/nexus-e2e-seventh-{check,build,test-types}.log`。复审将空列表断言落到实际任务行与后台空态，随后测试静态类型再次通过，日志 `/tmp/nexus-e2e-seventh-test-types-final.log`。全量格式首次仅报告本轮 PLAN 表格，整理后通过，日志 `/tmp/nexus-e2e-seventh-format-final.log`；按 D17 未运行本地行为、浏览器、E2E 或 Playwright 收集。历史分页、搜索、其它入口和视觉断言仍继续排查；以上不作为新远程通过证据。

## 文件管理器连续缩放回归（2026-10-23，待远程）

用户单独授权修复拖动阻力，不混入 E2E 视觉适配。移除浮窗 pointermove 的 ±18px widthSnap 和分栏松手吸附；保留 170px 最小宽度、居中浮窗的双倍指针倍率、最大宽度及持久化。按钮按实际七/八/九个选择单行或四列，不再在最小宽度留下 5+3。

新增 `ssh/file-manager-resize.spec.ts`，经真实 SSH/文件管理器入口进行一次不松手的双向拖动，逐点校验 310px 至 158px 请求区间的实际宽度（下限 170px），覆盖原单行吸附范围、换行断点和最小宽度吸附区；同时验证八按钮为 1×8 或 2×4、按钮不小于 28px、无横向溢出，松手与关闭重开不改变最终 310px。不执行本地行为测试。前批 `72dd5714` / 远程 `39998158139` 尚在运行，本批不推送取消它。

两轮源码复审覆盖全部 widthSnap 消费者移除、指针倍率/边界、七/八/九按钮断点、键盘分栏、保存恢复及取消/卸载收尾。目标测试静态类型通过，日志 `/tmp/nexus-file-resize-test-types.log`。工作区根 check 被并行外观组件的 UiPopover 必填属性类型错误阻断，全量格式被其它 PLAN 表格阻断，未修改这些内容。10 文件独立暂存快照 `/tmp/nexus-file-resize-index` 的根 check、全量格式及双端 build 通过，日志 `/tmp/nexus-file-resize-index-{check,format,build}.log`；未将静态通过记为实际拖动或新 E2E 通过。

## 第六批：目录协议及菜单/审批定位（2026-10-23）

远程 [39967104850](https://github.com/0honus0/nexus-terminal/actions/runs/39967104850) / `517f7814f035be1c9f92040811fe7e2b6bd8a033` 已结束，459 个场景最终 435 通过、23 失败、1 超时；按场景最后结果去重，保留 timedOut。质量、runner、Docker smoke 和 RDP 所在分片通过；不等同于弱网体验已验收。原日志 `/tmp/nexus-e2e-39967104850-shard{1..8}.log`，完整清单 `/tmp/nexus-e2e-39967104850-cases.json`。

shard 4 的 Send Files trace 中独立 Files stat/list 均 200，列表含 `line\nbreak` 文件名，HTTP codec 拒绝控制字符后使整个目录显示未加载。修复对齐 SFTP 的合法 POSIX 名称；原场景增加含换行/制表符/引号的真实目录创建、选择器导航、完整路径保留及 NUL 请求 400，原记忆、取消、混合选择、传输及成功/失败结果断言保留。文件历史/收藏按 menuitem 定位；Agent 开关先关闭挡住点击的成功 Toast；审批按当前 Approve and run 入口，原哈希/版本和真实执行断言保留。不改产品 UI。

两轮复审覆盖完整 HTTP→Files→SFTP 路径、POSIX 名称/Unicode/容量限制、JSON 与 shell 边界、菜单角色和原审批回执。工作区根 check、双端 build、目标测试静态类型通过，日志 `/tmp/nexus-e2e-sixth-{check,build,test-types}.log`；全量格式仅被并行工作区其它 PLAN 表格阻断，未修改该部分。9 文件独立暂存快照 `/tmp/nexus-e2e-sixth-index` 根 check、全量格式、双端 build 均通过，日志 `/tmp/nexus-e2e-sixth-index-{check,format,build}.log`。未执行本地行为测试、浏览器、E2E 或 Playwright 收集。其余视觉断言及功能失败继续保留，不能把本批源码修复写成远程通过。

## 远程失败入口与桌面尺寸修复（2026-10-23，第一批）

基线为远程 [39942702527](https://github.com/0honus0/nexus-terminal/actions/runs/39942702527)，被测 `1dbad409f4b49c077fc35c0cb6a3c44890e01db4`。八组共 162 个唯一失败，其中 138 个首次失败停在旧命令输入 class；SSH helper 已等到 connected，不把入口失效判为 SSH 建连普遍失败。原日志、去重清单及 shard 1/3 产物保存在 `/tmp/nexus-e2e-39942702527-*`。

第一批将命令输入、连接类型/认证 radio、连接测试徽标、新会话入口与挂起列表滚动断言对接当前真实 UI，保留发送、焦点、搜索、隔离、成功/失败及无横向溢出断言；命令栏响应式场景改为当前单行及独立横向工具滚动，键盘查找继续覆盖。Send Files 的 held route 在释放后等待 handler 完成再移除，避免 continue 与 unroute 竞争。

桌面保存边界对小数像素取整，并将窄屏或超大窗口映射到 Shared 的持久范围；不改变实际窗口和 UI。现有 RDP/VNC 拖拽场景改用小数坐标并断言保存返回 200 及实际持久尺寸，不新增或运行本地行为测试。

工作区根 check、双端 build、全量 format 通过，日志 `/tmp/nexus-e2e-current-{check,build,format}.log`。测试 TypeScript 首次命令缺少前端别名，未记通过；补临时静态配置后通过，见 `/tmp/nexus-e2e-current-test-types-final.log`。两轮源码核对覆盖真实 DOM、全部旧输入定位、保存整数范围与 held route 收尾。并行 UI/偏好变更保留，不纳入本批提交；35 文件的独立暂存快照 `/tmp/nexus-e2e-first-index` 根 check、全量格式及双端 build 均通过，日志 `/tmp/nexus-e2e-first-index-{check,format,build}.log`；新远程结果待补。真实 RDP 建连错误、分块刷新及解锁后其它失败仍待处理，不能声称 138 项已通过。

## 第二批远程 E2E 修复（2026-10-23）

第二批 E2E 修复已完成两轮源码复核：外观 tab、设置 radio、菜单 menuitem 和 Agent 审计的技术详情折叠入口对接当前真实组件；服务器状态用四个真实资源、完整可访问数值、网络吞吐、容器范围和趋势切换验证，不保留旧卡片类名造成的空循环。Agent 连续无效保存每次发送 Toast，重新展开只读刷新线程目录且保留已选草稿；全局通知移至背景 inert 区域外，并加入 Agent 焦点允许区域，保留现有通知样式及备份锁定。现有 performance-settings 和 host 场景覆盖真实保存拒绝、通知关闭和跨页线程更新。

远程 [39951440073](https://github.com/0honus0/nexus-terminal/actions/runs/39951440073) / `639b2ef6` 已结束，八组有 74 个唯一失败，质量门禁和 Docker smoke 通过。RDP/VNC 小数拖拽保存场景通过；RDP 建连仍失败，不算通过。原始日志 `/tmp/nexus-e2e-39951440073-shard{1..8}.log`，去重清单 `/tmp/nexus-e2e-39951440073-cases.json`。源码核对 IronRDP 0.7 的握手预读丢弃风险后，桥改为完整协议消息逐条发送，保留 TPKT/Fast-Path/CredSSP、背压、有界残片及关闭语义。新改动尚未通过远程验证，不宣称消除弱网渐进显示。

第二批工作区与独立暂存快照 `/tmp/nexus-e2e-second-index` 的根 check、全量格式及双端 build 通过，日志 `/tmp/nexus-e2e-second-{check,format,build}.log` 和 `/tmp/nexus-e2e-second-index-{check,format,build}.log`；测试严格静态类型通过，日志 `/tmp/nexus-e2e-second-test-types.log`。两轮复审覆盖消息长度/残片、背压和收尾、恢复刷新竞态、通知焦点及真实 DOM 断言。未执行本地行为、浏览器、E2E 或 Playwright 收集；24 文件分批提交后以新远程结果验收，其余失败继续保留。

## 第三批远程 E2E 修复（2026-10-23）

第二批远程 [39955067524](https://github.com/0honus0/nexus-terminal/actions/runs/39955067524) / `9e49762b` 已结束，按每个场景最终记录去重为 409 通过、50 失败；质量门禁、runner 与 Docker smoke 通过。日志 `/tmp/nexus-e2e-39955067524-shard{1..8}.log`，失败清单 `/tmp/nexus-e2e-39955067524-cases.json`。RDP wide DPI 场景通过，覆盖真实认证和 TPKT 消息边界。主 RDP 场景的 Connections、Dashboard、Workspace 建连与认证及浏览器到远端剪贴板内容通过，随后失败于 CDP 出站 Buffer 观察；移动 RDP 同类失败。不能把局部证据写成整个 RDP 场景或分块显示体验通过。

第三批仅修改测试，按当前真实 DOM 对接新会话、历史搜索、加载状态、mixed 复选框、菜单、快捷指令、状态趋势与统一文档搜索。Monaco 继续验证实际匹配内容、数量、焦点和关闭清理；预加载计数先等初始读取排空，仍要求目标只派发一次且点击共享。RDP 同时观察原生 send 的真实二进制调用及入站 binary，断言双向存在且无文本消息，不记录内容或票据，不替换 SDK 或远端响应；认证、真实输入与剪贴板断言保持。

两轮源码复审核对真实组件角色、搜索匹配与清理、计数隔离及二进制观察不改变发送数据。根 check、双端 build、全量格式和测试静态类型通过，日志 `/tmp/nexus-e2e-third-{check,build,format,test-types}.log`。未执行本地行为、浏览器、E2E 或 Playwright 收集；第三批远程待推送验收。已核对 USAGE 相关功能说明，产品行为与 UI 不变；并行 Docker 和 UI 文档改动不纳入本批提交。

22 文件独立暂存快照 `/tmp/nexus-e2e-third-index` 的根 check、全量格式及双端 build 同样通过，日志 `/tmp/nexus-e2e-third-index-{check,format,build}.log`；快照依赖引用自身 Shared 构建产物，不借用并行产品源码变化。

## 第四批：通知重试与设置重新激活（2026-10-23）

远程 `39955067524` shard 8 的 performance-settings trace 显示 `0 → Save → Close → 9 → Save`，首次 Toast 通过、第二次未出现。Notification Store 保留了关闭后 15 秒的 recentErrors，修复移除错误卡片时释放对应键；驻留时仍合并，不改变 UI。连续无效保存原场景继续断言每次错误可见及零 PUT。

同轮 shard 7 host trace 显示离开设置页前 GET/PUT 正常，返回后无 execution-settings GET，开关禁用且执行分组没有草稿。核对 Vue 当前 runtime-core 的 injectToKeepAliveRoot 将后代激活 hook 前插，读取可能早于 scope 激活；Agent 设置、Provider、App/集成/插件/治理、文件库及记忆的恢复读取延至 nextTick，仍由原 scope/generation/available/loaded/busy 控制，旧回调不能恢复写权限或重放写入。host 现有场景增加返回设置时 GET 200、开关启用且保留已保存值，再继续真实关闭写入。

其它定位仅对接当前 UI：集成开关 role=switch；SSH Key 失败 Toast 先关闭再点击原恢复按钮；移动编辑器使用真实 Refresh remote file 入口与统一搜索栏，核对 CodeMirror 匹配内容、计数、焦点和 Escape 清理。不修改布局、样式、尺寸、配色或禁用原功能断言。

根 check、双端 build、测试静态类型通过，日志 `/tmp/nexus-e2e-fourth-{check,build,test-types}.log`；类型检查首次误用不存在的 tsc 文件未执行，改用已安装 tsc6 后通过。初次全量格式仅 PLAN 表格未对齐，修正后全量通过，见 `/tmp/nexus-e2e-fourth-format-final.log`。两轮源码复审核对驻留与关闭去重、原作用域激活顺序、nextTick 后再次停用/卸载/身份变化、只读恢复与写入围栏，以及测试的当前真实入口。不执行本地行为、浏览器、E2E 或收集。独立暂存快照 `/tmp/nexus-e2e-fourth-index` 根 check、全量格式及双端 build 通过，日志 `/tmp/nexus-e2e-fourth-index-{check,format,build}.log`；随后仅补状态缩放场景的另一处旧 network-card 定位，保留图表断言，并重新通过测试静态类型。

第三批远程 [39957933602](https://github.com/0honus0/nexus-terminal/actions/runs/39957933602) / `659ced18` 已结束：426 个唯一场景最终通过、32 失败、1 超时（Send Files），合计 33 未通过。质量门禁、runner、Docker smoke 通过。日志及完整状态去重清单 `/tmp/nexus-e2e-39957933602-*`。RDP 主场景、wide DPI 与 VNC 尺寸/拖拽场景通过；移动 RDP 首次输入观察超时、重试通过，仍有稳定性缺口。弱网分块显示尚未体验验收。不能将这些结果作为尚未推送的第四批证据；其余入口、真实历史分页及新 UI 下的旧尺寸/配色断言继续排查，不为换绿修改产品 UI 或删除断言。

## 第五批：显式任务核对及当前文件列/菜单入口（2026-10-23）

第四批远程 [39962359204](https://github.com/0honus0/nexus-terminal/actions/runs/39962359204) / `996153cc` 最终为 428 个唯一场景通过、30 失败、1 超时，共 459；质量、runner 和 Docker smoke 通过。原日志 `/tmp/nexus-e2e-39962359204-shard{1..8}.log`，完整最终状态清单 `/tmp/nexus-e2e-39962359204-cases.json`。关闭错误后重复提示、Agent 设置返回、密钥失败恢复和移动 CodeMirror 搜索均通过。Agent 搜索本轮通过，但上一轮已确认外部取消后 unknown 界面不会自动读取，仍补显式核对；不声称本轮通过由尚未提交的第五批产生。预加载本轮新失败及其余历史分页、发送超时、搜索不可见和样式断言仍待处理。

本批七份测试保留真实功能，使用当前 menuitem 执行历史复制/删除与连接编辑；unknown 搜索取消后经任务栏刷新读取同一 Run 的 cancelled 回执，再继续后续扫描。文件列按实际根内容宽度断言；仅桌面的列宽拖动表头与移动文件列分别检查，修改时间尺寸检查落到真实文件单元格。列缩放核对三列和两个拖动柄，保留行缩放、列宽稳定及溢出断言；移动多选按当前 is-selected 检查，仍验证退出清除和不误开编辑器。ACP 重载后按 App 数量使用现有选择器或唯一 App 的集成卡片，不增加不存在的入口。

两轮源码复审覆盖工作区响应方法/非空/Run 身份、取消后的空草稿与后续发送、单 App 与多 App 分支、根内容宽度与移动表头条件，以及所有原持久/剪贴板/扫描隔离断言。根 check、双端 build、全量格式和七份测试的静态类型通过，日志 `/tmp/nexus-e2e-fifth-{check,build,format,test-types}.log`；初次静态类型发现可空 Run 回执，初次格式发现函数间距，均已修正后重跑。未执行本地行为、浏览器、E2E 或 Playwright 收集，行为待后续远程验收。核对 USAGE 原任务刷新、菜单和文件列说明仍适用，产品与 UI 不变。

## RDP 浏览器像素提交合并（2026-10-23）

按用户要求保留浏览器 IronRDP 解码与透明桥，参考 Termix Remote Desktop 的脏区域合并思路；没有迁移后端 Worker 解码、Guacamole 协议或有损 JPEG。`rdp-frame-presenter` 仅在当前实例 context 合并已解码像素，下一次 animation frame 提交最新区域，不延迟键鼠或修改网络消息。底图最多 32 MiB；超预算或分配 RangeError 回退原绘制，不引入连接容量拒绝。画面尺寸赋值（包括相同值）、关闭时清理底图与回调，恢复原实例方法/属性。

两轮源码复审覆盖固定 SDK 0.7 的真实 `putImageData` 调用与 width/height setter、WASM ImageData 的同步复制、重叠最新像素、负 dirty 尺寸/边界裁剪、零面积、全宽连续复制、区域数合并、后台回调暂停、超预算/分配失败回退及关闭/晚建连。SDK 原地修改/释放内存后不持有原像素 view；不新增逐帧全屏复制或帧队列。既有真实 RDP 主场景补绘制后的不透明像素与多颜色检查，防止只有 connected 和非零 Canvas 而没有真实画面；原认证、输入、剪贴板和全屏断言保留。

根 check、双端 build、全量格式及目标测试静态类型通过，日志 `/tmp/nexus-rdp-present-{check,build,format,test-types}.log`，全宽复制优化后再通过前端构建 `/tmp/nexus-rdp-present-frontend-final.log`。七文件独立暂存快照 `/tmp/nexus-rdp-present-index` 的根 check、全量格式及双端 build 通过，日志 `/tmp/nexus-rdp-present-index-{check,format,build}.log`；初次快照未生成 Shared dist 导致模块解析失败，先独立构建其 Shared 后重新检查通过，不借用工作区编译产物。按 D17 不运行本地行为、浏览器、E2E 或收集。当前只证明源码与静态范围，真实像素回归、弱网体验、帧提交次数/主线程开销及多平台仍待远程验证；不能将上一轮 RDP 通过作为本批优化证据。

第五批远程 [39964931894](https://github.com/0honus0/nexus-terminal/actions/runs/39964931894) / `8455791e` 最终为 435 通过、23 失败、1 超时；质量与 Docker smoke 通过。原始日志 `/tmp/nexus-e2e-39964931894-shard{1..8}.log`，清单 `/tmp/nexus-e2e-39964931894-cases.json`。历史菜单管理、窄屏连接标签管理、ACP 两分支及列缩放场景通过。文件导航窄屏列验证通过，后续失败在 Copy path 的旧 button 定位；移动多选通过选择/退出检查后出现更深失败，不能宣称整个场景通过。其余失败与历史分页、Send Files 超时仍继续跟进，不改产品 UI。本批像素合并不属于该被测 SHA，真实绘制回归待新远程。

## SSH 多会话隔离补测与漏检核对（2026-10-23）

用户明确要求新增用例，本批据此新增源码；仍按 D17 不运行本地行为、浏览器或 E2E，不自动提交、推送或触发远程。最近远程 39920261630 测试的是 `798e204f2a547213652874dca3792bfd42a194f0`，该版本 Surface 只有一个 DOM 根节点；引入并列安装弹窗的改动仍在本地工作区，未进入该轮远程。原日志 shard 3 的 Connect All 和 shard 5 的 session-cache 都实际执行通过，不能据此声称当前工作区通过，也不能断言旧用例必然漏掉当前缺陷。

覆盖缺口：原缓存场景断言目标终端与背景可见、实例保留，但未完整断言所有非选中内容隐藏；原 Connect All 场景检查连接、协议错误和返回后的后台输出，未验证两个 shell 的输入/输出隔离。上一批已补 Connect All 的唯一可见容器与选中 ID，本批再补缓存场景的唯一可见容器、终端、背景及非选中内容隐藏断言。

新增 `ssh/terminal-session-isolation.spec.ts` 两个场景：分别从“新建连接标签”打开不同连接配置、重复打开同一配置，检查第二标签自动选中、唯一可见容器与会话 ID 一致、不同 Workspace ID、独立 shell 变量、终端键盘输入与命令栏派发、反复 A/B 切换不混入另一会话输出，以及关闭 B 后 A 保留原 shell 并可继续输入。标记在远端 printf 时组合，完整期望值不出现在输入命令内，避免命令回显假阳性。不注入组件状态、不改 UI 或测试夹具。新文件由现有 SSH project 和分组脚本自动发现，无需手动白名单。

本批根 `pnpm run check`、双端 `pnpm run build`、完整 `pnpm run format:all:check`、目标 ESLint/Prettier、三份 SSH 场景的 TypeScript 语法转换与 `git diff --check` 通过；日志 `/tmp/nexus-ssh-isolation-{check,build,format,lint,target-format}.log`。仅转换检查语法，不加载执行测试，也未启动 Playwright 收集；上述新增行为未执行，不能记为 E2E 通过。未提交、推送或部署。

## SSH 第二标签画面隔离（2026-10-23）

源码确认安装弹窗作为 WorkspaceSessionSurface 的并列根节点，使父组件 v-show 与 class 无法落到真实容器。独立修复改由 WorkspacePage 传递 visible，Surface 禁用隐式属性继承，将 v-show 与 $attrs 显式绑定真实容器，不依赖安装模块或根节点数量；本地安装弹窗同时保留在原容器内，但其未提交功能不纳入本次独立提交。不修改 UI 样式、会话通道或后台输出。提交前重新执行根 check、双端 build、目标 ESLint、暂存九文件 Prettier 与暂存 diff 检查通过，日志 `/tmp/nexus-ssh-commit-{check,build,lint}.log`；本次只提交独立修复、回归与文档，不推送或部署。

既有 SSH connection.spec.ts 两会话场景补强新开与 A/B 切换后的唯一可见容器及选中会话 ID 断言，保留后台输出完成断言。根 `pnpm run check`、双端 `pnpm run build`、完整 `pnpm run format:all:check`、目标 Prettier 与 `git diff --check` 通过，日志为 `/tmp/nexus-ssh-surface-{check,build,format,target-format}.log`。按 PLAN D17 未运行本地行为测试、浏览器或 E2E，真实切换与安装浮层仍待远程验收。未提交、推送或部署。

## 远程 E2E 后端范围修复（2026-10-23）

本轮按用户要求先处理后端与服务端夹具，不改正在重构的前端源码、UI 或浏览器测试交互。读取远程 [39830123543](https://github.com/0honus0/nexus-terminal/actions/runs/39830123543) 的八组原始 job 日志，被测 SHA 为 `8f10e54166cf322d4362f1e35fd865cdf6a96c08`；当前本地基线为 `00ec5bfb` 加未提交工作区。原轮质量与 Docker smoke 通过，日志中 HTTP 50、Auth 6、WebSocket 4、SSH 191 个完成记录均为 passed；没有在这些分组确认后端失败，不将这些旧 SHA 记录扩大为当前后端全量通过。

原轮共有 10 个唯一失败场景（每个重试仍失败），其中 3 个 RDP 场景在 `authenticateTestRdp` 的认证计数失败：期望递增 1，实际递增 2。服务端夹具按字符串总出现次数统计；xrdp 0.9 的 `xrdp_wm_log_msg` 先写 DEBUG，再由 `add_string_to_logwindow` 写同文 INFO，因此一次成功重复计算。上游源码核对：`neutrinolabs/xrdp@v0.9.21.1` / `v0.9.24` 的 `xrdp/xrdp_wm.c`，成功调用见 `vnc/vnc.c`；runner 基于 Debian bookworm 的 xrdp。修复仅在 test-desktop-server.mjs 统计完整 INFO 成功消息，不调整客户端严格加一断言、不触发额外连接、不伪造认证成功。产品后端、Shared 与 USAGE 远程桌面行为不变。

| 原失败场景                                                                                                   | 处理范围                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| RDP settings/clipboard/fullscreen、wide RDP DPI、mobile RDP touch                                            | 服务端认证计数转换已修，后续真实输入、剪贴板、全屏和触控仍须远程验收；原失败没有到达的断言不能记为通过。 |
| Agent host 两项、preset plugin 审计入口、ACP denied/cancelled 两项、performance settings、SSH key management | 七项均失败于前端控件定位、校验提示或浮层遮挡，按用户本轮范围留待前端完成后处理，不修改或跳过用例。       |

本轮根 `pnpm run check`、双端 `pnpm run build`、夹具 `node --check`、目标 Prettier 与 diff 检查通过，日志 `/tmp/nexus-e2e-backend-{check,build,format}.log`。全量格式的 ESLint 通过，Prettier 初报本轮 PLAN 和并行 WorkspaceSessionSurface.vue，PLAN 已整理并通过目标格式，不修改该 UI，全量格式不记为通过；构建保留既有大 chunk 警告。按 D17 未新增或执行本地行为、浏览器或 E2E，也未启动 xrdp 或连接真实桌面。原始八组日志 `/tmp/nexus-e2e-shard{1..8}-raw.log`，shard 3 诊断下载于 `/tmp/nexus-e2e-39830123543-shard3`。按 D18 单独提交推送服务端夹具修复和本轮文档；前端与其它未提交实现不纳入。不以源码分析和语法检查代替修复后的远程通过。

修复提交 `798e204f2a547213652874dca3792bfd42a194f0` 已推送；远程 [39920261630](https://github.com/0honus0/nexus-terminal/actions/runs/39920261630) 已结束：448 个唯一场景通过、9 个失败，失败重试也未通过，无整轮通过结论。质量门禁、runner 和 Docker smoke 成功；HTTP 50、Auth 6、WebSocket 4、SSH 191 个完成记录均 passed。第 1/2 组成功，第 3–8 组仍有失败，原始日志 `/tmp/nexus-e2e-39920261630-shard{1..8}.log`，新 shard 3 诊断 `/tmp/nexus-e2e-39920261630-shard3`。

RDP 计数修复的远程证据：Connections、Dashboard、Workspace 三个打开及认证步骤初次与重试均通过，宽屏 DPI 场景直接通过，移动 RDP 也越过认证计数。主 RDP 场景在浏览器文本到远端剪贴板的真实内容核对成功后，失败于 `remoteFrames.some(Buffer.isBuffer)`；远端到浏览器剪贴板与全屏断言因此尚未执行，不能宣称整个场景通过。后端 BrowserDesktopPeer 拒绝非 binary 入帧并以 binary 发送，不为观察断言改传输行为；浏览器观察链的具体原因仍待前端专项定位，未修改该测试。

移动 RDP 首次失败在键盘文本未进入远端 input，重试中真实文本核对通过后同样失败于帧观察断言；首次输入的偶发问题归属尚未确认，保留待查，不冒充已修或简单归为后端。其余七个前端失败与原轮相同，均保留原测试。用户本轮限定后端、前端仍在修改，故不继续改前端源码、UI 或浏览器交互；没有确认需要修改产品后端的新增失败。本轮服务端夹具修复已远程验证原失败消失，其余九项单独承接。

## 明显安全漏洞审核（2026-10-23）

基线为 `dev` / `d0301766` 加当前未提交工作区。按用户范围检查外部入口和实现缺陷，不把已接受的应用内权限与能力设计作为漏洞，不改变 UI。源码检查覆盖 HTTP/WS 来源和身份、因素验证、下载响应、插件隔离与包路径/签名、MCP 网络边界、原生命令参数及日志出口；这是有限源码审核，不是完整渗透测试或全部分支验收。

修复初始化接口在已初始化后仍先执行 scrypt 的资源消耗问题：AccessService 在哈希前检查 needsSetup；SQLite 原子单次创建仍决定并发胜者，原 409 契约不变。生产依赖初次审计报告四条公告：DOMPurify 三条、MCP client 一条。DOMPurify 升至 3.4.17，catalog override 同时覆盖 Monaco；MCP client/core 升至 2.3.1。当前 DOMPurify 消费没有使用公告中的特殊净化模式，MCP Adapter 已禁止重定向，不将依赖公告严重度直接等同于应用可利用性。

`pnpm run check` 通过；`pnpm audit --prod --json` 和全依赖 `pnpm audit --json` 均报告全部等级为零，日志分别为 `/tmp/nexus-security-audit-final.json` 和 `/tmp/nexus-security-audit-all.json`。全量格式的 ESLint 通过，Prettier 最初报告本轮 PLAN 及并行的 WorkspaceLayoutRenderer.vue、WorkspaceSessionSurface.vue；本轮仅整理自己的文档，不修改这两个 UI 文件。

双端 `pnpm run build` 通过，保留既有大 chunk 警告，日志 `/tmp/nexus-security-build.log`；类型日志 `/tmp/nexus-security-check.log`。本轮目标 Prettier 与 `git diff --check` 通过，全量格式日志 `/tmp/nexus-security-format-all.log`；全量格式不记为通过。

按 D17 未新增或运行本地行为、浏览器或 E2E，未发起攻击流量、真实安装、重启或部署。远程待验：已初始化的合法 setup 请求仍为 409 且不执行哈希、空库并发最多创建一个管理员、正常初始化/登录/改密，以及 Markdown/Monaco 和真实 MCP 服务回归；不以静态通过代替这些行为证据。

## 本地文档与当前源码核对（2026-10-23）

本轮仅刷新文档，基线为 `dev` / `829b8434ebe8fe15e25cbc99198b7279bba2a459` 加本地未提交工作区。核对范围包括自研基础组件及 DEV 展示路由、全局 Toast、编辑器统一查找与底部工具栏、服务器发送目录选择及按需轮询、远端依赖安装、治理正式消费者、诊断和部署数据目录。保留此前各轮证据，不以旧八组通过覆盖最新未提交实现。

参考 `Heavrnl/nexus-terminal@c1bf8006aa2666268f0f45f525556c72d3e8961a` 的中文系统内存问题做了源码排查：Remote register 实际安装 PosixServerStatusCollector，读取 /proc/meminfo 与 /proc/loadavg 并导出 LC_ALL=C；本机使用 Node Adapter。未发现依赖 free/uptime 本地化标签的同类路径。当前 MiB 四舍五入与 free -m 截断有小数口径差异，不属于内存缺测。此结论是源码审核，不是 Debian/BusyBox 实机复现或行为通过证据。

本轮验证仅限文档格式、相对链接/源码引用及 diff；不运行行为、浏览器、E2E、真实远端安装或重启，不改变 D17 与既有未验范围。根类型检查和构建未重跑，不复用上一轮静态 PASS 作为本轮证据。

目标九份文档的 `pnpm exec prettier --check` 通过；静态核对 99 个相对文件链接、39 个本地 Markdown 锚点和 11 个源码路径，修正 README 原先指向已不存在部署标题的链接，全部可定位。`git diff --check` 通过。以上只证明文档格式及引用有效，不证明产品行为通过。

## 通用远端依赖安装（2026-10-23）

基线 `dev` / `829b8434ebe8fe15e25cbc99198b7279bba2a459` 加当前未提交工作区；Node `v22.23.1`、pnpm `11.26.0`。新增 Remote tools check/install、固定六类包管理器、sudo stdin 认证与原持久机器突变围栏；真实前端消费者为 SendFilesModal 和 WorkspaceSessionSurface 的归档派发前检查，不增加配置页面或修改既有 UI 设计。

完成两轮源码复审，覆盖 Shared 严格联合/容量/请求关联、显式凭据表示转换、会话摘要与目标指纹绑定、单次计划消费与过期、多计划共存、前置探测及原生任务继续自检、auto 的双端 scp 回退、ZIP/GNU tar/coreutils 及压缩器依赖、无权限/主机不受信任/认证失败/软件源失败、未知派发及清理保留、退出/关闭/停机追踪、前端秘密与监听收尾及不自动重放文件操作。复审发现并修正：auto 不能强制安装可回退的 rsync；BusyBox 同名命令不能冒充 GNU 能力；不同确认不能相互作废计划；严格期限须在真正派发前检查；缺失/超限的安装回执不能报认证拒绝或成功。源码范围与四表见 PLAN。

最终 `pnpm run check`、双端 `pnpm run build` 通过，日志 `/tmp/nexus-tools-{check,build}-final.log`；目标 Prettier 与 diff 检查通过，日志 `/tmp/nexus-tools-target-format.log`。生成命令只捕获并交给 `/bin/sh -n`，六包管理器 × root/免密 sudo/密码 sudo 及其探测共 37 份脚本语法通过，日志 `/tmp/nexus-tools-shell-syntax.log`；没有连接 SSH、执行 sudo、调用包管理器或安装软件。这只是脚本语法证据，不是权限、安装或功能行为回归。首次检查曾遇到 Shared dist 未重建及真实凭据取值不匹配，均在修复并重建后重新检查，不复用原失败结果。

按 D17 未新增或执行本地行为/浏览器/E2E；远程待验：工具齐全不安装、取消不派发文件操作、root/免密/正确及错误 sudo 密码、无 sudo/不支持包管理器、软件源失败/包锁/工具仍缺失、六类发行版、三格式归档、源/目标缺失与 auto 回退、多个视图/登录和目标配置变化、安装中失联或取消、真实退出与清理失败、重复/过期计划、unknown 跨重启及人工恢复。现有服务器传输和归档 E2E 仍由正式消费者走新预检，未删断言或用假安装放行。

仅新增 tools 来源而复用原持久 claim 表，按 D14 同步唯一 v1 签名，旧开发数据库不兼容；本轮没有删除旧库、重启后端、提交推送或真实安装。构建保留既有大 chunk 警告；最终全量格式的 ESLint 通过，Prettier 仅报告并行 `ProgressDisplayModal.vue`、`WorkspaceLayoutRenderer.vue`、`WorkspaceSessionSurface.vue` 三个文件，日志 `/tmp/nexus-tools-format-all-final.log`。不整理其原有样式；目标格式命令排除整个 WorkspaceSessionSurface，仅格式化本次新增的接入片段，其余任务文件及所有新模块文件完整通过。

## 服务器发送目录选择（2026-10-23）

保留原后台多目标 rsync/scp；目标路径只通过真实 Remote Files HTTP 独立 SFTP 资源选择，不再手填。Filesystem 拥有 API 白名单转换、目录/链接检查、导航串行和关闭排空；Transfers 只持参考目标、共同路径及按用户/连接创建身份/配置版本绑定的浏览器记忆。根目录仅放开为目标，源根目录仍拒绝；路径尾部空格保持原值。选择器取消不改原路径，旧路径不存在提示并只读退回根目录，超限/权限/不受信任主机走 Toast，不绕过 Host Key 校验。闲置后下次导航重开资源，无轮询；开启回执丢失无法定位资源时依赖后端原独立资源空闲回收，不把取消视为释放确认。

既有 Progress Display 的真实服务器发送场景同步：预建现有目标目录，使用合法的上次浏览目录作为夹具起点，实际浏览子目录确认，取消/重选时核对记忆，继续验证多目标部分成功、rsync 方法、原源文件及目标文件内容；不改为 mock 传输、不移除断言。既有 server-transfers 集成脚本同步目标根目录及空白路径保持的协议断言。D17 未运行本地行为/浏览器/E2E；远程还需核对隐藏/注销/切目标时晚开启和释放失败、空目录/链接、记忆目录删除、列表失败但目录本身已确认时仍可选择、缓存隔离与窄屏键盘交互。

本轮根 check、双端 build、目标 Prettier、改动 E2E 类型、既有 server-transfers 集成脚本语法及 diff 检查通过，日志 /tmp/nexus-directory-picker-{check,build,target-format,e2e-types}.log。E2E 类型通过临时独立编译配置检查，没有修改项目 tsconfig 或收集/运行测试；初始无 E2E tsconfig 的命令仅显示帮助，继承前端 noUncheckedIndexedAccess 也曾触发 Shared 既有源码告警，均不记为通过，随后按独立 E2E 检查口径调整。各包原类型门禁仍完整通过。全量格式仅报告并行 BackupSettingsPanel.vue、FileManager.vue、ProgressDisplayModal.vue、WorkspaceLayoutRenderer.vue、WorkspaceSessionSurface.vue，未替其整理；日志 /tmp/nexus-directory-picker-format.log。构建保留既有大 chunk 警告，不自行重启、提交、推送或部署。

## 通用模块资源诊断（2026-10-23）

接入 prom-client 的官方后继包 `@prometheus-io/client@0.16.1`（原 npm 包已标记迁移），仅在 Platform Adapter 内使用私有 Registry、Gauge 与 Histogram。主线程 GC 由可显式断开的 PerformanceObserver 记录，不直接安装缺少本地 owner 退订入口的默认采集器，不添加公共抓取/调试端口、强制 GC、堆快照或常驻堆采样。七个业务模块统一观察在途 HTTP；Remote 额外采集普通工作区、挂起/断开、四类逻辑缓冲字节、传输及状态订阅，Agent 采集执行/写入/请求，Storage 采集已派发 SQLite 请求、已接纳的排队及执行操作和主库 Worker 的独立堆/外部内存/ArrayBuffer，System 采集诊断请求。只计数的模块明确未计量内存，不以零冒充缺测，不合计可能共享底层数据的字节或从 RSS 反推占用。

源码复审覆盖 route 预算/路径元数据保留、finally 计数收尾、单组失败隔离、重复/非法指标拒绝、私有标签有限基数、并发采集合并及一秒成功缓存、逐次管理员准入/交付前复查、停机和在线恢复清空 collector/Registry 及 GC 退订。Shared 严格校验完整八组、唯一 ID/指标、单位与名称关联、非负有限数字、堆用量不超过堆容量、失败/未接入空指标；Model、HTTP、公有出口、Agent 工具及前端 mapper 均同步。正式数据页在现有宿主诊断内折叠展示明细，三语明确主线程/进程与 Worker、external/ArrayBuffer 的口径。既有 system-management 集成场景同步真实 API 数值、八组身份、Remote 字节指标及正式页面明细断言，未新增或执行本地行为场景。

最终根 `pnpm run check` 与双端 `pnpm run build` 通过，日志 `/tmp/nexus-module-diagnostics-{check,build}-final.log`；新包 Backend check 另见 `/tmp/nexus-module-diagnostics-types-final.log`。构建保留既有大 chunk 警告。全量格式仅报告并行修改的 `BackupSettingsPanel.vue`，未修改该文件，日志 `/tmp/nexus-module-diagnostics-format-final.log`。按 D17 未运行行为、浏览器或 E2E，不据静态结果宣称实际内存归因或开销已验收。

待远程核对：管理员/匿名/过期身份、多个调用不再触发四个请求上限、只缓存成功读取、模块单独失败与其它组可读、HTTP 成功/拒绝/抛错后计数回落、缓冲增长及取消/挂起/恢复后收敛、传输和 Agent 生命周期、无会话重复计数、Worker 口径及堆用量不超过容量、事务整体计数及 finally 回落、Worker 忙碌/故障/维护关闭时诊断无队列等待环或晚结果污染 Registry、重复刷新无重复指标及在线恢复/关闭无 GC observer 累积、手机布局和异常 Toast。前后端诊断契约同时升级，需要重启 Backend 才能读取新字段；本轮按用户授权仅提交诊断相关变更，不自行重启、推送或部署。

本轮 Worker 内存续补：严格 Worker 请求/结果白名单、非负安全整数字节和 heapUsed ≤ heapTotal；采样绕过 Runtime 事务队列但不绕过 Worker 消息顺序，同一采样共享 Promise，关闭拒绝新采样。队列计数从接纳直到执行 finally，事务整体计一项。异步 Collector 并行采集、单组拒绝隔离、关闭后晚结果不能重写 Registry 或交付快照。既有集成断言同步四项 Worker 字节、操作计数和堆容量关系，仅做语法检查，未执行行为。固定八组全部十九项取 MAX_SAFE_INTEGER、运行时字段按转义最坏值估算，完整 JSON 为 12,053 bytes，小于 16 KiB，不增加协议预算或标签基数。

续补静态：根 check、双端 build 通过，日志 /tmp/nexus-memory-continuation-{check,build}.log；目标 Prettier、既有脚本语法和 diff 检查通过。完整格式仍仅报告并行 BackupSettingsPanel.vue，日志 /tmp/nexus-memory-continuation-format.log；不修改该文件。实际 Worker 忙碌、故障、关闭/维护及缓冲变化仍待远程，不将本轮静态结果当行为通过。

## 文件管理器工具紧凑宽度（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`、真实 `amd` 连接及 `1920×953` 视口核对文件管理器工具区：控制宽度由 `30px` 收窄为 `28px` 后，`1×8` 吸附宽度由约 `280.6px` 降至 `265.7px`，工具仍稳定为单行 8 枚，按钮组左右留白各 `5px`，工具栏和面板均无横向溢出。证据：`.tmp/fm-embedded-1x8-cdp.png`。目标 Prettier、Frontend build 与 `git diff --check` 通过；根 `pnpm run check` 的 Backend type check 被并行修改的 `platform/storage/sqlite/adapters/worker.ts` 类型错误阻断，未修改该无关文件。

## 挂起会话面板左缘对齐（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`、真实 `amd` 及以上终端首页挂起目录核对：调整前标题图标左缘为 `1225px`，搜索框与卡片左缘均为 `1238px`；移除内容左缩进并改为只在右侧保留稳定滚动条槽后，三者左缘统一为 `1225px`，搜索框和卡片右缘统一为 `1503px`。证据：`.tmp/suspended-alignment-after.png`。

## 命令栏输入标识与最小宽度（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`、真实 `amd` 连接及 `1920×953` 视口核对：普通命令输入框不再显示“命令”占位文字，提示符为文本 `>`；输入框可访问名称仍为“终端命令”。命令栏容器宽 `281.7px` 时输入框宽 `147.7px`，提示符 `11px`；临时将容器缩至 `150px` 时输入框保持 `40px` 可见宽，CSS 最小宽度按提示符、间距、内边距和边框计算为 `32px`，提示符仍显示且页面无横向溢出。证据：`.tmp/command-bar-prompt.png`、`.tmp/command-bar-prompt-narrow.png`。

## 服务器状态外层边界与网络间距（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`、真实 `amd` 连接及 `1920×953` 视口核对：服务器状态面板 `232.18×390.78px`，四边边框均为 `0px`、外层背景透明；五张内部指标卡仍各有 `1px` 边框，标题分隔线保留。网络行在紧凑高度规则下使用 `7px` 行间距，标题与速率行的实际视觉间距由约 `4.8px` 增至 `11.2px`，未挤压卡片或产生溢出。证据：`.tmp/status-monitor-border-gap.png`。

## 服务器状态趋势网卡定位与时间选择（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`、真实 `amd` 连接并打开网络趋势核对。`1920×953` 下网卡名左缘为 `191.4px`、右缘为 `245.8px`，贴合网络行 `234.23px` 内容区的右缘；`1440×900` 下左缘为 `135.58px`、右缘为 `180.63px`，同样完成右对齐。时间选择容器由 `44.8px` 降至 `26px`，四个按钮均由 `38.4px` 降至 `22px`；两档下文字均未截断，面板与页面无横向溢出。顶部主机状态改为等效 `6px` 圆角、`0.86em` 加粗文字；窄面板隐藏复制装饰后，两档主机名 `clientWidth` 与 `scrollWidth` 均为 `51px`、`33px`，完整显示 `honus.top`。证据：`.tmp/status-trend-network-1920.png`、`.tmp/status-trend-network-1440.png`。目标 ESLint、Prettier、Frontend build 与 `git diff --check` 通过；根 `pnpm run check` 被并行修改的 `observation-model.ts:255` `curly` 错误阻断，未修改该无关文件。

## 命令栏与文件管理器工具按钮边框（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`、真实 `amd` 连接及 `1920×953` 视口核对。命令栏 `265.72×41.69px`、文件管理器 `265.72×569.95px`，两处工具按钮均计算为 `1px` 边框、边框色 `34%`，面板 `scrollWidth-clientWidth=0`。文件管理器 `.file-manager-actions` 的计算背景为 `rgba(0, 0, 0, 0)`、`box-shadow` 为 `none`，工具组整体外框已移除；1×8 按钮排布和文件列表未改变。证据：`.tmp/command-bar-buttons-border.png`、`.tmp/file-manager-tool-borders.png`。目标 ESLint、Prettier、Frontend build 与 `git diff --check` 通过。

## 终端右上角按钮独立显隐（2026-10-23，本地 CDP）

使用隔离数据库旧记录与新版偏好契约核对兼容读取：旧 `showCommandBar*` 键被允许但忽略，四个新字段按 `true` 补齐；四项保存为 `false` 后重新读取仍为 `false`，部分组合读回一致，下一次保存只写新字段。桌面 CDP 分别关闭四项后，对应挂起会话、顶栏、进度和布局按钮消失；重新开启后恢复。配置布局仍只在桌面显示，进度入口开启后常显。

后端使用旧版偏好记录的隔离数据库启动后，读取版本 `281` 自动补齐四个新字段为 `true`。CDP `1440×900` 真实 `amd` SSH 会话下，标签栏默认显示挂起会话、隐藏、进度显示和配置布局四项；逐项关闭后版本从 `300` 推进至 `304`，每次只移除对应按钮；四项全关后右侧操作按钮为 0，关闭标签页与新建连接仍保留，命令栏已启用按钮保持可见。设置页四个新 ID 均存在、四个旧命令栏 ID 均不存在，最后恢复四项为 `true`，数据库 JSON 的旧键数量为 0。证据：`.tmp/workspace-tabbar-defaults-1440.png`、`.tmp/workspace-tabbar-all-off-1440.png`、`.tmp/workspace-tabbar-settings-1440.png`。

## 服务器状态方形卡片与网络图标居中（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`、真实 `amd` 连接核对普通服务器状态。`1920×953`、状态面板 `254.69×460.41px` 时，CPU、内存、Swap、磁盘四张卡均为 `114.15×114.15px`，形成 2×2 网格；详情在卡内缩放并保持完整，内存与磁盘容量不再出现省略号。网络卡为 `234.32×117.15px` 的通栏 2:1 卡片，图标高 `22px`、中心 `y=860.77px`，与卡片中心重合。`1440×900` 下状态面板宽 `190.06px`，资源卡仍为单列 `168.55px`，避免方形压缩导致文字溢出；网络图标中心与 `81.83px` 高的网络卡中心重合。证据：`.tmp/status-card-square-1920.png`、`.tmp/status-card-stack-1440.png`。

## 文件管理器窄栏排序单行（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`、真实 `amd` 连接及 `1920×953` 视口核对文件管理器拖拽至 `2×4` 工具布局：面板宽 `169.83px`，工具行为 `[4,4]`，排序行宽 `161.83px`、高 `26px`；排序选择与方向按钮的 `top` 均为 `263.66px`，排序行和工具栏的 `scrollWidth-clientWidth` 均为 `0`。窄栏隐藏视觉“排序”标签与方向文字，但保留排序选择的可访问名称及方向按钮的 `title`/`aria-label`。证据：`.tmp/fm-embedded-2x4-cdp.png`。根 `pnpm run check`、目标 Prettier、Frontend build 与 `git diff --check` 通过；全量格式检查只被并行修改的 `node-process-diagnostic.ts`、`BackupSettingsPanel.vue`、`HostDiagnosticsPanel.vue` 阻断，未修改这些无关文件。

## 监控核心周期与开关合并（2026-10-23，本地 CDP）

工作区设置的“首页与监控”将本机/远程资源开关与监控采样/主机缓存周期、Docker 默认展开与状态刷新周期合并为 2×2 的紧凑卡片，分组右上角保留单一保存入口。`1440×1000` 下分组 `1020px` 宽，四张卡片各 `487×54px`，周期输入容器各 `108×28px`；`390×844` 下分组 `350px` 宽，带周期卡片 `320×80px`，无横向溢出，页面 `scrollWidth=382 < innerWidth=390`。

`node tests/frontend/monitoring-configuration.integration.mjs` 通过真实 HTTP/重启、CAS 冲突/未知结果、三组件与中英日翻译在内的 57 项断言，确认合并分组一次提交只产生一次核心写入并发布成功 Toast。证据：`.tmp/monitoring-group-final-1440.png`、`.tmp/monitoring-group-final-390.png`。目标 Prettier/ESLint、Frontend 类型检查与 `git diff --check` 通过。

## 首页与监控窄屏时间控件单行（2026-10-23，本地 CDP）

使用 `https://api.honus.top/settings?tab=workspace` 核对。`390×844`、`320×844` 与 `1440×844` 下卡片顺序均为“显示本机资源 → 显示远程资源 → 默认展开容器详情 → 在状态监视器中显示IP地址”，四卡均为 `54px` 高，三个周期卡片不再换行；“采样/缓存/刷新”可见文字已移除，只显示时钟、数值和单位，时间输入仍保留完整 `aria-label`。`390px` 下时间控件为 `108×28px`，`320px` 下卡片内边距与时间控件自动收窄为 `8px / 100px`，标题与时间仍同处一行，页面 `scrollWidth=clientWidth`。证据：`.tmp/monitor-order-390.png`、`.tmp/monitor-order-320.png`、`.tmp/monitor-order-1440.png`。本轮只读取设置并切换视口，未保存任何偏好。

## 日志等级标题对齐与挂起会话搜索文案（2026-10-23，本地 CDP）

使用 `https://api.honus.top/settings` 核对系统设置：前端与后端日志等级两列各宽 `630px`，两个标题均为 `72×16px` 且 `top=540.19px`，两个选择框均为 `630×32px` 且 `top=559.78px`；不显示当前生效级别。使用 `https://api.honus.top/workspace` 核对挂起会话搜索框，`placeholder` 与 `aria-label` 均为“搜索会话”。证据：`.tmp/settings-logging-after.png`、`.tmp/suspended-search-placeholder-after.png`。

## 挂起会话空态两行预留高度（2026-10-23，本地 CDP）

挂起会话空态原先按 `91px × 2 + 6px = 188px` 预留，但真实会话卡片为 `78px`，导致空态比两行多出约 `26px` 并产生内部滚动。现改为按真实卡片高度 `78px`、间距 `6px` 预留两行；固定高度面板使用 `min(162px, 100%)`，可用空间略少时贴合容器，页面滚动模式仍固定预留 `162px`。同时移除一条对容器自身无效的 `max-height: 220px` 变量覆盖。

使用 `https://api.honus.top/workspace` 的右侧挂起会话面板搜索无结果态核对：面板高 `210.95px`，列表容器与空态高 `160.95px`，`clientHeight` 与 `scrollHeight` 均为 `161px`，空态图标与文字整体居中；恢复结果后单卡仍为 `78px`。证据：`.tmp/suspended-empty-after.png`。目标 Prettier/ESLint、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过。

## 文件编辑器底部工具栏与编码菜单（2026-10-23，本地 CDP）

文件编辑器顶部仅保留标签和路径；编码、换行、保存状态、搜索、刷新、保存和关闭移到底部工具栏，外壳改用当前主题的玻璃表面、边框和基础按钮，移除了编辑器专属的独立深色控件样式。编码菜单不再跟随窄触发器宽度，桌面展开为 `160px`，`Windows-1252` 等长名称的 `scrollWidth=clientWidth`，选中项与选项均居中，左右内边距对称。

使用 `https://api.honus.top/workspace` 连接真实 `amd`，打开 `/etc/hostname` 核对：`756px` 编辑区下底部工具栏单行高 `41.78px`；`400px` 编辑浮窗与 `350px` 手机编辑区下自动换行为两行，高 `72.66px`，编码触发器 `92.8×28px`、菜单 `160×329px`，编辑区及页面均无横向溢出。证据：`.tmp/file-editor-final-encoding-open.png`、`.tmp/file-editor-theme-footer-mobile-open.png`。目标 Prettier/ESLint、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过。

## 文件操作弹窗基础组件统一（2026-10-23，本地 CDP）

新建文件夹、创建文件、重命名和权限修改统一改用 `UiDialog`、`UiFormField`、`UiInput`、`UiFormActions` 与 `UiButton`，保留原表单提交、冲突校验、忙状态和关闭清理行为。桌面 `1920×953` 下弹窗为 `448×229.89px`，输入框 `410×36px`，取消/确认按钮各 `88×36px`；手机 `390×844` 下弹窗为 `366×245.89px`，输入框 `328×44px`，操作按钮各 `161×44px`，弹窗与页面均无横向溢出。截图：`.tmp/file-manager-mkdir-base-dialog-final.png`、`.tmp/file-manager-create-file-base-dialog.png`、`.tmp/file-manager-mkdir-mobile-final.png`。目标 Prettier/ESLint、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过。

## 快捷指令列表视觉回退（2026-10-23，本地 CDP）

按用户要求仅回退快捷指令工具栏以下的分组与条目视觉，顶部搜索、排序、紧凑、显示模式及新增按钮保留新版。分组区域恢复重构前的卡片边框/底色、组头数量胶囊、组内浅底色与条目间距；扁平列表恢复原卡片容器。运行、右键菜单、标签编辑、搜索、缩放和响应式行为未改。

使用 `https://api.honus.top/workspace`（未使用 9998）连接真实 `amd`，在 CSS 视口 `1920×953` 核对双项分组与单项分组：双项卡片 `240.19×108.44px`，两条指令均为 `230.19×30.22px`，`scrollWidth=clientWidth`；单项卡片高 `74.22px`。工具栏 5 个按钮各 `28px` 且均可见。将 pane 收窄至 `220px`、`170px`、`120px` 后，根节点及分组、条目均无横向溢出。证据：`.tmp/quick-commands-reverted-lower.png`、`.tmp/quick-commands-reverted-page.png`、`.tmp/quick-commands-reverted-{220,170,120}.png`。目标 Prettier/ESLint、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过；本轮为本地 CDP 视觉验收，不替代完整 E2E；未提交、推送或部署。

## 挂起恢复连接指示（2026-10-23）

源码确认 `WorkspaceTabBar` 原先优先将挂起标记映射为蓝色，覆盖了恢复成功的 connected 状态。现仅按实际连接状态显示颜色，不修改挂起标记、续租、恢复或关闭行为。既有手机挂起/恢复场景补充标记后及恢复后的 connected 与绿色指示断言，原有保留会话和关闭后再次挂起的断言保持。

根 `pnpm run check`、Frontend build、目标 ESLint/Prettier 通过；日志 `/tmp/nexus-resume-dot-{check,build}.log`。构建保留既有大 chunk 警告；全量格式仅报告并行修改的 `BackupSettingsPanel.vue`，未改该文件，见 `/tmp/nexus-resume-dot-format.log`。按 D17 未运行本地行为或 E2E，真实挂起恢复及连接失败颜色仍待远程核对；不宣称行为已通过。本轮按授权仅提交连接指示修复，不推送。

## 后台服务器传输按需刷新（2026-10-23）

`serverTransfers.store` 改用读取结算后的单次计时器：进入/返回工作区只读一次，只在 queued/in-progress/cancelling 时继续获取，发送成功自动恢复，全部终态或空列表停用；离页/注销阻止晚完成重启。提交未知仅做只读核对，不重放发送，不清除原未知保护。现有 Progress Display 场景改为计数真实 HTTP 请求，等待超过原轮询周期后验证空闲期间没有额外请求，并保留空态、无 loading 替换及真实复制完成断言；已有真实服务器传输场景继续验证发送后最终状态与移除。

按 D17 未新增测试用例或执行本地行为/E2E。根 `pnpm run check`、双端 `pnpm run build`、目标 ESLint 和改动 E2E 文件 TypeScript 静态编译通过，日志 `/tmp/nexus-transfer-on-demand-{check,build,eslint}.log`；构建保留既有大 chunk 警告。全量格式只报告并行修改的 `BackupSettingsPanel.vue`，未修改该文件；日志 `/tmp/nexus-transfer-on-demand-format.log`。待远程核对空列表/全部终态停轮询、发送后恢复、取消中仍更新、请求慢于周期时无重叠、离页/注销、返回恢复及未知提交只读核对；不宣称已行为通过，不自动提交或推送。

## 命令栏展开与工具区浅边界（2026-10-23，本地 CDP）

使用 `https://api.honus.top/workspace`（未使用 9998）登录现有测试账号并连接真实 `amd`，在 CSS 视口 `1920×953` 核对内嵌命令栏和文件管理器。命令栏删除桌面 `...` 溢出菜单后，清空、焦点配置、文件管理器、编辑器和搜索 5 个图标同时直接显示；`...` 元素与图标计数均为 0。命令栏 pane 宽 `320px` 时，输入区为 `156px`、工具区为 `148px`，工具区 `scrollWidth=clientWidth=148`；`260px` 时输入区 `96px`、5 个按钮仍完整；`210px` 时输入框内容区 `24px`，恰好完整显示“命令”两字，工具区仍为 `148px`；`190px` 时输入内容区保持 `24px`，工具区改为 `128/148px` 横向滚动且五个按钮仍保留。输入框采用 `flex: 1 1 0`，常规 `min-width: 64px`，极窄隐藏提示符后为 `46px`，空间不足时先压缩输入区。

文件管理器工具组增加低对比圆角底纹与 1px inset 边界，实测 `box-shadow` 为边框色 24% 透明度，按钮行、路径行和文件列表布局未改变。证据：`.tmp/fm-command-after-min.png`、`.tmp/fm-command-narrow-after.png`、`.tmp/fm-command-min-command-text-clean.png`。目标 Prettier/ESLint、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过；本轮为本地 CDP UI 验收，不替代完整 E2E；未提交、推送或部署。

## 挂起会话卡片视觉回退（2026-10-23）

按用户要求只回退挂起会话卡片视觉，不调整新版搜索栏、空态、弹窗标题栏和滚动正文。源码对比确认 `SuspendedSessionsPanel.vue` 的卡片 `<ul>` 模板与上一提交逐字一致，卡片 CSS 段也与上一提交一致；仅保留外层 `suspended-toolbar`、新空态和卡片列表容器。恢复/接管、取消标记、改名、导出、移除、搜索及目录同步逻辑未改，弹窗与 `pageScroll` 布局保持当前版本。

当前真实挂起目录为空，因此没有为视觉截图额外创建并终止挂起会话；本轮以源码等价比对和静态检查验收。目标 ESLint/Prettier、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过。未提交、推送或部署。

后续按用户截图补调左右边界。搜索区与卡片列表使用相同横向内边距，列表采用双侧稳定滚动条槽，并在搜索区右侧补偿滚动条宽度。经 `https://api.honus.top/workspace` 的 CDP 实测，搜索外框与卡片左右边界完全一致：`1024×900` 均为 `709–970px`（宽 `261px`），面板为 `696–983px`；`390×844` 均为 `27–347px`（宽 `320px`），面板为 `12–362px`；`320×700` 均为 `25–279px`（宽 `254px`），面板为 `12–292px`。对应左右留白为 13px、15px、13px，未产生横向溢出。截图：`.tmp/suspended-spacing-current.png`、`.tmp/suspended-spacing-1024.png`、`.tmp/suspended-spacing-390.png`、`.tmp/suspended-spacing-320.png`。仅修改展示 CSS，搜索、恢复、导出、移除、空态和目录同步逻辑未变。

## 使用中终端的挂起目录移除（2026-10-23）

本批按用户确认修改：移除仍附着的挂起记录只取消挂起，不关闭原 SSH/PTY；后台无人使用时才终止。新增安全移除 HTTP 回执和原附件 `suspend.unmarked` 事件，正式目录不再根据旧 `status` 选择终止接口；取消事件同时清除本地挂起标记、续租及历史入口，避免重新出现“待关闭”替身。准备提交或恢复中的记录返回冲突，不自动终止。

按 D17 未新增或运行本地行为/E2E；待远程验证同设备与跨设备移除使用中记录、原 PID/输入输出不变、目录及本地标记同步、后来打开的终端不受影响、后台终止、断开条目移除、准备/恢复/重复移除竞争和未知清理围栏。不继承此前 Actions 或 UI CDP 结果。

源码复审确认：安全移除由后端读取当前附着事实，准备/恢复状态拒绝；并发取消共用原清理 Promise，取消期间不能重新取得挂起所有权；日志/checkpoint 失败保持未知，不降级终止。前端按 ID/generation 清除原标记，晚到回执不能重新挂起已取消记录；“取消挂起”动作不再切换为“重新挂起”，旧 UI 点击不影响新状态。根 `pnpm run check`、双端 `pnpm run build`、目标 ESLint/Prettier 和 `git diff --check` 通过，证据 `/tmp/nexus-suspend-remove-final2-{check,build}.log`、`/tmp/nexus-suspend-remove-eslint.log`、`/tmp/nexus-suspend-remove-target-format.log`。全量格式检查在并行修改的 `BackupSettingsPanel.vue`、`FileManager.vue`、`SuspendedSessionsPanel.vue` 样式处失败，未调整这些无关格式；日志 `/tmp/nexus-suspend-remove-format-final.log`。构建保留原有大 chunk 警告；未提交、推送或重启。

## 挂起会话目录卡片与弹窗（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top/workspace` 核对，未使用 9998。启动页已有真实挂起会话 `amd`。`819×378` 下弹窗 `480×200.9px`、内嵌面板 `454.4×130.5px`、卡片 `454.4×90.5px`；标题栏固定，正文 `overflow-y:auto`。手机视口 `390×844` 弹窗 `358×201.5px`、卡片 `332×90.5px`，`320×700` 弹窗 `288×201.5px`、卡片 `262×90.5px`，`270×700` 弹窗 `238×201.5px`、卡片 `212×90.5px`；三档文档宽度均等于视口，操作组在窄容器居中，270px 下恢复按钮收起文字但保留图标和无障碍名称，导出、移除按钮仍为 `26×28px`。

搜索注入不存在的名称后显示 `332×104px` 空态“没有找到符合条件的挂起会话。”，清空搜索恢复 1 张卡片。核对后通过卡片移除按钮与确认框终止并移除真实测试挂起会话，挂起卡片归零且弹窗关闭；随后关闭 `pve_debian` 测试标签页，并清理临时视口与触摸仿真。证据：`/tmp/suspend-current.png`、`/tmp/suspend-after-card-819.png`、`/tmp/suspend-mobile-390.png`、`/tmp/suspend-mobile-320.png`、`/tmp/suspend-mobile-270.png`、`/tmp/suspend-search-empty-390.png`。

目标 Vue ESLint/Prettier、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过。本轮为本地 CDP 视觉与有限交互验收，不替代完整 E2E；未提交、推送或部署。

## 远程 Actions 修复第三批（2026-10-22）

第二批被测 SHA `b010273fbdb0552c3557c6c30323df59817b6cb1`，[39827272148](https://github.com/0honus0/nexus-terminal/actions/runs/39827272148)。Agent 的真实 SSH 部署、修复、文件生命周期与搜索原失败场景已通过；分片 4 普通组 56 项通过，但随后特殊工具组的桌面夹具重启失败，不能记作该分片通过。

第三批修复：记忆审核从已移除的设置页迁移到当前对话卡片，保留 confidence、管理发布/撤销和原版本 CAS 冲突核验；失效挂起恢复测试受控延迟 WS 投影，取消挂起核对 WS 回执及独立目录事实，健康前台断言不重复 HTTP。Toast 关闭等待原 DOM 节点退场，避免 `.last()` 重绑定到剩余通知；显式关闭前一错误后继续密码/外观操作，恢复入口使用 Reload settings。

RDP 失败截图 `/tmp/nexus-rdp-ci.png` 显示实际停在 xrdp 登录画面；SDK 当前 autologon 为 false，不以 Connected 标签冒充桌面认证。夹具预填固定测试密码，通过真实 RDP Enter 确认登录并核对服务端 VNC 成功次数，再执行原双向剪贴板和输入断言。VNC 单行文本框不再尝试填入被浏览器剥除的换行，发送文本后通过远端键盘 Enter 提交。Xvnc 改用 displayfd 分配空闲 display，并为桌面 webServer 配置 SIGTERM 清理，避免同分片串行特殊组复用被强制终止的固定 X display。

窄屏离线 DOM 显示底层连接页头仍保留完整添加按钮，310px 的图标化断点未覆盖 320px，导致页面多出 73px；仅将已有紧凑页头断点修正为 420px，不改弹窗或整体视觉设计，原溢出断言不放宽。根 check/build 通过，日志 `/tmp/nexus-e2e-repair3-final2-{check,build}.log`；新增测试交互后补充目标 ESLint、改动 E2E TypeScript 编译（零诊断）、全量格式、diff 与桌面脚本语法检查通过，最终格式日志 `/tmp/nexus-e2e-repair3-final3-format.log`。未运行本地行为测试或 E2E；新远程结果待验。

## 远程 Actions 修复第二批（2026-10-22，不改 UI）

`3ec0f570` 的 [39823945737](https://github.com/0honus0/nexus-terminal/actions/runs/39823945737) 静态、构建及 Docker smoke 通过，八个行为分片仍失败。离线 trace 已确认 Agent Run 的 `input.connectionIds` 为空；Reka checkbox 的交互节点不提供原生 input value，夹具改按控件 ID 选择并同时断言选中状态及实际派发目标，不放宽后端授权。

第二批同步当前嵌套 App/集成/市场分页、Agent 启用前提、设置保存及 dirty 状态、统一 Toast 反馈与显式关闭、真实 VNC 夹具及 RDP 连接就绪、SSH 结果与初始加载定位。终端断线验证首次自动恢复失败后等待任意键，保留按键恢复、真实 Shell 与几何断言。Workspace 前台恢复不再无条件额外读取 HTTP 挂起目录，断开挂起会话 reconciliation 仍读取权威事实；USAGE 已同步。

本地仅执行静态和构建：根 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check` 与 `git diff --check` 均通过，日志 `/tmp/nexus-e2e-repair2-final-{check,build,format}.log`。尚待处理记忆审核迁移、挂起目录竞争、桌面剪贴板与窄屏溢出，不宣称全量 E2E 已通过，不纳入并行 UI 变更。

## 远程 Actions 修复首批（2026-10-22，不改 UI）

失败基线为 [39789022254](https://github.com/0honus0/nexus-terminal/actions/runs/39789022254)，被测 SHA `7151fca95bf9951b3739f8674e19e37bbde14672`。8 个分片均有失败；最长分片的 24 个原生 Agent 场景首先卡在已移除的原生模型 select，末尾上传场景被 15 分钟整组期限中断，不能据此判定上传本身失败。当前尚无新的远程通过证据。

首批只修改测试：模型列表通过真实 listbox/option 选择唯一供应商并验证选中态；共用 Hub 打开入口支持已打开窗口；SSH 目标使用真实 checkbox；安全设置定位完整 UiSettingsGroup 而非标题容器；偏好保存后验证 dirty 清零、日志使用统一保存入口，失败恢复走全局 Reload settings Toast；SSH 资源缓存按首轮 checkedAt（采样完成）起算等待下一轮，保留真实新采样和持久化断言。已核对 USAGE 的模型选择、设置保存/Toast 与资源缓存说明，无产品行为变更。

本地按 D17 不运行行为测试、浏览器或 E2E。根 `pnpm run check` 与 `pnpm run build` 通过，日志 `/tmp/nexus-e2e-repair-check.log`、`/tmp/nexus-e2e-repair-build.log`；构建保留既有大 chunk 提示。全量格式首次发现本轮测试排版，修正后 `pnpm run format:all:check` 与 `git diff --check` 通过，日志 `/tmp/nexus-e2e-repair-format-final.log`；按 D18 分批提交推送后继续修复其余失败，不提交并行 UI 或设计产物。

## 两轮逻辑修复提交收口（2026-10-22）

用户最新授权“修改提交”，本次仅提交下方两轮逻辑修复和对应 PLAN/USAGE/验证记录；并行 UI 代码、UI 验证记录及未跟踪设计产物保留在工作区，不代为提交。最近的根 check、build、全量格式检查结果见下方本轮证据；提交前追加核对暂存文件、格式及 diff，不运行行为测试或 E2E，不推送、部署或重启。

## 文件编辑与搜索链路续审（2026-10-22，不改 UI）

基于 `dev`、`f9e11e03` 和上一轮未提交逻辑修复继续核对；保留并行 UI 改动，不修改组件、模板、样式或布局。本轮按源码确认并修复以下问题，未运行行为复现：

- `editorEncoding.ts` 对大于 256 KiB 的内容拼接头/中/尾字节样本，再按 UTF-8 校验；切片可能从中文或表情的多字节序列中间开始/结束，导致合法 UTF-8 误入其他编码检测，也可能漏掉未采样区域的非法字节。现 UTF-8 校验消费完整连续原文，包含 NUL 的内容仍进入既有检测，其他编码继续沿用有界样本及 BOM 优先级。
- `file-search.ts` 只跳过子目录 not_found；SFTP 的 permission_denied 经 `SftpFileResource.translate` 转成 forbidden 后，会令整次递归搜索失败。现对子目录 forbidden 同样跳过并标记 truncated；根目录失败、容量/连接/取消及未知错误仍传播，保留全部在途 scan 的 finally 等待，不减少授权检查。
- 文件 Adapter 在请求返回后因代际失效抛出 FilesystemFailure(not_connected)，又被自身通用 catch 包成 protocol_error。现普通读取和二进制读取保留已归一的 FilesystemFailure，仍拒绝旧结果；真正的 WS 拒绝、解码失败与未知写入仍保留原分类。

消费者复核范围：文件编辑器检测/解码 → DocumentPort → 编辑器 open/reload/changeEncoding；RemoteFileService.search → searchFiles → FileResource.scan/SFTP 错误转换 → Workspace 搜索投影；Workspace 读取 → assertCurrent → 目录缓存、编辑器/预览及 filesystemFailureMessage。没有新增 Shared 字段、资源 owner 或架构边界；核对 Frontend/Backend 既有文件生命周期设计仍适用。

按 D17 未新增或运行行为测试、浏览器或 E2E。待远程覆盖：超过样本窗口的连续中文/表情与混合文本、未采样区非法 UTF-8、UTF-16/BOM 与传统编码；无权限/被删除子目录和可读兄弟目录并存、根目录无权限、扫描容量/取消；普通及二进制读取等待期间断线/代际替换、畸形响应仍拒绝。未提交、推送、部署或重启。

本轮实际执行 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check` 均退出 0，日志分别为 `/tmp/nexus-files-review-check.log`、`/tmp/nexus-files-review-build.log`、`/tmp/nexus-files-review-format.log`；构建仍有既有大 chunk 提示。环境为 Node v22.23.1、pnpm 11.26.0；`git diff --check` 通过，没有暂存变更。检查覆盖当前完整工作区，但本轮不修改或代为提交并行 UI 文件；静态通过不表示本轮行为场景或 E2E 已通过。

## 功能逻辑续审（2026-10-22，不改 UI）

基于 `f9e11e03` 继续核对文件会话/缓存、挂起 WS/HTTP 和日志、文件库下载及资源采样；本轮不修改模板、样式、UI 布局或并行设计代码。

- Workspace 文件 Adapter 的 `filesystem.error` 原来只更新可用状态，不推进代际；旧只读请求的异步返回只核对 generation，因此在错误后乃至再次 ready 后仍可能交付。现错误事件推进代际，失效旧读取，保留写入回执/未知语义。
- ResourceStatus 两个 worker 同时失败时原来一律聚合为 remote_unavailable；注销/到期同时导致两个 unauthenticated 时，HTTP 错误从 401 变成 503。现所有子失败为同一具名 ObservationFailure 时保留原 code，并保留全部 cause；混合故障仍安全兜底，清理失败仍优先处理。
- 日志下载直接把 Content-Length 与 Fetch 解码后的正文比较，文件库还强制存在该头；代理压缩保留压缩长度、或合法 chunked 响应省略长度时会误拒绝。现分别按传输编码核对长度，始终保留实际正文上限、文件库 ID/版本/字节数/SHA-256、日志媒体类型/文件名及流清理。

源码复核覆盖 filesystem.error/ready/close → request/assertCurrent → 目录/预览/编辑器消费者，以及采样 worker → Service 聚合 → resource-status HTTP 状态映射；下载沿通用有界 Binary/Response reader 与独立日志 reader 核对，不增加自动重试。待远程回归：读取未返回时失败再恢复、并行注销/权限/容量失败与混合清理错误、gzip/br 日志及文件库下载、无 Content-Length 完整文件、截断/超量/错误 hash 拒绝。按 D17 不新增或运行本地行为测试、浏览器或 E2E；不提交、推送、部署或重启。

本轮重新执行 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check`，均退出 0；日志分别为 `/tmp/nexus-logic-followup-check.log`、`/tmp/nexus-logic-followup-build.log`、`/tmp/nexus-logic-followup-format.log`。构建仍有既有大 chunk 提示；`git diff --check` 通过。本轮没有暂存或提交变更，保留并行 UI 修改及未跟踪产物。以上仅为源码和静态验证，不代表待远程场景或 E2E 已通过。

## 累计配额修复续审与提交（2026-10-22）

用户授权修复后提交。复查 stage 回收与引用/退役 CAS、同包复用的内容和身份复核、插件墓碑/历史回执退役、有效容量与备份注册、完整历史后缀及首轮模型预算；保留未知状态、不可变版本和防重放证据。追加修复历史读取成本：先物化最近有限候选，再做步骤/工具及正文体积关联聚合，不再让全部旧对话参与候选统计；完整对话仍持久保留。

上一节所述并行 `StatusMonitor.vue` 阻断已由原修改更新，不覆盖或提交该 UI 文件。本轮重新运行静态检查，不复用先前 PASS；D17 下不运行行为测试、浏览器或 E2E，不推送、重启或部署。跨阈值循环、故障注入、跨设备注销、长对话供应商请求及备份恢复仍待远程验收。

本轮 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check` 均退出 0，日志分别为 `/tmp/nexus-quota-followup-check.log`、`/tmp/nexus-quota-followup-build.log`、`/tmp/nexus-quota-followup-format.log`；构建仍有既有大 chunk 提示。`git diff --check` 与两份既有集成脚本的 `node --check` 通过。暂存范围排除并行工作区/状态监控等 UI 调整及其文档、临时文件和设计产物；这些检查不代表行为/E2E 已通过。

另将暂存内容导出到 `/tmp/nexus-quota-index.XidjQG` 核对独立交付：双端 ESLint 通过，随后 pnpm 因复用的 `node_modules` 为符号链接拒绝任务状态目录，未将该命令记为通过（`/tmp/nexus-quota-index-check.log`）。改为在该快照直接执行既有 `vue-tsc --noEmit`、`tsc --noEmit`，两端均退出 0（`/tmp/nexus-quota-index-types.log`），不依赖未暂存 UI 的新增导出。

## 累计配额及四项缺陷修复（2026-10-22，源码收口／全量静态受并行 UI 阻断）

沿上一轮四项P2修复真实owner，不改模板/样式，保留并行UI变更。相同签名包复用原stage并复核Blob/hash/信任，退役绑定ID/version不变；无引用stage新建前回收旧缓存，保护versions/retirements/未知staging，删除失败保留failed及原因；同版本同hash核验不进入升级；在途主机采样按登录隔离，成功缓存仍共享且逐等待者认证。

追加盘点及源码修复：正常closed诊断按App保留128项，未知/曾未知证据不裁剪；数据按有效键/8MiB准入、每键最新有效回执保留正文，旧回执保留身份并返回version_conflict；取消32次迁移/清除与4096次Thread命令终身限制；Memory/Publisher/Intent/机器恢复claim只计有效状态，Intent失效正文压缩，released备份注册同样不计活跃额度；Memory/Artifact分页不受10,000历史偏移限制；插件集合以完整编码预算约束，versions名称列表与当前安装一对一。长对话按最近连续完整Run滑窗，首轮继续按编码/Provider预算移除旧完整消息与来源，随后锁定来源并保留逐步连续性校验。历史窗口不删除持久对话，不伪造摘要或授权。

已静态同步既有 `backend-next-plugin-owner-faults.integration.mjs`（4095历史种子后循环保留并继续构造）及 `backend-next-plugins.integration.mjs`（当前回执幂等、过时回执拒绝）断言；按D17不新增或运行行为测试、浏览器或E2E。跨256次选包/4096次写入、跨设备注销、清理/提交失败、自然过期、长对话模型窗口及备份恢复整链仍待远程验收。本轮不提交、推送或重启。

本轮真实静态结果（不继承历史PASS）：

| 检查                | 结果与证据                                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared/Backend 构建 | 最新 `pnpm run build` 的前两段成功，随后 Frontend 类型失败；日志 `/tmp/nexus-quota-build.log`。                                                                                                                                                                                                 |
| 根检查              | 首轮退出0（`/tmp/nexus-quota-check.log`）；并行 UI 改动后末轮退出1（`/tmp/nexus-quota-check-final.log`），双端 ESLint 通过，Frontend vue-tsc 在 StatusMonitor.vue 报15项 TS2339（模板中 controller/chartColors.value）及1项 TS2322（nullable metric）。没有改动该文件，不报告当前全量类型通过。 |
| 全量格式            | 首轮通过；末轮 `pnpm run format:all:check` 退出1，仅报告并行 StatusMonitor.vue 的Prettier问题，日志 `/tmp/nexus-quota-format.log`。                                                                                                                                                             |
| 本轮目标检查        | Backend/Shared/两处插件前端逻辑、六份相关文档及两份既有脚本的目标Prettier检查、`git diff --check` 和两份 `node --check` 通过；未运行脚本行为。                                                                                                                                                  |

上述全量阻断须待原 owner 完成并行 UI 修改后重跑；本轮没有覆盖、回滚或代修该 UI。静态检查不证明本轮新增循环、并发与故障恢复路径已通过实机回归。

## 前后端三轮源码复审（2026-10-22）

本节保留上一轮审查当时的发现与证据，当前四项修复见上一节，不能把原发现当作仍未修复的现状。范围为 `7151fca9` 与当时未提交清理；工作区还存在并行 UI 调整，本轮保留，不修改功能代码、UI、USAGE 或契约。第一轮核对 Agent 仓库/候选/安装/退役和删除残留；第二轮核对挂起 WS/HTTP、身份撤销及共享状态采样；第三轮核对桌面签发、票据消费、TCP/TLS/WS 与前端 SDK 收尾，并反查前两轮疑点。以下为沿源码确认的缺陷，未运行行为复现：

- **P2：准备升级后离开页面，无法用重新选包直接完成原升级。** `use-plugin-management.ts:44` 在工具页停用时清空 candidate；重新选包经 `plugin-service.ts:812` 生成新 stage UUID。`plugin-sql.ts:820`（以及 install 的 707）要求与原 retirement 的 stage ID/version 完全相同，因此哪怕同一包，完成升级仍冲突。原 stage 读取后端保留，但正式前端已无恢复入口。触发：准备升级成功 → 切设置分组/刷新/取消候选 → 重新选择原版本 → 完成升级。无数据迁移时可取消退役后重新开始，不能把这当作直接续接成功。修复应从权威 retirement 恢复原候选，不放宽 stage CAS 或恢复旧维护 UI。
- **P2：有效操作会永久耗尽 stage 配额。** `plugin-service.ts:812` 每次从仓库下载/重新核验都创建新 stage；`plugin-sql.ts:1065` 统计用户全部 stage，含 installed/failed，而服务在总数256时拒绝。候选取消只清前端 ref；现有 stage owner 无删除/过期/相同包复用流程。连续选包后取消、核验同一包或正常升级均累积记录及包文件，最终无法再安装/升级，重启不清除。USAGE 588 确有256项容量约束，但不能为保留容量而遗漏回收。修复须保留实际版本、正在安装/退役及未知结果引用，只回收确定无引用项或复用安全等价候选，不简单移除容量。
- **P2：已安装同版本的“重新核验”仍开放必失败的升级动作。** `PluginRepositorySettings.vue:170` 对同版本提供重新核验；候选区只要有安装实例，就给出准备升级。`use-plugin-management.ts:158` 不区分同版本，调用 prepare-upgrade；后端 `plugin-service.ts:572` 明确拒绝 replacement 与当前版本相同，必然 version_conflict。修复应把相同版本/相同包的核验与真正升级分开，不把成功核验接入必失败写入，也不放宽后端不可变版本约束。
- **P2：共享主机采样继承首个请求的登录，另一设备会被连带拒绝。** `resource-status-service.ts:164` 用首个 token 创建采样，160行按目标 fingerprint 把同主机其它会话加入同一 Promise；`observation-service.ts:344` 在采样过程继续复查这个 token。若设备 A 发起采样、设备 B 加入等待后 A 登出/到期，采样抛 unauthenticated；`resource-status-service.ts:133` 继续向 B 传播，B 自己的登录有效也收不到本轮结果。这不是未授权数据泄露，但破坏多登录隔离。修复可按会话区分在途采样，或由明确共享授权 owner 承担采样并逐等待者验证；不能去掉身份复查。

挂起目录初始快照/修订、事件变化时拒绝旧读、写入未知围栏、可见性停流/重连、服务端事件身份复查，以及桌面票据一次消费/目标版本/晚收尾已逐链核对，本轮未确认其它具体缺陷。SDK pending connect 无取消 API、目标证书不验证等现有限制已有专题文档，不另冒充新缺陷，也不据此宣称长时/故障行为通过。

`pnpm run check`、`pnpm run build` 均退出 0，日志 `/tmp/nexus-audit-rounds-check.log`、`/tmp/nexus-audit-rounds-build.log`；构建仍有既有大 chunk 提示。`pnpm run format:all:check` 退出 0，日志 `/tmp/nexus-audit-rounds-format.log`；`git diff --check` 通过。遵守 D17，未新增/运行本地行为测试、浏览器或 E2E；没有提交、推送、部署或重启。本轮结论是审查发现，不是修复或真实回归通过。

## 已删除前端功能残留清理（2026-10-22）

基于 `7151fca9` 清理前端死链：旧插件维护面板的暂存列表/手工核验/运行观测确认、手动创建 App、孤立仪表盘卡片与系统边界卡片/选择工具、旧工作区追加工具/描述与终端通道抽象，以及对应三语失效文案。仓库候选安装/升级、版本显示名称、实际插件 RPC、App 启停与未知写入围栏保留。后端接口与 Shared 无改动。

源码引用复核覆盖导入图、API/composable 调用、模板与动态翻译；静态 import 图无新孤立业务文件（只剩入口和环境声明），所有活跃 Vue 文件零修改，只删除两个无入口组件；已核对 USAGE「Plugin 与 MCP」，当前产品操作和恢复说明不变。设置加载不再请求无人展示的 `/plugins/stages`；服务端该接口保留。

本轮 `pnpm run check` 通过，日志 `/tmp/nexus-residue-check.log`；`pnpm run build:frontend` 退出 0，日志 `/tmp/nexus-residue-build.log`，仍有既有大 chunk 提示。首次全量格式检查发现新 PLAN 表格需对齐，修正后 `pnpm run format:all:check` 退出 0，日志 `/tmp/nexus-residue-format-final.log`；`git diff --check` 通过。三语各删除53个无消费者叶子键，保留文案值未改；静态引用与活跃 Vue/Backend/Shared 零改动检查通过。按 D17 未新增/运行本地行为、浏览器或 E2E，不宣称真实安装/升级/恢复回归通过。未提交、推送、部署或重启；保留未跟踪的临时和设计产物。

## 本地修改统一提交前检查（2026-10-22）

用户授权将全部本地功能修改提交并推送 `dev`。基于 `10ae19c5` 的完整工作区，`pnpm run check`、`pnpm run build`、`pnpm run format:all:check` 均退出 0，记录分别为 `/tmp/nexus-precommit-{check,build,format}.log`；构建仍有大 chunk 提示，不作为失败。最初尝试只收桌面相关修改时，隔离暂存快照发现已提交前端依赖未提交的 Agent `profiles` 删除契约，不能单独交付；最终按用户指令纳入完整前后端功能配套，不把不完整快照的类型失败记作整套源码通过。

Compose 与 `.env.example` 同步移除 guacd，增加宿主数据目录 `NEXUS_DATA_DIR`（默认 `./data`，容器内仍为 `/app/data`）。使用纯测试 key 的 `docker compose --env-file .env.example config --quiet` 通过；JSON 投影断言只有 frontend/backend 两个服务，自定义目录挂载到 `/app/data`。只校验配置，没有启动容器、重启后端或生成实际实例密钥。真实 `.env`、临时文件和未纳入产品的截图/设计稿不提交；本批不新增全量行为/E2E 通过声明。

## 指定站点 RDP 持续连接与生命周期补测（2026-10-22）

承接用户“继续测试”，按 PLAN D19 仅访问 `https://api.honus.top` 的正式 RDP 入口；复用上节相同的隔离本机 Chromium、内存 Cookie 和远端临时 `data:` 输入页。Backend 仍为 PID 1992285，启动时间 2026-10-22 12:24:32（Europe/London），未重启、修改保存凭据、执行远端命令或保存文件；没有运行全量 E2E 或并发压力。产品源码没有修改，本轮仅补充证据及文档。

| 场景           | 实际证据与结果                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分钟级持续连接 | 182,671 ms 观察，四次间隔约一分钟的真实键盘输入在远端 textarea 精确匹配；始终同一条活跃 WS。初次输入前等待远端桌面就绪，不把 SDK connected 等同远端应用已获得输入焦点。   |
| 票据一次性     | 重放本测试实例已消费的票据，WS 升级后以 1008 拒绝；原连接仍能输入且远端精确匹配。                                                                                         |
| 票据过期       | 新签一张未消费票据，等待 31.5 秒后尝试 WS，以 1008 拒绝；原活跃连接输入不受影响。没有输出票据或凭据。                                                                     |
| 受控断线与重连 | 仅关闭本测试实例的 WS（4000），正式 controller 清除 Canvas；点击“重新连接”获得不同票据及新 WS，远端输入匹配。此项不是物理断网、丢包或黑洞超时验证。                       |
| 建连中取消     | 两次串行打开，在真实 WS 创建且 UI 仍为“连接中...”时立即关闭；每次等待 5 秒后自有 WS 关闭、弹窗不回弹。随后新建连接并在远端确认输入，11 项补测断言全部通过。               |
| 页面刷新收敛   | 刷新前 `ss -tnpH` 确认该 Backend 到测试端口的 TCP 从基线 0 变为 1；刷新后 10 秒内归零，额外等待 2 秒仍为零且没有自动重开弹窗。                                            |
| 最终清理       | 两份最终脚本均无 pageerror，临时输入页关闭、残留数为 0，目标 TCP 已释放；未关闭用户原有页签。刷新会销毁页面观察器，不以 Playwright 遗留的 closed=false 推断实际资源泄漏。 |

命令与安全输出：`node /tmp/nexus-rdp-lifecycle-local.mjs` → `/tmp/nexus-rdp-lifecycle-local-final.log`，前 15 个生命周期断言通过，但第 16 个只依赖 Playwright WS close 事件的刷新断言为 false，脚本退出 1；因此不记录该整份脚本 PASS。独立的 `node /tmp/nexus-rdp-cancellation-local.mjs` → `/tmp/nexus-rdp-cancellation-local-final.log` 使用 Backend 实际 TCP 作为刷新收敛判据，11 个断言全部 true，退出 0，补证上述观察器缺口。两份脚本 `node --check` 通过。

早期诊断 `/tmp/nexus-rdp-lifecycle-local.log` 的首次输入发生在远端桌面未就绪时，且重连定位错误使用“重连”而非实际“重新连接”，退出 1；最终生命周期脚本修正测试准备和定位后，持续输入及重连均通过，不将工具准备失败记作产品修复。分钟级有输入连接不证明小时级或空闲稳定性；VNC、真机、多平台、16 路并发、物理网络故障、身份撤销、强制晚成功及清理失败注入仍未覆盖。

## 指定站点真实 RDP 交互补测（2026-10-22）

用户继续授权“测试别的功能”，并明确允许使用临时文本覆盖本机和远端剪贴板。按 PLAN D19，仅通过 `https://api.honus.top` 的正式桌面入口验证已提供目标；没有运行远端 shell、保存文件、改写连接凭据、重启 Backend、提交、推送或执行全量 E2E。本轮没有修改产品代码，USAGE/专题架构与当前实施状态同步刷新。

环境为 `dev`、HEAD `8742ac29` 的未提交工作区，Node v22.23.1、Playwright 1.63.0、本机 Linux headless Chrome for Testing 153.0.8010.12；登录 Cookie 仅经现有浏览器 CDP 在内存传入隔离浏览器上下文，不输出或写入脚本。真实目标 Windows 上新建独立的内存 `data:` 输入页，RDP 负责实际输入，远端 CDP 仅初始化测试页、读取文本/鼠标证据及最后关闭测试页；不通过 CDP 代写待核对的文本或模拟远端成功。前端仍使用正式 Modal/controller/Adapter，临时页只隔离 Vite HMR 更新，不模拟 API/WS/RDP。

| 场景               | 实际证据与结果                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面原生键盘       | Playwright 原生 keyboard.type 输入临时英文数字标记，远端测试 textarea 精确匹配；Ctrl+A/C、方向键、Home/End、退格，以及先释放 Ctrl 再释放字符键后的编辑结果均匹配。                                                                          |
| 双向纯文本剪贴板   | 远端 Ctrl+C 后本机读取精确匹配；本机写入临时中英文文本、正式焦点同步、远端 Ctrl+V 后，远端 textarea 精确匹配。两侧为不同机器，不能用同一系统剪贴板的自读自写冒充传输。                                                                      |
| 中文提交与失焦释放 | compositionstart/未提交 beforeinput/compositionend/紧随相同 beforeinput 后，远端“中文输入测试”仅出现一次；按住 Ctrl 时本机输入框失焦再恢复，后续输入仍精确匹配，没有粘住修饰键。                                                            |
| 剪贴板权限拒绝     | 仅在隔离上下文把 clipboard-read 设为 denied，实际 readText 拒绝为 NotAllowedError；焦点同步后连接仍为 connected，后续原生键盘输入在远端精确匹配。上述桌面脚本共 8 项布尔断言全部 true，任一 false 会令脚本失败。                            |
| 最小化/恢复        | 实际按钮最小化后对话框不可见、50×50 恢复按钮可达；恢复后仍 connected，同一个 WS 未关闭或重建。                                                                                                                                              |
| 浏览器全屏/退出    | 实际全屏按钮令 document.fullscreenElement 存在、远端 Canvas 为 1440×1000；退出后回到已连接窗口，两次切换均保留原 WS。                                                                                                                       |
| 手机模拟输入       | Chromium 移动仿真 390×844，文档 scrollWidth=390、Canvas 356×547；键盘按钮可聚焦真实移动 textarea。insertText 标记及中文 composition 提交均由远端独立 textarea 精确核对，中文 6 字符仅一次，本机隐藏输入框及时清空；远端 Ctrl+C 回读也匹配。 |
| 直触               | 原生 CDP touchStart/touchEnd 的 isTrusted=true；点按、长按右键在远端输入页分别收到 button 0 和 button 2 的 down/up，右键产生真实 contextmenu，坐标与客户端映射对应。                                                                        |
| 触控板与模式切换   | 单指移动在远端由 (40,73) 移到 (60,88)，双指点按收到右键 down/up/contextmenu，双指滑动收到远端 wheel；双击开始拖动后切模式，客户端 down/up 成对收口。                                                                                        |
| 清理               | 桌面、窗口和手机脚本最终均观察到各自 WS 关闭，pageErrors 为空；本机 `ss -tnp` 无目标 13389 端口连接，远端残留测试页计数为 0。未关闭用户原有页签或保存测试内容；远端剪贴板允许保留临时文本，不承诺还原原富文本格式。                         |

最终命令和安全输出：`node /tmp/nexus-rdp-desktop-input-local.mjs` → `/tmp/nexus-rdp-desktop-input-local.log`，`node /tmp/nexus-rdp-windows-local.mjs` → `/tmp/nexus-rdp-windows-local.log`，`node /tmp/nexus-rdp-mobile-local.mjs` → `/tmp/nexus-rdp-mobile-remote-input.log`；三份脚本的 `node --check` 通过。准备阶段依赖既有桌面焦点的输入核对曾为 false、较早的混合交互脚本曾等待超时，不能据此报告产品通过或失败；隔离远端测试输入页后，最终按真实远端值与事件复核全部匹配。初期移动诊断保留在 `/tmp/nexus-rdp-mobile-{local,debug,focused,scratch}.log`，最终证据不沿用它们的结果。

范围限制：中文测试覆盖 composition 事件处理及去重，不等于已操作每一种系统输入法；手机为 Chromium 移动/触控仿真，不是 iOS/Android 真机软键盘。Win+R 等其它系统组合键、原生真机、多平台、VNC、长时间/并发压力及网络/清理故障仍待验。本轮未发现需要修改的业务代码，不把本轮检查等同全量 E2E。

## 指定站点真实 RDP 验证（2026-10-22，基础链路通过）

用户授权仅通过 `https://api.honus.top` 使用所提供目标验证真实 RDP，按 PLAN D19 执行；目标凭据不记录。工作区为 `dev`、HEAD `8742ac29` 及未提交修改。用户已重启 Backend：PID `1992285`，本机 Europe/London 时间 12:24:32 启动，晚于当前 `dist/main.js` 的 12:22:26 构建时间。本轮未自行重启、部署、提交或推送，未运行全量 E2E；仅刷新文档，无产品行为、职责或类型变更。

使用现有已登录 Chrome `155.0.8059.85` 的 CDP，经站点 HTTPS 调用正式 `remoteDesktopApi` 和 `createBrowserDesktop`；使用目标已保存凭据，不新增连接或改写密码。先从实际 Dashboard 卡片打开原桌面弹窗，观察到“已连接”及非黑画面。随后用独立临时页验证正式 Adapter 生命周期，临时页仅屏蔽 Vite HMR 的 update/full-reload，防止并行开发热更新中断验收；没有模拟 HTTP、WS、RDP 数据或状态，没有禁用生产超时/容量限制。

| 场景                 | 实际证据与结果                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式签票与秘密边界   | 两次 POST 均 200；成功字段精确为 host/password/port/protocol/ticket/username，目标关联匹配，Cache-Control 为 no-store、Pragma 为 no-cache。只记录字段名及布尔值，不记录字段秘密正文。                                           |
| 认证与真实画面       | 首次 SDK 状态 connected；Canvas 1024×768，749,980 个非黑像素、3,174 种颜色；真实 WS 收到 453 帧、2,970,891 bytes。不是仅凭 TCP/TLS 桥就绪判断成功。                                                                             |
| 鼠标移动与动态分辨率 | 发送无点击鼠标移动，再 resize 至 1100×800；等待 12 秒后 Canvas 为 1100×800，840,439 个非黑像素，原 WS 仍打开，Adapter failures 为空。仅证明输入派发及画面持续更新，不宣称已独立核对远端指针位置。                               |
| 显式关闭             | 调用正式 peer.close，3 秒后观察到原 WS close（浏览器 code 1005，未携带关闭码），没有 Adapter failure。                                                                                                                          |
| 新票据重连           | 再次通过正式 API 签票，与前票据不同；第二次 connected，Canvas 1024×768，749,965 个非黑像素，收到 393 帧、2,526,944 bytes；没有 Adapter failure。                                                                                |
| 最终清理             | 第二次 peer.close 后观察到 WS close；临时测试页均已关闭，`ss -tnp` 无目标 13389 端口连接，Backend 原 PID 未改变。未发送文字/按键、未主动读写剪贴板或运行远端命令；正常 RDP 登录、显示尺寸及最近连接时间属于本次连接的预期效果。 |

可复核命令：`node --check /tmp/nexus-real-rdp-check.mjs`、`node /tmp/nexus-real-rdp-check.mjs`；安全投影输出在 `/tmp/nexus-real-rdp-check.log`。临时脚本不包含密码或票据常量；运行时凭据仅由正式 API 交给原 SDK 内存实例。此次用原生 CDP WebSocket 新建临时目标成功；此前 Playwright 全浏览器附加超时仅保留为当时工具准备结果，不再是当前连接阻断。

结论仅限指定真实目标的基本 RDP 认证/画面、短时连接、动态尺寸、关闭与新票据重连。VNC、键盘/IME/软键盘、剪贴板、触控、完整全屏恢复、多平台、长时间稳定性、16 路并发、故障收敛、跨设备挂起及全量 E2E 仍待验；不继承旧 Guacamole 的 PASS，不将本轮限定实机验证称为全量回归通过。

## 挂起目录 WS 与浏览器 RDP/VNC 迁移（2026-10-22，静态收口）

环境为本地 `dev`、HEAD `8742ac29b20561df88d556cc87cb411d410a493d` 的未提交工作区，保留其它修改；Node `/usr/local/bin/node` v22.23.1、pnpm `/usr/local/bin/pnpm` 11.26.0。按 PLAN D17 没有运行本地业务测试、浏览器、E2E 或测试收集，没有提交、推送、部署或触发远程任务。

源码审核覆盖 App 登录订阅 → 挂起目录 store/stream → 独立 `/ws/suspended-sessions` → WorkspaceService 变化发布，以及 Dashboard 路由停用/恢复的采样取消。既有 Dashboard/mobile/集成断言已改为观察真实 WS 快照、跨客户端改名和离页不再请求 status；HTTP 管理及显式恢复仍保留。快照不解除写入未知围栏，旧 HTTP/WS 不能覆盖新状态。Dashboard 虚拟时钟只用于采样生命周期断言，不作为目录流真实心跳/重连的证据。

桌面审核覆盖 Shared 六字段会话和 64 KiB 编码预算、HTTP no-store、协议关联、同步 WS bind、票据/目标/身份复查、RDCleanPath/X224/TLS、权威目标地址、二进制流控、socket/send/初始化真实关闭与 SDK 晚连接收尾。删除 guacd 依赖/补丁/Compose/环境配置，删除 RemoteApp 表单、三语文案、Shared/Targets/存储/快照字段和 SQL 列；同步更新 application/targets 唯一 v1 签名，明确不兼容旧开发库/快照。生产源码与锁文件无旧厂商/RemoteApp 消费者；测试保留旧字段拒绝/无控件断言及原文件名，smoke 保留禁止 guacd 服务断言。

原桌面测试夹具已迁移为真实 TigerVNC/xrdp/xterm/vncconfig/xclip；正式浏览器 Adapter 负责画面/键鼠，control 只读取真实 X selection、终端文本与指针。既有 E2E 保留窗口、剪贴板、触控、软键盘、票据与权限断言；单独 raw WS 只验证真实 RDCleanPath/TLS 握手，不把它当作图像或远端认证证据。runner 安装真实桌面工具并参与缓存指纹，端口统一由 runner 分配，不再依赖 MockGuacd。

静态检查：根 `pnpm run check`（双端 ESLint/类型、Shared build）、`pnpm run build`（Shared/Backend/Frontend）、`pnpm run format:all:check` 和 `git diff --check` 通过。日志为 `/tmp/nexus-browser-desktop-final-{check,build,format-check,diff}.log`；修改后既有 mjs/cjs 与新夹具的 `node --check`、smoke 的 `bash -n` 通过，记录于 `/tmp/nexus-browser-desktop-syntax.log`。五个受影响桌面/Dashboard/mobile E2E 入口以 `tsc --noEmit --target ES2022 --module esnext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node --typeRoots ../../packages/frontend/node_modules/@types` 单独编译通过，日志为 `/tmp/nexus-browser-desktop-e2e-types.log`；初次缺少 Node types 的命令失败后显式引用已有类型，未新增依赖或放宽检查。其它已修改 E2E TS 通过 transpileModule 语法核对，未执行或收集测试。

Frontend 构建有大 chunk 提醒：按需加载的 IronRDP JS/WASM chunk 约 6.07 MB，gzip 约 2.26 MB；未调整警告阈值。移除 guacd 减少后端服务/解码负担，但前端增加 WASM 下载，不将其表述为所有维度都变小。RDP 当前仍忽略目标证书校验；SDK 不提供 pending-connect 取消，保留晚成功 shutdown/run/free owner，限制已进入产品及专题文档。

行为仍远程待验：跨设备挂起/接管/租约/断线与未知结果、首页离页/返回、双协议真实画面/剪贴板/IME/软键盘/触控/全屏、16 路与第 17 路准入、权限/目标变化、弱网与清理故障，以及 Windows/Linux 远端和不同客户端平台。新夹具本身也尚未行为执行；旧 Guacamole/B10/Windows PASS 仅属于旧实现，不作为本版验收。

## 插件市场刷新仓库并入标题行（2026-10-22，本地 CDP）

使用 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入“App 与扩展 → 插件市场”，未点击刷新或修改仓库配置。修复后请求视口 1152×900（实际 CSS 视口 `914×900`）下，仓库标题行高 `38px`，“刷新仓库”与标题及“添加仓库”同行，按钮为 `105×38px`。390×844 下仓库标题和 URL 输入分行，刷新按钮与添加按钮同排，分别为 `105×38px` 与 `82×38px`；320×700 下刷新按钮收起文字为 `45×38px` 图标按钮，仍与添加按钮同排，不再独占一行。三档页面均无横向溢出，控制台无异常。

目标 Vue ESLint／Prettier、根 `pnpm run check`、Frontend build 与 `git diff --check` 通过。全量 `format:all:check` 仍被并行工作区既有格式告警阻断，本批未修改这些文件。证据：`/tmp/plugin-market-refresh-1152.png`、`/tmp/plugin-market-refresh-390.png`、`/tmp/plugin-market-refresh-320.png`。按 D17 未运行 E2E，未触发真实仓库刷新。

## App 安全策略配置展开布局（2026-10-22，本地 CDP）

使用 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入“App 与扩展 → Agent App”，展开“安全策略配置”。现为单一授权面板、分类浅分隔和独立能力卡片；请求视口 1152×900（实际 CSS 视口 `914×900`）下授权面板 `790×1478px`、能力卡 `366×68px`、卡片间距约 `10px`；390×844 下能力卡宽 `246px`、320×700 下宽 `185px`，均为单列且无横向溢出。

临时勾选“读取文件”后，计数由 `0 / 19` 更新为 `1 / 19`，授权高亮和保存按钮可用状态同步出现；能力项内不再出现 SSH 目标范围选择器。截图后已刷新页面丢弃草稿，未保存授权。三档页面均无横向溢出，控制台无异常。证据：`/tmp/app-security-policy-1152.png`、`/tmp/app-security-policy-390.png`、`/tmp/app-security-policy-320.png`、`/tmp/app-security-policy-selected-1152.png`、`/tmp/app-security-policy-selected-390.png`、`/tmp/app-security-policy-selected-320.png`。

目标 Vue ESLint／Prettier、根 `pnpm run check`、Frontend build 与 `git diff --check` 通过。全量 `format:all:check` 被并行工作区 `main.ts`、`remote/register.ts`、`connection-sql.ts` 与 Shared `connections/values.ts` 的既有格式告警阻断，本批未修改这些文件。按 D17 未运行 E2E。

## Provider 标题统计与操作窄屏避让（2026-10-22，本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入“模型与预算”，未改写 Provider 数据。修复后 `390×844` 下标题行为 `344×63px`，标题、计数徽标、信息提示与“添加 Provider”保持同一行且矩形不相交；`360×800` 与 `320×700` 下标题行自动增高为 `314×99px`、`274×99px`，操作按钮换到下一行并右对齐，统计徽标、提示与按钮均不重叠。各档页面均为 `scrollWidth=clientWidth`，控制台无异常。

目标 Vue ESLint／Prettier、根 `pnpm run check`、Frontend build 与 `git diff --check` 通过；全量 `format:all:check` 被并行工作区的既有格式告警阻断，本批未修改这些文件。证据：`/tmp/provider-header-after-390.png`、`/tmp/provider-header-after-320.png`、`/tmp/provider-header-width-360.png`。按 D17 只验证响应式布局，未打开或保存 Provider 弹窗。

## Agent App 与扩展页签化（2026-10-22，本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入“App 与扩展”，依次切换 Agent App、MCP / ACP、插件市场、执行预算。桌面请求 1152×900（浏览器实际 CSS 视口 922×720）下外层工作区为单一容器，四个页签均显示完整；390×844 下窄屏隐藏页签图标后四项完整可见；320×700 下第四项在页签区域内滚动，页面级 `scrollWidth=clientWidth` 分别为 `922/922`、`390/390`、`320/320`。App 行、集成空态、插件仓库来源与预算字段均正常渲染，控制台无异常。

目标 Vue 与三语 JSON 已通过 Prettier、ESLint、根 `pnpm run check`、`pnpm --filter @nexus-terminal/frontend build` 和 `git diff --check`。按 D17 未运行 E2E，也未触发真实授权、插件安装、预算保存或未知写入恢复。证据：`/tmp/agent-extensions-final-1152-apps.png`、`/tmp/agent-extensions-final-1152-integrations.png`、`/tmp/agent-extensions-final-1152-market.png`、`/tmp/agent-extensions-final-1152-budget.png`，以及 `/tmp/agent-extensions-final-390-*.png`、`/tmp/agent-extensions-final-320-*.png`。

全量 `format:all:check` 被并行工作区 `tests/e2e/support/remote-desktop-websocket.cjs` 与 `test-desktop-server.mjs` 的既有 spacing 告警阻断，本批未修改这些文件。

## 全局 Toast 避开顶部导航（2026-10-22，本地 CDP）

使用本地 CDP（`https://api.honus.top`，未使用 9998）向 `shared-notifications` store 注入实际失败 Toast，未修改测试环境业务数据。桌面导航底部为 `60px`、Toast 顶部为 `72px`；390×844 下导航底部同为 `60px`、Toast 顶部同为 `72px`，间隔均为 `12px`。退出按钮与 Toast 的矩形相交检测均为 `false`，退出按钮中心仍命中 `/login` 链接；手机文档宽度保持 `390px`。临时从 DOM 移除 `.app-header` 并等待两帧后，Toast 宿主顶部回落到 `16px`，恢复导航后回到 `72px`。证据：`/tmp/toast-header-offset-desktop.png`、`/tmp/toast-header-offset-mobile.png`。

`NotificationHost` Vue、`uiGen2.css` Prettier 与 ESLint、`pnpm --filter @nexus-terminal/frontend build`、根 `pnpm run check` 与 `git diff --check` 通过。全量 `pnpm run format:all:check` 仍受并行工作区 `tests/e2e/specs/ui/dashboard-workflows.spec.ts` 的既有格式告警影响，未修改该文件。按 D17 未运行 E2E；通知计时、合并、操作与关闭逻辑未改，注入的通知已在核对后清理。

## Agent CDP 添加目标弹窗卡片优化（2026-10-22，本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）打开“执行与集成 → CDP → 添加目标”，未保存目标。桌面窗口下弹窗为 `560×364px`，内容宽 `510.4px`，保存与取消按钮分别为 `107.6×32px`、`88×32px`；390×844 下弹窗 `358×355.2px`，320×568 下 `288×355.2px`，两档 `scrollWidth=clientWidth`，无横向溢出，窄屏按钮均等宽且为 32px 高。图标标题、CDP 标记、小号字段标签和等宽 URL 编辑区均正常渲染。证据：`/tmp/cdp-target-modal-after.png`、`/tmp/cdp-target-modal-after-390.png`、`/tmp/cdp-target-modal-after-320.png`。

目标 Vue Prettier、ESLint、`pnpm --filter @nexus-terminal/frontend build`、根 `pnpm run check` 与 `git diff --check` 通过。全量 `pnpm run format:all:check` 仍受并行工作区 `tests/e2e/specs/ui/dashboard-workflows.spec.ts` 的既有格式告警影响，未修改该文件。按 D17 未执行真实保存、编辑回填、键盘焦点或 E2E；保存与取消继续使用原逻辑和统一基础按钮。

## Agent CDP 按钮统一（2026-10-22，本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入 Agent“执行与集成”的 CDP 区，未保存浏览器配置。1152×720 下，标题栏“添加目标”渲染为 `data-ui="button"`、`ui-button--soft`、neutral、38px；列表底部“添加目标”与 Endpoint“添加”使用同一基础按钮。打开“添加目标”后，弹窗“保存浏览器配置”为 solid/primary、“取消”为 soft/neutral，均为 32px；连接管理“添加连接”弹窗的确认／取消按钮同为 32px，结构和视觉已对齐。证据：`/tmp/agent-cdp-section.png`、`/tmp/agent-cdp-add-modal.png`。

全仓按钮组件盘点为 `UiButton`、`UiFormActions`、`UiActionGroup`；旧 `BaseButton.vue` 已在提交 `dd40d0be` 删除，`rg` 无源码或测试引用，因此本批无需再次删除旧文件，也未新建同义按钮组件。目标 Vue Prettier、ESLint、`pnpm --filter @nexus-terminal/shared build`、`pnpm --filter @nexus-terminal/frontend build`、根 `pnpm run check` 与 `git diff --check` 通过。全量 `pnpm run format:all:check` 仅被并行工作区的 `tests/e2e/specs/ui/dashboard-workflows.spec.ts` 格式告警阻断，未修改该文件。按 D17 未执行真实保存、窄屏或 E2E；Endpoint 编辑／删除和危险操作继续保留原有语义色。

## 全局禁用目标说明收进信息提示（2026-10-22，本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入“安全与系统”并定位“全局禁用目标”。修改后页面正文中“这是跨会话、跨 Run 的全局硬限制”命中为 0，标题旁 `[data-ui="info-hint"]` 仍存在；点击后提示面板同时包含“聊天框下方的 SSH 只决定某次 Run”和“被全局禁用的目标即使在聊天框中被选中……Host 强制阻断”两段说明。截图证据：`/tmp/agent-denylist-hint-only.png`。

三语 `scopeHint` 均删除且 JSON 解析通过；目标 Vue ESLint、Prettier、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 通过。CDP 未修改禁用草稿、原因或保存状态。按 D17 未运行本地业务测试、E2E 或测试收集；窄屏、键盘打开提示及真实保存仍随既有 Agent 安全回归覆盖。

## 全局 Toast 等宽卡片材质（2026-10-22，本地 CDP）

使用本地 CDP（`https://api.honus.top`，未使用 9998）在已登录页面直接向 `shared-notifications` store 注入短成功、长警告和带“重新读取”action 的失败通知，未触发真实保存或修改测试环境数据。桌面宿主和三条卡片均为 340px 宽，高度分别为 56/56/106px，`scrollWidth=clientWidth=338`；390×844 下卡片左右边界统一为 12/378px、宽 366px，高度 56/56/102px；320×700 下边界为 12/308px、宽 296px，高度 56/65/102px。三档文档宽度均等于视口宽度，短消息不再收缩，长文案与 action 只增加高度。

卡片计算材质为细边框、`15px` 圆角、`color-mix(card-bg-color 95%, app-bg-color)` 底色、`inset 0 1px 0` 轻高光、低强度阴影和 2px 语义色侧线，与仪表盘连接卡片保持同一材质方向；状态仍由侧线、图标和语义色共同表达。通知计时、去重、错误驻留、`aria-live`、错误 `role=alert` 和 action 逻辑未改。证据：`/tmp/toast-equal-width-1152.png`、`/tmp/toast-equal-width-390.png`、`/tmp/toast-equal-width-320.png`。

目标 Vue/CSS Prettier、NotificationHost ESLint、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 通过。按 D17 未运行本地业务测试、E2E 或测试收集；真实保存/测试动作产生的 Toast、键盘焦点、减少动态效果和成功/警告/信息三种独立状态仍随既有远程回归覆盖。

## 对话右侧记忆审核（2026-10-22）

当前对话 Root/Child 的来源记忆由后端按 threadId 在分页前筛选，同事务校验当前用户/App 的线程归属；无来源候选不进入对话审核。对话独立 owner 每3秒读取一页50条，新候选展开原风格右侧栏，关闭不拒绝/发布，顶部按钮可重新打开；任务详情与记忆栏互斥，窄屏沿用浮层。只有人工点击保存才发布，拒绝和过期候选不进入 Recall。背景读取不置 busy，交互取代旧读取；未知/冲突保留原记录，显式核对原 memoryId 后再读列表，自动轮询不解除写入围栏或重发审核。读取失败保留卡片、停止轮询并提供恢复，active/KeepAlive/身份/文档可见性/卸载负责停止观察。

扩展既有 `coverage-gaps.spec.ts` 的 Memory 生命周期断言：有真实线程但无来源的候选不会误入；缺失线程404，非法/重复 threadId 400。未新建业务测试，按 D17 未运行本地测试、浏览器、E2E 或测试收集。源码复核 Root/Child 共用 thread_id、分页前隔离、只读/写入晚结果、原版本 CAS、失效原文与统一 Toast；静态证据与真实交互验收分别记录。

根 `pnpm run check`、`pnpm run build`（Shared/Backend/Frontend）、Shared check、最终 Backend check/build、本轮目标源码及既有断言 ESLint/Prettier、`git diff --check` 通过。日志为 `/tmp/nexus-conversation-memory-{check,build}.log`、`/tmp/nexus-conversation-memory-shared-check.log`、`/tmp/nexus-conversation-memory-backend-final.log`、`/tmp/nexus-conversation-memory-target-{lint,format}.log`。复核期间执行设置的并行工作区修改曾造成五处类型错误，后续重跑根检查和构建已通过；保留当时日志 `/tmp/nexus-conversation-memory-check-concurrent.log`，未修改或回滚无关文件。全量格式检查仍受 `use-artifact-library.ts`、`use-execution-settings.ts`、`AgentSettingsPanel.vue`、`ExecutionSettings.vue` 的其它未提交改动告警影响，不能记为通过；实际日志 `/tmp/nexus-conversation-memory-format-check.log`，本轮文档单独复核格式。

真实模型提案、同 App 不同线程/用户隔离、多页和多窗口审核竞争、未知回执/重新核对、关闭重开、切换线程、后台恢复、桌面/窄屏与键盘可访问性留远程验收。没有提交、推送或部署。

## 移除 Agent 设置记忆管理（2026-10-22）

用户明确移除设置中的记忆管理模块。删除安全分组记忆卡片及专用 AppScopedSettings、AppMemoryEditor、use-app-memory、memory-management-api、memory-types/mapper 和三语 memoryManagement 文案；全仓引用核对未发现其它前端消费者。安全分组剩余协作限制与网络政策保持原布局。后端候选/审核/Recall、Shared 协议、持久数据与备份未修改，候选仍须人工发布；既有 coverage-gaps API E2E 继续验证原后端生命周期，不删除或跳过断言。前批针对已删除记忆 UI 的远程待验范围不再适用。

本地 `dev`、HEAD `013f07061fbde592f7a3e3b6e53e02da24389bc2`，保留其它未提交修改；根 `pnpm run check`、`pnpm --filter @nexus-terminal/frontend build`、`pnpm run format:all:check` 与 `git diff --check` 通过。日志为 `/tmp/nexus-remove-memory-{check,build}.log`；全量格式结果另记 `/tmp/nexus-remove-memory-format-check.log`。按 D17 未新增或运行本地业务测试、浏览器、E2E 或测试收集。真实设置页入口消失与其它分组交互仍待远程核对；不将编译通过解释为界面行为通过。未提交推送，也未删除用户记忆数据。

## 前后端架构偏移审核（2026-10-22）

基线为本地 `dev`、HEAD `013f07061fbde592f7a3e3b6e53e02da24389bc2` 及原有大量未提交修改；未回滚其它改动。本批沿 App/定义/插件管理、记忆列表/审核与后台资源采样的 API → Shared codec/mapper → 应用 owner → Model/技术能力 → 出口/消费者核对状态、拒绝、取消与收尾，并核对配置热更新安装链。补查 Backend 跨模块/Bootstrap 依赖、Adapter 反向引用、Service/Model SQL，以及 Frontend 跨 feature、runtime/client/foundation 的深层引用；这些静态搜索不替代完整功能审核，不声称已逐行审核全部工作区。

确认并修复：App 刷新在 busy 时静默丢失，插件变化后只读取 App 而遗漏定义目录；现由 use-app-management 合并排队读取，两份目录各自管理刷新，旧读失效后不回填。自动刷新不解除已存在或排队期间新产生的写入失败围栏，仍须原入口显式核对；不自动重试写入。App 目录、安全分组 App 选择及记忆审核接 active scope，停用同步清除选择/私有草稿并撤销旧回填。ResourceStatusService 仅缓存成功采样，失败结果不再等待最长一天的成功 TTL；共享在途、授权复查、取消与关闭归属保持不变。USAGE 与架构同步修正旧 TTL 起算和重启生效描述。不改布局、样式、导航或控件，仅补充必要 active 绑定。

本轮 Node `/usr/local/bin/node` v22.23.1、pnpm `/usr/local/bin/pnpm` 11.26.0：`pnpm run check`、`pnpm run build`（Shared/Backend/Frontend）、`pnpm run format:all:check` 和 `git diff --check` 通过，日志为 `/tmp/nexus-architecture-audit-{check,build,format-check}.log`。按 D17 未新增或运行本地业务测试、浏览器、E2E 或测试收集；没有提交、推送或触发远程任务。待远程核对：插件安装/升级/卸载与 App 读写交错、定义目录刷新、排队后的未知写入围栏、记忆编辑离开/返回及晚响应隔离、SSH 失败恢复/并发共享/TTL 热更新与停机清理。

## App 与扩展旧 UI 恢复（2026-10-22）

展示依据为 `75289ef9^` 正式设置页面，协议仍为当前 Shared/API。App 卡片恢复包版本、权限抽屉及卸载确认；插件安装/卸载共享普通管理 owner，独立策略区只读取自己的策略资源；集成恢复图标操作栏、添加/编辑、删除和目录弹窗；市场恢复标题栏刷新、URL 添加/标签、搜索与可折叠来源/地址复制。按用户最新要求仅保留默认/第三方仓库下载，删除本地包上传入口、弹窗、状态、编排及无人消费的前端暂存 API；维护页的无消费者上传预留显示也一并移除，不涉及普通文件/附件上传。数据源缺失的旧运行/审批统计不恢复，排空数据清理按新版真实契约呈现，差异见 USAGE。

同步既有 `preset-plugin.spec.ts`：来源 URL 复制按钮定位、已安装记录移到 App 卡片、真实包版本、启用 App 的卸载禁用、原权限按钮及无本地上传入口断言，保留后续高级维护与 SDK 链路；集成区域保持原可访问名称和 App 选择定位。按 D17 未新增或运行本地业务测试、浏览器、E2E 或测试收集。

本轮根 `pnpm run check`、`pnpm --filter @nexus-terminal/frontend build`、`pnpm run format:all:check`、目标源码/既有用例 ESLint 和 `git diff --check` 通过；还静态核对恢复组件的三语言字面文案引用。初次还原日志为 `/tmp/nexus-app-ui-{check,build,format}-final.log`；移除本地包上传后重新执行，日志为 `/tmp/nexus-repository-only-check.log`、`/tmp/nexus-repository-only-build.log` 和 `/tmp/nexus-repository-only-format-check.log`。这些检查不能证明像素与行为验收通过：真实桌面/窄屏/键盘焦点、三语言、剪贴板权限、仓库下载/验签、第三方市场信任、安装/升级、卸载排空/取消/数据删除、授权范围、集成启停/发现以及未知写入/离页竞态仍待远程。未提交、推送或部署，保留工作区其它改动。

## Subagent 继承主 Agent 与功能逻辑审核（2026-10-22）

执行设置的 Shared 请求/响应、持久 JSON、双端 Model/mapper 和管理接口删除独立 profiles；前端删除模型目录加载及独立配置表单，仅保留公共协调容量与继承说明。delegate 删除 maxRequests/durationSeconds，九个协作工具使用当前 v3 定义，删除 collaboration_profiles。Child 同事务复制 Root 模型与执行快照，继承绝对期限及模型请求上限，工具与主 Agent 一致但排除嵌套委派和 Root 专属 join/cancel；原权限/审批、目标缩窄、家族账本及未知结果围栏不变。复审修正 SQL CHECK/持久解码的旧32次上限，改为引用 Shared 最大请求容量；初始v1签名更新，不兼容旧开发库。

同步既有后端执行/协作/ACP/工具/浏览器夹具、存储集成、前端执行设置集成及 Agent Host/性能设置/插件 E2E。原独立模型用例改为继承说明、无独立模型控件及 Provider 变更不改执行设置；协作用例核对继承工具、Root deadline 和持久请求上限。前端夹具使用当前共享 editor/分区组件，保留版本冲突、未知结果围栏、确认过期、身份撤销和晚读取隔离；Provider 读取失败不阻止公共额度编辑。旧 duration/绝对期限注入仍作为非法委派字段拒绝用例，不恢复旧参数。

功能源码审核覆盖已提交 `013f0706` 的网络失败归类/通知与 Pino、`6a34b081` 的缓存/在途共享，以及本地 Agent 执行/快照、数据目录、普通cd、挂起读取失败与配置热更新。发现 SourceAdmissionService 在等待封禁读取时若白名单收紧，仍可能接受旧准入事实；现于 await 后复查当前白名单和黑名单开关。普通cd仍取调用方的真实目录，不固定为根目录。未审核全部317个改动文件，不将局部源码审核解释为全仓无缺陷，也未调整无关 UI 风格或布局。

`pnpm run check`、`pnpm run build`（Shared/Backend/Frontend）、最终 Backend build、`pnpm run format:all:check`、`git diff --check` 及本轮修改既有 mjs 的 `node --check` 通过；目标源码/既有测试 ESLint 通过。日志为 `/tmp/nexus-agent-inherit-{check,build,format}.log` 和 `/tmp/nexus-agent-inherit-backend-final.log`。按 D17 未新增或运行本地业务测试、浏览器、E2E 或测试收集；真实多 Child、共享预算耗尽、审批/撤权、取消与未知提交、白名单热更新交错及停机仍待远程 Actions。配置未知提交保守不激活，不根据持久值声称运行态已应用，须显式核对后保存确定配置或重启。未提交、推送或部署。

## 核心配置热更新（2026-10-22）

源码确认旧 ConfigurationService 只更新持久设置，Access/Remote 始终消费启动快照，前端所有保存均提示重启。本批改为串行 prepare → SQL CAS 确认 → 同步 apply：六个 IP/监控字段在原模块实例热更新；保留 CAPTCHA/Passkey 冷字段。状态订阅重排等待定时器，不额外并发或中断在途采样；资源 TTL 改变清旧缓存，晚成功按新 TTL 入缓存。失败 CAS 不激活，未知提交不猜测，停机晚确认不再通过拒绝准入的 installation 重新取有效态，原任务继续 drain；已停止的订阅不重新创建。

同步既有 monitoring-configuration/auth 集成脚本的有效版本、模拟响应与成功提示，系统设置 E2E 改为即时有效周期，白名单 E2E 在保存/清空后直接验证同一来源拒绝/允许，黑名单 E2E 无重启产生真实封禁；受影响定位同步当前 settings-group、标题行表单提交和 Switch。三语言区分已应用与冷配置待重启；IP/监控不因其它冷配置误报重启。未新增或执行本地业务测试、浏览器、E2E 或测试收集（D17）。

本轮根 `pnpm run check`、`pnpm run build`（Shared/Backend/Frontend）、`pnpm run format:all:check`、`git diff --check` 和两个修改集成脚本的 `node --check` 通过；受影响 E2E/集成脚本 ESLint 通过。日志为 `/tmp/nexus-hot-config-{check,build,format}.log`。真实远程采样时序、多客户端、白名单准入、已有封禁、新阈值、混合冷/热配置、未知提交和停机交错仍待远程 Actions，不用静态或历史 PASS 代替。本批未提交、推送或部署。

## Agent 设置窄屏分组与滚动条间距（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top/settings?tab=agent` 核对，未直接访问 9998。390×844 与 320×700 下四个分类均为两列两行，单卡宽分别为 169px 与 134px；总开关卡片只显示开关和“活跃 App 1 / 1”，标题、信息按钮与活跃 App 保持同一行，页面 `scrollWidth=clientWidth`。Agent 设置卡片右缘到内容滚动条可用边界为 12px。

Provider 添加弹窗恢复原尺寸与定位后正常显示：390×844 下为 `358×717.4px`，正文 `clientWidth=308px`、`offsetWidth=316px`、`scrollWidth=308px`、右侧内边距 12px；1024×768 下弹窗为 `576×736px`，正文无横向溢出，未额外增加全屏或侧栏避让样式。证据：`/tmp/agent-settings-scrollbar-gap-390.png`、`/tmp/agent-settings-320-final-gap.png`、`/tmp/provider-modal-reverted-390.png`。

本轮 `pnpm --filter @nexus-terminal/frontend build`、目标文件 Prettier、目标 Vue ESLint 与 `git diff --check` 通过。未提交 Provider 写入，未验证真实触屏指针、软键盘弹出后的可视区变化、浅色主题及全部语言下的像素表现。未提交、推送或部署。

## 挂起目录只读失败误报未知（2026-10-22）

确认源码缺陷：`suspendedFailureKey` 原先把 HTTP 传输的 unknown 无条件解释为修改结果未知，目录 GET 的失败也进入同一文案。现对目录与日志按读取语义展示有限 code，服务端 internal/unknown 在只读场景使用三语读取失败文案；保留 cause 供全局网络去重。挂起 Panel 的正文告警迁至常驻 Toast，搜索栏保留具可访问名称的核对按钮；真实命名/终止/移除 unknown 仍设置 blockedIds，轮询和 Toast 关闭不能解除保护。

同步既有 `suspended-sessions.integration.mjs` 的读失败保留目录且不新增写保护断言，以及权限失败 Toast/核对按钮断言；原未知修改、晚读取不能解除新围栏、取消及 KeepAlive 断言保留。按 D17 不新增/运行本地业务、浏览器及 E2E。本轮 `pnpm run check`、`pnpm --filter @nexus-terminal/frontend build`、`pnpm run format:all:check`、`git diff --check` 和该脚本 `node --check` 均通过，日志为 `/tmp/nexus-suspend-feedback-{check,build,format}.log`。用户现场此次偶发的实际网络/后端原因未复现；实际轮询、移交、Toast/关闭恢复、弱网并发与丢写入回执仍待远程，不能将源码定位/编译当作实机通过。未提交、推送或部署。

## 统一实例数据目录（2026-10-22）

用户明确采用破坏性布局，不处理旧数据。Bootstrap 现在统一从数据库父目录解析 `appearance/`、`artifacts/`、`plugins/`，用于资源打开、在线备份恢复和启动恢复；无旧路径读取、迁移、删除或环境变量兼容分支。Compose 仍挂载完整 data，SQLite 与恢复暂存文件仍在同一目录，Snapshot 原有逻辑分区和同级根约束不变。

既有 backup 集成脚本更新真实 Artifact 损坏注入路径，并在源实例初始化后断言新目录存在、旧前缀目录未创建；Artifact 流句柄观察及 Linux 文件租约夹具同步新路径，不削弱真实句柄/权限撤销断言；Access 多实例夹具改为每实例独立目录，避免仅换 DB 文件名而共享资源根。按 D17 未新增或运行业务测试、浏览器及 E2E。本轮 `pnpm run check`、`pnpm --filter @nexus-terminal/backend build`、`pnpm run format:all:check`、`git diff --check` 及四个修改脚本的 `node --check` 均通过，日志为 `/tmp/nexus-data-dir-{check,build,format}.log`；空目录启动、背景/附件/插件实际读写、完整导出导入、恢复崩溃重启和实例隔离仍待远程验收。未移动/删除现场数据，未提交、推送或部署。

## 终端目录切换普通 cd 回显（2026-10-22）

源码对照确认：`75289ef9^` 的旧 `workspace-shell-integration.service` 已附带 INTERNAL_CD 标记及历史清理，但会隐藏提示符前的全部输出；当前 Adapter 保留后台输出，导致原包装可见。本批仅将真实 PTY 写入改为安全转义的普通 cd，移除无用的输出抑制/清行状态，保留 setup 清理、控制字符拒绝、提示符排队、当前附件与实际 cwd 核对。普通 cd 是否进入历史由远端 Shell 配置决定。

同步已有 `terminal-protocol.spec.ts` 首次目录切换场景，核对普通 cd 独立回显且无 INTERNAL_CD；已有 `file-manager-navigation.spec.ts` 保留 HISTIGNORE 下不记录 cd、用户命令不丢失的断言，并检查无 INTERNAL_CD。按 D17 未新增或运行本地业务测试、浏览器或 E2E。本轮 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check` 和 `git diff --check` 均通过，日志为 `/tmp/nexus-cd-{check,build,format}.log`；真实 Bash/Zsh、单引号/空格路径、前台程序等待、后台输出和历史配置待远程验收，不把编译当作行为通过。未提交、推送或部署。

## 工作区与设置通用结果统一 Toast（2026-10-22）

本批把工作区布局冲突/读取失败、命令列表和连接树恢复，以及设置的个人偏好、日志、安全、监控、外观、备份、宿主诊断、Agent 与密钥管理通用操作结果迁至全局 Toast；不再在正文插入错误横条。字段校验、危险确认与未知结果核对保留，待重启状态仍由业务 owner 持有并改由 Toast 展示，业务 owner 继续持有 CAS、原意图和刷新围栏。已识别网络 cause 沿原统一网络通知，关闭 Toast 不解除围栏。

Toast 增加只读刷新 action；设置聚合核对从自动对话框改为常驻 Toast，页头待核对入口仍可重新打开。根卸载后不发布晚返回通知；恢复 Promise 使用 allSettled 汇总同步与异步失败，不重放原写入。同步迁移已有 monitoring、registry、execution、provider、targets 与 system-settings 断言，直接核对通知 store 或正式全局 Toast，而非已删除的正文节点。

本批 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check` 和 `git diff --check` 通过；既有 monitoring、registry、execution、provider、targets、notifications 集成脚本的 `node --check` 通过，仅作语法核对，未执行脚本。按 D17 不新增/运行本地业务测试、浏览器或 E2E。常驻/关闭、同文案去重及不同恢复范围隔离、弱网并发、只读恢复、各语言/窄屏与权限切换的实际交互仍待远程验收，类型及编译不作为这些行为通过的证据。主仓库本轮未提交、推送或部署。

## 安全设置重启提示统一 Toast（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top/settings?tab=ipControl` 核对，未直接访问 9998。安全设置正文已移除 `ConfigurationStatus` 及“配置将在服务器重启后生效”“已保存，重启服务器后生效”节点，避免读取或保存时插入、移除提示导致布局跳动。IP 管控页面正文内对应文案数量为 0，页面 `scrollWidth=clientWidth`，无横向溢出。

通过 CDP 向安全配置读取注入 `requiresRestart: true` 的待重启快照后，全局通知 store 得到一条 `warning`，正文为“验证码或 Passkey 站点配置将在服务器重启后生效。”，正文内联重启提示数量仍为 0。当前测试环境本身没有待重启冷配置，因此未触发真实页面 Toast；也没有对真实 CAPTCHA 配置执行需重启保存。`tests/frontend/auth.integration.mjs` 已改为直接检查通知 store，覆盖初次待重启 warning、CAPTCHA 保存 success、冲突及网络热保存 `savedLive` 断言，但按 D17 本轮未执行该集成脚本。

本轮 `pnpm --filter @nexus-terminal/frontend build`、目标文件 Prettier、目标 Vue ESLint、`node --check tests/frontend/auth.integration.mjs` 与 `git diff --check` 通过。真实待重启保存、Toast 自动关闭/堆叠、窄屏与弱网并发交互仍待远程验收；注入响应只验证展示分支，不改写测试环境配置。

## 设置页解释性副标题移除（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top/settings` 核对，未直接访问 9998。桌面 `1536×900` 依次检查工作区、系统、安全、IP 管控、数据管理、外观、Agent 和关于页：可见 `.ui-settings-group__description` 与 `.settings-content-head p` 均为 0，八页 `settings-page.scrollWidth=clientWidth`，无页面级横向溢出。移动端 `390×844` 复跑同八页，说明元素为 0 且页面无横向溢出；设置目录卡片不再渲染条目说明，主标题下也不再显示概览说明。

展开“诊断与恢复（高级）”后，宿主诊断与机器突变恢复的分组标题均无副标题；机器突变恢复的原有核对警告仍以正文 warning 提示显示“解除只移除执行围栏，不重试原操作，也不证明原操作成功。请先独立核对远端实际效果。”，没有因移除标题说明丢失。证据：`/tmp/settings-subtitles-workspace.png`、`/tmp/settings-subtitles-system.png`、`/tmp/settings-subtitles-security.png`、`/tmp/settings-subtitles-ipControl.png`、`/tmp/settings-subtitles-data.png`、`/tmp/settings-subtitles-mobile-menu.png`、`/tmp/settings-maintenance-expanded.png`。

目标文件 Prettier、目标 Vue ESLint、`pnpm --filter @nexus-terminal/frontend build` 与相关文件 `git diff --check` 通过。首次构建曾因并行改动的 `packages/frontend/src/features/agent/model/execution-mapper.ts:71` 报 `TS2741` 中断，该并行改动完成后重试通过；本批未修改该文件。工作区整体 `git diff --check` 仍被其他并行改动在 Agent execution 文件中的行尾空格和 EOF 空行阻断，未清理这些未知变更。设置值保存、机器突变证据录入/解除和真实窄屏交互动画仍待远程 E2E。

## Agent 市场对照、官方插件发布与记忆导入移除（2026-10-22）

本批对照 `75289ef9^` 的正式 Agent，不以开发页作为旧版基线；主仓库为 `dev` 工作区，未提交、推送或部署其中既有页面改动。按 D17 仅做源码、类型、格式、构建及发布资产完整性核对，不运行本地业务测试、浏览器或 E2E。

| 功能             | 重构前事实                                                                                                            | 当前核对与处理                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 默认与第三方市场 | `PluginManagementSettings.loadRemoteCatalogs` 并行读取官方及全部配置仓库，按来源展示；标题已是“可安装 App 与 Skill”。 | `PluginRepositorySettings.load` 仍读取官方及所有配置仓库，并保留成功结果；没有丢失多市场能力，但改为串行读取，部分失败只给通用提示。此处没有改名或另建 Skill 安装通道。                                           |
| 官方目录与签名包 | 官方目录是默认安装来源，Skills 属于签名插件包。                                                                       | 线上 v1.0.0 的 publisher 多出 `schemaVersion`，SDK 为 `1.0.0`，manifest 含旧 `nexus/agents/agentSurface/targets`；分别违反当前目录白名单、SDK 精确值 `1` 和 manifest 白名单。通过发布新包修复，未放宽 Host 校验。 |
| App 与启用引导   | 旧 `compose-agent` 创建空 AppRegistry，插件提供 App；首次启用先读取推荐并确认安装官方插件。                           | 当前 `ScopeService.list` 自动创建 `nexus.terminal`，设置开关直接调用 `execution.toggleEnabled`，推荐安装仍在市场。两项是仍存在的产品流程差异，本批没有擅自改动，也不宣称 Agent 已全部还原。                       |
| 跨 App 记忆导入  | 旧 `MemorySettings` 与后端已有来源选择、预览和确认导入，并非重构新增。                                                | 用户本次明确删除：移除 UI、API、Shared codec/类型、Service/Model/Storage/SQL、确认表、快照登记和专属事件/三语文案；保留当前 App 提案、审核、发布、撤销、Recall、普通备份和通用 AppIntent。                        |

记忆来源选择移除后，删除无人消费的 slot `apps` 参数与外部导入失效通知；列表读取仍由原 `useAgentManagementOperation` 独占并保护身份/离页竞态。专属 `agent_memory_imports` 已从当前初始结构及快照中移除，初始签名更新为 `backend-next-v1-initial-20261022-memory-scope`。按 H-12 不添加旧开发库兼容迁移，本批没有删除或重置任何数据库。测试夹具的 `memory.import` 只是通用 Intent 声明，不调用已删的记忆路由，未借此删除普通跨 App 通道。

官方源码归独立仓库 `0honus0/nexus-agent-plugins`，提交并推送 `bda89fc66e1ed08f7ee5f27ced1d851785dac64d`。两个插件均发布为不可变新版本 `1.0.1`：精确 manifest/SDK、目录 publisher 白名单、catalog 独立 Nexus 范围（1.0.2–1.99.99），补齐显式 context/memory/artifact 等声明但不自动授权；Full-stack 改用当前 `request`、`valueJson`、CAS/operationId、布尔 health 和符合 CSP 的外部样式；官方 Skills 不再描述已移除的旧审批模式。

- [源码验证 39733680384](https://github.com/0honus0/nexus-agent-plugins/actions/runs/39733680384)：当前提交的 `Plugin validation gate` 成功。
- [草稿签名发布 39733748916](https://github.com/0honus0/nexus-agent-plugins/actions/runs/39733748916)：原固定 Ed25519 Publisher 身份签名并上传三个资产，成功；私钥仅在 Actions secret/runner 内使用。
- [公开发布](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v1.0.1)：草稿资产核对后发布；发布触发的 [Release 39733871666](https://github.com/0honus0/nexus-agent-plugins/actions/runs/39733871666) 及 [Validate 39733870820](https://github.com/0honus0/nexus-agent-plugins/actions/runs/39733870820) 均成功。

草稿与公开资产分别下载并逐字节比较一致，`releases/latest/download/catalog.json` 与已核对目录一致。核对目录字段/SDK/范围、原 Publisher 指纹、公钥、两个 tar 的 size/SHA-256、Ed25519 签名、全部文件 hash/大小/清单及与提交源码的对应；没有执行插件代码或 Host 安装行为。

| 资产                        | 字节  | SHA-256                                                            |
| --------------------------- | ----- | ------------------------------------------------------------------ |
| `nexus.agent-1.0.1.tar`     | 20480 | `d2250949930fcf1675a96ed13744c7e892374bf182e589f36e2ffc76136791ea` |
| `nexus.fullstack-1.0.1.tar` | 20480 | `293c5b48ef67c42a5fa6ba32e4df47573fdcccb60aaff8a2ee71e608f740a36d` |

本批静态与构建：官方 `node scripts/check.mjs`（两个插件）、全部发布脚本及两个运行入口 `node --check`、主仓库 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check` 和两仓 `git diff --check` 通过。末次 schema/slot 小改后再次执行根 check 与前后端构建均通过；文档收口后再次核对全量格式及 diff。普通记忆管理、已移除入口不可达、多市场安装/升级及官方两个包在真实 Host 的安装、授权、运行仍待远程 E2E/现场验收；资产核验不等同于这些行为通过。

## 设置页保存入口与文案统一（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top/settings` 核对，未直接访问 9998。工作区四组已从“保存本组”统一为“保存”；系统语言、时区、日志，首页与监控，监控核心配置，安全密码/CAPTCHA，IP 白名单/黑名单和外观标题栏颜色均把主保存按钮放在 `UiSettingsGroup` 标题右侧。未修改时按钮为 `soft + neutral` 且禁用，修改后才变为 `solid + primary`。

1536×900 下系统三组按钮均为 `55.6×38px`，位于标题行右缘；安全、IP 管控、外观和工作区的可见分组均无标题与操作区重叠。390×844、320×844 下五个设置页签页面级 `scrollWidth=clientWidth`，标题可按需增高但操作区保持右对齐且不覆盖标题；320px 下语言、时区、日志、工作区、密码、Passkey、两步验证、CAPTCHA、IP 白名单及外观标题操作区均完成边界检查。

通过真实 UI 草稿分别修改语言（`中文 → 日本語`）、时区、前端日志等级、工作区弹窗编辑器复选框、外观标题栏颜色和 IP 白名单文本：对应按钮均由 `disabled=true / soft / neutral` 变为 `disabled=false / solid / primary`；每次重新加载后草稿丢弃并恢复弱化禁用。全程未点击保存，未修改测试环境配置。证据：`/tmp/settings-saves-system-after.png`、`/tmp/settings-saves-workspace-after.png`、`/tmp/settings-saves-security-after.png`、`/tmp/settings-saves-ipControl-after.png`、`/tmp/settings-saves-appearance-after.png`、`/tmp/two-factor-saves-1536.png`。

两步验证启用态的“禁用两步验证”已改为标题右侧按钮并通过 `form` 关联正文密码表单，但当前测试账号未启用 TOTP，启用态视觉和真实禁用提交仍未实机覆盖。目标 Prettier/ESLint、Frontend build、根 `pnpm run check`、`pnpm run format:all:check` 与 `git diff --check` 通过；全量格式首次被忽略目录 `tests/e2e/.tmp/vite-cache` 的生成缓存阻断，移出该缓存后通过，未修改无关源码。未提交、推送或部署。

## 两步验证主操作移至标题栏右侧（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top/settings?tab=security` 核对，未直接访问 9998。两步验证未启用时，“启用两步验证”从正文底部移至 `UiSettingsGroup` 标题行操作区，与 Passkey 注册按钮采用同一右侧对齐方式；正文只保留当前状态提示，不再重复主操作。扫码配置、启用后密码禁用和读取失败重试的分支保持原语义。

1536×900 下标题行高 `38px`，操作区与按钮均为 `107.6×38px` 且右缘对齐分组内容；390×844 下按钮为 `108×38px`。320×844 下标题允许换行但操作区仍右对齐，页面无横向溢出（`scrollWidth=clientWidth=320`）。截图证据包含 `/tmp/two-factor-wide.png`、`/tmp/two-factor-390.png`、`/tmp/two-factor-320.png`、`/tmp/two-factor-saves-1536.png`。最新源码已把启用后的禁用按钮也移至标题右侧，但测试账号未启用 TOTP；完整激活、启用态布局和真实禁用流程仍待远程 E2E。

## 代理与通知管理窄屏操作与事件计数（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top/proxies` 与 `/notifications` 核对，未直接访问 9998。760px 以下两页的编辑、删除从内容右侧移到下方，作为等宽图文按钮；代理筛选在 360px 以下按行展开，通知筛选固定为搜索独占一行、类型与状态各半行。通知卡片只显示“已启用 49 项事件”，不再渲染事件名称示例；搜索仍会匹配事件名称。

390×844 下代理工具栏为 `234px + 112px` 两列，通知卡片操作区宽 `330px`，两枚按钮各 `161×32px`。320×844 下页面均无横向溢出（`scrollWidth=clientWidth=320`）；代理工具栏收为单列 `284px`，通知工具栏为搜索 `284px`、类型与状态各 `138px`，卡片操作区 `260px`，两枚按钮各 `127×32px`。320px 通知卡片 DOM 的元信息实测仅为 `已启用 49 项事件`。截图为 `/tmp/proxies-320-final-v2.png`、`/tmp/proxies-390-final-v2.png`、`/tmp/notifications-320-final.png`。完整远程 E2E、浅色主题与更多物理设备未运行。

## Agent 执行设置底部保存栏窄屏对齐（2026-10-22，本地 CDP）

`https://api.honus.top/settings?tab=agent` 使用当前工作区核对，未直接访问 9998。原底部栏使用 `flex-wrap`，`320×568` 下提示文字占满首行后把“保存”按钮挤到下一行并靠左，形成高 `86px` 的断裂布局。现改为提示文字可换行、按钮不收缩的单行布局。

修复后 `320×568` 下底部栏为 `288×64px`，提示文字 `188×40px` 分两行，保存按钮 `56×38px` 固定在右侧且垂直居中；`390×844` 下提示保持单行，按钮仍固定右侧。`1536×762` 桌面布局同样保持提示单行、按钮右侧对齐。三档均无页面级横向溢出。证据：`/tmp/execution-footer-wide-before.png`、`/tmp/execution-footer-390-before.png`、`/tmp/execution-footer-320-before.png`、`/tmp/execution-footer-390-after.png`、`/tmp/execution-footer-320-after.png`。

## 成功与失败 Toast 视觉强化（2026-10-22，本地 CDP）

`https://api.honus.top` 使用当前工作区核对，未直接访问 9998。通过页面内真实 `shared-notifications` store 同时展示成功与失败提示，未触发后端写入。桌面 1536×762 下成功 Toast 为 `400×58px`、失败为 `400×63.1px`；两类卡片分别命中 `--status-success-color` 与 `--status-error-color` 的边框、渐变底色、图标容器和左侧强调线，消息仍可完整换行。

390×844 下两类 Toast 宽 `366px`；320×568 下宽 `294px`，长失败文案换行后卡片高度 `58px`，图标、关闭按钮和消息均未裁切，页面 `scrollWidth=clientWidth`。成功/失败卡片的圆角、阴影、内边距与关闭按钮尺寸在窄屏统一收紧；通知类型、时长、去重和关闭语义未改动。证据：`/tmp/toast-refined-wide.png`、`/tmp/toast-refined-mobile.png`、`/tmp/toast-refined-320.png`。浅色主题和更长的多段错误文案未单独验证。

## Provider 添加弹窗移动端适配（2026-10-22，本地 CDP）

`https://api.honus.top/settings?tab=agent` 使用当前工作区核对，未直接访问 9998。窄屏问题来自表单 `fieldset` 的浏览器默认最小内联尺寸把正文撑宽，而不是缩放柄本身：`320×568` 修复前正文 `scrollWidth=298px`、`clientWidth=238px`，可横向拖动；修复后两者均为 `238px`。弹窗为 `288×482.8px`，缩放柄不渲染，正文独立纵向滚动，保存/取消底栏保持可达。

`390×844` 下弹窗为 `358×730.4px`，正文 `scrollWidth=clientWidth=300px`，缩放柄在设备能力回调完成后不存在；页面 `scrollWidth=clientWidth=390px`。桌面 `1536×762` 下缩放柄可见、启用，指针拖动会写入新的宽高；随后切入 `320px` 视口时内联尺寸被清除，弹窗恢复自适应，证明桌面能力保留且不会污染手机布局。本轮未提交 Provider 写入，未测试软键盘弹出后的可视区变化。证据：`/tmp/provider-320-after.png`、`/tmp/provider-390-after.png`、`/tmp/provider-mobile-current.png`。

API 密钥区域进一步核对：标签独占一行后，输入框与“显示凭据”按钮同在下一行，`390×844` 下两者高度均为 `32px`，顶部和底部位置差值均为 0；输入框仍可收缩，按钮和说明文案未溢出。证据：`/tmp/provider-credential-aligned-390.png`。

调用协议与启用开关同步核对：宽屏两者均为 `32px` 高，顶部和底部位置差值均为 0；`390×844` 下启用行宽 `280px`，`320×568` 下宽 `210px`，均与协议下拉框同宽并铺满单列，文字靠左、开关靠右。两种窄屏页面均无横向溢出。证据：`/tmp/provider-protocol-toggle-wide.png`、`/tmp/provider-protocol-toggle-390.png`、`/tmp/provider-protocol-toggle-320.png`。

## 全局提示弹层与 Toast 重构（2026-10-22，本地 CDP）

`https://api.honus.top` 使用当前工作区核对，未直接访问 9998。通过真实 `confirmConnectionHostKey` 入口打开 SSH 主机密钥变化提示：1536×762 下面板为 `500×354.5px`，390×844 下为 `358×352.5px`；详情区展示目标、已保存指纹和当前指纹，长指纹可换行，两个操作按钮在手机端各 `155px` 宽、`44px` 高，面板无横向或纵向溢出。取消正常收起且未写入信任。证据：`/tmp/global-host-key-dialog-wide.png`、`/tmp/global-prompts-mobile-2.png`。

临时修改 `public/sw.js` 触发真实 Service Worker 更新事件，更新提示显示为 `420×127.5px` 玻璃面板，手机为 `358×157.3px`，操作按钮在手机端等宽 `44px`；验证后已立即还原 `public/sw.js`，工作区无该文件差异。全局 Toast 在桌面为 `400×59.6px`、手机为 `366×60px`，计算样式包含 `backdrop-filter: blur(14px) saturate(1.55)` 和语义色左侧强调线。证据：`/tmp/global-prompts-wide-final.png`、`/tmp/global-update-prompt-mobile-final3.png`。

`tests/e2e/specs/ssh/connection.spec.ts` 仍以 `SSH Host Keys`、`Cancel` 和 `Trust and reconnect` 定位，重设计未改变可访问名称与按钮文案，按 D17 未运行该远程用例。目标 ESLint／Prettier、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过；浅色主题和扩大视口组合未运行。

## 全局下拉基础组件统一（2026-10-22，本地 CDP）

`packages/frontend/src` 已无原生 `<select>`／`</select>`。原剩余三处消费者已迁入 foundation `UiSelect`：Agent DEV 模型选择、Targets DEV SSH 连接选择，以及设置数据页高级维护中的突变结果与解除证据选择；空值占位、禁用态和证据校验保持原语义。

`https://api.honus.top` 使用当前工作区核对，未直接访问 9998。1536×762 下依次检查仪表盘、连接管理、代理管理、通知管理、审计日志和设置的工作区／系统／外观／安全／IP 管控／数据管理／Agent 页：`document.querySelectorAll('select').length` 均为 0；所有可见 `.ui-select__trigger` 的计算样式均为 `backdrop-filter: blur(8px) saturate(1.45)` 与 48% 半透明填充。系统设置语言下拉实际展开后，浮层为 `backdrop-filter: blur(28px) saturate(1.85)`、37.8% 半透明填充，三个语言选项完整可读。证据：`/tmp/global-dropdown-glass.png`、`/tmp/global-dropdown-glass-open.png`。

`tests/frontend/mutation-recovery.integration.mjs` 已按 ReKa 交互更新并实际通过 12 项检查：先展开高级维护区，再点击 `UiSelect` 并选择观察结果与证据选项，同时以 `data-value` 核对空值占位。目标 ESLint／Prettier、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过；完整远程 E2E、浅色主题和更多设备视口未运行。

## Agent 空会话首页默认无内部滚动（2026-10-22，本地 CDP）

`https://api.honus.top` 使用当前工作区核对，未直接访问 9998。临时启用 Agent 执行后打开默认 `1180×740` 悬浮窗并进入空会话首页：修复前会话 scroller `clientHeight=412`、`scrollHeight=500`、`scrollTop=87.2`，右侧出现滚动条；将欢迎区固定最小高度改为填满可用区后，`clientHeight=scrollHeight=412`、`scrollTop=0`，滚动条消失，页面无横向溢出。截图证据 `/tmp/agent-home-before.png`、`/tmp/agent-home-after.png`。验证后通过同一执行设置接口恢复 `enabled=false`，重新加载确认入口与窗口数量均为 0。

`tests/e2e/specs/agent/configuration-hints.spec.ts` 在创建空会话并显示输入区后，新增 scroller `scrollHeight - clientHeight === 0` 断言。该用例按 D17 未运行；本轮静态检查将随当前批次执行。

## Agent SSH 目标批量选择（2026-10-22）

`tests/e2e/specs/agent/configuration-hints.spec.ts` 现创建两个真实测试 SSH 连接并启用执行设置；打开 Agent 的“选择 SSH 目标”弹层后，断言初始“全部停用”不可用，点击“全部启用”后两项均选中且“全部启用”不可用，点击“全部停用”后两项均取消，再保留原有单项勾选与 grants 为空断言。该用例覆盖当前 `AgentAppSurface` 直接写入 `useNativeRuns.connectionIds` 的批量交互，不派发 Run。

本轮执行 `pnpm exec prettier --check`（目标文件）、目标 ESLint、`pnpm run check`、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check`，均通过。按 D17 未运行该 E2E；当前 `api.honus.top` 的 Agent 执行设置关闭，未为视觉截图临时开启，因此弹层实际布局、窄屏换行和启用态点击结果仍待浏览器验证。

## Agent 执行关闭时隐藏悬浮入口（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top` 核对，未直接访问 9998。登录测试账号后打开 `/settings?tab=agent`，当前“Agent 功能”开关为 `aria-checked=false`；页面中 `[data-agent-launcher-trigger]` 数量为 0，`.agent-hub-window` 数量为 0。1536×762 CSS 视口下 `document.documentElement.scrollWidth=1528`，未出现页面级横向溢出。

`tests/e2e/specs/agent/host.spec.ts` 对应用例已改为：先确保执行设置关闭并断言入口与窗口均不存在；通过设置开关启用后等待入口出现并打开窗口；全局导航期间窗口保留；再次从设置关闭后入口与窗口消失。本机按 D17 未运行该浏览器行为用例；本轮实际执行 `pnpm exec eslint packages/frontend/src/features/agent/host/AgentSurfaceHost.vue tests/e2e/specs/agent/host.spec.ts`、`pnpm run check`、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check`，均通过。未覆盖浅色主题、其他视口和启用状态下的实机开关切换。

## 全局应用更新弹层与自动读取（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top` 核对，未直接访问 9998。代理、通知与审计标题区已无常驻刷新按钮，列表在进入页面时自动读取；代理、通知的异常提示仍保留重试，审计读取失败保留旧记录和重试。插件管理进入“App 与扩展”后自动读取已安装插件与仓库状态，标题区不再要求手动刷新；入口自身的“读取仓库与推荐”只在对应操作失败时出现。

实际修改本地 `sw.js` 内容并触发 `registration.update()` 后，已有控制者的页面出现全局“新版本已就绪”弹层；1200×800 下弹层为 `560×130.1px`，标题、单句说明与“稍后／立即更新”完整显示。390×844 设备视口下以同一 `UiDialog` 打开状态核对为 `280×147.5px`，居中且无横向溢出；未点击“立即更新”执行重载，以免中断核对页。证据：`/tmp/app-update-prompt.png`、`/tmp/app-update-prompt-final-wide.png`、`/tmp/app-update-prompt-final-mobile.png`、`/tmp/agent-tools-after-auto-load.png`。

待验：真实点击“立即更新”后的缓存清理、Worker 接管与登录态恢复，选择“稍后”后同一 Worker 不再提示，新 Worker 可再次提示，离线/多标签页/浅色主题组合。静态检查结果见本轮最终检查记录。

## 连接管理中窄屏卡片与筛选栏自适应（2026-10-22，本地 CDP）

使用当前工作区经 `https://api.honus.top/connections` 核对，未直接访问 9998。中屏筛选固定为两行：搜索独占一行，标签、当前排序、排序方向和批量开关在下一行；列表级“测试全部／连接全部”在右侧上下等分并撑满。连接卡片在 760px 以下保持名称、地址、最近连接三行左对齐，左侧类型图标垂直居中；360–760px 使用右侧竖排协议/标签块，360px 以下恢复名称同行。底部测试、编辑、克隆与连接作为同一组，左缘统一对齐类型图标列，按钮内容居中并带浅色细边框；空间足够时四个均显示图文，稍窄时前三项为图标、连接保留文字，极窄时四个均为图标且隐藏类型图标。窄屏批量栏固定为三枚选择操作与两枚批量动作两行，选择框在卡片左缘跨行居中。

CDP 实测：390×844 与 640×900 均无横向溢出；390px 卡片宽 `358px`，右侧竖排标签块 `80px`，操作行 `334px`，四个图文按钮完整显示；640px 卡片宽 `592px`、操作行 `566.4px`，批量栏 `334×135.8px` 稳定为三加二两行。320×568 恢复名称行内标签并显示三图标加连接图文，256×520 隐藏类型图标并显示四图标；两种宽度均无横向溢出。

证据：`/tmp/connections-final-390.png`、`/tmp/connections-batch3-390.png`、`/tmp/connections-border-640.png`、`/tmp/connections-border-320.png`、`/tmp/connections-align-256.png`。目标 Prettier/ESLint、`pnpm --filter @nexus-terminal/frontend build`、根 `pnpm run check` 与 `git diff --check` 通过。全量 `format:all:check` 被现有生成缓存 `tests/e2e/.tmp/vite-cache/**` 的大量 spacing 报错阻断，未修改该目录或无关源码。未提交、未部署。

## Agent 设置总开关可见性恢复（2026-10-21，本地 CDP）

最后成功发布的 `dev` 镜像标签 `ghcr.io/0honus0/nexus-terminal:dev` 的 `org.opencontainers.image.revision` 为 `d9a27832426524a13bc180225aab4eda03afff5e`；Actions `39531103157` 之后没有新的成功发布。源码对照确认该镜像与当前工作区的执行设置 API、mapper、composable 未变，失效点是设置页把总开关放在执行设置成功读取的条件内，读取失败会连同标题和控件隐藏。

本地 CDP（`https://api.honus.top`，未使用 9998）验证：桌面页开关可见，实际启用→停用两次 PUT 均为 200，最终恢复停用；将 `GET /api/v1/agent/execution-settings` 返回 503 后，开关仍可见、处于禁用态并显示“不可用”，页面保留“读取已保存设置”入口。新增 `performance-settings.spec.ts` 失败态回归，检查开关可见、禁用与不可用文案。390×844 设备视口下开关仍可见，页面 `scrollWidth=304`、`clientWidth=312`，无横向溢出。证据：`/tmp/agent-switch-live.png`、`/tmp/agent-switch-390.png`、`/tmp/agent-switch-503-debug.png`。旧镜像未包含本次源码修复，须重新构建发布后才进入 `:dev`。

## 代理与通知管理目录式布局（2026-10-21，本地 CDP）

使用当前工作区经 `https://api.honus.top/proxies` 与 `/notifications` 核对，未直接访问 9998。桌面物理视口 `1920×1125`（CSS `1536×900`）下，两页均采用与连接管理一致的标题/主操作、概览卡、搜索筛选栏和无外框圆角列表；代理按协议显示总数、SOCKS5、HTTP 三项统计，通知显示总数及三种渠道统计。代理项显示协议、`host:port`、认证状态与图标编辑/删除，通知项显示类型、启用状态、目标地址、前三项订阅事件及同一组图标操作。通知页只保留渠道配置；投递记录已移到审计日志页。

390×844 设备视口下页面实测 `scrollWidth=382`、`clientWidth=382`，无页面级横向溢出；代理与通知筛选器改为单列，卡片操作移至内容下方。320×568 下页面 `scrollWidth=312`、`clientWidth=312`，代理与通知弹窗均为 `280×536`。通知编辑器的内容区 `scrollHeight=2292`、`clientHeight=638`，标题和“取消／保存”底栏保持固定，内容独立滚动。

通过界面创建两条临时 Webhook 通知渠道后删除，最终通知渠道数为 `0`；未触发真实通知投递、未测试外部供应商，也未覆盖浅色主题和更多物理设备。控制台无 error。证据：`/tmp/proxies-cdp-full.png`、`/tmp/proxies-390.png`、`/tmp/proxies-320.png`、`/tmp/proxy-form-desktop.png`、`/tmp/proxy-form-320.png`、`/tmp/notifications-with-cards.png`、`/tmp/notifications-390-card.png`、`/tmp/notifications-320.png`、`/tmp/notification-form-desktop.png`、`/tmp/notification-form-390.png`、`/tmp/notification-form-320.png`、`/tmp/notifications-390-refresh.png`。目标 ESLint/Prettier、`pnpm --filter @nexus-terminal/frontend build`、`pnpm run check`、`pnpm run format:all:check` 与 `git diff --check` 见本轮最终静态检查。

通知编辑器在 1280×900 CSS 环境中实测“测试通知”按钮始终显示，未填写 URL 时按钮禁用，页面不再渲染“请填写必填字段以启用测试”提示；控制台无 error。证据：`/tmp/notification-form-test-button.png`。

## 通知投递迁入审计日志（2026-10-21，本地 CDP）

`https://api.honus.top/audit-logs` 现提供“操作记录 / 通知投递”两个视图，默认仍显示操作记录。通知投递视图显示时间、事件类型和投递状态，保留 unknown 数量提示、异常重试、继续加载和分页入口；通知页面不再读取或渲染投递记录。切换视图、重新读取或离开页面不会触发通知重发。

测试环境当前没有真实投递记录，空态显示“暂无投递记录。”。为核对终态行布局，使用 Playwright 在浏览器内只读拦截投递列表响应并注入 `sent`、`failed` 两条合成记录，未向 webhook 或外部供应商发送请求；桌面与 390 设备视口下页面均无横向溢出（窄屏实测 `scrollWidth=304`、`clientWidth=312`），状态文案与图标完整进入 DOM 且为点击命中元素。控制台无 error。证据：`/tmp/audit-log-tabs-desktop.png`、`/tmp/audit-deliveries-desktop.png`、`/tmp/audit-deliveries-390.png`、`/tmp/audit-deliveries-rows-desktop.png`、`/tmp/audit-deliveries-rows-390.png`。真实通知终态读取、分页和失败恢复仍需完整 E2E 覆盖。

## 审计日志时间线重构（2026-10-21，本地 CDP）

操作记录由表头加详情块改为时间线：左侧时间列、事件类别节点、事件名称/范围/HTTP状态与用户/来源IP/对象/路由分层展示，去掉逐行边框和原始键值 `<pre>`。页头提供操作记录/通知投递切换、关键词、操作类型与全部时间/24小时/7天/30天筛选；时间范围实测发出带 `from/to` 的请求，筛选、重新激活或失败重试会按当前时刻重算范围，翻页继续沿用同一 `activeQuery`。通知投递沿用时间线骨架，显示短状态、渠道编号和更新时间；渠道编号为空时显示“渠道已不可用”，不再渲染 `#null`。

`https://api.honus.top` 当前工作区核对：桌面物理视口 `1920×953`（CSS `1536×762`）、390×844 与 320×844 均无页面级横向溢出，320 下对象标签与 UUID 正常换行。用 `defaultUiTheme` 令牌临时切换浅色后，桌面仍无横向溢出和错误提示；核对后恢复原主题，不写入外观偏好。测试环境没有真实投递记录，使用浏览器内 Pinia 展示状态只读注入 `sent`、`failed`、`unknown` 三条合成记录，未派发通知或写入服务端；桌面三行宽度一致，390 行宽 `342px`，未知数量提示与三种状态标签完整。控制台无 error，运行时无 exception。证据：`/tmp/audit-refined-desktop.png`、`/tmp/audit-refined-light-desktop.png`、`/tmp/audit-refined-deliveries-desktop.png`、`/tmp/audit-refined-390.png`、`/tmp/audit-refined-deliveries-390.png`、`/tmp/audit-refined-320.png`。

审计专用 UI E2E 使用独立端口启动，`specs/ui/audit-log-filtering.spec.ts` 两项全部通过：分页/虚拟列表、筛选、时间范围 `from/to`、窄屏无溢出，以及续页失败保留旧记录并重试。夹具时间戳改为当前时间以符合客户端对时间范围的严格校验；原始日志 `/tmp/nexus-audit-e2e-final.log`。真实投递分页、失败恢复与完整像素组合仍需回归。

## SSH 主机密钥面板（2026-10-21，本地 CDP）

`https://api.honus.top/connections` 的“更多操作 → SSH 主机密钥”使用当前本地工作区核对，未直接访问 9998。面板改为固定标题区、独立滚动内容和固定底栏；安全说明不再占据列表上方空间，改为标题右侧与全站一致的标准 `UiInfoHint`，悬停或键盘聚焦显示完整文案。

桌面视口下弹窗 `896×730.4`，已信任密钥为单一容器内四行，实测行高约 `86.4px`，指纹完整显示且无横向滚动；手动建立信任的主机/端口同排，SHA-256 输入与 `93.6×32` 的紧凑“确认信任”按钮同排。面板只有底部一个“关闭”按钮，列表行“移除信任”仍打开原二次确认；实际点击后取消，未产生 `/host-keys/remove` POST。

390×844 CSS 设备视口下弹窗 `x=16`、宽 `350.4`、高 `760`，主机与端口改为单列，指纹输入与 `93.6×32` 的确认按钮保持同行，按钮左侧无空缺；320×568 下同排布局仍无横向溢出（内容区 `scrollWidth=270`、`clientWidth=270`）。未执行确认信任或实际移除写入，未覆盖浅色主题、其他物理设备和弱网未知结果。

证据：`/tmp/host-keys-refined-desktop-form.png`、`/tmp/host-keys-390-final.png`、`/tmp/host-keys-320-final.png`。静态结果为目标 ESLint/Prettier、`pnpm --filter @nexus-terminal/frontend build`、`pnpm run check`、`pnpm run format:all:check` 与 `git diff --check` 全部通过。

## 连接表单细节、数字步进与列表密度（2026-10-21，本地 CDP）

`https://api.honus.top/connections` 使用本地 CDP 核对当前工作区，未直接访问 9998。连接列表第一张卡与工具栏之间实测 `14px` 间距，卡片高度 `88px`，仍为标题/标签、地址、上次连接/状态三行；标签筛选触发器和展开选项均为居中文本，排序控件同为中心对齐。

添加连接弹窗使用不透明表单表面，分区线为浅色单线。端口框隐藏浏览器原生 spinner，替换为主题化上下按钮；实际点击将端口由 `22` 增至 `23`，再连续降为 `21`，`22→23→21` 的 `valueAsNumber` 与输入值同步。`type=number` 计算样式为 `appearance: textfield`，步进按钮共两个。SSH“测试连接”改为普通基础按钮尺寸，与“确认添加／取消”同为 `32px` 高；测试延迟说明位于按钮右侧信息图标，悬停后浮层 `z-index=200`，`elementFromPoint` 命中 `info-hint-panel`，不再被模态层遮挡。

390×844 CSS 视口下，添加弹窗实测 `x=16`、宽 `350.4`、高 `760`，无横向溢出；底部测试行在操作组上方，“确认添加／取消”各宽 `153.4px` 且完整位于面板内。批量编辑弹窗为 `x=16`、宽 `350.4`、高 `584.4`，标题显示“已选 2 项”，分区标题均带统一强调线，内容与底栏无横向溢出。桌面批量编辑使用同一不透明 `ui-form-surface`，配置/凭据分区、滚动内容和固定底栏保持原提交语义。

证据：`/tmp/connections-number-stepper.png`、`/tmp/connections-tag-select-center.png`、`/tmp/connections-add-final-390.png`、`/tmp/connections-batch-final-390.png`、`/tmp/connections-add-final-1536.png`、`/tmp/connections-batch-final-1536.png`。本轮未保存连接、未触发真实 SSH 测试，也未核对浅色主题和更多物理设备；静态结果为目标 ESLint/Prettier、`pnpm --filter @nexus-terminal/frontend build`、`pnpm run check`、`pnpm run format:all:check` 和 `git diff --check` 全部通过。

## 添加连接跳板机链样式（2026-10-21，本地 CDP）

`https://api.honus.top/connections` 的添加连接弹窗中，跳板机区域已由逐行描边表单改为编号步骤链：宽屏实测两项时序号 `1/2` 由细连接线串联，添加按钮位于链尾；下拉展开后每个选项显示连接名称和 `用户名@主机:端口`。实际将第二跳从 `amd` 替换为 `hostbrr` 后 `data-value` 由 `1` 变为 `4`，移除第一跳后步骤由 2 降为 1，控制台无 error。

390×844 设备视口下页面与弹窗无横向溢出（页面 `scrollWidth=304`、CSS 视口 `312`；弹窗 `scrollWidth=270`、`clientWidth=270`），跳板行与两个下拉均完整可操作。证据：`/tmp/connection-jump-after-modal-1.png`、`/tmp/connection-jump-after-menu.png`、`/tmp/connection-jump-after-390.png`、`/tmp/connection-jump-after-390-menu.png`。本批未保存或创建连接；真实保存与建链仍按既有测试范围。

## 根磁盘占用百分比统一（2026-10-21，本地 CDP）

修复前本机 `Nexus 本机` 显示约 72%，同根分区的 `pve_debian` 显示约 76%。`df -kP /` 的 Capacity 为 `76%`；两边接口的已用/总容量一致，但远端采用 `used / (used + available)`，本机采用 `used / total`。统一后两个 Adapter 共用 `platform/system/disk-percent.ts`。

登录 `honus` 后经 `https://api.honus.top` 实测：`GET /api/v1/system/status` 为 `diskUsed=21686456`、`diskTotal=30154612`、`diskPercent=71.91754282893774`；`GET /api/v1/system/ssh-resources/6`（`pve_debian`）返回完全相同的三项。CDP 仪表盘的本机与 `pve_debian` 根磁盘均显示 `72%`，圆环 `stroke-dashoffset` 均为 `28`，截图 `/tmp/nexus-disk-percent-unified.png`。该结果只覆盖当前根分区和当前测试环境；非根挂载、其他文件系统预留策略及外部主机仍按各自真实采样。

静态：目标文件 ESLint、`pnpm --filter @nexus-terminal/backend build`、根 `pnpm run check`、`pnpm run format:all:check` 与 `git diff --check` 通过。

## 连接管理轻量布局与添加弹窗滚动（2026-10-21，本地 CDP）

`https://api.honus.top/connections` 在 1536×900、1024×768、768×900、390×844、320×568 核对：统计区为四张独立概览卡，名称、类型与数量横向排列，1536/1024 单排、768/390/320 两列且 320px 无内部溢出；卡片无描边，列表九像素间隔、整行圆角底卡无额外边框，页面无横向溢出，六条连接均保留。标签筛选为可访问下拉，实测由“所有标签”切换到“本地”后列表即时变为 0 条、空状态正确，刷新后仍保持“本地”，随后恢复为“所有标签”。导航栏连接管理图标已替换为插头；更多菜单为不透明实心面板，背景图与 backdrop 均为 none；测试、编辑、克隆的 ghost 图标背景透明、无阴影和玻璃滤镜。

添加新连接弹窗在 1536×900 与 390×844 均限制在视口内，表单内容独立滚动到底，底部“确认添加／取消”和测试说明保持可见；桌面 fieldset 可滚动 442px，移动端可滚动 523px，滚轮输入后 `scrollTop` 从 0 变为 400，脚本模式开关以既有 UiSwitch 呈现，控制台无错误。证据：`/tmp/connections-v4-{1536,1024,768,390,320}.png`、`/tmp/connections-v4-more-1536.png`、`/tmp/connection-modal-v3c-{top,bottom}-1536.png`、`/tmp/connection-modal-v3c-{top,bottom}-390.png`。Frontend build、根 `pnpm run check`、全量 `format:all:check` 与 `git diff --check` 通过。

## Backend Pino与网络Toast/终端失败等待（2026-10-21，待远程）

Backend由NativeLogger切换Platform PinoLogger，原Logger及Operations应用链不变；前后端均为catalog Pino9.14.0。后端同步stderr、白名单time/severity/code/facts、32facts/16KiB及级别过滤保持，移除旧实现和安装路径，lock仅新增backend对已有Pino的依赖。

本次源码核对确认日志等级设置没有移除：PreferencesSettingsPanel保留前端选择/保存与BackendLoggingPanel；前端Preferences watcher调用setFrontendLogLevel设置Pino.level，后端GET/PUT /settings/logging经LoggingService的原版本CAS和单调激活调用PinoLogger.setThreshold。后端启动加载持久级别及effectiveLevel读取保留，前端trace/debug/info/warn/error/silent、后端debug/info/warn/error/silent不变。真实保存、重启和冲突/unknown交互仍待远程验证；用户已授权本批相关改动提交推送，无关工作区变更不纳入。

Frontend HTTP传输失败集中由App安装回调汇入一条驻留网络Toast，主动取消不报告；相同种类/文案可见期间去重，关闭后后续错误仍可再提示。失败Toast默认不自动消失，成功/信息/警告仍3秒，显式时长优先。Agent目录自绘失败卡取消；共享操作反馈、Connections初始读取、Preferences及Appearance保留状态围栏，但不对已识别网络故障重复Toast。关闭按钮44×44px、标签/悬停/焦点，窄屏通知容器受视口约束。权限/业务拒绝与unknown写入不改成成功，不自动重放。

按用户后续明确要求，原“未连接”中性行改为Files/Status留白（含内嵌、浮窗及移动状态弹层）。建连失败后Runtime停止自动重复建连及foreground自动重试，保留原原因；Terminal过滤控制字符及1000字符后红字输出原因，空一行显示任意键重试，重试按键不发送远端。显式重试仍核对主机指纹，recoveryRequired的未知所有权继续原恢复限制、不显示任意键提示；晚close/error不覆盖等待重试的原失败原因。

按D17不新增或运行本地行为测试/浏览器/E2E。待远程：并发JSON/binary/Axios超时/断流只有一条网络Toast；取消/路由隐藏不误报；持续15秒以上仍只有一条、手动关闭后后续失败可再提示；非网络拒绝和写入unknown仍可见且不重放；Agent失败后由既有launcher/重新打开触发只读刷新；Toast窄屏/长文本/44px触控/键盘关闭；失败终端红字及空行、任意非修饰键只发起一次重连且不泄露按键、相同失败再次可输出；失败后可长期等待、foreground/晚socket关闭不重连或覆盖原因；主机信任及所有权未知仍安全。Pino真实stderr JSON、无pid/hostname/level额外字段、阈值/silent、边界、多owner恢复及写入失败待远程核对。不把构建当行为通过；未提交推送。

静态结果：根pnpm run check（双端ESLint/类型及Shared构建）、Backend build与Frontend build通过，日志 `/tmp/nexus-toast-pino-{check,backend-build,frontend-build}.log`。全量format:all:check仅由工作区既有 `packages/frontend/src/app/shell/AppHeader.vue` 的Prettier格式问题阻断（`/tmp/nexus-toast-pino-format.log`），未更改该无关文件。最终Toast/终端/Runtime/Pino组件ESLint、最终Frontend重建和涉及文件Prettier均通过，日志 `/tmp/nexus-toast-pino-{final-eslint,final-frontend-build,targeted-format}.log`；git diff --check通过。本批没有行为测试、提交、推送或部署。

用户授权提交推送后，重新执行工作区pnpm run check通过（`/tmp/nexus-pino-precommit-check.log`）；仅暂存本批代码及相关文档段落，排除其它页面、最近连接与测试改动。将暂存区完整导出至 `/tmp/nexus-pino-submit-F0ydjV`，使用独立Shared构建及现有依赖检查实际提交快照，pnpm run check、pnpm run build与pnpm run format:all:check全部通过（`/tmp/nexus-pino-submit-validation.log`）；工作区无关AppHeader格式问题不在提交快照内。日志设置保存、真实网络与终端交互仍按D17待远程回归，不将静态通过称为行为验收。

## Workspace 未连接面板紧凑状态（2026-10-21，待远程）

后续用户已将此处中性未连接提示改为留白，并要求终端红字/空行/任意键重试；当前实现和待验范围以上一节为准，以下为首轮修改和静态证据。

内嵌和浮窗FileManager及桌面/移动弹层StatusMonitor消费原session.state的connected/connecting事实；connected为组件必填输入，全部实际宿主显式传入。未连接时只显示小型中性图标/提示，不显示文件not_connected红字、大块等待数据或持续spinner；连接中与首轮读取为12px小型加载行，不经过Status缩放容器放大。连接后原目录、指标、趋势、错误映射不变；未连接时Files工具栏与scope暂停，终端仍负责具体连接失败和手动重连。拒绝主机信任不会自动信任或重新连接，新增文案同步中英日。

按D17不新增或运行本地行为测试/浏览器专项/E2E。待远程核对：首次未信任主机弹窗等待、拒绝与取消后两个面板均停止加载；idle/error/disconnected中性提示；手动重连等待及成功首轮数据恢复；原有成功连接断线不保留旧目录/指标，失败由终端保留；已连接的文件权限/Files失败与采样失败不被中性状态掩盖；浮窗/内嵌及移动弹层一致，未连接工具栏不可操作，晚到下载/写入意图不交付；窄面板及Status缩放下提示保持紧凑，深浅主题及辅助技术可读。不宣称视觉或真实时序通过；本批未提交推送。

静态结果：根check、Frontend build、最终前端vue-tsc、五组件ESLint、全量format:all:check及git diff --check通过。日志为 `/tmp/nexus-workspace-idle-{check,build,final-types,final-eslint,format}.log`。未运行行为测试，未提交推送。

## Dashboard 多端请求与后端缓存（2026-10-21，待远程）

本地dev删除SSH资源HTTP与本机状态的全局4请求门槛；SSH复用既有按主机/配置的共享在途及结果缓存，TTL改为完成后起算，本机新增成功结果3秒缓存与单一共享采样。SSH资源错误对象仍按原结果缓存策略处理，抛出的失败不缓存；本机采样失败不缓存。每个调用的会话复核、SSH配置复核、真实任务追踪和关闭失败语义保留。不新增整响应缓存，不改前端及诊断接口。

按D17本批不新增/运行行为测试或收集E2E，仅做静态验证；用户仅授权本地dev修复，不提交、推送或部署。待远程覆盖：至少9个不同有效登录会话同时等待两个入口，同主机只派发一次采样；缓存期内直接复用，慢采样完成后保留完整TTL，过期并发只采一次；本机失败后下一请求可重采；SSH配置/凭据修改、删除及缓存重置不交付旧配置结果；缓存命中与等待中撤销会话均拒绝；取消一个HTTP等待不停止其它调用共享的采样；10秒/120秒等待超时后任务仍归原owner，停机禁止新采样及缓存回填并汇总真实失败。不据此宣称多端实测通过。

静态结果：Backend check/build（含Shared build）、两Service ESLint/Prettier、根pnpm run check、全量format:all:check及git diff --check通过。日志为 `/tmp/nexus-status-cache-{check,build,root-check,format}.log`。未运行行为测试。用户随后授权仅提交本批相关改动，不推送或部署。

## SSH 长连接观测容量（待远程）

交付授权：用户随后明确要求提交与推送本批监控修改；既有未验范围不变，不部署或额外触发远程任务。

2026-10-21 首轮源码核对发现，状态采样清理失败后 run 和 Workspace 正确保留原任务，但 startStatus 的 finally 仍按周期继续采样；连续清理失败会占满原有8个共享名额并以 limit_exceeded 覆盖原始 operation_unknown。先在具名清理失败分支停止订阅后再报告原始安全失败，保留原资源、任务及关闭失败汇总。随后用户明确要求9个终端不能因观测总数被拒绝，本轮删除 run 的 tasks.size >= 8 准入分支，不提高为另一个固定数字；保留原45秒期限、串行采样、授权、取消和清理证据。Dashboard请求级并发、协议输出容量和Agent机器操作预算不变。

按 D17 本地只进行源码、类型、格式和构建检查，不新增或执行行为测试。待远程覆盖：至少9个真实Workspace同步发起并保持采样，须确保9个采样实际同时在途而非只有9条空闲终端连接；9路与Dashboard/Docker混合不因全局任务数拒绝；单Workspace长时间串行不重叠；首次清理失败后只报告一次operation_unknown、不再自动派发采样，其它Workspace仍可采样；stop/断开/停机与失败并发时baseline仅在原采样结算后清除、未确认任务保留且停机仍汇总失败；普通读取失败后恢复及输出容量拒绝仍正常。现场触发条件及SSH关闭失败技术原因尚未复现，不以静态检查宣称真实长连接验收通过。代码生效需正常交付及重启，不自动修改运行中进程或释放未知资源。

静态结果：Backend check/build（含 Shared build）、变更代码 ESLint、涉及文件 Prettier 与 git diff --check 通过。根 check 与全量格式均被既有 DashboardPage.vue 的133/137/149行声明空行错误阻断，未修改其它工作区代码。日志为 `/tmp/nexus-observation-capacity-{check,format,backend-check,build}.log`；本批未提交、推送、部署或触发远程任务。

取消全局任务上限后重新执行：Backend check/build（含Shared build）、变更代码ESLint、涉及文件Prettier及git diff --check均通过；根check/全量格式仍由上述无关DashboardPage.vue的三处空行错误阻断。新日志为 `/tmp/nexus-observation-unlimited-{check,format,backend-check,build}.log`。未运行行为测试，尚未提交、推送或部署。

## 服务端最近连接与仪表盘排序（2026-10-21，本地 CDP）

子任务先在 `/home/honus/nexus-terminal-recent` 完成，随后合入主工作区。连接列表与单项的 `lastConnectedAt` 改为必填毫秒/null，后台只在 PTY 建立或桌面 guacd ready 后持久记录，前端删除本地 recent/markConnected 并改为成功后只读刷新。仪表盘默认按最近使用降序，可选名称、类型、修改时间或创建时间；名称/类型切换时默认升序，时间字段默认降序。独立“最近连接”区块删除，最近使用信息并入连接卡片，摘要标签改为“SSH 检测”。

源码审核覆盖 Shared codec、Targets 的 storage/Model/public/HTTP 投影、初始 v1 精确签名、Remote 两类成功/取消/关闭链、Frontend API/mapper/Store/runtime，以及现有测试消费者。时间允许晚于配置 updatedAt，但不能早于 createdAt；历史写入不推进配置版本，SQL 同时核对 id/version/createdAt/type，旧结果或较小时间不覆盖新事实。

`https://api.honus.top` 本地 CDP 实测：打开 `akko` SSH 后 API 返回新的毫秒 `lastConnectedAt`，返回仪表盘该连接自动排到首位并显示“39 秒钟前”；名称排序为 A→Z，切回最近使用为降序；后端重启后重新加载仍读到同一时间并保持首位。通过 CDP 路由拦截临时令 `dashboardShowRemoteResources=false` 核对了检测关闭态，摘要显示 `6 / 连接总数 / — / SSH 检测`，区块徽标显示“检测关闭”，SSH 卡片提供“前往设置”；未修改真实账号设置。本机资源随后按重构前样式并入顶部概览：桌面移除独立卡片外框，以竖向分隔线与连接摘要同排；700px 以下恢复上下排列并改用细分隔线。1440×900、1024×768、768×900 下三项指标保持单排且页面无横向溢出，390×844 下资源指标仍在同一行、摘要与资源上下排列；1440×900、1024×768 页面无纵向滚动，768×900、390×844 允许纵向滚动，六张连接卡和五张活动卡均保留。证据：`/tmp/dashboard-recent-1440.png`、`/tmp/dashboard-recent-1024.png`、`/tmp/dashboard-recent-768.png`、`/tmp/dashboard-recent-390.png`、`/tmp/dashboard-after-ssh-connect.png`、`/tmp/dashboard-detection-off.png`、`/tmp/dashboard-local-ref-1440.png`、`/tmp/dashboard-local-ref-1024.png`、`/tmp/dashboard-local-ref-768.png`、`/tmp/dashboard-local-ref-390.png`。

Shared build、根 `pnpm run check`、Backend/Frontend build、`pnpm run format:all:check` 与 `git diff --check` 通过。按 D14 保持唯一初始 v1；本地测试库在备份后更新安装标记，并把旧桌面秒时间规范为毫秒，该开发环境处理不构成产品迁移。RDP/VNC 成功建连、跨浏览器持久读取、克隆/导入初始 null、备份往返、配置变更与并发单调写入、存储失败/未知提交、浅色主题和扩大视口组合仍待回归，不把本轮 CDP 与静态结果扩大为完整验收。

开发前读取 [AGENTS](../AGENTS.md)，产品要求见 [USAGE](../USAGE.md)，当前工作见 [PLAN](../PLAN.md)。本文维护实际验证入口、覆盖边界和验收证据。

## 仪表盘类型分区、环形指标与等高卡片（2026-10-21，本地 CDP）

Dashboard 连接区改为按实际存在的 SSH/RDP/VNC 类型分区，筛选后没有内容的类型不渲染标题。SSH 卡片使用 CPU、内存、根磁盘环形指标；环形 `stroke-dasharray: 100`，进度偏移取 `100 - 百分比`，缺测显示 `—` 而非补零。状态下方以小字号展示上次连接相对时间与本次刷新时刻，以细竖线分隔；SSH 卡片高 `188px`，资源成功、等待、检测关闭和读取失败共用相同宽高。RDP/VNC 改为 `76px` 紧凑卡片，只保留连接信息、状态与上次连接时间，删除底部资源占位图标区，不混入 SSH 资源指标。

`https://api.honus.top` CDP 在 1536×762 及窄屏核对：五张 SSH 卡片高度均为 188px，RDP 卡片为 76px，宽度一致；状态下方时间为“相对时间 | HH:mm:ss”且无横向溢出，卡片无内部溢出；CPU/内存/磁盘偏移分别与显示百分比相符；只有 SSH、RDP 两个实际类型分区出现；窄屏筛选行改为标签、排序、方向、计数四列，管理入口隐藏，页面无横向溢出。返回 Dashboard 时最后一次资源样本继续显示，不在刷新结果到达前跳变为等待态。

独立端口运行完整 Dashboard E2E：`specs/ui/dashboard-workflows.spec.ts` 与 `specs/mobile/dashboard-mobile.spec.ts` 共 8 项通过，覆盖搜索/标签/排序持久化、检测关闭、失败/等待等高、RDP 启动、SSH 资源并发和移动端控件布局。`node tests/frontend/system-overview.integration.mjs` 通过缓存保留、取消晚响应、错误状态与会话清理断言。Frontend build（3925 modules）、ESLint、Prettier 和 `git diff --check` 通过。证据：`/tmp/dashboard-final-1440.png`、`/tmp/dashboard-final-390.png`、`/tmp/dashboard-final-rdp-section.png`；未执行 RDP/VNC 成功建连、浅色主题和全部缩放组合。

## 登录页正式 UI 重构（2026-10-21，本地 CDP）

按用户明确要求将正式 `LoginView` 重构为 `doc/mockups/login.html` 当前设计，保留密码登录、TOTP 二阶段、Passkey、CAPTCHA 插槽、安全错误映射和原路由跳转。右侧取消独立卡片边框、底色与阴影；主题按钮移到右侧面板右上角；普通登录不再显示工作区副标题；登录主按钮改为品牌粉紫纯色、无渐变和位移动效；Passkey 入口始终显示，并移除登录页的 `has-configured` 预探测及对应前端 API/状态。新增文案同步中英日三语。

`https://api.honus.top` 本地 CDP 已验证 1440×900、1024×768、1024×600、768×1024、390×844、320×568 和 844×390 均无页面级横向/纵向溢出；矮横屏使用紧凑双栏，主题按钮与 Passkey 入口完整可见。登录页网络记录只有 needs-setup、status、captcha config，未发起 `/passkey/has-configured`。错误密码返回 401 并显示“用户名、密码或验证码不正确。”且停留登录页；`honus` / `honustest` 返回 200 后跳转仪表盘。密码显隐、记住我、主题切换和 localStorage 持久化均正常。Passkey 点击后 authentication-options 返回 200 并进入浏览器认证等待；本次未配置虚拟凭据，不把该结果扩大为 Passkey 登录成功。测试环境未启用 2FA/CAPTCHA，二者只核对原调用链与插槽保留。

证据：`/tmp/login-passkey-1440x900.png`、`/tmp/login-passkey-390x844.png`、`/tmp/login-passkey-844x390.png`、`/tmp/login-button-1440-light.png`、`/tmp/login-button-1440-dark.png`、`/tmp/login-button-390-light.png`、`/tmp/login-final-1440-light.png`、`/tmp/login-final-1440-dark.png`、`/tmp/login-final-390-light.png`、`/tmp/login-final-844x390-light.png`、`/tmp/login-wrong-password.png`、`/tmp/login-correct-password.png`。移除 discovery 后再次执行 `honus` / `honustest` 登录，401/200 分支与跳转保持。静态结果：Node 22.23.1 / pnpm 11.26.0，根 `pnpm run check`、`pnpm run format:all:check`、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 均 exit 0；未运行 `tests/frontend/auth.integration.mjs`，不把静态与本次 CDP 结果扩大为完整认证回归。

窄屏自适应补测：使用同一 `https://api.honus.top` CDP 环境，在不超过 560px 的窄屏隐藏品牌图片区，仅保留垂直居中的登录表单，并在标题上方显示 64px 项目图标；主题按钮固定在右上角。430×932、390×844、360×780、320×568 的登录卡顶部位于 222.9、178.9、151.4、58.4px，卡高为 486.2、486.2、477.2、449.2px，深浅色均无横向溢出或控件裁切；320×568 错误密码态文档高 568px，无需额外滚动。560×800 仍显示图标，561×800 起隐藏图标并恢复品牌区；600×760、768×1024、900×800、844×390、812×375 保持品牌区与原布局。布局调整后以 `honus` / `honustest` 登录仍成功跳转。该轮只调整 `LoginView` 响应式样式与产品说明，未改认证请求、Shared 契约或登录逻辑。

证据：`/tmp/narrow-inspect-430.png`、`/tmp/narrow-inspect-390.png`、`/tmp/narrow-inspect-360.png`、`/tmp/narrow-inspect-320.png`、`/tmp/narrow-inspect-768.png`、`/tmp/narrow-inspect-844.png`、`/tmp/narrow-dark-430x932.png`、`/tmp/narrow-dark-390x844.png`、`/tmp/narrow-dark-320x568.png`、`/tmp/narrow-dark-768x1024.png`、`/tmp/narrow-dark-844x390.png`、`/tmp/narrow-error-320x568.png`、`/tmp/login-success-390x844.png`、`/tmp/login-breakpoint-560x800.png`、`/tmp/login-breakpoint-561x800.png`、`/tmp/login-breakpoint-600x760.png`、`/tmp/login-breakpoint-900x800.png`。

登录切换补测：在 `https://api.honus.top` 用 CDP 将 DashboardPage 懒加载延迟 900ms。修复前导航栏在 `/login` 上提前出现，逐帧记录到约 1.8 秒登录页与导航栏共存；修复后 148 个登录页帧均只有登录界面，首个 `/` 帧才同时出现仪表盘与导航栏。`tests/e2e/specs/auth/setup-login.spec.ts` 的登录用例加入同样的延迟与逐帧断言；因默认 `3001` 已被现有测试环境占用，改用独立端口运行完整 `setup-login.spec.ts`，6 项全部通过（23.6s）。证据：`/tmp/login-transition-after-baseline.png`、`/tmp/login-transition-fixed.png`。

## 目录预读50ms与上级目录（待远程）

2026-10-21 将 Browser 两处预读定时统一到50ms常量；“..”行的鼠标进入和键盘定位调用同一预读队列，离开行取消排队。父路径复用既有parentOf，根目录不预读自身；点击仍走原goParent，缓存、在途合并、失败/失效隔离和150ms spinner不变。

待远程验证直接进入深目录后对未缓存父目录的悬停/键盘预读、50ms前离开不派发、返回父目录复用在途请求/缓存、根目录不增加读取，以及普通目录原回归。既有3项缓存E2E可覆盖通用预读和合并，但尚无本次上级目录专项的执行证据。D17仅静态，不新增或运行本地行为测试，本轮已获提交推送授权，不额外触发远程任务或部署。

静态结果：根 `pnpm run check`、`pnpm run format:all:check`、`pnpm --filter @nexus-terminal/frontend build` 和 `git diff --check` 均 exit 0；日志为 `/tmp/nexus-parent-prefetch-{check,format,build}.log`。源码核对两个调度入口共用50ms、父路径与点击目标一致、鼠标/键盘均接入、根目录不预读自身，以及原权限/单任务/缓存失效约束不变。静态不等于已验证真实交互时序。

## 文件管理器连接中展示（待远程）

2026-10-21 源码定位：WorkspaceRuntimeSession.runConnect 在首次握手前调用 markCapabilitiesDisconnected，Files 缓存失效订阅因 not_connected 清列表并设置错误；此时 FileManager 原先仅判断 browser.loading/error，无法区分真正失败与 SSH 正在连接。连接成功后的目录预热仍会正常清错加载，因此现场表现为刚连接期间短暂显示错误。

现由两个实际宿主同步传入 idle/connecting/reconnecting 的连接等待状态，FileManager 将其与目录读取合并展示加载，连接中暂停工具栏和原 view scope。连接成功后继续使用原目录读取，error/disconnected 与真实 Files 错误仍走原失败提示；不修改 Channel 准入、超时、缓存失效或服务端协议。

待远程覆盖慢首次连接/主机密钥确认等待时只显示加载且不派发文件操作、成功后展示目录、连接失败/取消后不常驻加载、内嵌与浮窗一致、重连和 Files ready 延迟/失败。按 D17 本批仅做源码、类型、格式和构建检查，不新增或运行本地行为测试；本轮已获提交推送授权，不额外触发远程任务；旧提交 E2E 不自动证明本次展示修复已通过。

静态验收：根 `pnpm run check`、`pnpm run format:all:check`、变更组件 ESLint、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 均 exit 0；日志为 `/tmp/nexus-files-connecting-{check,format,build}.log`。源码复审覆盖两个宿主、连接与目录读取的合并加载、真实失败不被吞掉、视图暂停及拖放异步结果/失败在原 permission 下交付。产品说明已同步 USAGE，未将静态结果扩大为现场或远程行为 PASS。

## 镜像发布依赖审计（2026-10-21）

[E2E Actions 39528858672](https://github.com/0honus0/nexus-terminal/actions/runs/39528858672) 的被测 SHA 为 `1df0ee036e66d253c0bdeb812f1934f7a98e0391`，八组 Playwright、检查/格式/构建、Docker smoke、runner image 与耗时统计均 success；可选截图 skipped。逐组原日志的通过数为48（47+1）／42／54（52+1+1）／61／46／56／79／69，合计455项；新增的4项文件管理器修复用例及3项缓存用例全部通过。原日志保存在 `/tmp/nexus-e2e-39528858672.log`，不扩大为未执行的权限/断线等组合或本地未提交 UI/Agent 修改已验收。

[Publish Actions 39529899552](https://github.com/0honus0/nexus-terminal/actions/runs/39529899552) 使用 `164823c2e8b5bf26e04e909de066e5b73aec27bd`，相对被测提交只更新 `scripts/e2e/duration-estimates.json`。失败发生于 `Prepare publication / Audit production dependencies`，`pnpm audit --prod --audit-level=high` 返回1；镜像构建和推送 job 均未启动，不是 E2E、GHCR 登录或 Docker 构建失败。

实际阻断项为 `follow-redirects@1.16.0` 的 GHSA-q3jh-wrc6-jgq8、GHSA-8r9p-f939-6h3c，以及 `vite@8.3.2` 的 GHSA-587h-7wmj-h5pm。Vite 虽声明为开发依赖，也通过 Tailwind/Vue Router 的依赖图进入生产审计，不能简单用调整依赖分类绕过。失败日志为 `/tmp/nexus-publish-39529899552-failed.log`。

本批将 Vite 最低版本提高为 `^8.3.4`，目标更新锁定 `vite@8.3.4`、`follow-redirects@1.16.1` 及 Vite 的实际 PostCSS/nanoid 子依赖；保留原发布审计等级和 workflow。`pnpm audit --prod --audit-level=high`、`pnpm install --frozen-lockfile`、根 `pnpm run check`、`pnpm run format:all:check`、Frontend build 与 `git diff --check` 均 exit 0。审计仍有1项 moderate（`@modelcontextprotocol/client`），high/critical 为0，不宣称全部漏洞清零。日志为 `/tmp/nexus-publish-{deps-update,audit,install,check,format,build}.log`，结构化审计为 `/tmp/nexus-publish-audit.json`。本轮已获提交与推送授权；未额外触发远程工作流或部署，新依赖图不继承旧 E2E 的行为结论。

## 目录切换缓存回归（已远程验收）

2026-10-21 按用户要求新增会话内5分钟目录快照与意图预读，默认容量20目录/20,000项/约8MiB估算数据；不改Shared/Backend协议、不持久化。新增 `tests/e2e/specs/ssh/file-manager-cache.spec.ts` 的3项真实浏览器/SSH回归已在上述 Actions 的第6组全部通过：

| 场景                          | 有效断言                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 缓存命中、五分钟TTL和显式刷新 | 第一次目录访问捕获真实WS列表请求及成功列表回执；返回新鲜目录不增请求、不显示转圈；手动刷新确实新增请求并显示外部创建文件。浏览器时钟推进121秒仍命中缓存，再推进181秒后必须重新读取并显示外部新增文件；推进前等待已派发Workspace请求结算，不伪造响应或推进后端时钟。 |
| 真实预读与前台在途合并        | 悬停目标目录，受控OPENDIR延迟计数证明预读已派发；当前路径/列表不变且不转圈，其他目录不预读；在途点击只使用同一列表请求，随后进入和返回均显示正确条目。                                                                                                              |
| 写入失效与晚返回隔离          | 先缓存另一目录，启动真实延迟预读，再经New File界面创建文件；核对成功刷新及磁盘精确零字节内容。等预读实际返回后，当前目录仍不变，再进入两目录均要求新增列表请求，证明旧缓存和晚预读未复活。                                                                          |

已有 `file-list-profile.spec.ts` 的大目录场景在每个冷导航样本前显式刷新根目录使缓存失效；仍要求两个大目录各有3次完整列表请求，根目录每样本真实刷新，成功回执全部收敛。延迟OPENDIR计数与捕获的实际请求总数精确相等，避免TTL影响根目录返回次数，也不将缓存命中误算成真实SFTP性能改善；既有虚拟行、排序和末行可达断言不变。

源码复核覆盖：写入派发前/结算后及传输接纳/终态失效、未知结果不重放、旧代次成功和失败不发布、缓存失败抑制重复预读、断线/Files错误清展示并保留具名错误码、预读最大1项/最新候选、在途共用上限8项（含失效代次）、停用/卸载清排队及订阅。已派发只读任务仍跟踪至原Channel结算，前台可复用，不因预读取消破坏共用SFTP。

最终静态验证：根 `pnpm run check`、`pnpm run format:all:check`、Frontend build、变更spec的独立TypeScript及 `git diff --check` 均 exit 0；日志为 `/tmp/nexus-directory-cache-{check,format,build,e2e-types}.log`。上述远程3项场景已通过，LRU/容量边界、断线重连、外部权限变更及传输未知组合仍待验。遵守D17，未运行本地E2E/用例收集；提交推送后的远程 Actions 证据与镜像发布状态见本页上方，不混同为部署已完成。

## 当前验收基线

2026-10-21 文件管理器修复工作区不继承下方旧 SHA 的行为 PASS。源码对照 `75289ef9^` 的 Workspace Files、文本 Document port、SFTP 下载和 ZipDirectoryArchiveAdapter：旧实现保留 16 MiB 文本读取、目录流式 ZIP 和按读任务持有句柄；新实现此前的 readBinary/cancelRead 与目录 ZIP 仍取消共用 SFTP，runAdmitted 随后关闭主 owner，使后续列表、编辑和下载可能变成 not_found。现将二进制读取、目录 ZIP、票据准备及类型探测放入原 owner 跟踪的独立资源，权限拒绝在 Model 映射为 forbidden，前端区分具名失败并捕获打开动作的读取拒绝。

继续沿有效性检查定位到更直接的共因：owned 和 runAdmitted 对 Workspace 也检查 expiresAt，导致两分钟没有文件操作后的首次读取/写入被拒绝；定时回收本已排除 Workspace，两处准入与其政策不一致。现仅独立 HTTP Files 检查 idle TTL，Workspace 保留原生命周期、身份、指纹及关闭检查。这条源码链可解释 HTML 读取拒绝落入错误边界和目录下载 not_found；HTML 现场具体文件/设备及异常尚未提供，不能据此认定语言组件故障或所有现场组合已恢复。

用户随后明确要求补充 E2E，已新增 `tests/e2e/specs/ssh/file-manager-regressions.spec.ts`，4 项用例已在上述 Actions 的第1组全部通过：

| 用例                             | 有效断言                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML/HTM、读取拒绝与目录右键下载 | 浏览器编辑器实际显示 HTML 内容；从已加载列表删除文件后打开，显示 not_found 产品提示；受控 SSH STAT/LSTAT 返回 permission denied 后显示权限提示。失败后仍能刷新目录、右键 Download Folder 并再次打开 HTML；下载成功且 ZIP 解压后的文件名与内容逐项一致，包含嵌套中文路径和零字节文件。 |
| Workspace 闲置超过两分钟         | 实际等待 125 秒，不发送会续期的 workspace.ping、不模拟浏览器时钟、不重连；随后原 Workspace 列目录、读取 HTML、保存并读回精确内容、申请票据并下载精确内容、解压目录并核对内容，最后句柄清零。该例单独设置 180 秒超时。                                                                 |
| 取消在途二进制读取               | SSH READ 延迟计数证明已派发，再取消指定 requestId；要求 cancelRead 返回 true、原读取返回 remote_unavailable、句柄关闭，随后同一原 Workspace 完成完整读写及下载链。                                                                                                                    |
| 中断在途目录 ZIP                 | 通过认证 HTTP 客户端请求真实目录 ZIP，等待 SSH READ 派发后 AbortController 中断；要求 AbortError、句柄关闭，随后同一原 Workspace 完成完整读写及下载链。                                                                                                                               |

fixture 仅新增 `/sftp/stat-deny-prefix`，对指定路径的 STAT/LSTAT 返回真实 SFTP 权限拒绝，finally 清除且隔离基线 reset 同样清除；不改变已有 lstat 专项控制语义。取消用例 finally 恢复 READ 延迟并关闭原 socket、收尾原请求，不通过新会话恢复来掩盖主资源损坏。

新增用例静态验证：根 `pnpm run check`、`pnpm run format:all:check`、变更测试/fixture 的 ESLint、fixture `node --check` 和 `git diff --check` 均 exit 0；另以 Backend 的 TypeScript 对新增 spec 及其依赖执行 `tsc --ignoreConfig --noEmit --skipLibCheck --types node --module nodenext --moduleResolution nodenext --esModuleInterop --target es2022`，exit 0。日志为 `/tmp/nexus-files-e2e-{check,format,lint,types}.log`。未运行用例收集或服务，不替换既有开发进程。

上述4项新增用例已远程通过，仍待补充尚未新增的独立资源 TTL、真实预览关闭的 UI 取消链、普通文本组合、三语提示、身份撤销及独立资源关闭失败。遵守 D17，未运行本地行为测试、浏览器专项及 E2E；远程通过只覆盖实际断言，不代表这些剩余组合已验。

本批 `pnpm run check`、`pnpm run format:all:check`、`pnpm --filter @nexus-terminal/backend build`、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 均 exit 0；日志为 `/tmp/nexus-files-repair-{check,format,backend-build,frontend-build}.log`。源码复审覆盖独立/Workspace TTL 准入、原身份/指纹检查、读取取消、临时资源关闭及失败追踪、打开动作 permission/Session 晚返回保护和三语错误消费者。用户随后明确授权提交与推送；未重启或部署，静态证据不代替上述现场及远程验收。

2026-10-20，canonical [Actions 39445026926](https://github.com/0honus0/nexus-terminal/actions/runs/39445026926)，SHA `ddf5ce0e95c39367977cf08c951ce1e4d63b34ef`：

| 检查                                                          | 结果                                  |
| ------------------------------------------------------------- | ------------------------------------- |
| Playwright shard 1–8                                          | 全部 success，共448项，无flaky        |
| Checks, format, and build                                     | success                               |
| Docker deployment smoke                                       | success                               |
| Prepare E2E runner image / Update Playwright duration balance | success                               |
| Update E2E documentation screenshots                          | skipped（可选截图更新，非功能回归组） |

本轮远程失败修复已收口。此结果适用于该 SHA 的实际运行用例，不证明所有公网服务、物理设备或故障组合。本文整理仅涉及文档，未重新运行本地行为测试。后续提交不能自动继承本 SHA 的行为 PASS。

唯一被测后端是 `packages/backend`；Shared 为双端协议 owner。旧 Backend、Protocol 与 Agent Runner 不再是验收入口。旧测试文件名中的 backend-next 仅是文件名称，实际启动包必须为当前 Backend。

## 未覆盖与恢复条件

| 范围                        | 当前边界与恢复条件                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 公网 Provider、真实模型场景 | 当前受控供应商覆盖不等于公网可用或模型任务成功；需可用凭据、兼容模型及明确调用授权。历史 Agent 人工场景仍见 [场景清单](AGENT_TASK_SCENARIOS.md)，不能按八组成功批量宣布完成。                    |
| 官方新签名插件包            | 隔离签名包/环回仓库通过不证明官方新发布包完整可安装；需实际包及官方信任链。                                                                                                                      |
| 安全硬件                    | 受控 WebAuthn/浏览器场景不代替真实安全密钥、生物识别设备和物理交互。                                                                                                                             |
| RemoteApp 与真实桌面设备    | Windows 普通 RDP 有历史有限实机证据，RemoteApp 当时未配置；需配置实际 RemoteApp 后验收。隔离 xrdp/VNC 与合成触控不代表全部物理输入法、剪贴板权限或触控故障组合。                                 |
| 持久介质与断电              | SIGKILL/受控重启、SQLite 与文件恢复只证明对应故障窗口；真实断电需专用持久介质和可控环境。                                                                                                        |
| 归档保证限制                | 保留原生 zip/unzip/zipinfo/GNU tar；没有远端 helper 或文件系统配额。接受 SFTP 检查到发布间的并发替换窗口，无任务总磁盘硬配额；64 GiB 是声明/事后预算，非实时硬上限。不是待修复功能或已测强隔离。 |
| Codex CLI 与物理终端体验    | 同批/跨 chunk 同步帧、超时、后台恢复及销毁按实际 terminal-output-scheduling 断言核对；真实 Codex CLI 持续计时和手机现场体验未独立确认，需对应程序/设备。不将合成帧覆盖扩写为现场已恢复。         |
| 其他扩大故障组合            | 原始逐项清单的未覆盖组合保留历史事实，不因本轮成功批量标 PASS；新增保证前对照实际 spec/断言及对应运行日志。                                                                                      |

## UI 还原与 SSH 信任回归

本批在上方 SHA 已整轮通过，以下失败历史仅解释修复依据，不作为当前未解决项：

`01c371c2` 的远程 [Actions 39396132264](https://github.com/0honus0/nexus-terminal/actions/runs/39396132264) 已结束，质量门禁与 Docker smoke 通过；Playwright 2/4/7/8 通过，1/3/5/6 失败。失败项共13个，重试不重复计数，含独立 invalid-tool 变体：

| 分组 | 失败范围                                   | 源码修复及下轮判据                                                                                                                                                     |
| ---- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 2项文件搜索取消                            | 会话区和输入表单不压缩到内容最小尺寸以下，允许外层滚动；保留真实取消、句柄关闭与恢复断言。                                                                             |
| 3    | 2项插件管理、4项批量编辑、1项 invalid-tool | 进入实际 tools 分类、经有名称的管理区域读取；备注开关使用实际“Change notes”名称；同一会话布局修复同时解除目标选择遮挡。保留隔离SDK、持久写入、部分失败和未知结果断言。 |
| 5    | 1项失效模型版本                            | 从页面重新进入实际 runtime 分类重新读取，保留失效版本和持久配置不变断言，不依赖正常状态下已移除的恢复按钮。                                                            |
| 6    | 3项执行设置／黑名单／外观                  | 重载后进入 runtime 分类；开关即保存只提交自身字段、保留相邻草稿；外观先注入版本冲突进入真实恢复入口，再保留延迟读取／排队保存及主题持久化断言。                        |

在既有 `ssh/connection.spec.ts` 另补两项远程回归：真实首见／变化主机密钥、取消不写信任且保留原标签、阻止自动重连、用户再次确认后同标签执行真实命令；变化密钥场景另丢弃已成功写入的确认回执，要求只读核对且只写一次。第二轮停于基线准备，第三轮已验证完整确认链。

第二轮 `657603bc`：[Actions 39398382324](https://github.com/0honus0/nexus-terminal/actions/runs/39398382324)，Checks／Docker 通过，Playwright 1/2/3/5/6 通过，4/7/8 失败。首轮13项原失败均已通过；本轮剩4项失败和1项 flaky：

| 分组 | 实际结果与原因                                                             | 当前修复及下轮判据                                                                                               |
| ---- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 4    | 2项 SSH 信任回归基线准备失败；不存在的 pin 删除返回正确的404               | 先只读确认独立基线无 pin，再按场景创建变化密钥；不改产品删除语义，继续验证取消／同标签重连／丢回执。             |
| 7    | 1项非 SSH 创建／批量删除重试通过，首次浏览器回执被导航回收，flaky 门禁失败 | 在原 import 请求交付前捕获真实上游响应，再交付同一回执并严格解码；不重发写入，保留持久字段和批量选择／删除断言。 |
| 8    | 2项 ACP 拒绝／取消用例仍按已移除的内部版本标题定位                         | 按可见名称定位实际卡片并核对 ACP／工作目录；保留持久版本、真实进程、内层授权与取消断言。                         |

第三轮补修仅调整上述测试消费者及证据说明，无产品功能／协议变更；USAGE 对应 SSH 信任、集成卡片和非 SSH 连接章节已核对，无需改写行为。新增的 E-10.6 只记录回执采集的共性约束。未运行本地行为测试或用例收集。静态环境为 `/usr/local/bin/node` v22.23.1、`/usr/local/bin/pnpm` 11.26.0；`pnpm run check` 已通过（`/tmp/nexus-ui-round3-check.log`），只修改测试与文档，未重建产品包。`pnpm run format:all:check` 最终通过（`/tmp/nexus-ui-round3-format-final.log`），`git diff --check` 通过；最初的函数间距错误已由原 ESLint 规则修正，再完整复查通过。

第三轮 `d6b73d254794fed0f76a7ba92e9000248996851d`：[Actions 39401405110](https://github.com/0honus0/nexus-terminal/actions/runs/39401405110) 最终 success，8/8 Playwright、Checks、Docker、runner image 及耗时统计全部通过；可选截图任务 skipped。上述4项失败及1项 flaky 均未再出现。原 `ssh/connection.spec.ts` 两项真实首见／变化密钥回归各一次通过：取消保留标签且不写信任、不自动重连，手动确认后同一标签执行真实命令；变化密钥另验证确认已写入但回执丢失后只读核对，未重复信任写入。ACP denied/cancelled 各一次通过；非 SSH RDP/VNC 创建和批量删除一次通过。原首轮13项失败所在的1/3/5/6组继续通过。

远程日志已读取第4/6/7/8组（本地 `/tmp/nexus-ui-round3-shard{4,6,7,8}.log`）；可追溯证据以 Actions 原 job 日志为准。其余组按实际 job 的 success 记录，不扩大其 spec 覆盖。

### UI 扩展覆盖边界

以下是逐项复核时保留的关注范围，已执行的 spec 以本轮实际断言为准；整轮通过不等于所有组合或像素一致性均已验证。尤其多跳板／批量信任确认排队、等待期间关标签／登出及全部窄屏交互组合没有由新增两项 SSH 用例覆盖：

- Agent 分类导航、提供商卡片与添加／编辑弹窗，模型发现、凭据 keep/replace/clear、原版本冲突、unknown 只读恢复及三语反馈；正常加载不常驻展示读取按钮。
- 实际未信任／变化 Host Key 提示（含跳板的真实 endpoint、批量打开的确认排队），用户核对确认后原标签重连；取消保留标签、不后台重试，关标签和登出撤销确认；确认响应未知只读核对，不重复写入。
- 普通设置自动加载与异常恢复、数据页高级诊断／恢复入口、Modal 焦点恢复及桌面拖拽调整大小。
- MCP／ACP 列表添加／编辑弹窗、取消清草稿、分类隐藏与原请求失效；未知创建保留原输入／键，恢复只读核对，身份失效清理；既有 ACP 实际执行消费者同步弹窗及 UiSelect 定位。
- CAPTCHA 按供应商展开字段／帮助、切换和停用清密钥草稿、显式清除后停用与保存、hostname／CAS／重启语义；执行、Registry 和应用选择卡片样式待桌面／窄屏核对。
- Browser 卡片添加／编辑弹窗、取消不写入、分类／页面隐藏撤销、原版本冲突和未知结果恢复；应用卡内权限、插件发布者折叠。
- Agent 会话侧栏展开／折叠、窄窗遮罩、线程创建／改名／选择及 Run／审批操作；按钮定位同步标题，不依赖内部版本展示。
- 黑名单切换只保存开关，邻近未保存草稿保持独立，失败／冲突／unknown 及登出晚响应；批量编辑分区与 footer、备份／通知原样式及窄屏布局。

本批行为验收仅使用获准的远程 Actions，未运行本地行为测试或用例收集；未覆盖组合继续保留，不恢复已通过的旧失败清单。

## 展示清理与后续远程修复

本轮另收窄工作区／系统偏好、监控、后端日志、布局／焦点、工作区连接列表、导入、主机信任和记忆源选择器的新增刷新入口：正常／初始读取不常驻，失败或待核对时可恢复。保留旧版记忆刷新、插件同步、文件／预览／历史及其他正常操作。监控脚本不再依赖刷新按钮存在判断保存完成；新增按钮变更的根 check、Frontend build、两份前端脚本语法及 diff 检查已通过，日志在 `/tmp/nexus-ui-refresh-{check,build}.log`；完整格式检查通过（`/tmp/nexus-ui-refresh-format.log`），提交前尚未远程验证，后续实际结果见下方失败轮次。

当前工作区移除重构额外增加的常驻技术说明、设置修订展示，并将必要帮助精简为用户操作文字；三语及既有 Targets 隔离脚本的展示断言同步。未改 API／Shared、写入与恢复策略。上一版成功不代表本批已通过行为验收；重点为连接列表／导入、Browser／集成／记忆／Artifact／插件及安全／监控设置的常规、失败恢复与待重启状态。本批 `pnpm run check`、`pnpm run format:all:check`、`pnpm --filter @nexus-terminal/frontend build`、`node --check tests/frontend/targets.integration.mjs` 和 `git diff --check` 均 exit 0；日志在 `/tmp/nexus-ui-prose-{check,format,build}.log`。不运行本地行为测试或用例收集，该提交的远程结果及后续修复见下方。

### 展示清理后的失败轮次与修复

[Actions 39413492909](https://github.com/0honus0/nexus-terminal/actions/runs/39413492909)，SHA `90d5bb6c5a42eaedfedc75a1e1f85e40bc961613`：第7组失败，其余7组、Checks/format/build、Docker deployment smoke 和 runner image 均 success。仅两项失败：

- `ui/connection-non-ssh-bulk.spec.ts`：导入响应200后表单未关闭；trace 显示紧随移除拦截启动的标签请求未完成。现保留原请求拦截直至 UI 消费回执并完成依赖读取，不重发写入。
- `ssh/progress-display-archive-cancel.spec.ts` 的准备阻塞取消场景：取消后目录刷新被拒绝。源码查出压缩准备/声明复查仍使用共享 SFTP，现两处都使用原任务追踪的独立传输资源。失败 trace 无 WS 帧，不能宣称已证明全部运行因果。

修复工作区的 `pnpm run check`、`pnpm run build` 已 exit 0（`/tmp/nexus-refresh-e2e-fix-{check,build}.log`）；完整 `pnpm run format:all:check`、既有配额夹具的 `node --check` 和 diff 检查通过（格式日志 `/tmp/nexus-refresh-e2e-fix-format.log`）。未运行本地行为测试、E2E 或用例收集。修复提交为 `1ebaddfc96875770b940fc7d8690b66273938b21`，下轮这两项均通过；原压缩取消、真实远端目录读取、RDP/VNC 持久化与精确删除断言均保留。

### Agent ACP 取消场景轮次

[Actions 39415763862](https://github.com/0honus0/nexus-terminal/actions/runs/39415763862)，SHA `1ebaddfc96875770b940fc7d8690b66273938b21`：第7组 regular 58项通过（包括上一轮两项修复），独立 ACP cancelled 场景失败；其余7组、Checks/format/build、Docker deployment smoke、runner image 均success。独立场景重试被原实例清理失败阻断，不计成另一个产品场景失败。

trace中原Run创建200，移除拦截发生在18404.925ms；18413.625ms启动的`agent.approvals.list`始终未完成，其他并行读取有响应，UI保留Pending v1且全部运行操作禁用。测试finally另行取消Run之后产生具名执行未知，重试reset据此拒绝；不通过忽略清理或删除隔离来绕过。证据为Actions第7组job `118604334779`及artifact `e2e-shard-7-1`（本地解压`/tmp/nexus-acp-failure-trace`）。

当前修复让ACP创建及Artifact上传的纯回执观察拦截随页面fixture销毁，避免持续轮询期间切换网络匹配；ACP另确认回执对应Run已渲染且取消按钮可用，再推进外部审批。核对其余20处拦截移除的用途；不改产品协议、按钮状态或后台失败语义。全部取消/409/退出及无副作用断言保留。本轮`pnpm run check`、`pnpm run format:all:check`与`git diff --check`均exit 0，日志为`/tmp/nexus-acp-route-{check,format}.log`；仅测试与文档变更，E2E包无build步骤。修复提交`0e425fe20189e8e2079b575af70ec0657c269b67`的[Actions 39417865747](https://github.com/0honus0/nexus-terminal/actions/runs/39417865747)整体success：8/8 Playwright、Checks/format/build、Docker、runner image及耗时统计均通过。第7组regular 58项通过，独立ACP cancelled 1项通过（场景14秒），取消及清理断言未放宽。未运行本地行为测试或用例收集。耗时统计另提交`79d7b97d`，仅更新下一轮分配估计，不作为重新执行的被测SHA。

## 历史证据追溯

已完成施工记录不再作为当前任务。以下链接固定在删除前的已验收 SHA；历史静态、源码审核和行为结果各自只代表原范围：

- [B9 逐文件审核索引（726 条登记，不代表当前 HEAD 全量复审）](https://github.com/0honus0/nexus-terminal/blob/558c4b343ba0ef2316309d2e164b9c6075c47efc/doc/testing/%E5%90%8E%E7%AB%AF%E9%87%8D%E6%9E%84%E6%BA%90%E7%A0%81%E5%AE%A1%E6%A0%B8.md)。
- [B10/F1 逐批范围、四表与未验记录](https://github.com/0honus0/nexus-terminal/blob/558c4b343ba0ef2316309d2e164b9c6075c47efc/doc/testing/%E5%90%8E%E7%AB%AF%E9%87%8D%E6%9E%84%E5%BE%85%E5%AE%9E%E6%9C%BA%E9%AA%8C%E8%AF%81.md)。B10 最终本机统一记录为 66 文件、584/584，仅对应当时快照。
- [重构阶段决定及历史交接](https://github.com/0honus0/nexus-terminal/blob/558c4b343ba0ef2316309d2e164b9c6075c47efc/doc/%E5%90%8E%E7%AB%AF%E9%87%8D%E6%9E%84%E4%B8%8B%E4%B8%80%E9%98%B6%E6%AE%B5%E5%AE%9E%E6%96%BD%E6%96%B9%E6%A1%88.md)。
- [远程修复各轮原 SHA、失败与静态证据](https://github.com/0honus0/nexus-terminal/blob/558c4b343ba0ef2316309d2e164b9c6075c47efc/doc/testing/E2E.md)。历史“当前失败/尚未验收”不得覆盖上方最新成功结果。

### 用例顺序与夹具隔离

每个用例和重试先关闭原 App，再重建 Backend、SSH 与外部夹具基线。关闭失败阻断 reset 并保留现场；各独立重置均等待并汇总失败，不自动重放丢失回执的重置。原实例成功关闭后才恢复故障开关、模型计数、插件目录和浏览器屏障；在途 SSH 操作先有界排空。

rebalance 只改变 spec 分配，不承担清理。刻意产生未知副作用的 Agent 场景使用独立 Playwright/服务生命周期，与所在 shard 无关；不能依赖前序用例、固定分组或强制清理绕过围栏。每个分组内仍为单 worker。

## Structure

- `tests/e2e/specs/auth/` — first-run setup, administrator creation, login, and session establishment.
- `tests/e2e/specs/http/` — HTTP API authentication and protected endpoint flows.
- `tests/e2e/specs/agent/` — Agent Host, Provider, signed Plugin, SSH-only execution, Browser CDP and ACP product flows.
- `tests/e2e/specs/ingress/` — production Nginx ingress regressions exercised against the production-style ingress.
- `tests/e2e/specs/websocket/` — WebSocket upgrade authentication and protocol frame flows.
- `tests/e2e/specs/ui/` — authenticated browser navigation and UI behavior.
- `tests/e2e/specs/ssh/` — real SSH connection and SFTP/File Manager flows.
- `tests/e2e/specs/mobile/` — mobile Workspace, layout, status monitor and touch interaction.
- `tests/e2e/support/` — shared helpers, test servers and the mirrored log reporter.
- `tests/e2e/fixtures/` — isolated backend setup and external service fixtures.
- `tests/e2e/.tmp/` and `tests/e2e/logs/` — generated runtime data and per-test logs, ignored by Git.

The main E2E projects do not depend on `auth` to create shared state. Normal specs initialize an isolated current-v1 database through the real setup API; first-run setup explicitly requests an empty database. This keeps project and spec scheduling independent from first-run setup order.

The SSH project starts a real `ssh2.Server` on `127.0.0.1:22222`. Its SFTP filesystem is isolated under `tests/e2e/.tmp/ssh-root`, so GitHub Actions does not depend on any external SSH host.

The controlled transfer target forwards `127.0.0.1:22225` to that SSH server; override it with `NEXUS_E2E_SSH_TRANSFER_TARGET_PORT`. It provides a distinct endpoint with the same fixture key and filesystem. Native transfer credentials alone use their real private `/tmp/nexus-transfer-<UUID>` directory so exec and SFTP address the same files.

Local cross-server transfer scenarios require `ssh`, `scp`, `rsync` and `sshpass` on the host PATH, matching the E2E runner image. Missing tools must be supplied before running these scenarios, not worked around by weakening transfer assertions.

Run local Playwright invocations sequentially within a checkout: they share fixture services and the report/artifact directories. Select multiple spec files in one invocation rather than overlapping commands; isolated GitHub shard jobs do not share these resources.

Terminal UI coverage uses the rendered font-size state, terminal surface and Workspace-scoped tablist to verify real SSH output, clipboard interaction, scrollback, geometry, font persistence and session cleanup. Mobile HTML background coverage measures actual animation callback spacing, canceled callbacks, CSS/frame suspension while hidden or under reduced motion, and recovery with the same background document; it validates rendering work, not Android device temperature. Appearance coverage uses visible controls, theme names and public appearance API state for preset selection, mobile typography/text effects, background uploads and local/remote HTML theme flows; it does not depend on production test-only attributes.

Wide-touch Pad coverage keeps a desktop user agent and layout while exercising downward drags at empty history, the history boundary and a real alternate-screen input loop. Touch and mouse-wheel recovery are independent scenarios. Wheel recovery observes the scrollbar reaching its bottom before checking the received completion marker: requested Playwright wheel pixels are normalized by browser DPR and xterm and do not imply a particular number of terminal rows. Synthetic touch cancellation and CSS touch-action assertions do not prove native browser pull-to-refresh behavior on a physical device.

`mobile/pad-file-gestures.spec.ts` checks desktop-UA touch file holds with a controlled clock: movement beyond tolerance and pointer cancellation do not open menus, a subsequent hold opens the archive action, a post-hold click preserves the menu, ZIP creation is observed through SFTP, and mouse right-click remains usable afterward. Synthetic pointer dispatch does not establish physical-device pointer capture or native scrolling behavior.

`mobile/pad-suspended-output.spec.ts` releases a real shell producer only after suspended ownership is available, generates 112MiB of either line logs or single-line output while detached, and checks bounded retained storage, the latest screen, original shell identity, input and historical dragging after browser recovery. It does not seed those bytes into a log file and does not establish an unlimited output-rate or long-duration suspend guarantee.

`mobile/pad-tui-redraw.spec.ts` uses a remote alternate-screen input loop to show old header/footer rows, Chinese wide characters and explicit true-color background cells before each viewport change. Independent full-screen and individual-row erase scenarios require a new frame marker and disappearance of the old text and colored DOM cells. These assertions cover rendered DOM state, not browser compositor pixels. The pipe-based SSH fixture accepts window changes without delivering real PTY SIGWINCH signals, so this does not validate signal-driven application redraw or explain intermittent rendering artifacts on physical Android devices.

Remote-desktop regressions exercise RemoteApp persistence, route-preserving RDP/VNC launch, clipboard exchange, DPI, fullscreen and pointer resize/minimize/restore through the shared window surface. Docker/layout and mobile-preview regressions use public pane controls, existing layout/session/task state and accessible document controls to verify remote commands, compact geometry, layout locking, PDF outline/pinch/panning, preview reset and upload hide/restore/cancellation.

`ssh/suspend-log-compaction.spec.ts` seeds a near-compaction-threshold log in the isolated fixture filesystem, then uses real SSH output and Workspace WebSocket handoff to cross the threshold, resume during continuing output, verify the original shell identity and confirm the physical log was compacted. It avoids sending a 100MiB seed through the terminal renderer and does not substitute a larger ownership lease for storage recovery.

CAPTCHA and proxy lifecycle coverage uses settings headings, form controls and management cards while retaining public-configuration secrecy and explicit credential-update assertions. Panel scaling and advanced mobile touch coverage uses rendered scale state, accessible menus/document actions and the real terminal surface to verify persistence races, archive creation, CodeMirror editing and virtual-keyboard escape sequences without production test markers.

Dashboard and mobile suspend/resume coverage targets host cards, public connection timestamps, tab semantics and suspend identifiers. It retains assertions for independent resource loading, persisted filters, catalog refresh, single-tab recovery, original-shell continuity and older-history touch scrolling.

Test support HTTP controls are limited to deterministic fixture setup and fault injection (for example remote file creation, artificial latency, or SSH availability). Test assertions use the Nexus HTTP/WebSocket/UI/ingress surfaces. Fake external services validate incoming requests directly and return success/failure instead of exposing captured internal request logs to specs.

The Agent preset flow also starts a dedicated real Chromium fixture with loopback CDP and an external context observation endpoint. A model-response barrier holds the Root Run after `browser_session_open`: the spec verifies a new Chromium context exists while the public Run status is `running`, then releases the response, verifies a successful terminal Run and successful tool result, and waits for context count to return to its baseline. A second Run is cancelled while its context is live: the test waits for public `cancelled` status and context reclamation before releasing the barrier, then executes a fresh Run in the same Thread and verifies successful creation, completion and reclamation. A Run with an initial three-request allowance automatically extends within its frozen ceiling while its real Browser context stays live; the held response is released and successful completion reclaims the context. The test restores the original settings after this scenario. Unique provider tool-call identities prevent earlier Thread history from satisfying a later Run's fixture state. This proves Root normal-completion, cancellation/recovery and budget-wait retention Browser behavior, not Child cleanup or late session creation races. The fixture owns only its own Chromium process; it never attaches to a user's browser. The remote launcher allocates isolated control and CDP ports alongside other fixture ports.

Functional/documentation screenshots are declared directly at real E2E checkpoints with `captureFunctionalScreenshot(page, filename)`. Screenshot capture remains opt-in for focused maintenance runs; the canonical E2E workflow does not mutate the repository or commit refreshed screenshots.

Browser approval-wait retention is exercised by opening a real context, proposing a bounded SSH command in `ask` mode, and observing public `awaiting_approval` status with that context still live. Denying or approving the versioned approval resumes the Run; the same context IDs must remain present until the held model response is released. Both branches verify successful completion and context reclamation. This Run's Ledger must contain successful Browser creation and either `APPROVAL_DENIED` or a successful SSH result with the exact fixture output `browser-approval-e2e`. These Root approval scenarios do not establish Child approval behavior.

Cancelling instead of deciding that pending approval must reach public `cancelled` and reclaim the real context. The original approval must become `superseded`; late approval requests using either its original version or its refreshed current version must return HTTP 409, and neither the cancelled Run nor its context may be revived. This exercises immediate terminal cancellation without an active scheduler cleanup fallback; cancellation events must traverse the existing StateCommit post-commit observer.

The automatic-extension scenario also exercises cancellation: the live context must be reclaimed after public `cancelled`. Mailbox budget increases using both the pre-cancellation version and the current cancelled Run version must return HTTP 409, preserving the terminal status and context baseline. Current-version rejection distinguishes terminal-state protection from stale-version protection.

`tests/backend/agent-scenarios/adaptive-execution-budget.scenario.ts` uses real SQLite admission and Native execution to cover a single durable extension under concurrent evaluators, normal completion after expansion, duplicate evidence refusing another extension, concurrent request admission without overshoot, atomic rejection of an oversized tool batch, current Goal／Plan and resource projection, and a failed summary retaining a partial result／checkpoint. These deterministic assertions do not establish live SSH deployment success or an optimal numerical cap for every task.

Child normal-completion coverage delegates to a profile explicitly granted `browser.read`, observes a real context while the Child model response is held, then releases completion and waits for a successful parent Run and context reclamation. The public Subagent record must contain exactly the expected completed Child with a Runtime distinct from its parent. The deterministic Child response projects its actual Browser tool result so the spec can associate the session's Run and Runtime identities with that public Child record and confirm successful creation. This proves Child-created context cleanup at parent Run completion, not cleanup immediately at Child completion while the parent remains active, or cancellation during session creation.

The same delegation flow also cancels the parent while the Child's real context is live and its model response remains held. Both public parent and Child statuses must become `cancelled`, and Chromium contexts must return to baseline before the fixture releases the response. This guards Root execution-slot handoff across model/tool rounds and join waiting: a cancelled Child alone does not satisfy the assertion when the parent remains `cancelling`. It covers cancellation after context creation, not cancellation during asynchronous session creation.

The retired Runner process-group cancellation harness was removed with Agent Workspace. Current SSH session/job cancellation and remote process settlement are exercised by SSH-specific cases; their evidence does not imply the removed Runner process-tree semantics.

Creation-race coverage uses a loopback WebSocket proxy in the dedicated Chromium fixture. It forwards real CDP text frames and holds the response to `Browser.setDownloadBehavior`, after the context/page exists but before session registration completes. Separate Root and Child scenarios observe the held response and live context, cancel the parent Run, release the response, and require public `cancelled` plus context reclamation (and a cancelled Child for delegation). This covers that specific late-initialization window, not every asynchronous creation boundary or an independently cancelled Child while its parent stays running. A safety deadline releases abandoned fixture responses; successful assertions explicitly release them rather than relying on the deadline. No production testing endpoint is added.

Independent Child cancellation is exercised both with a live Browser context and with its final initialization response held. The parent explicitly calls `collaboration_subagent_join` and yields its runtime slot before the Child starts. The public versioned Subagent cancel endpoint must return a cancelled delegation without cancelling the parent. A separate provider response barrier observes the resumed parent still `running`; releasing it must allow successful parent completion with the Child still cancelled and Chromium contexts back at baseline. This verifies Root join parking and wake-up as well as final Run-owned cleanup, not immediate context reclamation while the parent remains active.

## Logs

Every test receives its own text log. The archive layout mirrors the test source layout, for example:

```text
tests/e2e/specs/ssh/file-manager-navigation.spec.ts
tests/e2e/logs/ssh/file-manager-navigation/navigates remote directories over real SFTP.log
```

The log records Playwright steps, API/browser actions, stdout/stderr, final status, failure stacks, and attachment paths. Failed GitHub Actions matrix jobs upload logs, Playwright reports, traces, screenshots, and videos in a project-scoped diagnostic artifact.

On GitHub Actions, the mirrored reporter also prints concise live progress to the job log: test start/end, explicit `test.step(...)` start/result, retry number, and duration. Set `E2E_CONSOLE_LOGS=1` to enable the same console output locally without changing the full per-test log files.

## Local commands

当前按 [PLAN D17](../PLAN.md#决定项保留区) 不执行本地行为测试或用例收集；以下仅记录可用入口，不构成执行授权。验收以远程 Actions 为准。

From the repository root:

```bash
pnpm run test:backend
pnpm run test:e2e
pnpm run test:e2e:auth
pnpm run test:e2e:http
pnpm run test:e2e:agent
pnpm run test:e2e:websocket
pnpm run test:e2e:ui
pnpm run test:e2e:ssh
pnpm run test:e2e:mobile
pnpm run test:e2e:list
pnpm run test:e2e:remote -- --project=http specs/http/auth-2fa.spec.ts
pnpm --filter @nexus-terminal/e2e run test:docs
```

GitHub Actions provides the canonical complete delivery evidence. The quality job runs standard lint/type checks, formatting and production builds serially. Push and pull-request runs use eight Playwright runners by default. Manual workflow dispatch can select 6–10 runners. The selected matrix uses `scripts/e2e/duration-estimates.json` and a longest-estimated-spec-first allocator to distribute the seven normal Playwright projects across duration-balanced shards. Each shard job pulls the current prewarmed E2E runner image, links the frozen workspace from its offline pnpm store, deterministically regenerates the same assignment and runs its assigned spec files. New specs without a direct estimate use the median for their Playwright project, then the global median as a fallback. The Docker job restores the repository-pinned Playwright browser, builds the unified Frontend/Backend image with BuildKit cache, and runs `docker-core-no-runner-smoke.sh` with Guacd. Cache hits only avoid unchanged image layers; this job does not build or run an Agent Workspace Runner. Local commands remain useful for listing tests, running focused specs and reproducing failures. Automated dependency updates dispatch this same workflow on their update branch.

For a long-lived remote development host that may already be serving Nexus on the default E2E ports, use `pnpm run test:e2e:remote -- <Playwright args>`. The remote launcher keeps explicit `NEXUS_E2E_*_PORT` overrides, dynamically reserves unique loopback ports for every unset E2E service, and invokes the installed `pnpm` executable directly. It enforces the repository Node engine before starting tests. This helper is for focused remote reproduction; it does not replace the canonical GitHub Actions evidence.

The old standalone Agent Runner smoke and Runner-enabled full-deployment smoke were removed together with the production Agent Workspace/Runner. The preserved `tests/e2e/Dockerfile.runner` is solely a Playwright/CI tool image; `scripts/e2e/build-runner-image.sh` builds and verifies its offline pnpm cache before publication. The current Docker production check is `scripts/e2e/docker-core-no-runner-smoke.sh`.

## CI balanced shards

Release publication validates a complete successful run of this workflow for the current main SHA, so every selected shard and Docker smoke must pass together; retired per-project check names are not release prerequisites. UI regression locators must use accessible roles, names and existing product state or rendered component classes instead of requiring production-only test markers.

The canonical push/pull-request workflow keeps eight isolated Playwright jobs, but their spec assignments are duration-balanced rather than fixed at one job per project. Manual dispatch can select 6–10 jobs. The allocator covers every spec under `auth`, `http`, `agent`, `websocket`, `ui`, `ssh`, and `mobile` exactly once. Matrix jobs fail directly when their Playwright command fails.

Each job checks out the tested commit inside the current E2E runner image, links the frozen workspace offline, and regenerates the same deterministic shard assignment before running it. The image supplies Node.js Current, pnpm, Chromium and Playwright's system dependencies. Its fingerprint includes a weekly refresh marker; a rebuild pulls the floating base image without build cache to refresh Node and OS packages. Fresh GitHub-hosted runners eliminate local port collisions. The default balance can be inspected locally with `node scripts/e2e/balanced-shards.mjs plan --shards 8`.

Every Playwright shard publishes its successful per-spec runtime after the run. A final aggregation job smooths those observations into `scripts/e2e/duration-estimates.json`; a new spec is added immediately, while an existing estimate changes only when the smoothed value differs by at least two seconds and five percent. Pull-request and manual runs upload the proposed baseline as an artifact without writing either branch. A successful branch push writes a material timing update directly back to the same branch that triggered the workflow. The workflow skips the update if that branch advanced after the tested revision. The generated commit contains `[skip ci]`, so pushing the baseline cannot recursively start another E2E workflow. The next E2E run therefore starts from the latest committed balance while one noisy run cannot completely replace established history.

Before Playwright starts, the workflow fingerprints the runner definition, dependency lockfile, Node, pnpm, and Playwright versions. It anonymously reads only the `nexus-terminal-e2e-runner:latest` manifest/config metadata and compares the embedded fingerprint with the current repository, without logging in to GHCR or downloading image layers. A missing or outdated image triggers GHCR login, rebuild, an exact offline workspace-install verification through an Actions-style bind-mounted checkout, and a push directly as `latest`; an unchanged image skips all four operations. Every Playwright shard pulls `latest` when its job starts and links the frozen workspace from the image's prewarmed offline pnpm store. The image fixes pnpm's effective store with `PNPM_CONFIG_STORE_DIR` and enables its side-effects cache, so a checkout mounted outside the image work directory reuses both downloaded packages and lifecycle outputs. Python and the native compiler toolchain build the optional `ssh2` crypto binding once in the same image layer that removes them and clears the apt metadata afterward; release verification confirms those build-only tools are absent and rejects an image if a fresh mounted checkout tries to run the build again. If another branch replaces `latest` before a shard starts, or a fork pull request cannot update the repository package, the shard detects the fingerprint mismatch and downloads only dependencies and the headless browser revision absent from the image. The slim image includes only Chromium's headless shell, its system dependencies, and the command-line tools used by the suite, so normal E2E runs do not reinstall the browser or carry the full headed Chromium package.

Manual workflow dispatch exposes a `refresh_screenshots` option. When enabled, the normal duration-balanced E2E shards capture the declared documentation checkpoints during the same test run and upload their PNG artifacts. After quality checks, every Playwright shard, and Docker smoke succeed, a final job merges the produced screenshots into `doc/imgs/e2e/` and pushes a single `docs(e2e): refresh screenshots [skip ci]` commit back to the selected branch. It skips the write if that branch advanced after the tested revision, and `[skip ci]` prevents the generated commit from starting another E2E workflow.

Production-ingress coverage can still be run explicitly against a prepared production-style endpoint:

```bash
NEXUS_PRODUCTION_BASE_URL=http://127.0.0.1:18113 pnpm --filter @nexus-terminal/e2e run test:ingress
```

## Regression coverage

Agent task-oriented coverage is planned in [AGENT_TASK_SCENARIOS.md](AGENT_TASK_SCENARIOS.md). Its 81 scenarios are design targets, not a claim that all are implemented or verified.

Agent regression inputs live with executable tests: backend cases in `tests/backend/agent-scenarios`, browser/API cases in `tests/e2e/specs/agent`, and shared mock-model inputs in `tests/e2e/fixtures/agent/regression-inputs.json`. Tests do not parse historical Markdown reports or generated live-run datasets. Raw live-model evidence is retained separately and is not a deterministic pass/fail oracle.

The 2026-10-05 regressions cover fractional memory confidence and file timestamps, file permissions, pre-execution Browser/Workspace rejections, bounded child deadlines, cleanup-safe completion evidence, cancellation settlement, recoverable resource quarantine, cross-tab Thread events, and awaiting-input snapshot restoration. Exact-output tests use a deterministic provider fixture; they do not prove a real model always follows “exactly once” tool instructions. The runtime loop guard bounds repetition but does not infer task completion from a single successful tool result. Real ACP/MCP/plugin services, optional toolchain downloads, extreme-number arithmetic and real-phone animation behavior remain separate environment/quality validation, not resolved product defects.

`specs/mobile/terminal-output-scheduling.spec.ts` defers new animation frames while keeping the page visible and the real SSH transport/timers running, then verifies output consumer credit advances, rows visibly update, successive ANSI timer ticks replace the previous line, and subsequent display/input recover. `specs/ui/terminal-lifecycle.spec.ts` mounts the real TerminalView/xterm with a controlled channel to exercise foreground/background drain before remount, split UTF-8, obsolete PTYs and interactions, stale history pages, slow history cursor reset, ordered background-to-foreground output, viewport recovery with deferred frames, and complete DEC 2026 frames followed immediately by an unfinished frame. The synchronized-frame regression fails without committing the completed frame before the next one reopens synchronization; a render deadline alone does not fix it. These cases do not prove real phone IME behavior, fully frozen browser progress, every physical-browser scheduling fault, or all Codex/OpenCode redraw sequences. `specs/mobile/keyboard-geometry.spec.ts` checks fitted rows, remote resize messages and direct xterm input across keyboard-sized viewport changes; it does not open a real system keyboard.

`specs/agent/event-catchup.spec.ts` exercises the production Agent subscriber with controlled WebSocket events: ordered backlog consumption, duplicate filtering, arrivals while consumption is paused, abort/unsubscribe and reconnect using the consumed cursor. It does not validate real backend durable repository replay or sustained slow-consumer memory bounds.

The editor encoding regression in `specs/ssh/file-preview-editor.spec.ts` checks exact saved UTF-16LE bytes including BOM after selecting LF, not only the success message.

SFTP write-watermark candidate (2026-10-04): changing the upload Writable high watermark from 4 MiB to 8 MiB reduced completion median from 4,439.1 ms to 2,303.2 ms in three disk-backed 16 MiB + 123-byte samples with 30 ms fixture WRITE delay (48.1%); peak pending WRITE rose from 7 to 15. No-delay medians were 482.1 / 492.2 ms with overlapping sample ranges, not evidence of a stable regression. All measured files matched exactly and pending WRITE returned to zero. Protocol regressions passed 5/5. `NEXUS_E2E_UPLOAD_MULTI_LARGE_WRITE_PROFILE=1` exercises four 10 MiB files at 50 ms WRITE delay, including progress hide/restore and complete content checks. `NEXUS_E2E_UPLOAD_LARGE_CANCEL_PROFILE=1` sends half of a 20 MiB payload before cancellation, preserves the original destination, checks temporary-file removal and pending WRITE convergence, then verifies a complete subsequent upload. Sending 10 MiB does not prove that Writable buffering reached its watermark at cancellation.

The larger watermark adds 4 MiB of nominal Writable buffering per active upload (24 MiB additional at six streams, 48 MiB at twelve), not a bound on total process memory. Multi-file correctness is not a measured RSS bound. The first large-cancel candidate run failed in final fixture control reset with `fetch failed / other side closed`; its artifacts are retained. After making this scenario's fixture-control requests use `Connection: close`, both 4 MiB and 8 MiB large-cancel cases passed once without retries or increased timeouts. This removes connection reuse as a variable in those samples but does not establish the original failure's root cause. The watermark candidate still requires repository checks/build and full fixed-SHA acceptance before deployment.

The upload backpressure polling candidate (2→4→8 ms instead of fixed 8 ms) was removed after three baseline and three candidate runs at 300 ms fixture WRITE delay. Completion medians were 41,420.1 / 41,422.4 ms, with browser high-water hits in only 2/3 / 1/3 samples. A single candidate drain observation of 13.1 ms is not evidence of repeatable polling benefit; sampled socket drain is not actual loop wait duration. Sustained/background backpressure coverage remains open.

The delayed file-picker upload probe accepts `NEXUS_E2E_UPLOAD_WRITE_DELAY_MS` (integer 0–750) to override the isolated fixture WRITE delay without changing the file source or production watermarks. A 300 ms calibration on the disk-backed 16 MiB + 123-byte file reached the browser 8 MiB high watermark, unlike previous 30 ms samples. Verify actual high-water hits in each measured sample; fixture WRITE delay is not network latency and a brief browser drain does not establish sustained backpressure or background safety.

Local production-candidate evaluation (2026-10-04): unchanged-checkpoint caching passed three resume samples but did not consistently improve request/response or tail-visible latency and was removed. One-chunk upload prefetch passed three disk-backed 16 MiB + 123-byte samples with exact bytes, but completion median changed from 482.1 ms to 500.8 ms and summed Blob-read median from 236.2 ms to 290.9 ms; it was removed. These small sequential samples reject retaining the candidates, not establish stable regressions or resolve prior browser OOM evidence. Input TextEncoder reuse was also removed: its original three-sample comparison had one reply-order failure and therefore no valid complete performance comparison. Controlled recovery reply-order checks are correctness evidence only, not optimization gains.

The mobile automatic-status-reply recovery case reports live/post-recovery input observation intervals and timestamps for resume requests, replayed queries, DSR replies and observed command enablement. UI interaction and polling are included; these timings do not isolate input encoding cost. The same visible query marker is delivered before and after recovery, so its presence alone cannot establish that the replay was processed or serve as a response-gating barrier. The default case holds the replay query until input is enabled and requires exactly one reply to that query. `NEXUS_E2E_INPUT_RESUME_RESPONSE_GATE=1` instead holds the real reconnect response until a cumulative `terminal.flow` acknowledgement covers the replay frame on the replacement socket: that query must produce no reply, including after activation. Both orders require a fresh post-activation query to receive exactly one reply and a user command to exit the remote loop. The earlier uncontrolled failure is retained as evidence of ambiguous delivery order, not counted as resolved real-device inability to type. Do not compare the controlled delivery orders as input-encoding performance results.

The long-list refresh case in `file-manager-navigation.spec.ts` accepts `NEXUS_E2E_REFRESH_DIRECTORY_DELAY=1` for 60 ms OPENDIR delay instead of zero. Each refresh must confirm the expected delayed-open count, retain sorting, final-entry accessibility and long-filename menu geometry checks, and reset the delay. Reported time includes sorting and scrolling until the target is reachable, not isolated directory-request latency. The external-deleted-directory path-sync case separately verifies refresh falls back to a valid ancestor. These condition comparisons do not establish production optimization gains. Set `M11_03A_EVIDENCE_DIR` to a run-specific directory under `/tmp/opencode` when retaining diagnostic artifacts.

The initial-connection capability profile in `suspend-resume.spec.ts` compares three normal connections with three fixture REALPATH-gated connections. Gated samples require an outstanding REALPATH before real shell output is requested; split printf arguments avoid a command-echo false positive. Connection response and shell round-trip intervals are reported separately, and released initialization must permit directory listing. This verifies optional filesystem initialization does not block initial shell use, complementing ready/error/closed suspended-recovery cases; it is not a production optimization before/after comparison or coverage of every optional capability.

The gated filesystem initialization recovery cases wait for server-reported suspended ownership `available` after closing the old socket before attempting another resume. Client socket closure alone is not the server ownership-release barrier; the earlier immediate-resume failure returned `SUSPENDED_SESSION_OWNED` and is retained as diagnostic evidence. Ready/error/closed outcomes still require real shell output while initialization is blocked. The reported gated timing includes fixture-state polling, not only resume response latency. These cases cover suspended recovery, not all initial connection capabilities.

The extensionless-file save step in `file-preview-editor.spec.ts` accepts `NEXUS_E2E_EDITOR_SAVE_DELAY=1` to inject 60 ms fixture WRITE delay instead of zero. It observes Save click through exact isolated destination content, resets the delay in cleanup, and retains editor reopening, encoding and line-ending regressions. Reported verification time includes UI interaction and polling, not isolated remote WRITE time or Monaco CPU. These small-file samples do not cover large text, save failure recovery or demonstrate an optimization before/after gain.

The repeated-refresh case in `file-list-profile.spec.ts` compares one/five synthetic DOM clicks under 300 ms OPENDIR delay, three samples each, correlating real list requests and responses and requiring new fixture files and the correct final directory. The existing UI navigation queue serializes refreshes, so five clicks must issue five requests with peak pending count one. This measures queue cost, not overlapping requests or a coalescing optimization. The earlier overlap assertion failed because its concurrency assumption was incorrect; changing the expectation follows the diagnosed serial navigation behavior, not a reduced correctness requirement. A production coalescing candidate still needs mutation-during-refresh and navigation-order evidence before adoption.

The browser marking case in `suspend-resume.spec.ts` accepts `NEXUS_E2E_SMALL_SNAPSHOT_PROFILE=1` for 200 output lines instead of 2,000. It reports actual serialized snapshot bytes and correlated prepare/commit send/response intervals, while retaining marked and unmarked shell-input checks. Output line count is not retained snapshot line count: terminal scrollback bounds the captured content. Click-to-frame and click-to-response intervals include UI scheduling, transport and server work, so this size comparison does not isolate serializer CPU or demonstrate production optimization gains.

The existing suspended-log reconciliation Agent scenario also compares 128 real 64 KiB appends with batch sizes 1/16, verifies streamed export hashes and deletion, and reports append completion and subsequent flush separately. Set `NEXUS_LOG_COMPACTION_PROFILE=1` to additionally preseed isolated physical files at 131/132 MiB, append 64 KiB, and compare append-plus-flush across the 132 MiB physical compaction threshold. Physical-size assertions and streamed 100 MiB export hashes preserve the public retention boundary. Use `TMPDIR=/tmp/opencode` for these diagnostic runs; the scenario removes only its own unique fixture directory. Uniform fixture bytes validate retained length/content but not ordering of distinct historical chunks. These disk-backed measurements do not establish PTY throughput, power-loss safety, queue stability at arbitrary output rates or production optimization gains; real marking/output/history recovery remains covered separately in `suspend-resume.spec.ts`.

ZIP diagnostics distinguish remote `transfer.compress` from backend-streamed directory downloads. `archive-cancel-recovery.spec.ts` compares three 0/100 ms remote command-delay samples for a 106,496-byte source, requires exact extracted content via `unzip -p` and remote process exit, and retains cancellation, concurrent isolation and failure recovery cases. `sftp-download.spec.ts` compares three 0/20 ms READ-delay samples for four 256 KiB files through the directory ZIP endpoint, verifies the exact entry set and every extracted byte, disposes HTTP responses and observes pending READ and remote handle convergence. The latter fixture is highly compressible, so it does not establish incompressible-data throughput, compression CPU cost, large-directory memory bounds or streamed-ZIP cancellation safety. Neither condition comparison is production optimization before/after evidence; remote command cancellation does not cover the independent HTTP ZIP owner.

The paused HTTP case in `download-admission.spec.ts` creates a 32 MiB fixture with bounded local buffers and hashes the HTTP body incrementally. It compares three normal reads with three real Node HTTP reader pauses of one second, under 20 ms fixture READ delay. At resume the client must have delivered zero bytes while remote response bytes are positive and below the full file size; remote bytes are also observed at 300 ms. Full length/hash, pending READ convergence and remote handle closure remain required, alongside the existing abort/admission recovery case. Partial remote reads beyond normal completion time support downstream backpressure, but two sampled counters do not establish a stationary queue, per-process memory bounds or exact cleanup timing. The earlier 8 MiB fixture fitted within the tested link buffers and did not enter the intended window; a 300 ms pause alone cannot distinguish backpressure from an unfinished ordinary transfer. This is behavior diagnosis, not production optimization before/after evidence.

`search-network-profile.spec.ts` compares wide, deep and skewed trees with 0/20/80 ms fixture OPENDIR delay and three samples per condition. Nonzero-delay searches must observe 25 delayed directory opens for wide/deep trees and 26 for the skewed tree. Exact complete results, the 500-result truncation boundary, missing-directory failure and subsequent successful search remain asserted. The skewed tree also has a 1,500 ms slow directory. This measures the existing traversal under directory-open waiting, not packet-level network latency or an optimization before/after comparison; sequential depth and slow branches remain dependencies. Nested cleanup resets both directory delays and closes the workspace socket.

`file-list-profile.spec.ts` compares navigation and local sorting for 1,000/5,000-entry directories with bounded rendered rows and reachable final entries. `NEXUS_E2E_DIRECTORY_OPEN_DELAY=1` injects 60 ms at fixture OPENDIR, not at each READDIR response; the `/sftp/readdir-delay` counter must confirm all delayed directory opens, including returns to the fixture root. This isolates directory-open waiting from the existing listing and UI costs; it does not emulate full-link latency or demonstrate production optimization gains. Cleanup resets the fixture delay.

Upload cancellation diagnostics in `upload-protocol.spec.ts` distinguish cancel response, observed terminal event, and verified convergence (pending fixture writes zero, temporary path absent, destination bytes preserved, and subsequent upload succeeds). Convergence timings include polling and content verification, not only backend cleanup. Pending-start cancellation waits for the fixture delayed-stat counter instead of a fixed sleep to establish entry into the metadata window. The existing `workspace/upload-idle-timeout` Agent scenario covers an injected short timeout with an isolated Writable; it does not establish real SSH behavior at the default five-minute idle deadline.

The slow-ACK batch case in `file-upload.spec.ts` accepts `NEXUS_E2E_UPLOAD_BATCH_CORES=1|4|8` to supply browser hardware capability before application startup without changing the production scheduler. Both 1 and 4 select the existing six-stream minimum; 8 selects a twelve-stream ceiling, with a ten-file batch limited by its file count. Diagnostics report actual peak upload sockets and time to all upload-ID-correlated completion events; all ten 64 KiB files are downloaded and compared byte-for-byte, and active upload sockets must converge to zero. The 750 ms per-WRITE fixture delay models a slow-ACK small-file batch, not bandwidth, low-core resource pressure, background scheduling, or large-file performance. Capability-condition comparisons are not production optimization before/after evidence.

`small-upload-profile.spec.ts` measures ready, send-to-final-progress, and final-progress-to-completed intervals with exact destination bytes and no upload `.part` residue. Its default conditions compare 0/60 ms WRITE delay. `NEXUS_E2E_UPLOAD_COMMIT_PROFILE=1` instead keeps WRITE delay zero and compares 0/60 ms STAT/LSTAT delay scoped to `/small-`, asserting actual delayed metadata requests through the fixture counter. These are protocol-observation intervals, not isolated backend CPU timings; metadata delay may affect both preparation and completion. `/sftp/stat-delay` accepts an optional `prefix`; without it the existing pending-start cancellation target remains the default. Both delays are reset and the workspace socket is closed in nested cleanup.

Upload read diagnostics in the delayed file-picker case wrap only slices of the selected filename, report per-chunk Blob read durations, and restore the browser methods in cleanup. `NEXUS_E2E_LARGE_UPLOAD_READ_PROFILE=1` selects a disk-backed 16 MiB + 123-byte file with no injected SFTP write delay and verifies exact bytes directly in the isolated SSH fixture; it omits binary frame decoding/storage and the additional browser download, but CDP events still incur overhead. `NEXUS_E2E_UPLOAD_FILE_READER=1` substitutes FileReader only inside the test probe for a same-condition candidate comparison, not in production. Browser OOM/crash samples are failed evidence, not valid timing medians. Page destruction skips obsolete CDP detachment while fixture delay reset still runs; the normal-path regression does not establish crash-cleanup coverage.

With large-upload profiling, `NEXUS_E2E_UPLOAD_BACKPRESSURE_PROFILE=1` injects 30 ms per SFTP WRITE instead of zero delay. A test-side WebSocket send wrapper and 4 ms sampler observe actual upload socket buffered bytes without modifying the queue, thresholds, or production waiting policy. High-water samples are observations, not distinct backpressure transitions; drain intervals measure sampled time from at least 8 MiB to at most 2 MiB (or socket closure), not exact production wait time. The fixture `/sftp/write-delay` response also reports WRITE request count, requested bytes, current pending requests, and peak pending requests since fixture reset. Counts are fixture-wide, so byte assertions require an otherwise idle, reset fixture; requested bytes do not establish write success without exact destination-byte verification. These diagnostics cover foreground successful transfers, not cancellation, background scheduling, or failure recovery.

For input recovery, run `--project=mobile specs/mobile/suspend-resume-ui.spec.ts --grep 'foreground probes|recovery'`. Healthy foreground probes must not reconnect; dropped probes recover the same Workspace without fresh login. Recovery gates automatic terminal status replies, then handles server replay and fresh queries. The post-recovery shell marker is split to prevent input echo from satisfying it. Synthetic foreground events and a routed WebSocket do not reproduce real device suspension, OS OOM, or establish the cause of an incident on a deployed server.

The bounded-window resume UI case also reports click-to-resume-request, response, and success-message observation separately. Compare three samples normally and with `NEXUS_E2E_RESUME_FILESYSTEM_GATE=1`; the latter verifies a pending fixture REALPATH request before releasing it after terminal activation. These observations include browser scheduling and Playwright polling, not pure activation CPU time. Both modes retain historical content and post-history shell-result assertions; release the fixture barrier in cleanup.

`specs/ssh/suspend-resume.spec.ts --grep 'initialization is gated'` uses the isolated SSH fixture's REALPATH barrier and pending-request count to prove that SFTP initialization is actually blocked. Before releasing it, resume must acknowledge committed ownership and a real shell command must produce its result. The scenarios then verify filesystem ready, filesystem permission failure without terminal loss, and close-before-release followed by a second successful resume. This protocol evidence does not measure browser paint or prove every cause of a delayed connecting indicator on a real device.

The delayed file-picker case in `specs/ssh/file-upload.spec.ts` observes upload WebSocket binary-frame timestamps/byte totals and the completion event through browser CDP, while retaining exact remote-byte verification and target refresh. Use `--grep 'file picker uploads a delayed file' --repeat-each=3` for independent samples. Its 786,555-byte payload does not exercise the browser's 8 MiB bufferedAmount high-water threshold. Frame timestamps are send observations, not remote write acknowledgements; completion time includes fixture per-SFTP-write delays, verification, and commit rather than isolating any one phase. No upload chunk/buffer settings or timeouts are changed by this diagnostic.

Directory and search result snapshots use shallow reactive array replacement, not per-entry reactive metadata mutation. Validate this path with `specs/ssh/file-list-profile.spec.ts`, `specs/ssh/file-list-sort.spec.ts`, and `specs/ssh/file-manager-navigation.spec.ts`, retaining remote refresh, replacement search results, natural sorting, and virtualized last-entry access. Compare diagnostic timing samples without adding speed thresholds; frame scheduling and fixture metadata overhead can obscure gains, particularly for smaller lists.

The bounded-window UI history case in `specs/ssh/suspend-resume.spec.ts` logs resume-click-to-visible-tail and, separately, real shell round-trip time after history browsing and returning to the live tail. It does not report a combined click-to-usable duration across the intervening browsing steps. The round-trip output marker is split in the command so echoed input alone cannot satisfy the output assertion. Existing lazy paging, earliest-history access, return-to-live-tail, and cursor-reset checks remain before sending the new command, which changes the terminal state. Use `--grep 'resumed terminal pages older history through a bounded window' --repeat-each=3` for independent samples. Measurements include Playwright actions/polling and local fixture behavior; DOM text visibility is not a compositor paint measurement, and these samples do not cover mobile, background tabs, or weak networks.

The interactive suspend-mark case in `specs/ssh/suspend-resume.spec.ts` produces 2,000 real shell output lines before marking through the UI, then observes outgoing snapshot byte counts and click-to-request/click-to-response times for both `suspend.prepare` and `suspend.commit` through browser CDP. It retains attached-tab interactivity and unmark/live-shell checks. Use `--grep 'marking suspend keeps the UI tab interactive' --repeat-each=3` for independent samples. Click-to-request includes UI scheduling, pending-output drain, and serialization; commit timings also include the preceding prepare phase and are not isolated serializer CPU time. This does not measure recovery painting or prove preservation of every snapshot line.

The cached-tail/history-paging case in `specs/ssh/suspend-resume.spec.ts` logs submission of a preconstructed 665,650-byte snapshot, resume response time, and per-page bytes/latency. It verifies retrieval of all 5,200 fixture lines, cursor reset replay consistency, and bounded small-page reads. Use `--grep 'resume sends only the newest cached tail' --repeat-each=3` for independent samples. These are local protocol diagnostics, not browser snapshot serialization/rendering measurements or public-network guarantees; no additional timing thresholds are imposed.

The sustained-output case in `specs/ssh/terminal-ui.spec.ts` retains parser-consumption and subsequent real shell round-trip assertions while logging command-to-visible-completion time, cumulative `terminal.flow` acknowledgements, and browser long tasks. These diagnostics do not isolate parser time, identify the function responsible for a long task, or prove byte-for-byte output integrity. For three independent performance samples, run the case with `--grep 'terminal parser acknowledges sustained output' --repeat-each=3`; timings are not pass thresholds. This profile does not cover background tabs, reconnect, snapshot serialization, or history paging.

`specs/ssh/file-list-profile.spec.ts` measures real SFTP-backed navigation to the first visible row and browser sort-to-paint over three samples for 1,000/5,000 entries. It checks bounded rendered rows and access to the last entry after scrolling, without timing thresholds. The SSH fixture returns at most 128 entries per `READDIR` response until EOF rather than emitting one potentially oversized NAME packet. Fixture OPENDIR still performs sequential local metadata reads, so navigation timings are not ordinary SSH-server performance guarantees. The profile does not isolate network, decoding, reactive sorting, and rendering costs.

`specs/ssh/file-list-sort.spec.ts` verifies natural numeric/multilingual name ordering, case-insensitive equivalence, and directory precedence in both directions through a real SFTP-backed File Manager. Browser-local comparator profiling compares 1,000/10,000 names over three samples and checks identical complete ordering; timings are diagnostic, not CI speed thresholds or end-to-end large-directory latency guarantees. Run alongside `specs/ssh/file-manager-navigation.spec.ts` to retain refresh, navigation, long-list actionability, and terminal path-sync regression coverage.

Actions run `37180354883` failed the real GitHub remote-theme list in shard 8: Playwright trace recorded local HTTP 400 with `Request failed with status code 403` from upstream on both attempts. Upstream body/rate-limit headers were not retained, so rate limiting is not a confirmed cause. E2E shards now receive the workflow's read-only `GITHUB_TOKEN` for the existing authenticated GitHub catalog path; real list/search/download/apply assertions remain. List failures include local status and response body. Local theme UI regression passed 10/10, but workflow-token behavior requires a new complete remote run; this is not acceptance of the failed SHA.

The preparation recovery fixture also requests a valid sibling alongside a blocked parent: the valid directory must remain after failure, and reusing the prepare ID after fixing the parent must succeed. This exercises acknowledged partial success without destructive rollback. The Agent preset-plugin E2E remains part of local regression because the known-failure settlement branch touches the shared mutation guard.

Upload preparation executes sorted depth layers: all workers in a parent layer settle before starting a child layer, with up to eight workers and no new tasks claimed after a failure is observed. A metadata-acknowledged non-directory is a typed conflict; only preparation whose failures are exclusively these conflicts, after all started work drains, reports a known failed mutation that can release its lease. Other failures and lost leases remain conservative quarantine cases; this does not clear pre-existing quarantine. Recovery coverage reuses the same prepare ID after fixing a blocking file. A separate fixture connection exercises denied LSTAT followed by `RESOURCE_QUARANTINED` even after denial removal. Layered candidate nested preparation measured about 1386ms at 80ms operation delay; it does not prove disconnect/mixed-error safety or cancellation during preparation.

`ssh/upload-prepare-profile.spec.ts` measures existing, new sibling and nested directories with three samples at 0/80ms fixture STAT/LSTAT/MKDIR delay, verifies every requested directory, and attaches operation counts. Internal scheduling adds at most one direct parent per requested path before sorting; the prepared destination allowlist and its capacity accounting retain only explicitly requested directories plus the base. At 80ms, 32 nested children under eight parents measured about 1796ms before versus 1388ms after; metadata requests increased from 45 to 50 and mkdir stayed at 41. This trades extra checks for shorter scheduling waits, not fewer I/O operations or a full-WAN speed guarantee. Boundary coverage rejects implicit-parent, sibling and outside-base upload destinations, recovers the same prepare ID after a file blocks the parent path, and starts/cancels an allowed upload with no temporary residue. It does not cover permission failures, mid-prepare cancellation or every capacity boundary.

Corrected-fixture local regression passed 24/24 across small upload, search profiles, download profiles, upload protocol, download admission and binary-read limits. Search median milliseconds (three samples) for wide/deep/mixed-slow trees were 11/27/1504 at 0ms, 96/564/1546 at 20ms, and 335/2067/2067 at 80ms OPENDIR delay. A 1.5s slow directory still sets the mixed-tree completion floor; refill overlaps independent work but cannot eliminate that wait. Current download median aggregate throughput was approximately 74.5MiB/s locally, 35.3/11.3/4.83MiB/s at 20/80/200ms READ delay, and 40.0MiB/s for four streams at 80ms. These are current-implementation measurements, not a fair corrected-fixture before/after comparison or production performance promises.

The test SSH server explicitly enables `TCP_NODELAY`. An isolated 4KiB upload comparison (three samples per 0/60ms WRITE-response delay) found total medians of 447/506ms before versus 12/73ms afterward, with exact remote bytes and no temporary-file residue. This is a fixture transport correction, not a production upload optimization: the production SSH client already enables `TCP_NODELAY`. Earlier download/search throughput and absolute timings measured the former fixture including its small-packet transport behavior and must not be generalized to ordinary SSH servers. Re-measure on the corrected fixture before attributing further bottlenecks to production code. WRITE-only delay is not full-link RTT; timing profiles are investigative evidence, not latency SLAs.

Suspended-log append creates the storage directory when initializing a per-log writer rather than on every chunk. The local 2048-append investigation (three samples, 256B/4KiB/32KiB chunks, exact length and SHA-256 verification) measured median adapter times of 165/171/234ms before and 109/114/177ms after; these are local microbenchmarks, not end-to-end recovery guarantees. `mobile/pad-suspended-output.spec.ts` and `mobile/suspend-resume-ui.spec.ts` cover real detached output exceeding retained history, compaction/history recovery and the original-shell resume path. They do not prove behavior if an external process deletes the storage directory while a writer is active, or disk-full durability.

The Pad detached-output cases verify touch-history progress relative to the first visible numbered history line, then require `PAD_HISTORY_000` to become visible and the live shell marker to leave the viewport without scrolling the page. They do not assume a fixed pixel drag reaches a particular line: measured terminal row height, wrapped command echoes and shell notices affect that position. Original-shell identity and the real 112 MiB detached output remain required for both line logs and single-line output.

Child Browser independent-cancel coverage fences the live-context case at the provider's post-tool model wait before reading the delegation version; context allocation alone is not a tool-settlement barrier. The creating case uses the Browser creation barrier. Both assert that a stale version is rejected with `409 DELEGATION_VERSION_CONFLICT`, then require current-version cancellation to return `202` with `cancelled`; no conflict retry is used. This addresses the test synchronization gap exposed by Actions run `37177979514`, not a relaxation of production optimistic-version checks.

`ssh/search-network-profile.spec.ts` compares three samples of 24 sibling directories, a 24-level chain, and that chain alongside a directory delayed by 1.5 seconds, under 0/20/80ms OPENDIR delay. Every sample checks exact relative-path sets and no truncation. It also verifies the 500-result bound with unique scoped paths, missing-root failure and a successful complete search afterward. Controlled response delays measure refill scheduling, not full WAN behavior; deep-tree parent discovery remains sequential. The current profile does not prove the 5000-directory ceiling, subtree permission-error handling or physical-device UI latency.

Download network profiles use 4MiB per stream except the 2Mbps profile, which uses 2MiB: 4MiB at that configured rate necessarily exceeds CI's existing 15-second HTTP deadline. The smaller sample still spans two full prefetch windows; request timeouts are unchanged. Network-profile cleanup waits for fixture-confirmed pending READs to reach zero and requires successful configuration reset so an aborted request cannot contaminate the following profile.

`ssh/reconnect-ui.spec.ts` also exercises hidden-page terminal consumption with animation-frame callbacks suspended and retained until visibility is restored. More than 1.2 MB of real SSH output must be acknowledged while hidden; on return the terminal must display the completion marker and accept input on the original shell without another Workspace connect. Hidden terminals use timer-based output batches with the existing byte threshold rather than relying on animation frames. This deterministic case does not simulate full browser process freezing, prove long-duration timer-throttling behavior, or cover every detached-view replay boundary.

Change coverage is counted by production change, not by test-case count. Mutation Origin/Fetch Metadata has eight HTTP cases and Webhook secret editing has seven HTTP cases plus its UI delivery flow; these represent two production changes, not fifteen.

The following mapping groups fifteen production changes with their behavioral E2E entrypoints. Acceptance requires the exact pushed revision's canonical Actions workflow to pass checks/format/build, all eight Playwright shards, and all three Docker smoke modes. Local results are preflight diagnostics only. A passing suite does not imply coverage of behaviors absent from these assertions.

| Production change                          | Behavioral coverage                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP mutation Origin / Fetch Metadata      | `http/mutation-origin.spec.ts`, `agent/provider.spec.ts`: matching public/direct Origins, denied foreign/opaque/path Origins, metadata rejection and unchanged settings                                                                           |
| Webhook secret header editing              | `http/webhook-secret-contract.spec.ts`, `ui/notification-settings.spec.ts`: redaction, preserve/replace/remove, rejected edits and actual outbound credentials                                                                                    |
| Effective Proxy credential validation      | `http/architecture-contracts.spec.ts`: password/key null or empty rejection, metadata atomicity, omission preservation and no credential reuse after switching to none                                                                            |
| SSH Key mutation audit                     | `http/architecture-contracts.spec.ts`, `http/ssh-key-audit-failure.spec.ts`: mutation audit actor/source and field names without credentials; rejected edit preserves state and emits no success audit, subsequent rename succeeds                |
| HTML theme content response isolation      | `ui/html-theme-security.spec.ts`: real direct navigation displays source, restrictive response headers and no script/localStorage side effect; remote upstream response remains outside this assertion                                            |
| Connection tag atomic replacement          | `http/architecture-contracts.spec.ts`: duplicates, invalid/oversized batches, missing targets, preserved associations and explicit empty replacement                                                                                              |
| Quick Command bounded tag batches          | `http/architecture-contracts.spec.ts`: duplicate IDs, raw oversized/invalid input rejection, no partial association and subsequent valid assignment                                                                                               |
| Active terminal theme deletion             | `http/architecture-contracts.spec.ts`, `ui/custom-terminal-theme.spec.ts`, `http/terminal-theme-deletion-isolation.spec.ts`: active reference cleared and visible fallback; inactive/repeated deletion preserves selected theme                   |
| Password-bound session invalidation        | `websocket/authenticated-session.spec.ts`, `ui/change-password.spec.ts`: established socket revoked, old HTTP session rejected and new-password login restores capability                                                                         |
| Logout revokes established WebSocket       | `websocket/authenticated-session.spec.ts`: live ping before logout, server closure, HTTP 401 and rejected new upgrade                                                                                                                             |
| Bounded Workspace binary read              | `ssh/binary-read-limits.spec.ts`: strict budgets, admission recovery, duplicate-ID ownership, pending-OPEN cancellation, in-place growth bounds and remote handle CLOSE on consumer disconnect before/after acquisition                           |
| Archive cancellation exit evidence         | `ssh/protocol.spec.ts`, `ssh/progress-display-archive-cancel.spec.ts`, `ssh/archive-cancel-recovery.spec.ts`: remote exit evidence, task retirement, concurrent cancellation isolation, extraction round trip and missing-source failure recovery |
| Fresh SSH Shell listener rebinding         | `ssh/reconnect-ui.spec.ts`: outage/reconnect with fresh prompt and executable output under the same Workspace ID                                                                                                                                  |
| Cross-source credential trust confirmation | `ssh/progress-display-baseline.spec.ts`: Send Files requires public trust confirmation before real task submission and progress assertions                                                                                                        |

Webhook secret coverage reads redacted automatic/custom credential headers, preserves `null` secrets through a real UI save, replaces them, then removes their entries. Each stage sends a saved-channel test to a strict fixture receiver that checks actual outbound credentials without logging or retaining them.

Additional production-change mapping: SFTP upload pipelining and download prefetch (`847bb4f2`) is exercised by `ssh/upload-protocol.spec.ts`. With real remote WRITE/READ latency, the test requires bounded throughput and byte-identical full downloads, unaligned ranges, suffix ranges and open-ended ranges crossing prefetch windows through EOF. An out-of-bounds range must return 416 with the exact unsatisfied Content-Range, followed by a successful full download. Cancellation waits until multiple actual remote WRITEs are pending, then requires public cancelled state, remote writes draining to zero, temporary-file removal and preservation of an existing destination; a subsequent upload on the same Workspace must complete with exact bytes. This does not claim rollback of already committed uploads, a content snapshot under concurrent remote edits, or download-disconnect handle reclamation.

`ssh/download-network-profile.spec.ts` measures three samples per isolated SFTP READ profile: no added latency, 20/80/200ms response delays, shared 100/10/2Mbps response bandwidth and four concurrent downloads at 80ms. Each stream verifies length and SHA-256, disposes its HTTP response, and checks remote delivered bytes and pending READ settlement. Attachments include durations, per-stream/aggregate throughput, request count and peak pending requests. Comparisons require identical test harnesses; no universal speed threshold is inferred. Fixture response delay/rate shaping is not full network RTT, packet loss, TCP retransmission or browser-to-backend throttling.

`ssh/download-admission.spec.ts` fills all eight GET slots with fixture-confirmed pending OPENs, rejects excess authenticated and ticket requests with 429, and verifies HEAD at capacity. Aborting consumers must close all late-acquired handles, then eight downloads and the previously rejected ticket must return identical bytes. Resource CLOSE settlement is observed before subsequent sequential missing-file failures and recovery; neither remote CLOSE nor receiving Content-Length bytes alone establishes handler admission cleanup. Directory ZIP cancellation and other transfer phases are not covered by this case.

The Webhook case-collision regressions submit an explicit replacement and a differently cased `null` entry in both orders while removing custom secret classification. They require rejection before persisted mutation, no old secret in the response, unchanged redacted configuration and successful outbound delivery with the original credentials. Create and unsaved-test entrypoints also reject case collisions without persisting a channel. Mixed-case preservation with a single entry remains supported.

The Agent Provider fixture handles semantic handoff requests separately from normal tool scenarios, emitting all eight required sections. The installed-plugin continuation must complete successfully after retained Skill history triggers context compaction, before inline approval is exercised.

Provider discovery verifies both direct-backend and public-frontend same-Origin mutations, rejects a mismatched Origin, and rejects cross-site Fetch Metadata even with an otherwise matching Origin; all Agent rejections preserve the standard error envelope.

The SSH outage regression checks the fresh shell prompt and executable input after reconnecting the same logical Workspace ID; fresh connections replace ended-shell listeners and terminal replay/input state rather than reusing stale bindings.

The no-Workspace-tool fixture assertion is scoped to the latest user input too: subsequent Runs on the same thread can explicitly select SSH Hosts and request approval without inheriting the earlier no-target fixture scenario.

The retired Agent Runner Journal recovery, Runner process-tree kill fixture and standalone deployment smoke are no longer part of the current E2E suite. The supported production Docker acceptance is `scripts/e2e/docker-core-no-runner-smoke.sh`, and SSH session/job interruption plus Backend restart recovery are verified through their independent current Agent/SSH regressions. Historical Runner evidence is not a current test result.

Send Files regression coverage accepts the public credential-transfer trust confirmation before checking task submission, while keeping the held initial-list race and independent form-loading assertions.

Skill fixture scenarios are selected from the latest user input, not retained historical scenario markers; initial metadata-only exposure and explicit `skill_read` body checks remain enforced.

The deleted Runner Journal corruption fixture is not an active deployment check. Current production Docker smoke verifies the Backend/Frontend/Guacd stack and absence of the retired Agent modules; other current SQLite corruption/recovery checks must be interpreted separately.

The SSH exec fixture handles supported SSH signal requests against its command process group and reports actual exit status or exit-signal. Archive cancellation checks require remote exit evidence rather than channel closure alone.

The direct archive cancellation/recovery regression waits for a real held compression process to start before cancellation. On the cancelled terminal event it requires that process to have exited, checks the retired task no longer accepts cancellation and the held destination does not exist, then completes a subsequent compression and checks its output metadata. This does not establish rollback for archives that have already written partial output.

The concurrent archive regression starts two held commands in one Workspace, cancels only one and requires the other process to remain alive. After releasing the hold it checks the second archive completes, removes the unique source fixture, decompresses the surviving archive and compares the restored bytes exactly. Cancellation isolation is not inferred from progress UI or file existence alone.

The missing-source archive regression requires a failed terminal event, retirement of the old cancellation handle and absence of the requested destination, then verifies a subsequent compression completes and returns a ZIP header through binary read. The header check is not a full archive integrity check; the concurrent regression above supplies an extraction round trip.

Direct Workspace binary-read regressions require a numeric safe-integer `maxBytes` ceiling and reject coercible strings, booleans and arrays. Delayed real SFTP reads fill all four admission slots, reject a fifth read, then cancel every admitted read and verify four subsequent reads return identical bytes. A duplicate request-ID regression verifies that rejecting the duplicate preserves the original read's cancellation handle and confirms its aborted result before a successful subsequent read. Three batches of four missing-file reads verify stream-acquisition failures release admission, followed by four successful byte-identical reads. A fixture-confirmed pending SFTP OPEN is cancelled before its delayed reply; the read must abort, retire its cancellation handle and allow four successful byte-identical reads afterward. The growth regression appends to the same fixture file after a confirmed delayed SFTP READ: the existing read returns only its original size-bounded range, reopening with the old budget fails with a size-limit error, and reopening with the exact new budget returns all bytes. This does not promise a content snapshot for concurrent edits; other concurrent edit races remain outside these assertions.

The pending-OPEN disconnect regression confirms the fixture received SFTP OPEN before closing the Workspace WebSocket, then requires one additional read-only handle open and one additional successful SFTP CLOSE. It covers delayed acquisition after consumer disconnect, not SSH transport loss, channel shutdown cleanup or all remote handle lifecycles.

The pending-READ disconnect regression confirms the read-only handle is already open and not yet closed, and the fixture has received a delayed SFTP READ. Closing the consumer WebSocket must then produce a successful remote CLOSE for that handle. A new Workspace on the same SSH connection must also read a unique fixture back byte-for-byte. Together these two regressions cover consumer disconnection before and after acquisition; they do not establish cleanup under SSH transport loss or reconnection of the same Workspace.

The suite intentionally keeps regression tests for previously fixed production issues, including:

- quick-command tag batches reject missing command references in either order and missing tags with 404 / `QUICK_COMMAND_TAG_REFERENCE_NOT_FOUND`, leave no partial associations and permit a subsequent valid assignment;

- desktop Dashboard keeps the Recent Activity section reachable in the initial common viewport while connection/resource panels own their scrolling;
- Quick Commands preserve text-only group rename, header-area expand/collapse, and narrow-pane toolbar scaling without horizontal overflow;
- File Manager path history and favorite-path popovers keep rounded themed chrome, wrap long paths, resize with the viewport, and remain inside viewport bounds;
- unified document search keeps rounded themed controls, while spreadsheet pagination is absent when the active sheet fits on one page;
- first SSH directory change waiting for the initial real shell prompt;
- extensionless text files opening and saving through the editor;
- streamed previews for Unicode image names, Markdown, and XLSX files, plus stale symlink failure isolation;
- cross-session copy and two-phase move semantics with transfer progress;
- real SFTP navigation uses the actual list scroll container and rendered filename label to verify long-list scrolling, truncation, sorting, popup resizing and path history; shared Progress Display helpers distinguish the tab-bar manager from the per-session restore button and use task state, named actions and rendered source cards;
- terminal-tool regressions exercise terminal search, clear-and-redraw, command-history replay and saved quick-command execution through the rendered terminal and command controls; hidden upload progress verifies the visible fractional percentage beside its progress bar;
- document preview coverage uses the active document mode, named preview tabs, PDF toolbar and spreadsheet pager to verify cached state, close/hide behavior, single content scrollbars, external refresh and persisted pagination limits;
- file preview/editor scenarios retain real remote-content, encoding, line-ending, search, database-table and resize assertions using existing editor controls and preview semantics;
- connection creation coverage uses named actions, saved connection cards and inline test results while verifying real SSH authentication, credential-preserving clones, script imports and filtered bulk tests;
- batch connection editing verifies persisted notes, failed-item selection after partial updates, lazy auxiliary catalogs and narrow-screen row selection through existing cards, switches and modal controls;
- SSH key management coverage uses named dialogs and actions to verify file import, name-only edits, saved-key/password authentication switches, delete recovery and narrow-screen loading errors without exposing private-key details;
- password-change coverage uses the Security heading, associated password labels and named submit action to verify local validation, rejected current credentials, cleared inputs, old-session rejection and real login with the changed credential before restoring the test account;
- audit-log coverage uses the page heading, named filters, durable audit row identities and pagination navigation to verify combined filtering, filter persistence across pages and narrow-screen detail scrolling;
- quick-command management uses the rendered panel, named dialogs and row/context actions to verify persisted creation/edit/deletion, live SSH execution and usage counts, dialog resizing/reset and usable flat commands when the tag catalog fails;
- SSH reconnect coverage observes Workspace protocol requests, rendered terminal geometry and named connection-picker controls to verify initial failures, periodic/key-triggered recovery, hidden sessions, HTML backgrounds and mobile tab lifecycle;
- saved connection lifecycle coverage verifies real SSH tests before and after a name-only edit and confirmed deletion from both the visible list and persistence using named card/form actions;
- collapsible quick-command search coverage verifies default visibility, group-save persistence, search focus/Escape behavior and centered controls across sidebar widths using the existing panel and named controls;
- file upload scenarios verify clipboard/file-picker/folder uploads, remote bytes, conflict decisions, delayed SFTP acknowledgements, stream concurrency and hidden progress restoration/cancellation through existing file-manager and progress controls;
- hidden upload batch cancellation waits for every remaining row to reach a terminal state or for the empty-progress surface after automatic record cleanup; a cancelling action is not treated as cancellation completion;
- custom terminal theme and Workspace tag-management scenarios use current editor, token-input and named manager controls while retaining theme persistence/deletion and narrow-screen tag association assertions;
- backup and IP-control scenarios verify real export/import and persisted blacklist policy through named settings controls; mobile touch coverage retains RDP mode persistence without reconnect, live SSH Ctrl input, dormant progress, single-tap navigation and multi-select/editor behavior using current product surfaces;
- notification channel and tagged quick-command scenarios retain persistence, narrow-screen geometry and live SSH variable substitution through current controls; suspended-history recovery waits for available ownership, and fullscreen checkpoint scenarios synchronize with real shell readiness before freezing terminal state;
- multi-megabyte SFTP uploads completing every block before success;
- SSH suspend/disconnect/resume lifecycle;
- mobile terminal height, command-bar sizing, touch long-press context menus, and the status-monitor modal;
- settings regressions locate IP whitelist and logging forms through their labelled controls and verify persisted API values; appearance title-bar tests use the accessible color textbox and document theme state;
- dark/default UI theme switching and legacy input-token normalization use the rendered appearance editor and named Dashboard controls, while retaining contrast, persistence and viewport assertions;
- desktop and mobile no-session Workspace coverage verifies the unified start page, both connection and suspended-session panels, and page-owned vertical scrolling without horizontal overflow;
- mobile global navigation remains horizontally swipeable when constrained while its native scrollbar track/thumb stays hidden;
- mobile terminal long-press selection suppresses the xterm helper textarea's soft-keyboard focus during hold/menu/copy, restores its input attributes after Copy without refocusing, and restores normal focus on a later short tap;
- Workspace layout configurator direction rendering, including horizontal sibling alignment and vertical child stacking in the editor preview;
- narrow File Manager presentation collapsing secondary metadata columns, keeping the type icon close to the filename without horizontal overflow, and centering a deliberately delayed directory-loading spinner in the remaining list area;
- Quick Commands keeping Copy/Edit/Delete in the row context menu with the duplicate inline three-button strip absent;
- desktop no-session Workspace connection-pane divider resizing and persisted width restoration;
- status-monitor network samples and Docker status over the live SSH transport;
- full encrypted backup export/import restoring settings and encrypted connection credentials, with the retired standalone connection-export UI/API kept absent and the backup file picker retaining rounded themed chrome;
- legacy official HTML-theme repository URLs resolving to the current remote catalog instead of returning a missing-directory 400;
- HTTP SFTP download-ticket/Range/inline/directory-ZIP behavior bound to an active Workspace session;
- raw binary upload ready/progress/completion and remote-content verification through the clean Workspace/upload protocols;
- real Login CAPTCHA fail-closed/token lifecycle and browser WebAuthn passkey success/credential-failure/password-fallback surfaces.
- TOTP 2FA setup, login gating, verification, and disable lifecycle;
- historical database startup applying connection migrations, including migration 20 normalizing legacy proxy-route rows without `proxy_id` while preserving real proxy references;
- connection update/clone/delete with preserved encrypted credentials and tag associations;
- RDP/VNC conditional forms and filtered bulk selection/deletion use named controls and connection cards, with API checks for saved connection fields and exact deletion results;
- command-history search, clipboard copy, replay and individual deletion are exercised through real SSH output and persisted history IDs;
- notification delivery tests use localized Add/Test controls and real webhook/SMTP receivers to verify unsaved delivery, localized event content, HTML email and persisted channel error recovery;
- Agent Host coverage verifies launcher passivity, cached conversation visibility, user-scoped layout reset including launcher docking, provider controls and expanded batched tool-call details through existing labels and tool-name state;

For optional focused local browser debugging, install Chromium when the host already has (or can install) the required system libraries:

```bash
pnpm install --frozen-lockfile
pnpm --filter @nexus-terminal/e2e exec playwright install chromium
```

On Linux hosts that do not already contain Chromium system libraries, Playwright may require root privileges for `playwright install --with-deps chromium`.

## Test reset baseline

Each run uses `tests/e2e/.tmp/backend-data` through `NEXUS_DATA_DIR`. The backend database, generated environment data, and file-backed sessions therefore never touch `packages/backend/data`.

Each GitHub Actions shard owns an isolated backend process and current-v1 database. Before every case or retry, the fixture closes the original App, creates a fresh data directory and keys, initializes the administrator through the real setup API for normal cases (or leaves the database empty for setup coverage), and resets SSH/external fixture state. Failed close/reset blocks the next case; lost reset acknowledgements are not automatically replayed. Restart deliberately retains the current database and keys. No committed legacy database or product reset endpoint is used.

Vite also uses an E2E-specific cache directory so local dependency-cache permissions do not affect the test server.

Runtime databases, reports, traces, screenshots, videos, logs, PID files, caches, and test-installed `node_modules` are ignored by Git.

## 阶段逻辑回归

E2E 失败修复的范围按 [H-13.1](../rules/HUMAN.md#维护与执行) 执行，只修复和回归功能问题；UI 保持要求以该规则为准。测试定位对齐当前真实界面，保留功能断言；发现视觉问题单独记录，不在 E2E 修复中处理。测试执行时机与环境仍按 PLAN 决定项和当前授权，不因本段扩大执行范围。

每个涉及行为的代码阶段按改动范围规划并执行逻辑回归，覆盖实际实现及消费者；格式、类型和 build 通过不能替代业务断言。内部重构也核对原有结果与失败语义，不只确认接口仍可调用。

- 正常与边界：核对输入/输出、状态转换、容量临界值、分页和资源归属等受影响行为。
- 失败与副作用：核对拒绝、冲突、异常、回滚/未知结果，既检查返回结果，也检查持久数据或资源是否符合预期。
- 并发与生命周期：改动涉及幂等、版本、generation、取消或关闭时，验证重复调用、晚返回及清理路径；不只测顺序成功。
- 消费者一致性：契约、错误或共享类型改变时覆盖实际双端与跨模块消费者；旧 Backend 的通过不能证明当前 Backend，新 transport 的单测也不等于真实浏览器验收。

优先选择既有单元、集成或专项用例，以能验证该风险的最小范围执行；必要时在现有测试结构补充缺失场景，不新建镜像实现或只读取源码文本的测试。外部服务可在适用技术边界使用隔离 fixture；真实 SSH/浏览器及故障注入专项保持单独验收，不把模拟结果扩写成实机保证。

每阶段记录场景、被验代码/消费者、实际命令、分支/SHA/工作区、退出结果及未覆盖项。已知失败本阶段修复，修复后重跑受影响用例；仅文档/纯格式且无行为变化可记不适用并说明依据。用户明确限定测试范围或环境阻断时保留未验证状态，不宣称逻辑回归通过。本要求不自动启动全量 E2E 或改写历史证据。

## Agent 设置与浮窗还原（2026-10-20，待远程）

当前工作区恢复原四分类和顶部启停，模型目录并入 Provider，浮窗恢复欢迎卡、消息气泡、配置弹出框、会话内审批和任务侧栏；插件选包串联校验、文件列表紧凑展示。既有 host/performance/settings/plugin/ACP 场景按真实入口同步，保留原 CAS、回执、持久状态和未知结果断言。按 PLAN D17 不执行本地行为测试或用例收集。历史 Actions PASS 只适用于原 SHA；本版仍需远程核对桌面／窄屏弹出框、审批／任务侧栏遮挡、顶部开关、跨分类保存／冲突、插件确认／升级和文件操作。

静态结果：dev 工作区基于 `6e0bc293`，Node 22.23.1 / pnpm 11.26.0；`pnpm run check`、`pnpm run format:all:check`、`pnpm --filter @nexus-terminal/frontend build` 和 `git diff --check` 均退出 0。未提交工作区不是新的行为验收 SHA。

### 记忆与导入展示续审、远程失败修复（2026-10-20，待远程）

基于 `bcd6a036` 继续按 `75289ef9^` 对照展示：审核草稿回到记忆卡片内，导入恢复应用／来源下拉选择，移除手填 UUID 与常驻存储版本；上传成功不再显示只读核对按钮。权威读取、原版本 CAS、一次性导入确认及未知恢复仍由原 owner 持有。来源页成功翻页时清除原选择，读取失败不把缓存当作空列表。

[Actions 39426039985](https://github.com/0honus0/nexus-terminal/actions/runs/39426039985) 对应 `bcd6a036`，结果 failure：1/3/6/7组共16项失败，2/4/5/8组、Checks/format/build及Docker通过。核对各失败组日志及第3组trace：空目标弹出框按Escape时Host关闭，引起13项输入框缺失；最小化清除标题草稿引起1项；旧说明文案和同时命中暂存／安装article各1项。本轮让外层窗口在配置弹出框打开时交由内层消费Escape，暂停视图保留标题及原选中线程（身份撤销仍清理）；测试显式核对关闭弹出框后Host／输入仍可达，按真实卸载操作定位安装记录，并用实际目标选择后权限不增加代替已移除的技术说明断言。未恢复多余UI、放宽权限或重放写入。

本轮只执行静态检查与构建，按D17不运行本地行为或用例收集。静态结果：`pnpm run check`、`pnpm run format:all:check`、`pnpm --filter @nexus-terminal/frontend build` 和 `git diff --check` 均退出0；上述修复与记忆／导入显示仍须新提交的远程Actions验收，不继承历史PASS。

### 单位输入、插件确认与维护入口续审（2026-10-20）

[Actions 39428185902](https://github.com/0honus0/nexus-terminal/actions/runs/39428185902) 被测 SHA `bab9129aaaf1e19806dc2454c9b66ff75530e0b1`，已完成且 failure：7/8 Playwright组通过；第1组仅1项旧 `Completed · UUID` 定位失败，Checks/format/build、Docker及runner image成功。本轮按真实完成时间标签定位，仍检查follow-up创建的新ID、原Run不变与回复，不恢复UUID展示或放宽业务断言。

本轮基于该SHA恢复预算／存储单位控件和底部保存栏、插件仓库添加／搜索／来源卡片与候选确认、官方卡片首次安装弹窗、通知分区与保存栏、SSH Key管理按钮样式。手工AppStorage／暂存／运行时诊断移到已有数据页高级维护，卸载后的显式删除仍留插件页。后端会自动创建内置应用，故总开关不依赖可选插件；推荐插件安装不自动启用插件App或授予能力，三语说明同步真实语义。

两轮源码复核覆盖全部本批文件及设置装配、composable、transport、Shared／后端真实调用：第一轮检查展示基线与转换owner；第二轮检查CAS、无效数值、单位精度、候选安装／升级、发布者信任、部分目录失败、视图撤销／晚响应、未知写入围栏与数据原意图保留。额外通过SFC解析扫描66个非Agent既有变更组件的完整template和静态class集合，分类核对新增恢复／契约差异；此静态扫描不等于浏览器外观验收。

本轮静态环境 Node 22.23.1 / pnpm 11.26.0：`pnpm run check`、`pnpm run format:all:check`、`pnpm --filter @nexus-terminal/frontend build`、`git diff --check` 均退出0。未执行本地行为测试、浏览器、用例收集或线上部署。单位临界值／跨分类草稿、官方安装取消／回执丢失、仓库信任／升级、维护区域生命周期和窄屏布局须由新提交远程Actions及适用实机环境验收，旧7/8不代表本轮通过或UI还原百分比。

### 插件场景跟随真实展示入口（2026-10-20，待远程）

基于 `a7406e88cebf888cce0fa0caae8a2b266a5c0f36` 继续静态审核既有插件场景，发现两个消费者仍依赖已移除的平铺诊断入口。官方目录场景改为观察设置页自动发出的真实官方 GET，并核对没有第三方查询参数、已配置仓库仍可见；原先两个覆盖来源的400及空安装目录断言保留。Custom Surface 场景先检查普通插件页的三条可见安装记录，再从数据页高级维护打开运行时观察并核对三条真实实例选项，随后原 iframe SDK、隔离、存储和跨应用断言保持不变；明确断言普通插件页没有运行时诊断。

两轮源码复核分别核对实际组件入口和完整业务断言；没有新增产品按钮、放宽权限、跳过用例或执行本地行为测试。本批只修改既有测试消费者与验证／规划文档，USAGE 原操作说明仍符合实际，E2E 包无 build 脚本。`a7406e88` 的 [Actions 39433921156](https://github.com/0honus0/nexus-terminal/actions/runs/39433921156) 的 Checks/format/build 和 Docker 已通过；八组运行中，不能据此宣称本批行为通过。

静态环境仍为 Node 22.23.1 / pnpm 11.26.0；根 `pnpm run check`、`pnpm run format:all:check` 均退出0，日志为 `/tmp/nexus-ui-followup-{check,format}.log`。最终定位微调后另检查修改的spec和文档格式、ESLint及`git diff --check`；未修改产品源码，无新增产品构建需求。本批远程行为待新提交验收。

本批远程证据：`a7406e88` 的 Actions 39433921156 被新推送按已有 `cancel-in-progress` 策略自动取消，原日志 `/tmp/nexus-ui-a7406e88.log` 保留两项第3组旧入口失败；不得算作完整验收。`9808dbdc0d67dc982bbaed11132a28b25275dc40` 的 [Actions 39434833396](https://github.com/0honus0/nexus-terminal/actions/runs/39434833396) 八组全部success：各组通过数依次为55、37、48（含两个独立1项）、46、58（含独立1项）、76、77、51，共448项。逐组读取原job日志，无failed、flaky或skipped用例；两个修复场景分别3.9秒及8.8秒通过。Checks/format/build、Docker及runner image也通过。该范围不包含完整像素比对、全部单位临界值／未知安装故障和扩大的窄屏／生命周期组合，既有未覆盖说明继续有效。

### Files 库展示续审（2026-10-20，待远程）

基于 `9e56d456`，按 `75289ef9^` 完整 ArtifactLibraryView 模板还原用量条与保护／回收／剩余统计、紧凑搜索／UiSelect筛选及重置、空列表、原文件图标／扩展名／状态和动作顺序。删除确认与上传状态不常驻显示内部ID／版本；成功上传隐藏核对按钮，未知或staging仍保留恢复入口。实际kind来自已验证应用对象，不恢复旧媒体推断或旧API；时间仍为毫秒。新协议的offset分页、真实App、上传／引用／清理、权限／CAS和未知结果仍归原owner。USAGE同步真实浮窗入口与对应操作。既有插件场景只把原生select操作换为现有UiSelect helper，原上传、下载和持久数据断言不变。

两轮源码复核覆盖展示基线、Shared有限取值、父窗口安装、筛选互斥、上传恢复按钮条件、删除和原清理确认；没有新增行为测试或本地收集／浏览器运行。原448项只对应 `9808dbdc`，不代表本批已通过。静态环境 Node 22.23.1 / pnpm 11.26.0；根check和frontend build退出0（`/tmp/nexus-files-ui-{check,build}.log`），完整format及最终diff结果按本批收口补充。窄屏筛选条和Files完整交互待新提交远程／对应现场验收，不宣称像素一致。

本批最终全量format退出0（`/tmp/nexus-files-ui-format.log`），修改组件／spec的ESLint、文档与源码Prettier、`git diff --check`通过。第二轮父窗口复核发现Files没有独立滚动容器，补回有界窗口内的纵向滚动，避免新协议上传／清理区域越出浮窗不可达；该布局仍须远程核对。

Files续审补充：旧模板只有保留／删除／下载，重构新增的逐行ArtifactAttachmentEditor要求手填Thread/Run，属于H-13下无依据的技术表单。本批移除该表单、无人消费的组件及前端detach包装，清理三语专属文案；真实会话仍由NativeInputArtifacts使用Shared／Model的版本读取、当前线程绑定及未知结果围栏。后端HTTP、Shared及SDK不变。USAGE和Frontend架构同步真实owner。此修改晚于396728e2，不计入该轮远程结果；两个源码复核分别确认无旧版依据及全部消费者，静态和新SHA行为结果单独记录。

引用表单清理后的根 `pnpm run check`、`pnpm --filter @nexus-terminal/frontend build`、`pnpm run format:all:check` 均退出0，日志为 `/tmp/nexus-files-reference-{check,build,format}.log`；`git diff --check`通过。前端源码无ArtifactAttachmentEditor／detachManagedArtifact消费者或孤立引用；仍保留NativeInputArtifacts真实attach调用。当前只改源码／静态，没有本地行为验证；后续远程以该补充提交SHA为准。

396728e299bf4a734aa92bc43448404bdb31b527 的 [Actions 39437631131](https://github.com/0honus0/nexus-terminal/actions/runs/39437631131) 整体success：八组共448项，无失败／flaky／skipped用例；质量／构建、Docker、runner image和耗时统计通过，可选截图任务skipped。逐组日志保存为 `/tmp/nexus-files-ui-job-<jobId>.log`；真实Files切换UiSelect、上传、列表及校验下载场景所在第3组的独立场景通过。本轮未包含8735d59f的引用表单清理，后者仍待独立远程验收；源码／静态和当前像素保证范围不扩大。

附件选择续审：原ArtifactPicker支持multiple及最多10个文件，重构后仅取files[0]。现恢复多选并按剩余额度裁剪，由原use-artifact-picker在单一busy／scope内串行完成每个独立预留和上传；每次await后核对原App、signal和可见性，首个失败／未知停止后续，不自动重试。每项开始前清除前一预留，避免把后项无ID未知错误地恢复为前项成功；前项已确认即加入选择并标目录失效，后项确定拒绝也不会丢掉这一事实。两轮源码复核覆盖正常多项、部分成功后拒绝／未知、下一预留丢回执、离页／切App及容量裁剪；本段是源码分析，未执行这些行为场景。USAGE与Frontend同步。晚于a758e243，不计入其远程结果；静态及新SHA结果另记。

### 2026-10-20 ACP取消点击与后台读取竞争（待新SHA）

a758e2431baedcd4143272e6e09f09271eb41a9f 的 [Actions 39438940586](https://github.com/0honus0/nexus-terminal/actions/runs/39438940586) 整体failure：7/8组通过，第4组独立ACP cancelled失败；质量、Docker及runner通过。首次trace中点击取消与两秒轮询同时发生，按钮在pointer按下后被busy禁用，页面无agent.runs.cancel请求；10秒后finally的API取消与用户点击分开。重试reset500来自原执行未知清理，未删除或绕过围栏。trace位于 `/tmp/nexus-acp-cancelled-trace`，原日志 `/tmp/nexus-files-reference-shard4.log`。

修复由原operation owner标记可被取代的只读background请求，不周期性切换交互busy；新交互取消原读取等待并推进generation，旧accept/catch/finally不能覆盖新状态。自动轮询之外的读取与写入仍串行，写入CAS及unknown不变。既有ACP取消用例增加实际取消HTTP回执与Shared关联解码，再核对Run取消、晚审批拒绝、进程及工具账本；未放宽原断言。两轮源码复核覆盖轮询被写入／手动读取取代、会话撤销、晚成功/失败及旧finally。此为源码分析，按D17未本地执行行为；附件多选故障分支也不冒充已验。静态及推送后的八组结果另记。

本批最终静态门禁：Node 22.23.1／pnpm 11.26.0，根 `pnpm run check`、`pnpm --filter @nexus-terminal/frontend build`、`pnpm run format:all:check` 均exit0，日志为 `/tmp/nexus-ui-poll-{check,build,format}.log`；`git diff --check`通过。包含附件多选与可取代的后台读取，未运行本地行为测试。最终diff第二次复核确认后台仅用于只读轮询、原写入保护及全部ACP业务断言保留。

### 2026-10-20 编辑器保存关闭准入（待新SHA）

f0acd1d78433872dc1b8d08eb210a21dd5928aa8 的 [Actions 39441269931](https://github.com/0honus0/nexus-terminal/actions/runs/39441269931) 为failure：七组成功、447项通过／1项失败，无flaky；质量／构建、Docker及runner通过。第4组原ACP取消首次通过（9.5秒），第3组Files／插件场景通过。第5组file-preview-editor在保存后关闭失败，两次均如此。原始逐组日志 `/tmp/nexus-ui-poll-job-<jobId>.log`；trace `/tmp/nexus-editor-close-trace`。

trace显示Save后为saving，测试已从磁盘读到新字节，但关闭时原保存回执仍未完成，closeDocuments正确拒绝，随后才显示Save successful。修复FileEditor：关闭窗口按全部文档saveState，关闭标签和右键批量菜单按涉及集合禁用；Model的在途保存、确认后草稿复核及生命周期不变。既有测试在磁盘内容断言之后额外等可见保存回执，再保留关闭／重开及全部后续预览断言，不增加固定延迟。两轮源码复核覆盖活动／非活动保存、桌面／移动关闭、左右／其他标签及失效草稿保护；USAGE／Frontend同步。此为源码复核，D17下无本地行为执行，新SHA结果另记。

编辑器补修静态门禁：Node 22.23.1／pnpm 11.26.0，根check、frontend build及全量format均exit0，日志 `/tmp/nexus-editor-close-{check,build,format}.log`；diff检查通过。最终第二次源码复核确认单标签／左右／其他集合及桌面／移动窗口均消费同一文档saveState，Model实际准入与UI禁用分开保留；未运行本地行为。

等待603303ed期间补核UI源码：ArtifactPicker完整模板／样式及AgentConfigPopover、AgentHubWindow、AgentAppSwitcher、AgentLauncher、AgentSurfaceHost、PluginAppFrame的旧版diff；未新增源码修改。除已记录的新契约绑定、缺少真实来源的统计徽标和失败恢复外，未发现新的无依据展示改动。该结果是源码对照，未执行像素比对或新增浏览器场景。

### 2026-10-20 ACP取消回执采集补修（待新SHA）

603303edb6904c52b77d39f8dedb84d599699fc8的[Actions 39443340321](https://github.com/0honus0/nexus-terminal/actions/runs/39443340321)为failure：447项通过／1项失败，无其他重试或flaky；第5组文件编辑历史回归首次通过（26秒），第4组独立ACP取消停在新增cancellationResponse.json，报Network.getResponseBody无数据。取消已收到HTTP200，此轮尚未执行后续终态断言，不能据此认定完整链通过；重试reset500仍保留unknown因果。原日志`/tmp/nexus-editor-close-job-118698763023.log`及`/tmp/nexus-editor-close-job-118698763219.log`。

按既有E-10.6，原页面route现在对create和cancel都只转发一次上游请求，先保存unknown回执再fulfill同一响应，断言使用同一Shared decoder及原请求关联；其他读取继续交付，route持续到页面销毁，不重新派发写入、不删除清理围栏。两轮源码复核覆盖实际等待／捕获先后、两个写入方法、全部只读continuation和fixture teardown。仅修改测试与文档，无产品改动，未本地运行行为或收集用例。

取消回执补修最终静态：根check及全量format均exit0（`/tmp/nexus-acp-receipt-{check,format}.log`），diff检查通过；仅测试／文档改动，不重建未变产品，不运行本地行为。最终diff复核：create/cancel各取一次上游回执，其他方法continue，Map保存unknown且仅由Shared关联解码消费，原取消后的全部业务断言保留。

### 2026-10-21 远程 UI 还原后 E2E 修复

原始失败为[Actions 39568515716](https://github.com/0honus0/nexus-terminal/actions/runs/39568515716)，被测81aa1a0da26e11f609ca961e683c5332c20dde36；第1–7组失败，第8组通过，原日志保存在`/tmp/nexus-e2e-39568515716-shard-*.log`。首批按耗时优先修复Agent公共App选择、会话列表与插件新建／版本重命名场景，保留真实回执、版本与历史断言，不恢复已删除的调试表单。对应三个测试文件ESLint、Prettier与diff静态检查通过；未执行本地行为测试，远程修复结果待新SHA核对。

首批b251f1f7已推送，触发[Actions 39571411450](https://github.com/0honus0/nexus-terminal/actions/runs/39571411450)。第二批修复其余旧入口并补上凭据选择器可访问名称、临时隐藏保留未发送任务文本；保留通知真实投递、精确请求重试、版本、权限与跨页隔离断言。根`pnpm run check`、正式前端build及本批ESLint通过（`/tmp/nexus-e2e-fix-{check,build,eslint}.log`）；按D17未执行本地行为。原第1组27失败后耗尽900秒整组期限，上传用例被中断，不将其误报为已确认上传缺陷。产品章节已修正旧标题草稿与常驻刷新描述；最新SHA远程结果待验。

第二批24560197触发[Actions 39572270233](https://github.com/0honus0/nexus-terminal/actions/runs/39572270233)，首批按workflow并发策略自动取消，取消不算失败或通过。取消前第1／4组原日志`/tmp/nexus-e2e-b251-shard-{1,4}.log`已揭示后续公共问题：同场景多App重名、统一Send的后续Run实际走appendInput。第三批修复夹具唯一名称与真实Send派发方法，保留完整原始回执／线程身份／显式follow-up判据。全量格式最终检查通过（`/tmp/nexus-e2e-fix-format-final.log`）；没有本地行为或用例收集。

第三批68b72125触发[Actions 39572715320](https://github.com/0honus0/nexus-terminal/actions/runs/39572715320)。第二批取消前原日志`/tmp/nexus-e2e-2456-shard-{2,3,4,6,7}.log`还显示批量配置保存与模型推理级别采用了正式本地化名称；第四批同步精确按钮／checkbox名称，不改变保存副作用或持久验证。两测试文件ESLint、Prettier及diff检查通过，最新远程仍待完整八组。

### 2026-10-20 本批最终远程收口

[Actions 39445026926](https://github.com/0honus0/nexus-terminal/actions/runs/39445026926)整体success，被测ddf5ce0e95c39367977cf08c951ce1e4d63b34ef。逐组读取原日志，各组通过数为53／38／54（52+1+1）／57（56+1）／46／60／74／66，共448项，无失败、flaky、重试或跳过用例；质量／格式／构建、Docker、runner及耗时统计success，可选截图任务skipped。原日志`/tmp/nexus-acp-receipt-job-<jobId>.log`。ACP取消首次11秒通过，文件预览编辑历史回归首次27秒通过；Files／插件独立场景通过。未扩大为多文件故障、完整像素或全部窄屏已验。

随后bot的68397774仅更新duration-estimates；文档收口只刷新当前基线、擦除已完成施工记录并保留V-UI-01／02和独立V-THREAD等后续，不改变被测产品。没有本地行为测试或线上部署，未知.tmp保持。

### 2026-10-20 设置与通知跨页 UI 回退（本地 CDP）

基于当前未提交工作区，按 `75289ef9^` 继续核对展示差异。设置页恢复 Provider／App／插件／Browser／安全的卡片层级；通知页恢复列表标题、按钮、渠道分区、事件网格和底部测试／保存区，同时保留当前结构化 Header、SMTP／Telegram 秘密意图、CAS 和失败围栏。批量连接编辑恢复高级选项折叠，SSH 密钥错误回到列表内，备份导出／导入恢复各自按钮行与就地消息；三语补齐 19 个新操作事件名称。

本地 `https://api.honus.top` CDP 证据：`/tmp/settings-models-restored.png`、`/tmp/settings-tools-restored.png`、`/tmp/settings-runtime-restored.png`、`/tmp/settings-safety-expanded2.png`、`/tmp/notifications-restored.png`、`/tmp/notification-form-final.png`、`/tmp/settings-data-restored.png`、`/tmp/settings-security-restored.png`。通知页与设置页控制台均无 error；通知事件网格未出现未翻译大写枚举。测试环境没有 Provider 和连接，Provider 仅核对空态，批量编辑、真实通知投递和 SSH 密钥保存未执行；未做完整像素或窄屏专项。

静态结果：Node 22.23.1／pnpm 11.26.0，根 `pnpm run check`、`pnpm run format:all:check`、`pnpm --filter @nexus-terminal/frontend build` 和 `git diff --check` 均退出 0。该结果只证明当前工作区的静态与本地展示核对，不代表远程 448 项回归或部署验收。

### 2026-10-20 Agent 与文件库窄屏 CDP 回归

使用本地 CDP（`https://api.honus.top`，未使用 9998）在 390×844 与 768×900 检查当前工作区。Agent 设置页和通知编辑器页面级 `scrollWidth` 与视口同为 390；文件页修复前 header 内容宽 447px、容器 388px，筛选栏改为移动端分行后溢出项消失。会话页修复前只有标题和空主区；在线程列表已有 7 项时，修复后自动选中最近更新会话并渲染欢迎卡、输入区和单行工具栏。768px 最大化窗口为 256px 会话侧栏加 512px 主区，工具栏未裁切。

证据：`/tmp/ui-audit-agent-settings-390.png`、`/tmp/ui-audit-notifications-390.png`、`/tmp/ui-audit-agent-mobile.png`（修复前）、`/tmp/ui-audit-agent-mobile-fixed.png`、`/tmp/ui-audit-agent-chat-390.png`（修复前空主区）、`/tmp/ui-audit-agent-chat-390-fixed.png`、`/tmp/ui-audit-agent-768-max.png`。本次未执行真实 Run、附件上传、删除、通知保存或 Provider 数据态；完整像素与全部视口组合仍按 V-UI-01 待验。

### 2026-10-20 Agent 悬浮会话、附件与错误态 UI 收口（本地 CDP）

使用本地 CDP（`https://api.honus.top`，未使用 9998）核对当前工作区。会话侧栏恢复标题／更新时间行，App 切换器、会话附件选择器、文件来源、Agent 设置与通知页均未出现裸 UUID、模型目录错误码或已知通知事件枚举。真实接口回归中会话列表从 7 新建到 8，首次删除只进入确认态，第二次删除返回成功后回到 7；等待 3.7 秒未确认时列表不变，控制台无 error。注入 `/api/v1/agent/apps` 503 后，390×844 显示“无法加载 Agent 服务”和“重试”，没有原始操作／错误文本；设置、通知、Agent 会话和文件页均无页面级横向溢出（`scrollWidth=382`，视口 390）。

证据：`/tmp/ui-final-directory-failure-390.png`、`/tmp/ui-continue2-agent-delete-confirm.png`、`/tmp/ui-continue2-agent-after-delete.png`、`/tmp/ui-continue2-agent-chat-390.png`、`/tmp/ui-continue2-agent-files-390.png`、`/tmp/ui-continue2-settings-agent-390.png`、`/tmp/ui-continue2-notifications-390.png`。测试环境没有 Provider、连接和 Artifact，真实 Run 发送、附件上传／关联／下载、文件清理、通知保存与外部投递未执行；这些场景和完整像素比对仍待验。

### 2026-10-22 Agent 文件库紧凑工作区布局（本地 CDP）

使用本地 CDP（`https://api.honus.top`，未使用 9998）核对当前工作区。默认 Agent 浮窗 `1180×740` 下，文件库页头由基线约 `212px` 降至 `142.4px`，文件库 `scrollWidth=clientWidth=1178`，文档无横向溢出。390×844 下页头为 `193.8px`，搜索与三个筛选分行后完整可见，文件库宽 `356px`、列表行宽 `354px`，所有行 `scrollWidth=clientWidth`；文件状态和大小在行内展示，保留／删除／下载三个按钮均有 `28×28` 可点击区域。搜索无结果时显示带重置动作的紧凑空态，重置后恢复列表；未选择 App 时清理按钮保持禁用。

通过当前 Artifact API 临时创建 PDF、Markdown 和 gzip 三个文件，验证有数据列表、窄屏行布局与操作按钮，随后用同一 API 全部删除并确认剩余 0 项、存储回到 0 B。CDP 同时发现文件库遗漏 `vue-virtual-scroller` 定位样式，导致有数据时虚拟行脱离列表容器；补齐样式后 scroller 定位为 `relative`，行位于列表区内。证据：`/tmp/agent-files-after-wide-final2.png`、`/tmp/agent-files-after-390-final2.png`、`/tmp/agent-files-after-wide-empty-final.png`、`/tmp/agent-files-after-390-empty-final.png`、`/tmp/agent-files-after-390-filter-empty2.png`。

本轮未执行真实下载、删除确认、清理确认或远程 E2E；完整像素与全部视口组合仍按 V-UI-01 待验。

### 2026-10-22 系统设置后端日志控件反馈（本地 CDP）

使用本地 CDP（`https://api.honus.top`，未使用 9998）核对系统设置。后端日志字段的重复标签现为视觉隐藏，触发器保留可访问名称；下拉从 `INFO` 切到 `DEBUG` 后，保存按钮由禁用变为启用，并使用主题 solid 主操作样式，当前生效级别仍显示 `INFO`。390×844 下标签占位高度为 0，页面无横向溢出，主按钮保持可见。本轮只修改前端草稿，未点击保存；真实 PUT、冲突和失败恢复继续由既有 `system-settings.spec.ts` 覆盖。

`system-settings.spec.ts` 已新增标签隐藏、保存启用及 `data-appearance="solid"` 断言，但本轮未执行远程 E2E。证据：`/tmp/logging-before-changed.png`、`/tmp/logging-after-viewport.png`、`/tmp/logging-after-390-final.png`。

### 2026-10-22 设置高级诊断与恢复内容重构（本地 CDP）

使用本地 CDP（`https://api.honus.top`，未使用 9998）核对设置 → 数据 → 诊断与恢复（高级）。默认折叠；展开后宿主诊断呈宽屏 3 列、中屏 2 列、窄屏 1 列，机器突变恢复显示权威列表、空态和详情卡片，Agent 维护显示安装恢复、插件数据、版本目录与运行态核对四组。1536 宽、390×844 与 320×700 下文档 `scrollWidth` 均不超过视口；390 下 Agent 维护卡片宽 358px、插件数据卡宽 304px，320 下分别为 288px、234px。

通过 CDP Fetch 模拟 `/api/v1/agent/plugins/{publishers,installations,stages,versions}` 与单安装 `data-snapshot`，验证插件有数据态：3 条快照（含已删除墓碑）、单键读取表单、保存／删除和批量迁移区均渲染；390 与 320 下无横向溢出。模拟响应只用于视觉检查，脚本结束已 `Fetch.disable` 并关闭临时页面，没有写入测试环境。真实机器突变记录和插件安装数据不存在，真实证据录入／释放、插件数据写入及服务端 CAS 未执行。

证据：`/tmp/advanced-after-wide.png`、`/tmp/advanced-after-390.png`、`/tmp/advanced-after-320.png`、`/tmp/advanced-after-wide-agent.png`、`/tmp/advanced-after-390-agent.png`、`/tmp/advanced-after-320-agent.png`、`/tmp/advanced-mutation-detail-wide.png`、`/tmp/advanced-mutation-detail-390.png`、`/tmp/advanced-plugin-data-wide.png`、`/tmp/advanced-plugin-data-390.png`、`/tmp/advanced-plugin-data-320.png`。

目标文件 Prettier、ESLint、JSON 解析、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 通过。`tests/frontend/mutation-recovery.integration.mjs` 本轮执行失败：测试仍等待 `[data-mutation-recovery]` 内的内联 alert，而当前并发改动已把操作提示迁到全局 Toast；该断言需由对应 owner 更新，不能视为本轮 UI 通过。完整远程 E2E、浅色主题和更多视口仍未运行。

### 2026-10-22 设置分组标题垂直居中与数量范围提示（本地 CDP）

使用本地 CDP（`https://api.honus.top`，未使用 9998）核对设置 → 安全。桌面 1920×953 下四个分组头部的图标、标题和右侧操作按钮中心线均为 `y=188`、`482.8`、`636.8`、`774.8`，头部计算样式为 `align-items:center`，标题无顶部外边距。390×844 与 320×700 下四组中心线分别是 `160`、`445.8`、`593.8`、`722.8`，图标、标题和操作区域逐组一致；分组头部 `scrollWidth=clientWidth`，文档宽度分别保持 390 与 320，未产生页面级横向溢出。导航自身保留横向滚动，不属于页面溢出。

Agent 数量组件新增范围失败局部状态：合法单位表达超出当前字段上限时优先显示“超出范围：最大 …”，只有语法无法解析时才显示格式错误；`type=number` 的有效范围值仍不重复显示换算微反馈。测试环境后端仍返回旧版执行设置形状，正式 Agent 面板未渲染 Recall 字段；改在页面内临时挂载 `QuantityInput`（`max=32768`）验证：输入值 `1G` 显示 `Out of range; maximum 32K` 且 `aria-invalid=true`，输入 `not-a-size` 显示 `Invalid format; use a number with an optional unit`，临时应用随后已卸载。`performance-settings.spec.ts` 已新增对应断言，但按 D17 未运行该 E2E。

证据：`/tmp/settings-security-390.png`、`/tmp/settings-security-320.png`、`/tmp/agent-settings-current.png`、`/tmp/recall-range-feedback.png`。真实 Agent 页面 Recall 输入与保存、完整 E2E 仍未执行；分类标题量测只覆盖安全页，其他使用同一 `UiSettingsGroup` 的页面共享样式结论，不扩大为全部页面交互验收。

### 2026-10-22 Agent 管理预览入口移除（本地集成与 CDP）

硬限制管理不再渲染预览按钮或二次确认面板，普通预算与硬限制共用顶部“保存”；`saveExecutionHardLimits` 仍在原 API 内部按后端契约调用 preview → confirm，用户只执行一次保存。文件库清理不再提供独立预览步骤，选择来源 App 后通过一次全局确认执行；文件内容预览保留。三语中无消费者的 `hardLimits.review`、`noPreviewChanges` 已删除，文件删除确认键由 `deletePreview` 改为 `deletePrompt`。

`node tests/frontend/agent-execution.integration.mjs` 在本机隔离 SQLite 与 Vite 页中执行 28 项检查通过，包含“hard limits have no preview action”“actual component saves hard limits without a preview step”、普通预算与硬限制互斥、unknown/冲突恢复及认证撤销。测试未访问 `api.honus.top` 的生产数据，临时目录在结束时删除。

使用本地 CDP（`https://api.honus.top`，未使用 9998）读取已登录的 `settings?tab=agent`：页面文本和可操作元素中“预览/preview”匹配为 0；展开“硬限制”后渲染 16 个字段，`previewActions=[]`，只有保存操作。全程未修改或保存测试环境设置。证据：`/tmp/agent-settings-preview-removal-desktop.png`。

目标文件 Prettier、ESLint、三语 JSON 解析、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 通过。文件库清理未在真实测试账号点击最终确认，避免删除账号级可回收文件；真实清理、删除确认、窄屏布局及完整远程 Actions E2E 仍未执行。

### 2026-10-22 全局禁用目标选中态去重（本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入“安全与系统”并展开“全局禁用目标”。选择 SSH 目标 `akko` 后，顶部旧标签容器数量为 0，列表内高亮卡片为 1，顶部“这是跨会话、跨 Run 的全局硬限制”说明不包含目标名；标题计数由 `0 / 6` 更新为 `1 / 6`。核对后刷新页面丢弃草稿，未填写原因或保存。

目标文件 ESLint、Prettier、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 通过。证据：`/tmp/agent-denylist-selected-only.png`。窄屏布局、批量禁止／允许及真实保存仍未在本轮执行。

### 2026-10-22 设置分组窄屏左边界对齐（本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=workspace`，未使用 9998）在 390×844 与 320×700 视口核对设置分组。修改前分组内边距为 15px，但标题因 30px 装饰图标和 9px 间距从 66px 开始，正文从 27px 开始；760px 以下隐藏图标后，390px 下“文件与编辑”标题与表单左边界均为 27px。320px 下“文件与编辑、终端与指令、首页与监控、监控核心配置、布局与高级设置”五组标题与正文均逐项对齐，页面 `scrollWidth=innerWidth` 为 390 和 320，没有横向溢出。

目标 CSS Prettier、Frontend build 与 `git diff --check` 通过。证据：`/tmp/settings-mobile-aligned.png`。本轮只读取边界，未修改或保存设置；桌面 761px 以上图标布局保持原样。

### 2026-10-23 Provider 弹窗紧凑留白与模型库单行（本地 CDP）

使用远程 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）在独立临时页核对，未提交，也未填写、测试或保存 Provider。模型库状态条在 `1440×900`、`390×844`、`320×700` 与 `280×700` 下均为单行，状态文字可截断，“立即更新”按钮不换行，状态条 `scrollWidth=clientWidth`。

添加 Provider 弹窗在 `1440×900` 下内容左缘距面板约 17px，在 `390×844`、`320×700` 下约 13px；三档内容右缘距滚动条可用边界约 12px，正文 `scrollWidth=clientWidth`，无横向溢出，面板与表单尺寸、字段及保存取消流程未改变。证据：`.tmp/agent-registry-final-320.png`、`.tmp/agent-provider-final-1440.png`、`.tmp/agent-provider-final-390.png`、`.tmp/agent-provider-final-320.png`。目标 Prettier、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过；完整 E2E 仍按 D17 范围执行。

### 2026-10-22 App 与扩展四分类等分（本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入“App 与扩展”。四个页签现在为 `grid-cols-4`，1152×900 下每列约 160.06px、390×844 下 80.20px、320×700 下 62.60px，四列宽度差均为 0；四个标签的 `scrollWidth=clientWidth`，页签容器无横向滚动，文档宽度分别为 1144、382、312，均未超过对应视口。

证据：`/tmp/agent-extensions-tabs-1152.png`、`/tmp/agent-extensions-tabs-390.png`、`/tmp/agent-extensions-tabs-320.png`。目标 ESLint、Prettier、Frontend build 与 `git diff --check` 通过。本轮只读取与切换页签，未执行资源写入或完整 E2E。

### 2026-10-22 插件仓库折叠提示精简（本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）进入“App 与扩展 → 插件市场”。官方仓库分组展开后仍显示仓库来源、复制按钮、插件列表与发布者区域，分组头 `aria-expanded=true`；页面“展开”和“收起”文字计数均为 0，文档 `scrollWidth=1144`、视口 1152，无页面级横向溢出。

证据：`/tmp/plugin-repositories-without-expand-text.png`。目标 Prettier、ESLint、Frontend build 与 `git diff --check` 通过。本轮未添加、移除或保存仓库，也未执行完整 E2E。

### 2026-10-22 设置页一致性与尺寸巡检（本地 CDP）

使用本地 CDP（`https://api.honus.top/settings`，未使用 9998）巡检工作区、系统、外观、Agent、安全、IP 管控、数据管理和关于八个分类，未点击保存或改写测试环境设置。桌面请求 1440×1000（实际 CSS 视口 1152×800）下普通设置卡宽统一为 `780px`，390×844 下为 `358px`，320×700 下为 `288px`；关于页分别同宽，版本、状态和仓库入口均无悬空竖线。内容画布计算样式为 `scrollbar-gutter: stable`，长短页面切换时左右边界不再变化，三档文档均无页面级横向溢出。

八页均未发现原生 `<select>` 残留，常规按钮高度统一为 `38px`，控制台无运行异常。数据管理双卡在桌面各 `384px`、窄屏恢复整行宽，属于页面既定双列布局；Appearance 首卡只保留标题与“自定义外观”操作，第二轮延迟加载后卡片宽仍为 `780px`。修改前后对比证据：`/tmp/settings-audit-*-1152.png`、`/tmp/settings-audit-*-390.png`、`/tmp/settings-audit-*-320.png`；修改后证据：`/tmp/settings-ui-about-1440-final.png`、`/tmp/settings-ui-about-390-final.png`、`/tmp/settings-ui-about-320-final.png`、`/tmp/settings-ui-system-1440-final.png`、`/tmp/settings-ui-system-390-final.png`、`/tmp/settings-ui-system-320-final.png`。

目标 Vue ESLint、Prettier、`pnpm --filter @nexus-terminal/frontend build` 与 `git diff --check` 通过。本轮未提交、推送或部署，完整远程 E2E 仍未执行。

### 2026-10-22 Toast 整卡状态色（本地 CDP）

使用本地 CDP（`https://api.honus.top`，未使用 9998）通过页面内现有 notification store 同时展示成功、警告和失败 Toast，未触发业务写入。桌面请求 1440×1000（实际 CSS 视口 1152×800）下三条均为 `340×56px`；390×844 下均为 `366×56px`。成功卡背景、边框和阴影命中 `--status-success-color`，警告命中 `--status-warning-color`，失败命中 `--status-error-color`，图标容器与操作按钮使用同一语义 tone；页面无横向溢出，控制台无异常。

验证后已从 store 清除临时通知，未改变驻留、去重、关闭或恢复逻辑。证据：`/tmp/toast-status-colors-1440.png`、`/tmp/toast-status-colors-390.png`。目标 CSS/Vue ESLint、Prettier、Frontend build 与 `git diff --check` 通过；浅色主题和真实业务失败回执尚未单独执行。

### 2026-10-22 Toast 操作内联与 Provider 标题窄屏（本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=agent`，未使用 9998）在 320×700、390×844 与实际 CSS 视口 1152×720 下，直接向现有 notification store 注入带“重新读取”action 的警告通知，并读取模型 Provider 标题边界；未触发真实设置重载、保存或其他业务写入。

320px 下警告 Toast 为 `296×92.75px`，图标 `28×28px`、说明正文左缘 62px，action 按钮为 `72×28px` 并接在文案末尾；390px 下卡片为 `366×73.38px`，桌面为 `340×97.9px`，三档 `scrollWidth=clientWidth` 且文档无横向溢出。单独注入成功、警告、失败三条 Toast 时，390px 高度分别为 `56px`、`73.38px`、`73.38px`，强调色分别命中绿、黄、红语义色。模型 Provider 标题行在 320px 下由 `94.59px` 恢复为 `63px`，390px 同为 `63px`，标题组、计数、说明入口和“添加”按钮保持同行，标题容器 `scrollWidth=clientWidth`。

证据：`/tmp/toast-layout-320-polished.png`、`/tmp/toast-layout-390-polished.png`、`/tmp/toast-layout-1440-final.png`、`/tmp/toast-three-kinds-action-final.png`。验证后已清除注入通知。目标 Vue/CSS ESLint、Prettier、`pnpm --filter @nexus-terminal/frontend build`、根 `pnpm run check` 与 `git diff --check` 通过；按 D17 未运行本地业务测试、E2E 或测试收集，真实设置重载与窄屏键盘操作仍随既有回归覆盖。

### 2026-10-22 高级维护移除插件安装与运行态入口（本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=data`，未使用 9998）展开“诊断与恢复（高级）”。390×844、320×700 与实际 CSS 视口 1152×720 下均只显示“宿主诊断”和“机器突变恢复”；“安装恢复与升级包、插件数据与迁移、已安装版本目录、运行态核对”文本计数均为 0，`[data-agent-maintenance]` 节点计数为 0。三档文档宽度分别为 390、320、1144/1152，未产生页面级横向溢出，控制台无运行异常。

宿主诊断仍读取到真实运行时、运行时长、内存、数据库版本和采集时间；机器突变恢复仍显示 warning 说明、权威列表与空态。`preset-plugin.spec.ts` 已删除从高级维护打开运行态下拉并核对三项安装的断言，改为断言两个保留分区可见、两个已移除分区不可见。目标 Vue/TS ESLint、Prettier、Frontend build、根 `pnpm run check`、全量格式检查与 `git diff --check` 通过。证据：`/tmp/advanced-without-agent-maintenance-390.png`、`/tmp/advanced-without-agent-maintenance-320.png`、`/tmp/advanced-without-agent-maintenance-1440.png`。按 D17 未运行完整远程 E2E；普通插件页安装／升级和卸载后数据删除仍由既有场景覆盖。

### 2026-10-22 设置关于双卡布局（本地 CDP）

使用本地 CDP（`https://api.honus.top/settings?tab=about`，未使用 9998）核对版本与项目地址布局，未点击更新链接、仓库链接或写入测试环境设置。桌面请求 1440×1000（实际 CSS 视口 1152×720）下“应用信息”分组宽 `780px`，版本与项目地址两卡各 `367px`、高约 `60px`；390×844 和 320×700 下自动单列，卡宽分别为 `328px` 和 `258px`。三档均保持设置分组内边距，仓库文本在卡内收起，文档无页面级横向溢出，控制台无运行异常。

版本卡继续显示 `v1.0.2` 与“已是最新版本”状态，项目卡显示 `0honus0/nexus-terminal` 和外部链接图标；检查中、发现更新、检查失败的分支沿用原逻辑。目标 Vue/JSON Prettier、Vue ESLint、`pnpm --filter @nexus-terminal/frontend build`、根 `pnpm run check`、全量格式检查和 `git diff --check` 通过。证据：`/tmp/about-after-1440.png`、`/tmp/about-after-390.png`、`/tmp/about-after-320.png`。按 D17 未运行完整 E2E，未提交、推送或部署。

### 2026-10-22 Toast 操作区与材质（本地 CDP）

使用本地 CDP（`https://api.honus.top/`，未使用 9998）通过现有 notification store 注入成功、带“重新读取”的警告和失败三条通知；未触发真实保存、重读或业务写入。Toast 已改为无左侧状态图标的“状态标题 + 正文 + 底部确认按钮”，右上仅保留关闭按钮；成功通知的确认文案为“知道了”，带恢复动作的警告和失败显示原动作。

实际 CSS 视口 1152×720 下桌面 Toast 宽 `288px`，成功/警告/失败高度分别为 `138.4px`、`138.4px`、`119.4px`，按钮 `84×28px`；390×844 下宽 `350px`，高度分别为 `122px`、`141px`、`122px`，按钮 `88×30px`；320×700 下宽 `280px`，高度分别为 `141px`、`141px`、`122px`，按钮 `88×30px`。三档按钮右缘均与关闭按钮精确对齐，卡片 `scrollWidth=clientWidth`，文档宽度分别保持 `1144/1152`、`390/390`、`320/320`，无页面级横向溢出。

点击“知道了”后成功通知被移除；点击失败通知的“重新读取”后业务动作只执行一次，通知保留。卡片改为接近不透明的中性主题底与低饱和状态渐变，语义色收敛到标题、细边框和按钮，验证后已清除注入通知。证据：`/tmp/toast-layout-v7-desktop.png`、`/tmp/toast-layout-v7-390.png`、`/tmp/toast-layout-v7-320.png`。目标 Prettier、Vue/CSS ESLint、Frontend build、根 `pnpm run check`、全量格式检查和 `git diff --check` 均通过；按 D17 未运行完整 E2E，未提交、推送或部署。

### 2026-10-22 Workspace 状态骨架、趋势窗口与网络卡响应式（本地 CDP）

使用本地 CDP（`https://api.honus.top/workspace`，未使用 9998）连接 `amd` 目标。窄栏状态区约 `90.6×92.8px` 时，加载态显示 1 个紧凑 Spinner、可读状态文字和 5 张与最终指标同尺寸的骨架卡，`scrollWidth=clientWidth`；临时扩展到 760px 后骨架自动重排为 2 列，未出现横向溢出，验证后已还原临时预览条件。

展开 CPU 趋势后，历史模式资源列表高度由错误的 `124.8px` 恢复为 `80px`，图表容器获得实际高度；5 分钟视图仅采集约 1 分钟数据时，折线按实际跨度铺满图表，不再集中在左侧留下大块空白。网络卡在 520px 与 760px 宽度下保持标题/吞吐上下结构，标题到吞吐行间距约 `4.7px`，大宽度网络行固定为 `64px` 并居中于 `34rem` 信息带内；中/大宽度断点分别降低为 `150px`、`180px` 高度门槛，760×214px 状态栏不再落回单列。

证据：`/tmp/nexus-loading-narrow.png`、`/tmp/nexus-loading-wide.png`、`/tmp/nexus-history-tall.png`、`/tmp/nexus-network-layout-full.png`。目标 Vue/TS ESLint、Prettier、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过。按 D17 未运行完整 E2E，未提交、推送或部署。

### 2026-10-22 Workspace 命令栏单行与响应式（本地 CDP）

使用本地 CDP（`https://api.honus.top/workspace`，未使用 9998）连接 `amd`。实际 CSS 视口 `819×378` 下，窄命令栏 pane 为 `123.8×38px`，输入区 `85.8×30px`，“更多”按钮 `22×22px`；菜单完整显示搜索、焦点配置、文件管理器、编辑器和清空终端 5 项。打开搜索后输入框 `54.2×28.4px`，仅保留关闭按钮，上下键与 Enter/Shift+Enter 继续承担查找，不再让三个搜索按钮挤占输入。

临时扩大到 CSS 视口 `3000×1120` 后，命令栏 pane 为 `464.8×50.1px`，输入区 `300.8×34px`，5 个工具按钮均为 `28×28px`，“更多”菜单隐藏。手机 UA 390×844 下命令栏 `390×38px`，输入 `116×30px`，工具区 `258×30px` 内按钮均为 `30×30px`；320×700 下命令栏 `320×38px`，工具区 `154×30px`、`scrollWidth=286`，只横向滚动工具按钮。两档手机文档宽度均保持 390/320，无页面级横向溢出。

桌面和手机检查后均还原临时视口/UA。证据：`/tmp/cmdbar-after-reload.png`、`/tmp/cmdbar-menu-final.png`、`/tmp/cmdbar-search-final.png`、`/tmp/cmdbar-wide-final.png`、`/tmp/cmdbar-mobile-ua-final.png`、`/tmp/cmdbar-mobile-320.png`。目标 Vue/JSON ESLint、Prettier、Frontend build、根 `pnpm run check`、全量格式检查和 `git diff --check` 通过；按 D17 未运行完整 E2E，未提交、推送或部署。

### 2026-10-22 文件管理器工具区、空态与响应式（本地 CDP）

使用本地 CDP（`https://api.honus.top/workspace`，未使用 9998）连接 `amd` 并打开文件管理器。窄 pane 实测 `123.9×155.4px`，工具条 `33.8px`、路径栏 `87.9×27px`、“更多”按钮 `24×24px`；菜单 `240×169.6px` 完整显示终端、同步、刷新、搜索、编辑器、上传、新建文件夹、新建文件、收藏 9 项，无滚动；路径历史 `115.9×107.4px`，仅自身纵向滚动。搜索行高 `63.8px`，输入自动聚焦；新建弹窗 `448×192.3px`，无溢出。中等宽度文件列表 `clientWidth=472`、`scrollWidth=472`，未出现横向滚动。

实际 CSS 视口 `819×378` 下，空目录 `/lost+found` 的居中空态为 `777.6×84px`；在该目录搜索无匹配文本时显示“未找到匹配的搜索结果”，列表区 `778×187px` 且 `scrollWidth=clientWidth`。访问不存在路径时错误态为 `757.6×171.4px`；模拟外部文件 `dragenter` 后覆盖层为 `761.6×251.2px`，移出后恢复列表，未上传文件。搜索等待期间读取态为 `777.6×187.4px`，随后正确切换为空结果。

手机 UA 390×844 下文件管理器 `356×662.4px`，工具条 `70px`，完整工具按钮可见；320×700 下为 `286×540px`，工具条 `40px` 并自动显示“更多”，菜单 `240×223px` 完整显示 10 项。两档文档宽度分别保持 390/390、320/320，无页面级横向溢出。检查后已恢复视口、UA、触控和缩放。

证据：`/tmp/fm-menu-final.png`、`/tmp/fm-history-final.png`、`/tmp/fm-search-final.png`、`/tmp/fm-dialog-final.png`、`/tmp/fm-context-final.png`、`/tmp/fm-rename-final.png`、`/tmp/fm-chmod-final.png`、`/tmp/fm-medium-final.png`、`/tmp/fm-empty-directory-final.png`、`/tmp/fm-empty-search-final2.png`、`/tmp/fm-error-final.png`、`/tmp/fm-drag-final.png`、`/tmp/fm-mobile-390-panel.png`、`/tmp/fm-mobile-390-search.png`、`/tmp/fm-mobile-390-dialog.png`、`/tmp/fm-mobile-320-panel.png`、`/tmp/fm-mobile-320-menu.png`、`/tmp/fm-mobile-320-dialog-correct.png`。目标 Vue/JSON ESLint、Prettier、Frontend build、根 `pnpm run check`、全量格式检查与 `git diff --check` 均通过；按 D17 未运行完整 E2E，未提交、推送或部署。

### 2026-10-22 Workspace 可用面板与编辑器响应式（本地 CDP）

使用本地 CDP（`https://api.honus.top/workspace`，未使用 9998）登录现有测试账号并连接真实 `amd` 目标；临时布局只把连接列表、Docker、命令历史与文件编辑器放入 pane，核对后恢复原布局。三档视口下四面板均无横向溢出：CSS `819×378` 时连接列表 `143×120px`、Docker `143×141px`、历史 `269×109px`、编辑器 `269×151px`；CSS `922×640` 时为 `161×240`、`161×282`、`304×219`、`304×303px`；CSS `1280×720` 时为 `225×277`、`225×325`、`426×253`、`426×349px`。文档宽度在三档均未超过视口。

窄栏连接列表“分组操作”菜单完整显示“连接全部、管理标签、删除分组内所有连接”3 项；Docker“更多操作”完整显示“移除、进入、日志”3 项，宽栏直接渲染 6 个动作。命令历史通过一次安全记录写入取得真实数据态，显示命令与时间，核对后已用 DELETE 删除该测试记录；没有执行该命令。打开 `/etc/hostname` 检查编辑器，弹窗为 `756×354px`，标签、`/etc/hostname`、作用域、`UTF-8`、`LF`、搜索、重载、保存和关闭完整显示；未保存远程文件。

证据：`/tmp/available-panels-final-819.png`、`/tmp/available-panels-final-1152b.png`、`/tmp/available-panels-final-wide2.png`、`/tmp/editor-popup-final-current.png`。目标 Vue/JSON ESLint、Prettier、Frontend build、根 `pnpm run check`、全量格式检查与 `git diff --check` 通过；按 D17 未运行完整 E2E，未提交、推送或部署。

### 2026-10-23 文件管理器弹窗吸附与宽屏工具栏（本地前端 9998）

使用本地前端 `172.30.30.10:9998`、后端 `127.0.0.1:3001` 和现有测试账号打开真实 `amd` 连接的文件管理器；请求保留 `X-Forwarded-Host: api.honus.top` 与可信 Origin，未改动远端文件。桌面 `1024×900` 下弹窗 `896px`，8 个工具按钮在宽屏等分为 `106.5×32px`、排序行 `880px`；工具、路径、排序三者纵向间距均为 `6px`，列名表头文字不再显示。

真实拖拽与重开验证：宽度 `270px` 或 `290px` 均吸附为 `280px` 单行 8 枚，按钮行计数 `[8]`；继续向左拖到最小值时稳定在 `170px`，工具行计数 `[4,4]`，释放并重新打开后仍为 `170px / [4,4]`。`320px` 视口下弹窗为 `280px`，同样保持单行 8 枚；未出现命令栏、挂起会话或页面级横向溢出。

证据：`.tmp/filemanager-1024.png`、`.tmp/filemanager-320.png`、`.tmp/filemanager-resize-minimum.png`。目标 Prettier、Vue/TS ESLint、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过；未提交、推送或部署。

### 2026-10-23 文件管理器工具区对齐与分栏热区（本地 CDP）

使用 `https://api.honus.top/workspace`（未使用 9998）登录现有测试账号并连接真实 `amd`，在 CSS 视口 `1920×953` 下核对内嵌文件管理器。工具行与路径栏实测同为 `241.015625px`，左右坐标完全一致；工具按钮左右留白均为 `5px`。宽拖后释放为 `281.703125px`、按钮行计数 `[8]`；向左拖至最小宽度后吸附为 `169.828125px`、行计数 `[4,4]`，按钮左右留白均为 `4px`。`1×8` 释放后保持 `[8]`，不再回落到 `7+1`。

分栏视觉线仍为 1px，透明拖拽热区扩展到 splitter 两侧约 16px。将指针放在 splitter 中心左侧 12px（已超出 9px 原生 splitter 区域）按下并拖动，文件管理 pane 从 `246.546875px` 调整到 `230.296875px`，证明扩展热区实际参与命中；随后恢复正常中心拖拽，未修改远端文件。

证据：`.tmp/fm-embedded-1x8-cdp.png`、`.tmp/fm-embedded-2x4-cdp.png`、`.tmp/cdp-drag-splitter.mjs`、`.tmp/fm-embedded-cdp-probe.mjs`。目标 Prettier、目标 ESLint、Frontend build、根 `pnpm run check` 与 `git diff --check` 通过；全量格式检查仅因并行修改的 `BackupSettingsPanel.vue` 既有格式失败，未改动该无关文件。本轮为本地 CDP UI 验收，不替代完整 E2E；未提交、推送或部署。

### 2026-10-23 前后端性能优化（仅静态与产物）

范围：连接目录事务批读、SQLite Worker 语句 LRU、监控按请求主机计算及复核指纹、连接列表排序/检索索引与线性标签分组、单层列表 memo、后台 xterm 解析批次调度、RDP WASM 资产拆分。未变更 UI 样式、布局和操作入口。嵌套分组保留原渲染，完整 DOM 与键盘/滚动访问保持；Monaco 已按需加载，本轮未删除编辑功能。

证据：根 `pnpm run check`、双端 `pnpm run build` 通过；全量格式初次通过，最终重查受并行修改的 FileManager.css 格式影响，未改动该 UI 文件；本轮性能文件单独检查。构建插件及 Vite 配置补充独立严格 TypeScript/ESLint 检查。RDP 构建 JS 为 52,275 字节，WASM 为 4,511,023 字节（原内嵌 Base64 为 6,014,700 字节），二进制 SHA-256 为 `68b5c65280e5348ea418cd0aba2e4e28f9bd4051c2cf9fd4b84d721847ef3363`，与依赖中内嵌内容逐字节一致；产物 JS 正确引用 hash WASM，首页 HTML 未直接引入该资产。日志为 `/tmp/nexus-performance-{check,format,build,build-types}.log`。

按 PLAN D17 未运行本地行为、浏览器或 E2E，未测真实 CPU/网络收益。远程需核对大目录完整元数据/标签/跳板、监控同主机多凭据回退与配置变更冲突、定向刷新不驱逐其它主机、多 SSH 隐藏刷屏与前台切换/续接/关闭的输出完整和消费顺序、列表搜索排序/选择/语言/高亮，以及 RDP 冷/热缓存连接与部署 WASM MIME/压缩。静态通过不等于上述行为已验收；本轮按用户授权提交性能修改，不含并行 UI/安装功能，未推送或部署。

两轮复审：第一轮复核目录事务/关联解码、监控配置与授权失效、SQLite 语句缓存淘汰、终端 flush/drain/discard 及消费确认，补齐连接列表 memo 的相对时间失效，避免文案停留在旧时间。第二轮复核 15 文件的独立暂存内容，工作区目录仅保留检索/分组优化，排除对未提交 launchpad UI 的依赖；通过暂存快照另建临时目录，仅执行类型、格式及双端构建。独立证据日志为 `/tmp/nexus-performance-isolated-{check,format,build}.log`；此快照没有工作区的 FileManager.css 格式修改。

### 2026-10-23 RDP 弱网输入与透明桥调度（仅静态）

RDP Adapter 将文本从逐字符 SDK 调用改为最多 32 个完整字符一批，普通按键立即提交，失败停止后续批次且不重试。mousemove 使用实例内 16ms timer 合并最新坐标，按键、滚轮、点击及 releaseAllInputs 前提交最后位置；按钮与位置同事务，窗口外 mouseup 同样保留释放顺序。关闭、失焦与切文本输入清理待发送 timer，原 IME 去重与 64 KiB UTF-8 整体预检保留。透明桥不再每次 send 都暂停 TCP，按 WS bufferedAmount 的 64/16 KiB 高低水位调度；原双向有界缓冲、协议字节顺序、失败关闭及全部发送回调收敛保持，VNC 共用这一透明桥。

首轮根 check、全量格式及双端 build 通过；源码复审补齐文本失败后停止后续批次。第二轮核对独立 6 文件提交快照，检查事件顺序、按键释放、慢消费者的暂停/恢复、并行发送失败及 close 等待，快照静态检查、全量格式及双端构建通过。复审进一步将批次限制为 32 完整字符，计入非 BMP 字符可能生成的 UTF-16 代理对按下/释放与指针事件；最终源码补充检查和前端构建通过，补充日志为 `/tmp/nexus-rdp-input-isolated-final-{check,format,frontend}.log`。其余日志为 `/tmp/nexus-rdp-input-{check,format,build}.log` 与 `/tmp/nexus-rdp-input-isolated-{check,format,build}.log`。

按 D17 未运行本地行为、浏览器或 E2E，也未注入真实弱网。远程需回归普通键/长按/组合键、中英 IME、跨批次与非 BMP 字符文本、换行/Tab、鼠标洪泛时键盘输入、拖动最终坐标与窗口外释放、失焦/切换/关闭无晚输入，以及 RDP/VNC 的弱网长时间传输、缓冲排空与发送错误后的真实关闭。静态通过不证明实际输入延迟已改善；本轮沿用用户的两轮复审及提交要求，仅提交这些变更，不推送、部署或重启后端。

## 外观自定义导航统一（2026-10-23，本地 CDP）

使用 `https://api.honus.top/settings` 打开“外观 → 自定义外观”，把原 128px 侧栏内四个 111×28px 纯文字按钮改为与设置页同类的图标导航。桌面侧栏宽 184px，每项 159×44px，图标底座 28px，选中项使用主题色边界、左侧 2px 指示线和图标着色；窄屏改为图标在上、文字在下的四项等分标签。

`1440×1000` 下弹窗为 `1000×700`；`768×900` 时侧栏仍为纵向 `183px` 内容宽；`390×844` 与 `320×700` 下导航 `clientWidth=scrollWidth`，四个标签分别在 `390px` 内占 `88px`、在 `320px` 内占 `70.5px`，无横向溢出或截断。依次切换界面样式、终端样式、背景设置、其他设置，选中项与面板均正确更新。证据：`.tmp/appearance-customizer-nav-desktop.png`、`.tmp/appearance-customizer-nav-mobile.png`。目标 Prettier/ESLint、根 `pnpm run check`、Frontend build 与 `git diff --check` 通过。

### 2026-10-23 前端首屏与静态交付（仅静态与产物）

范围：首屏原静态依赖分组、弱网/省流/后台停止路由预取、构建 gzip 旁文件、哈希字体/图片缓存与 Docker 构建插件目录复制；保持 UI 源码与操作入口。首轮同一工作区构建的 HTML 直接 JS/CSS 引用从 54 个降到 5 个，原始字节从 1,746,867 降至 1,733,350，统一 gzip-9 从 508,603 降至 483,349；该工作区含并行 UI 修改，不能跨不同源码比较实际时延。321 个 gzip 旁文件逐一解压后与原文件完全一致，均达到至少 1 KiB 且压缩更小，包含 index.html。远程桌面、编辑器及文件预览继续动态加载。

两轮审核完成：首轮复核分包标签、压缩并发、预取前复查及缓存匹配优先级，修复 Dockerfile 未复制前轮新增 build 插件目录、哈希字体图片被七天规则覆盖的问题。根 check、全量格式、Frontend build 与构建插件的独立严格 TypeScript/ESLint 检查通过，日志为 `/tmp/nexus-front-delivery-{check,format,build,plugin-check,plugin-lint}.log`。第二轮对仅含本次 10 文件变更的暂存快照执行根 check、全量格式、Frontend build 和插件专项静态检查，均通过；日志为 `/tmp/nexus-front-delivery-isolated-{check,format,build,plugin-check,plugin-lint}.log`。独立快照首屏同为 5 个引用（原始 1,720,614 字节、gzip-9 482,020 字节），314 个 gzip 逐一解压一致，WASM 二进制校验保持原 SHA-256。通过 JS AST 追踪全部首屏静态导入，只有 runtime/vendor/core 三个 JS，TerminalView、Monaco、RDP 与 PDF/表格/文档/数据库预览均不在静态闭包内；产物证据为 `/tmp/nexus-front-delivery-artifacts.log`。

独立快照的 `docker build --target frontend-builder` 通过，日志为 `/tmp/nexus-front-delivery-docker-final.log`；生产配置在现有 Alpine Nginx 1.30.4 镜像中通过 `nginx -t`，确认包含 gzip_static 模块，日志为 `/tmp/nexus-front-delivery-nginx.log`。DEPLOYMENT 代理示例补齐临时 http/server 外壳后通过本机 Nginx 配置静态检查，日志为 `/tmp/nexus-front-delivery-proxy-example.log`。仅构建自有校验镜像和检查配置，未启动应用服务。

按 PLAN D17 未运行本地行为、浏览器或 E2E；未测试真实压缩协商、冷/热缓存、路由视觉与弱网导航耗时，也未部署、重启服务或修改实际边缘代理。远程需回归登录/主页/Workspace/设置的路由、重功能动态加载、PDF worker、缺失资产返回 404、gzip/identity 协商、HTML/SW 更新与 hash 字体图片缓存；静态请求数下降不证明端到端延迟。本次仅提交上述变更，不含并行 UI/安装功能，不推送。

### 2026-10-23 RDP 尺寸与接收调度（仅静态）

范围：RDP 150ms 尺寸稳定后提交、基于初始协商尺寸及有效 DPI 去重；后端同 I/O 轮小块按序合并至最多 16 KiB，单块达到阈值立即发送，尾部不等待凑满，正常读端结束先提交，关闭清理 immediate/暂存数据。VNC 保留逐块派发，原 64/16 KiB 水位、4 MiB 缓冲保护和真实发送回调收敛保持；输入、SDK 二进制、图像解码/质量与 UI 源码不变。

已对照固定 IronRDP 0.7.0 发布源码核对：Session.desktopSize 读取初始协商结果且返回需释放的 DesktopSize；resize 仅向 SDK 通道提交，不是远端应用确认。SDK 使用 AsyncRead/LocalFuturesFramed 读取 WS 字节流，不依赖远端每个 TCP chunk 的 WS 边界；softbuffer 局部绘制保持原实现。首轮审核将拟定 64 KiB 小块合并收敛为 16 KiB，避免弱网等待大 WS 消息，并补正常读端结束的尾部提交。

工作区根 check/build 与全量格式日志为 `/tmp/nexus-rdp-display-{check,build,format}.log`；全量格式通过。当时根 check/build 曾受并行 UI 新增四个 command-bar 偏好与 Frontend UserPreferences/Backend StoredPresentationPreferences 转换不一致影响；该偏好链路后续已补齐并通过根 check/build，本轮未改动该 UI/协议工作区。

第二轮对仅含本次六文件的暂存快照复审 initial/DPI/快速恢复原尺寸、晚建连与关闭取消，以及片段顺序、阈值、大块、EOF、背压恢复与失败收敛；独立快照的根 `pnpm run check`、`pnpm run format:all:check`、双端 `pnpm run build` 通过，日志为 `/tmp/nexus-rdp-display-isolated-{check,format,build}.log`。产物确认后端仍按 16 KiB 合并并取消 immediate，前端 WASM 仍为 4,511,023 字节且 SHA-256 与前轮相同，gzip 解压一致。本轮只提交这六文件，不含并行 UI/安装功能，不推送或部署；需要更新前端并重启后端加载新实现，未代为重启。

按 D17 未运行本地行为、浏览器或 E2E，也未注入弱网；后续远程需回归初始/动态尺寸、非默认 DPI、拖动中快速返回原尺寸、全屏/最小化恢复、尺寸待提交时关闭/切连接，以及小块/大块/混合 PDU、背压排空、远端 EOF 和发送失败后的关闭。不将静态通过写成真实延迟或分块显示已消除。

## Agent 文件与会话视图缓存（2026-10-23，本地 CDP）

使用 `https://api.honus.top`、真实登录会话和 Agent 浮窗核对。首次进入“文件”视图发生时，Network 收到 `/api/v1/agent/files?q=&limit=20&offset=0`、`/api/v1/agent/files/storage` 与 `/api/v1/agent/apps`；切换到“会话”后收到 0 个 `/api/v1/agent/` 请求，再切回“文件”仍为 0 个。两侧组件保持挂载，已加载列表与选择状态未被清空。

本实现只在 Agent 文件/会话视图切换中启用显式保留；首次进入、筛选变化、显式重试、写入后失效、读取失败和认证身份失效仍执行原有重新读取或清理。未执行真实多文件列表、活跃 Run 轮询恢复、附件上传及登录失效竞态；未修改远端文件或配置。目标 ESLint、Prettier、根 `pnpm run check`、Frontend build 与 `git diff --check` 通过。

### 2026-10-23 工作区设置移除重复布局入口（本地 CDP）

在 `https://api.honus.top/settings?tab=workspace` 的 `1440×900` 视口确认“布局与高级设置”分组已移除，工作区设置面板内不存在 `layoutLocked` 与 `navBarVisible` 控件；对应偏好字段仍由接口返回，布局配置器和终端标签栏的顶栏显隐按钮继续作为实际开关。证据：`.tmp/settings-workspace-advanced-removed.png`。目标 Prettier、根 `pnpm run check`、Frontend build 与 `git diff --check` 通过。

### 2026-10-23 文件管理器终端目录在用户输入后仍可用（本地 CDP）

使用 `https://api.honus.top/workspace` 的真实 `amd` SSH 会话核对。Workspace 建连后先向终端输入普通命令，再点击“从终端同步当前路径”，文件管理器从 `/` 更新到终端当前目录 `/root`；随后在文件管理器进入 `/etc` 并点击“将终端目录切换到当前路径”，收到 `terminal.directoryChangeQueued`、请求回执和 `terminal.directoryChanged`，终端提示符进入 `/etc`，再次同步仍得到 `/etc`。

终端初始输出不再包含内部 PID 探测、`PROMPT_COMMAND` Hook、`stty -echo` 或 `__NEXUS_*` 标记；内部初始化成功后只保留登录 banner、正常提示符和用户实际执行的命令。证据：`.tmp/fm-directory-verified.png`。根 `pnpm run check`、双端 build、目标 Prettier 与 `git diff --check` 通过；新增 SSH 场景已加入 `tests/e2e/specs/ssh/terminal-protocol.spec.ts`，本轮未运行整套远程 E2E。

### 2026-10-23 工作区连接列表排布（本地 CDP）

使用 `https://api.honus.top` 的真实登录会话核对启动页连接列表：`1440/1024/768/640/390/320` 六档宽度下搜索框和添加按钮均保持 `40px` 高，提示为“搜索连接”，列表与页面均无横向溢出。进入真实 `amd` 会话后，终端紧凑连接栏在 `225px` 宽时搜索/添加均为 `32px`，连接行 `44.8px` 并显示主机与最近时间；模拟 `180px` 极窄栏时信息自动退回单行 `27.5px`，工具栏仍无溢出。选中项左侧细高亮、分组菜单和原连接打开流程保持可用。证据：`.tmp/workspace-connections-after-1440.png`、`.tmp/workspace-connections-after-390.png`、`.tmp/compact-final-verified-225.png`、`.tmp/compact-final-verified-180.png`、`.tmp/cdp-workspace-final-verified.png`。根 `pnpm run check`、Frontend build、目标 Prettier/ESLint 与 `git diff --check` 通过；未运行整套远程 E2E。

### 2026-10-23 Agent 设置移动端右边界对齐（本地 CDP）

使用 `https://api.honus.top/settings?tab=agent` 与真实登录会话核对。隐藏手机端设置画布滚动条后，Agent 面板仍保留 `12px` 的滚动条占位；现仅在 `1023px` 以下将面板右侧内边距归零。`390×844` 下画布与“Agent 功能”首卡右缘同为 `370px`；`320×700` 下同为 `300px`，偏差 `0px`。两档画布滚动条宽度均为 `0`，内容 `scrollHeight` 大于可视高度且仍可触控滚动，文档无页面级横向溢出。桌面 `1440×900` 仍保持 Agent 面板 `12px` 右内边距、画布稳定滚动条槽和原布局。证据：`.tmp/agent-settings-right-align-390.png`、`.tmp/agent-settings-right-align-320.png`。目标 ESLint、Prettier、Frontend build、根 `pnpm run check`、全量格式与 `git diff --check` 通过；未运行整套远程 E2E。

### 2026-10-23 设置与通知渠道细节收口（本地 CDP）

使用 `https://api.honus.top` 与真实登录会话核对。`390×844`、`320×700` 与 `280×700` 下 Agent App 操作区均为 `3` 列；`390px` 时三枚按钮宽度约 `125.72/93.14/93.14px`，`320px` 时约 `97.52/72.23/72.25px`、`top` 完全一致，容器 `scrollWidth=clientWidth`；`280px` 时约 `81.39/60.30/60.31px`。安全策略盾牌在 `360–639px` 显示、`359px` 以下隐藏，手机三档文字仍完整。外观设置首个无正文卡片高度由 `90px` 降至 `58px`，空 body 不再渲染；自定义外观在 `768/1024/1440px` 使用 `136px` 侧栏、每项 `115×52px`；手机收起时只显示当前分类选择器，`390/320px` 宽 `358/288px`、高 `46px`，展开面板与触发器同宽，四项均为 `46px` 单列行，选择后菜单关闭且面板标题同步切换；所有宽度均无横向溢出或页面错误。图标与文字作为整体在控件内水平居中；选中项左侧 `2px` 高亮线为绝对定位，不再挤压内容。

通知页创建临时 Webhook 渠道后，通过卡片按钮完成启用和停用，两次 PUT 均成功并收到成功 Toast；`390/320px` 下启用/编辑/删除三按钮同排且无横向溢出，随后通过确认弹窗删除临时渠道，剩余匹配项为 `0`。快捷按钮按点击后的动作着色：启用动作为绿色开启图标，停用动作为红色关闭图标，图标、按钮文字、底色和边框均使用对应语义色；启用态实测按钮文字与图标为 `rgb(220, 53, 69)`，停用态为 `rgb(40, 167, 69)`。文件管理器进入 `/etc` 后，名称文字中心相对图标中心上移约 `2.97px`，行高与虚拟列表未变化。`workspace/system/appearance/security/ipControl/data/agent/about` 八个设置标签以及外观弹窗正文在手机端均无可见滚动条，内容仍可滑动。添加 Provider 弹窗在 `390×844` 与 `320×700` 下正文 `padding-inline=0px`、`scrollbar-gutter=auto`、可见滚动条宽度 `0`，`scrollHeight` 大于可视高度且仍可滚动，正文 `scrollWidth=clientWidth`。证据：`.tmp/settings-round2-customizer-320.png`、`.tmp/settings-round2-customizer-390.png`、`.tmp/settings-round2-customizer-1440.png`、`.tmp/settings-round2-app-actions-320.png`、`.tmp/settings-round2-app-actions-390.png`、`.tmp/notifications-toggle-320.png`、`.tmp/notifications-toggle-390.png`、`.tmp/notifications-toggle-color-390.png`、`.tmp/notifications-toggle-color-red-390.png`、`.tmp/notifications-toggle-red-enabled-390.png`、`.tmp/fm-align-round2-1440.png`、`.tmp/security-shield-mobile-390.png`、`.tmp/security-shield-mobile-320.png`、`.tmp/security-shield-mobile-280.png`、`.tmp/provider-mobile-final-390.png`、`.tmp/provider-mobile-final-320.png`、`.tmp/appearance-nav-grid-1440.png`、`.tmp/appearance-mobile-switcher-320.png`、`.tmp/appearance-mobile-switcher-390.png`、`.tmp/appearance-mobile-switcher-open-320.png`、`.tmp/appearance-mobile-switcher-open-390.png`、`.tmp/appearance-mobile-switcher-desktop-1440.png`。目标 ESLint、Prettier、Frontend build、根 `pnpm run check`、全量格式与 `git diff --check` 通过；未运行整套远程 E2E。
