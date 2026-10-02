# Nexus Terminal 架构问题分析

> 核对基线：当前本地 `main`（`71b571e2`）。原第 1–144 项均已作源码层核对；删除不成立项，保留“确认问题”及“待确认”项，不重新编号。确认问题指实现缺口或契约不一致有源码依据，不代表已经复现生产故障；待确认项的场景推演不是已确认结论。未进行全量行为、并发、负载或安全攻击验证。

## 总体问题

Nexus Terminal 当前已经建立了比较明确的架构边界：Backend 使用 `modules / infrastructure / interfaces / bootstrap` 分层，Frontend 使用 `app / features / runtimes / foundation / shared` 分区，同时存在 single durable owner、ports/adapters、protocol package、StateCommit、capability、Runner isolation 等约束。

部分实现与文档依赖方向存在差异；另一些条目只是文件规模或设计取舍，不能直接认定为缺陷。以下以各条目的核对状态为准，不以历史 PR 修改次数或文件大小作为问题成立的证据。

近期 PR 历史也能看到这一趋势。9 月 7–8 日的 #9–#19 中：

- PR #9 `restore frontend UI on new runtime architecture` 进行了较大规模的 runtime/frontend 重构。
- PR #12 随后补 regression gap。
- PR #13 清理 HTTP contract。
- PR #14 处理 optional load 隔离。
- PR #15 处理 settings/save 原子性。
- PR #16 专门处理 “hide feature stores behind facades”。
- PR #18 和 #19 再次修改 Workspace/FileManager、Monaco、Progress 等行为。

这些 PR 只提供历史背景，不作为以下任何问题成立的证据。是否存在缺陷，以当前调用链、约束和生命周期为依据。

## 1. Workspace 页面跨 Feature 组合位置（已关闭）

> 已关闭：跨 Feature 页面现位于 `app/pages/workspace/WorkspacePage.vue`；路由与空闲预加载由 App 直接加载。Runtime 通过 `presentation/public.ts` 暴露页面所需组件、UI state provider 和唯一 session registry，不反向加载 App 页面。此项仅调整组合位置，未改变产品行为；不代表 Runtime 的其他独立依赖问题全部消失。

## 2. Backend ↔ Agent Runner Wire Protocol owner（已关闭）

> 已关闭：两端共享 `packages/protocol/src/runner-version.json` 与 `runner.ts`；Backend wire decoder 直接消费公共 DTO，Runner command/job/file/code-navigation/project-instruction 类型及全部生产消费者已迁移，旧重复声明与转导出入口已删除。Runner 依赖和 Docker 构建同步更新。双方保留必要的边界校验，本地 durable record、授权与 wire→domain conversion 不合并为协议 owner。协议字段与版本值未变；未新增或运行 E2E。

## 3. Agent App Presentation / Application Controller 分离（已关闭）

> 已关闭：实例级 `host/useAgentAppController.ts` 持有 Thread/Run/Ledger、配置、缓存、错误域与异步操作／订阅生命周期。`AgentAppSurface.vue` 保留展示组件、模板绑定与 ResizeObserver。原 facade cleanup、generation fence、缓存限制与 Host window owner 保留，没有新增第二份业务状态；用户流程及布局不变。已用类型和 ESLint 检查验证，未新增或运行 E2E。

## 5. Runner Transport / Command Execution 分离（已关闭）

> 已关闭：重新核对后确认的边界是 Server 直接编排 command/job Journal transition、后台执行、工具链互斥及 provision/lifecycle，而不是文件体积或统一路由本身。上述执行流程已提取到实例级 `runner-command-executor.ts`；`server.ts` 保留认证、协议版本检查、HTTP/WebSocket dispatch、输入读取和响应映射。无状态的 record/key/browser/binding 校验放在 `runner-request-validation.ts`，route 专用校验仍留在 route 边界。复用原 Journal、Engine、Plugin、ACP、Terminal、Browser owner，保持 generation、幂等、unknown outcome、互斥和 drain/cleanup 顺序，不新增 durable authority。已有 background-job-lifecycle 与 coding-tool-surface Agent 场景通过；未新增或运行 E2E。

## 6. StateCommit 事务入口与 Recovery Transition 分离（已关闭）

> 已关闭：重新确认可独立提取的是恢复／App 禁用转换的实现，而非新增 authority 或必须迁到事务外的领域服务。`state-commit/recovery-transitions.ts` 接收 Adapter 当前事务，完成 active mutation lease→quarantine、Model/Tool 子状态收敛、输入／审批清理、Run/runtime/subagent/summary/event 更新；共享审批清理函数同时供终态审批清理入口使用。Adapter 仍开启唯一事务，成功提交后通知，再按原顺序读取历史 restart recovery candidates。SQL、scope/version 条件、执行顺序和恢复规则不变。已有 restart-recovery 与 app-disable-scope Agent 场景通过；未新增或运行 E2E。

## 7. SQLite Schema 定义与 Migration 执行边界拆分（已关闭）

> 已关闭：核对未发现错误迁移或重复数据库 authority，本项按代码组织改善处理，不宣称修复生产故障。75 个 schema SQL 定义按 core、Agent host/AI/execution/collaboration/plugins/workspace 分入 `database/schema/`，唯一 `sqlite-schema.registry.ts` 保留原初始化顺序。42 个已发布迁移按 core/runtime/capabilities/host 分入 `database/migrations/`，全局编号和列表顺序由 `migrations/registry.ts` 汇总，`sqlite-migrations.ts` 仅负责执行。消费者直接导入定义 owner，旧 `sqlite-schema.ts` 删除；未保留兼容转导出，未新增或重写迁移。一次性核对确认全部 schema SQL 值及迁移定义／顺序未变，已有 current-durable-schema、capability-grant-migration、legacy-machine-inspection-migration、legacy-settings-migration 场景通过；未新增或运行 E2E。

## 8. Agent Composition 子图工厂分离（已关闭）

> 已关闭：本项按明确子图的维护性改善处理，不将 Bootstrap 统一 wiring 认定为 authority 越界。`compose-providers.ts` 创建 Provider repository/secrets/adapter/service 与模型能力 registry，保留 Provider adapter→service 的延迟引用；`compose-ssh-capabilities.ts` 创建 SSH target/session/file/shell/project-directory 子图，保留 Thread 与 capability 授权检查。两者为纯组装工厂，不执行 initialize/dispose，不持有全局 mutable state。`compose-agent.ts` 继续负责跨子图 wiring、Host 回调、initialize/quiesce/dispose 顺序及整体服务返回；已有 Plugin、Workspace 工厂不变。Backend 构建及已有 SSH session jobs、Provider live capability 场景通过，场景验证对应服务而非新增工厂的完整启动；未新增或运行 E2E。

## 9. Root Build / Check 覆盖全部生产包（已关闭）

> 已关闭：核对确认的是本地完整入口覆盖不一致，不是 CI 漏验。根 `build` 现串行构建 Backend／Frontend／Agent Runner，根 `check` 保留两类 ESLint 并覆盖三个生产包类型检查。Canonical E2E 与依赖更新 workflow 删除完整 build 后的重复 Runner build，独立 Runner 作业仍保留包级构建。Runner 可选部署契约不变；根 check 与完整 build 已用 Node 24 实际执行通过，未新增或运行 E2E，未推送或取得本提交远端 CI 结果。

## 10. 大型静态 Theme 数据长期占用 TypeScript 编译单元

> 待确认（性能优化假设）：主题确实以有类型的 TS 数据声明；类型检查同时提供 schema 校验价值。尚无编译耗时／内存对比证明它是瓶颈，不能从体积推出“显著”性能退化；保留数据资源化取舍，未确认性能问题。

当前最大的 production TypeScript 文件之一是：

```text
modules/terminal-themes/preset-themes-definition.ts
≈ 294 KB
```

该文件主体是大量静态 theme definition，但仍作为普通 TypeScript 源码参与：

- parse
- AST 构建
- typecheck
- incremental compilation
- source review

静态数据规模远大于实际业务逻辑，增加了 terminal-themes module 的源码体积和编译输入；对实际编译耗时与内存的影响尚未测量。

这类数据与业务代码共处同一 TS 编译单元，还会增加源码浏览噪声，使真正的 theme catalog / validation / service 逻辑更难从静态定义中区分出来。

## 11. Context Checkpoint 确定性抽样替换为受治理的语义压缩（已关闭）

> 已关闭：此前局部语言偏置修复不代表整体策略替换完成。本项现采用模型结构化交接摘要、近期完整历史和连续分批合并，生产路径不再使用确定性首尾抽样或关键词筛选。验证范围为确定性 Agent 集成场景与静态检查，不宣称已证明真实模型对任意长任务无损摘要；未新增或运行 E2E。

Root Context 保留物理容量、输出预留、pressure、Tool schema、Recall、项目规则、Goal／Plan 和 Ledger 可见边界。ContextCheckpointService 仅规划摘要；Root execution 建立独立受 limiter、冻结配置、取消、重试和 Run 预算治理的模型 attempt，StateCommit 同事务提交 usage 与 checkpoint，不提前消费输入、不写普通助手 Ledger。

当前 checkpoint 使用：

```text
STRATEGY_VERSION = context-checkpoint-v2
GENERATOR_VERSION = semantic-handoff-v1
```

策略与验证边界：

- 全部可见旧历史按顺序送入摘要模型，已有摘要与新增历史按输入窗口分批合并；明确保留纠正、决策理由、约束、状态、阻碍与证据。
- 最近完整 causal groups 保留，摘要为低权威历史数据，不提升为 system 指令；原始 Ledger、授权与控制 owner 不变。
- 非空、结构、完整结束、输出预算、实际缩小和来源／revision 校验失败不覆盖有效摘要；存储故障不静默退回 drop-only。
- 迁移 #51 只清理旧策略派生摘要；新策略从原始 Ledger 重建。
- 已有场景覆盖中／日／英输入、历史中间及 220 字之后约束完整到达模型、后续纠正输入、多次分批合并、工具边界、真实 Root 编排、usage／输入消费／持久化、截断、取消及新输入 fence。模型输出为模拟 fixture，只证明链路与治理，不证明真实模型摘要质量。
- 单条记录超出摘要请求窗口时明确失败，不做无声截断；真实模型仍可能遗漏语义细节。

## 12. Subagent 自身历史与已消费纠正的持续上下文

> 已修复：行为探针确认，在容量及步数充足时，第 9 组工具交互会挤出早期事实，已消费 mailbox 纠正也退出上下文；这证明信息保留缺口，不代表已证明真实模型必然任务失败。现在 Child 保留自身完整历史，压力时采用受治理语义摘要＋近期完整交互，仍不继承 Root 私有对话或 Recall。

- `SubagentContextBuilder` 读取自身工具批次与已消费 mailbox，容量充足时不按最近 8 组丢弃历史；新 inbox 仍按最多 8 条读取，但不再用总字节截断后消费整页。
- 历史按稳定时间及步序／mailbox sequence 组织，完整工具批次不可拆开；摘要请求按窗口顺序分批合并，保留最新原始交互，不对单条超大记录无声截断。
- Child Model executor 使用 delegation 冻结模型、既有 limiter、取消、deadline 和 Run／delegation 步数、时间及 usage owner；独立摘要步骤不显示普通回复，也不消费当前 inbox。
- StateCommit 同事务提交 `agent_runtime_context_checkpoints`、attempt、usage、事件与 runtime projection；检查 scheduler owner、结束状态及来源前缀 hash。迁移 #52 为已发布结构增加派生摘要表，原始工具／消息不删除。
- 扩展现有 Agent 场景覆盖容量充足的早期事实／已消费纠正、多批合并、真实 SQLite 与执行编排、来源变化、重复提交、截断和取消后的旧摘要保护及 usage。未新增 E2E；未验证真实模型摘要质量，不承诺无损语义保真。

## 13. Run Approval Policy 只有 `ask` 与 `full_access` 两档

> 已关闭（产品所有者决定保留）：继续使用 `ask`／`full_access` 两档，不新增记忆批准或路径／命令模式规则。`full_access` 仍受 capability、target 和 deny 边界约束；这不是已证实安全缺陷。

Nexus 已经有 capability grant、target scope、denylist、risk inspection、policy revision 和 mutation approval 等多层治理机制。但 Run 本身的 approval mode 只有：

```ts
type RunApprovalMode = 'ask' | 'full_access';
```

`PolicyService` 对 mutation / destructive operation 统一返回 `requireApproval`，随后由 Run 的 approval mode 决定是否等待用户批准；`full_access` 会对仍处于 capability 和 target scope 内的 mutation 自动批准。

因此实际交互层只有两个极端：

- `ask`：所有需要批准的 mutation 都进入批准流程
- `full_access`：所有符合现有 capability / target / deny rules 的 mutation 自动批准

当前 Run approval policy 没有表达更细粒度的稳定授权条件，例如按 tool、command pattern、path/resource pattern 或某类 mutation 记忆本次 Run 的允许/拒绝决定。

这与底层已经存在的细粒度 capability 和 target model 形成粒度不一致：资源授权可以很细，但运行时批准策略仍是二值开关。复杂 coding task 中容易出现重复批准噪声，或者为了减少批准次数而切换到范围更大的自动批准模式。

## 14. 被截断的 Tool Output 缺少 Model 可重新寻址的完整结果句柄

> 已修复：截断 projection 携带 durable `toolCallId` 和内容 hash，`tool_result_read` 按当前 user／App／Run／Runtime 校验并提供有界分页读取。参考 OpenCode V2 的输出分页读取模式，复用已有 SQLite result owner，不另建输出存储；仅可恢复已捕获字节，执行端 capture limit 保持不变。

Nexus 对 Tool output 已经有明确的 bounded projection。`tool-result-projection.ts` 在结果超过 `maxToolOutputBytes` 时会保留：

- `originalBytes`
- `sha256`
- summary
- high-signal / head / tail 片段
- artifact / evidence refs
- bounded JSON data

同时 StateCommit 会把未经过 model projection 的 `ToolResult` 保存到 `agent_tool_calls.result_json`。因此 Backend durable state 中通常仍保留更完整的 Tool 结果。

写入 conversation Ledger、重新送给模型的 `tool_result` 使用 bounded projection，截断时提供 durable Tool Call 引用。模型用 `tool_result_read` 和 hash 读取原结果 JSON 的 Unicode 字符分页；页面按当前 Tool output 预算进一步收紧，返回 nextOffset，拒绝跨 runtime 读取与 hash 不匹配。

这会产生一个断层：

```text
Tool 完整结果
        │
        ├── durable DB result_json
        │
        └── bounded model projection
                    │
                    └── tool_result_read: toolCallId + sha256 + offset
```

不要求具体 Tool 把大输出重复保存为 Artifact，也不为读取而重新执行原 Tool。原结果的 outcome／verification 不因读取成功而升级。

Runner 的 Workspace command capture 仍有独立输出上限；本能力只弥补模型 projection，不能恢复执行时未捕获的数据。现有 Agent 场景验证真实 SQLite 原结果中间页恢复、hash 与 user／App／runtime 隔离；未新增 E2E。

## 15. Root Agent 的嵌套 `AGENTS.md` 发现依赖历史 Tool Call，首次触达存在 Instruction Gap

> 已修复明确 working-set 的首次发现缺口：Root 在生成 proposal 前优先从当前 pending input、最新有效输入、Goal 与活动 Plan 中发现显式 Workspace 路径，再补探索历史；现有 Agent 场景验证无历史时嵌套规则已进入模型请求。参考 OpenCode V2 的按目标 scope 发现原则，不扫描全仓，不承诺预知模型自行选择的任意目录；规则不是安全授权 owner。

Root Agent 在每次 Model step 之前通过 `projectInstructionTargetDirectories(snapshot)` 决定需要加载哪些 repository project instructions。

当前 target 集合固定从：

```text
/workspace/work
```

开始，额外目录只从 `snapshot.recentEntries` 中已经存在的 assistant tool call 参数推导，包括：

```text
shell_execute.cwd
file_read.path
file_search.path
file_patch.expectedFiles[].path
workspace_repo_map.path
workspace_code_intel.path
```

`RunSnapshot.recentEntries` 在 `sqlite-run.repository.ts` 中又只读取：

```sql
ORDER BY sequence DESC LIMIT 50
```

Root 的 target discovery 优先解析当前有效输入、Goal 与 pending／in_progress Plan 中显式的绝对 Workspace 路径和相对项目路径；归一化后只接受 `/workspace/work` 内目录，再补最近 Tool 参数。最多 8 个 target，不改变规则 source 的授权、根目录与字节边界。

Runner 侧的 `resolveProjectInstructions()` 只会沿 Backend 已传入的 target directory，从 nearest project root 到该 target 的 ancestor chain 查找 `AGENTS.md`。因此，如果仓库存在：

```text
/workspace/work/AGENTS.md
/workspace/work/packages/foo/AGENTS.md
```

当前请求或 Goal 明确指定 `packages/foo/...` 时，即使没有历史 Tool Call，本轮 Model context 也会沿该 target 的 ancestor chain 加载嵌套规则。模型临时自行选址仍依赖探索发现，不承诺自然语言路径识别完备。

当前任务 working-set 不再仅依赖 50 条 recentEntries 窗口；历史探索范围仍是有界补充，不持久镜像项目规则。

## 16. Subagent Governed Mutation 在 `ask` 模式下没有交互批准路径

> 已修复：governed Child 在 `ask` 模式使用同一 durable Approval owner，Tool work 原子转为 waiting；批准重新入队，拒绝／到期／新输入 supersede 写入 Child 自身结果并继续批次。`full_access` 保持现有自动批准路径。未新增审批系统，仍拒绝非 Workspace target、未授权 delegation 和 unknown outcome 重放。

内置 `worker` Subagent profile 被定义为：

```text
mutationMode: governed
capabilities:
  file.read
  file.write
  file.delete
  shell.execute
  workspace.manage
  artifacts.read
```

`SubagentContextBuilder.toolSchemas()` 按 delegation 的 governed 模式提供允许的 mutation tools：

```ts
delegation.mutationMode === 'governed';
```

执行侧与 durable begin 仍检查 governed delegation，否则以：

```text
SUBAGENT_MUTATION_NOT_GOVERNED
```

结束。durable begin 要求真实 approved、未消费、未过期且 operation／policy／input 绑定一致的审批，不再以 full_access 排除 ask。

Root mutation 的路径不同。`RootMutationExecutionAdapter` 在 `ask` 模式下仍会调用 `GovernedMutationExecutor.prepare()`，以 `autoApprove: false` 创建真实的 `requested` approval，随后等待用户批准；只有 `full_access` 才自动 resolve approval。

Subagent 复用 `GovernedMutationExecutor`，批准策略为：

```ts
autoApprove: run.definition.approvalMode === 'full_access';
```

`ask` 模式形成：

```text
child proposes mutation
        -> requested approval
        -> user approves / denies
        -> child continues
```

这样的交互批准链路。waiting work 在批准后重新入队，重检 inspection 与目标再消费审批执行。拒绝和到期通过现有 Child settle owner 保存完整结果、完成 work 并安排下一模型步骤；新输入 supersede 也恢复队列，旧审批不能再执行。

参考 OpenCode V2 permissions 的 `ask` 等待客户端决定 contract，适配 Nexus 已有 Run-level pause、Approval 与 scheduler work owner，未移植代码。现有 Agent 场景覆盖 SQLite waiting／批准重新入队／拒绝与过期续跑、预算计数及目标拒绝；不声称已完成真实 UI E2E 验证。

## 17. `plan` Execution Mode 的禁写边界没有覆盖 Subagent Tool Pipeline

> 已修复：Child schema 在 plan mode 隐藏 mutation／destructive；实际 inspection 的 mutation proposal 作为拒绝结果持久化；Tool executor 与 durable mutation begin 在副作用／approval consume 前再次拒绝。现有场景验证 full_access + plan 不暴露 mutation，以及伪造 ready Tool 的 durable begin 拒绝且审批未消费。参考 OpenCode V2 Plan／只读子 Agent 的执行前边界，不仅依赖提示词或事后 completion。

Root Agent 对 `executionMode: 'plan'` 有两层明确约束。

首先，`modelFacingToolSchemas()` 在 plan mode 下只向模型暴露：

```text
riskClass = read | control
```

其次，`ToolCallRunner.inspect()` 会再次检查实际 proposal；如果 plan mode 下调用到 mutation / destructive tool，会直接抛出：

```text
PLAN_MODE_TOOL_FORBIDDEN
```

Subagent 的 schema 与 governed mutation pipeline 同样检查：

```ts
run.definition.executionMode;
```

`SubagentModelStepExecutor` 在收到 child tool call 后，也直接调用底层：

```ts
ToolExecutor.inspect(...)
```

随后根据 plan mode 与 inspection.mutation 将不允许的 proposal 拒绝持久化；无论 schema 是否伪造，实际 Tool executor 与 durable begin 都不能执行 plan mutation。

Create Run 的输入校验允许 `approvalMode` 与 `executionMode` 独立组合，没有发现禁止：

```text
approvalMode = full_access
executionMode = plan
```

这组配置下 Root 与 worker 的 model surface 都隐藏 mutation tools；既有 grants 不覆盖 executionMode，full_access 也不能批准 plan mutation。

Root completion gate 的事后检测保留作为补充，不替代 Child 的执行前 invariant。未新增 E2E。

## 18. Subagent 绕过 Deferred MCP Tool Surface，Root / Child 的 Tool Exposure Contract 不一致

> 已修复：Child 复用 Root modelFacingToolSchemas 与 resolveDeferredToolProposal，隐藏 deferred schema，以 tool_search／tool_invoke 按需发现，解析后重新检查 delegation grants。现有场景验证只读 MCP 的 Child router、直接隐藏工具拒绝、stale handle 拒绝及无 grant 拒绝。参考 Codex pinned commit `14a477ea89712071944244022e8a10142845456e` 的 tool_search 模式；复用 Nexus owner，未移植上游代码。

Root Agent 对 MCP capability 已经实现 deferred tool exposure。`tool-model-surface.ts` 会识别：

```text
modelExposure = deferred
capability = integration.mcp.read | integration.mcp.invoke
```

这类 Tool 不直接进入 Root model schema，而是通过：

```text
tool_search
tool_invoke
```

按需发现和调用。`tool_invoke` 使用带 tool name + version 的 handle；`resolveDeferredToolProposal()` 会在真正 inspection 前检查 handle 指向的 Tool 仍然存在且 version 没有变化。

Subagent 的 model surface 复用：

```ts
modelFacingToolSchemas(catalog, scope, availability, executionMode);
```

随后按 delegation 的 capability／risk 过滤；排除：

```text
user_input_request
```

deferred descriptor 不直接暴露；有可用的授权 deferred Tool 且允许 tool_search 时提供两个 router。Plan 保持同一只读 surface 限制。

Subagent profile 获得下面 grant 时，通过 router 发现允许的只读 MCP 能力：

```text
integration.mcp.read
```

执行时先 resolveDeferredToolProposal，检查当前 catalog version，再对具体 proposal 做 delegation grant 校验，然后 ToolExecutor.inspect。handle 不授予权限；governed Child mutation 的 Workspace-only 边界不放宽。

Root／Child 使用相同 model-facing router contract：

```text
Root     -> direct core tools + tool_search/tool_invoke -> deferred MCP
Subagent -> permitted direct tools + tool_search/tool_invoke -> deferred MCP
```

Child 不再重复暴露全量 MCP schema；动态 contribution 版本替换时旧 handle fail closed。未新增 E2E，不声称已测所有真实 MCP Server。

## 19. Root 与 Subagent 的 Model Retry 策略差异是否需要统一

> 已修复（按所有者决定新增 Child 重试）：Root／Child 共享瞬态错误分类、次数与退避 policy；Child 失败 attempt／usage 先 durable settle，再 queued work 有界重试，保留 frozen model。deadline、Run／delegation step budget、取消和 owner epoch 继续约束；不重放 Tool 副作用、不新增 fallback route。SQLite 场景验证 503→重试成功及两次 usage 结算。

参考 Codex pinned commit `14a477ea89712071944244022e8a10142845456e` 的 responses_retry：服务端退避建议不扩展重试次数。Nexus 使用自身 durable work／StateCommit，未移植代码；每次失败的 partial output 不形成 completion、Tool proposal 或 mailbox 消费，usage 仍计费。次数记录在连续 retry work payload，新正常步骤重置；非瞬态、耗尽、取消和重启遗留 interrupted 均不自动重试，allowedModels 不变为 fallback route。

## 20. Run Interrupt 的 Streaming 检测覆盖 Child，但实际 Abort 只发送给 Root Scheduler

> 已修复：input／Goal／pending-input 的 streaming 查询按 agent_runtimes.participant_id=root 限定，与 Root scheduler signal owner 一致；Child-only streaming 的显式 interrupt 返回 RUN_NOT_STREAMING_MODEL，SQLite 场景验证拒绝。保留 Root-only 产品语义，Child 纠正使用 mailbox，取消走既有链路。

`appendInputTransition()` 在处理 Run 的新输入和显式 interrupt 时，会查询整个 Run 下是否存在：

```text
agent_steps.kind = model
agent_steps.status = running
agent_model_attempts.status = streaming
```

这条查询通过 runtime participant 限定 Root，只有 Root streaming model attempt 会让：

```text
shouldInterruptModel = true
```

显式 interrupt 仅 Root streaming 可提交，不以 Child streaming 冒充 Root 可中断。

但 `RunService` 提交后的 interrupt callback 在 composition root 中绑定为：

```ts
(run) => scheduler.signalInput(run);
```

这里的 `scheduler` 是 Root `AgentScheduler`。`AgentScheduler.signalInput()` 只查自己的 `active` Root Run，并只 abort Root 的 `AbortController`。

Subagent 有另一套 `SubagentScheduler`，它自己维护 child work 的 `AbortController`，并提供：

```text
cancel(runId)
cancelRuntime(runId, runtimeId)
```

input／interrupt／Goal callback 继续只 signal Root；这与查询 owner 一致，不隐式取消 Child。

因此当 Root 已经 park/settle、Run 的实际 streaming model 只属于 Subagent 时，会出现：

```text
interrupt transaction: 仅 streaming child -> RUN_NOT_STREAMING_MODEL
RunService:            调用 Root scheduler.signalInput(run)
Root scheduler:        没有 active Root Run -> 返回 false
Subagent scheduler:    未收到 abort
```

child model call 会继续运行，已经排队的 child tool work 也不会因为这次 Run interrupt 自动失效。普通 append input 和 goal update 在 `shouldInterruptModel` 为 true 时也走同一个 Root-only callback。

这使 Run 级的“是否有 streaming model”判定和真正的 cancellation owner 不一致：状态层把 Root/Child 视为一个 Run 的 model execution，执行层的 interrupt signal 却只覆盖 Root scheduler。

## 21. Durable `toolVersion` 没有在 Read / Control Tool 真正执行时形成版本绑定

> 已修复：executeAuthorized 在授权前校验 durable toolVersion，并在异步授权后、调用 Tool.execute 前再次校验 catalog implementation identity／version；read、control、mutation 共用 fence。现有 progressive-disclosure 场景验证 inspect 后替换及授权 await 中替换均 RESOURCE_CHANGED 且无执行副作用。延续已参考的 deferred 版本绑定原则，无第二 catalog owner。

Tool proposal 被 inspection 后，`agent_tool_calls` 会持久化：

```text
tool_name
tool_version
inspection_json
```

动态 MCP contribution 也把 schema hash 编进版本，例如：

```text
mcp:<schemaHash>
```

Root 的 deferred MCP handle 同样携带 Tool name + version，在 `resolveDeferredToolProposal()` 阶段能够拒绝 stale handle。

但真正执行 read / control Tool 时，`ToolExecutor.executeAuthorized()` 只做：

```ts
const tool = catalog.require(inspection.toolName, context)
const fresh = capabilities.authorize(...)
if (!fresh.allowed || fresh.policyRevision !== inspection.policyRevision) ...
return tool.execute(inspection, context)
```

这里没有检查：

```text
tool.descriptor.version === inspection.toolVersion
```

`catalog.require()` 又是按 Tool name 返回当前注册项。因此在 proposal 已经持久化以后，如果 `replaceOwnedContribution()` 用同名新版本替换了动态 MCP Tool contribution，后续 read/control execution 会拿到新 Tool implementation，却把旧 inspection 的 `normalizedArguments`、target 和 preconditions 传给它。

对 MCP remote Tool 来说，本地 Tool name 可以在 schema refresh 前后保持不变，而 descriptor version 会随 `schemaHash` 改变。新 implementation 的 `execute` closure 持有新的 descriptor/schema；旧 inspection 却是按旧 input schema 和旧 Tool version 生成的。当前通用执行层不会在这两个版本之间做 equality check，也不会在正常 read/control 路径执行前统一 re-inspect。

Mutation 路径的行为不同：`GovernedMutationExecutor` 会调用 `refreshMutationInspection()`，而 `refreshProposedToolTransition()` 又要求 durable `tool_version === refreshed inspection.toolVersion`，所以版本变化至少会在执行前形成冲突。Read/control 没有这个同等级的 version fence。

因此当前 `toolVersion` 对 proposal / durable record 是 provenance 字段，对 read/control execute 却不是执行 invariant。动态 Tool registry 更新发生在 model proposal 与实际 execution 之间时，存在“旧 inspection 驱动新 Tool 实现”的 TOCTOU 窗口。

## 22. Subagent Terminal Evidence 只从最近 32 个 Tool Batch 回收，长期 Delegation 会丢失早期已验证证据

> 已修复：completion 从 contextHistory 的完整 durable 工具历史收集成功、confirmed＋verified 引用，不再限最近 32 批。保留 64 refs／16 个有界工具摘要；超过引用上限显式 SUBAGENT_EVIDENCE_TOO_LARGE，历史读取失败不能静默变成成功无证据 completion。场景验证 40 批早期引用及 65 refs 明确拒绝；Artifact 数据不因 handoff 边界删除。

Subagent 在准备 terminal completion 时，会调用：

```ts
verifiedRuntimeEvidence(scope, runId, runtimeId);
```

这个方法的唯一 Tool evidence 来源是：

```ts
contextHistory(scope, runId, runtimeId);
```

Repository 提供完整有界 durable 历史（超过 10000 批显式拒绝），completion 不先取最近窗口：

```sql
GROUP BY source_model_step_id
ORDER BY batch_created_at DESC
-- 全部历史，有显式容量上限
```

然后只在这些 batch 中收集：

```text
result.outcome = confirmed
result.verification.status = verified
result.ok = true
```

得到的 refs 随后被写入：

```text
agent_steps.output_refs_json
agent_delegations.evidence_refs_json
subagent.completed event
completion mailbox message.artifactRefs
```

`agent_delegations.evidence_refs_json` 在此前的 Tool settle 路径中没有持续累积；terminal model settle 会直接用这次 `command.evidenceRefs` 写入。因此早于最近 32 个 Tool batch 的 verified artifact/evidence，即使仍然完整存在于 `agent_tool_calls.result_json` 和 Artifact 表，也不会进入最终 delegation evidence refs。

内置 Subagent template 的 `maxSteps` 当前最高为 24，所以默认模板通常不会越过这个窗口。但自定义 profile 的 `maxSteps` 允许一直到全局 `hardLimits.maxRunSteps`；默认 hard limit 配置为 400。长生命周期自定义 worker 因此可以合法产生超过 32 个 Tool batch。

这意味着 Subagent 的 durable execution history 和 terminal evidence identity 并不等价：数据库仍保留早期 verified Tool result，但 parent 收到的 completion message、delegation view 和 terminal event 只携带最近窗口中重新发现的 evidence refs。长期 delegation 的早期验证引用会从标准 completion handoff 中消失。

## 23. Graceful `AGENT_QUIESCE` 会把正在 Streaming 的 Subagent 永久结算为 Cancelled（已修复）

> 已修复：Child Model executor 与 Root 一样识别 `AGENT_QUIESCE`，退出执行并将遗留 attempt/work 交给既有 lifecycle recovery，不提交业务取消、completion handoff 或 retry。检查 stream 异常及正常返回后的 signal，以及 compaction／proposal／terminal commit 前边界。下文为修复前证据；现有 startup 会关闭旧 Child，并按安全 checkpoint 创建新执行，不承诺旧 Child 原地续跑。

Root 与 Subagent 都会在 Backend quiesce 时收到：

```text
AbortController.abort(new Error('AGENT_QUIESCE'))
```

但两条执行路径对这个 lifecycle signal 的 durable 语义不同。

Root `NativeAgentBackend.execute()` 明确识别：

```text
NEW_INPUT
GOAL_UPDATED
AGENT_QUIESCE
```

其中 `AGENT_QUIESCE` 会直接退出当前执行，不把 Run 当成用户取消。后续 startup 会执行 `interruptNonTerminalRuns()` 和 checkpoint recovery，再重新 enqueue 可恢复 Run。

Subagent model path 没有区分 abort reason。`SubagentModelStepExecutor` 捕获 model stream 异常后只判断：

```ts
outcome = signal.aborted ? 'cancelled' : 'failed';
failureCode = signal.aborted ? 'ABORTED' : errorCode(error);
```

随后 `settleSubagentModelStep()` 会把这个 `cancelled` 结果 durable 地写成：

```text
agent_model_attempts.status = aborted
agent_steps.status = cancelled
agent_delegations.status = cancelled
agent_runtimes.status = stopped
agent_scheduler_work.status = cancelled
```

并生成 `subagent.cancelled` terminal event。也就是说 `SubagentScheduler.quiesce()` / `quiesceScope()` 为正常停机发出的 `AGENT_QUIESCE`，在 child model 正在 streaming 时会被解释成业务级取消。

这与 Subagent scheduler 自身的 durable recovery 设计发生冲突。非 graceful 的进程中断如果来不及 settle，下一次 `initialize()` 会通过 `resetClaimedWork()` 回收 orphaned claimed work；graceful quiesce 反而会先把 delegation 和 work 正式写成 cancelled，使它们不再属于可恢复 work。

因此 Root 和 Child 对同一个 host lifecycle signal 的语义相反：Root 把 quiesce 当作可恢复执行中断，Child 把 quiesce 当作 terminal cancellation。Backend 正常重启期间正在运行的 child delegation 会因此丢失 continuation。

## 24. Full Backup 的跨数据库／文件系统快照一致性（已修复引用完整性缺口）

> 已核实并修复：Plugin cleanup 先删文件再更新 version status，稳定 inventory 不能证明数据库引用完整。capture 在同一排他事务内验证 ready Artifact size/hash、active Plugin package marker、entry 与 files.json 文件 size/hash；不完整则拒绝导出。Artifact staging/deleting 保持两阶段恢复语义，不误判为 ready 缺失。备份表覆盖 Child context checkpoint。不声称冻结全部文件 writer 或提供跨存储物理时间点快照。下文为原风险分析。

`SqliteBackupSnapshotAdapter.capture()` 会在一个数据库 transaction 中依次读取所有 product / Agent 表，然后继续读取文件系统目录：

```text
background
custom_html_theme
agent/artifacts/objects
agent/plugins
```

Agent durable state 同时存在于 SQLite 与这些文件目录中。例如数据库保存 artifact、plugin version / installation、workspace/runtime 等记录，而 artifact object 和 plugin 文件本体位于文件系统。

数据库 transaction 会阻止经同一 adapter 提交的数据库变更，但不能直接冻结文件系统。`captureStableFiles()` 的 inventory 和文件稳定性重试能发现部分变化；是否仍有文件发布／删除与数据库引用脱节的窗口，需要核对具体 writer 的提交顺序。

