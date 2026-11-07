# 历史验证索引

本页供检索旧验证，不是当前操作手册或施工计划。当前基线、命令和判据见 [E2E](E2E.md)，未验任务见 [PLAN](../PLAN.md)。每项链接固定到整理前提交的完整原始记录，保留当时 SHA、环境、命令、测量、失败、日志路径与清理边界；旧文中的“当前”“下一步”“尚未提交”只属于当时，不授权继续旧操作。

已退役 Runner/Guacamole 的证据仅用于追溯，不能证明当前 SSH/CDP/浏览器 SDK 的行为。静态、受控 fixture、真实服务与真机结论分别判断。

## Agent 限制复审与容量回归（2026-11-07）

继续未提交的 SDK4 重构，主代理独立执行。环境为 Node26.13.0、pnpm12.16.1；本轮文件清单、候选扫描、日志及浏览器现场归 `/home/honus/nexus-task-artifacts/agent-modular-20261106/limit-review`。最终清单覆盖主仓866项、独立插件仓411项（含删除项及生成物），这是完整文件清单与限制候选扫描，不表示全部文件均已逐行人工审阅。产品修复按 Shared → HTTP/WS/隔离宿主 → Service/Model/SQL → SDK/独立插件/前端消费者核对，保持权限、CAS、幂等、取消、完整续读及实际关闭语义。

- 去掉重复的工具参数/命令/路径/正文截断、文件树数量及深度、目录和指引私有扫描预算；文件树hash流式读取，目录按实际字节缩页，短页不能当作EOF。
- 去掉模型调用/定义、Provider模型/发现结果/Registry、App/可选模型/授权目标、Intent附件及JSON深度、Browser目标/规则/端点、Integration/MCP例外、denylist和上下文源的额外数量门槛。深层Intent采用显式栈遍历，重复身份、敏感字段和不安全URL仍拒绝。
- Plugin KV去固定1024键/8MiB总量；外壳沿所属传输预算，真实JSON编码容量、CAS/tombstone/事务/receipt不放宽。协作消息、Memory和Skill按最终RPC二次编码预算分页，只消费实际交付的消息；工具结果页允许读取至64KiB，默认4KiB，未删完整结果。
- 去掉隔离宿主/前端桥的私有并发和固定heap门槛；模型工具流增量计量UTF-8字节并正确合并跨delta代理对。MCP协商不再另加10/15秒期限，Host取消传到SDK实际fetch；ACP沿SDK帧预算并保持批准、排空与关闭。工具说明同步移除旧消息页4条和TTL300秒描述。
- 本轮限制修改未改变持久数据格式；上下文快照SQL容量仍为原实际5MiB。既有Agent重构迁移保留，不能把本轮结论外推为整个重构无需迁移。单帧、分页、传输/存储容量和用户配置的执行预算继续生效。

最终验证分别记录如下，避免将不同阶段重复项相加：

- `capacity-final-6.log`：22项通过。包括真实Chromium深/宽DOM与完整字段、真实OpenSSH大文件及长路径、SQLite KV/Memory、Provider HTTP创建800/发现1500/重启/更新600模型及5001项Registry，以及集合/深度正向与重复/权限等负向回归。
- `runtime-capacity-final-3.log`：7项通过。34个真实签名SDK4实例、3个同时开启的真实setup、同实例重复启用、关闭后新incarnation、publisher撤权后的进程/目录/账本清理。后续增强并发断言的 `runtime-capacity-final-6.log` 定向1项通过，启动日记写入期间重试读取，完整日记/进程身份断言不放宽；已接入正式 `execution-flow.spec.ts`。
- `test-plugin-final-7.log`：独立插件仓74项通过；其中真实MCP延迟15.5秒握手和Host取消到实际fetch及close/drain均通过。`check-plugin-final-8.log`通过，插件完整生产构建见 `build-plugin-final-7.log`；本轮最后只修改两条工具说明，单独重建agent tools并进入新签包。
- 公共Shared SDK使用不可变 `candidate.15`；八包开发签名staging22完成并固定到主仓fixture，`pins-final.json`记录全部原始hash、签名和归档字节重建验证。`staging22-final-1.log`最新包的消息二次编码分页、limit100、TTL3600及未交付消息消费围栏通过。此前 `host-plugin-final-2.log` 的33项通过保留；其10个失败均来自旧SDK3 runtime-capacity测试，已由上面的SDK4真实进程覆盖替换。未将该历史失败组合标为整组通过。
- `check-main-final-5.log`、`build-main-final-4.log`：根check与双端生产构建通过。最终全仓格式、两仓差异检查见本目录的 `format-main-final-3.log` 和 `diff-final.log`。
- 浏览器通过指定CDP `http://172.30.30.11:9223`访问 `https://api.honus.top`；前端9998，最新本地后端使用独立数据库。实际UI从130个模型新增至131并保存，刷新后仍131；1440/390/320px弹窗无水平溢出，添加按钮可用，无旧128上限提示，无pageerror。截图与结构化证据为 `browser/provider-{1440,390,320}.png`、`browser/result.json`。这是Provider设置回归，不等于完整Agent功能或移动真机验收。

首次失败、旧SDK归档、旧签包和浏览器数据均保留，未提交/推送或正式发布。全量Agent重构R6及远程E2E仍按PLAN承接。

## SDK4 续读与调用生命周期收尾（2026-11-07）

继续 main/cfa5bb5b 的未提交重构工作区，主代理独立执行。Node26.13.0、pnpm12.16.1；日志仍归 `/home/honus/nexus-task-artifacts/agent-modular-20261106/final-implementation`。本轮产品变化涉及隔离执行、历史快照和受管 HTTP/SSH 字节通道，没有新增数据库迁移或修改已确认 UI。

| 审核表   | 本轮结果                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | ACP 大结果通过预览游标读回完整内容，不重新执行 prompt；Child 只读操作复核当前权限；插件提前返回仍等待原 Host 调用；长连接释放已关闭响应，取消和同步关闭失败不提前释放写入。                     |
| 职责归属 | 协议 SDK 归独立插件，通用字节 I/O 归 Platform，真实授权和 transport/Operation 生命周期归 Host；旧工具父子表仅作迁移和备份审计。                                                                 |
| 类型归属 | 前端 SDK 握手与消息游标迁到 protocol4；服务注册用动态 Registry/准确 binding；删除无人消费的 frozen-app-execution SDK3 运行夹具，不恢复旧导出。                                                  |
| 完成证据 | 下列专项通过；新增正式 runner 入口覆盖服务目录、HTTP及ACP收尾。staging19 最终组合已通过92项，配置/文件审批回归另通过12项；全量正式 E2E、最终 CDP 和正式插件发布仍未完成，不以局部结果宣称交付。 |

- `protocols-staging18-2.log`：5项通过。大 ACP 返回按每页4096 JSON编码字节真实调用 `tool_result_read`，核对码点游标、完整128KiB文本和hash，`session/prompt`只执行一次。原10秒测试等待不足记录在 `acp-result-continuation-staging18-1.log`，只将该大结果用例等待改为45秒，产品期限不变；独立复验为 `acp-result-continuation-staging18-2.log`。
- `module-runtime-sdk4-2.log`：25项通过，覆盖32个IPC请求、派发前拒绝第33个并恢复容量、八个控制请求、原调用取消/退出、超过旧30秒计时、同步abort重入及多错误保留。首次日志 `module-runtime-sdk4-1.log` 保留7通过/18失败；复现并修复void生命周期成功帧缺value、worker准入缺失、handler提前返回遗漏Host任务。后续新增“首次技术错误后拒绝同次新请求”的断言，已纳入下述staging19最终组合通过。
- `authority-sdk4-1.log`：13项通过，含实际HTTP/OpenSSH/SQLite已完成effect的原dispatch proof、撤权/目标/父状态/批准变化、在途验证和Job事件监控。
- `frontend-sdk4-port-2.log`：5项通过，保留应用后ACK、终态应用中退订、实际MessagePort取消等断言；首次旧游标失败保留 `frontend-sdk4-port-1.log`。
- `readonly-sdk4-3.log`：2项通过。实际Root委派Child经OpenSSH读文件和目录，隐藏effect绑定准确包/实例/目标；撤权、配置/包身份/目标变化、跨Run/跨App等拒绝。旧schema3签名声明只作为显式archive审计，不能作为可执行SDK4包。首次两轮发现旧夹具的外键错误和快照遗漏的名称/版本及必要目标一致性校验，保留 `readonly-sdk4-{1,2}.log`。
- `services-sdk4-1.log`：6项通过，覆盖内部依赖服务与模型工具曝光分离、准确caller/contract/schema、来源和投影对象不可改写权威事实、能力上界及1200项目录分页。旧静态serviceImports/图深度不恢复为产品限制。
- `machine-sdk4-1.log`：10项通过，通用交互字节通道与大输出背压隔离，SFTP/命令/诊断/Docker复用、目标撤权、迟到握手、取消与完整关闭。该组只验证通用Remote通道，官方ACP协议由签名插件HTTP组验证。
- `mcp-http-lifecycle-2.log`：7项通过，真实HTTP头部拒绝/响应溢出/六个请求取消、连续130个响应释放以及response/dispatcher独立清理错误。首次 `mcp-http-lifecycle-1.log` 实际复现已关闭response仍留在连接活跃集合；该日志还保留测试mock导致的递归错误，后者不作为产品缺陷。
- `acp-host-lifecycle-2.log`：6项通过，Host等待迟到批准/原read、取消后不交付字节或批准、独立清理错误、真实Writable回调及MachineModel错误保留。首次 `acp-host-lifecycle-1.log` 复现command.close同步报错后提前释放writer，修复后保持原断言通过。
- 独立仓 `mcp-plugin-lifecycle-1.log` 4项通过，新增SDK协商失败与detach失败均保留、dispose同步异常不丢独立原因；`plugin-check-lifecycle-1.log` 与 `plugin-test-lifecycle-1.log` 全检查及64项测试通过。这些源修改已构建为下述新staging19不可变签名包，旧staging18不用于证明新插件产物。

- `finish-check-lifecycle-1.log`、`finish-build-lifecycle-1.log`：根check与双端生产构建通过，覆盖Native调用首次技术失败后停止新准入、HTTP响应释放及SSH同步关闭仍等待原写入。`plugin-build-lifecycle-1.log`、`plugin-staging19-1.log`完成八个包的新构建与签名；八包fixture及各自provenance固定为`2.0.0-dev.19`，原始文件/hash/签名/归档重建校验不变。fixture说明同步SDK4动态注册职责，不再把SDK3的六包、静态manifest工具数作为当前事实。
- `lifecycle-final-staging19-1.log`：新签包下11组共92项通过，零失败/取消/跳过；包括增强后的module-runtime、authority/readonly/service、MCP HTTP/ACP Host收尾、连接复用、真实MCP/ACP、SDK4独立更新及前端MessagePort。仅这些组完成组合验证，不能代表50组正式Agent入口或全产品E2E通过。
- `tool-regression-staging19-4.log`：7项通过。删除旧静态贡献与RunModelStream消费者，真实签名包目录经App发现后交给两个模型请求编码器；分别核对超过32个定义、合法33000字符历史、128个定义/32个调用的各自边界及溢出拒绝。真实OpenSSH文件写入核对准确父/子Operation、并发同键批准仅消费一次、0600权限、私有正文不出批准摘要、当前工具详情投影、拒绝后不写入、取消/撤权/目标禁用不能复活旧批准。App在收到确定拒绝后可自行选择继续结束，不恢复旧Host强制终止循环。前三轮日志保留测试迁移时错误的标题容量、旧状态名、错误字段路径及旧拒绝结果假设，不作为新产品缺陷。
- `integration-races-staging19-3.log`：5项通过。旧IntegrationService退役后，原准入/收尾安全意图迁往真实DefaultToolResources/PluginService和实例配置owner：同步协议异常仍等Job/Browser/SSH原任务且保留四个错误；关闭只拒绝排队工作、等待已准入任务；真实SQLite队列后会话过期不写配置或回执；commit_unknown后原键恢复已提交内容且不二次修改；并发CAS只提交一个，准确回执跨停用和重启保留。前两轮保留测试disposer应幂等的夹具错误。旧128续接名额、集中Integration CRUD和静态声明不恢复；MCP原续接/Run归属由实际签包协议与MCP组承接，动态发布/失效由Registry组、保留数据/清理围栏由包迁移组承接，全部组仍须完成正式矩阵验收。
- 新增上述两个正式runner组；`missing-dist-imports-staging19.json`扫描为零，说明测试中不再引用缺失的Backend/Shared dist文件，但不证明其余断言或运行行为已全部迁移。其余正式组的实跑结果另行记录。

## SDK4 续读、协作与检查点恢复（2026-11-07）

基于main/cfa5bb5b的未提交重构工作区，由主代理独立继续R6。Node26.13.0、pnpm12.16.1；本轮产物归`/home/honus/nexus-task-artifacts/agent-modular-20261106/final-implementation`。主仓与独立插件仓仍未提交或正式发布，没有更新生产主机，也没有删除用户要求保留的产物。

| 审核表   | 实现与证据                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 模型预览保留原调用/hash/码点游标；分页不限制原结果总大小，移除插件offset的旧256KiB上限。实际Shell8MiB结果由预览与续读重建并核对hash，不重跑命令。取消模型等待不再把父任务错误结算为unknown，真实执行/清理未知继续围栏。 |
| 职责归属 | 完整内容归OperationContent；预览和压缩归App插件。RunAppState只校验内容引用、终态回执、代次和CAS；历史读者与来源均限定Root。CollaborationRefusal表达确认回滚的事务拒绝，Job owner独立记录实际执行未知。                  |
| 类型归属 | Shared Run信息、内容页和检查点/历史解码使用原IPC预算，私有App状态不套普通HTTP32KiB上限；Host入口、SDK、独立仓、正式fixture同步。插件工作区override改为实际candidate.10归档，避免仅更新依赖却仍打入旧SDK。               |
| 完成证据 | 下列专项、根check/双端build/format、插件check与62项测试通过。当前只完成这些范围；正式完整E2E、全部旧回归迁移、正式签名发布和最终指定浏览器仍待完成。                                                                    |

- `collaboration-sdk4-5.log`：12项通过，包含父子隔离、准确绑定/派发证明、事实CAS拒绝、依赖取消、审批前取消、模型取消、消息与真实后台Job未知。此前失败的旧账本断言、目录查询和模型失败字段断言已迁移；没有恢复旧工具表或固定阶段。
- `collaboration-shell-sdk4-4.log`：该轮Shell11项全部通过，协作仍有旧失败字段断言，因此整份组合日志不算全绿；协作最终结果使用上一条独立复验。Shell核对8MiB原始stdout、完整捕获结果重建、Unicode分页、后续命令和Job资源；仅大输出场景延长测试等待，不修改产品期限。
- `result-children-registry-sdk4-3.log`：50项通过，涵盖实际SQLite内容、准确来源、当前权限/目标版本、超过2MiB结果的前页与尾页、撤权/跨目标、分块及全量损坏、递归Operation收敛和历史关系迁移。
- `artifact-evidence-sdk4-2.log`：16项通过，保留已就绪产物来源、确认后拒绝、提交未知无假证据、清理归类和批次预检；只同步真实构造器位置。
- `app-ledger-sdk4-3.log`：39项通过。正式旧phase-ledger测试迁移到真实Run/Operation/content/checkpoint DDL、Model与事务，保留确切状态/回执/摘要来源、CAS、封存/归属、过期/关闭/代次围栏、失败Child/Job、迟到完成与加密reasoning断言。新增Root历史分页与Child私有状态隔离、完整Unicode/转义chunk及超过HTTP默认大小的回执页。原Host五阶段/摘要包装设计由App私有状态回归承接，未重新引入旧实现。
- `app-plugin-runtime-candidate10.log`：App运行与预览11项通过，覆盖同一模型请求恢复仅派发一次、准确压缩前缀/完整工具结果组/保留尾部、空及过大摘要不替换原历史、连续两次有用摘要各自绑定来源、未完成历史引用、意图hash不匹配拒绝、标题可选失败与真实未知/存储失败。该组是实际App加内存Host port，不能代替实际HTTP/存储证据。
- `app-sdk4-staging17-1.log`：新签名8包固定到staging17，实际Backend/SDK/隔离插件与OpenSSH9项通过；其中新增长中文/Emoji结果在下一次Root恢复原历史，完整输出、两个Run各一次模型请求均核对。还覆盖无模型App、两个模型协议、真实文件、批准单次消费、审批前取消、同轮写入围栏和停用设置CAS。
- `finish-check-ledger-2.log`、`finish-build-ledger-1.log`、`finish-format-ledger-3.log`：根check、双端生产构建和全仓格式通过。首轮发现括号/声明间距与格式偏移已修正；生成SDK bundle按源构建校验，Prettier仅排除其生成目录，签名fixture继续保持原字节校验。
- `plugin-check-candidate10-4.log`、`plugin-test-candidate10-2.log`：独立仓check通过，插件测试分别27/33/2项，共62项通过；包含实际编译包、发行/组合、工具算法和MCP协议。两个旧测试将新的具名拒绝仍当作成功返回中的failure，改为核对拒绝类别，保留零Host调用和分页容量断言。

首次失败均保留：`app-ledger-sdk4-1.log`复现Root错误取得Child检查点；`app-plugin-runtime-1.log`复现私有状态32KiB拒绝；`app-plugin-runtime-3.log`复现连续摘要复用相同operationKey导致准确请求冲突；`backend-build-ledger-2.log`为Shared目标库不支持String.isWellFormed，改用既有共享Unicode校验。candidate.9是在该失败编译后的导出，未被消费者或签包采用；candidate.10来自随后成功构建。所有旧归档保持不可变。staging17只是开发签名验收包，相关PASS不证明已正式发布或全部新架构验收完成。

## Agent 模块化集成与易用性复核（2026-11-06）

基于 `main/390cfdb5c545617cde2f2be71a63c4f28eed79de` 的未提交工作区，保留前序性能与架构修改。按用户授权采用 sol high/medium 分工，主代理审核边界并通过指定 Windows Chrome 156 CDP（`172.30.30.11:9223`）访问 `https://api.honus.top`；本轮前端为 9998 生产构建 preview，后端为独立 3002，包及模型决策 fixture 为 3003，数据和产物集中 `/home/honus/nexus-task-artifacts/agent-modular-20261106`。没有连接或更新生产数据库；未提交、推送、发布或部署。

| 审核表   | 本轮结论                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 功能对应 | Run driver、统一工具目录与 schema、App/包组合、独立 UI、完整 SDK、多订阅事件及文件工具包已集成；第二个表单式巡检 App 实际复用同一工具包。第一版其余工具仍为本体默认贡献，不称全部外置。                                  |
| 职责归属 | 执行内核持生命周期、准确派发与结算；Host 持认证、批准、目标校验和资源，插件持应用与工具算法。Root/Child、隐藏单项原语沿持久父子账本收敛，保留原权限与未知结果围栏。                                                      |
| 类型归属 | Shared v2 包/SDK/事件契约同步后端、前端、独立仓与测试；sandbox 唯一取值含 allow-scripts/allow-forms，继续禁止 same-origin、原生表单网络和任意连接。安装流程不保存计划/进度，正式连续迁移保存实际包、绑定及数据迁移围栏。 |
| 完成证据 | 本轮最终根 check、完整构建、独立包构建/签名核对通过；下列有限 CDP 链路已执行。新增正式 E2E 源码已注册并静态通过，但未运行本地或远程完整正式 E2E；不能用历史 Actions PASS 代替。                                          |

实际验收与修正：

- 插件页面多 chunk/CSS 并发复用了管理队列，曾返回 503；资源交付改走独立串行 lane 并追踪取消和关闭，入队及执行后核对原 grant。独立聊天构建补全外部组件的 Tailwind source 扫描及关键 utilities 构建检查。仍为串行资源交付，未测量跨 App 慢读者吞吐，不额外建立调度器。
- iframe 原 sandbox 阻止 JS 表单提交；Shared sandbox 增加 allow-forms，HTTP CSP 继续 form-action none。`browser/forms-csp.json` 证明 JS submit 到达一次，原生表单网络请求为零、触发 form-action 违规，同源父页访问仍拒绝。SDK 仅公开 frontend-v2.mjs，不保留旧 v1 alias。
- 聊天终态同步退订后的晚 ACK 原先关闭整个 UI；客户端应用后复查订阅，Host 严格解码后忽略已退订 id，活动 ACK 仍核对原 pending。`streams/terminal-ack/REVIEW.md` 的真实 port 定向逻辑 5/5 通过，浏览器修后普通聊天与终态后再次发送通过。
- Child 原目录遗漏尚未加载的授权包工具；现继承父 availableDefinitions 授权快照，仍排除 Root 专用及隐藏原语。真实 Root 请求批准后创建 Child，Child 经签名包 read/list、隐藏原语和 loopback OpenSSH 读到 README marker/hash 及目录，父子均完成。`browser/real-tools-sql.json`、`child-relationships.json` 保留实际工具与父子持久关系；模型 fixture 只决定调用，文件结果来自真实 Host/SSH。explore 是角色标签，不等于权限自动降级；只读能力由文件工具 profile 约束。
- 审批预读改用实际 Apps API；摘要补具体任务、命令和目标，可信 Host 确认显示目标名称及 id。最终 UI dev.7/工具 patch3 再次运行真实父子链，`browser/approval-final.json` 记录 Run `cf1b1fd7-b814-403c-8398-5e41f19dfd4d` completed，可信确认前零次 resolve、后一次，且无 pageerror；`approval-dialog-final.png` 保留实际弹窗。初次辅助脚本误用 Approve 按钮文案，按真实 Approve and run 继续同一待审批任务，没有重发该任务。
- 市场执行包 prepare 递增修订后 commit 使用旧修订，已改用实际准备返回值；draining 普通安装不能越过 pending/data_migrated 围栏，保留配置但无 KV 的已卸载包仍可管理清除。`browser/tool-independent-upgrade.json` 证明 tools 2.0.0-dev.3→2.0.1-dev.3 经市场 install-plan 第一次完成，App/UI 包未变，执行修订 3→4。第二个巡检 App 随后通过真实共享工具完成 Run `8431e194-ca89-4dee-bb12-abc892142c35`，见 `inspection-after-tool-upgrade-sql.json` 及对应日志。
- UI 2.0.0-dev.6→dev.7 更新期间 Run `36ea6bff-b7f7-4720-86c7-c5d5af3fe3c0` 保持 running，最终 completed；executionRevision 保持 4，uiRevision 8→9，未发送草稿保留，见 `browser/ui-independent-upgrade-final.json`。本次明确核对新 Thread 已创建，避免此前辅助脚本点击未就绪的 New 按钮而把任务写入旧 Thread。
- 附件通过真实宿主上传并返回 opaque selection key，聊天显示 Files (1) 与文件胶囊，见 `browser/attachment-result.json`。文件输入由浏览器 File/DataTransfer 夹具提供；不是操作系统文件选择器验收。首次辅助脚本错误等待旧列表自动显示刚上传文件，实际上传已成功，关闭选择器后选中结果正常返回。
- 审批模式草稿与历史 Run 冻结模式分开；无效 modelKey 不再让 Send 可点却静默失败，使用当前 selectedModel 判断，保留原选择与草稿并要求显式重选。`browser/checkpoint-final.json` 实际通过关闭/重开 App 保留有效选择，再将 Provider 配置版本 1→2，确认旧选择显示 Choose a model 且 Send 禁用，显式重选后恢复可发送、草稿保留且无 pageerror；对应正式用例已补充。
- `browser/responsive-result.json` 与 chat-1440/390/320.png 核对最终 UI 的正文、会话列表、输入及控件边界；宽屏目标显示文字、窄屏显示图标，无横向溢出。早期截图正文空白来自未等布局/绘制稳定，调整采样先后及两帧等待后正常，没有为此修改产品 CSS 或虚拟列表。只证明指定桌面浏览器的宽度仿真，不代替真实手机软键盘。

最终独立包证据：`packages/provenance/independent-build-ui-dev6-final-result.json`。UI 源快照 `90faad363974c315201ae1d02299c0489ddfc711302fc78c2960a7fe5b27ac30`，167 个源码、176 个构建输入、39 个运行输入与独立 fresh 构建及正式 fixture 一致；独立仓 build/check/8 项逻辑测试和 5 包验签通过。UI dev.6 包 hash `d41f6ab16b1e98e8b240037c839864789ecc95d3a12af833533450a01d8f88a9`，dev.7 为 `b5ceeab9ae38e383d33ddb9535e04b9d944ba1890801bddbd2f355e58d8d5a31`；旧 App/tools3 的 tar 与 release 描述原字节保留，没有覆盖或重签旧版本。

静态命令为根 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check`、`git diff --check`，最终日志使用任务目录下 integration-*-final.log。新增正式用例覆盖 schema/版本、runtime 隔离、共享包、子操作快照、并发 asset、安装迁移与恢复、ACK、审批摘要、实际 iframe 表单/批准及模型 checkpoint，按 D17 留待正式远程运行。历史数据库完整升级/备份恢复、并发撤权/未知效果、长日志控制延迟和资源峰值、第三方真实 Provider 效果及移动真机仍不由本轮有限链路证明。专用目录、数据库、包和运行环境保留至用户通知清理。

## 连接发起期间保留最新选择（2026-11-06）

基于 `main/378083190cba468ed69dad892c0810b33e9f2edd` 的未提交工作区，保留前序变更。确认根因是异步的连接配置读取、顺序批量连接和标签预布局没有共用选择次序：旧查询晚返回后调用普通打开，会把刚创建的会话设为当前标签；批量里的后续连接也能覆盖用户的新选择。普通已注册SSH握手完成本身不写activeId，避免把网络耗时误当成唯一根因。

WorkspacePage复用原activationGeneration，查询在读取前捕获，整批连接共享同一代次；单连接、标签切换和打开启动页推进代次，同时清理旧预布局目标。Registry.open显式接收本地activate选项，旧请求继续建立后台连接但不改activeId或关闭较新的启动页。原pageScope撤销、SSH成功/失败恢复、租约与清理保持，不改UI、Shared、后端或数据库。

| 审核表   | 结论                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 最新选择优先；单连接/批量延迟读取不抢标签；后台握手不关闭新连接页；后台连接仍可切换并执行命令。                  |
| 职责归属 | 页面持选择代次，Registry持注册和activeId，Runtime持SSH生命周期；复用原状态，不新增选择Store或定时器。            |
| 类型归属 | 本地open选项含viewport/activate；真实页面消费者同版迁移，既有无选项直接打开保留默认激活；无跨端协议变更。        |
| 完成证据 | 修复前浏览器实际复现最新标签aria-selected由true变false；修复后桌面/手机6个新增交错场景及既有相关场景验证见下文。 |

Node 26.13.0 / pnpm 12.16.1。原构建的`baseline3.log`保留确定失败：从连接管理进入、暂存第一条配置读取、选择第二条并连通，再释放第一条响应，最新标签被错误取消选中。最初误选ui项目未收集SSH场景；随后首次夹具直接导航未预载连接列表而卡在选择入口，分别保留baseline/baseline2日志，不作为产品复现证据。修正夹具沿真实连接管理入口进入后复现成功。

修复版正式本地runner构建双端，选取workspace-no-session、reconnect-ui、terminal-reset及terminal-session-isolation。第一轮23项通过、两项因批量打开同一连接形成两个同名标签而触发测试定位歧义；实际原标签仍为选中。回归改为在释放延迟请求前捕获真实Workspace ID，断言原实例仍选中且可见，不放宽业务断言；再次运行完整isolation文件8项通过。两轮合计覆盖25个唯一场景，包含桌面与390px手机仿真、真实SSH服务、失败重连、页面返回、后台尺寸、快捷键、批量关闭、重置及会话隔离。不是GitHub Actions或真机运营商切网验收。

根check、双端生产构建、全量格式和diff检查通过；新增测试函数间距按现有ESLint修正，首次日志保留。产物集中`/home/honus/nexus-task-artifacts/terminal-selection-20261106`，含start.diff、baseline3.log、e2e.log、final.log、对应report/results、check.log和format-fixed.log。临时产物保留至用户通知；没有提交、推送、发布或部署。

## 终端异常恢复、尺寸与跨设备审核（2026-11-06）

基于 `main/378083190cba468ed69dad892c0810b33e9f2edd` 的未提交工作区，保留全部前序修改。本轮沿 TerminalView、OutputWriter、TypeAhead、Workspace Runtime/Socket、Shared 几何以及后端 PTY/租约恢复审核初连、失败重连、挂起回放、输入输出与消费、历史翻页、尺寸变更、手机/桌面和前后台生命周期。未更改连接协议、未知结果围栏、字号策略或界面样式，无数据库变更；未提交推送、运行 GitHub Actions 或部署生产服务。

修复三类已复现问题：失活/后台视图的迟到 DOM 输入、粘贴和未完成 IME 仍可能发到 SSH，现由输入根节点 capture 守卫阻止，并清空失活 textarea、保留 xterm compositionend 清理和后台 DSR 协议应答；备用缓冲区全屏程序误触发挂起历史加载，现于请求前、返回后及解析队列排空后复查，竞态中暂存的实时输出仍按顺序交还原 writer，解析完成才归还消费信用；恢复完成回调原先直接插入 xterm，可能越过 TypeAhead 中的恢复输出而提前同步尺寸，现通过原 outputWriter.barrier 等待完整队列，并保留 PTY 代次与实例检查。

| 审核表   | 结论                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 后台迟到用户输入拒绝、DSR继续；新IME可输入；全屏滚动不拉历史，返回普通屏后仍可读取；历史缩放与独立xterm直接缩放对照一致；挂起回放结束前不提前发送尺寸。 |
| 职责归属 | 改动位于TerminalView交互/展示owner，复用OutputWriter、TypeAhead、Channel和原清理机制；Runtime/Socket及后端PTY/租约职责不变。                            |
| 类型归属 | 历史暂存只接收decodeOutput后的string，收窄数组并删除冗余二进制解码；不新增Shared字段、重复状态、兼容支路或产品测试接口。                                |
| 完成证据 | 修复前3项受控失败及CDP恢复竞态失败留存；本地正式runner两轮76项、43项通过（包含重叠），指定Windows Chrome CDP最新7项全部通过；静态检查及未验边界见下文。 |

Node 26.13.0 / pnpm 12.16.1。首轮正式runner覆盖 terminal-lifecycle、terminal-ui/session-cache/session-isolation/startup/reset，以及手机 terminal-touch/output-scheduling/suspend-resume/ssh-workspace，共76项通过；恢复屏障修复后重建双端并重跑 lifecycle 与手机 suspend-resume，43项通过。两轮不能相加作为唯一数量。新增7个场景纳入正式spec；最后增强的“历史响应期间暂存输出仍显示且消费回调完整”断言由最新CDP再次执行通过。测试用SerializeAddon只经原E2E浏览器构建入口导出，独立参考xterm对照缩放，不改产品接口。

指定 `http://172.30.30.11:9223` 的 Windows Chrome 156，通过 `https://api.honus.top` 下独立受控测试页加载实际构建的TerminalView/xterm并运行7项专项，均通过且无pageerror；会话传输是受控harness。恢复竞态旧构建在解析屏障释放前发送1次resize，修复后为0，释放后正常恢复正文与窗口尺寸。所有本轮创建的浏览器页已关闭，用户原tab保留。

证据集中 `/home/honus/nexus-task-artifacts/terminal-audit-20261106`：`start.diff` 保存本轮基线；`baseline.log`、`cdp-before-resume.json` 保留失败；`e2e.log`、`e2e-final.log` 和对应report/results保存正式runner结果；`cdp-final.json` 保存最终7项；`check.log`、`format.log` 保存静态检查。双端生产构建、根check、全量格式及diff检查通过。临时产物按用户要求保留至通知清理。

