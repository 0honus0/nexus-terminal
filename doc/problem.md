# Nexus Terminal 当前问题与整改进度

> 状态：仅保留**当前未完成**的问题与整改项。
> 已完成、已排除、历史复现与验收证据不再保留在本文件；需要追溯时以 Git 历史、对应提交与长期架构文档为准。
> 更新规则：问题关闭后直接从本文件删除，不再追加 `✅ 已关闭` 历史段。全部条目清零后，本文件可清空。
> 当前复核日期：2026-09-26。

## 1. 当前开放问题

### §7.45 对象型 dirty-state 依赖 JSON insertion order（P2）

**当前代码事实**

`AppExecutionPolicySettings.vue` 仍使用：

```ts
JSON.stringify(draft.value) !== JSON.stringify(view.value?.overrides ?? {});
```

用户删除再恢复同一个 key 后，语义值可以完全相同，但对象键顺序不同，导致假 dirty。

**整改目标**

使用稳定 canonical compare、排序 entries，或按允许字段逐项比较；对象 insertion order 不得成为业务状态的一部分。

**关闭条件**

值相同但键顺序不同的 overrides 判定为 clean，并有回归覆盖。

### §7.46 `userSummary` 仍进入模型可见 `payload.text`（P1）

**当前代码事实**

以下 state-commit 路径仍把 `userSummary` JSON.stringify 进模型证据 `text`：

- approval denied
- approval expired
- approval superseded
- run cancelled before tool execution

普通工具结果已经有正确的 `toolResultLedgerPayload()`：模型证据放 `text`，用户本地化摘要放 sibling `payload.userSummary`。

**整改目标**

四条路径统一走同一投影 helper，或至少保证 `userSummary` 只存在于 ledger sibling，绝不进入 model-facing JSON。

**关闭条件**

测试同时断言：UI payload 有 `userSummary`；解析 `payload.text` 后不存在 `userSummary`。

### §7.47 Run `cancelling` 时 Send 仍可进入后端必拒绝路径（P1）

**当前代码事实**

- Backend 明确把 `cancelling` 判为 `RUN_NOT_ACCEPTING_INPUT`。
- Frontend `nonTerminal` 包含 `cancelling`。
- `canSend()` / `send()` 仍会把该状态当作可 append-input 的 active Run。

**整改目标**

建立明确的 `acceptsInput(status)` 语义，不能继续用 `nonTerminal` 代替；至少排除 `cancelling`，并给用户显示正在停止的禁用原因。

**关闭条件**

Run cancelling 窗口内发送按钮不可触发 append-input，请求层不会产生必然失败的调用。

### §7.48 Hub model option hint 仍低于阅读文字 floor（P1）

**当前代码事实**

`AgentAppSurface.vue` 的 model option hint 仍为 `text-[9px]` 阅读文本。其它 9/10px 命中多数是 icon/badge，不属于本问题。

**整改目标**

真实阅读文本恢复到既定最小字号；icon/badge 可以按视觉用途保留更小尺寸。

**关闭条件**

Agent UI 的非 icon/badge 阅读文本扫描不再发现低于 floor 的实例。

### §7.49 英文 UI literal / i18n 仍有漏网（P2）

**当前代码事实**

仍能找到用户可见英文 literal，例如：

- `AppManagementSettings.targetLabel()` 的 `Workspace`
- `BrowserRuntimeSettings` 的 `ID "..." already exists.`
- `ModelProviderSettings` 的 `owned by ...`
- 模型能力 badge 的 `Tools`

Agent 子导航 `aria-label` 已经走 i18n，不再属于本项。

**整改目标**

补齐三语 key/label helper，并增强 i18n 静态门禁，使英文用户文案、label helper 返回值、accessibility 文案都能被扫描，而不是只查 CJK。

**关闭条件**

已知 literal 清零，门禁能重新抓出等价回归。

### §7.50 跨标签页修改配置后其它 tab 不刷新（P2）

**当前代码事实**

BroadcastChannel / host event 已传播 thread / authorization / memory 等事件，但没有完整传播 configuration/providers/settings changed。Tab A 修改 Provider/Settings 后，Tab B 已打开的 Hub 或 Settings 仍可能持有旧 definitions/providers/settings/version。

**整改目标**

为 configuration/apps/authorization 等变化定义明确跨 tab sourceType；接收端做 generation-safe authoritative reload。若本地存在 dirty draft，只更新 baseline/version，不覆盖草稿。

**关闭条件**

双 tab 回归覆盖 Provider/Settings 修改、Hub 更新、Settings baseline/version 更新，以及 dirty draft 保留。

### §7.51 全前端 ESLint 覆盖仍不完整（P2）

**当前代码事实**

`eslint.config.mjs` 的完整 TypeScript/Vue profile 仍主要覆盖 Agent；`foundation/ui` 与普通 frontend feature 尚未统一进入同一 lint 基线。

**整改目标**

统一覆盖 `packages/frontend/src/**/*.{ts,vue}`，至少启用正确 parser、unused 检查和 Vue correctness，再渐进启用 type-aware 规则。

**关闭条件**

全 frontend lint 成为正式脚本/CI 门禁，`foundation/ui` 和普通 feature 能直接 lint 而不是 parser failure 或规则缺失。

## 2. 前端架构待整改项

### FE-ARCH-04 shared / foundation 公共边界

**状态：🟠 待整改**

当前 boundary guard 主要覆盖 features/runtimes。仍有：

- `App.vue` deep-import `shared/feedback/components/*`
- foundation 的 `useDeviceCapabilities` / `overlayStack` / `BaseModal.vue` 等直接文件引用

目标规则：

```text
features/*  -> public.ts
runtimes/*  -> public.ts
shared/*    -> public.ts
foundation/{ui,browser,interaction,async} -> index.ts
```

