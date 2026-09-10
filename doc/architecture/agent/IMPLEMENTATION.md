# Nexus Agent 详细实施方案

版本：2.1；配套 [ARCHITECTURE.md](ARCHITECTURE.md)。本文的路径、类型、函数、SQL、协议和任务编号是实现规范；其中大量 P1/P2/P3 项已经进入当前源码，但“规范中存在”仍不等于“产品已完整验收”。当前实际文件、live composition、部分实现和验证缺口统一记录在 [CURRENT_AGENT_ARCHITECTURE.md](CURRENT_AGENT_ARCHITECTURE.md)。

## 0. 阅读与实施顺序

先读架构 §1～3；P1-A→P1-B→P1-C→P1-D→P2-A→P2-B→P2-C→P3-A→P3-B→P3-C 继续作为实现依赖和历史验收分组，而不再代表“尚未开工”。软件需求、FR、特殊设计和总架构索引已经进入正式 Agent 实现基线；后续变更必须同时维护规范、当前实现快照和需求追溯，避免阶段编号被误读成当前交付状态。

| 任务 | 边界 / 可见成果                                                                                                                                 | 依赖 / E2E spec（均在 test/e2e/tests/agent/）                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P1-A | Host、scope、App/grant/settings持久化、生产manifest、architecture guard                                                                         | 需求/本文契约；host.spec.ts                                                                          |
| P1-B | Provider/Secret/出站策略、Artifact与文件库后端、Ledger、Context、内置Skill/Recall                                                               | P1-A；provider.spec.ts、artifacts.spec.ts                                                            |
| P1-C | 通用Run/Native Harness、只读Tools、state commit、调度、SSE/summary、cancel/reconcile                                                            | P1-B；runs.spec.ts、events.spec.ts、read-tools.spec.ts                                               |
| P1-D | Launcher/Hub/Operations/文件库 UI、Nexus Settings 的 Agent tab（总开关/App管理/设置分区/Environment unavailable）、ingress/reset/shutdown、打包 | P1-C；hub.spec.ts、settings.spec.ts、artifact-library.spec.ts、lifecycle.spec.ts、deployment.spec.ts |
| P2-A | canonical hash、Approval、Lease、修改Tools、Workspace MutationGuard                                                                             | P1-D；approvals.spec.ts、leases.spec.ts、mutation.spec.ts                                            |
| P2-B | nexus-agent-runner/Sandbox Manager、环境RPC/隔离/配额/Artifact协作/发布                                                                         | P2-A；environments.spec.ts、environment-isolation.spec.ts                                            |
| P2-C | 环境UI/AI控制、checkpoint resume、可选Artifact备份恢复                                                                                          | P2-B；environment-ui.spec.ts、recovery.spec.ts                                                       |
| P3-A | MCP/ACP/CDP适配器与对应Environment Recipe                                                                                                       | P2-C；mcp.spec.ts、acp.spec.ts、browser.spec.ts                                                      |
| P3-B | 多Agent/SharedFacts/Memory审核                                                                                                                  | P3-A；delegation.spec.ts、memory.spec.ts                                                             |
| P3-C | 安装式App/Skill、隔离UI、升级/回退/卸载                                                                                                         | P3-B；plugins.spec.ts                                                                                |

每任务交接必须给：修改文件、公开签名、迁移版本、API/事件变化、状态转移、失败码、实际验收命令/结果及剩余风险。不能把模拟模型成功等同真实产品集成；E2E fake downstream只控制数据/故障，断言仍通过产品UI/API。

### 0.1 依赖复用闸门

所有任务实施前先做一次成熟模块扫描，遵循架构 §2.1 的 reuse-first 原则。扫描不是为了增加依赖数量，而是避免长期维护自写的标准协议/格式实现。候选至少记录：包名与版本范围、许可证、项目维护年限/社区采用、最近维护状态、直接/传递依赖、Node/Vue兼容性、bundle/runtime成本、已知安全问题、与当前契约的差异。

采用规则：

- **优先直接采用**：标准协议解析、标准格式校验/比较、RFC header 编码、成熟虚拟化等，且 adapter 后不会泄漏第三方类型。
- **组合采用**：成熟模块只解决底层 primitive 时，用 Nexus adapter 组合。例如 `ipaddr.js` 只做 IP 分类，`OutboundPolicy/SafeOutboundClient` 仍负责 DNS 全地址校验、host:port 例外、metadata deny、IP pinning、TLS SNI 和 redirect deny。
- **继续自研**：StateCommit、Run 状态机、SQLite CAS/idempotency、scheduler fairness、budget/reconciliation、Artifact 原子写协议等与领域事务绑定的部分，不用通用 queue/retry/storage 库替换。
- **拒绝候选**：长期无维护、许可证不明、存在未处理的高风险安全问题、为了接入必须弱化当前安全边界、或明显突破前端 bundle budget 的库。

P1 当前依赖替换清单：

| 原实现                                        | 处理             | 模块/原因                                                                             |
| --------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| Manifest 手写 SemVer regex/compare            | 替换             | `semver@^7`；npm 自身长期使用的 SemVer 实现                                           |
| Manifest/Tool 结构化输入的重复手写 shape 校验 | 渐进替换         | `ajv@^8`；先用于稳定 JSON Schema 边界，领域授权/策略检查继续代码实现                  |
| Artifact `Content-Disposition` 手写 escaping  | 替换             | `content-disposition@^3`；负责 RFC filename 编码                                      |
| Frontend SSE 手写 parser                      | 已替换           | `eventsource-parser@^4`                                                               |
| Provider SSE 手写 parser                      | 替换             | `eventsource-parser@^4`，保留 Provider chunk/Tool 参数/usage 业务映射                 |
| Conversation/Artifact 长列表全量 DOM          | 替换             | `vue-virtual-scroller@^3`，使用 DynamicScroller/RecycleScroller                       |
| UUID 版本 regex                               | 替换             | `uuid@^14`；统一 validate/version，生成继续使用 Node `crypto.randomUUID()`            |
| HTTP `Range` 手写 parser                      | 替换             | `range-parser@^1.3`；只负责 RFC Range，单 range/8 MiB 上限仍由 Artifact adapter 强制  |
| IP 分类                                       | 保留现有成熟模块 | `ipaddr.js` 已满足地址分类；Nexus SSRF/DNS rebinding policy 继续 adapter 编排         |
| Hub drag/resize                               | 暂缓第三方替换   | 候选虽成熟但当前安全/维护审计存在未决项；优先复用现有 Foundation pointer/overlay 原语 |

后续 P2/P3 每个新能力仍先过此闸门，尤其是 JSON Schema、MCP、CDP、归档/解包、签名、重试/限流 primitive、虚拟列表和浏览器协议，不默认从零实现。

<a id="i1"></a>

## 1. 文件与现有工程接入

### 1.1 唯一目录与各文件职责

下表 Backend 模块文件以 packages/backend/src/modules/agent/ 为根。除 public.ts 外不导出可变全局单例；同职责的小类型允许合并到同一个 *.types.ts，不另建平行顶层包。

| 文件                                             | 导出 / 职责                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent.types.ts                                   | Scope、Actor、JsonValue、PageRequest、ClockPort公共纯类型                                                                                                                                                     |
| agent-defaults.ts                                | validateSettings、snapshotBudget；唯一默认值/硬上限                                                                                                                                                           |
| public.ts                                        | AgentServices的类型/受限facade，不返回容器、DB或SDK                                                                                                                                                           |
| host/app.types.ts                                | Manifest、ValidatedManifest、AppRecord、CapabilityGrant、AppIntent                                                                                                                                            |
| host/app-registry.service.ts                     | register(definition):void；get(appId):AppRecord；list(scope):AppView[]，只内存目录                                                                                                                            |
| host/app-manifest-validator.ts                   | validateManifest(raw:unknown):ValidatedManifest；schema/semver/id/路径/能力检查                                                                                                                               |
| host/app-lifecycle.service.ts                    | initializeDefaults():Promise<void>；setEnabled(scope,enabled,expectedVersion):Promise<AppRecord>；quiesce(appId,deadline):Promise<void>                                                                       |
| host/app-state.repository.port.ts                | get(scope)、insertDefault(record)、compareAndSet(scope,version,patch)、list(userId)                                                                                                                           |
| host/app-grant.repository.port.ts                | list(scope)、replace(scope,expectedRevision,grants):Promise<number>                                                                                                                                           |
| host/app-capability-broker.ts                    | authorize(scope,capability,resource):Promise<GrantDecision>，读取当前revision/denylist                                                                                                                        |
| host/plugin-sdk.types.ts                         | Backend Plugin `PluginBackendSdkV1`/activation context 的明确版本化类型；只声明已实现的 scope-bound AppStorage                                                                                                |
| host/app-storage.port.ts                         | get(scope,key)、put(scope,key,value,expectedVersion)、delete(scope,key,expectedVersion)，含配额                                                                                                               |
| host/host-summary.port.ts                        | read(userId):Promise<HostSnapshot>；readAfter(userId,cursor,limit):Promise<HostEvent[]>                                                                                                                       |
| ai/model.types.ts                                | ProviderView、ModelRef、ModelRequest、ModelEvent、TokenUsage                                                                                                                                                  |
| ai/language-model.port.ts                        | stream(request:ModelRequest,signal:AbortSignal):AsyncIterable<ModelEvent>                                                                                                                                     |
| ai/provider.service.ts                           | list(userId)、save(userId,input,expectedVersion)、test(userId,providerId)、remove(userId,id,version)                                                                                                          |
| ai/provider.repository.port.ts                   | get/list/save/remove；受保护凭据仅在Infrastructure映射，不进入View                                                                                                                                            |
| ai/provider-secret.port.ts                       | withCredential<T>(providerId,revision,use:(secret:string)=>Promise<T>):Promise<T>，调用期间使用不缓存到domain                                                                                                 |
| ai/conversation.service.ts                       | createThread(scope,title)、appendInput(scope,threadId,input,command)、readPage(scope,threadId,page)                                                                                                           |
| ai/conversation.repository.port.ts               | readThread/readEntries；写入ledger经StateCommitPort同事务                                                                                                                                                     |
| ai/context.service.ts                            | compose(input:ContextRequest):Promise<ContextPlan>，预算/摘要/证据来源范围                                                                                                                                    |
| ai/token-budget.ts                               | reserve(runId,attemptId,estimate):Promise<Reservation>；settle(id,usage):Promise<void>；release(id)                                                                                                           |
| ai/artifact.port.ts                              | begin(scope,meta):Promise<UploadReservation>；write(id,source,signal):Promise<ArtifactRef>；read(scope,id,range):AsyncIterable<Uint8Array>；retain/delete                                                     |
| ai/recall.service.ts                             | recall(scope,query,limit=5,maxBytes=8192):Promise<RecallItem[]>；memory proposal三期新增                                                                                                                      |
| ai/skill-registry.ts                             | search(scope,query):SkillMetadata[]；load(scope,id,version):Promise<SkillBody>；resource(scope,id,path):Promise<ArtifactRef>                                                                                  |
| capabilities/tool-catalog.ts                     | `CapabilityContribution{id,capability,tools[]}` 注册/替换/发现；强制每个 Tool capability 与 contribution 一致，MCP 也走同一边界                                                                               |
| runtime/definitions/agent-definition.port.ts     | AgentDefinition 只读契约                                                                                                                                                                                      |
| runtime/definitions/agent-definition.registry.ts | Agent Definition 内存目录，不承载运行状态                                                                                                                                                                     |
| runtime/runs/run.types.ts                        | 本文§2所有 Run/输入/预算/状态 DTO 的 domain 对应物                                                                                                                                                            |
| runtime/runs/run.service.ts                      | create/appendInput/increaseBudget/cancel/checkpoint/resume/delete 的 Run 生命周期                                                                                                                             |
| runtime/runs/run.repository.port.ts              | snapshot/list/events/runtime projection 的持久化端口                                                                                                                                                          |
| runtime/runs/state-commit.port.ts                | 唯一运行事实原子提交入口                                                                                                                                                                                      |
| runtime/runs/idempotency.ts                      | Run 命令幂等键/请求 hash 规则                                                                                                                                                                                 |
| runtime/execution/agent-backend.port.ts          | Agent Loop 的窄 Backend 执行契约                                                                                                                                                                              |
| runtime/execution/native-agent-backend.ts        | `context → model → tool/result → next step` 的 Native Harness；不承担外围资源管理                                                                                                                             |
| runtime/execution/model-call-limiter.ts          | 全局/用户模型调用 permit 与释放                                                                                                                                                                               |
| runtime/planning/plan.types.ts                   | `RunPlan/PlanItem`、依赖/evidence/环校验                                                                                                                                                                      |
| runtime/planning/plan.service.ts                 | revision-CAS 的 durable plan projection                                                                                                                                                                       |
| runtime/planning/plan-tool.ts                    | `plan_update` AgentTool；PlanItem 与 Runtime Step 分离                                                                                                                                                        |
| runtime/scheduling/scheduler.ts                  | root/child Runtime 公平 claim、park/wake/quiesce                                                                                                                                                              |
| runtime/approvals/*                              | Approval repository/service；不与 execution loop 混成单体                                                                                                                                                     |
| runtime/recovery/checkpoint.*                    | Checkpoint 保存/恢复契约                                                                                                                                                                                      |
| runtime/events/*                                 | Durable/Transient/Host event 类型与 EventHub                                                                                                                                                                  |
| runtime/collaboration/*                          | Subagent、Mailbox、SharedFacts、协作调度                                                                                                                                                                      |
| runtime/exchange/workspace-artifact.*            | Environment Workspace ↔ durable Artifact 的显式跨资源桥；不让 Environment 反向依赖 Artifact                                                                                                                   |
| capabilities/tool.types.ts                       | 本文§5唯一ToolDescriptor/Inspection/Result/Context                                                                                                                                                            |
| capabilities/tool-executor.ts                    | invoke(context,proposal):Promise<ToolResult>；唯一安全执行编排                                                                                                                                                |
| capabilities/tool-target.types.ts                | Tool target fingerprint/environment identity 等稳定 target 类型；不把 target 当 capability dispatcher                                                                                                         |
| capabilities/machine.port.ts                     | inspect/read/execute/write/diagnose/docker窄契约，见§5；具体平台 adapter 位于 Infrastructure                                                                                                                  |
| capabilities/operation-hash.ts                   | canonicalize(value:JsonValue):string；hashOperation(op:OperationV1):string                                                                                                                                    |
| capabilities/policy.service.ts                   | decide(scope,inspection,currentRevision):PolicyDecision；硬deny先行                                                                                                                                           |
| capabilities/approval.service.ts                 | request(ctx,inspection)、resolve(scope,id,decision,hash,expectedVersion)、expire(now)、consume(ctx,id,hash)                                                                                                   |
| capabilities/lease.port.ts                       | acquireMany(owner,keys,mode,ttlSeconds)、renew(ids,owner,ttlSeconds)、release(ids,owner)、quarantine(toolId,keys,reason)                                                                                      |
| environments/environment.types.ts                | Group/Environment/Profile/ControlCommand/JobResult                                                                                                                                                            |
| environments/environment.service.ts              | availability/catalog/storage、createGroup/action、workspace grants/file mediation；按 scope 验证 Environment 所有权；create/start/restart/ACL mutation 重新检查 environment.manage，stop/delete 保留 teardown |
| environments/environment-management.service.ts   | setup/Pack uninstall/runtime cleanup/settings reset 的 preview-confirm 管理                                                                                                                                   |
| environments/environment-controller.port.ts      | Backend→Runner command/catalog/storage/workspace Host 接口；不提供任意 Docker 方法                                                                                                                            |
| environments/environment-gateway.port.ts         | Agent Environment job invoke/query 的受限执行接口                                                                                                                                                             |
| apps/operations/app.manifest.json                | 稳定id=nexus.operations、版本、能力集合                                                                                                                                                                       |
| apps/operations/public.ts                        | createOperationsApp(sdk):AppContribution，注册定义/工具，不创建Host                                                                                                                                           |
| apps/operations/operations.types.ts              | OpsGoal、OpsTarget、VerificationCriteria                                                                                                                                                                      |
| apps/operations/tools.ts                         | diagnostics/readFile（一期），writeFile/shell/remoteDocker（二期）的AgentTool实现                                                                                                                             |
| apps/operations/verification.ts                  | verifyFileHash、verifyServiceState、verifyGoalEvidence；无verifier不注册mutation                                                                                                                              |

Concrete adapters：packages/backend/src/infrastructure/agent/ 下 repositories/sqlite-{app,provider,conversation,run,artifact,approval,lease,environment}.repository.ts，repositories/sqlite-state-commit.ts，providers/openai-compatible.adapter.ts，providers/provider-secret.adapter.ts，providers/outbound-policy.adapter.ts，artifacts/local-artifact-store.ts，environments/controller-client.ts，integrations/{mcp,acp}.adapter.ts。不要为每个方法创建一层wrapper。

### 1.2 现有文件修改表

| 当前文件                                                                                   | 精确改动与兼容边界                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend src/bootstrap/composition-root.ts                                                  | 调compose-agent，注入database/SecretCipher/ConnectionService/ExecutionSessionManager/diagnostics及机器ports；返回agent facade和quiesce/dispose。不要把整个root给App |
| Backend src/bootstrap/application.ts                                                       | 向HTTP注入facade；shutdown先quiesce Agent和SSE再server.close；resetForE2E先同样排空再reset DB                                                                       |
| Backend src/interfaces/http/http-application.ts                                            | 在现有认证/IP/2FA边界后挂agent.routes；保留express.json 1mb及其他API响应，不改旧WS协议                                                                              |
| Backend src/infrastructure/database/sqlite-schema.registry.ts                              | 新库加入§4当期DDL；仅此处登记base schema                                                                                                                            |
| Backend src/infrastructure/database/sqlite-migrations.ts                                   | 旧库按顺序升级；无module migration contribution机制，不新增第二个DB连接                                                                                             |
| Backend src/modules/workspace/services/workspace-{filesystem,docker,operations}.service.ts | 二期typed mutation调用注入的MutationGuardPort，finally释放；接口签名给Platform不依赖Agent                                                                           |
| Backend src/platform/execution/mutation-guard.port.ts（新增，二期）                        | withLease<T>(targetIdentity,resources,owner,work:(signal)=>Promise<T>):Promise<T>；生产由同一Lease实现注入Workspace和Agent                                          |
| Backend src/platform/filesystem/remote-text-file.service.ts                                | 现有read会全量Buffer；新增readBounded(fs,path,maxBytes,signal)，不改旧read默认行为；Agent只用有界版本                                                               |
| Backend src/platform/execution/execution-session-manager.ts                                | 使用现有connect/closeByOwner，不让Agent取Workspace session，不改session身份语义                                                                                     |
| Backend scripts/check-architecture.mjs                                                     | 增加§1.3子目录与port-only规则，扫描静态/dynamic imports和public导出                                                                                                 |
| Frontend src/app/App.vue                                                                   | RouterView外挂AgentSurfaceHost；App组合层注入auth失效回调和用户scope，登出dispose                                                                                   |
| Frontend src/app/shell/AppHeader.vue                                                       | 不修改                                                                                                                                                              |
| Frontend src/app/router/index.ts                                                           | 不为Agent新增独立页面路由；保持现有router行为，Agent始终由App.vue中的AgentSurfaceHost全局浮层呈现；设置继续使用既有 `/settings` 路由                                |
| Frontend src/app/pages/settings/SettingsPage.vue                                           | 在现有 Workspace/System/Security/IP Control/Data/Appearance/About 横向tab中新增 Agent；复用现有Settings布局，不创建Agent独立设置页/路由                             |
| Frontend src/app/i18n/index.ts                                                             | 现有features/*/i18n glob无需改；新增agent三语同键文件，并给现有settings页增加Agent tab文案                                                                          |
| Frontend src/features/auth/public.ts                                                       | AgentSurfaceHost 只通过现有 public `useAuthSession` 读取认证状态；Agent 不创建第二套 auth/session store                                                             |
| Frontend scripts/check-architecture.mjs                                                    | 保持 feature/public 边界和依赖环检查；Agent 新模块继续受同一生产架构门禁                                                                                            |
| Frontend nginx.conf                                                                        | §7具体Agent prefix location覆盖较宽的^~ /api/；Artifact upload单独body上限，不放大全局                                                                              |
| 根build.sh、Dockerfile、.github/workflows/publish-ghcr.yml                                 | 应用镜像继续不含 host Docker 控制；Agent Runner 以 host runtime 构建/发布，Tool Pack 保持 digest/version manifest                                                   |
| docker-compose.yml                                                                         | Backend 通过 host-gateway + Controller token 访问 host `nexus-agent-runner`；不创建高权限 Runner Compose 服务；Plugin Frontend origin 仍复用 frontend 第二 listener |
| test/e2e组配置、.github/workflows/e2e.yml                                                  | 注册真实产品 spec；部署 smoke 在 GitHub Actions host 启动 Runner/bubblewrap，并验证 Workspace generation 重建后稳定文件仍存在                                       |