待验证的风险是：未被数据库 barrier 和稳定性重试共同覆盖的 writer 可能导致跨存储时间点不一致。尚不能据现有读取顺序断言恢复后一定出现缺失引用。

## 25. Backup Restore 未进入 Agent 生命周期（已修复）

> 已修复：beforeRestore 调用 Agent prepareRestore，停止 sweep、quiesce Root/Child dispatcher，关闭 MCP/SSH/browser/interactive handles 与 Plugin processes，清除动态 Plugin/definition registry 和 deferred recovery 状态。afterRestore 重新 initialize，包括失败后 adapter rollback 存活的数据。不复用恢复前 lease/queue/runtime；quiesce 失败禁止进入 restore。下文为原问题证据。

Backup restore 的 `beforeRestore` 当前执行：

```text
transferTasks.cancelAll()
workspaceSuspend.dispose()
sshSuspend.dispose()
executionSessions.closeAll()
```

没有调用 Agent 的 `quiesce()`。而 Agent 自身已有完整的停机路径，会 quiesce root scheduler、subagent scheduler 和 app lifecycle。

Restore 完成后的 `afterRestore` 只执行：

```text
settings.ensureDefaults()
terminalThemes.initialize(...)
appearance.initialize()
sshResourceStatus.clearCache()
```

也没有重新执行 Agent startup 所要求的：

```text
modelRegistry.initialize()
plugins.initializeInstalledVersions()
stateCommit.interruptNonTerminalRuns()
checkpoints.recoverInterrupted()
subagentScheduler.initialize()
scheduler.resume()
```

Frontend import 成功后只在 300ms 后执行 `window.location.reload()`，Backend 进程本身并没有重启。

因此 restore 可以在 Agent scheduler、plugin runtime、model registry、cache 仍持有恢复前内存状态时替换 SQLite 与 Agent 文件树。恢复完成后，这些长期存活的 owner 可以继续使用恢复前的 lease、registry、queue、runtime handle 或 cache 去读写已经回退到历史时点的 durable state，形成进程内存状态与恢复后磁盘状态不一致。

## 26. 删除 Proxy / SSH Key 留下非法 Connection（已修复）

> 已修复：repository 在同一排他事务内检查 Connection 引用并删除。任何引用阻止删除，需先修改／删除消费者，不自动改路由或凭据。检查与删除之间无并发写入窗口。下文为原问题证据。

Connection 的创建/更新路径对依赖关系有明确 invariant：

- `route = proxy` 时必须存在 `proxyId`。
- key auth 必须存在 inline private key 或 `sshKeyId`。

但 SQLite schema 对 `connections.proxy_id` 和 `connections.ssh_key_id` 使用：

```sql
ON DELETE SET NULL
```

`ProxyService.delete()` 与 `SshKeyService.delete()` 又允许直接删除被 Connection 引用的记录，没有在删除前阻止引用，也没有同步修复 Connection 的 route/auth 状态。

仓库 migration #20 甚至包含一段专门修复 legacy 数据的逻辑：当 `proxy_type='proxy'` 但 `proxy_id IS NULL` 时把 proxy route 清掉。这说明 schema 层本身允许形成 Service 层认为非法的状态。

运行时删除 Proxy 后，Connection 可以继续保持 proxy route 但 `proxyId = null`，后续 SSH resolver 会在真正连接时失败。删除 SSH Key 后，原本依赖该 key 的 Connection 可以保持 key auth，但同时 `sshKeyId = null` 且没有 inline private key，最终变成不可解析的 credential 状态。

## 27. Connection Import 内联 Proxy 部分提交（已修复）

> 已修复：ConnectionImportCommitPort 由 SQLite adapter 在每条 record 的排他事务内复用 Proxy/Connection 校验、凭据保护和 repository，嵌套 aggregate work 加入同一事务。失败回滚新 Proxy、Connection、tags 和 audit，无 import cache 或盲删补偿。Legacy normalization 不变。下文为原问题证据。

`ConnectionImportService.importRecords()` 遇到带 inline proxy 的记录时，会先执行：

```text
proxies.create(normalized.proxy)
```

再执行：

```text
connections.create({ ...normalized.connection, proxyId })
```

这两个 durable mutation 没有共享 transaction，也没有第二步失败后的补偿删除。

Connection 创建失败时，本次 import 可以把 record 计为失败，但先创建的 Proxy 不会自动回收。重复导入也可能被 Proxy 的 duplicate 检查拒绝；确认的是部分提交，不是必然持续创建重复 Proxy。

## 28. 后置 Audit 失败造成业务响应歧义（已修复）

> 已修复：经用户确认，AuditLogService 将审计定义为非阻断记录，捕获持久化错误并记录 actionType 与安全 errorCode，不记录 details/secret，不让已提交业务返回操作失败。没有声称审计必达或实现 outbox。全部 logAction 消费者使用同一契约。下文为原问题证据。

当前多个模块的顺序是：

```text
repository mutation
await audit.logAction(...)
return success
```

Connection create/update/delete、Tag create/update/delete、Notification Settings，以及部分 Auth / password / 2FA / passkey / Settings 路径都存在这种形态。业务 repository mutation 与 audit insert 不在同一个 transaction boundary 中。

当业务写入已经提交，而 `audit.logAction()` 因数据库或其他错误抛出异常时，HTTP/service 调用会向上报告失败，但业务状态已经改变。

这会产生明确的重试歧义：客户端认为第一次操作没有成功并再次提交，实际却可能对已经生效的状态执行第二次 mutation。Connection import 也会受此影响：`connections.create()` 内部如果只在 audit 阶段失败，import record 会被统计成失败，但 Connection row 实际已经存在。

## 29. IP Blacklist 过期后不能再次封禁（已修复）

> 已修复：过期 blockedUntil 开启新的失败计数周期，达到阈值可再次封禁；活动封禁保留原 deadline，不因失败请求无限续期。计数原子性由下一项 #30 单独修复。下文为原问题证据。

`IpBlacklistService.recordFailedAttempt()` 当前计算：

```ts
const newlyBlocked = attempts >= max && !current?.blockedUntil;
const blockedUntil = current?.blockedUntil ?? (newlyBlocked ? now + duration : null);
```

`isBlocked()` 只判断：

```ts
blockedUntil > now;
```

第一次封禁到期后，repository 中的 `blockedUntil` 仍然保留为一个已经过期的非空时间戳。之后新的失败尝试会因为 `!current?.blockedUntil === false` 而永远无法再次进入 `newlyBlocked`，同时 `blockedUntil` 又继续保留旧的过期时间。

因此一个 IP 只要经历过一次完整的封禁并自然过期，后续无论累计多少次失败都不会再次被 `isBlocked()` 判为封禁，除非中间发生 `resetAttempts()` 或记录被显式删除。

## 30. IP Blacklist 并发失败丢计数（已修复）

> 已修复：repository.recordFailure 在排他事务内读计数、处理到期周期、更新计数和 block deadline，返回真实 newlyBlocked。Service 不再持有 read-modify-write；并发调用不能覆盖计数，通知仅由进入封禁的 transition 触发。下文为原问题证据。

`recordFailedAttempt()` 先读取当前记录：

```text
repository.get(ip)
```

然后在内存中计算 `attempts + 1`，最后执行：

```text
repository.upsert(...)
```

这一组操作没有 transaction compare-and-update 或数据库原子 increment。

两个并发失败请求可以同时读到相同的 attempts 值，各自计算相同的 `attempts + 1`，随后相互覆盖。最终数据库只增加 1 次失败，而实际发生了 2 次。

封禁阈值因此会被并发请求推迟，且阈值附近的请求可能因为 lost update 没有触发预期的 block transition。

## 31. Quick Command 本体与 Tag Association 分离提交（已修复）

> 已修复：QuickCommandRepository create/update 同一事务提交本体与去重后的 tag associations；非法 tag/FK 导致整体回滚。删除无人消费的 setCommandTags 独立入口，批量追加标签能力保持不变。下文为原问题证据。

`QuickCommandService.add()` 的顺序是：

```text
repository.create(...)
tags.setCommandTags(id, tagIds)
```

`update()` 同样先更新 command row，再调用 `setCommandTags()`。

Command repository 与 tag association repository 各自拥有独立 transaction。HTTP 层只验证 `tagIds` 是整数，没有在写 command 前保证所有 tag 都存在；`setCommandTags()` 插入不存在的 tag 时会因为 FK 失败并回滚自己的 association transaction。

因此 create 请求可以返回 500，但 command row 已经永久创建；update 请求也可以报告失败，但 command name/body/variables 已经更新，而 tag association 保持旧值。这使一个 API mutation 在客户端看来失败时仍然产生部分提交。

## 32. Workspace Transfer / Archive writer settlement（已修复）

> 已核实并修复：Transfer Promise.all 首次 reject 可越过存活 worker，清理/close 错误被吞；Archive channel error/terminate 未证明远端 exit 就 fulfilled。Transfer 等待全部 worker、共享 close Promise、成功关闭后才清理；无法证明 close/cleanup/replace 的结果时 reject。Archive 仅数值 exit status 证明命令结算，error/terminate 无 exit 证据时 reject 且不清理临时文件；guard signal 传入 operation。known failed/cancelled 保持 fulfilled，unknown 由 guard quarantine，不把失败等同成功或未知。既有 Agent lease scenario 增补确定性交错与真实 SQLite lease 状态断言。下文为原核对背景。

`LeaseMutationGuardAdapter.withMutation()` 的 contract 是：work Promise 正常 resolve 后调用 `handle.confirm()`；只有 work reject 或抛异常时才调用 `handle.unknown(...)`。

但 `StreamTransferOperationService.run()` 会捕获运行时错误和取消，转换成：

```text
{ type: 'failed' }
{ type: 'cancelled' }
```

事件后正常 resolve。`RemoteArchiveOperationService` 的 compress/decompress 路径也会把多类 validation、runtime error 和 cancellation 转成 terminal event 后 resolve。

`WorkspaceOperationsService` 在 `runGuardedTransfer()` / `runGuardedArchive()` 中只是捕获 terminal event，再把上述 operation 包在 `mutationGuard.withMutation()` 中。因此 operation 即使最终产生 `failed` 或 `cancelled`，guard 看到的仍是 fulfilled Promise，并执行 `handle.confirm()`。

Transfer / Archive 的远端副作用可能部分执行，但“已知部分失败”和“结果未知”应区分。待核实的是 operation resolve 时是否已经证明命令退出、清理完成且没有存活 writer；仅凭 failed/cancelled 事件不能认定 confirm 违反 guard 契约。

## 33. Connection `jumpChain` 删除／改型留下悬挂依赖（已修复）

> 已修复：Connection repository 在排他事务内阻止删除被 jumpChain 引用的连接或将其改为非 SSH，并在 create/update 同事务重检 hop 存在／SSH／非自身。保留 JSON 存储与 Resolver fail-closed，不自动修改消费者路由。下文为原问题证据。

`ConnectionService.create()` / `update()` 会逐个检查 `jumpChain`：

```text
ID 必须是正整数
不能引用自身
被引用 Connection 必须存在
被引用 Connection 必须是 SSH
```

但持久化层只是把整个数组序列化到：

```text
connections.jump_chain TEXT
```

它没有 foreign key、反向引用表或 delete/update precondition。`ConnectionService.delete()` 只是直接执行 repository delete，不会查找哪些其他 Connection 的 `jumpChain` 仍然包含该 ID；`ConnectionService.update()` 也允许把一个原本为 `SSH` 的 Connection 改成 `RDP` / `VNC`，同样不会检查它是否正被其他 Connection 当作 jump hop 引用。

因此一个原本合法的 jump route 不只会在删除 hop 后变成悬挂引用，也会在 hop 被改成非 SSH 类型后变成 Service 层无法重新创建出来的非法状态。`SshConnectionResolver` 解析 jump chain 时会重新读取每个 ID，并分别在两种情况下抛出：

```text
连接配置 ID <id> 未找到。
连接配置 ID <id> 不是 SSH 类型。
```

也就是说 create/update 时成立的 aggregate invariant 不会在依赖 Connection 删除时被维护，数据库会长期保存 Service 层无法再次创建出来的 route 状态。

## 35. Initial Admin Setup 并发创建多个初始用户（已修复）

> 已修复：createInitialAdmin 在 repository 排他事务中检查 users 空表并插入；并发 setup 只有首个提交成功。密码 hash 在事务外执行，不将初始用户限制误加到所有数据恢复路径。下文为原问题证据。

`AuthService.setupAdmin()` 用下面的前置检查保护一次性初始化：

```text
if users.count() > 0 => reject
users.create(...)
```

`count()` 与 `create()` 是两个独立数据库操作，没有共享 transaction 或 compare-and-insert 条件。

`users` 表只对 `username` 做 UNIQUE，没有“系统只能存在一个初始化用户”的数据库约束。`/auth/setup` 也直接调用这条 service path。

两个使用不同 username 的并发 setup 请求可以同时在 `count() === 0` 时通过检查，然后各自完成 `INSERT INTO users`。最终数据库会存在两个都通过“初始管理员”流程创建的用户，而两次请求都可以返回成功。

这使一次性 bootstrap invariant 只存在于非原子的应用层检查中，并发初始化可以绕过它。

## 36. Server Transfer 同名源条目身份丢失（已修复）

> 已修复：registry 为每个 subtask 保存 sourceItemIndex，orchestrator 直接读取 payload 的原条目；sourceItemName 仅显示。不同路径同名源不会都解析成第一个对象，不改变目标覆盖策略或 wire DTO。下文为原问题证据。

`TransferTaskRegistry.create()` 为每个 source item 建立 subtask 时只保存：

```text
sourceItemName: item.name
```

没有保存 source item 的 path 或稳定 ID。

执行阶段 `TransferOrchestratorService.processSubTask()` 再通过：

```ts
task.payload.sourceItems.find((i) => i.name === sub.sourceItemName);
```

恢复真正的 source item。

请求 validation 只要求每个 item 的 `name`、`path`、`type` 有效，没有要求 `name` 唯一。因此下面这类合法 payload：

```text
/a/config.json  name=config.json
/b/config.json  name=config.json
```

会生成两个 subtask，但两个 subtask 都 `find()` 到第一个 `config.json`。结果是第一个路径被执行两次，第二个路径没有被传输，同时 task 状态仍可以显示两个 subtask 都 completed。

这里丢失的是 transfer task 内部 source identity，不只是 UI 展示名称冲突。

## 37. Command / Path History 并发 upsert 重复（已修复）

> 已修复：两份 repository 的查找／插入／更新时间／重复合并在同一排他事务中。旧重复值再次 upsert 时保留最小 ID 并删除其余条目；旧备份格式保持可导入，不新增 UNIQUE 导致恢复兼容性变化。未触及的旧重复项不会被本次自动清扫。下文为原问题证据。

`SqliteCommandHistoryRepository.upsert()` 与 `SqlitePathHistoryRepository.upsert()` 都采用两步逻辑：

```text
UPDATE ... WHERE command/path = ?
如果 changes == 0：INSERT ...
```

但对应 schema 只有：

```sql
command TEXT NOT NULL
path TEXT NOT NULL
```

没有 `UNIQUE(command)` 或 `UNIQUE(path)`，两步操作也没有包在同一个 transaction 中。

因此两个并发的首次写入可以发生下面的交错：

```text
request A: UPDATE -> 0 rows
request B: UPDATE -> 0 rows
request A: INSERT -> row #1
request B: INSERT -> row #2
```

最终同一个 command/path 会存在多条记录。后续所谓 `upsert()` 的 UPDATE 会同时更新这些重复行，而 reload/list 仍会返回全部重复记录，所以重复一旦形成不会被当前逻辑自动收敛。

这与 repository 方法名和上层“历史条目按 command/path 合并”的语义不一致。

## 38. Operational Secret SQLite 明文存储（已修复）

> 已修复：TOTP、captchaConfig 和 notification config 通过带版本前缀的 SecretCipher envelope 存储，repository 返回领域明文；启动事务迁移旧明文并验证已有 ciphertext，错误密钥不退化为明文。Backup capture 解密配置、restore 用目标密钥重加密，保留原备份结构与旧备份兼容；用户身份/TOTP 仍不属于 Full Backup。迁移不擦除历史 SQLite page/WAL 或旧外部备份。下文为原问题证据。

项目对 Connection / Proxy / SSH Key credential 已建立明确的加密存储路径：service 在写入 repository 前调用 `SecretCipher.encrypt()`，数据库列也使用 `encrypted_password`、`encrypted_private_key`、`encrypted_passphrase` 等语义。

但另外几类同等级敏感值仍直接写入普通 SQLite TEXT / JSON：

- `users.two_factor_secret`：TOTP secret 原文。
- `settings['captchaConfig']`：包含 `hcaptchaSecretKey` / `recaptchaSecretKey` 的完整 JSON。
- `notification_settings.config`：SMTP `smtpPass`、Telegram `botToken`，以及 Webhook headers 中可能携带的 Authorization credential。

`SqliteSettingsRepository` 会把 settings value 原样写入 `settings.value`；`SqliteNotificationRepository` 对 config 只做 `JSON.stringify()`；`SqliteUserRepository.updateTwoFactorSecret()` 也直接写 secret，没有经过 cipher。

HTTP response 层虽然会对 CAPTCHA secret、SMTP password 和 Telegram token 做隐藏/不返回处理，但这只解决 API 回显，不改变数据库中的明文状态。

因此只要 SQLite 文件、数据库备份前的本地数据目录或数据库读取权限泄露，攻击者不需要 Nexus encryption key 就可以直接取得 TOTP seed、CAPTCHA provider secret、SMTP/Telegram/Webhook credential。当前 credential protection boundary 在不同模块之间并不一致。

## 39. Remote Text Save 先截断原文件（已修复）

> 已修复：write 使用同目录随机唯一临时文件 wx，保留原 mode 与编码，finished 后 replaceFile；失败 destroy/drain 后清理临时文件，不提前截断目标。create 的独占新建语义不变，atomicity 仍取决于 transport 的 replaceFile contract，unknown 不声称回滚。下文为原问题证据。

`RemoteTextWriterService.write()` 当前保存已有文件时直接执行：

```ts
const stream = await filesystem.openWrite(remotePath, { mode: original.mode });
stream.end(encodedContent);
await finished(stream);
```

SSH filesystem adapter 的 `openWrite()` 默认 flags 是：

```ts
flags: options.flags ?? 'w';
```

也就是目标文件在完整新内容传输完成之前已经被 truncate。

如果 SSH/SFTP 连接在 stream 中途断开、远端磁盘写失败、进程终止或 `finished(stream)` 以错误结束，调用方虽然会得到失败，目标文件却可能已经变成空文件或只包含新内容的前半部分，原内容没有保留副本可恢复。

这不是 transport capability 限制：`RemoteFileSystem` port 已经暴露了 `replaceFile(sourcePath, destinationPath)`，并注明使用 transport 支持的最强 atomic rename。当前 text writer 没有使用临时文件 + replace 的路径。

Workspace mutation guard 在这种失败下只能把 mutation 标记为 unknown/quarantine；它无法把已经 truncate 的远端文件恢复成保存前内容。因此一次普通 editor save 的传输故障可以造成用户文件内容损坏。

## 40. Passkey Assertion Counter 并发回退（已修复）

> 已修复：commitAuthentication 以 verifier 使用的 expectedCounter 条件更新 counter 与 last-used，同一 statement 完成。CAS 失败拒绝认证，非零 counter 只允许增加，0→0 同步 Passkey 保持有效；旧 updateCounter/touch 入口删除。下文为原问题证据。

`PasskeyService.finishAuthentication()` 会先按 credential ID 读取当前 passkey row，然后把其中保存的 `counter` 交给 `verifyAuthenticationResponse()`：

```ts
const passkey = await this.repository.getByCredentialId(credentialId);

const verification = await this.webauthn.verifyAuthentication({
  ...,
  credential: passkey,
});
```

`SimpleWebAuthnAdapter` 随后把这个已读取的旧 counter 传入 WebAuthn verifier：

```ts
credential: {
  ...,
  counter: request.credential.counter,
}
```

验证成功以后，service 再单独调用 repository 更新：

```ts
await Promise.all([
  this.repository.updateCounter(credentialId, verification.newCounter),
  this.repository.touch(credentialId),
]);
```

而 `SqlitePasskeyRepository.updateCounter()` 是无条件覆盖：

```sql
UPDATE passkeys
SET counter=?, updated_at=strftime('%s','now')
WHERE credential_id=?
```

因此 counter 的读取、WebAuthn 校验和新 counter 持久化之间没有 compare-and-swap 条件或同一事务内的版本约束。

如果同一个 authenticator 的两个 assertion 并发到达，它们可以同时读到旧 counter `N`，分别验证得到 `N+1` 和 `N+2`。两个请求都可能在旧值 `N` 上通过验证；如果 `N+2` 先写入、`N+1` 后写入，数据库最终会从 `N+2` 回退到 `N+1`。

WebAuthn signature counter 的安全语义依赖服务端保存值保持单调。当前实现允许并发成功登录造成 counter 回退，也允许多个请求在同一个旧 counter 快照上完成验证，削弱了后续 replay / cloned-authenticator 检测所依赖的状态一致性。

## 41. Background 删除的数据库失败窗口（已修复）

> 已核实为可自愈的短暂缺口并修复：先提交空背景引用再删除文件，数据库失败不删除文件；后置 cleanup 错误安全诊断、不逆转已提交响应。保留 missing reference 自愈，不声称自动回收所有 orphan 文件或解决并发 upload 的独立问题。下文为原核对背景。

remove 先删除文件再清空 Setting；第二步失败可留下 missing reference。AppearanceSettingsService.get() 已有检测并清理 missing background 的路径，数据库恢复后有机会自愈，因此不保留“永久悬挂”的结论。

## 42. Workspace create 预检查遮蔽 replay（已修复）

> 已修复：授权与 requestHash 后先 repository.replayCreate，再业务 admission/profile 解析；同 key/hash 返回原 Workspace，不重复发 provision。创建事务仍共享同一 replay helper 防并发重复提交；payload mismatch/pending/unknown 保持拒绝，replay 有原 idempotency retention 边界。下文为原问题证据。

`WorkspaceRuntimeService.create()` 已经接受 `idempotencyKey` 并计算稳定的 `requestHash`，底层 `SqliteWorkspaceRepository.createWorkspace()` 也实现了完整 replay：它先通过 `commandForReplay(..., 'workspace.create', idempotencyKey, ...)` 查找旧命令，校验 `request_hash`，然后返回原先创建的 Workspace。

但 service 在调用 `createWorkspace()` 之前先执行：

```ts
const existing = await this.repository.listWorkspaces(scope);
if (
  existing.some(
    (workspace) =>
      workspace.runId === runId &&
      workspace.agentRuntimeId === agentRuntimeId &&
      !['deleted', 'failed'].includes(workspace.status),
  )
) {
  throw new Error('WORKSPACE_EXISTS');
}
```

因此第一次 create 成功以后，同一个客户端因为响应丢失、网络重试或调用方重放而再次提交完全相同的 idempotency key/payload 时，现有 Workspace 会被这个 service-level 检查先命中，调用直接抛出 `WORKSPACE_EXISTS`。repository 中已经实现的 idempotency replay 根本没有机会执行。

这意味着 `workspace.create` 的 durable idempotency contract 对“成功后重试”这一最核心场景实际失效：调用方无法通过相同 key 稳定获得第一次创建的 Workspace，而会得到一个业务冲突错误。

## 43. Workspace 并发创建突破数量限制（已修复）

> 已修复：createWorkspace record 携带有效 maxActiveWorkspaces，repository 排他事务在 replay 后按 user_id 统计所有 App 的 active Workspace、检查配额再插入；保留同 run/runtime 冲突检查。Service 删除独立 count admission，不以数据库 statement 串行冒充异步链原子。配置使用该请求读取的 effective limit，非同事务 settings revision CAS。下文为原问题证据。

同一个 `WorkspaceRuntimeService.create()` 会先在事务外读取全部 Workspace 并计数：

```ts
const existing = await this.repository.listWorkspaces(scope);
const active = existing.filter((workspace) => !['deleted', 'failed'].includes(workspace.status)).length;
if (active >= workspaceSettings.maxActiveWorkspaces) throw new Error('WORKSPACE_LIMIT_EXCEEDED');
```

之后才解析 profile，并进入 `repository.createWorkspace()` 的独立数据库事务。`createWorkspace()` 自己只校验同一 `runId + agentRuntimeId` 是否已有 live Workspace，没有重新校验用户级 `maxActiveWorkspaces`，数据库 schema 也没有表达这个动态配额约束。

当当前 active 数量为 `maxActiveWorkspaces - 1` 时，两个针对不同 run/runtime 的并发 create 可以同时完成 `listWorkspaces()`，都观察到还有一个名额，然后各自进入 create transaction 并插入新的 Workspace。最终 active 数量会达到 `maxActiveWorkspaces + 1`。

因此这个配置当前只是非原子的 admission precheck，不是 durable concurrency limit；并发请求可以突破它。

## 44. Workspace adminAction 永久复用失败命令（已修复）

> 已修复：管理操作使用独立 attempt identity，同参数 pending/running/unknown 在 repository 事务内复用；明确终态后主动提交创建新命令，保留历史，不重放 unknown。Workspace 生命周期原 operation-hash replay 不变。参数复用既有 canonicalize 比较，不依赖 JSON 字段顺序。下文为原问题证据。

`WorkspaceRuntimeService.adminAction()` 对管理操作固定使用 admin scope 和 `generation = 1`：

```ts
return this.dispatch({ userId, appId: ADMIN_SCOPE.appId }, action, undefined, 1, input);
```

`dispatch()` 的 `operationHash` 只包含 scope、action、generation 和 payload。随后 `SqliteWorkspaceRepository.createCommand()` 会先按：

```sql
WHERE user_id=? AND app_id=? AND action=? AND operation_hash=?
```

查找旧 command，只要存在就直接返回；没有 TTL、attempt 或 terminal-status 条件。

`dispatch()` 对 replay 到的 terminal command 又会直接返回：

```ts
if (command.id !== commandId) {
  if (!['pending', 'running'].includes(command.status)) {
    if (syncWorkspace) await this.syncCommandProjection(scope, command);
    return command;
  }
  ...
}
```

所以同一个 `packInstall`、`packUninstall` 或 `runtimeCleanup` payload 一旦得到 `failed` 或 `unknown`，用户之后用完全相同参数再次执行，生成的 hash 仍然相同，backend 会永久 replay 旧失败结果，而不会向 Runner 创建新的 command。

这些 endpoint 并没有由调用方提供的显式 idempotency key；当前 operation hash 实际同时承担了去重和 retry identity，导致 transient failure 不能通过正常“再试一次”恢复。

## 45. Workspace setup / uninstall 先提交 Settings（已修复提前提交）

> 已修复提前提交：Runner 命令使用 confirmationId 稳定身份并等待终态，明确 succeeded 才 CAS settings／删除确认。pending/failed/unknown 不改配置、不消费确认；同确认重试复用原命令。Runner 已成功而 settings CAS 失败保留确认并报错，不盲回滚远端或覆盖新设置；这不是跨存储原子事务，也未提供自动恢复配置冲突。下文为原问题证据。

`WorkspaceRuntimeManagementService.confirmSetup()` 的提交顺序是：

```ts
await this.settings.patch(userId, { workspaceRuntime: plan.workspaceRuntime }, expectedVersion);
await this.confirmations.delete(userId, confirmationId);
return this.runtime.adminAction(userId, 'packInstall', asJson({ packs: plan.packs }));
```

也就是先把 recipe/tool versions 写入 Agent Settings，随后删除 confirmation，最后才发 `packInstall`。如果 command 创建失败，方法直接抛错；如果 Runner submit/query 失败，`dispatch()` 会把 command 记成 `unknown`；如果 Runner 明确安装失败，则返回 `failed`。这些路径都不会恢复已经提交的 settings。

`resolveRunEnvironment()` 又直接使用 `settings.effectiveSettings.workspaceRuntime` 中的 `enabledRecipeIds`、`toolVersions.defaultVersionId` 和 `enabledVersionIds` 来冻结 Workspace profile；因此 setup command 失败以后，持久化配置可以已经把某个 recipe/version 标成启用或默认，但对应 pack 实际仍未安装。

`confirmPackUninstall()` 也采用同样的顺序：先修改 `workspaceRuntime.toolVersions`，再删除 confirmation，最后发 `packUninstall`。Runner 删除失败时，配置已经表示该 pack 被移出 enabled/default 集合，但运行时文件仍然存在。

这里的 confirmation 只保护 preview 时的 settings/catalog revision，并没有把 Settings mutation 与 Runner command 组成一个可恢复的提交协议，所以失败会留下 durable configuration 与实际 Runner inventory 不一致。

## 46. Backup Restore dispose Suspend 长期 owner（已修复）

> 已修复：两个 Suspend owner 增加 reset，仅清空会话／待恢复资源，保留 sweep 和 ownership subscription；restore 与既有 resetForE2E 消费 reset，真正 shutdown 仍 dispose。restore 异常后 owner 仍可服务新会话；不重启或改动真实运行实例。下文为原问题证据。

`composition-root.ts` 的 `beforeRestore` 在每次完整备份导入前执行：

```ts
transferTasks.cancelAll();
await workspaceSuspend.dispose().catch(() => undefined);
await sshSuspend.dispose().catch(() => undefined);
await executionSessions.closeAll();
```

这两个 `dispose()` 都不只是清空当前会话。

`WorkspaceSuspendCoordinatorService.dispose()` 会执行 `this.ownershipRevocationUnsubscribe()`，永久取消它在构造阶段建立的 ownership revoked subscription；之后没有再次订阅的路径。

`SshSuspendService.dispose()` 会 `clearInterval(this.sweepTimer)`，并清空 `sessions`、`availabilityWaiters`、`ownershipRevokedListeners`；这个实例也没有 restart / initialize 路径去重新创建 sweep timer。

Backup 的 `afterRestore` 当前只重新初始化 Settings、Terminal Theme、Appearance，并清理 SSH resource cache，没有重建上述两个 service。

因此一次成功的 backup import 完成后，Backend 进程仍继续复用已经 dispose 的 `workspaceSuspend` / `sshSuspend` 实例：新的 suspended session 不再由原 sweep timer 回收，Workspace suspend coordinator 也不再接收 ownership revoke 事件。若 restore 在 `beforeRestore` 之后失败，同样会留下这个进程级 teardown，因为失败路径不会执行等价重建。

## 47. Root safe-boundary 错写 recoverable abort 为 cancelled（已修复）

> 已修复：主循环顶部对 NEW_INPUT/GOAL_UPDATED/AGENT_QUIESCE 直接退出执行，不提交业务取消；其他取消保留 durable safe-boundary cancel。已完成 step 不重复 supersede，恢复仍由 scheduler/recovery owner 持有。下文为原问题证据。

> 确认问题：`native-agent-backend.ts:127–131` 对 signal.aborted 无 reason 分支调用 cancelAtSafeBoundary；outer catch 的 recoverable reason 特判不覆盖正常循环进入此处。未控制 settle→下一轮的精确时序复现。

`AgentScheduler.signalInput()` 和 quiesce 路径分别使用：

```ts
controller.abort(new Error('NEW_INPUT'));
controller.abort(new Error('GOAL_UPDATED'));
controller.abort(new Error('AGENT_QUIESCE'));
```

`NativeAgentBackend.execute()` 的 outer catch 明确把这三个 reason 当作 recoverable interruption；模型 step 尚未关闭时，`NEW_INPUT` / `GOAL_UPDATED` 还会通过 `supersedeModelStep()` 结束旧 step，Root tool batch 也会在这三个 reason 下直接 return。

但 `executePersisted()` 每轮顶部只有：

```ts
if (signal.aborted) {
  const cancelled = await this.lifecycle.cancelAtSafeBoundary(snapshot);
  ...
  return;
}
```

这里没有判断 abort reason。`cancelAtSafeBoundary()` 会 durable 写入 `run.cancelled`、`run.status_changed -> cancelled`、`status='cancelled'` 和 `completedAt`。

因此如果 abort 恰好发生在一个 model / tool step 已经完成 durable settle / commit、控制流即将进入下一轮 `while` 的窗口，当前轮不会再抛出 abort error 进入 reason-aware catch；下一轮只看到 `signal.aborted`，把 `NEW_INPUT`、`GOAL_UPDATED` 或 `AGENT_QUIESCE` 都当作正式取消。

同一个控制信号由时序决定是 supersede / recover 还是 terminal cancel，会使追加新输入、更新 goal 或正常 quiesce 在 safe-boundary 竞争窗口中意外终止 Root Run。

## 48. Runner lifecycle 与 checkpoint 单向互斥（已修复）

> 已修复：beginWorkspaceLifecycleDrain 同步拒绝已有 checkpointCaptures，restore/capture 原反向检查保留；同 generation 双向 admission 互斥，不改变 job drain 策略。下文为原问题证据。

> 确认问题：`workspace-runtime-engine.ts:93–102` 的 beginWorkspaceLifecycleDrain 只查 drain；restore 反向查 checkpoint/drain/writers。缺少对称 admission 检查，最终影响须以并发 restore/lifecycle 测试验证。

`WorkspaceRuntimeEngine.restoreCheckpointArchive()` 在开始恢复前会检查：

```ts
(this.jobs.get(key)?.size ?? 0) > 0 ||
  (this.workspaceWriters.get(key) ?? 0) > 0 ||
  this.checkpointCaptures.has(key) ||
  this.workspaceMutations.has(key) ||
  this.workspaceLifecycleDrains.has(key);
```

随后把 `key` 放入 `checkpointCaptures`，并一直持有到整个异步 archive 接收、校验、解包和 work tree swap 完成。

但是 lifecycle 的反向入口 `beginWorkspaceLifecycleDrain()` 只检查：

```ts
if (this.workspaceLifecycleDrains.has(key)) throw new Error('WORKSPACE_LIFECYCLE_CONFLICT');
this.workspaceLifecycleDrains.add(key);
```

它没有检查已经存在的 `checkpointCaptures`。因此 restore 先进入以后，另一个 lifecycle command 仍可以随后获得 drain。

这个窗口有实际状态影响。Checkpoint restore 只允许 `ready` generation，并会在恢复阶段执行 `workRoot -> backup`、`staging -> workRoot` 的目录 swap；与此同时 `start` 可以把 generation 改成 `running` 并激活 Workspace plugin，后者可能在 work tree 正被替换时启动。`delete` 也可以先删除 generation runtime、把 journal 写成 `deleted`，而已经开始的 restore 继续修改持久 Workspace work tree并最终返回成功。

所以当前 checkpoint 与 lifecycle 的“安全状态”取决于谁先进入：checkpoint 会拒绝已经存在的 lifecycle drain，但已经存在的 checkpoint 不会阻止新的 lifecycle drain，两个 owner 没有形成对称互斥。

## 49. Runner Workspace `start` 的多 Plugin 激活失败补偿不完整，会留下运行中的部分 Plugin

> 确认问题：`plugin-runner-runtime.ts` 的 activate loop 只清理当前失败实例；controller start catch 只 stop runtime，与 restart 的 disposeWorkspace 不同。只在后序插件失败且前序成功时成立，未启动故障插件验证。

`PluginRunnerRuntime.activateWorkspace()` 按 `workspace.runnerPlugins` 顺序启动：

