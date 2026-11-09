# Agent 架构

本页说明当前 SDK4 实现；扩展目标及验收判据见 [Agent 重构](AGENT_REFACTOR.md)，执行状态及审核表见 [PLAN](../PLAN.md#agent-动态插件架构重新设计)，实际操作见 [USAGE](../USAGE.md#agent)。源码接通、局部回归、浏览器验收和正式发布分别记录，不以本页说明代替完成证据。

## 1. 职责与范围

Agent 宿主管理可信身份、插件包/实例、Run、Operation、批准、预算及资源。App 后端插件实现完整 `run` 循环，自行决定模型、工具、并行、上下文、标题、压缩与结束；聊天 UI、模型工具和 MCP/ACP 协议实现在独立 [nexus-agent-plugins](https://github.com/0honus0/nexus-agent-plugins) 仓库。Host 没有五阶段策略或默认聊天循环回退。

支持同包多个 App、同 App 多个逻辑插件实例。App 各自选择 roots、UI、配置、授权、会话和私有数据。共享不可变包文件不共享权限或协议 session。酒馆/多角色只是扩展判据，本轮没有对应产品 UI。

通用执行核心只消费运行、操作、内容与生命周期契约。模型、SSH、文件、Browser 等可信实现由 `register.ts` 装配；新插件组合已有能力无需更新宿主，新增特权仍需要宿主支持。

## 2. 子功能与目录

所有路径相对 Backend `src/modules/agent`：

| owner                            | 职责与消费者                                                            |
| -------------------------------- | ----------------------------------------------------------------------- |
| `scope`                          | App/Thread、用户范围、组合来源与线程删除；HTTP、Workspace、Run 消费     |
| `runs`                           | 创建/取消/恢复、执行代、App driver、检查点、展示流、父子关系和结束围栏  |
| `operations`                     | 通用操作准入、幂等回执、派发授权、批准消费、内容、子效果与恢复证据      |
| `plugins`                        | 签名包、仓库、安装/更新、组合、逻辑实例、配置/连接、私有数据和隔离运行  |
| `plugins/registry/model`         | 作用域目录、原子注册、描述/schema、准确 binding、订阅及实例事件         |
| `plugins/sdk`                    | 公开后端 SDK4 边界；构建产物 `dist-plugin-sdk/backend-v4.mjs`           |
| `governance`、`execution`        | 当前授权、目标拒绝名单、批准策略、用户可调预算和用量                    |
| `providers`                      | 模型配置、凭据注入、实际请求/流、协议校验、用量与模型故障               |
| `tools`                          | 受管领域能力、任务/日志、资源复用、真实 I/O 准入；不持有模型工具 schema |
| `artifacts`、`memory`、`context` | 已确认文件、受管记忆数据、来源与持久历史；业务检索/压缩算法由插件消费   |
| `integrations`                   | Browser 可信连接能力；不再持有 MCP/ACP 协议客户端或集中配置             |
| `snapshots`                      | 当前完整表列注册、关联校验与备份恢复                                    |
| `interfaces`、`register.ts`      | HTTP/WS/IPC 白名单映射及唯一装配                                        |

Service 管流程与政策，Model 转换应用/存储/技术表示，storage 持接口，Adapter 持 SQL 和技术资源。目录不机械按设计中的方框再拆一层。

Frontend 的对应归属为 `features/agent/plugins`：`api/model` 管理边界，`components/composables` 安装及配置，`host` 挂载 App/Settings iframe 和可信交互，`sdk` 构建公开 `/sdk/frontend-v4.mjs`。不建立独立 SDK workspace；插件不导入宿主 Vue、Pinia、认证或私有 CSS。

## 3. 依赖方向

实际链路为：

`App UI → Host 接纳 Run → 固定 App.run → Registry discover/describe/bind → Operation 准入 → 准确 handler → 受管 Host 能力 → 原资源 owner`。

插件间调用也经过 Registry 和同一 Operation owner。调用 scope 由 Host 派生，不能通过 payload 选择用户、冒充人工管理或增加祖先权限。纯计算及普通目录读取不产生持久派发记录；模型、用户可见工具及真实效果保留各自事实，包装服务不重复计量同一效果。

独立仓提供默认 App `nexus.agent`、UI `nexus.ui.chat`、工具 `nexus.tools.{remote,browser,agent,integrations}` 和服务 `nexus.services.{mcp,acp}`。服务方法不自动进入模型目录。第三方可注册新的版本化 contract、工具和实例事件，不改 Host 业务名称枚举。

代码依赖、必需接口就绪与本次调用关系分别处理。用户选择 roots 公开贡献，自动带入的依赖不自动曝光全部工具。接口 scope 失效仅撤销相关贡献；不能沿可能有环的调用关系递归等待自身关闭。

## 4. 类型与转换

Shared `agent/plugins` 持 manifest4、SDK4、Registry/Binding/Surface、配置、内容和安全 RPC envelope；`agent/operations`、`agent/runs` 持双端操作与运行协议。插件的私有 checkpoint、MCP/ACP 业务 contract、算法和 schema 不放入宿主巨型业务联合。

每个外部入口从 `unknown` 严格解码。包 Adapter、IPC/HTTP/WS mapper、Frontend API/SDK 分别执行白名单转换；内部应用类型在所属 `model/*-types.ts`，存储行在 storage/SQLite Adapter，技术句柄在 Platform。schema 验证使用既有 Ajv，协议客户端使用官方 SDK，不自行复制引擎。

准确 binding 固定 provider 实例、进程 generation、配置 revision、schema 摘要与包身份；调用前复查真实选择和当前权限。工具显示名和模型 wire name只用于单次曝光映射，不是派发身份。签名与目录描述都不是授权。

## 5. 入口与安装

### 包、实例与设置

安装只保存实际包事实；组合生成独立 App 和逻辑实例，选择与授权分离。安装计划及下载进度不持久化，失败重读实际事实再准备。包更新先完整校验候选，再关闭受影响准入、排空并发布新代；UI-only 更新只替换对应 Surface，不能取消无关 Run。

`PluginInstanceService/Model` 是人工与 Agent 配置共同 owner；schema、默认值、说明及 Agent 可改路径来自签名资产，停用/未配置/启动失败时仍可读取。写入绑定 schema/包/旧 revision 与稳定 operation key，同事务 CAS 及回执；配置提交成功与资源生效分开。SecretBox 与 `PluginConnectionService` 单独管理凭据、HTTP endpoint、SSH target/argv，不能藏入普通业务 JSON。设置接口不从仅提供 App 的传输能力上限推导连接表单；兼具服务贡献的 App 以及直接使用传输的工具/服务仍按声明能力投影 connectionKinds，运行授权不受呈现判断影响。

已安装插件设置可管理真实 App/实例。MCP/ACP 表单及 Browser/CDP 目标设置由各插件交付；模型 Provider、执行预算、权限和可信 I/O 校验仍由宿主管理。

### 注册与生命周期

实例激活时收集完整注册批次，检查命名空间、能力上界与全部 schema 后原子发布。失败不出现半份目录。注册 disposer 绑定本次 publication，迟到 disposer 不能撤销新代。目录是当前可见快照；每次模型决策固定已曝光 binding，后续迭代可以重新发现。

自动连接准备使用绑定实例的生命周期 scope，不冒用 Cookie，不借管理 session 为 Run 派发。已安装而未选择/授权不代表允许联网；Run 按自己的 scope 创建协议资源。

### 前端 Surface 与通信

App 和 Settings 共用 iframe/MessagePort SDK 生命周期，按 purpose 派生权限；Host 保留可信批准、秘密输入、文件选择、资源关闭和取消入口。UI contract 由 App 声明、组合选择兼容 provider，不写死官方包名。

物理边界只有 iframe↔Host MessagePort、浏览器↔Backend 认证 HTTP/复用 WS、Backend↔隔离插件 IPC。取消/关闭走独立控制，不排在数据队列末尾。订阅先监听再取快照，按 scope、revision、cursor、generation 补读；ACK 表示已校验并应用，旧代 ACK 不确认新帧。插件事件沿注册 namespace/schema 交付，不开放跨实例广播，不为目录增加轮询。前端SDK按接收游标验证连续事件页，并按顺序等待异步消费者；ACK只确认实际消费完成的页，退订等待正在处理的回调并撤下尚未处理的队列。多页在途不构成协议错误，重复游标、错误修订和身份不符仍关闭连接。

## 6. 数据、事务与并发

### Run 与 Operation

Run 保存准确 App/代码依赖、输入、执行 generation、预算、父子关系、检查点与输出边界。Operation 保存稳定 key、规范请求/hash、真实调用者/父操作、准确 binding、授权/批准消费、派发和结果/关闭证据；领域明细按 operationId 关联。

派发在同事务复查权限、目标/配置/provider 修订，消费批准并登记唯一意图。提交未知不派发。按原 key 查询回执先于新调用准备；旧 binding 失效不妨碍有历史读取权限的调用者核对已接纳结果。相同 key 不同请求明确冲突，不能换键猜测重试。

Run 成功前核对全部关联效果和真实资源；handler 成功不能覆盖子效果 unknown。确定未派发的取消记录 cancelled，不制造远端未知。进程退出和本地取消不证明已派发写入回滚。

### App 检查点与恢复

App 显式保存私有状态、已消费 Operation IDs 和仍待处理的稳定意图。Host 检查内容归属及回执边界，不解释私有状态机。恢复固定原 App 实现，原子取得新执行代，先确认旧代资源收敛；并发 resume 只能一个取得执行权。旧代只能补记原事实，不能新派发或覆盖新代状态。

默认 App 的模型请求、工具提案、绑定、并行分组和消费位置在调用前 checkpoint。中断后查询原意图，不重跑整个循环；没有安全 checkpoint、准确实现或存在未确认效果时不自动续跑。普通不实现恢复的 App 仍可运行。完成/挂起先关闭新准入再排空，不能保存终态后留下未接纳的迟到调用。

### 内容、迁移与快照

完整日志/文件由原内容 owner 保存，流只交付分块、进度和引用；慢 UI 不丢原始输出。产物卡使用 Host 已确认来源，不从插件文本伪造 Artifact。

每条数据库变更独立连续迁移，SQL 在对应 Adapter；安装入口只编排。按用户确认的破坏性清理策略，迁移61建立附件文件删除队列，62删除SDK1–3运行及相关记忆、旧五阶段/工具/审批/集中集成表，63删除旧App及包档案。旧运行家族和引用旧代码依赖的运行一起清除，不转换为SDK4历史；当前SDK4运行、未知效果围栏、配置和非Agent数据保留。附件先登记删除意图，启动时由Artifact owner逐项清理，失败保留队列并明确报告恢复失败，重启继续；队列未收敛拒绝快照。已发布迁移1–60及签名不改写，旧快照不再受支持。业务运行和快照只接受当前SDK4表示，不保留旧行解码。插件私有配置/数据 schema 与宿主 schema_version 独立，显式迁移后才提交新包，不在 activate 偷迁移。快照核对实际完整表列与跨表引用，新增数据 owner 同步注册。

## 7. 生命周期与失败

资源按 App/逻辑实例/Run/Operation/Surface 归属。插件进程按需复用，SSH transport、exec channel、SFTP 和协议 session 是不同资源。沿现有十分钟滑动空闲策略，工具活动续期；Run 结束/取消、用户确认关闭或明确关闭应用时清理，中间步骤结束不提前断开。

MCP 官方 SDK 的协议状态和 continuation 在服务包；Host 仅持授权、秘密注入和受管 HTTP 字节通道。每次调用重新绑定当前 scope，不复用过期调用 control；实际 continuation 只能在同 session/config/generation 使用。

固定端点的 HTTP 连接由 Undici 按需分配；不叠加固定连接数，让未结束的流阻塞独立协议请求。原授权、DNS固定、凭据隔离及调用方指定的完整响应预算仍生效；关闭 owner 时取消并排空全部请求、响应与底层连接。

ACP 官方 SDK 持帧解析、回调和 prompt，Host 受管 SSH 进程及权限交付证据。内层请求单独批准；精确响应写入确认后才消费交付。正常结束先关闭 owned channel，排空 stdout/stderr 再等待 close；取消被动读取作为 EOF 收尾，真实写入/清理失败独立保留。

隐藏/最小化保留 Run，刷新 iframe 只撤对应 Surface；明确关闭应用的活动任务需要可信确认。撤权、信任/配置变更关闭相关新准入并排空原资源，独立清理失败不阻止其它清理；同一 close Promise 幂等，晚成功与晚拒绝仍归原 owner。

Host 使用具名有限错误，cause/凭据/供应商正文不越过安全出口。拒绝、确定失败、取消、执行未知和清理未知分别表达。签名不证明代码安全，Node permission/独立进程/iframe 的保证按实际测试边界说明；原始协议传输是强能力，不能声称恶意 provider 的每帧语义均由 Host 解析或约束。

日志使用项目诊断组件，关联 App/instance/Run/Operation/generation，不打印 Cookie、秘密或完整私密输入。Operation 的确定故障原因经有限 RunFailureCode 映射，与终态同事务写入 agent_operation_diagnostics（迁移60），重启后从实际失败操作及所属工具投影；诊断不改变效果是否确认。快照包含该表并核对关联终态与有限码。工具活动从真实子效果汇总唯一 SSH 目标，多目标不伪造单一目标。业务状态靠真实事件与来源补读；没有输出不自动判卡死，心跳不证明任务推进。

## 8. 当前能力与验收

SDK4 本体、前后端 SDK 和八个官方插件包已完成本轮实现、正式验收及发布。正式远程矩阵与插件独立测试通过；最终签名组合完成指定CDP的1440/390/320px聊天与刷新恢复验收。准确源码、版本、发布摘要及首次失败证据统一见[当前验收基线](../testing/E2E.md#当前验收基线)。

已覆盖动态能力/准确绑定、无模型App、多实例隔离、子任务、图片/标题/压缩、完整日志与续读、配置/私有数据、UI-only更新、市场生命周期和迁移/快照。旧固定阶段、IntegrationService/ToolService及旧工具表的正式测试消费者已迁移至新owner，无旧运行回退。旧夹具已随测试重构逐项迁移并完成完整自动门禁；真实模型效果、移动真机、介质故障与负载性能仍按PLAN单独维护，不以受控回归推断这些边界全部通过。

## Agent 容量与准入

业务准入由真实 Run、操作或资源 owner 持有：权限、当前目标、版本、幂等、用户配置的冻结预算及真实关闭均须保留。模型目录与同轮调用、Run 待提交写入、插件管理队列、UI 请求／订阅及隔离 Host 回调不叠加固定数量门槛。所有已接纳任务持续追踪至实际收敛；停止和关闭后不接纳新任务。

Shared 持有完整 RPC、HTTP 与内容分块预算；字段正文和集合不再重复设置更小的无依据配额。分页限制只约束当前交付页，不限制完整目录或结果。目录读取沿名称游标继续至空页，元数据字节容量可使页短于项数容量；不得用短页当作 EOF。文件树哈希流式消费，文件变更和写入仍逐步核对原指纹。完整文本编辑与搜索缓冲受底层字符串表示和实际部署资源约束。

插件 KV 写入不再为固定键数／总量配额扫描整个命名空间；CAS 和幂等仍在原事务执行。协作消息按完整编码字节选取可交付前缀后推进读取水位，未交付内容不取得消费权限。Skill 的准入按真实单篇响应与目录项编码容量，不能将装包成功视为无限 RPC 正文支持。

记忆候选使用完整已发布集合的分页与摘要，不以最近记录窗口替代检索范围；全部查询词参与插件排名，插件实例持有召回条数和总字节策略，Host 仅复查准确身份、已发布/未过期来源、版本及实际传输容量。选中结果分批重新核验后完整汇总，帧容量不替代总量预算。正文容量按实际 JSON 编码及现有读取外壳校验；KV 的单值同样核对编码膨胀，迁移入口不得写入正常 RPC 无法读取的值。

Browser 技术层按调用者的节点数和字节预算投影完整 DOM，不额外裁成八层、固定队列或截断属性；超过一页明确标记 truncated。替换本地节点引用不增加远端文档版本，真实 DOM 变更仍使旧引用失效。MCP／ACP 的协议限制取官方 SDK 和受管内容预算；ACP 普通字节写入可分块，带批准交付证据的精确响应只发送一次。

SDK4 的 Run 信息、模型请求、插件数据与配置、受管原生调用及传输外壳显式使用所属插件 RPC 容量，不继承普通状态响应的 32 KiB 默认值。模型供应商事件使用完整模型流预算，文本下游合批大小只决定批次交付，不构成输入事件拒绝门槛。

消息、候选目录与单篇 Skill 交付按实际 `ok/valueJson` RPC 外壳计量，包含结果字符串的再次 JSON 编码；消息读取水位只推进最终单页可交付的连续前缀，未入页的有效消息保持未读。模型数、App数、授权目标与意图附件不在入口、存储或界面另设重复数量门槛，完整编码容量由各协议 owner 校验。意图敏感字段检查采用迭代遍历，不依赖固定嵌套深度。

## 浏览器实例配置与市场语言

1. **职责与范围**：浏览器工具和CDP目标设置归浏览器插件；宿主只提供可信浏览器连接、URL权限、安全执行与真实资源关闭。目录本地化由发布者提供，宿主不按官方包ID注入产品介绍。
2. **子功能与目录**：插件仓浏览器包贡献 settings/schema/UI；Host integrations/browser Model转换实例配置并持技术能力，Service持会话；plugins持配置CAS、运行代及目录，前端市场只投影当前语言。
3. **依赖方向**：插件调用公开SDK；run-native边界从实际source绑定只读配置能力，不接受工具自报端点或instance身份。市场消费Shared目录，不引用插件私有源码。
4. **类型与转换**：Shared browser-codec严格解码目标；PluginInstanceSource→可信配置引用→BrowserModel逐字段转换；目录localizations为locale/displayName/description数组，仓库、HTTP及前端各自白名单投影。现有UI环境的locale事件继续复用，不增加语言RPC。
5. **入口与安装**：已安装插件的设置按钮挂载签名设置Surface；删除本体全局Browser配置HTTP及设置面板。任何声明browser能力的插件都消费自身实例配置，Host不按包名选取运行配置。
6. **数据、事务与并发**：配置沿原实例表、schema、CAS及幂等用例保存。迁移64将旧官方浏览器全局目标复制到其未配置的已有实例，再删除旧表；没有对应实例的旧全局配置随旧表移除。迁移1–63不改写，运行路径无旧值兼容。新实例从插件defaults开始。
7. **生命周期与失败**：读取配置前后复查source及package/config修订；会话绑定user/App/Run/instance/generation，配置变化使旧绑定失效，退役只关闭准确旧代会话，等待在途任务并保留清理失败；全局关闭仍排空所有真实资源。
8. **当前能力与验收**：实现与回归见[历史D33](../testing/HISTORY.md#d33插件cdp配置市场移动布局与本地化2026-11-08)及当前测试基线，覆盖实例隔离、修订变化、URL策略、关闭失败、语言切换/缺译回退及320/390px市场，不以类型检查代替浏览器证据。语言优先精确标签，其次同语言，未提供翻译使用原文；切换语言只影响展示与搜索，不改变包身份或签名。

## Agent 设置归属

1. **职责与范围**：模型 Provider、权限、执行总预算、并发和资源保留归 Host；上下文/运行指令归 App 插件，记忆召回策略归 Agent 工具插件，MCP/ACP 与 CDP 配置归各自服务/工具插件。
2. **子功能与目录**：Host `settings` 保留管理入口与通用插件设置容器，移除独立集中协议页；`nexus.tools.agent` 持配置 schema、默认值、设置 Surface 和召回算法。
3. **依赖方向**：插件通过 SDK 配置能力读取自身实例及受管记忆，不导入 Host execution 政策；Host memory 不依赖 ExecutionService。
4. **类型与转换**：执行/治理协议不再含召回字段；memory.retrieve 的 maxItems 表示本次请求数、maxBytes 表示真实编码帧容量。插件持唯一业务偏好，Host 逐项核验来源与版本，不静默删除选项。
5. **入口与安装**：Agent App 页上部应用行和下部已安装扩展插件行的“设置”选择 App/实例；从应用行打开默认选择该App，安全策略仍原位展开，MCP/ACP 不另设宿主页；Agent 工具设置沿公开 Settings Surface、主题和三语 locale 环境。
6. **数据、事务与并发**：迁移65在同一事务转换官方未配置实例的有效偏好，并清理全局、App覆盖、冻结任务和硬限确认的旧字段；已编辑实例及第三方同名包不覆盖，迁移1–64不变。
7. **生命周期与失败**：设置沿原 schema/CAS/幂等和实例代失效；召回大结果按真实编码帧分批，逐批复核同一候选摘要与准确引用，任一批失败不交付部分汇总，取消停止后续读取。
8. **当前能力与验收**：实现与最终证据见[历史D34](../testing/HISTORY.md#d34agent设置归属复审2026-11-08)及当前测试基线；正式回归覆盖迁移/回滚、单帧以上完整召回、插件实例预算与移动设置入口。

### 注册与归档校验的复用

Registry 在同一次发布中按完整 schema 文本复用技术编译结果，复用范围不持有权限或 provider 身份；Schema 标识相同但正文不同仍分别编译，注册退出后不保留全局缓存。每次发布仍先校验全部 provider 声明及能力，再原子替换，复用旧定义不能跳过准入。前后代实例、调用授权和结果账本各自保留原有检查。

归档容量由插件契约 owner 传给通用 PackageReader；技术 Adapter 消费该配额，不重复硬编码另一套业务上限。完整 TAR 表示、展开及单文件计量和路径安全在读取边界执行，计算预算还需满足 Node Buffer 的真实表示上限。不以固定目录层数替代合法路径及字节预算。通用读取器不叠加4096字符路径或64KiB元数据上限，插件路径声明仍在包契约边界校验。gzip/Zstandard在明确的完整容器预算内只展开一次，禁用TAR后续隐式解压，避免嵌套压缩绕过计量。

测试归属见[测试架构](TESTING.md)：Host通用安全与生命周期在本体；官方App、工具、MCP/ACP和ChatUI业务在插件仓各包`tests/`；完整Agent真实Host链路归插件`tests/interoperability/`，业务浏览器归`tests/e2e/specs/<packageId>/`。本体通过准确源码/签包产物调用外仓用例，不维护第二套官方业务测试或Playwright→Node包装。历史发布通过与本轮测试框架重构验收分别见[测试入口](../testing/E2E.md)。

## 必需插件启用引导与权限呈现

1. **职责与范围**：必需性来自包声明，RepositoryService 编排发现、验证、安装与组合，Host 不内置必需包 ID。权限分类属于前端呈现，真实 grants、目标范围与批准继续归治理 owner。
2. **子功能与目录**：Shared `plugins/onboarding{,-codec}`；Backend `plugin-onboarding-types/rules` 和 RepositoryService；HTTP onboarding mapper；Frontend onboarding API/model/composable、Modal 和共用 PluginCapabilities。
3. **依赖方向**：目录只作发现，签名包确认声明；Service 复用原 PluginService、Model、SQLite Adapter，纯规则仅消费应用事实，不增加 DI、安装工作流或包名策略。
4. **类型与转换**：可选 requiredOnEnable 是新 opt-in 元数据；缺省表示不要求，非旧版本兼容转换。manifest、目录、存储表示、应用、HTTP 与前端分别白名单映射。安装命令携带真实 ExactRef/CAS，展示组件只接收能力 ID 与受控编辑事件。
5. **入口与安装**：设置总开关调用 POST onboarding/prepare 与 install；按包ID合并官方及可信来源的稳定必需包；优先当前已安装发布者，再优先兼容官方来源，其他来源按配置顺序选取，同来源内取最新兼容版本。准备与确认使用同一来源政策，原准确引用、信任及CAS继续生效；同名不同发布者不再直接拒绝启动，已有包复用。UI 按 contract/API 匹配，保留已有相容选择，多个候选无唯一解时拒绝。
6. **数据、事务与并发**：无新表、迁移或完成标记；声明在不可变签名版本中，目录输出必须匹配。首个安装前验证全批和组合，安装期间仅用本批已确认修订替代自身改变的前置条件；包升级事务交付绑定before/after修订回执，经Model白名单转换，批次只在before匹配原确认版本时推进CAS。最终组合仍核对准确包集合及已确认修订，不把并发选择变化当成本批写入。包/组合与总开关为独立提交，不能声称原子回滚。
7. **生命周期与失败**：复用仓库任务 lane、停机 signal 与 pending 追踪；新 App 按声明授予执行能力，已有 App 保留选择。失败不继续启用，未知结果重新读取事实，页面失效不发布晚结果。权限折叠不改变草稿/保存 CAS 或失效授权的撤销入口。
8. **当前能力与验收**：按 USAGE 操作；两仓 SDK、签包元数据、协议及组件回归和指定 CDP 证据归 PLAN/testing。正式目录使用新声明须随插件发布交付；本体与插件完整远程门禁及正式签名发布状态见测试入口。
