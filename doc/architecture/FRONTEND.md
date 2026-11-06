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

### 样式 owner 与基础组件定制

1. **职责与范围**：Foundation 持有主题材料、基础组件及多个功能共同使用的目录/设置视觉契约；页面、应用壳和反馈展示拥有各自布局。业务不靠重写基础组件内部 class 形成隐式接口。
2. **子功能与目录**：`foundation/ui/styles` 按 materials、surfaces、feedback-states、controls、selection、dialogs、motion-accessibility、confirmation-actions、catalog、settings 组织。`app/styles/{shell,update-prompt}` 持应用壳和更新提示；`shared/feedback/styles/notifications.css` 持 Toast；代理与通知目录专用 toolbar 分别归各 feature 的 styles。
3. **依赖方向**：`app/styles/global.css` 显式装配各 owner 的全局 CSS，Foundation 不 import 上层样式，也不识别 App Header 或 Agent 专有 DOM。跨功能组件与能力由所属 feature public 提供；不通过 shared 聚合业务类型、重导出应用对象或注入全功能 Service Locator。
4. **类型与转换**：UiEmptyState 通过 `--ui-empty-state-*` 提供图标、标题、说明、动作的局部定制，默认及密度 fallback 保持基础组件原值；UiInput 字号复用 `--ui-control-font-size`，Spinner 复用 `--ui-spinner-size`。UiPopover 的 `panelMarkerAttribute` 仅接一个 `data-*` 存在标记，Agent 在自身调用处传入。无 Shared/协议变更。
5. **入口与安装**：Tailwind 与 tokens 先安装，再按明确顺序安装材料、组件、可访问性与后置变体、目录、设置及业务专属规则。保持原 CSS layer、选择器权重及同目标覆盖关系；不把未分层组件规则统一移入 Tailwind layer，不依赖路由访问顺序加载共用外观。
6. **数据、事务与并发**：各功能 composable 仍消费自身唯一 Pinia Store，连接/标签/代理/密钥及远桌消费者直接经公开入口取得同一 owner。没有新的状态缓存、请求、持久偏好或迁移。
7. **生命周期与失败**：原认证清理、视图 scope、KeepAlive、请求取消和未知写入保护不变；样式不建立监听。Portal 的 Agent 标记仍作用于原面板，外部点击、Escape 与焦点恢复不变。UiSelect 消费 Reka 提供的可用高度约束列表，扣除现有 padding/border，保留正常高度和密度。
8. **当前能力与验收**：核对 USAGE 的目录、全局确认/Toast、登录、工作区与 Agent 操作，内部重构不改变产品行为。CSS 删除须有动态消费者、编译 scope 或等价 cascade 证据；运行时 Coverage 未命中不是死规则证明。实际源码、静态及 CDP 宽窄/深浅对照分别记录 testing/HISTORY，真机输入法不由桌面视口模拟代替。

### 活动视图、手势与展示组件边界

1. **职责与范围**：App router 编排经过认证的 Workspace 导航预加载；Workspace 装配真实可见的编辑/预览视图；文件功能拥有列宽及文档动作；窗口功能拥有视口边界；Foundation 只提供手势机制；shared/focus 的纯 DOM 能力根据通用文档标记判断快捷键归属，不依赖文件功能私有结构。Provider 管理用例与卡片展示分开，Agent 配置按钮尺寸归按钮组件。
2. **子功能与目录**：`filesystem/composables/use-file-manager-columns.ts` 持列宽计算和拖动；`file-editor/composables/use-file-editor-actions.ts` 持重新加载/编码/丢弃确认，session 类型归 `file-editor/model/file-editor-session-types.ts`。`shared/focus/document-keyboard.ts` 持文档焦点归属判断；transfers 持进度窗口的可见性、速度采样及位置持久化。`agent/settings/ProviderCatalogCard.vue` 持卡片 DOM 和样式，管理 API、草稿、复制计时及弹窗仍归 ModelProviderSettings。
3. **依赖方向**：App router → workspace/public 的预加载能力；Connections 仅发原导航意图，不引用 Runtime。Workspace → file-editor/file-preview/transfers 的 active 契约；文件功能 → 认证视图 scope、Foundation；Provider 卡片 → 本功能 model 和基础 UI，不持 API 或 Store。Surface 传尺寸变量，不再深层覆盖配置按钮的尺寸属性。
4. **类型与转换**：文件 session/actions 直接消费唯一应用类型；确认注册返回绑定实例的关闭能力及 dispose；FileEditor 和 Workspace 弹窗均经触发实例派发，不借另一活动编辑器的确认。active 为宿主实际可见性，KeepAlive 再提供实例活动条件。Provider props/events 传既有 Provider、disabled、复制状态及用户意图。没有 Shared、HTTP 或数据库变化。
5. **入口与安装**：认证通过且 Workspace 导航带 connectionId 时并行预热现有异步组件，导航不等待预热；默认懒加载和原加载失败处理保留。预览/编辑弹窗与嵌入布局均传真实 active，Agent 文件库及聊天预览同步装配。正常 DOM、断点、最小列宽、卡片布局、按钮方形变体和深浅主题保持。
6. **数据、事务与并发**：列宽 pointerup 才发持久意图；取消保留当前预览，不补发晚保存。文档确认绑定原 session、文档修订和授权，确认中编辑、切页或身份失效撤销原意图；await 后再核对。共享 session 的确认注册按实例解绑，无可用确认时拒绝丢弃脏文档。关闭多个文档还核对完整目标快照。
7. **生命周期与失败**：隐藏预览不截获快捷键或迟聚焦，恢复继续使用原内容。基础拖动和 resize 的 stopDragging/stopResize/pointerup 提交，cancelDragging/cancelResize/pointercancel/失焦/隐藏/KeepAlive 失活/卸载仅释放手势和 body 选择状态；Workspace 切会话同步取消左右侧栏与三个弹窗手势，持久弹窗另在 active/disabled 撤销时取消。远桌监听 layout/visual viewport，把窗口与恢复按钮限制在可见区域，取消旧手势，不持久化自动适配尺寸；原 peer resize 继续同步显示尺寸，不重建连接。外观窗口复用基础拖动，失焦/隐藏/视口变化取消，遮罩关闭要求按下也始于遮罩。进度窗口隐藏后释放速度计时和手势，恢复重新建立采样基线；传输任务生命周期不随展示暂停；完成后的目录只读同步核对原会话仍存活，不依赖发起视图的旧permission，提示及后续写意图仍要求原视图有效。拖动后的点击抑制仅针对指针click，detail=0的键盘激活继续正常恢复。多个文档通过 data-document-keyboard-scope 标记优先按事件目标及当前焦点选择实例，已处理的键盘事件不重复执行。
8. **当前能力与验收**：清理无消费者 Tooltip、ManagementCard、management 操作布局及 Pagination density，保留实际分页外观。只删除已核消费者及 scope 的无效 CSS；其它未证实规则保留。浏览器基线、跨断点计算样式、生命周期故障与静态检查归 testing/HISTORY；桌面 CDP 与受控 visualViewport 不证明真实手机输入法或全部平台组合。

### 移动端可达性与长内容