```ts
for (const target of workspace.runnerPlugins) {
  ...
  const instance = this.start(workspace, target);
  this.instances.set(key, instance);
  try {
    await instance.ready;
    await instance.request('lifecycle.activate');
  } catch (error) {
    this.instances.delete(key);
    await instance.close().catch(() => undefined);
    throw error;
  }
}
```

如果前几个 Plugin 已经完成 `lifecycle.activate`，后面的某个 Plugin 启动或 activate 失败，catch 只删除并关闭当前失败实例；之前已经加入 `instances` 的 Plugin 不会被回滚。

Workspace `start` 对这个异常的补偿又只有：

```ts
try {
  await this.dependencies.pluginRunner.activateWorkspace(workspace);
} catch (error) {
  await this.dependencies.runtimeEngine.stop(workspace.workspaceId, workspace.generation).catch(() => undefined);
  throw error;
}
```

这里没有调用 `pluginRunner.disposeWorkspace(workspace)`。`save(workspace, 'running')` 只在全部成功后执行，因此失败后 journal 仍保持原来的 `ready`，runtime 被写回 `stopped`，但已经成功激活的前序 Plugin 子进程仍留在 `PluginRunnerRuntime.instances` 中继续运行。

同一个实现里的 `restart` 失败路径会显式执行 `disposeWorkspace()`，说明 `start` 与 `restart` 对部分激活的补偿语义也不一致。一次普通 start 的中途失败即可形成“Workspace 未运行、部分 Plugin 仍运行”的进程内状态。

## 50. Runner 多文件 applyPatch 的集合原子性与部分失败契约待确认

> 待确认（集合原子性契约）：`workspace-coding-files.ts` 的 temp validation + rename 序列没有集合 rollback，这一点成立。但单次 API 不自动意味着多文件必须原子提交；需确认对外失败／partial outcome 契约，不能直接宣称实现违反承诺。

applyWorkspacePatch 先统一检查 expected SHA 并生成临时文件，再逐项 rename；没有集合级 rollback。中途失败可部分生效，但需要确认 API 是否承诺全文件集合原子提交、错误结果是否应报告已应用文件。

## 51. File Editor 的关闭路径不检查 `dirty`，Tab / Popup / Workspace 关闭都会静默丢弃未保存内容

> 确认问题：`features/file-editor/composables/useFileEditorSession.ts:200–231` close/bulk/scope 无 dirty gate；FileEditor 的 discard confirm 用在 reload/encoding，不覆盖这些关闭入口。未作 UI 手动复现。

`createFileEditorSession()` 已经维护了每个 `EditorDocument.dirty`，但所有关闭 API 都直接删除 tab：

```ts
function close(id: string): void {
  const index = tabs.value.findIndex((item) => item.id === id);
  if (index < 0) return;
  tabs.value.splice(index, 1);
  ports.delete(id);
  ...
}
```

`closeOthers()`、`closeToRight()`、`closeToLeft()`、`closeAll()`、`closeScope()` 最终全部复用这个无条件 `close()`。`FileEditor.vue` 的 tab 关闭按钮也直接调用 `editorSession.close(tab.id)`；`WorkspaceSessionSurface.closeDocumentPopup()` 在 popup editor 模式下直接执行 `editorSession.value.closeAll()`；Workspace runtime 被移除时，registry 会调用共享 editor 的 `closeScope(id)`。

同一组件只有 reload / encoding change 路径会调用 `confirmDiscardIfDirty()`。因此用户修改文件后，只要关闭单个 tab、批量关闭 tab、关闭 popup 或关闭对应 Workspace，就可以在没有任何确认和保存机会的情况下永久丢失本地未保存内容。

## 52. File Manager rename / delete 不更新已打开 Editor 文档，后续保存会在旧路径重新创建文件

> 确认问题：FileManager mutation 未通知 EditorSession，save 使用 document.path；RemoteTextWriter 对不存在路径仍默认 w。前提是旧 tab 保留并再次保存，不是 rename/delete 本身立刻重复创建。

`FileManager.vue` 的 rename 只执行远端 rename 并刷新目录：

```ts
await props.channel.rename(target.value.path, joinPath(parentOf(target.value.path), text));
await browser.load();
```

delete 同样只执行 `channel.remove(...)` 后刷新 browser。两个 mutation 都没有通知 `FileEditorSession` 更新或失效对应 document。

Editor document 的 `path` 在 `open()` 时写入，之后保存始终使用这个旧值：

```ts
await port.save(doc.path, contentToSave, encodingToSave);
```

Backend 的 `WorkspaceFilesystemService.writeFile()` 最终进入 `RemoteTextWriterService.write()`；这里若旧路径已经不存在，`metadata(remotePath)` 返回 `null`，随后仍然调用没有 `wx` 限制的 `filesystem.openWrite(remotePath, undefined)`。因此：

- 文件 A 被 File Manager rename 为 B 后，仍打开的 A tab 再保存，会重新创建 A；
- 文件被 File Manager 删除后，仍打开的 dirty tab 再保存，会把已删除文件重新创建出来。

这是 File Manager 与 Editor 对同一远端文件缺少 mutation identity / path invalidation 协议导致的实际数据一致性错误。

## 53. File Editor 的异步 `open()` 不属于 Workspace scope 生命周期，Workspace 关闭后仍能插入幽灵 Tab

> 确认问题：`useFileEditorSession.ts:64–85` load 后 push；closeScope 仅删除当前 tabs，无 scope generation/in-flight invalidation。需要 load 在关闭后成功返回才触发，网络失败不会生成 tab。

共享 `FileEditorSession.open()` 在 tab 尚不存在时会先执行异步 `port.load(path)`，请求完成后才创建并 push document。它使用的 `openGeneration` 只决定最后谁成为 active tab，并不表示 scope 是否仍然有效：

```ts
const loaded = await port.load(path);
...
ports.set(doc.id, port);
tabs.value.push(doc);
```

Workspace teardown 时 `workspaceRuntimeRegistry.removeRuntime()` 调用 `sharedEditorSession.closeScope(id)`，但 `closeScope()` 只能遍历当时已经存在的 tabs；没有 scope generation、disposed token 或 AbortController 能取消仍在 `port.load()` 中的 open。

这个 load 本身还包含远端 `readBinary()` 之后的异步 decoding / dynamic import，所以即使 Workspace close 已发生，旧请求仍可能稍后返回并把一个新的 tab 插回共享 session。该 tab 保存了已经 dispose 的 Workspace document port，UI 会重新显示属于已关闭 session 的文档，之后 reload/save 再落到失效 transport。

同仓库的 `FilePreviewSession` 已经为 pending load 保存 AbortController 和 operation token，并在 close/clear 时取消；Editor 没有等价生命周期保护，因此两条文件打开路径的 teardown 语义不一致。

## 54. Authenticated Session Reset 未覆盖部分 Frontend Store

> 确认问题（session cache 生命周期未覆盖）：sshKeys/history/quickCommands/serverTransfers store 未注册等价 reset；SSH Key loaded fast path 保留缓存。Nexus 正常产品是单用户，不能据此声称存在常规 A→B 多租户泄露；同账号 logout/login 的 stale state 缺口仍成立。

Frontend 已经有 `authenticatedSessionLifecycle`，并给 connections、proxies、tags、preferences、appearance、notifications 等 owner 注册了 reset。但以下用户级 store 没有进入这个 teardown：

- `sshKeys.store.ts`
- `commandHistory.store.ts`
- `quickCommands.store.ts`
- `serverTransfers.store.ts`

其中 SSH Keys 不只是加载期间的短暂旧状态。`sshKeys.store.ts` 缓存 `items` 和 `loaded`，`load(false)` 在 `loaded === true` 时直接返回现有 items；store 没有 `reset()`。`SshKeySelector.vue` mount 时又只调用默认的 `keys.load()`。

同一 SPA 进程退出后重新登录，SSH Key selector 可以继续使用退出前的 key name/id 缓存，直到显式 force refresh。只有部署确实允许切换不同用户时，才进一步涉及跨账号旧列表；正常单用户场景不能直接推定该前提。

Command History、Quick Commands 和 Server Transfers 同样保留全局 Pinia state；虽然通常会在组件 mount/poll 时再次请求，新请求返回前仍持有并可能渲染旧 session 数据。当前 authenticated-session owner contract 没有覆盖全部 session-scoped cache；这不等于 Backend 数据权限被绕过。

## 56. Bounded SSH command 把“没有 exit status”的 close 当作 exit code 0，会把异常终止报告为成功

> 确认问题：`ssh-execution-transport.adapter.ts` close handler 对未提供 code 的情况默认 0。SSH server 未发送 status／以 signal 结束是触发前提；不是所有正常 close 都错误。

`executeBoundedCommand()` 的 close handler 当前是：

```ts
stream.once('close', (code: number | undefined, exitSignal: string | undefined) => {
  const exitCode = typeof code === 'number' ? code : 0;
  const finalResult = result(exitCode, exitSignal);
  if (exitCode !== 0) ...
  else settleResolve(finalResult);
});
```

SSH channel 的 close 事件已经显式把 `code` 建模为 `number | undefined`，同时保留 `exitSignal`。但 undefined 被强制转换为 0，所以远端没有发送 exit-status、连接异常结束、或者只有 signal 没有 numeric code 时，调用方都会收到成功的 `CommandResult { exitCode: 0 }`。

这会污染依赖 `execute()` 成败判断的 capability probe、resource/operations 命令和其他 bounded command：一个没有可证明成功 exit status 的命令会被提升为成功状态，甚至同时携带非空 `signal`。

## 57. Server-to-server Transfer 的目标凭据转交需要明确源端信任前提

> 待确认（传输设计／授权提示）：`server-transfer-executor.ts:75–92` 确实把 key/password/passphrase 交给 source 的 rsync/scp/sshpass，并有临时 key 清理。服务器直传本身需要源端认证目标；是否违反产品 trust contract 需确认源端受信前提和 UI 提示，不能把实现方式本身定为越权。

源端 rsync/scp 登录目标需要目标 credential；实现将临时 private key 写到源端并在 finally 清理，password/passphrase 经 sshpass 使用。源端 root 可观察这些值，0600 不能隔离 root。待确认是否已有明确源端受信／凭据转交提示，以及是否需要 Backend relay 模式。

## 58. Server Transfer 的 source capability probe 不接受取消信号，任务取消可以被三个串行 10 秒探测延迟

> 确认问题：ServerTransferExecutor commandPath 探测未接收 request.signal；主传输有取消，不代表启动前 probe 可立即取消。这里只确认有限延迟，不是永久不可取消；实际取消延迟未测。

`execute()` 在真正选择 rsync/scp 前依次执行：

```ts
const sshpass = await this.commandPath(source, 'sshpass');
const sourceRsync = await this.commandPath(source, 'rsync');
const sourceScp = await this.commandPath(source, 'scp');
```

`commandPath()` 调用 `source.execute()` 时只传 `timeoutMs: 10_000` 和 output limit，没有把 `request.signal` 传进去。

任务只在进入 `execute()` 时调用一次 `throwIfAborted()`；如果用户在上述探测已经开始后取消，当前 probe 不会 abort，后续 probe 也没有重新检查 signal。慢或不可响应的 source 因此可以让一个已取消任务继续串行执行最多三次 10 秒级 command timeout，之后才在更晚的 target/transfer 路径重新观察 cancellation。

这和真正的 target probe、mkdir、transfer command 已经透传 `AbortSignal` 的语义不一致，导致取消延迟专门集中在任务启动阶段。

## 59. Jump Chain 的 hop 引用是否应复用被引用连接的完整 route

> 待确认（hop 是否只代表 host credential）：resolver flatten 确实未保留 hop.route，Connection validation 又接受该配置。但 jumpChain 的每一 hop 也可能设计为从前一跳直连的主机描述；需确认文档是否承诺复用被引用连接的完整 route，再判缺陷。

validateJumpChain 接受带自身 route 的 SSH Connection，resolveJumpChain 将其投影成 host/credential，未保留 route/proxy/jumpChain。待确认 hop 的定义是“完整连接配置”还是“从前一跳连接的主机”；后者并不要求执行被引用连接的独立 route。

## 60. SSH Resource Status 按采样开始时间计算 TTL 的代价待测

> 待确认（freshness 定义）：`ssh-resource-status.service.ts` 用 startedAt+refresh 计算 expiry，并有 inFlight 去重。以采样开始计时可以是有意 freshness policy；未测慢采集是否造成实际频率／负载问题。

cache expiresAt 从 startedAt 计算；采集较慢时完成即过期，但 inFlight 能合并并发请求。待测该策略是否导致重复昂贵采集；以采样开始作为 freshness 起点本身可合理。

## 61. Plugin Agent Mutation 的 operationId 与各 endpoint replay 契约待确认

> 待确认（统一 operation identity 与幂等执行须区分）：`features/agent/plugin-sdk/agent-dispatcher.ts:99–106` 等分支未传 operationId，但部分方法用 expectedVersion/CAS 或本身幂等。需要逐 endpoint 确认必须 durable replay 的约定，不能把缺少 header 等同于所有重试都会重复 mutation。

dispatcher 的 thread rename 等分支不传 operationId；create/appendInput 等分支有传递。部分 mutation 另有 expectedVersion/CAS 或幂等终态保护。应逐 endpoint 验证 timeout 后相同操作的 replay 约定，不能统一断言缺失 operationId 必然重复执行。

## 62. HTTP Logout 只销毁 Session，但已经建立的认证 WebSocket 不会被撤销

> 确认问题：auth logout destroySession，`websocket-server.ts` 只在 upgrade 验证认证状态，存活 ClientRecord 没有按 session revocation 清理。官方 UI 主动关闭自己的 socket 不能撤销另一持有同 session 的连接；未实测 logout 后 RPC。

`auth.routes.ts` 的 `/logout` 路径只执行：

```ts
await destroySession(request);
response.clearCookie(...);
```

而 `websocket-server.ts` 只在 upgrade 时通过 session middleware 验证一次身份。验证成功后，`userId` / `username` 会被复制进长期存活的 `WorkspaceProtocolSession`、`AgentProtocolSession`、Remote Desktop acceptor 等对象中；`ClientRecord` 本身也没有保存可用于按 session 或 user 定向撤销的身份信息。

当前 WebSocket server 只有用于 backup/restore、shutdown 等全局生命周期的 `drainClients()`，没有 logout 可调用的 session/user scoped revoke API。因此用户在 HTTP 上成功 logout 后，已经建立的 `/ws/workspace`、`/ws/uploads`、`/ws/remote-desktop`、`/ws/agent`、`/ws/agent-terminal` 连接仍然可以继续以 upgrade 时缓存的身份运行，直到客户端主动关闭、heartbeat 淘汰或服务端全局 drain。

结果是 logout 只阻止后续 HTTP 请求和新的 WebSocket upgrade，没有同步撤销已经授予的长期 capability。对于 Workspace shell/filesystem、Agent run/control、upload 或 remote desktop 这类长连接能力，认证生命周期和 session 生命周期实际发生了分离。

## 63. WebSocket Origin 校验无条件信任 `X-Forwarded-Host` / `X-Forwarded-Proto`，可被直连客户端自满足

> 确认问题（Origin 配置信任缺口）：`websocket-server.ts:117–127` 未先检查 proxy peer 即采信 forwarded host/proto。普通浏览器 WebSocket API 不能任意设置这些 headers，且 Origin 不能替代身份认证；不声称仅凭这点已能跨站盗用 cookie。

`websocket-server.ts` 对来源 IP 的处理有明确 trusted-proxy 边界：

```ts
const remote = request.socket.remoteAddress;
if (!isTrustedProxyAddress(remote)) return remote || 'unknown';
```

只有 TCP peer 属于 loopback/private/link-local/unique-local 时才读取 `X-Real-IP` / `X-Forwarded-For`。

但同文件的 `allowedOrigin()` 对 host/proto 没有相同的 trust gate：

```ts
const host = firstHeaderValue(request.headers['x-forwarded-host']) || firstHeaderValue(request.headers.host);
const protocol = firstHeaderValue(request.headers['x-forwarded-proto']) || ...;
if (host) allowed.add(new URL(`${protocol}://${host}`).origin);
```

因此一个直接连接 Backend 的非受信客户端可以自己发送：

```text
Origin: https://attacker.example
X-Forwarded-Host: attacker.example
X-Forwarded-Proto: https
```

让服务端把攻击者提供的 origin 动态加入 allowed set，再通过同一请求中的 `Origin` 校验。这里仍然需要请求携带有效 session credential，所以不能单独等同于账号接管；实际缺陷是 WebSocket same-origin / CSWSH 防线的 trusted-proxy 边界被绕开，转发头从代理提供的可信元数据变成了客户端自己定义 origin policy 的输入。

## 64. SSH channel callback 与 Transport teardown 的晚到回调防护待验证

> 待确认（底层 ssh2 回调保证）：adapter callbacks 没有 recheck open，而 bounded execute 有 settled guard；但 route close 后 ssh2 是否能回调成功并返回仍存活 channel，需要真实或可控 transport 测试。源码缺少本地 fence 不等于已证明 OS channel 泄漏。

startCommand/openShell 仅在发请求前 assertOpen，回调成功后未重新检查 open；bounded execute 则有 settled guard。需验证 ssh2 在 route teardown 与 callback 交错下是否能返回仍存活 channel；当前没有真实晚到 channel 泄漏复现。

## 65. Remote Archive 解压的部分失败展示与结果确认契约待确认

> 待确认（普通解压部分成功语义）：`remote-archive-operation.service.ts` 没有 staged tree swap；zip/tar 解压通常就允许部分结果。应核实错误提示和 unknown outcome 验证，而不是假定所有 archive API 都承诺事务回滚。

解压直接写目标目录，没有 staging tree swap 或回滚。一般 zip/tar 解压允许失败前已产生部分结果；待确认产品对 partial outcome 的提示、刷新和未知 writer 收敛是否充分，而非要求所有解压都事务化。

## 66. Audit Log 非原子 retention 在并发写入下可能过度裁剪历史

> 确认问题（可能过度裁剪）：`sqlite-audit-log.repository.ts:24–34` insert/count/delete 不在同一事务。并发相同 count 后的 DELETE 各自重新选最旧记录，会裁剪不同的额外旧行，不是“重复删除同一批已经删除的行”；未跑并发 retention 测试。

`SqliteAuditLogRepository.add()` 每次记录审计日志时依次执行：

```ts
await this.db.execute('INSERT INTO audit_logs ...');
const count = await this.db.queryOne('SELECT COUNT(*) AS total FROM audit_logs');
if (count > 50000) {
  await this.db.execute(
    'DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs ORDER BY timestamp ASC LIMIT ?)',
    [count - 50000],
  );
}
```

这三步没有放进 `RelationalDatabase.transaction()`。而 `DatabaseAdapter` 明确允许普通 shared operation 并发入队，只有 transaction 才会通过 exclusive scheduler barrier 保证 BEGIN/COMMIT 之间不被其它请求穿插。

因此在接近上限时，两个并发 `add()` 可以都完成 INSERT，再都看到同一个超限 count。例如两个请求都读到 50,002，各自都会删除 2 条最老记录，最终从 50,002 被裁到 49,998。并发度越高，重复裁剪越明显。

结果不是“最多略超 50,000”，而是会额外删除本来应该保留的审计历史。这里的 retention policy 目前只是 best effort，而不是数据库层能够成立的 50,000 条保留不变量。

## 67. Notification fan-out 同步串进认证关键路径，而且没有通道数量/并发上限；外部通知端点可同时放大认证延迟与出站连接数

> 确认问题（可用性耦合）：NotificationService await allSettled，Auth/2FA/Passkey 同步 await publish；channel 自有网络超时但没有总 fan-out admission。只在匹配且启用的通道存在时影响认证，具体延迟与吞吐未测。

`NotificationService.publish()` 的注释称其为 fire-and-observe，但实现实际会：

```ts
const results = await Promise.allSettled(
  applicable.map((setting) => this.channels.send(...)),
);
```

也就是等待所有启用通道完成后才返回。网络 adapter 中 Webhook timeout 为 15 秒，Telegram 为 10 秒；SMTP transport 没有在 Nexus 层设置一个同等级的短连接/命令 timeout。

这条 fan-out 还没有任何 capacity owner。`NotificationSettingsService.create()` 只做字段校验后直接插入新 setting，没有每 channel type、每 event 或全局数量上限；SQLite repository 的 `listEnabledFor()` 也是把全部 `enabled=1` 的 row 读回后再按 event 过滤。于是 `Promise.allSettled(applicable.map(...))` 不只是同步等待，它会一次性为**全部**匹配 setting 并发启动外部发送。认证用户可以持续创建新的 enabled notification setting，同一个事件随后就会同时建立 N 份 Webhook/Telegram/SMTP 工作，而不是进入有界队列。

认证服务又同步等待这个 publish：

- `AuthService.authenticatePassword()` 的成功和失败路径都会等待通知；
- `recordLoginSuccess()`、`recordLoginFailure()`、`recordLogout()`、`changePassword()` 都等待通知；
- `TwoFactorService.activate()/disable()/verifyLogin()` 会经过同一链条；
- Passkey 注册、认证成功/失败等路径也等待通知。

HTTP login 路由只有在 `authenticatePassword()` 返回后才执行 `regenerateSession()` 并返回成功响应；2FA 和 Passkey 登录同样是在通知完成后才完成新的认证 session。logout 则先销毁 session，再等待 logout notification 才返回。

因此只要管理员启用了一个慢或不可达的外部通知通道，认证相关请求就会把该通道的网络延迟直接暴露给用户；如果配置了大量匹配同一事件的通道，则同一条认证请求还会同步触发大量并发出站连接。Channel failure 最终因为 `allSettled` 不会反向回滚业务状态，但认证可用性、Backend 出站并发和外部 Webhook/Telegram/SMTP 的响应时间已经被绑定在同一个同步 critical path 上。

## 68. Authenticated Session reset 只保护了部分 load；旧会话 Mutation 的晚到响应可以在 logout / user-change 后重新污染前端缓存

> 确认问题（异步 session owner 缺口）：connections/proxies/tags/notifications mutation 在 await 后直接回填，没有对应 load generation 检查。保留 logout/login stale UI 风险；正常单用户产品不推定跨租户授权泄露，Backend 权限不会因 stale DTO 自动改变。

前端已经给 Connections、Proxies、Tags、Audit、Notifications、Preferences、Appearance 等很多 read/load 路径增加了 cache generation：session reset 后，旧 load 响应不会重新写回 store。这一层对读取竞态是有效的。

但同一批 store 的 mutation 并没有统一绑定 session/cache generation。例如：

- `connections.store.ts` 的 `refresh/create/update/clone` 在 API resolve 后直接 `upsert()`，`remove` 直接修改 `items`；
- `proxies.store.ts` 的 `create/update/remove` 在 await 后直接改当前数组；
- `tags.store.ts` 的 `create/rename/remove` 同样直接回填；
- `notifications.store.ts` 的 `save/remove` 没有 generation 检查。

`authenticatedSessionLifecycle` 在 logout/user-change 时会调用已注册 owner 的 `reset()`，但它并不会取消这些已经发出的 HTTP mutation。于是可以出现：

1. 用户 A 发出 create/update/delete；
2. 请求已经被 Backend 接收，但浏览器端尚未收到 response；
3. A logout 或切换到用户 B，store 被 reset；
4. A 的旧请求随后成功返回；
5. mutation continuation 直接把 A 的 DTO 再写进已经属于新 session 的 Pinia store。

结果是 session reset 不是完整的 async ownership boundary。即使已经修复了旧 load 回填，旧 mutation 仍能在账号切换后重新制造 stale/cross-session UI state，直到后续完整 reload 才被覆盖。

## 69. Command History / Path History 对 distinct value 无保留上限，GET 又始终返回整表，长期使用会让持久化和前端加载无界增长

> 确认问题（无分页读取／retention 边界）：两份 history repository 确实整表 SELECT，distinct value 无自动 prune。无界指缺少应用层条数上限，不是无限物理资源；实际规模和查询成本未基准测试。

`command_history` 与 `path_history` schema 都只有：

```text
id
command/path
timestamp
```

没有 retention limit。两个 repository 的 `upsert()` 只会在完全相同的 command/path 已存在时更新 timestamp；每个新的 distinct value 都会永久 INSERT 一行。

读取路径同样没有边界：

```sql
SELECT id, command, timestamp FROM command_history ORDER BY timestamp ASC
SELECT id, path, timestamp FROM path_history ORDER BY timestamp ASC
```

对应 HTTP GET 也没有 pagination、limit 或 server-side recent-window。

因此这不是单纯的表会“慢慢变大”：长期使用大量不同命令或路径后，每次打开相关 UI 都会进行整表排序、完整 JSON 序列化、网络传输和前端持有。数据库空间、查询成本、响应体和浏览器内存都会随历史唯一值数量持续线性增长。这个问题独立于 #37 的并发 duplicate row。

## 70. 同一 Session 只保留一个 Passkey ceremony challenge 是否符合产品预期

> 待确认（单 ceremony 设计）：`interfaces/http/auth/auth.routes.ts` 共享 currentChallenge/passkeyOrigin 成立，第二流程可让第一流程 fail-closed。是否要求并行 ceremony 支持属于产品契约，不能把拒绝旧 challenge 描述成认证绕过。

注册和认证共享 Session currentChallenge/passkeyOrigin。后发 ceremony 可覆盖前者并使旧 assertion fail-closed；这不是认证绕过。需确认是否支持同一 Session 多 Tab 并行 ceremony，以及是否值得引入 ceremony ID。

## 71. Terminal Theme preset 初始化只按 `name + preset` 查重，但数据库对 `name` 全局唯一；未来新增 preset 与既有用户主题同名时会直接阻断 Backend 启动

> 确认问题（升级兼容性条件）：`sqlite-terminal-theme.repository.ts` ensurePresets 与 schema UNIQUE(name) 不一致，initialize 被启动链 await。当前已有 preset 不构成冲突；必须有未来新增 preset 与既有 user theme 同名，未建立升级数据库测试。

`terminal_themes.name` 有全局 `UNIQUE` 约束，user theme 和 preset theme 共用同一个名称空间。

但 `SqliteTerminalThemeRepository.ensurePresets()` 的存在检查是：

```sql
SELECT id
FROM terminal_themes
WHERE name = ? AND theme_type = 'preset'
```

如果数据库中已经存在同名的 `theme_type='user'` 记录，这个查询会返回空，然后初始化继续执行同名 preset 的 `INSERT`，最终命中 `UNIQUE(name)`。

触发条件在升级场景中是现实存在的：当前版本允许用户创建任意未被当前 preset 占用的名称；以后版本只要新增一个同名 preset，旧数据库就会进入冲突状态。

这个异常位于正常启动链上：`BackendApplication.start()` 先 `await services.initialize()`，而 `services.initialize()` 会 `await terminalThemes.initialize(presetTerminalThemes)`，完成后才执行 HTTP `listen()`。因此名称冲突不是“缺少一个新主题”这么轻，而是会让升级后的 Backend 在监听端口前直接启动失败。

## 72. File Manager 批量删除的部分失败契约待确认

> 待确认（批量删除失败展示）：WorkspaceFilesystemService 顺序删除且不回滚属实，但批量文件删除通常不承诺 all-or-nothing。需确认 UI 是否刷新并展示逐项成功／失败，保留的是 partial outcome 契约疑问，不直接要求删除事务化。

removePaths 在 guard 内顺序删除；后项失败不会恢复前项。待确认 UI 对逐项结果和目录刷新是否明确，不能从“一个批量请求”推出已承诺 all-or-nothing。

## 73. Full Backup 可以成功导出超过自身 Import 接口上限的文件，形成“可导出、不可恢复”的备份

> 确认问题（round-trip 上限不一致）：Settings route multer import=100MiB，export 没有对应上限，快照包含合法大型 Artifact/Plugin 数据。无需断言所有大状态都成功导出（另有 #81）；未创建大备份测试。

`settings.routes.ts` 的完整备份导出没有设置输出大小上限：`POST /backup/export` 会等待 `backup.exportFull()` 返回完整 `Uint8Array`，随后直接 `response.send(Buffer.from(bytes))`。

同一个 Router 的导入路径却固定使用：

```ts
multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
```

也就是任何超过 100 MiB 的 `.nexus-backup` 都会在到达 `BackupService.importFull()` 前被拒绝。

而 Snapshot 本身允许远大于这个量级的合法产品状态。`SqliteBackupSnapshotAdapter` 会把以下目录全部纳入 Full Backup：

```text
background
custom_html_theme
agent/artifacts/objects
agent/plugins
```

其中 Agent 默认 `maxGlobalArtifactBytes` 已经是 2 GiB，hard limit 是 10 GiB。文件内容还先在 snapshot 中变成 `contentBase64`，整个 snapshot JSON 加密后，ciphertext 又被 base64 放进 envelope。仅文件正文部分就会经历两次约 4/3 的编码膨胀，尚未计算 JSON、数据库表和 envelope 开销。

因此 Nexus 当前可以在完全合法的存储配额内生成一个导出成功的备份，但这个备份随后无法通过产品自己的 `/backup/import` 恢复。这里破坏的是 backup round-trip contract，而不只是“大文件上传体验不好”。

## 74. Backup capture 把完整文件树读取放在 SQLite exclusive transaction 内；大备份会阻塞所有普通数据库操作

> 确认问题（全局 DB scheduler barrier）：snapshot capture 在 transaction 内 await 文件扫描，DatabaseAdapter scheduleExclusive 不允许 shared 操作穿插。确认阻塞结构，不声称已测具体时间；也不是 SQLite OS 级 exclusive lock 模式的断言。

`SqliteBackupSnapshotAdapter.capture()` 的结构是：

```ts
return this.database.transaction(async (database) => {
  // capture tables
  const files = await this.captureStableFiles();
  return ...;
});
```

`captureStableFiles()` 不只是读取少量 metadata。它会递归扫描 Backup 的所有文件目录，对每个文件 `readFile()`，把完整内容转成 base64，并在文件树变化时重新尝试 inventory/snapshot。

这里使用的 `DatabaseAdapter.transaction()` 又明确通过 `scheduleExclusive()` 建立 exclusive scheduler barrier；从 `BEGIN` 到 `COMMIT/ROLLBACK` 期间，普通 `queryOne/queryAll/execute` 的 shared operation 都不能穿插。

所以一次 Full Backup 的 SQLite transaction 持有时间取决于整个 artifact/plugin/background 文件树的磁盘读取时间。文件越多、越大或存储越慢，登录、设置读取、连接 CRUD、Agent durable state、审计等所有依赖同一个数据库 adapter 的请求都会在 barrier 后排队。

这个问题和 #24 的跨存储一致性疑问不同：#24 尚需并发 writer 验证；这里可从 scheduler barrier 确认数据库请求会等待文件 I/O，实际等待时长仍需测量。

## 75. Server Transfer 请求没有数组上限或去重，单个小于 1 MiB 的请求可以同步展开数千万个 SubTask

> 确认问题（乘积放大）：transfers route/service 无 cardinality/dedup，TransferTaskRegistry 同步展开 connectionIds×sourceItems。1MiB body 上限和后续 worker concurrency 都不约束乘积；数量例子为计算而非发起实际内存攻击。

`transfers.routes.ts` 只验证 `connectionIds` / `sourceItems` 是数组并检查元素类型；`TransfersService.validate()` 也只验证非空和单个值是否合法，没有长度上限或去重。

随后 `TransferTaskRegistry.create()` 在返回 HTTP 202 之前同步执行笛卡尔积：

```ts
for (const connectionId of payload.connectionIds)
  for (const item of payload.sourceItems)
    subTasks.push({ subTaskId: randomUUID(), ... });
