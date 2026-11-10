# 旧 Agent 整体移除清单

## 1. 范围与状态

2026-11-10，按用户要求从本体移除旧 Agent 的完整范围，包含前端、后端、Shared、SQL、构建与测试。本页记录已实施的移除范围；源码与新数据库运行结构已清理，没有操作生产数据库。用户后续授权提交推送，并将独立插件仓全部清空、保留代码历史，见第10节。实施顺序只在 [PLAN](../PLAN.md#旧-agent-整体移除清单) 维护。

这里的 Agent 包括当前耦合在 Agent 下的插件市场、安装/实例管理、运行宿主、双端 SDK 和业务功能。此次不是只删 Agent Loop，也不先把旧系统改名为 `plugins`。本轮完成后，旧 Agent 设置、启动、聊天和插件市场入口一并移除；后续通用宿主与八项基础 API 仍按 [重构目标](AGENT_REFACTOR.md)另行实现，不将它们记为本次移除的交付结果。独立的 `nexus-agent-plugins` 仓库按后续授权单独清空，不将旧实现复制回本体。

分类：**删除**表示从当前本体移除；**修改**表示保留文件、只清理 Agent 接入；**保留**表示仍有本体用途或迁移/恢复责任，不能跟随删除。以下数量为本次工作区盘点，不是固定门槛。

## 2. 已删除目录与文件

### 三个主要源码目录：640 个文件

```text
packages/
├── backend/src/modules/agent/              # 401：移除整个旧模块
│   ├── artifacts/                         # 9：附件、交付与清理
│   ├── context/                           # 13：上下文、快照、压缩
│   ├── execution/                         # 12：预算与硬限制
│   ├── governance/                        # 18：旧 Agent 授权/审批实现
│   ├── integrations/                      # 6：旧协议/CDP 装配
│   ├── interfaces/                        # 44：全部旧 HTTP/WS/IPC 入口
│   ├── memory/                            # 8
│   ├── operations/                        # 25：旧 Agent 操作与效果投影
│   ├── plugins/                           # 95：市场、宿主、实例、SDK、SQL
│   ├── providers/                         # 25：模型与供应商
│   ├── runs/                              # 66：Run、协作、挂起恢复
│   ├── scope/                             # 22：App、Thread 与命名
│   ├── service/                           # 1
│   ├── snapshots/                         # 9：Agent 专属备份注册/校验
│   └── 根部文件                           # 9：register/public/错误/迁移等
├── frontend/src/features/agent/            # 130：移除整个旧功能
│   ├── api/                               # 11
│   ├── composables/                       # 10
│   ├── events/                            # 1
│   ├── files/                             # 4
│   ├── host/                              # 9：启动、窗口、会话与提醒
│   ├── i18n/                              # 3
│   ├── model/                             # 20
│   ├── next/                              # 7：临时 Agent Next 页面与客户端
│   ├── plugins/                           # 45：市场、设置、iframe、桥与 SDK
│   ├── runtime/                           # 1
│   ├── settings/                          # 17
│   └── 根部文件                           # 2：public 与格式化
└── shared/src/agent/                       # 109：移除整个旧协议域
    ├── artifacts/                         # 4
    ├── collaboration/                     # 4
    ├── execution/                         # 4
    ├── governance/                        # 4
    ├── integrations/                      # 3
    ├── memory/                            # 5
    ├── operations/                        # 1
    ├── plugins/                           # 59：双 SDK/宿主/固定业务协议
    ├── providers/                         # 5
    ├── runs/                              # 5
    ├── scope/                             # 6
    ├── tools/                             # 6
    └── 根部文件                           # 3：http/codec/values
```

Backend/Shared 中历史迁移的必要依赖要先冻结到迁移专属位置，再删原目录，详见 SQL 节；上面的 640 是移除原路径的范围，不代表每段历史代码均可直接丢弃。当前签名包、SDK4、固定 Run/Workspace RPC、Skill、Intent 和专用服务传输不在本体保留兼容出口。

### 旧 Agent 独占技术实现：26 个文件

```text
packages/backend/src/platform/
├── ai/                                    # 删除，11：模型 SDK/目录/协议
├── browser/                               # 删除，2：Puppeteer/CDP
├── isolation/                             # 删除，4：旧插件进程及 worker
├── packages/                              # 删除，4：旧签包读取/验证与版本读取
├── validation/                            # 删除，1：旧插件 JSON Schema 校验
└── blobs/
    ├── text-log-store.ts                   # 删除
    ├── content-inspector.ts                # 删除
    └── adapters/
        ├── native-text-log-store.ts        # 删除
        └── native-content-inspector.ts     # 删除
```

这些技术实现当前只服务旧 Agent，`packages/adapters/node-package-version.ts` 虽由 Bootstrap 调用，也只用于传给 `registerAgent` 的版本参数。移除其消费者后纳入删除；以后新通用宿主需要的技术代码从版本历史按新边界复用，不在当前留下无人使用的运行模块。本条对应“先完整移除旧系统”的阶段，区别于重构目标中随新宿主接入而保留技术实现的方案。

`platform/acp/adapters`、`platform/mcp/adapters` 的空目录一并清理。`platform/desktop/adapters/browser-desktop.ts` 是 RDP/VNC 传输，不属于上述 Browser。

### SDK 专用构建入口

```text
packages/backend/build/
├── build-plugin-backend-sdk.mjs            # 删除
└── copy-plugin-frontend-sdk.mjs            # 删除
packages/frontend/build/
└── build-plugin-frontend-sdk.mjs           # 删除
packages/backend/dist-plugin-sdk/          # 如存在，清理旧生成物
packages/frontend/dist-plugin-sdk/         # 如存在，清理旧生成物
```

删除旧 `/sdk/frontend-v4.mjs` 下载服务与 `frontend-v4.mjs` 复制链。删除专属成品前核对本轮归属；不清空其他测试证据或业务目录。独立插件仓的清空按第10节执行。

## 3. 保留文件中的 Agent 接入

| 文件/范围                                                                                                      | 修改内容                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend `bootstrap/create-app.ts`                                                                              | 移除 `AgentStateApi`、Agent 错误、公开 `agent` 字段及专属准入/关闭依赖，保留整个应用的生命周期                                                                        |
| Backend `bootstrap/module-manifest.ts`                                                                         | 移除 registerAgent/backup、初始化、路由/WS、诊断资源采集、owners、关停注册和 Agent 专用 Blob/日志 Store；保留其他模块                                                 |
| Backend `bootstrap/data-paths.ts`                                                                              | 移除 `artifacts`、`toolLogs`、`plugins` 路径字段及其装配；保留 `appearance`。实际文件清理须另核对引用与恢复状态                                                       |
| Backend `bootstrap/schema.ts`                                                                                  | 改消费冻结历史迁移并追加正式移除迁移；原版本/签名与非 Agent 迁移不改写                                                                                                |
| Backend `modules/operations/interfaces/http/operation-observer.ts`                                             | 移除 Agent execution-settings 专属事件映射；保留通用 HTTP/登录/配置审计与请求秘密隔离                                                                                 |
| Backend `modules/remote/{public,register}.ts`、`machines/service/operation-service.ts`                         | 去掉旧 Agent 装配/默认来源，复核专供旧 Agent 的工厂出口；删除无人消费的旧工具通道工厂、scope、命令/文件工具服务及公开类型；普通 SSH/SFTP、文件和监控沿现有 owner 保留 |
| Backend Remote `machines/adapters/sqlite/mutation-schema.ts`                                                   | 通过新迁移处理来源约束与已有记录；未确认远端效果不随 Agent 表一起抹掉                                                                                                 |
| Frontend `app/App.vue`                                                                                         | 移除 AgentSurfaceHost 挂载及专属错误边界                                                                                                                              |
| Frontend `app/pages/settings/SettingsPage.vue` 与该页三语 i18n                                                 | 移除 Agent 设置 tab、visited/active 分支和说明；保留其余设置                                                                                                          |
| Frontend `app/router/index.ts`                                                                                 | 移除 Agent Next import、`/__agent-next` 路由及其开发守卫分支；保留其他开发入口                                                                                        |
| Frontend `features/system-overview/components/HostDiagnosticsPanel.vue`、Shared `system/diagnostics/values.ts` | 移除 Agent 诊断模块、图标/样式及翻译；保留本体其他模块的采集与显示                                                                                                    |
| Shared `remote/mutations/values.ts`、Frontend `features/mutation-recovery/i18n/*`                              | 核对历史 Agent 来源如何保留/标识；移除不再可调用的 Agent 恢复动作，不破坏其他突变恢复                                                                                 |
| Shared `operations/values.ts`、Frontend `features/{audit,notifications}` 的文案/展示                           | 停止旧 Agent 事件生产；历史记录解码、过滤和通知队列按数据策略处理后才能收窄事件枚举。Agent 历史记录不作为删除整份审计/通知的理由                                      |
| Frontend `features/{backup,preferences}/i18n/*`                                                                | 去掉备份描述中的 Agent/Artifact/插件、图片上限提示中的 Agent 文件库；图片预览上限设置继续供文件管理器使用                                                             |
| Frontend `features/audit/{model/auditPresentation.ts,views/AuditLogRow.vue,views/AuditDeliveryRow.vue}`        | 核对 Agent 分类/配色的历史消费者，随历史记录处理同步调整，不直接删除整套审计视图                                                                                      |
| Frontend `foundation/ui/styles/feedback-states.css`                                                            | 更新 Agent 专用描述；公共状态样式仍按其他消费者保留                                                                                                                   |

Shared `package.json` 中全部 `./agent/*` exports、对应类型/声明和双端引用同步移除。Frontend locale 构建继续使用现有自动发现，不为了维持失效键保留旧 Agent 翻译目录。

## 4. 依赖与类型清理

Backend 的 `openai`、`puppeteer-core`、`ajv`、`tar` 随独占实现删除后移除直接依赖；`semver`/`@types/semver` 在冻结历史迁移的真实闭包中仍需复核，有消费者时保留。Frontend、Shared 的 semver 也逐消费点核对，不能只删除后端清单就称依赖清理完成。同步 lockfile、catalog、构建输入与声明检查。

`file-type` 仍用于背景图片验证，`ws`、SSH、归档、SQLite、加密和前端通用组件仍有非 Agent 用途，保留。旧服务传输独占的 SafeHttp stream 实现与测试已删除，普通主题等使用的 BoundedFetch 保留；`undici` 仅供验证码测试的 MockAgent，移到开发依赖。双端直接 `esbuild` 依赖随旧 SDK builder 删除，测试/Vite 所需传递依赖仍由锁文件维护；Backend 无消费者的直接 `zod` 依赖移除，Shared 诊断使用的 Zod 保留。测试使用的 Puppeteer/Playwright 工具依赖与生产 CDP 依赖分别判断，不整项移除浏览器测试能力。Undici 的 `Agent`、颜色 `magenta`、`navigator.userAgent` 和 Fastify/Vite 的 plugin 均不是待删除的 Agent 功能。

公开错误和协议不保留旧 Agent 重导出；需要保留的历史常量/解码应成为迁移私有快照，不继续 import 新版本业务协议。已确认的 Remote、RemoteFile、Database 等基础职责不因删除 Agent 目录而改归普通业务；本轮不提前冻结其新 API 方法。

## 5. 测试、构建与入口

### Agent 专用测试目录

```text
tests/
├── backend/agent/                         # 95：旧业务/宿主测试
├── frontend/agent/                        # 16：旧设置/桥/组件测试
├── shared/agent/                          # 5：旧协议测试
├── backend/platform/ai/                   # 随模型技术实现删除
├── backend/platform/packages/             # 随旧签包读取实现删除
└── e2e/
    ├── specs/agent-host/                  # 8：旧宿主浏览器场景
    ├── fixtures/agent/                    # 117：旧签包、源快照、测试密钥
    ├── support/agent-host/                # 6：旧宿主辅助
    └── support/
        ├── agent.ts
        ├── agent-request.ts
        ├── plugins.ts
        └── plugin-settings.ts
```

这些目录中的旧 Agent 产品断言随功能移除；正式迁移、未知效果和被保留 Remote 等基础能力的独有断言先转到真实 owner，不全删后失去保障。现有完整迁移测试保留，按用户补充要求不新增测试用例；通过一次性迁移检查、构建、启动和适用的现有用例确认普通功能可运行。

`tests/support/plugins/`、`agent-storage-doubles.mjs`、`native-plugin-package.mjs`、`pinned-plugin-package.mjs`、`signed-plugin-catalog.mjs`、`tool-package-identities.json`、`package-tool-catalog.*`、`http/plugin-protocol-fixture.mjs`、`protocols/plugin-repository.mjs` 随实际调用清理。`tests/tsconfig.contracts.json` 不能继续只引用已删除的 Agent double；无其他用途则删除该专用配置及入口。

| 保留入口                                                                                                     | 清理内容                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 根/双端 `package.json`、Shared exports、`pnpm-lock.yaml`、`pnpm-workspace.yaml`                              | 移除旧 SDK scripts/串联构建与实际无消费者依赖，不发布新 npm 包                                                                       |
| `Dockerfile`、`.dockerignore`、`.gitignore`                                                                  | 移除 SDK 构建/跨阶段 COPY/废弃路径条目，保留应用正常构建和运行                                                                       |
| Frontend `vite.config.ts`                                                                                    | 移除旧 `/sdk`、`/plugins` 资产和 `/ws/agent` 接入；保留 `/api` 及终端、上传、桌面等代理                                              |
| `.github/workflows/e2e.yml`                                                                                  | 删除旧 Agent 插件仓 checkout/构建/签包、SDK 产物与对应互操作/浏览器链的依赖；保留本体质量和非 Agent 分片，不留下等待已移除成品的作业 |
| `scripts/e2e/{run-test-shard,host-test-artifact,balanced-shards,resolve-build-artifact,run-remote}` 对应脚本 | 去掉强制插件源码/候选包环境、旧 SDK 路径、插件 lanes/产物种类和仓库端口；不影响剩余报告、失败传播和排空                              |
| `tests/support/protocols/test-environment.ts` 与实际服务启动配置                                             | 移除插件仓库、受控模型及 MCP/ACP 的 Agent 专用服务；SSH/RDP/VNC 等仍服务其他功能的受控环境继续保留                                   |
| `tests/{vitest.config.ts,playwright.config.ts,cases/migration.json}`、`scripts/checks/test-layout.mjs`       | 删失效发现/项目/路径与外部插件测试替代条目，保留其他测试覆盖责任                                                                     |
| `scripts/e2e/duration-estimates.json`、CI tooling tests、runner 镜像构建输入                                 | 清理 Agent 耗时估算与旧成品/插件流程断言；只因依赖确实不再需要才删除 runner 内工具，不删除其他协议所需环境                           |

## 6. SQL 与持久数据

### 核对结果

本轮从当前 TypeScript 源码在内存中构建并执行 **66 条现有迁移**，启用 SQLite 外键检查后读取最终 schema，确认当前有 **72 张 `agent_*` 表**。非 Agent 表没有声明指向这些表的入向外键；这不证明 JSON 引用、审计、快照或远端效果无关联。没有读取或修改运行中的本地/远程数据库；升级复验使用任务目录中的独立 SQLite 夹具。

以下为实际迁移后的删除候选，不是历史 CREATE TABLE 文本集合；已被历史迁移删除的 legacy 表未重复列入。

```text
App / Thread / 旧命令去重（10）
  agent_apps
  agent_app_definitions
  agent_app_declared_capabilities
  agent_app_definition_packages
  agent_app_checkpoints
  agent_app_messages
  agent_app_message_chunks
  agent_threads
  agent_thread_commands
  agent_command_idempotency

Run / 协作（12）
  agent_runs
  agent_run_events
  agent_run_executions
  agent_run_execution_settings
  agent_run_inputs
  agent_run_suspensions
  agent_run_resume_commands
  agent_run_children
  agent_run_facts
  agent_run_mailbox
  agent_run_mailbox_cursors
  agent_run_projects

工具 / 效果（3）
  agent_tool_jobs
  agent_project_effects
  agent_collaboration_effects

供应商 / 模型（2）
  agent_providers
  agent_model_capability_registry

执行配置（2）
  agent_execution_settings
  agent_hard_limit_confirmations

授权 / 目标限制（4）
  agent_governance_policies
  agent_governance_grants
  agent_target_denylist
  agent_target_denylist_meta

记忆（1）
  agent_memories

Artifact（6）
  agent_artifacts
  agent_artifact_attachments
  agent_artifact_grants
  agent_artifact_cleanup
  agent_artifact_cleanup_items
  agent_artifact_blob_removals

Operation / 审批（9）
  agent_operations
  agent_operation_approval_commands
  agent_operation_approvals
  agent_operation_artifacts
  agent_operation_authorities
  agent_operation_contents
  agent_operation_content_chunks
  agent_operation_diagnostics
  agent_operation_model_reservations

旧插件宿主 / 市场 / 实例 / 数据（23）
  agent_plugin_app_bindings
  agent_plugin_app_packages
  agent_plugin_configuration_mutations
  agent_plugin_connections
  agent_plugin_data
  agent_plugin_data_migrations
  agent_plugin_data_operations
  agent_plugin_data_purges
  agent_plugin_extension_data
  agent_plugin_extension_operations
  agent_plugin_installations
  agent_plugin_instances
  agent_plugin_intents
  agent_plugin_package_updates
  agent_plugin_packages
  agent_plugin_private_data
  agent_plugin_publishers
  agent_plugin_repositories
  agent_plugin_retirements
  agent_plugin_runtime_history
  agent_plugin_runtime_instances
  agent_plugin_stages
  agent_plugin_versions
```

### 不能随目录直接删的部分

原 v1 包含 Agent 初始化；v2、v3、v5–v9、v11–v65 共 62 条独立迁移属于旧 Agent，仍保留原编号、签名和执行语义。v4、v66 是 OIDC，v10 是通知迁移，不能跟随删除。全局迁移记录表、SQLite/快照恢复引擎也继续保留。

源码依赖盘点显示，现有迁移入口静态依赖 **93 个 Backend Agent 文件、18 个 Shared Agent 文件**，除 SQL 外还引用 manifest 解码、常量和少量存储辅助；不能直接删掉 `migrations.ts` 或以为只移动几个 `.sql` 即可。实施时只冻结历史迁移真正需要的函数/取值及 SQL 到下列迁移专属 owner，解除对应用 Service、当前 Shared Agent 出口和已删除目录的依赖；这些文件数是依赖盘点结果，不要求原样保留整个闭包。

```text
packages/backend/src/platform/storage/sqlite/adapters/migrations/
└── agent-history/                         # 已冻结的历史迁移闭包
    ├── migration-plan.ts                  # 原迁移顺序/签名与函数引用
    ├── ...                               # 按原职责冻结的 SQL 与必要数据转换
    └── ...                               # 私有历史常量/解码；无公开业务出口
```

该位置只由数据库升级编排消费，不参与 HTTP/WS、插件装配或应用业务；不用保留旧 Shared workspace 来运行历史迁移，也不依赖尚未实现的新通用宿主。

移除 72 张表通过新连续编号迁移交付，执行时从实际迁移链确定下一个编号，不改写已执行迁移。删除顺序按真实外键关系处理并检查完整性；不通过关闭外键检查掩盖非 Agent 关联。不新增运行时旧字段/旧 SDK 兼容逻辑。

全局审计/通知、Remote 突变和快照数据分别由原 owner 处理：已有 `AGENT_*` 事件不能在仍有记录时直接从严格解码枚举消失；待发送队列也需收敛。未确认执行/清理事实在移除旧 Agent 表前明确归属，不能自动认定任务已停止或把远端写入报成功。只读历史证据与可继续执行的旧 Agent 功能是两件事。

## 7. 文件数据、资源与保留范围

旧版本的数据路径是数据库同级 `artifacts/`、`tool-logs/`、`plugins/`，以及旧插件进程/协议通道。先停止新准入并收尾实际任务，完成元数据与文件引用核对后清理；删除 SQLite 表不等于文件、子进程和远端效果已经释放。本轮已解除这些路径的运行装配；保留既有文件数据，不扫描或删除用户目录。

备份导出/恢复同时移除 Agent 表注册、Artifact/插件文件 root 与校验器；继续保留背景图片和其他模块快照。旧快照含 Agent 数据时给出明确的不兼容结果，不静默恢复缺失模块或遗留任意文件。

启动在数据库迁移前只读校验恢复日志；包含已移除文件根的旧日志会拒绝启动，保留原数据库版本与全部恢复依据。通过校验后仍先执行正式迁移、再根据提交标记恢复文件，最后安装模块；不增加旧文件根兼容或猜测清理。

明确保留：`modules/{access,targets,remote,preferences,operations,system}` 及其真实基础能力，终端、挂起会话、文件管理器、Docker、服务器状态、RDP/VNC、登录/OIDC/Passkey、审计、通知、备份和外观设置。保留 Node、SSH/SFTP、受管 HTTP/WS、SQLite、SecretBox、通用 Blob/图片及真实资源生命周期实现；不因名称或当前某个消费者带 Agent 就整体删除。

## 8. 文档与验收

实际执行时同步清理 USAGE/API/DEPLOYMENT/README 中已失效功能，当前架构 AGENT/SDK4 使用说明与 `testing/AGENT_TASK_SCENARIOS.md` 退役，截图按真实文档消费者移除；历史验收结论留历史索引，不把旧通过记录改写为移除版的验收。重构目标继续标为未实施，目录清单完成不代表新 SDK/宿主已实现。

移除版判据：生产运行依赖中无旧 Agent 目录/路由/SDK，前端无入口与失效翻译；升级后的 72 张 Agent 表不再存在，历史迁移可完整执行/重启，未确认效果与保留记录有明确 owner；应用构建、剩余测试发现和 CI 不依赖插件候选产物；其余功能通过相应回归。使用真实迁移与正常浏览器流程验证，不新增平行测试框架。

本轮已完成源码移除、升级检查与普通功能适用现有回归；实际结果见下节及 testing，不新增用例。

## 9. 实施结果

- 三处旧业务源码、独占技术实现、SDK、前端入口、Shared exports、旧Agent用例及签包/候选CI链已移除。Remote中无人消费的旧工具通道工厂、scope、命令/文件工具服务和专用Platform适配也已删除。普通SSH/SFTP、终端、文件、桌面、Docker、认证、设置与备份保留。
- v1–v66 必要声明闭包冻结为迁移私有快照，不是运行模块，不对外导出。签名及旧链最终schema已与原版核对一致。
- v67 删除72张旧表，未收敛外部工作会拒绝升级；v68保留机器突变及人工证据并转换来源；v69只清理旧Agent事件及订阅。
- 实例只继续打开appearance资源根；已有旧附件/包目录不在启动时递归删除，不改远程运行环境。独立插件仓按用户后续要求清空，代码参考保留于Git历史。
- 验证与产物见[历史记录](../testing/HISTORY.md#旧-agent-整体移除2026-11-10)。新通用宿主、SDK及基础插件仍为后续设计，没有在本次移除中实现。
- 全面复审补清旧 ACP 夹具出口、工具审批映射、命令辅助及 SafeHttp stream 孤儿，恢复混合用例中原有的普通 HTML 主题安全头断言，并同步诊断模块数及单文件根下的重复根故障夹具。历史快照96文件、178处声明与原版逐项比较无语义差异，非空升级验证见[复审记录](../testing/HISTORY.md#移除后全面复审2026-11-10)。

## 10. 旧代码参考与插件仓清空

两仓均保留远程注解标签 `archive/pre-agent-reset-20261110`，无需沿提交链寻找删除前版本：

| 仓库 | 删除前参考                                                                                                            | 内容                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 本体 | [nexus-terminal / f16c396e](https://github.com/0honus0/nexus-terminal/tree/archive/pre-agent-reset-20261110)          | 完整旧 Backend Agent、Frontend Agent、Shared、双 SDK、Platform 实现和原测试。                     |
| 插件 | [nexus-agent-plugins / 099f3b8](https://github.com/0honus0/nexus-agent-plugins/tree/archive/pre-agent-reset-20261110) | 全部旧插件、SDK副本、共享UI、构建/发布、测试及4份未验收Chat草稿；草稿仅供参考，不作为已验收功能。 |

独立插件仓 `main` 的 `ffbe4d2` 清空全部480个跟踪文件，包括代码、文档、SDK、依赖清单、测试与workflows；本地仅保留 `.git`，可重建依赖/编译产物同步清理。没有删除仓库、历史提交、已有标签或Release，没有强制推送。后续插件从空树按新设计重新实现，不要求兼容旧SDK或沿用旧包ID。

本地查看单文件与历史使用：

```sh
git show archive/pre-agent-reset-20261110:原文件路径
git log archive/pre-agent-reset-20261110 -- 原文件路径
```

本体参考目录为 `packages/backend/src/modules/agent/`、`packages/frontend/src/features/agent/`、`packages/shared/src/agent/`；插件参考目录为 `plugins/`、`lib/`、`sdk/`、`templates/` 和 `tests/`。仅按新职责选取有用实现，不恢复整套旧运行兼容层。数据库中的旧版本升级仍由本体私有历史迁移负责，源码参考标签不参与应用运行。