1. **职责与范围**：设置页拥有分类导航，文档预览拥有搜索与工具行，Agent配置与Provider卡片拥有自己的紧凑控件/详情，基础搜索框拥有唯一清除呈现。
2. **子功能与目录**：沿SettingsPage、PreviewSearchBar/FilePreviewDialog、AgentConfigPopover/ProviderCatalogCard与UiSearchInput原文件维护，不另建状态仓库。
3. **依赖方向**：组件消费Foundation和VueUse；设置滚动边缘来自实际DOM几何，CSS不反向引用业务Store；父预览仅持工具栏换行，子搜索持自身排列。
4. **类型与转换**：沿原props/events和局部HTMLElement/ref，不改Shared、业务模型、数据库与迁移。
5. **入口与安装**：手机分类两侧各保留提示间隙，箭头不拦指针；选中分类/语言/容器改变使当前项可见。窄预览与coarse pointer搜索采用输入独占一行、下方计数与44px动作。Agent配置只增触控高度，保留横向宽度；展开模型ID完整换行并可选择。启用自带clearable的UiSearchInput局部隐藏原生webkit清除，不改其它输入。
6. **数据、事务与并发**：纯展示调整，无新请求；选中项沿原router状态，搜索/清除沿原受控事件，长ID不创建复制缓存或额外读取。
7. **生命周期与失败**：ResizeObserver及模板监听随所属scope释放；KeepAlive恢复重新测分类，滚动不改变选择。搜索清除只清query，外侧关闭才收起；隐藏快捷键和迟聚焦保护保留。
8. **当前能力与验收**：桌面密度保持，320/390深浅与三语、触控命中、全工具栏不溢出、长文本及正式回归分别归testing/HISTORY；仿真不代替真实手机输入法。

### 管理列表主题信息层级

1. **职责与范围**：Foundation 提供名称、类型、标签和状态的配色；管理视图及工作区组件选择对应展示角色。
2. **子功能与目录**：foundation/ui/styles/catalog.css 定义共用变量和徽标配色类；连接、代理、通知、Docker、WorkspaceConnectionList、快捷命令分组、连接标签选择器、Agent Provider/集成/插件市场与机器突变恢复在原模板/样式中应用；历史与挂起目录时间不再叠加额外透明度。
3. **依赖方向**：具体展示依赖 Foundation CSS，不跨功能引用私有状态，不更改全局按钮的 primary 配色。
4. **类型与转换**：无新增应用或 Shared 类型；CSS 颜色由现有主题前景、背景、强调与状态变量派生，无新增持久主题字段。
5. **入口与安装**：沿全局样式 foundation/ui/styles/catalog.css 的现有安装点加载；徽标与标签输入显式 opt-in，避免影响其它产品区域；普通数量保持中性，模型容量与版本使用信息色，启停和结果保留原语义色。
6. **数据、事务与并发**：无通信、数据及事务变更；名称、分组、标签与状态仍来自原 owner。
7. **生命周期与失败**：无新增监听或资源；主题变量改变即重算颜色，原选中、悬停、焦点、禁用及失败状态保持各自语义。
8. **当前能力与验收**：USAGE 对应章节维护展示层级；静态计算与检查归 testing，深浅主题与手机视觉按 PLAN 待验。

### 连接目录操作与密钥管理入口

1. **职责与范围**：ConnectionsView 持有列表操作排版及密钥弹窗可见性；SSH 私钥管理复用原功能，不改变主机密钥信任入口。
2. **子功能与目录**：沿 features/connections/views/ConnectionsView.vue；弹窗、管理流程和文案分别归 features/ssh-keys 的组件、composable 和 i18n。
3. **依赖方向**：连接视图从 ssh-keys/public 引入 SshKeyManagementModal，不穿透私有状态或 API。
4. **类型与转换**：复用弹窗已有布尔 v-model；无协议、Shared 或后端类型变更。
5. **入口与安装**：760px 以上列表标题右侧以“密钥管理／测试全部／连接全部”横排；760px 及以下保留原两枚竖排按钮，密钥入口位于页头更多菜单。两入口共享同一弹窗。
6. **数据、事务与并发**：密钥读取及写入继续由原 SSH Keys controller/store 管理；无新增持久化或迁移。
7. **生命周期与失败**：弹窗按需挂载，关闭、页面隐藏或认证身份变化时销毁；读取、取消、错误及未知写入保护复用原管理 owner。
8. **当前能力与验收**：操作说明见 USAGE 连接管理章节；按 PLAN 执行静态检查，宽窄屏与弹窗行为保留正式远程回归待验，不以编译替代。

### Agent 最小化任务提醒

1. **职责与范围**：原生Surface继续拥有任务权威与写意图；Host仅呈现最小化时实际发生的任务状态、审批和失败变化，提醒短暂出现，不常驻或建立全局Run store。
2. **子功能与目录**：AgentAppSurface发布当前任务投影和窄审批能力；useNativeRuns持原订阅，agent-host-state按Surface实例登记；use-agent-task-notices持变化基线、合并队列、收起/过期计时；AgentLauncher和AgentTaskNotice呈现。
3. **依赖方向**：Surface/runtime → 本功能model/原API；Host投影 → Launcher/card → Foundation按钮；@floating-ui/vue 2.0.1已由Reka引入，Frontend显式声明直接依赖复用定位/flip/shift/size，不复用有全局FocusScope/DismissableLayer的弹出框承载自动提醒。
4. **类型与转换**：AgentTaskActivity及注册能力唯一归agent/model，复用NativeRun/Approval的有限状态及安全摘要；投影带本页确认创建的Run标记、当前会话标题、状态、最多360字符结果、已确认用量/待审批和实例绑定动作。API与Shared白名单转换保持，无新后端契约或本地持久化。
5. **入口与安装**：仅minimized显示变化提醒，单纯最小化/普通文字/计数或语言变化不补弹；切换/加载历史任务的首个快照只作基线，本页确认创建或追加的Run首次回执即终态时仍可提醒；不按历史加载伪造新完成。同一实例任务更新合并，多实例顺序展示；新审批优先，正在悬停/键盘操作的卡片保持，8秒收起；悬停/键盘操作暂缓、触摸点击不永久暂停。卡片不自动聚焦或建立背景遮罩，Esc仅在卡片内处理，328px最大展示宽度再按真实可用宽高收缩。
6. **数据、事务与并发**：最小化可继续同一任务订阅和窄审批，创建/追加/取消与未知写重试仍要求完整活动界面。快速批准复查当前Run/Thread、最新审批版本/hash，再沿原快照意图/CAS/operationId提交；并发点击受原busy/blocked围栏，禁止重放或扩大授权。语言改变只更新文案，变化键使用原语义取值。
7. **生命周期与失败**：任务订阅由实际socket结果驱动退避，不用onLine硬闸；online/offline和NetworkInformation change重新连接，首份状态到达前心跳不续原45秒期限。浏览器隐藏暂停原订阅和收起计时，恢复原游标续读；关闭/销毁/认证撤销停止观察，目录按App版本/启用状态过滤并删除对应提醒。每个Surface独立Symbol注册，旧卸载只能注销自己；晚更新不能恢复已注销项。提醒收起不影响任务，过期审批按最近真实expiresAt更新入口标记/按钮，不定时请求服务端；冲突/未知保留原完整任务核对路径。
8. **当前能力与验收**：仅已挂载原生Surface的当前任务，无全局任务发现或自定义插件虚构状态。源码/静态检查与真实UI/异步故障验收分别记录于testing；已覆盖场景见测试入口，真实手机、键盘和扩大故障组合见 PLAN。

### Agent 会话列表与正文恢复