```

根 HTTP JSON body 的确有 1 MiB 上限，但这个上限并不能约束展开后的对象数量。按当前 JSON 结构，5,000 个重复 connection id 加 5,000 个最短合法 source item 的请求体约 200 KiB，却会立即尝试创建 25,000,000 个 `TransferSubTask` 和同量 UUID。

`TransferOrchestratorService` 的并发限制只约束后续实际传输，不会限制 `create()` 前的同步分配。因此一个已认证请求就能在进入 bounded execution 之前制造巨大的 CPU/heap 放大，严重时可阻塞 event loop 或触发进程 OOM。

## 76. Server Transfer 的 terminal task 只靠用户手工删除；Backend Map 和 `/status` 响应会随进程生命周期持续增长

> 确认问题（进程内 history retention）：tasks Map 保留 terminal record，releaseCancellation 只删 controller，status 全量返回。显式删除和重启可回收，不能称跨重启永久泄漏；负载未测。

`TransferTaskRegistry` 把所有任务保存在：

```ts
private readonly tasks = new Map<string, TransferTask>();
```

任务进入 `completed` / `failed` / `partially-completed` / `cancelled` 后，orchestrator 只会 `releaseCancellation()` 删除 `AbortController`；`TransferTask` 本身仍留在 `tasks` Map。唯一删除入口是显式 `DELETE /transfers/:taskId` 调用 `tasks.remove()`。

前端 `ProgressDisplayModal.vue` 对 terminal Server Transfer 也只是显示一个“Remove”按钮，没有后台 retention、TTL 或自动 prune。`GET /transfers/status` 则每次把该用户全部 task clone 并完整序列化，包括 payload 和全部 subtasks，没有 pagination 或 recent-window。

因此只要用户长期运行 Server Transfer 而不逐条点击删除，Backend heap 中的任务、每个任务的 subtasks，以及 `/status` 的 JSON 响应都会单调增长到进程重启。这和 #69 的数据库历史表无界增长不同；这里是生产进程内存和轮询响应体的无界 retention。

## 77. 修改密码只更新 Password Hash，不会撤销其它已认证 HTTP Session；泄露 Cookie 在改密后仍然有效

> 确认问题（credential rotation revocation 缺口）：AuthService changePassword 与认证 middleware/file session adapter 未维护 user credential revision 或按用户 revoke。必须已有有效 cookie；不是新密码校验被绕过，未做双浏览器验证。

`AuthService.changePassword()` 成功路径只执行：

1. 校验当前密码；
2. `users.updatePassword()` 写入新 hash；
3. Audit / Notification。

`PUT /auth/password` 返回成功后没有 `regenerateSession()`，也没有按 user id 清理其它 session。`requireAuthenticated` 后续只检查当前 session 中已有的 `userId`、`username` 和 `requiresTwoFactor`，不会重新校验密码版本或 credential revision。

当前 File session store TTL 是 30 天，remember-me cookie 的 max age 同样是 30 天。登录、2FA 和 Passkey 成功时已有 session regeneration，说明新认证会换 session id；但密码轮换没有相应的 user-scoped invalidation owner。

因此如果攻击者在改密前已经复制了一个有效 `nexus.sid`，账户所有者即使成功修改密码，该旧 session 仍能继续访问受 `requireAuthenticated` 保护的 HTTP API，直到 session 自然过期、被单独 logout 或整个 session store 被清空。这个问题独立于 #62：#62 是 logout 后既有 WebSocket 继续存活；这里是 credential rotation 后其它 HTTP session 本身仍保持认证状态。

## 78. Quick Command 创建标签与关联失败的部分成功提示待确认

> 待确认（有显式部分成功结果）：quickCommands.store 的 createTagForCommands 分两次请求，但 catch 返回 assigned:false，标签本身也是合法可独立存在实体且可手工删除。需检查 UI 是否提示“标签已创建但关联失败”；不能把空标签直接定为数据损坏或不可回收。

createTagForCommands 先 addTag 再 assignTag，失败返回 assigned:false；tag 是合法独立实体，可手工删除。需要验证 UI 是否如实展示标签创建成功但关联失败，及重试能否使用已有 tag；不再称空标签永久不可回收。

## 79. File Preview 的大小上限和取消只存在于前端包装层；真正的 Binary Transport 既不限制总字节数，也无法取消服务端读取

> 确认问题：`runtimes/workspace/adapters/capabilityAdapters.ts` 先 stat 再无 maxBytes 的 requestBinary，Abort 包装未向服务端取消；frame/backpressure/request timeout 是已有保护但不是累计 byte ceiling。未运行 stat/read 文件增长或取消负载测试。

`previewRegistry.ts` 给不同预览类型定义了明确的 inline 上限：Markdown 2 MiB、Spreadsheet 10 MiB、Image/PDF/DOCX 20 MiB、Database 64 MiB。

但 `createFilePreviewSource()` 并没有把这个上限传入真正的读请求。它只是先做一次：

```ts
const entry = await socket.request('filesystem.stat', { path });
if (entry.metadata.size > options.maxBytes) return { tooLarge: true, ... };
```

通过后又单独执行：

```ts
socket.requestBinary('filesystem.readBinary', { path });
```

`filesystem.readBinary` 的协议请求本身只有 `path`。Backend `filesystemReadBinary()` 直接 `openBinaryRead()`，而 `sendBinaryResponse()` 会一直消费整个 stream，只做 frame 大小和 WebSocket backpressure 控制，没有累计 byte ceiling。

这意味着 `stat` 与真正打开文件之间存在大小 TOCTOU：远端文件在 `stat` 后变大，或者远端文件系统返回的 metadata 与后续 stream 不一致时，所谓 preview size limit 就会失效。前端 `WorkspaceSocket` 还会把每个 binary frame `slice()` 后全部保存在 `binaryChunks`，结束时再分配一个总长度 `Uint8Array` 复制一次，因此超限读取会直接扩大浏览器 heap 占用。

取消也没有真正进入 transport owner。`racePreviewAbort()` 只让调用方 Promise 先以 `AbortError` 拒绝；它既不从 `WorkspaceSocket.pending` 删除 request，也不向 Backend 发送 cancel。用户关闭正在加载的 Preview 后，原 `requestBinary()` 仍会继续接收并缓存数据，直到完整响应结束或 30 秒 request timeout。Backend 在此期间也继续读取并发送同一个远端文件。

所以当前的“预览大小限制”和“关闭即取消”都是 UI 层语义，无法约束真正消耗网络、SFTP、Backend 和 Browser 内存的 binary operation。

## 80. File Editor 对远端文件读取完全没有大小上限；Large File Mode 在完整下载和解码之后才生效

> 确认问题：document adapter 先完整 binary read/decode，FileEditor 字符阈值仅作用于渲染。request timeout 与 frame size 有限，不等价文件总字节限制；未实际打开超大远程文件。

File Editor 的 document port 直接执行：

```ts
const file = await filesystem.readBinary(path);
const decoded = await decodeEditorDocument(file.bytes, encoding);
```

这里没有 `stat`、`maxBytes`、range 或 streaming decode。`FilesystemChannel.readBinary()` 又复用 #79 的完整 `filesystem.readBinary`，所以 Editor 会先把整个远端文件经过 Backend/WebSocket 读入浏览器，再把完整 `Uint8Array` 解码成 JS string。

`FileEditor.vue` 虽然存在 `LARGE_FILE_CHARACTER_THRESHOLD = 2 * 1024 * 1024`，并会给 Monaco/CodeMirror 打开 large-file optimization，但这个判断依赖已经生成的 `doc.content`。也就是说它只能减少编辑器渲染功能，无法限制前面已经发生的远端读取、binary chunk 缓存、最终 buffer 合并和文本解码。

触发路径也没有文件类型或大小保护：`WorkspaceSessionSurface.openFile()` 对不支持 Preview 的扩展名直接进入 Editor，`openFileAsText()` 还允许用户显式把任意文件按文本打开。

因此一个很大的日志、dump、数据库、归档或其它远端文件只要走“按文本打开”，就会完整进入浏览器内存；`WorkspaceSocket` 在组装 binary response 时还会同时持有 chunk copies 和最终连续 buffer。结果可以是明显的 UI freeze、内存峰值或 tab OOM，而现有 Large File Mode 无法保护这段资源路径。

## 81. Full Backup 把整份快照物化成单个 JS 字符串；默认合法 Artifact 状态即可超过 Node 字符串上限而无法导出

> 确认问题（表示规模上限）：snapshot contentBase64 + backup-codec JSON.stringify 均非 streaming。Node/V8 MAX_STRING_LENGTH 随运行时／平台变化，以下数值是特定运行时举例，不是所有部署固定值；未分配大型快照复现 OOM。

`SqliteBackupSnapshotAdapter.captureStableFiles()` 会逐个 `readFile()`，然后把每个文件完整转换成 `contentBase64`，并一直保存在 `BackupSnapshot.files` 数组中。之后 `NexusBackupCodecAdapter.encode()` 又要求整份快照先经过：

```ts
const snapshotJson = JSON.stringify(snapshot);
const payload = encrypt(Buffer.from(snapshotJson, 'utf8'), dataKey);
```

加密后还会把整个 ciphertext 再转成 base64，构造 envelope，再执行一次 `JSON.stringify(envelope)`。因此 export 不是 streaming format，而是要求整份备份至少两次成为单个大型 JavaScript string。

以原分析使用的 Node v22.23.1 为例，其 `buffer.constants.MAX_STRING_LENGTH` 是 536,870,888。Agent 默认存储限制允许 `maxSingleArtifactBytes = 52,428,800`（50 MiB）且 `maxGlobalArtifactBytes = 2,147,483,648`（2 GiB）；Artifact Store 也按这些限制接受合法 artifact。8 个 50 MiB artifact 只有 400 MiB 原始数据，但仅第一层文件 base64 就约 559 MiB 字符，已经超过这个 Node 单字符串上限，还没有计算 snapshot 的其它表、文件和 JSON 结构开销。

所以当前产品允许形成一种完全合法、仍远低于默认 2 GiB global quota 的 durable state，却无法由自身 Full Backup export 表示。实际失败点可以发生在 `JSON.stringify(snapshot)`，更大状态还会在 ciphertext base64 / envelope stringify 阶段再次触发同类限制或极高瞬时内存占用。

这个问题和 #73 不同：#73 是“能够成功导出的文件可能超过 import 100 MiB 上限”；这里是 export 自己在合法状态下就会因为 V8/Node 单字符串表示上限失败。

## 82. Quick Command 批量打标签不限制或去重 `commandIds`；一个 1 MiB 请求可在全局排他 SQLite transaction 内制造数十万次串行 SQL

> 确认问题（数据库工作量放大）：bulk route 未限数量，sqlite-quick-command-tag.repository 在 exclusive transaction 内对每项执行 INSERT OR IGNORE；重复 ID 仍产生 SQL/RPC。数量为估算，未执行大批量请求。

`POST /quick-commands/bulk-assign-tag` 只要求 `commandIds` 是非空整数数组，没有长度上限，也没有去重。`QuickCommandService.assignTag()` / `QuickCommandTagService.addTagToCommands()` 原样把数组交给 repository。

`SqliteQuickCommandTagRepository.addTagToCommands()` 随后执行：

```ts
return this.db.transaction(async (tx) => {
  for (const commandId of commandIds)
    await tx.execute('INSERT OR IGNORE INTO quick_command_tag_associations ...', [commandId, tagId]);
});
```

重复 ID 不会被提前消掉；`INSERT OR IGNORE` 只让数据库忽略重复写入，但每一个数组元素仍对应一次 worker RPC 和一次 SQLite statement。根 HTTP JSON body 虽限制为 1 MiB，但重复一个短整数时，数十万项仍可装进该请求体。

更关键的是 `DatabaseAdapter.transaction()` 使用 exclusive scheduler barrier，注释和实现都明确保证 BEGIN 到 COMMIT/ROLLBACK 之间没有其它数据库操作穿插。因此一个已认证请求可以用大量重复 `commandIds` 把几乎全部 SQL 变成 no-op，却在很长时间内占住全局数据库排他区，阻塞认证、设置、审计、Workspace durable state 和其它 CRUD。

这和 #75 的 Transfer 笛卡尔积不同：这里没有巨大对象展开，放大点是“输入数组长度 → 全局排他事务内串行数据库 RPC 数量”。

## 83. SSH Suspend 没有会话数量上限或 suspended TTL；用户可以持续积累 live SSH transport、shell 和每会话日志

> 确认问题（live resource admission）：SshSuspendService session Map 无 count/age quota；owner lease/sweep 不等价 suspended session TTL，单 log 有字节限制。显式 terminate、远端断开和 shutdown 可回收，未做容量压测。

`SshSuspendService` 的核心状态是：

```ts
private readonly sessions = new Map<number, Map<string, SuspendedSessionRecord>>();
```

`takeOver()` 每次生成新的 UUID，并把仍然打开的 `transport`、`shell`、checkpoint 和 log metadata 放入用户 Map。构造参数只有 owner lease / takeover wait / sweep interval；owner lease 只管理“谁拥有会话”，没有限制 suspended session 数量，也没有按挂起时长自动 terminate。

上游普通 Workspace 同样没有形成容量边界。`WorkspaceSessionRegistry.set()` 只检查 workspace id 是否重复，`WorkspaceService.canCreate()` 也只检查该 id 当前不存在。Agent 的 `maxActiveWorkspaces` 属于 Agent Workspace Runtime，不约束普通 Workspace WebSocket SSH session。

因此用户可以反复执行“新建 Workspace SSH → suspend → 再新建另一个 Workspace”。Suspend handoff 会从 Workspace registry detach transport，再交给 `SshSuspendService.takeOver()` 持有，旧 transport/shell 不会因为新 Workspace 创建而释放。

这不是只增长几个 JS 对象。每条记录持有真实 SSH transport / shell、对应文件描述符和远端 SSH session；`LocalSuspendedSessionLogAdapter` 还允许每个 log 保留 100 MiB，compaction 前物理文件可再多一个 32 MiB batch。没有数量上限或 age-based retention 时，一个用户可以让这些进程级、远端和磁盘资源随挂起次数持续增长，直到逐条 terminate、远端主动断开或 Backend 重启。

## 84. Plugin Backend close() 在 SIGTERM 后不等待退出或升级终止

> 确认问题：`local-plugin-backend-runtime.adapter.ts:409–415` 在 dispose/drain 后仅 kill(SIGTERM)，不 await exit 或升级 kill；上层随后删实例。这里只指 kill 之后不等待，不是整个 close 从开始立即返回；需要插件不退出才形成 orphan。

`BackendPluginProcess.close()` 的收尾逻辑是：

```ts
this.closing = true;
await this.request('lifecycle.dispose').catch(() => undefined);
await Promise.allSettled([...this.activeHostOperations]);
this.child.kill('SIGTERM');
```

它没有等待 `child` 的 `exit`/`close`，没有检查 `kill()` 返回值，也没有“SIGTERM 后超时 → SIGKILL”的最终收敛步骤。

上层 `LocalPluginBackendRuntimeAdapter.reconcileUser()` 在 `await instance.close()` 返回后立刻 `instances.delete(key)`；`activate()` 遇到 unhealthy instance 也是 close → delete → `start()` 新进程。也就是说 Host 的“已关闭”判定绑定的是“已经发送 SIGTERM”，而不是“OS process 已退出”。

插件代码运行在独立 Node process 中，可以拥有自己的 event-loop handle，也可以安装 signal handler。只要一个故障或非合作插件在 SIGTERM 后不退出，旧进程就会脱离 `instances` owner；随后 reconcile/activate 可以再启动同一 scope/version 的新进程。重复这一过程会留下多个 Host 已不可寻址的 orphan plugin process，继续占 CPU、内存和只读 plugin filesystem 资源。

当前 protocol 对消息大小、host operation 并发和 request timeout 都有明确上限，但 process lifetime 的最终 owner 没有同等的 kill-and-reap 保证。

## 85. IP blacklist 没有任何过期行清理；匿名失败登录可让持久化 IP 基数永久增长

> 确认问题（持久化 retention）：IpBlacklistService/repository 无过期行自动 sweep；成功登录 reset 和管理删除仍可回收。新来源 IP 的可获得性与 proxy trust 影响实际增长，未模拟大量来源。

`IpBlacklistService.recordFailedAttempt()` 对每个非本机来源 IP 都会读取现有记录并 `upsert()`：第一次失败就会创建一行。`blockedUntil` 到期后，`isBlocked()` 只是返回 `false`：

```ts
return Boolean(e?.blockedUntil && e.blockedUntil > now);
```

没有任何代码在封禁到期后删除该行，也没有按 `lastAttemptAt` 做 TTL / retention sweep。只有该 IP 后续成功登录时 `resetAttempts(ip)`，或者管理员显式删除，记录才会消失。

登录路由在 password、2FA、Passkey 和 CAPTCHA 失败路径都会调用 `recordFailedAttempt(requestIp)`。因此不需要已认证身份：持续从新的真实来源 IP 发起失败登录，就可以让 `ip_blacklist` 表按来源基数永久增长；封禁过期并不会回收空间或减少行数。

管理接口又允许任意正整数 `limit`，没有最大 page size，repository 直接执行 `SELECT ... LIMIT ? OFFSET ?` 并同时 `COUNT(*)`。所以长期累积后，不仅每次登录都要面对更大的持久化状态，已认证管理请求还可以一次读取和 JSON 序列化非常大的 blacklist page。

这个问题和 #29/#30 不重复：#29 是过期 `blockedUntil` 导致同 IP 无法再次正确封禁，#30 是并发失败计数 lost update；这里是不同 IP 维度的持久化 retention 缺失。

## 86. Connection Tag 的“替换全部关联”接口不验证目标 Tag，也不去重/校验正 ID；同一 API 对非法输入会返回假成功或 500

> 确认问题（API validation/error 契约）：TagService/repository 无 target precheck，重复项触发 composite PK，无效项触发 FK；transaction 本身会回滚，不能说失败会丢旧关联。未发送无效请求验证具体 HTTP 状态映射。

`PUT /tags/:id/connections` 只检查 path 中 `id` 为正整数，并检查 `connectionIds` 是“整数数组”。它不会先确认 tag 存在，也不要求 connection id 为正数，更不做去重。

`TagService.setConnections()` 没有补充 domain validation，直接进入 `SqliteTagRepository.setConnections()`：

```ts
await tx.execute('DELETE FROM connection_tags WHERE tag_id=?', [tagId]);
for (const connectionId of connectionIds)
  await tx.execute('INSERT INTO connection_tags (tag_id,connection_id) VALUES (?,?)', [tagId, connectionId]);
```

而 `connection_tags` 的 `(connection_id, tag_id)` 是 PRIMARY KEY，两列又分别有 FK。

因此同一个 endpoint 存在几种确定性不一致：不存在的 `tagId` 配空数组时 DELETE 影响 0 行但 transaction 正常提交，API 返回“关联更新成功”；不存在的 tag 配非空数组、负 connection id、或合法 connection id 重复两次时，则会触发 FK / PRIMARY KEY constraint，整次请求变成 500。

同一逻辑操作没有稳定的“目标不存在/输入非法”契约，而把数据库 constraint error 暴露成通用服务端错误。并且数组没有长度上限，合法唯一 ID 很多时仍会在 exclusive transaction 内逐条 INSERT；不过这里的核心 correctness defect 是 target existence 和输入规范没有在 owner boundary 被建立。

## 87. Artifact cleanup preview 可以生成超过 confirm 自身硬上限的 confirmation；超过 10,000 个可回收 Artifact 后清理流程必然无法执行

> 确认问题：`infrastructure/agent/artifacts/local-artifact-store.ts:600` preview 无 LIMIT，而 `:160–162` decoder 拒绝 >10,000。只限定这条全量 preview/confirm 流程，单项删除／其他管理手段不能据此说全部失效；未插入一万条 Artifact 测试。

`LocalArtifactStore.cleanupPreview()` 会一次查询当前用户全部可回收的 `ready` Artifact，没有 `LIMIT`，随后把完整 selection 序列化进 durable confirmation：

```ts
const rows = await this.db.queryAll<ArtifactRow>(/* all reclaimable rows */);
const selection = rows.map(/* ... */);
await tx.execute(
  `INSERT INTO agent_artifact_cleanup_confirmations
   (id, user_id, selection_json, created_at, expires_at)
   VALUES (?, ?, ?, ?, ?)`,
  [confirmationId, userId, JSON.stringify(selection), now, expiresAt],
);
```

但 `cleanupConfirm()` 读取同一条 `selection_json` 后会先经过：

```ts
const decodeCleanupSelection = (raw: string): CleanupSelectionItem[] => {
  const value = parseDurableJson(raw);
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('CLEANUP_CONFIRMATION_INVALID');
  // ...
};
```

因此只要用户拥有超过 10,000 个当前可回收 Artifact，preview 仍会正常创建 confirmation、返回 `confirmationId` 和 `selectedCount > 10000`，但这个由系统自己签发的 confirmation 在 confirm 阶段必然被判为 `CLEANUP_CONFIRMATION_INVALID`，用户无法通过同一产品流程完成清理。

这里没有其它总数量边界能保证 selection 不超过 10,000。Artifact 只限制单文件/总字节 quota 和每用户同时 staging 数量；`declaredBytes = 0` 本身合法，小文件/零字节 Artifact 可以长期把对象数量推到这个阈值以上。Library 的分页上限也只限制读取页大小，不限制 durable Artifact 总数。

此外 preview 在达到阈值前已经无界加载全部候选行并构造完整 JSON；confirm 对最多 10,000 项又在一个 transaction 内逐项查询保护状态并更新。因此这个缺陷同时把“无法确认”的 correctness 问题和大 selection 的 DB/heap 放大绑定在了同一条清理路径上。

## 88. SSH Jump Chain 的 `forwardOut()` 不受 connect timeout 或 AbortSignal 控制；“15 秒连接测试”和 Agent deadline 都可以无限挂在跳板通道打开阶段

> 确认问题（channel-open deadline 缺口）：`ssh-jump.connector.ts:5–7,58` await forward 无 timer/signal；握手 connectSshClient ready 后移除 listener。挂起取决于 SSH peer 保持连接且不应答 channel-open，未构造该远端服务器。

`connectViaJumpChain()` 给每一跳 SSH 握手都传入了 `timeoutMs` 和 `signal`，但一旦某一跳进入 ready 状态，下一步建立 TCP forwarding 时调用的是：

```ts
const forward = (client: Client, host: string, port: number): Promise<ClientChannel> =>
  new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
```

随后：

```ts
previousStream = await forward(connected.client, next.host, next.port);
```

这里没有 timer，也没有监听 `AbortSignal`。而 `connectSshClient()` 在 client 发出 `ready` 并 resolve 后会执行 `cleanup()`，把自己的 abort listener 移除；因此进入 `forwardOut()` 后，上层 signal 再 abort 不会替这次 pending channel-open 关闭已连接的 jump client。

`createConnectConfig(..., timeoutMs)` 的 `readyTimeout` 只约束 SSH client 进入 ready 之前的握手，不能覆盖已经 ready 之后的 `forwardOut()`。所以一个能建立 SSH 连接但一直不回应 channel-open 的 jump host，可以让这条 Promise 长期不 settle，同时中间 `SshClientRoute` 还没有返回给调用方，外层也没有 transport handle 可主动 close。

这个缺陷会直接破坏已经公开使用的 timeout/deadline 语义。`SshConnectionTestService` 明确调用：

```ts
const TEST_TIMEOUT_MS = 15_000;
await this.transports.connect(connection, { timeoutMs: TEST_TIMEOUT_MS });
```

但 jump route 卡在 `forwardOut()` 时，这个“15 秒连接测试”仍然可以无限等待。Agent SSH capability 传入的 deadline-derived `AbortSignal` 同样只能取消握手阶段，不能取消已连接 jump hop 的 forwarding 阶段，因此 Run 取消/超时也可能被这个 pending connect 拖住。

## 89. Agent Browser session 没有按 Run 生命周期回收；Run 结束后旧 session 又被 run binding 禁止关闭，Standalone Browser 资源只能等 Backend shutdown

> 确认问题：BrowserRuntimeAdapter session Map 仅 workspace/global cleanup，tool authority 绑定 run/runtime；Run terminal 没有 closeRun。只针对未显式 close 的 standalone session，浏览器远端自行断开等也可终止底层资源；未跑完整 Run handoff。

`BrowserRuntimeAdapter` 用一个进程级 Map 持有所有活跃 Browser session：

```ts
private readonly sessions = new Map<string, ActiveBrowserSession>();
```

每次 `browser_create_session` 都会建立真实 transport、Puppeteer Browser connection、独立 `BrowserContext`、Page 和 CDP session，然后直接插入该 Map：

```ts
const active: ActiveBrowserSession = {
  request,
  target,
  transport,
  browser,
  context,
  page,
  cdp,
  // ...
};
this.sessions.set(sessionId, active);
```

这里没有 per-Run/per-user/global session 数量上限，也没有 idle TTL。Adapter 提供的自动批量回收只有 `closeWorkspace(workspaceId, generation?)` 和进程级 `closeAll()`；Bootstrap 只在 Workspace generation 生命周期变化时调用前者，在 Agent/Backend 整体 dispose 时调用后者。全工程没有 `closeRun(runId)` 或等价的 Run terminal cleanup。

更关键的是，Tool 层把 session 严格绑定到创建它的 Run：

```ts
if (
  session.userId !== context.userId ||
  session.appId !== context.appId ||
  session.runId !== context.runId ||
  session.agentRuntimeId !== context.agentRuntimeId
) {
  throw new Error('RESOURCE_FORBIDDEN');
}
```

`browser_close` 在 inspect 和 execute 两个阶段都先调用这个 `authority.session(...)`。因此一个 Run 调用 `browser_create_session` 后如果没有在自己终止前显式执行 `browser_close`，后续 Run 即使知道 `sessionId` 也没有产品内关闭它的权限。

对 standalone Browser target，这个 session 又没有 Workspace 生命周期可触发 `closeWorkspace()`。所以触发链是确定的：Run 创建 standalone browser session → Run 正常完成/取消/失败而未显式 close → session 留在进程 Map → 后续 Run 无法 close → BrowserContext/Page/CDP/transport 持续存活，直到 Backend 整体 shutdown 的 `browserGateway.closeAll()`。

连续执行这种 Run 可以持续累积真实浏览器资源和远端 CDP connection。这和普通“遗漏 close 的调用方责任”不同：生命周期 authority 本身让创建 Run 结束后不存在任何可达的细粒度回收入口。

## 91. Runner Plugin 的 ready handshake 没有 timeout；第三方模块在发送 `runtime.ready` 前卡住时，Workspace lifecycle command 和 Runner startup reconcile 都会永久挂起

> 确认问题：plugin-runner-runtime ready 无 timer，worker import 在发 ready 前，controller/reconciler await activate。需 child 保持存活且 import 不 settle；普通抛错／退出会 reject，不能说任何坏插件都会永久挂住。

`PluginRunnerRuntime.activateWorkspace()` 启动子进程后先等待：

```ts
const instance = this.start(workspace, target);
this.instances.set(key, instance);
await instance.ready;
await instance.request('lifecycle.activate');
```

后面的 `request()` 有 30 秒 timer，但 `instance.ready` 本身只是普通 Promise，没有 timer：

```ts
readonly ready = new Promise<void>((resolve, reject) => {
  this.readyResolve = resolve;
  this.readyReject = reject;
});
```

它只有收到 `runtime.ready` 才 resolve，或 child error/exit/protocol failure 才 reject。

而 worker 并不是先完成 handshake 再加载插件。`plugin-runner.worker.ts` 的顺序是：

```ts
const imported = await import(pathToFileURL(entryPath).href);
// ...build lifecycle...
await writePluginFrame(
  process.stdout,
  encodePluginJsonFrame(0, { kind: 'runtime.ready', ... }),
);
```

因此第三方 Runner Plugin 只要在模块顶层出现一个永不 settle 的 await、等待永不返回的初始化 Promise，或其它“进程仍活着但 import 不完成”的状态，worker 就永远不会发送 `runtime.ready`，父进程也不会触发 child exit/error 来打破 `instance.ready`。

这会直接卡住 Workspace lifecycle：`workspaceAction(start/restart)` 在 `runtimeEngine.start/restart()` 后同步 `await pluginRunner.activateWorkspace(workspace)`，所以 journal command 会一直停留在 `running`。虽然 command payload 带 `deadlineAt`，Server 只在接收时验证它仍在未来，并没有在 `executeWorkspaceCommand()` / `workspaceAction()` 中把该 deadline 转成 timeout 或 AbortSignal。

同一缺陷还进入启动恢复路径：`Reconciler` 对原先为 running 的 Workspace 会 `await pluginRunner.activateWorkspace(reconciled)`。所以一个已安装且被某 Workspace 引用的卡死插件，不仅能挂住一次 start，还可能让 Agent Runner 下一次启动 reconcile 永远无法完成到正常服务状态。

`RunnerPluginProcess.close()` 和 managed-process SIGTERM→SIGKILL 机制不能主动解决这个状态，因为只有调用方从 `await instance.ready` 返回后才能进入对应补偿路径。

## 92. SSH Resource Status 的 host 级采样状态不会随 Connection 生命周期失效；历史 host:port 会永久留在内存，同 key 重用时还会复用旧机器静态信息

> 确认问题：ssh-resource-status clearCache 只清 cache，未清 bootstrappedKeys 或 collector 的静态／采样 Map；Connection lifecycle 未调用 collector.clear。保留跨 host 重用 stale state，未实际替换远端机器验证。

`SshResourceStatusService` 实际维护了三层 host 状态：自身的 `cache`、`inFlight`、`bootstrappedKeys`，以及注入的 `PosixServerStatusCollector` 内部按 key 保存的 `previousCpu`、`previousNet`、`staticInfo`。

但它公开的失效入口只有：

```ts
clearCache() {
  this.cache.clear();
}
```

这里既不清 `bootstrappedKeys`，也没有调用 collector 已经提供的：

```ts
clear(key: string) {
  this.previousCpu.delete(key);
  this.previousNet.delete(key);
  this.staticInfo.delete(key);
}
```

当前 Connection 的 `PUT /:id` / `DELETE /:id` 路径也只是更新或删除 Connection durable row，没有通知 `SshResourceStatusService` 旧 host key 已经退出生命周期；全仓对 `sshResourceStatus.clearCache()` 的调用只出现在 backup restore / E2E reset，而且即使走到这里也只清第一层 cache。

触发链因此是确定的：Connection 曾经采样 `old.example:22` → 用户删除该连接或把 host/port 改到别处 → `bootstrappedKeys` 和 collector 三个 Map 仍保留旧 key。用户持续创建/修改不同 host 后，这些历史 key 没有 TTL、数量上限或生命周期删除，会一直增长到 Backend 重启。

这不只是小型 Map 泄漏。`PosixServerStatusCollector.collect()` 只有 `staticInfo` 中不存在 key 时才请求 `OS_RELEASE`、`CPU_MODEL`、`NET_ROUTE`；因此如果以后相同 `host:port` 指向了另一台机器（DNS/跳板映射变化、机器重建、地址复用），服务会继续复用上一台机器缓存的 `osName`、`cpuModel`、`netInterface`。同时 `bootstrappedKeys` 已经存在，新机器首次采样也不会再走 500 ms 的 bootstrap 第二采样。

所以当前 host 级 resource status state 没有和 Connection / remote-host identity 建立完整生命周期边界：删除、修改和全局 cache reset 都不能真正使其失效。

## 93. SSH transport 主动断开只会关闭底层 transport / shell，不会驱动 ExecutionSession 与 Workspace owner 回收；Registry 可长期保留已断开的“ready”会话

> 确认问题：ExecutionSession 提供 onTransportClose，但 manager 无订阅；WorkspaceTerminal shell-close handler 只 flush/publish。Frontend 收到 closed 后可能另行关闭，但不能保证后台 owner 即时同步；未测 socket 保持存活的断链场景。

底层 `SshExecutionTransportAdapter` 已经能准确观察远端主动断开：route close 时会把 `open = false`、关闭 owned channels，并 emit `close`。

`ExecutionSession` 也暴露了：

```ts
onTransportClose(listener: () => void): () => void {
  return this.transport().onClose(listener);
}
```

但 `ExecutionSessionManager.attach()` / `connect()` 在把 session 放进 `sessions` Map 时没有订阅这个 close event；全仓也没有任何 `onTransportClose(...)` 调用。结果是 transport 自己关闭后：

- `ExecutionSession.transportValue` 仍保留已关闭 transport；
- `ExecutionSession.statusValue` 仍是 `'ready'`，只有显式 `ExecutionSession.close()` 才会改成 `'closed'`；
- `ExecutionSessionManager.sessions` 仍保留该 id。

Workspace 层同样没有把 shell close 提升为 session lifecycle close。`WorkspaceTerminalService.attach()` 的 handler 只做：

```ts
session.shell.onClose(() => {
  this.flush(sessionId, state);
  this.events.publish(sessionId, { type: 'terminal-closed' });
});
```

它不会调用 `WorkspaceService.closeSession()` 或从 `WorkspaceSessionRegistry` 删除 session。

因此只要远端 SSH 主动断开而浏览器 WebSocket 本身仍保持连接，Workspace 会同时残留在 `WorkspaceSessionRegistry` 和 `ExecutionSessionManager`。`WorkspaceService.canCreate(id)` 因两个 registry 中仍有旧 id 而返回 false；后续 filesystem/status/command 会通过同一个已关闭 transport 失败，直到客户端另外触发 Workspace close、WebSocket close/reconnect grace 或 Backend shutdown 才有机会回收。

诊断结果还会被误导：`ExecutionSessionDiagnosticProbe` 只检查 `snapshot().status`，而 snapshot 读取的是仍为 `'ready'` 的 `statusValue`，所以底层 `isOpen === false` 的 session 仍会被报告成 `status: ok` / `Execution session ready.`。

这里缺的是 transport close → execution session close → workspace cleanup 的 owner 链条；底层已经知道连接死亡，但这个事实没有传播到拥有它的两个上层 registry。

## 94. Agent Integration 的 refresh epoch 只递增、不回收；反复创建/删除 Integration 会永久积累历史 scope+UUID generation state

> 确认问题（轻量进程内 retention）：IntegrationService refreshEpochs 没有 delete/clear，与可回收 refreshTails/runtimeHealth 不同。每项为小型 generation 值，严重程度不可等同 live process 泄漏；重启可回收，未测长期规模。

`IntegrationService` 用 `refreshEpochs` 防止旧 MCP refresh 在 update/remove/disable 后重新发布 stale schema：

```ts
private readonly refreshEpochs = new Map<string, number>();

private invalidateRefreshEpoch(scope: Scope, integrationId: string): void {
  const key = this.runtimeHealthKey(scope, integrationId);
  this.refreshEpochs.set(key, this.refreshEpoch(scope, integrationId) + 1);
}
```

这个 generation 机制本身是必要的，但当前没有生命周期收尾。`update()`、`remove()`、`syncEnabled()` 的 disabled 分支、`deactivate()` 都会调用 `invalidateRefreshEpoch()`；其中 `remove()` 还会显式：

```ts
this.runtimeHealth.delete(this.runtimeHealthKey(scope, integrationId));
```

却没有对应删除 `refreshEpochs`。全仓也没有任何 `refreshEpochs.delete()` / `clear()`。

Integration id 来自 UUID idempotency key。用户可以创建 integration A → 删除 A → 用新的 UUID 创建 B → 删除 B，持续产生新的 `userId + appId + integrationId` key。`refreshTails` 在最后一个 refresh 完成后会正确删除自己的 tail，`runtimeHealth` 在 remove 时也会删除；唯独 epoch generation 会永久留在进程 Map，直到 Backend 重启。

因此 Integration lifecycle 当前会产生单调增长的历史 generation state。它不依赖 refresh 是否失败，也不要求并发竞态；只要长期进行 Integration create/remove，heap 中就会持续保留已经不存在的 Integration UUID。

## 95. 全局 Agent feature disable 只 quiesce builtin App；Plugin App 的活跃 Run、Subagent 和 Backend Plugin runtime 会继续运行

> 确认问题：`app-registry.service.ts:67` list 仅 builtin；`compose-agent.ts:804` disable 用 list 枚举 scope。新 Run 有 feature gate，已有 Plugin execution 不在此 loop；未跑真实插件禁用场景。

`AppRegistryService` 实际维护两类注册：builtin 通过 `register()` 进入 `builtinDefinitions`，Plugin 则只通过 `registerVersion()` 进入 `versions`：

```ts
register(definition) {
  this.builtinDefinitions.set(id, definition);
  this.putVersion(definition);
}

registerVersion(definition) {
  this.putVersion(definition);
}

