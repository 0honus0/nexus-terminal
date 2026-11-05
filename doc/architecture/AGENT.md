# Agent 后端架构

本文集中 Agent 治理、工具执行、协作及插件 App 生命周期的专题设计；后端通用装配、层次和资源边界见 [Backend](BACKEND.md)，前端状态见 [Frontend](FRONTEND.md)，外部契约见 [Shared](SHARED.md)，实际接口用法见 [API](../API.md)。

各专题沿 [模块模板](MODULE_TEMPLATE.md) 的八个维度维护；共性约束只引用 [HUMAN](../rules/HUMAN.md)、[ENGINEERING](../rules/ENGINEERING.md)，不复制规则。验证状态统一见 [E2E](../testing/E2E.md) 与 [PLAN](../PLAN.md)，正文描述当前设计，不作为历史执行授权。

阅读入口：[执行/模型/上下文](#执行模型与上下文)、[授权审批](#授权与审批基础)、[App 政策](#app-声明与目标政策)、[工具账本](#工具目录与执行账本)、[Shell/Job/Docker](#shell后台-job-与-docker-工具)、[ACP](#acp-runtime-与独立权限)、[协作](#rootchild-与协作)、[项目目录](#项目上下文与共享突变占用)、[插件 App](#插件作为唯一-agent-app-来源)、[插件与集成](#集成与插件边界)。

## 执行、模型与上下文

### 工具账本与结算目录

`runs/model/run-tool-types.ts` 是操作的内部类型 owner，`run-tool-model.ts` 逐字段转换存储命令/结果并映射失败；`runs/storage/run-tool-storage.ts` 定义持久任务；`runs/adapters/sqlite/run-tool-{schema,row,sql,events}.ts` 独占 DDL、行解码、CAS 和状态事件。私有参数/结果预算归 runs/run-tool-limits.ts，不预建无人消费的 Shared DTO。

工具结算政策归 `runs/run-tool-rules.ts`；Model 将事务内存储事实转换后执行纯规则，Adapter 只做引用/版本复查和事务写入。未派发操作允许 failed/cancelled；已派发不能写 cancelled，无法确认远端结果时写 unknown。父 Run 成功条件归 `runs/run-rules.ts`，通过 Model 的窄同步回调消费事务内未结工具事实。

### 声明与治理依赖

Scope 的 App/声明行解码归 scope/adapters/sqlite/app-row，列表和单项复用能力解码；来源种类、身份、UTF-8/容量、hash 与有限标志不以宽泛文本代替。审批 Service → Governance Model → Governance Storage → SQLite；事务读取 runs 的存储操作事实，Model 转成独立 ApprovalOperation，再交 Service 的同步判断。消费提交返回的存储操作经 RunTool Model 唯一投影转换；Service 不取得存储行。SQLite owner 之间可协作实现同一事务，不引入 Model/Service。

### 工具操作类型

ToolOperation/ToolInspectionCommand/ToolIdentity 归 runs/model；StoredToolOperation/StoredToolInspection/StoredToolIdentity 归 runs/storage，各边界逐字段转换。ApprovalRequest 只指定操作身份及审批种类，不接受自报 hash、风险、能力或摘要；这些事实从当前持久操作生成。Shared agent/tools 的 values/model/http/http-codec 定义有限状态、工具列表与认证单调用详情；参数仅经绑定用户/App/Run/tool 的单调用认证详情接口按需读取；原始结果正文、providerCallId 与私密摘要保持内部。ToolEvent/Page 归 runs/model，StoredToolEvent/Page 归 runs/storage，不继承 Shared 对象。

### 工具详情入口

认证单调用详情安装 `GET /api/v1/agent/apps/:appId/runs/:runId/tools/:toolId`，线程工具列表安装 `GET /api/v1/agent/apps/:appId/threads/:threadId/tools`。Shared 严格解码身份、`before:createdAt:id` 游标和 limit（默认60、最多100）；RunService/RunToolModel 从持久账本生成安全投影，HTTP 与前端 `native-tools-api` 分别核对身份和请求关联。单调用详情允许按需读取原模型参数和安全失败码，不返回注入凭据、原始结果或供应商调用身份。旧步骤/工具事件审计接口已移除，不新增任意派发入口；Access 在入场及异步交付前核验。

register 在数据库初始化及迁移完成之后，通过 RunToolModel 收敛未完成操作，并通过 ToolJobModel 收敛 queued/dispatched Job 后再接收请求。审批 request/consume 由内部可信工具消费者调用，不对外新增任意派发入口；resolve HTTP 只产生决议，不能消费执行许可。AcpPermissionService 持有独立持久权限操作，绑定父操作与真实 runtime 请求；缺失或失效的绑定明确拒绝，不能借普通工具审批派发父操作。

### 工具事件事务与恢复

工具事件分页在 SQLite 同一事务核对 user/App/Run/Tool 当前记录并读取其历史状态事件；按 revision 升序、严格大于 after，空页 nextCursor=after，否则为末项 revision。读取页校验应有条数、连续 revision、operationRevision 不倒退；到达当前 revision 时，事件的 hash/状态/修订/时间必须与当前行一致；不存在或范围不匹配返回未找到，不查询跨范围事件。读取与当前行校验共享快照，不据审计状态授予执行权。

agent_run_tools 通过复合外键绑定 Run/user/App，agent_governance_approvals 绑定同范围 ToolCall；agent_run_tool_events 与每次操作更新同事务写入。operationRevision 只随内容改变，revision 随状态/内容改变，审批 inputRevision 绑定前者。request/resolve/consume 读取当前政策、Run、操作、目标；consume 对未消费的普通工具批准做 CAS，并与 dispatched 状态及事件原子提交。历史 approved/幂等快照不产生第二份许可；未知提交不允许外呼。App/政策/审批和工具派发修订在递增前检查安全整数上限，批量失效也先检查原集合，任一耗尽使原事务回滚。审批消费时间必须处于决议之后且截止之前，存储与 Shared decoder 同时拒绝矛盾记录。审批创建及其后续 Operations 事件发布同属 GovernanceService 的在途任务；已提交审批后的事件失败保留 operation_unknown 与原因。

Model 根据完整应用检查内容和 user/App/Run/modelStepIndex/providerCallId 的固定位置编码生成 SHA-256，内部调用者不指定 operationHash；检查写入时间在 Adapter 的实际事务中取样。该摘要不替代可信工具定义/输入生产者。同模型步骤内相同 providerCallId/hash 的重放还须匹配完整检查内容；不一致返回版本冲突。工具 finish 在事务内复查父 Run 与自身 revision，结算与状态事件、未决审批失效原子提交，时间在写事务内取样。Run 完成不能越过 inspected/dispatched/unknown 工具；父 Run 终态与工具围栏同事务提交。启动恢复同时读取模型步骤和工具账本，即使没有模型步骤，也不遗漏已派发工具；保留其 unknown，不重放。

### 工具能力与授权范围

ToolCall 账本、审批消费及文件/Shell/Docker工具源码已接线。账本归原 runs 聚合，governance 拥有审批政策与单次许可。目录、诊断及文件只读工具的可信检查、执行消费者与模型反馈已接线；受审批文件突变、Shell/当前 Run 后台 Job/Docker 已接线，ACP Runtime、独立权限及直接 Root/Child 协作已接线；执行设置、上下文与预算已接入 governed 政策，行为覆盖见 testing。

### 请求指引、调度与插件贡献

1. **职责与范围**：Run仍为单轮和Root/Child执行owner；Context保存每步完整宿主指引及当前插件/Skill目录；Tools调度明确独立的读取，Plugins持签名声明和隔离调用，不开放替换模型、存储或执行循环的插件钩子。
2. **子功能与目录**：context/agent-instructions持宿主指引，ContextService替换而非累加本轮指引；ToolService.prepareStep组合当前目录、权限裁剪和可选beforeStep贡献，executeBatch持滚动池与exclusive屏障；GovernanceService.watch持审批唤醒；Platform ai/model-text-batches持传输文本合批。
3. **依赖方向**：Run→Tools/Context/Governance/Plugins应用能力；Model逐字段转换storage/Platform，签名包Adapter解码agent.json，隔离ModuleRuntime仅接通用JSON调用和取消，不反向依赖Agent类型。
4. **类型与转换**：SDK agent-extension严格解码贡献及context/tool请求、text结果；应用PluginAgentContribution/Catalog/Invocation和存储贡献/调用独立定义，边界白名单转换。ContextSnapshot/StoredContextSnapshot必填systemPrompt；请求hash含指引，记录完整快照并计算编码容量与Token估计，压缩保留当前指引，测量锚点只在指引完全一致时复用。
5. **入口与安装**：每步请求经prepareStep，Chat使用system消息、Responses使用instructions。插件可无agent.json；有贡献时声明role、可空toolNames、beforeStep和具名tools。工具调用经plugin_tool_call及独立plugin.invoke全局grant/单次批准；上下文钩子需要context.read。角色、目录、Skill和钩子结果均不作为权限。
6. **数据、事务与并发**：指引快照按当前完整 JSON 严格解码，后续历史数据转换归对应独立迁移。工具结果按模型原顺序提交下一轮；只有显式parallel定义重叠，其余为屏障，并发不超过当前批次及冻结总工具预算。管理任务独立计算原Service8项/Runtime32项准入，Run读取与调用归Run预算和真实任务owner，避免并发目录/工具挤占管理名额；活跃实例复用，不为每次调用重新读取验签整个包。审批通知只唤醒原事务检查，保留1秒跨进程/过期复核。
7. **生命周期与失败**：失败/取消停止补位并等待已启动项；插件调用绑定安装revision，实例内串行、计入原pending和排空，完整期限包含启动/排队。取消发往原隔离实例，不以本地等待结束证明停止；未知工具结果与存储未知分别映射，原实例关闭与Run效果围栏分开：已确认关闭时只保留Run未知效果，清理或存储未确认才保留实例并阻断模块。流合批沿已有16ms交付节奏及128KiB帧容量，控制/完成/已知断流前交付已收到前缀；预读任务、timer和iterator.return均有owner，清理失败保留类别。只有已收到且未开流的明确400/401/403/404/405/413/415/422/429拒绝可按failed结算；只有429可在同一步原期限内沿SDK既有退避；5xx、超时、半流和未知副作用仍保留unknown。
8. **当前能力与验收**：六项源码与双端契约的静态及构建证据归testing；不声称测得吞吐、响应时间或模型质量改善。历史角色与运行中输入保持现有产品规则，D17下并发/审批/断流、插件安装升级与真实模型效果待正式专项验收。

### Root Run 执行链

唯一 Run owner 在 `modules/agent/runs`，持有创建/取消、主状态、模型步骤、事件、幂等、执行任务和恢复。旧 Backend 的现存 Run/提交/调度/模型端口及 HTTP/WS 是功能覆盖依据，不恢复退役 Runner。主 Run 已有 pending/running/completed/failed/unknown/cancelled 源码，步骤与主状态同事务联动。模型探测和 pending 均不证明执行成功。

执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。执行消费者共用冻结上下文与预算；恢复行为及验证范围见测试入口。

### Provider 与冻结输入

管理 Provider、加密凭据、发现/测试模型、查询/刷新 Registry，并在创建 Root Run 时冻结模型配置与凭据代际。Run 持有完整主状态与子步骤，执行政策/工具审批、上下文/预算由所属 owner 管理；正式前端已接线，行为证据见 testing。

### 上下文装配

1. **职责与范围**：context 拥有 Root 的 Thread 历史装配、Run-local 完整工具交换及容量准入。历史保留此前 Root 的输入、步骤、工具状态与已记录结果，包含失败、取消和 unknown，不伪造缺失结果。历史转为不可信数据，不成为当前指令或授权；Child 仅取得委派输入和自身交换，不读取父 Thread 私有历史。
2. **子功能与目录**：context/service 的 ContextHistoryService 管历史准入，ContextService 管 Run 内快照与完整交换；context-rules 管纯规则（含normal/extended窗口选择及统一完整请求估算），context-limits 管私有表示上限。context/model 持有应用类型及存储转换，context/storage 定义独立历史/快照契约，context/adapters/sqlite 持有 SQL、行/JSON 解码和快照连续性校验。
3. **依赖方向**：原 RunExecutionOwner → ContextHistoryService → ContextModel → ContextStorage/SQLite；每轮再由 ContextService → RunStepModel → RunStepStorage/SQLite 同事务保存快照。Context 不引用执行 Service，Adapter 不引入应用 Model/Service 类型；模型请求编码仍由原 RunModelStream/Platform AI 转换。
4. **类型与转换**：消息/proposal/reasoning 应用类型唯一归 Run；History/Source/Snapshot 归 context/model，独立存储对象归 context/storage，Model 对全部嵌套字段逐项转换。基础状态引用已有 Shared values；内部快照无双端消费者，不新增 Shared/public 对象。跨 Run 不复用加密 reasoning；同 Run 续接保留供应商需要的完整 reasoning。
5. **入口与安装**：Agent register 安装 ContextModel/Storage 和历史 Service 到原执行 owner，无第二个执行 registry 或新 HTTP。读取历史仍位于冻结政策检查之后，每轮取得快照后才 reserve；每轮受 governed、当前版本、冻结预算及期限约束。
6. **数据、事务与并发**：Root/Child 创建事务分配不可变 thread_sequence，历史按该序号排序，不用时间戳推断先后。Service 通过 Model 向原读取事务传入来源窗口容量与纯预算判定；Adapter 按不可变序号倒序选择最近连续完整Run后转正序，最多4096个来源、1024步骤、4096工具和4MiB原始正文，较早历史不占本轮预算但持久记录不删除，单个过大历史Run可整体省略。相容来源前缀的语义检查点仍复用，超过预算则保留原窗口。ContextService在首轮快照之前按完整序列化/Provider预算移除最旧完整历史消息及其全部来源（摘要按coveredRuns一起移除），只缩小连续后缀，不裁剪当前输入或执行中的工具交换；首轮快照后锁定来源，后续连续性仍严格校验。步骤 reserve 同事务保存 agent_model_contexts 的完整内容、来源及 SHA-256，并核对窗口内完整连续后缀的来源 user/App/Thread/sequence/version/status；后续轮与已存前缀、原步骤文本/proposals及确定工具结果经Model投影后的消息逐项一致。当前存储按精确结构与签名校验，后续演进按 H-21。未来恢复若修改被引用的历史步骤/结果，必须原子推进来源版本；不得仅修改子账本而维持来源版本不变。
7. **生命周期与失败**：消息与工具定义合计4MiB，不另设消息数量上限；不按normal/extended裁剪窗口，不以字节估算作为模型上下文硬拒。context-rules保留完整性和编码容量检查，其保守估算仅用于尚未报告usage的步骤预约，不是供应商精确token用量。Platform AI将最多128项工具声明与每轮最多32次调用分别限制，不以调用数量限制目录。模型输入明确标注近期历史可能省略，历史只按完整Run滑窗，不截断半组工具；本轮消息/请求自身超限仍明确拒绝；首轮确定拒绝只结算原身份/版本/创建请求且无步骤的 pending Run，后续按真实派发事实结算，存储失败保留因果且不重试。原执行 owner 管取消、围栏、unknown 与 drain；持久快照不授权重启后重新派发。
8. **当前能力与验收**：Run-local 交换、持久 Thread 历史和逐步骤内容快照已接线；受限结果续读已接线；语义检查点、Memory/Recall、Artifact/清理与执行设置已有实际消费者。USAGE、实施四表与 testing 分别维护当前行为、任务和检查证据；行为证据及未验范围见 testing，正式前端已接线。

### 上下文结果投影与续读

1. **职责与范围**：context拥有模型结果投影/Unicode页准入；原RunTool账本仍保存完整确定结果，预览不升级原操作的验证或授权，不重放外部工具。
2. **子功能与目录**：context/result-rules.ts持有纯投影/hash/编码容量规则；model/context-types.ts持有读取输入/页/结果，service/result-service.ts管理来源准入；无需第二份存储/文件库。
3. **依赖方向**：ToolService→ResultService→原RunToolModel/GovernanceService；RunStepModel在存储事务回调内转换结果事实并验证相同应用投影，SQLite只读独立storage事实，不引入应用规则。
4. **类型与转换**：ToolInput引用context应用读取类型；StoredContextToolResult归context/storage，Model逐字段转换。已有Shared治理values新增context.read，完整治理codec/后端是实际消费者；私有工具正文与ResultPage无双端消费者，不放Shared。返回页嵌套投影归ToolService。
5. **入口与安装**：register将ResultService接原ToolService；tool_result_read 批次接口是模型生产者，Root/Child依原工具名单缩窄。context.read 必须由签名插件显式声明；普通安装 grants 初始为空，推荐新装可按用户确认初始化全部声明授权，升级不自动授予新能力。
6. **数据、事务与并发**：结果原文仍唯一存agent_run_tools，完成确认后才向模型投影；超过8KiB原文提供4KiB JSON编码预览（原捕获上限256KiB不变）。后续reserve同事务核对原前缀/proposals/完整确定结果，Model回调验证应用投影。续读的源SSH目标id/version进入当前结果确认事务；存储结构与签名同步，运行时不补旧值。
7. **生命周期与失败**：只能读同user/App/Run较早步骤的completed记录，hash/当前原能力/批准/目标有效性复查；context.read不能代替源操作权限。目录结果在当前选择含denylist项时保守拒绝；不存在/非确定/续读递归拒绝。offset按Unicode码点，maxBytes为JSON编码文本含引号，8–4096/default4096；完整页元数据容纳在8KiB模型结果预算。由原Run/Tool owner结算、取消和关闭，不新增后台工作或重试。
8. **当前能力与验收**：结果投影和真实工具续读源码接线；跨Run历史仍保留实际捕获正文，不能用同Run续读绕过其容量。语义检查点、Memory/Artifact已接线，正式治理、提示与结果卡片已接线，行为覆盖见 testing。

### 数据与执行配置

Memory 列表通过 Shared 可选 threadId → HTTP 白名单投影 → Service 独立 MemoryQuery → Model → storage 参数 → SQLite Adapter 接线。Adapter 在原读取事务核对 thread 属于当前 user/App，分页前通过来源 Run 的 thread_id 筛选，包含 Root/Child；无来源的记录不匹配，缺失或异 App 的线程为 not_found。不传参数仍是实际全 App 管理用途，不是旧协议兼容。候选原文、来源、状态和版本只由原事务持久 owner 修改；本次不改 schema、权限或人工审核政策。

1. **职责与范围**：Memory 拥有候选、人工审核、撤销与受限 Recall；Artifact 拥有内容、元数据、引用、保留及清理；execution 拥有管理员执行设置、硬限制确认及 Run 冻结预算。原 RunExecutionOwner 是唯一模型任务 owner。各能力已有管理入口和真实消费者，源审与静态证据归 testing，行为覆盖见 testing。
2. **子功能与目录**：分别放在 Agent 的 memory/artifacts/execution 子功能，沿用 service/model/storage/adapters/sqlite。context 新增 checkpoint Service/Model/SQLite；通信入口仍集中 interfaces/http。Platform blobs 只持有不透明 key、实际字节流、文件句柄和具名技术失败，不认识 App/Run、配额或保留政策。
3. **依赖方向**：业务 Service → Model → 独立 storage/Platform → Adapter；SQL/DDL、私有行与 JSON 解码留 Adapter。execution 的纯政策决定通过 Model 转换后的同事务事实回调执行；Root/Child、Governance 与其他 Agent 子功能直接消费内部应用契约，不绕 public 包装。
4. **类型与转换**：双端管理协议唯一归 Shared agent/{memory,artifacts,execution}；应用对象分别归所属 model，独立存储对象归 storage。HTTP 与 Model 分别白名单转换全部嵌套对象。摘要正文与内部来源快照没有新增公开对象；能力基础值包含 context.compact、memory.read、memory.propose、artifacts.read/write，这些能力仅由签名插件包声明，初始 grants 为空。
5. **入口与安装**：register 安装管理 HTTP 和 memory_propose/recall、artifact_create/read/present、file_deliver、context_checkpoint 真实模型工具；Bootstrap 安装原 Access 提供的事务身份 reader，并创建数据库同路径派生的专用 Artifact 内容目录。核心 SQL 仍归所属 Adapter；后续结构与数据变化按变更逐条新增迁移。
6. **数据、事务与并发**：Memory 提案来源、审核 CAS 在原写事务核对；期限使用实际读取后的时钟，审核耗尽版本拒绝递增；跨App记忆导入的路由、用例、存储及快照声明已移除，不保留兼容入口。持久/Shared解码一致校验创建、审核和到期关联。Artifact SQL 预留、文件独占写入/发布和 SQL 确认分别有完成判据；上传/删除领取前预留最终结算的版本空间，批量清理先验证完整计划，确认期限在实际读取后复查。删除先持久 claim，实际文件删除与结算均确认后才归还额度。硬限制 preview/confirm 在真实存储事务读取事实后取时钟，期限由 Service 决定，校验、updatedAt 与单次消费共用该次时刻；耗尽版本不递增。Root 创建同事务冻结设置，Child 同事务复制 Root 冻结模型及不可变执行设置；模型与工具准入读取全族账本，模型预算按已报告input/output usage核算，未报告保留reservation，确定未派发失败计0；不改写原预留记录，不冒充精确账单。
7. **生命周期与失败**：所有管理任务归 AgentRequestOwner，模型/工具仍归原 Run owner。持久语义检查点绑定实际模型输入 hash 和完成工具；下一轮保留原用户请求及完整当前交换，预留事务重新验证摘要来源。未知提交不补写、不重派，导入/清理确认只消费一次；结果未知按预分配资源身份只读核对。内容流覆盖全部 yield、取消和 close，读取期间不允许清理对应文件；未确认文件/句柄清理保留资源与容量归属。
8. **当前能力与验收**：Memory/Artifact、语义检查点、执行设置、Operations 日志/审计/通知与宿主诊断源码已接线；执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 正式前端已接线，行为证据见 testing。

执行设置正式前端已消费独立四HTTP及完整Shared响应codec；独立 Profile 类型、HTTP/持久文档、前端编辑与模型目录请求全部删除。Child 继承 Root 冻结设置，Shared 最大请求容量同时约束 SQL CHECK 和持久解码。业务准入、实际工具集合、版本、占用及确认期限仍归ExecutionService和原事务；本批没有将应用类型下沉Shared或Adapter。正式 Agent Host 已接当前 Shared。

### Run 目录

`agent/service/agent-request-owner.ts` 负责模块请求准入/停机排空（最多64个在途请求）；`runs/service/run-execution-owner.ts` 是唯一进程内模型执行任务 owner；RunService 编排用例，Model 转换存储/技术请求及结果。`runs/model/run-projection.ts` 统一主 Run、事件和冻结输入的存储投影；复用应用类型归 `run-types.ts`。

步骤契约在 `runs/storage/run-step-storage.ts`，事务和行/JSON 解码在 `runs/adapters/sqlite`；`run-step-model.ts` 持有步骤转换。`run-model-stream.ts` 把技术流转成应用增量/终态/安全失败。OpenAI SDK在 `platform/ai/adapters` 内发送模型请求并解码SSE，原技术Port不含SDK/Run/用户/业务授权类型。

### Provider 与 Registry 目录

`agent/providers/{service,model,storage,adapters/sqlite}` 持有配置与秘密；Provider规范化和冻结资格归`provider-rules.ts/provider-capability-rules.ts`，Service及Run事务回调消费纯规则；Model只做事实转换。`providers/registry/{service,model,storage,adapters/sqlite}` 持有目录刷新、缓存与解析；Registry Service决定快照生成时点、缓存损坏恢复和别名冲突，纯规则在`registry-rules.ts`；Model从技术结果投影独立RegistryCatalogEntry，从存储投影snapshotInvalid事实。HTTP 统一在 Agent `interfaces/http`。`platform/ai` 提供通用模型/目录技术契约及 Adapter；不持有用户、Run 或授权政策。

### Run 执行流方向

HTTP → Shared codec/HTTP mapper → RunService → RunModel/RunStepModel → storage → SQLite Adapter。首次创建提交后，RunService 调用 RunExecutionOwner；owner 通过 Model 读取冻结、获取凭据、复查 Provider，保留/确认派发后消费 RunModelStream → ModelNetworkPort → 网络 Adapter。重放和重启不启动新请求。

reserve/dispatch 的事务回调由 Model 将独立 frozen/Provider 存储事实投影成应用类型，再调用纯业务规则。Storage 负责同事务读取和写入，不持有授权策略。当前规则和流入口只接受 governed，并核对实时 Provider 与原 Run 权威；配置存在、测试成功或手工步骤记录都不能授予执行权。

### Provider 调用链

HTTP → Shared codec → HTTP mapper → Provider Service → Model → storage/AI Port → Adapter。SQL 行在 SQLite Adapter 解码；厂商 `/models`、SSE、models.dev JSON 在网络 Adapter 解码；Model 逐字段转换应用命令、记录、技术结果及失败。Run 的同步冻结回调由 Run Model 持有，Adapter 只接收 storage 契约。

### 模型流表示

应用类型唯一归 `runs/model/run-types.ts`；存储命令/记录归 storage，第三方流契约归 Platform。Model 明确逐字段投影，包括同步事务回调的输入。Adapter 校验持久 JSON、模型 ID 与能力快照一致性，业务资格判断留应用规则。

Shared Run 子域持有主状态/事件、步骤状态/事件基础取值、2 MiB 正文容量，以及严格路径/分页/响应 codec。只读步骤公开投影提供状态、版本、用量和文本字节数；原始增量、prompt、冻结配置、凭据、技术 cause 不公开。现有 DEV transport 严格解码 wire，controller 再投影独立应用状态。

### Provider 类型与转换

应用类型分别在 `providers/model/provider-types.ts`、`registry/model/registry-types.ts`；存储类型各在 storage，技术类型在 Platform。Provider/Registry错误码、步骤状态/事件与失败码取值归Shared独立values，存储只引用基础取值，不能借用Shared对象。通用网络失败由`providers/model/provider-network-failure.ts`唯一转换，两个Model共享，原始cause不公开。内部 HTTP 协作接口 `providers/model/provider-api-types.ts` 不作跨模块出口。冻结输入仅由 Run Model/Service 内部读取，不放 Agent public。Provider 输入/视图、能力基础值及完整请求响应归 Shared；Run 的模型引用必填。

### Run 安装边界

register 安装一个 RunModel、RunStepModel、RunModelStream、RunExecutionOwner 和 RunService；ProviderService 在配置提交后通知该执行 owner 中止对应请求。AgentRequestOwner 先停止准入，quiesce Run/Provider/Registry，再等待已准入请求、实际Registry刷新和各资源close，SQLite最后关闭。Provider端点发现也纳入同一取消owner；Provider close独立等待其持有的网络Promise并有界保留多项清理失败，模块停止及关闭逐项执行，同步抛错不跳过其余资源；Registry最后一个HTTP订阅者离开不解除实际任务追踪。初始化在迁移后 reconcileUnsettled，不重发已派发请求。

状态 HTTP 统一经异步交付检查复核管理员会话，创建/取消的结果映射只负责状态码与白名单响应；交付失败不撤销已提交写入。保留创建/查询/取消/主事件 HTTP；专用步骤审计 HTTP 已移除。没有公开执行启动/步骤写入接口。DEV 页与正式 Host 均消费模型候选、必填模型三字段及 Run 状态。

### Provider 安装与接口

register 安装 Provider/Registry/Run owners；管理员接口前缀 `/api/v1/agent/ai`，含 Provider CRUD、models、端点/保存配置的发现、test、model-registry 查询/resolve/refresh。PATCH 为 `expectedVersion` 加部分字段；省略字段保留旧值。Provider身份来自Access；各管理接口在异步读取/写入之后、结果交付前复查身份，撤销后不发布结果；写入已提交但交付失败不证明回滚。query契约及容量归Shared严格codec。 Provider自身在途任务覆盖网络、授权/配置复查及发现结果持久化，停止准入后仍等待读写收口；清理失败与关闭期间的存储/内部故障有界保留，同一失败不重复登记。

### Run 状态提交与恢复约束

完整 Run、事件与步骤账本由所属 Adapter 安装；各模块仅编排初始化及迁移接口，Bootstrap 汇总版本。迁移与版本 marker 同事务提交，提交未知先核对持久结果。

reserve/dispatch 同事务校验主体、App、Run version、step revision、请求 hash、冻结政策和当前 Provider 版本/凭据代际。dispatch 同时写 running、run.started 和 dispatched；finish 同时写主子终态、版本及事件。文本/usage 写入须持有 running 和有效 CAS。取消先持久围栏，再 Abort。

Run 用量通过认证 GET `/api/v1/agent/apps/:appId/runs/:id/usage` 只读获取。RunStepStorage 的 SQLite Adapter 单语句按 user/App/Run 限定当前任务与直接子任务，聚合持久步骤的 input/output、已报告请求数、模型步骤数及工具数；未报告为 null，不推算缓存命中率。Model、Service、公开出口和 HTTP mapper 各持原边界职责；响应携带同一 SQL 快照的 Run 版本，无表结构变更。

恢复仅将 reserved 归 failed/DISPATCH_NOT_STARTED、dispatched 或孤立 running 归 unknown；主子状态、版本、hash 和事件数量不合法则拒绝并保留现场。unknown 主 Run 保持活跃直到显式取消；已终结 unknown 步骤后取消主 Run 允许主版本多一。均不自动重放付费请求。

### Provider 事务与冻结

Provider模型配置的逐字段capabilitySources与能力值一起写入原models_json和同一版本CAS；协议、应用、存储和前端草稿分别白名单复制来源，来源基础字段/有限值归Shared providers/values。来源为可选配置注释，未注明的显式配置值为manual，registry/provider仅表示赋值来源，不能授权或证明实时能力。Provider观察对象明确排除capabilitySources；实际模型网络请求仍只映射能力值。输入/存储解码同时验证来源有限值、字段白名单及来源对应能力值存在；界面手动赋值、模型库补全/重置和应用观察在原赋值owner同步来源，不通过全局watch推测。不更新表结构或自动迁移/重写旧数据，无法恢复未记录的历史来源。

第一版初始化直接创建 Provider、Registry 与冻结输入表。配置更新 CAS 增加 version；替换/清除/删除凭据增加 credentialRevision。Run、冻结输入、初始事件及幂等记录同事务写入；Model 回调从存储记录投影应用事实并判断，结果再投影为存储命令。重放先返回原结果。冻结包含端点、协议、模型能力和原凭据代际，不含密钥；已变配置或凭据不能以新秘密替代旧引用。删除关联 active `pending/running/unknown` Run 的 Provider 返回冲突。观察数据失效与删除准入由 Provider 纯规则决定；Adapter 在同一事务读取当前配置或去重的 Run 状态，Model 显式转换后调用同步规则，再由 Adapter 执行存储任务。CAS/关联读取与写入保持同一事务，Adapter 不定义业务状态筛选政策。

### 增量执行流生命周期

Run owner 在持久创建前按已保存并发配置保留本机准入，计入在途创建与资源清理失败任务；默认预算4/2和默认硬限制8/8不变，不另写死8个尝试门槛。64个在途写入属于该 owner 的私有排空预算。拒绝关闭/满额请求不先创建 Run；合法幂等重放不占新尝试。尝试使用创建时冻结的 deadlineAt（默认任务期限30分钟，受配置与 App 覆盖约束），本地 Abort 不能证明远端停止或计费结束。quiesce 拒绝新请求并中止任务；close 共享 Promise，等待已准入写入与任务结算，有界保留 32 个失败及超量计数。清理失败任务不提前释放名额。

Provider 配置提交后中止本进程关联请求；获取凭据后、dispatch 返回后及发布每个模型事件前复查当前 Provider，复查 await 后检查 Abort。跨进程配置变更以重新读取发现，不宣称网络副作用与配置更新具有跨系统原子性。未派发失败与已派发 unknown 分开，SQLite 写入异常不误归网络失败或重复补写；双重失败保留 AggregateError。

技术 Adapter 持有响应体、reader 和迭代器清理，取消失败仍尝试 releaseLock，异常 cause 留内部。ModelResponseBody独立观察reader.closed；cancel拒绝仅在与已errored reader的原始错误为同一对象时视为重复读取错误，不再虚报cleanup_failed；底层cancel拒绝与releaseLock失败仍保留。Run在辅助资源排空阶段失败后独立尝试主步骤unknown CAS，原步骤未知提交异常不进入此补写路径；标题清理和终态结算双失败保留全部因果，聚合诊断沿原有限错误码投影。Registry下载同样保留清理失败；Provider/Registry在清理失败后拒绝新网络工作并在模块close上报，Registry无人订阅后的持久写入失败也保留并阻断重试。Model 等待技术迭代自然退出及清理完成后才发布唯一 finished/stop；缺失/重复终态、断流、拒绝/工具输出、未知事件、空正文和不一致快照都不能成功。Provider probe 与 Run 共用SDK请求和事件投影，前者仍受 512 KiB/16 token 限额，不授予执行权。

OpenAI官方Node SDK处理SSE换行、分帧、JSON和DONE，项目不另写SSE解析器。ModelSdkRequest在SDK解码前有界读取并严格验证UTF-8，网络总量8MiB、正文总量2MiB独立限制；ModelStreamProjection验证SDK保留的event名称与载荷，并限制解码后普通事件JSON为128KiB、Responses重复完整内容的done/completed快照为8MiB。SDK忽略的注释和分隔符仍计网络总量，不再声明独立注释帧上限；正式终态和SDK迭代正常结束共同确认完成，不自行要求可见的DONE事件。

ModelSdkRequest 只按 SDK APIError 的结构化 moderation_blocked/content_policy_violation 精确 code 将拒绝归为技术 content_filtered；Provider Model 显式转成已有 PROVIDER_CONTENT_FILTERED，Run 继续投影 model_content_filtered，设置和聊天沿用原失败展示入口。未知 code 保留原 HTTP 分类，不按 message 或审核正文推断。原 cause 留内部，日志与协议不公开原始供应商正文、提示词或审核分类；图片仍不重试；文本开流前已确认的明确拒绝按failed结算，半流或结果不明仍保留unknown。

### Provider 生命周期与失败

Provider 外呼完整期限 10 秒，Registry 刷新 15 秒；真实 fetch 支持 Abort、有界读取及拒绝重定向。允许管理员配置的 HTTP(S)/内网端点，额外出口隔离由部署承担。更新/删除中止本进程相关请求；外呼前后及观察写入前复查配置、凭据与身份，CAS 拒绝陈旧回写。Registry 请求 single-flight，各订阅者独立取消，最后订阅者退出中止底层任务；新请求先等待已取消任务及其存储写入收尾，再共享新刷新，避免旧失败覆盖新成功。缓存 JSON 由 Registry SQLite Adapter 解码为独立 storage 快照，Model 经 registry-projection 双向白名单转换；损坏缓存由应用层报告不可用，不影响后续刷新。精确的 provider/modelId 条目优先于短名称别名。测试传递模型推理参数并校验两种协议的 SSE 终态；缺省 usage 不补零。 Chat Completions的native_finish_reason仅接受string/null元数据，不替代标准finish_reason；reasoning_content仅接受string/null，按原MODEL_REASONING_MAX_BYTES累计字节约束，不进入可见正文、历史或工具授权。真实文本/工具、标准终态、SDK正常结束、usage和拒绝/未知输出校验仍保持。 Run 创建/追加的 ModelReference 可携带本轮 reasoningEffort，Provider resolveFrozenModel 在创建事务中检查等级属于当前模型声明、强制思考不允许 none、Images 不接受覆盖；生效值写入原冻结 capabilities.defaultReasoningEffort，沿 RunModelStream 转为 Responses reasoning.effort 或 Chat Completions reasoning_effort，Child 复制父冻结输入。选择加入创建命令hash，默认与显式等级分别绑定幂等意图；无新增配置写入或表结构。Model 将技术错误转具名应用失败并保留 cause。提交未知保留 operation_unknown；响应总预算 8 MiB，超限返回 limit_exceeded。应用/存储时间为毫秒，Registry 对外 Unix 秒由 HTTP mapper 转换。

### 原生工作区会话入口

1. **职责与范围**：Scope 的 WorkspaceService 复用原 Scope/Thread/Provider/Run/Context/Governance 用例，供原生会话与插件入口调用。插件 owner 仅持有插件安装与短期 grant 授权，通用工作区不反向依赖插件私有应用类型。
2. **子功能与目录**：scope/model/workspace-types 持内部命令/结果，scope/service/workspace-service 持用例派发；ThreadService/Model/SQLite 持当前入场事实、转换及实际事务。interfaces/http/workspace-http 与 workspace-mapper 持原生协议及唯一双向白名单。
3. **依赖方向**：原生 HTTP → Scope Workspace/Thread → 各真实能力 owner；插件 RPC → 原插件授权 → 同一 Scope Workspace。Platform 仅提供事务与准入机制；不包含 App 或 grant 类型。
4. **类型与转换**：Shared scope/workspace-http 与 workspace-http-codec 唯一定义通用18方法及严格解码；插件 frontend-events 组合该联合与自身九方法，不复制定义。新增 agent.threads.delete 仅接受 {threadId,expectedVersion}，返回 {appId,threadId}；HTTP workspace-mapper 逐字段转换独立应用命令和 DeletedThread 结果，codec 关联方法、线程及原生外壳的 App/version。ThreadAccess/事实使用 plugin/session 可辨识联合；原生使用真实 App version，不填写 installed/trusted 或虚构 grant。
5. **入口与安装**：POST /api/v1/agent/apps/:appId/workspace 要求当前完整管理员会话、真实 App UUID、appVersion 和 request。register 安装事务身份读取及原生路由；插件继续走原 descriptor/grant 入口。正式Host与DEV原生线程／运行消费者均使用该入口，正式Host不借用插件grant。
6. **数据、事务与并发**：原生当前会话、App 所属用户、启用/受信声明及原 App version 在实际事务前后核对；Thread 创建/改名使用稳定 operationId 与不可变回执，改名和删除绑定原线程 version。删除由 ThreadService → ThreadModel → SqliteThreadStorage.remove 执行：Adapter 在同一写事务读取全部 Root/Child 的不同状态和关联 Memory 最大版本，Model 白名单转换 ThreadRemovalFacts，Service 同步拒绝任何 pending/running/unknown（active_run_conflict）以及记忆版本耗尽（version_conflict），并提供事务实际决策时的更新时间；Adapter 不选择业务准入状态。事务依次将关联 agent_memories.source_run_id 置 NULL、版本加一且时间不倒退，删除线程或 Run 的 artifact attachments，显式移除 agent_run_children / facts / mailbox / budget_reservations 的 NO ACTION 引用，再删除全部 Run；步骤、事件、工具体、Job、审批、上下文及幂等结果按真实 FK CASCADE。协作表同时覆盖 operation_id/message_id 对待删工具的引用。最后删除该线程的 agent_thread_commands，并以 user/app/thread/version CAS 删除 agent_threads，提交前复核原身份/App。任一步拒绝或失败均回滚，不关闭 FK、不依赖延迟约束；Artifact 对象元数据和文件均不删除，Memory 正文及审核状态保留。删除不递增线程版本，允许最大安全整数的当前 CAS；不新增 schema/旧库兼容。组合调用经 ThreadModel 的事务准入能力消费同一规则，不在接口层复制 SQL 或业务判断；后台执行仍由原 Run owner 明确脱离临时请求准入并持续复验自身授权。
7. **生命周期与失败**：Scope 入口和交付前保留当前事实复查；已成功写入后交付或复查失败返回 operation_unknown。删除也纳入原生 HTTP、插件 Service/HTTP 及交付 SDK 的写入分类：没有 operationId 仍是副作用，取消/超时/畸形或错 App 回执不能解释成未提交。读操作不授予执行权限；读列表不证明未知写入未提交。删除没有额外幂等回执或墓碑，确认后再次删除返回 not_found，不自动重放旧创建/改名或套新版本重试；未知结果保留原 threadId/expectedVersion，先只读核对。完整工作区编码预算8 MiB+1 KiB，Thread 列表最多50项，正文页遵守各自更窄预算。资源已销毁时不继续接纳新的请求步骤。
8. **当前能力与验收**：原生18方法生产者及Shared已接线；正式Host/Run/正文/审批/Child的原消费者和独立应用转换保留，正式删除 UI 已接入，步骤／工具专用审计 HTTP 已移除。删除验收覆盖严格请求/回执关联、原线程/App CAS、Root及Child三种活跃状态、关联记忆版本耗尽、提交前撤权/末步SQL失败整批回滚、工具/审批等级联、记忆/Artifact保留、其他线程隔离和 foreign_key_check。当前限定隔离 SQLite 实测不代表浏览器/插件整链已验收；真实并发、提交/交付确认丢失及资源清理故障仍待对应远程或现场验证，不沿用旧 Actions PASS。

### 模型目录名称与能力解析

1. **职责与范围**：Agent providers/registry持有模型名称匹配及明确模型修正，Platform仅转换models.dev供应商事实。
2. **子功能与目录**：原registry-rules组装快照与解析完整能力，registry-matcher持纯名称评分；原Model、SQLite Adapter及HTTP mapper保持各自边界。
3. **依赖方向**：Registry Service → Model/纯规则，Model → storage/Platform；匹配器不读取网络或存储，不绕过Provider冻结时观察冲突核对。
4. **类型与转换**：RegistryDefaults、StoredRegistryDefaults和Shared AgentRegistryDefaults独立定义完整能力；白名单mapper投影缓存键、默认推理等级及必需推理，两个decoder核对等级唯一性、默认值所属及mandatory依赖。
5. **入口与安装**：沿用model-registry/resolve与refresh，无新路由或安装点。
6. **数据、事务与并发**：内部快照 schemaVersion=2，仅保存 provider/model 键，不生成丢失来源的裸别名；旧快照通过原缓存无效机制提示重新更新，不自动迁移。精确名优先于前缀/分隔符及系列日期/等级/thinking/fast后缀，同级冲突不猜测，OpenCode聚合候选不覆盖原厂。名称变体不构成能力证明；只对支持的等级后缀选择默认等级。保留旧正式resolver的明确模型缓存键与推理修正。
7. **生命周期与失败**：沿原refresh/load owner、取消及安全错误映射；无目录或无明确匹配返回null，不自动发起外部模型请求。
8. **当前能力与验收**：前端新增模型与显式应用目录均消费完整Shared能力；使用与恢复见USAGE，静态及限定只读验证见PLAN/testing，完整交互仍待远程。

### 图片生成与模型预算

1. **职责与范围**：Provider/Registry 保存声明能力，文字预算可缺省；Run 持文本执行预算。ProviderImageService 统一直接 Images Run 与图片工具的网络生成、App 文件落盘及安全结果。
2. **子功能与目录**：原 providers/service、platform/ai/adapters/model-image 与 openai-compatible；RunExecutionOwner 持直接派发，原 ToolService 持 image_models_list/image_generate，Artifact 原 owner 持输出。
3. **依赖方向**：Run/Tool → ProviderImageService → ProviderService/ArtifactService；Model/技术 Adapter 各自投影；不从网络 Adapter 写数据库或绕过 Run 派发记录。
4. **类型与转换**：Shared 的 images 协议、supportsImageGeneration 与可选文字预算同步应用/存储/SQLite/前端；新 ProviderImageRequest/ImageArtifact 留 providers/model。Artifact 的 model actor 与独立存储授权逐字段转换，不伪造工具授权。
5. **入口与安装**：原模型选择器同时消费 Images；配置分对话/图片两组。图片工具由原 toolDefinitions 安装，需原 artifacts.write/批准。新增 GET /api/v1/agent/apps/:appId/artifacts/:artifactId/preview，复用认证下载读取与 Range，限定 PNG/JPEG/WebP/GIF、nosniff、private/no-store。
6. **数据、事务与并发**：直接图片沿模型 Step 的 reserve/dispatch/finish 与原请求/并发预算；工具沿 ToolCall 账本和原工具预算。Artifact 写事务核对 Images frozen protocol、原 dispatched Step/hash、当前 Run 与 Provider 代际。图片输出继承原文件预算/期限，不冒充网络与 SQLite 原子事务。
7. **生命周期与失败**：Provider请求跟踪及停机/配置修改取消覆盖图片请求。正式直接Images与image_generate统一继承Run剩余绝对期限，ToolService不为image_generate另设普通工具短超时，ProviderService该入口不再添加固定五分钟计时；网络生成、文件发布和后续验证共同消耗同一任务时限。管理图片测试仍独立五分钟，发现等管理读取仍十秒。Platform仅为图片ModelSdkRequest建立独立Undici Agent，其它请求保留原连接池，headersTimeout/bodyTimeout为0，由原应用signal控制完整等待（连接建立仍受传输自己的连接时限）；close分别尝试reader与dispatcher.destroy，保留独立失败和原错误身份，不使用全局连接池修改。外部 JSON 与 base64 有界读取；不获取返回 URL，不接收 SVG/HTML。付费请求未知或落盘失败不自动重试；本地取消不证明供应商回滚。全局日志不记提示词/图片/凭据。
8. **当前能力与验收**：一次一张、按Artifact剩余空间与Node字符串/Buffer技术容量约束、供应商默认尺寸/质量。直接图片只用本次描述，文字工具可传 Agent 整理的描述；不接入编辑、视频、音频。前端 Markdown 仅允许受保护的本站预览图。静态、目录、隔离HTTP及真实CDP验收的环境、入口与保证边界分别见 testing；编译不替代真实图片生成或完整治理回归。

### 供应商流的可选字段

Platform AI的ModelStreamProjection消费SDK已解码事件，持有Chat Completions的nullable拒答/工具占位、reasoning_content/reasoning有界文本和native_finish_reason元数据校验；只有带合法finish_reason的终帧允许delta为null。普通思考不作为答复或执行许可，真实拒答及未知输出仍拒绝。累计usage在Projection保存单调最新快照，于SDK迭代结束且正式终态校验后仅交付一次原usage事件，RunModelStream和probe继续只接收一次真实用量；缺失不补零。ModelToolStream只允许已登记工具调用的后续身份字段为null，首帧仍须完整ID/type/name，后续非空身份不一致拒绝；参数null不追加字符。Responses续接证据仍沿原独立校验，不与普通思考混用。模型发现nexus_capabilities支持已有supports_image_generation字段，应用/Shared转换不变。

### OpenAI 官方 SDK 技术边界

1. **职责与范围**：Platform使用官方openai@7.43.0完成Chat Completions、Responses、Images和模型发现；Run业务权限/预算/审批/持久结算不交给SDK。
2. **子功能与目录**：原openai-compatible组合SDK资源方法与技术结果转换；model-request构造具名SDK请求；model-stream只投影已解码事件；model-sdk-request持一次操作的SDK实例、原始响应reader和清理；model-tool-stream及model-reasoning保留工具/续接事实校验。
3. **依赖方向**：应用Model→原ModelNetworkPort→Platform Adapter→OpenAI SDK；SDK类型只用于技术Adapter，不能进入Shared或应用/storage。
4. **类型与转换**：SDK类型不能代替外部运行时校验；事件/模型/图片在Adapter以unknown检查实际消费字段并白名单投影。标准可选字段不作每帧必填，额外choice元数据有界忽略，拒绝未知执行输出。
5. **入口与安装**：原Bootstrap安装不变，使用client.chat.completions.create、responses.create、images.generate和models.list；流通过公开asResponse及SDK Stream.fromSSEResponse保留事件名，模型测试复用同一路径。models.list只取当前响应，不迭代自动分页。
6. **数据、事务与并发**：不改变表或Shared契约；SDK不管理工具执行、幂等记录或授权。请求由SDK编码，派发前限制实际编码字节，模型声明和工具/正文/续接容量保持原owner。
7. **生命周期与失败**：文本流及probe的maxRetries=2，发现/图片为0；退避/Retry-After由官方SDK负责。仅已收到的429明确限流拒绝可沿SDK退避，所有其它HTTP状态强制禁止重试；连接无响应、TLS和本地失败中止专用signal。408/409/5xx及缺失响应可能隐藏已接受的付费请求，不能重放，也不能因后一次拒绝抹除前一次未知。成功响应后不重试SSE/投影失败；应用持原完整期限，所有尝试共用累计响应字节预算。同一逻辑模型步骤最多3次HTTP派发，不重放工具。logLevel=off、拒绝重定向，原AbortSignal与本地停止重试signal组合并传给SDK；原始fetch只用应用signal，避免停止SDK重试时先破坏尚待排空的reader，传输总期限仍归应用。禁用环境organization/project自动继承，无凭据时移除占位Authorization。每个响应有独立ModelResponseBody、reader/decoder和关闭Promise，SDK重试前重新等待上一响应关闭；清理失败阻断下一次派发，不能覆盖旧资源。Reader按需读取，总量在SDK缓冲/JSON解码前检查；关闭Promise在取消前保存，SDK忽略的传输或清理失败仍由原owner记录并在close抛出，不提前交付completed或释放Run名额。不证明远端停止，不自动重放已取得成功响应的请求或未知Run。
8. **当前能力与验收**：迁移进度/静态证据和远程待验见PLAN/testing；UI不变；原生浏览器增量更新由下述Run变更订阅负责，SDK的供应商SSE与浏览器WS分属不同边界。

### Run 正文与状态流

1. **职责与范围**：原生对话通过WS直接消费已提交正文增量和状态；RunChanges用Node EventEmitter唤醒交付，Run日志仍为持久权威，不直接转发供应商SSE。首次/显式读取保留HTTP，生成及重连续传不逐段HTTP请求；ACP保持。
2. **子功能与目录**：RunChanges在原Run/Step/Tool/Collaboration/Governance写入收敛后区分text/state通知；RunStreamService组合原Context/Run等读取，正文热路径只读正文页。interfaces/ws持认证、游标和发送窗口，run-stream-mapper复用原HTTP投影的唯一owner。
3. **依赖方向**：写入Model→RunChanges；WS→Thread准入→RunStreamService→同模块既有Service→各Model/Storage。SQLite不反向调用应用，Platform只持WS句柄与真实排空。
4. **类型与转换**：Shared runs/events持订阅/ACK/更新、前后游标与严格codec，runs/values持独立命令和完整输出预算；内部RunStreamCursor/Page/State/ChangeKind归runs/model。入口与出口逐字段映射，不透传Storage/供应商对象。
5. **入口与安装**：/ws/agent-runs升级需原来源/Origin、管理员、当前启用受信版本App及可见Run；客户端subscribe给出Thread和正文/事件游标，首次状态页核对Run所属Thread。每批交付前后和心跳期复核原持久会话/App准入。
6. **数据、事务与并发**：无新表。先订阅再首次读取，写入通知在原存储调用收敛后发出，unknown不重派。正文/状态变化约16ms合并，读取中dirty保持；状态及用量/审批/子任务独立于正文热路径，终态后再读正文并持续至空页。发送游标与客户端已接纳游标分离，连接内按发送游标连续推送，重连从客户端已接纳游标恢复。
7. **生命周期与失败**：最多16页且累计不超过完整输出预算的未ACK窗口，满额暂停到ACK，容量不是Run失败条件；大状态页等待先前窗口排空，心跳另留1KiB传输缓冲。ACK按序、60秒期限，订阅首帧15秒，心跳15秒/权限复核3秒；心跳不查询Run/正文。关闭取消计时、退订并等在途短读取，RunChanges纳入AgentRequestOwner停机资源，Platform等真实WS排空。隐藏、断线或关闭不取消Run，不重发模型。
8. **当前能力与验收**：状态/正文/用量/审批/子任务均有直接推送消费者；记忆审核和插件SDK独立订阅保持原行为。命令1KiB，完整输出按审批8MiB、正文512KiB、事件32KiB、独立的子任务元数据编码容量及8KiB封装，合计按runs/values公式计算；客户端单帧/待接纳窗口和后端发送预算同源。源码与静态证据见PLAN/testing；未以编译代替实机弱网、权限/版本撤销、停机及E2E验证。

### 对话正文反向分页

1. **职责与范围**：Context提供最近正文页及指定位置之前的连续片段，支持原生会话按需上翻；不改模型上下文、日志持久化或WS前向续读。
2. **子功能与目录**：scope WorkspaceService分派history；context HistoryService校验、Model白名单转换；ContextStorage/SqliteContextStorage归存储边界，thread-entry-sql持有查询与片段解码。
3. **依赖方向**：原HTTP/插件RPC → Workspace → Context Service/Model → Storage/SQLite；Adapter不引用应用类型，入口/出口唯一mapper留interfaces/http/workspace-mapper，插件SDK同样检查App归属。
4. **类型与转换**：Shared AgentThreadEntryHistory持body/startCursor/hasEarlier，应用ThreadEntryHistory和StoredThreadEntryHistory独立；每层按字段及嵌套cursor/items转换。textOffset为Unicode码点，startCursor指本页首片段之前，body.nextCursor可直接用于原前向entries/WS。
5. **入口与安装**：在原workspace方法联合增加agent.threads.history，before=null读取最新页，否则读取原游标之前。沿原管理员/持久会话/启用App版本准入、用户与App/Thread归属；缺失仍not_found，无新增公开路由或历史兼容入口。
6. **数据、事务与并发**：原只读事务确认Thread并取正文；先按位置倒序选limit+1条元数据，再读取本页正文，返回正序。复用16片段/每片4096码点与16KiB/完整512KiB容量；最早记录若只返回后缀则停止，不跨过其未读前缀形成缺口。下一页从startCursor读取，hasEarlier由额外记录或未读前缀判定；无表结构/迁移变化。
7. **生命周期与失败**：原请求owner持短读取与交付权限复核；无任务执行或写入，不取消模型、不重派副作用。技术/损坏数据失败由原agentStorage安全映射；空页保留请求边界，前端按Shared严格关联校验，不用空页猜测写入结果。
8. **当前能力与验收**：覆盖Root输入与assistant text.delta，不包含工具输出正文；工具沿原独立分页。查询只交付一页，但未测查询计划/耗时，不声称遍历元数据成本恒定；静态与生产构建、SQL/Unicode/边界待验范围见testing。

## 授权与审批基础

### 1. 职责与范围

Agent 模块的 `governance` 持有每个 user/App 的 capability grant、执行预算覆盖项与审批持久状态。它不是普通 SSH 的权限授予器；普通 SSH 仍由 Access/Targets/Remote 各自独立鉴权与管理活跃连接。授权事实仅说明 Agent 某一 capability 在指定 App/目标范围内的授予情况，**不能代替**执行时 Targets 当前身份、Tool Inspection、App 生命周期及 Run 策略检查。执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 本版没有执行模型或行为测试。

### 2. 子功能与目录

- `agent/governance/service/governance-service.ts`：用户/App 输入校验、能力定义与政策、审批构造/幂等意图哈希、关闭准入与自身在途任务等待；无无主 timer。纯政策在 `governance-rules.ts`：授权范围交集判断、grant 校验、执行预算默认/硬上限、审批过期/版本判断。
- `governance/model/governance-model.ts`：应用 Grant/政策事实/Approval 与 storage command/record 的显式转换；适配同步应用回调及技术失败；`model/governance-types.ts` 独占内部授权事实与审批命令。
- `governance/storage/governance-storage.ts`：狭窄持久记录与同步回调接口，不携带 Shared DTO。
- `governance/adapters/sqlite/{governance-schema,governance-row,governance-sql}.ts`：初始化 DDL、严谨行/持久 JSON 解码、SQLite 事务、CAS、失效与审批决议。技术操作、SQL/事务不外泄至 Service。
- `agent/interfaces/http/governance-http.ts`：安装真实 HTTP 路由与参数白名单、登录验证、Model→安全 wire 投影。未发现独立的旧审批命令 WS；旧通知是从持久 Run `approval.requested` 事件投影到 Notifications，不在本批虚构新的审批 WS 指令/通知通道。

### 3. 依赖方向

`registerAgent` 装配同模块 `GovernanceService → GovernanceModel → GovernanceStorage ← SQLite Adapter`；Adapter 只依赖通用 Platform SQL、storage 契约与 Shared 基础有限取值。Service 只消费 Model 暴露的应用对象；同步事务政策回调由 Service 提供，Model 将 Storage 事实转换后调用，再将创建任务投影回 Storage；Model 不选默认政策或构造虚假的初始 revision。跨模块 Access 仅通过 `AccessPublicApi.authenticate`；普通 SSH 通过 Targets 自身授权；没有跨模块深层引用、全局 dispatcher 或 Platform 定义的 grant/approval 类型。后续 必须通过 Targets public 重新解析当前目标，禁止利用普通 Workspace 既有会话冒名授权。

### 4. 类型与转换

| 边界         | 类型唯一 owner                                           | 转换与实际消费                                                                                                                                                                  |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 协议→请求    | Shared `agent/governance/{values,model,http,http-codec}` | HTTP 严格读 UUID/原始类型、完整 grant/审批/执行政策字段与具名 path/header/response；Interface 将 scope 转 Model 输入，不收客户端身份或授权布尔                                  |
| DB→应用      | governance/storage、Model types                          | SQLite Adapter 校验 schemaVersion/JSON/行的有限值及状态/期限/决议/消耗关联；Model 转换 GrantScope、政策覆盖、Approval；实际 grant replace、request/resolve 回调在同一事务内消费 |
| 应用→协议    | Model / Shared model                                     | governance HTTP 白名单映射；只输出 tool 摘要、hash/版本，不输出 SQL 行、凭据/冻结输入；正式前端消费 Shared                                                                      |
| App 当前授权 | governance/model 的 `AuthorizationFact`                  | 包含 user/App/capability/connectionId/revision；不复用客户端 DTO，批准不自动授权派发                                                                                            |
| 技术资源     | Platform SQL Executor/SqliteRuntime                      | Adapter 执行事务及行解码；Policy 不由 Platform 拥有                                                                                                                             |

目标 grant 的 ssh IDs 在 Shared 协议中是长度受限文本，应用判断时严格要求规范化的正安全整数目标 ID；执行政策秒/字节/条数沿原始类型进行验证，不将 `String(value)` 后的相同文字当成有效 enum。grant 目标 ID 最多 256、单个最多 128 UTF-8 bytes，capability 取值以 Shared governance/values 唯一列表为准；审批 TTL 600 秒；grant 请求上限 512 KiB，普通 governance JSON 16 KiB，完整结果上限 8 MiB；审批 list 按ID游标每页最多64条，返回 after/nextCursor/hasMore，历史总数不截断；容量按完整 JSON 编码计算。

### 5. 入口与安装

`modules/agent/register.ts` 在 Agent request owner 中装配 governance；`bootstrap/schema.ts` 编排治理表的安装与迁移。已接线的管理员 HTTP 为 GET/PUT `/api/v1/agent/apps/:appId/grants`、GET/PUT `/api/v1/agent/apps/:appId/execution-policy`、GET `/api/v1/apps/:appId/approvals/:approvalId`、POST `.../resolve`、GET `/api/v1/apps/:appId/runs/:runId/approvals`。共享认证、CSRF/Origin 控制由新 Platform/Access 负责；治理入口使用实际 session userId=1，结果交付前再次认证。没有创建审批的客户端 HTTP 入口：审批生产者必须是 受信 Tool/ACP 过程而非客户端请求。

### 6. 数据、事务与并发

第一版创建 `agent_governance_policies`、`agent_governance_grants`、`agent_governance_approvals`、`agent_governance_resolution_keys`，引用 Agent App/Run 身份。首次 GET 不会自动批准任何 capability：revision/version 为 0、grant 空、政策 override 空。grant PUT 在同一个 SQLite 事务中查 App、读当前 policy、调用 Model 转换后的同步纯规则、CAS revision、替换所有 grant、失效 requested 审批并读取最终结果。执行政策 PUT CAS executionVersion 并推进 policyRevision/使旧待批失效；同事务读取全局 execution settings；覆盖项不能超过动态 hard limits，effective 与实际冻结使用同一执行规则。

审批请求的窄内部命令写入时读取真实 ToolCall、当前 Run 状态及 App grant，并从操作账本冻结 operationHash、policyRevision、operationRevision 对应的 inputRevision 与 TTL；Model 必须消费经 Adapter 读取的 Storage 快照，未经认证客户端不能创建。resolve 在同一事务读原审批、Run 当前 status、ToolCall 内容修订/状态及目标版本、App 当前 policyRevision 和幂等键；同步规则拒绝 stale/expiry/版本/哈希漂移；时钟在实际事务执行时读取，决议校验与 decidedAt 共用一个时刻；成功 CAS 到 approved/denied 并保存 feedback、首次事务结果快照。同键/同输入重放原始已提交结果，不从随后变化的审批行重建，不同输入返回冲突；无网络派发，不能把批准视为副作用已经执行。审批 list 先以有界数量检查总量，再分批失效扫描和读取，避免先聚合无限记录后才检查字节上限。inputRevision 已绑定 ToolCall.operationRevision，与父 Run 生命周期版本分离；消费同事务提交 consumedAt、dispatched 状态和操作事件，file_write 的实际执行/派发后复查已接线，文件/Shell/Docker突变与当前Run后台Job已接线，ACP独立权限与协作已接线，不得默许跨内容版本批准。App/Run 删除由外键回收，不在 Adapter 内藏删除准入规则。

### 7. 生命周期与失败

Governance Service 与 AgentRequestOwner 双层跟踪自身请求；停止新准入、`closePromise` 先保存，等待 in-flight 事务/请求终态，Governance 最多保留 32 个原始持久/关闭失败及额外失败计数，不使单项清理跳过其他子资源。审批 TTL 不启动无 owner 的 interval：get/list/resolve 同事务按数据库条件把到期 requested 转 expired，把已终止 Run 的 requested 转 superseded。grant 撤回/执行政策修改同事务令待批 superseded，取消 Run 持久终态后执行失效，并通过后续读取 sweep 恢复；取消已经提交后失效失败返回 operation_unknown，不能假称取消已回滚；commit_unknown 不得默认重放写入。继承取消清理只在 quiesce 后、子 owner close 开始前准入；close 开始后拒绝全部新任务。原 owner 在任务退出前记录存储/未知/内部故障，不因它们已映射为 AgentFailure 就忽略；父层聚合去除同一失败的重复引用。持久 approved/denied 的产生只是审批状态提交，在真正执行前必须重新确认当前 grants、Run、ToolCall、目标/租约及消耗状态。停机后已经派发的远端任务不得因本批 `close` 即宣称终止。

### 8. 当前能力与验收

Shared、SQLite 与 HTTP 请求/查询/变更/决议路径有源码；审批请求生产者、ACP活waiter与文件/Shell/Docker/ACP消费者已接线；安全观察采用审批HTTP/工具事件页，直接 Child/协作已接线，动态settings/预算已接入；外围资源与持久证据恢复已接线，行为覆盖范围见测试入口及 PLAN。App 唯一由真实签名插件安装创建，初始 grants 为空；插件 manifest/运行时由 Plugin owner 管理，不保留内置声明或手工创建路径。行为、取消/并发、迁移与实机权限的覆盖范围见测试入口及 PLAN。

## App 声明与目标政策

### 1. 职责与范围

Scope 拥有受信声明目录、UUID App 实例与启用状态；Governance 拥有 grants 和全局 Agent 目标拒绝政策；Runs 拥有持久取消围栏与实际执行资源。App 及声明唯一来自 Plugin 安装事务，不存在内置声明、默认实例或手工创建入口。首次目录读取为空且无写入；能力声明不代表授权，初始 grants 为空。插件包及运行时安装归 plugins。

### 2. 子功能与目录

Scope 的 service 管理受信 definition 查询、实例启停及线程用例；model 转换实例、声明与 storage 任务；Plugin Scope Adapter 在插件安装事务中创建声明与实例。Governance 的目标政策沿现有 service/model/storage/adapters 增加 denylist。Runs 的 Adapter 提供原事务取消任务；执行 owner 在提交后中止其实际持有的尝试。

### 3. 依赖方向

Service 消费应用事实；Model 转换 storage 契约和 Targets public 安全目标元数据；Adapter 不引用 Service、Model 或 Shared DTO。同数据库跨子功能写入使用各自 Adapter 的事务接口，不重复其 SQL。不借 Remote 活跃会话或普通 SSH 权限。

### 4. 类型与转换

声明来源 ID/version 是必填非空字段，与实例 UUID 分别表达；SQLite 外键绑定来源，Shared 解码拒绝缺失或 null，不保留旧无来源实例分支。Shared scope 定义双端实例、声明摘要和 CAS 请求；Governance 定义拒绝名单协议。内部对象仍归各子功能 model，存储对象仍归 storage；HTTP、public 与 Model 各自逐字段转换。能力有限值复用 governance/values；秘密、运行时句柄与安装事务不进入 Shared。

### 5. 入口与安装

注册器不注入内置声明，Plugin Scope Adapter 在安装事务中创建 App/声明及初始空政策。GET Apps/单项、PATCH enabled+expectedVersion、GET definitions、GET/PUT target-denylist 安装在 Agent HTTP；不存在 POST Apps。definitions 按已认证账号筛选当前 installed 插件。Scope 每次读取核对真实插件安装与发布者信任，无内置信任旁路。

### 6. 数据、事务与并发

相关表由所属 Adapter 安装并校验精确签名；后续结构及持久数据转换按 H-21 交付，运行时不隐式补值。声明、实例与初始空治理政策在真实插件安装事务创建；启动和目录读取不创建声明或实例；重装不重写已有授权配置；实例缺失治理政策视为完整性失败，治理读取/写入/撤销均不补建记录或返回默认政策。

同版本声明以签名包中的 id/version/displayName/capabilities 及内容指纹核对；内容变化必须推进声明版本，指纹不公开。声明更新、禁用及 denylist 变更在各自写事务内推进围栏、失效未决审批、取消旧活动 Run。治理写入/审批决议消费同事务最新声明、启用与目标政策。新实例必须绑定受信声明，不凭名字自动绑定。

目标管理先经 Targets public 获取事实，实际持久提交再核对引用和版本；审批也持久绑定目标版本。拒绝 ID 保留到显式撤销，不随目标删除自动丢失。目标集合变化才撤销旧 Run，修改原因不撤销或触发执行复查。denylist 存储与应用时间保留毫秒，HTTP 将 changedAt 转为 Unix 秒，取消围栏直接使用原毫秒。审批 capability 必填；targetVersion 的 null 仅表示真实无目标操作。全部 Agent Model 使用同一存储失败映射 owner，存储不可用、未知提交和内部失败仍由实际异步 owner 收口。

### 7. 生命周期与失败

Scope 的 enabled 只表示管理准入，executionState 为 governed，不制造 running/healthy；插件运行时初始化、资源 hook 与退出由独立 Plugin owner 管理。禁用/政策更新先提交取消围栏，再由 Run execution owner 中止具体尝试；未知提交也保守中止本地尝试，不宣称回滚或远端停止。实例/声明状态无需异步健康回写，不存在晚 health 覆盖禁用。父 owner 关闭等待已准入请求后关闭治理及执行 owner。

### 8. 当前能力与验收

源码和验证覆盖见测试入口。Tool与ACP消费者已接线；动态预算、插件运行时与正式前端均已接入；执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。实例身份使用 UUID，声明身份使用签名插件 id/version，两者不混用。

## 工具目录与执行账本

### 1. 职责与范围

首工具 machine_connection_list 提供已选中、当前授权且未被拒绝的 SSH 安全目录。RunExecutionOwner 拥有模型循环及在途任务；governance 拥有当前许可；tools 拥有服务器定义、输入校验和工具用例。旧协调器拆分不作为必须保留的设计；后续能力按实际价值重新设计，差异维护在 USAGE 与相关架构。

### 2. 子功能与目录

tools/service 持有工具定义和用例，tools/model 定义独立应用目录并转换 Targets public。runs/model 持有步骤、proposal、历史和 reasoning 应用类型；runs/storage 独立持久契约；runs/adapters/sqlite 持有步骤/工具 SQL 与 JSON 解码。governance/service 与纯规则判断只读权限，governance/model 转换事务决策，SQLite Adapter 原子提交许可。Platform AI Adapter 仅编码供应商工具声明、增量参数与技术续接事实。

### 3. 依赖方向

Root owner → tools Service → ToolModel → Targets public listEntries；Root → RunModelStream → Platform AI。tools 同模块调用 RunToolModel 与 GovernanceService，不绕公开 HTTP。技术层不认识 SSH、App 或业务能力；Storage 回调不借用应用类型。

### 4. 类型与转换

| 边界                    | 类型 owner                                | 转换 owner                | 消费者         |
| ----------------------- | ----------------------------------------- | ------------------------- | -------------- |
| 创建协议 → 应用         | Shared AgentCreateRunRequest / runs Model | HTTP/register 白名单      | RunService     |
| 模型声明/历史/提案      | tools/runs Model / Platform model-port    | RunModelStream 双向投影   | Root owner     |
| 安全目录                | Targets public / ToolConnection           | ToolModel                 | ToolService    |
| 检查、许可、结果 → 存储 | runs/governance Model / storage           | 对应 Model                | SQLite Adapter |
| 线程工具状态 → 公开     | Shared tools                              | register 与 HTTP 独立投影 | 聊天工具卡片   |

connectionIds 是必填的最多 50 个唯一正整数，空数组表示没有选中目标，选择不等于授权。modelStepIndex 公开；完整模型参数只通过单调用认证详情读取；providerCallId、原始结果正文及 encrypted reasoning 留内部。工具结果仅有 id/name/host/port/username，Targets 的 type/version 只用于内部过滤与复查，不读取凭据。

### 5. 入口与安装

Agent HTTP 的 AgentHttpInput 统一归 interfaces/http/agent-input.ts；Governance、Execution、Memory、Artifact、Integration、Browser 与 Plugin 共用输入失败转换。unknown JSON/Shared codec 拒绝先转应用 invalid_input，HTTP 保留400/413等原协议状态；Service、公开出口和Platform不引用该HTTP辅助类，原 mapper/Model 转换保持独立。

register 将 ToolModel/ToolService 注入唯一 RunExecutionOwner；目录工具参数严格空对象，诊断及文件工具使用有界字段声明，定义由服务器提供，不新增客户端检查或派发 HTTP。步骤和工具记录保留真实模型步骤，仅供内部执行、恢复与快照校验；专用审计查询已移除。DEV 创建明确传 connectionIds:[]，正式选择器与多步 UI 已消费当前协议。

### 6. 数据、事务与并发

selection、步骤创建身份/proposals、工具 modelStepIndex/result 纳入存储结构；精确签名以 `bootstrap/schema.ts` 为准。调用身份绑定 Run/步骤/providerCallId，允许供应商跨步骤复用 ID。工具检查必须匹配已完成工具轮的持久 proposal；派发意图与当前只读许可同事务。完成事务复查政策 revision 和所有已读取目标的版本，结果与事件原子提交；完成后交付前再复核。读取与结果提交不是整个目录的强原子快照，不保证新增/未读取对象的快照一致性。

### 7. 生命周期与失败

工具轮正常 EOF 与资源清理完成后只终结模型步骤；持久工具结果按 call ID 回送下一模型步骤，最终 stop 才成功结束 Root。下一步骤本地拒绝、取消或历史超限收口 Root；提交未知不猜测写入结果、不二次提交或重放。恢复检查历史步骤、活跃步骤、创建 hash 与工具账本，运行空档保守 unknown。Root owner 等待整个模型/工具过程，清理失败仍占资源名额并保留因果。只读许可不伪造审批，撤权再授予改变 revision，旧结果无法交付。

### 8. 当前能力与验收

目录首链及后续有目标只读源码已接通，两轮复审与最终静态结果归 testing。预算/上下文和 ACP 已接线；执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 实际运行尚待专项验收（见 PLAN）。步骤索引只保留正安全整数表示边界，模型请求由管理员保存的冻结任务族预算准入，不再另设400步容量；私有历史上限 8 MiB/1024 条、参数 16 KiB、结果 256 KiB。Platform 独立约束 32 调用、参数 128 KiB、网络/请求 8 MiB、正文 2 MiB、reasoning 1 MiB。Chat 支持首片完整身份及后续参数增量，拒绝身份冲突；不承诺所有供应商碎片变体。Responses 续接保留加密 reasoning，不静默丢弃。USAGE 对应 Agent 后端章节，行为覆盖及待验范围见测试入口。

## 有目标只读能力

### 1. 职责与范围

Agent tools拥有模型工具定义、严格输入、当前授权及持久反馈；Remote提供独立短任务的远端诊断和文件读取/列表/字面量内容搜索。不借普通Workspace会话、用户令牌或附件。旧diagnostics混合目标身份与宿主数据，新v2明确远端指标（generatedAt毫秒、CPU百分比、内存/磁盘bytes、1/5/15分钟load），同一采样key双采样取得CPU差值并在finally清理状态，宿主诊断已归System diagnostics并由ToolModel转换消费；旧任意正则搜索改为字面量，差异维护在 USAGE。

### 2. 子功能与目录

tools/model/tool-types持有声明字段、输入联合、目标及读取scope；service/tool-input从unknown严格解码；RunModelStream转换声明字段为Platform有限schema。Remote machines/model/operation-types持有读取应用事实，machines/service/operation-service拥有所有独立短任务；files/service/file-inspection持有路径、UTF-8读/目录/内容搜索政策，复用FileModel和ObservationModel。不新建SQL表或迁移版本。

### 3. 依赖方向

Agent ToolService→ToolModel→Targets public/TrustedSshTargetResolver；Run 的 ToolRemoteModel→Remote public RemoteMachineOperations。Remote operation-mapper转换public与内部应用；RemoteMachineOperationService→Files/Monitoring Model→共用Platform。Bootstrap只装配正式register/public，Platform不引业务类型，Agent不深引用Remote私有实现。

### 4. 类型与转换

| 边界                  | 类型owner                                                                   | 转换owner                               | 实际消费者                              |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| 模型JSON→用例         | tools Model ToolInput                                                       | tool-input严格字段/整数/UTF-8解码       | ToolService                             |
| 应用声明→技术schema   | ToolInputField / Platform ModelToolProperty                                 | RunModelStream                          | Chat/Responses Adapter                  |
| Agent→Remote请求/结果 | ToolOperationScope / RemoteMachineOperations public / MachineOperationScope | ToolRemoteModel、operation-mapper逐字段 | RemoteMachineOperationService与Tool反馈 |
| 技术读取→应用事实     | SSH/SFTP/status技术 / FileInfo/ObservationSample                            | File/Observation Model                  | RemoteMachineOperationService           |
| 工具操作→存储         | runs/governance应用 / storage                                               | 对应Model                               | tool-authority-sql                      |

工具输入/输出是模型私有契约，当前没有双端HTTP消费者，不在Shared虚构对象；真实已有安全审计继续消费Shared。基础文件kind和安全错误值引用Shared，但各层对象独立。ToolReadFailure表达预期远端拒绝，存储、未知提交及清理失败保持收口证据。

### 5. 入口与安装

Remote register暴露operations，不新增HTTP路由；Agent register接入Targets resolver与RemoteMachineOperations，由唯一Root owner消费五个只读工具及受审批file_write。新增v2诊断只需connectionId；文件读取/目录/检查使用 connectionId 与 paths[]，搜索使用绝对 path、queries[] 和可选 maxResults；分页与批次结果见 API。不沿用旧target/id或可空字段；正式工具卡片消费当前安全投影。

### 6. 数据、事务与并发

派发/复核/完成事务同时读持久selection与目标type/version；Service纯规则判定目标已选中及当前声明/grant/denylist。结果绑定目标必须出现在版本引用中。额外Agent Model fingerprint复查覆盖Proxy/Key/jump依赖变动，Remote建连使用expectedFingerprint并在实际网络开通前调用授权复查。数据库许可不能与远端读取组成原子事务；异步期间撤销阻止后续读取/交付，已开始的读取不能追溯撤回。本批无结构或持久数据转换，不追加迁移。

### 7. 生命周期与失败

RemoteMachineOperationService按调用方预算动态追踪活跃任务，不另叠加固定8个任务名额，完整期限由调用方传入（普通工具冻结预算默认45秒，Shell使用原Run剩余期限），计入排队/实际读取/关闭及清理失败；Root等待整个工具Promise。停机停止准入、abort所有任务并等待实际收尾；清理失败证据保持原有私有留存门槛并汇总因果，安全出口仅带cleanup_failed。请求方治理/存储失败经Model保留原类别，不被Remote安全兜底误改成输入失败。读前/读后复查目标指纹、版本、政策和操作，最终政策检查在异步目标检查之后；结果持久再反馈，unknown不重试。

### 8. 当前能力与验收

只读工具已接线，执行须当前 governed 准入。文件按 UTF-8 字节分页、单页最多 32 KiB，拒绝非文本；目录按词典序游标每页最多 200 项。搜索是区分大小写字面量，每行首匹配、1起算UTF-16列；maxResults默认20/最多100，发现额外匹配才truncated。遍历最多100文件/100目录/8层/2MiB，排队也有界；symlink不跟随，路径规范化/realpath/lstat复查不构成并发原子隔离。同大小/mtime并发变化可能无法检测，SHA-256只说明实际捕获内容。结果整体256KiB，超额拒绝；32KiB单文本留足JSON最坏转义预算，搜索集合另按整体编码复核。所有行为覆盖范围见测试入口及 PLAN，四表及静态证据归实施方案/testing。

## 受审批的文件写入

### 1. 职责与范围

Agent tools 的 file_write v3 使用 connectionId、items[] 和 onError；单项包含绝对 path、UTF-8 content、expectedSha256（新建为 absent，替换为原内容 SHA-256）。整批预检后逐项执行和结算。路径最多 256 UTF-8 bytes，内容最多 8 KiB（允许空文本），完整参数仍受 16 KiB 编码预算。所有写入需要当前 file.write grant 与单次人工批准；不自动推导旧内容或继承读取许可。后续文件/Shell/Docker突变已接线，ACP与直接 Child/协作已接线，剩余能力见后续阶段。

### 2. 子功能与目录

复用 tools/service 的声明、解码及执行流程，governance 的审批请求/决议/消费，runs 的真实 proposal 和工具账本。Remote machines 的独立短任务 owner 扩展为 operations，统一读写准入和关闭；files/service 持有路径、覆盖及确认政策，FileModel/FileResource 转换 SFTP 能力。不新增平行协调器。

### 3. 依赖方向

Agent ToolModel/ToolRemoteModel 仅消费 Targets 与 Remote public。Remote Model 仅消费技术能力，Service 不借用户 Workspace/Files 附件。写入不引入 Agent 类型到 Remote/Platform，SQLite Adapter 不引入应用规则。

### 4. 类型与转换

| 边界           | 类型 owner                         | 转换 owner                               | 消费者                   |
| -------------- | ---------------------------------- | ---------------------------------------- | ------------------------ |
| 模型参数→应用  | tools/model/tool-types             | tools/service/tool-input 严格解码        | ToolService              |
| 审批/工具→存储 | governance/model、storage 各自定义 | GovernanceModel                          | SQLite 同事务规则回调    |
| Agent→Remote   | Remote public 独立写命令/结果      | ToolRemoteModel、Remote operation mapper | Remote operation Service |
| 远端资源→应用  | files/model 与 machines/model      | FileModel/FileResource                   | 文件写入政策             |

模型私有内容与 SHA 前提不进入 Shared；真正双端安全审批和审计继续使用已有 Shared。摘要只含动作、路径、字节数和内容哈希，不包含内容正文。

### 5. 入口与安装

模型工具 file_write 经持久真实 proposal 检查建立工具账本；ToolService 请求审批并等待已有 HTTP resolve。Bootstrap 注入 Remote operations；没有直接派发 HTTP 或前端正式入口。批准只是决议，消费成功提交才允许后续网络派发。

### 6. 数据、事务与并发

消费事务同时复查批准绑定、policyRevision、Run/frozen/provider、持久 selection 和目标 SSH/version，原子提交 consumedAt、工具 dispatched 与事件。后续 verify/complete 事务对突变核对已消费绑定许可，不能借只读 dispatch。取消/撤权/过期拒绝，批准不能用于第二次消费。写入使用同目录暂存；新建拒绝现有目标，替换必须匹配原哈希并保留普通权限。准备后再次校验内容前提及当前权限，最终提交后回读核对内容哈希。SFTP 的路径检查及哈希预检不构成跨调用原子 CAS；仍有并发替换窗口，不能承诺无覆盖竞争。

### 7. 生命周期与失败

审批轮询由 RunExecutionOwner 的工具调用持有，timer 跟随 AbortSignal 取消，不建立脱离 Root 的后台等待。每轮复查当前授权，批准后先复查目标再单次消费；停机关闭会取消等待。远端整项受冻结工具预算约束（默认45秒），不另设固定8个活跃任务门槛，清理失败仍追踪并保留证据。临时写入开始即有副作用；准备、提交、回读、最终授权或释放失败不能冒充未写入。unknown 不重放，暂存 discard 和资源 close 都尝试，失败保留原因与未收敛证据；确认持久结果之后才反馈模型。

### 8. 当前能力与验收

本批 N11–N13 源码及两轮审核已完成，静态结果归 testing；所有行为覆盖见 testing，不运行测试。实际预算与来源均来自冻结输入，执行须 governed 准入。后续 N14–N16 已按新设计接通 patch/move/delete、Shell/后台 Job/Docker，前端已消费当前契约。

## 文件补丁、移动与删除

### 1. 职责与范围

N14 按 D15 重设计 file_patch/move/delete，复用已有逐操作人工审批。补丁为单文件、原 SHA-256 绑定的 edits[] 顺序唯一字面量替换；移动和删除使用 items[]，整批预检相互路径影响，逐项结算，不提供远端事务。移动与删除可处理普通文件和目录，拒绝链接/特殊节点及根目录；必须提供 file_inspect 返回的有界快照 fingerprint。递归删除必须明确 scope:tree，scope:entry 仅文件或空目录。

### 2. 子功能与目录

Agent tools 的声明/严格输入/安全摘要和 ToolRemoteModel 扩展现有 owner。Remote files/service/file-snapshot 持有遍历预算与捕获快照；file-mutation 持有补丁/移动/删除的用例政策；file-write 复用暂存/确认机制。files/model 持有快照节点及计划，machines/model 持有独立短任务命令/结果，RemoteMachineOperationService 统一资源/期限/失败准入，不新建协调器。

### 3. 依赖方向

Agent→ToolRemoteModel→Remote public；Remote Service→文件应用能力→FileModel/Platform。所有新增命令/结果经过独立 public mapper，Model 不透传；路径/覆盖/递归政策不进入技术 Adapter，Service 不引用 SSH/SFTP 原始句柄。

### 4. 类型与转换

| 边界          | 唯一 owner                                           | 转换                                       | 消费者                    |
| ------------- | ---------------------------------------------------- | ------------------------------------------ | ------------------------- |
| 模型参数→应用 | tools/model/tool-types                               | tool-input 从 unknown 严格解码             | ToolService               |
| Agent→Remote  | Remote public 与 machines/model/operation-types 独立 | ToolRemoteModel 与 operation-mapper 白名单 | 独立机器任务 owner        |
| 文件快照/计划 | files/model/file-types                               | 文件应用能力返回校验事实                   | snapshot/mutation Service |
| 审批/账本     | 既有 governance/runs 应用及 storage                  | 原 Model/事务回调                          | 单次许可/持久反馈         |

模型参数、文件内容/计划及指纹无双端消费者，不放 Shared；审批/审计基础值继续引用已有 Shared。

### 5. 入口与安装

新增 file_inspect 只读能力供模型取得文件/树指纹；三个 v3 突变声明，服务端决定风险：patch/move 为 mutate，delete 为 destructive。file_inspect 要当前 file.read，突变分别要 file.write/file.delete；读取快照不授予写入。所有操作仍由真实模型 proposal→原账本→原治理消费者执行；无新 HTTP 或正式页面。

### 6. 数据、事务与并发

不改表结构/迁移。approval 绑定真实参数、摘要、内容修订和目标；操作前重捕获快照并核对 fingerprint，scope/tree 决定也绑定审批。移动拒绝既有目的地及源/目的祖先关系，成功后确认源消失/目的快照一致。删除先核对整树，再倒序逐节点核对并删除；目录确认无剩余节点，自身删除造成的目录 mtime 变化不作为外部冲突。检查不能提供 SFTP 跨调用原子隔离；外部并发替换/创建仍存在窗口，部分删除或最终确认失败为 unknown，不自动重放。

### 7. 生命周期与失败

按冻结工具预算和真实资源动态接纳，复用冻结工具完整期限（默认45秒）。快照最多100文件/100目录、深度8、单文件1MiB/累计2MiB、元数据256KiB，队列也计预算；每文件按预检长度读取，目录导航项在技术 Adapter 过滤，重复节点拒绝；不跟随链接，二进制文件可hash，不输出内容。patch 原文件/结果最多32KiB，oldText/newText各4KiB且完整JSON16KiB；唯一非空oldText可替换为空，零次/多次/相同替换拒绝。首次远端变更后任意节点拒绝、权限变化、取消、确认或释放失败不能报完整成功。原owner追踪全部资源/清理，未知无重放。

### 8. 当前能力与验收

file_inspect/patch/move/delete v3 已经沿真实工具提案、账本、审批/单次消费、Remote 独立资源与持久反馈接线；两轮源码复审覆盖预算、重复节点、元数据、部分执行及清理分支，静态证据见 testing。既有专项已核对真实七步文件变更、显式tree删除、哈希过期/重叠上下文/目的存在和链接拒绝；部分执行、竞争和断流仍待验，正式前端按当前安全码反馈，执行须 governed 准入。移除旧多文件diff协议并明确新逐文件操作，目录范围有界而不提供任意无界删除。

## Shell、后台 Job 与 Docker 工具

### 1. 职责与范围

N15 同批实现 Shell 前台/后台、Job list/status/wait/cancel/output 和 Docker inspect/control。Shell 对模型统一 commands[] 脚本批次，不用命令文本启发式判断安全；执行按 destructive 审批。Job 属于 user/App/Run/目标版本，不借普通 Workspace/sessionId，不跨 Run 接管。后台仅指模型可以继续下一轮，不是脱离 Root 的长期服务。Root 终结前取消并等待全部 Job；取消不证明远端子进程停止。

### 2. 子功能与目录

ToolService 持有声明/审批/派发及工具资源排空的失败汇总。全部子失败均属 ToolExecutionUnknown 时保留该类别（清理未确认保留 ToolCleanupFailure），由 RunExecutionOwner CAS 收口 unknown；混合存储/内部失败保留 AggregateError，不猜测后续状态写入。tools/service/tool-job-service 持有前台/后台 Shell 的持续任务、轮询权限、等待与收尾，tools/model/tool-job-model 做独立存储转换，tools/storage 及 adapters/sqlite 持久身份/状态。Remote machines/model/command-model 转换应用命令、结果与 SSH 生命周期，platform/commands Adapter 持有 POSIX argv/cwd/script 语法。Docker 复用 ObservationModel 和 NativeDockerAdapter，OperationService 持有原状态前提及后验政策。

### 3. 依赖方向

Agent Service→Run 的 ToolRemoteModel→Remote public 工厂创建的 OperationService→Command/Observation Model→Run 的 MachineScopeModel→Platform Adapter。Job Service→JobModel→Storage→SQLite Adapter；无平台业务类型，无 SQL 越层，无 Workspace 权限继承。

### 4. 类型与转换

工具参数与 Job 内部类型分别在 tools/model/*-types；Job storage 独立定义命令/记录及具名结果联合；持久JSON和状态/结果关联仅在SQLite Adapter解码，JobModel逐字段转换，前台/后台共用ToolRemoteModel.command的应用结果，不通过JSON往返协作。Remote public 命令/结果独立于 machines/model/operation-types，operation-mapper 与 ToolRemoteModel 白名单；Shell 技术类型只在 commands Port。字符串/对象数组 schema 经 RunModelStream 转成通用 ModelToolProperty，技术请求再次逐字段投影。只有后端/模型消费，不新增无人消费 Shared Job DTO；Docker action 复用已有 Shared 基础取值。

### 5. 入口与安装

shell_execute、shell_job_control、machine_docker_inspect/control 使用 v3 批次契约。执行与取消分别单次批准；状态/列表/等待只读且需当前 shell.execute；Docker 要 machine.docker.manage，remove 为 destructive。Shell在原工具单次消费后持久queued；foreground可在原工具dispatched期间launch并等待，background在原工具受理回执提交确认后launch。Job dispatched提交确认后才发SSH，两个模式均在当前Run/原工具授权下执行；数据库unknown不派发或自动重试。foreground在yield窗口内完成保持原退出结果，否则把同一个Job交给shell_job_control查询，不再派发命令。Job权限监测允许原工具dispatched→completed且revision恰好加一、operationHash不变的交付竞态：仅重新读取并校验一次当前权威，不放宽目标、政策、审批或真实终态；拒绝和存储失败仍保留原类别。

### 6. 数据、事务与并发

agent_tool_jobs 由所属 Adapter 安装；id 绑定原工具记录，完整 scope/目标版本/命令身份独立持久化。queued/dispatched→completed/failed/unknown 使用 CAS；重启 queued 确认未派发为 failed，dispatched 为 unknown，不恢复技术句柄或自动重放。活跃 Shell 按原冻结预算和真实资源动态接纳；历史项受原冻结maxToolExecutions约束，不因前台转Job引入64次执行上限；list按64项分页并返回nextOffset；派发前预留终态结算的版本空间，启动恢复的批量递增先完整检查耗尽。Docker 必须传完整64hex ID与 inspect 指纹（id/state/image/created），控制前复核，控制后确认目标状态/不存在；跨调用外部竞争窗口明确保留。

### 7. 生命周期与失败

Shell commands[] 原始 UTF-8 合计≤8KiB，cwd≤256bytes，完整参数JSON≤16KiB；stdout/stderr合计32KiB有界捕获，明确truncated，完整结果可容纳最坏JSON转义。Remote按冻结预算和真实资源占用动态接纳，Shell的实际执行截止时间来自原Run的绝对deadlineAt，不随yield/续查重置。foreground的yieldSeconds可为0，默认冻结toolTimeoutSeconds并以其封顶；窗口到期仅返回Job快照，不abort。job wait默认10秒、最多30秒且受冻结工具等待预算约束，到期同样保留执行。不可续查的其它工具仍使用冻结工具执行期限（默认45秒），Remote不再额外把合法配置硬截为45秒。连接握手单独遵守Platform既有300秒技术上限，命令消耗Run剩余期限。每个任务、权限监测、timer/listener/Promise均有原owner；派发前再次核对剩余时间；每秒复查原批准/目标/当前权威，终态结算前先停止并等待权限监控收敛，失效取消后等真实收尾。根取消/结束/停机统一drain；清理失败保留配额和原因。Shell非零退出是已确认命令失败，SSH派发未知、取消、后验失败和清理失败不得报远端回滚。工具说明要求模型在需要结果时继续等待原Job，不能因yield重跑或提前结束Run。模型主动结束Run仍沿原收尾政策取消剩余Job。已有held/blocked由Mutation SQLite在获取全部资源的同一事务分类，具名准入拒绝经Remote public/ToolModel映射为tool_machine_busy/tool_machine_blocked，新操作failed且没有新副作用；原blocked证据保留，只能沿现有恢复流程核对。

### 8. 当前能力与验收

Shell 前台/后台、Job 五动作及 Docker inspect/control 源码同批接线，两轮源码复审完成。既有专项使用真实OpenSSH核对Shell转义/退出/截断、Job查询/等待/取消、撤权、目标版本及重启围栏/证据释放；Docker及其他故障专项仍待验，精确证据归testing，前端消费当前安全码。执行须 governed 准入，不建立旧Thread/sessionId桥；ACP与直接 Root/Child/协作已有实际消费者，资源与授权分别归所属 owner。

## Run 工具资源复用

1. **职责与范围**：同一 Run 的文件、项目指引、文件交付、Shell/Job、Docker、诊断与 ACP 复用空闲 SSH；Root、Child、普通 Workspace/Files 互不共享活跃资源。传输复用不继承 shell 的 cwd/env；ACP 程序与协议会话按调用独立。MCP SDK 客户端、Browser 的 Run 会话和插件实例沿原 owner 复用，不复制缓存。
2. **子功能与目录**：Agent tools/model/tool-model 管理 Run→ToolRemoteModel 及目标解析；tool-remote-model 唯一转换 Remote 请求/结果/失败。Remote machines/model/machine-scope-model 管理独占借用池；machines/service/operation-service 管独占文件资源池、准入及任务排空；operation-factory-service 保留全部作用域供停机兜底。
3. **依赖方向**：ToolService/ToolProjectService→ToolModel 的 Run 能力→ToolRemoteModel→Remote public 工厂→OperationService→File/Command/Acp/Observation Model→RemoteMachineProvider→Platform SSH；Agent 不深层导入 Remote，Service 不持技术句柄。
4. **类型与转换**：RemoteMachineOperationFactory/Operations 为后端安全 public 契约，operation-mapper 白名单转换并封装关闭错误。内部 Provider/OpenRequest/OpenedMachine 唯一归 machines/model/machine-types；Platform MachineConnection 不进入 public/Shared。Provider.release 明确区分可复用与退休，原始 provider 始终真实关闭；FileResource 的技术释放回调仅在 Model 间传递。
5. **入口与安装**：Remote register 为工厂创建独立 MachineScopeModel 与消费它的 File/Command/Acp/Observation Model。ToolModel 按需创建一次 Run 作用域；Shell Job、ACP 和项目读取在等待前捕获该能力，晚回调只能调用原已关闭实例。RunResourceService 安装资源读取投影、10 分钟空闲回收和显式关闭；Run HTTP 与 WS 向任务侧栏投影 Shared 安全资源状态。
6. **数据、事务与并发**：仅进程内资源，不持久化或新增迁移。空闲连接按目标有效指纹及当前主机信任摘要分组；每次借用复验授权、目标与信任，握手后再复查。并发操作先预留独占连接，再等待握手，忙时按需创建；成功文件资源保留自己的 SFTP 与连接供后续文件操作使用。资源活动续期 10 分钟；活动工具、审批及后台 Job 阻止空闲回收，不增加连接数量或并发限制。
7. **生命周期与失败**：作用域跟随 Run；原 Job/Browser/MCP owner 先 drain，随后文件通道关闭并归还连接，最后关闭所有 SSH。配置/信任变化退休旧连接，断开的空闲文件资源在业务派发前更换；失败、取消或未确认命令不回池、不重放。等待取消可先返回，实际握手仍归原作用域追踪，晚到资源必须关闭。单项清理失败不跳过其余资源，关闭 Promise 幂等，未确认清理的 owner 与全部因果保留到全局 Remote 停机汇总。
8. **当前能力与验收**：资源复用及 Run/全局关闭已接入现有真实消费者，产品说明见 USAGE 的 Agent SSH 章节。正式回归沿 Agent execution-flow 覆盖真实 SSH/SFTP 的握手/通道计数、独立 cwd/env、并发取消、撤权/主机信任、断线派发前替换、晚握手及清理失败；本轮执行状态与尚未验证的实机边界见 PLAN/testing，不以结构计数宣称具体延迟或吞吐改善。

## ACP Runtime 与独立权限

### 1. 职责与范围

ACP 通过当前 Run 独占借用的 SSH 连接执行独立远端程序，支持v1初始化、创建会话、prompt、文本更新、权限请求及取消/关闭。不借普通Workspace资源。当前调用按明确argv/cwd/prompt设计，不保留integrationId/Workspace/profile兼容参数；集成配置管理归 integrations，当前调用配置完整绑定本次批准。禁止远端ACP直接调用Nexus文件/terminal能力。

### 2. 子功能与目录

platform/acp持有通用协议、消息关联与有限流；commands Adapter持有argv命令构造；Remote machines/model/acp-model持有命令生命周期及技术转换，machines/model/machine-scope-model 持有 Run 的 SSH 复用及关闭，OperationService持有准入。Agent tools/service/acp-permission-service持有独立权限等待/批准/消费/监测，runs journal持有子操作及父关系，真实SQL只在runs/governance Adapter。

### 3. 依赖方向

Agent ToolService→ToolRemoteModel→Remote public→OperationService→MachineAcpModel→Platform ACP/SSH。权限回调经上述边界白名单回到Agent Service→Governance/RunToolModel→Storage→SQLite；Platform不引入Agent业务类型。父批准只授权启动远端程序，子批准只授权其绑定的单次ACP请求。

### 4. 类型与转换

技术请求/许可/结果归platform/acp Port；Remote public与machines/model各自独立对象，operation-mapper逐字段转换；Agent内部输入/许可归tools/model，journal命令与存储各自唯一owner。用户审批读取和工具事件复用Shared现有安全契约，不公开rawInput、程序流或技术句柄。仅后端/模型消费的ACP参数不预留Shared DTO。

### 5. 入口与安装

新增acp_execute v2模型工具，connectionId/argv/cwd/prompt绑定本次人工destructive批准，需integration.acp.invoke。嵌套权限生产独立acp_inner_permission记录及acp_permission批准；权限观察和决定复用已安装审批 HTTP 及线程工具列表，不新建无消费者WS。技术协议拒绝direct fs/terminal和持久allow选项，只支持allow_once/reject_once。

### 6. 数据、事务与并发

ACP权限父关系表由所属 Adapter 安装。子操作仅能在真实dispatched ACP父工具下创建，绑定相同scope/步骤/目标及父内容哈希；事务复查当前父状态，不伪造模型proposal。所有父终态围栏、Root unknown/restart继续覆盖同一工具账本。批准请求/resolve/consume/verify均核对独立子身份及活父关系；数据库未知不派发、不补写、不重放。

### 7. 生命周期与失败

复用动态任务追踪及冻结工具整项期限（默认45秒）；每父最多64受支持权限操作、逐请求当前权限复查，等待不得延长任务期限。argv最多128项/8KiB，cwd256bytes、prompt8KiB、完整工具参数16KiB；单NDJSON消息256KiB、总输入8MiB、文本输出32KiB。技术流的pending请求、writer/reader、监听、权限Promise和关闭结果均由原owner追踪。prompt派发后失败/取消为unknown；初始化前拒绝区分未启动业务prompt与远端程序已经启动。关闭保留全部原因，不能吞错；本地关闭不证明远端进程停止。

### 8. 当前能力与验收

ACP执行、独立权限/交付确认、审批HTTP和工具事件消费者已接线。既有专项验证真实SSH独立审批与取消，以及受控技术流中reader/permission未收敛时继续等待、退订/cancel同步失败的单次清理和Machine Model因果保留；writer在途等其余故障仍待验。四表/证据归testing，正式前端差异维护在 USAGE。

## Root/Child 与协作

### 1. 职责与范围

Child 是原 `runs` 中的独立 Run，不建立第二个 Runner、Root 注册表或权限中心。Root 按冻结配置限制活跃直接 Child（默认四个），已终态且排空者释放名额，累计历史由任务族工具预算限定；新设计不提供多层委派、付费请求自动重试或恢复原执行。explore/review/worker 仅为角色标签。Child 直接继承 Root 冻结模型、执行限制和绝对期限，与 Root 共用家族预算；工具集合继承主 Agent，但排除嵌套委派与 Root 专属 join/cancel。原访问模式、目标范围、实时 grant 和独立审批继续复查，继承不授予 capability。

### 2. 子功能与目录

`runs/service/run-collaboration-service.ts` 管委派、依赖、join、取消、消息与事实用例；`run-collaboration-rules.ts` 管配额及纯准入。`runs/model/run-collaboration-{types,model}.ts` 持有应用对象和存储白名单；`runs/storage/run-collaboration-storage.ts` 持有独立存储契约。SQL、关系解码、协作数据和父子围栏归 `runs/adapters/sqlite/run-{collaboration,participant,child-fence}*`。工具严格输入与声明归 `tools/service/collaboration-tools.ts`，不新增平级模块或私有 HTTP 树。

### 3. 依赖方向

原 RunExecutionOwner → ToolService → RunCollaborationService → Model → Storage/SQLite；子模型调用继续由同一个 RunExecutionOwner、RunStepModel 和 Platform AI 执行。register 只接入原 owner 的准入、start/abort/wait/drain 能力，不将应用规则注入 SQLite。Remote/Platform 不认识 Child、profile、共享事实或消息。

### 4. 类型与转换

| 边界                                  | 类型 owner                                             | 转换 owner                       | 消费者                 |
| ------------------------------------- | ------------------------------------------------------ | -------------------------------- | ---------------------- |
| 模型工具 JSON → 应用输入              | tools 的未知输入解码、runs Model 的 CollaborationInput | tools/service 严格解码           | 原 ToolService         |
| 协作应用 ↔ 持久记录/事务事实          | runs/model 与 runs/storage 各自定义                    | RunCollaborationModel 逐字段投影 | Service/纯规则、SQLite |
| Run/工具状态与 Child 观察 → 双端协议  | Shared runs/tools/governance/collaboration             | 原 register/HTTP mapper          | 已安装管理员 HTTP      |
| Child 完成输出/协作文本 → 父/同族模型 | runs 内部应用对象                                      | 协作 Service 明确投影            | 模型工具结果           |

消息和事实只是未验证文本，不能作为授权、系统指令或已验证证据。Child 列表、取消及消息元数据 HTTP 的完整契约与严格 codec 在 Shared agent/collaboration，取消复用 Shared runs 请求/header/成功联合。profile 的双端有限取值归 collaboration/values；目标 allowlist、模型历史、正文、事实与存储对象不出公开端点。正式前端已消费当前安全对象。

### 5. 入口与安装

`app.intents.exchange` 等能力由签名插件声明，安装后 grants 为空。十个 `collaboration_*` 工具（含正文续读 `collaboration_output_read`）通过原模型工具入口使用；读操作仍需实时全局 grant，委派、取消、发送、消费和 CAS 写入需独立 ToolCall 批准。父模型/工具批准不代替 Child 自己的工具批准。没有旧 runtimeId/sessionId 桥接或新的公开 dispatcher。管理员 HTTP 安装 GET /apps/:appId/runs/:id/subagents、POST /apps/:appId/runs/:id/subagents/:childId/cancel 和 GET /apps/:appId/runs/:id/subagents/:childId/messages，完整前缀 /api/v1/agent；入场/交付分别核验 Access。列表仅 id/parentId/status/version/profile/deadlineAt；消息仅 sequence/senderId/bodyBytes/expiresAt，查询 after/limit（默认0/16，最大32），完整响应16 KiB。观察不改变模型邮箱水位。Child 取消由 RunService 验证不可变父子/user/App 归属，再复用原 Run CAS/幂等取消及审批失效，不建立第二账本。外部直接创建由受审批模型委派替代，独立 Profile 管理及 collaboration_profiles 查询工具已删除，delegate 不再接受单独 maxRequests/durationSeconds 或模型覆盖。

### 6. 数据、事务与并发

存储结构包含 Run kind/绝对期限及 Child 关系、事实、mailbox、扫描/消费水位和本地副作用标识。Child 的目标集合、继承工具、继承请求上限、Root 期限、依赖和创建 hash 固定；委派读取父当前状态/目标/已有子集，在原事务经 Model 回调执行 Service 纯规则。Child 步骤和工具/审批消费复查独立身份、活父和期限；目标与 capability 仍由原治理权威核验。此前 Child 才能成为依赖，无环；success 依赖要求 completed，settled 接受所有终态。

事实 CAS、消息容量/序列及消费 CAS 同事务，重复工具身份不重做副作用。mailbox 页包括过期位置的扫描进度，空结果不丢 nextCursor；消费不得越过已连续扫描水位。根终态和活 Child/工具/步骤围栏同事务；Root 成功必须没有未完成 Child。ACP 内部权限不计入模型步骤普通工具提案数量，仍纳入独立工具/权限审计。

### 7. 生命周期与失败

Root/Child 共用冻结执行名额，排队依赖也占名额；执行准入满载拒绝，模型派发并发忙则由原owner等待。Child 继承Root期限和任务族请求额度，不再独立缩短；期限到达阻止新派发，但允许原步骤未知结算。join 最多30秒，只结束等待。父成功前等待每个 Child 的真实任务和清理；Agent 共用错误 owner 的 aggregateToolFailures 同时服务 ToolService 排空和 RunExecutionOwner.waitChildren，嵌套的纯执行未知保留 ToolExecutionUnknown/ToolCleanupFailure，混合存储或内部故障保留 AggregateError，不推测结算；父失败/取消/撤权/停机覆盖整族。存储取消失败仍取消本地 Child、等待资源并聚合全部失败，不以一项错误跳过其他收尾。

重启只对账：未派发 Child 失败，已派发/运行中保守 unknown，不重建等待、不重放请求。Child 每步正文与最后正文沿模型步骤2 MiB容量，同步骤/Run成功事务完整保存。participant SQL只读取1024字符预览与原UTF-8字节数；list分页最多16项，output_read按原身份续读并返回hash。仅活跃、unknown或未结算工具的Child阻止父成功；确定失败/取消且实际排空不强制父失败。没有远端 rollback、跨进程活任务接管或公平排队承诺。

### 8. 当前能力与验收

委派、角色标签、依赖等待、list/join/cancel、持久消息读取/消费、共享事实 CAS 与父子收尾已接线。接入共享预算、Root 冻结模型/设置继承与原执行 owner，Memory/Artifact/Browser/MCP 已接线；跨 Run 持久占用归项目上下文与共享突变占用专题。已通过隔离后端、实际 HTTP/SQLite/OpenSSH 的委派/join、整族取消、独立批准/错族拒绝、消息消费、事实冲突与 Child Job 未知结算子场景；完整配额/期限、未知提交与崩溃恢复仍待验。确切版本、两轮复审及命令证据归 testing，正式前端已消费当前契约。

## 项目上下文与共享突变占用

### 1. 职责与范围

Agent tools 持有 Run-local 项目目录；Remote machines 持有受管远端突变的唯一准入权威。普通 SSH Files/传输、Workspace Docker 与 Agent 文件/Shell/Job/ACP/Docker 共用占用，但不共享登录身份、批准或活跃连接。Agent 通过 Run 级 Remote operation 作用域复用空闲传输，不提供 sessionId 桥接或持久 shell 状态；Run/Job 查询取消及父生命周期负责收口。旧 Thread 项目共享改为 Root/Child 各自绑定，当前不自动向子 Run 或系统提示注入指导。

### 2. 子功能与目录

Agent tools/{model,service,storage,adapters/sqlite}/tool-project-* 分别持有应用类型/转换、目录用例、存储契约与真实 SQL；tools/service/tool-definitions 和 tool-input 持有受信声明/严格参数，ToolModel 持有 Run 作用域及目标解析，ToolRemoteModel 持有 Remote 请求/结果/失败转换。Remote machines 对应层的 mutation-* 持有应用身份/转换、准入政策、存储接口和 SQLite 事务，migrations 仅安装 Adapter。endpoint占用不设全局数量门槛，单次最多两个endpoint对应源/目标是Remote Service政策；目录256 UTF-8 bytes、子目录深度8、四份文件/每份8 KiB 是 Agent 项目用例限制，不是新增 HTTP 容量。

### 3. 依赖方向

Agent ToolService → ToolProjectService → ToolProjectModel → ProjectStorage → SQLite Adapter；指导读取走 Run 的 ToolRemoteModel → Remote public.operations → RemoteMachineOperationService → File/Command/Acp Model → Platform。Remote Files/Observation/Operations Service 直接复用同一 MachineMutationService → Model → Storage → SQLite Adapter。Adapter 不引用应用类型或规则实现，Platform 不定义 Agent/目标业务对象；Bootstrap 只安装 register/migrations。

### 4. 类型与转换

| 边界                       | 类型 owner                                                              | 转换 owner / 消费者                                                            |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 模型工具 JSON → 应用       | tools/model/tool-project-types、tool-types                              | tool-input 严格校验，ToolService 生成安全审批摘要                              |
| 项目应用 ↔ 存储            | ProjectScope/Binding/Mutation；storage StoredProject*                   | ToolProjectModel 逐字段转换，Adapter 仅解码 row                                |
| 指导应用 ↔ Remote 后端契约 | ProjectGuidance；remote/public.operations                               | ToolRemoteModel 构造请求并逐字段生成指导结果，ToolProjectService 生成工具 JSON |
| 突变应用 ↔ 存储/Targets    | machines/model/mutation-types；storage mutation-storage；Targets public | MachineMutationModel 解析受信 endpoint、投影命令并映射安全失败                 |
| 应用 → 双端安全观察        | 既有 Shared agent/tools 与 remote 安全错误                              | 既有 HTTP/WS mapper；目录正文、claim keys、row 不进入 Shared                   |

本版无新增目录/占用 HTTP 或 WS DTO。指导不可信，不等于授权、证据、Shell cwd 或系统指令；普通协议安全码继续使用 conflict/operation_unknown/limit_exceeded 等现有契约。

### 5. 入口与安装

project_directory_bind/read/clear v2 经原模型 proposal、账本、目标检查与治理消费执行；bind/clear 需当前 file.read 和独立批准，read 需当前只读权。参数为 connectionId 加 directory（bind）或可选 path（read），clear 无额外字段。bind/read 从绑定根沿指定子目录读取不区分大小写的 AGENT.md/AGENTS.md，拒绝链接、越界和超量；未绑定 read 返回空上下文。Remote register 安装唯一 mutation owner，普通 Files、独立 Agent operations 与 Workspace observations 接入；启动 initialize 在监听前完成 held→blocked 围栏。

### 6. 数据、事务与并发

Bootstrap 调 Agent/Remote migrations 编排安装与迁移，真实 SQL 归所属 Adapter。agent_run_projects 按 Run/connection 唯一，删除 Run/connection 级联清理；agent_project_effects 按 ToolCall 唯一，目录改写与 effect 同事务，复查 dispatched/action/hash/target/policyRevision/live participant，bind 另核 SSH/version。不重放未知目录写入。

remote_machine_mutations 按 SHA-256([lowercase host,port]) 唯一。ID/user/凭据/代理变更不为同一文本 endpoint 创建第二占用；跨端复制/移动一次事务检查并获取两个排序去重 key，部分获取不提交。已持有或 blocked 报 conflict，不设跨endpoint数量上限；不自动重试或排队。释放/阻断必须匹配原 claim ID、key 和 held 状态。私有 Files 同资源既有队列仍保留，跨资源占用不等待。DNS/IP别名、不同跳板网络中的同名主机不被此文本身份准确区分，可能漏合并或保守拒绝；不宣称真实物理主机识别。

### 7. 生命周期与失败

占用涵盖实际操作、远端结果确认、独立资源清理和最终授权复查；后台 Job 在实际执行时持有，受理回执不持有假执行占用。确定结果/拒绝且清理完成释放；operation_unknown、未知异常或清理失败保留 blocked。拒绝的归档操作必须由原归档 owner 完成私有临时项清理，Host Key 拒绝不等于已执行突变。结算失败保留未知，不在未知释放后猜测第二次写入；清理与结算双失败仍保留 RemoteResourceCleanupFailure 供停机 owner 汇总。重启将 held 保守转 blocked，不恢复执行、不按 TTL 自动释放。

项目读取共用冻结工具整项期限（默认45秒），绑定只在指导读取及当前授权复查后提交；目标 version/fingerprint 改变拒绝旧上下文，不隐式重绑定。占用不是 OS 隔离：交互 PTY、外部客户端、后台派生进程不受此数据库锁控制，命令退出/SSH close 不能证明派生进程停止。已确认远端结果后的响应丢失不自动重放副作用。

### 8. 当前能力与验收

受管突变准入与 Run-local 项目工具源码已接线；全部行为覆盖见 testing，执行须 governed 准入。持久 blocked 已由下述 机器突变恢复接线管理员只读核对、人工证据和独立 CAS 释放；不将重启/期限/改连接ID当解除证据，原未知结果不改写。已接入可配置上下文/预算及执行回接，外围能力已接线；Shared 恢复契约已有后端消费者，正式前端已接线。USAGE 记录当前限制，四表/源码复审与待验场景见 testing。

## Agent 安全失败诊断与 SSH 发现授权

1. **职责与范围**：Run/Tool owner 记录有限故障类别；Governance 唯一决定授权，诊断不授予权限、不重派任务。
2. **子功能与目录**：runs/run-failure-rules 分类具名应用异常；ToolRemoteModel 将 Remote 的资源 not_found/forbidden 显式转换为 ToolOperationRefusal，与目标解析不存在和 Agent 授权失败分开；Run 分别投影 tool_resource_not_found/tool_remote_permission_denied，原只读确定拒绝可交回模型继续，变更派发后的未知及清理失败围栏不变；RunModel 组合原工具日志与当前进程诊断；tool-service 在既有失败 CAS 写入安全错误结果。
3. **依赖方向**：Tool/Run Service → Run Model/Storage；Governance Model 在原事务决策回调内记录政策拒绝原因，收敛后抛具名 AgentFailure；SQLite 不引用应用错误类。
4. **类型与转换**：Shared runs/values 持有限错误码，runs/model 持公开只读 failure；内部 RunFailure、StoredRunFailure 各归本层 owner，HTTP/WS/前端保持显式白名单转换。
5. **入口与安装**：原 Run get 和 WS 状态投影附带 failure；列表/创建/取消快照不虚构诊断。无新接口、依赖、数据库结构或初始化签名变化。
6. **数据、事务与并发**：工具失败以现有 result_text 保存单一 failureCode，仍在原 expectedRevision CAS 中收敛；完成工具的结果与上下文引用不变。RunStorage 仅查询当前用户/App/Run 的终态工具，按原 scope 索引过滤。RunModel 最多保存512次运行的有限诊断，按用户/App 核对后只附在 failed/unknown 上；满额淘汰旧诊断，不拒绝任务或影响持久终态。
7. **生命周期与失败**：工具错误原因随原账本持久保留，进程内模型/派发前诊断在模块重建时释放，日志按运行编号关联。保留首次原因，已持久的具体工具原因优先；围栏/恢复无已知原因时返回真实未知，不读取供应商正文。unknown 仍表示可能存在远端效果；失败结算、未知提交和清理围栏保持原行为。
8. **当前能力与验收**：machine_connection_list 与其它工具共用 authorize，其 machine.inspect 按 Shared 定义要求 global grant，不设列表专用授权分支；查询前与交付前核对所选目标及 App 禁用列表，仅记录实际交付目标。普通工具仍严格检查绑定目标，版本、Provider、审批与事务复核不放宽。静态和指定站点待验范围见 testing。

模型派发前的凭据读取/Provider版本核对失败也由 RunExecutionOwner 记录有限诊断与 AGENT_MODEL_DISPATCH_REJECTED 日志；仅当前进程保留原因，不写供应商正文或凭据。确定未派发仍按原预留步骤 CAS 结算，未知存储提交继续传播，不因诊断追加第二次写入；用户取消不冒充配置变化。

### Agent 上下文容量分类

Context不再按普通/扩展裁剪窗口，也不使用字节代token判断实际模型容量；Provider拥有真实tokenizer和最终超窗拒绝。ContextLimitExceeded仍归Agent内部错误owner，继承limit_exceeded以保留初始历史整段裁剪，用于本地编码容量或无法完成必要上下文压缩；Run映射context_limit_exceeded。所有入口保留消息+工具定义4MiB、完整快照和源身份预算；1024消息数量限制已从Context校验、存储解码和Platform编码入口一起移除，History原文选择使用4MiB而非512KiB。ContextLimits保留真实模型声明与输出配置，未引入新schema或重写失败历史。profile字段/设置删除依H-13待用户确认，执行侧已无消费者。

Execution预算SQL在原事务内以已报告input_tokens+output_tokens替代对应reservation作为累计占用；未报告usage或结果未知仍保留原reservation，确定未派发失败为0；主/子共享root_id，不修改旧账本或伪造missing usage。SDK仍是唯一重试调度owner；attempt仅日志计数，未另设次数循环。

Context预压缩现状：checkpoint工具需要实际context.compact授权，摘要绑定真实已持久模型输入及其hash，完整工具组完成后应用，不能临时拼接新摘要绕过contextContinues校验。自动阈值/后台摘要由下节Context自动压缩owner负责；contextCompactionMode仅限制显式checkpoint工具摘要比例。

追加核对：未知contextWindow不应成为文本模型执行的硬门槛；已从Provider冻结和Run冻结投影一起移除，ContextLimits按真实缺失表示、不填伪造窗口，maxOutputTokens仍作为实际输出配置要求。图片上下文不再填虚构字节窗口。无Shared/schema/UI变化；未知容量不能推导提前压缩阈值。

### Context 自动压缩与用量估算

1. **职责与范围**：ContextService持本Run同冻结模型的usage锚点、当前消息和替换；CompactionSession持每Run自动摘要任务。采用OpenCode固定提交49a112f的字符/4回退、15%/16k余量、64k已测输入与85%阈值前预生成思路，不引入整套Agent框架，不声称精确分词或跨模型校准。
2. **子功能与目录**：context/compaction-rules持阈值与完整分组切分，compaction-values持摘要数据标识；service/compaction-session持准入、预生成、消费和排空，model/compaction-model持存储转换；adapters/sqlite/compaction-{schema,row,sql,context-sql}持DDL、真实解码、事务和前缀证明。Run的run-authority-sql由原步骤与摘要共用，不复制身份政策。
3. **依赖方向**：RunExecutionOwner→Context服务/Model→Storage与RunModelStream/ProviderModel→Platform官方SDK。预算由ExecutionService决策，事务内回调转换独立StoredExecutionSettings/Usage。摘要没有工具，不伪造context_checkpoint授权、模型工具调用或用户回复。
4. **类型与转换**：ContextUsageAnchor/CompactionCommand/Result归context/model/context-types，StoredCompactionCommand/Compaction与接口归context/storage/compaction-storage。CompactionModel逐字段转换源快照、身份和预算回调，SQLite不消费应用规则/类型；新增表/摘要不增加Shared或前端字段。usage只计现有已归一化input+output，缓存/推理不重复相加。
5. **入口与安装**：register安装CompactionModel/Storage，Run每轮派发前prepare，完成工具提议后可precompute；所属 Adapter 安装agent_context_compactions，快照注册与真实decoder同步，运行时不兼容旧值或自动删除数据。未知window/Images不启用自动压缩，maxOutput仍为正常模型上限，摘要单次输出至多16384token（包含供应商计入输出的推理），正文至多16KiB。
6. **数据、事务与并发**：摘要独立持久reserve/dispatch/completed/failed/unknown、原快照/hash/切分位置和usage，root_id与Root/Child共享请求、token、并发账本。后台只与工具阶段重叠，下一轮前收敛，预留至少一次继续请求；实际任务预算不能因压缩绕过。摘要以唯一id绑定替换，下一步事务按同Run已完成记录重建原前缀，再复用contextContinues验证持久助手输出、完整工具结果和来源；陈旧前缀不能应用，保留近期约25%窗口（适用时至少30k，最多半窗口）及完整最后交互。原用户请求独立保留；不把摘要提升为授权。
7. **生命周期与失败**：每Run仅一个后台Promise和取消controller，子任务继承原期限/预算；取消/撤销/恢复在原围栏事务将未派发置failed、已派发置unknown，不重放。完整流和清理完成后才持久摘要，usage缺失保留预约；未知存储提交不二次写入。可选摘要连续失败两次暂停，存储/清理故障不能吞掉；原任务finally及成功提交前排空，清理未确认保留运行名额。摘要费用汇入原Run用量但不生成正文事件。
8. **当前能力与验收**：已实现同Runusage校准/回退、自动阈值、初始历史压缩、工具期预生成、完整分组与原输入保留、预算/取消/恢复/快照消费。初次/跨Run重建历史使用估算；不增加供应商超窗的自动重放恢复，不声称与OpenCode全部内部实现一致。语义摘要有信息损失及额外费用。操作见USAGE执行设置，静态与D17待验场景见testing。

### Agent 会话自动命名

1. **职责与范围**：scope 的 TitleSession/TitleModel 持默认 Thread 首条 Root 消息自动命名，RunExecutionOwner 追踪所属辅助模型调用；人工 Thread 标题不参与。
2. **子功能与目录**：scope/model/title-types、title-model，storage/title-storage，service/title-session，adapters/sqlite/title-schema/title-sql/title-row；title-rules 持输出归一化和无工具提示词。
3. **依赖方向**：Run owner → TitleSession → TitleModel → TitleStorage；现有 RunModelStream/OpenAI SDK 提供模型流，ProviderModel/ExecutionService 提供冻结配置复验和预算；不复制网络重试。
4. **类型与转换**：TitleScope/Claim/Command 属 scope model，StoredTitle 对应 storage；Model 持白名单转换和政策投影。WS RunStreamState 带 AgentThread，由 ThreadModel.forRun 精确关联读取、原 interfaces 投影；不暴露标题账本/请求hash/供应商正文。
5. **入口与安装**：workspace create 必填 autoTitle，前端新建默认 true，显式命名/SDK调用由调用方指定；直接 HTTP create 为人工标题。存储包含 agent_threads.title_origin 与 agent_thread_titles，注册快照列和真实decoder，运行时不隐式补旧值或自动删除数据。
6. **数据、事务与并发**：pending→automatic 的首次 claim 原子保存摘要、递增 Thread version；仅 thread_sequence=1 的 Root 原 create_run 身份且当前可执行时可 claim。独立 Thread version lease 不受 Run 文本增量改版影响；reserve/dispatch/finish 在事务复验原创建hash、Run活跃期限、冻结Provider与当前Thread来源/version。人工 rename 总是转manual；最后命名按原版本CAS，晚结果不能覆盖。账本请求/token/并发并入原Root/Child总量；未派发失败释放token，未知派发保留预留，真实usage成对记账。
7. **生命周期与失败**：前台首模型派发后才启动可选任务，同模型最低支持思考等级、无工具、最多2000码点输入/2048输出token/4096字节正文，最终标题按128 UTF-8字节码点截断。Images/额度不足保留摘要。独立10秒和原期限信号，前台步骤结束立即取消并排空，终态前收口；取消/撤权/重启将reserved置failed、dispatched置unknown，不重放。普通命名失败只日志；存储提交未知或资源清理失败仍按原Run安全围栏处理，不假装清理成功。
8. **当前能力与验收**：参考OpenCode固定提交49a112f的独立标题任务和人工改名保护；源码与静态证据见testing，D17下真实模型、竞态、快照及手机行为待验。

### 模型请求数配置与执行额度

1. **职责与范围**：Execution是管理员模型请求预算和硬限制的策略owner；400仅为默认硬限制，不能作为额外的不可配置执行门槛。
2. **子功能与目录**：沿execution Service/SQLite解码、governance规则、RunExecutionOwner和run-participant/run-step SQLite Adapter，不新增模块或保存路径。
3. **依赖方向**：双端设置/codec与Backend读取Shared基础取值；Governance的同义范围引用Execution取值，不再复制400等上界。App覆盖的实际准入仍在事务核对管理员已保存硬限制。
4. **类型与转换**：ExecutionLimits、StoredExecutionLimits、Participant各自保持独立类型和白名单转换。Shared步骤索引使用AGENT_RUN_STEP_MAX_INDEX表示安全整数，退出旧固定步数常量；工具元数据解码同步，不变HTTP字段。
5. **入口与安装**：原普通预算PUT与硬限制preview/confirm入口保持；默认预算80和默认硬限制400保持，允许手工设硬限制800后再提高普通预算，修改不自动增额。
6. **数据、事务与并发**：Run执行循环使用Participant可用请求数，不再取固定400的最小值；Root不叠加独立步骤额度，Child继承冻结预算。每次reserve仍在原事务核对Root/Child/摘要/命名共享账本，步数不替代实际模型调用计数。子任务max_requests CHECK随Shared范围定义；后续约束变化归迁移 SQL，业务运行路径不保留旧400约束。
7. **生命周期与失败**：沿原CAS、身份/授权、配置修改围栏旧Run、实际占用核对与未知结果恢复；降低硬限制不能低于现有预算。安全整数边界避免计数/JSON/SQLite数值精度丢失，不声称任意大任务的资源验收已通过。
8. **当前能力与验收**：产品操作见USAGE后端执行设置，Shared/两端静态与构建、待验场景归PLAN/testing；未操作线上配置、旧库或真实供应商。

### 可编辑硬限制与技术容量

1. **职责与范围**：Execution拥有全部15项可编辑硬限制和默认预算；默认值不作为不可配置产品上界。Shared只定义正安全整数、Node/SSH单次计时器和Date表示约束。
2. **子功能与目录**：沿execution/values、Governance、Memory Recall、context/result-rules、Run Collaboration、Tool Job、Integration/Browser及RemoteMachineOperationService，不新增兼容入口。
3. **依赖方向**：两端控件/codec与SQLite解码消费同一Shared表示范围；Platform MCP只持SDK实际计时器上界，不借Agent策略。业务owner持冻结预算，Adapter持真实资源和SQL。
4. **类型与转换**：独立应用/存储/Shared对象与白名单mapper保持；完整HTTP/WS响应形状不变。移除Child历史条数常量，响应编码预算保持2064384bytes，独立于工具额度；批量Child预览过大时省略正文而保留原文读取能力。
5. **入口与安装**：全部硬限制仍沿原preview/confirm和普通预算保存；默认值不变，不自动增额。Recall输入/工具定义不再额外限20，预览只在未指定预算时默认8KiB，不再强制截到8KiB；Child依赖/join/cancel不再限4，Platform模型工具声明的数组maxItems只校验正安全整数和范围关系，不再另限128；实际参数仍由完整编码预算与工具owner校验。Shell Job列表offset按64项页预留加法空间。
6. **数据、事务与并发**：Recall候选窗口至少覆盖请求条数；Token、消息及文件总量比较改为剩余额度减法，避免大额度加法精度问题。Artifact总空间与HTTP Range使用正安全整数，期限换算校验Date TimeClip边界。本批没有新增DDL，持久数值转换需求按 H-21 新增独立迁移。
7. **生命周期与失败**：Remote活跃操作/Job不再固定8，Integration/Browser待处理及Browser会话不再固定16，原实际资源、冲突、失败留存、停机排空与故障保护保持。工具运行的外部signal包含冻结超时/Run期限，Integration/Browser不另套60秒总期限；MCP SDK每次请求显式使用其Node计时器最大表示值，由外部signal提前取消，不能用timeout=0冒充禁用（SDK实际会创建0ms计时器）。Browser导航/返回禁用独立导航计时器，原scope负责取消并关闭，CDP单次控制/握手/清理期限保持，避免无界等待收尾。
8. **当前能力与验收**：安全整数不代表无限资源；工具单次捕获256KiB、参数16KiB、分页/完整编码与Browser二进制表示仍独立保护，不改成总量预算或无界缓冲。按D17仅源码/静态/构建，实际大配置、>8/>16并发及>60秒工具行为待正式回归；USAGE与testing分别持操作与证据。

## Agent 额外门槛清理

1. **职责与范围**：恢复正常模型等待和可恢复工具失败；保留任务族总预算、授权、审批及未知结果围栏，UI设计不变。
2. **子功能与目录**：Execution持准入，RunExecutionOwner持等待，ToolService持失败与投影，Context持持久续轮，Collaboration持活跃Child与完整输出读取。
3. **依赖方向**：原Service→Model→Storage；本地容量等待使用p-retry8，仅重试ModelCapacityBusy，OpenAI SDK继续独占网络重试。
4. **类型与转换**：Participant/StoredParticipant显式增加outputBytes；模型结果只带有标记预览，完整正文经原族关系续读；公开元数据无正文，Shared严格容量同步。
5. **入口与安装**：模型请求数只受Shared正安全整数表示边界和已保存硬限制约束，默认预算80/默认硬限制400保持；工具次数同样只受Shared正安全整数表示边界和已保存硬限制约束，默认硬限制4000及已有预算保留；十个协作工具声明更新到4.0.0，不保留旧参数兼容。
6. **数据、事务与并发**：忙错误在派发写入前抛出并回滚；每次等待后重新做原CAS/准入。p-retry不接收signal，避免派发已提交后被其取消检查遮住；每次尝试前检查原取消，等待最长250ms响应取消，未知存储失败不重试。模型收到finished后以原步骤CAS持久记录response_received，先释放模型并发再等待标题/摘要/Child；该单调资源事实不改变正文revision或Run终态，快照列与decoder同步，重启仍按未结算派发保守对账。Child名额结合事务活跃数和原owner实际占用，历史不再累计四个。
7. **生命周期与失败**：确定参数/不存在等工具错误持久failed后交回模型，Context快照及后续历史接受带正文的failed；权限、变更已派发未知及清理异常仍停止。工具捕获256KiB、模型步骤2MiB不变；预览与续读保留完整原文和可核对hash。
8. **当前能力与验收**：源码两轮复核及静态证据见PLAN/testing；按D17不新增或执行行为测试，不重启当前旧schema运行实例。

## Agent 结果续读与Child名额复核

1. **职责与范围**：小预览额度时仍完整交付结果续读页；错误hash反馈模型；Child名额按真实占用ID去重，不改UI设计。
2. **子功能与目录**：Context result-rules持唯一页预算，ResultService处理原工具结果，RunCollaborationService处理Child正文；ToolService传冻结预览额度。
3. **依赖方向**：原Service→Context纯规则及各自Model→Storage，未新增模块或依赖。
4. **类型与转换**：resultPage必填previewBytes，实际消费者同步；原ResultReadInput/ResultPage、hash、码点offset及nextOffset不变，不新增Shared字段或兼容接口。ChildAdmissionFacts/StoredChildAdmissionFacts明确持activeChildIds，Model复制转换；原执行owner只投影occupiedChildIds，不向Service交付任务对象。
5. **入口与安装**：tool_result_read与collaboration_output_read按冻结设置缩小页；projectCapturedResult复用同一预算，没有独立截断实现。
6. **数据、事务与并发**：先验证请求maxBytes为8..4096，再计算min(请求,有效预览额度-512)，有效预览额度由冻结配置决定并至少保留1KiB引用外壳；512bytes外壳余量容纳UUID/hash、数字及字段。只读不可变账本，原文/hash保持，游标按实际码点推进。Child准入在原事务合并数据库的pending/running/unknown及未结算工具所属Child，与本机尚未收尾任务的ID；对并集计数，既不重复计算同一任务，也不漏计不同任务。
7. **生命周期与失败**：错误hash属invalid_input，作为确定失败反馈模型后允许续轮；原授权、资源版本、取消、结果未知及清理保护保留，不绕过完整性检查。
8. **当前能力与验收**：两轮源码核对覆盖Unicode/转义、最小与默认额度、末页、hash、权限和历史续轮；本轮静态证据见PLAN/testing，按D17未运行行为测试。

## Agent Run 级批准策略与确定存储失败

1. **职责与范围**：Runs 持有创建时冻结的 ask/full_access 意图；Governance 持有审批/单次消费。全授权不修改 App grant 或普通 SSH 授权。
2. **目录**：原 runs/model/storage/adapters、governance/model/service/storage/adapters、interfaces HTTP/WS；错误分类 owner 为 agent-failure / agent-storage-failure。
3. **依赖方向**：Service → Model → Storage，SQLite 在原事务读取模式，经 Model 转换交给治理规则；不从前端或工具参数推断自动批准。
4. **类型与转换**：Shared runs/values 唯一定义 AgentApprovalMode；内部 CreateRootRunCommand / AgentRun、StoredRun / 创建命令及公开后端输入独立定义并逐字段映射。Shared 安全失败码 execution_storage_failed 不含技术正文。
5. **入口与安装**：HTTP create、workspace create/append、public create 及 HTTP/WS RunView 同步字段；存储结构签名以 `bootstrap/schema.ts` 为准。
6. **数据与并发**：agent_runs.approval_mode 非空有限值，创建 hash 包含模式，Child 创建事务复制父模式；快照列/解码与父子关系同时验证。自动审批绑定原 operation hash/revision、policy revision、目标版本和原用户，approved 后沿原 consume/authority 事务派发，未知提交不重放。
7. **生命周期与失败**：具名 SQL/constraint 失败区别于 commit_unknown/rollback_failed；无模型步骤的 pending 仅以原创建 hash/version CAS 结算，轮间以原 completed 步骤 CAS 结束；reserved 并发等待的确定拒绝结算 DISPATCH_NOT_STARTED。纯确定 SQL 失败聚合仍可分类，混合未知或清理失败保持原因，不推测。App/Provider/目标撤权仍逐阶段检查。
8. **当前能力与验收**：恢复聊天批准策略的真实执行链，未改变布局/风格；按 USAGE 操作。静态和两轮源码审核见 testing，真实审批/故障/取消和空库启动验收待远程，不把编译通过视为实机通过。

## Agent 审批历史分页

1. **职责**：Governance提供完整可遍历历史，单页最多64项；不以历史条数拒绝Run状态读取。
2. **目录**：沿原治理Service/Model/Storage及HTTP/Workspace mapper，RunStreamService与run-changes-ws调度推送。
3. **依赖**：Run仅消费治理应用页；SQL/索引归SQLite Adapter，插件SDK沿Shared严格解码。
4. **类型**：Shared AgentApprovalPage、应用ApprovalPage和存储StoredApprovalPage各自归属并逐字段转换；after为小写UUID/null，稳定ID升序及游标关联在协议边界验证。
5. **安装**：GET approvals可省略after；Workspace必传after；WS订阅游标必含approvals，重连从null开始，索引与精确结构签名同步，后续演进按 H-21。
6. **并发**：同事务核对Run归属、刷新未决状态、读取64+1行；按(user,App,Run,id)索引keyset分页。存储不截断历史、不扩大单消息容量。
7. **生命周期**：WS逐页沿原ACK背压发送；扫描中发生state变更后再从首页扫描，more保留待交付状态，Run终态不提前结束。审批批准与真实消费权限事务保持原约束。
8. **验收**：保留原卡片和完整历史，静态及复审证据见testing；大历史、并发决议与断线真实行为按D17待远程，不以编译通过替代。

### Artifact 总空间准入与二进制生成

1. **职责与范围**：ArtifactService拥有总空间准入，去掉16MiB单文件政策及10,000项累计准入；Execution只保留总空间与保留时间。
2. **子功能与目录**：沿原artifacts/execution/providers/integrations；ModelImageRequest的maxBytes属于Platform技术契约，SDK adapter负责编码预算与技术上限。
3. **依赖方向**：ProviderImageService和BrowserService向ArtifactService取得当前可用字节，再由各Model显式传入Platform；Platform不依赖Agent或Shared业务政策。
4. **类型与转换**：删除maxSingleArtifactBytes所有写入/视图/存储文档及mapper；ArtifactFacts不再保留无消费者的totalCount，Sqlite仅聚合字节。图片应用预算经Service→Model逐字段写入技术请求，输出仍经Model隔离。
5. **入口与安装**：原HTTP路由不变。PUT内容直接流式写入，实际长度由reservation约束；不把10GiB内容容量放入maxBodyBytes或提高全局JSON内存预算。
6. **数据、事务与并发**：availableBytes为预检，冻结Run设置总空间减用户已有占用（含预留），再与磁盘余量取较小值。begin在事务内继续核对settingsVersion、实时totalBytes及新增声明字节，并保留磁盘64MiB余量；生成期间并发占用可能使最终准入失败，预检不是空间预留。
7. **生命周期与失败**：图片请求编码预算从允许解码字节推导；Node MAX_STRING_LENGTH/MAX_LENGTH决定整体JSON/Base64技术天花板，保留64KiB外壳余量。浏览器CDP二进制同样受字符串表示容量约束；会话经Model提供maxUploadBytes技术事实，Artifact在加载完整上传内容前检查，超出时不先分配巨大Buffer；显式download.maxBytes可主动缩窄本次下载，省略时用实际剩余空间。保留格式、权限、hash、版本、取消及unknown围栏，不自动重试付费生成。
8. **当前能力与验收**：16MiB/8MiB业务限制已去掉；整体Base64路径依然需要比文件更大的内存，运行时技术限制不等于可承诺的内存容量；大体积/配额并发行为按D17待验。现存旧设置/冻结文档不自动迁移或删除，新版本使用当前结构。

## Agent 步骤与工具审计移除

1. **职责与范围**：删除专用审计读取功能，保留 Run 执行、governance 审批、恢复和快照完整性校验。
2. **子功能与目录**：runs 清理专用 getTool/listToolEvents/getStep/listStepEvents 公开查询链；interfaces/http 撤销对应四端点；snapshots 保留内部事件解码。
3. **依赖方向**：聊天从线程工具列表读取状态；审批由 governance 持有；Run stream 继续交付正文和状态。
4. **类型与转换**：Shared 删除审计专用 HTTP/展示 DTO；内部 StoredRunStepEvent、StoredToolEvent 供事务和快照消费。
5. **入口与安装**：register/public 不再暴露专用步骤或工具审计；内部步骤 get 继续由执行 owner 使用。
6. **数据、事务与并发**：不改变步骤、工具和审批的同事务状态变更及 revision；内部事件日志继续参与备份一致性检查，当前表结构保持。
7. **生命周期与失败**：保留派发、完成、取消、重启 unknown 和审批 superseded 围栏；移除审计读取不触发任何运行写入。
8. **当前能力与验收**：前端、开发页、Shared 和测试消费者同步清理；静态检查与构建结果见 testing，正式行为回归待 Actions。

### 自动图片预览

image_generate、artifact_create、artifact_present、file_deliver 的可信成功结果派生 outputArtifactIds，工具说明与 Host 指引明确自动展示，无需模型拼接 Markdown 地址。前端 NativeToolArtifact 以认证 API 按需读取文件元数据，使用现有图片外观或文件卡、FilePreview 和下载入口；失败与过期不伪造成功。Base64 只经生成服务落盘，不写入聊天或工具列表。待批准及失败不产生成功预览；unknown 批次只展示其中已确认完成的文件；刷新后仍可从工具记录恢复，文件读取继续执行原会话与 App 授权。直接 Images 对话仍由程序生成展示内容，不依赖文字模型。

### 跨Workspace服务器点对点复制

1. **职责与范围**：Files负责剪贴板复制/移动权限和任务，NativeServerTransfer负责服务器间文件数据传输；支持直传优先和未开始传文件时的SFTP中转回退。
2. **子功能与目录**：复用files/service/file-copy、files/model/file-model、transfers/model/server-transfer-model和platform/transfers/adapters/native-transfer；不增加第二套凭据或SSH实现。
3. **依赖方向**：FileService→RemoteFileModel→ServerTransferModel→NativeTransferPort，技术句柄不进入Files Service；复用原机器Resolver和已信任主机公钥。
4. **类型与转换**：Files内部直接复制请求/回调归file-task-types；Native回调归transfer-port；Model逐字段映射，Shared原WS totalBytes/totalKnown承载进度，transferMethodUsed可选字段表达真实选定工具（准备期尚未选定时省略），经CopyProgress→FileCopyMoveEvent→WS mapper→严格decoder→客户端任务逐字段投影；Shared实际方法增加sftp，严格codec及双端消费者同版迁移。
5. **入口与安装**：原transfer.copyMove入口不变；发送和跨服务器粘贴复用原Remote Tools安装确认，归档保留实际依赖安装；register给FileModel注入同一ServerTransferModel。跨目标auto完整传入原生适配器，优先rsync，普通文件再选scp；缺工具先确认安装，跳过才进入下一候选，目录auto缺rsync时保留SFTP链接语义，显式发送可选scp；源侧SSH探测先于目标文件变更，工具/版本、路由或源到目标连接不满足时回退中转，同目标保留SFTP文件操作。发送与剪贴板均消费copyRemoteEntries和RemoteFileModel.copyDirect。
6. **数据与并发**：不改变双Workspace权限及机器突变围栏；只读取选择根元数据即可计算文件批总量。目录复制由rsync遍历，移动为安全删除保存源元数据，全部目标完成后复查再删源。
7. **生命周期与失败**：原生进程有同任务期限/取消，实际退出与临时凭据清理由Native owner确认；只对not_started的连接/工具/端点不满足回退；直传已经派发、清理或结果未知不换方式重传。SCP单文件通过SSH PTY读取OpenSSH原生进度，按源lstat大小换算字节；认证用0700临时ssh-client启动脚本包装SSH子进程，保持SCP前台进度；所有私有临时凭据均在同一清理owner收尾。安装等待受原登录/页面/源目标会话有效性及取消信号约束。每任务对已确定不互通的目标记住中转选择，不重复逐项探测。部分发布、源删除或清理未确认仍为unknown，不自动重试。
8. **当前能力与验收**：源码已接线，正式消费者与新增远程Actions用例覆盖单文件进度、内容、目录、移动和取消；生产网络吞吐未测，静态不代表实际速度。

复制与上传准备的父目录事实仅在当前任务Set内复用；共享分支祖先只读取一次，同分支串行、不同分支仍按原窗口执行。任务结束不跨任务缓存，实际上传写入仍复查完整祖先。Agent读取/搜索的下一次inspectInfo已完整鉴权，删除紧邻该调用的重复validate，不删除跨异步操作的复查。

## Agent Job 故障与 Run 等待收口

1. **职责与范围**：ToolJobService 持有 Shell 的执行与最终清理；RunExecutionOwner 接收原 Job 的不可继续失败并停止所属 Run/族的等待。普通非零退出仍是可供模型分析的确定结果。
2. **子功能与目录**：沿原 tools/model/service、runs/model/service/storage/adapters 修改，不新增监测定时器、执行队列或故障中心。
3. **依赖方向**：Run 将绑定原 signal/Run 身份的同步失败回调交接给 ToolService，再交给 Job owner；Job 不引用 Run Service。回调只停止准入和等待，资源排空仍归原 owner。
4. **类型与转换**：ToolExecutionScope.onBackgroundFailure 与 ToolJobPreparation.onFailure 分别由原应用 model 类型拥有。StoredRunFailure 区分工具诊断和 job_unknown 事实，RunModel 将后者转换为 Shared 的 tool_result_unconfirmed；SQL 行不进入 Service。
5. **入口与安装**：原模型工具、HTTP/WS 状态及三语错误区域消费新原因；不新增端点。foreground/status/wait/cancel/list 观察到 unknown 抛 ToolExecutionUnknown，不把它交回模型继续轮询。
6. **数据、事务与并发**：原步骤终结事务纳入自身 Job、Child Job 的未确认状态；活跃后台 Job 允许后续工具提议，阻止最终成功。endRoot 纳入已派发/未知 Job；终态仍由原 CAS、族围栏、工具围栏和审批 superseded 同事务完成。安全诊断从原 Job 和所属工具读取，支持重启及 Root/Child 关联。
7. **生命周期与失败**：原执行 Promise 等监控和清理结束后只通知一次；未知提交不补写 Job，真实清理失败继续保留占用和因果。Run 回调核对原 task/signal/user/App，不中断其他 Run，取消后的晚失败不覆盖 cancelled。工具派发、审批消费或完成的回执丢失时，使用已确认的模型提议步骤修订独立 CAS 结束 Root，不重试原工具写入；确定 SQL 拒绝仍按实际未确认效果选择 failed/unknown。中断传播保留具名执行未知，避免改报配置变化；终态通知独立于资源排空失败，二者都保留因果。
8. **当前能力与验收**：不承诺 SSH 断流后能证明远端停止，也不自动重派命令或释放旧围栏。定向真实 SSH/HTTP、受控存储故障、CDP 现有文案及静态检查的实际结果归 testing；不扩大为全量本地 E2E 或生产部署。

TAR 进度沿既有 NativeArchiveCommands → FileArchiveModel → Files Service → WS mapper，processedBytes 表示已处理的未压缩原生记录字节。GNU tar 显式使用默认 20×512 字节记录，每 100 记录发出原生 checkpoint；记录号在 TypeScript 校验安全整数后换算，扣除尚未完成的当前记录，不增加源目录预扫描。压缩条目计数继续来自原生 verbose，解压发布总量复用已验证 members；checkpoint 不作为退出或完成凭据，解压管道必须收到私有退出哨兵及成功状态再发完成标记，失败/取消和快照清理政策不变。

### Workspace 终端通知准入

WorkspaceFilesSession 为无 requestId 的 terminal.input 持有独立的串行批次 owner；每条先沿 Shared 解码并捕获原 workspaceId/attachmentId/generation，同附件相邻输入在原单次256KiB内合并。待派发和正在鉴权的完整消息字节计入既有 WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES（1MiB），空输入也计实际 envelope 字节；普通 RPC 和有 requestId 的输入保留原64个并发准入。没有新增时间、数量或字节阈值。

原 worker 每批调用 Workspaces.allowed，await 后再次核对 lifetime、附件与 generation，随后只调用原 WorkspaceService.write 一次；实际 Shell 背压及1MiB缓冲仍归 WorkspaceService。旧附件输入不交给重附着者，不因协议拒绝自动重派；关闭先停止准入，聚合等待 worker 与原 releaseWorkspace。批次类型只在本文件使用，未新增 Shared、Service 或存储契约。原OSC52零间隔输入与真实SSH/WS突发通知回归负责验证顺序和无截断，不以放慢测试或扩大通用RPC名额换绿。

Platform HttpWebSocketChannel.onMessage显式区分void与Promise：同步协议准入在当前帧完成，不制造微任务等待；异步回调仍串行排队、占用原64条/字节预算并由HTTP追踪。技术层只持文本/二进制队列，不识别terminal.input；防重入排空，异常先终止socket再释放，关闭/停机后的消息不再派发，二进制高水位及CLOSING恢复读取保持。Workspace注册同步accept，协议任务及输入鉴权分别由原owner追踪。

## 插件卸载配置清除

Scope 的可管理 App 查询在 LIMIT 前按 user_id/app_id 排除 removed 安装，getApp 与历史记录继续保留。Plugin installationDirectory 在同一 SQLite 事务读取安装与有实际 KV/配置的 removed ID；无 removed 时不扫描配置，其余按用户批读，避免逐项查询。PluginStorage 通过 register 安装 Governance/Integrations Adapter 的 retainedApps/clear 事务参与者，只持自己的 KV/安装 SQL；清除与安装修订递增、幂等回执同事务。清除范围为 KV 及旧操作正文、grants、execution overrides 与存活 MCP/ACP 配置/凭据；策略版本单调递增，不删除历史审批/任务/聊天/记忆/文件和必要安装墓碑。Integration 写事务拒绝 removed App，避免旧页面重新写入清掉的配置。数据清除仅允许 removed，原撤权和 runtime/Run 排空在卸载先行完成；卸载与后续清除分别确认，不宣称跨 HTTP 原子性。

## 插件作为唯一 Agent App 来源

1. **职责与范围**：Plugin 安装拥有 App 创建，Scope 只读取插件声明及管理实例启停/线程；没有内置应用或默认初始化。
2. **子功能与目录**：删除 scope/service/app-definitions 和内置安装任务，沿原 plugin-scope-sql、scope model/storage 及快照 Adapter。
3. **依赖方向**：Plugin 通过已注册 Scope 存储任务参加自身事务；Scope Adapter 核对插件信任；应用仍经 Model 转换。
4. **类型与转换**：删除 CreateApp 应用/存储/公开契约与 Shared 创建协议；声明只含 id/version/displayName/capabilities，移除 defaultEnabled，双端白名单 mapper 同步。
5. **入口与安装**：无 POST /agent/apps；GET /agent/app-definitions 按 authenticated userId 读取已安装插件。新库无 App/声明，GET 不写入。
6. **数据、事务与并发**：初始定义表移除 installed/default_enabled/source_kind，实例移除 is_default 和默认索引；安装仍在同事务创建唯一 UUID、政策和声明。推荐安装的启用及全部声明授权也在此事务写入；普通安装、升级和已有安装复用不恢复权限。后续存储变更按 H-21 交付；快照严格匹配当前表列及已验证签名包。
7. **生命周期与失败**：原安装未知、升级/卸载排空、授权围栏和启停 CAS 保持；任何 App 都必须通过当前插件身份信任校验，无内置旁路。
8. **当前能力与验收**：使用说明在 Agent App/授权章节；签名插件夹具覆盖原消费者，静态、定向回归与 CDP 证据归 testing，不以静态检查代替全量 E2E。

### Agent 工具声明与有限选项

1. **职责与范围**：Tools声明真实可调用能力及参数提示，输入解码仍是执行前权威；模型工具目录不代替实时权限。插件仅提供角色流程，不承担宿主工具实现。
2. **子功能与目录**：沿tools/model/tool-types、service/tool-definitions/browser-tools/collaboration-tools/mcp-tools及tool-input；模型投影沿runs/model/run-model-stream；技术schema沿platform/ai/model-port与adapters/model-request。
3. **依赖方向**：Tools应用声明→Run Model逐字段投影→技术Port→供应商Adapter；无Adapter引应用类型、Shared DTO穿透或跨一级私有调用。
4. **类型与转换**：文本field可声明已有有限choices；Model复制为独立string enum，Adapter核验并复制到Chat Completions/Responses schema。ToolCatalogFacts/State归Governance Model，StoredToolCatalogFacts只归storage并在Model投影policy/connectionIds，Service复用authorizationFact返回可用能力；新增目录ToolInput只属Tools内部模型，不新增Shared管理协议。仅同现有语义校验一致的值进入枚举，不改变合法调用形状；字节预算仍由输入边界实际计量，不将JSON Schema字符长度当作UTF-8精确容量。
5. **入口与安装**：Run每步经Tools.availableDefinitions将Child白名单目录与Governance.toolCatalog交集；首次目录读取允许pending（模型步骤reserve才进入running），后续读取允许running，终态/unknown均拒绝；Governance同事务读取App政策、Run选择与现存SSH类型，沿原authorizationFact筛选能力和未被denylist禁止的目标，目录不代替实际派发授权。Browser与ACP安全目录分别归原Integration子功能owner，工具账本和授权链不旁路；浏览器/项目上下文/MCP按动作给出不同用途、输入来源和下一步，减少泛化重复说明。file_write新建使用明确字符串absent，替换使用原hash。
6. **数据、事务与并发**：无schema变更；Governance存储新增目录事实读取并经Model白名单转换，SQL仅Adapter持有；请求hash包含实际投影后的声明，原付费请求不可变身份及独立工具账本/审批保持。
7. **生命周期与失败**：声明精简不放宽授权、目标绑定、审批、超时、取消、未知及清理。后台Job、Root/Child、Browser/MCP/ACP仍由原owner管理，独立能力不因名字相似而合并。浏览器发现只返回目标标识/版本/URL模式，ACP只返回当前所选SSH的启用配置安全元数据；均在交付前复查原工具授权。技术历史校验允许已完成调用不在当前目录，RunModelStream仍拒绝本轮未提供的新工具提案。
8. **当前能力与验收**：源码范围及真实消费者审核、静态证据见PLAN/testing；行为留D17远程回归，不以说明更短声称模型准确率或延迟实测改善。

### 推荐安装初始化启用与声明授权

1. **职责与范围**：PluginRepositoryService 的 installRecommended 是确认引导的新装入口；PluginService 决定启用/声明能力初始化，普通市场安装不接受客户端权限标记。
2. **子功能与目录**：沿 plugins/service、model、storage、adapters/sqlite，Scope/Governance 的原事务参与者分别持有 App 和授权 SQL。
3. **依赖方向**：Repository Service → Plugin Service → Model → Storage；register 只白名单装配存储参与者，Adapter 不依赖应用类型。
4. **类型与转换**：PluginAppInitialization 唯一归 plugin model，StoredPluginAppInitialization 归 storage；Model 显式复制 enabled/grantedCapabilities，activation 与 Scope 的独立存储命令在 register 逐字段转换。null 保留旧授权、新建为空；数组明确替换为全部当前声明能力。SSH 目标能力存储为 targets/sshMode=all，其余为 global。无 Shared 请求形状或数据库结构变化。
5. **入口与安装**：只有 installRecommended 传内部 enableWithDeclaredGrants；当前安装已存在时直接复用。安装提交成功再由原 Runtime owner 启动后端，前端收到确认才写 Agent 总开关。
6. **数据、事务与并发**：原 SQLite 安装事务准入读取当前身份、阶段、发布者与安装事实后作决策；声明/App/政策/grants/安装记录同事务提交。已安装幂等返回不恢复启停/权限；升级仍停用并保留授权。保留数据后由引导确认重装才显式初始化完整声明授权。
7. **生命周期与失败**：沿原任务 lane、期限与 Runtime owner 跟踪；事务失败回滚初始化。安装提交后的 runtime 启动失败保留 operation_unknown，不能虚报安装回滚；后续只读核对，不自动重装或写总开关。后续撤权、Run 目标、禁用名单和审批策略继续生效。
8. **当前能力与验收**：USAGE 区分推荐新装/普通市场/升级/复用；正式回归使用真实签名夹具和 SQLite 验证内部初始化、运行态及撤权不恢复。官方 pinned key 不替换，真实官方新签名包仍按 D16 保留实机待验。

### 图片预览偏好与 GIF 交付

1. **职责与范围**：Preferences保存个人imagePreviewMaxMiB，Agent Artifact HTTP拥有聊天图片媒体准入；Remote Files执行每次请求的二进制预算。
2. **子功能与目录**：沿presentation/model、storage、adapters/sqlite及interfaces/http映射；GIF只在agent/interfaces/http/artifact-http的原preview白名单增加，不新增路由/转码器。
3. **依赖方向**：Preferences应用校验与持久JSON解码消费Shared默认/表示范围；Remote Files只接收正安全整数maxBytes，不反向依赖个人偏好或UI设置。
4. **类型与转换**：imagePreviewMaxMiB为必填非负整数，默认20、0由前端解释为取消该项预算；Model和HTTP仍双向逐字段投影，SQLite严格解码完整字段。最大值仅保证MiB转换后字节数为安全整数，不设产品二次上限。
5. **入口与安装**：沿GET/PUT settings/preferences；GET apps/:appId/artifacts/:artifactId/preview允许PNG/JPEG/WebP/GIF，Content-Type按已存媒体类型，nosniff、private/no-store和Range沿原实现；生成响应同样允许真实PNG/JPEG/WebP/GIF，是否生成动画取决于供应商。
6. **数据、事务与并发**：原preferences_presentation.value_json/CAS拥有持久事实，无DDL变更或隐式兼容。后续持久字段变化由所属迁移脚本转换，并验证记录版本及快照边界；业务读取不补旧JSON。文件声明大小及实际流由本次maxBytes检查，不再固定64MiB；并发、帧/队列背压和独立SFTP资源沿原owner。
7. **生命周期与失败**：GIF流式返回原字节，原认证、文件ready/有效期/版本及持续授权复查保持；失败终止响应，不自动重试。文件读取继续绑定原Workspace身份、期限和取消/清理，调整上限不预分配该容量。浏览器可报告的复制/合并分配失败立即结束原等待、释放已缓存分块并取消未完读取，不因移除pending/timer后抛错而永久等待。
8. **当前能力与验收**：对应USAGE文件/聊天/偏好说明；Shared/双端check和生产build保持静态证据；本轮限定CDP已验证动画、设置持久化及65MiB读取完整性，取消/身份撤销/分配失败组合留正式回归，不扩大局部证据。

## 集成与插件边界

签名 Skills 使用 plugins/model/plugin-skill-types、plugin-skill-rules 和 PluginModel 的 packageSource/skillDocuments。包 Adapter 解码已签名内容，Model 严格 UTF-8 转换，纯规则校验 skills/<name>/SKILL.md 路径与有限 frontmatter；最多64份、每份12KiB。验证安装与备份候选复用同一规则。原 ToolService 提供 skill_search/skill_read，按 context.read、原账本/当前 App/安装修订授权，读取绑定精确版本和 SHA-256；不自动注入包提示，不接受 allowed-tools 授权。文档是后端内部应用对象，无独立双端 DTO。Run 读取独立执行并由 PluginService 的 pending/期限/关闭统一追踪，不排在会等待 Run 的管理队列之后；交付前复核安装修订、当前信任和治理权限。

Agent integrations有独立IntegrationService/BrowserService；HTTP mapper→应用类型，Model→独立Storage或MCP/Browser技术能力，SQLite只持有存储类型和DDL/SQL/持久JSON解码。MCP/CDP Adapter不认识App/Run/授权；MCP通用endpoint包含不透明key/generation，Browser只接受技术连接选项和应用提供的URL判定能力。真实调用进入原ToolService；Browser的Run资源由原drainRun关闭，MCP续接身份由应用owner生成并绑定原Run/输入，不直接消费远端token作为授权。

插件已接 Publisher/Artifact stage/verify/install、不可变版本、安装查询、Run 退役及前端资源读取。Service owns 信任、容量、安装/升级/卸载准入；Model 转换应用、独立 Storage、包/Blob 内容和失败；Adapter 解码 manifest/签名 files，仓库Adapter将PEM的CRLF规范为LF后再交付应用，官方固定公钥核对不受等价换行影响；Platform packages 只提供惰性 TAR/Ed25519 技术能力。包条目与整个展开 TAR（包括元数据/填充）都受限。Stage 登记→Blob 发布→身份/CAS 复验→staged 分别确认；启动按完整大小/hash 对账 staging，不重放安装。插件资源目录由 Bootstrap 的 `data-paths.ts` 从数据库父目录解析为 `plugins/`；与 `appearance/`、`artifacts/` 同属独立实例数据目录，不以数据库文件名拼接资源目录。

暂存缓存政策由PluginService持有：新建前保留127条确定无引用缓存，再写入新包；Model先验相同包hash/长度、原Blob完整性与当前信任后复用verified/installed stage，不改变原ID/version，因此retirement仍精确绑定。Adapter在事务内排除versions/retirements引用和未知staging后将待回收项置failed并清除验证字段；Model先确认Blob删除再按认领版本删除行，失败保留记录且汇总所有清理因果，不把取消当作完成。不可变版本/退役包属于实际资源而非临时缓存，不能淘汰。versions列表与当前用户安装记录一对一，完整不可变版本账本保留。

插件 SQLite 通过注册的 Scope 存储任务参加同一事务，实际 App/声明 SQL 仍归 Scope Adapter；不 import Scope Model/Service，不自动授予 grants。首次安装禁用 App、空授权；版本/hash/声明不可变，初始数据库不含内置来源、默认启用或默认实例字段；业务运行路径不保留旧数据兼容，备份仍严格核对目标结构。当前用户安装与 publisher 信任在 Scope 读取/授权事务核对。撤销、升级和卸载由 Scope 任务禁用/围栏旧 Run，Plugin Service 等待对应 Execution owner；draining 任务持久保存，重启不重放。取消退役保持旧版本与禁用状态。

前端资源使用与会话/安装 revision 绑定的短期 grant 路径；Service owns 名额及交付，Model 复验存活安装、包 hash/签名并转换字节，interfaces owns MIME/CSP/no-store/stream。只交付 frontend/ 命名空间，backend/ 与签名元文件不可读；匿名资源请求仍通过 grant 和原会话事务复查。独立插件数据具有明确model/storage对象；Model逐字段转换，Adapter解码JSON和事务事实，Service判断身份、当前信任/启用、CAS与总容量。有效数据按1024个有正文键/8MiB计，删除墓碑不占有效容量但保留CAS。每键仅最新有效操作保存正文，旧ID/hash/version元数据保留；更新、迁移或清除同事务退役旧回执正文，重放已退役回执明确version_conflict。删除/迁移回执不设累计32次拒绝。有效信任额度只计未撤销发布者，撤销身份不能复活。removed安装的明确清除只清正文，推进安装修订/数据墓碑并退役账本正文，保留旧意图摘要，原清除结果可重放。安装状态基础取值引用Shared，应用与存储对象独立；Stage/Publisher/Installation在Adapter校验身份、容量、时间及状态与验证字段的关联。单调版本耗尽在写入前拒绝，覆盖配置、凭据、安装、退役、清除及迁移，读取和既有确定回执不因此失效。

有限SDK/data RPC通过Shared agent/plugins/events与rpc-codec消费唯一协议，实际浏览器SDK归plugins/adapters/frontend；Shared不持有窗口/通道/计时器。SDK交付限定完整纯模块依赖图，浏览器import与已安装SDK路径显式链接；不公开任意Shared文件。HTTP先认证，Service取得名额后调用输入producer，模块mapper转内部方法；事务内复核grant期限/原安装修订/会话。HTTP输入producer与输出consumer区分预期拒绝/取消和基础故障，畸形输入与断连不停止全模块；Blob读取消是独立技术类别，Model转换且清理失败不被取消覆盖。HTTP把成功或安全失败关联到nonce/id/seq；响应失败不自动换operationId。原子写/重放/明确清除只在SQLite Adapter，资源交付名额覆盖实际stream及晚到清理；普通RPC结果交付归HTTP owner，断流仍可能是未知写入。

MCP owner统一计入已建立/建立中/关闭未确认资源，共享连接构造并取消、等待原构造；close绑定具体实例，不按当前key误关新实例。每连接仅一个固定DNS池，关闭等待池构造并执行SDK与池独立清理。Browser页面/节点按键保留组合键与原合法Key/Digit词汇，失败释放按键，聚焦前就失效旧快照。动作settleMs由工具Service选择默认250ms与Shared的0–2000ms协议范围，Model逐字段传为通用技术等待值，Node CDP Adapter执行有界空闲观察，只吸收正常TimeoutError；断开/取消仍传播。scroll的deltaX可省略为0；Shared动作取值覆盖全部15项。

两端SDK、实例持久恢复、仓库/推荐、显式迁移和备份导入恢复已有源码；既有专项验证真实签名包暂存/信任/验证/安装、独立子进程及包内依赖、Host数据CAS/幂等/墓碑、禁用/启用/正常重启、显式完整快照迁移/升级、撤销/卸载/清除，以及descriptor资源和有限HTTP RPC；原进程身份退出与物化目录清理分别核对。外观字体/CSS/HTML副本、PNG/SVG字节、HTML中文路径/同名重建/预置回退和活动终端主题删除引用也有有限整链证据；既有专项另已验证真实Chromium的签名sandbox/完整SDK依赖/MessagePort握手、关联失败后的写入unknown、32项等待、8订阅/回调失败收敛，以及HTTP intents创建/幂等/权限撤销/重启、140失效候选后的可见列表、100条发送容量、实际附件/Range与前端RPC分段；该轮父页是隔离测试桥，不能据此扩大正式页面行为覆盖。既有专项另已验证环回仓库配置/目录/签名下载安装、固定官方公钥和兼容推荐/离线已安装查询，以及真实子进程九方法的消息/附件/撤权链；官方新包完整安装、自然到期、已在途SDK/RPC撤权、其余崩溃与完整容量故障仍待验，不能据此宣称全部能力通过。精确签名以 `bootstrap/schema.ts` 为准，后续数据库演进见 DEPLOYMENT 的迁移策略。

Browser 补齐 back/scroll/press/select/wait 和 Artifact 字节消费：Service owns 端点顺序/退避资格、会话范围、操作期限及输出 Artifact；Model 转换独立应用能力和技术动作/字节/失败，技术 DOM/CDP 对象不泄露。会话交付在最后异步阶段后复查原 Run 与取消；快照采集及节点解析后复查原快照身份，节点对象由统一 finally 释放并保留操作与清理两项因果。Artifact 读取保护覆盖实际上传，版本/hash/原工具权限复查；截图/下载经原 Artifact 发布，而非大 base64 工具结果。下载策略限定本次 context，context、拦截任务、WebSocket 关闭分别确认。管理和执行共用同一配置 owner，正式管理页面已接线。

Integration 创建意图同事务保存首次安全回执，重放不从当前可变对象读取，删除集成不删除原回执；独立 storage receipt 无凭据正文，Model 显式转换，备份复用其 Adapter 解码器。Integration 原行/回执解码同时核对 MCP 的规范端点及私有 authority、ACP argv/cwd、身份/版本/hash/时间与 Shared 基础容量；不依赖 Shared 业务 codec。Browser 存储解码同时验证端点/明文许可/页面模式/数量和唯一性，恢复不放宽配置语义。

MCP 模型 discovery 直接消费真实 App 配置和目录，返回安全 ID/version/schemaHash，不要求人先刷新；目录选择/资格与 hash 一致性政策归 Service，Model 转换技术目录及哈希事实。管理页保存的 schemaHash 是观察值；调用必须与实际重取目录一致。input_required 的本地身份继续绑定原 Run/输入，不能重放未知副作用。Service 将128项待续接与在途预留统一计数，派发前取得续接名额，finally释放预留；异步返回后复查取消/关闭，已派发工具不降为确定不可用。Model保留后续存储/内部失败，不能将未知提交改写为可结算的远端执行未知；管理刷新在真实写事务的准入回调复查取消。关闭只由原任务观察者记录一次失败，远端结果未知与资源清理失败分别判定。MCP 客户端名称/产品版本由 Agent 安装传入通用技术契约，Platform 不硬编码产品身份。保存配置的 ACP 执行与直接 ACP 执行使用一致的 destructive 审批风险。AcpPermissionService 的准入和 Runs Adapter 的父关系复查同时识别两种真实父工具名，内层操作仍绑定原父 id/hash/target/version/modelStep；Child 使用继承工具集合中获准的父入口，不额外授予直接执行工具。每项内层许可独立审批及消费，外层批准不能代替。幂等创建先认证/核对原意图，再仅对新记录检查容量。

既有专项验证MCP实际SDK/HTTP的固定协议发现、工具/资源/提示词及独立续接、目录变化与断流/取消；ACP实际SSH上的直接/保存入口、仅允许保存入口的Child、独立内层批准/拒绝及取消；Browser实际CDP上的导航/快照/console/截图元数据、一次点击与旧快照/错Run拒绝、原context释放。外部Provider与MCP/ACP端点输出脚本化，真实资源/授权/存储不被替代；截图现已下载核对实际PNG字节/长度/hash并由浏览器解码；既有专项另已验证128个pending MCP真实握手的准入/同key共享与全局排空、SDK/dispatcher单或双清理失败；实际CDP的context/page/configuration构造取消、单次context关闭、操作与清理因果、按键释放和截图预检、握手中断。应用owner另已验证128续接预约、16任务准入/排空、刷新等待真实SQLite事务期间取消，以及ACP/Job在途权限监控的等待和失败因果；这些受控接缝证据不代替全部SDK/SSH与治理存储集成交错。其余动作、配额/期限、撤权和关闭故障全集仍待验，不能扩大为集成全部场景通过。

## Artifact 在途交付边界

普通Artifact HTTP及跨App intent HTTP均由原ArtifactService.readGranted持有实际lease，ArtifactModel转换Blob能力/失败，NativeBlobStore以finally关闭原文件句柄；HTTP pipeline持有响应断开/整体期限的取消信号。每块和流结束前核对当前授权及原文件版本，不对已写入传输缓冲或已交付字节承诺撤回。意图可见性归PluginIntentService，失去可见性不删除原持久grant；未撤销且未到期的grant保守保护源文件，发送者显式撤销同事务解除保护，实际读取lease独立收尾。

既有有限回归已用真实16MiB内容、暂停HTTP消费者和Linux原blob文件句柄确认在途，覆盖断连/注销/停机、版本变化、双方授权/禁用、回执撤销与准备升级；旧回执不复活，新会话/受控重启可重新读取仍有效回执。删除成功保留deleted墓碑，content拒绝读取。应用级HTTP RPC和真实后端SDK另以Linux内核确认原Blob open已派发后，验证双方grant、回执撤销、启停和旧实例升级排空；每次失败均不输出部分字节。Artifact授权绑定原文件版本，版本变化使原grant不可读，需新回执；重新授予App权限也不复活原回执。HTTP会话注销和后台实例授权分别处理，后者继续复查自身安装/当前授权。范围仅上述分段读取链，不代表全部方法、副作用未知、自然期限、混合清理或数据库未知确认通过；无新Platform业务类型、DTO、迁移或注册出口。

## 有限后端运行时与仓库接线

PluginRuntimeService持有实例、共享构造和host任务；PluginService保留管理/资源/data用例，plugin-rules持有两者共用的信任与数据CAS/配额政策。Scope启用回调进入runtime.reconcile，禁用/撤权同时取消Run与runtime；升级/卸载独立启动 Run 和 runtime 排空，一项失败不跳过另一项，全部确认后才能继续；取消退役保留禁用状态。最多32实例/2构造，每实例最多32个IPC host等待；Runtime的32项pending预算属于生命周期任务，不是全局host共享额度。实例额度在异步持久预留前同步占位，成功绑定owner后交接计数；已绑定owner仍等真实关闭确认后释放，避免31实例时两构造同时取得最后一个名额。原构造包含包读取，单个等待者取消不终止共用构造，关闭保存共享Promise并等待开机、进程退出和host任务，未确认清理不释放占位。Platform以exited Promise通知实际进程退出，正常退出与异常失败分别表达，Model转为应用失败；PluginRuntimeService观察原实例并围栏、取消读取、启动原实例关闭，观察回调不等待自身触发的关闭Promise。仅在close已确认时等待退出观察，关闭失败不追加无期限退出等待；资源清理与实际退出分别确认。持久观察和启动进程/目录对账已接线，规则见下方运行实例恢复边界。

PluginModel将原包/存储事实、九个host方法和失败显式转换；plugins/storage/plugin-runtime定义独立协议任务，plugins/adapters/runtime是Shared SDK/IPC投影owner。Platform isolation仅有文件/hash、opaque contextJson/host回调与通用activate/health/quiesce/close，不定义App/manifest/授权。Node Adapter生成独立进程、清理宿主环境、使用Nodepermission与只读文件授权；禁子进程/Worker/addons、控制V8堆，未声明OS或网络隔离。Shared backend-sdk仅是纯类型，真正进程、timer、pipe与临时文件留Platform。NodeModuleInstance的首次故障闸门与后续失败账本分别持有：首个故障阻止新交付，后续独立失败由原host/write观察器登记，保留最近16个样本及溢出计数；排空等待观察器收敛后读取一次，不从allSettled再次重复收集。同一写入拒绝先归一为具名技术失败再传播，已派发host的技术拒绝仍为execution_unknown；后续异常按弱身份去重，避免write/host重复登记或强引用无限异常。已有故障触发进程终止后的close通知不再生成无独立原因的第二个故障。实际进程退出与host任务/目录清理分别确认，旧owner收口不影响替换实例。Linux /proc身份和命令探测仅将ENOENT/ESRCH视为进程消失；命令读取失败仍复查原出生身份，普通日志文件、权限和其他读取失败继续上报。当前已接host.appInfo/data/intents及Artifact分段读取；前端Agent协作能力走WorkspaceService并调用原Scope/Thread/Run/Provider/Context/Governance，后端仍限定九方法；不建立新的执行或审批中心。

PluginRepositoryService持有用户源、版本兼容/官方固定发布者、选择及推荐安装政策；所有源读写和目录/下载操作共用串行lane，防同一用户配置在下载中被替换。Model转换独立repositoryStorage/目录/内容与失败，Adapter负责持久JSON、上游JSON/相对URL/字节hash；平台BoundedFetch只执行调用方明确的有界redirect政策和响应体清理，默认仍不follow，不认识官方或Plugin。读取失败后cancel若重抛同一原错误，保留原读取失败；仅独立cancel/release异常归cleanup_failed，不将普通上游断流升级为模块排空故障。目录/下载继续进入原PluginService.stagePackage→Model→包/Blob/SQL，实际签名与请求App/version/publisher匹配先于stage副作用；安装不自动启用或授grant，已撤销官方信任不能重新登记。

repositories由所属 Adapter 安装，读取未保存状态明确version=0，CAS/身份同事务。Bootstrap经通用包metadata Adapter按模块相对URL读取实际根package.json，并安装productVersion；不硬编码版本、依赖CWD或让Platform选择兼容政策。管理HTTP和Shared repository-{model,http,http-codec}已接真实消费者，正式前端已接线。Repository Service同一lane串行目录/暂存和配置写入，不能把排队更新描述为已在读取中生效；SQL身份/CAS复查归原Adapter，Model显式转换。仓库stage在返回前执行真实包检查/信任验证，成功为verified；Artifact stage仍显式verify。既有有限行为覆盖环回源、严格目录/兼容性、下载hash/身份/撤销信任及注销后晚结果、推荐离线读取和子进程九方法；官方新包/自然期限及其余未验限制归testing；已在途SDK/RPC附件读取的有限验证见上节，不扩为全部插件操作。既有专项另验证8任务准入/溢出不派发/结算回收、包下载断流后可继续、下载中注销拒绝晚发布和关闭中止原网络读取。PluginService管理lane内的撤销排在当前stagePackage后生效，不声称即时撤销下载。仓库协议、官方推荐、SDK 与生命周期见 USAGE；最新签名见上文，源审/静态/待验分别归testing。

## 运行实例持久恢复边界

运行时实例先持久登记opening，再创建进程，成功激活/health及权限复查后登记active；关闭确认登记closed，执行/清理未知登记unknown。实例身份与安装revision分离，启动先对账db.path+'.modules'的私有物化目录：Linux /proc birth identity、原worker路径及原父进程均核对，活父进程、缺失spawn身份、畸形目录或未确认退出/清理均阻止开放服务；不能只凭PID杀进程。owner/spawn/process journal和目录创建/删除做fsync。启动将上次opening/active围栏为unknown并跳过，不自动重放activate或旧任务。查询/确认归PluginService→Model→Storage→SQLite，通用Platform不持有App/用户类型。

管理员GET /api/v1/agent/plugins/installations/:appId/runtime查询当前实例，GET /runtime/:instanceId查询该App历史实例；时间为毫秒。POST /runtime/acknowledge严格输入{expectedRevision,instanceRevision,instanceId,confirmed:true}：expectedRevision为当前安装修订，instanceRevision为原实例修订，不能借用一份版本。只有本地无绑定构造/实例、持久状态unknown或同实例已closed时允许，认证与安装CAS在实际事务复核；确认只解除围栏，不启动模块，不声称旧外部效果已回滚。保留unknownAt/acknowledgedAt及原实例历史，新实例不能覆盖旧未知证据。升级/卸载遇未知实例仍保持draining，确认后以当前安装修订继续原操作；运行中未知owner须先完成服务重启与目录对账，不靠确认跳过实际清理。既有专项验证原child被SIGKILL后的unknown、失败关闭因果、重启不自动激活、原实例/当前安装修订确认及幂等、显式重新启用与历史隔离；quiesce内调用在worker边界拒绝，不代替已在途host RPC/流中撤权验收。正常closed且unknownAt为空的诊断历史按App循环保留最近128条，容量由Runtime Service经Model传入Adapter，历史不再造成累计4096次构造拒绝；当前/未知/曾未知后确认的实例证据不裁剪；实际host数据写入在异步查询/写入后、提交前再次复查原实例与当前授权。

Access已经提供窄provePassword公开能力，内部PasswordProof归authentication/model，CredentialConfirmation归accounts/storage；账户hash和原会话digest在实际事务执行时复核，技术失败在Model转换、公开失败在Access出口转换。System backups导出已消费该证明，并在采集和交付前复验；导入仅要求当前完整管理员会话，password 是备份解封密码，不复用导出的当前登录密码证明；维护后再次核对原会话，认证表不恢复。既有专项验证跨实例不同密钥下Artifact字节、SSH私钥和Provider凭据真实消费及重建，目标密码/当前会话不被源认证覆盖；上传中断名额释放、待上传时登出拒绝及实际文件hash损坏拒绝均有回归，未知提交与完整文件类型/故障仍待验。

已有实例unknown拒绝新的构造/退役以AgentResourceFenced表达，公开仍为operation_unknown；它是未派发的新准入拒绝，不触发其他App的故障停机。复合排空由Agent错误owner的aggregateAgentFailures保留类别：全部子项只是已有围栏拒绝时继续为AgentResourceFenced，包含真实关闭/提交失败时仍为故障并保留全部cause。PluginService的卸载/发布者撤销及Runtime撤销共用该转换；不以通用operation_unknown包装抹去已有围栏的类别。既有专项验证32实例/2构造边界、同App共用构造、批量撤销中的独立quiesce/dispose失败与健康实例收尾，以及卸载unknown重启→旧围栏拒绝→明确确认→继续卸载；目录清理失败/数据库确认未知仍分别待验。新存储提交未知、实际进程/host/清理失败仍保留真实故障并停止所属owner准入，二者不能混淆。

## 前端SDK与显式迁移边界

ThreadService持有名称归一、512个实际线程容量及明确区分的插件/原生会话准入；历史命令不再计入4096次终身配额，原幂等身份与结果保留；ThreadModel持有应用/Storage转换，Thread SQL持有keyset、CAS和不可变原结果。普通HTTP创建也在同一存储事务消费同一线程容量。线程存储→应用转换唯一归scope/model/thread-mapper，协议投影唯一归interfaces/http/scope-mapper。新Thread具有必填version/updatedAt。Provider可选模型的protocol来自实际resolve结果，不由配置缺省推测。

WorkspaceService使用原RunService与ContextHistoryService：Root列表按thread_sequence续页；entries只读Root用户输入和模型文字事件，按码点分片，不读工具/私有reasoning。SQLite技术函数nexus_text_length/slice保留NUL和Unicode；片段未完不推进后项。appendInput在原Root终态/version同事务校验后创建同Thread后续Root，原身份/version纳入幂等hash，模型/连接重新显式选择，不注入活跃上下文。

前端RPC由Shared frontend-events/frontend-rpc-codec定义27方法；core events/rpc-codec/backend-sdk仍只有九方法。前端完整预算8MiB+1KiB，descriptor的maxMessageBytes同源声明；核心子预算/IPC仍512KiB。SDK由Backend构建时通过esbuild打包实际Shared及第三方依赖，以独立浏览器ESM交付；不再运行时改写import或维护拆模块白名单。frontend-sdk仅持有纯类型，窗口/MessagePort/计时器归原Frontend Adapter；Run订阅是500ms有限轮询原事件分页，不是新增WS/事件中心。退订取消原读取并等待，close共享Promise，异步回调由原订阅追踪，过期结果不发布。正式父页也已消费当前契约。

组合写入经PluginModel→Storage→SQLite技术admission scope，在实际事务前后复核原会话、安装revision、启用、publisher与期限。排队操作捕获原scope；原RunExecutionOwner通过RunModel的应用任务能力明确脱离请求临时scope，再按自身持久权限执行，不意外继承浏览器grant的生命周期。最终响应前再次复查，已提交变更失去确认时返回unknown，不换意图重发。

插件迁移从旧可执行migrate回调改为管理员显式快照转换：prepare-upgrade排空并停在draining→读取snapshot→提交含全部有效键/版本的完整数据集→原目标upgrade。政策、配额及取消退役限制归PluginService，Model转换及指纹，Adapter同事务核对快照版本、写数据/墓碑、推进安装revision并记录不可变migration回执。retirements.base_revision区分迁移前后；迁移已提交不允许取消退役。未知数据库提交不重跑转换或插件代码，重启保留draining。1024键/8MiB正文/52MiB完整线预算，32个迁移意图；R1/R2 全应用备份已接线，整批审核与行为验收分别执行。

## 模型文件交付

1. **职责与范围**：Tools 将模型产物交付给用户，Artifact 持内容/配额/期限，Remote 仅读取已选 SSH 文件。image_generate 接受真实 PNG/JPEG/WebP/GIF，动画能力取决于上游；file_deliver 可交付已有二进制，artifact_present 展示当前 App 的 ready 文件。
2. **子功能与目录**：tools 持声明/解码/用例；Remote files 持受检流、machines 持独立资源；Platform blobs 的 ContentInspector 复用 file-type 检测；ArtifactModel 隔离技术识别。Frontend runtime 文件卡复用原 FilePreview/Artifact 下载。
3. **依赖方向**：ToolService → ToolRemoteModel → Remote public，ToolService → ArtifactService → ArtifactModel → Platform；HTTP/Native 消费 Shared；无新文件服务器或预览引擎。
4. **类型与转换**：Remote public 和 machines/model 各自持文件元数据/字节消费契约，边界逐字段转换；技术 MIME 检测归 Platform，应用内容归 artifacts/model。outputArtifactIds 为统一文件引用，由有限可信成功工具结果派生，经 storage/Model/register/HTTP/Native 白名单转换，不公开原始工具结果或任意 URL。
5. **入口与安装**：file_deliver({connectionId,paths}) 同时要求目标 file.read 与全局 artifacts.write 并按突变审批；artifact_present({artifactIds}) 要求 artifacts.read，不复制文件。目录与运行时同时校验，Host 指引告诉模型工具会自动展示，不拼 Markdown 地址或 Base64。
6. **数据、事务与并发**：复用 agent_run_tools.result_text 与 Artifact begin/upload，v3 独立迁移将历史 file_deliver/artifact_present 结果转换为批次数组。现有总空间预留、hash、版本、期限与授权事务保持；文件引用不自动 retain/share/attach。
7. **生命周期与失败**：Remote 持读取资源直至消费者完成，逐块复查权限/取消和长度，EOF 前复查类型、大小、修改时间，再允许 Artifact 发布；拒绝目录/链接。检测仅缓冲库要求的前缀，后续流式复制；Remote 公开流在读取与 iterator 清理时同样转换安全错误，ToolRemoteModel 转为 Agent 失败；ArtifactModel 保留源读取拒绝与消费者的持久化失败，取消不冒充内部故障，真正的关闭失败仍保留并阻止虚报释放。任何失败/取消/unknown 不显示成功交付。前端按需读取元数据，元数据/预览支持取消与卸载清理，原生下载由浏览器及原认证 HTTP 流拥有，刷新从工具账本恢复。
8. **当前能力与验收**：参考 [LibreChat](https://github.com/LibreChat-AI/LibreChat/blob/f4154b649efa37e1345ccc517a4d8d1ed2178c82/api/app/clients/tools/structured/OpenAIImageTools.js) 的工具文件引用和 [Open WebUI](https://github.com/open-webui/open-webui/blob/c38885a1a737da4968f157092f304f3b5481d0bf/src/lib/components/chat/Messages/ToolOutputFile.svelte) 的工具输出文件展示；依赖复用本项目现有 file-type、Artifact 和 FilePreview。实现与验证状态见 PLAN/testing，静态不代表真实模型和远程故障验收。