1. **职责与范围**：Thread owner持列表和创建/删除意图；Run owner缓存已确认正文及双向游标，任务/审批状态仍从原API核对；Surface持阅读位置和虚拟渲染，不建立全局任务Store。
2. **子功能与目录**：use-native-threads后台核对已加载范围并直接消费写回执；use-native-runs持conversationSnapshots、追赶窗口、selectionGeneration及历史分页；native-run-rules合并连续正文；AgentAppSurface复用vue-virtual-scroller的DynamicScroller/Item测高与可见行回收，消息和工具分组共同虚拟化。
3. **依赖方向**：Panel/Surface → 原composable → API/Native model → Shared workspace契约；history沿现有Backend Context/Workspace读取，不增加新路由、库或存储。Host提醒只消费Surface投影。
4. **类型与转换**：NativeConversationSnapshot唯一归agent/model，保存entries、前向cursor、反向startCursor和olderHidden，无审批、权限或写意图。NativeEntryHistory逐字段映射Shared AgentThreadEntryHistory；Surface局部TranscriptRow持稳定Run/role/step/event键，工具子组件随行身份隔离，避免回收时串用展开状态。工具组优先归属本步骤或更早的助手正文；无前置正文时锚定本Run首条已加载消息，后续步骤的总结不改变该锚点，避免文件/GIF跨行重新挂载。
5. **入口与安装**：返回Hub保留列表并后台核对；增删直接消费权威回执，未知仍显式核对。重复选择不重置，新选择可取消旧后台读。无缓存首次仅取最近正文页，向上到顶或点击原“加载更早消息”入口再取前页；缓存立即显示并沿前向游标补齐，追赶期间批量发布，避免历史逐页重绘。
6. **数据、事务与并发**：活动正文随分页增长，只挂载可见消息/工具行；闲置缓存沿原128条/256Ki UTF-16字符预算及访问顺序淘汰，活动正文超预算时不保留额外闲置窗口，不限制持久历史。前后游标分离，前页合并不得回退WS进度。scope/App版本、选择代次与operation generation隔离晚结果；历史首次加载禁止写入，用户翻页可取代工具后台读并补安排工具快照。未确认写入仍串行。
7. **生命周期与失败**：Surface按逻辑消息索引导航、保存阅读锚点及库CacheSnapshot；同宽缓存切换先恢复测量再定位，测量缓存随正文缓存淘汰，宽度变化不套用旧测量；prepend复用库shift，单条消息补前缀另按实测行高差保持位置；动态测高期间仅在用户贴底时跟随。删除确认后清缓存/位置，最后会话清空主区；后台列表失败保留旧画面和恢复围栏，权限/认证撤销清私有状态；切换/销毁取消旧读取、订阅、工具timer和视图RAF，不自动重放未知写入。
8. **当前能力与验收**：保留原气泡、审批和工具详情、输入区及悬浮控件，删除无消费者的旧裁剪提示；未缓存正文不再从头读取。Run元数据仍分页到最新并保留最近100项，不宣称其已改为服务端尾页。既有限定CDP验证尾页/连续上翻、长正文虚拟挂载与同宽缓存阅读位置、创建/删除及最小化完成提醒；真实弱网、代码/图片/宽度变化测高与导航交错仍按testing待验，不报告未经实测的加速比例。

### 认证撤销后的通知隔离

1. **职责与范围**：正常退出取消原个人数据意图，不向登录页发布旧视图的请求失败；真实退出接口失败仍由AppHeader提示。
2. **子功能与目录**：shared/session拥有视图scope；命令历史/快捷指令及连接列表组件拥有错误观察与刷新动作；WorkspacePage、布局controller和App拥有各自保存回调。
3. **依赖方向**：组件读取session公开能力；foundation保存器只回传原T，不引用认证或业务模块；后端/Shared契约保持。
4. **类型与转换**：LatestValueSaver.onError(error,value)绑定失败原值，工作区按原permission判断通知资格；无新协议或错误码。
5. **入口与安装**：既有useAuthenticatedViewScope在无会话时从已取消scope开始，attach可建立新scope，logout/切用户/销毁撤销；激活和available变化不能在无会话时重新准入。
6. **数据与并发**：通知及其重新读取动作核对原signal；尺寸、字体、缩放、列宽/侧栏与布局保存均不把晚失败关联到后来激活的页面。不改写入队列、CAS和未知结果围栏。
7. **生命周期与失败**：退出时清除原视图意图，原请求仍由store追踪收口；当前有效会话真实失败继续通知。WorkspaceConnectionList在读取准入及通知前复核认证，阻止注销清理触发新实例挂载后读取。远程桌面尺寸保存要求真实认证用户，避免null身份相等误报。
8. **当前能力与验收**：产品操作见USAGE安全与认证；静态、正式回归及限定浏览器证据分别见testing。注销时布局恢复不重派、清理挂载连接列表不读取和无失败通知已通过专项，扩大在途故障/重新登录组合仍按PLAN待验。

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
8. **当前能力与验收**：双端静态和构建见testing；大文件、取消、版本变化和窄设备资源的待验范围见 PLAN。

### 挂起终端画面恢复的尺寸顺序

1. **职责与范围**：恢复原PTY画面时保留快照尺寸与实时输出尺寸，不改变UI设计。
2. **子功能与目录**：复用Remote WorkspaceService/WS、Shared suspend契约、前端Workspace terminal adapter及TerminalView/output writer。
3. **依赖方向**：后端应用提供快照和尺寸，WS投影事件；前端adapter转换为终端输出元数据，xterm操作仍由Terminal功能持有。
4. **类型与转换**：Shared `suspend.viewport`严格解码columns/rows及baseline/live阶段；应用PreparedSuspendedWorkspace持有独立viewport，接口逐字段投影；前端转换为TerminalOutput.viewport。
5. **入口与安装**：原suspend.resume先发送baseline尺寸再发送快照；resumeAck先发送live尺寸，再调整原PTY并释放实时输出，无新增用户入口。
6. **数据、事务与并发**：尺寸切换经过xterm解析队列屏障，恢复完成同样经过outputWriter/TypeAhead的完整队列，不直接向xterm插入可越过待写入内容的空写回调；容器测量等待恢复完成；同尺寸PTY resize直接返回，checkpoint按捕获的每次尺寸排队，先于相应重绘数据。
7. **生命周期与失败**：原ACK、背压、租约和失效清理保持；屏障绑定writer generation，旧PTY取消后不得调整新画面；本地重挂载快照同样等待解析完成才fit。
8. **当前能力与验收**：实现与静态证据见PLAN/testing；既有fullscreen恢复回归同步协议顺序断言，真实浏览器宽窄切换、正常/备用缓冲区及后台恢复的覆盖范围见测试入口与 PLAN。

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

### 插件市场安装与更新确认弹窗

1. **职责与范围**：PluginManagementSettings将市场共用的候选包确认区放入UiModal，不再插入仓库列表上方；安装及两步升级保留原明确提交动作。
2. **子功能与目录**：继续由agent/settings组件呈现校验信息与确认按钮，use-plugin-management持候选包/安装状态和写入；不新增并行流程、请求owner或弹窗专用类型。
3. **依赖方向**：仅消费foundation/ui的UiModal；仓库校验仍经原prepareCatalogEntry，提交仍经applyCandidate和plugin-management-api，不改Backend/Shared。
4. **类型与转换**：复用agent/model/plugin-types的PluginStage/PluginInstallation；manifest、签名信息及版本映射不变，无新通信字段。
5. **入口与安装**：候选包非空且市场页active时显示；原签名、名称/版本、能力与技术详情移入正文，取消与确认留在独立footer。无候选包时恢复提示在市场，有候选包时在弹窗中显示，始终只显示一处。
6. **数据、事务与并发**：candidate/candidateInstallation是唯一展示依据；沿原canWrite、busy、refreshRequired和mutationUnknown围栏，读写与版本校验不变。关闭只清空候选包，不提交撤销排空或重放未知操作。
7. **生命周期与失败**：忙碌时取消/遮罩/Escape均禁止关闭；空闲关闭、确认成功或失效清空后隐藏。UiModal负责Portal、焦点进入及短屏滚动；调用方在校验请求禁用按钮前保存触发元素，候选包关闭且原视图可写时在DOM更新后恢复焦点，失活时丢弃该引用；active控制离开页签的可见性，原视图owner继续隔离认证/页面撤销后的晚结果。失败重读与未知核对在弹窗内可达，未决状态仍由原owner持有。
8. **当前能力与验收**：源码/静态和限定CDP证据见testing；三语手机/短屏、两步升级和未知结果恢复通过。离开页签/登出晚回执等扩大组合仍待专项，不将取消弹窗声称为撤销升级。