这些结果覆盖真实本地SSH测试服务、浏览器故障注入与移动设备仿真，不代表真实Android/iOS软键盘、运营商切网、休眠恢复或多跳弱网全部通过；相关边界继续保留PLAN，未宣称性能提升数字或消除所有缩放抖动。

## Agent 工具资源复用（2026-11-05，源码与静态）

本轮为 `main/2abcf49b` 基线上的未提交工作区，Node 26.13.0、pnpm 12.16.1。Remote 为每个 Run 创建独占借用的 SSH 池，顺序命令归还后复用，并发按需建连；成功文件资源保留独占 SFTP 供连续文件、项目指引与文件交付复用。Shell/Job、Docker、诊断与 ACP 消费同一作用域；每条命令的 cwd/env 仍独立，ACP 程序与协议会话不跨调用复用。MCP、Browser 和插件沿原缓存/会话 owner，无 UI、Shared 工具参数或数据库变化。

两轮源码审核核对完整消费者、目标/主机信任摘要、握手后的再次校验、并发借用预留、失败/未知退休、断开空闲文件资源派发前替换，以及 Run 与全局关闭。等待取消不丢实际握手，清理失败保留 owner/因果且继续其余收尾；Job、ACP、项目读取和文件交付捕获原作用域，晚回调不新建作用域。原始 Provider 仍实际关闭普通 Workspace/Files 资源。

根 `pnpm run check`、`pnpm run format:all:check`、后端生产构建、`git diff --check` 与新增 Node 场景语法检查通过；Playwright `--list` 确认 execution-flow 的5项场景包含新增资源复用入口。首次静态检查发现新增代码的花括号/函数间距问题，已按原 ESLint/Prettier 修正并完整复查。日志保留在 `/home/honus/nexus-task-artifacts/agent-tool-reuse-20261105`。

新增 `backend-next-machine-reuse.integration.mjs` 的9项回归进入正式 Agent execution-flow：真实 SSH/SFTP 及 POSIX exec 覆盖握手/通道计数、cwd/env、并发取消、断线、跨 Run 隔离、项目/文件交付；ACP 使用真实协议 Adapter 与受控服务端，Docker/诊断通过技术 Port 的受控输出验证同一 SSH 链；晚握手、清理失败与在途退休使用受控资源。既有文件交付、SFTP 与 ACP 生命周期 fixture 同步新的释放契约，保留原功能断言。**按 D17 未在本地运行行为测试；本轮远程 E2E、真实目标/网络下的时延、吞吐及长时资源占用仍待验，未声明性能数字或行为通过。** 本轮未提交推送、发布镜像或改生产服务，专用产物保留至用户通知。

## 复制移动安全与同类配色扩查（2026-11-05，源码与静态）

基于 `main/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 的当前工作区，保留前序文档整理、连接工具栏及配色修改。按本轮授权修复原生 rsync 的 size/mtime 跳过，以及不同已保存连接抵达同服务器时 SFTP 中转的路径重叠；登录并发不改，Docker 镜像更新取消。NativeServerTransfer 增加 `--ignore-times`；Files Model 从实际受信握手公钥生成内部摘要，copyRemoteEntries 对原连接或同密钥连接在首次写入前检查整批规范路径。没有新增探测临时文件，也没有删除原安全 stage 或凭据/known_hosts 暂存；相同密钥只构成保守拒绝依据，物理文件系统身份、不同密钥/共享挂载别名和并发替换的保证边界见 Backend。

配色扩至快捷命令分组、连接标签选择、Agent Provider/MCP/ACP/插件市场及机器突变恢复状态；历史与挂起时间取消额外透明度。普通计数保持中性，快捷命令标题/底色只在非悬停时使用新配色，保留原悬停、选中、焦点、禁用和操作流程。Agent App 现有启停色及审计已有分类色经核对保留。新增私有 FileResource 字段已同步生产构造、五个后端夹具文件及目录复制夹具，无 Shared/数据库变更。

正式跨服务器协议用例增加三项：重复连接的 copy/move 拒绝原位、源父目录链接及递归目标，源字节和目录保持原样；同原连接原位 move 仍可完成；rsync 移动覆盖等大小/时间旧内容后才删除来源。原六条 clipboard/send × rsync/scp/relay 复制路线增加等大小/时间、不同字节的既有目标。目录复制夹具改为不同密钥下的同文本源/目标路径，保留 200 文件内容及任务级父目录检查。SSH 测试服务器的 REALPATH 改为实际解析文件系统链接，避免词法归一掩盖该场景；相关夹具取消、清理和失败开关不变。

Node 26.13.0 / pnpm 12.16.1：根 `pnpm run check`、`pnpm run format:all:check`、`pnpm run build:backend`、`pnpm run build:frontend` 与 `git diff --check` 全部通过。Playwright `--list` 识别受影响协议文件全部 12 项；仅为用例收集，不表示执行通过。最后的 SSH 夹具修正及文档回填另补 ESLint、语法、格式与 diff 检查。日志集中 `/home/honus/nexus-task-artifacts/copy-safety-and-color-audit-20261105`，按 D17 未运行行为回归、浏览器或远程 E2E，未启动服务、提交、推送或操作远端。深浅主题/手机视觉及真实传输仍在 PLAN 待验。

### 补充浏览器与传输回归授权

用户随后明确要求浏览器验证、增加 E2E 并修复到远程通过。本地复用正式 Playwright 服务和基线，外置配置仅省略不在本批场景中的桌面服务，报告、浏览器下载和临时目录集中在上述任务目录。根 check、全量格式、双端生产构建、E2E 的 vue-tsc（使用任务目录配置）及文档 257 个本地链接均通过；裸 tsc 无法解码 Vue 导入，改用实际 Vue 编译器后通过，不添加源码 shim 或放宽类型。

12 项传输专项全部通过：六条原生/SFTP路线确实覆盖同大小/时间的不同内容，重复连接/源父目录链接/递归目标均在写入前拒绝，源保留；rsync 移动正确覆盖后才删除来源，原取消/失败/链接回退仍通过。另 10 项浏览器检查分轮通过：新增 6 项 light/dark × 1440/390/320px 检查及原 Docker、快捷命令、Provider、插件来源用例补充真实渲染颜色/对比度断言。18 张目录截图经 Chromium CDP 捕获，实际查看深浅手机目录；文字对比度至少 4.5，名称/类型/标签颜色不同且页面无横向溢出。既有目录/表单操作、密钥入口和弹窗关闭均验。自定义主题、真实触屏设备仍不由此证明。

首两轮保留失败：新测试错误假设密钥弹窗有可访问名称且支持 Escape，已按正式旧组件的标题和 Close 按钮定位，未改产品流程。插件来源用例原来等待公网官方目录才渲染本地仓库；浏览器读取现在显式注入网络失败，校验部分目录失败时仍显示受控第三方来源，官方来源不可覆盖的真实后端 400 断言保持。该用例不是官方公网下载/验签成功证据。新增截图/报告及 round1–3 日志均保留，正式远程整轮另记后续结果，不混用本地结论。

### 首轮远程失败与修正

提交 `c7709d80473bd44c61e5184f463a96d0d6fa3ee2` 的 [E2E 42000466180](https://github.com/0honus0/nexus-terminal/actions/runs/42000466180) 中，质量检查、双端构建、Docker smoke 和六个浏览器分片成功；后端一例失败，另一个浏览器分片一例重试通过，flaky 门禁正确拒绝整轮。跨会话旧用例实际将同服务器同目录复制到自身，现改为验证 conflict 且源内容保持；不同服务器同文本路径的成功复制仍由独立夹具覆盖。本地 round4 通过。

Agent App 生命周期旧用例直接等待公网推荐目录，超过 10 秒而重试通过；现先通过真实 API 安装本地签名 Nexus Agent，验证推荐端点准确返回该安装。新增正式 E2E 执行已有真实 HTTP/SQLite 的官方目录契约测试，控制网络 Adapter 返回，保留固定公钥校验、语义版本排序、无兼容推荐和离线已安装读取，并新增未安装且目录离线时明确 503/provider_unavailable。不是公网下载成功证据；本地 round5 两项通过，产品 UI、生产超时和信任政策未改。远程整轮仍待重跑，失败日志及 round4/5 报告留在本轮任务目录。

### 整轮远程验收与收口

修正提交 `08fdd88dbcb18a1edf303826998705c9d5bb55d4` 的 [E2E 42001858049](https://github.com/0honus0/nexus-terminal/actions/runs/42001858049) 全部成功：根质量与格式、双端生产构建、Docker 部署 smoke、Backend 及七个 Browser 分片均通过。正式 Reporter 共 577 条唯一 passed，零失败、重试或场景跳过；Backend 131 项，Browser 1–7 分别 41/46/53/73/65/83/85。耗时估算更新成功，截图更新任务按条件跳过，非测试场景跳过。本轮相对上一完整基线新增 10 项正式 E2E；生产实现提交为 `c7709d80`，远程修正只涉及用例和验证文档，未削弱生产防护或修改已确认 UI。

本地 round4/5 补跑三项通过后，根 check、全量格式、E2E vue-tsc 与 diff 再次通过。远程日志、准确 SHA/jobs JSON 和逐项统计保留为任务目录的 `remote-final-run.log/json`、`remote-final-summary.json`；首轮失败保留 `remote-first-run.log`。自动提交 `94603a33` 只调整 `scripts/e2e/duration-estimates.json`，已核对后快进同步，不将其作为直接被测 SHA。PLAN 清理本轮已验收施工区，自定义主题、真机和三语/身份交错未覆盖项承接待验区。无数据库变更，不需迁移；没有发布镜像、部署或操作生产数据。本地测试服务已退出，产物按要求保留至用户通知清理。

## 管理列表深浅主题信息层级（2026-11-05，源码与静态）

`main/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 当前工作区：基础 primary 采用中性色，原类型徽标和标签因此接近普通文字；部分次级字段又叠加透明度。现由 Foundation uiCatalog.css 提供名称、信息色类型、主题强调色标签和语义状态配色，六个源码文件覆盖连接、代理、通知、Docker 与工作区连接分组；不改全局按钮、布局、动作、Shared 或持久数据。已审宽窄屏标签、分组优先级、主题变量应用链及原状态投影。

Node 26.13.0 / pnpm 12.16.1：`pnpm run check`、`pnpm run format:all:check`、`pnpm run build:frontend`、`git diff --check` 通过；最后调整工作区次级透明度和分组悬停后，另跑受影响 Vue ESLint、Prettier 与前端构建通过。产物集中于 `/home/honus/nexus-task-artifacts/management-colors-20261105`。contrast.mjs/contrast.json 对默认主题的九类文字和明确实色背景做 sRGB 设计计算，浅/深色最低分别 4.80/6.56；不是浏览器像素检测，不代表自定义主题、手机或实际视觉已验。本轮未启动服务、运行浏览器或正式远程 E2E，待验范围保留 PLAN。

## 连接目录操作与密钥管理入口（2026-11-05，源码与静态）

