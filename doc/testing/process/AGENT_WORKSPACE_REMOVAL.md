# Agent Workspace 移除执行进度

对应计划：[AGENT_WORKSPACE_REMOVAL_PLAN.md](../AGENT_WORKSPACE_REMOVAL_PLAN.md)。

记录原则：只根据已核实的源码、运行结果或正式发布证据更新状态；未运行成功的检查不记为通过。每次推进一项并在这里补充证据、阻塞和下一步。执行到 P7 之前，不把目标状态改写成当前软件事实。

## 0. 项目所有者要求与新会话接手指令

**这里是 Workspace Remove 实施的唯一过程文档。后续会话必须先读本节及下方最新进度，无须重新问已明确的执行要求。**

1. **按计划逐项执行**：以 `doc/testing/AGENT_WORKSPACE_REMOVAL_PLAN.md` 的 P0→P7、每阶段工作内容与完成条件为准；一次专注一个能验证、能提交的事项，不跨越没有满足的前置条件，也不为了完成数量而删代码。
2. **及时同步进度**：每次任务开始、取得证据、验证失败/通过、状态变化或出现阻塞，都更新**本文件**。本文件同时保存项目所有者的要求、已完成项、证据、阻塞、未提交状态和明确的下一步入口；不要再建立第二份 progress/process/handoff 文件。
3. **以新会话可以直接继续为标准**：新会话先检查当前工作区 `git status`、HEAD、分支及有无其他人新改动，然后读 `doc/AGENTS.md`、正式 `doc/USAGE.md`、本文件、关联计划和受影响代码。以现场事实为准；遇到与记录冲突的情况先核查，而不是覆盖旧改动。
4. **保留用户已有工作**：初始未跟踪的 `doc/testing/AGENT_WORKSPACE_REMOVAL_PLAN.md` 属于用户已有文件，不删除或覆盖；普通终端 Workspace、SSH 标签/挂起与文件管理、E2E Runner 镜像、Artifact/Memory 等计划明示的保留能力也不可误删；存量 Workspace 项目、数据库和 Plugin 用户数据未经核对绝不执行破坏性清理。
5. **环境隔离**：工作区为 `/home/honus/nexus-terminal`、分支 `dev`；测试、缓存和临时 Node/pnpm 使用 `/home/honus/workspace`，不改系统工具链。每次执行项目脚本前运行 `. /home/honus/workspace/cache-env.sh`（在仓库根运行时为 `. ../workspace/cache-env.sh`）。Node `v26.11.1`、pnpm `11.26.0`；下载/缓存不放入代码仓库。Codex 自身 `TMPDIR` 使用其沙箱目录。
6. **代码/验证/提交纪律**：依照 `doc/AGENTS.md`，先核实真实 owner、协议和消费者，再同步改生产代码与相关有效文档，保留真实 E2E/Agent 场景与反例，不新增 unit tests 或测试源码文字门禁。按实际风险运行检查；每个完整单项应单独本地提交，**不自动推送**。提交前检查工作区残余、引用、`pnpm run check`、`pnpm run format:all:check` 和 `git diff --check`，结果记录在此；未通过或不能验证的事项不得标记完成。
7. **外部依赖不冒认完成**：官方 `0honus0/nexus-agent-plugins` 签名新版、实际部署实例版本、旧 Workspace 枚举/导出、旧备份恢复、最终远程 CI 均需要独立证据；不能凭本仓 fixture、公开版本或静态 grep 假称验收通过。

为使明确的临时过程记录与仓库通用“`doc/` 不建进度文件”规则不冲突，本次同步在 `doc/AGENTS.md` 的“文档维护分工”与“修改与文档”段落声明**仅此文件**的项目所有者授权例外；`AGENTS.md` 仍是全局开发规则入口，`USAGE.md` 仍是唯一用户需求入口。

**新会话具体启动顺序**：

```sh
cd /home/honus/nexus-terminal
git status --short --branch
git rev-parse HEAD
cat doc/AGENTS.md
cat doc/testing/process/AGENT_WORKSPACE_REMOVAL.md
cat doc/testing/AGENT_WORKSPACE_REMOVAL_PLAN.md
. /home/honus/workspace/cache-env.sh
node --version && pnpm --version
# 从下方「当前工作指针」继续一项，改完先更新本文件再检查与本地提交
```