list(): AgentAppDefinition[] {
  return [...this.builtinDefinitions.values()];
}
```

`PluginRuntimeLifecycleCoordinator.registerVersion()` 明确调用的是 `registry.registerVersion(...)`，所以已安装 Plugin App 不会出现在 `registry.list()`。

但全局 Agent feature 从 enabled 切到 disabled 时，`compose-agent.ts` 恰好用 `registry.list()` 决定要停止哪些 scope：

```ts
if (before.effectiveSettings.feature.enabled && !updated.effectiveSettings.feature.enabled) {
  const deadline = systemClock.nowUnixSeconds() + 10;
  for (const definition of registry.list()) {
    await lifecycle.quiesceScope({ userId, appId: definition.manifest.id }, deadline);
  }
}
```

`lifecycle.quiesceScope()` 才是把一个 App scope 的 root scheduler、subagent scheduler 和 App runtime 一起停下来的 owner：它先进入 `quiesceHostExecution()`，对两个 scheduler 执行 `quiesceScope()` 并 abort 活跃执行，再调用 definition 的 `quiesceForScope()`。Plugin definition 也已经实现了 `quiesceForScope` / `disposeForScope`，只是根本没有被上述循环枚举到。

这不是只有“禁用后还能新建 Run”的问题；`RunService.create()` 的确会读取全局 `feature.enabled` 并拒绝新的 Run。真正缺口发生在 **设置切换前已经运行中的 Plugin Run**：`NativeAgentBackend.executePersisted()` 的持续执行循环不再读取全局 feature setting，它依赖 scheduler AbortSignal 在 quiesce 时中断。由于 Plugin scope 没有收到 `scheduler.quiesceScope()`，当前 model step、后续 safe boundary 和 child scheduler 都可以继续推进。

同一个遗漏也让 Plugin backend runtime 继续存活。Plugin App definition 的：

```ts
quiesceForScope: (scope, deadline) => this.runtime.quiesce(scope, scopePlugin, deadline),
disposeForScope: (scope) => this.runtime.dispose(scope, scopePlugin),
```

不会因全局 feature disable 被调用，App durable state 仍可保持 `desiredState: enabled` / `observedState: running`，对应 Plugin 子进程也没有被全局开关收敛。

因此当前“Agent disabled”只对 builtin App 建立了真实 execution boundary；对 Plugin App 它更多只是阻止新入口，不能保证禁用时刻已有的执行和 runtime 已停止。

## 96. Backend 重启后的 user initialization 只恢复 builtin App 的 enabled MCP Integration；Plugin App 的 MCP Tool contribution 不会自动回到内存 Catalog

> 确认问题：`compose-agent.ts:1010` integrations.syncEnabled 仅 registry.list；Plugin reconcile 恢复 runtime 而非所有该 scope MCP contribution。手动 refresh/enable 可修复，不能描述为不可恢复丢失。

MCP Integration 是按通用 App scope 暴露的。HTTP route 直接使用 URL 中的 `appId`：

```ts
const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
await dependencies.integrations.create(scope, input, idempotencyKey);
```

`IntegrationService.create()` 又通过 `lifecycle.get(scope)` 验证这个 App，因此已安装的 Plugin App 同样可以拥有 durable MCP integrations。

MCP 的可执行 Tool surface 本身不是持久化的。只有 refresh 成功后，hook 才把 snapshot 注册进进程内 `ToolCatalog`：

```ts
mcpRefreshed: (scope, integration, snapshot, schemaHash) => {
  catalog.replaceOwnedContribution(scope, `mcp:${integration.id}`, {
    ...
    tools: createMcpTools(...),
  });
}
```

Backend 重启会清空这个内存 Catalog 和 `McpAdapter.sessions`，所以 startup 必须重新 refresh enabled integrations。`initializeForUser()` 也确实做了这件事，但范围仍然来自 `registry.list()`：

```ts
await lifecycle.initializeDefaults(userId);
await plugins.reconcileUserRuntime(userId);
for (const definition of registry.list()) {
  await integrations.syncEnabled({ userId, appId: definition.manifest.id });
}
```

如上一问题所示，`registry.list()` 只返回 builtin definitions。`plugins.initializeInstalledVersions()` / `reconcileUserRuntime()` 虽然会把 Plugin version 重新注册到 version registry，也会恢复 Plugin backend runtime，却没有替 Plugin scope 调用 `integrations.syncEnabled()`。

因此触发链是：Plugin App 创建并启用 MCP Integration → refresh 成功、Tool 当次可用 → Backend 重启 → Integration row 仍在 SQLite 且 `enabled=1` → Plugin App/version 正常恢复 → user initialization 跳过该 Plugin scope → MCP session 与 Tool contribution 都没有重建。

此时管理 API 仍能列出这个 enabled Integration，但 Agent model surface 中对应 MCP tools 已消失；只有用户再次手动 refresh、update，或执行其它会显式调用该 scope `syncEnabled()` 的生命周期操作后才会恢复。持久化状态显示 enabled 与实际 runtime Tool availability 在正常重启后发生确定性分叉。

## 97. Backend Plugin 的 `runtime.ready` handshake 也没有 timeout；已启用插件在模块 import 阶段卡死可以让整个 Backend 启动永远停在 listen 之前

> 确认问题：`local-plugin-backend-runtime.adapter.ts:353–356` ready 无 timer，worker import 在 ready 前；installed enabled runtime 初始化被 services.initialize await。与 #91 是不同进程边界；未启动卡死插件验证。

Backend Plugin 与 Runner Plugin 是两套独立 runtime。Backend 这一套在 `LocalPluginBackendRuntimeAdapter.activate()` 中同样先等待无界的 `ready`：

```ts
const instance = this.start(scope, plugin);
this.instances.set(key, instance);
try {
  await instance.ready;
  await instance.request('lifecycle.activate');
} catch (error) {
  await instance.close().catch(() => undefined);
  this.instances.delete(key);
  throw error;
}
```

`BackendPluginProcess.request()` 本身有 `CONTROL_TIMEOUT_MS`，但 `ready` 只是：

```ts
readonly ready = new Promise<void>((resolve, reject) => {
  this.readyResolve = resolve;
  this.readyReject = reject;
});
```

只有收到 `runtime.ready`、child error/exit 或 protocol failure 才会 settle，没有任何 timer。

worker 的启动顺序则是先加载第三方模块：

```ts
const imported = await import(pathToFileURL(entryPath).href);
// build sdk/lifecycle + install stdin handlers
send({ kind: 'runtime.ready', protocolVersion: PLUGIN_BACKEND_PROTOCOL_VERSION, sdkVersion });
```

所以 Plugin backend entry 只要有永不 settle 的 top-level await / import-time Promise，同时 Node child 本身继续存活，就永远不会发送 ready，也不会触发 parent 的 exit/error。

这条无界等待直接进入正常启动链。`agent.initialize()` 先：

```ts
await modelRegistry.initialize();
await plugins.initializeInstalledVersions();
```

`initializeInstalledVersions()` 会对有 active installation 的用户执行 `reconcileUserRuntime()`；对于 `desiredState === 'enabled'` 且带 `backendEntry` 的 Plugin，`reconcileRuntime()` 在 health unavailable 时会调用 `runtime.activate()`，最终卡在上述 `await instance.ready`。

而应用启动顺序是：

```ts
await services.initialize();
// ...
await listen(server, config.port);
```

因此一个已经安装并启用、import 阶段卡死的 Backend Plugin，可以让 Nexus Backend 在重启后永远无法走到 `server.listen()`。这不是单次 Plugin API 请求超时，而是生产进程整体启动被第三方插件的无界 ready handshake 劫持。

它和 #91 的 Runner Plugin 问题是两个不同进程边界：#91 卡 Agent Runner Workspace lifecycle/reconcile；这里卡的是主 Backend 自身的 Agent initialization，最终阻止 HTTP/WebSocket server 开始监听。

## 98. Backend graceful shutdown 没有关闭 Plugin Backend runtime；SIGTERM 后主服务可以在 HTTP 已停止后继续被 Plugin child process 挂住

> 确认问题：`compose-agent.ts` quiesce/dispose 与 `app-lifecycle.service.ts:150` 仅 builtin definition；Plugin adapter 无全局实例 close owner 接入。Root/Child scheduler 全局 quiesce 已覆盖，不要误说所有 Plugin Run 都不 abort；这里是 backend child process cleanup 缺口。

主 Backend 的 shutdown 顺序是：

```ts
await services.agent.quiesce(...);
await webSockets.close();
await server.close(...);
// finally
await services.dispose();
```

而 `services.dispose()` 最终调用 `agent.dispose()`。当前 `agent.dispose()` 会关闭 MCP、Workspace interactive session、Browser gateway，并调用：

```ts
await lifecycle.dispose();
```

但 `AppLifecycleService.dispose()` 仍然只枚举：

```ts
for (const definition of this.registry.list()) await definition.dispose?.();
```

`registry.list()` 只返回 builtin definitions；Plugin definitions 只存在于 version registry。因此已经运行的 `LocalPluginBackendRuntimeAdapter.instances` 完全没有进入 shutdown cleanup。

这一点不能依赖 `PluginInstallService` 补偿：它没有 `dispose()` / `closeAll()`；`LocalPluginBackendRuntimeAdapter` 本身也只暴露按 scope/plugin 的 `dispose()`，没有全局 lifecycle owner 会在 Backend shutdown 枚举全部 instances。

Plugin worker 也没有在 stdin EOF / readline close 时主动退出的 handler。它只在收到显式 `lifecycle.dispose` 后设置：

```ts
process.exitCode = 0;
```

而 parent 的 `BackendPluginProcess.close()` 才会发送该 lifecycle request 并 `child.kill('SIGTERM')`。当前 shutdown 根本不会调用到它。

这会直接影响正常 SIGTERM/SIGINT。`bootstrap/main.ts` 对这两个信号只执行：

```ts
void shutdown();
```

并不会在 shutdown 完成后调用 `process.exit()`；只有 fatal path 才有 `finally(() => process.exit(1))`。因此当 Plugin backend child 仍存活时，主进程即使已经关掉 HTTP server、WebSocket 和其它 owner，ChildProcess handle / stdio pipe 仍可继续保持 Node event loop 活跃，使 graceful shutdown 不能自然退出，直到外部 supervisor 再次升级为强制 kill。

如果插件自身还创建了 timer/socket，这个行为更稳定：worker 不仅没有收到 dispose，它自己的业务资源也不会被释放。

这和 #84 不同：#84 是“已经调用 Plugin `close()` 后只发 SIGTERM、不等待/不升级 SIGKILL”；这里是 Backend 全局 shutdown 根本不会对 Plugin runtime 调用 `close()`。

## 99. Background 并发上传在特定交错下可留下无引用文件

> 确认问题（可构造并发交错）：BackgroundAssetService read previous/save/set/delete 无 per-kind CAS/lock，orphan sweep 未建立。不是任意两次并发都会触发，必须都读到同一个旧引用等交错；未强制此交错。

`BackgroundAssetService.upload()` 的生命周期是：

```ts
const current = await this.settings.get();
const previous = kind === 'page' ? current.pageBackgroundImage : current.terminalBackgroundImage;
const saved = await this.store.save(content, mimeType);
await this.settings.setBackgroundReference(kind, saved.publicPath);
if (previous && previous !== saved.publicPath) {
  await this.store.removePublicPath(previous).catch(() => false);
}
```

单次调用的失败补偿只覆盖“新文件已写、Setting 写失败”这一条路径；整个 `read previous → save → set reference → delete previous` 没有 per-kind mutation lock、CAS revision 或其它 serialization owner。

因此两个针对同一 `kind` 的合法上传 A/B 可以同时读到同一个旧引用 `old.jpg`：

1. A 保存 `A.jpg`；
2. B 保存 `B.jpg`；
3. A/B 分别写 `pageBackgroundImage`，最后一次写入成为 durable reference；
4. A/B 都只尝试删除各自在开始时读到的 `old.jpg`。

无论最终 Setting 指向 A 还是 B，另一个刚刚成功写入的新文件都不会进入任何 cleanup 路径。`LocalBackgroundAssetAdapter` 也没有列举/reconcile API，Appearance 初始化和全仓其它代码都没有 orphan-background sweep。

例如最终 Setting 指向 `B.jpg` 时，`A.jpg` 会永久留在 `data/background/`。每个文件允许到 5 MiB，重复并发上传会让磁盘持续积累不可从产品 UI 到达的 orphan asset。

同样的竞态也存在于 upload 与 remove 并发：remove 可以基于旧引用删除旧文件并把 Setting 清空，而 upload 随后写入新引用；反过来则可能让刚上传的新文件在 Setting 被清空后变成 orphan。根因都是 Background file owner 与 Setting owner 之间缺少一个统一的 mutation generation/serialization 边界。

## 100. Plugin 升级会按 installation 引用删除旧 Runner package，但持久 Workspace Profile 仍冻结旧版本；升级后 retained Workspace 再启动会稳定失败

> 确认问题（package 引用 owner 缺口）：PluginPackageInstallCoordinator cleanup 只 countInstalled；Workspace frozen runnerPlugins 仍引用旧版本，Runner 读取旧 package marker。需要旧版没有其它 installation 引用且 cleanup 执行；未完整升级／重启验证。

Workspace 在创建时会把 Runner Plugin 的真实执行版本冻结进 durable profile：

```ts
const resolvedRunnerPlugins = await this.pluginTargets.resolveRunnerTargets(...);
const profile: WorkspaceProfileView = {
  // ...
  runnerPlugins: resolvedRunnerPlugins.map((target) => ({ ...target })),
};
```

这个 profile 随 `agent_workspaces.runner_plugins_json` 持久化，后续 `start` / `restart` 不会重新解析当前 Plugin installation，而是继续把原来冻结的 `pluginId + version + packageHash + entry` 发给 Runner。`retained` Workspace 也明确不会进入普通 runtime cleanup candidate，因此可以跨 Run、跨较长时间继续存在。

但 Plugin upgrade 完成后，对旧版本 package 的回收只检查一件事：还有没有 user installation 指向该版本。

```ts
installedCount = await this.repository.countInstalled(plugin.appId, plugin.version);
if (installedCount !== 0) return;
await this.verifier.removeInstalled(plugin.appId, plugin.version);
await this.repository.updateVersionStatus(..., 'removed', ...);
this.runtimeLifecycle.removeVersion(plugin.appId, plugin.version);
```

`countInstalled()` 只查询：

```sql
SELECT COUNT(*)
FROM agent_plugin_installations
WHERE app_id=? AND version=? AND status='installed'
```

这里完全没有把 `agent_workspaces.runner_plugins_json` 作为 package reference owner。升级事务把 installation 从旧版本切到新版本后，旧版本计数立即变成 0，于是旧目录 `data/agent/plugins/<appId>/versions/<oldVersion>` 被删除，即使还有 retained Workspace 的 frozen profile 正在引用它。

Runner 启动 Workspace Plugin 时则直接按 frozen version 读取这个目录：

```ts
const source = path.join(this.pluginSourceRoot, target.pluginId, 'versions', target.version);
const marker = path.join(source, '.nexus-package-hash');
observedPackageHash = fs.readFileSync(marker, 'utf8').trim();
```

生产部署又明确把 Backend 的 `./data/agent/plugins` 只读挂载为 Runner 的 plugin source，所以 Backend cleanup 与 Runner source 是同一组文件。

因此触发链可以稳定闭环：创建使用 Plugin v1 Runner target 的 retained Workspace → Run 结束后 Workspace 继续保留 → Plugin 从 v1 升级到 v2 → installation 原子切到 v2 → cleanup 发现 v1 installation count=0 并删除 v1 package → 之后对原 retained Workspace 执行 `start` / `restart` → Runner 仍读取 frozen v1 target → `.nexus-package-hash` 已不存在 → `PLUGIN_RUNNER_SOURCE_UNAVAILABLE`。

这不是“旧 Workspace 没自动升级”本身，而是 package lifetime owner 少算了一个真实 durable reference。当前 installation owner 可以在 Workspace owner 仍持有版本引用时提前释放 package，直接制造一个已经持久化、UI 仍可列出、但再也无法按其冻结配置启动的 Workspace。

## 101. Plugin 可耗尽共享 Run subscription 槽并阻止新的 Host UI 订阅

> 确认问题（共享 admission 饥饿）：PluginAgentSdkDispatcher subscriptions Map 无独立上限，agent-events 共用 socket，Backend MAX_SUBSCRIPTIONS=16。已有订阅不会因新订阅被直接踢出，是后续 Host/Run subscribe 可失败；未实际耗尽槽位。

Frontend 的所有 Agent event stream 复用进程内同一个 `sharedAgentSocket`：

```ts
let sharedAgentSocket: SharedAgentSocketState | null = null;

const acquireSharedAgentSocket = async (...) => {
  let state = sharedAgentSocket;
  if (!state || state.socket.readyState === WebSocket.CLOSING || state.socket.readyState === WebSocket.CLOSED) {
    state = createSharedAgentSocket();
  }
  state.leases += 1;
  // ...
};
```

主 Agent Host surface 用它订阅 host channel：

```ts
for await (const event of agentEvents.host(initial.eventCursor, controller.signal)) {
  // ...
}
```

普通 `AgentAppSurface` 的当前 Run 也通过 `createAgentRunFacade()` → `agentEvents.run(...)` 使用同一条 socket。

Plugin Frontend SDK 同样没有独立 transport。`PluginAgentSdkDispatcher.subscribe()` 每调用一次就创建一个新的 subscription，并直接进入同一个 `agentEvents.run(...)`：

```ts
const subscriptionId = crypto.randomUUID();
const controller = new AbortController();
this.subscriptions.set(subscriptionId, controller);
for await (const event of agentEvents.run(this.appId, runId, cursor, controller.signal)) {
  // ...
}
```

这里的 `subscriptions` Map 没有数量上限，也没有禁止同一个 `runId` 被重复订阅。Host bridge 的 `MAX_IN_FLIGHT = 8` 只限制同时执行中的 RPC；Plugin 完全可以串行调用 `agent.runs.subscribe`，每个 RPC 很快返回后继续占住一个长期 subscription。

真正的上限只存在 Backend 的整条 WebSocket session 上：

```ts
const MAX_SUBSCRIPTIONS = 16;

if (this.subscriptions.has(subscriptionId)) throw new Error('SUBSCRIPTION_EXISTS');
if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) throw new Error('SUBSCRIPTION_LIMIT');
```

这个计数不区分 Host UI、普通 Agent Run 与 Plugin Frontend，也没有 per-plugin quota / reservation。Backend 也不禁止多个 subscription 指向同一个 run，因此一个 Plugin 对一个自己可访问的 Run 重复订阅即可消耗剩余所有槽。

后果不是单纯“第 17 个 Plugin subscription 失败”。例如 Host surface 已长期占 1 个槽时，Plugin 顺序建立 15 个重复 Run subscription，就能把连接占到 16/16；此后用户在主 `AgentAppSurface` 选择一个 Run 时，新 `agentEvents.run()` 会收到 `SUBSCRIPTION_LIMIT`。

Frontend reconnect policy 又明确把这个错误排除在 retryable transport error 之外：

```ts
const retryableTransportError = (cause: unknown): boolean =>
  cause instanceof Error &&
  (cause.message === 'AGENT_WS_OPEN_FAILED' ||
    cause.message === 'AGENT_STREAM_FAILED' ||
    /^AGENT_WS_OPEN_CLOSED_\d+$/.test(cause.message) ||
    /^AGENT_WS_CLOSED_\d+$/.test(cause.message));
```

`SUBSCRIPTION_LIMIT` 会直接被当作 permanent stream failure 抛给 `run-facade` 的 `onError`，不会等 Plugin 释放槽后自动恢复。

因此 Plugin iframe 虽然在 RPC 并发、消息大小、handshake 和 abort 上都有隔离，但长期 event subscription 这项共享资源没有 owner 隔离。一个有 bug 或刻意重复 subscribe 的 Plugin Frontend 可以稳定让宿主自己的 Agent Run 实时事件流无法建立，直到这些 Plugin subscription 被显式 unsubscribe、iframe dispose 或整条 socket 被关闭。

## 102. Plugin uninstall / upgrade 是否应停止 retained Workspace 的冻结版本进程

> 待确认（冻结 Workspace 版本生命周期）：uninstall drain 确实按 App runningCount，Runner process 由 Workspace owner 控制。但 retained Workspace 保留冻结版本可能是有意允许；需确认 uninstall 是否承诺立即停止这些独立 Workspace，和 #100 的 package 引用问题分开判定。

Plugin drain 统计 App live Run，不统计 Runner Workspace Plugin；retained Workspace 的冻结版本由独立 Workspace lifecycle 控制。需明确 uninstall/upgrade 是否必须停止这些 Workspace；保留旧代码执行可能是冻结版本设计，与旧 package 过早回收的 #100 不同。

## 103. `retained` Workspace 的显式 delete 只删除 Generation，不释放 Workspace retention；它会同时留下不可回收文件树并永久阻塞 Run / Thread 删除

> 确认问题（显式删除／retention 无释放入口）：repository retained flag 无 update API，delete 只 generation，cleanup 排除 retained，Run/Thread delete 检查 status<>deleted OR retained=1。需确认产品 delete 是否仅指 generation；现有 UI 没有后续释放入口的缺口保留，未端到端删除验证。

Workspace 的 `retained` 是 create-time durable flag：

```ts
INSERT INTO agent_workspaces (..., retained, ...)
VALUES (..., record.retained ? 1 : 0, ...)
```

当前 Workspace repository / HTTP contract 中没有任何把现有 Workspace 从 retained 改回 unretained 的 mutation。`retained` 只在创建时输入，之后 lifecycle action 只有 `start | stop | restart | delete`。

用户对 retained Workspace 执行 `delete` 时，Runner 的 delete branch 做的是：

```ts
await this.dependencies.pluginRunner.disposeWorkspace(workspace);
await this.dependencies.runtimeEngine.remove(workspace.workspaceId, workspace.generation);
this.dependencies.pluginRunner.cleanupGeneration(workspace.workspaceId, workspace.generation);
this.save(workspace, 'deleted');
```

其中 `WorkspaceRuntimeManager.remove()` 只删除：

```ts
fs.rmSync(this.generationRoot(workspaceId, generation), { recursive: true, force: true });
```

真正的 persistent Workspace 数据位于另一棵目录：

```text
runtime/workspaces/<workspaceId>/core/workspace
runtime/workspaces/<workspaceId>/plugins/<pluginId>/workspace
```

普通 lifecycle delete 没有删除它。能够删除整个 `runtime/workspaces/<id>` 的是后续 `runtimeCleanup()`：

```ts
fs.rmSync(path.join(this.root, 'runtime', 'workspaces', workspace.workspaceId), {
  recursive: true,
  force: true,
});
```

但 Backend 生成 cleanup candidate 时又无条件排除所有 retained Workspace，即使它已经是 `deleted`：

```ts
const candidates = owned
  .filter((workspace) => !workspace.retained && !ACTIVE_WORKSPACE_STATUSES.has(workspace.status))
  .slice(0, 4096);
```

Runner 自己的 cleanup planner 也再次执行相同 gate：

```ts
if (!workspace || workspace.retained || workspace.status === 'running' || ...) {
  skipped.push(workspaceId);
  continue;
}
```

所以 `retained=true` 一旦创建，就算用户之后明确点击 Delete，persistent Workspace root 也没有任何合法清理路径。

这个 retention flag 还会继续影响 durable entity 删除。Run deletion 明确查询：

```sql
SELECT id FROM agent_workspaces
WHERE run_id = ? AND user_id = ? AND app_id = ?
  AND (status <> 'deleted' OR retained = 1)
LIMIT 1
```

Thread deletion 使用同样的条件：

```sql
AND (w.status <> 'deleted' OR w.retained = 1)
```

也就是说 `status='deleted', retained=1` 仍被永久视为 attached Workspace。

触发链可以完整重现：Run 创建 `retained=true` Workspace → Workspace 写入 core/plugin persistent files → 用户执行 Workspace `delete`，API/Backend 将其状态投影为 `deleted` → Runner 只删除 generation → runtime cleanup 永远跳过该 row → Run 删除返回 `RUN_DELETE_WORKSPACE_ATTACHED`，Thread 删除返回 `THREAD_DELETE_WORKSPACE_ATTACHED` → 由于系统没有 unretain Workspace API，这个状态无法通过正常产品操作解除。

因此当前的 `delete` 对 retained Workspace 不满足用户可观察到的删除语义：它既没有释放 Runner persistent data owner，也没有释放数据库里的 dependency owner，最终形成“已经 deleted、却永久占资源且永久阻塞上层删除”的不可逆状态。

## 104. Backend Plugin 的 AppIntent create 丢失了已经存在的 idempotency owner；崩溃窗口会把一次跨 App 操作重复提交为两张 receipt

> 确认问题（SDK 无 durable retry identity）：`local-plugin-backend-runtime.adapter.ts:541–547` 不传 createConfirmed 第三参数，Backend SDK input 也不提供 idempotencyKey。只有插件在 uncertain commit 后重试同一业务操作才产生重复 receipt；不声称任意 create 会重复。

`AppIntentService.createConfirmed()` 本身已经为跨 App intent 建立了 durable idempotency contract。只要调用方传入 `idempotencyKey`，receipt id 就直接绑定到该 key，并会在重复请求时校验 payload 后 replay 原 receipt：

```ts
const receiptId = idempotencyKey ? requireIdempotencyKey(idempotencyKey) : randomUUID();
if (idempotencyKey) {
  const existing = await this.repository.get(scope.userId, receiptId);
  if (existing) {
    // 校验 sender / receiver / intent / input / artifactIds
    return existing;
  }
}
```

Plugin Frontend 也确实使用了这个 owner。所有 mutation 必须带 `operationId`，其中 `intents.create` 会把它原样传给 service：

```ts
const operationId = request.operationId === undefined ? undefined : requireIdempotencyKey(request.operationId);

if (FRONTEND_MUTATION_METHODS.has(request.method) && !operationId) {
  throw new Error('IDEMPOTENCY_KEY_INVALID');
}

await this.appIntents.createConfirmed(scope, input, operationId);
```

但同一个 Host 暴露给 Backend Plugin 的 SDK 没有 operation identity：

```ts
intents: {
  create(input: {
    receiverAppId: string;
    intentId: string;
    input: JsonValue;
    artifactRefs?: Array<{ appId: string; id: string }>;
    confirmed: true;
  }): Promise<PluginBackendAppIntentReceipt>;
}
```

worker 发出的 `intent.create` frame 也只有业务 payload 和进程内 `requestId`；Host 最终调用的是：

```ts
value = await this.appIntents.createConfirmed(this.scope, {
  receiverAppId: message.receiverAppId,
  intentId: message.intentId,
  input: message.input,
  artifactRefs: message.artifactRefs,
  confirmed: true,
});
```

这里没有传第三个 `idempotencyKey` 参数，所以 service 每次都会走 `randomUUID()`。

`requestId` 不能承担 durable operation identity：它只在当前 child process 中从 1 递增，Backend/Plugin process 重启后会重新开始，而且没有进入 receipt 表。

因此存在标准的 commit/ack 不确定窗口：Backend Plugin 发起 `intents.create` → SQLite transaction 已经提交 receipt A 和 artifact grants → Host 还没把 `intent.result` 可靠交给 Plugin 时 Backend/Plugin runtime 崩溃 → Plugin 重启后根据自己的 durable outbox/业务状态重试同一语义操作 → SDK 无法携带原 operation id → Host 生成新的 UUID 并提交 receipt B。

Receiver 的 `listReceived()` 只是按 receipt row 返回，没有按 sender + intent + payload 做语义去重，所以 A、B 会同时成为有效的未过期 intent，接收方可以对同一次外部动作执行两次。

这和 #61 不重复：#61 是 Frontend 已经产生了 `operationId`，但 thread rename / subagent cancel 的调用链把它丢掉；这里是 Backend Plugin SDK 从 contract 层就没有给 `AppIntentService` 已实现的 idempotency owner 暴露任何入口。

## 105. Backend Plugin 的 Host RPC 没有 response-drain deadline；一个堵住 stdin 的 Plugin 可以让 uninstall / upgrade 永远卡在 SIGTERM 之前

> 确认问题：close 在 kill 前 await activeHostOperations，BoundedProtocolWriter backpressure wait 没有 drain deadline。bounded frame/queue 限制容量但不能终结已有 stalled write；需要 child 存活且不读 stdin，未构造 pipe stall 验证。

`BackendPluginProcess` 对 lifecycle request 有 30 秒 timer，但 Plugin 主动发起的 storage / intent Host RPC 没有对应 deadline。Host 只把正在处理的请求登记到：

```ts
private readonly activeHostOperations = new Set<Promise<void>>();
```

每个 Host operation 最后都必须把结果写回 child stdin：

```ts
await this.protocolWriter.write(encoded);
```

`BoundedProtocolWriter.writeFrame()` 在 pipe 出现 backpressure 时会等待 `drain`：

```ts
const accepted = this.writable.write(frame, callback);
if (!accepted) {
  drainDone = false;
  this.writable.once('drain', onDrain);
}
```

这里没有 timer，也没有 AbortSignal。只要 child 仍然存活但不再读取 stdin，Promise 就可以永久保持 pending。

这不是只能靠异常 OS 状态触发。Plugin 代码和协议 reader 在同一个 Node child event loop 中；Plugin 可以先发出多条 SDK read：

```ts
void sdk.storage.get('a');
void sdk.storage.get('b');
// ...
```

然后进入同步死循环或其他长期 event-loop stall。App storage 单 value 最大 64 KiB，而 Host 允许最多 32 个并发 Host operation；多个大 `storage.get` response 足以把 child stdin pipe 填满，使至少一个 `protocolWriter.write()` 等待永远不会到来的 `drain`。

此时 lifecycle close 的顺序又把 kill 放在所有 Host operation **之后**：

```ts
async close(): Promise<void> {
  this.closing = true;
  if (!this.child.killed && this.child.stdin.writable) {
    await this.request('lifecycle.dispose').catch(() => undefined);
  }
  await Promise.allSettled([...this.activeHostOperations]);
  this.child.kill('SIGTERM');
}
```

`lifecycle.dispose` 自己虽然 30 秒后会因 `PLUGIN_BACKEND_TIMEOUT` 返回，但它的 protocol write 同样排在堵塞 writer 后面；随后 `close()` 进入没有 timeout 的 `Promise.allSettled(activeHostOperations)`，所以永远到不了 `SIGTERM`。

上层 uninstall、upgrade、runtime reconcile 都会 await `runtime.dispose()/instance.close()`。因此完整触发链是：Plugin 发出足够多的大 Host read → Plugin event loop 卡死且不再消费 stdin → Host response pipe 进入 backpressure → active Host operation 永久 pending → 用户 uninstall/upgrade 开始 close → lifecycle timeout 被吞掉 → close 永久等待 active operation → 安装生命周期永远无法完成，Host 也不会执行本应作为最终收敛手段的 process kill。

这和 #84 是相反方向的独立 lifetime 缺口：#84 是已经走到 `SIGTERM` 后过早返回、没有等待/升级 kill；这里是 Host 在 `SIGTERM` **之前** 被无 deadline 的 child-response drain 永久挡住。

## 106. Plugin 首次安装没有 per-App serialization；两个版本并发 install 可以把 App activeVersion 与 Installation version 写成永久冲突

> 确认问题：coordinator 事务外捕获 existingState/Installation，states.insertDefault 为 INSERT OR IGNORE，installation upsert 为 last-writer-wins，未共享事务。只适用于首次安装并发窗口；未 barrier 复现。

`PluginInstallService.install()` 只是直接转发到 coordinator：

```ts
install(userId: number, stageId: string): Promise<PluginInstallResult> {
  return this.packageInstall.install(userId, stageId);
}
```

HTTP install endpoint 也直接 await 这条路径，没有 user/app 级互斥。真正的 install 在事务外先同时读取两个 durable owner：

```ts
const existingState = await this.states.get(scope);
const existingInstallation = await this.repository.getInstallation(userId, verified.manifest.id);
```

如果这是同一 Plugin App 的第一次安装，两者都会是 `null`。后续 App state 与 installation 又由两个彼此独立的持久化操作提交：

```ts
if (!existingState) {
  const inserted = await this.states.insertDefault({
    ...scope,
    activeVersion: verified.manifest.version,
    ...
  });
}

let current = await this.states.get(scope);

if (existingInstallation?.status === 'removed') {
  ...
} else {
  await this.repository.upsertInstallation({
    userId,
    appId: verified.manifest.id,
    version: verified.manifest.version,
    status: 'installed',
    ...
  });
}
```

`insertDefault()` 使用 `INSERT OR IGNORE`，因此两个并发请求里只会有一个请求决定 `agent_apps.active_version`：

```sql
INSERT OR IGNORE INTO agent_apps (... active_version ...)
VALUES (...)
```

但 `upsertInstallation()` 的冲突策略却是无条件 last-writer-wins：

```sql
INSERT INTO agent_plugin_installations(user_id,app_id,version,status,created_at,updated_at)
VALUES(?,?,?,?,?,?)
ON CONFLICT(user_id,app_id) DO UPDATE SET
  version=excluded.version,status=excluded.status,updated_at=excluded.updated_at
```

于是可以构造确定性的交错。用户先 stage 同一 `appId` 的 v1 和 v2，然后并发请求两个 install：

1. A(v1) 与 B(v2) 都在最初读取到 `existingState=null`、`existingInstallation=null`。
2. A 的 `insertDefault` 先成功，令 `agent_apps.active_version='v1'`；B 的 `INSERT OR IGNORE` 随后被忽略。
3. A/B 重新读取 App state 时都会看到 active v1，但分支选择仍使用最开始捕获的 `existingInstallation=null`。
4. A 先 upsert installation=v1，B 后 upsert installation=v2。
5. 两个 install 都可以继续完成 stage finalization 并返回成功；最终却是 `agent_apps.active_version='v1'`、`agent_plugin_installations.version='v2'`。

这个冲突不会由现有启动 reconcile 自动修复。后续 install 在入口会直接检测：

```ts
if (existingState && existingInstallation && existingInstallation.version !== existingState.activeVersion) {
  throw new Error('PLUGIN_INSTALLATION_STATE_CONFLICT');
}
```

upgrade / uninstall 也要求 installation version 与 App activeVersion 一致，因此用户会从“两次安装都成功”进入一个正常 Plugin 管理流程无法继续的 durable split-brain 状态。

问题的 owner 边界很明确：首次 install 是一个需要同时建立 Plugin Version、App state 和 per-user Installation 的逻辑事务，但当前只有各 repository 方法自己的局部原子性，没有 coordinator 级 per-App serialization 或跨表 compare-and-set transaction。

## 107. Terminal Theme 删除与 Appearance active theme 分属两个 owner；直接删除当前主题会留下无法自动修复的悬挂 `activeTerminalThemeId`

> 确认问题：TerminalThemeService.delete 不维护 setting，Appearance get 未验证非空 ID，initialize 只在 null 选默认。Frontend 有 default fallback 所以不一定白屏；持久 reference 不一致仍存在。

当前“正在使用哪个终端主题”由 `AppearanceSettingsService` 持久化为一个普通 setting，并且写入时会验证目标主题存在：

```ts
if (input.activeTerminalThemeId !== undefined && input.activeTerminalThemeId !== null) {
  if (!Number.isInteger(input.activeTerminalThemeId) || input.activeTerminalThemeId <= 0)
    throw new Error('无效的终端主题 ID。');
  if (!(await this.themes.get(input.activeTerminalThemeId)))
    throw new Error(`指定的终端主题 ID 不存在: ${input.activeTerminalThemeId}`);
}
```

但是 `TerminalThemeService` 的删除路径完全不知道这个反向引用：

```ts
async delete(id: number): Promise<boolean> {
  assertThemeId(id);
  return this.repository.deleteUser(id);
}
```

repository 只按 theme 自己的 owner 删除 row：

```ts
DELETE FROM terminal_themes
WHERE id = ? AND theme_type = 'user'
```

HTTP `DELETE /api/v1/terminal-themes/:id` 也直接调用这条路径，没有检查该 ID 是否仍被 Appearance 使用。因此即使前端当前按钮会在 UI 流程里先删除 theme、再尝试把 `activeTerminalThemeId` 设为 `null`，这个一致性实际上没有由 Backend owner 保证；任何认证客户端都可以直接删除当前主题，而且 UI 自己的两步操作在第二步失败时也会形成同样状态。

删除完成后，Appearance 仍会从数据库读回已经不存在的整数 ID：

```ts
const activeRaw = values.get('activeTerminalThemeId');
const parsedActive = activeRaw && activeRaw !== 'null' ? Number.parseInt(activeRaw, 10) : null;
...
activeTerminalThemeId: Number.isInteger(parsedActive) ? parsedActive : null,
```

初始化也只在值本身是 `null` 时选择默认主题：

```ts
if (current.activeTerminalThemeId === null) {
  const defaultThemeId = await this.themes.findDefaultThemeId();
  if (defaultThemeId !== null) await this.repository.setMany({ activeTerminalThemeId: String(defaultThemeId) });
}
```

所以 Backend 重启不会发现或修复“ID 非空但 row 已不存在”的悬挂引用。Frontend Workspace 最终只是找不到对应 theme 后静默使用内置 default：

```ts
const id = appearanceSettings.value.activeTerminalThemeId;
return appearanceThemes.value.find((theme) => theme.id === id)?.themeData ?? defaultTerminalTheme;
```

完整触发链是：用户选择自定义主题 A → `appearance_settings.activeTerminalThemeId=A` → 直接调用 theme delete，或 UI 删除成功后清理 setting 失败 → A row 已永久删除而 setting 仍为 A → GET appearance 继续返回不存在的 ID → Workspace 静默显示默认主题，但设置面板无法解析当前主题 → 重启仍保留同一悬挂 ID。

这里缺的是跨 owner 的 referential lifecycle：Appearance 已把 Terminal Theme 当成可持久引用，但 Theme 删除没有通过 Appearance owner、没有数据库外键/CAS，也没有 delete-time reference check 或启动 reconcile。因此这是一个可永久持久化的状态不一致，而不是单纯的前端显示问题。

## 108. Server Transfer 只限制单任务内部并发，没有全局 active-task / ExecutionSession 配额；多个 `/send` 请求可以线性扩张 SSH session 与远端命令并发

> 确认问题（跨任务 admission）：TransfersService initiate 每次直接 process，orchestrator concurrency 仅 task 内，ExecutionSessionManager 无总配额。连接失败／远端限制会影响真实资源规模，未压测。

`TransferOrchestratorService` 确实对**单个** task 的 subtask worker 做了并发限制：

```ts
this.concurrency = Math.max(1, Math.min(20, options.maxConcurrentSubTasks ?? 5));
...
const workers = Array.from({ length: Math.min(this.concurrency, task.subTasks.length) }, async () => {
  while (next < task.subTasks.length && !signal.aborted) {
    ...
    await this.processSubTask(taskId, sub, source!, signal);
  }
});
```

但 `TransfersService.initiate()` 对 task 数本身没有任何配额或调度：

```ts
const { task, signal } = this.tasks.create(payload, userId);
void this.orchestrator.process(task.taskId, signal).catch(...);
return task;
```

`POST /transfers/send` 每次都会直接进入这条路径并立即返回 `202`。`TransferTaskRegistry.create()` 只是把 task/controller 放进两个 `Map`，没有检查当前 `activeTasks`、每用户 active 数或全局上限；虽然 registry 暴露了 metrics：

```ts
metrics(): { activeTasks: number; queuedSubTasks: number; activeSubTasks: number } {
  ...
}
```

这些指标只用于观测，没有参与 admission control。

每个 task 随后都会独立建立一个 system-owned source `ExecutionSession`：

```ts
source = await this.sessions.connect({
  ownerType: 'system',
  ownerId: `transfer:${taskId}`,
  connection: sourceConnection,
  connect: { signal },
});
```

而 `ExecutionSessionManager` 自己也只是无上限 `Map`：

```ts
private readonly sessions = new Map<string, ExecutionSession>();

