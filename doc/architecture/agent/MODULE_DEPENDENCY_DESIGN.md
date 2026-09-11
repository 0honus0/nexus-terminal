# Nexus Agent 模块调用依赖设计

本文记录 Nexus Agent 当前代码结构收敛后的**模块、类、函数级调用依赖**，作为后续重构与代码审查的依赖基线。

本文关注：

- 哪个模块可以调用哪个模块；
- 构造函数注入的 Port / Service 分别承担什么职责；
- 关键函数调用链如何跨 HTTP、Application、Runtime、Persistence、Runner 边界；
- durable state、lease、side effect、verification 的 authority 分别在哪里；
- 哪些 helper 是允许共享的领域 primitive，哪些状态机禁止抽成 generic helper；
- 后续拆文件时必须保持的事务与安全顺序。

> 本文描述当前 `dev` 架构。ACP 与 Browser/CDP 是保留的后继能力边界，不因为当前未接入 live execution 而删除。

---

## 1. 总体依赖方向

主依赖方向：

```text
HTTP / Agent API
      |
      v
Application Facade / Service
      |
      v
Domain Runtime / Capability Service
      |
      +--------------------+
      |                    |
      v                    v
Repository Port       External Runtime Port
      |                    |
      v                    v
SQLite Adapter        Runner / MCP / Plugin / Provider Adapter
```

Composition Root 只负责创建对象与连接依赖：

```text
bootstrap/agent/compose-agent.ts
bootstrap/agent/compose-plugins.ts
bootstrap/agent/compose-workspace-runtime.ts
bootstrap/agent/lifecycle-sweeps.ts
```

禁止反向依赖：

```text
infrastructure -> bootstrap            禁止
modules/domain -> interfaces/http       禁止
modules/domain -> concrete sqlite       禁止
runtime execution -> express/vue        禁止
repository adapter -> application UI    禁止
```

---

## 2. Composition Root

### 2.1 `composeAgent()`

文件：

```text
packages/backend/src/bootstrap/agent/compose-agent.ts
```

入口：

```ts
composeAgent(options: ComposeAgentOptions): AgentServices
```

职责仅限：

1. 构造 Repository / Adapter；
2. 把 concrete adapter 收窄成 capability Port；
3. 构造 domain service / runtime；
4. 注册 Tool / App / Integration contribution；
5. 连接 lifecycle。

不应在这里实现：

- Run 状态机；
- Tool mutation 状态机；
- HTTP 输入验证；
- Plugin package 验证算法；
- Workspace sandbox 实现。

### 2.2 Collaboration Repository capability wiring

当前一个 SQLite adapter：

```ts
const subagentRepository = new SqliteSubagentRepository(database);
```

被 composition root 显式收窄成 6 个 Port：

```ts
const runScopes: RunScopeRepositoryPort = subagentRepository;
const runtimeParticipants: RuntimeParticipantRepositoryPort = subagentRepository;
const delegationRepository: DelegationRepositoryPort = subagentRepository;
const mailboxRepository: MailboxRepositoryPort = subagentRepository;
const schedulerWork: SchedulerWorkRepositoryPort = subagentRepository;
const sharedFactRepository: SharedFactRepositoryPort = subagentRepository;
```

意义：

- SQLite 可以继续共享一个数据库和事务基础设施；
- Service 只能看到自己需要的方法；
- 不再通过一个 30+ 方法的 `SubagentRepositoryPort` 获得不必要权限。

具体注入：

```text
SubagentService
  <- DelegationRepositoryPort
  <- RuntimeParticipantRepositoryPort

MailboxService
  <- MailboxRepositoryPort
  <- RuntimeParticipantRepositoryPort
  <- DelegationRepositoryPort

SharedFactsService
  <- SharedFactRepositoryPort

SubagentScheduler
  <- RunScopeRepositoryPort
  <- SchedulerWorkRepositoryPort
  <- DelegationRepositoryPort
  <- RuntimeParticipantRepositoryPort
  <- MailboxRepositoryPort

NativeAgentBackend
  <- DelegationRepositoryPort
```

---

## 3. Root Agent Execution

核心文件：

```text
modules/agent/runtime/execution/native-agent-backend.ts
modules/agent/runtime/execution/lease-coordinator.ts
modules/agent/runtime/execution/execution-errors.ts
modules/agent/runtime/execution/model-accounting.ts
modules/agent/runtime/execution/text-budget.ts
```

### 3.1 `NativeAgentBackend`

主要依赖：

```text
RunRepositoryPort
DelegationRepositoryPort
ProviderService
ContextService
LanguageModelPort
StateCommitPort
ToolCatalog
ToolExecutor
LeaseCoordinator
LeasePort
PolicyService
ModelCallLimiter
ClockPort
```

其中：