**当前工作指针（2026-10-08）**：P0-2 消费者/owner 矩阵已完成；下一项为 **P0-5 旧部署资源清点/导出/终止链实际核对**，同时补齐 P0-1 的 E2E 和实际部署版本、P0-4 外仓替代版本。P0 尚未通过阶段完成门槛，暂不实施 P1 破坏性 contract 或 P2 删表。独立 Node/pnpm 下 `pnpm run check`、`pnpm run format:all:check`、`pnpm run build` 已通过。Agent 场景整体失败 1 项，且独立复现，见下方证据。

## 阶段状态（2026-10-08）

| 阶段                         | 状态   | 说明                                                                                   |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------- |
| P0 清单与升级边界            | 进行中 | P0-2 消费者/owner 映射已完成；工具链与 build/check 通过，场景基线失败；P0-1/4/5 未闭环 |
| P1 最终 contract 与迁移方案  | 未开始 | 等待 P0 边界确认                                                                       |
| P2 存量数据、升级与备份      | 未开始 | 不在开发过程中直接删除真实数据                                                         |
| P3 Backend SSH 收敛          | 未开始 |                                                                                        |
| P4 Browser、ACP、Plugin 解耦 | 未开始 |                                                                                        |
| P5 Frontend 移除             | 未开始 |                                                                                        |
| P6 生产 Runner 退出          | 未开始 |                                                                                        |
| P7 文档与验收                | 未开始 |                                                                                        |

## P0：逐项执行记录

- [ ] **P0-1：起点、已发布版本、schema/SDK/备份版本与可重复测试基线。** 版本与起点已核实，基础 check 通过；仍待 build、E2E、实际部署版本与升级演练数据，整项未完成。
  - 起点：分支 `dev`，HEAD `f0461a4692fd65ecee2cdd9a19da9114f2cadf4d`（2026-10-08）；`origin/dev` 无领先/落后。起点前存在未跟踪 `doc/testing/AGENT_WORKSPACE_REMOVAL_PLAN.md`，视作用户工作，保持不变。
  - 本地根、Protocol 与 Agent Runner package 版本 `1.0.2`；GitHub `0honus0/nexus-terminal` 最近公开 Release 为 `v1.0.1`（2026-09-13）。这只证明公开发布记录，**不证明实际部署实例正在使用该版本**；升级演练前还须确认目标实例版本。
  - SQLite 已定义 migration 的最高 id 为 `54`（`packages/backend/src/infrastructure/database/migrations/agent-host.ts`）；列表 owner 为 `migrations/registry.ts`。这不是针对目标生产库已执行迁移的证明。
  - 备份外层 envelope `BACKUP_VERSION=1`，`BackupSnapshot.version=1`；插件 manifest `schemaVersion=1`，当前 Host 支持插件 SDK major `1`；自带 fixture 的 `sdkVersion=1.0.0`。
  - 基线命令 `pnpm run check` **未进入检查**：pnpm 返回 `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`（store 锁权限拒绝）。另一次 `node --version` 返回 `Permission denied` / `LANDLOCK_READ_ROOT_BLOCKED`（`/usr/local/bin/node` 不在执行环境允许读取的根目录）。环境权限问题未修复前，不声称 lint/type/build/E2E 通过。
  - 2026-10-08 再检查：在 `/home/honus/workspace/cache` 创建独立缓存，并在仓库外 `/home/honus/workspace/cache-env.sh` 统一配置 pnpm/npm/Corepack/XDG/Playwright/pip 缓存；`TMPDIR` 仍由 Codex 沙箱专用临时目录管理（改到工作区会触发 `TMPDIR_NOT_WRITABLE`）。即使额外设置 `HOME=/home/honus/workspace`，pnpm 的 package-manager engine 锁权限仍然失败。需要 Codex 执行环境放行 Node 可执行路径及 pnpm 管理器所需目录；仅改项目缓存路径尚不足以完成基线。
  - 2026-10-08 独立工具链修复：`.node-version` 指定 `node`（Current），从 Node 官方 `nodejs.org/dist` 下载 `v26.11.1`（Linux x64），校验 SHA-256 匹配官方 `SHASUMS256.txt`，解压至 `/home/honus/workspace/toolchains/node/node-v26.11.1-linux-x64/`；npm 为 `11.20.0`。通过 npm 将项目固定的 pnpm `11.26.0` 安装至 `/home/honus/workspace/toolchains/npm-global/`，并将两个独立 binary 路径 prepend 到 `/home/honus/workspace/cache-env.sh` 的 `PATH`。系统 Node/pnpm 保持不变。
  - 修复后经 `. ../workspace/cache-env.sh && pnpm run check`：Frontend ESLint、Agent ESLint、Frontend type check、Backend type check、Agent Runner type check 全部 PASS；原本的系统 Node/pnpm 沙箱权限阻塞可绕过。
  - 新一轮 `. ../workspace/cache-env.sh && pnpm run build` **PASS**（Backend tsc + 文件复制、Frontend vue-tsc/Vite、Agent Runner tsc，exit 0）。`pnpm run format:all:check` 已在修正本进度 Markdown 格式后 **PASS**，`git diff --check` **PASS**。
  - `pnpm --filter @nexus-terminal/backend run test:agent-scenarios` **exit 1**：`FAIL context/tool-exchange-atomicity`，其余场景仍可见 PASS；失败来自 `ContextService.compose` 的 `CONTEXT_BUDGET_EXCEEDED`，堆栈是 `context.service.ts:500` → `tests/backend/agent-scenarios/context-tool-exchange.scenario.ts:23`。后者用 `maxContextTokens` [273, 320, 384, 512, 768, 1024] 循环验证原子工具调用历史保留；至少首个预算已不足以放下 safety 指令和当前输入。独立只运行该 scenario 的实际导出后仍得到同样 `CONTEXT_BUDGET_EXCEEDED`（exit 1），说明不是并发波次导致，但**尚不能断言是产品缺陷还是场景预期已过时**。P0 范围外不通过改小真实安全指令或降低断言来掩盖，后续需单独分析。
  - 待办：收集 Agent 场景完整失败细节和最终退出状态、受影响 E2E 基线，并记录实际部署版本。