async connect(request: ConnectExecutionSessionRequest): Promise<ExecutionSession> {
  const id = request.id ?? randomUUID();
  this.assertAvailable(id);
  const transport = await this.transportFactory.connect(request.connection, request.connect);
  return this.attach({ ... });
}
```

没有 max-session / owner quota。每个 subtask 还会继续通过 `withTarget()` 建立临时 target SSH transport，并在 source session 上启动 rsync/scp command：

```ts
const target = await this.transports.connect(connection, { signal });
...
const session = await source.startCommand({ command, ... });
```

因此单 task 的 “5 workers” 并不是系统级资源上限。认证用户可以连续提交 N 个最小合法 `/transfers/send` 请求，每个 task 都独立获得一个 source SSH transport，并最多并行执行 5 个 subtask；系统总体并发近似按 N 线性增长。请求数增加时，会同时放大 SSH socket、source channel、target probe/transport、远端 rsync/scp 进程、timer 与内存中的 task/controller 数量。

这和 #75 的根因不同：#75 是**单个请求**可用巨大数组在进入执行前同步展开数千万 SubTask；这里即使每个请求只有 1 个 target × 1 个 source item，也能通过**大量小请求**绕过单 task worker 限制，因为 transfer subsystem 没有一个拥有全局 admission / capacity 的 owner。

## 109. SSH Suspend 的落盘日志没有 startup reconcile；Backend 正常关闭时会主动保留随后永远不可达的孤儿日志

> 确认问题（durable file 无恢复／清理 owner）：SshSuspend dispose clear sessions 后只 flush log，LocalSuspendedSessionLogStore 无启动 enumerate/prune。文件仍可由宿主手工处理，不是物理不可访问；缺少产品内回收入口。

`SshSuspendService` 的 suspended-session catalog 完全是进程内 Map：

```ts
private readonly sessions = new Map<number, Map<string, SuspendedSessionRecord>>();
```

而终端历史由 `LocalSuspendedSessionLogAdapter` 单独持久化到：

```ts
this.directory = path.join(dataDirectory, 'temp_suspended_ssh_logs');
```

每个日志可以保留最多 100 MiB，compaction 期间还有 32 MiB batch slack。正常用户删除/终止 suspended session 时，service 会同时删除对应文件：

```ts
await this.logs.delete(record.logIdentifier).catch(() => undefined);
```

但进程 shutdown 使用的是完全不同的生命周期。`application.stop()` 最终调用 `services.dispose()`，composition root 再调用：

```ts
await workspaceSuspend.dispose().catch(() => undefined);
await sshSuspend.dispose().catch(() => undefined);
```

`SshSuspendService.dispose()` 会先永久清空 catalog，然后关闭 transport，最后**只 flush、不 delete** 日志：

```ts
const records = [...this.sessions.values()].flatMap((map) => [...map.values()]);
this.sessions.clear();
...
for (const record of records) {
  ...
  await record.transport.close().catch(() => undefined);
  await this.logs.flush(record.logIdentifier).catch(() => undefined);
}
```

下一次 Backend 启动时会创建新的 `LocalSuspendedSessionLogAdapter` 和新的空 `SshSuspendService`。`SuspendedSessionLogStore` contract 只有 append/flush/read/delete，没有 list/recover/prune API；`LocalSuspendedSessionLogAdapter` 也没有扫描 `temp_suspended_ssh_logs` 的初始化逻辑。全仓只有持有现存 session/mark 的运行时路径会调用 `logs.delete()`，启动路径不会枚举旧文件。

因此触发链是确定的：存在挂起 SSH session → 正常停止 Backend → `dispose()` 清空唯一的 session→log 关联，但保留 `.log` → 新进程以空 session Map 启动 → 旧日志既不能出现在 suspended catalog，也没有任何 owner 能再次导出或删除它 → 每次带挂起会话的正常重启都可以继续积累不可达日志。

这和 #83 的“运行期间 suspended session 数量/日志资源无上限”不同。#83 的日志仍有 live session owner，用户可以逐条 terminate；这里是 shutdown 明确切断 owner 后仍保留 durable file，随后没有 recovery/reconcile owner，属于持久资源生命周期断裂。

## 110. Workspace `upload.prepare` cache 没有 TTL / 数量上限 / consume 回收；不同 `prepareId` 可以在单个 Workspace 生命周期内永久堆积目录集合

> 确认问题：StreamUploadOperationService prepared Map 只在 cancelOwner 删除；单 prepare 20,000 目录限制不等于 aggregate capacity。batch 可被多个文件复用，不能简单要求第一次 start 就 consume；需 batch release/TTL/admission，未压测。

`StreamUploadOperationService` 为批量上传维护了一个进程内 prepare cache：

```ts
private readonly prepared = new Map<string, PreparedBatch>();
```

单次 `prepare()` 只限制一个请求最多 20,000 个目录，并允许最长 512 字符的 `prepareId`：

```ts
if (!request.prepareId || request.prepareId.length > 512) throw new Error('Invalid upload prepare id.');
if (request.directories.length > 20_000) throw new Error('Too many upload directories.');
...
this.prepared.set(this.prepareKey(request.ownerId, request.prepareId), {
  ownerId: request.ownerId,
  sessionId: request.sessionId,
  basePath,
  directories,
});
```

这里的 20,000 只是**单 batch 大小**，不是 cache capacity。`WorkspaceProtocolSession.uploadPrepare()` 对认证 Workspace WebSocket 直接开放该操作；`WorkspaceOperationsService.prepareUpload()` 虽然通过 mutation guard 绑定 `upload.prepare:${prepareId}`，但不同 `prepareId` 会被视为不同 operation，不存在 owner 级配额。

后续 `upload.start` 只读取这个 batch：

```ts
const batch = this.prepared.get(this.prepareKey(request.ownerId, request.prepareId));
```

无论 upload 最终 completed、skipped、conflict、failed，代码都不会 delete 已消费的 prepare entry。Frontend 自己会在该 batch 下最后一个 upload 消失后执行：

```ts
prepareRequests.delete(request.prepareId);
```

但这个只是浏览器内 Map，没有向 Backend 发送对应 release。Backend 唯一批量清理 prepare cache 的路径是整个 Workspace owner cleanup：

```ts
for (const [key, batch] of this.prepared) if (batch.ownerId === ownerId) this.prepared.delete(key);
```

因此触发链是确定的：保持一个 Workspace 存活 → 连续发送不同 `prepareId` 的合法 `upload.prepare` → 每次最多把 20,000 个 normalized directory string 保存在新的 `Set` → 即使对应上传已经结束，prepare entry 仍继续驻留 → 只有 Workspace 整体 teardown 才统一释放。客户端不需要维持 active upload，也不需要构造超大单请求，就能让 Backend heap 随 prepare 历史持续增长。

这里缺的是 prepared-batch 自己的生命周期 owner。它现在既不是一次性 token，也不是 TTL cache，也没有 max entries / max retained directory strings；Frontend 的生命周期和 Backend 的生命周期已经分离。

## 111. Workspace WebSocket 没有 in-flight request / file-operation admission limit；客户端可以绕过 Frontend scheduler 并发放大 SFTP stream、positioned copy 与远端 archive command

> 确认问题：`websocket-server.ts:192` 并发 handleMessage，各 operation Map 仅 ID 去重；Frontend 上传 scheduler 不是 server admission。已有 mutation resource lease 会限制冲突目标，但不同目标仍可并行；不声称相同路径可任意绕过 lease。

Workspace WebSocket 的消息入口直接并发派发每一帧：

```ts
socket.on('message', (data, isBinary) => void protocol.handleMessage(data, isBinary));
```

`WorkspaceProtocolSession.handleMessage()` 有单消息 1 MiB 限制，但没有 per-socket in-flight request 计数、队列或 semaphore；每个 handler 都可以同时进入 `route()`。因此 Backend 的资源并发上限不能依赖调用方按顺序 await response。

文件操作路径本身也只有“相同 ID 不重复”的保护，没有 owner/global capacity：

- `StreamUploadOperationService.active` / `pending` 是无上限 Map，`upload.start` 只拒绝相同 `uploadId`；每个 active upload 会打开一个 remote write stream；
- `StreamTransferOperationService.active` 同样只按 `ownerId + requestId` 去重，没有 active transfer 上限，而单个 transfer 的 positioned copy 默认并发就是 32；
- `RemoteArchiveOperationService.activeByOwner` 只拒绝相同 requestId，没有 `activeForOwner` 上限，每个 archive operation 可启动独立 remote command。

Frontend 确实为 upload 做了 6–12 条 stream scheduler：

```ts
const UPLOAD_SCHEDULER_MIN_STREAMS = 6;
const UPLOAD_SCHEDULER_STREAM_CEILING = 12;
...
while (queuedUploads.length > 0 && activeUploads.size < streamLimit) { ... }
```

但这只是浏览器侧策略，不是 Backend contract。认证客户端可以直接在同一 Workspace socket 上用不同 request/upload id 连续发送 `upload.start`、`transfer.copyMove`、`transfer.compress`、`transfer.decompress`；由于 server 的 message callback 不等待上一条 `handleMessage()`，这些请求会并行进入各自 service。copy/move/compress/decompress 入口还会 fire-and-forget `startTransfer/startCompress/startDecompress` 并立即返回 `{ started: true }`，因此 control RPC 本身不会形成背压。

结果是一个 Workspace 可以同时持有大量 open SFTP write stream、多个每任务最多 32 路的 positioned copy，以及多条远端 zip/tar/unzip command。Frontend scheduler 只能约束官方 UI，无法构成系统级资源不变量；直接协议客户端、失控 UI 或未来新的调用方都可以绕过它。

这和 #108 的 Server Transfer 不同：#108 是 `/transfers/send` 子系统为每个 task 建立独立 source ExecutionSession/target transport，却没有 system-wide task capacity；这里是 Workspace WebSocket 自己缺少 in-flight/admission owner，资源放大发生在既有 Workspace ExecutionSession 上的 SFTP/file-operation plane。

## 112. `upload.start` 建立 active upload 后没有 idle deadline；客户端不发送数据即可永久占住远端写流、临时文件与持续续租的 mutation lease

> 确认问题：StreamUploadOperationService active 无 activity/deadline；LeaseMutationGuard timeout 只在 acquire loop，成功后持续 renew。断链/显式 cancel/owner cleanup 是已有回收路径；未测试保持 control socket 但不建 data socket 的 idle upload。

Workspace 上传是 control plane 与 data plane 分开的两阶段协议。`upload.start` 先在 control WebSocket 上建立 Backend upload state；`StreamUploadOperationService.start()` 随后会立即创建临时文件并打开远端写流：

```ts
temporaryPath = path.posix.join(destinationDirectory, `.nexus-upload-${request.uploadId}.part`);
await filesystem.removeFile(temporaryPath, { ignoreMissing: true });
stream = await filesystem.openWrite(temporaryPath, { highWaterMark: WRITE_HIGH_WATER_MARK });
...
this.active.set(key, upload);
emit({ type: 'ready', uploadId: request.uploadId });
```

只要声明的 size 大于 0，后面就只能靠 data WebSocket 的 chunk、显式 cancel/abort，或整个 Workspace cleanup 才会离开 active state。`ActiveUpload` 没有 `lastActivityAt`、idle timer 或 absolute deadline；`append()` 也不会刷新任何超时，因为根本没有超时 owner。

Data WebSocket 的 cleanup 只能覆盖“**已经建立过 data socket，后来 socket close/error**”的情况：

```ts
socket.once('close', cleanupIncompleteUpload);
socket.once('error', cleanupIncompleteUpload);
```

客户端完全可以在收到 `upload.start` 成功/`ready` 后不建立 upload data WebSocket。此时没有 socket 可以触发 `cleanupIncompleteUpload()`。即使已经建立 data socket，只要客户端正常响应 WebSocket heartbeat 但永远不发送足够字节，连接同样可以保持存活而不会触发 abort。

这一状态还持有 Workspace 的 mutation guard。`WorkspaceOperationsService.startUpload()` 在调用 upload service 前执行：

```ts
const handle = await this.mutationGuard.beginMutation(...);
this.uploadGuards.set(key, handle);
```

该 handle 只在 upload terminal event、cancel/abort 或 Workspace cleanup 时 `confirm()/unknown()`。`LeaseMutationGuardAdapter` 对已经获得的 lease 会启动周期性 renewal：

```ts
const timer = setInterval(renew, LEASE_RENEW_INTERVAL_MS);
...
await this.leases.renew(leaseIds, owner, LEASE_TTL_SECONDS);
```

所以 `timeoutSeconds: 300` 只限制**获取 lease 等待多久**，不是 mutation 的最长执行时间。一个 abandoned upload 会持续续租目标路径，长期阻止其它受同一 guard 保护的 mutation；与此同时 `.nexus-upload-<id>.part` 的 SFTP writable 仍保持打开，active Map 也保留完整 upload state。

触发链不需要大文件或高并发：发送一个合法的 `upload.start(size > 0)` → Backend 打开 `.part` 与 write stream 并开始续租 → 客户端不连接/不完成 data plane → 没有任何 idle/absolute timeout → 资源和路径 lease 一直活到显式取消、SSH 断开或 Workspace 整体 teardown。这里缺的是 upload session 本身的 lifecycle deadline，和 #111 的“同时可以创建多少个 active upload”是两个独立不变量。

## 113. SFTP Download Ticket 的 capacity 只限制 ticket 数，不限制每个 ticket 的并发 claim / read stream；一个 token 就能绕过 64/512 配额制造无界下载流

> 确认问题（stream admission 与 ticket 数不同）：DownloadTicketRegistry claim 同 ownerIp 递增 activeRequests 无阈值，attachStream 无 capacity。重复 claim 是复用既有 token，不是创建更多 token 绕过其数量限制；HTTP／远端资源影响未测。

HTTP SFTP 下载专门有一个看起来很明确的容量边界：

```ts
const MAX_PER_USER = 64;
const MAX_TOTAL = 512;
```

`issue()` 会在创建新 ticket 前执行 `ensureCapacity(userId)`，所以**ticket row 数量**确实被限制。但 ticket 一旦存在，`claim()` 对同一个 owner IP 没有任何 active request 上限：

```ts
if (lease.state === 'waiting') {
  lease.state = 'active';
  lease.ownerIp = requestIp;
} else if (lease.ownerIp !== requestIp) {
  return { status: 'locked' };
}
lease.activeRequests += 1;
this.touch(lease);
return { status: 'ok', lease };
```

也就是说 owner lock 只阻止**其它 IP**，不会阻止同一 IP 同时复用 token。每个成功 GET 随后都会重新打开一个远端 read stream：

```ts
const stream = await target.filesystem.openRead(remotePath, range || undefined);
if (lease) tickets.attachStream(lease, stream);
await pipeline(stream, response);
```

`attachStream()` 只是把它们全部加入 Set，也没有阈值：

```ts
lease.activeStreams.add(stream);
```

而 `oldestIdle()` 恰好会跳过任何 `activeRequests` 或 `activeStreams.size` 非零的 ticket，所以这种 ticket 还不能在 capacity eviction 时被回收。传输过程中每个 `data` 又会 `touch()` 把 TTL 延长 5 分钟，持续活动的 stream 不会自然过期。

因此 `MAX_PER_USER=64 / MAX_TOTAL=512` 并不是 download stream capacity：拿到**一个**合法 token 后，从同一来源并发发出 N 个 GET/Range GET，每个 claim 都成功、每个请求都可打开独立远端 stream，`activeRequests` 和 `activeStreams` 随 N 增长。甚至认证态 `/api/v1/sftp/download` 在不带 ticket 时直接走 session 参数路径，完全不进入 `DownloadTicketRegistry`，同样没有 per-user/global active-download admission。

目录下载同样不进入这个 registry。`/download-directory` 每个请求都会直接 `createDirectoryArchive()`，而 ZIP adapter 对每个正在读取的文件默认启动 32 路 positioned read：

```ts
const ARCHIVE_READ_CONCURRENCY = 32;
```

单个 archive 内部有 one-file gate，但多个 HTTP archive 请求之间没有共享 gate 或 admission，因此 N 个目录下载可以各自持有自己的 ZIP pipeline 和 32 路远端 read batch。

结果是 download ticket registry 管住了短时 capability 的数量，却没有一个 owner 管真实的 SFTP read workload。大量并发文件/目录下载会扩大远端 file handle/read stream、positioned read、ZIP pipeline/HTTP response 和内存中的 request state；ticket 数量配额不能对这些资源形成上限。

## 114. 普通 Workspace session 没有 per-user / global 数量上限；认证用户可用不同 `workspaceId` 线性创建 SSH transport、shell 与 ExecutionSession

> 确认问题：WorkspaceService canCreate 只看 ID，registry/ExecutionSessionManager 无 count admission；Agent Workspace maxActiveWorkspaces 不覆盖传统 SSH Workspace。身份认证、heartbeat 与断线 cleanup 已有，缺少总量预算，未压测。

Workspace control WebSocket 的 `workspace.connect` 只检查 ID 唯一性：

```ts
if (!this.dependencies.workspace.canCreate(workspaceId)) throw new Error(`Workspace ${workspaceId} already exists.`);
```

而 `WorkspaceService.canCreate()` 只是确认两个 registry 里没有同名 ID：

```ts
canCreate(id: string): boolean {
  return Boolean(id) && !this.sessions.get(id) && !this.executionSessions.get(id);
}
```

这里已经有 `listUserSessions(userId)`，说明 service 知道 session 的 user ownership，但 connect 前没有使用它做 quota。`WorkspaceSessionRegistry` 本身也是无上限 Map；`ExecutionSessionManager` 同样没有全局/owner session limit。

每一个成功 connect 都会建立一份新的远端执行资源：

```ts
execution = await this.executionSessions.connect({
  id: request.workspaceId,
  ownerType: 'workspace',
  ownerId: String(request.userId),
  connection: resolved,
  ...
});
...
const shell = await execution.openShell(...);
...
this.sessions.set(session);
```

WebSocket server 对 Workspace client 也只有观测计数：`clients` 是普通 `Set<ClientRecord>`，`trackClient()` 记录 `activeClients: clients.size`，没有 workspace-kind 或 user 级 connection admission。Agent WebSocket 有自己的 session/subscription 约束，但普通 Workspace upgrade/connect 路径没有对应限制。

因此认证用户可以打开 N 条 Workspace WebSocket，以不同合法 `workspaceId` 对同一个或不同 SSH Connection 连续执行 `workspace.connect`。每次都会产生新的 SSH transport + `ExecutionSession` + shell + Workspace registry row；后续还可以各自建立 SFTP/control channel、status polling 和文件操作。总体资源按 Workspace 数近似线性增长，而系统没有一个 authority 决定单用户/全局最多允许多少 live Workspace。

这和 #108、#111 分别属于不同层级：#108 是 Server Transfer 的 system-owned ExecutionSession 数量无上限，#111 是**一个既有 Workspace 内**的 file-operation 并发无上限；这里是用户可创建多少个顶层 interactive Workspace/SSH session 本身没有 admission boundary。

## 115. Agent Workspace Terminal 没有 session 配额；每条 `/ws/agent-terminal` 新连接都能在 Runner 新建 PTY/login shell 子进程

> 确认问题：WorkspaceRuntimeTerminalService open 无 session count gate，Runner writer counter 只互斥 checkpoint/lifecycle；不带已有 sessionId 会创建新 terminal。需已授权 Workspace/capability，不能称匿名进程创建。

Agent terminal WebSocket 每次建立连接都会调用：

```ts
const session = await this.workspaceRuntime.openTerminal(
  { userId: this.context.userId, appId: this.context.appId },
  this.context.workspaceId,
  this.context.generation,
  this.context.columns,
  this.context.rows,
  this.context.sessionId,
);
```

如果没有传 `sessionId`，`WorkspaceRuntimeTerminalService.open()` 不会尝试复用已有 terminal，也没有 per-user/per-App/per-Workspace 数量检查，而是直接创建新的 backend interactive session：

```ts
const session = await this.sessions.open({ ...scope, workspaceId, generation, columns, rows }, signal);
...
this.managed.set(managed.id, managed);
```

`managed` 是无上限 `Map`。断开后有 detach grace 和 replay buffer 上限，这能处理短暂断线，但并不限制**同时创建多少个不同 managed terminal**。

Backend→Runner adapter 也是同样结构：

```ts
private readonly active = new Set<RunnerWorkspaceTerminalSession>();
...
const socket = await this.tunnels.openTerminalWebSocket(...);
...
this.active.add(session);
```

Runner 最终对每条 terminal tunnel 都会创建独立临时目录，并启动真实子进程/PTY wrapper：

```ts
const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-terminal-'));
...
const child = spawn('script', ['-qefc', `exec /bin/sh ${wrapper}`, '/dev/null'], ...);
```

`WorkspaceRuntimeEngine.acquireWorkspaceWriter()` 只阻止 checkpoint/lifecycle mutation 与 terminal writer 同时进入；对已有 writer 数量只是 `workspaceWriters + 1`，并不会拒绝第二、第三个 terminal：

```ts
this.workspaceWriters.set(key, (this.workspaceWriters.get(key) ?? 0) + 1);
```

WebSocket server 对 `/ws/agent-terminal` 也没有连接数 admission。因此只要用户/App 已有该 Workspace 的 `shell.execute` capability，就可以并发建立 N 条不带 `sessionId` 的 terminal socket；每条都会跨 Backend 和 Runner 注册 session，并生成一套 `script` + login shell 进程、PTY、临时目录、WebSocket tunnel 与 writer ownership。资源按连接数线性增长，当前没有一个 authority 表达每 Workspace/App/user 可以拥有多少 live interactive terminals。

这个问题和 #114 不同：#114 是传统 SSH Workspace 顶层 session 数量无上限；这里即使 Agent Workspace 数固定为 1，也可以在同一个 Runner Workspace generation 内无限增加 PTY 子进程。

## 116. Remote Desktop 的 1024 上限只覆盖 pending ticket；ticket 一经消费就退出计数，active Guacamole/RDP/VNC session 没有任何 Nexus 侧容量 owner

> 确认问题（Nexus admission 缺口）：GuacamoleRuntimeAdapter consumeTicket 删除 pending，通用 client tracking 无 active limit。guacd/远端自身可能有系统容量限制，但不是 Nexus 用户／全局 quota；未建立大量桌面连接。

`GuacamoleRuntimeAdapter` 明确给 pending ticket 设置了全局上限：

```ts
const MAX_PENDING_TICKETS = 1024;
...
if (this.tickets.size >= MAX_PENDING_TICKETS)
  throw new Error('远程桌面会话请求过多，请稍后重试。');
```

但这个 Map 只拥有**还没连接的 ticket**。WebSocket 使用 ticket 时，`consumeTicket()` 会在真正建立 Guacamole connection 之前立即删掉它：

```ts
const record = this.tickets.get(ticket);
...
this.tickets.delete(ticket);
return record;
```

`acceptSession()` 随后创建 bridge settings 并把 socket 交给 `guacamole-lite`：

```ts
this.pendingBridgeSettings.set(bridgeId, this.toGuacamoleSettings(record.request));
...
void this.server.newConnection(socket, requestWithInternalToken).catch(...);
```

`pendingBridgeSettings` 也不是 active-session registry；它只为一次内部 token→connection settings 握手临时保存凭据，`processConnectionSettings()` 成功解析时马上 delete。之后 Nexus 自己没有 `activeSessions` Map/Set、per-user count、global count 或 admission hook。WebSocket server 的 remote-desktop `ClientRecord` 同样只是进入通用 `clients` Set 做 heartbeat/metrics，没有容量拒绝逻辑。

因此 1024 不是远程桌面连接上限。认证用户可以循环执行：创建 session ticket → 立即连接 `/ws/remote-desktop` 消费 ticket → `tickets.size` 重新减 1 → 再创建下一张。只要每次及时消费，pending ticket 数可以始终很低，而已经交给 Guacamole/guacd 的 active RDP/VNC session、WebSocket bridge、远端桌面连接会持续增加。

这里缺的是 ticket lifecycle 之后的 session ownership。当前 capacity owner 在 capability 被消费的瞬间就失去视野，所以 `MAX_PENDING_TICKETS` 无法约束真正昂贵的 active Guacamole workload。

## 117. Backend Plugin 的总进程容量策略待确认

> 待确认（受信插件容量策略）：instances Map 无 aggregate process gate 属实，新安装默认 disabled 且 enable/信任为显式操作。是否必须 hard quota 取决于单用户管理员资源治理要求；不能仅凭可安装任意数量就定为权限漏洞，未做容量测试。

Backend Plugin instances 无总 process 配额，单进程 IPC/Host operation 有限制；安装默认 disabled，enable 是显式受信管理操作。待根据单用户部署的 OS/container 预算评估是否需要应用层总量 admission。

## 118. MCP Integration 的 aggregate session 容量策略待确认

> 待确认（容量策略）：Integration/McpAdapter 无总 session quota，单 session schema/fetch limits 和连接超时存在。可信管理员配置多个 MCP 可以是正常需求；需根据部署预算确认 admission 要求，未测实际增长规模。

Integration/McpAdapter 无总 MCP session quota；单 session 有连接 timeout、schema 和 dispatcher 限制，disable/remove 有清理。待根据可信管理员配置规模确认 aggregate admission 需求；未测容量退化。

## 119. Model tool-call 数量上限只在 provider stream 结束后检查；OpenAI-compatible endpoint 可在最终拒绝前持续扩大 tool-call/continuation 内存状态

> 确认问题（ingest cardinality fence 缺口）：openai-provider.adapter indexFor 无数量 gate，Root/Child Map 结束后才拒绝 batch。单参数字节上限、deadline/max tokens 限制仍有效但不能替代本地累计数量；未发送恶意模型流。

Root execution 明确定义了单个 model step 最多 64 个 Tool call：

```ts
export const MAX_TOOL_CALLS_PER_MODEL_STEP = 64;
```

但这个上限不是流入阶段的 admission invariant。`ModelStepRunner.runAttempt()` 先把 provider stream 中每个 `tool.delta` 都累计进一个 Map：

```ts
const toolCalls = new Map<number, ModelToolCall>();
...
const current = toolCalls.get(event.index) ?? { argumentsJson: '' };
if (event.id) current.id = event.id;
if (event.name) current.name = event.name;
if (event.argumentsDelta) current.argumentsJson += event.argumentsDelta;
toolCalls.set(event.index, current);
```

只有整个 stream 返回到 `NativeAgentBackend` 之后，Root 才执行：

```ts
const orderedToolCalls = [...modelToolCalls.entries()].sort(...);
if (orderedToolCalls.length > MAX_TOOL_CALLS_PER_MODEL_STEP) {
  throw new Error('MODEL_TOOL_CALL_BATCH_TOO_LARGE');
}
```

Subagent 也是同一时序，只是最终阈值为 32：`SubagentModelStepExecutor` 在 `for await (const event of this.modelPort.stream(...))` 中持续向 `toolCalls` 写入，等 stream 完整结束后才判断 `toolCalls.size > 32` 并把 attempt 标记失败。

OpenAI-compatible adapter 确实限制了**单个** Tool 参数最多 32 KiB，但没有限制流中出现多少个不同 Tool call。它会为每个新 id 扩大多组状态：

```ts
const toolIndexes = new Map<string, number>();
const toolNames = new Map<string, string>();
const toolBytes = new Map<string, number>();
const sawToolDelta = new Set<string>();

const indexFor = (id: string): number => {
  const existing = toolIndexes.get(id);
  if (existing !== undefined) return existing;
  const index = toolIndexes.size;
  toolIndexes.set(id, index);
  return index;
};
```

Responses protocol 还会把完成的 Tool call 再记录到 `OpenAiResponsesContinuationCollector.tools`。这个 collector 自己同样没有 ingest-time 数量检查；`MAX_CONTINUATION_PARTS = 512` 只出现在 continuation decode 路径，并不会阻止当前 provider stream 先累计更多项。

Provider 是用户可配置的 `openai-compatible` endpoint，`baseUrl` 可以指向兼容服务，因此 Backend 不能把远端严格遵守请求中的 `maxOutputTokens` 或合理 Tool-call cardinality 当成本地资源边界。触发链可以是：配置一个合法 compatible endpoint → endpoint 在一次 response 结束前连续发送 N 个不同 `tool-input-start` / `tool-call` id → adapter、Root/Child attempt Map 和 Responses continuation collector 随 N 增长，每个调用还可携带各自最多 32 KiB 参数 → 直到 provider 最终 finish 后，Root 的 64 或 Child 的 32 才开始拒绝这一批。

因此当前的 Tool-call batch limit 只能约束**最终是否执行**，不能约束接收 provider stream 时的 peak heap、Map/string 分配和 transient `tool.delta` 处理量。一个失控或恶意兼容 endpoint 可以在最终得到 `MODEL_TOOL_CALL_BATCH_TOO_LARGE` 之前先把 Backend 资源消耗放大到远高于声明的 batch 上限。

## 120. Runner Journal 每次状态变更都同步重写并 fsync 整份历史；持久 job/command 变多后单次提交成本随全部历史线性增长并阻塞 Runner event loop

> 确认问题（同步工作量放大）：`agent-runner/src/controller/journal.ts:545–559` 整份 stringify/write/fsync；collection capacity/compaction 已有，不能称历史无限增长。结构性同步成本成立，实际延迟／严重程度待基准测试。

`RunnerJournal` 允许 command/job collection 分别增长到 16,384 项，达到高水位后也仍可保留 12,288 项；Workspace job 的单条 stdout+stderr 又允许最多 1 MiB：

```ts
const MAX_JOURNAL_COLLECTION_ITEMS = 16_384;
const JOURNAL_COLLECTION_HIGH_WATER = 12_288;
const MAX_WORKSPACE_JOB_OUTPUT_BYTES = 1024 * 1024;
```

这些历史不是 append log 或分记录持久化。所有 mutation 最终都进入同一个 `commitState()`：

```ts
private commitState(nextState: JournalState): void {
  this.flushState(nextState);
  this.state = nextState;
}