基于 `dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 的当前工作区：电脑端将密钥管理、测试全部、连接全部横向排列；760px 及以下保留原两枚竖排操作，密钥管理从更多菜单进入。新入口经 ssh-keys/public 复用原弹窗与读写 owner，按需挂载；页面隐藏或身份变化关闭，原批量 SSH 筛选范围保留。无 Shared、后端或数据库变更。

Node 26.13.0 / pnpm 12.16.1 下，`pnpm run check`、`pnpm run format:all:check`、`pnpm run build:frontend` 和 `git diff --check` 全部通过。日志位于 `/home/honus/nexus-task-artifacts/connection-toolbar-20261105`，本轮未启动服务或执行浏览器/正式远程 E2E；宽窄屏三语及弹窗交互仍待行为回归，见 PLAN。

## RDP 证书交付前审核与发布（2026-11-05，已通过并发布）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-证书交付前审核与发布2026-11-05已通过并发布)。

## 配置布局保存冲突（2026-11-05，已通过）

同一页面也可触发：preferences/layout/sidebar/focus共享版本；弹窗打开后保存锁定开关或其它偏好、先flush尺寸任务，原布局保存仍携带打开时版本。无需第二会话或其它用户。修复将弹窗原布局/侧栏内容基线送入Store原队列，只有无关版本变化时使用当前版本，真实内容冲突保留草稿；确定409最多恢复一次，unknown不重放。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#配置布局保存冲突2026-11-05已通过)。

## amd64 dev 发布与交付（2026-11-05）

发布运行 [41987211909](https://github.com/0honus0/nexus-terminal/actions/runs/41987211909) 成功。GHCR 的 dev 与 sha-a7f9aeb79491 同为 `sha256:ceb2172ba6eb1bfb5bcd5ca0be7e28937dde2c4a68091c7787c0e61e23692a3e`，可运行平台为 linux/amd64，OCI revision 为 `a7f9aeb7949106967466460c4a93cf817e02d16d`。生产实例未更新。核验 manifest、发布结果及日志保留在 `rdp-certificate-release-20261105` 任务目录。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#amd64-dev-发布与交付2026-11-05)。

## RDP 证书确认与认证配置核对（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-证书确认与认证配置核对2026-11-05源码与静态)。

## RDP 当前批次审核与正式 E2E（2026-11-05，已通过）

用户授权审核全部当前本地变更、补充用例、提交推送及修复远程E2E。按H-13保留已确认UI，未扩展产品配置或新增库协议；所有既有输入锚点/文件/音频/浮动工具栏源码、三语、依赖锁及vendor固定补丁已审核。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-当前批次审核与正式-e2e2026-11-05已通过)。

### 首轮远程失败与修正

提交79fbba4d的正式远程41971291558：质量、Docker、runner以及Backend和5个Browser分片成功，Browser3/5各失败一项。新增文件批次取消/重连/AudioContext释放4.4秒通过，真实VNC、DPI及pointer resize/minimize通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮远程失败与修正)。

### 最终正式远程结果

修复提交2f580434的完整远程[41972562509](https://github.com/0honus0/nexus-terminal/actions/runs/41972562509)最终success，560项一次通过，无失败、重试或测试跳过。首轮失败的桌面RDP综合场景9.6秒、手机RDP场景7.2秒通过，新增文件批次重连/音频context释放4.2秒通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最终正式远程结果)。

## Windows RDP 实测、顶部工具栏与清理（2026-11-05）

在独立数据库、指定 Windows 目标及 CDP 中验证连接、常用键盘、双向文本/文件剪贴板、顶部工具栏和触屏仿真。临时启动的 Audiosrv/AudioEndpointBuilder 已恢复原 Stopped/Manual 状态。

- `audio-acceptance.json/log`：真实Windows内存WAV产生非零PCM，32次实际AudioBufferSource.start、44.1kHz立体声、峰值0.36624；原AudioContext时钟运行。暂停期间再播放一段真实声音，start计数不增长，恢复后新声音继续播放；重连时原context为closed、新context为running。排程提前量最高35.41ms，实际块约185.76ms；前者不是网络延迟或端到端声音延迟。Headless浏览器静音，不能证明物理扬声器听感；设备报告延迟也不能代表用户真实硬件。
- `file-acceptance.json`及`upload-acceptance.json/log`：远端2048字节二进制下载逐字节及SHA256一致；浏览器文件选择后在真实Explorer粘贴三文件，131073字节二进制、0字节空文件、33字节中文内容，以及中文/emoji文件名全部核对大小和SHA256。仅本次隔离文件，不宣称目录打包、大文件内存或吞吐已测。
- `toolbar-desktop.json`：4组通过，工具栏移出隐藏、所有原控件同一顶部区域且画面几何不变、Enter/Esc焦点、文件面板超出悬停仍可见及Esc关闭。`window-acceptance.json/log`另4组通过：实际点击锚点偏差小于3px、最小化/恢复不断线、全屏/Esc不断线及恢复浮动工具栏、改宽后仍保持完整高度。原显示区域1062×754，现1062×856，释放102px的上下固定占用。
- `mobile-acceptance.json/log`：390/320px Android UA与真实CDP touch事件仿真通过；顶部展开/桌面点击收起、全部控件无横向溢出，320px文件面板开关及关闭连接通过。三份UI结果pageerror均为空，截图toolbar-desktop-open/hidden、window-desktop及toolbar-mobile-390/320保留。这是浏览器仿真，非原生手机键盘或输入法候选窗口验收。
- `services-restored.log`、`remote-cleanup.log`核对服务原状及远端临时目录删除；`cleanup.json`列出本次和可确认前序临时目录/缓存/工具包/旧trace删除，两个专用Docker镜像及按确切ID匹配的66条本轮构建缓存清理。自建9998/3001/29222及旧43669监听、目标13389测试TCP均已释放，临时数据库/凭据/profile/浏览器二进制已删除；保留产品源码/vendor包、项目node_modules、Node26/pnpm12工具与精简日志。最终磁盘已用16664788992字节（15.52GiB），可用约13.32GiB；与初次约29GiB相比已明显回落，未操作其它项目镜像或用户数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#windows-rdp-实测顶部工具栏与清理2026-11-05)。

## RDP 音频输出（2026-11-05，源码与构建）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-音频输出2026-11-05源码与构建)。

## RDP 输入法定位与文件剪贴板（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-输入法定位与文件剪贴板2026-11-05源码与静态)。

## 依赖升级提交与正式远程验收（2026-11-05，完成）

用户授权提交推送并等待本次完整E2E。复核所有4份workflow引用的11种Actions，均与本轮官方release盘点一致；5份清单共121条依赖声明和catalog/overrides已核对。Vue3 draggable、TS6前端别名、SheetJS官方包及IronRDP锁定上游构建保持实际适用来源，不将npm旧latest标签作为降级目标。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖升级提交与正式远程验收2026-11-05完成)。

## 依赖、Node 与 Actions 升级（2026-11-05，静态与构建）

工作区为 `main/e79cf838` 的本轮未提交变更。官方 Node release index 确认最新正式稳定版26.13.0 LTS（Lithium），27 alpha未采用；npm metadata确认pnpm12.16.1及升级版本，Actions按各官方最新正式release更新。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖node-与-actions-升级2026-11-05静态与构建)。

## 聊天 GIF 与图片预览容量（2026-11-05，源码、静态与限定 CDP）

环境为`/home/honus/nexus-terminal`的`main/92e7f996`未提交工作区，Node v22.23.1、pnpm 11.28.10；pnpm来自`/home/honus/nexus-task-artifacts/agent-chat-controls-20261104/tools/node_modules/.bin`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#聊天-gif-与图片预览容量2026-11-05源码静态与限定-cdp)。

## Agent 提醒、会话列表与虚拟历史（2026-11-05，源码、静态与限定 CDP）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-提醒会话列表与虚拟历史2026-11-05源码静态与限定-cdp)。

## 手机后台恢复后的挂起目录同步（2026-11-04，源码与只读排查）

用户要求排查指定实例运行中手机后台返回、重连失败后刷新列表持续加载，并确认原标签为蓝色。只读SSH核对实际Backend为2b0ab3db、17:03:29 UTC启动；没有重启、修改配置/数据库、发起应用登录或接管用户会话。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机后台恢复后的挂起目录同步2026-11-04源码与只读排查)。

## Agent 输入工具栏图标与对齐（2026-11-04，静态检查）

本轮基于main/9a324a75，仅调整AgentAppSurface及唯一NativeInputArtifacts消费者的布局。SSH目标统一使用既有square图标触发器，保留可访问名称、悬停提示和选择面板，删除旧摘要和对应隐藏规则；模型、思考、目标、权限和停止靠左，文件与发送靠右。图标及附件组不收缩，模型名称沿原flex收缩省略。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入工具栏图标与对齐2026-11-04静态检查)。

## Agent 聊天悬浮区与输入工具栏修正（2026-11-04）

本批基于main/b6bd3b25。用户反馈手机Token/上下条状态行下半部分仍遮挡消息，同时要求权限/添加文件具备SSH目标同款边框、手机隐藏目标数量；授权提交推送、处理远程E2E与发布main dev，沿用linux/amd64，不更新生产。本批按D17执行源码/静态与正式远程测试，不启动本地业务环境。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-聊天悬浮区与输入工具栏修正2026-11-04)。

## 终端工具栏响应优化（2026-11-04，浏览器及远程回归通过）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端工具栏响应优化2026-11-04浏览器及远程回归通过)。

## 工作区尺寸自动保存冲突（2026-11-04，限定浏览器回归通过）

只读排查指定远程实例：生产revision为7262e8ac，14:26:26.894及14:26:51.367 UTC的PUT /api/v1/settings/layout返回409（auditId1504/1506），此前及间隔内preferences写入成功。SQLite只读核对presentation记录仍存在、version136；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#工作区尺寸自动保存冲突2026-11-04限定浏览器回归通过)。

## 连接编辑清除凭据布局（2026-11-04，静态检查）

基于main/fac0f2ee，ConnectionForm将清除凭据勾选项移到密码输入框右侧，SSH密钥模式放在选择框右侧。源码核对原输入ID、凭据可见条件、清除后禁用、密码留空保留及保存/取消调用链；复用原UiInput/UiCheckbox，输入可收缩，清除项不换行，无新请求或状态owner。USAGE及PLAN同步。用户随后要求审查代码并提交推送；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#连接编辑清除凭据布局2026-11-04静态检查)。

## 插件市场更新确认弹窗（2026-11-04，限定浏览器验收通过）

工作区基于main/d81823bb，将PluginManagementSettings顶部候选包确认区移入共用UiModal；安装及两步升级继续使用原契约。用户明确授权“本地两个修改都用浏览器验证下 没问题提交推送”，作为D17的限定例外。证据保留于`/home/honus/nexus-task-artifacts/plugin-market-modal-20261104`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#插件市场更新确认弹窗2026-11-04限定浏览器验收通过)。

## Agent 聊天工具状态与悬浮控件（2026-11-04，限定浏览器验收通过）

工作区基于main/c202c152，本轮仅修改前端聊天展示及对应文档；用户随后明确授权提交推送，未发布或部署。证据保留于`/home/honus/nexus-task-artifacts/agent-chat-controls-20261104`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-聊天工具状态与悬浮控件2026-11-04限定浏览器验收通过)。

## 远程数据库维护与镜像更新（2026-11-04，已完成）

用户在镜像发布后明确授权维护远程数据库及更新镜像。目标仍为指定主机的`/home/honus/product/nexus_terminal`，原双容器健康、源码4a3074da，数据库为旧plugin-apps签名；4个Agent Run均completed，29份上下文缺systemPrompt，压缩/检查点/子任务记录均0。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远程数据库维护与镜像更新2026-11-04已完成)。

## Agent 执行补充回归与 amd dev 交付（2026-11-04，已完成）

用户最新授权补充E2E、提交推送plugin与本体，并在完整远程测试通过后发布main的amd dev。宿主从f789446f工作区接续，保留最小化提醒及全部六项执行优化；官方插件d5dd455/v1.0.3已发布，复核main与tag、公开Release一致且插件工作区干净。本轮不更新远程部署、用户数据库或运行本地行为测试。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-执行补充回归与-amd-dev-交付2026-11-04已完成)。

## Agent 执行与插件扩展（2026-11-04，源码静态及插件发布）

宿主基线main/f789446f及前序未提交最小化提醒；Node v22.23.1、pnpm 11.28.10。本轮按用户“全部修改”、工具接口可破坏性更新、插件更新后发布及同后端格式的授权实施。产物集中 `/tmp/nexus-agent-flow-plugin-implementation-20261104`，全部原目录保留；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-执行与插件扩展2026-11-04源码静态及插件发布)。

## Agent 最小化任务提醒（2026-11-04，源码/静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-最小化任务提醒2026-11-04源码静态)。

## 累积变更审核与正式远程 E2E（2026-11-04，已完成）

用户最新要求审核当前全部变更、修复残余并推送解决正式远程E2E。本批从main/ce7c135e及累积50个文件工作区继续，不回退前序修改；保留已有RDP提交，覆盖SSH连接、注销反馈、维护清理、终端响应和Agent可编辑硬限制。仅授权正式远程Actions，本地仍不新增行为/CDP/全量E2E、不操作用户数据库或发布镜像。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#累积变更审核与正式远程-e2e2026-11-04已完成)。

## 终端连接等待优化（2026-11-04，源码及静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端连接等待优化2026-11-04源码及静态)。

## RDP/VNC 绘制性能验证（2026-11-04）

环境为 Node v22.23.1、puppeteer-core 25.16.0、HeadlessChrome 156.0.8078.47 与 SwiftShader/软件 Canvas，未使用硬件 GPU。原产物目录为 `/tmp/nexus-rdp-render-performance-20261104`；下文日志及快照路径均相对该目录，历史路径不保证仍存在。

先比较原生Canvas backbuffer、零复制行视图、只合并新区域与全区域最小面积配对。Canvas方案像素正确，但4K条带CPU中位数7.2→15.9ms，未采用；行视图无稳定收益，只合并新区域无法稳定保留4K分散更新的收益，均未进入产品。最终保留原像素底图，只在超量时合并新增重绘面积最小的一对，扫描最多33个区域的528对，恢复至原32区域预算。

最终108轮：3种分辨率×6场景×3轮×基线/候选交错顺序。每轮54帧，前9帧暖机，统计45帧；每格为3轮每帧CPU耗时中位数的中位数（ms，改前→改后）。CPU口径为同步像素入队/复制加rAF内原生Canvas提交，不包含等待下一帧、RDP解码/传输或完整浏览器合成。

| 更新场景             | 1920×1080 | 2560×1440 | 3840×2160 |
| -------------------- | --------- | --------- | --------- |
| 分散小块，64×48×96   | 4.0→4.1   | 6.5→6.1   | 12.8→6.4  |
| 窗口块，320×180×12   | 3.2→2.9   | 4.0→4.0   | 4.6→4.5   |
| 全宽条带，64行×12    | 3.2→3.1   | 4.7→4.8   | 7.7→7.8   |
| 文字，64×20×1        | 0.1→0.1   | 0.1→0.1   | 0.1→0.1   |
| 640×480内局部小块×96 | 1.7→1.9   | 1.8→2.0   | 2.0→2.0   |
| 高密度小块×384       | 9.0→9.0   | 10.9→11.3 | 19.0→18.4 |

4K分散更新每帧平均提交面积8,081,311→1,396,117像素（减少82.7%），调用1→32次但均在同一rAF完成，CPU中位数减少50%。其它场景改善有限；局部更新与部分密集场景有0.1–0.4ms的耗时上浮，未把这些变化报告为普遍提速。4K高密度更新仍超过16.7ms帧预算；未测真实服务器、网络、解码、硬件GPU或端到端帧率，不能宣称真实RDP速度翻倍或消除逐块刷新。

13项像素/生命周期验证通过：分别对改前和最终模块与原生putImageData逐字节比对部分/重叠/透明/负裁剪、输入立即清零模拟WASM复用、超过32个分散区域及未更新间隙、尺寸重建和同尺寸width/height清空、小数输入原生回退、待绘时关闭及实例方法/属性恢复、RangeError与超过32MiB后的同步直接绘制。另运行已安装noVNC 1.7.0真实Display，确认dirty在backbuffer且flip前不可见、flip后呈现；该项不等同VNC网络或编码性能验证。

根 `pnpm run check`、`pnpm run build:frontend`、`pnpm run format:all:check` 均退出0，日志为本目录check.log/build.log/format.log；最终文档目标Prettier与 `git diff --check` 通过。真实模块与测量快照SHA256均为 `bec03c828988b3c459b48ea1f19007aa60744f65a52a0be2a67dd548c3184153`。本轮未运行全量E2E或远端部署，全部自建浏览器/环回服务由脚本关闭，测试目录与产物保留至用户通知。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdpvnc-绘制性能验证2026-11-04)。

### 浏览器性能及像素证据

Node v22.23.1、puppeteer-core 25.16.0、HeadlessChrome 156.0.8078.47，独立环回HTTP服务、CDP和浏览器profile均在上述目录；浏览器实际为SwiftShader/软件Canvas，无硬件GPU。基线是改前真实presenter快照，最终候选由 `benchmark-final.mjs` 直接编译工作区真实模块；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#浏览器性能及像素证据)。

## 主动退出的错误提示隔离（2026-11-04，源码与静态）

用户反馈正常退出弹“操作失败／个人数据请求失败，请重新读取”。源码确认：useAuthenticatedViewScope的available/activated原先能在认证已撤销后重新建立scope；个人历史/快捷指令的error观察未核对view，通知的重读动作也未绑定原意图；LatestValueSaver失败回调只有error，工作区自动保存及字体回调未核对原permission；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#主动退出的错误提示隔离2026-11-04源码与静态)。

## 清理工作流超期空排队与执行日志（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#清理工作流超期空排队与执行日志2026-11-05源码与静态)。

## 两包镜像清理保留规则（2026-11-04）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#两包镜像清理保留规则2026-11-04)。

## 终端翻页与缩放响应（2026-11-04，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端翻页与缩放响应2026-11-04源码与静态)。

## 可编辑硬限制与固定门槛清理（2026-11-04，源码审核）

用户要求继续去除可编辑硬限制之外无底层依据的常量上界。沿前序模型请求数修复及当前未提交工作区实施，默认预算、默认硬限制和UI不变，未提交推送、部署或操作数据库。产物集中 `/tmp/nexus-editable-hard-limits-20261104`，保留至用户通知。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#可编辑硬限制与固定门槛清理2026-11-04源码审核)。

## 模型请求数硬限制可调整（2026-11-04，源码审核）

用户希望把硬限制模型请求数设为800，却提示最大400。基线 main/ce7c135e 加前序本地SSH、退出提示、维护与终端响应变更；本批未提交推送。源码确认Shared AGENT_EXECUTION_LIMIT_MAXIMA.maxModelRequests=400被前端硬限制QuantityInput、HTTP codec、ExecutionService与存储行解码共同消费；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#模型请求数硬限制可调整2026-11-04源码审核)。

### 独立 Nexus Agent 1.0.2 提交发布（2026-11-04）

用户要求提交发布此前精简。独立仓库 main `790ccdec91c4c88632d9f90f0378e41d0f9cc4d2` 提交六文件：两份Skill、NexusAgent manifest1.0.2、根版本与README/目录说明；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#独立-nexus-agent-102-提交发布2026-11-04)。

### 设置读取恢复与推荐安装默认授权（2026-11-04，远程回归完成）

用户继续授权只读排查指定 Nexus 主机；本轮 SSH 仅读取 backend 最近3小时/最多5000行 Compose 日志，未修改远端文件、配置、数据库或容器。实际日志66行，范围07:01:09.324Z–07:08:49.789Z，未找到对应设置 GET 失败，execution-settings PUT 为200且 responseFinished=true；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#设置读取恢复与推荐安装默认授权2026-11-04远程回归完成)。

### 本轮 dev 镜像发布（2026-11-04，完成）

[41792924820](https://github.com/0honus0/nexus-terminal/actions/runs/41792924820) 成功发布 main `4a3074da6f8ab7e515a017f949ce03b1d059dc88` 的 linux/amd64 镜像。生产依赖审计成功；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本轮-dev-镜像发布2026-11-04完成)。

### Agent 安装与插件仓库布局（2026-11-04，源码及静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-安装与插件仓库布局2026-11-04源码及静态)。

### Artifact 总空间统一（2026-10-26）

范围：删除单文件设置及固定16MiB Artifact/图片、8MiB截图业务上限，取消10,000项累计文件准入，读取偏移跟随Shared协议容量；生成/截图/下载预检总剩余空间，最终begin事务保证总配额。文件库增量hash与Range分段下载复用现有入口，无额外UI变更。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#artifact-总空间统一2026-10-26)。

### 文件管理器预读20ms（2026-10-26）

原useFilesystemBrowser的PREFETCH_DELAY_MS由50改为20；FileManager普通目录、“..”鼠标停留及键盘定位共用此入口，后继最新候选补调度也引用同一常量。两轮源码审核核对入口与两处定时器，以及缓存命中、单个预读、最新候选、点击复用、离开/失活/dispose取消和revision围栏，无其它代码改动。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器预读20ms2026-10-26)。

## WebSocket 周期保活（2026-10-26，源码及静态）

范围：Platform HTTP listener 的既有 channel/raw WebSocket，每25秒以 ws 标准 Ping 保活，浏览器自动 Pong；无 UI、Shared 或业务消息变化。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#websocket-周期保活2026-10-26源码及静态)。

## 全部本地变更审核与远程回归（2026-10-26，已完成）

用户授权审核、提交全部本地代码并修复远程E2E。两轮分组源码审核覆盖 Agent Run/Step/Tool/Child、预算和模型SDK重试、上下文摘要与标题、批准分页/策略、模型来源、Artifact空间与分块下载、前端流合并/乐观消息/目标记忆、终端生命周期/输入恢复、Workspace附件流控及WS保活；保留已有授权UI变更，本轮不增加UI设计修改。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#全部本地变更审核与远程回归2026-10-26已完成)。

### 首轮远程构建反馈

提交1f21e469推送dev，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40259908812 。质量作业通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮远程构建反馈)。

### 首轮功能失败分类（40259908812）

通过分片4/5/7。产品：备份503（agent_runs approval_mode登记位置与PRAGMA顺序不符）、Custom SDK连接中（trace确认/sdk/common/version.js缺失CORS响应，静态白名单漏新SemVer依赖；改为esbuild单模块交付）、预览刷新点击被透明缩放padding截获（仅修命中，无外观调整）。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮功能失败分类40259908812)。

### 第二轮远程反馈（40261572646）

3bb022fd对应 https://github.com/0honus0/nexus-terminal/actions/runs/40261572646 ：质量、Docker构建/启动冒烟及分片1/2/4/5/6/7通过；分片3/8各剩一个旧测试入口。前轮备份503、Custom SDK依赖交付、预览刷新遮挡均已通过真实远程回归；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第二轮远程反馈40261572646)。

### 第三轮远程反馈（40262842979）

e2f66bdf对应 https://github.com/0honus0/nexus-terminal/actions/runs/40262842979 ：质量、Docker及分片1/2/4/5/6/7/8通过；分片3仅完整插件审批出现一次flaky，重试后命令、unknown与上传/下载完整流程均通过，failOnFlakyTests正确阻止假绿。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第三轮远程反馈40262842979)。

### 最终验收：第四轮全绿（40263876745）

代码提交fc5845fd97be449e11bb1b58b03ab2b9150af481，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40263876745 结论success。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最终验收第四轮全绿40263876745)。

## 前端无效CSS清理（2026-10-26，源码及静态）

范围：仅删除无实际消费者的样式，不修改UI效果、模板/脚本或交互。复用已安装的Vue compiler-sfc、PostCSS与selector parser做临时审查（/tmp/nexus-css-audit.cjs），扫描91个样式源、2663条规则并得到126个候选选择器。工具输出不是删除依据；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#前端无效css清理2026-10-26源码及静态)。

## CSS清理交付、dev amd64与原站点升级（2026-10-26，已完成）

代码0fc60b7b127e699efffe99c89987b39b3a78a9bf推送dev。正式E2E https://github.com/0honus0/nexus-terminal/actions/runs/40265599805 完整success：463通过、0失败/0 flaky，8分片、根质量/格式/build和Docker smoke成功；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#css清理交付dev-amd64与原站点升级2026-10-26已完成)。

### 原部署识别及用户明确的数据处理选择

容器Compose标签定位原部署/home/honus/product/nexus_terminal，原NEXUS_DATA_DIR为./data，公开Origin为https://ssh.honus.top。旧镜像cb693e4c、数据库signature为backend-next-v1-initial-20261023-remote-tool-installer；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#原部署识别及用户明确的数据处理选择)。

### 数据和入口验收

远程备份目录/home/honus/product/nexus_terminal/upgrade-20261026T035324Z（0700）：data-env-compose-before-upgrade.tar.gz、nexus-terminal-before-upgrade.db及previous-data完整旧目录；包含实例密钥，保留root权限，不上传仓库。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#数据和入口验收)。

### 挂起关闭恢复画面几何修复（2026-10-26）

截图显示恢复后的TUI底部重复提示及空白；源码核对确认快照尺寸缺失、重复PTY resize和checkpoint尺寸排队问题。既有SSH `resizing a suspended fullscreen terminal is ordered after its checkpoint`同步验证baseline尺寸先于快照、live尺寸在快照之后；保留原快照正文断言。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#挂起关闭恢复画面几何修复2026-10-26)。

### Codex挂起恢复：高延时与滚动区域定向验证（2026-10-26）

用户明确授权api.honus.top的Codex测试及高延时时序排查，本轮限定该链路。使用独立Chrome/CDP与自建测试SSH会话，未接管用户现有终端；初次共享浏览器的恢复定位存在歧义，其结果作废，后续按精确suspend ID隔离。普通静止、执行中排队、75×28窄窗口恢复，以及WS上行700ms/下行900ms（实际往返约1.9秒）均保留输入区背景，未直接稳定复现原截图。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#codex挂起恢复高延时与滚动区域定向验证2026-10-26)。

### 终端逐字符真实回显优化（2026-10-26）

源码沿前端onData→sendConnected→WS terminal.input→requireTerminal→Workspace.write→ssh2 channel及原输出链核对：前端发送/前台输出没有固定防抖；Workspace WS入口仅派发任务，不等待文件操作执行完成，不能把Platform串行消息接收误判为终端等待目录请求完成。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端逐字符真实回显优化2026-10-26)。

### VS Code TypeAhead 移植定向验证（2026-10-26）

本轮沿用户对 api.honus.top 的终端/高延时专项授权，未运行全量本地 E2E、模型请求或修改真实 SSH 文件。复用 VS Code 固定提交 ae11932c6109d3977d78f2fe8937d861e246151d 的 MIT 核心，来源和适配差异见前端 vendor README。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#vs-code-typeahead-移植定向验证2026-10-26)。

### 文件管理器纵向拖动与固定命令栏（2026-10-26）

用户报告api.honus.top连接后文件管理器无法向上拖动。原因是同一纵向Splitpanes中terminal/commandBar/fileManager三项只调整相邻Pane，而commandBar只有38–42px可调整区间；仅打开pushOtherPanes又会遇到库的最大尺寸提前返回、after-pane漏算后续兄弟，以及前侧全部到最小值后重复扣减前序尺寸的问题。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器纵向拖动与固定命令栏2026-10-26)。

## Agent 步骤与工具审计移除（2026-10-26）

删除正式 Host/审批卡片及 DEV 页的审计入口，撤销四个专用查询端点和 Shared 审计 DTO。保留步骤/工具状态及内部事件事务，供执行、审批、异常恢复和快照一致性校验。回归改用线程工具列表核对 ACP 和工具终态，继续验证审批 hash、命令预览、真实副作用和取消围栏；插件用例核对审计入口消失及 Run 用量仍可读取，后端 HTTP 用例核对已移除端点 404。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-步骤与工具审计移除2026-10-26)。

### 2026-10-26 自动图片与远程回归修正

- functional-regressions：本地受控 Provider 返回 PNG Base64，模型调用 image_models_list/image_generate，结果只允许文件事实，最终仅回答普通文字。验证审批前无预览、完成后图片实际解码/下载、刷新恢复。无需真实付费图片请求。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-26-自动图片与远程回归修正)。

### ZIP特殊节点与连续拖动补修（2026-10-26）

- 生产只读日志：ssh.honus.top / pve_debian两次压缩在inspectSources非常规文件预检以invalid_input失败；尚未发布本轮ZIP代码，未宣称生产实测通过。 - 原生Info-ZIP实测：普通文件、空目录、FIFO和Unix socket组成的目录，zip退出18，FIFO被忽略、socket报警且添加日志不等于实际入包；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#zip特殊节点与连续拖动补修2026-10-26)。

### 原生压缩直接递归与限制移除（2026-10-26）

生产只读核对：后端已运行revision `7f8ff3ff9e54594a991e48451baafacb63991125`，最新压缩失败为 `limit_exceeded`，位置 `/dist/modules/remote/files/model/file-resource.js:436`，对应 `scanEntries` 的应用条目预算；不是旧镜像未更新。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#原生压缩直接递归与限制移除2026-10-26)。

## 文件容量清理后续回归

aba02d2f正式Actions 40316497521：质量、构建、Docker及分片1/3/4/5/7/8通过；分片2的mutation fixture使用了重复cwd路径，下载用例仍期待已移除的8任务429；分片6目录force删除把1小时剩余期限传入SSH execute时，被旧5分钟参数检查拒绝，Model因派发状态不明退役文件资源。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件容量清理后续回归)。

### 跨服务器直传优先与中转共用链（2026-10-26）

跨会话剪贴板与发送到服务器共用copyRemoteEntries/RemoteFileModel.copyDirect。正式新增direct-and-relay-transfer六例：两个入口各测源到目标可达/不可达，8MiB单ZIP二进制的中间进度、精确SHA256、实际rsync/sftp方法；夹具记录直传零SFTP READ字节，中转READ字节等于文件大小；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器直传优先与中转共用链2026-10-26)。

### Agent 输入区状态栏整合（2026-10-26，本地静态）

将 Token 统计、上一条／下一条和回到最新消息纳入聊天输入区共同外框。两轮源码复核确认全部事件、显示条件和按钮禁用表达式保留；UiButton 默认 button，不触发表单提交；Token 弹层沿原 portal，宽度测量仍归原 form，状态行进入既有窄屏容器查询。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入区状态栏整合2026-10-26本地静态)。

### 手机 Agent 会话抽屉背景（2026-10-26，本地静态）

窄屏 `agent-hub-window <= 760px` 中的会话侧栏改用主题 header 背景，覆盖玻璃材质的透明混色；桌面、宽度、层级、遮罩及 inert/显隐保持。两轮源码复核覆盖选择器作用范围、CSS layer 优先级和默认深浅主题。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机-agent-会话抽屉背景2026-10-26本地静态)。

### 前端冗余功能门槛（2026-10-26，本地静态）

移除连接创建/导入/导出仅前端500项与本地1MiB上限、附件10项及多选静默截断、公钥确认排队64项拒绝、传输详情5项裁切及目录读取8个在途拒绝。协议分批、逐项严格解码、权限/取消/未知结果保护及缓存LRU保留，UI布局与样式未改。两轮源码复核覆盖导入全批预检/部分成功回执、串行上传首失败停止、信任队列取消、目录去重/失效/真实错误传播、传输滚动容器。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#前端冗余功能门槛2026-10-26本地静态)。

### 列表记录可达与分页完整性（2026-10-26，本地静态）

传输API删除累计160项协议拒绝，保留逐页严格解码、递增游标及跨页重复ID拒绝；Agent会话搜索沿既有游标串行读取后续页，不再只查首50条，清空搜索/失活/禁用/未决写入停止新页，失败进入原重读围栏。未改模板、样式或布局。两轮源码复核包含刷新/搜索变化、分页期间失活、错误不自动重试、旧结果归原owner，以及其它列表的分页/完整入口。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#列表记录可达与分页完整性2026-10-26本地静态)。

### 跨服务器剪贴板页面实时进度（2026-10-26，本地静态）

`ssh/direct-and-relay-transfer.spec.ts` 新增两个浏览器用例，分别覆盖原生直传和不可达时的SFTP中转：登录、连接两个SSH标签、文件管理器复制、切换目标标签并粘贴、确认凭据交付。传输真实8MiB样本，沿用夹具带宽控制，DOM观察要求至少两个递增的中间百分比与正确字节总量；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器剪贴板页面实时进度2026-10-26本地静态)。

### 本批最终正式验收（2026-10-26）

产品/测试源码`dd7a558b572a4bb510ca70531d95f691967a7604`的[Actions 40347041664](https://github.com/0honus0/nexus-terminal/actions/runs/40347041664)全部成功：质量、生产构建、Docker部署冒烟和8个分片共494项首次通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批最终正式验收2026-10-26)。

### Agent 输入框外侧玻璃底色（2026-10-26，本地静态）

按用户指定doc截图，移除AgentAppSurface输入区footer的ui-glass-chrome材质类，使外侧不再铺满导航玻璃底色、渐变和内高光。两轮源码复核确认只改该footer的一个类，输入框自身边框/焦点反馈、原间距/响应式尺寸、Token与跳转控件、公共玻璃材质定义和其它界面保持。USAGE对应输入区章节已同步。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入框外侧玻璃底色2026-10-26本地静态)。

### 矮状态面板网络读数（2026-10-26，本地静态）

按doc服务器状态截图，沿原max-height:210px分支将网络标题与上下行速率改为左右同排；移除network-reading的0.68em父字号，将数值从0.58em恢复为与紧凑指标一致的0.76em，箭头保留独立字号及两方向间隔。紧凑加载骨架同步单行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#矮状态面板网络读数2026-10-26本地静态)。

### Agent 输入框上方独立控件（2026-10-26，本地静态）

按用户最新布局要求将Token、回到最新、上一条/下一条状态块移至form之前；只保留各自全局控件，无整条底色或边框。原footer透明表面保留。composer容器声明从form移到既有外层agent-composer-area，使上方控件和输入工具栏继续按相同可用宽度响应式收缩，不依赖整个聊天面板宽度；form测量ref、提交、键盘、详情弹层和导航条件/事件保持。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入框上方独立控件2026-10-26本地静态)。

### Agent 控件与紧凑网络读数交付（2026-10-26，正式远程通过）

产品提交 `7865bfc159b0ca750f80d06f93d01125576c695d` 的正式 [E2E 40355305638](https://github.com/0honus0/nexus-terminal/actions/runs/40355305638) 全绿：质量、格式、生产构建、Docker 部署 smoke 和全…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-控件与紧凑网络读数交付2026-10-26正式远程通过)。

### 文件管理器路径栏垂直对齐（2026-10-26，本地静态）

路径原生输入框使用 flex stretch 跟随栏内高度、清除原生 margin，行高由 1 改为 normal，保留栏高、字体大小及各响应式断点。两轮源码复核确认左侧图标与父层 items-center、输入/导航/历史事件及焦点反馈保持。根 check、前端 build、全量 format:all:check 与 git diff --check 通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器路径栏垂直对齐2026-10-26本地静态)。

### 跨服务器安装准备与 SCP 性能（2026-10-26）

根因：amd 缺 rsync，RemoteFileModel 将 auto 强制映射为 rsync，阻断 Native adapter 原有 SCP 候选，退至 SFTP 中转。现在原样传递 auto，复制与发送复用已有远端依赖确认；用户跳过 rsync 安装后，普通文件再检查 SCP，跳过 SCP 后才中转。自动目录在 rsync 不可用时保留 SFTP 链接语义；不为此扫描目录。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器安装准备与-scp-性能2026-10-26)。

### 远端工具默认选择、归档依赖与安装全流程（2026-10-26，本地静态）

逐项核对跨服务器粘贴、发送、ZIP/tar.gz/tar.bz2压缩与解压、普通SFTP文件操作、目录下载、服务器状态、Docker和Agent执行。修正ToolService的auto检查提前选择现有SCP、跳过默认rsync安装提示的问题，客户端严格验证预期工具；前后端共用archiveToolRequirements，归档一次只读预检包含压缩器及校验/快照/链接工具，早于写入；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远端工具默认选择归档依赖与安装全流程2026-10-26本地静态)。

### 图片生成 HTTP 400 内容审核拒绝（2026-10-26）

用户指定 ssh.honus.top 的图片失败已通过宿主只读日志及 SQLite 关联：部署镜像 revision 为 a797ecd2bf7967541e5ee52acfa031fd683d5845，Run `25e2515b-f3bb-4e29-8ac7-c08af21c2cda` 的 image_generate 使用 gpt-image-2.5，约 43 秒后失败。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#图片生成-http-400-内容审核拒绝2026-10-26)。

### 矮服务器状态面板网络读数间距（2026-10-27）

已读取用户 doc 截图：服务器状态处于矮面板单行模式，网络上下行读数均出现省略号。用户授权缩小左右留白与字体；改动仅在原 `max-height:210px` 容器分支，收紧非趋势内容边距、卡片内距、图标/标签/上下行间隔，并将速率字号结合实际容器宽度计算。正常高度布局、趋势内容留白、速率格式、配色和完整 title/aria-label 保留。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#矮服务器状态面板网络读数间距2026-10-27)。

### 远端工具准备、SCP 进度与图片拒绝诊断正式验收（2026-10-27）

产品/测试提交 `0f174219ca0cdac181035d57a33b42b8ec339732` 的正式 [E2E 40382042043](https://github.com/0honus0/nexus-terminal/actions/runs/40382042043) 全部成功：质量、格式、双端构建、Docker 部署 smoke 与全部 8 分片，共 526 项首次通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远端工具准备scp-进度与图片拒绝诊断正式验收2026-10-27)。

### Agent 会话列表删除按钮居中（2026-10-27，本地静态）

NativeThreadPanel 列表行为 items-stretch，全局 UiButton 固定高度配 my-1 使右侧按钮靠上；按钮改用 self-center 并移除垂直外边距，按整行居中。全局按钮尺寸/危险色、禁用态、再次点击确认及选择/搜索事件保持，USAGE 对应章节已同步。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-会话列表删除按钮居中2026-10-27本地静态)。

### Agent 工具卡片调用详情（2026-10-27）

本批新增单调用认证 GET，卡片展开后展示完整格式化参数 JSON 与持久失败码对应说明；加载失败仅重读详情，取消/未知不宣称远端回滚。源码两轮核对范围为 user/App/Run/tool 身份、Shared 严格解码、逐字段投影、原列表容量、失败码白名单、页面失活/卸载取消及 revision 晚响应保护；没有 schema 改动。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-工具卡片调用详情2026-10-27)。

### Agent PHP/Typecho 规划任务与资源错误分类（2026-10-26）

本轮按用户明确要求，只读核对 ssh.honus.top 所在线上指定线程 `4b7dd2b9-bdfc-4064-8c16-e1cd21471938`、Run `8cd50043-c9dc-40f4-ad0a-9dc3abdc3f0c`。原提示要求“先定好计划”：Run completed，12 个模型步骤、15 次只读工具调用，无部署/启停/写入工具；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-phptypecho-规划任务与资源错误分类2026-10-26)。

### 服务器状态卡片左右留白（2026-10-26）

用户授权收紧卡片左右外侧空隙，原 StatusMonitor.css 同步修改指标与加载列表水平 padding，去掉窄栏内容覆盖并同步矮栏骨架。两轮源码核对普通/150px/118px 窄栏、210px/270px 矮栏、趋势与手机覆盖次序；卡片内部间距、纵向尺寸、触控区域和数据逻辑保持。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#服务器状态卡片左右留白2026-10-26)。

### 文件管理器 `..` 返回行紧凑高度（2026-10-26）

用户授权缩小父目录返回行：只为父行单元格设置更小垂直 padding，移除父行名称原有底部留白；其他文件行、缩放、点击/键盘、20ms 预加载、右键和拖入不变。两轮源码核对全部可见列单元格与 CSS 优先级，父行仍独立于虚拟条目和 spacer，不修改虚拟文件行尺寸。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器--返回行紧凑高度2026-10-26)。

### 工具详情及界面细节本批正式回归（2026-10-27，待远程）

本轮补充既有图片成功/三类拒绝用例，验证持久工具详情、错误 Run 返回 404、展开卡片后的格式化参数与安全失败码，不改变图片预览、下载、内容审核及不重试断言。其余源码静态证据见上述各节。用户授权整批提交推送，完整正式 E2E 成功后发布 dev linux/amd64；不更新生产容器。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#工具详情及界面细节本批正式回归2026-10-27待远程)。

### 手动清理 workflow（2026-10-27，静态待验）

新增 cleanup-history.yml 与维护脚本；仅手动触发，无 schedule/push/release。源码审核两轮核对包/仓库范围、latest/dev 多层 manifest 与证明闭包、渠道移动围栏、历史运行/产物保留、缓存删除、活跃运行与权限失败路径。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理-workflow2026-10-27静态待验)。

### Actions 恢复及复制取消竞态（2026-10-27）

手动触发已恢复：40436334225 验证 7810d6ad，检查/格式/构建、Docker smoke 和 6 个分片成功；第 4 分片用例 registered copy progress 首次失败、重试通过，flaky 门禁正确拒绝，不能称全绿。截图与调用日志显示 Cancel 后任务直接消失且没有 unknown Toast。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#actions-恢复及复制取消竞态2026-10-27)。

### 本批正式 E2E 与 dev amd64 交付（2026-10-27，完成）

GitHub Actions 限制已恢复。测试修复提交 `441dcc740660d337b6e7480bbb1f891a90a3079d` 的正式 [E2E 40437638548](https://github.com/0honus0/nexus-terminal/actions/runs/40437638548) 全绿：检查/格式/…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批正式-e2e-与-dev-amd64-交付2026-10-27完成)。

## E2E 依赖拆分与构建复用（2026-10-27）

参考 [Grafana 构建分发](https://github.com/grafana/grafana/blob/main/.github/workflows/pr-e2e-tests.yml)、[Playwright fixtures](https://playwright.dev/docs/test-fixtures)、[项目分组]…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-依赖拆分与构建复用2026-10-27)。

## 最耗时任务优化（2026-10-27，正式全量通过）

上一阶段正式 [40444825177](https://github.com/0honus0/nexus-terminal/actions/runs/40444825177) 在 899d4107 上 526 项首次通过、0 skipped/retry/flaky，完整墙钟 532 秒；原基线 40437638548 为 620 秒。新基线尚不满足用户提速目标。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最耗时任务优化2026-10-27正式全量通过)。

## E2E 功能目录与剩余前端计时等待（2026-10-27，已验收）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-功能目录与剩余前端计时等待2026-10-27已验收)。

## E2E 复制取消与插件分片（2026-10-27，已验收）

优先处理最新实测39秒复制取消和约119秒Agent插件大文件。复制场景改用测试SSH的真实WRITE gate，取消前确认已有写入进入，前端Clock跨32秒原清理边界后确认原WRITE仍阻塞；明确释放后等待真实pending归零及对应任务WS终态，再保留第二文件不存在断言。gate不会因channel close清掉观测，reset先释放再停止旧SSH并等待真实I/O归零。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-复制取消与插件分片2026-10-27已验收)。

## E2E 构建与容器准备重叠（2026-10-27，已验收）

实测40457002804：准备作业60秒；最慢分片后置的容器初始化28.3秒、依赖链接6.6秒、产物下载4.3秒。原依赖将共享构建与全部容器准备串行。本轮将同一次完整构建移入既有quality作业、先上传产物再执行原根检查和全量格式；镜像准备作业提前结束，让8个测试runner同时准备。作业数量与测试并发不变，不改UI/产品/测试断言/隔离生命周期。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-构建与容器准备重叠2026-10-27已验收)。

## E2E 成功传输进度限速（2026-10-27，已验收）

40459146818的protocol成功原生路线单例约13秒、clipboard-ui五条路线每例约15秒；其中真实8MiB样本的1MiB/s夹具传输本身占数秒。本轮只将成功进度场景的rsync/SCP及UI relay现有限速提高至原生3MiB/s、relay 4MiB/s；原生命令约一秒输出一次，保留多次中间采样窗口，保留SSH读延迟和专门2Mbps/10Mbps等弱网profile；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-成功传输进度限速2026-10-27已验收)。

## 手动清理活跃运行修复验收（2026-10-27）

原40483067327因任意其它未完成Actions全局拒绝而失败。脚本现在保留活跃运行/产物，删除前复查重启；有其它活跃任务时跳过镜像和缓存清理，真实权限与manifest异常仍失败。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理活跃运行修复验收2026-10-27)。

## 快速输入回跳与连续退格（2026-10-27，源码及静态完成）

本地dev的TerminalTypeAhead修正：未完成CSI保留至下包、仅光标显隐/报告的包不触发退格空匹配失败；右边界仅限制前向打印，触边不立即撤回旧预测而由HardBoundary等待真实回显；连续DEL按解析顺序逐字预测，原输入仍只派发一次。原双解析屏障、reset/失活/resize/快照撤销与复杂模式保守策略保持，无UI或协议变更。源码两轮复核完成，未用关闭预测或放宽期限规避。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#快速输入回跳与连续退格2026-10-27源码及静态完成)。

## ZIP 压缩中间进度（2026-10-27，静态完成、行为待验）

根因：取消源目录预扫描后，压缩期间只有 fileCount，没有总数或 percent，原前端按 0% 展示。Native zip 改为 -dc，采集它已有扫描的已处理/剩余条目，Model 逐参数转交，FileService 沿原 transfer.archive 发出 totalFiles/percent；发布验证前不足 100%，成功后才 100%。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#zip-压缩中间进度2026-10-27静态完成行为待验)。

### 传输进度提示统一 Toast（2026-10-27）

浮动进度、隐藏任务及服务器传输详情移除行内警告/错误说明；本地原任务回执补完成警告通知，后台 store 按快照状态/错误变化通知，列表加载和取消/移除失败使用 Toast。两轮源码复核覆盖上传、移动、剪贴板、归档密码重输、后台读取/写入、身份代次及网络错误去重，保留原进度、状态、操作和 CSS。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#传输进度提示统一-toast2026-10-27)。

### 状态趋势真实采样与紧凑刻度（2026-10-27）

用户明确授权启动测试环境并通过 CDP 专项验收，本轮复用已在运行的 3001/9998 环境和 172.30.30.11:9223 中登录 api.honus.top 的浏览器。真实 amd SSH 五类指标 × 1/5/10/30 分钟共 20 组验证窗口跨度、样本在窗内及网络整档刻度；短历史不被压成不可见单点，时间左侧不足部分仍为空。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#状态趋势真实采样与紧凑刻度2026-10-27)。

### 2026-10-27：传输安装偏好、实际工具、TAR 进度与原生文件拖动

新增/扩展远程用例：cross-server-transfer/clipboard-ui 的 SCP/SFTP 跳过安装分支，再次复制不重复弹窗，仍验证协议实际方法、内容摘要；SCP 分支继续模拟后来手动安装，第三次自动重新识别 rsync。保留原字节进度、单调性、直传/中转计数及内容断言。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27传输安装偏好实际工具tar-进度与原生文件拖动)。

### 2026-10-27：趋势静默断采样与安卓前台恢复

前轮趋势修复只处理序号不连续，漏掉“序号连续但时间相隔约 22 分钟”的情况。现在按完整保留历史的实际正向连续间隔下中位数识别明显时间断点（大于两倍），再按所选窗口过滤；不删除旧点、不补造历史、不改变采样频率。既有时间轴 spec 增加真实 SSH/WS 入口注入五个受控采样时间的场景：各范围首个真实时间正确，30 分钟画布保留上下行颜色，但中间无采样区没有两种颜色的连线。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27趋势静默断采样与安卓前台恢复)。

### 2026-10-27：发布前本地正式入口整链专项

用户本轮授权启动测试环境并验证本批修改，随后提交 main、完整远程 E2E 通过后发布 amd64 dev，最后停测试环境。本地使用独立 `/tmp/nexus-release-data-*` 数据目录、3001 正式后端、原9998 Vite 和专用22222 SSH夹具，不覆盖旧实例/生产数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27发布前本地正式入口整链专项)。

### 归档标题移除与隐藏入口百分比（2026-10-28）

归档ProgressCenter终态“移除”移动至任务标题右侧，保留done条件与原remove(task.id)，活动取消/未知副作用处理不变；标题flex-1/min-w-0截断、按钮shrink-0，无局部新样式。WorkspaceSessionSurface对现有progressTasks的已报告进度钳位后等权平均，空列表为0且入口原条件不显示，单任务跟随其百分比；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#归档标题移除与隐藏入口百分比2026-10-28)。

### 项目依赖维护（2026-10-28）

递归outdated初始30项，更新29项直接依赖、catalog、pnpm锁文件及pnpm11.28.9。包括Vue/编译器3.5.44、Vite8.3.5、Monaco0.57.0、Pino10.4.0、Undici8.12.3、MCP2.4.0、OpenAI7.45.0、Playwright1.64.1。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#项目依赖维护2026-10-28)。

## 直传安全提示记忆与网络读数对齐（2026-10-28）

范围：跨服务器粘贴、“发送到服务器”的凭据确认共用“下次不再提醒”；网络速率等宽半栏内居中。两轮源码审核：第一轮追踪两个入口到公共确认 composable、Feedback store/host 与 browser storage，核对取消、替换弹窗、signal、用户切换及原 generation 保护；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#直传安全提示记忆与网络读数对齐2026-10-28)。

### 本轮授权 CDP 专项验收

用户追加“使用cdp确认下效果”，作为本轮 D17 限定例外。CDP 为 `172.30.30.11:9223`，实际访问 `https://api.honus.top`；原测试服务已停止且页面 502，本轮复用隔离 `/tmp/nexus-release-data-YdlpzU`，启动本地后端3001、Vite9998和真实SSH夹具22222/22225。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本轮授权-cdp-专项验收)。

## 任务操作全部移至标题行（2026-10-28）

本轮按用户补充授权将归档活动状态的“取消／取消中”与终态“移除”统一放到各任务标题最右侧；复制/移动/混合模式底部“取消”也移至对应标题右侧，删除旧底部操作容器。上传和批量取消原已在同排/窗头，保留原入口。第一轮源码审核逐一核对按钮条件、emit类型/ID、取消中文字及禁用；第二轮核对互斥分支、标题min-w-0/flex-1/truncate、按钮shrink-0、所有任务模式与底部容器无残余。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#任务操作全部移至标题行2026-10-28)。

### 任务标题操作正式远程回归通过

用户授权提交推送并等待E2E。main产品提交 `a726e6c3cc0df8cc5e3e05615e0490f1b15a4587`，正式 [40662321872](https://github.com/0honus0/nexus-terminal/actions/runs/40662321872) success：质量/格式、Dock…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#任务标题操作正式远程回归通过)。

## nethogs 全接口停顿与退出输入专项（2026-10-30）

用户授权启动测试环境、经 CDP 访问 api.honus.top，并明确测试 SSH。干净 main `09e6c79871bf4e831aa9fbc83a1f931f0fba474b`；本机 Node v22.23.1、pnpm 11.28.9、Playwright 1.64.1。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#nethogs-全接口停顿与退出输入专项2026-10-30)。

### 手动重置终端专项（2026-10-30）

用户最后选择只新增手动恢复，不实施通用检测。源码沿SSH标签右键/长按菜单、全局确认、RuntimeSession/Registry和原workspace.close链；三语同步。确认前不关闭，原实例收到明确closed才清理scope并按原标签顺序建立新Shell；后台标签重置保留当前选择。detached/unknown拒绝新建并保留原标签/未知提示，挂起标记禁用入口；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动重置终端专项2026-10-30)。

### SSH 测试主机密钥确认专项（2026-10-30）

终端恢复已按用户要求提交038855a1；本批修复连接测试丢失实际Host Key挑战的问题。沿用独立测试数据库、3001 Backend、9998 Vite及api.honus.top，CDP为172.30.30.11:9223，真实SSH目标为honus.top:9902。Backend按本批源码重新构建后启动；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#ssh-测试主机密钥确认专项2026-10-30)。

### 后台挂起恢复与密码单次保存专项（2026-10-30）

用户授权继续修改并通过CDP验证；沿用 `/tmp/nexus-nethogs-20261030/` 的独立数据库、Backend3001、Vite9998，CDP `172.30.30.11:9223` 访问 `https://api.honus.top`，实际SSH为honus.top:9902。仅操作自建context、临时连接及原PTY变量，无生产配置、容器或系统文件写入；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#后台挂起恢复与密码单次保存专项2026-10-30)。