扩展 guard，并先消除现有违规。

### FE-ARCH-05 public contract guard 语义收紧

**状态：🟠 待整改**

现有 guard 能抓漏导，但不应把“实现文件里的所有 exported type”自动升级成产品级公共 API。

需要明确 public contract source，例如：

```text
contracts/*.ts
public-types.ts
public.ts 显式 re-export
```

只有设计上声明为 contract 的源文件才要求完整导出；普通实现文件允许 feature 内部 `export type/interface`。

### FE-ARCH-06 全前端 ESLint

**状态：🟠 待整改**

与 §7.51 同一整改项。先完成全 frontend parser/基础 correctness/no-unused 覆盖，再逐步打开 type-aware 规则，避免一次性制造大量机械 suppress。

### FE-ARCH-07 unit / component test 层

**状态：🟠 待整改**

`packages/frontend` 当前没有正式 `*.spec.ts` / `*.test.ts` 单元或组件测试层。

需要引入 Vitest + Vue Test Utils，优先覆盖：

- store / composable / controller
- parser / canonical compare / persisted-state decoder
- request generation / stale response guard
- 不依赖真实浏览器的状态机与边界行为

E2E 继续负责真实跨栈用户路径，不用它替代所有前端逻辑测试。

### FE-ARCH-08 状态生命周期统一

**状态：🟠 待整改**

当前同时存在：

- Pinia store
- factory/session controller
- module-scope reactive singleton

优先收口：

- `useFilesystemCatalog`
- `useSuspendedSessions`
- workspace layout/focus
- Agent per-app view state
- store 文件外的 `loadPromise` / `cacheGeneration` / revision 等生命周期变量

约定目标：app/user-global state 有明确 store/service owner；session/runtime state 由 factory/controller 创建；纯 utility 无状态；不靠 import module 隐式形成 singleton。

### FE-ARCH-09 authenticated session teardown

**状态：🟠 待整改**

`App.vue` 仍手工维护多个 `resetXxxCache()`。新增 user-scoped feature 时容易漏 reset。

需要建立统一 authenticated-session lifecycle：attach / user-changed / logout / dispose，由 user-scoped owner 注册 teardown/reset，而不是 composition root 维护越来越长的手工清单。

### FE-ARCH-10 Workspace data access 边界

**状态：🟠 待整改**

`workspace/layout` 与 `workspace/focus` 仍直接使用 `httpClient`。

需要下沉到 workspace adapter/repository/API owner；layout/focus 只管理 domain state 和交互语义，不直接认识 transport client。

### FE-ARCH-11 typed / versioned browser persistence

**状态：🟠 待整改**

localStorage/sessionStorage 分散在 Dashboard、Connections、Workspace、Agent、Transfers、Quick Commands 等模块，并存在 `JSON.parse(...) as ...` 的信任式读取。

需要统一：

- typed decoder
- schema version
- migration
- scoped key builder（尤其 user/session scope）
- read/write/remove helper

### FE-ARCH-12 UI runtime error boundary

**状态：🟠 待整改**

已有 `window.error` / `unhandledrejection` 诊断，但缺 surface 级用户可见 error boundary。

优先覆盖 Agent、Workspace、Preview：组件树异常应被局部隔离并提供 fallback/retry，而不是只写日志或拖垮整个 surface。

### FE-ARCH-13 Design System 收敛

**状态：🟠 待整改**

`foundation/ui` 里 `Base*` 与 `Ui* Gen2` 是两套独立实现，且两边仍有大量真实调用。

需要明确 Gen2 为唯一目标体系，补齐缺失 primitive 后逐 feature 迁移：

```text
Base* -> Ui* Gen2 -> 删除旧 Base 实现
```

迁移必须统一 props 语义、density、focus/a11y、disabled、theme token 和 form behavior，而不是只改 class。

### FE-ARCH-14 横向 feature 耦合收口

**状态：🟠 待整改**

当前无顶层依赖环，但横向依赖较强：

```text
connections -> proxies / remote-desktop / ssh-keys / tags
transfers   -> connections / tags
agent       -> auth / connections / terminal
```

优先把 Transfers target selection、Agent runtime capability 等改成 port/adapter/composition 注入，避免继续扩大 feature-to-feature API。

### FE-ARCH-15 大型 SFC 与子系统内部边界

**状态：🟠 待整改**

当前高风险大文件包括：

- `AgentAppSurface.vue` ~3231 行
- `FileManager.vue` ~2480 行
- `ModelProviderSettings.vue` ~2457 行
- `WorkspaceSessionSurface.vue` ~1740 行
- `TerminalView.vue` ~1332 行
- `StatusMonitor.vue` ~1319 行

先完成 lint/unit-test 安全网，再按 controller/state-machine/presentation 拆分。Agent 与 Workspace 还需要内部二级依赖边界，防止子目录之间形成新的双向耦合。

### FE-ARCH-16 TypeScript strictness 第二阶段

**状态：🟠 待评估**

当前已经 `strict: true`。后续按 feature 渐进评估：

```text
noUncheckedIndexedAccess
exactOptionalPropertyTypes
```

不得通过批量 `!` / `as` 机械消错；只有真正改善 contract 精度时才推进。

## 3. 实施顺序

1. **安全网**：FE-ARCH-04 / 05 / 06 / 07，同时关闭 §7.51。
2. **现存正确性问题**：优先 §7.46 / 47 / 50，再处理 §7.45 / 48 / 49。
3. **状态与数据层**：FE-ARCH-08 / 09 / 10 / 11 / 12。
4. **UI 与领域结构**：FE-ARCH-13 / 14 / 15。
5. **严格类型增强**：FE-ARCH-16。

当某项完成并验证后，直接从本文件删除；不保留关闭记录。