private flushState(state: JournalState): void {
  const temp = `${this.filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  fsyncFile(temp);
  fs.renameSync(temp, this.filePath);
  fsyncDirectory(path.dirname(this.filePath));
}
```

因此一次局部状态变化会重新物化并写入完整 `commands + workspaces + jobs`。例如一个 background job 正常生命周期至少会触发：

```ts
journal.beginJob(...);   // pending
journal.runningJob(...); // running
journal.succeedJob(...); // terminal + stdout/stderr
```

每一步都会复制 jobs object、`JSON.stringify()` 整个 journal、同步写临时文件、fsync 文件、rename，再同步 fsync 目录。Workspace lifecycle 的 `begin/running/succeed/fail/saveWorkspace` 也复用同一条 full-snapshot commit。

`compact()` 不会在每次 terminal transition 后把历史维持在小规模。它只在 Runner 构造时和 collection 已达到 capacity、准备插入新项时触发；而 `TERMINAL_HISTORY_LIMIT = 4096` 的常规裁剪还要求记录至少已经完成 24 小时。于是数千到上万条近期 terminal job/command 可以合法同时留在 journal 中，每条 job 又可能携带较大的结果文本。

Runner HTTP server、ACP/Terminal/Browser WebSocket 和这些 journal mutation 都运行在同一个 Node 进程。`writeFileSync`、`fsyncSync`、`renameSync`、目录 `fsyncSync` 都直接占用主 event loop；journal 越大，任意一个新的 command/job 状态切换就需要越多同步 JSON 分配和磁盘 I/O。触发链是：长期产生合法 Workspace command/background job 历史 → journal 累积大量 terminal records/output → 任意下一次 begin/running/terminal/saveWorkspace → 同步重写整份历史 → 在写入完成前同 Runner 的 HTTP upgrade、Terminal/ACP/Browser socket 事件和其它 Workspace 请求都无法在 JS event loop 上继续处理。

因此 Journal 的 collection capacity 只限制“最终最多保存多少条”，没有限制**每次 durable commit 的同步工作量**。随着持久历史增加，单个很小的状态变更会被放大成与整个 Runner 历史大小成正比的阻塞操作。

## 121. Agent Queue 的公平性与单用户／跨 App 调度契约待确认

> 待确认（单用户产品前提）：`runtime/scheduling/scheduler.ts:213–215` requeueFront+break、created 全局 count 成立。正常 Nexus 为单用户，跨用户公平性场景不是既有支持承诺；同用户跨 App head-of-line 仍需结合预期调度与 workload 验证。

Root 队列按 appId 分组，遇到 user capacity 满时 requeueFront 并 break；created admission 为全局20。Subagent 也可能在选中饱和 user 后退出 pump。跨用户公平性不在正常单用户产品前提内；同用户跨 App 排队是否不合理须用实际 workload 和预期优先级验证。

## 122. Agent Memory 没有总数量/retention/delete owner；candidate、revoked 和 expired memory 会永久保留在 SQLite 与 FTS，超过最新 200 条后又无法通过 list API 重新枚举

> 确认问题（管理可达性／规模边界）：MemoryService list≤200 无 cursor/offset，repository 未给管理面完整枚举；status/expiry 只过滤 recall，非 purge。保留历史可能有审计价值，不能要求 revoked 必须立即物理删除；旧记录管理入口缺口保留。

Memory 的单条输入有明确大小边界：content 最多 16 KiB、source refs 最多 32 KiB。但 `MemoryService.propose()` 没有查询当前 user/App 的 memory 数量，也没有 quota：

```ts
const memory = await this.repository.propose({
  id: randomUUID(),
  scope,
  ...proposal,
  proposedByRuntimeId: provenance?.runtimeId ?? null,
  now,
});
```

这不只依赖用户手工操作。Agent Tool catalog 自身暴露了 `propose_memory`，每次调用都会创建新的 candidate：

```ts
const memory = await memories.propose(context, inspection.normalizedArguments, {
  runId: context.runId,
  runtimeId: context.agentRuntimeId,
});
```

Memory lifecycle 没有删除状态。`review()` 对 `reject` 和 `revoke` 都只是把记录改成 `status='revoked'`；`expiresAt` 也只在 recall/import query 中作为过滤条件。全仓运行时代码没有 `DELETE FROM ai_memories`，也没有 memory retention/sweep。

FTS 同样不会因为 revoke 或过期而释放索引项。`ai_memories_search_insert` 对每条 memory 无条件插入：

```sql
CREATE TRIGGER IF NOT EXISTS ai_memories_search_insert
AFTER INSERT ON ai_memories
BEGIN
  INSERT INTO ai_memories_search(rowid, terms)
  VALUES (NEW.rowid, nexus_search_terms(NEW.content));
END;
```

update trigger 只监听 `content`，不监听 `status` / `expires_at`；真正清理 FTS 的 delete trigger 又要求基础 row 被删除，而当前没有对应 lifecycle。

因此 candidate 从未 review、candidate 被 reject、published memory 后续 revoke、以及 published memory 到达 `expiresAt`，都会继续永久占用 `ai_memories` 与 `ai_memories_search`。Recall 虽然通过 `status='published'` 和 `expires_at > now` 避免返回它们，但这只是查询过滤，不是资源回收。

管理面还把这个 retention 缺口变成可达性问题。`MemoryService.list()` 将 `limit` 固定在最多 200：

```ts
const MAX_LIST = 200;
...
return this.repository.list(scope, status, limit);
```

repository 只做 `ORDER BY updated_at DESC, id DESC LIMIT ?`，没有 before/cursor/offset；service 也没有 `get(memoryId)` 或 delete API 暴露给管理面。只要同一 App 累积超过 200 条同状态 memory，较旧条目在重新加载后就无法通过 list 继续翻页取得，因而也无法正常通过 review flow 找回并处理。

触发链是：长期 Run 持续调用 `propose_memory` 或用户反复创建 memory → candidate/revoked/expired rows 永不回收且 FTS 同步增长 → 最新 200 条之外的旧记录退出可枚举管理窗口 → SQLite/FTS 持久状态仍随历史单调增长。`maxRecallItems/maxRecallBytes` 只限制每次送入模型的 recall 结果，不能约束这个 durable memory owner 的总规模。

## 123. Plugin 全局 immutable package namespace 与 publisher／user identity 契约待确认

> 待确认（全局 immutable namespace／单用户设计）：verify 写全局 version，hash 不同拒绝，信任按 user；源码事实成立，但全局同 app/version 唯一可以是设计约束，正常单用户产品不承诺各用户同名插件隔离。需确认 publisher identity 应否进入 key，以及 verified-only row 回收策略。

Stage/trust/installation 按 user，版本与文件目录按全局 appId/version immutable identity；verify 即写 version，不同 hash 会冲突，verified-only row 无常规删除。全局同名版本唯一可能有意，需确认 publisher identity 和未安装版本回收契约；不认定正常单用户存在跨租户抢占漏洞。

## 124. Plugin Frontend 静态代码公开策略与私有包保密要求待确认

> 待确认（有意隔离的静态 code surface）：`plugin-frontend-static-server.ts` 确实匿名 public/CORS，且有专门 CSP；前端 JS 通常不承载用户 secret，静态资源公开不自动等于权限绕过。须确认是否支持私有代码保密，并区分 descriptor 授权／Host RPC 权限；未验证私有资源场景。

Plugin static handler 在 Express 前处理 /plugins 与 /sdk，资源匿名 public immutable/CORS，另有 CSP 和路径/marker 校验。Host RPC 权限并未因此自动公开。需确认插件前端代码是否有私有保密要求；JS/CSS公开不自动构成身份授权漏洞，也不应在静态文件中保存用户secret。

## 125. Remote Plugin repository/package fetch 的管理员 egress 与 redirect 策略待确认

> 待确认（管理员 egress 策略）：HttpRemotePluginRepositoryAdapter follow redirect 且无地址分类 deny 属实；但本产品单用户管理内网服务，私有 repository 可为必要功能。应确认管理员是否视为可信服务器网络使用者，以及 redirect 允许边界，不直接把 private access 定为漏洞。

Remote repository/package adapter 接受 HTTP(S)，follow redirect，未统一拒绝内网/loopback/link-local或检查每跳地址。已有 response size 与 timeout 限制。内网 repository 是合理管理需求；待定义已认证管理员的 network authority、redirect与allowlist策略，不保留已确认SSRF漏洞定性。

## 126. Plugin Publisher revocation 历史的分页与保留策略待确认

> 待确认（安全历史保留策略）：repository 保留 revoked key 且整表 list 属实；撤销记录可能用于防止恢复旧信任／审计，不等于无用垃圾。分页与容量需根据实际规模验证，不能因为无 delete 就要求删除 trust tombstone。

revoked publisher key 保留，list 无分页；单 key PEM/label 有大小校验。撤销历史可能用于审计或防止恢复旧信任。待确认历史回收与分页策略，不能把未物理删除的revocation tombstone直接当泄漏。

## 127. Plugin Stage 只有单包大小与 24h retention，没有 per-user Stage count / aggregate bytes admission；重复 Stage/verify 可以在 retention 窗口内持续堆积数十到数百 MiB 的本地副本

> 确认问题（aggregate disk budget 缺口）：PluginPackageInstallCoordinator stage 仅 cleanupExpired，verifier 单包50MiB／展开200MiB，Remote Stage 不经过 Artifact quota。已有24h retention，不是永久所有 Stage 不回收；重复 Stage 的窗口容量未测。

Plugin package verifier 对单个包做了比较完整的局部限制：

```ts
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
```

下载 Stage 时 archive 会实际写入：

```ts
const finalPath = path.join(stageRoot, 'package.tar');
...
for await (const chunk of input.source) {
  bytes += chunk.byteLength;
  if (bytes > MAX_ARCHIVE_BYTES || bytes > input.sizeBytes) {
    throw new Error('PLUGIN_PACKAGE_TOO_LARGE');
  }
  await handle.write(Buffer.from(chunk));
}
```

Verify 又会在同一个 Stage directory 下生成 `unpacked/`，允许展开后总文件大小达到 200 MiB：

```ts
expandedBytes += entry.size;
if (expandedBytes > MAX_EXPANDED_BYTES) {
  throw new Error('PLUGIN_ARCHIVE_TOO_LARGE');
}
...
await tar.x({ file: archive, cwd: unpacked, ... });
```

验证成功后这个 `unpacked/` 不会立即清理；Stage 会被 adopt 到 `plugins/<appId>/staging/<stageId>`，直到 install/upgrade finalization 或 retention cleanup 才删除。Retention 固定为 24 小时：

```ts
const PLUGIN_STAGE_RETENTION_SECONDS = 24 * 60 * 60;
```

`cleanupExpiredStages()` 只按 `updatedAt <= now - 24h` 清理 expired Stage；它没有读取/累计 `size_bytes`，也没有 per-user Stage count、global Stage count 或 staging disk budget。创建 Stage 的路径只是先清理“已经过期”的历史：

```ts
async stage(...) {
  await this.cleanupExpiredStages();
  ...
  const stageId = randomUUID();
  const staged = await this.verifier.stage(...);
  ...
  await this.repository.createStage(record);
}
```

Remote Stage 同样如此，而且同一个 repository package 可以被反复 Stage：每次都会生成新的随机 `stageId`，repository schema 也没有 `(user_id, package_hash)` uniqueness 或其它 dedup admission。

因此单包 50 MiB/展开 200 MiB 并不能形成系统总资源边界。用户可以在 24 小时窗口内重复 Stage 同一合法 50 MiB package；如果继续 verify，每个 Stage 还能同时保留 archive 与最多约 200 MiB 的 unpacked tree。即使所有请求完全串行，持久 staging disk usage 也能随 Stage 次数线性增长，直到宿主磁盘耗尽。下一次 Stage 开始时执行的 `listStages()` / cleanup 还会随着未过期 Stage 数量做全表读取与逐项扫描。

这和 Artifact quota 不同：Remote Plugin package 直接进入 `data/agent/plugins/.../staging`，没有经过 Artifact Store 的 per-user/global byte reservation；Local artifact staging 即使源 Artifact 已受 quota 约束，也会再复制一份 package archive 到 Plugin staging owner。

## 128. 启用 2FA 后既有认证 Session 的撤销策略待确认

> 待确认（启用2FA的既有 session 策略）：TwoFactorService activate 未 revoke；requireAuthenticated 只读 session 字段。旧完整认证 session 继续有效属实，但启用2FA是否承诺注销已有 session 需确认；不能将正常已有会话称为绕过新登录 challenge。泄露 cookie 场景应与 #77 的 revocation 策略一起评估。

2FA activate 更新 user secret，未 revoke/rechallenge 已完整认证 session；升级认证状态的旧 session 不会回头执行新登录challenge。待确认启用2FA是否必须注销既有会话，尤其stolen-cookie威胁；缺少此策略不等于新登录2FA验证被绕过。

## 129. Passkey discovery 的公开标识符与使用状态隐私策略待确认

> 待确认（隐私／标准 discovery 行为）：auth routes 返回 hasPasskeys 与 allowCredentials 属实；credential ID 是公开标识符，不是私钥，username-based WebAuthn 返回它是标准用法。只能辨认“已配置Passkey”的候选账户，false 无法区分不存在／未配置；是否隐藏此信息须定隐私契约。

匿名 has-configured 返回布尔，username-based authentication options 返回 allowCredentials ID/transports。false 无法区分不存在/未配置；credential ID是公开标识符而非可登录secret。待确认单用户产品是否要求隐藏Passkey使用状态、是否增加discovery rate limit。

## 130. 2FA 登录失败只增加 IP blacklist 计数，不写认证 Audit / Notification；第二因素爆破在安全事件流里形成盲区

> 确认问题（安全可观测性不一致）：`two-factor.service.ts:33–34` 失败只 return valid:false，auth route 只 blacklist，不复用 login failure audit。IP blacklist 仍有保护，不是完全不设防；失败事件是否发送外部通知可另作策略选择。

密码登录失败时，`AuthService.authenticatePassword()` 会同时记录 `LOGIN_FAILURE` audit 并发布 notification：

```ts
if (!user || !(await this.hasher.compare(password, user.hashedPassword))) {
  await this.audit.logAction('LOGIN_FAILURE', {
    username,
    reason: user ? 'Invalid password' : 'User not found',
    ip: context?.ip,
  });
  await this.notifications.publish('LOGIN_FAILURE', {
    username,
    reason: user ? 'Invalid password' : 'User not found',
    ip: context?.ip,
  });
  return { status: 'invalid' };
}
```

Passkey authentication 失败也有专门的 `PASSKEY_AUTH_FAILURE`：

```ts
await this.audit.logAction('PASSKEY_AUTH_FAILURE', {
  credentialId,
  reason: 'Verification failed',
  ip: request.ip,
});
await this.notifications.publish('PASSKEY_AUTH_FAILURE', ...);
```

但 TOTP 验证失败时，`TwoFactorService.verifyLogin()` 只返回 `valid:false`：

```ts
if (!this.provider.verify(user.twoFactorSecret, token))
  return { valid: false as const, user: { id: user.id, username: user.username } };
```

HTTP route 随后只更新 IP blacklist：

```ts
const result = await dependencies.twoFactor.verifyLogin(userId, token, { ip });
if (!result.valid) {
  await dependencies.ipBlacklist.recordFailedAttempt(ip);
  response.status(401).json({ message: '验证码无效。' });
  return;
}
```

全仓没有 `2FA_LOGIN_FAILURE` / `TOTP_FAILURE` audit action，失败分支也没有复用 `recordLoginFailure()`。因此管理员看到的认证审计/通知流会包含密码失败、Passkey 失败以及成功的 2FA 登录，却缺失实际的第二因素失败尝试。

触发链是：攻击者先得到正确密码并进入 `requiresTwoFactor` Session → 对 6 位 TOTP 持续尝试 → 每次失败只触碰 IP blacklist row → Audit Log 和 Notification channel 没有对应认证失败记录。现有 #29 又已经证明 blacklist 在第一次封禁自然到期后不会重新进入新一轮封禁；因此这个缺失不是只有展示层影响，持续的第二因素猜测还可能在主要安全可观测面中长期保持不可见。

## 131. “密码正确、等待 2FA”的部分认证 Session 也会落盘 30 天，且没有 per-user/global Session 数量或磁盘 admission；仅掌握第一因素即可持续扩张 session 文件

> 确认问题（pending-auth 生命周期／容量）：file session TTL=30d，password-correct branch regenerate 并保存 partial auth，无独立短TTL/count gate。session-file-store 自有过期 reaping，不能说永不回收；需要知道正确密码才进入此分配路径，未压力测试。

`FileHttpSessionAdapter` 使用 `session-file-store`，所有 server-side Session 都写进 data directory 下的独立 session store，并配置固定 30 天 TTL：

```ts
const sessionsPath = path.join(options.dataDirectory, 'sessions');
fs.mkdirSync(sessionsPath, { recursive: true });
this.store = new FileStore({
  path: sessionsPath,
  ttl: 30 * 24 * 60 * 60,
});
```

密码正确且账户启用了 2FA 时，登录 route 会在第二因素验证之前主动 regenerate Session，然后写入 durable partial-auth state：

```ts
if (result.status === 'requiresTwoFactor') {
  await regenerateSession(request);
  request.session.userId = result.userId;
  request.session.requiresTwoFactor = true;
  request.session.rememberMe = Boolean(rememberMe);
  response.json({ message: '需要进行两步验证。', requiresTwoFactor: true });
  return;
}
```

因为 `saveUninitialized:false` 只阻止“完全未修改”的 Session 保存，上述 `userId/requiresTwoFactor/rememberMe` 已经使 Session 成为需要持久化的服务器状态。第二因素失败不会销毁该 Session；只有当前客户端后续成功验证、显式 logout、自然 TTL 到期，或者测试路径调用全局 `sessions.clear()` 才会回收。

当前 adapter 只暴露全局 `clear()`，没有 per-user count、global count、aggregate bytes、pending-2FA TTL 或 user-scoped prune。登录 route 对“密码正确”的请求也不会记入 failed-attempt rate limit；因此知道正确第一因素的人不需要通过 2FA，就可以并行使用大量无 Cookie 的客户端反复执行第一阶段登录，每次创建一个新的 partial-auth Session 文件。

触发链是：攻击者取得目标账户正确密码但没有 TOTP → 每次用新的 client/no-cookie 请求 `POST /auth/login` → password 验证成功并创建新的 `requiresTwoFactor=true` Session → 不提交第二因素，继续创建下一条 → session store 在 30 天窗口内按请求数线性增长。2FA 在这里阻止了业务权限，却没有阻止服务器磁盘状态分配；资源 admission 发生在第二因素完成之前。

## 132. Notification 出站网络的管理员授权与 allowlist 策略待确认

> 待确认（管理功能网络权限）：notification test/delivery 无私网地址 deny 属实，已有单请求超时；内网SMTP/Webhook 是正常自托管需求。需确认认证用户是否允许使用 Backend 网络、是否要求 allowlist/redirect policy，不把合法配置能力直接定为越权SSRF。

Notification unsaved test 与delivery可使用内网Webhook/custom Telegram domain/SMTP host，未有统一address deny；单请求网络超时已存在。内网通知是自托管正常需求。需定义管理员可用network权限、redirect/allowlist政策，不能仅凭配置任意目标判定越权。

## 133. Proxy create 与 update 使用不同 credential invariant；认证方式不变时可把必需 password/privateKey 清成 NULL，生成 create 路径永远不会接受的非法 Proxy

> 确认问题：`proxy.service.ts:114–118` 认证方式不变走 credential patch，允许空值置NULL，create/切换方式则拒绝缺凭据。HTTP parser 允许空／null；未发接口验证运行时错误。

`ProxyService.create()` 对 credential state 有明确约束。Password auth 必须有 password，Key auth 必须有 private key：

```ts
const authMethod = input.authMethod ?? 'none';
this.validateCredentials(authMethod, input, true);

private validateCredentials(authMethod, input, switching): void {
  if (authMethod === 'password' && switching && !input.password)
    throw new Error('代理密码认证方式需要提供 password。');
  if (authMethod === 'key' && switching && !input.privateKey)
    throw new Error('代理密钥认证方式需要提供 private_key。');
}
```

但 `update()` 只有在 `authMethod` 本身发生变化时才复用这个强校验：

```ts
if (input.authMethod !== undefined && input.authMethod !== current.authMethod) {
  this.validateCredentials(nextAuth, input, true);
  Object.assign(update, { authMethod: nextAuth }, this.protectCredentials(nextAuth, input));
} else {
  this.applyCredentialPatch(update, nextAuth, input);
}
```

认证方式保持为 `password` 时，patch 分支允许空值直接清掉 encrypted password：

```ts
if (authMethod === 'password' && input.password !== undefined) {
  update.encryptedPassword = input.password ? this.cipher.encrypt(input.password) : null;
}
```

Key auth 同样允许把 private key 清成 NULL：

```ts
if (authMethod === 'key' && input.privateKey !== undefined) {
  update.encryptedPrivateKey = input.privateKey ? this.cipher.encrypt(input.privateKey) : null;
  update.encryptedPassphrase = input.passphrase ? this.cipher.encrypt(input.passphrase) : null;
}
```

HTTP parser 也明确允许这些值为 `null` 或空字符串：

```ts
const optionalNullableString = (...) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new Error(...);
  return value;
};

if (body.password !== undefined)
  input.password = optionalNullableString(body.password, 'password');
if (body.privateKey !== undefined)
  input.privateKey = optionalNullableString(body.privateKey, 'privateKey');
```

因此一个已存在的 password Proxy 可以通过 `PUT /proxies/:id { "password": "" }` 变成 `auth_method='password', encrypted_password=NULL`；key Proxy 也可以通过空 `privateKey` 变成 `auth_method='key', encrypted_private_key=NULL`。API 会把 repository update 当作成功并返回更新后的公开 Proxy metadata，直到真正被 Connection resolver 使用时才暴露为缺失 credential / 连接失败。

这和 #26 不同：#26 是删除被 Connection 引用的 Proxy / SSH Key 后，外部 FK lifecycle 把 Connection 变成非法状态；这里没有删除任何依赖，单个 Proxy 自己的 update API 就能违反同一个 service 在 create 时声明的 credential invariant。Connection 模块已经用 `ConnectionCredentialService.prepareUpdate()` 对空 password/private key 做了对称拒绝，说明 Proxy 的行为是独立实现缺口。

## 134. 新增长期认证凭据是否要求 recent-auth / step-up

> 待确认（敏感操作授权策略）：auth route enrollment 只 requireAuthenticated，新 authenticator 验证不证明原凭据；事实成立但 current session 本身是否允许管理凭据是产品策略。保留 stolen-cookie→新增凭据的风险场景，不声称无需已认证权限即可绑定。

新增Passkey/TOTP依赖已完整认证session，没有既有因子的recent-auth证明；改密/禁用2FA则需密码。stolen session可增加持久凭据是风险场景，但仍以前置已认证权限为条件。待确认凭据管理是否要求统一step-up，不把策略不对称直接称匿名绑定漏洞。

## 135. 默认 Proxy Trust 把整个私网都当成可信反向代理；同网段直连客户端可伪造 Forwarded IP 绕过 IP Whitelist，并让 Blacklist / Audit 记录错误来源

> 确认问题（部署条件明确）：默认 HTTP trustProxy 与 WS 私网 peer trust 会接受 headers。必须能直连 Backend，或受信代理不覆盖客户端 header；仅 Frontend/Nginx 对外且正确覆盖 header 时不能推定外网绕过。WS trust 还未与自定义 HTTP TRUST_PROXY 统一。

Backend 默认同时使用：

```ts
host: env.HOST?.trim() || '0.0.0.0',
trustProxy: env.TRUST_PROXY?.trim() || 'loopback, linklocal, uniquelocal',
```

也就是说进程默认监听所有网卡，而 Express 的 `trust proxy` 默认信任 loopback、link-local 与整个 unique-local/private 地址段。HTTP application 直接把这个值交给 Express：

```ts
app.set('trust proxy', dependencies.trustProxy);
```

当前安装的 Express 5.2.1 用 `proxy-addr` 计算 `request.ip`：

```js
defineGetter(req, 'ip', function ip() {
  var trust = this.app.get('trust proxy fn');
  return proxyaddr(this, trust);
});
```

而项目实际安装的 `proxy-addr@2.0.7` 将 `uniquelocal` 展开为：

```js
uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'];
```

其地址解析先把 socket peer 放在第一项，再拼接客户端提供的 `X-Forwarded-For`：

```js
var proxyAddrs = parse(req.headers['x-forwarded-for'] || '');
var socketAddr = getSocketAddr(req);
var addrs = [socketAddr].concat(proxyAddrs);
```

只要 socket peer 命中 trusted range，下一跳 header 地址就会进入最终 client-IP 计算。于是直接从同一 LAN / Docker private network 访问 `0.0.0.0` Backend 的客户端，本身就满足默认“可信代理”条件，即使它根本不是反向代理。

IP whitelist middleware 随后完全信任这个解析结果：

```ts
const decision = await policy.check(request.ip || request.socket.remoteAddress);
```

而 `IpWhitelistService` 对 loopback 永久放行，甚至在读取用户配置 whitelist 之前就返回：

```ts
const LOCAL = new Set(['127.0.0.1', '::1', 'localhost']);
...
if (LOCAL.has(source)) {
  return { allowed: true, statusCode: 200, message: '允许访问。' };
}
```

因此一个来自 `192.168.x.x` / `10.x.x.x` 等默认 trusted range 的直连客户端可以自带 `X-Forwarded-For: 127.0.0.1`，让 HTTP middleware 把它当作 loopback 并绕过任何配置的 IP whitelist。同一个伪造来源还会进入 `requestIp()`、登录 blacklist 和 audit/notification metadata。

Blacklist 的影响尤其明确：`IpBlacklistService.recordFailedAttempt()` 对 loopback 直接跳过计数：

```ts
const LOCAL_IPS = new Set(['127.0.0.1', '::1', 'localhost']);
...
if (!(await this.settings.isIpBlacklistEnabled()) || LOCAL_IPS.has(ip)) {
  return;
}
```

WebSocket 又自己实现了一套同样宽的 proxy trust。只要 TCP peer 的 `ipaddr.range()` 属于 `loopback/private/linkLocal/uniqueLocal`，它就直接接受 `X-Real-IP` / `X-Forwarded-For`：

```ts
if (!isTrustedProxyAddress(remote)) return remote || 'unknown';
return (
  firstHeaderValue(request.headers['x-real-ip']) ||
  firstHeaderValue(request.headers['x-forwarded-for']) ||
  remote ||
  'unknown'
);
```

随后这个伪造 `clientIp` 同样进入 `ipWhitelist.check(clientIp)`。所以 source-address trust 问题同时覆盖 HTTP 与 WebSocket admission。

触发链是：Backend 使用默认 `HOST=0.0.0.0` 与默认 `TRUST_PROXY=loopback,linklocal,uniquelocal` → 同网段客户端直接连 Backend → 因自身 private source 被当成可信代理，其自带 Forwarded IP 被接受 → 声明 `127.0.0.1` 即可获得 whitelist 的 local fast-path，同时 blacklist 不再记录登录失败，审计也记录伪造来源。这里的 trust boundary 应该绑定到实际反向代理 hop，而不是整个私网地址类别。

这和 #63 不同：#63 是 WebSocket Origin policy 无条件采信 Forwarded Host/Proto；这里是 HTTP 与 WebSocket **source IP identity** 的 proxy trust 过宽，直接影响 whitelist、blacklist 和审计来源。

## 136. Initial Admin Web Setup 的受控初始化部署前提待确认

> 待确认（部署 bootstrap 策略）：setup 只要求空库，无部署token属实，但首次Web初始化是明确功能，默认端口发布不等于公网可达。需确认部署者是否被要求在受控网络完成初始化；未经隔离暴露空库是风险场景，不直接认定任何默认部署都能被公网抢占。

初始setup在空users时允许创建首个管理员，未要求部署token；默认发布端口不等于公网可达，全局网络准入仍适用。首次Web初始化是明确功能。待核对受控网络初始化的部署要求，以及是否需bootstrap secret；并发空库缺陷另见#35。

## 137. SSH Key 是共享 Credential owner，但 create/update/delete 完全没有 Audit / Notification 事件；修改一个被多条 Connection 引用的私钥不会留下持久安全记录

> 确认问题（审计覆盖差异）：SSH Key route/service 未注入或调用 audit，对比 Connection/Proxy credential mutation 有事件。缺少审计可确认；外部 Notification 是否必须触发是另一个策略问题，不能把通知缺失与审计缺失同等定性。

Connection 与 Proxy mutation 都已经进入 Audit boundary。Connection service 在 create/update/delete 后分别记录：

```ts
await this.audit.logAction('CONNECTION_CREATED', ...);
await this.audit.logAction('CONNECTION_UPDATED', ...);
await this.audit.logAction('CONNECTION_DELETED', ...);
```

Proxy route 同样记录：

```ts
await dependencies.audit.logAction('PROXY_CREATED', ...);
await dependencies.audit.logAction('PROXY_UPDATED', ...);
await dependencies.audit.logAction('PROXY_DELETED', ...);
```

但 SSH Key router 只调用 credential service 后直接返回成功：

```ts
const key = await sshKeys.create(...);
response.status(201).json(...);
```

```ts
const key = await sshKeys.update(id, ...);
response.json(...);
```

```ts
if (!(await sshKeys.delete(id))) {
  response.status(404).json(...);
  return;
}
response.json({ message: 'SSH 密钥删除成功。' });
```

`SshKeyService` 自身也没有注入 `AuditLogService` / `NotificationService`。现有 `AuditLogActionType` 包含 Connection、Proxy、Passkey、密码/2FA 等安全事件，但没有任何 `SSH_KEY_CREATED/UPDATED/DELETED` action；Notification event enum 同样没有对应事件。

这不是普通 metadata CRUD。一个 `ssh_keys` row 保存加密后的 private key/passphrase，并可以被任意数量 Connection 通过 `ssh_key_id` 共享引用。Connection resolver 每次使用引用时都会从当前 SSH Key row 解密 credential，因此：

```
更新 SSH Key #7 的 privateKey
        │
        ├── Connection A 下一次连接使用新私钥
        ├── Connection B 下一次连接使用新私钥
        └── Connection C 下一次连接使用新私钥
```

攻击者只要已经取得一个认证 Session，就可以把共享 SSH Key 替换成自己的 key material，或直接删除它影响所有引用 Connection；数据库和 HTTP 请求会成功，但之后 Audit Log 无法回答“哪个时间点发生了 SSH credential rotation/deletion”。相比之下，同一 Session 对 Connection/Proxy 的低敏感度 metadata mutation 都会留下事件。

这和 #26 不同：#26 讨论 SSH Key 删除通过 FK `ON DELETE SET NULL` 破坏 Connection credential 状态；这里即使 update 后所有引用仍然结构合法，实际私钥内容已经发生安全敏感变化，却完全没有持久审计轨迹。

## 138. Notification API 只对 SMTP password / Telegram bot token 做响应脱敏，Webhook headers 原样返回；保存的 Authorization/API-Key credential 可被任何已认证 Session 直接读取

> 确认问题（secret DTO边界不一致）：notificationDto 只删 smtpPass/botToken，Webhook headers 完整保留。仅当 headers 含secret成立；取得已认证管理员session是前提，不是匿名读取。应保留普通header可编辑需求，区分secret字段。

Webhook 配置允许保存任意 header：

```ts
export interface WebhookConfig {
  url: string;
  method?: 'POST' | 'GET' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;
}
```

HTTP parser 也不区分普通 header 与 credential header：

```ts
if (value.headers !== undefined) {
  if (!isRecord(value.headers) || !Object.values(value.headers).every((entry) => typeof entry === 'string')) {
    throw new Error('config.headers 必须是字符串映射。');
  }
  config.headers = Object.fromEntries(Object.entries(value.headers).map(([key, entry]) => [key, String(entry)]));
}
```

发送时这些 header 会直接交给 Axios，因此 `Authorization`、`X-API-Key` 等值本身就是实际出站 credential：

```ts
await axios({
  ...
  headers: {
    'Content-Type': 'application/json',
    ...(c.headers ?? {}),
  },
  ...
});
```

但 response DTO 的脱敏逻辑只处理两个显式字段：

```ts
const notificationDto = (setting: NotificationSetting): NotificationSettingDto => {
  const config: NotificationConfigDto = { ...setting.config };
  if (setting.channelType === 'email') delete config.smtpPass;
  if (setting.channelType === 'telegram') delete config.botToken;
  return { ...setting, config };
};
```

Webhook 的 `headers` 是浅拷贝后完整保留的。于是下面这些 API 都会把已保存的 header credential 回传到浏览器：

```
GET  /api/v1/notifications
POST /api/v1/notifications
PUT  /api/v1/notifications/:id
```

同一模块已经通过“响应时删除 secret + update 时允许 secret 缺省并保留旧值”的方式保护 `smtpPass` 和 `botToken`，说明产品 contract 明确区分了 write-only secret 与普通配置；Webhook credential 没进入这条 secret boundary。

触发链是：用户创建带 `Authorization: Bearer ...` 或 API key header 的 Webhook → setting 持久化 → 之后任何取得 Nexus authenticated Session 的客户端只需 GET notification settings → Backend 原样返回完整 header map → 原本只应该由 Nexus 出站使用的第三方 credential 被提升为可读取的会话数据。

这和 #38 不同：#38 是 Notification credential 在 SQLite 中没有经过 `SecretCipher`、备份也会携带明文；这里即使磁盘加密问题完全修复，只要现有 `notificationDto()` 不变，HTTP read surface 仍会主动把 Webhook secret 返回给前端。

## 139. Full Backup import 的 destructive confirmation / recent-auth 策略待确认

> 待确认（明确的恢复授权契约）：BackupService/codec 对同实例免备份密码是已公开行为；备份包仍要通过 envelope完整性/密钥校验，普通session不能任意构造合法包。是否增加 destructive confirmation/current-factor与审计是安全策略，不能仅因import与export不同就判越权；需要已有该实例合法备份。

同实例backup envelope可由instance key解密，不要求当前密码；跨实例需备份密码，envelope仍受完整性/密钥检查，auth表不在恢复集合。需已获得合法备份才能重放。待确认destructive confirmation、recent-auth和audit要求；不把公开恢复契约自动判为越权。

## 140. File HTTP Session 未显式保证落盘权限，临时认证 secret 的保护依赖部署环境

> 确认问题（应用未保证落盘权限）：`file-http-session.adapter.ts:21–24` mkdir无mode，FileStore无secret/mode；session可能含tempTwoFactorSecret。最终权限受umask、已有data父目录、ACL影响，不能断言所有Compose默认宿主读者都可读取；读取JSON也不能直接伪造签名cookie。

`FileHttpSessionAdapter` 把所有 Express Session 放进 data directory 下的普通文件目录：

```ts
const sessionsPath = path.join(options.dataDirectory, 'sessions');
fs.mkdirSync(sessionsPath, { recursive: true });
...
this.store = new FileStore({
  path: sessionsPath,
  ttl: 30 * 24 * 60 * 60,
});
```

这里没有为 `sessionsPath` 指定 `0o700`，也没有把已有的 `SESSION_SECRET` 传给 `session-file-store` 的 `secret` option。当前依赖 `session-file-store@1.5.0` 只有在 `options.secret` 存在时才启用自己的 session-file encryption：

```js
if (helpers.isSecret(options.secret)) options.kruptein = require('kruptein')(options.crypto);
```

写入时同样只有配置了 secret 才会先 encrypt，否则直接写 `encoder(session)` 的 JSON：

```js
var json = options.encoder(session);
if (helpers.isSecret(options.secret)) {
  json = helpers.encrypt(options, json, sessionId);
}
writeFileAtomic(sessionPath, json, ...);
```

Nexus 只把 `config.sessionSecret` 传给 `express-session` 用于签名 cookie，没有同时传给 FileStore：

```ts
this.store = new FileStore({ path: sessionsPath, ttl: ... });
this.middleware = session({
  store: this.store,
  secret: options.secret,
  ...
});
```

因此 server-side session 内容本身保持明文。当前 Session schema 又不只是 `userId/username`，还包含认证流程中的敏感临时状态：

```ts
interface SessionData {
  userId?: number;
  username?: string;
  requiresTwoFactor?: boolean;
  rememberMe?: boolean;
  tempTwoFactorSecret?: string;
  currentChallenge?: string;
  passkeyOrigin?: string;
  passkeyRegistrationUserId?: number;
}
```

其中 TOTP setup 会直接把尚未激活的 seed 写进 Session：

```ts
const setup = await dependencies.twoFactor.beginSetup(...);
request.session.tempTwoFactorSecret = setup.secret;
```

文件权限也没有建立显式 owner。`fs.mkdirSync(..., { recursive: true })` 使用 Node 默认目录 mode，`write-file-atomic` 在首次创建 session 文件时没有收到 mode，会把 mode 留给普通 `fs.open(..., 'w', undefined)` 默认值；最终权限依赖进程 umask，而不是 Nexus 自己的安全不变量。项目 Docker entrypoint 没有设置 restrictive umask，Dockerfile 也没有 `USER` 切换；默认 Compose 还把宿主 `./data` 直接 bind mount 到 `/app/data`：

```yaml
volumes:
  - ./data:/app/data
```

所以在常见 `022` umask 下，这条路径会形成 `sessions/` 0755、session JSON 0644 一类的默认结果。相比之下，同一个 bootstrap 对 `data/.env` 明确执行了 `mkdir(..., 0o700)`、`appendFile(..., 0o600)` 和 `chmod(..., 0o600)`，说明 secret-bearing disk state 本应由应用自己建立权限边界。

触发链是：默认 Compose/standalone Backend 创建 file session → Session JSON 以明文写进 bind-mounted data directory → 宿主机上任何能够遍历/read 这些默认权限文件的本地用户/进程可以看到登录身份、partial-2FA 状态以及尚未完成 setup 时的 `tempTwoFactorSecret` → TOTP seed 的 confidentiality 不再只由 Nexus authenticated session boundary 保护。即使读取 session 文件本身不足以伪造带 HMAC 的浏览器 cookie，这些 server-side authentication ceremony secrets 仍已经越过预期的 credential storage boundary。

这和 #131 不同：#131 是 partial-2FA Session 没有数量/aggregate-bytes quota，可以被第一因素持有者大量创建并耗尽磁盘；这里即使只有一个正常 Session，**落盘 confidentiality 和 filesystem permission boundary 本身就不成立**。这也和 #38 不同：#38 是 SQLite 中的 TOTP/CAPTCHA/Notification operational secret 未经 `SecretCipher`；这里是独立的 HTTP Session store 和 transient authentication ceremony state。

## 141. Remote HTML Theme content API 把 GitHub 上的攻击者 HTML 作为 Nexus 同源 `text/html` 返回；直接导航可绕过 Terminal iframe sandbox 并执行已认证同源脚本

> 确认问题（独立 document response 风险）：appearance route 明确text/html，HtmlThemeService只约束Raw Github来源，全局普通HTTP headers无CSP sandbox；Terminal iframe sandbox只保护另一展示面。需要已登录用户导航至攻击者控制HTML的链接，未执行真实攻击脚本。

Terminal 真正显示 Custom HTML background 时已经做了正确的 iframe 隔离：

```vue
<iframe ... sandbox="allow-scripts"></iframe>
```

而且 `srcdoc` 前还注入了限制 network 的 CSP。由于没有 `allow-same-origin`，这条 presentation path 中的 theme script 不会继承 Nexus origin。

但用于读取远程 theme 的 HTTP API 是另一条独立执行面：

```ts
router.get(
  '/html-presets/remote/content',
  route(async (request, response) => {
    const fileUrl = typeof request.query.fileUrl === 'string' ? request.query.fileUrl : '';
    ...
    response
      .type('text/html; charset=utf-8')
      .send(await dependencies.htmlThemes.readRemote(fileUrl));
  }),
);
```

`readRemote()` 只限制来源必须是 GitHub Raw HTTPS HTML：

```ts
if (
  parsed.protocol !== 'https:' ||
  parsed.hostname !== 'raw.githubusercontent.com' ||
  parsed.port ||
  !parsed.pathname.toLowerCase().endsWith('.html')
) {
  throw new Error('仅允许从 raw.githubusercontent.com 获取 HTTPS HTML 主题。');
}
return this.remote.readRawHtml(fileUrl);
```

`raw.githubusercontent.com` 上的文件内容本身不是 Nexus 信任根；任意 GitHub 用户都可以托管一份包含 `<script>` 的 HTML。Backend 会把它取回以后重新以 **Nexus API origin** 的 `text/html` response 发给浏览器。

全局 HTTP security headers 只有：

```ts
response.setHeader('X-Content-Type-Options', 'nosniff');
response.setHeader('X-Frame-Options', 'DENY');
response.setHeader('Referrer-Policy', 'same-origin');
response.setHeader('Permissions-Policy', ...);
```

这里没有 `Content-Security-Policy`。`X-Frame-Options: DENY` 只能阻止被 frame，不能阻止用户直接导航到该 URL；`nosniff` 反而不会阻止已经明确声明为 `text/html` 的 document script 执行。

因此攻击链不需要攻击者先拥有 Nexus Session：攻击者在自己的 GitHub repo 发布 `evil.html` → 构造链接指向受害者 Nexus 的

```text
/api/v1/appearance/html-presets/remote/content?fileUrl=https://raw.githubusercontent.com/.../evil.html
```

→ 已登录管理员打开链接 → `requireAuthenticated` 允许请求 → Backend server-side fetch 外部 HTML → 浏览器把响应当 Nexus origin 的 HTML document → `<script>` 以 Nexus 同源权限执行，可以读取/调用当前 Session 可访问的 API，并可把结果发送到外部网络。

Local custom theme 的读取 endpoint 同样以 `text/html` 返回，因此一旦恶意 HTML 已经进入 custom theme store，直接访问 `/html-presets/local/:themeName` 也有同一执行语义；但 remote endpoint 更严重，因为攻击者只需要控制公开 GitHub Raw 内容，不需要先取得 Nexus 写权限。

这和 Terminal 内的 sandbox 不是同一个 boundary：iframe 渲染路径已经正确隔离 theme code，问题来自 **Theme content retrieval API 自己成为了同源 HTML document host**。这也和 #132/#125 不同：那些条目是 Backend egress/SSRF；这里外部内容确实来自被允许的 GitHub Raw，却在返回浏览器时被错误提升成 Nexus origin 的 executable document。

## 142. 传统 HTTP mutation 只依赖 `SameSite=Lax` Session cookie，没有 Origin/CSRF boundary；同站点兄弟 Origin 可触发无 body 的认证副作用

> 确认问题（条件性CSRF缺口）：普通Auth/Connection/Notification POST未用Agent mutationSecurity；Lax不拦同site兄弟origin。必须攻击者控制同scheme可发送同site cookie的页面，且入口没有额外代理Origin规则；JSON-only跨站mutation不能据此都宣称可表单触发，未做双origin浏览器验证。

当前普通 HTTP Session cookie 配置是：

```ts
cookie: {
  httpOnly: true,
  sameSite: 'lax',
  secure: 'auto',
}
```

`SameSite=Lax` 约束的是 **site**，不是 origin。若 Nexus 部署为 `nexus.example.com`，攻击者控制 `evil.example.com`，从 `evil.example.com` 发往 `nexus.example.com` 的请求仍属于 same-site；浏览器会按目标 host 携带 Nexus 的 host-only cookie。跨 origin 本身不会让 cookie 消失。

普通 Router 在 `requireAuthenticated` 之后没有统一检查 `Origin`、`Sec-Fetch-Site` 或 CSRF token。HTTP application 的全局 middleware 只做 IP whitelist、安全响应头、JSON parser 和 Session：

```ts
app.use(createIpWhitelistMiddleware(...));
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  ...
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(dependencies.sessionMiddleware);
```

这不仅影响必须提交 JSON 的 CRUD。项目存在多条**不需要 request body** 就会产生副作用的 authenticated POST，因此恶意兄弟 Origin 可以用普通 HTML form 发起，不需要读取响应，也不需要 CORS：

```ts
POST /api/v1/connections/:id/test
```

会直接使用已经保存的 SSH credential 对目标执行真实连接测试：

```ts
const { latency } = await dependencies.sshConnectionTest.testStored(id);
```

Remote Desktop session issuance 同样只靠 path/query：

```ts
POST /api/v1/connections/:id/rdp-session
POST /api/v1/connections/:id/vnc-session
```

它们会调用：

```ts
await dependencies.remoteDesktop.create(request.session.userId!, id, 'RDP' /* or VNC */, displayOptions(request.query));
```

Notification test 也不读取 body，会真的向已保存通道发送测试消息：

```ts
POST /api/v1/notifications/:id/test
...
await settings.test(setting.channelType, setting.config);
```

认证模块还有完全无 body 的 logout：

```ts
POST /api/v1/auth/logout
...
await destroySession(request);
```

以及 `POST /auth/passkey/registration-options` 会基于当前已认证 Session 生成并覆盖 WebAuthn registration challenge/session state。

同一个代码库里的 Agent mutation 已经明确建立了更强的 browser authority boundary：它拒绝 cross-site request，检查 `Origin`，并要求绑定当前 `sessionID` 的 HMAC CSRF header：

```ts
if (request.header('sec-fetch-site') === 'cross-site') ...
if (origin && origin !== requestOrigin(request) && ...) ...
if (!tokenMatches(agentCsrfToken(request, options.csrfSecret), request.header('x-nexus-csrf'))) ...
```

说明产品本身已经承认“持有 Session cookie”与“当前页面被允许发起 mutation”是两个不同 authority；只是这一 boundary 只覆盖了 Agent API，没有覆盖旧的 Auth/Connection/Notification 等 mutation surface。

可复现触发链是：Nexus 运行于 `nexus.example.com`，用户已经登录 → 同一 registrable site 下 `evil.example.com` 被攻击者控制或存在可发布页面 → 恶意页面自动提交 form 到 `https://nexus.example.com/api/v1/connections/1/test` / `/notifications/1/test` / `/auth/logout` → 请求是 cross-origin 但 same-site，Nexus Session cookie 随请求发送 → Backend 不检查 Origin/CSRF → 使用受害者 Session 执行远端连接、发送通知或销毁会话。对于 RDP/VNC issuance，还会创建真实 remote-desktop server-side state。

这和 #63 不同：#63 是 WebSocket 自己的 Origin allowlist 被伪造 Forwarded headers 绕过；这里是普通 HTTP mutation **根本没有对应 Origin/CSRF gate**。它也不是普通 CORS 配置问题：攻击者不需要读取 response，HTML form 就能触发这些无 body side effect。

## 143. OpenAI-compatible Provider 的本地模型／内网 egress 策略待确认

> 待确认（本地模型是合法需求）：Provider URL可内网/loopback属实，常用于本地兼容模型服务器；discovery有timeout/body ceiling。正常单用户管理员具备配置权，需先定义目标network authority与redirect政策，不能一律禁止内网或直接定性SSRF漏洞。

Provider discovery/test/run使用用户配置HTTP(S) baseUrl，无私网deny；discovery有timeout/body上限。loopback与私网兼容模型（本地推理）是正常用途。待定义管理员network authority、redirect/DNS政策，不能一律把本地模型接入认定为SSRF漏洞。

## 144. Toolchain Pack 的 `mise` 子进程以 detached process group 启动却没有进入 managed-process registry；Runner 重启/崩溃可遗留继续运行的安装进程

> 确认问题（已有crash-recovery owner未接入）：`agent-runner/src/controller/pack-installer.ts:210–215` detached spawn未registerManagedProcess；本次runProcess timer只在当前parent活着时有效。容器整体退出可能由容器runtime杀掉所有进程，风险主要是Runner单进程退出／重启而容器或宿主仍活着，未做kill/restart测试。

Runner 已经建立了明确的 managed-process owner。`managed-process.ts` 甚至把 `pack` 列为正式 kind：

```ts
export type ManagedProcessKind = 'job' | 'acp' | 'plugin' | 'pack';
```

被登记的 child 会把 PID + `/proc` start time 写入 `managed-processes.json`；graceful shutdown 会调用 `terminateAllManagedProcesses()`，下一次 startup 也会按持久记录 SIGKILL 旧 process group。因此 Job、ACP、Plugin 等路径在 Runner 生命周期之外仍有最终 owner。

但 `PackInstaller.runProcess()` 同样以 detached group 启动 `mise` / toolchain executable，却从未调用 `registerManagedProcess()`：

```ts
const child = spawn(file, argv, {
  cwd: options.cwd,
  env: options.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: MANAGED_PROCESS_DETACHED,
});
```

它只在本次 Promise 仍活着时通过自己的 timer 调用 `signalManagedProcess(child, 'SIGKILL')`。最长的 `mise install-into` deadline 是 10 分钟：

```ts
await runProcess(miseBin, ['install-into', `${pack.familyId}@${pack.versionId}`, materialized], {
  ...,
  timeoutMs: MISE_INSTALL_TIMEOUT_MS,
});
```

而 Runner SIGTERM/SIGINT 的 shutdown 只关闭 transport/runtime，然后执行：

```ts
await terminateAllManagedProcesses();
```

`PackInstaller` 没有自己的 `close()/dispose()`，未登记的 `mise` child 不在这个集合里。若 Runner 在 pack install 正在执行时退出或崩溃，detached child/process group 可以继续下载、解压或写 staging/cache；因为它没有 registry record，下一次 `initializeManagedProcessRegistry()` 也无法发现并 reap 它。

这里的危险不只是“多一个孤儿进程”。Pack 安装使用共享 `cache/mise/*`，并向 `packs/.staging/<command>-.../pack` materialize；新 Runner 启动后会重新初始化 store/mutation coordinator，但旧 child 不属于新进程内的 serialization owner，仍可与新一轮 pack 操作并发写相同共享 cache/staging 体系。代码里已经预留 `ManagedProcessKind='pack'`，但实际注册缺失，说明 Pack lifecycle 没有接入项目自己已有的 crash-recovery 机制。

## 问题汇总

原 144 项已逐项分类：**未解决确认问题 98 项，待确认 33 项，已关闭 9 项，删除 4 项**。确认问题包含能力／时序缺口与架构文档不一致，不等同于已复现功能故障。以下汇总与各项核对状态一致，编号保持原样。

| 原编号 | 核对状态 | 保留条目                                                                                                                                                                     |
| ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | 已关闭   | Workspace 页面跨 Feature 组合位置                                                                                                                                            |
| 2      | 已关闭   | Backend ↔ Agent Runner Wire Protocol owner                                                                                                                                   |
| 3      | 已关闭   | Agent App Presentation / Application Controller 分离                                                                                                                         |
| 5      | 已关闭   | Runner Transport / Command Execution 分离                                                                                                                                    |
| 6      | 已关闭   | StateCommit 事务入口与 Recovery Transition 分离                                                                                                                              |
| 7      | 已关闭   | SQLite Schema 定义与 Migration 执行边界拆分                                                                                                                                  |
| 8      | 已关闭   | Agent Composition 子图工厂分离                                                                                                                                               |
| 9      | 已关闭   | Root Build / Check 覆盖全部生产包                                                                                                                                            |
| 10     | 待确认   | 大型静态 Theme 数据长期占用 TypeScript 编译单元                                                                                                                              |
| 11     | 已关闭   | Context Checkpoint 用户输入的语言偏置                                                                                                                                        |
| 12     | 待确认   | Root Agent 与 Subagent 使用两套不同等级的 Context 生命周期                                                                                                                   |
| 13     | 待确认   | Run Approval Policy 只有 `ask` 与 `full_access` 两档                                                                                                                         |
| 14     | 确认问题 | 被截断的 Tool Output 缺少 Model 可重新寻址的完整结果句柄                                                                                                                     |
| 15     | 确认问题 | Root Agent 的嵌套 `AGENTS.md` 发现依赖历史 Tool Call，首次触达存在 Instruction Gap                                                                                           |
| 16     | 待确认   | Subagent Governed Mutation 在 `ask` 模式下没有交互批准路径                                                                                                                   |
| 17     | 确认问题 | `plan` Execution Mode 的禁写边界没有覆盖 Subagent Tool Pipeline                                                                                                              |
| 18     | 确认问题 | Subagent 绕过 Deferred MCP Tool Surface，Root / Child 的 Tool Exposure Contract 不一致                                                                                       |
| 19     | 待确认   | Root 与 Subagent 的 Model Retry 策略差异是否需要统一                                                                                                                         |
| 20     | 确认问题 | Run Interrupt 的 Streaming 检测覆盖 Child，但实际 Abort 只发送给 Root Scheduler                                                                                              |
| 21     | 确认问题 | Durable `toolVersion` 没有在 Read / Control Tool 真正执行时形成版本绑定                                                                                                      |
| 22     | 确认问题 | Subagent Terminal Evidence 只从最近 32 个 Tool Batch 回收，长期 Delegation 会丢失早期已验证证据                                                                              |
| 23     | 确认问题 | Graceful `AGENT_QUIESCE` 会把正在 Streaming 的 Subagent 永久结算为 Cancelled                                                                                                 |
| 24     | 待确认   | Full Backup 的跨数据库／文件系统快照一致性仍需并发验证                                                                                                                       |
| 25     | 确认问题 | Backup Restore 会替换 Agent Durable State，但不会进入 Agent 的 quiesce / reinitialize 生命周期                                                                               |
| 26     | 确认问题 | 删除 Proxy / SSH Key 可以直接制造 ConnectionService 自己拒绝创建的 Connection 状态                                                                                           |
| 27     | 确认问题 | Connection Import 中内联 Proxy 与 Connection 的创建不是一个原子操作                                                                                                          |
| 28     | 确认问题 | 多个业务 Mutation 在提交后才写 Audit，Audit 失败会把“已成功修改”报告成“操作失败”                                                                                             |
| 29     | 确认问题 | IP Blacklist 的过期封禁状态会阻止同一 IP 再次进入封禁                                                                                                                        |
| 30     | 确认问题 | IP Blacklist 的失败计数是非原子的 read-modify-write，并发登录失败会丢失计数                                                                                                  |
| 31     | 确认问题 | Quick Command 本体与 Tag Association 分两个 Transaction 提交                                                                                                                 |
| 32     | 待确认   | Workspace Transfer / Archive 的 terminal outcome 与 Mutation Guard known-settlement 契约待确认                                                                               |
| 33     | 确认问题 | Connection `jumpChain` 使用裸 JSON ID 引用，删除或改型 Jump Host 后会留下悬挂依赖                                                                                            |
| 35     | 确认问题 | Initial Admin Setup 使用非原子的 `count() -> create()`，并发请求可以创建多个初始用户                                                                                         |
| 36     | 确认问题 | Server Transfer 用 `sourceItemName` 作为 SubTask 身份，同名不同路径的源文件会解析成同一个对象                                                                                |
| 37     | 确认问题 | Command / Path History 的 `upsert()` 没有唯一约束，并发首次写入会永久产生重复记录                                                                                            |
| 38     | 确认问题 | 多类 Operational Secret 直接以明文写入 SQLite，绕过项目已有的 `SecretCipher` 边界                                                                                            |
| 39     | 确认问题 | Remote Text Save 直接截断目标文件，写入中断会破坏原内容                                                                                                                      |
| 40     | 确认问题 | Passkey Assertion Counter 更新不是原子校验，登录并发会破坏单调性                                                                                                             |
| 41     | 待确认   | Background 删除存在数据库失败窗口，但已有 missing reference 自愈路径                                                                                                         |
| 42     | 确认问题 | Workspace create 的业务预检查遮蔽了底层 idempotency replay                                                                                                                   |
| 43     | 确认问题 | Workspace 数量上限采用事务外 count-then-create，并发创建可以突破 maxActiveWorkspaces                                                                                         |
| 44     | 确认问题 | Workspace adminAction 对 failed/unknown 命令永久去重，原样重试不会再次提交 Runner                                                                                            |
| 45     | 确认问题 | Workspace setup / pack uninstall 先提交 Settings，再执行 Runner 命令，失败后形成跨 owner 半提交                                                                              |
| 46     | 确认问题 | Backup Restore 会永久 dispose SSH Suspend / Workspace Suspend 的进程内生命周期，但导入后没有重建                                                                             |
| 47     | 确认问题 | Root Agent 的 recoverable abort reason 在主循环 safe-boundary 存在被错误写成 `cancelled` 的竞态                                                                              |
| 48     | 确认问题 | Runner Workspace lifecycle drain 与 checkpoint restore 的互斥是单向的，restore 可以和 start / restart / delete 并发                                                          |
| 49     | 确认问题 | Runner Workspace `start` 的多 Plugin 激活失败补偿不完整，会留下运行中的部分 Plugin                                                                                           |
| 50     | 待确认   | Runner 多文件 applyPatch 的集合原子性与部分失败契约待确认                                                                                                                    |
| 51     | 确认问题 | File Editor 的关闭路径不检查 `dirty`，Tab / Popup / Workspace 关闭都会静默丢弃未保存内容                                                                                     |
| 52     | 确认问题 | File Manager rename / delete 不更新已打开 Editor 文档，后续保存会在旧路径重新创建文件                                                                                        |
| 53     | 确认问题 | File Editor 的异步 `open()` 不属于 Workspace scope 生命周期，Workspace 关闭后仍能插入幽灵 Tab                                                                                |
| 54     | 确认问题 | Authenticated Session Reset 未覆盖部分 Frontend Store                                                                                                                        |
| 56     | 确认问题 | Bounded SSH command 把“没有 exit status”的 close 当作 exit code 0，会把异常终止报告为成功                                                                                    |
| 57     | 待确认   | Server-to-server Transfer 的目标凭据转交需要明确源端信任前提                                                                                                                 |
| 58     | 确认问题 | Server Transfer 的 source capability probe 不接受取消信号，任务取消可以被三个串行 10 秒探测延迟                                                                              |
| 59     | 待确认   | Jump Chain 的 hop 引用是否应复用被引用连接的完整 route                                                                                                                       |
| 60     | 待确认   | SSH Resource Status 按采样开始时间计算 TTL 的代价待测                                                                                                                        |
| 61     | 待确认   | Plugin Agent Mutation 的 operationId 与各 endpoint replay 契约待确认                                                                                                         |
| 62     | 确认问题 | HTTP Logout 只销毁 Session，但已经建立的认证 WebSocket 不会被撤销                                                                                                            |
| 63     | 确认问题 | WebSocket Origin 校验无条件信任 `X-Forwarded-Host` / `X-Forwarded-Proto`，可被直连客户端自满足                                                                               |
| 64     | 待确认   | SSH channel callback 与 Transport teardown 的晚到回调防护待验证                                                                                                              |
| 65     | 待确认   | Remote Archive 解压的部分失败展示与结果确认契约待确认                                                                                                                        |
| 66     | 确认问题 | Audit Log 非原子 retention 在并发写入下可能过度裁剪历史                                                                                                                      |
| 67     | 确认问题 | Notification fan-out 同步串进认证关键路径，而且没有通道数量/并发上限；外部通知端点可同时放大认证延迟与出站连接数                                                             |
| 68     | 确认问题 | Authenticated Session reset 只保护了部分 load；旧会话 Mutation 的晚到响应可以在 logout / user-change 后重新污染前端缓存                                                      |
| 69     | 确认问题 | Command History / Path History 对 distinct value 无保留上限，GET 又始终返回整表，长期使用会让持久化和前端加载无界增长                                                        |
| 70     | 待确认   | 同一 Session 只保留一个 Passkey ceremony challenge 是否符合产品预期                                                                                                          |
| 71     | 确认问题 | Terminal Theme preset 初始化只按 `name + preset` 查重，但数据库对 `name` 全局唯一；未来新增 preset 与既有用户主题同名时会直接阻断 Backend 启动                               |
| 72     | 待确认   | File Manager 批量删除的部分失败契约待确认                                                                                                                                    |
| 73     | 确认问题 | Full Backup 可以成功导出超过自身 Import 接口上限的文件，形成“可导出、不可恢复”的备份                                                                                         |
| 74     | 确认问题 | Backup capture 把完整文件树读取放在 SQLite exclusive transaction 内；大备份会阻塞所有普通数据库操作                                                                          |
| 75     | 确认问题 | Server Transfer 请求没有数组上限或去重，单个小于 1 MiB 的请求可以同步展开数千万个 SubTask                                                                                    |
| 76     | 确认问题 | Server Transfer 的 terminal task 只靠用户手工删除；Backend Map 和 `/status` 响应会随进程生命周期持续增长                                                                     |
| 77     | 确认问题 | 修改密码只更新 Password Hash，不会撤销其它已认证 HTTP Session；泄露 Cookie 在改密后仍然有效                                                                                  |
| 78     | 待确认   | Quick Command 创建标签与关联失败的部分成功提示待确认                                                                                                                         |
| 79     | 确认问题 | File Preview 的大小上限和取消只存在于前端包装层；真正的 Binary Transport 既不限制总字节数，也无法取消服务端读取                                                              |
| 80     | 确认问题 | File Editor 对远端文件读取完全没有大小上限；Large File Mode 在完整下载和解码之后才生效                                                                                       |
| 81     | 确认问题 | Full Backup 把整份快照物化成单个 JS 字符串；默认合法 Artifact 状态即可超过 Node 字符串上限而无法导出                                                                         |
| 82     | 确认问题 | Quick Command 批量打标签不限制或去重 `commandIds`；一个 1 MiB 请求可在全局排他 SQLite transaction 内制造数十万次串行 SQL                                                     |
| 83     | 确认问题 | SSH Suspend 没有会话数量上限或 suspended TTL；用户可以持续积累 live SSH transport、shell 和每会话日志                                                                        |
| 84     | 确认问题 | Plugin Backend close() 在 SIGTERM 后不等待退出或升级终止                                                                                                                     |
| 85     | 确认问题 | IP blacklist 没有任何过期行清理；匿名失败登录可让持久化 IP 基数永久增长                                                                                                      |
| 86     | 确认问题 | Connection Tag 的“替换全部关联”接口不验证目标 Tag，也不去重/校验正 ID；同一 API 对非法输入会返回假成功或 500                                                                 |
| 87     | 确认问题 | Artifact cleanup preview 可以生成超过 confirm 自身硬上限的 confirmation；超过 10,000 个可回收 Artifact 后清理流程必然无法执行                                                |
| 88     | 确认问题 | SSH Jump Chain 的 `forwardOut()` 不受 connect timeout 或 AbortSignal 控制；“15 秒连接测试”和 Agent deadline 都可以无限挂在跳板通道打开阶段                                   |
| 89     | 确认问题 | Agent Browser session 没有按 Run 生命周期回收；Run 结束后旧 session 又被 run binding 禁止关闭，Standalone Browser 资源只能等 Backend shutdown                                |
| 91     | 确认问题 | Runner Plugin 的 ready handshake 没有 timeout；第三方模块在发送 `runtime.ready` 前卡住时，Workspace lifecycle command 和 Runner startup reconcile 都会永久挂起               |
| 92     | 确认问题 | SSH Resource Status 的 host 级采样状态不会随 Connection 生命周期失效；历史 host:port 会永久留在内存，同 key 重用时还会复用旧机器静态信息                                     |
| 93     | 确认问题 | SSH transport 主动断开只会关闭底层 transport / shell，不会驱动 ExecutionSession 与 Workspace owner 回收；Registry 可长期保留已断开的“ready”会话                              |
| 94     | 确认问题 | Agent Integration 的 refresh epoch 只递增、不回收；反复创建/删除 Integration 会永久积累历史 scope+UUID generation state                                                      |
| 95     | 确认问题 | 全局 Agent feature disable 只 quiesce builtin App；Plugin App 的活跃 Run、Subagent 和 Backend Plugin runtime 会继续运行                                                      |
| 96     | 确认问题 | Backend 重启后的 user initialization 只恢复 builtin App 的 enabled MCP Integration；Plugin App 的 MCP Tool contribution 不会自动回到内存 Catalog                             |
| 97     | 确认问题 | Backend Plugin 的 `runtime.ready` handshake 也没有 timeout；已启用插件在模块 import 阶段卡死可以让整个 Backend 启动永远停在 listen 之前                                      |
| 98     | 确认问题 | Backend graceful shutdown 没有关闭 Plugin Backend runtime；SIGTERM 后主服务可以在 HTTP 已停止后继续被 Plugin child process 挂住                                              |
| 99     | 确认问题 | Background 并发上传在特定交错下可留下无引用文件                                                                                                                              |
| 100    | 确认问题 | Plugin 升级会按 installation 引用删除旧 Runner package，但持久 Workspace Profile 仍冻结旧版本；升级后 retained Workspace 再启动会稳定失败                                    |
| 101    | 确认问题 | Plugin 可耗尽共享 Run subscription 槽并阻止新的 Host UI 订阅                                                                                                                 |
| 102    | 待确认   | Plugin uninstall / upgrade 是否应停止 retained Workspace 的冻结版本进程                                                                                                      |
| 103    | 确认问题 | `retained` Workspace 的显式 delete 只删除 Generation，不释放 Workspace retention；它会同时留下不可回收文件树并永久阻塞 Run / Thread 删除                                     |
| 104    | 确认问题 | Backend Plugin 的 AppIntent create 丢失了已经存在的 idempotency owner；崩溃窗口会把一次跨 App 操作重复提交为两张 receipt                                                     |
| 105    | 确认问题 | Backend Plugin 的 Host RPC 没有 response-drain deadline；一个堵住 stdin 的 Plugin 可以让 uninstall / upgrade 永远卡在 SIGTERM 之前                                           |
| 106    | 确认问题 | Plugin 首次安装没有 per-App serialization；两个版本并发 install 可以把 App activeVersion 与 Installation version 写成永久冲突                                                |
| 107    | 确认问题 | Terminal Theme 删除与 Appearance active theme 分属两个 owner；直接删除当前主题会留下无法自动修复的悬挂 `activeTerminalThemeId`                                               |
| 108    | 确认问题 | Server Transfer 只限制单任务内部并发，没有全局 active-task / ExecutionSession 配额；多个 `/send` 请求可以线性扩张 SSH session 与远端命令并发                                 |
| 109    | 确认问题 | SSH Suspend 的落盘日志没有 startup reconcile；Backend 正常关闭时会主动保留随后永远不可达的孤儿日志                                                                           |
| 110    | 确认问题 | Workspace `upload.prepare` cache 没有 TTL / 数量上限 / consume 回收；不同 `prepareId` 可以在单个 Workspace 生命周期内永久堆积目录集合                                        |
| 111    | 确认问题 | Workspace WebSocket 没有 in-flight request / file-operation admission limit；客户端可以绕过 Frontend scheduler 并发放大 SFTP stream、positioned copy 与远端 archive command  |
| 112    | 确认问题 | `upload.start` 建立 active upload 后没有 idle deadline；客户端不发送数据即可永久占住远端写流、临时文件与持续续租的 mutation lease                                            |
| 113    | 确认问题 | SFTP Download Ticket 的 capacity 只限制 ticket 数，不限制每个 ticket 的并发 claim / read stream；一个 token 就能绕过 64/512 配额制造无界下载流                               |
| 114    | 确认问题 | 普通 Workspace session 没有 per-user / global 数量上限；认证用户可用不同 `workspaceId` 线性创建 SSH transport、shell 与 ExecutionSession                                     |
| 115    | 确认问题 | Agent Workspace Terminal 没有 session 配额；每条 `/ws/agent-terminal` 新连接都能在 Runner 新建 PTY/login shell 子进程                                                        |
| 116    | 确认问题 | Remote Desktop 的 1024 上限只覆盖 pending ticket；ticket 一经消费就退出计数，active Guacamole/RDP/VNC session 没有任何 Nexus 侧容量 owner                                    |
| 117    | 待确认   | Backend Plugin 的总进程容量策略待确认                                                                                                                                        |
| 118    | 待确认   | MCP Integration 的 aggregate session 容量策略待确认                                                                                                                          |
| 119    | 确认问题 | Model tool-call 数量上限只在 provider stream 结束后检查；OpenAI-compatible endpoint 可在最终拒绝前持续扩大 tool-call/continuation 内存状态                                   |
| 120    | 确认问题 | Runner Journal 每次状态变更都同步重写并 fsync 整份历史；持久 job/command 变多后单次提交成本随全部历史线性增长并阻塞 Runner event loop                                        |
| 121    | 待确认   | Agent Queue 的公平性与单用户／跨 App 调度契约待确认                                                                                                                          |
| 122    | 确认问题 | Agent Memory 没有总数量/retention/delete owner；candidate、revoked 和 expired memory 会永久保留在 SQLite 与 FTS，超过最新 200 条后又无法通过 list API 重新枚举               |
| 123    | 待确认   | Plugin 全局 immutable package namespace 与 publisher／user identity 契约待确认                                                                                               |
| 124    | 待确认   | Plugin Frontend 静态代码公开策略与私有包保密要求待确认                                                                                                                       |
| 125    | 待确认   | Remote Plugin repository/package fetch 的管理员 egress 与 redirect 策略待确认                                                                                                |
| 126    | 待确认   | Plugin Publisher revocation 历史的分页与保留策略待确认                                                                                                                       |
| 127    | 确认问题 | Plugin Stage 只有单包大小与 24h retention，没有 per-user Stage count / aggregate bytes admission；重复 Stage/verify 可以在 retention 窗口内持续堆积数十到数百 MiB 的本地副本 |
| 128    | 待确认   | 启用 2FA 后既有认证 Session 的撤销策略待确认                                                                                                                                 |
| 129    | 待确认   | Passkey discovery 的公开标识符与使用状态隐私策略待确认                                                                                                                       |
| 130    | 确认问题 | 2FA 登录失败只增加 IP blacklist 计数，不写认证 Audit / Notification；第二因素爆破在安全事件流里形成盲区                                                                      |
| 131    | 确认问题 | “密码正确、等待 2FA”的部分认证 Session 也会落盘 30 天，且没有 per-user/global Session 数量或磁盘 admission；仅掌握第一因素即可持续扩张 session 文件                          |
| 132    | 待确认   | Notification 出站网络的管理员授权与 allowlist 策略待确认                                                                                                                     |
| 133    | 确认问题 | Proxy create 与 update 使用不同 credential invariant；认证方式不变时可把必需 password/privateKey 清成 NULL，生成 create 路径永远不会接受的非法 Proxy                         |
| 134    | 待确认   | 新增长期认证凭据是否要求 recent-auth / step-up                                                                                                                               |
| 135    | 确认问题 | 默认 Proxy Trust 把整个私网都当成可信反向代理；同网段直连客户端可伪造 Forwarded IP 绕过 IP Whitelist，并让 Blacklist / Audit 记录错误来源                                    |
| 136    | 待确认   | Initial Admin Web Setup 的受控初始化部署前提待确认                                                                                                                           |
| 137    | 确认问题 | SSH Key 是共享 Credential owner，但 create/update/delete 完全没有 Audit / Notification 事件；修改一个被多条 Connection 引用的私钥不会留下持久安全记录                        |
| 138    | 确认问题 | Notification API 只对 SMTP password / Telegram bot token 做响应脱敏，Webhook headers 原样返回；保存的 Authorization/API-Key credential 可被任何已认证 Session 直接读取       |
| 139    | 待确认   | Full Backup import 的 destructive confirmation / recent-auth 策略待确认                                                                                                      |
| 140    | 确认问题 | File HTTP Session 未显式保证落盘权限，临时认证 secret 的保护依赖部署环境                                                                                                     |
| 141    | 确认问题 | Remote HTML Theme content API 把 GitHub 上的攻击者 HTML 作为 Nexus 同源 `text/html` 返回；直接导航可绕过 Terminal iframe sandbox 并执行已认证同源脚本                        |
| 142    | 确认问题 | 传统 HTTP mutation 只依赖 `SameSite=Lax` Session cookie，没有 Origin/CSRF boundary；同站点兄弟 Origin 可触发无 body 的认证副作用                                             |
| 143    | 待确认   | OpenAI-compatible Provider 的本地模型／内网 egress 策略待确认                                                                                                                |
| 144    | 确认问题 | Toolchain Pack 的 `mise` 子进程以 detached process group 启动却没有进入 managed-process registry；Runner 重启/崩溃可遗留继续运行的安装进程                                   |

### 已删除条目及依据

- **#4**：Agent 目录规模与平台化本身不证明 owner 越界；没有足以独立成立的缺陷证据。
- **#34**：transaction 内 PRAGMA foreign_keys=off 不生效属实，但旧 association FK 是 ON DELETE CASCADE。按实际 migration SQL 的 SQLite 最小复现，迁移完成、连接与标签关联保留，foreign_key_check 为空；原“必然 FK 失败”结论不成立。此复现不是所有历史数据库／全部 migration 的兼容性证明。
- **#55**：当前 WorkspaceTerminalService 由 reconcilePause() 统一检查 consumerBackpressure 与 reconnectPaused，原不对称 resume 实现已经不存在。
- **#90**：当前安装的 ws 在 CONNECTING 状态 terminate() 会通过 abortHandshake/emitErrorAndClose 发 error；现有 error handler 会 reject 建连 Promise。原“timer 只 terminate，所以 Promise 永久 pending”推断忽略依赖实现，不成立；不代表所有 tunnel 生命周期均已验证。

## 核对覆盖与验证边界（2026-10-02）

- 覆盖的是**这份原 144 项候选清单的源码核对与分类**，不是对整个仓库无遗漏的安全审计，也不是“所有问题均已确认”或“生产故障全部复现”。
- 对照了 Root/Subagent 的 model/tool/approval/interrupt/recovery 路径、Backup/SQLite 的事务与恢复 owner、Auth/Session/WebSocket 边界、Workspace/Transfer/Suspend 文件和连接生命周期、Frontend store/editor/preview 异步 owner、Plugin/MCP/Runner 的启动／关闭／package 引用／process registry 等关联调用链。
- 待确认条目保留已观察事实和具体前提；需要产品契约、部署信任模型、负载基准或行为验证才能升为确认缺陷。尤其单用户应用的跨用户隔离、受信管理员配置内网服务、匿名静态代码、首次 Web setup、普通批量文件操作部分成功，均不直接定性为漏洞。
- #34 做了隔离 SQLite 最小复现；#90 对照了安装依赖源码。其余条目主要为静态源码推导，未进行全量并发、断链、重启、恶意插件、超大文件／备份、跨 Origin 或资源耗尽测试。
- 初始核对仅为源码分析；后续修复以各条目的关闭状态为准。未处理 E2E 环境问题，未操作真实终端或会话布局，本地检查不代表远端 CI 验证结果。