- [x] **P0-2：完成生产消费者和迁移/保留 owner 映射。** 见下方逐条矩阵；它确认源代码的修改入口与处置 owner，**不意味着这些修改已经实施或验证**：
  - Frontend：`features/agent/host/useAgentAppController.ts`、`api/workspace-runtime-api.ts`、`runtime/WorkspaceRuntimePanel.vue`、`runtime/AgentWorkspaceTerminal.vue`、`settings/WorkspaceRuntimeSettings.vue`、三语 i18n；普通终端 Workspace 是**保留**边界。
  - Backend：`bootstrap/agent/compose-workspace-runtime.ts`、`compose-agent.ts`、`modules/agent/workspace-runtime/`、`infrastructure/agent/workspace-runtime/`、`interfaces/http/agent/workspace-runtime.routes.ts`、`interfaces/websocket/agent-terminal-protocol.session.ts`。
  - 持久化/备份：`infrastructure/database/schema/agent-workspace.ts`、`migrations/agent-host.ts`、`infrastructure/backup/sqlite-backup-snapshot.adapter.ts` 目前仍包括 Workspace 三张表；SSH 数据需独立保留。
  - Protocol：`agent-workspace-runtime.ts`、`agent-terminal.ts`、`agent-host.ts`、`agent-runs.ts`、`agent-plugins.ts` 和 `runner.ts`；只删除 Agent 专属 contract，不触碰普通终端协议。
  - 构建/部署/E2E：`packages/agent-runner/`、`scripts/docker/agent-runner/`、`scripts/e2e/standalone-runner-image-smoke.sh`、`.github/workflows/publish-ghcr.yml`、`tests/e2e/fixtures/agent/workspace-runner.mjs` 等仍有消费者。
  - 复核结论：Browser、SSH ACP、Subagent、Checkpoint、旧备份、UI 暂存、官方插件分别进入下方矩阵，所有映射属于**待实施的计划**，不能误报代码已退出 Workspace。