### 1.3 import/public约束与生产构建

Backend allowed子图与架构§2一致；host不能导出raw registry/store给插件，ai/runtime/capabilities/environments禁止import apps，只有bootstrap能import所有contribution。Frontend host只依赖app-contribution.types，不import apps组件；builtin-apps.ts作为静态组合例外只用lazy public.ts。runtime不依赖apps，apps/<a>不能依赖apps/<b>。技术SDK仅Infrastructure。

Backend当前是NodeNext但package未声明type=module：内置JSON使用 import rawManifest from './app.manifest.json'，保持当前TS模块输出策略；不强制添加with属性。build后检查dist/modules/agent/apps/operations/app.manifest.json存在，node dist/index.js启动真实API可读manifest。外部Markdown Skill资源由build脚本显式copy到同层dist；不从cwd定位src。没有消费者的三期实现文件不提前创建；一期availability port/DTO被设置页真实使用。

<a id="i2"></a>

## 2. 类型与状态机（唯一版本）

所有公开HTTP输入拒绝unknown字段；domain不依赖Express，类型文件以*.types.ts结尾。下列类型中的时间为UnixSeconds；HTTP映射为ISO字符串。

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type Scope = { userId: number; appId: string };
type Actor =
  | { kind: 'user'; userId: number }
  | { kind: 'agent'; userId: number; appId: string; runId: string; agentRuntimeId: string };
type CommandIdentity = { key: string; requestId: string };
type ModelRef = { providerId: string; modelId: string; configurationVersion: number };
type UserInputData = { text: string; artifactRefs: string[] };
type CreateRunCommand = {
  threadId: string;
  input: UserInputData;
  agentDefinitionId: string;
  model: ModelRef;
  connectionIds: number[];
  command: CommandIdentity;
};
type RunStatus =
  | 'created'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_budget'
  | 'cancelling'
  | 'completed'
  | 'completed_unverified'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
type RuntimeStatus = 'created' | 'running' | 'stopping' | 'stopped' | 'failed' | 'interrupted';
type PlanItemStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
type PlanItem = {
  id: string;
  title: string;
  detail: string | null;
  status: PlanItemStatus;
  dependsOn: string[];
  evidenceRefs: string[];
};
type RunPlan = { schemaVersion: 1; revision: number; items: PlanItem[] };
type ToolCallStatus =
  | 'proposed'
  | 'awaiting_approval'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'verification_failed'
  | 'failed'
  | 'cancelled'
  | 'reconciling';
type ApprovalStatus = 'requested' | 'approved' | 'denied' | 'expired' | 'superseded';
type EnvironmentStatus =
  'creating' | 'ready' | 'starting' | 'running' | 'stopping' | 'stopped' | 'deleting' | 'deleted' | 'failed';