### Agent 聊天工具状态与悬浮控件

1. **职责与范围**：聊天只保留工具调用分组，审批结果进入同一工具状态区域；待审批任务侧栏与最小化快速批准仍持原写入入口。
2. **子功能与目录**：AgentAppSurface按toolCallId建立审批索引；NativeToolActivityList展示状态及处理时间，删除无消费者的NativeApprovalHistoryList及对应文案。控件浮动布局归Surface的模板和CSS。
3. **依赖方向**：继续沿useNativeRuns读取当前Run审批与线程工具分页，复用原工具详情延迟读取；没有新公开入口、全局状态或后台请求。
4. **类型与转换**：复用agent/model/native-run-types.ts；索引按工具ID关联，并复查appId/runId，当前状态还须匹配operationHash和inputRevision/operationRevision。审批时间为秒，展示时乘1000；工具时间保持毫秒。审批与执行状态分别呈现，不将批准转换为completed。
5. **入口与安装**：消息后和未关联消息的工具列表共同消费审批索引；不再独立渲染审批历史。工具未加载时随原工具分页加载，审批读取范围仍为当前选中Run，不伪造其它Run的审批状态。
6. **数据、事务与并发**：只读投影不持久化、不提交批准；审批按输入版本、政策版本及申请时间排序，被取代的许可不覆盖其替代许可；同一工具旧操作的审批留在展开详情，不能作为当前操作已获批准的依据。
7. **生命周期与失败**：保留原订阅、版本合并、Run/Thread切换和失效围栏；页面媒体查询由VueUse随组件作用域释放，不新增业务timer。状态行绝对定位在输入区上方，空白pointer-events:none，只有按钮恢复命中；按钮自身实色，正文保留底部留白。聊天滚动区与footer之间不留gap或顶部padding，使整排状态行都覆盖正文滚动范围；无用量时的发送提示不绘制底色。权限入口与compact附件入口复用soft外观，非compact附件仍沿原ghost；SSH目标仅按页面和输入区宽度响应，VueUse媒体查询页面至少768px且输入区超过620px时显示文字、已选数量和下拉箭头，其余使用square图标触发器；不消费设备类型、UA或触控能力，保留原aria-label/title和选择面板。思考/目标/权限及附件外层不收缩，模型沿原flex收缩；文件/发送持右组，停止移入左组，避免附件flex-1/min-w-0导致根宽小于按钮的重叠。附件、输入框及popover仍沿原布局/Portal，不改变自动跟随与导航动作。思考强度按手选或当前模型默认得出同一有效显示值，标签、说明、滑块定位和强度配色统一消费；未配置默认时显示“自动”，不补造具体请求等级，原模型切换清覆盖和Run冻结保持。
8. **当前能力与验收**：已完成源码与消费者迁移；此前限定CDP覆盖桌面及390/320px的浮层点击/滚轮穿透、Token/消息导航和真实批准/拒绝状态，证据见testing。本轮SSH目标按宽度切换及选择保持已由Desktop Chrome/Pixel 7 UA的1440→390→320→1440px正式远程场景覆盖；真实触摸滚动/软键盘、工具栏组合视觉、扩大审批和历史分页组合仍待专项。

### 自动图片预览

image_generate、artifact_create、artifact_present、file_deliver 的可信成功结果派生 outputArtifactIds，工具说明与 Host 指引明确自动展示，无需模型拼接 Markdown 地址。前端 NativeToolArtifact 以认证 API 按需读取文件元数据，使用现有图片外观或文件卡、FilePreview 和下载入口；失败与过期不伪造成功。Base64 只经生成服务落盘，不写入聊天或工具列表。待批准及失败不产生成功预览；unknown 批次只展示其中已确认完成的文件；刷新后仍可从工具记录恢复，文件读取继续执行原会话与 App 授权。直接 Images 对话仍由程序生成展示内容，不依赖文字模型。

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
2. **子功能与目录**：沿foundation/ui/UiConfirmationPanel.vue与foundation/ui/styles/confirmation-actions.css确认选择器；DialogHost覆盖全部feedback确认/提示，UploadConflictModal和Agent的ModelProviderSettings、AppIntegrationEditor、AppManagementSettings直接共用基础确认面板；普通表单Dialog与管理/批量按钮保留各自职责。
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
8. **当前能力与验收**：同触屏CDP基线复现鼠标菜单后吞第一次选择，修复及既有完整拖动回归证据见testing；真实SFTP覆盖范围见当前测试基线。

### 导航布局测量

1. **职责与范围**：AppHeader 保持导航条当前入口可见，不改变页面缓存和终端会话。
2. **子功能与目录**：app/shell/AppHeader.vue 持有导航条和链接的 ResizeObserver。
3. **依赖方向**：消费 Vue ref、路由路径和浏览器布局通知；不依赖页面业务状态。
4. **类型与转换**：仅组件内使用 DOM ref 与 ResizeObserver，无新增复用类型或协议转换。
5. **入口与安装**：导航 DOM ref 安装观察，路由提交后重新观察导航条，以便尺寸未变时也收到一次布局后通知；宽屏无溢出时不滚动。
6. **数据与并发**：浏览器布局完成后批读尺寸再滚动，避免 nextTick 读取几何或直接 scrollTo 迫使新页面同步布局；导航宽度、字体及当前链接尺寸变化重新测量。
7. **生命周期与失败**：导航条隐藏、DOM替换和组件卸载时断开观察并清除引用；不留下定时器或改变原登录/注销 owner。
8. **当前能力与验收**：保持自动居中、横向拖动和页面缓存，性能及宽窄视口证据见 testing；不承诺消除动态模块下载或页面自身的所有渲染成本。

### 插件目录与卸载意图

usePluginManagement 持已确认安装快照；相同 appId/revision 序列不重复发布，避免父组件重新读取 App/定义。retainedAppIds 来自后端同事务目录，不用本地已卸载列表猜测；Host、App 行及市场为当前投影建立 Map/Set，包 hash/publisher/定义版本匹配条件保留。AppManagementSettings的操作组在640px起继承父行items-center垂直居中，不设置self-end覆盖；更窄视口沿原全宽三列grid排列。App 卸载弹窗使用全局确认组件和默认关闭的清除选项；确认后顺序等待卸载、可选清除，只有整段成功才发布成功。清除的 operationId 留原意图，部分完成失败只重读；撤销后不回填旧状态，不自动重放。市场对应插件行显示保留数据标记及清除/重装；原目录不可用时以真实安装/版本信息显示清除行，不伪造可安装包。清除确认沿原 composable/API，移除独立保留数据面板及无消费者的原 JSON 编辑组件。清除不删除聊天、历史、记忆或文件，必要墓碑不作为可用 App 展示。

### Agent 启用与插件安装引导

1. **职责与范围**：AgentSettingsPanel 开关接 useAgentOnboarding，安装确认与执行总开关仍是两个明确写入。
2. **子功能与目录**：复用原 onboarding composable/modal 和 Plugin API；Host 删除 builtin 分支和无用 definitions 请求；DEV 删除手工创建 App，仅使用已安装 App UUID。
3. **依赖方向**：设置 → 原 composable/API → Shared；Host 按 App/installation/version 完整身份映射 surface。
4. **类型与转换**：声明移除 defaultEnabled；删除无消费者的 DEV App 创建类型/API/翻译，原插件版本哈希与 publisher 白名单转换保持。
5. **入口与安装**：关闭直接写总开关；开启先读推荐，未装显示 Nexus Agent 确认，已装复用，安装成功才写总开关。引导新装由后端原子初始化启用状态与完整声明授权，已有安装不重置；普通市场安装仍需单独启用与授权。引导底部安全提示独立一行；桌面安装/取消并排，手机两个按钮各占一行、文字保持单行，局部样式不修改全局 UiFormActions；手机面板使用16px内边距，标题与发布者标记可自然换行。
6. **数据、事务与并发**：无本地默认 App/旧 ID 兼容；Host 仅匹配真实安装包 manifest、版本、hash 和 publisher；目录 Map 索引保持。
7. **生命周期与失败**：取消/读取失败/安装失败不开启；复用 view/session generation、未知写围栏与只读核对；视图失效后的晚结果不写总开关。
8. **当前能力与验收**：USAGE 同步首启说明；各轮定向浏览器验收与静态结果见 testing；推荐新装初始化全部声明授权，已有安装不自动恢复权限。安装按钮的新排版按 D17 留 Windows/手机实机验收。