- `RunRepositoryPort`：读取 Run snapshot / pending durable state；
- `StateCommitPort`：唯一 durable transition authority；
- `ToolExecutor`：inspect / execute Tool；
- `PolicyService`：根据 inspection 做 policy decision；
- `LeaseCoordinator`：共享 lease primitive；
- `LeasePort`：Agent mutation 特有的 mutation-active / settled durable lease 标记仍直接使用；
- `DelegationRepositoryPort`：只读 Root 的 child delegation 状态。

### 3.2 Root Tool 普通 inspect / policy 链

关键调用：

```ts
const inspection = await toolExecutor.inspect(context, proposal);
const policyDecision = policy.decide(inspection, inspection.policyRevision);
```

逻辑链：

```text
Tool proposal
  -> ToolExecutor.inspect()
  -> PolicyService.decide()
  -> deny / execute / requireApproval
```

不能把 `inspect()` 与 `decide()` 合并成一个泛用 helper，因为二者分别属于 Tool capability boundary 与 policy authority。

### 3.3 Read Tool lease 链

Root read execution 使用：

```ts
leaseCoordinator.acquireWithRetry(...)
leaseCoordinator.startRenewal(...)
...
leaseCoordinator.release(...)
```

`LeaseCoordinator` 提供：

```ts
acquireWithRetry(
  owner,
  resourceKeys,
  mode,
  ttlSeconds,
  signal,
  deadlineAt,
): Promise<ResourceLease[]>

startRenewal(
  leaseIds,
  owner,
  ttlSeconds,
  parentSignal,
): LeaseRenewal

release(leaseIds, owner): Promise<void>

quarantine(owner, resourceKeys, reason, evidence, toolCallId?): Promise<ResourceQuarantine[]>
```

内部只调用底层 `LeasePort`：

```text
LeasePort.acquireMany()
LeasePort.renew()
LeasePort.release()
LeasePort.quarantine()
```

它**不负责** Run durable state machine。

---

## 4. Agent Mutation 安全调用链

Root mutation 必须保持：

```text
Capability
-> ToolExecutor.inspect()
-> PolicyService.decide()
-> Approval
-> ToolExecutor.inspect() again
-> operationHash / inputRevision / policyRevision check
-> LeaseCoordinator.acquireWithRetry()
-> LeaseCoordinator.startRenewal()
-> StateCommitPort.beginMutationTool()
-> LeasePort.markMutationActive()
-> Tool side effect
-> verification
-> StateCommitPort.settleMutationTool()
-> LeasePort.markMutationSettled()
-> LeaseCoordinator.release()
```

### 4.1 Approval stale / target changed

复检后以下任一发生变化：

```text
operationHash
inputRevision
policyRevision
inspection target/precondition
```

Root 调用：

```ts
stateCommit.supersedeMutationTool(...)
```

而不是直接执行 side effect。

### 4.2 Durable begin 的顺序

关键顺序：

```ts
const begun = await stateCommit.beginMutationTool(...);
await leases.markMutationActive(leaseIds, owner, toolCallId);
```

禁止改为：

```text
markMutationActive
-> beginMutationTool
```

因为 Agent durable Run/Tool state 与 lease mutation marker 的 authority 不同，现有顺序是安全语义的一部分。

### 4.3 settle / quarantine

执行后通过：

```ts
stateCommit.settleMutationTool(...)
```

settle 的 durable result 包括 confirmed / unknown 与 reconciliation 状态。

只有确定 settle 后才：

```ts
leases.markMutationSettled(...)
leaseCoordinator.release(...)
```

如果 side effect 结果不确定，则保留 reconciliation / quarantine 语义，不可为了“保证 release”把 unknown outcome 当成功或失败吞掉。

---

## 5. Shared Execution Primitives

Root Agent 与 Subagent 共用的稳定 primitive：

```text
runtime/execution/execution-errors.ts
runtime/execution/text-budget.ts
runtime/execution/model-accounting.ts
runtime/execution/lease-coordinator.ts
```

典型函数：

```text
executionErrorCode()
waitForRetry()
failedToolResult()

boundedUtf8()

estimateTokens()
modelCost()

LeaseCoordinator.acquireWithRetry()
LeaseCoordinator.startRenewal()
LeaseCoordinator.release()
LeaseCoordinator.quarantine()
```

这些可以共享，因为它们不拥有 Run / Delegation durable state machine。

禁止把以下逻辑抽到这些 primitive 中：

```text
beginMutationTool / settleMutationTool
markMutationActive / markMutationSettled ordering
Run status transition
Subagent work queue transition
Approval state machine
```

---

## 6. Collaboration / Subagent

### 6.1 Repository Ports

文件：

```text
modules/agent/runtime/collaboration/subagent.repository.port.ts
```

#### `RunScopeRepositoryPort`

```ts
scopeForRun(runId): Promise<Scope | null>
```

只负责从持久化 Run 找 scope。

#### `RuntimeParticipantRepositoryPort`

