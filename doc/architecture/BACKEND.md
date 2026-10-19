# 后端架构

本文约束新后端及后续功能的放置和依赖。开发前由 [AGENTS](../AGENTS.md) 读取 [人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 与 [编码规范](../rules/CODE_STYLE.md)。按 [模块模板](MODULE_TEMPLATE.md) 维护下面八个章节，不复制人工规则和编码列表。

## 1. 职责与范围

### B9 Targets 导入补齐（源码收口，行为待 B10）

Targets的Proxy/SSH Key/Tag列表在HTTP出口使用Shared管理集合预算（10,000项，Proxy完整JSON 64MiB、SSH Key/Tag各16MiB），超限返回413 limit_exceeded，不截断或交付部分列表；单项白名单仍由target-http-view持有。正式前端已消费对应Shared管理契约，其他Targets前端迁移状态归当前实施方案。

1. **职责与范围**：Targets import 持有批量连接导入，恢复文件上传、密码/私钥/代理凭据及逐项结果；不导入旧密文或兼容旧字段。连接测试的实际 SSH 生命周期仍归 Remote。
2. **子功能与目录**：沿用 import/service、model、storage、adapters/sqlite；HTTP 上传解析留 interfaces/http。SSH Key 与 Proxy 事务任务由原子功能 Adapter 提供，register 安装明确参与者，不复制 SQL。
3. **依赖方向**：HTTP→Targets 入口→ImportService→ImportModel→独立存储任务→SQLite；Model 加密明文并投影命令，Adapter 不读取应用类型或 SecretBox。
4. **类型与转换**：Shared connections/http 独立定义导入写命令和私钥联合，values 定义上传字段/容量；入口逐字段映射内部命令，Model 逐字段映射密文存储命令。文件是新格式的命令数组，不接受旧开发密文；结果不返回密码、文件内容或技术错误。
5. **入口与安装**：同一 POST /api/v1/targets/connections/import 按媒体类型接 JSON items 或 multipart connectionsFile；严格 UTF-8/JSON 和项目数量校验，文件内坏项返回安全逐项错误，其余项继续。正式前端 F1 迁移文件格式和结果。
6. **数据、事务与并发**：每个项目的标签、代理、内联私钥、连接与凭据同事务创建，任一拒绝全部回滚。已有代理仅在用户名相同且没有新凭据写意图时复用；秘密冲突明确拒绝，不覆盖他人配置。私钥名称唯一冲突明确返回，不自动重命名。
7. **生命周期与失败**：上传有完整字节预算和期限，写入前复验会话；已提交后失败不冒充回滚，commit_unknown 单独表示。单项失败不自动重放，保持输入顺序返回结果；日志不得包含明文。
8. **当前能力与验收**：导入源码及静态已收口，连接测试独立实现，完整功能对应与两轮审核见 testing；行为统一 B10，不代表后端 100%。

### B9 保存与未保存 SSH 测试（源码接线）

1. **职责与范围**：Targets resolver 只拥有目标/引用/秘密解析；Remote machines 拥有真实握手、期限和关闭，不把测试塞入配置管理 Service，不执行命令或创建临时记录。
2. **子功能与目录**：Targets resolver 的 Service/ssh-target-rules 决定输入与图容量，Model 负责存储/SecretBox 转换；Remote machines 的 connection-test Service/Model/type 管理用例与能力，接口沿原 Remote interfaces/http，不另建 testing 大模块。
3. **依赖方向**：Remote Service→TestModel→MachineModel→Targets trusted resolver / Platform SSH；Targets 不能反向引用 Remote。存储 Adapter 只接独立任务和显式图预算，不引入应用政策、应用错误或 Model 类型。
4. **类型与转换**：Shared connections/test-http、test-codec 和 values 拥有完整请求、结果/错误、容量。Remote HTTP→内部应用、TestModel→Targets public、Targets public→内部应用、Model→独立存储均逐字段投影；未保存解析没有虚构 ID/fingerprint，明文仅存在受信后端输出和写命令，不进入公开响应。
5. **入口与安装**：Remote register 安装 POST /api/v1/targets/connections/:id/test、/test-unsaved。Access 是当前管理员身份权威；同一入场不重复认证，引用/Host Key 异步读取后、交付前仍复验。全局 Operations 观察 SSH_CONNECT_SUCCESS/FAILURE。
6. **数据、事务与并发**：引用的 Key/Proxy/Jump 在单一快照读取，递归环/深度/展开预算受约束。未保存请求不写数据库；每个测试使用独立机器，不借用普通 Workspace/Agent 资源。存储不存在/引用拒绝在 Model 转换，不由 Adapter 实例化应用错误。
7. **生命周期与失败**：HTTP 及真实任务均受15秒期限和断连/停机取消约束，最多8个在途。原 owner 等待实际 connect/close，未收敛任务不归还配额；关闭失败保留句柄/原因并阻断新测试，所有在途排空后汇总。成功必须完成本地关闭和当前身份复验；Host Key 未受信明确失败，没有自动信任或重试。
8. **当前能力与验收**：保存/未保存握手、Shared、路由、审计观察及关闭链已接线，静态证据归 testing；真实 SSH/代理/跳板、取消/关闭和权限交错均待 B10，正式前端待 F1；B9整体源码结论见实施方案/testing，不将本子链或静态通过当行为验收。

B6.2B 的 ToolCall 账本、审批消费及文件/Shell/Docker工具源码已接线。账本归原 runs 聚合，governance 拥有审批政策与单次许可。目录、诊断及文件只读工具的可信检查、执行消费者与模型反馈已接线；受审批文件突变、Shell/当前 Run 后台 Job/Docker 已接线，ACP Runtime、独立权限及直接 Root/Child 协作已接线；执行设置、上下文与预算已接入 governed 政策，行为待 B10。

### B5.2 Root Run 执行链（源码接线，行为待 B10）

唯一 Run owner 在 `modules/agent/runs`，持有创建/取消、主状态、模型步骤、事件、幂等、执行任务和恢复。旧 Backend 的现存 Run/提交/调度/模型端口及 HTTP/WS 是功能覆盖依据，不恢复退役 Runner。主 Run 已有 pending/running/completed/failed/unknown/cancelled 源码，步骤与主状态同事务联动。模型探测和 pending 均不证明执行成功。

执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 B5/B6 的真实执行消费者已接入 B7 冻结上下文与预算；外围工具 B8 已源码接线；持久证据恢复已由 B9 接线，行为验收 B10。

### Agent Provider 与冻结输入

管理 Provider、加密凭据、发现/测试模型、查询/刷新 Registry，并在创建 Root Run 时冻结模型配置与凭据代际。Run 持有完整主状态与子步骤，执行政策/工具审批 B6、上下文/预算 B7、正式前端 F1、行为验收 B10 分别承接。

### B4.2 Factors / Passkey 认证范围（源码阶段）

Access 在 B4.1 完整密码和摘要会话之上扩展 TOTP 与 WebAuthn。Factors 只拥有部分认证、挑战、密码因素启停与凭据操作；**完整身份权威仍为 access_sessions / AccessPublicApi**。五分钟 `nexus_partial` 是独立随机 bearer，只能用于 `POST /auth/login/2fa`，不能传给普通 SSH、Agent 或其它需完整身份的路由。Passkey 登录最终直接核实 WebAuthn signature/RP/Origin/user verification 并签完整摘要会话；已经建立的完整会话不因启用新 TOTP 被隐式撤销。正式Auth/Security已对接Shared因素与配置，本机前端证据归testing；审计/通知/动态Settings已接线，行为待 B10。Preferences 持久配置已接入多 Origin/RP，HTTP/WS 选择受信站点、Factors 按对应 RP 签发并验证挑战；配置统一在重启生效，实际行为待 B10。

B4.2 本轮复审：WebAuthn 技术 Port 以具名选项表达 RP/user/credential descriptors，Adapter 先对浏览器 clientDataJSON 的 challenge/Origin/type 与 assertion RP Hash、UP/UV、counter 做确定性拒绝；第三方验证仍是最终权威，无法可靠分类的供应商异常映射为不可用而非凭据失败。注册与登录 options 明确要求 User Verification（required），与最终 requireUserVerification 一致。Model 在写 challenge 之前投影技术选项，HTTP 对 options 仅维护一套可选字段白名单；HTTP 签发后的挑战 Cookie 必须交付成功，若在完成之前断开连接则撤销已提交的 challenge/TOTP setup，回收失败保留因果。交付由 Access interfaces/http/access-delivery 唯一持有：原 response、socket 和 request 共同观察，只有原传输未销毁/中断时的 finish 才结算成功；关闭后缓冲清空或迟到 finish 不解除失败撤销。所有路径解除原监听，撤销失败只执行一次并保留因果；本地 finish 不等于浏览器收件确认。源码/静态收口；当前行为范围以 testing 为准。

### B4.1 Access 核心认证与入场策略

Access 统一拥有初始管理员、密码身份认证、token 摘要会话、登录失败/封禁、来源白名单和 CAPTCHA 准入。HTTP/WS 接收由 Platform HTTP 从 TCP peer 与明确受信代理链解析的来源，不读取业务客户端自报 userId/IP；已登录身份由 Access public 的 token/digest 实时复验。安装态策略真实执行，Preferences 已提供核心持久设置与统一重启生效；执行配置与 Operations 已接线，外围集成配置已由 B8 接线；TOTP/Passkey 已由 factors 实现完整挑战流程，完整因素不能被密码闸门绕过。

### B3.2 资源观测与 Docker

Remote 的 monitoring 子功能负责普通 Workspace 状态订阅、Docker 查询/控制和后台 SSH 资源采样；不执行任意用户命令、不复制 Workspace registry。System 负责本机状态。cwd 已归 sessions，快捷命令/命令历史已归 Preferences commands/history。SSH/Agent 可分别消费通用 Linux/Docker 技术能力，不能复用普通用户权限和活跃会话。

### 服务器传输与Workspace任务的范围

Workspace的copy/move/archive已归Remote Files，按原附件准入和原任务生命周期执行。旧正式 /api/v1/transfers 的send、列表、详情、cancel、remove是独立后台服务器任务，源机器执行rsync/scp并交付目标凭据；当前register已安装这五个HTTP，Shared server-*契约及正式API/store/UI消费者同步迁移。两条链独立验收，后台任务不借用Workspace授权；设计见本文“Remote 后台服务器传输”，当前证据见testing。

### Workspace 当前边界（源码收口，行为待验）

Remote 的普通 SSH Workspace 是一条持续存在的交互式 shell，而非 Files attachment 或一次性 HTTP PTY。一个 Workspace ID 对应唯一应用会话 owner，涵盖 pending/open/离线宽限/挂起/恢复交付/closing/清理待确认；外部 WS 仅持有可撤销 attachment。Access 注销令当前 Cookie 失效，附着 WS 在身份复查时关闭；这与终止原 Workspace 是不同操作，断开后按普通宽限/挂起保留策略管理原 PTY。同用户以新有效登录和原 Workspace 凭据续接，显式 ACK 后关联 Files 按新会话重新取得资源，不复用旧会话文件权限。已有独立 Remote HTTP/PTY 保留其实际消费者与关闭语义，不冒充可恢复 Workspace。Agent 仍仅复用 Platform SSH/字节通道，不继承普通 Workspace 的令牌、用户权限或资源额度。WorkspaceService 向 Files 显式提供原实例与会话摘要绑定的 WorkspaceFileAuthority（Files Model 应用契约），统一检查生命周期和挂起租约；独立上传、下载交付及多步骤传输通过该能力复查，不依赖扫描先撤销控制 WS。Files 不反向引用 Workspace Service，Platform/Shared 不承载该后端私有政策。跨 Workspace 复制同时绑定原源和目标 owner；普通离线宽限与独立 Files 保持各自政策。检查只限制后续应用派发/交付，不承诺撤回已派发技术调用；授权失效不免除清理责任，远端清理未知保留原因及现场。

当前唯一后端为 `packages/backend`（原 backend-next），包名为 `@nexus-terminal/backend`，入口为 `dist/main.js`。旧 Backend 已移出工作树；功能追溯使用 `05e140d2:packages/backend` 或 Git 历史，不能恢复运行时兼容层。源码归一不代表统一 E2E 已验收；现有未验范围仍由实施方案与 testing 承接。

| 一级模块    | 业务 owner                                                    | 当前边界                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access      | 账号、认证、会话与访问策略                                    | B4.1 增量实现管理员、密码、摘要会话、可信来源、IP 策略和 CAPTCHA；源码/架构复审已收口，B4.2 因素源码/静态已收口、行为待 B10；Preferences 已提供核心持久安装快照，执行配置及审计/通知已接线，外围集成已由 B8 接线，行为待 B10 |
| Targets     | 连接配置、凭据、Proxy、SSH Key、Tag、目标解析与 Host Key 信任 | 已有 SSH/RDP/VNC 定义和基础管理；RDP/VNC 定义不等于运行能力                                                                                                                                                                  |
| Remote      | 普通用户终端、文件与其他远程用例                              | PTY/Workspace/Files/传输/终端挂起恢复及 B3.3 桌面源码已接线；正式浏览器桌面操作与其他真实行为仍待 B10                                                                                                                        |
| Preferences | 核心安装快照、用户偏好与命令/路径数据                         | 核心配置CAS/加密/重启快照；个人偏好、布局、命令/标签、历史与收藏HTTP已接线；日志/审计/通知归独立 Operations；正式前端 F1。                                                                                                   |
| System      | 本机资源状态                                                  | 已有认证状态 HTTP、Service/Model 与 Node 技术 Adapter；诊断同时供管理员 HTTP 与受治理 Agent 工具消费。                                                                                                                       |
| Agent       | scope、Run、Provider与后续治理                                | 已有完整主状态/步骤、执行owner、恢复和DEV审计；governed 原执行链、App/目标治理、工具审批、上下文/预算已有源码；外围能力 B8 与恢复 B9 已源码接线、正式前端 F1、行为 B10                                                       |

本机状态已有独立 System owner；Preferences 已接入核心持久设置；Operations 已持有 notifications/audit/logging，System 已提供宿主诊断；后续能力按真实业务所有权实施；Agent 的 Provider/调度/Tool/授权/审批/Job/Artifact/Memory/集成归 Agent 子功能，不复制技术底座。

### Agent 上下文设计（源码接线，行为待 B10）

1. **职责与范围**：context 拥有 Root 的 Thread 历史装配、Run-local 完整工具交换及容量准入。历史保留此前 Root 的输入、步骤、工具状态与已记录结果，包含失败、取消和 unknown，不伪造缺失结果。历史转为不可信数据，不成为当前指令或授权；Child 仅取得委派输入和自身交换，不读取父 Thread 私有历史。
2. **子功能与目录**：context/service 的 ContextHistoryService 管历史准入，ContextService 管 Run 内快照与完整交换；context-rules 管纯规则（含normal/extended窗口选择及统一完整请求估算），context-limits 管私有表示上限。context/model 持有应用类型及存储转换，context/storage 定义独立历史/快照契约，context/adapters/sqlite 持有 SQL、行/JSON 解码和快照连续性校验。
3. **依赖方向**：原 RunExecutionOwner → ContextHistoryService → ContextModel → ContextStorage/SQLite；每轮再由 ContextService → RunStepModel → RunStepStorage/SQLite 同事务保存快照。Context 不引用执行 Service，Adapter 不引入应用 Model/Service 类型；模型请求编码仍由原 RunModelStream/Platform AI 转换。
4. **类型与转换**：消息/proposal/reasoning 应用类型唯一归 Run；History/Source/Snapshot 归 context/model，独立存储对象归 context/storage，Model 对全部嵌套字段逐项转换。基础状态引用已有 Shared values；内部快照无双端消费者，不新增 Shared/public 对象。跨 Run 不复用加密 reasoning；同 Run 续接保留供应商需要的完整 reasoning。
5. **入口与安装**：Agent register 安装 ContextModel/Storage 和历史 Service 到原执行 owner，无第二个执行 registry 或新 HTTP。读取历史仍位于冻结政策检查之后，每轮取得快照后才 reserve；每轮受 governed、当前版本、冻结预算及期限约束。
6. **数据、事务与并发**：Root/Child 创建事务分配不可变 thread_sequence，历史按该序号排序，不用时间戳推断先后。Service 在原读取事务通过 Model 回调检查最多4096个此前 Root 来源，未压缩部分1024步骤、4096工具及512KiB原始正文，再批量读取并解码。步骤 reserve 同事务保存 agent_model_contexts 的完整内容、来源及 SHA-256，并核对来源 user/App/Thread/sequence/version/status；后续轮与已存前缀、原步骤文本/proposals及确定工具结果经Model投影后的消息逐项一致。只更新单一初始 v1 与精确签名，不兼容旧开发库。未来恢复若修改被引用的历史步骤/结果，必须原子推进来源版本；B9 不得仅修改子账本而维持来源版本不变。
7. **生命周期与失败**：每 Run 最多1024消息，消息与工具定义合计4MiB；normal的会话窗口预算另加完整工具定义与工具框架开销，再受Provider窗口约束；extended直接使用Provider窗口。完整请求估算与步骤token预约共用context-rules，包含消息/请求框架及冻结输出预留，不是供应商精确 token 用量。Platform AI将最多128项工具声明与每轮最多32次调用分别限制，不以调用数量限制目录。超限明确拒绝，不静默截断历史或半组工具；首轮确定拒绝只结算原身份/版本/创建请求且无步骤的 pending Run，后续按真实派发事实结算，存储失败保留因果且不重试。原执行 owner 管取消、围栏、unknown 与 drain；持久快照不授权重启后重新派发。
8. **当前能力与验收**：Run-local 交换、持久 Thread 历史和逐步骤内容快照已接线；受限结果续读已接线；语义检查点、Memory/Recall、Artifact/清理与执行设置已有实际消费者。USAGE、实施四表与 testing 分别维护当前行为、任务和检查证据；全部行为待 B10，正式前端 F1。

### 上下文结果投影与续读（B7.3 源码）

1. **职责与范围**：context拥有模型结果投影/Unicode页准入；原RunTool账本仍保存完整确定结果，预览不升级原操作的验证或授权，不重放外部工具。
2. **子功能与目录**：context/result-rules.ts持有纯投影/hash/编码容量规则；model/context-types.ts持有读取输入/页/结果，service/result-service.ts管理来源准入；无需第二份存储/文件库。
3. **依赖方向**：ToolService→ResultService→原RunToolModel/GovernanceService；RunStepModel在存储事务回调内转换结果事实并验证相同应用投影，SQLite只读独立storage事实，不引入应用规则。
4. **类型与转换**：ToolInput引用context应用读取类型；StoredContextToolResult归context/storage，Model逐字段转换。已有Shared治理values新增context.read，完整治理codec/后端是实际消费者；私有工具正文与ResultPage无双端消费者，不放Shared。返回页嵌套投影归ToolService。
5. **入口与安装**：register将ResultService接原ToolService；tool_result_read v2是模型生产者，Root/Child依原工具名单缩窄。当前内置声明nexus.terminal@1.8.0明确声明context.read，grants仍默认空；新能力不自动授权。
6. **数据、事务与并发**：结果原文仍唯一存agent_run_tools，完成确认后才向模型投影；超过8KiB原文提供4KiB JSON编码预览（原捕获上限256KiB不变）。后续reserve同事务核对原前缀/proposals/完整确定结果，Model回调验证应用投影。续读的源SSH目标id/version进入当前结果确认事务；单一初始v1签名同步，不新增兼容迁移。
7. **生命周期与失败**：只能读同user/App/Run较早步骤的completed记录，hash/当前原能力/批准/目标有效性复查；context.read不能代替源操作权限。目录结果在当前选择含denylist项时保守拒绝；不存在/非确定/续读递归拒绝。offset按Unicode码点，maxBytes为JSON编码文本含引号，8–4096/default4096；完整页元数据容纳在8KiB模型结果预算。由原Run/Tool owner结算、取消和关闭，不新增后台工作或重试。
8. **当前能力与验收**：结果投影和真实工具续读源码接线；跨Run历史仍保留实际捕获正文，不能用同Run续读绕过其容量。语义检查点、Memory/Artifact已接线，所有行为待B10，正式治理/提示/结果卡片迁移归F1。

### Agent 数据与执行配置（源码接线，行为待 B10）

1. **职责与范围**：Memory 拥有候选、人工审核、撤销、导入与受限 Recall；Artifact 拥有内容、元数据、引用、保留及清理；execution 拥有管理员执行设置、三个 Child profile、硬限制确认及 Run 冻结预算。原 RunExecutionOwner 是唯一模型任务 owner。各能力已有管理入口和真实消费者，源审与静态证据归 testing，行为待 B10。
2. **子功能与目录**：分别放在 Agent 的 memory/artifacts/execution 子功能，沿用 service/model/storage/adapters/sqlite。context 新增 checkpoint Service/Model/SQLite；通信入口仍集中 interfaces/http。Platform blobs 只持有不透明 key、实际字节流、文件句柄和具名技术失败，不认识 App/Run、配额或保留政策。
3. **依赖方向**：业务 Service → Model → 独立 storage/Platform → Adapter；SQL/DDL、私有行与 JSON 解码留 Adapter。execution 的纯政策决定通过 Model 转换后的同事务事实回调执行；Root/Child、Governance 与其他 Agent 子功能直接消费内部应用契约，不绕 public 包装。
4. **类型与转换**：双端管理协议唯一归 Shared agent/{memory,artifacts,execution}；应用对象分别归所属 model，独立存储对象归 storage。HTTP 与 Model 分别白名单转换全部嵌套对象。摘要正文与内部来源快照没有新增公开对象；能力基础值包含 context.compact、memory.read、memory.propose、artifacts.read/write，内置声明当前版本 1.8.0，默认 grant 空。
5. **入口与安装**：register 安装管理 HTTP 和 memory_propose/recall、artifact_create/read、context_checkpoint 真实模型工具；Bootstrap 安装原 Access 提供的事务身份 reader，并创建数据库同路径派生的专用 Artifact 内容目录。核心 SQL 仍仅一个初始 v1，不兼容旧开发库；精确签名随最终结构更新。
6. **数据、事务与并发**：Memory 提案来源、审核 CAS、导入来源版本和一次确认在原写事务核对；期限使用实际读取后的时钟，导入预览从该时刻计10分钟，确认消费CAS和候选创建同事务。导入结果重新成为 candidate，不继承发布，审核耗尽版本拒绝递增；持久/Shared解码一致校验创建、审核和到期关联。Artifact SQL 预留、文件独占写入/发布和 SQL 确认分别有完成判据；上传/删除领取前预留最终结算的版本空间，批量清理先验证完整计划，确认期限在实际读取后复查。删除先持久 claim，实际文件删除与结算均确认后才归还额度。硬限制 preview/confirm 在真实存储事务读取事实后取时钟，期限由 Service 决定，校验、updatedAt 与单次消费共用该次时刻；耗尽版本不递增。Root 创建同事务冻结设置，Child 继承该不可变预算并可选独立 Provider；模型与工具准入读取全族账本，模型 token reservation 不退款，不冒充供应商精确用量。
7. **生命周期与失败**：所有管理任务归 AgentRequestOwner，模型/工具仍归原 Run owner。持久语义检查点绑定实际模型输入 hash 和完成工具；下一轮保留原用户请求及完整当前交换，预留事务重新验证摘要来源。未知提交不补写、不重派，导入/清理确认只消费一次；结果未知按预分配资源身份只读核对。内容流覆盖全部 yield、取消和 close，读取期间不允许清理对应文件；未确认文件/句柄清理保留资源与容量归属。
8. **当前能力与验收**：Memory/Artifact、语义检查点、执行设置、Operations 日志/审计/通知与宿主诊断源码已接线；执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 正式前端 F1、行为 B10。

执行设置正式前端已消费独立四HTTP及完整Shared响应codec，profile请求数/工具数/模型与工具UTF-8容量从execution/values由HTTP、Service、SQLite持久解码与前端共同引用。业务准入、实际工具集合、版本、占用及确认期限仍归ExecutionService和原事务；本批没有将应用类型下沉Shared或Adapter。完整Agent前端仍待后续迁移。

## 2. 子功能与目录

`runs/model/run-tool-types.ts` 是操作的内部类型 owner，`run-tool-model.ts` 逐字段转换存储命令/结果并映射失败；`runs/storage/run-tool-storage.ts` 定义持久任务；`runs/adapters/sqlite/run-tool-{schema,row,sql,events}.ts` 独占 DDL、行解码、CAS 和状态事件。私有参数/结果预算归 runs/run-tool-limits.ts，不预建无人消费的 Shared DTO。

工具结算政策归 `runs/run-tool-rules.ts`；Model 将事务内存储事实转换后执行纯规则，Adapter 只做引用/版本复查和事务写入。未派发操作允许 failed/cancelled；已派发不能写 cancelled，无法确认远端结果时写 unknown。父 Run 成功条件归 `runs/run-rules.ts`，通过 Model 的窄同步回调消费事务内未结工具事实。

### B5.2 所属目录

`agent/service/agent-request-owner.ts` 负责模块请求准入/停机排空（最多64个在途请求）；`runs/service/run-execution-owner.ts` 是唯一进程内模型执行任务 owner；RunService 编排用例，Model 转换存储/技术请求及结果。`runs/model/run-projection.ts` 统一主 Run、事件和冻结输入的存储投影；复用应用类型归 `run-types.ts`。

步骤契约在 `runs/storage/run-step-storage.ts`，事务和行/JSON 解码在 `runs/adapters/sqlite`；`run-step-model.ts` 持有步骤转换。`run-model-stream.ts` 把技术流转成应用增量/终态/安全失败。通用协议和 SSE 解码归 `platform/ai/{model-port,adapters}`，不含 Run/用户/业务授权类型。

### Provider 与 Registry 目录

`agent/providers/{service,model,storage,adapters/sqlite}` 持有配置与秘密；Provider规范化和冻结资格归`provider-rules.ts/provider-capability-rules.ts`，Service及Run事务回调消费纯规则；Model只做事实转换。`providers/registry/{service,model,storage,adapters/sqlite}` 持有目录刷新、缓存与解析；Registry Service决定快照生成时点、缓存损坏恢复和别名冲突，纯规则在`registry-rules.ts`；Model从技术结果投影独立RegistryCatalogEntry，从存储投影snapshotInvalid事实。HTTP 统一在 Agent `interfaces/http`。`platform/ai` 提供通用模型/目录技术契约及 Adapter；不持有用户、Run 或授权政策。

### B4.2 目录与唯一 owner

`access/factors/service/factor-service.ts` 管因素用例、cookie 对应的授权、失败与恢复政策；`factors/model/{factor-model,factor-types,options-projector}.ts` 管存储↔应用字段投影、SecretBox 加解密、TOTP/WebAuthn Port 调用、WebAuthn 浏览器选项白名单；`factors/storage/factor-storage.ts` 仅定义持久命令；Access 一级 `access-failure.ts` 持有跨账户/认证/因素共用的内部具名错误；`factors/adapters/sqlite/{factor-schema,factor-sql}.ts` 持 DDL、事务、challenge 与 counter 原子更新。Platform 的 `security/{totp-port,webauthn-port}` 与 `adapters/{rfc-totp,native-webauthn}` 只拥有通用算法、签名验证和提供者消息。HTTP `interfaces/http/factor-http.ts` 接真实路由，Shared `access/factors/http.ts` 负责严格未知输入解码；不向其他模块新增部分登录 public。

### B4.1 Access 目录

`access/authentication/service/access-service.ts` 编排账号初始化、改密与密码登录用例，`accounts/model/account-model.ts` 隔离 Scrypt Port 调用、账号行转换和存储能力；`accounts/adapters/sqlite` 负责唯一初始化与改密撤销事务。`sessions/model/session-model.ts` 负责会话 token/digest 应用转换，`sessions/adapters/sqlite` 负责会话查验、CAS 签发、原子失败计数、封禁解除与分页。`admission/service/source-admission.ts` 消费安装时验证的 IP 白名单和失败政策；`admission/source-ip-rules.ts` 只含白名单容量/条目和内网分类纯规则；`admission/model/source-address-model.ts` 将技术解析转为普通应用地址/网络事实；`platform/security/source-address.ts` 定义通用地址契约，`adapters/source-addresses.ts` 独占 ipaddr.js。`captcha/service` 决定配置、是否需要验证与 token 预算；`captcha/model` 持有第三方验证调用与错误转换；`platform/security/adapters/network-captcha-verifier.ts` 负责带期限和受限响应读取的供应商 HTTPS 表单协议。Access HTTP 只实现 Shared 的解码和逐字段结果投影，不接触 hash、SQL、CAPTCHA secret。

### B3.2 目录

`remote/monitoring/service` 持有准入、采样状态、按主机缓存、授权及 Docker 操作用例；`monitoring/model` 持有内部事实类型、可信目标到临时 SSH 能力的转换、技术失败及输出转换。`platform/system/adapters` 解析 Linux/Node 状态，`platform/docker/adapters` 构造 Docker 命令并严格解析原生 JSON。`system/status/{service,model}` 负责本机状态用例，不依赖 Remote 私有代码。Shared 的 `remote/monitoring`、`remote/docker` 和 `system/status` 持有双端协议。

### B3.1 子功能设计

- `remote/sessions/service`：唯一 Workspace 状态、实例绑定 attachment/lease、认证续接、准入、恢复 ACK、挂起、取消、终止及最终任务追踪；terminal 的背压/offset/输入与 shell cwd 的应用流程分职责实现，共享原 Workspace 实例而非复制 registry。目录请求的排队/替换/期限/安全事件由 workspace-shell-service 持有；Model 转换 shell 能力，命令语法和输出解析归 Native Shell Adapter。
- `remote/sessions/model`：Workspace、终端、历史及 checkpoint 的内部复用类型与明确应用↔技术转换；底层 SSH shell/字节流通过已有 machines/model、session-model 和 ssh-port；技术文件 I/O/Headless 终端只放独立 Platform Adapter，不在 Service 直接访问 fs/ssh2。workspace-history-model 隐藏日志/checkpoint/renderer Port、Node Stream 和技术失败；所有复用应用类型均在 workspace-types。
- `remote/interfaces/ws`：单一 `/ws/workspace` envelope、终端流与 resume 事件投影，接入现有 Files/transfer 调用与 NXW1，旧 attachment 的 lifetime 与新 owner generation 独立。管理 HTTP 在 `remote/interfaces/http` 显式安装。
- `remote/files/service`：FileAttachment、上传、copy/move、archive 仍独立掌管 SSH/SFTP 与任务资源；由 Workspace owner 绑定实例化释放能力，不另设可恢复 shell registry。
- `shared/src/remote`：共用 envelope 移交 Workspace 子域；terminal/suspend 协议按其消费者单独定义，Files/transfer 保留既有领域 DTO。

```text
packages/backend/src/
  main.ts                         进程配置与启动
  bootstrap/                      技术实例、模块安装、全库迁移与停机
  platform/
    storage/sqlite/               SQL 契约与 Runtime
      adapters/                   SQLite 方言、版本表及实际 Worker
    ssh/adapters/ssh2/            SSH/SFTP/命令技术实现
    archive/adapters/             原生命令格式与流式 ZIP 技术能力
    text/adapters/                文本编码技术能力
    http/                         通用 HTTP/WS
    security/                     通用加密与密码散列
    lifecycle/                    通用有界结果/失败记录
  modules/<module>/
    public.ts                     后端跨模块安全契约
    public-errors.ts              确有消费的安全错误出口
    register.ts                   装配、安装选项与生命周期
    migrations.ts / schema.ts     安装接口与顺序，不含 SQL
    interfaces/http/              HTTP 协议解码与投影
    interfaces/ws/                WebSocket 协议解码、投影与通道生命周期
    <feature>/
      *-rules.ts                  确需独立的纯业务规则，不访问存储或网络
      service/                    用例、权限、顺序与应用资源 owner
      model/                      应用类型及存储/技术转换
      storage/                    内部存储任务契约
      adapters/sqlite/            SQL、行解码、事务和 DDL
```

Targets 的 connections/proxies/ssh-keys/tags/host-keys/resolver/import/management 为同一模块子功能；共用持久引用拒绝定义在 targets/storage/target-storage-refusal.ts，SQLite Adapter 在删除事务内核对真实引用，Model 转为 reference_in_use，不依赖 RESTRICT 的供应商扩展码推断业务语义；模块级 `targets/model/target-technical-failure.ts` 仅复用这些子功能的技术失败转换，不承载用例、类型集合或存储；Remote 的 sessions/files 各有资源，共用可信目标→SSH 建连转换归 `remote/machines/model`，不为该共用 Model 机械创建空 Service/Storage；Agent 当前为 scope/runs/providers（含 registry）/governance；通信对象在 Shared，内部可信输入和用例/存储对象仍各有 owner。无持久化功能不创建 storage。文件按职责和消费者拆分，独立 helper 不自动升级为公用能力。

## 3. 依赖方向

Scope 的 App/声明行解码归 scope/adapters/sqlite/app-row，列表和单项复用能力解码；来源种类、身份、UTF-8/容量、hash 与有限标志不以宽泛文本代替。审批 Service → Governance Model → Governance Storage → SQLite；事务读取 runs 的存储操作事实，Model 转成独立 ApprovalOperation，再交 Service 的同步判断。消费提交返回的存储操作经 RunTool Model 唯一投影转换；Service 不取得存储行。SQLite owner 之间可协作实现同一事务，不引入 Model/Service。

### B5.2 执行流方向

HTTP → Shared codec/HTTP mapper → RunService → RunModel/RunStepModel → storage → SQLite Adapter。首次创建提交后，RunService 调用 RunExecutionOwner；owner 通过 Model 读取冻结、获取凭据、复查 Provider，保留/确认派发后消费 RunModelStream → ModelNetworkPort → 网络 Adapter。重放和重启不启动新请求。

reserve/dispatch 的事务回调由 Model 将独立 frozen/Provider 存储事实投影成应用类型，再调用纯业务规则。Storage 负责同事务读取和写入，不持有授权策略。当前规则和流入口只接受 governed，并核对实时 Provider 与原 Run 权威；配置存在、测试成功或手工步骤记录都不能授予执行权。

### Provider 调用链

HTTP → Shared codec → HTTP mapper → Provider Service → Model → storage/AI Port → Adapter。SQL 行在 SQLite Adapter 解码；厂商 `/models`、SSE、models.dev JSON 在网络 Adapter 解码；Model 逐字段转换应用命令、记录、技术结果及失败。Run 的同步冻结回调由 Run Model 持有，Adapter 只接收 storage 契约。

### B4.2 实际调用链

B4.1 密码成功且 TOTP 已启用时，`AccessService → FactorService → FactorModel → FactorStorage → SQLite` 写五分钟待认证；`POST /auth/login/2fa` 读取独立部分 Cookie，再经 `FactorModel → TotpPort → RfcTotp` 真实验证，最终同事务删除 pending、插入完整 session、清失败计数。WebAuthn OPTIONS/VERIFY 经相同 FactorService/Model，Model 消费 `WebauthnPort`，Adapter 调 `@simplewebauthn/server` 并将不可确定的供应商异常封装为具名技术失败；Model 转为安全应用失败；Shared unknown 解码经 HTTP 显式转换为内部 credential evidence，不让原始第三方凭据对象进入 Service。只有已提交的完整 SessionModel/AccessPublicApi 能供 Targets、Remote、Agent 使用。Platform Port 是合法通用技术契约，Service 不直接调用。

### B4.1 Access 调用链

Bootstrap 安装 Access、注入技术 Scrypt/SQLite/CAPTCHA Adapter；`platform/http` 只解析来源、Host/Origin/CSRF 和通用路由。安装模块时，对业务 HTTP 与 WS 路由施加 `AccessPublicApi.admitSource(trustedIp)`，登录/状态/登出/管理员黑名单恢复 HTTP 路由使用只检查白名单的 `admitAuthenticationSource(trustedIp)`（登录封禁由用例返回 429）；未匹配 HTTP 路由通过 Platform 可选通用回调先执行完整来源准入；业务端点依旧经各自 Access public `authenticate/authenticateDigest` 判定当前身份。Access Service → Accounts/Sessions/Captcha Model → 各自 Storage/Platform Port → Adapter。Remote/Targets/Agent/System 只依赖 Access public；Service 不直接调用密码、网络、SQL Port，Platform 不依赖 Access 业务类型。正常 HTTP/WS 入场不重复身份查询，长时建连、资源交付和敏感操作由所属 Service 复验原会话及实例身份。

### B3.2 调用链

Workspace WS → RemoteObservationService → WorkspaceService 实例绑定任务能力 → ObservationModel → machines/model、System/Docker Port → Adapter。Dashboard HTTP → 同一 ObservationService → Model；本机 HTTP → SystemStatusService → SystemStatusModel → LocalStatusPort。技术命令与供应商输出只在 Adapter，Platform 不导入模块/Shared 业务对象。

### B3.1 依赖约束

WS/HTTP → Workspace Service → sessions Model → machines/model → Platform ssh-port → ssh2 Adapter；Workspace Service → Files Service 的实例绑定能力，不经 WS 反向寻找资源。Workspace Service → History Model → Platform 日志/checkpoint/renderer Port → 本机文件/终端 Adapter。Interface 只投影 Shared 协议和安全错误，Service 不导入 Shared wire；Platform 不导入 user、Workspace、suspend 或 Agent 应用类型。Agent 通过各自 owner 使用通用 Platform，不深层引用 Remote 私有 Model。

```text
Bootstrap → 模块 register / 迁移安装入口
Bootstrap → Platform 技术实例
Interface → 本模块用例 + Shared 协议
Service → 本模块 Model / 子功能纯业务规则 + 所需跨模块公开能力
Model → 模块 storage 契约 / Platform 技术契约 / 子功能纯业务规则
SQLite Adapter → storage 契约 + Platform SQL
```

Platform 不依赖业务模块、不持有 Connection/Run/User、业务表、授权状态或业务注册槽。业务 SQL Adapter 不依赖 Model/Service/Shared 对象与协议；确需共享的基础值只从 Shared 精确 values 路径引用。

跨一级模块仅用 public 安全能力和明确安装契约，不深层导入 Model/Service；模块内部可直接协作，不绕全局 dispatcher。Service 定义密码/凭据保护的业务政策，Model 通过技术 Port 调用 SecretBox/PasswordHasher 并映射应用结果，技术细节和密码哈希算法由 Platform Adapter 持有。应用实例依赖由 Bootstrap/register 安装，不使用可变进程级数据库单例。

Port 文件表达 Platform 的技术能力及技术输入/输出，不是新增业务层：Model 调 Port，具体 Adapter 实现 Port。不得在 Port 中定义账户、连接、Run、授权或业务 registry，不允许 Service 绕 Model 直接调用；原始第三方对象不得进入应用类型。文件是否命名为 *-port 不改变此边界。

## 4. 类型与转换

ToolOperation/ToolInspectionCommand/ToolIdentity 归 runs/model；StoredToolOperation/StoredToolInspection/StoredToolIdentity 归 runs/storage，各边界逐字段转换。ApprovalRequest 只指定操作身份及审批种类，不接受自报 hash、风险、能力或摘要；这些事实从当前持久操作生成。Shared agent/tools 的 values/model/http/http-codec 定义有限状态、安全审计对象和分页；参数/结果正文、providerCallId 与私密摘要保持内部。ToolEvent/Page 归 runs/model，StoredToolEvent/Page 归 runs/storage，不继承 Shared 对象。

### B5.2 模型流表示

应用类型唯一归 `runs/model/run-types.ts`；存储命令/记录归 storage，第三方流契约归 Platform。Model 明确逐字段投影，包括同步事务回调的输入。Adapter 校验持久 JSON、模型 ID 与能力快照一致性，业务资格判断留应用规则。

Shared Run 子域持有主状态/事件、步骤状态/事件基础取值、2 MiB 正文容量，以及严格路径/分页/响应 codec。只读步骤公开投影提供状态、版本、用量和文本字节数；原始增量、prompt、冻结配置、凭据、技术 cause 不公开。现有 DEV transport 严格解码 wire，controller 再投影独立应用状态。

### Provider 类型与转换

应用类型分别在 `providers/model/provider-types.ts`、`registry/model/registry-types.ts`；存储类型各在 storage，技术类型在 Platform。Provider/Registry错误码、步骤状态/事件与失败码取值归Shared独立values，存储只引用基础取值，不能借用Shared对象。通用网络失败由`providers/model/provider-network-failure.ts`唯一转换，两个Model共享，原始cause不公开。内部 HTTP 协作接口 `providers/model/provider-api-types.ts` 不作跨模块出口。冻结输入仅由 Run Model/Service 内部读取，不放 Agent public。Provider 输入/视图、能力基础值及完整请求响应归 Shared；Run 的模型引用必填。

### B4.2 类型及公开白名单

Shared 的 `access/factors/http.ts` 拥有 TOTP token/disable、WebAuthn credential JSON 和 Passkey 名称/发现 query 的未知输入解码，以及公开成功结果。Factors 内部身份、PendingLogin/FactorChallenge/PasskeyCredential 分别归 `factors/model/factor-types.ts`，Storage 行/命令归 `factors/storage`，Port 的公钥/注册结果不含 account/user 类型。HTTP 明确构造用户/id/计数/时间响应，登录成功联合含 `requiresTwoFactor:true` 的部分分支，注册/认证 options 由 Model 的 `options-projector.ts` 投影；完整会话 bearer、服务端 pending/challenge cookie 和加密的 TOTP secret 不进入跨模块 public。Factors Adapter 复用 Sessions 的事务内身份读取，不另写一套会话 SQL；到期时钟在读取后取值，挑战消费在实际事务中读取并判断期限。令牌生成/摘要技术异常由 FactorModel 映射；Passkey 列表交付前由 Service 复查原会话。凭据持久编码与容量由 Adapter 严格解码，基础容量精确引用 Shared values。

### B4.1 Access 类型唯一归属

Shared `access/{values,http,model}` 持有 cookie 名与持久时长、CAPTCHA 有限值/预算、登录 body、status 联合、公开 site key、黑名单分页与安全错误；Access 内部身份和密码登录请求归 `authentication/model/access-types.ts`，账号归 `accounts/model/account-types.ts`，登录计数/会话归 `sessions/model/session-types.ts`，验证码安装事实归 `captcha/model/captcha-types.ts`，技术 CAPTCHA 请求/失败归 `platform/security/captcha-verifier.ts`，存储行归对应 storage。接口 unknown → Shared codec → Access 应用命令；Account/Session Model 逐字段转换 SQL 行，Captcha Model 逐字段转换供应商请求和失败；`register.ts` 及 HTTP 接口逐字段投影 public 身份及 wire 响应。未暴露 password_hash、secret、cookie token 给其他模块。安装 CAPTCHA 字段独立定义在 register，并逐字段转内部 CaptchaConfiguration；SourceAddress/AllowedNetwork 在 admission/model，不含 ipaddr 实例。

### B3.2 类型

Shared wire 与内部观测事实独立定义；HTTP/WS 投影逐字段构造，包括 Docker stats、ports、labels 和 loadAvg。内部复用事实在 monitoring/model/observation-types，本机类型在 system/status/model/status-types；技术事实归 Platform。任务 scope 归 sessions/model/workspace-types，不暴露机器句柄。

### B3.1 唯一类型与转换

| 边界                                                   | 真实输入/输出                                                             | 唯一 owner                                                     | 白名单转换/消费者                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| WS envelope 与 connect/resume/terminal/suspend         | unknown JSON、requestId、viewport、token、generation、ACK、事件及安全失败 | Shared `remote/workspace`、`remote/terminal`、`remote/suspend` | Shared codec 严格读取；WS → sessions model 入参逐字段；WS 逐字段投影响应及事件；正式前端 F1 消费 |
| Workspace 应用会话、attached owner、pending 恢复、游标 | 状态判别联合、身份摘要、实例 generation、任务与关闭能力                   | `remote/sessions/model/*-types.ts`                             | sessions Service 消费；Model 转为纯技术连接/日志命令，敏感值不出 HTTP                            |
| SSH/PTY/channel/technical error                        | machine/shell 字节、开关/退出与派发结果                                   | `platform/ssh/ssh-port.ts`                                     | ssh2 Adapter 归一技术错误；sessions Model 映射具名应用失败，保留 cause                           |
| 日志/checkpoint 技术事实                               | 有界字节范围、偏移/修订、模式与视口                                       | sessions Model + Platform 本机日志/terminal 技术契约           | Model 字段投影；Service 持有页大小/保留/恢复政策；WS/HTTP 安全输出                               |
| 关联 Files 资源                                        | workspaceId、会话绑定与附件实例                                           | `remote/files/model/file-types.ts`                             | Workspace Service 调用 FileService 的实例绑定 release；Files Service 自行管理任务                |

Files请求/完整成功结果和ready/error事件统一由Shared remote/files/workspace及codec表达；正式浏览/编辑/预览消费者已在F1-C2-B1迁移，不留转导出兼容桥。metadata的accessedAt/modifiedAt由SFTP Model转换为Unix毫秒后投影，前端不二次换算。目录20,000项、搜索500项的结果上限由Shared values唯一维护，后端遍历队列/并发策略仍归Files。正式下载与上传port已迁Shared；上传完整回执/终态按原附件投影，failed.message使用Shared有限RemoteFileErrorCode，内部FileUploadEvent仍归Files Model；独立服务器传输HTTP也已接Shared；完整页面继续C2-D。

内部复用应用类型在所属 `model/*-types.ts`；存储契约在 storage；技术契约在 Platform；后端跨模块类型在 public；双端契约按 [Shared 架构](SHARED.md) 归属。类型与实现分开，低层不反向引用上层。Remote 内部会话关闭原因归 sessions/model，后端公开原因独立定义；内部 Model/Service 不引用本模块 public 类型。

业务流程、权限和操作顺序由 Service 持有；复杂或共用的纯判断放所属子功能 `*-rules.ts`，输入/结果类型仍归 model。规则只消费应用事实，不引用 Model 类、Service、Storage、SQL 或网络；简单判断直接留 Service，不为每个操作创建规则文件。Model 不内置业务算法，可以在事实转换回调中调用规则。

Model 逐字段转换应用与存储/技术输入结果；模块入口/出口 mapper 保护公开边界；HTTP/WS 逐字段投影完整 wire。三个边界各有职责，即使字段相同也保留运行时白名单；同一边界不复制转换。复杂公开投影可独立 public-mappers，单处投影就地保留。

应用与存储/底层能力之间明确保留 Model 转换层，即使当前字段一致、暂不需要变换，也不让 Service 绕过 Model；协议入口/出口 mapper 同样保留。精简只合并同一边界的重复实现，不删除转换边界。同一用例兼有存储与远端资源时，由 Service 协调；复杂度确有需要时按存储转换和资源封装拆分 Model，数据库事务不覆盖远端副作用。

协议差异由 interfaces 解码和投影，Service 以真实业务语义组织用例，不使用 Legacy/New 等迁移标签构造长期双轨。同语义共用路径归一、结果确认及资源执行机制；不同的覆盖前提、编码和操作范围保留明确用例。协议容量由 Shared codec/interface 校验，Service 另守应用路径、操作权限、预算与副作用约束。

Files 的 `FileResource` 只提供应用身份、可用状态、metadata/字节读取、staged write、基础 SFTP mutation、realpath/chmod 及受约束 command 结果；Machine/SFTP lease/Node Stream 私有持有于 Model 的 `SftpFileResource`。Model 负责技术 metadata/byte source、同目录临时项和技术 commit/discard 转换；Service 持有 UTF-8/hash/文件类型、覆盖、编码、search、递归/force 删除、批量顺序和写后确认等业务政策；目录搜索流程归 `files/service/file-search.ts`，资源准入与整项期限由主 Service 统一管理，不取得技术句柄。Files 内部失败码归 model，HTTP/WS 分别白名单投影公开契约。

ssh2 的 SFTP status、异步 read stream error 与 command channel 派发结果在 Platform Adapter 转为具名技术失败；Model 只消费 `remoteStatus` / `not_started|failed|unknown` 等技术契约，不读取供应商 `cause.code` 或错误正文。原始 cause 仅作诊断。PTY 同样通过应用资源操作。公开出口不传 cause 或凭据。Agent 的安全错误类在 public-errors，内部 agent-errors 只映射失败，不重复定义公开码；HTTP 使用 Shared 严格解码并逐字段投影。

Workspace复制失败message收窄为Shared RemoteFileErrorCode；归档失败为该有限码或WorkspaceArchiveErrorCode。内部任务对象保持独立，WS逐字段投影，归档警告仅投影verified_warning，缺失工具名按Shared有限取值投影，不输出原生命令、密码或技术诊断。Shared task-codec由正式前端严格消费；原Files执行、独立SSH/SFTP、资源准入与清理owner不变。

## 5. 入口与安装

工具只读审计安装 `GET /api/v1/agent/apps/:appId/runs/:id/tools/:toolCallId` 及 `/events`。Shared 严格解码 UUID 与 after/limit（默认 0/50，最多 100），RunService → RunToolModel → Storage 读取，register 和 HTTP 各自安全投影；Access 管理员身份在入场及异步结果交付前核验。响应最多 128 KiB，不新增工具创建/派发入口。前端 F1 待接线；目录/诊断、文件读写、Shell、Docker、Job 与 ACP 等工具的可信生产与执行源码已接线，真实权限、执行和故障行为统一留 B10。

register 在单一 v1 初始化之后，通过 RunToolModel 收敛未完成操作，并通过 ToolJobModel 收敛 queued/dispatched Job 后再接收请求。审批 request/consume 由内部可信工具消费者调用，不对外新增任意派发入口；resolve HTTP 只产生决议，不能消费执行许可。AcpPermissionService 持有独立持久权限操作，绑定父操作与真实 runtime 请求；缺失或失效的绑定明确拒绝，不能借普通工具审批派发父操作。

### B5.2 安装边界

register 安装一个 RunModel、RunStepModel、RunModelStream、RunExecutionOwner 和 RunService；ProviderService 在配置提交后通知该执行 owner 中止对应请求。AgentRequestOwner 先停止准入，quiesce Run/Provider/Registry，再等待已准入请求、实际Registry刷新和各资源close，SQLite最后关闭。Provider端点发现也纳入同一取消owner；Provider close独立等待其持有的网络Promise并有界保留多项清理失败，模块停止及关闭逐项执行，同步抛错不跳过其余资源；Registry最后一个HTTP订阅者离开不解除实际任务追踪。初始化在迁移后 reconcileUnsettled，不重发已派发请求。

状态 HTTP 统一经异步交付检查复核管理员会话，创建/取消的结果映射只负责状态码与白名单响应；交付失败不撤销已提交写入。保留创建/查询/取消/主事件 HTTP；增加 `/api/v1/agent/apps/:appId/runs/:id/steps/1` 和 `/steps/1/events` 两个管理员只读审计入口。没有公开执行启动/步骤写入接口。既有 DEV 页消费模型候选、必填模型三字段和步骤审计，正式前端 F1 未切换。

### Provider 安装与接口

register 安装 Provider/Registry/Run owners；管理员接口前缀 `/api/v1/agent/ai`，含 Provider CRUD、models、端点/保存配置的发现、test、model-registry 查询/resolve/refresh。PATCH 为 `expectedVersion` 加部分字段；省略字段保留旧值。Provider身份来自Access；各管理接口在异步读取/写入之后、结果交付前复查身份，撤销后不发布结果；写入已提交但交付失败不证明回滚。query契约及容量归Shared严格codec。 Provider自身在途任务覆盖网络、授权/配置复查及发现结果持久化，停止准入后仍等待读写收口；清理失败与关闭期间的存储/内部故障有界保留，同一失败不重复登记。

### B4.2 安装与真实接口

`registerAccess({sqlite,secrets,passkeys})` 装配 Factors，`createApp.configuration` 首次初始化持久 Preferences 的 passkeys 站点列表，每项为 `{origin,rpId}`，后续启动从持久安装快照装配，独立入口从 `NEXUS_PUBLIC_ORIGIN` 推断并允许 `NEXUS_PASSKEY_RP_ID` 收窄。RP 必须与公开来源 hostname 一致或是其合法父域；非 localhost 的 HTTP Origin 禁止启用。

因素路由：`POST /api/v1/auth/login/2fa`、`POST /api/v1/auth/2fa/{setup,verify}`、`DELETE /api/v1/auth/2fa`、`POST /api/v1/auth/passkey/{registration-options,register,authentication-options,authenticate}`、`GET /api/v1/auth/passkey/has-configured`、`GET /api/v1/auth/user/passkeys`、`DELETE /api/v1/auth/user/passkeys/:credentialID`、`PUT /api/v1/auth/user/passkeys/:credentialID/name`。Auth HTTP 仅签 HttpOnly/SameSite/Lax 受控 cookie；FactorService 始终通过完整 SessionModel 验证管理权限。

### B4.1 Access 安装与入口

`createApp` 先读取 Preferences 持久快照；`AppOptions.configuration` 是仅首次创建时调用的初始化工厂。独立 `main.ts` 提供 `NEXUS_IP_WHITELIST`（逗号/换行分隔 CIDR）、`NEXUS_IP_BLACKLIST_ENABLED`（默认 true）、`NEXUS_MAX_LOGIN_ATTEMPTS`（默认 5）、`NEXUS_LOGIN_BAN_SECONDS`（默认 300）、`NEXUS_CAPTCHA_ENABLED/PROVIDER/SITE_KEY/SECRET_KEY`（默认关闭）并在开放监听前检查值。实际 Access HTTP：`GET /api/v1/auth/{needs-setup,status,captcha/config}`、`POST /api/v1/auth/{setup,login,logout}`、`PUT /api/v1/auth/password`；认证的黑名单 `GET/DELETE /api/v1/settings/ip-blacklist`；其它 Targets/Remote/Agent/System 路由经全局完整来源准入，未知路径同样检查来源；仅状态、登出、登录及管理员黑名单恢复保留白名单级入场（后者须 Access Service 验证 userId=1）。CAPTCHA 成功绑定公共 Origin hostname；安装时从公共 Origin 推导，未绑定拒绝启用。Preferences 在 Access 注册前提供经过校验的版本化快照；保存与生效版本分开，统一重启激活，不使用 Platform 注册槽或局部热刷新。

基础认证setup/login/password及TOTP二阶段登录路由显式引用Shared `ACCESS_AUTH_REQUEST_MAX_BYTES`，保持原16KiB传输预算；前端同一常量约束完整编码输入，不用字段长度替代路由预算。

### B3.2 入口

同一 `/ws/workspace` 安装 status.start/stop、docker.status/command/stats，事件 status.sample/error；HTTP 保留 `/api/v1/system/status`、`/ssh-resources` 与 `/ssh-resources/:connectionId`。Remote/register 装配观测能力，System/register 安装本机能力；Bootstrap 仅调用模块安装入口。观测空请求codec归Shared monitoring，Docker仅消费自己的命令/统计codec，HTTP/WS仍在原协议边界白名单投影；正式前端WS与Dashboard概览HTTP已接Shared，配置消费者继续F1-C2-C2，不改变Remote/Agent各自授权政策。

### B3.1 安装设计

`registerRemote` 只安装一个 `/ws/workspace`，接入 `workspace.connect/resume/ping/close`、`terminal.input/resize/flow/currentDirectory/changeDirectory`、`suspend.mark/prepare/commit/unmark/list/resume/owner.renew/history.previous/history.reset/terminate/remove/rename`，保留 Files/transfer 实际协议；另安装 `/api/v1/ssh-suspend` 的列表、终止、移除断线条目、重命名、日志导出。旧 PTY HTTP/WS 仍在独立消费者范围内运行；不得因新入口存在就宣称旧接口等价。管理和 WS 共用 sessions 的权限、结果与资源 owner。

main 读取环境和启动；Bootstrap 安装实例与全库迁移；模块 register 组装内部 Model/Service/Adapter，并返回消费者需要的能力、HTTP/WS 安装及 quiesce/close。Bootstrap 不逐个构造所有业务 Repository，也不引用私有配置类型。

Targets 导入仅公开 importMany；单项使用一元素集合，每项仍有独立事务与安全结果。importOne 保留为模块内部实现，不因测试方便扩大出口。管理类型为区分模块保留 Shared 别名，不复制字段定义。

待实施：模块 interfaces 将 Shared 协议 schema 绑定到真实 HTTP 路由，Platform 提供通用元数据契约，Bootstrap 汇总已安装路由生成 OpenAPI；WS 契约另行汇总。当前 HttpRoute 尚无完整 schema 关联，此设计不能写成已完成。

Platform HTTP 已支持 HEAD、流响应和按路由 opt-in 的 binary 入站，队列/背压属于技术层。票据、Workspace/任务、目标授权与业务预算归 Remote；Platform 不注册业务资源。统一 Files 应用绑定由 FileService 持有，Interface 不作为 Service 的资源查询来源。

Access 取得可信会话身份；Targets 管理出口只给非敏感对象，可信 SSH 解析为独立后端能力；Remote 普通资源绑定登录会话；Agent 绑定自己的 user/App/Thread/Run。UUID 和目标选择不替代授权。模块内部 HTTP 可调用本模块明确 Service，跨模块仍走 public。

Remote 会话 HTTP 仅负责协议解码和失败投影，入场身份查询与管理员授权统一由 RemoteSessionOwner 执行。读取/关闭对未认证或无权限身份抛具名失败，认证通过但资源不属于该会话时返回未找到；建连完成后再次核对权威身份，WebSocket 访问/输出也继续复查。入场去重不删除异步期间会话撤销保护。

Remote 同时安装 `/ws/workspace` 的旧 Files 子协议适配层。Interface 持有旧 envelope、requestId/in-flight、binary read owner、NXW1 发送、cancel 和 ready/error；旧 WorkspaceEventHub/Protocol 复查确认没有独立 Files mutation change event，因此适配层不虚构 `filesystem.changed` 一类消息。Files Service 持有路径/编码/操作政策；Model/Platform 不知道旧 Workspace DTO。R1 恢复 fresh `workspace.connect`、`workspace.ping` 与 Files 消息；完整 `workspace.resume`、Terminal/suspend 已有 B3.1 源码，status/docker 已有 B3.2 源码，行为统一待 B10。下载/上传/传输/归档的 B2 源码已收口，行为待 B10。现有 `/api/v1/remote/files` 暂由 DEV `remote-next` 消费，后续 P1/F1 决定最终 API，不把双入口固化成长期设计。

## 6. 数据、事务与并发

工具事件分页在 SQLite 同一事务核对 user/App/Run/Tool 当前记录并读取其历史状态事件；按 revision 升序、严格大于 after，空页 nextCursor=after，否则为末项 revision。读取页校验应有条数、连续 revision、operationRevision 不倒退；到达当前 revision 时，事件的 hash/状态/修订/时间必须与当前行一致；不存在或范围不匹配返回未找到，不查询跨范围事件。读取与当前行校验共享快照，不据审计状态授予执行权。

agent_run_tools 通过复合外键绑定 Run/user/App，agent_governance_approvals 绑定同范围 ToolCall；agent_run_tool_events 与每次操作更新同事务写入。operationRevision 只随内容改变，revision 随状态/内容改变，审批 inputRevision 绑定前者。request/resolve/consume 读取当前政策、Run、操作、目标；consume 对未消费的普通工具批准做 CAS，并与 dispatched 状态及事件原子提交。历史 approved/幂等快照不产生第二份许可；未知提交不允许外呼。App/政策/审批和工具派发修订在递增前检查安全整数上限，批量失效也先检查原集合，任一耗尽使原事务回滚。审批消费时间必须处于决议之后且截止之前，存储与 Shared decoder 同时拒绝矛盾记录。审批创建及其后续 Operations 事件发布同属 GovernanceService 的在途任务；已提交审批后的事件失败保留 operation_unknown 与原因。

Model 根据完整应用检查内容和 user/App/Run/modelStepIndex/providerCallId 的固定位置编码生成 SHA-256，内部调用者不指定 operationHash；检查写入时间在 Adapter 的实际事务中取样。该摘要不替代可信工具定义/输入生产者。同模型步骤内相同 providerCallId/hash 的重放还须匹配完整检查内容；不一致返回版本冲突。工具 finish 在事务内复查父 Run 与自身 revision，结算与状态事件、未决审批失效原子提交，时间在写事务内取样。Run 完成不能越过 inspected/dispatched/unknown 工具；父 Run 终态与工具围栏同事务提交。启动恢复同时读取模型步骤和工具账本，即使没有模型步骤，也不遗漏已派发工具；保留其 unknown，不重放。

### B5.2 状态提交与恢复约束

第一版通过一个 applicationMigration 直接安装完整 Run、事件与步骤账本，不执行开发期父表重建或数据升级。各模块仅编排所属 Adapter 的初始化接口；版本 marker 与全库 DDL 同事务提交，提交未知不重试。

reserve/dispatch 同事务校验主体、App、Run version、step revision、请求 hash、冻结政策和当前 Provider 版本/凭据代际。dispatch 同时写 running、run.started 和 dispatched；finish 同时写主子终态、版本及事件。文本/usage 写入须持有 running 和有效 CAS。取消先持久围栏，再 Abort。

恢复仅将 reserved 归 failed/DISPATCH_NOT_STARTED、dispatched 或孤立 running 归 unknown；主子状态、版本、hash 和事件数量不合法则拒绝并保留现场。unknown 主 Run 保持活跃直到显式取消；已终结 unknown 步骤后取消主 Run 允许主版本多一。均不自动重放付费请求。

### Provider 事务与冻结

第一版初始化直接创建 Provider、Registry 与冻结输入表。配置更新 CAS 增加 version；替换/清除/删除凭据增加 credentialRevision。Run、冻结输入、初始事件及幂等记录同事务写入；Model 回调从存储记录投影应用事实并判断，结果再投影为存储命令。重放先返回原结果。冻结包含端点、协议、模型能力和原凭据代际，不含密钥；已变配置或凭据不能以新秘密替代旧引用。删除关联 active `pending/running/unknown` Run 的 Provider 返回冲突。观察数据失效与删除准入由 Provider 纯规则决定；Adapter 在同一事务读取当前配置或去重的 Run 状态，Model 显式转换后调用同步规则，再由 Adapter 执行存储任务。CAS/关联读取与写入保持同一事务，Adapter 不定义业务状态筛选政策。

### B4.2 因素存储与挑战原子性

第一版初始化在 `access_accounts` 定义 `totp_secret_encrypted`，创建 `access_pending_logins`、`access_factor_challenges`、`access_passkeys`。待登录只保存 digest、用户、密码修订、rememberMe 与五分钟到期，同一浏览器旧 partial 按摘要同事务替换，最大 64 在事务中准入；挑战只保存 digest、kind、用户/完整会话摘要、加密的暂存 TOTP secret 或 WebAuthn challenge、RP/Origin 与到期，最多 1024。保存新 challenge 会删除旧 cookie 对应项，完整会话下同类 challenge 被替换。注册只有在原 challenge 未过期、同一账号完整 session 仍有效、credential ID 未占用时入库。认证在存储事务内复验 challenge、账户/credential 所属、counter 变化、来源封禁，并同事务消耗 challenge、更新计数、签发完整 session；零 counter 遵循旧技术契约，非零 counter 必须递增。TOTP 激活在 session 与 challenge 上 CAS，禁用在密码旧 hash、session 和当前加密 secret 上 CAS；禁用后删除该账户 pending/challenge。

Access 改密由 Service 一次入场认证、AccountModel 转 token digest，SQLite 在修改同一事务复核原 session 仍存在且未到期、旧 password hash 未变，再撤销账号全部会话；计算密码期间撤销或过期阻止写入。登录签发 Storage 与 Model 各自持有具名结果，明确 issued、credentials_changed、rate_limited、cancelled，避免并发封禁被降为错误密码。accounts/sessions Model 使用共用 access-storage-boundary 转技术失败，公开 accessBoundary 只消费应用失败并投影安全码。该 helper 只用于 Model 的技术错误转换，不是新的 Service 或公开能力。

### B4.1 Access 持久权威与竞态

Access 登录失败记录的 `last_attempt_at` 及其索引直接在第一版初始化中建立，不保留开发版数据回填。

`access_accounts` 对管理员初始化使用同一 SQLite 事务的空库检查/唯一写入；改密以旧 hash CAS 更新并同事务删除用户全部 `access_sessions`。`access_sessions` 只保存 256-bit 随机 bearer 的 SHA-256 摘要、账号凭据修订、remember 标志与 30 天到期；状态每次验证从存储重新查，撤销即失效，不复制到 Platform。`access_login_attempts` 按规范化公网 IP 保存次数、窗口起点、封禁至与最后失败时间。普通会话及各模块的原事务身份读取在查询完成后取当前时钟核对期限，不使用入场时刻；账户行由 accounts Adapter 唯一解码，会话复用，不把损坏账户/到期字段当正常未登录并静默修复。失败计数的读改写在存储事务内使用应用规则回调，窗口/封禁和持久时间取同一次当前时钟；成功登录在创建会话事务里复核账号密码/因素及当时封禁、检查取消意图，然后原子新增 token 摘要并清除失败记录；不预先撤销旧浏览器会话：HTTP Cookie 交付无法与 SQLite 提交原子绑定，断连时旧 Cookie 必须仍可使用。若事务已提交、响应尚未交付，则尝试撤销新 token；确认不了撤销/提交时保持 `operation_unknown`，不声称自动回滚。每 5 分钟至多执行一次后台数据库惰性 sweep，删除过期会话与封禁已结束且最后失败超过 7 天的记录，不提前清活跃封禁。名单列表/解除的管理员准入由 AccessService 提供纯同步判断，SessionModel 将 token 转摘要、独立存储 SessionRecord 转 SessionIdentity；SessionTransactionAdmission 只用存储类型。SQLite 在同一真实事务开始及完成前复查当前原会话，身份失效回滚解除或拒绝交付；HTTP 不额外先查一次身份。名单解除是独立删除；登录先检允许入场，验证码网络 await 后、会话提交前复检封禁。单 SQLite v1 已包含 Preferences 配置表；持久配置由 Preferences 拥有，Access 只消费安装快照。

### B3.2 并发与缓存

无新增业务持久化，不创建空 storage。缓存仍为本进程状态；Docker 控制与 Agent/Files 共用 Remote machines 持久突变占用，Preferences 已接入状态间隔/资源刷新持久配置。Workspace 操作绑定具体 attachment、配置 fingerprint 与原 owner；后台主机缓存当前仅供 userId=1，按 host/port 及完整可信配置指纹隔离，同配置在途采样共享，TTL 从开始计算。删除/改配置及 reset 后旧任务不可回填。首次初始化默认状态间隔 3 秒、后台 TTL 30 秒；Preferences 保存的配置在下次启动统一安装，独立 Service 的技术安装默认不覆盖持久设置。Docker 按规范化文本 endpoint 与全部受管突变互斥，覆盖容器名称与短/完整 ID 别名；unknown/清理失败保持持久 blocked，重启不解除，恢复能力已由下述B9机器突变恢复接线，行为待B10。

### B3.1 权威状态与竞态

活跃 SSH/PTY、attachment/generation、lease、ACK 等由进程内唯一 Workspace Service 状态机权威持有，重启不持久化技术句柄。64 个普通 Workspace 名额在首次异步身份/目标解析前原子预留，覆盖排队、opening、attached/detached、closing 和未确认清理；重复 ID 不能抢占或重复计数。挂起目录另按用户 32/进程 64 限额与 24h 生存期，重附着同一 Workspace 不再占第二槽。每次 await/WS delivery/ACK 都复查记录实例与 generation；过期/旧 attachment 不能归还新实例或恢复旧 input。技术日志在私有本机临时目录，可重启清理，无持久活跃 shell。文件记录若无需 SQL 则不创建数据库层；任何未来持久变更仍经 Model/Storage/Adapter 执行。

真实 SQL 仅在 Adapter：Agent scope/runs 和 Targets Host Key DDL 归各子功能 `adapters/sqlite`，模块迁移通过初始化接口调用。Bootstrap 只保留一个 v1 applicationMigration，直接安装当前完整表结构，版本 marker 与 DDL 同事务提交。首次发布前持续维护该初始结构，不为开发批次追加版本；既有开发版数据库不兼容，新空库验证留 B10。

Platform 的 SQL Executor 契约在 `storage/sqlite/sql-types.ts`；版本表 Adapter、事务控制 Adapter 和 Worker 在 adapters。Runtime 持有队列、隔离和失败语义：回调失败回滚，rollback_failed/commit_unknown 保留因果并使实例不可用；未知提交不自动重试。Worker 严格验证完整消息，损坏/不可关联结果使待完成调用全部拒绝。

业务多表写入和引用/CAS/幂等校验归存储 Adapter 的真实事务。需要当前状态的业务规则采用明确同步回调：Adapter 在事务内读存储事实 → Model 白名单转换为应用事实 → 纯规则判断 → Model 转回存储结果 → Adapter 写入/提交；回调不执行网络、异步任务或开启嵌套事务。Adapter 只依赖 storage 中的回调契约，不导入应用类型、规则实现或业务策略配置；禁止先在 Service 读旧状态、判断后另开事务写入。

B1 Files mutation 不新增数据库或 SQL。单个文件资源由 Service 串行执行操作，但远端 SFTP 预检与后续 mutation 之间仍存在服务器侧竞争窗口；`expectedSha256` 的两次复查只提供尽力冲突检测，不是事务/CAS。目录项 rename 的目标不存在预检同样不是原子 no-overwrite 保证。

Access 的失败窗口/封禁计算在 sessions/login-failure-rules，Adapter 只读取、解码计数并原子写回。Targets 的 connections/ssh-graph-rules 根据同事务图快照覆盖拟修改边，再校验成环、深度、展开数量及受影响祖先；Adapter 读图及写关系，Model 持有回调转换，register 同时装配普通写入与导入/克隆路径。Agent 的 runs/run-rules 同样独立于 Model，版本/状态判断继续在事务内执行。Targets 可信解析在同一 SQL 快照读取目标、凭据与路由，Model 计算指纹并在解密前核对 expectedFingerprint；先读指纹后重新解析不能替代同快照检查。指纹不替代 Host Key 信任，也不证明后续配置永不变化。

## 7. 生命周期与失败

取消/禁用/来源或名单撤销与模型步骤、ToolCall 的持久围栏同事务：inspected → cancelled，dispatched → unknown，状态事件同时写入。重启通过同一 SQLite owner 收敛，不重新执行。审批内部期限/消费时间为 Unix 秒，工具账本时间为毫秒；消费从同一个事务内时钟样本投影两种表示，不能把截断的秒直接作为毫秒更新时间。当前文件/Shell/Docker工具资源关闭已接线，ACP等待/关闭已接线，直接 Child/族收尾已接线，剩余跨 Run 资源由后续 B6/B8 承接。

### B5.2 增量执行流生命周期

Run owner 在持久创建前保留本机准入：8 个尝试名额（含在途创建、资源清理失败的已结算任务），64 个在途写入。拒绝关闭/满额请求不先创建 Run。每个尝试有 5 分钟本地 Abort 期限，不能证明远端停止或计费结束。quiesce 拒绝新请求并中止任务；close 共享 Promise，等待已准入写入与任务结算，有界保留 32 个失败及超量计数。清理失败任务不提前释放名额。

Provider 配置提交后中止本进程关联请求；获取凭据后、dispatch 返回后及发布每个模型事件前复查当前 Provider，复查 await 后检查 Abort。跨进程配置变更以重新读取发现，不宣称网络副作用与配置更新具有跨系统原子性。未派发失败与已派发 unknown 分开，SQLite 写入异常不误归网络失败或重复补写；双重失败保留 AggregateError。

技术 Adapter 持有响应体、reader 和迭代器清理，取消失败仍尝试 releaseLock，异常 cause 留内部。Registry下载同样保留清理失败；Provider/Registry在清理失败后拒绝新网络工作并在模块close上报，Registry无人订阅后的持久写入失败也保留并阻断重试。Model 等待技术迭代自然退出及清理完成后才发布唯一 finished/stop；缺失/重复终态、断流、拒绝/工具输出、未知事件、空正文和不一致快照都不能成功。Provider probe 与 Run 共用解码器，前者仍受 512 KiB/16 token 限额，不授予执行权。

SSE 逐块严格 UTF-8，先归一化 LF/CRLF/CR 再分帧，跨 chunk 的 CRLF 仍是一个换行；校验 event 名称与载荷。普通帧/注释帧 128 KiB，Responses 重复完整文本的 done/completed 快照帧可至 8 MiB，网络总量 8 MiB、正文总量 2 MiB 独立限制。普通增量不因快照预算扩大。

### Provider 生命周期与失败

Provider 外呼完整期限 10 秒，Registry 刷新 15 秒；真实 fetch 支持 Abort、有界读取及拒绝重定向。允许管理员配置的 HTTP(S)/内网端点，额外出口隔离由部署承担。更新/删除中止本进程相关请求；外呼前后及观察写入前复查配置、凭据与身份，CAS 拒绝陈旧回写。Registry 请求 single-flight，各订阅者独立取消，最后订阅者退出中止底层任务；新请求先等待已取消任务及其存储写入收尾，再共享新刷新，避免旧失败覆盖新成功。缓存 JSON 由 Registry SQLite Adapter 解码为独立 storage 快照，Model 经 registry-projection 双向白名单转换；损坏缓存由应用层报告不可用，不影响后续刷新。精确的 provider/modelId 条目优先于短名称别名。测试传递模型推理参数并校验两种协议的 SSE 终态；缺省 usage 不补零。Model 将技术错误转具名应用失败并保留 cause。提交未知保留 operation_unknown；响应总预算 8 MiB，超限返回 limit_exceeded。应用/存储时间为毫秒，Registry 对外 Unix 秒由 HTTP mapper 转换。

### B4.2 安全失败与清理

TOTP 使用随机 20-byte 秘钥的 Base32/HMAC-SHA1 6 位 RFC6238、30 秒步进前后各一窗，向用户展示 otpauth QR；仅在加密 `SecretBox` 生效时允许初始化，密钥以账户绑定 AAD 存 SQLite，失败拒绝而非明文降级。WebAuthn 由本地 `@simplewebauthn/server` 验证签名、challenge、公开 Origin、RP ID 与 user verification，认证 counter 用 SQLite CAS，不能信任客户端自报结果。多个并发完成只能消费同一 token 一次，重试未知结果先重新获取权威会话。完成登录前检查来源黑名单，错误因素验证码累计来源失败。Logout 同时撤销完整/部分 bearer 和设置/Passkey challenge；过期与替换 challenge 不成为资源授权。已经派发的数据库事务不因断连而假定回滚；WebAuthn 浏览器结果的真实交付行为留 B10。

### B4.1 Access 生命周期

账号不存在时仍执行无账号的耗时密码校验以缩小用户枚举时差；密码错误与 CAPTCHA 拒绝只记有权限的公网失败计数，强制 Passkey 的账号拒绝密码路径（`factor_unavailable`），TOTP 账号转部分认证而不签发完整会话。CAPTCHA 网络 Adapter 单次 POST、不自动重试、十秒截止、16 KiB 响应预算；配置无效在安装时拒绝，网络/非预期响应是安全 `captcha_unavailable`，供应商明确 `success:false` 是 `captcha_invalid`；成功时还必须匹配配置的公开 Origin hostname，Google 仅支持 v2 checkbox、不接受 v3 action/score，非 2xx 响应体取消，不能固定成功。请求断连传播 AbortSignal，已开始的 SQLite 事务不凭取消推断回滚。失败计数/签发是独立事务，供应商失败不影响既有会话。改密和登出持久撤销立即阻断下一次身份复查，但不能撤回已经发出的远端副作用；Workspace、Files、PTY、desktop、Agent 原 owner 仍在操作/交付/定期状态门槛复验会话摘要并自行收尾。HTTP 与各独立模块关闭并发收尾，SQLite 在二者实际结束后关闭；失败聚合，不把定时等待终结当资源释放。

### B3.2 生命周期

临时命令任务有全局准入和整项期限，取消不提前释放；Workspace detach/close 和观察 owner shutdown 取消关联任务并等待真实收敛。Model 关闭临时 SSH，不修改最近连接时间，不在 PTY 注入采集命令。Docker 非零退出是确定失败，已派发但无退出证据为 operation_unknown，清理失败保持具名类别并占用名额；不自动重放。订阅取消使旧结果失效，慢采样不重叠，资源缓存不交付已失效身份/配置。

### B3.1 生命周期设计

连接按 reserve → 身份/可信目标 → SSH open → shell open → FileAttachment → 认证复查 → 绑定 WS/交付 → ACK/运行推进；异步拒绝或取消后晚到 shell 和 Files 仍由其原 owner 追踪关闭，确认清理前不释放预留。异常 WS 断线只解除当前 generation，默认保留约 120 秒再终止；主动关闭先失效附着，终止 shell 及相关 Files/transfer。标记/prepare/commit 挂起应完整记录日志/checkpoint、先暂停后移交再恢复消费，部分副作用未确认的结果保留 `operation_unknown`。接管先撤旧 generation，再有界交付历史/状态与明确恢复 ACK；未 ACK 不能宣称恢复完成，原 owner 在 rollback/lease expiry 继续跟踪资源。日志导出按Shared限制渲染后UTF-8实际交付不超过128MiB，流中超限终止交付且仍释放原source；该预算不同于原始历史窗口。管理HTTP按Shared严格解码输入/目录输出，输出投影无效映射remote_unavailable而非用户输入错误。历史 100 MiB 最大保留、初始约 256 KiB、翻页约 256 KiB、checkpoint 4 MiB，流读取/完整编码/客户端背压单独设限，先做输入预检、再对读到的实际字节检查；不声称快照或磁盘硬配额。同步抛错、异步拒绝、清理多个失败经具名错误与 AggregateError 收敛，同一失败只登记一次。远端失控/断网后不主动重放命令与 unknown 变更；D12/D13 的原生工具与非原子窗口取舍不变。

资源有唯一 owner；准入、半开、活跃和关闭任务追踪至真实收敛。等待超时不归还仍被资源占用的名额；晚成功关闭，晚拒绝中的清理失败进入有界诊断及停机汇总。`RemoteResourceCleanupFailure` 区分清理完整性失败与普通授权/建连拒绝。

外部操作和按 ID 释放继续认证；已获资源的内部 owner 使用绑定该实例的窄关闭能力，撤销会话、取消或断开后仍能完成清理，不重新认证后才关闭，不增加任意 ID 的无认证释放入口。关闭能力不进入 Shared/HTTP，关闭 Promise 与失败仍归原资源 owner。

二进制读取的允许类型、容量和初始范围由 Service 确定，Model/Platform 按明确字节范围读取；空文件不创建无界流，短读不能伪报完整成功，后续追加不扩张本次范围。范围确定不等于内容快照；失败、提前终止和消费者断开都须收敛底层读取。

R2 后，Files Service 的 `runAdmitted` 统一限定二进制数据及 final 帧发送期限，Service 将同一有效 signal/剩余期限交给 Interface 的 NXW1/backpressure 发送循环；Interface 不再独立无限等待。应用交付联合类型 `FileBinaryPiece`/回调归 Files Model 类型 owner，Interface 仅投影具体帧。Workspace `ping` 调用 Service 核对登录身份、配置指纹、资源权威状态及 Workspace ID 并续期；失效绑定不继续发布成功。Files Service 对普通 Workspace 保留 64 个含 opening/closing 的预约，独立 HTTP Files 另有 8 个名额，晚到清理与无法确认的关闭仍占对应名额，避免错误释放。

R2 二次审核：Workspace `connect` 的 Targets `get` 不再由 Interface 在容量/期限之外等待，Files Service 在第一次 await 前预留 workspaceId 和 64 槽，将身份/Targets 查找/SSH open 置于同一个可中断的建连期限；返回 `WorkspaceFileAttachment.connectionName` 的应用事实，WS Interface 仅投影。关闭期间底层 SSH cleanup 可能无界，不能以强制短路伪称已清理；WS 心跳和断开先失效绑定、交还确定失败，Service 对迟到资源、关闭 Promise 和清理错误持续负责，**只有确认释放成功才归还名额**。测试夹具的 Service 构造调用已同步注入 Targets public 查询；慢查、竞态与失败清理的精确验收范围见 testing；受控 Service 队列、晚构造及64预约证据不替代真实传输故障。

关闭先保存共享 Promise，再执行可能重入的清理；取消订阅也属于可能失败的清理步骤，一项失败仍继续其余退订、资源关闭和终态通知，保留全部因果并聚合。停机停止新准入、关闭 HTTP/WS 并等待已接纳任务、取消并 drain 模块资源，最后关闭 SQLite。当前动态资源由 Remote 持有，后续 Agent 调度/执行必须提供自己的生命周期。

普通 PTY、Files 和 Agent 使用共同 SSH/SFTP Platform 工厂，但不共用授权或活跃资源；Remote sessions/files 共用的可信目标建连转换由本模块 `machines/model` 持有，Agent 不深层导入它。PTY 协议 owner 管 ACK/背压/EOF；Files Service 管身份/指纹复查、准入/期限和文件业务流程，Files Model 管 SFTP lease、byte source、metadata 转换与 staged temp/commit。新建文件使用标准 SFTP rename，不调用可覆盖目标的 POSIX replace；覆盖已有文件才使用 replace。实际 SFTP 目录扫描以 opendir/readdir(handle)/close 收敛，文件读取经 Adapter `readChunks` 将异步 ssh2 error 归一后再交 Model。

下载HTTP Interface保留GET/HEAD、单段/suffix Range、inline和目录ZIP；票据POST显式使用Shared 32KiB预算，JSON/容量等HttpInputFailure交还Platform，不包装成500。安全失败由Shared有限message/code契约约束，真实状态码保持对应。HTTP sink只保留最后1字节，源迭代与最后授权复查后随response.end交付，避免Content-Length已满足但应用还在等待时代理提前断开并退役健康Files资源；空文件不生成额外字节。票据300秒TTL的协议值与Service实际期限同源，活跃流/原实例/IP/会话绑定政策仍归Files owner。服务端finish仍不证明浏览器保存成功。

B2 源码已包含独立 HTTP 文件下载 ticket/GET/HEAD/目录 ZIP 和 binary 上传 WS。Platform HTTP 提供通用 HEAD 与 opt-in binary ingress（其余 PTY/Workspace 控制消息仍拒绝原始字节），Platform SFTP 按明确 byte offset/end 读取及技术流期限；不会接收 Workspace、票据或 Task 业务类型。Files Model 对外提供 byte source 和临时写流 staged append/commit/discard；HTTP Interface 解码 Range 语法/状态码，FileService 负责应用范围政策、票据、上传冲突、目录 allowlist、原有 Workspace owner/身份与指纹、任务准入与长流确认。ZIP 目录遍历政策由 Service file-directory-zip 持有，条目/字节经 file-zip-model 转给技术 ZIP Adapter，库/reader/producer 的收尾归 Adapter；file-copy 则完成文件/目录 SFTP copy/move 技术流程，Interface 单向投影状态和 metadata，不在 Platform 放文件业务政策。

本批没有把旧传输实现照搬为远端通用命令：旧跨机器执行曾将私钥临时放在远端机器上、使用包含密码的命令参数，新 copy/move 使用独立的 SFTP 源/目标技术资源；未知副作用不自动重放。旧上传传输层异步触发 append，但其 Service 本来有串行队列；新 binary WS 在技术接收层额外显式串行并受背压/字节上限控制。旧目录 ZIP 遍历与短期下载票据活跃流过期等隐患均增加有界 owner 处理。跨不同登录 token 的同用户 Workspace 源资源改经 Access authenticateDigest 校验原会话有效性及当前请求者身份；原 bearer 不保留。Model 的 SFTP readlink/symlink 支撑保留链接本体，目录复制后显式恢复 mode，旧隐式跟随 symlink 的行为不照搬。

B2 archive 由 Service 决定输入/成员安全/任务/取消与发布；file-archive-model 将应用参数/结果和错误显式转换，Platform archive native Adapter 持有 shell 命令、原生列表及退出码解码；FileResource 管 SSH/SFTP 技术资源：压缩通过原生 `zip`、GNU `tar` 直接在远端写带格式后缀的私有 `.part`，由 SFTP 确认后 rename/replace；支持归档输出位于所选源目录内部，源树先经 SFTP 有界扫描并拒绝控制字符（防止 native stdout 进度伪造），命令明确排除旧目标和临时项。解压先用远端原生 `cp --reflink=auto --no-dereference` 建立权限受限的私有归档快照并经 SFTP 核验文件类型/大小，`unzip`/`zipinfo` 或 GNU `tar` 对该快照分别列出简略成员名与详细成员元数据并逐项交叉检查名称/类型/大小（GNU tar 顶层 `./` 不占发布条目预算），实际提取使用同一份快照，按规范化路径、非目录祖先、重复名称、特殊成员、20k 项/64 GiB 声明展开预算与 64 层深度校验，GNU tar 使用 `--no-overwrite-dir` 防止根条目改写私有 stage 权限，先提取至私有 stage，再由 SFTP 复核每一项的真实类型、实际文件大小、总展开体积/层级及 setuid/setgid 权限位，并预检查目标路径类型冲突后发布；原生提取显式排除 symlink/hardlink，只提取普通文件和目录；应用校验通过后，符号链接经 FileResource/SFTP 创建，TAR 硬链接由 ArchiveModel → native Adapter 的 `ln -P` 创建，避免提取中沿归档链接写入；设备/特权成员仍在提取前拒绝。源可能并发变化，预检不等于文件快照；保留 unknown 退役、取消与进度边界。密码执行器按实施方案 D12 保留原生 zip/unzip `-P`：密码经 POSIX shell quote 直接拼入原生命令参数，与旧正式实现一致；接受 SSH command string 和工具 argv 中包含密码，不额外导出密码环境变量，不记录完整命令或回传诊断。无需新增归档 PTY、Python 或 Expect；现有 Model 转换不变。B10 核对密码/失败/秘密日志行为；不承诺 AES 兼容。

SFTP 单次元数据请求的技术上限唯一归 Platform SSH 契约，FileResource Model 将应用剩余期限限制到该上限；上传字节流仍使用完整传输期限，不把总任务预算当作单次 RPC 预算。同目标移动在目标不存在时优先 rename；已有普通文件或目录走既有 staged copy/merge，全部复制确认后再删除来源，类型冲突仍拒绝。

归档纯政策归 `files/file-archive-rules.ts`：成员名称/结构/预算、符号链接逐段目标及硬链接引用完整性只消费应用事实，不访问资源。归档内部 `FileArchiveEntry`、链接计划和提取计划归 `files/model/file-task-types.ts`，不放 Shared；Service 编排快照、提取、链接物化、发布与恢复。Model 对提取计划及成员 kind/linkTarget 显式白名单转换；native Adapter 解码 GNU tar 的 `->`/`link to` 与 ZIP 链接载荷，处理 Info-ZIP 的字面量 pattern 和原生排除参数；压缩时临时输出/旧目标的 ZIP 排除项同样逐项转义，shell 引号不替代工具 pattern 转义。ZIP 链接载荷按 4096-byte 预算、严格 UTF-8、具名密码失败和真实结束 marker 解码，不给 Service 原始 CLI 输出。硬链接保留真实 inode 关联，不自动退化为复制。

Remote 协议入口按通道归 `interfaces/http` 与 `interfaces/ws`；PTY、Workspace Files 和 upload binary 都归 ws，业务语境留文件名。目录迁移同步 register 和后端 fixture，URL、Shared 协议及授权 owner 不变；没有旧路径转导出。

Native Adapter 的列表输出按 names/modes 顺序分段，每段 od 独立检查退出状态；只有完整两段之后才输出完成标记，不依赖 POSIX 管道的最后一步掩盖前一步失败。列表工具写入前设置单文件大小限制，后端每段 8 MiB 解码预算仍保留；限额及工具语法是技术策略，不进入 Shared。该单文件限额不提供解压总配额。命令 stdin finished 监听在 Model 完成/取消后清理，stderr 与 channel 继续由原 finally 收尾。

Native Adapter 将原始工具退出码归一为 NativeArchiveOperationOutcome；Model 只消费 missing_tool/limit_exceeded/password_required/invalid_password/rejected 技术事实，再显式投影应用失败。压缩 writerExited 来自工具返回后的独立 marker，容量超限继续 drain，未确认 writer 退出不能清理或通过 ZIP warning 发布。ZIP/TAR 成员的 mode 在技术 parser 解码，DOS ZIP 没有 POSIX 元数据时为 null；Service 拒绝特权成员，记录 native stage 的 mtime，并在发布后由深至浅恢复明确成员的普通 mode/mtime，stat 确认整项结果。未显式声明的既有 implicit directory 不重写属性。发布及恢复前检查根规范路径与父目录 lstat/realpath；这是有界复查，不能替代 fd/nofollow 原子能力。安全链接有源码实现、实机待验，设备/特权成员的 UNSUPPORTED_ENTRY 与前端消费延后项在 Shared/实施方案对应 owner 维护。

mutation 技术结果区分 `not_started / failed / unknown`；远端 command channel 建立也使用同样派发分类。已派发后取消、deadline 或连接终止不证明远端回滚，unknown 资源退役且不自动重试。写入已生效后的读取或结果校验失败同样保持未知结果，不能按普通未写入失败处理。确定失败尽力清理临时项；unknown 时不继续发可能与晚到 mutation 竞争的清理命令，因此真实服务器可能残留私有 temp/backup，B10 必须核对。整体停机有界、原子 nofollow、原子 CAS 和文件快照不能凭接口宣称。

远端能力按实施方案 D13 保持现有 SSH/SFTP 和原生工具要求，不部署新增 helper 或特权/文件系统配额。路径检查与发布间的同权限并发替换窗口、解压期间无总磁盘硬配额均为明确接受的能力限制；64 GiB 是声明/事后展开量的应用预算。保留私有 snapshot/stage、成员拒绝、逐项复查、结果确认及清理失败追踪，不将这些机制描述为强隔离或实时磁盘限额。

原 Python 版 `dir_fd`/`O_NOFOLLOW` 解压审查为历史记录，不构成原生 CLI 安全保证。当前原生工具排除全部归档内链接，安全相对 symlink 和指向归档普通文件的 TAR hardlink 在独立步骤恢复；device/特权节点和危险链接拒绝；通过私有 staging + SFTP 类型检查限制已知攻击面，但最终目标目录替换仍存在竞态；取消或断线后只在能确认远端命令结束时尝试清理 staging，不能宣称所有资源已原子清理。原生命令退出 marker/进度解析、POSIX/DOS 属性、ZIP 加密及目录合并需 B10 验证。旧正式实现本来不支持 AES；Python 迁移中间方案不是旧功能基线。Model SSH stdout 按行白名单解析，stderr 独立 drain 且不回显。Service upload/copy/move/archive 仍统一阻止活跃 taskId 冲突、复查异步身份与任务实例。

Files Service 区分直接借用 Workspace 与独立传输：direct 操作取消沿原资源退役，dedicated_transfer 只收尾独立 SSH/SFTP，健康 Workspace 续闲置期限；显式关闭仍中止全部关联任务。任务 finished/cleanupFailure 是 Service 单文件私有状态，打开阶段、任务正文临时项清理与关闭阶段的具名清理失败均追踪并保留任务标识及配额；copy/归档整项 unknown 转换不抹除清理失败类别，Workspace 关闭尽力完成其余清理再聚合失败，不提前归还预约。prepare 在串行准入内计数，登记前复查取消及具体 owner；start 始终重新检查真实父目录，部分 mkdir 后失败保留 unknown。派生路径按 Shared 传输预算检查，不将该预算施加到旧 Workspace 基础路径。WS callback 绑定具体 attachment，接口只投影安全 operation_unknown，不暴露 cleanup cause。

file-copy 由 Service 在首次副作用前预检整批目标与源的重叠。同 target/fingerprint 用源父目录 realpath 保留叶节点链接语义，目标的缺失后缀基于现有祖先解析，不为预检创建目录；检测相等/祖先/后代及规范位置的嵌套源。原始同路径 move 仍 no-op，别名解析与 metadata 只是变化检测，不是远端原子隔离。move 删除目录后的复查豁免自身删除引起的 mtime/size 变化，但 mode 仍须一致。ZIP 技术 Adapter 在 append 同步拒绝时同样停止并等待 reader finished，保证其拒绝被观察且原 producer/consumer 因果保留。

Files Service 统一维护每 Workspace 16 个 prepare/upload/copy-move/archive 活跃名额，排队与清理失败任务计入总数；同步检查后立即登记，prepare 收尾释放名额，已完成 allowlist 独立缓存。FileArchiveModel 将 NativeArchiveFailure.cleanup_failed 显式转换为模块具名清理失败，不以普通 unknown 抹除生命周期事实。

Files 操作在准入后、串行排队前登记 active/inFlight，关闭和 quiesce 覆盖排队与执行，追踪到 finally 退订和解锁完成。尚未执行的排队请求取消不退役健康 Workspace，也不提前解除前序门禁；入场认证等待归既有 authorizing owner。跨 Workspace copy/move 的私有任务记录双端归属，任一端关闭取消任务，双端关闭都汇总关联清理失败；控制协议、任务 ID 和授权仍归原目标端。

Files 内部 FileDownloadSink<TPlan> 由 files/model/file-types 唯一定义，表达 plan/write/finish 应用能力。HTTP 构造 sink 并持有 response/drain/finished；Service 将 finish 放在原操作期限和 inFlight 内，交付前复查当前身份/owner/指纹，交付后原 run 再确认当前权威状态，ticket 只在完整操作成功后续期并随后释放 claim。不以 Service 字节迭代结束代替响应收尾。票据登记在读取及最终授权成功后，登记前再次同步核对具体 owner/取消；HTTP ticket 响应按 Shared 白名单投影，inline 20 MiB 硬预算只引用 Shared，技术对象不穿透应用 sink。

下载票据只保存原会话摘要及原 FileResource ID，重新打开相同 Workspace 不复用旧票据；claim 对外不暴露私有 digest Buffer/可变 lease。上传 byte channel 取得实例绑定的 append/abort 能力：append 持续认证，断开清理可在会话撤销后执行。SFTP scan 的 finally 覆盖 break/return；ZIP 消费者拒绝或取消时停止并等待生产者/读者收尾。供应商 stdout 使用增量严格 UTF-8 解码，不按 SSH packet 独立转字符串。

Remote Files 的流 attachment 绑定具体任务实例；prepare 配额由资源串行 mutation 边界判断。下载票据分别维护有效期准入与在途 claim 生命周期，过期不再接纳新请求，在途读取不因清扫被破坏。跨目标 move 的源变化检查与目录 ZIP 的持续身份复查归 Service；ZIP Adapter 只负责生产、消费和清理收敛，多项失败保留因果。源 metadata 检查不提供原子快照或条件删除保证。

归档解压的目录、普通文件和链接统一逐项发布，不以整树 rename 绕过子项复查；stage 根及中间目录的类型/规范路径检查归 Service，不能冒充原子 nofollow。新建目录集合仅是局部属性恢复状态，已有隐式目录不被重写。原生列表 EXIT 清理由 Adapter 确认，具名 cleanup_failed 经 Model 转安全 unknown，原操作与清理因果只留内部。HTTP 下载 Interface 持有覆盖最终 flush 的完整传输期限与取消监听；Service 的写入执行在 mutation 队列后重新核对身份、owner 与指纹。

## 8. 当前能力与验收

B10正在逐链验收。首批覆盖实际HTTP认证/状态、有限Run/脚本Provider、SQLite失败、同实例备份；第二批覆盖本机OpenSSH/internal-sftp/PTY、原生三格式归档及部分传输；第三批验证普通续接双阶段确认、挂起恢复/接管与注销后重新登录续接；第四批验证 TOTP、受信代理来源 HTTP/WS、CAPTCHA 受控响应与 Chromium 虚拟认证器 Passkey。后续批次已推进 Agent 工具/集成、Docker、跨实例备份、通知/外观/插件及真实 RDP/VNC；具体通过子集与未验范围唯一归 testing，不把下列源码范围或单条通过解释为模块整体验收。续接/挂起及因素的容量/期限/竞态、桌面剩余故障、插件 SDK/intents 与备份未知提交/崩溃恢复等仍待验。

B6.2B 当前落地持久账本、审批绑定、原子消费基础设施及安全工具只读审计。安全单项/事件审计 HTTP 与 Shared 后端链已接线；目录、诊断及文件只读工具的可信 ToolInspection、只读许可和持久结果反馈已接线；file_write 审批等待/消费与写入反馈已接线；文件/Shell/Docker 突变与当前 Run 后台 Job 已接线，ACP waiter及安全审批HTTP/工具事件观察已接线，直接 Child/协作已接线，项目上下文和跨Run突变占用已在B6.2E接线；外围工具及blocked恢复已由B8/B9接线，正式前端F1仍未完成；源码收口不代表模型执行已解冻。静态与源码证据见当前方案/testing，所有行为留 B10。

### B5.2 范围与延期

B5.2 可独立完成的源码链路已具备：持久状态/步骤/事务、初始表结构、取消/恢复、通用双协议模型流、Model 转换、唯一执行 owner/准入/停机及只读审计消费者。当前执行由 B6/B7 已接入的 governed 政策、可信授权、冻结上下文与全族预算约束，默认 enabled=false；启用执行不授予工具权限。不把运行骨架或静态通过当作行为验收。

静态门禁与四表归 testing 最新复审；网络、迁移、资源、并发等全部行为仍待 B10。正式前端、输出交付与 F-R14/F1 留后端完成后；当前施工以实施方案为准。

### Provider 验收边界

源码与静态证据见 testing 最新复审；行为全部留 B10。`/__agent-next` 已消费模型候选与必填 model 及步骤审计；正式前端已消费 Shared，旧 Backend 已删除；统一 E2E 仍待验收。Run 执行 owner 已接入 B6/B7 的授权、上下文与预算；默认执行关闭，pending 或静态通过不证明 Agent 行为验收完成。

### B4.2 源码与验收边界

B4.2 因素/Passkey 主链、初始表结构、Shared/HTTP、登录联合与 Platform Adapter 已落源码，旧Backend从Git历史追溯；正式Frontend的密码/TOTP/Passkey登录、改密/因素管理与CAPTCHA/IP安全配置已由F1接Shared；完整设置与其他业务消费者仍待迁移。本轮安装依赖并修复真实静态失败，Shared/Backend-next/Frontend、根检查与格式门禁实际通过；四表、命令证据与未验场景归 testing。静态通过不能视为行为验收完成。核心持久 Settings 与 Operations 审计/通知已接线；外围集成配置已由 B8 接线，正式前端留 F1；实际 TOTP 客户端、RP、challenge 并发、回滚/断连、库升级均留 B10。初始表结构包含凭据 generation、匿名挑战来源约束与全局改密修订，最终签发事务复验 generation/counter/挑战修订；静态与行为门禁均不得用设计声明替代。

### B4.1 Access 验收界限

B4.1 已建立上述源码及安装配置入口，并完成 Review 纠正（入场例外、身份和时间边界、断连令牌、供应商 hostname、既有测试源码契约），当前静态结果归 testing，后续修改需按实际工作区重跑。B7.1 核心持久 Settings 已接通并在重启生效；个人偏好、Agent 执行设置与 Operations 审计/通知已有各自 owner，外观/集成/备份已由 B8 接线；B4.2 TOTP/Passkey 挑战已在新 Access 收口，密码登录对已启用因素仍拒绝降级，源码/静态已收口，仍待 B10 行为验收。全套 HTTP/WS、真实代理、受控验证码供应商、封禁并发、撤销后的长任务收敛和实机浏览器行为统一留 B10；正式 Frontend 仍消费旧 Protocol，按 F1 登记差异，不能宣称已切换。

### B3.2 施工范围

资源状态、Docker 和后台采样已接线，完整静态结果见实施方案/testing；正式前端 Shared 对接延至 F1，行为检查留 B10。当前施工状态与真实静态证据归实施方案/testing，不能把本段设计视为功能已通过。

### B3.1 设计与验收边界

本设计建立于原 `workspace.service`、`workspace-terminal.service`、shell integration、suspend coordinator/registry、ssh-suspend HTTP、log/xterm Adapter、现有 Files WS/transfer 与前端 WorkspaceSocket 实际消费者盘点；B3.1 源码及四表已收口，行为待 B10；Shared/backend-next check/build、Frontend build、根 check、格式和 diff 静态门禁须对应最终工作区重新运行。逻辑/故障/E2E 保留 B10，浏览器协议/反馈迁移与静态消费者差异进入 F1。

Workspace 的当前源码由唯一 sessions Service 持有：64 项准入覆盖 opening、detached、resuming、closing 和 cleanup_unknown；普通恢复使用同一 SSH shell、8 MiB journal、120 秒宽限及显式 workspace.resumeAck。新建回执的terminalOffset为初始journal端点、replayedBytes为本次保留回放字节，前端由两者定位收到字节的起点；普通恢复的terminalOffset为回放终点，replayedBytes必须与请求offset对应。lastConnectedAt为Unix秒。终端累计消费归 WS attachment，未确认窗口 1 MiB；消费 ACK 与恢复所有权 ACK 分开，回放和普通输出均服从窗口。非法消费不推进计数，越界 journal offset 在创建 pending attachment 前拒绝；断开释放原消费者暂停，由原 Workspace 继续保留输出。独立 Remote HTTP/PTY 使用自己的技术 SessionService，复用 machines Model/Platform，不暴露用户 Workspace 的活跃 shell 或权限。

挂起标记、prepare/commit/unmark、lease/takeover、pending 恢复与历史由同一 Workspace 实例拥有；只为新 ID 临时登记别名，不另建 SSH shell。历史/checkpoint 经 History Model 转换到 Platform Port/Adapter，Shared 只传安全管理对象、请求及事件。suspend.resumeAck 与普通 ACK 独立，baseline 已发送不代表 ownership 已提交；准备/ACK 超时、WS 关闭和接管回滚原 owner，晚字节有界保留。

目录协作由 Shell Service 持有排队、替换、期限与事件；有限失败基础值归Shared remote/terminal/values，内部事件对象仍归sessions/model，WS逐字段投影。Shell Model转换应用能力，Native Shell Adapter构造Bash/Zsh命令、解析PID/提示符和字节输出。每实例随机marker避免普通stdout充当prompt；未完成探测而已接收用户输入时安全拒绝迟到注入。普通Workspace响应与protocol.error使用Shared有限安全码，准入满额为limit_exceeded。真实Bash目录切换/回读及普通续接已有F1专项；其他登录脚本、Zsh及并发提示符组合仍分别待验。

日志由技术 Adapter 串行 append/read/compact/delete，绝对 offset 不随 100 MiB 可见窗口裁剪回退；checkpoint 和 renderer 的技术资源通过 Model 隐藏。日志导出在 Service 对每个最多 64 KiB 的块复查身份和实例，技术分块归 renderer Adapter；取消与清理失败分别判断，不能把 allSettled 的完成当作释放成功。历史前页交付成功并复查原 cursor 后才推进。HTTP/WS 管理视图共用 suspend-view 白名单；当前身份、attachment/generation 和 45 秒租约在异步边界复查，2 秒 sweep 不代替实时授权。关闭、背压、导出和失败边界见第 7 节与下述当前范围。

B3.1 源码收口不等于行为验收。实际类型、构建和格式结论以 [B3.1 收口证据](../testing/后端重构待实机验证.md#b31-源码阶段最终收口) 为准；B10 已验证本机 OpenSSH 的普通续接双阶段确认、普通终端消费窗口/暂停后断线回放、journal裁剪/offset拒绝、挂起 ACK/主动接管及 Files 正常链；挂起准备、消费暂停和日志积压分别持有阻断条件，取消挂起标记经WorkspaceService原resumeIfUnblocked计算是否可恢复，不能直接解除独立背压。慢日志 detach、prepared断开、自然租约到期、准备超时、历史帧失败/reset、日志文件系统拒绝向PTY收尾及导出授权/名额/断连已有有限证据；慢日志 rollback、空间耗尽、其余 Shell/VT 与清理故障仍待验证，精确范围归 testing。正式前端普通/挂起独立ACK及Shared挂起契约已接线；标记标签关闭仅脱离传输，明确取消标记后关闭才请求终止Workspace，受控与真实专项范围见testing，完整 Access/IP/2FA 源码已收口、行为待 B10。

Access/Targets/Remote 与 Agent 的计划后端功能源码及 B9 逐文件审核已收口，当前职责见职责表；行为验收仍待 B10。Remote Files 已同时具备 B1 新 HTTP 读写能力及 R1 旧 Workspace Files 子协议源码：编码写入/独占新建、list/search/stat、binary read/cancel、递归/force 批量删除、rename/chmod/realpath、ready/error 均有真实调用链；A-04 machines owner、SFTP 技术失败边界及 Files Service/Model 职责已收口。R1 行为验证未运行，真实 SSH/SFTP、故障窗口和旧消费者全链路仍待 B10。

R2-01–R2-05 的源码缺口已修补：背压/final 纳入同一操作截止时间，心跳按实际资源 owner 验证并续期，Workspace 64 与独立 Files 8 的预算分别计数；WS authorize 的身份查询异常沿技术握手返回服务不可用而非伪装未登录；PTY 定时/EOF 身份查询异常与正常拒绝分开，所有 unsubscribe 与 release 失败聚合进入原关闭追踪。以上仅是源码/静态完成，B10 的长背压、撤销、故障及容量行为尚未执行，不能标为已验收。

B2 下载/上传/copy/move/目录 ZIP、原生归档、密码与进度、属性及链接恢复的源码已收口；D12/D13 的部署取舍已确定，B2-V01–V66 全部待 B10 行为验证。Files 子协议不等于完整 Workspace 已迁移：完整 reconnect/resume、Terminal/挂起恢复的 B3.1 源码已收口、行为待 B10；status/docker 的 B3.2 源码已收口、行为待 B10；RDP/VNC 的 B3.3 源码复审已矫正，本轮最终静态通过，行为待 B10；完整 Access/IP/2FA 源码已收口、行为待 B10。按明确决定，旧 writer 的隐式 metadata 失败容错不在后端保留，正式编辑器的显式失败处理转 F1。Agent Shared、六个 HTTP 与开发前端源码消费者已接入；真实浏览器与故障行为仍待验收，不能因静态通过就声称正式通信迁移完成。

**B3.3 RDP/VNC 新后端源码**：`remote/desktop/service/desktop-service.ts` 持有单次短期 ticket、pending/opening/active 限额与当前 Access/Targets 版本、周期复核及精确关闭实例；`remote/desktop/model` 显式转换 Targets 的可信配置/解密快照与 Platform 技术请求。Targets 的 Desktop resolver 在同一 SQLite 只读事务获取连接/密码密文，Targets Model 持有 `SecretBox` 技术解密与应用转换；初始 Connections 表包含 recent attempt 时间字段，版本不随单纯连接尝试变化；RDP/VNC 的 `credentials.set` 允许密码但拒绝 SSH key。Guacamole 技术 Port/Adapter 独占 guacamole-lite 1.2.0 与 guacd：独立 raw WS 仍由统一 Platform HTTP origin/upgrade owner 接入，内部 AES token 仅含一次 bridge ID，真实密码和远端参数只在适配器私有映射内。`POST /api/v1/connections/:id/{rdp,vnc}-session`、`WS /ws/remote-desktop` 和 Shared `remote/desktop` 均已接线；双端正式消费者仍留 F-R12。B3.3 功能/类型/生命周期详细八节见 [远程桌面专题](REMOTE_DESKTOP.md)，源码/静态进度和 B10 未验证单列实施方案与 testing，不以接线作为验收。

产品行为与容量以 [USAGE](../USAGE.md) 为准，当前工作见 [实施方案](../后端重构下一阶段实施方案.md)，未执行真实专项见 [待实机验证](../testing/后端重构待实机验证.md)。新后端独立 check/build，Shared 与实际双端消费者同步检查；架构审核按模块模板和工程经验执行，静态通过不能证明真实 SSH、并发、清理与浏览器验收完成。

B3.3 实施复核已修正实际注入接口：`registerRemote.targets` 精确包含 `desktopTargets`，Desktop Failure 位于同一子功能独立错误 owner；DesktopTargetService只接收无密文的应用快照并判断direct准入；Model在同一次读取的私有密文上解密，不将密文放入应用类型或交由Service回传。Targets 密码凭据内部命名统一为 ConnectionCredential（password 用于 SSH/RDP/VNC，SSH key 仅允许 SSH）。Desktop Service 只消费 Model 创建的 DesktopPeer，WS/HTTP/Port 句柄不越过 Model；Targets 内部 ResolvedDesktopTarget 与 public TrustedDesktopTarget 分别定义并经 public-mappers 白名单转换。Guacamole 原始设置有明确的媒体与 DPI 默认值，第三方自带 SIGTERM/SIGINT 回调撤除，由 Bootstrap 和 Remote Service 统一决定收口；Guacamole Server 的 `close` 不等于底层 guacd TCP `close`，技术 Adapter 在真实 socket close 才通知 Service 可计为终态。共享 vendor 事件用固定监听与原 WS 实例索引分发，避免每连接叠加全局监听；guacd ready 不证明远端认证或画面就绪，B10 另核对真实图像、输入和上游 TCP 释放。Platform HTTP raw WS 在技术 unknown 时不无条件删除 active socket，完整关闭仍保留故障因果。此前 store lock 阻断属于历史环境；本轮按 frozen lockfile 离线安装成功，当前实际静态证据归 testing，不沿用旧 PASS。

当前实施顺序为完成全部保留后端功能及后端最终环境验收，再启动前端对接。后端 HTTP/WS 通过 Shared 与实际协议消费者核对，行为回归按实施决定统一留 B10；已有 DEV 前端未验收，不作为后端功能完整或正式迁移完成的证明。

B3.1 当前关闭/导出边界：Workspace Service 跟踪导出准入、60 秒完整期限、交付 sink 及实例关联取消；HTTP Interface 持有 response/pipeline，History Model 暴露应用字节源与可等待释放，Platform 只提供技术流/VT 操作。全 Remote 导出最多 2 项，清理失败保留名额。checkpoint dispose 返回共享 Promise，参与关闭确认；临时日志删除及渲染释放的具名技术失败经 Model 转为模块清理失败，HTTP/WS 都输出 operation_unknown。模块各独立 owner 并发关闭，30 秒确认截止不代表真实任务结束，晚任务继续观察；应用整体验收仍待 B10。

## B6.1 授权与审批基础（按照模块模板八节，静态/行为结论见 testing）

### 1. 职责与范围

Agent 模块的 `governance` 持有每个 user/App 的 capability grant、执行预算覆盖项与审批持久状态。它不是普通 SSH 的权限授予器；普通 SSH 仍由 Access/Targets/Remote 各自独立鉴权与管理活跃连接。授权事实仅说明 Agent 某一 capability 在指定 App/目标范围内的授予情况，**不能代替**执行时 Targets 当前身份、Tool Inspection、App 生命周期及 Run 策略检查。执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 本版没有执行模型或行为测试。

### 2. 子功能与目录

- `agent/governance/service/governance-service.ts`：用户/App 输入校验、能力定义与政策、审批构造/幂等意图哈希、关闭准入与自身在途任务等待；无无主 timer。纯政策在 `governance-rules.ts`：授权范围交集判断、grant 校验、执行预算默认/硬上限、审批过期/版本判断。
- `governance/model/governance-model.ts`：应用 Grant/政策事实/Approval 与 storage command/record 的显式转换；适配同步应用回调及技术失败；`model/governance-types.ts` 独占内部授权事实与审批命令。
- `governance/storage/governance-storage.ts`：狭窄持久记录与同步回调接口，不携带 Shared DTO。
- `governance/adapters/sqlite/{governance-schema,governance-row,governance-sql}.ts`：初始化 DDL、严谨行/持久 JSON 解码、SQLite 事务、CAS、失效与审批决议。技术操作、SQL/事务不外泄至 Service。
- `agent/interfaces/http/governance-http.ts`：安装真实 HTTP 路由与参数白名单、登录验证、Model→安全 wire 投影。未发现独立的旧审批命令 WS；旧通知是从持久 Run `approval.requested` 事件投影到 Notifications，不在本批虚构新的审批 WS 指令/通知通道。

### 3. 依赖方向

`registerAgent` 装配同模块 `GovernanceService → GovernanceModel → GovernanceStorage ← SQLite Adapter`；Adapter 只依赖通用 Platform SQL、storage 契约与 Shared 基础有限取值。Service 只消费 Model 暴露的应用对象；同步事务政策回调由 Service 提供，Model 将 Storage 事实转换后调用，再将创建任务投影回 Storage；Model 不选默认政策或构造虚假的初始 revision。跨模块 Access 仅通过 `AccessPublicApi.authenticate`；普通 SSH 通过 Targets 自身授权；没有跨模块深层引用、全局 dispatcher 或 Platform 定义的 grant/approval 类型。后续 B6.2 必须通过 Targets public 重新解析当前目标，禁止利用普通 Workspace 既有会话冒名授权。

### 4. 类型与转换

| 边界         | 类型唯一 owner                                           | 转换与实际消费                                                                                                                                                                  |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 协议→请求    | Shared `agent/governance/{values,model,http,http-codec}` | HTTP 严格读 UUID/原始类型、完整 grant/审批/执行政策字段与具名 path/header/response；Interface 将 scope 转 Model 输入，不收客户端身份或授权布尔                                  |
| DB→应用      | governance/storage、Model types                          | SQLite Adapter 校验 schemaVersion/JSON/行的有限值及状态/期限/决议/消耗关联；Model 转换 GrantScope、政策覆盖、Approval；实际 grant replace、request/resolve 回调在同一事务内消费 |
| 应用→协议    | Model / Shared model                                     | governance HTTP 白名单映射；只输出 tool 摘要、hash/版本，不输出 SQL 行、凭据/冻结输入；正式前端仍消费旧 Protocol（F1）                                                          |
| App 当前授权 | governance/model 的 `AuthorizationFact`                  | 包含 user/App/capability/connectionId/revision；不复用客户端 DTO，批准不自动授权派发                                                                                            |
| 技术资源     | Platform SQL Executor/SqliteRuntime                      | Adapter 执行事务及行解码；Policy 不由 Platform 拥有                                                                                                                             |

目标 grant 的 ssh IDs 在 Shared 协议中是长度受限文本，应用判断时严格要求规范化的正安全整数目标 ID；执行政策秒/字节/条数沿原始类型进行验证，不将 `String(value)` 后的相同文字当成有效 enum。grant 目标 ID 最多 256、单个最多 128 UTF-8 bytes，capability 取值以 Shared governance/values 唯一列表为准；审批 TTL 600 秒；grant 请求上限 512 KiB，普通 governance JSON 16 KiB，完整结果上限 8 MiB；审批 list 至多 1024 条完整记录，超额为安全的 `limit_exceeded` 而非截断（分页消费者仍未实现）；容量按完整 JSON 编码计算。

### 5. 入口与安装

`modules/agent/register.ts` 在 Agent request owner 中装配 governance；`bootstrap/schema.ts` 在唯一 v1 初始化项中安装治理表。已接线的管理员 HTTP 为 GET/PUT `/api/v1/agent/apps/:appId/grants`、GET/PUT `/api/v1/agent/apps/:appId/execution-policy`、GET `/api/v1/apps/:appId/approvals/:approvalId`、POST `.../resolve`、GET `/api/v1/apps/:appId/runs/:runId/approvals`。共享认证、CSRF/Origin 控制由新 Platform/Access 负责；治理入口使用实际 session userId=1，结果交付前再次认证。没有创建审批的客户端 HTTP 入口：审批生产者必须是 B6.2 的受信 Tool/ACP 过程而非客户端请求。

### 6. 数据、事务与并发

第一版创建 `agent_governance_policies`、`agent_governance_grants`、`agent_governance_approvals`、`agent_governance_resolution_keys`，引用 Agent App/Run 身份。首次 GET 不会自动批准任何 capability：revision/version 为 0、grant 空、政策 override 空。grant PUT 在同一个 SQLite 事务中查 App、读当前 policy、调用 Model 转换后的同步纯规则、CAS revision、替换所有 grant、失效 requested 审批并读取最终结果。执行政策 PUT CAS executionVersion 并推进 policyRevision/使旧待批失效；同事务读取全局 execution settings；覆盖项不能超过动态 hard limits，effective 与实际冻结使用同一执行规则。

审批请求的窄内部命令写入时读取真实 ToolCall、当前 Run 状态及 App grant，并从操作账本冻结 operationHash、policyRevision、operationRevision 对应的 inputRevision 与 TTL；Model 必须消费经 Adapter 读取的 Storage 快照，未经认证客户端不能创建。resolve 在同一事务读原审批、Run 当前 status、ToolCall 内容修订/状态及目标版本、App 当前 policyRevision 和幂等键；同步规则拒绝 stale/expiry/版本/哈希漂移；时钟在实际事务执行时读取，决议校验与 decidedAt 共用一个时刻；成功 CAS 到 approved/denied 并保存 feedback、首次事务结果快照。同键/同输入重放原始已提交结果，不从随后变化的审批行重建，不同输入返回冲突；无网络派发，不能把批准视为副作用已经执行。审批 list 先以有界数量检查总量，再分批失效扫描和读取，避免先聚合无限记录后才检查字节上限。inputRevision 已绑定 ToolCall.operationRevision，与父 Run 生命周期版本分离；消费同事务提交 consumedAt、dispatched 状态和操作事件，file_write 的实际执行/派发后复查已接线，文件/Shell/Docker突变与当前Run后台Job已接线，ACP独立权限与协作已接线，不得默许跨内容版本批准。App/Run 删除由外键回收，不在 Adapter 内藏删除准入规则。

### 7. 生命周期与失败

Governance Service 与 AgentRequestOwner 双层跟踪自身请求；停止新准入、`closePromise` 先保存，等待 in-flight 事务/请求终态，Governance 最多保留 32 个原始持久/关闭失败及额外失败计数，不使单项清理跳过其他子资源。审批 TTL 不启动无 owner 的 interval：get/list/resolve 同事务按数据库条件把到期 requested 转 expired，把已终止 Run 的 requested 转 superseded。grant 撤回/执行政策修改同事务令待批 superseded，取消 Run 持久终态后执行失效，并通过后续读取 sweep 恢复；取消已经提交后失效失败返回 operation_unknown，不能假称取消已回滚；commit_unknown 不得默认重放写入。继承取消清理只在 quiesce 后、子 owner close 开始前准入；close 开始后拒绝全部新任务。原 owner 在任务退出前记录存储/未知/内部故障，不因它们已映射为 AgentFailure 就忽略；父层聚合去除同一失败的重复引用。持久 approved/denied 的产生只是审批状态提交，B6.2 在真正执行前必须重新确认当前 grants、Run、ToolCall、目标/租约及消耗状态。停机后已经派发的远端任务不得因本批 `close` 即宣称终止。

### 8. 当前能力与验收

B6.1 的 Shared、SQLite 与 HTTP 请求/查询/变更/决议路径有源码；审批请求生产者、ACP活waiter与文件/Shell/Docker/ACP消费者已接线；安全观察采用审批HTTP/工具事件页，直接 Child/协作已接线，B7动态settings/预算已接入；外围资源B8与持久证据恢复B9已接线，行为仍待B10。旧代码实际包含 App enable/manifest/默认 grant 和详细 ToolInspection；新 App 由受信内置声明创建，默认 grant 空（fail closed）；插件manifest/运行时已由B8接线，差异登记 F1，不补虚假兼容桥。行为、真实取消/并发、SQLite 迁移与实机权限试验按 D2 登记 B10，静态命令结果限 testing 当前批次，不复用 B5.2 PASS。

## B6.2A App 声明与目标政策

### 1. 职责与范围

Scope 拥有受信声明目录、UUID App 实例与启用状态；Governance 拥有 grants 和全局 Agent 目标拒绝政策；Runs 拥有持久取消围栏与实际执行资源。旧 bootstrap 未注册内置 App，插件声明来自安装版本；新内置 `nexus.terminal` 是明确新增的宿主声明，声明远程文件、命令及状态能力，默认 grant 为空，不代表这些能力已获授权或已接通 Agent 工具执行。插件包及运行时安装仍归 B8。

### 2. 子功能与目录

Scope 的 service 管理受信 definition、默认初始化与生命周期任务；model 转换实例、声明与 storage 任务；SQLite Adapter 安装声明与实例。Governance 的目标政策沿现有 service/model/storage/adapters 增加 denylist。Runs 的 Adapter 提供原事务取消任务；执行 owner 在提交后中止其实际持有的尝试。

### 3. 依赖方向

Service 消费应用事实；Model 转换 storage 契约和 Targets public 安全目标元数据；Adapter 不引用 Service、Model 或 Shared DTO。同数据库跨子功能写入使用各自 Adapter 的事务接口，不重复其 SQL。不借 Remote 活跃会话或普通 SSH 权限。

### 4. 类型与转换

声明来源 ID/version 是必填非空字段，与实例 UUID 分别表达；SQLite 外键绑定来源，Shared 解码拒绝缺失或 null，不保留旧无来源实例分支。Shared scope 定义双端实例、声明摘要和 CAS 请求；Governance 定义拒绝名单协议。内部对象仍归各子功能 model，存储对象仍归 storage；HTTP、public 与 Model 各自逐字段转换。能力有限值复用 governance/values；秘密、运行时句柄与默认 grant 初始化任务不进入 Shared。

### 5. 入口与安装

注册器只接收服务器内置声明，客户端仅选择已注册的 definitionId。GET Apps/单项、PATCH enabled+expectedVersion、GET definitions、GET/PUT target-denylist 安装在 Agent HTTP；POST Apps 使用默认受信声明。启动同步声明，但账号默认实例在 Apps 列表入口按已认证用户初始化，避免首次安装尚无账号时写入外键。

### 6. 数据、事务与并发

所有相关表直接纳入唯一 v1 初始化；初始结构变更同步更新签名，不匹配的开发库明确拒绝，不自动转换或删除。启动声明同步在独立安装事务完成；实例与初始政策/grants 同事务创建；存在实例不重写默认权限；实例缺失治理政策视为完整性失败，治理读取/写入/撤销均不补建记录或返回默认政策。

同版本声明以完整内容指纹核对，包括默认启用及默认 grants；内容变化必须推进声明版本，指纹不公开。声明更新、禁用及 denylist 变更在各自写事务内推进围栏、失效未决审批、取消旧活动 Run。治理写入/审批决议消费同事务最新声明、启用与目标政策。新实例必须绑定受信声明，不凭名字自动绑定。

目标管理先经 Targets public 获取事实，实际持久提交再核对引用和版本；审批也持久绑定目标版本。拒绝 ID 保留到显式撤销，不随目标删除自动丢失。目标集合变化才撤销旧 Run，修改原因不撤销或触发执行复查。denylist 存储与应用时间保留毫秒，HTTP 将 changedAt 转为 Unix 秒，取消围栏直接使用原毫秒。审批 capability 必填；targetVersion 的 null 仅表示真实无目标操作。全部 Agent Model 使用同一存储失败映射 owner，存储不可用、未知提交和内部失败仍由实际异步 owner 收口。

### 7. 生命周期与失败

当前内置声明仅有宿主持久状态，无插件初始化或资源 hook；enabled 只表示管理准入，executionState 为 governed，不制造 running/healthy。禁用/政策更新先提交取消围栏，再由 Run execution owner 中止具体尝试；未知提交也保守中止本地尝试，不宣称回滚或远端停止。实例/声明状态无需异步健康回写，不存在晚 health 覆盖禁用。父 owner 关闭等待已准入请求后关闭治理及执行 owner。

### 8. 当前能力与验收

当前 B6.2A 源码按四表核验；静态证据归 testing，行为全部待 B10。Tool消费已在B6.2B接线；ACP消费已在B6.2C接线；动态预算已接入，插件运行时 B8、正式前端 F1；执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。。旧声明 ID 路径改为实例 UUID，Shared 正式前端迁移登记 F1。

## B6.2B 首个可信工具链

### 1. 职责与范围

首工具 machine_connection_list 提供已选中、当前授权且未被拒绝的 SSH 安全目录。RunExecutionOwner 拥有模型循环及在途任务；governance 拥有当前许可；tools 拥有服务器定义、输入校验和工具用例。旧协调器拆分不作为必须保留的设计；后续能力按实际价值重新设计，差异归实施方案 F1。

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
| 步骤/工具审计 → 公开    | Shared runs/tools                         | register 与 HTTP 独立投影 | DEV/F1         |

connectionIds 是必填的最多 50 个唯一正整数，空数组表示没有选中目标，选择不等于授权。modelStepIndex 公开；providerCallId、参数、结果正文及 encrypted reasoning 留内部。工具结果仅有 id/name/host/port/username，Targets 的 type/version 只用于内部过滤与复查，不读取凭据。

### 5. 入口与安装

Agent HTTP 的 AgentHttpInput 统一归 interfaces/http/agent-input.ts；Governance、Execution、Memory、Artifact、Integration、Browser 与 Plugin 共用输入失败转换。unknown JSON/Shared codec 拒绝先转应用 invalid_input，HTTP 保留400/413等原协议状态；Service、公开出口和Platform不引用该HTTP辅助类，原 mapper/Model 转换保持独立。

register 将 ToolModel/ToolService 注入唯一 RunExecutionOwner；目录工具参数严格空对象，诊断及文件工具使用有界字段声明，定义由服务器提供，不新增客户端检查或派发 HTTP。已有步骤审计支持 1–400，工具审计包含真实模型步骤。DEV 创建明确传 connectionIds:[]，正式选择器与多步 UI 留 F1。

### 6. 数据、事务与并发

一个 v1 直接安装 selection、步骤创建身份/proposals、工具 modelStepIndex/result；签名为 backend-next-v1-initial-20261013-tool-rounds，拒绝旧开发结构。调用身份绑定 Run/步骤/providerCallId，允许供应商跨步骤复用 ID。工具检查必须匹配已完成工具轮的持久 proposal；派发意图与当前只读许可同事务。完成事务复查政策 revision 和所有已读取目标的版本，结果与事件原子提交；完成后交付前再复核。读取与结果提交不是整个目录的强原子快照，不保证新增/未读取对象的快照一致性。

### 7. 生命周期与失败

工具轮正常 EOF 与资源清理完成后只终结模型步骤；持久工具结果按 call ID 回送下一模型步骤，最终 stop 才成功结束 Root。下一步骤本地拒绝、取消或历史超限收口 Root；提交未知不猜测写入结果、不二次提交或重放。恢复检查历史步骤、活跃步骤、创建 hash 与工具账本，运行空档保守 unknown。Root owner 等待整个模型/工具过程，清理失败仍占资源名额并保留因果。只读许可不伪造审批，撤权再授予改变 revision，旧结果无法交付。

### 8. 当前能力与验收

目录首链及后续有目标只读源码已接通，两轮复审与最终静态结果归 testing。预算/上下文和 ACP 已接线；执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 实际运行尚待 B10。400 步是审计容量而非执行授权；私有历史上限 8 MiB/1024 条、参数 16 KiB、结果 256 KiB。Platform 独立约束 32 调用、参数 128 KiB、网络/请求 8 MiB、正文 2 MiB、reasoning 1 MiB。Chat 支持首片完整身份及后续参数增量，拒绝身份冲突；不承诺所有供应商碎片变体。Responses 续接保留加密 reasoning，不静默丢弃。USAGE 对应 Agent 新后端章节，全部行为留 B10。

## B6.2B 有目标只读能力

### 1. 职责与范围

Agent tools拥有模型工具定义、严格输入、当前授权及持久反馈；Remote提供独立短任务的远端诊断和文件读取/列表/字面量内容搜索。不借普通Workspace会话、用户令牌或附件。旧diagnostics混合目标身份与宿主数据，新v2明确远端指标（generatedAt毫秒、CPU百分比、内存/磁盘bytes、1/5/15分钟load），同一采样key双采样取得CPU差值并在finally清理状态，宿主诊断已归System diagnostics并由ToolModel转换消费；旧任意正则搜索改为字面量，差异归F1。

### 2. 子功能与目录

tools/model/tool-types持有声明字段、输入联合、目标及读取scope；service/tool-input从unknown严格解码；RunModelStream转换声明字段为Platform有限schema。Remote machines/model/operation-types持有读取应用事实，machines/service/operation-service拥有所有独立短任务；files/service/file-inspection持有路径、UTF-8读/目录/内容搜索政策，复用FileModel和ObservationModel。不新建SQL表或迁移版本。

### 3. 依赖方向

Agent ToolService→ToolModel→Targets public/TrustedSshTargetResolver与Remote public RemoteMachineOperations。Remote operation-mapper转换public与内部应用；RemoteMachineOperationService→Files/Monitoring Model→共用Platform。Bootstrap只装配正式register/public，Platform不引业务类型，Agent不深引用Remote私有实现。

### 4. 类型与转换

| 边界                  | 类型owner                                                                   | 转换owner                         | 实际消费者                              |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------- | --------------------------------------- |
| 模型JSON→用例         | tools Model ToolInput                                                       | tool-input严格字段/整数/UTF-8解码 | ToolService                             |
| 应用声明→技术schema   | ToolInputField / Platform ModelToolProperty                                 | RunModelStream                    | Chat/Responses Adapter                  |
| Agent→Remote请求/结果 | ToolOperationScope / RemoteMachineOperations public / MachineOperationScope | ToolModel、operation-mapper逐字段 | RemoteMachineOperationService与Tool反馈 |
| 技术读取→应用事实     | SSH/SFTP/status技术 / FileInfo/ObservationSample                            | File/Observation Model            | RemoteMachineOperationService           |
| 工具操作→存储         | runs/governance应用 / storage                                               | 对应Model                         | tool-authority-sql                      |

工具输入/输出是模型私有契约，当前没有双端HTTP消费者，不在Shared虚构对象；真实已有安全审计继续消费Shared。基础文件kind和安全错误值引用Shared，但各层对象独立。ToolReadFailure表达预期远端拒绝，存储、未知提交及清理失败保持收口证据。

### 5. 入口与安装

Remote register暴露operations，不新增HTTP路由；Agent register接入Targets resolver与RemoteMachineOperations，由唯一Root owner消费五个只读工具及受审批file_write。新增v2诊断只需connectionId；文件只需connectionId、绝对path，搜索另需query和可选maxResults。不沿用旧target/id或可空字段；正式前端差异归F-R18。

### 6. 数据、事务与并发

派发/复核/完成事务同时读持久selection与目标type/version；Service纯规则判定目标已选中及当前声明/grant/denylist。结果绑定目标必须出现在版本引用中。额外Agent Model fingerprint复查覆盖Proxy/Key/jump依赖变动，Remote建连使用expectedFingerprint并在实际网络开通前调用授权复查。数据库许可不能与远端读取组成原子事务；异步期间撤销阻止后续读取/交付，已开始的读取不能追溯撤回。唯一v1结构未改，本批不追加迁移。

### 7. 生命周期与失败

RemoteMachineOperationService统一8个名额和45秒整项期限，计入排队/实际读取/关闭及清理失败；Root等待整个工具Promise。停机停止准入、abort所有任务并等待实际收尾；清理失败占名额并汇总因果，安全出口仅带cleanup_failed。请求方治理/存储失败经Model保留原类别，不被Remote安全兜底误改成输入失败。读前/读后复查目标指纹、版本、政策和操作，最终政策检查在异步目标检查之后；结果持久再反馈，unknown不重试。

### 8. 当前能力与验收

只读v2源码已接线，执行须当前 governed 准入。文件UTF-8完整读取32KiB，拒绝非文本；目录200条/48KiB metadata，超额拒绝。搜索是区分大小写字面量，每行首匹配、1起算UTF-16列；maxResults默认20/最多100，发现额外匹配才truncated。遍历最多100文件/100目录/8层/2MiB，排队也有界；symlink不跟随，路径规范化/realpath/lstat复查不构成并发原子隔离。同大小/mtime并发变化可能无法检测，SHA-256只说明实际捕获内容。结果整体256KiB，超额拒绝；32KiB单文本留足JSON最坏转义预算，搜索集合另按整体编码复核。所有行为仍待B10，四表及静态证据归实施方案/testing。

## B6.2B 受审批的文件写入

### 1. 职责与范围

Agent tools 负责首个 file_write v2：明确目标 connectionId、绝对 path、UTF-8 content、expectedSha256（新建为 absent，替换为原内容 SHA-256）。路径最多 256 UTF-8 bytes，内容最多 8 KiB（允许空文本），完整参数仍受 16 KiB 编码预算。所有写入需要当前 file.write grant 与单次人工批准；不自动推导旧内容或继承读取许可。后续文件/Shell/Docker突变已接线，ACP与直接 Child/协作已接线，剩余能力见后续阶段。

### 2. 子功能与目录

复用 tools/service 的声明、解码及执行流程，governance 的审批请求/决议/消费，runs 的真实 proposal 和工具账本。Remote machines 的独立短任务 owner 扩展为 operations，统一读写准入和关闭；files/service 持有路径、覆盖及确认政策，FileModel/FileResource 转换 SFTP 能力。不新增平行协调器。

### 3. 依赖方向

Agent ToolModel 仅消费 Targets 与 Remote public。Remote Model 仅消费技术能力，Service 不借用户 Workspace/Files 附件。写入不引入 Agent 类型到 Remote/Platform，SQLite Adapter 不引入应用规则。

### 4. 类型与转换

| 边界           | 类型 owner                         | 转换 owner                         | 消费者                   |
| -------------- | ---------------------------------- | ---------------------------------- | ------------------------ |
| 模型参数→应用  | tools/model/tool-types             | tools/service/tool-input 严格解码  | ToolService              |
| 审批/工具→存储 | governance/model、storage 各自定义 | GovernanceModel                    | SQLite 同事务规则回调    |
| Agent→Remote   | Remote public 独立写命令/结果      | ToolModel、Remote operation mapper | Remote operation Service |
| 远端资源→应用  | files/model 与 machines/model      | FileModel/FileResource             | 文件写入政策             |

模型私有内容与 SHA 前提不进入 Shared；真正双端安全审批和审计继续使用已有 Shared。摘要只含动作、路径、字节数和内容哈希，不包含内容正文。

### 5. 入口与安装

模型工具 file_write 经持久真实 proposal 检查建立工具账本；ToolService 请求审批并等待已有 HTTP resolve。Bootstrap 注入 Remote operations；没有直接派发 HTTP 或前端正式入口。批准只是决议，消费成功提交才允许后续网络派发。

### 6. 数据、事务与并发

消费事务同时复查批准绑定、policyRevision、Run/frozen/provider、持久 selection 和目标 SSH/version，原子提交 consumedAt、工具 dispatched 与事件。后续 verify/complete 事务对突变核对已消费绑定许可，不能借只读 dispatch。取消/撤权/过期拒绝，批准不能用于第二次消费。写入使用同目录暂存；新建拒绝现有目标，替换必须匹配原哈希并保留普通权限。准备后再次校验内容前提及当前权限，最终提交后回读核对内容哈希。SFTP 的路径检查及哈希预检不构成跨调用原子 CAS；仍有并发替换窗口，不能承诺无覆盖竞争。

### 7. 生命周期与失败

审批轮询由 RunExecutionOwner 的工具调用持有，timer 跟随 AbortSignal 取消，不建立脱离 Root 的后台等待。每轮复查当前授权，批准后先复查目标再单次消费；停机关闭会取消等待。远端整项最多 45 秒，共用 8 个名额，清理失败仍占名额。临时写入开始即有副作用；准备、提交、回读、最终授权或释放失败不能冒充未写入。unknown 不重放，暂存 discard 和资源 close 都尝试，失败保留原因与未收敛证据；确认持久结果之后才反馈模型。

### 8. 当前能力与验收

本批 N11–N13 源码及两轮审核已完成，静态结果归 testing；所有行为待 B10，不运行测试。实际预算与来源均来自冻结输入，执行须 governed 准入。后续 N14–N16 已按新设计接通 patch/move/delete、Shell/后台 Job/Docker，前端差异归 F1。

## B6.2B 文件补丁、移动与删除

### 1. 职责与范围

N14 按 D15 重设计 file_patch/move/delete，复用已有逐操作人工审批。补丁为单文件、原 SHA-256 绑定的一次唯一字面量替换；不接受旧 unified diff，多个文件由独立工具调用表达，不提供远端事务。移动与删除可处理普通文件和目录，拒绝链接/特殊节点及根目录；必须提供 file_inspect 返回的有界快照 fingerprint。递归删除必须明确 scope:tree，scope:entry 仅文件或空目录。

### 2. 子功能与目录

Agent tools 的声明/严格输入/安全摘要和 ToolModel 扩展现有 owner。Remote files/service/file-snapshot 持有遍历预算与捕获快照；file-mutation 持有补丁/移动/删除的用例政策；file-write 复用暂存/确认机制。files/model 持有快照节点及计划，machines/model 持有独立短任务命令/结果，RemoteMachineOperationService 统一资源/期限/失败准入，不新建协调器。

### 3. 依赖方向

Agent→ToolModel→Remote public；Remote Service→文件应用能力→FileModel/Platform。所有新增命令/结果经过独立 public mapper，Model 不透传；路径/覆盖/递归政策不进入技术 Adapter，Service 不引用 SSH/SFTP 原始句柄。

### 4. 类型与转换

| 边界          | 唯一 owner                                           | 转换                                 | 消费者                    |
| ------------- | ---------------------------------------------------- | ------------------------------------ | ------------------------- |
| 模型参数→应用 | tools/model/tool-types                               | tool-input 从 unknown 严格解码       | ToolService               |
| Agent→Remote  | Remote public 与 machines/model/operation-types 独立 | ToolModel 与 operation-mapper 白名单 | 独立机器任务 owner        |
| 文件快照/计划 | files/model/file-types                               | 文件应用能力返回校验事实             | snapshot/mutation Service |
| 审批/账本     | 既有 governance/runs 应用及 storage                  | 原 Model/事务回调                    | 单次许可/持久反馈         |

模型参数、文件内容/计划及指纹无双端消费者，不放 Shared；审批/审计基础值继续引用已有 Shared。

### 5. 入口与安装

新增 file_inspect 只读能力供模型取得文件/树指纹；新增三个 v2 突变声明，服务端决定风险：patch/move 为 mutate，delete 为 destructive。file_inspect 要当前 file.read，突变分别要 file.write/file.delete；读取快照不授予写入。所有操作仍由真实模型 proposal→原账本→原治理消费者执行；无新 HTTP 或正式页面。

### 6. 数据、事务与并发

不改表结构/迁移。approval 绑定真实参数、摘要、内容修订和目标；操作前重捕获快照并核对 fingerprint，scope/tree 决定也绑定审批。移动拒绝既有目的地及源/目的祖先关系，成功后确认源消失/目的快照一致。删除先核对整树，再倒序逐节点核对并删除；目录确认无剩余节点，自身删除造成的目录 mtime 变化不作为外部冲突。检查不能提供 SFTP 跨调用原子隔离；外部并发替换/创建仍存在窗口，部分删除或最终确认失败为 unknown，不自动重放。

### 7. 生命周期与失败

复用8混合名额与45秒完整期限。快照最多100文件/100目录、深度8、单文件1MiB/累计2MiB、元数据256KiB，队列也计预算；每文件按预检长度读取，目录导航项在技术 Adapter 过滤，重复节点拒绝；不跟随链接，二进制文件可hash，不输出内容。patch 原文件/结果最多32KiB，oldText/newText各4KiB且完整JSON16KiB；唯一非空oldText可替换为空，零次/多次/相同替换拒绝。首次远端变更后任意节点拒绝、权限变化、取消、确认或释放失败不能报完整成功。原owner追踪全部资源/清理，未知无重放。

### 8. 当前能力与验收

file_inspect/patch/move/delete v2 已经沿真实工具提案、账本、审批/单次消费、Remote 独立资源与持久反馈接线；两轮源码复审覆盖预算、重复节点、元数据、部分执行及清理分支，静态证据见 testing。B10已核对真实七步文件变更、显式tree删除、哈希过期/重叠上下文/目的存在和链接拒绝；部分执行、竞争和断流仍待验，正式前端差异留F1，执行须 governed 准入。移除旧多文件diff协议并明确新逐文件操作，目录范围有界而不提供任意无界删除。

## B6.2B Shell、后台 Job 与 Docker 工具

### 1. 职责与范围

N15 同批实现 Shell 前台/后台、Job list/status/wait/cancel 和 Docker inspect/control。Shell 明确区分 argv 与 executable script，不用命令文本启发式判断安全；执行按 destructive 审批。Job 属于 user/App/Run/目标版本，不借普通 Workspace/sessionId，不跨 Run 接管。后台仅指模型可以继续下一轮，不是脱离 Root 的长期服务。Root 终结前取消并等待全部 Job；取消不证明远端子进程停止。

### 2. 子功能与目录

ToolService 持有声明/审批/派发及工具资源排空的失败汇总。全部子失败均属 ToolExecutionUnknown 时保留该类别（清理未确认保留 ToolCleanupFailure），由 RunExecutionOwner CAS 收口 unknown；混合存储/内部失败保留 AggregateError，不猜测后续状态写入。tools/service/tool-job-service 持有有限后台任务、轮询权限、等待与收尾，tools/model/tool-job-model 做独立存储转换，tools/storage 及 adapters/sqlite 持久身份/状态。Remote machines/model/command-model 转换应用命令、结果与 SSH 生命周期，platform/commands Adapter 持有 POSIX argv/cwd/script 语法。Docker 复用 ObservationModel 和 NativeDockerAdapter，OperationService 持有原状态前提及后验政策。

### 3. 依赖方向

Agent Service→ToolModel→Remote public→独立 OperationService→Command/Observation Model→Platform Adapter。Job Service→JobModel→Storage→SQLite Adapter；无平台业务类型，无 SQL 越层，无 Workspace 权限继承。

### 4. 类型与转换

工具参数与 Job 内部类型分别在 tools/model/*-types；Job storage 独立定义命令/记录及具名结果联合；持久JSON和状态/结果关联仅在SQLite Adapter解码，JobModel逐字段转换，前台/后台共用ToolModel.command的应用结果，不通过JSON往返协作。Remote public 命令/结果独立于 machines/model/operation-types，operation-mapper 与 ToolModel 白名单；Shell 技术类型只在 commands Port。新增 argv 数组 schema 经 RunModelStream 转成通用 ModelToolProperty，技术请求再次逐字段投影。只有后端/模型消费，不新增无人消费 Shared Job DTO；Docker action 复用已有 Shared 基础取值。

### 5. 入口与安装

新增 shell_execute v2、shell_job_control v2、machine_docker_inspect/control v2。执行与取消分别单次批准；状态/列表/等待只读且需当前 shell.execute；Docker 要 machine.docker.manage，remove 为 destructive。Job prepare 在原工具单次消费后持久 queued，原工具完成提交确认后才 launch，Job dispatched 提交确认后才发 SSH；数据库 unknown 不派发或自动重试。

### 6. 数据、事务与并发

更新唯一 v1 初始化：新增 agent_tool_jobs；id 绑定原工具记录，完整 scope/目标版本/命令身份独立持久化。queued/dispatched→completed/failed/unknown 使用 CAS；重启 queued 确认未派发为 failed，dispatched 为 unknown，不恢复技术句柄或自动重放。最多8后台槽、每Run最多64历史项；派发前预留终态结算的版本空间，启动恢复的批量递增先完整检查耗尽。Docker 必须传完整64hex ID与 inspect 指纹（id/state/image/created），控制前复核，控制后确认目标状态/不存在；跨调用外部竞争窗口明确保留。

### 7. 生命周期与失败

Shell argv≤128项、总8KiB，script≤8KiB，cwd≤256bytes，完整参数JSON≤16KiB；stdout/stderr合计32KiB有界捕获，明确truncated，完整结果可容纳最坏JSON转义。Remote 仍共用8任务/45秒整项期限，后台不突破原限制；等待最多30秒，等待超时不取消Job。每个后台任务、权限监测、timer/listener/Promise均有原owner；完整期限包含Job持久准备和等待启动，派发前再次核对剩余时间；每秒复查原批准/目标/当前权威，终态结算前先停止并等待权限监控收敛，失效取消后等真实收尾。根取消/结束/停机统一drain；清理失败保留配额和原因。Shell非零退出是已确认命令失败，SSH派发未知、取消、后验失败和清理失败不得报远端回滚。

### 8. 当前能力与验收

Shell 前台/后台、Job 四动作及 Docker inspect/control 源码同批接线，两轮源码复审完成。B10已用真实OpenSSH核对Shell转义/退出/截断、Job查询/等待/取消、撤权、目标版本及重启围栏/证据释放；Docker及其他故障专项仍待验，精确证据归testing，前端差异F1。执行须 governed 准入，不建立旧Thread/sessionId桥；ACP与直接 Root/Child/协作已在 B6.2C/D 接线，剩余租约/工具继续盘点。

## B6.2C ACP Runtime 与独立权限

### 1. 职责与范围

ACP通过独立SSH短任务执行远端程序，支持v1初始化、创建会话、prompt、文本更新、权限请求及取消/关闭。不借普通Workspace资源。D15下调用按明确argv/cwd/prompt设计，不保留integrationId/Workspace/profile兼容参数；旧集成配置管理仍归B8盘点，当前调用配置完整绑定本次批准。禁止远端ACP直接调用Nexus文件/terminal能力。

### 2. 子功能与目录

platform/acp持有通用协议、消息关联与有限流；commands Adapter持有argv命令构造；Remote machines/model/acp-model持有SSH生命周期及技术转换，OperationService持有准入。Agent tools/service/acp-permission-service持有独立权限等待/批准/消费/监测，runs journal持有子操作及父关系，真实SQL只在runs/governance Adapter。

### 3. 依赖方向

Agent ToolService→ToolModel→Remote public→OperationService→MachineAcpModel→Platform ACP/SSH。权限回调经上述边界白名单回到Agent Service→Governance/RunToolModel→Storage→SQLite；Platform不引入Agent业务类型。父批准只授权启动远端程序，子批准只授权其绑定的单次ACP请求。

### 4. 类型与转换

技术请求/许可/结果归platform/acp Port；Remote public与machines/model各自独立对象，operation-mapper逐字段转换；Agent内部输入/许可归tools/model，journal命令与存储各自唯一owner。用户审批读取和工具事件复用Shared现有安全契约，不公开rawInput、程序流或技术句柄。仅后端/模型消费的ACP参数不预留Shared DTO。

### 5. 入口与安装

新增acp_execute v2模型工具，connectionId/argv/cwd/prompt绑定本次人工destructive批准，需integration.acp.invoke。嵌套权限生产独立acp_inner_permission记录及acp_permission批准；权限观察和决定复用已安装审批HTTP、工具审计及事件页，不新建无消费者WS。技术协议拒绝direct fs/terminal和持久allow选项，只支持allow_once/reject_once。

### 6. 数据、事务与并发

唯一v1新增ACP权限父关系表。子操作仅能在真实dispatched ACP父工具下创建，绑定相同scope/步骤/目标及父内容哈希；事务复查当前父状态，不伪造模型proposal。所有父终态围栏、Root unknown/restart继续覆盖同一工具账本。批准请求/resolve/consume/verify均核对独立子身份及活父关系；数据库未知不派发、不补写、不重放。

### 7. 生命周期与失败

复用8混合名额/45秒整项期限；每父最多64受支持权限操作、逐请求当前权限复查，等待不得延长任务期限。argv最多128项/8KiB，cwd256bytes、prompt8KiB、完整工具参数16KiB；单NDJSON消息256KiB、总输入8MiB、文本输出32KiB。技术流的pending请求、writer/reader、监听、权限Promise和关闭结果均由原owner追踪。prompt派发后失败/取消为unknown；初始化前拒绝区分未启动业务prompt与远端程序已经启动。关闭保留全部原因，不能吞错；本地关闭不证明远端进程停止。

### 8. 当前能力与验收

ACP执行、独立权限/交付确认、审批HTTP和工具事件消费者已接线。B10已验证真实SSH独立审批与取消，以及受控技术流中reader/permission未收敛时继续等待、退订/cancel同步失败的单次清理和Machine Model因果保留；writer在途等其余故障仍待验。四表/证据归testing，正式前端差异归F1。

## B6.2D Root/Child 与协作

### 1. 职责与范围

Child 是原 `runs` 中的独立 Run，不建立第二个 Runner、Root 注册表或权限中心。Root 最多累计创建四个直接 Child；新设计不提供多层委派、付费请求自动重试或恢复原执行。explore/review 限远端只读工具和受治理的本地协作，worker 可申请写工具；profile 只缩窄可用工具，不授予 capability。profile/model 已由 execution 的持久配置及 Run 冻结快照承接；三个 profile 的取值固定，具体政策可配置，Child 可选择受约束模型引用。

### 2. 子功能与目录

`runs/service/run-collaboration-service.ts` 管委派、依赖、join、取消、消息与事实用例；`run-collaboration-rules.ts` 管配额及纯准入。`runs/model/run-collaboration-{types,model}.ts` 持有应用对象和存储白名单；`runs/storage/run-collaboration-storage.ts` 持有独立存储契约。SQL、关系解码、协作数据和父子围栏归 `runs/adapters/sqlite/run-{collaboration,participant,child-fence}*`。工具严格输入与声明归 `tools/service/collaboration-tools.ts`，不新增平级模块或私有 HTTP 树。

### 3. 依赖方向

原 RunExecutionOwner → ToolService → RunCollaborationService → Model → Storage/SQLite；子模型调用继续由同一个 RunExecutionOwner、RunStepModel 和 Platform AI 执行。register 只接入原 owner 的准入、start/abort/wait/drain 能力，不将应用规则注入 SQLite。Remote/Platform 不认识 Child、profile、共享事实或消息。

### 4. 类型与转换

| 边界                                  | 类型 owner                                             | 转换 owner                       | 消费者                 |
| ------------------------------------- | ------------------------------------------------------ | -------------------------------- | ---------------------- |
| 模型工具 JSON → 应用输入              | tools 的未知输入解码、runs Model 的 CollaborationInput | tools/service 严格解码           | 原 ToolService         |
| 协作应用 ↔ 持久记录/事务事实          | runs/model 与 runs/storage 各自定义                    | RunCollaborationModel 逐字段投影 | Service/纯规则、SQLite |
| 运行与工具/Child安全审计 → 双端协议   | Shared runs/tools/governance/collaboration             | 原 register/HTTP mapper          | 已安装管理员 HTTP      |
| Child 完成输出/协作文本 → 父/同族模型 | runs 内部应用对象                                      | 协作 Service 明确投影            | 模型工具结果           |

消息和事实只是未验证文本，不能作为授权、系统指令或已验证证据。Child 列表、取消及消息元数据 HTTP 的完整契约与严格 codec 在 Shared agent/collaboration，取消复用 Shared runs 请求/header/成功联合。profile 的双端有限取值归 collaboration/values；目标 allowlist、模型历史、正文、事实与存储对象不出公开端点。正式前端消费归 F1。

### 5. 入口与安装

当前内置声明为 `nexus.terminal@1.8.0`，包含 `app.intents.exchange` 和已接线能力，默认 grants 仍空。十个 `collaboration_*` 工具通过原模型工具入口使用；读操作仍需实时全局 grant，委派、取消、发送、消费和 CAS 写入需独立 ToolCall 批准。父模型/工具批准不代替 Child 自己的工具批准。没有旧 runtimeId/sessionId 桥接或新的公开 dispatcher。管理员 HTTP 安装 GET /apps/:appId/runs/:id/subagents、POST /apps/:appId/runs/:id/subagents/:childId/cancel 和 GET /apps/:appId/runs/:id/subagents/:childId/messages，完整前缀 /api/v1/agent；入场/交付分别核验 Access。列表仅 id/parentId/status/version/profile/deadlineAt；消息仅 sequence/senderId/bodyBytes/expiresAt，查询 after/limit（默认0/16，最大32），完整响应16 KiB。观察不改变模型邮箱水位。Child 取消由 RunService 验证不可变父子/user/App 归属，再复用原 Run CAS/幂等取消及审批失效，不建立第二账本。外部直接创建由受审批模型委派替代，旧 GET/PUT subagent-settings 的可配置 profile 已由 execution-settings 承接，不以固定工具 profile 替代管理能力。

### 6. 数据、事务与并发

唯一 v1 更新 Run kind/绝对期限及 Child 关系、事实、mailbox、扫描/消费水位和本地副作用标识。Child 的目标集合、profile 工具、请求上限、期限、依赖和创建 hash 固定；委派读取父当前状态/目标/已有子集，在原事务经 Model 回调执行 Service 纯规则。Child 步骤和工具/审批消费复查独立身份、活父和期限；目标与 capability 仍由原治理权威核验。此前 Child 才能成为依赖，无环；success 依赖要求 completed，settled 接受所有终态。

事实 CAS、消息容量/序列及消费 CAS 同事务，重复工具身份不重做副作用。mailbox 页包括过期位置的扫描进度，空结果不丢 nextCursor；消费不得越过已连续扫描水位。根终态和活 Child/工具/步骤围栏同事务；Root 成功必须没有未完成 Child。ACP 内部权限不计入模型步骤普通工具提案数量，仍纳入独立工具/权限审计。

### 7. 生命周期与失败

Root/Child 共用原八个执行名额，排队依赖也占名额；满载明确拒绝，不暗建另一队列。Root 绝对期限五分钟，Child 一至120秒且不超父期限，请求上限一至32；期限到达阻止新派发，但允许原步骤未知结算。join 最多30秒，只结束等待。父成功前等待每个 Child 的真实任务和清理；Agent 共用错误 owner 的 aggregateToolFailures 同时服务 ToolService 排空和 RunExecutionOwner.waitChildren，嵌套的纯执行未知保留 ToolExecutionUnknown/ToolCleanupFailure，混合存储或内部故障保留 AggregateError，不推测结算；父失败/取消/撤权/停机覆盖整族。存储取消失败仍取消本地 Child、等待资源并聚合全部失败，不以一项错误跳过其他收尾。

重启只对账：未派发 Child 失败，已派发/运行中保守 unknown，不重建等待、不重放请求。Child 每步正文与最后交接正文各最多8 KiB，同步骤/Run 成功事务保存，仅作为模型生成结果交接；超额明确失败。全部 Child 未确认会阻止 Root 成功。没有远端 rollback、跨进程活任务接管或公平排队承诺。

### 8. 当前能力与验收

委派、固定 profile、依赖等待、list/join/cancel、持久消息读取/消费、共享事实 CAS 与父子收尾已接线。B7 接入共享预算、持久 profile/模型与原执行 owner，Memory/Artifact/Browser/MCP 已接线；跨 Run 持久占用归下方 B6.2E。B10 已通过隔离新后端、实际 HTTP/SQLite/OpenSSH 的委派/join、整族取消、独立批准/错族拒绝、消息消费、事实冲突与 Child Job 未知结算子场景；完整配额/期限、未知提交与崩溃恢复仍待验。确切版本、两轮复审及命令证据归 testing，正式前端后置 F1。

## B6.2E 项目上下文与共享突变占用

### 1. 职责与范围

Agent tools 持有 Run-local 项目目录；Remote machines 持有受管远端突变的唯一准入权威。普通 SSH Files/传输、Workspace Docker 与 Agent 文件/Shell/Job/ACP/Docker 共用占用，但不共享登录身份、批准或活跃连接。旧 ssh_session_open/list/close 仅复用 transport、没有持久 shell 状态；新设计由独立 Remote operation、Run/Job 查询取消及父生命周期替代，不保留第二连接池或 sessionId 桥接。旧 Thread 项目共享改为 Root/Child 各自绑定，当前不自动向子 Run 或系统提示注入指导。

### 2. 子功能与目录

Agent tools/{model,service,storage,adapters/sqlite}/tool-project-* 分别持有应用类型/转换、目录用例、存储契约与真实 SQL；tools/service/tool-definitions 和 tool-input 持有受信声明/严格参数，ToolModel 持有 Remote 请求/结果/失败转换。Remote machines 对应层的 mutation-* 持有应用身份/转换、准入政策、存储接口和 SQLite 事务，migrations 仅安装 Adapter。128 个 endpoint 占用、单次最多两个 endpoint 是 Remote Service 政策；目录256 UTF-8 bytes、子目录深度8、四份文件/每份8 KiB 是 Agent 项目用例限制，不是新增 HTTP 容量。

### 3. 依赖方向

Agent ToolService → ToolProjectService → ToolProjectModel → ProjectStorage → SQLite Adapter；指导读取走 ToolModel → Remote public.operations → RemoteMachineOperationService → File/Command/Acp Model → Platform。Remote Files/Observation/Operations Service 直接复用同一 MachineMutationService → Model → Storage → SQLite Adapter。Adapter 不引用应用类型或规则实现，Platform 不定义 Agent/目标业务对象；Bootstrap 只安装 register/migrations。

### 4. 类型与转换

| 边界                       | 类型 owner                                                              | 转换 owner / 消费者                                                      |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 模型工具 JSON → 应用       | tools/model/tool-project-types、tool-types                              | tool-input 严格校验，ToolService 生成安全审批摘要                        |
| 项目应用 ↔ 存储            | ProjectScope/Binding/Mutation；storage StoredProject*                   | ToolProjectModel 逐字段转换，Adapter 仅解码 row                          |
| 指导应用 ↔ Remote 后端契约 | ProjectGuidance；remote/public.operations                               | ToolModel 构造请求并逐字段生成指导结果，ToolProjectService 生成工具 JSON |
| 突变应用 ↔ 存储/Targets    | machines/model/mutation-types；storage mutation-storage；Targets public | MachineMutationModel 解析受信 endpoint、投影命令并映射安全失败           |
| 应用 → 双端审计            | 既有 Shared agent/tools 与 remote 安全错误                              | 既有审计/HTTP/WS mapper；目录正文、claim keys、row 不进入 Shared         |

本版无新增目录/占用 HTTP 或 WS DTO。指导不可信，不等于授权、证据、Shell cwd 或系统指令；普通协议安全码继续使用 conflict/operation_unknown/limit_exceeded 等现有契约。

### 5. 入口与安装

project_directory_bind/read/clear v2 经原模型 proposal、账本、目标检查与治理消费执行；bind/clear 需当前 file.read 和独立批准，read 需当前只读权。参数为 connectionId 加 directory（bind）或可选 path（read），clear 无额外字段。bind/read 从绑定根沿指定子目录读取不区分大小写的 AGENT.md/AGENTS.md，拒绝链接、越界和超量；未绑定 read 返回空上下文。Remote register 安装唯一 mutation owner，普通 Files、独立 Agent operations 与 Workspace observations 接入；启动 initialize 在监听前完成 held→blocked 围栏。

### 6. 数据、事务与并发

仍只有初始化 v1，Bootstrap 调 Agent/Remote migrations，不升级旧开发库。agent_run_projects 按 Run/connection 唯一，删除 Run/connection 级联清理；agent_project_effects 按 ToolCall 唯一，目录改写与 effect 同事务，复查 dispatched/action/hash/target/policyRevision/live participant，bind 另核 SSH/version。不重放未知目录写入。

remote_machine_mutations 按 SHA-256([lowercase host,port]) 唯一。ID/user/凭据/代理变更不为同一文本 endpoint 创建第二占用；跨端复制/移动一次事务检查并获取两个排序去重 key，部分获取不提交。已持有或 blocked 报 conflict，最多128个 endpoint；不自动重试或排队。释放/阻断必须匹配原 claim ID、key 和 held 状态。私有 Files 同资源既有队列仍保留，跨资源占用不等待。DNS/IP别名、不同跳板网络中的同名主机不被此文本身份准确区分，可能漏合并或保守拒绝；不宣称真实物理主机识别。

### 7. 生命周期与失败

占用涵盖实际操作、远端结果确认、独立资源清理和最终授权复查；后台 Job 在实际执行时持有，受理回执不持有假执行占用。确定结果/拒绝且清理完成释放；operation_unknown、未知异常或清理失败保留 blocked。拒绝的归档操作必须由原归档 owner 完成私有临时项清理，Host Key 拒绝不等于已执行突变。结算失败保留未知，不在未知释放后猜测第二次写入；清理与结算双失败仍保留 RemoteResourceCleanupFailure 供停机 owner 汇总。重启将 held 保守转 blocked，不恢复执行、不按 TTL 自动释放。

项目读取共用45秒整项期限，绑定只在指导读取及当前授权复查后提交；目标 version/fingerprint 改变拒绝旧上下文，不隐式重绑定。占用不是 OS 隔离：交互 PTY、外部客户端、后台派生进程不受此数据库锁控制，命令退出/SSH close 不能证明派生进程停止。已确认远端结果后的响应丢失不自动重放副作用。

### 8. 当前能力与验收

受管突变准入与 Run-local 项目工具源码已接线；全部行为待 B10，执行须 governed 准入。持久 blocked 已由下述 B9 机器突变恢复接线管理员只读核对、人工证据和独立 CAS 释放；不将重启/期限/改连接ID当解除证据，原未知结果不改写。B7 已接入可配置上下文/预算及执行回接，B8 外围能力已接线；Shared 恢复契约已有后端消费者，正式前端 F1。USAGE 记录当前限制，四表/源码复审与待验场景见 testing。

## B7.1 Preferences 持久安装配置（源码已接线，行为待 B10）

### 1. 职责与范围

Preferences 拥有持久设置及版本；Access拥有准入/认证政策，Remote拥有采样/缓存用例，Platform不持有设置业务。本批迁移安全策略、活动CAPTCHA配置、监控间隔和多Origin/RP。界面布局和个人数据归 Preferences，日志/审计/通知归 Operations，Agent 上下文/子模型/预算归 Agent；外观/备份及外围集成已由 B8 接线，全部行为仍待 B10。

### 2. 子功能与目录

preferences/configuration/{service,model,storage,adapters/sqlite} 分别持有配置用例、应用与存储/密码技术转换、独立存储契约、SQL/row解码。通信放preferences/interfaces/http，安装在register，DDL经migrations调用Adapter。configuration-rules 持有可复用纯配置校验，Service 与恢复预检共用；配置版本、默认值、重启生效策略归Service；编码容量/安全失败归Shared preferences/configuration/values。

### 3. 依赖方向

HTTP→Service→Model→Storage→SQLite Adapter；Bootstrap先await Preferences初始化，取得窄安装快照后安装Access/Remote。Preferences业务入口只依赖Access public认证接口，不引用其策略实现；Access register另提供仅安装使用的readTransactionIdentity，执行Access Adapter自己的SQL并返回userId/null。Bootstrap在读取配置、安装Access后将它一次性绑定到Preferences Adapter；事务executor不进入业务Service/公开HTTP，未安装拒绝写入。配置不会通过Platform注册槽传播。因素Model只根据已配置Origin/RP及协议边界验证的当前Origin选用技术配置。

### 4. 类型与转换

Shared持有完整配置GET/PUT、业务可见政策及CAPTCHA安全视图/秘密写命令。应用类型归configuration/model/configuration-types，存储记录归storage；Model逐字段映射并加解密，SQLite Adapter只解码其storage类型。ConfigurationView内部独立定义有效监控投影，Service从启动快照选值，HTTP逐字段构造Shared必填effectiveMonitoring；范围基础值归Shared，规则与SQLite row解码精确引用。HTTP白名单投影不返回secret或ciphertext；Backend安装快照在register/public边界明确投影，秘密只供Access真实安装消费者使用。

### 5. 入口与安装

管理员GET/PUT /api/v1/settings承载当前核心配置，PUT完整替换并必填expectedVersion；CAPTCHA管理入口单独GET/PUT /api/v1/settings/captcha，匿名读取保持公共安全视图。未知/旧界面字段拒绝，不静默过滤。初始化使用环境seed且仅首次写入，后续启动读取持久配置；Access/Remote采用同一已验证版本快照，不重新用环境覆盖。

### 6. 数据、事务与并发

单一v1增加preferences配置单例表。完整更新和CAPTCHA专项更新都在Adapter以版本CAS写入，不先读后无条件覆盖；同事务通过Access安装能力复查session/password revision/expiry，Model将userId/null转换应用actor，Service的同步准入回调决定管理员权限，拒绝整体回滚。秘密keep/replace/clear由Service决定新配置，Model加密并逐字段转换，存储永不保存明文。保存后effectiveVersion保持当前启动版本，requiresRestart明确显示待生效；下一次启动重新验证/解密并安装消费者。此新设计替代旧配置即时生效，差异登记F1；本批不实现热刷新，不创建双权威缓存或猜测回滚。

### 7. 生命周期与失败

读取/更新以原Access身份入场并在交付前复查；Settings关闭拒绝新调用且等待全部在途任务，SQLite在其后关闭。已提交而响应失败按未知交付处理，保留版本/输入并只读核对，不自动重写。存储/解密/配置无效时启动失败，不回落默认或放宽安全策略；重启不重放运行任务。活动来源配置在进程内不可变，因此在途挑战/旧连接不受半生效配置影响；下一次启动按保存Origin/RP检查旧挑战。

### 8. 当前能力与验收

源码安装、Shared 和四个 Settings HTTP 已接线，四表、两轮复审与静态证据归 testing。快照 Adapter 复用行解码后，经安装回调调用 Model 的解密投影及同一 configuration-rules；SQL 层不引用应用类型或规则，恢复预检拒绝无效白名单、站点或 CAPTCHA 配置。多Origin HTTP/WS仍必须校验Host、协议、同Origin来源；多RP根据当前可信Origin选用，并绑定挑战中的Origin/RP，不能取任意第一个配置。最多16个配置站点，与监听主Origin使用同一协议，HTTP仅允许localhost/127.0.0.1；不同协议须调整配置和部署后重新启动，监听校验失败不开放服务。会话身份复查与Settings CAS在同一SQLite事务；撤销先提交则设置拒绝，设置先提交则交付仍复查且不能撤回已提交配置，也不能承诺浏览器收到。正式CAPTCHA/IP及监控配置面板已消费Shared，Dashboard使用有效监控值；其余Preferences消费者仍F1-D。真实HTTP保存/CAS/重启与受控界面专项证据归testing，不代表全部运行时采样时序验收；B8外围功能已源码接线，执行须 governed 准入。

### B7.2 偏好与个人数据设计

#### 1. 职责与范围

Preferences 拥有界面偏好、快捷命令/标签、命令历史、路径历史和收藏；核心安全配置仍由 configuration 独立持有。个人数据按当前 Access 用户隔离，不能因知道记录 ID 访问其他用户的数据。历史的真实生产者是前端 HTTP，旧 Workspace 未自动写历史；不为假设消费者添加跨模块入口。Agent 不读取普通用户历史或继承活跃 Workspace。

#### 2. 子功能与目录

用户界面偏好归 presentation，快捷命令和标签归 commands，历史归 history，路径收藏归 favorites；各自 Service 编排用例/容量，Model 转换与失败分类，storage 定义任务，adapters/sqlite 定义 SQL/行解码。HTTP 统一归 Preferences interfaces/http，不创建第二棵入口树。

#### 3. 依赖方向

HTTP → Service → Model → Storage → SQLite Adapter。Access 只通过 public 认证及 register 安装的事务身份读取能力协作；Adapter 不借用 Access 私有 SQL。没有实际后端消费者的能力不公开到 public，不新增全局分发器。backendLogLevel 归 Operations logging owner；终端 scrollback、Docker 面板轮询及预览参数都是前端偏好，不修改 Backend checkpoint/采样资源限制。

#### 4. 类型与转换

Shared preferences 子域持有双端请求、完整成功/失败、基础值及预算；应用类型只在子功能 model，存储任务只在 storage，SQL 行只在 Adapter。HTTP 与 Model 分别逐字段转换，时间在协议边界表达，既有字段相同仍转换。查询、写入、清空的契约分别定义，不用任意字典充当业务结构。

#### 5. 入口与安装

旧实际方法/路径逐项核对，契约变更列 F-R26/F-R27；个人偏好 GET/PUT /settings/preferences 与原 layout/focus-switcher-sequence/sidebar/workspace-layout 安装，命令/标签/历史/收藏保留旧各自路径方法。register 安装各 Service/Storage、路由和生命周期，Bootstrap 只接安装入口。用户身份来自 Access，不来自 JSON/query。历史新增只是记录数据，不执行 Shell。

#### 6. 数据、事务与并发

仍只有初始 v1。每次个人数据写事务复查会话，并绑定最初认证用户；历史 upsert、更新时间、修剪同事务完成。命令与标签关联同事务，不允许部分批量成功。编辑类使用版本 CAS，存储损坏失败闭合，不默默恢复空对象。用户偏好保存立即成为读取权威；首次未保存明确 version=0，第一次 CAS 写入创建 version=1，不读取旧字典或恢复损坏数据。界面实际生效由 F1 的真实消费者负责。命令按用户最多2000、标签200、收藏2000；上限归 Service 同事务回调，SQLite 只提供事实。批量标签关联核对全部命令原版本；删除标签推进受影响命令版本，原编辑不能覆盖变化。列表有界分页、固定次序，但非跨请求快照。命令/标签/收藏的持久时间在 Adapter 完成权威读取后生成，更新不倒退；历史按同用户/类别现有最大时间防止回退导致新项误裁剪。行解码核对创建、使用与更新时间关系，命令递增在写入前拒绝版本或使用次数耗尽。

#### 7. 生命周期与失败

Service 停止准入后等待已接纳真实工作，关闭不取消已提交结果；限制排队数量。协议严格解码和预算在副作用之前，事务后转换/认证/交付失败为 operation_unknown，客户端只读核对，不自动重放。普通历史记录与 Agent 执行权限独立。configuration/presentation/commands/history/favorites 复用模块内部 PreferencesTasks 观察已接纳任务，Service 仍拥有准入与配额；已结束真实故障保留最多16个诊断样本及额外数量，关闭排空并汇总，预期用例拒绝不算存储故障。

#### 8. 当前能力与验收

B7.2 的个人偏好、命令/标签、历史及收藏源码已接线，功能源码和静态通过分开记录。正式前端留 F1，行为回归留 B10；逐项缺口、两轮审核四表及当前执行证据归实施方案和 testing，不把设计当完成。

### Operations 日志、审计与通知

1. **职责与范围**：Operations 拥有 backendLogLevel、受限审计记录、通知配置与投递账本。Access/Targets/Remote/Agent 仍各自持有业务状态；Operations 不成为授权 owner。仅已实现的事件进入 Shared 可选列表。
2. **子功能与目录**：logging/audit/notifications 各按 service/model/storage/adapters/sqlite 放置；HTTP 和安全投影集中 interfaces/http；audit/service/audit-event-owner.ts 持有发布、请求/事件准入及停机排空，register 只装配和公开投影；operations-storage-refusal 是独立存储拒绝，Model 的 operationsStorage 负责映射应用失败。Service 管保留数、订阅选择、队列容量和激活时机；Model 管对象、秘密与技术失败转换；Adapter 管 SQL、行/JSON 解码和事务。
3. **依赖方向**：业务 owner 经 Operations public.publish 提交有限安全事实，出口将同步准入/异步任务失败统一转为 public-errors.ts 的安全 OperationsError，内部原始 cause 由真实任务 owner 留存，已安装 HTTP 经 observer 直接调用内部发布 owner 记录结果，不绕公开安全包装；通知 Service → Model → Platform delivery。Platform logging/delivery 不引用业务事件、用户或通知配置对象。Shared common/http-codec 仅复用通用 JSON 原语，不反向依赖 Agent。
4. **类型与转换**：Shared operations 持有事件/日志级别/投递状态、完整协议与容量。内部类型归各子功能 model，存储类型独立归 storage。秘密字段按配置ID与字段作用域加密；Adapter 的配置 JSON 独立限制为128KiB以容纳加密膨胀，不能复用64KiB请求预算；公开对象和内层配置解码均使用完整响应预算。公开只返回 hasPassword/hasBotToken 与 header 的名称/hasValue，明文/密文不出 HTTP。
5. **入口与安装**：GET/PUT /api/v1/settings/logging；GET audit-logs；GET/POST notifications、PUT/DELETE notifications/:id、POST notifications/:id/test、POST notifications/test-unsaved、GET notification-deliveries，均要求当前管理员。Bootstrap 安装 Access 事务身份读取能力、初始化日志/投递恢复，再开放监听。真实 Agent 审批/Memory/Artifact/Run 和 Remote SSH 事件从原 owner 发布，Auth/Targets/Settings 观察真实路由结果。
6. **数据、事务与并发**：日志设置未显式写入时允许无持久行，由 LoggingService 提供 version=0/info 默认；快照导出与恢复保留该合法空表，不补写默认记录。配置 CAS 与会话复查同事务，写入时钟在读取事务事实后求值；日志/通知配置递增前拒绝安全整数耗尽，通知删除不因版本耗尽被阻止。通知行及投递行核对更新不早于创建，派发与结算均验证状态 CAS。审计 event_key 去重且核对原事件、身份、资源及路由/状态内容，不把重试时钟作为绑定内容；订阅选择通过 Model 同步回调消费事务内事件/配置/待投递事实，最多4096个 queued/dispatched，容量不足保留整个事件待分发，不丢一部分。选择采用分发时已启用的配置，且配置创建时间不晚于事件；不是业务写入时的配置快照。outbox 保存加密配置快照；禁用仅停止未来分发，删除令尚未派发项失败，已派发不撤回。审计保留最新50000条及尚未分发积压；投递保留最新50000条终态与全部在途项。业务提交与审计发布不是同一事务，崩溃可能遗漏尚未发布的业务事件，不承诺全局 exactly-once。
7. **生命周期与失败**：HTTP 最多64个、事件发布最多256个在途任务，晚失败有界汇总。其他业务 owner 排空后 Operations 才停止发布并排空请求/事件，再取消和关闭投递。投递串行、完整截止20秒；queued → dispatched 在网络前持久，成功/确定拒绝/未知分别结算 sent/failed/unknown。重启将 dispatched 围栏为 unknown，不重发；关闭和响应体/SMTP资源失败保留因果。日志按版本单调激活，避免迟到读取恢复旧阈值。协议边界保留 HttpInputFailure 的状态/安全码，正常输入拒绝不污染事件 owner 的关闭证据；观察的是响应决定，不证明客户端收到。投递观察器唯一记录其任务失败，关闭只等待后汇总；事件owner按错误实例去重，发布与请求两条追踪链不重复登记同一失败；仅 delivery_failed/delivery_unknown 可结算为投递结果，其他故障停止派发并保留原账本。日志失败仍启动独立分发收尾。
8. **当前能力与验收**：源码已接线，正式 UI 留 F1；安全有限事件替代任意 details，模板支持 event/subjectId/time，时间为UTC、Email为纯文本。B10已验证环回HTTP/Telegram协议、实际SMTP收发与全部/部分收件人拒绝、Access登录事件分发、配置CAS/秘密保留清除、在途关闭及重启不重发。Delivery Adapter仅按供应商结构化EENVELOPE/RCPT TO及4xx/5xx确认全部收件人在DATA前被拒，映射确定失败；部分成功和其他确认缺失仍保留unknown，清理失败不能被覆盖。真实公网供应商、TLS/SMTP认证、崩溃/满额/自然期限及其余producer仍待验，不把回执当交付成功。

### System 宿主诊断

1. **职责与范围**：diagnostics 提供当前进程运行时/内存和数据库版本；status 拥有本机资源采样及 HTTP owner 健康响应。不返回环境、路径、表内容、凭据或远端机器详情。
2. **子功能与目录**：diagnostics/service 管准入/管理员复查/关闭，model 管转换，storage 和 adapters/sqlite 读取 schema 事实；platform/system 只采集进程技术事实。
3. **依赖方向**：管理员 HTTP → DiagnosticService → DiagnosticModel；Agent ToolService → ToolModel.hostDiagnostics → System public.collect → DiagnosticService；ToolModel 白名单转为本模块工具结果并映射 SystemOperationError。没有 System → Agent 依赖，也不借 Agent 私有诊断类型；System 公共出口只抛 public-errors.ts 的安全 SystemOperationError。
4. **类型与转换**：Shared system/diagnostics 定义双端对象、响应/错误与16KiB预算；system/status 定义健康响应及严格 codec。内部 HostDiagnostic、SystemHealth 和存储事实分别独立，Model、System public 和 HTTP 各持有自身白名单。纯应用健康判断由 Service 完成，不创建空 Model。
5. **入口与安装**：GET /api/v1/status 不要求用户会话，返回 {status:"ok",service:"nexus-backend"}；仍经 Bootstrap 全局来源/IP 准入及 Operations 观察，不代表数据库或外部依赖健康。GET /api/v1/system/diagnostics 要求管理员，Bootstrap 将窄诊断能力安装给 Agent。host_diagnostics_read 无参数，使用受信声明 nexus.terminal@1.8.0 的 host.inspect；声明不自动授予 grant。
6. **数据、事务与并发**：SQLite Adapter 经 schema adapter 读取真实迁移版本；诊断最多4个在途调用。进程和数据库采集不保证同一物理时刻，时间为 Unix 毫秒、uptime 为整秒。
7. **生命周期与失败**：Service 拒绝关闭后的新任务、追踪实际采集/身份复查，System 并发关闭共享同一 Promise，排空 status 和 diagnostics，数据库最后关闭；关闭排空时仍在途的采集故障由 allSettled 汇总，正常认证/准入拒绝不升级为采集故障。采集技术失败由 Model 转成 SystemCollectionFailure，cause 仅留内部；数据库探测失败仍作为 available=false 的诊断事实返回。跨子功能共用 SystemStatusFailure 只在 system-failure.ts 定义，status-types 只持有状态对象。HTTP 输出安全错误，技术正文不外泄。
8. **当前能力与验收**：HTTP 与真实 Agent 工具已有源码，正式前端 F1、所有行为 B10。

B7 资源收尾：Artifact 的 HTTP 下载、模型读取和上传均绑定 lease，关闭共享同一 Promise 并等待已接纳 lease 与删除/清理任务（含后续元数据和事件）收敛；清理失败保留删除保护与有界故障证据，不因任务返回而释放保护。Preferences 各子功能在 preferences-lifecycle.ts 复用窄停机结果分类：普通业务拒绝不升级为停机故障，存储不可用/未知提交/内部故障仍汇总返回。Memory 导入的 source 事实与创建预览的确认额度分别表达，确认执行不虚构计数。

## B8 外观、外围集成与备份设计（源码收口，行为待 B10）

### 1. 职责与范围

Preferences 拥有终端主题、外观偏好、HTML 主题与背景引用。Agent integrations 拥有 MCP/ACP 配置和 Browser targets/session；Agent plugins 拥有可信包、安装版本、插件数据、签名 Skills、前后端 SDK/RPC 与跨 App intents。System backups 拥有全产品加密导出、候选预检、在线导入、持久恢复对账和实例重建。上述源码及两轮复核已收口，静态证据归 testing，B10仅通过已登记的有限行为子集；原功能以实际路由、Service/Adapter 和消费者为依据，正式前端 F1。

备份是实际产品能力：旧快照包含产品/Agent 数据和 background、custom_html_theme、Artifact objects、plugins 文件，不含认证表与可重建模型目录缓存。新设计覆盖最新 owner，不导入旧 Backend/Protocol，不兼容旧开发库或旧快照表结构。现有 Artifact、Memory、Execution、Run/审批和 Remote machines 不另建一份。

### 2. 子功能与目录

| 所属位置                     | 职责及复用                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| preferences/themes           | 终端 preset/用户主题、导入导出、名称及版本规则；真实 preset 内容归应用，不放 Platform。                                                                                    |
| preferences/appearance       | 完整字体/颜色/描边/阴影/UI 及活动主题、HTML 副本、背景引用；内容技术调用由 Model 封装。与 presentation 的布局/一般偏好分工明确，同义字段只有一个 owner。                   |
| agent/integrations           | MCP/ACP 配置与刷新，Browser 配置/会话/操作；确有独立生命周期时在该子功能内拆分，不新增平行一级模块。                                                                       |
| agent/plugins                | Publisher、仓库/catalog、stage、安装/升级/卸载、数据、SDK/RPC及 intents；内部按真实独立职责拆分，不按每条路由建目录。                                                      |
| system/backups               | 密码证明消费、覆盖集、维护准入、验证/导出/恢复政策和恢复状态；跨模块技术快照经明确注册能力取得。                                                                           |
| platform 的实际协议/内容能力 | 通用有界文件、加密封装、包解析、网络、MCP/CDP 技术与具名失败；可复用时扩展已有 blobs/acp/http/security/storage，不把 manifest、App、背景类型或 restore 政策移入 Platform。 |

各子功能沿用 service/model/storage/adapters 的实际职责；通信集中在所属模块 interfaces/http，不另建同义入口树。无持久需要的 runtime 不建空 SQL 层。SQL/DDL/持久 JSON 与第三方结果的解码归对应 Adapter。

五个产品模块的`snapshots/adapters/sqlite/snapshot-registration.ts`仅维护模块固定表列、秘密传递及内容验证任务，由`register*Backup`安装；不另设业务Service/Model或建立可任意调用的跨模块存储入口。Access安装明确排除集。System BackupService持有密码证明、单任务名额和完整交付生命周期；BackupModel消费opaque SnapshotCollector字节并映射技术失败。Platform的SnapshotRegistration/SqliteSnapshotCollector和SealedBytes只持有固定技术注册、SQLite/Blob读取及加密封装，不定义产品业务对象。

### 3. 依赖方向

业务 Service → Model → 独立 storage/Platform → Adapter。Preferences 子功能直接消费同模块应用能力，themes/appearance 的当前引用判断通过同事务事实回调协调。Agent plugins 通过 Scope/Governance/Run/Artifact 的内部应用能力安装声明、排空与管理引用，不能让插件 SQLite Adapter import 这些 Service/Model 或跨 owner 直接改表。

MCP、Browser 和已实现 ACP 继续经原 ToolService/RunExecutionOwner/governance/context/execution；共用技术连接不共用普通 SSH 会话、批准、budget 或资源名额。Browser 目标由服务器配置，模型输入不能自报一个新的 CDP endpoint 取得权限。

System backups 通过 Access public 消费窄密码证明，通过安装契约取得应用维护/重建能力；不深层读取账户 hash 或直接访问私有 Model。模块 SQL Adapter 可向通用快照机制登记固定表列、顺序、存储校验和秘密转换任务，签名只使用存储/技术类型；register/Bootstrap 仅安装注册，不在通用层定义业务对象。备份 Service 不取得原始 SqlRow、文件句柄或万能执行器。实现前核对这些注册能力的真实消费者，不为测试或预留扩大 public。

### 4. 类型与转换

| 边界                        | 类型唯一 owner                                                                 | 转换 owner / 消费者                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 外观/主题/HTML/背景 HTTP    | Shared preferences/{appearance,themes,html-themes} 的完整请求/响应/基础值/容量 | Preferences interfaces 严格 unknown 解码及双向白名单；正式前端 F1 自行 wire→UI。                                |
| 集成/Browser 配置和安全观察 | Shared agent/integrations；秘密仅明确写意图及存在标志                          | Agent interfaces→应用输入，Model→独立存储/技术；管理 UI、真实模型执行与恢复链分别核对。                         |
| 插件管理、SDK/RPC、intents  | Shared agent/plugins，复用 scope/governance/artifacts 的真实基础契约           | HTTP/静态/RPC 边界显式转换；后端内部 manifest/已安装事实/版本账本各有 model 与 storage owner。                  |
| 备份 HTTP 与安全结果        | Shared system/backups                                                          | System interfaces 与 BackupModel；共享只包含输入、摘要、状态/错误/容量，不包含秘密、表行、解密 key 或恢复日志。 |
| 应用↔数据/协议/文件         | 子功能 model/*-types、storage、Platform 各自独立                               | 每个 Model 负责字段/单位/能力/失败转换，Adapter 解码 SQL、manifest、CDP/MCP 和包内容。                          |
| 跨模块密码证明/维护能力     | Access/System 或安装 owner 的 public/register 独立契约                         | 模块入口/出口逐字段转换成功与拒绝；私有 cause、ReturnType 和技术句柄不穿透。                                    |

Browser 配置原来在 Agent settings；不能因名字相似把它塞进 MCP/ACP configuration 联合。同 Run collaboration 消息与跨 App plugin-intents 是不同范围和授权语义，不共用一个泛化消息对象。存储密文与可导出的受保护载荷不同，跨实例恢复须真实重新保护秘密；直接复制旧实例密文不构成可用备份。

### 5. 入口与安装

Preferences 安装 /api/v1/appearance、/terminal-themes 的实际对应入口；主题 JSON 导入/导出、background 二进制与 HTML 文本各有明确读取预算、媒体类型和资源收尾。HTML 内容仍只当文本交付，前端 sandbox 消费；不在后端执行，也不把可信 GitHub 来源当执行授权。

Agent integrations 对应旧实际 /api/v1/apps/:appId/integrations；plugins 对应 /api/v1/agent/plugins；跨 App intents 保留独立 /agent/apps/:appId/plugin-intents 覆盖依据。Agent settings 的 Browser targets、插件 repositories 和 onboarding 推荐/安装也要有实际新消费者。允许按 D15 修改 Agent 契约，但须逐项记差异与 F1，不保留旧字段桥。

System backups 的导出已安装POST /api/v1/settings/backup/export（JSON password→二进制下载），Shared system/backups拥有请求、安全错误和容量；导入已安装 /api/v1/settings/backup/import，multipart backupFile/password，安全回执与严格 codec 同属 Shared。HTTP 输入失败以接口层具名错误保留状态码，cause 仅供诊断，不据其内容决定响应。导出验证原会话的当前密码；导入当前完整认证与输入解密分别校验。实际 method/path/header/query/multipart/binary/响应/认证预算以实施对应表收口，schema 自动汇总仍留 P1，不借施工改变该启动条件。

Bootstrap 安装维护 owner、快照注册、恢复状态核对和模块重建能力，不承担业务判断。启动时先核对未完成恢复，再安装依赖最终数据的运行时并开放监听；无法确定存活数据时保留现场并拒绝开放写入口。

### 6. 数据、事务与并发

Run创建/取消时间由SQLite Adapter在实际读取后生成，Model不再传入排队前时间。Service通过Model的事务回调核对新建容量；RunExecutionOwner跟踪排队写入，执行名额仅在重放查询后对新Run准入。Run/Step/Tool及审批的单项、批量、级联和启动恢复均检查递增上限，派发和流式累计预留必要结算空间；SQL与行解码仍只在Adapter。Run/Step事件分页在同事务核对应有数量、连续序列、版本与末项状态/时间。

Artifact普通下载和插件包暂存复用ArtifactService的readGranted lease；存储读取显式区分session原App归属与tool附件授权，会话读取保留原管理范围，不借用tool-only前提。会话/工具身份经Model读取当前事实，Service核对ready/有效期及HTTP响应绑定版本，分块及结束前复查。空文件仍授权，插件intent下载也经同一lease和最终复查，精确范围短读/超量均失败；HTTP只持有Range、响应头和交付。Run撤销确认失败也等待原任务收敛；Child围栏提交不明仍取消并排空已验证归属的本地任务，保留存储与清理双因果。ProviderHTTP仅将成功写入后的投影/复查/交付失败归为operation_unknown，写前确定拒绝保持原码；发现写入完成后不再将取消误报为确定未写。

终端主题身份/内容/preset 来源与名称明确持久化；preset 同名冲突按应用规则保留用户主题的颜色、ID 和引用。活动主题删除与引用清空/相关设置版本同事务处理，不能把引用清理拆成之后的 best-effort 写。读取缺内容不静默改偏好；损坏与主动删除不同。

集成配置 CAS、凭据代际、发现的 schema/hash 与 App/声明版本分别表达。保存配置不等于连接已建立；刷新回写核对原版本和具体 generation。模型发现引用与真实工具调用绑定同一 schema/配置/授权事实；旧批准不自动授权新远端工具。Browser action 绑定原 session/target/version，页面快照/nodeRef 不能被新导航复用。

插件包同身份/版本内容不可变；stage→verify→install、升级排空→版本切换和卸载→数据删除分别有持久判据。受信 manifest 由 Scope 安装成声明，不自动赋予 grants；撤销 publisher、App 禁用或升级围栏旧 Run/工具。intents 固定原用户、发送/接收 App 和意图内容，Artifact 引用/授予与消息创建同事务，不把收到消息解释为通用文件权限。

当前导出登记87张产品表，逐次核对实际表集、声明列顺序及唯一v1签名；认证七表、模型缓存及技术schema记录明确排除，新增表或列但未登记会拒绝导出。固定表列按技术白名单投影，秘密在所属Adapter解密为受载荷保护的传递表示，System只取得字节。背景ready、Artifact ready和插件staged/verified/installed原包按真实引用采集；实际大小在读取前后核对，内容hash及插件manifest/files/entry/signature复用原解码owner验证；文件预算先包含base64膨胀及完整JSON。SQL前后快照内容hash必须相同，内容发布中或变化拒绝；这不是全应用物理一致快照。

备份覆盖集在全部本阶段 owner 确定后冻结，登记允许的表/列/文件根/敏感字段和恢复顺序，拒绝未知或缺失的必需组成，不使用过滤字段/跳过未知表兼容。数据库快照与文件不是同一物理事务；采集前后核对源版本、实际引用、大小/hash 与包内容，有限重采集仍不能宣称全系统物理快照。

恢复先完成格式/预算/解密/表引用/文件/包/声明校验，再进入维护态。staging、目录 journal、文件发布、SQL 数据及 commit marker、旧内容清理分别确认；恢复表和 marker 同事务。数据库提交未知保留 journal，不猜测回滚或重做写入。跨实例秘密按目标密钥重新保护；认证表、当前会话与活跃技术句柄不恢复，目标用户归属明确核对。历史批准/Run/outbox 的数据恢复不能自动派发原副作用；持久 unknown/blocked 保留，由原 owner 对账。

跨 App 消息独立于 Run mailbox：plugin-intent Service 判断双方当前启用/声明/能力/grant、manifest intent/schema、配额、有效期和防重放；Model 转换应用事实与存储任务，SQL Adapter 不判断授权政策。消息冻结 App 版本及 App/政策修订，当前事务先复核身份与原内容，合法重放不重新计准入。新记录与 Artifact grant 同事务；Artifact SQL 由注册的 Artifact 存储任务持有，消息 Adapter 不改 Artifact 表。持久证据有限，过期不重建同一操作。

Artifact grants 表及查询归 Artifact Adapter，实际删除/清理预览/统计同时计算附件和有效消息授权。消息授权只覆盖绑定的 artifact/version；读取经 Artifact Service 持有 lease，消息 Service 的窄授权回调逐块复查会话/双方版本/grant与期限。HTTP 逐字段投影、Range及字节交付归 interfaces；同一 Artifact存储→应用及应用→HTTP转换只有一个owner，消息读取复用它们。两端九方法调用复用原PluginService/PluginRuntimeService与消息Service；IntentService是五个消息RPC方法的唯一分派owner，应用契约定义于plugin-intent-types。前端资源grant的安装revision/期限与后端具体实例的存活/安装revision在实际消息事务检查；存储身份用明确session/runtime联合，不伪造会话或当前用户身份。128 KiB SDK分段读取复用Artifact lease与逐块复查，完整读取后再次确认权限再交付；Shared校验身份、范围、精确长度和规范base64。后端编码保留1 KiB IPC封装余量，超限读返回limit_exceeded，已提交写返回operation_unknown。confirmed声明不替代执行grant。接收列表的limit限制最终可见回执：SQLite Adapter在同一事务按(created_at,id)倒序、128候选一批继续扫描，缓存本事务发送方存储事实；业务visible回调仍由Service持有，经Model逐字段转换，失效候选不能挤掉较早有效回执。

所有初始表与精确签名仍只维护一个 applicationMigration v1；不增加 B8 开发升级历史。

### 7. 生命周期与失败

背景替换、包下载/展开/发布、snapshot、CDP/MCP 与恢复都跟踪真实任务直到字节/句柄/存储确认和独立清理结束。取消只结束当前等待或触发原资源 owner 收尾，不证明外部停止。失败保留确定拒绝、提交未知、外部执行未知与清理失败，安全出口不透出秘密或底层正文。

插件升级先停止新准入并等待原 Run、runtime、SDK/RPC 和内容 lease 收敛；超时不能报已退役或删除仍被使用的包。并发 close 共享 Promise，晚构造的连接/子进程仍由原 owner 释放；版本切换不借当前 appId 去关闭随后创建的新实例。Browser/CDP 关闭仅证明本地连接收尾，远端浏览器是否退出分别判断；MCP input_required 有独立等待与取消 owner。

恢复涉及所有可能写入被恢复事实的 owner：Remote Files/挂起/Docker、Targets/Preferences、Agent 模型/工具/内容/插件、Operations 的事件和 outbox。终止式 quiesce/close 的旧实例不能重新投入使用；恢复成功或已确认回滚后基于存活数据重建并重新绑定全部消费者，关闭旧事件/订阅与在途回调。无法排空、存储未知或清理未确认时保持维护/受限状态，提供安全诊断；不自动重播付费请求、通知或插件任务。

HTTP 技术监听器已提供 `suspend(owner) → drain() → replace(bindings) → resume()`。暂停立即关闭 HTTP/WS 准入，保留已登记的维护请求；共用连接的并发请求不能作为排空排除项。请求占位同时覆盖业务 handler 和响应 finish/close；其他请求的本地连接销毁不代替 handler 收敛。旧 WS 授权和消息能力绑定监听 generation，异步授权返回后复查；排空等待旧 WS 任务及真实关闭状态。替换先完整编译 HTTP 路由、WS 路由、Origin 和未匹配路径准入，再一次发布；未确认排空、未替换或监听器终止关闭时不能恢复准入。Platform 仅持有这些传输事实，不处理备份、业务停机或模块初始化。

System 的导入 Service 已消费维护能力。Bootstrap 同时暂停外部 public 能力、HTTP/WS，排空真实请求和旧模块 owner；导入入口不进入 Operations 的全请求占位，System 只关闭状态/诊断 owner，保留当前 Backups 任务，避免自等待。旧实例退出后，重新执行模块安装，重新绑定事件、事务身份、HTTP/WS 和配置消费者；BackendApplication 的稳定能力树在每次调用时解析当前实例，缓存方法或子能力也不会继续调用旧实例。旧 Backups 在维护任务之外完成最终关闭；排空、重建或提交结果不明时保持停止准入。

导入由 System BackupService 持有完整管理员身份、单名额及期限，BackupModel 解封并取得技术 SnapshotCollector.prepareImport 的一次性候选资源，interfaces/http 严格解码实际 multipart。Adapter 严格核对最新 compact JSON、精确签名/表列/标量、owner 声明的目标分区及完整文件引用；各模块 Adapter 将传递秘密用目标 SecretBox 重新保护，通知嵌套 JSON 沿用原持久 decoder。模块原解码器与窄 `SqlReader` 回调分别检查记录和关联事实，Platform 不持有产品字段或应用类型；Targets 通过 Model 转换回调复用跳板规则，整批只构建一次图；Agent 核对实际内置定义、签名插件 manifest、App/治理/Run 冻结输入和子任务。候选数据装入独立内存 SQLite Worker：DDL 只来自当前目标 schema，目标认证/明确排除的记录仅复制到隔离库，先按目标 DDL 拒绝 INTEGER/TEXT 类型强制转换及必填/主键空值，再执行真实 UNIQUE/CHECK/FK 并调用模块原跨表读取。内置终端主题与无用户的系统审计明确允许 null 用户分区，其余个人记录必须匹配目标管理员。预检不修改当前库或内容目录，结束等待隔离 Worker 关闭；一次性候选持有校验后的行与文件字节，提交或关闭时清空；输入损坏、目标资源不可用、清理未确认分别映射。该内存候选库不是持久恢复 staging；实际 commit 在维护排空后再次按当前目标认证和 schema 复验。Run/步骤沿用原恢复校验，并核对 Run/Tool 历史与当前状态、步骤正文/usage 计数；校验不能冒充实机恢复验收。

### 8. 当前能力与验收

B8 已接入 Preferences themes/appearance 的主题、设置和图片链路，以及System加密导出。导出单名额包括输入producer、密码证明、采集/封装与HTTP finish；120秒总期限和关闭/断连取消由原owner持有，文件清理未确认拒绝新准入并在close汇总。NXSEALED2采用随机数据密钥、PBKDF2-SHA256密码包、可选实例密钥包及AES-256-GCM完整头部认证。实际 multipart 导入已接线到预检、全应用维护、持久 staging/journal、同事务 marker、启动对账和新实例重建/重绑。该链与 B8 整批源码复审已收口，静态证据归 testing；B10 行为仍待验收。themes 包含 403 个实际 preset、22 个颜色字段、严格导入/导出和用户 CAS；活动引用清空与外观版本同事务。appearance 首次认证 GET 在事务内创建 version=1 默认，已存在记录不会重新填默认；PUT 为明确 patch/CAS，图片字段只读。协议图片 URL 在 interfaces 从内部 opaque ID 构造；UI 线格式保留 JSON 字符串，HTTP mapper 转换到应用 UI 变量对象，Model 逐项复制独立存储对象，SQLite Adapter 解码嵌套持久 JSON；Service 不解析线格式或持久 JSON。外观写入 producer 同样在应用名额取得后读取完整输入。HTTP 输入与交付边界将协议拒绝、认证失败和取消转换为所属应用失败，再进入 Service 的任务观察；存储、清理及提交未知仍保留具名原因，期限取消不覆盖已分类失败。HTML 来源写入调用 AppearanceService 时，输入回调使用 Appearance 失败契约，返回后再转换为 HTML 失败契约。

BackgroundService 共用 16 个串行在途任务，输入 producer 返回应用命令，不带 HTTP 对象；名额覆盖 multipart 消费、等待、SQL/文件发布、交付与清理，shutdown 取消 producer/读取并等待实际任务。BackgroundModel 转换独立存储事实、内容格式证据和 Blob 应用能力/失败。Adapter 负责 pending→ready/retired 和引用/版本同事务；清理只有在同事务确认无引用后开始，文件删除确认后删除元数据。启动/后续上传/停机复查无引用记录；清理失败保留有界原因、持久记录及 cleanupPending，不删除活跃内容。文件根由 Bootstrap 安装 NativeBlobStore(db.path+'.appearance')；不在 Service/register 拼技术路径。只维护最新初始 v1 签名。

Shared 的实际预算与入口见 USAGE；字体、颜色、图片基础值/容量单独放 values，私有主题数/存储记录数/在途数归纯规则或 Service。正常失败、存储 unknown、内容发布 unknown、响应交付 unknown 分别在真实边界保留因果，不在 unknown 后自动激活 pending 或重传。HTTP 图片有完整期限、流回压、同源/no-store/CSP，旧图片不再暴露。静态和两轮源码复审证据归 testing；集成、插件 Agent host/runtime 和备份恢复源码已收口，行为统一 B10。B7 原执行链不重建。

实现后维护 USAGE 对应外观、Agent Plugin/MCP/Browser/ACP、备份章节，并记录 F1 完整契约/状态/错误/恢复差异；正式前端尚未施工。完整两轮源码审核与最终静态检查分别记录，行为统一 B10；不把旧正式消费者或旧测试 PASS 当作新后端完成。

HTML 库保持在 appearance 子功能：service/html-theme-service 管理来源/准入/覆盖政策，model/html-theme-model 转换应用、独立 storage 和目录结果；adapters/sqlite 管理文本/修订，adapters/github 解码厂商目录。17 个真实 preset 作为应用常量，无运行时旧 Backend/CWD 依赖。自定义内容与用户级修订表同事务，删除也推进修订，避免按名称删除重建后的旧 CAS 命中。列表只读摘要，不加载全部 HTML 正文；活动 HTML 内容副本独立保存。全产品备份必须包含 preferences_html_themes 和 preferences_html_revisions，而非继续寻找旧 custom_html_theme 文件目录。

远端来源写入经原 AppearanceService CAS，只维护一份 URL/版本。目录查询冻结当前来源，在异步读取后复查原版本；显式 repoUrl 不借用保存源。网络读取经 Model→独立 HtmlThemeCatalog→Github Adapter→Platform BoundedFetch，Platform 不含 GitHub/主题类型或业务 host 策略；应用期限、主机/来源/容量政策留 Preferences。上游增量预算、redirect:error、严格 UTF-8/目录解码、取消/reader 收尾各自确认，技术失败在 Model 映射。ImageInspector 同样只提供格式/hash/字节技术事实，应用 Model 转为 Shared MIME；SVG 签名扫描不执行 XML。Background/HTML 资源释放未确认时停止所属 owner 准入，有界保留因果，不能用任务结束冒充资源已释放。

### B8 集成与插件当前接线边界

签名 Skills 使用 plugins/model/plugin-skill-types、plugin-skill-rules 和 PluginModel 的 packageSource/skillDocuments。包 Adapter 解码已签名内容，Model 严格 UTF-8 转换，纯规则校验 skills/<name>/SKILL.md 路径与有限 frontmatter；最多64份、每份12KiB。验证安装与备份候选复用同一规则。原 ToolService 提供 skill_search/skill_read，按 context.read、原账本/当前 App/安装修订授权，读取绑定精确版本和 SHA-256；不自动注入包提示，不接受 allowed-tools 授权。文档是后端内部应用对象，无独立双端 DTO。Run 读取独立执行并由 PluginService 的 pending/期限/关闭统一追踪，不排在会等待 Run 的管理队列之后；交付前复核安装修订、当前信任和治理权限。

Agent integrations有独立IntegrationService/BrowserService；HTTP mapper→应用类型，Model→独立Storage或MCP/Browser技术能力，SQLite只持有存储类型和DDL/SQL/持久JSON解码。MCP/CDP Adapter不认识App/Run/授权；MCP通用endpoint包含不透明key/generation，Browser只接受技术连接选项和应用提供的URL判定能力。真实调用进入原ToolService；Browser的Run资源由原drainRun关闭，MCP续接身份由应用owner生成并绑定原Run/输入，不直接消费远端token作为授权。

插件已接 Publisher/Artifact stage/verify/install、不可变版本、安装查询、Run 退役及前端资源读取。Service owns 信任、容量、安装/升级/卸载准入；Model 转换应用、独立 Storage、包/Blob 内容和失败；Adapter 解码 manifest/签名 files，仓库Adapter将PEM的CRLF规范为LF后再交付应用，官方固定公钥核对不受等价换行影响；Platform packages 只提供惰性 TAR/Ed25519 技术能力。包条目与整个展开 TAR（包括元数据/填充）都受限。Stage 登记→Blob 发布→身份/CAS 复验→staged 分别确认；启动按完整大小/hash 对账 staging，不重放安装。专用目录为数据库路径加 `.plugins`。

插件 SQLite 通过注册的 Scope 存储任务参加同一事务，实际 App/声明 SQL 仍归 Scope Adapter；不 import Scope Model/Service，不自动授予 grants。首次安装禁用 App、空授权；版本/hash/声明来源不可变，builtin 初始化只更新 builtin。当前用户安装与 publisher 信任在 Scope 读取/授权事务核对。撤销、升级和卸载由 Scope 任务禁用/围栏旧 Run，Plugin Service 等待对应 Execution owner；draining 任务持久保存，重启不重放。取消退役保持旧版本与禁用状态。

前端资源使用与会话/安装 revision 绑定的短期 grant 路径；Service owns 名额及交付，Model 复验存活安装、包 hash/签名并转换字节，interfaces owns MIME/CSP/no-store/stream。只交付 frontend/ 命名空间，backend/ 与签名元文件不可读；匿名资源请求仍通过 grant 和原会话事务复查。独立插件数据具有明确model/storage对象；Model逐字段转换，Adapter解码JSON和事务事实，Service判断身份、当前信任/启用、CAS与总容量。数据墓碑不复用旧版本；操作结果持久，当前授权与内容一致后才返回重放。removed安装的明确清除只清正文，推进安装修订/数据墓碑并退役账本正文，保留旧意图摘要，原清除结果可重放。安装状态基础取值引用Shared，应用与存储对象独立；Stage/Publisher/Installation在Adapter校验身份、容量、时间及状态与验证字段的关联。单调版本耗尽在写入前拒绝，覆盖配置、凭据、安装、退役、清除及迁移，读取和既有确定回执不因此失效。

有限SDK/data RPC通过Shared agent/plugins/events与rpc-codec消费唯一协议，实际浏览器SDK归plugins/adapters/frontend；Shared不持有窗口/通道/计时器。SDK交付限定完整纯模块依赖图，浏览器import与已安装SDK路径显式链接；不公开任意Shared文件。HTTP先认证，Service取得名额后调用输入producer，模块mapper转内部方法；事务内复核grant期限/原安装修订/会话。HTTP输入producer与输出consumer区分预期拒绝/取消和基础故障，畸形输入与断连不停止全模块；Blob读取消是独立技术类别，Model转换且清理失败不被取消覆盖。HTTP把成功或安全失败关联到nonce/id/seq；响应失败不自动换operationId。原子写/重放/明确清除只在SQLite Adapter，资源交付名额覆盖实际stream及晚到清理；普通RPC结果交付归HTTP owner，断流仍可能是未知写入。

MCP owner统一计入已建立/建立中/关闭未确认资源，共享连接构造并取消、等待原构造；close绑定具体实例，不按当前key误关新实例。每连接仅一个固定DNS池，关闭等待池构造并执行SDK与池独立清理。Browser页面/节点按键保留组合键与原合法Key/Digit词汇，失败释放按键，聚焦前就失效旧快照。动作settleMs由工具Service选择默认250ms与Shared的0–2000ms协议范围，Model逐字段传为通用技术等待值，Node CDP Adapter执行有界空闲观察，只吸收正常TimeoutError；断开/取消仍传播。scroll的deltaX可省略为0；Shared动作取值覆盖全部15项。

两端SDK、实例持久恢复、仓库/推荐、显式迁移和备份导入恢复已有源码；B8源码审核已收口。B10已验证真实签名包暂存/信任/验证/安装、独立子进程及包内依赖、Host数据CAS/幂等/墓碑、禁用/启用/正常重启、显式完整快照迁移/升级、撤销/卸载/清除，以及descriptor资源和有限HTTP RPC；原进程身份退出与物化目录清理分别核对。外观字体/CSS/HTML副本、PNG/SVG字节、HTML中文路径/同名重建/预置回退和活动终端主题删除引用也有有限整链证据；B10另已验证真实Chromium的签名sandbox/完整SDK依赖/MessagePort握手、关联失败后的写入unknown、32项等待、8订阅/回调失败收敛，以及HTTP intents创建/幂等/权限撤销/重启、140失效候选后的可见列表、100条发送容量、实际附件/Range与前端RPC分段；父页是隔离测试桥，不代表F1。B10另已验证环回仓库配置/目录/签名下载安装、固定官方公钥和兼容推荐/离线已安装查询，以及真实子进程九方法的消息/附件/撤权链；官方新包完整安装、自然到期、已在途SDK/RPC撤权、其余崩溃与完整容量故障仍待验，不能据此宣称B8或B10整体验收完成。只有最新初始v1，当前精确签名为backend-next-v1-initial-20261015-b9-mutation-evidence。

Browser 补齐 back/scroll/press/select/wait 和 Artifact 字节消费：Service owns 端点顺序/退避资格、会话范围、操作期限及输出 Artifact；Model 转换独立应用能力和技术动作/字节/失败，技术 DOM/CDP 对象不泄露。会话交付在最后异步阶段后复查原 Run 与取消；快照采集及节点解析后复查原快照身份，节点对象由统一 finally 释放并保留操作与清理两项因果。Artifact 读取保护覆盖实际上传，版本/hash/原工具权限复查；截图/下载经原 Artifact 发布，而非大 base64 工具结果。下载策略限定本次 context，context、拦截任务、WebSocket 关闭分别确认。管理和执行共用同一配置 owner，正式前端 F1 未施工。

Integration 创建意图同事务保存首次安全回执，重放不从当前可变对象读取，删除集成不删除原回执；独立 storage receipt 无凭据正文，Model 显式转换，备份复用其 Adapter 解码器。Integration 原行/回执解码同时核对 MCP 的规范端点及私有 authority、ACP argv/cwd、身份/版本/hash/时间与 Shared 基础容量；不依赖 Shared 业务 codec。Browser 存储解码同时验证端点/明文许可/页面模式/数量和唯一性，恢复不放宽配置语义。

MCP 模型 discovery 直接消费真实 App 配置和目录，返回安全 ID/version/schemaHash，不要求人先刷新；目录选择/资格与 hash 一致性政策归 Service，Model 转换技术目录及哈希事实。管理页保存的 schemaHash 是观察值；调用必须与实际重取目录一致。input_required 的本地身份继续绑定原 Run/输入，不能重放未知副作用。Service 将128项待续接与在途预留统一计数，派发前取得续接名额，finally释放预留；异步返回后复查取消/关闭，已派发工具不降为确定不可用。Model保留后续存储/内部失败，不能将未知提交改写为可结算的远端执行未知；管理刷新在真实写事务的准入回调复查取消。关闭只由原任务观察者记录一次失败，远端结果未知与资源清理失败分别判定。MCP 客户端名称/产品版本由 Agent 安装传入通用技术契约，Platform 不硬编码产品身份。保存配置的 ACP 执行与直接 ACP 执行使用一致的 destructive 审批风险。AcpPermissionService 的准入和 Runs Adapter 的父关系复查同时识别两种真实父工具名，内层操作仍绑定原父 id/hash/target/version/modelStep；Child 使用冻结 profile 中获准的父入口，不额外授予直接执行工具。每项内层许可独立审批及消费，外层批准不能代替。幂等创建先认证/核对原意图，再仅对新记录检查容量。

当前B10已验证MCP实际SDK/HTTP的固定协议发现、工具/资源/提示词及独立续接、目录变化与断流/取消；ACP实际SSH上的直接/保存入口、仅允许保存入口的Child、独立内层批准/拒绝及取消；Browser实际CDP上的导航/快照/console/截图元数据、一次点击与旧快照/错Run拒绝、原context释放。外部Provider与MCP/ACP端点输出脚本化，真实资源/授权/存储不被替代；截图现已下载核对实际PNG字节/长度/hash并由浏览器解码；B10另已验证128个pending MCP真实握手的准入/同key共享与全局排空、SDK/dispatcher单或双清理失败；实际CDP的context/page/configuration构造取消、单次context关闭、操作与清理因果、按键释放和截图预检、握手中断。应用owner另已验证128续接预约、16任务准入/排空、刷新等待真实SQLite事务期间取消，以及ACP/Job在途权限监控的等待和失败因果；这些受控接缝证据不代替全部SDK/SSH与治理存储集成交错。其余动作、配额/期限、撤权和关闭故障全集仍待验，不能扩大为集成或B10整体通过。

### Artifact 在途交付边界

普通Artifact HTTP及跨App intent HTTP均由原ArtifactService.readGranted持有实际lease，ArtifactModel转换Blob能力/失败，NativeBlobStore以finally关闭原文件句柄；HTTP pipeline持有响应断开/整体期限的取消信号。每块和流结束前核对当前授权及原文件版本，不对已写入传输缓冲或已交付字节承诺撤回。意图可见性归PluginIntentService，失去可见性不删除原持久grant；未撤销且未到期的grant保守保护源文件，发送者显式撤销同事务解除保护，实际读取lease独立收尾。

B10有限回归已用真实16MiB内容、暂停HTTP消费者和Linux原blob文件句柄确认在途，覆盖断连/注销/停机、版本变化、双方授权/禁用、回执撤销与准备升级；旧回执不复活，新会话/受控重启可重新读取仍有效回执。删除成功保留deleted墓碑，content拒绝读取。应用级HTTP RPC和真实后端SDK另以Linux内核确认原Blob open已派发后，验证双方grant、回执撤销、启停和旧实例升级排空；每次失败均不输出部分字节。Artifact授权绑定原文件版本，版本变化使原grant不可读，需新回执；重新授予App权限也不复活原回执。HTTP会话注销和后台实例授权分别处理，后者继续复查自身安装/当前授权。范围仅上述分段读取链，不代表全部方法、副作用未知、自然期限、混合清理或数据库未知确认通过；无新Platform业务类型、DTO、迁移或注册出口。

### B8 有限后端运行时与仓库接线

PluginRuntimeService持有实例、共享构造和host任务；PluginService保留管理/资源/data用例，plugin-rules持有两者共用的信任与数据CAS/配额政策。Scope启用回调进入runtime.reconcile，禁用/撤权同时取消Run与runtime；升级/卸载独立启动 Run 和 runtime 排空，一项失败不跳过另一项，全部确认后才能继续；取消退役保留禁用状态。最多32实例/2构造，每实例最多32个IPC host等待；Runtime的32项pending预算属于生命周期任务，不是全局host共享额度。实例额度在异步持久预留前同步占位，成功绑定owner后交接计数；已绑定owner仍等真实关闭确认后释放，避免31实例时两构造同时取得最后一个名额。原构造包含包读取，单个等待者取消不终止共用构造，关闭保存共享Promise并等待开机、进程退出和host任务，未确认清理不释放占位。Platform以exited Promise通知实际进程退出，正常退出与异常失败分别表达，Model转为应用失败；PluginRuntimeService观察原实例并围栏、取消读取、启动原实例关闭，观察回调不等待自身触发的关闭Promise。仅在close已确认时等待退出观察，关闭失败不追加无期限退出等待；资源清理与实际退出分别确认。持久观察和启动进程/目录对账已接线，规则见下方运行实例恢复边界。

PluginModel将原包/存储事实、九个host方法和失败显式转换；plugins/storage/plugin-runtime定义独立协议任务，plugins/adapters/runtime是Shared SDK/IPC投影owner。Platform isolation仅有文件/hash、opaque contextJson/host回调与通用activate/health/quiesce/close，不定义App/manifest/授权。Node Adapter生成独立进程、清理宿主环境、使用Nodepermission与只读文件授权；禁子进程/Worker/addons、控制V8堆，未声明OS或网络隔离。Shared backend-sdk仅是纯类型，真正进程、timer、pipe与临时文件留Platform。NodeModuleInstance的首次故障闸门与后续失败账本分别持有：首个故障阻止新交付，后续独立失败由原host/write观察器登记，保留最近16个样本及溢出计数；排空等待观察器收敛后读取一次，不从allSettled再次重复收集。同一写入拒绝先归一为具名技术失败再传播，已派发host的技术拒绝仍为execution_unknown；后续异常按弱身份去重，避免write/host重复登记或强引用无限异常。已有故障触发进程终止后的close通知不再生成无独立原因的第二个故障。实际进程退出与host任务/目录清理分别确认，旧owner收口不影响替换实例。Linux /proc身份和命令探测仅将ENOENT/ESRCH视为进程消失；命令读取失败仍复查原出生身份，普通日志文件、权限和其他读取失败继续上报。当前已接host.appInfo/data/intents及Artifact分段读取；前端Agent协作能力走WorkspaceService并调用原Scope/Thread/Run/Provider/Context/Governance，后端仍限定九方法；不建立新的执行或审批中心。

PluginRepositoryService持有用户源、版本兼容/官方固定发布者、选择及推荐安装政策；所有源读写和目录/下载操作共用串行lane，防同一用户配置在下载中被替换。Model转换独立repositoryStorage/目录/内容与失败，Adapter负责持久JSON、上游JSON/相对URL/字节hash；平台BoundedFetch只执行调用方明确的有界redirect政策和响应体清理，默认仍不follow，不认识官方或Plugin。读取失败后cancel若重抛同一原错误，保留原读取失败；仅独立cancel/release异常归cleanup_failed，不将普通上游断流升级为模块排空故障。目录/下载继续进入原PluginService.stagePackage→Model→包/Blob/SQL，实际签名与请求App/version/publisher匹配先于stage副作用；安装不自动启用或授grant，已撤销官方信任不能重新登记。

repositories是单一v1的最新表，读取未保存状态明确version=0，CAS/身份同事务。Bootstrap经通用包metadata Adapter按模块相对URL读取实际根package.json，并安装productVersion；不硬编码版本、依赖CWD或让Platform选择兼容政策。管理HTTP和Shared repository-{model,http,http-codec}已接真实消费者，正式前端仍F1。Repository Service同一lane串行目录/暂存和配置写入，不能把排队更新描述为已在读取中生效；SQL身份/CAS复查归原Adapter，Model显式转换。仓库stage在返回前执行真实包检查/信任验证，成功为verified；Artifact stage仍显式verify。B10有限行为覆盖环回源、严格目录/兼容性、下载hash/身份/撤销信任及注销后晚结果、推荐离线读取和子进程九方法；官方新包/自然期限及其余未验限制归testing；已在途SDK/RPC附件读取的有限验证见上节，不扩为全部插件操作。B10另验证8任务准入/溢出不派发/结算回收、包下载断流后可继续、下载中注销拒绝晚发布和关闭中止原网络读取。PluginService管理lane内的撤销排在当前stagePackage后生效，不声称即时撤销下载。仓库协议、官方推荐、SDK/生命周期差异见USAGE与F-R35；最新签名见上文，源审/静态/待验分别归testing。

### B8 运行实例持久恢复当前边界

运行时实例先持久登记opening，再创建进程，成功激活/health及权限复查后登记active；关闭确认登记closed，执行/清理未知登记unknown。实例身份与安装revision分离，启动先对账db.path+'.modules'的私有物化目录：Linux /proc birth identity、原worker路径及原父进程均核对，活父进程、缺失spawn身份、畸形目录或未确认退出/清理均阻止开放服务；不能只凭PID杀进程。owner/spawn/process journal和目录创建/删除做fsync。启动将上次opening/active围栏为unknown并跳过，不自动重放activate或旧任务。查询/确认归PluginService→Model→Storage→SQLite，通用Platform不持有App/用户类型。

管理员GET /api/v1/agent/plugins/installations/:appId/runtime查询当前实例，GET /runtime/:instanceId查询该App历史实例；时间为毫秒。POST /runtime/acknowledge严格输入{expectedRevision,instanceRevision,instanceId,confirmed:true}：expectedRevision为当前安装修订，instanceRevision为原实例修订，不能借用一份版本。只有本地无绑定构造/实例、持久状态unknown或同实例已closed时允许，认证与安装CAS在实际事务复核；确认只解除围栏，不启动模块，不声称旧外部效果已回滚。保留unknownAt/acknowledgedAt及原实例历史，新实例不能覆盖旧未知证据。升级/卸载遇未知实例仍保持draining，确认后以当前安装修订继续原操作；运行中未知owner须先完成服务重启与目录对账，不靠确认跳过实际清理。B10已验证原child被SIGKILL后的unknown、失败关闭因果、重启不自动激活、原实例/当前安装修订确认及幂等、显式重新启用与历史隔离；quiesce内调用在worker边界拒绝，不代替已在途host RPC/流中撤权验收。历史每用户最多4096条，达到上限拒绝新构造，不静默删除；实际host数据写入在异步查询/写入后、提交前再次复查原实例与当前授权。

Access已经提供窄provePassword公开能力，内部PasswordProof归authentication/model，CredentialConfirmation归accounts/storage；账户hash和原会话digest在实际事务执行时复核，技术失败在Model转换、公开失败在Access出口转换。System backups导出已消费该证明，并在采集和交付前复验；导入仅要求当前完整管理员会话，password 是备份解封密码，不复用导出的当前登录密码证明；维护后再次核对原会话，认证表不恢复。B10已验证跨实例不同密钥下Artifact字节、SSH私钥和Provider凭据真实消费及重建，目标密码/当前会话不被源认证覆盖；上传中断名额释放、待上传时登出拒绝及实际文件hash损坏拒绝均有回归，未知提交与完整文件类型/故障仍待验。

已有实例unknown拒绝新的构造/退役以AgentResourceFenced表达，公开仍为operation_unknown；它是未派发的新准入拒绝，不触发其他App的故障停机。复合排空由Agent错误owner的aggregateAgentFailures保留类别：全部子项只是已有围栏拒绝时继续为AgentResourceFenced，包含真实关闭/提交失败时仍为故障并保留全部cause。PluginService的卸载/发布者撤销及Runtime撤销共用该转换；不以通用operation_unknown包装抹去已有围栏的类别。B10已验证32实例/2构造边界、同App共用构造、批量撤销中的独立quiesce/dispose失败与健康实例收尾，以及卸载unknown重启→旧围栏拒绝→明确确认→继续卸载；目录清理失败/数据库确认未知仍分别待验。新存储提交未知、实际进程/host/清理失败仍保留真实故障并停止所属owner准入，二者不能混淆。

### 原生 Agent 工作区会话入口

1. **职责与范围**：Scope 的 WorkspaceService 复用原 Scope/Thread/Provider/Run/Context/Governance 用例，供原生会话与插件入口调用。插件 owner 仅持有插件安装与短期 grant 授权，通用工作区不反向依赖插件私有应用类型。
2. **子功能与目录**：scope/model/workspace-types 持内部命令/结果，scope/service/workspace-service 持用例派发；ThreadService/Model/SQLite 持当前入场事实、转换及实际事务。interfaces/http/workspace-http 与 workspace-mapper 持原生协议及唯一双向白名单。
3. **依赖方向**：原生 HTTP → Scope Workspace/Thread → 各真实能力 owner；插件 RPC → 原插件授权 → 同一 Scope Workspace。Platform 仅提供事务与准入机制；不包含 App 或 grant 类型。
4. **类型与转换**：Shared scope/workspace-http 与 workspace-http-codec 唯一定义通用17方法及严格解码；插件 frontend-events 组合该联合与自身九方法，不复制定义。ThreadAccess/事实使用 plugin/session 可辨识联合；原生使用真实 App version，不填写 installed/trusted 或虚构 grant。
5. **入口与安装**：POST /api/v1/agent/apps/:appId/workspace 要求当前完整管理员会话、真实 App UUID、appVersion 和 request。register 安装事务身份读取及原生路由；插件继续走原 descriptor/grant 入口。正式Host与DEV原生线程／运行消费者均使用该入口，正式Host不借用插件grant。
6. **数据、事务与并发**：原生当前会话、App 所属用户、启用/受信声明及原 App version 在实际事务前后核对；Thread 变更仍使用原线程 version、稳定 operationId 与不可变回执。组合调用经 ThreadModel 的事务准入能力消费同一规则，不在接口层复制 SQL 或业务判断；后台执行仍由原 Run owner 明确脱离临时请求准入并持续复验自身授权。
7. **生命周期与失败**：Scope 入口和交付前保留当前事实复查；已成功写入后交付或复查失败返回 operation_unknown。读操作不授予执行权限；读列表不证明未知写入未提交。完整工作区编码预算8 MiB+1 KiB，Thread 列表最多50项，正文页遵守各自更窄预算。资源已销毁时不继续接纳新的请求步骤。
8. **当前能力与验收**：原生17方法生产者及Shared、正式Host/Run/正文/审批/Child和独立应用转换已接线，步骤／工具审计继续消费各自只读HTTP。D17 当前只做静态检查，原生授权竞争、幂等/冲突及未知结果行为留最终远程 Actions E2E。

### B8 前端SDK与显式迁移当前边界

ThreadService持有名称归一、线程/意图容量及明确区分的插件/原生会话准入；ThreadModel持有应用/Storage转换，Thread SQL持有keyset、CAS和不可变原结果。普通HTTP创建也在同一存储事务消费同一线程容量。线程存储→应用转换唯一归scope/model/thread-mapper，协议投影唯一归interfaces/http/scope-mapper。新Thread具有必填version/updatedAt。Provider可选模型的protocol来自实际resolve结果，不由配置缺省推测。

WorkspaceService使用原RunService与ContextHistoryService：Root列表按thread_sequence续页；entries只读Root用户输入和模型文字事件，按码点分片，不读工具/私有reasoning。SQLite技术函数nexus_text_length/slice保留NUL和Unicode；片段未完不推进后项。appendInput在原Root终态/version同事务校验后创建同Thread后续Root，原身份/version纳入幂等hash，模型/连接重新显式选择，不注入活跃上下文。

前端RPC由Shared frontend-events/frontend-rpc-codec定义26方法；core events/rpc-codec/backend-sdk仍只有九方法。前端完整预算8MiB+1KiB，descriptor的maxMessageBytes同源声明；核心子预算/IPC仍512KiB。SDK交付依赖图按白名单安装。frontend-sdk仅持有纯类型，窗口/MessagePort/计时器归原Frontend Adapter；Run订阅是500ms有限轮询原事件分页，不是新增WS/事件中心。退订取消原读取并等待，close共享Promise，异步回调由原订阅追踪，过期结果不发布。正式父页F1。

组合写入经PluginModel→Storage→SQLite技术admission scope，在实际事务前后复核原会话、安装revision、启用、publisher与期限。排队操作捕获原scope；原RunExecutionOwner通过RunModel的应用任务能力明确脱离请求临时scope，再按自身持久权限执行，不意外继承浏览器grant的生命周期。最终响应前再次复查，已提交变更失去确认时返回unknown，不换意图重发。

插件迁移从旧可执行migrate回调改为管理员显式快照转换：prepare-upgrade排空并停在draining→读取snapshot→提交含全部键/版本的完整数据集→原目标upgrade。政策、配额及取消退役限制归PluginService，Model转换及指纹，Adapter同事务核对快照版本、写数据/墓碑、推进安装revision并记录不可变migration回执。retirements.base_revision区分迁移前后；迁移已提交不允许取消退役。未知数据库提交不重跑转换或插件代码，重启保留draining。1024键/8MiB正文/52MiB完整线预算，32个迁移意图；R1/R2 全应用备份已接线，整批审核与行为验收分别执行。

### B8 在线恢复持久边界

NativeSnapshotRestoreFiles 只处理已安装的 opaque 根、暂存文件、目录切换日志及清理；SqliteSnapshotRestore 只处理技术表恢复和提交证据。所有真实 SQL/DDL 仍在 Adapter；只有一个最新初始 v1，snapshot_restore_state 是本机技术事实，排除于可携备份。87张产品表不包含认证、模型目录缓存或恢复标记。Preferences 预检除引用存在外，核对活动主题的用户或内置归属、背景的用户/用途/ready 状态；批量索引避免逐条扫描全集。

文件及日志写入同步后才发布；日志在每次 rename 前保存意图，rename 后同步相关目录。删除按目标 schema 的 FK 依赖先子后父，插入使用延迟 FK；恢复数据和 restore_id/initialized 标记在同一事务提交，SQLite 明确使用 FULL 同步。提交失败后读取标记，不能用异常或断连推断回滚；标记不可读时保留现场并停止准入。仅旧内容清理失败、而当前数据与文件已确认一致时，可返回 cleanupPending 并由日志在后续启动/导入前继续清理。

B10 已在真实文件/SQLite Adapter 上验证暂存、完整发布、未提交事务、提交后及清理后 SIGKILL：按持久标记恢复三类根，无旧目录也可对账，重复恢复不改变结果；真实应用启动已验证暂存和发布后未提交的恢复。日志畸形、超限、未知/重复根及符号链接拒绝恢复；标记查询失败保留现场。另已验证有/无旧根的publish内部rename前后SIGKILL，以及未提交回滚/已提交清理再次遭文件系统拒绝后按原journal幂等恢复。已补验实际 COMMIT 完成但调用方未获确认即 SIGKILL、恢复过程中再次 SIGKILL，以及在线导入已提交而 owner 重建失败后的重启初始化。断电或持久介质故障仍未验，不能替代全产品恢复验收；逐项证据归testing。

启动先初始化当前 schema、对账恢复日志，再安装模块，防止模块先创建内容目录或读到混合状态。初始化未完成的提交保留 initialized=0，重启继续恢复初始化；新模块及传输入口准备成功后才确认初始化完成。恢复初始化不派发历史通知：queued 结算 failed、dispatched 保留 unknown，旧审计记录登记为已完成 fanout；不自动启动导入的插件 runtime。Run 未派发任务（包括没有模型步骤的 pending Root）结算失败，已派发保留 unknown，Tool/Job/远端占用沿用各自重启围栏；不接管进程或重放付费调用。

POST /api/v1/settings/backup/import 保留 backupFile/password 字段，响应只包含 restoredTables/restoredRows/restoredFiles/cleanupPending；完整契约和 codec 归 Shared。正式前端差异归 F-R36，源码实现与运行行为分别验收。

### B8 路由与恢复校验边界

HTML 主题内容的 GET/PUT/DELETE 显式声明 segment 路径参数与255字节解码预算，认证/审计包装保留元数据。Platform 只拒绝通用分隔符、控制字符与点路径，Shared/Preferences 持有 .html 名称业务规则，支持中文和空格。

Preferences 备份校验在 Adapter 解码 StoredAppearance 后调用同步存储契约回调，register 经原 Model 的 fromStoredAppearance 转换后复用纯 validateAppearance；字体、窗口颜色、UI 变量及 GitHub 来源规则用于导出与候选恢复。Adapter 不引用应用类型或规则，引用归属/文件事实仍由存储校验。默认 UI 纯数据位于 appearance/default-ui-theme.ts，不放在 Service 目录。

## B9 共用机器突变围栏恢复

### 1. 职责与范围

Remote machines 持有普通 Files/Docker 与 Agent 远程突变共用的持久资源围栏。原 claim 不能表达恢复证据；新设计保留原操作身份和目标快照、阻断事实及不可变人工核对记录，解除围栏只允许后续新操作，不改变原 Tool/Job/Run 的 unknown 或触发重放。Plugin runtime 的实例核对继续归原 Plugin owner，不合并为通用恢复中心。

### 2. 子功能与目录

沿用 machines 的 mutation-service/model/storage/sqlite；恢复用例放 machines/service/mutation-recovery-service，协议放 remote/interfaces/http/mutation-http 与 mutation-mapper。共用状态/结果/容量在 Shared remote/mutations；内部对象归 machines/model/mutation-types，存储对象归 mutation-storage，持久解码归 mutation-row。

### 3. 依赖方向

HTTP → RecoveryService → MutationModel → 独立 MutationStorage → SQLite。Service 消费 Access/Operations 窄 public；Access 的事务身份 reader 通过 register 安装到 Adapter，不在 Model/Service 直接查会话表，不让 Adapter 引用应用类型。运行准入和人工恢复复用同一数据库围栏。

### 4. 类型与转换

Shared 仅定义安全观察、明确证据写命令/释放命令、完整响应与错误。HTTP mapper 与 Model 分别双向白名单；资源摘要和本地 owner 实例 ID 不公开，目标仅含 ID/原配置指纹。人工证据明确 source=administrator，不冒充自动探测，禁止在 note 放秘密或命令正文。

### 5. 入口与安装

管理员入口 /api/v1/remote/mutations：GET 分页和 /:id 只读；POST /:id/evidence 记录核对；POST /:id/release 显式解除。完整会话与管理员身份在实际读取/写入事务复核，输入在 HTTP 从 unknown 严格解码。RecoveryService 在 Remote quiesce 停止准入，close 等待已受理任务及审计。

### 6. 数据、事务与并发

remote_machine_mutations 只持有活跃资源锁；新增 mutation_claims 与 mutation_evidence 两张持久表保留阻断/释放历史。正常已确认操作释放并移除临时 claim，blocked/released 证据不自动清除。最多128活跃资源、4096保留 claim、每 claim 16份证据；容量耗尽明确拒绝，不删除旧证据。记录证据、推进 claim 修订同事务，释放核对原 claim 修订与最新 evidence 身份、完整锁集并原子移除锁/保存 released。读取和恢复写入在实际事务入场及交付/提交前检查原管理员会话；末次复查失败回滚本次写入。会话摘要的同步技术失败同样在Model转换。只修改初始 v1，无旧库兼容。

### 7. 生命周期与失败

当前 Remote owner 产生的未确认资源不能在同实例被人工释放；owner ID 不同仅允许进入人工核对路径，不证明旧生产者退出或远端停止。管理员须从独立只读检查确认原生产者停止、远端效果（已应用/未应用/部分应用）及关联资源停止，记录时间和说明；仍无法确认则保持围栏。证据记录与解除为两个动作，任一网络/提交 unknown 先查询原记录，不重放。原 unknown 永不改写成功。释放审计通过 Operations 发布，模块内持久记录先于事件；事件失败返回 operation_unknown，暂停恢复写入并保留只读查询，原记录可查询，不猜测回滚。

### 8. 当前能力与验收

恢复子链已有源码与类型检查，B9 整体及最终静态状态见当前实施方案；行为全部留 B10。正式前端 F1 需要只读观察、人工核对和单独释放流程，不提供一键重试/自动解锁。Agent 既有 Tool/Job/Run 历史继续保留，恢复不重新启动它们。

### Targets 凭据与存储转换边界

1. **职责与范围**：Proxy、SSH Key、连接凭据的 Service 校验应用输入；Model 调用 SecretBox，把明文应用命令转为密文存储命令，秘密不进入响应。
2. **子功能与目录**：沿用各子功能 service/model/storage/adapters。共用 SQLite/SecretBox 失败转换及同步加密唯一归 targets/model/target-technical-failure；应用错误类仍独立于技术实现。
3. **依赖方向**：Service → 所属 Model → 独立 Storage/SecretBox；模块共用 Model 转换不依赖 Service、register 或公开错误映射。SQLite 不引用应用规则或应用错误。
4. **类型与转换**：内部输入唯一归各 model/*-types，删除只因 Service 提前加密而存在的密文应用命令；密文写命令只归 storage。Model 逐字段构造，Shared/公开响应不变。
5. **入口与安装**：register 只向 Model 安装 SecretBox；连接类型变更和凭据赋值的存储校验回调经 Model 投影后调用 connections/connection-rules。不新增公共能力。
6. **数据、事务与并发**：SQLite 在实际更新事务读取原类型、凭据和跳板引用，再调用规则；不把检查移到事务外。连接删除由原跳板外键 RESTRICT 保持引用保护。凭据修改在副作用前拒绝安全整数版本耗尽；目录查询应用容量只在 Service 决定。
7. **生命周期与失败**：所有 Targets 存储调用在 Model 映射具名技术失败并保留 cause；公开出口只接受应用/公开错误并安全兜底。提交或回滚未确认统一 operation_unknown，不解释为未写入；具体缺引用拒绝仍在所属 Model 转换。
8. **当前能力与验收**：秘密省略保留、显式清空、名称/版本冲突及引用保护沿用当前语义。源码复核和静态证据见 testing，事务交错/存储故障待 B10，正式前端处理未知结果待 F1。

### Targets 标签关联设计

1. **职责与范围**：Tags 拥有按标签替换/追加连接和标签删除用例；Connections 拥有关系表与连接版本。保留单连接标签替换，三个入口不相互冒充覆盖。
2. **子功能与目录**：沿用 tags 的 Service/Model/Storage/管理SQL；名称规范唯一归tags/tag-rules，管理与导入共同消费；connections/adapters/sqlite/connection-tag-sql 负责关系事务任务，契约在 connections/storage/connection-tag-storage，不新增业务中心。
3. **依赖方向**：HTTP → Tags公开入口 → TagService → TagModel → TagStorage；Tags SQLite经register安装的窄存储任务操作连接关系，不能直接引用Connections应用类型/SQL实现。
4. **类型与转换**：请求/固定成功响应/容量归Shared tags与connections；内部命令归tags/model/tag-types，存储命令独立。入口与Model分别白名单复制数组；容量事实经Model转换到纯规则，不把应用规则传给Adapter。
5. **入口与安装**：PUT /api/v1/targets/tags/:id/connections替换，POST /api/v1/targets/connections/add-tag追加；Shared严格解码，服务器完整管理员会话准入。DELETE tags/:id保留原路径并解除关联，不额外要求先手工清空。
6. **数据、事务与并发**：原事务检查标签与全部连接存在，重复ID合并，替换允许空数组；实际新增/移除关系的Connection版本同事务各推进一次。删除复用同一Connections事务任务；原单连接标签写入/导入/快照校验统一遵守64项协议容量。标签本身未修改可见字段时不虚增其版本。
7. **生命周期与失败**：请求32KiB，原始ID数组最多1000项，追加非空；缺引用整项回滚。Model保留提交unknown，HTTP返回安全码；响应或审计观察不冒充原子写入凭证，不自动重试。关联请求复用下述management事务准入：在排队后的实际事务复查原管理员会话，不保留正文后重复Access查询。
8. **当前能力与验收**：标签持久行的ID/版本、非负时间、名称UTF-8与容量由同一Adapter decoder校验；管理、导入已有标签和备份预检复用，不将坏数据重新规范化。本链源码已接线，源码/两轮复核与静态结果见实施方案及testing；正常行为/并发/故障统一B10。正式前端F1消费Shared、updated:true、容量及连接缓存刷新；不增加旧包兼容。

### Targets 管理事务准入

1. **职责与范围**：management仅持有Targets管理HTTP的管理员准入，不替代各子功能用例，不成为跨模块认证中心。Access仍拥有会话事实；可信后端public/SSH解析保留调用模块自己的授权与生命周期。
2. **子功能与目录**：新增management/service/management-service、model/management-model与management-types、storage/management-storage、adapters/sqlite/management-sql。Service持有管理员政策，Model转换token摘要/存储身份与失败，Adapter复用SqliteRuntime事务准入，不复制关系SQL或在每个业务Adapter重复会话代码。
3. **依赖方向**：Targets HTTP → ManagementService → ManagementModel → 独立ManagementStorage → SQLite技术作用域。Bootstrap经register安装Access事务身份reader，仅使用SqlExecutor/digest/用户数字的窄契约，Adapter不引用Access私有类型或应用规则。
4. **类型与转换**：HTTP从Access公开身份与原cookie逐字段构造内部ManagementActor，唯一归management/model/management-types；Model将token转digest，将独立存储身份转ManagementIdentity交Service纯校验。会话token/digest不进入Shared、公开结果或日志。既有Shared安全认证错误码复用，不增加旧消费者兼容。
5. **入口与安装**：createTargetsRoutes接收模块内ManagementService；所有Targets管理路由在初次Access认证后进入同一准入作用域。register暴露安装身份reader方法，Bootstrap先安装再交付路由；未安装明确失败，不放行。不向TargetsPublicApi增加任意回调执行接口。
6. **数据、事务与并发**：复用SqliteRuntime.withTransactionAdmission，在实际排队后的每个事务开始和提交前经Access原tx读取会话；必须仍是原管理员。管理CRUD、目录/凭据/Host Key/标签及导入逐项事务共用。会话撤销与写入按SQLite事务排序，不将整批导入合成一事务，也不将已提交项回滚；拒绝当前项后停止批次。
7. **生命周期与失败**：work在事务外、准入作用域内执行；只有存储admit是事务内同步业务判断。作用域覆盖被await的HTTP用例，结束后新发起事务不再继承，已排队事务仍携带捕获的原身份校验；不作为后续独立任务的权限。HTTP读取正文后无需重复Access查询，原会话在真实事务复查；认证/权限拒绝分别401/403，存储不可用503，提交或回滚unknown保留原语义。已经提交后的响应失败仍不能证明未写入，数据交付与会话撤销也不声称跨网络原子性。
8. **当前能力与验收**：当前31条Targets管理路由（含安全凭据GET）均使用同一准入，源码/两轮复核/静态结果见方案与testing；行为待B10。正式前端既有401/403和unknown处理在F1对接，正常业务对象不变，B10新增覆盖未安装/重复安装及作用域隔离，不添加默认绕过。Remote拥有的两条SSH测试路由仍由其原用例复查，不混入本作用域。

Targets Host Key列表HTTP与正式管理前端共同消费Shared集合上限10,000项/完整JSON16MiB，超限413 limit_exceeded且不截断。确认按host/port覆盖，移除按host/port删除，不提供指纹或版本CAS；管理前端明确提示此语义，不把读取当作写入前提保证。主机名容量唯一归Shared `targets/host-keys/values`（253 UTF-8 bytes）；HTTP codec、可信Service入口和SQLite行解码一致校验编码容量，Service另持有小写规范化及主机名准入政策。SQLite解码拒绝损坏事实，备份复用该解码器；不为旧非法记录保留兼容分支。

Targets `ssh-keys/ssh-key-rules` 唯一持有密钥名称规范化，普通管理和导入共用；`target-validation` 提供模块内文本编码/容量基础校验，秘密正文不规范化。Service和纯规则消费Shared基础容量，Model保持秘密与存储转换；SQLite的Proxy/SSH Key行解码校验正ID/版本、非负时间、有效端口及公开文本编码容量，备份复用同一行解码。独立SSH Key和导入/测试私钥统一64 KiB。旧Proxy管理可存key字段，但旧SSH resolver/传输只消费用户名/密码；新设计不保留无真实运行消费者的key字段，正式前端差异归F-R40。

Targets保存SSH解析入口同样由 `public-mappers.toStoredTargetRequest` 将Trusted请求逐字段转换为内部请求，包含可选expectedFingerprint；不能直接把public对象交给Service。SSH密文快照与未保存引用只供resolver Model实现使用，类型局部定义于该实现，不进入Service应用类型；Host Key公开确认请求直接复用Shared唯一契约，再由register白名单转内部命令。RemoteMachineModel建连后只返回独立RemoteMachineIdentity的id/fingerprint及原机器能力，不把可信解析中的明文认证、Proxy或Jump对象传给终端、Files等后继Model；完整目标仅用于本次握手转换。

Targets恢复预检通过 `registerTargetsSnapshot` 显式安装Connection与Credential两个Model转换回调。Connection回调将完整存储连接投影为应用事实，复用元数据及图规则；Credential回调复用SSH-only密钥规则，Adapter仅按索引关联读取事实并调用回调，不引入应用规则实现。凭据行解码唯一归connections/adapters/sqlite/connection-credential-sql，独立Storage联合记录由SSH解析、Desktop读取和快照复用；身份/时间/方法与秘密字段互斥均严格解码。当前连接元数据与秘密输入容量归Shared connections/values，Service使用UTF-8字节，真实SQL仍只在Adapter；恢复不自动规范化或放宽旧非法数据。

Targets每条连接的直接跳板协议容量16项归Shared，与递归深度/总展开政策分别表达；完整连接应用校验和持久行解码都检查直接集合容量。快照Adapter在秘密转为便携明文后、恢复重新加密前按Shared原始字节容量检查；加密膨胀不计为原始秘密长度，超限当前数据拒绝导出、超限备份拒绝导入，不通过截断或兼容放行。

连接元数据的持久解码唯一归 connections/adapters/sqlite/connection-sql 的 readConnectionMetadataRow，管理读取、Desktop 同次元数据/凭据查询及 SSH resolver 复用；Model 保留白名单转换，不重复存储形状校验。Proxy 导入命中既有记录也复用 readProxyRow，不能仅凭 ID 与用户名绕过持久表示校验。

代理凭据同样由proxies/storage独立StoredProxyCredential表达，SQLite唯一readProxyCredentialRow校验正ID、非负时间和非空密文，SSH解析及快照预检共同消费；无凭据行仍表达null，不把损坏行解释为没有密码。

### Remote 会话与文件资源转换边界

1. **职责与范围**：Files、独立PTY和Workspace共用技术凭据能力，各自Service持有身份、归属、期限及准入政策；凭据不进入公开结果之外的额外通道。
2. **子功能与目录**：files/model/file-model持有文件票据随机值/摘要；sessions/model/session-token-model持有会话凭据表示。Shell与History Model封装终端集成/检查点，Service不操作技术Port。
3. **依赖方向**：Service→所属Model→Platform SessionTokens/SSH/Terminal；register安装SecureSessionTokens，Platform不定义业务对象。
4. **类型与转换**：应用内摘要为不透明字符串，Model转换字节和技术异常；HTTP/WS保留逐字段映射，Docker labels保留原生CLI返回的字符串语义，不将标量展开成字符索引对象；数组及嵌套对象仍逐字段投影。Cookie及终端流控窗口引用Shared唯一取值。
5. **入口与安装**：Files/PTY开启HTTP在真实finish前保留失败撤销路径，取得资源后交付等待最多15秒，Files使用已绑定release，PTY由原SessionOwner释放；按ID的外部关闭仍认证。事件发布后重新核对PTY身份、实例及存活，失败不交付旧资源。
6. **数据、事务与并发**：本边界不新增存储；搜索限制已扫描及待遍历目录、单目录条目；列目录/递归删除的私有预算由Files Service持有，不替代Shared编码预算。
7. **生命周期与失败**：上传stage取得后如取消或资源关闭，仍执行绑定discard；无法确认远端清理保留unknown。WS退订失败继续其余清理。Workspace丢弃撤销attachment的待发输入，drain退订从活跃列表移除；退订/集成释放异常转入原owner关闭。长期清理诊断保留16个样本及总数，同一Error去重，未确认资源事实仍保留。
8. **当前能力与验收**：源码规则见H-06、E-01.1/E-05.1/E-06.3/E-08.1；行为/容量和未知结果说明见USAGE，静态与待B10场景见testing，不将源码审查作为行为通过。

### Platform 传输与观测资源边界

1. **职责与范围**：HTTP/WS、SSH/SFTP、终端渲染和ACP提供技术能力；Remote监控Service持有用户准入、采样订阅与任务归属。普通SSH与Agent复用技术能力，分别保留授权及活跃资源owner。
2. **子功能与目录**：Platform既有http、ssh/adapters/ssh2、terminal/adapters、acp/adapters持有传输实现；Remote monitoring/model转换技术事实，monitoring/service管理订阅及缓存请求。
3. **依赖方向**：Service→Model→技术契约/Adapter；Platform不引用业务类型。诊断采样汇总复用通用有界FailureSummary，不新建业务分发或兼容层。
4. **类型与转换**：ACP技术cleanup_failed在MachineAcpModel显式转为RemoteResourceCleanupFailure；操作失败与清理失败分别保留因果。SFTP路径由Adapter校验实际字符串，协议出口不推断第三方异常。
5. **入口与安装**：HTTP安装有界channel与Desktop原生WS，两者均接管socket error。HTTP传输等待由原请求aborted、响应finish/close与原socket close共同结算并退订；业务handler与资源收尾仍独立等待，不将传输中断当业务完成。Artifact HTTP将具名AbortError连同原signal交协议取消转换，应用/存储/清理失败继续保留到排空；仅signal取消不能掩盖其他错误。有界channel在实际派发排队消息时复查准入generation及关闭状态，输入队列同时考虑路由允许的文本/二进制预算。
6. **数据、事务与并发**：不新增表或迁移。SFTP复合replace共用完整操作期限，恢复/备份删除另有独立清理预算；确定目录打开拒绝不退役健康lease。
7. **生命周期与失败**：SSH Client/SFTP先请求结束，2秒后请求destroy，再最多等待2秒确认真实close；超时为清理失败，不当作关闭成功。SFTP未确认资源仍归原连接owner，晚close仅解除原实例。SFTP Adapter单独登记流的期限与取消监听清理；流错误及lease关闭均解除本地等待，即使供应商流不发close。流清理回调不替代SFTP channel关闭确认，未知临时文件仍由Files owner保留。HTTP、SSH channel及路由独立清理不被首个同步异常中断；ACP取消只执行一次并等待读写及permission任务。监控退订后的baseline清理被追踪，采样清理失败有界保留到close；日志停止准入后不新建读写owner。
8. **当前能力与验收**：保持显式mapper、Shared协议和正常功能；终端导出用线性首尾裁剪，Shell setup按完整marker预算校验，异步返回复查存活。源码/静态与行为证据归testing；SFTP上传中断与实际句柄收尾已有B10有限证据，其余故障和容量仍逐项待验。

### Bootstrap 与外部能力资源边界

1. **职责与范围**：Bootstrap负责模块安装、维护替换和关闭；Platform提供AI、Blob、Browser、MCP、投递及隔离运行时，Agent/Preferences/Operations的应用政策仍归各自Service。
2. **子功能与目录**：沿用bootstrap与platform/{ai,blobs,browser,delivery,isolation,mcp,network,packages}；Provider与Registry保持原子功能Model、storage和sqlite Adapter，不增加分发或兼容层。
3. **依赖方向**：Bootstrap只读模块register/public及技术契约；Service经Model使用技术能力，Platform不引业务对象。Operations最后关闭，以覆盖其他模块退出时发布的事件。
4. **类型与转换**：Provider/Registry应用、存储与技术对象保持独立白名单；BrowserSession由BrowserModel封装为应用能力。具名cleanup_failed保留到Model；HTTP安全出口不传cause。
5. **入口与安装**：模块安装失败清理已安装owner；停止准入逐项尝试。维护绑定保存原HTTP origin取值，调用方修改原options对象不会改变后续替换的Cookie策略。
6. **数据、事务与并发**：唯一初始v1及业务SQL归属不变。Blob发布前复查取消；临时文件删除需目录同步，发布后失败保持io_unknown，清理未确认单独表达cleanup_failed。
7. **生命周期与失败**：独立释放实际调用放入Promise任务，同步抛错不跳过其余资源。Fetch取消reader与释放锁分别保留失败；Delivery保留HTTP主失败及释放失败，NotificationModel转为独立NotificationCleanupFailure；Service停止准入并结算当前投递unknown，结算失败保留双因果，关闭不能报成功。Browser构造取消在已建立CDP后保留释放context所需通道，交付前失败交给同一session.close；不重复关闭context，也不关闭共用浏览器进程。MCP连接失败分别释放SDK及dispatcher。
8. **当前能力与验收**：AI双协议、Provider/Registry、包解析/签名及隔离进程保留现有语义；本节不扩大功能或部署前提。静态结果和逐文件证据归testing，真实外部依赖、取消和故障场景仍待B10。

### Targets 安全凭据读取

1. **职责与范围**：为正式连接编辑提供安全认证摘要，密码和密文不出后端；保持元数据与凭据独立写入用例。
2. **子功能与目录**：沿用connections的Service→Model→Storage→SQLite，不新增业务分发或额外数据层。
3. **依赖方向**：HTTP→Targets public→CredentialService→CredentialModel→独立Storage；Adapter只消费存储契约及Shared基础值。
4. **类型与转换**：应用CredentialSnapshot、存储StoredCredentialSnapshot独立定义；Model、public mapper及HTTP逐字段投影Shared TargetCredentialView，返回none/password/ssh_key引用。
5. **入口与安装**：GET /api/v1/targets/connections/:id/credential经既有Targets管理会话/事务准入，缺连接404；register安装原Storage/Model。
6. **数据、事务与并发**：单条LEFT JOIN取得连接version与凭据状态，无秘密解密；不新增迁移。前端要求与元数据读取版本一致再编辑；两次读取不冒充一个数据库快照。创建复用单项import原子事务，元数据与凭据更新各使用原版本CAS。
7. **生命周期与失败**：沿现有具名技术失败与安全HTTP映射；不存在与损坏数据分别处理，不将坏凭据当none。提交/交付unknown仍先只读核对，读取不触发写入或版本推进。
8. **当前能力与验收**：正式Connections表单已消费，真实读取/CAS/原子创建/清除及OpenSSH测试结果见testing；生产和C2运行协议未切换。

## Remote 后台服务器传输

### 1. 职责与范围

Remote transfers 持有管理员会话的后台源端 rsync/scp 任务，不依赖 Workspace 附件或 Agent grant。保留五管理 HTTP 和源端直传；不把 SFTP Workspace copy/move 当作替代。

### 2. 子功能与目录

`transfers/service` 拥有准入、调度、任务状态和授权监控；`transfers/model` 转换 Targets/SSH/原生命令能力与失败；`platform/transfers/adapters` 只执行通用源端 rsync/scp、验证已给出的 Host Key pin、管理临时密钥和解析工具结果。HTTP 留 Remote 的 `interfaces/http`，不新增空 Storage。

### 3. 依赖方向

HTTP → Service → Model → Remote machines 与 Platform transfers；跨模块只消费 Access/Targets public。后台交接经机器突变 owner 脱离临时请求 scope，并在独立准入事务和执行前复核原会话。Service 不取得技术句柄或目标凭据。

### 4. 类型与转换

Shared `remote/transfers/server-{values,model,http,codec}` 持有有限值、完整安全任务及五入口契约；后端应用对象独立归 `transfers/model/*-types`。HTTP、Model、前端 mapper 均逐字段投影；主机密钥 pin、密码和私钥只在后端可信转换与技术 Adapter 间短暂存在。

### 5. 入口与安装

Remote register 安装 `/api/v1/transfers/send`、`status`、`status/:taskId`、`cancel/:taskId` 和 `DELETE /:taskId`。后台受理与真实结束分开；列表以有界页读取，详情保留。正式前端同步迁移，不维护旧 Protocol 桥。

### 6. 数据、事务与并发

任务列表维持进程内语义，32 个在途/unknown、100 个已确认终态；unknown 不裁剪。最多5个互不冲突父任务并行，父内子项串行；父期限1小时含排队，单子项最多5分钟。每个子项在源/目标真实 endpoint 的持久突变围栏取得后才执行，保存可关联子任务的 claim ID；重启 held 转 blocked，不重派。列表重启后清空不代表远端结束，恢复依据归已有机器突变观察/证据/释放接口。无新迁移或伪造持久任务表。

### 7. 生命周期与失败

任务期限包含排队，取消只发信号；已派发且未确认退出、秘密清理或资源释放的任务保持 unknown。后台监控原会话和捕获的配置指纹；撤销停止后续派发。源可以使用既有代理/跳板；目标原生直连不隐式忽略配置路线，非直连明确拒绝。Model只取实际已验证握手的目标公钥，Adapter重算指纹并匹配冻结pin后生成私有known_hosts；源端CLI严格校验，不额外keyscan或关闭验证。原始key只在技术转换Model之间消费，不进入Service/Shared。源端管理员仍能读取交付的凭据，需逐次确认信任源端。

### 8. 当前能力与验收

五HTTP、Shared完整codec、正式API/store/SendFiles/Progress消费者已实现。列表采用UUID游标每页8项，时间为Unix毫秒；输入拒绝同名/嵌套源与同文本endpoint，scp/rsync均复制目录本身。命令和原始结果留Adapter，有限失败经Model映射；原会话在独立持久准入事务及执行期复查。真实双端点OpenSSH与受控取消/未知/重启/清理、正式store浏览器回归见testing；完整页面及跨业务撤销仍C2-D，公网与非直连目标不在通过范围。部署与生产切换不在本批范围。
