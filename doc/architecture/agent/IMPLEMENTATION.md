# Nexus Agent 详细实施方案

版本：2.0；配套 [ARCHITECTURE.md](ARCHITECTURE.md)。本文的路径、类型、函数、SQL、协议和任务编号是施工基线，不代表源码已存在。本轮是设计交付，实际实现/验收状态必须在各任务提交时另行记录。

## 0. 阅读与实施顺序

先读架构 §1～3，再按 P1-A→P1-B→P1-C→P1-D→P2-A→P2-B→P2-C→P3-A→P3-B→P3-C 实施。P1/P2/P3是实施阶段任务编号，不代表当前已经交付。当前只维护doc/architecture/agent中的设计规范，需求候选和未来文档落点留在§13；为防止未开始的Agent工作污染现有已实现需求基线，software-requirements暂不修改，正式业务代码开工前再同步。

| 任务 | 边界 / 可见成果 | 依赖 / E2E spec（均在 test/e2e/tests/agent/） |
| --- | --- | --- |
| P1-A | Host、scope、App/grant/settings持久化、生产manifest、architecture guard | 需求/本文契约；host.spec.ts |
| P1-B | Provider/Secret/出站策略、Artifact与文件库后端、Ledger、Context、内置Skill/Recall | P1-A；provider.spec.ts、artifacts.spec.ts |
| P1-C | 通用Run/Native Harness、只读Tools、state commit、调度、SSE/summary、cancel/reconcile | P1-B；runs.spec.ts、events.spec.ts、read-tools.spec.ts |
| P1-D | Launcher/Hub/Operations/文件库 UI、Nexus Settings 的 Agent tab（总开关/App管理/设置分区/Environment unavailable）、ingress/reset/shutdown、打包 | P1-C；hub.spec.ts、settings.spec.ts、artifact-library.spec.ts、lifecycle.spec.ts、deployment.spec.ts |
| P2-A | canonical hash、Approval、Lease、修改Tools、Workspace MutationGuard | P1-D；approvals.spec.ts、leases.spec.ts、mutation.spec.ts |
| P2-B | nexus-agent-runner/Base Runner、环境RPC/隔离/配额/Artifact协作/发布 | P2-A；environments.spec.ts、environment-isolation.spec.ts |
| P2-C | 环境UI/AI控制、checkpoint resume、可选Artifact备份恢复 | P2-B；environment-ui.spec.ts、recovery.spec.ts |
| P3-A | MCP/ACP/CDP适配器与对应Environment Recipe | P2-C；mcp.spec.ts、acp.spec.ts、browser.spec.ts |
| P3-B | 多Agent/SharedFacts/Memory审核 | P3-A；delegation.spec.ts、memory.spec.ts |
| P3-C | 安装式App/Skill、隔离UI、升级/回退/卸载 | P3-B；plugins.spec.ts |

每任务交接必须给：修改文件、公开签名、迁移版本、API/事件变化、状态转移、失败码、实际验收命令/结果及剩余风险。不能把模拟模型成功等同真实产品集成；E2E fake downstream只控制数据/故障，断言仍通过产品UI/API。

<a id="i1"></a>
## 1. 文件与现有工程接入

### 1.1 唯一目录与各文件职责

下表 Backend 模块文件以 packages/backend/src/modules/agent/ 为根。除 public.ts 外不导出可变全局单例；同职责的小类型允许合并到同一个 *.types.ts，不另建平行顶层包。

| 文件 | 导出 / 职责 |
| --- | --- |
| agent.types.ts | Scope、Actor、JsonValue、PageRequest、ClockPort公共纯类型 |
| agent-defaults.ts | validateSettings、snapshotBudget；唯一默认值/硬上限 |
| public.ts | AgentServices的类型/受限facade，不返回容器、DB或SDK |
| host/app.types.ts | Manifest、ValidatedManifest、AppRecord、CapabilityGrant、AppIntent |
| host/app-registry.service.ts | register(definition):void；get(appId):AppRecord；list(scope):AppView[]，只内存目录 |
| host/app-manifest-validator.ts | validateManifest(raw:unknown):ValidatedManifest；schema/semver/id/路径/能力检查 |
| host/app-lifecycle.service.ts | initializeDefaults():Promise<void>；setEnabled(scope,enabled,expectedVersion):Promise<AppRecord>；quiesce(appId,deadline):Promise<void> |
| host/app-state.repository.port.ts | get(scope)、insertDefault(record)、compareAndSet(scope,version,patch)、list(userId) |
| host/app-grant.repository.port.ts | list(scope)、replace(scope,expectedRevision,grants):Promise<number> |
| host/app-capability-broker.ts | authorize(scope,capability,resource):Promise<GrantDecision>，读取当前revision/denylist |
| host/app-sdk.ts | createSdk(boundScope,grants,ports):AgentAppSdk，bind owner而非信任payload |
| host/app-storage.port.ts | get(scope,key)、put(scope,key,value,expectedVersion)、delete(scope,key,expectedVersion)，含配额 |
| host/host-summary.port.ts | read(userId):Promise<HostSnapshot>；readAfter(userId,cursor,limit):Promise<HostEvent[]> |
| ai/model.types.ts | ProviderView、ModelRef、ModelRequest、ModelEvent、TokenUsage |
| ai/language-model.port.ts | stream(request:ModelRequest,signal:AbortSignal):AsyncIterable<ModelEvent> |
| ai/provider.service.ts | list(userId)、save(userId,input,expectedVersion)、test(userId,providerId)、remove(userId,id,version) |
| ai/provider.repository.port.ts | get/list/save/remove；受保护凭据仅在Infrastructure映射，不进入View |
| ai/provider-secret.port.ts | withCredential<T>(providerId,revision,use:(secret:string)=>Promise<T>):Promise<T>，调用期间使用不缓存到domain |
| ai/conversation.service.ts | createThread(scope,title)、appendInput(scope,threadId,input,command)、readPage(scope,threadId,page) |
| ai/conversation.repository.port.ts | readThread/readEntries；写入ledger经StateCommitPort同事务 |
| ai/context.service.ts | compose(input:ContextRequest):Promise<ContextPlan>，预算/摘要/证据来源范围 |
| ai/token-budget.ts | reserve(runId,attemptId,estimate):Promise<Reservation>；settle(id,usage):Promise<void>；release(id) |
| ai/artifact.port.ts | begin(scope,meta):Promise<UploadReservation>；write(id,source,signal):Promise<ArtifactRef>；read(scope,id,range):AsyncIterable<Uint8Array>；retain/delete |
| ai/recall.service.ts | recall(scope,query,limit=5,maxBytes=8192):Promise<RecallItem[]>；memory proposal三期新增 |
| ai/skill-registry.ts | search(scope,query):SkillMetadata[]；load(scope,id,version):Promise<SkillBody>；resource(scope,id,path):Promise<ArtifactRef> |
| ai/tool-catalog.ts | register(tool:AgentTool):void；discover(scope,query,max=12):ToolDescriptor[] |
| runtime/run.types.ts | 本文§2所有运行/输入/状态DTO的domain对应物 |
| runtime/run.service.ts | create(scope,CreateRunCommand):Promise<RunView>；appendInput(scope,runId,input,command)；cancel(scope,id,version)；resume(scope,id,checkpointId,command) |
| runtime/agent-runtime.registry.ts | start(record):Promise<void>；stop(id,reason):Promise<StopResult>；closeByRun(runId):Promise<void>；quiesce(deadline) |
| runtime/agent-backend.port.ts | execute(input:BackendInput,context:BackendContext):AsyncIterable<BackendSignal>；内部AbortSignal取消，不另开HTTP协议 |
| runtime/native-agent-backend.ts | runModelStep(context)、applyProposal(context,proposal)、verifyGoal(context)，实现统一Harness |
| runtime/planner.ts | deriveGoal(input,evidence):GoalPlan；不执行工具；输出可验证criteria |
| runtime/loop-guard.ts | check(run,history,proposal):LoopDecision；无进展/重复失败/预算边界 |
| runtime/subagent.service.ts | create(ctx,SubagentRequest):Promise<DelegationView>；list(scope,runId)；cancel(scope,runId,delegationId,version)；join(ctx,ids):Promise<DelegationResult[]>（三期；每子任务独立ModelRef） |
| runtime/scheduler.ts | enqueue(runId)、pump()、signalInput(runId,sequence)、cancel(runId)、quiesce(deadline) |
| runtime/event.types.ts | DurableEvent、TransientEvent、HostEvent、EventCursor |
| runtime/state-commit.port.ts | commit(command:StateCommit):Promise<CommitResult>；唯一运行事实写入入口 |
| runtime/run.repository.port.ts | snapshot(scope,runId)、list(scope,threadId,page)、readEvents(scope,id,after,limit) |
| runtime/checkpoint.service.ts | save(scope,runId,expectedVersion):Promise<Checkpoint>；validate(scope,id):Promise<CheckpointValidation> |
| runtime/idempotency.port.ts | claim(scope,command,key,requestHash)、complete(claim,result)、read(claim)、reconcile(claim) |
| runtime/reconciler.service.ts | onStartup()、reconcileRun(id)、reconcileUnknownTool(id)、quiesce(deadline) |
| capabilities/tool.types.ts | 本文§5唯一ToolDescriptor/Inspection/Result/Context |
| capabilities/tool-executor.ts | invoke(context,proposal):Promise<ToolResult>；唯一安全执行编排 |
| capabilities/target.service.ts | resolve(scope,connectionId):Promise<TargetFingerprint>；isDenied(connectionId)；updateDenylist(actor,ids,revision) |
| capabilities/machine.port.ts | inspect/read/execute/write/diagnose/docker窄契约，见§5 |
| capabilities/machine-capability.adapter.ts | 调既有Modules/Platform纯接口；不构造ssh2，隐藏ExecutionSession |
| capabilities/operation-hash.ts | canonicalize(value:JsonValue):string；hashOperation(op:OperationV1):string |
| capabilities/policy.service.ts | decide(scope,inspection,currentRevision):PolicyDecision；硬deny先行 |
| capabilities/approval.service.ts | request(ctx,inspection)、resolve(scope,id,decision,hash,expectedVersion)、expire(now)、consume(ctx,id,hash) |
| capabilities/lease.port.ts | acquireMany(owner,keys,mode,ttlSeconds)、renew(ids,owner,ttlSeconds)、release(ids,owner)、quarantine(toolId,keys,reason) |
| environments/environment.types.ts | Group/Environment/Profile/ControlCommand/JobResult |
| environments/environment-manager.service.ts | availability()、createGroup(scope,input)、requestAction(scope,command)、list/get(scope,id)、reconcile() |
| environments/environment-control.port.ts | provision(command)、act(command)、inspect(ref)、queryCommand(id)、inventory(deploymentId) |
| environments/environment-gateway.port.ts | invoke(grant,call,signal)、queryJob(id)、cancelJob(id)，不提供任意Docker方法 |
| environments/shared-facts.port.ts | get(scope,runId,key)、compareAndSet(scope,runId,key,version,value)（三期） |
| apps/operations/app.manifest.json | 稳定id=nexus.operations、版本、能力集合 |
| apps/operations/public.ts | createOperationsApp(sdk):AppContribution，注册定义/工具，不创建Host |
| apps/operations/operations.types.ts | OpsGoal、OpsTarget、VerificationCriteria |
| apps/operations/tools.ts | diagnostics/readFile（一期），writeFile/shell/remoteDocker（二期）的AgentTool实现 |
| apps/operations/verification.ts | verifyFileHash、verifyServiceState、verifyGoalEvidence；无verifier不注册mutation |

Concrete adapters：packages/backend/src/infrastructure/agent/ 下 repositories/sqlite-{app,provider,conversation,run,artifact,approval,lease,environment}.repository.ts，repositories/sqlite-state-commit.ts，providers/openai-compatible.adapter.ts，providers/provider-secret.adapter.ts，providers/outbound-policy.adapter.ts，artifacts/local-artifact-store.ts，environments/controller-client.ts，integrations/{mcp,acp}.adapter.ts。不要为每个方法创建一层wrapper。

### 1.2 现有文件修改表