核心方法：

```text
runtime()
recentRuntimeToolExchanges()
runtimeToolWork()
activeRuntimeModelWork()
```

#### `DelegationRepositoryPort`

核心方法：

```text
delegation()
listDelegations()
createDelegation()
cancelDelegation()
descendants()
```

#### `MailboxRepositoryPort`

核心方法：

```text
sendMessage()
readMessages()
listDelegationMessages()
consumeMessages()
expireMessages()
```

#### `SchedulerWorkRepositoryPort`

核心方法：

```text
enqueueWork()
readyWork()
terminalWork()
claimWork()
claimNextWork()
settleWork()
resetClaimedWork()
```

#### `SharedFactRepositoryPort`

```text
getFact()
compareAndSetFact()
```

### 6.2 `SubagentService`

构造依赖：

```text
DelegationRepositoryPort
RuntimeParticipantRepositoryPort
RunRepositoryPort
SubagentPolicyService
ProviderService
AppCapabilityBroker
AgentEventHub
ClockPort
```

主要 public 方法：

```text
create()
list()
cancelTree()
pollJoin()
join()
```

`create()` 的核心读取：

```text
RunRepositoryPort.snapshot()
RuntimeParticipantRepositoryPort.runtime()
DelegationRepositoryPort.listDelegations()
SubagentPolicyService.get()
```

然后通过：

```text
DelegationRepositoryPort.createDelegation()
```

创建 durable delegation。

### 6.3 `MailboxService`

构造依赖：

```text
MailboxRepositoryPort
RuntimeParticipantRepositoryPort
DelegationRepositoryPort
AgentSettingsService
ClockPort
```

public 方法：

```text
send()
read()
consume()
sweepExpired()
```

`send()` 的调用链：

```text
parse/size validation
-> runtimes.runtime(sender)
-> runtimes.runtime(recipient)
-> delegations.listDelegations()
-> peer-policy check
-> mailboxes.sendMessage()
```

Mailbox service 不直接拥有 Scheduler work queue。

### 6.4 `SharedFactsService`

只依赖：

```text
SharedFactRepositoryPort
ClockPort
```

public 方法：

```text
get()
compareAndSet()
```

它不应该能调用 delegation/mailbox/scheduler work 方法。

---

## 7. `SubagentScheduler`

核心文件：

```text
modules/agent/runtime/collaboration/subagent-scheduler.ts
```

持久化能力依赖被显式拆开：

```text
this.runScopes
this.work
this.delegations
this.runtimes
this.mailboxes
```

### 7.1 Scheduler 初始化

```ts
work.resetClaimedWork(ownerEpoch, now);
```

用于进程启动时清理自身 epoch 相关 claim。

### 7.2 Work selection

```text
work.terminalWork()
work.readyWork()
runScopes.scopeForRun()
work.claimWork()
```

不能把 `readyWork()` 与 `claimWork()` 合并成 process-local queue，因为 claim 是 durable CAS boundary。

### 7.3 Delegation / Runtime lookup

执行 work 时使用：

```text
delegations.delegation()
delegations.listDelegations()
delegations.descendants()

runtimes.runtime()
runtimes.runtimeToolWork()
runtimes.activeRuntimeModelWork()
runtimes.recentRuntimeToolExchanges()
```

### 7.4 Mailbox context

模型上下文读取：

```ts
mailboxes.readMessages(...)
```

处理完成后：

```ts
mailboxes.consumeMessages(...)
```

### 7.5 Work settle

所有 scheduler work 的 durable 完成/等待/取消通过：

```ts
work.settleWork(...)
```

不是靠内存 Map 标记完成。

---

## 8. StateCommit Transaction Authority

核心 facade：

```text
infrastructure/agent/runtime/sqlite-state-commit.adapter.ts
```

Port：

```text
modules/agent/runtime/runs/state-commit.port.ts
```

### 8.1 唯一事务入口原则

`SqliteStateCommitAdapter` 仍然拥有：

```ts
this.db.transaction(...)
```

任何拆出的 transition 函数必须接收当前 transaction context：

```ts
transition(tx, command);
```

禁止 transition 自己重新调用：

```text
db.transaction()
new Repository()
独立 connection transaction
```

否则会破坏 Run + Step + Tool + Approval + Event + Ledger 的原子性。

### 8.2 transaction primitives

当前已抽：

```text
infrastructure/agent/runtime/state-commit/transaction-primitives.ts
```

关键函数：

```text
validateEvents()
emptyUsage()
usageWithDelta()
summaryPayload()
allocateHostEvent()
updateAppLiveCount()
appendEvents()
appendLedger()
patchRun()
artifactForInput()
```

这些函数全部显式接收同一个 `tx: RelationalDatabase`。

### 8.3 Tool transitions

当前已抽：

```text
infrastructure/agent/runtime/state-commit/tool-transitions.ts
```

Facade 调用：

