# 前端架构

本文按 [模块模板](MODULE_TEMPLATE.md) 维护功能、运行时与界面的职责，开发前读取 [AGENTS](../AGENTS.md)、[人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 及 [编码规范](../rules/CODE_STYLE.md)。产品行为以 [USAGE](../USAGE.md) 为准。

## 1. 职责与范围

Frontend 展示产品状态并驱动用例，服务端事实不在浏览器重建为另一份权威。当前正式 API 仍使用旧 Protocol；`/__targets-next` 与 `/__agent-next` 是独立新后端开发入口。Agent 状态 API 已有 `features/agent/next` 源码消费者，正式旧 Agent 不切换；真实浏览器行为仍独立验收。

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

新后端开发能力在 `features/targets-next`、`runtimes/remote-next`；Agent 状态消费归 `features/agent/next` 的 api/model/views/i18n，DEV 路由为 `/__agent-next`。共用的新 Access client 归 Auth next，通过 Auth public 安装到 Targets/Agent，不跨功能深层引用。现有业务按真实 owner 扩展。i18n 使用所属功能目录，应用入口聚合，不把翻译或 UI 草稿放入 workspace Shared。

B5.2 只读步骤审计在原隔离 `features/agent/next` API/Controller/DEV view 增加 `GET /steps/1` 与 `/steps/1/events` 消费：传输只使用 Shared 严格 path/query/response codec，响应仍受 32 KiB 上限，Controller 将 wire 逐字段转换为独立应用 step/event 状态，保有按 Run 隔离的元数据和游标。transport 核对响应与请求的 App/Thread/Run 关联及分页界限，按具名失败类/code 判断错误，不比较异常正文。登录状态失效、切换 Run 或中止异步请求时不显示旧步骤；没有实际步骤（404）显示“无步骤”，不把 pending Run 伪装成执行中。开发页只显示文本**字节数**、状态和用量，绝不显示模型原始 output。正式旧 Agent 未切换，真正输出/流式恢复与 F-R14/F1 仍待后续阶段。

隔离开发页的创建 Run 原本仅发送 `prompt`，不满足 B5.1 已安装的强制 `model` 请求。现经 `GET /ai/providers` 使用 Shared 的严格 Provider 列表解码、独立 8 MiB Provider 响应读取预算，Controller 仅保留启用 Provider 的模型选择元数据，提交时携带 `providerId/modelId/configurationVersion`，三字段一起纳入幂等写入签名，保留相同内容未知提交的原 key。Provider 配置是候选目录，后端依旧核实实时版本与能力冲突，任何本地选择都不成为真实执行授权。失效登录重置候选选择，刷新后不可用的选择会清除；本入口不是正式 Agent 页面迁移。

## 3. 依赖方向

app 装配 feature/runtime；feature 通过窄公开能力消费 runtime 和 foundation。跨功能通过公开入口/明确能力，不深层引用私有组件、Store 或实现。foundation 不反向依赖业务。新 Shared 契约按 [SHARED](SHARED.md) 消费，不在前端手写同义 DTO。

DEV transport 创建 Run 明确传 connectionIds:[]，不声称已有选中器；controller 消费 Shared stop/tool_calls 基础值，但 DEV view 仍只读取步骤 1。正式选择器、多步状态/游标与工具 modelStepIndex 留 F1，按最新 Shared 契约破坏性迁移。

## 4. 类型与转换

正式 Agent 工具审计待 F1：消费 Shared tools 的单项/事件页与 128 KiB 读取预算，transport 核对请求 App/Run/Tool、after/limit、服务器 nextCursor，controller 逐字段转本地状态并按 revision 去重。参数/结果正文不在公开协议，历史批准/审计状态不等同执行许可；当前不新增前端页面或宣称双端完成。

HTTP/WS transport 从 unknown 验证完整响应及安全错误，wire 与 UI 草稿/展示状态区分。字段、嵌套对象及联合分支按白名单投影；不能用断言冒充响应解码。Agent next API 使用 Shared codec，controller 再逐字段投影为本地应用状态。请求完整编码字节预算与后端共用 Shared，响应流在累计预算内读取，不全量加载后才拒绝。

跨 controller/view 复用的应用状态及错误联合归所属 `model/*-types.ts`，仅局部使用的类型留实现文件。Shared 负责字段形状及基础取值；transport 持有请求上下文，核对资源身份、端点成功状态与分页 after/limit，再交给 controller。响应声明异常或超预算的早退也收尾未消费 body；已取得的 reader 在最终路径释放锁。

## 5. 入口与安装

路由和 app 负责安装功能，view 负责展示和用户交互；异步协调、订阅和资源生命周期由明确 controller/runtime 持有。Agent next 与 Targets next 只在 DEV 路由安装，并从 Auth public 消费同一 next 认证能力。通用 UI 从 foundation/ui 的正式入口消费，功能布局由各业务 owner 负责，不把产品逻辑塞入基础组件。

## 6. 数据、事务与并发

浏览器缓存只是服务端状态投影，不替代版本/CAS/幂等。Agent next 为同一 create/cancel 写入意图保留稳定 Idempotency-Key；网络、协议或未知提交结果不会自动换 key。version_conflict 只刷新最新状态，不盲目继续写。登录、scope/run 切换、刷新和卸载使用 generation 与 AbortController；await 后检查有效性再发布，旧 finally 不清除新任务状态。事件按 runId/sequence 去重，游标只使用服务端 nextCursor。

## 7. 生命周期与失败

明确打开、取消、订阅、解除、关闭和卸载 owner。取消前端请求不证明后端副作用终止；晚返回的资源仍尝试归还给原 owner。错误映射稳定安全码，区分网络失败、协议失败、业务拒绝和未知写入结果；非 JSON、未知状态/错误码及错误 shape 不当作成功。不把失败刷新作为操作已恢复证明。

transport 产生具名失败与受约束 code，controller/view 只消费该契约；Auth 的共用失败从其公开入口消费，不比较普通 Error.message。服务端安全码引用 Shared，本地通信失败留本包；未知异常统一安全兜底，不能把技术正文用于翻译或决定认证/写入结果。

普通终端、Files、Agent 各有业务生命周期，共用技术原则而不混用权限与资源。PTY ACK/背压由对应 runtime 消费协议，view 不复制流状态机。资源关闭失败须有可追踪反馈，不能静默伪造关闭成功。

正式 Settings 在 F1 使用 Shared preferences/configuration：旧字符串字典替换为完整核心配置和 expectedVersion，CAPTCHA 使用 keep/clear/replace 且只读取 hasSecret；显示 version/effectiveVersion/requiresRestart。HTTP 失败/断流/unknown 后只读核对，不自动提交新版本；保存后当前认证与监控仍使用启动快照，重启才生效。布局等其它设置等待各自真实后端契约，不能拼进核心 policy。

## 8. 当前能力与验收

既有正式产品事实由 USAGE 与对应源码核对，本文不保存逐次修复记录。有限 Agent 状态的 Shared、backend-next、Auth next、Agent next transport/controller/DEV view 与三语源码已接入；现有开发入口不等于正式切换。Provider、App 启停/声明/目标名单、执行、工具、审批、WS 与真实浏览器行为仍未因此完成。既有 DEV App 创建通过 Shared 解码新的实例字段，controller 仍仅保留旧有限状态；完整 App 管理、UUID/definition 区分与新安全码消费归 F1。

源码复核的错误契约、类型归属、请求上下文校验及响应早退收尾仍未完成，已转入 [前端延期事项](../后端重构下一阶段实施方案.md#延后的前端事项未验收不删除)。当前先完成后端及其最终环境验收，再进行前端对接；已有 DEV 代码保留。上述边界是开发约束，不能因端点接通和静态通过就声称已全部满足。

执行 Frontend 类型检查、build、ESLint/Prettier 和根检查；桌面/移动端操作、滚动、取消与资源清理通过真实浏览器行为验证，未执行项明确保留。每次发布/行为变更同步 USAGE，不凭静态通过改写真实行为证据。

## Preferences 后续对接边界

F1迁移 preferences/presentation、commands、history、favorites Shared完整codec，transport先从unknown解码，所属controller再逐字段转UI状态。旧混合settings写入拆成核心policy与个人完整preferences；布局/焦点/侧栏共享用户版本，全部写入带CAS，未保存version0。历史与收藏改分页entries/nextOffset，编辑、触及、计数/批量标签传原版本；变量保留原型保留键限制。旧生产链仍由前端通过HTTP记录命令和访问路径，不新增后端Workspace自动记录。刷新隔离generation，冲突只读刷新，unknown不自动重放；正式消费和实际显示生效尚未实施。

## B8 后续消费范围（后端部分源码接线，前端未施工）

备份导出仍为POST settings/backup/export的JSON password→二进制下载，但F1须使用Shared system/backups及新Access会话，明确busy/source_changed/limit_exceeded/invalid_password和断流重导出。新文件为NXSEALED2，仅供最新恢复实现消费；在线导入尚未接线，正式前端当前不切换，也不将新导出描述为已验证可恢复备份。

外观实际消费者不只有 settings 面板，还包括 appearanceApi/store/useAppearance、终端/editor 字体、活动主题、HTML sandbox 和背景加载。F1 按 B8 最终 Shared 契约迁移，保留 wire→本地状态的明确转换；版本冲突只读核对，unknown 不盲目重传文件或重新删除。正式前端类型、UI 及素材加载本轮不修改。已接线差异：主题读取使用 version/preset 和毫秒时间，保留 selectionForeground，写/删传 expectedVersion；导入仍为 themeFile/name。外观首次 GET 持久默认 version=1，PUT 明确 patch/CAS，图片字段只读；背景 multipart 加 expectedVersion，删除传 JSON expectedVersion，返回 appearance/cleanupPending，按返回的 UUID URL 加载并处理更换后的 404。字体与 HTML/JSON/图片按 Shared 实际 UTF-8/转义预算校验；unknown 只读核对，不自动重复上传/删除。UI JSON 字符串通过 Shared helper 转变量对象再投影到 UI；ASCII --变量名/128 项/单值 2 KiB/完整 JSON 16 KiB，HTML 1 MiB，完整外观请求/响应 8 MiB。HTML库/远端来源已接后端源码，正式前端仍待F1。

Agent 后续须分别消费 integrations 的 MCP/ACP 管理、Browser target 设置与任务状态，以及 plugins 的安装/可信发布者/catalog、SDK/RPC、跨 App intents 和有限 Artifact 读取。静态可读不等于 App/RPC 获授权，发现工具不等于可执行。SDK 的版本/操作身份、iframe 及订阅归属也属于迁移范围，不能只替换 plugin-api 的 DTO import。

BackupApi 最终消费 system/backups 的输入、安全摘要/错误与实际加密下载/导入，媒体类型、容量和内容交付独立于 JSON codec；恢复维护态、重启/重新登录要求及结果未知须有明确反馈。具体字段、路由和状态差异随后端实现回填实施方案 F1；这里不虚构尚未完成的契约或页面。

B8 HTML 库 F1：消费 shared/preferences/html-themes，移除旧无版本写入/旧 URL 重写；列表区分同名 preset/custom，读内容按 text/plain 严格 UTF-8/1 MiB 解码，更新/删除取 custom 项原 version，不假定逐项连续。活动 HTML 是外观副本；库变更不自动修改活动内容。repository GET/PUT 与外观共享版本；处理 source_changed、source_unavailable、cleanup_failed/unknown，不自动覆盖或重传。当前正式 UI 未切换；源码接线不等于双端验收。

### B8 集成与插件待对接

正式Frontend仍使用旧Backend。后续F1通过Shared agent/integrations与plugins严格解码并在Frontend转换UI对象；集成create提供稳定UUID键，更新/删除/refresh显式CAS。Browser配置改走独立owner，MCP目录/hash/version及服务器续接身份不可由UI自造；新增stage/publisher CAS、安装/升级/卸载/取消退役、最新签名manifest和短期资源grant结构见实施方案F-R34/F-R35。Browser截图/下载改为Artifact ID/版本/hash，上传引用已存在Artifact；插件frontend资源不能沿用旧匿名永久缓存地址。有限SDK与data RPC已接线，正式父页仍待F1；有限backend runtime和仓库/推荐已接后端源码；其余Agent host/订阅、完整runtime恢复/备份尚未完成，不标为可用。F1父页校验当前iframe source/generation，使用Shared init/ack和appId/nonce建立通道；认证转发grant/envelope，核对每条响应id/seq/method，不把静态资源读取当授权。网络/未解码HTTP拒绝须转换为原请求的安全关联失败，写入断流保留operationId/输入；读写数据使用valueJson/墓碑版本和安装revision，卸载后明确清除复用原操作键。

F1插件仓库设置改消费Shared repository-*的独立CAS入口：最多16个URL、版本0首次保存、公开目录8MiB、规范URL4096bytes；目录兼容性由服务器计算，不从本地版本猜测。保留官方/远端catalog/stage与推荐路径，stage要求真实App/version/publisher匹配，最新sdkVersion为1。推荐返回entry/installation，已安装时entry可以为null；安装仍禁用/空grant，明确展示后续授权/启用步骤，不自动恢复旧全能力grant行为。后端SDK进程契约已是Shared backend-sdk；正式iframe只能消费前端SDK，不能取得进程句柄、宿主环境或数据目录。当前源码状态不代表网络/插件实机验收。

B8跨App对接留F1：plugin-api/agent-dispatcher/SDK父页改用Shared plugins/intent-*与九方法RPC；创建用稳定UUID operationId、inputJson、artifactIds及confirmed:true，不补旧input/artifactRefs字段；列表显式limit。冻结双方版本/修订，过期/撤销后不能换键自动重发；消息不会启动模型。Artifact metadata/单段Range仍须原接收会话与有效receipt，断流不算完整下载；RPC编码超限由用户减小limit；SDK分段读取传明确start/endInclusive，单次128 KiB，严格解码身份/范围/规范base64及实际长度后再转UI字节，不保留旧无身份裸字节桥。正式前端本批没有改动。
