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
| `snapshots`                      | 完整表列注册、关联校验、旧数据升级与备份恢复                            |
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

`PluginInstanceService/Model` 是人工与 Agent 配置共同 owner；schema、默认值、说明及 Agent 可改路径来自签名资产，停用/未配置/启动失败时仍可读取。写入绑定 schema/包/旧 revision 与稳定 operation key，同事务 CAS 及回执；配置提交成功与资源生效分开。SecretBox 与 `PluginConnectionService` 单独管理凭据、HTTP endpoint、SSH target/argv，不能藏入普通业务 JSON。

已安装插件设置可管理真实 App/实例。MCP/ACP 表单由服务包交付；模型 Provider、执行预算、权限、Browser 可信配置仍由宿主管理。

### 注册与生命周期

实例激活时收集完整注册批次，检查命名空间、能力上界与全部 schema 后原子发布。失败不出现半份目录。注册 disposer 绑定本次 publication，迟到 disposer 不能撤销新代。目录是当前可见快照；每次模型决策固定已曝光 binding，后续迭代可以重新发现。

自动连接准备使用绑定实例的生命周期 scope，不冒用 Cookie，不借管理 session 为 Run 派发。已安装而未选择/授权不代表允许联网；Run 按自己的 scope 创建协议资源。

### 前端 Surface 与通信

App 和 Settings 共用 iframe/MessagePort SDK 生命周期，按 purpose 派生权限；Host 保留可信批准、秘密输入、文件选择、资源关闭和取消入口。UI contract 由 App 声明、组合选择兼容 provider，不写死官方包名。

物理边界只有 iframe↔Host MessagePort、浏览器↔Backend 认证 HTTP/复用 WS、Backend↔隔离插件 IPC。取消/关闭走独立控制，不排在数据队列末尾。订阅先监听再取快照，按 scope、revision、cursor、generation 补读；ACK 表示已校验并应用，旧代 ACK 不确认新帧。插件事件沿注册 namespace/schema 交付，不开放跨实例广播，不为目录增加轮询。

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

每条数据库变更独立连续迁移，SQL 在对应 Adapter；安装入口只编排。旧运行协议由迁移退休，历史/未知证据保留，不在运行时补旧字段或回退旧 SDK。插件私有配置/数据 schema 与宿主 schema_version 独立，显式迁移后才提交新包，不在 activate 偷迁移。快照核对实际完整表列与跨表引用，新增数据 owner 同步注册。

## 7. 生命周期与失败

资源按 App/逻辑实例/Run/Operation/Surface 归属。插件进程按需复用，SSH transport、exec channel、SFTP 和协议 session 是不同资源。沿现有十分钟滑动空闲策略，工具活动续期；Run 结束/取消、用户确认关闭或明确关闭应用时清理，中间步骤结束不提前断开。

MCP 官方 SDK 的协议状态和 continuation 在服务包；Host 仅持授权、秘密注入和受管 HTTP 字节通道。每次调用重新绑定当前 scope，不复用过期调用 control；实际 continuation 只能在同 session/config/generation 使用。

ACP 官方 SDK 持帧解析、回调和 prompt，Host 受管 SSH 进程及权限交付证据。内层请求单独批准；精确响应写入确认后才消费交付。正常结束先关闭 owned channel，排空 stdout/stderr 再等待 close；取消被动读取作为 EOF 收尾，真实写入/清理失败独立保留。

隐藏/最小化保留 Run，刷新 iframe 只撤对应 Surface；明确关闭应用的活动任务需要可信确认。撤权、信任/配置变更关闭相关新准入并排空原资源，独立清理失败不阻止其它清理；同一 close Promise 幂等，晚成功与晚拒绝仍归原 owner。

Host 使用具名有限错误，cause/凭据/供应商正文不越过安全出口。拒绝、确定失败、取消、执行未知和清理未知分别表达。签名不证明代码安全，Node permission/独立进程/iframe 的保证按实际测试边界说明；原始协议传输是强能力，不能声称恶意 provider 的每帧语义均由 Host 解析或约束。