```ts
SqliteStateCommitAdapter.supersedeMutationTool(command)
  -> db.transaction(tx => supersedeMutationToolTransition(tx, command))

SqliteStateCommitAdapter.beginMutationTool(command)
  -> db.transaction(tx => beginMutationToolTransition(tx, command))

SqliteStateCommitAdapter.settleMutationTool(command)
  -> db.transaction(tx => settleMutationToolTransition(tx, command))

SqliteStateCommitAdapter.beginReadTool(command)
  -> db.transaction(tx => beginReadToolTransition(tx, command))

SqliteStateCommitAdapter.settleReadTool(command)
  -> db.transaction(tx => settleReadToolTransition(tx, command))

SqliteStateCommitAdapter.commitToolProposal(command)
  -> db.transaction(tx => commitToolProposalTransition(tx, command))
```

对应 transition：

```text
supersedeMutationToolTransition()
beginMutationToolTransition()
settleMutationToolTransition()
beginReadToolTransition()
settleReadToolTransition()
```

### 8.4 `beginMutationToolTransition()` 的 authority

该 transition 负责同一事务中的：

```text
Run version/status check
inputRevision check
policyRevision check
Approval status/hash/expiry check
Tool operationHash/risk/status check
Approval consumed CAS
Step created -> running
Tool ready -> running
Durable event append
Run projection/version/event cursor update
Host summary event
```

它**不负责**：

```text
Lease acquire
markMutationActive
真实 Tool side effect
verification
lease release
```

这些仍由 `NativeAgentBackend` / `LeaseCoordinator` 控制。

### 8.5 `settleMutationToolTransition()` 的 authority

负责同一事务中的：

```text
Tool running -> succeeded/failed/reconciling
Step running -> completed/failed
Tool result ledger append
Run usage + status update
unknown outcome -> interrupted + needsReconciliation
cancelling -> cancelled
runtime terminal update
app running_count update
host summary event
```

因此 Tool side effect 的 durable settle 不能搬到 `LeaseCoordinator` 或 `ToolExecutor`。

### 8.6 Approval transitions

当前已抽：

```text
infrastructure/agent/runtime/state-commit/approval-transitions.ts
```

Facade 调用：

```ts
SqliteStateCommitAdapter.requestToolApproval(command)
  -> db.transaction(tx => requestToolApprovalTransition(tx, command))

SqliteStateCommitAdapter.resolveToolApproval(command)
  -> db.transaction(tx => resolveToolApprovalTransition(tx, command))

SqliteStateCommitAdapter.expireToolApprovals(now)
  -> db.transaction(tx => expireToolApprovalsTransition(tx, now))
```

`requestToolApprovalTransition()` 在同一事务中负责：

```text
Run status/version/inputRevision check
App policyRevision check
Tool proposed / operationHash / risk check
Approval row insert
Tool proposed -> awaiting_approval
Runtime schedule_state -> waiting_approval
Run running -> awaiting_approval
approval.requested + run.status_changed events
App approval_count +1
Host summary event
```

`resolveToolApprovalTransition()` 在同一事务中负责：

```text
approval.resolve idempotency replay / pending command
Run awaiting_approval + revision checks
Approval operationHash/version/expiry check
Approval requested -> approved/denied CAS
Tool awaiting_approval -> ready/cancelled
Runtime waiting_approval -> runnable
Denied path Tool result ledger append
Run awaiting_approval -> running
App approval_count -1
Host summary event
Idempotent command pending -> committed
```

`expireToolApprovalsTransition()` 在同一事务中负责扫描到期 requested approval，并逐项完成：

```text
Approval requested -> expired
Tool awaiting_approval -> cancelled
Step created -> cancelled
APPROVAL_EXPIRED Tool result ledger append
Run awaiting_approval -> running
App approval_count -1
Host summary event
```

Approval transition 不执行真实 Tool side effect，也不操作 lease；审批完成后是否进入 mutation execution 仍由 `NativeAgentBackend` 重新 inspect / policy / revision check 后决定。

### 8.7 Root model transitions

当前已抽：

```text
infrastructure/agent/runtime/state-commit/model-transitions.ts
```

Facade 调用：

```ts
SqliteStateCommitAdapter.beginModelStep(command)
  -> db.transaction(tx => beginModelStepTransition(tx, command))

SqliteStateCommitAdapter.parkModelStep(command)
  -> db.transaction(tx => parkModelStepTransition(tx, command))

SqliteStateCommitAdapter.retryModelStep(command)
  -> db.transaction(tx => retryModelStepTransition(tx, command))

SqliteStateCommitAdapter.pauseModelStepForBudget(command)
  -> db.transaction(tx => pauseModelStepForBudgetTransition(tx, command))

SqliteStateCommitAdapter.settleModelStep(command)
  -> db.transaction(tx => settleModelStepTransition(tx, command))

SqliteStateCommitAdapter.supersedeModelStep(command)
  -> db.transaction(tx => supersedeModelStepTransition(tx, command))
```

