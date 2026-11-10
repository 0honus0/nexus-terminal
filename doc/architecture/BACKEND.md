# 后端架构

当前后端为 `packages/backend`，正式前端已消费 Shared。完整远程基线、后继修改与未验范围见 [E2E](../testing/E2E.md#当前验收基线)，当前工作见 [PLAN](../PLAN.md)。

当前设计同时记录尚未纳入全量验收的专项实现；新增目录选择、依赖安装和基础组件接入不自动纳入上述历史验收基线。产品行为见 [USAGE](../USAGE.md)，源码、静态检查和待验范围分别见 [PLAN](../PLAN.md) 与 testing。

本文约束后端及后续功能的放置和依赖。开发前由 [AGENTS](../AGENTS.md) 读取 [人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 与 [编码规范](../rules/CODE_STYLE.md)。按 [模块模板](MODULE_TEMPLATE.md) 维护下面八个章节，不复制人工规则和编码列表。

前八节维护后端通用边界、Access 与 Remote；后续按 [持久设置](#preferences-持久安装配置)、[日志审计](#operations-日志审计与通知)、[宿主诊断](#system-宿主诊断)、[设置与备份](#跨模块设置与备份设计)、[突变恢复](#共用机器突变围栏恢复)、[后台传输](#remote-后台服务器传输) 和技术边界展开。

## 1. 职责与范围

### 连接配置与凭据原子更新

1. **职责与范围**：Targets connections持有单连接元数据及可选凭据编辑，Remote握手和Workspace不变。
2. **子功能与目录**：沿connections的Service/Model/storage/SQLite及interfaces/http；复用credential Model的密文转换和Adapter现有凭据写入helper。
3. **依赖方向**：HTTP→Targets公开入口→ConnectionService→ConnectionModel→ConnectionStorage；SQL仅Adapter，秘密加密仅Model。
4. **类型与转换**：Shared更新请求可选credential，省略保留、null清除、对象替换；入口逐字段转换独立应用输入，Model转换为存储密文命令，读取摘要仍不含密码。
5. **入口与安装**：PUT /api/v1/targets/connections/:id使用同一原版本；register给原Model安装SecretBox并给Adapter安装凭据规则回调。独立凭据端点仍供批量编辑使用。
6. **数据、事务与并发**：原SQLite CAS事务同时写配置、关系和凭据；凭据类型或密钥引用拒绝回滚整项。版本只增加一次，无新表或迁移；版本达到安全整数上限拒绝写入。
7. **生命周期与失败**：沿原身份和版本校验；Model将存储引用拒绝转为安全应用错误。提交回执未知先只读核对，不重放；不得记录明文。
8. **当前能力与验收**：单保存行为见USAGE连接管理；定向真实SSH及回滚证据见testing，未将其扩大为全量回归。

### 远端工具安装

1. **职责与范围**：Remote tools 管理用户确认的远端依赖安装，供归档、跨服务器粘贴及服务器发送的依赖准备消费；传输缺少首选工具时先确认安装，用户跳过才检查下一种直传工具，均不可用则SFTP中转。仅安装服务器固定白名单工具，不开放任意命令、包名或仓库配置。
2. **子功能与目录**：`remote/tools/{service,model}` 持计划、授权和应用能力；`platform/tools` 持包管理器检测、固定包映射、提权认证及技术执行。HTTP 仍归 Remote interfaces。
3. **依赖方向**：HTTP → tools Service → tools Model → machines Model / Platform；Service 复用原 MachineMutationService，安装与文件、Docker远端突变按真实 endpoint 互斥。
4. **类型与转换**：Shared remote/tools 定义有限工具、包管理器、提权方式、安全检查/安装契约；独立应用对象归 tools/model，技术对象归 Platform；HTTP 与 Model 分别白名单投影。sudo 密码仅写入 SSH stdin，不进入命令参数、持久化、公开结果或日志。
5. **入口与安装**：认证 POST `/api/v1/remote/tools/check` 只读检测并签发短期计划，auto只准备默认rsync，不提前替用户选SCP；POST `/api/v1/remote/tools/install` 绑定原计划及原登录确认安装。register 安装并纳入 quiesce/close。
6. **数据、事务与并发**：计划只在内存有效五分钟，绑定目标指纹、会话摘要及缺失工具；消费后不能重放安装。实际安装先取得持久机器突变 claim 并事务复查身份，再复查配置及工具。重启不恢复执行；未知 claim 保留至人工恢复。
7. **生命周期与失败**：Service 追踪全操作至 SSH 关闭及 claim 结算，包命令输出有界消费。断连、超时和取消不证明远端安装停止，派发后无确定退出保持 unknown，不自动重试。认证失败发生于包命令之前，可重新检查再确认；安装退出后仍重新查找工具。前端原操作仅在依赖确认可用且原视图身份有效时派发。归档前后端共用Shared的archiveToolRequirements，Platform toolProbe统一查找及GNU tar/cp/ln能力检查；ArchiveModel显式传递有限技术工具名，所有依赖合并为一次只读SSH命令，早于压缩写入或解压快照。辅助工具缺失经COMMAND_NOT_FOUND和具体工具名回传，不被协议丢弃。
8. **当前能力与验收**：实现进度见 PLAN；root、sudo 免密/密码、apt/dnf/yum/apk/zypper/pacman 支持在固定映射范围内，无管理员权限或未知系统明确拒绝。保留原生归档能力要求与并发窗口，不承诺包管理器事务回滚。行为验收遵守 D17。

### Targets 导入补齐

Targets的Proxy/SSH Key/Tag列表在HTTP出口使用Shared管理集合预算（10,000项，Proxy完整JSON 64MiB、SSH Key/Tag各16MiB），超限返回413 limit_exceeded，不截断或交付部分列表；单项白名单仍由target-http-view持有。正式前端已消费对应Shared管理契约，其他Targets前端迁移状态归当前实施方案。

1. **职责与范围**：Targets import 持有批量连接导入，恢复文件上传、密码/私钥/代理凭据及逐项结果；不导入旧密文或兼容旧字段。连接测试的实际 SSH 生命周期仍归 Remote。
2. **子功能与目录**：沿用 import/service、model、storage、adapters/sqlite；HTTP 上传解析留 interfaces/http。SSH Key 与 Proxy 事务任务由原子功能 Adapter 提供，register 安装明确参与者，不复制 SQL。
3. **依赖方向**：HTTP→Targets 入口→ImportService→ImportModel→独立存储任务→SQLite；Model 加密明文并投影命令，Adapter 不读取应用类型或 SecretBox。
4. **类型与转换**：Shared connections/http 独立定义导入写命令和私钥联合，values 定义上传字段/容量；入口逐字段映射内部命令，Model 逐字段映射密文存储命令。文件是新格式的命令数组，不接受旧开发密文；结果不返回密码、文件内容或技术错误。
5. **入口与安装**：同一 POST /api/v1/targets/connections/import 按媒体类型接 JSON items 或 multipart connectionsFile；严格 UTF-8/JSON 和项目数量校验，文件内坏项返回安全逐项错误，其余项继续。正式前端按当前文件格式与结果契约消费。
6. **数据、事务与并发**：每个项目的标签、代理、内联私钥、连接与凭据同事务创建，任一拒绝全部回滚。已有代理仅在用户名相同且没有新凭据写意图时复用；秘密冲突明确拒绝，不覆盖他人配置。私钥名称唯一冲突明确返回，不自动重命名。
7. **生命周期与失败**：上传有完整字节预算和期限，写入前复验会话；已提交后失败不冒充回滚，commit_unknown 单独表示。单项失败不自动重放，保持输入顺序返回结果；日志不得包含明文。
8. **当前能力与验收**：导入源码及静态已收口，连接测试独立实现，完整功能对应与两轮审核见 testing；行为覆盖与待验范围见 testing，不代表后端 100%。

### 保存与未保存 SSH 测试

1. **职责与范围**：Targets resolver 只拥有目标/引用/秘密解析；Remote machines 拥有真实握手、期限和关闭，不把测试塞入配置管理 Service，不执行命令或创建临时记录。
2. **子功能与目录**：Targets resolver 的 Service/ssh-target-rules 决定输入与图容量，Model 负责存储/SecretBox 转换；Remote machines 的 connection-test Service/Model/type 管理用例与能力，接口沿原 Remote interfaces/http，不另建 testing 大模块。
3. **依赖方向**：Remote Service→TestModel→MachineModel→Targets trusted resolver / Platform SSH；Targets 不能反向引用 Remote。存储 Adapter 只接独立任务和显式图预算，不引入应用政策、应用错误或 Model 类型。
4. **类型与转换**：Shared connections/test-http、test-codec 和 values 拥有完整请求、结果/错误、容量。Remote HTTP→内部应用、TestModel→Targets public、Targets public→内部应用、Model→独立存储均逐字段投影；未保存解析没有虚构 ID/fingerprint，明文仅存在受信后端输出和写命令，不进入公开响应。测试Model将实际Host Key挑战逐字段转为ConnectionTestHostKeyFailure，HTTP仅在该具名失败投影422的hostKey，不公开技术cause或秘密。
5. **入口与安装**：Remote register 安装 POST /api/v1/targets/connections/:id/test、/test-unsaved。Access 是当前管理员身份权威；同一入场不重复认证，引用/Host Key 异步读取后、交付前仍复验。全局 Operations 观察 SSH_CONNECT_SUCCESS/FAILURE。
6. **数据、事务与并发**：引用的 Key/Proxy/Jump 在单一快照读取，递归环/深度/展开预算受约束。未保存请求不写数据库；每个测试使用独立机器，不借用普通 Workspace 资源。存储不存在/引用拒绝在 Model 转换，不由 Adapter 实例化应用错误。
7. **生命周期与失败**：HTTP 及真实任务均受15秒期限和断连/停机取消约束，最多8个在途。原 owner 等待实际 connect/close，未收敛任务不归还配额；关闭失败保留句柄/原因并阻断新测试，所有在途排空后汇总。成功必须完成本地关闭和当前身份复验；Host Key 未受信明确拒绝并投影本次握手挑战，交付前复验身份；前端可在用户明确确认信任后发起新测试，不自动信任。
8. **当前能力与验收**：保存/未保存握手、Shared、路由、审计观察及关闭链已接线，静态证据归 testing；真实 SSH/代理/跳板、取消/关闭和权限交错的覆盖范围见测试入口及 PLAN，正式前端已接线；实际覆盖范围见测试入口。

### Factors / Passkey 认证范围

Access 在 完整密码和摘要会话之上扩展 TOTP 与 WebAuthn。Factors 只拥有部分认证、挑战、密码因素启停与凭据操作；**完整身份权威仍为 access_sessions / AccessPublicApi**。Passkey 登录最终直接核实 WebAuthn signature/RP/Origin/user verification 并签完整摘要会话；已经建立的完整会话不因启用新 TOTP 被隐式撤销。正式Auth/Security已对接Shared因素与配置，本机前端证据归testing；审计/通知/动态Settings已接线，行为覆盖见 testing。Preferences 持久配置已接入多 Origin/RP，HTTP/WS 选择受信站点、Factors 按对应 RP 签发并验证挑战；Passkey站点配置在重启生效，实际行为覆盖见 testing。

WebAuthn 技术 Port 以具名选项表达 RP/user/credential descriptors，Adapter 先对浏览器 clientDataJSON 的 challenge/Origin/type 与 assertion RP Hash、UP/UV、counter 做确定性拒绝；第三方验证仍是最终权威，无法可靠分类的供应商异常映射为不可用而非凭据失败。注册与登录 options 明确要求 User Verification（required），与最终 requireUserVerification 一致。Model 在写 challenge 之前投影技术选项，HTTP 对 options 仅维护一套可选字段白名单；HTTP 签发后的挑战 Cookie 必须交付成功，若在完成之前断开连接则撤销已提交的 challenge/TOTP setup，回收失败保留因果。交付由 Access interfaces/http/access-delivery 唯一持有：原 response、socket 和 request 共同观察，只有原传输未销毁/中断时的 finish 才结算成功；关闭后缓冲清空或迟到 finish 不解除失败撤销。所有路径解除原监听，撤销失败只执行一次并保留因果；本地 finish 不等于浏览器收件确认。源码/静态收口；当前行为范围以 testing 为准。

### Access 核心认证与入场策略

Access 统一拥有初始管理员、密码身份认证、token 摘要会话、登录失败/封禁、来源白名单和 CAPTCHA 准入。HTTP/WS 接收由 Platform HTTP 从 TCP peer 与明确受信代理链解析的来源，不读取业务客户端自报 userId/IP；已登录身份由 Access public 的 token/digest 实时复验。安装态策略真实执行，Preferences 已提供核心持久设置，IP/监控热更新，CAPTCHA/站点重启生效；执行配置与 Operations 已接线，外围集成配置已有实际消费者；TOTP/Passkey 已由 factors 实现完整挑战流程，完整因素不能被密码闸门绕过。

### 资源观测与 Docker

Linux 采集唯一实现为 `platform/system/adapters/posix-status.ts`，由 Remote register 安装到 ObservationModel。一次命令导出 `LC_ALL=C`，按段读取 `/proc/meminfo`、`/proc/loadavg`、CPU/网络内核事实及 df；不解析 free/uptime 的可翻译标签。内存优先 MemAvailable，缺失时按 MemFree + Buffers + Cached + SReclaimable − Shmem 估算并夹取到总量；应用容量为 MiB、磁盘为 KiB、网速为 bytes/s。远端内存当前按 MiB 四舍五入，不承诺与 free -m 截断值逐整数一致；缺失必需内核数据明确采集失败，无非 Linux 回退。本机 System 使用 Node OS API 与 /proc/meminfo，不依赖本地化 shell 输出。

Remote 的 monitoring 子功能负责普通 Workspace 状态订阅、Docker 查询/控制和后台 SSH 资源采样；不执行任意用户命令、不复制 Workspace registry。System 负责本机状态。cwd 已归 sessions，快捷命令/命令历史已归 Preferences commands/history。

RemoteObservationService.run 不设普通观测的全局任务数量上限；tasks 只追踪真实在途和清理未确认的任务，不以数量拒绝第9个或更多已接纳 Workspace 的采样、Docker及后台采样操作。原45秒期限、授权、取消和停机等待保留；状态订阅由 startStatus 串行采样；遇到具名 RemoteResourceCleanupFailure 时先停止原订阅，再交付 operation_unknown，禁止定时重建 SSH 累积未释放任务。stop 继续追踪本轮真实结算后清除 collector baseline；run 与 Workspace 的未确认任务及停机失败证据不删除、不重置。普通读取失败仍可按周期重试；Shared及前端契约不变。

### 服务器传输与Workspace任务的范围

Workspace的copy/move/archive已归Remote Files，按原附件准入和原任务生命周期执行。旧正式 /api/v1/transfers 的send、列表、详情、cancel、remove是独立后台服务器任务，源机器执行rsync/scp并交付目标凭据；当前register已安装这五个HTTP，Shared server-*契约及正式API/store/UI消费者同步迁移。两条链独立验收，后台任务不借用Workspace授权；设计见本文“Remote 后台服务器传输”，当前证据见testing。

### Workspace 当前边界

WorkspaceFilesSession显式关闭绑定原attachment，WorkspaceService先撤销操作权再等待真实资源排空。周期检查在此阶段继续通过Access复验Cookie，不能把正常closing误判为身份撤销并丢失关闭回执；该通道保留只用于原关闭结果，其他操作仍由allowed拒绝。释放原attachment同时清除关闭标记，迟到结果不得授权后继attachment。

挂起目录通过独立 `/ws/suspended-sessions` 提供首次/变化完整快照，不创建 SSH Workspace。WorkspaceService 持按用户变化事件，覆盖标记、恢复预约/ACK/回滚、续租、detach、改名、终止、自然断线及日志过期；WS Interface 持连接内 revision、合并串行快照读取、发送前身份复查和背压失败关闭。订阅先登记再初读，读取期间变化使旧快照失效；3秒串行身份复查、15秒心跳，不定期重读目录。关闭先退订和清 timer，再等待原快照/授权任务；客户端隐藏或断线重连后重新取得完整快照，HTTP 写入及显式读回保持原 owner 与未知围栏。Shared events 负责严格协议，接口复用 suspend-view 白名单；不按单个终端复用控制 socket。

Remote 的普通 SSH Workspace 是一条持续存在的交互式 shell，而非 Files attachment 或一次性 HTTP PTY。一个 Workspace ID 对应唯一应用会话 owner，涵盖 pending/open/离线宽限/挂起/恢复交付/closing/清理待确认；外部 WS 仅持有可撤销 attachment。Access 注销令当前 Cookie 失效，附着 WS 在身份复查时关闭；这与终止原 Workspace 是不同操作，断开后按普通宽限/挂起保留策略管理原 PTY。同用户以新有效登录和原 Workspace 凭据续接，显式 ACK 后关联 Files 按新会话重新取得资源，不复用旧会话文件权限。已有独立 Remote HTTP/PTY 保留其实际消费者与关闭语义，不冒充可恢复 Workspace。WorkspaceService 向 Files 显式提供原实例与会话摘要绑定的 WorkspaceFileAuthority（Files Model 应用契约），统一检查生命周期和挂起租约；独立上传、下载交付及多步骤传输通过该能力复查，不依赖扫描先撤销控制 WS。Files 不反向引用 Workspace Service，Platform/Shared 不承载该后端私有政策。跨 Workspace 复制同时绑定原源和目标 owner；普通离线宽限与独立 Files 保持各自政策。检查只限制后续应用派发/交付，不承诺撤回已派发技术调用；授权失效不免除清理责任，远端清理未知保留原因及现场。

当前唯一后端为 `packages/backend`（原 backend-next），包名为 `@nexus-terminal/backend`，入口为 `dist/main.js`。宿主版本读取本包交付的 `package.json`，Backend包版本与产品版本同步，不依赖仓库根路径。旧 Backend 已移出工作树；功能追溯使用 `05e140d2:packages/backend` 或 Git 历史，不能恢复运行时兼容层。源码归一不代表统一 E2E 已验收；现有未验范围仍由实施方案与 testing 承接。

| 一级模块    | 业务 owner                                                    | 当前边界                                                                                                                  |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Access      | 账号、认证、会话与访问策略                                    | 管理员初始化、密码、TOTP/Passkey、来源/IP/CAPTCHA、会话与撤销；正式前端已接入 Shared，真实硬件和故障组合按 testing 区分。 |
| Targets     | 连接配置、凭据、Proxy、SSH Key、Tag、目标解析与 Host Key 信任 | 管理、导入、测试输入、最近连接及 SSH/RDP/VNC 可信目标解析；实际连接归 Remote。                                            |
| Remote      | 普通用户终端、文件与远程用例                                  | Workspace/Files/传输/挂起 WS/监控/Docker、浏览器 RDP/VNC 桥及确认后的依赖安装；当前未验范围分别记录。                     |
| Preferences | 核心安装配置、个人偏好、布局及命令/路径数据                   | 核心 CAS、按消费者热更新与冷配置、个人完整偏好及目录数据；正式前端消费独立版本，不混用授权或写入。                        |
| System      | 本机状态、备份恢复与诊断                                      | 本机成功缓存、全局在线恢复、进程及模块资源诊断；数据库 Worker 独立指标，不以逻辑字节冒充完整内存归因。                    |
| Operations  | 日志、审计与通知                                              | Pino 后端日志、动态日志级别、有限审计与通知投递；不归 Preferences 或 System 复制实现。                                    |

本机状态已有独立 System owner；Preferences 已接入核心持久设置；Operations 已持有 notifications/audit/logging，System 已提供宿主诊断；后续能力按真实业务所有权实施；

### Shell 启动探测与提示符 Hook

NativeShellIntegration 在首个终端附件开放输入前，用同一次隐藏命令完成PID/种类探测与Bash/Zsh提示符Hook安装；Shell专用语法仅在识别后执行固定引号内的脚本，不把Bash数组语法交给其它Shell解析。避免两次readline提交之间切换echo；初始化先读取实际TTY标志，Bash真实PTY原先关闭echo时定向回退隐藏提交产生的一行，再原位重绘，不猜测或匹配提示符正文。Setup唯一持有start/end及部分marker缓存、期限和关闭拒绝；输出仍在journal/WS之前剥离随机内部marker及命令回显，不按提示符正文去重、不裁剪普通登录空行。原currentDirectory、排队cd、用户输入后禁止新探测与不支持Shell拒绝契约保持，行为验证见testing。

### SSH 已配置凭据优先认证

1. **职责与范围**：Platform SSH route 持技术认证顺序，优先使用 Endpoint 已选择的密码或私钥，正常成功路径不先发送 none 探测。
2. **子功能与目录**：仅调整 `platform/ssh/adapters/ssh2/ssh-route.ts` 的 createConnectConfig，不新增连接池或业务层缓存。
3. **依赖方向**：Remote Machine Model → MachineSshFactory → openSshRoute → ssh2；直连、代理、每个跳点及使用同一工厂的 PTY/SFTP/命令均消费该配置。
4. **类型与转换**：仍由 MachineAuthentication 判别联合生成 ConnectConfig，密码、私钥及 passphrase 显式赋值；authHandler 为供应商技术配置，不进入 Shared 或应用 Service。
5. **入口与安装**：原 createConnectConfig 的 password/publickey 排在 none 前，保留服务器主动允许无认证的原能力；不新增认证模式或绕过主机密钥校验。
6. **数据、事务与并发**：无存储变化，各 SSH client 独立持认证序列，继续使用整条 route 的同一期限及原凭据快照。
7. **生命周期与失败**：原 hostVerifier、取消、认证拒绝、route 失败销毁及关闭确认不变；不在凭据失败后自动重连或切换密码/私钥。
8. **当前能力与验收**：源码依据为 ssh2 默认 none 优先序列及当前配置认证；正常成功每跳少一次认证往返，实际端到端耗时与服务器认证组合仍待测。USAGE 见终端章节，静态及待验归 PLAN/testing。

## 2. 子功能与目录

### Factors 目录与唯一 owner

`access/factors/service/factor-service.ts` 管因素用例、cookie 对应的授权、失败与恢复政策；`factors/model/{factor-model,factor-types,options-projector}.ts` 管存储↔应用字段投影、SecretBox 加解密、TOTP/WebAuthn Port 调用、WebAuthn 浏览器选项白名单；`factors/storage/factor-storage.ts` 仅定义持久命令；Access 一级 `access-failure.ts` 持有跨账户/认证/因素共用的内部具名错误；`factors/adapters/sqlite/{factor-schema,factor-sql}.ts` 持 DDL、事务、challenge 与 counter 原子更新。Platform 的 `security/{totp-port,webauthn-port}` 与 `adapters/{rfc-totp,native-webauthn}` 只拥有通用算法、签名验证和提供者消息。HTTP `interfaces/http/factor-http.ts` 接真实路由，Shared `access/factors/http.ts` 负责严格未知输入解码；不向其他模块新增部分登录 public。

### Access 目录

`access/authentication/service/access-service.ts` 编排账号初始化、改密与密码登录用例，`accounts/model/account-model.ts` 隔离 Scrypt Port 调用、账号行转换和存储能力；`accounts/adapters/sqlite` 负责唯一初始化与改密撤销事务。`sessions/model/session-model.ts` 负责会话 token/digest 应用转换，`sessions/adapters/sqlite` 负责会话查验、CAS 签发、原子失败计数、封禁解除与分页。`admission/service/source-admission.ts` 消费安装时验证的 IP 白名单和失败政策；`admission/source-ip-rules.ts` 只含白名单容量/条目和内网分类纯规则；`admission/model/source-address-model.ts` 将技术解析转为普通应用地址/网络事实；`platform/security/source-address.ts` 定义通用地址契约，`adapters/source-addresses.ts` 独占 ipaddr.js。`captcha/service` 决定配置、是否需要验证与 token 预算；`captcha/model` 持有第三方验证调用与错误转换；`platform/security/adapters/network-captcha-verifier.ts` 负责带期限和受限响应读取的供应商 HTTPS 表单协议。Access HTTP 只实现 Shared 的解码和逐字段结果投影，不接触 hash、SQL、CAPTCHA secret。

### 监控目录

`remote/monitoring/service` 持有准入、采样状态、按主机缓存、授权及 Docker 操作用例；`monitoring/model` 持有内部事实类型、可信目标到临时 SSH 能力的转换、技术失败及输出转换。`platform/system/adapters` 解析 Linux/Node 状态，`platform/docker/adapters` 构造 Docker 命令并严格解析原生 JSON。`system/status/{service,model}` 负责本机状态用例，不依赖 Remote 私有代码。Shared 的 `remote/monitoring`、`remote/docker` 和 `system/status` 持有双端协议。

### 子功能设计

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

Targets 的 connections/proxies/ssh-keys/tags/host-keys/resolver/import/management 为同一模块子功能；共用持久引用拒绝定义在 targets/storage/target-storage-refusal.ts，SQLite Adapter 在删除事务内核对真实引用，Model 转为 reference_in_use，不依赖 RESTRICT 的供应商扩展码推断业务语义；模块级 `targets/model/target-technical-failure.ts` 仅复用这些子功能的技术失败转换，不承载用例、类型集合或存储；Remote 的 sessions/files 各有资源；共用可信目标→SSH 建连转换归 `remote/machines/model`，不为该共用 Model 机械创建空 Service/Storage；通信对象在 Shared，内部可信输入和用例/存储对象仍各有 owner。无持久化功能不创建 storage。文件按职责和消费者拆分，独立 helper 不自动升级为公用能力。

## 3. 依赖方向

### Factors 调用链

密码成功且 TOTP 已启用时，`AccessService → FactorService → FactorModel → FactorStorage → SQLite` 写五分钟待认证；`POST /auth/login/2fa` 读取独立部分 Cookie，再经 `FactorModel → TotpPort → RfcTotp` 真实验证，最终同事务删除 pending、插入完整 session、清失败计数。WebAuthn OPTIONS/VERIFY 经相同 FactorService/Model，Model 消费 `WebauthnPort`，Adapter 调 `@simplewebauthn/server` 并将不可确定的供应商异常封装为具名技术失败；Model 转为安全应用失败；Shared unknown 解码经 HTTP 显式转换为内部 credential evidence，不让原始第三方凭据对象进入 Service。Platform Port 是合法通用技术契约，Service 不直接调用。

### Access 调用链

Bootstrap 安装 Access、注入技术 Scrypt/SQLite/CAPTCHA Adapter；`platform/http` 只解析来源、Host/Origin/CSRF 和通用路由。安装模块时，对业务 HTTP 与 WS 路由施加 `AccessPublicApi.admitSource(trustedIp)`，登录/状态/登出/管理员黑名单恢复 HTTP 路由使用只检查白名单的 `admitAuthenticationSource(trustedIp)`（登录封禁由用例返回 429）；未匹配 HTTP 路由通过 Platform 可选通用回调先执行完整来源准入；业务端点依旧经各自 Access public `authenticate/authenticateDigest` 判定当前身份。Access Service → Accounts/Sessions/Captcha Model → 各自 Storage/Platform Port → Adapter。Service 不直接调用密码、网络、SQL Port，Platform 不依赖 Access 业务类型。正常 HTTP/WS 入场不重复身份查询，长时建连、资源交付和敏感操作由所属 Service 复验原会话及实例身份。

### 监控调用链

Workspace WS → RemoteObservationService → WorkspaceService 实例绑定任务能力 → ObservationModel → machines/model、System/Docker Port → Adapter。Dashboard HTTP → 同一 ObservationService → Model；本机 HTTP → SystemStatusService → SystemStatusModel → LocalStatusPort。技术命令与供应商输出只在 Adapter，Platform 不导入模块/Shared 业务对象。

### 依赖约束

WS/HTTP → Workspace Service → sessions Model → machines/model → Platform ssh-port → ssh2 Adapter；Workspace Service → Files Service 的实例绑定能力，不经 WS 反向寻找资源。Workspace Service → History Model → Platform 日志/checkpoint/renderer Port → 本机文件/终端 Adapter。Interface 只投影 Shared 协议和安全错误，Service 不导入 Shared wire；

```text
Bootstrap → 模块 register / 迁移安装入口
Bootstrap → Platform 技术实例
Interface → 本模块用例 + Shared 协议
Service → 本模块 Model / 子功能纯业务规则 + 所需跨模块公开能力
Model → 模块 storage 契约 / Platform 技术契约 / 子功能纯业务规则
SQLite Adapter → storage 契约 + Platform SQL
```

业务 SQL Adapter 不依赖 Model/Service/Shared 对象与协议；确需共享的基础值只从 Shared 精确 values 路径引用。

跨一级模块仅用 public 安全能力和明确安装契约，不深层导入 Model/Service；模块内部可直接协作，不绕全局 dispatcher。Service 定义密码/凭据保护的业务政策，Model 通过技术 Port 调用 SecretBox/PasswordHasher 并映射应用结果，技术细节和密码哈希算法由 Platform Adapter 持有。应用实例依赖由 Bootstrap/register 安装，不使用可变进程级数据库单例。

Port 文件表达 Platform 的技术能力及技术输入/输出，不是新增业务层：Model 调 Port，具体 Adapter 实现 Port。原始第三方对象不得进入应用类型。文件是否命名为 *-port 不改变此边界。

## 4. 类型与转换

源码清理仅删除无人消费的预留类型/导出；内部仍使用的规则和行解码留在原owner。六个业务模块与Platform技术目录均有正式入口，`platform/tools`仍服务远端工具安装，不是旧Agent残余。历史迁移的依赖闭包及挂起日志已使用的数据路径保留，不因目录或字段含历史名称删除。

### Factors 类型及公开白名单

Shared 的 `access/factors/http.ts` 拥有 TOTP token/disable、WebAuthn credential JSON 和 Passkey 名称/发现 query 的未知输入解码，以及公开成功结果。Factors 内部身份、PendingLogin/FactorChallenge/PasskeyCredential 分别归 `factors/model/factor-types.ts`，Storage 行/命令归 `factors/storage`，Port 的公钥/注册结果不含 account/user 类型。HTTP 明确构造用户/id/计数/时间响应，登录成功联合含 `requiresTwoFactor:true` 的部分分支，注册/认证 options 由 Model 的 `options-projector.ts` 投影；完整会话 bearer、服务端 pending/challenge cookie 和加密的 TOTP secret 不进入跨模块 public。Factors Adapter 复用 Sessions 的事务内身份读取，不另写一套会话 SQL；到期时钟在读取后取值，挑战消费在实际事务中读取并判断期限。令牌生成/摘要技术异常由 FactorModel 映射；Passkey 列表交付前由 Service 复查原会话。凭据持久编码与容量由 Adapter 严格解码，基础容量精确引用 Shared values。

### Access 类型唯一归属

Shared `access/{values,http,model}` 持有 cookie 名与持久时长、CAPTCHA 有限值/预算、登录 body、status 联合、公开 site key、黑名单分页与安全错误；Access 内部身份和密码登录请求归 `authentication/model/access-types.ts`，账号归 `accounts/model/account-types.ts`，登录计数/会话归 `sessions/model/session-types.ts`，验证码安装事实归 `captcha/model/captcha-types.ts`，技术 CAPTCHA 请求/失败归 `platform/security/captcha-verifier.ts`，存储行归对应 storage。接口 unknown → Shared codec → Access 应用命令；Account/Session Model 逐字段转换 SQL 行，Captcha Model 逐字段转换供应商请求和失败；`register.ts` 及 HTTP 接口逐字段投影 public 身份及 wire 响应。未暴露 password_hash、secret、cookie token 给其他模块。安装 CAPTCHA 字段独立定义在 register，并逐字段转内部 CaptchaConfiguration；SourceAddress/AllowedNetwork 在 admission/model，不含 ipaddr 实例。

### 监控类型

Shared wire 与内部观测事实独立定义；HTTP/WS 投影逐字段构造，包括 Docker stats、ports、labels 和 loadAvg。内部复用事实在 monitoring/model/observation-types，本机类型在 system/status/model/status-types；技术事实归 Platform。任务 scope 归 sessions/model/workspace-types，不暴露机器句柄。

### 唯一类型与转换

| 边界                                                   | 真实输入/输出                                                             | 唯一 owner                                                     | 白名单转换/消费者                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| WS envelope 与 connect/resume/terminal/suspend         | unknown JSON、requestId、viewport、token、generation、ACK、事件及安全失败 | Shared `remote/workspace`、`remote/terminal`、`remote/suspend` | Shared codec 严格读取；WS → sessions model 入参逐字段；WS 逐字段投影响应及事件；正式前端消费 |
| Workspace 应用会话、attached owner、pending 恢复、游标 | 状态判别联合、身份摘要、实例 generation、任务与关闭能力                   | `remote/sessions/model/*-types.ts`                             | sessions Service 消费；Model 转为纯技术连接/日志命令，敏感值不出 HTTP                        |
| SSH/PTY/channel/technical error                        | machine/shell 字节、开关/退出与派发结果                                   | `platform/ssh/ssh-port.ts`                                     | ssh2 Adapter 归一技术错误；sessions Model 映射具名应用失败，保留 cause                       |
| 日志/checkpoint 技术事实                               | 有界字节范围、偏移/修订、模式与视口                                       | sessions Model + Platform 本机日志/terminal 技术契约           | Model 字段投影；Service 持有页大小/保留/恢复政策；WS/HTTP 安全输出                           |
| 关联 Files 资源                                        | workspaceId、会话绑定与附件实例                                           | `remote/files/model/file-types.ts`                             | Workspace Service 调用 FileService 的实例绑定 release；Files Service 自行管理任务            |

Files请求/完整成功结果和ready/error事件统一由Shared remote/files/workspace及codec表达；正式浏览/编辑/预览消费者已迁移，不留转导出兼容桥。metadata的accessedAt/modifiedAt由SFTP Model转换为Unix毫秒后投影，前端不二次换算。目录列表不设置条目数量门槛，完整响应仍按Shared的8MiB字节预算；搜索同样不设结果数量门槛，完整结果沿原8MiB响应预算校验，后端遍历队列/并发策略仍归Files。正式下载与上传port已迁Shared；上传完整回执/终态按原附件投影，failed.message使用Shared有限RemoteFileErrorCode，内部FileUploadEvent仍归Files Model；独立服务器传输HTTP也已接Shared；完整页面消费者已接线，验收范围见 testing。

内部复用应用类型在所属 `model/*-types.ts`；存储契约在 storage；技术契约在 Platform；后端跨模块类型在 public；双端契约按 [Shared 架构](SHARED.md) 归属。类型与实现分开，低层不反向引用上层。Remote 内部会话关闭原因归 sessions/model，后端公开原因独立定义；内部 Model/Service 不引用本模块 public 类型。

业务流程、权限和操作顺序由 Service 持有；复杂或共用的纯判断放所属子功能 `*-rules.ts`，输入/结果类型仍归 model。规则只消费应用事实，不引用 Model 类、Service、Storage、SQL 或网络；简单判断直接留 Service，不为每个操作创建规则文件。Model 不内置业务算法，可以在事实转换回调中调用规则。

Model 逐字段转换应用与存储/技术输入结果；模块入口/出口 mapper 保护公开边界；HTTP/WS 逐字段投影完整 wire。三个边界各有职责，即使字段相同也保留运行时白名单；同一边界不复制转换。复杂公开投影可独立 public-mappers，单处投影就地保留。

应用与存储/底层能力之间明确保留 Model 转换层，即使当前字段一致、暂不需要变换，也不让 Service 绕过 Model；协议入口/出口 mapper 同样保留。精简只合并同一边界的重复实现，不删除转换边界。同一用例兼有存储与远端资源时，由 Service 协调；复杂度确有需要时按存储转换和资源封装拆分 Model，数据库事务不覆盖远端副作用。

协议差异由 interfaces 解码和投影，Service 以真实业务语义组织用例，不使用 Legacy/New 等迁移标签构造长期双轨。同语义共用路径归一、结果确认及资源执行机制；不同的覆盖前提、编码和操作范围保留明确用例。协议容量由 Shared codec/interface 校验，Service 另守应用路径、操作权限、预算与副作用约束。

Files 的 `FileResource` 只提供应用身份、可用状态、metadata/字节读取、staged write、基础 SFTP mutation、realpath/chmod 及受约束 command 结果；Machine/SFTP lease/Node Stream 私有持有于 Model 的 `SftpFileResource`。Model 负责技术 metadata/byte source、同目录临时项和技术 commit/discard 转换；Service 持有 UTF-8/hash/文件类型、覆盖、编码、search、递归/force 删除、批量顺序和写后确认等业务政策；目录搜索流程归 `files/service/file-search.ts`，资源准入与整项期限由主 Service 统一管理，不取得技术句柄。Files 内部失败码归 model，HTTP/WS 分别白名单投影公开契约。

HTTP 流式下载的身份、Workspace owner、原附件期限及下载票据绑定维持不变；HEAD 只读元数据复用 owner 的 FileResource，GET 的实际 byte body 由 FileService 准入一个 fingerprint 一致的独立 SFTP 技术资源，避免浏览器取消导致主 Workspace lease 同时退场。该临时技术资源关闭结果仍记录在原 owner cleanup ledger，失败或未知不可推断为已清理。Platform SFTP Adapter 的有限列表按调用方明确的条目与元数据预算执行，不再叠加固定的 10,000 项或 2 MiB 上限；公开接口的页面/响应容量仍归原业务 owner。Platform SFTP Adapter 针对 RTT 较大的 4MiB+ 下载使用有限 8×32KiB 并行 READ、按 offset 严格有序输出、关闭前结算全部已派发读取；取消时必须确认整条 lease 关闭。写入端用户明确 Cancel 在 stage 未提交且通道仍可用时等待已有 WRITE 结算，确认私有暂存删除后再返回，不提前 abort SFTP 去制造伪 unknown；完成阶段或断流时仍保留未知状态。以上只是源码候选，远程 admission/backpressure/字节 hash/Handle 计数/复原必须独立验收。

第八轮进一步确认 `/ws/uploads` **丢失客户端 binary transport 不等于专属 SFTP 失效**：过去 onClose 立即 abort 复合 signal，先前已 ACK 的写入也无法经过 `stage.discard()` 的确认流程，进而在 reset 留下 RemoteResourceCleanupFailure。新的未提交 owner 候选只对尚未 terminal、SFTP stage 仍在且 signal 有效的任务停止接受新帧、令上传 worker drain 已派发队列后做正常关闭及删除；仍向调用方投影不确定操作结果，不能擅自标为 `cancelled` 或 `completed`。

八组最新 Actions `39239518815` 证明同类异常仍发生于明确的 `upload.abort`：旧 Service 的 `finishUpload(mode='abort')` 即使拥有未提交、可收敛的 SFTP stage，也在 reject 已接收字节之后立即 abort 其 SFTP 信号，导致 `stage.discard()` 没有可用连接确认。这条独立调用路径现与 binary WS onClose 一样，保留健康的技术 lease 到 ACK 队列和 stage 的删除/关闭结算；不同之处是 transport abort 始终以 unknown 投影，绝不报告用户已成功取消。

Workspace WebSocket 在绑定附件后的 owner 身份轮询属于 Remote WS 协议边界：密码轮换的 Access/SQLite 事务会撤销旧 token；即使 socket 上不再发生 RPC，`WorkspaceFilesSession` 每 3 秒重新调用 Workspaces.allowed 验证会话及附件身份，失效主动 close(1008)。既不引入旧兼容 WS，也不延长原安全撤销测试的 10 秒要求；负载与撤销时延须由远程 Actions 独立复核。

ssh2 的 SFTP status、异步 read stream error 与 command channel 派发结果在 Platform Adapter 转为具名技术失败；Model 只消费 `remoteStatus` / `not_started|failed|unknown` 等技术契约，不读取供应商 `cause.code` 或错误正文。原始 cause 仅作诊断。PTY 同样通过应用资源操作。公开出口不传 cause 或凭据。HTTP 使用 Shared 严格解码并逐字段投影。

Workspace复制失败message收窄为Shared RemoteFileErrorCode；归档失败为该有限码或WorkspaceArchiveErrorCode。内部任务对象保持独立，WS逐字段投影，归档警告仅投影verified_warning，缺失工具名按Shared有限取值投影，不输出原生命令、密码或技术诊断。Shared task-codec由正式前端严格消费；原Files执行、独立SSH/SFTP、资源准入与清理owner不变。

## 5. 入口与安装

### Fastify HTTP 运行时

1. **职责与范围**：Fastify 负责路由匹配、参数解码、有界 JSON 读取、序列化、错误处理和请求钩子；`platform/http` 保留受信来源、安全失败投影、HTTP/WS 资源跟踪与在线维护代次。删除自建 router、HttpRouteContext 与 JSON send/read 调度，不保留双轨。
2. **子功能与目录**：`http-bindings.ts` 构建完整 Fastify 实例并安装模块路由；`http-server.ts` 持有稳定 TCP listener 与 WS；`http-lifecycle.ts` 排空原任务；`http-request.ts` 保留 Host/Origin 安全规则及已解析 Cookie 的重复/容量拒绝策略，`http-body.ts` 消费原生 multipart parts，持有总字节/单 part 预算、取消与秘密清零，不整包缓冲或伪造请求。模块 interfaces 的 serializer/errorHandler 持有本域响应预算与安全错误投影。
3. **依赖方向**：模块 interfaces 直接使用 Fastify request/reply；register 与 Bootstrap 装配原生路由。Service/Model/Shared 不依赖 Fastify。业务认证、事务准入、取消和交付确认留实际模块 owner。
4. **类型与转换**：Platform 的 HttpRoute/HttpRequest/HttpReply 仅约定原生 Fastify 泛型；正文为 unknown，查询用 URLSearchParams 保留重复值，参数由框架解码后交 Shared/业务校验。原始流使用 request.raw/reply.raw，输入输出仍经模块白名单 mapper。AJV 不做类型强转、默认注入或额外字段删除；本轮不新增平行 schema。
5. **入口与安装**：路由使用 url/handler/bodyLimit；来源准入在 onRequest；随后 `@fastify/cookie` 解析一次，Platform 对 HTTP 和 WS 的解析结果统一拒绝重复 Cookie，原始值不做 URI 解码；关闭不属于原策略的默认项，避免引入 HSTS、frame 拒绝或跨域隔离变化。非认证域的应用写入同时在正文缓冲前验证完整会话，handler/事务继续复查原权限。未知路径和框架路径解析失败同样校验来源。JSON 保留严格 UTF-8、媒体类型和安全错误码；仅声明 `config.multipartBodyLimit` 的路由在独立 scope 安装 `@fastify/multipart`，该值约束含封装的总字节，`bodyLimit` 单独约束 JSON。二进制 rawBody 路由仍在独立 parser scope 将原始流交给业务入口读取。GET 不自动生成 HEAD，保留显式下载 HEAD。
6. **数据、事务与并发**：无数据库迁移。普通 JSON 在 handler 前解析，业务名额从应用准入时开始；未完整上传的导出 JSON 不占备份执行槽。multipart parts 在原应用作用域内读取，不自动写临时文件，备份密码等字段保留原始字节再严格解码。平台预检声明长度，parts 消费时计数实际 encoded 字节；超限/取消或提前拒绝未结束的请求会终止原流。应用 owner 保证权限、CAS 和事务。
7. **生命周期与失败**：路由 handler、callback/Promise hook 和响应传输分别跟踪；HTTP listener与框架binding共享原响应的同一完成Promise及监听，finish/close/aborted/原socket关闭后解除监听，避免重复登记；断连不表示任务完成。显式 send 等待原生 reply 完成，避免异步审计/序列化期间空响应。原生 serializer 在 preSerialization 后单次编码并检查 UTF-8 字节预算；失败交本域 errorHandler，写入后的序列化失败保留 operation_unknown，错误投影重置 serializer。仍需直接控制传输的业务流才 hijack。认证和远程资源同时核对真实 finish 与最终成功状态，错误响应完成不视为资源交付。全局安全兜底清除尚未交付的 Cookie 及实体头，避免失败流的 Content-Length/ETag 污染 JSON 错误。Operations 用单一请求状态记录原身份、响应身份与真实 handler Promise，在 onResponse 按最终状态发布审计，覆盖解析拒绝和响应钩子失败；审计故障由原 owner 保留，不改写已提交响应。恢复先停止准入、排空并安装新的 Fastify 实例，再原子替换；旧实例等待原恢复请求退出后关闭，不等待自身。WebSocket 保留独立授权、代次复查及完整会话任务跟踪。
8. **当前能力与验收**：七个模块已按上述入口迁移；OpenAPI/AsyncAPI 自动生成仍未实施。专项覆盖严格解析、异步回复、原始流、来源拒绝、回调提前回复、资源交付失败释放和恢复代次；实际执行证据归 testing，未验状态归 PLAN。

### Factors 安装与真实接口

`registerAccess({sqlite,secrets,passkeys})` 装配 Factors，`createApp.configuration` 首次初始化持久 Preferences 的 passkeys 站点列表，每项为 `{origin,rpId}`，后续启动从持久安装快照装配，独立入口从 `NEXUS_PUBLIC_ORIGIN` 推断并允许 `NEXUS_PASSKEY_RP_ID` 收窄。RP 必须与公开来源 hostname 一致或是其合法父域；非 localhost 的 HTTP Origin 禁止启用。

因素路由：`POST /api/v1/auth/login/2fa`、`POST /api/v1/auth/2fa/{setup,verify}`、`DELETE /api/v1/auth/2fa`、`POST /api/v1/auth/passkey/{registration-options,register,authentication-options,authenticate}`、`GET /api/v1/auth/user/passkeys`、`DELETE /api/v1/auth/user/passkeys/:credentialID`、`PUT /api/v1/auth/user/passkeys/:credentialID/name`。Auth HTTP 仅签 HttpOnly/SameSite/Lax 受控 cookie；FactorService 始终通过完整 SessionModel 验证管理权限。

### Access 安装与入口

`createApp` 先读取 Preferences 持久快照；`AppOptions.configuration` 是仅首次创建时调用的初始化工厂。独立 `main.ts` 提供 `NEXUS_IP_WHITELIST`（逗号/换行分隔 CIDR）、`NEXUS_IP_BLACKLIST_ENABLED`（默认 true）、`NEXUS_MAX_LOGIN_ATTEMPTS`（默认 5）、`NEXUS_LOGIN_BAN_SECONDS`（默认 300）、`NEXUS_CAPTCHA_ENABLED/PROVIDER/SITE_KEY/SECRET_KEY`（默认关闭）并在开放监听前检查值。实际 Access HTTP：`GET /api/v1/auth/{needs-setup,status,login/options}`、`POST /api/v1/auth/{setup,login,logout}`、`PUT /api/v1/auth/password`；认证的黑名单 `GET/DELETE /api/v1/settings/ip-blacklist`；其它 Targets/Remote/System 路由经全局完整来源准入，未知路径同样检查来源；仅状态、登出、登录及管理员黑名单恢复保留白名单级入场（后者须 Access Service 验证 userId=1）。CAPTCHA 成功绑定公共 Origin hostname；安装时从公共 Origin 推导，未绑定拒绝启用。Preferences 在 Access 注册前提供经过校验的版本化快照；保存与生效版本分开，IP/监控经唯一安装回调热更新，CAPTCHA/站点重启激活，不使用 Platform 注册槽。SourceAdmissionService 在封禁查询返回后复查当前白名单和黑名单启用策略，旧异步准入不能穿透已收紧的来源策略。

基础认证setup/login/password及TOTP二阶段登录路由显式引用Shared `ACCESS_AUTH_REQUEST_MAX_BYTES`，保持原16KiB传输预算；前端同一常量约束完整编码输入，不用字段长度替代路由预算。

### 监控入口

同一 `/ws/workspace` 安装 status.start/stop、docker.status/command/stats，事件 status.sample/error；HTTP 保留 `/api/v1/system/status`、`/ssh-resources` 与 `/ssh-resources/:connectionId`。Remote/register 装配观测能力，System/register 安装本机能力；Bootstrap 仅调用模块安装入口。观测空请求codec归Shared monitoring，Docker仅消费自己的命令/统计codec，HTTP/WS仍在原协议边界白名单投影；正式前端WS与Dashboard概览HTTP已接Shared，配置消费者也已接入，不改变Remote各自授权政策。

### 安装设计

`registerRemote` 只安装一个 `/ws/workspace`，接入 `workspace.connect/resume/ping/close`、`terminal.input/resize/flow/currentDirectory/changeDirectory`、`suspend.mark/prepare/commit/unmark/list/resume/owner.renew/history.previous/history.reset/terminate/remove/rename`，保留 Files/transfer 实际协议；另安装 `/api/v1/ssh-suspend` 的列表、终止、移除断线条目、重命名、日志导出。旧 PTY HTTP/WS 仍在独立消费者范围内运行；不得因新入口存在就宣称旧接口等价。管理和 WS 共用 sessions 的权限、结果与资源 owner。

main 读取环境和启动；Bootstrap 安装实例与全库迁移；模块 register 组装内部 Model/Service/Adapter，并返回消费者需要的能力、HTTP/WS 安装及 quiesce/close。Bootstrap 不逐个构造所有业务 Repository，也不引用私有配置类型。

WebSocket来源准入包装显式保留route的文本/二进制入站预算和文本发送缓存预算。Workspace目录列表使用Shared的8MiB发送预算，其它路由继续使用各自声明或默认值；HTTP bindings在安装时核对三类容量均为合法整数且不超技术帧上限。入站控制限制与出站列表预算分别执行，不用默认发送缓存误拒绝合法列表。

Targets 导入仅公开 importMany；单项使用一元素集合，每项仍有独立事务与安全结果。importOne 保留为模块内部实现，不因测试方便扩大出口。管理类型为区分模块保留 Shared 别名，不复制字段定义。

待实施：模块 interfaces 将 Shared 协议 schema 绑定到真实 HTTP 路由，Platform 提供通用元数据契约，Bootstrap 汇总已安装路由生成 OpenAPI；WS 契约另行汇总。当前 HttpRoute 尚无完整 schema 关联，此设计不能写成已完成。

Platform HTTP 已支持 HEAD、流响应和按路由 opt-in 的 binary 入站，队列/背压属于技术层。票据、Workspace/任务、目标授权与业务预算归 Remote；Platform 不注册业务资源。统一 Files 应用绑定由 FileService 持有，Interface 不作为 Service 的资源查询来源。

Access 取得可信会话身份；Targets 管理出口只给非敏感对象，可信 SSH 解析为独立后端能力；Remote 普通资源绑定登录会话；UUID 和目标选择不替代授权。模块内部 HTTP 可调用本模块明确 Service，跨模块仍走 public。

Remote 会话 HTTP 仅负责协议解码和失败投影，入场身份查询与管理员授权统一由 RemoteSessionOwner 执行。读取/关闭对未认证或无权限身份抛具名失败，认证通过但资源不属于该会话时返回未找到；建连完成后再次核对权威身份，WebSocket 访问/输出也继续复查。入场去重不删除异步期间会话撤销保护。

Remote 同时安装 `/ws/workspace` 的旧 Files 子协议适配层。Interface 持有旧 envelope、requestId/in-flight、binary read owner、NXW1 发送、cancel 和 ready/error；旧 WorkspaceEventHub/Protocol 复查确认没有独立 Files mutation change event，因此适配层不虚构 `filesystem.changed` 一类消息。Files Service 持有路径/编码/操作政策；Model/Platform 不知道旧 Workspace DTO。R1 恢复 fresh `workspace.connect`、`workspace.ping` 与 Files 消息；完整 `workspace.resume`、Terminal/suspend 已有 源码，status/docker 已有 源码，行为统一待专项验收（见 PLAN）。下载/上传/传输/归档的 源码已收口，行为覆盖见 testing。独立 `/api/v1/remote/files` HTTP能力保留，原手动调试页面已移除；正式页面使用Workspace文件能力，各协议接口仍核对真实身份与资源归属，不增加旧协议兼容包装。

## 6. 数据、事务与并发

### 因素存储与挑战原子性

第一版初始化在 `access_accounts` 定义 `totp_secret_encrypted`，创建 `access_pending_logins`、`access_factor_challenges`、`access_passkeys`。待登录只保存 digest、用户、密码修订、rememberMe 与五分钟到期，同一浏览器旧 partial 按摘要同事务替换，最大 64 在事务中准入；挑战只保存 digest、kind、用户/完整会话摘要、加密的暂存 TOTP secret 或 WebAuthn challenge、RP/Origin 与到期，最多 1024。保存新 challenge 会删除旧 cookie 对应项，完整会话下同类 challenge 被替换。注册只有在原 challenge 未过期、同一账号完整 session 仍有效、credential ID 未占用时入库。认证在存储事务内复验 challenge、账户/credential 所属、counter 变化、来源封禁，并同事务消耗 challenge、更新计数、签发完整 session；零 counter 遵循旧技术契约，非零 counter 必须递增。TOTP 激活在 session 与 challenge 上 CAS，禁用在密码旧 hash、session 和当前加密 secret 上 CAS；禁用后删除该账户 pending/challenge。

Access 改密由 Service 一次入场认证、AccountModel 转 token digest，SQLite 在修改同一事务复核原 session 仍存在且未到期、旧 password hash 未变，再撤销账号全部会话；计算密码期间撤销或过期阻止写入。登录签发 Storage 与 Model 各自持有具名结果，明确 issued、credentials_changed、rate_limited、cancelled，避免并发封禁被降为错误密码。accounts/sessions Model 使用共用 access-storage-boundary 转技术失败，公开 accessBoundary 只消费应用失败并投影安全码。该 helper 只用于 Model 的技术错误转换，不是新的 Service 或公开能力。

### Access 持久权威与竞态

AccessService.setupAdmin 在输入校验后、scrypt 哈希前读取 AccountModel.needsSetup；已有管理员直接按原 already_initialized 拒绝，不继续昂贵计算。该预检查只减少重复初始化请求的资源消耗，不是创建授权或并发保证；createInitialAdmin 的 SQLite 原子创建仍是最终权威，两个空库请求同时通过预检查时最多一项提交。密码格式、HTTP 409、安全失败与正式初始化 UI 不变。

Access 登录失败记录的 `last_attempt_at` 及其索引由所属 Adapter 定义，业务读取不补历史字段。

`access_accounts` 对管理员初始化使用同一 SQLite 事务的空库检查/唯一写入；改密以旧 hash CAS 更新并同事务删除用户全部 `access_sessions`。`access_sessions` 只保存 256-bit 随机 bearer 的 SHA-256 摘要、账号凭据修订、remember 标志与 30 天到期；状态每次验证从存储重新查，撤销即失效，不复制到 Platform。`access_login_attempts` 按规范化公网 IP 保存次数、窗口起点、封禁至与最后失败时间。普通会话及各模块的原事务身份读取在查询完成后取当前时钟核对期限，不使用入场时刻；账户行由 accounts Adapter 唯一解码，会话复用，不把损坏账户/到期字段当正常未登录并静默修复。失败计数的读改写在存储事务内使用应用规则回调，窗口/封禁和持久时间取同一次当前时钟；成功登录在创建会话事务里复核账号密码/因素及当时封禁、检查取消意图，然后原子新增 token 摘要并清除失败记录；不预先撤销旧浏览器会话：HTTP Cookie 交付无法与 SQLite 提交原子绑定，断连时旧 Cookie 必须仍可使用。若事务已提交、响应尚未交付，则尝试撤销新 token；确认不了撤销/提交时保持 `operation_unknown`，不声称自动回滚。每 5 分钟至多执行一次后台数据库惰性 sweep，删除过期会话与封禁已结束且最后失败超过 7 天的记录，不提前清活跃封禁。名单列表/解除的管理员准入由 AccessService 提供纯同步判断，SessionModel 将 token 转摘要、独立存储 SessionRecord 转 SessionIdentity；SessionTransactionAdmission 只用存储类型。SQLite 在同一真实事务开始及完成前复查当前原会话，身份失效回滚解除或拒绝交付；HTTP 不额外先查一次身份。名单解除是独立删除；登录先检允许入场，验证码网络 await 后、会话提交前复检封禁。单 SQLite v1 已包含 Preferences 配置表；持久配置由 Preferences 拥有，Access 只消费安装快照。

### 监控并发与缓存

无新增业务持久化，不创建空 storage。缓存仍为本进程状态；Workspace 操作绑定具体 attachment、配置 fingerprint 与原 owner；后台主机缓存当前仅供 userId=1，按 host/port 及完整可信配置指纹隔离，同配置且同登录的在途采样才共享，不同会话单独拥有采样；仅成功结果跨登录进入缓存，失败下次读取可重新采样；TTL 从采样完成计算。删除/改配置及 reset 后旧任务不可回填。首次初始化默认状态间隔 3 秒、后台 TTL 30 秒；Preferences 保存确认后热更新状态周期与后台 TTL，独立 Service 的技术安装默认不覆盖持久设置。Docker 按规范化文本 endpoint 与全部受管突变互斥，覆盖容器名称与短/完整 ID 别名；unknown/清理失败保持持久 blocked，重启不解除，恢复能力已由机器突变恢复专题接线，行为覆盖见 testing。

Dashboard的ResourceStatusService与SystemStatusService不设全局4请求准入上限。前者复用上述主机缓存、保留单请求2主机并行与120秒等待，每次交付前复核会话及当前配置；模块自己的取消signal允许多个等待监听，退出时仍逐请求退订。后者由原Service共享一次本机采样，成功结果完成后缓存3秒，失败不缓存，逐请求在取缓存/采样前后验证管理员会话，等待最多10秒。超时只结束调用方等待，真实采样仍登记到原tasks并参与停机排空；quiesce清除缓存且晚结果不可回填。Shared、HTTP白名单映射、前端、协议容量及独立诊断入口政策不变。本机 Node Adapter 与 POSIX SSH Adapter 的根磁盘百分比统一消费 `platform/system/disk-percent.ts`，以有限非负的已用/总容量计算并限制到 0–100；`df` Capacity 只作为技术输出，不参与应用事实。

归档在 Files Service 的首次私有文件写入前，通过 FileArchiveModel.prepare → NativeArchiveCommands.requireTool 执行独立只读工具查找；Model 仅在该边界将丢失的查找回执转换为尚未派发归档写入，清理失败仍独立传播。原生写入仍执行自身工具检查，预检不是后续执行的永久保证；写入取消不能借用此只读分类。

### 权威状态与竞态

活跃 SSH/PTY、attachment/generation、lease、ACK 等由进程内唯一 Workspace Service 状态机权威持有，重启不持久化技术句柄。64 个普通 Workspace 名额在首次异步身份/目标解析前原子预留，覆盖排队、opening、attached/detached、closing 和未确认清理；重复 ID 不能抢占或重复计数。挂起目录另按用户 32/进程 64 限额与 24h 生存期，重附着同一 Workspace 不再占第二槽。每次 await/WS delivery/ACK 都复查记录实例与 generation；过期/旧 attachment 不能归还新实例或恢复旧 input。技术日志在私有本机临时目录，可重启清理，无持久活跃 shell。文件记录若无需 SQL 则不创建数据库层；任何未来持久变更仍经 Model/Storage/Adapter 执行。

Bootstrap 持有 applicationMigrations 的顺序和版本，版本 marker 与 DDL 同事务提交。

后续迁移交付见 [数据库迁移](../DEPLOYMENT.md#数据库迁移)。复用现有 `SchemaMigration`、`initializeSchema` 与 `schema_version`，从当前 v1 基线为每条数据库变更追加连续版本、固定签名及独立执行记录；dev 与 latest 使用同一迁移链，不归并或重写已执行版本。SQL 仍在所属 Adapter，JSON/数值/单位等复杂转换由迁移脚本编排并通过 Adapter 写入，业务运行路径不承担旧值兼容。重复启动按版本记录跳过已应用迁移，执行与版本标记同事务提交；v1 升级至 v3、重复启动与失败回滚的证据见 testing。

每次迁移应用后、记录版本前，SQLite schema Adapter 在同一事务核对外键 enforcement 仍开启，并执行真实 `foreign_key_check`。发现违规即回滚，不写成功版本。重建父表可能使 SQLite 保留已失效的延迟检查计数；只有最终外键全部有效且本事务启用了 deferral 时，才关闭 deferral 清除该计数。该步骤不关闭外键约束、不更改历史迁移 SQL 或签名，也不改变普通事务的提交和未知结果语义。

Platform 的 SQL Executor 契约在 `storage/sqlite/sql-types.ts`；版本表 Adapter、事务控制 Adapter 和 Worker 在 adapters。Runtime 持有队列、隔离和失败语义：回调失败回滚，rollback_failed/commit_unknown 保留因果并使实例不可用；未知提交不自动重试。Worker 严格验证完整消息，损坏/不可关联结果使待完成调用全部拒绝。只读 diagnostics 消息只采样自身 isolate 的内存并白名单回传，不执行 SQL、不插入 Runtime 事务队列；Runtime 合并相同采样，关闭停止新采样，已派发消息先于 close 按 Worker 消息顺序收敛。队列计数在准入时增加，实际任务 finally 时归还。

业务多表写入和引用/CAS/幂等校验归存储 Adapter 的真实事务。需要当前状态的业务规则采用明确同步回调：Adapter 在事务内读存储事实 → Model 白名单转换为应用事实 → 纯规则判断 → Model 转回存储结果 → Adapter 写入/提交；回调不执行网络、异步任务或开启嵌套事务。Adapter 只依赖 storage 中的回调契约，不导入应用类型、规则实现或业务策略配置；禁止先在 Service 读旧状态、判断后另开事务写入。

Files mutation 不新增数据库或 SQL。单个文件资源由 Service 串行执行操作，但远端 SFTP 预检与后续 mutation 之间仍存在服务器侧竞争窗口；`expectedSha256` 的两次复查只提供尽力冲突检测，不是事务/CAS。目录项 rename 的目标不存在预检同样不是原子 no-overwrite 保证。

Access 的失败窗口/封禁计算在 sessions/login-failure-rules，Adapter 只读取、解码计数并原子写回。Targets 的 connections/ssh-graph-rules 根据同事务图快照覆盖拟修改边，再校验成环、深度、展开数量及受影响祖先；Adapter 读图及写关系，Model 持有回调转换，register 同时装配普通写入与导入/克隆路径。Targets 可信解析在同一 SQL 快照读取目标、凭据与路由，Model 计算指纹并在解密前核对 expectedFingerprint；先读指纹后重新解析不能替代同快照检查。指纹不替代 Host Key 信任，也不证明后续配置永不变化。

## 7. 生命周期与失败

Remote Files 的 upload.prepare 在单一原机器突变claim内先准备根目录，再按根下第一段分组；最多4个worker处理互不重叠的分支，同一分支按路径长度串行。每次创建仍由ensureRemoteDirectory检查完整父链，不缓存stat作后续授权。首个失败停止未派发路径，所有在途worker排空后才结算；混合失败保留全部cause、清理失败类别和unknown，部分创建失败仍保留原保守围栏。allowlist只包含请求路径及根，不把隐式父目录加入可上传范围。

重启通过同一 SQLite owner 收敛，不重新执行。审批内部期限/消费时间为 Unix 秒，工具账本时间为毫秒；消费从同一个事务内时钟样本投影两种表示，不能把截断的秒直接作为毫秒更新时间。

### Factors 安全失败与清理

TOTP 使用随机 20-byte 秘钥的 Base32/HMAC-SHA1 6 位 RFC6238、30 秒步进前后各一窗，向用户展示 otpauth QR；仅在加密 `SecretBox` 生效时允许初始化，密钥以账户绑定 AAD 存 SQLite，失败拒绝而非明文降级。WebAuthn 由本地 `@simplewebauthn/server` 验证签名、challenge、公开 Origin、RP ID 与 user verification，认证 counter 用 SQLite CAS，不能信任客户端自报结果。多个并发完成只能消费同一 token 一次，重试未知结果先重新获取权威会话。完成登录前检查来源黑名单，错误因素验证码累计来源失败。Logout 同时撤销完整/部分 bearer 和设置/Passkey challenge；过期与替换 challenge 不成为资源授权。已经派发的数据库事务不因断连而假定回滚；WebAuthn 浏览器交付的覆盖范围见测试入口及 PLAN。

### Access 生命周期

账号不存在时仍执行无账号的耗时密码校验以缩小用户枚举时差；密码错误与 CAPTCHA 拒绝只记有权限的公网失败计数，强制 Passkey 的账号拒绝密码路径（`factor_unavailable`），TOTP 账号转部分认证而不签发完整会话。CAPTCHA 网络 Adapter 单次 POST、不自动重试、十秒截止、16 KiB 响应预算；配置无效在安装时拒绝，网络/非预期响应是安全 `captcha_unavailable`，供应商明确 `success:false` 是 `captcha_invalid`；成功时还必须匹配配置的公开 Origin hostname，Google 仅支持 v2 checkbox、不接受 v3 action/score，非 2xx 响应体取消，不能固定成功。请求断连传播 AbortSignal，已开始的 SQLite 事务不凭取消推断回滚。失败计数/签发是独立事务，供应商失败不影响既有会话。改密和登出持久撤销立即阻断下一次身份复查，但不能撤回已经发出的远端副作用；HTTP 与各独立模块关闭并发收尾，SQLite 在二者实际结束后关闭；失败聚合，不把定时等待终结当资源释放。

### 监控生命周期

临时命令任务有全局准入和整项期限，取消不提前释放；Workspace detach/close 和观察 owner shutdown 取消关联任务并等待真实收敛。Model 关闭临时 SSH，不修改最近连接时间，不在 PTY 注入采集命令。Docker 非零退出是确定失败，已派发但无退出证据为 operation_unknown，清理失败保持具名类别并占用名额；不自动重放。订阅取消使旧结果失效，慢采样不重叠，资源缓存不交付已失效身份/配置。

### 生命周期设计

Workspace WS 的输出暂停/恢复同时绑定 workspaceId 与 attachmentId，由 WorkspaceService 核对当前 attached owner；旧 socket 的流控回调不能改变后继附件的 pauseByConsumer。释放只调用带身份检查的 detach，由其统一核对录制队列和关闭状态再恢复底层输出，不另行解除背压。

连接按 reserve → 身份/可信目标 → SSH open → shell open → FileAttachment → 认证复查 → 绑定 WS/交付 → ACK/运行推进；异步拒绝或取消后晚到 shell 和 Files 仍由其原 owner 追踪关闭，确认清理前不释放预留。异常 WS 断线只解除当前 generation，默认保留约 120 秒再终止；主动关闭先失效附着，终止 shell 及相关 Files/transfer。标记/prepare/commit 挂起应完整记录日志/checkpoint、先暂停后移交再恢复消费，部分副作用未确认的结果保留 `operation_unknown`。接管先撤旧 generation，再有界交付历史/状态与明确恢复 ACK；未 ACK 不能宣称恢复完成，原 owner 在 rollback/lease expiry 继续跟踪资源。日志导出按Shared限制渲染后UTF-8实际交付不超过128MiB，流中超限终止交付且仍释放原source；该预算不同于原始历史窗口。管理HTTP按Shared严格解码输入/目录输出，输出投影无效映射remote_unavailable而非用户输入错误。历史 100 MiB 最大保留、初始约 256 KiB、翻页约 256 KiB、checkpoint 4 MiB，流读取/完整编码/客户端背压单独设限，先做输入预检、再对读到的实际字节检查；不声称快照或磁盘硬配额。同步抛错、异步拒绝、清理多个失败经具名错误与 AggregateError 收敛，同一失败只登记一次。远端失控/断网后不主动重放命令与 unknown 变更；D12/D13 的原生工具与非原子窗口取舍不变。

资源有唯一 owner；准入、半开、活跃和关闭任务追踪至真实收敛。等待超时不归还仍被资源占用的名额；晚成功关闭，晚拒绝中的清理失败进入有界诊断及停机汇总。`RemoteResourceCleanupFailure` 区分清理完整性失败与普通授权/建连拒绝。

外部操作和按 ID 释放继续认证；已获资源的内部 owner 使用绑定该实例的窄关闭能力，撤销会话、取消或断开后仍能完成清理，不重新认证后才关闭，不增加任意 ID 的无认证释放入口。关闭能力不进入 Shared/HTTP，关闭 Promise 与失败仍归原资源 owner。

二进制读取的允许类型、容量和初始范围由 Service 确定，Model/Platform 按明确字节范围读取；空文件不创建无界流，短读不能伪报完整成功，后续追加不扩张本次范围。范围确定不等于内容快照；失败、提前终止和消费者断开都须收敛底层读取。

R2 后，Files Service 的 `runAdmitted` 统一限定二进制数据及 final 帧发送期限，Service 将同一有效 signal/剩余期限交给 Interface 的 NXW1/backpressure 发送循环；Interface 不再独立无限等待。应用交付联合类型 `FileBinaryPiece`/回调归 Files Model 类型 owner，Interface 仅投影具体帧。Workspace `ping` 调用 Service 核对登录身份、配置指纹、资源权威状态及 Workspace ID 并续期；失效绑定不继续发布成功。Files Service 不按Workspace attachment或独立HTTP Files数量拒绝创建；opening/closing、晚到清理与无法确认的关闭继续追踪至实际完成，不因移除准入门槛而丢弃资源。

R2 二次审核：Workspace `connect` 的 Targets `get` 不再由 Interface 在容量/期限之外等待，Files Service 在第一次 await 前预留 workspaceId 和 64 槽，将身份/Targets 查找/SSH open 置于同一个可中断的建连期限；返回 `WorkspaceFileAttachment.connectionName` 的应用事实，WS Interface 仅投影。关闭期间底层 SSH cleanup 可能无界，不能以强制短路伪称已清理；WS 心跳和断开先失效绑定、交还确定失败，Service 对迟到资源、关闭 Promise 和清理错误持续负责，**只有确认释放成功才归还名额**。测试夹具的 Service 构造调用已同步注入 Targets public 查询；慢查、竞态与失败清理的精确验收范围见 testing；受控 Service 队列、晚构造及64预约证据不替代真实传输故障。

关闭先保存共享 Promise，再执行可能重入的清理；取消订阅也属于可能失败的清理步骤，一项失败仍继续其余退订、资源关闭和终态通知，保留全部因果并聚合。停机停止新准入、关闭 HTTP/WS 并等待已接纳任务、取消并 drain 模块资源，最后关闭 SQLite。

PTY 协议 owner 管 ACK/背压/EOF；Files Service 管身份/指纹复查、准入/期限和文件业务流程，Files Model 管 SFTP lease、byte source、metadata 转换与 staged temp/commit。新建文件使用标准 SFTP rename，不调用可覆盖目标的 POSIX replace；覆盖已有文件才使用 replace。`ssh2` POSIX rename 扩展仅在协商声明可用时调用；无声明视为本地尚未派发，使用有备份恢复的标准 rename 路径；已派发操作仅明确 unsupported 可回退，超时、远端未知与备份清理失败保留 unknown，不冒充已提交成功。此协商修正仍待第五轮后续远程 E2E 复验。实际 SFTP 目录扫描以 opendir/readdir(handle)/close 收敛，文件读取经 Adapter `readChunks` 将异步 ssh2 error 归一后再交 Model。

下载HTTP Interface保留GET/HEAD、单段/suffix Range、inline和目录ZIP；票据POST显式使用Shared 32KiB预算，JSON/容量等HttpInputFailure交还Platform，不包装成500。安全失败由Shared有限message/code契约约束，真实状态码保持对应。HTTP sink只保留最后1字节，源迭代与最后授权复查后随response.end交付，避免Content-Length已满足但应用还在等待时代理提前断开并退役健康Files资源；空文件不生成额外字节。票据300秒TTL的协议值与Service实际期限同源，活跃流/原实例/IP/会话绑定政策仍归Files owner。服务端finish仍不证明浏览器保存成功。

源码已包含独立 HTTP 文件下载 ticket/GET/HEAD/目录 ZIP 和 binary 上传 WS。Platform HTTP 提供通用 HEAD 与 opt-in binary ingress（其余 PTY/Workspace 控制消息仍拒绝原始字节），Platform SFTP 按明确 byte offset/end 读取及技术流期限；不会接收 Workspace、票据或 Task 业务类型。Files Model 对外提供 byte source 和临时写流 staged append/commit/discard；HTTP Interface 解码 Range 语法/状态码，FileService 负责应用范围政策、票据、上传冲突、目录 allowlist、原有 Workspace owner/身份与指纹、任务准入与长流确认。ZIP 目录遍历政策由 Service file-directory-zip 持有，条目/字节经 file-zip-model 转给技术 ZIP Adapter，库/reader/producer 的收尾归 Adapter；file-copy 则完成文件/目录 SFTP copy/move 技术流程，Interface 单向投影状态和 metadata，不在 Platform 放文件业务政策。

Workspace copy/move 使用独立的 SFTP 源/目标技术资源；未知副作用不自动重放。旧上传传输层异步触发 append，但其 Service 本来有串行队列；新 binary WS 在技术接收层额外显式串行并受背压/字节上限控制。旧目录 ZIP 遍历与短期下载票据活跃流过期等隐患均增加有界 owner 处理。跨不同登录 token 的同用户 Workspace 源资源改经 Access authenticateDigest 校验原会话有效性及当前请求者身份；原 bearer 不保留。Model 的 SFTP readlink/symlink 支撑保留链接本体，目录复制后显式恢复 mode，旧隐式跟随 symlink 的行为不照搬。

archive 由 Service 决定输入/成员安全/任务/取消与发布；file-archive-model 将应用参数/结果和错误显式转换，Platform archive native Adapter 持有 shell 命令、原生列表及退出码解码；FileResource 管 SSH/SFTP 技术资源：压缩通过原生 `zip`、GNU `tar` 直接在远端写带格式后缀的私有 `.part`，由 SFTP 确认后 rename/replace；支持归档输出位于所选源目录内部，不做源树预扫描，直接将所选路径交给原生工具递归处理，不设置压缩总条目数或目录深度上限，命令明确排除旧目标和临时项。ZIP 复用原生 `-dc` 已有扫描统计，Native Adapter 仅输出数值进度，ArchiveModel 显式映射可选总条目数，Service 按条目数计算百分比并在产物发布确认前保留 100% 终态；不新增源树扫描，单个大文件没有连续字节进度。解压先用远端原生 `cp --reflink=auto --no-dereference` 建立权限受限的私有归档快照并经 SFTP 核验文件类型/大小，`unzip`/`zipinfo` 或 GNU `tar` 对该快照分别列出简略成员名与详细成员元数据并逐项交叉检查名称/类型/大小（忽略GNU tar顶层 `./` 元数据条目），实际提取使用同一份快照，按规范化路径、非目录祖先、重复名称、特殊成员、安全整数大小，不按成员数量、深度或固定64GiB展开量拒绝，GNU tar 使用 `--no-overwrite-dir` 防止根条目改写私有 stage 权限，先提取至私有 stage，再由 SFTP 复核每一项的真实类型、实际文件大小及 setuid/setgid 权限位，并预检查目标路径类型冲突后发布；原生提取显式排除 symlink/hardlink，只提取普通文件和目录；应用校验通过后，符号链接经 FileResource/SFTP 创建，TAR 硬链接由 ArchiveModel → native Adapter 的 `ln -P` 创建，避免提取中沿归档链接写入；设备/特权成员仍在提取前拒绝。源可能并发变化，预检不等于文件快照；保留 unknown 退役、取消与进度边界。密码执行器按实施方案 D12 保留原生 zip/unzip `-P`：密码经 POSIX shell quote 直接拼入原生命令参数，与旧正式实现一致；接受 SSH command string 和工具 argv 中包含密码，不额外导出密码环境变量，不记录完整命令或回传诊断。无需新增归档 PTY、Python 或 Expect；现有 Model 转换不变。核对密码/失败/秘密日志行为；不承诺 AES 兼容。

SFTP 单次元数据请求的技术上限唯一归 Platform SSH 契约，FileResource Model 将应用剩余期限限制到该上限；上传字节流仍使用完整传输期限，不把总任务预算当作单次 RPC 预算。同目标移动在目标不存在时优先 rename；已有普通文件或目录走既有 staged copy/merge，全部复制确认后再删除来源，类型冲突仍拒绝。

归档纯政策归 `files/file-archive-rules.ts`：成员名称/结构/预算、符号链接逐段目标及硬链接引用完整性只消费应用事实，不访问资源。归档内部 `FileArchiveEntry`、链接计划和提取计划归 `files/model/file-task-types.ts`，不放 Shared；Service 编排快照、提取、链接物化、发布与恢复。Model 对提取计划及成员 kind/linkTarget 显式白名单转换；native Adapter 解码 GNU tar 的 `->`/`link to` 与 ZIP 链接载荷，处理 Info-ZIP 的字面量 pattern 和原生排除参数；压缩时临时输出/旧目标的 ZIP 排除项同样逐项转义，shell 引号不替代工具 pattern 转义。ZIP 链接载荷按 4096-byte 预算、严格 UTF-8、具名密码失败和真实结束 marker 解码，不给 Service 原始 CLI 输出。硬链接保留真实 inode 关联，不自动退化为复制。

Remote 协议入口按通道归 `interfaces/http` 与 `interfaces/ws`；PTY、Workspace Files 和 upload binary 都归 ws，业务语境留文件名。目录迁移同步 register 和后端 fixture，URL、Shared 协议及授权 owner 不变；没有旧路径转导出。

Native Adapter 的列表输出按 names/modes 顺序分段，每段 od 独立检查退出状态；只有完整两段之后才输出完成标记，不依赖 POSIX 管道的最后一步掩盖前一步失败。列表工具写入前设置单文件大小限制，后端每段 8 MiB 解码预算仍保留；限额及工具语法是技术策略，不进入 Shared。该单文件限额不提供解压总配额。命令 stdin finished 监听在 Model 完成/取消后清理，stderr 与 channel 继续由原 finally 收尾。

Native Adapter 将原始工具退出码归一为 NativeArchiveOperationOutcome；Model 只消费 missing_tool/limit_exceeded/password_required/invalid_password/rejected 技术事实，再显式投影应用失败。压缩 writerExited 来自工具返回后的独立 marker，容量超限继续 drain，未确认 writer 退出不能清理或通过 ZIP warning 发布。ZIP/TAR 成员的 mode 在技术 parser 解码，DOS ZIP 没有 POSIX 元数据时为 null；Service 拒绝特权成员，记录 native stage 的 mtime，并在发布后由深至浅恢复明确成员的普通 mode/mtime，stat 确认整项结果。未显式声明的既有 implicit directory 不重写属性。发布及恢复前检查根规范路径与父目录 lstat/realpath；这是有界复查，不能替代 fd/nofollow 原子能力。安全链接有源码实现、实机待验，设备/特权成员的 UNSUPPORTED_ENTRY 与前端消费延后项在 Shared/实施方案对应 owner 维护。

mutation 技术结果区分 `not_started / failed / unknown`；远端 command channel 建立也使用同样派发分类。已派发后取消、deadline 或连接终止不证明远端回滚，unknown 资源退役且不自动重试。写入已生效后的读取或结果校验失败同样保持未知结果，不能按普通未写入失败处理。确定失败尽力清理临时项；unknown 时不继续发可能与晚到 mutation 竞争的清理命令，因此真实服务器可能残留私有 temp/backup，必须核对。整体停机有界、原子 nofollow、原子 CAS 和文件快照不能凭接口宣称。

远端能力按实施方案 D13 保持现有 SSH/SFTP 和原生工具要求，不部署新增 helper 或特权/文件系统配额。路径检查与发布间的同权限并发替换窗口、解压期间无总磁盘硬配额均为明确接受的能力限制；不另设固定展开体积拒绝门槛。保留私有 snapshot/stage、成员拒绝、逐项复查、结果确认及清理失败追踪，不将这些机制描述为强隔离或实时磁盘限额。

原 Python 版 `dir_fd`/`O_NOFOLLOW` 解压审查为历史记录，不构成原生 CLI 安全保证。当前原生工具排除全部归档内链接，安全相对 symlink 和指向归档普通文件的 TAR hardlink 在独立步骤恢复；device/特权节点和危险链接拒绝；通过私有 staging + SFTP 类型检查限制已知攻击面，但最终目标目录替换仍存在竞态；取消或断线后只在能确认远端命令结束时尝试清理 staging，不能宣称所有资源已原子清理。原生命令退出 marker/进度解析、POSIX/DOS 属性、ZIP 加密及目录合并需 验证。旧正式实现本来不支持 AES；Python 迁移中间方案不是旧功能基线。Model SSH stdout 按行白名单解析，stderr 独立 drain 且不回显。Service upload/copy/move/archive 仍统一阻止活跃 taskId 冲突、复查异步身份与任务实例。

Files Service 区分直接借用 Workspace 与独立传输：direct 操作取消沿原资源退役，dedicated_transfer 只收尾独立 SSH/SFTP，健康 Workspace 续闲置期限；显式关闭仍中止全部关联任务。压缩范围准备与取得声明后的元数据复查同样使用独立传输 SSH/SFTP，不把任务取消信号传给工作区共享文件句柄；每次短读取的资源由原归档任务持有并在返回前关闭，清理失败继续保留原任务及配额。任务清理契约唯一归 Files Model，finished/cleanupFailure 实际状态由 Service 的任务 owner 持有，打开阶段、任务正文临时项清理与关闭阶段的具名清理失败均追踪并保留任务标识及配额；copy/归档整项 unknown 转换不抹除清理失败类别，Workspace 关闭尽力完成其余清理再聚合失败，不提前归还预约。prepare 在串行准入内计数，登记前复查取消及具体 owner；start 始终重新检查真实父目录，部分 mkdir 后失败保留 unknown。派生路径按 Shared 传输预算检查，不将该预算施加到旧 Workspace 基础路径。WS callback 绑定具体 attachment，接口只投影安全 operation_unknown，不暴露 cleanup cause。

file-copy 由 Service 在首次副作用前预检整批目标与源的重叠。同 target/fingerprint 或实际受信服务器密钥相同的连接，用源父目录 realpath 保留叶节点链接语义，目标的缺失后缀基于现有祖先解析，不为预检创建目录；检测相等/祖先/后代及规范位置的嵌套源。仅原连接的原始同路径 move 仍 no-op，跨连接重叠明确拒绝；别名解析与 metadata 只是变化检测，不是远端原子隔离。move 删除目录后的复查豁免自身删除引起的 mtime/size 变化，但 mode 仍须一致。ZIP 技术 Adapter 在 append 同步拒绝时同样停止并等待 reader finished，保证其拒绝被观察且原 producer/consumer 因果保留。

file-copy中转按256 KiB聚合，最多4个单stage窗口append在途；单append在首次等待前已按源顺序排入ssh2 writev，滚动补位维持约1 MiB写入预算，失败/取消后排空全部已派发确认再清理。Stage复用调用方保持不变的字节视图直到确认，避免额外Buffer复制；源端32×32 KiB预取在yield前补位。upload协议帧仍最多1 MiB，Service内部按512 KiB批次写入，每批开始前检查discarding；取消不abort独立lease，只停止后续批次，当前批次确认后由原worker清理stage，不将部分帧计为完整progress。

压缩源递归归原生 ZIP/TAR 工具，不在 Files Service 或 SFTP 重复遍历；删除源树计数/深度预算、特殊节点清单及其 `FileArchiveSources` 类型。Native Adapter 的条目输出仅转换成展示进度，不作为源树完整性的证明；随机原生命令结束标记与进程退出结果负责完成判定，Service 确认临时产物后发布，非零无密码 ZIP 仍须独立 `zip -T` 核验才可返回 `verified_warning`。特殊节点遵循工具行为：ZIP 跳过 FIFO/socket，GNU tar 保留 FIFO 元数据并忽略 socket；解压仍独立拒绝特殊成员。原生命令已退出、尚未尝试发布且私有输出已删除/确认不存在时，具名 `FileArchiveDiscarded` 表示确定失败，沿既有 RemoteFileFailure 分类结算机器突变名额并发送普通失败；专属资源关闭失败仍覆盖为清理未知，已经尝试rename/replace或原始未知错误不降级。错误不公开原始工具输出或远端路径。

Files Service 不以prepare/upload/copy-move/archive任务数量拒绝操作；同步登记后交给原写入队列，同组16项只作为调度窗口，超出者排队。清理失败任务和未确认资源继续追踪，已完成allowlist按有效期清理；目录准备不设置单批/累计目录数量门槛。FileArchiveModel 将 NativeArchiveFailure.cleanup_failed 显式转换为模块具名清理失败，不以普通 unknown 抹除生命周期事实。

Files 操作在准入后、串行排队前登记 active/inFlight，关闭和 quiesce 覆盖排队与执行，追踪到 finally 退订和解锁完成。尚未执行的排队请求取消不退役健康 Workspace，也不提前解除前序门禁；入场认证等待归既有 authorizing owner。跨 Workspace copy/move 的私有任务记录双端归属，任一端关闭取消任务，双端关闭都汇总关联清理失败；控制协议、任务 ID 和授权仍归原目标端。上传任务用独立discarding状态区分清理已开始与最终块已接纳：取消/断流先停止接纳，原worker排空WRITE、关闭并删除stage，重复取消等待同一settlement，字节通道关闭不再次中断租约。首次断流仍为unknown；提交后的取消与真实清理失败不因该状态放宽。

Files 内部 FileDownloadSink<TPlan> 由 files/model/file-types 唯一定义，表达 plan/write/finish 应用能力。HTTP 构造 sink 并持有 response/drain/finished；Service 将 finish 放在原操作期限和 inFlight 内，交付前复查当前身份/owner/指纹，交付后原 run 再确认当前权威状态，ticket 只在完整操作成功后续期并随后释放 claim。不以 Service 字节迭代结束代替响应收尾。票据登记在读取及最终授权成功后，登记前再次同步核对具体 owner/取消；HTTP ticket 响应按 Shared 白名单投影，inline 20 MiB 硬预算只引用 Shared，技术对象不穿透应用 sink。

下载票据只保存原会话摘要及原 FileResource ID，重新打开相同 Workspace 不复用旧票据；claim 对外不暴露私有 digest Buffer/可变 lease。上传 byte channel 取得实例绑定的 append/abort 能力：append 持续认证，断开清理可在会话撤销后执行。SFTP scan 的 finally 覆盖 break/return；ZIP 消费者拒绝或取消时停止并等待生产者/读者收尾。供应商 stdout 使用增量严格 UTF-8 解码，不按 SSH packet 独立转字符串。

Remote Files 的流 attachment 绑定具体任务实例；prepare 配额由资源串行 mutation 边界判断。下载票据分别维护有效期准入与在途 claim 生命周期，过期不再接纳新请求，在途读取不因清扫被破坏。跨目标 move 的源变化检查与目录 ZIP 的持续身份复查归 Service；ZIP Adapter 只负责生产、消费和清理收敛，多项失败保留因果。源 metadata 检查不提供原子快照或条件删除保证。

归档解压的目录、普通文件和链接统一逐项发布，不以整树 rename 绕过子项复查；stage 根及中间目录的类型/规范路径检查归 Service，不能冒充原子 nofollow。新建目录集合仅是局部属性恢复状态，已有隐式目录不被重写。原生列表 EXIT 清理由 Adapter 确认，具名 cleanup_failed 经 Model 转安全 unknown，原操作与清理因果只留内部。HTTP 下载 Interface 持有覆盖最终 flush 的完整传输期限与取消监听；Service 的写入执行在 mutation 队列后重新核对身份、owner 与指纹。

## 8. 当前能力与验收

正式后端 HTTP/WS 与前端已消费当前 Shared 契约。已执行的验证只对测试入口记录的 SHA 和场景有效；真实设备、外部依赖及故障组合的待验范围统一见 PLAN。

Access 的因素/Passkey 主链和正式界面已接线；完整身份由 Access 事务签发，最终复验凭据 generation/counter 与挑战/改密修订。IP 与监控配置热更新，CAPTCHA/站点重启生效。真实安全硬件、公网供应商及扩大故障/存储恢复等范围以 testing 和 PLAN 明确承接，不以历史局部证据代验。

### Workspace 与远程桌面保证边界

Workspace 的当前源码由唯一 sessions Service 持有：64 项准入覆盖 opening、detached、resuming、closing 和 cleanup_unknown；普通恢复使用同一 SSH shell、8 MiB journal、120 秒宽限及显式 workspace.resumeAck。新建回执的terminalOffset为初始journal端点、replayedBytes为本次保留回放字节，前端由两者定位收到字节的起点；普通恢复的terminalOffset为回放终点，replayedBytes必须与请求offset对应。lastConnectedAt为Unix秒。终端累计消费归 WS attachment，未确认窗口 1 MiB；消费 ACK 与恢复所有权 ACK 分开，回放和普通输出均服从窗口。非法消费不推进计数，越界 journal offset 在创建 pending attachment 前拒绝；断开释放原消费者暂停，由原 Workspace 继续保留输出。独立 Remote HTTP/PTY 使用自己的技术 SessionService，复用 machines Model/Platform，不暴露用户 Workspace 的活跃 shell 或权限。

挂起标记、prepare/commit/unmark、lease/takeover、pending 恢复与历史由同一 Workspace 实例拥有；只为新 ID 临时登记别名，不另建 SSH shell。历史/checkpoint 经 History Model 转换到 Platform Port/Adapter，Shared 只传安全管理对象、请求及事件。suspend.resumeAck 与普通 ACK 独立，baseline 已发送不代表 ownership 已提交；准备/ACK 超时、WS 关闭和接管回滚原 owner，晚字节有界保留。

目录安全移除由 WorkspaceService 的 `removeSuspended` 根据当前状态决定：attached 且租约有效时共用原 unmark 清理，只删除挂起日志/checkpoint/目录和历史游标，不关闭 SSH、PTY、Files 或当前附件；suspended 才终止；已断开只删 tombstone；prepared/resuming/所有权不明则拒绝，不根据旧前端状态回退到终止。同一标记共享清理 Promise，日志或 checkpoint 清理失败保留 `operation_unknown`；成功经原附件的 `suspend.unmarked` 事件同步 ID/generation，再发布完整目录。事件监听随附件解绑/关闭释放，前端清除本地标记而不关闭终端。HTTP 回执逐字段返回请求 ID 与有限 disposition，原显式终止接口仍保留其终止语义，安全移除不隐式调用它。

目录协作由 Shell Service 持有排队、替换、期限与事件；有限失败基础值归Shared remote/terminal/values，内部事件对象仍归sessions/model，WS逐字段投影。Shell Model转换应用能力，Native Shell Adapter构造Bash/Zsh命令、解析PID/提示符和字节输出。目录切换仅写入安全转义的普通 cd，按 Shell 配置记录历史，不附加内部标记/历史清理、不隐藏命令或后台输出；setup 探测仍保留独立的内部历史清理；结果分隔符不输出换行，过滤完成后用 CR/EL 重绘后续提示符；实际TTY标志确认Bash初始化原先关闭echo时，先回退隐藏提交的一行，不扫描或裁剪登录信息及普通命令的空行。每实例随机marker避免普通stdout充当prompt；未完成探测而已接收用户输入时安全拒绝迟到注入。普通Workspace响应与protocol.error使用Shared有限安全码，准入满额为limit_exceeded。真实Bash目录切换/回读及普通续接已有专项证据；其他登录脚本、Zsh及并发提示符组合仍分别待验。

Service 只消费 Model 创建的 DesktopPeer；Model 同步 bind 原 WS 防止首帧丢失，授权前仅有界缓冲，异步复查后才允许 TCP 派发。Platform 持有 DER、TCP/TLS、队列与背压；真实关闭确认覆盖 WS、原 socket、初始化、队列消费与 send 回调，未确认清理不提前释放槽。桥就绪不证明远端认证或画面成功；RDP 签发前探测证书，由 DesktopService 决定系统验证或用户精确指纹确认；当前用户可记住同一主机/端口证书，变化重新确认。Model 显式转换独立信任存储与技术证书；实际 TLS 在 CleanPath/凭据认证前强制票据指纹匹配，详见远程桌面专题。画面、输入、权限及资源释放的实际覆盖见 testing，不复用旧 Guacamole 证据。

当前关闭/导出边界：Workspace Service 跟踪导出准入、60 秒完整期限、交付 sink 及实例关联取消；HTTP Interface 持有 response/pipeline，History Model 暴露应用字节源与可等待释放，Platform 只提供技术流/VT 操作。全 Remote 导出最多 2 项，清理失败保留名额。checkpoint dispose 返回共享 Promise，参与关闭确认；临时日志删除及渲染释放的具名技术失败经 Model 转为模块清理失败，HTTP/WS 都输出 operation_unknown。模块各独立 owner 并发关闭，30 秒确认截止不代表真实任务结束，晚任务继续观察；实际整体验收范围见 testing。

## Preferences 持久安装配置

### 1. 职责与范围

Preferences 拥有持久设置及版本；Access拥有准入/认证政策，Remote拥有采样/缓存用例，Platform不持有设置业务。持久配置包括安全策略、活动CAPTCHA配置、监控间隔和多Origin/RP。外观/备份及外围集成已有实际消费者，全部行为覆盖范围见测试入口及 PLAN。

### 2. 子功能与目录

preferences/configuration/{service,model,storage,adapters/sqlite} 分别持有配置用例、应用与存储/密码技术转换、独立存储契约、SQL/row解码。通信放preferences/interfaces/http，安装在register，DDL经migrations调用Adapter。configuration-rules 持有可复用纯配置校验，Service 与恢复预检共用；配置版本、默认值、热/冷激活策略归Service；编码容量/安全失败归Shared preferences/configuration/values。

### 3. 依赖方向

HTTP→Service→Model→Storage→SQLite Adapter；Bootstrap先await Preferences初始化，取得窄安装快照后安装Access/Remote。Preferences业务入口只依赖Access public认证接口，不引用其策略实现；Access register另提供仅安装使用的readTransactionIdentity，执行Access Adapter自己的SQL并返回userId/null。Bootstrap在读取配置、安装Access后将它一次性绑定到Preferences Adapter；事务executor不进入业务Service/公开HTTP，未安装拒绝写入。配置不会通过Platform注册槽传播。因素Model只根据已配置Origin/RP及协议边界验证的当前Origin选用技术配置。

### 4. 类型与转换

Shared持有完整配置GET/PUT、业务可见政策及CAPTCHA安全视图/秘密写命令。应用类型归configuration/model/configuration-types，存储记录归storage；Model逐字段映射并加解密，SQLite Adapter只解码其storage类型。ConfigurationView内部独立定义有效监控投影，Service从当前有效配置选值，HTTP逐字段构造Shared必填effectiveMonitoring；范围基础值归Shared，规则与SQLite row解码精确引用。HTTP白名单投影不返回secret或ciphertext；Backend初始安装快照在register/public边界明确投影，秘密只供Access真实安装消费者使用。PreferencesRuntimeConfiguration在register定义六个热字段安装契约，Bootstrap逐字段转为Access安装契约和Remote周期参数，不透传应用类型或秘密。

### 5. 入口与安装

管理员GET/PUT /api/v1/settings承载当前核心配置，PUT完整替换并必填expectedVersion；CAPTCHA管理入口单独GET/PUT /api/v1/settings/captcha，匿名读取保持公共安全视图。未知/旧界面字段拒绝，不静默过滤。初始化使用环境seed且仅首次写入，后续启动读取持久配置；Access/Remote采用同一已验证版本快照，不重新用环境覆盖。

### 6. 数据、事务与并发

preferences配置单例表归所属 Adapter。完整更新和CAPTCHA专项更新都在Adapter以版本CAS写入，不先读后无条件覆盖；同事务通过Access安装能力复查session/password revision/expiry，Model将userId/null转换应用actor，Service的同步准入回调决定管理员权限，拒绝整体回滚。秘密keep/replace/clear由Service决定新配置，Model加密并逐字段转换，存储永不保存明文。ConfigurationService串行读写，Bootstrap在监听前安装唯一prepare回调：先验证并编译Access白名单/封禁和Remote周期，SQL确认后同步apply，不在失败CAS或未知提交后猜测激活。有效配置保留原CAPTCHA/Passkey冷字段，更新六个热字段；全部字段与保存值相同时推进effectiveVersion，否则保留最近完整有效版本，requiresRestart仅反映冷配置差异。apply异常返回operation_unknown，不虚报成功；重启从持久配置重装。

Access更新原SourceAdmissionService/LoginFailurePolicy实例，后续请求采用新策略，不撤销既有会话或清除封禁记录。Remote更新原服务，等待中的状态订阅重新计时，在途采样仍由原owner追踪，结算后按新周期调度，不另起并行采样；资源TTL变化清空成功缓存，不释放在途任务，晚成功采用当前TTL。Bootstrap初始installation仍是安装快照，不作为运行时查询缓存；在线恢复重建模块并重新绑定回调。

### 7. 生命周期与失败

读取/更新以原Access身份入场并在交付前复查；Settings关闭拒绝新调用和未开始的排队工作，等待已开始任务真实结算，SQLite在其后关闭。提交前保留有效配置引用，停机中晚确认仍完成同步激活与有效态记录，不因停止准入误报未提交；Remote停止时已注销订阅重排回调，不重新激活已关闭采样。已提交而响应失败按未知交付处理，保留版本/输入并只读核对，不自动重写。存储/解密/配置无效时启动失败，不回落默认或放宽安全策略；重启不重放运行任务。可信Origin/RP与CAPTCHA仍在进程内固定，在途认证挑战不因热更新混用配置。

### 8. 当前能力与验收

源码安装、Shared 和四个 Settings HTTP 已接线，四表、两轮复审与静态证据归 testing。快照 Adapter 复用行解码后，经安装回调调用 Model 的解密投影及同一 configuration-rules；SQL 层不引用应用类型或规则，恢复预检拒绝无效白名单、站点或 CAPTCHA 配置。多Origin HTTP/WS仍必须校验Host、协议、同Origin来源；多RP根据当前可信Origin选用，并绑定挑战中的Origin/RP，不能取任意第一个配置。最多16个配置站点，与监听主Origin使用同一协议，HTTP仅允许localhost/127.0.0.1；不同协议须调整配置和部署后重新启动，监听校验失败不开放服务。会话身份复查与Settings CAS在同一SQLite事务；撤销先提交则设置拒绝，设置先提交则交付仍复查且不能撤回已提交配置，也不能承诺浏览器收到。正式CAPTCHA/IP及监控配置面板已消费Shared，Dashboard使用有效监控值；其余 Preferences 消费者也已接当前 Shared。真实HTTP保存/CAS/重启与受控界面专项证据归testing，不代表全部运行时采样时序验收；外围功能已有实际消费者，执行须 governed 准入。

### 偏好与个人数据设计

#### 1. 职责与范围

Preferences 拥有界面偏好、快捷命令/标签、命令历史、路径历史和收藏；核心安全配置仍由 configuration 独立持有。个人数据按当前 Access 用户隔离，不能因知道记录 ID 访问其他用户的数据。历史的真实生产者是前端 HTTP，旧 Workspace 未自动写历史；不为假设消费者添加跨模块入口。

#### 2. 子功能与目录

用户界面偏好归 presentation，快捷命令和标签归 commands，历史归 history，路径收藏归 favorites；各自 Service 编排用例/容量，Model 转换与失败分类，storage 定义任务，adapters/sqlite 定义 SQL/行解码。HTTP 统一归 Preferences interfaces/http，不创建第二棵入口树。

#### 3. 依赖方向

HTTP → Service → Model → Storage → SQLite Adapter。Access 只通过 public 认证及 register 安装的事务身份读取能力协作；Adapter 不借用 Access 私有 SQL。没有实际后端消费者的能力不公开到 public，不新增全局分发器。backendLogLevel 归 Operations logging owner；终端 scrollback、Docker 面板轮询及预览参数都是前端偏好，不修改 Backend checkpoint/采样资源限制。

#### 4. 类型与转换

Shared preferences 子域持有双端请求、完整成功/失败、基础值及预算；应用类型只在子功能 model，存储任务只在 storage，SQL 行只在 Adapter。HTTP 与 Model 分别逐字段转换，时间在协议边界表达，既有字段相同仍转换。查询、写入、清空的契约分别定义，不用任意字典充当业务结构。

#### 5. 入口与安装

旧实际方法/路径逐项核对，契约变更同步真实消费者；个人偏好 GET/PUT /settings/preferences 与原 layout/focus-switcher-sequence/sidebar/workspace-layout 安装，命令/标签/历史/收藏保留旧各自路径方法。register 安装各 Service/Storage、路由和生命周期，Bootstrap 只接安装入口。用户身份来自 Access，不来自 JSON/query。历史新增只是记录数据，不执行 Shell。

#### 6. 数据、事务与并发

每次个人数据写事务复查会话，并绑定最初认证用户；历史 upsert、更新时间、修剪同事务完成。命令与标签关联同事务，不允许部分批量成功。编辑类使用版本 CAS，存储损坏失败闭合，不默默恢复空对象。用户偏好保存立即成为读取权威；首次未保存明确 version=0，第一次 CAS 写入创建 version=1，不读取旧字典或恢复损坏数据。界面实际生效由正式 Preferences/Workspace 消费者负责。持久偏好仅接受当前完整字段，不接受旧命令栏字段或以默认值补齐缺失字段；读取与备份恢复共用该严格存储解码。命令、标签与收藏不设固定总条数上限，列表按 Shared 页容量读取；单命令标签关联仍按 Shared 的50项同事务准入，SQLite 只提供事实。组删除按完整请求1 MiB预算准入，不能超过编码预算。批量标签关联核对全部命令原版本；删除标签推进受影响命令版本，原编辑不能覆盖变化。标签组及未标记组删除均核对完整成员与指令版本；真实标签额外核对标签版本。未标记组按当前用户无标签关联的指令集合读取与删除，不持久化虚拟标签或使用伪ID；整批匹配后在同一授权事务删除，变化时无部分写入。列表有界分页、固定次序，但非跨请求快照。命令/标签/收藏的持久时间在 Adapter 完成权威读取后生成，更新不倒退；历史按同用户/类别现有最大时间防止回退导致新项误裁剪。行解码核对创建、使用与更新时间关系，命令递增在写入前拒绝版本或使用次数耗尽。

#### 7. 生命周期与失败

Service 停止准入后等待已接纳真实工作，关闭不取消已提交结果；不以固定在途或排队数量拒绝请求。协议严格解码和预算在副作用之前，事务后转换/认证/交付失败为 operation_unknown，客户端只读核对，不自动重放。configuration/presentation/commands/history/favorites 复用模块内部 PreferencesTasks 动态观察已接纳任务，Service 仍拥有鉴权、版本与停止准入；核心配置沿原 tail 串行，已接纳的排队工作不在关闭时再次因停止准入而拒绝；已结束真实故障保留最多16个诊断样本及额外数量，关闭排空并汇总，预期用例拒绝不算存储故障。

#### 8. 当前能力与验收

个人偏好、命令/标签、历史及收藏源码已接线，功能源码和静态通过分开记录。正式前端已接线，具体行为回归见 testing；逐项缺口、两轮审核四表及当前执行证据归实施方案和 testing，不把设计当完成。

## Operations 日志、审计与通知

Platform logging/pino-logger唯一实现原Logger契约，registerOperations安装PinoLogger，替换NativeLogger，不保留转导出或旧路径。前后端依赖同一catalog的Pino9；后端采用stderr同步destination、禁用默认base/timestamp，由白名单对象与severity formatter保留time/severity/code/facts单行JSON。原32facts、16KiB编码预算及debug/info/warn/error/silent过滤不变，LoggingModel只转换安全auditId，Service仍拥有持久级别CAS及激活。没有worker、异步传输队列或新的公开类型，正常同步写入无需新增flush owner；审计持久化、写入失败与关闭汇总沿原链路，不因换库改变为日志失败可忽略。

1. **职责与范围**：Operations 拥有 backendLogLevel、受限审计记录、通知配置与投递账本。Access/Targets/Remote 仍各自持有业务状态；Operations 不成为授权 owner。仅已实现的事件进入 Shared 可选列表。
2. **子功能与目录**：logging/audit/notifications 各按 service/model/storage/adapters/sqlite 放置；HTTP 和安全投影集中 interfaces/http；audit/service/audit-event-owner.ts 持有发布、请求/事件准入及停机排空，register 只装配和公开投影；operations-storage-refusal 是独立存储拒绝，Model 的 operationsStorage 负责映射应用失败。Service 管保留数、订阅选择、队列容量和激活时机；Model 管对象、秘密与技术失败转换；Adapter 管 SQL、行/JSON 解码和事务。
3. **依赖方向**：业务 owner 经 Operations public.publish 提交有限安全事实，出口将同步准入/异步任务失败统一转为 public-errors.ts 的安全 OperationsError，内部原始 cause 由真实任务 owner 留存，已安装 HTTP 经 observer 直接调用内部发布 owner 记录结果，不绕公开安全包装；通知 Service → Model → Platform delivery。Platform logging/delivery 不引用业务事件、用户或通知配置对象。
4. **类型与转换**：Shared operations 持有事件/日志级别/投递状态、完整协议与容量。内部类型归各子功能 model，存储类型独立归 storage。秘密字段按配置ID与字段作用域加密；Adapter 的配置 JSON 独立限制为128KiB以容纳加密膨胀，不能复用64KiB请求预算；公开对象和内层配置解码均使用完整响应预算。公开只返回 hasPassword/hasBotToken 与 header 的名称/hasValue，明文/密文不出 HTTP。
5. **入口与安装**：GET/PUT /api/v1/settings/logging；GET audit-logs；GET/POST notifications、PUT/DELETE notifications/:id、POST notifications/:id/test、POST notifications/test-unsaved、GET notification-deliveries，均要求当前管理员。Bootstrap 安装 Access 事务身份读取能力、初始化日志/投递恢复，再开放监听。
6. **数据、事务与并发**：日志设置未显式写入时允许无持久行，由 LoggingService 提供 version=0/info 默认；快照导出与恢复保留该合法空表，不补写默认记录。配置 CAS 与会话复查同事务，写入时钟在读取事务事实后求值；日志/通知配置递增前拒绝安全整数耗尽，通知删除不因版本耗尽被阻止。通知行及投递行核对更新不早于创建，派发与结算均验证状态 CAS。审计 event_key 去重且核对原事件、身份、资源及路由/状态内容，不把重试时钟作为绑定内容；订阅选择通过 Model 同步回调消费事务内事件/配置/待投递事实，最多4096个 queued/dispatched，容量不足保留整个事件待分发，不丢一部分。选择采用分发时已启用的配置，且配置创建时间不晚于事件；不是业务写入时的配置快照。outbox 保存加密配置快照；禁用仅停止未来分发，删除令尚未派发项失败，已派发不撤回。审计保留最新50000条及尚未分发积压；投递保留最新50000条终态与全部在途项。业务提交与审计发布不是同一事务，崩溃可能遗漏尚未发布的业务事件，不承诺全局 exactly-once。
7. **生命周期与失败**：HTTP 最多64个、事件发布最多256个在途任务，晚失败有界汇总。其他业务 owner 排空后 Operations 才停止发布并排空请求/事件，再取消和关闭投递。投递串行、完整截止20秒；queued → dispatched 在网络前持久，成功/确定拒绝/未知分别结算 sent/failed/unknown。重启将 dispatched 围栏为 unknown，不重发；关闭和响应体/SMTP资源失败保留因果。日志按版本单调激活，避免迟到读取恢复旧阈值。协议边界保留 HttpInputFailure 的状态/安全码，正常输入拒绝不污染事件 owner 的关闭证据；观察的是响应决定，不证明客户端收到。投递观察器唯一记录其任务失败，关闭只等待后汇总；事件owner按错误实例去重，发布与请求两条追踪链不重复登记同一失败；仅 delivery_failed/delivery_unknown 可结算为投递结果，其他故障停止派发并保留原账本。日志失败仍启动独立分发收尾。
8. **当前能力与验收**：源码已接线，正式 UI 已接线；安全有限事件替代任意 details，模板支持 event/subjectId/time，时间为UTC、Email为纯文本。既有专项验证环回HTTP/Telegram协议、实际SMTP收发与全部/部分收件人拒绝、Access登录事件分发、配置CAS/秘密保留清除、在途关闭及重启不重发。Delivery Adapter仅按供应商结构化EENVELOPE/RCPT TO及4xx/5xx确认全部收件人在DATA前被拒，映射确定失败；部分成功和其他确认缺失仍保留unknown，清理失败不能被覆盖。真实公网供应商、TLS/SMTP认证、崩溃/满额/自然期限及其余producer仍待验，不把回执当交付成功。

## System 宿主诊断

1. **职责与范围**：diagnostics 提供进程运行时、RSS、主线程堆/外部内存/ArrayBuffer、进程累计 CPU、主线程 GC、主库 Worker 内存、模块资源和数据库版本；status 拥有本机资源与健康响应。不返回环境、路径、表内容、凭据或远端机器详情。模块资源不等同模块全部内存，不合计或计算“RSS 剩余占用”。
2. **子功能与目录**：diagnostics/service 管管理员复查、成功快照一秒缓存/在途合并及关闭，model 管转换，storage 和 adapters/sqlite 读 schema；platform/system 的 NodeProcessDiagnostic 持私有 prom-client（官方后继包 `@prometheus-io/client`） Registry、Gauge/Histogram、GC PerformanceObserver 和 ResourceCollector。真实 owner 只提供自身计数/逻辑字节事实；主库 Worker 通过 SQLite 技术协议采集自身 isolate 内存，不序列化业务对象估算内存。
3. **依赖方向**：管理员 HTTP → DiagnosticService → DiagnosticModel → Platform/Storage；Bootstrap 经 register 装配 Remote collector；System 不引用其它模块的私有 Service，vendor 实例不穿透技术边界。各模块 HTTP 观察包装由 Bootstrap 安装，不改变原授权/审计。
4. **类型与转换**：Shared system/diagnostics 唯一拥有双端对象、有限模块/资源/单位/状态、错误与16KiB预算。内部 HostDiagnostic、WorkspaceResourceUsage 和存储事实各自独立，技术 ResourceCollector 留 Platform。codec 校验八个分组、唯一名称、非负值与单位关联，未接入/失败组为空，不补零。
5. **入口与安装**：GET /api/v1/status 为不要求会话的进程健康响应，仍经全局来源/IP 准入，不证明数据库健康。没有公共 /metrics、调试端口或依赖外部 Prometheus 服务。registerSystem 注册 Storage/System source，Bootstrap 注册 Remote source 并包装六个模块 HTTP。
6. **数据、事务与并发**：不持久化指标；SQLite Adapter 读真实 schema。并发调用合并同一采集，成功结果最多复用一秒，不再使用四个调用拒绝上限；管理员准入和交付前复查仍逐次独立。各指标非原子快照，时间为毫秒/uptime 整秒。RSS/CPU 为进程级；process 的 heap/external/ArrayBuffer/GC 仅主线程，ArrayBuffer 已包含于对应 external。GC 自本诊断 owner 创建累计。Storage 另外报告主库 Worker 独立 heapUsed/heapTotal/external/ArrayBuffer，不计临时恢复预检 Worker 或 SQLite 原生页缓存；pending_requests 是采样请求派发前的未结算消息数，pending_operations 是 Runtime 已接纳且尚未完成的排队及执行项（事务整体一项，不重复累计内部 SQL）。只读 diagnostics 技术消息由 Runtime 合并、严格解码，不经过事务队列、不执行 SQL；仍等待 Worker 当前同步工作返回，避免维护排空依赖诊断形成队列等待环，不冒充无延迟采集。
7. **生命周期与失败**：Service 拒绝关闭后任务、追踪真实采集/复查；System 排空 status/diagnostics 后断开 GC observer，清空私有 Registry 与 collector 引用，在线恢复执行相同退订，数据库最后关闭。重复关闭共享 Promise，排空故障汇总。技术异常在 Model 映射 SystemCollectionFailure；数据库失败为 available=false，单组 collector 失败为 unavailable，其它组继续，未注册为 not_instrumented。HTTP 包装保留全部路由预算和路径元数据，finally 归还请求计数，不改变业务准入。无强制 GC、堆快照或常驻堆采样。
8. **当前能力与验收**：六个业务模块均有在途 HTTP；Remote 提供普通工作区、挂起/断开、输出/输入/日志队列/恢复逻辑字节、传输和状态订阅；Collector 支持同步或异步、逐组隔离失败，关闭后晚结果不得重新写入 Registry；实际采集仍归原请求与 Runtime 追踪直至收敛，不设置丢弃真实任务的伪超时。缓冲类别可能共享底层数据，未计量全部对象/解析器/原生句柄及其它缓存，只有计数的组明确标注内存未计量。正式数据页复用原诊断分区，折叠展示明细；静态及待远程证据归 testing，编译不等同行为验收。

清理失败保留删除保护与有界故障证据，不因任务返回而释放保护。Preferences 各子功能在 preferences-lifecycle.ts 复用窄停机结果分类：普通业务拒绝不升级为停机故障，存储不可用/未知提交/内部故障仍汇总返回。

## 实例数据目录

1. **职责与范围**：数据库父目录为整个实例的持久数据目录。
2. **子功能与目录**：`bootstrap/data-paths.ts` 唯一推导 `appearance/`；`create-app` 的启动恢复与 `module-manifest` 的 Blob 安装、在线恢复共同消费。
3. **依赖方向**：Bootstrap 依赖 Node path 与 Platform；业务 Service 不读取进程环境或依赖 Bootstrap。Compose 数据卷及现有 `NEXUS_DB_PATH` 不变，不增加第二路径配置源。
4. **类型与转换**：DataPaths 为路径 owner 内的局部结果类型；不修改 Shared、SQL schema、Blob 键或备份的 appearance 逻辑分区。物理路径不进入公开协议。
5. **入口与安装**：`createApp` 取得 SQLite canonical path 后解析资源路径；启动恢复先于资源打开，模块安装按同一解析规则打开 NativeBlobStore。
6. **数据、事务与并发**：数据库与背景资源根同级，每实例独占数据目录，不同实例不能通过同目录不同 DB 文件名隔离。Snapshot 原有根目录校验、同文件系统发布、SQL 提交与文件日志对账不变。
7. **生命周期与失败**：资源目录由原 Blob Adapter 创建；WAL/SHM、恢复日志及暂存目录仍由原 owner 清理。本次破坏性布局不兼容、不自动迁移或删除旧资源，不改变未知结果围栏和停机收尾。
8. **当前能力与验收**：USAGE 与 DEPLOYMENT 记录新目录结构和自动迁移行为；既有备份与多实例夹具同步路径。静态结果归 testing，实际读写、在线/启动恢复及中断故障仍待远程验证。

## 跨模块设置与备份设计

### 1. 职责与范围

Preferences 持有主题、外观、背景和 HTML 主题库；System Backups 持有认证加密导出/导入。Bootstrap 协调全应用维护与模块重建，Platform 仅提供通用快照、文件发布和 SQLite 提交事实。

### 2. 子功能与目录

沿 Preferences appearance/themes、System backups 的 Service→Model→storage/Adapter；SQL 和跨表读取均归 Adapter。背景字节根由 Bootstrap 安装 NativeBlobStore(resolveDataPaths(db.path).appearance)，不在 Service 拼文件路径。HTML 主题及修订在 SQLite，不保留重复文件存储。

### 3. 依赖方向

HTTP 严格解码→Service 用例→Model 转换→各所属 Adapter；System 通过注册快照能力消费其他模块，不引用私有 Service。NativeSnapshotRestoreFiles 只处理受管根、暂存、目录切换日志与清理；SqliteSnapshotRestore 只处理技术表和提交证据。

### 4. 类型与转换

Shared 只持请求/响应、安全错误与容量。Model 显式转换应用、存储与技术表示，HTTP 白名单投影；Snapshot owner 使用原持久解码器核对表行、引用与秘密。跨实例秘密在加密载荷内传递，由目标 SecretBox 重新保护，不复制原实例密文。

### 5. 入口与安装

认证 POST /api/v1/settings/backup/export 接收当前密码，导入同路径 import 接收 multipart backupFile/password。响应为 restoredTables/restoredRows/restoredFiles/cleanupPending。密码、认证表、活跃会话与恢复标记不作为产品数据恢复；旧结构备份不兼容新表集。

### 6. 数据、事务与并发

导入/导出共享一个操作名额，120秒完整期限。NXSEALED2 使用随机数据密钥、PBKDF2-SHA256 密码包、可选实例密钥包及 AES-256-GCM 头部认证。导出前后核对数据及完整背景文件大小/hash；变化返回 source_changed。

预检在独立内存 SQLite Worker 装入候选，DDL 来自当前目标 schema。先拒绝类型强制转换、必填/主键空值，再验证 UNIQUE/CHECK/FK 与模块原跨表规则；目标认证与明确排除项保留。Targets 在原 Model 转换后复用跳板规则，整批只构建一次图；个人记录必须匹配目标管理员，内置主题和无用户审计按原分区规则处理。

预检不修改当前数据库或目录；一次性候选持有已验证行与文件字节，关闭后清空并等待 Worker 退出。实际 commit 在维护排空后重新核对当前认证与 schema。文件及日志同步后才发布，每次 rename 前保存意图、之后同步目录。删除按 FK 先子后父，插入延迟校验；产品恢复与 restore_id/initialized 标记同事务提交，SQLite FULL 同步。提交失败只读核对标记，无法读取时停止准入并保留现场。

### 7. 生命周期与失败

维护通过 suspend→drain→replace→resume：立即关闭新 HTTP/WS/public 准入，排空真实 handler、响应交付、WS 任务和旧模块；本地连接断开不能代替业务收敛。唯一当前导入请求不进入待排空集合，避免自等待。Platform 不处理业务停机策略。

旧模块终止后重新安装并重绑事件、事务身份、配置、路由和消费者。BackendApplication 的稳定能力树每次调用解析当前模块，缓存子能力不继续访问旧实例。排空、重建或提交未知时保持维护，不能自动重放写入或通知。仅旧目录清理未完成而新数据已确认一致时可返回 cleanupPending。

启动先只读校验恢复日志兼容性，再初始化 schema、对账恢复日志并安装模块；不兼容或损坏的日志在迁移前拒绝，保留数据库版本和恢复证据。initialized=0 保留未完成初始化，重启继续；新模块与传输入口就绪后才确认标记。通知 queued 结算 failed、dispatched 保留 unknown，旧审计不重新派发。

背景发布使用 pending→ready/retired 及引用/版本事务；只有确认无引用后才删文件，删除成功后删元数据。清理失败保留持久记录与 cleanupPending，关闭汇总真实失败。HTML 内容及名称修订同事务，删除也推进修订，列表只读摘要；内容副本独立保存。来源目录读取经安全出站网络并在异步后复查原版本。ImageInspector 仅提供格式/hash/字节事实，file-type 与禁用实体的 fast-xml-parser 不执行或消毒内容。

### 8. 当前能力与验收

普通备份、重建和恢复日志的执行证据归 testing，不将历史结果扩大为当前全量保证。现有故障专项保留 staged/publish/transaction/commit/cleanup 各边界 SIGKILL、二次恢复故障和提交回执未知；断电与实际持久介质故障仍待验证。

## 共用机器突变围栏恢复

### 1. 职责与范围

原 claim 不能表达恢复证据；

### 2. 子功能与目录

沿用 machines 的 mutation-service/model/storage/sqlite；恢复用例放 machines/service/mutation-recovery-service，协议放 remote/interfaces/http/mutation-http 与 mutation-mapper。共用状态/结果/容量在 Shared remote/mutations；内部对象归 machines/model/mutation-types，存储对象归 mutation-storage，持久解码归 mutation-row。

### 3. 依赖方向

HTTP → RecoveryService → MutationModel → 独立 MutationStorage → SQLite。Service 消费 Access/Operations 窄 public；Access 的事务身份 reader 通过 register 安装到 Adapter，不在 Model/Service 直接查会话表，不让 Adapter 引用应用类型。运行准入和人工恢复复用同一数据库围栏。

### 4. 类型与转换

Shared 仅定义安全观察、明确证据写命令/释放命令、完整响应与错误。HTTP mapper 与 Model 分别双向白名单；资源摘要和本地 owner 实例 ID 不公开，目标仅含 ID/原配置指纹。人工证据明确 source=administrator，不冒充自动探测，禁止在 note 放秘密或命令正文。

### 5. 入口与安装

管理员入口 /api/v1/remote/mutations：GET 分页和 /:id 只读；POST /:id/evidence 记录核对；POST /:id/release 显式解除。完整会话与管理员身份在实际读取/写入事务复核，输入在 HTTP 从 unknown 严格解码。RecoveryService 在 Remote quiesce 停止准入，close 等待已受理任务及审计。

### 6. 数据、事务与并发

remote_machine_mutations 只持有活跃资源锁；新增 mutation_claims 与 mutation_evidence 两张持久表保留阻断/释放历史。正常已确认操作释放并移除临时 claim，blocked/released 证据不自动清除。活跃资源和未释放claim不设全局数量门槛，每claim保留16份证据的协议预算；released历史保留审计，未确认占用不能循环覆盖；快照校验同步移除全局计数限制，仍核对完整锁集与证据。记录证据、推进 claim 修订同事务，释放核对原 claim 修订与最新 evidence 身份、完整锁集并原子移除锁/保存 released。读取和恢复写入在实际事务入场及交付/提交前检查原管理员会话；末次复查失败回滚本次写入。会话摘要的同步技术失败同样在Model转换。业务运行路径只接受当前结构，后续数据转换归对应独立迁移。

### 7. 生命周期与失败

当前 Remote owner 产生的未确认资源不能在同实例被人工释放；owner ID 不同仅允许进入人工核对路径，不证明旧生产者退出或远端停止。管理员须从独立只读检查确认原生产者停止、远端效果（已应用/未应用/部分应用）及关联资源停止，记录时间和说明；仍无法确认则保持围栏。证据记录与解除为两个动作，任一网络/提交 unknown 先查询原记录，不重放。原 unknown 永不改写成功。释放审计通过 Operations 发布，模块内持久记录先于事件；事件失败返回 operation_unknown，暂停恢复写入并保留只读查询，原记录可查询，不猜测回滚。

### 8. 当前能力与验收

恢复子链已有源码与类型检查，整体及最终静态状态见当前实施方案；行为覆盖与待验范围见 testing。正式恢复面板提供只读观察、人工核对和单独释放流程，不提供一键重试/自动解锁。

## Targets 凭据与存储转换边界

1. **职责与范围**：Proxy、SSH Key、连接凭据的 Service 校验应用输入；Model 调用 SecretBox，把明文应用命令转为密文存储命令，秘密不进入响应。
2. **子功能与目录**：沿用各子功能 service/model/storage/adapters。共用 SQLite/SecretBox 失败转换及同步加密唯一归 targets/model/target-technical-failure；应用错误类仍独立于技术实现。
3. **依赖方向**：Service → 所属 Model → 独立 Storage/SecretBox；模块共用 Model 转换不依赖 Service、register 或公开错误映射。SQLite 不引用应用规则或应用错误。
4. **类型与转换**：内部输入唯一归各 model/*-types，删除只因 Service 提前加密而存在的密文应用命令；密文写命令只归 storage。Model 逐字段构造，Shared/公开响应不变。
5. **入口与安装**：register 只向 Model 安装 SecretBox；连接类型变更和凭据赋值的存储校验回调经 Model 投影后调用 connections/connection-rules。不新增公共能力。
6. **数据、事务与并发**：SQLite 在实际更新事务读取原类型、凭据和跳板引用，再调用规则；不把检查移到事务外。连接删除由原跳板外键 RESTRICT 保持引用保护。凭据修改在副作用前拒绝安全整数版本耗尽；目录查询应用容量只在 Service 决定。
7. **生命周期与失败**：所有 Targets 存储调用在 Model 映射具名技术失败并保留 cause；公开出口只接受应用/公开错误并安全兜底。提交或回滚未确认统一 operation_unknown，不解释为未写入；具体缺引用拒绝仍在所属 Model 转换。
8. **当前能力与验收**：秘密省略保留、显式清空、名称/版本冲突及引用保护沿用当前语义。源码复核和静态证据见 testing，事务交错/存储故障待专项验收（见 PLAN），正式前端对未知结果保留核对围栏。

### Targets 标签关联设计

1. **职责与范围**：Tags 拥有按标签替换/追加连接和标签删除用例；Connections 拥有关系表与连接版本。保留单连接标签替换，三个入口不相互冒充覆盖。
2. **子功能与目录**：沿用 tags 的 Service/Model/Storage/管理SQL；名称规范唯一归tags/tag-rules，管理与导入共同消费；connections/adapters/sqlite/connection-tag-sql 负责关系事务任务，契约在 connections/storage/connection-tag-storage，不新增业务中心。
3. **依赖方向**：HTTP → Tags公开入口 → TagService → TagModel → TagStorage；Tags SQLite经register安装的窄存储任务操作连接关系，不能直接引用Connections应用类型/SQL实现。
4. **类型与转换**：请求/固定成功响应/容量归Shared tags与connections；内部命令归tags/model/tag-types，存储命令独立。入口与Model分别白名单复制数组；容量事实经Model转换到纯规则，不把应用规则传给Adapter。
5. **入口与安装**：PUT /api/v1/targets/tags/:id/connections替换，POST /api/v1/targets/connections/add-tag追加；Shared严格解码，服务器完整管理员会话准入。DELETE tags/:id保留原路径并解除关联，不额外要求先手工清空。
6. **数据、事务与并发**：原事务检查标签与全部连接存在，重复ID合并，替换允许空数组；实际新增/移除关系的Connection版本同事务各推进一次。删除复用同一Connections事务任务；原单连接标签写入/导入/快照校验统一遵守64项协议容量。标签本身未修改可见字段时不虚增其版本。
7. **生命周期与失败**：请求32KiB，原始ID数组最多1000项，追加非空；缺引用整项回滚。Model保留提交unknown，HTTP返回安全码；响应或审计观察不冒充原子写入凭证，不自动重试。关联请求复用下述management事务准入：在排队后的实际事务复查原管理员会话，不保留正文后重复Access查询。
8. **当前能力与验收**：标签持久行的ID/版本、非负时间、名称UTF-8与容量由同一Adapter decoder校验；管理、导入已有标签和备份预检复用，不将坏数据重新规范化。本链源码已接线，源码/两轮复核与静态结果见实施方案及testing；正常行为/并发/故障统一见测试入口。正式前端消费 Shared、updated:true、容量及连接缓存刷新；不增加旧包兼容。

### Targets 管理事务准入

1. **职责与范围**：management仅持有Targets管理HTTP的管理员准入，不替代各子功能用例，不成为跨模块认证中心。Access仍拥有会话事实；可信后端public/SSH解析保留调用模块自己的授权与生命周期。
2. **子功能与目录**：新增management/service/management-service、model/management-model与management-types、storage/management-storage、adapters/sqlite/management-sql。Service持有管理员政策，Model转换token摘要/存储身份与失败，Adapter复用SqliteRuntime事务准入，不复制关系SQL或在每个业务Adapter重复会话代码。
3. **依赖方向**：Targets HTTP → ManagementService → ManagementModel → 独立ManagementStorage → SQLite技术作用域。Bootstrap经register安装Access事务身份reader，仅使用SqlExecutor/digest/用户数字的窄契约，Adapter不引用Access私有类型或应用规则。
4. **类型与转换**：HTTP从Access公开身份与原cookie逐字段构造内部ManagementActor，唯一归management/model/management-types；Model将token转digest，将独立存储身份转ManagementIdentity交Service纯校验。会话token/digest不进入Shared、公开结果或日志。既有Shared安全认证错误码复用，不增加旧消费者兼容。
5. **入口与安装**：createTargetsRoutes接收模块内ManagementService；所有Targets管理路由在初次Access认证后进入同一准入作用域。register暴露安装身份reader方法，Bootstrap先安装再交付路由；未安装明确失败，不放行。不向TargetsPublicApi增加任意回调执行接口。
6. **数据、事务与并发**：复用SqliteRuntime.withTransactionAdmission，在实际排队后的每个事务开始和提交前经Access原tx读取会话；必须仍是原管理员。管理CRUD、目录/凭据/Host Key/标签及导入逐项事务共用。会话撤销与写入按SQLite事务排序，不将整批导入合成一事务，也不将已提交项回滚；拒绝当前项后停止批次。
7. **生命周期与失败**：work在事务外、准入作用域内执行；只有存储admit是事务内同步业务判断。作用域覆盖被await的HTTP用例，结束后新发起事务不再继承，已排队事务仍携带捕获的原身份校验；不作为后续独立任务的权限。HTTP读取正文后无需重复Access查询，原会话在真实事务复查；认证/权限拒绝分别401/403，存储不可用503，提交或回滚unknown保留原语义。已经提交后的响应失败仍不能证明未写入，数据交付与会话撤销也不声称跨网络原子性。
8. **当前能力与验收**：当前31条Targets管理路由（含安全凭据GET）均使用同一准入，源码/两轮复核/静态结果见方案与testing；行为覆盖见 testing。正式前端按当前401/403和unknown语义处理，正常业务对象不变，专项覆盖未安装/重复安装及作用域隔离，不添加默认绕过。Remote拥有的两条SSH测试路由仍由其原用例复查，不混入本作用域。

RemoteMachineModel 在主机校验拒绝时保存实际握手 endpoint、观测指纹和原 pin 到独立应用错误；仅 Workspace connect 的 WS 失败出口白名单投影为 Shared challenge。信任仍由 Targets 管理确认接口持久化，不自动录入；未知资源清理不能降为可重试的密钥拒绝。

Targets Host Key列表HTTP与正式管理前端共同消费Shared集合上限10,000项/完整JSON16MiB，超限413 limit_exceeded且不截断。确认按host/port覆盖，移除按host/port删除，不提供指纹或版本CAS；管理前端明确提示此语义，不把读取当作写入前提保证。主机名容量唯一归Shared `targets/host-keys/values`（253 UTF-8 bytes）；HTTP codec、可信Service入口和SQLite行解码一致校验编码容量，Service另持有小写规范化及主机名准入政策。SQLite解码拒绝损坏事实，备份复用该解码器；不为旧非法记录保留兼容分支。

Targets `ssh-keys/ssh-key-rules` 唯一持有密钥名称规范化，普通管理和导入共用；`target-validation` 提供模块内文本编码/容量基础校验，秘密正文不规范化。Service和纯规则消费Shared基础容量，Model保持秘密与存储转换；SQLite的Proxy/SSH Key行解码校验正ID/版本、非负时间、有效端口及公开文本编码容量，备份复用同一行解码。独立SSH Key和导入/测试私钥统一64 KiB。旧Proxy管理可存key字段，但旧SSH resolver/传输只消费用户名/密码；新设计不保留无真实运行消费者的key字段，正式前端已消费当前契约。

Targets保存SSH解析入口同样由 `public-mappers.toStoredTargetRequest` 将Trusted请求逐字段转换为内部请求，包含可选expectedFingerprint；不能直接把public对象交给Service。SSH密文快照与未保存引用只供resolver Model实现使用，类型局部定义于该实现，不进入Service应用类型；Host Key公开确认请求直接复用Shared唯一契约，再由register白名单转内部命令。RemoteMachineModel建连后只返回独立RemoteMachineIdentity的id/fingerprint及原机器能力，不把可信解析中的明文认证、Proxy或Jump对象传给终端、Files等后继Model；完整目标仅用于本次握手转换。

Targets恢复预检通过 `registerTargetsSnapshot` 显式安装Connection与Credential两个Model转换回调。Connection回调将完整存储连接投影为应用事实，复用元数据及图规则；Credential回调复用SSH-only密钥规则，Adapter仅按索引关联读取事实并调用回调，不引入应用规则实现。凭据行解码唯一归connections/adapters/sqlite/connection-credential-sql，独立Storage联合记录由SSH解析、Desktop读取和快照复用；身份/时间/方法与秘密字段互斥均严格解码。当前连接元数据与秘密输入容量归Shared connections/values，Service使用UTF-8字节，真实SQL仍只在Adapter；恢复不自动规范化或放宽旧非法数据。

Targets每条连接的直接跳板协议容量16项归Shared，与递归深度/总展开政策分别表达；完整连接应用校验和持久行解码都检查直接集合容量。快照Adapter在秘密转为便携明文后、恢复重新加密前按Shared原始字节容量检查；加密膨胀不计为原始秘密长度，超限当前数据拒绝导出、超限备份拒绝导入，不通过截断或兼容放行。

连接元数据的持久解码唯一归 connections/adapters/sqlite/connection-sql 的 readConnectionMetadataRow，管理读取、Desktop 同次元数据/凭据查询及 SSH resolver 复用；Model 保留白名单转换，不重复存储形状校验。Proxy 导入命中既有记录也复用 readProxyRow，不能仅凭 ID 与用户名绕过持久表示校验。

代理凭据同样由proxies/storage独立StoredProxyCredential表达，SQLite唯一readProxyCredentialRow校验正ID、非负时间和非空密文，SSH解析及快照预检共同消费；无凭据行仍表达null，不把损坏行解释为没有密码。

## Remote 会话与文件资源转换边界

Workspace FileResource 的有效性由 workspaceAuthority 与原 SSH owner 管理；两分钟 idle TTL 只适用于 workspaceId 缺失的独立 HTTP 文件资源。定时回收、owned 与 runAdmitted 三处采用同一适用范围，不能让仍连接的 Workspace 因文件面板闲置而在下次操作时被拒绝。身份、指纹、资源存活、关闭状态及 Workspace 当前实例校验仍逐次执行。

Files 的二进制读取、目录 ZIP、下载类型探测及票据准备由 RemoteFileService.runTransferRead 统一绑定原 Workspace owner，复用 withUploadResource 取得同目标/指纹的独立 FileResource。读取的取消与清理只作用于该临时资源；原 Workspace 的主 SFTP 不因读取取消而退役。任务沿原 run 的 active/inFlight、身份/指纹复查、总期限及模块停机链追踪，关闭失败仍记录到原 owner 的 transferCleanupByOwner。协议入口和 Model 白名单投影不变；SFTP permission_denied 在 Model 映射为已有 forbidden，不把确定权限拒绝当远端不可用。普通目录元数据仍使用主资源；隔离不宣称 SSH 路径快照或远端回滚。当前源码与静态证据见 testing，真实 HTML、ZIP 和取消组合仍待远程验收。

1. **职责与范围**：Files、独立PTY和Workspace共用技术凭据能力，各自Service持有身份、归属、期限及准入政策；凭据不进入公开结果之外的额外通道。
2. **子功能与目录**：files/model/file-model持有文件票据随机值/摘要；sessions/model/session-token-model持有会话凭据表示。Shell与History Model封装终端集成/检查点，Service不操作技术Port。
3. **依赖方向**：Service→所属Model→Platform SessionTokens/SSH/Terminal；register安装SecureSessionTokens，Platform不定义业务对象。
4. **类型与转换**：应用内摘要为不透明字符串，Model转换字节和技术异常；HTTP/WS保留逐字段映射，Docker labels保留原生CLI返回的字符串语义，不将标量展开成字符索引对象；数组及嵌套对象仍逐字段投影。Cookie及终端流控窗口引用Shared唯一取值。
5. **入口与安装**：Files/PTY开启HTTP在真实finish前保留失败撤销路径，取得资源后交付等待最多15秒，Files使用已绑定release，PTY由原SessionOwner释放；按ID的外部关闭仍认证。事件发布后重新核对PTY身份、实例及存活，失败不交付旧资源。
6. **数据、事务与并发**：Files Service 的 FileMutationQueue 按原 Workspace 排队；同一目录、不同目标的有界上传组，或同一真实目录中普通文件到不同新目标的无冲突压缩组，共享一个原 MachineMutation 持久 endpoint claim，最多16项，两类不混组。压缩组按读写集合拒绝输出与其他输入/输出重叠，准入与派发均核对真实父目录、普通文件和目标不存在；目录/链接源、覆盖、解压及其他写操作封组排队。父目录检查/创建串行且拒绝链接祖先，私有stage与替换各自独立；同名/不同目录也封组排队。成员执行前后仍逐项验证原身份、指纹及Workspace权限。全部成员与专属资源排空后统一结算claim，任一unknown保留blocked；结算失败影响所有写入结果回执；明确没有启动writer且独立资源已排空的取消，在仍有其他成员持有该claim时可先退场，不能据此释放持久claim或提前交付写入结果。已排队且未派发的取消可立即结束且不会后来执行。本边界不新增存储；搜索限制已扫描及待遍历目录、单目录条目；列目录/递归删除的私有预算由Files Service持有，不替代Shared编码预算。
7. **生命周期与失败**：上传stage取得后如取消或资源关闭，仍执行绑定discard；健康且未commit的stage在取消、断流、Workspace关闭和quiesce期间停止接纳新块，保留原signal排空已派发WRITE，再关闭句柄/删除暂存/释放专属连接。active操作标明upload或other，关闭不重复硬取消已由上传owner接管的排空；未取得stage/已commit准入或原signal失效仍取消并保留unknown。取消只受理，不等待同组结算，终态回执仍等待整组claim。无法确认远端清理保留unknown。WS退订失败继续其余清理。Workspace丢弃撤销attachment的待发输入，drain退订从活跃列表移除；退订/集成释放异常转入原owner关闭。长期清理诊断保留16个样本及总数，同一Error去重，未确认资源事实仍保留。
8. **当前能力与验收**：源码规则见H-06、E-01.1/E-05.1/E-06.3/E-08.1；行为/容量和未知结果说明见USAGE，静态与待专项验收（见 PLAN）场景见testing，不将源码审查作为行为通过。

压缩Adapter在首个写入前同步发送随机标记，发送失败不启动writer。Files Model选择SSH的TERM排空模式，完整读取stdout后仅将实际远端TERM退出且没有该标记映射为FileCommandNotStarted；已见标记、断流、协议失败或5秒收尾期限内未得到退出均保持unknown。派发期间取消保留晚到channel并请求终止，连接关闭与信号受理不冒充实际退出；不新增远端helper或工具。

## 技术装配、工具分页与安装入口

1. **职责与范围**：Files Service 持有编码默认值/BOM、目录遍历和归档用例；FileTextModel、FileZipModel、FileArchiveModel 转换技术请求、结果及失败。技术命令构造、归档原始输出解析、iconv 和 ZIP 流执行由 Platform Adapter 持有。
2. **子功能与目录**：沿原 files/model 与 service；Platform archive/archive-port 定义 ArchiveCommands、工厂和 ZipStream，text/text-codec 定义 TextCodec；不通过新转导出包装具体实现。Targets migrations 仅编排各原 schema Adapter。
3. **依赖方向**：Service/helper → 文件应用 Model → Platform Port；Remote register 唯一选择 NativeArchiveCommands、IconvTextCodec、streamZip 并注入。Model 不引用具体 Adapter，Adapter 不引用应用类型。RemoteFileModel 暴露已注入的编码/ZIP Model，并为原 FileResource 创建绑定归档 Model。
4. **类型与转换**：归档 list 由 Adapter 返回解析后的 NativeArchiveMembers，Model 逐字段转换为 FileArchiveListing；ZIP 条目、字节与回调保留 Model 投影。SFTP symlink 将应用参数白名单转为技术选项；WorkspaceHistoryModel 将 WorkspaceViewport 显式转为 SuspendedViewport，不以应用类型声明技术投影。HTTP 游标编码沿原 owner。
5. **入口与安装**：公开 HTTP/WS 不变。Bootstrap 的 applicationMigrations 唯一持有版本/签名，直接调用 initializeTargetsSchema，后者依次安装代理、标签、密钥、连接、凭据和主机信任；不保留 targets/schema 转导出或子模块迁移数组。
6. **数据、事务与并发**：只整理装配与转换，不改变 schema/签名、SQL、版本或事务。应用准入由 Service 经 Model 的同事务事实回调执行。
7. **生命周期与失败**：每次归档操作复用一个绑定原 FileResource 的 Model，不新建连接或后台 owner。原信号、剩余总期限、未启动/未知、清理失败与具名失败转换保持；ZIP 的 producer/readers 与原资源仍由原 owner 排空，文本编码失败仍映射 invalid_input。
   完整生产消费者及夹具同步。静态检查、扫描范围和行为待验分别记录于 PLAN/testing，不把依赖扫描或编译当作全后端逐行审核或运行验收。

## Platform 传输与观测资源边界

Remote监控Service持有用户准入、采样订阅与任务归属。2. **子功能与目录**：Platform既有http、ssh/adapters/ssh2、terminal/adapters、acp/adapters持有传输实现；Remote monitoring/model转换技术事实，monitoring/service管理订阅及缓存请求。3. **依赖方向**：Service→Model→技术契约/Adapter；Platform不引用业务类型。诊断采样汇总复用通用有界FailureSummary，不新建业务分发或兼容层。
操作失败与清理失败分别保留因果。SFTP路径由Adapter校验实际字符串，协议出口不推断第三方异常。技术目录项与realpath保留合法POSIX字面量，包括换行；各应用与Shared边界继续按自身契约校验。5. **入口与安装**：HTTP安装有界channel与Desktop原生WS，两者均接管socket error。HTTP传输等待由原请求aborted、响应finish/close与原socket close共同结算并退订；业务handler与资源收尾仍独立等待，不将传输中断当业务完成。仅signal取消不能掩盖其他错误。有界channel在实际派发排队消息时复查准入generation及关闭状态，输入队列同时考虑路由允许的文本/二进制预算。6. **数据、事务与并发**：不新增表或迁移。SFTP复合replace共用完整操作期限，恢复/备份删除另有独立清理预算；确定目录打开拒绝不退役健康lease。7. **生命周期与失败**：SSH路由为直连TCP、代理隧道和跳板channel显式持有实际流，并在ConnectedRoute将每个Client与其Duplex关联；代理握手归还剩余字节前暂停流，避免unshift重入原读取监听。SSH Client先请求end，2秒后destroy实际传输流（ssh2.destroy可能跳过已半关闭流），再最多等待2秒确认Client真实close；SFTP沿原end/destroy及同样确认期限；超时为清理失败，不当作关闭成功。SFTP未确认资源仍归原连接owner，晚close仅解除原实例。SFTP Adapter单独登记流的期限与取消监听清理；流错误及lease关闭均解除本地等待，即使供应商流不发close。流清理回调不替代SFTP channel关闭确认，未知临时文件仍由Files owner保留。HTTP、SSH channel及路由独立清理不被首个同步异常中断；监控退订后的baseline清理被追踪，采样清理失败有界保留到close；日志停止准入后不新建读写owner。8. **当前能力与验收**：保持显式mapper、Shared协议和正常功能；终端导出用线性首尾裁剪，Shell setup按完整marker预算校验，结果起始标记不依赖先收到命令回显；无回显时保留普通输出和可能跨块的标记前缀，已识别回显时隐藏原setup命令。Workspace初始化等待后重新核对身份、取消与记录实例，再交付附件。源码/静态与行为证据归testing；SFTP上传中断与实际句柄收尾已有有限专项证据，其余故障和容量仍逐项待验。

## Bootstrap 与外部能力资源边界

1. **职责与范围**：Bootstrap负责模块安装、维护替换和关闭；
2. **子功能与目录**：沿用bootstrap与platform/{ai,blobs,browser,delivery,isolation,mcp,network,packages}；
3. **依赖方向**：Bootstrap只读模块register/public及技术契约；Service经Model使用技术能力，Platform不引业务对象。Operations最后关闭，以覆盖其他模块退出时发布的事件。
   具名cleanup_failed保留到Model；HTTP安全出口不传cause。
4. **入口与安装**：模块安装失败清理已安装owner；停止准入逐项尝试。维护绑定保存原HTTP origin取值，调用方修改原options对象不会改变后续替换的Cookie策略。
5. **数据、事务与并发**：业务SQL归属不变。Blob发布前复查取消；临时文件删除需目录同步，发布后失败保持io_unknown，清理未确认单独表达cleanup_failed。
6. **生命周期与失败**：独立释放实际调用放入Promise任务，同步抛错不跳过其余资源。Fetch取消reader与释放锁分别保留失败；Delivery保留HTTP主失败及释放失败，NotificationModel转为独立NotificationCleanupFailure；Service停止准入并结算当前投递unknown，结算失败保留双因果，关闭不能报成功。不重复关闭context，也不关闭共用浏览器进程。
   本节不扩大功能或部署前提。静态结果和逐文件证据归testing，真实外部依赖、取消和故障场景覆盖范围见测试入口及 PLAN。

## Targets 服务端最近连接

1. **职责与范围**：Targets 拥有保存连接的最近成功观测；测试、监控与已有会话恢复不记录。桥就绪不证明远端认证或画面成功。
2. **子功能与目录**：复用 connections 的 ConnectionService、ConnectionModel、ConnectionStorage、connection-sql/connection-schema；删除 desktop-target 的 markAttempt 全链。没有第二张历史表或客户端写历史路由。
3. **依赖方向**：Remote 经 Targets public ConnectionUsage 调用；Service 验证观测时间与基础值，Model 转换存储调用/失败，Adapter 独占 SQL。RemoteSessionService 在开启前取得只读配置身份，桌面复用实际授权的可信配置快照。
4. **类型与转换**：StoredConnection、内部 ConnectionSnapshot 与 Shared TargetConnectionView 各自持有必填 lastConnectedAt:number|null；存储、public、HTTP 与前端 Summary mapper 白名单投影，均使用 Unix 毫秒。Workspace 原有附件秒时间仍只表示运行时附件事实，不再驱动最近连接列表。
5. **入口与安装**：registerTargets 安装后端专用 connectionUsage，registerRemote 注入两个独立 PTY owner 与 DesktopService；GET /api/v1/targets/connections 和单项读取经既有认证接口返回持久时间。管理写命令不接受 lastConnectedAt；桌面签发返回 ticket 与仅在浏览器内存消费的连接参数。
6. **数据、事务与并发**：现有 connections.last_connected_at 唯一存储毫秒/null，同一 UPDATE 核对 id/version/created_at/type，仅在新时间更大时更新；不推进 version/updated_at，过期配置结果不覆盖新配置。持久时间仅接受毫秒或 null，后续单位转换由迁移脚本完成，运行时不按数值大小猜测秒时间。新建/导入/克隆为 null；备份原列覆盖不变，预检复用同一行解码和时间关系。
7. **生命周期与失败**：持久调用由原 opening 任务等待并参与关闭；写入失败进入原资源关闭和安全失败路径，已提交而后续交付失败不回滚历史。写入后 SSH 再检查 signal/accepting/isOpen，桌面再复查身份/配置/存活。未匹配或已有更新观测是无操作；不重新创建被删除记录、不自动重派建连。
8. **当前能力与验收**：前端成功挂钩只读刷新元数据，Store 不保留 recent Map 或 markConnected；现有搜索、排序、连接编辑视觉不变，无新增三语产品文案。静态及待验范围归 PLAN/E2E，重启、并发、真实 SSH/RDP/VNC 与存储故障未由编译证明。

## Targets 安全凭据读取

1. **职责与范围**：为正式连接编辑提供安全认证摘要，密码和密文不出后端；保持元数据与凭据独立写入用例。
2. **子功能与目录**：沿用connections的Service→Model→Storage→SQLite，不新增业务分发或额外数据层。
3. **依赖方向**：HTTP→Targets public→CredentialService→CredentialModel→独立Storage；Adapter只消费存储契约及Shared基础值。
4. **类型与转换**：应用CredentialSnapshot、存储StoredCredentialSnapshot独立定义；Model、public mapper及HTTP逐字段投影Shared TargetCredentialView，返回none/password/ssh_key引用。
5. **入口与安装**：GET /api/v1/targets/connections/:id/credential经既有Targets管理会话/事务准入，缺连接404；register安装原Storage/Model。
6. **数据、事务与并发**：单条LEFT JOIN取得连接version与凭据状态，无秘密解密；不新增迁移。前端要求与元数据读取版本一致再编辑；两次读取不冒充一个数据库快照。创建复用单项import原子事务，元数据与凭据更新各使用原版本CAS。
7. **生命周期与失败**：沿现有具名技术失败与安全HTTP映射；不存在与损坏数据分别处理，不将坏凭据当none。提交/交付unknown仍先只读核对，读取不触发写入或版本推进。
8. **当前能力与验收**：正式Connections表单已消费，真实读取/CAS/原子创建/清除及OpenSSH测试结果见testing；生产和C2运行协议未切换。

## 复制与移动的覆盖及路径防护

1. **职责与范围**：Files 的 copyRemoteEntries 统一持有 Workspace 与后台传输的复制计划、发布及移动后删源政策；Platform 原生 rsync 显式使用 `--ignore-times`，覆盖大小及修改时间相同但内容不同的普通文件。
2. **子功能与目录**：Files Model 从实际受信 SSH 握手公钥生成摘要，SftpFileResource 保存该内部事实；file-copy 负责路径重叠判断，NativeServerTransfer 唯一构造工具参数。
3. **依赖方向**：Files/Transfers Service → Files Model → Machines Model 与 Platform；Service 只消费应用 FileResource，公钥原文不进入 Service、Shared 或前端。
4. **类型与转换**：FileResource.serverKeyFingerprint 在 files/model/file-types.ts 定义为必填内部字段；Model 将握手公钥转为 SHA-256 摘要，全部资源构造和夹具同步，无协议或数据库变更。
5. **入口与安装**：Workspace transfer.copyMove 与后台发送共用 copyRemoteEntries；原连接身份相同，或实际受信服务器密钥相同，均在首次写入前规范源父目录、解析最近已存在的目标祖先并检查整批路径。相同密钥只用于保守拒绝，不据此授权跨连接 rename 或静默 no-op。
6. **数据、事务与并发**：规范位置相等或有祖先/后代重叠时拒绝，保留原同连接同文本路径 move 的 no-op；预检不创建目录或额外探测文件。SFTP 私有上传 stage 与原生传输私有凭据/known_hosts 暂存仍由原 owner 管理，不改为直接覆盖写入。
7. **生命周期与失败**：沿原任务取消、独立资源释放和未知结果围栏；移动仍在目标确认后复核来源再删除。预检不是路径快照或原子隔离；克隆主机复用密钥可能被保守拒绝，不同密钥、chroot、bind mount 或共享存储别名不能仅由握手和 SFTP 路径完整判定；元数据不证明字节不可变。
8. **当前能力与验收**：源码覆盖双入口与全部资源消费者；正式用例覆盖等大小/时间的复制和移动、重复连接/源父目录符号链接及递归目标拒绝、同连接 no-op 和不同密钥同名路径。静态与未运行的行为范围分别见 testing 和 PLAN，不将预检表述为完整物理文件系统身份检测。

## Remote 后台服务器传输

### 1. 职责与范围

保留五管理 HTTP 和源端直传；不把 SFTP Workspace copy/move 当作替代。

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

## 后端诊断日志

1. **职责与范围**：Platform logging 负责结构化诊断，Operations 负责持久阈值及审计；诊断不能改变业务成功、失败或恢复结论。
2. **子功能与目录**：沿用 `platform/logging`，安全投影和异步关联上下文在该目录；各原 Service/Adapter 记录真实生命周期。
3. **依赖方向**：Bootstrap 创建一个 Logger，注入 Operations、网络与业务 owner；无模块反向依赖或全局可变 Logger。
4. **类型与转换**：复用 Logger/LogFact，诊断字段仅显式标量；异常只提取有限代码、类型、源码位置及有界 cause 链，不打印原文、请求或供应商对象。
5. **入口与安装**：createApp 向安装与恢复后的模块传递同一实例，main 在配置读取前启用；原设置接口管理同一实例的日志等级。
6. **数据、事务与并发**：日志写 stderr 单行 JSON；不增加数据库记录或改变事务。HTTP/WS 使用后端生成关联 ID，异步上下文随实际任务传播；事件回调只绑定诊断自身上下文，不捕获其它 owner 的事务或授权作用域，不信任客户端自报关联字段。
7. **生命周期与失败**：记录启动、停机、恢复、入场、派发、结算和清理；WS 字节汇总避免逐帧日志。诊断输出失败不阻断原任务，原异常继续由原 owner 处理。
8. **当前能力与验收**：等级、字段、查看方式及保护范围见 USAGE；源码审核和静态证据归 PLAN，行为按 D17 留远程验收。

## 成熟技术库边界

1. **职责与范围**：安全算法、MIME/图片格式识别及版本比较委托成熟库；应用权限、事务和任务政策保留原owner。HTTP 路由采用上文 Fastify 运行时；WS 与应用维护规则由原 owner 持有，未引入 Zod。

2. **依赖方向**：otplib/Formidable/file-type/fast-xml-parser仅Adapter消费；
3. **类型与转换**：TotpPort维持同步verify；ImageInspector.inspect与MultipartPart解析返回Promise，Model和四个HTTP producer同步await；原MIME/格式投影、失败与白名单不变。
4. **入口与安装**：Bootstrap沿用原Port安装。TOTP使用20随机字节的Base32、SHA1/6位/30秒/前后30秒容差，now从毫秒转秒；二维码URI由otplib生成。
   所有onPart都由Adapter接管原始字节，不调用默认文件处理器，无临时磁盘文件。解析原始/中间缓冲零化，返回part归producer清理；备份保留被交接的content。node-semver版本范围同步Shared及全部签名包消费者。
5. **生命周期与失败**：解析前后复查signal，异常转HttpInputFailure并保留cause；真实请求socket不交给解析器，有界Readable源显式destroy。图片识别异步后仍走原身份/版本/取消准入；SVG关闭实体处理，格式识别不证明内容安全。生成图片继续只接受PNG/JPEG/WebP。
6. **当前能力与验收**：源码已迁移；静态与远程待验范围见testing。Docker仍通过原MachineCommandExecutor/SSH执行CLI，没有API socket能力，不装Dockerode或更改远端前提。

## WebSocket 传输保活

1. **职责与范围**：Platform HTTP listener 为已接纳的所有 WebSocket 发送标准控制帧，减少代理空闲超时；业务心跳、权限复查及挂起租约仍归原 owner。
2. **子功能与目录**：复用 `platform/http/http-server.ts` 的 `activeSockets`，覆盖 channel 与 connectedRaw，不增加业务接口或第三方库。
3. **依赖方向**：使用现有 `ws` 的 Ping 和浏览器原生自动 Pong；前端及 Remote 不新增依赖。
4. **类型与转换**：控制帧由 ws 处理，不进入应用 message 队列；Shared/HTTP/WS JSON 契约不变。25 秒是 Platform 传输策略。
5. **入口与安装**：listener 成功监听后创建唯一周期 timer，枚举原 activeSockets；原始 RDP/VNC 路由即使更换 socket 事件监听，也不影响此 owner。
6. **数据、事务与并发**：无持久化；只向 OPEN 且无待发送缓冲的 socket 发 Ping，拥塞时已有输出承担保活，不堆积额外控制帧。
7. **生命周期与失败**：timer unref，维护暂停时不发送，恢复后继续；close 同步清 timer，关闭中的 socket 跳过。发送异常记录 WS_KEEPALIVE_FAILED 并终止原损坏传输；不因漏收一次 Pong 判定失败，不改变原 SSH 会话存活策略。
8. **当前能力与验收**：源码覆盖统一 channel/raw 入口；静态证据及真实代理空闲、后台/休眠、拥塞与维护关闭待验范围见 testing，不把保活表述为休眠仍在线保证。

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

### SSH交互输入的小包延迟与授权检查

1. **职责与范围**：减少远端真实回显路径的额外等待，保持原UI、终端字节语义与背压；不引入本地预测回显。
2. **子功能与目录**：Platform ssh2/ssh-route负责TCP策略，Remote interfaces/ws/workspace-files负责请求授权入口。
3. **依赖方向**：直接复用Node net的noDelay及ssh2公开setNoDelay，Service/Shared不持有厂商客户端。
4. **类型与转换**：无新协议、应用、存储类型；原严格解码及owner映射保留。
5. **入口与安装**：代理TCP创建时指定noDelay；每个SSH客户端ready后启用setNoDelay，直连跳板也覆盖，forward channel继承其外层TCP策略。
6. **数据、事务与并发**：terminal.input/resize经requireTerminal完整授权，flow按原pending-resume规则完整授权；这三个操作跳过dispatch外层的重复校验，其它操作继续原围栏；不缓存身份或授权。
7. **生命周期与失败**：权限撤销、挂起租约到期及attachment变化仍由allowed检查；SSH选项设置失败沿原catch销毁客户端，连接阶段统一保留原资源owner与取消收敛；不改发送顺序、输出窗口和消费ACK。
8. **当前能力与验收**：源码及静态证据见PLAN/testing；没有实测数据时不承诺具体毫秒改善，TCP策略对已有连接不追溯生效，须新建SSH连接；高RTT下真实回显仍需网络往返。

## Access OIDC

### 1. 职责与范围

Access 持有单提供方配置、已有管理员的 issuer + subject 绑定及短期认证流程；不按邮箱自动认领身份。openid-client 负责 Discovery、Code + PKCE、state/nonce、ID Token 签名和声明校验。OIDC 是独立登录方式，本地 TOTP 属密码登录流程；启用强制 Passkey 的账号不允许 OIDC 登录，提供方负责其自身多因素策略。

### 2. 子功能与目录

`access/oidc/{model,service,storage,adapters/sqlite}` 持有配置和流程；HTTP 在 Access 既有 interfaces/http；Platform security 的 OIDC Port/Adapter 隔离 openid-client。

### 3. 依赖方向

HTTP → Service → Model → storage/Platform；SQLite Adapter 仅消费 storage 契约和同模块存储能力。Service 复用 Access 密码证明；事务内再验证原会话。

### 4. 类型与转换

Shared access/oidc归属设置、启动和完成协议，不含旧显示开关；公开登录选项归Shared access/http。Interface 逐字段映射应用类型；Model 转换存储事实、秘密及技术请求；库配置和令牌只留技术边界，不回传浏览器。

### 5. 入口与安装

Bootstrap的`oidc-environment.ts`严格读取部署变量，经Access register安装契约逐字段转换为OidcInstallation；不把环境变量解析放入Service或SQLite。OidcModel在模块启动时应用可信部署配置，空库延后到管理员存在后的首次OIDC事实读取；同一owner共用初始化Promise，无定时轮询。缺少主体时只保留同一Issuer/Client已有绑定，绝不绑定首个未认证用户。相同配置不写入，变化在原configure事务内更新revision并撤销OIDC会话/流程；未知初始化提交保留拒绝，不自动重放。本次无schema变更。

Access register 安装 OIDC；认证入口含公开提供方状态、登录启动/完成，管理入口含设置读取/保存、绑定启动/完成和解绑。固定同源 `/login/oidc/callback` 返回 SPA，立即移除敏感查询后同源 POST，保持现有 CSRF/Origin 检查。

### 6. 数据、事务与并发

迁移v4建配置、流程和OIDC会话归属表；v66删除独立enabled列，已验证绑定直接决定入口显示，配置/秘密/会话保留；不改已执行迁移。配置 CAS、会话及密码版本、来源封禁、绑定、到期在实际提交事务复查。独立 HttpOnly Lax Cookie 绑定浏览器；PKCE、nonce、state、配置版本及固定回调绑定流程，回调先以 consumed 标记单次认领，事务最终提交前仍须存在且有效；退出/新流程能删除已经认领的流程，阻止迟到签发。变更配置/解绑清理流程并撤销关联 OIDC 会话，普通登录不受影响。秘密使用现有 SecretBox；认证表排除快照导入。

### 7. 生命周期与失败

流程沿用五分钟期限，过期惰性清理，无额外周期任务。网络调用跟随请求断开和原流程到期取消，库默认网络超时仍生效；不重放 code exchange。配置、授权、颁发在外部验证后复查；会话交付复用 deliverAccessResult，断线未交付则撤销。未知提交保留 operation_unknown，不自动重试写入。

### 8. 当前能力与验收

Passkey 名称、登录布局与 OIDC 已实现；协议、存储与浏览器专项通过，具体范围以 testing/HISTORY 为准。验证真实签名、PKCE、nonce/state、浏览器绑定、未绑定身份拒绝、过期/重放/配置变更、撤销及迁移，不用单独 mock 库验证替代协议链。

## 常驻缓存与公开登录选项

1. **职责与范围**：Platform的`cache/resident-cache.ts`封装已维护的`lru-cache`原生异步fetch/去重/删除取消，每个实例持有一份只读快照，不提供全局无限键注册表。Access的`login-options/model`拥有公开登录方式快照及失效政策；认证、会话和权限仍读取当前存储，不使用展示缓存授权。
2. **子功能与目录**：ResidentCache提供read、invalidate、quiesce、close。LoginOptionsModel组合OidcModel公开名称与FactorModel注册状态；验证码公开配置仍从CaptchaService的启动生效内存投影。单份快照的一个槽位是对象语义，不是业务数量限制；无需TTL、轮询或新定时器。
3. **依赖方向**：HTTP→LoginOptionsModel→同模块OIDC/Factors Model；后者仍经原storage/Adapter读取。通用缓存不依赖Access、SQL、Shared或Bootstrap。register装配变化回调，实际写入owner发布失效，不由HTTP路由维护缓存。
4. **类型与转换**：内部LoginMethods归login-options/model，Model对缓存结果逐字段复制，防止消费者改写保留值；HTTP将其与验证码配置逐字段映射为Shared AccessLoginOptionsResponse。缓存只保留名称/null与布尔状态，不保留会话、密钥、credential ID或认证结果。
5. **入口与安装**：公开GET `/api/v1/auth/login/options`一次返回验证码、OIDC与Passkey展示信息，旧独立OIDC provider、Passkey discovery和CAPTCHA端点移除。RegisteredAccess加入模块quiesce/close编排，初始化失败、正常退出、快照恢复替换均关闭旧实例。
6. **数据、事务与并发**：首次并发读取共享同一load，false/null也保留；OIDC公开读取使用单条关联SELECT，Passkey使用既有存在性查询。管理员创建、OIDC部署配置变化/保存/解绑/绑定完成，以及Passkey注册/删除在持久操作结束后使快照失效；提交未知同样失效，下次只读确认，不重放写入。改名不影响注册存在性，无额外失效。后续新增影响入口的政策写入必须接入同一通知；直接绕过应用写SQL不属于热更新接口。
7. **生命周期与失败**：失效清除值并取消旧fetch，generation阻止旧成功/失败回填；原读者加入当前代。当前读取失败不缓存、不返回旧值，下次访问可恢复。请求不把自身signal传给共享fetch，避免一个访问者中断其他人；模块关停停止新读、清空快照并排空仍在运行的底层读取，close共享Promise。恢复重建新缓存，不跨实例/数据库保留值。
8. **当前能力与验收**：OIDC绑定即显示，Passkey注册即显示、最后一个删除后隐藏，相关UI行为已授权；其余登录布局保持。通用缓存并发/失效/失败/关停、真实OIDC写入/未知回执、真实WebAuthn注册/删除与HTTP缓存命中覆盖范围及实际耗时见testing。没有同负载端到端测量时不宣称登录QPS提升比例。

Native 实现使用 Node 文件能力、UTF-8 数据文件和定长索引，支持有界追加、字节分页和真实空间不足等待；装配在数据库同级 `tool-logs`，Job Service 决定何时回收，未知执行不重放。本轮无新增数据库迁移；当前 JSON 备份不含完整日志，数据卷迁移需保留该目录。

## SQLite 状态组合与写入观测

1. **职责与范围**：Platform SQLite 只管理真实事务、排队和 Worker；Operations 的审计与通知持有自己的待处理记录。
2. **子功能与目录**：`sqlite-runtime.ts` 提供 `composeTransaction`，`sqlite-statistics.ts` 保存常量空间计数；`scope/adapters/sqlite/thread-sql.ts` 以 `withState` 使用组合。各领域 SQL 和迁移留原 Adapter。
   状态内的子领域 Adapter 参与同一执行器。
3. **类型与转换**：组合执行器和耗时归 Platform；身份与状态仍沿各自 Model 转换。System 将累计排队/执行/提交次数、总耗时和最大耗时投影到 Shared 诊断指标，毫秒取整，不记录 SQL、参数或身份。
   普通写入仍用 `transaction`，普通嵌套事务仍拒绝。迁移继续由 `bootstrap/schema.ts` 顺序安装。
4. **数据、事务与并发**：显式组合只占一次排队和一次提交；身份在事务前后复查，所有参与者共享快照。审批读取的惰性过期写入参与原事务。迁移 10 新增通知 pending 表并转换尚无 fanout 回执的审计记录，已发布迁移不改写。审计新增与 pending 同事务，fanout 回执与 pending 删除同事务；快照验证 pending/processed 恰好分割保留审计，恢复时抑制历史通知。并发发布共用裁剪任务，裁剪只删除已分发记录。
5. **生命周期与失败**：参与者失败即使被上层捕获也阻止提交；未等待的参与工作先收敛再回滚，失效 scope 的迟到访问拒绝。提交未知保持原数据库不可用围栏，不自动重试；组合不授予独立后台工作临时权限。发布与清理仍由 AuditEventOwner 跟踪至关闭完成；请求和发布集合按实际任务增长，不叠加独立数量门槛，quiesce 后拒绝新请求，已接纳请求仍可发布其审计。
6. **当前能力与验收**：`tests/backend/platform/sqlite/storage/performance.native.test.mjs`由Node原生测试直接执行，覆盖升级、回滚、撤权、迟到参与者、通知恢复及同秒历史保留。排队耗时包含前序任务等待，执行耗时包含整个操作与提交，commit 统计提交尝试（含失败）；它们不等于逐条 SQL 耗时或线上性能提升比例。实际执行证据见 testing。