- [x] **P0-3：确认 SSH-only 范围和退出说明（目标 contract，不是已经实施）。** 执行规则：新文件/Shell/Job request 必须显式 `target:'ssh'` 与受权 id；删除 `workspace.manage`、`target:'workspace'`、Environment/Recipe/Generation、Workspace Terminal、workspace_create/control/toolchain_switch、Workspace checkpoint 复原和 Runner Plugin execution。不建立任何 Backend 本地 Shell/文件 target 或默认 `No Workspace` 兼容分支；未选/未授权/伪造旧 target 一律 fail closed，不重选“当前 SSH 标签”执行。保留普通终端、SSH 连接/长会话/后台 Job/项目目录、Browser 独立 CDP、SSH ACP、MCP、Artifact/Memory/Skill、Plugin Frontend/Backend、Run/Thread/审批/Checkpoint 历史证据。此处仅锁定移除边界，P1–P7 仍须真正修改并验收。
- [ ] **P0-4：官方签名插件替代版本。** 已核对公开 `0honus0/nexus-agent-plugins` 最新 Release `v1.0.0`（2026-09-21）：该标签的 `nexus.agent` manifest 仍声明 `workspace.manage`，`nexus.fullstack` 仍有 `targets.runner`。**正式替代发布尚无验收证据**；在确认签名新版和 Host SDK 适配前，不可将 P4/P6 标为完成。
- [ ] **P0-5：旧 Workspace 活跃资源枚举、导出、终止与 retained 处置可执行。** 尚未验证旧部署的真实数据与进程；不得在此之前进行破坏性迁移。

  **旧版可用的检查/处置 owner（只读核对，不是已完成清理）：**

  - Backend `workspace-runtime.repository.port.ts` 的 `listWorkspaces`、`listPendingCommands` 及 `workspace-runtime-management.service.ts` 的 preview/confirm 是旧控制面的入口；Runner `WorkspaceRuntimeGatewayPort.listActiveJobs`、`queryJob/waitJob/cancelJob` 有独立的执行状态语义；Runner `workspaceStatus` 和 `WorkspaceRuntimeControllerPort.openWorkspaceCheckpointArchive` 可观察或导出部分项目内容。
  - `WorkspaceArtifactService.export` 已通过现有 Artifact authority 导出文件；这不自动覆盖所有 retained Workspace。Runner PTY/ACP/Plugin process 需要从旧 Runner 和其 lifecycle owner 核实实际进程退出，不能依赖 Backend 状态或 WS close 猜测。
  - **待在真实旧实例/受控副本执行并留证**：冻结新 Workspace/Run 写入 → 枚举 `workspaceId/generation/status/retained`、pending/unknown commands、活跃 Job、PTY、ACP 和 Plugin processes → 导出需要保留的工作树/Manifest/Artifact → 校验 hash 和大小 → 备份 Backend DB、Runner DB/目录与签名 Plugin 包 → drain/终止并核实 OS/Journal 终态 → 记录不可达与未知副作用 → 明确旧项目卷不自动删除。任何步骤失败都暂停删除和升级。
  - 目前只有源码端的可操作性证据，**无部署实例 ID、活跃资源清单、归档 checksum 或 OS 退出证据**。用户先前已停止测试环境，故不主动假定有运行中的 E2E/Runner。P0-5 仍阻塞，必须在部署或可信数据副本准备好后才能打勾。

### P0-2 生产依赖/去向矩阵（2026-10-08 源码复核）