### 插件仓库呈现

1. **职责与范围**：PluginRepositorySettings 拥有仓库管理、搜索和插件目录的排版，不改变信任、包校验及安装授权。
2. **子功能与目录**：沿原设置组件模板和 scoped CSS；基础按钮、输入框及提示复用 Foundation，无新增布局组件。
3. **依赖方向**：原管理组件 → composable/API → Shared；布局只依赖组件容器尺寸，不以视口宽度推断设置面板宽度。
4. **类型与转换**：无新类型、状态或边界转换；原目录、安装及保留数据投影继续使用原 owner。
5. **入口与安装**：标题右侧刷新，地址输入与添加位于下一行，搜索独立；容器不超过24rem时刷新只显示图标并保留可访问名称/悬停提示，地址与添加分行。URL 在可用空间内省略，复制/删除仍可用。插件名称及简介自然换行；窄容器将动作置于简介下方，48rem起按简介/动作两列排列，多个按钮整枚换行，按钮内文字不拆行。移除重复的算法装饰文字，实际校验与状态保留。
6. **数据、事务与并发**：纯模板/CSS，无新请求、缓存、测量或持久化；安装、仓库配置 CAS、信任及清除的原流程不变。
7. **生命周期与失败**：复用原 busy/disabled、读取恢复、unknown 围栏、视图撤销及清除确认；加载图标与正常图标互斥，避免双图标占位。
8. **当前能力与验收**：USAGE 对应操作同步；D17 下源码/静态与最新视觉验收分开，320px手机、中英文、长URL/名称和多操作组合待远程或实机核对。

### 网络切换与自动恢复

1. **职责与范围**：WorkspaceSocket 归类真实传输失败/响应等待超时，RuntimeSession 持自动恢复策略与未知结果围栏，WorkspacePage 持浏览器恢复事件及挂起目录协调；不重发输入或文件副作用。
2. **子功能与目录**：沿 workspace/protocol、session、model 及 app/pages/workspace；不新增连接 owner、轮询或 UI。
3. **依赖方向**：浏览器 online/NetworkInformation change/前台事件 → Page → Runtime → Socket；挂起仍沿目录权威恢复，不通过普通重连抢占。
4. **类型与转换**：真实 WebSocket 错误复用 client 的 WebSocketConnectionFailure，请求等待超时由 workspace/model 具名表达；服务器 WorkspaceRequestFailure、协议解码失败和未派发错误保持独立，不按正文判定。
5. **入口与安装**：有 EventTarget 形式 navigator.connection 时监听 change，与 online 共用存活检查；健康链路只探测。监听随页面挂载/卸载安装与移除，失活/隐藏不派发恢复。
6. **数据与并发**：复用原单个连接 Promise、2/4/8/16/30秒退避及离线暂停。传输失败不设置永久 waitingForRetry，恢复中再次收到网络事件保留即时恢复意图；成功不重连已绑定附件。普通 resume 的 conflict/remote_unavailable 可等待旧附件释放后重试原凭据，不自动新建 SSH。
7. **生命周期与失败**：新建请求或 resumeAck 已发送但确认未知仍停止重放；权限、主机信任、目标失效与协议错误仍需明确操作。只有尚未确认所有权的新 resume 可在传输中断/超时后重试，服务端在旧附件脱离时回滚准备状态；已确认附件后的激活网络失败可用已提交新凭据续接。关闭、销毁与身份撤销继续取消原资源。
8. **当前能力与验收**：USAGE 同步网络恢复/手动重试边界；源码、静态及未运行真实行为分别归 PLAN/testing。既有 SSH 服务确定拒绝等待按键的场景继续有效，不能用网络自动恢复扩成未知提交重放或任意程序恢复保证。

### 挂起目录在手机后台与切网后的恢复

1. **职责与范围**：ssh-suspend的原目录流拥有只读订阅恢复，Store拥有列表、loading及未知写入保护；订阅故障不表示PTY丢失，不改变Workspace恢复/接管准入。
2. **子功能与目录**：沿features/ssh-suspend/api/suspended-catalog-stream与composables/useSuspendedSessions，不新增状态owner或HTTP轮询。
3. **依赖方向**：App登录级/面板订阅者 → Store → 原WebSocket运输；浏览器恢复事件只重建目录，不触发SSH写入。
4. **类型与转换**：复用Shared SuspendedCatalogEvent严格解码及原toSuspendedSession投影；失败沿SuspendedRequestFailure，网络对象只检查EventTarget技术事实，无新协议/类型/依赖。
5. **入口与安装**：visibilitychange、pageshow、online/offline及可用的navigator.connection change共用原重连入口；浏览器onLine只作提示，前台连接不受其硬阻断。
6. **数据、事务与并发**：原单socket及revision绑定、1至30秒退避和缓存不变；无持久写入，旧socket回调不能替换新列表，后台推送不解除unknown围栏。
7. **生命周期与失败**：隐藏暂停并清理socket/重试/期限，前台恢复重新读取；首份快照沿原45秒期限，心跳不能重置首次等待，成功快照后继续原静默期限。关闭移除全部事件监听并清理网络反馈，真实失败结束首次loading并退避重连。
8. **当前能力与验收**：源码复审、静态与指定实例只读事实见PLAN/testing；尚未实机观测手机onLine/visibility或复现完整后台链路，不将源码缺口当作已确定的现场唯一根因。

### 设置分类加载与分组排版

1. **职责与范围**：SettingsPage持有路由分类、已访问集合与维护区展开状态；各feature持有表单、读取和写入围栏。UiSettingsGroup负责标题与操作的通用响应式排版。
2. **子功能与目录**：沿app/pages/settings、各功能public与Agent/settings；安全和IP控制分别加载自身面板，备份、诊断、恢复经原feature异步loader加载。没有新全局设置缓存。
3. **依赖方向**：Page只经feature公开入口装配；Agent内部按子分类异步导入扩展、运行时浏览器、安全网络和扩展下的集成/市场/预算面板。Foundation排版不识别具体业务名称。
4. **类型与转换**：分类和展开状态仅归页面，组件沿原props/events；无Shared、持久字段或接口迁移。安全面板不再承担IP控制分支。
5. **入口与安装**：首次访问先解析路由再登记实际分类，不顺带挂载工作区。已访问分类保持实例以保留草稿；诊断/恢复首次展开才挂载，关闭时撤销active，重新展开按原owner读取。
6. **数据、事务与并发**：设置编辑仍使用原版本快照与CAS，完整presentation读取、失效恢复和未知写入不变；减少无关挂载不替代新鲜度与权限核对。
7. **生命周期与失败**：原KeepAlive/auth scope继续负责失活、取消和晚返回；维护区展开状态仅控制原active契约，不重放后台写入。异步模块复用Vue组件加载缓存，业务读取失败仍由各自恢复源处理。
8. **当前能力与验收**：设置分组标题保留可读宽度，动作按可用空间整组换行且不横向越界；桌面有足够空间时仍同排。按USAGE、分类请求计数、宽窄/多语言及原保存/冲突/备份/安全E2E验收，开发模式请求计数不宣称真实弱网提速倍数。

### 设置读取失效与缓存页面恢复