这些 transition 分别保持 Root model execution 的 durable authority：

```text
beginModelStepTransition()
  Run/runtime schedulable check
  Step + model attempt creation
  first-step Run/runtime activation
  durable model.started event

parkModelStepTransition()
  streaming attempt park
  assistant/ledger state append where required
  Run projection/event update

retryModelStepTransition()
  failed/retryable attempt -> new attempt
  retry durable event + usage accounting

pauseModelStepForBudgetTransition()
  model attempt / runtime -> budget wait
  Run -> awaiting_budget
  usage/event projection

settleModelStepTransition()
  streaming attempt terminal settle
  Step terminal state
  assistant ledger append
  usage/cost accounting
  Run terminal/running projection

supersedeModelStepTransition()
  new input revision supersedes streaming attempt
  attempt aborted + Step cancelled
  usage/event projection
```

Root model transitions 不处理 Subagent scheduler work queue；Subagent model state 继续由独立 Subagent transition 域负责。

### 8.8 Subagent transitions

当前已抽：

```text
infrastructure/agent/runtime/state-commit/subagent-transitions.ts
```

Facade 调用：

```ts
SqliteStateCommitAdapter.beginSubagentModelStep(command)
  -> db.transaction(tx => beginSubagentModelStepTransition(tx, command))

SqliteStateCommitAdapter.pauseRuntimeForBudget(command)
  -> db.transaction(tx => pauseRuntimeForBudgetTransition(tx, command))

SqliteStateCommitAdapter.parkRuntime(command)
  -> db.transaction(tx => parkRuntimeTransition(tx, command))

SqliteStateCommitAdapter.commitSubagentToolProposal(command)
  -> db.transaction(tx => commitSubagentToolProposalTransition(tx, command))

SqliteStateCommitAdapter.beginSubagentTool(command)
  -> db.transaction(tx => beginSubagentToolTransition(tx, command))

SqliteStateCommitAdapter.settleSubagentTool(command)
  -> db.transaction(tx => settleSubagentToolTransition(tx, command))

SqliteStateCommitAdapter.settleSubagentWithoutModel(command)
  -> db.transaction(tx => settleSubagentWithoutModelTransition(tx, command))

SqliteStateCommitAdapter.settleSubagentModelStep(command)
  -> db.transaction(tx => settleSubagentModelStepTransition(tx, command))
```

这一组 transition 管理 child runtime / delegation execution 的 durable 状态，包括：

```text
Subagent runtime model Step / attempt begin
Runtime runnable / waiting_budget / parked schedule state
Subagent Tool proposal / begin / settle
Delegation usage / result / evidence settle
Runtime completion / failure
Parent wake 所需 durable event/projection
```

它们不拥有 Scheduler work claim authority。`SubagentScheduler` 仍通过：

```text
SchedulerWorkRepositoryPort.claimWork()
SchedulerWorkRepositoryPort.settleWork()
```

管理 durable work queue；StateCommit transition 只提交执行过程中涉及的 Run / Runtime / Delegation / Step / Tool / Event 原子状态。

### 8.9 Run lifecycle transitions

当前已抽：

```text
infrastructure/agent/runtime/state-commit/run-transitions.ts
```

Facade 调用：

```ts
SqliteStateCommitAdapter.createRun(command)
  -> db.transaction(tx => createRunTransition(tx, command))

SqliteStateCommitAdapter.appendInput(command)
  -> db.transaction(tx => appendInputTransition(tx, command))

SqliteStateCommitAdapter.cancelRun(command)
  -> db.transaction(tx => cancelRunTransition(tx, command))

SqliteStateCommitAdapter.increaseRunBudget(command)
  -> db.transaction(tx => increaseRunBudgetTransition(tx, command))

SqliteStateCommitAdapter.deleteRun(command)
  -> db.transaction(tx => deleteRunTransition(tx, command))
```

这些 transition 负责 Run lifecycle 的原子 durable mutation：

```text
createRunTransition()
  command idempotency
  App policy + Thread state check
  active/created queue limit
  input Artifact authorization
  Run/root Runtime creation
  initial Thread input entry
  host summary

appendInputTransition()
  idempotency
  Run/Thread revision check
  input Artifact authorization
  Thread ledger append
  Run input sequence/revision update
  durable input event

cancelRunTransition()
  idempotency
  terminal/non-terminal check
  immediate cancel 或 cancelling transition
  runtime/delegation cancellation state
  App live count adjustment

increaseRunBudgetTransition()
  idempotency
  hard-limit compatible budget replacement
  awaiting_budget -> runnable/running resume state
  durable budget event

 deleteRunTransition()
  idempotency
  active/reference/reconciliation safety check
  Run-related durable row deletion
  host summary/delete event
```

