# 后端架构

当前验收基线：后端重构、正式前端 Shared 适配及远程八组回归已收口，具体 SHA、覆盖与仍未验证的外部/扩大故障范围统一见 [E2E](../testing/E2E.md#当前验收基线)，后续任务见 [PLAN](../PLAN.md)。下文 B/F 阶段名仅定位设计来源；原阶段的静态或有限行为证据不扩大为当前全量保证，历史“待 B10/F1”不表示重启已完成迁移。

当前设计同时记录本地未提交实现；新增目录选择、依赖安装和基础组件接入不自动纳入上述历史验收基线。产品行为见 [USAGE](../USAGE.md)，源码、静态检查和待验范围分别见 [PLAN](../PLAN.md) 与 testing。

本文约束新后端及后续功能的放置和依赖。开发前由 [AGENTS](../AGENTS.md) 读取 [人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 与 [编码规范](../rules/CODE_STYLE.md)。按 [模块模板](MODULE_TEMPLATE.md) 维护下面八个章节，不复制人工规则和编码列表。

## 1. 职责与范围

### 远端工具安装

1. **职责与范围**：Remote tools 管理用户确认的远端依赖安装，供传输与归档预检消费。仅安装服务器固定白名单工具，不开放任意命令、包名或仓库配置。
2. **子功能与目录**：`remote/tools/{service,model}` 持计划、授权和应用能力；`platform/tools` 持包管理器检测、固定包映射、提权认证及技术执行。HTTP 仍归 Remote interfaces。
3. **依赖方向**：HTTP → tools Service → tools Model → machines Model / Platform；Service 复用原 MachineMutationService，安装与文件、Docker、Agent 远端突变按真实 endpoint 互斥。
4. **类型与转换**：Shared remote/tools 定义有限工具、包管理器、提权方式、安全检查/安装契约；独立应用对象归 tools/model，技术对象归 Platform；HTTP 与 Model 分别白名单投影。sudo 密码仅写入 SSH stdin，不进入命令参数、持久化、公开结果或日志。
5. **入口与安装**：认证 POST `/api/v1/remote/tools/check` 只读检测并签发短期计划；POST `/api/v1/remote/tools/install` 绑定原计划及原登录确认安装。register 安装并纳入 quiesce/close。
6. **数据、事务与并发**：计划只在内存有效五分钟，绑定目标指纹、会话摘要及缺失工具；消费后不能重放安装。实际安装先取得持久机器突变 claim 并事务复查身份，再复查配置及工具。重启不恢复执行；未知 claim 保留至人工恢复。
7. **生命周期与失败**：Service 追踪全操作至 SSH 关闭及 claim 结算，包命令输出有界消费。断连、超时和取消不证明远端安装停止，派发后无确定退出保持 unknown，不自动重试。认证失败发生于包命令之前，可重新检查再确认；安装退出后仍重新查找工具。前端原操作仅在依赖确认可用且原视图身份有效时派发。
8. **当前能力与验收**：实现进度见 PLAN；root、sudo 免密/密码、apt/dnf/yum/apk/zypper/pacman 支持在固定映射范围内，无管理员权限或未知系统明确拒绝。保留原生归档能力要求与并发窗口，不承诺包管理器事务回滚。行为验收遵守 D17。

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

Access 在 B4.1 完整密码和摘要会话之上扩展 TOTP 与 WebAuthn。Factors 只拥有部分认证、挑战、密码因素启停与凭据操作；**完整身份权威仍为 access_sessions / AccessPublicApi**。五分钟 `nexus_partial` 是独立随机 bearer，只能用于 `POST /auth/login/2fa`，不能传给普通 SSH、Agent 或其它需完整身份的路由。Passkey 登录最终直接核实 WebAuthn signature/RP/Origin/user verification 并签完整摘要会话；已经建立的完整会话不因启用新 TOTP 被隐式撤销。正式Auth/Security已对接Shared因素与配置，本机前端证据归testing；审计/通知/动态Settings已接线，行为待 B10。Preferences 持久配置已接入多 Origin/RP，HTTP/WS 选择受信站点、Factors 按对应 RP 签发并验证挑战；Passkey站点配置在重启生效，实际行为待 B10。

B4.2 本轮复审：WebAuthn 技术 Port 以具名选项表达 RP/user/credential descriptors，Adapter 先对浏览器 clientDataJSON 的 challenge/Origin/type 与 assertion RP Hash、UP/UV、counter 做确定性拒绝；第三方验证仍是最终权威，无法可靠分类的供应商异常映射为不可用而非凭据失败。注册与登录 options 明确要求 User Verification（required），与最终 requireUserVerification 一致。Model 在写 challenge 之前投影技术选项，HTTP 对 options 仅维护一套可选字段白名单；HTTP 签发后的挑战 Cookie 必须交付成功，若在完成之前断开连接则撤销已提交的 challenge/TOTP setup，回收失败保留因果。交付由 Access interfaces/http/access-delivery 唯一持有：原 response、socket 和 request 共同观察，只有原传输未销毁/中断时的 finish 才结算成功；关闭后缓冲清空或迟到 finish 不解除失败撤销。所有路径解除原监听，撤销失败只执行一次并保留因果；本地 finish 不等于浏览器收件确认。源码/静态收口；当前行为范围以 testing 为准。

### B4.1 Access 核心认证与入场策略

Access 统一拥有初始管理员、密码身份认证、token 摘要会话、登录失败/封禁、来源白名单和 CAPTCHA 准入。HTTP/WS 接收由 Platform HTTP 从 TCP peer 与明确受信代理链解析的来源，不读取业务客户端自报 userId/IP；已登录身份由 Access public 的 token/digest 实时复验。安装态策略真实执行，Preferences 已提供核心持久设置，IP/监控热更新，CAPTCHA/站点重启生效；执行配置与 Operations 已接线，外围集成配置已由 B8 接线；TOTP/Passkey 已由 factors 实现完整挑战流程，完整因素不能被密码闸门绕过。

### B3.2 资源观测与 Docker

Linux 采集唯一实现为 `platform/system/adapters/posix-status.ts`，由 Remote register 安装到 ObservationModel。一次命令导出 `LC_ALL=C`，按段读取 `/proc/meminfo`、`/proc/loadavg`、CPU/网络内核事实及 df；不解析 free/uptime 的可翻译标签。内存优先 MemAvailable，缺失时按 MemFree + Buffers + Cached + SReclaimable − Shmem 估算并夹取到总量；应用容量为 MiB、磁盘为 KiB、网速为 bytes/s。远端内存当前按 MiB 四舍五入，不承诺与 free -m 截断值逐整数一致；缺失必需内核数据明确采集失败，无非 Linux 回退。本机 System 使用 Node OS API 与 /proc/meminfo，不依赖本地化 shell 输出。

Remote 的 monitoring 子功能负责普通 Workspace 状态订阅、Docker 查询/控制和后台 SSH 资源采样；不执行任意用户命令、不复制 Workspace registry。System 负责本机状态。cwd 已归 sessions，快捷命令/命令历史已归 Preferences commands/history。SSH/Agent 可分别消费通用 Linux/Docker 技术能力，不能复用普通用户权限和活跃会话。

RemoteObservationService.run 不设普通观测的全局任务数量上限；tasks 只追踪真实在途和清理未确认的任务，不以数量拒绝第9个或更多已接纳 Workspace 的采样、Docker及后台采样操作。原45秒期限、授权、取消和停机等待保留；Dashboard请求级并发、输出容量及Agent机器操作预算保持各自owner政策，移除观测计数不承诺无限服务器资源。状态订阅由 startStatus 串行采样；遇到具名 RemoteResourceCleanupFailure 时先停止原订阅，再交付 operation_unknown，禁止定时重建 SSH 累积未释放任务。stop 继续追踪本轮真实结算后清除 collector baseline；run 与 Workspace 的未确认任务及停机失败证据不删除、不重置。普通读取失败仍可按周期重试；Shared及前端契约不变。

### 服务器传输与Workspace任务的范围

Workspace的copy/move/archive已归Remote Files，按原附件准入和原任务生命周期执行。旧正式 /api/v1/transfers 的send、列表、详情、cancel、remove是独立后台服务器任务，源机器执行rsync/scp并交付目标凭据；当前register已安装这五个HTTP，Shared server-*契约及正式API/store/UI消费者同步迁移。两条链独立验收，后台任务不借用Workspace授权；设计见本文“Remote 后台服务器传输”，当前证据见testing。

### Workspace 当前边界（源码收口，行为待验）

挂起目录通过独立 `/ws/suspended-sessions` 提供首次/变化完整快照，不创建 SSH Workspace。WorkspaceService 持按用户变化事件，覆盖标记、恢复预约/ACK/回滚、续租、detach、改名、终止、自然断线及日志过期；WS Interface 持连接内 revision、合并串行快照读取、发送前身份复查和背压失败关闭。订阅先登记再初读，读取期间变化使旧快照失效；3秒串行身份复查、15秒心跳，不定期重读目录。关闭先退订和清 timer，再等待原快照/授权任务；客户端隐藏或断线重连后重新取得完整快照，HTTP 写入及显式读回保持原 owner 与未知围栏。Shared events 负责严格协议，接口复用 suspend-view 白名单；不按单个终端复用控制 socket。

Remote 的普通 SSH Workspace 是一条持续存在的交互式 shell，而非 Files attachment 或一次性 HTTP PTY。一个 Workspace ID 对应唯一应用会话 owner，涵盖 pending/open/离线宽限/挂起/恢复交付/closing/清理待确认；外部 WS 仅持有可撤销 attachment。Access 注销令当前 Cookie 失效，附着 WS 在身份复查时关闭；这与终止原 Workspace 是不同操作，断开后按普通宽限/挂起保留策略管理原 PTY。同用户以新有效登录和原 Workspace 凭据续接，显式 ACK 后关联 Files 按新会话重新取得资源，不复用旧会话文件权限。已有独立 Remote HTTP/PTY 保留其实际消费者与关闭语义，不冒充可恢复 Workspace。Agent 仍仅复用 Platform SSH/字节通道，不继承普通 Workspace 的令牌、用户权限或资源额度。WorkspaceService 向 Files 显式提供原实例与会话摘要绑定的 WorkspaceFileAuthority（Files Model 应用契约），统一检查生命周期和挂起租约；独立上传、下载交付及多步骤传输通过该能力复查，不依赖扫描先撤销控制 WS。Files 不反向引用 Workspace Service，Platform/Shared 不承载该后端私有政策。跨 Workspace 复制同时绑定原源和目标 owner；普通离线宽限与独立 Files 保持各自政策。检查只限制后续应用派发/交付，不承诺撤回已派发技术调用；授权失效不免除清理责任，远端清理未知保留原因及现场。

当前唯一后端为 `packages/backend`（原 backend-next），包名为 `@nexus-terminal/backend`，入口为 `dist/main.js`。宿主版本读取本包交付的 `package.json`，Backend包版本与产品版本同步，不依赖仓库根路径。旧 Backend 已移出工作树；功能追溯使用 `05e140d2:packages/backend` 或 Git 历史，不能恢复运行时兼容层。源码归一不代表统一 E2E 已验收；现有未验范围仍由实施方案与 testing 承接。

| 一级模块    | 业务 owner                                                    | 当前边界                                                                                                                  |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Access      | 账号、认证、会话与访问策略                                    | 管理员初始化、密码、TOTP/Passkey、来源/IP/CAPTCHA、会话与撤销；正式前端已接入 Shared，真实硬件和故障组合按 testing 区分。 |
| Targets     | 连接配置、凭据、Proxy、SSH Key、Tag、目标解析与 Host Key 信任 | 管理、导入、测试输入、最近连接及 SSH/RDP/VNC 可信目标解析；实际连接归 Remote。                                            |
| Remote      | 普通用户终端、文件与远程用例                                  | Workspace/Files/传输/挂起 WS/监控/Docker、浏览器 RDP/VNC 桥及确认后的依赖安装；当前未验范围分别记录。                     |
| Preferences | 核心安装配置、个人偏好、布局及命令/路径数据                   | 核心 CAS、按消费者热更新与冷配置、个人完整偏好及目录数据；正式前端消费独立版本，不混用授权或写入。                        |
| System      | 本机状态、备份恢复与诊断                                      | 本机成功缓存、全局在线恢复、进程及模块资源诊断；数据库 Worker 独立指标，不以逻辑字节冒充完整内存归因。                    |
| Agent       | App/Run、Provider、工具、治理及集成                           | 正式管理与 Host/Run 已接 Shared；Subagent 继承主 Agent 限制，记忆候选在对话侧栏审核，插件从仓库安装。                     |
| Operations  | 日志、审计与通知                                              | Pino 后端日志、动态日志级别、有限审计与通知投递；不归 Preferences 或 System 复制实现。                                    |

本机状态已有独立 System owner；Preferences 已接入核心持久设置；Operations 已持有 notifications/audit/logging，System 已提供宿主诊断；后续能力按真实业务所有权实施；Agent 的 Provider/调度/Tool/授权/审批/Job/Artifact/Memory/集成归 Agent 子功能，不复制技术底座。

### Agent 上下文设计（源码接线，行为待 B10）

1. **职责与范围**：context 拥有 Root 的 Thread 历史装配、Run-local 完整工具交换及容量准入。历史保留此前 Root 的输入、步骤、工具状态与已记录结果，包含失败、取消和 unknown，不伪造缺失结果。历史转为不可信数据，不成为当前指令或授权；Child 仅取得委派输入和自身交换，不读取父 Thread 私有历史。
2. **子功能与目录**：context/service 的 ContextHistoryService 管历史准入，ContextService 管 Run 内快照与完整交换；context-rules 管纯规则（含normal/extended窗口选择及统一完整请求估算），context-limits 管私有表示上限。context/model 持有应用类型及存储转换，context/storage 定义独立历史/快照契约，context/adapters/sqlite 持有 SQL、行/JSON 解码和快照连续性校验。
3. **依赖方向**：原 RunExecutionOwner → ContextHistoryService → ContextModel → ContextStorage/SQLite；每轮再由 ContextService → RunStepModel → RunStepStorage/SQLite 同事务保存快照。Context 不引用执行 Service，Adapter 不引入应用 Model/Service 类型；模型请求编码仍由原 RunModelStream/Platform AI 转换。
4. **类型与转换**：消息/proposal/reasoning 应用类型唯一归 Run；History/Source/Snapshot 归 context/model，独立存储对象归 context/storage，Model 对全部嵌套字段逐项转换。基础状态引用已有 Shared values；内部快照无双端消费者，不新增 Shared/public 对象。跨 Run 不复用加密 reasoning；同 Run 续接保留供应商需要的完整 reasoning。
5. **入口与安装**：Agent register 安装 ContextModel/Storage 和历史 Service 到原执行 owner，无第二个执行 registry 或新 HTTP。读取历史仍位于冻结政策检查之后，每轮取得快照后才 reserve；每轮受 governed、当前版本、冻结预算及期限约束。
6. **数据、事务与并发**：Root/Child 创建事务分配不可变 thread_sequence，历史按该序号排序，不用时间戳推断先后。Service 通过 Model 向原读取事务传入来源窗口容量与纯预算判定；Adapter 按不可变序号倒序选择最近连续完整Run后转正序，最多4096个来源、1024步骤、4096工具和512KiB原始正文，较早历史不占本轮预算但持久记录不删除，单个过大历史Run可整体省略。相容来源前缀的语义检查点仍复用，超过预算则保留原窗口。ContextService在首轮快照之前按完整序列化/Provider预算移除最旧完整历史消息及其全部来源（摘要按coveredRuns一起移除），只缩小连续后缀，不裁剪当前输入或执行中的工具交换；首轮快照后锁定来源，后续连续性仍严格校验。步骤 reserve 同事务保存 agent_model_contexts 的完整内容、来源及 SHA-256，并核对窗口内完整连续后缀的来源 user/App/Thread/sequence/version/status；后续轮与已存前缀、原步骤文本/proposals及确定工具结果经Model投影后的消息逐项一致。只更新单一初始 v1 与精确签名，不兼容旧开发库。未来恢复若修改被引用的历史步骤/结果，必须原子推进来源版本；B9 不得仅修改子账本而维持来源版本不变。
7. **生命周期与失败**：消息与工具定义合计4MiB，不另设消息数量上限；不按normal/extended裁剪窗口，不以字节估算作为模型上下文硬拒。context-rules保留完整性和编码容量检查，其保守估算仅用于尚未报告usage的步骤预约，不是供应商精确token用量。Platform AI将最多128项工具声明与每轮最多32次调用分别限制，不以调用数量限制目录。模型输入明确标注近期历史可能省略，历史只按完整Run滑窗，不截断半组工具；本轮消息/请求自身超限仍明确拒绝；首轮确定拒绝只结算原身份/版本/创建请求且无步骤的 pending Run，后续按真实派发事实结算，存储失败保留因果且不重试。原执行 owner 管取消、围栏、unknown 与 drain；持久快照不授权重启后重新派发。
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

Memory 列表通过 Shared 可选 threadId → HTTP 白名单投影 → Service 独立 MemoryQuery → Model → storage 参数 → SQLite Adapter 接线。Adapter 在原读取事务核对 thread 属于当前 user/App，分页前通过来源 Run 的 thread_id 筛选，包含 Root/Child；无来源的记录不匹配，缺失或异 App 的线程为 not_found。不传参数仍是实际全 App 管理用途，不是旧协议兼容。候选原文、来源、状态和版本只由原事务持久 owner 修改；本次不改 schema、权限或人工审核政策。

1. **职责与范围**：Memory 拥有候选、人工审核、撤销与受限 Recall；Artifact 拥有内容、元数据、引用、保留及清理；execution 拥有管理员执行设置、硬限制确认及 Run 冻结预算。原 RunExecutionOwner 是唯一模型任务 owner。各能力已有管理入口和真实消费者，源审与静态证据归 testing，行为待 B10。
2. **子功能与目录**：分别放在 Agent 的 memory/artifacts/execution 子功能，沿用 service/model/storage/adapters/sqlite。context 新增 checkpoint Service/Model/SQLite；通信入口仍集中 interfaces/http。Platform blobs 只持有不透明 key、实际字节流、文件句柄和具名技术失败，不认识 App/Run、配额或保留政策。
3. **依赖方向**：业务 Service → Model → 独立 storage/Platform → Adapter；SQL/DDL、私有行与 JSON 解码留 Adapter。execution 的纯政策决定通过 Model 转换后的同事务事实回调执行；Root/Child、Governance 与其他 Agent 子功能直接消费内部应用契约，不绕 public 包装。
4. **类型与转换**：双端管理协议唯一归 Shared agent/{memory,artifacts,execution}；应用对象分别归所属 model，独立存储对象归 storage。HTTP 与 Model 分别白名单转换全部嵌套对象。摘要正文与内部来源快照没有新增公开对象；能力基础值包含 context.compact、memory.read、memory.propose、artifacts.read/write，内置声明当前版本 1.8.0，默认 grant 空。
5. **入口与安装**：register 安装管理 HTTP 和 memory_propose/recall、artifact_create/read、context_checkpoint 真实模型工具；Bootstrap 安装原 Access 提供的事务身份 reader，并创建数据库同路径派生的专用 Artifact 内容目录。核心 SQL 仍仅一个初始 v1，不兼容旧开发库；精确签名随最终结构更新。
6. **数据、事务与并发**：Memory 提案来源、审核 CAS 在原写事务核对；期限使用实际读取后的时钟，审核耗尽版本拒绝递增；跨App记忆导入的路由、用例、存储及快照声明已移除，不保留兼容入口。持久/Shared解码一致校验创建、审核和到期关联。Artifact SQL 预留、文件独占写入/发布和 SQL 确认分别有完成判据；上传/删除领取前预留最终结算的版本空间，批量清理先验证完整计划，确认期限在实际读取后复查。删除先持久 claim，实际文件删除与结算均确认后才归还额度。硬限制 preview/confirm 在真实存储事务读取事实后取时钟，期限由 Service 决定，校验、updatedAt 与单次消费共用该次时刻；耗尽版本不递增。Root 创建同事务冻结设置，Child 同事务复制 Root 冻结模型及不可变执行设置；模型与工具准入读取全族账本，模型预算按已报告input/output usage核算，未报告保留reservation，确定未派发失败计0；不改写原预留记录，不冒充精确账单。
7. **生命周期与失败**：所有管理任务归 AgentRequestOwner，模型/工具仍归原 Run owner。持久语义检查点绑定实际模型输入 hash 和完成工具；下一轮保留原用户请求及完整当前交换，预留事务重新验证摘要来源。未知提交不补写、不重派，导入/清理确认只消费一次；结果未知按预分配资源身份只读核对。内容流覆盖全部 yield、取消和 close，读取期间不允许清理对应文件；未确认文件/句柄清理保留资源与容量归属。
8. **当前能力与验收**：Memory/Artifact、语义检查点、执行设置、Operations 日志/审计/通知与宿主诊断源码已接线；执行按 governed 政策核对，默认 enabled=false；启用设置不授予工具 grant 或审批。 正式前端 F1、行为 B10。

执行设置正式前端已消费独立四HTTP及完整Shared响应codec；独立 Profile 类型、HTTP/持久文档、前端编辑与模型目录请求全部删除。Child 继承 Root 冻结设置，Shared 最大请求容量同时约束 SQL CHECK 和持久解码。业务准入、实际工具集合、版本、占用及确认期限仍归ExecutionService和原事务；本批没有将应用类型下沉Shared或Adapter。完整Agent前端仍待后续迁移。

### Shell 启动探测与提示符 Hook

NativeShellIntegration 在首个终端附件开放输入前，用同一次隐藏命令完成PID/种类探测与Bash/Zsh提示符Hook安装；Shell专用语法仅在识别后执行固定引号内的脚本，不把Bash数组语法交给其它Shell解析。避免两次readline提交之间切换echo；初始化先读取实际TTY标志，Bash真实PTY原先关闭echo时定向回退隐藏提交产生的一行，再原位重绘，不猜测或匹配提示符正文。Setup唯一持有start/end及部分marker缓存、期限和关闭拒绝；输出仍在journal/WS之前剥离随机内部marker及命令回显，不按提示符正文去重、不裁剪普通登录空行。原currentDirectory、排队cd、用户输入后禁止新探测与不支持Shell拒绝契约保持，行为验证见testing。

## 2. 子功能与目录

`runs/model/run-tool-types.ts` 是操作的内部类型 owner，`run-tool-model.ts` 逐字段转换存储命令/结果并映射失败；`runs/storage/run-tool-storage.ts` 定义持久任务；`runs/adapters/sqlite/run-tool-{schema,row,sql,events}.ts` 独占 DDL、行解码、CAS 和状态事件。私有参数/结果预算归 runs/run-tool-limits.ts，不预建无人消费的 Shared DTO。

工具结算政策归 `runs/run-tool-rules.ts`；Model 将事务内存储事实转换后执行纯规则，Adapter 只做引用/版本复查和事务写入。未派发操作允许 failed/cancelled；已派发不能写 cancelled，无法确认远端结果时写 unknown。父 Run 成功条件归 `runs/run-rules.ts`，通过 Model 的窄同步回调消费事务内未结工具事实。

### B5.2 所属目录

`agent/service/agent-request-owner.ts` 负责模块请求准入/停机排空（最多64个在途请求）；`runs/service/run-execution-owner.ts` 是唯一进程内模型执行任务 owner；RunService 编排用例，Model 转换存储/技术请求及结果。`runs/model/run-projection.ts` 统一主 Run、事件和冻结输入的存储投影；复用应用类型归 `run-types.ts`。

步骤契约在 `runs/storage/run-step-storage.ts`，事务和行/JSON 解码在 `runs/adapters/sqlite`；`run-step-model.ts` 持有步骤转换。`run-model-stream.ts` 把技术流转成应用增量/终态/安全失败。OpenAI SDK在 `platform/ai/adapters` 内发送模型请求并解码SSE，原技术Port不含SDK/Run/用户/业务授权类型。

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

Files请求/完整成功结果和ready/error事件统一由Shared remote/files/workspace及codec表达；正式浏览/编辑/预览消费者已在F1-C2-B1迁移，不留转导出兼容桥。metadata的accessedAt/modifiedAt由SFTP Model转换为Unix毫秒后投影，前端不二次换算。目录列表不设置条目数量门槛，完整响应仍按Shared的8MiB字节预算；搜索500项的结果上限由Shared values唯一维护，后端遍历队列/并发策略仍归Files。正式下载与上传port已迁Shared；上传完整回执/终态按原附件投影，failed.message使用Shared有限RemoteFileErrorCode，内部FileUploadEvent仍归Files Model；独立服务器传输HTTP也已接Shared；完整页面继续C2-D。

内部复用应用类型在所属 `model/*-types.ts`；存储契约在 storage；技术契约在 Platform；后端跨模块类型在 public；双端契约按 [Shared 架构](SHARED.md) 归属。类型与实现分开，低层不反向引用上层。Remote 内部会话关闭原因归 sessions/model，后端公开原因独立定义；内部 Model/Service 不引用本模块 public 类型。

业务流程、权限和操作顺序由 Service 持有；复杂或共用的纯判断放所属子功能 `*-rules.ts`，输入/结果类型仍归 model。规则只消费应用事实，不引用 Model 类、Service、Storage、SQL 或网络；简单判断直接留 Service，不为每个操作创建规则文件。Model 不内置业务算法，可以在事实转换回调中调用规则。

Model 逐字段转换应用与存储/技术输入结果；模块入口/出口 mapper 保护公开边界；HTTP/WS 逐字段投影完整 wire。三个边界各有职责，即使字段相同也保留运行时白名单；同一边界不复制转换。复杂公开投影可独立 public-mappers，单处投影就地保留。

应用与存储/底层能力之间明确保留 Model 转换层，即使当前字段一致、暂不需要变换，也不让 Service 绕过 Model；协议入口/出口 mapper 同样保留。精简只合并同一边界的重复实现，不删除转换边界。同一用例兼有存储与远端资源时，由 Service 协调；复杂度确有需要时按存储转换和资源封装拆分 Model，数据库事务不覆盖远端副作用。

协议差异由 interfaces 解码和投影，Service 以真实业务语义组织用例，不使用 Legacy/New 等迁移标签构造长期双轨。同语义共用路径归一、结果确认及资源执行机制；不同的覆盖前提、编码和操作范围保留明确用例。协议容量由 Shared codec/interface 校验，Service 另守应用路径、操作权限、预算与副作用约束。

Files 的 `FileResource` 只提供应用身份、可用状态、metadata/字节读取、staged write、基础 SFTP mutation、realpath/chmod 及受约束 command 结果；Machine/SFTP lease/Node Stream 私有持有于 Model 的 `SftpFileResource`。Model 负责技术 metadata/byte source、同目录临时项和技术 commit/discard 转换；Service 持有 UTF-8/hash/文件类型、覆盖、编码、search、递归/force 删除、批量顺序和写后确认等业务政策；目录搜索流程归 `files/service/file-search.ts`，资源准入与整项期限由主 Service 统一管理，不取得技术句柄。Files 内部失败码归 model，HTTP/WS 分别白名单投影公开契约。

本轮 HTTP 流式下载的身份、Workspace owner、原附件期限及下载票据绑定维持不变；HEAD 只读元数据复用 owner 的 FileResource，GET 的实际 byte body 由 FileService 准入一个 fingerprint 一致的独立 SFTP 技术资源，避免浏览器取消导致主 Workspace lease 同时退场。该临时技术资源关闭结果仍记录在原 owner cleanup ledger，失败或未知不可推断为已清理。Platform SFTP Adapter 针对 RTT 较大的 4MiB+ 下载使用有限 8×32KiB 并行 READ、按 offset 严格有序输出、关闭前结算全部已派发读取；取消时必须确认整条 lease 关闭。写入端用户明确 Cancel 在 stage 未提交且通道仍可用时等待已有 WRITE 结算，确认私有暂存删除后再返回，不提前 abort SFTP 去制造伪 unknown；完成阶段或断流时仍保留未知状态。以上只是源码候选，远程 admission/backpressure/字节 hash/Handle 计数/复原必须独立验收。

第八轮进一步确认 `/ws/uploads` **丢失客户端 binary transport 不等于专属 SFTP 失效**：过去 onClose 立即 abort 复合 signal，先前已 ACK 的写入也无法经过 `stage.discard()` 的确认流程，进而在 reset 留下 RemoteResourceCleanupFailure。新的未提交 owner 候选只对尚未 terminal、SFTP stage 仍在且 signal 有效的任务停止接受新帧、令上传 worker drain 已派发队列后做正常关闭及删除；仍向调用方投影不确定操作结果，不能擅自标为 `cancelled` 或 `completed`。已进入 commit、SFTP 真正失效、无法确认的并行写入及 discard 不确定时仍保留未知和原 Root ledger，不尝试重复提交。

八组最新 Actions `39239518815` 证明同类异常仍发生于明确的 `upload.abort`：旧 Service 的 `finishUpload(mode='abort')` 即使拥有未提交、可收敛的 SFTP stage，也在 reject 已接收字节之后立即 abort 其 SFTP 信号，导致 `stage.discard()` 没有可用连接确认。这条独立调用路径现与 binary WS onClose 一样，保留健康的技术 lease 到 ACK 队列和 stage 的删除/关闭结算；不同之处是 transport abort 始终以 unknown 投影，绝不报告用户已成功取消。已经进入 commit 或 stage/lease 不可用的分支仍不伪造回滚成功，清理失败继续由 Root ledger 汇总。

Workspace WebSocket 在绑定附件后的 owner 身份轮询属于 Remote WS 协议边界：密码轮换的 Access/SQLite 事务会撤销旧 token；即使 socket 上不再发生 RPC，`WorkspaceFilesSession` 每 3 秒重新调用 Workspaces.allowed 验证会话及附件身份，失效主动 close(1008)。既不引入旧兼容 WS，也不延长原安全撤销测试的 10 秒要求；负载与撤销时延须由远程 Actions 独立复核。第七轮第 4/6 shard 已出现真实 stage `abort/append` 与 `discard` 无法确认后 Root shutdown 失败，必须保留 cleanup ledger 未知，不允许把这类 500 当作普通 404 或吞错。

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

`createApp` 先读取 Preferences 持久快照；`AppOptions.configuration` 是仅首次创建时调用的初始化工厂。独立 `main.ts` 提供 `NEXUS_IP_WHITELIST`（逗号/换行分隔 CIDR）、`NEXUS_IP_BLACKLIST_ENABLED`（默认 true）、`NEXUS_MAX_LOGIN_ATTEMPTS`（默认 5）、`NEXUS_LOGIN_BAN_SECONDS`（默认 300）、`NEXUS_CAPTCHA_ENABLED/PROVIDER/SITE_KEY/SECRET_KEY`（默认关闭）并在开放监听前检查值。实际 Access HTTP：`GET /api/v1/auth/{needs-setup,status,captcha/config}`、`POST /api/v1/auth/{setup,login,logout}`、`PUT /api/v1/auth/password`；认证的黑名单 `GET/DELETE /api/v1/settings/ip-blacklist`；其它 Targets/Remote/Agent/System 路由经全局完整来源准入，未知路径同样检查来源；仅状态、登出、登录及管理员黑名单恢复保留白名单级入场（后者须 Access Service 验证 userId=1）。CAPTCHA 成功绑定公共 Origin hostname；安装时从公共 Origin 推导，未绑定拒绝启用。Preferences 在 Access 注册前提供经过校验的版本化快照；保存与生效版本分开，IP/监控经唯一安装回调热更新，CAPTCHA/站点重启激活，不使用 Platform 注册槽。SourceAdmissionService 在封禁查询返回后复查当前白名单和黑名单启用策略，旧异步准入不能穿透已收紧的来源策略。

基础认证setup/login/password及TOTP二阶段登录路由显式引用Shared `ACCESS_AUTH_REQUEST_MAX_BYTES`，保持原16KiB传输预算；前端同一常量约束完整编码输入，不用字段长度替代路由预算。

### B3.2 入口

同一 `/ws/workspace` 安装 status.start/stop、docker.status/command/stats，事件 status.sample/error；HTTP 保留 `/api/v1/system/status`、`/ssh-resources` 与 `/ssh-resources/:connectionId`。Remote/register 装配观测能力，System/register 安装本机能力；Bootstrap 仅调用模块安装入口。观测空请求codec归Shared monitoring，Docker仅消费自己的命令/统计codec，HTTP/WS仍在原协议边界白名单投影；正式前端WS与Dashboard概览HTTP已接Shared，配置消费者继续F1-C2-C2，不改变Remote/Agent各自授权政策。

### B3.1 安装设计

`registerRemote` 只安装一个 `/ws/workspace`，接入 `workspace.connect/resume/ping/close`、`terminal.input/resize/flow/currentDirectory/changeDirectory`、`suspend.mark/prepare/commit/unmark/list/resume/owner.renew/history.previous/history.reset/terminate/remove/rename`，保留 Files/transfer 实际协议；另安装 `/api/v1/ssh-suspend` 的列表、终止、移除断线条目、重命名、日志导出。旧 PTY HTTP/WS 仍在独立消费者范围内运行；不得因新入口存在就宣称旧接口等价。管理和 WS 共用 sessions 的权限、结果与资源 owner。

main 读取环境和启动；Bootstrap 安装实例与全库迁移；模块 register 组装内部 Model/Service/Adapter，并返回消费者需要的能力、HTTP/WS 安装及 quiesce/close。Bootstrap 不逐个构造所有业务 Repository，也不引用私有配置类型。

WebSocket来源准入包装显式保留route的文本/二进制入站预算和文本发送缓存预算。Workspace目录列表使用Shared的8MiB发送预算，其它路由继续使用各自声明或默认值；HTTP bindings在安装时核对三类容量均为合法整数且不超技术帧上限。入站控制限制与出站列表预算分别执行，不用默认发送缓存误拒绝合法列表。

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

Run 用量通过认证 GET `/api/v1/agent/apps/:appId/runs/:id/usage` 只读获取。RunStepStorage 的 SQLite Adapter 单语句按 user/App/Run 限定当前任务与直接子任务，聚合持久步骤的 input/output、已报告请求数、模型步骤数及工具数；未报告为 null，不推算缓存命中率。Model、Service、公开出口和 HTTP mapper 各持原边界职责；响应携带同一 SQL 快照的 Run 版本，无表结构变更。

恢复仅将 reserved 归 failed/DISPATCH_NOT_STARTED、dispatched 或孤立 running 归 unknown；主子状态、版本、hash 和事件数量不合法则拒绝并保留现场。unknown 主 Run 保持活跃直到显式取消；已终结 unknown 步骤后取消主 Run 允许主版本多一。均不自动重放付费请求。

### Provider 事务与冻结

Provider模型配置的逐字段capabilitySources与能力值一起写入原models_json和同一版本CAS；协议、应用、存储和前端草稿分别白名单复制来源，来源基础字段/有限值归Shared providers/values。来源为可选配置注释，未注明的显式配置值为manual，registry/provider仅表示赋值来源，不能授权或证明实时能力。Provider观察对象明确排除capabilitySources；实际模型网络请求仍只映射能力值。输入/存储解码同时验证来源有限值、字段白名单及来源对应能力值存在；界面手动赋值、模型库补全/重置和应用观察在原赋值owner同步来源，不通过全局watch推测。不更新表结构或自动迁移/重写旧数据，无法恢复未记录的历史来源。

第一版初始化直接创建 Provider、Registry 与冻结输入表。配置更新 CAS 增加 version；替换/清除/删除凭据增加 credentialRevision。Run、冻结输入、初始事件及幂等记录同事务写入；Model 回调从存储记录投影应用事实并判断，结果再投影为存储命令。重放先返回原结果。冻结包含端点、协议、模型能力和原凭据代际，不含密钥；已变配置或凭据不能以新秘密替代旧引用。删除关联 active `pending/running/unknown` Run 的 Provider 返回冲突。观察数据失效与删除准入由 Provider 纯规则决定；Adapter 在同一事务读取当前配置或去重的 Run 状态，Model 显式转换后调用同步规则，再由 Adapter 执行存储任务。CAS/关联读取与写入保持同一事务，Adapter 不定义业务状态筛选政策。

### B4.2 因素存储与挑战原子性

第一版初始化在 `access_accounts` 定义 `totp_secret_encrypted`，创建 `access_pending_logins`、`access_factor_challenges`、`access_passkeys`。待登录只保存 digest、用户、密码修订、rememberMe 与五分钟到期，同一浏览器旧 partial 按摘要同事务替换，最大 64 在事务中准入；挑战只保存 digest、kind、用户/完整会话摘要、加密的暂存 TOTP secret 或 WebAuthn challenge、RP/Origin 与到期，最多 1024。保存新 challenge 会删除旧 cookie 对应项，完整会话下同类 challenge 被替换。注册只有在原 challenge 未过期、同一账号完整 session 仍有效、credential ID 未占用时入库。认证在存储事务内复验 challenge、账户/credential 所属、counter 变化、来源封禁，并同事务消耗 challenge、更新计数、签发完整 session；零 counter 遵循旧技术契约，非零 counter 必须递增。TOTP 激活在 session 与 challenge 上 CAS，禁用在密码旧 hash、session 和当前加密 secret 上 CAS；禁用后删除该账户 pending/challenge。

Access 改密由 Service 一次入场认证、AccountModel 转 token digest，SQLite 在修改同一事务复核原 session 仍存在且未到期、旧 password hash 未变，再撤销账号全部会话；计算密码期间撤销或过期阻止写入。登录签发 Storage 与 Model 各自持有具名结果，明确 issued、credentials_changed、rate_limited、cancelled，避免并发封禁被降为错误密码。accounts/sessions Model 使用共用 access-storage-boundary 转技术失败，公开 accessBoundary 只消费应用失败并投影安全码。该 helper 只用于 Model 的技术错误转换，不是新的 Service 或公开能力。

### B4.1 Access 持久权威与竞态

AccessService.setupAdmin 在输入校验后、scrypt 哈希前读取 AccountModel.needsSetup；已有管理员直接按原 already_initialized 拒绝，不继续昂贵计算。该预检查只减少重复初始化请求的资源消耗，不是创建授权或并发保证；createInitialAdmin 的 SQLite 原子创建仍是最终权威，两个空库请求同时通过预检查时最多一项提交。密码格式、HTTP 409、安全失败与正式初始化 UI 不变。

Access 登录失败记录的 `last_attempt_at` 及其索引直接在第一版初始化中建立，不保留开发版数据回填。

`access_accounts` 对管理员初始化使用同一 SQLite 事务的空库检查/唯一写入；改密以旧 hash CAS 更新并同事务删除用户全部 `access_sessions`。`access_sessions` 只保存 256-bit 随机 bearer 的 SHA-256 摘要、账号凭据修订、remember 标志与 30 天到期；状态每次验证从存储重新查，撤销即失效，不复制到 Platform。`access_login_attempts` 按规范化公网 IP 保存次数、窗口起点、封禁至与最后失败时间。普通会话及各模块的原事务身份读取在查询完成后取当前时钟核对期限，不使用入场时刻；账户行由 accounts Adapter 唯一解码，会话复用，不把损坏账户/到期字段当正常未登录并静默修复。失败计数的读改写在存储事务内使用应用规则回调，窗口/封禁和持久时间取同一次当前时钟；成功登录在创建会话事务里复核账号密码/因素及当时封禁、检查取消意图，然后原子新增 token 摘要并清除失败记录；不预先撤销旧浏览器会话：HTTP Cookie 交付无法与 SQLite 提交原子绑定，断连时旧 Cookie 必须仍可使用。若事务已提交、响应尚未交付，则尝试撤销新 token；确认不了撤销/提交时保持 `operation_unknown`，不声称自动回滚。每 5 分钟至多执行一次后台数据库惰性 sweep，删除过期会话与封禁已结束且最后失败超过 7 天的记录，不提前清活跃封禁。名单列表/解除的管理员准入由 AccessService 提供纯同步判断，SessionModel 将 token 转摘要、独立存储 SessionRecord 转 SessionIdentity；SessionTransactionAdmission 只用存储类型。SQLite 在同一真实事务开始及完成前复查当前原会话，身份失效回滚解除或拒绝交付；HTTP 不额外先查一次身份。名单解除是独立删除；登录先检允许入场，验证码网络 await 后、会话提交前复检封禁。单 SQLite v1 已包含 Preferences 配置表；持久配置由 Preferences 拥有，Access 只消费安装快照。

### B3.2 并发与缓存

无新增业务持久化，不创建空 storage。缓存仍为本进程状态；Docker 控制与 Agent/Files 共用 Remote machines 持久突变占用，Preferences 已接入状态间隔/资源刷新持久配置。Workspace 操作绑定具体 attachment、配置 fingerprint 与原 owner；后台主机缓存当前仅供 userId=1，按 host/port 及完整可信配置指纹隔离，同配置且同登录的在途采样才共享，不同会话单独拥有采样；仅成功结果跨登录进入缓存，失败下次读取可重新采样；TTL 从采样完成计算。删除/改配置及 reset 后旧任务不可回填。首次初始化默认状态间隔 3 秒、后台 TTL 30 秒；Preferences 保存确认后热更新状态周期与后台 TTL，独立 Service 的技术安装默认不覆盖持久设置。Docker 按规范化文本 endpoint 与全部受管突变互斥，覆盖容器名称与短/完整 ID 别名；unknown/清理失败保持持久 blocked，重启不解除，恢复能力已由下述B9机器突变恢复接线，行为待B10。

Dashboard的ResourceStatusService与SystemStatusService不设全局4请求准入上限。前者复用上述主机缓存、保留单请求2主机并行与120秒等待，每次交付前复核会话及当前配置；模块自己的取消signal允许多个等待监听，退出时仍逐请求退订。后者由原Service共享一次本机采样，成功结果完成后缓存3秒，失败不缓存，逐请求在取缓存/采样前后验证管理员会话，等待最多10秒。超时只结束调用方等待，真实采样仍登记到原tasks并参与停机排空；quiesce清除缓存且晚结果不可回填。Shared、HTTP白名单映射、前端、协议容量及独立诊断入口政策不变。本机 Node Adapter 与 POSIX SSH Adapter 的根磁盘百分比统一消费 `platform/system/disk-percent.ts`，以有限非负的已用/总容量计算并限制到 0–100；`df` Capacity 只作为技术输出，不参与应用事实。

归档在 Files Service 的首次私有文件写入前，通过 FileArchiveModel.prepare → NativeArchiveCommands.requireTool 执行独立只读工具查找；Model 仅在该边界将丢失的查找回执转换为尚未派发归档写入，清理失败仍独立传播。原生写入仍执行自身工具检查，预检不是后续执行的永久保证；写入取消不能借用此只读分类。

### B3.1 权威状态与竞态

活跃 SSH/PTY、attachment/generation、lease、ACK 等由进程内唯一 Workspace Service 状态机权威持有，重启不持久化技术句柄。64 个普通 Workspace 名额在首次异步身份/目标解析前原子预留，覆盖排队、opening、attached/detached、closing 和未确认清理；重复 ID 不能抢占或重复计数。挂起目录另按用户 32/进程 64 限额与 24h 生存期，重附着同一 Workspace 不再占第二槽。每次 await/WS delivery/ACK 都复查记录实例与 generation；过期/旧 attachment 不能归还新实例或恢复旧 input。技术日志在私有本机临时目录，可重启清理，无持久活跃 shell。文件记录若无需 SQL 则不创建数据库层；任何未来持久变更仍经 Model/Storage/Adapter 执行。

真实 SQL 仅在 Adapter：Agent scope/runs 和 Targets Host Key DDL 归各子功能 `adapters/sqlite`，模块迁移通过初始化接口调用。Bootstrap 只保留一个 v1 applicationMigration，直接安装当前完整表结构，版本 marker 与 DDL 同事务提交。首次发布前持续维护该初始结构，不为开发批次追加版本；既有开发版数据库不兼容，新空库验证留 B10。

Platform 的 SQL Executor 契约在 `storage/sqlite/sql-types.ts`；版本表 Adapter、事务控制 Adapter 和 Worker 在 adapters。Runtime 持有队列、隔离和失败语义：回调失败回滚，rollback_failed/commit_unknown 保留因果并使实例不可用；未知提交不自动重试。Worker 严格验证完整消息，损坏/不可关联结果使待完成调用全部拒绝。只读 diagnostics 消息只采样自身 isolate 的内存并白名单回传，不执行 SQL、不插入 Runtime 事务队列；Runtime 合并相同采样，关闭停止新采样，已派发消息先于 close 按 Worker 消息顺序收敛。队列计数在准入时增加，实际任务 finally 时归还。

业务多表写入和引用/CAS/幂等校验归存储 Adapter 的真实事务。需要当前状态的业务规则采用明确同步回调：Adapter 在事务内读存储事实 → Model 白名单转换为应用事实 → 纯规则判断 → Model 转回存储结果 → Adapter 写入/提交；回调不执行网络、异步任务或开启嵌套事务。Adapter 只依赖 storage 中的回调契约，不导入应用类型、规则实现或业务策略配置；禁止先在 Service 读旧状态、判断后另开事务写入。

B1 Files mutation 不新增数据库或 SQL。单个文件资源由 Service 串行执行操作，但远端 SFTP 预检与后续 mutation 之间仍存在服务器侧竞争窗口；`expectedSha256` 的两次复查只提供尽力冲突检测，不是事务/CAS。目录项 rename 的目标不存在预检同样不是原子 no-overwrite 保证。

Access 的失败窗口/封禁计算在 sessions/login-failure-rules，Adapter 只读取、解码计数并原子写回。Targets 的 connections/ssh-graph-rules 根据同事务图快照覆盖拟修改边，再校验成环、深度、展开数量及受影响祖先；Adapter 读图及写关系，Model 持有回调转换，register 同时装配普通写入与导入/克隆路径。Agent 的 runs/run-rules 同样独立于 Model，版本/状态判断继续在事务内执行。Targets 可信解析在同一 SQL 快照读取目标、凭据与路由，Model 计算指纹并在解密前核对 expectedFingerprint；先读指纹后重新解析不能替代同快照检查。指纹不替代 Host Key 信任，也不证明后续配置永不变化。

## 7. 生命周期与失败

Remote Files 的 upload.prepare 在单一原机器突变claim内先准备根目录，再按根下第一段分组；最多4个worker处理互不重叠的分支，同一分支按路径长度串行。每次创建仍由ensureRemoteDirectory检查完整父链，不缓存stat作后续授权。首个失败停止未派发路径，所有在途worker排空后才结算；混合失败保留全部cause、清理失败类别和unknown，部分创建失败仍保留原保守围栏。allowlist只包含请求路径及根，不把隐式父目录加入可上传范围。

取消/禁用/来源或名单撤销与模型步骤、ToolCall 的持久围栏同事务：inspected → cancelled，dispatched → unknown，状态事件同时写入。重启通过同一 SQLite owner 收敛，不重新执行。审批内部期限/消费时间为 Unix 秒，工具账本时间为毫秒；消费从同一个事务内时钟样本投影两种表示，不能把截断的秒直接作为毫秒更新时间。当前文件/Shell/Docker工具资源关闭已接线，ACP等待/关闭已接线，直接 Child/族收尾已接线，剩余跨 Run 资源由后续 B6/B8 承接。

### B5.2 增量执行流生命周期

Run owner 在持久创建前保留本机准入：8 个尝试名额（含在途创建、资源清理失败的已结算任务），64 个在途写入。拒绝关闭/满额请求不先创建 Run。每个尝试有 5 分钟本地 Abort 期限，不能证明远端停止或计费结束。quiesce 拒绝新请求并中止任务；close 共享 Promise，等待已准入写入与任务结算，有界保留 32 个失败及超量计数。清理失败任务不提前释放名额。

Provider 配置提交后中止本进程关联请求；获取凭据后、dispatch 返回后及发布每个模型事件前复查当前 Provider，复查 await 后检查 Abort。跨进程配置变更以重新读取发现，不宣称网络副作用与配置更新具有跨系统原子性。未派发失败与已派发 unknown 分开，SQLite 写入异常不误归网络失败或重复补写；双重失败保留 AggregateError。

技术 Adapter 持有响应体、reader 和迭代器清理，取消失败仍尝试 releaseLock，异常 cause 留内部。ModelResponseBody独立观察reader.closed；cancel拒绝仅在与已errored reader的原始错误为同一对象时视为重复读取错误，不再虚报cleanup_failed；底层cancel拒绝与releaseLock失败仍保留。Run在辅助资源排空阶段失败后独立尝试主步骤unknown CAS，原步骤未知提交异常不进入此补写路径；标题清理和终态结算双失败保留全部因果，聚合诊断沿原有限错误码投影。Registry下载同样保留清理失败；Provider/Registry在清理失败后拒绝新网络工作并在模块close上报，Registry无人订阅后的持久写入失败也保留并阻断重试。Model 等待技术迭代自然退出及清理完成后才发布唯一 finished/stop；缺失/重复终态、断流、拒绝/工具输出、未知事件、空正文和不一致快照都不能成功。Provider probe 与 Run 共用SDK请求和事件投影，前者仍受 512 KiB/16 token 限额，不授予执行权。

OpenAI官方Node SDK处理SSE换行、分帧、JSON和DONE，项目不另写SSE解析器。ModelSdkRequest在SDK解码前有界读取并严格验证UTF-8，网络总量8MiB、正文总量2MiB独立限制；ModelStreamProjection验证SDK保留的event名称与载荷，并限制解码后普通事件JSON为128KiB、Responses重复完整内容的done/completed快照为8MiB。SDK忽略的注释和分隔符仍计网络总量，不再声明独立注释帧上限；正式终态和SDK迭代正常结束共同确认完成，不自行要求可见的DONE事件。

### Provider 生命周期与失败

Provider 外呼完整期限 10 秒，Registry 刷新 15 秒；真实 fetch 支持 Abort、有界读取及拒绝重定向。允许管理员配置的 HTTP(S)/内网端点，额外出口隔离由部署承担。更新/删除中止本进程相关请求；外呼前后及观察写入前复查配置、凭据与身份，CAS 拒绝陈旧回写。Registry 请求 single-flight，各订阅者独立取消，最后订阅者退出中止底层任务；新请求先等待已取消任务及其存储写入收尾，再共享新刷新，避免旧失败覆盖新成功。缓存 JSON 由 Registry SQLite Adapter 解码为独立 storage 快照，Model 经 registry-projection 双向白名单转换；损坏缓存由应用层报告不可用，不影响后续刷新。精确的 provider/modelId 条目优先于短名称别名。测试传递模型推理参数并校验两种协议的 SSE 终态；缺省 usage 不补零。 Chat Completions的native_finish_reason仅接受string/null元数据，不替代标准finish_reason；reasoning_content仅接受string/null，按原MODEL_REASONING_MAX_BYTES累计字节约束，不进入可见正文、历史或工具授权。真实文本/工具、标准终态、SDK正常结束、usage和拒绝/未知输出校验仍保持。 Run 创建/追加的 ModelReference 可携带本轮 reasoningEffort，Provider resolveFrozenModel 在创建事务中检查等级属于当前模型声明、强制思考不允许 none、Images 不接受覆盖；生效值写入原冻结 capabilities.defaultReasoningEffort，沿 RunModelStream 转为 Responses reasoning.effort 或 Chat Completions reasoning_effort，Child 复制父冻结输入。选择加入创建命令hash，默认与显式等级分别绑定幂等意图；无新增配置写入或表结构。Model 将技术错误转具名应用失败并保留 cause。提交未知保留 operation_unknown；响应总预算 8 MiB，超限返回 limit_exceeded。应用/存储时间为毫秒，Registry 对外 Unix 秒由 HTTP mapper 转换。

### B4.2 安全失败与清理

TOTP 使用随机 20-byte 秘钥的 Base32/HMAC-SHA1 6 位 RFC6238、30 秒步进前后各一窗，向用户展示 otpauth QR；仅在加密 `SecretBox` 生效时允许初始化，密钥以账户绑定 AAD 存 SQLite，失败拒绝而非明文降级。WebAuthn 由本地 `@simplewebauthn/server` 验证签名、challenge、公开 Origin、RP ID 与 user verification，认证 counter 用 SQLite CAS，不能信任客户端自报结果。多个并发完成只能消费同一 token 一次，重试未知结果先重新获取权威会话。完成登录前检查来源黑名单，错误因素验证码累计来源失败。Logout 同时撤销完整/部分 bearer 和设置/Passkey challenge；过期与替换 challenge 不成为资源授权。已经派发的数据库事务不因断连而假定回滚；WebAuthn 浏览器结果的真实交付行为留 B10。

### B4.1 Access 生命周期

账号不存在时仍执行无账号的耗时密码校验以缩小用户枚举时差；密码错误与 CAPTCHA 拒绝只记有权限的公网失败计数，强制 Passkey 的账号拒绝密码路径（`factor_unavailable`），TOTP 账号转部分认证而不签发完整会话。CAPTCHA 网络 Adapter 单次 POST、不自动重试、十秒截止、16 KiB 响应预算；配置无效在安装时拒绝，网络/非预期响应是安全 `captcha_unavailable`，供应商明确 `success:false` 是 `captcha_invalid`；成功时还必须匹配配置的公开 Origin hostname，Google 仅支持 v2 checkbox、不接受 v3 action/score，非 2xx 响应体取消，不能固定成功。请求断连传播 AbortSignal，已开始的 SQLite 事务不凭取消推断回滚。失败计数/签发是独立事务，供应商失败不影响既有会话。改密和登出持久撤销立即阻断下一次身份复查，但不能撤回已经发出的远端副作用；Workspace、Files、PTY、desktop、Agent 原 owner 仍在操作/交付/定期状态门槛复验会话摘要并自行收尾。HTTP 与各独立模块关闭并发收尾，SQLite 在二者实际结束后关闭；失败聚合，不把定时等待终结当资源释放。

### B3.2 生命周期

临时命令任务有全局准入和整项期限，取消不提前释放；Workspace detach/close 和观察 owner shutdown 取消关联任务并等待真实收敛。Model 关闭临时 SSH，不修改最近连接时间，不在 PTY 注入采集命令。Docker 非零退出是确定失败，已派发但无退出证据为 operation_unknown，清理失败保持具名类别并占用名额；不自动重放。订阅取消使旧结果失效，慢采样不重叠，资源缓存不交付已失效身份/配置。

### B3.1 生命周期设计

Workspace WS 的输出暂停/恢复同时绑定 workspaceId 与 attachmentId，由 WorkspaceService 核对当前 attached owner；旧 socket 的流控回调不能改变后继附件的 pauseByConsumer。释放只调用带身份检查的 detach，由其统一核对录制队列和关闭状态再恢复底层输出，不另行解除背压。

连接按 reserve → 身份/可信目标 → SSH open → shell open → FileAttachment → 认证复查 → 绑定 WS/交付 → ACK/运行推进；异步拒绝或取消后晚到 shell 和 Files 仍由其原 owner 追踪关闭，确认清理前不释放预留。异常 WS 断线只解除当前 generation，默认保留约 120 秒再终止；主动关闭先失效附着，终止 shell 及相关 Files/transfer。标记/prepare/commit 挂起应完整记录日志/checkpoint、先暂停后移交再恢复消费，部分副作用未确认的结果保留 `operation_unknown`。接管先撤旧 generation，再有界交付历史/状态与明确恢复 ACK；未 ACK 不能宣称恢复完成，原 owner 在 rollback/lease expiry 继续跟踪资源。日志导出按Shared限制渲染后UTF-8实际交付不超过128MiB，流中超限终止交付且仍释放原source；该预算不同于原始历史窗口。管理HTTP按Shared严格解码输入/目录输出，输出投影无效映射remote_unavailable而非用户输入错误。历史 100 MiB 最大保留、初始约 256 KiB、翻页约 256 KiB、checkpoint 4 MiB，流读取/完整编码/客户端背压单独设限，先做输入预检、再对读到的实际字节检查；不声称快照或磁盘硬配额。同步抛错、异步拒绝、清理多个失败经具名错误与 AggregateError 收敛，同一失败只登记一次。远端失控/断网后不主动重放命令与 unknown 变更；D12/D13 的原生工具与非原子窗口取舍不变。

资源有唯一 owner；准入、半开、活跃和关闭任务追踪至真实收敛。等待超时不归还仍被资源占用的名额；晚成功关闭，晚拒绝中的清理失败进入有界诊断及停机汇总。`RemoteResourceCleanupFailure` 区分清理完整性失败与普通授权/建连拒绝。

外部操作和按 ID 释放继续认证；已获资源的内部 owner 使用绑定该实例的窄关闭能力，撤销会话、取消或断开后仍能完成清理，不重新认证后才关闭，不增加任意 ID 的无认证释放入口。关闭能力不进入 Shared/HTTP，关闭 Promise 与失败仍归原资源 owner。

二进制读取的允许类型、容量和初始范围由 Service 确定，Model/Platform 按明确字节范围读取；空文件不创建无界流，短读不能伪报完整成功，后续追加不扩张本次范围。范围确定不等于内容快照；失败、提前终止和消费者断开都须收敛底层读取。

R2 后，Files Service 的 `runAdmitted` 统一限定二进制数据及 final 帧发送期限，Service 将同一有效 signal/剩余期限交给 Interface 的 NXW1/backpressure 发送循环；Interface 不再独立无限等待。应用交付联合类型 `FileBinaryPiece`/回调归 Files Model 类型 owner，Interface 仅投影具体帧。Workspace `ping` 调用 Service 核对登录身份、配置指纹、资源权威状态及 Workspace ID 并续期；失效绑定不继续发布成功。Files Service 不按Workspace attachment或独立HTTP Files数量拒绝创建；opening/closing、晚到清理与无法确认的关闭继续追踪至实际完成，不因移除准入门槛而丢弃资源。

R2 二次审核：Workspace `connect` 的 Targets `get` 不再由 Interface 在容量/期限之外等待，Files Service 在第一次 await 前预留 workspaceId 和 64 槽，将身份/Targets 查找/SSH open 置于同一个可中断的建连期限；返回 `WorkspaceFileAttachment.connectionName` 的应用事实，WS Interface 仅投影。关闭期间底层 SSH cleanup 可能无界，不能以强制短路伪称已清理；WS 心跳和断开先失效绑定、交还确定失败，Service 对迟到资源、关闭 Promise 和清理错误持续负责，**只有确认释放成功才归还名额**。测试夹具的 Service 构造调用已同步注入 Targets public 查询；慢查、竞态与失败清理的精确验收范围见 testing；受控 Service 队列、晚构造及64预约证据不替代真实传输故障。

关闭先保存共享 Promise，再执行可能重入的清理；取消订阅也属于可能失败的清理步骤，一项失败仍继续其余退订、资源关闭和终态通知，保留全部因果并聚合。停机停止新准入、关闭 HTTP/WS 并等待已接纳任务、取消并 drain 模块资源，最后关闭 SQLite。当前动态资源由 Remote 持有，后续 Agent 调度/执行必须提供自己的生命周期。

普通 PTY、Files 和 Agent 使用共同 SSH/SFTP Platform 工厂，但不共用授权或活跃资源；Remote sessions/files 共用的可信目标建连转换由本模块 `machines/model` 持有，Agent 不深层导入它。PTY 协议 owner 管 ACK/背压/EOF；Files Service 管身份/指纹复查、准入/期限和文件业务流程，Files Model 管 SFTP lease、byte source、metadata 转换与 staged temp/commit。新建文件使用标准 SFTP rename，不调用可覆盖目标的 POSIX replace；覆盖已有文件才使用 replace。`ssh2` POSIX rename 扩展仅在协商声明可用时调用；无声明视为本地尚未派发，使用有备份恢复的标准 rename 路径；已派发操作仅明确 unsupported 可回退，超时、远端未知与备份清理失败保留 unknown，不冒充已提交成功。此协商修正仍待第五轮后续远程 E2E 复验。实际 SFTP 目录扫描以 opendir/readdir(handle)/close 收敛，文件读取经 Adapter `readChunks` 将异步 ssh2 error 归一后再交 Model。

下载HTTP Interface保留GET/HEAD、单段/suffix Range、inline和目录ZIP；票据POST显式使用Shared 32KiB预算，JSON/容量等HttpInputFailure交还Platform，不包装成500。安全失败由Shared有限message/code契约约束，真实状态码保持对应。HTTP sink只保留最后1字节，源迭代与最后授权复查后随response.end交付，避免Content-Length已满足但应用还在等待时代理提前断开并退役健康Files资源；空文件不生成额外字节。票据300秒TTL的协议值与Service实际期限同源，活跃流/原实例/IP/会话绑定政策仍归Files owner。服务端finish仍不证明浏览器保存成功。

B2 源码已包含独立 HTTP 文件下载 ticket/GET/HEAD/目录 ZIP 和 binary 上传 WS。Platform HTTP 提供通用 HEAD 与 opt-in binary ingress（其余 PTY/Workspace 控制消息仍拒绝原始字节），Platform SFTP 按明确 byte offset/end 读取及技术流期限；不会接收 Workspace、票据或 Task 业务类型。Files Model 对外提供 byte source 和临时写流 staged append/commit/discard；HTTP Interface 解码 Range 语法/状态码，FileService 负责应用范围政策、票据、上传冲突、目录 allowlist、原有 Workspace owner/身份与指纹、任务准入与长流确认。ZIP 目录遍历政策由 Service file-directory-zip 持有，条目/字节经 file-zip-model 转给技术 ZIP Adapter，库/reader/producer 的收尾归 Adapter；file-copy 则完成文件/目录 SFTP copy/move 技术流程，Interface 单向投影状态和 metadata，不在 Platform 放文件业务政策。

本批没有把旧传输实现照搬为远端通用命令：旧跨机器执行曾将私钥临时放在远端机器上、使用包含密码的命令参数，新 copy/move 使用独立的 SFTP 源/目标技术资源；未知副作用不自动重放。旧上传传输层异步触发 append，但其 Service 本来有串行队列；新 binary WS 在技术接收层额外显式串行并受背压/字节上限控制。旧目录 ZIP 遍历与短期下载票据活跃流过期等隐患均增加有界 owner 处理。跨不同登录 token 的同用户 Workspace 源资源改经 Access authenticateDigest 校验原会话有效性及当前请求者身份；原 bearer 不保留。Model 的 SFTP readlink/symlink 支撑保留链接本体，目录复制后显式恢复 mode，旧隐式跟随 symlink 的行为不照搬。

B2 archive 由 Service 决定输入/成员安全/任务/取消与发布；file-archive-model 将应用参数/结果和错误显式转换，Platform archive native Adapter 持有 shell 命令、原生列表及退出码解码；FileResource 管 SSH/SFTP 技术资源：压缩通过原生 `zip`、GNU `tar` 直接在远端写带格式后缀的私有 `.part`，由 SFTP 确认后 rename/replace；支持归档输出位于所选源目录内部，不做源树预扫描，直接将所选路径交给原生工具递归处理，不设置压缩总条目数或目录深度上限，命令明确排除旧目标和临时项。解压先用远端原生 `cp --reflink=auto --no-dereference` 建立权限受限的私有归档快照并经 SFTP 核验文件类型/大小，`unzip`/`zipinfo` 或 GNU `tar` 对该快照分别列出简略成员名与详细成员元数据并逐项交叉检查名称/类型/大小（忽略GNU tar顶层 `./` 元数据条目），实际提取使用同一份快照，按规范化路径、非目录祖先、重复名称、特殊成员、安全整数大小，不按成员数量、深度或固定64GiB展开量拒绝，GNU tar 使用 `--no-overwrite-dir` 防止根条目改写私有 stage 权限，先提取至私有 stage，再由 SFTP 复核每一项的真实类型、实际文件大小及 setuid/setgid 权限位，并预检查目标路径类型冲突后发布；原生提取显式排除 symlink/hardlink，只提取普通文件和目录；应用校验通过后，符号链接经 FileResource/SFTP 创建，TAR 硬链接由 ArchiveModel → native Adapter 的 `ln -P` 创建，避免提取中沿归档链接写入；设备/特权成员仍在提取前拒绝。源可能并发变化，预检不等于文件快照；保留 unknown 退役、取消与进度边界。密码执行器按实施方案 D12 保留原生 zip/unzip `-P`：密码经 POSIX shell quote 直接拼入原生命令参数，与旧正式实现一致；接受 SSH command string 和工具 argv 中包含密码，不额外导出密码环境变量，不记录完整命令或回传诊断。无需新增归档 PTY、Python 或 Expect；现有 Model 转换不变。B10 核对密码/失败/秘密日志行为；不承诺 AES 兼容。

SFTP 单次元数据请求的技术上限唯一归 Platform SSH 契约，FileResource Model 将应用剩余期限限制到该上限；上传字节流仍使用完整传输期限，不把总任务预算当作单次 RPC 预算。同目标移动在目标不存在时优先 rename；已有普通文件或目录走既有 staged copy/merge，全部复制确认后再删除来源，类型冲突仍拒绝。

归档纯政策归 `files/file-archive-rules.ts`：成员名称/结构/预算、符号链接逐段目标及硬链接引用完整性只消费应用事实，不访问资源。归档内部 `FileArchiveEntry`、链接计划和提取计划归 `files/model/file-task-types.ts`，不放 Shared；Service 编排快照、提取、链接物化、发布与恢复。Model 对提取计划及成员 kind/linkTarget 显式白名单转换；native Adapter 解码 GNU tar 的 `->`/`link to` 与 ZIP 链接载荷，处理 Info-ZIP 的字面量 pattern 和原生排除参数；压缩时临时输出/旧目标的 ZIP 排除项同样逐项转义，shell 引号不替代工具 pattern 转义。ZIP 链接载荷按 4096-byte 预算、严格 UTF-8、具名密码失败和真实结束 marker 解码，不给 Service 原始 CLI 输出。硬链接保留真实 inode 关联，不自动退化为复制。

Remote 协议入口按通道归 `interfaces/http` 与 `interfaces/ws`；PTY、Workspace Files 和 upload binary 都归 ws，业务语境留文件名。目录迁移同步 register 和后端 fixture，URL、Shared 协议及授权 owner 不变；没有旧路径转导出。

Native Adapter 的列表输出按 names/modes 顺序分段，每段 od 独立检查退出状态；只有完整两段之后才输出完成标记，不依赖 POSIX 管道的最后一步掩盖前一步失败。列表工具写入前设置单文件大小限制，后端每段 8 MiB 解码预算仍保留；限额及工具语法是技术策略，不进入 Shared。该单文件限额不提供解压总配额。命令 stdin finished 监听在 Model 完成/取消后清理，stderr 与 channel 继续由原 finally 收尾。

Native Adapter 将原始工具退出码归一为 NativeArchiveOperationOutcome；Model 只消费 missing_tool/limit_exceeded/password_required/invalid_password/rejected 技术事实，再显式投影应用失败。压缩 writerExited 来自工具返回后的独立 marker，容量超限继续 drain，未确认 writer 退出不能清理或通过 ZIP warning 发布。ZIP/TAR 成员的 mode 在技术 parser 解码，DOS ZIP 没有 POSIX 元数据时为 null；Service 拒绝特权成员，记录 native stage 的 mtime，并在发布后由深至浅恢复明确成员的普通 mode/mtime，stat 确认整项结果。未显式声明的既有 implicit directory 不重写属性。发布及恢复前检查根规范路径与父目录 lstat/realpath；这是有界复查，不能替代 fd/nofollow 原子能力。安全链接有源码实现、实机待验，设备/特权成员的 UNSUPPORTED_ENTRY 与前端消费延后项在 Shared/实施方案对应 owner 维护。

mutation 技术结果区分 `not_started / failed / unknown`；远端 command channel 建立也使用同样派发分类。已派发后取消、deadline 或连接终止不证明远端回滚，unknown 资源退役且不自动重试。写入已生效后的读取或结果校验失败同样保持未知结果，不能按普通未写入失败处理。确定失败尽力清理临时项；unknown 时不继续发可能与晚到 mutation 竞争的清理命令，因此真实服务器可能残留私有 temp/backup，B10 必须核对。整体停机有界、原子 nofollow、原子 CAS 和文件快照不能凭接口宣称。

远端能力按实施方案 D13 保持现有 SSH/SFTP 和原生工具要求，不部署新增 helper 或特权/文件系统配额。路径检查与发布间的同权限并发替换窗口、解压期间无总磁盘硬配额均为明确接受的能力限制；不另设固定展开体积拒绝门槛。保留私有 snapshot/stage、成员拒绝、逐项复查、结果确认及清理失败追踪，不将这些机制描述为强隔离或实时磁盘限额。

原 Python 版 `dir_fd`/`O_NOFOLLOW` 解压审查为历史记录，不构成原生 CLI 安全保证。当前原生工具排除全部归档内链接，安全相对 symlink 和指向归档普通文件的 TAR hardlink 在独立步骤恢复；device/特权节点和危险链接拒绝；通过私有 staging + SFTP 类型检查限制已知攻击面，但最终目标目录替换仍存在竞态；取消或断线后只在能确认远端命令结束时尝试清理 staging，不能宣称所有资源已原子清理。原生命令退出 marker/进度解析、POSIX/DOS 属性、ZIP 加密及目录合并需 B10 验证。旧正式实现本来不支持 AES；Python 迁移中间方案不是旧功能基线。Model SSH stdout 按行白名单解析，stderr 独立 drain 且不回显。Service upload/copy/move/archive 仍统一阻止活跃 taskId 冲突、复查异步身份与任务实例。

Files Service 区分直接借用 Workspace 与独立传输：direct 操作取消沿原资源退役，dedicated_transfer 只收尾独立 SSH/SFTP，健康 Workspace 续闲置期限；显式关闭仍中止全部关联任务。压缩范围准备与取得声明后的元数据复查同样使用独立传输 SSH/SFTP，不把任务取消信号传给工作区共享文件句柄；每次短读取的资源由原归档任务持有并在返回前关闭，清理失败继续保留原任务及配额。任务清理契约唯一归 Files Model，finished/cleanupFailure 实际状态由 Service 的任务 owner 持有，打开阶段、任务正文临时项清理与关闭阶段的具名清理失败均追踪并保留任务标识及配额；copy/归档整项 unknown 转换不抹除清理失败类别，Workspace 关闭尽力完成其余清理再聚合失败，不提前归还预约。prepare 在串行准入内计数，登记前复查取消及具体 owner；start 始终重新检查真实父目录，部分 mkdir 后失败保留 unknown。派生路径按 Shared 传输预算检查，不将该预算施加到旧 Workspace 基础路径。WS callback 绑定具体 attachment，接口只投影安全 operation_unknown，不暴露 cleanup cause。

file-copy 由 Service 在首次副作用前预检整批目标与源的重叠。同 target/fingerprint 用源父目录 realpath 保留叶节点链接语义，目标的缺失后缀基于现有祖先解析，不为预检创建目录；检测相等/祖先/后代及规范位置的嵌套源。原始同路径 move 仍 no-op，别名解析与 metadata 只是变化检测，不是远端原子隔离。move 删除目录后的复查豁免自身删除引起的 mtime/size 变化，但 mode 仍须一致。ZIP 技术 Adapter 在 append 同步拒绝时同样停止并等待 reader finished，保证其拒绝被观察且原 producer/consumer 因果保留。

file-copy以256 KiB固定窗口聚合读取，逐窗等待stage append确认，保持顺序、背压与失败时原迭代器排空/关闭，不并发调用stage。upload协议帧仍最多1 MiB，Service内部按512 KiB批次写入，每批开始前检查discarding；取消不abort独立lease，只停止后续批次，当前批次确认后由原worker清理stage，不将部分帧计为完整progress。

Files Service 不以prepare/upload/copy-move/archive任务数量拒绝操作；同步登记后交给原写入队列，同组16项只作为调度窗口，超出者排队。清理失败任务和未确认资源继续追踪，已完成allowlist按有效期清理；目录准备不设置单批/累计目录数量门槛。FileArchiveModel 将 NativeArchiveFailure.cleanup_failed 显式转换为模块具名清理失败，不以普通 unknown 抹除生命周期事实。

Files 操作在准入后、串行排队前登记 active/inFlight，关闭和 quiesce 覆盖排队与执行，追踪到 finally 退订和解锁完成。尚未执行的排队请求取消不退役健康 Workspace，也不提前解除前序门禁；入场认证等待归既有 authorizing owner。跨 Workspace copy/move 的私有任务记录双端归属，任一端关闭取消任务，双端关闭都汇总关联清理失败；控制协议、任务 ID 和授权仍归原目标端。上传任务用独立discarding状态区分清理已开始与最终块已接纳：取消/断流先停止接纳，原worker排空WRITE、关闭并删除stage，重复取消等待同一settlement，字节通道关闭不再次中断租约。首次断流仍为unknown；提交后的取消与真实清理失败不因该状态放宽。

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

B4.1 已建立上述源码及安装配置入口，并完成 Review 纠正（入场例外、身份和时间边界、断连令牌、供应商 hostname、既有测试源码契约），当前静态结果归 testing，后续修改需按实际工作区重跑。B7.1 核心持久 Settings 已接通，IP/监控热更新，CAPTCHA/站点重启生效；个人偏好、Agent 执行设置与 Operations 审计/通知已有各自 owner，外观/集成/备份已由 B8 接线；B4.2 TOTP/Passkey 挑战已在新 Access 收口，密码登录对已启用因素仍拒绝降级，源码/静态已收口，仍待 B10 行为验收。全套 HTTP/WS、真实代理、受控验证码供应商、封禁并发、撤销后的长任务收敛和实机浏览器行为统一留 B10；正式 Frontend 仍消费旧 Protocol，按 F1 登记差异，不能宣称已切换。

### B3.2 施工范围

资源状态、Docker 和后台采样已接线，完整静态结果见实施方案/testing；正式前端 Shared 对接延至 F1，行为检查留 B10。当前施工状态与真实静态证据归实施方案/testing，不能把本段设计视为功能已通过。

### B3.1 设计与验收边界

本设计建立于原 `workspace.service`、`workspace-terminal.service`、shell integration、suspend coordinator/registry、ssh-suspend HTTP、log/xterm Adapter、现有 Files WS/transfer 与前端 WorkspaceSocket 实际消费者盘点；B3.1 源码及四表已收口，行为待 B10；Shared/backend-next check/build、Frontend build、根 check、格式和 diff 静态门禁须对应最终工作区重新运行。逻辑/故障/E2E 保留 B10，浏览器协议/反馈迁移与静态消费者差异进入 F1。

Workspace 的当前源码由唯一 sessions Service 持有：64 项准入覆盖 opening、detached、resuming、closing 和 cleanup_unknown；普通恢复使用同一 SSH shell、8 MiB journal、120 秒宽限及显式 workspace.resumeAck。新建回执的terminalOffset为初始journal端点、replayedBytes为本次保留回放字节，前端由两者定位收到字节的起点；普通恢复的terminalOffset为回放终点，replayedBytes必须与请求offset对应。lastConnectedAt为Unix秒。终端累计消费归 WS attachment，未确认窗口 1 MiB；消费 ACK 与恢复所有权 ACK 分开，回放和普通输出均服从窗口。非法消费不推进计数，越界 journal offset 在创建 pending attachment 前拒绝；断开释放原消费者暂停，由原 Workspace 继续保留输出。独立 Remote HTTP/PTY 使用自己的技术 SessionService，复用 machines Model/Platform，不暴露用户 Workspace 的活跃 shell 或权限。

挂起标记、prepare/commit/unmark、lease/takeover、pending 恢复与历史由同一 Workspace 实例拥有；只为新 ID 临时登记别名，不另建 SSH shell。历史/checkpoint 经 History Model 转换到 Platform Port/Adapter，Shared 只传安全管理对象、请求及事件。suspend.resumeAck 与普通 ACK 独立，baseline 已发送不代表 ownership 已提交；准备/ACK 超时、WS 关闭和接管回滚原 owner，晚字节有界保留。

目录安全移除由 WorkspaceService 的 `removeSuspended` 根据当前状态决定：attached 且租约有效时共用原 unmark 清理，只删除挂起日志/checkpoint/目录和历史游标，不关闭 SSH、PTY、Files 或当前附件；suspended 才终止；已断开只删 tombstone；prepared/resuming/所有权不明则拒绝，不根据旧前端状态回退到终止。同一标记共享清理 Promise，日志或 checkpoint 清理失败保留 `operation_unknown`；成功经原附件的 `suspend.unmarked` 事件同步 ID/generation，再发布完整目录。事件监听随附件解绑/关闭释放，前端清除本地标记而不关闭终端。HTTP 回执逐字段返回请求 ID 与有限 disposition，原显式终止接口仍保留其终止语义，安全移除不隐式调用它。

目录协作由 Shell Service 持有排队、替换、期限与事件；有限失败基础值归Shared remote/terminal/values，内部事件对象仍归sessions/model，WS逐字段投影。Shell Model转换应用能力，Native Shell Adapter构造Bash/Zsh命令、解析PID/提示符和字节输出。目录切换仅写入安全转义的普通 cd，按 Shell 配置记录历史，不附加内部标记/历史清理、不隐藏命令或后台输出；setup 探测仍保留独立的内部历史清理；结果分隔符不输出换行，过滤完成后用 CR/EL 重绘后续提示符；实际TTY标志确认Bash初始化原先关闭echo时，先回退隐藏提交的一行，不扫描或裁剪登录信息及普通命令的空行。每实例随机marker避免普通stdout充当prompt；未完成探测而已接收用户输入时安全拒绝迟到注入。普通Workspace响应与protocol.error使用Shared有限安全码，准入满额为limit_exceeded。真实Bash目录切换/回读及普通续接已有F1专项；其他登录脚本、Zsh及并发提示符组合仍分别待验。

日志由技术 Adapter 串行 append/read/compact/delete，绝对 offset 不随 100 MiB 可见窗口裁剪回退；checkpoint 和 renderer 的技术资源通过 Model 隐藏。日志导出在 Service 对每个最多 64 KiB 的块复查身份和实例，技术分块归 renderer Adapter；取消与清理失败分别判断，不能把 allSettled 的完成当作释放成功。历史前页交付成功并复查原 cursor 后才推进。HTTP/WS 管理视图共用 suspend-view 白名单；当前身份、attachment/generation 和 45 秒租约在异步边界复查，2 秒 sweep 不代替实时授权。关闭、背压、导出和失败边界见第 7 节与下述当前范围。

B3.1 源码收口不等于行为验收。实际类型、构建和格式结论以 [B3.1 收口证据](https://github.com/0honus0/nexus-terminal/blob/558c4b343ba0ef2316309d2e164b9c6075c47efc/doc/testing/%E5%90%8E%E7%AB%AF%E9%87%8D%E6%9E%84%E5%BE%85%E5%AE%9E%E6%9C%BA%E9%AA%8C%E8%AF%81.md#b31-源码阶段最终收口) 为准；B10 已验证本机 OpenSSH 的普通续接双阶段确认、普通终端消费窗口/暂停后断线回放、journal裁剪/offset拒绝、挂起 ACK/主动接管及 Files 正常链；挂起准备、消费暂停和日志积压分别持有阻断条件，取消挂起标记经WorkspaceService原resumeIfUnblocked计算是否可恢复，不能直接解除独立背压。慢日志 detach、prepared断开、自然租约到期、准备超时、历史帧失败/reset、日志文件系统拒绝向PTY收尾及导出授权/名额/断连已有有限证据；慢日志 rollback、空间耗尽、其余 Shell/VT 与清理故障仍待验证，精确范围归 testing。正式前端普通/挂起独立ACK及Shared挂起契约已接线；标记标签关闭仅脱离传输，明确取消标记后关闭才请求终止Workspace，受控与真实专项范围见testing，完整 Access/IP/2FA 源码已收口、行为待 B10。

Access/Targets/Remote 与 Agent 的计划后端功能源码及 B9 逐文件审核已收口，当前职责见职责表；行为验收仍待 B10。Remote Files 已同时具备 B1 新 HTTP 读写能力及 R1 旧 Workspace Files 子协议源码：编码写入/独占新建、list/search/stat、binary read/cancel、递归/force 批量删除、rename/chmod/realpath、ready/error 均有真实调用链；A-04 machines owner、SFTP 技术失败边界及 Files Service/Model 职责已收口。R1 行为验证未运行，真实 SSH/SFTP、故障窗口和旧消费者全链路仍待 B10。

R2-01–R2-05 的源码缺口已修补：背压/final 纳入同一操作截止时间，心跳按实际资源 owner 验证并续期，Workspace 64 与独立 Files 8 的预算分别计数；WS authorize 的身份查询异常沿技术握手返回服务不可用而非伪装未登录；PTY 定时/EOF 身份查询异常与正常拒绝分开，所有 unsubscribe 与 release 失败聚合进入原关闭追踪。以上仅是源码/静态完成，B10 的长背压、撤销、故障及容量行为尚未执行，不能标为已验收。

B2 下载/上传/copy/move/目录 ZIP、原生归档、密码与进度、属性及链接恢复的源码已收口；D12/D13 的部署取舍已确定，B2-V01–V66 全部待 B10 行为验证。Files 子协议不等于完整 Workspace 已迁移：完整 reconnect/resume、Terminal/挂起恢复的 B3.1 源码已收口、行为待 B10；status/docker 的 B3.2 源码已收口、行为待 B10；RDP/VNC 的 B3.3 源码复审已矫正，本轮最终静态通过，行为待 B10；完整 Access/IP/2FA 源码已收口、行为待 B10。按明确决定，旧 writer 的隐式 metadata 失败容错不在后端保留，正式编辑器的显式失败处理转 F1。Agent Shared、六个 HTTP 与开发前端源码消费者已接入；真实浏览器与故障行为仍待验收，不能因静态通过就声称正式通信迁移完成。

**B3.3 RDP/VNC 新后端源码**：DesktopService 持一次性票据、pending/opening/active 配额、Access/Targets 版本及周期复查；DesktopModel 转换应用事实和实例技术能力。Targets 同事务读取配置/密文，由 Model 解密并经公开 mapper 转换；connectionUsage 记录桥就绪时间。BrowserDesktopAdapter 只桥接 VNC TCP 或 RDP X224/TLS/RDCleanPath，不运行图形解码进程或 guacd。签发 HTTP 逐字段交付六字段内存会话并设置 no-store，WS 仅携带原 Cookie 和 ticket；目标由受信配置决定，不使用客户端 destination。RemoteApp UI/协议/SQL 列已删除，初始签名已更新，不兼容旧开发库/快照。完整八节见 [远程桌面专题](REMOTE_DESKTOP.md)，本版行为待远程验收。

产品行为与容量以 [USAGE](../USAGE.md) 为准，当前工作见 [实施方案](../PLAN.md)，未执行真实专项见 [待实机验证](https://github.com/0honus0/nexus-terminal/blob/558c4b343ba0ef2316309d2e164b9c6075c47efc/doc/testing/%E5%90%8E%E7%AB%AF%E9%87%8D%E6%9E%84%E5%BE%85%E5%AE%9E%E6%9C%BA%E9%AA%8C%E8%AF%81.md)。新后端独立 check/build，Shared 与实际双端消费者同步检查；架构审核按模块模板和工程经验执行，静态通过不能证明真实 SSH、并发、清理与浏览器验收完成。

B3.3 的 Service 只消费 Model 创建的 DesktopPeer；Model 同步 bind 原 WS 防止首帧丢失，授权前仅有界缓冲，异步复查后才允许 TCP 派发。Platform 持有 DER、TCP/TLS、队列与背压；真实关闭确认覆盖 WS、原 socket、初始化、队列消费与 send 回调，未确认清理不提前释放槽。桥就绪不证明远端认证或画面成功；RDP 当前沿用 ignore-certificate，部署须确保目标网络可信。新实现的画面、输入、权限及资源释放分别等待远程回归，不复用旧 Guacamole B10 PASS。

后端功能迁移与正式前端 Shared 对接已完成，当前后端 HTTP/WS 及双端消费者经远程 Actions 回归；DEV 入口仅用于有限诊断，不能替代正式入口或扩大环境保证。

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

目标 grant 的 ssh IDs 在 Shared 协议中是长度受限文本，应用判断时严格要求规范化的正安全整数目标 ID；执行政策秒/字节/条数沿原始类型进行验证，不将 `String(value)` 后的相同文字当成有效 enum。grant 目标 ID 最多 256、单个最多 128 UTF-8 bytes，capability 取值以 Shared governance/values 唯一列表为准；审批 TTL 600 秒；grant 请求上限 512 KiB，普通 governance JSON 16 KiB，完整结果上限 8 MiB；审批 list 按ID游标每页最多64条，返回 after/nextCursor/hasMore，历史总数不截断；容量按完整 JSON 编码计算。

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
| 运行与工具/Child安全审计 → 双端协议   | Shared runs/tools/governance/collaboration             | 原 register/HTTP mapper          | 已安装管理员 HTTP      |
| Child 完成输出/协作文本 → 父/同族模型 | runs 内部应用对象                                      | 协作 Service 明确投影            | 模型工具结果           |

消息和事实只是未验证文本，不能作为授权、系统指令或已验证证据。Child 列表、取消及消息元数据 HTTP 的完整契约与严格 codec 在 Shared agent/collaboration，取消复用 Shared runs 请求/header/成功联合。profile 的双端有限取值归 collaboration/values；目标 allowlist、模型历史、正文、事实与存储对象不出公开端点。正式前端消费归 F1。

### 5. 入口与安装

当前内置声明为 `nexus.terminal@1.8.0`，包含 `app.intents.exchange` 和已接线能力，默认 grants 仍空。十个 `collaboration_*` 工具（含正文续读 `collaboration_output_read`）通过原模型工具入口使用；读操作仍需实时全局 grant，委派、取消、发送、消费和 CAS 写入需独立 ToolCall 批准。父模型/工具批准不代替 Child 自己的工具批准。没有旧 runtimeId/sessionId 桥接或新的公开 dispatcher。管理员 HTTP 安装 GET /apps/:appId/runs/:id/subagents、POST /apps/:appId/runs/:id/subagents/:childId/cancel 和 GET /apps/:appId/runs/:id/subagents/:childId/messages，完整前缀 /api/v1/agent；入场/交付分别核验 Access。列表仅 id/parentId/status/version/profile/deadlineAt；消息仅 sequence/senderId/bodyBytes/expiresAt，查询 after/limit（默认0/16，最大32），完整响应16 KiB。观察不改变模型邮箱水位。Child 取消由 RunService 验证不可变父子/user/App 归属，再复用原 Run CAS/幂等取消及审批失效，不建立第二账本。外部直接创建由受审批模型委派替代，独立 Profile 管理及 collaboration_profiles 查询工具已删除，delegate 不再接受单独 maxRequests/durationSeconds 或模型覆盖。

### 6. 数据、事务与并发

唯一 v1 更新 Run kind/绝对期限及 Child 关系、事实、mailbox、扫描/消费水位和本地副作用标识。Child 的目标集合、继承工具、继承请求上限、Root 期限、依赖和创建 hash 固定；委派读取父当前状态/目标/已有子集，在原事务经 Model 回调执行 Service 纯规则。Child 步骤和工具/审批消费复查独立身份、活父和期限；目标与 capability 仍由原治理权威核验。此前 Child 才能成为依赖，无环；success 依赖要求 completed，settled 接受所有终态。

事实 CAS、消息容量/序列及消费 CAS 同事务，重复工具身份不重做副作用。mailbox 页包括过期位置的扫描进度，空结果不丢 nextCursor；消费不得越过已连续扫描水位。根终态和活 Child/工具/步骤围栏同事务；Root 成功必须没有未完成 Child。ACP 内部权限不计入模型步骤普通工具提案数量，仍纳入独立工具/权限审计。

### 7. 生命周期与失败

Root/Child 共用冻结执行名额，排队依赖也占名额；执行准入满载拒绝，模型派发并发忙则由原owner等待。Child 继承Root期限和任务族请求额度，不再独立缩短；期限到达阻止新派发，但允许原步骤未知结算。join 最多30秒，只结束等待。父成功前等待每个 Child 的真实任务和清理；Agent 共用错误 owner 的 aggregateToolFailures 同时服务 ToolService 排空和 RunExecutionOwner.waitChildren，嵌套的纯执行未知保留 ToolExecutionUnknown/ToolCleanupFailure，混合存储或内部故障保留 AggregateError，不推测结算；父失败/取消/撤权/停机覆盖整族。存储取消失败仍取消本地 Child、等待资源并聚合全部失败，不以一项错误跳过其他收尾。

重启只对账：未派发 Child 失败，已派发/运行中保守 unknown，不重建等待、不重放请求。Child 每步正文与最后正文沿模型步骤2 MiB容量，同步骤/Run成功事务完整保存。participant SQL只读取1024字符预览与原UTF-8字节数；list分页最多16项，output_read按原身份续读并返回hash。仅活跃、unknown或未结算工具的Child阻止父成功；确定失败/取消且实际排空不强制父失败。没有远端 rollback、跨进程活任务接管或公平排队承诺。

### 8. 当前能力与验收

委派、角色标签、依赖等待、list/join/cancel、持久消息读取/消费、共享事实 CAS 与父子收尾已接线。B7 接入共享预算、Root 冻结模型/设置继承与原执行 owner，Memory/Artifact/Browser/MCP 已接线；跨 Run 持久占用归下方 B6.2E。B10 已通过隔离新后端、实际 HTTP/SQLite/OpenSSH 的委派/join、整族取消、独立批准/错族拒绝、消息消费、事实冲突与 Child Job 未知结算子场景；完整配额/期限、未知提交与崩溃恢复仍待验。确切版本、两轮复审及命令证据归 testing，正式前端后置 F1。

## B6.2E 项目上下文与共享突变占用

### 1. 职责与范围

Agent tools 持有 Run-local 项目目录；Remote machines 持有受管远端突变的唯一准入权威。普通 SSH Files/传输、Workspace Docker 与 Agent 文件/Shell/Job/ACP/Docker 共用占用，但不共享登录身份、批准或活跃连接。旧 ssh_session_open/list/close 仅复用 transport、没有持久 shell 状态；新设计由独立 Remote operation、Run/Job 查询取消及父生命周期替代，不保留第二连接池或 sessionId 桥接。旧 Thread 项目共享改为 Root/Child 各自绑定，当前不自动向子 Run 或系统提示注入指导。

### 2. 子功能与目录

Agent tools/{model,service,storage,adapters/sqlite}/tool-project-* 分别持有应用类型/转换、目录用例、存储契约与真实 SQL；tools/service/tool-definitions 和 tool-input 持有受信声明/严格参数，ToolModel 持有 Remote 请求/结果/失败转换。Remote machines 对应层的 mutation-* 持有应用身份/转换、准入政策、存储接口和 SQLite 事务，migrations 仅安装 Adapter。endpoint占用不设全局数量门槛，单次最多两个endpoint对应源/目标是Remote Service政策；目录256 UTF-8 bytes、子目录深度8、四份文件/每份8 KiB 是 Agent 项目用例限制，不是新增 HTTP 容量。

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

remote_machine_mutations 按 SHA-256([lowercase host,port]) 唯一。ID/user/凭据/代理变更不为同一文本 endpoint 创建第二占用；跨端复制/移动一次事务检查并获取两个排序去重 key，部分获取不提交。已持有或 blocked 报 conflict，不设跨endpoint数量上限；不自动重试或排队。释放/阻断必须匹配原 claim ID、key 和 held 状态。私有 Files 同资源既有队列仍保留，跨资源占用不等待。DNS/IP别名、不同跳板网络中的同名主机不被此文本身份准确区分，可能漏合并或保守拒绝；不宣称真实物理主机识别。

### 7. 生命周期与失败

占用涵盖实际操作、远端结果确认、独立资源清理和最终授权复查；后台 Job 在实际执行时持有，受理回执不持有假执行占用。确定结果/拒绝且清理完成释放；operation_unknown、未知异常或清理失败保留 blocked。拒绝的归档操作必须由原归档 owner 完成私有临时项清理，Host Key 拒绝不等于已执行突变。结算失败保留未知，不在未知释放后猜测第二次写入；清理与结算双失败仍保留 RemoteResourceCleanupFailure 供停机 owner 汇总。重启将 held 保守转 blocked，不恢复执行、不按 TTL 自动释放。

项目读取共用45秒整项期限，绑定只在指导读取及当前授权复查后提交；目标 version/fingerprint 改变拒绝旧上下文，不隐式重绑定。占用不是 OS 隔离：交互 PTY、外部客户端、后台派生进程不受此数据库锁控制，命令退出/SSH close 不能证明派生进程停止。已确认远端结果后的响应丢失不自动重放副作用。

### 8. 当前能力与验收

受管突变准入与 Run-local 项目工具源码已接线；全部行为待 B10，执行须 governed 准入。持久 blocked 已由下述 B9 机器突变恢复接线管理员只读核对、人工证据和独立 CAS 释放；不将重启/期限/改连接ID当解除证据，原未知结果不改写。B7 已接入可配置上下文/预算及执行回接，B8 外围能力已接线；Shared 恢复契约已有后端消费者，正式前端 F1。USAGE 记录当前限制，四表/源码复审与待验场景见 testing。

## B7.1 Preferences 持久安装配置（源码已接线，行为待 B10）

### 1. 职责与范围

Preferences 拥有持久设置及版本；Access拥有准入/认证政策，Remote拥有采样/缓存用例，Platform不持有设置业务。本批迁移安全策略、活动CAPTCHA配置、监控间隔和多Origin/RP。界面布局和个人数据归 Preferences，日志/审计/通知归 Operations，Agent 上下文/子模型/预算归 Agent；外观/备份及外围集成已由 B8 接线，全部行为仍待 B10。

### 2. 子功能与目录

preferences/configuration/{service,model,storage,adapters/sqlite} 分别持有配置用例、应用与存储/密码技术转换、独立存储契约、SQL/row解码。通信放preferences/interfaces/http，安装在register，DDL经migrations调用Adapter。configuration-rules 持有可复用纯配置校验，Service 与恢复预检共用；配置版本、默认值、热/冷激活策略归Service；编码容量/安全失败归Shared preferences/configuration/values。

### 3. 依赖方向

HTTP→Service→Model→Storage→SQLite Adapter；Bootstrap先await Preferences初始化，取得窄安装快照后安装Access/Remote。Preferences业务入口只依赖Access public认证接口，不引用其策略实现；Access register另提供仅安装使用的readTransactionIdentity，执行Access Adapter自己的SQL并返回userId/null。Bootstrap在读取配置、安装Access后将它一次性绑定到Preferences Adapter；事务executor不进入业务Service/公开HTTP，未安装拒绝写入。配置不会通过Platform注册槽传播。因素Model只根据已配置Origin/RP及协议边界验证的当前Origin选用技术配置。

### 4. 类型与转换

Shared持有完整配置GET/PUT、业务可见政策及CAPTCHA安全视图/秘密写命令。应用类型归configuration/model/configuration-types，存储记录归storage；Model逐字段映射并加解密，SQLite Adapter只解码其storage类型。ConfigurationView内部独立定义有效监控投影，Service从当前有效配置选值，HTTP逐字段构造Shared必填effectiveMonitoring；范围基础值归Shared，规则与SQLite row解码精确引用。HTTP白名单投影不返回secret或ciphertext；Backend初始安装快照在register/public边界明确投影，秘密只供Access真实安装消费者使用。PreferencesRuntimeConfiguration在register定义六个热字段安装契约，Bootstrap逐字段转为Access安装契约和Remote周期参数，不透传应用类型或秘密。

### 5. 入口与安装

管理员GET/PUT /api/v1/settings承载当前核心配置，PUT完整替换并必填expectedVersion；CAPTCHA管理入口单独GET/PUT /api/v1/settings/captcha，匿名读取保持公共安全视图。未知/旧界面字段拒绝，不静默过滤。初始化使用环境seed且仅首次写入，后续启动读取持久配置；Access/Remote采用同一已验证版本快照，不重新用环境覆盖。

### 6. 数据、事务与并发

单一v1增加preferences配置单例表。完整更新和CAPTCHA专项更新都在Adapter以版本CAS写入，不先读后无条件覆盖；同事务通过Access安装能力复查session/password revision/expiry，Model将userId/null转换应用actor，Service的同步准入回调决定管理员权限，拒绝整体回滚。秘密keep/replace/clear由Service决定新配置，Model加密并逐字段转换，存储永不保存明文。ConfigurationService串行读写，Bootstrap在监听前安装唯一prepare回调：先验证并编译Access白名单/封禁和Remote周期，SQL确认后同步apply，不在失败CAS或未知提交后猜测激活。有效配置保留原CAPTCHA/Passkey冷字段，更新六个热字段；全部字段与保存值相同时推进effectiveVersion，否则保留最近完整有效版本，requiresRestart仅反映冷配置差异。apply异常返回operation_unknown，不虚报成功；重启从持久配置重装。

Access更新原SourceAdmissionService/LoginFailurePolicy实例，后续请求采用新策略，不撤销既有会话或清除封禁记录。Remote更新原服务，等待中的状态订阅重新计时，在途采样仍由原owner追踪，结算后按新周期调度，不另起并行采样；资源TTL变化清空成功缓存，不释放在途任务，晚成功采用当前TTL。Bootstrap初始installation仍是安装快照，不作为运行时查询缓存；在线恢复重建模块并重新绑定回调。

### 7. 生命周期与失败

读取/更新以原Access身份入场并在交付前复查；Settings关闭拒绝新调用和未开始的排队工作，等待已开始任务真实结算，SQLite在其后关闭。提交前保留有效配置引用，停机中晚确认仍完成同步激活与有效态记录，不因停止准入误报未提交；Remote停止时已注销订阅重排回调，不重新激活已关闭采样。已提交而响应失败按未知交付处理，保留版本/输入并只读核对，不自动重写。存储/解密/配置无效时启动失败，不回落默认或放宽安全策略；重启不重放运行任务。可信Origin/RP与CAPTCHA仍在进程内固定，在途认证挑战不因热更新混用配置。

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

仍只有初始 v1。每次个人数据写事务复查会话，并绑定最初认证用户；历史 upsert、更新时间、修剪同事务完成。命令与标签关联同事务，不允许部分批量成功。编辑类使用版本 CAS，存储损坏失败闭合，不默默恢复空对象。用户偏好保存立即成为读取权威；首次未保存明确 version=0，第一次 CAS 写入创建 version=1，不读取旧字典或恢复损坏数据。界面实际生效由 F1 的真实消费者负责。命令按用户最多2000、标签200、收藏2000；上限归 Service 同事务回调，SQLite 只提供事实。批量标签关联核对全部命令原版本；删除标签推进受影响命令版本，原编辑不能覆盖变化。标签组及未标记组删除均核对完整成员与指令版本；真实标签额外核对标签版本。未标记组按当前用户无标签关联的指令集合读取与删除，不持久化虚拟标签或使用伪ID；整批匹配后在同一授权事务删除，变化时无部分写入。列表有界分页、固定次序，但非跨请求快照。命令/标签/收藏的持久时间在 Adapter 完成权威读取后生成，更新不倒退；历史按同用户/类别现有最大时间防止回退导致新项误裁剪。行解码核对创建、使用与更新时间关系，命令递增在写入前拒绝版本或使用次数耗尽。

#### 7. 生命周期与失败

Service 停止准入后等待已接纳真实工作，关闭不取消已提交结果；限制排队数量。协议严格解码和预算在副作用之前，事务后转换/认证/交付失败为 operation_unknown，客户端只读核对，不自动重放。普通历史记录与 Agent 执行权限独立。configuration/presentation/commands/history/favorites 复用模块内部 PreferencesTasks 观察已接纳任务，Service 仍拥有准入与配额；已结束真实故障保留最多16个诊断样本及额外数量，关闭排空并汇总，预期用例拒绝不算存储故障。

#### 8. 当前能力与验收

B7.2 的个人偏好、命令/标签、历史及收藏源码已接线，功能源码和静态通过分开记录。正式前端留 F1，行为回归留 B10；逐项缺口、两轮审核四表及当前执行证据归实施方案和 testing，不把设计当完成。

### Operations 日志、审计与通知

Platform logging/pino-logger唯一实现原Logger契约，registerOperations安装PinoLogger，替换NativeLogger，不保留转导出或旧路径。前后端依赖同一catalog的Pino9；后端采用stderr同步destination、禁用默认base/timestamp，由白名单对象与severity formatter保留time/severity/code/facts单行JSON。原32facts、16KiB编码预算及debug/info/warn/error/silent过滤不变，LoggingModel只转换安全auditId，Service仍拥有持久级别CAS及激活。没有worker、异步传输队列或新的公开类型，正常同步写入无需新增flush owner；审计持久化、写入失败与关闭汇总沿原链路，不因换库改变为日志失败可忽略。

1. **职责与范围**：Operations 拥有 backendLogLevel、受限审计记录、通知配置与投递账本。Access/Targets/Remote/Agent 仍各自持有业务状态；Operations 不成为授权 owner。仅已实现的事件进入 Shared 可选列表。
2. **子功能与目录**：logging/audit/notifications 各按 service/model/storage/adapters/sqlite 放置；HTTP 和安全投影集中 interfaces/http；audit/service/audit-event-owner.ts 持有发布、请求/事件准入及停机排空，register 只装配和公开投影；operations-storage-refusal 是独立存储拒绝，Model 的 operationsStorage 负责映射应用失败。Service 管保留数、订阅选择、队列容量和激活时机；Model 管对象、秘密与技术失败转换；Adapter 管 SQL、行/JSON 解码和事务。
3. **依赖方向**：业务 owner 经 Operations public.publish 提交有限安全事实，出口将同步准入/异步任务失败统一转为 public-errors.ts 的安全 OperationsError，内部原始 cause 由真实任务 owner 留存，已安装 HTTP 经 observer 直接调用内部发布 owner 记录结果，不绕公开安全包装；通知 Service → Model → Platform delivery。Platform logging/delivery 不引用业务事件、用户或通知配置对象。Shared common/http-codec 仅复用通用 JSON 原语，不反向依赖 Agent。
4. **类型与转换**：Shared operations 持有事件/日志级别/投递状态、完整协议与容量。内部类型归各子功能 model，存储类型独立归 storage。秘密字段按配置ID与字段作用域加密；Adapter 的配置 JSON 独立限制为128KiB以容纳加密膨胀，不能复用64KiB请求预算；公开对象和内层配置解码均使用完整响应预算。公开只返回 hasPassword/hasBotToken 与 header 的名称/hasValue，明文/密文不出 HTTP。
5. **入口与安装**：GET/PUT /api/v1/settings/logging；GET audit-logs；GET/POST notifications、PUT/DELETE notifications/:id、POST notifications/:id/test、POST notifications/test-unsaved、GET notification-deliveries，均要求当前管理员。Bootstrap 安装 Access 事务身份读取能力、初始化日志/投递恢复，再开放监听。真实 Agent 审批/Memory/Artifact/Run 和 Remote SSH 事件从原 owner 发布，Auth/Targets/Settings 观察真实路由结果。
6. **数据、事务与并发**：日志设置未显式写入时允许无持久行，由 LoggingService 提供 version=0/info 默认；快照导出与恢复保留该合法空表，不补写默认记录。配置 CAS 与会话复查同事务，写入时钟在读取事务事实后求值；日志/通知配置递增前拒绝安全整数耗尽，通知删除不因版本耗尽被阻止。通知行及投递行核对更新不早于创建，派发与结算均验证状态 CAS。审计 event_key 去重且核对原事件、身份、资源及路由/状态内容，不把重试时钟作为绑定内容；订阅选择通过 Model 同步回调消费事务内事件/配置/待投递事实，最多4096个 queued/dispatched，容量不足保留整个事件待分发，不丢一部分。选择采用分发时已启用的配置，且配置创建时间不晚于事件；不是业务写入时的配置快照。outbox 保存加密配置快照；禁用仅停止未来分发，删除令尚未派发项失败，已派发不撤回。审计保留最新50000条及尚未分发积压；投递保留最新50000条终态与全部在途项。业务提交与审计发布不是同一事务，崩溃可能遗漏尚未发布的业务事件，不承诺全局 exactly-once。
7. **生命周期与失败**：HTTP 最多64个、事件发布最多256个在途任务，晚失败有界汇总。其他业务 owner 排空后 Operations 才停止发布并排空请求/事件，再取消和关闭投递。投递串行、完整截止20秒；queued → dispatched 在网络前持久，成功/确定拒绝/未知分别结算 sent/failed/unknown。重启将 dispatched 围栏为 unknown，不重发；关闭和响应体/SMTP资源失败保留因果。日志按版本单调激活，避免迟到读取恢复旧阈值。协议边界保留 HttpInputFailure 的状态/安全码，正常输入拒绝不污染事件 owner 的关闭证据；观察的是响应决定，不证明客户端收到。投递观察器唯一记录其任务失败，关闭只等待后汇总；事件owner按错误实例去重，发布与请求两条追踪链不重复登记同一失败；仅 delivery_failed/delivery_unknown 可结算为投递结果，其他故障停止派发并保留原账本。日志失败仍启动独立分发收尾。
8. **当前能力与验收**：源码已接线，正式 UI 留 F1；安全有限事件替代任意 details，模板支持 event/subjectId/time，时间为UTC、Email为纯文本。B10已验证环回HTTP/Telegram协议、实际SMTP收发与全部/部分收件人拒绝、Access登录事件分发、配置CAS/秘密保留清除、在途关闭及重启不重发。Delivery Adapter仅按供应商结构化EENVELOPE/RCPT TO及4xx/5xx确认全部收件人在DATA前被拒，映射确定失败；部分成功和其他确认缺失仍保留unknown，清理失败不能被覆盖。真实公网供应商、TLS/SMTP认证、崩溃/满额/自然期限及其余producer仍待验，不把回执当交付成功。

### System 宿主诊断

1. **职责与范围**：diagnostics 提供进程运行时、RSS、主线程堆/外部内存/ArrayBuffer、进程累计 CPU、主线程 GC、主库 Worker 内存、模块资源和数据库版本；status 拥有本机资源与健康响应。不返回环境、路径、表内容、凭据或远端机器详情。模块资源不等同模块全部内存，不合计或计算“RSS 剩余占用”。
2. **子功能与目录**：diagnostics/service 管管理员复查、成功快照一秒缓存/在途合并及关闭，model 管转换，storage 和 adapters/sqlite 读 schema；platform/system 的 NodeProcessDiagnostic 持私有 prom-client（官方后继包 `@prometheus-io/client`） Registry、Gauge/Histogram、GC PerformanceObserver 和 ResourceCollector。真实 owner 只提供自身计数/逻辑字节事实；主库 Worker 通过 SQLite 技术协议采集自身 isolate 内存，不序列化业务对象估算内存。
3. **依赖方向**：管理员 HTTP → DiagnosticService → DiagnosticModel → Platform/Storage；Agent ToolModel → System public.collect，保持 host.inspect 授权。Bootstrap 经 register 装配 Remote/Agent collector；System 不引用其它模块的私有 Service，vendor 实例不穿透技术边界。各模块 HTTP 观察包装由 Bootstrap 安装，不改变原授权/审计。
4. **类型与转换**：Shared system/diagnostics 唯一拥有双端对象、有限模块/资源/单位/状态、错误与16KiB预算。内部 HostDiagnostic、WorkspaceResourceUsage 和存储事实各自独立，技术 ResourceCollector 留 Platform。Model、System public、HTTP、Agent ToolModel、前端 mapper 各持白名单转换；codec 校验八个分组、唯一名称、非负值与单位关联，未接入/失败组为空，不补零。
5. **入口与安装**：GET /api/v1/status 为不要求会话的进程健康响应，仍经全局来源/IP 准入，不证明数据库健康。GET /api/v1/system/diagnostics 要求管理员，Agent 窄能力仍需 host.inspect grant。没有公共 /metrics、调试端口或依赖外部 Prometheus 服务。registerSystem 注册 Storage/System source，Bootstrap 注册 Remote/Agent source 并包装七个模块 HTTP。
6. **数据、事务与并发**：不持久化指标；SQLite Adapter 读真实 schema。并发调用合并同一采集，成功结果最多复用一秒，不再使用四个调用拒绝上限；管理员准入和交付前复查仍逐次独立。各指标非原子快照，时间为毫秒/uptime 整秒。RSS/CPU 为进程级；process 的 heap/external/ArrayBuffer/GC 仅主线程，ArrayBuffer 已包含于对应 external。GC 自本诊断 owner 创建累计。Storage 另外报告主库 Worker 独立 heapUsed/heapTotal/external/ArrayBuffer，不计临时恢复预检 Worker 或 SQLite 原生页缓存；pending_requests 是采样请求派发前的未结算消息数，pending_operations 是 Runtime 已接纳且尚未完成的排队及执行项（事务整体一项，不重复累计内部 SQL）。只读 diagnostics 技术消息由 Runtime 合并、严格解码，不经过事务队列、不执行 SQL；仍等待 Worker 当前同步工作返回，避免维护排空依赖诊断形成队列等待环，不冒充无延迟采集。
7. **生命周期与失败**：Service 拒绝关闭后任务、追踪真实采集/复查；System 排空 status/diagnostics 后断开 GC observer，清空私有 Registry 与 collector 引用，在线恢复执行相同退订，数据库最后关闭。重复关闭共享 Promise，排空故障汇总。技术异常在 Model 映射 SystemCollectionFailure；数据库失败为 available=false，单组 collector 失败为 unavailable，其它组继续，未注册为 not_instrumented。HTTP 包装保留全部路由预算和路径元数据，finally 归还请求计数，不改变业务准入。无强制 GC、堆快照或常驻堆采样。
8. **当前能力与验收**：七个业务模块均有在途 HTTP；Remote 提供普通工作区、挂起/断开、输出/输入/日志队列/恢复逻辑字节、传输和状态订阅；Agent 提供执行/写入/请求，Storage 提供 SQLite 消息、排队/执行操作和主库 Worker 内存，System 提供诊断在途。Collector 支持同步或异步、逐组隔离失败，关闭后晚结果不得重新写入 Registry；实际采集仍归原请求与 Runtime 追踪直至收敛，不设置丢弃真实任务的伪超时。缓冲类别可能共享底层数据，未计量全部对象/解析器/原生句柄及其它缓存，只有计数的组明确标注内存未计量。正式数据页复用原诊断分区，折叠展示明细；静态及待远程证据归 testing，编译不等同行为验收。

B7 资源收尾：Artifact 的 HTTP 下载、模型读取和上传均绑定 lease，关闭共享同一 Promise 并等待已接纳 lease 与删除/清理任务（含后续元数据和事件）收敛；清理失败保留删除保护与有界故障证据，不因任务返回而释放保护。Preferences 各子功能在 preferences-lifecycle.ts 复用窄停机结果分类：普通业务拒绝不升级为停机故障，存储不可用/未知提交/内部故障仍汇总返回。

## 实例数据目录

1. **职责与范围**：数据库父目录为整个实例的持久数据目录。Bootstrap 统一装配数据库、背景资源、Artifact 和插件原包位置，各业务模块不推导物理路径。
2. **子功能与目录**：`bootstrap/data-paths.ts` 唯一推导 `appearance/`、`artifacts/`、`plugins/`；`create-app` 的启动恢复与 `module-manifest` 的 Blob 安装、在线恢复共同消费。
3. **依赖方向**：Bootstrap 依赖 Node path 与 Platform；业务 Service 不读取进程环境或依赖 Bootstrap。Compose 数据卷及现有 `NEXUS_DB_PATH` 不变，不增加第二路径配置源。
4. **类型与转换**：DataPaths 为路径 owner 内的局部结果类型；不修改 Shared、SQL schema、Blob 键或备份的 appearance/artifacts/plugins 逻辑分区。物理路径不进入公开协议。
5. **入口与安装**：`createApp` 取得 SQLite canonical path 后解析资源路径；启动恢复先于资源打开，模块安装按同一解析规则打开 NativeBlobStore。
6. **数据、事务与并发**：数据库与三个资源根同级，每实例独占数据目录，不同实例不能通过同目录不同 DB 文件名隔离。Snapshot 原有根目录校验、同文件系统发布、SQL 提交与文件日志对账不变。
7. **生命周期与失败**：资源目录由原 Blob Adapter 创建；WAL/SHM、恢复日志及暂存目录仍由原 owner 清理。本次破坏性布局不兼容、不自动迁移或删除旧资源，不改变未知结果围栏和停机收尾。
8. **当前能力与验收**：USAGE 与 DEPLOYMENT 记录新目录结构和空目录部署要求；既有备份与多实例夹具同步路径。静态结果归 testing，实际读写、在线/启动恢复及中断故障仍待远程验证。

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

BackgroundService 共用 16 个串行在途任务，输入 producer 返回应用命令，不带 HTTP 对象；名额覆盖 multipart 消费、等待、SQL/文件发布、交付与清理，shutdown 取消 producer/读取并等待实际任务。BackgroundModel 转换独立存储事实、内容格式证据和 Blob 应用能力/失败。Adapter 负责 pending→ready/retired 和引用/版本同事务；清理只有在同事务确认无引用后开始，文件删除确认后删除元数据。启动/后续上传/停机复查无引用记录；清理失败保留有界原因、持久记录及 cleanupPending，不删除活跃内容。文件根由 Bootstrap 安装 NativeBlobStore(resolveDataPaths(db.path).appearance)，即数据库父目录下的 appearance/；不在 Service/register 拼技术路径。只维护最新初始 v1 签名。

Shared 的实际预算与入口见 USAGE；字体、颜色、图片基础值/容量单独放 values，私有主题数/存储记录数/在途数归纯规则或 Service。正常失败、存储 unknown、内容发布 unknown、响应交付 unknown 分别在真实边界保留因果，不在 unknown 后自动激活 pending 或重传。HTTP 图片有完整期限、流回压、同源/no-store/CSP，旧图片不再暴露。静态和两轮源码复审证据归 testing；集成、插件 Agent host/runtime 和备份恢复源码已收口，行为统一 B10。B7 原执行链不重建。

实现后维护 USAGE 对应外观、Agent Plugin/MCP/Browser/ACP、备份章节，并记录 F1 完整契约/状态/错误/恢复差异；正式前端尚未施工。完整两轮源码审核与最终静态检查分别记录，行为统一 B10；不把旧正式消费者或旧测试 PASS 当作新后端完成。

HTML 库保持在 appearance 子功能：service/html-theme-service 管理来源/准入/覆盖政策，model/html-theme-model 转换应用、独立 storage 和目录结果；adapters/sqlite 管理文本/修订，adapters/github 解码厂商目录。17 个真实 preset 作为应用常量，无运行时旧 Backend/CWD 依赖。自定义内容与用户级修订表同事务，删除也推进修订，避免按名称删除重建后的旧 CAS 命中。列表只读摘要，不加载全部 HTML 正文；活动 HTML 内容副本独立保存。全产品备份必须包含 preferences_html_themes 和 preferences_html_revisions，而非继续寻找旧 custom_html_theme 文件目录。

远端来源写入经原 AppearanceService CAS，只维护一份 URL/版本。目录查询冻结当前来源，在异步读取后复查原版本；显式 repoUrl 不借用保存源。网络读取经 Model→独立 HtmlThemeCatalog→Github Adapter→Platform BoundedFetch，Platform 不含 GitHub/主题类型或业务 host 策略；应用期限、主机/来源/容量政策留 Preferences。上游增量预算、redirect:error、严格 UTF-8/目录解码、取消/reader 收尾各自确认，技术失败在 Model 映射。ImageInspector 同样只提供格式/hash/字节技术事实，应用 Model 转为 Shared MIME；格式识别使用file-type；SVG经fast-xml-parser识别根节点且关闭实体处理，不消毒或执行内容。Background/HTML 资源释放未确认时停止所属 owner 准入，有界保留因果，不能用任务结束冒充资源已释放。

### B8 集成与插件当前接线边界

签名 Skills 使用 plugins/model/plugin-skill-types、plugin-skill-rules 和 PluginModel 的 packageSource/skillDocuments。包 Adapter 解码已签名内容，Model 严格 UTF-8 转换，纯规则校验 skills/<name>/SKILL.md 路径与有限 frontmatter；最多64份、每份12KiB。验证安装与备份候选复用同一规则。原 ToolService 提供 skill_search/skill_read，按 context.read、原账本/当前 App/安装修订授权，读取绑定精确版本和 SHA-256；不自动注入包提示，不接受 allowed-tools 授权。文档是后端内部应用对象，无独立双端 DTO。Run 读取独立执行并由 PluginService 的 pending/期限/关闭统一追踪，不排在会等待 Run 的管理队列之后；交付前复核安装修订、当前信任和治理权限。

Agent integrations有独立IntegrationService/BrowserService；HTTP mapper→应用类型，Model→独立Storage或MCP/Browser技术能力，SQLite只持有存储类型和DDL/SQL/持久JSON解码。MCP/CDP Adapter不认识App/Run/授权；MCP通用endpoint包含不透明key/generation，Browser只接受技术连接选项和应用提供的URL判定能力。真实调用进入原ToolService；Browser的Run资源由原drainRun关闭，MCP续接身份由应用owner生成并绑定原Run/输入，不直接消费远端token作为授权。

插件已接 Publisher/Artifact stage/verify/install、不可变版本、安装查询、Run 退役及前端资源读取。Service owns 信任、容量、安装/升级/卸载准入；Model 转换应用、独立 Storage、包/Blob 内容和失败；Adapter 解码 manifest/签名 files，仓库Adapter将PEM的CRLF规范为LF后再交付应用，官方固定公钥核对不受等价换行影响；Platform packages 只提供惰性 TAR/Ed25519 技术能力。包条目与整个展开 TAR（包括元数据/填充）都受限。Stage 登记→Blob 发布→身份/CAS 复验→staged 分别确认；启动按完整大小/hash 对账 staging，不重放安装。专用目录为数据库路径加 `.plugins`。

暂存缓存政策由PluginService持有：新建前保留127条确定无引用缓存，再写入新包；Model先验相同包hash/长度、原Blob完整性与当前信任后复用verified/installed stage，不改变原ID/version，因此retirement仍精确绑定。Adapter在事务内排除versions/retirements引用和未知staging后将待回收项置failed并清除验证字段；Model先确认Blob删除再按认领版本删除行，失败保留记录且汇总所有清理因果，不把取消当作完成。不可变版本/退役包属于实际资源而非临时缓存，不能淘汰。versions列表与当前用户安装记录一对一，完整不可变版本账本保留。

插件 SQLite 通过注册的 Scope 存储任务参加同一事务，实际 App/声明 SQL 仍归 Scope Adapter；不 import Scope Model/Service，不自动授予 grants。首次安装禁用 App、空授权；版本/hash/声明来源不可变，builtin 初始化只更新 builtin。当前用户安装与 publisher 信任在 Scope 读取/授权事务核对。撤销、升级和卸载由 Scope 任务禁用/围栏旧 Run，Plugin Service 等待对应 Execution owner；draining 任务持久保存，重启不重放。取消退役保持旧版本与禁用状态。

前端资源使用与会话/安装 revision 绑定的短期 grant 路径；Service owns 名额及交付，Model 复验存活安装、包 hash/签名并转换字节，interfaces owns MIME/CSP/no-store/stream。只交付 frontend/ 命名空间，backend/ 与签名元文件不可读；匿名资源请求仍通过 grant 和原会话事务复查。独立插件数据具有明确model/storage对象；Model逐字段转换，Adapter解码JSON和事务事实，Service判断身份、当前信任/启用、CAS与总容量。有效数据按1024个有正文键/8MiB计，删除墓碑不占有效容量但保留CAS。每键仅最新有效操作保存正文，旧ID/hash/version元数据保留；更新、迁移或清除同事务退役旧回执正文，重放已退役回执明确version_conflict。删除/迁移回执不设累计32次拒绝。有效信任额度只计未撤销发布者，撤销身份不能复活。removed安装的明确清除只清正文，推进安装修订/数据墓碑并退役账本正文，保留旧意图摘要，原清除结果可重放。安装状态基础取值引用Shared，应用与存储对象独立；Stage/Publisher/Installation在Adapter校验身份、容量、时间及状态与验证字段的关联。单调版本耗尽在写入前拒绝，覆盖配置、凭据、安装、退役、清除及迁移，读取和既有确定回执不因此失效。

有限SDK/data RPC通过Shared agent/plugins/events与rpc-codec消费唯一协议，实际浏览器SDK归plugins/adapters/frontend；Shared不持有窗口/通道/计时器。SDK交付限定完整纯模块依赖图，浏览器import与已安装SDK路径显式链接；不公开任意Shared文件。HTTP先认证，Service取得名额后调用输入producer，模块mapper转内部方法；事务内复核grant期限/原安装修订/会话。HTTP输入producer与输出consumer区分预期拒绝/取消和基础故障，畸形输入与断连不停止全模块；Blob读取消是独立技术类别，Model转换且清理失败不被取消覆盖。HTTP把成功或安全失败关联到nonce/id/seq；响应失败不自动换operationId。原子写/重放/明确清除只在SQLite Adapter，资源交付名额覆盖实际stream及晚到清理；普通RPC结果交付归HTTP owner，断流仍可能是未知写入。

MCP owner统一计入已建立/建立中/关闭未确认资源，共享连接构造并取消、等待原构造；close绑定具体实例，不按当前key误关新实例。每连接仅一个固定DNS池，关闭等待池构造并执行SDK与池独立清理。Browser页面/节点按键保留组合键与原合法Key/Digit词汇，失败释放按键，聚焦前就失效旧快照。动作settleMs由工具Service选择默认250ms与Shared的0–2000ms协议范围，Model逐字段传为通用技术等待值，Node CDP Adapter执行有界空闲观察，只吸收正常TimeoutError；断开/取消仍传播。scroll的deltaX可省略为0；Shared动作取值覆盖全部15项。

两端SDK、实例持久恢复、仓库/推荐、显式迁移和备份导入恢复已有源码；B8源码审核已收口。B10已验证真实签名包暂存/信任/验证/安装、独立子进程及包内依赖、Host数据CAS/幂等/墓碑、禁用/启用/正常重启、显式完整快照迁移/升级、撤销/卸载/清除，以及descriptor资源和有限HTTP RPC；原进程身份退出与物化目录清理分别核对。外观字体/CSS/HTML副本、PNG/SVG字节、HTML中文路径/同名重建/预置回退和活动终端主题删除引用也有有限整链证据；B10另已验证真实Chromium的签名sandbox/完整SDK依赖/MessagePort握手、关联失败后的写入unknown、32项等待、8订阅/回调失败收敛，以及HTTP intents创建/幂等/权限撤销/重启、140失效候选后的可见列表、100条发送容量、实际附件/Range与前端RPC分段；父页是隔离测试桥，不代表F1。B10另已验证环回仓库配置/目录/签名下载安装、固定官方公钥和兼容推荐/离线已安装查询，以及真实子进程九方法的消息/附件/撤权链；官方新包完整安装、自然到期、已在途SDK/RPC撤权、其余崩溃与完整容量故障仍待验，不能据此宣称B8或B10整体验收完成。只有最新初始v1，当前精确签名为backend-next-v1-initial-20261015-b9-mutation-evidence。

Browser 补齐 back/scroll/press/select/wait 和 Artifact 字节消费：Service owns 端点顺序/退避资格、会话范围、操作期限及输出 Artifact；Model 转换独立应用能力和技术动作/字节/失败，技术 DOM/CDP 对象不泄露。会话交付在最后异步阶段后复查原 Run 与取消；快照采集及节点解析后复查原快照身份，节点对象由统一 finally 释放并保留操作与清理两项因果。Artifact 读取保护覆盖实际上传，版本/hash/原工具权限复查；截图/下载经原 Artifact 发布，而非大 base64 工具结果。下载策略限定本次 context，context、拦截任务、WebSocket 关闭分别确认。管理和执行共用同一配置 owner，正式前端 F1 未施工。

Integration 创建意图同事务保存首次安全回执，重放不从当前可变对象读取，删除集成不删除原回执；独立 storage receipt 无凭据正文，Model 显式转换，备份复用其 Adapter 解码器。Integration 原行/回执解码同时核对 MCP 的规范端点及私有 authority、ACP argv/cwd、身份/版本/hash/时间与 Shared 基础容量；不依赖 Shared 业务 codec。Browser 存储解码同时验证端点/明文许可/页面模式/数量和唯一性，恢复不放宽配置语义。

MCP 模型 discovery 直接消费真实 App 配置和目录，返回安全 ID/version/schemaHash，不要求人先刷新；目录选择/资格与 hash 一致性政策归 Service，Model 转换技术目录及哈希事实。管理页保存的 schemaHash 是观察值；调用必须与实际重取目录一致。input_required 的本地身份继续绑定原 Run/输入，不能重放未知副作用。Service 将128项待续接与在途预留统一计数，派发前取得续接名额，finally释放预留；异步返回后复查取消/关闭，已派发工具不降为确定不可用。Model保留后续存储/内部失败，不能将未知提交改写为可结算的远端执行未知；管理刷新在真实写事务的准入回调复查取消。关闭只由原任务观察者记录一次失败，远端结果未知与资源清理失败分别判定。MCP 客户端名称/产品版本由 Agent 安装传入通用技术契约，Platform 不硬编码产品身份。保存配置的 ACP 执行与直接 ACP 执行使用一致的 destructive 审批风险。AcpPermissionService 的准入和 Runs Adapter 的父关系复查同时识别两种真实父工具名，内层操作仍绑定原父 id/hash/target/version/modelStep；Child 使用继承工具集合中获准的父入口，不额外授予直接执行工具。每项内层许可独立审批及消费，外层批准不能代替。幂等创建先认证/核对原意图，再仅对新记录检查容量。

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

管理员GET /api/v1/agent/plugins/installations/:appId/runtime查询当前实例，GET /runtime/:instanceId查询该App历史实例；时间为毫秒。POST /runtime/acknowledge严格输入{expectedRevision,instanceRevision,instanceId,confirmed:true}：expectedRevision为当前安装修订，instanceRevision为原实例修订，不能借用一份版本。只有本地无绑定构造/实例、持久状态unknown或同实例已closed时允许，认证与安装CAS在实际事务复核；确认只解除围栏，不启动模块，不声称旧外部效果已回滚。保留unknownAt/acknowledgedAt及原实例历史，新实例不能覆盖旧未知证据。升级/卸载遇未知实例仍保持draining，确认后以当前安装修订继续原操作；运行中未知owner须先完成服务重启与目录对账，不靠确认跳过实际清理。B10已验证原child被SIGKILL后的unknown、失败关闭因果、重启不自动激活、原实例/当前安装修订确认及幂等、显式重新启用与历史隔离；quiesce内调用在worker边界拒绝，不代替已在途host RPC/流中撤权验收。正常closed且unknownAt为空的诊断历史按App循环保留最近128条，容量由Runtime Service经Model传入Adapter，历史不再造成累计4096次构造拒绝；当前/未知/曾未知后确认的实例证据不裁剪；实际host数据写入在异步查询/写入后、提交前再次复查原实例与当前授权。

Access已经提供窄provePassword公开能力，内部PasswordProof归authentication/model，CredentialConfirmation归accounts/storage；账户hash和原会话digest在实际事务执行时复核，技术失败在Model转换、公开失败在Access出口转换。System backups导出已消费该证明，并在采集和交付前复验；导入仅要求当前完整管理员会话，password 是备份解封密码，不复用导出的当前登录密码证明；维护后再次核对原会话，认证表不恢复。B10已验证跨实例不同密钥下Artifact字节、SSH私钥和Provider凭据真实消费及重建，目标密码/当前会话不被源认证覆盖；上传中断名额释放、待上传时登出拒绝及实际文件hash损坏拒绝均有回归，未知提交与完整文件类型/故障仍待验。

已有实例unknown拒绝新的构造/退役以AgentResourceFenced表达，公开仍为operation_unknown；它是未派发的新准入拒绝，不触发其他App的故障停机。复合排空由Agent错误owner的aggregateAgentFailures保留类别：全部子项只是已有围栏拒绝时继续为AgentResourceFenced，包含真实关闭/提交失败时仍为故障并保留全部cause。PluginService的卸载/发布者撤销及Runtime撤销共用该转换；不以通用operation_unknown包装抹去已有围栏的类别。B10已验证32实例/2构造边界、同App共用构造、批量撤销中的独立quiesce/dispose失败与健康实例收尾，以及卸载unknown重启→旧围栏拒绝→明确确认→继续卸载；目录清理失败/数据库确认未知仍分别待验。新存储提交未知、实际进程/host/清理失败仍保留真实故障并停止所属owner准入，二者不能混淆。

### 原生 Agent 工作区会话入口

1. **职责与范围**：Scope 的 WorkspaceService 复用原 Scope/Thread/Provider/Run/Context/Governance 用例，供原生会话与插件入口调用。插件 owner 仅持有插件安装与短期 grant 授权，通用工作区不反向依赖插件私有应用类型。
2. **子功能与目录**：scope/model/workspace-types 持内部命令/结果，scope/service/workspace-service 持用例派发；ThreadService/Model/SQLite 持当前入场事实、转换及实际事务。interfaces/http/workspace-http 与 workspace-mapper 持原生协议及唯一双向白名单。
3. **依赖方向**：原生 HTTP → Scope Workspace/Thread → 各真实能力 owner；插件 RPC → 原插件授权 → 同一 Scope Workspace。Platform 仅提供事务与准入机制；不包含 App 或 grant 类型。
4. **类型与转换**：Shared scope/workspace-http 与 workspace-http-codec 唯一定义通用18方法及严格解码；插件 frontend-events 组合该联合与自身九方法，不复制定义。新增 agent.threads.delete 仅接受 {threadId,expectedVersion}，返回 {appId,threadId}；HTTP workspace-mapper 逐字段转换独立应用命令和 DeletedThread 结果，codec 关联方法、线程及原生外壳的 App/version。ThreadAccess/事实使用 plugin/session 可辨识联合；原生使用真实 App version，不填写 installed/trusted 或虚构 grant。
5. **入口与安装**：POST /api/v1/agent/apps/:appId/workspace 要求当前完整管理员会话、真实 App UUID、appVersion 和 request。register 安装事务身份读取及原生路由；插件继续走原 descriptor/grant 入口。正式Host与DEV原生线程／运行消费者均使用该入口，正式Host不借用插件grant。
6. **数据、事务与并发**：原生当前会话、App 所属用户、启用/受信声明及原 App version 在实际事务前后核对；Thread 创建/改名使用稳定 operationId 与不可变回执，改名和删除绑定原线程 version。删除由 ThreadService → ThreadModel → SqliteThreadStorage.remove 执行：Adapter 在同一写事务读取全部 Root/Child 的不同状态和关联 Memory 最大版本，Model 白名单转换 ThreadRemovalFacts，Service 同步拒绝任何 pending/running/unknown（active_run_conflict）以及记忆版本耗尽（version_conflict），并提供事务实际决策时的更新时间；Adapter 不选择业务准入状态。事务依次将关联 agent_memories.source_run_id 置 NULL、版本加一且时间不倒退，删除线程或 Run 的 artifact attachments，显式移除 agent_run_children / facts / mailbox / budget_reservations 的 NO ACTION 引用，再删除全部 Run；步骤、事件、工具体、Job、审批、上下文及幂等结果按真实 FK CASCADE。协作表同时覆盖 operation_id/message_id 对待删工具的引用。最后删除该线程的 agent_thread_commands，并以 user/app/thread/version CAS 删除 agent_threads，提交前复核原身份/App。任一步拒绝或失败均回滚，不关闭 FK、不依赖延迟约束；Artifact 对象元数据和文件均不删除，Memory 正文及审核状态保留。删除不递增线程版本，允许最大安全整数的当前 CAS；不新增 schema/旧库兼容。组合调用经 ThreadModel 的事务准入能力消费同一规则，不在接口层复制 SQL 或业务判断；后台执行仍由原 Run owner 明确脱离临时请求准入并持续复验自身授权。
7. **生命周期与失败**：Scope 入口和交付前保留当前事实复查；已成功写入后交付或复查失败返回 operation_unknown。删除也纳入原生 HTTP、插件 Service/HTTP 及交付 SDK 的写入分类：没有 operationId 仍是副作用，取消/超时/畸形或错 App 回执不能解释成未提交。读操作不授予执行权限；读列表不证明未知写入未提交。删除没有额外幂等回执或墓碑，确认后再次删除返回 not_found，不自动重放旧创建/改名或套新版本重试；未知结果保留原 threadId/expectedVersion，先只读核对。完整工作区编码预算8 MiB+1 KiB，Thread 列表最多50项，正文页遵守各自更窄预算。资源已销毁时不继续接纳新的请求步骤。
8. **当前能力与验收**：原生18方法生产者及Shared已接线；正式Host/Run/正文/审批/Child的原消费者和独立应用转换保留，删除 UI 由前端批次接入，步骤／工具审计继续消费各自只读HTTP。删除验收覆盖严格请求/回执关联、原线程/App CAS、Root及Child三种活跃状态、关联记忆版本耗尽、提交前撤权/末步SQL失败整批回滚、工具/审批等级联、记忆/Artifact保留、其他线程隔离和 foreign_key_check。当前限定隔离 SQLite 实测不代表浏览器/插件整链已验收；真实并发、提交/交付确认丢失及资源清理故障仍待对应远程或现场验证，不沿用旧 Actions PASS。

### B8 前端SDK与显式迁移当前边界

ThreadService持有名称归一、512个实际线程容量及明确区分的插件/原生会话准入；历史命令不再计入4096次终身配额，原幂等身份与结果保留；ThreadModel持有应用/Storage转换，Thread SQL持有keyset、CAS和不可变原结果。普通HTTP创建也在同一存储事务消费同一线程容量。线程存储→应用转换唯一归scope/model/thread-mapper，协议投影唯一归interfaces/http/scope-mapper。新Thread具有必填version/updatedAt。Provider可选模型的protocol来自实际resolve结果，不由配置缺省推测。

WorkspaceService使用原RunService与ContextHistoryService：Root列表按thread_sequence续页；entries只读Root用户输入和模型文字事件，按码点分片，不读工具/私有reasoning。SQLite技术函数nexus_text_length/slice保留NUL和Unicode；片段未完不推进后项。appendInput在原Root终态/version同事务校验后创建同Thread后续Root，原身份/version纳入幂等hash，模型/连接重新显式选择，不注入活跃上下文。

前端RPC由Shared frontend-events/frontend-rpc-codec定义27方法；core events/rpc-codec/backend-sdk仍只有九方法。前端完整预算8MiB+1KiB，descriptor的maxMessageBytes同源声明；核心子预算/IPC仍512KiB。SDK由Backend构建时通过esbuild打包实际Shared及第三方依赖，以独立浏览器ESM交付；不再运行时改写import或维护拆模块白名单。frontend-sdk仅持有纯类型，窗口/MessagePort/计时器归原Frontend Adapter；Run订阅是500ms有限轮询原事件分页，不是新增WS/事件中心。退订取消原读取并等待，close共享Promise，异步回调由原订阅追踪，过期结果不发布。正式父页F1。

组合写入经PluginModel→Storage→SQLite技术admission scope，在实际事务前后复核原会话、安装revision、启用、publisher与期限。排队操作捕获原scope；原RunExecutionOwner通过RunModel的应用任务能力明确脱离请求临时scope，再按自身持久权限执行，不意外继承浏览器grant的生命周期。最终响应前再次复查，已提交变更失去确认时返回unknown，不换意图重发。

插件迁移从旧可执行migrate回调改为管理员显式快照转换：prepare-upgrade排空并停在draining→读取snapshot→提交含全部有效键/版本的完整数据集→原目标upgrade。政策、配额及取消退役限制归PluginService，Model转换及指纹，Adapter同事务核对快照版本、写数据/墓碑、推进安装revision并记录不可变migration回执。retirements.base_revision区分迁移前后；迁移已提交不允许取消退役。未知数据库提交不重跑转换或插件代码，重启保留draining。1024键/8MiB正文/52MiB完整线预算，32个迁移意图；R1/R2 全应用备份已接线，整批审核与行为验收分别执行。

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

remote_machine_mutations 只持有活跃资源锁；新增 mutation_claims 与 mutation_evidence 两张持久表保留阻断/释放历史。正常已确认操作释放并移除临时 claim，blocked/released 证据不自动清除。活跃资源和未释放claim不设全局数量门槛，每claim保留16份证据的协议预算；released历史保留审计，未确认占用不能循环覆盖；快照校验同步移除全局计数限制，仍核对完整锁集与证据。记录证据、推进 claim 修订同事务，释放核对原 claim 修订与最新 evidence 身份、完整锁集并原子移除锁/保存 released。读取和恢复写入在实际事务入场及交付/提交前检查原管理员会话；末次复查失败回滚本次写入。会话摘要的同步技术失败同样在Model转换。只修改初始 v1，无旧库兼容。

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

RemoteMachineModel 在主机校验拒绝时保存实际握手 endpoint、观测指纹和原 pin 到独立应用错误；仅 Workspace connect 的 WS 失败出口白名单投影为 Shared challenge。信任仍由 Targets 管理确认接口持久化，不自动录入；未知资源清理不能降为可重试的密钥拒绝。

Targets Host Key列表HTTP与正式管理前端共同消费Shared集合上限10,000项/完整JSON16MiB，超限413 limit_exceeded且不截断。确认按host/port覆盖，移除按host/port删除，不提供指纹或版本CAS；管理前端明确提示此语义，不把读取当作写入前提保证。主机名容量唯一归Shared `targets/host-keys/values`（253 UTF-8 bytes）；HTTP codec、可信Service入口和SQLite行解码一致校验编码容量，Service另持有小写规范化及主机名准入政策。SQLite解码拒绝损坏事实，备份复用该解码器；不为旧非法记录保留兼容分支。

Targets `ssh-keys/ssh-key-rules` 唯一持有密钥名称规范化，普通管理和导入共用；`target-validation` 提供模块内文本编码/容量基础校验，秘密正文不规范化。Service和纯规则消费Shared基础容量，Model保持秘密与存储转换；SQLite的Proxy/SSH Key行解码校验正ID/版本、非负时间、有效端口及公开文本编码容量，备份复用同一行解码。独立SSH Key和导入/测试私钥统一64 KiB。旧Proxy管理可存key字段，但旧SSH resolver/传输只消费用户名/密码；新设计不保留无真实运行消费者的key字段，正式前端差异归F-R40。

Targets保存SSH解析入口同样由 `public-mappers.toStoredTargetRequest` 将Trusted请求逐字段转换为内部请求，包含可选expectedFingerprint；不能直接把public对象交给Service。SSH密文快照与未保存引用只供resolver Model实现使用，类型局部定义于该实现，不进入Service应用类型；Host Key公开确认请求直接复用Shared唯一契约，再由register白名单转内部命令。RemoteMachineModel建连后只返回独立RemoteMachineIdentity的id/fingerprint及原机器能力，不把可信解析中的明文认证、Proxy或Jump对象传给终端、Files等后继Model；完整目标仅用于本次握手转换。

Targets恢复预检通过 `registerTargetsSnapshot` 显式安装Connection与Credential两个Model转换回调。Connection回调将完整存储连接投影为应用事实，复用元数据及图规则；Credential回调复用SSH-only密钥规则，Adapter仅按索引关联读取事实并调用回调，不引入应用规则实现。凭据行解码唯一归connections/adapters/sqlite/connection-credential-sql，独立Storage联合记录由SSH解析、Desktop读取和快照复用；身份/时间/方法与秘密字段互斥均严格解码。当前连接元数据与秘密输入容量归Shared connections/values，Service使用UTF-8字节，真实SQL仍只在Adapter；恢复不自动规范化或放宽旧非法数据。

Targets每条连接的直接跳板协议容量16项归Shared，与递归深度/总展开政策分别表达；完整连接应用校验和持久行解码都检查直接集合容量。快照Adapter在秘密转为便携明文后、恢复重新加密前按Shared原始字节容量检查；加密膨胀不计为原始秘密长度，超限当前数据拒绝导出、超限备份拒绝导入，不通过截断或兼容放行。

连接元数据的持久解码唯一归 connections/adapters/sqlite/connection-sql 的 readConnectionMetadataRow，管理读取、Desktop 同次元数据/凭据查询及 SSH resolver 复用；Model 保留白名单转换，不重复存储形状校验。Proxy 导入命中既有记录也复用 readProxyRow，不能仅凭 ID 与用户名绕过持久表示校验。

代理凭据同样由proxies/storage独立StoredProxyCredential表达，SQLite唯一readProxyCredentialRow校验正ID、非负时间和非空密文，SSH解析及快照预检共同消费；无凭据行仍表达null，不把损坏行解释为没有密码。

### Remote 会话与文件资源转换边界

Workspace FileResource 的有效性由 workspaceAuthority 与原 SSH owner 管理；两分钟 idle TTL 只适用于 workspaceId 缺失的独立 HTTP 文件资源。定时回收、owned 与 runAdmitted 三处采用同一适用范围，不能让仍连接的 Workspace 因文件面板闲置而在下次操作时被拒绝。身份、指纹、资源存活、关闭状态及 Workspace 当前实例校验仍逐次执行。

Files 的二进制读取、目录 ZIP、下载类型探测及票据准备由 RemoteFileService.runTransferRead 统一绑定原 Workspace owner，复用 withUploadResource 取得同目标/指纹的独立 FileResource。读取的取消与清理只作用于该临时资源；原 Workspace 的主 SFTP 不因读取取消而退役。任务沿原 run 的 active/inFlight、身份/指纹复查、总期限及模块停机链追踪，关闭失败仍记录到原 owner 的 transferCleanupByOwner。协议入口和 Model 白名单投影不变；SFTP permission_denied 在 Model 映射为已有 forbidden，不把确定权限拒绝当远端不可用。普通目录元数据仍使用主资源；隔离不宣称 SSH 路径快照或远端回滚。当前源码与静态证据见 testing，真实 HTML、ZIP 和取消组合仍待远程验收。

1. **职责与范围**：Files、独立PTY和Workspace共用技术凭据能力，各自Service持有身份、归属、期限及准入政策；凭据不进入公开结果之外的额外通道。
2. **子功能与目录**：files/model/file-model持有文件票据随机值/摘要；sessions/model/session-token-model持有会话凭据表示。Shell与History Model封装终端集成/检查点，Service不操作技术Port。
3. **依赖方向**：Service→所属Model→Platform SessionTokens/SSH/Terminal；register安装SecureSessionTokens，Platform不定义业务对象。
4. **类型与转换**：应用内摘要为不透明字符串，Model转换字节和技术异常；HTTP/WS保留逐字段映射，Docker labels保留原生CLI返回的字符串语义，不将标量展开成字符索引对象；数组及嵌套对象仍逐字段投影。Cookie及终端流控窗口引用Shared唯一取值。
5. **入口与安装**：Files/PTY开启HTTP在真实finish前保留失败撤销路径，取得资源后交付等待最多15秒，Files使用已绑定release，PTY由原SessionOwner释放；按ID的外部关闭仍认证。事件发布后重新核对PTY身份、实例及存活，失败不交付旧资源。
6. **数据、事务与并发**：Files Service 的 FileMutationQueue 按原 Workspace 排队；同一目录、不同目标的有界上传组，或同一真实目录中普通文件到不同新目标的无冲突压缩组，共享一个原 MachineMutation 持久 endpoint claim，最多16项，两类不混组。压缩组按读写集合拒绝输出与其他输入/输出重叠，准入与派发均核对真实父目录、普通文件和目标不存在；目录/链接源、覆盖、解压及其他写操作封组排队。父目录检查/创建串行且拒绝链接祖先，私有stage与替换各自独立；同名/不同目录也封组排队。成员执行前后仍逐项验证原身份、指纹及Workspace权限。全部成员与专属资源排空后统一结算claim，任一unknown保留blocked；结算失败影响所有写入结果回执；明确没有启动writer且独立资源已排空的取消，在仍有其他成员持有该claim时可先退场，不能据此释放持久claim或提前交付写入结果。已排队且未派发的取消可立即结束且不会后来执行。不同Workspace、Agent与后台传输不共享此组。本边界不新增存储；搜索限制已扫描及待遍历目录、单目录条目；列目录/递归删除的私有预算由Files Service持有，不替代Shared编码预算。
7. **生命周期与失败**：上传stage取得后如取消或资源关闭，仍执行绑定discard；健康且未commit的stage在取消、断流、Workspace关闭和quiesce期间停止接纳新块，保留原signal排空已派发WRITE，再关闭句柄/删除暂存/释放专属连接。active操作标明upload或other，关闭不重复硬取消已由上传owner接管的排空；未取得stage/已commit准入或原signal失效仍取消并保留unknown。取消只受理，不等待同组结算，终态回执仍等待整组claim。无法确认远端清理保留unknown。WS退订失败继续其余清理。Workspace丢弃撤销attachment的待发输入，drain退订从活跃列表移除；退订/集成释放异常转入原owner关闭。长期清理诊断保留16个样本及总数，同一Error去重，未确认资源事实仍保留。
8. **当前能力与验收**：源码规则见H-06、E-01.1/E-05.1/E-06.3/E-08.1；行为/容量和未知结果说明见USAGE，静态与待B10场景见testing，不将源码审查作为行为通过。

压缩Adapter在首个写入前同步发送随机标记，发送失败不启动writer。Files Model选择SSH的TERM排空模式，完整读取stdout后仅将实际远端TERM退出且没有该标记映射为FileCommandNotStarted；已见标记、断流、协议失败或5秒收尾期限内未得到退出均保持unknown。Platform归一ssh2的信号名称，远端exit-signal本身仍是副作用unknown，不为Agent或其他命令改变结果分类。派发期间取消保留晚到channel并请求终止，连接关闭与信号受理不冒充实际退出；不新增远端helper或工具。

### Platform 传输与观测资源边界

1. **职责与范围**：HTTP/WS、SSH/SFTP、终端渲染和ACP提供技术能力；Remote监控Service持有用户准入、采样订阅与任务归属。普通SSH与Agent复用技术能力，分别保留授权及活跃资源owner。
2. **子功能与目录**：Platform既有http、ssh/adapters/ssh2、terminal/adapters、acp/adapters持有传输实现；Remote monitoring/model转换技术事实，monitoring/service管理订阅及缓存请求。
3. **依赖方向**：Service→Model→技术契约/Adapter；Platform不引用业务类型。诊断采样汇总复用通用有界FailureSummary，不新建业务分发或兼容层。
4. **类型与转换**：ACP技术cleanup_failed在MachineAcpModel显式转为RemoteResourceCleanupFailure；操作失败与清理失败分别保留因果。SFTP路径由Adapter校验实际字符串，协议出口不推断第三方异常。技术目录项与realpath保留合法POSIX字面量，包括换行；不得把终端/归档/Agent的控制字符政策下沉成全局SFTP拒绝。各应用与Shared边界继续按自身契约校验。
5. **入口与安装**：HTTP安装有界channel与Desktop原生WS，两者均接管socket error。HTTP传输等待由原请求aborted、响应finish/close与原socket close共同结算并退订；业务handler与资源收尾仍独立等待，不将传输中断当业务完成。Artifact HTTP将具名AbortError连同原signal交协议取消转换，应用/存储/清理失败继续保留到排空；仅signal取消不能掩盖其他错误。有界channel在实际派发排队消息时复查准入generation及关闭状态，输入队列同时考虑路由允许的文本/二进制预算。
6. **数据、事务与并发**：不新增表或迁移。SFTP复合replace共用完整操作期限，恢复/备份删除另有独立清理预算；确定目录打开拒绝不退役健康lease。
7. **生命周期与失败**：SSH Client/SFTP先请求结束，2秒后请求destroy，再最多等待2秒确认真实close；超时为清理失败，不当作关闭成功。SFTP未确认资源仍归原连接owner，晚close仅解除原实例。SFTP Adapter单独登记流的期限与取消监听清理；流错误及lease关闭均解除本地等待，即使供应商流不发close。流清理回调不替代SFTP channel关闭确认，未知临时文件仍由Files owner保留。HTTP、SSH channel及路由独立清理不被首个同步异常中断；ACP取消只执行一次并等待读写及permission任务。监控退订后的baseline清理被追踪，采样清理失败有界保留到close；日志停止准入后不新建读写owner。
8. **当前能力与验收**：保持显式mapper、Shared协议和正常功能；终端导出用线性首尾裁剪，Shell setup按完整marker预算校验，结果起始标记不依赖先收到命令回显；无回显时保留普通输出和可能跨块的标记前缀，已识别回显时隐藏原setup命令。Workspace初始化等待后重新核对身份、取消与记录实例，再交付附件。源码/静态与行为证据归testing；SFTP上传中断与实际句柄收尾已有B10有限证据，其余故障和容量仍逐项待验。

### Bootstrap 与外部能力资源边界

1. **职责与范围**：Bootstrap负责模块安装、维护替换和关闭；Platform提供AI、Blob、Browser、MCP、投递及隔离运行时，Agent/Preferences/Operations的应用政策仍归各自Service。
2. **子功能与目录**：沿用bootstrap与platform/{ai,blobs,browser,delivery,isolation,mcp,network,packages}；Provider与Registry保持原子功能Model、storage和sqlite Adapter，不增加分发或兼容层。
3. **依赖方向**：Bootstrap只读模块register/public及技术契约；Service经Model使用技术能力，Platform不引业务对象。Operations最后关闭，以覆盖其他模块退出时发布的事件。
4. **类型与转换**：Provider/Registry应用、存储与技术对象保持独立白名单；BrowserSession由BrowserModel封装为应用能力。具名cleanup_failed保留到Model；HTTP安全出口不传cause。
5. **入口与安装**：模块安装失败清理已安装owner；停止准入逐项尝试。维护绑定保存原HTTP origin取值，调用方修改原options对象不会改变后续替换的Cookie策略。
6. **数据、事务与并发**：唯一初始v1及业务SQL归属不变。Blob发布前复查取消；临时文件删除需目录同步，发布后失败保持io_unknown，清理未确认单独表达cleanup_failed。
7. **生命周期与失败**：独立释放实际调用放入Promise任务，同步抛错不跳过其余资源。Fetch取消reader与释放锁分别保留失败；Delivery保留HTTP主失败及释放失败，NotificationModel转为独立NotificationCleanupFailure；Service停止准入并结算当前投递unknown，结算失败保留双因果，关闭不能报成功。Browser构造取消在已建立CDP后保留释放context所需通道，交付前失败交给同一session.close；不重复关闭context，也不关闭共用浏览器进程。MCP连接失败分别释放SDK及dispatcher。
8. **当前能力与验收**：AI双协议、Provider/Registry、包解析/签名及隔离进程保留现有语义；本节不扩大功能或部署前提。静态结果和逐文件证据归testing，真实外部依赖、取消和故障场景仍待B10。

### Targets 服务端最近连接

1. **职责与范围**：Targets 拥有保存连接的最近成功观测；RemoteSessionService 在 PTY 建立后、DesktopService 在 TCP/TLS 桥就绪后调用，覆盖 Workspace 与独立/Agent shell、RDP/VNC。测试、监控与已有会话恢复不记录。桥就绪不证明远端认证或画面成功。
2. **子功能与目录**：复用 connections 的 ConnectionService、ConnectionModel、ConnectionStorage、connection-sql/connection-schema；删除 desktop-target 的 markAttempt 全链。没有第二张历史表或客户端写历史路由。
3. **依赖方向**：Remote 经 Targets public ConnectionUsage 调用；Service 验证观测时间与基础值，Model 转换存储调用/失败，Adapter 独占 SQL。RemoteSessionService 在开启前取得只读配置身份，桌面复用实际授权的可信配置快照。
4. **类型与转换**：StoredConnection、内部 ConnectionSnapshot 与 Shared TargetConnectionView 各自持有必填 lastConnectedAt:number|null；存储、public、HTTP 与前端 Summary mapper 白名单投影，均使用 Unix 毫秒。Workspace 原有附件秒时间仍只表示运行时附件事实，不再驱动最近连接列表。
5. **入口与安装**：registerTargets 安装后端专用 connectionUsage，registerRemote 注入两个独立 PTY owner 与 DesktopService；GET /api/v1/targets/connections 和单项读取经既有认证接口返回持久时间。管理写命令不接受 lastConnectedAt；桌面签发返回 ticket 与仅在浏览器内存消费的连接参数。连接准入、Access 与 Agent 授权继续由原 owner 执行，观测能力不授予执行权限。
6. **数据、事务与并发**：现有 connections.last_connected_at 唯一存储毫秒/null，同一 UPDATE 核对 id/version/created_at/type，仅在新时间更大时更新；不推进 version/updated_at，过期配置结果不覆盖新配置。初始 v1 与精确安装签名同步更新，不兼容旧开发库、不自动转换秒时间。新建/导入/克隆为 null；备份原列覆盖不变，预检复用同一行解码和时间关系。
7. **生命周期与失败**：持久调用由原 opening 任务等待并参与关闭；写入失败进入原资源关闭和安全失败路径，已提交而后续交付失败不回滚历史。写入后 SSH 再检查 signal/accepting/isOpen，桌面再复查身份/配置/存活。未匹配或已有更新观测是无操作；不重新创建被删除记录、不自动重派建连。
8. **当前能力与验收**：前端成功挂钩只读刷新元数据，Store 不保留 recent Map 或 markConnected；现有搜索、排序、连接编辑视觉不变，无新增三语产品文案。静态及待验范围归 PLAN/E2E，重启、并发、真实 SSH/RDP/VNC 与存储故障未由编译证明。

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

Shared `remote/transfers/server-{values,model,http,codec}` 持有有限值、完整安全任务及五入口契约；目标目录可为根目录，源项仍禁止根目录，Native Adapter 不为根目标重复追加斜线，路径空白保持原值；独立64目标/256来源计数门槛移除，实际请求/任务字节预算保留，子项展开按实际编码动态校验；sourceItemIndex按该任务自身来源数组校验。后端应用对象独立归 `transfers/model/*-types`。HTTP、Model、前端 mapper 均逐字段投影；主机密钥 pin、密码和私钥只在后端可信转换与技术 Adapter 间短暂存在。

### 5. 入口与安装

Remote register 安装 `/api/v1/transfers/send`、`status`、`status/:taskId`、`cancel/:taskId` 和 `DELETE /:taskId`。后台受理与真实结束分开；列表以有界页读取，详情保留。正式前端同步迁移，不维护旧 Protocol 桥。

### 6. 数据、事务与并发

任务列表维持进程内语义，不按32个在途/unknown任务拒绝，保留最新100个已确认终态；unknown不裁剪。最多5个互不冲突父任务并行，父内子项串行；父期限1小时含排队，单子项继承父任务剩余期限，不再误套5分钟截断。每个子项在源/目标真实 endpoint 的持久突变围栏取得后才执行，保存可关联子任务的 claim ID；重启 held 转 blocked，不重派。列表重启后清空不代表远端结束，恢复依据归已有机器突变观察/证据/释放接口。无新迁移或伪造持久任务表。

### 7. 生命周期与失败

任务期限包含排队，取消只发信号；已派发且未确认退出、秘密清理或资源释放的任务保持 unknown。后台监控原会话和捕获的配置指纹；撤销停止后续派发。源可以使用既有代理/跳板；目标原生直连不隐式忽略配置路线，非直连明确拒绝。Model只取实际已验证握手的目标公钥，Adapter重算指纹并匹配冻结pin后生成私有known_hosts；源端CLI严格校验，不额外keyscan或关闭验证。原始key只在技术转换Model之间消费，不进入Service/Shared。源端管理员仍能读取交付的凭据，需逐次确认信任源端。

### 8. 当前能力与验收

五HTTP、Shared完整codec、正式API/store/SendFiles/Progress消费者已实现。列表采用UUID游标每页8项，时间为Unix毫秒；输入拒绝同名/嵌套源与同文本endpoint，scp/rsync均复制目录本身。命令和原始结果留Adapter，有限失败经Model映射；原会话在独立持久准入事务及执行期复查。真实双端点OpenSSH与受控取消/未知/重启/清理、正式store浏览器回归见testing；完整页面及跨业务撤销仍C2-D，公网与非直连目标不在通过范围。部署与生产切换不在本批范围。

## 连接目录与监控读取性能

1. **职责与范围**：Targets 连接 Adapter 拥有目录关联批读；Remote monitoring 拥有主机候选筛选及指纹复核；SQLite Worker 拥有预编译语句缓存。优化不改变连接数据、授权或监控公开结果。
2. **子功能与目录**：connection-sql 在原事务中批读 connections、connection_tags、connection_jumps 并复用逐条解码；observation-targets 定义原有主机分组规则；worker 缓存最多 128 条、SQL 文本不超过 16,384 字符的 StatementSync。容量仅用于淘汰缓存，超出仍正常执行。
3. **依赖方向**：保持 Service → Model → Adapter；SQL 及数据库句柄仅在 Adapter。monitoring 的 Model/Service 复用本模块纯分组规则，不新增跨模块入口。
4. **类型与转换**：沿用 StoredConnection、ObservationTarget 和 WorkerRequest；存储关联仍按原字段、容量、位置和路由约束校验。不新增 Shared 字段，不缓存身份、授权或目标凭据。
5. **入口与安装**：原连接目录、资源状态入口与 Worker 安装点不变，无新 HTTP/WS 路由或迁移。
6. **数据、事务与并发**：目录三次 SELECT 共用原事务和稳定排序；定向监控在指纹计算前筛选同 host/port 候选，保留同主机连接回退。返回前按请求主机重新读取并线性分组校验完整配置指纹，仍含代理、跳板与凭据变更。
7. **生命周期与失败**：定向目录保留其它主机有效缓存与在途索引，每次读取淘汰过期样本，避免仅做定向刷新时长期保留失效项；保留原授权复核、取消、失败不缓存及真实任务清理。语句缓存按使用顺序淘汰，事务控制保留缓存，其它 exec 清理，数据库关闭前清空，不改变执行与错误协议。
8. **当前能力与验收**：源码已接入原消费者；全量监控仍执行必要的前后指纹校验，不宣称消除所有目录成本。静态检查、产物及未执行行为范围见 testing/E2E；性能实测与并发配置变更回归按 PLAN D17 留远程验收。

### 后端诊断日志

1. **职责与范围**：Platform logging 负责结构化诊断，Operations 负责持久阈值及审计；诊断不能改变业务成功、失败或恢复结论。
2. **子功能与目录**：沿用 `platform/logging`，安全投影和异步关联上下文在该目录；各原 Service/Adapter 记录真实生命周期。
3. **依赖方向**：Bootstrap 创建一个 Logger，注入 Operations、网络与业务 owner；无模块反向依赖或全局可变 Logger。
4. **类型与转换**：复用 Logger/LogFact，诊断字段仅显式标量；异常只提取有限代码、类型、源码位置及有界 cause 链，不打印原文、请求或供应商对象。
5. **入口与安装**：createApp 向安装与恢复后的模块传递同一实例，main 在配置读取前启用；原设置接口管理同一实例的日志等级。
6. **数据、事务与并发**：日志写 stderr 单行 JSON；不增加数据库记录或改变事务。HTTP/WS 使用后端生成关联 ID，异步上下文随实际任务传播；事件回调只绑定诊断自身上下文，不捕获其它 owner 的事务或授权作用域，不信任客户端自报关联字段。
7. **生命周期与失败**：记录启动、停机、恢复、入场、派发、结算和清理；Job 与插件运行实例在原 owner 持久结算及关闭处记录；WS 字节汇总避免逐帧日志。诊断输出失败不阻断原任务，原异常继续由原 owner 处理。
8. **当前能力与验收**：等级、字段、查看方式及保护范围见 USAGE；源码审核和静态证据归 PLAN，行为按 D17 留远程验收。

### Agent 模型目录名称与能力解析

1. **职责与范围**：Agent providers/registry持有模型名称匹配及明确模型修正，Platform仅转换models.dev供应商事实。
2. **子功能与目录**：原registry-rules组装快照与解析完整能力，registry-matcher持纯名称评分；原Model、SQLite Adapter及HTTP mapper保持各自边界。
3. **依赖方向**：Registry Service → Model/纯规则，Model → storage/Platform；匹配器不读取网络或存储，不绕过Provider冻结时观察冲突核对。
4. **类型与转换**：RegistryDefaults、StoredRegistryDefaults和Shared AgentRegistryDefaults独立定义完整能力；白名单mapper投影缓存键、默认推理等级及必需推理，两个decoder核对等级唯一性、默认值所属及mandatory依赖。
5. **入口与安装**：沿用model-registry/resolve与refresh，无新路由或安装点。
6. **数据、事务与并发**：内部快照 schemaVersion=2，仅保存 provider/model 键，不生成丢失来源的裸别名；旧快照通过原缓存无效机制提示重新更新，不自动迁移。精确名优先于前缀/分隔符及系列日期/等级/thinking/fast后缀，同级冲突不猜测，OpenCode聚合候选不覆盖原厂。名称变体不构成能力证明；只对支持的等级后缀选择默认等级。保留旧正式resolver的明确模型缓存键与推理修正。
7. **生命周期与失败**：沿原refresh/load owner、取消及安全错误映射；无目录或无明确匹配返回null，不自动发起外部模型请求。
8. **当前能力与验收**：前端新增模型与显式应用目录均消费完整Shared能力；使用与恢复见USAGE，静态及限定只读验证见PLAN/testing，完整交互仍待远程。

### Agent 图片生成与模型预算

1. **职责与范围**：Provider/Registry 保存声明能力，文字预算可缺省；Run 持文本执行预算。ProviderImageService 统一直接 Images Run 与图片工具的网络生成、App 文件落盘及安全结果。
2. **子功能与目录**：原 providers/service、platform/ai/adapters/model-image 与 openai-compatible；RunExecutionOwner 持直接派发，原 ToolService 持 image_models_list/image_generate，Artifact 原 owner 持输出。
3. **依赖方向**：Run/Tool → ProviderImageService → ProviderService/ArtifactService；Model/技术 Adapter 各自投影；不从网络 Adapter 写数据库或绕过 Run 派发记录。
4. **类型与转换**：Shared 的 images 协议、supportsImageGeneration 与可选文字预算同步应用/存储/SQLite/前端；新 ProviderImageRequest/ImageArtifact 留 providers/model。Artifact 的 model actor 与独立存储授权逐字段转换，不伪造工具授权。
5. **入口与安装**：原模型选择器同时消费 Images；配置分对话/图片两组。图片工具由原 toolDefinitions 安装，需原 artifacts.write/批准。新增 GET /api/v1/agent/apps/:appId/artifacts/:artifactId/preview，复用认证下载读取与 Range，限定 PNG/JPEG/WebP、nosniff、private/no-store。
6. **数据、事务与并发**：直接图片沿模型 Step 的 reserve/dispatch/finish 与原请求/并发预算；工具沿 ToolCall 账本和原工具预算。Artifact 写事务核对 Images frozen protocol、原 dispatched Step/hash、当前 Run 与 Provider 代际。图片输出继承原文件预算/期限，不冒充网络与 SQLite 原子事务。
7. **生命周期与失败**：Provider请求跟踪及停机/配置修改取消覆盖图片请求。正式直接Images与image_generate统一继承Run剩余绝对期限，ToolService不为image_generate另设普通工具短超时，ProviderService该入口不再添加固定五分钟计时；网络生成、文件发布和后续验证共同消耗同一任务时限。管理图片测试仍独立五分钟，发现等管理读取仍十秒。Platform仅为图片ModelSdkRequest建立独立Undici Agent，其它请求保留原连接池，headersTimeout/bodyTimeout为0，由原应用signal控制完整等待（连接建立仍受传输自己的连接时限）；close分别尝试reader与dispatcher.destroy，保留独立失败和原错误身份，不使用全局连接池修改。外部 JSON 与 base64 有界读取；不获取返回 URL，不接收 SVG/HTML。付费请求未知或落盘失败不自动重试；本地取消不证明供应商回滚。全局日志不记提示词/图片/凭据。
8. **当前能力与验收**：一次一张、按Artifact剩余空间与Node字符串/Buffer技术容量约束、供应商默认尺寸/质量。直接图片只用本次描述，文字工具可传 Agent 整理的描述；不接入编辑、视频、音频。前端 Markdown 仅允许受保护的本站预览图。静态、目录、隔离HTTP及真实CDP验收的环境、入口与保证边界分别见 testing；编译不替代真实图片生成或完整治理回归。

### Agent 供应商流的可选字段

Platform AI的ModelStreamProjection消费SDK已解码事件，持有Chat Completions的nullable拒答/工具占位、reasoning_content/reasoning有界文本和native_finish_reason元数据校验；只有带合法finish_reason的终帧允许delta为null。普通思考不作为答复或执行许可，真实拒答及未知输出仍拒绝。累计usage在Projection保存单调最新快照，于SDK迭代结束且正式终态校验后仅交付一次原usage事件，RunModelStream和probe继续只接收一次真实用量；缺失不补零。ModelToolStream只允许已登记工具调用的后续身份字段为null，首帧仍须完整ID/type/name，后续非空身份不一致拒绝；参数null不追加字符。Responses续接证据仍沿原独立校验，不与普通思考混用。模型发现nexus_capabilities支持已有supports_image_generation字段，应用/Shared转换不变。

### OpenAI 官方 SDK 技术边界

1. **职责与范围**：Platform使用官方openai@7.43.0完成Chat Completions、Responses、Images和模型发现；Run业务权限/预算/审批/持久结算不交给SDK。
2. **子功能与目录**：原openai-compatible组合SDK资源方法与技术结果转换；model-request构造具名SDK请求；model-stream只投影已解码事件；model-sdk-request持一次操作的SDK实例、原始响应reader和清理；model-tool-stream及model-reasoning保留工具/续接事实校验。
3. **依赖方向**：应用Model→原ModelNetworkPort→Platform Adapter→OpenAI SDK；SDK类型只用于技术Adapter，不能进入Shared或应用/storage。
4. **类型与转换**：SDK类型不能代替外部运行时校验；事件/模型/图片在Adapter以unknown检查实际消费字段并白名单投影。标准可选字段不作每帧必填，额外choice元数据有界忽略，拒绝未知执行输出。
5. **入口与安装**：原Bootstrap安装不变，使用client.chat.completions.create、responses.create、images.generate和models.list；流通过公开asResponse及SDK Stream.fromSSEResponse保留事件名，模型测试复用同一路径。models.list只取当前响应，不迭代自动分页。
6. **数据、事务与并发**：不改变表或Shared契约；SDK不管理工具执行、幂等记录或授权。请求由SDK编码，派发前限制实际编码字节，模型声明和工具/正文/续接容量保持原owner。
7. **生命周期与失败**：文本流及probe的maxRetries=2，发现/图片为0；退避/Retry-After由官方SDK负责。仅连接故障与408/409/429/5xx可重试，TLS证书错误与本地失败中止专用signal，非临时HTTP失败强制禁止重试。成功响应后不重试SSE/投影失败；应用持原完整期限，所有尝试共用累计响应字节预算。同一逻辑模型步骤最多3次HTTP派发，不重放工具。logLevel=off、拒绝重定向，原AbortSignal与本地停止重试signal组合并传给SDK；原始fetch只用应用signal，避免停止SDK重试时先破坏尚待排空的reader，传输总期限仍归应用。禁用环境organization/project自动继承，无凭据时移除占位Authorization。每个响应有独立ModelResponseBody、reader/decoder和关闭Promise，SDK重试前重新等待上一响应关闭；清理失败阻断下一次派发，不能覆盖旧资源。Reader按需读取，总量在SDK缓冲/JSON解码前检查；关闭Promise在取消前保存，SDK忽略的传输或清理失败仍由原owner记录并在close抛出，不提前交付completed或释放Run名额。不证明远端停止，不自动重放已取得成功响应的请求或未知Run。
8. **当前能力与验收**：迁移进度/静态证据和远程待验见PLAN/testing；UI不变；原生浏览器增量更新由下述Run变更订阅负责，SDK的供应商SSE与浏览器WS分属不同边界。

### Agent Run 正文与状态流

1. **职责与范围**：原生对话通过WS直接消费已提交正文增量和状态；RunChanges用Node EventEmitter唤醒交付，Run日志仍为持久权威，不直接转发供应商SSE。首次/显式读取保留HTTP，生成及重连续传不逐段HTTP请求；ACP保持。
2. **子功能与目录**：RunChanges在原Run/Step/Tool/Collaboration/Governance写入收敛后区分text/state通知；RunStreamService组合原Context/Run等读取，正文热路径只读正文页。interfaces/ws持认证、游标和发送窗口，run-stream-mapper复用原HTTP投影的唯一owner。
3. **依赖方向**：写入Model→RunChanges；WS→Thread准入→RunStreamService→同模块既有Service→各Model/Storage。SQLite不反向调用应用，Platform只持WS句柄与真实排空。
4. **类型与转换**：Shared runs/events持订阅/ACK/更新、前后游标与严格codec，runs/values持独立命令和完整输出预算；内部RunStreamCursor/Page/State/ChangeKind归runs/model。入口与出口逐字段映射，不透传Storage/供应商对象。
5. **入口与安装**：/ws/agent-runs升级需原来源/Origin、管理员、当前启用受信版本App及可见Run；客户端subscribe给出Thread和正文/事件游标，首次状态页核对Run所属Thread。每批交付前后和心跳期复核原持久会话/App准入。
6. **数据、事务与并发**：无新表。先订阅再首次读取，写入通知在原存储调用收敛后发出，unknown不重派。正文/状态变化约16ms合并，读取中dirty保持；状态及用量/审批/子任务独立于正文热路径，终态后再读正文并持续至空页。发送游标与客户端已接纳游标分离，连接内按发送游标连续推送，重连从客户端已接纳游标恢复。
7. **生命周期与失败**：最多16页且累计不超过完整输出预算的未ACK窗口，满额暂停到ACK，容量不是Run失败条件；大状态页等待先前窗口排空，心跳另留1KiB传输缓冲。ACK按序、60秒期限，订阅首帧15秒，心跳15秒/权限复核3秒；心跳不查询Run/正文。关闭取消计时、退订并等在途短读取，RunChanges纳入AgentRequestOwner停机资源，Platform等真实WS排空。隐藏、断线或关闭不取消Run，不重发模型。
8. **当前能力与验收**：状态/正文/用量/审批/子任务均有直接推送消费者；记忆审核和插件SDK独立订阅保持原行为。命令1KiB，完整输出按审批8MiB、正文512KiB、事件32KiB、由最大工具预算推导的子任务元数据容量及8KiB封装，合计按runs/values公式计算；客户端单帧/待接纳窗口和后端发送预算同源。源码与静态证据见PLAN/testing；未以编译代替实机弱网、权限/版本撤销、停机及E2E验证。

## 成熟技术库边界

1. **职责与范围**：安全算法、MIME/图片格式识别及版本比较委托成熟库；应用权限、事务和任务政策保留原owner。HTTP路由/WS/维护架构不变，不使用Fastify或Zod替换。
2. **子功能与目录**：security/adapters/rfc-totp、http/http-body、images/adapters/native-image-inspector与ai/adapters/model-image、Agent plugins版本规则沿原目录实现。
3. **依赖方向**：otplib/Formidable/file-type/fast-xml-parser仅Adapter消费；semver通过共享版本校验及插件比较消费，不向应用暴露第三方对象。
4. **类型与转换**：TotpPort维持同步verify；ImageInspector.inspect与MultipartPart解析返回Promise，Model和四个HTTP producer同步await；原MIME/格式投影、失败与白名单不变。
5. **入口与安装**：Bootstrap沿用原Port安装。TOTP使用20随机字节的Base32、SHA1/6位/30秒/前后30秒容差，now从毫秒转秒；二维码URI由otplib生成。
6. **数据、事务与并发**：上传先按原route总预算有限读取，Formidable只开启multipart插件；所有onPart都由Adapter接管原始字节，不调用默认文件处理器，无临时磁盘文件。解析原始/中间缓冲零化，返回part归producer清理；备份保留被交接的content。node-semver版本范围同步Shared及全部签名包消费者。
7. **生命周期与失败**：解析前后复查signal，异常转HttpInputFailure并保留cause；真实请求socket不交给解析器，有界Readable源显式destroy。图片识别异步后仍走原身份/版本/取消准入；SVG关闭实体处理，格式识别不证明内容安全。生成图片继续只接受PNG/JPEG/WebP。
8. **当前能力与验收**：源码已迁移；静态与远程待验范围见testing。Docker仍通过原MachineCommandExecutor/SSH执行CLI，没有API socket能力，不装Dockerode或更改远端前提。

## Agent 安全失败诊断与 SSH 发现授权

1. **职责与范围**：Run/Tool owner 记录有限故障类别；Governance 唯一决定授权，诊断不授予权限、不重派任务。
2. **子功能与目录**：runs/run-failure-rules 分类具名应用异常；RunModel 组合原工具日志与当前进程诊断；tool-service 在既有失败 CAS 写入安全错误结果。
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
5. **入口与安装**：register安装CompactionModel/Storage，Run每轮派发前prepare，完成工具提议后可precompute；初始v1安装agent_context_compactions，快照注册与真实decoder同步，无旧库兼容或自动删除数据。未知window/Images不启用自动压缩，maxOutput仍为正常模型上限，摘要单次输出至多16384token（包含供应商计入输出的推理），正文至多16KiB。
6. **数据、事务与并发**：摘要独立持久reserve/dispatch/completed/failed/unknown、原快照/hash/切分位置和usage，root_id与Root/Child共享请求、token、并发账本。后台只与工具阶段重叠，下一轮前收敛，预留至少一次继续请求；实际任务预算不能因压缩绕过。摘要以唯一id绑定替换，下一步事务按同Run已完成记录重建原前缀，再复用contextContinues验证持久助手输出、完整工具结果和来源；陈旧前缀不能应用，保留近期约25%窗口（适用时至少30k，最多半窗口）及完整最后交互。原用户请求独立保留；不把摘要提升为授权。
7. **生命周期与失败**：每Run仅一个后台Promise和取消controller，子任务继承原期限/预算；取消/撤销/恢复在原围栏事务将未派发置failed、已派发置unknown，不重放。完整流和清理完成后才持久摘要，usage缺失保留预约；未知存储提交不二次写入。可选摘要连续失败两次暂停，存储/清理故障不能吞掉；原任务finally及成功提交前排空，清理未确认保留运行名额。摘要费用汇入原Run用量但不生成正文事件。
8. **当前能力与验收**：已实现同Runusage校准/回退、自动阈值、初始历史压缩、工具期预生成、完整分组与原输入保留、预算/取消/恢复/快照消费。初次/跨Run重建历史使用估算；不增加供应商超窗的自动重放恢复，不声称与OpenCode全部内部实现一致。语义摘要有信息损失及额外费用。操作见USAGE执行设置，静态与D17待验场景见testing。

### Agent 会话自动命名

1. **职责与范围**：scope 的 TitleSession/TitleModel 持默认 Thread 首条 Root 消息自动命名，RunExecutionOwner 追踪所属辅助模型调用；人工 Thread 标题不参与。
2. **子功能与目录**：scope/model/title-types、title-model，storage/title-storage，service/title-session，adapters/sqlite/title-schema/title-sql/title-row；title-rules 持输出归一化和无工具提示词。
3. **依赖方向**：Run owner → TitleSession → TitleModel → TitleStorage；现有 RunModelStream/OpenAI SDK 提供模型流，ProviderModel/ExecutionService 提供冻结配置复验和预算；不复制网络重试。
4. **类型与转换**：TitleScope/Claim/Command 属 scope model，StoredTitle 对应 storage；Model 持白名单转换和政策投影。WS RunStreamState 带 AgentThread，由 ThreadModel.forRun 精确关联读取、原 interfaces 投影；不暴露标题账本/请求hash/供应商正文。
5. **入口与安装**：workspace create 必填 autoTitle，前端新建默认 true，显式命名/SDK调用由调用方指定；直接 HTTP create 为人工标题。初始 v1 新增 agent_threads.title_origin 与 agent_thread_titles，注册快照列和真实decoder，不迁移旧库、不自动删除数据。
6. **数据、事务与并发**：pending→automatic 的首次 claim 原子保存摘要、递增 Thread version；仅 thread_sequence=1 的 Root 原 create_run 身份且当前可执行时可 claim。独立 Thread version lease 不受 Run 文本增量改版影响；reserve/dispatch/finish 在事务复验原创建hash、Run活跃期限、冻结Provider与当前Thread来源/version。人工 rename 总是转manual；最后命名按原版本CAS，晚结果不能覆盖。账本请求/token/并发并入原Root/Child总量；未派发失败释放token，未知派发保留预留，真实usage成对记账。
7. **生命周期与失败**：前台首模型派发后才启动可选任务，同模型最低支持思考等级、无工具、最多2000码点输入/2048输出token/4096字节正文，最终标题按128 UTF-8字节码点截断。Images/额度不足保留摘要。独立10秒和原期限信号，前台步骤结束立即取消并排空，终态前收口；取消/撤权/重启将reserved置failed、dispatched置unknown，不重放。普通命名失败只日志；存储提交未知或资源清理失败仍按原Run安全围栏处理，不假装清理成功。
8. **当前能力与验收**：参考OpenCode固定提交49a112f的独立标题任务和人工改名保护；源码与静态证据见testing，D17下真实模型、竞态、快照及手机行为待验。

## Agent 额外门槛清理（2026-10-25）

1. **职责与范围**：恢复正常模型等待和可恢复工具失败；保留任务族总预算、授权、审批及未知结果围栏，UI设计不变。
2. **子功能与目录**：Execution持准入，RunExecutionOwner持等待，ToolService持失败与投影，Context持持久续轮，Collaboration持活跃Child与完整输出读取。
3. **依赖方向**：原Service→Model→Storage；本地容量等待使用p-retry8，仅重试ModelCapacityBusy，OpenAI SDK继续独占网络重试。
4. **类型与转换**：Participant/StoredParticipant显式增加outputBytes；模型结果只带有标记预览，完整正文经原族关系续读；公开元数据无正文，Shared严格容量同步。
5. **入口与安装**：模型/tool次数可配置上界400/4000，已有用户预算保留；十个协作工具声明更新到4.0.0，不保留旧参数兼容。
6. **数据、事务与并发**：忙错误在派发写入前抛出并回滚；每次等待后重新做原CAS/准入。p-retry不接收signal，避免派发已提交后被其取消检查遮住；每次尝试前检查原取消，等待最长250ms响应取消，未知存储失败不重试。模型收到finished后以原步骤CAS持久记录response_received，先释放模型并发再等待标题/摘要/Child；该单调资源事实不改变正文revision或Run终态，快照列与decoder同步，重启仍按未结算派发保守对账。Child名额结合事务活跃数和原owner实际占用，历史不再累计四个。
7. **生命周期与失败**：确定参数/不存在等工具错误持久failed后交回模型，Context快照及后续历史接受带正文的failed；权限、变更已派发未知及清理异常仍停止。工具捕获256KiB、模型步骤2MiB不变；预览与续读保留完整原文和可核对hash。
8. **当前能力与验收**：源码两轮复核及静态证据见PLAN/testing；按D17不新增或执行行为测试，不重启当前旧schema运行实例。

## Agent 结果续读与Child名额复核（2026-10-25）

1. **职责与范围**：小预览额度时仍完整交付结果续读页；错误hash反馈模型；Child名额按真实占用ID去重，不改UI设计。
2. **子功能与目录**：Context result-rules持唯一页预算，ResultService处理原工具结果，RunCollaborationService处理Child正文；ToolService传冻结预览额度。
3. **依赖方向**：原Service→Context纯规则及各自Model→Storage，未新增模块或依赖。
4. **类型与转换**：resultPage必填previewBytes，实际消费者同步；原ResultReadInput/ResultPage、hash、码点offset及nextOffset不变，不新增Shared字段或兼容接口。ChildAdmissionFacts/StoredChildAdmissionFacts明确持activeChildIds，Model复制转换；原执行owner只投影occupiedChildIds，不向Service交付任务对象。
5. **入口与安装**：tool_result_read与collaboration_output_read按冻结设置缩小页；projectCapturedResult复用同一预算，没有独立截断实现。
6. **数据、事务与并发**：先验证请求maxBytes为8..4096，再计算min(请求,有效预览额度-512)，有效预览额度仍1KiB..8KiB；512bytes外壳余量容纳UUID/hash、数字及字段。只读不可变账本，原文/hash保持，游标按实际码点推进。Child准入在原事务合并数据库的pending/running/unknown及未结算工具所属Child，与本机尚未收尾任务的ID；对并集计数，既不重复计算同一任务，也不漏计不同任务。
7. **生命周期与失败**：错误hash属invalid_input，作为确定失败反馈模型后允许续轮；原授权、资源版本、取消、结果未知及清理保护保留，不绕过完整性检查。
8. **当前能力与验收**：两轮源码核对覆盖Unicode/转义、最小与默认额度、末页、hash、权限和历史续轮；本轮静态证据见PLAN/testing，按D17未运行行为测试。

## Agent Run 级批准策略与确定存储失败

1. **职责与范围**：Runs 持有创建时冻结的 ask/full_access 意图；Governance 持有审批/单次消费。全授权不修改 App grant 或普通 SSH 授权。
2. **目录**：原 runs/model/storage/adapters、governance/model/service/storage/adapters、interfaces HTTP/WS；错误分类 owner 为 agent-failure / agent-storage-failure。
3. **依赖方向**：Service → Model → Storage，SQLite 在原事务读取模式，经 Model 转换交给治理规则；不从前端或工具参数推断自动批准。
4. **类型与转换**：Shared runs/values 唯一定义 AgentApprovalMode；内部 CreateRootRunCommand / AgentRun、StoredRun / 创建命令及公开后端输入独立定义并逐字段映射。Shared 安全失败码 execution_storage_failed 不含技术正文。
5. **入口与安装**：HTTP create、workspace create/append、public create 及 HTTP/WS RunView 同步字段；初始 v1 签名为 backend-next-v1-initial-20261025-agent-approvals，不兼容旧开发结构。
6. **数据与并发**：agent_runs.approval_mode 非空有限值，创建 hash 包含模式，Child 创建事务复制父模式；快照列/解码与父子关系同时验证。自动审批绑定原 operation hash/revision、policy revision、目标版本和原用户，approved 后沿原 consume/authority 事务派发，未知提交不重放。
7. **生命周期与失败**：具名 SQL/constraint 失败区别于 commit_unknown/rollback_failed；无模型步骤的 pending 仅以原创建 hash/version CAS 结算，轮间以原 completed 步骤 CAS 结束；reserved 并发等待的确定拒绝结算 DISPATCH_NOT_STARTED。纯确定 SQL 失败聚合仍可分类，混合未知或清理失败保持原因，不推测。App/Provider/目标撤权仍逐阶段检查。
8. **当前能力与验收**：恢复聊天批准策略的真实执行链，未改变布局/风格；按 USAGE 操作。静态和两轮源码审核见 testing，真实审批/故障/取消和空库启动验收待远程，不把编译通过视为实机通过。

## Agent 审批历史分页

1. **职责**：Governance提供完整可遍历历史，单页最多64项；不以历史条数拒绝Run状态读取。
2. **目录**：沿原治理Service/Model/Storage及HTTP/Workspace mapper，RunStreamService与run-changes-ws调度推送。
3. **依赖**：Run仅消费治理应用页；SQL/索引归SQLite Adapter，插件SDK沿Shared严格解码。
4. **类型**：Shared AgentApprovalPage、应用ApprovalPage和存储StoredApprovalPage各自归属并逐字段转换；after为小写UUID/null，稳定ID升序及游标关联在协议边界验证。
5. **安装**：GET approvals可省略after；Workspace必传after；WS订阅游标必含approvals，重连从null开始，现有v1初始索引与精确签名同步，旧开发库不自动迁移。
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
7. **生命周期与失败**：图片请求编码预算从允许解码字节推导；Node MAX_STRING_LENGTH/MAX_LENGTH决定整体JSON/Base64技术天花板，保留64KiB外壳余量。浏览器CDP二进制同样受字符串表示容量约束；显式download.maxBytes可主动缩窄本次下载，省略时用实际剩余空间。保留格式、权限、hash、版本、取消及unknown围栏，不自动重试付费生成。
8. **当前能力与验收**：16MiB/8MiB业务限制已去掉；整体Base64路径依然需要比文件更大的内存，运行时技术限制不等于可承诺的内存容量；大体积/配额并发行为按D17待验。现存旧设置/冻结文档不自动迁移或删除，新版本使用当前结构。

### Artifact 总空间与分段文件传输

1. **职责与范围**：文件库消费总空间契约，移除已授权删除的单文件设置，其余UI保持不变。
2. **子功能与目录**：execution-types/mapper和ExecutionSettings同步字段删除；artifact-management-api拥有长度/版本/范围/hash关联，通用binary-client继续只负责技术传输。
3. **依赖方向**：功能API消费Shared和client；增量SHA-256复用成熟@noble/hashes，不自行实现hash。
4. **类型与转换**：Artifact metadata和begin字节上限随Shared总空间最大值；上传File不再先整体arrayBuffer，按4MiB分片增量hash，Blob请求直接交付不重复解包。
5. **入口与安装**：原上传/下载按钮与返回Blob契约不变，超过4MiB下载沿原content Range接口逐段获取，无新UI或轮询。
6. **数据、事务与并发**：每段验证原ID路由、etag、206/200、Content-Range、真实长度及末尾完整SHA-256；版本变化或段失败不交付部分文件。Blob分段组装避免单个巨大ArrayBuffer，实际仍取决于浏览器内存/Blob能力。
7. **生命周期与失败**：同一取消信号覆盖hash和各段请求，hash状态在finally销毁；无自动上传或未知写入重试。分段只缩小传输工作集，不作为存储上限。
8. **当前能力与验收**：双端静态和构建见testing；按D17大文件、取消、版本变化、窄设备真实资源占用待验。

### Artifact 总空间统一（2026-10-26）

范围：删除单文件设置及固定16MiB Artifact/图片、8MiB截图业务上限，取消10,000项累计文件准入，读取偏移跟随Shared协议容量；生成/截图/下载预检总剩余空间，最终begin事务保证总配额。文件库增量hash与Range分段下载复用现有入口，无额外UI变更。

D17：不新增/运行本地行为、浏览器/E2E或付费图片请求。现有plugin-artifact-streams夹具将内容大小固定为16MiB测试批次，不随新10GiB协议上限分配巨大内存；未改变原授权撤销/关闭/lease断言。

待验：超过16MiB生成/上传/预览/下载，超过8MiB截图；总空间接近耗尽、已有staging预留、并发生成最终begin拒绝、磁盘余量；多段下载逐段版本/范围/长度/hash/空文件/中途取消；大文件上传分片hash且无整体ArrayBuffer；文件数超过10,000后按空间准入；SDK Base64技术容量、非规范Base64及格式拒绝；旧设置文档不自动迁移。

两轮源码审核完成：第一轮核对全契约删除、HTTP流式/JSON容量区分、最终配额事务、已有预留和工具偏移；第二轮核对Base64规范编码/运行时预算、浏览器上传读取前技术能力、Range空文件/末段/版本变化、增量hash销毁及取消。检查证据：

- `pnpm run check`通过，`/tmp/nexus-artifact-capacity-check.log`。
- `pnpm --filter @nexus-terminal/shared build`、`pnpm run build`及最后技术能力补齐后的`pnpm run build:backend`通过，日志`/tmp/nexus-artifact-capacity-shared.log`、`/tmp/nexus-artifact-capacity-build.log`、`/tmp/nexus-artifact-capacity-backend-final-build.log`。
- `pnpm run format:all:check`通过，`/tmp/nexus-artifact-capacity-format.log`；后续修改均目标Prettier写入并再做完整格式检查，`git diff --check`及既有流式夹具`node --check`通过。

源码/静态结果不代表上述运行时场景已通过；未重启、未改已有数据库、未提交推送。删除执行配置字段按当前破坏性结构执行，旧持久设置及冻结Run文档不兼容。

### 文件管理器预读20ms（2026-10-26）

原useFilesystemBrowser的PREFETCH_DELAY_MS由50改为20；FileManager普通目录、“..”鼠标停留及键盘定位共用此入口，后继最新候选补调度也引用同一常量。两轮源码审核核对入口与两处定时器，以及缓存命中、单个预读、最新候选、点击复用、离开/失活/dispose取消和revision围栏，无其它代码改动。

静态检查日志：`/tmp/nexus-files-prefetch20-check.log`、`/tmp/nexus-files-prefetch20-build.log`、`/tmp/nexus-files-prefetch20-format.log`；根check、Frontend build、全量格式及git diff --check均通过。按D17不新增/运行行为或浏览器/E2E测试，真实普通目录/上级目录20ms预读与快速移出待远程验收。

## WebSocket 周期保活（2026-10-26，源码及静态）

范围：Platform HTTP listener 的既有 channel/raw WebSocket，每25秒以 ws 标准 Ping 保活，浏览器自动 Pong；无 UI、Shared 或业务消息变化。

两轮源码复核：沿 upgrade→activeSockets→channel/raw→维护 suspend/drain/resume→listener close 追踪所有权；复核 ws.ping(callback) 支持、OPEN/缓冲保护、同步/异步发送失败、一次性定时器unref与同步清除。保活不刷新业务授权/挂起租约，不以一次漏Pong强制断开；原前台恢复探测、业务心跳及SSH离线策略保留。原始路由即使调整事件监听，统一timer仍由HTTP owner掌管。

静态：Backend build通过，日志 `/tmp/nexus-ws-keepalive-build.log`；根check、全量format及git diff --check通过，日志 `/tmp/nexus-ws-keepalive-{check,format}.log`。初轮ESLint发现新增分支缺少花括号及声明空行，已按项目规范修正后重跑，不将初轮失败记为通过。

按PLAN D17未新增/运行行为、浏览器专项或E2E。待验：经真实反向代理空闲超过60秒及多轮Ping；SSH/Agent/raw RDP/VNC并存；手机后台恢复、休眠/断网；发送背压、维护暂停恢复及停机无残留timer。未部署、重启或提交推送。

## 全部本地变更审核与远程回归（2026-10-26，已完成）

用户授权审核、提交全部本地代码并修复远程E2E。两轮分组源码审核覆盖 Agent Run/Step/Tool/Child、预算和模型SDK重试、上下文摘要与标题、批准分页/策略、模型来源、Artifact空间与分块下载、前端流合并/乐观消息/目标记忆、终端生命周期/输入恢复、Workspace附件流控及WS保活；保留已有授权UI变更，本轮不增加UI设计修改。

审核修正：工具列表协议按数值时间戳与ID校验游标，避免字符串位数影响排序；后端目标黑名单用例删除误加的approvalMode字段；状态监控用例按当前方向箭头及可访问标签核对上下行，保留速率/窄窗/缩放/趋势全部断言。

已完成根check、Shared/双端build、全量格式/diff、变更E2E的独立tsc（临时配置 `/tmp/nexus-all-review-e2e-tsconfig.json`，包含原前端别名及严格类型）；日志 `/tmp/nexus-all-review-{check,build,format,e2e-types}.log`。首次直接tsc因缺少项目配置、继而别名未设置失败，改用临时显式配置后通过，不视为产品问题。游标最终修正后的根check、双端build、全量format/diff亦通过，日志 `/tmp/nexus-all-review-final-{check,build,format}.log`。另修复模型手动添加按钮因聊天/图片两组重名导致的严格定位冲突，按Chat models组定位；更新已恢复的Run批准策略断言为默认Ask when needed，仍核对不产生grant。未执行本地行为测试；远程使用正式E2E工作流。

旧失败基线40218989558：质量/Docker由Agent宿主引用尚未提交的composable/Shared字段导致编译失败；Agent窗口链大量失败与此一致；状态监控仍定位已删除rate-label。完整日志下载到 `/tmp/nexus-e2e-40218989558-logs/`，旧证据不代表当前修复已通过。当前待提交新版本并远程回归。

### 首轮远程构建反馈

提交1f21e469推送dev，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40259908812 。质量作业通过；Docker独立后端构建失败在model-sdk-request的内置fetch/Undici Dispatcher类型冲突（Node26的undici-types与显式Undici7不同），不是UI或测试断言问题。完整Docker日志/tmp/nexus-e2e-40259908812-docker.log。

修复后工作区Backend build通过（/tmp/nexus-undici-boundary-build.log）；复制backend/shared源码及固定锁文件至/tmp/nexus-backend-isolated-review，严格filtered安装后build亦通过（/tmp/nexus-undici-isolated-{install,build}.log）。此隔离构建不含Frontend DOM类型，未做本地行为测试。远程Docker实际构建/启动和8个功能分片待下一轮确认，不将编译通过记为运行通过。

### 首轮功能失败分类（40259908812）

通过分片4/5/7。产品：备份503（agent_runs approval_mode登记位置与PRAGMA顺序不符）、Custom SDK连接中（trace确认/sdk/common/version.js缺失CORS响应，静态白名单漏新SemVer依赖；改为esbuild单模块交付）、预览刷新点击被透明缩放padding截获（仅修命中，无外观调整）。

测试：模型发现入口移动及ID自动匹配禁用期输入竞态；审计自动加载后原手动刷新按钮已删除；ACP取消仍定位折叠详情旧按钮；首次SSH失败已按用户要求保留终端与按键重连；手机预览旧40px尺寸预设不适用于已授权新设计；外部Run取消使用重新进入正式会话恢复；委派非法参数当前为确定拒绝并反馈模型，夹具必须消费错误而非持续重发直到80次预算耗尽。保留拒绝无Child、唯一失败工具和模型完整回复断言。

完整失败作业日志在/tmp/nexus-e2e-40259908812-shard{3,8}.log及/tmp/nexus-e2e-job-121370361{720,744,763}.log；分片3的截图/trace下载/tmp/nexus-e2e-40259908812-artifacts3。未用本地浏览器或行为测试替代远程证据。

本批两轮源码复审完成；静态比较56张Agent表的建表列与备份注册顺序，修正后全部一致。根check、Shared/Backend/Frontend build、全量format、变更E2E严格tsc、JS与SDK产物语法检查、git diff --check通过，日志/tmp/nexus-e2e-round2-{check,build,format,types}.log。初轮静态发现SDK资产早返回缺花括号、工具列表decoder调用参数不完整，均修正重跑；不计作通过。SSH首次失败用例还验证3秒无自动重试、显式按键才发第二次连接且保持单个tab。待推送本批并远程全量复验。

### 第二轮远程反馈（40261572646）

3bb022fd对应 https://github.com/0honus0/nexus-terminal/actions/runs/40261572646 ：质量、Docker构建/启动冒烟及分片1/2/4/5/6/7通过；分片3/8各剩一个旧测试入口。前轮备份503、Custom SDK依赖交付、预览刷新遮挡均已通过真实远程回归；非法委派参数反馈、ACP审批取消、手机预览与SSH首次失败显式重试也通过。

剩余测试修正：发现按钮当前翻译为Update model list；审批不按原始JSON摘要查找，而在Tasks侧栏按工具名及实际Approve and run按钮定位。批准前展开Normalized operation核对ID/hash并打开审计；批准后核对原请求expectedVersion/operationHash及命令真实结果，并验证待审批卡片消失、历史为approved。避免对批准后已退出的待审批卡片继续点击。两轮源码审查保留原授权/哈希/版本/执行结果断言，不改产品UI或业务逻辑。完整日志/tmp/nexus-e2e-job-121375378{516,538}.log。第三轮全量远程待验。

本批仅两处既有E2E及文档变更；目标ESLint、全部已变更E2E严格tsc、目标格式及git diff --check通过，日志/tmp/nexus-e2e-round3-{lint,types,format}.log。未重跑本地行为测试或修改产品UI。第三轮将按新SHA执行完整正式工作流。

### 第三轮远程反馈（40262842979）

e2f66bdf对应 https://github.com/0honus0/nexus-terminal/actions/runs/40262842979 ：质量、Docker及分片1/2/4/5/6/7/8通过；分片3仅完整插件审批出现一次flaky，重试后命令、unknown与上传/下载完整流程均通过，failOnFlakyTests正确阻止假绿。

原trace已下载/tmp/nexus-e2e-40262842979-artifacts3，解压/tmp/nexus-e2e-round3-trace；日志/tmp/nexus-e2e-job-121378765711.log。证据：测试读取折叠状态后点击前，WS审批到达触发产品同步watch展开；测试toggle随后关闭，错误截图Tasks完全不存在而请求徽标已为1。修正为等待既有自动展开并核对Tasks可见，保留原卡片/版本/hash/审计/命令与附件断言，不改产品UI、不放宽flaky标准。两轮源码审核确认该用例是唯一waitNativeApproval后立即toggle面板入口。严格tsc、目标ESLint/格式及diff后按新SHA第四轮远程回归。

### 最终验收：第四轮全绿（40263876745）

代码提交fc5845fd97be449e11bb1b58b03ab2b9150af481，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40263876745 结论success。Checks/format/build、Docker deployment smoke、runner准备及8个Playwright分片全部success；463个用例通过，0失败、0 flaky。分片1–8分别72、42、69、36、55、49、66、74通过；分片2及3包含隔离运行的用例，计入各分片总数。审批卡片自动展开、原hash/版本与审计、命令执行、unknown、附件真实上传/验证下载全部通过。截图更新作业按未请求刷新而skipped，不是遗漏回归。

全部分片原始日志/tmp/nexus-e2e-job-121381919{843,879,881,884,905,923,973}.log及/tmp/nexus-e2e-job-121381920218.log；本轮目标ESLint、严格tsc、格式和diff通过（/tmp/nexus-e2e-round4-{lint,types,format}.log）。源码两轮复审完成；没有本地行为/E2E运行，没有更改UI设计。远程CI自动提交0f44d2b3只刷新duration-estimates，已快进同步。

本次代码审核、提交推送与远程E2E修复已完成。未部署、重启或发布应用镜像；初始v1数据库签名变化仍按H-12/D14使用新数据目录，不提供旧开发数据兼容。个人未跟踪截图不属于代码交付，保持原状。真实生产代理/Android后台等专项不因CI通过而扩大宣称已验。

## 前端无效CSS清理（2026-10-26，源码及静态）

范围：仅删除无实际消费者的样式，不修改UI效果、模板/脚本或交互。复用已安装的Vue compiler-sfc、PostCSS与selector parser做临时审查（/tmp/nexus-css-audit.cjs），扫描91个样式源、2663条规则并得到126个候选选择器。工具输出不是删除依据；人工逐一排除模板字符串、Vue Transition/Router和第三方DOM后，清理21个无引用类名对应的39个选择器，其中35条完整规则及2个由此空置的容器查询；混合选择器保留仍使用的分支及原声明。另删3个无消费者的局部变量。全局主题token、动态类及PDF.js内部变量保留。

涉及首页旧搜索/容器、Settings旧Workspace分组、Agent旧原生滑块/配置/历史控件、模型旧输入框、已取消的内联提示、快捷指令旧信息区和传输旧停止按钮等12个原样式owner。两轮源码复核核对实际消费者和全部diff；静态AST对照工具/tmp/nexus-css-review.cjs证实每个已改Vue文件的template/script/scriptSetup内容、style属性，以及全部保留选择器的声明值/顺序/at-rule条件与HEAD一致，仅排除明确批准清理项。结果/tmp/nexus-css-cleanup-review.log。

根check（含Backend包级类型检查）、Frontend生产build、全量format:all:check和git diff --check通过，日志/tmp/nexus-css-cleanup-{check,build,format}.log。临时扫描首两次因独立/tmp脚本无法解析pnpm间接依赖而失败，改用已安装依赖的实际解析路径后通过，未增加依赖或修改项目配置。按D17未运行本地行为/浏览器/E2E，不将静态AST对照冒充视觉回归；前轮463项PASS仍只对应其原提交。本次未提交、推送、部署或重启，未改个人未跟踪截图。

## CSS清理交付、dev amd64与原站点升级（2026-10-26，已完成）

代码0fc60b7b127e699efffe99c89987b39b3a78a9bf推送dev。正式E2E https://github.com/0honus0/nexus-terminal/actions/runs/40265599805 完整success：463通过、0失败/0 flaky，8分片、根质量/格式/build和Docker smoke成功；分片1–8分别58/49/52/51/57/56/67/73项，独立用例计入对应分片。各分片日志/tmp/nexus-css-final-e2e-job-121387248{795,802,808,811,833,842,858,861}.log。CI自动f5b6221f仅更新duration-estimates，已同步。

用户要求dev amd镜像，发布 https://github.com/0honus0/nexus-terminal/actions/runs/40265629589 成功，生产依赖high级审计通过。镜像ghcr.io/0honus0/nexus-terminal:dev及sha-0fc60b7b127e，仅linux/amd64；digest为sha256:29d0af1b3797a2a796a5aa7fcfb4e6f2b48f52960e60a423cb418011d763cf54，revision精确对应代码SHA。发布原始日志/tmp/nexus-css-dev-amd-publish.log。

### 原部署识别及用户明确的数据处理选择

容器Compose标签定位原部署/home/honus/product/nexus_terminal，原NEXUS_DATA_DIR为./data，公开Origin为https://ssh.honus.top。旧镜像cb693e4c、数据库signature为backend-next-v1-initial-20261023-remote-tool-installer；新镜像要求backend-next-v1-initial-20261025-agent-approvals，不能直接复用旧库。初步只拉镜像未替换服务；用户随后明确要求备份旧库、在原目录新建后导入UI/连接/快捷指令分组/Agent配置等，才执行一次性离线导入，产品没有新增兼容逻辑或修改旧库签名。

隔离容器network=none、无发布端口，用新镜像初始化schema，43张配置表逐列比对；原旧库已有执行覆盖为空、全局执行设置无记录，不需要猜测已删字段。试导入和正式最终备份导入均验证原配置逐行完全一致、foreign_key_check无结果、integrity_check=ok。保留ID、加密密文及原实例密钥；源库无Provider/聊天内容。旧模型库缓存schemaVersion=1不导入，按当前v2缓存重新建立；旧审计/通知派发及运行账本留备份，不混入新运行实例。数据目录appearance/artifacts/plugins按内容hash复制核对；原环境文件hash保持。

正式停止前后端后完整备份data/.env/Compose，再做独立SQLite备份；原data移动到维护目录previous-data，新库仍放原data路径。保留旧镜像rollback标签、原数据及失败自动回退流程；没有触发回退。正式前后端健康，image architecture/revision/digest与发布一致。

### 数据和入口验收

| 内容       | 核对结果                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 账号/会话  | 原账号1、原会话3，密码/因素字段及原摘要会话完整保留；短期维护验证会话finally清除。                                                                       |
| 连接       | 连接6、凭据6、主机密钥5、连接标签关联6；Proxy1/标签3保留。                                                                                               |
| 外观与命令 | 主题403、外观1、布局偏好1；快捷指令14、标签组2、关联14、原历史16保留。                                                                                   |
| Agent配置  | 内置App及政策各1、声明能力19、denylist元数据保留；Provider/聊天源记录为0。                                                                               |
| 认证读取   | 新版启动后26项实际GET覆盖设置/布局/外观/主题/连接/各凭据/命令与标签/Agent App/模型库/执行设置/政策/权限，全部200；只输出路径/状态/长度，不打印秘密正文。 |
| 公网       | 首页200且字节与容器新版index.html一致；/api/v1/status为200；无Cookie的auth/status为预期401，携维护会话认证读取为200。                                    |
| 数据与备份 | 正式库FK/integrity再次通过；完整备份tar目录可读、SHA-256匹配，原数据保留，.env未改。                                                                     |
| 日志       | 新后端启动及验证期间无error级日志；未据此宣称未覆盖的真实SSH/浏览器视觉行为已验。                                                                        |

远程备份目录/home/honus/product/nexus_terminal/upgrade-20261026T035324Z（0700）：data-env-compose-before-upgrade.tar.gz、nexus-terminal-before-upgrade.db及previous-data完整旧目录；包含实例密钥，保留root权限，不上传仓库。部署元数据deployment.json、final-import.json及final-verification.json保存在该目录；本地日志/tmp/nexus-upgrade-{prepare,trial-import,trial-http,cutover,final-http,final-check}.log。首次临时验证误用了settings/appearance及credentials复数路径，按真实路由纠正后26项全通过；最初公网检查将无Cookie的正常401误当失败，核对认证路由后按真实语义记录，不修改产品。没有输出或更换原密码、实例密钥或Provider密钥。未保留浏览器测试会话、未运行本地E2E；原个人截图保持不动。

### 挂起关闭恢复画面几何修复（2026-10-26）

截图显示恢复后的TUI底部重复提示及空白；源码核对确认快照尺寸缺失、重复PTY resize和checkpoint尺寸排队问题。既有SSH `resizing a suspended fullscreen terminal is ordered after its checkpoint`同步验证baseline尺寸先于快照、live尺寸在快照之后；保留原快照正文断言。D17下未执行本地行为或E2E。

待远程：普通缓冲区TUI/备用屏幕在同尺寸、宽窄及高低变化后挂起关闭恢复，底部提示/光标正常；恢复时切后台、重挂载及多SSH切换保留各自输出；连续resize的checkpoint按每次尺寸处理，相同尺寸不重复发送远端调整；ACK失败/被接管仍不开放输入。

静态证据：两轮源码审核覆盖快照/实时尺寸事件、预挂载缓冲、xterm解析队列及失效generation、同尺寸去重、checkpoint resize/reset尺寸捕获、ACK与背压保持；`pnpm run check`、`pnpm run build`（含Shared/Backend/Frontend）、`pnpm run format:all:check`和`git diff --check`通过。日志：`/tmp/nexus-suspend-geometry-{check,build,all-format}.log`；末次reset尺寸捕获后的Backend check/build分别见`/tmp/nexus-suspend-geometry-backend-{recheck,build}.log`。静态通过不代表截图实机/E2E已通过，本轮未重启、提交或推送；保留其它正在修改的UI/Agent文件及原截图。

### Codex挂起恢复：高延时与滚动区域定向验证（2026-10-26）

用户明确授权api.honus.top的Codex测试及高延时时序排查，本轮限定该链路。使用独立Chrome/CDP与自建测试SSH会话，未接管用户现有终端；初次共享浏览器的恢复定位存在歧义，其结果作废，后续按精确suspend ID隔离。普通静止、执行中排队、75×28窄窗口恢复，以及WS上行700ms/下行900ms（实际往返约1.9秒）均保留输入区背景，未直接稳定复现原截图。

真实Codex 0.164.0输出显示DECSTBM区域处于1–29行而屏幕共34行；SerializeAddon 0.14不保存此状态。126×34真实输出按15个块间边界快照/接续，旧路径在重绘区域未还原的切点有1287–1576个单元格差异；补齐边界后余下7项均为同色调色板16色/256色编码差异，规范化后无可见字符格差异。实际新Backend checkpoint factory及浏览器加载的新Frontend tracker分别重放15个切点，全部零差异；非手工拼接修复后缀代替实现验证。

持久回归：`tests/backend/remote/backend-next-terminal.integration.mjs`新增7个真实xterm快照接续场景（普通/备用屏、DECOM、非法区域忽略、软重置、RIS、resize），断言后续滚动后的完整屏幕字符/背景及底部输入区保留；连同原两项共9项通过。检查命令：`node --test tests/backend/remote/backend-next-terminal.integration.mjs`。既有SSH fullscreen E2E保留几何顺序断言，尚未运行本轮远程Actions。

证据：`/tmp/nexus-codex-region-tests.log`、`/tmp/nexus-codex-factory-replay.log`、`/tmp/nexus-codex-browser-replay-result.json`、`/tmp/nexus-codex-delayed-private-result.log`。原始流仅放/tmp，不提交对话内容或Cookie。源码复核两轮覆盖几何、解析屏障、scroll region与监听生命周期；末轮check/build/全量format/diff日志分别为`/tmp/nexus-codex-region-{check,build,format}.log`。实机原截图尚未稳定复现，旧Backend进程尚未加载本轮代码，不能宣称新版本端到端恢复通过；非活动缓冲区区域和任意未闭合ANSI解析状态不在本轮快照保证内。无UI设计变更；按用户后续授权提交本次修复，未推送或部署重启。

### 终端逐字符真实回显优化（2026-10-26）

源码沿前端onData→sendConnected→WS terminal.input→requireTerminal→Workspace.write→ssh2 channel及原输出链核对：前端发送/前台输出没有固定防抖；Workspace WS入口仅派发任务，不等待文件操作执行完成，不能把Platform串行消息接收误判为终端等待目录请求完成。确认SSH底层TCP未关闭Nagle，且input/resize/flow原先均重复完整授权。修正原SSH route的直连/跳板客户端与代理TCP的noDelay，并只去除上述控制操作外层重复授权；具体处理器仍完整检查身份、phase、精确attachment与挂起租约。

两轮源码复核覆盖：直连/跳板/HTTP及SOCKS代理的真实socket归属；ssh2公开setNoDelay对forward channel的无操作及外层策略；ready后设置失败的原catch销毁；输入/resize/flow在未连接、pending ACK、被接管、失效Cookie/租约过期时的授权与拒绝路径。无UI/Shared/存储变化，不添加本地预测字符，未改在途容量或输出流控。

本批沿PLAN D17不新增/运行本地行为、浏览器或E2E。待远程/明确授权专项：普通Shell与Codex、中文输入/退格/方向键在直连、跳板和HTTP/SOCKS代理及高RTT下的键入至远端回显分位延迟；大输出/文件传输并行时的交互；原身份失效、接管与pending ACK拒绝用例。已有SSH连接不会因源码修改改变TCP选项，需加载新版Backend后新建SSH再验证。静态证据：根check（含Backend包级check）及Backend/Shared build通过，本批文件ESLint/Prettier及diff通过；全量format失败项仅为并行工作区的AppIntegrationEditor.vue、SafetyNetworkSettings.vue、UiInlineNotice.vue、WorkspaceLayoutRenderer.vue，未代为格式化。日志`/tmp/nexus-terminal-echo-{check,build,format}.log`，本批文件检查见`/tmp/nexus-terminal-echo-scope-format.log`。未重启、提交推送或修改其它工作区UI/Agent文件。

### VS Code TypeAhead 移植定向验证（2026-10-26）

本轮沿用户对 api.honus.top 的终端/高延时专项授权，未运行全量本地 E2E、模型请求或修改真实 SSH 文件。复用 VS Code 固定提交 ae11932c6109d3977d78f2fe8937d861e246151d 的 MIT 核心，来源和适配差异见前端 vendor README。

定向算法回放 `/tmp/nexus-typeahead-verify.mjs` 使用实际新增模块及真实 headless xterm：11项通过，覆盖学习后本地回显、匹配不重复、不匹配回滚、首字符未确认的密码提示、退格/左右移动、snapshot撤销及晚到回显、Unicode/粘贴、备用屏/隐藏光标/滚动区内停用、分片SGR、超时、旧epoch及ACK唯一、首次RTT超过500ms可学习，以及Codex式滚动区下方输入。结果 `/tmp/nexus-typeahead-verify.log`。首次加空白格属性恢复时定向断言发现撤销遗留可序列化的空格，改为带原背景的ECH恢复，重跑通过；不把失败轮记为PASS。

复用此前真实Codex捕获流，通过实际TypeAhead模块逐块与无预测的xterm比较；先制造待确认字符，再输入真实重绘。16块、126×34屏幕逐块字符/宽度/前背景/粗体/反色均零差异，最终光标坐标及显隐一致，结果 `/tmp/nexus-typeahead-codex.log`。不把录制重放称为真实Codex交互全覆盖。

独立临时Chromium访问 https://api.honus.top，在登录页面挂载真实TerminalView隔离测试实例，无账号或SSH资源写入。抽取既有终端生命周期场景及新增3个TypeAhead场景，使用正式源模块及真实浏览器断言；13项通过：前后台重挂载与原始ACK、鼠标模式清理、UTF-8跨重挂载、PTY替换、历史snapshot排空/慢游标、后台顺序、无rAF同步TUI/尺寸、预测与不同远端结果校正、snapshot/重挂载不保留预测及密码/粘贴不预显。日志 `/tmp/nexus-typeahead-browser.log`；这是定向执行，不是正式远程Actions。新增回归位于 `tests/e2e/specs/ui/terminal-lifecycle.spec.ts`，传输观察者拒绝/退订断言同步至既有 `tests/frontend/workspace-terminal.integration.mjs`（后者仅静态检查，未运行其服务集成）。临时工具最初遇到esbuild虚拟模块external和已有Chromium版本路径问题，修正工具后执行，未修改项目测试配置。

两轮源码复核覆盖实际派发/手机修饰键、唯一发送、原始字节流控、首字符与异常序列、样本/超时、解析队列、后台/历史/断线/resize及PTY generation、挂起snapshot和订阅/定时器清理。正常UI template/style本批无变更，保留其它并行UI/Agent修改。根check（含Backend包级check）、Frontend生产build、新增E2E严格tsc、既有JS语法及本批ESLint/Prettier/diff检查通过，日志 `/tmp/nexus-typeahead-{check,build,e2e-types,scope-format}.log`；全量format仅受并行修改的UiInlineNotice.vue格式阻塞（`/tmp/nexus-typeahead-all-format.log`），未代为调整。未提交、推送、重启或部署；Android真机、任意全屏程序、所有超高RTT/代理与长时交互仍不在本次实机保证内。

### 文件管理器纵向拖动与固定命令栏（2026-10-26）

用户报告api.honus.top连接后文件管理器无法向上拖动。原因是同一纵向Splitpanes中terminal/commandBar/fileManager三项只调整相邻Pane，而commandBar只有38–42px可调整区间；仅打开pushOtherPanes又会遇到库的最大尺寸提前返回、after-pane漏算后续兄弟，以及前侧全部到最小值后重复扣减前序尺寸的问题。后两项会造成总尺寸超过100%或极限拖动丢失24%的高度，不能只改一个开关。

修复：仅含commandBar的纵向容器开启库原有推挤能力，按两侧可伸缩量传递到其它兄弟，命令栏原限制不变；pnpm patch同步Splitpanes 4.1.2源文件与实际消费的浏览器ESM产物。修正最大值判断/分配中的后序尺寸、最小值边界重复扣减。其它容器保持原相邻调整，分隔线/命中区/默认布局/UI样式不变。

在指定api.honus.top使用独立临时Chromium，先复现原开关两种状态（`/tmp/nexus-fileheight-repro.log`），再挂载真实WorkspaceLayoutRenderer、RuntimeSession和正式默认中心布局；会话保持本地idle，使用独立Pinia和本地布局ref接收真实layoutResize事件，不打开SSH/WS、不保存用户设置。600px容器内初始terminal/command/files高度354/38/207；下侧分隔条上拖后230/38/330，反向342/42/215，上侧分隔条上拖后247/42/309，锁定后完全不变。极限向上144/38/417，向下472/42/84；方向键两次后417/38/144。7个有效resize事件尺寸总和均100%，零pageerror；关闭实例并dispose本地RuntimeSession。证据 `/tmp/nexus-fileheight-actual.log`。最初隔离工具缺少active Pinia而未挂载，补上独立Pinia后执行；中途边界断言发现库漏算/重复扣减后继续修复，失败轮不作为PASS。

前端开发进程已按原工作目录、参数和环境重启并强制更新预构建依赖，后续只由Vite配置watch重新加载补丁；端口9998及api入口保持。没有重启后端。前端就绪日志 `/tmp/nexus-fileheight-vite.log`，不把开发服务重启写为生产部署。

既有正式SSH E2E `tests/e2e/specs/ssh/docker-manager-ui.spec.ts` 的Workspace布局场景新增上下拖动、命令栏高度、总百分比、终端最小尺寸及恢复断言；等待远程Actions，未运行全量本地E2E或真实SSH此新增场景。两轮源码复核核对库源/ESM一致、min/max/百分比守恒、容器选择、布局锁及原保存链。根check（含Backend包级）、Frontend生产build、变更E2E严格tsc、本批ESLint/Prettier和diff通过，日志 `/tmp/nexus-fileheight-{check,build,e2e-types,scope-format}.log`；全量format仅原有UiInlineNotice.vue格式失败，未代改（`/tmp/nexus-fileheight-all-format.log`）。本轮未按自身操作提交或推送，无用户连接/文件/布局写入。

## Agent 步骤与工具审计移除（2026-10-26）

删除正式 Host/审批卡片及 DEV 页的审计入口，撤销四个专用查询端点和 Shared 审计 DTO。保留步骤/工具状态及内部事件事务，供执行、审批、异常恢复和快照一致性校验。回归改用线程工具列表核对 ACP 和工具终态，继续验证审批 hash、命令预览、真实副作用和取消围栏；插件用例核对审计入口消失及 Run 用量仍可读取，后端 HTTP 用例核对已移除端点 404。

静态证据：根 `pnpm run check`、双端 build（含 Shared）、Agent 相关 E2E 严格 TypeScript 检查已通过；日志 `/tmp/audit-check-final.log`、`/tmp/audit-build5.log`、`/tmp/audit-e2e-types.log`。依 D17 未运行本地 Agent 行为测试，正式 HTTP/Agent E2E 和浏览器验收待 Actions，不将静态通过记为 E2E 通过。最终契约及用例收口后，根 check、双端 build、Agent E2E 严格类型、`pnpm run format:check` 和 `git diff --check` 均通过；记录见 `/tmp/audit-final-*`。

### 2026-10-26 自动图片与远程回归修正

- functional-regressions：本地受控 Provider 返回 PNG Base64，模型调用 image_models_list/image_generate，结果只允许文件事实，最终仅回答普通文字。验证审批前无预览、完成后图片实际解码/下载、刷新恢复。无需真实付费图片请求。
- panel-wheel-scaling 与 host：定位当前 IP 复制可访问名称与分开的聊天/图片模型筛选框。
- rdp-remoteapp-fullscreen：在转发唯一的创建请求回执前读取结果，避免导航后 CDP 响应体丢失，不重复变更请求。
- 传输取消：独立传输 lease 仅在获取阶段转发取消；流式 stage 等待已派发 WRITE 后用独立清理期限删除临时文件，保持真正网络故障的 unknown/清理错误。既有 Progress Display 取消与后续 baseline reset 回归验证。

本地静态检查与正式远程 Actions 证据在本次实施方案记录；未通过前不视为发布验收。

40296789507回归补正：图片受控场景显式授予context.read以读取图片模型列表；布局极限百分比换算为CSS像素误差≤1px（观察器与整数clientHeight取整），仍严格断言终端最小24%和指令栏37–43px。Progress Display用例继续真实点击拖动后的恢复按钮；仅修复按钮被分隔条遮挡的层级。已派发复制取消应显示Result unknown与核对源/目标提示，手动Remove后消失，不把受理取消等同于远端回滚；后续隔离reset必须成功。

### ZIP特殊节点与连续拖动补修（2026-10-26）

- 生产只读日志：ssh.honus.top / pve_debian两次压缩在inspectSources非常规文件预检以invalid_input失败；尚未发布本轮ZIP代码，未宣称生产实测通过。
- 原生Info-ZIP实测：普通文件、空目录、FIFO和Unix socket组成的目录，zip退出18，FIFO被忽略、socket报警且添加日志不等于实际入包；GNU tar忽略socket但收录FIFO。归档Service使用既有字面量排除参数统一跳过嵌套特殊节点，保留warning。
- 新正式回归：archive-cancel-recovery校验ZIP和tar.gz实际条目/内容与verified_warning；progress-display-archive验证真实来源删除后压缩失败Toast、两处进度无残留、恢复来源后仍能压缩；复制取消保留unknown Toast且不显示失败卡片。
- 40298917003失败复核：图片用例传错分页before游标，实际工具生成成功；分片6 trace显示第二次拖动发生在前次100ms延迟解绑前，旧timer中断新拖动。分别修复测试参数和Splitpanes真实事件生命周期，不弱化交互断言。
- 本轮本地：根check、完整build、全量format:all:check与受影响E2E严格tsc通过（日志/tmp/nexus-zip-{check,build,lint,types}.log）；正式Actions待当前提交完整回归，镜像待全绿发布。

33e1cb77 / [40302424259](https://github.com/0honus0/nexus-terminal/actions/runs/40302424259) 实际结果：质量与Docker通过，分片1/2/4/7/8通过。生成图片的预览/下载/刷新持久化通过；新Unix socket/FIFO目录ZIP与tar.gz内容校验通过；复制取消unknown Toast/隐藏失败任务通过。分片5仅新增用例没有先关闭驻留Toast导致后续点击被遮挡，修测试正常关闭流程；分片6首跑极限恢复在松手后97ms开始，100ms全页pointer-events保护吞掉mousedown，重试通过但整轮按flaky拒绝，补丁将保护缩至同步click结束后的下一任务；分片3原PDF横向滚动首跑失败、重试通过，trace记录scrollbar613px后最终缩放宽度才更新至1284px，晚到几何锚定重置left0，修复仅几何锚定保留当前横向滚动。既有产品UI模板/样式未变，原双向拖动与PDF横滚断言保留，待下一SHA完整回归。

最终产品源码 `7d66cacb397412b199ddd98cd246c4ec53336ef6` 的 [40304902706](https://github.com/0honus0/nexus-terminal/actions/runs/40304902706) 全绿：质量、Docker部署smoke、8个正式分片共469/469首次通过，零重试/零flaky。图片自动预览/下载/刷新、Unix socket/FIFO目录ZIP与tar.gz实际内容、压缩失败Toast及恢复后新任务、复制取消unknown Toast、连续双向/极限拖动、PDF横向滚动均通过。自动提交 `7f8ff3ff` 只更新 duration-estimates，无产品源码差异。linux/amd64 dev发布 [40306499771](https://github.com/0honus0/nexus-terminal/actions/runs/40306499771) 成功；`dev` 与 `sha-7f8ff3ff9e54` 已发布，OCI revision `7f8ff3ff9e54594a991e48451baafacb63991125`、实际平台 `linux/amd64` 核对通过，index digest `sha256:eeadf1ada289d8061b9fffb5dc6f80e70aa1fc9e745c5ec51acc6978e70b8196`。`unknown/unknown` 附属清单为BuildKit证明，并非ARM运行时。未部署生产。

### 原生压缩直接递归与限制移除（2026-10-26）

生产只读核对：后端已运行revision `7f8ff3ff9e54594a991e48451baafacb63991125`，最新压缩失败为 `limit_exceeded`，位置 `/dist/modules/remote/files/model/file-resource.js:436`，对应 `scanEntries` 的应用条目预算；不是旧镜像未更新。本轮直接移除压缩源树预扫描、20,000条目/64层预算和原生进度固定上限，不新增替代阈值。所选路径直接交给原生ZIP/TAR；进度为工具输出观察，成功由退出及产物核验决定。无UI源码变更。人工规则H-20及工程规则E-08.1同步，防止无实测依据新增限制。

正式回归新增：20,005个文件及70层子目录压缩，检查ZIP实际条目、末项/深层文件正文、完成后SFTP stat，并通过夹具OPENDIR观察断言压缩不遍历SFTP目录；既有socket/FIFO用例改为验证原生行为，ZIP跳过两者并核验warning，TAR保留FIFO元数据、跳过socket，普通文件正文保持。取消/后续压缩与目标位于源目录内的既有断言保留。

两轮源码复核覆盖Service→Model→Native完整参数迁移、无人消费类型删除、随机原生退出标记与进度隔离、非零ZIP独立zip -T、临时输出字面量排除、取消/未知与清理；未以进度数作为源树完整性证明。静态检查：根check、完整构建（前端无后续源码变化）、最终Backend构建、全量format:all:check、变更E2E严格TypeScript及git diff --check通过。最终日志 `/tmp/nexus-native-archive-{check,backend-build,format,e2e-types}.log`；本轮正式远程Actions尚待执行，不沿用前轮469项通过作为本轮证据。未更新生产容器。

首轮 [40310375522](https://github.com/0honus0/nexus-terminal/actions/runs/40310375522) 对应fd3c2c95：质量/构建/Docker及6个分片通过。新增大目录用例3.3秒通过，实际ZIP20,077项与两处正文、零SFTP OPENDIR、完成后stat均通过；原生ZIP/TAR特殊文件行为通过。分片3缺失源后下一次压缩和分片7失败Toast两项各失败两次，均为代码问题：命令已退出且私有输出不存在/已删除，压缩catch仍包为operation_unknown并阻塞持久突变claim，前端显示未知提示。新增FileArchiveDiscarded仅在未开始发布、原生退出已确认、私有输出已清理、原异常非unknown时产生；最终专属lease关闭失败仍升级RemoteResourceCleanupFailure；已尝试rename/replace、失联或未知原异常不降级。协议用例保留后续真实ZIP读取并明确断言普通失败消息，UI用例不修改。待下一SHA完整回归，失败轮不作发布依据。

失败收尾补修静态：根check、Backend构建、全量格式、E2E严格TypeScript与diff检查通过，日志 `/tmp/nexus-native-recovery-{check,build,format,e2e-types}.log`。两轮复核确认具名确定失败只在私有输出删除后产生，实际lease关闭失败可覆盖并保留全部因果，批量claim分类沿既有RemoteFileFailure分支结算；既有UI失败Toast用例不改。正式回归待补修提交。

## 文件容量清理后续回归

aba02d2f正式Actions 40316497521：质量、构建、Docker及分片1/3/4/5/7/8通过；分片2的mutation fixture使用了重复cwd路径，下载用例仍期待已移除的8任务429；分片6目录force删除把1小时剩余期限传入SSH execute时，被旧5分钟参数检查拒绝，Model因派发状态不明退役文件资源。三项均已修正，用例保留九路重叠下载、迟到OPEN回收、票据内容和失败后恢复；目录删除新增刷新后seed可见及无失败Toast断言，防止列表报错消失造成假通过。最终新SHA正式回归待执行，不复用旧PASS。

清理复核：已移除的容量常量、校验函数及独立资源准入集合全仓引用为零；Shared子项索引按实际来源验证，后台传输子项继承父任务期限。原取消/晚到资源/关闭失败仍由原owner追踪，未修改UI设计。SSH execute仅保留Node setTimeout有符号32位毫秒表示范围，避免溢出变成约1ms，不再自设5分钟上限。

动态清理增量：删除scan无消费者容量参数及专属接口；前端upload准备64批、20,000上传任务和64复制/归档任务门槛同步移除。前后端上传准备集合按既有有效期主动清理，前端仅单个最近到期timer并在断线/dispose回收。新增正式Actions入口执行既有真实浏览器受控协议边界专项，检查65批准备与65复制任务独立完成；这类接缝回归不替代正式SSH/SFTP功能链。最新SHA待远程验收。

141836cf的40318510258：质量/构建/Docker及全部7个非分片2通过，目录删除与9路迟到OPEN/票据恢复均首跑通过。分片2仅新增专项夹具失败：SQLite测试在reconcile后错误调用held专属settle；codec动态import触发Playwright TS/ESM解析差异。改为先完成held结算/重用再reconcile，并验证blocked不能被settle释放；Shared codec与已有测试统一静态导入，未放宽存储围栏或产品校验。

a0cb4f49正式40319856905全部质量/构建/Docker和8个分片通过，新增持久4100 claim、Shared257来源/65目标、65前端准备批/65复制任务与原文件协议专项首跑通过，远程工作流成功；3381d6b1仅自动耗时更新。当前1025来源和动态展开字节增量仍需新SHA完整回归，不将本次PASS扩为未提交增量通过。

### 跨服务器直传优先与中转共用链（2026-10-26）

跨会话剪贴板与发送到服务器共用copyRemoteEntries/RemoteFileModel.copyDirect。正式新增direct-and-relay-transfer六例：两个入口各测源到目标可达/不可达，8MiB单ZIP二进制的中间进度、精确SHA256、实际rsync/sftp方法；夹具记录直传零SFTP READ字节，中转READ字节等于文件大小；另测已派发原生失败/取消不回退且移动源保留。测试限速仅用于稳定观察中间进度，不作生产吞吐证据。http专项增加原生凭据清理与流式取消回归，不依赖sshd。

前轮40321121777质量/构建/Docker成功，分片6/8各一项首次失败、重试通过，整轮因flaky拒绝。分别为响应式按钮定位未过滤可见性，以及保护API后台401先卸载页面而测试还等待Hide；本轮修测试真实入口和401观察，保留最终功能断言及原UI。当前批次行为待正式远程Actions，不复用前轮PASS。

两轮源码复核覆盖直传前只读连接探测、清理失败禁止回退、原生stderr排空/初始化失败退出等待、SFTP顺序流水线/ACK后清理、双端授权、源删除重验。根check（含Backend包级）、完整build及最终Backend build、全量format、变更E2E严格tsc、mjs语法和diff通过；日志/tmp/nexus-direct-final-*。最初E2E类型命令未显式加载Node类型，补types/typeRoots后通过；本地未运行行为测试，遵守D17。pve_debian到amd生产网络吞吐尚未实测；按D20不发布、不更新生产容器。

直传首轮be72f173/40329384553：质量、Docker和5分片通过；原生清理专项通过。分片5同endpoint原路径copy被新冲突检查拒绝；7/8发送使用1小时任务期限建立SSH被底层参数拒绝，随后预派发失败误归unknown导致reset连锁失败。修复原路径copy回退、15秒连接阶段及确定前置失败分类，不放宽真正未知或清理错误。新增目录copy专项200文件精确内容/父路径每任务仅一次检查；上传profile逐组验证32子目录仅33次LSTAT，嵌套8父+32子仅41次，重复任务仍重新读取。发送UI回归验证零前置工具请求，保留真实方法/部分失败/内容断言。追加源码及正式新SHA结果待记录；不发布。

追加静态最终：根check、完整build、全量format、变更E2E严格tsc（显式Node类型及前端@路径）、新增fixture语法/diff通过；日志/tmp/nexus-confirm-review-*。初次构建发现不可达shutting_down比较，已删除；最初E2E命令缺@路径，使用临时配置补齐后通过。行为仍待新SHA正式Actions。

最终验收：产品源码2b64a167的正式[E2E 40331990551](https://github.com/0honus0/nexus-terminal/actions/runs/40331990551)全部成功，质量/构建/Docker及8个分片通过，无重试/flaky。复制与发送各两种路径的实时进度、SHA256、直传零SFTP READ、中转精确READ字节通过；已派发失败/取消保留源、不二次中转通过；目录copy 200文件内容/每任务父检查一次、上传24组profile精确33/41检查次数及失败恢复通过，发送UI零前置工具检查且部分目标失败不影响成功目标。652630f9仅CI耗时更新，已快进同步；工作区交付不包含发布/部署，生产吞吐仍未实测。

### Agent 输入区状态栏整合（2026-10-26，本地静态）

将 Token 统计、上一条／下一条和回到最新消息纳入聊天输入区共同外框。两轮源码复核确认全部事件、显示条件和按钮禁用表达式保留；UiButton 默认 button，不触发表单提交；Token 弹层沿原 portal，宽度测量仍归原 form，状态行进入既有窄屏容器查询。根 `pnpm run check`、`pnpm run build:frontend` 和 `git diff --check` 通过，日志 `/tmp/nexus-agent-composer-{check,build}.log`；全量 `pnpm run format:all:check` 通过，结果记录于同前缀 `format.log`。遵守 D17 未执行本地行为测试，视觉、窄屏与跳转实测待远程；未提交、未发布或部署。

### 手机 Agent 会话抽屉背景（2026-10-26，本地静态）

窄屏 `agent-hub-window <= 760px` 中的会话侧栏改用主题 header 背景，覆盖玻璃材质的透明混色；桌面、宽度、层级、遮罩及 inert/显隐保持。两轮源码复核覆盖选择器作用范围、CSS layer 优先级和默认深浅主题。根 check、前端 build、全量格式与 diff 通过，结果见 `/tmp/nexus-agent-sidebar-{check,build,format}.log`；未本地运行行为或视觉测试，未提交、发布及部署。

### 前端冗余功能门槛（2026-10-26，本地静态）

移除连接创建/导入/导出仅前端500项与本地1MiB上限、附件10项及多选静默截断、公钥确认排队64项拒绝、传输详情5项裁切及目录读取8个在途拒绝。协议分批、逐项严格解码、权限/取消/未知结果保护及缓存LRU保留，UI布局与样式未改。两轮源码复核覆盖导入全批预检/部分成功回执、串行上传首失败停止、信任队列取消、目录去重/失效/真实错误传播、传输滚动容器。

新增 `ui/frontend-capacity.spec.ts`：501项且超过1MiB脚本保留最后项，末尾无效项仍拒绝；12个慢目录读取、同路径去重、真实权限失败、失效晚结果与关闭后读取。仅加入正式远程回归，遵守D17未本地运行行为测试。根check、前端build、新回归严格tsc及diff通过，证据 `/tmp/nexus-frontend-limits-{check,build,types}.log`。首次测试类型检查缺Vue声明，临时静态配置补声明后通过；全量格式首次发现测试方法间距，已按规则修正且全量格式重新检查通过，结果见 `/tmp/nexus-frontend-limits-format-final.log`。未提交、推送、发布或部署。

### 列表记录可达与分页完整性（2026-10-26，本地静态）

传输API删除累计160项协议拒绝，保留逐页严格解码、递增游标及跨页重复ID拒绝；Agent会话搜索沿既有游标串行读取后续页，不再只查首50条，清空搜索/失活/禁用/未决写入停止新页，失败进入原重读围栏。未改模板、样式或布局。两轮源码复核包含刷新/搜索变化、分页期间失活、错误不自动重试、旧结果归原owner，以及其它列表的分页/完整入口。

新增 `ui/list-pagination.spec.ts`：浏览器真实API模块读取161项、21个协议页，跨页重复记录拒绝；创建51个真实Agent会话，搜索位于第二页的会话，注入下一页503后经原Retry恢复。正式远程用例尚未运行，本地仅静态。根check、前端build、新增两份回归严格tsc及diff通过，证据 `/tmp/nexus-list-pagination-{check,build,types}.log`，全量格式检查通过，结果见同前缀 `format.log`。未提交、推送、发布或部署。

### 跨服务器剪贴板页面实时进度（2026-10-26，本地静态）

`ssh/direct-and-relay-transfer.spec.ts` 新增两个浏览器用例，分别覆盖原生直传和不可达时的SFTP中转：登录、连接两个SSH标签、文件管理器复制、切换目标标签并粘贴、确认凭据交付。传输真实8MiB样本，沿用夹具带宽控制，DOM观察要求至少两个递增的中间百分比与正确字节总量；通过正式Workspace codec核对同一任务的实际字节进度及completed，随后确认卡片自动退出，核验源和目标SHA-256一致。完成卡片会立即退役，不要求瞬态100%必须绘制。另核对直传零SFTP READ、中转READ字节精确等于样本大小，保存DOM/WS及路径证据附件。

两轮复审修正第二连接使用Workspace新建标签，避免整页导航销毁首会话；登录使用浏览器context.request共享认证。根check、全量format:all:check、目标E2E严格TypeScript及diff通过，证据`/tmp/nexus-clipboard-progress-{check,format,types}.log`。本批仅测试和文档，无产品/UI代码变更；遵守D17未执行本地行为测试，新增场景待正式远程Actions，不引用前轮PASS作为本批结果；未发布或部署。

首轮25561d1b / [40340550595](https://github.com/0honus0/nexus-terminal/actions/runs/40340550595)：质量/构建/Docker与7分片通过，新增前端容量及列表分页回归通过；分片2新增直传/中转UI两例均在打开目标文件管理器前置断言失败，重试相同。trace/error-context明确已有可见目标dialog及目录，helper却以全文“File Manager”的first匹配首会话隐藏编辑器提示。替换为既有可见dialog定位，实际用户操作、进度/内容和路由证据断言保持。此轮不算验收通过，待修正后新SHA完整回归。

可见弹窗修正静态：根check、全量format:all:check、目标E2E严格tsc、ESLint与git diff --check通过，日志`/tmp/nexus-e2e-visibility-{check,format,types}.log`。产品代码无新增变化，无需重复产品构建；待新SHA正式回归，不发布。

第二轮1e9f8bac / [40342500710](https://github.com/0honus0/nexus-terminal/actions/runs/40342500710)：质量/构建/Docker、7分片及中转UI进度/哈希首跑通过。直传原生进度正常，9.4秒后SFTP核验not_found并发出failed/operation_unknown；两次相同。fixture的remapTransferExecPaths仅替换单独绝对路径，rsync -s的user@host:/folder-seed/目的路径经协议发送，没有在发起端映射到测试虚拟根，接收端exec无法重写协议内路径。修正夹具远端参数映射，保留真实原生传输、限速、最终SFTP核验及哈希；未降低产品unknown围栏或改UI。待新SHA完整验证。

夹具远端路径修正静态：根check、全量format:all:check、MJS语法、目标ESLint与diff通过；日志`/tmp/nexus-e2e-peer-path-{check,format}.log`。两轮源码复核确认实际rootDir路径不重复映射、原凭据临时目录不变、旧协议路径与新页面虚拟路径归同一fixture文件。无产品源码变化。

第三轮b1ba1399 / [40345176173](https://github.com/0honus0/nexus-terminal/actions/runs/40345176173)：质量/构建/Docker及7分片通过，直传和中转页面用例分别17秒/16秒首次通过，分片2全53项通过；DOM多个中间进度、实际总字节、WS completed后卡片退役、源/目标SHA-256及零/精确SFTP READ均通过。分片7现有connection-create失败后重试通过（整轮flaky拒绝），原因是浏览器response.json的CDP Network.getResponseBody返回No data found；页面快照仍有SSH connection failed错误结果。改测试一次性route.fetch捕获真实后端422正文并严格解码，route.fulfill交付同一响应；不重发、不伪造返回、不删除正文或UI断言。新SHA全量回归待验。

连接表单响应采集修正静态：根check、全量format:all:check、目标E2E严格tsc、ESLint和diff通过，日志`/tmp/nexus-e2e-connection-reply-{check,format,types}.log`。两轮复核一次性路由只覆盖失败测试POST，原请求内容/认证和真实响应保留，后续正常测试无拦截；无产品变化。

### 本批最终正式验收（2026-10-26）

产品/测试源码`dd7a558b572a4bb510ca70531d95f691967a7604`的[Actions 40347041664](https://github.com/0honus0/nexus-terminal/actions/runs/40347041664)全部成功：质量、生产构建、Docker部署冒烟和8个分片共494项首次通过；完整日志核对retry_entries=0、flaky_summaries=0，证据`/tmp/nexus-e2e-40347041664-all.log`。新增跨服务器复制粘贴页面直传17秒、中转16秒首次通过，完整覆盖DOM递增百分比/8MiB总字节、正式WS completed及卡片退役、源/目标SHA-256、直传零SFTP READ及中转精确READ字节。连接创建表单失败/成功/真实持久化全链4.5秒首次通过；501项/>1MiB脚本、12个慢目录、161条传输21页与重复拒绝、51会话跨页搜索及503后Retry恢复通过。

本次修复的远程失败均归测试：SSH多标签可见弹窗定位、rsync -s虚拟根路径映射、CDP响应正文采集；原产品UI设计、内容核验、unknown围栏和全部功能断言保留。`f340063f`只更新CI耗时估计并已同步本地。前述“待验”记录保留对应轮次边界，本批功能远程已验收；专项视觉未执行。本轮未发布镜像或部署，用户自行增删截图未纳入提交。

### Agent 输入框外侧玻璃底色（2026-10-26，本地静态）

按用户指定doc截图，移除AgentAppSurface输入区footer的ui-glass-chrome材质类，使外侧不再铺满导航玻璃底色、渐变和内高光。两轮源码复核确认只改该footer的一个类，输入框自身边框/焦点反馈、原间距/响应式尺寸、Token与跳转控件、公共玻璃材质定义和其它界面保持。USAGE对应输入区章节已同步。根check、前端build、全量format:all:check和diff通过，日志`/tmp/nexus-agent-footer-{check,build,format}.log`。按D17未运行本地行为或视觉测试；不为单项材质删除新增行为用例，不沿用前轮494项通过作为本轮证据。未提交、推送、发布或部署。

### 矮状态面板网络读数（2026-10-26，本地静态）

按doc服务器状态截图，沿原max-height:210px分支将网络标题与上下行速率改为左右同排；移除network-reading的0.68em父字号，将数值从0.58em恢复为与紧凑指标一致的0.76em，箭头保留独立字号及两方向间隔。紧凑加载骨架同步单行。两轮源码复核检查普通/窄栏/缩放规则优先级、趋势模式隐藏速率并保留网卡名、方向/完整aria-label与title、固定数据与点击入口未改。根check、前端build、全量format:all:check及diff通过，日志`/tmp/nexus-status-network-{check,build,format}.log`。D17下未本地运行行为或视觉测试，本轮不新增样式专用行为测试，不沿用旧Actions结果作为视觉证据；未提交、推送、发布或部署。前轮Agent footer样式修改保留。

### Agent 输入框上方独立控件（2026-10-26，本地静态）

按用户最新布局要求将Token、回到最新、上一条/下一条状态块移至form之前；只保留各自全局控件，无整条底色或边框。原footer透明表面保留。composer容器声明从form移到既有外层agent-composer-area，使上方控件和输入工具栏继续按相同可用宽度响应式收缩，不依赖整个聊天面板宽度；form测量ref、提交、键盘、详情弹层和导航条件/事件保持。两轮源码复核包含窄屏容器查询、Popover portal、按钮类型及既有E2E定位无失效消费，USAGE共同外框描述已按最新选择更新。根check、前端build、全量format:all:check与diff通过，证据`/tmp/nexus-agent-controls-{check,build,format}.log`。按D17未运行本地行为或视觉测试，不将旧轮次494项PASS当作本轮结果；未提交、推送、发布或部署。

### Agent 控件与紧凑网络读数交付（2026-10-26，正式远程通过）

产品提交 `7865bfc159b0ca750f80d06f93d01125576c695d` 的正式 [E2E 40355305638](https://github.com/0honus0/nexus-terminal/actions/runs/40355305638) 全绿：质量、格式、生产构建、Docker 部署 smoke 和全部 8 分片成功，共 494 项首次通过，无重试或 flaky。日志 `/tmp/nexus-ui-dev-e2e.log`；不把功能回归扩大为专项视觉验收。`a797ecd2` 只自动更新测试耗时估计，无产品代码差异，已快进同步。

用户随后授权的 [dev amd64 发布 40357533124](https://github.com/0honus0/nexus-terminal/actions/runs/40357533124) 成功，生产依赖审计通过。发布标签为 `ghcr.io/0honus0/nexus-terminal:dev` 和 `sha-a797ecd2bf79`，索引摘要 `sha256:5bff81c96b9d8cbd6f9e39f97a12ac00014d7f8c2d2a23126bae97527352a488`。通过 `docker buildx imagetools inspect` 核对实际平台 `linux/amd64`，镜像配置 OCI revision 精确为 `a797ecd2bf7967541e5ee52acfa031fd683d5845`；附属 `unknown/unknown` 清单为 BuildKit attestation。证据 `/tmp/nexus-ui-dev-publish.log` 与 `/tmp/nexus-ui-dev-image-config.json`。未更新服务器容器，个人截图增删未提交。

### 文件管理器路径栏垂直对齐（2026-10-26，本地静态）

路径原生输入框使用 flex stretch 跟随栏内高度、清除原生 margin，行高由 1 改为 normal，保留栏高、字体大小及各响应式断点。两轮源码复核确认左侧图标与父层 items-center、输入/导航/历史事件及焦点反馈保持。根 check、前端 build、全量 format:all:check 与 git diff --check 通过；日志 `/tmp/nexus-path-align-{check,build,format}.log`。按 D17 未执行本地行为或视觉测试，不沿用前轮 Actions 作为本次对齐修复的行为证据。未提交、发布或部署。

### 跨服务器安装准备与 SCP 性能（2026-10-26）

根因：amd 缺 rsync，RemoteFileModel 将 auto 强制映射为 rsync，阻断 Native adapter 原有 SCP 候选，退至 SFTP 中转。现在原样传递 auto，复制与发送复用已有远端依赖确认；用户跳过 rsync 安装后，普通文件再检查 SCP，跳过 SCP 后才中转。自动目录在 rsync 不可用时保留 SFTP 链接语义；不为此扫描目录。仅 SCP 单文件控制通道启用 PTY，原生百分比换算字节，最终仍核验目标；sshpass 仅包装 SCP 的 SSH 子进程，0700私有启动脚本与原凭据一起清理。

真实限定专项：源 pve_debian `/root/.hermes.zip` 1,665,738,475 bytes，目标 amd 的独占临时目录，原用户源与目标文件未改。原生 SCP 3.179秒/524 MB/s；最新 NativeServerTransfer 自动选scp，含探测/清理3.953秒/421 MB/s，原生进度32%/66%/100%；同文件 copyRemoteEntries SFTP中转10.222秒/163 MB/s，测试Node CPU user8.96秒/system3.25秒。两种路径及原生样本 SHA-256均与源一致，文件数据未损坏。SFTP对照进程位于VM，并非生产容器，未复现生产50 MB/s，不能以此作为浏览器端到端或稳定吞吐承诺。证据 `/tmp/nexus-transfer-{native,relay}-perf-result.json` 与 `/tmp/nexus-transfer-perf-hashes.json`；已清理本次自建临时数据及含凭据的临时测试脚本，原文件保留。

两轮源码审核覆盖安装跳过/失活/离页、网络拒绝延后、重复确认、auto选择、链接语义、SCP认证/原生进度/清理、已派发失败不换路径及fixture真实SCP进程与虚拟路径映射。根check、完整双端build、新回归严格tsc、fixture `node --check`、全量格式及diff检查通过，日志 `/tmp/nexus-transfer-final-{check,build,types,format}.log`。新正式回归覆盖两个协议入口rsync/scp/sftp，页面安装rsync、跳过改SCP、两工具都跳过改中转，保留真实字节/SHA及零SFTP READ断言；本地未运行这些E2E，待新SHA正式Actions，不引用前轮494项PASS。CDP9223/9224仍是未认证的api登录页，浏览器入口未验；未重启后端、提交、推送或发布。

### 远端工具默认选择、归档依赖与安装全流程（2026-10-26，本地静态）

逐项核对跨服务器粘贴、发送、ZIP/tar.gz/tar.bz2压缩与解压、普通SFTP文件操作、目录下载、服务器状态、Docker和Agent执行。修正ToolService的auto检查提前选择现有SCP、跳过默认rsync安装提示的问题，客户端严格验证预期工具；前后端共用archiveToolRequirements，归档一次只读预检包含压缩器及校验/快照/链接工具，早于写入；Native/Installer共用GNU能力探测；Shared缺失工具名取值补齐gzip/bzip2/grep/cp/ln，失败事件保留具体原因。普通SFTP不依赖这些可选工具，下载打包由后端归档库处理；Docker daemon与用户自定义命令没有相同默认候选/安装遗漏，本轮不改变其交互或自动安装策略。

新增remote-tool-flows：HTTP auto默认rsync安装计划；协议侧缺gzip/bzip2与ZIP逐项缺zipinfo/od/grep/cp/ln，验证COMMAND_NOT_FOUND/实际工具名及零归档进程；页面ZIP/tar.gz/tar.bz2安装后真实输出内容，root/免密sudo/密码sudo，错误密码、安装退出失败、成功退出但工具仍缺失、取消、无包管理器/无权限，以及存在非GNU tar时安装再继续。ZIP解压辅助工具安装后验证实际UTF-8内容；安装前/失败后均无原操作派发。扩充direct-and-relay-transfer的发送页面rsync安装、跳过改SCP、再安装SCP与离页不派发，保留真实方法/内容哈希；目录回退验证嵌套和根符号链接保留。包管理器安装由受控SSH夹具模拟，传输、原生压缩解压和文件读写仍真实执行；不在CI宿主实际apt安装或修改软件源。

两轮源码审核覆盖全部依赖消费者、Model/Platform隔离、协议字段、默认工具优先、取消/未知结果、提权密码stdin、工具安装后再次核验及测试夹具。复核修正新用例同target/peer ID非法前置与夹具对普通命令身份的影响，保持产品UI。根check、Shared/Backend及Frontend构建通过，日志 `/tmp/nexus-all-tools-{final-check,backend-build,frontend-build}.log`；新增/修改E2E严格TypeScript、fixture node语法与diff通过。21份生成的工具/归档脚本通过sh -n，16组夹具提权/缺工具/无包管理器变体通过bash -n，均未执行脚本内容，证据 `/tmp/nexus-all-tools-shell-syntax.log`。全量格式通过，日志 `/tmp/nexus-all-tools-final-format.log`；E2E类型结果 `/tmp/nexus-all-tools-final-e2e-types.log`。最初前端检查发现未重建Shared导出和残留清单赋值，修正并完整检查通过；首次格式检查发现夹具两处函数间距，已修正。

按D17未运行本地行为或E2E。本批新增场景待新SHA正式Actions，不能引用旧494项或上轮真机SCP吞吐作为本批验收；未重启、提交、推送、发布或部署。前轮路径栏修改与个人截图增删保留。

### 图片生成 HTTP 400 内容审核拒绝（2026-10-26）

用户指定 ssh.honus.top 的图片失败已通过宿主只读日志及 SQLite 关联：部署镜像 revision 为 a797ecd2bf7967541e5ee52acfa031fd683d5845，Run `25e2515b-f3bb-4e29-8ac7-c08af21c2cda` 的 image_generate 使用 gpt-image-2.5，约 43 秒后失败。对应上游 Images 请求在 UTC 16:44:56 返回 HTTP 400，日志明确说明安全系统拒绝并标记 sexual；发生在供应商生成接口，未进入 Artifact 保存或前端预览。未重放该提示词、未发起付费验证、未修改生产记录或部署。生产日志未保留返回 JSON 的结构化 code，因此该字段的线上透传仍需后续实际拒绝请求核对，不把日志中的 message 当作稳定错误协议。

源码在 SDK Adapter 识别结构化 moderation_blocked/content_policy_violation，Provider Model 转换到已有 PROVIDER_CONTENT_FILTERED，Run 使用 model_content_filtered；设置与聊天的三语文案说明请求或生成结果遭内容审核拒绝。SDK 原始正文和 cause 不进入协议或日志正文，未知 code 不通过正文字符串推断。依据为 [OpenAI 图片内容审核文档](https://developers.openai.com/api/docs/guides/image-generation#content-moderation)。不改变图片不重试及已派发 unknown 的现有规则，不改 UI 布局、样式或控件。

新增正式远程待测场景：

- `agent/functional-regressions.spec.ts`：分别验证 moderation_blocked、content_policy_violation、以及正文包含已知代码但 code 未知的 HTTP 400；必须返回对应安全失败码、不泄漏 fixture 私有正文、无 generatedImageId 或成功图片预览；重载保留提示且图片请求仍只有一次。
- `agent/provider.spec.ts`：两种已知拒绝在图片模型测试中返回 PROVIDER_CONTENT_FILTERED，不泄漏私有正文、不重试。
- 原图片成功用例保留，继续验证生成后的自动预览、下载字节和刷新恢复。图片 fixture 仅增加有限错误场景与独立计数，不使用真实上游或生产提示词。

两轮源码审核完成：第一轮核对 SDK→Model→Run/设置的有限失败转换、cause 与原取消/清理/不重试语义；第二轮核对图片落盘先后、首个失败与持久失败投影、重载无重发、未知 code 安全兜底，并补齐诊断日志 content_filtered 白名单。根 `pnpm run check`、双端 build、`pnpm run format:all:check`、新增用例严格 TypeScript、fixture `node --check` 和 `git diff --check` 均通过；证据为 `/tmp/nexus-image-rejection-final-{check,backend-build,frontend-build,e2e-types}.log` 与 `/tmp/nexus-image-rejection-format.log`。按 D17 未执行本地行为测试，新增 5 个用例尚未在远程 Actions 验证；未部署，不将源码或静态通过作为线上修复验收。

### 矮服务器状态面板网络读数间距（2026-10-27）

已读取用户 doc 截图：服务器状态处于矮面板单行模式，网络上下行读数均出现省略号。用户授权缩小左右留白与字体；改动仅在原 `max-height:210px` 容器分支，收紧非趋势内容边距、卡片内距、图标/标签/上下行间隔，并将速率字号结合实际容器宽度计算。正常高度布局、趋势内容留白、速率格式、配色和完整 title/aria-label 保留。

两轮源码复核覆盖容器查询、极窄面板隐藏图标规则、趋势选择器优先级与原状态缩放：数值字体只调整本层，上限不因缩小面板而反向增大；不增加 JS 测量或采样请求。根 `pnpm run check`、前端构建、`pnpm run format:all:check` 及 `git diff --check` 全部通过，日志为 `/tmp/nexus-status-compact-{check,build,format}.log`；遵循 D17 不运行本地视觉/浏览器或行为测试。本批实际待验为截图尺寸下两项速率与单位无截断，及宽窄拖动、滚轮缩放、展开趋势后的原布局。

### 远端工具准备、SCP 进度与图片拒绝诊断正式验收（2026-10-27）

产品/测试提交 `0f174219ca0cdac181035d57a33b42b8ec339732` 的正式 [E2E 40382042043](https://github.com/0honus0/nexus-terminal/actions/runs/40382042043) 全部成功：质量、格式、双端构建、Docker 部署 smoke 与全部 8 分片，共 526 项首次通过。逐分片日志 `/tmp/nexus-e2e-fourth-shard{1..8}.log` 核对重试 0、失败条目 0、flaky 摘要 0。

本轮三次失败回归修复均归测试：SSH exec 未转发 EOF 导致 SCP sink 无法退出；SCP/mkdir 的虚拟路径与 SFTP 不一致导致完成核验找不到目标；夹具缺 READLINK/SYMLINK。另外两个首次失败后重试通过的页面用例在标签激活 animation frame 前沿旧 active surface 操作，补等待目标标签 aria-selected=true。保留所有原产品 UI、进度/字节/哈希/元数据/链接断言、超时与 unknown 保护，没有扩大超时、强制点击或跳过完成核验。

最终回归确认：clipboard/send 原生 SCP 分别 13 秒/11 秒首次完成；页面 relay、skip-rsync、skip-all 均 16 秒首次完成；发送入口准备/安装/跳过/离页、目录及根相对符号链接回退通过。工具依赖与提权流程、归档格式/辅助工具、两种已知图片内容审核码与未知码安全兜底，以及原图片成功预览均通过；图片拒绝不重放、不泄漏上游正文或生成伪成功预览。此处行为验收不等于状态面板截图尺寸的专项视觉验收。

`0695d0bf1f24fb21d157924d620c8fb458dc7177` 只自动刷新测试耗时估计，已快进同步，无产品代码差异。[dev amd64 发布 40383423178](https://github.com/0honus0/nexus-terminal/actions/runs/40383423178) 已成功，生产依赖审计通过。标签 `ghcr.io/0honus0/nexus-terminal:dev` 与 `sha-0695d0bf1f24` 的索引摘要均为 `sha256:059d333a3fa22f81c4fbae18d0b8053c4c3234dfd0dc5649a010e5c7235df0fb`；实际镜像平台 `linux/amd64`，OCI revision 精确为 `0695d0bf1f24fb21d157924d620c8fb458dc7177`，附属 unknown/unknown 项为 BuildKit attestation。证据为 `/tmp/nexus-release-publish-full.log`、`/tmp/nexus-release-image-inspect.txt` 和 `/tmp/nexus-release-image-config.json`。本轮不更新服务器容器，个人截图增删未提交。

### Agent 会话列表删除按钮居中（2026-10-27，本地静态）

NativeThreadPanel 列表行为 items-stretch，全局 UiButton 固定高度配 my-1 使右侧按钮靠上；按钮改用 self-center 并移除垂直外边距，按整行居中。全局按钮尺寸/危险色、禁用态、再次点击确认及选择/搜索事件保持，USAGE 对应章节已同步。两轮源码复核、根 check、Frontend build、全量 format:all:check 及 diff 通过，日志 `/tmp/nexus-thread-delete-align-{check,build,format}.log`。遵循 D17 未执行本地浏览器或行为测试，桌面/手机实际视觉待验；不以之前 526 项通过作为本次样式验收，未提交推送或发布。

### Agent 工具卡片调用详情（2026-10-27）

本批新增单调用认证 GET，卡片展开后展示完整格式化参数 JSON 与持久失败码对应说明；加载失败仅重读详情，取消/未知不宣称远端回滚。源码两轮核对范围为 user/App/Run/tool 身份、Shared 严格解码、逐字段投影、原列表容量、失败码白名单、页面失活/卸载取消及 revision 晚响应保护；没有 schema 改动。

按 PLAN D17 未新增或运行本地行为/浏览器/E2E。正式远程待验：成功/失败/取消/未知调用，空对象与长参数/Unicode/换行/HTML 字符，失败详情读取后重试，展开/收起与切换会话/账号时的旧响应，以及执行中卡片状态更新；身份错配和越权应拒绝。本批根 `pnpm check`、双端 `pnpm build`、`pnpm format:all:check` 和 `git diff --check` 通过，日志为 `/tmp/nexus-tool-details-{check,build,format}.log`；不引用前批 526 项通过作为本批验收。

### Agent PHP/Typecho 规划任务与资源错误分类（2026-10-26）

本轮按用户明确要求，只读核对 ssh.honus.top 所在线上指定线程 `4b7dd2b9-bdfc-4064-8c16-e1cd21471938`、Run `8cd50043-c9dc-40f4-ad0a-9dc3abdc3f0c`。原提示要求“先定好计划”：Run completed，12 个模型步骤、15 次只读工具调用，无部署/启停/写入工具；其中 1 次 `file_list /home/honus/product/npm` failed，持久结果为 tool_target_unavailable，随后同 SSH 的正确父目录与 Compose 读取成功。宿主只读 ls 确认该路径不存在，实际目录为 `/home/honus/product/nginx_proxy_manager`，因此这是资源 not_found 被误报目标不可用，不能据此认定 SSH 断线。

计划明确注明仅从 Compose 判断结构且待核对运行态，未声称已完成迁移。本轮宿主只读 `docker ps -a --filter name=typecho` 与端口 20000 查询均为空，`joyqi/typecho:1.3.0-php7.4-apache` 镜像仍在；实施前应先核对实际站点来源，不能直接照“从当前容器导出”执行。没有启动镜像、恢复容器或修改生产数据。原参数与配置不落入公开日志/本文，不保留含凭据的诊断正文。

修复范围：ToolModel 保留 Remote not_found/forbidden 的独立具名拒绝，Run 投影资源不存在/远端权限拒绝安全码，Shared 有限码和三语原因同步；原可恢复只读失败继续反馈模型，身份失效、App 未授权、写入未知及清理失败不降级，file_list 说明通过父目录真实名称定位。两轮源码审核核对完整调用链与全部拒绝消费者。本批根 `pnpm check`、双端 `pnpm build`、`pnpm format:all:check` 与 `git diff --check` 通过，日志 `/tmp/nexus-agent-resource-failure-{check,build,format}.log`；按 D17 未新增/执行本地行为测试，新代码未部署、未正式 E2E。待远程覆盖缺失路径后继续读取、缺失 SSH 目标、远端权限拒绝与 App 撤权区分，以及写入派发后失败/清理异常的 unknown 围栏和卡片新码展示。

### 服务器状态卡片左右留白（2026-10-26）

用户授权收紧卡片左右外侧空隙，原 StatusMonitor.css 同步修改指标与加载列表水平 padding，去掉窄栏内容覆盖并同步矮栏骨架。两轮源码核对普通/150px/118px 窄栏、210px/270px 矮栏、趋势与手机覆盖次序；卡片内部间距、纵向尺寸、触控区域和数据逻辑保持。根 `pnpm check`、前端构建、全量格式及 `git diff --check` 通过，日志 `/tmp/nexus-status-card-inset-{check,build,format}.log`。按 D17 未运行本地浏览器或行为测试，真实宽窄/矮栏/手机及加载切换视觉待验；未提交发布。

### 文件管理器 `..` 返回行紧凑高度（2026-10-26）

用户授权缩小父目录返回行：只为父行单元格设置更小垂直 padding，移除父行名称原有底部留白；其他文件行、缩放、点击/键盘、20ms 预加载、右键和拖入不变。两轮源码核对全部可见列单元格与 CSS 优先级，父行仍独立于虚拟条目和 spacer，不修改虚拟文件行尺寸。根 `pnpm check`、前端 `pnpm build:frontend`、`pnpm format:all:check` 与 `git diff --check` 通过，日志 `/tmp/nexus-file-parent-row-{check,build,format}.log`；按 D17 未运行本地行为或浏览器。待正式远程验证宽窄栏与行缩放、父目录跳转、键盘/右键/拖入以及大目录滚动；未提交发布。

### 工具详情及界面细节本批正式回归（2026-10-27，待远程）

本轮补充既有图片成功/三类拒绝用例，验证持久工具详情、错误 Run 返回 404、展开卡片后的格式化参数与安全失败码，不改变图片预览、下载、内容审核及不重试断言。其余源码静态证据见上述各节。用户授权整批提交推送，完整正式 E2E 成功后发布 dev linux/amd64；不更新生产容器。

本批代码已提交推送 `22718980`。最终根检查、全量格式、变更 E2E 严格 TypeScript 与 diff 检查通过，日志 `/tmp/nexus-final-release-{check,format,e2e-types}.log`；临时 TypeScript 配置首次缺少 Node 类型路径，修正配置后通过。源码构建证据沿上述各节，未执行本地行为测试。

正式远程回归被 GitHub 平台阻断：2026-10-27 UTC，push 后没有创建新运行，手动 dispatch 两次均返回 HTTP 422 `Actions has been disabled for this repository`。仓库 Actions permissions.enabled=true、E2E 工作流 state=active、当前账号有 admin 权限；显式启用工作流后仍被拒绝，因此不是测试失败，不能宣称本批通过。账户计费/平台限制尚无法证实，当前令牌无 user scope，计费接口不可读；未更改令牌或账户设置。需所有者在 GitHub 恢复 Actions 可执行状态后再触发本批完整 E2E，通过后发布 dev amd64。镜像未发布，生产容器未更新。

### 手动清理 workflow（2026-10-27，静态待验）

新增 cleanup-history.yml 与维护脚本；仅手动触发，无 schedule/push/release。源码审核两轮核对包/仓库范围、latest/dev 多层 manifest 与证明闭包、渠道移动围栏、历史运行/产物保留、缓存删除、活跃运行与权限失败路径。只读实际 GHCR 核实 dev 索引包含 amd64 manifest 与 unknown/unknown attestation，不能只保留有标签的索引版本。未执行删除、未运行本地行为测试；实际清理与权限验证仍待手动运行。

### Actions 恢复及复制取消竞态（2026-10-27）

手动触发已恢复：40436334225 验证 7810d6ad，检查/格式/构建、Docker smoke 和 6 个分片成功；第 4 分片用例 registered copy progress 首次失败、重试通过，flaky 门禁正确拒绝，不能称全绿。截图与调用日志显示 Cancel 后任务直接消失且没有 unknown Toast。沿 FileService 核对：dispatchedMutation=false 的已取消任务应返回 cancelled；任务注册与实际远端写入之间存在正常异步间隔。用例先等待非零字节进度再点击 Cancel，以进入其声称验证的写入后 unknown 分支；原 Toast/隐藏任务/源文件断言、超时及产品 UI 保留。第 1 分片另有 4 项新工具详情用例失败：按 data-tool-name 同时匹配工具与审批历史 summary，严格定位正确报错；新增 data-tool-state 限定实际工具卡片，保留完整参数/失败码断言。详情认证读取、wrong Run 404 和安全码解码已先于页面定位通过，卡片显示断言仍待修复后的完整远程回归。

### 本批正式 E2E 与 dev amd64 交付（2026-10-27，完成）

GitHub Actions 限制已恢复。测试修复提交 `441dcc740660d337b6e7480bbb1f891a90a3079d` 的正式 [E2E 40437638548](https://github.com/0honus0/nexus-terminal/actions/runs/40437638548) 全绿：检查/格式/双端构建、Docker smoke 和 8 分片全部成功，共 526 项通过；完整日志 `/tmp/nexus-final-green-e2e.log` 核对失败、重试、flaky 均为 0。此前失败分别来自工具/审批同名定位和复制写入前取消的错误前提，均修在测试，未修改产品 UI、断言目标或超时。工具详情认证读取、错误 Run 拒绝、格式化参数、安全失败码和原图片成功/拒绝流程均通过。

CI 机器人 `440cb9e9271f16ac7c3eccb20437a25cf1e679be` 仅更新测试耗时估计，已快进同步，无产品代码变化。正式 [dev amd64 发布 40438690356](https://github.com/0honus0/nexus-terminal/actions/runs/40438690356) 成功，生产依赖审计通过。`ghcr.io/0honus0/nexus-terminal:dev` 和 `sha-440cb9e9271f` 索引摘要均为 `sha256:953b6ef14d7a02cca8076625706aa1bced9a774ed18618152872937f8b8cea64`；唯一实际平台为 linux/amd64，OCI revision 精确为上述机器人提交，unknown/unknown 项为证明 manifest。证据 `/tmp/nexus-final-dev-publish.log` 与 `/tmp/nexus-final-dev-image.json`。未更新生产容器，个人截图增删不提交。

手动清理 workflow 随 `cb9d1df3` 提交，脚本 node --check、ESLint、Prettier 和 diff 通过，完整 E2E 的仓库检查亦通过。依据用户最新“先创建”指令未触发清理，远程实际删除/包管理权限尚待手动验收；workflow 文件仅在 dev，GitHub 的手动入口首次注册仍要求默认分支存在该文件，未擅自合并 main。

## E2E 依赖拆分与构建复用（2026-10-27）

参考 [Grafana 构建分发](https://github.com/grafana/grafana/blob/main/.github/workflows/pr-e2e-tests.yml)、[Playwright fixtures](https://playwright.dev/docs/test-fixtures)、[项目分组](https://playwright.dev/docs/test-projects)与原生 failOnFlakyTests。未增加 Actions 总并发、放宽超时、删断言或修改产品 UI。现有按耗时分片只增加 backend/browser 清单过滤，未来未登记文件默认保留在浏览器组，不漏测。

静态列举（`playwright test --list --reporter=json`，未运行场景）确认 all 526、backend 122、browser 404，两个分组全集与 all 完全相同，无交集；移动撤权测试只改变文件，不减少场景。backend 直接使用配置的 localhost 后端 Origin；原非配置 127.0.0.1 Host 拒绝仍验证。浏览器使用 preview，Vite 8.3.4 源码确认继承 server.proxy。直接加载客户端的浏览器用例改用测试专用 Vite bundle，仍执行真实客户端与原断言，不把测试代码加入正式发布。

共享构建 artifact 保留 shared/backend/frontend 的 dist 目录，download 到 packages 后原相对依赖不变；每次下载来自同一个工作流 SHA。原应用关闭与未知/清理失败围栏不动，仅跳过不依赖的外部夹具重置。SSH 文档样本进程内生成一次再复制到各例目录，不硬链接可变文件；相对/失效符号链接原样保留。原生 failOnFlakyTests 替换 reporter 状态覆盖，首次失败 Trace/截图/录像继续保留。

基线 E2E 40437638548 墙钟约 620 秒；按其实测用例耗时 backend 串行约 395 秒、browser 约 2788 秒，默认同 8 runner 采用 1/7。真实新耗时与冷/热 runner image 待远程 Actions，不把理论估计写成提速结论。本地仅执行静态列举、检查与构建，按 D17 不运行行为测试。

静态已通过：根 `pnpm run check`、正式双端 build、测试客户端 Vite build、变更 E2E 严格 TypeScript、Node 脚本语法、`git diff --check`。日志 `/tmp/nexus-split-{root-check,build,clients-build,e2e-types}.log`。两轮源码复审覆盖配置、唯一清单、各启动命令、共享 artifact 目录、同源校验、夹具关闭/重置/复制与 reporter；未发现需更改产品接口或 UI 的项。正式 Actions 待推送后执行，全部首次通过才收口。

首轮 40442149074 的质量作业暴露旧根检查的干净环境顺序依赖：Frontend vue-tsc 在 Backend check 生成 Shared 声明之前运行；旧 workflow 额外 Backend check 曾掩盖它。本地既有 dist 无法暴露该问题。修复为根 check 先执行含 Shared build 的 Backend check，再执行双端 lint 和 Frontend vue-tsc，检查项不减；不恢复重复检查。后端独立命令及未预构建的后端分片/远程入口只构建后端和 Shared，不因前端构建失败而阻断手动协议回归；完整 CI 仍要求两组、全量构建、质量与 Docker 同时成功。

修复后的根检查及全量格式复核通过：`/tmp/nexus-split-root-check-order.log`、`/tmp/nexus-split-format-final.log`。另以 `/tmp/nexus-split-clean-check` 独立安装冻结依赖，不复制任何 dist，执行根检查全部通过（`/tmp/nexus-split-clean-check.log`）；初次 offline 安装因隔离目录无元数据缓存失败，改为正常冻结安装后成功。以上仅静态验证，没有本地行为执行。

首轮分组行为结果：4 个浏览器分片成功，其余失败均为测试环境入口偏差。backend 的 3 项 RDP 用例由 CommonJS 辅助器固定前端端口造成；browser 另有 4 项客户端场景与 19 项终端生命周期场景仍直接导入开发源码/解析开发版 Vue 模块。此前搜索输出截断遗漏这些入口，已完整核对全部 `/src/` 浏览器导入：改为两个测试专用 Vite library entries，包含真实客户端、真实 TerminalView、同一 Vue runtime、原 i18n 与会话状态，并加载真实终端 CSS；原功能断言不删、不放宽。RDP 辅助器按 suite 选择与 TS 配置相同的公开后端/前端端口，保留 Origin、票据与拒绝断言。构建配置位于 frontend/build，仅 E2E 命令调用，正式构建不包含这些入口。原日志 `/tmp/nexus-split-job-121985799{276,301,304,338}.log`，修复后的全量行为仍待下一轮。

第二轮 40443702665：质量、集中构建、Docker smoke 与完整后端 122 项通过，RDP 端口修复已验证。浏览器受同一测试打包配置问题影响：Vite library 模式默认保留 process.env.NODE_ENV，打包 Vue 后出现浏览器 process 未定义。测试专用配置显式将该值定义为 production，重新构建后全部测试 bundle 中已无 process.env 引用；不添加 process polyfill 或修改产品逻辑。库入口类型/全量格式及构建通过，证据 `/tmp/nexus-split-{types-final,format-adapt,clients-build4}.log`。共享 artifact 上传增加官方 overwrite:true，完整 rerun 重建同名产物，失败分片单独 rerun 仍可读取原 SHA 产物。下一轮 runner 指纹不变，可测热缓存完整结果。