1. **职责与范围**：原个人偏好 editor、后端日志和 Agent 执行设置 controller 拥有读取状态；全局 settings-reload 只汇总真实失败，不把正常初始化或视图撤销算成故障。
2. **子功能与目录**：复用 preferences/composables/use-preferences-editor、logging/composables/use-backend-logging 和原三个设置面板；没有新状态模块。
3. **依赖方向**：面板消费 controller 失败/忙碌状态并注册 Shared Feedback 恢复源，读取仍经原功能 API/Store。
4. **类型与转换**：沿原应用及 Shared 请求/回执 mapper，无新协议和存储形状。
5. **入口与安装**：mount 首读，KeepAlive 激活后等待视图 scope 恢复再按 needsRefresh 只读加载；初始化和加载中的源不触发恢复提示。
6. **数据、事务与并发**：原 busy/读写围栏阻止并发；失活清理旧错误，返回只读核对后才解除写入围栏，不重放原写入。
7. **生命周期与失败**：原 signal/current scope 屏蔽晚返回与 finally；真实读失败、冲突和未确认写继续提供原重新读取入口，重读失败不开放写入。
8. **当前能力与验收**：USAGE 同步返回页面与失败恢复行为；新增缓存往返及原真实失败回归的正式 Actions 证据见 testing，静态与设备视觉证据分开。

### 工作区工具栏的响应调度

1. **职责与范围**：减少导航切换的网络等待与弹窗首次打开的模块/布局等待；保持工具栏、弹窗、终端绘制和尺寸收敛设计。
2. **子功能与目录**：沿preferences/store/preferences.store与PreferencesController、AppHeader/WorkspacePage、WorkspaceTabBar和transfers/ProgressDisplayModal，不建立额外持久偏好或弹窗缓存。
3. **依赖方向**：TabBar仅发代码预加载事件；WorkspacePage使用原功能公开loader，defineAsyncComponent仍按实际打开挂载。PreferencesStore持临时导航预览，AppHeader和Page消费同一计算值。
4. **类型与转换**：PreferencesController.navBarVisible为本地有效值，values仍是已确认偏好；预览不进入Shared、持久快照、完整表单草稿或请求mapper。无新后端契约/依赖。
5. **入口与安装**：导航点击先更新本地有效值，再沿原saveWorkspacePreference串行CAS；指针进入、获得焦点和按下弹窗按钮仅提前导入对应模块，不挂载组件或读取业务数据。
6. **数据与并发**：导航预览按代次关联最新点击，旧保存完成不撤销新预览；最后意图成功或失败后回到已确认快照，未知结果仍由原队列阻断且不重放。Presentation重置清除预览并撤销旧代次。
7. **生命周期与失败**：失效permission不创建预览，原permission撤销立即清除对应预览且finally移除监听；异步finally只处理原代次。进度弹窗通过一次性ResizeObserver通知在布局后定位，视口resize只请求下一次观察，拖动/位置缓存/手机规则保留；卸载断开观察与监听。预加载失败仅留内部原因，显式打开继续由原异步组件处理失败。
8. **当前能力与验收**：USAGE记录导航的即时反馈与保存失败恢复；限定CDP回归、受控回执延迟采样和静态证据见PLAN/testing，真实设备、生产网络及大量任务下的完整profile单列未验。

### 工作区尺寸自动保存的冲突核对

1. **职责与范围**：WorkspaceLayoutController持当前预览和上次确认的本地尺寸，PresentationStore持持久快照、串行队列和恢复围栏；尺寸自动保存按容器比例核对；结构配置弹窗按完整布局与侧栏基线核对，见下节；不扩大到其它表单写入。
2. **子功能与目录**：沿workspaceLayout、workspace-settings-adapter、preferences/store/presentation.store及model/layout-size-merge，布局错误文案由WorkspacePage与原Toast持有。
3. **依赖方向**：Renderer显式分隔条事件→Controller的1000ms LatestValueSaver→原Repository/Adapter→PresentationStore→原API/Shared；恢复读取在原队列任务内部完成，不递归入队等待自身。
4. **类型与转换**：原WorkspaceLayoutNodeState和PersonalLayout各自归属不变，Repository尺寸保存显式接收预览与本地确认基线；Adapter逐字段转换，无新后端/Shared契约。
5. **入口与安装**：按容器完整子项比例三方核对基线/本次预览/当前权威快照；节点ID、顺序、组件和方向均一致才合并。相同容器双方同时改且目标不同则拒绝，未改容器保留权威值。
6. **数据、事务与并发**：只对confirmed/version_conflict读当前完整快照后最多再提交一次CAS；无实际变化不发PUT。连续拖动的后继任务使用前一确认的本地预览作基线，不认领未调整的远端尺寸。保存回执只发布持久快照，不回写正在拖动的预览，远端未调整尺寸在显式重读后显示。
7. **生命周期与失败**：原scope、permission与布局revision阻止离页/身份替换/重读后的旧待保存任务及晚错误；独立resizeScope在重读、状态重置和完整布局保存确认后撤销旧尺寸意图，覆盖冲突恢复读取中的重派窗口；已派发且明确成功的回执在同一布局revision可推进本地基线，失活时不回填可见状态。初次unknown不重放；恢复读取失败保留原409与读取失败因果，二次409及真实尺寸/结构冲突维持原阻断和显式刷新。
8. **当前能力与验收**：USAGE维护自动恢复与人工核对边界；静态结果、远程原始409及17项限定CDP回归见PLAN/testing；实际双页面、连续拖动、断流、刷新和注销边界分别记录，不扩大为全量E2E或真实多设备验收。

### 工作区连接与布局并行初始化

1. **职责与范围**：WorkspacePage 并行启动独立的连接查询动作与设置读取，终端仍等待原保存布局就绪后挂载；不修改布局及操作入口。
2. **子功能与目录**：沿 `app/pages/workspace/WorkspacePage.vue` 的 onMounted/onActivated 与 loadQueryActions，不新增状态仓库或异步包装层。
3. **依赖方向**：Page → Registry/RuntimeSession → WorkspaceSocket；布局仍由原 workspaceLayout owner 读取，终端经既有功能 Port 接收输出。
4. **类型与转换**：原连接摘要、Shared 请求/回执、mapper 及 Promise 保持不变，无新增协议/类型。
5. **入口与安装**：首次挂载及 KeepAlive 后的新连接查询无需等待 layout/focus 读取；先消费一次性路由查询，再沿原连接摘要刷新和 openConnection 派发。
6. **数据、事务与并发**：template 的 layout.loaded 挂载门禁保留；Runtime 已有 pre-mount 输出缓冲及消费窗口继续持字节，挂载后按原顺序解析，不丢输出、不提前开放输入。首次前台恢复仍等待布局和查询动作完成。
7. **生命周期与失败**：loadQueryActions 的原页面 signal/current 检查阻止失活或注销后的晚返回派发；布局失败走原设置重读入口，连接仍由 Registry/Runtime 持有关闭、未知结果和恢复，不因布局慢创建第二份 SSH。WorkspaceConnectionList只对具名TargetRequestFailure/cancelled过滤被单条配置刷新取代的旧列表读取通知，保留真实读取失败的原刷新提示，不修改Store快照与请求时序。
8. **当前能力与验收**：消除布局读取与连接流程之间的代码串行依赖，真实收益取决于读取与握手耗时；USAGE 见终端章节，静态/构建及待验边界归 PLAN/testing。

### 图片预览容量与聊天 GIF

