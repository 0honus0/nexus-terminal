# 前端架构

本文按 [模块模板](MODULE_TEMPLATE.md) 维护功能、运行时与界面的职责，开发前读取 [AGENTS](../AGENTS.md)、[人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 及 [编码规范](../rules/CODE_STYLE.md)。产品行为以 [USAGE](../USAGE.md) 为准。

## 1. 职责与范围

Frontend展示产品状态并驱动用例，服务端事实不在浏览器重建为另一份权威。正式认证、Targets、Workspace/Files/传输/挂起/监控/Docker/桌面、个人设置、审计通知、备份诊断、外观及Agent管理／Host／运行界面源码均已消费Shared；前端源码没有旧Protocol依赖或新旧响应兼容层。源码适配与部署切换、静态与行为验收分别判断；D17最终远程Actions E2E及D16外部验收仍待完成。

## 2. 子功能与目录

| 位置                         | 职责                                                |
| ---------------------------- | --------------------------------------------------- |
| `app/`                       | 入口、路由、全局装配与样式/i18n 聚合                |
| `features/<feature>/`        | 业务界面、用户动作和功能状态                        |
| `runtimes/<runtime>/`        | 连接、协议流、资源生命周期与运行状态                |
| `client/`                    | 当前正式 HTTP client、解码和资源 API                |
| `foundation/`                | 无产品语义的 async/browser/data/interaction/ui 能力 |
| 本包 `shared/`               | 跨功能注入能力、反馈、焦点和认证生命周期协作        |
| workspace `packages/shared/` | 真正双端类型与通信契约                              |

新后端开发能力在 `features/targets-next`、`runtimes/remote-next`；Agent 状态消费归 `features/agent/next` 的 api/model/views/i18n，DEV 路由为 `/__agent-next`。共用 Access transport 归 `features/auth/api/access-api.ts`，通过 Auth public 安装到 Targets/Agent DEV；正式 Auth 经 `api/auth-api.ts` 和 `model/auth-mapper.ts` 转成独立应用用户，旧 next client 删除，不保留转导出。现有业务按真实 owner 扩展。i18n 使用所属功能目录，应用入口聚合，不把翻译或 UI 草稿放入 workspace Shared。

B5.2 只读步骤审计在原隔离 `features/agent/next` API/Controller/DEV view 增加 `GET /steps/1` 与 `/steps/1/events` 消费：传输只使用 Shared 严格 path/query/response codec，响应仍受 32 KiB 上限，Controller 将 wire 逐字段转换为独立应用 step/event 状态，保有按 Run 隔离的元数据和游标。transport 核对响应与请求的 App/Thread/Run 关联及分页界限，按具名失败类/code 判断错误，不比较异常正文。登录状态失效、切换 Run 或中止异步请求时不显示旧步骤；没有实际步骤（404）显示“无步骤”，不把 pending Run 伪装成执行中。开发页只显示文本**字节数**、状态和用量，绝不显示模型原始 output。正式Agent Host已接入当前Run/正文分页，独立DEV不代替正式界面验收。

隔离开发页的创建 Run 原本仅发送 `prompt`，不满足 B5.1 已安装的强制 `model` 请求。现经 `GET /ai/providers` 使用 Shared 的严格 Provider 列表解码、独立 8 MiB Provider 响应读取预算，Controller 仅保留启用 Provider 的模型选择元数据，提交时携带 `providerId/modelId/configurationVersion`，三字段一起纳入幂等写入签名，保留相同内容未知提交的原 key。Provider 配置是候选目录，后端依旧核实实时版本与能力冲突，任何本地选择都不成为真实执行授权。失效登录重置候选选择，刷新后不可用的选择会清除；本入口不是正式 Agent 页面迁移。

Host Key管理归features/connections：model/host-key-types拥有独立Summary/Draft，host-key-mapper逐字段映射，api/host-keys-api消费Shared严格codec并核对确认响应的host/port/fingerprint；composables/use-host-key-management拥有弹窗局部状态，不建跨页面缓存；HostKeyManagementModal从正式Connections工具栏打开。它不依赖连接凭据表示。

Connections的应用Summary/Draft/Controller/回执归model/connection-types，wire转换归connection-mapper；connections-api严格消费Shared并核对ID、原版本+1、导入回执数量/唯一ID，connection-test-api独立消费Remote测试安全状态。Store唯一拥有会话/revision围栏与最近连接毫秒缓存，use-connection-editor持编辑快照/安全凭据版本和独立保存，use-connection-management持批量/确认/测试/导出，connection-script是无副作用解析。创建复用单项import事务，不拼接两次写入；import可创建的Tags/Proxy/Key通过已有公开能力刷新目录，读取失败不改变原提交类别。跨功能只消费Connections public的应用类型和窄Store能力，不公开裸transport。

Workspace复制/移动/归档的完整传输职责归 runtimes/workspace/adapters/transfer-adapters；capabilityAdapters只装配上传及该适配器。各任务只保留路径、原附件能力、进度、确认状态与期限，不缓存归档密码。应用请求/任务/失败仍唯一归 features/transfers/model/transfer-types，复用失败统一为TransferFailure；独立服务器HTTP任务归server-transfers-api、server-transfer-types/mapper及serverTransfers.store：Shared wire严格解码后转独立应用对象，不借用Workspace任务授权。

正式Agent的Registry消费归`api/registry-api`与`api/management-request`；后者复用`client/http/json-client`，只持有Agent安全失败与协议预算，不持有认证状态。`model/registry-types`拥有独立应用对象，`registry-mapper`逐字段投影并将秒转为毫秒；状态卡片`settings/ModelRegistrySettings`独立安装在设置页，不依赖旧聚合settings加载成功。Provider编辑器的模型建议也经此入口；旧Registry Envelope/CSRF和Provider管理写接口已删除，不新增新协议到旧响应的兼容包装。Host/SDK已消费当前Shared Provider/模型目录，行为单列验收。

正式执行设置归 `api/execution-api`、`model/execution-types`/`execution-mapper`、`composables/use-execution-settings` 和 `settings/ExecutionSettings`。Shared 持完整响应 codec、有限 profile/模型容量；mapper 将 tools 数组转本地可编辑文本，写入显式反向投影。组件独立安装，不消费旧聚合 requestedSettings；模型目录仅投影候选，不借用旧 Provider DTO。

正式供应商管理归 `api/provider-management-api`、`model/provider-types`/`provider-mapper`、`composables/use-provider-management` 与 `settings/ModelProviderSettings`/`ProviderModelEditor`。ProviderDraft独立持原ID/version、可编辑能力与keep/replace/clear凭据意图；只读来源/观察不进入写命令。管理页独立安装，不从旧settings推导默认/fallback模型；更新按原版本CAS，未知/冲突只读恢复。发现已有Provider后读回观察才开放草稿，测试不自动重放；scope撤销清秘密、结果和确认。正式Host/SDK已消费Shared；管理、原生运行与插件授权仍分别核对。

App管理和治理归 `api/app-management-api`、`model/app-management-types`/`app-management-mapper`、`use-app-management`/`use-app-governance`；`AppManagementSettings`按真实实例ID装配具备独立授权/策略草稿的`AppGovernanceEditor`，选中实例变化通过key销毁原scope。`SafetyNetworkSettings`独立持禁用名单草稿；`AgentTargetPicker`复用Connections public的安全应用目录，保留未解析选择，不因加载失败清空授权。`use-agent-management-operation`统一单一编辑owner的请求互斥、generation、身份撤销和unknown只读围栏，不拥有业务对象。各写入仍按原版本显式投影；禁用名单Unix秒仅在mapper转毫秒。Host/集成/Memory的App读取已分别迁移，不拼旧App对象兼容。

Browser管理归browser-api、model/browser-types与browser-mapper及BrowserRuntimeSettings；配置只保留原version和独立targets草稿，URL按Shared规范化后核对完整确认。双端容量归browser-values，持久Adapter独立解码，不引用wire DTO。

AppScopedSettings持有管理卡片自己的App目录/选择和撤销scope，按实例key安装AppIntegrationEditor/AppMemoryEditor，不依赖旧聚合settings或声明名称。集成transport持真实/api/v1/apps命名空间、UUID创建头、CAS/删除正文与完整目录codec；integration-types/mapper持独立配置/文本草稿/目录，use-app-integrations持原修订、确认及未知创建原输入/键。原键重放只触发重新读取当前列表，不将首次回执当当前配置。旧MCP/ACP组件和旧API删除，模型调用/Host另行迁移。

Memory的transport归memory-management-api，独立对象/提案草稿及转换归memory-types/mapper；use-app-memory持offset页、当前审核快照和非幂等创建未知围栏。MemoryImportEditor持来源读取/一次性确认及按分配ID的只读恢复，MemorySourcePicker持已发布来源分页。导入完成推进列表本地修订，较早列表返回不能解除刷新围栏。App切换、身份撤销和离页清正文/确认，毫秒不重复放大；Slot组件不持业务写策略。

Artifact正式库归artifact-management-api、artifact-types/mapper、use-artifact-library与files/ArtifactLibraryView；设置及浮窗均直接安装，目录/统计/写入分别持scope。offset分页、CAS、两步上传、完整有界字节校验和Blob URL归真实视图owner；ArtifactAttachmentEditor持单文件原版本与显式引用意图。ArtifactPicker消费同一新transport，独立持私有上传意图、恢复与offset，Conversation/Host附件使用ManagedArtifact，不拼旧Artifact DTO。

插件正式管理归plugin-management-api、plugin-data-api、plugin-types/mapper、use-plugin-management以及PluginManagementSettings/PluginRepositorySettings/PluginDataEditor；设置父页仅装配独立卡片，旧聚合settings、假安装进度与旧管理transport已删除。发布者version、包version、安装revision独立；数据原意图/operationId在未知后保持不变。快照仅在已准备升级的draining状态读取；普通单键读取与已移除数据清除不借用迁移快照。

descriptor声明的消息容量与真实前端RPC预算同源；父桥在请求解码及响应派发前同时检查descriptor上限，核心子协议继续由各自严格codec限定。

插件运行协议归plugin-runtime-api与plugin-sdk/host-bridge。descriptor严格解码后投影独立本地对象，grant从经验证的短期URL取得；桥只在真实iframe source的ready/init/ack后转发Shared RPC envelope，全方法由新后端执行授权，不保留旧agent-dispatcher与旧SDK协议转换。RPC完整响应关联nonce/id/seq/request并核对HTTP状态；本地取消不证明远端未执行。隐藏/切换/身份撤销、过期和异常消息关闭端口、计时器与等待；PluginAppFrame按真实visible控制scope。原生Host也已接入Scope工作区协议，与插件桥各自保留授权及生命周期。

## 3. 依赖方向

app 装配 feature/runtime；feature 通过窄公开能力消费 runtime 和 foundation。跨功能通过公开入口/明确能力，不深层引用私有组件、Store 或实现。foundation 不反向依赖业务。新 Shared 契约按 [SHARED](SHARED.md) 消费，不在前端手写同义 DTO。

DEV transport 创建 Run 明确传 connectionIds:[]，不声称已有选中器；controller 消费 Shared stop/tool_calls 基础值，但 DEV view 仍只读取步骤 1。正式Host另有实际模型／SSH选择、正文游标及Step/Tool审计，不扩充DEV页面冒充正式消费。

## 4. 类型与转换

认证请求/完整响应、安全错误与基础认证16KiB请求/响应预算来自 Shared Access，TOTP成功复用因素codec。`client/http/json-client.ts`只负责同源有界JSON fetch、严格UTF-8/媒体类型、取消、完整期限及body收尾，不引用业务。Auth transport校验成功状态、完整Shared对象及安全失败；只有精确401 unauthenticated转换成匿名。`model/auth-types.ts`拥有本地用户/认证状态，mapper逐字段投影；同义写请求引用Shared，不借用旧Protocol。

正式Agent工具审计经native-audit-api消费Shared tools的单项／事件页与128 KiB预算，核对App/Run/Tool和原after/limit，逐字段转本地NativeTool/Event。参数与原始结果正文仍不公开；审计不授予执行权。

HTTP/WS transport 从 unknown 验证完整响应及安全错误，wire 与 UI 草稿/展示状态区分。字段、嵌套对象及联合分支按白名单投影；不能用断言冒充响应解码。Agent next API 使用 Shared codec，controller 再逐字段投影为本地应用状态。请求完整编码字节预算与后端共用 Shared，响应流在累计预算内读取，不全量加载后才拒绝。

跨 controller/view 复用的应用状态及错误联合归所属 `model/*-types.ts`，仅局部使用的类型留实现文件。Shared 负责字段形状及基础取值；transport 持有请求上下文，核对资源身份、端点成功状态与分页 after/limit，再交给 controller。响应声明异常或超预算的早退也收尾未消费 body；已取得的 reader 在最终路径释放锁。

Tags的本地类型/mapper/API/Store归features/tags；use-tag-picker持有选择器实例，Workspace标签组协调归runtimes/workspace/composables/use-tag-group-management，输入类型归model/tag-group-types。改名与关联替换分别提交，按原快照CAS；关联成功/未知使Connections缓存失效，页面通过changed事件重新读取，不把读取失败改写成保存失败。ensure先校验完整名称集合，再串行创建，未知停止派发并保留已确认项；旧Tags Protocol出口与公开裸transport已移除，App capability经过Store围栏。正式Connections列表、表单与Workspace标签树已迁移；终端和Files已逐功能接入，传输及桌面协议已按各子批消费Shared，整体恢复仍待F1-C2-D，不将管理列表完成等同于整个Workspace迁移。

Targets正式资源请求归`client/targets/target-request`，它消费Shared安全错误、完整预算与已有同源Cookie传输，不持有登录状态。Proxy/SSH Key各自api严格解码集合、创建视图及更新联合；更新校验原ID/version+1，安全错误同时核对HTTP状态。各自model mapper将wire逐字段转为本地Summary，并将独立表单草稿转为Shared写命令；跨功能capabilities引用feature public的应用类型，删除旧Protocol别名。列表最多10,000项，Proxy完整JSON 64MiB、SSH Key 16MiB，拒绝重复ID、非法时间及额外私密字段。

ProxiesView 的错误状态是显示副作用，不再通过 `v-else-if` 卸载最后一次确认的代理列表。错误 alert 与实体行并列；全部写入按钮仍按 Store 的 `needsRefresh` 围栏禁用，View 不重发未知 mutation，也不自行销毁缓存。

Workspace下载归runtimes/workspace/adapters/download-adapters，正式FileManager通过FilesystemDownloadPort消费；它复用同源有界JSON client，Shared严格解码201票据、有效期与有限安全失败，再显式投影本地{url}。只接收固定相对下载路由和单一ticket参数；目录URL由原connection/workspace/path编码构造，不接受任意服务端导航地址。原附件ACK/socket、生命周期AbortController和调用方signal共同限制派发及晚结果；FileManager失活、卸载或能力替换后不触发anchor。anchor交给浏览器后，文件交付不由Vue状态确认；服务器传输/归档能力已分别迁移，完整页面仍C2-D。

Workspace上传归adapters/upload-adapters，通过capabilityAdapters装配到正式TransferChannel；UploadCommand/TransferTask/TransferController及冲突类型唯一归features/transfers/model/transfer-types。Shared完整prepare/start/stop回执与upload事件严格解码；投影为独立应用事件，只发布需要的进度/冲突/安全失败，不把wire对象作为UI状态。目录完整计划和编码预算在首个控制请求前核对，prepare回执绑定根目录/目录集合和原附件代次。

上传保留原6–12路私有调度和有界WS缓冲，独立/ws/uploads单块最多Shared的1MiB。任务同时取得start回执和ready后才开流；零字节等待完成事件，不开字节通道。原任务持有控制附件、File快照、字节socket、期限和监听；检查进度序号/累计字节/声明量及终态路径/metadata。发送完成及cancel/abort布尔回执均不代表发布或清理完成；收到合法终态才结算。断线清除准备依据并结束原等待，已派发显示unknown且不prepare/start重放，队列未派发可确认取消；晚事件/旧finally不能复活终态。未知记录保留三语核对远端提示，不自动删除；页面撤销/完整交互仍C2-D。

复制/移动/归档由Shared transfers/workspace与task-codec严格解码完整事件，再逐字段生成应用进度/安全失败/终态；核对原请求的mode、全部源路径、目标路径、跨Workspace身份及结果items。归档核对operation/结果目录与有限警告、工具名和密码拒绝码。递归进度的totalKnown=false不作为精确总量或百分比，未知总文件数显示为未确定；不得用顶层选择项数限制递归完成数。应用基础格式与归档错误码精确引用Shared values，不再借旧Protocol。

## 5. 入口与安装

路由和 app 负责安装功能，view 负责展示和用户交互；异步协调、订阅和资源生命周期由明确 controller/runtime 持有。Agent next 与 Targets next 只在 DEV 路由安装，从 Auth public 消费同一 Access client，传独立 `/__next/api/v1/auth` 基址；正式认证默认 `/api/v1/auth`。基址只选择实际入口，不兼容旧响应。通用 UI 从 foundation/ui 的正式入口消费，功能布局由各业务 owner 负责，不把产品逻辑塞入基础组件。

## 6. 数据、事务与并发

桌面尺寸的本地编辑归RemoteDesktopModal，个人偏好写入仍归Preferences；App装配单次保存状态与有限失败反馈。保存期间同时禁用尺寸输入和拖动，避免两个完整偏好快照共用旧版本，以及较早响应回填正在编辑的尺寸；不自动以新版本重放失败写入。身份变化后旧保存不向新用户发布失败提示，已派发写入仍由原Preferences实例追踪。

改密由Auth Store持有：确定成功撤销本地认证；交付/提交未知清除用户并保留unknown；明确拒绝不冒充成功。认证变化驱动原会话资源收尾，原设置路由完成回登录导航，不由旧页面覆盖后续导航。TOTP设置由Security composable持有，Shared响应逐字段转本地临时setup对象；QR只接受有界inline PNG，启停后重读身份。unknown清除setup/密码并阻止重复写入，先只读核对；取消、因素状态改变、KeepAlive停用和卸载使旧generation失效，秘密不持久化。

Auth Store分别隔离setup/session generation；登录、登出和失效使旧会话结果失效，旧await不能复活登录。探测网络/协议失败保持unknown，禁止兼容fallback；路由在setup未知时进入可重试Login，只有服务端成功/明确401才确定状态。写入结果未知不自动重放，安全三语反馈要求先刷新状态。DEV登录遇到requiresTwoFactor只提示待因素，不伪装已登录；DEV完整因素界面尚未迁移。

浏览器缓存只是服务端状态投影，不替代版本/CAS/幂等。Agent next 为同一 create/cancel 写入意图保留稳定 Idempotency-Key；网络、协议或未知提交结果不会自动换 key。version_conflict 只刷新最新状态，不盲目继续写。登录、scope/run 切换、刷新和卸载使用 generation 与 AbortController；await 后检查有效性再发布，旧 finally 不清除新任务状态。事件按 runId/sequence 去重，游标只使用服务端 nextCursor。

Proxy/SSH Key各Store拥有共享读取、会话generation及写入围栏；写入使旧列表失效，旧finally不能清除新读取。冲突/不存在/身份失效或未知写入结果要求显式只读刷新，成功刷新后由用户重新编辑；DELETE沿实际后端按ID删除，不虚构版本参数。管理composable拥有确认等待和页面/弹窗取消，隐藏或停用清除秘密；取消不证明服务端回滚。SSH文件先查64KiB容量再严格UTF-8解码，失效文件读取不回填草稿。选择器只依据成功、完整且有效的列表清除已不存在的选择，缓存重置或读取失败不清空连接草稿。

Host Key确认/移除沿后端真实host/port契约，没有CAS，UI明确警告覆盖/删除并要求独立确认。请求派发前验证完整输入，失败后只读恢复，unknown不重放。可见性、身份变化、KeepAlive停用和卸载取消请求及原确认，清空列表/草稿并使generation失效；旧回调和finally不覆盖新面板。共享client/targets沿用Access Cookie，不新增登录或旧CSRF。

连接编辑元数据与credential分别读取并核对同一版本；无法取得一致快照时不开放编辑。批量使用原快照、先校验全部分批输入，再串行提交；按原序保留已确认导入回执，unknown/冲突停止派发且无自动重放。关闭批量窗口取消原确认/等待，旧finally不覆盖新窗口。导入文件在浏览器严格UTF-8/1MiB解码为新数组，经JSON items分批发送；最大500项是本地交互政策，协议每批50项和1MiB归Shared。导出逐字段投影新配置，不含凭据，引用仅属当前实例；无新导出HTTP。旧ConnectionDto/API和旧存储键桥接已删除，保留未迁移Remote运行协议时，只在当前运行事实入口将秒明确转毫秒，C2改为实际Shared单位。

复制/移动/归档在原附件派发，完整控制请求仍受Shared 1MiB预算；任务等待start受理与合法终态两项依据，早到事件只保留最新进度和一个终态。取消布尔值仅表示受理；响应失联、协议失败、期限或销毁保留unknown并结清等待，不自动重放。晚事件和旧请求拒绝不能覆盖终态。底层任务期限一小时，前端额外30秒只用于等待终态交付，不宣称远端已停止。

FileManager及WorkspaceSessionSurface以useAuthenticatedViewScope持有文件UI意图，LayoutRenderer传递active。导航排队、原生选择器、Clipboard API、删除确认及归档密码均绑定原视图/原能力；删除用独立操作token防旧finally解除新锁。归档/移动/上传已接纳任务归原TransferController，后续刷新/错误/密码提示只向仍有效原视图发布，后台观察拒绝显式收尾。

正式剪切粘贴（含跨Workspace）直接使用后端move，源复查/删除归原Files任务，前端不在copy后另发remove。已确认移动后清除原剪贴板代次；目录刷新独立处理，失败提示只读核对，不把已完成移动改成失败或重做。核心正式文件链路已有整页验收；扩大跨业务撤销继续C2-D。

Registry状态卡片由`useAuthenticatedViewScope`隔离身份、卸载及KeepAlive失活；原任务独占busy，旧结果和finally核对scope/generation。刷新失败阻止再次刷新，成功只读核对后由用户决定新操作；不自动重发写入。模型查询核对返回modelId与请求一致，只有服务端明确null才是无匹配，技术失败不转成空结果。

执行配置的保存快照、普通草稿、硬限制草稿和确认分别持有；保存使用原 version，预览绑定完整 proposed/version，confirm 只发送原确认 ID。普通草稿有变更时不能预览，确认存在时锁定普通草稿，编辑硬限制使确认失效；提交前复查期限，提交即移除可再用确认。读写互斥，模型目录独立读取。写入冲突/unknown 须显式只读恢复；读失败不解锁，不自动跟随新版本续写。视图 scope/generation 约束全部返回与 finally，撤销清除私有状态。

终端输出解析归 TerminalView／terminalOutputWriter，绘制调度归 workspace 安装的 xterm 补丁。DEC 2026 开启通知先登记待绘制范围，关闭通知经 RenderService 同步提交，避免整帧同批解析时没有缓冲记录、下一帧又阻止异步绘制；源码与 CommonJS／ESM 交付入口保持一致。普通输出仍由 RenderDebouncer 的动画帧及单批 100ms 期限驱动，视图与依赖原有关闭路径释放计时器，不增加 Vue 强制刷新或全局轮询。

## 7. 生命周期与失败

明确打开、取消、订阅、解除、关闭和卸载 owner。取消前端请求不证明后端副作用终止；晚返回的资源仍尝试归还给原 owner。错误映射稳定安全码，区分网络失败、协议失败、业务拒绝和未知写入结果；非 JSON、未知状态/错误码及错误 shape 不当作成功。不把失败刷新作为操作已恢复证明。

transport 产生具名失败与受约束 code，controller/view 只消费该契约；Auth 的共用失败从其公开入口消费，不比较普通 Error.message。服务端安全码引用 Shared，本地通信失败留本包；未知异常统一安全兜底，不能把技术正文用于翻译或决定认证/写入结果。

普通终端、Files、Agent 各有业务生命周期，共用技术原则而不混用权限与资源。PTY ACK/背压由对应 runtime 消费协议，view 不复制流状态机。资源关闭失败须有可追踪反馈，不能静默伪造关闭成功。

WorkspaceSocket的NXW1解码与协议版本已消费Shared remote/workspace，删除本地重复编解码文件。Socket持有请求等待及元数据/final交付条件，畸形消息和重复终态会断开并结束等待；旧socket的消费回调不能确认新附件。正式Session的connect/resume/close已消费Shared严格结果codec，经model/workspace-connection-mapper投影为独立应用对象，lastConnectedAt明确从Unix秒转应用毫秒。新建回执的replayedBytes与journal端点共同定位输出起点，响应前后输出不丢失游标；续接核对资源、原generation+1、换token及完整回放，独立workspace.resumeAck确认后才启用输入/resize/业务能力。connect/close各自共享Promise，关闭在原附件等待确认并清理晚到连接；创建/ACK结果未知阻止自动和手动重放，关闭返回closed/detached/unknown，不把断开当释放。终端结束使在途结果失效，未知所有权在正式终端显示三语恢复提示。终端输入/resize/flow、目录请求/事件和关闭/故障事件已消费Shared严格codec；独立应用TerminalViewport归features/terminal/model/terminal-types，终端适配归adapters/terminal-adapters，协议构造及队列投影归model/workspace-terminal-mapper。目录切换绑定原附件，核对requestId/排队路径，请求确认与完成事件均有效后才成功；本地关闭同样结清事件等待，断线/超时保留unknown。失败回执及protocol.error仅接受Shared有限码，具名WorkspaceRequestFailure保留operation/code；挂起独立ACK已接线；监控/Docker WS与概览HTTP已接Shared；采样配置已接Preferences核心owner；桌面子协议已按C2-C3接线，整体App资源撤销仍在C2-D，不声称整个运行链路完成。

核心配置transport归Preferences的api/configuration-api，model/configuration-mapper将Shared完整配置转换成本地CoreConfiguration；Security通过Preferences public消费，不深层引用私有实现。CAPTCHA/IP面板由use-security-configuration持有各自原快照和草稿，GET/settings读取已保存配置，公共GET/settings/captcha只代表运行时快照。网络写入保留原快照其他policy字段及secret keep；CAPTCHA使用专项PUT。冲突或unknown阻止下一次写入，必须先只读刷新并重新核对。黑名单独立transport/controller归Security，消费Shared Access分页/解除，时间在边界转毫秒，confirm等待也受generation保护。

核心Settings已使用Shared preferences/configuration完整配置和expectedVersion，CAPTCHA 使用 keep/clear/replace 且只读取 hasSecret；显示 version/effectiveVersion/requiresRestart。HTTP 失败/断流/unknown 后只读核对，不自动提交新版本；保存后当前认证与监控仍使用启动快照，重启才生效。布局等个人设置使用独立 preferences 契约，不能拼进核心 policy。

Files的应用对象唯一归features/filesystem/model/filesystem-types；DirectoryListing、RemoteFileEntry、FileSearchResult及嵌套metadata不再借用旧Protocol。runtime/model/workspace-files-mapper逐字段投影，Files metadata沿真实后端使用Unix毫秒，不二次换算。adapters/filesystem-adapters承载11条用例、Document与Preview，WorkspaceSocket只持原附件关联与NXW1交付；Files ready/error用Shared严格codec，失败不携技术正文。

Files首次读取等待当前附件的SFTP ready，尚未ACK、已断开/撤销或dispose时拒绝；有界等待持有timer/abort监听，断开/失败/取消全部结清，重连代次使旧等待失效。写入请求先核对完整1MiB入站控制预算；确定未派发与写后丢回执/畸形回执分别表达，unknown不自动重放。Preview取消同时覆盖stat等待和原binary请求；普通读取不隐式新建连接。上传下载已接Shared与正式能力，Workspace复制/移动/归档已消费Shared；五个跨服务器HTTP任务已独立接Shared，完整页面/三语实际交互仍C2-D。

## 8. 当前能力与验收

第九轮远程日志确认失败登出反馈生命周期缺口：`beginAuthentication` 会卸载 `AppHeader`，因而其局部 `logoutError` 无法在重新读取原身份后继续展示。失败消息改由独立于会话挂载的 `NotificationHost` 承载，并为错误通知设置 `role=alert`；不改变原有先撤销 Workspace/Agent 所有者、再经 `/auth/status` 核实同一身份的围栏。该变更待远程 E2E 复验。

F1-A/B源码已覆盖正式setup/password/status/logout、TOTP/Passkey登录、改密/因素设置、公共CAPTCHA与CAPTCHA/IP安全配置，以及DEV共用认证。Passkey的第三方对象只在Auth adapters/browser-passkey显式投影，Store按实例持有取消能力；session generation变化取消旧ceremony并阻止晚签发。Security的use-passkey-settings持有列表、名称草稿和刷新恢复。其余正式配置与业务源码已接Shared，完整前端行为仍待远程验收。新传输已接源码；真实密码/Cookie/登出与受控TOTP/竞态/失败场景的分项证据归testing。构建或受控响应不替代完整页面/真实因素验收。

第八轮失败登出链核对：AuthStore 发出 POST logout 前先撤销本地可用身份以释放所有已挂载 Workspace/Agent Owner；当 POST 报错而服务器状态未知时，不假定凭据还可用。只允许经独立只读 `/auth/status` 确认**原用户 ID 仍有效**后恢复 UI 身份供用户查看真实错误；如果 GET 同样失败、主体变化或服务器已撤销，则继续封锁原会话，保留失败因果。该局部候选不恢复任何旧兼容层，远程 `ssh/terminal-ui` 和身份安全断言待验。

既有产品事实由USAGE与对应源码核对。正式Agent管理与Host/运行已消费Shared，DEV仍是有限诊断消费者，不代替正式界面验收。SOURCE、静态和行为证据分别归testing；既有DEV和独立管理回归不代表当前完整Agent或远程Actions E2E通过。部署切换仍须明确执行授权。

源码已核对错误契约、类型归属、请求上下文校验及响应早退收尾，跨业务行为回归承接到 [前端延期事项](../后端重构下一阶段实施方案.md#延后的前端事项未验收不删除)。当前后端本机B10已收口，外部按D16延期，F1正式源码已接Shared；DEV消费者共用新认证owner。上述边界是开发约束，不能因端点接通和静态通过就声称已全部满足。

执行 Frontend 类型检查、build、ESLint/Prettier 和根检查；桌面/移动端操作、滚动、取消与资源清理通过真实浏览器行为验证，未执行项明确保留。每次发布/行为变更同步 USAGE，不凭静态通过改写真实行为证据。

## Dashboard 与认证资源生命周期

1. **职责与范围**：Dashboard持有本页读取和轮询；认证变化由App同步分发，Workspace注册表负责原会话资源收尾，不由App异步加载后清空届时的注册表。
2. **子功能与目录**：页面读取与相对时间留app/pages/dashboard；Workspace关闭、挂起恢复围栏和关闭等待留runtime/session；不为撤销建立另一份资源表。
3. **依赖方向**：App消费Auth和shared/session公开能力；已加载的Workspace注册表自行注册认证撤销，无资源时不为清理加载运行时。Header仅发起登出。
4. **类型与转换**：Connections与Audit均消费Shared毫秒时间，经各自mapper显式投影；Dashboard格式函数只消费应用毫秒，不猜单位。
5. **入口与安装**：正式Dashboard经Router/KeepAlive安装；认证watch同步处理中间失效状态，同用户重新登录也撤销原实例。注册表加载时安装其认证owner。
6. **数据、事务与并发**：页面每次刷新绑定原AbortController，停用或新刷新使旧结果和finally失效；注册表撤销同步移出原实例，再等待各自关闭，不让旧关闭修改新标签。
7. **生命周期与失败**：页面停用取消读取、计时器和监控配置；恢复显式读回。Workspace批量关闭覆盖暂被替换标签隐藏的原实例，以及已移出标签但仍在关闭的任务；独立失败不跳过其它实例，unknown不冒充已释放。Session.dispose共享完整收尾Promise；挂起恢复在异步交付点核对原注册代次和实例，关闭替换标签不恢复旧标签。
8. **当前能力与验收**：上述链路已实现；正式App/Router/Dashboard有限整页、同用户同tick认证替换、受控Workspace关闭/恢复竞态及真实SSH资源HTTP回退已有[当前证据](../testing/E2E.md#f1-c2-d-整页与认证生命周期首批)。完整Workspace整页、跨业务撤销及桌面扩大交互仍待C2-D，不由本子集宣称阶段完成。

## Preferences 后续对接边界

commands/history/favorites 已接正式 API、Store 和 Workspace 实际消费者，边界及恢复见下方“Workspace 个人目录契约”。命令和路径仍由前端通过 HTTP 记录，不新增后端 Workspace 自动记录。presentation现已将旧混合 settings 写入拆成核心 policy 与个人完整 preferences，布局/焦点/侧栏共享用户版本，写入带 CAS，未保存 version=0；transport 从 unknown 解码，controller 逐字段转 UI 状态，核对真实显示生效。个人目录、核心配置和presentation分别持有自己的版本及转换，行为证据也分别记录。

## B8 后续消费范围（后端部分源码接线，前端未施工）

正式备份与宿主诊断已消费Shared和新Access，会话、全局恢复围栏及当前验收见下方“System 备份、恢复与宿主诊断”。生产切换单独授权。

外观、终端主题、背景及HTML库已破坏性迁到Shared，正式App/Workspace/设置面板消费唯一Appearance Store；原版本、预览及当前验收见下方“外观、终端主题与HTML库迁移设计”。库改名作为另存副本，原条目独立删除。

Agent 后续须分别消费 integrations 的 MCP/ACP 管理、Browser target 设置与任务状态，以及 plugins 的安装/可信发布者/catalog、SDK/RPC、跨 App intents 和有限 Artifact 读取。静态可读不等于 App/RPC 获授权，发现工具不等于可执行。SDK 的版本/操作身份、iframe 及订阅归属也属于迁移范围，不能只替换 plugin-api 的 DTO import。

Backup API已消费system/backups完整输入/回执/错误，二进制和multipart独立预算；全局恢复结果与明确重载归Backup Store和App装配，见下方当前设计。

### B8 集成与插件消费者

正式Frontend源码已接入Shared集成、插件、运行态、descriptor与Host工作区；安装/升级/卸载/取消退役、CAS、短期grant及原意图恢复由各实际owner实现，不复建旧DTO。当前源码不自动改变部署：正式启动切换与远程Actions E2E另按授权执行。

F1插件仓库设置改消费Shared repository-*的独立CAS入口：最多16个URL、版本0首次保存、公开目录8MiB、规范URL4096bytes；目录兼容性由服务器计算，不从本地版本猜测。保留官方/远端catalog/stage与推荐路径，stage要求真实App/version/publisher匹配，最新sdkVersion为1。推荐返回entry/installation，已安装时entry可以为null；安装仍禁用/空grant，明确展示后续授权/启用步骤，不自动恢复旧全能力grant行为。后端SDK进程契约已是Shared backend-sdk；正式iframe只能消费前端SDK，不能取得进程句柄、宿主环境或数据目录。当前源码状态不代表网络/插件实机验收。

B8跨App的plugin-api/agent-dispatcher/SDK父页已改用Shared plugins/intent-*与九方法RPC；创建用稳定UUID operationId、inputJson、artifactIds及confirmed:true，不补旧input/artifactRefs字段；列表显式limit。冻结双方版本/修订，过期/撤销后不能换键自动重发；消息不会启动模型。Artifact metadata/单段Range仍须原接收会话与有效receipt，断流不算完整下载；RPC编码超限由用户减小limit；SDK分段读取传明确start/endInclusive，单次128 KiB，严格解码身份/范围/规范base64及实际长度后再转UI字节，不保留旧无身份裸字节桥。正式前端已消费当前契约，远程回归另行记录。

### 后台服务器任务消费者

正式SendFiles/Progress、WorkspaceSessionSurface经transfers public消费独立本地任务；Shared基础值可直接引用。API核对完整请求/受理、任务ID、分页及有限安全失败，写入不自动重试；通用JSON client允许无body的204。Store持会话epoch、读取generation、单飞刷新及任务级写入；旧poll/send和旧finally不能覆盖新会话。取消只展示受理后的真实状态。创建回执未知后保留sendBlocked，另一意图拒绝或只读刷新不解除；重新建立页面/会话前必须人工核对源目标。Modal隐藏、停用、卸载和源变化撤销原确认与等待，已有任务仍可在读取失败时查看。正式页面/三语挂载与App跨业务撤销留C2-D；浏览器store专项不替代这些验收。

### 挂起目录与恢复边界

1. **职责与范围**：ssh-suspend持管理目录、命名/终止/移除与日志操作；Workspace runtime持原终端、挂起移交与独立恢复ACK，不在View判断所有权。
2. **子功能与目录**：features/ssh-suspend的api负责HTTP、model持本地类型/mapper与具名失败，composables持共享目录和轮询；runtime的suspend适配器与Model转换挂起协议，Session持实际附件/租约。
3. **依赖方向**：View→应用controller→HTTP transport→Shared；runtime跨功能只经ssh-suspend public。同一会话/附件的多步流程绑定原socket，不隐式重连另取权限。
4. **类型与转换**：Shared remote/suspend持完整HTTP/WS成功/安全失败/有限值/容量和codec，协议对象显式转换本地应用对象；目录ISO时间与租约毫秒分别校验，不猜单位。管理HTTP和挂起WS的旧DTO及转导出已删除；Shared完整契约经严格codec进入独立本地对象。普通连接保留replayedBytes，挂起回执只核对真实baseline，不补造该字段。
5. **入口与安装**：正式挂起面板消费五管理HTTP；mark/prepare/commit/resume/resumeAck/renew/history与事件经原WorkspaceSocket；HTTP与WS由Backend同一WorkspaceService持权威。
6. **数据、事务与并发**：不新增存储；目录只读刷新与写入结果分开，旧读取不能覆盖确认的命名/移除。未知写入保留保护，不自动重发；单条未知不由无关记录成功解除。
7. **生命周期与失败**：面板卸载/停用/会话替换撤销原确认和交付；已派发结果保留未知。恢复先消费历史并校验原资源/租约，再独立ACK，成功后开放输入；ACK未知阻止重放。取消不跳过原资源清理，失败使用有限三语提示。
8. **当前能力与验收**：管理五HTTP、独立应用mapper、会话epoch/读取generation/单记录写入保护已实现；poll不解除unknown，用户显式读回只清除该次读取之前的保护。Panel的KeepAlive停用/卸载/注销撤销原确认、请求及晚交付；store另持下载取消。正式Panel有限受控挂载与真实后端HTTP/OpenSSH专项归testing。mark/prepare/commit与独立恢复ACK/续租/历史、有限WS事件已接Shared。Session先核对baseline字节与原资源，再独立ACK；ACK释放的live字节保留累计offset。续租绑定原socket并串行，代次失效阻断晚结果。历史读取绑定原附件并有界解码，失败不推进本地成功状态；显式reset不吞在途读取失败。已标记标签关闭只detach，不发终止Workspace；在途写入关闭保留未知并追踪原任务。源码与专项证据归testing，完整App/页面与扩大故障组合仍C2-D。

### Workspace 监控与 Docker

1. **职责与范围**：status-monitor拥有指标、历史与显示；docker拥有容器视图、命令及本地恢复保护。Workspace runtime只负责原附件通信，Remote/Agent后端仍分别授权和管理任务。
2. **子功能与目录**：各feature的model/_-types持独立应用对象、controller契约和具名失败，_-mapper持嵌套白名单；composables持订阅/轮询和操作协调。runtimes/workspace/adapters/observation-adapters持原socket绑定与协议失败转换，capabilityAdapters只装配与撤销。
3. **依赖方向**：View→应用controller→所属channel；runtime通过feature public取得窄能力/mapper/types，并消费Shared严格codec。WorkspaceSocket的各子协议maps均来自Shared，删除旧Protocol的Omit混合层，不新增兼容出口。
4. **类型与转换**：Shared monitoring拥有status请求、null回执、sample/error及预算；docker拥有完整status/stats/command。loadAvg、ports、labels和stats逐字段复制，Docker ID采用安全identifier；完整ID与CLI短ID的关联保留真实生产者语义。指标单位不重解释；缺测不入历史，不显示为零。服务端有限码来自Shared，协议失败及派发状态归前端。
5. **入口与安装**：正式Session持statusController/dockerController；StatusMonitor/DockerManager通过既有视图入口消费；ACK确认前不派发观测能力。status.start/stop与docker.status/stats/command不隐式创建新socket。
6. **数据、事务与并发**：不新增存储。监控start/stop串行并绑定原附件；Docker读取单飞，generation隔离停用/断线，命令修订拒绝发布命令前的旧读取。命令pending阻止并发；unknown保留保护，不被poll、无关拒绝或KeepAlive清除。显式读取成功仅清除浏览器本地保护，不解除后端持久突变围栏，也不证明先前命令停止。
7. **生命周期与失败**：视图停用/卸载/连接状态变化撤销原删除确认；晚确认不派发。命令已确认与随后刷新失败分别表达；断流、畸形回执保留unknown，不自动重放。取消/断线不证明远端已停止；旧附件退订不能发送到新socket。安全错误经三语有限映射显示，未取到Docker状态不能冒充未安装。
8. **当前能力与验收**：WS源码已接入，专项结果归testing。system-overview本机/SSH资源HTTP已独立接入，实际采样设置已接Preferences核心配置及生效投影，专项范围归testing；图表按真实样本时间/点数降采样，不改变服务器实际采样周期。整体App/页面/三语挂载及扩大故障仍C2-D。

## System Overview HTTP

1. **职责与范围**：system-overview 负责 Dashboard 本机和 SSH 主机资源摘要；配置保存归 Preferences，不将摘要轮询当远端采样控制。
2. **子功能与目录**：api/system-overview-api 持 HTTP；model/system-overview-types 与 system-overview-mapper 持独立应用对象；composables/useSystemOverview 协调读取，Dashboard 装配页面生命周期。
3. **依赖方向**：Dashboard → system-overview public → controller/API → 同源 JSON client 与 Shared；不借旧 Protocol 或存储对象。
4. **类型与转换**：Shared 严格解码完整成功/安全失败，API 校验 HTTP 状态和原主机关联；mapper 白名单投影本机摘要及嵌套 SSH 样本。内存 MiB、磁盘 KiB，checkedAt/timestamp 毫秒。等待状态独立于协议，不伪造服务端时间。
5. **入口与安装**：Dashboard 消费本机 GET /api/v1/system/status 与 SSH 单项 GET /api/v1/system/ssh-resources/:connectionId；后端集合入口仍存在，当前无前端消费者，不预留裸 API。
6. **数据、事务与并发**：页面按规范 host/port 分组，最多四个独立请求，每个 worker 两次请求间等待 200ms；后端可回退同主机其他连接，返回 ID 不必等于查询 ID，但 key、host、port 必须对应原主机。无浏览器持久缓存，不修改后端共享采样 TTL。
7. **生命周期与失败**：本机/远端各自 AbortController 和请求实例；停用/隐藏/卸载/会话重置使旧结果与 finally 失效。失败不显示原始异常，失败后的旧样本不标作实时；取消请求不证明共享远端采样停止。
8. **当前能力与验收**：本批实施与检查状态见当前方案及 testing；整体页面与桌面按各阶段验收，监控配置有独立验收，不由HTTP子项替代。

## 监控核心配置

1. **职责与范围**：Preferences负责已保存监控周期和启动生效事实；个人显示开关与Docker UI轮询仍属presentation迁移范围，不能写入核心policy。
2. **子功能与目录**：复用configuration-api、configuration-types/mapper；composables/use-monitoring-configuration持页面编辑/读取，components/MonitoringConfigurationPanel供两个设置面板共用，不另建配置Store。
3. **依赖方向**：设置面板内部引用组件，Dashboard从Preferences public消费配置controller；均复用同源JSON及Shared，Workspace图表不依赖配置客户端。
4. **类型与转换**：Shared SettingsView有效监控字段由mapper投影独立MonitoringIntervals；写入Draft单独定义，完整PUT用原CoreConfiguration快照保留其它policy/passkeys/CAPTCHA keep。只读有效值不进入写命令。
5. **入口与安装**：沿用GET/PUT /api/v1/settings，不增加同义API；组件独立于旧个人偏好加载分支，两个入口均明确管理员、保存/生效版本和重启要求。
6. **数据、事务与并发**：controller独立持有编辑快照；保存核对version+1，期间禁止重复操作，冲突或unknown必须先只读刷新；不自动重试写入。Dashboard只用后端给出的有效值安排轮询，未知时暂停，不用已保存值或前端默认猜测。
7. **生命周期与失败**：读取、保存、首次登录/注销、KeepAlive停用和卸载绑定原请求代次与AbortController；旧结果及finally不能发布。取消后实际保存仍可能完成，恢复只读核对。图表按实际timestamp与有限点数降采样，移除多层周期props，不声称图表调整控制远端采样。
8. **当前能力与验收**：当前施工与结果归实施方案/testing；完整Preferences其它能力、Dashboard整页及扩大故障仍按F1-D/C2-D分别验收。

### 桌面前端（RDP/VNC）

1. **职责与范围**：features/remote-desktop 持有桌面意图、有限应用状态和窗口；Backend 保有票据授权、目标凭据与真实资源配额，浏览器不重建其权威。
2. **子功能与目录**：model/remote-desktop-types 唯一持有应用连接、显示、会话、失败与窄 peer 契约；remote-desktop-controller 协调签发/代次/原 peer，mapper 持有协议转换。api/remote-desktop-api 仅签发；adapters 持有 Guacamole、输入、剪贴板和原生监听。Modal 持窗口、全屏、软键盘 UI；launcher 白名单保存打开意图。
3. **依赖方向**：App/Connections 经 public 打开 launcher/Modal；Modal 装配 controller、API 和 adapter，controller 不引入 Vue、Guacamole 或 HTTP。技术实现不借用 View 或其他业务私有状态；public 不导出裸 transport。
4. **类型与转换**：Shared remote/desktop 完整成功/安全失败和 1 KiB 响应预算由 API 严格解码并核对 HTTP 状态；mapper 显式投影独立应用会话，Unix 秒转毫秒。App attempted 消费毫秒，不重复换算。query 逐字段构造并按 Shared 范围校验；第三方错误正文只留内部 cause，不进入 UI/日志。
5. **入口与安装**：沿正式 Modal 和 App 入口替换旧 DTO，不新增 DEV 替代页。controller 只将票据交原 peer，经同源 /ws/remote-desktop 发送；认证变化由公开会话生命周期撤销，KeepAlive 停用关闭且激活不自动重放旧意图。
6. **数据、事务与并发**：本功能无本地 SQL；请求 AbortController 与 generation 限定原意图，晚票据不发布最近尝试、不打开 WS，旧 callback/finally 不覆盖新实例。窗口尺寸持久化由个人 Preferences 消费，源码已迁移，完整交互仍待验。
7. **生命周期与失败**：显式重连取得新票据，取消/断流/未知不自动重试。close 逐项清理并保留失败，清理未确认阻止原 controller 再开；关闭 GUI 不证明远端程序停止。Guacamole 精确版本补丁与监听局部代理见专题架构；剪贴板私有 1 MiB、最多四条并发接收流、VNC 文本单次 64 KiB，超限拒绝而非截断。
8. **当前能力与验收**：原画面、键鼠、软键盘、触控模式、剪贴板、尺寸、最小化和全屏入口保留。源码/静态、本机真实桌面与受控时序证据分别归 testing；完整页面及扩大故障组合仍 C2-D，RemoteApp/Windows 的本轮外部操作不借历史验收。

### 文件编辑资源撤销

1. **职责与范围**：file-editor拥有浏览器文档与草稿；普通断连保留可复制草稿，认证撤销不得向后来会话保留内容。
2. **子功能与目录**：既有composables/useFileEditorSession持状态和读取围栏，不新增共享缓存。
3. **依赖方向**：Workspace注册表和Session经file-editor/file-preview public调用资源释放，不反向依赖Auth。
4. **类型与转换**：沿用独立EditorDocument和FileDocumentPort；reset是本地资源操作，无双端协议变更。
5. **入口与安装**：注册表批量撤销同步reset共享编辑器，Session.dispose清空私有编辑器与预览。页面标签关闭先对当前集合执行，再等待外观设置保存，不在等待后重新选择标签。
6. **数据、事务与并发**：每次读取绑定原文档、有效性、内容修订及读取序号；后来的读取或编辑使旧结果失效。保存仍按实际提交内容确认，不因用户继续输入丢弃有效保存结果。
7. **生命周期与失败**：reset无确认清除全部文档并推进代次；旧读取/保存不能回填，旧finally不能改变新会话loading。普通scope关闭保留草稿但撤销保存能力，不将本地撤销当作远端写入回滚。
8. **当前能力与验收**：编辑/预览受控晚结果及认证撤销专项、既有真实SSH/SFTP和App有限回归已通过，精确证据归testing；页面批量关闭先于外观等待已源码收口，完整Workspace整页交互仍待验。

### Workspace 页面异步动作

1. **职责与范围**：WorkspacePage拥有查询打开、批量打开、挂起确认/提示和前台恢复的页面意图；已派发连接仍归WorkspaceRuntimeSession，不因页面停用被误报取消或关闭。
2. **子功能与目录**：复用app/pages/workspace/WorkspacePage.vue的装配与页面生命周期；WorkspaceLayoutRenderer为每个叶面板安装既有RuntimeErrorBoundary，不新建全局协调器或重复资源目录。
3. **依赖方向**：页面经Connections/Suspend/Workspace/Feedback公开能力工作；认证仅通过共享session生命周期撤销页面操作。
4. **类型与转换**：复用ConnectionSummary、SuspendedSession和WorkspaceRuntimeSession应用契约；页面不解码wire，不改变Shared/Backend。
5. **入口与安装**：挂载/激活启用当前页面代次，停用/卸载/认证撤销使原signal失效；确认消费原signal，等待后的派发必须再次核对。
6. **数据、事务与并发**：批量打开与查询打开绑定原页面，恢复候选绑定原Session实例；在每个await后核对。命令发送后的历史追加也绑定原页面与Session，晚返回不能在新页面追加；进入Store队列后仍在派发前复查原页面signal。旧任务finally仅能清理自己的占位，不能清除新页面恢复任务。
7. **生命周期与失败**：旧确认、延迟查询和轮询等待不能在新页面派发副作用或提示；重试计时器随原代次撤销。已派发SSH仍追踪真实结果，页面撤销不冒充远端停止。面板渲染失败仅卸载该面板视图，不撤销Session；健康面板不会因激活或路由变化重挂载。快捷命令/历史/收藏协议由本批直接替换，隔离失败不代表契约对接完成。
8. **当前能力与验收**：正式App/Router/Workspace有限整页、真实SSH与受控延迟查询/命令返回/确认、排队撤销已有[当前证据](../testing/E2E.md#f1-c2-d-workspace页面与个人目录契约)；不替代完整Files/传输/挂起整页、桌面及跨业务验收。

### Workspace 个人目录契约

1. **职责与范围**：快捷命令、命令历史及Files的路径历史/收藏分别由所属feature拥有；本次直接消费Shared，不保留旧Protocol兼容。
2. **子功能与目录**：client/preferences复用安全HTTP和有界分页；feature api负责端点/上下文与codec，model拥有本地类型及mapper，Store负责缓存和写入协调。共享useAuthenticatedViewScope只持UI意图代次与确认撤销，已接纳任务由原Store追踪；UI signal仅约束排队任务的实际派发，不中断对已派发副作用的原owner追踪。
3. **依赖方向**：组件→所属Store→api→同源JSON与Shared；跨功能使用public，client不引用feature状态。
4. **类型与转换**：Shared wire逐字段转换独立应用对象；集合、变量字典和标签ID明确复制，时间均为毫秒。写入仅包含操作字段及原expectedVersion。
5. **入口与安装**：替换原实际HTTP消费者与Workspace组件，不新增假页面或旧响应分支。
6. **数据、事务与并发**：读取完整分页后发布，拒绝跨页重复ID与游标异常；写入串行、推进读取修订，CAS绑定原编辑/确认快照，标签级联后重读权威版本。 快捷命令与标签目录独立读取；标签失败可发布已严格解码的完整命令集合并清空标签投影，命令执行独立于计数保存。任一目录失败阻止管理写入，显式重读两份目录成功后解除，不发布不完整分页或沿用失效标签。
7. **生命周期与失败**：会话撤销取消原读取/等待并清空缓存；晚结果/finally不修改新状态。未知写入不自动重放，先显式只读核对；已提交与后续读取失败分别表达。
8. **当前能力与验收**：真实Access/个人数据HTTP的CRUD、分页、CAS、级联版本及提交后丢响应，以及正式Workspace挂载未触发错误边界、认证撤销已有[有限证据](../testing/E2E.md#f1-c2-d-workspace页面与个人目录契约)。旧裸数组明确拒绝，不以面板隔离替代迁移。各项完整UI交互仍随C2-D扩大验收；presentation及其余Preferences/Agent源码已接线，行为单独验收。

### Presentation统一个人状态

1. **职责与范围**：Preferences拥有个人偏好、持久布局/侧栏/焦点的统一版本事实；Workspace拥有编辑和交互，不重建存储权威。后端日志级别归Operations独立版本。
2. **子功能与目录**：Preferences的model/preferences-types、presentation-mapper、api/presentation-api和store/presentation.store分别持应用类型、转换、协议与状态；旧preferences API和Workspace HTTP实现删除。
3. **依赖方向**：Workspace→Preferences public→唯一Store→API/Shared；功能内部直接消费唯一owner，不从runtime反向借用Preferences类型。
4. **类型与转换**：所有HTTP严格解码，逐字段转独立应用快照；布局递归投影，焦点shortcuts为字符串。Workspace编辑状态与持久命令显式转换，移除旧Protocol导入及旧路径转导出。
5. **入口与安装**：沿既有四读取与五写入真实入口，写入消费完整PresentationView；首次未保存version=0，不虚构已保存状态。
6. **数据、事务与并发**：读取四域须同一version后发布，变更与读取统一排队；旧编辑携原版本，冲突不自动升级，成功整体发布服务端快照。UI变更不先冒充持久成功。
7. **生命周期与失败**：Store持原认证scope，撤销使原队列与回填失效；未知写入阻止后续提交，只能显式只读恢复，不自动重放。Workspace停用撤销未派发保存，已派发结果归原Store追踪。
8. **当前能力与验收**：源码已替换正式Preferences表单和Workspace布局/焦点/偏好保存，旧HTTP及本地兼容删除；当前版本验证逐项归testing，不沿用前批PASS。外观与Agent/Operations/System源码已接Shared，本轮完整行为留远程回归。

### 后端日志界面

1. **职责与范围**：features/logging提供管理员独立后端日志设置，个人偏好只处理前端日志。
2. **子功能与目录**：model/logging-types定义独立快照；api/logging-api解码/投影；composables/use-backend-logging持编辑版本和生命周期；components只展示与派发用户动作。
3. **依赖方向**：Settings通过logging public安装组件；api消费client/operations与Shared，通用client不引用feature。
4. **类型与转换**：BackendLoggingView在API逐字段转BackendLogging；更新独立expectedVersion/level，核对返回版本和原级别。
5. **入口与安装**：正式系统设置使用GET/PUT /settings/logging，不将backendLogLevel混入presentation。
6. **数据、事务与并发**：每个面板持原快照，拒绝重复保存；冲突/unknown只读刷新，不自动提交新版本。
7. **生命周期与失败**：原视图scope限定请求及晚回填，停用/认证撤销清空快照；错误按Operations具名码安全展示。
8. **当前能力与验收**：正式组件与真实HTTP消费者已实现，实际验证见testing；其余Operations不由本组件代替。

### 审计安全摘要

1. **职责与范围**：Audit展示后端安全审计字段，Dashboard复用最近活动读取；不再消费任意details、用户名或秘密正文。
2. **子功能与目录**：model/audit-types与audit-mapper持独立应用对象/投影；api/audit-api消费Shared operations；Store拥有分页，views持筛选与展示。
3. **依赖方向**：Dashboard通过Audit public使用应用读取能力；Audit→client/operations→Shared，不反向依赖Dashboard。
4. **类型与转换**：event取Shared有限基础值，createdAt为Unix毫秒，id/来源/主体/路由/状态逐字段转换；旧秒时间和details类型删除。
5. **入口与安装**：真实GET /settings/audit-logs，query由Shared严格验证；完整列表与Dashboard同步切换，无旧路径桥。
6. **数据、事务与并发**：服务端nextOffset唯一权威，无total时只显示已加载数；核对每页请求范围、ID顺序/唯一性及跨页重复，筛选变更撤销原读取。
7. **生命周期与失败**：Store与列表分别持原认证和视图scope，失活/身份替换使晚结果失效，安全错误不输出技术正文。
8. **当前能力与验收**：本批实施，实际完成与验证见方案/testing，既有旧审计受控证据不代表当前契约通过。

## Operations 通知管理

### 1. 职责与范围

Notifications 拥有正式渠道管理、已保存/未保存测试及投递记录展示。测试返回受理记录，只有 sent 表示已发送；queued/dispatched/unknown 不报发送成功。管理配置留页面，不以环境变量替代产品设置。

### 2. 子功能与目录

features/notifications 的 model/notification-types 持应用对象，notification-mapper 持白名单转换；api/notifications-api 持 Shared 编解码和请求关联；store 持快照、串行任务、会话与失败围栏。表单持秘密草稿和编辑原版本；列表持确认和视图生命周期。

### 3. 依赖方向

UI → Store/API → Shared operations/notifications 与通用 JSON transport；跨功能只消费 public。删除旧 Protocol、旧 /notifications 入口及其 DTO，不保留兼容。

### 4. 类型与转换

Shared 唯一定义 channel/event/status、完整 wire 请求/响应和容量。应用 Setting/Config/Delivery/Change 独立归 model，API mapper 逐字段转换含 headers 和 secret 意图；不直接把 Shared View 用作 UI 状态。秘密只有 keep/clear/replace，安全读取仅存在标志。

### 5. 入口与安装

正式 NotificationsView 继续由既有路由和 Settings 装配；API 接 /api/v1/settings/notifications、/:id、/:id/test、/test-unsaved 及 /settings/notification-deliveries。UUID 在请求前严格校验；DELETE 携原 expectedVersion。渠道管理卡片在窄屏以本视图作用域允许底部动作文字折行并限制最小宽度，不修改共享按钮桌面尺寸或请求语义；此 UI 调整待远程窄屏验收。

事件表单由 `NotificationSettingForm` 自身限定选项行宽：事件网格与 label `min-w-0`，UiCheckbox 不压缩，事件文本独立 `overflow-wrap:anywhere`。这修复匿名 flex 文本在 320px 撑宽的问题；不通过删事件、截断翻译或改变通用 UiCheckbox/Shared 合同取绿。

### 6. 数据、事务与并发

后端持久配置与投递为权威。Store 串行化读取和变更，表单与删除均捕获原版本，不能借刷新后的版本覆盖旧草稿；成功响应验证 ID、版本、配置类型和公开字段。版本冲突与未知结果禁止后续写入，仅显式只读核对可解除围栏，较早请求的恢复不能解除较晚失败。投递按服务端 nextOffset 续页，不虚构总量。

### 7. 生命周期与失败

原会话和原视图信号贯穿确认、排队、请求及发布，停用/卸载丢弃秘密和旧回调；取消不代表回滚。未知测试不自动重发，先查投递。全部错误只显示有限安全翻译，禁止原始异常正文。

### 8. 当前能力与验收

正式消费者已接通，三通道安全配置、秘密意图、CAS、投递分页、断流未知、排队撤销及正式表单已有本机专项；审计43项App回归和通知12项专项及22项后端受影响回归见testing。公网供应商仍D16，不借本地受理宣称外部发送成功。

## System 备份、恢复与宿主诊断

正式 `BackupSettingsPanel` 的原生导入 file input 自己承担可见的主题边框、圆角、裁剪和键盘焦点，不能只依赖不可见的外层控件。测试直接验证 native input 的 computed styles；不改变导入协议、认证与 global restore fence。

### 1. 职责与范围

Backup 拥有完整管理员的加密导出和显式恢复，System Overview 拥有宿主诊断读取。正式设置消费新后端；恢复替换全局业务状态，不能当作普通表单保存后继续使用旧缓存。

### 2. 子功能与目录

features/backup 的 model 持独立导出文件/恢复回执/失败及导入状态，api 持 Shared JSON/multipart/二进制边界，store 持跨视图导入任务与未知围栏；components 持密码/File草稿与全局恢复提示。System Overview 的 diagnostics API/model/component独立于原远端采样。client/http 的有限字节读取和传输提供通用能力，不定义业务对象。

### 3. 依赖方向

Settings/App 经功能 public 装配；Backup和System Overview只依赖Shared system、同源HTTP和身份生命周期。API不操作UI、刷新浏览器或直接修改其它feature私有Store。

### 4. 类型与转换

Shared system/backups定义完整请求/回执/错误和容量，应用Export/RestoreReceipt独立投影；不把Uint8Array、Blob或Headers泄露为恢复业务事实。Shared diagnostics逐字段转本地Diagnostics，事件/时间不做旧表示fallback。技术二进制响应由API验证媒体类型、长度、完整读取和预算。

### 5. 入口与安装

备份接POST /api/v1/settings/backup/export与/import；宿主诊断接GET /api/v1/system/diagnostics。正式Settings数据页装配备份/诊断，App装配全局恢复状态，隐藏的设置页撤销临时密码与读取意图。导出文件交付和ObjectURL由浏览器适配持有。

### 6. 数据、事务与并发

导出输入验证当前密码，导入密码仅解封来源备份。同实例可省略，跨实例需导出时密码。后端持久事务/维护与恢复日志为权威；浏览器一次只接纳一个备份操作。导入确认后阻止旧业务页面继续操作并要求重载；结果未知不重试导入、不推测回滚，保留全局提示供人工核对/重启对账。

### 7. 生命周期与失败

导入的受理与最终回执由应用Store持有，视图关闭仅丢弃秘密及旧回调；已派发取消/断流不证明恢复停止。开始前捕获原身份/视图并严格检查File容量，异步读取后再次准入。全局结果禁止被旧finally覆盖。Blob URL在明确owner清理；不保留无owner重载timer，导出完整字节不代表用户已落盘。

### 8. 当前能力与验收

两轮源码复审与前端构建已完成，真实隔离Backend-next/Vite/Chromium的11项专项通过，包括导出→修改→恢复、坏密码、完整下载、响应丢失未知围栏、隐藏清草稿和诊断正常/坏协议；公共HTTP受影响专项已重跑，精确冻结/结果归testing。未测旧备份文件前端拒绝及全部恢复故障组合，真实介质/公网仍D16。

## 外观、终端主题与HTML库迁移设计

1. **职责与范围**：Appearance拥有已保存外观、主题目录、HTML库及本地预览；预览不修改服务端快照或版本。图片与HTML活动副本分别表达，不把库编辑当作活动内容变更。
2. **子功能与目录**：model/appearance-types与appearance-mapper持独立应用对象和边界；api按外观、终端主题及HTML职责拆分，store拥有唯一快照、写入互斥与故障围栏。既有正式面板继续承载全部入口。
3. **依赖方向**：App/Workspace经public消费controller；功能内部直接引用Store/API。仅底层HTTP处理字节、媒体类型和取消，不持有外观业务对象；删除旧Protocol和旧路径兼容出口。
4. **类型与转换**：Shared为完整协议与容量唯一来源；应用Settings/Change/Theme/HTML summary独立定义。边界逐字段投影，字体/活动主题/背景路径/颜色不通过大字典透传。未知输入及文本/图片媒体类型严格校验。
5. **入口与安装**：沿现有appearance、terminal-themes、background与html-presets路由；终端主题导入实际是multipart themeFile/name，不能误按JSON请求发送。远端HTML只消费受约束来源，不自动改写URL。
6. **数据、事务与并发**：编辑草稿捕获原version；背景和仓库与外观共用版本。Store串行准入，已知冲突或unknown阻止下一写入；显式恢复完整读取目录/外观后才能解除。HTML改名作为另存副本，不在create后自动delete原条目。
7. **生命周期与失败**：视图停用/隐藏/身份变化撤销原读取和未派发意图；已派发结果仍由原Store追踪。确认绑定原对象/版本，异步后检查原视图。unknown不自动上传、删除或重试。导入文件读取先预算，ObjectURL由明确owner释放，安全错误不显示原异常。
8. **当前能力与验收**：两轮源码复审、双端静态与构建完成；14项隔离浏览器专项覆盖真实CRUD/CAS、两种背景图片、HTML空内容及另存副本、正式面板原版本冲突、主题导入导出、响应丢失后只读恢复与身份撤销。Backend外观20项及App43项回归通过；本轮设置页变更后外观14项再次通过。远端目录/正文受控，公网仓库仍D16；精确冻结及日志归testing，不扩展为完整前端验收。

## 机器突变恢复管理

1. **职责与范围**：mutation-recovery提供管理员只读目录/详情、人工事实证据和独立解除围栏，不执行原Files/Docker/Agent任务；released不是原操作成功。
2. **子功能与目录**：新增feature的model持独立Claim/Evidence/Input和mapper；api消费Shared remote/mutations；Store持分页/详情/原版本及未知围栏，Panel安装在设置数据页。
3. **依赖方向**：Settings经public装配；feature只依赖Shared、HTTP和会话/反馈公开能力，不导入Workspace或Agent私有状态。
4. **类型与转换**：unknown严格codec后白名单转应用对象；Shared有限state/origin/outcome和容量唯一。证据时间使用毫秒，用户明确填写观察时间，不以提交时间猜测已停止事实。
5. **入口与安装**：GET remote/mutations及/:id；POST /:id/evidence与/release分别携原expectedRevision。resourcesStopped/producerStopped逐项人工勾选，release独立确认，不自动选证据。
6. **数据、事务与并发**：后端为权威，分页使用服务端cursor、跨页去重；编辑固定原Claim版本。写入unknown/冲突只读恢复，不自动换版本或重传；保存证据后先展示新事实，再由人工另行选择解除。
7. **生命周期与失败**：数据页隐藏/卸载/身份替换撤销原读取、确认及未派发意图；在途写入仍结清确定/未知结果。旧finally和晚详情不得覆盖新选择；失败不显示原异常正文。
8. **当前能力与验收**：两轮源码审核、Frontend build和根check完成；12项隔离HTTP/真实持久化与浏览器专项通过，覆盖管理员分页、证据/CAS解除、正式三语页面、未知不重放、故障修订恢复及会话撤销。受影响外观14项、System11项与App43项通过；证据归testing。夹具占用经生产Adapter建立，不冒充真实远端操作或停止事实，外部效果仍由人工独立核对。

## 原生 Agent Host 与工作区

第九轮远程复核修复 Plugin Surface 授权来源：`GET /app-definitions` 仅提供内置可信定义；签名安装的 App 应由精确匹配 `installed` 安装、definition/version、packageHash、publisherKeyId 与已验证 Manifest 的版本记录决定 `agent` 或 `custom` Surface，不可再要求同时存在内置定义。缺失或失配时仍 `unavailable`，不退化为任意 iframe。该修复的真实插件帧/原生线程 E2E 仍待下轮远程验收。

1. **职责与范围**：正式悬浮Host拥有实际App选择、原生线程／Run交互和插件窗口，窗口布局与业务状态分开；不再依赖旧summary、host流或单例Run Store。
2. **子功能与目录**：host组件保留窗口／焦点／键盘／拖动生命周期；host-mapper/type持目录投影。native-thread-api与native-run-api复用唯一native-workspace-request；native-audit-api持步骤／工具只读HTTP。model/native-*-types、mapper/rules持独立应用对象、白名单和纯判断；use-native-threads/runs持本实例用例及原意图。NativeRunDetails/NativeAuditPanel只展示和发出用户操作，NativeInputArtifacts拥有引用准备，不让模板承担传输或版本策略。
3. **依赖方向**：组件→composable→API／mapper→Shared与通用同源传输；Connections仅通过capabilities public提供安全目录。正式Host与DEV共用原生线程契约但各持实际入口；插件继续真实descriptor/grant/iframe桥，不借插件凭据调用原生能力。前端包不再依赖Protocol。
4. **类型与转换**：Shared唯一持工作区17方法及App、Provider、Run、正文、审批、Child、Step、Tool的完整协议／基础值／容量；前端分别转HostApp/NativeThread/NativeRun/Entry/Approval等本地对象，数组与嵌套字段显式投影。App数字CAS、definitionVersion、安装revision分开；请求先规范化解码，再使用同一解码结果验证响应关联。正文offset是Unicode码点，审计textBytes是字节，本地显示窗口以UTF-16长度估算内存，不相互冒充。
5. **入口与安装**：正式Host读取实际App、定义、安装、版本与执行设置，按受信声明及真实manifest选择通用原生界面／自定义iframe；没有前端资源的合法插件也可使用原生会话。只给管理员安装。执行关闭时仍提供历史读取与取消。原生使用POST /api/v1/agent/apps/:appId/workspace，审计使用实际steps/tools及events；DEV仍走/__next。
6. **数据、事务与并发**：后端是权威；先读实际App版本，写入冻结原线程／Run／审批版本、输入、operationHash与operationId；原意图不跟随刷新变更。follow-up只基于已收敛Run创建新Root，unknown仍活跃且可取消。事件、正文、Run和消息各持服务端游标；事件显示最近200条、正文显示窗口最多128片／约256 Ki UTF-16单元，省略有明确提示，不删除服务器数据。Step/Tool/消息按页替换展示，不伪造完整统计或原子快照。
7. **生命周期与失败**：useAuthenticatedViewScope明确区分视图暂停、会话重置和销毁；各owner按generation／signal隔离晚返回与旧finally。可见pending/running每两秒只读刷新，隐藏／unknown／失败／销毁停止轮询；不自动重放写入。原实例隐藏时保留在途／未知写意图，会话重置与销毁清私有数据。未知恢复先只读核对实际资源，重试保留原键／版本／输入，后续拒绝不抹去原未知；明确放弃不表示回滚。附件关联与Run派发是两个动作，关联未知阻断后续，查询文件不冒充已确认引用；确认引用以不可信数据写入实际prompt，工具仍复查权限。
8. **当前能力与验收**：正式Host、线程、Run/正文/事件/审批/Child与步骤／工具审计已接Shared；旧API、CSRF、聚合settings、host/Run流、facade/Store和旧Protocol消费删除。旧Goal/Plan、活动输入队列/interrupt、手工增额/checkpoint/resume及历史删除按当前后端Run/上下文/治理重新设计，不提供兼容接口；具体差异归USAGE与当前方案。两轮源码审核及静态结果归testing，D17最终远程Actions E2E未执行，旧行为证据不代表此次界面通过。

## 终端动态背景

1. **职责与范围**：背景与 SSH 输出／xterm 字体测量独立。TerminalView 只消费当前 visual 内容、背景开关、设备模式与 active；背景不是终端几何成功后的附属操作。
2. **子功能与目录**：features/terminal/composables/use-terminal-background 唯一拥有 ready、iframe 引用、尺寸观察、显隐通知和生命周期；model/terminal-background-document 唯一生成 CSP／样式／HTML 与沙箱动画和尺寸 runtime。旧 mobileBackgroundRuntime 及 TerminalView 内嵌 resize bridge 已删除，不留转导出或双轨。
3. **依赖方向**：Workspace 与 Appearance 只传现有 TerminalVisualOptions；composable 依赖 Vue／浏览器，文档生成是纯字符串装配；不修改 SSH、Shared 或后端。
4. **类型与转换**：composable 与文档入参为单文件局部类型。HTML 不解释为可信宿主代码；iframe 仅 allow-scripts／opaque origin，消息仅接受 parent source、固定 type 与 boolean visible，不放开外部资源。
5. **入口与安装**：TerminalView setup 安装唯一背景 owner；mounted、active／内容变化、iframe load、ResizeObserver、visibilitychange、pageshow、focus 与 KeepAlive 恢复统一协调，加载无需 xterm 初始化完成。
6. **数据、事务与并发**：无持久化改动。当前设置为权威，隐藏时延后写入新 srcdoc，显示后使用最新内容；相同 srcdoc 不重载。可见性同时核对 active、视图生命周期、document visibility、容器／iframe 连接与非零尺寸。普通会话切换保留文档；浏览器若自行销毁脱离 DOM 的 iframe 上下文，仍走 load 重新同步。
7. **生命周期与失败**：父级每次显式恢复立即协调并仅追加一次 100ms 布局确认，隐藏／销毁取消该计时器，卸载移除监听和 observer。沙箱统一管理 RAF 回调、移动端 50ms 节流和每个待绘制帧的 100ms 期限；隐藏取消原生调度但保留回调，恢复重排，generation 隔离晚回调。尺寸与显隐共用一个 runtime，主题自持 canvas resize；减少动态效果后 resize／恢复可补画。完全冻结、主题自身异常／不处理 resize、WebGL context 丢失不构成已保证恢复能力。
8. **当前能力与验收**：沿设置→Workspace→TerminalView→父级 owner→沙箱 runtime 完成两轮源码复核；静态与构建结果归 testing/E2E。按 D17 未新增或执行本地行为测试，普通切换／长期后台、桌面／移动端、减少动态效果和真实主题回归仍待远程验收。

## 通用滚轮缩放

### 1. 职责与范围

foundation/interaction 的 useWheelScale 是 Ctrl+滚轮的唯一绑定入口，六个消费者为 TerminalView、MonacoEditor、FileManager、QuickCommandsPanel、CommandHistoryPanel 和 StatusMonitor。它拥有输入消费与即时比例，不拥有网络保存或业务资源。

### 2. 子功能与目录

use-wheel-scale.ts 管理捕获阶段的非 passive 监听、比例同步、同步/渲染后视口恢复与销毁；wheelScale.ts 只计算像素归一化、方向切换、离散步进及边界，resolver 不再从 public barrel 导出。配置类型唯一归 interaction/model/wheel-scale-types.ts。旧组件滚轮缩放处理器全部删除；终端普通滚轮的历史加载仍归 Terminal。

### 3. 依赖方向

组件从 foundation/interaction 入口使用 useWheelScale，foundation 仅依赖 Vue 和 DOM，不引用 Monaco、xterm、业务 Store 或 HTTP。组件提供必要的技术适配闭包，跨功能不得复制事件绑定和 props 同步。

### 4. 类型与转换

WheelScaleBindingOptions 指定目标 getter、权威外部值 getter、当前展示 Ref、范围、步长和 onChange。onApply 同步更新嵌入式渲染器，外部值变化也会调用；onChange 仅由用户缩放或返回的 setScale 触发保存，不因 props 回读重复保存。captureViewport 在变更前返回恢复闭包；Monaco 用模型行/列和屏幕偏移恢复位置，Files 虚拟列表用可见行比例恢复并关闭浏览器自动锚定。技术句柄留在原组件，不进入通用配置类型。无 Shared/后端协议变化。

### 5. 入口与安装

在组件 setup 调用一次；getter 跟随 v-if 的 DOM 替换，模块自动安装和移除监听。基础接入如下，保存 owner 需提供包含未结算预览的 value：

```ts
const root = ref<HTMLElement | null>(null);
const scale = ref(props.scale);
const { setScale } = useWheelScale({
	target: () => root.value,
	value: () => props.scale,
	scale,
	min: 0.5,
	max: 2,
	step: 0.1,
	onChange: (value) => emit('scale', value),
});
```

普通 DOM 用 scale 驱动样式。嵌入式编辑器增加 onApply 与 captureViewport、viewportFlush: 'sync'；Vue 渲染列表使用默认的 post 恢复。按钮或双指入口可调用 setScale，复用相同边界、通知和定位。

### 6. 数据、事务与并发

同一事件只能被一个缩放入口消费，普通滚轮不拦截；不足阈值、禁用或到达边界的 Ctrl 手势也阻止底层滚动及浏览器缩放。连续事件在 Vue 完成渲染前保留同一视口快照，只允许最新恢复代次执行。界面 Ref 是即时状态；外部值由业务保存 owner 协调预览后回读，不用时间窗口猜测哪些 props 是旧响应。

Appearance 的字体保存、Presentation 的面板比例保存分别在所属原串行队列执行时读取最新快照及版本，只修改当前缩放字段；普通设置草稿仍冻结原版本，不自动覆盖冲突。Workspace 用 createLatestValueSaver 防抖及合并最新值，并保持各字段预览直到最新任务结算；Appearance accept 只更新持久快照，不能清除其它未结算字体预览。外部版本冲突仍按原具名错误阻断并要求刷新，不自动重试未知写入。

第七轮独立 Consumer 复核还发现 Background 编辑器保存 slider 草稿后上传图片：上传成功时 Shared Appearance 版本会前进，但编辑器因有其他脏字段而不运行完整 `sync()`，导致后续 slider 保存错误使用旧基线。正式 `TerminalBackgroundSettingsPanel` 只在 upload/remove 自己已确认的 store.accept 回执中推进当前 editor CAS 基线，同时保留未保存表单值，不合并陌生的外部更新、不消除未知写入围栏。Notifications 渠道卡片稳定绑定 `item.id` 的 data 属性以区分重复名称行；AppIntegrationEditor 的 Reka Checkbox 暴露明确的启用 aria-label。以上为局部 owner 变更，不修改通用 UiCheckbox 角色或全局控制面。

### 7. 生命周期与失败

监听归组件 scope，目标替换撤销旧监听及待恢复回调；scope 销毁取消 watch、监听和未完成视口恢复。恢复闭包只在当前代次执行，不在卸载后访问旧组件。保存失败由业务 owner 提示并清除对应预览，网络结果不由通用交互模块解释。

### 8. 当前能力与验收

六处源码已迁移，编辑器避免原先冒泡缩放与内部滚动竞争，包含自动换行后的模型定位。文件首尾仍受实际可滚动范围约束；缩放动画、鼠标设备、快速反转与慢保存的行为验收按 D17 留待远程执行，具体检查证据归 testing/E2E。产品行为见 USAGE 工作区与文件编辑章节。

## 文本编辑器内置搜索集成

1. **职责与范围**：MonacoEditor 拥有普通文本查找/替换的宿主集成；查询、匹配、选区和结果滚动均由 Monaco 内置 FindController 管理，不另建搜索状态或外层滚动修正。
2. **子功能与目录**：组件显式 import Codicon CSS；Vite 的 @monaco-codicon.css 精确定位当前安装包字体样式，不能依赖 JSON 语言按需加载。固定版本补丁 scripts/patches/monaco-editor@0.56.0.patch 修复 HoverWidget 的垂直可用空间计算，pnpm workspace/lock 同步绑定。
3. **依赖方向**：FileEditor 调用 MonacoEditor.openSearch，组件调用内置 actions.find；搜索控件自行管理点击和键盘焦点。宿主容器不再把冒泡 click 强制转给正文；focusRegistry 的显式聚焦入口仍保留。
4. **类型与转换**：无应用/Shared/后端契约变化。字体与 tooltip 的 DOM/几何留技术集成边界，不传播为业务状态。
5. **入口与安装**：Codicon 随组件同步进入构建依赖图，字体 URL 由 Vite 重写和打包。Monaco 按固定 lockfile 安装补丁；当前前端仅消费 ESM hover 实现，不把本补丁声称为 AMD/min 入口修复。
6. **数据、事务与并发**：查找/替换的计数、动作和 reveal 保留原 owner；不添加重复监听或异步选区回写。HoverWidget 每次布局计算窗口和实际 overflow hidden/clip/auto/scroll 祖先的垂直交集，上方不足时选择空间更大的一侧，并按剩余高度限制内容。
7. **生命周期与失败**：继续由 Monaco dispose 清理查询与提示。依赖补丁不增加全局 observer、事件或 timer；保留现有编辑器 scope、滚动记录及缩放生命周期。不能靠抬高 z-index 绕过祖先裁切，也不将提示重挂到无归属的 body 容器。
8. **当前能力与验收**：普通文本字体资产、搜索焦点与裁切边界的源码修复已接入；实际输入/下一条/上一条/替换/正则错误提示与小面板场景按 D17 待远程回归。静态检查及资产依赖证据归 testing/E2E，产品说明见 USAGE 文件管理器章节。