Run transition 可以使用 `transaction-primitives.ts` 的 event/ledger/host-event primitive，但不能自己开启新 transaction。

---

## 9. HTTP Boundary

入口：

```text
interfaces/http/agent/agent.routes.ts
```

当前 root router 在认证后挂子 Router：

```text
/plugins            -> createPluginRouter()
/workspace-runtime  -> createWorkspaceRuntimeRouter()
```

### 9.1 输入 validation primitive

文件：

```text
interfaces/http/agent/agent-route-input.ts
```

当前 primitive：

```text
isRecord()
isJsonValue()
hasOnlyKeys()
positiveInteger()
nonEmptyString()
queryString()
pathParam()
```

这些只做 HTTP 输入边界 validation，不包含业务状态机。

### 9.2 Plugin Router

```ts
createPluginRouter(plugins: AgentPluginFacade, mutationSecurity: RequestHandler)
```

调用方向：

```text
Express route
-> input validation
-> mutationSecurity（写操作）
-> AgentPluginFacade
-> PluginInstallService / adapters
```

Router 不直接调用 SQLite Plugin Repository。

### 9.3 Workspace Runtime Router

```ts
createWorkspaceRuntimeRouter(
  workspaceRuntime: AgentWorkspaceRuntimeFacade,
  mutationSecurity: RequestHandler,
)
```

调用方向：

```text
HTTP
-> Workspace Runtime Facade
-> Workspace Runtime Service
-> Workspace Runtime Repository / Controller Port
-> Runner HTTP Adapter
-> Host Runner
```

HTTP 层不直接拼 Runner URL / token / sandbox command。

---

## 10. HTTP Error Mapping

`agent-http.ts` 只保留：

```text
agentRequestId()
agentData()
agentError()
agentRoute()
mapAgentError() lookup
500 fallback logging
```

领域映射位于：

```text
interfaces/http/agent/agent-error-rules/
├── common.ts
├── providers.ts
├── artifacts.ts
├── integrations.ts
├── workspace-runtime.ts
├── collaboration.ts
├── plugins.ts
├── runs.ts
├── rule.ts
└── index.ts
```

`mapAgentError(error)`：

```ts
const raw = error instanceof Error ? error.message : String(error);
const rule = agentErrorRules.find((candidate) => candidate.matches(raw));
return rule?.mapping(raw) ?? INTERNAL_ERROR;
```

规则由：

```text
onCodes()
onPrefixes()
onCodesOrPrefixes()
rawCode()
```

声明。

错误规则只属于 HTTP presentation boundary；Domain 不应 import HTTP status code。

### 10.1 Frontend Agent API error boundary

Frontend Agent API 使用专用 transport wrapper：

```text
features/agent/api/agent-http-client.ts
features/agent/api/agent-api-error.ts
```

调用链：

```text
agentApi.* / workspaceRuntimeApi.*
-> agentHttpClient.get/post/put/patch/delete()
-> shared httpClient
-> Axios
```

任何失败在 Agent transport boundary 统一转换：

```text
normalizeAgentRequest()
-> toAgentApiError(cause)
-> AgentApiError {
     code,
     message,
     status,
     details,
     requestId
   }
```

UI 展示错误统一调用：

```ts
formatAgentApiError(cause, fallback);
```

因此 Vue 组件不再解析：

```text
cause.response.data.error.message
cause.response.data.error.code
```

当前使用该 boundary 的主要组件包括：

```text
OperationsView.vue
WorkspaceRuntimePanel.vue
WorkspaceRuntimeSettings.vue
PluginManagementSettings.vue
ArtifactPicker.vue
ArtifactLibraryView.vue
AppManagementSettings.vue
AgentSettingsPanel.vue
```

`agentHttpClient` 只包装 Agent API 模块内部请求，不修改全局 Axios error contract，避免 Agent-specific envelope 影响 Auth / Workspace / 其它非 Agent HTTP 调用。

---

## 11. Plugin 调用边界

Composition：

```text
bootstrap/agent/compose-plugins.ts
```

关键 concrete dependency：

```text
SqliteAppStorageRepository
LocalPluginBackendRuntimeAdapter
SqlitePluginInstallRepository
TarPackageVerifierAdapter
ArtifactPluginPackageSourceAdapter
PluginInstallService
```

主调用方向：

```text
Plugin HTTP Router
-> AgentPluginFacade
-> PluginInstallService
-> package verifier / package source / install repository
-> LocalPluginBackendRuntimeAdapter（需要 runtime 时）
```

Package storage 当前只认新布局：

```text
data/agent/plugins/<pluginId>/
  staging/
  versions/<version>/
    frontend/
    backend/
    runner/
    skills/
  dev/                    # optional
```

禁止恢复旧兼容 migration：

```text
agent/plugin-staging
agent/plugin-ui
plugins/<id>/<version> legacy layout
```