1. **职责与范围**：个人偏好拥有文件管理器与Agent文件库共用的imagePreviewMaxMiB；聊天Artifact图片使用原生img展示GIF，不转码。
2. **子功能与目录**：preferences的两个正式设置面板复用UiNumberInput和原保存流程；file-preview/providers/previewRegistry按格式计算读取预算，Session负责新开与刷新，Workspace/ArtifactLibraryView/FilePreview负责装配。
3. **依赖方向**：预览Session接收读取最新值的getter，不依赖Pinia；Workspace Registry在创建会话时经preferences/public获得controller，恢复和重置沿同一工厂。Agent文件库及独立组件同样注入，未注入的独立Session使用Shared默认20。
4. **类型与转换**：UserPreferences保持本地类型与projectPreferences白名单；Shared字段以整数MiB表示，0映射为无图片大小预算，其余乘1024²。非图片预算不变，值仅在每次读取开始时取一次。
5. **入口与安装**：工作区文件组及另一正式偏好面板均支持编辑/保存；两处图片预览复用已有超限提示、重试/刷新与取消入口。聊天Markdown仍只允许本站已授权Artifact preview相对URL。图片下载控件在原图片仍挂载时插入，再移动图片并清理空包装；链接或强调标签中的图片沿同一路径，后续段落仅在独占一个对应下载链接时折叠，说明文字不整段删除。
6. **数据、事务与并发**：保存继续走原expectedVersion/CAS、草稿与未知写入围栏；仅已确认偏好生效。未自动重载已打开图片，显式刷新取得最新预算。WS文件读取按请求预算累计实际字节，不再叠加固定64MiB总量上限；帧大小、背压与并发机制不变。
7. **生命周期与失败**：关闭、替换、清空沿原AbortController/token检查，旧响应不发布；初次超限保留原tooLarge提示，刷新失败保留原图。0不代表浏览器内存无限，分块读取后仍需整体ArrayBuffer/Blob供预览。Socket在复制/合并分配抛错时reject原等待并清空分块，未完成文件读取同时发送取消；不会因先移除pending/timer而遗留等待。
8. **当前能力与验收**：产品入口见USAGE文件管理器、Agent聊天/文件库及界面偏好章节；类型/格式/生产构建与源码审核归testing；既有CDP验证GIF动画、保存/持久化、两处新开/刷新/65MiB/0，取消/身份撤销/分配失败组合仍待正式回归。

### RDP 证书确认

1. **职责与范围**：连接前显示当前不受信证书，允许取消、仅本次或记住具体指纹；VNC 沿原流程。
2. **子功能与目录**：remote-desktop API 严格读取 Shared，controller 持确认与建连代次，Modal 持当前挑战/Promise，RdpCertificateDialog 复用 Foundation 确认、详情、按钮和勾选框。
3. **依赖方向**：组件→controller/API→Shared；技术 RDP SDK 仍仅在 Adapter，确认前不创建 SDK 或 WS。没有全局信任状态或浏览器信任缓存。
4. **类型与转换**：Shared 请求/响应与本功能独立 Certificate/Approval 分别定义，mapper 白名单转换；API 核对当前 connectionId、RDP 协议和 409 状态。毫秒有效期只在 UI 本地化显示，SHA-256 原样展示。
5. **入口与安装**：ControllerOptions 注入带 AbortSignal 的确认回调，Modal 装配；确认后才发送精确指纹及 remember。基础 UiConfirmationPanel 默认 teleport=true，全屏证书弹窗按 false 留在原全屏节点，既有弹窗不变。
6. **数据、事务与并发**：记住选择只交后端原身份/CAS 事务，前端不把 checkbox 当持久回执；API 返回新挑战时重新显示并清除勾选，不自动接受。未知保存先在下一次连接读取当前信任，不自动重写。
7. **生命周期与失败**：取消正常进入 disconnected；关闭/切目标/登出 abort 原等待并解除监听，generation 阻止晚选择和旧 finally 写回。证书弹窗打开时原 fullscreen Esc handler 让出处理，确认层 Esc 取消连接；actual TLS 指纹变化仍由原桥拒绝，用户主动重连。
8. **当前能力与验收**：源码、三语及双端契约已同步，静态/构建及未验范围见 testing；正式远程基线已覆盖 xrdp 确认及受控证书事实；真实 Windows 证书链和手机弹窗等组合见 PLAN。

### 配置布局弹窗的内容基线核对

1. **职责与范围**：Configurator持编辑草稿及打开时的布局/侧栏基线，Controller拥有预览与尺寸任务，PresentationStore拥有串行队列及完整权威快照。解决同页锁定开关、其它偏好保存推进共享版本而误拒布局保存的问题，UI及刷新入口不变。
2. **子功能与目录**：复用WorkspaceLayoutConfigurator、workspaceLayout、workspace-settings-adapter与preferences的presentation.store/model，不新增持久状态。
3. **依赖方向**：弹窗→Controller→Repository/Adapter→Preferences公开Store→原API/Shared；恢复读取位于同一队列任务，不递归入队。
4. **类型与转换**：WorkspaceLayoutConfiguration与PersonalWorkspaceLayout分别归运行时和偏好model；Adapter逐字段转换基线/目标，并返回实际确认的完整WorkspaceLayoutConfiguration。共享版本仅由PresentationStore持有，移除Controller无消费者的重复版本状态。目标与基线入队前复制，不携带失效的表单版本作为写入许可；API仍严格提交expectedVersion并核对完整回执。
5. **入口与安装**：saveWorkspaceLayout在队列真正执行时核对当前快照。布局与侧栏作为一个整体；当前仍等于原基线才提交目标，目标已是当前值或没有本地修改则不重复写入。Controller应用实际确认的布局/侧栏，不能以旧草稿覆盖无写入时返回的当前配置。
6. **数据、事务与并发**：保留原workspace-layout原子CAS，无数据库迁移。无关偏好/焦点变化可以推进版本；当前布局/侧栏与基线、目标均不同则拒绝。与尺寸保存复用有限CAS恢复：仅confirmed/version_conflict只读核对后最多再提交一次，二次冲突不循环。尺寸flush后重新取Store当前版本，不引用弹窗打开时的版本。
7. **生命周期与失败**：派发及恢复读取后复查原scope/permission；撤销不追加写入。unknown不重放，真实内容冲突、读取失败和二次拒绝维持原围栏并保留草稿；显式刷新放弃草稿并重新建立基线。
8. **当前能力与验收**：USAGE同步自动核对与人工刷新边界；正式远程用例覆盖同页锁定后保存、外部无关版本推进、真实布局冲突、提交后丢失响应及二次409。静态、完整Actions与尚未覆盖的真机边界分别记入testing。

## 前端分级诊断

1. **职责与范围**：`client/logging/logger.ts` 是浏览器 Pino 唯一实例；偏好 Store 是生效等级的唯一 owner，覆盖启动、认证、导航、传输、工作区和 Agent。日志不上传、不持久化、不改变 UI。
2. **子功能与目录**：沿既有 logger、transport-diagnostics 与 app/bootstrap/runtimeDiagnostics；真实状态 owner 记录状态变化，传输 owner 记录安全技术元数据，不新增并行日志系统。
3. **依赖方向**：logger 消费 Shared `FRONTEND_LOG_LEVELS/FrontendLogLevel`；Client、Runtime 和 Feature 依赖 logger；Client 不反向依赖 Feature。
4. **类型与转换**：错误通过 Pino 的浏览器 `err` serializer 白名单投影类型及源码位置；忽略错误正文和自定义字段。HTTP/WS 只投影 pathname、本地关联编号、状态、耗时与缓冲字节，不记录查询参数、凭据、正文及聊天/终端内容。
5. **入口与安装**：main 安装全局和 Vue 错误诊断；偏好同步沿原 Store watcher；Axios 与 fetch 共用 HTTP 诊断，正式构建不包含 `build/e2e-browser-diagnostics.ts` 测试入口。
6. **数据、事务与并发**：不涉及数据库或迁移；HTTP 回调仅结算一次，Axios 通过 WeakMap 关联配置与诊断，不修改请求头、重试、错误或未知结果契约；页面内编号不等于服务端请求 ID。
7. **生命周期与失败**：全局监听与 PerformanceObserver 属于页面生命周期；WS 与 Agent 沿原关闭/重连 owner，不新增 timer。取消/主动关闭记 debug，恢复失败记 warn，协议/未捕获异常记 error；trace 走 console.debug 避免逐帧捕获堆栈，长任务先检查等级再聚合。
8. **当前能力与验收**：新增正式浏览器场景覆盖等级动态过滤、silent、脱敏、HTTP 关联与取消以及 window/Promise/Vue 异常；实际执行、静态结果与远程待验分开记录在 testing/HISTORY。

