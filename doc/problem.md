# Nexus Terminal 当前问题与整改进度

> 状态：仅保留**当前未完成**的问题与整改项。
> 已完成、已排除、历史复现与验收证据不再保留在本文件；需要追溯时以 Git 历史、对应提交与长期架构文档为准。
> 更新规则：问题关闭后直接从本文件删除，不再追加 `✅ 已关闭` 历史段。全部条目清零后，本文件可清空。
> 当前复核日期：2026-09-26。

## 1. 当前开放问题

## 2. 前端架构待整改项

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

1. **现存正确性问题**：优先 §7.47 / 50，再处理 §7.48 / 49。
2. **状态与数据层**：FE-ARCH-09 / 10 / 11 / 12。
3. **UI 与领域结构**：FE-ARCH-13 / 14 / 15。
4. **严格类型增强**：FE-ARCH-16。

当某项完成并验证后，直接从本文件删除；不保留关闭记录。