### 普通文本原生查找恢复专项（2026-10-30）

用户明确仅恢复基本文本查找，不回退图片及其它文件预览。沿用 `/tmp/nexus-nethogs-20261030/`、Backend3001/Vite9998，CDP `172.30.30.11:9223` 实际访问 `https://api.honus.top`，自建桌面1440×1000和393×852触屏context连接honus.top:9902；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#普通文本原生查找恢复专项2026-10-30)。

## 复制任务总进度标注专项（2026-10-30）

沿用户指定 `https://api.honus.top` 与 CDP `172.30.30.11:9223`，在自建桌面1440×1000与393×852触屏context加载当前Vite实际ProgressCenter组件，以受控TransferTask模拟三文件累计进度。使用真实Vue/i18n模块和原全局样式，不修改保存配置或远端文件；本轮只验呈现，不称为真实跨服务器传输验收。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#复制任务总进度标注专项2026-10-30)。

## 终端目录等待清行提示与全部本地变更提交（2026-10-30）

用户最终撤销草稿保留方案，要求仅提示清行并提交全部本地改动。Native Shell/Model/Service/Port 的本轮草稿试验已完整撤回至原实现；最终仅 FileManager 消费现有 onQueued.waitingForPrompt，在当前有效视图中显示一次原 feedback 信息提示。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端目录等待清行提示与全部本地变更提交2026-10-30)。

## E2E 连接选项加载失败提示（2026-10-30）

main/96ea73b2 的远程 [41049355889](https://github.com/0honus0/nexus-terminal/actions/runs/41049355889) 只有 browser shard 7 一项失败（同组57通过），其余7个测试分片、质量与Docker smoke通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-连接选项加载失败提示2026-10-30)。

### 2026-11-02：弱网输入回退与删除停顿专项

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-11-02弱网输入回退与删除停顿专项)。

## 安卓普通文本查找呈现专项（2026-11-02）

指定站点api.honus.top的独立CDP context挂载真实FileEditor与内存文档，Android14 UA/touch模拟。修复前英文渐变默认面板证据mobile-search-before._，修复后mobile-search-after._，脚本mobile-search.cjs，均位于 `/tmp/nexus-nethogs-20261030/`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#安卓普通文本查找呈现专项2026-11-02)。

## 命令历史恢复与 SSH 半关闭专项（2026-11-02）

指定站点CDP使用独立context、真实store/API/Shared和完全拦截的历史接口，不向生产写入。`/tmp/nexus-nethogs-20261030/history-recovery.cjs` 与同名log验证：首次POST已在夹具保存但丢回执；下一次新意图GET→POST→GET、旧POST仅一次；恢复GET失败不发送新POST；普通load成功恢复；读取中撤权不派发；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#命令历史恢复与-ssh-半关闭专项2026-11-02)。

## Agent Shell 等待/执行分离与旧围栏拒绝专项（2026-11-02）

生产仅使用指定SSH和Node只读SQLite查询（readOnly/query_only），没有更新记录、重放原命令、重启或部署。指定临时目录内agent-db-{inventory,details,chain}.jsonl确认同一线程2026-10-29三个Run，目标为fxm/connection 7：首轮完成；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-shell-等待执行分离与旧围栏拒绝专项2026-11-02)。

## Agent 工具故障后总任务结束等待（2026-11-02）

本轮在原专用目录 `/tmp/nexus-nethogs-20261030/` 保留全部夹具、日志和缓存。使用 Node 22.23.1、pnpm 11.28.9；TMPDIR 和 NODE_COMPILE_CACHE 均指向该目录。只运行以下定向回归，不执行本地全量 E2E：

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-工具故障后总任务结束等待2026-11-02)。

## 手机终端自适应底部越界（2026-11-02）

沿用 main beff7a99 的现有未提交工作区、Node 22.23.1/pnpm 11.28.9、原 Vite9998 及专用 `/tmp/nexus-nethogs-20261030/`；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机终端自适应底部越界2026-11-02)。

## 服务器状态趋势时间轴与加载呈现（2026-11-02）

同一 main beff7a99 未提交工作区、原 Node22/pnpm11 工具、Vite9998 和 `/tmp/nexus-nethogs-20261030/`。指定站点/CDP 的独立 context 挂载真实 StatusMonitor/StatusCharts，提供只读内存样本与控制器，拦截真实 StatusCharts.vue 模块请求以保持加载，释放后加载原模块；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#服务器状态趋势时间轴与加载呈现2026-11-02)。

## 依赖升级与 main dev 发布（2026-11-02，完成）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖升级与-main-dev-发布2026-11-02完成)。

## 手动清理 Actions API 瞬时失败（2026-11-02，完成）

用户要求解决另一条Actions失败。实际为手动清理[41461823321](https://github.com/0honus0/nexus-terminal/actions/runs/41461823321)，job125332537068已解析latest/dev并计划删除旧资源，DELETE artifact13145138530返回GitHub HTTP500；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理-actions-api-瞬时失败2026-11-02完成)。

## 文件拖动悬停导航与右键取消（2026-11-02）

FileManager 的内部原生拖动在目录行和 `..` 行停留2秒进入，导航保留本次原始条目，当前目录空白松手沿原moveTo链派发。右键取消清空拖动源、选择、悬停等待和目标；不更改当前浏览目录，也不派发移动。文档级捕获右键drag/dragover/drop覆盖源节点因导航移除、容器外及快速松手，失活/断线/换通道/卸载清理计时与监听。保留原快速drop、移动过滤、外部上传和UI。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件拖动悬停导航与右键取消2026-11-02)。

## 手机编辑器底栏两行布局（2026-11-02）

用户报告路径及amd服务器名遮挡、换行符太窄，随后要求最多两行且保持紧凑。基线通过指定CDP在390px手机、16px边距的真实FileEditor受控挂载复现：原路径可见宽度仅3.33px；320px时路径0px，scope超出identity范围；换行符被原窄屏规则压至49.59px。原footer强制nowrap，identity与元信息/按钮竞争且overflow裁剪；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机编辑器底栏两行布局2026-11-02)。

## 重置/删除共用确认弹窗布局（2026-11-02）

用户要求优化重置终端、删除等确认弹窗并提供截图。基线为原UiConfirmationPanel：图标占正文左列，默认slot即使仅Vue条件注释也留18px（手机20px）内容padding；同一手机content样式存在重复覆盖。改为标题/图标同行、整行正文，描述字号13px/行高1.75，空content用:empty隐藏；确认按钮区有细分隔和浅底，手机等宽且44px高。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#重置删除共用确认弹窗布局2026-11-02)。

## 手机终端点击键盘跳动与全局确认消费者（2026-11-02）

本轮main/78997c1a及既有未提交拖动/编辑器/确认布局变更之上，用户确认终端普通输入和htop点击均导致软键盘反复跳动，并要求排查后统一全部同类确认弹窗。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机终端点击键盘跳动与全局确认消费者2026-11-02)。

## 本批 UI 修复远程 E2E 与发布（2026-11-02，完成）

用户授权推送、修复E2E并发布，08b6b2b58a6d8aa5f121816bd112fb05b800673d已推送main。首轮41484802901质量、Docker及7个测试分片成功，browser 6出现两项首次/重试相同失败：新增拖动多选初始化点击hover-source后，触屏桌面正常单击导航到/hover-source，随后寻找原目录hover-one.txt超时；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批-ui-修复远程-e2e-与发布2026-11-02完成)。

## 文件拖动父目录反馈与600ms悬停（2026-11-03）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件拖动父目录反馈与600ms悬停2026-11-03)。

## 连接表单底部错误 Toast（2026-11-03）

用户明确只迁移底部操作错误区域，测试结果与延迟说明保持。沿原useConnectionForm→useFeedback通知owner：修改连接参数且密码为空使用warning Toast，选项加载/提交校验错误使用error Toast，删除submitError及ConnectionForm内唯一UiInlineNotice；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#连接表单底部错误-toast2026-11-03)。

## 网络趋势上下行标题对齐（2026-11-03）

用户要求当前网络上下行速率与CPU当前值一样放在趋势标题右侧。根因是原network-legend为history-header的第三个单列网格项，在range-tabs之后。将原图例移入history-heading、放到关闭按钮前；原flex图例增加收缩/最小宽度/右对齐与自动左边距，窄栏可在标题右侧区域将两个速率换成两行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络趋势上下行标题对齐2026-11-03)。

## 网络趋势最窄宽度同排与完整标题（2026-11-03）

用户追加要求最窄栏位与手机同样左右同排、左侧网络趋势完整。上版同日after.json的180px记录标题溢出9px、两个速率上边界相差约18px，符合原允许省略/换行设计，本轮依最新要求调整。仅原StatusMonitor增加网络标题行class；该标题不收缩/省略，网络图例改flex:1且不换行，图例自身为inline-size容器，子项字号取原11px/scale与自身6.5cqw的较小值。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络趋势最窄宽度同排与完整标题2026-11-03)。

### 导航切换布局阻塞（2026-11-04）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#导航切换布局阻塞2026-11-04)。

### 终端标签菜单顺序（2026-11-04）

WorkspaceTabBar仅将原挂起菜单项移到重置之前，原条件、事件、分隔线和关闭项保持。USAGE的SSH会话章节同步顺序；无类型、协议、资源或架构边界变化。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端标签菜单顺序2026-11-04)。

### Agent App 卸载目录、数据清除与读取性能（2026-11-04）

复用上一轮隔离Backend3001与Vite9998，CDP http://172.30.30.11:9223 访问 https://api.honus.top，真实签名Full-stack包来自专用本地fixture仓库29092；没有更换生产服务或读写生产库。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-app-卸载目录数据清除与读取性能2026-11-04)。

### MCP / ACP 工具栏换行与手机同排（2026-11-04）

只修改AppIntegrationSettings的应用选择框尺寸及AppIntegrationEditor的操作组排布/窄屏短文案，未修改基础UiSelect或业务状态/请求。原w-40被基础未分层ui-select的width:100%覆盖，选择框占满一行，将刷新/创建挤到下一行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#mcp--acp-工具栏换行与手机同排2026-11-04)。

### 移除内置 Agent 与官方插件启用引导（2026-11-04）

按用户最新要求采用没有内置应用的当前设计，不实现旧ID映射、旧数据退役或迁移；删除默认初始化、手工创建App链、默认声明/实例字段与快照内置旁路。初始v1签名为backend-next-v1-initial-20261104-plugin-apps。旧测试库和全部既有目录保留；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#移除内置-agent-与官方插件启用引导2026-11-04)。

### 后端架构偏移与容量同步审计（2026-11-04）

本轮用户授权继续架构审核，合理问题直接修正，并统一双端限制/去除不必要固定限制；保留此前全部未提交变更。仅执行源码、AST/类型静态审核与构建，按PLAN D17未新增或运行行为测试、CDP、本地/远程E2E；前序插件/市场/工具栏专项PASS不算本轮行为验证。不重启服务、不操作生产库、不提交推送。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#后端架构偏移与容量同步审计2026-11-04)。

### Agent App 操作组垂直居中（2026-11-04）

用户报告App列表右侧安全策略配置、禁用和卸载操作组未垂直居中。源码确认AppManagementSettings父行从sm断点使用flex-row/items-center，子操作组的self-end覆盖父行对齐，令整组贴概要底部；本批仅删除该self-end。组件的嵌入与独立入口共用此行；639px及以下原全宽三列grid规则保持，UiButton、图标、启停/卸载确认及清除数据流程不变。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-app-操作组垂直居中2026-11-04)。

### Nexus Agent 插件与工具设计审核（2026-11-04）

本批按PLAN D17仅源码、架构和静态检查，未运行行为测试、CDP、本地/远程E2E或付费模型请求。产物集中 `/tmp/nexus-agent-tools-audit-20261104`；正式插件从独立仓库基线bda89fc修改，现有全部工作区变更、测试服务和产物保留，不提交、推送或发布。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#nexus-agent-插件与工具设计审核2026-11-04)。

## 本地文档刷新（2026-11-04）

本批仅整理7份文档：移除 Frontend 与本页误复制的后端架构正文，恢复正确标题与职责；Frontend 重建八节总览并保留前端专项；PLAN 原样保留决定项，退出已完成规划并承接未验清单；纠正旧前端迁移状态、工具审计/认证单调用详情混写、Run 并发与冻结期限、资源目录及部署下载分支。当前源码、规则文档、测试服务和现存数据库未修改，不提交、推送或发布。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本地文档刷新2026-11-04)。

## 网络切换自动恢复（2026-11-04，源码与静态）

本批产物集中 `/tmp/nexus-network-recovery-20261104`，保留全部前序变更、测试服务与数据，不重启、不提交推送。按 PLAN D17 未新增/运行行为测试、CDP 或 E2E。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络切换自动恢复2026-11-04源码与静态)。

## main dev 交付与数据库维护（2026-11-04，已完成）

用户授权提交推送、修复正式远程 E2E、发布 main dev amd64，并更新指定 Nexus 实例及手动维护数据库；另确认删除新版已移除、不再需要的数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#main-dev-交付与数据库维护2026-11-04已完成)。

### 第二轮完整通过与发布