## OIDC 登录与安全设置

### 1. 职责与范围

Auth 持有 OIDC HTTP/浏览器跳转适配与认证状态；Security 持有配置草稿和操作状态，LoginPage 与独立公开 OidcCallbackPage 组合路由。登录布局保留原主题、宽屏双栏和手机单栏，短视口自然滚动。

### 2. 子功能与目录

`features/auth/{api/oidc-api,adapters/browser-oidc,model/oidc-types}` 隔离协议与浏览器能力；`security/composables/use-oidc-settings` 管理读取、保存、绑定和未知结果；`OidcPanel` 复用 UiSettingsGroup。

### 3. 依赖方向

页面组合与 Security 只从 Auth public 引用能力；Auth API 使用 Shared 严格编解码，转换为自己的应用对象。没有第二套身份 Store。

### 4. 类型与转换

OIDC 设置/写入/回调类型在 Auth model；api 逐字段构造 Shared 请求，解码结果后逐字段投影。浏览器适配只保存流程用途，不保存 secret、code、PKCE 或 token。

### 5. 入口与安装

设置页新增 OIDC 分组；登录页仅显示服务端已启用绑定的提供方；`/login/oidc/callback` 为公开路由，允许已有会话完成绑定。

### 6. 数据、事务与并发

配置按服务端 revision 提交，结果未知或冲突进入只读刷新围栏，不自动重放。未保存配置阻止绑定。客户端不决定外部身份权限，完成后重新读取真实 Access 会话。

### 7. 生命周期与失败

组件停用、卸载和身份失效使旧 generation 失效并取消请求；秘密和密码清空。回调取出 code 后移除 URL 查询和 sessionStorage 用途，失败显示返回入口，不重放。由 OIDC 创建的当前会话被配置修改撤销后返回登录页。

### 8. 当前能力与验收

协议链已通过十二项真实签名 IdP 回归；浏览器、短视口和数据库验收以 testing/HISTORY 的实际记录为准。真实 Pocket ID 部署、真实手机键盘不由测试 IdP 代替。

### 终端断线恢复入口

1. **职责与范围**：TerminalView 显示独立错误卡片及重试按钮，不将本地错误混入远端输出。RuntimeSession 持真实状态，Page 区分普通连接与挂起会话恢复。
2. **子功能与目录**：沿 features/terminal 的组件和 i18n、runtimes/workspace 的 model/session/renderer、WorkspacePage 修改；复用 UiButton，不增加重连服务。
3. **依赖方向**：TerminalView 只发布 interaction；WorkspacePage 调原 RuntimeSession 或目录/Registry 恢复能力。终端不依赖 Workspace 私有状态。
4. **类型与转换**：前端 WorkspaceConnectionFailureCode 引用 Shared WorkspaceErrorCode 并补本地 network/timeout/unexpected；原具名异常显式映射。安全错误文案按有限类别本地化，不解析或展示原始异常正文。
5. **入口与安装**：按钮、终端容器键盘与 Android composition 共用既有重试意图；复制、Tab、浏览器快捷键不触发重试。触屏恢复不主动唤起键盘，正常输入与选择流程沿用。
6. **数据、事务与并发**：无协议/数据库变化。普通重连共用现有连接Promise；挂起显式重试按原标签去重，目录读取后复核实例，接管沿既有确认，不自动替换成新的SSH会话。
7. **生命周期与失败**：仅活动可见终端响应交互；停用、关闭、重置、未知结果围栏不接受新恢复；晚响应沿原page scope处理。成功/连接中撤去恢复卡片，失败保留一份；手机/短面板卡片限制在当前终端高度内并可滚动。
8. **当前能力与验收**：桌面/手机真实Chromium和SSH专项证据见testing；真实手机输入法、运营商网络与未列故障仍按PLAN推进。

### Agent 日志存储等待

现有任务侧栏资源卡消费 Shared waitingOutputJobs，经 NativeResourceSession mapper 显式转换；非零时显示释放磁盘空间后继续或停止任务的提示。状态仍通过原 Run 订阅更新，不轮询日志正文、不改变取消确认或任务终态。

### 终端失活输入与历史准入

1. **职责与范围**：TerminalView持可交互状态、DOM用户输入和历史展示；Workspace Runtime继续持连接/租约与命令派发。不改UI、字号策略或后台协议应答。
2. **子功能与目录**：沿TerminalView的resetInteractions、DOM capture监听、loadPreviousOutput与rebuildHistoryWindow；测试专用browser-terminal入口只用于正式E2E，产品不暴露测试控制。
3. **依赖方向**：View消费原TerminalChannel与xterm公开DOM/buffer/parser API，不反向引用Workspace或私有xterm输入实现。
4. **类型与转换**：历史暂存只保存经TerminalSessionState流式UTF-8解码的string；不重复保存/解码Uint8Array。原字节消费回调仍绑定原传输；无Shared或数据库变化。
5. **入口与安装**：根节点capture检查input、paste、composition事件的实际可交互状态；失活清空textarea，compositionend允许空值进入xterm完成原IME状态清理，其余迟到用户事件阻止传播。不在onData统一拒绝后台数据，保留正常DSR等协议应答。
6. **数据与并发**：历史仅普通缓冲区准入，请求返回及真实解析屏障后再次检查；若已切备用屏幕，原历史页放弃并重置游标，进入检查时暂存的实时输出仍依原序交付，解析后归还每份消费信用。
7. **生命周期与失败**：活动判据包括props.active、KeepAlive、document.visibilityState与DOM存活；事件监听随组件释放。PTY更换与取消仍沿原generation，不把失活当远端任务终止；历史读取失败不拆除健康终端。
8. **当前能力与验收**：USAGE同步失活输入、全屏滚动与恢复尺寸顺序；本地受控浏览器、真实SSH/手机仿真和指定CDP证据归testing，真实Android/iOS输入法和运营商切网不由模拟事件代替。

### 工作区连接选择次序

1. **职责与范围**：WorkspacePage持用户选择次序，Registry持会话注册与当前activeId；连接完成不构成新的选择动作，不改变现有UI。
2. **子功能与目录**：沿WorkspacePage和workspaceRuntimeRegistry，复用原activationGeneration与preparingSessionId，不新增独立选择Store。
3. **依赖方向**：页面通过Registry.open显式传激活意图；Registry不依赖页面、Router或具体控件。
4. **类型与转换**：Registry.open本地选项包含viewport和activate；无Shared/后端/存储契约变化。未声明activate的直接打开沿原默认激活。
5. **入口与安装**：查询、批量、工作区单连接、标签点击及新连接页共用选择代次；查询在读取配置前捕获，整批连接保留同一代次。
6. **数据、事务与并发**：异步读取或前一SSH握手完成后，较旧批次仍按原顺序注册剩余连接，但不改activeId或关闭启动页；新动作同时撤销旧标签预布局的nextTick/动画帧切换。
7. **生命周期与失败**：原pageScope继续撤销离页/身份变化后的未派发动作；后台连接仍由原Runtime管理，不取消已派发SSH或重放输入。成功与失败均不补发激活动作。
8. **当前能力与验收**：USAGE明确最新选择优先；桌面/手机延迟配置读取、批量、后台握手和手动选择覆盖归testing，真实手机/网络边界保持独立。