| 当前文件 | 精确改动与兼容边界 |
| --- | --- |
| Backend src/bootstrap/composition-root.ts | 调compose-agent，注入database/SecretCipher/ConnectionService/ExecutionSessionManager/diagnostics及机器ports；返回agent facade和quiesce/dispose。不要把整个root给App |
| Backend src/bootstrap/application.ts | 向HTTP注入facade；shutdown先quiesce Agent和SSE再server.close；resetForE2E先同样排空再reset DB |
| Backend src/interfaces/http/http-application.ts | 在现有认证/IP/2FA边界后挂agent.routes；保留express.json 1mb及其他API响应，不改旧WS协议 |
| Backend src/infrastructure/database/sqlite-schema.registry.ts | 新库加入§4当期DDL；仅此处登记base schema |
| Backend src/infrastructure/database/sqlite-migrations.ts | 旧库按顺序升级；无module migration contribution机制，不新增第二个DB连接 |
| Backend src/modules/workspace/services/workspace-{filesystem,docker,operations}.service.ts | 二期typed mutation调用注入的MutationGuardPort，finally释放；接口签名给Platform不依赖Agent |
| Backend src/platform/execution/mutation-guard.port.ts（新增，二期） | withLease<T>(targetIdentity,resources,owner,work:(signal)=>Promise<T>):Promise<T>；生产由同一Lease实现注入Workspace和Agent |
| Backend src/platform/filesystem/remote-text-file.service.ts | 现有read会全量Buffer；新增readBounded(fs,path,maxBytes,signal)，不改旧read默认行为；Agent只用有界版本 |
| Backend src/platform/execution/execution-session-manager.ts | 使用现有connect/closeByOwner，不让Agent取Workspace session，不改session身份语义 |
| Backend scripts/check-architecture.mjs | 增加§1.3子目录与port-only规则，扫描静态/dynamic imports和public导出 |
| Frontend src/app/App.vue | RouterView外挂AgentSurfaceHost；App组合层注入auth失效回调和用户scope，登出dispose |
| Frontend src/app/shell/AppHeader.vue | 不修改 |
| Frontend src/app/router/index.ts | 不为Agent新增独立页面路由；保持现有router行为，Agent始终由App.vue中的AgentSurfaceHost全局浮层呈现；设置继续使用既有 `/settings` 路由 |
| Frontend src/app/pages/settings/SettingsPage.vue | 在现有 Workspace/System/Security/IP Control/Data/Appearance/About 横向tab中新增 Agent；复用现有Settings布局，不创建Agent独立设置页/路由 |
| Frontend src/app/i18n/index.ts | 现有features/*/i18n glob无需改；新增agent三语同键文件，并给现有settings页增加Agent tab文案 |
| Frontend src/foundation/ui/overlayStack.ts | 新增observeModalPresence(listener):Unsubscribe及只读hasModal；既有register/isTop不改变 |
| Frontend src/features/auth/public.ts | 不导出store；App层使用已有createAuthNavigationFacade.invalidateSession，再注入AgentDependencies.onSessionLost |
| Frontend scripts/check-architecture.mjs | 检查agent/host、ai、runtime、apps之间的public边界 |
| Frontend nginx.conf | §7具体Agent prefix location覆盖较宽的^~ /api/；Artifact upload单独body上限，不放大全局 |
| 根build.sh、Dockerfile、.github/workflows/publish-ghcr.yml | 二期增加可选nexus-agent-runner服务镜像与Base Runner目标，默认Nexus构建不要求Docker daemon；不可变digest/Pack manifest |
| docker-compose.yml | 二期新增可选 `nexus-agent-runner` 服务/profile；当前 frontend+backend+guacd 默认行为不变，不在本任务合并 Nexus 主服务 |
| test/e2e组配置、.github/workflows/e2e.yml | 注册真实产品spec及Environment Recipe/Pack smoke；不增加unit suite |

### 1.3 import/public约束与生产构建

Backend allowed子图与架构§2一致；host不能导出raw registry/store给插件，ai/runtime/capabilities/environments禁止import apps，只有bootstrap能import所有contribution。Frontend host只依赖app-contribution.types，不import apps组件；builtin-apps.ts作为静态组合例外只用lazy public.ts。runtime不依赖apps，apps/<a>不能依赖apps/<b>。技术SDK仅Infrastructure。

Backend当前是NodeNext但package未声明type=module：内置JSON使用 import rawManifest from './app.manifest.json'，保持当前TS模块输出策略；不强制添加with属性。build后检查dist/modules/agent/apps/operations/app.manifest.json存在，node dist/index.js启动真实API可读manifest。外部Markdown Skill资源由build脚本显式copy到同层dist；不从cwd定位src。没有消费者的三期实现文件不提前创建；一期availability port/DTO被设置页真实使用。

<a id="i2"></a>
## 2. 类型与状态机（唯一版本）

所有公开HTTP输入拒绝unknown字段；domain不依赖Express，类型文件以*.types.ts结尾。下列类型中的时间为UnixSeconds；HTTP映射为ISO字符串。

~~~ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type Scope = { userId: number; appId: string };
type Actor = { kind: 'user'; userId: number } |
  { kind: 'agent'; userId: number; appId: string; runId: string; agentRuntimeId: string };
type CommandIdentity = { key: string; requestId: string };
type ModelRef = { providerId: string; modelId: string; configurationVersion: number };
type UserInputData = { text: string; artifactRefs: string[] };
type CreateRunCommand = {
  threadId: string; input: UserInputData; agentDefinitionId: string;
  model: ModelRef; connectionIds: number[]; command: CommandIdentity;
};
type RunStatus = 'created' | 'running' | 'awaiting_approval' | 'awaiting_budget' | 'cancelling' |
  'completed' | 'completed_unverified' | 'failed' | 'cancelled' | 'interrupted';
type RuntimeStatus = 'created' | 'running' | 'stopping' | 'stopped' | 'failed' | 'interrupted';
type ToolCallStatus = 'proposed' | 'awaiting_approval' | 'ready' | 'running' |
  'succeeded' | 'verification_failed' | 'failed' | 'cancelled' | 'reconciling';
type ApprovalStatus = 'requested' | 'approved' | 'denied' | 'expired' | 'superseded';
type EnvironmentStatus = 'creating' | 'ready' | 'starting' | 'running' |
  'stopping' | 'stopped' | 'deleting' | 'deleted' | 'failed';
type VerificationResult = {
  status: 'verified' | 'unverified' | 'failed'; summary: string; evidenceRefs: string[];
};
type PageRequest = { limit: number; before?: string }; // default50/max100; opaque stable keyset
~~~

RunView必须返回id/appId/threadId/status/version、goalStatus、verificationStatus、needsReconciliation、budget/usage、consumedInputSequence、eventCursor、createdAt/startedAt/completedAt；详细snapshot同时含participants/steps/toolCalls/approvals/messages/evidenceRefs。列表只返回安全摘要，不返回normalized secret值或内部owner handles。

### 2.1 状态迁移与竞态

| 对象 / from | 命令 / 条件 | to / 同事务事实 |
| --- | --- | --- |
| Run created | scheduler取得执行slot；App/Provider仍有效 | running；run.status_changed + model.started |
| Run created | 用户取消且尚未执行 | cancelled；无需假装经过远端中断 |
| Run running | tool要求审批且无已运行tool | awaiting_approval；approval.requested |
| Run awaiting_approval | 批准/拒绝/到期/新input supersede | running；approval.decided或input.appended；planner决定下一步 |
| Run running | 下一 model/tool/delegation/verification 预留将越过当前软预算 | awaiting_budget；budget.increase_requested；释放 Runtime/model/tool permit，不占执行槽 |
| Run awaiting_budget | 用户显式提高本 Run 预算且未超过 hard limit | running；budget.increased；重新进入 scheduler，不重放已经 started 的副作用 |
| Run running | 有final且goal verified | completed；message.final + verification.completed |
| Run running | final但只能unverified | completed_unverified；不能伪装有运维验证 |
| Run running/awaiting_approval/awaiting_budget | cancel/App disable | cancelling；禁止新model/tool/delegation，撤销未消费approval/budget request |
| Run cancelling | 确认所有执行已终止 | cancelled；保存最终用量/取消原因 |
| Run任意非终态 | 进程重启/远端结果未知/停止确认失败 | interrupted；needsReconciliation按未知tool设置 |
| Run running | 可确认无未决副作用的模型/工具失败 | failed；run.error；任何Run预算耗尽（包括已到hard limit）都不得自动走此迁移 |
| Run终态 | resume用户命令+有效checkpoint | 原Run不变，创建新Run(parentRunId)，未完成mutation不重放 |
| Runtime created→running | registry.start | 独立execution owner；预算slot |
| Runtime running→stopping→stopped | cancel/完成 | stop已确认才释放slot；异常为failed/interrupted |
| Tool proposed | inspect/authorize/Policy | ready或awaiting_approval；deny为failed |
| Tool awaiting_approval | 批准+fresh复核 | ready；拒绝/过期/superseded→cancelled |
| Tool ready | 取得lease/consume approval/提交started | running；同toolCallId只能started一次 |
| Tool running | 确认result并verify | succeeded/verification_failed/failed |
| Tool running | 结果未知 | reconciling+resource quarantine；不自动重放 |
| Tool reconciling | 只读核实或用户确认带证据 | succeeded/failed/cancelled，记录reconciliation来源；Run终态不回退 |
| Approval requested | 用户决定/计时/更新input | approved/denied/expired/superseded；version CAS |
| Approval approved未consume | 参数/policy/input更新或到期 | superseded/expired；不能复用旧批准 |
| App disabled→enabling | setEnabled(true) | running或degraded/failed；desired仍enabled |
| App running/degraded→disabling | setEnabled(false) | 排空后disabled；未排空留disabling及reason |
| Environment stopped/ready→starting→running | start且Recipe/PackRef/配额/token有效 | command journal记录与environment.changed事件 |
| Environment running→stopping→stopped | stop及确认退出 | tmpfs不保证保留，Artifact不删 |
| Environment stopped/failed→deleting→deleted | 无未决job且获删除授权 | 容器/network清理确认后tombstone |

transitionRun(current,event,expectedVersion)和transitionTool/transitionEnvironment只接受此表白名单；HTTP不允许直接PATCH status。version冲突409 STATE_CONFLICT，调用方重新snapshot，禁止blind retry mutation。Run cancelled/interrupted/failed仍保存用户输入和证据。

### 2.2 Scheduler、输入、retry、checkpoint算法

scheduler为每Thread一个活跃Run、单管理员默认最多2个 executing AgentRuntime、每Run工具串行；created队列最多20，超过429 RUN_QUEUE_FULL；FIFO且App轮转。root 与 Subagent 使用同一 `maxConcurrentRuntimes`，不设累计 Subagent 数或独立 child 并发额度；waiting/join/approval/budget 状态释放执行slot。`maxActiveExecutionSeconds`按Run wall-clock去重计时：executing_runtime_count从0→1时记录active_execution_started_at，1→0时把经过秒数累计进active_execution_seconds；并发从1→N或N→1不重复计费，状态更新随permit投影持久化，重启可据此收敛。模型调用并发默认`auto`，解析为当前有效`maxConcurrentRuntimes`（默认2）；用户可在Agent Settings里主动下调；有效模型并发不能高于Runtime并发，Provider自身429/限流按运行时背压处理。三期Subagent只按深度、依赖、Run预算和Runtime slot排队，预留父预算，不单独获得新总预算；join期间root释放model/tool/Runtime permit。

appendInput事务内写ledger+input.appended、更新inputRevision：模型streaming则abort该attempt，下个step消费所有新entries；tool.started后仅置pendingInput，不杀不可确认的远端命令，确认结果后处理；等待审批则supersede所有未消费审批。模型step snapshot记录input watermark，proposal提交前再次比较，变更则放弃旧proposal重plan。cancel flag优先于新input，不创建“取消后继续”的旧Run。

ModelRequest={attemptId,stepId,model,messages,tools,maxOutputTokens,temperature?}。ModelEvent union为 delta{text}、toolCall{providerCallId,name,argumentsJson}、usage{inputTokens,outputTokens,cachedInputTokens?}、completed{finishReason}、error{code,retryable}。只有完整arguments通过schema后持久化proposal；adapter不能执行tool。BackendInput={runSnapshot,checkpoint?}；BackendContext={scope,agentRuntimeId,signal,clock,modelPort,contextPort,toolExecutor,commitPort}，所有资源为窄ports。

attempt完整生命周期planned→reserved→streaming→completed/failed/aborted；失败也settle usage。可重试网络/timeout/429/502/503/504，最多2次，1s/2s+jitter250ms，Retry-After≤30s；每次retry前重新检查当前attempt deadline、取消状态与Run active-time软预算；401/403/schema不重试。已有tool.proposed则消费已提交proposal，不再重试model step。unique(step_id,provider_call_id)防重复chunk，unique(step_id,operation_hash)防等价proposal重复执行。

Checkpoint={schemaVersion:1,runId,ledgerThrough,planVersion,completedStepIds,evidenceRefs,modelConfigurationVersion,definitionVersion,policyRevision,environmentArtifactManifestRefs}。save只在无running/reconciling tool时，flush当前commit并校验Artifact ready后事务保存；不保存active lease供恢复使用。Resume核实checkpoint作用域/来源未删除/模型可用/目标未deny、未知修改已处理，旧审批supersede；新Run重新取得lease/环境，不复用旧token或进程。

<a id="i3"></a>
## 3. 默认参数、Hard Limits 与配置契约

AGENT_DEFAULTS是服务端默认值源；Agent Settings不是单纯的模型设置，而是并入现有 Nexus Settings 的宿主级配置分区，先提供 Agent 功能总开关，再按模型与Provider、执行与性能、预算与上下文、Hard Limits、Subagent、Artifact与存储、Environment、安全与网络、系统保护分区展示。管理员可在Hard Limits模块修改本实例的Run/并发/Artifact/环境资源最终策略上限；提高任何Hard Limit必须先提交preview，再二次确认后CAS保存。Settings返回requestedSettings+effectiveSettings+hardLimits+runtimeCapabilities+revision；createRun保存会影响运行语义的effective snapshot，运行中不因后来调高设置而扩容。降低授权/denylist立即生效。event batch/commit queue/SSE/transient持久化边界属于固定guardrail；模型真实window、Provider限流、宿主当前CPU/内存/磁盘和Controller可用性属于runtimeCapabilities，只描述现实能力，不构造第二套资源上限。

| 参数（单位） | 默认软值 / 默认Hard Limit | 口径 |
| --- | --- | --- |
| maxContextTokens | 32000 / 128000 | 单调用输入；另受真实modelWindow-outputReserve约束 |
| maxOutputTokens | 4096 / 16384 | 单调用输出，不能超过model limit |
| maxRunTokens | 100000 / 1000000 | 所有attempt input+output含cache和重试；父子共享；达到requested值暂停询问，不自动失败 |
| maxRunSteps | 80 / 400 | 统一计 model/tool/verification/delegation；替代原仅计tool的40/200口径；达到requested值进入awaiting_budget，用户可提高本Run预算至hard limit |
| maxRunCostMicros | null / null（默认不设） | 可选本Run成本软预算；Hard Limit也由Agent Settings显式配置，不存在额外部署层资源上限；仅所有已选模型价格已知时可启用，达到requested值同样进入awaiting_budget |
| maxActiveExecutionSeconds | 1800 / 7200 | 只累计Run中“至少一个Runtime正在executing”的wall-clock秒数，并发不重复乘算；awaiting_approval/awaiting_budget/join/waiting不消耗；达到requested值暂停询问用户 |
| approvalTtlSeconds | 600 / 600 | requested起；改变参数必须新审批 |
| toolTimeoutSeconds | 60 / 300 | 单工具；长job每次poll仍受对应job/command deadline、取消与Run软预算安全边界 |
| maxToolOutputBytes | 65536 / 262144 | 单次返回模型前脱敏摘要上限 |
| maxRawToolBytes | 10485760 / 52428800 | 流式接收截断上限；默认10MiB |
| maxArtifactBytes | 268435456 / 1073741824 | 单Run全部Artifact（retain也算） |
| maxSingleArtifactBytes | 52428800 / 268435456 | 单对象，不能超过Run/全局余额 |
| maxGlobalArtifactBytes | 2147483648 / 10737418240 | 单用户=全局，含tmp/reserved/ready |
| minFreeDiskBytes | 1073741824 / 不可向下调整 | 低于保留空间拒绝新写 |
| maxRecallItems/maxRecallBytes | 5/8192 / 默认Hard Limit 20/32768 | 合计而非逐条；Hard Limit可在Settings二次确认调整；带来源 |
| maxConcurrentRuntimes | 2 / 4 | 全局正在工作的AgentRuntime；等待join不占执行slot；4只是默认Hard Limit，可在Settings二次确认调整，实际资源不足明确busy/unavailable |
| maxSubagentMessagesPerRun/maxSubagentMessageBytesPerRun | 1000/2097152 / 默认Hard Limit 5000/8388608 | 三期同Run显式Agent消息累计软预算；达到软值进入awaiting_budget，不把正常长协作直接判失败；单条/信封/pending容量仍是固定协议guardrail |
| maxConcurrentModelCalls | auto→2 / 4 | 用户值为auto或正整数且不得超过当前Settings Hard Limit；auto跟随effective maxConcurrentRuntimes；最终effective=min(requested/auto, maxConcurrentRuntimes)；Provider自身并发/限流作为运行时反馈与背压，不形成隐藏Hard Limit，允许用户主动往小调 |
| maxDelegationDepth | 2 / 3 | root深度0；所有后代统一受Run快照限制 |
| maxConcurrentToolCalls | 1 / 1 | 每Run；跨Run由lease控制 |
| maxActiveEnvironments | 4 / 8 | 全局Environment数量，与AgentRuntime数量独立；Hard Limit可在Settings二次确认调整 |
| maxEnvironmentsPerGroup | 4 / 4 | 单EnvironmentGroup软值/默认Hard Limit；不是隐藏常量，Hard Limit同样由Settings管理 |
| leaseTtlSeconds/renewSeconds | 30/10，固定 | 不是approval TTL；到期未知写进入quarantine |
| unretainedArtifactTtlSeconds | 604800 / 最多2592000 | 终态7天后，无有效引用才删 |
| environmentIdleTtlSeconds | 900 / 3600 | 有未决job不idle；Environment本身不设绝对寿命，具体job/command各自有deadline |
| modelRetryCount/estimateMargin | 2/0.15，固定 | 最多3attempt；缺usage按预留上界结算 |

### 3.1 Agent Settings 分区与可调边界

Agent Settings使用同一个`agent_settings.value_json`保存版本化、namespaced配置，不为每个前端小模块单独建表。推荐schema=`{schemaVersion,feature:{enabled},model,performance,budget,hardLimits,subagents,storage,environments,safety}`；`feature.enabled`默认true，控制Agent Host是否接受/调度执行；Provider credential仍保存在`ai_providers`并由SecretCipher保护，Settings只保存引用、默认选择和非密钥偏好。服务端`validateSettings()`负责默认值、旧schema迁移、交叉约束；Hard Limits自身就是实例策略上限，不再与另一套隐藏资源上限取min。前端另外展示`runtimeCapabilities`，用于提示当前模型/Provider/宿主/Controller是否实际上承载得住该设置。

| 设置模块 | 用户可调项 | 规则 |
| --- | --- | --- |
| 功能开关 | `feature.enabled` | 默认开启。关闭先禁止新Run/新step/新Environment claim并进入Host quiesce，模型stream可abort，未started工作取消；已started mutation必须确认结果或quarantine。关闭完成后Launcher隐藏；Settings及安全cleanup/审计仍可访问，历史Thread/Run/Artifact/配置数据保留但Hub不再提供交互，重新开启后可重新浏览；再次开启不自动resume旧Run |
| App管理 | 各Agent App enabled/disabled、grant状态 | 一个Thread/Run只归属一个App；停用App不等于关闭整个Agent。App停用沿§2状态机排空自身运行，不影响其他App |
| 模型与Provider | 默认Provider/Model、Provider模型选择、私网host:port例外、价格/能力查看 | credential单独加密；模型不能修改endpoint/allowlist |
| 执行与性能 | `maxConcurrentRuntimes`、`maxConcurrentModelCalls` | Runtime默认2/默认Hard Limit 4；Hard可在Settings二次确认调整；模型并发默认`auto`跟随Runtime，可手动降到1等更保守值；性能上调只影响后续claim，不强杀或扩容正在执行的调用 |
| 预算与上下文 | context/output、Run token、Run step、active execution time、可选cost cap、tool timeout、Recall数量/字节 | Run token/step/active-time/cost是可增量确认的软预算：耗尽先进入awaiting_budget提醒用户；只能提高到当前effective Hard Limit |
| Hard Limits | §3参数表中所有标为默认Hard Limit的可配置资源策略，包括context/output、Run预算、tool timeout/I/O上限、Subagent预算、Runtime/model并发、Artifact/Environment/Runner资源上限；明确标固定/只读/现实能力的项目除外 | 管理员可配置，**任何提高必须二次确认**；确认页显示旧值→新值、当前usage与runtimeCapabilities、预计成本/CPU/内存/磁盘/并发影响。允许设置高于当前瞬时空闲资源，但实际调度/创建资源不足时返回明确busy/unavailable，不存在隐藏第二上限；降低不回滚已发生usage，下一安全边界按新上限阻止新增reserve |
| Subagent | 深度、各profile模型/预算、Run内Agent消息数/字节软预算 | 不设累计创建数或独立Subagent并发数；root/child统一使用“执行与性能”的Runtime并发，完成的Subagent不占后续名额；delegation与消息累计预算耗尽都先进入awaiting_budget询问用户 |
| Artifact与存储 | 单对象/单Run/全局配额、未retain TTL | 已用量高于新配额时拒绝降低；`minFreeDiskBytes`只读显示，不允许向下调 |
| Environment | active环境数、每组环境数、idle TTL、Recipe资源选择（二期） | 受Agent Settings Hard Limits控制；Controller只验证实际能否分配/隔离，资源不足返回availability/resource错误，不再另设隐藏资源上限 |
| 安全与网络 | target denylist、Provider私网例外、capability授权入口 | hard deny、CSRF、approval hash、lease/fencing、metadata拒绝等不可关闭 |
| 系统保护 | Run created排队容量20、event batch 64/256KiB、commit queue 256/4MiB、安全终态预留、SSE每session 3、delta/tool chunk不落库 | 只读展示/诊断；这些是有界队列/协议/数据库正确性guardrail，不是任务资源Hard Limit，也没有另一套可配置资源上限 |

性能设置必须同时展示`current executing / requested / effective / hard limit`。例如`maxConcurrentRuntimes=2`且Hard Limit=4时显示“当前执行1 / 有效2 / Hard Limit 4”；`maxConcurrentModelCalls=auto`显示“自动（当前有效2）”，用户改为1后Runtime仍可并发2但模型调用串行排队。如果Runtime调为1，即使模型并发请求值更高，effective仍为1。root和所有Subagent共用Runtime/model slot，waiting/tool/join状态按各自permit规则计算。

`GET /agent/settings`返回`{requestedSettings,effectiveSettings,hardLimits,runtimeCapabilities,availability,revision}`。`feature.enabled`通过普通CAS PATCH修改；从true→false时先持久化禁止新claim的期望状态并触发Host quiesce，返回可观察的`availability.state='disabling'|'disabled'`，不能在仍有未知副作用时伪称已完全停止；false→true只重新开放Host调度，不自动resume历史Run。普通`PATCH /agent/settings`不直接提高Hard Limits；Hard Limit修改先`POST /agent/settings/hard-limits/preview`提交目标值和expectedVersion，服务端返回`confirmationId/current/proposed/impact/runtimeCapabilities/expiresAt`，前端显示二次确认；用户确认后`POST /agent/settings/hard-limits/confirm`以confirmationId+expectedVersion原子保存。降低也走同一路径以避免误操作，但UI可弱化风险提示。版本冲突409 `SETTINGS_VERSION_CONFLICT`；不存在额外隐藏资源上限校验。对运行中的Run，安全收紧立即在下一安全边界重新校验；纯性能上调不修改既有Run预算快照，只影响后续调度许可。

Run预算和Settings预算分开：createRun把当时的软预算复制进`budget_json`；当下一次reserve会超过`maxRunTokens/maxRunSteps/maxActiveExecutionSeconds/maxRunCostMicros?`时，StateCommit写`pendingIncrease={scope:'run'|'delegation'|'mailbox',refId?,reason,current,requested,suggested,hardLimit,canIncrease}`并把Run置`awaiting_budget`。前端显示“增加本次任务预算/自定义/取消”，不把预算不足伪装成失败。用户确认通过专用幂等命令只提高该Run的budget revision；不能低于已用量，不能越过hard limit，也不能通过改全局Settings偷偷恢复旧Run。若当前Hard Limit为数值且requested已经等于Hard Limit，则仍保持awaiting_budget并显示`canIncrease=false`，等待用户取消/结束，或管理员先在Agent Settings通过二次确认提高Hard Limit后，再由用户显式增加本Run预算；Hard Limit为null表示该维度当前未配置实例策略上限，`canIncrease=true`但仍须用户显式确认本Run增量并通过safe-integer/真实能力校验；不得自动标failed。awaiting_budget期间可以保存输入/查看结果，但scheduler不claim新的model/tool/delegation。

ContextPlan={messages,toolSchemas,estimatedInputTokens,reservedOutputTokens,droppedSections,sourceRanges,contextEpoch}；compose先计固定安全/currentInput的**单次模型上下文容量**，连最低安全输入都放不下时才返回CONTEXT_BUDGET_EXCEEDED；这不是Run软预算耗尽，不能靠无限增加Run token budget绕过model window；再按任务计划、近期final、Recall、Skill分配。compressRange(threadId,from,to,sourceHash)只处理不可变已提交entries，摘要不写回原输入。重复只读缓存TTL≤5秒且工具没有未知副作用。

<a id="i4"></a>
## 4. 持久化、迁移与原子提交

使用现有DatabaseAdapter/单连接/BEGIN IMMEDIATE；不在Agent另建连接或module migration框架。schema registry与sqlite-migrations分别消费新库和升级DDL。迁移版本选择当前registry最大值后连续编号，编号由实现任务从仓库读取，不硬写可能冲突的全局版本；Agent内部schemaRevision=1/2/3对应下列分期。迁移完成前HTTP未ready，失败回滚并拒绝Agent就绪，不半启用。

数据库DDL和事务算法在下一小节；这些SQL是设计的可执行schema，不是在本轮创建生产表。字段未标nullable的一律NOT NULL；epoch字段INTEGER，JSON TEXT均CHECK(json_valid)。所有ID/配置revision在API映射camelCase，不能暴露SQL列名。

### 4.1 DDL：Phase 1（schemaRevision 1）

~~~sql
CREATE TABLE agent_apps (
 user_id INTEGER NOT NULL REFERENCES users(id), app_id TEXT NOT NULL,
 active_version TEXT NOT NULL, desired_state TEXT NOT NULL CHECK(desired_state IN ('enabled','disabled')),
 observed_state TEXT NOT NULL CHECK(observed_state IN ('disabled','enabling','running','degraded','failed','disabling')),
 health_reason TEXT, policy_revision INTEGER NOT NULL DEFAULT 1 CHECK(policy_revision>0),
 running_count INTEGER NOT NULL DEFAULT 0 CHECK(running_count>=0),
 approval_count INTEGER NOT NULL DEFAULT 0 CHECK(approval_count>=0),
 budget_request_count INTEGER NOT NULL DEFAULT 0 CHECK(budget_request_count>=0),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,app_id)
);
CREATE TABLE agent_app_grants (
 user_id INTEGER NOT NULL, app_id TEXT NOT NULL, capability TEXT NOT NULL,
 schema_version INTEGER NOT NULL, scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 granted_at INTEGER NOT NULL, PRIMARY KEY(user_id,app_id,capability),
 FOREIGN KEY(user_id,app_id) REFERENCES agent_apps(user_id,app_id)
);
CREATE TABLE agent_app_storage (
 user_id INTEGER NOT NULL, app_id TEXT NOT NULL, key TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)), bytes INTEGER NOT NULL CHECK(bytes>=0),
 version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,app_id,key), FOREIGN KEY(user_id,app_id) REFERENCES agent_apps(user_id,app_id)
);
CREATE TABLE agent_settings (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE TABLE agent_target_denylist (
 connection_id INTEGER PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
 reason TEXT NOT NULL, changed_by INTEGER NOT NULL REFERENCES users(id), changed_at INTEGER NOT NULL
);
CREATE TABLE ai_providers (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 display_name TEXT NOT NULL, base_url TEXT NOT NULL, protected_credential TEXT,
 credential_revision INTEGER NOT NULL DEFAULT 1, models_json TEXT NOT NULL CHECK(json_valid(models_json)),
 endpoint_policy_json TEXT NOT NULL CHECK(json_valid(endpoint_policy_json)),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), deleted_at INTEGER,
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE ai_threads (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL, title TEXT NOT NULL,
 next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence>=1),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(id,user_id,app_id), FOREIGN KEY(user_id,app_id) REFERENCES agent_apps(user_id,app_id)
);
CREATE INDEX ai_threads_list ON ai_threads(user_id,app_id,updated_at,id);
CREATE TABLE agent_runs (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL, thread_id TEXT NOT NULL,
 parent_run_id TEXT REFERENCES agent_runs(id), status TEXT NOT NULL CHECK(status IN
 ('created','running','awaiting_approval','awaiting_budget','cancelling','completed','completed_unverified','failed','cancelled','interrupted')),
 goal_status TEXT NOT NULL CHECK(goal_status IN ('unknown','in_progress','satisfied','not_satisfied')),
 verification_status TEXT NOT NULL CHECK(verification_status IN ('not_started','verified','unverified','failed')),
 needs_reconciliation INTEGER NOT NULL DEFAULT 0 CHECK(needs_reconciliation IN (0,1)),
 budget_json TEXT NOT NULL CHECK(json_valid(budget_json)), definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json)), usage_json TEXT NOT NULL CHECK(json_valid(usage_json)),
 active_execution_seconds INTEGER NOT NULL DEFAULT 0 CHECK(active_execution_seconds>=0),
 active_execution_started_at INTEGER, executing_runtime_count INTEGER NOT NULL DEFAULT 0 CHECK(executing_runtime_count>=0),
 next_event_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_event_sequence>=1),
 consumed_input_sequence INTEGER NOT NULL DEFAULT 0, input_revision INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, started_at INTEGER,
 completed_at INTEGER, updated_at INTEGER NOT NULL, UNIQUE(id,user_id,app_id), UNIQUE(id,thread_id,user_id,app_id),
 FOREIGN KEY(parent_run_id,user_id,app_id) REFERENCES agent_runs(id,user_id,app_id),
 FOREIGN KEY(thread_id,user_id,app_id) REFERENCES ai_threads(id,user_id,app_id)
);
CREATE UNIQUE INDEX agent_one_live_run ON agent_runs(thread_id)
 WHERE status IN ('created','running','awaiting_approval','awaiting_budget','cancelling');
CREATE INDEX agent_runs_scope ON agent_runs(user_id,app_id,created_at,id);
CREATE INDEX agent_runs_reconcile ON agent_runs(status,needs_reconciliation,updated_at);
CREATE TABLE ai_thread_entries (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, user_id INTEGER NOT NULL, app_id TEXT NOT NULL,
 run_id TEXT, sequence INTEGER NOT NULL CHECK(sequence>=1),
 kind TEXT NOT NULL CHECK(kind IN ('user_input','assistant_message','tool_result','system_notice')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at INTEGER NOT NULL,
 UNIQUE(thread_id,sequence),
 FOREIGN KEY(thread_id,user_id,app_id) REFERENCES ai_threads(id,user_id,app_id),
 FOREIGN KEY(run_id,thread_id,user_id,app_id) REFERENCES agent_runs(id,thread_id,user_id,app_id)
);
CREATE TABLE agent_runtimes (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id), participant_id TEXT NOT NULL,
 backend_kind TEXT NOT NULL CHECK(backend_kind IN ('native','acp')),
 model_ref_json TEXT NOT NULL CHECK(json_valid(model_ref_json)),
 status TEXT NOT NULL CHECK(status IN ('created','running','stopping','stopped','failed','interrupted')),
 execution_owner_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(run_id,participant_id), UNIQUE(id,run_id)
);
CREATE TABLE agent_steps (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_runtime_id TEXT NOT NULL,
 step_index INTEGER NOT NULL CHECK(step_index>=1),
 kind TEXT NOT NULL CHECK(kind IN ('model','tool','verification','delegation')),
 status TEXT NOT NULL CHECK(status IN ('created','running','completed','failed','cancelled')),
 input_watermark INTEGER NOT NULL, input_refs_json TEXT NOT NULL CHECK(json_valid(input_refs_json)),
 output_refs_json TEXT NOT NULL CHECK(json_valid(output_refs_json)),
 created_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(run_id,step_index), UNIQUE(id,run_id),
 FOREIGN KEY(agent_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id)
);
CREATE TABLE agent_model_attempts (
 id TEXT PRIMARY KEY, step_id TEXT NOT NULL REFERENCES agent_steps(id), attempt_index INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('planned','reserved','streaming','completed','failed','aborted')),
 reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>=0), input_tokens INTEGER, output_tokens INTEGER,
 cached_input_tokens INTEGER, cost_micros INTEGER, price_version TEXT, estimated INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, created_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(step_id,attempt_index)
);
CREATE TABLE agent_tool_calls (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_runtime_id TEXT NOT NULL, step_id TEXT NOT NULL,
 provider_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, tool_version TEXT NOT NULL,
 inspection_json TEXT NOT NULL CHECK(json_valid(inspection_json)), operation_hash TEXT NOT NULL,
 operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version=1),
 risk TEXT NOT NULL CHECK(risk IN ('read','mutate','destructive')),
 status TEXT NOT NULL CHECK(status IN ('proposed','awaiting_approval','ready','running','succeeded',
 'verification_failed','failed','cancelled','reconciling')),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(step_id,provider_call_id), UNIQUE(step_id,operation_hash), UNIQUE(id,run_id),
 FOREIGN KEY(step_id,run_id) REFERENCES agent_steps(id,run_id),
 FOREIGN KEY(agent_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id)
);
CREATE TABLE agent_events (
 event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK(sequence>=1), schema_version INTEGER NOT NULL CHECK(schema_version=1),
 type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), occurred_at INTEGER NOT NULL,
 UNIQUE(run_id,sequence)
);
CREATE TABLE agent_host_cursors (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence>=1)
);
CREATE TABLE agent_host_events (
 user_id INTEGER NOT NULL REFERENCES users(id), sequence INTEGER NOT NULL CHECK(sequence>=1),
 type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), occurred_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,sequence)
);
CREATE TABLE agent_commands (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL, command_name TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','committed','unknown')),
 response_status INTEGER, response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
 result_entity_id TEXT, generation INTEGER NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER,
 expires_at INTEGER, UNIQUE(user_id,app_id,command_name,idempotency_key)
);
CREATE INDEX agent_commands_cleanup ON agent_commands(status,expires_at);
CREATE TABLE ai_artifacts (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL, original_name TEXT NOT NULL,
 media_type TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, sha256 TEXT,
 size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes>=0), reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes>=0),
 status TEXT NOT NULL CHECK(status IN ('staging','ready','deleting','deleted','unavailable')),
 retained INTEGER NOT NULL DEFAULT 0 CHECK(retained IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, ready_at INTEGER, expires_at INTEGER, deleted_at INTEGER,
 FOREIGN KEY(user_id,app_id) REFERENCES agent_apps(user_id,app_id)
);
CREATE INDEX ai_artifacts_gc ON ai_artifacts(status,retained,expires_at);
CREATE TABLE agent_artifact_links (
 artifact_id TEXT NOT NULL REFERENCES ai_artifacts(id), run_id TEXT NOT NULL REFERENCES agent_runs(id),
 role TEXT NOT NULL CHECK(role IN ('input','output','evidence','checkpoint')), created_at INTEGER NOT NULL,
 PRIMARY KEY(artifact_id,run_id,role)
);
CREATE TABLE agent_quota_usage (
 scope_key TEXT PRIMARY KEY, limit_bytes INTEGER NOT NULL CHECK(limit_bytes>=0),
 used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes>=0),
 reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
 CHECK(used_bytes+reserved_bytes<=limit_bytes)
);
CREATE TABLE agent_checkpoints (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id), schema_version INTEGER NOT NULL CHECK(schema_version=1),
 ledger_through INTEGER NOT NULL, event_through INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), created_at INTEGER NOT NULL
);
CREATE TABLE ai_context_digests (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES ai_threads(id), from_sequence INTEGER NOT NULL,
 to_sequence INTEGER NOT NULL CHECK(to_sequence>=from_sequence), source_hash TEXT NOT NULL,
 model_config_version TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(thread_id,from_sequence,to_sequence,source_hash,model_config_version)
);
CREATE TABLE ai_memories (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL, content TEXT NOT NULL,
 source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)), confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 status TEXT NOT NULL CHECK(status IN ('candidate','published','revoked')),
 expires_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,app_id) REFERENCES agent_apps(user_id,app_id)
);
~~~

ai_thread_entries就是统一Ledger，不再维护独立ai_inputs/ai_messages各自sequence，也不建立ai_events第二事件表。一期memory仅可读取published（内置seed或用户明确导入的资料），API不提供自动写入；FTS5作为该表的可选检索索引，build/startup探测，不可用时限定scope后LIKE、最多扫描最近1000条。

### 4.2 DDL：Phase 2（schemaRevision 2）及Phase 3（revision 3）

~~~sql
-- Phase 2
CREATE TABLE agent_approvals (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL, run_id TEXT NOT NULL, tool_call_id TEXT NOT NULL,
 requested_by_runtime_id TEXT NOT NULL, operation_hash TEXT NOT NULL, operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version=1),
 status TEXT NOT NULL CHECK(status IN ('requested','approved','denied','expired','superseded')),
 policy_revision INTEGER NOT NULL, input_revision INTEGER NOT NULL,
 decided_by_user_id INTEGER REFERENCES users(id), decided_at INTEGER, consumed_at INTEGER,
 requested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(run_id,user_id,app_id) REFERENCES agent_runs(id,user_id,app_id),
 FOREIGN KEY(tool_call_id,run_id) REFERENCES agent_tool_calls(id,run_id),
 FOREIGN KEY(requested_by_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id)
);
CREATE UNIQUE INDEX agent_one_active_approval ON agent_approvals(tool_call_id)
 WHERE status='requested' OR (status='approved' AND consumed_at IS NULL);
CREATE INDEX agent_approval_expiry ON agent_approvals(status,expires_at);
CREATE TABLE agent_resource_fences (
 resource_key TEXT PRIMARY KEY, next_fence INTEGER NOT NULL DEFAULT 1 CHECK(next_fence>=1)
);
CREATE TABLE agent_leases (
 id TEXT PRIMARY KEY, resource_key TEXT NOT NULL REFERENCES agent_resource_fences(resource_key),
 mode TEXT NOT NULL CHECK(mode IN ('read','write')), owner_type TEXT NOT NULL CHECK(owner_type IN ('agent','workspace','system')),
 owner_id TEXT NOT NULL, fence INTEGER NOT NULL CHECK(fence>=1), acquired_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 active_mutation INTEGER NOT NULL DEFAULT 0 CHECK(active_mutation IN (0,1)), operation_id TEXT
);
CREATE INDEX agent_lease_conflicts ON agent_leases(resource_key,expires_at,mode);
CREATE UNIQUE INDEX agent_lease_owner ON agent_leases(resource_key,owner_type,owner_id);
CREATE TABLE agent_resource_quarantine (
 resource_key TEXT PRIMARY KEY REFERENCES agent_resource_fences(resource_key),
 tool_call_id TEXT REFERENCES agent_tool_calls(id), owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
 reason TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE agent_environment_groups (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL, run_id TEXT NOT NULL,
 agent_runtime_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN
 ('creating','ready','starting','running','stopping','stopped','deleting','deleted','failed')),
 retained INTEGER NOT NULL DEFAULT 0 CHECK(retained IN (0,1)),
 limits_json TEXT NOT NULL CHECK(json_valid(limits_json)), version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(id,user_id,app_id),
 FOREIGN KEY(run_id,user_id,app_id) REFERENCES agent_runs(id,user_id,app_id),
 FOREIGN KEY(agent_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id)
);
CREATE TABLE agent_environments (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES agent_environment_groups(id),
 kind TEXT NOT NULL CHECK(kind IN ('shell','code','data','browser')), recipe_id TEXT NOT NULL,
 recipe_revision TEXT NOT NULL, base_runner_digest TEXT NOT NULL, catalog_revision TEXT NOT NULL,
 pack_refs_json TEXT NOT NULL CHECK(json_valid(pack_refs_json)), generation INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('creating','ready','starting','running','stopping','stopped','deleting','deleted','failed')),
 limits_json TEXT NOT NULL CHECK(json_valid(limits_json)), network_json TEXT NOT NULL CHECK(json_valid(network_json)),
 provisioning_ref_json TEXT CHECK(provisioning_ref_json IS NULL OR json_valid(provisioning_ref_json)),
 retained_manifest_ref TEXT REFERENCES ai_artifacts(id), version INTEGER NOT NULL DEFAULT 1,
 last_active_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE agent_environment_commands (
 id TEXT PRIMARY KEY, environment_id TEXT NOT NULL REFERENCES agent_environments(id), action TEXT NOT NULL,
 operation_hash TEXT NOT NULL, generation INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','unknown')),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 deadline_at INTEGER NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER
);
-- Phase 3
CREATE TABLE agent_artifact_grants (
 id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES ai_artifacts(id),
 receiver_user_id INTEGER NOT NULL, receiver_app_id TEXT NOT NULL,
 receiver_runtime_id TEXT REFERENCES agent_runtimes(id),
 expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL,
 FOREIGN KEY(receiver_user_id,receiver_app_id) REFERENCES agent_apps(user_id,app_id)
);
CREATE TABLE agent_shared_facts (
 run_id TEXT NOT NULL REFERENCES agent_runs(id), key TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)), version INTEGER NOT NULL DEFAULT 1,
 updated_by_runtime_id TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(run_id,key),
 FOREIGN KEY(updated_by_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id)
);
CREATE TABLE agent_delegations (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id),
 parent_runtime_id TEXT NOT NULL, child_runtime_id TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)), result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 status TEXT NOT NULL CHECK(status IN ('created','accepted','completed','failed','cancelled')),
 depth INTEGER NOT NULL CHECK(depth>=1), profile_id TEXT NOT NULL,
 model_ref_json TEXT NOT NULL CHECK(json_valid(model_ref_json)),
 budget_json TEXT NOT NULL CHECK(json_valid(budget_json)), reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>=0),
 version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, completed_at INTEGER,
 FOREIGN KEY(parent_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id),
 FOREIGN KEY(child_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id)
);
CREATE TABLE agent_plugin_versions (
 app_id TEXT NOT NULL, version TEXT NOT NULL, package_hash TEXT NOT NULL,
 publisher_key_id TEXT NOT NULL, manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 status TEXT NOT NULL CHECK(status IN ('staged','verified','installed','failed','removed')),
 installed_at INTEGER, PRIMARY KEY(app_id,version)
);
CREATE TABLE agent_integrations (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('mcp','acp')), configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
 protected_credential TEXT, schema_hash TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,app_id) REFERENCES agent_apps(user_id,app_id)
);
~~~

Environment provisioning_ref_json仅Infrastructure读取，含opaque controller references，不序列化给frontend。资源quota由Agent Settings Hard Limits定义；Controller journal记录实际reserve/usage并执行同一份Hard Limits，不维护另一套隐藏资源上限。Controller仍必须验证cgroup/tmpfs/PID等隔离能力以及宿主实际分配结果。

删除API不是任意表cascade：只接受终态且无quarantine/未决job的Run；有未deleted环境或retain环境组时返回409 RUN_HAS_ENVIRONMENTS，用户须先明确处理环境，不能顺带删保留环境。然后标delete command pending→清理/脱链Artifact并保留retain对象→清tool/approval/checkpoint/step/attempt/已deleted环境历史→删除该Run的ledger entries及Run；Thread next_sequence不回退，ledger分页允许删除造成的缺口。parentRunId被引用时默认保留原Run只隐藏内容，禁止FK破坏恢复链。删除Thread逐个处理Run；用户明确清数据才做此操作。App uninstall默认不删这些表。所有单行/列表写须在repository检查scope；跨App Artifact grant是唯一例外，必须同事务验证有效grant后建link。

### 4.3 StateCommitPort：一次事务保证事实/投影/ledger/summary

StateCommit输入={scope,runId,expectedRunVersion,expectedInputRevision?,expectedPolicyRevision?,generation,events,runPatch,ledgerAppends,toolPatches,approvalPatches,commandCompletion?}。events是受schema限制的事实（≤64条/≤256 KiB），不是任意JSON SQL。输出={runVersion,eventCursor,ledgerCursor,committedEvents}。投影patch只能由domain reducer从事件导出；repository检查事件和patch一致，不能允许API直接构造patch。

单事务步骤：验证generation及scope→CAS run.version/输入/授权revision→为ledgerAppends分配ai_threads.next_sequence→为events分配agent_runs.next_event_sequence→insert entries/events与变更记录→更新Run状态/水位/usage→按旧新状态差额更新agent_apps计数→分配host sequence并写安全summary.changed outbox→可选commit幂等response→COMMIT。异常整笔回滚；只有commit成功才唤醒SSE与scheduler。创建Run的事务还包含input、初始runtime、run.created和幂等claim，不先返回201再写DB。

运行事实表是唯一可重建运行状态源，但Provider/config、Ledger正文、Artifact metadata仍是各自canonical记录；event保留其ref/version。禁止以“event唯一事实”删除这些不可替代数据。重建时不依赖delta；已删除Run的数据不再承诺恢复。

SQLite transaction内只有限SQL，不做remote inspect、文件fsync、模型流、await外部mutex；多repository组合必须用transaction-scoped adapter，不能嵌套调用DatabaseAdapter.transaction。提交队列上限256个command/4 MiB；达到上限拒绝新创建503 AGENT_BUSY（Retry-After:1），已有安全终态预留32个槽，不能静默丢弃终态。每batch最多64events/256KiB，delta按50ms合并发网络，不写数据库。接收raw tool输出在独立流预算内，不能占SQLite队列。

Host readSnapshotWithCursor(userId)同事务读agent_apps计数与host next_sequence-1；Run snapshot同事务读投影/entries水位与run next_event_sequence-1。首次快照最多最近50entries，历史分页另取，timeline独立keyset分页；payload受1MiB snapshot上限，超过则返回分页refs，不把无限日志塞snapshot。

### 4.4 幂等与崩溃窗口

Idempotency-Key只来自HTTP header，UUID格式；创建Run/输入/审批决定/环境动作/删除都必须带。scope=(userId,appId,commandName,key)，宿主命令使用保留scope appId='nexus.host'（仅command表，不伪造可安装App）。requestHash由规范化DTO+API schemaVersion得到，排除requestId/key但包含资源id和expectedVersion。

claim使用unique约束：同key不同hash→409 IDEMPOTENCY_PAYLOAD_MISMATCH；同key committed→重放原status/data，requestId换成本次请求；pending→409 IDEMPOTENCY_IN_PROGRESS+Retry-After1；unknown→409 RECONCILIATION_REQUIRED。read/get不是创建，因此不需要key。4xx确定性校验失败不claim；外部执行前claim记录必须committed可见。

纯数据库命令claim+业务写+response一起commit，crash前回滚、crash后可重放结果。长环境命令先持久化pending+commandId再发Controller，完成后保存result；断线queryCommand，不发第二个新command。pending/unknown不可仅因TTL过期重执行；committed24小时清理。API须说明幂等窗口24小时，用户24小时后主动再次提交新命令被视为新操作；toolCallId/Controller commandId副作用去重保留至所属Run删除，不只依赖短期HTTP key。

### 4.5 当前SQLite容量与性能验收边界

当前Agent直接复用现有单连接`DatabaseAdapter`，不为Agent新增第二个Backend写连接、Redis或PostgreSQL。默认 Runtime 软值2、默认Hard Limit 4、模型并发auto→2，加上delta/tool chunk不落库、Artifact raw bytes不入SQLite、StateCommit批量提交与分页读取，构成首轮SQLite已验证容量基线；Hard Limit以后可由用户在Settings二次确认提高，但这不自动代表更高并发已经完成容量验收，设置页需明确风险，必要时重新跑本节负载门槛。数据库替换不是开工前置条件。

真正风险是全Backend DB操作都经过单一串行队列，因此transaction内严禁等待模型、SSH、Docker、HTTP、文件fsync或外部mutex。Agent实现必须观测`dbQueueDepth/dbQueueWaitMs/transactionDurationMs/agentBusyCount`；P1-C/P1-D负载验收至少覆盖默认2 Runtime持续运行、默认Hard Limit 4 burst、Host+Run SSE和普通Workspace/Settings请求并存。首轮工程门槛：默认并发不出现`AGENT_BUSY`，StateCommit p95≤25ms，DB queue wait p95≤50ms，普通非Agent API不出现持续性>100ms数据库排队；hard-limit burst允许背压但不能丢安全终态或破坏event/ledger/run原子性。

只有出现多Backend实例、多用户高并发、用户把Runtime Hard Limit显著提高并实际产生持续高并发、重新引入durable高频stream写、跨进程work claiming/leader需求，或在正确batch/分页且transaction无外部I/O后仍无法满足上述延迟门槛，才重新评估WAL/读连接拆分或数据库迁移。进入多Backend后必须连同scheduler/lease/claim/event sequence/idempotency一起重设计，不能只替换SQLite驱动。

<a id="i5"></a>
## 5. Tools、安全链、审批与Lease

### 5.1 唯一工具契约与Nexus适配

~~~ts
type ToolDescriptor = {
 name: string; version: string; description: string; inputSchema: JsonValue;
 riskClass: 'read' | 'mutate' | 'destructive'; capability: string;
};
type TargetFingerprint = {
 connectionId: number; targetIdentity: string; endpoint: string; sshHostKey: string;
 loginUser: string; configurationHash: string;
};
type Precondition = { kind: 'fileHash' | 'metadata' | 'serviceState' | 'environmentGeneration';
 key: string; observedValue: JsonValue };
type ToolInspection = {
 toolName: string; toolVersion: string; normalizedArguments: JsonValue;
 target: TargetFingerprint | { environmentId: string; generation: number };
 resourceKeys: string[]; risk: 'read' | 'mutate' | 'destructive' | 'forbidden';
 mutation: boolean; operationHash: string; operationHashVersion: 1;
 preconditions: Precondition[]; policyRevision: number; inputRevision: number;
};
type ToolContext = Scope & {
 actor: Actor; runId: string; agentRuntimeId: string; stepId: string;
 signal: AbortSignal; deadlineAt: number; maxOutputBytes: number;
};
type RawToolResult = {
 exitCode: number | null; confirmedStopped: boolean; output: AsyncIterable<Uint8Array>;
 data?: JsonValue; evidenceRefs: string[];
};
type ToolResult = {
 ok: boolean; summary: string; data?: JsonValue; artifactRefs: string[];
 truncated: boolean; outcome: 'confirmed' | 'unknown'; errorCode?: string;
 verification: VerificationResult;
};
interface AgentTool {
 descriptor: ToolDescriptor;
 inspect(input: JsonValue, ctx: ToolContext): Promise<ToolInspection>;
 execute(inspection: ToolInspection, ctx: ToolContext): Promise<RawToolResult>;
 verify?(inspection: ToolInspection, result: ToolResult, ctx: ToolContext): Promise<VerificationResult>;
}
~~~

原始输入schema限制32KiB、嵌套深度16、数组最多1000项；工具无verifier时只能注册read。inspect可做只读探测，但受同样授权、超时/输出边界，不能被当成免费任意SSH旁路。

MachineCapabilityPort只提供：
- diagnose(scope,connectionId,probeIds:string[],signal):Promise<DiagnosticReport>，通过既有SystemDiagnosticsService.run，不能读取无限日志或进程内对象。
- readFile(ctx,connectionId,path,maxBytes,offset=0):Promise<BoundedFileResult>，metadata/realpath先检查，readBounded流式限额，默认1MiB原始文本。
- writeFile(ctx,inspection,contentArtifactRef):Promise<WriteEvidence>，先读取原hash/metadata和备份Artifact，邻近临时文件写完再rename，verify新hash；写前外部变化拒绝RESOURCE_CHANGED，不暗中覆盖。
- executeShell(ctx,inspection):Promise<RawToolResult>，仅adapter把已规范化argv转换POSIX quote或显式shell文本；不把模型对象拼接进命令。
- dockerAction(ctx,inspection):Promise<DockerEvidence>，复用RemoteDockerService.getStatus/executeCommand，containerId严格校验，操作restart/start/stop绑定目标状态和imageId。

机器adapter通过ConnectionService.get(id)及当前连接解析服务得到ResolvedSshConnection，然后ExecutionSessionManager.connect({ownerType:'agent',ownerId:agentRuntimeId,connection})；明文credential仅解析/transport边界，不进入inspection。inspect之前可创建临时只读执行session，但同样属于该AgentRuntime且finally关闭。所有资源检查不假设connection.user_id存在。

文件路径使用目标机POSIX语义；拒绝NUL、相对逃逸、未解析symlink；父目录realpath与目标metadata纳入前置条件。root目录/系统设备/secret位置默认硬deny可在用户配置中扩展黑名单，不能由模型修改。目录递归删除不是首批文件工具，需单独明确操作类型/影响清单/审批，禁止以writeFile顺带实现。

### 5.2 operationHash v1

OperationV1顶层恰好包含：
{schemaVersion:1,scope:{userId,appId,runId,agentRuntimeId},tool:{name,version},
target,arguments,resourceKeys,preconditions,secretRefs:[{id,version}],policyRevision,inputRevision}。
target为上述fingerprint；arguments为inspect生成的规范化参数；secretRefs不含明文，顺序按id/version；resourceKeys排序去重；preconditions按kind/key排序；argv保持顺序，cwd/路径先规范化。空数组保留，缺失可选字段规范化为null，禁止undefined。使用清洁对象而不是Date/class/prototype对象。

canonicalize采用RFC8785的JSON序列化原则：对象key按UTF-16字典序排序、数组顺序保留、字符串JSON转义且不做Unicode归一化；拒绝孤立surrogate、NaN/Infinity/BigInt/undefined/稀疏数组，参数中的计数/字节/期限必须safe integer；-0编码为0。hashOperation返回 'v1:' + SHA256(UTF8(canonicalize(op))).hexLowercase，不含空格/BOM/尾换行。JSON序列化实现放domain纯函数；sha256通过明确CryptoHashPort注入Infrastructure node:crypto，不能引入Provider SDK。

以下是编码/散列固定向量（并非合法Operation，可单独验证编码层）；完整Operation还必须通过schema校验：

| JSON输入 | canonical UTF-8文本 | 输出 |
| --- | --- | --- |
| {} | {} | v1:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a |
| {"b":2,"a":1} | {"a":1,"b":2} | v1:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777 |
| {"argv":["printf","你好"],"cwd":"/tmp","env":{"LANG":"C"}} | {"argv":["printf","你好"],"cwd":"/tmp","env":{"LANG":"C"}} | v1:54379b377de956892ffa749669ea5e0555203ac000c98f40fc2dc4aaa747f6ce |

产品E2E通过创建相同操作proposal的API验证稳定hash/不同argv顺序改变hash/文件版本或secretRef revision变更导致旧approval拒绝，不通过import内部hash函数作为自动行为测试。

### 5.3 执行时序与Approval CAS

1. schema→只读授权检查→inspect→当前App/grant/denylist/policyRevision→hard deny/read allow/mutation requireApproval。
2. 将inspection、tool.proposed及timeline事实原子提交，不能先执行再写proposal。Phase 1 mutation直接CAPABILITY_UNAVAILABLE。
3. requestApproval(ctx,inspection)创建requested，expiresAt=now+600，记录requestedByRuntimeId、inputRevision、operationHashVersion、policyRevision。
4. resolve(scope,id,{decision,operationHash,expectedVersion})：事务外读当前inspection并重新只读探测；事务内复查归属、App/grant revision、input revision、status=requested、expiresAt>now、hash和version；UPDATE ... WHERE version=? AND status='requested' AND expires_at>?，affectedRows=1才成功。失败APPROVAL_STALE，不在SQL锁内等待网络。
5. 成功批准不等于已执行；executor等待可用lease后再次inspect/fresh检查，再在一次state commit内consume approval（consumedAt从null CAS）、tool.ready→running及tool.started。审批到期/新input/denylist更新先赢则此事务失败，释放lease。
6. 执行、限额处理、artifact、verify在DB事务外。结果与tool终态/消息/Run投影同事务提交；finally释放已确认结束的lease。输出未知则quarantine不释放执行资格。
7. 用户拒绝/expiry/supersede写事实，tool cancelled、Run回running处理结果；planner不自动续批，不自行批准再次相同动作。

未知Shell默认requireApproval，不能靠模型说read-only自动放行；只读catalog按准确binary+args/flags验证，不允许管道/重定向/子shell；显式shell文本使用不同tool capability且完整文本纳入hash。argv runner与shell-text runner不能混淆。硬deny范围包括connection denylist、未声明capability、宿主Docker socket/任意hostPath、明显跨App访问及部署禁止动作，approval永远不能覆盖。

环境用户控制同样建立有toolCallId的ControlAction inspection/approval审计，挂在所属Run的控制timeline；终态Run状态不重启，只允许用户对保留环境的受限管理事件。AI只能在活跃自有Run请求；用户必须明确确认当前action/hash。UI确认不产生一个可供AI任意复用的通用授权。

### 5.4 Lease、quarantine与Workspace

acquireMany(owner:{type,id},resourceKeys:string[],mode,ttl=30):Promise<Lease[]>在单事务：
排序去重keys→确保resource_fences行→把过期且可能仍运行的mutation标quarantine→剔除可确认安全的expired leases→检查quarantine（写拒绝，受限reconcile只读例外）→查询活动锁（read只冲突write，write冲突全部）→每key分配nextFence并insert lease。
任何key冲突整笔回滚，409 LEASE_CONFLICT带retryAfter，不先拿部分锁造成死锁。所有agent读/写均取target根锁；不同App争同目标也互斥。owner同key嵌套/读升级写拒绝LEASE_REENTRANT，调用方一次声明完整资源集。

renew(leaseIds,owner,ttl)只更新owner+fence+未过期行且无撤销条件，更新行数必须全部匹配，否则整批失败。每10秒续期，失败立即停止新副作用，发送abort并等待核实。release幂等但只能本owner释放；quarantine只有reconcile确认或显式用户证据解决后CAS删除。lease过期不自动解除quarantine。

Workspace MutationGuard与Agent共用同一个lease实例，通过Platform的MutationGuardPort注入。withLease在开始work前记录owner operation active，结束确认后清理；未知结果也写quarantine。为此agent_leases增active_mutation及operation_id（见SQL补充），不是凭tool表猜测Workspace是否仍运行。原始PTY/外部SSH不加入此保证，产品UI明确边界；新读探测发现冲突时不覆盖。

### 5.5 取消与失败处理

已持久化tool.started后绝不自动重发execute。transport超时、SSH断线、进程退出不确认时RawToolResult.outcome=unknown，记录RECONCILIATION_REQUIRED，Run interrupted。只有read工具可有限重试；mutation必须查询预期效果，不能以“执行一次应该没问题”重跑。reconcile公开证据包括观察时间、当前hash/state、对应toolCallId、是否确认停止，不泄露secret。无证据的人工强制解除要单独危险确认并写user override，后续新操作重新审批。

<a id="i6"></a>
## 6. Provider、Artifact、Recall与备份实施

### 6.1 Provider持久化、请求和密钥

ProviderInput={kind:'openai-compatible',displayName,baseUrl,credential?,clearCredential?:boolean,models:[{id,contextWindow,maxOutputTokens,supportsTools,priceMicrosPerMillionInput?,priceMicrosPerMillionOutput?,priceVersion?}],privateHostExceptions:string[],enabled}。credential缺省保留；空字符串拒绝；clearCredential=true与credential互斥。任何读取只返hasCredential，密文不入domainDTO；通过provider-secret.adapter.withCredential接既有SecretCipher.encrypt/decrypt，临时明文不进入缓存/事件/Artifact。删除有活跃Run引用时409 PROVIDER_IN_USE，之后tombstone并清密文，历史快照仍可解释。

价格由用户配置/发行版preset提供、保存version与每百万token整数micro-USD；金额=ceil((input*priceIn+output*priceOut)/1000000)，使用BigInt计算后检查safe integer输出。cached input可按配置独立price计费，但Run token预算仍算完整input；未知price成本null，配置cost cap时拒绝unknown价格。

save先校验HTTPS、公网DNS与显式例外；test只发送固定的最小model请求，maxOutputTokens=16/timeout10s，消耗展示给用户，不伪称零成本。正式请求maxOutputTokens来自Run snapshot；每个attempt记录configured model+usage/version，不相信模型返回的价格。Provider流最多1MiB单frame，工具arguments最多32KiB，headers30秒、idle60秒，并受当前attempt deadline、取消状态和Run active-time软预算约束；断流通过§2 retry协议处理。

outbound-policy.resolve(url,exceptions):ResolvedEndpoint返回经校验且固定的IP集合/SNI；使用可注入dispatcher/custom lookup实际连接这些地址，不能校验一次后让默认DNS重新解析。默认拒绝所有redirect，抛PROVIDER_REDIRECT_DENIED。用户显式私网host:port例外在部署settings可配置，但metadata/link-local/unspecified/multicast始终拒绝；HTTP仅开发loopback。endpoint例外不共享给browser/MCP。

### 6.2 Artifact落盘和授权

LocalArtifactStore根目录为NEXUS_DATA_DIR/agent/artifacts/{tmp,objects}；storageKey为服务端随机UUID，objects按前两字符分片，不以请求path拼接；拒绝symlink并验证真实root。不做跨App全局hash去重。read ticket只允许特定artifactId/range/receiver/deadline，不授目录遍历。

begin(scope,{name,mediaType,declaredBytes,runId?})事务预留global+run配额并insert staging；每请求必须Content-Length或先声明exact upload size，不能无界chunked上传。最多2个同时上传，单次50MiB/120秒；写实际字节超过声明或断流立即失败并release reservation。服务端工具未知输出大小按raw上限预留，逐块限流，完成后返还差额。给现有Artifact新建run link时按对象实际字节一次计入该Run，不按role重复计算；源全局bytes只计一次。

write顺序：O_EXCL创建tmp→stream/hash/size+free disk检查→fsync file→rename同盘objects→fsync directory→事务staging→ready、预留转已用、artifact.created（有Run时）与host变化→响应ArtifactRef。rename成功DB失败不删除可能已提交对象，交reconcile；扫描每60秒，以staging age/对象状态确定完成ready还是清理孤儿，绝不将未登记路径暴露给用户。清理失败保留deleting并重试退避。

range GET仅单范围，默认前1MiB、显式max8MiB，支持If-None-Match hash及416，Content-Range总长度必须准确；超大查看通过分块而非全读。preview HTML/SVG/download统一attachment+nosniff；图片仅受允许media type解码，不内联可执行内容。model结果先redact再存默认Artifact；用户明确上传的原文件保留原bytes但标userSupplied，不进diagnostics日志。

GC按架构§8的retain/有效run/checkpoint/grant判断；活跃引用保护，expired metadata与payload一致变更。全局quota降低低于已用时拒绝设置，不负数回收。无空间返回507 ARTIFACT_QUOTA_EXCEEDED，上传超大小413；这些不是Model错误，不做无穷重试。

Artifact Library 是 Host 给当前用户的聚合视图，不改变 `ai_artifacts.app_id` 的所有权边界。library list 只聚合该用户且来源 App 当前对用户可见的 metadata，并返回 `source={appId,threadId?,runId?,role?}`、mediaType/bytes/status/retained/createdAt/lastReferencedAt/protectedReason?；默认按更新时间倒序 cursor 分页，不全量返回。搜索只针对安全 metadata（文件名/mediaType/source label），不把文件正文自动建索引。用户从文件库把其他 App 的 Artifact“引用到当前对话”时走 Host use case：验证 source owner=user、目标 App enabled/authorized、Artifact ready、目标 Thread/Run scope 后显式建立 grant/link；App SDK 和模型不能直接调用跨 App library attach。

文件库 cleanup preview 只选择 `ready && !retained && noActiveRun/checkpoint/grant` 的可回收对象，并返回 selectedBytes/selectedCount/protectedCount/按来源分组摘要；confirm 复用 confirmationId + 当前 metadata/version 再校验，发生新引用则跳过并报告 partial，而不是竞态删除。Library UI 的 quick preview 复用 Artifact range/preview 契约，文本/图片/PDF等按已有安全 viewer 有界读取；未知或不可安全内联类型只显示 metadata + 下载。列表和预览都必须 cursor/lazy load，不能把用户长期累积文件全部进 Pinia/DOM。

### 6.3 Skill、Memory和数据备份

一期skills存modules/agent/apps/operations/skills/<id>/SKILL.md及资源，build显式复制；SkillMetadata={id,version,hash,description,requiredCapabilities,trust:'builtin'}，loadBody max12KiB，资源max50MiB进Artifact，真实路径必须留在Skill root且不跟随外链。Skill文本为untrusted guidance，不能改system authority或自动执行脚本。

Recall按scope过滤published且未expired/revoked的Memory，评分为词匹配+来源新鲜度，limit5/max8KiB；没有记录返回[]不阻塞Run。三期proposeMemory(scope,{content,sourceRefs,confidence,expiresAt})只写candidate，reviewMemory(user,id,{publish|reject},version)才生效；UI可编辑/撤销，操作审计。跨App导入需要AppIntent+用户确认。

Backup默认沿用既有DB快照能力，manifest记录agentSchemaRevision、artifactPayloadIncluded=false、pluginsExcluded=true、environmentVolumesExcluded=true；带加密credential的备份遵守既有备份保护，不能另行导出明文。二期includeAgentArtifacts=true先quiesce相关写、冻结ready对象清单和引用计数，再复制到备份临时区/hash校验并释放冻结，备份生成本身有全局磁盘reserve；生成完才发布下载。
Restore先quiesce→恢复DB→撤销Agent tokens/未consume approvals→所有非终态Run interrupted→检查payload/key/plugin版本→缺失Artifact unavailable/Provider degraded/App disabled→重算quota/summary→开放API。不自动启动旧容器。备份文档/UI明确缺失payload不能resume依赖该对象的checkpoint。

<a id="i7"></a>
## 7. HTTP、SSE、安全与生产Ingress

### 7.1 通用传输规则与接口表

所有下列路由继承现有session/IP/2FA边界。Interface从session推导userId，路径校验appId并交service授权，不信任body.userId。成功={data,requestId}，错误={error:{code,message,details?},requestId}，仅Agent新API采用此格式；X-Request-Id合法UUID可沿用，否则生成。POST/PATCH/PUT/DELETE按§4幂等规则，commandId不进模型提示。分页limit默认50/max100，opaque before包含稳定(time,id)；非法cursor400。 `feature.enabled=false` 只关闭Agent任务执行，不关闭管理员配置/维护：Settings、Provider配置/test、App启停、Host summary、历史Thread/Run/Artifact读取、文件cleanup、Environment Catalog/Pack setup/install/uninstall/cache/runtime cleanup与reconcile仍可访问。创建Thread/Run、向Run追加会触发执行的输入、预算恢复、Agent工作Environment的provision/start、Tool/Model/Subagent等新执行命令统一返回409 `AGENT_DISABLED`。正在执行的旧任务只允许走quiesce/cancel/reconcile终态路径，不能因总开关关闭绕过安全收敛。

Agent mutation额外要求X-Nexus-CSRF=session绑定的随机256-bit token；GET /api/v1/agent/security/csrf（no-store）只对已登录同源请求签发。Origin存在必须精确匹配部署AGENT_PUBLIC_ORIGIN；生产无该配置拒绝启用mutation，dev允许明确loopback origin。Sec-Fetch-Site为cross-site拒绝；Origin缺失的非浏览器调用仍须session+CSRF且不能带cross-site标记。只信配置的反向代理来源，不用任意X-Forwarded-Host构造允许origin。认证失败401，scope不匹配404，capability/hard deny403；错误details不得含密文/内部路径。

| 路由（前缀 /api/v1） | Input → Output；期号 / Controller |
| --- | --- |
| GET /agent/apps | 无→AppSummaryView[]；P1 host.controller |
| PATCH /agent/apps/:appId | {enabled,expectedVersion}→AppRecord；P1；停用202直到排空 |
| GET/PATCH /agent/settings | GET→requestedSettings/effectiveSettings/hardLimits/runtimeCapabilities/availability/revision；PATCH={patch:{section:{...}},expectedVersion}→同结构；P1 host.controller |
| GET/PUT /agent/target-denylist | put={connectionIds:number[],reason,expectedRevision}→revision/list；P1，配置只影响Agent工具 |
| GET /agent/summary | 无→HostSnapshot；P1 host.controller |
| GET /agent/events?cursor=0 | Host SSE；P1 events.controller |
| GET /agent/environments/availability | →{available:false,reason:'phase_not_enabled'或'daemon_unavailable',recipes:[],packs:[]}；P1真实消费者；P2返回Runner/engine探测结果 |
| GET /agent/environments/catalog | →{catalogRevision,recipes,packs,runtimeCapabilities}；P2；每个 Pack 显示 available/enabled/installed/inUse/deprecated、digest、diskBytes 与 arch |
| GET /agent/environments/storage | →state/packs/cache/runtime/quarantine/engineOverhead互斥用量与reclaimable；P2 |
| POST /agent/environments/setup/preview、/confirm | 初始化/补装所选Recipe与多个Pack版本；confirm→202 EnvironmentCommandView；P2 |
| POST /agent/environments/packs/:familyId/:versionId/install | →202 PackInstallCommand；安装/预拉取精确 Environment Pack，不创建 Environment |
| POST /agent/environments/packs/:familyId/:versionId/uninstall/preview、/confirm | preview 引用/默认版本/可释放空间；confirm 卸载精确 Pack，不影响同 family 其他版本；active 引用返回409 ENVIRONMENT_PACK_IN_USE |
| POST /agent/environments/runtime-cleanup/preview、/confirm | preview active jobs/运行资源/预计释放空间；confirm 只清 runtime/container/network/job等运行残余，保留Pack/cache/Settings/Artifact；未知副作用返回PARTIAL_RESTORE |
| POST /agent/environments/cache-cleanup | →202 EnvironmentCommandView；只清安全可重建cache，不卸载Pack、不清active runtime；P2 |
| POST /agent/environments/settings/reset/preview、/confirm | 恢复发行默认Recipe/版本/资源/网络配置；必须二次确认；P2 |
| GET /agent/environments/commands/:commandId | →queued/running/succeeded/failed/partial/unknown + stage/progress/result；所有安装/卸载/setup/cleanup长命令可断线后按commandId恢复；P2 |
| GET/POST /agent/ai/providers | POST ProviderInput→ProviderView（201）；P1 ai.controller |
| PATCH/DELETE /agent/ai/providers/:id | PATCH ProviderInput子集+expectedVersion，DELETE expectedVersion query→安全View/tombstone；P1 |
| POST /agent/ai/providers/:id/test | {modelId}→{ok,latencyMs,usage,errorCode?}；P1 |
| GET /apps/:appId/agent-definitions | →静态贡献的定义/模型能力要求；P1 run.controller |
| GET/POST /apps/:appId/threads | POST {title?:string}→ThreadView；不自动创建Run；P1 |
| GET /apps/:appId/threads/:id | →ThreadView+latestRunId（用于刷新恢复）；P1 |
| GET /apps/:appId/threads/:id/entries | page→LedgerEntryView[]；P1 |
| POST /apps/:appId/runs | CreateRunCommand去command（幂等从header）→201 RunView，Location指snapshot；P1 |
| GET /apps/:appId/runs/:id | →RunSnapshot含eventCursor及分页ref；P1 |
| GET /apps/:appId/runs/:id/events?cursor=0 | durable+transient SSE；P1 |
| POST /apps/:appId/runs/:id/inputs | {text,artifactRefs,expectedVersion}→202 {inputId,sequence,runVersion}；P1 |
| POST /apps/:appId/runs/:id/budget | {scope?:'run'|'delegation'|'mailbox',refId?,increase:{...},expectedVersion}→RunView；P1只启用scope=run（maxRunTokens/maxRunSteps/maxActiveExecutionSeconds/maxCostMicros），P3增加delegation（maxTokens/maxSteps）与mailbox（maxMessages/maxBytes）；都只提高本次Run内对应软预算，幂等且不得越当前Agent Settings Hard Limit |
| POST /apps/:appId/runs/:id/cancel | {expectedVersion}→202 RunView或已终态200；P1 |
| POST /apps/:appId/runs/:id/resume | {checkpointId,expectedVersion}→201新RunView；P2 |
| DELETE /apps/:appId/runs/:id | ?expectedVersion=N→202 command或409仍active/被引用；P1 |
| GET /agent/files | user-scoped Artifact Library cursor page；支持 q/source/appId/threadId/runId/mediaType/retained/reclaimable 过滤，返回安全 metadata+source，不返回正文；P1 host.controller |
| GET /agent/files/storage | →{totalBytes,retainedBytes,protectedBytes,reclaimableBytes,stagingBytes,unavailableBytes}；P1 host.controller |
| POST /agent/files/cleanup/preview、/confirm | 用户级可回收 Artifact 清理；preview 返回数量/字节/保护对象摘要，confirm 重新校验引用并允许 partial；P1 host.controller |
| POST /agent/files/:id/attach | {targetAppId,threadId,runId?,role:'input',expectedVersion?}→ArtifactRef/link；仅用户显式动作，跨App时服务端建立grant/link，App SDK不可调用；P1 host.controller |
| POST /apps/:appId/artifacts | {name,mediaType,declaredBytes,runId?}→201 {artifactId,uploadUrl,expiresAt}；P1 artifact.controller |
| PUT /apps/:appId/artifacts/:id/content | raw stream+Content-Length+CSRF→ArtifactRef；P1，≤50MiB |
| GET /apps/:appId/artifacts/:id | →metadata或410；P1 |
| GET /apps/:appId/artifacts/:id/content | Range/If-None-Match→200/206/304；P1，单range≤8MiB；无Range默认有界前段 |
| PATCH /apps/:appId/artifacts/:id | {retained,expectedVersion}→ArtifactRef；P1 |
| DELETE /apps/:appId/artifacts/:id | ?expectedVersion=N→202 tombstone；被保护引用409；P1 |
| POST /apps/:appId/approvals/:id/resolve | {decision:'approved'|'denied',operationHash,expectedVersion}→ApprovalView；P2 approval.controller |
| POST /apps/:appId/reconciliations/:toolCallId | {decision:'verify'|'acknowledgeUnknown',evidenceRefs,expectedVersion}→reconciliation；P2；后者需危险确认 |
| POST /apps/:appId/runs/:runId/environment-groups | {agentRuntimeId,environments:[{recipeId,versions?:{familyId:versionId},limits}],retained}→202 GroupView；缺省版本冻结当时family default；解析成精确PackRef；P2 environment.controller |
| GET /apps/:appId/runs/:runId/environment-groups | →GroupView[]；P2 |
| GET /apps/:appId/environment-groups/:groupId | →GroupView+EnvironmentView[]；P2 |
| POST /apps/:appId/environments/:id/actions | {action:'start'|'stop'|'restart'|'delete'|'setNetwork'|'resize',expectedVersion,parameters?,confirmedOperationHash?}→202 ControlCommandView或ApprovalView；P2 |
| GET /apps/:appId/environment-commands/:id | →pending/running/succeeded/failed/unknown；P2 |
| POST /apps/:appId/plugin-intents | {receiverAppId,intentId,input,artifactRefs,confirmed:true}→intent receipt；P3 |
| POST /agent/plugins/stage、/verify、/install | {artifactRef或stageId,expectedVersion?}→Stage/InstalledView；P3 plugin.controller |
| POST /agent/plugins/:appId/upgrade、/uninstall | {version?,deleteData:false,expectedVersion}→command；P3 |
| GET/POST /apps/:appId/integrations | configuration（MCP/ACP）→安全记录；P3 |
| PATCH/DELETE /apps/:appId/integrations/:id | expectedVersion+配置/删除→安全View；P3 |
| POST /apps/:appId/memories/proposals、/memories/:id/review | proposal或{decision,expectedVersion}→MemoryView；P3 |
| Subagent设置/创建/消息 | §10定义的准确路由；P3 subagent.controller |

CreateRun input.text UTF-8最多32KiB、refs最多10个，完整JSON最多1MiB；大数据先Artifact上传，不能base64内联。Run创建事务完成后异步调度，HTTP不等待整个模型任务。所有返回体不得包含Docker containerId、socket URL、执行secret、raw SQL、Provider密文或App factory路径。

错误码映射：400 VALIDATION_FAILED/CURSOR_INVALID；401 AUTH_REQUIRED；403 RESOURCE_FORBIDDEN/APP_CAPABILITY_DENIED/CSRF_REJECTED；404 NOT_FOUND；409 STATE_CONFLICT/AGENT_DISABLED/APPROVAL_STALE/LEASE_CONFLICT/RESOURCE_CHANGED/IDEMPOTENCY_* /RECONCILIATION_REQUIRED；410 ARTIFACT_UNAVAILABLE；413 PAYLOAD_TOO_LARGE；422 MODEL_CAPABILITY_UNSUPPORTED/CONTEXT_BUDGET_EXCEEDED；429 RUN_QUEUE_FULL；503 AGENT_BUSY/ENVIRONMENT_UNAVAILABLE/PROVIDER_UNAVAILABLE；507 ARTIFACT_QUOTA_EXCEEDED。未知内部异常返回INTERNAL_ERROR+requestId，不把stack转给模型或浏览器。

### 7.2 SSE协议和cursor

DurableEvent={eventId,runId,sequence,schemaVersion:1,type,occurredAt,payload}；
TransientEvent={runId,agentRuntimeId,modelAttemptId?,toolCallId?,streamId,chunkIndex,type,payload}，type仅message.delta/tool.output_chunk；不要求tool输出虚构modelAttemptId。
HostEvent={sequence,schemaVersion:1,type:'summary.changed'|'feature.changed'|'app.changed'|'authorization.changed',occurredAt,payload:{featureEnabled:boolean,hostState:'enabled'|'disabling'|'disabled',apps:AppSummaryView[]}}，不含message/tool/Artifact正文或完整Settings。
AppSummaryView={id,displayName,version,enabled,health,runningRuns,pendingApprovals,pendingBudgetRequests}；HostSnapshot={featureEnabled,hostState,apps,totalRunningRuns,totalPendingApprovals,totalPendingBudgetRequests,eventCursor}。`featureEnabled`来自Settings期望值；`hostState`在featureEnabled=false但仍在quiesce时为disabling，完成收敛后为disabled。runningRuns统计Run running/awaiting_approval/awaiting_budget/cancelling，不按Runtime/Subagent数量重复统计；预算请求通过Host summary提醒用户。

Durable SSE写 id: <runId>:<sequence>，event: <type>，data为JSON；Host id: host:<userId>:<sequence>；transient不写id行。heartbeat为冒号注释，每15秒。V1持久事件不压缩，无CURSOR_EXPIRED；Run显式删除后404。未知event type同schema可跳过渲染但cursor推进；未知schema major终止详细流并显示升级提示，不能假装已经完整同步。

请求cursor整数≥0；Last-Event-ID必须是当前scope同Run/host格式。仅header时采用header；仅query时采用query；两者都有须解析到相同sequence，否则400 CURSOR_CONFLICT；超过当前high-water400 CURSOR_AHEAD，不能安静等待未来游标。不存在/不可访问的Run先404，再处理cursor避免泄露。用户注销/授权变化最多5秒检查一次session有效性，失效关闭流；前端401停止重试。

订阅无丢失算法：读一致性snapshot(cursor=C)→GET events?cursor=C；服务端以DB为事实源循环readAfter(last,limit=100)→发送全部并推进last→空页时等待有界通知或1秒poll→再次DB补读。先注册wake再读页可降低延迟，但无论wake丢失都靠poll补齐；不把只订阅内存EventEmitter当持久消息。消息重复允许，前端按(runId,sequence)去重。

单event payload≤64KiB，大对象用ref；每客户端待发≤256events/1MiB，response.write=false等待drain最多5秒；溢出关闭客户端让其重连，不能阻塞全局commit。连接最多每session3条（Host+当前Run+页面转换暂用），超限429；每10分钟server可主动rotate连接以重新认证，不影响cursor。

### 7.3 专用fetch客户端、Nginx与CSRF

Frontend api/agent-events.ts：subscribe({url,cursor,signal,onEvent,onSessionLost}):Promise<void>，fetch credentials:'include'/Accept:'text/event-stream'，不通过现有Axios。sse-parser.ts使用streaming TextDecoder，支持CRLF/多data行/空行分帧/注释，frame max128KiB，总buffer max256KiB；残缺帧不投递，EOF丢弃。重连1/2/4/8/15秒+jitter，离线等online；401清会话，403/404/不兼容停止；取消signal不重试。每次cursor仅来自已处理durable event，不能由最后delta覆盖。POST的401同样通过注入facade失效session。

packages/frontend/nginx.conf添加更具体的Agent location；保留原 /api/ 与 /ws/。外层 ^~ /api/v1/agent/ 和 ^~ /api/v1/apps/ 两段采用同样代理参数：

~~~nginx
# 此片段的 proxy_pass/headers 放进上述两个 Agent prefix location；
# 不能只写regex location，现有 ^~ /api/ 会屏蔽它。
proxy_pass http://backend:3001;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 75s;
proxy_send_timeout 75s;
client_max_body_size 1m;
~~~

仅在apps prefix内部增加content上传嵌套location（准确匹配 /api/v1/apps/<appId>/artifacts/<uuid>/content，PUT）：client_max_body_size 50m、proxy_request_buffering off、client_body_timeout 120s，继承/重复安全proxy headers；其他Agent JSON仍1MiB。Backend在raw PUT路由验证Content-Length/CSRF/ownership后才消费stream。Backend SSE写Cache-Control:no-store、X-Accel-Buffering:no，不压缩；代理不添加Connection:upgrade。

所有Agent JSON/SSE/Artifact仍保持现有安全headers。三期plugin-ui单独origin设置frame-ancestors，Nexus CSP仅增加frame-src该精确origin；不删除全局X-Frame-Options DENY、不开放通用CORS。内部Controller Artifact通道另用mTLS listener，不暴露到此Nginx，也不接受浏览器cookie代替mTLS。

<a id="i8"></a>
## 8. 前端工程与交互状态

### 8.1 文件、函数与可见状态

Frontend根=packages/frontend/src/features/agent/。

| 文件 | 实施契约 |
| --- | --- |
| public.ts | export AgentSurfaceHost、AgentSettingsPanel、createAgentFacade(deps)；供App.vue和现有SettingsPage从public入口组合；不导Pinia实例，不导独立Agent页面routes |
| host/AgentSurfaceHost.vue | 接userId/onSessionLost，登录后保活；有modal时暂停Launcher；dispose所有私有状态 |
| host/AgentLauncher.vue | 单击立即open、6px拖动阈值、pointercancel/keydown；App选择仅在Hub内完成。角标取HostSummary，不取App store |
| host/AgentHubWindow.vue | bounds拖动/resize/clamp/maximize/minimize/close，非模态；标题/工具区含单选App切换，不提供Settings或Docker Runner配置跳转，slot为CurrentAppView |
| host/AgentAppSwitcher.vue | 常驻Hub标题区/会话栏顶部；授权App目录，**单选**当前App、最近项、搜索/启用状态/键盘选择；一个Thread/Run只归属一个App，不做多App组合执行 |
| host/CurrentAppView.vue | authorized registry→builtin map→lazy load→snapshot；loading/error/empty/disabled四类视图 |
| host/app-contribution.types.ts | contribution={appId,mount(ctx),dispose(),canClose?}；ctx只有scope-bound facade |
| host/builtin-apps.ts | id→()=>import('../apps/<slug>/public')；不是权限registry |
| host/window-manager.ts | openHub({restoreRecent:true})、switchApp({appId,threadId?})、minimizeHub()、closeHub()、setBounds(bounds) |
| host/surface-session.ts | maintain perAppViewState Map；activateApp(appId)、restoreThread(appId)、pauseDetail(appId)、disposeSession()；切App只暂停旧App详细订阅，不cancel其Run/Environment，generation避免旧响应覆盖 |
| host/app-registry.store.ts | safe Apps + HostSummary；applyHostEvent/refresh，非整个App运行事实容器 |
| api/agent-api.ts | JSON request/CSRF/幂等key封装，保留原Axios配置 |
| api/agent-events.ts、sse-parser.ts | §7 fetch/SSE有界解析、独立AbortSignal |
| runtime/run.store.ts | loadSnapshot/applyDurable/applyTransient/appendInput/cancel，按scope/run隔离，不依赖Operations |
| runtime/run-facade.ts | 供App调用的readonly view+commands，不暴露store |
| settings/AgentSettingsPanel.vue | 由现有 Nexus SettingsPage 的 Agent tab 挂载；包含总开关和各分区，展示requested/effective/Hard Limits/runtime capabilities/availability；不创建Agent独立设置页/路由 |
| settings/AgentFeatureSettings.vue、AppManagementSettings.vue | 总开关与App enabled/grant/health管理；关闭Agent走Host quiesce，停用单App只排空该App；两者语义分开 |
| settings/HardLimitsSettings.vue | 展示/编辑所有可配置Hard Limits、当前usage/runtimeCapabilities；提高值必须preview→二次确认→confirm，固定guardrail只读 |
| settings/ModelProviderSettings.vue | Provider/Model/credential/私网例外；密钥输入与显示分离 |
| settings/PerformanceSettings.vue | Runtime current executing/requested/effective/hard max 与model并发；model默认Auto跟随Runtime，允许向下调并显示排队影响 |
| settings/BudgetContextSettings.vue | Run token/step/active-time/cost软预算、context/output容量、timeout、Recall及“耗尽后询问增加”说明 |
| settings/SubagentSettings.vue | 三期delegation深度/profile模型与子预算；不显示历史累计数或独立child并发，Runtime并发统一去Performance设置 |
| settings/StorageArtifactSettings.vue | Artifact单对象/Run/全局配额、TTL、已用量；min free disk只读 |
| settings/EnvironmentSettings.vue | 二期长期 Environment Manager 入口；unavailable/uninitialized/ready/degraded 同页切换，首次初始化与后续 Catalog/Pack 多版本、默认版本、资源/网络、storage、运行 Environment、cleanup/restore/诊断都从此进入 |
| settings/SafetyNetworkSettings.vue | denylist、Provider私网例外、capability入口；不可关闭的hard deny只读解释 |
| settings/SystemGuardrails.vue | 只读显示event batch/commit queue/SSE/transient策略和数据库压力，不允许普通用户修改 |
| ai/ConversationPane.vue、VirtualConversationList.vue、ConversationMessage.vue、Composer.vue | conversation-first主视图；cursor反向分页、可视区windowing、流式delta批量刷新；Composer在Run执行/审批/预算等待时仍可提交输入 |
| runtime/TaskRail.vue、TaskDetailDrawer.vue | 右侧进行中任务/计划摘要和按需详情；rail只读摘要投影，drawer lazy加载步骤/日志/Artifact/审批/Subagent，不创建第二Composer |
| ai/ArtifactViewer.vue、ContextInspector.vue | 大对象有界预览/token来源；按需加载，不进长会话主DOM |
| files/ArtifactLibrary.vue、ArtifactLibraryList.vue、ArtifactQuickPreview.vue | Hub长期“文件”入口；用户级聚合已授权App的上传/生成/证据文件，cursor分页+虚拟列表，按来源/类型/大小/retained/reclaimable过滤，支持预览/下载/回来源/retain/delete/cleanup |
| files/ArtifactPicker.vue | Composer附件选择器；从文件库选择已有Artifact或进入当前App上传，选择跨App文件时只提交Host attach命令建立显式grant/link，不直接把其他App对象暴露给当前App store |
| apps/operations/public.ts | 导出Operations contribution |
| apps/operations/OperationsHome.vue、OperationsThread.vue | 会话列表 + conversation-first线程；自然语言产生/调整Run计划和任务，右侧TaskRail原位显示执行状态；首版无模型显示引导 |
| apps/operations/ToolTimeline.vue、ApprovalCard.vue | tool事实/风险/目标/规范化动作/hash/expiry，按钮只提交resolve |
| environments/EnvironmentAvailability.vue | 一期真实显示unavailable及二期说明，不显示可点击伪start |
| environments/EnvironmentList.vue、EnvironmentDetail.vue、EnvironmentActionDialog.vue | 二期recipe/baseRunner/packRefs/资源/状态/job/artifact/AI动作与用户审批 |
| environments/EnvironmentCatalog.vue、EnvironmentSetupPanel.vue、EnvironmentPackManager.vue、EnvironmentStoragePanel.vue、EnvironmentCleanupDialog.vue | SetupPanel仅在同一管理页的uninitialized/需要补全配置时显示；Catalog/PackManager持续负责多版本安装/卸载/默认与启用版本，StoragePanel持续展示state/packs/cache/runtime/quarantine/engine占用，cleanup preview展示runtime/cache/quarantine与partial风险 |
| environments/environment-api.ts、environment.store.ts | list/get/requestAction/watchRunEvents；UI状态服务器authoritative |
| i18n/zh-CN.json、en-US.json、ja-JP.json | agent命名空间、三语同键；不复制全局样式 |

AgentDependencies={getCurrentUserId,onSessionLost,notify,observeModalPresence,focusFacade}由App组合层注入，不让Agent私有import其他feature store。read-only diagnostics通过Backend，不让前端Agent自动点击Workspace按钮。

### 8.2 窗口与会话规则

HubState={status:'closed'|'opening'|'visible'|'minimized'|'error',bounds,maximized,activeAppId,recentAppIds,hubView:'conversation'|'files',perAppViewState:Map<appId,{threadId?,draft,scrollAnchor?,selectedTaskId?,hubView}>}；Agent没有`page` presentation，也不在Hub内承载Settings/Environment配置页。Launcher单击调用openHub，优先恢复最后activeApp及其perAppViewState→recent有效项→Operations→empty。AppSwitcher始终位于Hub内部，switchApp为单选presentation切换并增加navigationGeneration：旧App保存轻量view、暂停detail stream/重型组件，但不调用cancel/quiesce、不改变其Run/Environment/Subagent状态；新授权确认后加载contribution并snapshot+catchup，同时更新recentAppIds顺序。过期异步resolve立即dispose，不覆盖最新选择。perAppViewState只在当前登录内存保存，刷新后Thread/Run从服务端恢复，未提交draft不持久化。

Launcher不使用延迟点击计时器：primary pointerup在未超过6px拖动阈值时立即openHub；Enter/Space同样立即恢复最后App并ignore repeat。App选择只在Hub内`AgentAppSwitcher`完成，移动端也使用同一页内选择器。关闭/minimize/switchApp均不得调用cancelRun、环境stop/delete或Subagent cancel；后台App继续由scheduler执行，Host summary保持订阅。取消Run按钮是唯一显式取消入口之一，并独立确认显示将影响的子任务和未知副作用警告。

布局默认1080×700，min640×420但视口不足时以可视区域为上限；top留原导航高度，不hardcode旧header像素。宽<1200折叠详情，<768全宽sheet；visualViewport.resize时clamp并让Composer避让keyboard。App内容load failure可retry、回Switcher，不使整个Shell error。

Conversation 与执行状态分层：中间ConversationPane拥有唯一Composer；右侧TaskRail以当前Thread的计划/Run为主，并可追加**当前App其他Thread正在执行的Run紧凑摘要**，这些后台项点击后再按需打开对应详情/会话，不复制完整日志。其他App的Run不进入当前TaskRail，但继续在Backend执行并通过Host summary更新Launcher角标；切回该App后再加载其RunSummary/TaskRail。点击task/delegation打开TaskDetailDrawer，不替换Conversation route、不销毁Composer，也不改变threadId；详情drawer有自己的分页cursor和AbortController，关闭即释放日志/Artifact/Subagent重型数据。用户提交输入时`appendInput`先乐观显示pending bubble并等待服务端sequence回填；HTTP接受成功即可继续打字，不等待模型响应。Run处于running/awaiting_approval/awaiting_budget时Composer保持可写，只有会话删除、App disabled、登出或明确只读状态才disabled。

### 8.3 持久偏好、授权、焦点

localStorage key=nexus.agent.surface.v1.user.<userId>；数据schema={schemaVersion:1,bounds,maximized,launcherPosition,recentAppIds}，8KiB上限，未知字段丢弃，NaN/超视口bounds修正。刷新仅恢复appIds/布局，最近会话通过threads?limit=1按updatedAt获取；不保存thread/run/private draft。保存latest-value-wins，flush布局在页面隐藏/卸载，不发送运行数据。

run.store只在durable message.final提交消息，delta是临时draft（streamId+chunkIndex）；reconnect清旧draft后snapshot/catchup，不能把半段文本当final。snapshot与detail列表分页游标独立。未知schema显示不兼容，不悄悄显示完整。审批按钮服务端expiry为准，用server clock offset显示倒计时，提交期间disabled，409刷新卡片；不能前端自行把requested改approved。

长会话实现不得按Thread全量加载。`conversation.service.readPage`使用稳定cursor/sequence向前分页，前端默认只保留当前视口附近窗口和有限page cache（具体窗口大小由实现基准确定，不写死产品协议）；向上加载旧消息前记录首个可见messageId+offset，prepend后恢复anchor。VirtualConversationList只mount可见行及overscan，消息高度用ResizeObserver校正；滚动不在底部时新消息只增加“新消息”提示，不强制跳底。离屏页可LRU释放，回滚时从服务器重取。

stream delta不得每token触发Vue深响应/Markdown全量解析：sse handler按streamId写轻量buffer，最多每animation frame一次提交可见文本；Markdown、syntax highlight、Artifact preview只在message.final或用户显式展开时执行。TaskRail使用`RunSummary/PlanProjection` map按runId/stepId事件patch，禁止computed遍历全部ledger重算。TaskDetailDrawer关闭后abort自己的请求/分页/日志订阅；Conversation当前Run SSE仍保持。性能E2E需构造至少万级ledger entries/长stream/大量历史task，断言首屏只分页请求、DOM行数有界、持续stream时Composer可输入/滚动可响应、prepend无明显跳动，并记录浏览器长任务/heap增长基线；具体阈值在P1-D实现时结合真实浏览器和E2E机器冻结。

模态presence仅影响交互/焦点，不取消任务；键盘只由当前focus owner处理，Agent不接管全局Ctrl组合或浏览器后退。原RDP modal/外观确认在Agent上方；原生全屏不退出。logout触发onSessionLost→Abort全部SSE/request、清private store/draft/tickets、卸载iframe、关闭MessagePort和Hub；保留layout不含敏感数据，其他Workspace的清理由既有auth流程负责。

<a id="i9"></a>
## 9. EnvironmentController、部署与多环境控制（Phase 2）

### 9.0 Docker 扩展用途、服务角色与持续管理

Docker 扩展实现采用**一个 `nexus-agent-runner` 服务 + 单一 Base Runner image + 可安装 Environment Pack**。不再为 Node/Python/Chromium 每个版本构建独立 worker image。Runner 服务内部包含 Controller、Catalog、Pack installer、Toolchain Store、Gateway/job protocol、cleanup/reconcile、quota 和空间统计；真正的工作容器由 Runner 通过固定 Base Runner image 按需创建并挂载精确 Pack。

当前仓库 compose 是 `frontend + backend + guacd`；P2 只新增 `nexus-agent-runner`，不把 frontend/backend 合并作为本任务前提。Runner 采用可选 compose profile，未启用时 Core/SSH/RDP 保持正常且 Environment availability 明确 unavailable。

Frontend 不实现一次性 Setup Wizard，而由长期存在的 `EnvironmentSettings.vue` 承载 Environment Manager。页面状态机至少为 `unavailable | uninitialized | ready | degraded`，安装/卸载/cleanup 等操作再叠加 command 状态。`uninitialized` 时在同一页面执行：`GET availability/catalog/storage` → 选择 Recipe 与 family 多版本 → `setup/preview` → 用户确认 → Runner 安装缺失 Pack → health/readiness → Settings CAS；初始化失败不写“已成功安装”配置，已成功安装的独立 Pack 可保留供重试。`ready/degraded` 时仍从同一入口管理 Catalog、Pack 多版本、默认版本、资源/网络、storage、运行 Environment、cleanup/restore 和诊断；用户无需重新进入特殊初始化流程。

| 场景 | Recipe / Pack | 输出 |
| --- | --- | --- |
| CLI/文本/Git/归档 | shell + git/archive/text | stdout摘要、patch、Artifact |
| 项目构建/测试 | code + node/python/jdk/go 精确版本 | test/build/patch Artifact |
| 数据分析 | data + python/sqlite/data-tools | 统计/查询/报告 Artifact |
| 浏览器验证（三期） | browser + chromium/browser-tools | DOM证据、截图、下载 Artifact |

### 9.1 Runner 数据布局、Catalog 与多版本 Pack

`packages/agent-runtime/` 为独立 Node 包；Controller 文件至少包括 `environment-catalog.ts`、`pack-installer.ts`、`toolchain-store.ts`、`space-reporter.ts`、`cleanup-planner.ts`、`reconciler.ts`、`journal.ts`、`engine-client.ts`、`quota-manager.ts`、`certificate-manager.ts`。worker 只保留通用 `gateway.ts/job-runner.ts/artifact-client.ts/bootstrap.ts`。

`scripts/docker/agent-runtime/Dockerfile` 只构建 `controller` 与 `runner` target。Base Runner 按 Nexus 发行版本+arch 发布 immutable digest。Catalog 源码位于 `scripts/docker/agent-runtime/catalog/`；Environment Pack 作为带 manifest/checksum 的 release/OCI artifact 发布，不使用 mutable latest tag 作为版本事实。

Runner 内部路径契约：

~~~text
/var/lib/nexus-agent-runner/state/       durable, small
/var/lib/nexus-agent-runner/packs/       durable installed immutable packs
/var/lib/nexus-agent-runner/cache/       reclaimable downloads/staging/extract
/var/lib/nexus-agent-runner/runtime/     reclaimable environment/run owned data
/var/lib/nexus-agent-runner/quarantine/  unresolved ownership/side-effect data
/run/nexus-agent-runner/                 tmpfs sockets/secrets/tickets
~~~

实现允许宿主用 bind mount 或明确命名 volume 提供上述类目，但**不得把 packs/cache/runtime/quarantine 合并成不可区分的匿名 volume**。若使用单一宿主根目录，Runner 必须按以上子目录独立计量和 cleanup；若拆 volume，也必须维持相同逻辑分类。Controller 的 engine-client 只能从部署时注入并校验过的 Docker-visible mount sources 生成挂载，不能把 Runner 容器内 `/var/lib/...` 字符串直接当宿主路径，也不能接受 Frontend/模型/普通HTTP传 hostPath；named volume 与 bind root 的具体组合留部署实现决定。所有动态 Docker resource 带 `nexus.agent.owner=true`、environmentId、runId、generation、kind label，不能依赖模糊名称清理。

~~~ts
type PackRef = { familyId:string; versionId:string; contentDigest:string };
type CatalogPack = {
 schemaVersion:1; familyId:string; versionId:string; displayName:string;
 contentDigestByArch:Record<string,string>; downloadRefByArch:Record<string,string>;
 capabilities:string[]; runnerApiRange:string; diskBytes:number;
 dependencies:{familyId:string;versionId:string}[]; supportedArchitectures:string[];
 status:'supported'|'deprecated'|'unavailable'; sideBySide:boolean;
};
type EnvironmentRecipe = {
 id:string; revision:string; allowedFamilies:string[]; requiredCapabilities:string[];
 defaultFamilies:string[]; defaultLimits:ResourceLimits;
 networkDefaults:{mode:'none'|'allowlist';hosts:string[]};
};
type EnvironmentPackSettings = {
 enabledRecipes:string[];
 families:Record<string,{enabledVersionIds:string[];defaultVersionId:string}>;
};
~~~

同 family 多版本可同时 installed/enabled/inUse。默认 Environment 每个 family 选一个 activeVersion；`sideBySide=true` 才允许同一 Environment 挂多个版本到不同目录。Pack install key=`familyId/versionId/contentDigest/arch`；同 key 幂等，versionId 相同但 digest 不同视 Catalog 冲突，不原地覆盖。

Environment 冻结 `base_runner_digest + recipe_id + recipe_revision + catalog_revision + pack_refs_json`；正式 SQLite 字段已经统一定义在 §4.2 的 `agent_environments` DDL，本节不再维护第二份 SQL 片段。Controller state 记录 Pack install 状态 `available/installing/installed/uninstalling/failed`、digest、bytes、installedAt、lastVerifiedAt；大 Pack 文件不进入 Nexus SQLite。

### 9.2 API、安装/卸载与 Environment 创建

Frontend/Backend API（前缀 `/api/v1`）：

| 路由 | 作用 |
| --- | --- |
| `GET /agent/environments/availability` | Runner/engine能力与原因 |
| `GET /agent/environments/catalog` | Recipe、Pack、available/enabled/installed/inUse/deprecated 状态 |
| `GET /agent/environments/storage` | packs/cache/runtime/quarantine/engine 使用量与可回收量 |
| `POST /agent/environments/setup/preview` | 选择 Recipe/版本后的下载/空间/资源影响 |
| `POST /agent/environments/setup/confirm` | confirmationId+expectedVersion，安装 Pack 并保存设置 |
| `POST /agent/environments/packs/:familyId/:versionId/install` | 安装/预拉取指定启用版本，幂等 |
| `POST /agent/environments/packs/:familyId/:versionId/uninstall/preview` | 引用/默认版本/可释放空间影响 |
| `POST /agent/environments/packs/:familyId/:versionId/uninstall/confirm` | 停止引用已处理后卸载精确 Pack |
| `POST /agent/environments/runtime-cleanup/preview` | 将停止/删除的运行资源、active影响、预计释放空间 |
| `POST /agent/environments/runtime-cleanup/confirm` | 一键清运行残余，可能 PARTIAL_RESTORE |
| `POST /agent/environments/cache-cleanup` | 清安全可重建 cache |
| `POST /agent/environments/settings/reset/preview|confirm` | 恢复 Docker 扩展默认配置 |
| `GET /agent/environments/commands/:commandId` | 查询setup/install/uninstall/cleanup长命令的持久状态、阶段/进度和最终结果；断线后继续查询同commandId |

Environment 创建接口接受 `recipeId` 与可选 `versions:{familyId:versionId}`；省略的 family 使用 Settings defaultVersion。Backend 从 Catalog 解析成精确 PackRef 并冻结，Runner 再次验证这些 Pack 已安装/可安装且 digest 匹配。策略可配置 `installOnDemand=true`：新 Run 请求 enabled 但未 installed 的版本时先进入 preparing，安装成功再创建 Environment；安装失败返回 `ENVIRONMENT_PACK_UNAVAILABLE`，不静默换默认版本。历史Run/resume按冻结的 `familyId+versionId+contentDigest` 请求精确重装，不能只按versionId解析成当前Catalog的另一份bytes。

~~~ts
type EnvironmentCommand = {
 commandId:string; deploymentId:string; userId:number; appId:string; runId:string;
 agentRuntimeId:string; groupId:string; environmentId:string; generation:number;
 action:'provision'|'start'|'stop'|'delete'|'setNetwork'|'resize';
 recipeId:string; recipeRevision:string; baseRunnerDigest:string; catalogRevision:string;
 packs:PackRef[]; limits:ResourceLimits; network:{mode:'none'|'allowlist';hosts:string[]};
 expectedVersion:number; operationHash:string; issuedAt:number; deadlineAt:number; nonce:string;
};
~~~

Runner internal API 额外提供 install/uninstall/storage/cleanup commands，所有命令先写 controller journal 后执行，commandId+payloadHash 幂等；Backend/Frontend通过统一command查询读取持久状态，不靠页面内存判断完成。Pack installer：下载到 `cache/download/<commandId>` → stream checksum/digest → 验 manifest/arch/runnerApiRange/dependencies及基础归档安全 → 在 `packs/.staging/<commandId>` 解包/fsync/设只读 → 同一 `packs` 文件系统原子 rename 到 `packs/<family>/<version>/<digest>` → inventory installed。这样即使cache与packs是不同volume也不依赖跨文件系统rename；失败可重试，download/staging由cleanup planner按ownership清理。

### 9.3 运行挂载、资源与空间治理

Base Runner rootfs read-only、cap-drop ALL、no-new-privileges、非root、seccomp/AppArmor。Environment 只挂载请求中的 Pack 路径为 read-only；每个版本路径独立。工作数据使用 `runtime/environments/<environmentId>/<generation>/`，至少分 `work/ deps/ build/ browser/ jobs/ tmp/`，所有目录有 owner metadata/label。用户代码不能写 `packs/`、`state/` 或其他 Environment 的 runtime。

Pack 安装下载由 Runner 完成，不把 registry credential 给工作容器。项目 npm/pip 等依赖进入该 Environment 的 `runtime/.../deps`，而不是 Pack；因此“清运行残余”会删 node_modules/venv 等项目状态，“卸载 Node 22 Pack”只删系统 toolchain。工作容器网络默认 none；出站仍走 egress policy/approval。

空间报告：

~~~ts
type RunnerStorageView = {
 stateBytes:number; packBytes:number; cacheBytes:number; runtimeBytes:number;
 quarantineBytes:number; engineOverheadBytes:number; reclaimableBytes:number;
 byPack:{familyId:string;versionId:string;bytes:number;inUse:boolean}[];
 byEnvironment:{environmentId:string;runtimeBytes:number;status:string}[];
 filesystem:{totalBytes:number;freeBytes:number};
};
~~~

`engineOverheadBytes` 通过 Docker engine inventory 统计尚未归入 state/packs/cache/runtime/quarantine 的 Base Runner image、Agent-owned container writable layer/metadata等额外占用，Agent-owned volume若其数据已经计入runtime等类别不得重复计算。UI 固定显示六类用量并提供“清 cache / 清运行残余 / 卸载版本”，不提供一个无法解释会删什么的总清理按钮。

Hard Limits 增加 `maxInstalledPackBytes`、`maxRunnerCacheBytes`、`maxRunnerRuntimeBytes` 等可配置策略值；提高走 Agent Settings 的二次确认。达到 cache limit 可优先回收未引用 cache；达到 runtime limit 不删 quarantine/active 数据，拒绝新的大写入并提示清理；Pack limit 达到时提示卸载未使用版本，不自动删除 enabled Pack。

### 9.4 Cleanup planner、卸载与恢复

`cleanup-planner.ts` 是 startup reconcile、产品一键还原和 E2E reset 的共用核心，但 scope 不同。产品“清除运行残余”流程：freeze new env/jobs → inventory → stop/cancel → reconcile unknown → delete Agent-owned containers/networks/volumes → remove owned `runtime/` trees → revoke `/run` secrets/tickets → release quota → compact terminal journal → second inventory。任何未知 mutation/ownership 进入 `quarantine/` 并返回 `PARTIAL_RESTORE`；不能为了释放空间删除未知副作用证据。

Pack uninstall 与 runtime cleanup 完全分开。卸载前检查 active mounts；有 active Environment 时 409 `ENVIRONMENT_PACK_IN_USE` 并返回引用列表。若是 default/enabled version，preview 要求在同一次确认中选择 replacement default 或禁用。卸载后历史 Run 仍保留 PackRef；需要 resume 时按原 digest 重新安装，Catalog/source 不可取得则明确 `ENVIRONMENT_PACK_UNAVAILABLE`。

`cache/` 无引用内容可独立清理；`state/` 只做 journal compaction；`quarantine/` 只能通过 reconcile/用户确认释放；`packs/` 只由安装/卸载动作修改；`runtime/` 是一键还原的主要清理对象。这个目录边界必须进入 E2E：创建多个版本并发 Environment → 产生 node_modules/venv/build/browser残余 → cleanup 后 runtimeBytes 接近零且 Pack 仍 installed → 卸载 Node20 只减少对应 packBytes，Node22 仍可启动 → Runner 重启后 journal/inventory 能继续 reconcile → 未知 mutation 留 quarantine 且 UI 显示占用。

Runner shutdown 只 quiesce job/Environment 并持久化 journal，不删除 Pack；Nexus 备份默认不包含 Runner Packs/runtime/cache，只保存 Nexus DB 中 Settings 与 PackRef/Run事实。恢复后 Runner 按 Settings/Catalog 检查所需 Pack，缺失版本显示“未安装/可重新安装”，不伪装环境已经存在。


<a id="i10"></a>
## 10. Subagent、多模型、通信与扩展（Phase 3）

### 10.1 配置与创建契约

~~~ts
type SubagentPolicy = {
 maxDelegationDepth: number;
 maxMessagesPerRun: number; maxMessageBytesPerRun: number;
 profiles: SubagentProfile[];
};
type SubagentProfile = {
 id: string; role: string; defaultModel: ModelRef | null; allowedModels: ModelRef[];
 capabilities: string[]; peerMessaging: 'parent-child' | 'same-run';
 maxTokens: number; maxSteps: number; failureMode: 'isolate' | 'failFast';
};
type SubagentRequest = {
 profileId: string; objective: string; constraints: string[]; inputArtifactRefs: string[];
 maxTokens: number; maxSteps: number; deadlineAt: number; completionCriteria: string[];
 dependsOn: string[]; dependencyMode: 'success' | 'settled'; command: CommandIdentity;
};
type AgentMessage = {
 id: string; runId: string; senderRuntimeId: string; recipientRuntimeId: string;
 delegationId: string; recipientSequence: number; kind: 'request'|'reply'|'progress'|'evidence'|'completion';
 correlationId: string; replyTo: string|null; causationId: string|null; taskRevision: number;
 body: JsonValue; artifactRefs: string[]; createdAt: number; expiresAt: number;
};
interface MailboxPort {
 send(ctx: ToolContext, input: Omit<AgentMessage,'id'|'runId'|'senderRuntimeId'|'recipientSequence'|'createdAt'>,
      command: CommandIdentity): Promise<{messageId:string;recipientSequence:number}>;
 read(ctx: ToolContext, after: number, limit: number): Promise<AgentMessage[]>;
 consume(ctx: ToolContext, through: number, expectedVersion: number): Promise<void>;
 expire(now: number): Promise<number>;
}
~~~

SubagentProfile保存在AppStorage key=subagent.profiles.v1，Settings里保存delegation深度和通用Runtime/预算上限；Run.definition_json冻结effectivePolicy与每角色modelAssignments。user create API可覆盖profile模型但必须属于其allowedModels；Agent tool输入只选profileId，不直接传model endpoint。profile和模型删除不改历史Run快照，新Run验证可用性；配置缺失才继承root模型并记录resolvedFrom='root'。

createSubagent事务：校验parent scope/active Run/profile→检查深度/依赖/loop guard→先为`kind='delegation'`消耗一个Run step并检查软预算→计算effective token/steps=min(request,profile,parent剩余)→预留预算→insert新的participant/AgentRuntime（独立modelRef）+delegation+work item→append subagent.created→COMMIT后唤醒。同key重试返回原delegation。已完成/失败/取消的Subagent不形成创建配额；未消耗的Token预留可退。若Run的token/step/active-time/cost或该delegation分配的token/step软预算不足，不把child直接标failed：先park相关child并让Run进入`awaiting_budget`，budget request注明scope=run或delegation；用户可增加本次Run/该Subagent预算或取消该child。Hard Limit只由当前Agent Settings校验，数据库不写死深度/预算最大值。

budget reservation分两级：delegation是父余额的分区，model attempt从所在分区预留；记账不把child reserve与attempt reserve重复扣父两次。settle用量一次性归Run总账/child账，maxRunTokens跨所有模型。父创建新child前可缩回未消费预算，但不能拿走已进行attempt预留；失败清理只退unused并保留usage。独立model contextWindow/tools/价格分别判断。

### 10.2 文件、API和调度函数

| 文件（Backend modules/agent/） | 函数 / 参数与结果 |
| --- | --- |
| runtime/subagent.types.ts | §10 DTO、SubagentStatus、ScheduleState、MessageReceipt |
| runtime/subagent.service.ts | create(ctx,request):Promise<DelegationView>；cancel(scope,runId,id,version)；join(ctx,ids,mode:'all'|'any',deadlineAt):Promise<JoinResult> |
| runtime/mailbox.port.ts | §10.1 MailboxPort；不导出全局EventEmitter |
| runtime/subagent-policy.ts | resolvePolicy(settings,app,run):EffectivePolicy；validateModel(profile,ref)：仅授权模型；authorizePeer(sender,recipient,kind) |
| runtime/scheduler.ts | enqueue(work)、claimNext(generation)、releasePermit(workId)、park(workId,reason)、wake(runtimeId,cause)、cancelTree(runtimeId) |
| runtime/dependency-graph.ts | validateDependencies(runId,edges)：同Run/无环；addWaitEdge(from,to)：拒绝环；ready(delegationId)：前置终态 |
| runtime/mailbox.service.ts | send/read/consume/expire；验schema、owner、revision、quota，再调用StateCommitPort |
| environments/shared-facts.port.ts | get/compareAndSet；实际state commit附加fact patch和版本期望 |
| runtime/subagent-result.ts | summarize(result,maxBytes=8192)：保留evidence/failure/usage，不复制原始context |
| Infrastructure agent/repositories/sqlite-subagent.repository.ts | 提供delegation/mailbox/scheduler SQL，使用同一DatabaseAdapter |
| Interfaces http/agent/subagent.controller.ts | 仅scope/DTO/command映射，调用上述facade |

API：
- GET/PATCH /api/v1/apps/:appId/subagent-settings：{policy,profiles,version}；PATCH expectedVersion与完整白名单配置，maxDelegationDepth=0禁用派生，仅影响新Run。
- GET /api/v1/agent/ai/models：已启用Provider安全模型列表（能力/窗口/价格状态，无credential）。
- POST /api/v1/apps/:appId/runs/:runId/subagents：SubagentRequest去command并加parentRuntimeId，Idempotency-Key必填；201 DelegationView。
- GET 同路径：按parent/createdAt分页，返回model/status/budget/usage/children/evidence，不返回私有prompt。
- POST .../subagents/:id/cancel：{expectedVersion}，202；single取消递归其后代，不取消siblings。
- GET .../subagents/:id/messages：授权用户可查看显式交换的message ledger，页50/max100，私有模型context不在此API。
- Agent的send/join通过SDK的scope-bound subagents/messages ports，不让模型访问任意HTTP地址。

error：SUBAGENT_DEPTH_EXCEEDED、SUBAGENT_MODEL_FORBIDDEN、DELEGATION_WAIT_CYCLE、DEPENDENCY_FAILED、MAILBOX_FULL、MESSAGE_TOO_LARGE、MESSAGE_STALE、FACT_VERSION_CONFLICT均409（配置非法400，越权403）。Runtime/model并发不足不是创建失败，返回queued；Run/delegation/mailbox累计软预算或其Hard Limit不足都转awaiting_budget（Hard Limit时canIncrease=false），只有单条/信封/pending等固定协议容量、安全限制或有界scheduler队列耗尽才拒绝新工作。

### 10.3 Mailbox语义、消费与Token边界

send唯一键=(runId,senderRuntimeId,recipientRuntimeId,idempotencyKey)，payload hash含kind/body/refs/replyTo/revision/TTL；同key不同hash409，同payload返原receipt。sender从SDK绑定，不信输入；recipient/sender/Artifact/grant必须同Run或已明确授予此Run使用。completion是公开结果提交通知，不等于tool成功/Run成功。

事务内分配每recipient nextSequence；pending≤64、body≤16KiB/envelope≤64KiB是固定协议容量，超过直接409；Run累计消息默认软预算1000条/2MiB、默认Hard Limit 5000条/8MiB并由Agent Settings管理。下一次send会越过累计软预算时不插入消息，而是把Run置`awaiting_budget`并写scope=mailbox的budget request；达到当前Hard Limit则canIncrease=false，用户提高Hard Limit后仍需显式增加本Run消息预算。成功reserve后再插入mailbox和subagent.message_accepted事件并enqueue consume_inbox（已有相同work则合并wake）。DB事务后内存通知可丢，不影响重启扫描。

read按recipient sequence返回at-least-once，默认一次8条/总8KiB进入Context，优先处理deadline近的request但consume水位只能连续前进；暂不消费的较早条目不能被后续ack跳过。消费事务将选中消息标consumed、更新contiguous cursor并创建下一step的input refs；re-delivery通过messageId去重。对过期/stale/非法body记rejected/expired也计入可前进水位，不交模型执行。delivered/consumed只表达本地记录，不承诺网络副作用exactly-once。

progress同correlation可在Context视图合并最新一条，但原ledger不改写；final completion只传max8KiB结果+ArtifactRefs。body不准携带凭据、执行handle或伪造user/system role。message和fact不自动授权工具。用户cancel、审批决议、lease续约走独立控制路径，即使message quota满也能执行并记录有界终态event。

### 10.4 持久调度与死锁约束

runtime status仍用§2，新增schedule_state区分queued/runnable/executing/waiting_message/waiting_approval/waiting_budget/joining/finished。执行permit只在model/tool工作执行时持有，等待join/审批/预算/消息释放；“活跃runtime上限”在调度中指executing数，不是所有持久化runtime记录数。

claimNext算法：control path先处理取消/到期→按App轮转，再Run轮转→从ready且deps满足队列按root:child权重2:1/FIFO取一项；等待≥10秒项提高优先级一次→检查run/app/generation/deadline→一次事务CAS queued→claimed并预留全部执行/Provider配额→事务外执行→commit结果和释放permit。若资源不齐不占部分permit；lease在即将执行tool时短事务获取，冲突重新排队，不能持lease等model/join。

only-one active scheduler perBackend进程，deployment副本数1；工作记录owner_epoch=generation，startup将旧claimed work标waiting/reconciliation，不自动重放tool。consume_inbox/control无模型调用可在固定控制队列运行，不挤占model permit；每轮处理最多64条，防单Run淹没其他App。

依赖DAG默认只引用已存在且同Run delegation；invalid/self/cycle拒绝；success依赖失败则DEPENDENCY_FAILED，settled允许继续收集失败证据。join('all')收到所有终态才返回，join('any')返回第一个终态并列出其余running，调用方显式cancelRemaining。join timeout返回结构化超时、不伪造child失败。加入等待边前DFS检测环；child不允许join祖先，parent joining收到child request唤醒parent处理邮箱，处理完重新join。failFast表示一个child失败后取消同一parent尚未完成的其他children并唤醒parent汇总；不直接替parent把Run标failed/completed。未知mutation仍走quarantine，parent只有确认副作用边界后才按§2终结Run。

### 10.5 Phase 3增量DDL

~~~sql
ALTER TABLE agent_runtimes ADD COLUMN schedule_state TEXT NOT NULL DEFAULT 'queued'
 CHECK(schedule_state IN ('queued','runnable','executing','waiting_message','waiting_approval','waiting_budget','joining','finished'));
ALTER TABLE agent_runtimes ADD COLUMN consumed_mailbox_sequence INTEGER NOT NULL DEFAULT 0;
CREATE TABLE agent_mailbox_cursors (
 recipient_runtime_id TEXT PRIMARY KEY REFERENCES agent_runtimes(id),
 next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence>=1)
);
CREATE TABLE agent_messages (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id),
 sender_runtime_id TEXT NOT NULL, recipient_runtime_id TEXT NOT NULL, delegation_id TEXT NOT NULL REFERENCES agent_delegations(id),
 recipient_sequence INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('request','reply','progress','evidence','completion')),
 idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, correlation_id TEXT NOT NULL,
 reply_to TEXT REFERENCES agent_messages(id), causation_id TEXT REFERENCES agent_messages(id),
 task_revision INTEGER NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json)),
 artifact_refs_json TEXT NOT NULL CHECK(json_valid(artifact_refs_json)), size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
 status TEXT NOT NULL CHECK(status IN ('accepted','delivered','consumed','expired','rejected')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER,
 UNIQUE(recipient_runtime_id,recipient_sequence), UNIQUE(run_id,sender_runtime_id,recipient_runtime_id,idempotency_key),
 FOREIGN KEY(sender_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id),
 FOREIGN KEY(recipient_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id)
);
CREATE INDEX agent_messages_pending ON agent_messages(recipient_runtime_id,status,recipient_sequence);
CREATE TABLE agent_scheduler_work (
 enqueue_sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 run_id TEXT NOT NULL, agent_runtime_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('model_step','tool_step','consume_inbox','verify','join_resume')),
 status TEXT NOT NULL CHECK(status IN ('queued','claimed','waiting','completed','cancelled')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), owner_epoch INTEGER,
 not_before INTEGER NOT NULL, deadline_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(agent_runtime_id,run_id) REFERENCES agent_runtimes(id,run_id)
);
CREATE INDEX agent_work_ready ON agent_scheduler_work(status,not_before,enqueue_sequence);
CREATE TABLE agent_delegation_edges (
 run_id TEXT NOT NULL REFERENCES agent_runs(id), delegation_id TEXT NOT NULL REFERENCES agent_delegations(id),
 depends_on_id TEXT NOT NULL REFERENCES agent_delegations(id),
 mode TEXT NOT NULL CHECK(mode IN ('success','settled')), PRIMARY KEY(delegation_id,depends_on_id),
 CHECK(delegation_id<>depends_on_id)
);
~~~

repository验证delegation/reply/causation/edge同Run的非FK组合约束，不能直接相信UI关联id。Run delete先清edges/messages/work/cursors/delegations再删runtime，保留父Run引用保护。Inbox/Tokens使用量放Run.usage_json中的独立计数，通过version CAS防并发超配；Message body不能混入Host summary。

### 10.6 前端与验收

Frontend features/agent/settings/SubagentSettings.vue显示delegation深度、每profile模型与软预算，并复用Nexus Settings中的AgentSettingsPanel统一分区；runtime/SubagentTree.vue、SubagentCard.vue、MessageExchangePanel.vue展示公开协作消息、排队原因、model、usage、budget和单独cancel；api/subagent-api.ts仅调用上列API，store合并subagent.created/status_changed/message_accepted/completed事件且按eventId去重。

E2E delegation.spec.ts：多个不同模型profile按统一Runtime slot并发/排队；完成多个Subagent后仍可顺序创建新的；历史数量不构成限制；深度/依赖环拒绝；重复无进展delegation触发loop guard；Run软预算不足进入awaiting_budget且用户增加本Run预算后继续；join释放slot且单slot也能完成；parent cancel递归；single child cancel不杀siblings；mutation未知保留quarantine；修改配置不改旧Run模型快照。
E2E agent-messages.spec.ts：同key重复/冲突、同Run授权、跨App/Run伪造sender拒绝、断线重复交付只消费一次、mailbox满背压、过期request唤醒、stale taskRevision不驱动新动作、父join时child提问可处理、跨模型只交换摘要/Artifact、不泄露secret/context；断言来自产品API/UI。

### 10.7 MCP/ACP/CDP与安装式插件

协议adapter统一位于Infrastructure agent/integrations，纯配置/ports在ai/integrations.types.ts；transport版本由发布lockfile与manifest.protocolVersion固定，不在运行时接受任意协议“兼容”字符串。握手拒绝不支持major，minor允许已声明可选字段，capability刷新提升schema hash使旧inspection过期。

McpAdapter.connect(config,signal)、listTools(connection)、invoke(connection,tool,args,signal)、close()：只管理用户登记的server；返回namespaced descriptor交ToolCatalog和Policy。未知annotation按mutation，远端不能替本地批准。AcpAdapter.execute(input,ctx)实现AgentBackendPort；permission事件映射ToolInspection，本地工具执行结果回传。不能拦截自主机器调用的backend只启用离线profile，无生产网络/磁盘。

BrowserGateway.createSession(environmentId)、navigate(session,url)、snapshot(session,{maxNodes:2000,maxBytes:65536})、click/type(session,nodeRef)、download(session,ref)、close()；nodeRef与snapshotId/generation绑定，失效返回BROWSER_NODE_STALE，不能偷偷改用CSS。默认无evaluate，用户若开启需单独capability/审批。Browser下载→Artifact→code读取的产品E2E验证数据协作，不检查fake server内部文件。

安装式App模块host/plugin-install.service.ts提供stage(uploadRef)、verify(stageId)、install(stageId)、upgrade(appId,version,expectedVersion)、uninstall(appId,{deleteData:false})；package-verifier.port.ts由Infrastructure验证签名/hash/路径/限额。隔离UI bridge在Frontend host/app-bridge.ts，MessageChannel、nonce、source、timeout/seq/size检查；独立plugin-ui镜像不带Nexus session/Backend代理。Backend插件代码必须运行在独立受限执行单元并只经scope-bound SDK/RPC访问宿主，绝不允许Backend内eval/import；具体采用Runner容器还是其他隔离进程、IPC与重启协议在P3-C开工时结合当时部署能力冻结并补E2E，不在当前设计提前锁死。

<a id="i11"></a>
## 11. 验收、发布与任务完成标准

本轮只提交设计。下列spec是未来实现任务的验收归属，不表示文件已经存在或测试已经执行。当前不创建业务代码、E2E文件、软件需求或Docker资源。实现阶段所有行为测试遵循EC-E2E-001/002/003，静态设计SQL校验不替代产品E2E。

| 验收组 | 产品操作与必须观察的结果 | 归属 |
| --- | --- | --- |
| Host/Manifest | 无模型仍可开Nexus；Operations引导；enabled/grants重启保留；另一个App注册不改Operations；dist manifest存在 | P1-A host.spec.ts |
| Provider/秘密 | 用户配置Provider、test成功/失败、401不重试、私网拒绝/显式例外、DNS更换/redirect拒绝；API无secret | P1-B provider.spec.ts |
| Ledger/Run | 创建/追加输入/同thread重复活跃Run冲突；刷新恢复原文/最终结果；换App查别App对象404 | P1-C runs.spec.ts |
| Event/SSE | 生产ingress连续输出>15秒；snapshot→catchup并发提交不漏；重复fact只应用一次；delta断线不伪final | P1-C events.spec.ts |
| UI | Launcher单击/键盘恢复最后App、拖动不误打开；AppSwitcher仅在Hub页面内切换。App A运行中切到B后A继续推进且B不显示A的TaskRail，切回A通过snapshot+catchup恢复最新状态且不重复任务；关闭/最小化不cancel；移动sheet/键盘、RDP焦点、登出清理 | P1-D hub.spec.ts |
| Nexus Settings / Agent | 现有Settings增加Agent tab且保持当前视觉/键盘基调；总开关/App启停语义分离；Hard Limit提高必须二次确认；feature关闭隐藏Launcher、拒绝新执行但数据保留，重新开启不自动resume | P1-D settings.spec.ts |
| 审批与Hash | 相同操作hash稳定、args顺序/目标版本变化失效、同审批并发批准仅一次consume、黑名单拒绝不可被批准覆盖 | P2-A approvals.spec.ts |
| Lease与未知副作用 | 两个读可并行、写被读/写阻塞；Workspace typed mutation共用资源key；SSH断线结果未知→quarantine，不重复执行 | P2-A leases.spec.ts |
| Artifact / 文件库 | 上传大小/流中断/磁盘满、ready前崩溃、rename后DB失败、range/跨App/retain/GC/restore缺payload；用户级文件库分页/预览/回来源/跨App显式attach/清理preview保护引用，万级metadata不全量挂DOM | P1-B artifacts.spec.ts；P1-D artifact-library.spec.ts；P2-C recovery.spec.ts |
| Environment | 无Docker降级；错证书/nonce/generation/超配拒绝；工作容器无socket、跨环境网络/目录不可达；stop保留Artifact、delete正确范围 | P2-B environment-isolation.spec.ts |
| 生命周期 / 功能开关 | Agent总开关关闭后立即拒绝新执行、隐藏Launcher但Settings/安全cleanup/审计仍可用且历史数据保留；进行中Run按quiesce/cancel/reconcile安全收敛，未知mutation不伪cancel；重新开启不自动resume旧Run。Run中reset排空或明确失败；旧generation回调不能写新库；shutdown不被SSE挂住；Controller重启按commandId对账 | P1-D lifecycle.spec.ts；P2-B environments.spec.ts |
| 协议扩展 | MCP schema更新审批失效、ACP禁止自主生产副作用、CDP nodeRef过期、网页内容不升级权限、浏览器下载→code Artifact链 | P3-A mcp/acp/browser.spec.ts |
| Subagent多模型 | 每子独立模型、统一Runtime并发、delegation深度、顺序创建不限历史数量、父budget计费不重复扣预留、配置快照、不支持模型拒绝 | P3-B delegation.spec.ts |
| 通信/调度 | Mailbox重复/乱序恢复/TTL/背压、跨Run拒绝、join释放slot、等待图防环、parent request唤醒、递归取消、failFast/隔离模式 | P3-B agent-messages.spec.ts |
| 插件/Memory | 签名/路径炸弹拒绝、升级失败恢复AppStorage、iframe不能访问Nexus cookie、bridge错source/nonce拒绝、Memory只经用户发布生效 | P3-C plugins.spec.ts、P3-B memory.spec.ts |

产品E2E fixture放test/e2e/fixtures/agent/，用于模拟Provider/MCP/ACP的延迟、错误、截断等下游条件；不要读取fixture内部计数/日志作为唯一断言，调用次数/重复副作用通过Nexus事件与真实产品目标结果验证。不能为了断言加test-only DOM属性；使用真实accessible role/name。每spec独立reset，CI组清单唯一分配，新增/删除spec同步groups generator。截图通过现有captureFunctionalScreenshot在业务checkpoint声明，不新增历史截图manifest。

发布与验证命令沿用工程约束，不随文档复制出第二套规则：
- npm run format / npm run format:check（只处理本任务文件，避免格式化用户其他dirty文件）。
- npm run check:test-policy；npm run build:backend；npm run build:frontend。
- npm --prefix packages/backend run check:architecture；npm --prefix packages/frontend run check:architecture。
- npm --prefix test/e2e exec playwright test tests/agent/<本任务spec>；环境/参数沿用现有E2E配置，不能把本地缺浏览器当通过。
- npm run test:e2e:groups:check；正式完整浏览器证据在既有GitHub Actions固定runner生成。
- 部署smoke经生产dist/Compose/Nginx真实入口；二期另验证nexus-agent-runner/Base Runner各架构digest、Pack manifest与Recipe权限。
- git diff --check。

质量基准与功能E2E分开解释：固定至少10个任务（诊断、有限日志摘要、文件修改/外部变更冲突、服务重启核验、失败恢复、二期环境协作、三期Browser/Subagent），冻结输入、允许动作、成功证据及最大预算。使用真实模型的同任务对比记录verified成功率、总input/output/cache Tokens、重试、wall time、未知结果率；模型/提示/Skill版本均记录。安全硬门槛是越权/泄密/重复mutation为0；节省Token的变更不得降低已验证成功任务数，绝不只以少花Token通过。没有真实模型凭据只执行产品契约E2E，不伪造模型质量数据。

这些是未来实施的验收任务。本轮文档验证单独记录实际执行了什么：DDL在内存SQLite解析/外键设计检查、固定canonical hash向量、交叉引用/阶段/文件范围检查；不运行不存在的Agent业务测试，不宣称容器隔离或网络安全已被实际证明。

<a id="frozen-decisions"></a>
## 12. 冻结决策与需求治理

### 12.1 正式开工前的需求同步闸门

当前`ARCHITECTURE.md`与`IMPLEMENTATION.md`已经作为Agent设计唯一规范源，已闭环的历史评审问题不再保留独立清单。software-requirements暂不接纳Agent是有意的阶段边界：在业务代码尚未开始前，避免把未实现能力写入现有SRS/FR/traceability并造成“设计完成=产品已实现”的污染。

正式进入P1-A业务实现前，必须把已经冻结的Agent范围同步到`doc/software-requirements/requirements/agent.md`、`SRS.md`和`traceability/functional-requirements.md`，必要时补`design/special-designs.md`及Backend/Frontend总架构索引。同步内容只描述即将实施的正式范围和可验收FR，不把设计文档中的未来Phase能力写成已交付事实；完成现有需求/文档检查后才能开始Agent产品代码。

这个闸门不是Agent设计缺口，也不要求现在提前修改软件需求；它只约束“开始实现”的先后顺序。后续若设计正文出现新问题，直接修正文档和对应phase/E2E归属，不再维护平行Review文档。

### 12.2 DECISION-01～25（采用值而非待选项）

| 编号 | 冻结决定 | 正文 |
| --- | --- | --- |
| DECISION-01 | 一期Host/UI/模型/只读；二期修改与Docker；三期协议/多Agent/安装式插件 | 架构§1；实施§0 |
| DECISION-02 | 单用户，不做tenant/role，App必须隔离 | 架构§1/3 |
| DECISION-03 | AgentRuntime是参与者，Group是配额聚合，Environment是容器 | 架构§3 |
| DECISION-04 | 二期独立Controller持专用engine权限；Backend不挂socket | §9 |
| DECISION-05 | 每Environment独立容器/网络，不能用同容器Unix用户替代跨环境隔离 | §9.3 |
| DECISION-06 | 一期OpenAI-compatible Chat Completions streaming adapter+OpenAI preset，Anthropic三期 | §6.1 |
| DECISION-07 | HTTPS公网默认，私网准确host:port例外，metadata始终拒绝，DNS固定，redirect拒绝 | §6.1 |
| DECISION-08 | 单一ai_thread_entries ledger；不保留两套input/message sequence | §4.1 |
| DECISION-09 | V1不自动compact，Run显式删除才清事实，不实现CURSOR_EXPIRED | §7.2 |
| DECISION-10 | Approval统一600秒，consume前仍检查expiry/hash/revisions | §3/5.3 |
| DECISION-11 | 32K输入/4096输出/100K Run，真实窗口+15%估算余量，重试2次 | §3/6.1 |
| DECISION-12 | 50MiB对象/10MiB raw/256MiB Run/2GiB全局/终态7天，无限retain不绕quota | §3/6.2 |
| DECISION-13 | Lease30秒/10秒续约，未知远端结果隔离而非到期即重新执行 | §5.4 |
| DECISION-14 | 全局Runtime执行默认软2/默认Hard Limit 4（Hard可在Agent Settings二次确认调整）并直接约束root/child，模型并发默认auto跟随有效Runtime且可向下调、每Run工具1；Subagent无累计/独立并发上限，只保留深度/profile/预算且每个可不同模型 | §3/10 |
| DECISION-15 | 二期结构化工具优先，未知shell文本审批，硬deny不可覆盖，不把regex当sandbox | §5 |
| DECISION-16 | 一期不自动写Memory；三期candidate→用户审查→published | §6.3 |
| DECISION-17 | 一期只读仓库builtin Skill，三期签名安装、脚本另受capability约束 | §6.3/10.7 |
| DECISION-18 | MCP/ACP/CDP/Subagent/安装式扩展三期；Docker基础环境二期 | §0/9/10 |
| DECISION-19 | Operations默认enabled，无模型degraded+引导，不阻断Core | 架构§1/4 |
| DECISION-20 | 全部当前/新增connection+denylist，不采用首次连接allowlist方案 | §5.1 |
| DECISION-21 | Agent mutation做same-origin+CSRF，内部mTLS通道独立 | §7.1 |
| DECISION-22 | Resume新Run/新身份/新资源、checkpoint校验、旧mutation不重放 | §2.2 |
| DECISION-23 | DB包含加密credential；默认排除payload/plugin code/环境卷；缺内容标unavailable | §6.3 |
| DECISION-24 | 无Docker核心可用，availability明确原因，不绑定fake production adapter | §9.1/9.4 |
| DECISION-25 | integer micro-USD、版本化价格、unknown=null；设置cost cap需已知价格 | §6.1 |

新增Owner决定：Subagent支持可配置delegation深度、每profile独立模型/软预算，通信/调度有完整协议；不设置累计创建数量或独立child并发上限，已落架构§10.1～10.3/实施§10。后续更换默认值以服务端settings/Run快照为准，不在多个文件另写不同常量。

<a id="i13"></a>
## 13. 文档留存与未来拆分位置（本轮不执行拆分）

当前设计规范只保留ARCHITECTURE.md（职责/理由/边界）与IMPLEMENTATION.md（接口/SQL/阶段/验收）。在正式业务代码开工前不创建或修改software-requirements、Backend/Frontend总架构、工程约束或业务源码；以下路径是开工前/后续稳定阶段的同步计划，不表示文件已经新增或功能已经实现。

| 后续目标 | 从本方案拆出的内容 | 何时执行 |
| --- | --- | --- |
| doc/software-requirements/requirements/agent.md | App Host/单用户与App隔离/Provider预算/Run-SSE/运维安全/Artifact/环境/Skill-Memory/MCP-ACP-CDP/插件/Subagent独立模型/深度/通信调度/UI兼容，共14类需求候选 | Agent方案确认且Owner允许需求同步后 |
| doc/software-requirements/SRS.md | Agent分期范围，区分设计确定和已实现，不虚构旧产品功能 | 同上，正式业务代码开工前 |
| doc/software-requirements/traceability/functional-requirements.md | 新FR→SRS→本文模块/实施任务→E2E双向映射，不伪造Git历史 | 同上 |
| doc/software-requirements/design/special-designs.md | 正式Agent运行隔离/插件/持久化/调度的跨模块设计索引 | 同上 |
| doc/architecture/BACKEND.md | 仅Agent模块owner/组合入口/现有平台接点链接，详细协议仍由本目录持有 | 实际工程接入稳定后 |
| doc/architecture/FRONTEND.md | 仅全局SurfaceHost、public facade、原Shell兼容与子模块规则链接 | 实际前端接入稳定后 |
| doc/README.md及既有部署/E2E文档 | Agent入口、三期可用范围、环境安装/测试执行索引 | 有实际实现和验收证据后 |
| doc/architecture/agent/ARCHITECTURE.md、IMPLEMENTATION.md | 保留唯一详细设计/契约，拆分后改成稳定SRS/FR链接；删除重复解释而不是复制多个规范源 | 后续文档迁移任务中 |

需求候选不等于正式SRS修改：本轮P0-01明确未关闭。正式开工前先履行已有EC-REQ-001/EC-RUNTIME-005，不因本文已有SQL/接口就绕过需求治理；但可以在本目录继续审核、调整和做静态设计验证。P1/P2/P3实施任务标为待实施，不把本文的设计完成误记为软件交付。