| 消费者/实际入口                                                                                                                                                                                                              | 最终处置与 owner                                                                                                                                                                                 | 不能忽略的条件                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Frontend Composer：`host/useAgentAppController.ts`、`host/AgentAppSurface.vue`、`api/agent-api.ts`                                                                                                                           | **移除** Environment/Recipe 选择、Catalog/availability 请求及请求 payload；**保留**模型、执行/审批、SSH 选择；Frontend Agent Host owner，P5                                                      | 活动 Run 的冻结配置不能随下一次选择改变                                                           |
| Frontend Agent Workspace：`runtime/TaskRail.vue` → `WorkspaceRuntimePanel.vue`，`AgentWorkspaceTerminal.vue`、`WorkspaceArtifactTransfer.vue`、`WorkspaceCreateCard.vue`、`WorkspaceToolchainCard.vue`                       | **移除** Panel、PTY/socket、文件交换和相关 API/i18n；Frontend Runtime owner，P5                                                                                                                  | 保留 Files Library、Artifact 与普通终端 UI                                                        |
| Agent Settings：`settings/AgentSettingsPanel.vue` → `WorkspaceRuntimeSettings.vue`，`AcpRuntimeSettings.vue`、`BrowserRuntimeSettings.vue`                                                                                   | **移除** Workspace 安装、存储、设置、并发等入口；**迁移** ACP 为 SSH-only、Browser 独立；Frontend Settings owner，P4/P5                                                                          | SettingsPanel 当前 `v-else-if` 受 `workspaceRuntime` availability 影响，必须解除加载阻断          |
| Frontend 暂存：`host/surface-session.ts` 的 `environmentRecipeId`                                                                                                                                                            | **定向移除**该 per-App 选择及 setter/getter；Frontend Host state owner，P5                                                                                                                       | `threadId`、`draft`、`modelKey`、`connectionIds` 和窗口/普通终端状态原样保留                      |
| Protocol：`agent-host.ts`、`agent-runs.ts`、`agent-workspace-runtime.ts`、`agent-terminal.ts`                                                                                                                                | **移除/迁移** Workspace DTO、capability、Run environment、checkpoint/Runner 字段；Protocol owner，P1/P3/P5                                                                                       | 文件/Shell 显式 `target: 'ssh'`，不能再接受 Workspace 或默认本地 fallback                         |
| Run admission/管理工具：`runtime/runs/run.service.ts`、`bootstrap/agent/tool-contributions.ts`、`tools/host/workspace-runtime-management-tools.ts`                                                                           | **移除** Environment Catalog admission、`workspace_create/control/toolchain_switch` 注册；Backend Run/Tool owner，P1/P3                                                                          | 不中断 Provider、Thread、Plan、审批、租约和 durable commit                                        |
| Backend composition + HTTP/WS：`bootstrap/composition-root.ts`、`compose-agent.ts`、`compose-workspace-runtime.ts`、`interfaces/http/agent/agent.routes.ts`、`interfaces/websocket/websocket-server.ts`                      | **移除** Workspace 子图、`/workspace-runtime` router、`/ws/agent-terminal`，解除 `BrowserRuntimeAdapter`/ACP transport 对 `RunnerHttpAdapter` 的注入；Backend composition/transport owner，P3/P4 | 普通 `/ws/agent`、SSH session 与其它 WebSocket 路由继续提供                                       |
| SSH 执行：`capabilities/target-resolver.ts`、`file-capability.service.ts`、`shell-capability.service.ts`、`infrastructure/agent/capabilities/ssh-{file,shell}-target.adapter.ts`、`agent-ssh-sessions.ts`                    | **迁移**到 SSH-only target；**保留**现有 SSH ports、Session、Job、授权/denylist/配置 hash；Backend capabilities/SSH owner，P1/P3                                                                 | 不开放 Backend 本地 Shell/文件；Child 不扩张 SSH mutation grant                                   |
| Browser：`tools/host/browser/browser-session-binding-authority.ts`、`infrastructure/agent/integrations/browser-runtime.adapter.ts`、`bootstrap/agent/tool-contributions.ts`                                                  | **迁移**：保留 configured-target、独立 CDP 与权限、Artifact 操作；移除 `workspaceBinding`、Generation 和 Runner tunnel 依赖；Backend Browser binding owner，P1/P4                                | 当前 authority 还有 `workspaceId`、`workspace.profile.browserTarget`、`workspaceGeneration` 前提  |
| ACP：`ai/integrations.types.ts`、`ai/integration.service.ts`、`infrastructure/agent/integrations/acp.adapter.ts`、`infrastructure/agent/integrations/ssh-acp-transport.ts`                                                   | **迁移**：去掉 `workspace-profile`，**保留** SSH transport、Integration 配置 hash 与内层审批、abort；Backend Integration/SSH ACP owner，P1/P4                                                    | 旧 profile 不能自动重选一个 SSH 连接                                                              |
| Subagent：`runtime/collaboration/subagent-context-builder.ts`、`subagent-profile-templates.ts`                                                                                                                               | **迁移**：去掉 coding Child 创建 Workspace 与 Workspace mutation 分支；**保留**协作队列、读取、Mailbox、预算；Backend collaboration owner，P3/P4                                                 | 当前允许 `workspace.manage` 的例外不能变成任意 SSH 写权限                                         |
| Recovery：`runtime/recovery/checkpoint.service.ts`、`workspace-checkpoint.service.ts`、`checkpoint.repository.port.ts`、`infrastructure/agent/repositories/sqlite-checkpoint.repository.ts`                                  | **移除** Workspace archive capture/restore 和 Workspace Job reconcile；**保留**历史证据、SSH-only safe continuation、Run recovery；Backend recovery owner，P2/P3                                 | 旧 Workspace checkpoint 标记项目不能恢复，不把旧 lease/Job 重放成成功                             |
| Storage/迁移：`infrastructure/database/schema/agent-workspace.ts`、`sqlite-schema.registry.ts`、`migrations/registry.ts`；`sqlite-conversation.repository.ts` 的 `THREAD_DELETE_WORKSPACE_ATTACHED`                          | **迁移**三个 Workspace 表、FK 与删除守卫；**保留** `agent_project_directories`、`agent_ssh_jobs` 并迁移至 SSH schema owner；Database owner，P2                                                   | 正式旧数据处置后才删在线表，已发布 migration 不可改写                                             |
| 备份：`infrastructure/backup/sqlite-backup-snapshot.adapter.ts`、`backup-codec.adapter.ts`、`modules/backup/backup.types.ts`                                                                                                 | **迁移**备份 payload、表白名单、Plugin 文件引用及旧版本转换；Backend Backup owner，P2                                                                                                            | 当前备份仍枚举 Workspace 三表和 `runner_entry`；旧数据无法安全转换须写入前拒绝                    |
| Plugin：`host/plugin-runner-target.port.ts`、`plugin-runtime-lifecycle-coordinator.ts`、`plugin-package-install-coordinator.ts`、`infrastructure/agent/plugins/tar-package-verifier.adapter.ts`、`protocol/agent-plugins.ts` | **迁移** Manifest/SDK/Runner target，**保留**签名、Backend/Frontend target、App Storage、进程/安装生命周期；Plugin owner，P1/P4                                                                  | 不能把旧 Runner entry 直接移到 Backend；旧 signed package 需要不支持/升级行为                     |
| 正式外仓 Plugin：`0honus0/nexus-agent-plugins`，`nexus.agent`、`nexus.fullstack`                                                                                                                                             | **外部发布依赖**：需签名替代版本（含 Host 支持范围）并做真实验收；外仓正式发布 owner，P0-4/P4                                                                                                    | 公开 v1.0.0 的前者仍授予 `workspace.manage`、后者仍有 `targets.runner`；本仓 fixture 不是发布证据 |
| Agent Runner/交付：`packages/agent-runner/`、`scripts/agent-runner/`、`scripts/docker/agent-runner/`、根 build/check、`docker-compose.yml`、`publish-ghcr.yml`、`e2e.yml`、`update-dependencies.yml`                         | **依赖迁完后移除**生产 Runner 包/服务/镜像/发布/安装脚本；Build/DevOps owner，P6                                                                                                                 | 必须保留 `tests/e2e/Dockerfile.runner`、Playwright 分片等**测试 Runner**，而不是按名字全部删除    |
| 真实验证：`tests/backend/agent-scenarios/runner.ts`、`tests/e2e/specs/agent/functional-regressions.spec.ts`、`workspace-job-settings.spec.ts`、`ssh-acp-settings.spec.ts`、`tests/e2e/playwright.config.ts`                  | **分类迁移**：删除 Workspace-only 场景、保留 SSH/Browser/ACP/Plugin/安全/恢复反例及普通终端 E2E；Tests owner，P3–P7                                                                              | `runner.ts` 混有 `workspace/*` 普通终端场景，不得把所有 Workspace 字样的场景删除                  |
| 正式需求/架构/部署：`doc/AGENTS.md`、`USAGE.md`、`architecture/{BACKEND,FRONTEND}.md`、`DEPLOYMENT.md`、`testing/{E2E,AGENT_TASK_SCENARIOS}.md`、README/三语与截图                                                           | **随生产阶段同步**当前真实行为，最终统一验收；Docs/产品各 owner，P1–P7                                                                                                                           | `USAGE.md` 才是当前用户行为唯一权威，实施中不提前写计划目标为现状                                 |

**完成判据**：上述消费者都有具体删除/迁移/保留 owner 与顺序，且 Browser/ACP/Child/Checkpoint/备份/正式插件的跨界依赖已点名。该映射是 P0-2 的静态审计结果；新实现必须继续以行为测试和依赖审查证明，没有凭 `rg` 归零宣布产品通过。

## 本次实施边界与后续动作

- 本轮已完成 **P0-2 消费者/owner 映射**及 **P0-3 最终 SSH-only 范围定义**；同步 `doc/AGENTS.md` 的单文件过程记录例外。未修改生产代码、数据库、Workspace 项目、正式 Plugin 仓库或用户原有计划文件。
- 下一项为 **P0-5 对旧部署资源的实际清点、归档与清理前置核验**（现有环境只完成了 API/owner 静态审计）；并行待补 P0-1 的 E2E/实际部署版本和 P0-4 的正式签名插件替代发行。P0 总阶段仍在进行中，不开始物理删表/删包。测试环境此前由用户停止，不能猜测其已重启。