修复提交 `fd41a0fe` 的正式远程 [41778130423](https://github.com/0honus0/nexus-terminal/actions/runs/41778130423) 全部success。549场景首次通过，无失败、重试、flaky或跳过：Backend125；Browser1–7分别41/61/53/57/58/94/60（含隔离场景）。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第二轮完整通过与发布)。

### 指定主机更新与维护结果

发布 [41778950373](https://github.com/0honus0/nexus-terminal/actions/runs/41778950373) success，包含生产依赖审计与镜像构建/推送；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#指定主机更新与维护结果)。

## Agent GIF 与模型文件交付（2026-11-05，源码、静态与限定浏览器）

本轮工作区基于 `745beddb308778d6a6ffe5915c9b7eb682d6f15c`，新增真实 GIF Images 响应、file_deliver、artifact_present 及文本自动文件卡；outputArtifactId 是现有工具结果的派生投影，无数据库列或持久数据格式变更，不需要迁移。参考模式固定源码链接见 [Agent 文件交付设计](../architecture/AGENT.md#模型文件交付)，未引入第二套文件库或预览引擎。

环境为 Node 26.13.0 / pnpm 12.16.1；根 `pnpm run check`、`pnpm run format:all:check`、`pnpm run build`、`git diff --check` 通过。E2E TypeScript 使用 vue-tsc 和任务独立 tsconfig 检查通过；裸 tsc 不支持已有 Vue 模块入口，已改用项目相同 Vue 检查器，未放宽类型。产物集中于 `/home/honus/nexus-task-artifacts/agent-file-delivery-20261105`，保留参考源码、检查输出及真实两帧 GIF；ffmpeg 帧摘要确认两帧内容不同，此事实不代替浏览器播放验收。

新增正式场景：functional-images 的 PNG/GIF 实际解码、浏览器逐帧截图变化、原字节及刷新恢复；file-delivery 的 320/390/1440px 文本文件预览/下载、展示既有文件不重复写入，SSH GIF/普通/大于采样区文件/空文件、双能力/目标/批准拒绝、链接/目录拒绝、取消与 SFTP 句柄释放。execution-flow 增加后端流式故障入口，覆盖短读/超读/修改时间变化、逐块撤权、消费失败/提前退出、原始读取与资源关闭失败及跨模块错误身份。现有 PNG 与供应商拒绝断言保持。

按用户本轮“浏览器验证”授权执行限定本地浏览器，不复用上一轮 577 项通过；正式远程全组与新增后端流故障专项尚未执行，真实模型工具选择、付费 GIF 支持、网络和介质故障仍有外部依赖。本轮未提交推送、发布或部署，未修改生产数据库。

### 限定浏览器验收与插件权限

使用同一工具链、Playwright 1.64.1 / Chromium 1248，真实前后端生产构建、认证 HTTP/WS、签名测试插件与真实 SSH/SFTP 夹具；图片及聊天模型使用受控 Provider。运行命令为 `pnpm --filter @nexus-terminal/e2e exec playwright test --config=/home/honus/nexus-task-artifacts/agent-file-delivery-20261105/browser.config.ts agent/functional-images.spec.ts agent/file-delivery.spec.ts`。独立配置仅调整产物路径、诊断超时并移除本任务无消费者的桌面服务；未替换被测产品实现。临时文件、数据库、报告、Trace 和截图均归任务目录；SSH 文件夹具沿正式测试入口并在 finally 删除。

首轮 17 项中 8 通过、9 失败：受控模型从 JSON 字符串解析路径时带上末尾引号，且窄屏测试未关闭遮挡的原任务栏；缺权限时强行返回未提供的工具，实际为 `model_response_invalid`，原测试误期望普通 failed。修正夹具并补精确路径与失败码断言；未改产品 UI 或放宽授权。第二轮扩为 19 项，12 通过、7 失败：两个测试从列表误读仅详情提供的失败码；取消采样流还暴露真正的应用故障，导致后继 5 项被原应用关闭拒绝阻断。Remote 公开字节流与 ToolModel 现在分别转换所属安全失败，ArtifactModel 保留源失败、持久化失败和真正清理失败的区别，正常取消不再记作内部故障。已补正式后端采样中断回归源码，其专项尚未执行。

第三轮 19 项全部一次通过。随后错误优先级审核修正 ToolModel 在同一操作 owner 内保留权限复查、消费及持久化的真实故障，正常源流拒绝不能覆盖这些故障，真正清理失败仍独立保留；补充权限存储失败的正式后端回归源码，其专项尚未执行。最终代码重新构建后第四轮 19 项全部一次通过，无失败、重试、flaky 或跳过；JSON Reporter 逐项核对见任务目录 `browser-verification.json`，最终原日志为 `browser-round4.log`、`browser-round4.json`，四轮原日志与失败现场均保留。覆盖 320/390/1440px 文本文件卡/预览边界/原生下载/已有文件展示不重复入库/刷新恢复；SSH GIF、Markdown、256 KiB 二进制、空文件原字节及 hash；缺两项能力之一、未选目标、拒绝审批、目录和符号链接；取消 held SFTP read 后 pending/句柄归零，无成功卡且后继正常重建基线。PNG/GIF Images 均解码、下载和刷新，GIF 用浏览器逐帧截图变化确认动画；供应商三类拒绝保留原断言。最终根 check、后端及 Shared 构建和 E2E vue-tsc 通过，日志分别为 `browser-final-check.log`、`authority-fix-build-final.log`、`browser-e2e-typecheck-final.log`。

只读核对官方插件 [v1.0.3 manifest](https://github.com/0honus0/nexus-agent-plugins/blob/d5dd455e209fffb86433cedb7044c507a0d848b3/plugins/nexus.agent/manifest.json) 与 [agent.json](https://github.com/0honus0/nexus-agent-plugins/blob/d5dd455e209fffb86433cedb7044c507a0d848b3/plugins/nexus.agent/agent.json)：已声明 file.read / artifacts.write / artifacts.read，toolNames 为 null，因此无需修改或重新发布该插件。显式工具白名单的第三方插件需补所需工具名；原授权撤销不自动恢复。本次浏览器消费签名受控插件，不冒充真实模型或官方发布包的运行验收。

### 提交与首轮完整远程回归

用户授权提交、推送和发布版本，沿当前 main / linux/amd64 dev 渠道交付，不更新生产实例。功能提交 `100291a781a7e6884d5616240ab619802c94d179` 已推送；首轮 [E2E 42009569193](https://github.com/0honus0/nexus-terminal/actions/runs/42009569193) 质量、构建与 Docker smoke 通过，但后端新增流故障入口失败，Browser 5 的旧触屏终端重绘测试重试通过而被正式 flaky 门禁拒绝；其余分片通过。本轮没有发布镜像。

后端 16 个子场景中，权限存储故障的断言错误地只检查 error.cause 的 AggregateError；实际 owner 返回顶层 AggregateError，并完整保留原存储故障与读取拒绝。修正为明确检查顶层聚合、两项因果、原存储错误身份、具名读取拒绝和 drain 分类，不改产品实现。触屏 Trace 记录显示从 650px 切回 1180px 后，fill 命中待卸载的手机命令框，而 press 已命中新建的空桌面命令框；测试改为等待目标响应式命令栏挂载再输入，并断言待发送值，保留原 ANSI 清屏、中文残留、背景色和全部视口断言，不添加固定等待或修改 UI。原 SHA、后端日志、Browser 5 首次 Trace/日志及整轮状态均保留在任务目录 `remote-e2e-42009569193.*`、`remote-failure-42009569193-backend/`、`remote-failure-42009569193-browser5/`。修正文件的 ESLint、Prettier、Node 语法及 diff 检查通过，下一轮完整远程验收待执行。

### 第二轮完整通过与 amd64 dev 交付

修正提交 `ed9003d0f8df48d8e6a03611945dace8504b4514` 的完整 [E2E 42010824912](https://github.com/0honus0/nexus-terminal/actions/runs/42010824912) success。逐项解析正式 Reporter：593 条唯一 passed 记录，首次全部通过，无失败、重试、flaky 或场景跳过；11 个 regular/isolated 执行组均 passed。Backend 132 项，Browser 1–7 分别 42/44/60/75/79/90/71 项；质量、双端生产构建、Docker smoke、8 个分片及耗时更新作业全部 success，文档截图按条件跳过。新增后端 16 个子场景包含原字节、短读/超读/修改时间变化、逐块撤权、消费失败/提前退出、原读取/资源清理失败、采样中断与权限存储故障；浏览器文件交付和 GIF 正式场景均通过。原始证据在任务目录 `remote-e2e-42010824912.json`、`remote-e2e-42010824912.log` 和 `remote-verification-42010824912.json`。

CI 后继提交 `62fb68f839f6facb5c25283a2edc0b459c9d8018` 仅修改 `scripts/e2e/duration-estimates.json`，已核对产品与测试完全一致。以该 main 提交启动 [amd64 dev 发布 42011867002](https://github.com/0honus0/nexus-terminal/actions/runs/42011867002)，生产依赖审计、构建与推送全部 success。直接读取 GHCR 核对：`dev` 与 `sha-62fb68f839f6` 同为 `sha256:178381da7fa0230721296668eac5ef57f4152a3a244f7aa9728b93b66f409db7`；实际镜像为 linux/amd64，OCI revision 为 `62fb68f839f6facb5c25283a2edc0b459c9d8018`，version 为 `sha-62fb68f839f6`。发布状态/原日志为任务目录 `publish-42011867002.json`、`publish-42011867002.log`，镜像原始查询与核对摘要为 `image-dev-inspect.txt`、`image-sha-inspect.txt`、`image-config.json`、`publication-verification.json`。本次没有数据库格式变化，无需新增迁移；不部署远程实例，官方插件也无需重新发布。测试目录与首次失败证据保留至用户通知清理。

## E2E 耗时产物下载与重跑（2026-11-05）

原 `8e4765a6` 的 [42031844232](https://github.com/0honus0/nexus-terminal/actions/runs/42031844232) 中594项测试、质量和 Docker smoke 均成功，仅耗时下载失败：官方下载 Action 的内部 ListArtifacts 请求遇到 ECONNRESET。修正为 token/REST 下载、保留 SHA256 校验，并独立解析分片产物 ID，不忽略最终下载失败或缺失产物。

首版 `e6786d85` 的 [42034179288](https://github.com/0honus0/nexus-terminal/actions/runs/42034179288/attempts/1) 完整594项、构建、质量、Docker smoke 和汇总均成功；随后仅重跑汇总的 attempt2 失败，暴露 GitHub 会复制已成功 job 并更改 ID/run_attempt，但沿用原 started_at/completed_at。直接拿复制 job 的 attempt 拼产物名仍会错误寻找并未生成的 attempt2 产物。本轮未将该失败重跑记为成功。

最终 `90bf154544ad086e06571f3f9e000d263934ddff` 让构建等待和耗时汇总复用同一 job-artifacts owner，按当前运行、源 job 实际执行时间、产物创建时间及名称前缀选取不可变 ID；拒绝其它执行周期、重复、过期或缺失产物。构建下载也改用官方 REST 路径。7项逻辑回归覆盖混合真实执行周期、复制成功 job、仅重跑汇总、构建复用、全量重跑拒绝旧构建、缺失/过期/重复和 API 失败；已接入质量作业。使用失败 attempt2 的真实 API 元数据，另确认能选齐8份耗时及原构建。Node26.13.0/pnpm12.16.1 下根 check、全量格式、Node 逻辑回归与 diff 检查通过。

最终 [42035960955 attempt1](https://github.com/0honus0/nexus-terminal/actions/runs/42035960955/attempts/1) 完整通过。逐项核对正式 Reporter：594条唯一 passed，零失败、重试、flaky或场景跳过；Backend132，Browser1–7为42/73/67/63/70/73/74项。质量及其7项逻辑回归、双端生产构建、Docker smoke、8个分片和耗时更新全部success，文档截图按条件跳过。包含此前 `90df431d` 的GIF稳定分组、嵌套 Markdown 图片与下载说明保留，以及 `8e4765a6` 取消按钮移动后的既有操作回归；未将这些场景称为专项视觉验收。

再单独重跑汇总的 [attempt2](https://github.com/0honus0/nexus-terminal/actions/runs/42035960955/attempts/2) 成功；日志确认下载全部8份名称仍为 attempt1 的耗时产物，当前分支已前进时正确跳过旧估算推送。后继 `0c0355a8` 仅为CI耗时更新，已快进同步；没有发布镜像、部署实例、改数据库或更新插件。专项视觉与真实设备边界继续保留在 PLAN。

原始失败、首版完整运行与失败重跑、最终两次成功的日志及元数据集中 `/home/honus/nexus-task-artifacts/e2e-timings-20261105`；逐项摘要为 `final-report-summary.json`，最终原日志为 `final-run-attempt1.log`、`final-updater-attempt2.log`，状态为 `final-run-attempt1.json`、`final-run-attempt2.json`。首次测试方法空行格式错误修正后全量格式通过，修正复制 job 后再次检查通过；证据与测试目录保留至用户通知。

## Agent 工具批次与 Run 连接资源（2026-11-05）

基于本体 `2abcf49b` 的当前工作区；Node 26.13.0、pnpm 12.16.1、Playwright 1.64.1，产物统一保留在 `/home/honus/nexus-task-artifacts/agent-tool-reuse-20261105`，未部署生产。SSH 串行复用、并发独占传输，SFTP 保留自己的连接；Shell 一次 exec 承载 commands[]，不使用远端临时文件或常驻 Shell。

真实竞争实验使用项目 Ssh2MachineFactory 与 NdjsonAcpAdapter、本机 SSH、全局 512 KiB/s 下行限速（TCP 公平分配），每组 3 次且校验 SHA。2 MiB SFTP 与小 exec 共用传输时小命令 2074–2079ms，独立传输为 152–153ms，两组文件传输均 4.25–4.27s。2 MiB exec stdout 与已启动 ACP 并发时，权限响应共用传输为 4187–4207ms，独立传输为 52–53ms，整组完成仍 4.2–4.4s；因此整批最后返回并不能消除中间审批的等待。原始脚本/JSONL 为 ssh-contention 与 ssh-exec-acp-contention；实验只证明该环境下避免同连接背压，不保证独立带宽、主机 CPU 或跳板性能。

本轮定向执行：`yield-second.log` 8 项通过；`batches-second.log` 的文件 UTF-8/目录分页、批次 patch/search/deliver/present、结果续读及 v1→v3 实际 SQLite 升级通过；Docker 旧夹具失败已修正，`isolated-third.log` 29 项全部通过，覆盖真实 2 MiB exec 与 ACP 权限并发、SSH 生命周期、Browser 会话队列/配置屏障与故障收尾、Docker 批次。保留首轮错误输出，不沿用已替换的共用连接实验结论。

`check-final.log` 根检查通过；`build-e2e-final.log` Shared、双端及测试客户端构建通过。`resources-browser-second.log` 在 1280/390/320px 各验证关闭连接和关闭界面：6 项通过，截图随正式测试产物保留；最小化/取消关闭保留原 resourceId，确认停止后 Run cancelled 且资源移除。首次用例误把审批等待资源要求为 idle，已改为真实 busy 状态，未改产品 UI 绕过断言。

数据库保持 v1 签名不变，独立 v2 转换 Shell Job 结果为 commands[]，v3 转换历史交付/展示结果为 items[]；正常重启执行升级并验证第二次启动不重写，迁移失败回滚由 phase2 场景验证。快照身份改为完整有序迁移链签名，不接受不同链快照。

官方插件 main `7f0498cf14fa50f7a664adf892ef041c62ad7fab` 已通过 [Validate 42074435148](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42074435148)，[打包 42074606017](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42074606017) 成功；下载后验证 catalog SHA/大小、全部文件 hash 与固定发布者 Ed25519 签名。[Nexus Agent 1.0.4](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v1.0.4) 已发布，Full-stack 保持原 1.0.3，SDK 与权限声明不变。

本地完整 Backend 首轮 140 项通过，1 项因 Node 不接受空 --test-name-pattern 参数而启动失败；修正 wrapper 仅在非空时传入参数后，正式相同入口重跑该项通过（local-backend-corrected.log），实际 SQLite 脚本另有 phase2-final.log。Browser 首轮交付审批摘要及 A01 Provider 夹具仍读取旧单项字段，已按 paths[]/items[].value 更新并保留首次失败，后续用当前契约验收。远程 runner 同步增加官方 Docker 29.9.2 CLI，后端分片独占其临时 Actions 主机 socket，实际 Docker 用例不跳过或换成模拟成功。

### 首轮完整回归修正

本体实现提交 `8bff9305e3b9d3a31346c92906d787c565c7314e` 的 [远程 E2E 42076105731](https://github.com/0honus0/nexus-terminal/actions/runs/42076105731) 未通过，原日志与后端诊断产物保留。旧测试仍读取单项 Shell/Job/File 结果，任务提醒未计入命令批次预览序号，现逐项适配并保留退出码、内容 hash、审批/焦点和实际进程退出断言。本地相应六份浏览器文件修正后 32 项通过（local-browser-corrected.log）。ACP 取消实际保留 unknown 工具账本与关闭证据，进程已退出；正式夹具增加显式预期关闭校验并保留原数据库，不忽略清理或存储失败。

远程另发现 ssh2 的 close/destroy 不一定结束忽略 TERM 的远端命令输出流。批次读取改为同时观察命令终态，未知终态解除本地读取监听后，由原机器 owner 退役并等待传输关闭；仍保留原 mutation blocked 和 Job unknown，不重放。新增“输出流永不结束”的确定性回归，原真实 SSH 的 held/blocked 用例不放宽等待期限；yield-final.log 共 9 项通过。CI 先前只安装 Chromium headless shell，Puppeteer 定向测试缺完整 Chromium，runner 改为安装同版本 Chromium 全套。

### 完整远程验收

[E2E 42079275442](https://github.com/0honus0/nexus-terminal/actions/runs/42079275442) 在 `646f1e6db68dd91ef83132faec8b9de0fd49ae94` 完整成功：正式 Reporter 共610条唯一 passed，失败、重试、flaky、场景跳过均为0。Backend141项，Browser1–7分别35/92/76/65/76/61/64项；质量与格式、双端构建、Docker smoke、runner准备及耗时汇总全部成功，仅条件不满足的文档截图作业跳过。原日志、元数据和逐分片/项目统计为 remote-final-run.log、remote-final-run.json、remote-final-summary.json。

本地较新 xrdp 仅在 DEBUG 输出实际 VNC 认证成功，旧夹具计数 INFO 镜像行导致真实认证成功后仍断言超时；`646f1e6d` 改计唯一 canonical DEBUG 行，既适用于本地新版本，也避免 CI 旧版本重复计数。此修正随上述完整远程回归通过。后继 `0fa770a8` 仅更新耗时估算，镜像运行代码与构建输入相对被测 SHA 完全一致。

### 本地完整回归与连续场景

local-browser-final.log 的完整469项运行保留463项通过和6项失败，不能称整轮全绿。该进程启动时仍加载旧桌面夹具，造成桌面3项及手机1项认证计数超时；另外2项 Pad 大输出恢复在读取日志前因保留的 unknown 数据库被误计为第二个活动实例而失败。原数据库、Trace、截图、录像和逐项日志已在服务全部停止后归档至 browser-final-first-181444。

`346def40` 将显式预期 execution_unknown 的数据库移至 backend-data/evidence/，保留原名、数据库和围栏事实；正常活动实例仍只在 backend-* 命名空间，不放宽 suspend 日志唯一实例断言。源码仅改测试夹具，格式、ESLint、Node语法与diff检查通过；产品未知结果和清理失败的处理不变。

随后按正式 `NEXUS_E2E_SUITE=all` 入口连续运行 ssh-acp-settings、rdp-remoteapp-fullscreen、suspend-log-compaction、pad-suspended-output、touch-workflows 五份文件，共22项全部通过（1.5分钟，local-final-corrected.log）。这轮先执行 ACP 取消并留下 evidence 数据库，再执行真实日志压缩、两个112MiB远端输出和原Shell恢复，以及桌面/手机RDP认证、文件批次取消和音频上下文退役；没有单独重置进程来绕过证据目录问题。服务停止后保留当前轮全部产物与原数据库，覆盖先前6项失败；本地全量加修正复测与远程完整一次通过分别记录，不合并成一次本地全绿。

### 最终源码验收与审核结论

包含证据目录修正的 `346def40812b4ef696a82467e403cdf7c326ba31` 已通过 [完整 E2E 42082006188](https://github.com/0honus0/nexus-terminal/actions/runs/42082006188)。正式 Reporter 核对610条唯一通过，失败、重试、flaky和场景跳过均为0；Backend141项，Browser1–7分别39/69/64/68/77/58/94项，质量/格式、构建、Docker smoke及耗时汇总均成功。最终原日志、元数据及统计为 remote-latest-run.log、remote-latest-run.json、remote-latest-summary.json；本地原失败与22项连续复测的对应关系见 local-final-summary.json。后继 `01caa834` 只更新耗时估算。

| 审核表   | 结论与证据                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 批次工具、分页、事件等待、Run资源、10分钟续期、结束排空和手动关闭确认均已接线；本地定向及最终完整610项回归通过。                                                                       |
| 职责归属 | Remote Model持独占传输及技术转换，Tools持Run能力，Runs协调关闭与生命周期；前端复用全局确认组件，未改无关UI。                                                                           |
| 类型归属 | 双端安全视图和关闭协议归Shared；内部应用、存储和技术对象独立定义并白名单转换，全部真实消费者同步。                                                                                     |
| 完成证据 | 根check、完整格式和双端构建通过；SSH/ACP竞争与取消、Browser/Docker、真实SQLite迁移、1280/390/320px关闭流程及完整远程均有对应日志。插件和amd dev镜像已交付，不扩大真实设备/供应商保证。 |

### 镜像交付

[amd dev 发布 42081065621](https://github.com/0honus0/nexus-terminal/actions/runs/42081065621) 成功，源码 `0fa770a821324f16c7c9a62905025a41f592450d`；`ghcr.io/0honus0/nexus-terminal:dev` 与 `sha-0fa770a82132` 指向同一 index：`sha256:ffe28db0e71200d0ea08e0874db54b46d69211e1c281fe65ee7fe608c55d33d9`。从 GHCR 读取并校验 manifest/config 的 SHA-256，实际平台仅 linux/amd64，平台 digest 为 `sha256:ae6063f070cf119b00bb3e46a114bd4c00e2bf73ec33e0cf64653709d70375e8`，OCI revision 与发布源码一致。发布日志、元数据和注册表核验分别为 publish-run.log、publish-run.json、published-image.json；不把后续文档提交称为该镜像源码，未更新生产实例。

发布后的 `346def40` 仅改测试证据目录，另有耗时估算和文档提交；已核对最终源码相对镜像源码的产品包、Dockerfile、锁文件、工具链和发布workflow无变化，镜像包含本次全部运行功能修改。测试目录、失败证据和专用任务目录保留至用户通知清理。

## Agent 手机服务器选择图标（2026-11-05）

按用户授权修正AgentAppSurface目标触发器：原来只按composer宽度超过620px显示文字，现在复用Foundation的useDeviceCapabilities，手机含横屏/宽视口始终只显示服务器图标；电脑宽输入区保留文字与已选数量，窄输入区沿原收缩规则。组件持展示判断，Foundation持设备能力，原popover选择、无障碍名称、授权及Shared/后端契约均不变，无数据库迁移。核对既有目标选择消费者并同步USAGE及前端架构；根check、完整格式和前端生产构建通过，日志为agent-tool-reuse-20261105任务目录下的target-mobile-{check,format,build}.log。此条仅记录源码与静态/构建结果，宽窄输入区专项视觉及真实手机边界仍沿PLAN保留，正式回归由推送后远程E2E执行。

## 前端分级日志完善（2026-11-05）

本轮基于 `main/5580aaec348a1a200fa5f52b360264154df1a238` 的未提交工作区；记录本轮源码与命令，不复用前次远程 E2E 作为验证。继续使用 Pino 与 Shared 日志等级，没有 UI、后端协议、数据库或部署变更。

| 审核项         | 结论                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契约与消费者   | Shared 等级唯一；偏好 Store 同步原 Pino 实例。Client、app、Workspace 和 Agent 消费同一 owner，无新日志系统或公开接口。                                     |
| 类型与转换     | HTTP/WS 只投影安全元数据，异常只投影类型/源码位置；查询参数、凭据、正文、自定义异常字段不进入新增日志。                                                    |
| 生命周期与并发 | 请求回调仅结算一次，Axios 通过 WeakMap 关联；WS 单次监听、Agent 原退订/重连及页面级诊断 owner 保持原生命周期。高频输出仅既有 trace，关闭等级不序列化异常。 |
| 失败与恢复     | 正常取消/主动关闭为 debug；网络/重连为 warn，5xx/协议/未捕获异常为 error；等级切换不冒充错误，silent 不输出切换通知。                                      |

- 工具链：Node 26.13.0、pnpm 12.16.1、Playwright 1.64.1，测试服务使用动态隔离的本地环回端口与独立 E2E 基线。
- 静态与构建：根 `pnpm run check`、`pnpm run format:all:check`、`pnpm run build:frontend`、测试专用客户端构建与 `git diff --check` 通过。专项入口同时重新构建 Shared、Backend、Frontend 和测试客户端。
- 初轮 `pnpm test:e2e:remote -- --project=ui frontend-diagnostics.spec.ts`：3 项一次通过（6.0s），包含等级过滤、异常脱敏和关闭时不序列化、Axios/fetch 的状态/取消/网络/格式失败及运行时错误。
- 补齐 WS 后执行 `pnpm test:e2e:remote -- --project=ui frontend-diagnostics.spec.ts system-settings.spec.ts --grep frontend`：5 项全部一次通过（8.7s），无失败、重试或跳过；新增 WS 正常/异常关闭与 silent、关联编号和内容隔离，并回归前后端日志等级独立保存、重载保持和非法等级拒绝。
- 产物保留在 `/home/honus/nexus-task-artifacts/agent-tool-reuse-20261105/frontend-logging-*.log`；正式测试入口的 `remote` 名称只表示动态端口本地执行，不代表 GitHub Actions。
- 未验：本轮未提交/推送、未运行正式远程完整 E2E，未在生产服务或真实手机弱网/后台现场复现；Agent 与工作区状态日志已静态审核，不能据此声称真实卡死场景全部覆盖。无生产更新。

## Agent SSH 目标入口按宽度响应（2026-11-06）

本轮在上一轮前端日志的未提交工作区上只调整 `AgentAppSurface.vue` 的目标入口显示条件，并同步 USAGE 和 Frontend 架构；不覆盖既有本地修改，没有提交、推送或部署。

- 契约/消费者审核：目标入口的文字、已选数量、下拉箭头和 square 外观共用 `showTargetLabel`，目标选择与权限协议不变。
- 转换审核：去掉 `useDeviceCapabilities/isMobile`，改为 VueUse 的页面 `min-width:768px` 与既有输入区 `>620px` 条件；复用既有响应分界，不引入设备/UA/触控类型判断。
- 生命周期审核：媒体查询由 VueUse 随组件作用域释放；继续复用输入区测量，无新监听 owner、定时器或持久状态。
- 风险审核：窄屏保留图标、标题、可访问名称和完整选择弹层；桌面页面收窄与手机 UA 的宽页面均按实际空间响应。
- 静态：根 `pnpm run check`、`pnpm run format:all:check`、`git diff --check` 通过；限定回归入口重新完成 Shared、Backend、Frontend 生产构建与测试客户端构建。
- 浏览器：沿用正式夹具和已有 `configuration-hints.spec.ts` 的真实目标选择/批选/权限场景，任务目录中的临时配置增加验收 hook；1 项一次通过（9.9s），无重试或跳过。验收桌面 UA 1440px 有文字、390px 仅图标、恢复宽度重新展开，以及手机 UA 在 1440/390px 下分别展开/收起。截图已目视核对。
- 产物：`/home/honus/nexus-task-artifacts/agent-target-width-20261106/` 保留临时配置、hook、日志及四张截图；代码检查日志在上一任务目录 `agent-target-width-check.log`。未向产品加入测试入口或永久新增低影响样式测试。
- 边界：本轮为本地 Chromium 受控验收；未运行正式远程完整 E2E，真实手机软键盘、横竖屏与其它语言仍沿 PLAN 的真机专项记录。

## Agent Host 工具按需发现（2026-11-06）

基于 main `5580aaec348a1a200fa5f52b360264154df1a238` 的未提交工作区实施，保留既有前端日志与目标入口宽度修改；没有提交、推送、发布或更新生产环境。无 Shared/HTTP/数据库结构变化，不需要迁移。

采用 [Vercel AI SDK toolSearch](https://github.com/vercel/ai/blob/6737c7721b10ce489e21efff43a4acf9c8ca7f04/packages/ai/src/tool-search/prepare-tool-search.ts) 的常驻搜索、当前执行持有发现集合、下一轮提供 schema 模式。其公开工厂必须绑定 SDK 的生成循环，非独立检索接口；本项目沿用原 Run/治理/账本，不复制 SDK 私有执行器。检索使用 Fuse.js 7.5.0 的关键词包含匹配，中文分词复用 Intl.Segmenter；不自行评分、不增加五条之类的结果限制。另核对 DeepAgents 原生搜索的模型/端点资格和 Goose 的目录/详情分离。GitHub 元数据已确认 AI SDK、DeepAgents、Goose、Fuse 均超过 H-14 的 500 Star 要求；确切 SHA、源码和元数据在任务产物 reference 目录。

| 审核表         | 已审源码/消费者及结论                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型与消费者   | tools/model/tool-types、tool-input/definitions、ToolRemoteModel 排除新 targetless 分支、ToolService、RunExecutionOwner、受控 Provider 与 execution-flow 正式入口。availableDefinitions 与当轮 definitions 分离；原 RunModelStream 投影、requestHash、预算和当轮提案白名单仍消费同一份实际声明；无业务类型泄入 Shared/Platform。 |
| 依赖与转换     | tool-catalog-rules 是 live 权限/目标/插件过滤与检索的唯一 owner。Root/Child 原始工具上界在过滤前保留；结果只投影 name/summary，不复制 schema；无 search 权限或被 App 工具白名单排除时直接提供完整授权目录。Fuse/Intl 只执行纯检索，无网络、模型选择请求或新增技术资源。                                                         |
| 生命周期与失败 | Run 内局部 Set，无跨 Run/Child 共享、定时器或重启恢复。搜索复用原读工具账本，complete 和最终 verify 后才发布效果；整批成功及取消/期限检查后按目录顺序合并，下轮再次按当前授权过滤。同轮未加载提案保持原拒绝/unknown 围栏；提交后确认失败、批次失败及取消均不推进下一次模型派发。                                                |
| 验证与风险     | root check、完整 format:all:check、git diff --check、Shared/Backend/Frontend 与 E2E 客户端构建通过。下列本地正式 runner 回归通过；真实模型选词/发现成功率、prompt cache 和计费收益未测，GitHub Actions 全量未运行。                                                                                                             |

执行环境为 Node 26.13.0、pnpm 12.16.1、Playwright 1.64.1。`test:e2e:remote` 本轮仍是动态端口的本地正式 runner，不代表 GitHub Actions：

- 双协议专项在 `backend-next-agent-tool-loading.integration.mjs`：两种协议各 10 个场景，加父用例共 22 项。覆盖精确名/中文关键词、无匹配、schema 下一轮加载与复用、fresh Run 隔离、同轮拒绝、无 SSH 目标、撤权后的目录/执行拦截、插件白名单、显式完整目录、Child 独立与继承上界、取消后的禁止续轮。通过 `agent/execution-flow.spec.ts` 执行。
- `pnpm test:e2e:remote -- --project=agent execution-flow.spec.ts plugin/native-run.spec.ts file-delivery.spec.ts functional-images.spec.ts functional-memory.spec.ts functional-regressions.spec.ts plugin/browser-lifecycle.spec.ts plugin/subagent-lifecycle.spec.ts --output=/home/honus/nexus-task-artifacts/tool-loading-implementation-20261106/e2e-results`：**51 项一次通过，4.7m**。覆盖真实 SSH/Browser/SQLite 执行、资源关闭、图片/GIF 与文件交付、原生插件、Child、取消、审批及宽窄聊天界面。
- 补充 `NEXUS_E2E_SUITE=backend pnpm test:e2e:remote -- --project=agent execution-flow.spec.ts --grep 'lazy tool discovery|MCP negotiation|ACP execution' --output=/home/honus/nexus-task-artifacts/tool-loading-implementation-20261106/protocol-results`：**3 项一次通过，21.3s**，包含 22 项发现专项重跑及原 MCP 协商/调用、ACP 真实 SSH/入口继承/内层审批链。
- 新增专项初轮暴露 Responses 夹具 added 状态错误，以及同轮未加载提案的终态预期不符；修正为真实协议的 in_progress 和原有 model_response_invalid/unknown 断言，未放宽产品提案校验。后续专项与上述扩展回归全部通过。

实际受控 Provider 收到的 tools 数组测量（同 App 全授权、有选中 SSH、无自定义插件工具）：

| 协议             | 首轮工具数/JSON bytes | 显式完整目录工具数/JSON bytes | 工具定义 JSON 降幅 |
| ---------------- | --------------------- | ----------------------------- | ------------------ |
| Chat Completions | 11 / 8695             | 64 / 42786                    | 79.68%             |
| Responses        | 11 / 8717             | 64 / 42914                    | 79.69%             |

上述是实际编码后的工具定义 JSON，**不等于整体请求 token、账单或延迟同比下降**；实际集合取决于授权和目标，搜索本身也占模型轮次与工具额度。无额外 selector 模型请求。源码、自审、检查/构建日志、三轮专项日志、51 项日志、wire-measurements.json 及参考源码保留在 `/home/honus/nexus-task-artifacts/tool-loading-implementation-20261106/`。真实模型、自然到期及所有未知提交/介质故障交错仍按 PLAN 待验边界推进。

## 诊断、宽度按钮与工具加载补充 E2E（2026-11-06）

基于 `main/5aa6e40a4b4ee7be6a5134c3646e6bf76bb1b07b` 的三组本地功能变更补齐永久覆盖。工具加载新增双协议下的重叠并发搜索/重复加载去重与稳定排序、非法参数失败账本后的有效重试，以及显式插件白名单包含搜索时的目录隔离；每协议 13 个子场景，加父场景共 28 项 Node 测试，由正式 execution-flow 承载。签名 Nexus Agent 浏览器场景进一步核对只读搜索先完成，两个已审批写工具在下一模型步骤完成。

目标按钮以 Desktop Chrome / Pixel 7 的 UA 分别验证 1440→390→320→1440px，窄屏仅图标、宽屏文字和计数恢复，选中目标持续且授权不改变。诊断四项浏览器用例进入正式 UI 分组，覆盖级别动态过滤、脱敏、HTTP 分类关联、运行时错误和 WebSocket 关闭。未增加产品 UI 或数据库变更。

Node 26.13.0 / pnpm 12.16.1：`pnpm check`、`pnpm build`、E2E 测试客户端构建、`pnpm format:all:check` 和 `git diff --check` 通过；Playwright 收集 618 项 / 145 文件。按照 D17，本阶段尚未本地执行新增行为用例，远程整轮结果后续追加。完整源码审核确认目录授权唯一投影、加载只在整批完成及取消/到期检查后生效、Root/Child 各自 Run 生命周期、插件无搜索时的完整已授权目录，以及诊断无载荷/异常正文记录。产物集中 `/home/honus/nexus-task-artifacts/e2e-tool-loading-20261106`，保留至用户通知清理。

### 首轮远程：目录颜色取样时机

`5b96f9692c86b8929c2f31782f88423d817bdcb3` 的 [E2E 42142314918](https://github.com/0honus0/nexus-terminal/actions/runs/42142314918) 首个失败为 Browser 3 的 dark/390px 管理目录用例：通知名称前景已为深色主题的 `(227,226,237)`，卡片背景仍在原 `140ms background-color` 过渡中，截图呈中间灰色，单次即时取样为 3.7175，重试通过。flaky 门禁正确拒绝，未把重试通过计作验收。首次日志、Trace、截图和视频保留在本轮产物目录的 `remote-first-browser3.log` 与 `first-browser3/`。

取色辅助函数现在沿元素及背景祖先等待浏览器实际运行/待启动的 CSS 过渡完成，再使用原 canvas 合成算法和 4.5 下限；未禁用动画、改主题或降低对比度要求。此修正属于测试取样同步，产品源码保持本次提交状态；其它分片完成后核对完整首轮结果，修正 SHA 的整轮另行记录。

首轮最终质量、Docker smoke、Backend 及 Browser 1/2/5/6/7 成功；Browser 4 的既有 SSH 重连场景在真实重连、视口和命令输出均成功后，等待日志超时。诊断实现将连接成功从 debug 提到 info，旧测试仅收集 debug/log，漏收了成功记录；现收集 info 并明确断言失败为 level 20、成功为 level 30，仍验证原目标、重连阶段和密码不外泄。其它 debug 日志消费者已核对，无同类等级变化。首轮完整失败输出保留 `remote-first-failed.log`，job/SHA 保留 `remote-first-run.json`。目录场景另在每次打开页面后断言目标主题已生效，再等待实际过渡完成，避免取到初始主题。

### 整轮远程通过与收口

修正提交 `a5491eabad5fb911c94c2169add5299778999241` 的 [E2E 42143687430](https://github.com/0honus0/nexus-terminal/actions/runs/42143687430) 全部成功：质量与格式、双端生产构建、Docker smoke、Backend 和七个 Browser 分片通过，耗时汇总更新成功；文档截图作业按条件跳过，非测试场景跳过。Reporter 共 618 条唯一 passed，零失败、重试、flaky、重复或场景跳过；Backend 144，Browser 1–7 为 50/57/66/81/61/96/63。相对上一完整基线新增8项正式 E2E（工具加载/MCP/ACP入口3项、目标UA增加1项、诊断4项），工具加载入口另承载双协议28项真实后端 Node 测试，签名插件保留实际授权和后续模型步骤账本断言。

源码与消费者、边界/结构和容量四表已完成审核，无待修缺口；根 check、全仓格式、生产及测试客户端构建通过，本轮 E2E vue-tsc 和54条本地文档文件链接检查也通过。首轮修正仅同步真实日志级别和取样时机，保留原功能/对比度断言与当前 UI。完整运行记录为本轮目录的 `remote-final-run.json/log`、逐项核对为 `remote-final-run.summary.json`，8份实际耗时产物在 `final-timings/`，首次失败证据继续保留。

远程自动提交 `225618e9` 仅修改耗时估算，已审核并快进同步；本次收口只更新文档，不将元数据或文档提交描述为直接被测 SHA。PLAN 清除已验施工区，真实模型效果、弱网/后台现场、手机软键盘与其它既有故障交错仍保留原待验范围。无数据库变更，无发布镜像或生产部署，专用产物按用户要求保留至通知清理。

## Fastify 迁移完整性与框架能力复核（2026-11-06）

本轮按用户要求审核后端完整 HTTP 流程与可复用框架能力，未修改产品代码、安装依赖或提交推送。旧 router/context/JSON 调度的运行时消费者已移除，七模块普通 HTTP 通过同一 Fastify 路由安装入口；Service/Model 未引入 Fastify。原生 Node listener 与 `ws` 仍承接稳定端口、在线恢复代次及 WS 业务生命周期，不能视为遗留路由器，也不能直接用 `app.close()` 取代维护排空。

| 审核项               | 结论与后续                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实际遗漏：raw 响应头 | `suspend-http.ts` 日志导出仅写 Content-Disposition/Content-Type；`plugin-intent-http.ts` 文件下载及 `file-download-http.ts` 的 416 分支缺少 nosniff。Fastify 全局 `reply.header()` 不会在 hijack 后自动写入 raw。实际挂起日志路由搭配 service stub 的真实 HTTP 请求得到 200，但无 no-store/nosniff；需要补齐并测真实响应头。Nginx 的 nosniff 不能证明后端自身已覆盖，也不补日志的 no-store。                                        |
| 原生发送与编码       | 多处预先 JSON.stringify/encodeAgentJson 计算预算，再 reply.send 对象，发生重复序列化；可用原生 serializer/onSend 在单次编码后检查实际字节，保留 Shared 预算与业务错误投影。简单 Buffer/Readable 可改原生 send；带凭据撤销、最后字节授权和业务交付确认的流仍保留 owner。                                                                                                                                                             |
| hooks 与模块边界     | http-bindings 包装十类 hooks 并适配 callback/Promise，Operations 另外用多个 WeakMap 记录请求阶段。可用 encapsulated plugins、decorateRequest 和 route config 收敛结构；Fastify response 完成不代表异步 handler/审计/补偿结束，真实任务排空不能删。                                                                                                                                                                                  |
| schema 与文档        | 当前未给真实路由安装 schema/validatorCompiler/serializerCompiler。Shared codec 仍承担严格校验，不是完全无校验；统一 schema 后可利用框架验证、响应序列化及 OpenAPI。不得单独抄一份后端 schema，响应 schema 也不代替授权和业务 mapper。                                                                                                                                                                                               |
| 上传解析             | http-body 先缓冲整个请求，再伪造 IncomingMessage 交给 Formidable，并收集各 part；连接导入还自行解析 JSON。`@fastify/multipart` 的流式 parts 可去掉中间整包和伪请求。保留授权先于读取、总字节预算、各 part 限制、秘密清零及取消；插件的 fileSize/parts 不等于整个 multipart 总预算，route.bodyLimit 不能代替该检查。不使用自动落临时文件的 saveRequestFiles 或默认整包附加 body 模式。                                               |
| 原生取消存在版本问题 | Node 26.13.0 + Fastify 5.12.8，设置 handlerTimeout=100ms、handler 等待 150ms；GET 得 503，而正常 JSON POST 在请求体读完时 raw close（complete=true、aborted=false）误触发 signal，并清除 timer，最终仍得 200。源码 route.js/request.js 监听 IncomingMessage close，reply.hijack 还会移除监听。本项目未启用这两项能力，不构成已上线业务超时失效；不能直接用其替换现有取消逻辑。未来接入还须补 FST_ERR_HANDLER_TIMEOUT 安全错误映射。 |
| 日志与安全策略       | request.id/genReqId、onResponse 等可统一技术关联与耗时；现有 Pino 安全白名单和业务审计保留，不能直接打开默认请求日志暴露 URL/凭据。CORS/JWT/session 插件不能替代同源校验、持久会话撤销、事务内授权和来源封禁。前端 Nginx 已开 gzip，暂无再加全局后端压缩的依据。                                                                                                                                                                    |

本地诊断脚本与 JSON 结果保存在 `/home/honus/nexus-task-artifacts/http-fastify-20261106/http-capability-audit.{mjs,json}`；真实 listener + 实际 suspend 路由使用现有 dist，service stub 只提供固定日志字节，不访问数据库、远程主机或真实会话。取消探针直接使用安装的 Fastify，未使用 inject 模拟连接。该脚本报告现状，不是通过的产品回归测试。本轮未重新执行上一节的全量验收。

官方插件选型通过 GitHub 仓库 API 和 README 核对（2026-11-06 查询，Star 会变化）：

| 插件                                                                                                                                                                                                                                                                                      | Star                        | 结论                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [@fastify/multipart](https://github.com/fastify/fastify-multipart)                                                                                                                                                                                                                        | 539                         | 满足 H-14，优先候选；明确选择支持 Fastify 5 的版本，采用 parts 流式消费和显式限制。                                                              |
| [@fastify/swagger](https://github.com/fastify/fastify-swagger)                                                                                                                                                                                                                            | 1101                        | 满足 H-14；README 声明 >=9.x 支持 Fastify 5。先建立 Shared schema 来源，再注册插件汇总实际路由，不能直接生成准确的现有 codec 契约。              |
| [@fastify/cookie](https://github.com/fastify/fastify-cookie)                                                                                                                                                                                                                              | 300                         | 功能能替代手拼 Cookie；当前不满足 H-14。若以后采用仍须保留同名重复 Cookie 拒绝和凭据撤销，不以普通字典解析覆盖这些语义。                         |
| [swagger-ui](https://github.com/fastify/fastify-swagger-ui)、[helmet](https://github.com/fastify/fastify-helmet)、[compress](https://github.com/fastify/fastify-compress)、[websocket](https://github.com/fastify/fastify-websocket)、[static](https://github.com/fastify/fastify-static) | 192 / 464 / 230 / 467 / 499 | 当前均低于 H-14 门槛，不引入。即使将来满足，也须核对既有 Nginx 压缩/安全头、插件 sandbox、受权资源读取和 WS 维护生命周期，不能为插件数量而替换。 |

## Fastify HTTP 整体迁移（2026-11-06）

基于 `main/48d6f557f0995273f98a29be673a0ff44f546fbc` 的未提交工作区；Node 26.13.0、pnpm 12.16.1、Fastify 5.12.8。基础框架与 Remote/System 由主代理迁移，Access/Agent/Preferences/Targets/Operations 由 Sol 子代理分工，主代理统一审核与验收。保持 UI、Shared DTO、业务权限和数据结构，无数据库迁移；普通 JSON 的读取时机改由框架负责，使用说明与 API 已同步。专用证据目录为 `/home/honus/nexus-task-artifacts/http-fastify-20261106`，保留至用户通知清理。

**功能对应审核**

| 功能与真实消费者                    | 最终实现与结论                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 七模块 HTTP 与 Bootstrap            | 各 `interfaces/http` 直接使用 Fastify `url/handler/request/reply/bodyLimit`；删除旧 router、HttpRouteContext 和 JSON 调度，无双轨。                                                  |
| Access 会话、因素与 Remote 资源交付 | 响应真实 finish 且最终成功状态才确认交付；异步 onSend 失败后撤销凭据、释放 Shell/Files/桌面票据，原 owner 保留清理失败。                                                             |
| 上传、下载、插件资源与背景图片      | rawBody 独立 parser scope 保留原始流；显式 HEAD、Range、multipart 和插件通配路径校验保留。背景首字节前读取失败可返回安全 JSON，部分交付失败结束原传输。                              |
| 审计、身份与安全失败                | 来源准入先行，审计登记原身份，再在解析前拒绝未认证写入；onResponse 按最终状态记录，包括解析拒绝、401 和失败响应钩子。审计失败不改写业务响应；技术兜底不泄漏异常正文或未确认 Cookie。 |
| 备份恢复与 WebSocket                | 稳定 listener 保留，维护排空真实 handler/hooks/传输后替换完整 Fastify 实例；旧恢复响应退出后关闭旧实例。WS 继续使用现有 ws 协议与授权。                                              |

**职责归属审核**

| owner           | 核对结果                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform HTTP   | `http-bindings` 持 Fastify 和请求任务；`http-server/http-lifecycle` 持 listener、WS 与维护代次，断连不代替真实任务结束。                                |
| 模块 interfaces | 严格解码、白名单投影、原始流与交付确认仍由各模块持有；Fastify 类型未进入 Service、Model、storage 或 Shared。                                            |
| Operations      | `operation-observer` 保留原请求、身份与实际 handler 完成，`AuditEventOwner` 追踪发布及拒绝因果；System maintenance 路由不进入该请求观察，避免等待自身。 |
| 测试夹具        | 迁移种子在应用完整关闭后写入；每轮唯一 NEXUS_E2E_DATA_ROOT 由父配置传给 workers/后端，保留恰好一个实例的断言，不扫描历史目录。                          |

**类型归属审核**

| 契约                            | 核对结果                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| HttpRoute/HttpRequest/HttpReply | Platform 仅约定 Fastify 泛型；Body 为 unknown，查询保留 URLSearchParams 重复值，不保留旧 context 适配。 |
| Shared 与内部应用类型           | 请求/响应 codec 与模块 mapper 原 owner 保留；无新增跨层 DTO、数据库表示或兼容分支。                     |
| 路由 hooks 与 raw 流            | 框架声明需要的断言限于 Platform 技术边界；模块直接消费原生 hooks，上传预算与取消仍归原业务 owner。      |

**完成证据**

| 范围                 | 命令、结果与边界                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心 HTTP 失败与维护 | `node --test --test-concurrency=1 --test-timeout=60000` 执行 fastify/resource-delivery/access-delivery/backup 四个文件，52/52 通过，无跳过或取消；`reviewed-http.tap`。                                                                                 |
| 正式后端组           | `NEXUS_E2E_SUITE=backend pnpm test:e2e:remote -- --timeout=120000 --retries=0`，146/146 通过，6.4 分钟；`e2e-backend-final.log`、独立 report/results/durations。                                                                                        |
| 最终补充浏览器与接口 | 13 个指定 spec 共 53/53 通过（44 项浏览器、9 项接口），无重试，2.5 分钟；`e2e-browser.log` 与独立 report/results。覆盖登录、连接/密钥管理、备份 UI、审计、插件 SDK/仓库、GIF/文件交付和上传；最终未认证请求审计 hook 调整在此重新构建后验证。           |
| 静态与构建           | 最终根 `pnpm run check` 通过（`check-delivery.log`），补充回归入口重新完成双端生产构建和 E2E clients 构建（`e2e-browser.log`）；`pnpm run format:all:check` 通过（`format-delivery.log`），`git diff --check` 通过；最后仅改文档并复查受影响 Markdown。 |
| 未验范围             | 尚未提交推送，未触发本轮 GitHub Actions、全部浏览器分片或 Docker smoke；不替代真实手机、外网及生产升级验收。                                                                                                                                            |

补充真实浏览器远程桌面专项 `specs/ui/rdp-remoteapp-fullscreen.spec.ts` 5/5 通过，无重试，26.2 秒；证据 `e2e-desktop.log` 和独立 report/results。覆盖 RDP 设置、剪贴板、全屏、120 DPI、窗口交互、重连时文件批次/音频资源清理，以及 VNC 连接、输入、剪贴板与窗口交互。该正式流程通过不替代独立旧 VNC 夹具失败的根因定位。

首轮正式后端组为 143/146：Agent 文件迁移测试在活跃数据库上准备旧数据导致锁冲突；RDP 用户夹具和挂起日志夹具发现历史实例目录。均保留首次日志 `e2e-backend.log`，修复离线种子与运行目录隔离后完整重跑通过。旧工具图片发现、批量文件参数、Job 故障注入、Passkey 数据库路径及备份表数等消费者同步当前契约；既有有效断言保留。初始全目录 Node 探测包含未更新的独立夹具和缺少正式 runner 配置的测试，其失败日志 `backend-regression.log` 不属于通过证据；正式后端通过不能宣称所有独立 Node 测试均通过。

独立 Node 探测的剩余失败已按证据分组：`machine-admission`、`authority-monitor` 使用旧 execute/单命令 Job 契约；`integration-races` 缺插件安装表和当前 drain mock；`public-boundary` 漏既有 lastConnectedAt；Files 名额场景仍断言已移除的 8/16/64 固定上限，部分资源夹具按旧单资源关闭计数或未注入清理失败便期待 unknown。桌面证书测试缺数据库参数、旧 RDP 夹具未走现有证书确认；ENOSPC worker 在用户命名空间执行本机 Node 路径被拒绝，未触发故障场景。独立 VNC 浏览器握手、server-transfers 未进入预期 mock 和旧前端测试页定位仍未归因，不概括为已通过或全部环境问题；相关业务 Service/Model 本轮未改，继续作为独立测试维护项保留。

## Fastify 原生能力重设计（2026-11-06）

沿用 `main/48d6f557f0995273f98a29be673a0ff44f546fbc` 的迁移工作区，Node 26.13.0、pnpm 12.16.1、Fastify 5.12.8。按用户要求替换可由框架承担的旧设计；Shared 对外协议没有变化，前端真实入口继续使用原契约，无需兼容分支、UI 或数据库变更。实现由原 Sol 分工继续，主代理统一补审和验收；最后两项独立复核因上游 503 未完成，不作为独立审核通过证据。

**功能对应审核**

| 功能与消费者                | 最终实现与结论                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 连接、主题、背景与备份导入  | `@fastify/multipart@10.1.7` 的 parts 流替换整包缓冲与 Formidable；仅在上传路由 scope 安装。文本字段也按字节读取，保留畸形 UTF-8 拒绝及秘密清零，无上传临时文件。 |
| 七模块 JSON 响应            | 原生 serializer 单次编码并检查实际字节，保留 preSerialization 对象观察；路由 errorHandler 保留安全错误、写入未知、凭据撤销与 RPC envelope。                      |
| 日志、主题与 Agent 文件下载 | 普通 Buffer/Readable 交给原生 send；Artifact 与 Plugin Intent 共用流交付 owner，最后权限及长度检查前保留末字节。复杂远程/备份传输的业务收尾继续由原 owner 负责。 |
| 审计与请求结束              | 六个 WeakMap 合并成单一请求状态，删除重复完成 resolver；按真实 handler Promise 与传输完成共同收口，保留解析失败、断连后执行及维护排空。                          |

**职责归属审核**

| owner                 | 审核结论                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform HTTP         | 持原生路由 scope、multipart 技术解析和总字节预算；JSON 与 multipart 预算独立。hijack 安全错误清除尚未发送的 raw headers，避免旧 Content-Length/下载头污染 JSON。 |
| 模块 interfaces       | 保留白名单投影、Shared 预算与业务错误分类；serializer 失败走原生错误通道，不能依赖 handler try/catch。                                                           |
| 业务资源与 Operations | 继续负责授权、取消、未知写入和真实任务排空；响应结束不等于后台任务停止。框架 signal/timeout 的已证实 POST 问题不通过删除 owner 规避。                            |

**类型归属审核**

| 契约                      | 审核结论                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Shared 请求与响应         | 仍为唯一对外契约；无复制 schema、旧协议分支或新增存储表示。                                          |
| Fastify 及 multipart 类型 | 留在 Platform 和 HTTP interfaces，未进入 Service/Model；路由 config 显式携带 multipart 封装预算。    |
| Agent 响应与流交付        | 具名内部 helper 统一 serializer/errorHandler 与授权交付；HTTP 状态和工具 RPC envelope 保持各自契约。 |

**调用链审核**

| 调用链                                          | 核对重点与结果                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 浏览器导入 → parser → 模块                      | 来源/身份准入先于读取；JSON bodyLimit 与 multipart 声明量/实际量分别核对；未结束 boundary 的 part 超限及时结束，错误交付后关闭原连接。 |
| 应用结果 → preSerialization → serializer → send | 只编码一次，预算覆盖变换后的对象；写入后编码失败按 operation_unknown，Access 未交付凭据撤销。                                          |
| Artifact/插件源 → Readable → HTTP               | 等待响应与源清理；最后字节不早于最终权限检查，失败保留因果与取消，不虚报完整下载。                                                     |
| 请求 → Operations → handler/response → 维护     | 解析失败可审计，断连后的异步 handler 仍计入排空；保持恢复代次及稳定 listener，不等待自身维护请求。                                     |

**最终验证**

证据均在 `/home/honus/nexus-task-artifacts/http-fastify-20261106`，保留到用户通知清理。

| 范围             | 结果与证据                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心 HTTP 专项   | 8 文件 91/91 通过，`native-capabilities-accepted.log`；multipart/backup 补充组 31/31 通过，`native-multipart-backup-final.log`。两组有重叠。                                                                                                                                |
| 正式本地组合回归 | 正式 runner 执行 backend-specs 全量与 11 个相关浏览器 spec，`--timeout=120000 --retries=0`；177/177 通过，8.1 分钟，包含后端 146 项及相关浏览器 31 项。`native-e2e-final.log`、`native-e2e-final-report/`、`native-e2e-final-results/`、`native-e2e-final-durations.json`。 |
| 静态与构建       | 最终源码根 check 通过，`native-check-delivery.log`；全量 ESLint/格式通过，`native-format-check.log`；最终正式 runner 重新完成双端生产和 E2E clients 构建。文档收口另验格式与 diff。                                                                                         |
| 未验范围         | 未提交推送或触发本轮 GitHub Actions；未运行全部浏览器分片或 Docker smoke，不替代真实手机、外网及生产升级。前轮记录中的独立旧夹具债务继续保留。                                                                                                                              |

首轮正式后端 145/146：新增 Fastify wrapper 的测试夹具缺少真实平台 await-reply 桥，改真实 listener 后又发现 Node 26 fetch 不支持覆盖 Host、原生 DELETE 测试缺 Content-Length；现使用真实 listener 与明确请求头的 Node HTTP 客户端，保留全部功能断言。Multipart 首次失败暴露提前 destroy 原请求导致正常备份拒绝响应被截断，以及未发送最终 boundary 时 part 超限无法退出；已改为安全响应后关闭连接并消费 limit/truncated 状态，继续清零已读秘密。首次失败日志与后续专项日志均保留，不以最终通过覆盖失败证据。

原生 `request.signal` / `handlerTimeout` 的版本问题沿用前节真实探针证据，未接入项目。仅安装符合 H-14 且支持 Fastify 5 的 multipart 插件；Shared schema/OpenAPI 留作独立后续任务。本轮测试服务已退出，日志归集至 `native-e2e-final-logs/`，未删除专用产物或操作生产环境。

## Fastify 插件替换与维护复核（2026-11-06）

基于 `main/48d6f557f0995273f98a29be673a0ff44f546fbc` 的未提交迁移工作区继续；用户明确将 H-14 门槛改为 Star 不低于 200，并要求仍在维护、问题修复及时，已更新唯一规则 owner。Node 26.13.0、pnpm 12.16.1。以下 Stars 和维护事实为本轮 GitHub API 核验快照，不将 Stars 或官方组织身份当作质量保证。

| 候选                                                        | Stars | 维护与适配结论                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cookie](https://github.com/fastify/fastify-cookie)         | 300   | 采用 11.1.5；10 月 27 日发布修正自定义编码。HTTP 用原生解析钩子，WS 用已注册实例的 parseCookie；不用存在初始化缺陷的独立导出。                                                                                                                                |
| [Helmet](https://github.com/fastify/fastify-helmet)         | 464   | 采用 13.2.0；10 月 13 日发布全局 nonce 继承修复，相关 PR 两天合并。沿现有策略配置，不引入其他默认响应头。                                                                                                                                                     |
| [Multipart](https://github.com/fastify/fastify-multipart)   | 539   | 保留前轮已采用的 10.1.7；仓库 11 月 5 日仍有维护活动，parts 的真实边界回归继续覆盖。                                                                                                                                                                          |
| [WebSocket](https://github.com/fastify/fastify-websocket)   | 467   | 11.3.7 于 11 月 4 日发布自定义 preClose 的 upgrade listener 清理修复；核对源码后保留现有 ws。插件绑定 Fastify 实例的 upgrade/close 生命周期，而本项目稳定 listener 跨代存活，旧恢复响应可晚退出；替换仍需重写同一维护协调，不能删除现有代次、授权及业务排空。 |
| [Static](https://github.com/fastify/fastify-static)         | 499   | 11 月 4 日连续修复目录/多 root 预压缩回退。前端静态资源由 Nginx 承担；插件资源经过授权内容 owner，不直接公开文件系统 root，不重复安装。                                                                                                                       |
| [Compress](https://github.com/fastify/fastify-compress)     | 230   | 10 月 27 日发布 9.3.0；现有 Nginx 已有 gzip、预压缩、Vary 和代理压缩配置，不在 Node 重复压缩。                                                                                                                                                                |
| [CORS](https://github.com/fastify/fastify-cors)             | 496   | 11 月 5 日发布 11.4.1，修复 Vary token；CORS 不能代替 Host/Origin/Fetch Metadata 的来源准入。公开 SDK 的固定星号响应无需预检路由和通用 CORS 状态机，保留原声明。                                                                                              |
| [Rate Limit](https://github.com/fastify/fastify-rate-limit) | 604   | 11 月 2 日发布 11.2.2，修复管线请求计数快照；现有登录策略按认证失败在 SQLite 原子累计、持久封禁并通知，不是按 HTTP 请求数限流，不用通用插件改变规则。                                                                                                         |
| [Swagger](https://github.com/fastify/fastify-swagger)       | 1101  | 11 月 1 日仍发布 schema 引用修复；插件不能从现有严格 codec 生成等价 schema。须先完成 Shared 单一 schema 来源，保留既有独立任务，不维护平行协议定义。                                                                                                          |
| [Swagger UI](https://github.com/fastify/fastify-swagger-ui) | 192   | 虽仍维护，但低于本轮明确门槛，不采用。                                                                                                                                                                                                                        |

维护证据保存在 `github-audit.json`、`maintenance-audit.json`、`adopted-fix-evidence.json` 和 `additional-candidates.json`。Cookie [PR 374](https://github.com/fastify/fastify-cookie/pull/374)/[377](https://github.com/fastify/fastify-cookie/pull/377) 的非安全编码修复分别经过约 57/33 天合并，不能宣称所有问题都能在数天修复；[issue 383](https://github.com/fastify/fastify-cookie/issues/383) 的独立导出初始化问题已有修复 PR、尚未进入采用版本。本轮依据已发布版本在实际使用路径的修复与回归选型，未修复路径明确不使用；没有本地补丁或私有 API 绕过。Helmet [PR 324](https://github.com/fastify/fastify-helmet/pull/324) 为 10 月 11 日提出、13 日合并。未来升级仍按 H-14 重审缺陷和发布，不承诺供应商修复时限。

**功能对应审核**

| 功能与消费者                       | 最终实现                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP/WS 会话读取                   | 插件解析一次，Platform 绑定请求事实并统一拒绝重复名称和原有超量 Cookie；HTTP 原生 cookies 与原始请求认证消费者一致，不对不透明 token 做 URI 解码。WS 在授权前通过当前代已注册实例解析。             |
| 登录、2FA、Passkey、退出与改密     | 删除手拼 Cookie 属性；Access 的唯一策略 helper 调用实例 serializeCookie，保持 Path、HttpOnly、SameSite、Secure 及原有效期。直接设置响应头使既有错误通道可移除凭据，不引入插件 pending cookie 队列。 |
| Plugin、SDK、HTML 主题、背景与下载 | Helmet 持有安全头生成；模块保留 CSP/CORP/Referrer 策略，普通流与 hijack 都读取同一 raw 响应头。删除模块各处重复 nosniff；技术兜底绕过插件时仍清头并写最小安全错误。                                 |

**职责归属审核**

| owner               | 结论                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Platform HTTP       | 注册 Cookie/Helmet，维护源验证、解析事实、重复拒绝与代次；不把插件 request/reply 传入应用或 Shared。       |
| Access interfaces   | Cookie 属性属于认证策略，序列化属于插件；真实 finish、失败撤销和未知结果仍由 deliverAccessResult 追踪。    |
| 内容模块 interfaces | Helmet 的 route options/调用归资源出口；授权、字节预算、源确认和收尾留原 owner，没有通用静态文件路径绕过。 |

**类型归属审核**

| 契约             | 结论                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Fastify 插件类型 | 仅在 HTTP 技术边界使用。Cookie 类型暂漏 parseOptions.decode，用具名推断配置同时保留标准 encode，不加 any、断言或上游补丁。 |
| Shared/前端      | 对外请求、响应、身份和 UI 均不变；既有前端直接消费，通过浏览器真实流程验证，无兼容层或数据库迁移。                         |

**调用链审核**

| 调用链                                  | 核对重点                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 来源 → Cookie → 审计/应用准入 → handler | Cookie 在应用身份读取前初始化；重复项不能被 first-wins 解析误认证，审计与 HTTP/WS 看到同一事实；旧请求继续绑定原值。 |
| 颁发凭据 → 序列化 → finish/错误         | 不使用延迟 cookie 队列，错误移除 Set-Cookie 后不能重发；Passkey 超限、断连、onSend 失败仍撤销原凭据。                |
| 原生/原始下载 → Helmet → 真实传输       | 保留原 CSP directives，禁用原本不存在的 HSTS/X-Frame/COEP/COOP 默认项；技术错误移除旧下载元数据后保留 nosniff。      |
| 在线恢复 → 新实例插件 → HTTP/WS         | 新实例先注册插件再开放；旧实例等待原请求退出。新增跨恢复 HTTP/WS Cookie 场景，未改变稳定 listener 和业务排空。       |

**验证记录**

专用产物：`/home/honus/nexus-task-artifacts/http-plugins-20261106`，保留至用户通知清理。核心 8 文件 94/94 通过（`http-regression-final.log`）；其中新增实际 Cookie/WS/恢复、Cookie 安全交付及真实内容路由的 Helmet 政策检查，已由既有正式 fastify-transport wrapper 收集。首次 91 项专项有一个 Agent 独立夹具未注册 Cookie/绑定解析事实，未执行预期业务写入；同步该夹具后保留原未知写入断言并完整重跑，首次证据为 `http-regression-first.log`。两个独立 serializer 夹具均安装真实插件，不用生产兼容分支绕过。

根 check 通过（`check.log`）；初次构建发现插件配置类型和 Helmet boolean 声明不一致，按实际公开 API 修正后生产后端构建通过（`build-backend-second.log`）。初次全量格式检查仅发现更新后的 HUMAN 表格格式，已修正。最终全量 ESLint/格式通过（`format-final.log`），文档收口另核对格式与 `git diff --check`。正式本地 runner 重新构建双端与 E2E clients，执行完整 backend-specs 与 11 个相关浏览器 spec，`--timeout=120000 --retries=0` 共 **177/177 通过**；日志为 `e2e-combined.log`，报告、结果、耗时及逐项日志分别为 `e2e-report/`、`e2e-results/`、`e2e-durations.json`、`e2e-logs/`。这些组与 94 项专项有覆盖交集，不相加为唯一场景数。覆盖认证、Cookie 交付、备份恢复、插件 iframe、主题/背景、文件交付、HTTP/WS 撤销及 SSH/弱网场景；USAGE 的认证、插件、外观与下载说明已核对，本轮不改正常产品行为。

本轮测试服务已退出，专用产物继续保留。尚未提交推送、触发本轮 GitHub Actions、执行全部浏览器分片或 Docker smoke；不替代真实手机、外网及生产升级验证，前轮独立旧夹具债务继续保留。

### 官方应用插件兼容性补审

用户继续要求核对应用插件是否需要同步变更。检查现有插件工作区 `/home/honus/nexus-task-artifacts/agent-tool-reuse-20261105/nexus-agent-plugins`，本地与远程 main 均为 `7f0498cf14fa50f7a664adf892ef041c62ad7fab`，工作区干净；Nexus Agent 1.0.4、Full-stack 1.0.3 均使用 SDK "1"。本轮 HTTP 内部迁移没有修改 Shared 插件协议、宿主 SDK、能力基础值或 Agent contribution，故无需改插件清单、权限或版本。

Nexus Agent 没有前后端入口，toolNames=null 按宿主当前授权目录发现工具；Full-stack 通过 `/sdk/frontend-v1.mjs` 与 MessagePort 调用 host.appInfo/storage，后端只使用原隔离 SDK/IPC，不依赖 HTTP 框架或直接读取 Cookie。其 plugin_tool_call 白名单、context.read/plugin.invoke 声明及上下文/工具请求形状仍匹配当前宿主。两个真实 manifest/agent.json 已经当前 Shared decoder 校验，Full-stack 实际使用的四类 SDK 请求形状也通过；插件仓库 lint、格式及 check 全部通过，未修改源码或重新发布。

补跑正式 `agent/plugin/custom-surface.spec.ts`，1/1 通过，无重试：覆盖隔离 iframe/SDK 握手、前后端 AppStorage、文件/子进程权限拒绝和跨 App 数据隔离。该浏览器场景使用仓库签名受控夹具，不冒充官方发布包的完整安装验收；官方源码另按上述调用链及 Shared 契约核对。日志、报告及 contracts.log 保存在 `/home/honus/nexus-task-artifacts/http-plugins-20261106/app-review`；服务已退出，产物保留至用户通知。本轮未提交推送或发布。

### 提交前复核与交付授权（2026-11-06）

复核稳定 listener 的异步代次替换、来源/会话准入顺序、真实 handler 排空、multipart 超限及秘密清零、下载末字节授权、凭据失败撤销和原生 serializer 错误出口，未发现新的阻断问题；四份审核表结论保持有效。确认无旧 HttpRouteContext、http-router、Formidable 或整包 multipart 解码消费者。`git diff --check` 通过，生产依赖 `pnpm audit --prod --audit-level=high` 返回无已知漏洞。证据目录为 `/home/honus/nexus-task-artifacts/http-release-20261106`。

用户已授权提交推送、修复远程完整 E2E 至通过、发布 linux/amd64 dev 镜像；不更新生产主机。此处记录交付开始状态，不将尚未执行的远程验证或发布写为完成。

## Fastify 迁移远程验收与 amd dev 发布（2026-11-06）

提交前审核后推送 `c15862cec37f5e25a5f63dc1908174c6d6ec525d`。[E2E 42161301186](https://github.com/0honus0/nexus-terminal/actions/runs/42161301186) 首轮完整通过：双端生产构建、质量与格式检查、runner 更新、8 个测试分片及 Docker smoke 均 success，无需失败修复或重跑。质量作业另含 7 项产物复用逻辑测试。文档截图更新按触发条件跳过，不属于场景跳过。

| 分组        |                         首次通过 |
| ----------- | -------------------------------: |
| Backend     |                              146 |
| Browser 1–7 | 39 / 75 / 72 / 69 / 78 / 82 / 59 |
| 合计        |                              620 |

核对正式 Reporter 的 620 条唯一结果，全部 passed，失败、重试、flaky 和场景跳过均为 0。新增 HTTP 契约专项由正式 backend 分片执行。原独立旧夹具、真机与外部供应商待验仍保留在 PLAN，不以本轮结果宣称未执行专项均通过。

本地已快进同步 CI 提交 `620c0828e444e7fc5b4876713cecd9d1618e2967`，仅修改 `scripts/e2e/duration-estimates.json`；运行源码与被测提交一致。远程日志、作业状态、Reporter 统计与各分片 timings 保存于 `/home/honus/nexus-task-artifacts/http-release-20261106`。

[发布 42162441122](https://github.com/0honus0/nexus-terminal/actions/runs/42162441122) 成功，输入为 `channel=dev`、`architecture=amd`，源提交 `620c0828e444e7fc5b4876713cecd9d1618e2967`。直接读取 GHCR 核对 `ghcr.io/0honus0/nexus-terminal:dev` 与 `sha-620c0828e444` 指向同一摘要 `sha256:333bf9ede35afa56b1cc1c35769364844fb54ff5ef521d414256c7fb9313525f`；运行平台为 `linux/amd64`，OCI revision 与源提交一致。另一个 `unknown/unknown` manifest 是构建证明，不是额外运行平台。发布日志和 registry manifest/config 保存在同一证据目录。

本轮无需数据库迁移，未更新生产主机、未发布 latest。应用插件契约兼容，官方插件仓库无变更，不重复发布插件。交付后的文档提交只刷新验收与计划，不改变被测或发布源码。

## 登录布局与 Passkey 命名：首轮边界核对（2026-11-06）

本轮首轮本地 19 项回归中 17 项通过，两个深浅主题布局场景在 390×400 失败。精确测量主按钮 top=348.125、height=52、bottom=400.125：短屏 46px 规则被主按钮高优先级选择器覆盖；Playwright 的最小滚动还留下 0.125px 的像素舍入。修复统一通过 `--auth-control-height` 控制输入框、密码登录、Passkey 按钮高度；测试明确滚动居中并执行真实点击可达性预检，保留完整可视边界及等高断言，不放宽断言容差。首次日志/trace 与随后诊断保留在 `/home/honus/nexus-task-artifacts/auth-oidc-passkey-20261106`，修复后 `layout-fixed.log` 3/3通过，包含深浅主题六视口和真实Passkey流程。

## OIDC、登录布局与 Passkey（2026-11-06）

基线 main `37808319`，Node 26.13.0 / pnpm 12.16.1；本轮未提交工作区。证据集中于 `/home/honus/nexus-task-artifacts/auth-oidc-passkey-20261106`，不代表远程生产配置验收。

选型核实：[openid-client](https://github.com/panva/openid-client) 2440 stars、MIT、6.8.9（2026-11-02），issue903 当天修复并发布；[Fastify OAuth2](https://github.com/fastify/fastify-oauth2) 319 stars、8.3.2（2026-10-19安全修复），偏 OAuth 流程，完整 OIDC 验证选择前者。使用库的非否认检查显式验证 ID Token 数字签名，不只依赖 TLS。

[Pocket ID](https://github.com/pocket-id/pocket-id) 10064 stars、v2.19.2，名称目录固定在主仓库 commit `23d7968ccdcbe2343d2e025187f226ded9aa10ea`，407项名称并保留 BSD-2-Clause 授权；未直接依赖2026-11-03已宣布弃用、计划置空 JSON 的 passkeydeveloper 远程目录，也未引入低于200 stars的小 fork。维护脚本 `scripts/maintenance/update-passkey-authenticators.mjs` 以明确commit更新静态快照。

390×400 初测控件底边为400.125px，发现短屏按钮高度受到更高优先级样式覆盖，另有最小滚动舍入。控件统一使用高度变量，测试居中滚动后保留严格边界和真实命中断言；`layout-fixed.log` 3/3通过，含两主题×六尺寸及真实Passkey流程。

OIDC 首轮真实协议测试暴露正常认证拒绝进入审计后台失败收口，按既有Access边界修复；测试IdP的Basic认证还需按OAuth规范解码表单转义，此项修正在夹具，不改变协议库。`oidc-protocol4.log` 十二项通过。组合浏览器首轮33项通过、2项失败：新接口使用自定义serializer时缺少JSON Content-Type，浏览器严格解码拒绝；已补明确Content-Type，`oidc-browser2.log` 双视口完整OIDC登录、解绑、重新绑定2/2通过。

`oidc-storage.log` 四项通过：v3→v4保留账号与旧迁移记录、重复启动及外键/完整性；过期/密码变化/强制Passkey；取消与来源封禁；提交确认丢失后的已知会话撤销。测试使用真实SQLite，外部协议在此专项为受控Port；数字签名验证由协议E2E覆盖。

最终组合 `final-e2e.log` 37/37通过，涵盖既有认证、Passkey自动命名、布局及OIDC。最后审核发现消费回调后、授权码交换期间退出无法阻止迟到登录：流程改为持久 `consumed` 认领，最终事务再次核对记录和期限，退出/新流程/配置变化均可撤销在途流程。修复后 `claim-e2e.log` 17/17通过（14项协议、3项浏览器），`claim-storage.log` 4/4通过；这些测试组有交集，不累计为唯一场景数量。全部新场景已进入正式E2E目录，HTTP场景加入backend分片清单。

真实Pocket ID安装、真实手机键盘、真实磁盘故障不由本地签名夹具或注入故障代替。截图位于同目录 `claim-screenshots`，包括390×400登录和桌面OIDC配置；已人工查看。数据库新增独立v4迁移，启动自动执行，旧迁移不改动；本轮未提交、推送、发布或操作生产。

### 功能对应表

| 功能与真实消费者        | 实际入口及实现                                                                   | 差异与当前状态                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Pocket ID / OIDC 新接入 | Access OIDC 八个 HTTP 入口、Auth API、Security OidcPanel、LoginPage/CallbackPage | 显式绑定已有管理员；三种客户端认证；14 项协议与 3 项浏览器流程通过，含表单保存和禁用退出 |
| Passkey 默认名称        | NativeWebauthn 已验证 AAGUID → FactorModel → 现有 passkey 列表                   | Pocket ID 静态名称，无联网、信任变更或旧数据回填；四种验证器与手动改名回归通过           |
| 登录布局                | LoginView + login-layout.spec.ts                                                 | 保留原主题；统一控件高度、短屏滚动；深浅六视口与 390×400 严格边界通过                    |
| 退出与配置撤销          | access-http、OidcService/Model、SqliteOidcStorage                                | 退出撤销当前在途流程，最终事务复查持久认领；配置变更撤销 OIDC 会话                       |

### 职责归属表

| 关键流程            | owner 与调用链                                                           | 审核结论                                                                                              |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| OIDC 协议与外部网络 | Platform security OpenidClient → openid-client                           | 不自行实现 JWT/OAuth；强制签名、PKCE/nonce/state；禁止远程 HTTP 与网络重定向，响应受既有认证预算约束  |
| 身份绑定与配置      | Service 密码证明 → Model 应用判断 → SQLite 同事务事实与写入              | issuer+sub，不使用邮箱；CAS、原会话/密码版本、来源与强制 Passkey 复查；更换身份配置不沿用旧密钥       |
| 颁发与交付          | Model.complete → deliverAccessResult                                     | 持久认领只允许一次交换；最终事务复查撤销；提交确认丢失撤销已知 bearer；绑定提交不能冒充可回滚         |
| 前端读写与资源      | use-oidc-settings、browser-oidc、CallbackPage                            | generation/AbortController、未知写入刷新围栏；当前 OIDC 会话被撤销后导航登录；秘密不留 sessionStorage |
| 迁移与备份          | Access OIDC SQLite schema → migrations → Bootstrap v4；backup-exclusions | 不改 v1–v3；认证三表排除业务快照；4 项真实存储回归通过                                                |

### 类型归属表

| 类型/边界                              | 唯一 owner 与转换                                   | 审核结论                                                                  |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| 客户端认证取值、Cookie/回调、完整 HTTP | Shared access/oidc values/http/http-codec           | 双端与测试消费；未知字段拒绝；changed 响应也归 Shared                     |
| 应用配置、流程、回调与状态             | 双端 Auth/Access 各自 model/oidc-types              | 表示与用途不同；HTTP/API 明确白名单映射；不向 Shared 泄漏后端秘密         |
| SQLite 记录、事务事实与命令            | Access oidc/storage                                 | Adapter 不引用应用类型，Model 显式转换与事务判断                          |
| 库配置与技术错误                       | Platform security/oidc-port、adapters/openid-client | 库对象/Token 不越界；未知验证错误报不可用，不伪造通过；验证器名称只为显示 |

### 完成证据表

| 项目      | 当前证据                                                                                                                              | 限定范围                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 源码/架构 | 四表完整链路复核，Backend/Frontend/Shared 八节设计及 API/USAGE/DEPLOYMENT 已同步                                                      | 按 H-04–H-08、H-21、E-02.5、E-05.3、E-07.5/E-07.6、E-10.3、E-14.4 核对 |
| 静态/构建 | 双端生产构建 `verified-build.log`，最后认领修复后后端构建 `claim-build2.log`；根检查 `claim-check.log`、格式 `claim-format-check.log` | 本地工作区，不代表远程 CI                                              |
| 逻辑回归  | 完整相关组合37/37；最后OIDC专项17/17、真实存储4/4；390×400专项3/3                                                                     | 分组存在交集，不累计；签名协议和浏览器是真实执行，介质失败为注入       |
| 实机/发布 | Chromium、本地签名IdP、真实SQLite；证据统一保留                                                                                       | 真实Pocket ID、手机键盘与介质故障待验；本轮未提交/推送/发布            |

## 终端重连入口与失败提示（2026-11-06）

本轮基于已有 OIDC 未提交工作区继续修改，未提交/推送/发布。证据统一保留于 `/home/honus/nexus-task-artifacts/terminal-reconnect-20261106`，Node 26.13.0 / pnpm 12.16.1；使用正式前端生产构建、真实后端与测试 SSH，浏览器为 Chromium 桌面及移动模拟，不代替真实手机软键盘。

源码发现两个直接原因：重连按键只挂在 xterm 隐藏输入框，原测试主动聚焦该框后才按键；蓝色挂起标签同样显示提示，却调用直接排除 markedForSuspend 的普通 reconnectNow。错误提示还将 statusMessage 原始安全码写进终端，重复失败会堆积并混入展示快照。

### 功能对应表

| 功能     | 真实消费者                                                       | 结论                                                                              |
| -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 显式重试 | TerminalView 恢复卡片/UiButton/容器键盘                          | 无隐藏输入框焦点也能点击或聚焦容器按Enter；快捷键、Tab不误重试；重试按键不发给SSH |
| 失败说明 | WorkspaceRuntimeSession → WorkspaceLayoutRenderer → TerminalView | 按具名错误分类本地化，给出检查事项，不显示原异常正文，不写终端日志                |
| 挂起恢复 | WorkspacePage → 原目录/Registry恢复                              | 原标签去重、保留接管确认；按钮恢复后原Shell变量保留，没有新增SSH连接              |
| 移动交互 | 按钮/轻点/现有输入与选择                                         | 重连不主动聚焦软键盘；320×400卡片与按钮可见可点击，正常触摸和粘贴回归通过         |

### 职责归属表

| 流程           | owner                  | 审核结论                                                                    |
| -------------- | ---------------------- | --------------------------------------------------------------------------- |
| 输入与呈现     | TerminalView           | 只发布意图；活动/可见/只读检查，不新增全局键盘监听，不替代连接状态          |
| 连接失败与重连 | RuntimeSession         | 原连接Promise、退避、未知结果围栏不变，记录安全失败类别                     |
| 挂起恢复       | WorkspacePage/Registry | 原目录、身份/实例复查及接管确认；重复点击不并发打开确认；退出后晚反馈不回填 |

### 类型归属表

| 边界         | 唯一owner                             | 审核结论                                                           |
| ------------ | ------------------------------------- | ------------------------------------------------------------------ |
| 服务端安全码 | Shared remote/workspace/values        | 沿用现有有限值，无新协议或迁移                                     |
| 本地连接失败 | workspace/model/workspace-error-types | 具名异常转有限分类，presentation出口供Page消费，不靠错误字符串推断 |
| 终端展示     | TerminalView props/interaction        | 文案由装配层转换，终端不深层依赖Workspace                          |

### 完成证据表

| 项目       | 证据                                                                 | 边界                                                                                 |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 静态/构建  | final-check.log、final-build.log、format-check.log、git diff --check | 根类型/ESLint、前端生产构建、全仓格式检查                                            |
| 浏览器/SSH | final-e2e.log：7/7，38.1秒                                           | 桌面/移动初次失败、重试成功、挂起恢复保留Shell、恢复中输入丢弃、触摸取消、剪贴板粘贴 |
| 视觉       | final-screenshots：桌面、390×844、320×400；已人工查看                | 移动为模拟设备，真实输入法仍待验                                                     |
| 交付       | USAGE与Frontend架构已同步                                            | 无新数据库迁移；未提交、推送或操作生产                                               |

首轮 `e2e.log` 3/3与 `mobile-e2e.log` 4/4，最后组合重新验证7/7；分组重复，不累计成14项。审核覆盖H-04–H-07、H-09/H-13、E-05/E-07、E-10/E-14.4；此前OIDC变更及测试证据保留。

## Agent 完整命令日志与空间等待（2026-11-06）

基线 `main/37808319` 的未提交工作区；保留前轮 OIDC/Passkey 和终端重连变更。本轮取消 Shell 完整文本日志的总量限制，32 KiB 只作内联预览，按 Job 保存 UTF-8 数据与索引。Node 26.13.0 / pnpm 12.16.1；证据根目录 `/home/honus/nexus-task-artifacts/agent-output-20261106`，未提交、推送、发布或操作生产。参考 Pi 的完整文件/有限展示设计，源码固定版本及调研保存在 research。

### 契约审核表

| 边界     | Owner 与消费者                                                            | 结论                                                                                               |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 命令输出 | CommandPort → CommandModel → Remote public/mapper → ToolRemoteModel → Job | 全部输出异步交付并传递取消信号；两个流串行保存，保留命令序号/流；预览独立                          |
| 日志读取 | ToolJobService → ToolJobModel → TextLogStore                              | 既有 Job/user/App/Run/目标版本授权；UTF-8 游标和 JSON 预算；unknown 只允许读取证据，不解除执行围栏 |
| 等待状态 | Shared AgentResourceSessionView/codec → WS mapper → Native mapper/资源卡  | waitingOutputJobs 显式映射；沿既有关闭确认和任务取消，不创建第二个执行状态机                       |
| 模型发现 | shell_execute / shell_job_control Host 声明                               | 完成结果首先给 jobId/outputRead，低预览预算仍可看到续读入口；权限与工具输入不变，无插件包变更      |

### 容量审核表

| 项目       | 规则与证据                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| 完整日志   | 不设单任务总量配额；真实 OpenSSH 8 MiB 和后续 stdout/stderr 完整保存；小日志也归同一持久 owner                  |
| 内存       | 每个 SSH 流最多一个已交付 chunk 等待，保存串行；另有 ssh2 自身窗口/Readable 缓冲，不承诺连接总内存仅为预览大小  |
| 模型与续读 | 32 KiB 原内联预览；输出数组原 4 KiB JSON 预算、批量结果原 256 KiB 预算；中文/emoji/BOM/控制字符均按实际编码处理 |
| 物理空间   | ENOSPC/EDQUOT 等待后重试原文件范围；部分写入不重复，最终 sync 迟到空间失败也等待；取消和原 Run 期限不延长       |

### 生命周期审核表

| 阶段          | 结论                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| 创建与派发    | 原 Job 持久准入后创建日志；dispatched 提交及原授权复查后执行一次 SSH；无新数据库结构或迁移                |
| 正常/失败结束 | 成功先刷盘、关闭日志再结算；失败/取消保留已确认前缀；日志关闭真实完成前 Job 仍活动，晚清理失败保留因果    |
| 读取与保留    | 活跃写入/读取保护；Run 结束不删除，文件随数据卷保留；恢复不重放命令，缺失日志明确 available=false         |
| 回收          | Service 决定 owner 不存在才回收；Model 转换、SQL Adapter 查权威存在；周期及启动扫描，单项失败仍处理其余项 |
| 备份边界      | 当前 JSON 应用备份保存任务和预览，不包含 tool-logs 完整文件；完整迁移需要保留数据卷中的该目录             |

### 完成证据表

| 检查             | 证据及范围                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型/ESLint      | close-check.log：根 check 通过，含 Backend、Shared 和 Frontend                                                                                                 |
| 构建             | close-build.log：最终 Backend/Shared；review-build.log：双端生产构建，后续前端源码未改变                                                                       |
| 命令与故障       | verified-e2e.log：5 个正式后端场景通过；后继 preview-e2e.log 通过低预览预算引用；close-e2e.log：收尾变更涉及的权限、完整日志、真实 SSH 三场景再次通过，40.8 秒 |
| 完整日志内部场景 | 正式 runner 包含 Native 文件分页/重启/读写保护、部分写入和空间恢复、取消、unknown/错身份/错版本、Job 等待状态、迟到 sync 故障、实际关闭前保留活动状态          |
| 并发             | 真实 SSH 协议下暂停日志接收时，ACP 审批经独立连接继续；保存回调未形成无界队列                                                                                  |
| 浏览器           | browser-verified-e2e.log：3/3，19.8 秒；1280/390/320 像素资源卡、隐藏/恢复、关闭确认及取消保持；本地模拟手机不代替真机                                         |

初次故障证据保留：旧权限监测夹具的单命令结果和新夹具的 Storage.change 签名已修正；并行启动浏览器与后端遇到测试专用 22225 端口冲突，改串行复测。最初用 ssh2 测试 peer 验证 8 MiB 时，其转发未处理背压及双流写队列收尾，无法证明完整交付；该场景改用实际 OpenSSH，保留相同容量/完整性断言并通过，未放宽产品结束校验。真实介质耗尽、掉电、长时间吞吐和手机实际等待提示按 PLAN 保留；本地专项不冒充远程全量 CI。

最终格式证据：`format-check.log` 全仓 ESLint/Prettier 通过，`diff-check.log` 为空；HISTORY 收口另经 Prettier 与 diff 检查。三个宽度的关闭确认截图位于 browser-verified-report，另已查看前次 320×844 同一界面的截图。

## 前端样式与组件职责重构（2026-11-06）

基线为 `main/37808319` 加本轮开始时已有工作区；OIDC/Passkey、终端恢复、Agent 完整日志等前序未提交改动完整保留。本轮按用户要求由三个 `gpt-6.1-sol/high` 子代理分工实施，主代理复核；无提交、推送、发布或生产数据改动。适用 H-04–H-09/H-12/H-13、E-02/E-03.4/E-09/E-10.1/E-10.3/E-10.4、C-01–C-04。Node 26.13.0 / pnpm 12.16.1，环境入口为 `dependencies-upgrade-20261105/runtime/env.sh`。

证据根目录 `/home/honus/nexus-task-artifacts/frontend-style-refactor-20261106` 保存开始时的 status/diff、完整 frontend src 压缩基线、隔离测试数据库、截图、计算样式、命令和检查日志；基础 CSS 的 AST 迁移证据另在 `/home/honus/nexus-task-artifacts/frontend-style-foundation-20261106/ast-proof.json`。专用测试前端 9998、后端 3001，通过 `https://api.honus.top` 与用户指定 CDP `http://172.30.30.11:9223` 访问；未使用远程生产数据库，测试凭据仅在任务目录权限 0600 文件中。

### 功能对应

| 原功能/消费者                                                            | 最终实现与差异                                                                 | 结论                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| global.css → uiGen2/uiCatalog → 全部基础组件                             | Foundation 拆为十个职责 CSS；App 显式装配，删除旧入口                          | 492 条原规则保留，未改变 CSS layer、有效覆盖和正常 UI     |
| AppUpdatePrompt、NotificationHost、代理/通知目录工具栏                   | 样式归 App、Feedback、对应 feature；Header 与 Toast 的位置关系归 App shell     | Foundation 不再认识上层业务 DOM                           |
| Docker、命令历史、WorkspaceConnectionList 空态                           | 原深层选择器定制改为 UiEmptyState 公开 CSS 变量，含 dense/compact 与容器条件   | 默认 fallback 和调用方原值保持，实际组件 CDP 对照通过     |
| Login、Workspace 搜索字号                                                | 复用 UiInput 原有 `--ui-control-font-size`，保留 14/16px 和 0.7rem             | 去除内部 input class 覆盖，不改断点                       |
| FileEditor spinner、QuickCommands 图标、ArtifactPicker 与 Workspace 空态 | 删除重复 13px、重复 currentColor!important，以及三条因 scoped 隔离不匹配的规则 | 动态 class、第三方生成 DOM 和必要媒体规则保留             |
| App、Agent、连接编辑/批量/列表、发送文件与进度弹窗                       | 删除 shared/capabilities；通过现有 feature public 获取原 Pinia/launcher owner  | 不新增状态、请求、缓存或资源；同步独立 targets 测试消费者 |
| AgentConfigPopover → UiPopover                                           | `panelMarkerAttribute` 接一个 data 属性名称，由 Agent 提供原标记               | 原 Portal DOM、焦点和 Escape 语义保持                     |

### 职责归属

| 关键职责                                   | 最终 owner / 证据                                                             | 结论                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 通用材料/控件/浮层/可访问性/确认/目录/设置 | `foundation/ui/styles/*` 与原组件                                             | 十类真实职责，不按文件行数机械拆分                          |
| 应用及业务样式装配                         | `app/styles/global.css`、shell/update-prompt；Feedback 和两个 feature styles  | Foundation 无上层 CSS import；通知定位选择器权重保持        |
| 控件可定制外观                             | UiEmptyState fallback、UiInput/Spinner 既有变量                               | 业务在实例根 class 赋值，无新万能组件                       |
| 认证、查询和更新权威                       | 原 feature Store/composable/remoteDesktopLauncher                             | reset 注册、KeepAlive、scope、晚返回与未知写入围栏保持      |
| 外部覆写与无效样式审核                     | 全前端 deep/UI 选择器盘点；ArtifactPicker 真实 SFC 编译 scope 与 CDP 属性核对 | 不将一次 Coverage 未命中或动态 class 静态无命中当作删除依据 |

### 类型归属

| 类型/契约                                           | 唯一 owner / 消费者                                             | 核对                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| ConnectionSummary、Tag/Proxy/SSH Key 与认证应用对象 | 原 feature model/public → 实际消费者                            | 不经 shared 重导出，不复制类型                                         |
| RuntimeFeatureCapabilities                          | 删除定义、注入与全部消费者；删除无消费者 terminal.loadView      | packages/tests 无旧入口残留；前后静态运行时 import 图均无循环          |
| UiPopover 面板标记                                  | UiPopover 的 `data-${string}` prop，AgentConfigPopover 唯一消费 | Foundation 不包含 Agent 专属属性名                                     |
| CSS 实例定制                                        | Foundation UiEmptyState 及既有 UiInput/Spinner 变量             | 31 条声明加原值 fallback；新增 display:block/margin-top:0 为原计算默认 |
| HTTP/WS、Shared、存储                               | 本轮未改变                                                      | 无数据库迁移、协议或权限变化                                           |

### 完成证据

| 项目                 | 源码/架构                                                                                 | 静态                                      | 浏览器/逻辑与限制                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS owner 迁移       | AST 保留 492 条规则/490 个 selector+at-rule 上下文、1863 条声明原样；同 selector 顺序一致 | 定向 PostCSS、Prettier 与 diff 检查通过   | 独立复核 231 组跨 selector 顺序候选，实际元素/权重无新增覆盖冲突                                                                                                 |
| 桌面/窄屏视觉        | 1440/390/320px × 深浅主题；六页面、真实空态组件、登录、连接表单、Toast、确认框            | 根 check 与前端生产 build 通过            | 原始基线 66 组计算样式一致；一个旋转 spinner 的瞬时 rect 有差异，样式未变。63 张截图逐像素一致，其余三张仅 5–36 像素差异，最大约 0.0019%，已结合相同计算样式复核 |
| 更新提示             | 使用真实 AppUpdatePrompt，通过原反应式状态显示                                            | CSS 声明与布局保留                        | 六组实际弹窗对比旧基础 CSS 与新样式计算值一致；旧 CSS 覆盖对照属于受控样式验证，不冒充重构前整页快照                                                             |
| 管理列表与连接表单   | 正式 runner，生产前端/真实后端/SSH 夹具                                                   | 正式构建通过                              | `e2e.log`：8 项通过，含深浅主题三宽管理配色、代理目录失败下表单可用、真实 SSH 测试并创建连接                                                                     |
| 能力与 Portal 消费者 | 原 feature public 与 Agent 面板标记                                                       | 最终构建产物                              | `consumer-e2e.log`：7 项通过，覆盖 Desktop/Pixel UA 的 Agent 目标选择与权限保持、四项批量编辑（含部分失败、目录失败、窄屏）及代理密码保留/替换/清除              |
| 全仓格式             | 全部新/修改 CSS、Vue、TS 与文档                                                           | `format-all.log` 与 `diff-check.log` 通过 | 无新增自定义源码文本门禁，无新测试依赖                                                                                                                           |

首轮浮层复测与正式测试构建并行，Shared dist 重建触发 Vite 热重载，导致白屏/计数不足及一次超时；原日志保留，未修改产品或放宽断言。稳定后 `after-stable-overlays.log` 与 `stable-overlay-comparison.json` 逐项对照通过。首次标为 update 的脚本未真正触发只读状态渲染，不计作更新提示验收，已用 `update-proof` 单独补验。`pixel-comparison.json`、`before/after/after-stable` 与 `update-proof/comparison.json` 是最终视觉证据。

USAGE 的目录、确认/Toast、登录、工作区及 Agent 操作说明已核对仍符合当前行为，本次纯内部重构不添加产品文案。未宣称全仓所有 CSS 都已证明无效或全部清理；保留确有用途的业务布局、动态 class、第三方 DOM 适配与无障碍规则。真实手机软键盘、自定义主题及完整远程 E2E 不由本轮桌面 CDP 视口模拟代替，后续范围仍由 PLAN 管理。

## 前端模块边界与活动视图复核（2026-11-06）

本轮基于 `main/378083190cba468ed69dad892c0810b33e9f2edd` 及原有未提交工作区，保留 OIDC、终端恢复、Agent 完整日志与前一轮样式重构。专用目录 `/home/honus/nexus-task-artifacts/frontend-modules-20261106` 保存开始时完整 diff、状态和 frontend/src archive。上一轮38个前端文件与66组证据复核未发现回归；本轮非 bug 不修改正常外观，不提交推送、部署或触碰生产数据。

### 功能对应

| 功能           | 变更与不变量                                                                                    | 验证                                                         |
| -------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 基础 UI        | 删除无消费者 Tooltip、ManagementCard、management 操作布局、Pagination density；现有分页外观保持 | 全消费者扫描、类型/构建                                      |
| 文件列宽       | 独立交互 owner；隐藏/断线/取消/失焦停止，不派发晚保存；原400/560断点和宽度保持                  | CDP前后、正式取消及恢复保存                                  |
| 文件预览       | 真实active贯通全部消费者与延迟focus；隐藏不拦Ctrl+F/Escape，保留缓存搜索                        | CDP、正式隐藏/重开/读取计数                                  |
| 文件编辑       | actions绑定修订、授权和视图；共享session各视图持独立关闭能力，晚确认不丢新草稿                  | 7组真实组件before/after、25项确认生命周期检查                |
| 窗口与手势     | resize取消不提交；远桌收敛到可见视口；外观失焦停止拖动；Workspace切会话取消5个resize            | CDP、真实双SSH会话正式回归；远桌正式组随新增贴边功能继续验收 |
| Agent/Provider | 按钮尺寸归组件变量；Provider展示卡片分离，父持API/草稿/弹窗；清理经证明死CSS                    | 128组按钮矩阵、18组sidebar、11组Provider边界和事件           |
| 导航           | App router认证后预加载Workspace，移除Connections反向Runtime依赖                                 | 全调用链及正式SSH连接导航                                    |

### 职责与类型归属

| 审核表     | 结论                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 职责       | App拥有导航；Workspace传真实active及取消本视图手势；columns/actions拥有交互；原session仍持读写/草稿；Provider子卡片仅展示/发事件        |
| 类型       | 编辑session/关闭能力唯一归file-editor/model；组件props/events在本功能；Foundation取消API不含业务；Shared、数据库和迁移无变化            |
| 资源与并发 | pointerup提交，取消仅释放；确认绑定原实例和修订，A失活不借B继续确认；无handler拒绝丢弃；隐藏预览不新读、不迟聚焦；已派发读写仍沿原owner |

### 完成证据

Node26.13.0/pnpm12.16.1 根 `pnpm run check`、`pnpm run format:all:check` 通过，正式runner已完成双端生产构建；`check.log`、`format.log`、`e2e.log`保留完整记录。正式Playwright本地隔离端口/独立数据根18项通过，覆盖Provider、外观自定义、文件各格式预览、隐藏缓存快捷键、列宽取消/恢复和真实双会话五个resize取消。它是仓库正式用例的本地执行，不冒称GitHub远程全量已通过。

指定CDP `172.30.30.11:9223` / `api.honus.top` 真实组件前后：列宽隐藏后body恢复且无提交、隐藏Markdown不再阻止Ctrl+F、远桌1440×900初始几何不变，390×400从y=-229/h858修复为y16/h368。三张正常截图逐像素一致，见`normal-comparison.json`。Provider11场景DOM/计算样式一致、5组PNG字节一致，复制/测试弹窗/删除确认及禁用事件均通过（没有真实模型调用）。Agent128组深浅/交叉容器矩阵共512个按钮快照一致，sidebar18组一致。`foundation/comparison.json`及`sidebar-comparison.json`保存结果。

`tests/frontend/workspace-session.integration.mjs` 原codec10、Workspace21+producer10、编辑/预览22、Registry17与新增25确认生命周期检查通过；这部分为真实Vue/受控端口专项，不代替真实远端写入故障。CDP编辑器7组保留4个旧确认缺陷及3组正常对照，见`editor/*final*`。根主代理及独立Sol复核发现的共享确认借用、Workspace五手势失活问题均已补齐再验。

首轮Agent快照受到容器未结算、主题过渡及鼠标残留:hover影响；原始失败保留，之后在同一挂载组件原位替换归档旧/新scoped CSS、等待布局并关闭过渡、移开鼠标，128组完全一致，不通过改产品外观或放宽断言消除差异。宽窄全页初扫在并行开发及CDP页面切换期间存在加载中空白采样，未据此宣称通过。停止并行修改后串行置前、等待真实main可见再采样，Dashboard/连接/代理/通知/设置/Workspace各1440、390、320px共18组通过，无横向溢出或pageerror，见page-scan-stable/results.json；这是当前隔离数据与主题下的覆盖，不代表所有自定义主题和数据组合。真实手机软键盘、系统输入法和自定义主题组合仍不由桌面CDP代替。隔离服务及证据按用户要求保留至通知删除。

## Windows 恢复入口与 Termix 绘制对照（2026-11-06）

本轮追加任务：RDP 最小化恢复按钮左右贴边半隐藏；排查 Windows 应用最小化时分块更新。所有文件归 `/home/honus/nexus-task-artifacts/frontend-modules-20261106/{rdp-edge,rdp-render,viewport-scrollbar}`，不提交推送或部署生产。

### 四表审核

| 审核表   | 结论与边界                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | RDP恢复按钮贴最近左右侧，hover/键盘/拖动显露、触摸可见半边恢复；VNC保留完整按钮。分块问题通过原方案和Termix真实引擎同Windows对照定位，未宣称完全消除 |
| 职责归属 | Modal只持锚点、dock、可见viewport；Foundation持pointer机制。渲染仍归现有adapter/SDK，Backend保持透明桥；未增加凑帧timer、改解码器或降画质            |
| 类型归属 | 仅Modal局部坐标/有限dock状态，无Shared、数据库、连接参数或迁移                                                                                       |
| 完成证据 | CDP/真实headless及正式E2E逐轮记录见下；真实协议和Windows截图另见rdp-render/stable-analysis.md，不能以受控窗口代替实机性能                            |

恢复按钮初次CDP覆盖左右25px、hover/keyboard50px、跨侧拖动后不误恢复、窄屏与可信touch；正式E2E进一步发现真实滚动条边界：root的clientWidth和visualViewport.width均390，但scrollbar-gutter:stable使根矩形只有382，旧按钮只有0.84交叉比例，RDP实际仅露17px。修复取根实际宽度/client范围与visualViewport交集，并观察根尺寸变化；有效范围不变不取消手势。复验RDP anchor x332、比例1、可见25px；VNC完整50px；不触发window resize而仅切gutter时仍自动更新，无sizeChange或pageerror。大视口原x184正常几何保持。

首次正式组前2项通过后在测试控制栏揭示竞态停住；trace证明小视口恢复后旧鼠标触发pointerleave，header刚可见又隐藏。用例在恢复视口前移开鼠标，保留全部功能断言。第二轮4项通过、2项按上述0.84真实越界失败；原日志、截图及trace保留，未以放宽可见比例换绿。最终轮重建前后端并执行同文件全部6项通过（含可信触屏tap），见rdp-e2e-final.log；未放宽ratio=1断言。与前端18项共24项正式本地用例通过。最后根check、全仓format:all:check、git diff --check通过，GitHub远程全量未触发。

### 实机绘制定位

使用用户此前授权的同一Windows目标，浏览器实际建立RDP。首次指定CDP浏览器本身就在目标Windows内，出现递归桌面；该记录仅用于确认位图编码，不作性能结论。正式对照改用本机Linux headless浏览器，Nexus/Termix请求32/Termix请求16顺序连接（避免同账户互踢），均1062×856。打开一份空白Notepad，最大化后每方案3次最小化/恢复，同一Chrome/code-server背景；核验15张截图操作均成功。结束关闭本次空白窗口，没有在Windows创建文件。

Termix对照为插件1.3.1、固定提交`1b7242358efb7b105b017e2f24ca2a451d8348c4`的真实EngineSession/EngineCore/RdpClient/Display和原预编译WASM，标准guacamole-common-js1.5.0及Termix同款同步flush补丁；不是完整Termix应用部署。隔离server仅绑定127.0.0.1动态端口，凭据从0600文件读入内存，不放URL或日志。主仓`6b060594`的此时默认方案为服务端Worker解码后PNG/JPEG+Guacamole sync，而不是默认guacd/FreeRDP或H.264。

三组实际收到的均为主要64×64的压缩16bpp位图，均无SurfaceCommands、RFX或frame markers；Termix请求32并未在此目标激活32bpp/RFX，不能据此修改Nexus默认值。Nexus三次最小化首次→最后位图收到为71→181、33→225、25→77ms，真实paint最后为180.3、224.5、76.4ms；每次native putImageData总耗时1.2、1.7、0.7ms，未观测到≥50ms长任务。第二次末尾仅2块65字节，主体早于该尾部完成。Termix两组也有2–3批桌面图像和渐进sync，不证明整次动画原子呈现。

详细三组表及恢复数据在`stable-analysis.json/md`；Termix最后sync是到达时刻，不等于最终paint，不能与Nexus原生paint作排名。Nexus经api.honus.top而Termix经loopback并在server Worker解码，两边捕获有开销、无随机交错、样本仅每组3次；这些证据支持分批在前端绘制前已存在，不区分Windows产帧与网络分批，也不证明所有分辨率/网络/GPU场景。

固定与当前上游Web SessionBuilder均无公开正常模式色深、完整帧回调或RDPGFX开关；legacyGraphics虽然请求32却同时禁codec，不是通用加速。上游FrameEnd PR #1189已关闭未合并，作者最终说明未达到预期，不能作为现成修复。当前没有证据支持修改应用渲染链；保留立即协议转发和原rAF提交，未加入会延迟输入与画面的猜测等待。完全消除该目标渐进更新仍依赖后续协商/SDK能力验证，不写成已修复。

本轮收口：原9998/3001隔离测试环境与全部证据保留；Termix对照服务和专用headless浏览器在连接关闭后按已记录PID核实归属并停止，未删除用户要求保留的文件，见rdp-render/process-cleanup.json。凭据文件保持0600；没有在生产数据库执行迁移、提交推送或发布。主代理与独立Sol最后复核实例关闭、五手势失活与可见viewport边界，未发现新问题。

## 前端最终缺口与 UI 复审（2026-11-06）

基于 `main/378083190cba468ed69dad892c0810b33e9f2edd` 及原未提交工作区，保留前序功能。本轮证据位于 `/home/honus/nexus-task-artifacts/frontend-final-audit-20261106`，`frontend-start.diff` 记录追加审核前的前端状态；测试环境为前端9998、`api.honus.top`、指定Windows Chrome156 CDP。非 bug 不改变正常UI，未提交推送、发布或部署。

### 功能对应

| 功能           | 实证问题与修复                                                                                                                      | 不变量                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 拖动与进度窗口 | 取消/失焦/隐藏/卸载原会调用onEnd；失活窗口仍显示并采样。基础拖动区分提交与取消，同步全部5个消费者，真实active控制Teleport及速度计时 | 正常pointerup和显式stop仍提交；取消保留内存位置但不保存；原传输继续     |
| 多文档快捷键   | 两个共享编辑器一次Alt+右原跳两个标签；Ctrl+F及加载态Escape可作用于另一预览。按通用文档根标记和当前焦点选择唯一实例                  | 保留单视图及无文档焦点的首个可用处理；不改原搜索、session和加载取消流程 |
| 基础下拉       | 矮屏时区panel原高329px、顶部y=-85px，首项在屏外不可选。消费Reka可用高度并扣除现有边框与padding                                      | 保留正常320px列表上限、密度及样式；首尾滚动可达                         |
| 传输目录同步   | 正式回归复现切页后复制完成，但原视图回调失效使列表一直旧；将完成后只读刷新绑定原存活会话，同步上传、移动及归档                      | 旧视图不再发提示或新写入，不重放传输                                    |
| 恢复按钮键盘   | 拖动取消或松手无click后首次Enter原被didDrag吞掉；仅抑制detail>0的指针click                                                          | Enter/空格首次恢复，迟到指针click仍不误触                               |
| 无效样式       | 删除 `.ui-select__value[data-placeholder]`：唯一真实span不设置该属性，第三方状态在trigger上                                         | 不将未命中的动态CSS当作无效规则；无正常视觉变化                         |

### 职责归属

| owner                 | 当前边界                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Foundation            | 只持指针手势、选择状态释放及基础下拉可用高度；取消不调用业务onEnd                                                    |
| Transfers / Workspace | 窗口实际active、位置持久化及速度采样归各窗口；Workspace装配宿主状态，不改变传输资源生命周期                          |
| shared/focus          | `ownsDocumentKeyboardEvent` 为纯DOM判断，只认识 `data-document-keyboard-scope`，无feature私有选择器、Store或全局监听 |
| 文件功能              | FileEditor、PreviewSearchBar、FilePreview加载态在自身监听里核对active/可见性/KeepAlive/defaultPrevented及文档归属    |

### 类型归属

新增取消能力沿原Foundation交互返回值；进度active沿feature受控props；焦点helper仅接HTMLElement/KeyboardEvent并返回boolean。三个文档组件显式声明通用根标记，所有5个拖动消费者同步取消调用。目录完成回调复核原session生命周期；注销/关闭同步释放browser与adapter，dispose/generation阻止晚读取回填，断线由原重连刷新补齐；独立只读复核未发现重复派发或把旧结果写入新会话的路径。没有Shared协议、数据库或迁移变更，无兼容桥和第二份业务状态。

### 完成证据

Node26.13.0/pnpm12.16.1：根 `pnpm run check`、`pnpm run format:all:check` 和 `git diff --check` 已通过，日志为 `check.log`、`format-check.log`。首轮正式生产构建通过，43项端到端42通过、1失败，见 `e2e.log`：新增进度生命周期用例的手势断言全部通过，但最终目录未显示已完成的复制。后端原任务3535d2d6-f8d0-4e43-a8f6-03c52c9ffe5f已记录MUTATION_COMPLETED；原页面permission在切会话/页后失效使刷新被跳过。已修源码并保留失败trace、截图与原断言。最终 `e2e-final.log`：双端生产构建和50项正式本地隔离E2E全部通过（3.7分钟），含原失败场景、新增上传/归档离页后无需手动刷新、RDP/VNC键盘恢复、进度取消/隐藏、系统矮屏下拉及文件编辑/预览。最新根检查与全仓格式分别为 `check-final.log`、`format-check-final.log`，均通过；`source-sha256.json` 记录本轮关键源码和测试指纹。此结果为正式仓库用例的本地执行，不代表GitHub远程全量。

- `gestures/before.json` → `after.json`：四种取消及卸载不再触发onEnd，晚move/up无效，正常松手/显式stop共2次提交。`consumers-after.json` 为真实Center/Display的20组位置、localStorage、active/KeepAlive/后台、采样计时和正常提交核对，pageerror为空；实组件测试不等同于真实手机后台。
- `gestures/keyboard-restore-before.json` → `keyboard-restore-after.json`：两owner×三种拖动结束方式共6组键盘首次激活修复；6组可信mouse/pen/touch正常恢复，无pageerror。真实键盘click同样是PointerEvent，但detail=0，不能按事件类猜测鼠标；正式RDP/VNC与进度用例同步覆盖。
- `keyboard/before.json` → `after.json`，`loading-before.log` → `integration-final.log`：13项实组件浏览器检查通过，覆盖共享/独立编辑器、active=false、已处理事件、事件target/activeElement、无焦点fallback、搜索与加载取消归属。对应仓库入口 `tests/frontend/document-keyboard.integration.mjs`；正式SSH用例同步补左右标签导航。
- `select/before-cases.json` → `after-cases.json`：3种density、fitLongest两态、4种视口/位置共24组，16组越界降至0组。390×400和320×240真实时区首尾均可点击；1440正常列表仍320px，截图0像素差，见 `verification.json`。

只读UI建议尚未实施：手机设置分类条隐藏滚动条，可增加边缘滚动提示；紧凑按钮可评估保持视觉尺寸的触控热区；被省略的长模型ID/连接名称可提供触屏可用的完整查看方式。源码依据分别为SettingsPage、AgentConfigPopover/PreviewSearchBar及ProviderCatalogCard/UiSelect，实测见 `select/optional-ui-measurements.json`。不据此改动当前已确认设计；完整GitHub回归及真实手机输入法仍不由本轮桌面视口测试代替。

## RDP 音画评估、工具栏与移动 UI（2026-11-06）

用户授权悬浮工具栏重排与前轮移动UI建议，并补充实测声音晚于画面及FreeRDP替换评估。本轮保留原未提交工作区，未提交推送、发布、部署或迁移数据库。全部证据归 `/home/honus/nexus-task-artifacts/rdp-audio-toolbar-ui-20261106`，工具链Node26.13.0/pnpm12.16.1。

### 四表审核

| 审核表   | 结论与边界                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 非全屏RDP尺寸→重连→文件剪贴板→全屏→最小化→关闭，真实DOM与Tab顺序一致；手机设置分类显示实际溢出方向，预览搜索两行且操作可达，长模型ID展开后可选择全文，配置按钮增高。正常桌面密度、VNC和全屏行为保留  |
| 职责归属 | 远桌Modal局部复用已有VueUse模板；设置Page持导航和实际scroll状态；控件调整归原feature；基础UiSearchInput仅在自有清除按钮开启时隐藏重复原生取消图标。音频保持现有Adapter/SDK，不增加猜测缓冲或自造协议 |
| 类型归属 | 原props及局部DOM/几何状态，无Shared或数据库契约修改；音频JS能力没有假增timestamp/播放反馈字段                                                                                                        |
| 完成证据 | 最终双端生产构建、32项正式本地E2E、根check、全仓格式及diff检查通过；CDP三语/深浅/宽窄与触控交互如下。实际物理音画同步未修复，FreeRDP只有文档/源码评估                                                |

### 浏览器与正式回归

Windows Chrome156通过指定CDP、独立page访问api.honus.top/9998，页面完成后关闭。`toolbar/after.json`覆盖7组RDP/VNC宽窄mouse/touch，VNC三组几何与before一致，无pageerror；截图使用受控失败连接，仅证明布局，不代替连接成功。正式RDP用例实际连接隔离目标，验证11个Tab停靠点（含数字步进按钮）、320/390可达性、剪贴板、全屏、重连音频释放和VNC回归。

`settings/final/results.json`含三语×深浅×320/390/1440共18组，无pageerror；`desktop-comparison-final.json`六张桌面图0像素变化。`controls/assertions.json`、`interactions.json`与`search-clear.json`覆盖真实深浅主题320/390/1440及三种coarse触控组合，搜索上一/下一、清除保留面板、关闭面板、编辑/刷新原owner、长模型ID完整选择和无横向溢出。预览搜索操作为44×44，Agent配置仅增高到44px、保持原横向紧凑宽度，不宣称全部按钮44×44；前期主题注入有误的图片不作为最终主题证据，使用baseline/final组。

首轮`e2e.log`为30通过、2失败，首次trace/截图保留：新增Provider用例只登录了独立request，浏览器仍在登录页，已为page.request补登录；设置页新增箭头留白叠加原8px间距，Linux字体下320px英文Data Management分类略宽于滚动区。去掉重复间距，箭头使用原空隙；保留原完整可见断言，不以省略文字换绿。最终`e2e-final.log`重新构建双端，5个spec共32项全部通过（1.7分钟）；`check-final.log`根检查、`format-check-final.log`全仓格式及`git diff --check`通过。GitHub远程全量未触发，真实手机键盘与物理设备仍另验。

### 音频与FreeRDP评估边界

用户确认声音偏晚。当前Web扩展丢弃RDPSND timestamp且没有播放延迟回传；底层收到wave即确认，图形也没有共同呈现时间戳。历史2026-11-05 Windows授权测试每声道8192采样、44.1kHz，即185.760ms声音块，应用排程ahead最多35.410ms；当时base/output latency为42.667/128ms。这些不是本次用户物理音画差，也不能简单相加作为端到端延迟。新静音CDP探测仅核对浏览器API，不能证明强制采样率或numeric latency更快。报告及固定源码见`audio/assessment.md`、`provenance.json`；未修改音频产品代码、SDK或Windows策略。

FreeRDP是原生库，不能直接替换当前浏览器WASM。可复用方案为guacd/FreeRDP服务端解码、Guacamole协议及guacamole-common-js前端，需适配已有鉴权/撤权、证书人工确认和指纹、目标与代理、尺寸/输入/音频/文件以及进程生命周期。Guacamole1.6.0官方文档公开GFX和RemoteApp等能力，但是否改善视频、分块和服务器负载仍需同目标实测；文件驱动器重定向不冒充当前文件剪贴板。

关键源码区别：FreeRDP原生RDPSND有设备播放时延反馈，而固定Guacamole1.6.0的`rdpsnd.c`安装自己的通道，`rdpsnd-messages.c`写入/flush浏览器音频后用原timestamp确认，不直接继承原生反馈优势。不能声称换guacd就解决声音晚。对比源码、官方页面和仓库活动元数据存于`audio/freerdp-comparison/assessment.md`及同目录。此前Termix对照使用IronRDP插件，不是FreeRDP性能测试。没有新依赖、引擎切换或性能提升倍数结论。

## 设置布局与加载优化（2026-11-06）

本轮按用户授权审核八个设置分类与Agent子分类的布局和加载，保留已有未提交功能，不提交推送、部署或修改数据库。证据归 `/home/honus/nexus-task-artifacts/settings-optimization-20261106`；`start.diff`保存追加前的工作区状态，Node26.13.0/pnpm12.16.1。

### 四表审核

| 审核表   | 实现与边界                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 功能对应 | 路由入口只登记实际分类，不先挂载隐藏工作区；诊断/恢复首次展开才挂载，收起撤销active、再开读取。分组标题按内容宽度与操作组换行，短标题仍同排，不再挤成窄列                |
| 职责归属 | SettingsPage持visited和维护展开；Security只装配安全功能，IP面板独立；各feature public提供原面板loader；Agent按分类拆异步入口；通用标题/动作排版归Foundation settings.css |
| 类型归属 | 仅原组件props/events及局部布尔状态，安全面板移除混合section分支并同步唯一消费者；无Shared/协议/数据库迁移、额外缓存或依赖                                                |
| 完成证据 | 根check、全仓格式、生产构建、diff检查通过；正式本地27个唯一场景覆盖通过，首次失败和精确补跑如下；CDP布局、请求和构建块大小分别记录，不冒称实机加载提速倍数               |

### 性能与布局证据

指定Windows Chrome156 CDP通过独立页面访问api.honus.top/9998，结束关闭自建页面；语言与主题只改页面内存，不保存用户设置。`before/results.json`→`final/results.json`覆盖8分类及3个Agent子分类×320/390/1440共33组；`locales/results.json`再覆盖8分类×中文/日文×深浅主题×3宽度共96组。最终无pageerror或控件横向越界；中文短标题仍保持同排，英文长标题与动作按内容换行。320px英文TOTP标题原只剩12px，标题栏颜色原55px，完整可读性由正式用例同时核对最多两行、文字不溢出和动作不重叠。未改变配色、实际设置或保存流程。

`request-comparison.json`记录同环境冷页面API请求数量：关于19→14、外观19→14、系统24→19、安全22→17、IP控制21→16、Agent24→19、数据21→14；工作区自身仍19次。省掉隐藏工作区的一次配置和完整presentation四端点查询，数据额外省去折叠诊断与突变目录查询。全局认证、主题和Agent宿主请求继续正常执行。数字是已记录开发环境请求计数，不是物理弱网或总体延迟测量。

`bundle-before.json`→`bundle-after.json`记录生产构建未压缩单块大小：SettingsPage40302→20718字节，AgentSettingsPanel221341→91426字节；安全、IP、备份、诊断/恢复及Agent扩展、浏览器运行时、安全网络、集成/市场/预算改为独立按需加载。整体代码仍存在，不能把入口单块变化写成整个页面传输或加载时间同比减少。现有已访问表单实例、完整presentation读取、CAS与未知写入围栏保留，没有通过使用过期快照减少请求。

### 回归与收口

新增`settings-loading.spec.ts`验证直接入口无隐藏工作区/配置查询、维护区首开/收起/重开、系统和工作区独立草稿在分类间保留且不写入、安全/外观标题及动作宽窄可达。首轮`e2e.log`双端构建通过，27项中26通过、1失败；新用例打开维护区后用宽泛summary定位关闭，误匹配内部两个折叠项。只将定位改为外层直接summary，保留请求、重开和布局断言；原trace/截图保留。`e2e-final.log`重新构建后该spec3项全部通过，覆盖共27个唯一场景；其余组包括备份实际导入导出、CAPTCHA、IP白黑名单、OIDC登录/配置/撤销、偏好保存和真实读取失败、Agent预算/硬限制/ACP与插件诊断。

`check.log`、`format-check.log`及最终文档/测试定向检查通过。首次CDP全分类脚本在appearance可见性等待超时，原日志保留于before.log；独立probe无页面错误且显示正确，重跑完整before和两轮after均完成，未据此推测或修改产品失败逻辑。截图和API探针不替代真机输入法、真实弱网或GitHub全量；本轮未触发远程CI。规则、USAGE、架构与PLAN已同步，测试环境和产物保留至用户通知清理。

## IronRDP 应用排队与隐藏绘制优化（2026-11-06）

用户决定保留IronRDP、不采用guacd。本轮基于main `378083190cba468ed69dad892c0810b33e9f2edd` 的既有未提交工作区追加两项优化，未提交推送、发布、部署或改数据库。证据归 `/home/honus/nexus-task-artifacts/ironrdp-optimization-20261106`，含修改前`start.diff`、Adapter备份及首次失败产物；工具链Node26.13.0/pnpm12.16.1。

### 四表审核

| 审核表   | 结论与边界                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 隐藏/最小化/未挂载Canvas保留最新像素但免提交，恢复时一次显示积累变化；音频不再按设备输出延迟额外保留应用积压，正常连续排程、RDPSND尾音与暂停丢弃保留 |
| 职责归属 | 可见性观察、rAF及底图归rdp-frame-presenter；PCM实时排队归rdp-audio-output；仍复用原SDK、Web Audio和Canvas，没有协议实现、新依赖或服务端进程          |
| 类型归属 | Adapter内部布尔状态及原PCM回调契约；无Shared/API/数据库变化。测试专用入口与RDPSND交付替身仅由E2E构建引入，不在产品提供测试钩子                       |
| 完成证据 | 双端生产构建、14项本地正式E2E、指定Windows CDP三项受控检查、根check与最终格式/diff检查通过。没有物理音画差、CPU/GPU百分比或端到端性能倍数结论        |

### 对照与回归

`baseline.log`在产品修改前运行新增两项检查，两项均按预期失败：隐藏画布收到12批像素仍有12次native putImageData；受控AudioContext时钟下，以历史Windows实际8192采样/44.1kHz块及42.667/128ms设备延迟构造三块突发，第三块被排在350.519ms之后。此为可重复的应用排队问题，不是用户设备声音晚的端到端测量。

修改后`e2e.log`重新构建双端与测试客户端，14项全部通过（32.1秒）。其中新增3项验证隐藏期间0次提交、恢复1次、最终像素与源内存复用、同值尺寸重置、页面可见性、关闭晚回调、初始未挂载与直接绘制/分配失败回退顺序；音频使用真实Web Audio Buffer/Source、受控时钟及RDPSND交付替身，正常35.410ms提前排程连续、close不截尾、暂停忽略PCM、积压时停止两块旧声音并立即安排最新块、关闭不接受晚到块。其余11项使用真实xrdp/TigerVNC及后端，覆盖证书信任/撤销/取消、票据归属/期限、连接/剪贴板、尺寸/DPI/全屏、手机恢复、VNC与重连音频释放。

最后源码复核补充IntersectionObserver阈值边界：threshold=0在画布刚碰到视口时可以报告isIntersecting=true、面积0，继续移入时不一定再次通知。因此直接消费isIntersecting，不额外按正面积过滤。`e2e-final.log`补充边缘用例时2项通过、1项失败：测试以innerWidth定位边缘，实际IntersectionObserver视口因稳定滚动条留白比innerWidth窄8px，所谓移入后仍处于可视区域外。`edge-probe.log`保存真实rootBounds与坐标；用例改为读取浏览器报告的rootBounds.right，保持像素断言。`e2e-edge.log`重新构建并验证三项通过，最终CDP也使用该版本。

`cdp-results.json`通过指定 `172.30.30.11:9223` 的Windows Chrome，在 `api.honus.top` 同源自建页面复用上述三个受控场景，全部通过、无pageerror。测试模块由page级路由提供，不改服务器文件、用户页或设置；完成后关闭自建页。这与真实xrdp连接证据分开，不冒充本轮真实Windows播放或物理声音测量。

`check.log`根检查通过；首次`format.log`发现新增测试声明间距8处，自动格式修正后`format-final.log`通过。未更改正常UI、150ms动态尺寸防抖、鼠标输入调度、初始化/证书准入或上游SDK。冷启动预加载只有串行路径观察，没有可归因的性能对照，本轮不引入额外准备入口。超32MiB底图及不支持路径仍直接绘制，不宣称这些情况也停止隐藏提交；协议处理与解码继续，不能把减少Canvas提交视为消除全部后台开销。真实网络波动可能更早丢弃旧音频，符合用户授权的实时优先；上游分块、时间戳缺失、音频设备延迟及渐进绘制仍按PLAN能力边界推进。

## 本轮功能提交与远程 E2E 修复（2026-11-06）

本轮提交并推送 `9853e87d96e5f75467527490b18950cae1441cb0`，包括 OIDC/Passkey、Agent 完整日志、前端 CSS/模块重构、设置加载、IronRDP 和终端恢复/连接选择修复。该提交前根 check、全仓格式及 diff 检查通过；此前本地专项分别见本页对应记录。统一交付证据归 `/home/honus/nexus-task-artifacts/remote-e2e-delivery-20261106`，保留至用户通知清理。本轮仅提交、推送与 E2E，不发布镜像或更新生产主机。

### 首轮失败与修复

[首轮 42218925378](https://github.com/0honus0/nexus-terminal/actions/runs/42218925378) 在上述 SHA 完整运行，质量、双端构建、Docker smoke 和七个浏览器分片全部成功；后端有三项失败且重试仍失败，整轮为 failure。原作业日志和完整诊断包分别留在 `first-backend.log` 与 `first-backend-artifact/`，不以局部重跑掩盖首次失败。

| 审核表   | 结论与边界                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 只同步测试夹具，保留实际文件交付、UTF-8 分页、迁移回滚/重启和资源关闭断言；USAGE 原说明仍符合产品，无 UI 或产品行为改变                       |
| 职责归属 | 迁移链与 SQL 仍归原 Bootstrap/Adapter；测试恢复真实旧表结构，产品不增加重复 CREATE 兼容；资源 mock 实现真实 Job 读取能力                      |
| 类型归属 | SQLite 正式版本断言补充 v4；资源替身新增 waitingOutputCount 并验证 0→1→0 的等待状态投影；无 Shared/业务类型变化                               |
| 完成证据 | 本地正式 Playwright 动态端口入口的三个原失败场景全部通过，日志 `local-three.log`；修复提交 cd0c10f3 的最终远程 678 项一次通过，见下方整轮核对 |

具体根因：存储用例仍预期 `[1,2,3]`，未同步新增 v4；文件用例删除 v2 之后的迁移记录但保留 v4 的 OIDC 三表，导致启动重执行 DDL；资源用例的 Job mock 缺少 waitingOutputCount，读取会话状态时抛 TypeError。修复后用实际 v1 表结构重新执行连续迁移，保留旧内容转换及第二次启动不变的断言；存储测试仍覆盖有序安装、失败事务回滚和恢复。

本地命令为 `NEXUS_E2E_SUITE=backend node scripts/e2e/run-remote.mjs -- --project=agent specs/agent/execution-flow.spec.ts --grep 'file batches|ordered SQLite migrations|resource expiration'`，隔离数据及 TMPDIR 位于本轮任务目录，重新构建 Shared/Backend 后 3 项全部一次通过（19.3 秒）。实际 Node 子场景覆盖文件 11 项、资源 5 项与完整存储脚本，不将子项重复累计为正式唯一 E2E 数量。

### 最终整轮核对与交付

修复提交 `cd0c10f39acb8269226c40bacfd6c7948948df15` 已推送 main；其提交前根 `pnpm run check`、`pnpm run format:all:check` 和 diff 检查通过，日志为 `fix-check.log`、`fix-format.log`。本地正式入口同时重新构建 Shared/Backend；原首轮远程质量作业已完成双端生产构建，本次完整远程也重新构建双端，不复用首轮失败的测试结果。

[最终 E2E 42220871118](https://github.com/0honus0/nexus-terminal/actions/runs/42220871118) 在该修复 SHA 全部成功：质量、runner、Docker smoke、后端和七个浏览器分片及耗时更新均 success，文档截图按条件跳过。`final-run.log` 经正式 Reporter 逐条统计为 678 条记录、678 个唯一场景、全部 passed，无失败、重试、flaky 或场景跳过；其中 Backend 166，Browser 1–7 为 58/58/59/82/72/92/91。三个原失败场景均首次通过；首轮 failure 保留，不用最终成功改写原始结果。

工作流自动推送 `c6bee350`，仅更新 `scripts/e2e/duration-estimates.json`，已审核并快进同步。本轮最终只同步验收基线与实施计划，不改变已验证源码；当前 OIDC 迁移 v4 已被正式迁移及重启场景覆盖。真实 Pocket ID、手机输入法、运营商弱网、介质故障和物理音画性能仍按 PLAN 单列，不由受控 E2E 代替。未发布镜像、未更新生产主机，测试证据与环境继续保留至用户通知。

## Main amd64 dev 发布（2026-11-06）

用户在完整远程 E2E 通过后授权发布 main dev。核对 main 为 `024d608ac2de29d3991a0005e9215156ce52f646`，与被测 `cd0c10f3` 之间仅有验收文档和测试耗时更新；工作区干净，沿用 amd64 架构。通过现有 `publish-ghcr.yml`，以 main、channel=dev、architecture=amd 触发 [42222715508](https://github.com/0honus0/nexus-terminal/actions/runs/42222715508)，准备、生产依赖审计和镜像构建推送全部 success。

| 审核表   | 结果                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| 功能对应 | 发布已通过 678 项完整 E2E 的应用代码；不改变产品或 UI，不更新生产主机                                        |
| 职责归属 | 现有发布 workflow 构建并推送 GHCR；本地仅读取 manifest/config 核对结果，不拉取完整镜像                       |
| 类型归属 | 无代码或协议变化；镜像含原有 OIDC v4 连续迁移，由实例升级启动时自动执行                                      |
| 完成证据 | 工作流 success，dev 与源码标签摘要相同，OCI revision 和 linux/amd64 平台均匹配；日志和元数据位于下述任务目录 |

`ghcr.io/0honus0/nexus-terminal:dev` 与 `ghcr.io/0honus0/nexus-terminal:sha-024d608ac2de` 的 OCI index digest 均为 `sha256:aa9166d34b872f62477d5ee9c85c8e28727940da75eeeed5fc2dd1116b4d98c6`；amd64 平台 manifest 为 `sha256:2a09c505e9823305ff495554f07bb268c9becf12c6f6b521d55a9457c97a645d`。实际 config 的 revision 为完整源码 SHA，version 为 `sha-024d608ac2de`，OS/architecture 为 linux/amd64；证明 manifest 的 unknown/unknown 不代表另一个执行平台。

证据归 `/home/honus/nexus-task-artifacts/main-dev-publish-20261106`，包括源码差异清单、完整工作流日志、最终状态、两个标签 manifest 与实际 config；保留至用户通知。发布后只更新本节、当前验收入口和迁移链摘要，格式与 diff 检查后提交，不将后续文档 SHA 误写为镜像来源；未创建 Release、未变更 latest、未更新远程容器或数据库。

## RDP 平板与手机工具栏（2026-11-06）

本地 `390cfdb5` 上的未提交工作区专项，Agent 中间迁移仍暂停。使用 Node 26.13.0、pnpm 12.16.1、指定 Windows Chrome CDP `172.30.30.11:9223`，访问 `api.honus.top`，前端9998直接加载当前源码，复用隔离3002 Backend及已授权的真实 Windows RDP 目标。产物集中 `/home/honus/nexus-task-artifacts/rdp-toolbar-touch-20261106`，凭据不写入证据。

- 原因：820px桌面UA触屏下工具栏高约139.75px，长触控说明和flex-wrap共同挤成多行；恢复按钮的任意pointermove被标记为拖动，实际1px偏移吞掉恢复click。拖动后还观察到浏览器只派发pointerup而缺少合成click。
- 修复：实际窗口宽度决定单行/紧凑呈现，尺寸和触控复用UiPopover，状态和文件入口紧凑显示；完成的touch/pen轻点直接恢复，12px容差与现有长按一致，真正拖动与取消不恢复。尺寸change时才应用完整值，避免逐字编辑触发布局切换后丢失焦点。
- `review-final2.log` / `review-results.json`：真实RDP、820/390/320px各自48px单行、零溢出；尺寸/触控/文件面板可用，直触与触控板切换，1/4px触摸偏移、真实拖动到另一侧不误恢复、下一次轻点恢复通过。后续尺寸提交调整另由桌面专项验收。
- `desktop-review.log` / `desktop-results.json`：1440px真实桌面连接，紧凑尺寸输入1064与宽窗口逐字输入1200均保留焦点，提交后应用；原11项Tab顺序、鼠标拖动/恢复和原生浏览器全屏进出通过。
- 用户要求加快交付后，停止重复截图及额外多语言/主题矩阵复跑；`review-acceptance.log`只记录该轮已完成的820px，不作为全矩阵通过。已有完整三宽度专项与最终尺寸提交专项分别保留，不清除失败及中止证据。
- `eslint-final.log`、`e2e-list.log`：受影响源码与正式用例ESLint通过；Playwright发现6项RDP/VNC用例，新覆盖保持真实输入及原连接/全屏功能断言。`git diff --check`通过。
- `frontend-build-final.log`：前端构建在vue-tsc阶段被Agent的PluginRepositorySettings与plugin-market-rules共4处manifest字段缺口阻断；本轮RDP/基础手势无类型错误。未修补暂停的Agent代码，未运行正式全量构建/E2E，不沿用历史PASS。

限定浏览器证据不代替真机iPad/Android、VNC真实传输与Workspace真实文件任务回归；后续入口保留在PLAN。源码仅涉及前端，无数据库迁移；测试资源保留至用户通知，本轮未提交推送发布。

## 文件预览底栏（2026-11-06）

在现有未提交工作区修复FilePreviewDialog强制窄屏换行及搜索/编辑/刷新分别覆盖宽高的问题，PreviewToolbarButton统一基础按钮尺寸；保留原搜索、刷新和编辑事件，不涉及数据库。

指定CDP访问api.honus.top的本地9998源码环境，挂载真实MarkdownPreview与真实预览session，输入来自内存Markdown夹具，未读取或修改远端文件。320/390/820px容器回归全部通过：三个按钮分别统一44/44/32px、路径与按钮垂直居中同排、底栏零横向溢出；搜索命中2条、关闭恢复底栏，3次编辑事件与3次刷新读取均收到。样例长路径的可见宽度分别约94/164/559px，完整路径保留title。结果位于`/home/honus/nexus-task-artifacts/file-preview-footer-20261106/{review-final.log,results.json}`，首次脚本定位错误保留原日志。

定向ESLint、Prettier和diff检查通过；前端vue-tsc仍被此前Agent中间迁移字段缺口阻断，不称全仓通过或正式E2E通过。未运行远端文件传输/持久化回归；产物保留至用户要求清理，未提交推送发布。

## 非 Agent 重构修复独立提交（2026-11-06）

从 main/390cfdb5 的混合工作区拆分；独立 worktree 位于 `/home/honus/nexus-task-artifacts/non-agent-fixes-20261106/worktree`。原工作区 Agent 插件架构和 SDK 中间变更继续保留，不进入本批。`scope-audit.json` 逐文件记录取舍，包含已跟踪与新增文件；不单按 Agent 路径过滤，索引、Provider 轻量准入及状态一致性查询属于原性能任务。

| 审核表   | 结果                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| 功能对应 | RDP 单行工具栏/触屏恢复、预览路径与等大按钮、语言按需加载、文件拖动和进度位置职责整理、历史保留、审计通知与诊断 |
| 职责归属 | UI 延续原 owner；构建聚合语言；数据库事务/索引留 Adapter，统计留 Platform；插件新执行架构和 SDK 不带入          |
| 类型归属 | 诊断唯一 Shared Zod Mini schema 与前后端消费者同步，字段与单位严格校验；原 Run WS 协议不变                      |
| 完成证据 | 本地构建/静态/格式检查通过；正式浏览器入口 8 项、数据库专项 12 项通过；当前提交远程整轮仍待验                   |

Node 26.13.0/pnpm 12.16.1；`build.log` 与 `browser.log` 包含 Shared、Backend、Frontend 和测试客户端生产构建，`check.log` 为根 check，`format.log` 为 format:all:check。正式动态隔离端口入口覆盖语言按需/并发切换、RDP 设置/剪贴板/全屏/缩放/触屏轻点和拖动恢复、VNC 恢复、窄屏真实文件预览底栏/搜索/编辑/刷新，8 项一次通过。`targeted-storage.log` 为 performance、phase2、oidc 三份脚本共12项：迁移4→10、重复启动、索引计划、通知回滚/恢复、组合事务拒绝与迟到参与、历史保留、诊断路由/严格解码及 Provider 版本校验全部通过。

额外运行全部 storage 脚本的 `storage-tests.log` 为124项、78通过/46失败，未视为本批验收通过：integration-races 的旧表与清理替身、public-boundary 缺少已有 lastConnectedAt 字段、snapshot-crash 的根目录注册夹具不匹配，以及本机命名空间内执行 Node 被拒绝。保留原始失败，不跳过或改成成功；适用逻辑使用上述专项及后续正式完整远程 E2E 核对。实机 iPad/Android、物理音画与介质性能仍不由受控回归代替。无镜像发布或生产部署。

## 非 Agent 修复远程失败收敛（2026-11-06）

首次完整远程 [42303771316](https://github.com/0honus0/nexus-terminal/actions/runs/42303771316) 对应 f3ef8671：质量、runner及Browser1/5/6/7通过，Browser2/3/4、Backend与Docker smoke失败，未作为通过证据。原日志保留在non-agent-fixes-20261106。

根因与修复：手机RDP仍定位旧常驻模式按钮，改从Touch弹层进入并保留持久化/不重连断言；Markdown预览沿旧28px断言，更新为本轮已确认44px等宽高；异步语言启动可能错过window.load，PWA同时处理已加载文档，原场景延迟语言包到load之后覆盖竞态；v1数据迁移夹具只删除版本记录未删除后增结构，补齐5–10还原；Docker生产类型检查的音频测试入口跨目录引用未复制的测试源码，测试adapter移到frontend/build，仍仅E2E配置打包。

本地 `e2e-fix-browser.log` 的正式动态隔离入口3项一次通过，包含异步load竞态、手机Markdown真实编辑/SFTP保存和RDP模式/重连；`e2e-fix-backend.log` 的文件专项12项通过，无skip；`e2e-fix-check.log` 根check通过。构建包含双端与E2E客户端；未在本地重新构建Docker镜像，待远程smoke核对。后续完整远程仍待验，不修改产品布局或跳过失败功能。

最终远程 [42306606716](https://github.com/0honus0/nexus-terminal/actions/runs/42306606716) 对应 `379af20af947196f8f92d1c4cd346187c10d18d5`，完整680项一次通过：Backend167，Browser1–7分别47/52/90/81/66/92/85。质量与Docker smoke成功，耗时更新成功，截图任务按条件跳过；Reporter无场景skip、retry、flaky或失败。`final-*.log`及`e2e-reporter-audit.json`保存原日志和逐项去重统计。后继`9fd223a3`仅为自动耗时更新。原工作区已三方同步11个修复路径、保留661个其它修改/未跟踪路径；Agent文件专项已使用独立legacy adapter夹具，保留其新实现，没有恢复本轮已修旧式schema回退。

## 非 Agent main amd64 dev 发布（2026-11-06）

[发布42307601610](https://github.com/0honus0/nexus-terminal/actions/runs/42307601610)成功，来源`9fd223a38c675c5fb4097e649b7edda00895158d`，与完整680项E2E的379af20a仅差耗时估算。`ghcr.io/0honus0/nexus-terminal:dev`与`sha-9fd223a38c67`均为`sha256:8eca2327e9d597875ef3525c780b85a9a738e086e782d1a048bc5c7514dd271f`；linux/amd64平台manifest为`sha256:d6596123615d4a531026395bf76e260420050200e7bc2a62e0ae5752819cdaa8`。OCI revision与来源匹配，生产依赖审计无已知漏洞。证据在non-agent-fixes-20261106/publication；只读manifest/config，未拉取完整镜像、未更新远程生产服务。Agent重构继续本地推进，本镜像不含中间源码。

## iPhone Chrome 终端空格输入（2026-11-07）

用户报告苹果手机Chrome普通空格无法输入，未补充其它输入框位置。实际排查TerminalView→xterm→onData→原TerminalChannel，应用没有trim或空格快捷键拦截；xterm6.0.0的229按键计时器可能早于textarea变更，而原input处理又跳过同一按键周期的composed事件。参考上游[问题5835](https://github.com/xtermjs/xterm.js/issues/5835)、[PR5836](https://github.com/xtermjs/xterm.js/pull/5836)和[问题6078](https://github.com/xtermjs/xterm.js/issues/6078)；5836检索时仍未合并，不宣称正式上游已修复。

既有依赖补丁保留原渲染修复，新增229周期共用基线：input/keyup/原计时器互相去重，按完整码点交付变化后缀及对应退格，compositionstart/普通按键清理旧周期；失焦、禁用输入和销毁终端同时清除基线及计时器。内部接口、源码与ESM/UMD产物同步，pnpm锁文件固定新补丁哈希。TerminalView和UI未改，无数据库变更。

证据归`/home/honus/nexus-task-artifacts/ios-terminal-space-20261107`，Node26.13.0/pnpm12.16.1，main/9fd223a3混合工作区；Agent重构内容保留，未提交推送发布。

- 指定CDP`172.30.30.11:9223`、`https://api.honus.top`测试环境，Windows Chrome156。`baseline.json`记录timer先于input的空格漏发，`fixed.json`与`umd.json`记录修复后两种产物均只发送一个空格。
- `component-regression-final.log`和JSON：直接执行正式terminal-lifecycle源码中8项新增场景，以Vite模块加载真实TerminalView，包含四种事件顺序下各三个连续空格、中文标点/emoji后缀替换与删除、中文composition/无keydown emoji/非composed事件/真实桌面键盘去重、离开终端后的迟到输入、失焦/禁用输入后再返回的旧基线清理。全部通过，无pageerror；该定向CDP运行未启动正式E2E后端夹具，不称正式整轮E2E或iPhone真机验收。
- `check.log`根check、`build-frontend.log`前端生产构建、`test-lint.log`专项ESLint通过。`install-frozen.log`离线冻结安装通过，`patch-verification.json`核对全部9份修改后的依赖文件与候选逐字节一致；格式和diff检查通过。

手机真机输入法、其它普通输入框、正式远程E2E与发布仍未验证；桌面CDP事件回放不能代替iPhone物理键盘/输入法组合。测试现场保留至用户通知清理。

## Agent SDK4 最终收尾回归（2026-11-07）

本轮基于独立插件仓 `0bf6cbb019a98cfecff9d194c5d4fa2dc1325c80`，Agent 2.0.1 与其余七包的正式 Actions 签名产物验证。插件 [Validate 42388106829](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42388106829) 与 [Agent 签包 42388935062](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42388935062) 成功；发布仍待完整本体验收，不把 draft 当作市场已更新。App 的16项单测及八包行为测试已通过，签名包逐文件hash、Ed25519与原始tar摘要均已核对。

本地 Node26.13.0 / pnpm12.16.1、短TMPDIR隔离回归，证据集中于 `final-implementation/delivery-20261107`：

- `backend-owner-settlement-final.log`：44项通过，包含三种真实SQLite提交确认丢失和原receipt/执行围栏保留。
- `owners-backup-final-fourth.log`：54项全部通过，无skip/cancel，覆盖真实SSH传输故障、后台Job、未受信主机、旧目标批准、权限监控排空、跨实例备份/真实秘密与插件原包恢复、multipart大文件拒绝。
- `owners-backup-browser-final-third.log`中的真实签名sandbox/MessagePort/WS组：14个子场景全部通过，含33个请求、9个独立订阅、晚事件与consumer关闭；该组合其它失败已在上述第四轮修复，不能将第三轮整组称通过。
- `browser-acp-denied-final.log`：真实浏览器拒绝ACP内层权限后，精确响应交付、远端进程退出及无越权写入通过。

本轮修复订阅回调误继承HTTP临时SQLite准入、提交确认丢失后Run永远running、协议关闭覆盖在途权限核对故障、旧目标批准仍可同意，以及快照表列顺序遗漏。普通HTTP拒绝在大上传尚未完成时采用正常写端关闭，避免提前reset吞掉安全拒绝响应。通用Operation和真实Job/资源围栏替代旧工具表断言，不恢复旧运行协议。

首次全目录Node探测889项包含173失败与8取消，并非通过；其中构建并发污染、专用环境依赖和旧夹具问题分别保留日志，后续仅在冻结dist后执行定向回归。正式远程矩阵、指定CDP最终验收和镜像发布在本节后续补齐，不继承旧680项基线。
