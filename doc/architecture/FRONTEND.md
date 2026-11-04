# 前端架构

本文记录 `packages/frontend` 的职责、边界与生命周期；后端实现见 [Backend](BACKEND.md)，双端协议见 [Shared](SHARED.md)，产品操作见 [USAGE](../USAGE.md)。按 [模块模板](MODULE_TEMPLATE.md) 维护设计；已执行验证及后继未验范围以 [testing](../testing/E2E.md#当前验收基线) 和 [PLAN](../PLAN.md) 为准。

## 1. 职责与范围

前端持有页面、编辑草稿、交互、展示状态及浏览器资源，不持有服务端权限、SQLite 事务或远端进程的权威。正式页面已消费 Shared；不保留旧 Protocol 或旧后端兼容桥。每个功能通过自己的公开入口与工作区技术 Port 协作，不由展示组件复制另一功能的状态仓库。

## 2. 子功能与目录

| 目录（相对 `packages/frontend/src`） | 职责                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `app`                                | main/bootstrap、路由、页面装配、shell、全局样式和语言安装。                                                                              |
| `features`                           | 按连接、终端、文件、传输、状态、认证、偏好与 Agent 等业务拥有组件、model、API、mapper、store/composable 和公开入口；以实际功能需要分层。 |
| `runtimes/workspace`                 | 工作区标签、RuntimeSession/Registry、布局与能力装配；通过 adapter 连接功能 Port 与同一 Workspace 生命周期。                              |
| `runtimes/remote-next`               | 独立远端开发入口；不代替正式 Workspace 消费者。                                                                                          |
| `client`                             | HTTP/二进制/Workspace 等传输与严格通信边界，持请求关联、取消及连接资源，不持业务草稿或服务端政策。                                       |
| `shared`                             | 前端共用反馈、布局等能力；与双端契约包 `packages/shared` 职责不同。                                                                      |
| `foundation`                         | 通用 UI、交互、浏览器、数据与异步基础能力，不反向依赖业务功能。                                                                          |

## 3. 依赖方向

页面/工作区装配 → 功能公开入口 → 功能内部 controller/store/API → client 与 Shared。组件通过本功能 model 或受控 props/事件消费状态；跨功能依赖走实际 public 出口，不能穿透私有 API/store。Workspace adapter 负责 Port 与实际传输的字段投影，终端功能不反向依赖 Workspace 实现。

Foundation 保持业务无关；具体编辑器、xterm、图表、插件 iframe 的技术资源在相应功能 owner 内管理。后端的 Service→Model→Storage、SQL 和 SSH Adapter 规则只在 Backend 维护。

## 4. 类型与转换

| 边界                     | 类型与转换 owner                                                              | 实际消费者                                |
| ------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------- |
| unknown 响应/事件 → wire | Shared codec 严格解码；持请求的 API/client 核对资源、版本、游标与字节范围关联 | HTTP、Workspace、插件 RPC                 |
| wire → 前端应用          | 功能 mapper 白名单转换为独立 model 类型，明确秒/毫秒、有限状态及可选语义      | store/controller 与展示组件               |
| 草稿/意图 → 请求         | 功能 API 显式构造 Shared 完整命令；身份来源仍由服务端验证                     | 表单、设置、终端与文件操作                |
| Runtime → 功能 Port      | workspace adapter 投影连接、目录、终端输出、传输与取消能力                    | TerminalView、FileManager、ProgressCenter |

本地通信失败与服务端安全失败分开；密码只保留在必要草稿/写请求和既定浏览器 SDK 内存，不能写入错误、URL 或缓存。Shared 不承载 DOM、响应式草稿、xterm 实例或组件引用。

## 5. 入口与安装

`app/main.ts`、bootstrap 与 router 安装全局依赖和页面；正式 Workspace 按当前身份和视图构建 runtime/功能能力。Agent Host 只匹配当前真实签名插件安装的 App/版本/hash/publisher；开启 Agent 的安装引导与总开关分别提交；确认引导新装时后端同时启用 App 和授予全部声明能力，普通市场安装和已有安装复用保留各自权限语义。DEV 页面仅作开发入口，不提供默认 App 或手工创建旁路。

重型编辑器、预览及图表沿实际异步入口加载；加载占位不伪造业务数据。现成全局确认、Toast 和 UiSelect 由基础组件统一呈现，具体动作与恢复仍归用例 owner。

## 6. 数据、事务与并发

服务端查询/确认回执是持久数据权威；前端维护草稿、已确认快照、选择与读取进度。CAS 冲突需重读核对，未知写入不自动重放；同一恢复围栏必须重读实际被修改的事实才能解除。读写串行、generation、scope/signal 及资源身份由真实 owner 控制，旧响应和旧 finally 不得回填新页面或覆盖新意图。

Workspace RuntimeSession 持普通与挂起附件的连接/续租，Registry 持标签和替换，Page 持装配及显式用户确认；终端展示只消费已确认的输入发送与输出。复制总进度由原累计字段投影，不能为展示递归扫描源树或维护第二份进度。

## 7. 生命周期与失败

视图失活、身份撤销、通道替换和组件卸载各自取消本次监听、计时和请求；已经派发的写入仍由原 owner 追踪收口。取消等待不等于远端停止；未确认的提交/关闭必须保留核对路径。确认框绑定原意图与视图，确认后派发前再次复核有效性。

终端的预测、快照、resize 与真实输出共用串行解析屏障；断线、挂起、后台和 PTY 替换先撤销预测。前台恢复同步可视几何并保留下一帧收敛，不重发输入或强制唤起软键盘。插件订阅/iframe、编辑器、图表及拖动监听按自身实例释放。

## 8. 当前能力与验收

正式认证、连接、工作区、文件、传输、偏好、远程桌面及 Agent Host 已对接当前 Shared。源码完成、专项静态/行为与远程全量基线分别记录；不得将早期“待 F1”当作现存未迁移功能，也不得把历史通过扩大为最新工作区保证。后端限制与副作用见 Backend/USAGE，不在前端文档复制整套后端设计。

以下保留前端特有设计；各轮日期与实测证据归 testing，当前待验统一承接于 PLAN。

## 前端专项设计

### Agent 最小化任务提醒

1. **职责与范围**：原生Surface继续拥有任务权威与写意图；Host仅呈现最小化时实际发生的任务状态、审批和失败变化，提醒短暂出现，不常驻或建立全局Run store。
2. **子功能与目录**：AgentAppSurface发布当前任务投影和窄审批能力；useNativeRuns持原订阅，agent-host-state按Surface实例登记；use-agent-task-notices持变化基线、合并队列、收起/过期计时；AgentLauncher和AgentTaskNotice呈现。
3. **依赖方向**：Surface/runtime → 本功能model/原API；Host投影 → Launcher/card → Foundation按钮；@floating-ui/vue 2.0.1已由Reka引入，Frontend显式声明直接依赖复用定位/flip/shift/size，不复用有全局FocusScope/DismissableLayer的弹出框承载自动提醒。
4. **类型与转换**：AgentTaskActivity及注册能力唯一归agent/model，复用NativeRun/Approval的有限状态及安全摘要；投影只带当前会话标题、状态、最多360字符结果、已确认用量/待审批和实例绑定动作。API与Shared白名单转换保持，无新后端契约或本地持久化。
5. **入口与安装**：仅minimized显示变化提醒，单纯最小化/普通文字/计数或语言变化不补弹；首个历史终态快照只作基线。同一实例任务更新合并，多实例顺序展示；新审批优先，正在悬停/键盘操作的卡片保持，8秒收起；悬停/键盘操作暂缓、触摸点击不永久暂停。卡片不自动聚焦或建立背景遮罩，Esc仅在卡片内处理，328px最大展示宽度再按真实可用宽高收缩。
6. **数据、事务与并发**：最小化可继续同一任务订阅和窄审批，创建/追加/取消与未知写重试仍要求完整活动界面。快速批准复查当前Run/Thread、最新审批版本/hash，再沿原快照意图/CAS/operationId提交；并发点击受原busy/blocked围栏，禁止重放或扩大授权。语言改变只更新文案，变化键使用原语义取值。
7. **生命周期与失败**：浏览器隐藏暂停原订阅和收起计时，恢复原游标续读；关闭/销毁/认证撤销停止观察，目录按App版本/启用状态过滤并删除对应提醒。每个Surface独立Symbol注册，旧卸载只能注销自己；晚更新不能恢复已注销项。提醒收起不影响任务，过期审批按最近真实expiresAt更新入口标记/按钮，不定时请求服务端；冲突/未知保留原完整任务核对路径。
8. **当前能力与验收**：仅已挂载原生Surface的当前任务，无全局任务发现或自定义插件虚构状态。源码/静态检查与真实UI/异步故障验收分别记录于testing；原553项正式通过不覆盖新增提醒，手机、键盘、最小化变化与审批故障待后续明确授权回归。

### 认证撤销后的通知隔离

1. **职责与范围**：正常退出取消原个人数据意图，不向登录页发布旧视图的请求失败；真实退出接口失败仍由AppHeader提示。
2. **子功能与目录**：shared/session拥有视图scope；命令历史/快捷指令组件拥有错误观察与刷新动作；WorkspacePage、布局controller和App拥有各自保存回调。
3. **依赖方向**：组件读取session公开能力；foundation保存器只回传原T，不引用认证或业务模块；后端/Shared契约保持。
4. **类型与转换**：LatestValueSaver.onError(error,value)绑定失败原值，工作区按原permission判断通知资格；无新协议或错误码。
5. **入口与安装**：既有useAuthenticatedViewScope在无会话时从已取消scope开始，attach可建立新scope，logout/切用户/销毁撤销；激活和available变化不能在无会话时重新准入。
6. **数据与并发**：通知及其重新读取动作核对原signal；尺寸、字体、缩放、列宽/侧栏与布局保存均不把晚失败关联到后来激活的页面。不改写入队列、CAS和未知结果围栏。
7. **生命周期与失败**：退出时清除原视图意图，原请求仍由store追踪收口；当前有效会话真实失败继续通知。远程桌面尺寸保存要求真实认证用户，避免null身份相等误报。
8. **当前能力与验收**：产品操作见USAGE安全与认证；本批按D17仅源码/静态和构建，真实退出/在途故障与重新登录待正式回归，具体证据归testing。

### 终端输出与缩放调度

1. **职责与范围**：减少终端翻页/连续输出和缩放的重复调度，不改变 DOM renderer、文字效果、滚动行为或协议。
2. **子功能与目录**：TerminalView 持字体目标值及几何 rAF；vendor/vscode-typeahead 的 TerminalTypeAhead 持有输入、输出和重置的有序队列。
3. **依赖方向**：View → 现有 FitAddon/TypeAhead → xterm；不引入新依赖、渲染器或跨功能调度器。
4. **类型与转换**：队列任务的 action/requiresParsedBuffer 为 vendor 单文件内部类型；字体继续消费 renderedFontSize，复用既有 Port resize 和原始输出 consumed 回调。
5. **入口与安装**：滚轮、触控捏合和外部字号变化共用原 useWheelScale；onApply 只请求一次几何帧，在可见且恢复完成后应用最新字号。主题观察只更新配色，字体族/scrollback 变化沿原几何入口。
6. **数据、事务与并发**：队列头为纯远端输出且无待匹配预测时，可直接按顺序提交 xterm；存在预测、输入或 reset/barrier 时仍等待前后解析屏障。切换快路径时继续执行原 beforeServerInput，保留分包内容、revision与样本清理；不跨过排队输入/重置。xterm 自身持有异步解析及时间切片，真实解析后才返回原 ACK。
7. **生命周期与失败**：视图失活/隐藏不应用待显示字号，激活/恢复重新调度；快照恢复先按原尺寸完成再fit，预测撤销屏障后的几何复测也读取最新字号。原rAF/timer注销、PTY generation、历史/快照及预测stop语义保持。
8. **当前能力与验收**：代码消除无预测输出的额外屏障和同帧重复字号应用，未实测端到端延迟/帧率；产品操作见USAGE终端章节，静态证据与待验场景归PLAN/testing。

### 终端目录等待提示

FileManager 沿原 TerminalDirectoryPort.changeDirectory 的 onQueued 消费 waitingForPrompt；仅当前视图与原目录能力仍有效时通知一次。真实等待期间提示未执行输入可按 Ctrl+C 清行后自动切换，已有前台命令则等待结束；不推断一定有草稿，不自动清行或保存输入。服务端排队、完成验证、失败与未知结果契约不变，正常成功静默。无新状态 owner、协议或技术资源；专项证据归 testing。

### 复制任务总进度呈现

1. **职责与范围**：ProgressCenter 区分复制/移动/跨服务器传输的总进度和当前文件，仅修改展示。
2. **子功能与目录**：沿 transfers/components/ProgressCenter 与三语 i18n，上传和归档保持原呈现。
3. **依赖方向**：原 controller/mapper/adapter 提供 TransferTask，组件只消费原字段。
4. **类型与转换**：原 progress、bytesWritten、totalBytes、completedFiles、totalFiles、currentFile、label 无变更；后台完成项数可以代表源项与目标组成的子任务，因此以“项”标注。
5. **入口与安装**：浮动、恢复及隐藏任务中的原 ProgressCenter 共用展示；标题使用任务 label，独立当前文件行，总进度文字同时作为进度条可访问名称。
6. **数据、事务与并发**：不维护第二份进度；已知总项数时与累计大小并存，未知总量不编造分母或递归扫描。
7. **生命周期与失败**：原取消、隐藏、终态过滤及未知结果围栏不变，无新增资源。
8. **当前能力与验收**：操作见 USAGE 复制章节；静态与指定站点 CDP 的组件受控任务验证证据归 testing，不扩大为真实跨服务器复制验收。

### 普通文本原生查找

1. **职责与范围**：仅file-editor普通文本查找由Monaco/CodeMirror各自管理，file-preview和文件列表搜索保持现状。
2. **子功能与目录**：FileEditor转发底部搜索按钮；MonacoEditor调用actions.find，CodeMirrorMobileEditor调用openSearchPanel；删除自定义FileEditorSearchBar和无消费者的搜索状态接口。
3. **依赖方向**：FileEditor→对应编辑器→已安装的库原生能力，不在父组件复制匹配状态或拦截全局Ctrl+F。
4. **类型与转换**：单文件组件引用只要求focus/openSearch本地能力，无Shared、Backend或存储类型变更。
5. **入口与安装**：桌面右上角原生查找，手机原生搜索面板由CodeMirrorMobileEditor局部样式适配深色三行网格，EditorState.phrases消费既有三语资源；底部按钮与正文焦点内快捷键共用原生能力。Codicon/find贡献仍在Monaco初始化前加载。
6. **数据、事务与并发**：匹配和高亮由库持有，不维护第二份匹配缓存或定时同步；替换沿原编辑草稿和显式保存链。
7. **生命周期与失败**：应用语言切换时重建原生面板并保留库的query、替换文本与选项，原editor/view销毁回收原生查找；不改变文档加载、只读、保存、缩放和标签生命周期。
8. **当前能力与验收**：USAGE文件管理器章节描述操作；专项CDP及静态证据归testing，其他预览不随本次恢复回退。

### 单连接凭据编辑与挂起前台恢复

1. **职责与范围**：Connections表单持编辑意图，Workspace Runtime持续租生命周期，Page持权威目录驱动的恢复；不增加自动卡死检测。
2. **子功能与目录**：沿connections form/editor/store/API、workspace RuntimeSession和WorkspacePage，目录复用ssh-suspend既有store。
3. **依赖方向**：表单→应用store→API→Shared；Page→既有RuntimeRegistry和ssh-suspend公开能力，不引入第二份会话权威。
4. **类型与转换**：更新提交显式传递可选credential，API构造Shared请求；空密码保留，明确勾选清除才发送null。草稿测试捕获当前输入，已保存密码不回显。
5. **入口与安装**：单连接编辑一次确认保存，移除独立凭据按钮和分开保存说明，保留测试信息提示；批量模式不变。前台恢复复用visibilitychange/pageshow入口。
6. **数据、事务与并发**：前台续租先向服务器复验再安排本地deadline；Page观察目录active/available集合变化，串行复用原reconcile与resumeReplacing，不新增轮询及超时。
7. **生命周期与失败**：generation、原实例、signal和可见性保护保留；续租无法确认显示operation_unknown，lease_expired仅来自服务端撤销。目录晚到仍恢复原PTY，其他owner不得静默接管。表单取消/失活清理秘密与旧测试。
8. **当前能力与验收**：USAGE连接管理/SSH挂起章节说明操作；CDP受控后台与真实SSH证据见testing，不能等同所有移动系统休眠实机验收。

### Artifact 总空间与分段文件传输

1. **职责与范围**：文件库消费总空间契约，移除已授权删除的单文件设置，其余UI保持不变。
2. **子功能与目录**：execution-types/mapper和ExecutionSettings同步字段删除；artifact-management-api拥有长度/版本/范围/hash关联，通用binary-client继续只负责技术传输。
3. **依赖方向**：功能API消费Shared和client；增量SHA-256复用成熟@noble/hashes，不自行实现hash。
4. **类型与转换**：Artifact metadata和begin字节上限随Shared总空间最大值；上传File不再先整体arrayBuffer，按4MiB分片增量hash，Blob请求直接交付不重复解包。
5. **入口与安装**：原上传/下载按钮与返回Blob契约不变，超过4MiB下载沿原content Range接口逐段获取，无新UI或轮询。
6. **数据、事务与并发**：每段验证原ID路由、etag、206/200、Content-Range、真实长度及末尾完整SHA-256；版本变化或段失败不交付部分文件。Blob分段组装避免单个巨大ArrayBuffer，实际仍取决于浏览器内存/Blob能力。
7. **生命周期与失败**：同一取消信号覆盖hash和各段请求，hash状态在finally销毁；无自动上传或未知写入重试。分段只缩小传输工作集，不作为存储上限。
8. **当前能力与验收**：双端静态和构建见testing；按D17大文件、取消、版本变化、窄设备真实资源占用待验。

### 挂起终端画面恢复的尺寸顺序

1. **职责与范围**：恢复原PTY画面时保留快照尺寸与实时输出尺寸，不改变UI设计。
2. **子功能与目录**：复用Remote WorkspaceService/WS、Shared suspend契约、前端Workspace terminal adapter及TerminalView/output writer。
3. **依赖方向**：后端应用提供快照和尺寸，WS投影事件；前端adapter转换为终端输出元数据，xterm操作仍由Terminal功能持有。
4. **类型与转换**：Shared `suspend.viewport`严格解码columns/rows及baseline/live阶段；应用PreparedSuspendedWorkspace持有独立viewport，接口逐字段投影；前端转换为TerminalOutput.viewport。
5. **入口与安装**：原suspend.resume先发送baseline尺寸再发送快照；resumeAck先发送live尺寸，再调整原PTY并释放实时输出，无新增用户入口。
6. **数据、事务与并发**：尺寸切换经过xterm解析队列屏障，容器测量等待恢复完成；同尺寸PTY resize直接返回，checkpoint按捕获的每次尺寸排队，先于相应重绘数据。
7. **生命周期与失败**：原ACK、背压、租约和失效清理保持；屏障绑定writer generation，旧PTY取消后不得调整新画面；本地重挂载快照同样等待解析完成才fit。
8. **当前能力与验收**：实现与静态证据见PLAN/testing；既有fullscreen恢复回归同步协议顺序断言，真实浏览器宽窄切换、正常/备用缓冲区及后台恢复按D17待远程验收。

### 挂起快照的活动屏幕滚动区域

1. **职责与范围**：补齐SerializeAddon 0.14未保存的DECSTBM滚动边界，使重绘中途的快照可接续增量输出；不识别特定TUI文案、不改变UI设计。
2. **子功能与目录**：Backend沿Platform headless-suspended-checkpoint技术Adapter，Frontend沿Terminal的terminalRuntimeModes tracker；各自管理原xterm实例。
3. **依赖方向**：复用已安装xterm及SerializeAddon，仅使用公开parser、buffer、modes与resize接口，不引用私有core、不向Shared放入厂商实现。
4. **类型与转换**：滚动区域使用1起始的技术行号，独立记录普通/备用缓冲区；CSI观察器返回false，接受/默认/裁剪规则匹配当前xterm。
5. **入口与安装**：快照继续使用原序列化入口，已有鼠标模式后追加活动屏幕的非默认滚动边界，再恢复DECOM与光标位置，避免设置区域时光标归位。
6. **数据、事务与并发**：状态随xterm解析更新，快照仍等待输出解析；软重置清当前区域、RIS与resize清两套区域，返回普通缓冲区清备用区域。
7. **生命周期与失败**：原tracker统一释放parser/resize/buffer监听，沿原快照失败与清理路径；仅补齐活动屏幕区域，不承诺序列化任意未闭合ANSI解析状态或非活动屏幕的自定义区域。
8. **当前能力与验收**：真实Codex分块数据在15个输出边界经双端实际实现回放，校准等价ANSI调色板编码后可见单元格无差异；后端9项定向回归、静态证据与实机边界见testing。回放不等于真实终端端到端验收，实际运行版本与实机覆盖按 testing 记录。

### 终端 VS Code TypeAhead 技术边界

1. 职责与范围：TerminalView 独占每个 xterm 的预测实例，不更改 UI 样式，不发送预测数据至远端。
2. 目录：`features/terminal/vendor/vscode-typeahead` 保留 Microsoft MIT 算法、固定来源 SHA 和适配说明；`xterm-attributes.ts` 集中验证 xterm 私有当前 SGR、光标可见性及滚动区域。
3. 依赖：TerminalView → vendor → xterm/mitt；不引入 VS Code 平台、遥测、设置服务或反向依赖 Workspace。
4. 类型与转换：TerminalChannel 可选 onInputSent 为技术 Port，只发布修饰键转换后且 WebSocket 实际接受的输入，拒绝/未发送内容不参与预测；无 Shared/存储契约变化。
5. 入口：Workspace adapter 成功 sendConnected 后通知订阅，Surface 转发；View 仅在可见、可输入的实时画面启用。按样本延迟/准确率选择预测，首字符先确认，Unicode/粘贴和复杂模式等待真实回显。
6. 并发：本地预测、远端输出和撤销经同一个 xterm 解析队列；远端 ACK 保留原始字节及原回调，只在真实解析后释放。部分CSI与仅光标显隐/报告帧不作为回显不匹配；退格前分包的SGR样式等待后续回显匹配并保留真实样式；连续DEL按解析顺序逐字读取撤销信息；右边界仅约束向前打印，未确认换行通过HardBoundary保留已有显示至真实输出收敛。同一行尾删除与尚未确认的字符建立覆盖关系，确认旧字符时只保留其样式，不重画已删文字；配对字符记录真实回显样式，合并回显解锁generation时即使单元格尚未解析，撤销删除仍可还原已确认内容。预测不可替代服务器输出或重放输入。
7. 生命周期：失活/后台、断线/错误、历史、resize、PTY替换和快照先撤销；snapshot 等待解析屏障；超时仅清理不可见探测，已显示的待确认编辑由实际回显或生命周期重置收敛；超时回调在串行队列中复验原timer身份，避免旧回调清除新输入。销毁取消 timer/标题订阅与样本订阅。旧 epoch 排队输入失效。备用屏幕、隐藏光标、原点/插入模式和滚动区内不预测；滚动区下方的普通输入行可参与，但不预测跨行滚动。
8. 验收：定向算法回放、真实 Codex 捕获流和组件/传输回归分别记录 testing/E2E；类型/构建不能代表真实弱网所有程序通过。不新增远端 helper 或改变现有输入流控。

### 工作区固定命令栏与纵向分隔条

1. 职责与范围：WorkspaceLayoutRenderer持有布局分隔条行为，不修改文件列表、终端渲染或UI样式。
2. 目录：原Workspace layout计算与Renderer；Splitpanes补丁归scripts/patches/splitpanes@4.1.2.patch。
3. 依赖：沿既有Splitpanes；仅包含commandBar的纵向容器开启pushOtherPanes，其余分栏保留相邻调整语义。
4. 类型：原LayoutNode及Splitpanes事件不变，不增加Shared/后端字段。
5. 入口：拖动或键盘调整经过同一库计算，命令栏38–42px约束达到边界后将剩余位移传给可伸缩的同侧兄弟面板。
6. 并发与守恒：库补丁修正after-pane最大值判断漏算后续兄弟尺寸，以及到达前侧全体最小值时重复扣减前序尺寸；推挤按可增长/可缩减量成对转移，保留总百分比和最小/最大约束。同步上游源文件及本项目实际消费的浏览器ESM产物，锁文件记录patch hash。
7. 生命周期：原布局锁、ResizeObserver、结构key和真实拖动事件保存不变；不改命中区、可见分隔线或默认布局。
8. 验收：api.honus.top隔离实例挂载真实Renderer/RuntimeSession，无SSH连接/用户配置写入；验证上下往返、两侧分隔条、38–42px、百分比总和及锁定。既有SSH E2E补齐真实连接后的上下拖动回归，等待正式远程Actions。

### Agent 审计入口移除

任务详情不再展示步骤与工具审计；审批卡片移除查看工具审计按钮及定位状态。NativeRunDetails 保留运行概况、子任务和 Run 事件；开发页同步移除步骤审计。线程工具列表 API 由 `native-tools-api.ts` 持有，供聊天工具状态及其中的审批结果展示使用；不保留旧审计 API 包装。其他界面布局和样式不变。

### Agent 聊天工具状态与悬浮控件

1. **职责与范围**：聊天只保留工具调用分组，审批结果进入同一工具状态区域；待审批任务侧栏与最小化快速批准仍持原写入入口。
2. **子功能与目录**：AgentAppSurface按toolCallId建立审批索引；NativeToolActivityList展示状态及处理时间，删除无消费者的NativeApprovalHistoryList及对应文案。控件浮动布局归Surface的模板和CSS。
3. **依赖方向**：继续沿useNativeRuns读取当前Run审批与线程工具分页，复用原工具详情延迟读取；没有新公开入口、全局状态或后台请求。
4. **类型与转换**：复用agent/model/native-run-types.ts；索引按工具ID关联，并复查appId/runId，当前状态还须匹配operationHash和inputRevision/operationRevision。审批时间为秒，展示时乘1000；工具时间保持毫秒。审批与执行状态分别呈现，不将批准转换为completed。
5. **入口与安装**：消息后和未关联消息的工具列表共同消费审批索引；不再独立渲染审批历史。工具未加载时随原工具分页加载，审批读取范围仍为当前选中Run，不伪造其它Run的审批状态。
6. **数据、事务与并发**：只读投影不持久化、不提交批准；审批按输入版本、政策版本及申请时间排序，被取代的许可不覆盖其替代许可；同一工具旧操作的审批留在展开详情，不能作为当前操作已获批准的依据。
7. **生命周期与失败**：保留原订阅、版本合并、Run/Thread切换和失效围栏；不新增timer/listener。状态行绝对定位在输入区上方，空白pointer-events:none，只有按钮恢复命中；按钮自身实色，正文保留底部留白。附件、输入框及popover仍沿原布局/Portal，不改变自动跟随与导航动作。
8. **当前能力与验收**：已完成源码与消费者迁移；静态证据见testing，按D17不运行本地行为测试。手机/窄窗的浮层穿透、审批变化及历史分页组合等待后续行为验收。

### 自动图片预览（2026-10-26）

image_generate 仅负责生成并保存 App 文件，返回给模型的结果只有 id、name、sizeBytes；工具说明不要求模型拼接预览或下载 Markdown。服务端从已完成工具的持久结果投影 generatedImageId，前端使用 App ID 与文件 ID 自动显示现有图片预览和下载入口。Base64 只经生成服务落盘，不写入聊天或工具列表。待批准、失败或 unknown 不产生成功预览；刷新后仍可从工具记录恢复，文件读取继续执行原会话与 App 授权。直接 Images 对话仍由程序生成展示内容，不依赖文字模型。

Workspace 传输失败呈现：原 TransferController 保留 error/unknown 真实结算，WorkspaceSessionSurface 与 WorkspacePage 通过 transfers 的 `isProgressTaskVisible` 统一过滤浮动进度、恢复按钮与隐藏任务列表。各操作原等待回执的 owner 发出 Toast，上传在批次完成回执中通知，准备失败只由原提交 catch 通知，不重复订阅同一错误。密码拒绝仍进入原重输流程。此展示过滤不取消远端任务、不解除机器突变未知围栏。所有进度视图不再附加错误/警告段落，完成警告由原回执 owner 通过 Toast 通知。后台 serverTransfers store 比较当前快照的子任务状态与错误码发布安全失败 Toast，列表读取及取消/移除错误同样走 feedback；身份/代次/取消保护保持，网络错误交原全局通知，不新增轮询或重复监听。

Splitpanes 连续拖动的生命周期补丁：mouseup 立即解除本次全局拖动监听，click 保护仅保留到本次同步 click 结束后的下一任务；新 mousedown 清除上次定时器，卸载清理监听和定时器，防止旧拖动延迟收尾解除新拖动的监听，且不保留100ms全页pointer-events屏障。正常尺寸和布局不变。

PDF 的异步页定位显式区分主动跳页与缩放/尺寸锚定：前者保持原重置横向位置，后者在实际应用时读取当前scrollLeft，避免PDF.js晚到尺寸和锚定覆盖用户已经作出的横向滚动。不调整模板、滚动条或样式。

### 自动传输的安装偏好与工具事实

remote-tools/model/tool-preferences 通过 foundation/browser 的版本化本地存储，按认证 userId、targetId、工具保存明确的“暂不安装”。偏好只影响 prepareTransfer 的安装询问，不替代实时 check、不改变后端工具可用性或直传/中转策略；归档准备不读取该偏好。prepare 在等待后先复查取消/身份，再保存拒绝，失活取消不保存；不持久化密码、planId 或安装授权。Workspace copy progress 的 transferMethodUsed 经原 adapter/controller 投影至现有进度行；后台发送复用 subTasks 实际方法，同一方法可在汇总行显示，混合方法保留各子任务详情。不依据用户请求的 auto 值伪造实际工具。

FileManager 的桌面文件行不拦截 mousedown 默认行为，保留浏览器原生 HTML5 拖动；clickEntry 仍在点击完成后将焦点交回列表，原键盘和多选 owner 不变，根节点既有 user-select:none 防止文字选择。归档 processedBytes 投影至任务 bytesWritten，未知总量使用现有进度条的不定动画和实际字节，已知总量仍按原百分比显示；不增加源文件扫描或新的容量上限。

### 浏览器前台恢复与可视键盘几何

TerminalView 的原 4px/5px/3px 内容边距归外层 terminal-container；供 FitAddon 测量的 terminal-inner-container 保持无内边距，百分比高度和宽度使用外层扣除边距后的内容盒。FitAddon 会扣除 xterm 自身边距，但不扣其父元素的边距；因此不能把外层总高度当作可用行高。原 ResizeObserver、typeahead reset、快照及 PTY resize 屏障继续持有尺寸更新，内置键盘只参与 Surface 原有 flex 高度分配。

TerminalView 在 pageshow、恢复可见及失焦后的窗口重新聚焦时清理未完成触摸、恢复 inputmode/readOnly，并依据当前连接状态设置 xterm disableStdin；普通聚焦不清理正在进行的手势或输入法。取消旧 geometryFrame 后立即拟合，并保留下一帧收敛；预测撤销、快照与 PTY generation 原屏障仍先于真实 resize。WorkspacePage 在 visualViewport resize/scroll、前台恢复和聚焦时同步读取可视高度，再合并下一帧测量，避免旧 rAF 阻塞键盘自适应；隐藏/卸载取消旧帧并解除监听。呈现恢复不等待网络存活检查，不主动唤起键盘、不合成输入法提交事件，也不重发终端输入。原 UI 样式、布局与连接就绪语义保持。

### 服务器状态趋势时间轴与加载

StatusMonitor 的矮面板单行模式由原 status-content 高度容器查询持有紧凑边距、卡片内距和字号；速率字体直接结合容器宽度与现有 status-scale 计算，不叠加父级缩小，不新增 JS 测量、状态或断点。正常高度、趋势面板留白和原监控采样/趋势生命周期保持。

状态趋势直接用会话现有有界历史的真实时间/数值交给 Chart.js，不按所选窗口宽度平均或取最大值，以免短历史折叠及峰值时间偏移。所有指标共享最新监控采样作为时间右端；序号不连续、时间倒退或实际相邻间隔大于完整历史正向连续间隔下中位数的两倍时，插入仅供绘制的空值；判据在范围过滤前计算，避免窗口改变断点。历史不足以区分正常采样与静默时不捏造采样频率，仍保留序号断点；订阅实际恢复与采样失败由原会话 owner 推进连续性序号，短暂标签切换不打断仍存活订阅。Chart.js 最近时间交互和外部 Tooltip 按同一时间过滤，缺测上下行不按数组索引混合。纵轴步长与二进制单位共同计算，保留原自动范围迟滞；曲线使用单调插值，单点及孤立点显式绘制。

1. 职责与范围：StatusCharts 持时间轴显示，StatusMonitor 的异步组件持加载；不改变采样和历史保留。
2. 子功能与目录：沿 features/status-monitor/components，StatusChartLoading 只呈现加载网格和提示，不画模拟曲线。
3. 依赖方向：StatusMonitor → 原异步 StatusCharts → Chart.js/vue-chartjs；加载组件仅依赖原 i18n。
4. 类型与转换：无新协议、共享或模型类型；原 history → TimedChartPoint 转换不变，加载组件不透传业务属性到 DOM。
5. 入口与安装：原指标点击打开趋势及范围切换不变；网络上下行图例位于原history-heading内的标题右侧；网络标题不可收缩省略，速率区作为inline-size容器使两个速率字号随自身可用宽度缩放、上限沿原11px/scale，保持单行左右布局。手机弹窗复用同一组件；范围选项仍在其下，不改变CPU等单值位置。X 轴禁用 tick 留白，标签水平显示，字体与间距抵消父面板缩放。
6. 数据、事务与并发：历史和最新时间仍归原 session controller；加载无自己的采样/请求/缓存或持久状态。
7. 生命周期与失败：复用 defineAsyncComponent 的原 delay、模块缓存及异常传播；加载网格用 CSS 呼吸效果，prefers-reduced-motion 下静止，无新增计时器或监听。
8. 当前能力与验收：只调整时间刻度占位与趋势加载呈现；范围、孤立点、缺测断线及 tooltip 保持原逻辑，指定 CDP 与静态结果见 testing。

### 手动重置 SSH 终端

1. 职责与范围：用户确认后关闭当前SSH会话并新建Shell，不检测程序卡死、不自动重放输入或终止独立后台进程。
2. 子功能与目录：沿原WorkspaceTabBar、WorkspacePage、session Runtime/Registry及workspace i18n，不新增模块或远端helper。
3. 依赖方向：TabBar只发布意图，Page持确认和页面signal，Registry持标签及替换，RuntimeSession持远端关闭和未知结果围栏。
4. 类型与转换：内部WorkspaceResetOutcome归workspace model，复用Shared workspace.close请求/响应，不增加通信契约。
5. 入口与安装：SSH标签右键/长按菜单重置，复用全局确认框；仅已连接、未标记挂起且无未知围栏的会话可用，派发前再次核对。
6. 数据、事务与并发：按原Runtime实例及runtime generation核对异步结果，同会话在途重置共享Promise；关闭成功后复用原scope清理，在原顺序插入新标签，后台标签重置不改变当前选择。
7. 生命周期与失败：收到closed才新建；detached、unknown及关闭异常保留原标签并停止重建；用户关闭原标签、认证代次失效或页面失活后不再创建新会话，已确认关闭的资源仍完成清理。新连接失败保留原有错误/重试状态，旧连接的画面、草稿和生命周期不迁移至新PTY。原实例的重置意图抑制关闭等待期间的按键重连提示，未知关闭仍呈现既有围栏说明。
8. 当前能力与验收：行为和影响见USAGE的SSH会话章节，源码/静态/CDP证据分别归PLAN/testing，不把手动恢复视为任意程序退出或通用卡死检测保证。

### SSH 测试的主机密钥确认

连接列表/批量测试与保存/未保存表单共用connections/model/connection-test的确认流程。API严格解码HTTP状态及Shared挑战联合，逐字段转为内部ConnectionTestHostKeyFailure，不持有弹窗；Model复用host-key-trust的全局确认和信任写入，只在明确确认后重新握手。未保存草稿在首次请求捕获，取消不续测、不遗留成功状态，页面/认证失效由原signal与generation阻止后续操作。多跳按实际host/port分别确认；同一端点再次拒绝或指纹已等于预期时直接失败，避免重复确认循环。等待人工确认不持有SSH连接，不创建Workspace或保存未保存连接；信任写入确认丢失仍复用原只读核对，不自动重写。原布局、控件及文案不变，实机证据与覆盖边界见testing。

### 命令历史未知写入恢复

1. **职责与范围**：command-history store拥有历史队列和未知写入阻断，WorkspacePage拥有终端发送完成后的追加及其安全提示。
2. **子功能与目录**：沿command-history原store/API/Panel和WorkspacePage，复用shared/feedback的preferenceFailureMessage及现有通知刷新动作。
3. **依赖方向**：Page→feature controller→store→API→既有Shared；不把错误正文或技术结果传入Shared。
4. **类型与转换**：PreferenceRequestFailure的code/outcome使用既有安全mapper；load无需恢复标记参数，正式Panel和集成消费者同步。
5. **入口与安装**：发送成功后历史追加失败提示“未能确认保存”及具体安全原因，通知可只读刷新；面板原搜索、紧凑、清空及行操作不变。
6. **数据、事务与并发**：读取和写入共享单一队列；阻断时新写入先在当前任务内读取，成功才清除阻断并执行新意图，不递归排入同一队列。不自动重放未知追加。
7. **生命周期与失败**：读取后复核原scope和permission；reset取消旧scope、替换队列并清空缓存，晚返回不能发布。恢复读取失败保留阻断；未知写入继续阻断，普通读取成功同样恢复。追加确认后读取失败单独记录，不误报追加失败或重发命令。
8. **当前能力与验收**：USAGE个人历史说明操作与恢复；CDP隔离故障及静态证据归testing，新实际SSH回执丢失E2E待远程执行，生产原始触发原因未据此确认。

### Agent 执行结果未确认

Run/Tool 安全原因增加 tool_result_unconfirmed，继续由 AgentAppSurface 与 NativeToolCallDetails 在原错误区域呈现三语说明。后台 Job 故障由后端结束所属 Run/族并失效待审批工具。isNativeRunActive 仅表示 pending/running，unknown 停止状态订阅等待；canCancelNativeRun 另保留 unknown 的显式结束资格，原 composer/详情结束入口与续发保护同步消费，避免把已停止的执行与尚未人工结束的围栏混为一谈。不新增等待计时、重试入口或 UI 布局。明确说明任务已停止、远端可能仍在运行，并要求核对后再操作。状态与原因通过原 HTTP/WS codec 读取，历史重读不派发命令。

### 文件拖动悬停导航

1. **职责与范围**：FileManager持有一次内部拖动的原始条目和悬停手势；browser只持当前目录快照，目录变化清选择不清本次拖动源。
2. **子功能与目录**：沿原FileManager组件和Filesystem browser，不新增导航/移动状态仓库。
3. **依赖方向**：原生DragEvent→FileManager→原navigationQueue/loadPath→browser/FilesystemChannel；最终drop仍通过原moveTo事件交给Workspace。
4. **类型与转换**：节点、坐标和计时器只属于组件局部记录；原RemoteFileEntry和双端契约不变。
5. **入口与安装**：文件夹行及`..`行停留600ms进入；行目标以可移动或可导航统一原生dropEffect、preventDefault与高亮，返回源父目录允许仅导航且不显示禁止，文件/空白区域不触发悬停进入；当前目录空白放置接续原移动流程；拖动中右键取消、清空选择并关闭菜单，当前浏览目录保留。
6. **数据与并发**：同目标的dragover不重置等待，更换目标重计时；派发导航前检查同一拖动、原通道/视图/目录、有效目录行及真实指针命中，自身/源目录后代禁止进入。
7. **生命周期与失败**：离开行、目录改变、drop/dragend、视图撤销、换通道和卸载取消等待及滚动；导航后保留拖动，最终移动仍使用原过滤/确认/失败链，不由悬停派发文件修改。文档级捕获原生drag/dragover/drop及pointerdown/contextmenu的右键状态，覆盖目录外与快速松手；所有监听随组件卸载移除。
8. **当前能力与验收**：操作见USAGE文件管理章节；静态、受控CDP和真实SSH分别记录于testing，不扩大有限验证范围。

### 文件编辑器窄屏底栏

1. **职责与范围**：FileEditor拥有路径/服务器、编码/换行符及操作按钮的底栏排版；原编辑会话仍持有文档和保存状态。
2. **子功能与目录**：沿features/file-editor/components/FileEditor.vue的既有容器查询，不增加响应式布局组件或共享UI规则。
3. **依赖方向**：Workspace的弹窗/嵌入容器→FileEditor→原UiSelect/UiButton/session，依赖不变。
4. **类型与转换**：纯CSS调整，无模型、协议或类型迁移。
5. **入口与安装**：沿原560px容器断点为路径/服务器保留独立行，目录可截断、文件名优先、服务器留出独立空间；第二行固定编码/换行符及搜索/刷新/保存，编码使用剩余空间，换行符保留5rem，最多两行；保存状态占首行右侧，路径布局为它让位，宽屏仍沿原单行布局。
6. **数据与并发**：不增加测量、状态、计时或网络请求；编码/换行符、草稿和保存串行语义不变。
7. **生命周期与失败**：只读/保存中禁用、错误提示、选择菜单portal和视口碰撞仍归原owner；极小且低矮容器的原紧凑规则保留。
8. **当前能力与验收**：操作说明归USAGE编辑章节，指定CDP的遮挡前后几何、菜单/保存行为和静态证据归testing，正式移动端SSH回归单列实际执行范围。

### 共用确认弹窗排版

1. **职责与范围**：Foundation的UiConfirmationPanel持有确认弹窗布局和风险配色，shared/feedback的DialogHost/store持有确认状态，原用例持有最终动作。
2. **子功能与目录**：沿foundation/ui/UiConfirmationPanel.vue与uiGen2.css确认选择器；DialogHost覆盖全部feedback确认/提示，UploadConflictModal和Agent的ModelProviderSettings、AppIntegrationEditor、AppManagementSettings直接共用基础确认面板；普通表单Dialog与管理/批量按钮保留各自职责。
3. **依赖方向**：用例→feedback→DialogHost→确认面板/Overlay/ActionGroup；上传冲突及Agent受控确认直接消费原面板，不在业务组件复制标题、正文和操作区排版。
4. **类型与转换**：复用原title/description/tone/icon和default/actions槽；无新增类型、边界或持久化。
5. **入口与安装**：图标和标题为紧凑标题行，正文独占全宽；空默认槽不产生留白，详情/复选项仍在正文之后；底部细分隔及浅底对齐按钮，手机同排等宽且至少44px高，复用原96px按钮基准换行，多操作与长文案不挤出面板。
6. **数据与并发**：纯模板/CSS，取消位于危险确认之前，不改变原文案、风险语义或状态更新，不新增请求/计时器；原删除版本/排空与数据清理流程仍由原owner负责。
7. **生命周期与失败**：原Overlay焦点恢复、Escape/背景关闭、loading防关闭、signal取消与上传冲突选择回调保留；长内容沿原最大高度滚动，不推断已确认等于远端操作成功。
8. **当前能力与验收**：用户操作见USAGE通知管理；真实组件截图、CDP受控结果及静态检查记录于testing，截图不执行SSH重置或文件删除。

### 手机终端普通点击与输入焦点

1. **职责与范围**：TerminalView拥有触摸手势与xterm输入焦点，普通点按不能中断已聚焦输入及IME。
2. **子功能与目录**：沿terminal/components/TerminalView的handleTouchStart、suppress/restoreMobileSoftKeyboard，不增加公共焦点服务。
3. **依赖方向**：触摸→TerminalView→xterm及原TerminalChannel，TUI兼容鼠标事件仍交由xterm发送。
4. **类型与转换**：原DOM TouchEvent、textarea及TerminalChannel不变，无Shared/Backend迁移。
5. **入口与安装**：单指按下以document.activeElement判断；已聚焦textarea不切readOnly/inputmode、不blur，未聚焦手势保留键盘抑制，普通松手恢复输入。
6. **数据与并发**：焦点直接读取浏览器事实，不维护第二份keyboard-open状态或增加延时；长按/选区拖动/双指手势仍沿显式抑制入口。
7. **生命周期与失败**：touchcancel、就绪变化、失活与卸载仍由原resetInteractions恢复输入模式/清理timer；尺寸变化只测量，不为点击重建输入节点。
8. **当前能力与验收**：USAGE终端章节描述操作；指定CDP覆盖真实xterm焦点、输入、鼠标报告、长按与滚动，真实手机软键盘动画仍需设备验收，证据归testing。

### 触屏桌面鼠标右键后的选择

1. **职责与范围**：FileManager区分实际输入来源，鼠标右键后立即允许选择，触摸/笔长按继续防误触。
2. **子功能与目录**：原FileManager.openContext与Foundation.useLongPressGesture保持唯一owner，不新增手势状态。
3. **依赖方向**：业务组件消费DOM PointerEvent与既有手势能力，不把设备触屏能力当作本次输入来源。
4. **类型与转换**：沿原MouseEvent参数，通过PointerEvent实例与pointerType缩窄，无新复用类型/协议。
5. **入口与安装**：只有实际touch/pen的原生contextmenu追加suppressClick，鼠标和键盘菜单不追加。
6. **数据与并发**：原选择、菜单、原生拖动和固定源由原owner持有，无新增期限或第二份状态。
7. **生命周期与失败**：原长按触发及松手的抑制仍归手势组件，原失活/撤销清理不变，不修改样式。
8. **当前能力与验收**：同触屏CDP基线复现鼠标菜单后吞第一次选择，修复及既有完整拖动回归证据见testing；真实SFTP由本轮Actions核对。

## 导航布局测量

1. **职责与范围**：AppHeader 保持导航条当前入口可见，不改变页面缓存和终端会话。
2. **子功能与目录**：app/shell/AppHeader.vue 持有导航条和链接的 ResizeObserver。
3. **依赖方向**：消费 Vue ref、路由路径和浏览器布局通知；不依赖页面业务状态。
4. **类型与转换**：仅组件内使用 DOM ref 与 ResizeObserver，无新增复用类型或协议转换。
5. **入口与安装**：导航 DOM ref 安装观察，路由提交后重新观察导航条，以便尺寸未变时也收到一次布局后通知；宽屏无溢出时不滚动。
6. **数据与并发**：浏览器布局完成后批读尺寸再滚动，避免 nextTick 读取几何或直接 scrollTo 迫使新页面同步布局；导航宽度、字体及当前链接尺寸变化重新测量。
7. **生命周期与失败**：导航条隐藏、DOM替换和组件卸载时断开观察并清除引用；不留下定时器或改变原登录/注销 owner。
8. **当前能力与验收**：保持自动居中、横向拖动和页面缓存，性能及宽窄视口证据见 testing；不承诺消除动态模块下载或页面自身的所有渲染成本。

## 插件目录与卸载意图

usePluginManagement 持已确认安装快照；相同 appId/revision 序列不重复发布，避免父组件重新读取 App/定义。retainedAppIds 来自后端同事务目录，不用本地已卸载列表猜测；Host、App 行及市场为当前投影建立 Map/Set，包 hash/publisher/定义版本匹配条件保留。AppManagementSettings的操作组在640px起继承父行items-center垂直居中，不设置self-end覆盖；更窄视口沿原全宽三列grid排列。App 卸载弹窗使用全局确认组件和默认关闭的清除选项；确认后顺序等待卸载、可选清除，只有整段成功才发布成功。清除的 operationId 留原意图，部分完成失败只重读；撤销后不回填旧状态，不自动重放。市场对应插件行显示保留数据标记及清除/重装；原目录不可用时以真实安装/版本信息显示清除行，不伪造可安装包。清除确认沿原 composable/API，移除独立保留数据面板及无消费者的原 JSON 编辑组件。清除不删除聊天、历史、记忆或文件，必要墓碑不作为可用 App 展示。

## Agent 启用与插件安装引导

1. **职责与范围**：AgentSettingsPanel 开关接 useAgentOnboarding，安装确认与执行总开关仍是两个明确写入。
2. **子功能与目录**：复用原 onboarding composable/modal 和 Plugin API；Host 删除 builtin 分支和无用 definitions 请求；DEV 删除手工创建 App，仅使用已安装 App UUID。
3. **依赖方向**：设置 → 原 composable/API → Shared；Host 按 App/installation/version 完整身份映射 surface。
4. **类型与转换**：声明移除 defaultEnabled；删除无消费者的 DEV App 创建类型/API/翻译，原插件版本哈希与 publisher 白名单转换保持。
5. **入口与安装**：关闭直接写总开关；开启先读推荐，未装显示 Nexus Agent 确认，已装复用，安装成功才写总开关。引导新装由后端原子初始化启用状态与完整声明授权，已有安装不重置；普通市场安装仍需单独启用与授权。引导底部安全提示独立一行；桌面安装/取消并排，手机两个按钮各占一行、文字保持单行，局部样式不修改全局 UiFormActions；手机面板使用16px内边距，标题与发布者标记可自然换行。
6. **数据、事务与并发**：无本地默认 App/旧 ID 兼容；Host 仅匹配真实安装包 manifest、版本、hash 和 publisher；目录 Map 索引保持。
7. **生命周期与失败**：取消/读取失败/安装失败不开启；复用 view/session generation、未知写围栏与只读核对；视图失效后的晚结果不写总开关。
8. **当前能力与验收**：USAGE 同步首启说明；各轮定向浏览器验收与静态结果见 testing；推荐新装初始化全部声明授权，已有安装不自动恢复权限。安装按钮的新排版按 D17 留 Windows/手机实机验收。

## 插件仓库呈现

1. **职责与范围**：PluginRepositorySettings 拥有仓库管理、搜索和插件目录的排版，不改变信任、包校验及安装授权。
2. **子功能与目录**：沿原设置组件模板和 scoped CSS；基础按钮、输入框及提示复用 Foundation，无新增布局组件。
3. **依赖方向**：原管理组件 → composable/API → Shared；布局只依赖组件容器尺寸，不以视口宽度推断设置面板宽度。
4. **类型与转换**：无新类型、状态或边界转换；原目录、安装及保留数据投影继续使用原 owner。
5. **入口与安装**：标题右侧刷新，地址输入与添加位于下一行，搜索独立；容器不超过24rem时刷新只显示图标并保留可访问名称/悬停提示，地址与添加分行。URL 在可用空间内省略，复制/删除仍可用。插件名称及简介自然换行；窄容器将动作置于简介下方，48rem起按简介/动作两列排列，多个按钮整枚换行，按钮内文字不拆行。移除重复的算法装饰文字，实际校验与状态保留。
6. **数据、事务与并发**：纯模板/CSS，无新请求、缓存、测量或持久化；安装、仓库配置 CAS、信任及清除的原流程不变。
7. **生命周期与失败**：复用原 busy/disabled、读取恢复、unknown 围栏、视图撤销及清除确认；加载图标与正常图标互斥，避免双图标占位。
8. **当前能力与验收**：USAGE 对应操作同步；D17 下源码/静态与最新视觉验收分开，320px手机、中英文、长URL/名称和多操作组合待远程或实机核对。

## 网络切换与自动恢复

1. **职责与范围**：WorkspaceSocket 归类真实传输失败/响应等待超时，RuntimeSession 持自动恢复策略与未知结果围栏，WorkspacePage 持浏览器恢复事件及挂起目录协调；不重发输入或文件副作用。
2. **子功能与目录**：沿 workspace/protocol、session、model 及 app/pages/workspace；不新增连接 owner、轮询或 UI。
3. **依赖方向**：浏览器 online/NetworkInformation change/前台事件 → Page → Runtime → Socket；挂起仍沿目录权威恢复，不通过普通重连抢占。
4. **类型与转换**：真实 WebSocket 错误复用 client 的 WebSocketConnectionFailure，请求等待超时由 workspace/model 具名表达；服务器 WorkspaceRequestFailure、协议解码失败和未派发错误保持独立，不按正文判定。
5. **入口与安装**：有 EventTarget 形式 navigator.connection 时监听 change，与 online 共用存活检查；健康链路只探测。监听随页面挂载/卸载安装与移除，失活/隐藏不派发恢复。
6. **数据与并发**：复用原单个连接 Promise、2/4/8/16/30秒退避及离线暂停。传输失败不设置永久 waitingForRetry，恢复中再次收到网络事件保留即时恢复意图；成功不重连已绑定附件。普通 resume 的 conflict/remote_unavailable 可等待旧附件释放后重试原凭据，不自动新建 SSH。
7. **生命周期与失败**：新建请求或 resumeAck 已发送但确认未知仍停止重放；权限、主机信任、目标失效与协议错误仍需明确操作。只有尚未确认所有权的新 resume 可在传输中断/超时后重试，服务端在旧附件脱离时回滚准备状态；已确认附件后的激活网络失败可用已提交新凭据续接。关闭、销毁与身份撤销继续取消原资源。
8. **当前能力与验收**：USAGE 同步网络恢复/手动重试边界；源码、静态及未运行真实行为分别归 PLAN/testing。既有 SSH 服务确定拒绝等待按键的场景继续有效，不能用网络自动恢复扩成未知提交重放或任意程序恢复保证。

## 设置读取失效与缓存页面恢复

1. **职责与范围**：原个人偏好 editor、后端日志和 Agent 执行设置 controller 拥有读取状态；全局 settings-reload 只汇总真实失败，不把正常初始化或视图撤销算成故障。
2. **子功能与目录**：复用 preferences/composables/use-preferences-editor、logging/composables/use-backend-logging 和原三个设置面板；没有新状态模块。
3. **依赖方向**：面板消费 controller 失败/忙碌状态并注册 Shared Feedback 恢复源，读取仍经原功能 API/Store。
4. **类型与转换**：沿原应用及 Shared 请求/回执 mapper，无新协议和存储形状。
5. **入口与安装**：mount 首读，KeepAlive 激活后等待视图 scope 恢复再按 needsRefresh 只读加载；初始化和加载中的源不触发恢复提示。
6. **数据、事务与并发**：原 busy/读写围栏阻止并发；失活清理旧错误，返回只读核对后才解除写入围栏，不重放原写入。
7. **生命周期与失败**：原 signal/current scope 屏蔽晚返回与 finally；真实读失败、冲突和未确认写继续提供原重新读取入口，重读失败不开放写入。
8. **当前能力与验收**：USAGE 同步返回页面与失败恢复行为；新增缓存往返及原真实失败回归的正式 Actions 证据见 testing，静态与设备视觉证据分开。

## 工作区连接与布局并行初始化

1. **职责与范围**：WorkspacePage 并行启动独立的连接查询动作与设置读取，终端仍等待原保存布局就绪后挂载；不修改布局及操作入口。
2. **子功能与目录**：沿 `app/pages/workspace/WorkspacePage.vue` 的 onMounted/onActivated 与 loadQueryActions，不新增状态仓库或异步包装层。
3. **依赖方向**：Page → Registry/RuntimeSession → WorkspaceSocket；布局仍由原 workspaceLayout owner 读取，终端经既有功能 Port 接收输出。
4. **类型与转换**：原连接摘要、Shared 请求/回执、mapper 及 Promise 保持不变，无新增协议/类型。
5. **入口与安装**：首次挂载及 KeepAlive 后的新连接查询无需等待 layout/focus 读取；先消费一次性路由查询，再沿原连接摘要刷新和 openConnection 派发。
6. **数据、事务与并发**：template 的 layout.loaded 挂载门禁保留；Runtime 已有 pre-mount 输出缓冲及消费窗口继续持字节，挂载后按原顺序解析，不丢输出、不提前开放输入。首次前台恢复仍等待布局和查询动作完成。
7. **生命周期与失败**：loadQueryActions 的原页面 signal/current 检查阻止失活或注销后的晚返回派发；布局失败走原设置重读入口，连接仍由 Registry/Runtime 持有关闭、未知结果和恢复，不因布局慢创建第二份 SSH。
8. **当前能力与验收**：消除布局读取与连接流程之间的代码串行依赖，真实收益取决于读取与握手耗时；USAGE 见终端章节，静态/构建及待验边界归 PLAN/testing。
