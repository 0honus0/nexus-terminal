# Nexus Agent 架构设计

版本：2.0。范围：Agent Runtime、AI Platform、App Platform 与 Nexus 的集成设计；实现细节见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。本文描述设计，不表示代码已经交付。当前以 ARCHITECTURE.md 与 IMPLEMENTATION.md 作为 Agent 设计唯一规范源，不保留独立 Review 文档。

## 1. 产品边界与三期范围

当前是单管理员产品：沿用 session.userId 的整数类型，不新增 tenant、组织、角色体系。App 是数据与能力隔离边界，不是多用户功能。nexus.operations 随发行版默认 enabled；没有 Provider 时 health=degraded，展示配置引导，不影响原 Workspace、连接管理或远程桌面。

Agent 默认可以选择全部当前及未来连接；全局 connection denylist 优先拒绝，审批不能覆盖。此默认值只影响目标可访问性，不意味着全部动作免审批。第三方 App 还必须获得 manifest 所声明的 capability grant。

| 阶段 | 实际交付 | 不交付 |
| --- | --- | --- |
| Phase 1 | 静态 App Host、Operations、Provider 配置、Thread/Run/流式会话、只读诊断/文件读取、Artifact、只读 Recall、内置 Skill、Launcher/Hub、恢复与审计；环境 availability API/前端占位说明 | 真实环境容器、远端 mutation、动态插件、MCP/ACP/CDP、多 Agent |
| Phase 2 | Policy/Approval/Lease 完整修改闭环、文件变更、受审批 Shell/远端 Docker、独立 EnvironmentController 与 shell/code/data 环境、UI/AI 启停删、checkpoint、环境配额/固化 | 浏览器自动化和外部协议 Agent |
| Phase 3 | Browser/CDP、MCP、ACP、多 Agent、经审核 Memory 写入、安装式 App/Skill、独立来源 iframe UI | 任意上传代码在 Backend 内执行、无限自治或绕过审批 |

“Agent Runtime Docker”是发行能力名称；代码实体只使用 AgentRuntime、EnvironmentGroup、ExecutionEnvironment，不使用含混的 Docker RuntimeSpec 或裸 /api/v1/runtime。Phase 1 的 EnvironmentAvailabilityPort 是真实设置页面的消费者，生产返回 unavailable；测试替身仅在 E2E 组合中注入，不创建无人消费的未来空实现。

适用工程边界引用 [EC-REQ-001、EC-ARCH-001/009、EC-RUNTIME-003/004/005、EC-E2E-001/002](../../software-requirements/engineering-constraints.md)。已定义正式契约不等于已实现产品。本轮按Owner要求只修改本agent目录，尚未同步软件需求/FR/SRS；需求同步保留为后续正式开工闸门，不修改或弱化OWNER约束。未来拆分位置仅在实施文档§13规划，不在本轮执行。

## 2. 分层、源码 owner 与设计理由

~~~text
App.vue → features/agent/host → 当前 App contribution
                     ↓ Agent HTTP / SSE
interfaces/http/agent
                     ↓ 注入的 use cases
modules/agent/
  host          App 安装/启停/grant/SDK，不能调用某 App 私有实现
  runtime       Run/参与者/Harness/调度/Event/Checkpoint
  ai            Provider/Conversation/Context/Artifact/Recall/Skill/Tool catalog
  capabilities  检查/授权/Policy/Approval/Lease/目标/机器 facade
  environments  执行环境控制用例与 ports
  apps/operations  仅运维定义、工具与业务策略 contribution
                     ↓ typed ports
既有 Modules diagnostics/connections + Platform execution/filesystem/docker
                     ↑ adapters
infrastructure/agent/{repositories,providers,artifacts,environments,integrations}
bootstrap/agent/compose-agent.ts 是具体依赖组装入口
~~~

通用 Harness 归 runtime，不放 ai/harness 或 apps/operations；AI 层只提供模型和上下文服务，不反向依赖 Run 调度。Policy、Approval、Lease 属于共享 capabilities，Operations 只提供风险分类和 verifier。HTTP/SSE 控制器统一在 interfaces/http/agent，不放 App domain。SQL、SDK、网络客户端只在 Infrastructure。