type VerificationResult = {
  status: 'verified' | 'unverified' | 'failed';
  summary: string;
  evidenceRefs: string[];
};
type PageRequest = { limit: number; before?: string }; // default50/max100; opaque stable keyset
```

RunView必须返回id/appId/threadId/status/version、goalStatus、verificationStatus、needsReconciliation、budget/usage、consumedInputSequence、eventCursor、createdAt/startedAt/completedAt，并把 `plan_json` 映射成明确 `RunPlan`；详细snapshot同时含participants/steps/toolCalls/approvals/messages/evidenceRefs。列表只返回安全摘要，不返回normalized secret值或内部owner handles。

`PlanItem` 是 durable plan projection，不是 Runtime `Step`。`plan_update` 以 revision CAS 更新最多64项，验证唯一 id、依赖存在、无自依赖/环和有界 evidence refs；Frontend TaskRail直接渲染 PlanItem，不再 JSON dump。Runtime `Step` 只记录模型/工具/验证/delegation 的实际推进边界。现阶段不新增 Task/Workflow/Graph 一级表；Execution Graph 由 `PlanItem.dependsOn + evidenceRefs` 投影，需要调度图时再在 planning/scheduling 子域内演进。

Backend Runtime 当前物理目录固定拆为 `runtime/definitions`、`runs`、`execution`、`planning`、`scheduling`、`approvals`、`recovery`、`events`、`collaboration`、`exchange`。这是实现模块边界，不增加领域实体。禁止把后续功能重新堆回 `runtime/*.ts` 一级；跨资源协调（例如 Workspace↔Artifact）放 `exchange`，而 Environment/Artifact 各自保持单向职责。

### 2.1 状态迁移与竞态

| 对象 / from                                   | 命令 / 条件                                                  | to / 同事务事实                                                                        |
| --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Run created                                   | scheduler取得执行slot；App/Provider仍有效                    | running；run.status_changed + model.started                                            |
| Run created                                   | 用户取消且尚未执行                                           | cancelled；无需假装经过远端中断                                                        |
| Run running                                   | tool要求审批且无已运行tool                                   | awaiting_approval；approval.requested                                                  |
| Run awaiting_approval                         | 批准/拒绝/到期/新input supersede                             | running；approval.decided或input.appended；planner决定下一步                           |
| Run running                                   | 下一 model/tool/delegation/verification 预留将越过当前软预算 | awaiting_budget；budget.increase_requested；释放 Runtime/model/tool permit，不占执行槽 |
| Run awaiting_budget                           | 用户显式提高本 Run 预算且未超过 hard limit                   | running；budget.increased；重新进入 scheduler，不重放已经 started 的副作用             |
| Run running                                   | 有final且goal verified                                       | completed；message.final + verification.completed                                      |
| Run running                                   | final但只能unverified                                        | completed_unverified；不能伪装有运维验证                                               |
| Run running/awaiting_approval/awaiting_budget | cancel/App disable                                           | cancelling；禁止新model/tool/delegation，撤销未消费approval/budget request             |
| Run cancelling                                | 确认所有执行已终止                                           | cancelled；保存最终用量/取消原因                                                       |
| Run任意非终态                                 | 进程重启/远端结果未知/停止确认失败                           | interrupted；needsReconciliation按未知tool设置                                         |
| Run running                                   | 可确认无未决副作用的模型/工具失败                            | failed；run.error；任何Run预算耗尽（包括已到hard limit）都不得自动走此迁移             |
| Run终态                                       | resume用户命令+有效checkpoint                                | 原Run不变，创建新Run(parentRunId)，未完成mutation不重放                                |
| Runtime created→running                       | registry.start                                               | 独立execution owner；预算slot                                                          |
| Runtime running→stopping→stopped              | cancel/完成                                                  | stop已确认才释放slot；异常为failed/interrupted                                         |
| Tool proposed                                 | inspect/authorize/Policy                                     | ready或awaiting_approval；deny为failed                                                 |
| Tool awaiting_approval                        | 批准+fresh复核                                               | ready；拒绝/过期/superseded→cancelled                                                  |
| Tool ready                                    | 取得lease/consume approval/提交started                       | running；同toolCallId只能started一次                                                   |
| Tool running                                  | 确认result并verify                                           | succeeded/verification_failed/failed                                                   |
| Tool running                                  | 结果未知                                                     | reconciling+resource quarantine；不自动重放                                            |
| Tool reconciling                              | 只读核实或用户确认带证据                                     | succeeded/failed/cancelled，记录reconciliation来源；Run终态不回退                      |
| Approval requested                            | 用户决定/计时/更新input                                      | approved/denied/expired/superseded；version CAS                                        |
| Approval approved未consume                    | 参数/policy/input更新或到期                                  | superseded/expired；不能复用旧批准                                                     |
| App disabled→enabling                         | setEnabled(true)                                             | running或degraded/failed；desired仍enabled                                             |
| App running/degraded→disabling                | setEnabled(false)                                            | 排空后disabled；未排空留disabling及reason                                              |
| Environment stopped/ready→starting→running    | start且Recipe/PackRef/配额/token有效                         | command journal记录与environment.changed事件                                           |
| Environment running→stopping→stopped          | stop及确认退出                                               | tmpfs不保证保留，Artifact不删                                                          |
| Environment stopped/failed→deleting→deleted   | 无未决job且获删除授权                                        | Runner sandbox/process/runtime tree 清理确认后tombstone                                |

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

| 参数（单位）                                            | 默认软值 / 默认Hard Limit                  | 口径                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| maxContextTokens                                        | 32000 / 128000                             | 单调用输入；另受真实modelWindow-outputReserve约束                                                                                                                                                                                             |
| maxOutputTokens                                         | 4096 / 16384                               | 单调用输出，不能超过model limit                                                                                                                                                                                                               |
| maxRunTokens                                            | 100000 / 1000000                           | 所有attempt input+output含cache和重试；父子共享；达到requested值暂停询问，不自动失败                                                                                                                                                          |
| maxRunSteps                                             | 80 / 400                                   | 统一计 model/tool/verification/delegation；替代原仅计tool的40/200口径；达到requested值进入awaiting_budget，用户可提高本Run预算至hard limit                                                                                                    |
| maxRunCostMicros                                        | null / null（默认不设）                    | 可选本Run成本软预算；Hard Limit也由Agent Settings显式配置，不存在额外部署层资源上限；仅所有已选模型价格已知时可启用，达到requested值同样进入awaiting_budget                                                                                   |
| maxActiveExecutionSeconds                               | 1800 / 7200                                | 只累计Run中“至少一个Runtime正在executing”的wall-clock秒数，并发不重复乘算；awaiting_approval/awaiting_budget/join/waiting不消耗；达到requested值暂停询问用户                                                                                  |
| approvalTtlSeconds                                      | 600 / 600                                  | requested起；改变参数必须新审批                                                                                                                                                                                                               |
| toolTimeoutSeconds                                      | 60 / 300                                   | 单工具；长job每次poll仍受对应job/command deadline、取消与Run软预算安全边界                                                                                                                                                                    |
| maxToolOutputBytes                                      | 65536 / 262144                             | 单次返回模型前脱敏摘要上限                                                                                                                                                                                                                    |
| maxRawToolBytes                                         | 10485760 / 52428800                        | 流式接收截断上限；默认10MiB                                                                                                                                                                                                                   |
| maxArtifactBytes                                        | 268435456 / 1073741824                     | 单Run全部Artifact（retain也算）                                                                                                                                                                                                               |
| maxSingleArtifactBytes                                  | 52428800 / 268435456                       | 单对象，不能超过Run/全局余额                                                                                                                                                                                                                  |
| maxGlobalArtifactBytes                                  | 2147483648 / 10737418240                   | 单用户=全局，含tmp/reserved/ready                                                                                                                                                                                                             |
| minFreeDiskBytes                                        | 1073741824 / 不可向下调整                  | 低于保留空间拒绝新写                                                                                                                                                                                                                          |
| maxRecallItems/maxRecallBytes                           | 5/8192 / 默认Hard Limit 20/32768           | 合计而非逐条；Hard Limit可在Settings二次确认调整；带来源                                                                                                                                                                                      |
| maxConcurrentRuntimes                                   | 2 / 4                                      | 全局正在工作的AgentRuntime；等待join不占执行slot；4只是默认Hard Limit，可在Settings二次确认调整，实际资源不足明确busy/unavailable                                                                                                             |
| maxSubagentMessagesPerRun/maxSubagentMessageBytesPerRun | 1000/2097152 / 默认Hard Limit 5000/8388608 | 三期同Run显式Agent消息累计软预算；达到软值进入awaiting_budget，不把正常长协作直接判失败；单条/信封/pending容量仍是固定协议guardrail                                                                                                           |
| maxConcurrentModelCalls                                 | auto→2 / 4                                 | 用户值为auto或正整数且不得超过当前Settings Hard Limit；auto跟随effective maxConcurrentRuntimes；最终effective=min(requested/auto, maxConcurrentRuntimes)；Provider自身并发/限流作为运行时反馈与背压，不形成隐藏Hard Limit，允许用户主动往小调 |
| maxDelegationDepth                                      | 2 / 3                                      | root深度0；所有后代统一受Run快照限制                                                                                                                                                                                                          |
| maxConcurrentToolCalls                                  | 1 / 1                                      | 每Run；跨Run由lease控制                                                                                                                                                                                                                       |
| maxActiveEnvironments                                   | 4 / 8                                      | 全局Environment数量，与AgentRuntime数量独立；Hard Limit可在Settings二次确认调整                                                                                                                                                               |
| maxEnvironmentsPerGroup                                 | 4 / 4                                      | 单EnvironmentGroup软值/默认Hard Limit；不是隐藏常量，Hard Limit同样由Settings管理                                                                                                                                                             |
| leaseTtlSeconds/renewSeconds                            | 30/10，固定                                | 不是approval TTL；到期未知写进入quarantine                                                                                                                                                                                                    |
| unretainedArtifactTtlSeconds                            | 604800 / 最多2592000                       | 终态7天后，无有效引用才删                                                                                                                                                                                                                     |
| environmentIdleTtlSeconds                               | 900 / 3600                                 | 有未决job不idle；Environment本身不设绝对寿命，具体job/command各自有deadline                                                                                                                                                                   |
| modelRetryCount/estimateMargin                          | 2/0.15，固定                               | 最多3attempt；缺usage按预留上界结算                                                                                                                                                                                                           |

### 3.1 Agent Settings 分区与可调边界

Agent Settings使用同一个`agent_settings.value_json`保存版本化、namespaced配置，不为每个前端小模块单独建表。推荐schema=`{schemaVersion,feature:{enabled},model,performance,budget,hardLimits,subagents,storage,environments,safety}`；`feature.enabled`默认true，控制Agent Host是否接受/调度执行；Provider credential仍保存在`ai_providers`并由SecretCipher保护，Settings只保存引用、默认选择和非密钥偏好。服务端`validateSettings()`负责默认值、旧schema迁移、交叉约束；Hard Limits自身就是实例策略上限，不再与另一套隐藏资源上限取min。前端另外展示`runtimeCapabilities`，用于提示当前模型/Provider/宿主/Controller是否实际上承载得住该设置。

| 设置模块       | 用户可调项                                                                                                                                                                                                    | 规则                                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能开关       | `feature.enabled`                                                                                                                                                                                             | 默认开启。关闭先禁止新Run/新step/新Environment claim并进入Host quiesce，模型stream可abort，未started工作取消；已started mutation必须确认结果或quarantine。关闭完成后Launcher隐藏；Settings及安全cleanup/审计仍可访问，历史Thread/Run/Artifact/配置数据保留但Hub不再提供交互，重新开启后可重新浏览；再次开启不自动resume旧Run |
| App管理        | 各Agent App enabled/disabled、grant状态                                                                                                                                                                       | 一个Thread/Run只归属一个App；停用App不等于关闭整个Agent。App停用沿§2状态机排空自身运行，不影响其他App                                                                                                                                                                                                                        |
| 模型与Provider | 默认Provider/Model、Provider模型选择、私网host:port例外、价格/能力查看                                                                                                                                        | credential单独加密；模型不能修改endpoint/allowlist                                                                                                                                                                                                                                                                           |
| 执行与性能     | `maxConcurrentRuntimes`、`maxConcurrentModelCalls`                                                                                                                                                            | Runtime默认2/默认Hard Limit 4；Hard可在Settings二次确认调整；模型并发默认`auto`跟随Runtime，可手动降到1等更保守值；性能上调只影响后续claim，不强杀或扩容正在执行的调用                                                                                                                                                       |
| 预算与上下文   | context/output、Run token、Run step、active execution time、可选cost cap、tool timeout、Recall数量/字节                                                                                                       | Run token/step/active-time/cost是可增量确认的软预算：耗尽先进入awaiting_budget提醒用户；只能提高到当前effective Hard Limit                                                                                                                                                                                                   |
| Hard Limits    | §3参数表中所有标为默认Hard Limit的可配置资源策略，包括context/output、Run预算、tool timeout/I/O上限、Subagent预算、Runtime/model并发、Artifact/Environment/Runner资源上限；明确标固定/只读/现实能力的项目除外 | 管理员可配置，**任何提高必须二次确认**；确认页显示旧值→新值、当前usage与runtimeCapabilities、预计成本/CPU/内存/磁盘/并发影响。允许设置高于当前瞬时空闲资源，但实际调度/创建资源不足时返回明确busy/unavailable，不存在隐藏第二上限；降低不回滚已发生usage，下一安全边界按新上限阻止新增reserve                                |
| Subagent       | 深度、各profile模型/预算、Run内Agent消息数/字节软预算                                                                                                                                                         | 不设累计创建数或独立Subagent并发数；root/child统一使用“执行与性能”的Runtime并发，完成的Subagent不占后续名额；delegation与消息累计预算耗尽都先进入awaiting_budget询问用户                                                                                                                                                     |
| Artifact与存储 | 单对象/单Run/全局配额、未retain TTL                                                                                                                                                                           | 已用量高于新配额时拒绝降低；`minFreeDiskBytes`只读显示，不允许向下调                                                                                                                                                                                                                                                         |
| Environment    | active环境数、每组环境数、idle TTL、Recipe资源选择（二期）                                                                                                                                                    | 受Agent Settings Hard Limits控制；Controller只验证实际能否分配/隔离，资源不足返回availability/resource错误，不再另设隐藏资源上限                                                                                                                                                                                             |
| 安全与网络     | target denylist、Provider私网例外、capability授权入口                                                                                                                                                         | hard deny、CSRF、approval hash、lease/fencing、metadata拒绝等不可关闭                                                                                                                                                                                                                                                        |
| 系统保护       | Run created排队容量20、event batch 64/256KiB、commit queue 256/4MiB、安全终态预留、SSE每session 3、delta/tool chunk不落库                                                                                     | 只读展示/诊断；这些是有界队列/协议/数据库正确性guardrail，不是任务资源Hard Limit，也没有另一套可配置资源上限                                                                                                                                                                                                                 |

性能设置必须同时展示`current executing / requested / effective / hard limit`。例如`maxConcurrentRuntimes=2`且Hard Limit=4时显示“当前执行1 / 有效2 / Hard Limit 4”；`maxConcurrentModelCalls=auto`显示“自动（当前有效2）”，用户改为1后Runtime仍可并发2但模型调用串行排队。如果Runtime调为1，即使模型并发请求值更高，effective仍为1。root和所有Subagent共用Runtime/model slot，waiting/tool/join状态按各自permit规则计算。

`GET /agent/settings`返回`{requestedSettings,effectiveSettings,hardLimits,runtimeCapabilities,availability,revision}`。`feature.enabled`通过普通CAS PATCH修改；从true→false时先持久化禁止新claim的期望状态并触发Host quiesce，返回可观察的`availability.state='disabling'|'disabled'`，不能在仍有未知副作用时伪称已完全停止；false→true只重新开放Host调度，不自动resume历史Run。普通`PATCH /agent/settings`不直接提高Hard Limits；Hard Limit修改先`POST /agent/settings/hard-limits/preview`提交目标值和expectedVersion，服务端返回`confirmationId/current/proposed/impact/runtimeCapabilities/expiresAt`，前端显示二次确认；用户确认后`POST /agent/settings/hard-limits/confirm`以confirmationId+expectedVersion原子保存。降低也走同一路径以避免误操作，但UI可弱化风险提示。版本冲突409 `SETTINGS_VERSION_CONFLICT`；不存在额外隐藏资源上限校验。对运行中的Run，安全收紧立即在下一安全边界重新校验；纯性能上调不修改既有Run预算快照，只影响后续调度许可。

Run预算和Settings预算分开：createRun把当时的软预算复制进`budget_json`；当下一次reserve会超过`maxRunTokens/maxRunSteps/maxActiveExecutionSeconds/maxRunCostMicros?`时，StateCommit写`pendingIncrease={scope:'run'|'delegation'|'mailbox',refId?,reason,current,requested,suggested,hardLimit,canIncrease}`并把Run置`awaiting_budget`。前端显示“增加本次任务预算/自定义/取消”，不把预算不足伪装成失败。用户确认通过专用幂等命令只提高该Run的budget revision；不能低于已用量，不能越过hard limit，也不能通过改全局Settings偷偷恢复旧Run。若当前Hard Limit为数值且requested已经等于Hard Limit，则仍保持awaiting_budget并显示`canIncrease=false`，等待用户取消/结束，或管理员先在Agent Settings通过二次确认提高Hard Limit后，再由用户显式增加本Run预算；Hard Limit为null表示该维度当前未配置实例策略上限，`canIncrease=true`但仍须用户显式确认本Run增量并通过safe-integer/真实能力校验；不得自动标failed。awaiting_budget期间可以保存输入/查看结果，但scheduler不claim新的model/tool/delegation。

ContextPlan={messages,toolSchemas,estimatedInputTokens,reservedOutputTokens,droppedSections,sourceRanges,contextEpoch}；compose先计固定安全/currentInput的**单次模型上下文容量**，连最低安全输入都放不下时才返回CONTEXT_BUDGET_EXCEEDED；这不是Run软预算耗尽，不能靠无限增加Run token budget绕过model window；再按任务计划、近期final、Recall、Skill分配。compressRange(threadId,from,to,sourceHash)只处理不可变已提交entries，摘要不写回原输入。重复只读缓存TTL≤5秒且工具没有未知副作用。

<a id="i4"></a>

## 4. 持久化、迁移与原子提交

使用现有DatabaseAdapter/单连接/BEGIN IMMEDIATE；不在Agent另建连接或module migration框架。schema registry与sqlite-migrations分别消费新库和升级DDL。迁移版本选择当前registry最大值后连续编号，编号由实现任务从仓库读取，不硬写可能冲突的全局版本；Agent内部schemaRevision=1/2/3对应下列分期。迁移完成前HTTP未ready，失败回滚并拒绝Agent就绪，不半启用。

数据库DDL和事务算法在下一小节；这些SQL是设计的可执行schema，不是在本轮创建生产表。字段未标nullable的一律NOT NULL；epoch字段INTEGER，JSON TEXT均CHECK(json_valid)。所有ID/配置revision在API映射camelCase，不能暴露SQL列名。

### 4.1 DDL：Phase 1（schemaRevision 1）

```sql
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
```

ai_thread_entries就是统一Ledger，不再维护独立ai_inputs/ai_messages各自sequence，也不建立ai_events第二事件表。一期memory仅可读取published（内置seed或用户明确导入的资料），API不提供自动写入；FTS5作为该表的可选检索索引，build/startup探测，不可用时限定scope后LIKE、最多扫描最近1000条。

### 4.2 DDL：Phase 2（schemaRevision 2）及Phase 3（revision 3）

```sql
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
 recipe_revision TEXT NOT NULL, runtime_digest TEXT NOT NULL, catalog_revision TEXT NOT NULL,
 pack_refs_json TEXT NOT NULL CHECK(json_valid(pack_refs_json)),
 runner_plugins_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(runner_plugins_json)), generation INTEGER NOT NULL DEFAULT 1,
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
 frontend_entry TEXT, backend_entry TEXT, runner_entry TEXT,
 skill_files_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(skill_files_json)),
 status TEXT NOT NULL CHECK(status IN ('verified','installed','failed','removed')),
 installed_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY(app_id,version)
);
CREATE TABLE agent_integrations (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('mcp','acp')), configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
 protected_credential TEXT, schema_hash TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,app_id) REFERENCES agent_apps(user_id,app_id)
);
```

Environment provisioning_ref_json仅Infrastructure读取，含opaque controller references，不序列化给frontend。资源quota由Agent Settings Hard Limits定义；Controller journal记录实际reserve/usage并执行同一份Hard Limits，不维护另一套隐藏资源上限。Controller必须只声明当前部署真实具备的sandbox/resource capability；现实现已强制filesystem/process/network namespace与timeout边界，但CPU/memory/PID硬内核限制未接入前不得宣称已由cgroup执行。

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

```ts
type ToolDescriptor = {
  name: string;
  version: string;
  description: string;
  inputSchema: JsonValue;
  riskClass: 'read' | 'mutate' | 'destructive';
  capability: string;
};
type TargetFingerprint = {
  connectionId: number;
  targetIdentity: string;
  endpoint: string;
  sshHostKey: string;
  loginUser: string;
  configurationHash: string;
};
type Precondition = {
  kind: 'fileHash' | 'metadata' | 'serviceState' | 'environmentGeneration';
  key: string;
  observedValue: JsonValue;
};
type ToolInspection = {
  toolName: string;
  toolVersion: string;
  normalizedArguments: JsonValue;
  target: TargetFingerprint | { environmentId: string; generation: number };
  resourceKeys: string[];
  risk: 'read' | 'mutate' | 'destructive' | 'forbidden';
  mutation: boolean;
  operationHash: string;
  operationHashVersion: 1;
  preconditions: Precondition[];
  policyRevision: number;
  inputRevision: number;
};
type ToolContext = Scope & {
  actor: Actor;
  runId: string;
  agentRuntimeId: string;
  stepId: string;
  signal: AbortSignal;
  deadlineAt: number;
  maxOutputBytes: number;
};
type RawToolResult = {
  exitCode: number | null;
  confirmedStopped: boolean;
  output: AsyncIterable<Uint8Array>;
  data?: JsonValue;
  evidenceRefs: string[];
};
type ToolResult = {
  ok: boolean;
  summary: string;
  data?: JsonValue;
  artifactRefs: string[];
  truncated: boolean;
  outcome: 'confirmed' | 'unknown';
  errorCode?: string;
  verification: VerificationResult;
};
interface AgentTool {
  descriptor: ToolDescriptor;
  inspect(input: JsonValue, ctx: ToolContext): Promise<ToolInspection>;
  execute(inspection: ToolInspection, ctx: ToolContext): Promise<RawToolResult>;
  verify?(inspection: ToolInspection, result: ToolResult, ctx: ToolContext): Promise<VerificationResult>;
}
```

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

| JSON输入                                                   | canonical UTF-8文本                                        | 输出                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| {}                                                         | {}                                                         | v1:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a |
| {"b":2,"a":1}                                              | {"a":1,"b":2}                                              | v1:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777 |
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

`acquireMany(owner:{type,id},resourceKeys:string[],mode,ttl=30):Promise<Lease[]>` 保留为同 mode convenience API；底层统一落到 `acquireResources(owner,[{resourceKey,mode}],ttl)`，后者允许一次事务中混合 read/write claim：
排序去重并合并重复 key（write 优先）→确保 resource_fences 行→把过期且可能仍运行的 mutation 标 quarantine→剔除可确认安全的 expired leases→检查 quarantine→查询活动锁（read 只冲突 write，write 冲突全部）→每 key 分配 nextFence 并 insert lease。整个 claim set 单事务提交，任何 key 冲突整笔回滚，不先拿部分锁造成死锁。

Agent 现有读/写仍取 target 根锁，调用点无需迁移：读为 root read，修改为 root write；不同 App/Agent 争同目标继续互斥。owner 同 key 嵌套/读升级写仍拒绝 `LEASE_REENTRANT`。`MutationGuardRequest.ownerId` 是稳定 actor identity；并发长 mutation 可显式提供 `leaseOwnerId` 作为具体持锁者，使同一 Workspace 的独立操作通过普通 lease conflict 规则协调，而不是被误判成 actor 自身嵌套。

Workspace 对写集合可证明的长 mutation 使用 mixed-mode：upload/compress 获取 `connection:<id>` read + canonical `connection:<id>:file:<path>` write；不同目标文件可并行，同目标写互斥，Agent 的 connection root write 仍会阻塞全部 Workspace mutation。decompress、copy/move、upload directory prepare 等不能预先穷举完整写集合的操作继续获取 connection root write。所有 remote path 在 I/O 与 resourceKey 构造前使用 Platform `normalizeAbsoluteRemotePath`，避免 `/a/../b` 之类不同字符串映射到同一远端对象却绕开 lease。

renew(leaseIds,owner,ttl)只更新owner+fence+未过期行且无撤销条件，更新行数必须全部匹配，否则整批失败。每10秒续期，失败立即停止新副作用，发送abort并等待核实。mixed-mode claim 中的协调 read lease 也标记 active_mutation；未知结果同时 quarantine root coordination key 与精确写 key，不能因为 read mode 就丢失 target 级故障隔离。release幂等但只能本holder释放；quarantine只有reconcile确认或显式用户证据解决后CAS删除。lease过期不自动解除quarantine。

Workspace MutationGuard与Agent共用同一个lease实例，通过Platform的MutationGuardPort注入。withLease在开始work前记录 holder operation active，结束确认后清理；terminal completed/failed/cancelled 只有在 guard settle/release 后才对浏览器发布，避免“UI 已完成但 lease 仍持有”的竞态。原始PTY/外部SSH不加入此保证，产品UI明确边界；新读探测发现冲突时不覆盖。

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

| 路由（前缀 /api/v1）                                                            | Input → Output；期号 / Controller                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET /agent/apps                                                                 | 无→AppSummaryView[]；P1 host.controller                                                                                                                                                                                                                                                                                                                                                                |
| PATCH /agent/apps/:appId                                                        | {enabled,expectedVersion}→AppRecord；P1；停用202直到排空                                                                                                                                                                                                                                                                                                                                               |
| GET/PATCH /agent/settings                                                       | GET→requestedSettings/effectiveSettings/hardLimits/runtimeCapabilities/availability/revision；PATCH={patch:{section:{...}},expectedVersion}→同结构；P1 host.controller                                                                                                                                                                                                                                 |
| GET/PUT /agent/target-denylist                                                  | put={connectionIds:number[],reason,expectedRevision}→revision/list；P1，配置只影响Agent工具                                                                                                                                                                                                                                                                                                            |
| GET /agent/summary                                                              | 无→HostSnapshot；P1 host.controller                                                                                                                                                                                                                                                                                                                                                                    |
| GET /agent/events?cursor=0                                                      | Host SSE；P1 events.controller                                                                                                                                                                                                                                                                                                                                                                         |
| GET /agent/environments/availability                                            | →{available:false,reason:'phase_not_enabled'或'daemon_unavailable',recipes:[],packs:[]}；P1真实消费者；P2返回Runner/engine探测结果                                                                                                                                                                                                                                                                     |
| GET /agent/environments/catalog                                                 | →{catalogRevision,recipes,packs,runtimeCapabilities}；P2；每个 Pack 显示 available/enabled/installed/inUse/deprecated、digest、diskBytes 与 arch                                                                                                                                                                                                                                                       |
| GET /agent/environments/storage                                                 | →state/packs/cache/runtime/quarantine/sandboxOverhead互斥用量与reclaimable；P2                                                                                                                                                                                                                                                                                                                         |
| POST /agent/environments/setup/preview、/confirm                                | 初始化/补装所选Recipe与多个Pack版本；confirm→202 EnvironmentCommandView；P2                                                                                                                                                                                                                                                                                                                            |
| POST /agent/environments/packs/:familyId/:versionId/install                     | →202 PackInstallCommand；安装/预拉取精确 Environment Pack，不创建 Environment                                                                                                                                                                                                                                                                                                                          |
| POST /agent/environments/packs/:familyId/:versionId/uninstall/preview、/confirm | preview 引用/默认版本/可释放空间；confirm 卸载精确 Pack，不影响同 family 其他版本；active 引用返回409 ENVIRONMENT_PACK_IN_USE                                                                                                                                                                                                                                                                          |
| POST /agent/environments/runtime-cleanup/preview、/confirm                      | preview active jobs/运行资源/预计释放空间；confirm 只清 runtime/container/network/job等运行残余，保留Pack/cache/Settings/Artifact；未知副作用返回PARTIAL_RESTORE                                                                                                                                                                                                                                       |
| POST /agent/environments/cache-cleanup                                          | →202 EnvironmentCommandView；只清安全可重建cache，不卸载Pack、不清active runtime；P2                                                                                                                                                                                                                                                                                                                   |
| POST /agent/environments/settings/reset/preview、/confirm                       | 恢复发行默认Recipe/版本/资源/网络配置；必须二次确认；P2                                                                                                                                                                                                                                                                                                                                                |
| GET /agent/environments/commands/:commandId                                     | →queued/running/succeeded/failed/partial/unknown + stage/progress/result；所有安装/卸载/setup/cleanup长命令可断线后按commandId恢复；P2                                                                                                                                                                                                                                                                 |
| GET/POST /agent/ai/providers                                                    | POST ProviderInput→ProviderView（201）；P1 ai.controller                                                                                                                                                                                                                                                                                                                                               |
| PATCH/DELETE /agent/ai/providers/:id                                            | PATCH ProviderInput子集+expectedVersion，DELETE expectedVersion query→安全View/tombstone；P1                                                                                                                                                                                                                                                                                                           |
| POST /agent/ai/providers/:id/test                                               | {modelId}→{ok,latencyMs,usage,errorCode?}；P1                                                                                                                                                                                                                                                                                                                                                          |
| GET /apps/:appId/agent-definitions                                              | →静态贡献的定义/模型能力要求；P1 run.controller                                                                                                                                                                                                                                                                                                                                                        |
| GET/POST /apps/:appId/threads                                                   | POST {title?:string}→ThreadView；不自动创建Run；P1                                                                                                                                                                                                                                                                                                                                                     |
| GET /apps/:appId/threads/:id                                                    | →ThreadView+latestRunId（用于刷新恢复）；P1                                                                                                                                                                                                                                                                                                                                                            |
| GET /apps/:appId/threads/:id/entries                                            | page→LedgerEntryView[]；P1                                                                                                                                                                                                                                                                                                                                                                             |
| POST /apps/:appId/runs                                                          | CreateRunCommand去command（幂等从header）→201 RunView，Location指snapshot；P1                                                                                                                                                                                                                                                                                                                          |
| GET /apps/:appId/runs/:id                                                       | →RunSnapshot含eventCursor及分页ref；P1                                                                                                                                                                                                                                                                                                                                                                 |
| GET /apps/:appId/runs/:id/events?cursor=0                                       | durable+transient SSE；P1                                                                                                                                                                                                                                                                                                                                                                              |
| POST /apps/:appId/runs/:id/inputs                                               | {text,artifactRefs,expectedVersion}→202 {inputId,sequence,runVersion}；P1                                                                                                                                                                                                                                                                                                                              |
| POST /apps/:appId/runs/:id/budget                                               | {scope?:'run'                                                                                                                                                                                                                                                                                                                                                                                          | 'delegation'                                                                          | 'mailbox',refId?,increase:{...},expectedVersion}→RunView；P1只启用scope=run（maxRunTokens/maxRunSteps/maxActiveExecutionSeconds/maxCostMicros），P3增加delegation（maxTokens/maxSteps）与mailbox（maxMessages/maxBytes）；都只提高本次Run内对应软预算，幂等且不得越当前Agent Settings Hard Limit |
| POST /apps/:appId/runs/:id/cancel                                               | {expectedVersion}→202 RunView或已终态200；P1                                                                                                                                                                                                                                                                                                                                                           |
| POST /apps/:appId/runs/:id/resume                                               | {checkpointId,expectedVersion}→201新RunView；P2                                                                                                                                                                                                                                                                                                                                                        |
| DELETE /apps/:appId/runs/:id                                                    | ?expectedVersion=N→202 command或409仍active/被引用；P1                                                                                                                                                                                                                                                                                                                                                 |
| GET /agent/files                                                                | user-scoped Artifact Library cursor page；支持 q/source/appId/threadId/runId/mediaType/retained/reclaimable 过滤，返回安全 metadata+source，不返回正文；P1 host.controller                                                                                                                                                                                                                             |
| GET /agent/files/storage                                                        | →{totalBytes,retainedBytes,protectedBytes,reclaimableBytes,stagingBytes,unavailableBytes}；P1 host.controller                                                                                                                                                                                                                                                                                          |
| POST /agent/files/cleanup/preview、/confirm                                     | 用户级可回收 Artifact 清理；preview 返回数量/字节/保护对象摘要，confirm 重新校验引用并允许 partial；P1 host.controller                                                                                                                                                                                                                                                                                 |
| POST /agent/files/:id/attach                                                    | {targetAppId,threadId,runId?,role:'input',expectedVersion?}→ArtifactRef/link；仅用户显式动作，跨App时服务端建立grant/link，App SDK不可调用；P1 host.controller                                                                                                                                                                                                                                         |
| POST /apps/:appId/artifacts                                                     | {name,mediaType,declaredBytes,runId?}→201 {artifactId,uploadUrl,expiresAt}；P1 artifact.controller                                                                                                                                                                                                                                                                                                     |
| PUT /apps/:appId/artifacts/:id/content                                          | raw stream+Content-Length+CSRF→ArtifactRef；P1，≤50MiB                                                                                                                                                                                                                                                                                                                                                 |
| GET /apps/:appId/artifacts/:id                                                  | →metadata或410；P1                                                                                                                                                                                                                                                                                                                                                                                     |
| GET /apps/:appId/artifacts/:id/content                                          | Range/If-None-Match→200/206/304；P1，单range≤8MiB；无Range默认有界前段                                                                                                                                                                                                                                                                                                                                 |
| PATCH /apps/:appId/artifacts/:id                                                | {retained,expectedVersion}→ArtifactRef；P1                                                                                                                                                                                                                                                                                                                                                             |
| DELETE /apps/:appId/artifacts/:id                                               | ?expectedVersion=N→202 tombstone；被保护引用409；P1                                                                                                                                                                                                                                                                                                                                                    |
| POST /apps/:appId/approvals/:id/resolve                                         | {decision:'approved'                                                                                                                                                                                                                                                                                                                                                                                   | 'denied',operationHash,expectedVersion}→ApprovalView；P2 approval.controller          |
| POST /apps/:appId/reconciliations/:toolCallId                                   | {decision:'verify'                                                                                                                                                                                                                                                                                                                                                                                     | 'acknowledgeUnknown',evidenceRefs,expectedVersion}→reconciliation；P2；后者需危险确认 |
| POST /apps/:appId/runs/:runId/environment-groups                                | {environments:[{recipeId,versions?:{familyId:versionId},runnerPluginIds?:string[],limits}],retained}→202 GroupView；Backend 从 Run 解析 root agentRuntimeId，不接受浏览器伪造 runtime identity；需 environment.manage；幂等重放先返回原 group，同 runtime 已有非 deleted/failed group 时拒绝；缺省版本冻结当时 family default；Runner Plugin 逐个解析成精确 target snapshot；P2 environment.controller |
| GET /apps/:appId/runs/:runId/environment-groups                                 | →GroupView[]；`?runtime=root` 时由 Backend 解析 root runtime 并只返回该 runtime 的 groups；P2                                                                                                                                                                                                                                                                                                          |
| GET /apps/:appId/environment-groups/:groupId                                    | →GroupView+EnvironmentView[]；P2                                                                                                                                                                                                                                                                                                                                                                       |
| POST /apps/:appId/environments/:id/actions                                      | {action:'start'                                                                                                                                                                                                                                                                                                                                                                                        | 'stop'                                                                                | 'restart'                                                                                                                                                                                                                                                                                        | 'delete' | 'setNetwork' | 'resize',expectedVersion,parameters?,confirmedOperationHash?}→202 ControlCommandView或ApprovalView；P2 |
| GET /apps/:appId/environment-commands/:id                                       | →pending/running/succeeded/failed/unknown；P2                                                                                                                                                                                                                                                                                                                                                          |
| POST /apps/:appId/plugin-intents                                                | {receiverAppId,intentId,input,artifactRefs,confirmed:true}→intent receipt；P3                                                                                                                                                                                                                                                                                                                          |
| POST /agent/plugins/stage、/verify、/install                                    | {artifactRef或stageId,expectedVersion?}→Stage/InstalledView；P3 plugin.controller                                                                                                                                                                                                                                                                                                                      |
| POST /agent/plugins/:appId/upgrade、/uninstall                                  | {version?,deleteData:false,expectedVersion}→command；P3                                                                                                                                                                                                                                                                                                                                                |
| GET/POST /apps/:appId/integrations                                              | configuration（MCP/ACP）→安全记录；P3                                                                                                                                                                                                                                                                                                                                                                  |
| PATCH/DELETE /apps/:appId/integrations/:id                                      | expectedVersion+配置/删除→安全View；P3                                                                                                                                                                                                                                                                                                                                                                 |
| POST /apps/:appId/memories/proposals、/memories/:id/review                      | proposal或{decision,expectedVersion}→MemoryView；P3                                                                                                                                                                                                                                                                                                                                                    |
| Subagent设置/创建/消息                                                          | §10定义的准确路由；P3 subagent.controller                                                                                                                                                                                                                                                                                                                                                              |

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

```nginx
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
```

仅在apps prefix内部增加content上传嵌套location（准确匹配 /api/v1/apps/<appId>/artifacts/<uuid>/content，PUT）：client_max_body_size 50m、proxy_request_buffering off、client_body_timeout 120s，继承/重复安全proxy headers；其他Agent JSON仍1MiB。Backend在raw PUT路由验证Content-Length/CSRF/ownership后才消费stream。Backend SSE写Cache-Control:no-store、X-Accel-Buffering:no，不压缩；代理不添加Connection:upgrade。

所有Agent JSON/SSE/Artifact仍保持现有安全headers。安装式 Plugin Frontend 使用 Frontend 主容器第二 listener 的独立 origin，并在该 origin 设置严格 CSP/frame-ancestors；Nexus CSP仅增加frame-src该精确origin，不删除全局X-Frame-Options DENY、不开放通用CORS。第二 listener 不代理 Nexus API/session；Runner Controller 通道也不暴露到浏览器，不接受浏览器cookie代替内部认证 token。

<a id="i8"></a>

## 8. 前端工程与交互状态

### 8.1 文件、函数与可见状态

Frontend根=packages/frontend/src/features/agent/。

| 文件                                                                                                          | 实施契约                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| public.ts                                                                                                     | lazy export `AgentSurfaceHost`、export `AgentSettingsPanel` 与受限 `agentApi` 类型/函数；供 App.vue 和现有 SettingsPage 从 public 入口组合，不导独立 Agent 页面 route                                                                   |
| host/AgentSurfaceHost.vue                                                                                     | 读取现有 auth public facade；维护 Host summary/SSE、用户切换、layout 持久化与 session dispose；登出 abort Agent 请求/订阅，不创建第二套 auth store                                                                                      |
| host/AgentLauncher.vue                                                                                        | 单击立即open、6px拖动阈值、pointercancel/keydown；App选择仅在Hub内完成。角标取HostSummary，不取App store                                                                                                                                |
| host/AgentHubWindow.vue                                                                                       | bounds拖动/resize/clamp/maximize/minimize/close，非模态；标题区单选 App；Files lazy-load；内置 Operations 直接挂载，安装式 App 统一进入 `PluginAppFrame`，不靠运行时组件名映射                                                          |
| host/AgentAppSwitcher.vue                                                                                     | 常驻Hub标题区/会话栏顶部；授权App目录，**单选**当前App、最近项、搜索/启用状态/键盘选择；一个Thread/Run只归属一个App，不做多App组合执行                                                                                                  |
| host/PluginAppFrame.vue                                                                                       | 获取 Backend 提供的显式 Frontend target descriptor，验证 appId/sandbox/protocolVersion/sdkVersion 后挂 iframe；失败只影响当前 Plugin surface                                                                                            |
| host/app-bridge.ts、plugin-sdk.ts                                                                             | MessageChannel/nonce/source/seq/size/timeout Host bridge；正式 Frontend SDK V1 当前仅 `host.appInfo` 与 AppStorage get/put/delete                                                                                                       |
| host/window-manager.ts                                                                                        | openHub({restoreRecent:true})、switchApp({appId,threadId?})、minimizeHub()、closeHub()、setBounds(bounds)                                                                                                                               |
| host/surface-session.ts                                                                                       | maintain perAppViewState Map；activateApp(appId)、restoreThread(appId)、pauseDetail(appId)、disposeSession()；切App只暂停旧App详细订阅，不cancel其Run/Environment，generation避免旧响应覆盖                                             |
| api/agent-api.ts                                                                                              | JSON request/CSRF/幂等key封装，保留原Axios配置                                                                                                                                                                                          |
| api/agent-events.ts、sse-parser.ts                                                                            | §7 fetch/SSE有界解析、独立AbortSignal                                                                                                                                                                                                   |
| runtime/run-facade.ts                                                                                         | 以明确 `appId` 绑定 Thread/Run/Approval/Subagent/Checkpoint API；供 Operations 调用，不暴露可变全局 store                                                                                                                               |
| runtime/TaskRail.vue、TaskDetailDrawer.vue、EnvironmentWorkspacePanel.vue、ToolTimeline.vue、ApprovalCard.vue | 当前 Run 预算/PlanItem/工具/审批摘要与按需详情；PlanItem/Run/verification 状态走 i18n；TaskDetail 内提供 root Environment、显式 Runner Plugin target、目标 Workspace ACL 与 Workspace↔Artifact 产品入口，不把 Runtime Step 当用户计划项 |
| runtime/SubagentTree.vue、SubagentCard.vue、MessageExchangePanel.vue                                          | Subagent participant 树、状态、预算、证据及显式消息交换视图                                                                                                                                                                             |
| settings/AgentSettingsPanel.vue                                                                               | 由现有 Nexus SettingsPage 的 Agent tab 挂载；包含总开关和各分区，展示requested/effective/Hard Limits/runtime capabilities/availability；不创建Agent独立设置页/路由                                                                      |
| settings/AgentFeatureSettings.vue、AppManagementSettings.vue                                                  | 总开关与App enabled/grant/health管理；关闭Agent走Host quiesce，停用单App只排空该App；两者语义分开                                                                                                                                       |
| settings/HardLimitsSettings.vue                                                                               | 展示/编辑所有可配置Hard Limits、当前usage/runtimeCapabilities；提高值必须preview→二次确认→confirm，固定guardrail只读                                                                                                                    |
| settings/ModelProviderSettings.vue                                                                            | Provider/Model/credential/私网例外；密钥输入与显示分离                                                                                                                                                                                  |
| settings/PerformanceSettings.vue                                                                              | Runtime current executing/requested/effective/hard max 与model并发；model默认Auto跟随Runtime，允许向下调并显示排队影响                                                                                                                  |
| settings/BudgetContextSettings.vue                                                                            | Run token/step/active-time/cost软预算、context/output容量、timeout、Recall及“耗尽后询问增加”说明                                                                                                                                        |
| settings/SubagentSettings.vue                                                                                 | 三期delegation深度/profile模型与子预算；不显示历史累计数或独立child并发，Runtime并发统一去Performance设置                                                                                                                               |
| settings/StorageArtifactSettings.vue                                                                          | Artifact单对象/Run/全局配额、TTL、已用量；min free disk只读                                                                                                                                                                             |
| settings/SafetyNetworkSettings.vue                                                                            | denylist、Provider私网例外、capability入口；不可关闭的hard deny只读解释                                                                                                                                                                 |
| settings/SystemGuardrails.vue                                                                                 | 只读显示event batch/commit queue/SSE/transient策略和数据库压力，不允许普通用户修改                                                                                                                                                      |
| ai/AgentConversation.vue、ConversationMessage.vue                                                             | conversation-first 主视图、ledger/streaming message 展示与唯一 Composer；Run 执行/审批/预算等待时仍允许追加输入                                                                                                                         |
| files/ArtifactLibraryView.vue                                                                                 | Hub 长期 Files/Artifact Library 入口；分页/虚拟列表、来源/类型/retained 状态、下载/retain/delete/cleanup 等用户级文件管理                                                                                                               |
| files/ArtifactPicker.vue                                                                                      | Composer 附件选择器；跨 App Artifact 使用现有显式 attach/grant，不因用户级文件库可见而扩大当前 App capability                                                                                                                           |
| apps/operations/OperationsView.vue                                                                            | 内置 `nexus.operations` conversation/Run surface；使用 `createAgentRunFacade(appId)`，组合 AgentConversation、TaskRail、Subagent/Approval 详情                                                                                          |
| settings/EnvironmentSettings.vue                                                                              | 单一长期 Environment Manager；availability/catalog/Pack setup/uninstall/storage/runtime cleanup/settings reset 均在同一设置模块，不维护拆散的第二套 Environment store                                                                   |
| i18n/zh-CN.json、en-US.json、ja-JP.json                                                                       | agent命名空间、三语同键；不复制全局样式                                                                                                                                                                                                 |

Frontend Agent 不维护第二套认证或跨 feature 私有 store：`AgentSurfaceHost` 只从 auth 的 public facade 读取当前会话，并通过 Agent API/SSE 与 Backend 通信。窗口/每 App 轻量 presentation state 分别集中在 `window-manager.ts` 与 `surface-session.ts`；read-only diagnostics 仍通过 Backend capability，不让前端 Agent 绕过 Host 直接驱动 Workspace 内部对象。

### 8.2 窗口与会话规则

Hub window state 由 `window-manager.ts` 集中维护：`status/bounds/maximized/activeAppId/recentAppIds/hubView/launcherPosition`；每 App 的 `threadId/draft/scrollAnchor/selectedTaskId/hubView` 轻量会话态由 `surface-session.ts` 单独维护并带 navigation generation。Agent 没有独立 page route，也不在 Hub 内复制 Settings/Environment Manager。Launcher `openHub` 恢复最近 App；`AgentSurfaceHost` 在 Host summary 更新时优先保持当前 enabled App，否则选 Operations/首个 enabled App。AppSwitcher 单选切换时只 pause 旧 detail generation，不调用 cancel/quiesce，不改变 Run/Environment/Subagent。Hub 对 `nexus.operations` 明确挂 `OperationsView`，其他已授权安装式 App 明确挂 `PluginAppFrame`；不通过任意组件名/资源 key 动态映射。

Launcher不使用延迟点击计时器：primary pointerup在未超过6px拖动阈值时立即openHub；Enter/Space同样立即恢复最后App并ignore repeat。App选择只在Hub内`AgentAppSwitcher`完成，移动端也使用同一页内选择器。关闭/minimize/switchApp均不得调用cancelRun、环境stop/delete或Subagent cancel；后台App继续由scheduler执行，Host summary保持订阅。取消Run按钮是唯一显式取消入口之一，并独立确认显示将影响的子任务和未知副作用警告。

布局默认1080×700，min640×420但视口不足时以可视区域为上限；top留原导航高度，不hardcode旧header像素。宽<1200折叠详情，<768全宽sheet；visualViewport.resize时clamp并让Composer避让keyboard。App内容load failure可retry、回Switcher，不使整个Shell error。

Conversation 与执行状态分层：当前 `OperationsView` 组合唯一 `AgentConversation` 与右侧 `TaskRail`，TaskRail 显示当前 Run 的预算/typed PlanItem/审批，并列出当前 App 其他活跃 Run 的紧凑摘要；PlanItem/Run/verification 状态与依赖/证据标签统一走 Agent i18n。其他 App 的 Run 不混入当前 TaskRail，但 Backend 仍继续执行并由 Host summary 更新 Launcher。`TaskDetailDrawer` 按需加载 snapshot/checkpoint/Subagent/message 详情，不替换 Thread，并挂载 `EnvironmentWorkspacePanel` 作为 root Run 的受控产品入口：列表使用 `?runtime=root` 由 Backend 绑定 root runtime；创建请求只发送 Recipe、显式 `runnerPluginIds` 与 retention，浏览器不提供 runtime id。同一 runtime 最多一个状态非 `deleted/failed` 的活跃 EnvironmentGroup，repository 在幂等重放之后执行唯一性检查。Environment create/start/restart 与 Workspace ACL 写入重新检查 `environment.manage`，stop/delete 保留 teardown 路径；Workspace↔Artifact bridge 继续分别检查 `environment.execute + artifacts.write/read`。Frontend 不持有 Runner 内部对象，Environment 详情直接展示冻结的 plugin/version/sdkVersion/protocolVersion/packageHash/entry。Run 处于 running/awaiting_approval/awaiting_budget 时输入仍可追加；执行事实始终以服务端 Run/Ledger/Event 为权威，Frontend 不自行推进 Run/Approval 状态。

### 8.3 持久偏好、授权、焦点

localStorage key=nexus.agent.surface.v1.user.<userId>；数据schema={schemaVersion:1,bounds,maximized,launcherPosition,recentAppIds}，8KiB上限，未知字段丢弃，NaN/超视口bounds修正。刷新仅恢复appIds/布局，最近会话通过threads?limit=1按updatedAt获取；不保存thread/run/private draft。保存latest-value-wins，flush布局在页面隐藏/卸载，不发送运行数据。

当前没有独立 `run.store`。`OperationsView` 以局部 view state + `run-facade.ts` 读取服务端 snapshot/ledger，并用独立 AbortController 消费 Run SSE；`model.delta` 只进入临时 `streamingText`，`message.final` 后清空并刷新 durable ledger，不能把半段 delta 当 final。审批卡片提交只调用 Backend resolve，Frontend 不自行把 requested 状态改为 approved；冲突/重连重新以服务端 snapshot 为准。

长会话继续以 Backend 稳定 cursor/sequence 分页为事实来源；当前 Frontend 已分页读取 ledger，后续若基准显示 DOM/内存压力，再在 `AgentConversation` 内引入有界 page cache/虚拟化，不新增另一套 Run store 或改变服务端 ledger 语义。任何虚拟化实现都必须保持 prepend anchor、滚动不中断输入以及 durable cursor 可重取。

当前 SSE `model.delta` 使用轻量临时字符串，`message.final` 后回到 durable ledger；后续性能增强可以把可见 delta 批量到 animation frame，但不得改变 final/durable 边界。TaskRail 只消费 Run/Plan projection，不遍历完整 ledger 推导计划。性能优化若继续实施，以真实浏览器基准和现有 E2E 组为依据，不能为了性能新增平行状态真相源。

模态presence仅影响交互/焦点，不取消任务；键盘只由当前focus owner处理，Agent不接管全局Ctrl组合或浏览器后退。原RDP modal/外观确认在Agent上方；原生全屏不退出。logout触发onSessionLost→Abort全部SSE/request、清private store/draft/tickets、卸载iframe、关闭MessagePort和Hub；保留layout不含敏感数据，其他Workspace的清理由既有auth流程负责。

<a id="i9"></a>

## 9. Workspace Dev Environment、Runner Sandbox 与多版本工具控制（Phase 2）

### 9.0 服务角色与持续管理

P2 增加可选的 `nexus-agent-runner` 主服务，但 canonical Linux 部署改为专用 **host service**：**不挂 `/var/run/docker.sock`，不运行 dockerd，不使用 dockerode，不为 Workspace Environment、临时 job 或 Plugin 创建子容器**。Runner 内部由 Controller + Sandbox Manager + Pack installer + Toolchain Store + job protocol + cleanup/reconcile + quota + space reporter 完成 Workspace Dev Environment 管理。

先前把 Runner 放进 Compose 并追加 `SYS_ADMIN + NET_ADMIN` 的实验已经证明会继续撞到 Docker 默认 AppArmor 的 mount propagation 边界（`bwrap: Failed to make / slave: Permission denied`）。正式方案不继续堆叠 capability，也不使用 `privileged` / `apparmor=unconfined` 放宽整个 Runner。`SandboxManager` 的真实 job 与 availability probe 仍共用同一 isolation argument builder，bubblewrap payload 显式 `--cap-drop ALL`；sandbox probe 失败时 `/v1/availability` 返回 degraded + 稳定 `sandbox_*` reason，不能回退为裸 Node child process。Backend 容器仅通过 host-gateway + Controller token 访问 host Runner。

当前部署关系为：

```text
frontend container
├─ Nexus Frontend :80
└─ verified Plugin Frontend origin :8081

backend container
├─ Nexus Backend Core
└─ Backend Plugin process sandboxes
       │
       └─ authenticated Controller HTTP via host-gateway

nexus-agent-runner host service
├─ Runner Core / Controller
├─ immutable multi-version Tool Store
└─ Workspace N
   ├─ stable project filesystem
   ├─ Environment generation / pinned tool profile
   ├─ core/task sandbox
   ├─ explicit Runner Plugin sandbox(es)
   └─ per-plugin logical workspaces
```

Frontend 的 `EnvironmentSettings.vue` 仍是长期 Environment Manager。页面状态为 `unavailable | uninitialized | ready | degraded`；初始化、Pack 管理、资源/网络策略、storage、运行 Environment、cleanup/reset 都在同一入口。Runner 未启用或 sandbox primitive 不可用时 Core/SSH/RDP/Backend Docker capability 继续可用，Environment availability 明确原因。

真实 Docker 管理不属于 Runner。Agent 需要操作用户目标机器 Docker 时，继续使用 Backend 的 `machine.docker.*` capability，经 manifest grant → Policy → Approval → Lease/MutationGuard → `RemoteDockerService`；这条链不向 Runner 或 Plugin 暴露 Docker socket。

### 9.1 Runner 文件、数据布局、Catalog 与 Pack

`packages/agent-runtime/` 的 Controller 关键文件固定为：

| 文件                                                  | 职责                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `controller/sandbox-engine.ts`                        | Workspace Environment generation/job 生命周期 facade，不提供 Docker 方法                   |
| `controller/sandbox-manager.ts`                       | Linux sandbox filesystem/process/network namespace 组装；稳定 Workspace 与 generation 分离 |
| `controller/plugin-runner-runtime.ts`                 | Workspace Environment generation 内显式 Runner Plugin target 生命周期                      |
| `plugin-ipc.ts`                                       | Runner protocol v2 framing；bounded JSON control + raw binary frame，不使用 Base64 IPC     |
| `controller/workspace-broker.ts`                      | stable target workspace ACL、路径校验、同一底层文件访问；Host stream handle/原子写         |
| `controller/environment-catalog.ts`                   | Workspace profile、Tool Pack、`runtimeDigest` 读取/校验                                    |
| `controller/pack-installer.ts` / `toolchain-store.ts` | Tool Pack 下载、校验、原子只读安装与同 family 多版本 inventory                             |
| `controller/journal.ts` / `reconciler.ts`             | command/job/environment durable 对账与重启恢复                                             |
| `controller/cleanup-planner.ts` / `space-reporter.ts` | runtime/cache cleanup 与分类计量                                                           |
| `controller/quota-manager.ts`                         | Environment admission/resource policy                                                      |
| `worker/plugin-runner-sandbox.worker.ts`              | Runner Plugin target 进程内入口，只暴露 RunnerPluginSdk                                    |

`packages/agent-runtime` 构建 host Runner Controller；Linux host 必须提供受支持的 sandbox primitive（当前为 bubblewrap）。`scripts/docker/agent-runtime/Dockerfile` 不再是 canonical deployment path，不得借它恢复高权限 Runner-in-Docker 方案。Catalog 源暂位于 `scripts/docker/agent-runtime/catalog/`；`runtimeDigest` 表示 Runner sandbox ABI/runtime 的版本事实。Tool Pack 作为带 manifest/checksum 的 release/OCI artifact 发布，不使用 mutable latest 作为版本事实。

Runner 内部路径：

```text
/var/lib/nexus-agent-runner/state/       durable journal/inventory
/var/lib/nexus-agent-runner/packs/       durable immutable packs
/var/lib/nexus-agent-runner/cache/       reclaimable downloads/staging
/var/lib/nexus-agent-runner/runtime/     stable Workspace + Environment generation/job lifecycle data
/var/lib/nexus-agent-runner/quarantine/  unresolved ownership/side-effect data
/run/nexus-agent-runner/                 short-lived control-plane data only
```

Workspace 数据与 Environment generation 运行树分离：

```text
runtime/
  workspaces/<workspaceId>/
    .control/workspace-acl.json
    core/workspace/
      work/
      deps/
      build/
      browser/
      jobs/
      tmp/
    plugins/
      <pluginId>/workspace/
  environments/<workspaceId>/<generation>/
    .control/
      metadata.json
      state
```

`.control` 不进入任何 sandbox。Tool Pack 只读；项目 npm/pip/go 等依赖进入稳定 Workspace 的 `deps`/项目目录，不修改 Tool Pack。Tool Store key 为 `familyId/versionId/contentDigest`（digest 按 arch 解析）；同 family 多版本可同时 installed/enabled/inUse。不同 Workspace 冻结不同版本组合，切版本只替换目标 Workspace 的 Environment generation，不修改 `/usr/bin` 或其他 Workspace。

Environment generation 在 Backend DB 冻结 `runtime_digest + recipe_id + recipe_revision + catalog_revision + pack_refs_json + runner_plugins_json`。当前 `recipe_id=workspace-dev`；`kind=code` 暂作为兼容存储字段。`runner_plugins_json` 保存精确 `{pluginId,version,sdkVersion,protocolVersion,packageHash,entry}`，新建 Runner target 使用 `protocolVersion=2`；start/restart 使用该 generation 创建时事实，不根据当前安装状态重新猜测。工具版本或 Runner Plugin 版本变化都必须创建新 generation；旧 generation 不自动升级。

### 9.2 API、显式 Runner target 与 Workspace Grant

Frontend/Backend Environment API（前缀 `/api/v1`）包括：

| 路由                                                                                              | 作用                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /agent/environments/availability`                                                            | Runner + sandbox capability/原因                                                                                                                       |
| `GET /agent/environments/catalog`                                                                 | Recipe、Pack、`runtimeDigest` 与 installed/enabled/inUse 状态                                                                                          |
| `GET /agent/environments/storage`                                                                 | state/packs/cache/runtime/quarantine/sandbox-overhead 分类用量                                                                                         |
| `POST /agent/environments/setup/preview` / `confirm`                                              | Pack 准备与 Settings CAS                                                                                                                               |
| `POST /agent/environments/packs/:familyId/:versionId/install`                                     | 安装/预拉取精确 Pack                                                                                                                                   |
| `POST .../uninstall/preview` / `confirm`                                                          | 精确版本卸载及引用影响                                                                                                                                 |
| `POST /agent/environments/runtime-cleanup/preview` / `confirm`                                    | 清 Environment runtime 残余，不删 Pack                                                                                                                 |
| `POST /agent/environments/cache-cleanup`                                                          | 清可重建 cache                                                                                                                                         |
| `POST /agent/environments/settings/reset/preview` / `confirm`                                     | 恢复 Environment 设置默认值                                                                                                                            |
| `GET /agent/environments/commands/:commandId`                                                     | 查询持久 command 状态                                                                                                                                  |
| `GET /agent/apps/:appId/environments/:environmentId/workspaces/:targetPluginId/grants`            | 读取目标 workspace ACL                                                                                                                                 |
| `PUT /agent/apps/:appId/environments/:environmentId/workspaces/:targetPluginId/grants`            | 替换目标 workspace ACL；需 environment.manage                                                                                                          |
| `POST /agent/apps/:appId/environments/:environmentId/workspaces/:targetPluginId/artifacts/export` | 目标 workspace 文件流式转 durable Artifact；Runner transport hard cap 256 MiB，Artifact quota/limit 继续生效；需 environment.execute + artifacts.write |
| `POST /agent/apps/:appId/environments/:environmentId/workspaces/:targetPluginId/artifacts/import` | 当前 App Artifact 流式导入目标 workspace；Runner transport hard cap 256 MiB，Artifact quota/limit 继续生效；需 environment.execute + artifacts.read    |

Environment 创建不自动注入所有 enabled Runner Plugin，而使用明确接口：

```ts
type EnvironmentCreateSpec = {
  recipeId: string;
  versions?: Record<string, string>;
  runnerPluginIds?: string[];
  limits?: Partial<ResourceLimits>;
  network?: { mode: 'none' | 'allowlist'; hosts: string[] };
};

type RunnerPluginTarget = {
  pluginId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: 2;
  packageHash: string;
  entry: string;
};
```

Backend 对 `runnerPluginIds` 逐个解析：必须是当前用户已安装、activeVersion 匹配、enabled 且 manifest 明确声明 `targets.runner` 的 App；任一目标不可用即返回 `PLUGIN_RUNNER_TARGET_UNAVAILABLE`，不静默忽略。解析结果冻结并持久化到对应 Environment。产品创建路由不接受 `agentRuntimeId`，而由 `runs.rootRuntimeId(scope,runId)` 解析 root runtime；GET 列表可用 `?runtime=root` 取得同一 root scope。Repository 先处理 idempotency replay，再拒绝同 runtime 已存在状态非 `deleted/failed` 的 EnvironmentGroup，避免重试破坏幂等语义。Environment create/start/restart/setNetwork/resize 与 Workspace ACL 写入都会重新检查 `environment.manage`；stop/delete 作为安全收敛动作不依赖新增执行授权。

Runner command 关键字段：

```ts
type EnvironmentCommand = {
  commandId: string;
  deploymentId: string;
  userId: number;
  appId: string;
  runId: string;
  agentRuntimeId: string;
  groupId: string;
  environmentId: string;
  generation: number;
  action: 'provision' | 'start' | 'stop' | 'restart' | 'delete' | 'setNetwork' | 'resize';
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  packs: PackRef[];
  runnerPlugins: RunnerPluginTarget[];
  limits: ResourceLimits;
  network: { mode: 'none' | 'allowlist'; hosts: string[] };
  expectedVersion: number;
  operationHash: string;
  issuedAt: number;
  deadlineAt: number;
  nonce: string;
};
```

Backend/Runner 两端都验证 generation、Pack、runtimeDigest 和 `runnerPlugins` identity。普通 HTTP/Frontend/模型不能直接提供 package source path、sandbox binary 参数或真实 filesystem path。

Workspace Grant 是明确 target ACL，不用 map/key 推断：

```ts
type WorkspaceGrant = {
  targetPluginId: string;
  principalPluginId: string;
  path: string;
  permissions: ('read' | 'write' | 'list' | 'delete')[];
};
```

Backend 修改 ACL 前先确认 `userId + appId + environmentId` ownership，且 target/principal 都属于该 Environment 冻结 `runnerPlugins`；Runner 再次校验。caller 身份不从插件 payload 读取，由 Runner Plugin process instance 绑定。

### 9.3 Sandbox、Plugin Runtime 与资源边界

Workspace Environment core job 当前通过 `SandboxManager` 生成 bubblewrap 命令：新 PID/IPC/UTS/network namespace、最小只读 system runtime、独立 `/tmp`、只读精确 Tool Pack，并把当前 Workspace 的稳定 `core/workspace` bind 为 `/workspace`。Runner token/env 不进入 child。cwd 必须解析在 `/workspace` 内，禁止 `..`/symlink/跨 Workspace 逃逸。

host Runner 负责上述 namespace/mount construction；sandbox payload 显式 drop all capabilities。CI 的部署 smoke 必须在 GitHub Actions Linux host 安装 bubblewrap、直接启动 host Runner，再从 Compose Backend 经 host-gateway + 真实 Controller token 检查 availability，并至少执行一次 `provision → start → Tool-bound sandbox job → delete generation → provision next generation → 验证稳定 Workspace 文件仍存在 → delete`。这样同时验证 sandbox 部署和 Workspace 切换工具版本所依赖的 generation/filesystem 分离；不能用 Runner-in-Docker `privileged`/unconfined 作为替代。

Runner Plugin process 同样使用独立 bubblewrap sandbox：只读挂载自己的已验证 package 与 worker bootstrap，默认无网络，清空 env，**不 bind 真实 plugin workspace**。它只能经 local stdio IPC 使用。Runner protocol v2 不再使用 newline JSON + Base64 bytes，而使用 `plugin-ipc.ts` 的固定 16-byte header framing：`magic/type/reserved/requestId/payloadLength`；control payload 是最大 256 KiB 的 JSON frame，workspace read/write 数据是最大 16 MiB 的 raw binary frame，同一 `requestId` 做关联。未知 frame type、超长、截断、错 requestId 或版本不匹配均 fail closed：

```ts
workspace.read(targetPluginId, path);
workspace.write(targetPluginId, path, bytes);
workspace.list(targetPluginId, path);
workspace.stat(targetPluginId, path);
workspace.mkdir(targetPluginId, path);
workspace.rename(targetPluginId, path, destinationPath);
workspace.remove(targetPluginId, path);
```

`WorkspaceBroker` 从 process instance 绑定 `callerPluginId`。caller=target 时默认访问自己的 workspace；caller!=target 时只接受目标 workspace 的显式 grant。`mkdir` 使用目标 `write` 权限；`rename` 同时要求源路径 `delete` 与目标路径 `write`，避免用一个泛化“manage”权限绕过 ACL。读取/写入/rename 直接作用于同一底层文件，不做 copy/paste。逻辑 `/` 是目标 workspace root，不是 Runner/Linux 根；`..`、symlink 越界、跨 Environment target 均拒绝。

Backend 与 Runner 另有仅供 Host 使用的目标 workspace 二进制 streaming 接口，先由 Backend `EnvironmentService` 验证 `scope + environmentId + targetPluginId`，Runner 再验证 generation/target；它不暴露给 Runner Plugin。GET 在 Runner 内先打开并 `fstat` 目标文件，以 read handle 固定本次读取对象并流式返回 `application/octet-stream + Content-Length`；Backend handle 消费完成/失败/timeout 都 cancel/close。PUT 必须声明 `Content-Length`，Runner 流式写同目录 `wx` 临时文件，精确校验字节数、`fsync` 后原子 rename，失败删除临时文件。Runner transport hard cap 为 256 MiB，不能通过 chunked/无长度请求绕过。`runtime/exchange/workspace-artifact.service.ts` 直接把 workspace stream 接入 Artifact `write()`；反向导入按 Artifact 已有 8 MiB read-range 上限逐段读取并连续推给 Runner，不再 `arrayBuffer()/Buffer.concat()`。导出仍检查 `environment.execute + artifacts.write`，导入检查 `environment.execute + artifacts.read`，且 Artifact 自身单文件/总量/磁盘 quota 继续独立生效。这一步产生/写入 durable Artifact 或 workspace 文件，是显式生命周期转换；跨 Plugin workspace 授权仍使用上述 ACL，同一底层文件不复制。

Backend Plugin 与 Runner Plugin 是不同 runtime：Backend target 由 `LocalPluginBackendRuntimeAdapter` 在 Backend 容器内启动 bwrap process，Runner target 由 `PluginRunnerRuntime` 在具体 Environment 内启动；Backend target 不能被路由到 Runner 代跑。当前 BackendPluginSdk 只明确开放 AppStorage；新增能力必须新增 typed SDK/Host IPC，不提供通用 method mapper。

网络默认 `none`。只有 Runner 真正实现可验证 egress broker 后才允许 `capabilities.egressAllowlist=true`；当前为 false，任何 allowlist Environment 请求必须 `ENVIRONMENT_NETWORK_ENFORCEMENT_UNAVAILABLE`，不能降级成 unrestricted 网络。

ResourceLimits 目前是 admission/quota 与运行策略事实；需要严格 kernel enforcement 的配置只有在部署 capability 能真实提供时才可宣称支持。不能把目录隔离或 timeout 冒充 CPU/memory/pids 的硬内核隔离。

空间报告字段：

```ts
type RunnerStorageView = {
  stateBytes: number;
  packBytes: number;
  cacheBytes: number;
  runtimeBytes: number;
  quarantineBytes: number;
  sandboxOverheadBytes: number;
  reclaimableBytes: number;
  byPack: { familyId: string; versionId: string; bytes: number; inUse: boolean }[];
  byEnvironment: { environmentId: string; runtimeBytes: number; status: string }[];
  filesystem: { totalBytes: number; freeBytes: number };
};
```

`sandboxOverheadBytes` 只统计无法归入其他分类的 sandbox/process runtime 开销；不再存在 Docker image/container/volume engine-overhead 统计。

### 9.4 Lifecycle、Cleanup 与恢复

`provision`：验证 command 与 Catalog 中的精确 Tool Pack `{familyId,versionId,contentDigest}` → ensure Tool Pack → 创建/复用稳定 Workspace tree → 创建新的 Environment generation `.control`/sandbox metadata → 冻结该 generation 的 `packRefs + runnerPlugins` → journal ready。此流程不创建 Docker resource，也不复制 Workspace 项目文件。

`start`：当前 generation 标 running，并为冻结 target 启动 Runner Plugin process sandbox；`stop`：先 quiesce/dispose Runner Plugin，再终止该 generation 的活跃 job/process tree，保留稳定 Workspace；`restart`：终止旧 process 后按同一 generation 的冻结 tool profile 重建 sandbox；工具版本切换必须创建下一 generation，新 session 使用新 PATH/只读 Tool Pack，旧 session 终止；`delete generation`：dispose 插件、停止 jobs、只删除该 generation runtime。稳定 Workspace 只由显式 Workspace/runtime cleanup 回收，AppStorage/Artifact 不随 generation 删除。

`cleanup-planner.ts` 的“清运行残余”流程改为 freeze new env/jobs → inventory → quiesce/terminate owned process trees → reconcile unknown → remove owned runtime trees → revoke short-lived control data → release quota → compact terminal journal → second inventory。没有 container/network/volume cleanup。任何无法确认 ownership/side effect 的内容进入 `quarantine/` 并返回 partial/reconciliation 状态。

Runner startup reconcile 按 journal 处理 Environment/command/job；running Environment 按其冻结 `runnerPlugins` 恢复目标 runtime。中断中的 command/job 标 unknown，不伪造成功。旧 generation 回调不得影响新 generation。

Pack uninstall 与 runtime cleanup 完全分开；active Environment 引用 Pack 时仍拒绝卸载。`cache/` 可独立清理，`state/` 只 compaction，`quarantine/` 只在 reconcile/用户确认后释放，`packs/` 只受安装/卸载修改。

Nexus 备份默认不复制 Runner Packs/runtime/cache；保存 Settings、精确 PackRef、Environment 的 `runtimeDigest/runnerPlugins` snapshot 与 Run/Checkpoint 事实。恢复后 Runner 重新核对 Pack/target source，可重建才继续；缺失明确 unavailable，不伪装旧 sandbox/process 仍存在。

<a id="i10"></a>

## 10. Subagent、多模型、通信与扩展（Phase 3）

### 10.1 配置与创建契约

```ts
type SubagentPolicy = {
  maxDelegationDepth: number;
  maxMessagesPerRun: number;
  maxMessageBytesPerRun: number;
  profiles: SubagentProfile[];
};
type SubagentProfile = {
  id: string;
  role: string;
  defaultModel: ModelRef | null;
  allowedModels: ModelRef[];
  capabilities: string[];
  peerMessaging: 'parent-child' | 'same-run';
  maxTokens: number;
  maxSteps: number;
  failureMode: 'isolate' | 'failFast';
};
type SubagentRequest = {
  profileId: string;
  objective: string;
  constraints: string[];
  inputArtifactRefs: string[];
  maxTokens: number;
  maxSteps: number;
  deadlineAt: number;
  completionCriteria: string[];
  dependsOn: string[];
  dependencyMode: 'success' | 'settled';
  command: CommandIdentity;
};
type AgentMessage = {
  id: string;
  runId: string;
  senderRuntimeId: string;
  recipientRuntimeId: string;
  delegationId: string;
  recipientSequence: number;
  kind: 'request' | 'reply' | 'progress' | 'evidence' | 'completion';
  correlationId: string;
  replyTo: string | null;
  causationId: string | null;
  taskRevision: number;
  body: JsonValue;
  artifactRefs: string[];
  createdAt: number;
  expiresAt: number;
};
interface MailboxPort {
  send(
    ctx: ToolContext,
    input: Omit<AgentMessage, 'id' | 'runId' | 'senderRuntimeId' | 'recipientSequence' | 'createdAt'>,
    command: CommandIdentity,
  ): Promise<{ messageId: string; recipientSequence: number }>;
  read(ctx: ToolContext, after: number, limit: number): Promise<AgentMessage[]>;
  consume(ctx: ToolContext, through: number, expectedVersion: number): Promise<void>;
  expire(now: number): Promise<number>;
}
```

SubagentProfile保存在AppStorage key=subagent.profiles.v1，Settings里保存delegation深度和通用Runtime/预算上限；Run.definition_json冻结effectivePolicy与每角色modelAssignments。user create API可覆盖profile模型但必须属于其allowedModels；Agent tool输入只选profileId，不直接传model endpoint。profile和模型删除不改历史Run快照，新Run验证可用性；配置缺失才继承root模型并记录resolvedFrom='root'。

createSubagent事务：校验parent scope/active Run/profile→检查深度/依赖/loop guard→先为`kind='delegation'`消耗一个Run step并检查软预算→计算effective token/steps=min(request,profile,parent剩余)→预留预算→insert新的participant/AgentRuntime（独立modelRef）+delegation+work item→append subagent.created→COMMIT后唤醒。同key重试返回原delegation。已完成/失败/取消的Subagent不形成创建配额；未消耗的Token预留可退。若Run的token/step/active-time/cost或该delegation分配的token/step软预算不足，不把child直接标failed：先park相关child并让Run进入`awaiting_budget`，budget request注明scope=run或delegation；用户可增加本次Run/该Subagent预算或取消该child。Hard Limit只由当前Agent Settings校验，数据库不写死深度/预算最大值。

budget reservation分两级：delegation是父余额的分区，model attempt从所在分区预留；记账不把child reserve与attempt reserve重复扣父两次。settle用量一次性归Run总账/child账，maxRunTokens跨所有模型。父创建新child前可缩回未消费预算，但不能拿走已进行attempt预留；失败清理只退unused并保留usage。独立model contextWindow/tools/价格分别判断。

### 10.2 文件、API和调度函数

| 文件（Backend modules/agent/）                                  | 函数 / 参数与结果                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| runtime/collaboration/subagent.types.ts                         | §10 DTO、SubagentStatus、ScheduleState、MessageReceipt                            |
| runtime/collaboration/subagent.service.ts                       | create/cancel/join/list delegation；每 child 是独立 AgentRuntime participant      |
| runtime/collaboration/subagent-policy.ts                        | resolvePolicy/validateModel/authorizePeer；约束 profile/model/通信边界            |
| runtime/collaboration/subagent-scheduler.ts                     | child work/依赖/wait/wake/cancel tree，与 root 共用全局 Runtime permit            |
| runtime/collaboration/mailbox.service.ts                        | send/read/consume/expire；验 schema/owner/revision/quota，不导出全局 EventEmitter |
| runtime/collaboration/shared-facts.service.ts                   | get/compareAndSet；同 Run 共享事实的版本化服务                                    |
| runtime/collaboration/subagent.repository.port.ts               | delegation/mailbox/scheduler/shared-fact 的持久化 port                            |
| Infrastructure agent/repositories/sqlite-subagent.repository.ts | 提供 delegation/mailbox/scheduler/shared-fact SQL，使用同一 DatabaseAdapter       |
| Interfaces http/agent/app-collaboration.routes.ts               | scope/DTO/Idempotency-Key 映射，调用 collaboration facade                         |

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

```sql
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
```

repository验证delegation/reply/causation/edge同Run的非FK组合约束，不能直接相信UI关联id。Run delete先清edges/messages/work/cursors/delegations再删runtime，保留父Run引用保护。Inbox/Tokens使用量放Run.usage_json中的独立计数，通过version CAS防并发超配；Message body不能混入Host summary。

### 10.6 前端与验收

Frontend features/agent/settings/SubagentSettings.vue显示delegation深度、每profile模型与软预算，并复用Nexus Settings中的AgentSettingsPanel统一分区；runtime/SubagentTree.vue、SubagentCard.vue、MessageExchangePanel.vue展示公开协作消息、排队原因、model、usage、budget和单独cancel；api/subagent-api.ts仅调用上列API，store合并subagent.created/status_changed/message_accepted/completed事件且按eventId去重。

E2E delegation.spec.ts：多个不同模型profile按统一Runtime slot并发/排队；完成多个Subagent后仍可顺序创建新的；历史数量不构成限制；深度/依赖环拒绝；重复无进展delegation触发loop guard；Run软预算不足进入awaiting_budget且用户增加本Run预算后继续；join释放slot且单slot也能完成；parent cancel递归；single child cancel不杀siblings；mutation未知保留quarantine；修改配置不改旧Run模型快照。
E2E agent-messages.spec.ts：同key重复/冲突、同Run授权、跨App/Run伪造sender拒绝、断线重复交付只消费一次、mailbox满背压、过期request唤醒、stale taskRevision不驱动新动作、父join时child提问可处理、跨模型只交换摘要/Artifact、不泄露secret/context；断言来自产品API/UI。

### 10.7 MCP/ACP/CDP与安装式插件

协议 adapter 统一位于 Infrastructure `agent/integrations`，纯配置/ports 在 `ai/integrations.types.ts`；transport 版本由 lockfile 与 manifest protocolVersion 固定，不在运行时接受任意“兼容”字符串。握手拒绝不支持 major，minor 仅接受已声明可选字段；capability/schema 刷新改变 hash，使旧 inspection/approval 失效。

`McpAdapter.connect/listTools/invoke/close` 只管理用户登记 server；未知 annotation 按 mutation，远端声明不能替代 Nexus 本地授权。`AcpAdapter.execute` 的 permission 事件映射本地 ToolInspection/Approval；无法拦截自主机器副作用的 backend 只允许离线 profile。`BrowserGateway` 绑定 Environment generation 与 snapshot/nodeRef；默认无任意 evaluate/CSS fallback，下载转 Artifact。

安装式 App 由 `host/plugin-install.service.ts` 统一提供 stage/verify/install/upgrade/uninstall/deleteData。`package-verifier.port.ts` / `tar-package-verifier.adapter.ts` 校验签名、文件 hash、路径和限额，并从 manifest 的显式 `targets.frontend/backend/runner` 解析入口；禁止通用 `resources` map 推断模块。

Frontend target：已验证 `frontend/` 静态投影仍使用独立 origin，但由 **Frontend 主容器第二个 Nginx listener** 提供，不创建 `plugin-ui` service/image。`host/app-bridge.ts` 用 iframe `allow-scripts` + MessageChannel/nonce/source/seq/size/timeout；第二 listener 无 Nexus API/session proxy。Host descriptor 明确返回 `sdkVersion + protocolVersion=1`，Frontend 在建立 bridge 前验证；当前正式 RPC contract 只有 `host.appInfo` 与 `storage.get/put/delete`，定义集中在 `host/plugin-sdk.ts`。

Backend target：`LocalPluginBackendRuntimeAdapter` 在 Backend 主容器内创建独立 bubblewrap process sandbox，动态插件只在 sandbox worker 中 import；Backend Core 不 eval/import 插件。sandbox 无网络、无 `/app/data`、无 DB/env/secret，只读插件 package。当前 `PluginBackendSdkV1` 只显式开放 scope-bound AppStorage get/put/delete，类型契约位于 `host/plugin-sdk.types.ts`；activation context 固定 `{schemaVersion:1,protocolVersion:1,scope,plugin:{pluginId,version,sdkVersion},sdk}`。Host 通过 env 注入固定 protocolVersion 与安装包 sdkVersion，worker 的 `runtime.ready` 回报两者，Host 不匹配即 fail closed。以后每项能力通过 typed SDK/IPC 增加，不能给任意 Backend object、SQL、URL 或通用 method dispatcher。

Runner target：不会作为 Backend target 的 worker，也不创建 Plugin Docker。Environment 创建请求（包括 Agent 的 `environment_create` tool）通过 `runnerPluginIds` 明确选择；Backend 将每个新目标解析并冻结为 `{pluginId,version,sdkVersion,protocolVersion=2,packageHash,entry}`，持久化 `runner_plugins_json`。`PluginRunnerRuntime` 仅在该 Environment start/reconcile 时启动这些 sandbox，并把冻结的 version/sdkVersion/protocolVersion 注入 activation context；worker 的 `runtime.ready` 再回报版本，Controller 不匹配即拒绝。protocol v2 的 Host↔sandbox stdio 使用 framed JSON control + raw binary payload，不允许 workspace bytes 走 Base64。当前 `RunnerPluginSdkV1` 只有 `workspace.read/write/list/stat/mkdir/rename/remove`，其中单次 read/write binary payload 仍上限 16 MiB；插件真实 workspace 不 bind 进 process，callerPluginId 由 Host 绑定。

Workspace 跨插件授权由目标 ACL 决定：`targetPluginId + principalPluginId + path + permissions`。默认只能访问自己；跨 Plugin 必须显式 grant，授权后直接访问同一底层文件，不复制。Backend 与 Runner 双重检查 target/principal 都属于同一 Environment 的冻结 targets；撤销 grant 立即失效。

AppIntent 继续负责**跨 App**的小 JSON/ArtifactRef 交接；它与同一 Environment 内 workspace grant 分离。AppIntent Artifact read 使用 dedicated receiver path，每次重验 receiver 状态、当前 manifest/grant、receipt TTL/revoke/schema 和 artifact grant，generic Artifact owner route 不获得跨 App 读取能力。

<a id="i11"></a>

## 11. 验收、发布与任务完成标准

下列 spec 是各阶段验收归属；现有实现只通过仓库中实际存在的 E2E/构建命令声明通过，不以设计文字替代运行证据。新增验收继续遵循 EC-E2E-001/002/003；本次架构调整不新增测试文件，复用现有 Agent E2E 与 smoke。

| 验收组                 | 产品操作与必须观察的结果                                                                                                                                                                                                                                                                               | 归属                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Host/Manifest          | 无模型仍可开Nexus；Operations引导；enabled/grants重启保留；另一个App注册不改Operations；dist manifest存在                                                                                                                                                                                              | P1-A host.spec.ts                                                            |
| Provider/秘密          | 用户配置Provider、test成功/失败、401不重试、私网拒绝/显式例外、DNS更换/redirect拒绝；API无secret                                                                                                                                                                                                       | P1-B provider.spec.ts                                                        |
| Ledger/Run             | 创建/追加输入/同thread重复活跃Run冲突；刷新恢复原文/最终结果；换App查别App对象404                                                                                                                                                                                                                      | P1-C runs.spec.ts                                                            |
| Event/SSE              | 生产ingress连续输出>15秒；snapshot→catchup并发提交不漏；重复fact只应用一次；delta断线不伪final                                                                                                                                                                                                         | P1-C events.spec.ts                                                          |
| UI                     | Launcher单击/键盘恢复最后App、拖动不误打开；AppSwitcher仅在Hub页面内切换。App A运行中切到B后A继续推进且B不显示A的TaskRail，切回A通过snapshot+catchup恢复最新状态且不重复任务；关闭/最小化不cancel；移动sheet/键盘、RDP焦点、登出清理                                                                   | P1-D hub.spec.ts                                                             |
| Nexus Settings / Agent | 现有Settings增加Agent tab且保持当前视觉/键盘基调；总开关/App启停语义分离；Hard Limit提高必须二次确认；feature关闭隐藏Launcher、拒绝新执行但数据保留，重新开启不自动resume                                                                                                                              | P1-D settings.spec.ts                                                        |
| 审批与Hash             | 相同操作hash稳定、args顺序/目标版本变化失效、同审批并发批准仅一次consume、黑名单拒绝不可被批准覆盖                                                                                                                                                                                                     | P2-A approvals.spec.ts                                                       |
| Lease与未知副作用      | 两个读可并行、写被读/写阻塞；Workspace typed mutation共用资源key；SSH断线结果未知→quarantine，不重复执行                                                                                                                                                                                               | P2-A leases.spec.ts                                                          |
| Artifact / 文件库      | 上传大小/流中断/磁盘满、ready前崩溃、rename后DB失败、range/跨App/retain/GC/restore缺payload；用户级文件库分页/预览/回来源/跨App显式attach/清理preview保护引用，万级metadata不全量挂DOM                                                                                                                 | P1-B artifacts.spec.ts；P1-D artifact-library.spec.ts；P2-C recovery.spec.ts |
| Environment            | Runner无Docker socket/dockerd；sandbox不可用明确降级；错token/nonce/generation/超配拒绝；跨环境/插件目录默认不可达；stop保留Artifact、delete正确范围                                                                                                                                                   | P2-B environment-isolation.spec.ts                                           |
| 生命周期 / 功能开关    | Agent总开关关闭后立即拒绝新执行、隐藏Launcher但Settings/安全cleanup/审计仍可用且历史数据保留；进行中Run按quiesce/cancel/reconcile安全收敛，未知mutation不伪cancel；重新开启不自动resume旧Run。Run中reset排空或明确失败；旧generation回调不能写新库；shutdown不被SSE挂住；Controller重启按commandId对账 | P1-D lifecycle.spec.ts；P2-B environments.spec.ts                            |
| 协议扩展               | MCP schema更新审批失效、ACP禁止自主生产副作用、CDP nodeRef过期、网页内容不升级权限、浏览器下载→code Artifact链                                                                                                                                                                                         | P3-A mcp/acp/browser.spec.ts                                                 |
| Subagent多模型         | 每子独立模型、统一Runtime并发、delegation深度、顺序创建不限历史数量、父budget计费不重复扣预留、配置快照、不支持模型拒绝                                                                                                                                                                                | P3-B delegation.spec.ts                                                      |
| 通信/调度              | Mailbox重复/乱序恢复/TTL/背压、跨Run拒绝、join释放slot、等待图防环、parent request唤醒、递归取消、failFast/隔离模式                                                                                                                                                                                    | P3-B agent-messages.spec.ts                                                  |
| 插件/Memory            | 签名/路径炸弹拒绝、升级失败恢复AppStorage、iframe不能访问Nexus cookie、bridge错source/nonce拒绝、Memory只经用户发布生效                                                                                                                                                                                | P3-C plugins.spec.ts、P3-B memory.spec.ts                                    |

产品E2E fixture放test/e2e/fixtures/agent/，用于模拟Provider/MCP/ACP的延迟、错误、截断等下游条件；不要读取fixture内部计数/日志作为唯一断言，调用次数/重复副作用通过Nexus事件与真实产品目标结果验证。不能为了断言加test-only DOM属性；使用真实accessible role/name。每spec独立reset，CI组清单唯一分配，新增/删除spec同步groups generator。截图通过现有captureFunctionalScreenshot在业务checkpoint声明，不新增历史截图manifest。

发布与验证命令沿用工程约束，不随文档复制出第二套规则：

- npm run format / npm run format:check（只处理本任务文件，避免格式化用户其他dirty文件）。
- npm run check:test-policy；npm run build:backend；npm run build:frontend。
- npm --prefix packages/backend run check:architecture；npm --prefix packages/frontend run check:architecture。
- npm --prefix test/e2e exec playwright test tests/agent/<本任务spec>；环境/参数沿用现有E2E配置，不能把本地缺浏览器当通过。
- npm run test:e2e:groups:check；正式完整浏览器证据在既有GitHub Actions固定runner生成。
- 部署smoke经生产dist/Compose/Nginx真实入口；二期另验证nexus-agent-runner sandbox runtimeDigest、Pack manifest、Recipe权限及无Docker-socket部署。
- git diff --check。

质量基准与功能E2E分开解释：固定至少10个任务（诊断、有限日志摘要、文件修改/外部变更冲突、服务重启核验、失败恢复、二期环境协作、三期Browser/Subagent），冻结输入、允许动作、成功证据及最大预算。使用真实模型的同任务对比记录verified成功率、总input/output/cache Tokens、重试、wall time、未知结果率；模型/提示/Skill版本均记录。安全硬门槛是越权/泄密/重复mutation为0；节省Token的变更不得降低已验证成功任务数，绝不只以少花Token通过。没有真实模型凭据只执行产品契约E2E，不伪造模型质量数据。

验收表同时覆盖已实现与后续扩展范围；最终状态只以本次实际运行的 build/architecture/E2E/smoke 为准。2026-09-10 本地收尾验证中，agent-runtime build、Backend build/architecture、Frontend architecture/i18n/vue-tsc/Vite/bundle budget、root build、test policy、E2E groups、Agent E2E（2/2）、format check 与 `git diff --check` 均通过；seeded DB 也实际完成 v19→v50 migration。完整 `npm run test:e2e` 已执行，但当前宿主没有 `libglib-2.0.so.0`，一次完整运行生成的 143 个 failure context 中 143/143 都在 Playwright Chromium 启动阶段退出、尚未进入页面/业务断言，因此不能把 browser E2E 记为通过。当前宿主同时没有 Docker CLI 与 bubblewrap，且 Node v22.17.0 低于仓库声明的 Node >=24（本次 build 仅产生 engine warning）；所以也不能在本机声称生产容器内 bubblewrap namespace 已实际运行通过。完整浏览器与 sandbox 运行态证据必须在仓库固定 E2E runner / 具备相应系统依赖的宿主生成，不得通过跳过项目、`reuseExistingServer` 或降低安全边界伪造全绿。

<a id="frozen-decisions"></a>

## 12. 冻结决策与需求治理

### 12.1 需求、实现快照与验收同步闸门

`ARCHITECTURE.md` 与 `IMPLEMENTATION.md` 是长期规范源，`CURRENT_AGENT_ARCHITECTURE.md` 是当前实现快照，software-requirements/FR 是产品需求与追溯入口。三者现在都已经启用，任何一侧变化都不能长期脱离另外两侧。

新增或修改正式能力时必须同时回答：需求是否允许；长期 owner/安全边界是否改变；当前源码是否已接线；哪条 E2E/静态验证形成证据。只新增设计文字不能把需求状态改成已实现；只出现一个 adapter/class 也不能宣称能力已进入 live composition。Phase 3 尤其要区分 MCP 这类已经由 composition root 注入执行链的能力，与 ACP/Browser 这类可能已有类型/adapter 但尚未进入 Host 执行路径的实现骨架。

### 12.2 DECISION-01～33（采用值而非待选项）

| 编号        | 冻结决定                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 正文                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| DECISION-01 | 一期Host/UI/模型/只读；二期修改与Docker；三期协议/多Agent/安装式插件                                                                                                                                                                                                                                                                                                                                                                                                 | 架构§1；实施§0                            |
| DECISION-02 | 单用户，不做tenant/role，App必须隔离                                                                                                                                                                                                                                                                                                                                                                                                                                 | 架构§1/3                                  |
| DECISION-03 | AgentRuntime是参与者，Group是配额聚合，Workspace是稳定项目边界，Environment generation是该Workspace的冻结运行配置/会话生命周期边界                                                                                                                                                                                                                                                                                                                                   | 架构§3                                    |
| DECISION-04 | Runner不挂任何Docker socket、不运行dockerd/nested Docker；真实Docker能力只归Backend受控capability                                                                                                                                                                                                                                                                                                                                                                    | §9                                        |
| DECISION-05 | 每个Workspace runtime generation/session使用独立process/filesystem/network sandbox；稳定Workspace文件系统与sandbox生命周期分离，Plugin按target再使用独立sandbox/logical workspace                                                                                                                                                                                                                                                                                    | §9.3                                      |
| DECISION-06 | 一期OpenAI-compatible Chat Completions streaming adapter+OpenAI preset，Anthropic三期                                                                                                                                                                                                                                                                                                                                                                                | §6.1                                      |
| DECISION-07 | HTTPS公网默认，私网准确host:port例外，metadata始终拒绝，DNS固定，redirect拒绝                                                                                                                                                                                                                                                                                                                                                                                        | §6.1                                      |
| DECISION-08 | 单一ai_thread_entries ledger；不保留两套input/message sequence                                                                                                                                                                                                                                                                                                                                                                                                       | §4.1                                      |
| DECISION-09 | V1不自动compact，Run显式删除才清事实，不实现CURSOR_EXPIRED                                                                                                                                                                                                                                                                                                                                                                                                           | §7.2                                      |
| DECISION-10 | Approval统一600秒，consume前仍检查expiry/hash/revisions                                                                                                                                                                                                                                                                                                                                                                                                              | §3/5.3                                    |
| DECISION-11 | 32K输入/4096输出/100K Run，真实窗口+15%估算余量，重试2次                                                                                                                                                                                                                                                                                                                                                                                                             | §3/6.1                                    |
| DECISION-12 | 50MiB对象/10MiB raw/256MiB Run/2GiB全局/终态7天，无限retain不绕quota                                                                                                                                                                                                                                                                                                                                                                                                 | §3/6.2                                    |
| DECISION-13 | Lease30秒/10秒续约，未知远端结果隔离而非到期即重新执行                                                                                                                                                                                                                                                                                                                                                                                                               | §5.4                                      |
| DECISION-14 | 全局Runtime执行默认软2/默认Hard Limit 4（Hard可在Agent Settings二次确认调整）并直接约束root/child，模型并发默认auto跟随有效Runtime且可向下调、每Run工具1；Subagent无累计/独立并发上限，只保留深度/profile/预算且每个可不同模型                                                                                                                                                                                                                                       | §3/10                                     |
| DECISION-15 | 二期结构化工具优先，未知shell文本审批，硬deny不可覆盖，不把regex当sandbox                                                                                                                                                                                                                                                                                                                                                                                            | §5                                        |
| DECISION-16 | 一期不自动写Memory；三期candidate→用户审查→published                                                                                                                                                                                                                                                                                                                                                                                                                 | §6.3                                      |
| DECISION-17 | 一期只读仓库builtin Skill，三期签名安装、脚本另受capability约束                                                                                                                                                                                                                                                                                                                                                                                                      | §6.3/10.7                                 |
| DECISION-18 | MCP/ACP/CDP/Subagent/安装式扩展三期；Workspace Dev Environment + Runner sandbox二期，Docker是独立Backend capability                                                                                                                                                                                                                                                                                                                                                  | §0/9/10                                   |
| DECISION-19 | Operations默认enabled，无模型degraded+引导，不阻断Core                                                                                                                                                                                                                                                                                                                                                                                                               | 架构§1/4                                  |
| DECISION-20 | 全部当前/新增connection+denylist，不采用首次连接allowlist方案                                                                                                                                                                                                                                                                                                                                                                                                        | §5.1                                      |
| DECISION-21 | Agent mutation做same-origin+CSRF，内部mTLS通道独立                                                                                                                                                                                                                                                                                                                                                                                                                   | §7.1                                      |
| DECISION-22 | Resume新Run/新身份/新资源、checkpoint校验、旧mutation不重放                                                                                                                                                                                                                                                                                                                                                                                                          | §2.2                                      |
| DECISION-23 | DB包含加密credential；默认排除payload/plugin code/Runner runtime；缺内容标unavailable                                                                                                                                                                                                                                                                                                                                                                                | §6.3                                      |
| DECISION-24 | Runner/sandbox不可用不阻断Core；availability明确原因，不退化为未隔离执行                                                                                                                                                                                                                                                                                                                                                                                             | §9.1/9.4                                  |
| DECISION-25 | integer micro-USD、版本化价格、unknown=null；设置cost cap需已知价格                                                                                                                                                                                                                                                                                                                                                                                                  | §6.1                                      |
| DECISION-26 | Plugin manifest使用显式`targets.frontend/backend/runner`；三层分别运行sandbox，不创建Plugin Docker，不用resources/key映射推断模块                                                                                                                                                                                                                                                                                                                                    | 架构§4；实施§10.7                         |
| DECISION-27 | Runner无Docker socket/dockerd/nested Docker；Workspace Dev Environment负责稳定项目与多版本Tool选择，sandbox只承载generation/session；Runner Plugin按generation显式选择并冻结                                                                                                                                                                                                                                                                                         | 架构§9；实施§9                            |
| DECISION-28 | Runner Plugin workspace默认私有；跨Plugin访问由目标workspace ACL的target/principal/path/permission授权，直接访问同一底层文件、不复制                                                                                                                                                                                                                                                                                                                                 | 架构§4.3/9.2；实施§9.2/10.7               |
| DECISION-29 | Runtime一级实现拆为definitions/runs/execution/planning/scheduling/approvals/recovery/events/collaboration/exchange，不新增同义业务实体                                                                                                                                                                                                                                                                                                                               | 架构§3；实施§1/2/13                       |
| DECISION-30 | PlanItem是用户可见durable plan projection，Step是Agent loop执行推进边界；Execution Graph从PlanItem依赖/evidence投影，不把Step当workflow node                                                                                                                                                                                                                                                                                                                         | 架构§3；实施§2                            |
| DECISION-31 | Tool Catalog使用显式CapabilityContribution{id,capability,tools[]}；Target只表示运行位置，Capability表示可做的事，不靠字符串map或散落register推断                                                                                                                                                                                                                                                                                                                     | 架构§6；实施§1/5                          |
| DECISION-32 | 三 Plugin target 冻结/暴露明确 sdkVersion + protocolVersion；Frontend/Backend protocol v1 与 Runner protocol v2 独立演进，Backend/Runner sandbox 以 runtime.ready 回报并由 Host 校验；Runner v2 workspace IPC 使用 framed raw binary、不使用 Base64；Workspace↔Artifact 由 runtime/exchange 以 Host-only streaming bridge 显式转换，Runner transport hard cap 256 MiB 并重新检查 environment/artifact capabilities，不把 Artifact/transfer handle 直通 Runner Plugin | 架构§4/9；实施§9/10.7                     |
| DECISION-33 | Nexus Workspace `NXW1 v1`、独立 `/ws/uploads` raw upload、Runner Plugin `NXR2 v2` 与 Backend↔Runner authenticated HTTP streaming 是四条独立 transport contract；只共享 bounded/raw-byte/fail-closed 原则，不共享 magic、requestId 类型、协议版本或 lifecycle。Workspace binary response 单 frame 最大 256 KiB；Runner Plugin SDK 单次 binary 最大 16 MiB；Host Workspace transfer hard cap 256 MiB                                                                   | 架构§4.4；Backend/Frontend Workspace 架构 |

新增Owner决定：Subagent支持可配置delegation深度、每profile独立模型/软预算，通信/调度有完整协议；不设置累计创建数量或独立child并发上限，已落架构§10.1～10.3/实施§10。后续更换默认值以服务端settings/Run快照为准，不在多个文件另写不同常量。

<a id="i13"></a>

## 13. 文档同步与已落地模块拆分

`ARCHITECTURE.md` 继续作为职责/理由/边界的详细规范，`IMPLEMENTATION.md` 继续作为接口/SQL/阶段/验收的实现规范；软件需求与 traceability 只保存需求级映射，不复制这里的内部协议。当前 Agent 业务代码已经开工并持续实现，因此本节不再使用“未来不执行拆分”的历史措辞。

本轮已经实际完成 Runtime 物理拆分：`runtime/` 一级不再平铺服务，而固定收敛为 `definitions / runs / execution / planning / scheduling / approvals / recovery / events / collaboration / exchange`。新增功能必须先归类到现有子域；只有出现新的长期业务职责且无法放入现有边界时才讨论新增子域，禁止用 `Task/Job/Execution/Activity` 等近义一级实体重复包装 Run/Step。

当前同步关系：

| 文档/代码位置                                                                                                               | 当前职责                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `doc/software-requirements/requirements/agent.md`、`SRS.md`、traceability/design 索引                                       | Agent 产品需求、阶段与验收追踪                                                            |
| `doc/architecture/agent/ARCHITECTURE.md`                                                                                    | Thread/Run/AgentRuntime/Environment/Plugin/Capability/Workspace/Artifact 等稳定概念和边界 |
| `doc/architecture/agent/IMPLEMENTATION.md`                                                                                  | 当前真实目录、接口、schema、协议、迁移和验收                                              |
| `packages/backend/src/modules/agent/runtime/*`                                                                              | 已拆分的 durable Runtime 子域；PlanItem 与 Step 已分离                                    |
| `packages/backend/src/modules/agent/capabilities/tool-catalog.ts`                                                           | 显式 Capability Contribution，不靠散落注册或字符串映射猜能力                              |
| `packages/backend/src/modules/agent/runtime/exchange/*`                                                                     | Workspace↔Artifact 等跨资源协调，不污染 Environment/Artifact 自身职责                     |
| `packages/frontend/src/features/agent/host/plugin-sdk.ts`、Backend `host/plugin-sdk.types.ts`、Runner `plugin-sdk.types.ts` | 三 target 当前真实 SDK contract；只声明已经实现的方法                                     |

后续修改必须同时更新代码与本目录两份规范；只有通过实际 build/architecture/E2E/smoke 的能力才标为已实现。设计中的未来扩展（更多 Plugin SDK capability、真实 egress broker、更强 kernel resource enforcement 等）继续明确标注为未来能力，不借文档措辞伪装成当前交付。