Plugin frontend 是独立 origin / CSP / iframe sandbox boundary，不应回到 frontend container 直接 mount package UI。

---

## 12. Workspace Runtime 调用边界

总体链：

```text
Agent HTTP / Agent Tool
-> Workspace Runtime Facade
-> Workspace Runtime Service
-> Workspace Repository
-> WorkspaceRuntimeControllerPort / WorkspaceRuntimeGatewayPort
-> RunnerHttpAdapter
-> Host Runner
-> bubblewrap Workspace sandbox
```

稳定概念：

```text
Workspace ID = stable identity
Profile      = recipe/toolchain/plugins/resources/network
Generation   = frozen executable generation
```

Toolchain Profile fingerprint：

```text
runtimeDigest + exact sorted packRefs
```

因此：

```text
Workspace A profile cache != Workspace B different ABI profile cache
```

即使两者共享全局 immutable Tool Store。Tool Store 的具体持久化由：

```text
agent-runtime/controller/toolchain-store.ts
```

负责，关键函数为：

```text
ToolchainStore.path(ref)
  -> packs/<familyId>/<versionId>/<contentDigest>

ToolchainStore.installed(ref)
  -> 校验 .nexus-install.json + immutable root mode

ToolchainStore.commit(stagingPath, ref)
  -> 已存在同一 ref 时删除 staging，不创建 Workspace 私有副本
  -> 未存在时 atomic rename 到全局 digest path
```

远程 Docker smoke 会同时创建 A/B 两个 Workspace，并在多版本切换完成后显式检查 base-tools 与两组 Node/Python/Go 的每个 `family/version` 只有一个 immutable digest 目录，防止同一 PackRef 被重复物化。

Runner materialization 由：

```text
agent-runtime/src/controller/pack-installer.ts
```

负责。

当前 mise 模式：

```text
Catalog: mise://<installerVersion>/<family>/<version>
Runtime: /usr/local/bin/mise
```

Runtime 验证实际 installer version；发行 pin/SHA/latest stable policy 放在 prepare/check/CI，而不是散落 Runtime。

mise materializer 的 bubblewrap `/etc` 与普通 Workspace sandbox 不同：

```text
sandboxSystemRuntimeArguments({ includeEtc: false })
-> 不把宿主整个 /etc 绑定进 materializer

materializerEtcRuntimeArguments(resolverSnapshot)
-> 创建新的 /etc
-> 只读挂载 /etc/ssl 与存在的 host.conf / hosts / nsswitch.conf / gai.conf
-> 把启动前复制的 resolverSnapshot 挂成普通 /etc/resolv.conf
```

这样既给下载阶段提供 DNS/NSS/TLS 必需输入，又不会因为宿主 `/etc/resolv.conf -> /run/...` symlink 而要求暴露宿主 `/run`。Verifier 和普通 Workspace/Plugin sandbox 仍使用默认 `sandboxSystemRuntimeArguments()`，此次 materializer 特例不改变它们的 system runtime view。

Bubblewrap 同理：Runtime 只调用稳定 `bwrap` 并验证实际 sandbox capability；发行版本策略放 prepare/check/build。

---

## 13. Frontend Workspace Runtime

父组件：

```text
features/agent/runtime/WorkspaceRuntimePanel.vue
```

只负责：

```text
Catalog / Workspace / Plugin / Artifact refresh
active Workspace selection
selected Plugin target
shared busy/error/notice
真实 agentApi side effect
```

子组件：

```text
WorkspaceCreateCard.vue
WorkspaceToolchainCard.vue
WorkspacePluginGrants.vue
WorkspaceArtifactTransfer.vue
```

调用模式：

```text
child local draft/form state
-> emit domain action
-> WorkspaceRuntimePanel
-> agentApi.*
-> refresh / error orchestration
```

子组件不直接持有全局 refresh authority。

主要父层 API 调用包括：

```text
agentApi.workspaceRuntimeCatalog()
agentApi.workspaces()
agentApi.createWorkspace()
agentApi.workspaceAction()
agentApi.switchWorkspaceToolVersions()
agentApi.workspaceGrants()
agentApi.replaceWorkspaceGrants()
agentApi.exportWorkspaceArtifact()
agentApi.importArtifactToWorkspace()
```

---

## 14. ACP / Browser / MCP 保留边界

### ACP

保留：

```text
AcpAdapter
AcpRuntimePort
AcpTransportPort
ACP Integration schema
integration.acp.execute capability type (roadmap only)
```

当前不宣称 live ACP execution 已完成；`nexus.operations` manifest 不声明该 capability，也不会创建默认 grant。

未来调用方向应保持：

```text
Agent Runtime
-> ACP Runtime Port
-> ACP Transport
-> permission event
-> Nexus Approval / Policy
```

### Browser/CDP

保留：