日志使用项目诊断组件，关联 App/instance/Run/Operation/generation，不打印 Cookie、秘密或完整私密输入。Operation 的确定故障原因经有限 RunFailureCode 映射，与终态同事务写入 agent_operation_diagnostics（迁移60），重启后从实际失败操作及所属工具投影；诊断不改变效果是否确认。快照包含该表并核对关联终态与有限码。工具活动从真实子效果汇总唯一 SSH 目标，多目标不伪造单一目标。业务状态靠真实事件与来源补读；没有输出不自动判卡死，心跳不证明任务推进。

## 8. 当前能力与验收

SDK4 本体、前后端 SDK 和八个官方插件包已完成本轮实现、正式验收及发布。正式远程矩阵738项全部一次通过，插件及仓库98项测试通过；最终签名组合完成指定CDP的1440/390/320px聊天与刷新恢复验收。准确源码、版本、发布摘要及首次失败证据统一见[当前验收基线](../testing/E2E.md#当前验收基线)。

已覆盖动态能力/准确绑定、无模型App、多实例隔离、子任务、图片/标题/压缩、完整日志与续读、配置/私有数据、UI-only更新、市场生命周期和迁移/快照。旧固定阶段、IntegrationService/ToolService及旧工具表的正式测试消费者已迁移至新owner，无旧运行回退。矩阵外独立旧夹具、真实模型效果、移动真机、介质故障与负载性能仍按PLAN单独维护，不以受控回归推断这些边界全部通过。

## Agent 容量与准入

业务准入由真实 Run、操作或资源 owner 持有：权限、当前目标、版本、幂等、用户配置的冻结预算及真实关闭均须保留。模型目录与同轮调用、Run 待提交写入、插件管理队列、UI 请求／订阅及隔离 Host 回调不叠加固定数量门槛。所有已接纳任务持续追踪至实际收敛；停止和关闭后不接纳新任务。

Shared 持有完整 RPC、HTTP 与内容分块预算；字段正文和集合不再重复设置更小的无依据配额。分页限制只约束当前交付页，不限制完整目录或结果。目录读取沿名称游标继续至空页，元数据字节容量可使页短于项数容量；不得用短页当作 EOF。文件树哈希流式消费，文件变更和写入仍逐步核对原指纹。完整文本编辑与搜索缓冲受底层字符串表示和实际部署资源约束。

插件 KV 写入不再为固定键数／总量配额扫描整个命名空间；CAS 和幂等仍在原事务执行。协作消息按完整编码字节选取可交付前缀后推进读取水位，未交付内容不取得消费权限。Skill 的准入按真实单篇响应与目录项编码容量，不能将装包成功视为无限 RPC 正文支持。

记忆候选使用完整已发布集合的分页与摘要，不以最近记录窗口替代检索范围；全部查询词参与插件排名，Host 复查准确身份、版本和用户召回预算。正文容量按实际 JSON 编码及现有读取外壳校验；KV 的单值同样核对编码膨胀，迁移入口不得写入正常 RPC 无法读取的值。

Browser 技术层按调用者的节点数和字节预算投影完整 DOM，不额外裁成八层、固定队列或截断属性；超过一页明确标记 truncated。替换本地节点引用不增加远端文档版本，真实 DOM 变更仍使旧引用失效。MCP／ACP 的协议限制取官方 SDK 和受管内容预算；ACP 普通字节写入可分块，带批准交付证据的精确响应只发送一次。

SDK4 的 Run 信息、模型请求、插件数据与配置、受管原生调用及传输外壳显式使用所属插件 RPC 容量，不继承普通状态响应的 32 KiB 默认值。模型供应商事件使用完整模型流预算，文本下游合批大小只决定批次交付，不构成输入事件拒绝门槛。

消息、候选目录与单篇 Skill 交付按实际 `ok/valueJson` RPC 外壳计量，包含结果字符串的再次 JSON 编码；消息读取水位只推进最终单页可交付的连续前缀，未入页的有效消息保持未读。模型数、App数、授权目标与意图附件不在入口、存储或界面另设重复数量门槛，完整编码容量由各协议 owner 校验。意图敏感字段检查采用迭代遍历，不依赖固定嵌套深度。