依赖图固定：apps → runtime/ai/capabilities/host 的 public 契约；runtime → ai/capabilities/environments/host 的 ports；capabilities → host 的授权契约和既有机器能力；environments → host 契约；ai → host scope 类型；host 不反向 import apps/runtime。环境控制 action 的安全编排通过 capabilities 注册的 Tool 实现，避免 environments 与 capabilities 循环。跨 App 不准私有 import。Infrastructure 只 type-import module 的 *.types/*.port；Bootstrap 导入具体类。前后端 architecture checker 都要检查 Agent 子目录，而不只检查顶层 feature。

前端集中于 features/agent/{host,api,ai,runtime,settings,environments,apps/operations}；公共会话/事件 store 归 runtime，Agent宿主设置归 settings，Operations UI 通过 facade 使用。独立容器程序放 packages/agent-runtime；Docker 构建/运维辅助文件仅放 scripts/docker/agent-runtime。内置 App 不另建 npm workspace package。

## 3. 实体、作用域与资源关系

~~~text
App → Thread(0..N) → Run(0..N)
Run → AgentRuntime(1..N；前两期为1，三期可按 delegation 动态增加参与者，执行并发统一受 maxConcurrentRuntimes 调度)
AgentRuntime → EnvironmentGroup(0..1) → ExecutionEnvironment(0..N)
Run → Step → ModelAttempt / ToolCall → Approval(0..N历史，最多1个有效请求)
Run → DurableEvent、Checkpoint、ArtifactRef
Thread → LedgerEntry → UserInput / Message / ToolResult引用
~~~

Thread 可为空；同一 Thread 同时只有一个非终态 Run。Run 是预算、计划、取消和结果边界。AgentRuntime 是 participant 的一次执行身份，拥有独立模型引用、AbortSignal、execution owner；不等于进程、窗口或容器。Resume 创建带 parentRunId/checkpointRef 的新 Run，不复活旧执行栈，因此每 Run 的 participant 唯一约束不会与重启历史冲突。

EnvironmentGroup 只聚合所有权、总配额和环境列表；Harness 在 Backend，不再创建 control environment。环境种类为 shell/code/data/browser。同一组的不同环境仍独占容器，不共享 cwd、浏览器 profile、网络 namespace 或凭据。其他参与者通过显式 Artifact grant 交换结果，不能直接获得环境 handle。

userId/connectionId 沿用整数；Agent 实例 ID 使用 node:crypto.randomUUID()；appId 为稳定 namespaced manifest 字符串。数据库时间使用整数 epoch seconds，HTTP/SSE 转 ISO 8601；计时器使用单调时钟，毫秒参数须以 Ms 命名。App 数据查询必须携带服务端推导的 userId/appId；父子复合 FK 与 repository scope 检查共同防止串 App，用户提供的 owner 字段不能授权。

ExecutionSession ownerType='agent'，ownerId=agentRuntimeId。Workspace 继续拥有自己的 ExecutionSession；只共享机器能力代码，不共享实时连接、PTY/SFTP/上传 socket/cwd。关闭 AgentRuntime 只 closeByOwner('agent', agentRuntimeId)。

## 4. App Platform 与插件机制

### 4.1 Manifest、Registry 和生命周期

manifest 唯一来源 modules/agent/apps/<slug>/app.manifest.json：schemaVersion=1、id、semver version、displayName、sdkVersion、nexus.minVersion/maxVersion、capabilities、intents、资源相对路径。id 正则为 ^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$。拒绝未知版本/能力、重复 id/intent、路径穿越、符号链接越界、非法 semver 和不相容版本。

Backend public.ts 导出 factory，Bootstrap 静态注册；Frontend 同 App id 的 public.ts 导出 lazy contribution。服务器只返回安全 manifest view，不返回 factory 路径、安装目录或代码 URL。静态 JSON 使用 TypeScript resolveJsonModule 导入，由 production build 验证 dist 文件，不 runtime 猜测源码目录。

register 仅注册内存定义；持久化 desiredState 与 observedState 分开。初始化首次默认启用 Operations 的记录用 insert-if-absent，不能覆盖用户后续停用选择。enable 检查版本/grants 后 initialize/health；disable 先禁止新命令，再取消运行并等待收敛，最后 dispose，数据留只读入口。超时保持 disabling 并报原因，不伪称 stopped。授权撤销提升 policyRevision，后续模型/工具/环境访问重新校验。

### 4.2 SDK 与 App 隔离

SDK 仅暴露 scope-bound ai、runs、machine、environments、storage、events、settings；所有方法由 Host 绑定 appId，不允许调用者覆盖。SDK major 不相容拒绝启用，minor 只增可选能力；每个 capability 单独 schemaVersion。grant 只能是 manifest 声明能力上限的子集；模型提示、Skill、Recall、MCP 返回都不能扩大 grant。

AppStorage 使用 (userId,appId,key)，单 value 64 KiB、单 App 16 MiB，CAS version；禁止插件自建 SQL 或读取其他 App 表。默认 Operations 声明 read capabilities；Phase 2 加入 mutation capability，由用户可见的版本升级/grant 更新一次确认启用，之后每个修改仍按 Policy 审批。目标全集默认不被这次 capability 确认改成连接 allowlist。

新增静态 App 只增加两端 agent/apps/<slug>、后端组合表及前端 builtin-apps.ts；不改顶部导航、路由器的 App 私有逻辑或 Operations。用第二个最小 reporting App E2E 验证此边界。

### 4.3 Phase 3 安装式扩展与跨 App 交接

包由 manifest、SHA-256 文件清单、Ed25519 签名、入口和静态资源组成；可信 publisher key 由用户显式导入。拒绝未签名包、路径穿越、压缩炸弹（压缩包50 MiB、展开200 MiB、1万文件）、设备文件与外链。代码存 NEXUS_DATA_DIR/agent/plugins/<appId>/<version> 不可变目录；可变数据只用 AppStorage/Artifact，不给插件 hostPath。

升级：stage→校验→暂停该 App 新 Run→等待旧 Run 终态→导出 AppStorage 快照→隔离新版本迁移→health→原子切 activeVersion。迁移失败恢复 snapshot/旧 pointer；不声称能回滚已发生的远端副作用。停用不卸载；卸载代码不自动删数据；deleteData 是独立高风险用户命令，先处理 Artifact 引用与审计。安装式 App 的 Backend 代码不得在 Nexus Backend 内 eval/import 执行，必须进入可停止、可限权的隔离执行单元，只能经 scope-bound SDK/RPC 访问 Host 能力；隔离执行单元不可用时动态 Backend App 明确 degraded/unavailable，不降级为进程内执行。具体 worker 容器/进程与 IPC 生命周期在 P3-C 实现时冻结，隔离 worker 崩溃不得影响 Backend。

AppIntent 只传 schema-validated 小 JSON/ArtifactRef：发送/接收双方 manifest、当前 grants 和目标 App 状态均检查；用户确认交接后创建 receiver grant，原 Artifact owner 不变。grant 可撤销、有 TTL，不带 SSH handle、secret 或完整私有历史；接收 App 再执行工具时重新授权。

动态 UI 由独立 plugin-ui origin 提供，不开放 Backend 全局 X-Frame-Options。该独立源只服务已验证静态包，无 Nexus cookie/API 代理；CSP frame-ancestors 精确 Nexus origin、default-src 'none'，脚本/样式按包 hash 放行。iframe sandbox 默认 allow-scripts，不给 allow-same-origin、导航、下载或表单权限。父页面以 event.source + 一次性 nonce 建立 MessageChannel；因 opaque origin 为 null，不能仅凭 origin 判断；初始化的 targetOrigin='*' 只传 nonce/port、不含业务数据，之后只走绑定 port。RPC 请求仍在服务端检查 app/session/grants，消息大小64 KiB，序号和10秒超时，卸载关闭 port。

## 5. Harness、模型与节省 Token

借鉴的是公开可观察的 Agent 模式：工具循环/审批沙箱、渐进 Skill 加载、可恢复会话、工具结果裁剪、外部协议适配。Codex、Claude Code 等产品不能一概称为全部开源；“Grok Build/DeepSeek Harness”在未锁定仓库/许可证/commit 前不作为可复制代码依据。本方案不依赖任何这些实现的私有接口，后续引入代码必须另记来源与许可证。

Native Harness 的固定流程：持久化输入→构造预算上下文→模型 attempt→持久化完整 proposal→inspect→授权/Policy→审批→lease→执行→结果处理→验证→提交事实→下一 step。Planner 输出目标、步骤和成功条件，不持久化隐藏思维链。Verifier 只根据用户目标和可追溯证据给 verified/unverified/failed；模型自称完成不算独立验证。

首发一个 OpenAI-compatible Chat Completions HTTP streaming adapter（含 OpenAI preset），统一 LanguageModelPort.stream；Anthropic adapter 三期增加。模型配置包含真实 contextWindow/outputLimit/tool 支持能力，工具能力不支持则 model-only，不臆造 tools。Provider 仅由用户设置；密钥用既有 SecretCipher 加密保存，API 只返回 hasCredential，日志禁止 request body/authorization。

公网 HTTPS 默认允许；私网默认拒绝，用户可在设置里逐个配置准确 host:port 例外并看到风险提示。HTTP 仅显式开发模式的 loopback；云 metadata、link-local、组播、未指定地址始终禁止。DNS 全部地址先校验、连接固定本次校验地址并保留 TLS SNI；禁止重定向（3xx 失败），防止跨目的地址泄露凭据。模型不能修改 endpoint/allowlist。无 Docker 和无模型均不导致 Core startup 失败。

Context 分稳定前缀（安全/工具协议）、半稳定任务计划和动态尾部；按目标选最多12个工具 schema，Skill 先加载 metadata、最多3个 body/总12 KiB。工具输出先脱敏、摘要再进上下文，大对象放 Artifact。原始输入留 ledger；旧输入在上下文可被带来源范围的增量摘要替代，但当前未消费用户输入和安全/授权状态必须保留。摘要按 thread sequence 区间+sourceHash+model 配置版本缓存，只追加新范围，不能重复摘要同一区间。

Token 以每次 request input+output 累计，包括重试、cached input 和失败调用的保守估计；不是仅计算新增文本。Context 输入上限 min(32000, modelWindow-outputReserve)，估算额外预留15%；每次调用前同时预留输入和最大输出，完成后按 usage 结算。usage 缺失用保守上界，不当作零。价格来自版本化配置，以 integer micro-USD 存储；未知价格返回 null，不伪装免费。设置了 cost budget 而价格未知时禁止开始。用户可调的 Run token/step/active-time/cost 都是**软预算**：下一步预留会越过当前预算时不把 Run 判失败，而是在安全边界进入 `awaiting_budget`、释放执行/model/tool slot并提醒用户；只有用户显式提高**本次 Run**预算后才继续。Agent Settings 同时提供管理员可配置的 Hard Limits，作为本实例对 Run/并发/环境资源的最终策略上限；普通 Settings 上调不自动放大已运行 Run。Hard Limit 提高必须二次确认，确认界面显示旧值→新值、可能增加的模型成本/CPU/内存/磁盘/并发压力及当前资源状态。模型真实 context/output 能力、Docker/宿主实际可分配资源和协议/数据库固定 guardrail 是运行事实或正确性约束，不再形成第二套配置层；超出真实能力时该次操作明确失败或降级，不悄悄套用其他资源上限。

Agent Settings是宿主级配置中心，不只配置模型。UI分为模型与Provider、执行与性能、预算与上下文、Hard Limits、Subagent、Artifact与存储、Environment、安全与网络等小模块，并提供只读系统保护页。软预算显示requested/effective，Hard Limits模块允许管理员配置本实例的Run/并发/Artifact/Environment资源上限；任何提高都必须经过二次确认。数据库/event/SSE正确性guardrail保持只读，模型真实window与宿主当前资源作为运行时能力直接展示，不再作为另一层Hard Limit。模型并发默认`auto`跟随当前有效AgentRuntime执行并发（默认2），用户可主动降到1等更保守值；实际模型请求仍受Provider自身限流/能力影响。

只缓存只读工具：key 包含 app、target fingerprint、规范化参数、观察版本、工具版本，TTL 最多5秒；命中仍计 Run step 并重新授权。修改成功或未知结果立即失效相关缓存；不缓存 mutation、审批或凭据。每个 model/tool/verification/delegation 都计入统一 `maxRunSteps` 软预算；连续3步无新增证据或相同失败签名连续3次由 loop guard 阻止继续自动换方法。软预算耗尽只暂停询问用户，Agent Settings Hard Limits 和 loop guard 才是无限运行的最终保护。评测同时比较任务成功率、验证率、Token 与恢复率，不能只用省 Token 掩盖失败。

## 6. 安全执行、竞争与远端不确定性

唯一 AgentTool 接口为 descriptor/inspect/execute/verify；inspect 无副作用，execute 只收已经复查的 ToolInspection。共享 ToolExecutor 控制所有安全步骤，工具不能自行省略。

operationHash 使用版本化 canonical JSON 的 UTF-8 SHA-256，包含 actor scope、tool/version、target fingerprint、normalized arguments、secret 引用版本、policyRevision 和前置条件。具体编码与测试向量见实施 §5。Approval 绑定精确 hash，600秒有效；前端 hash 只是 UI 对齐，服务端复算。approval resolve 与 execute 前都复查；网络 inspect 在事务外，提交用 version/policyRevision/hash CAS，不能拿 DB 锁等待 SSH。

Policy 顺序：App enabled/grant→连接存在及 denylist→硬禁止→read allow/修改审批。Phase 1 任何 mutation 返回 CAPABILITY_UNAVAILABLE。Phase 2 结构化文件/服务/Docker 修改都审批；Shell 优先受限 argv catalog，未知 shell 文本一律审批，deny 模式先于审批；不把正则识别当 sandbox。远端 Shell 使用目标用户本来的系统权限，必须在 UI 提示不是容器隔离。

Lease 30秒、每10秒续约；读共享、写互斥，resourceKey 不含 caller/App。第一版所有修改获取 target 根 write lease，所有读取取 target 根 read lease，子路径 keys 用于审计，避免目录/子文件锁不相交。targetIdentity 由受信 SSH host key+规范化 endpoint 推导，连接别名可显式映射同一 target；无法判定的别名/外部终端并发不能声称已互斥。

Workspace typed mutation 通过注入的共享 MutationGuardPort 接入同一 lease provider；Platform 不依赖 Agent 模块。Workspace 交互终端和外部 SSH 无法受此锁控制，界面注明，文件操作额外比对 hash/metadata，仍不声称远端任意工具有原子 CAS。Agent 不自动覆盖观测到的外部修改。

Lease 过期只说明持有人失联，不说明远端作业已停止：已 started 的 mutation 对应 resource quarantine 保留，阻止下一次写，直到 reconciler 验证终止/结果或用户带证据确认解除。fencing 序号只对能校验的 Controller/本地 Gateway 有效，不能保证远端普通 SSH 命令受 fencing。取消/超时先拒绝新步骤，再请求中断；结果未知为 interrupted + needsReconciliation，不标 cancelled 成功，不重放 mutation。

## 7. 状态、事件和恢复

Run 状态唯一为 created/running/awaiting_approval/awaiting_budget/cancelling/completed/completed_unverified/failed/cancelled/interrupted。终态不原位重启。正常问答可 completed_unverified；运维有证据才 completed。ToolCall 的 reconciling 与 Run.needsReconciliation 表达远端未知，不复用 failed 掩盖副作用。

用户中途输入先 append ledger：模型 streaming 时 abort 当前 attempt、下个安全 step 合并；tool 已 started 则等其完成/核实，不强杀不可安全中断的修改；awaiting_approval 时 supersede 旧未消费审批，重新计划；awaiting_budget 时输入照常入 ledger，但不恢复执行，直到用户提高本 Run 预算或取消。按 consumedInputSequence 精确消费，不能把更新后的输入配给旧 proposal。

Model transport 最多重试2次（总3 attempts），仅超时/连接故障/429/502/503/504，退避1秒、2秒加0～250ms jitter，Retry-After 上限30秒。取消优先。完整 tool proposal 一旦提交，本 step 不因 provider 断流重新产生第二次 mutation。tool_call JSON 未完整结束不能执行；相同 step 的 operationHash 去重，跨 step 不凭 hash 永久禁止用户合理重复操作。

Durable events、领域投影、canonical message/ledger 与 Host summary outbox 在同一 SQLite transaction 提交；事件能重建运行投影，不替代 Provider/config/Artifact 文件等各自事实源。原有 DatabaseAdapter 全局串行，事务只做有界 SQL，不在其中做网络/模型/磁盘写。delta/tool output chunk 为 transient，没有 durable sequence/SSE id；重连丢弃草稿，从 snapshot/final 恢复。

当前单Backend/单scheduler部署继续以现有单连接SQLite为正式基线；默认 Runtime 软值2、默认 Hard Limit 4 是首轮已验证容量基线，不是不可突破的隐藏上限。用户可在 Agent Settings 二次确认后提高 Hard Limit，但设置页必须提示已超出当前验证基线并建议重新执行负载验收；只有进入多Backend、多用户高并发，或提高并发后在正确限流/batch/分页下仍无法满足DB queue wait与transaction p95目标时，才连同scheduler/claim/lease/idempotency拓扑一起重新设计数据库方案。

Run SSE id=runId:sequence，Host SSE id=host:userId:sequence，两个序列不混用。V1 不做自动 event compaction，Run 删除才级联清 run events；Host summary 是独立安全摘要，不含消息/工具 payload。游标校验、catchup、背压/心跳见实施 §7。

重启：停止接入→迁移→注册 App→重建非终态状态→全部未决运行收敛 interrupted→未完成修改进入 quarantine→启动订阅/调度。Checkpoint 只在无正在运行工具的安全边界保存 plan/input watermark/evidence/version；不存 live handle/secret 或可继续使用的 lease。Resume 创建新 Run、新 AgentRuntime、新执行资源，重新 inspect，旧审批失效，旧 mutation 不自动执行。

## 8. Artifact、Memory 与数据生命周期

Artifact 对象独立于容器：上传/工具输出先配额预留→私有 tmp 文件→流式字节统计/hash→fsync→同盘 rename→目录 fsync→metadata ready 与事件事务。数据库失败留下可对账孤儿；不能先 ready 后写文件。对象 ID 不由用户路径或全局 content hash 授权；跨 App 同内容不自动共享。

默认单对象50 MiB、工具原始输出10 MiB、单 Run256 MiB、单用户/全局2 GiB；未归 Run 的上传也算全局配额。磁盘至少保留1 GiB 可用空间，写入前/过程中检查，配额包括 reserved bytes；payload ready 后从 reserved 转 committed。工具输出超过 raw limit 截断并标 truncated，上传超过 limit 返回413并清 tmp。retain 不绕过全局配额。

未 retain 的 ready Artifact 在最后关联 Run 终态7天后可回收；无 Run 的暂存上传24小时回收；活跃 Run、跨 App 有效 grant、有效 checkpoint 引用保护内容。tmp 1小时后对账清理；deleted 用 tombstone，定时清理失败可重试。删除 Run 不隐式删除其他 App 授权持有或 retain 的对象。GET range 检查 owner/grant、单 range、max8 MiB，返回206/416；缺 payload 返回410 ARTIFACT_UNAVAILABLE 并更新 metadata，不500。默认下载 attachment+nosniff，HTML/SVG 不能在 Nexus origin 执行。

Agent Hub 提供长期存在的**文件库（Files / Artifact Library）**作为用户级管理视图，统一聚合当前用户在已授权 App 中的用户上传、Agent 生成结果、任务证据和保留的中间产物；它管理的是文件 bytes、来源、引用和生命周期，不等同知识库/Memory，也不单独引入“数据集”一级概念。列表按来源 App/Thread/Run、类型、大小、时间、retained/可回收状态过滤，支持搜索、快速预览、下载、回到来源、retain/unretain、删除和“引用到当前对话”。统一列表只扩大**用户可见性**，不扩大 App capability：某 App 读取另一个 App 的 Artifact 前仍必须由用户动作创建显式 run link/grant，不能因为文件库能看见就绕过 app scope。

文件库提供空间概览与安全清理：至少区分 retained、active-reference、reclaimable、staging/tmp 与 unavailable metadata；“清理可回收文件”先 preview 数量/字节/来源和被保护对象，再确认删除，仅处理无活跃 Run/checkpoint/grant 且未 retain 的对象。受保护对象不可被批量清理按钮强删，用户必须先解除对应引用或 retain；删除失败进入既有 deleting/reconcile 流程。大文件预览继续使用有界 Range/ArtifactViewer，不把完整文件加载到浏览器内存；文件库分页/虚拟化，不能因长期任务累计上万 Artifact 而全量挂 DOM。

Memory 一期只读检索；默认不自动写，不安装向量数据库。采用 SQLite FTS5（不可用时 bounded LIKE）与最近确认事实加权，最多5条/8 KiB，带 source/时间/scope/trust，注入为非指令。三期 AI 可提交候选，用户在审查 UI 确认后发布；每条有 source refs、置信度、expiresAt，撤销/源删除后不再召回。Skill 一期只读仓库内版本化 SKILL.md 与资源，限制路径/体积，不执行脚本；三期安装式 Skill 复用包签名与 capability 审批。

备份包含 Agent DB 表及既有格式加密的 Provider credential；默认不包含 Artifact payload、容器卷或插件代码。备份 API/UI 必须明确 exclusions；二期可选包含 ready/retain Artifact 的一致性快照。恢复缺 payload 标 unavailable，缺加密密钥 Provider degraded 且要求重新配置，不尝试明文降级。恢复后撤销所有 runtime tokens/审批，运行全部 interrupted；不能恢复正在执行的容器。用户数据恢复不视为继续授权旧作业。

## 9. Docker 扩展：Base Runner、环境包、隔离与还原

### 9.0 产品作用与持续管理模型

Docker 扩展是 Agent 的**本地隔离工作台**，不是远端 Docker 管理器，也不是第二套 Workspace。它用于在不把任意代码、依赖和浏览器进程放进 Nexus Backend/宿主命名空间的前提下，为 Agent 提供可重复、可限制、可销毁的本地计算环境。远端生产主机的读取/修改继续走既有 SSH/Platform capability、Policy/Approval/Lease；Environment 只处理显式导入的 Artifact、受控网络和受限 capability。

Docker 镜像采用**单一 Base Runner + 可安装 Environment Pack**，不为 Node/Python/Chromium 每个版本构建不同 worker 镜像。`nexus-agent-runner` 是唯一新增的 Agent Docker 服务，内部提供 Controller、Environment Catalog、Pack installer、Toolchain Store、Gateway/job protocol、cleanup/reconcile 和空间统计；它使用固定 Base Runner image 创建任务容器。Base Runner 是稳定“空壳”，只包含最小 OS ABI、Gateway/bootstrap/Artifact client、安全与挂载 API，不预装完整 Node/Python/Chromium/数据科学工具链。

从 Agent 扩展角色看部署只新增 `nexus-agent-runner`；当前仓库 compose 仍是 `frontend + backend + guacd` 三个容器，因此最小实施是再增加一个 runner 服务，不把 frontend/backend 合并作为 Agent 的隐含前提。未来若 Nexus 主部署另行合并 frontend/backend，不影响 Runner 协议和数据布局。

Frontend Environment Settings 是**长期可进入的 Environment 管理页**，初始化只是该页面在 `uninitialized` 状态下的首个工作流，不存在“初始化完成后向导消失”的独立入口。页面状态至少区分 unavailable / uninitialized / ready / degraded，并在同一入口持续展示 Runner 健康、Catalog、已安装 Pack、多版本启用/默认选择、空间占用和运行 Environment。首次进入时执行：探测 runner/engine/runtime capabilities → 展示 Catalog → 用户选择启用的环境用途和多个版本 → preview 下载大小、磁盘与资源影响 → 用户确认 → Runner 安装 Pack → readiness 检查 → CAS 保存设置。进入 ready 后仍可随时回到同一页面新增/卸载版本、并存版本、切默认版本、调整资源/网络、清运行残余、查看空间和恢复默认配置；初始化只准备 Base Runner 与版本包，不创建长期业务 Environment。

用途由 Environment Recipe 组合版本化 Pack：

- **shell**：Base Runner 最小 shell + 可选 git/archive/crypto/text Pack，处理文本、归档、diff/patch、校验和等短任务。
- **code**：挂载 Node/Python/JDK/Go 等精确版本 Pack，做依赖安装、编译、lint、测试、运行生成代码、复现 bug 和构建 Artifact。
- **data**：挂载 Python/SQLite/data-tools Pack，分析日志、CSV/JSON/SQLite 并生成统计/报告。
- **browser（三期）**：挂载固定版本 Chromium/browser-tools Pack，通过受控 CDP/Gateway 做网页读取、交互、截图、下载和前端验证。

典型流程是：用户/远端读取结果 → Artifact → 选择 Recipe/版本 → Base Runner 挂载 Pack → 隔离计算/测试 → Artifact+结构化证据 → Verifier → 必要时再进入 Policy/Approval/Lease/SSH mutation 链。Docker 扩展主要提高安全隔离、工具丰富度、可复现性和验证质量，不替代 SSH，也不给 Agent 宿主 Docker 权限。

### 9.1 Catalog、Environment Pack 与真正的多版本共存

Environment Catalog 由 Nexus 发行物提供，Frontend 不硬编码 tag。Catalog 分两层：

1. **Environment Pack**：实际可安装工具链，例如 `node@20`、`node@22`、`node@24`、`python@3.11`、`python@3.12`、固定 Chromium、data-tools；记录 familyId、versionId、displayName、contentDigest、按架构下载来源/checksum、runnerApiRange、capabilities、diskBytes、依赖 Pack、支持架构、兼容范围和 supported/deprecated/unavailable 状态。
2. **Recipe/Profile**：shell/code/data/browser 等用途模板，定义允许/需要哪些 family、PATH/入口、最低资源和安全能力；Recipe 不把工具链版本写死，Environment 创建时冻结实际 PackRef。

同一 family 必须支持**多个版本同时 installed、enabled、in-use**。Node 20/22/24 或 Python 3.11/3.12 可以同时存在；Run A 使用 Node 20、Run B 同时使用 Node 24，互不覆盖。默认一个 Environment 对同一 family 只选择一个 activeVersion；若 Catalog 明确声明 `sideBySide=true`，Recipe 可以挂载多个版本到独立目录并指定 PATH，禁止通过全局 symlink 修改影响其他 Environment。

每个 PackRef 冻结 `familyId + versionId + contentDigest`；每个 Environment 冻结 `baseRunnerDigest + recipeId + recipeRevision + catalogRevision + packRefs`。修改 defaultVersion 只影响以后创建的 Environment，不迁移旧实例。停用版本只禁止新选择，不停止旧实例。卸载只删除指定版本，不影响同 family 其他版本；active Environment 正在挂载该 Pack 时必须先停止/迁移，checkpoint/retain 历史只保留精确引用，未来需要时可按原 digest 重新安装。

Settings 固化：Docker 扩展开关、启用 Recipe、每个 family 的 `enabledVersionIds/defaultVersionId`、版本选择策略、Recipe 资源规格、网络策略、Artifact策略和 Environment Hard Limits。这些不属于运行残余。“installed”是 Runner 本机事实，不等于“enabled”：版本可以 enabled 但尚未安装，也可以 disabled 但暂时仍 installed/in-use。

### 9.2 Runner 数据目录与空间管理边界

`nexus-agent-runner` 必须把固化数据、可回收缓存、运行残余和隔离残余分开管理，不能把所有内容塞进一个匿名 Docker volume。逻辑根目录为 `/var/lib/nexus-agent-runner`，运行时秘密单独放 `/run/nexus-agent-runner`：

~~~text
/var/lib/nexus-agent-runner/
  state/        # 小而持久：controller journal、inventory、pack install records、cleanup watermarks
  packs/        # 固化安装数据：content-addressed immutable Environment Packs，多版本共存
  cache/        # 可回收：download/staging/extract/package metadata cache
  runtime/      # 可完全清理：按 environmentId/runId/generation 分目录的 work/deps/build/browser/job 临时数据
  quarantine/   # 未确认副作用/ownership 的残余；只能 reconcile/人工确认后清
/run/nexus-agent-runner/
  sockets/      # RPC/local sockets
  secrets/      # 短期证书、nonce、ticket material；tmpfs，runner 重启即失效
~~~

这些目录必须有不同 cleanup policy 和独立 usage 统计：

- `state/`：不可被普通“清运行残余”删除；journal 只做有界 compaction。
- `packs/`：只通过“安装/卸载环境版本”改变；Pack 以 contentDigest immutable，安装失败只留 staging。
- `cache/`：可一键清；不得成为运行正确性的唯一副本。
- `runtime/`：所有条目必须带 owner，Run/Environment 结束或一键还原可精确删除；项目 `node_modules`、venv、build cache、browser profile 都属于这里，不属于 Pack。
- `quarantine/`：空间计入使用量并显著告警，但未知 mutation/ownership 未解决前不能为释放空间自动删。
- `/run/...`：只放短期秘密与 socket，不允许放需要恢复的数据。

Runner 还要单独统计 Docker engine 自身占用（Base Runner image、容器只读层/metadata、Runner 创建的 volumes/networks），避免只统计 `/var/lib/nexus-agent-runner` 导致漏算。Base Runner 容器根文件系统保持 read-only，尽量把所有可写大数据显式落到 `runtime/` ownership path，从而让空间统计和清理可预测。Runner 容器内逻辑路径不能直接当成 Docker daemon 的 hostPath；部署必须为 Controller 提供受信、Docker 可见的数据源映射（named volume 或经过校验的宿主根均可），Controller 只从该受信映射生成 Pack/runtime mount，Frontend、模型和普通 API 永远不能提交任意宿主路径。具体 volume/bind 组合在 P2 实现时按部署环境确定。

Environment Settings 展示 `state / packs / cache / runtime / quarantine / engine-overhead` 六类互斥用量、总计、可立即回收量和正在引用量；`engine-overhead` 只统计尚未归入前五类的 Base Runner image、容器 writable layer/metadata 等，禁止重复计费。Hard Limits 可配置 Pack 总量、cache 总量、runtime 总量、Artifact/Environment 资源量等，提升 Hard Limit 走二次确认。实际磁盘不足时 Runner 明确返回 RESOURCE_UNAVAILABLE，不隐藏裁剪配置。

### 9.3 Base Runner、Pack Installer 与权限边界

~~~text
Frontend → Nexus Environment Settings/API
              ↓
Backend → EnvironmentControlPort (mTLS)
              ↓
nexus-agent-runner / Controller（唯一持专用 Docker engine socket）
   ├─ Base Runner inventory
   ├─ Environment Catalog / Pack installer
   ├─ state / packs / cache / runtime / quarantine
   ├─ quota + cleanup planner + space reporter
   └─ ExecutionEnvironment containers
         ├─ immutable Base Runner rootfs
         ├─ read-only selected Pack mounts
         ├─ owned runtime work/dependency/cache mounts
         └─ Gateway → 无凭据 tool child
~~~

Controller 是 TCB；Backend 和工作容器都不挂 Docker socket/任意宿主目录。Base Runner rootfs 只读、cap-drop ALL、no-new-privileges、非root、seccomp/AppArmor。Pack installer 先下载到可回收 cache，再在 `packs/` 同一文件系统的 staging 目录完成解包/校验后原子提交到 `packs/<family>/<version>/<contentDigest>`；至少校验 digest/checksum/manifest/arch/runnerApiRange，并拒绝路径逃逸、设备文件和宿主安装脚本。提交后的 Pack 只读。Environment 只能挂载请求中的精确 PackRef，用户代码不能写 Toolchain Store，也不能通过 PATH/symlink/mount 覆盖其他版本；更细的归档格式、文件数/展开大小等限制在 P2 实现时冻结并进入 E2E。

“实时配置”是 Runner 按用户选择**安装/准备/挂载已验证 Pack**，不是在活跃容器里任意 `apt install` 并污染 Base Runner。项目自己的 npm/pip 等依赖可以安装到该 Environment 的 `runtime/...`，生命周期结束后可清；系统级 Node/Python/Chromium 版本来自 Catalog Pack。Catalog 外工具链未来走受信 Pack 安装/发布流程，不允许模型直接永久修改 Base Runner。

工作容器业务网络默认 none；这不表示切断 Runner 必需的控制面。Controller/Gateway 控制通道必须使用仅 Runner 与对应 Environment 可达的私有通道，且不能把工作容器接入 Nexus Backend 主业务网络；业务出站若开启仍走独立 egress policy/approval。Pack 下载由 Runner installer 完成，不把 registry credential/下载权限给 Environment。具体私有 network/sidecar 拓扑留 P2 实现按 Docker 能力选择，但控制面与业务出站的隔离是固定边界。短期证书、ticket、nonce、generation fencing 与 command journal 沿用 Agent 安全模型。

### 9.4 清残余、卸载与恢复边界

Environment Settings 提供四个不同动作，不能混成一个“清理”按钮：

1. **清除运行残余 / 一键还原运行态**：preview → 阻止新 Environment/job → 收敛 running job → stop/delete Agent-owned 容器/network/tmpfs/临时 volume → 删除 `runtime/` 下 work、node_modules/venv、build/browser cache、job scratch → 撤销短期 cert/ticket → 释放 reservation → compact 已确认终态 journal → inventory 二次验证。保留 Settings、Catalog、`packs/`、retain/published Artifact、Run审计/证据。未知 mutation/job 转 `PARTIAL_RESTORE` 并留在 quarantine。
2. **清理缓存**：删除 `cache/` 中 download/staging/extract 等安全可重建数据；不卸载 Pack，不碰运行态和用户 Artifact。
3. **卸载环境版本**：针对 family/version，preview 显示安装大小、当前引用和影响；active Environment 正在使用时要求先停止/迁移。确认后删除该版本 Pack 与其下载缓存，不影响其他版本/Base Runner/审计。若该版本仍是 enabled/default，确认事务中先选择新默认或禁用；checkpoint/历史若以后恢复则按冻结 digest 重新安装，来源不可得时明确不可恢复。
4. **恢复 Docker 扩展默认配置**：重置 Recipe、enabled/default versions、资源/网络策略和 Environment Hard Limits，必须二次确认；不自动删除用户 Artifact，也不等同运行残余清理。

Runner startup reconcile 与“一键还原运行态”共用 cleanup planner，通过 owner label、environmentId、runId、generation、PackRef 与 journal 对账。确认属于 Agent 且无未知副作用的孤儿可自动清；无法确认的放 quarantine。停止 Environment 不卸载 Pack；删除 Environment 只删实例运行态；因此工具链版本可长期复用，但每个任务生成的源码、node_modules、venv、build output、cookies 等残余都能彻底回收。

## 10. MCP、ACP、CDP 和多 Agent（Phase 3）

MCP 首版只支持管理员登记的 Streamable HTTP，非任意模型提供 URL；stdio 只在隔离环境内按固定 command profile。server trust/version、工具 schema hash、工具名 namespacing、输入32 KiB/输出10 MiB/超时60秒逐工具限制；工具刷新改 schema 后旧审批失效。MCP declared annotations 不能自证 read，未知工具当 mutation，走本地 executor。

ACP 采用隔离外部 backend adapter，权限请求映射成本地 ToolInspection/Approval；外部 Agent 的自主 filesystem/network 禁止访问 Nexus 或生产连接，所有生产作用经过本地 capability RPC。无法拦截外部实现自主副作用的 ACP backend 只允许离线分析，不注册为运维执行器。适配器握手协商协议版本，不支持版本直接 degraded，不静默 fallback。

CDP endpoint 只在 browser environment 内，由 Gateway代理；BrowserSession绑定环境generation。snapshot 返回 nodeRef=(snapshotId,nodeIndex)，导航/DOM版本改变后旧 ref失效；navigate/click/type/download均按 action检查域名、会话、风险和预算。evaluate默认无capability，不接受任意selector/JS替代nodeRef。Cookie/profile不跨Run；页面文本、下载文件是untrusted。截图/DOM超64KiB转Artifact；type secret用短期secretRef，审计只存redacted。

多 Agent 通过原生 Subagent 实现 Coordinator/Worker/Reviewer。Subagent **不设置累计创建数量上限，也不再设置独立的 Subagent 并发上限**；完成/失败/取消的历史 Subagent 不占未来创建名额。所有 root/child 统一受全局 `maxConcurrentRuntimes`（默认软值2，默认Hard Limit 4）调度，超过可执行 Runtime 数量的子任务进入有界队列；设置页直接显示当前 executing Runtime 数、requested/effective 与当前 Hard Limit。全局模型并发是独立软上限，默认`auto`跟随有效Runtime并发并可由用户调低；因此 Runtime 可以处于 runnable/tool/waiting，而只有取得model slot的参与者才能发起模型stream。Subagent只保留 `maxDelegationDepth`（默认软值2、默认Hard Limit 3且可在Agent Settings二次确认调整，root为0）及 profile/model/budget 约束。

每个Subagent单独冻结ModelRef={providerId,modelId,configurationVersion}，可与root及其他Subagent不同。用户在App设置中维护带名称/角色/模型/预算的SubagentProfile，发起Run时可在授权模型列表中覆盖本次分配；模型delegate工具只能选择已配置profileId，不能设置任意endpoint/credential。未给模型显式采用profile默认，仍缺失才快照继承root模型并在UI标注。不同模型的contextWindow/tools能力/价格分别校验，不以主模型能力替代检查。

委派包含parentRuntimeId/profileId/modelRef/objective/constraints/inputArtifactRefs/maxTokens/maxSteps/deadline/completionCriteria。创建事务原子校验深度、父Run状态、剩余预算与profile授权；每次 delegation 都写入统一 `agent_steps(kind='delegation')` 并消耗 `maxRunSteps`，父预算预留子配额，所有模型/工具使用量统一结算到同一Run。这样允许任务按需要顺序创建任意多个已完成 Subagent，但不能靠反复换 Subagent 绕过 Run token/step/active-time/cost 预算、hard limit 或 no-progress loop guard。拒绝循环委派和跨Run reparent。

Coordinator等待子任务时释放自己的模型调用slot，不持有工具lease等待子任务，防止slot/锁死锁；child完成后只传摘要、状态、证据引用和用量，不复制完整私有上下文。子Agent只能使用父grant与profile capability的交集，不能替父/兄弟审批。父取消递归取消子队列/作业；已started未知mutation仍quarantine。可单独取消子任务，父得到结构化cancelled结果后决定后续。Worker完成不直接把Run标成功，Reviewer独立验证证据。

UI增加Subagent设置（深度、每角色模型与预算）和Run内子任务树；Runtime同时执行数量统一在“执行与性能”中显示和调整；每张卡显示模型、排队/运行/等待审批状态、输入输出Token、预算预留、证据和取消按钮。历史Run显示创建时的配置快照，不被后续模型设置覆盖。后端任务及接口见实施文档§10。


### 10.1 多 Agent 通信：Run-scoped 持久化邮箱

采用Backend管理的MailboxPort，不使用全应用global event bus，不让Agent进程互连。每条消息绑定server-derived senderRuntimeId、recipientRuntimeId、runId、appId、delegationId；接收方必须在同一Run且被profile通信权限允许。parent/child默认可通信，siblings默认经parent协调，确需直接协作由profile显式允许。跨Run/App只能通过AppIntent交接，不可借mailbox绕过隔离。

消息种类为request/reply/progress/evidence/completion；控制性的cancel、grant、approval、spawn必须走宿主use case，不把字符串“停止/批准/创建”当授权。Agent提供的消息永远标agent-origin/untrusted，不能升级为用户或system输入。正文最多16KiB、完整信封64KiB、单收件人最多64条未消费消息属于固定协议容量；单Run累计消息默认软预算1000条/2MiB，达到时进入`awaiting_budget`询问用户，默认Hard Limit 5000条/8MiB并可在Agent Settings二次确认调整。固定容量超限返回MAILBOX_FULL/MESSAGE_TOO_LARGE；发送方不得持tool lease阻塞等待。

消息有messageId、idempotencyKey、recipientSequence、correlationId、replyTo、causationId、taskRevision、createdAt、expiresAt。服务端在同事务分配recipientSequence、插入消息、写Run event并唤醒scheduler；队列/回调只是通知，丢失后扫描DB补齐。传输采用至少一次交付，消费以messageId/sequence幂等；ack表示已作为输入写入消费水位，不表示模型理解或外部动作成功。

消息顺序只保证每recipient sequence单调，跨recipient不用全局“先到先执行”假设；Run event sequence提供审计顺序。request默认120秒TTL，progress30秒，evidence/completion使用所属任务/委派的有界TTL，并在Run取消或终态时失效；超时写expired并唤醒等待者，不无穷重试。重复key相同payload返回原messageId，不同payload409；旧taskRevision回复进入stale结果，只保留审计不驱动新计划。

入箱消息不默认全文塞模型；runtime先按correlation合并progress、过滤过期、构造摘要+证据引用，每个模型step最多8条/8KiB，强相关request/completion优先，原始消息仍在邮箱可按需查。跨模型交接只传任务目标/约束/当前结论/Artifact证据/未决问题，不复制私有完整历史。父级没有读取子私有prompt或隐藏思维链的接口。

### 10.2 调度、等待与无死锁

Scheduler是Backend单进程的持久队列，不引入Redis或分布式锁。工作项为model_step/tool_step/consume_inbox/verify/join_resume，持久记录queued/claimed/waiting/completed/cancelled、generation、deadline、依赖和attempt；重启从DB恢复，已started mutation只转reconcile，不重新执行。未来多Backend实例必须先引入一致的leader/claim协议，本版部署只启一个Agent scheduler。

配额分为 Run 通用 token/step/active-time/cost 预算与全局 Runtime/Provider/工具/环境并发配额，不再维护累计Subagent创建预算或独立子执行并发额度。模型streaming与tool执行持execution permit；等待reply/join/approval释放permit但保留有界checkpoint，不继续占着名额阻塞子任务。子工具仍受同Run默认一个toolCall并发限制。cancel、expiry、lease续约、reconcile为控制路径，不排在模型任务后面；控制路径不能绕过mutation策略。

公平性为App round-robin→Run round-robin→该Run的root/child队列（root权重2、child权重1）；同层FIFO，等待10秒的ready工作提升一次优先级防饥饿。每轮只claim一个可满足全部资源条件的work，先原子预留执行/模型slot，再事务外执行。不能拿着一个slot等另一个slot；拿不到完整资源就回queued。需要tool lease的工作只在执行槽已可用时短事务尝试获取，不持lease等待Provider/子任务。

委派依赖只引用同Run已经存在的delegation，默认依赖成功才运行；dependencyMode=settled允许失败后做诊断。新依赖或等待边加入前检测wait-for图，形成环返回DELEGATION_WAIT_CYCLE；禁止child join祖先。parent join期间收到child request可暂停join并调度parent处理邮箱，不能因为等待所有child完成而永远不回复。

join默认all，也允许any；任何join必须有显式deadline并受Run取消/终态截断，父任务等待不持lease/permit。Run本身不另设绝对生命周期deadline。any返回后未完成child不会悄悄取消，由调用者显式cancelRemaining；all收到失败返回结构化结果，不隐藏失败。单子失败默认isolate，父得到失败/证据后决定重试或替代；failFast需要profile声明并记录。完成的 Subagent 不占后续创建名额；每次新 delegation 都消耗一个 Run step，重复派生但无新增证据会触发 loop guard，因此不依赖历史数量上限防止无限换方法。

### 10.3 取消、恢复与共享事实

parent取消设置Run cancelRequested/epoch，原子取消queued work、拒绝新spawn/send/action，再向running children传播AbortSignal；确认停止的child转cancelled，未知远端修改quarantine并使Run interrupted。单独取消child不自动取消siblings；child的后代递归取消；晚到的reply/result可记录，但不推进取消后的计划。

SharedFacts只允许run-scoped key/value+version CAS，值64KiB、单Run总1MiB；消息可带factVersion作为前置条件。多Agent修改冲突返回FACT_VERSION_CONFLICT，必须重新读再规划，禁止last-writer-wins覆盖证据。文件共享用ArtifactRef/grant，不共享sqlite连接/内存对象/环境目录。共享fact、message ack与scheduler唤醒使用同一个StateCommitPort事务。

重启对claimed model_step记aborted并结算预留，再按Run interrupted规则要求用户Resume；不后台自动恢复成本消耗。邮箱保留未消费消息和终态，Resume只导入用户确认的摘要/证据，重新生成runtime IDs，不把旧recipient消息改投新身份。Controller未决job按commandId核实，Subagent失败不能导致父忽略仍在运行的远端作业。

## 11. 前端 UI 与原页面兼容

全局只有一个 AgentLauncher 和一个 AgentHubWindow，挂在 App.vue 的 RouterView 外、登录后可见；**Agent 只提供全局非模态浮窗，不提供独立全页 presentation，不修改当前 RouterView 路由，也不改 AppHeader/顶部横向导航。** Agent Hub 采用**conversation-first**：中间 Conversation 是始终存在的主工作区，用户通过自然语言产生目标、计划、执行任务、审批和结果；Run/Step/Subagent/Environment 是对话派生的执行事实，不把用户强制切换到独立“任务管理后台”。窗口非模态，不锁body、不遮原终端，不引用 RemoteDesktopModal 的连接或Guacamole对象。默认1080×700、最小640×420（小视口例外），边界按顶部导航/visualViewport clamp；宽<1200收任务详情，宽<768用全宽sheet，避让虚拟键盘/安全区。

Launcher只定义**单击**打开：恢复上一次选中的有效App及其会话视图状态；移动>6px视为拖动并取消本次打开，pointercancel/卸载释放capture，Enter/Space立即打开并忽略repeat/合成click。App切换始终在Hub内部完成：标题区/会话栏顶部提供常驻的单选`AgentAppSwitcher`，可搜索授权App并显示最近项；选择A→B只改变前台presentation，A已启动的Run/Environment/Subagent/审批/预算等待全部继续，不能因切换App、最小化或关闭Hub而cancel。Host持续订阅各App安全summary；非当前App暂停详细SSE和重型视图，重新切回时用snapshot+catchup恢复。每个已访问App在当前登录生命周期内保留独立的threadId/draft/scroll/选中task等轻量view state；刷新后运行事实从服务端恢复，未提交draft仍不持久化。无历史默认Operations；停用App过滤，全部无效显示empty-state。

Hub内部左侧为可收起的会话/App导航，并提供用户级“文件”入口；中间始终是当前 Conversation + 固定 Composer，右侧为可折叠 TaskRail。文件库打开时复用 Hub 主内容区展示统一 Artifact 管理视图，关闭/返回后恢复原 Thread 的 scroll/draft，不创建第二套会话状态。TaskRail 展示当前会话由 Agent 生成的计划/进行中任务及同 App 的后台活跃 Run 摘要，不复制完整日志。点击任务在右侧 TaskDetailDrawer 原位展开步骤、状态、资源、审批、Artifact、Subagent 与日志，关闭详情恢复原 Conversation 滚动锚点和 draft，不切换到第二套 Composer。Operations 的 Timeline/Approval/Artifact/Token 都作为消息内卡片或 TaskDetail 的按需视图存在；消息 Composer 的“附件/文件”按钮打开轻量选择器，从文件库选现有 Artifact 或上传新文件，“引用知识”则是另一条知识检索入口，二者名称和职责不混用。App切换保留内存draft/scroll，暂停旧详细SSE而不cancel；新App先授权registry→本地contribution map→lazy import→snapshot+catchup。navigationGeneration丢弃过期异步加载。授权失败绝不因本地chunk存在继续渲染。

Hub标题/工具区只提供**单选 App 切换**及当前会话/任务所需控制，不支持一个 Run 同时组合多个 App，也不提供 Settings 或 Docker Runner 配置跳转。Agent 的宿主级配置统一并入现有 Nexus `/settings` 页面，新增 `Agent` tab；其中管理 Agent 总开关、App 启停、模型与Provider、执行与性能、预算与上下文、Hard Limits、Subagent、Artifact与存储、Environment/Docker Runner、安全与网络、系统保护。 Agent总开关默认开启；关闭时服务端先禁止新Run/step/Environment claim，再按现有cancel/quiesce/reconcile收敛执行，未知远端副作用仍quarantine。关闭完成后隐藏Launcher；Settings及安全清理/审计入口仍可用，历史会话、文件、配置和审计数据都保留但不通过已关闭的Hub继续交互，重新开启后可重新浏览；重新开启不自动续跑旧Run。Environment Manager 在该 tab 内长期存在：一期显示真实 unavailable，二期启用完整 Catalog/Pack/cleanup 管理，不另造第二套配置状态。系统保护只读展示event batch、commit queue、SSE连接上限、transient delta策略和当前数据库压力/availability；普通用户不能关闭背压或改成逐chunk持久化。执行与性能页允许调低Runtime/模型并发等软上限，模型并发默认Auto跟随Runtime并发。

Launcher角标只订阅Host summary，不加载每App的private store；后台运行、审批和预算请求只更新角标/通知，不自动抢焦点。关闭Hub/最小化/切App都只是presentation动作：释放或暂停不可见重型视图与详细流，保留每App轻量view state和Host摘要，**绝不取消Run/Environment/Subagent**。重新打开默认回到最后选中的App；切回后台App时重新snapshot+catchup当前真实状态。Agent 不新增顶栏导航、不注册独立 Agent 页面路由；任何文件/任务详情都在同一 Hub 内切换并可返回原 Conversation 滚动锚点和 draft。

运行中的 Conversation **始终允许继续输入**。Composer提交先持久化用户输入并立即返回，不等待当前模型/tool/job结束；若模型正在stream则按§7规则终止旧attempt并在下一安全step合并新输入，若不可安全中断的tool/job已started则标记pending input并在结果确认后优先处理。用户可用自然语言纠正目标、改变约束、要求暂停某类动作或继续询问相关内容；前端不猜测“这是聊天还是控制命令”，Harness根据最新input watermark重新规划，任何生产副作用仍需原Policy/Approval/Lease。UI不得因为Run busy/awaiting approval/awaiting budget而禁用Composer，仅取消/登出/会话不可写时禁用。

localStorage仅存 nexus.agent.surface.v1.user.<userId> 的bounds/maximized/launcherPosition/recentAppIds，版本1与大小8KiB限制；不存threadId/runId/draft/message/approval/token。刷新后最近会话由authorized server API恢复。登出清内存、订阅、preview票据、iframe/message ports，重新登录不复用旧事实。

长时间会话的UI性能是固定架构边界：Conversation 只通过cursor分页读取 canonical ledger，采用反向增量加载和虚拟化/windowing，禁止把整个Thread全部挂进Vue响应式树或DOM；加载旧页时保持视觉anchor，不因prepend跳动。streaming delta先进入非持久buffer，以requestAnimationFrame/有界节流批量刷新可见消息，Markdown/代码高亮只对final或停止stream后的内容做完整解析，不能每token重跑全文渲染。TaskRail读取独立Run/plan摘要投影并按id增量patch，禁止每个SSE事件扫描全ledger；TaskDetail、Artifact、tool output、Subagent树按点击lazy load并分页，大内容只显示有界preview。前端对离屏旧页做LRU淘汰、需要时按cursor重取，服务端仍保留canonical事实；关闭/切换会话应释放不可见的重型DOM、parser和detail订阅但不取消运行。

通过现有focus public facade登记；overlayStack新增只读modal-presence订阅，Agent位于既有modal之下，模态存在时Launcher暂停，Escape仅由当前top/focus owner处理。关闭恢复仍挂载的之前焦点。原生RDP全屏不强制退出或覆盖；主题复用tokens、翻译放agent/i18n三语同键。

## 12. 可观测、生产运维与验收边界

Agent审计记录requestId/runId/stepId/operationHash/目标别名/结果/token/耗时/配额，不保存明文密钥、隐藏思维链或无限prompt；业务messages按用户会话权限读取，不进入全局诊断日志。redaction不能保证识别所有秘密，因此外部日志默认最小读取，用户主动提交敏感资料仍提示模型出站风险。

SSE使用独立fetch客户端，不修改全局Axios15秒timeout；401通过App注入的auth invalidation facade停订阅。Nginx必须有更具体的Agent location，不能被现有 ^~ /api/ 吞掉；禁buffering/缓存、heartbeat15秒、read timeout75秒。session失效/登出须关闭长连接。

reset/restore先quiesce：关闭入口、递增generation、abort作业、等待有界inflight提交、关SSE/timer、处理执行owner/容器，再重置DB；旧回调不能写入新库。超时reset失败，不在仍有写者时清库。shutdown同序，30秒总期限，未知远端结果持久化以便reconcile。

验收包括：生产dist启动、空库/升级、授权/串App、输入调度、重复请求、SSE重连/慢客户端、审批竞争、lease丢失/未知结果、Artifact中途失败、无Docker降级、停机/reset、已有Workspace/RDP交互与隔离。自动行为测试仅按EC-E2E放test/e2e并从真实产品API/UI/ingress断言；build/architecture guard验证内部边界。三期扩展用同一基准测质量和成本，不能以“模型说完成”作为通过条件。