```text
PuppeteerBrowserGateway
BrowserGatewayPort
BrowserEndpointPort
browser Workspace kind
browser.operate capability type (roadmap only)
puppeteer-core
```

当前 `nexus.operations` manifest 不声明 `browser.operate`，也不会创建默认 grant；Browser/CDP/Puppeteer 代码只保留后继接线骨架。

未来方向：

```text
Workspace Profile
-> Browser runtime preparation
-> CDP endpoint binding
-> PuppeteerBrowserGateway
-> click/type/navigation/snapshot
-> download -> Artifact
```

### MCP

现有方向：

```text
IntegrationService / Tool contribution
-> McpAdapter
-> outbound policy
-> remote MCP endpoint
```

MCP 是真实 integration boundary，不应因为 adapter 数量优化而合并进 Provider 或 HTTP 层。

---

## 15. Remote SSH / Local Workspace Runtime 边界

不要为了“Runtime 统一”把所有 Terminal 放进 Runner。

可共享 Workspace Runtime 的 future execution：

```text
Agent one-shot job
Runner Plugin session
future local Terminal / PTY
CI/task execution
```

它们共享：

```text
Workspace identity
Profile
Generation
Toolchain
Filesystem
Sandbox
```

但以下继续属于远程连接/session runtime：

```text
SSH Terminal
SFTP
Remote Docker
RDP/VNC
```

例如现有：

```text
modules/workspace/WorkspaceTerminalService
```

不应该为了名称统一强制改成 Local Runner adapter。

### 15.1 远程 Workspace transport 的 diagnostics / performance 边界

`main -> dev` 同步后，现有 Nexus SSH Workspace transport 增强了低频 dispatch diagnostics，但 owner 没有变化：

```text
interfaces/http/http-application.ts
interfaces/websocket/websocket-server.ts
interfaces/websocket/workspace-protocol.session.ts
modules/workspace/workspace-session-registry.ts
platform/execution/execution-session-manager.ts
frontend/runtimes/workspace/protocol/workspaceSocket.ts
frontend/runtimes/workspace/session/workspaceRuntimeRegistry.ts
```

具体约束：

```text
startRuntimePerformanceReporter()
  -> 仅 logger trace level 开启 runtimePerformanceMetrics collection

WorkspaceProtocolSession.handleMessage()
  -> terminal.input / terminal.resize / docker.stats 不写逐请求 trace
  -> 其它 control request 才写 sparse dispatch trace
  -> binary download/preview response 仍按 dev 的 binary framing/backpressure 状态机完成

WorkspaceSocket.requestInternal()
  -> PendingRequest.operation 只用于 diagnostics
  -> expectBinary/responseReceived/binaryDone 仍决定 binary request 何时 resolve

HTTP / WebSocket / ExecutionSession lifecycle
  -> debug/warn/error 只补失败、连接、关闭与超时诊断
  -> 不取得 Agent Capability / Policy / Approval / Lease / StateCommit authority
```

因此这些 diagnostics 属于远程 Workspace transport 可观测性，不得被当作 Agent Workspace Runtime 的执行/安全 owner，也不得为了日志复用把两套 runtime 合并。

---

## 16. 允许与禁止的后续拆分

### 允许

```text
compose-agent.ts
  -> compose-runtime.ts
  -> compose-collaboration.ts
  -> compose-integrations.ts
  -> compose-capabilities.ts

agent.routes.ts
  -> runs.routes.ts
  -> collaboration.routes.ts
  -> artifacts.routes.ts
  -> settings.routes.ts

sqlite-state-commit.adapter.ts
  -> model-transitions.ts
  -> approval-transitions.ts
  -> mutation/tool-transitions.ts
  -> subagent-transitions.ts
```

前提：StateCommit transition 始终接收同一个 `tx`。

### 禁止

```text
sqlite-state-commit
  -> 多个独立 Repository 各自 transaction

NativeAgentBackend mutation lifecycle
  -> generic mutation helper 吞掉 durable ordering

Subagent scheduler durable queue
  -> process-local queue 替代 claim/settle CAS

LeaseCoordinator
  -> Run/Tool/Approval state machine owner

HTTP error mapping
  -> Domain service 返回 HTTP status
```

---

## 17. 后续修改时的文档同步规则

从本文件建立后，Agent 结构性修改需要同步更新文档：

1. 新增/删除 Port、Adapter、Service：更新本文件的模块和具体方法调用关系；
2. 改变 mutation / approval / lease / durable transition 顺序：必须同时更新本文件和 `CURRENT_AGENT_ARCHITECTURE.md`，并做安全复核；
3. Workspace Runtime / Plugin / ACP / Browser 边界变化：同时检查 `IMPLEMENTATION.md`；
4. 仅物理移动、不改变调用边界：更新文件路径即可；
5. 不允许代码已经改变 authority，而文档仍描述旧 authority。

本文应作为 Agent 结构复审和后续代码拆分的持续维护基线。
